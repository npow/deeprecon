import type { Page } from "puppeteer"
import { withBrowser, DeepResearchError, DeepResearchAuthError } from "./browser"
import type { DeepResearchResult } from "./types"

const CHATGPT_URL = "https://chatgpt.com/"
const PROVIDER = "chatgpt" as const

async function verifyAuth(page: Page): Promise<void> {
  const url = page.url()
  if (url.includes("auth0.openai.com") || url.includes("/auth/login")) {
    throw new DeepResearchAuthError(
      "ChatGPT session expired (redirected to login). Update CHATGPT_COOKIES_BASE64 or re-login in Chrome profile.",
      PROVIDER
    )
  }

  // Wait for the prompt input to appear
  try {
    await page.waitForFunction(
      () => {
        return (
          document.querySelector('#prompt-textarea') ||
          document.querySelector('div[contenteditable="true"]') ||
          document.querySelector('textarea')
        )
      },
      { timeout: 15_000 }
    )
  } catch {
    throw new DeepResearchAuthError(
      "Could not find ChatGPT input area. Session may be invalid.",
      PROVIDER
    )
  }
}

async function enableDeepResearch(page: Page): Promise<void> {
  // Try clicking the model selector / tools to enable deep research
  // The UI varies — try the model selector dropdown first
  console.log("[deep-research:chatgpt] Enabling deep research mode...")

  // Look for a model selector or tools button
  const clicked = await page.evaluate(() => {
    // Try model selector dropdown
    const modelBtn = document.querySelector('[data-testid="model-selector"]') as HTMLElement
    if (modelBtn) {
      modelBtn.click()
      return "model-selector"
    }
    // Try a button that mentions "Tools"
    const buttons = document.querySelectorAll("button")
    for (const b of buttons) {
      if (b.textContent?.includes("Tools")) {
        b.click()
        return "tools"
      }
    }
    return null
  })

  if (clicked === "model-selector") {
    // Wait for dropdown and select Deep Research
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll('[role="menuitem"], [role="option"], [data-testid*="model"]')
        return Array.from(items).some((i) => i.textContent?.includes("Deep Research"))
      },
      { timeout: 5_000 }
    ).catch(() => {
      throw new DeepResearchError("Deep Research option not found in model selector. Requires Plus/Pro plan.", PROVIDER)
    })

    await page.evaluate(() => {
      const items = document.querySelectorAll('[role="menuitem"], [role="option"], [data-testid*="model"]')
      for (const item of items) {
        if (item.textContent?.includes("Deep Research")) {
          ;(item as HTMLElement).click()
          return
        }
      }
    })
  } else if (clicked === "tools") {
    // Wait for tools menu and select deep research
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll('[role="menuitem"], [role="option"]')
        return Array.from(items).some((i) =>
          i.textContent?.toLowerCase().includes("deep research")
        )
      },
      { timeout: 5_000 }
    ).catch(() => {
      throw new DeepResearchError("Deep Research option not found in tools menu", PROVIDER)
    })

    await page.evaluate(() => {
      const items = document.querySelectorAll('[role="menuitem"], [role="option"]')
      for (const item of items) {
        if (item.textContent?.toLowerCase().includes("deep research")) {
          ;(item as HTMLElement).click()
          return
        }
      }
    })
  } else {
    throw new DeepResearchError(
      "Could not find model selector or tools button to enable Deep Research",
      PROVIDER
    )
  }

  // Brief pause for UI to update
  await new Promise((r) => setTimeout(r, 1_000))
}

async function typeAndSend(page: Page, prompt: string): Promise<void> {
  // Focus the input
  const inputSelector = '#prompt-textarea, div[contenteditable="true"], textarea'
  const input = await page.waitForSelector(inputSelector, { timeout: 5_000 })
  if (!input) throw new DeepResearchError("Could not find prompt input", PROVIDER)
  await input.click()

  // Paste prompt
  await page.evaluate((text) => {
    const el =
      document.querySelector('#prompt-textarea') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea')
    if (!el) return
    ;(el as HTMLElement).focus()
    // For contenteditable divs
    if ((el as HTMLElement).contentEditable === "true") {
      document.execCommand("insertText", false, text)
    } else {
      // For textarea elements
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text)
        el.dispatchEvent(new Event("input", { bubbles: true }))
      }
    }
  }, prompt)

  // Wait for send button and click
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="send-button"]') as HTMLElement
      return btn && !btn.hasAttribute("disabled")
    },
    { timeout: 5_000 }
  )

  const sendBtn = await page.$('[data-testid="send-button"]')
  if (!sendBtn) throw new DeepResearchError("Could not find Send button", PROVIDER)
  await sendBtn.click()
}

