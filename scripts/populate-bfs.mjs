#!/usr/bin/env node
/**
 * populate-bfs.mjs — BFS population of canonical taxonomy subcategories.
 *
 * Modeled after enrich-loop.mjs (same CLIProxyAPI, rate limiting, model pool).
 *
 * BFS ordering:
 *   Round 1: pick 1 subcat from each vertical (emptiest first) → enrichment calls
 *   Round 2: next subcat from each vertical
 *   After all subcats visited: restart with least-populated
 *   Loop until --until timestamp
 *
 * Usage:
 *   node scripts/populate-bfs.mjs --until "2026-02-13T06:30:00-08:00"
 *   node scripts/populate-bfs.mjs --hours 4
 *   node scripts/populate-bfs.mjs --hours 4 --slug ai-ml
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { jsonrepair } from "jsonrepair"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const MAPS_DIR = path.join(ROOT, "data", "maps")

// ─── Config ───

const CLIPROXY_BASE = process.env.CLIPROXY_URL || "http://127.0.0.1:8317"
const CLIPROXY_KEY = process.env.CLIPROXY_API_KEY || "your-api-key-1"

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const UNTIL_STR = flag("until", "")
const HOURS = parseFloat(flag("hours", "8"))
const SLUG_FILTER = flag("slug", "")
const DEADLINE = UNTIL_STR ? new Date(UNTIL_STR).getTime() : Date.now() + HOURS * 3600_000
const startTime = Date.now()

if (isNaN(DEADLINE)) {
  console.error(`Invalid --until timestamp: ${UNTIL_STR}`)
  process.exit(1)
}

// ─── Providers (identical to enrich-loop.mjs) ───

const KNOWN_PROVIDERS = [
  // Claude — DISABLED to save Anthropic credits (AG pool still active)
  // { id: "claude-opus-4-6",       model: "claude-opus-4-6",            label: "Opus4.6",      maxTokens: 16384, family: "claude" },
  // { id: "claude-opus-4-5",       model: "claude-opus-4-5-20251101",   label: "Opus4.5",      maxTokens: 16384, family: "claude" },
  // { id: "claude-sonnet-4-5",     model: "claude-sonnet-4-5-20250929", label: "Sonnet4.5",    maxTokens: 16384, family: "claude" },
  // { id: "claude-sonnet-4",       model: "claude-sonnet-4-20250514",   label: "Sonnet4",      maxTokens: 16384, family: "claude" },
  // { id: "claude-haiku-4-5",      model: "claude-haiku-4-5-20251001",  label: "Haiku4.5",     maxTokens: 8192,  family: "claude" },
  // GPT
  { id: "gpt-5",                 model: "gpt-5",                      label: "GPT5",         maxTokens: 32768, family: "openai" },
  { id: "gpt-5.1",               model: "gpt-5.1",                    label: "GPT5.1",       maxTokens: 32768, family: "openai" },
  { id: "gpt-5.2",               model: "gpt-5.2",                    label: "GPT5.2",       maxTokens: 32768, family: "openai" },
  // Gemini
  { id: "gemini-3-pro",          model: "gemini-3-pro-preview",       label: "Gem3Pro",      maxTokens: 65536, family: "gemini" },
  { id: "gemini-3-flash",        model: "gemini-3-flash-preview",     label: "Gem3Flash",    maxTokens: 65536, family: "gemini" },
  { id: "gemini-2.5-pro",        model: "gemini-2.5-pro",             label: "Gem2.5P",      maxTokens: 65536, family: "gemini" },
  { id: "gemini-2.5-flash",      model: "gemini-2.5-flash",           label: "Gem2.5F",      maxTokens: 65536, family: "gemini" },
  // DeepSeek
  { id: "deepseek-v3.2",         model: "deepseek-v3.2",              label: "DSv3.2",       maxTokens: 16384, family: "deepseek" },
  { id: "deepseek-v3.1",         model: "deepseek-v3.1",              label: "DSv3.1",       maxTokens: 16384, family: "deepseek" },
  { id: "deepseek-v3",           model: "deepseek-v3",                label: "DSv3",         maxTokens: 16384, family: "deepseek" },
  // Qwen
  { id: "qwen3-max",             model: "qwen3-max",                  label: "Qwen3Max",     maxTokens: 16384, family: "qwen" },
  { id: "qwen3-235b",            model: "qwen3-235b",                 label: "Qwen3-235b",   maxTokens: 16384, family: "qwen" },
  { id: "qwen3-coder-plus",      model: "qwen3-coder-plus",           label: "QwenCoder+",   maxTokens: 16384, family: "qwen" },
  // Kimi
  { id: "kimi-k2.5",             model: "kimi-k2.5",                  label: "Kimi2.5",      maxTokens: 16384, family: "kimi" },
  { id: "kimi-k2",               model: "kimi-k2",                    label: "KimiK2",       maxTokens: 16384, family: "kimi" },
  // GLM
  { id: "glm-4.7",               model: "glm-4.7",                    label: "GLM4.7",       maxTokens: 16384, family: "glm" },
  { id: "glm-4.6",               model: "glm-4.6",                    label: "GLM4.6",       maxTokens: 16384, family: "glm" },
  // Minimax
  { id: "minimax-m2.1",          model: "minimax-m2.1",               label: "MiniMax2.1",   maxTokens: 16384, family: "minimax" },
  { id: "minimax-m2",            model: "minimax-m2",                 label: "MiniMax2",     maxTokens: 16384, family: "minimax" },
  // Cursor (separate credential pool)
  { id: "cursor-claude-4.5-son", model: "cursor/claude-4.5-sonnet",   label: "C-Son4.5",     maxTokens: 16384, family: "cursor-claude" },
  { id: "cursor-gpt-5",          model: "cursor/gpt-5",               label: "C-GPT5",       maxTokens: 32768, family: "cursor-openai" },
  { id: "cursor-gpt-5.2",        model: "cursor/gpt-5.2",             label: "C-GPT5.2",     maxTokens: 32768, family: "cursor-openai" },
  { id: "cursor-gemini-2.5-pro", model: "cursor/gemini-2.5-pro",      label: "C-Gem2.5P",    maxTokens: 65536, family: "cursor-gemini" },
  { id: "cursor-gemini-3-pro",   model: "cursor/gemini-3-pro-preview",label: "C-Gem3Pro",    maxTokens: 65536, family: "cursor-gemini" },
  { id: "cursor-grok-3",         model: "cursor/grok-3",              label: "C-Grok3",      maxTokens: 16384, family: "cursor-grok" },
  { id: "cursor-deepseek-v3",    model: "cursor/deepseek-v3",         label: "C-DSv3",       maxTokens: 16384, family: "cursor-deepseek" },
  { id: "cursor-o3",             model: "cursor/o3",                   label: "C-o3",         maxTokens: 32768, family: "cursor-openai" },
  // Grok (xAI)
  { id: "grok-3",                model: "grok-3",                     label: "Grok3",        maxTokens: 16384, family: "grok" },
  { id: "grok-3-mini",           model: "grok-3-mini",                label: "Grok3Mini",    maxTokens: 16384, family: "grok" },
  // Antigravity (separate credential pool)
  { id: "ag-opus-4-6-think",     model: "claude-opus-4-6-thinking",   label: "AG-Opus4.6T",  maxTokens: 16384, family: "ag-claude" },
  { id: "ag-opus-4-5-think",     model: "claude-opus-4-5-thinking",   label: "AG-Opus4.5T",  maxTokens: 16384, family: "ag-claude" },
  { id: "ag-sonnet-4-5",         model: "claude-sonnet-4-5",          label: "AG-Son4.5",    maxTokens: 16384, family: "ag-claude" },
  { id: "ag-gem3-pro-high",      model: "gemini-3-pro-high",          label: "AG-Gem3ProH",  maxTokens: 65536, family: "ag-gemini" },
  { id: "ag-gem3-flash",         model: "gemini-3-flash",             label: "AG-Gem3Flash", maxTokens: 65536, family: "ag-gemini" },
  { id: "ag-gpt-oss-120b",       model: "gpt-oss-120b-medium",       label: "AG-GPT120b",   maxTokens: 16384, family: "ag-openai" },
]

const FAMILY_CONCURRENCY = {
  // claude:       4,  // disabled to save credits
  openai:          3,
  gemini:          6,
  deepseek:        2,
  qwen:            2,
  kimi:            2,
  glm:             2,
  minimax:         2,
  "cursor-claude": 4,
  "cursor-openai": 3,
  "cursor-gemini": 4,
  "cursor-grok":   2,
  "cursor-deepseek": 2,
  grok:            2,
  "ag-claude":     4,
  "ag-gemini":     4,
  "ag-openai":     2,
}

// ─── Per-provider state + per-family semaphore ───

const familyState = new Map()
const providerState = new Map()

function getFS(family) {
  if (!familyState.has(family)) {
    const conc = FAMILY_CONCURRENCY[family] || 3
    familyState.set(family, { sem: makeSemaphore(conc), concurrency: conc, backoffUntil: 0 })
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

// ─── Web search tools per provider ───

function getWebSearchTools(provider) {
  const base = provider.model.replace(/^cursor\//, "")
  if (/^claude/i.test(base)) return { tools: [{ type: "web_search_20250305", name: "web_search" }] }
  if (/^gemini/i.test(base)) return { tools: [{ type: "google_search" }] }
  if (/^(gpt-|o[1-9])/i.test(base)) return { tools: [{ type: "web_search", search_context_size: "high" }] }
  if (/^grok/i.test(base)) return { tools: [{ type: "web_search", search_context_size: "high" }] }
  return {}
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
        response_format: { type: "json_object" },
        ...(useStream ? { stream: true } : {}),
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

    if (!useStream) {
      const data = await res.json()
      if (data.status === "449" || data.status === 449 || data.msg?.includes("rate limit")) {
        return { retryable: true, reason: "rate-limited (449)" }
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
      if (rawBytes.length < 500) rawBytes += chunk
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

async function callProvider(provider, systemPrompt, userMessage, timeoutMs = 300_000, passDeadline = DEADLINE) {
  const ps = getPS(provider)
  const fs_ = getFS(provider.family)
  if (ps.dead) throw new Error("dead")

  const now = Date.now()
  if (fs_.backoffUntil > now) {
    const waitTime = Math.min(fs_.backoffUntil - now, passDeadline - now)
    if (waitTime <= 0) throw new Error("deadline")
    await sleep(waitTime)
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (Date.now() >= passDeadline) throw new Error("deadline")

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
      attempt--
      continue
    }

    if (result.fatal) {
      ps.consecutiveErrors++
      if (ps.consecutiveErrors >= 5) {
        ps.dead = true
        ps.deadAt = Date.now()
        log(`  💀 ${provider.label} marked dead: ${result.reason}`)
      }
      throw new Error(result.reason)
    }

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
    // Only dead-mark on non-rate-limit, non-timeout failures (HTTP 500 = broken model)
    if (ps.consecutiveErrors >= 5 && !result.reason.includes("rate-limited") && !result.reason.includes("timeout")) {
      ps.dead = true
      ps.deadAt = Date.now()
      log(`  💀 ${provider.label} marked dead after ${ps.consecutiveErrors} consecutive failures: ${result.reason}`)
    }
    throw new Error(`max retries: ${result.reason}`)
  }
}

// ─── JSON extraction ───

function extractJSON(text) {
  // Try code-fenced JSON first
  const m1 = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  let raw = m1 ? m1[1].trim() : null
  // Fall back to first { ... } block
  if (!raw) { const m2 = text.match(/\{[\s\S]*\}/); if (m2) raw = m2[0] }
  if (!raw) throw new Error("no JSON found in response")
  // Try direct parse, then jsonrepair
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(jsonrepair(raw))
    } catch (e) {
      throw new Error(`JSON parse failed: ${e.message.slice(0, 60)}`)
    }
  }
}

// ─── Stage normalization ───

function normalizeStage(stage) {
  if (!stage) return "Unknown"
  const s = stage.toLowerCase().trim()
  // Skip / junk
  if (!s || s === "n/a" || s === "unknown" || s === "undisclosed" || s === "unclear" || s === "—" || s === "varies"
    || s === "skip" || s.startsWith("skip") || s === "not specified" || s === "not explicitly mentioned") return "Unknown"
  // Pre-Seed
  if (/pre.?seed|angel|incubat|stealth|pre.?product|pre.?revenue|pre.?commercial|y combinator/i.test(s)) return "Pre-Seed"
  // Series (A-I)
  const series = s.match(/series\s*([a-i])/i)
  if (series) {
    const letter = series[1].toUpperCase()
    if (letter <= "C") return `Series ${letter}`
    return "Series D+"
  }
  // Seed
  if (/^seed|seed round|seed stage/i.test(s)) return "Seed"
  // Public / IPO
  if (/ipo|public|mainnet|token|ico|post.?ico|network/i.test(s)) return "Public"
  // Acquired / Defunct
  if (/acqui|defunct|m&a|merged|exit|restructured|discontinued|dormant|bankrupt|archived|shut.?down|ceased|deprecated/i.test(s)) return "Acquired"
  // Bootstrapped / Self-funded
  if (/bootstrap|self.?fund|revenue.?fund|profitable|smb|commercial|indie|micro.?saas|consulting|services/i.test(s)) return "Bootstrapped"
  // Open Source / Community
  if (/open.?source|^oss|community|apache|standard|ratified|specification|consortium/i.test(s)) return "Open Source"
  // Corporate / Subsidiary
  if (/corporate|enterprise|division|subsidiary|business unit|internal|government|soe/i.test(s)) return "Corporate"
  // Private Equity
  if (/private.?equity|^pe$|^pe.?owned|^pe.?back|^private$/i.test(s)) return "Private Equity"
  // Non-profit / Research / Academic
  if (/non.?profit|research|academic|grant|spin.?off|institute|lab|niche|experimental|prototype|alpha|beta/i.test(s)) return "Research"
  // Late Stage / Established
  if (/late|mature|established|scaled|graduated|operat|boutique|big 4|stable|incumbent|legacy|mainstream|widely adopted|maintained|maintenance/i.test(s)) return "Late Stage"
  // Growth
  if (/growth|expan|scaling|^scale|growing|^mid|venture|fund|accelerator|revenue/i.test(s)) return "Growth"
  // Early Stage
  if (/early|launch|product|shipping|released|available|emerging|develop|pilot|mvp|recent|live|startup|^ga\b|plugin|tool|platform|app|library|framework|add.?on|saas|maker|concept|demonstration/i.test(s)) return "Early Stage"
  // Catch remaining descriptive strings (>15 chars are usually descriptions, not stages)
  if (s.length > 15) return "Unknown"
  return stage
}

// ─── Subcategory metrics ───

function parseFundingUsd(funding) {
  if (!funding || funding === "Unknown" || funding === "N/A" || funding === "Bootstrapped") return 0
  const fl = funding.toLowerCase()
  // Skip if it's describing valuation/market cap/revenue rather than funding raised
  if (/valuation|market\s*cap|revenue|valued\s*at|public\s*company|publicly|internal|government/i.test(funding)) return 0
  // Require $ prefix to avoid matching employee counts, years, etc.
  const m = String(funding).replace(/[,\s]/g, "").match(/\$(\d[\d.]*)\s*(B|M|K)?/i)
  if (!m) return 0
  const n = parseFloat(m[1]), u = (m[2] || "").toUpperCase()
  if (isNaN(n)) return 0
  // Cap at $5B — anything higher is likely not actual funding raised
  const usd = u === "B" ? n * 1e9 : u === "M" ? n * 1e6 : u === "K" ? n * 1e3 : n
  return usd > 5e9 ? 0 : usd
}

function formatFunding(usd) {
  if (!usd || usd <= 0) return "N/A"
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`
  return `$${usd}`
}

function recalcSubMetrics(sub) {
  const players = sub.topPlayers || []
  // totalFunding
  let totalUsd = 0
  for (const p of players) totalUsd += p.totalFundingUsd || parseFundingUsd(p.funding)
  sub.totalFunding = formatFunding(totalUsd)
  // crowdedness
  const n = players.length
  sub.crowdednessScore = n === 0 ? 10 : n <= 10 ? 15 + n : n <= 50 ? 25 + Math.round((n-10)*0.375) : n <= 200 ? 40 + Math.round((n-50)*0.167) : n <= 500 ? 65 + Math.round((n-200)*0.067) : Math.min(98, 85 + Math.round((n-500)*0.02))
  // opportunity — based on % of weak players, not averages (wider spread)
  let scored = 0, eBelow50 = 0, vBelow50 = 0, topE = []
  for (const p of players) {
    if (p.executionScore && p.visionScore) {
      scored++
      if (p.executionScore < 50) eBelow50++
      if (p.visionScore < 50) vBelow50++
      topE.push(p.executionScore)
    }
  }
  if (scored > 0) {
    // D1: How beatable are incumbents? (% with exec < 50)
    const beatability = (eBelow50 / scored) * 100
    // D2: How much room for innovation? (% with vision < 50)
    const innovationRoom = (vBelow50 / scored) * 100
    // D3: How weak is the top tier? (100 - top 10% avg execution)
    topE.sort((a, b) => b - a)
    const topN = Math.max(1, Math.ceil(topE.length * 0.1))
    const topAvg = topE.slice(0, topN).reduce((s, v) => s + v, 0) / topN
    const topWeakness = 100 - topAvg
    // D4: Market accessibility (inverse crowdedness)
    const accessibility = 100 - sub.crowdednessScore
    // Weighted composite
    const raw = beatability * 0.30 + innovationRoom * 0.25 + topWeakness * 0.25 + accessibility * 0.20
    sub.opportunityScore = Math.max(5, Math.min(95, Math.round(raw)))
  } else {
    sub.opportunityScore = 50
  }
}

function recalcMapMetrics(map) {
  const subs = map.subCategories || []
  map.totalPlayers = subs.reduce((s, sc) => s + (sc.playerCount || sc.topPlayers?.length || 0), 0)
  // Aggregate funding across all subcategories
  let totalUsd = 0
  for (const sub of subs) {
    for (const p of sub.topPlayers || []) totalUsd += parseFundingUsd(p.funding)
  }
  map.totalFunding = formatFunding(totalUsd)
  // Average crowdedness & opportunity
  const withMetrics = subs.filter(s => s.crowdednessScore != null)
  if (withMetrics.length > 0) {
    map.overallCrowdedness = Math.round(withMetrics.reduce((s, sc) => s + sc.crowdednessScore, 0) / withMetrics.length)
    map.averageOpportunity = Math.round(withMetrics.reduce((s, sc) => s + sc.opportunityScore, 0) / withMetrics.length)
  }
}

// ─── Merge + save (atomic per map) ───

function normalizeName(n) { return n.toLowerCase().replace(/[^a-z0-9]/g, "") }

const mapWriteLocks = new Map()

async function acquireMapLock(slug) {
  while (mapWriteLocks.get(slug)) {
    await sleep(10)
  }
  mapWriteLocks.set(slug, true)
}
function releaseMapLock(slug) { mapWriteLocks.set(slug, false) }

function mergeAndSave(mapSlug, subSlug, newPlayers) {
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
    p.stage = normalizeStage(p.stage)
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
  recalcSubMetrics(sub)
  recalcMapMetrics(map)
  map.lastEnrichedAt = new Date().toISOString()

  const tmpPath = `${mapPath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2))
  fs.renameSync(tmpPath, mapPath)
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
- Your ENTIRE response must be a single JSON object. No prose, no markdown, no explanations — ONLY JSON.

You MUST respond with ONLY a JSON code block. Do NOT include any text before or after the JSON. Your response must start with \`\`\`json and end with \`\`\`.

\`\`\`json
{
  "newPlayers": [
    {
      "name": "Company Name",
      "oneLiner": "What they do",
      "funding": "$5M",
      "stage": "Seed",
      "executionScore": 25,
      "visionScore": 40,
      "competitiveFactors": [{"factor": "Factor Name", "score": 7}]
    }
  ],
  "updatedPlayers": []
}
\`\`\``

// Prompt angles — rotated each round for diversity
const PROMPT_ANGLES = [
  "", // default — general enrichment
  "\n\nFOCUS THIS ROUND: Bootstrapped companies and open-source projects. Dig deep for unfunded but notable tools, self-funded companies, and developer-built projects with traction.",
  "\n\nFOCUS THIS ROUND: International and non-US companies. Look specifically for European, Asian (China, India, Japan, Korea, SE Asia), Latin American, Middle Eastern, and African companies in this space.",
  "\n\nFOCUS THIS ROUND: Very early stage companies — pre-seed, seed, accelerator graduates (YC, Techstars, etc.), stealth-mode startups, and companies founded in the last 2 years.",
  "\n\nFOCUS THIS ROUND: Enterprise incumbents and legacy players pivoting into this space. Think big tech divisions, consulting firms' products, legacy software companies adding AI features, and large companies' internal-turned-external tools.",
  "\n\nFOCUS THIS ROUND: Acquired companies, pivoted companies, and niche vertical-specific tools. Companies bought by larger players, companies that pivoted into this space, and highly specialized tools serving specific industries.",
]

// ─── Stats ───

const globalStats = { workUnitsCompleted: 0, workUnitsTotal: 0, totalAdded: 0, rounds: 0, bfsIndex: 0 }

function printStats() {
  const elapsed = ((Date.now() - startTime) / 60_000).toFixed(1)
  const remaining = Math.max(0, (DEADLINE - Date.now()) / 60_000).toFixed(0)
  console.log(`\n${"═".repeat(70)}`)
  console.log(`  BFS STATS — ${elapsed} min elapsed, ${remaining} min remaining, round ${globalStats.rounds}`)
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

// ─── Key Gaps generation ───

const KEY_GAPS_PROMPT = `You are a market analyst. Given a sub-category of a startup vertical with its existing players, identify 3-5 KEY MARKET GAPS — underserved needs, missing capabilities, or whitespace opportunities that no existing player fully addresses.

Each gap should be:
- Specific and actionable (not generic like "better UX")
- Based on what's MISSING from the current player landscape
- Valuable enough that a startup could be built around it

Respond with ONLY a JSON object:
{"keyGaps": ["Gap description 1", "Gap description 2", "Gap description 3"]}`

// Track which subcats had gaps generated (by mapSlug/subSlug) to avoid re-running
const gapsGenerated = new Set()

// Minimum players before generating gaps (need enough data to analyze)
const MIN_PLAYERS_FOR_GAPS = 20

// Pick a fast, reliable model for gaps analysis
function pickGapsModel(providers) {
  const preferred = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3-flash", "claude-haiku-4-5-20251001", "gpt-5-mini"]
  for (const modelId of preferred) {
    const p = providers.find((pr) => pr.model === modelId && !getPS(pr).dead)
    if (p) return p
  }
  // Fall back to any non-dead provider
  return providers.find((p) => !getPS(p).dead)
}

async function generateKeyGaps(providers) {
  if (Date.now() >= DEADLINE) return

  const mapFiles = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
  const targets = []

  for (const f of mapFiles) {
    const slug = f.replace(".json", "")
    if (SLUG_FILTER && slug !== SLUG_FILTER) continue
    const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), "utf-8"))

    for (const sub of map.subCategories || []) {
      const key = `${slug}/${sub.slug}`
      if (gapsGenerated.has(key)) continue
      if ((sub.topPlayers?.length || 0) < MIN_PLAYERS_FOR_GAPS) continue
      if (sub.keyGaps && sub.keyGaps.length >= 3) {
        gapsGenerated.add(key) // already has good gaps
        continue
      }
      targets.push({
        mapSlug: slug,
        mapName: map.name,
        subSlug: sub.slug,
        subName: sub.name,
        subDesc: sub.description,
        playerNames: (sub.topPlayers || []).slice(0, 30).map((p) => `${p.name} (${p.oneLiner || ""})`).join("; "),
        playerCount: sub.topPlayers?.length || 0,
      })
    }
  }

  if (targets.length === 0) return

  const liveProviders = providers.filter((p) => !getPS(p).dead)
  if (!liveProviders.length) { log("  ⚠️ No models available for gap analysis"); return }

  log(`\n🔍 Key Gaps pass: ${targets.length} subcategories across ${liveProviders.length} models`)

  // Time-limit the pass to 5 minutes max
  const passEnd = Math.min(DEADLINE, Date.now() + 5 * 60_000)

  // Fan out: assign targets round-robin to all live providers
  let generated = 0
  await Promise.allSettled(
    targets.map(async (target, i) => {
      if (Date.now() >= passEnd) return
      const provider = liveProviders[i % liveProviders.length]
      const ps = getPS(provider)
      if (ps.dead) return
      const fs_ = getFS(provider.family)
      await fs_.sem.acquire()
      try {
        if (Date.now() >= passEnd) return
        const userMessage = `VERTICAL: ${target.mapName}
SUB-CATEGORY: ${target.subName}
DESCRIPTION: ${target.subDesc}
PLAYER COUNT: ${target.playerCount}
SAMPLE PLAYERS: ${target.playerNames}

Identify 3-5 key market gaps in this sub-category.

IMPORTANT: Respond with ONLY a valid JSON object. No markdown, no prose. Your entire response must be parseable JSON: {"keyGaps": ["Gap 1", "Gap 2", "Gap 3"]}`

        const raw = await callProvider(provider, KEY_GAPS_PROMPT, userMessage, 60_000, passEnd)
        const data = extractJSON(raw)
        const gaps = data.keyGaps || data.gaps || []

        if (gaps.length > 0) {
          await acquireMapLock(target.mapSlug)
          try {
            const mapPath = path.join(MAPS_DIR, `${target.mapSlug}.json`)
            const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"))
            const sub = map.subCategories.find((s) => s.slug === target.subSlug)
            if (sub) {
              sub.keyGaps = gaps.slice(0, 5)
              const tmpPath = `${mapPath}.tmp`
              fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2))
              fs.renameSync(tmpPath, mapPath)
              generated++
              log(`  🔍 ${target.mapSlug}/${target.subName}: ${gaps.length} gaps identified`)
            }
          } finally {
            releaseMapLock(target.mapSlug)
          }
        }
        gapsGenerated.add(`${target.mapSlug}/${target.subSlug}`)
      } catch (err) {
        log(`  ⚠️ Gaps failed for ${target.mapSlug}/${target.subName}: ${err.message.slice(0, 60)}`)
      } finally {
        fs_.sem.release()
      }
    })
  )

  if (generated > 0) log(`  🔍 Generated key gaps for ${generated} subcategories`)
}

// ─── Competitive Factors backfill ───

const CF_BACKFILL_PROMPT = `You are a market analyst. Score the given companies on the provided strategy canvas factors.

For each company, return scores (1-10) for EACH factor. Be honest and differentiated — not every company scores 7.

Respond with ONLY a JSON object:
{"players": [{"name": "Company Name", "competitiveFactors": [{"factor": "Factor Name", "score": 7}]}]}`

// Max players to backfill per round
const CF_BATCH_SIZE = 500

async function backfillCompetitiveFactors(providers) {
  if (Date.now() >= DEADLINE) return

  const mapFiles = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
  const targets = [] // {mapSlug, subSlug, factors, players[{name, oneLiner}]}

  for (const f of mapFiles) {
    const slug = f.replace(".json", "")
    if (SLUG_FILTER && slug !== SLUG_FILTER) continue
    const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), "utf-8"))
    const factors = map.strategyCanvasFactors || []
    if (!factors.length) continue
    const factorSet = new Set(factors)

    for (const sub of map.subCategories || []) {
      const missing = []
      for (const p of sub.topPlayers || []) {
        const cf = p.competitiveFactors || []
        // Missing if empty OR if factors don't match the map's canonical set
        const hasGoodFactors = cf.length >= factors.length * 0.5 &&
          cf.some((f) => factorSet.has(f.factor))
        if (!hasGoodFactors) {
          missing.push({ name: p.name, oneLiner: p.oneLiner || "" })
        }
      }
      if (missing.length > 0) {
        targets.push({ mapSlug: slug, subSlug: sub.slug, subName: sub.name, factors, missing })
      }
    }
  }

  if (targets.length === 0) return

  const liveProviders = providers.filter((p) => !getPS(p).dead)
  if (!liveProviders.length) { log("  ⚠️ No models available for CF backfill"); return }

  // Flatten all targets into work units (chunks of 15 players each)
  const workUnits = []
  for (const target of targets) {
    for (let i = 0; i < target.missing.length; i += 15) {
      workUnits.push({
        mapSlug: target.mapSlug,
        subSlug: target.subSlug,
        subName: target.subName,
        factors: target.factors,
        chunk: target.missing.slice(i, i + 15),
      })
      if (workUnits.length >= CF_BATCH_SIZE) break
    }
    if (workUnits.length >= CF_BATCH_SIZE) break
  }

  const totalMissing = targets.reduce((s, t) => s + t.missing.length, 0)
  log(`\n📊 CompFactors backfill: ${totalMissing} players across ${targets.length} subcategories (${workUnits.length} chunks across ${liveProviders.length} models)`)

  // Time-limit the pass to 5 minutes max
  const passEnd = Math.min(DEADLINE, Date.now() + 5 * 60_000)

  let filled = 0

  // Fan out: assign chunks round-robin to all live providers
  await Promise.allSettled(
    workUnits.map(async (wu, i) => {
      if (Date.now() >= passEnd) return
      const provider = liveProviders[i % liveProviders.length]
      const ps = getPS(provider)
      if (ps.dead) return
      const fs_ = getFS(provider.family)
      await fs_.sem.acquire()
      try {
        if (Date.now() >= passEnd) return

        const playerList = wu.chunk.map((p) => `- ${p.name}: ${p.oneLiner}`).join("\n")
        const userMessage = `STRATEGY CANVAS FACTORS: ${wu.factors.join(", ")}

COMPANIES TO SCORE:
${playerList}

Score each company on ALL ${wu.factors.length} factors above. Use the EXACT factor names provided.

IMPORTANT: Respond with ONLY a valid JSON object. No markdown, no prose. Your entire response must be parseable JSON: {"players": [{"name": "...", "competitiveFactors": [{"factor": "...", "score": 7}]}]}`

        const raw = await callProvider(provider, CF_BACKFILL_PROMPT, userMessage, 60_000, passEnd)
        const data = extractJSON(raw)
        const scoredPlayers = data.players || []

        if (scoredPlayers.length > 0) {
          await acquireMapLock(wu.mapSlug)
          try {
            const mapPath = path.join(MAPS_DIR, `${wu.mapSlug}.json`)
            const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"))
            const sub = map.subCategories.find((s) => s.slug === wu.subSlug)
            if (!sub) return

            const playerMap = new Map()
            for (const p of sub.topPlayers) playerMap.set(normalizeName(p.name), p)

            let updated = 0
            for (const sp of scoredPlayers) {
              const key = normalizeName(sp.name)
              const existing = playerMap.get(key)
              if (existing && sp.competitiveFactors?.length > 0) {
                existing.competitiveFactors = sp.competitiveFactors
                updated++
              }
            }

            if (updated > 0) {
              const tmpPath = `${mapPath}.tmp`
              fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2))
              fs.renameSync(tmpPath, mapPath)
              filled += updated
              log(`  📊 ${wu.mapSlug}/${wu.subName}: ${updated} players scored`)
            }
          } finally {
            releaseMapLock(wu.mapSlug)
          }
        }
      } catch (err) {
        log(`  ⚠️ CF backfill failed for ${wu.mapSlug}/${wu.subName}: ${err.message.slice(0, 60)}`)
      } finally {
        fs_.sem.release()
      }
    })
  )

  if (filled > 0) log(`  📊 Backfilled competitive factors for ${filled} players`)
}

// ─── BFS target selection ───

/**
 * Load all maps and build a BFS ordering:
 *   For each vertical, sort subcats by playerCount ascending (emptiest first).
 *   Then interleave: round-robin 1 subcat from each vertical per BFS level.
 */
