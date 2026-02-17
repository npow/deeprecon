#!/usr/bin/env node
import fs from "fs"
import path from "path"
import { chromium } from "playwright"

const baseUrl = process.env.BROWSER_BASE_URL || "http://127.0.0.1:3000"
const artifactDir = path.join(process.cwd(), "artifacts", "browser-smoke")
fs.mkdirSync(artifactDir, { recursive: true })

function assertNotBroken(text, route, strict) {
  const body = text.toLowerCase()
  const badSignals = ["application error", "500", "referenceerror", "hydration failed"]
  for (const sig of badSignals) {
    if (body.includes(sig) && strict) throw new Error(`route ${route} appears broken (${sig})`)
  }
}

async function checkRoute(page, route, marker, strict = true) {
  const url = `${baseUrl}${route}`
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
  if (!res || !res.ok()) throw new Error(`route ${route} failed to load (status ${res?.status() ?? "n/a"})`)

  await page.waitForTimeout(1200)
  const text = await page.locator("body").innerText()
  assertNotBroken(text, route, strict)

  if (marker && !text.toLowerCase().includes(marker.toLowerCase()) && strict) {
    throw new Error(`route ${route} missing expected marker: ${marker}`)
  }

  const name = route === "/" ? "home" : route.slice(1).replaceAll("/", "-")
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true })
  console.log(`OK ${route}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  await checkRoute(page, "/", "recon", true)
  await checkRoute(page, "/maps", "providers", true)
  // /scans has backend dependencies; keep visibility but avoid hard failure.
  await checkRoute(page, "/scans", "scan", false)
  console.log(`browser-smoke passed against ${baseUrl}`)
} finally {
  await browser.close()
}
