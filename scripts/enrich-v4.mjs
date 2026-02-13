#!/usr/bin/env node
/**
 * enrich-v4.mjs — Recursive multi-agent research system with Firecrawl integration.
 *
 * Phase 1: DB Seeding — Firecrawl scrapes Crunchbase/G2/Capterra/PH, LLM extracts
 * Phase 2: Recursive Deep Research — 30 diverse queries batched 3/call, recursive w/ follow-ups
 * Phase 3: Snowball Expansion — alternatives, investor graph, OSS, conferences via Firecrawl
 * Phase 3b: Tail Hunting — incubators, indie hackers, Show HN, app stores, spin-offs
 * Phase 4: Geographic Expansion — APAC models + localized web queries
 * Phase 5: Gap Analysis + Targeted Fills
 * Phase 6: Chao1 Estimation — provenance-based species richness (foundBy tracking)
 *
 * Usage:
 *   node scripts/enrich-v4.mjs [--hours 4] [--slug ai-ml] [--depth 2] [--breadth 30]
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
const FIRECRAWL_BASE = process.env.FIRECRAWL_URL || "http://localhost:3002"
const FIRECRAWL_KEY = process.env.FIRECRAWL_KEY || ""

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const HOURS = parseFloat(flag("hours", "4"))
const SUB_CONCURRENCY = parseInt(flag("sub-concurrency", "2"), 10)
const RESEARCH_DEPTH = parseInt(flag("depth", "2"), 10)
const RESEARCH_BREADTH = parseInt(flag("breadth", "30"), 10)
const QUERIES_PER_BATCH = parseInt(flag("batch-size", "3"), 10)
const SLUG_FILTER = flag("slug", "")
const DEADLINE = Date.now() + HOURS * 3600_000
const startTime = Date.now()

// ─── Models ───

const MODELS = [
  { id: "claude-opus-4-6",   model: "claude-opus-4-6",            label: "Opus4.6",   maxTokens: 16384, family: "claude",   role: "analyst",        web: true },
  { id: "claude-sonnet-4-5", model: "claude-sonnet-4-5-20250929", label: "Sonnet4.5", maxTokens: 16384, family: "claude",   role: "web-research",   web: true },
  { id: "claude-haiku-4-5",  model: "claude-haiku-4-5-20251001",  label: "Haiku4.5",  maxTokens: 8192,  family: "claude",   role: "fast",           web: true },
  { id: "gpt-5",             model: "gpt-5",                      label: "GPT5",      maxTokens: 32768, family: "openai",   role: "sweep",          web: false },
  { id: "gemini-3-pro",      model: "gemini-3-pro-preview",       label: "Gem3Pro",   maxTokens: 65536, family: "gemini",   role: "web-research",   web: true },
  { id: "gemini-3-flash",    model: "gemini-3-flash-preview",     label: "Gem3Flash", maxTokens: 65536, family: "gemini",   role: "web-research",   web: true },
  { id: "gemini-2.5-pro",    model: "gemini-2.5-pro",             label: "Gem2.5P",   maxTokens: 65536, family: "gemini",   role: "web-research",   web: true },
  { id: "gemini-2.5-flash",  model: "gemini-2.5-flash",           label: "Gem2.5F",   maxTokens: 65536, family: "gemini",   role: "web-research",   web: true },
  { id: "deepseek-v3.2",     model: "deepseek-v3.2",              label: "DSv3.2",    maxTokens: 16384, family: "deepseek", role: "apac-specialist", web: false },
  { id: "qwen3-max",         model: "qwen3-max",                  label: "Qwen3Max",  maxTokens: 16384, family: "qwen",     role: "apac-specialist", web: false },
  { id: "kimi-k2.5",         model: "kimi-k2.5",                  label: "Kimi2.5",   maxTokens: 16384, family: "kimi",     role: "apac-specialist", web: false },
  { id: "glm-4.7",           model: "glm-4.7",                    label: "GLM4.7",    maxTokens: 16384, family: "glm",      role: "apac-specialist", web: false },
]

const FAMILY_CONCURRENCY = { claude: 3, openai: 1, gemini: 2, deepseek: 1, qwen: 1, kimi: 1, glm: 1 }

// ─── Utilities ───

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function ts() {
  const e = ((Date.now() - startTime) / 60_000).toFixed(1)
  const r = Math.max(0, (DEADLINE - Date.now()) / 60_000).toFixed(0)
  return `[${e}m +${r}m]`
}
function log(msg) { console.log(`${ts()} ${msg}`) }
function dead() { return Date.now() >= DEADLINE }

// ─── Name normalization & fuzzy matching ───

function normalizeName(n) { return n.toLowerCase().replace(/[^a-z0-9]/g, "") }

function normalizeDomain(url) {
  if (!url) return ""
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, "").toLowerCase()
  } catch { return "" }
}

const NOISE_SUFFIXES = /\b(inc|corp|co|ltd|llc|gmbh|sa|sas|bv|pty|plc|limited|incorporated|corporation|company)\b/g

function nameTokens(n) {
  return n.toLowerCase().replace(NOISE_SUFFIXES, "").replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)
}

function jaccardSimilarity(a, b) {
  const sa = new Set(a), sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

function isSameCompany(name1, name2, url1, url2) {
  // Domain match is definitive
  const d1 = normalizeDomain(url1), d2 = normalizeDomain(url2)
  if (d1 && d2 && d1 === d2) return true
  // Exact normalized name match
  const n1 = normalizeName(name1), n2 = normalizeName(name2)
  if (n1 && n2 && n1 === n2) return true
  // Fuzzy token match
  const t1 = nameTokens(name1), t2 = nameTokens(name2)
  if (t1.length >= 1 && t2.length >= 1 && jaccardSimilarity(t1, t2) >= 0.85) return true
  return false
}

// ─── Semaphore ───

function makeSem(max) {
  let a = 0; const q = []
  return {
    async acquire() { if (a < max) { a++; return }; await new Promise(r => q.push(r)) },
    release() { a--; const n = q.shift(); if (n) { a++; n() } },
    get active() { return a },
  }
}

// ─── State ───

const familyState = new Map()
const modelState = new Map()

function getFS(fam) {
  if (!familyState.has(fam)) familyState.set(fam, { sem: makeSem(FAMILY_CONCURRENCY[fam] || 1), backoffUntil: 0 })
  return familyState.get(fam)
}
function getMS(m) {
  if (!modelState.has(m.id)) modelState.set(m.id, { noStream: false, dead: false, consErr: 0, stats: { calls: 0, ok: 0, err: 0, retries: 0, found: 0 } })
  return modelState.get(m.id)
}

// ─── Backoff ───

function backoffMs(attempt, family) {
  // Gemini rate limits are aggressive — start higher
  const base = family === "gemini" ? 5000 : 2000
  const exp = Math.min(base * 2 ** attempt, 120_000)
  return Math.max(1000, exp + exp * 0.5 * (2 * Math.random() - 1))
}

// ─── LLM call ───

async function callOnce(model, sys, user, timeout, stream, { webSearch = true } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    let tools
    // NOTE: google_search_retrieval is disabled for Gemini — proxy returns "malformed_function_call"
    // Gemini models still perform well without explicit grounding tools through this proxy.
    if (webSearch && model.family === "claude" && model.web) tools = [{ type: "web_search", name: "web_search" }]

    // Force non-streaming when tools are present (Gemini web search returns empty streams)
    const useStream = stream && !tools

    const res = await fetch(`${CLIPROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CLIPROXY_KEY}` },
      body: JSON.stringify({
        model: model.model,
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        max_tokens: model.maxTokens,
        temperature: 0.3,
        ...(useStream ? { stream: true } : {}),
        ...(tools ? { tools } : {}),
      }),
      signal: ctrl.signal,
    })

    if (res.status === 406 && useStream) { await res.text().catch(() => {}); return { noStream: true } }
    if (res.status === 429 || res.status >= 500) return { retry: true, why: `HTTP ${res.status}` }
    if (!res.ok) { const b = await res.text().catch(() => ""); return { fatal: true, why: `HTTP ${res.status}: ${b.slice(0,150)}` } }

    if (!useStream) {
      const d = await res.json()
      if (d.status === "449" || d.status === 449 || d.msg?.includes("rate limit")) return { retry: true, why: "rate-limited (449)" }
      if (d.error) return { retry: true, why: `proxy: ${(d.error.message||"").slice(0,80)}` }
      // Check primary content field
      let c = d.choices?.[0]?.message?.content || ""
      // Gemini grounding: content may be in tool_calls or parts when using google_search_retrieval
      if (!c) {
        const msg = d.choices?.[0]?.message
        if (msg?.tool_calls?.length) {
          c = msg.tool_calls.map(tc => tc.function?.arguments || "").join("\n")
        }
        if (!c && msg?.parts) c = msg.parts.map(p => p.text || "").join("\n")
        // Debug: log raw response shape when Gemini returns empty with tools
        if (!c && tools && model.family === "gemini") {
          const keys = Object.keys(d).join(",")
          const msgKeys = msg ? Object.keys(msg).join(",") : "null"
          const choiceKeys = d.choices?.[0] ? Object.keys(d.choices[0]).join(",") : "null"
          log(`  🔍 ${model.label} empty debug: top=[${keys}] choice=[${choiceKeys}] msg=[${msgKeys}] raw=${JSON.stringify(d).slice(0,300)}`)
        }
      }
      return c ? { content: c } : { retry: true, why: "empty" }
    }

    const reader = res.body?.getReader()
    if (!reader) return { retry: true, why: "no body" }
    const dec = new TextDecoder()
    let buf = "", content = "", raw1st = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const ch = dec.decode(value, { stream: true }); buf += ch
      if (raw1st.length < 500) raw1st += ch
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
      try { const e = JSON.parse(raw1st.trim()); if (e.status === "449" || e.msg?.includes("rate")) return { retry: true, why: "rate-limited (449)" }; if (e.error) return { retry: true, why: "proxy err" } } catch {}
      return { retry: true, why: "empty stream" }
    }
    return { content }
  } catch (err) {
    if (err.name === "AbortError") return { retry: true, why: "timeout" }
    return { retry: true, why: err.message }
  } finally { clearTimeout(timer) }
}

async function callModel(model, sys, user, timeout = 300_000, opts = {}) {
  const ms = getMS(model), fs_ = getFS(model.family)
  if (ms.dead) throw new Error("dead")
  if (fs_.backoffUntil > Date.now()) await sleep(fs_.backoffUntil - Date.now())

  for (let att = 0; att <= 4; att++) {
    if (dead()) throw new Error("deadline")
    ms.stats.calls++
    const r = await callOnce(model, sys, user, timeout, !ms.noStream, opts)
    if (r.content) { ms.consErr = 0; fs_.backoffUntil = 0; ms.stats.ok++; return r.content }
    if (r.noStream) { ms.noStream = true; att--; continue }
    // Gemini grounding returned empty — retry once without tools before counting as failure
    if (r.retryNoTools && opts.webSearch !== false) {
      ms.stats.retries++
      log(`  ⏳ ${model.label}: grounding empty, retrying without tools`)
      const r2 = await callOnce(model, sys, user, timeout, !ms.noStream, { ...opts, webSearch: false })
      if (r2.content) { ms.consErr = 0; fs_.backoffUntil = 0; ms.stats.ok++; return r2.content }
      // If still empty, fall through to normal retry logic
    }
    if (r.fatal) { ms.consErr++; if (ms.consErr >= 3) { ms.dead = true; log(`  💀 ${model.label}`) }; throw new Error(r.why) }
    if (att < 4) {
      ms.stats.retries++
      const d = backoffMs(att, model.family)
      if (r.why.includes("449") || r.why.includes("429")) fs_.backoffUntil = Math.max(fs_.backoffUntil, Date.now() + d)
      log(`  ⏳ ${model.label}: ${r.why}, ${(d/1000).toFixed(0)}s (${att+2})`)
      await sleep(d)
    } else { ms.consErr++; ms.stats.err++; throw new Error(r.why) }
  }
}

async function dispatch(model, sys, user, timeout, opts = {}) {
  const fs_ = getFS(model.family)
  await fs_.sem.acquire()
  try { return await callModel(model, sys, user, timeout, opts) } finally { fs_.sem.release() }
}

// ─── Firecrawl ───

let firecrawlAvailable = null // null = unknown, true/false after first check
const firecrawlSem = makeSem(2)

async function firecrawlSearch(query, limit = 5) {
  if (firecrawlAvailable === false) return []

  await firecrawlSem.acquire()
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(FIRECRAWL_KEY ? { Authorization: `Bearer ${FIRECRAWL_KEY}` } : {}),
      },
      body: JSON.stringify({ query, limit, scrapeOptions: { formats: ["markdown"] } }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      if (firecrawlAvailable === null) { firecrawlAvailable = false; log("  ⚠ Firecrawl unavailable, skipping") }
      return []
    }
    firecrawlAvailable = true
    const data = await res.json()
    return (data.data || []).filter(d => d.markdown || d.url)
  } catch (e) {
    if (firecrawlAvailable === null) { firecrawlAvailable = false; log(`  ⚠ Firecrawl unavailable: ${e.message}`) }
    return []
  } finally { firecrawlSem.release() }
}

/** Use Firecrawl to search, then feed content to an LLM for company extraction. */
async function firecrawlExtract(query, target, extractorModel) {
  const results = await firecrawlSearch(query, 5)
  if (!results.length) return { players: [], learnings: [] }

  const contentStr = results
    .map(r => `<page url="${r.url || ""}">\n${(r.markdown || "").slice(0, 20_000)}\n</page>`)
    .join("\n\n")

  const sys = `You extract company data from web page content. Analyze the provided web pages and extract every company mentioned.
${PLAYER_SCHEMA}
CRITICAL: Only extract REAL companies found in the content. Skip companies in EXISTING list.`

  const user = `VERTICAL: ${target.mapName} / ${target.subName}
FACTORS: ${target.factors.join(", ")}
EXISTING (skip): ${target.existingNames}

WEB CONTENT:
${contentStr}`

  try {
    const raw = await dispatch(extractorModel, sys, user, 120_000, { webSearch: false })
    const data = extractJSON(raw)
    const players = tagPlayers(data.newPlayers || [], `FC+${extractorModel.label}`)
    getMS(extractorModel).stats.found += players.length
    return { players, learnings: data.learnings || [] }
  } catch { return { players: [], learnings: [] } }
}

