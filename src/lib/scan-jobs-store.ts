import fs from "fs"
import path from "path"

export type ScanJobStatus = "pending" | "running" | "completed" | "failed"

export interface SavedScanJob {
  id: string
  status: ScanJobStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  currentStage?: string
  ideaText: string
  settings?: unknown
  remix?: unknown
  queuePosition?: number
  scanId?: string
  error?: string
}

export interface ScanJobsHealthSummary {
  total: number
  counts: {
    pending: number
    running: number
    completed: number
    failed: number
  }
  staleThresholdMinutes: number
  staleRunningJobs: Array<{
    id: string
    minutesSinceUpdate: number
    stage: string
  }>
}

const SCAN_JOBS_DIR = path.join(process.cwd(), "data", "scan-jobs")

function ensureDir() {
  if (!fs.existsSync(SCAN_JOBS_DIR)) {
    fs.mkdirSync(SCAN_JOBS_DIR, { recursive: true })
  }
}

function pathFor(id: string): string {
  return path.join(SCAN_JOBS_DIR, `${id}.json`)
}

export function listScanJobs(): SavedScanJob[] {
  ensureDir()
  const files = fs.readdirSync(SCAN_JOBS_DIR).filter((f) => f.endsWith(".json"))
  const out: SavedScanJob[] = []
  for (const file of files) {
    try {
      const row = JSON.parse(fs.readFileSync(path.join(SCAN_JOBS_DIR, file), "utf-8")) as SavedScanJob
      out.push(row)
    } catch {
      // skip corrupt files
    }
  }
  return out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function saveScanJob(job: SavedScanJob): void {
  ensureDir()
  const filePath = pathFor(job.id)
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(job, null, 2))
  fs.renameSync(tmpPath, filePath)
}

export function loadScanJob(id: string): SavedScanJob | null {
  const filePath = pathFor(id)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SavedScanJob
  } catch {
    return null
  }
}

export function updateScanJob(id: string, patch: Partial<SavedScanJob>): SavedScanJob | null {
  const prev = loadScanJob(id)
  if (!prev) return null
  const next: SavedScanJob = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  saveScanJob(next)
  return next
}

export function summarizeScanJobsHealth(staleMinutes: number = 20): ScanJobsHealthSummary {
  const jobs = listScanJobs()
  const now = Date.now()
  const counts = { pending: 0, running: 0, completed: 0, failed: 0 }
  const staleRunningJobs: ScanJobsHealthSummary["staleRunningJobs"] = []

  for (const job of jobs) {
    if (job.status in counts) counts[job.status as keyof typeof counts] += 1
    if (job.status !== "running") continue
    const updatedTs = new Date(job.updatedAt || job.createdAt).getTime()
    const minutesSinceUpdate = Math.round((now - updatedTs) / 60000)
    if (minutesSinceUpdate >= staleMinutes) {
      staleRunningJobs.push({
        id: job.id,
        minutesSinceUpdate,
        stage: job.currentStage || "unknown",
      })
    }
  }

  return {
    total: jobs.length,
    counts,
    staleThresholdMinutes: staleMinutes,
    staleRunningJobs,
  }
}

export function reapStaleRunningJobs(staleMinutes: number = 20): number {
  const jobs = listScanJobs()
  const now = Date.now()
  let reaped = 0

  for (const job of jobs) {
    if (job.status !== "running") continue
    const updatedTs = new Date(job.updatedAt || job.createdAt).getTime()
    const minutesSinceUpdate = (now - updatedTs) / 60000
    if (minutesSinceUpdate < staleMinutes) continue
    reaped += 1
    updateScanJob(job.id, {
      status: "failed",
      error: `Stale running job reaped after ${Math.round(minutesSinceUpdate)} minutes without heartbeat`,
      finishedAt: new Date().toISOString(),
      currentStage: `${job.currentStage || "unknown"} (reaped)`,
    })
  }

  return reaped
}
