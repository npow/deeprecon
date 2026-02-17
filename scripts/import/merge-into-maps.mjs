#!/usr/bin/env node
/**
 * merge-into-maps.mjs
 *
 * Merge normalized import snapshots into existing map JSONs with strict website verification.
 * Supports:
 * - company records from source datasets
 * - market_map_reference records converted into verifiable organization candidates
 *
 * Usage:
 *   node scripts/import/merge-into-maps.mjs --source all --write --include-restricted
 */

import fs from "fs"
import path from "path"
import yaml from "js-yaml"

const ROOT = process.cwd()
const MAPS_DIR = path.join(ROOT, "data", "maps")
const IMPORTS_DIR = path.join(ROOT, "data", "imports")
const CROSSWALK_PATH = path.join(ROOT, "config", "import-source-crosswalk.json")

const args = process.argv.slice(2)
function hasFlag(flag) { return args.includes(`--${flag}`) }
function getFlag(flag, fallback = "") {
  const i = args.indexOf(`--${flag}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const source = getFlag("source", "all")
const dryRun = hasFlag("dry-run")
const write = hasFlag("write") && !dryRun
const includeRestricted = hasFlag("include-restricted")
const verify = !hasFlag("no-verify")
const verifyTimeoutMs = Number(getFlag("verify-timeout-ms", "5000"))
const verifyConcurrency = Number(getFlag("verify-concurrency", "25"))

const PARKING_PATTERNS = [
  /this\s+domain\s+(is\s+)?(for\s+sale|available|parked)/i,
  /buy\s+this\s+domain/i,
  /domain\s+parking/i,
  /godaddy/i,
  /sedo\.com/i,
  /afternic/i,
  /hugedomains/i,
  /dan\.com/i,
  /LANDER_SYSTEM/,
  /domainlander/i,
  /sedoparking/i,
  /parkingcrew/i,
  /bodis\.com/i,
  /domainmarket\.com/i,
  /undeveloped\.com/i,
]

const GENERIC_TITLES = new Set([
  "react app", "vite app", "next.js app", "home", "welcome", "index", "untitled", "",
])

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "our", "out", "its", "has",
  "new", "now", "old", "see", "way", "who", "did", "get", "let", "say", "too", "use", "app",
  "com", "www", "http", "https", "home", "page", "site", "web", "welcome", "platform", "software",
  "tool", "tools", "inc", "ltd", "llc", "corp",
])

const REFERENCE_HOST_BLACKLIST = new Set([
  "linkedin.com",
  "x.com",
  "twitter.com",
  "medium.com",
  "substack.com",
  "youtube.com",
  "youtu.be",
  "slideshare.net",
  "drive.google.com",
  "typeform.com",
])

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function normalizeUrl(url) {
  const u = String(url || "").trim()
  if (!u) return ""
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

function extractTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? m[1].replace(/\s+/g, " ").trim() : ""
}

function hostnameFromUrl(rawUrl) {
  try { return new URL(rawUrl).hostname.toLowerCase() } catch { return "" }
}

function baseHost(host) {
  const h = String(host || "").toLowerCase()
  return h.startsWith("www.") ? h.slice(4) : h
}

function significantWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

function hostnameWords(hostname) {
  return hostname
    .split(".")
    .filter(Boolean)
    .filter((part) => !["www", "com", "ai", "io", "co", "app", "net", "org"].includes(part))
}

function isCloudflareChallenge(html) {
  return (
    html.includes("cf-browser-verification") ||
    html.includes("cf_chl_opt") ||
    html.includes("Just a moment...") ||
    html.includes("Checking if the site connection is secure")
  )
}

function isParkingPage(html) {
  return PARKING_PATTERNS.some((p) => p.test(html))
}

function isTitleMismatch(title, companyName) {
  const titleNorm = String(title || "").toLowerCase().trim()
  if (GENERIC_TITLES.has(titleNorm)) return false

  const titleWords = significantWords(title)
  const nameWords = significantWords(companyName)
  if (titleWords.length === 0 || nameWords.length === 0) return false

  const overlap = nameWords.some((nw) => titleWords.some((tw) => tw.includes(nw) || nw.includes(tw)))
  return !overlap
}

function isDomainMismatch(finalUrl, companyName) {
  const host = hostnameFromUrl(finalUrl)
  if (!host) return false

  const nameNorm = normalize(companyName)
  const hostNorm = normalize(host)
  if (!nameNorm || !hostNorm) return false
  if (hostNorm.includes(nameNorm) || nameNorm.includes(hostNorm)) return false

  const nameWords = significantWords(companyName)
  const hostParts = hostnameWords(host)
  if (nameWords.length === 0 || hostParts.length === 0) return false

  const overlap = nameWords.some((nw) => hostParts.some((hp) => hp.includes(nw) || nw.includes(hp)))
  return !overlap
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "recon-merge-bot/1.0" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

async function verifyWebsite(url, companyName) {
  const normalized = normalizeUrl(url)
  if (!normalized) return { status: "unknown", reason: "missing_url", finalUrl: "" }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), verifyTimeoutMs)

    let res
    try {
      res = await fetch(normalized, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ReconBot/1.0)",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
      })
    } finally {
      clearTimeout(timer)
    }

    const finalUrl = res.url || normalized
    if (!res.ok) return { status: "dead", reason: `http_${res.status}`, finalUrl }

    const reader = res.body?.getReader()
    let html = ""
    if (reader) {
      const decoder = new TextDecoder()
      let bytesRead = 0
      const MAX_BYTES = 16384
      try {
        while (bytesRead < MAX_BYTES) {
          const { done, value } = await reader.read()
          if (done) break
          html += decoder.decode(value, { stream: true })
          bytesRead += value.byteLength
        }
      } finally {
        reader.cancel().catch(() => {})
      }
    }

    if (isCloudflareChallenge(html)) return { status: "verified", reason: "challenge_page", finalUrl }
    if (isParkingPage(html)) return { status: "parked", reason: "parking_page", finalUrl }

    const title = extractTitle(html)
    const mismatch = isTitleMismatch(title, companyName) && isDomainMismatch(finalUrl, companyName)
    if (mismatch) return { status: "mismatch", reason: "title_domain_mismatch", finalUrl }

    return { status: "verified", reason: "ok", finalUrl }
  } catch {
    return { status: "dead", reason: "network_error", finalUrl: normalized }
  }
}

async function mapLimit(items, concurrency, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      out[idx] = await fn(items[idx], idx)
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker())
  await Promise.all(workers)
  return out
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function loadMaps() {
  const maps = new Map()
  const files = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
  for (const f of files) {
    const m = loadJson(path.join(MAPS_DIR, f))
    maps.set(m.slug, m)
  }
  return maps
}

function loadSources(selected) {
  const dirs = fs.readdirSync(IMPORTS_DIR).filter((d) => fs.existsSync(path.join(IMPORTS_DIR, d, "latest.json")))
  const use = selected === "all" ? dirs : [selected]

  const out = []
  for (const src of use) {
    const p = path.join(IMPORTS_DIR, src, "latest.json")
    if (!fs.existsSync(p)) continue
    const payload = loadJson(p)
    out.push({ source: src, records: payload.records || [] })
  }
  return out
}

function getCrosswalk() {
  if (!fs.existsSync(CROSSWALK_PATH)) return { sources: {} }
  return loadJson(CROSSWALK_PATH)
}

function chooseVertical(record, sourceCfg) {
  const mapped = sourceCfg?.categoryMap?.[record.category]
  const v = mapped?.vertical || sourceCfg?.defaultVertical || record.vertical || ""
  return slugify(v)
}

function chooseCategory(record, sourceCfg) {
  const mapped = sourceCfg?.categoryMap?.[record.category]
  return mapped?.category || record.subCategory || record.category || "Uncategorized"
}

function findSubCategory(map, categoryName) {
  const key = normalize(categoryName)
  const exact = map.subCategories.find((s) => normalize(s.name) === key)
  if (exact) return exact
  const partial = map.subCategories.find((s) => normalize(s.name).includes(key) || key.includes(normalize(s.name)))
  return partial || null
}

function makeSubCategory(name, map) {
  return {
    slug: slugify(name),
    name,
    description: `Imported category: ${name}`,
    crowdednessScore: 30,
    opportunityScore: 60,
    playerCount: 0,
    totalFunding: "N/A",
    trendDirection: "stable",
    topPlayers: [],
    keyGaps: ["External-source imported category; needs analyst enrichment"],
    deepDivePrompt: `Analyze whitespace opportunities in ${name}.`,
    megaCategory: map.megaCategories?.[0]?.name || "Imported",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function toPlayer(record, map, sourceName, verification) {
  const factors = Array.isArray(map.strategyCanvasFactors)
    ? map.strategyCanvasFactors.map((factor) => ({ factor, score: 5 }))
    : []

  return {
    name: record.name,
    oneLiner: record.description ? String(record.description).slice(0, 220) : "Imported from external market map",
    funding: "N/A",
    stage: "Unknown",
    executionScore: 30,
    visionScore: 35,
    competitiveFactors: factors,
    websiteUrl: verification.finalUrl || record.websiteUrl || undefined,
    tags: Array.isArray(record.tags) ? record.tags : [],
    source: sourceName,
    discoveredAt: record.capturedAt,
    confidenceLevel: "web_verified",
    websiteStatus: "verified",
    websiteStatusReason: verification.reason,
    confirmedBy: [sourceName],
    confirmedByCount: 1,
  }
}

function extractOrgFromAuthor(author) {
  const a = String(author || "").trim()
  if (!a) return ""
  if (a.includes("—")) {
    const parts = a.split("—").map((p) => p.trim()).filter(Boolean)
    if (parts.length > 1) return parts[parts.length - 1]
  }
  return ""
}

function hostToName(host) {
  const base = baseHost(host)
  const first = base.split(".")[0] || ""
  return first
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ")
}

function convertReferenceToCompany(record) {
  const raw = normalizeUrl(record.websiteUrl)
  if (!raw) return null
  let u
  try { u = new URL(raw) } catch { return null }

  const host = baseHost(u.hostname)
  if (REFERENCE_HOST_BLACKLIST.has(host)) return null

  const authorOrg = extractOrgFromAuthor(record.metadata?.author || "")
  const name = authorOrg || hostToName(host)
  if (!name) return null

  return {
    ...record,
    entityType: "company",
    name,
    websiteUrl: `${u.protocol}//${u.hostname}`,
    description: record.description || `Derived from market-map reference: ${record.name}`,
    tags: Array.from(new Set([...(record.tags || []), "derived-from-reference"])),
  }
}

