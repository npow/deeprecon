import { GoogleGenerativeAI } from "@google/generative-ai"
import { jsonrepair } from "jsonrepair"
import fs from "fs"
import path from "path"
import { flattenNumericKeys } from "@/lib/utils"
import {
  IntentExtraction,
  Competitor,
  GapAnalysis,
  DDReport,
  PivotSuggestion,
  ScanSettings,
  DEFAULT_SETTINGS,
  SubCategory,
  SubCategoryPlayer,
} from "@/lib/types"
import { verifyCompetitorWebsites } from "@/lib/verify-website"
import {
  INTENT_EXTRACTION_PROMPT,
  COMPETITIVE_ANALYSIS_PROMPT,
  GAP_ANALYSIS_PROMPT,
  DD_REPORT_PROMPT,
  PIVOT_SUGGESTIONS_PROMPT,
  VERTICAL_MAP_PROMPT,
  SUBCATEGORY_ENRICH_PROMPT,
} from "./prompts"
import { timed } from "@/lib/telemetry"

// ─── Gemini SDK (kept for Google Search grounding) ───

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "")

// ─── CLIProxy multi-model pool ───

const CLIPROXY_BASE = process.env.CLIPROXY_URL || "http://127.0.0.1:8317"
const CLIPROXY_KEY = process.env.CLIPROXY_API_KEY || "your-api-key-1"

interface ModelDef {
  id: string
  label: string
  maxTokens: number
  jsonMode?: boolean // supports response_format: { type: "json_object" }
}

// Models for scan pipeline via CLIProxy — diverse providers for broader competitor knowledge
// Models with jsonMode: true get response_format: { type: "json_object" }
// Others get "Respond with ONLY valid JSON" instruction + extractJSON parsing
const SCAN_MODELS: ModelDef[] = [
  { id: "gemini-3-flash", label: "Gem3Flash", maxTokens: 16384, jsonMode: true },
  { id: "gemini-3-pro-high", label: "Gem3ProH", maxTokens: 16384 },
  { id: "qwen3-235b-a22b-instruct", label: "Qwen3-235b", maxTokens: 16384 },
  { id: "qwen3-max", label: "QwenMax", maxTokens: 16384 },
  { id: "deepseek-v3.2-reasoner", label: "DSv3.2", maxTokens: 16384, jsonMode: true },
  { id: "claude-opus-4-6", label: "Opus4.6", maxTokens: 16384 },
  { id: "kimi-k2", label: "KimiK2", maxTokens: 16384 },
]

let modelIdx = 0
function nextModel(): ModelDef {
  const m = SCAN_MODELS[modelIdx % SCAN_MODELS.length]
  modelIdx++
  return m
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function isFastScanMode(): boolean {
  return process.env.SCAN_DEV_FAST_MODE === "1"
}

function parseTimeout(name: string, fallbackMs: number): number {
  const raw = process.env[name]
  if (!raw) return fallbackMs
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1000) return fallbackMs
  return Math.floor(parsed)
}

type ProviderTimeoutCache = {
  loadedAt: number
  cliproxy?: number
  gemini?: number
}

let timeoutCache: ProviderTimeoutCache | null = null

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

function computeTelemetryTimeoutDefaults(): ProviderTimeoutCache {
  const now = Date.now()
  if (timeoutCache && now - timeoutCache.loadedAt < 60_000) return timeoutCache

  const next: ProviderTimeoutCache = { loadedAt: now }
  const filePath = path.join(process.cwd(), "data", "telemetry", "scan-timings.ndjson")
  if (!fs.existsSync(filePath)) {
    timeoutCache = next
    return next
  }

  try {
    const text = fs.readFileSync(filePath, "utf-8")
    const lines = text.trim().split("\n").slice(-10_000)
    const cliproxyDurations: number[] = []
    const geminiDurations: number[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      let row: any
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (row?.kind !== "provider" || row?.ok !== true || typeof row?.durationMs !== "number") continue
      if (row?.provider === "cliproxy") cliproxyDurations.push(row.durationMs)
      if (row?.provider === "gemini") geminiDurations.push(row.durationMs)
    }

    const buffered = (value: number) => Math.min(300_000, Math.max(30_000, Math.round(value * 1.3)))
    if (cliproxyDurations.length >= 20) {
      next.cliproxy = buffered(percentile(cliproxyDurations, 99))
    }
    if (geminiDurations.length >= 20) {
      next.gemini = buffered(percentile(geminiDurations, 99))
    }
  } catch {
    // best effort only; fallback defaults remain in place
  }

  timeoutCache = next
  return next
}

function resolvedTimeout(name: string, fallbackMs: number, provider?: "cliproxy" | "gemini"): number {
  const explicit = parseTimeout(name, -1)
  if (explicit >= 1000) return explicit
  if (!isFastScanMode() && provider) {
    const auto = computeTelemetryTimeoutDefaults()[provider]
    if (auto && auto >= 1000) return auto
  }
  return fallbackMs
}

// ─── CLIProxy call (OpenAI-compatible) ───

