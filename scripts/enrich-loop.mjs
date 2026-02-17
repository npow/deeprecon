#!/usr/bin/env node
/**
 * enrich-loop.mjs — Continuously enriches all subcategories across all maps.
 *
 * Architecture:
 *   Work unit = (provider, subcategory) — fully independent.
 *   Each provider has its OWN concurrency semaphore and backoff state.
 *   Results merge into map files immediately — no waiting for sibling providers.
 *
 * Usage:
 *   node scripts/enrich-loop.mjs [--hours 4] [--per-provider 2] [--slug ai-ml]
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
const PER_PROVIDER = flag("per-provider", "") ? parseInt(flag("per-provider", "0"), 10) : 0
const SLUG_FILTER = flag("slug", "")
const DEADLINE = Date.now() + HOURS * 3600_000
const startTime = Date.now()

// ─── Providers ───
// Grouped by family — models in the same family share a rate-limit semaphore.

const KNOWN_PROVIDERS = [
  // ── Claude ──
  { id: "claude-opus-4-6",       model: "claude-opus-4-6",            label: "Opus4.6",      maxTokens: 16384, family: "claude" },
  { id: "claude-opus-4-5",       model: "claude-opus-4-5-20251101",   label: "Opus4.5",      maxTokens: 16384, family: "claude" },
  { id: "claude-sonnet-4-5",     model: "claude-sonnet-4-5-20250929", label: "Sonnet4.5",    maxTokens: 16384, family: "claude" },
  { id: "claude-sonnet-4",       model: "claude-sonnet-4-20250514",   label: "Sonnet4",      maxTokens: 16384, family: "claude" },
  { id: "claude-haiku-4-5",      model: "claude-haiku-4-5-20251001",  label: "Haiku4.5",     maxTokens: 8192,  family: "claude" },
  // ── GPT ──
  { id: "gpt-5",                 model: "gpt-5",                      label: "GPT5",         maxTokens: 32768, family: "openai" },
  { id: "gpt-5.1",               model: "gpt-5.1",                    label: "GPT5.1",       maxTokens: 32768, family: "openai" },
  { id: "gpt-5.2",               model: "gpt-5.2",                    label: "GPT5.2",       maxTokens: 32768, family: "openai" },
  // ── Gemini ──
  { id: "gemini-3-pro",          model: "gemini-3-pro-preview",       label: "Gem3Pro",      maxTokens: 65536, family: "gemini" },
  { id: "gemini-3-flash",        model: "gemini-3-flash-preview",     label: "Gem3Flash",    maxTokens: 65536, family: "gemini" },
  { id: "gemini-2.5-pro",        model: "gemini-2.5-pro",             label: "Gem2.5P",      maxTokens: 65536, family: "gemini" },
  { id: "gemini-2.5-flash",      model: "gemini-2.5-flash",           label: "Gem2.5F",      maxTokens: 65536, family: "gemini" },
  // ── DeepSeek ──
  { id: "deepseek-v3.2",         model: "deepseek-v3.2",              label: "DSv3.2",       maxTokens: 16384, family: "deepseek" },
  { id: "deepseek-v3.1",         model: "deepseek-v3.1",              label: "DSv3.1",       maxTokens: 16384, family: "deepseek" },
  { id: "deepseek-v3",           model: "deepseek-v3",                label: "DSv3",         maxTokens: 16384, family: "deepseek" },
  // ── Qwen ──
  { id: "qwen3-max",             model: "qwen3-max",                  label: "Qwen3Max",     maxTokens: 16384, family: "qwen" },
  { id: "qwen3-235b",            model: "qwen3-235b",                 label: "Qwen3-235b",   maxTokens: 16384, family: "qwen" },
  { id: "qwen3-coder-plus",      model: "qwen3-coder-plus",           label: "QwenCoder+",   maxTokens: 16384, family: "qwen" },
  // ── Kimi ──
  { id: "kimi-k2.5",             model: "kimi-k2.5",                  label: "Kimi2.5",      maxTokens: 16384, family: "kimi" },
  { id: "kimi-k2",               model: "kimi-k2",                    label: "KimiK2",       maxTokens: 16384, family: "kimi" },
  // ── GLM ──
  { id: "glm-4.7",               model: "glm-4.7",                    label: "GLM4.7",       maxTokens: 16384, family: "glm" },
  { id: "glm-4.6",               model: "glm-4.6",                    label: "GLM4.6",       maxTokens: 16384, family: "glm" },
  // ── Minimax ──
  { id: "minimax-m2.1",          model: "minimax-m2.1",               label: "MiniMax2.1",   maxTokens: 16384, family: "minimax" },
  { id: "minimax-m2",            model: "minimax-m2",                 label: "MiniMax2",     maxTokens: 16384, family: "minimax" },
]

// Default per-family concurrency (total across all models in the family)
const FAMILY_CONCURRENCY = {
  claude:   4,
  openai:   3,  // heavy 429s at higher concurrency
  gemini:   6,  // best throughput — has web search grounding
  deepseek: 2,
  qwen:     2,
  kimi:     2,
  glm:      2,
  minimax:  2,
}

// ─── Per-provider state (per-model) + per-family semaphore ───

const familyState = new Map()  // family → { sem, backoffUntil }
const providerState = new Map() // id → { noStream, dead, consecutiveErrors, stats }

function getFS(family) {
  if (!familyState.has(family)) {
    const conc = PER_PROVIDER || FAMILY_CONCURRENCY[family] || 3
    familyState.set(family, {
      sem: makeSemaphore(conc),
      concurrency: conc,
      backoffUntil: 0,
    })
  }
  return familyState.get(family)
}

function getPS(provider) {
  if (!providerState.has(provider.id)) {
    providerState.set(provider.id, {
      noStream: false,
      dead: false,
      consecutiveErrors: 0,
      stats: { calls: 0, ok: 0, errors: 0, retries: 0, playersAdded: 0 },
    })
  }
  return providerState.get(provider.id)
}

// ─── Semaphore ───

function makeSemaphore(max) {
  let active = 0
  const queue = []
  return {
    async acquire() {
      if (active < max) { active++; return }
      await new Promise((r) => queue.push(r))
    },
    release() {
      active--
      const next = queue.shift()
      if (next) { active++; next() }
    },
    get active() { return active },
  }
}

// ─── Backoff ───

const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 120_000

function backoffDelay(attempt) {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS)
  const jitter = exp * 0.5 * (2 * Math.random() - 1)
  return Math.max(500, exp + jitter)
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ─── Logging ───

function ts() {
  const e = ((Date.now() - startTime) / 60_000).toFixed(1)
  const r = Math.max(0, (DEADLINE - Date.now()) / 60_000).toFixed(0)
  return `[${e}m +${r}m]`
}
function log(msg) { console.log(`${ts()} ${msg}`) }

// ─── Provider discovery ───

async function fetchAvailableModels() {
  const res = await fetch(`${CLIPROXY_BASE}/v1/models`, {
    headers: { Authorization: `Bearer ${CLIPROXY_KEY}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const out = new Set()
  for (const m of data.data || data.models || []) {
    const id = typeof m === "string" ? m : m.id || m.name
    if (id) out.add(id)
  }
  return out
}

async function getProviders() {
  const available = await fetchAvailableModels()
  return KNOWN_PROVIDERS.filter((p) => available.has(p.model))
}

// ─── LLM call (single attempt) ───

async function callProviderOnce(provider, systemPrompt, userMessage, timeoutMs, useStream) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${CLIPROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CLIPROXY_KEY}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: provider.maxTokens,
        temperature: 0.3,
        ...(useStream ? { stream: true } : {}),
        // Enable web search grounding for Gemini models
        ...(provider.family === "gemini" ? { tools: [{ google_search_retrieval: {} }] } : {}),
      }),
      signal: controller.signal,
    })

    if (res.status === 406 && useStream) {
      await res.text().catch(() => {})
      return { switchToNonStream: true }
    }
    if (res.status === 429 || res.status >= 500) {
      const body = await res.text().catch(() => "")
      return { retryable: true, reason: `HTTP ${res.status}`, detail: body.slice(0, 100) }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { fatal: true, reason: `HTTP ${res.status}: ${body.slice(0, 150)}` }
    }

    // Non-streaming
    if (!useStream) {
      const data = await res.json()
      // Detect proxy-level rate limiting (HTTP 200 but error in body)
      if (data.status === "449" || data.status === 449 || data.msg?.includes("rate limit")) {
        return { retryable: true, reason: `rate-limited (449)` }
      }
      if (data.error) {
        const msg = typeof data.error === "string" ? data.error : data.error.message || JSON.stringify(data.error)
        return { retryable: true, reason: `proxy error: ${msg.slice(0, 100)}` }
      }
      const content = data.choices?.[0]?.message?.content || ""
      return content ? { content } : { retryable: true, reason: "empty response" }
    }

    // Streaming
    const reader = res.body?.getReader()
    if (!reader) return { retryable: true, reason: "no body" }
    const dec = new TextDecoder()
    let buf = "", content = "", rawBytes = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = dec.decode(value, { stream: true })
      buf += chunk
      if (rawBytes.length < 500) rawBytes += chunk // capture first bytes for error detection
      const lines = buf.split("\n")
      buf = lines.pop() || ""
      for (const ln of lines) {
        const t = ln.trim()
        if (!t.startsWith("data: ")) continue
        const p = t.slice(6)
        if (p === "[DONE]") continue
        try { const c = JSON.parse(p); const d = c.choices?.[0]?.delta?.content; if (d) content += d } catch {}
      }
    }
    if (!content) {
      // Check if the "stream" was actually a JSON error body
      try {
        const errBody = JSON.parse(rawBytes.trim())
        if (errBody.status === "449" || errBody.status === 449 || errBody.msg?.includes("rate limit")) {
          return { retryable: true, reason: "rate-limited (449)" }
        }
        if (errBody.error) {
          return { retryable: true, reason: `proxy error: ${(errBody.error.message || JSON.stringify(errBody.error)).slice(0, 100)}` }
        }
      } catch {}
      return { retryable: true, reason: "empty stream" }
    }
    return { content }
  } catch (err) {
    if (err.name === "AbortError") return { retryable: true, reason: "timeout" }
    return { retryable: true, reason: err.message }
  } finally {
    clearTimeout(timer)
  }
}

// ─── LLM call with per-provider retry + backoff ───

const MAX_RETRIES = 5

async function callProvider(provider, systemPrompt, userMessage, timeoutMs = 300_000) {
  const ps = getPS(provider)
  const fs_ = getFS(provider.family)
  if (ps.dead) throw new Error("dead")

  // Respect family-level backoff
  const now = Date.now()
  if (fs_.backoffUntil > now) {
    await sleep(fs_.backoffUntil - now)
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (Date.now() >= DEADLINE) throw new Error("deadline")

    ps.stats.calls++
    const result = await callProviderOnce(provider, systemPrompt, userMessage, timeoutMs, !ps.noStream)

    if (result.content) {
      ps.consecutiveErrors = 0
      fs_.backoffUntil = 0
      ps.stats.ok++
      return result.content
    }

    if (result.switchToNonStream) {
      ps.noStream = true
      attempt-- // don't count this
      continue
    }

    if (result.fatal) {
      ps.consecutiveErrors++
      if (ps.consecutiveErrors >= 3) {
        ps.dead = true
        log(`  💀 ${provider.label} marked dead: ${result.reason}`)
      }
      throw new Error(result.reason)
    }

    // Retryable — apply family-level backoff so sibling models also slow down
    if (attempt < MAX_RETRIES) {
      ps.stats.retries++
      const delay = backoffDelay(attempt)
      if (result.reason.includes("rate-limited")) {
        fs_.backoffUntil = Math.max(fs_.backoffUntil, Date.now() + delay)
      }
      if (attempt >= 1) {
        log(`  ⏳ ${provider.label}: ${result.reason}, wait ${(delay/1000).toFixed(1)}s (attempt ${attempt+1})`)
      }
      await sleep(delay)
      continue
    }

    ps.consecutiveErrors++
    ps.stats.errors++
    throw new Error(`max retries: ${result.reason}`)
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

// ─── Merge + save (atomic per map) ───

function normalizeName(n) { return n.toLowerCase().replace(/[^a-z0-9]/g, "") }

// Lock per map slug to serialize writes
const mapWriteLocks = new Map()

async function acquireMapLock(slug) {
  while (mapWriteLocks.get(slug)) {
    await sleep(10)
  }
  mapWriteLocks.set(slug, true)
}
function releaseMapLock(slug) { mapWriteLocks.set(slug, false) }

/**
 * Merge new players into a subcategory and save the map.
 * Re-reads the map from disk to avoid clobbering concurrent writes.
 */
