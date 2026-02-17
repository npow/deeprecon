#!/usr/bin/env node
/**
 * quality-check.mjs
 *
 * Validate imported records before promotion into maps.
 *
 * Usage:
 *   node scripts/import/quality-check.mjs --source ai-native-dev-landscape
 *   node scripts/import/quality-check.mjs --all
 */

import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const IMPORTS_DIR = path.join(ROOT, "data", "imports")

const args = process.argv.slice(2)
function hasFlag(flag) {
  return args.includes(`--${flag}`)
}
function getFlag(flag, fallback = "") {
  const i = args.indexOf(`--${flag}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const runAll = hasFlag("all")
const source = getFlag("source", "")
const failOnRestricted = hasFlag("fail-on-restricted")

function isValidUrl(value) {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function findSources() {
  if (!fs.existsSync(IMPORTS_DIR)) return []
  return fs.readdirSync(IMPORTS_DIR).filter((d) => {
    const p = path.join(IMPORTS_DIR, d)
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "latest.json"))
  })
}

function loadSource(src) {
  const file = path.join(IMPORTS_DIR, src, "latest.json")
  if (!fs.existsSync(file)) throw new Error(`Missing latest snapshot: ${file}`)
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function validateRecord(r) {
  const issues = []

  if (!r.name || !String(r.name).trim()) issues.push("missing_name")
  if (!r.source) issues.push("missing_source")
  if (!r.sourceUrl || !isValidUrl(r.sourceUrl)) issues.push("invalid_source_url")
  if (r.websiteUrl && !isValidUrl(r.websiteUrl)) issues.push("invalid_website_url")
  if (!r.category) issues.push("missing_category")
  if (!r.capturedAt) issues.push("missing_captured_at")
  if (!r.license) issues.push("missing_license")
  if (!r.legal || typeof r.legal.restricted !== "boolean") issues.push("missing_legal_flag")

  return issues
}

function runForSource(src) {
  const payload = loadSource(src)
  const records = Array.isArray(payload.records) ? payload.records : []

  let pass = 0
  let fail = 0
  let restricted = 0
  const quarantined = []

  for (const r of records) {
    const issues = validateRecord(r)
    if (r.legal?.restricted) restricted++

    if (issues.length > 0) {
      fail++
      quarantined.push({ record: r, issues })
    } else {
      pass++
    }
  }

  const quarantineDir = path.join(IMPORTS_DIR, "quarantine")
  if (!fs.existsSync(quarantineDir)) fs.mkdirSync(quarantineDir, { recursive: true })

  const out = {
    source: src,
    checkedAt: new Date().toISOString(),
    total: records.length,
    passed: pass,
    failed: fail,
    restricted,
    restrictedRate: records.length ? Number((restricted / records.length).toFixed(4)) : 0,
    failureRate: records.length ? Number((fail / records.length).toFixed(4)) : 0,
    quarantined,
  }

  const reportFile = path.join(quarantineDir, `${src}.latest.report.json`)
  fs.writeFileSync(reportFile, JSON.stringify(out, null, 2))

  return out
}

function main() {
  const sources = runAll ? findSources() : source ? [source] : []
  if (sources.length === 0) {
    console.error("Usage: node scripts/import/quality-check.mjs --all | --source <name>")
    process.exit(1)
  }

  const reports = sources.map(runForSource)
  let hasFailures = false
  let hasRestricted = false

  for (const r of reports) {
    if (r.failed > 0) hasFailures = true
    if (r.restricted > 0) hasRestricted = true
  }

  console.log(JSON.stringify({
    checkedSources: sources,
    reports: reports.map((r) => ({
      source: r.source,
      total: r.total,
      passed: r.passed,
      failed: r.failed,
      restricted: r.restricted,
      failureRate: r.failureRate,
      restrictedRate: r.restrictedRate,
    })),
    failOnRestricted,
  }, null, 2))

  if (hasFailures || (failOnRestricted && hasRestricted)) {
    process.exit(2)
  }
}

main()
