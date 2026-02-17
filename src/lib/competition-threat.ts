import type { Competitor } from "./types"

export type ThreatTier = "direct" | "adjacent" | "low"

export interface CompetitorThreat {
  tier: ThreatTier
  weight: number
  score: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function competitorThreat(competitor: Competitor): CompetitorThreat {
  const similarity = competitor.similarityScore ?? 0
  let score = similarity

  if (competitor.websiteStatus === "verified") score += 8
  else if (competitor.websiteStatus === "unknown") score -= 4
  else score -= 10

  if (competitor.confidenceLevel === "multi_confirmed") score += 8
  else if (competitor.confidenceLevel === "web_verified") score += 5
  else if (competitor.confidenceLevel === "ai_inferred") score -= 6

  score = clamp(Math.round(score), 0, 100)

  if (score >= 72) return { tier: "direct", weight: 1, score }
  if (score >= 45) return { tier: "adjacent", weight: 0.45, score }
  return { tier: "low", weight: 0.15, score }
}

export function summarizeThreats(competitors: Competitor[]): {
  direct: number
  adjacent: number
  low: number
  weightedSimilarity: number
} {
  let direct = 0
  let adjacent = 0
  let low = 0
  let weightedSum = 0
  let weightTotal = 0

  for (const c of competitors) {
    const t = competitorThreat(c)
    if (t.tier === "direct") direct += 1
    else if (t.tier === "adjacent") adjacent += 1
    else low += 1

    // Use threat-adjusted score, not raw similarity, so low-confidence or dead/mismatched
    // competitors contribute less to perceived overlap.
    weightedSum += t.score * t.weight
    weightTotal += t.weight
  }

  return {
    direct,
    adjacent,
    low,
    weightedSimilarity: weightTotal > 0 ? weightedSum / weightTotal : 0,
  }
}
