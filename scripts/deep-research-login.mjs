#!/usr/bin/env node
/**
 * Deep Research Login Script
 *
 * Launches a visible browser with the shared Chrome profile so you can log in
 * to Gemini, ChatGPT, and/or Claude. Cookies persist in the profile and are
 * reused by headless deep-research Puppeteer runs.
 *
 * Usage:
 *   npm run deep-research:login                   # login to all providers
 *   npm run deep-research:login -- gemini          # login to Gemini only
 *   npm run deep-research:login -- chatgpt claude  # login to specific providers
 */

import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const PROFILE_DIR = path.join(ROOT, "data", "chrome-profile")

const PROVIDERS = {
  gemini: {
    url: "https://gemini.google.com/app",
    checkAuth: (page) => {
      const url = page.url()
      return (
        url.includes("gemini.google.com/app") ||
        url.includes("gemini.google.com/gem")
      )
    },
    loginHint: "Log in with your Google account.",
  },
  chatgpt: {
    url: "https://chatgpt.com/",
    checkAuth: (page) => {
      const url = page.url()
      return (
        url.includes("chatgpt.com") &&
        !url.includes("/auth") &&
        !url.includes("login")
      )
    },
    loginHint: "Log in with your OpenAI account (requires Plus/Pro for deep research).",
  },
  claude: {
    url: "https://claude.ai/new",
    checkAuth: (page) => {
      const url = page.url()
      return url.includes("claude.ai") && !url.includes("/login")
    },
    loginHint: "Log in with your Anthropic account (requires Pro/Max for research).",
  },
}

async function waitForAuth(page, provider, config) {
  console.log(`\n--- ${provider} ---`)
  console.log(`  ${config.loginHint}`)
  console.log(`  Navigating to ${config.url}...`)

  await page.goto(config.url, { waitUntil: "networkidle2", timeout: 30_000 })

  // Check if already authenticated
  if (config.checkAuth(page)) {
    console.log(`  Already logged in!`)
    return true
  }

  console.log(`  Waiting for login (up to 4 min)...`)
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 2_000))
    try {
      if (config.checkAuth(page)) {
        console.log(`  Login detected!`)
        return true
      }
      if (attempt > 0 && attempt % 15 === 0) {
        console.log(`  Still waiting...`)
      }
    } catch {
      // Page may be navigating
    }
  }

  console.log(`  Timed out waiting for login.`)
  return false
}

async function main() {
  const args = process.argv.slice(2)
  const selected = args.length > 0
    ? args.filter((a) => a in PROVIDERS)
    : Object.keys(PROVIDERS)

  if (selected.length === 0) {
    console.error("Usage: node scripts/deep-research-login.mjs [gemini] [chatgpt] [claude]")
    process.exit(1)
  }

  // Ensure profile dir exists
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true })
  }

  console.log(`Launching browser for: ${selected.join(", ")}`)
  console.log(`Profile: ${PROFILE_DIR}\n`)

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    args: ["--no-first-run", "--no-default-browser-check"],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  const results = {}
  for (const name of selected) {
    results[name] = await waitForAuth(page, name, PROVIDERS[name])
  }

  console.log("\n=== Results ===")
  for (const [name, ok] of Object.entries(results)) {
    console.log(`  ${name}: ${ok ? "✓ authenticated" : "✗ not authenticated"}`)
  }

  await browser.close()
  console.log("\nDone! Cookies are saved in the Chrome profile.")
  console.log("Headless deep-research runs will reuse them automatically.")
}

main().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
