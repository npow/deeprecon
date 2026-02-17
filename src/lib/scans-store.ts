import fs from "fs"
import path from "path"
import type { SavedScan, SavedScanSummary } from "./types"
import { computeReadinessScore } from "./readiness-score"
import { computeLucrativenessScore } from "./lucrativeness-score"
import { applyLogosToCompetitors } from "./company-logo"

const SCANS_DIR = path.join(process.cwd(), "data", "scans")

function ensureDir() {
  if (!fs.existsSync(SCANS_DIR)) {
    fs.mkdirSync(SCANS_DIR, { recursive: true })
  }
}

export function saveScan(scan: SavedScan): void {
  ensureDir()
  const filePath = path.join(SCANS_DIR, `${scan.id}.json`)
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(
    tmpPath,
    JSON.stringify({ ...scan, competitors: applyLogosToCompetitors(scan.competitors) }, null, 2),
  )
  fs.renameSync(tmpPath, filePath)
}

export function loadScan(id: string): SavedScan | null {
  const filePath = path.join(SCANS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

export function listScans(): SavedScanSummary[] {
  ensureDir()
  const files = fs.readdirSync(SCANS_DIR).filter((f) => f.endsWith(".json"))
  const summaries: SavedScanSummary[] = []

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SCANS_DIR, file), "utf-8")) as SavedScan
      const recomputed = raw.ddReport
        ? computeReadinessScore(
            raw.ddReport,
            raw.crowdednessIndex,
            raw.competitors,
            raw.gapAnalysis ?? null,
            raw.ideaText,
          )
        : raw.readinessScore
      const recomputedLucrativeness = raw.ddReport
        ? computeLucrativenessScore(
            raw.ddReport,
            raw.competitors,
            raw.gapAnalysis ?? null
          )
        : raw.lucrativenessScore
      const uniquenessScore = (recomputed?.breakdown || []).find((item) => item.factor === "Uniqueness")?.score
      summaries.push({
        id: raw.id,
        ideaText: raw.ideaText,
        vertical: raw.intent?.vertical ?? "",
        category: raw.intent?.category ?? "",
        score: recomputed?.total ?? 0,
        grade: recomputed?.grade ?? "?",
        uniquenessScore,
        lucrativenessScore: recomputedLucrativeness?.total,
        lucrativenessTier: recomputedLucrativeness?.tier,
        crowdednessIndex: raw.crowdednessIndex ?? "",
        parentScanId: raw.parentScanId,
        rootScanId: raw.rootScanId,
        remixType: raw.remixType,
        remixLabel: raw.remixLabel,
        remixDepth: raw.remixDepth,
        createdAt: raw.createdAt,
      })
    } catch {
      // skip corrupt files
    }
  }

  return summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}
