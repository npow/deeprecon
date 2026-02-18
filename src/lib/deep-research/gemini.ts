import type { Page } from "puppeteer"
import { withBrowser, DeepResearchError, DeepResearchAuthError } from "./browser"
import type { DeepResearchResult } from "./types"

const GEMINI_URL = "https://gemini.google.com/app"
const PROVIDER = "gemini" as const

async function verifyAuth(page: Page): Promise<void> {
  const url = page.url()
  if (url.includes("accounts.google.com") || url.includes("/signin")) {
    throw new DeepResearchAuthError(
      "Gemini session expired (redirected to login). Update GEMINI_COOKIES_BASE64 or re-login in Chrome profile.",
      PROVIDER
    )
  }

  try {
    await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15_000 })
  } catch {
    throw new DeepResearchAuthError(
      "Could not find Gemini input area. Session may be invalid.",
      PROVIDER
    )
  }
}

async function enableDeepResearch(page: Page): Promise<void> {
  // Click "Tools" button to open the tools menu
  const toolsBtn = await page.waitForSelector('button[aria-label="Tools"]', { timeout: 5_000 })
  if (!toolsBtn) throw new DeepResearchError("Could not find Tools button", PROVIDER)
  await toolsBtn.click()

  // Wait for the menu and click "Deep Research"
  await page.waitForSelector('[role="menuitemcheckbox"]', { timeout: 5_000 })
  const deepResearchItem = await page.evaluateHandle(() => {
    const items = document.querySelectorAll('[role="menuitemcheckbox"], menuitemcheckbox')
    for (const item of items) {
      if (item.textContent?.includes("Deep Research")) return item
    }
    return null
  })

  if (!deepResearchItem) throw new DeepResearchError("Could not find Deep Research in menu", PROVIDER)
  await (deepResearchItem as unknown as import("puppeteer").ElementHandle).click()

  // Wait for "Deselect Deep Research" to confirm it's enabled
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).some((b) => b.textContent?.includes("Deselect Deep Research"))
    },
    { timeout: 5_000 }
  )
}

async function typeAndSend(page: Page, prompt: string): Promise<void> {
  const input = await page.waitForSelector('div[role="textbox"][contenteditable="true"]', {
    timeout: 5_000,
  })
  if (!input) throw new DeepResearchError("Could not find prompt input", PROVIDER)
  await input.click()

  // Paste prompt via execCommand to avoid character-by-character typing
  await page.evaluate((text) => {
    const el = document.querySelector('div[role="textbox"][contenteditable="true"]')
    if (!el) return
    ;(el as HTMLElement).focus()
    document.execCommand("insertText", false, text)
  }, prompt)

  // Wait for send button and click
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
    return (
      Array.from(buttons).find(
        (b) => b.getAttribute("aria-label") === "Send message" || b.textContent === "Send message"
      ) || null
    )
  })
  if (!sendBtn) throw new DeepResearchError("Could not find Send button", PROVIDER)
  await (sendBtn as unknown as import("puppeteer").ElementHandle).click()
}

async function waitForResearchPlan(page: Page): Promise<void> {
  // Wait for "Start research" button to appear (plan is ready)
  console.log("[deep-research:gemini] Waiting for research plan...")
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      return Array.from(buttons).some((b) => b.textContent?.includes("Start research"))
    },
    { timeout: 120_000, polling: 2_000 }
  )
}

async function startResearch(page: Page): Promise<void> {
  const startBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll("button")
    return Array.from(buttons).find((b) => b.textContent?.includes("Start research")) || null
  })
  if (!startBtn) throw new DeepResearchError("Could not find Start research button", PROVIDER)
  await (startBtn as unknown as import("puppeteer").ElementHandle).click()
  console.log("[deep-research:gemini] Research started")
}

async function waitForCompletion(page: Page): Promise<void> {
  // Poll until "Stop response" button disappears or aria-busy is removed
  console.log("[deep-research:gemini] Waiting for research to complete (up to 10 min)...")
  await page.waitForFunction(
    () => {
      // Check if "Stop response" button is gone
      const buttons = document.querySelectorAll("button")
      const hasStopBtn = Array.from(buttons).some((b) => b.textContent?.includes("Stop response"))
      if (hasStopBtn) return false

      // Also check aria-busy is not set on any response area
      const busyEls = document.querySelectorAll('[aria-busy="true"]')
      if (busyEls.length > 0) return false

      // Check that there is actually some response content
      const copyBtns = Array.from(buttons).some(
        (b) => b.textContent?.includes("Copy") || b.getAttribute("aria-label")?.includes("Copy")
      )
      return copyBtns
    },
    { timeout: 600_000, polling: 5_000 }
  )
  console.log("[deep-research:gemini] Research complete")
}

async function extractMarkdown(page: Page): Promise<string> {
  // Extract text from the response area — Gemini renders markdown as HTML
  const markdown = await page.evaluate(() => {
    // Look for the response container — typically a model-response or message-content area
    const responseEls = document.querySelectorAll(
      'model-response, [class*="response"], [class*="message-content"], .markdown'
    )
    // Get the last/largest response element
    let best = ""
    for (const el of responseEls) {
      const text = (el as HTMLElement).innerText
      if (text.length > best.length) best = text
    }
    // Fallback: try the main content area
    if (!best) {
      const main = document.querySelector("main") || document.querySelector('[role="main"]')
      if (main) best = (main as HTMLElement).innerText
    }
    return best
  })

  if (!markdown || markdown.length < 50) {
    throw new DeepResearchError("Failed to extract research report from Gemini", PROVIDER)
  }

  return markdown
}

export async function runDeepResearch(prompt: string): Promise<DeepResearchResult> {
  const start = Date.now()

  const markdown = await withBrowser(PROVIDER, async (_browser, page) => {
    // Navigate to Gemini
    console.log("[deep-research:gemini] Navigating to Gemini...")
    await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await verifyAuth(page)

    // Enable Deep Research tool
    console.log("[deep-research:gemini] Enabling Deep Research...")
    await enableDeepResearch(page)

    // Type prompt and send
    console.log("[deep-research:gemini] Sending prompt...")
    await typeAndSend(page, prompt)

    // Wait for research plan, then start
    await waitForResearchPlan(page)
    await startResearch(page)

    // Wait for completion
    await waitForCompletion(page)

    // Extract markdown
    return extractMarkdown(page)
  })

  return {
    markdown,
    provider: PROVIDER,
    durationMs: Date.now() - start,
  }
}
