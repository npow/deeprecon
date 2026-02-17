import { ensureDbSchema, getPool } from "./db"

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

export async function listScanJobs(): Promise<SavedScanJob[]> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<{ payload: SavedScanJob }>(
    "select payload from scan_jobs order by updated_at desc",
  )
  return res.rows.map((r) => r.payload)
}

export async function saveScanJob(job: SavedScanJob): Promise<void> {
  await ensureDbSchema()
  const pool = getPool()
  await pool.query(
    `
    insert into scan_jobs (id, updated_at, payload)
    values ($1, $2::timestamptz, $3::jsonb)
    on conflict (id) do update
    set updated_at = excluded.updated_at,
        payload = excluded.payload
    `,
    [job.id, job.updatedAt, JSON.stringify(job)],
  )
}

export async function loadScanJob(id: string): Promise<SavedScanJob | null> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<{ payload: SavedScanJob }>(
    "select payload from scan_jobs where id = $1",
    [id],
  )
  if (res.rowCount && res.rows[0]) return res.rows[0].payload
  return null
}

export async function updateScanJob(id: string, patch: Partial<SavedScanJob>): Promise<SavedScanJob | null> {
  const prev = await loadScanJob(id)
  if (!prev) return null
  const next: SavedScanJob = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await saveScanJob(next)
  return next
}

export async function summarizeScanJobsHealth(staleMinutes: number = 20): Promise<ScanJobsHealthSummary> {
  const jobs = await listScanJobs()
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

export async function reapStaleRunningJobs(staleMinutes: number = 20): Promise<number> {
  const jobs = await listScanJobs()
  const now = Date.now()
  let reaped = 0

  for (const job of jobs) {
    if (job.status !== "running") continue
    const updatedTs = new Date(job.updatedAt || job.createdAt).getTime()
    const minutesSinceUpdate = (now - updatedTs) / 60000
    if (minutesSinceUpdate < staleMinutes) continue
    reaped += 1
    await updateScanJob(job.id, {
      status: "failed",
      error: `Stale running job reaped after ${Math.round(minutesSinceUpdate)} minutes without heartbeat`,
      finishedAt: new Date().toISOString(),
      currentStage: `${job.currentStage || "unknown"} (reaped)`,
    })
  }

  return reaped
}
