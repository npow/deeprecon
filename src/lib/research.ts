/**
 * Parallel Multi-Provider Research Engine
 *
 * Fans out the same structured query to multiple AI providers via CLIProxyAPI,
 * collects results, and merges/deduplicates them for maximum coverage.
 *
 * Usage:
 *   import { parallelResearch, mergePlayerLists, DEFAULT_PROVIDERS } from "@/lib/research"
 *
 *   const { results, errors } = await parallelResearch<MyType>({
 *     systemPrompt: "...",
 *     userMessage: "...",
 *   })
 */

// ─── Provider Configuration ───

export interface ResearchProvider {
  id: string
  model: string
  label: string
  maxTokens: number
}

export const DEFAULT_PROVIDERS: ResearchProvider[] = [
  // Claude (best-in-class reasoning)
  { id: "claude-opus-4-6", model: "claude-opus-4-6", label: "Claude Opus 4.6", maxTokens: 16384 },
  { id: "claude-sonnet-4-5", model: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", maxTokens: 16384 },
  // OpenAI (different training data + reasoning)
  { id: "gpt-5", model: "gpt-5", label: "GPT-5", maxTokens: 32768 },
  { id: "gpt-5.2", model: "gpt-5.2", label: "GPT-5.2", maxTokens: 32768 },
  // DeepSeek (strong open-source, different knowledge base)
  { id: "deepseek-v3.2", model: "deepseek-v3.2", label: "DeepSeek V3.2", maxTokens: 16384 },
  // Qwen (Alibaba — strong on intl/Asian companies)
  { id: "qwen3-max", model: "qwen3-max", label: "Qwen 3 Max", maxTokens: 16384 },
  // Kimi (Moonshot — different coverage)
  { id: "kimi-k2.5", model: "kimi-k2.5", label: "Kimi K2.5", maxTokens: 16384 },
  // GLM (Zhipu — strong on Chinese tech ecosystem)
  { id: "glm-4.7", model: "glm-4.7", label: "GLM 4.7", maxTokens: 16384 },
  // Gemini (Google — highest token limits, strong knowledge)
  { id: "gemini-3-pro", model: "gemini-3-pro-preview", label: "Gemini 3 Pro", maxTokens: 65536 },
  { id: "gemini-2.5-pro", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro", maxTokens: 65536 },
  { id: "gemini-2.5-flash", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", maxTokens: 65536 },
]

const CLIPROXY_BASE = process.env.CLIPROXY_URL || "http://localhost:8317"
const CLIPROXY_KEY = process.env.CLIPROXY_API_KEY || "your-api-key-1"

// ─── Model discovery ───

/** Cached set of model IDs available on the CLIProxyAPI instance */
let availableModelsCache: Set<string> | null = null
let availableModelsCacheTime = 0
const CACHE_TTL_MS = 60_000 // refresh every 60s

/**
 * Queries CLIProxyAPI's /v1/models endpoint and returns the set of available model IDs.
 * Caches for 60s to avoid hammering the endpoint.
 */
export async function fetchAvailableModels(): Promise<Set<string>> {
  if (availableModelsCache && Date.now() - availableModelsCacheTime < CACHE_TTL_MS) {
    return availableModelsCache
  }

  try {
    const res = await fetch(`${CLIPROXY_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${CLIPROXY_KEY}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    const models = new Set<string>()
    // OpenAI-compatible format: { data: [{ id: "model-name", ... }] }
    for (const m of data.data || data.models || []) {
      const id = typeof m === "string" ? m : m.id || m.name
      if (id) models.add(id)
    }
    availableModelsCache = models
    availableModelsCacheTime = Date.now()
    return models
  } catch {
    // If we can't reach CLIProxyAPI, return empty — callers handle gracefully
    return availableModelsCache || new Set()
  }
}

/**
 * Returns only the DEFAULT_PROVIDERS whose model is actually available
 * on the running CLIProxyAPI instance. Call this before fanning out.
 */
export async function getAvailableProviders(): Promise<ResearchProvider[]> {
  const models = await fetchAvailableModels()
  if (models.size === 0) return [] // CLIProxyAPI not reachable

  return DEFAULT_PROVIDERS.filter((p) => models.has(p.model))
}

// ─── Low-level provider call ───

export interface ProviderProgress {
  phase: "connecting" | "generating" | "parsing"
  tokens: number
}

async function callProvider(
  provider: ResearchProvider,
  systemPrompt: string,
  userMessage: string,
  timeoutMs: number,
  onProgress?: (progress: ProviderProgress) => void,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    onProgress?.({ phase: "connecting", tokens: 0 })

    const res = await fetch(`${CLIPROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLIPROXY_KEY}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: provider.maxTokens,
        temperature: 0.3,
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
    }

    // Stream the response — accumulate content, emit token progress
    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""
    let content = ""
    let tokenCount = 0

    onProgress?.({ phase: "generating", tokens: 0 })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith("data: ")) continue
        const payload = trimmed.slice(6)
        if (payload === "[DONE]") continue

        try {
          const chunk = JSON.parse(payload)
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) {
            content += delta
            tokenCount++
            // Throttle progress updates — emit every 10 tokens
            if (tokenCount % 10 === 0) {
              onProgress?.({ phase: "generating", tokens: tokenCount })
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Final progress before returning
    onProgress?.({ phase: "generating", tokens: tokenCount })

    if (!content) throw new Error("Empty response from provider")
    return content
  } finally {
    clearTimeout(timer)
  }
}

// ─── JSON extraction (robust — handles markdown fences, trailing commas) ───

export function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  let raw = codeBlockMatch ? codeBlockMatch[1].trim() : null

  if (!raw) {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) raw = jsonMatch[0]
  }

  if (!raw) throw new Error("No JSON found in response")
  raw = raw.replace(/,\s*([}\]])/g, "$1")
  return raw
}