async function callCLIProxy(
  systemPrompt: string,
  userMessage: string,
  model: ModelDef,
  maxTokens: number,
  timeoutMs: number = 120_000
): Promise<string> {
  return timed(
    "provider.call_cliproxy",
    "provider",
    { provider: "cliproxy", model: model.label, timeout_ms: timeoutMs },
    async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetch(`${CLIPROXY_BASE}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CLIPROXY_KEY}`,
          },
          body: JSON.stringify({
            model: model.id,
            messages: [
              { role: "system", content: model.jsonMode ? systemPrompt : systemPrompt + "\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown, no prose, no code blocks." },
              { role: "user", content: userMessage },
            ],
            max_tokens: maxTokens,
            // Keep outputs creative enough for options, but reduce rerun volatility.
            temperature: 0.35,
            ...(model.jsonMode && { response_format: { type: "json_object" } }),
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const body = await res.text().catch(() => "")
          throw new Error(`CLIProxy ${model.label} ${res.status}: ${body.slice(0, 200)}`)
        }

        const json = await res.json()
        const text = json.choices?.[0]?.message?.content
        if (!text) throw new Error(`Empty response from ${model.label}`)
        return text
      } finally {
        clearTimeout(timer)
      }
    }
  )
}

// ─── Gemini SDK call (for grounded searches) ───

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 8192,
  grounded: boolean = false
): Promise<string> {
  return timed(
    "provider.call_gemini",
    "provider",
    { provider: "gemini", grounded, max_tokens: maxTokens },
    async () => {
      const genModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: systemPrompt,
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(!grounded && { responseMimeType: "application/json" }),
        },
        ...(grounded && {
          tools: [{ googleSearch: {} } as any],
        }),
      })

      const result = await genModel.generateContent(userMessage)
      const text = result.response.text()
      if (!text) throw new Error("No text response from Gemini")
      return text
    }
  )
}

// ─── Unified callLLM: tries CLIProxy models, falls back to Gemini ───

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 8192,
  options?: { grounded?: boolean }
): Promise<string> {
  const errors: string[] = []

  // Try 3 different CLIProxy models
  for (let i = 0; i < 3; i++) {
    const model = nextModel()
    try {
      return await callCLIProxy(systemPrompt, userMessage, model, maxTokens)
    } catch (err: any) {
      errors.push(`${model.label}: ${err.message}`)
      console.warn(`callLLM ${model.label} failed:`, err.message)
    }
  }

  // Fallback to Gemini SDK
  try {
    return await callGemini(systemPrompt, userMessage, maxTokens, options?.grounded)
  } catch (err: any) {
    errors.push(`Gemini: ${err.message}`)
    console.warn("callLLM Gemini fallback failed:", err.message)
  }

  throw new Error(`All models failed: ${errors.join("; ")}`)
}

// ─── Fan-out call: hit N models in parallel, return first success ───

async function callFirstSuccess(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  n: number = 3
): Promise<string> {
  const models = Array.from({ length: n }, () => nextModel())

  // Race: all CLIProxy models + Gemini fallback
  const promises = [
    ...models.map((m) =>
      callCLIProxy(systemPrompt, userMessage, m, maxTokens).then((text) => ({
        text,
        model: m.label,
      }))
    ),
    callGemini(systemPrompt, userMessage, maxTokens).then((text) => ({
      text,
      model: "Gemini",
    })),
  ]

  // Return first success
  const result = await Promise.any(promises)
  console.log(`callFirstSuccess: ${result.model} won`)
  return result.text
}

function withWorkflowMode(
  basePrompt: string,
  settings: ScanSettings = DEFAULT_SETTINGS
): string {
  const mode = settings.workflowMode || "founder"
  if (mode === "investor") {
    return `${basePrompt}

WORKFLOW MODE: INVESTOR / ACCELERATOR
- Bias toward institutional decision quality over founder inspiration.
- Highlight red flags, portfolio overlap risk, and execution risk early.
- Prefer standardized comparisons that support ranking many opportunities quickly.
- Call out what is inference vs verifiable evidence.`
  }

  return `${basePrompt}

WORKFLOW MODE: FOUNDER
- Prioritize actionable moves for an early-stage builder.
- Emphasize positioning, go-to-market path, and fast validation steps.
- Keep guidance concrete enough to execute this week.`
}

function frequencyRank(frequency: string): number {
  const f = (frequency || "").toLowerCase()
  if (f === "very_common") return 3
  if (f === "common") return 2
  return 1
}

function impactRank(impact: "high" | "medium" | "low" | string): number {
  if (impact === "high") return 3
  if (impact === "medium") return 2
  return 1
}

// ─── Fan-out for competitive analysis: hit N models, merge all results ───

