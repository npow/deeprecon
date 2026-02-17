import type { DDReport, Competitor, GapAnalysis } from "./types"

export interface LucrativenessBreakdown {
  factor: string
  score: number
  max: number
  detail: string
}

export interface LucrativenessScore {
  total: number
  tier: "low" | "medium" | "high" | "very_high"
  breakdown: LucrativenessBreakdown[]
  verdict: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseDollarAmount(text: string): number {
  if (!text) return 0
  const raw = String(text).trim().replace(/,/g, "")
  const match = raw.match(/\$?\s*([0-9]*\.?[0-9]+)\s*([kmb])?/i)
  if (!match) return 0
  const value = Number(match[1] || 0)
  const unit = (match[2] || "").toLowerCase()
  if (unit === "b") return value * 1_000_000_000
  if (unit === "m") return value * 1_000_000
  if (unit === "k") return value * 1_000
  return value
}

function scoreMarketValue(ddReport: DDReport): LucrativenessBreakdown {
  const tam = parseDollarAmount(ddReport?.tamSamSom?.tam?.value || "")
  if (tam >= 10_000_000_000) return { factor: "Market Value", score: 25, max: 25, detail: "TAM > $10B" }
  if (tam >= 1_000_000_000) return { factor: "Market Value", score: 20, max: 25, detail: "TAM $1B-$10B" }
  if (tam >= 250_000_000) return { factor: "Market Value", score: 14, max: 25, detail: "TAM $250M-$1B" }
  if (tam > 0) return { factor: "Market Value", score: 8, max: 25, detail: "TAM < $250M" }
  return { factor: "Market Value", score: 10, max: 25, detail: "TAM unknown" }
}

function scorePricingPower(ddReport: DDReport): LucrativenessBreakdown {
  const model = String(ddReport?.businessModel?.recommendedModel || "").toLowerCase()
  const pricing = String(ddReport?.businessModel?.pricingStrategy || "").toLowerCase()
  const text = `${model} ${pricing}`
  let score = 8
  if (/enterprise|usage|seat|annual|contract/.test(text)) score = 13
  if (/transaction|take.?rate|performance|outcome/.test(text)) score = Math.max(score, 14)
  if (/freemium|ad[- ]supported/.test(text)) score = Math.min(score, 7)
  return { factor: "Pricing Power", score, max: 15, detail: ddReport?.businessModel?.recommendedModel || "model unknown" }
}

function scoreUrgency(ddReport: DDReport): LucrativenessBreakdown {
  const severity = Number(ddReport?.problemSeverity?.score || 0)
  const frequency = String(ddReport?.problemSeverity?.frequency || "").toLowerCase()
  let score = Math.round((clamp(severity, 1, 10) / 10) * 10)
  if (frequency.includes("daily") || frequency.includes("weekly")) score += 3
  if (frequency.includes("monthly")) score += 1
  score = clamp(score, 1, 15)
  return { factor: "Buyer Urgency", score, max: 15, detail: `${severity || "?"}/10 severity, ${frequency || "unknown"} frequency` }
}

function scoreSalesFriction(ddReport: DDReport, competitors: Competitor[]): LucrativenessBreakdown {
  const channels = Array.isArray(ddReport?.goToMarket?.channels) ? ddReport.goToMarket.channels : []
  const directCount = channels.filter((c) => /direct|outbound|partner|reseller|channel/.test(String(c.channel || "").toLowerCase())).length
  const highFundingDirect = competitors.filter((c) => (c.totalFundingUsd || 0) > 100_000_000 && (c.similarityScore || 0) >= 70).length
  let score = 10
  if (directCount >= 1) score -= 2
  if (directCount >= 2) score -= 2
  if (highFundingDirect >= 2) score -= 2
  score = clamp(score, 3, 12)
  return { factor: "Sales Friction", score, max: 12, detail: `${directCount} direct-heavy channels, ${highFundingDirect} well-funded direct rivals` }
}

function scoreMarginPotential(ddReport: DDReport): LucrativenessBreakdown {
  const unit = String(ddReport?.businessModel?.unitEconomics || "").toLowerCase()
  let score = 10
  if (/strong|healthy|positive|high margin/.test(unit)) score = 13
  if (/break-even|neutral/.test(unit)) score = 9
  if (/negative|unproven|unclear/.test(unit)) score = 6
  return { factor: "Margin Potential", score, max: 13, detail: ddReport?.businessModel?.unitEconomics || "unit economics unknown" }
}

function scoreExecutionWindow(gapAnalysis: GapAnalysis | null): LucrativenessBreakdown {
  const opportunities = Array.isArray(gapAnalysis?.whiteSpaceOpportunities) ? gapAnalysis!.whiteSpaceOpportunities : []
  const highImpact = opportunities.filter((o) => o.potentialImpact === "high").length
  const mediumImpact = opportunities.filter((o) => o.potentialImpact === "medium").length
  const score = clamp(3 + highImpact * 2 + mediumImpact, 2, 10)
  return { factor: "Execution Window", score, max: 10, detail: `${highImpact} high-impact and ${mediumImpact} medium-impact whitespace opportunities` }
}

function tierFromTotal(total: number): LucrativenessScore["tier"] {
  if (total >= 80) return "very_high"
  if (total >= 65) return "high"
  if (total >= 45) return "medium"
  return "low"
}

function verdictForTier(tier: LucrativenessScore["tier"]): string {
  if (tier === "very_high") return "Very strong economic upside if execution risk is controlled."
  if (tier === "high") return "Strong upside potential with solid monetization characteristics."
  if (tier === "medium") return "Moderate upside. You may need sharper pricing or a higher-value wedge."
  return "Lower upside profile. Consider a different ICP, pricing model, or monetization path."
}

export function computeLucrativenessScore(
  ddReport: DDReport,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis | null
): LucrativenessScore {
  const breakdown = [
    scoreMarketValue(ddReport),
    scorePricingPower(ddReport),
    scoreUrgency(ddReport),
    scoreSalesFriction(ddReport, competitors),
    scoreMarginPotential(ddReport),
    scoreExecutionWindow(gapAnalysis),
  ]
  const total = clamp(Math.round(breakdown.reduce((sum, item) => sum + item.score, 0)), 0, 100)
  const tier = tierFromTotal(total)
  return {
    total,
    tier,
    breakdown,
    verdict: verdictForTier(tier),
  }
}