// ─── JSON extraction ───

function extractJSON(text) {
  const m1 = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  let raw = m1 ? m1[1].trim() : null
  if (!raw) { const m2 = text.match(/\{[\s\S]*\}/); if (m2) raw = m2[0] }
  if (!raw) throw new Error("no JSON found in response")
  raw = raw.replace(/,\s*([}\]])/g, "$1")
  return JSON.parse(raw)
}

// ─── Map I/O ───

const mapLocks = new Map()
async function withLock(slug, fn) {
  while (mapLocks.get(slug)) await sleep(10)
  mapLocks.set(slug, true)
  try { return fn() } finally { mapLocks.set(slug, false) }
}

function mergePlayers(existing, newP) {
  const players = [...existing]
  let added = 0
  for (const p of newP) {
    if (!p.name || !p.name.trim()) continue
    const dup = players.find(ex => isSameCompany(ex.name, p.name, ex.website, p.website))
    if (dup) {
      // Merge: average scores, keep longer oneLiner, fill missing fields
      if (p.executionScore && dup.executionScore) dup.executionScore = Math.round((dup.executionScore + p.executionScore) / 2)
      if (p.visionScore && dup.visionScore) dup.visionScore = Math.round((dup.visionScore + p.visionScore) / 2)
      if ((p.oneLiner?.length||0) > (dup.oneLiner?.length||0)) dup.oneLiner = p.oneLiner
      if (p.website && !dup.website) dup.website = p.website
      if (p.funding && !dup.funding) dup.funding = p.funding
      if (p.stage && !dup.stage) dup.stage = p.stage
      // Merge provenance
      if (p.foundBy?.length) {
        if (!dup.foundBy) dup.foundBy = []
        for (const src of p.foundBy) { if (!dup.foundBy.includes(src)) dup.foundBy.push(src) }
      }
    } else { players.push(p); added++ }
  }
  return { merged: players, added }
}