function mergeAndSave(mapSlug, subSlug, newPlayers) {
  // Re-read fresh from disk
  const mapPath = path.join(MAPS_DIR, `${mapSlug}.json`)
  const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"))
  const subIdx = map.subCategories.findIndex((s) => s.slug === subSlug)
  if (subIdx === -1) return 0

  const sub = map.subCategories[subIdx]
  const existing = new Map()
  for (const p of sub.topPlayers) {
    const k = normalizeName(p.name)
    if (k) existing.set(k, p)
  }

  let added = 0
  for (const p of newPlayers) {
    const k = normalizeName(p.name)
    if (!k) continue
    if (existing.has(k)) {
      const ex = existing.get(k)
      if (p.executionScore && ex.executionScore) ex.executionScore = Math.round((ex.executionScore + p.executionScore) / 2)
      if (p.visionScore && ex.visionScore) ex.visionScore = Math.round((ex.visionScore + p.visionScore) / 2)
      if ((p.oneLiner?.length || 0) > (ex.oneLiner?.length || 0)) ex.oneLiner = p.oneLiner
    } else {
      existing.set(k, p)
      added++
    }
  }

  sub.topPlayers = Array.from(existing.values())
  sub.playerCount = sub.topPlayers.length
  sub.lastEnrichedAt = new Date().toISOString()
  map.totalPlayers = map.subCategories.reduce((s, sc) => s + (sc.playerCount || sc.topPlayers.length), 0)
  map.lastEnrichedAt = new Date().toISOString()

  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2))
  return added
}