async function waitForPlanAndStart(page: Page): Promise<void> {
  // ChatGPT may show a research plan with a "Start" button
  console.log("[deep-research:chatgpt] Waiting for research plan...")

  // Wait up to 60s for either a "Start" button or for research to auto-start
  const hasStartBtn = await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button")
      // Check if there's a Start button (plan review phase)
      const startBtn = Array.from(buttons).some(
        (b) => b.textContent?.trim() === "Start" || b.textContent?.trim() === "Start research"
      )
      if (startBtn) return "start"

      // Check if research already started (browsing indicators)
      const browsing = document.body.textContent?.includes("Browsing") ||
        document.body.textContent?.includes("Searching") ||
        document.body.textContent?.includes("Reading")
      if (browsing) return "auto-started"

      return false
    },
    { timeout: 60_000, polling: 2_000 }
  )

  const result = await hasStartBtn.jsonValue()
  if (result === "start") {
    // Click the Start button
    await page.evaluate(() => {
      const buttons = document.querySelectorAll("button")
      for (const b of buttons) {
        if (b.textContent?.trim() === "Start" || b.textContent?.trim() === "Start research") {
          b.click()
          return
        }
      }
    })
    console.log("[deep-research:chatgpt] Clicked Start research")
  } else {
    console.log("[deep-research:chatgpt] Research auto-started")
  }
}

async function waitForCompletion(page: Page): Promise<void> {
  // ChatGPT deep research can take 5-30 minutes
  console.log("[deep-research:chatgpt] Waiting for research to complete (up to 30 min)...")

  await page.waitForFunction(
    () => {
      // Check that streaming/generation has stopped
      const stopBtns = document.querySelectorAll('[data-testid="stop-button"], button[aria-label="Stop generating"]')
      if (stopBtns.length > 0) return false

      // Check for browsing/searching indicators
      const text = document.body.textContent || ""
      if (text.includes("Browsing") || text.includes("Searching...")) return false

      // Check for the presence of a completed report — look for citation markers or long response
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]')
      if (messages.length === 0) return false
      const lastMessage = messages[messages.length - 1]
      // Report should be substantial
      return (lastMessage as HTMLElement).innerText.length > 200
    },
    { timeout: 1_800_000, polling: 10_000 } // 30 min
  )
  console.log("[deep-research:chatgpt] Research complete")
}

async function extractMarkdown(page: Page): Promise<string> {
  const markdown = await page.evaluate(() => {
    // Get the last assistant message
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]')
    if (messages.length === 0) return ""
    const lastMessage = messages[messages.length - 1]

    // Try to find a document viewer / report area within the response
    const report =
      lastMessage.querySelector('[class*="document"]') ||
      lastMessage.querySelector('[class*="report"]') ||
      lastMessage.querySelector(".markdown") ||
      lastMessage

    return (report as HTMLElement).innerText
  })

  if (!markdown || markdown.length < 50) {
    throw new DeepResearchError("Failed to extract research report from ChatGPT", PROVIDER)
  }

  return markdown
}

export async function runDeepResearch(prompt: string): Promise<DeepResearchResult> {
  const start = Date.now()

  const markdown = await withBrowser(PROVIDER, async (_browser, page) => {
    // Navigate to ChatGPT
    console.log("[deep-research:chatgpt] Navigating to ChatGPT...")
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await verifyAuth(page)

    // Enable deep research mode
    await enableDeepResearch(page)

    // Type prompt and send
    console.log("[deep-research:chatgpt] Sending prompt...")
    await typeAndSend(page, prompt)

    // Wait for plan and start
    await waitForPlanAndStart(page)

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