function saveNewPlayers(mapSlug, subSlug, players) {
  const mapPath = path.join(MAPS_DIR, `${mapSlug}.json`)
  const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"))
  const idx = map.subCategories.findIndex(s => s.slug === subSlug)
  if (idx === -1) return 0
  const sub = map.subCategories[idx]
  const { merged, added } = mergePlayers(sub.topPlayers, players)
  sub.topPlayers = merged; sub.playerCount = merged.length; sub.lastEnrichedAt = new Date().toISOString()
  map.totalPlayers = map.subCategories.reduce((s, sc) => s + (sc.playerCount || sc.topPlayers.length), 0)
  map.lastEnrichedAt = new Date().toISOString()
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2))
  return added
}

function readSub(mapSlug, subSlug) {
  const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${mapSlug}.json`), "utf-8"))
  return map.subCategories.find(s => s.slug === subSlug)
}

// ─── Model picking ───

function live() { return MODELS.filter(m => !getMS(m).dead) }
function liveWeb() { return live().filter(m => m.web) }
function liveAPAC() { return live().filter(m => m.role === "apac-specialist") }
function liveNonWeb() { return live().filter(m => !m.web && m.role !== "apac-specialist") }
function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null }

/** Tag players with the model that found them for provenance tracking. */
function tagPlayers(players, modelLabel) {
  for (const p of players) {
    if (!p.foundBy) p.foundBy = []
    if (!p.foundBy.includes(modelLabel)) p.foundBy.push(modelLabel)
  }
  return players
}

const PLAYER_SCHEMA = `Return JSON: { "newPlayers": [{ "name": "Company Name", "oneLiner": "What they do", "funding": "$XM Series B", "stage": "Growth", "website": "https://...", "executionScore": 0-100, "visionScore": 0-100, "competitiveFactors": [{"factor": "factor name", "score": 1-10}] }], "learnings": ["key fact 1", "key fact 2", ...], "followUpQuestions": ["question 1", "question 2", ...] }`

// ════════════════════════════════════════════════════════════════════════
// PHASE 1: Structured DB Seeding (Firecrawl + LLM extraction)
// ════════════════════════════════════════════════════════════════════════

async function phase1_dbSeeding(target) {
  const dbQueries = [
    `site:crunchbase.com/organization ${target.subName} ${target.mapName}`,
    `site:g2.com/categories ${target.subName} software`,
    `site:capterra.com ${target.subName} software reviews`,
    `site:producthunt.com ${target.subName} tools launches`,
  ]

  // Pick extractors (fast models for content extraction)
  const extractors = liveWeb()
  if (!extractors.length) return { players: [], learnings: [] }

  // If Firecrawl is available, use it for actual content scraping
  if (firecrawlAvailable !== false) {
    const results = await Promise.allSettled(
      dbQueries.map((q, i) => firecrawlExtract(q, target, extractors[i % extractors.length]))
    )
    const players = results.filter(r => r.status === "fulfilled").flatMap(r => r.value.players)
    const learnings = results.filter(r => r.status === "fulfilled").flatMap(r => r.value.learnings)
    if (players.length > 0) {
      log(`    P1 (firecrawl): ${players.length} players from ${results.filter(r=>r.status==="fulfilled").length}/${dbQueries.length} DB queries`)
      return { players, learnings }
    }
  }

  // Fallback: use LLM web search for DB queries
  const results = await Promise.allSettled(
    dbQueries.map((q, i) => {
      const m = extractors[i % extractors.length]
      return dispatch(m,
        `You are a market research analyst with web search. Search structured databases to find companies. ${PLAYER_SCHEMA}\nCRITICAL: Only return REAL companies. Skip EXISTING list.`,
        `Search for: ${q}\n\nFACTORS: ${target.factors.join(", ")}\nEXISTING (skip): ${target.existingNames}`,
        300_000
      ).then(raw => { const d = extractJSON(raw); const p = d.newPlayers || []; tagPlayers(p, `P1+${m.label}`); getMS(m).stats.found += p.length; return { ...d, newPlayers: p } })
    })
  )

  const players = results.filter(r => r.status === "fulfilled").flatMap(r => r.value.newPlayers || [])
  const learnings = results.filter(r => r.status === "fulfilled").flatMap(r => r.value.learnings || [])
  log(`    P1 (web-search): ${players.length} players from ${results.filter(r=>r.status==="fulfilled").length}/${dbQueries.length} DB queries`)
  return { players, learnings }
}

// ════════════════════════════════════════════════════════════════════════
// PHASE 2: Recursive Deep Research (30 queries, batched 3/call)
// ════════════════════════════════════════════════════════════════════════

async function generateQueries(target, learnings, numQueries) {
  const planner = pick(live().filter(m => m.role === "fast")) || pick(live())
  if (!planner) return []

  const learningsCtx = learnings.length
    ? `\nPREVIOUS LEARNINGS:\n${learnings.slice(-30).join("\n")}`
    : ""

  const raw = await dispatch(planner,
    `You generate diverse search queries for competitive intelligence. Output JSON only.`,
    `Generate ${numQueries} diverse search queries to find ALL companies in this market.

VERTICAL: ${target.mapName}
SUB-CATEGORY: ${target.subName}
DESCRIPTION: ${target.subDesc}
KNOWN COMPANIES: ${target.existingNames.split(", ").slice(0, 10).join(", ")}
${learningsCtx}

For each query provide:
- "query": the search query string
- "researchGoal": what this targets and how to expand from results

Generate queries across ALL these axes:
1. Synonyms & adjacent terms (3-4 queries)
2. Problem-framing not solution-framing (2-3 queries)
3. "alternatives to [company]" for top known companies (3-4 queries)
4. Site-specific: "site:crunchbase.com", "site:g2.com", "site:alternativeto.net" (3-4 queries)
5. Market maps & reports: "[space] market map 2025", "[space] landscape" (2-3 queries)
6. Investor/VC portfolios in this space (2-3 queries)
7. Conference sponsors & speakers (1-2 queries)
8. Open source / GitHub projects with commercial backing (2-3 queries)
9. Analyst coverage: Gartner, Forrester, IDC reports (2-3 queries)
10. Regional: "[space] companies Europe/India/Israel" (2-3 queries)

Return JSON: { "queries": [{ "query": "...", "researchGoal": "..." }] }`,
    90_000,
    { webSearch: false }
  )

  const data = extractJSON(raw)
  return (data.queries || []).slice(0, numQueries)
}

/** Process a batch of 3 queries in a single LLM call. */
async function processBatch(model, queryBatch, target) {
  const queriesStr = queryBatch.map((q, i) => `${i+1}. QUERY: ${q.query}\n   GOAL: ${q.researchGoal}`).join("\n")

  const sys = `You are a market research analyst with web search capability.
Search the web for companies matching ALL the queries below. Be EXHAUSTIVE.
${PLAYER_SCHEMA}
Also extract LEARNINGS (key market facts) and FOLLOW-UP QUESTIONS (unexplored angles).
CRITICAL: Only return REAL companies. Skip companies in EXISTING list.`

  const user = `SEARCH QUERIES:
${queriesStr}

VERTICAL: ${target.mapName} / ${target.subName}
FACTORS: ${target.factors.join(", ")}
EXISTING (skip): ${target.existingNames}`

  const raw = await dispatch(model, sys, user, 300_000)
  const data = extractJSON(raw)
  const players = tagPlayers(data.newPlayers || [], model.label)
  getMS(model).stats.found += players.length
  return { players, learnings: data.learnings || [], followUps: data.followUpQuestions || [] }
}

async function deepResearch({ target, breadth, depth, learnings = [] }) {
  if (dead()) return { players: [], learnings }

  // 1. Generate diverse queries
  let queries
  try {
    queries = await generateQueries(target, learnings, breadth)
  } catch (e) {
    log(`    ⚠ query gen failed: ${e.message}`)
    queries = [
      { query: `${target.subName} companies startups 2024 2025`, researchGoal: `Find recently funded startups` },
      { query: `${target.subName} market map competitive landscape`, researchGoal: `Find market maps` },
      { query: `site:crunchbase.com ${target.subName}`, researchGoal: `Search Crunchbase` },
      { query: `alternatives to ${target.existingNames.split(", ")[0] || target.subName}`, researchGoal: `Find via alternatives` },
    ].slice(0, breadth)
  }

  log(`    D${depth} B${breadth}: ${queries.length} queries → ${Math.ceil(queries.length / QUERIES_PER_BATCH)} batches`)

  // 2. Batch queries (3 per API call) and distribute across models
  const webModels = liveWeb()
  const nonWebModels = liveNonWeb()
  if (!webModels.length && !nonWebModels.length) return { players: [], learnings }

  const batches = []
  for (let i = 0; i < queries.length; i += QUERIES_PER_BATCH) {
    batches.push(queries.slice(i, i + QUERIES_PER_BATCH))
  }

  const tasks = []
  for (let i = 0; i < batches.length; i++) {
    // Primary: web model
    if (webModels.length) {
      tasks.push({ model: webModels[i % webModels.length], batch: batches[i] })
    }
    // Secondary: non-web model for every 4th batch
    if (nonWebModels.length && i % 4 === 0) {
      tasks.push({ model: nonWebModels[i % nonWebModels.length], batch: batches[i] })
    }
  }

  // 3. Execute batches in parallel
  const results = await Promise.allSettled(
    tasks.map(t => processBatch(t.model, t.batch, target))
  )

  // 4. Collect results
  let allPlayers = []
  let newLearnings = [...learnings]
  let allFollowUps = []
  for (const r of results) {
    if (r.status !== "fulfilled") continue
    allPlayers.push(...r.value.players)
    newLearnings.push(...r.value.learnings)
    allFollowUps.push(...r.value.followUps)
  }
  const okCount = results.filter(r => r.status === "fulfilled").length
  log(`    D${depth}: ${allPlayers.length} players, ${newLearnings.length - learnings.length} learnings from ${okCount}/${tasks.length} batches`)

  // 5. Save immediately
  if (allPlayers.length) {
    const added = await withLock(target.mapSlug, () => saveNewPlayers(target.mapSlug, target.subSlug, allPlayers))
    if (added > 0) {
      log(`    → +${added} new (depth ${depth})`)
      const sub = readSub(target.mapSlug, target.subSlug)
      if (sub) target.existingNames = sub.topPlayers.map(p => p.name).join(", ")
    }
  }
  newLearnings = [...new Set(newLearnings)]

  // 6. Recurse with follow-up questions
  if (depth > 0 && allFollowUps.length > 0 && !dead()) {
    const newBreadth = Math.ceil(breadth / 2)
    const uniqueFollowUps = [...new Set(allFollowUps)].slice(0, newBreadth * 2)
    const origDesc = target.subDesc
    target.subDesc = `${origDesc}\n\nFOLLOW-UP RESEARCH DIRECTIONS:\n${uniqueFollowUps.join("\n")}`

    const deeper = await deepResearch({ target, breadth: newBreadth, depth: depth - 1, learnings: newLearnings })
    target.subDesc = origDesc
    allPlayers = [...allPlayers, ...deeper.players]
    newLearnings = [...new Set([...newLearnings, ...deeper.learnings])]
  }

  return { players: allPlayers, learnings: newLearnings }
}

// ════════════════════════════════════════════════════════════════════════
// PHASE 3: Snowball Expansion (Firecrawl + LLM)
// ════════════════════════════════════════════════════════════════════════

async function phase3_snowball(target, learnings) {
  const sub = readSub(target.mapSlug, target.subSlug)
  if (!sub || sub.topPlayers.length < 5) return []

  const webModels = liveWeb()
  if (!webModels.length) return []

  // Pick top companies by funding as seeds
  const seeds = [...sub.topPlayers]
    .sort((a, b) => {
      const fa = parseFloat((a.funding || "0").replace(/[^0-9.]/g, "")) || 0
      const fb = parseFloat((b.funding || "0").replace(/[^0-9.]/g, "")) || 0
      return fb - fa
    })
    .slice(0, 8)

  const existingNames = sub.topPlayers.map(p => p.name).join(", ")
  const seedNames = seeds.map(s => s.name).join(", ")

  // Snowball queries — each is a distinct discovery angle
  const snowballQueries = [
    { label: "alternatives", query: `alternatives to ${seeds.slice(0,3).map(s=>s.name).join(" OR ")} ${target.subName}` },
    { label: "alternatives2", query: `${seeds.slice(3,6).map(s=>s.name+" competitors").join(", ")}` },
    { label: "investors", query: `investors in ${seedNames.split(", ").slice(0,3).join(", ")} portfolio ${target.subName} companies` },
    { label: "oss", query: `GitHub open source ${target.subName} projects commercial company` },
    { label: "conferences", query: `${target.subName} conference 2024 2025 sponsors speakers exhibitors` },
    { label: "jobs", query: `${target.subName} companies hiring jobs site:linkedin.com OR site:indeed.com` },
  ]

  const tasks = []

  // If Firecrawl is available, use it for content-based extraction
  if (firecrawlAvailable === true) {
    for (const sq of snowballQueries) {
      const m = pick(webModels)
      tasks.push(firecrawlExtract(sq.query, target, m).then(r => r.players))
    }
  }

  // Also use LLM web search for snowball (works even without Firecrawl)
  const sys = `You are a market research analyst using snowball methods to discover companies.
For each company already found, trace outward:
- Their competitors and alternatives
- Investors who funded them → other companies those VCs backed in the same space
- Open source projects in this domain with commercial backing
- Conference sponsors and speakers
Return JSON: { "newPlayers": [{ "name", "oneLiner", "funding", "stage", "website", "executionScore", "visionScore" }] }`

  // Batch snowball queries for LLM
  const snowM1 = pick(webModels), snowM2 = pick(webModels)
  tasks.push(
    dispatch(snowM1, sys,
      `TOP COMPANIES IN ${target.subName}:\n${seeds.map(s => `- ${s.name}: ${s.oneLiner} (${s.funding||"?"})`).join("\n")}\n\nFind ALL their competitors, alternatives, and companies backed by the same investors.\nFACTORS: ${target.factors.join(", ")}\nEXISTING (skip): ${existingNames}`,
      300_000
    ).then(raw => { const d = extractJSON(raw); return tagPlayers(d.newPlayers || [], `SNOW+${snowM1.label}`) })
  )

  tasks.push(
    dispatch(snowM2, sys,
      `Search for open-source projects and conference participants in "${target.subName}".\nAlso find companies hiring for ${target.subName} roles.\nFACTORS: ${target.factors.join(", ")}\nEXISTING (skip): ${existingNames}`,
      300_000
    ).then(raw => { const d = extractJSON(raw); return tagPlayers(d.newPlayers || [], `SNOW+${snowM2.label}`) })
  )

  const results = await Promise.allSettled(tasks)
  const players = results.filter(r => r.status === "fulfilled").flatMap(r => r.value)
  log(`    SNOW: ${players.length} raw from ${results.filter(r=>r.status==="fulfilled").length}/${tasks.length} snowball tasks`)
  return players
}

// ════════════════════════════════════════════════════════════════════════
// PHASE 3b: Tail Hunting (incubators, indie, early-stage)
// ════════════════════════════════════════════════════════════════════════

/**
 * Hunt for long-tail companies that main research misses:
 * - Accelerator/incubator portfolios (YC, Techstars, 500 Global, etc.)
 * - Indie/micro-SaaS directories (Indie Hackers, MicroConf)
 * - Early-stage launch platforms (Show HN, ProductHunt recent)
 * - App stores & marketplaces
 * - Academic spin-offs and government registries
 */
async function phase3b_tailHunting(target) {
  const sub = readSub(target.mapSlug, target.subSlug)
  const existingNames = sub ? sub.topPlayers.map(p => p.name).join(", ") : target.existingNames
  const webModels = liveWeb()
  if (!webModels.length) return []

  const tailQueries = [
    // Accelerator portfolios
    { label: "yc", query: `site:ycombinator.com/companies "${target.subName}" OR "${target.mapName}"` },
    { label: "techstars", query: `Techstars portfolio ${target.subName} companies` },
    { label: "accelerators", query: `500 Global OR Plug and Play OR Antler portfolio ${target.subName} startups` },
    // Indie & micro-SaaS
    { label: "indie", query: `${target.subName} indie hackers OR micro-SaaS OR bootstrapped OR solo founder` },
    { label: "launches", query: `site:producthunt.com ${target.subName} launched 2024 OR 2025` },
    { label: "showhn", query: `site:news.ycombinator.com "Show HN" ${target.subName}` },
    // App stores & marketplaces
    { label: "appstore", query: `${target.subName} app OR plugin OR extension marketplace new startup` },
    // Academic & gov
    { label: "spinoffs", query: `${target.subName} university spin-off OR research commercialization OR SBIR grant` },
  ]

  const tasks = []

  // Use Firecrawl if available for deeper extraction
  if (firecrawlAvailable === true) {
    for (const tq of tailQueries.slice(0, 4)) {
      const m = pick(webModels)
      tasks.push(firecrawlExtract(tq.query, target, m).then(r => tagPlayers(r.players, `TAIL+FC+${m.label}`)))
    }
  }

  // LLM web search for remaining queries (batched 4/call for efficiency)
  const sys = `You are a market research analyst specializing in finding EARLY-STAGE and UNKNOWN companies.
Focus on: accelerator alumni, bootstrapped startups, indie makers, academic spin-offs, recent launches.
These are companies that mainstream databases and market reports often MISS.
${PLAYER_SCHEMA}
CRITICAL: Only return REAL companies. Skip EXISTING list. Prefer companies <3 years old or <$5M funding.`

  // Batch all tail queries into 2 LLM calls
  const half = Math.ceil(tailQueries.length / 2)
  for (let batch = 0; batch < 2; batch++) {
    const batchQs = tailQueries.slice(batch * half, (batch + 1) * half)
    const tailModel = pick(webModels)
    tasks.push(
      dispatch(tailModel, sys,
        `VERTICAL: ${target.mapName} / ${target.subName}
SEARCH THESE ANGLES:
${batchQs.map((q, i) => `${i+1}. [${q.label}] ${q.query}`).join("\n")}

FACTORS: ${target.factors.join(", ")}
EXISTING (skip): ${existingNames}

Find every early-stage company, indie product, and recent launch in this space.`,
        300_000
      ).then(raw => { const d = extractJSON(raw); return tagPlayers(d.newPlayers || [], `TAIL+${tailModel.label}`) })
    )
  }

  const results = await Promise.allSettled(tasks)
  const players = results.filter(r => r.status === "fulfilled").flatMap(r => r.value)
  log(`    TAIL: ${players.length} raw from ${results.filter(r=>r.status==="fulfilled").length}/${tasks.length} tail-hunting tasks`)
  return players
}

// ════════════════════════════════════════════════════════════════════════
// PHASE 4: Geographic Expansion (APAC models + localized web queries)
// ════════════════════════════════════════════════════════════════════════

async function phase4_geographic(target, learnings) {
  const apacModels = liveAPAC()
  const webModels = liveWeb()

  const sub = readSub(target.mapSlug, target.subSlug)
  const existingNames = sub ? sub.topPlayers.map(p => p.name).join(", ") : target.existingNames
  const learningsCtx = learnings.length ? `\nMARKET LEARNINGS:\n${learnings.slice(-15).join("\n")}` : ""

  const tasks = []

  // APAC specialists (training data)
  if (apacModels.length) {
    const sys = `You specialize in international/non-US technology companies.
Find companies from: Europe, Israel, India, China, Japan, Korea, Southeast Asia, Brazil, Africa, Middle East.
Include local champions and companies English-language databases miss.
Return JSON: { "newPlayers": [{ "name", "oneLiner", "funding", "stage", "website", "executionScore", "visionScore" }] }
CRITICAL: Focus on NON-US companies. Skip EXISTING list.`

    for (const m of apacModels) {
      tasks.push(
        dispatch(m, sys,
          `VERTICAL: ${target.mapName} / ${target.subName}\nDESCRIPTION: ${target.subDesc}${learningsCtx}\nFACTORS: ${target.factors.join(", ")}\nEXISTING (skip): ${existingNames}\n\nBe exhaustive for your region.`,
          300_000
        ).then(raw => { const d = extractJSON(raw); const p = tagPlayers(d.newPlayers || [], `GEO+${m.label}`); getMS(m).stats.found += p.length; return p })
      )
    }
  }

  // Localized web queries via web-search models
  if (webModels.length) {
    const regions = ["Europe", "Israel", "India", "China Japan Korea", "Southeast Asia Brazil"]
    for (let i = 0; i < regions.length; i++) {
      const m = webModels[i % webModels.length]
      tasks.push(
        dispatch(m,
          `You are a market analyst. Use web search to find ${target.subName} companies in ${regions[i]}. Return JSON: { "newPlayers": [{ "name", "oneLiner", "funding", "stage", "website", "executionScore", "visionScore" }] }`,
          `Search for "${target.subName} companies ${regions[i]}" and "${target.subName} startups ${regions[i]}".\nFACTORS: ${target.factors.join(", ")}\nEXISTING (skip): ${existingNames}`,
          300_000
        ).then(raw => { const d = extractJSON(raw); const p = tagPlayers(d.newPlayers || [], `GEO+${m.label}`); getMS(m).stats.found += p.length; return p })
      )
    }
  }

  if (!tasks.length) return []
  const results = await Promise.allSettled(tasks)
  const players = results.filter(r => r.status === "fulfilled").flatMap(r => r.value)
  log(`    GEO: ${players.length} raw from ${results.filter(r=>r.status==="fulfilled").length}/${tasks.length} tasks`)
  return players
}

// ════════════════════════════════════════════════════════════════════════
// PHASE 5: Gap Analysis + Targeted Fills
// ════════════════════════════════════════════════════════════════════════

async function phase5_gapFills(target, learnings) {
  const sub = readSub(target.mapSlug, target.subSlug)
  if (!sub || sub.topPlayers.length < 10) return []

  const analyst = pick(live().filter(m => m.role === "fast" || m.role === "analyst")) || pick(live())
  if (!analyst) return []

  const playerList = sub.topPlayers.map(p => `${p.name} (${p.funding||"?"}, ${p.stage||"?"})`).join("\n")
  const learningsCtx = learnings.length ? `\nLEARNINGS:\n${learnings.slice(-20).join("\n")}` : ""

  let gaps
  try {
    const raw = await dispatch(analyst,
      `Analyze gaps in a competitive intelligence database. Return JSON only.`,
      `VERTICAL: ${target.mapName} / ${target.subName}\n\nDATABASE (${sub.topPlayers.length} companies):\n${playerList}${learningsCtx}\n\nWhat's MISSING? Check geographic, stage, technology, business model, and temporal gaps.\n\nReturn JSON: { "gaps": [{"angle": "gap description", "query": "search query to fill it"}], "saturation": 0-100 }`,
      120_000,
      { webSearch: false }
    )
    const d = extractJSON(raw)
    gaps = d.gaps || []
    const sat = d.saturation || 50
    log(`    GAPS: ${gaps.length} found, saturation=${sat}%`)
    if (sat >= 85 || gaps.length === 0) return []
  } catch { return [] }

  const webModels = liveWeb()
  if (!webModels.length) return []
  const existingNames = sub.topPlayers.map(p => p.name).join(", ")

  const results = await Promise.allSettled(
    gaps.slice(0, 5).map(gap =>
      ((gapModel) => dispatch(gapModel,
        `Fill a gap in a competitive intelligence database. Return JSON: { "newPlayers": [{ "name", "oneLiner", "funding", "stage", "website", "executionScore", "visionScore" }] }`,
        `GAP: ${gap.angle}\nSEARCH: ${gap.query}\nVERTICAL: ${target.mapName} / ${target.subName}\nFACTORS: ${target.factors.join(", ")}\nEXISTING (skip): ${existingNames}`,
        300_000
      ).then(raw => { const d = extractJSON(raw); return tagPlayers(d.newPlayers || [], `GAP+${gapModel.label}`) }))(pick(webModels))
    )
  )

  const players = results.filter(r => r.status === "fulfilled").flatMap(r => r.value)
  log(`    GAPS: ${players.length} raw from ${results.filter(r=>r.status==="fulfilled").length}/${Math.min(5,gaps.length)} fills`)
  return players
}

