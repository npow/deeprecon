import fs from "fs"
import path from "path"

export type ScanJobStatus = "pending" | "running" | "completed" | "failed"

export interface SavedScanJob {
  id: string
  status: ScanJobStatus
  createdAt: string
  updatedAt: string
  ideaText: string
  settings?: unknown
  remix?: unknown
  queuePosition?: number
  scanId?: string
  error?: string
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
