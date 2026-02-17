import type { DDReport, Competitor, GapAnalysis } from "./types"
import { safeArray, parseFundingString, flattenNumericKeys } from "./utils"
import { summarizeThreats } from "./competition-threat"
export { generateNextSteps, generateUniquenessSuggestions } from "./readiness-actions"
export type { NextStep, UniquenessSuggestion } from "./readiness-actions"

// ─── Types ───

export interface ScoreBreakdown {
  factor: string
  score: number
  max: number
  detail: string
  explanation?: string
}

export interface ReadinessScore {
  total: number
  grade: string
  breakdown: ScoreBreakdown[]
  verdict: string
  cloneRisk?: {
    level: "low" | "medium" | "high"
    penalty: number
    reason: string
  }
}

// ─── Helpers ───

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/** Parse dollar text like "$50B", "$1.2B", "$500M" into a number */
function parseDollarAmount(text: string): number {
  if (!text) return 0
  return parseFundingString(text)
}

function likelihoodImpactValue(level: string): number {
  switch (level?.toLowerCase()) {
    case "high": return 3
    case "medium": return 2
    case "low": return 1
    default: return 2
  }
}

// ─── Factor scoring functions ───

function scoreProblemSeverity(ddReport: DDReport): ScoreBreakdown {
  const rawValue = ddReport.problemSeverity?.score
  const raw = typeof rawValue === "number" ? rawValue : Number(rawValue) || 5
  const score = clamp(Math.round(raw * 2), 0, 20)
  const explanation = raw >= 8
    ? `Problem severity rated ${raw}/10 — a hair-on-fire problem that users urgently need solved. Score doubled to ${score}/20.`
    : raw >= 5
      ? `Problem severity rated ${raw}/10 — a real pain point but not yet urgent for most users. Score doubled to ${score}/20.`
      : `Problem severity rated ${raw}/10 — the problem exists but may be a nice-to-have. Score doubled to ${score}/20.`
  return { factor: "Problem Severity", score, max: 20, detail: `${raw}/10 severity`, explanation }
}

function formatTam(tam: number): string {
  if (tam >= 1_000_000_000) return `$${(tam / 1_000_000_000).toFixed(1)}B`
  if (tam >= 1_000_000) return `$${(tam / 1_000_000).toFixed(0)}M`
  if (tam >= 1_000) return `$${(tam / 1_000).toFixed(0)}K`
  return `$${tam}`
}

function scoreMarketSize(ddReport: DDReport): ScoreBreakdown {
  const rawTam = ddReport.tamSamSom?.tam?.value
  const tamText = typeof rawTam === "string" ? rawTam : String(rawTam ?? "")
  const tam = parseDollarAmount(tamText)
  let score: number
  let explanation: string
  if (tam >= 10_000_000_000) {
    score = 15
    explanation = `TAM is ${formatTam(tam)} (>$10B) — a massive market opportunity. Full marks.`
  } else if (tam >= 1_000_000_000) {
    score = 12
    explanation = `TAM is ${formatTam(tam)} ($1B-$10B) — a large market with strong venture potential.`
  } else if (tam >= 100_000_000) {
    score = 8
    explanation = `TAM is ${formatTam(tam)} ($100M-$1B) — a meaningful market, though may limit venture-scale outcomes.`
  } else if (tam > 0) {
    score = 4
    explanation = `TAM is ${formatTam(tam)} (<$100M) — a small market. Consider expanding scope or targeting an adjacent larger market.`
  } else {
    score = 4
    explanation = `TAM could not be determined from the DD report. Provide clearer market sizing data for a better score.`
  }
  return { factor: "Market Size", score, max: 15, detail: tamText || "Unknown TAM", explanation }
}

function scoreDefensibility(ddReport: DDReport): ScoreBreakdown {
  const assessment = String(ddReport.defensibility?.strengthAssessment ?? "").toLowerCase()
  const moatType = ddReport.defensibility?.moatType || ""
  let score: number
  let explanation: string
  if (assessment.includes("strong")) {
    score = 15
    explanation = `Defensibility assessed as strong${moatType ? ` via ${moatType}` : ""}. Hard for competitors to replicate.`
  } else if (assessment.includes("moderate") || assessment.includes("medium")) {
    score = 10
    explanation = `Defensibility assessed as moderate${moatType ? ` via ${moatType}` : ""}. Some competitive protection, but moat needs strengthening.`
  } else if (assessment) {
    score = 5
    explanation = `Defensibility assessed as weak${moatType ? ` (${moatType})` : ""}. Limited barriers to entry — competitors can easily replicate.`
  } else {
    score = 5
    explanation = `Defensibility could not be assessed from the DD report. Consider clarifying your moat strategy.`
  }
  return { factor: "Defensibility", score, max: 15, detail: String(ddReport.defensibility?.strengthAssessment || "Unknown"), explanation }
}