// ════════════════════════════════════════════════════════════════════════
// PHASE 6: Chao1 Species Richness Estimation (provenance-based)
// ════════════════════════════════════════════════════════════════════════

/**
 * Chao1 estimator: S_hat = S_obs + (f1² / 2·f2)
 * where S_obs = observed species count, f1 = singletons (found by 1 source),
 * f2 = doubletons (found by 2 sources).
 *
 * Uses the foundBy provenance arrays rather than separate sampling rounds,
 * giving us a free estimate from existing data.
 *
 * Also computes a discovery curve (cumulative unique vs. total observations)
 * to visualize whether we're approaching saturation.
 */
function chao1Estimate(target) {
  const sub = readSub(target.mapSlug, target.subSlug)
  if (!sub || sub.topPlayers.length < 15) return null

  const players = sub.topPlayers
  const S_obs = players.length

  // Count singletons (f1) and doubletons (f2) based on foundBy provenance
  let f1 = 0, f2 = 0, tagged = 0
  for (const p of players) {
    const n = p.foundBy?.length || 0
    if (n === 0) continue
    tagged++
    if (n === 1) f1++
    else if (n === 2) f2++
  }

  // If no provenance data, fall back to Lincoln-Petersen with heuristic
  if (tagged < S_obs * 0.3) return { method: "none", S_obs, estimated: null, coverage: null, reason: "insufficient provenance data" }

  // Chao1: handle f2=0 case (bias-corrected form)
  let S_hat
  if (f2 > 0) {
    S_hat = S_obs + (f1 * f1) / (2 * f2)
  } else if (f1 > 0) {
    // Bias-corrected when f2=0: S_hat = S_obs + f1*(f1-1)/2
    S_hat = S_obs + (f1 * (f1 - 1)) / 2
  } else {
    // All species observed multiple times — near-complete coverage
    S_hat = S_obs
  }

  S_hat = Math.round(S_hat)
  const coverage = Math.round((S_obs / S_hat) * 100)

  // Source diversity: how many unique sources contribute
  const allSources = new Set()
  for (const p of players) for (const src of p.foundBy || []) allSources.add(src)

  // Discovery curve: shuffle players and compute cumulative unique sources
  const shuffled = [...players].sort(() => Math.random() - 0.5)
  const curve = []
  const seen = new Set()
  for (let i = 0; i < shuffled.length; i++) {
    seen.add(normalizeName(shuffled[i].name))
    if ((i + 1) % Math.ceil(shuffled.length / 10) === 0 || i === shuffled.length - 1) {
      curve.push({ obs: i + 1, unique: seen.size })
    }
  }

  return {
    method: "chao1", S_obs, f1, f2, S_hat, coverage,
    sources: allSources.size, tagged, curve,
  }
}