// ─── Enrichment prompt ───

const ENRICH_PROMPT = `You are a senior market analyst performing EXHAUSTIVE enrichment on a specific sub-category within a startup vertical landscape map.

You are given:
- The vertical name and sub-category context (name, description, key gaps)
- The list of strategy canvas factors used across the vertical
- The EXISTING players already catalogued

Your job: Find EVERY player NOT already listed. Be EXHAUSTIVE — capture the ENTIRE long tail:
- Funded startups (seed through IPO)
- Bootstrapped companies
- Open-source projects with commercial backing
- Legacy incumbents and enterprises pivoting into this space
- International / non-US companies (Europe, Asia, LATAM, Africa, MENA)
- Niche and vertical-specific tools
- Very early stage / pre-seed / accelerator companies
- Defunct or acquired companies that were notable
- Companies that are tangentially in this space

For each new player, provide:
- name: Company name
- oneLiner: What they do in one sentence
- funding: Total funding raised (e.g., "$5M", "Bootstrapped", "$150M")
- stage: Last funding stage (e.g., "Seed", "Series A", "Bootstrapped", "IPO", "Acquired")
- executionScore: 0-100 (be honest — most startups score 15-40)
- visionScore: 0-100
- competitiveFactors: Array of { factor: string, score: number (1-10) } matching the provided strategy canvas factors EXACTLY

CRITICAL:
- Do NOT re-list existing players as "new"
- List as MANY new players as possible — there is no limit. 20, 40, 60+ is fine.
- Breadth over depth — it's better to list 50 players with basic info than 10 players with perfect info
- Be accurate — don't invent companies

Return valid JSON:
{
  "newPlayers": [<player objects>],
  "updatedPlayers": [<player objects with name matching existing>]
}`