async function fanOutCompetition(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  settings: ScanSettings = DEFAULT_SETTINGS
): Promise<{ competitors: Competitor[]; crowdednessIndex: string; totalFundingInSpace: number }> {
  const isFastDevMode = isFastScanMode()
  const modelCount = isFastDevMode ? 3 : 5
  const modelTimeoutMs = isFastDevMode
    ? resolvedTimeout("SCAN_TIMEOUT_FAST_MS", 60_000)
    : resolvedTimeout("SCAN_TIMEOUT_CLIPROXY_MS", 200_000, "cliproxy")
  const geminiTimeoutMs = isFastDevMode
    ? resolvedTimeout("SCAN_TIMEOUT_FAST_MS", 60_000)
    : resolvedTimeout("SCAN_TIMEOUT_GEMINI_MS", 120_000, "gemini")
  const includeGeminiGrounded = process.env.DISABLE_GEMINI_GROUNDED !== "1"

  // Use diverse models + optional Gemini grounding in parallel
  const models = Array.from({ length: modelCount }, () => nextModel())
  const now = new Date().toISOString()

  const cliPromises = [
    // CLIProxy models (diverse knowledge)
    ...models.map((m) =>
      callCLIProxy(systemPrompt, userMessage, m, maxTokens, modelTimeoutMs)
        .then((text) => {
          const parsed = JSON.parse(extractJSON(text))
          return {
            competitors: ((parsed.competitors || []) as Competitor[]).map((c) => ({
              ...c,
              discoveredAt: now,
              discoveredBy: m.label,
              source: c.source || "ai_knowledge",
            })),
            crowdednessIndex: parsed.crowdednessIndex || "moderate",
            totalFundingInSpace: parsed.totalFundingInSpace || 0,
          }
        })
        .catch((err) => {
          console.warn(`Competition fan-out ${m.label} failed:`, err.message)
          return null
        })
    ),
  ]
  const geminiPromise = includeGeminiGrounded
    ? [
        withTimeout(
          callGemini(systemPrompt, userMessage, maxTokens, true),
          geminiTimeoutMs,
          "Gemini grounded competition"
        )
          .then((text) => {
            const parsed = JSON.parse(extractJSON(text))
            return {
              competitors: ((parsed.competitors || []) as Competitor[]).map((c) => ({
                ...c,
                discoveredAt: now,
                discoveredBy: "Gemini-Grounded",
                source: c.source || "web_search",
              })),
              crowdednessIndex: parsed.crowdednessIndex || "moderate",
              totalFundingInSpace: parsed.totalFundingInSpace || 0,
            }
          })
          .catch((err) => {
            console.warn("Competition fan-out Gemini failed:", err.message)
            return null
          }),
      ]
    : []
  const promises = [...cliPromises, ...geminiPromise]

  const results = (await Promise.allSettled(promises)).map((r) =>
    r.status === "fulfilled" ? r.value : null
  ).filter(Boolean) as NonNullable<Awaited<(typeof promises)[number]>>[]

  if (results.length === 0) {
    throw new Error("All competition models failed")
  }

  // Merge & dedup competitors by normalized name
  // Generate dedup keys: strip non-alphanum, then also try stripping common tech suffixes
  const TECH_SUFFIXES = ["ai", "io", "co", "hq", "app", "labs", "inc", "ltd", "corp"]
  function dedupKeys(name: string): string[] {
    const base = (name || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    if (!base) return []
    const keys = [base]
    for (const s of TECH_SUFFIXES) {
      if (base.endsWith(s) && base.length - s.length >= 5) {
        keys.push(base.slice(0, -s.length))
      }
    }
    return keys
  }

  // Map from any dedup key → canonical key (first seen key for that company)
  const keyMap = new Map<string, string>()
  const seen = new Map<string, Competitor>()
  const confirmedByMap = new Map<string, Set<string>>()
  const hasWebSearch = new Map<string, boolean>()

  for (const r of results) {
    for (const c of r.competitors) {
      const keys = dedupKeys(c.name)
      if (keys.length === 0) continue

      // Find if any key variant already exists
      let canonicalKey: string | undefined
      for (const k of keys) {
        if (keyMap.has(k)) { canonicalKey = keyMap.get(k)!; break }
      }

      if (!canonicalKey) {
        // New company — register all key variants
        canonicalKey = keys[0]
        for (const k of keys) keyMap.set(k, canonicalKey)
        seen.set(canonicalKey, sanitizeCompetitor(c))
        confirmedByMap.set(canonicalKey, new Set(c.discoveredBy ? [c.discoveredBy] : []))
        hasWebSearch.set(canonicalKey, c.source === "web_search")
      } else {
        // Existing company — keep the one with richer data
        const existing = seen.get(canonicalKey)!
        const existingScore = (existing.description?.length || 0) + (existing.topComplaints?.length || 0) * 10
        const newScore = (c.description?.length || 0) + (c.topComplaints?.length || 0) * 10
        if (newScore > existingScore) seen.set(canonicalKey, sanitizeCompetitor(c))
        // Also register any new key variants from the duplicate
        for (const k of keys) if (!keyMap.has(k)) keyMap.set(k, canonicalKey)
        // Track which models confirmed this competitor
        if (c.discoveredBy) confirmedByMap.get(canonicalKey)!.add(c.discoveredBy)
        if (c.source === "web_search") hasWebSearch.set(canonicalKey, true)
      }
    }
  }

  // Stamp confidence fields on each competitor
  for (const [canonicalKey, comp] of seen.entries()) {
    const sources = confirmedByMap.get(canonicalKey) || new Set<string>()
    comp.confirmedBy = Array.from(sources)
    comp.confirmedByCount = sources.size
    comp.confidenceLevel = hasWebSearch.get(canonicalKey)
      ? "web_verified"
      : sources.size >= 2
        ? "multi_confirmed"
        : "ai_inferred"
  }

  // Use most common crowdedness assessment
  const crowdCounts = new Map<string, number>()
  for (const r of results) {
    crowdCounts.set(r.crowdednessIndex, (crowdCounts.get(r.crowdednessIndex) || 0) + 1)
  }
  const crowdednessIndex = Array.from(crowdCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]

  // Sort by similarity, filter low relevance, cap at requested max
  const MIN_SIMILARITY = 40
  let competitors = Array.from(seen.values())
    .filter((c) => (c.similarityScore ?? 0) >= MIN_SIMILARITY)
    .sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0))
    .slice(0, settings.maxCompetitors)

  // Recalculate total funding from filtered competitors only
  const totalFundingInSpace = competitors.reduce((sum, c) => sum + (c.totalFundingUsd || 0), 0)

  console.log(
    `Competition fan-out: ${results.length} models responded, ${competitors.length} competitors (from ${Array.from(seen.values()).length} unique, filtered ≥${MIN_SIMILARITY}% similarity, capped at ${settings.maxCompetitors})`
  )

  return { competitors, crowdednessIndex: crowdednessIndex as any, totalFundingInSpace }
}