function scoreCompetitiveGap(
  crowdednessIndex: string,
  gapAnalysis: GapAnalysis | null
): ScoreBreakdown {
  let base: number
  let crowdLabel: string
  switch (crowdednessIndex) {
    case "low": base = 15; crowdLabel = "low"; break
    case "moderate": base = 10; crowdLabel = "moderate"; break
    case "high": base = 5; crowdLabel = "high"; break
    case "red_ocean": base = 2; crowdLabel = "red ocean"; break
    default: base = 8; crowdLabel = crowdednessIndex
  }
  const whiteSpaceCount = safeArray(gapAnalysis?.whiteSpaceOpportunities).length
  const bonus = Math.min(whiteSpaceCount, 5)
  const score = clamp(base + bonus, 0, 15)
  const explanation = `Competition level is ${crowdLabel} (base ${base}/15). ${whiteSpaceCount} white-space opportunities identified, adding +${bonus} bonus. ${
    crowdednessIndex === "red_ocean"
      ? "This is a crowded market — differentiation is critical."
      : crowdednessIndex === "high"
        ? "Many competitors exist, but gaps create room for a focused entrant."
        : crowdednessIndex === "low"
          ? "Few competitors — strong first-mover opportunity if demand exists."
          : "Moderate competition leaves room for a well-differentiated player."
  }`
  return {
    factor: "Competitive Gap",
    score,
    max: 15,
    detail: `${crowdednessIndex} competition, ${whiteSpaceCount} white space opps`,
    explanation,
  }
}

function scoreGtmClarity(ddReport: DDReport): ScoreBreakdown {
  const channels = safeArray(ddReport.goToMarket?.channels)
  const channelCount = channels.length
  const channelNames = channels.map((c) => c.channel || "").filter(Boolean).join(", ")
  // Check for low-CAC channels
  const lowCacCount = channels.filter((c) => {
    const cac = (c.estimatedCac ?? "").toLowerCase()
    return cac.includes("low") || cac.includes("$0") || cac.includes("organic") || cac.includes("free")
  }).length
  let score: number
  let explanation: string
  if (channelCount >= 3 && lowCacCount >= 1) {
    score = 10
    explanation = `${channelCount} go-to-market channels identified (${channelNames}), including ${lowCacCount} low-CAC channel(s). Strong GTM plan with cost-efficient acquisition paths.`
  } else if (channelCount >= 2) {
    score = 7
    explanation = `${channelCount} go-to-market channels identified (${channelNames}). Decent variety, but no low-CAC channels found — consider adding organic/community channels.`
  } else if (channelCount === 1) {
    score = 4
    explanation = `Only 1 go-to-market channel identified (${channelNames}). Diversify your acquisition strategy to reduce risk.`
  } else {
    score = 4
    explanation = `No go-to-market channels could be extracted from the DD report. A clear GTM plan is critical for execution.`
  }
  return { factor: "GTM Clarity", score, max: 10, detail: `${channelCount} channels`, explanation }
}

function scoreBusinessModel(ddReport: DDReport): ScoreBreakdown {
  const rawUnitEcon = ddReport.businessModel?.unitEconomics
  const unitEcon = (typeof rawUnitEcon === "string" ? rawUnitEcon : JSON.stringify(rawUnitEcon ?? "")).toLowerCase()
  const model = ddReport.businessModel?.recommendedModel || ""
  let score: number
  let explanation: string
  if (unitEcon.includes("positive") || unitEcon.includes("strong") || unitEcon.includes("healthy")) {
    score = 10
    explanation = `Business model (${model || "identified"}) shows positive unit economics. LTV exceeds CAC with a clear path to profitability.`
  } else if (unitEcon.includes("break-even") || unitEcon.includes("breakeven") || unitEcon.includes("neutral")) {
    score = 6
    explanation = `Business model (${model || "identified"}) shows break-even unit economics. Viable, but margins need improvement for venture-scale returns.`
  } else if (model) {
    score = 3
    explanation = `Business model is ${model}, but unit economics are unclear or negative. Validate pricing and CAC assumptions with real customers.`
  } else {
    score = 3
    explanation = `No clear business model could be extracted from the DD report. Define your pricing and revenue model.`
  }
  return { factor: "Business Model", score, max: 10, detail: model || "Unknown", explanation }
}