// Prompt angles — rotated each round for long-tail diversity
const PROMPT_ANGLES = [
  "", // default — general enrichment
  "\n\nFOCUS THIS ROUND: Bootstrapped companies and open-source projects. Dig deep for unfunded but notable tools, self-funded companies, and developer-built projects with traction.",
  "\n\nFOCUS THIS ROUND: International and non-US companies. Look specifically for European, Asian (China, India, Japan, Korea, SE Asia), Latin American, Middle Eastern, and African companies in this space.",
  "\n\nFOCUS THIS ROUND: Very early stage companies — pre-seed, seed, accelerator graduates (YC, Techstars, etc.), stealth-mode startups, and companies founded in the last 2 years.",
  "\n\nFOCUS THIS ROUND: Enterprise incumbents and legacy players pivoting into this space. Think big tech divisions, consulting firms' products, legacy software companies adding AI features, and large companies' internal-turned-external tools.",
  "\n\nFOCUS THIS ROUND: Acquired companies, pivoted companies, and niche vertical-specific tools. Companies bought by larger players, companies that pivoted into this space, and highly specialized tools serving specific industries.",
]

// ─── Stats ───

const globalStats = { workUnitsCompleted: 0, workUnitsTotal: 0, totalAdded: 0, rounds: 0 }

