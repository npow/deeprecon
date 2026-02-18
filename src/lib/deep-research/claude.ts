import type { Page } from "puppeteer"
import { withBrowser, DeepResearchError, DeepResearchAuthError } from "./browser"
import type { DeepResearchResult } from "./types"

const CLAUDE_URL = "https://claude.ai/new"
const PROVIDER = "claude" as const

async function verifyAuth(page: Page): Promise<void> {
  const url = page.url()
  if (url.includes("/login") || url.includes("accounts.google.com")) {
    throw new DeepResearchAuthError(
      "Claude session expired (redirected to login). Update CLAUDE_COOKIES_BASE64 or re-login in Chrome profile.",
      PROVIDER
    )
  }

  // Wait for the prompt input to appear
  try {
    await page.waitForFunction(
      () => {
        return (
          document.querySelector('[contenteditable="true"]') ||
          document.querySelector('textarea')
        )
      },
      { timeout: 15_000 }
    )
  } catch {
    throw new DeepResearchAuthError(
      "Could not find Claude input area. Session may be invalid.",
      PROVIDER
    )
  }
}

async function enableResearch(page: Page): Promise<void> {
  console.log("[deep-research:claude] Enabling Research mode...")

  // Look for the Research button (bottom-left area of chat input)
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button")
    for (const b of buttons) {
      const text = b.textContent?.trim() || ""
      const label = b.getAttribute("aria-label") || ""
      if (
        text.includes("Research") ||
        label.includes("Research") ||
        label.includes("research")
      ) {
        // Check if it's already enabled (blue state)
        const isActive =
          b.getAttribute("aria-pressed") === "true" ||
          b.classList.contains("active") ||
          b.getAttribute("data-state") === "active"
        if (!isActive) {
          b.click()
          return "clicked"
        }
        return "already-active"
      }
    }
    return null
  })

  if (clicked === "already-active") {
    console.log("[deep-research:claude] Research already enabled")
    return
  }

  if (clicked === "clicked") {
    console.log("[deep-research:claude] Research button clicked")
    await new Promise((r) => setTimeout(r, 1_000))
    return
  }

  // Fallback: try enabling web search first via slider/settings icon
  const fallback = await page.evaluate(() => {
    // Look for a settings/slider icon button near the input
    const buttons = document.querySelectorAll("button")
    for (const b of buttons) {
      const label = b.getAttribute("aria-label") || ""
      if (label.includes("slider") || label.includes("settings") || label.includes("toggle")) {
        b.click()
        return "settings-opened"
      }
    }
    return null
  })

  if (fallback === "settings-opened") {
    await new Promise((r) => setTimeout(r, 1_000))

    // Look for "Web search" toggle and enable it
    await page.evaluate(() => {
      const labels = document.querySelectorAll("label, span, div")
      for (const el of labels) {
        if (el.textContent?.includes("Web search") || el.textContent?.includes("web search")) {
          // Find associated toggle/checkbox
          const toggle =
            el.querySelector('input[type="checkbox"]') ||
            el.querySelector('[role="switch"]') ||
            el.closest("label")?.querySelector("input")
          if (toggle) (toggle as HTMLElement).click()
          return
        }
      }
    })

    await new Promise((r) => setTimeout(r, 500))

    // Now try the Research button again
    await page.evaluate(() => {
      const buttons = document.querySelectorAll("button")
      for (const b of buttons) {
        if (b.textContent?.includes("Research") || b.getAttribute("aria-label")?.includes("Research")) {
          b.click()
          return
        }
      }
    })

    await new Promise((r) => setTimeout(r, 1_000))
    return
  }

  // If we still couldn't enable research, warn but continue — it might still work
  console.warn("[deep-research:claude] Could not find Research button — proceeding anyway")
}