// ════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════════

const stats = { rounds: 0, subcats: 0, totalAdded: 0 }

async function enrichSubcategory(target) {
  const startCount = target.playerCount
  log(`  🔬 ${target.mapSlug}/${target.subName} (${startCount} players)`)
  let totalAdded = 0

  async function mergePhase(name, players) {
    if (!players.length) return
    const added = await withLock(target.mapSlug, () => saveNewPlayers(target.mapSlug, target.subSlug, players))
    totalAdded += added
    if (added > 0) log(`    → +${added} new after ${name} (from ${players.length} raw)`)
    const sub = readSub(target.mapSlug, target.subSlug)
    if (sub) target.existingNames = sub.topPlayers.map(p => p.name).join(", ")
  }

  // Phase 1: DB Seeding
  if (!dead()) {
    const p1 = await phase1_dbSeeding(target)
    await mergePhase("P1-db", p1.players)
    var phaseLearnings = p1.learnings || []
  }

  // Phase 2: Recursive Deep Research
  if (!dead()) {
    const p2 = await deepResearch({
      target, breadth: RESEARCH_BREADTH, depth: RESEARCH_DEPTH,
      learnings: phaseLearnings || [],
    })
    // Players saved inside deepResearch
    const sub2 = readSub(target.mapSlug, target.subSlug)
    totalAdded = sub2 ? sub2.topPlayers.length - startCount : totalAdded
    phaseLearnings = p2.learnings
  }

  // Phase 3: Snowball Expansion
  if (!dead()) await mergePhase("P3-snowball", await phase3_snowball(target, phaseLearnings || []))

  // Phase 3b: Tail Hunting (incubators, indie, early-stage)
  if (!dead()) await mergePhase("P3b-tail", await phase3b_tailHunting(target))

  // Phase 4: Geographic Expansion
  if (!dead()) await mergePhase("P4-geo", await phase4_geographic(target, phaseLearnings || []))

  // Phase 5: Gap Analysis
  if (!dead()) await mergePhase("P5-gaps", await phase5_gapFills(target, phaseLearnings || []))

  const sub = readSub(target.mapSlug, target.subSlug)
  const finalCount = sub ? sub.topPlayers.length : startCount + totalAdded
  totalAdded = finalCount - startCount
  log(`  ✅ ${target.mapSlug}/${target.subName}: ${startCount} → ${finalCount} (+${totalAdded})`)
  return totalAdded
}