// ─── Concurrency limiter ───

function semaphore(max: number) {
  let active = 0
  const queue: (() => void)[] = []

  return {
    async acquire() {
      if (active < max) {
        active++
        return
      }
      await new Promise<void>((resolve) => queue.push(resolve))
    },
    release() {
      active--
      const next = queue.shift()
      if (next) {
        active++
        next()
      }
    },
  }
}

// ─── Core: Parallel Research ───

export interface ProviderResult<T> {
  provider: string
  label: string
  data: T
  durationMs: number
}

export interface ProviderError {
  provider: string
  label: string
  error: string
}

export interface ParallelResearchResult<T> {
  results: ProviderResult<T>[]
  errors: ProviderError[]
  totalDurationMs: number
}

export async function parallelResearch<T>(opts: {
  systemPrompt: string
  userMessage: string
  providers?: ResearchProvider[]
  timeoutMs?: number
  concurrency?: number
  onStart?: (provider: string) => void
  onProgress?: (provider: string, progress: ProviderProgress) => void
  onResult?: (provider: string, data: T, durationMs: number) => void
  onError?: (provider: string, error: string) => void
}): Promise<ParallelResearchResult<T>> {
  const providers = opts.providers || DEFAULT_PROVIDERS
  const timeoutMs = opts.timeoutMs || 300_000 // 5 min default
  const sem = semaphore(opts.concurrency || providers.length) // default: all parallel
  const start = Date.now()

  const results: ProviderResult<T>[] = []
  const errors: ProviderError[] = []

  await Promise.allSettled(
    providers.map(async (p) => {
      await sem.acquire()
      opts.onStart?.(p.id)
      const pStart = Date.now()
      try {
        const raw = await callProvider(
          p, opts.systemPrompt, opts.userMessage, timeoutMs,
          opts.onProgress ? (progress) => opts.onProgress!(p.id, progress) : undefined,
        )
        opts.onProgress?.(p.id, { phase: "parsing", tokens: 0 })
        const json = extractJSON(raw)
        const data = JSON.parse(json) as T
        const dur = Date.now() - pStart
        results.push({ provider: p.id, label: p.label, data, durationMs: dur })
        opts.onResult?.(p.id, data, dur)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        errors.push({ provider: p.id, label: p.label, error: msg })
        opts.onError?.(p.id, msg)
      } finally {
        sem.release()
      }
    }),
  )

  return { results, errors, totalDurationMs: Date.now() - start }
}

// ─── Merge utilities ───

/** Normalize a company name for fuzzy matching */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Normalize a subcategory slug/name for matching across providers */
export function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export interface PlayerLike {
  name: string
  oneLiner: string
  funding: string
  stage: string
  executionScore: number
  visionScore: number
  competitiveFactors: { factor: string; score: number }[]
}

