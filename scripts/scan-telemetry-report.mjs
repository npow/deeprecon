#!/usr/bin/env node
import fs from "fs"
import path from "path"

const filePath = path.join(process.cwd(), "data", "telemetry", "scan-timings.ndjson")

if (!fs.existsSync(filePath)) {
  console.error(`No telemetry file found at ${filePath}`)
  process.exit(1)
}

const lines = fs.readFileSync(filePath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)

const rows = []
for (const line of lines) {
  try {
    rows.push(JSON.parse(line))
  } catch {
    // skip malformed
  }
}

if (rows.length === 0) {
  console.error("No valid telemetry rows")
  process.exit(1)
}

function quantile(sorted, q) {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const w = idx - lo
  return sorted[lo] * (1 - w) + sorted[hi] * w
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((s, n) => s + n, 0)
  return {
    n: sorted.length,
    avg: sum / sorted.length,
    min: sorted[0],
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  }
}

function fmtMs(ms) {
  return `${Math.round(ms)}ms`
}

function printTable(title, groups) {
  console.log(`\n${title}`)
  const entries = Object.entries(groups)
    .map(([k, vals]) => [k, summarize(vals)])
    .sort((a, b) => b[1].p95 - a[1].p95)

  for (const [k, s] of entries) {
    console.log(
      `${k.padEnd(34)} n=${String(s.n).padStart(3)} avg=${fmtMs(s.avg).padStart(8)} p95=${fmtMs(s.p95).padStart(8)} p99=${fmtMs(s.p99).padStart(8)} max=${fmtMs(s.max).padStart(8)}`
    )
  }
}

const stageGroups = {}
const providerGroups = {}
const scanTotal = []

for (const r of rows) {
  if (typeof r.durationMs !== "number") continue
  if (r.kind === "scan" && r.name === "scan.total") {
    scanTotal.push(r.durationMs)
  }
  if (r.kind === "stage") {
    const key = r.name || r.stage || "unknown_stage"
    stageGroups[key] ||= []
    stageGroups[key].push(r.durationMs)
  }
  if (r.kind === "provider") {
    const provider = r.provider || "unknown"
    const model = r.model ? `:${r.model}` : ""
    const key = `${provider}${model}`
    providerGroups[key] ||= []
    providerGroups[key].push(r.durationMs)
  }
}

if (scanTotal.length) {
  const s = summarize(scanTotal)
  console.log("Scan Totals")
  console.log(`scan.total${" ".repeat(26)} n=${String(s.n).padStart(3)} avg=${fmtMs(s.avg).padStart(8)} p95=${fmtMs(s.p95).padStart(8)} p99=${fmtMs(s.p99).padStart(8)} max=${fmtMs(s.max).padStart(8)}`)
}

printTable("Stage Durations", stageGroups)
printTable("Provider Durations", providerGroups)

const cliproxyVals = rows
  .filter((r) => r.kind === "provider" && r.provider === "cliproxy" && typeof r.durationMs === "number")
  .map((r) => r.durationMs)
const geminiVals = rows
  .filter((r) => r.kind === "provider" && r.provider === "gemini" && typeof r.durationMs === "number")
  .map((r) => r.durationMs)

if (cliproxyVals.length || geminiVals.length) {
  const cliproxy = cliproxyVals.length ? summarize(cliproxyVals) : null
  const gemini = geminiVals.length ? summarize(geminiVals) : null
  const cliproxySuggestion = cliproxy ? Math.ceil((cliproxy.p99 * 1.3) / 1000) * 1000 : null
  const geminiSuggestion = gemini ? Math.ceil((gemini.p99 * 1.3) / 1000) * 1000 : null
  console.log("\nSuggested Timeout Env (P99 * 1.3 buffer)")
  if (cliproxySuggestion) console.log(`SCAN_TIMEOUT_CLIPROXY_MS=${cliproxySuggestion}`)
  if (geminiSuggestion) console.log(`SCAN_TIMEOUT_GEMINI_MS=${geminiSuggestion}`)
}