// ─── Competitor sanitization ───

function sanitizeCompetitor(raw: any): Competitor {
  // Remove empty/invalid keys (e.g. "":"json" artifacts)
  const cleaned: any = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k && typeof k === "string" && k.length > 0) cleaned[k] = v
  }
  return {
    ...cleaned,
    name: cleaned.name || "Unknown",
    description: cleaned.description || "",
    similarityScore: typeof cleaned.similarityScore === "number" ? cleaned.similarityScore : 50,
    topComplaints: Array.isArray(cleaned.topComplaints) ? cleaned.topComplaints : [],
    keyDifferentiators: Array.isArray(cleaned.keyDifferentiators) ? cleaned.keyDifferentiators : [],
    tags: Array.isArray(cleaned.tags) ? cleaned.tags : [],
    source: cleaned.source || "ai_knowledge",
    websiteStatus: cleaned.websiteStatus || "unknown",
    websiteStatusReason: cleaned.websiteStatusReason || "",
    confirmedBy: Array.isArray(cleaned.confirmedBy) ? cleaned.confirmedBy : [],
    confirmedByCount: typeof cleaned.confirmedByCount === "number" ? cleaned.confirmedByCount : 0,
    confidenceLevel: cleaned.confidenceLevel || "ai_inferred",
  }
}

function finalizeCompetitorConfidence(competitors: Competitor[]): Competitor[] {
  return competitors.map((c) => {
    const confirmedBy = Array.isArray(c.confirmedBy) ? c.confirmedBy : []
    const confirmedByCount = c.confirmedByCount ?? confirmedBy.length
    const websiteStatus = c.websiteStatus || "unknown"
    const websiteStatusReason = c.websiteStatusReason || ""
    const confidenceLevel = websiteStatus === "verified"
      ? "web_verified"
      : confirmedByCount >= 2
        ? "multi_confirmed"
        : "ai_inferred"

    return {
      ...c,
      confirmedBy,
      confirmedByCount,
      websiteStatus,
      websiteStatusReason,
      confidenceLevel,
    }
  })
}

// ─── JSON extraction ───

function extractJSON(text: string): string {
  const trimmed = text.trim()

  // Fast path: already valid JSON
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {}

  // Try jsonrepair on the full text
  try {
    const repaired = jsonrepair(trimmed)
    JSON.parse(repaired)
    return repaired
  } catch {}

  // Extract from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  let raw = codeBlockMatch ? codeBlockMatch[1].trim() : null

  if (!raw) {
    const jsonMatch = trimmed.match(/[\[{][\s\S]*[\]}]/)
    if (jsonMatch) raw = jsonMatch[0]
  }

  if (!raw) throw new Error("No JSON found in response")

  const repaired = jsonrepair(raw)
  JSON.parse(repaired) // validate
  return repaired
}

// ─── Sanitizers: ensure LLM output matches expected shape ───

function sanitizeGapAnalysis(raw: any): GapAnalysis {
  return {
    whiteSpaceOpportunities: Array.isArray(raw.whiteSpaceOpportunities) ? raw.whiteSpaceOpportunities : [],
    commonComplaints: Array.isArray(raw.commonComplaints) ? raw.commonComplaints : [],
    unservedSegments: Array.isArray(raw.unservedSegments) ? raw.unservedSegments : [],
  }
}