function scoreRiskProfile(ddReport: DDReport): ScoreBreakdown {
  const risks = safeArray(ddReport.risksMitigations)
  if (risks.length === 0) {
    return {
      factor: "Risk Profile", score: 7, max: 10, detail: "No risks identified",
      explanation: "No risks were identified in the DD report. This gives a default 7/10 — not having risks flagged may mean the analysis lacked depth rather than that risks don't exist.",
    }
  }

  // avg(likelihood * impact) — higher means riskier, then invert
  const totalRiskScore = risks.reduce((sum, r) => {
    return sum + likelihoodImpactValue(r.likelihood) * likelihoodImpactValue(r.impact)
  }, 0)
  const avgRisk = totalRiskScore / risks.length // range 1-9
  // Invert: low avg risk → high score. Map 1→10, 9→1
  const score = clamp(Math.round(10 - (avgRisk - 1) * (9 / 8)), 1, 10)
  const highRisks = risks.filter((r) => r.likelihood === "high" && r.impact === "high").length
  const explanation = `${risks.length} risks assessed with average severity ${avgRisk.toFixed(1)}/9 (inverted to ${score}/10). ${
    highRisks > 0
      ? `${highRisks} high-likelihood/high-impact risk${highRisks > 1 ? "s" : ""} identified — these need strong mitigations.`
      : "No critical-severity risks found — manageable risk profile."
  }`
  return { factor: "Risk Profile", score, max: 10, detail: `${risks.length} risks assessed`, explanation }
}

function scoreUniqueness(ddReport: DDReport, competitors: Competitor[], gapAnalysis: GapAnalysis | null): ScoreBreakdown {
  const validComps = competitors.filter((c) => c.similarityScore != null && c.similarityScore > 0)
  if (validComps.length === 0) {
    return {
      factor: "Uniqueness", score: 3, max: 5, detail: "No similarity data",
      explanation: "No competitor similarity data available. Default score of 3/5 assigned.",
    }
  }
  const threat = summarizeThreats(validComps)
  const avgSimilarity = threat.weightedSimilarity
  const directRatio = threat.direct / validComps.length
  // Penalize overlap mostly when overlap comes from direct threats.
  // If most overlaps are adjacent/low-threat, reduce the similarity penalty.
  const effectiveSimilarity = avgSimilarity * (0.5 + 0.5 * directRatio)

  const whiteSpaceCount = safeArray(gapAnalysis?.whiteSpaceOpportunities).length
  const whiteSpaceBonus = whiteSpaceCount >= 8 ? 0.5 : whiteSpaceCount >= 4 ? 0.25 : 0
  const wedgeText = String(ddReport.wedgeStrategy?.wedge || "").trim()
  const blueOceanMoves = safeArray(ddReport.strategyCanvas?.blueOceanMoves)
  const firstCustomers = String(ddReport.wedgeStrategy?.firstCustomers || "").trim()
  const wedgeSpecificityBonus = wedgeText.length >= 80 ? 0.35 : wedgeText.length >= 40 ? 0.2 : 0
  const strategyCanvasBonus = blueOceanMoves.length >= 2 ? 0.2 : 0
  const launchSpecificityBonus = firstCustomers.length >= 60 ? 0.2 : 0
  const distinctionBonus = wedgeSpecificityBonus + strategyCanvasBonus + launchSpecificityBonus

  // Lower effective similarity = more unique. Use 0.5-point granularity so improvements are visible.
  // Map: 0% → 5, 100% → 0
  const rawScore = 5 * (1 - effectiveSimilarity / 100)
  const score = clamp(Math.round((rawScore + whiteSpaceBonus + distinctionBonus) * 2) / 2, 0, 5)
  const explanation = `${validComps.length} competitors: ${threat.direct} direct, ${threat.adjacent} adjacent, ${threat.low} low-threat. Threat-weighted similarity is ${Math.round(avgSimilarity)}%. ${
    effectiveSimilarity >= 80
      ? "Very high overlap — competitors are doing nearly the same thing. You need a strong differentiator."
      : effectiveSimilarity >= 60
        ? "Significant overlap with existing players. Focus on a niche or unique angle."
        : effectiveSimilarity >= 40
          ? "Moderate overlap — room to carve out a distinct position."
          : "Low overlap — your idea has meaningful differentiation from existing players."
  } Score uses direct-threat-adjusted overlap (${Math.round(effectiveSimilarity)}%)` +
    `${whiteSpaceBonus > 0 ? ` + white-space bonus (${whiteSpaceBonus.toFixed(2)})` : ""}` +
    `${distinctionBonus > 0 ? ` + distinction bonus (${distinctionBonus.toFixed(2)})` : ""}` +
    ` = ${score.toFixed(1)}/5.`
  return { factor: "Uniqueness", score, max: 5, detail: `${Math.round(avgSimilarity)}% threat-weighted similarity`, explanation }
}