function printStats() {
  const elapsed = ((Date.now() - startTime) / 60_000).toFixed(1)
  console.log(`\n${"═".repeat(70)}`)
  console.log(`  STATS — ${elapsed} min elapsed, round ${globalStats.rounds}`)
  console.log(`  Work units: ${globalStats.workUnitsCompleted}/${globalStats.workUnitsTotal} | New players: ${globalStats.totalAdded}`)
  console.log(`  ${"─".repeat(66)}`)
  console.log(`  ${"Model".padEnd(16)} ${"OK".padStart(5)} ${"Err".padStart(5)} ${"Retry".padStart(6)} ${"Added".padStart(7)}  State`)
  const families = [...new Set([...providerState.keys()].map((id) => {
    const p = KNOWN_PROVIDERS.find((kp) => kp.id === id)
    return p?.family || "?"
  }))]
  for (const fam of families) {
    const fs_ = familyState.get(fam)
    if (fs_) console.log(`  ── ${fam} (concurrency=${fs_.concurrency}) ──`)
    for (const [id, ps] of providerState) {
      const p = KNOWN_PROVIDERS.find((kp) => kp.id === id)
      if (p?.family !== fam) continue
      const state = ps.dead ? "💀 DEAD" : ps.noStream ? "no-strm" : "ok"
      console.log(`  ${(p?.label || id).padEnd(16)} ${String(ps.stats.ok).padStart(5)} ${String(ps.stats.errors).padStart(5)} ${String(ps.stats.retries).padStart(6)} ${String(ps.stats.playersAdded).padStart(7)}  ${state}`)
    }
  }
  console.log(`${"═".repeat(70)}\n`)
}

// ─── Build work units ───

function loadTargets() {
  const mapFiles = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
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
        existingNames: sub.topPlayers.map((p) => p.name).join(", "),
      })
    }
  }
  // Shuffle
  for (let i = targets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[targets[i], targets[j]] = [targets[j], targets[i]]
  }
  return targets
}

// ─── Main ───

