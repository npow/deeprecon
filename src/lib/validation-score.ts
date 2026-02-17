import type { Competitor, DDReport, GapAnalysis } from "./types"
import { computeEvidenceConfidence } from "./evidence-confidence"
import { safeArray } from "./utils"

export interface ValidationSignals {
  outreachCount?: number
  responseCount?: number
  discoveryCalls?: number
  pilots?: number
  prepayments?: number
}

export interface ValidationBreakdown {
  factor: string
  score: number
  max: number
  detail: string
}

export interface ValidationScore {
  total: number
  tier: "low" | "medium" | "high" | "very_high"
  hasLiveSignals: boolean
  gate: {
    status: "pass" | "watch" | "fail"
    reasons: string[]
  }
  breakdown: ValidationBreakdown[]
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

function scoreDistributionAccess(ddReport: DDReport): ValidationBreakdown {
  const channels = safeArray(ddReport?.goToMarket?.channels)
  const firstMilestone = String(ddReport?.goToMarket?.firstMilestone || "").toLowerCase()
  const icpText = [
    String(ddReport?.idealCustomerProfile?.summary || ""),
    String(ddReport?.idealCustomerProfile?.demographics || ""),
    String(ddReport?.idealCustomerProfile?.behaviors || ""),
  ].join(" ").toLowerCase()

  const channelCount = channels.length
  const directCount = channels.filter((c) => /outbound|direct|partner|community|referral|seo|content|linkedin|email/.test(String(c.channel || "").toLowerCase())).length
  const lowCacCount = channels.filter((c) => /low|organic|free|\$0/.test(String(c.estimatedCac || "").toLowerCase())).length
  const hasNarrowIcp = /(for\s+[a-z0-9 -]{3,40})|(\b(sales|ops|finance|legal|hr|recruiting|revops|procurement)\b)/.test(icpText)
  const milestoneHasVolume = /\b(20|30|50|100)\b/.test(firstMilestone)

  let score = 3
  score += Math.min(channelCount, 4) * 2
  score += Math.min(directCount, 2)
  score += Math.min(lowCacCount, 2)
  if (hasNarrowIcp) score += 1
  if (milestoneHasVolume) score += 1
  score = clamp(score, 2, 15)

  return {
    factor: "Distribution Access",
    score,
    max: 15,
    detail: `${channelCount} channels, ${lowCacCount} low-CAC, ${hasNarrowIcp ? "narrow ICP" : "broad ICP"}`,
  }
}

function scoreWorkflowPain(ddReport: DDReport): ValidationBreakdown {
  const severity = Number(ddReport?.problemSeverity?.score || 0)
  const frequency = String(ddReport?.problemSeverity?.frequency || "").toLowerCase()
  const alternatives = String(ddReport?.problemSeverity?.alternatives || "").toLowerCase()
  const evidence = String(ddReport?.problemSeverity?.evidenceSummary || "").toLowerCase()

  let score = Math.round((clamp(severity, 1, 10) / 10) * 9)
  if (frequency.includes("daily") || frequency.includes("weekly")) score += 3
  else if (frequency.includes("monthly")) score += 1
  if (/manual|spreadsheet|email|copy.?paste|consultant|agency/.test(alternatives)) score += 2
  if (/hour|cost|\$|compliance|risk|sla|error|churn|rework/.test(evidence)) score += 2
  score = clamp(score, 1, 15)

  return {
    factor: "Workflow Pain / Cost",
    score,
    max: 15,
    detail: `${severity || "?"}/10 severity, ${frequency || "unknown"} frequency`,
  }
}

function scoreBuyerBudgetFit(ddReport: DDReport): ValidationBreakdown {
  const wtp = String(ddReport?.idealCustomerProfile?.willingness_to_pay || "")
  const wtpValue = parseDollarAmount(wtp)
  const model = String(ddReport?.businessModel?.recommendedModel || "").toLowerCase()
  const pricing = String(ddReport?.businessModel?.pricingStrategy || "").toLowerCase()
  const icpSummary = String(ddReport?.idealCustomerProfile?.summary || "").toLowerCase()

  let score = 2
  if (wtpValue >= 1_000) score += 6
  else if (wtpValue >= 200) score += 5
  else if (wtpValue >= 50) score += 4
  else if (wtpValue > 0) score += 3

  const pricingText = `${model} ${pricing}`
  if (/enterprise|annual|contract|seat|usage|take.?rate|transaction/.test(pricingText)) score += 3
  if (/\b(cfo|cio|cto|vp|director|head of|owner|procurement|it admin|operations)\b/.test(icpSummary)) score += 2
  score = clamp(score, 1, 12)

  return {
    factor: "Buyer Authority + Budget",
    score,
    max: 12,
    detail: `${wtp || "WTP unknown"}; ${ddReport?.businessModel?.recommendedModel || "model unknown"}`,
  }
}

function scoreTimeToValue(ddReport: DDReport): ValidationBreakdown {
  const firstMilestone = String(ddReport?.goToMarket?.firstMilestone || "").toLowerCase()
  const wedge = String(ddReport?.wedgeStrategy?.wedge || "").toLowerCase()
  const firstCustomers = String(ddReport?.wedgeStrategy?.firstCustomers || "").toLowerCase()

  let score = 4
  if (/day|week|7|14|30/.test(firstMilestone)) score += 3
  if (/pilot|trial|onboard|deploy|integration/.test(firstMilestone)) score += 2
  if (/single workflow|one workflow|narrow|specific/.test(wedge)) score += 1
  if (firstCustomers.length >= 30) score += 1
  score = clamp(score, 2, 10)

  return {
    factor: "Time-to-Value",
    score,
    max: 10,
    detail: ddReport?.goToMarket?.firstMilestone || "first milestone not specified",
  }
}

function scoreEvidenceQuality(competitors: Competitor[], ddReport: DDReport, gapAnalysis: GapAnalysis | null): ValidationBreakdown {
  const evidence = computeEvidenceConfidence(competitors, ddReport, gapAnalysis)
  const score = clamp(Math.round(evidence.score / 10), 1, 10)
  return {
    factor: "Evidence Quality",
    score,
    max: 10,
    detail: `${evidence.score}/100 confidence (${evidence.competitorConfidence}% competitor, ${evidence.reportCompleteness}% report completeness)`,
  }
}

function scoreValidationTraction(signals?: ValidationSignals): ValidationBreakdown & { hasLiveSignals: boolean } {
  const outreachCount = Number(signals?.outreachCount || 0)
  const responseCount = Number(signals?.responseCount || 0)
  const discoveryCalls = Number(signals?.discoveryCalls || 0)
  const pilots = Number(signals?.pilots || 0)
  const prepayments = Number(signals?.prepayments || 0)
  const hasLiveSignals = outreachCount > 0 || responseCount > 0 || discoveryCalls > 0 || pilots > 0 || prepayments > 0

  if (!hasLiveSignals) {
    return {
      factor: "Validation Traction",
      score: 6,
      max: 20,
      detail: "No live outreach or pre-sell metrics ingested yet",
      hasLiveSignals: false,
    }
  }

  const responseRate = outreachCount > 0 ? responseCount / outreachCount : 0
  let score = 4
  if (outreachCount >= 50) score += 3
  else if (outreachCount >= 20) score += 2
  else if (outreachCount >= 10) score += 1

  if (responseRate >= 0.15) score += 5
  else if (responseRate >= 0.08) score += 3
  else if (responseRate > 0) score += 1

  score += Math.min(discoveryCalls, 4)
  score += Math.min(pilots * 2, 4)
  score += Math.min(prepayments * 3, 5)
  score = clamp(score, 1, 20)

  return {
    factor: "Validation Traction",
    score,
    max: 20,
    detail: `${outreachCount} outreach, ${responseCount} responses, ${discoveryCalls} calls, ${pilots} pilots, ${prepayments} prepay`,
    hasLiveSignals: true,
  }
}

function tierFromTotal(total: number): ValidationScore["tier"] {
  if (total >= 80) return "very_high"
  if (total >= 65) return "high"
  if (total >= 45) return "medium"
  return "low"
}

function verdictForTier(tier: ValidationScore["tier"], gate: ValidationScore["gate"]): string {
  const base = tier === "very_high"
    ? "Strong validation profile with credible near-term demand signal."
    : tier === "high"
      ? "Promising validation profile; continue demand tests before heavier build-out."
      : tier === "medium"
        ? "Partial validation. Tighten targeting and demand proof."
        : "Weak validation evidence. Run demand experiments before committing."
  if (gate.status === "pass") return base
  if (gate.status === "watch") return `${base} Watch-outs: ${gate.reasons.join(" ")}`
  return `${base} Blockers: ${gate.reasons.join(" ")}`
}

export function computeValidationScore(
  ddReport: DDReport,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis | null,
  signals?: ValidationSignals,
): ValidationScore {
  const distribution = scoreDistributionAccess(ddReport)
  const workflowPain = scoreWorkflowPain(ddReport)
  const buyerBudget = scoreBuyerBudgetFit(ddReport)
  const timeToValue = scoreTimeToValue(ddReport)
  const evidence = scoreEvidenceQuality(competitors, ddReport, gapAnalysis)
  const traction = scoreValidationTraction(signals)

  const breakdown: ValidationBreakdown[] = [
    distribution,
    workflowPain,
    buyerBudget,
    timeToValue,
    evidence,
    traction,
  ]
  const total = clamp(Math.round(breakdown.reduce((sum, item) => sum + item.score, 0)), 0, 100)

  const reasons: string[] = []
  let status: ValidationScore["gate"]["status"] = "pass"
  if (distribution.score <= 4) reasons.push("Weak distribution access for first 100 customers.")
  if (buyerBudget.score <= 3) reasons.push("Low buyer authority/budget confidence.")
  if (evidence.score <= 3) reasons.push("Evidence quality is too weak for confident go/no-go.")
  if (reasons.length > 0) status = "fail"
  else if (!traction.hasLiveSignals) {
    status = "watch"
    reasons.push("No live outreach/pre-sell metrics yet.")
  }

  const gate = { status, reasons }
  const tier = tierFromTotal(total)
  return {
    total,
    tier,
    hasLiveSignals: traction.hasLiveSignals,
    gate,
    breakdown,
    verdict: verdictForTier(tier, gate),
  }
}