// ─── Main scoring ───

function letterGrade(total: number): string {
  if (total >= 80) return "A"
  if (total >= 65) return "B"
  if (total >= 50) return "C"
  if (total >= 35) return "D"
  return "F"
}

function generateVerdict(total: number, grade: string): string {
  switch (grade) {
    case "A": return "Your idea has strong fundamentals across the board. Ready to build and validate."
    case "B": return "Promising idea with solid potential. A few areas to sharpen before going all-in."
    case "C": return "Decent foundation, but key areas need significant improvement before launch."
    case "D": return "Major gaps in multiple areas. Consider pivoting or addressing critical weaknesses first."
    case "F": return "Fundamental challenges across the board. A significant pivot is recommended."
    default: return "Analysis complete."
  }
}

function clonePenalty(
  uniquenessScore: number,
  crowdednessIndex: string,
  competitors: Competitor[],
): { penalty: number; gradeCap?: string; reason?: string; level?: "low" | "medium" | "high" } {
  const avgSim = avgSimilarity(competitors)
  const crowded = crowdednessIndex === "high" || crowdednessIndex === "red_ocean"

  if (uniquenessScore <= 1.5 && crowded && avgSim >= 70) {
    return { penalty: 18, gradeCap: "C", reason: "Very low uniqueness in a crowded market with high similarity to incumbents.", level: "high" }
  }
  if (uniquenessScore <= 1.5 && avgSim >= 75) {
    return { penalty: 14, gradeCap: "C", reason: "Very low uniqueness with very high competitor similarity.", level: "high" }
  }
  if (uniquenessScore <= 2 && crowded) {
    return { penalty: 14, gradeCap: "C", reason: "Low uniqueness in a crowded market.", level: "medium" }
  }
  if (uniquenessScore <= 2.5 && crowdednessIndex === "red_ocean") {
    return { penalty: 8, gradeCap: "B", reason: "Moderate uniqueness in a red-ocean category.", level: "low" }
  }
  return { penalty: 0 }
}

function avgSimilarity(competitors: Competitor[]): number {
  const valid = competitors.filter((c) => typeof c.similarityScore === "number")
  if (valid.length === 0) return 0
  return valid.reduce((sum, c) => sum + (c.similarityScore || 0), 0) / valid.length
}

function gradeRank(grade: string): number {
  if (grade === "A") return 5
  if (grade === "B") return 4
  if (grade === "C") return 3
  if (grade === "D") return 2
  return 1
}

function focusPenalty(ddReport: DDReport): { penalty: number; gradeCap?: string; reason?: string; level?: "low" | "medium" | "high" } {
  const text = [
    String(ddReport?.wedgeStrategy?.wedge || ""),
    String(ddReport?.idealCustomerProfile?.summary || ""),
    String(ddReport?.idealCustomerProfile?.demographics || ""),
    String(ddReport?.goToMarket?.firstMilestone || ""),
  ].join(" ").toLowerCase()

  const broadPattern = /(everyone|anyone|all industries|all businesses|all companies|all users|across all industries|general purpose|general-purpose|horizontal platform|for all)/i
  const narrowPattern = /(for\s+(hospitals?|clinics?|nonprofits?|municipal|cities|schools?|contractors?|brokers?|developers?|sales teams?|hr teams?|finance teams?|legal teams?|dental|logistics|freight|retail|manufacturing|property managers?))/i

  const wedgeLen = String(ddReport?.wedgeStrategy?.wedge || "").trim().length
  const hasBroad = broadPattern.test(text)
  const hasNarrow = narrowPattern.test(text)

  if (hasBroad && !hasNarrow) {
    return {
      penalty: 16,
      gradeCap: "C",
      reason: "Positioning is too broad ('for everyone') without a concrete initial ICP.",
      level: "high",
    }
  }
  if (wedgeLen > 0 && wedgeLen < 40) {
    return {
      penalty: 6,
      gradeCap: "B",
      reason: "Wedge is too generic and not specific enough for an initial go-to-market segment.",
      level: "medium",
    }
  }
  return { penalty: 0 }
}

