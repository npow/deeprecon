#!/usr/bin/env node
/**
 * Extract cookies from your running Chrome via CDP (Chrome DevTools Protocol).
 * Connects to Chrome's debug port, pulls cookies for each provider, and
 * saves them as base64 env vars in .env.local.
 *
 * Usage:
 *   node scripts/extract-cookies-cdp.mjs                  # all providers
 *   node scripts/extract-cookies-cdp.mjs gemini            # one provider
 */

import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const ENV_LOCAL = path.join(ROOT, ".env.local")

const PROVIDER_DOMAINS = {
  gemini: ["google.com", "gemini.google.com"],
  chatgpt: ["chatgpt.com", "openai.com"],
  claude: ["claude.ai", "anthropic.com"],
}

const ENV_VAR_NAMES = {
  gemini: "GEMINI_COOKIES_BASE64",
  chatgpt: "CHATGPT_COOKIES_BASE64",
  claude: "CLAUDE_COOKIES_BASE64",
}

async function findCDPEndpoint() {
  // Try common CDP ports, then scan Chrome listening ports
  const candidatePorts = [9222, 9229, 50338]

  // Also scan for Chrome listening ports via lsof
  try {
    const lsof = execSync(
      "lsof -iTCP -sTCP:LISTEN -P 2>/dev/null || true",
      { encoding: "utf-8" }
    )
    for (const line of lsof.split("\n")) {
      if (!/google|chrome/i.test(line)) continue
      const match = line.match(/:(\d+)\s/)
      if (match) candidatePorts.push(parseInt(match[1]))
    }
  } catch { /* ignore */ }

  for (const port of [...new Set(candidatePorts)]) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      })
      const data = await res.json()
      if (data.webSocketDebuggerUrl) {
        return { port, wsUrl: data.webSocketDebuggerUrl }
      }
    } catch {
      // not a CDP endpoint
    }
  }
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const selected = args.length > 0
    ? args.filter((a) => a in PROVIDER_DOMAINS)
    : Object.keys(PROVIDER_DOMAINS)

  console.log("Finding Chrome CDP endpoint...")
  const cdp = await findCDPEndpoint()
  if (!cdp) {
    console.error("Could not find Chrome with CDP enabled.")
    console.error("Chrome may need to be relaunched with --remote-debugging-port,")
    console.error("or check that Chrome DevTools MCP is connected.")
    process.exit(1)
  }
  console.log(`Connected to Chrome on port ${cdp.port}\n`)

  const browser = await puppeteer.connect({ browserWSEndpoint: cdp.wsUrl })

  // Use CDP to get all cookies
  const pages = await browser.pages()
  if (pages.length === 0) {
    console.error("No pages found in browser")
    process.exit(1)
  }

  // Get cookies from CDP directly (all domains)
  const client = await pages[0].createCDPSession()
  const { cookies: allCookies } = await client.send("Network.getAllCookies")

  console.log(`Found ${allCookies.length} total cookies in Chrome\n`)

  // Read existing .env.local
  let envContent = ""
  if (fs.existsSync(ENV_LOCAL)) {
    envContent = fs.readFileSync(ENV_LOCAL, "utf-8")
  }

  const results = {}

  for (const provider of selected) {
    const domains = PROVIDER_DOMAINS[provider]
    const filtered = allCookies.filter((c) =>
      domains.some((d) => c.domain.includes(d))
    )

    process.stdout.write(`  ${provider}: `)

    if (filtered.length === 0) {
      console.log("no cookies found (not logged in?)")
      continue
    }

    const cookies = filtered.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires > 0 ? Math.floor(c.expires) : 0,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }))

    const jar = { cookies, updatedAt: new Date().toISOString() }
    const base64 = Buffer.from(JSON.stringify(jar)).toString("base64")
    const envVar = ENV_VAR_NAMES[provider]
    results[envVar] = base64

    console.log(`${cookies.length} cookies`)
  }

  // Don't close — it's the user's browser!
  browser.disconnect()

  if (Object.keys(results).length === 0) {
    console.log("\nNo cookies extracted.")
    process.exit(1)
  }

  // Update .env.local
  let lines = envContent.split("\n")
  for (const [varName, value] of Object.entries(results)) {
    const idx = lines.findIndex((l) => l.startsWith(`${varName}=`))
    const newLine = `${varName}=${value}`
    if (idx >= 0) {
      lines[idx] = newLine
    } else {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("")
      lines.push(newLine)
    }
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  lines.push("")

  fs.writeFileSync(ENV_LOCAL, lines.join("\n"))
  console.log(`\nWritten to ${ENV_LOCAL}:`)
  for (const varName of Object.keys(results)) {
    console.log(`  ${varName}`)
  }
}

main().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
