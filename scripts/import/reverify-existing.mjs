#!/usr/bin/env node
/**
 * reverify-existing.mjs
 *
 * Re-verify imported players already in maps and optionally prune unverified.
 *
 * Usage:
 *   node scripts/import/reverify-existing.mjs --source ai-native-dev-landscape --write
 *   node scripts/import/reverify-existing.mjs --source ai-native-dev-landscape --write --keep-unverified
 */

import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const MAPS_DIR = path.join(ROOT, "data", "maps")

const args = process.argv.slice(2)
function hasFlag(flag) { return args.includes(`--${flag}`) }
function getFlag(flag, fallback = "") {
  const i = args.indexOf(`--${flag}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const source = getFlag("source", "")
const dryRun = hasFlag("dry-run")
const write = hasFlag("write") && !dryRun
const keepUnverified = hasFlag("keep-unverified")
const timeoutMs = Number(getFlag("timeout-ms", "5000"))
const concurrency = Number(getFlag("concurrency", "25"))

if (!source) {
  console.error("Usage: node scripts/import/reverify-existing.mjs --source <source-name> [--write]")
  process.exit(1)
}

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

const GENERIC_TITLES = new Set(["react app", "vite app", "next.js app", "home", "welcome", "index", "untitled", ""])
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "our", "out", "its", "has", "new", "now", "old",
  "see", "way", "who", "did", "get", "let", "say", "too", "use", "app", "com", "www", "http", "https", "home", "page",
  "site", "web", "welcome", "platform", "software", "tool", "tools", "inc", "ltd", "llc", "corp",
])

function normalize(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "") }
function normalizeUrl(url) {
  const u = String(url || "").trim()
  if (!u) return ""
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}
function extractTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? m[1].replace(/\s+/g, " ").trim() : ""
}
function significantWords(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}
function hostnameFromUrl(rawUrl) { try { return new URL(rawUrl).hostname.toLowerCase() } catch { return "" } }
function hostnameWords(hostname) {
  return hostname.split(".").filter(Boolean).filter((part) => !["www", "com", "ai", "io", "co", "app", "net", "org"].includes(part))
}
function isCloudflareChallenge(html) {
  return html.includes("cf-browser-verification") || html.includes("cf_chl_opt") || html.includes("Just a moment...") || html.includes("Checking if the site connection is secure")
}
function isParkingPage(html) { return PARKING_PATTERNS.some((p) => p.test(html)) }
function isTitleMismatch(title, companyName) {
  const titleNorm = String(title || "").toLowerCase().trim()
  if (GENERIC_TITLES.has(titleNorm)) return false
  const titleWords = significantWords(title)
  const nameWords = significantWords(companyName)
  if (titleWords.length === 0 || nameWords.length === 0) return false
  return !nameWords.some((nw) => titleWords.some((tw) => tw.includes(nw) || nw.includes(tw)))
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
  return !nameWords.some((nw) => hostParts.some((hp) => hp.includes(nw) || nw.includes(hp)))
}

async function verifyWebsite(url, companyName) {
  const normalized = normalizeUrl(url)
  if (!normalized) return { status: "unknown", reason: "missing_url", finalUrl: "" }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(normalized, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ReconBot/1.0)", Accept: "text/html,application/xhtml+xml,*/*" },
      })
    } finally { clearTimeout(timer) }

    const finalUrl = res.url || normalized
    if (!res.ok) return { status: "dead", reason: `http_${res.status}`, finalUrl }

    const reader = res.body?.getReader()
    let html = ""
    if (reader) {
      const decoder = new TextDecoder()
      let bytes = 0
      while (bytes < 16384) {
        const { done, value } = await reader.read()
        if (done) break
        html += decoder.decode(value, { stream: true })
        bytes += value.byteLength
      }
      reader.cancel().catch(() => {})
    }

    if (isCloudflareChallenge(html)) return { status: "verified", reason: "challenge_page", finalUrl }
    if (isParkingPage(html)) return { status: "parked", reason: "parking_page", finalUrl }

    const title = extractTitle(html)
    if (isTitleMismatch(title, companyName) && isDomainMismatch(finalUrl, companyName)) {
      return { status: "mismatch", reason: "title_domain_mismatch", finalUrl }
    }
    return { status: "verified", reason: "ok", finalUrl }
  } catch {
    return { status: "dead", reason: "network_error", finalUrl: normalized }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker()))
  return out
}

const mapFiles = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
const maps = mapFiles.map((f) => ({ file: f, path: path.join(MAPS_DIR, f), map: JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), "utf8")) }))

const targets = []
for (const m of maps) {
  for (const sub of m.map.subCategories || []) {
    for (let i = 0; i < (sub.topPlayers || []).length; i++) {
      const p = sub.topPlayers[i]
      if (p.source === source) {
        targets.push({ mapRef: m, sub, idx: i, player: p })
      }
    }
  }
}

const verified = await mapLimit(targets, concurrency, async (t) => {
  const v = await verifyWebsite(t.player.websiteUrl || "", t.player.name)
  return { ...t, verify: v }
})

let kept = 0
let removed = 0
const breakdown = {}

for (const r of verified) {
  breakdown[r.verify.status] = (breakdown[r.verify.status] || 0) + 1
}

for (const m of maps) {
  for (const sub of m.map.subCategories || []) {
    const next = []
    for (const p of sub.topPlayers || []) {
      if (p.source !== source) {
        next.push(p)
        continue
      }
      const rv = verified.find((x) => x.mapRef.path === m.path && x.sub.slug === sub.slug && x.player.name === p.name)
      if (!rv) {
        next.push(p)
        continue
      }

      if (rv.verify.status === "verified") {
        p.websiteUrl = rv.verify.finalUrl || p.websiteUrl
        p.websiteStatus = "verified"
        p.websiteStatusReason = rv.verify.reason
        p.confidenceLevel = "web_verified"
        p.confirmedBy = Array.isArray(p.confirmedBy) ? Array.from(new Set([...p.confirmedBy, source])) : [source]
        p.confirmedByCount = p.confirmedBy.length
        kept++
        next.push(p)
      } else if (keepUnverified) {
        p.websiteStatus = rv.verify.status
        p.websiteStatusReason = rv.verify.reason
        p.confidenceLevel = "ai_inferred"
        kept++
        next.push(p)
      } else {
        removed++
      }
    }
    sub.topPlayers = next
    sub.playerCount = next.length
    sub.updatedAt = new Date().toISOString()
  }

  m.map.totalPlayers = (m.map.subCategories || []).reduce((s, sc) => s + (sc.playerCount || (sc.topPlayers || []).length), 0)
  m.map.updatedAt = new Date().toISOString()

  if (write) fs.writeFileSync(m.path, JSON.stringify(m.map, null, 2))
}

console.log(JSON.stringify({
  dryRun,
  wrote: write,
  source,
  keepUnverified,
  targets: targets.length,
  kept,
  removed,
  verificationBreakdown: breakdown,
}, null, 2))
