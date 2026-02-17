#!/usr/bin/env node
/**
 * Gemini Login Script
 *
 * Launches a browser window so you can log in to Gemini.
 * After login is detected, cookies are saved to data/gemini-cookies.json
 * for use by the pitch deck exporter.
 *
 * Usage: npm run gemini:login
 */

import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const COOKIES_PATH = path.join(ROOT, "data", "gemini-cookies.json")
const PROFILE_DIR = path.join(ROOT, "data", "gemini-chrome-profile")

async function main() {
  console.log("Launching browser for Gemini login...")
  console.log("Please log in to your Google account in the browser window.\n")

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    args: ["--no-first-run", "--no-default-browser-check"],
  })

  const page = await browser.newPage()
  await page.goto("https://gemini.google.com", { waitUntil: "networkidle2" })

  console.log("Waiting for login... (the page should show the Gemini chat interface)")
  console.log("If already logged in, cookies will be extracted shortly.\n")

  // Wait until we detect the Gemini app is loaded (not a login/redirect page)
  // Poll for the SNlM0e token which indicates an authenticated session
  let authenticated = false
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 2000))

    try {
      const url = page.url()
      if (url.includes("accounts.google.com")) {
        if (attempt % 10 === 0) {
          console.log("  Still on Google login page, waiting...")
        }
        continue
      }

      const content = await page.content()
      if (content.includes("SNlM0e")) {
        authenticated = true
        break
      }

      // Also check if we're on the Gemini app page
      if (url.includes("gemini.google.com/app") || url.includes("gemini.google.com/gem")) {
        authenticated = true
        break
      }
    } catch {
      // Page might be navigating
    }
  }

  if (!authenticated) {
    console.error("Timed out waiting for login (4 minutes). Please try again.")
    await browser.close()
    process.exit(1)
  }

  console.log("Login detected! Extracting cookies...")

  const cookies = await page.cookies()
  const geminiCookies = cookies
    .filter(
      (c) =>
        c.domain.includes("google.com") ||
        c.domain.includes("gemini.google.com")
    )
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
    }))

  // Ensure data directory exists
  const dataDir = path.dirname(COOKIES_PATH)
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const jar = {
    cookies: geminiCookies,
    updatedAt: new Date().toISOString(),
  }

  fs.writeFileSync(COOKIES_PATH, JSON.stringify(jar, null, 2))
  console.log(`\nSaved ${geminiCookies.length} cookies to ${COOKIES_PATH}`)
  console.log("You can now close this browser window.")

  await browser.close()
  console.log("Done!")
}

main().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
