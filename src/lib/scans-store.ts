import type { SavedScan, SavedScanSummary } from "./types"
import { computeReadinessScore } from "./readiness-score"
import { computeLucrativenessScore } from "./lucrativeness-score"
import { applyLogosToCompetitors } from "./company-logo"
import { ensureDbSchema, getPool } from "./db"

export async function saveScan(scan: SavedScan): Promise<void> {
  const normalized = { ...scan, competitors: applyLogosToCompetitors(scan.competitors) }
  await ensureDbSchema()
  const pool = getPool()
  await pool.query(
    `
    insert into scans (id, created_at, payload)
    values ($1, $2::timestamptz, $3::jsonb)
    on conflict (id) do update
    set created_at = excluded.created_at,
        payload = excluded.payload
    `,
    [scan.id, scan.createdAt, JSON.stringify(normalized)],
  )
}

export async function loadScan(id: string): Promise<SavedScan | null> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<{ payload: SavedScan }>(
    "select payload from scans where id = $1",
    [id],
  )
  if (res.rowCount && res.rows[0]) return res.rows[0].payload
  return null
}

export async function listScans(): Promise<SavedScanSummary[]> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<{ payload: SavedScan }>(
    "select payload from scans order by created_at desc",
  )
  const summaries: SavedScanSummary[] = []
  for (const row of res.rows) {
    const raw = row.payload
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
          raw.gapAnalysis ?? null,
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
  }
  return summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}
