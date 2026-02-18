import puppeteer, { type Browser, type Page } from "puppeteer"
import path from "path"
import type { DeepResearchProvider } from "./types"

// Serialize access — only one deep-research session at a time
let mutex: Promise<void> = Promise.resolve()

const USER_DATA_DIR = path.join(process.cwd(), "data", "chrome-profile")

/** Default CDP port for connecting to user's running Chrome */
const CDP_PORT = parseInt(process.env.CHROME_CDP_PORT || "9222", 10)

const COOKIE_ENV_VARS: Record<DeepResearchProvider, string> = {
  gemini: "GEMINI_COOKIES_BASE64",
  chatgpt: "CHATGPT_COOKIES_BASE64",
  claude: "CLAUDE_COOKIES_BASE64",
}

export interface BrowserCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: "Strict" | "Lax" | "None"
}

export class DeepResearchError extends Error {
  constructor(
    message: string,
    public provider: DeepResearchProvider
  ) {
    super(message)
    this.name = "DeepResearchError"
  }
}

export class DeepResearchAuthError extends DeepResearchError {
  constructor(message: string, provider: DeepResearchProvider) {
    super(message, provider)
    this.name = "DeepResearchAuthError"
  }
}

// ─── CDP connection (local dev — use the user's real browser) ───

async function findCDPEndpoint(): Promise<string | null> {
  const ports = [CDP_PORT, 9222, 9229]
  for (const port of [...new Set(ports)]) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      })
      const data = await res.json()
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl
    } catch {
      // not a CDP endpoint
    }
  }
  return null
}

async function connectToChrome(): Promise<Browser | null> {
  const wsUrl = await findCDPEndpoint()
  if (!wsUrl) return null
  try {
    return await puppeteer.connect({ browserWSEndpoint: wsUrl })
  } catch {
    return null
  }
}

// ─── Headless launch (Docker — inject cookies) ───

async function launchHeadless(provider: DeepResearchProvider): Promise<Browser> {
  const cookieEnvVar = COOKIE_ENV_VARS[provider]
  const isDocker = !!process.env[cookieEnvVar]

  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-setuid-sandbox",
    "--disable-extensions",
  ]

  return puppeteer.launch({
    headless: true,
    args,
    ...(isDocker
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser" }
      : { userDataDir: USER_DATA_DIR }),
  })
}

async function injectCookies(page: Page, provider: DeepResearchProvider): Promise<void> {
  const cookieEnvVar = COOKIE_ENV_VARS[provider]
  const base64 = process.env[cookieEnvVar]
  if (!base64) return

  let cookies: BrowserCookie[]
  try {
    const parsed = JSON.parse(Buffer.from(base64, "base64").toString())
    cookies = parsed.cookies ?? parsed
    if (!Array.isArray(cookies)) return
  } catch {
    console.warn(`[deep-research] Failed to parse ${cookieEnvVar}`)
    return
  }

  for (const c of cookies) {
    if (!c.name || !c.domain) continue
    try {
      await page.setCookie({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
        httpOnly: c.httpOnly ?? true,
        secure: c.secure ?? true,
      })
    } catch {
      // Skip individual bad cookies
    }
  }
}

// ─── Public API ───

/**
 * Mutex-serialized browser session.
 *
 * Local dev: connects to the user's running Chrome via CDP (port 9222).
 *   The user's browser already has auth + Cloudflare clearance.
 *   Opens a new tab, runs the task, closes the tab.
 *
 * Docker: launches headless Chrome and injects cookies from env vars.
 */
export async function withBrowser<T>(
  provider: DeepResearchProvider,
  fn: (browser: Browser, page: Page) => Promise<T>
): Promise<T> {
  const prevMutex = mutex
  let resolve: () => void
  mutex = new Promise<void>((r) => {
    resolve = r
  })

  await prevMutex

  // Try CDP connection first (local dev)
  const cdpBrowser = await connectToChrome()

  if (cdpBrowser) {
    // Connected to user's real Chrome — open a new tab
    const page = await cdpBrowser.newPage()
    try {
      await page.setViewport({ width: 1280, height: 800 })
      return await fn(cdpBrowser, page)
    } finally {
      await page.close().catch(() => {})
      // Disconnect (don't close — it's the user's browser!)
      cdpBrowser.disconnect()
      resolve!()
    }
  }

  // Fallback: launch headless (Docker or if no CDP available)
  let browser: Browser | undefined
  try {
    console.log(`[deep-research] No CDP endpoint found, launching headless browser...`)
    browser = await launchHeadless(provider)
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await injectCookies(page, provider)
    return await fn(browser, page)
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    resolve!()
  }
}
