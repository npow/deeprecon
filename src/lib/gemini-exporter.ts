import fs from "fs"
import path from "path"

const COOKIES_PATH = path.join(process.cwd(), "data", "gemini-cookies.json")
const GEMINI_BASE = "https://gemini.google.com"

export interface GeminiCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
}

export interface CookieJar {
  cookies: GeminiCookie[]
  updatedAt: string
}

// ─── Cookie Management ───

export function loadCookies(): CookieJar {
  // Allow cookies via base64-encoded env var (for Docker/CI)
  const envCookies = process.env.GEMINI_COOKIES_BASE64
  if (envCookies) {
    try {
      const raw = JSON.parse(Buffer.from(envCookies, "base64").toString()) as CookieJar
      if (raw.cookies && raw.cookies.length > 0) return raw
    } catch {
      // fall through to file-based loading
    }
  }

  if (!fs.existsSync(COOKIES_PATH)) {
    throw new GeminiSessionError(
      "Gemini session not configured. Set GEMINI_COOKIES_BASE64 env var or run `npm run gemini:login`."
    )
  }
  const raw = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8")) as CookieJar
  if (!raw.cookies || raw.cookies.length === 0) {
    throw new GeminiSessionError(
      "Gemini cookie jar is empty. Re-run `npm run gemini:login`."
    )
  }
  return raw
}