function sanitizeDDReport(raw: any): DDReport {
  const data = flattenNumericKeys(raw)
  return {
    ...data,
    idealCustomerProfile: {
      ...data.idealCustomerProfile,
      painPoints: Array.isArray(data.idealCustomerProfile?.painPoints) ? data.idealCustomerProfile.painPoints : [],
    },
    goToMarket: {
      ...data.goToMarket,
      channels: Array.isArray(data.goToMarket?.channels) ? data.goToMarket.channels : [],
    },
    risksMitigations: Array.isArray(data.risksMitigations) ? data.risksMitigations : [],
    strategyCanvas: data.strategyCanvas ? {
      ...data.strategyCanvas,
      competitiveFactors: Array.isArray(data.strategyCanvas.competitiveFactors) ? data.strategyCanvas.competitiveFactors : [],
      blueOceanMoves: Array.isArray(data.strategyCanvas.blueOceanMoves) ? data.strategyCanvas.blueOceanMoves : [],
    } : data.strategyCanvas,
    jobsToBeDone: data.jobsToBeDone ? {
      ...data.jobsToBeDone,
      currentHiredSolutions: Array.isArray(data.jobsToBeDone.currentHiredSolutions) ? data.jobsToBeDone.currentHiredSolutions : [],
      underservedOutcomes: Array.isArray(data.jobsToBeDone.underservedOutcomes) ? data.jobsToBeDone.underservedOutcomes : [],
    } : data.jobsToBeDone,
  }
}

function ddMissingFields(report: DDReport): string[] {
  const missing: string[] = []
  if (!String(report?.wedgeStrategy?.wedge || "").trim()) missing.push("wedgeStrategy.wedge")
  if (!String(report?.wedgeStrategy?.whyThisWorks || "").trim()) missing.push("wedgeStrategy.whyThisWorks")
  if (!String(report?.wedgeStrategy?.firstCustomers || "").trim()) missing.push("wedgeStrategy.firstCustomers")
  if (!String(report?.wedgeStrategy?.expansionPath || "").trim()) missing.push("wedgeStrategy.expansionPath")
  if (!String(report?.tamSamSom?.tam?.value || "").trim()) missing.push("tamSamSom.tam.value")
  if (!String(report?.tamSamSom?.sam?.value || "").trim()) missing.push("tamSamSom.sam.value")
  if (!String(report?.tamSamSom?.som?.value || "").trim()) missing.push("tamSamSom.som.value")
  if (!String(report?.businessModel?.recommendedModel || "").trim()) missing.push("businessModel.recommendedModel")
  if (!String(report?.businessModel?.pricingStrategy || "").trim()) missing.push("businessModel.pricingStrategy")
  if (!String(report?.businessModel?.unitEconomics || "").trim()) missing.push("businessModel.unitEconomics")
  if (!Array.isArray(report?.goToMarket?.channels) || report.goToMarket.channels.length === 0) missing.push("goToMarket.channels")
  if (!Array.isArray(report?.risksMitigations) || report.risksMitigations.length === 0) missing.push("risksMitigations")
  if (!String(report?.jobsToBeDone?.primaryJob || "").trim()) missing.push("jobsToBeDone.primaryJob")
  if (!Array.isArray(report?.strategyCanvas?.blueOceanMoves) || report.strategyCanvas.blueOceanMoves.length === 0) missing.push("strategyCanvas.blueOceanMoves")
  return missing
}

// ─── Pipeline stages ───

export async function extractIntent(ideaText: string): Promise<IntentExtraction> {
  const response = await callLLM(
    INTENT_EXTRACTION_PROMPT,
    `Analyze this startup idea:\n\n"${ideaText}"`,
    1024
  )
  return JSON.parse(extractJSON(response))
}

export async function analyzeCompetition(
  ideaText: string,
  intent: IntentExtraction,
  settings: ScanSettings = DEFAULT_SETTINGS
): Promise<{
  competitors: Competitor[]
  crowdednessIndex: "low" | "moderate" | "high" | "red_ocean"
  totalFundingInSpace: number
}> {
  const depthInstruction = settings.depthLevel === "quick"
    ? "Be concise. Include 3-5 most relevant competitors only."
    : settings.depthLevel === "deep"
      ? `Be exhaustive. Include up to ${settings.maxCompetitors} competitors — direct, indirect, and adjacent players. Provide maximum detail per competitor.`
      : `Include up to ${settings.maxCompetitors} competitors, prioritized by similarity score.`

  const prompt = withWorkflowMode(
    COMPETITIVE_ANALYSIS_PROMPT + `\n\nADDITIONAL INSTRUCTIONS: ${depthInstruction}`,
    settings
  )
  const userMessage = `STARTUP IDEA: "${ideaText}"

EXTRACTED INTENT:
- Vertical: ${intent.vertical}
- Category: ${intent.category}
- Keywords: ${(intent.keywords || []).join(", ")}
- Search queries: ${(intent.searchQueries || []).join("; ")}
- One-liner: ${intent.oneLinerSummary}
- Workflow mode: ${settings.workflowMode || "founder"}`

  const result = await fanOutCompetition(prompt, userMessage, 8192, settings)
  result.competitors = finalizeCompetitorConfidence(await verifyCompetitorWebsites(result.competitors))
  const normalizedCrowdedness = (
    ["low", "moderate", "high", "red_ocean"].includes(result.crowdednessIndex)
      ? result.crowdednessIndex
      : "moderate"
  ) as "low" | "moderate" | "high" | "red_ocean"
  return { ...result, crowdednessIndex: normalizedCrowdedness }
}

