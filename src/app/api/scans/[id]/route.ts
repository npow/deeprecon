import { NextRequest, NextResponse } from "next/server"
import { loadScan } from "@/lib/scans-store"
import { computeReadinessScore } from "@/lib/readiness-score"
import { computeLucrativenessScore } from "@/lib/lucrativeness-score"
import { computeValidationScore } from "@/lib/validation-score"
import { computeOpportunityScore } from "@/lib/opportunity-score"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const scan = await loadScan(id)
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }
  // Recompute readiness from (possibly unfixed) ddReport — computeReadinessScore
  // now applies flattenNumericKeys internally as a safety net
  if (scan.ddReport) {
    scan.readinessScore = computeReadinessScore(
      scan.ddReport,
      scan.crowdednessIndex,
      scan.competitors,
      scan.gapAnalysis ?? null,
      scan.ideaText,
    )
    scan.lucrativenessScore = computeLucrativenessScore(
      scan.ddReport,
      scan.competitors,
      scan.gapAnalysis ?? null,
    )
    scan.validationScore = computeValidationScore(
      scan.ddReport,
      scan.competitors,
      scan.gapAnalysis ?? null,
    )
    scan.opportunityScore = computeOpportunityScore(
      scan.readinessScore.total,
      scan.lucrativenessScore.total,
      scan.validationScore,
    )
  }
  return NextResponse.json(scan)
}