/**
 * Merge player lists from multiple providers.
 * Deduplicates by normalized name, averages numeric scores,
 * prefers the entry with the longest oneLiner (more detail).
 */
export function mergePlayerLists<T extends PlayerLike>(
  ...lists: T[][]
): { merged: T[]; totalFromProviders: number } {
  const byName = new Map<string, { entries: T[]; key: string }>()
  let totalFromProviders = 0

  for (const list of lists) {
    for (const player of list) {
      totalFromProviders++
      const key = normalizeName(player.name)
      if (!key) continue
      const existing = byName.get(key)
      if (existing) {
        existing.entries.push(player)
      } else {
        byName.set(key, { entries: [player], key })
      }
    }
  }

  const merged: T[] = []
  for (const { entries } of byName.values()) {
    if (entries.length === 1) {
      merged.push(entries[0])
      continue
    }

    // Pick the "richest" base entry (longest oneLiner = most detail)
    const base = { ...entries.reduce((a, b) =>
      (a.oneLiner?.length || 0) >= (b.oneLiner?.length || 0) ? a : b
    ) }

    // Average numeric scores across providers
    base.executionScore = Math.round(
      entries.reduce((s, e) => s + (e.executionScore || 0), 0) / entries.length,
    )
    base.visionScore = Math.round(
      entries.reduce((s, e) => s + (e.visionScore || 0), 0) / entries.length,
    )

    // Merge competitive factors — average scores for matching factors
    if (base.competitiveFactors?.length) {
      const factorScores = new Map<string, number[]>()
      for (const entry of entries) {
        for (const cf of entry.competitiveFactors || []) {
          const key = cf.factor.toLowerCase()
          if (!factorScores.has(key)) factorScores.set(key, [])
          factorScores.get(key)!.push(cf.score)
        }
      }
      base.competitiveFactors = Array.from(factorScores.entries()).map(
        ([factor, scores]) => ({
          factor: base.competitiveFactors.find(
            (cf) => cf.factor.toLowerCase() === factor,
          )?.factor || factor,
          score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        }),
      )
    }

    merged.push(base as T)
  }

  return { merged, totalFromProviders }
}

export interface SubCategoryLike {
  slug: string
  name: string
  description: string
  crowdednessScore: number
  opportunityScore: number
  playerCount: number
  totalFunding: string
  trendDirection: string
  topPlayers: PlayerLike[]
  keyGaps: string[]
  deepDivePrompt: string
  megaCategory: string
}

/**
 * Merge vertical maps from multiple providers.
 * Unions subcategories (matching by normalized slug), merges players within each.
 */
export function mergeSubCategories<T extends SubCategoryLike>(
  ...maps: T[][]
): T[] {
  const bySlug = new Map<string, { entries: T[]; slug: string }>()

  for (const subs of maps) {
    for (const sub of subs) {
      const key = normalizeSlug(sub.slug || sub.name)
      const existing = bySlug.get(key)
      if (existing) {
        existing.entries.push(sub)
      } else {
        bySlug.set(key, { entries: [sub], slug: key })
      }
    }
  }

  const merged: T[] = []
  for (const { entries } of bySlug.values()) {
    // Use the entry with the longest description as base
    const base = { ...entries.reduce((a, b) =>
      (a.description?.length || 0) >= (b.description?.length || 0) ? a : b
    ) }

    // Merge all players
    const allPlayerLists = entries.map((e) => e.topPlayers || [])
    const { merged: mergedPlayers } = mergePlayerLists(...allPlayerLists)
    base.topPlayers = mergedPlayers
    base.playerCount = mergedPlayers.length

    // Union key gaps
    const gapSet = new Set<string>()
    for (const entry of entries) {
      for (const gap of entry.keyGaps || []) {
        gapSet.add(gap)
      }
    }
    base.keyGaps = Array.from(gapSet).slice(0, 5)

    // Average scores
    base.crowdednessScore = Math.round(
      entries.reduce((s, e) => s + (e.crowdednessScore || 0), 0) / entries.length,
    )
    base.opportunityScore = Math.round(
      entries.reduce((s, e) => s + (e.opportunityScore || 0), 0) / entries.length,
    )

    merged.push(base as T)
  }

  // Sort by opportunity score descending
  merged.sort((a, b) => b.opportunityScore - a.opportunityScore)
  return merged
}