function loadBFSTargets() {
  const mapFiles = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
  const verticals = []

  for (const f of mapFiles) {
    const slug = f.replace(".json", "")
    if (SLUG_FILTER && slug !== SLUG_FILTER) continue
    const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), "utf-8"))
    const subs = (map.subCategories || [])
      .map((sub) => ({
        mapSlug: slug,
        mapName: map.name,
        subSlug: sub.slug,
        subName: sub.name,
        subDesc: sub.description,
        keyGaps: sub.keyGaps || [],
        factors: map.strategyCanvasFactors || [],
        playerCount: sub.topPlayers?.length || 0,
      }))
      .sort((a, b) => a.playerCount - b.playerCount) // emptiest first

    if (subs.length) verticals.push(subs)
  }

  // Interleave: round-robin across verticals
  const bfsOrder = []
  const maxDepth = Math.max(...verticals.map((v) => v.length))
  for (let depth = 0; depth < maxDepth; depth++) {
    for (const vertical of verticals) {
      if (depth < vertical.length) {
        bfsOrder.push(vertical[depth])
      }
    }
  }

  return bfsOrder
}

/** Re-read existing player names for a target from disk */
function refreshExistingNames(target) {
  try {
    const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${target.mapSlug}.json`), "utf-8"))
    const sub = map.subCategories.find((s) => s.slug === target.subSlug)
    if (sub) {
      target.existingNames = sub.topPlayers.map((p) => p.name).join(", ")
      target.playerCount = sub.topPlayers.length
    } else {
      target.existingNames = ""
    }
  } catch {
    target.existingNames = ""
  }
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

  const deadlineStr = new Date(DEADLINE).toLocaleString()
  console.log(`\n${"═".repeat(70)}`)
  console.log(`  RECON BFS Population — canonical taxonomy enrichment`)
  console.log(`  Deadline: ${deadlineStr} (${((DEADLINE - Date.now()) / 3600_000).toFixed(1)}h)`)
  console.log(`  Models: ${providers.length} across ${families.length} families | Total concurrency: ${totalConc}`)
  for (const fam of families) {
    const models = providers.filter((p) => p.family === fam)
    const fs_ = getFS(fam)
    console.log(`    ${fam.padEnd(10)} ${models.length} models, concurrency=${fs_.concurrency}: ${models.map((m) => m.label).join(", ")}`)
  }
  if (SLUG_FILTER) console.log(`  Filter: ${SLUG_FILTER} only`)
  console.log(`${"═".repeat(70)}\n`)

  const statsInterval = setInterval(printStats, 5 * 60_000)

  // ── Initial analysis passes (run before BFS loop to fill gaps in existing data) ──
  log("Running initial key gaps + competitive factors backfill...")
  await generateKeyGaps(providers)
  await backfillCompetitiveFactors(providers)

  while (Date.now() < DEADLINE) {
    // Refresh providers each round
    try { const fresh = await getProviders(); if (fresh.length) providers = fresh } catch {}

    // Revive dead providers after 5 minutes cooldown
    for (const p of providers) {
      const ps = getPS(p)
      if (ps.dead && ps.deadAt && (Date.now() - ps.deadAt) > 5 * 60_000) {
        log(`  🔄 ${p.label} revived after cooldown`)
        ps.dead = false
        ps.deadAt = 0
        ps.consecutiveErrors = 0
      }
    }

    // Build BFS targets (re-read from disk each round for fresh counts)
    const bfsTargets = loadBFSTargets()
    let liveProviders = providers.filter((p) => !getPS(p).dead)

    if (!liveProviders.length) { log("All providers dead!"); break }
    if (!bfsTargets.length) { log("No targets found!"); break }

    globalStats.rounds++
    const angle = PROMPT_ANGLES[globalStats.rounds % PROMPT_ANGLES.length]
    const angleName = angle ? angle.match(/FOCUS THIS ROUND: (.+?)\./)?.[1] || "themed" : "general"

    log(`Round ${globalStats.rounds}: ${bfsTargets.length} BFS targets × ${liveProviders.length} models | angle: ${angleName}`)

    // Process BFS targets in batches — one BFS level at a time
    // Each BFS level = one subcat per vertical (interleaved)
    // Fan out across all live providers for each target
    const verticalSlugs = [...new Set(bfsTargets.map((t) => t.mapSlug))]
    const batchSize = verticalSlugs.length // one target per vertical per batch

    for (let batchStart = 0; batchStart < bfsTargets.length; batchStart += batchSize) {
      if (Date.now() >= DEADLINE) break

      // Mid-round revival: revive dead providers after 5-minute cooldown
      for (const p of providers) {
        const ps = getPS(p)
        if (ps.dead && ps.deadAt && (Date.now() - ps.deadAt) > 5 * 60_000) {
          log(`  🔄 ${p.label} revived after cooldown`)
          ps.dead = false
          ps.deadAt = 0
          ps.consecutiveErrors = 0
        }
      }
      // Refresh live providers for this batch
      liveProviders = providers.filter((p) => !getPS(p).dead)

      const batch = bfsTargets.slice(batchStart, batchStart + batchSize)
      const workUnits = []

      for (const target of batch) {
        for (const provider of liveProviders) {
          workUnits.push({ target, provider })
        }
      }

      // Shuffle work units so providers interleave
      for (let i = workUnits.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[workUnits[i], workUnits[j]] = [workUnits[j], workUnits[i]]
      }

      globalStats.workUnitsTotal += workUnits.length
      const bfsLevel = Math.floor(batchStart / batchSize) + 1
      log(`  BFS level ${bfsLevel}: ${batch.map((t) => `${t.mapSlug}/${t.subName} (${t.playerCount})`).join(", ")}`)

      await Promise.allSettled(
        workUnits.map(async ({ target, provider }) => {
          if (Date.now() >= DEADLINE) return
          const ps = getPS(provider)
          if (ps.dead) return

          const fs_ = getFS(provider.family)
          await fs_.sem.acquire()
          try {
            if (Date.now() >= DEADLINE || ps.dead) return

            // Fresh read of existing players
            refreshExistingNames(target)

            const userMessage = `VERTICAL: ${target.mapName}

SUB-CATEGORY: ${target.subName}
DESCRIPTION: ${target.subDesc}
KEY GAPS: ${target.keyGaps.join("; ")}

STRATEGY CANVAS FACTORS: ${target.factors.join(", ")}

EXISTING PLAYERS (do NOT re-list these as new):
${target.existingNames || "(none — this is a brand new subcategory, find all notable players)"}

Find ALL additional players in this sub-category that are NOT in the existing list above. Be EXHAUSTIVE.${angle}

IMPORTANT: Respond with ONLY a valid JSON object. No markdown, no prose, no explanations. Your entire response must be parseable JSON matching this schema:
{"newPlayers": [{"name": "...", "oneLiner": "...", "funding": "...", "stage": "...", "executionScore": 0, "visionScore": 0, "competitiveFactors": [{"factor": "...", "score": 0}]}], "updatedPlayers": []}`

            const raw = await callProvider(provider, ENRICH_PROMPT, userMessage)
            let data
            try {
              data = extractJSON(raw)
            } catch (parseErr) {
              // Log first 200 chars of raw content for debugging
              log(`  ⚠️ ${provider.label} raw (${raw.length} chars): ${raw.slice(0, 200).replace(/\n/g, "\\n")}`)
              throw parseErr
            }
            const newPlayers = data.newPlayers || []

            if (newPlayers.length > 0) {
              await acquireMapLock(target.mapSlug)
              try {
                const added = mergeAndSave(target.mapSlug, target.subSlug, newPlayers)
                ps.stats.playersAdded += added
                globalStats.totalAdded += added
                if (added > 0) {
                  log(`  ✅ ${provider.label} → ${target.mapSlug}/${target.subName}: +${added} new (total: ${target.playerCount + added})`)
                }
              } finally {
                releaseMapLock(target.mapSlug)
              }
            }
          } catch (err) {
            if (err.message !== "dead" && err.message !== "deadline") {
              ps.stats.errors++
              log(`  ❌ ${provider.label} → ${target.mapSlug}/${target.subName}: ${err.message.slice(0, 80)}`)
            }
          } finally {
            globalStats.workUnitsCompleted++
            fs_.sem.release()
          }
        }),
      )

      if (Date.now() >= DEADLINE) break
    }

    if (Date.now() >= DEADLINE) break

    // ── Post-round analysis passes ──
    await generateKeyGaps(providers)
    await backfillCompetitiveFactors(providers)

    log("BFS pass complete. Pausing 10s before next pass...")
    printStats()
    await sleep(10_000)
  }

  clearInterval(statsInterval)
  console.log("\n⏰ Time's up!")
  printStats()

  // Print final map state
  console.log("Final map state:")
  const mapFiles = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
  for (const f of mapFiles) {
    const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), "utf-8"))
    const empty = map.subCategories.filter((s) => (s.topPlayers?.length || 0) === 0).length
    console.log(`  ${f}: ${map.subCategories.length} subcats, ${map.totalPlayers} players, ${empty} empty`)
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1) })