function copycatPromptPenalty(ideaText?: string): { penalty: number; gradeCap?: string; reason?: string; level?: "low" | "medium" | "high" } {
  const text = String(ideaText || "").toLowerCase()
  if (!text) return { penalty: 0 }
  const high = /(exactly like|clone of|same as).{0,60}(but cheaper|cheaper|lower price)?/i.test(text)
  const medium = /(but cheaper|cheaper version of|lower-cost version of)/i.test(text)
  const cheaper = /\bcheaper\b|\blower[- ]cost\b|\blower price\b/i.test(text)
  const sameness = /\bsame\b|\bidentical\b|\bequivalent\b|\bjust like\b|\blike [a-z0-9 .-]{2,40}\b/i.test(text)
  if (high) {
    return {
      penalty: 20,
      gradeCap: "C",
      reason: "Idea is framed as an explicit clone of an incumbent.",
      level: "high",
    }
  }
  if (cheaper && sameness) {
    return {
      penalty: 18,
      gradeCap: "C",
      reason: "Idea is primarily price-under-cutting with equivalent incumbent functionality.",
      level: "high",
    }
  }
  if (medium) {
    return {
      penalty: 14,
      gradeCap: "C",
      reason: "Price-only differentiation without product wedge is usually weak.",
      level: "medium",
    }
  }
  return { penalty: 0 }
}

export function computeReadinessScore(
  ddReport: DDReport,
  crowdednessIndex: string,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis | null,
  ideaText?: string,
): ReadinessScore {
  // Safety net: flatten numeric-key structures from jsonrepair artifacts
  const dd = flattenNumericKeys(ddReport) as DDReport
  const breakdown: ScoreBreakdown[] = [
    scoreProblemSeverity(dd),
    scoreMarketSize(dd),
    scoreDefensibility(dd),
    scoreCompetitiveGap(crowdednessIndex, gapAnalysis),
    scoreGtmClarity(dd),
    scoreBusinessModel(dd),
    scoreRiskProfile(dd),
    scoreUniqueness(dd, competitors, gapAnalysis),
  ]

  const total = clamp(Math.round(breakdown.reduce((sum, b) => sum + b.score, 0)), 0, 100)
  const uniquenessScore = breakdown.find((b) => b.factor === "Uniqueness")?.score ?? 0
  const clone = clonePenalty(uniquenessScore, crowdednessIndex, competitors)
  const focus = focusPenalty(dd)
  const copycat = copycatPromptPenalty(ideaText)
  const totalPenalty = clone.penalty + focus.penalty + copycat.penalty
  const adjustedTotal = clamp(total - totalPenalty, 0, 100)
  const rawGrade = letterGrade(adjustedTotal)
  const caps = [clone.gradeCap, focus.gradeCap, copycat.gradeCap].filter(Boolean) as string[]
  const strictestCap = caps.sort((a, b) => gradeRank(a) - gradeRank(b))[0]
  const grade = strictestCap && gradeRank(rawGrade) > gradeRank(strictestCap)
    ? strictestCap
    : rawGrade
  const reasons = [
    clone.reason ? `Clone-risk adjustment applied: ${clone.reason}` : "",
    focus.reason ? `Focus adjustment applied: ${focus.reason}` : "",
    copycat.reason ? `Copycat adjustment applied: ${copycat.reason}` : "",
  ].filter(Boolean)
  const verdict = reasons.length > 0
    ? `${generateVerdict(adjustedTotal, grade)} ${reasons.join(" ")}`
    : generateVerdict(adjustedTotal, grade)

  return {
    total: adjustedTotal,
    grade,
    breakdown,
    verdict,
    cloneRisk: (clone.reason || copycat.reason)
      ? {
          level: clone.level || copycat.level || "low",
          penalty: clone.penalty + copycat.penalty,
          reason: [clone.reason, copycat.reason].filter(Boolean).join(" "),
        }
      : undefined,
  }
}