async function typeAndSend(page: Page, prompt: string): Promise<void> {
  // Focus the input
  const input = await page.waitForSelector('[contenteditable="true"], textarea', { timeout: 5_000 })
  if (!input) throw new DeepResearchError("Could not find prompt input", PROVIDER)
  await input.click()

  // Paste prompt
  await page.evaluate((text) => {
    const el =
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea')
    if (!el) return
    ;(el as HTMLElement).focus()
    if ((el as HTMLElement).contentEditable === "true") {
      document.execCommand("insertText", false, text)
    } else {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text)
        el.dispatchEvent(new Event("input", { bubbles: true }))
      }
    }
  }, prompt)

  // Wait briefly for send button to become active
  await new Promise((r) => setTimeout(r, 500))

  // Click send button
  await page.evaluate(() => {
    const buttons = document.querySelectorAll("button")
    for (const b of buttons) {
      const label = b.getAttribute("aria-label") || ""
      if (
        label.includes("Send") ||
        label.includes("send") ||
        b.textContent?.trim() === "Send"
      ) {
        b.click()
        return
      }
    }
    // Fallback: look for a submit button near the input area
    const form = document.querySelector("form")
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector("button:last-child")
      if (submitBtn) (submitBtn as HTMLElement).click()
    }
  })
}

async function waitForCompletion(page: Page): Promise<void> {
  // Wait for the response to finish streaming (up to 10 min)
  console.log("[deep-research:claude] Waiting for research to complete (up to 10 min)...")

  // First, wait for a response to start appearing
  await page.waitForFunction(
    () => {
      const responses = document.querySelectorAll(
        '[data-is-streaming], [class*="response"], [class*="message"]'
      )
      return responses.length > 0 || document.body.textContent?.includes("Searching")
    },
    { timeout: 30_000, polling: 2_000 }
  )

  // Then wait for streaming to stop
  await page.waitForFunction(
    () => {
      // Check if still streaming
      const streaming = document.querySelector('[data-is-streaming="true"]')
      if (streaming) return false

      // Check for a stop button
      const buttons = document.querySelectorAll("button")
      const hasStop = Array.from(buttons).some(
        (b) =>
          b.getAttribute("aria-label")?.includes("Stop") ||
          b.textContent?.includes("Stop")
      )
      if (hasStop) return false

      // Check for searching indicators
      const text = document.body.textContent || ""
      if (text.includes("Searching") && !text.includes("searched")) return false

      // Verify there's substantial content
      const messages = document.querySelectorAll('[class*="message"], [class*="response"]')
      if (messages.length === 0) return false
      const lastMsg = messages[messages.length - 1] as HTMLElement
      return lastMsg.innerText.length > 200
    },
    { timeout: 600_000, polling: 5_000 } // 10 min
  )
  console.log("[deep-research:claude] Research complete")
}

async function extractMarkdown(page: Page): Promise<string> {
  const markdown = await page.evaluate(() => {
    // Get the last assistant/response message
    const messages = document.querySelectorAll(
      '[class*="response"], [class*="message"], [data-message-author="assistant"]'
    )
    if (messages.length === 0) return ""

    // Find the longest message (the report)
    let best = ""
    for (const msg of messages) {
      const text = (msg as HTMLElement).innerText
      if (text.length > best.length) best = text
    }
    return best
  })

  if (!markdown || markdown.length < 50) {
    throw new DeepResearchError("Failed to extract research report from Claude", PROVIDER)
  }

  return markdown
}

export async function runDeepResearch(prompt: string): Promise<DeepResearchResult> {
  const start = Date.now()

  const markdown = await withBrowser(PROVIDER, async (_browser, page) => {
    // Navigate to Claude
    console.log("[deep-research:claude] Navigating to Claude...")
    await page.goto(CLAUDE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await verifyAuth(page)

    // Enable Research mode
    await enableResearch(page)

    // Type prompt and send
    console.log("[deep-research:claude] Sending prompt...")
    await typeAndSend(page, prompt)

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
