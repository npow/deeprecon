#!/usr/bin/env node
/**
 * Smoke test: verify deep-research auth for each provider.
 * Connects to the user's Chrome via CDP (port 9222) and checks
 * that each provider's logged-in UI is accessible.
 *
 * Usage: node scripts/test-deep-research-auth.mjs [gemini] [chatgpt] [claude]
 */

import puppeteer from "puppeteer"

const CDP_PORT = parseInt(process.env.CHROME_CDP_PORT || "9222", 10)

const PROVIDERS = {
  gemini: {
    url: "https://gemini.google.com/app",
    check: async (page) => {
      const url = page.url()
      if (url.includes("accounts.google.com") || url.includes("/signin")) {
        return "redirected to Google login"
      }
      try {
        await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15_000 })
        return null
      } catch {
        return `no prompt input found (url: ${page.url()})`
      }
    },
  },
  chatgpt: {
    url: "https://chatgpt.com/",
    check: async (page) => {
      const url = page.url()
      if (url.includes("auth0.openai.com") || url.includes("/auth/login")) {
        return "redirected to OpenAI login"
      }
      try {
        await page.waitForFunction(
          () =>
            document.querySelector("#prompt-textarea") ||
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector("textarea"),
          { timeout: 15_000 }
        )
        return null
      } catch {
        return `no prompt input found (url: ${page.url()})`
      }
    },
  },
  claude: {
    url: "https://claude.ai/new",
    check: async (page) => {
      const url = page.url()
      if (url.includes("/login")) {
        return "redirected to Claude login"
      }
      try {
        await page.waitForFunction(
          () =>
            document.querySelector('[contenteditable="true"]') ||
            document.querySelector("textarea"),
          { timeout: 15_000 }
        )
        return null
      } catch {
        return `no prompt input found (url: ${page.url()})`
      }
    },
  },
}

async function findCDP() {
  for (const port of [CDP_PORT, 9222, 9229]) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      })
      const data = await res.json()
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl
    } catch { /* skip */ }
  }
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const selected = args.length > 0
    ? args.filter((a) => a in PROVIDERS)
    : Object.keys(PROVIDERS)

  const wsUrl = await findCDP()
  if (!wsUrl) {
    console.error("No Chrome CDP endpoint found.")
    console.error("Launch Chrome with: --remote-debugging-port=9222")
    process.exit(1)
  }

  console.log("Testing deep-research auth via CDP...\n")

  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl })

  for (const name of selected) {
    process.stdout.write(`  ${name}: `)
    const config = PROVIDERS[name]
    const page = await browser.newPage()
    try {
      await page.setViewport({ width: 1280, height: 800 })
      await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 30_000 })
      const err = await config.check(page)
      if (err) {
        console.log(`✗ ${err}`)
      } else {
        console.log("✓ authenticated")
      }
    } catch (e) {
      console.log(`✗ ${e.message}`)
    } finally {
      await page.close().catch(() => {})
    }
  }

  browser.disconnect()
  console.log()
}

main().catch((err) => {
  console.error("Fatal:", err.message)
  process.exit(1)
})
