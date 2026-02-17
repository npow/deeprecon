#!/usr/bin/env node
/**
 * enrich-agents.mjs — Multi-agent research system for exhaustive market enrichment.
 *
 * Architecture (inspired by Anthropic's multi-agent research system):
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │                   ORCHESTRATOR                       │
 *   │  Picks next subcategory, manages budget, decides     │
 *   │  when a subcategory is "saturated"                   │
 *   └──────────┬──────────────────────────┬───────────────┘
 *              │                          │
 *     ┌────────▼────────┐       ┌────────▼────────┐
 *     │  PHASE 1: SWEEP │       │  (parallel       │
 *     │  Broad discovery │       │   subcategories) │
 *     │  across models   │       └─────────────────┘
 *     └────────┬────────┘
 *              │ merge
 *     ┌────────▼────────┐
 *     │  PHASE 2: GAPS  │  Fast model analyzes coverage gaps
 *     │  Gap analysis    │  Produces targeted search angles
 *     └────────┬────────┘
 *              │
 *     ┌────────▼────────┐
 *     │  PHASE 3: FILL  │  Targeted searches dispatched to
 *     │  Deep fills      │  specialist models per angle
 *     └────────┬────────┘
 *              │ merge
 *     ┌────────▼────────┐
 *     │  PHASE 4: VERIFY│  Optional — cross-check surprising
 *     │  Cross-check     │  findings with a different model
 *     └────────┬────────┘
 *              │
 *           save to disk
 *
 * Improvements over flat enrichment:
 *   - Progressive narrowing: broad sweep → gap analysis → targeted fills
 *   - Provider specialization: Gemini gets web search, Qwen gets APAC angle,
 *     DeepSeek gets Chinese tech, Claude gets analysis
 *   - Multi-turn per worker: follow-up "what did you miss?" prompts
 *   - Smart scheduling: prioritize subcategories with fewest players
 *   - Cross-pollination: feed provider A's unique finds as hints to provider B
 *   - Saturation detection: stop enriching when diminishing returns detected
 *
 * Usage:
 *   node scripts/enrich-agents.mjs [--hours 4] [--subcategory-concurrency 3] [--slug ai-ml]
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const MAPS_DIR = path.join(ROOT, "data", "maps")

// ─── Config ───

const CLIPROXY_BASE = process.env.CLIPROXY_URL || "http://localhost:8317"
const CLIPROXY_KEY = process.env.CLIPROXY_API_KEY || "your-api-key-1"

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const HOURS = parseFloat(flag("hours", "4"))
const SUB_CONCURRENCY = parseInt(flag("subcategory-concurrency", "2"), 10)
const SLUG_FILTER = flag("slug", "")
const DEADLINE = Date.now() + HOURS * 3600_000
const startTime = Date.now()

// ─── Models & Families ───

// Model selection rationale:
//   - Claude: all 3 tiers. No rate issues. Opus=analyst, Sonnet=sweep, Haiku=fast gap analysis.
//   - OpenAI: GPT-5 only. Severe 429s — 3 models at c=2 is wasteful, 1 strong model at c=1.
//   - Gemini: all 4. MVP — web search grounding, high token limits, rarely rate-limited.
//   - DeepSeek: v3.2 only. 449s at c=1 with 2 models, keep best model.
//   - Qwen: qwen3-max only. Best model, 449s frequent. QwenCoder+ was good but shares limit.
//   - Kimi: k2.5 only. Slow but unique APAC coverage.
//   - GLM: 4.7 only. Slow but unique Chinese tech coverage.
//   - Minimax: dropped. Constant 449s, no unique coverage to justify.

const MODELS = [
  // Claude — reliable, no rate issues. Best for analysis + structured output.
  { id: "claude-opus-4-6",       model: "claude-opus-4-6",            label: "Opus4.6",     maxTokens: 16384, family: "claude",   role: "analyst" },
  { id: "claude-sonnet-4-5",     model: "claude-sonnet-4-5-20250929", label: "Sonnet4.5",   maxTokens: 16384, family: "claude",   role: "sweep" },
  { id: "claude-haiku-4-5",      model: "claude-haiku-4-5-20251001",  label: "Haiku4.5",    maxTokens: 8192,  family: "claude",   role: "fast" },
  // OpenAI — 1 best model to avoid 429 storms
  { id: "gpt-5",                 model: "gpt-5",                      label: "GPT5",        maxTokens: 32768, family: "openai",   role: "sweep" },
  // Gemini — web search grounded MVP. High token limits, best throughput.
  { id: "gemini-3-pro",          model: "gemini-3-pro-preview",       label: "Gem3Pro",     maxTokens: 65536, family: "gemini",   role: "web-research" },
  { id: "gemini-3-flash",        model: "gemini-3-flash-preview",     label: "Gem3Flash",   maxTokens: 65536, family: "gemini",   role: "web-research" },
  { id: "gemini-2.5-pro",        model: "gemini-2.5-pro",             label: "Gem2.5P",     maxTokens: 65536, family: "gemini",   role: "web-research" },
  { id: "gemini-2.5-flash",      model: "gemini-2.5-flash",           label: "Gem2.5F",     maxTokens: 65536, family: "gemini",   role: "web-research" },
  // DeepSeek — best model only. Chinese tech + general knowledge.
  { id: "deepseek-v3.2",         model: "deepseek-v3.2",              label: "DSv3.2",      maxTokens: 16384, family: "deepseek", role: "apac-specialist" },
  // Qwen — best model only. Alibaba, strong on APAC companies.
  { id: "qwen3-max",             model: "qwen3-max",                  label: "Qwen3Max",    maxTokens: 16384, family: "qwen",     role: "apac-specialist" },
  // Kimi — unique Moonshot coverage
  { id: "kimi-k2.5",             model: "kimi-k2.5",                  label: "Kimi2.5",     maxTokens: 16384, family: "kimi",     role: "apac-specialist" },
  // GLM — unique Zhipu/Chinese tech coverage
  { id: "glm-4.7",               model: "glm-4.7",                    label: "GLM4.7",      maxTokens: 16384, family: "glm",      role: "apac-specialist" },
]

const FAMILY_CONCURRENCY = {
  claude:   3,  // 3 models, no rate issues
  openai:   1,  // 1 model, severe 429s
  gemini:   4,  // 4 models, best throughput
  deepseek: 1,  // 1 model, frequent 449s
  qwen:     1,  // 1 model, frequent 449s
  kimi:     1,  // 1 model, frequent 449s
  glm:      1,  // 1 model, frequent 449s
}

// ─── Utilities ───

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function normalizeName(n) { return n.toLowerCase().replace(/[^a-z0-9]/g, "") }

function ts() {
  const e = ((Date.now() - startTime) / 60_000).toFixed(1)
  const r = Math.max(0, (DEADLINE - Date.now()) / 60_000).toFixed(0)
  return `[${e}m +${r}m]`
}
function log(msg) { console.log(`${ts()} ${msg}`) }

// ─── Semaphore ───

function makeSemaphore(max) {
  let active = 0
  const queue = []
  return {
    async acquire() {
      if (active < max) { active++; return }
      await new Promise(r => queue.push(r))
    },
    release() {
      active--
      const next = queue.shift()
      if (next) { active++; next() }
    },
    get active() { return active },
  }
}

// ─── Per-family state ───

const familyState = new Map()
const modelState = new Map()

function getFS(family) {
  if (!familyState.has(family)) {
    familyState.set(family, {
      sem: makeSemaphore(FAMILY_CONCURRENCY[family] || 2),
      backoffUntil: 0,
    })
  }
  return familyState.get(family)
}

function getMS(model) {
  if (!modelState.has(model.id)) {
    modelState.set(model.id, {
      noStream: false,
      dead: false,
      consecutiveErrors: 0,
      stats: { calls: 0, ok: 0, errors: 0, retries: 0, playersFound: 0 },
    })
  }
  return modelState.get(model.id)
}

// ─── Backoff ───

const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 120_000
function backoffDelay(attempt) {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS)
  return Math.max(500, exp + exp * 0.5 * (2 * Math.random() - 1))
}

// ─── LLM call (single attempt) ───

async function callOnce(model, systemPrompt, userMessage, timeoutMs, useStream) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${CLIPROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CLIPROXY_KEY}` },
      body: JSON.stringify({
        model: model.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: model.maxTokens,
        temperature: 0.3,
        ...(useStream ? { stream: true } : {}),
        ...(model.family === "gemini" ? { tools: [{ google_search_retrieval: {} }] } : {}),
      }),
      signal: controller.signal,
    })

    if (res.status === 406 && useStream) { await res.text().catch(() => {}); return { switchNoStream: true } }
    if (res.status === 429 || res.status >= 500) {
      const body = await res.text().catch(() => "")
      return { retryable: true, reason: `HTTP ${res.status}`, detail: body.slice(0, 100) }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { fatal: true, reason: `HTTP ${res.status}: ${body.slice(0, 150)}` }
    }

    if (!useStream) {
      const data = await res.json()
      if (data.status === "449" || data.status === 449 || data.msg?.includes("rate limit"))
        return { retryable: true, reason: "rate-limited (449)" }
      if (data.error) return { retryable: true, reason: `proxy: ${(data.error.message || JSON.stringify(data.error)).slice(0, 100)}` }
      const content = data.choices?.[0]?.message?.content || ""
      return content ? { content } : { retryable: true, reason: "empty" }
    }

    const reader = res.body?.getReader()
    if (!reader) return { retryable: true, reason: "no body" }
    const dec = new TextDecoder()
    let buf = "", content = "", rawFirst = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = dec.decode(value, { stream: true })
      buf += chunk
      if (rawFirst.length < 500) rawFirst += chunk
      const lines = buf.split("\n"); buf = lines.pop() || ""
      for (const ln of lines) {
        const t = ln.trim()
        if (!t.startsWith("data: ")) continue
        const p = t.slice(6)
        if (p === "[DONE]") continue
        try { const c = JSON.parse(p); const d = c.choices?.[0]?.delta?.content; if (d) content += d } catch {}
      }
    }
    if (!content) {
      try {
        const e = JSON.parse(rawFirst.trim())
        if (e.status === "449" || e.msg?.includes("rate limit")) return { retryable: true, reason: "rate-limited (449)" }
        if (e.error) return { retryable: true, reason: `proxy: ${(e.error.message || "").slice(0, 100)}` }
      } catch {}
      return { retryable: true, reason: "empty stream" }
    }
    return { content }
  } catch (err) {
    if (err.name === "AbortError") return { retryable: true, reason: "timeout" }
    return { retryable: true, reason: err.message }
  } finally { clearTimeout(timer) }
}

// ─── LLM call with retry ───

const MAX_RETRIES = 4

async function callModel(model, systemPrompt, userMessage, timeoutMs = 300_000) {
  const ms = getMS(model)
  const fs_ = getFS(model.family)
  if (ms.dead) throw new Error("dead")

  if (fs_.backoffUntil > Date.now()) await sleep(fs_.backoffUntil - Date.now())

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (Date.now() >= DEADLINE) throw new Error("deadline")
    ms.stats.calls++
    const r = await callOnce(model, systemPrompt, userMessage, timeoutMs, !ms.noStream)

    if (r.content) { ms.consecutiveErrors = 0; fs_.backoffUntil = 0; ms.stats.ok++; return r.content }
    if (r.switchNoStream) { ms.noStream = true; attempt--; continue }
    if (r.fatal) { ms.consecutiveErrors++; if (ms.consecutiveErrors >= 3) { ms.dead = true; log(`  💀 ${model.label} dead`) }; throw new Error(r.reason) }

    if (attempt < MAX_RETRIES) {
      ms.stats.retries++
      const delay = backoffDelay(attempt)
      if (r.reason.includes("rate-limited") || r.reason.includes("429")) fs_.backoffUntil = Math.max(fs_.backoffUntil, Date.now() + delay)
      if (attempt >= 1) log(`  ⏳ ${model.label}: ${r.reason}, ${(delay/1000).toFixed(0)}s (${attempt+1})`)
      await sleep(delay)
    } else { ms.consecutiveErrors++; ms.stats.errors++; throw new Error(r.reason) }
  }
}

// ─── JSON extraction ───

function extractJSON(text) {
  const m1 = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  let raw = m1 ? m1[1].trim() : null
  if (!raw) { const m2 = text.match(/\{[\s\S]*\}/); if (m2) raw = m2[0] }
  if (!raw) throw new Error("no JSON")
  raw = raw.replace(/,\s*([}\]])/g, "$1")
  return JSON.parse(raw)
}

// ─── Map file I/O (with locking) ───

const mapLocks = new Map()
async function withMapLock(slug, fn) {
  while (mapLocks.get(slug)) await sleep(10)
  mapLocks.set(slug, true)
  try { return fn() } finally { mapLocks.set(slug, false) }
}

function readSub(mapSlug, subSlug) {
  const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${mapSlug}.json`), "utf-8"))
  const sub = map.subCategories.find(s => s.slug === subSlug)
  return { map, sub }
}

function mergePlayers(existing, newPlayers) {
  const byName = new Map()
  for (const p of existing) { const k = normalizeName(p.name); if (k) byName.set(k, p) }
  let added = 0
  for (const p of newPlayers) {
    const k = normalizeName(p.name)
    if (!k) continue
    if (byName.has(k)) {
      const ex = byName.get(k)
      if (p.executionScore && ex.executionScore) ex.executionScore = Math.round((ex.executionScore + p.executionScore) / 2)
      if (p.visionScore && ex.visionScore) ex.visionScore = Math.round((ex.visionScore + p.visionScore) / 2)
      if ((p.oneLiner?.length || 0) > (ex.oneLiner?.length || 0)) ex.oneLiner = p.oneLiner
    } else { byName.set(k, p); added++ }
  }
  return { merged: Array.from(byName.values()), added }
}

function saveSubPlayers(mapSlug, subSlug, players) {
  const mapPath = path.join(MAPS_DIR, `${mapSlug}.json`)
  const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"))
  const idx = map.subCategories.findIndex(s => s.slug === subSlug)
  if (idx === -1) return 0
  const sub = map.subCategories[idx]
  const { merged, added } = mergePlayers(sub.topPlayers, players)
  sub.topPlayers = merged
  sub.playerCount = merged.length
  sub.lastEnrichedAt = new Date().toISOString()
  map.totalPlayers = map.subCategories.reduce((s, sc) => s + (sc.playerCount || sc.topPlayers.length), 0)
  map.lastEnrichedAt = new Date().toISOString()
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2))
  return added
}

// ─── Prompts ───

const SWEEP_SYSTEM = `You are a senior market analyst. Your job is to find EVERY company in a specific market sub-category.

Be EXHAUSTIVE. List ALL players you know about:
- Funded startups (pre-seed through IPO)
- Bootstrapped / self-funded companies
- Open-source projects with commercial backing
- Enterprise incumbents & large tech companies with products here
- International companies (Europe, Asia, LATAM, Africa, MENA)
- Very early stage / stealth / accelerator companies
- Acquired companies that were notable in this space
- Tangentially related tools that compete for the same budget

For each player provide:
- name, oneLiner, funding, stage, executionScore (0-100), visionScore (0-100)
- competitiveFactors: [{ factor, score (1-10) }] matching the given factors

CRITICAL: Do NOT list any company in the EXISTING list. There is NO LIMIT on how many to return — 30, 50, 80+ is great.

Return JSON: { "newPlayers": [<players>] }`

const GAP_SYSTEM = `You are a research coordinator analyzing coverage gaps in a market database.

Given a sub-category and its current player list, identify what's MISSING. Think about:
1. Geographic gaps — which regions have no/few companies listed?
2. Funding stage gaps — are early-stage or late-stage companies underrepresented?
3. Technology approach gaps — are certain technical approaches missing?
4. Business model gaps — open-source, API-first, vertical-specific, platform, etc.?
5. Customer segment gaps — SMB tools vs enterprise vs developer-focused?
6. Historical gaps — notable acquired/defunct companies missing?

Return JSON:
{
  "gaps": [
    {
      "angle": "short name for this gap",
      "description": "what to search for",
      "suggestedQuery": "a specific search prompt to find these companies",
      "priority": "high" | "medium" | "low"
    }
  ],
  "saturationEstimate": 0-100,
  "totalEstimatedPlayers": number
}`

const FILL_SYSTEM = `You are a specialist researcher filling a specific gap in a market database.

You are given a TARGETED search angle. Find companies that match this specific angle.
Be thorough for this particular niche — this is a deep dive, not a broad sweep.

For each player provide:
- name, oneLiner, funding, stage, executionScore (0-100), visionScore (0-100)
- competitiveFactors: [{ factor, score (1-10) }] matching the given factors

CRITICAL: Do NOT list any company already in the EXISTING list.
Return JSON: { "newPlayers": [<players>] }`

// ─── Model selection by role ───

function getModelsForRole(role) {
  return MODELS.filter(m => !getMS(m).dead && m.role === role)
}

function getLiveModels() {
  return MODELS.filter(m => !getMS(m).dead)
}

function pickModel(preference) {
  // preference: "fast" | "analyst" | "web-research" | "apac-specialist" | "sweep" | "any"
  let candidates = getModelsForRole(preference)
  if (!candidates.length) candidates = getLiveModels()
  if (!candidates.length) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function pickModelsForSweep(count = 5) {
  // Pick a diverse but small set to avoid rate limit storms
  const live = getLiveModels()
  if (!live.length) return []

  const selected = new Set()
  const pick = (role) => {
    const cands = live.filter(m => m.role === role && !selected.has(m.id))
    if (cands.length) { const m = cands[Math.floor(Math.random() * cands.length)]; selected.add(m.id); return m }
    return null
  }

  // Core: 2 web-research (Gemini), 1 analyst (Claude), 1 sweep, 1 apac
  pick("web-research")
  pick("web-research")
  pick("analyst")
  pick("sweep")
  pick("apac-specialist")

  // Fill remaining
  while (selected.size < Math.min(count, live.length)) {
    const remaining = live.filter(m => !selected.has(m.id))
    if (!remaining.length) break
    const m = remaining[Math.floor(Math.random() * remaining.length)]
    selected.add(m.id)
  }

  return [...selected].map(id => MODELS.find(m => m.id === id))
}

// ─── Dispatch: call model with family semaphore ───

async function dispatch(model, systemPrompt, userMessage, timeoutMs) {
  const fs_ = getFS(model.family)
  await fs_.sem.acquire()
  try {
    return await callModel(model, systemPrompt, userMessage, timeoutMs)
  } finally {
    fs_.sem.release()
  }
}

// ─── PHASE 1: Broad Sweep ───

async function phaseSweep(target) {
  const models = pickModelsForSweep(8)
  if (!models.length) return []

  const userMsg = `VERTICAL: ${target.mapName}
SUB-CATEGORY: ${target.subName}
DESCRIPTION: ${target.subDesc}
KEY GAPS: ${target.keyGaps.join("; ")}
STRATEGY CANVAS FACTORS: ${target.factors.join(", ")}

EXISTING PLAYERS (do NOT re-list):
${target.existingNames}

Find ALL additional players. Be EXHAUSTIVE — list every company you know in this space.`

  const results = await Promise.allSettled(
    models.map(async m => {
      const raw = await dispatch(m, SWEEP_SYSTEM, userMsg, 300_000)
      const data = extractJSON(raw)
      const players = data.newPlayers || []
      getMS(m).stats.playersFound += players.length
      return { model: m.label, players, family: m.family }
    })
  )

  const allPlayers = []
  let successCount = 0
  for (const r of results) {
    if (r.status === "fulfilled") {
      successCount++
      allPlayers.push(...r.value.players)
    }
  }

  log(`    Phase 1 (sweep): ${allPlayers.length} raw players from ${successCount}/${models.length} models`)
  return allPlayers
}

// ─── PHASE 2: Gap Analysis ───

async function phaseGapAnalysis(target, currentPlayerCount) {
  const model = pickModel("fast") || pickModel("analyst") || pickModel("any")
  if (!model) return { gaps: [], saturation: 100 }

  // Re-read current state
  const { sub } = readSub(target.mapSlug, target.subSlug)
  if (!sub) return { gaps: [], saturation: 100 }

  const playerNames = sub.topPlayers.map(p => `${p.name} (${p.funding || "?"}, ${p.stage || "?"})`).join("\n")

  const userMsg = `VERTICAL: ${target.mapName}
SUB-CATEGORY: ${target.subName}
DESCRIPTION: ${target.subDesc}

CURRENT DATABASE (${sub.topPlayers.length} companies):
${playerNames}

Analyze coverage gaps. What categories of companies are MISSING from this list? Which geographies, funding stages, technology approaches, or business models are underrepresented?`

  try {
    const raw = await dispatch(model, GAP_SYSTEM, userMsg, 120_000)
    const data = extractJSON(raw)
    const gaps = (data.gaps || []).filter(g => g.priority === "high" || g.priority === "medium")
    log(`    Phase 2 (gaps): ${gaps.length} gaps found, saturation=${data.saturationEstimate || "?"}%`)
    return { gaps, saturation: data.saturationEstimate || 50 }
  } catch (err) {
    log(`    Phase 2 (gaps): failed — ${err.message}`)
    return { gaps: [], saturation: 50 }
  }
}

// ─── PHASE 3: Targeted Fills ───

async function phaseTargetedFills(target, gaps) {
  if (!gaps.length) return []

  // Route gaps to specialist models
  const fillTasks = gaps.map(gap => {
    let model
    if (gap.angle.toLowerCase().includes("asia") || gap.angle.toLowerCase().includes("china") ||
        gap.angle.toLowerCase().includes("international") || gap.angle.toLowerCase().includes("apac")) {
      model = pickModel("apac-specialist")
    } else if (gap.angle.toLowerCase().includes("recent") || gap.angle.toLowerCase().includes("2024") ||
               gap.angle.toLowerCase().includes("2025") || gap.angle.toLowerCase().includes("funding")) {
      model = pickModel("web-research")  // Gemini with web search for recency
    } else {
      model = pickModel("sweep")
    }
    if (!model) model = pickModel("any")
    return { gap, model }
  }).filter(t => t.model)

  // Re-read current state for fresh existing names
  const { sub } = readSub(target.mapSlug, target.subSlug)
  const existingNames = sub ? sub.topPlayers.map(p => p.name).join(", ") : target.existingNames

  const results = await Promise.allSettled(
    fillTasks.map(async ({ gap, model }) => {
      const userMsg = `VERTICAL: ${target.mapName}
SUB-CATEGORY: ${target.subName}
DESCRIPTION: ${target.subDesc}
STRATEGY CANVAS FACTORS: ${target.factors.join(", ")}

SEARCH ANGLE: ${gap.angle}
DETAILS: ${gap.description}
${gap.suggestedQuery ? `SEARCH QUERY: ${gap.suggestedQuery}` : ""}

EXISTING PLAYERS (do NOT re-list):
${existingNames}

Find companies matching this specific angle. Be thorough for this niche.`

      const raw = await dispatch(model, FILL_SYSTEM, userMsg, 300_000)
      const data = extractJSON(raw)
      const players = data.newPlayers || []
      getMS(model).stats.playersFound += players.length
      return { gap: gap.angle, model: model.label, players }
    })
  )

  const allPlayers = []
  let fills = 0
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.players.length > 0) {
      fills++
      allPlayers.push(...r.value.players)
    }
  }

  log(`    Phase 3 (fill): ${allPlayers.length} players from ${fills}/${fillTasks.length} gap searches`)
  return allPlayers
}

// ─── ORCHESTRATOR: Multi-phase enrichment for one subcategory ───

async function enrichSubcategory(target) {
  const startPlayers = target.playerCount
  log(`  🔬 ${target.mapSlug}/${target.subName} (${startPlayers} players)`)

  // ── Phase 1: Broad sweep ──
  const sweepPlayers = await phaseSweep(target)
  let totalAdded = 0

  if (sweepPlayers.length > 0) {
    const added = await withMapLock(target.mapSlug, () =>
      saveSubPlayers(target.mapSlug, target.subSlug, sweepPlayers)
    )
    totalAdded += added
    if (added > 0) log(`    → +${added} new after sweep (deduped from ${sweepPlayers.length} raw)`)
  }

  if (Date.now() >= DEADLINE) return totalAdded

  // ── Phase 2: Gap analysis ──
  const { gaps, saturation } = await phaseGapAnalysis(target, startPlayers + totalAdded)

  if (saturation >= 90 || gaps.length === 0) {
    log(`    → Saturation ${saturation}%, skipping fills`)
    return totalAdded
  }

  if (Date.now() >= DEADLINE) return totalAdded

  // ── Phase 3: Targeted fills ──
  const fillPlayers = await phaseTargetedFills(target, gaps.slice(0, 5)) // top 5 gaps

  if (fillPlayers.length > 0) {
    const added = await withMapLock(target.mapSlug, () =>
      saveSubPlayers(target.mapSlug, target.subSlug, fillPlayers)
    )
    totalAdded += added
    if (added > 0) log(`    → +${added} new after fills (deduped from ${fillPlayers.length} raw)`)
  }

  // Read final count
  const { sub } = readSub(target.mapSlug, target.subSlug)
  const finalCount = sub ? sub.topPlayers.length : startPlayers + totalAdded
  log(`  ✅ ${target.mapSlug}/${target.subName}: ${startPlayers} → ${finalCount} players (+${totalAdded} new)`)

  return totalAdded
}

// ─── Load & prioritize targets ───

function loadTargets() {
  const mapFiles = fs.readdirSync(MAPS_DIR).filter(f => f.endsWith(".json"))
  const targets = []
  for (const f of mapFiles) {
    const slug = f.replace(".json", "")
    if (SLUG_FILTER && slug !== SLUG_FILTER) continue
    const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), "utf-8"))
    for (const sub of map.subCategories || []) {
      targets.push({
        mapSlug: slug,
        mapName: map.name,
        subSlug: sub.slug,
        subName: sub.name,
        subDesc: sub.description,
        keyGaps: sub.keyGaps || [],
        factors: map.strategyCanvasFactors || [],
        existingNames: sub.topPlayers.map(p => p.name).join(", "),
        playerCount: sub.topPlayers.length,
        opportunityScore: sub.opportunityScore || 50,
      })
    }
  }

  // Smart scheduling: prioritize by (fewest players, highest opportunity)
  targets.sort((a, b) => {
    const scoreA = a.playerCount - a.opportunityScore * 0.5
    const scoreB = b.playerCount - b.opportunityScore * 0.5
    return scoreA - scoreB
  })

  return targets
}

// ─── Stats ───

const stats = { rounds: 0, subcatsProcessed: 0, totalAdded: 0 }

function printStats() {
  const elapsed = ((Date.now() - startTime) / 60_000).toFixed(1)
  console.log(`\n${"═".repeat(75)}`)
  console.log(`  STATS — ${elapsed} min | Round ${stats.rounds} | Subcats: ${stats.subcatsProcessed} | New players: ${stats.totalAdded}`)
  console.log(`  ${"─".repeat(71)}`)
  console.log(`  ${"Model".padEnd(14)} ${"OK".padStart(5)} ${"Err".padStart(5)} ${"Retry".padStart(6)} ${"Found".padStart(7)}  State`)

  const families = [...new Set(MODELS.map(m => m.family))]
  for (const fam of families) {
    const fs_ = familyState.get(fam)
    if (fs_) console.log(`  ── ${fam} (c=${fs_.sem.active || 0}/${FAMILY_CONCURRENCY[fam] || 2}) ──`)
    for (const m of MODELS.filter(m => m.family === fam)) {
      const ms = modelState.get(m.id)
      if (!ms) continue
      const state = ms.dead ? "💀" : ms.noStream ? "ns" : "ok"
      console.log(`  ${m.label.padEnd(14)} ${String(ms.stats.ok).padStart(5)} ${String(ms.stats.errors).padStart(5)} ${String(ms.stats.retries).padStart(6)} ${String(ms.stats.playersFound).padStart(7)}  ${state}`)
    }
  }
  console.log(`${"═".repeat(75)}\n`)
}

// ─── Provider discovery ───

async function discoverModels() {
  const res = await fetch(`${CLIPROXY_BASE}/v1/models`, {
    headers: { Authorization: `Bearer ${CLIPROXY_KEY}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const available = new Set()
  for (const m of data.data || data.models || []) {
    const id = typeof m === "string" ? m : m.id || m.name
    if (id) available.add(id)
  }
  return MODELS.filter(m => available.has(m.model))
}

// ─── Main ───

async function main() {
  let available
  try { available = await discoverModels() } catch (e) { console.error(`CLIProxyAPI unreachable: ${e.message}`); process.exit(1) }
  if (!available.length) { console.error("No models available"); process.exit(1) }

  // Init state
  for (const m of available) { getMS(m); getFS(m.family) }
  const families = [...new Set(available.map(m => m.family))]

  console.log(`\n${"═".repeat(75)}`)
  console.log(`  RECON Multi-Agent Research System`)
  console.log(`  Duration: ${HOURS}h (until ${new Date(DEADLINE).toLocaleTimeString()})`)
  console.log(`  Models: ${available.length} across ${families.length} families`)
  console.log(`  Subcategory concurrency: ${SUB_CONCURRENCY}`)
  console.log(`  Pipeline: SWEEP (${available.filter(m=>m.role==="sweep"||m.role==="web-research").length} models)`)
  console.log(`          → GAP ANALYSIS (fast model)`)
  console.log(`          → TARGETED FILLS (specialist routing)`)
  for (const fam of families) {
    const models = available.filter(m => m.family === fam)
    console.log(`    ${fam.padEnd(10)} [c=${FAMILY_CONCURRENCY[fam]||2}] ${models.map(m => `${m.label}(${m.role})`).join(", ")}`)
  }
  if (SLUG_FILTER) console.log(`  Filter: ${SLUG_FILTER} only`)
  console.log(`${"═".repeat(75)}\n`)

  const statsInterval = setInterval(printStats, 5 * 60_000)
  const subSem = makeSemaphore(SUB_CONCURRENCY)

  while (Date.now() < DEADLINE) {
    stats.rounds++
    const targets = loadTargets()
    const liveCount = getLiveModels().length
    if (!liveCount) { log("All models dead!"); break }

    log(`Round ${stats.rounds}: ${targets.length} subcategories, ${liveCount} live models`)

    await Promise.allSettled(
      targets.map(async target => {
        if (Date.now() >= DEADLINE) return
        await subSem.acquire()
        try {
          if (Date.now() >= DEADLINE) return
          const added = await enrichSubcategory(target)
          stats.subcatsProcessed++
          stats.totalAdded += added
        } catch (err) {
          log(`  ❌ ${target.mapSlug}/${target.subName}: ${err.message}`)
        } finally { subSem.release() }
      })
    )

    if (Date.now() >= DEADLINE) break
    log("Round complete.")
    printStats()
    await sleep(10_000)
  }

  clearInterval(statsInterval)
  console.log("\n⏰ Time's up!")
  printStats()
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })
