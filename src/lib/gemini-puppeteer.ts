import puppeteer, { type Browser, type Page } from "puppeteer"
import path from "path"
import {
  loadCookies,
  saveCookies,
  GeminiSessionError,
  GeminiAPIError,
  type GeminiCookie,
} from "./gemini-exporter"

// Serialize access — Chrome userDataDir is locked by a single process
let mutex: Promise<void> = Promise.resolve()

const USER_DATA_DIR = path.join(process.cwd(), "data", "gemini-chrome-profile")
const GEMINI_URL = "https://gemini.google.com/app"

// ─── Helpers ───

async function launchBrowser(): Promise<Browser> {
  const isDocker = !!process.env.GEMINI_COOKIES_BASE64
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-setuid-sandbox",
    "--disable-extensions",
  ]

  const launchOpts: Parameters<typeof puppeteer.launch>[0] = {
    headless: true,
    args,
    ...(isDocker
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser" }
      : { userDataDir: USER_DATA_DIR }),
  }

  return puppeteer.launch(launchOpts)
}

async function injectCookies(page: Page, cookies: GeminiCookie[]): Promise<void> {
  const puppeteerCookies = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    ...(c.expires > 0 ? { expires: c.expires } : {}),
    httpOnly: true,
    secure: true,
  }))
  await page.setCookie(...puppeteerCookies)
}

async function verifyAuth(page: Page): Promise<void> {
  // After navigating to Gemini, check we're not redirected to a login page
  const url = page.url()
  if (url.includes("accounts.google.com") || url.includes("/signin")) {
    throw new GeminiSessionError(
      "Gemini session expired (redirected to login). Re-run `npm run gemini:login` or update GEMINI_COOKIES_BASE64."
    )
  }

  // Verify the prompt input exists
  try {
    await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15_000 })
  } catch {
    throw new GeminiSessionError(
      "Could not find Gemini input area. Session may be invalid."
    )
  }
}

async function enableCanvasTool(page: Page): Promise<void> {
  // Click "Tools" button to open the tools menu
  const toolsBtn = await page.waitForSelector('button[aria-label="Tools"]', { timeout: 5_000 })
  if (!toolsBtn) throw new GeminiAPIError("Could not find Tools button")
  await toolsBtn.click()

  // Wait for the menu and click "Canvas"
  await page.waitForSelector('menuitemcheckbox', { timeout: 5_000 })
  const canvasItem = await page.evaluateHandle(() => {
    const items = document.querySelectorAll('menuitemcheckbox, [role="menuitemcheckbox"]')
    for (const item of items) {
      if (item.textContent?.includes("Canvas")) return item
    }
    return null
  })

  if (!canvasItem) throw new GeminiAPIError("Could not find Canvas tool in menu")
  await (canvasItem as unknown as import("puppeteer").ElementHandle).click()

  // Wait for "Deselect Canvas" button to confirm Canvas is enabled
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).some((b) => b.textContent?.includes("Deselect Canvas"))
    },
    { timeout: 5_000 }
  )
}

async function typeAndSend(page: Page, prompt: string): Promise<void> {
  // Focus the input area
  const input = await page.waitForSelector('div[role="textbox"][contenteditable="true"]', {
    timeout: 5_000,
  })
  if (!input) throw new GeminiAPIError("Could not find prompt input")
  await input.click()

  // Paste the prompt via evaluate to avoid typing character by character
  await page.evaluate((text) => {
    const el = document.querySelector('div[role="textbox"][contenteditable="true"]')
    if (!el) return
    ;(el as HTMLElement).focus()
    document.execCommand("insertText", false, text)
  }, prompt)

  // Wait for send button to appear and click it
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).some(
        (b) => b.getAttribute("aria-label") === "Send message" || b.textContent === "Send message"
      )
    },
    { timeout: 5_000 }
  )

  const sendBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll("button")
    return Array.from(buttons).find(
      (b) => b.getAttribute("aria-label") === "Send message" || b.textContent === "Send message"
    ) || null
  })
  if (!sendBtn) throw new GeminiAPIError("Could not find Send button")
  await (sendBtn as unknown as import("puppeteer").ElementHandle).click()
}

async function waitForCanvas(page: Page): Promise<void> {
  // Wait for the Canvas panel to appear with "Export to Slides" button
  // This can take 30-90 seconds for complex presentations
  console.log("[gemini-puppeteer] Waiting for Canvas to generate...")
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).some(
        (b) =>
          b.getAttribute("aria-label") === "Export to Slides" ||
          b.textContent?.includes("Export to Slides")
      )
    },
    { timeout: 120_000, polling: 2_000 }
  )
  console.log("[gemini-puppeteer] Canvas generated successfully")
}

async function exportToSlides(page: Page, browser: Browser): Promise<string> {
  // Click "Export to Slides"
  const exportBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll("button")
    return (
      Array.from(buttons).find(
        (b) =>
          b.getAttribute("aria-label") === "Export to Slides" ||
          b.textContent?.includes("Export to Slides")
      ) || null
    )
  })
  if (!exportBtn) throw new GeminiAPIError("Could not find Export to Slides button")
  await (exportBtn as unknown as import("puppeteer").ElementHandle).click()
  console.log("[gemini-puppeteer] Clicked Export to Slides")

  // Wait for the "Open Slides" button in the toast notification
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).some((b) => b.textContent?.includes("Open Slides"))
    },
    { timeout: 30_000, polling: 1_000 }
  )

  // Set up a listener for the new tab BEFORE clicking "Open Slides"
  const newPagePromise = new Promise<Page>((resolve) => {
    browser.once("targetcreated", async (target) => {
      const p = await target.page()
      if (p) resolve(p)
    })
  })

  // Click "Open Slides"
  const openBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll("button")
    return Array.from(buttons).find((b) => b.textContent?.includes("Open Slides")) || null
  })
  if (!openBtn) throw new GeminiAPIError("Could not find Open Slides button")
  await (openBtn as unknown as import("puppeteer").ElementHandle).click()
  console.log("[gemini-puppeteer] Clicked Open Slides")

  // Wait for the new tab to open
  const slidesPage = await Promise.race([
    newPagePromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new GeminiAPIError("Timed out waiting for Slides tab to open")), 30_000)
    ),
  ])

  // Wait for the page to load
  await slidesPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {
    // Navigation may already be complete
  })

  const slidesUrl = slidesPage.url()
  console.log("[gemini-puppeteer] Google Slides URL:", slidesUrl)

  if (!slidesUrl.includes("docs.google.com/presentation")) {
    throw new GeminiAPIError(`Unexpected Slides URL: ${slidesUrl}`)
  }

  return slidesUrl
}

async function setPublicSharing(slidesPage: Page): Promise<void> {
  // Wait for the Slides editor to load
  await slidesPage.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).some((b) => b.textContent?.includes("Share"))
    },
    { timeout: 30_000, polling: 2_000 }
  )

  // Click the Share button
  const shareBtn = await slidesPage.evaluateHandle(() => {
    const buttons = document.querySelectorAll('button[aria-label*="Share"]')
    // Find the main Share button (not "Quick sharing actions")
    return (
      Array.from(buttons).find(
        (b) => b.textContent?.includes("Share") && !b.textContent?.includes("Quick")
      ) || null
    )
  })
  if (!shareBtn) throw new GeminiAPIError("Could not find Share button in Slides")
  await (shareBtn as unknown as import("puppeteer").ElementHandle).click()
  console.log("[gemini-puppeteer] Clicked Share button")

  // Wait for the Share dialog iframe to load
  await slidesPage.waitForSelector('iframe[title="Content"]', { timeout: 10_000 })
  await new Promise((r) => setTimeout(r, 2_000)) // Let the iframe content load

  // Get the iframe and switch to it
  const frameHandle = await slidesPage.$('iframe[title="Content"]')
  if (!frameHandle) throw new GeminiAPIError("Could not find Share dialog iframe")
  const frame = await frameHandle.contentFrame()
  if (!frame) throw new GeminiAPIError("Could not access Share dialog iframe content")

  // Check if already set to "Anyone with the link"
  const alreadyPublic = await frame.evaluate(() => {
    const buttons = document.querySelectorAll("button")
    return Array.from(buttons).some((b) => b.textContent?.includes("Anyone with the link"))
  })

  if (alreadyPublic) {
    console.log("[gemini-puppeteer] Already shared publicly, skipping")
    // Click Done
    const doneBtn = await frame.evaluateHandle(() => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).find((b) => b.textContent?.trim() === "Done") || null
    })
    if (doneBtn) await (doneBtn as unknown as import("puppeteer").ElementHandle).click()
    return
  }

  // Click the "Restricted" / access level change button
  const restrictedBtn = await frame.evaluateHandle(() => {
    const buttons = document.querySelectorAll("button")
    return (
      Array.from(buttons).find((b) => b.textContent?.includes("change link")) || null
    )
  })
  if (!restrictedBtn) throw new GeminiAPIError("Could not find access level button in Share dialog")
  await (restrictedBtn as unknown as import("puppeteer").ElementHandle).click()

  // Wait for the dropdown menu and click "Anyone with the link"
  await frame.waitForFunction(
    () => {
      const items = document.querySelectorAll('[role="menuitemradio"]')
      return Array.from(items).some((i) => i.textContent?.includes("Anyone with the link"))
    },
    { timeout: 5_000 }
  )

  const anyoneOption = await frame.evaluateHandle(() => {
    const items = document.querySelectorAll('[role="menuitemradio"]')
    return Array.from(items).find((i) => i.textContent?.includes("Anyone with the link")) || null
  })
  if (!anyoneOption) throw new GeminiAPIError("Could not find 'Anyone with the link' option")
  await (anyoneOption as unknown as import("puppeteer").ElementHandle).click()
  console.log("[gemini-puppeteer] Set sharing to 'Anyone with the link'")

  // Wait for "Access updated" confirmation
  await frame.waitForFunction(
    () => document.body.textContent?.includes("Access updated"),
    { timeout: 10_000, polling: 500 }
  )

  // Click Done
  const doneBtn = await frame.evaluateHandle(() => {
    const buttons = document.querySelectorAll("button")
    return Array.from(buttons).find((b) => b.textContent?.trim() === "Done") || null
  })
  if (doneBtn) await (doneBtn as unknown as import("puppeteer").ElementHandle).click()
  console.log("[gemini-puppeteer] Share dialog closed")
}

function extractPresentationId(url: string): string {
  const match = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new GeminiAPIError(`Could not extract presentation ID from URL: ${url}`)
  return match[1]
}

// ─── Public API ───

export async function generateSlidesUrl(prompt: string, title: string): Promise<string> {
  // Serialize via mutex — Chrome userDataDir can only be used by one process
  const prevMutex = mutex
  let resolve: () => void
  mutex = new Promise<void>((r) => {
    resolve = r
  })

  await prevMutex

  let browser: Browser | undefined

  try {
    console.log("[gemini-puppeteer] Launching browser...")
    browser = await launchBrowser()

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    // Inject cookies in Docker mode (no userDataDir)
    if (process.env.GEMINI_COOKIES_BASE64) {
      const jar = loadCookies()
      await injectCookies(page, jar.cookies)
    }

    // Navigate to Gemini
    console.log("[gemini-puppeteer] Navigating to Gemini...")
    await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await verifyAuth(page)

    // Enable Canvas tool
    console.log("[gemini-puppeteer] Enabling Canvas tool...")
    await enableCanvasTool(page)

    // Type the prompt and send
    console.log("[gemini-puppeteer] Sending prompt...")
    await typeAndSend(page, prompt)

    // Wait for Canvas to generate
    await waitForCanvas(page)

    // Export to Google Slides
    console.log("[gemini-puppeteer] Exporting to Google Slides...")
    const slidesEditUrl = await exportToSlides(page, browser)

    // Get the slides page (last opened tab)
    const pages = await browser.pages()
    const slidesPage = pages.find((p) => p.url().includes("docs.google.com/presentation"))
    if (!slidesPage) throw new GeminiAPIError("Could not find Slides tab")

    // Set public sharing
    console.log("[gemini-puppeteer] Setting public sharing...")
    await setPublicSharing(slidesPage)

    // Save updated cookies (from Gemini page for session freshness)
    if (process.env.GEMINI_COOKIES_BASE64) {
      // In Docker, we don't save to file — cookies come from env
    } else {
      try {
        const freshCookies = await page.cookies("https://gemini.google.com")
        const geminiCookies: GeminiCookie[] = freshCookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: Math.floor((c.expires ?? 0)),
        }))
        if (geminiCookies.length > 0) {
          saveCookies({ cookies: geminiCookies, updatedAt: new Date().toISOString() })
        }
      } catch {
        // Non-critical — cookies will be refreshed by keepalive
      }
    }

    // Construct the public view URL
    const presentationId = extractPresentationId(slidesEditUrl)
    const publicUrl = `https://docs.google.com/presentation/d/${presentationId}/edit?usp=sharing`

    console.log("[gemini-puppeteer] Public Slides URL:", publicUrl)
    return publicUrl
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    resolve!()
  }
}
