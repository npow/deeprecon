import type { Competitor, DDReport, GapAnalysis } from "./types"
import { safeArray, fundingConfidence } from "./utils"

export interface EvidenceConfidence {
  score: number
  competitorConfidence: number
  websiteVerification: number
  fundingConfidence: number
  reportCompleteness: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function computeEvidenceConfidence(
  competitors: Competitor[],
  ddReport?: DDReport | null,
  gapAnalysis?: GapAnalysis | null,
): EvidenceConfidence {
  const total = competitors.length
  const websiteVerified = competitors.filter((c) => c.websiteStatus === "verified").length
  const websiteVerification = total > 0 ? websiteVerified / total : 0

  const competitorConfidence = total > 0
    ? competitors.reduce((sum, c) => {
      if (c.confidenceLevel === "multi_confirmed") return sum + 1
      if (c.confidenceLevel === "web_verified") return sum + 0.85
      return sum + 0.4
    }, 0) / total
    : 0

  const funded = competitors.filter((c) => (c.totalFundingUsd ?? 0) > 0)
  const fundingConfidenceScore = funded.length > 0
    ? funded.reduce((sum, c) => {
      const fc = fundingConfidence(c)
      if (fc === "high") return sum + 1
      if (fc === "medium") return sum + 0.7
      if (fc === "low") return sum + 0.4
      return sum + 0.5
    }, 0) / funded.length
    : 0.5

  const ddSections = ddReport
    ? [
      !!ddReport.idealCustomerProfile,
      !!ddReport.problemSeverity,
      !!ddReport.wedgeStrategy,
      !!ddReport.tamSamSom,
      !!ddReport.businessModel,
      !!ddReport.defensibility,
      !!ddReport.goToMarket,
      safeArray(ddReport.risksMitigations).length > 0,
    ]
    : []
  const ddCoverage = ddSections.length > 0
    ? ddSections.filter(Boolean).length / ddSections.length
    : 0

  const gapCoverage = gapAnalysis
    ? (
      (safeArray(gapAnalysis.whiteSpaceOpportunities).length > 0 ? 1 : 0) +
      (safeArray(gapAnalysis.commonComplaints).length > 0 ? 1 : 0) +
      (safeArray(gapAnalysis.unservedSegments).length > 0 ? 1 : 0)
    ) / 3
    : 0

  const reportCompleteness = ddReport || gapAnalysis
    ? (ddCoverage * 0.7) + (gapCoverage * 0.3)
    : 0

  const weighted = (
    competitorConfidence * 0.4 +
    websiteVerification * 0.25 +
    fundingConfidenceScore * 0.15 +
    reportCompleteness * 0.2
  ) * 100

  return {
    score: clamp(Math.round(weighted), 0, 100),
    competitorConfidence: Math.round(competitorConfidence * 100),
    websiteVerification: Math.round(websiteVerification * 100),
    fundingConfidence: Math.round(fundingConfidenceScore * 100),
    reportCompleteness: Math.round(reportCompleteness * 100),
  }
}
