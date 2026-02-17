#!/usr/bin/env node
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const outDir = path.join(process.cwd(), 'data', 'optimizer')
fs.mkdirSync(outDir, { recursive: true })
const reportPath = path.join(outDir, `run_${Date.now()}.json`)

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: process.env })
    p.on('close', (code) => resolve(code ?? 1))
  })
}

async function main() {
  const startedAt = new Date().toISOString()
  const steps = [
    { name: 'quality_contracts', cmd: 'npm', args: ['run', 'quality:contracts'] },
    { name: 'policy_tests', cmd: 'npm', args: ['run', 'test:policy'] },
    { name: 'full_tests', cmd: 'npm', args: ['test'] },
    { name: 'build', cmd: 'npm', args: ['run', 'build'] },
    { name: 'scan_job_health', cmd: 'npm', args: ['run', 'scan-jobs:health'] },
  ]

  const results = []
  let ok = true
  for (const step of steps) {
    const code = await run(step.cmd, step.args)
    results.push({ step: step.name, code })
    if (code !== 0) {
      ok = false
      break
    }
  }

  const endedAt = new Date().toISOString()
  const report = { startedAt, endedAt, ok, results }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`optimizer report: ${reportPath}`)

  if (!ok) process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