export function saveCookies(jar: CookieJar): void {
  const dir = path.dirname(COOKIES_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmpPath = `${COOKIES_PATH}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(jar, null, 2))
  fs.renameSync(tmpPath, COOKIES_PATH)
}

export function getCookieHeader(cookies: GeminiCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ")
}

export function updateCookiesFromResponse(
  existing: GeminiCookie[],
  setCookieHeaders: string[]
): GeminiCookie[] {
  const updated = [...existing]
  for (const header of setCookieHeaders) {
    const parts = header.split(";").map((s) => s.trim())
    const [nameVal] = parts
    if (!nameVal) continue
    const eqIdx = nameVal.indexOf("=")
    if (eqIdx < 0) continue
    const name = nameVal.slice(0, eqIdx)
    const value = nameVal.slice(eqIdx + 1)

    let domain = ".google.com"
    let cookiePath = "/"
    let expires = 0
    for (const part of parts.slice(1)) {
      const lower = part.toLowerCase()
      if (lower.startsWith("domain=")) domain = part.slice(7)
      else if (lower.startsWith("path=")) cookiePath = part.slice(5)
      else if (lower.startsWith("expires=")) {
        const d = new Date(part.slice(8))
        if (!isNaN(d.getTime())) expires = Math.floor(d.getTime() / 1000)
      }
    }

    const idx = updated.findIndex((c) => c.name === name)
    const cookie: GeminiCookie = { name, value, domain, path: cookiePath, expires }
    if (idx >= 0) updated[idx] = cookie
    else updated.push(cookie)
  }
  return updated
}

// ─── Error Classes ───

export class GeminiSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GeminiSessionError"
  }
}

export class GeminiAPIError extends Error {
  public status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "GeminiAPIError"
    this.status = status
  }
}

// ─── CSRF Token ───

export async function extractCSRFToken(cookies: GeminiCookie[]): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/app`, {
    headers: {
      Cookie: getCookieHeader(cookies),
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    redirect: "manual",
  })

  // If we get a redirect, the session is likely expired
  if (res.status >= 300 && res.status < 400) {
    throw new GeminiSessionError(
      "Gemini session expired (redirect to login). Re-run `npm run gemini:login`."
    )
  }

  if (!res.ok) {
    throw new GeminiAPIError(`Failed to load Gemini app page: ${res.status}`, res.status)
  }

  const html = await res.text()
  const match = html.match(/SNlM0e":"([^"]+)/)
  if (!match) {
    throw new GeminiSessionError(
      "Could not extract CSRF token. Session may be expired. Re-run `npm run gemini:login`."
    )
  }
  return match[1]
}

// ─── StreamGenerate (Canvas Mode) ───

function buildStreamGeneratePayload(prompt: string): string {
  // Build the deeply nested inner payload
  // Index [0][0][0] = prompt text
  // Index [0][30] = [4] (Canvas flag)
  // Index [0][49] = 2  (Canvas sub-mode)
  const inner: unknown[] = new Array(50).fill(null)
  inner[0] = prompt
  inner[30] = [4] // Canvas flag
  inner[49] = 2   // Canvas sub-mode

  const outerPayload = [[inner]]
  return JSON.stringify(outerPayload)
}

export async function streamGenerate(
  prompt: string,
  csrfToken: string,
  cookies: GeminiCookie[]
): Promise<{ html: string; updatedCookies: GeminiCookie[] }> {
  const url = `${GEMINI_BASE}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`

  const payload = buildStreamGeneratePayload(prompt)
  const body = new URLSearchParams({
    "f.req": payload,
    at: csrfToken,
  })

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: getCookieHeader(cookies),
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "x-goog-ext-525001261-jspb": JSON.stringify({
        "8": [4],
        "11": 2,
      }),
      Origin: GEMINI_BASE,
      Referer: `${GEMINI_BASE}/app`,
    },
  })

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after")
    throw new GeminiAPIError(
      `Rate limited by Gemini${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
      429
    )
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    console.error(`[gemini-exporter] StreamGenerate ${res.status}:`, errBody.slice(0, 500))
    throw new GeminiAPIError(`StreamGenerate failed: ${res.status}`, res.status)
  }

  // Update cookies from response
  const setCookies = res.headers.getSetCookie?.() ?? []
  const updatedCookies = updateCookiesFromResponse(cookies, setCookies)

  const text = await res.text()
  const html = parseStreamGenerateResponse(text)

  if (!html) {
    throw new GeminiAPIError("No HTML content found in StreamGenerate response")
  }

  return { html, updatedCookies }
}

function parseStreamGenerateResponse(text: string): string | null {
  // Response is streamed text with byte count prefixes.
  // Look for wrb.fr lines containing HTML blocks.
  // The response format has JSON arrays separated by newlines and byte counts.

  let bestHtml: string | null = null
  let bestLength = 0

  // Split by lines and look for JSON arrays containing HTML
  const lines = text.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("[")) continue

    try {
      const parsed = JSON.parse(trimmed)
      const htmlStr = findHtmlInParsed(parsed)
      if (htmlStr && htmlStr.length > bestLength) {
        bestHtml = htmlStr
        bestLength = htmlStr.length
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return bestHtml
}

function findHtmlInParsed(data: unknown): string | null {
  if (typeof data === "string") {
    if (data.includes("<html") || data.includes("<!DOCTYPE html>") || data.includes("<!doctype html>")) {
      return data
    }
    // Try to parse as nested JSON (wrb.fr payloads are double-encoded)
    if (data.startsWith("[") || data.startsWith("{")) {
      try {
        const inner = JSON.parse(data)
        return findHtmlInParsed(inner)
      } catch {
        // not JSON
      }
    }
    return null
  }
  if (Array.isArray(data)) {
    let best: string | null = null
    let bestLen = 0
    for (const item of data) {
      const found = findHtmlInParsed(item)
      if (found && found.length > bestLen) {
        best = found
        bestLen = found.length
      }
    }
    return best
  }
  return null
}

// ─── qACoKe (HTML → PPTX) ───

export async function exportToPptx(
  html: string,
  title: string,
  csrfToken: string,
  cookies: GeminiCookie[]
): Promise<{ pptxBuffer: Buffer; updatedCookies: GeminiCookie[] }> {
  const url = `${GEMINI_BASE}/_/BardChatUi/data/batchexecute?rpcids=qACoKe`

  // Inner payload: [html_content, 6, title] where 6 = Slides export type
  const innerPayload = JSON.stringify([html, 6, title])
  const outerPayload = JSON.stringify([[["qACoKe", innerPayload, null, "generic"]]])

  const body = new URLSearchParams({
    "f.req": outerPayload,
    at: csrfToken,
  })

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: getCookieHeader(cookies),
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Origin: GEMINI_BASE,
      Referer: `${GEMINI_BASE}/app`,
    },
  })

  if (res.status === 429) {
    throw new GeminiAPIError("Rate limited by Gemini on PPTX export", 429)
  }

  if (!res.ok) {
    throw new GeminiAPIError(`qACoKe export failed: ${res.status}`, res.status)
  }

  const setCookies = res.headers.getSetCookie?.() ?? []
  const updatedCookies = updateCookiesFromResponse(cookies, setCookies)

  const text = await res.text()
  const pptxBuffer = parseQACoKeResponse(text)

  if (!pptxBuffer) {
    throw new GeminiAPIError("No PPTX data found in qACoKe response")
  }

  return { pptxBuffer, updatedCookies }
}

function parseQACoKeResponse(text: string): Buffer | null {
  // Response starts with )]}' then byte counts and JSON
  // Strip the safety prefix
  const cleaned = text.replace(/^\)\]\}'\s*\n?/, "")

  // Look for base64 PPTX data (starts with UEsDBBQ — PK zip header in base64)
  const lines = cleaned.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("[")) continue

    try {
      const parsed = JSON.parse(trimmed)
      const base64 = findBase64Pptx(parsed)
      if (base64) {
        return Buffer.from(base64, "base64")
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Fallback: scan entire response for base64 PPTX string
  const match = cleaned.match(/UEsDBBQ[A-Za-z0-9+/=]{100,}/)
  if (match) {
    return Buffer.from(match[0], "base64")
  }

  return null
}

function findBase64Pptx(data: unknown): string | null {
  if (typeof data === "string") {
    if (data.startsWith("UEsDBBQ") && data.length > 200) {
      return data
    }
    // Try to parse nested JSON
    if (data.startsWith("[") || data.startsWith("{")) {
      try {
        const inner = JSON.parse(data)
        return findBase64Pptx(inner)
      } catch {
        // not JSON
      }
    }
    return null
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findBase64Pptx(item)
      if (found) return found
    }
  }
  return null
}

// ─── Orchestrator ───

export async function generatePresentation(
  prompt: string,
  title: string
): Promise<Buffer> {
  console.log("[gemini-exporter] Loading cookies...")
  const jar = loadCookies()
  let cookies = jar.cookies

  console.log("[gemini-exporter] Extracting CSRF token...")
  const csrfToken = await extractCSRFToken(cookies)

  console.log("[gemini-exporter] Calling StreamGenerate (Canvas mode)...")
  const streamResult = await streamGenerate(prompt, csrfToken, cookies)
  cookies = streamResult.updatedCookies

  console.log(`[gemini-exporter] Got HTML (${streamResult.html.length} chars), converting to PPTX...`)
  const pptxResult = await exportToPptx(streamResult.html, title, csrfToken, cookies)
  cookies = pptxResult.updatedCookies

  // Persist updated cookies
  saveCookies({ cookies, updatedAt: new Date().toISOString() })

  console.log(`[gemini-exporter] PPTX generated (${pptxResult.pptxBuffer.length} bytes)`)
  return pptxResult.pptxBuffer
}

// ─── Cookie Keepalive ───
// Runs every 6 hours inside the server process to prevent session expiry.
// A simple GET to gemini.google.com refreshes the cookies via Set-Cookie headers.

const KEEPALIVE_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

async function refreshCookies(): Promise<void> {
  let jar: CookieJar
  try {
    jar = loadCookies()
  } catch {
    // No cookies file — nothing to refresh
    return
  }

  try {
    const res = await fetch(`${GEMINI_BASE}/app`, {
      headers: {
        Cookie: getCookieHeader(jar.cookies),
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      redirect: "manual",
    })

    if (res.status >= 300 && res.status < 400) {
      console.warn("[gemini-keepalive] Session expired (redirect to login). Re-run `npm run gemini:login`.")
      return
    }

    const setCookies = res.headers.getSetCookie?.() ?? []
    if (setCookies.length > 0) {
      const updated = updateCookiesFromResponse(jar.cookies, setCookies)
      saveCookies({ cookies: updated, updatedAt: new Date().toISOString() })
      console.log(`[gemini-keepalive] Refreshed ${setCookies.length} cookies`)
    } else {
      console.log("[gemini-keepalive] Session alive, no new cookies")
    }
  } catch (err) {
    console.warn("[gemini-keepalive] Refresh failed:", err instanceof Error ? err.message : err)
  }
}

/** Call once from instrumentation.ts to start the keepalive loop */
export function startCookieKeepalive(): void {
  // Initial refresh after 30s (let the server finish starting)
  setTimeout(() => {
    refreshCookies()
    setInterval(refreshCookies, KEEPALIVE_INTERVAL_MS)
  }, 30_000)
}
