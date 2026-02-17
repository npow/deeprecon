#!/usr/bin/env node
import { spawn } from 'child_process'

const maxHours = Number(process.env.ITERATION_MAX_HOURS || 2)
const intervalSec = Number(process.env.ITERATION_INTERVAL_SEC || 120)
const runLive = process.env.RUN_LIVE_SCANS === '1'
const start = Date.now()
let cycle = 0

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: process.env })
    p.on('close', (code) => resolve(code ?? 1))
  })
}

async function oneCycle() {
  cycle += 1
  console.log(`\n=== Iteration Cycle ${cycle} ===`)

  const checks = [
    ['npm', ['run', 'quality:contracts']],
    ['npm', ['run', 'test:policy']],
    ['npm', ['test']],
  ]

  for (const [cmd, args] of checks) {
    const code = await run(cmd, args)
    if (code !== 0) return code
  }

  if (runLive) {
    const code = await run('node', ['scripts/adversarial-scan-check.mjs'])
    if (code !== 0) return code
  }

  return 0
}

while ((Date.now() - start) < maxHours * 60 * 60 * 1000) {
  const code = await oneCycle()
  if (code !== 0) {
    console.error(`Iteration loop stopped: cycle ${cycle} failed with code ${code}`)
    process.exit(code)
  }

  const elapsedMin = Math.round((Date.now() - start) / 60000)
  console.log(`Cycle ${cycle} passed (elapsed ${elapsedMin} min). Sleeping ${intervalSec}s...`)
  await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000))
}

console.log(`Iteration loop completed ${cycle} cycles in ${maxHours} hour window.`)
