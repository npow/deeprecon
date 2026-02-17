#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const jobsDir = path.join(process.cwd(), 'data', 'scan-jobs')
const staleMinutes = Number(process.env.SCAN_JOB_STALE_MINUTES || 20)
const now = Date.now()

if (!fs.existsSync(jobsDir)) {
  console.log('No scan jobs directory found')
  process.exit(0)
}

const files = fs.readdirSync(jobsDir).filter((f) => f.endsWith('.json'))
const jobs = files.map((f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf8'))
  } catch {
    return null
  }
}).filter(Boolean)

const counts = { pending: 0, running: 0, completed: 0, failed: 0 }
const stale = []
for (const job of jobs) {
  const status = String(job.status || 'failed')
  if (status in counts) counts[status] += 1
  if (status === 'running') {
    const updated = new Date(job.updatedAt || job.createdAt || 0).getTime()
    const mins = (now - updated) / 60000
    if (mins >= staleMinutes) {
      stale.push({ id: job.id, mins: Math.round(mins), stage: job.currentStage || 'unknown' })
    }
  }
}

console.log(JSON.stringify({
  total: jobs.length,
  counts,
  staleThresholdMinutes: staleMinutes,
  staleRunningJobs: stale,
}, null, 2))