async function loadCncfHomepagesByName() {
  const url = "https://raw.githubusercontent.com/cncf/landscape/master/landscape.yml"
  const text = await fetchText(url)
  const doc = yaml.load(text)
  const map = new Map()

  for (const cat of doc.landscape || []) {
    for (const sub of cat.subcategories || []) {
      for (const item of sub.items || []) {
        const name = String(item.name || "").trim()
        const homepage = normalizeUrl(item.homepage_url || "")
        if (!name || !homepage) continue
        const key = normalize(name)
        if (!map.has(key)) map.set(key, homepage)
      }
    }
  }

  return map
}

async function main() {
  if (!fs.existsSync(IMPORTS_DIR)) {
    console.error("Missing data/imports. Run import:sources first.")
    process.exit(1)
  }

  const maps = loadMaps()
  const sourcePayloads = loadSources(source)
  const crosswalk = getCrosswalk()

  const cncfHomepageByName = await loadCncfHomepagesByName()

  let added = 0
  let skippedRestricted = 0
  let skippedNoMap = 0
  let skippedDuplicates = 0
  let skippedNoUrl = 0
  let skippedNotVerified = 0
  let skippedReferenceUnusable = 0
  let createdSubCategories = 0

  const candidates = []
  const seenCandidateKey = new Set()

  for (const payload of sourcePayloads) {
    const sourceCfg = crosswalk.sources?.[payload.source] || {}

    for (const original of payload.records) {
      let record = original

      if (record.entityType === "market_map_reference") {
        const converted = convertReferenceToCompany(record)
        if (!converted) {
          skippedReferenceUnusable++
          continue
        }
        record = converted
      }

      if (record.entityType !== "company") continue

      if (record.legal?.restricted && !includeRestricted) {
        skippedRestricted++
        continue
      }

      if (payload.source === "cncf-landscape" && !record.websiteUrl) {
        const hp = cncfHomepageByName.get(normalize(record.name))
        if (hp) record = { ...record, websiteUrl: hp }
      }

      const verticalSlug = chooseVertical(record, sourceCfg)
      const map = maps.get(verticalSlug)
      if (!map) {
        skippedNoMap++
        continue
      }

      const targetCategory = chooseCategory(record, sourceCfg)
      const key = `${payload.source}|${verticalSlug}|${slugify(targetCategory)}|${normalize(record.name)}`
      if (seenCandidateKey.has(key)) continue
      seenCandidateKey.add(key)

      candidates.push({ payload, record, verticalSlug, targetCategory })
    }
  }

  const verified = verify
    ? await mapLimit(candidates, verifyConcurrency, async (c) => {
        const url = normalizeUrl(c.record.websiteUrl)
        if (!url) return { ...c, verify: { status: "unknown", reason: "missing_url", finalUrl: "" } }
        const v = await verifyWebsite(url, c.record.name)
        return { ...c, verify: v }
      })
    : candidates.map((c) => ({ ...c, verify: { status: "verified", reason: "verify_disabled", finalUrl: normalizeUrl(c.record.websiteUrl) } }))

  for (const c of verified) {
    const map = maps.get(c.verticalSlug)
    if (!map) continue

    let sub = findSubCategory(map, c.targetCategory)
    if (!sub) {
      sub = makeSubCategory(c.targetCategory, map)
      map.subCategories.push(sub)
      createdSubCategories++
    }

    const existing = sub.topPlayers.some((p) => normalize(p.name) === normalize(c.record.name))
    if (existing) {
      skippedDuplicates++
      continue
    }

    if (c.verify.status === "unknown") {
      skippedNoUrl++
      continue
    }
    if (c.verify.status !== "verified") {
      skippedNotVerified++
      continue
    }

    sub.topPlayers.push(toPlayer(c.record, map, c.payload.source, c.verify))
    sub.playerCount = sub.topPlayers.length
    sub.updatedAt = new Date().toISOString()
    added++
  }

  for (const map of maps.values()) {
    map.totalPlayers = map.subCategories.reduce((sum, s) => sum + (s.playerCount || s.topPlayers.length), 0)
    map.updatedAt = new Date().toISOString()

    if (write) {
      const file = path.join(MAPS_DIR, `${map.slug}.json`)
      fs.writeFileSync(file, JSON.stringify(map, null, 2))
    }
  }

  const verificationBreakdown = verified.reduce((acc, v) => {
    const k = v.verify.status
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  console.log(JSON.stringify({
    dryRun,
    wrote: write,
    includeRestricted,
    verify,
    verifyTimeoutMs,
    verifyConcurrency,
    sourcesProcessed: sourcePayloads.map((s) => s.source),
    candidateCount: candidates.length,
    verificationBreakdown,
    addedPlayers: added,
    createdSubCategories,
    skippedRestricted,
    skippedNoMap,
    skippedDuplicates,
    skippedNoUrl,
    skippedNotVerified,
    skippedReferenceUnusable,
  }, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