async function main() {
  let providers
  try { providers = await getProviders() } catch (err) {
    console.error(`CLIProxyAPI unreachable: ${err.message}`); process.exit(1)
  }
  if (!providers.length) { console.error("No providers available"); process.exit(1) }

  // Init per-provider + per-family state
  for (const p of providers) { getPS(p); getFS(p.family) }

  const families = [...new Set(providers.map((p) => p.family))]
  const totalConc = families.reduce((s, f) => s + getFS(f).concurrency, 0)

  console.log(`\n${"═".repeat(70)}`)
  console.log(`  RECON Enrichment Loop v3 — multi-model per provider`)
  console.log(`  Duration: ${HOURS}h (until ${new Date(DEADLINE).toLocaleTimeString()})`)
  console.log(`  Models: ${providers.length} across ${families.length} families | Total concurrency: ${totalConc}`)
  console.log(`  Work unit: (model × subcategory) — family-level rate limiting`)
  for (const fam of families) {
    const models = providers.filter((p) => p.family === fam)
    const fs_ = getFS(fam)
    console.log(`    ${fam.padEnd(10)} ${models.length} models, concurrency=${fs_.concurrency}: ${models.map((m) => m.label).join(", ")}`)
  }
  if (SLUG_FILTER) console.log(`  Filter: ${SLUG_FILTER} only`)
  console.log(`${"═".repeat(70)}\n`)

  const statsInterval = setInterval(printStats, 5 * 60_000)

  while (Date.now() < DEADLINE) {
    // Refresh providers each round
    try { const fresh = await getProviders(); if (fresh.length) providers = fresh } catch {}

    const targets = loadTargets()
    const liveProviders = providers.filter((p) => !getPS(p).dead)

    if (!liveProviders.length) { log("All providers dead!"); break }

    const workUnits = []
    for (const target of targets) {
      for (const provider of liveProviders) {
        workUnits.push({ target, provider })
      }
    }
    // Shuffle work units so providers interleave
    for (let i = workUnits.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[workUnits[i], workUnits[j]] = [workUnits[j], workUnits[i]]
    }

    globalStats.workUnitsTotal = workUnits.length
    globalStats.workUnitsCompleted = 0
    globalStats.rounds++

    const angle = PROMPT_ANGLES[globalStats.rounds % PROMPT_ANGLES.length]
    const angleName = angle ? angle.match(/FOCUS THIS ROUND: (.+?)\./)?.[1] || "themed" : "general"

    log(`Round ${globalStats.rounds}: ${targets.length} subcats × ${liveProviders.length} models = ${workUnits.length} units | angle: ${angleName}`)

    await Promise.allSettled(
      workUnits.map(async ({ target, provider }) => {
        if (Date.now() >= DEADLINE) return
        const ps = getPS(provider)
        if (ps.dead) return

        // Per-family semaphore
        const fs_ = getFS(provider.family)
        await fs_.sem.acquire()
        try {
          if (Date.now() >= DEADLINE || ps.dead) return

          // Re-read existing players from disk (they grow during the round)
          try {
            const freshMap = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${target.mapSlug}.json`), "utf-8"))
            const freshSub = freshMap.subCategories.find((s) => s.slug === target.subSlug)
            if (freshSub) target.existingNames = freshSub.topPlayers.map((p) => p.name).join(", ")
          } catch {}

          const userMessage = `VERTICAL: ${target.mapName}

SUB-CATEGORY: ${target.subName}
DESCRIPTION: ${target.subDesc}
KEY GAPS: ${target.keyGaps.join("; ")}

STRATEGY CANVAS FACTORS: ${target.factors.join(", ")}

EXISTING PLAYERS (do NOT re-list these as new):
${target.existingNames}

Find ALL additional players in this sub-category that are NOT in the existing list above. Be EXHAUSTIVE.${angle}`

          const raw = await callProvider(provider, ENRICH_PROMPT, userMessage)
          const data = extractJSON(raw)
          const newPlayers = data.newPlayers || []

          if (newPlayers.length > 0) {
            await acquireMapLock(target.mapSlug)
            try {
              const added = mergeAndSave(target.mapSlug, target.subSlug, newPlayers)
              ps.stats.playersAdded += added
              globalStats.totalAdded += added
              if (added > 0) {
                log(`  ✅ ${provider.label} → ${target.mapSlug}/${target.subName}: +${added} new`)
              }
            } finally {
              releaseMapLock(target.mapSlug)
            }
          }
        } catch (err) {
          if (err.message !== "dead" && err.message !== "deadline") {
            ps.stats.errors++
          }
        } finally {
          globalStats.workUnitsCompleted++
          fs_.sem.release()
        }
      }),
    )

    if (Date.now() >= DEADLINE) break
    log("Round complete. Pausing 10s...")
    printStats()
    await sleep(10_000)
  }

  clearInterval(statsInterval)
  console.log("\n⏰ Time's up!")
  printStats()
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1) })
