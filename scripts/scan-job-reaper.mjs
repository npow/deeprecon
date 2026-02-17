#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const jobsDir = path.join(process.cwd(), 'data', 'scan-jobs')
const staleMinutes = Number(process.env.SCAN_JOB_STALE_MINUTES || 20)
const dryRun = process.env.DRY_RUN === '1'
const now = Date.now()

if (!fs.existsSync(jobsDir)) {
  console.log('No scan jobs directory found')
  process.exit(0)
}

const files = fs.readdirSync(jobsDir).filter((f) => f.endsWith('.json'))
let reaped = 0

for (const file of files) {
  const full = path.join(jobsDir, file)
  let job
  try {
    job = JSON.parse(fs.readFileSync(full, 'utf8'))
  } catch {
    continue
  }
  if (job.status !== 'running') continue

  const updated = new Date(job.updatedAt || job.createdAt || 0).getTime()
  const mins = (now - updated) / 60000
  if (mins < staleMinutes) continue

  reaped += 1
  if (dryRun) {
    console.log(`DRY_RUN stale job ${job.id} (${Math.round(mins)}m) stage=${job.currentStage || 'unknown'}`)
    continue
  }

  const next = {
    ...job,
    status: 'failed',
    error: `Stale running job reaped after ${Math.round(mins)} minutes without heartbeat`,
    finishedAt: new Date().toISOString(),
    currentStage: `${job.currentStage || 'unknown'} (reaped)`,
    updatedAt: new Date().toISOString(),
  }
  const tmp = `${full}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, full)
  console.log(`reaped ${job.id} (${Math.round(mins)}m)`)
}

console.log(`done: scanned=${files.length} reaped=${reaped} staleMinutes=${staleMinutes} dryRun=${dryRun}`)