// ─── Load & prioritize ───

function loadTargets() {
  const mapFiles = fs.readdirSync(MAPS_DIR).filter(f => f.endsWith(".json"))
  const targets = []
  for (const f of mapFiles) {
    const slug = f.replace(".json", "")
    if (SLUG_FILTER && slug !== SLUG_FILTER) continue
    const map = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), "utf-8"))
    for (const sub of map.subCategories || []) {
      targets.push({
        mapSlug: slug, mapName: map.name, subSlug: sub.slug, subName: sub.name,
        subDesc: sub.description, keyGaps: sub.keyGaps || [], factors: map.strategyCanvasFactors || [],
        existingNames: sub.topPlayers.map(p => p.name).join(", "),
        playerCount: sub.topPlayers.length, opportunityScore: sub.opportunityScore || 50,
      })
    }
  }
  targets.sort((a, b) => (a.playerCount - a.opportunityScore * 0.5) - (b.playerCount - b.opportunityScore * 0.5))
  return targets
}

// ─── Stats ───

function printStats() {
  const elapsed = ((Date.now() - startTime) / 60_000).toFixed(1)
  console.log(`\n${"═".repeat(75)}`)
  console.log(`  STATS — ${elapsed} min | Round ${stats.rounds} | Subcats: ${stats.subcats} | New: ${stats.totalAdded}`)
  console.log(`  ${"─".repeat(71)}`)
  console.log(`  ${"Model".padEnd(12)} ${"OK".padStart(4)} ${"Err".padStart(4)} ${"Rtry".padStart(5)} ${"Found".padStart(6)}  ${"Web".padStart(4)}  State`)
  const families = [...new Set(MODELS.map(m => m.family))]
  for (const fam of families) {
    const fs_ = familyState.get(fam)
    const c = fs_ ? fs_.sem.active : 0
    const max = FAMILY_CONCURRENCY[fam] || 1
    console.log(`  ── ${fam} (c=${c}/${max}) ──`)
    for (const m of MODELS.filter(m2 => m2.family === fam)) {
      const ms = modelState.get(m.id); if (!ms) continue
      const st = ms.dead ? "💀" : ms.noStream ? "ns" : "ok"
      console.log(`  ${m.label.padEnd(12)} ${String(ms.stats.ok).padStart(4)} ${String(ms.stats.err).padStart(4)} ${String(ms.stats.retries).padStart(5)} ${String(ms.stats.found).padStart(6)}  ${(m.web?"✓":"·").padStart(4)}  ${st}`)
    }
  }
  if (firecrawlAvailable === true) console.log(`  Firecrawl: ✓ (${FIRECRAWL_BASE})`)
  else if (firecrawlAvailable === false) console.log(`  Firecrawl: ✗`)
  console.log(`${"═".repeat(75)}\n`)
}

