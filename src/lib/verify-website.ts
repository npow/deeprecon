import { type Competitor, type WebsiteStatus } from "./types"

export interface VerificationResult {
  url: string
  status: WebsiteStatus
  reason?: string
}

/** Patterns that indicate a parked / for-sale domain */
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
  /is\s+for\s+sale/i,
  /domain\s+may\s+be\s+for\s+sale/i,
]

/** Generic titles that don't tell us about the company */
const GENERIC_TITLES = [
  "react app",
  "vite app",
  "next.js app",
  "home",
  "welcome",
  "index",
  "untitled",
  "",
]

/** Words too common to be meaningful for company matching */
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can",
  "her", "was", "one", "our", "out", "its", "has", "his", "how",
  "man", "new", "now", "old", "see", "way", "who", "did", "get",
  "let", "say", "she", "too", "use", "app", "com", "www", "http",
  "https", "home", "page", "site", "web", "welcome", "platform",
  "solution", "solutions", "software", "tool", "tools", "inc",
  "ltd", "llc", "corp",
])

function normalizeUrl(url: string): string {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) {
    u = `https://${u}`
  }
  return u
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? match[1].replace(/\s+/g, " ").trim() : ""
}

function normalizedAlnum(text: string): string {
  return (text || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function hostnameFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return ""
  }
}

function hostnameWords(hostname: string): string[] {
  return hostname
    .split(".")
    .filter(Boolean)
    .filter((part) => !["www", "com", "ai", "io", "co", "app", "net", "org"].includes(part))
}

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

function isCloudflareChallenge(html: string): boolean {
  return (
    html.includes("cf-browser-verification") ||
    html.includes("cf_chl_opt") ||
    html.includes("Just a moment...") ||
    html.includes("Checking if the site connection is secure")
  )
}

function isParkingPage(html: string): boolean {
  return PARKING_PATTERNS.some((p) => p.test(html))
}

function isTitleMismatch(title: string, companyName: string): boolean {
  const titleNorm = title.toLowerCase().trim()

  // Generic titles are not mismatches
  if (GENERIC_TITLES.includes(titleNorm)) return false

  const titleWords = significantWords(title)
  const nameWords = significantWords(companyName)

  // If we can't extract meaningful words from either, don't flag
  if (titleWords.length === 0 || nameWords.length === 0) return false

  // Check if any significant word from the company name appears in the title
  const overlap = nameWords.some((nw) =>
    titleWords.some((tw) => tw.includes(nw) || nw.includes(tw))
  )

  return !overlap
}

function isDomainMismatch(finalUrl: string, companyName: string): boolean {
  const host = hostnameFromUrl(finalUrl)
  if (!host) return false

  const nameNorm = normalizedAlnum(companyName)
  const hostNorm = normalizedAlnum(host)
  if (!nameNorm || !hostNorm) return false

  if (hostNorm.includes(nameNorm) || nameNorm.includes(hostNorm)) return false

  const nameWords = significantWords(companyName)
  const hostParts = hostnameWords(host)
  if (nameWords.length === 0 || hostParts.length === 0) return false

  const overlap = nameWords.some((nw) =>
    hostParts.some((hp) => hp.includes(nw) || nw.includes(hp))
  )
  return !overlap
}

export async function verifyWebsiteUrl(
  url: string,
  companyName: string,
  timeoutMs: number = 5000
): Promise<VerificationResult> {
  if (!url) return { url: "", status: "unknown", reason: "No URL provided" }

  const normalizedUrl = normalizeUrl(url)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await fetch(normalizedUrl, {
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

    // 4xx/5xx → dead
    const finalUrl = res.url || normalizedUrl
    if (!res.ok) {
      return { url: finalUrl, status: "dead", reason: `HTTP ${res.status}` }
    }

    // Read first 16KB of body then abort stream
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

    // Cloudflare/JS challenge → site exists, just protected
    if (isCloudflareChallenge(html)) {
      return { url: finalUrl, status: "verified", reason: "Protected by challenge page" }
    }

    // Parking page detection
    if (isParkingPage(html)) {
      return { url: finalUrl, status: "parked", reason: "Domain appears parked/for sale" }
    }

    // Company mismatch requires both a title mismatch and a domain mismatch.
    // This avoids false mismatches when a site redirects to a branded domain.
    const title = extractTitle(html)
    const titleMismatch = title ? isTitleMismatch(title, companyName) : false
    const domainMismatch = isDomainMismatch(finalUrl, companyName)
    if (titleMismatch && domainMismatch) {
      return { url: finalUrl, status: "mismatch", reason: `Title "${title}" does not align with "${companyName}" and hostname ${hostnameFromUrl(finalUrl)} differs` }
    }

    const redirected = finalUrl !== normalizedUrl
    return { url: finalUrl, status: "verified", reason: redirected ? `Redirected to ${finalUrl}` : "Verified" }
  } catch {
    // Network error, timeout, DNS failure → dead
    return { url: normalizedUrl, status: "dead", reason: "Network error / timeout" }
  }
}

export async function verifyCompetitorWebsites(
  competitors: Competitor[]
): Promise<Competitor[]> {
  const results = await Promise.allSettled(
    competitors.map(async (c) => {
      if (!c.websiteUrl) return { ...c, websiteStatus: "unknown" as WebsiteStatus, websiteStatusReason: "No URL provided" }
      const result = await verifyWebsiteUrl(c.websiteUrl, c.name)
      return { ...c, websiteUrl: result.url, websiteStatus: result.status, websiteStatusReason: result.reason }
    })
  )

  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { ...competitors[i], websiteStatus: "unknown" as WebsiteStatus, websiteStatusReason: "Verification failed" }
  )
}
