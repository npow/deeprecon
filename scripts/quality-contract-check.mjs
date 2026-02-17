#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const requiredFiles = [
  'docs/agent-contracts/OWNERSHIP.md',
  'docs/agent-contracts/PARALLEL_EXECUTION.md',
  'docs/agent-contracts/TASKBOARD.md',
  'benchmarks/adversarial/core-cases.json',
  'scripts/lane-start.sh',
  'scripts/lane-stop.sh',
  'scripts/lane-status.sh',
]

let failures = 0
for (const rel of requiredFiles) {
  const full = path.join(process.cwd(), rel)
  if (!fs.existsSync(full)) {
    console.error(`MISSING: ${rel}`)
    failures += 1
  }
}

try {
  const benchmarkPath = path.join(process.cwd(), 'benchmarks/adversarial/core-cases.json')
  const rows = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
  if (!Array.isArray(rows) || rows.length < 4) {
    console.error('INVALID: core-cases.json must have at least 4 cases')
    failures += 1
  }
  for (const row of rows) {
    if (!row?.id || !row?.idea || !row?.expectation) {
      console.error(`INVALID CASE: ${JSON.stringify(row)}`)
      failures += 1
    }
  }
} catch (err) {
  console.error('FAILED TO PARSE benchmark JSON:', err instanceof Error ? err.message : String(err))
  failures += 1
}

if (failures > 0) {
  console.error(`quality-contract-check failed (${failures} issue(s))`)
  process.exit(2)
}

console.log('quality-contract-check passed')