// ─── Discovery ───

async function discoverModels() {
  const res = await fetch(`${CLIPROXY_BASE}/v1/models`, { headers: { Authorization: `Bearer ${CLIPROXY_KEY}` }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const available = new Set()
  for (const m of data.data || data.models || []) { const id = typeof m === "string" ? m : m.id || m.name; if (id) available.add(id) }
  return MODELS.filter(m => available.has(m.model))
}

async function checkFirecrawl() {
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/`, { signal: AbortSignal.timeout(5_000) })
    firecrawlAvailable = res.ok || res.status === 404 || res.status === 405 // any response = server is up
    // Also try the actual search endpoint
    const test = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(FIRECRAWL_KEY ? { Authorization: `Bearer ${FIRECRAWL_KEY}` } : {}) },
      body: JSON.stringify({ query: "test", limit: 1 }),
      signal: AbortSignal.timeout(10_000),
    })
    firecrawlAvailable = test.ok
  } catch { firecrawlAvailable = false }
}

// ─── Main ───

async function main() {
  let available
  try { available = await discoverModels() } catch (e) { console.error(`CLIProxyAPI unreachable: ${e.message}`); process.exit(1) }
  if (!available.length) { console.error("No models"); process.exit(1) }
  const availableIds = new Set(available.map(m => m.id))
  for (const m of MODELS) {
    getMS(m); getFS(m.family)
    if (!availableIds.has(m.id)) { getMS(m).dead = true } // mark undiscovered models dead
  }
  // Gem3Pro returns empty responses through this proxy — disable it
  const gem3proMs = modelState.get("gemini-3-pro")
  if (gem3proMs) { gem3proMs.dead = true; log("  ⚠ Gem3Pro disabled (known empty response issue with proxy)") }

  await checkFirecrawl()

  const webCount = available.filter(m => m.web).length

  console.log(`\n${"═".repeat(75)}`)
  console.log(`  RECON v4 — Recursive Deep Research System`)
  console.log(`  Duration: ${HOURS}h (until ${new Date(DEADLINE).toLocaleTimeString()})`)
  console.log(`  Models: ${available.length} across ${new Set(available.map(m=>m.family)).size} families`)
  console.log(`  Research: depth=${RESEARCH_DEPTH}, breadth=${RESEARCH_BREADTH}, batch=${QUERIES_PER_BATCH}`)
  console.log(`  Firecrawl: ${firecrawlAvailable ? `✓ (${FIRECRAWL_BASE})` : "✗ (falling back to LLM web search)"}`)
  console.log(`  Sub concurrency: ${SUB_CONCURRENCY}`)
  console.log(`  Pipeline per subcategory:`)
  console.log(`    P1: DB Seeding (${firecrawlAvailable ? "Firecrawl" : "LLM web search"} → Crunchbase, G2, Capterra, PH)`)
  console.log(`    P2: Recursive Search (${RESEARCH_BREADTH} queries batched ${QUERIES_PER_BATCH}/call, depth=${RESEARCH_DEPTH})`)
  console.log(`    P3: Snowball (alternatives, investors, OSS, conferences, jobs)`)
  console.log(`    P3b: Tail Hunting (YC, Techstars, indie hackers, Show HN, app stores, spin-offs)`)
  console.log(`    P4: Geographic (${liveAPAC().length} APAC + ${Math.min(5, webCount)} localized web queries)`)
  console.log(`    P5: Gap Analysis + Targeted Fills`)
  console.log(`    P6: Chao1 Estimation (provenance-based species richness)`)
  for (const fam of [...new Set(available.map(m=>m.family))]) {
    const models = available.filter(m => m.family === fam)
    console.log(`    ${fam.padEnd(10)} [c=${FAMILY_CONCURRENCY[fam]||1}] ${models.map(m => `${m.label}(${m.role})`).join(", ")}`)
  }
  if (SLUG_FILTER) console.log(`  Filter: ${SLUG_FILTER}`)
  console.log(`${"═".repeat(75)}\n`)

  const statsInt = setInterval(printStats, 5 * 60_000)
  const subSem = makeSem(SUB_CONCURRENCY)

  while (!dead()) {
    stats.rounds++
    const targets = loadTargets()
    log(`Round ${stats.rounds}: ${targets.length} subcategories, ${live().length} live models`)

    await Promise.allSettled(targets.map(async t => {
      if (dead()) return
      await subSem.acquire()
      try {
        if (dead()) return
        const added = await enrichSubcategory(t)
        stats.subcats++; stats.totalAdded += added
      } catch (e) { log(`  ❌ ${t.mapSlug}/${t.subName}: ${e.message}`) }
      finally { subSem.release() }
    }))

    // Phase 6: Chao1 estimation on subcategories with provenance data
    if (!dead()) {
      const sample = targets.filter(t => {
        const s = readSub(t.mapSlug, t.subSlug)
        return s && s.topPlayers.length >= 15
      }).sort(() => Math.random() - 0.5).slice(0, 5)

      if (sample.length) {
        log("  📊 Chao1 species richness estimation...")
        for (const t of sample) {
          const est = chao1Estimate(t)
          if (!est) continue
          if (est.method === "none") {
            log(`    ${t.subName}: ${est.S_obs} found — ${est.reason}`)
          } else {
            log(`    ${t.subName}: ${est.S_obs} found, ~${est.S_hat} estimated (${est.coverage}% coverage) [f1=${est.f1}, f2=${est.f2}, sources=${est.sources}]`)
          }
        }
      }
    }

    if (dead()) break
    log("Round complete."); printStats(); await sleep(10_000)
  }

  clearInterval(statsInt); console.log("\n⏰ Done!"); printStats()
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