export async function analyzeGaps(
  ideaText: string,
  intent: IntentExtraction,
  competitors: Competitor[],
  settings: ScanSettings = DEFAULT_SETTINGS
): Promise<GapAnalysis> {
  const isFastDevMode = isFastScanMode()
  const modelTimeoutMs = isFastDevMode
    ? resolvedTimeout("SCAN_TIMEOUT_FAST_MS", 60_000)
    : resolvedTimeout("SCAN_TIMEOUT_CLIPROXY_MS", 200_000, "cliproxy")
  const geminiTimeoutMs = isFastDevMode
    ? resolvedTimeout("SCAN_TIMEOUT_FAST_MS", 60_000)
    : resolvedTimeout("SCAN_TIMEOUT_GEMINI_MS", 120_000, "gemini")
  const includeGeminiGrounded = process.env.DISABLE_GEMINI_GROUNDED !== "1"

  const competitorSummary = competitors
    .slice(0, 15)
    .map(
      (c) =>
        `- ${c.name} (Similarity: ${c.similarityScore}%, Funding: $${c.totalFundingUsd || "unknown"}): ${c.description}. Complaints: ${(c.topComplaints || []).join("; ")}. Differentiators: ${(c.keyDifferentiators || []).join("; ")}`
    )
    .join("\n")

  const userMessage = `STARTUP IDEA: "${ideaText}"
ONE-LINER: ${intent.oneLinerSummary}
VERTICAL: ${intent.vertical}
WORKFLOW MODE: ${settings.workflowMode || "founder"}

COMPETITIVE LANDSCAPE:
${competitorSummary}`

  // Fan out to 3 models + Gemini, merge gap analyses
  const models = Array.from({ length: 3 }, () => nextModel())
  const cliPromises = [
    ...models.map((m) =>
      callCLIProxy(withWorkflowMode(GAP_ANALYSIS_PROMPT, settings), userMessage, m, 8192, modelTimeoutMs)
        .then((text) => sanitizeGapAnalysis(JSON.parse(extractJSON(text))))
        .catch(() => null)
    ),
  ]
  const geminiPromise = includeGeminiGrounded
    ? [
        withTimeout(
          callGemini(withWorkflowMode(GAP_ANALYSIS_PROMPT, settings), userMessage, 8192, true),
          geminiTimeoutMs,
          "Gemini grounded gaps"
        )
          .then((text) => sanitizeGapAnalysis(JSON.parse(extractJSON(text))))
          .catch(() => null),
      ]
    : []
  const promises = [...cliPromises, ...geminiPromise]

  const results = (await Promise.allSettled(promises))
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean) as GapAnalysis[]

  if (results.length === 0) throw new Error("All gap analysis models failed")
  if (results.length === 1) return results[0]

  // Merge: dedup opportunities, complaints, and segments by normalized name.
  // Rank by impact/frequency and cross-model agreement, then cap to keep output actionable.
  const oppSeen = new Map<string, { item: GapAnalysis["whiteSpaceOpportunities"][number]; votes: number }>()
  for (const r of results) {
    for (const opp of r.whiteSpaceOpportunities || []) {
      const key = (opp.opportunity || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
      if (!key) continue
      const existing = oppSeen.get(key)
      if (!existing) {
        oppSeen.set(key, { item: opp, votes: 1 })
      } else {
        const incomingScore = impactRank(opp.potentialImpact) * 100 + (opp.evidence?.length || 0)
        const existingScore = impactRank(existing.item.potentialImpact) * 100 + (existing.item.evidence?.length || 0)
        if (incomingScore > existingScore) existing.item = opp
        existing.votes += 1
      }
    }
  }
  const complaintSeen = new Map<string, { item: GapAnalysis["commonComplaints"][number]; votes: number }>()
  for (const r of results) {
    for (const c of r.commonComplaints || []) {
      const key = (c.complaint || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
      if (!key) continue
      const existing = complaintSeen.get(key)
      if (!existing) {
        complaintSeen.set(key, { item: c, votes: 1 })
      } else {
        const incomingScore = frequencyRank(c.frequency) * 100 + (c.competitors?.length || 0)
        const existingScore = frequencyRank(existing.item.frequency) * 100 + (existing.item.competitors?.length || 0)
        if (incomingScore > existingScore) existing.item = c
        existing.votes += 1
      }
    }
  }
  const segSeen = new Map<string, { item: GapAnalysis["unservedSegments"][number]; votes: number }>()
  for (const r of results) {
    for (const seg of r.unservedSegments || []) {
      const key = (seg.segment || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
      if (!key) continue
      const existing = segSeen.get(key)
      if (!existing) {
        segSeen.set(key, { item: seg, votes: 1 })
      } else {
        const incomingScore = (seg.description?.length || 0) + (seg.whyUnserved?.length || 0)
        const existingScore = (existing.item.description?.length || 0) + (existing.item.whyUnserved?.length || 0)
        if (incomingScore > existingScore) existing.item = seg
        existing.votes += 1
      }
    }
  }

  console.log(`Gap fan-out: ${results.length} models, ${oppSeen.size} unique opportunities, ${complaintSeen.size} unique complaints, ${segSeen.size} unique segments`)
  return {
    whiteSpaceOpportunities: Array.from(oppSeen.values())
      .sort((a, b) => (impactRank(b.item.potentialImpact) - impactRank(a.item.potentialImpact)) || (b.votes - a.votes))
      .slice(0, 12)
      .map((x) => x.item),
    commonComplaints: Array.from(complaintSeen.values())
      .sort((a, b) => (frequencyRank(b.item.frequency) - frequencyRank(a.item.frequency)) || (b.votes - a.votes))
      .slice(0, 12)
      .map((x) => x.item),
    unservedSegments: Array.from(segSeen.values())
      .sort((a, b) => (b.votes - a.votes) || ((b.item.whyUnserved?.length || 0) - (a.item.whyUnserved?.length || 0)))
      .slice(0, 10)
      .map((x) => x.item),
  }
}

export async function generateDDReport(
  ideaText: string,
  intent: IntentExtraction,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis,
  settings: ScanSettings = DEFAULT_SETTINGS
): Promise<DDReport> {
  const competitorSummary = competitors
    .slice(0, 10)
    .map(
      (c) =>
        `- ${c.name}: ${c.description} | Funding: $${c.totalFundingUsd || "unknown"} (${c.lastFundingType}) | Employees: ${c.employeeCountRange} | Sentiment: ${c.sentimentScore} | Complaints: ${(c.topComplaints || []).join("; ")}`
    )
    .join("\n")

  const gapSummary = (gapAnalysis.whiteSpaceOpportunities || [])
    .map((g) => `- ${g.opportunity} (${g.potentialImpact} impact): ${g.evidence}`)
    .join("\n")

  const basePrompt = withWorkflowMode(DD_REPORT_PROMPT, settings)
  const baseUserMessage = `STARTUP IDEA: "${ideaText}"
ONE-LINER: ${intent.oneLinerSummary}
VERTICAL: ${intent.vertical}
CATEGORY: ${intent.category}
WORKFLOW MODE: ${settings.workflowMode || "founder"}

COMPETITIVE LANDSCAPE (${competitors.length} competitors found):
${competitorSummary}

WHITE SPACE OPPORTUNITIES:
${gapSummary}

UNSERVED SEGMENTS:
${(gapAnalysis.unservedSegments || []).map((s) => `- ${s.segment}: ${s.description} (${s.whyUnserved})`).join("\n")}`

  let lastError: unknown = null
  let missingFromPrevious: string[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await callFirstSuccess(
        basePrompt,
        attempt === 0
          ? baseUserMessage
          : `${baseUserMessage}\n\nIMPORTANT: Your prior response had quality issues. Return ONLY strict valid JSON matching the required schema. Missing or weak fields from prior attempt: ${missingFromPrevious.join(", ") || "unknown"}. Fill all required fields with concrete, specific content.`,
        16384,
        3
      )
      const report = sanitizeDDReport(JSON.parse(extractJSON(response)))
      const missing = ddMissingFields(report)
      if (missing.length === 0) return report
      missingFromPrevious = missing
      throw new Error(`DD report missing required fields: ${missing.join(", ")}`)
    } catch (err) {
      lastError = err
      console.warn(`generateDDReport attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : String(err))
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to generate valid DD report JSON")
}

export async function generatePivots(
  ideaText: string,
  intent: IntentExtraction,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis,
  crowdednessIndex: string,
  settings: ScanSettings = DEFAULT_SETTINGS
): Promise<PivotSuggestion[]> {
  const isFastDevMode = isFastScanMode()
  const modelTimeoutMs = isFastDevMode
    ? resolvedTimeout("SCAN_TIMEOUT_FAST_MS", 60_000)
    : resolvedTimeout("SCAN_TIMEOUT_CLIPROXY_MS", 200_000, "cliproxy")
  const geminiTimeoutMs = isFastDevMode
    ? resolvedTimeout("SCAN_TIMEOUT_FAST_MS", 60_000)
    : resolvedTimeout("SCAN_TIMEOUT_GEMINI_MS", 120_000, "gemini")

  const competitorSummary = competitors
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.name} (${c.similarityScore}% similar, $${c.totalFundingUsd || "?"} raised): ${c.description}. Weaknesses: ${(c.topComplaints || []).join("; ")}`
    )
    .join("\n")

  const gaps = (gapAnalysis.whiteSpaceOpportunities || [])
    .map((g) => `- ${g.opportunity}: ${g.evidence}`)
    .join("\n")

  const userMessage = `STARTUP IDEA: "${ideaText}"
ONE-LINER: ${intent.oneLinerSummary}
VERTICAL: ${intent.vertical}
CROWDEDNESS: ${crowdednessIndex}
WORKFLOW MODE: ${settings.workflowMode || "founder"}

COMPETITORS:
${competitorSummary}

IDENTIFIED GAPS:
${gaps}

UNSERVED SEGMENTS:
${(gapAnalysis.unservedSegments || []).map((s) => `- ${s.segment}: ${s.whyUnserved}`).join("\n")}`

  // Fan out to 3 models + Gemini, merge pivot suggestions
  const models = Array.from({ length: 3 }, () => nextModel())
  const promises = [
    ...models.map((m) =>
      callCLIProxy(withWorkflowMode(PIVOT_SUGGESTIONS_PROMPT, settings), userMessage, m, 4096, modelTimeoutMs)
        .then((text) => {
          const parsed = JSON.parse(extractJSON(text))
          return ((parsed.pivotSuggestions || parsed) as PivotSuggestion[]).map((p) => ({
            ...p,
            suggestedBy: m.label,
          }))
        })
        .catch(() => null)
    ),
    withTimeout(
      callGemini(withWorkflowMode(PIVOT_SUGGESTIONS_PROMPT, settings), userMessage, 4096),
      geminiTimeoutMs,
      "Gemini pivots"
    )
      .then((text) => {
        const parsed = JSON.parse(extractJSON(text))
        return ((parsed.pivotSuggestions || parsed) as PivotSuggestion[]).map((p) => ({
          ...p,
          suggestedBy: "Gemini",
        }))
      })
      .catch(() => null),
  ]

  const results = (await Promise.allSettled(promises))
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean) as PivotSuggestion[][]

  if (results.length === 0) throw new Error("All pivot models failed")

  // Merge: dedup by normalized pivot name and rank by consensus + execution feasibility.
  const seen = new Map<string, { item: PivotSuggestion; votes: number }>()
  for (const pivots of results) {
    for (const p of pivots) {
      const key = (p.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
      if (!key) continue
      const existing = seen.get(key)
      if (!existing) {
        seen.set(key, { item: p, votes: 1 })
      } else {
        const difficultyScore = (x: string) => (x === "low" ? 3 : x === "medium" ? 2 : 1)
        const incomingScore = difficultyScore(p.difficulty) * 100 + (p.whyItWorks?.length || 0)
        const existingScore = difficultyScore(existing.item.difficulty) * 100 + (existing.item.whyItWorks?.length || 0)
        if (incomingScore > existingScore) existing.item = p
        existing.votes += 1
      }
    }
  }

  console.log(`Pivot fan-out: ${results.length} models, ${seen.size} unique pivots`)
  return Array.from(seen.values())
    .sort((a, b) => (b.votes - a.votes) || ((a.item.difficulty === "low" ? 0 : a.item.difficulty === "medium" ? 1 : 2) - (b.item.difficulty === "low" ? 0 : b.item.difficulty === "medium" ? 1 : 2)))
    .slice(0, 8)
    .map((x) => x.item)
}

export async function generateVerticalMap(
  verticalName: string,
  verticalDescription: string
): Promise<{
  schemaVersion: number
  totalPlayers: number
  totalFunding: string
  overallCrowdedness: number
  averageOpportunity: number
  megaCategories: import("@/lib/types").MegaCategoryDef[]
  strategyCanvasFactors: string[]
  subCategories: import("@/lib/types").SubCategory[]
}> {
  const response = await callFirstSuccess(
    VERTICAL_MAP_PROMPT,
    `Generate a comprehensive landscape map for this vertical:\n\nVERTICAL: ${verticalName}\nDESCRIPTION: ${verticalDescription}`,
    65536,
    3
  )
  return JSON.parse(extractJSON(response))
}

export async function enrichSubCategory(
  verticalName: string,
  subCategory: SubCategory,
  strategyCanvasFactors: string[]
): Promise<{ newPlayers: SubCategoryPlayer[]; updatedPlayers: SubCategoryPlayer[] }> {
  const existingNames = subCategory.topPlayers.map((p) => p.name).join(", ")

  const response = await callLLM(
    SUBCATEGORY_ENRICH_PROMPT,
    `VERTICAL: ${verticalName}

SUB-CATEGORY: ${subCategory.name}
DESCRIPTION: ${subCategory.description}
KEY GAPS: ${subCategory.keyGaps.join("; ")}

STRATEGY CANVAS FACTORS (use these exact factor names): ${strategyCanvasFactors.join(", ")}

EXISTING PLAYERS (do NOT re-list these as new):
${existingNames}

Find additional players in this sub-category that are NOT in the existing list above.`,
    16384
  )

  return JSON.parse(extractJSON(response))
}
