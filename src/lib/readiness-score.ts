import type { DDReport, Competitor, GapAnalysis, PivotSuggestion } from "./types"
import { safeArray, parseFundingString, flattenNumericKeys } from "./utils"
import { summarizeThreats } from "./competition-threat"

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

// ─── Next steps generation ───

export interface NextStep {
  action: string
  detail: string
  priority: "high" | "medium" | "low"
  refinedIdeaText?: string
}

export interface UniquenessSuggestion {
  id: string
  title: string
  whyItCouldWork: string
  refinedIdeaText: string
  estimatedLift: number // projected score delta on 0-5 uniqueness axis
  predictedMin: number // lower-bound projected uniqueness score on 0-5 axis
  predictedMostLikely: number // most likely projected uniqueness score on 0-5 axis
  predictedMax: number // upper-bound projected uniqueness score on 0-5 axis
  confidence: "high" | "medium" | "low"
  priority: "high" | "medium" | "low"
}

function normalizedKey(text: string): string {
  return (text || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80)
}

function uniquenessScoreFromReadiness(score: ReadinessScore): number {
  const factor = score.breakdown.find((b) => b.factor === "Uniqueness")
  if (!factor || !factor.max) return 0
  return factor.score
}

function avgSimilarity(competitors: Competitor[]): number {
  const valid = competitors.filter((c) => typeof c.similarityScore === "number")
  if (valid.length === 0) return 0
  return valid.reduce((sum, c) => sum + (c.similarityScore || 0), 0) / valid.length
}

function liftFromImpact(level: "high" | "medium" | "low", hasSegment: boolean, hasComplaint: boolean): number {
  const impactBase = level === "high" ? 1.6 : level === "medium" ? 1.1 : 0.7
  const segmentBonus = hasSegment ? 0.6 : 0
  const complaintBonus = hasComplaint ? 0.4 : 0
  return Math.round((impactBase + segmentBonus + complaintBonus) * 10) / 10
}

function mergeIdeaText(baseIdea: string, qualifier: string): string {
  const cleaned = baseIdea.trim().replace(/[.?!]\s*$/, "")
  return `${cleaned}, ${qualifier}.`
}

function projectedConfidence(
  impact: "high" | "medium" | "low",
  hasSegment: boolean,
  hasComplaint: boolean,
  currentUniqueness: number,
): "high" | "medium" | "low" {
  let score = 0
  if (impact === "high") score += 2
  else if (impact === "medium") score += 1
  if (hasSegment) score += 1
  if (hasComplaint) score += 1
  if (currentUniqueness >= 3.5) score -= 1 // harder to keep improving at higher uniqueness

  if (score >= 4) return "high"
  if (score >= 2) return "medium"
  return "low"
}

function projectedSpread(confidence: "high" | "medium" | "low"): number {
  if (confidence === "high") return 0.25
  if (confidence === "medium") return 0.45
  return 0.7
}

export function generateUniquenessSuggestions(
  ideaText: string,
  score: ReadinessScore,
  ddReport: DDReport,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis | null,
  maxSuggestions: number = 3
): UniquenessSuggestion[] {
  const whiteSpace = safeArray(gapAnalysis?.whiteSpaceOpportunities)
  const segments = safeArray(gapAnalysis?.unservedSegments)
  const complaints = safeArray(gapAnalysis?.commonComplaints)
    .filter((c) => c.frequency === "very_common" || c.frequency === "common")
  const currentUniqueness = uniquenessScoreFromReadiness(score)
  const similarity = avgSimilarity(competitors)
  const wedge = ddReport.wedgeStrategy?.wedge?.trim()
  const baseIdea = ideaText.trim() || wedge || "AI startup validation product"
  const seen = new Set<string>()
  const suggestions: UniquenessSuggestion[] = []

  const topGaps = [...whiteSpace].sort((a, b) => {
    const rank = (x: "high" | "medium" | "low") => (x === "high" ? 3 : x === "medium" ? 2 : 1)
    return rank(b.potentialImpact) - rank(a.potentialImpact)
  })

  for (let i = 0; i < topGaps.length && suggestions.length < maxSuggestions; i++) {
    const gap = topGaps[i]
    const seg = segments[i] || segments[0]
    const complaint = complaints[i] || complaints[0]
    const hasSeg = !!seg
    const hasComplaint = !!complaint
    const rawLift = liftFromImpact(gap.potentialImpact, hasSeg, hasComplaint)
    const crowdPenalty = similarity >= 85 ? 0.2 : 0
    const saturationPenalty = currentUniqueness >= 3 ? 0.6 : 0
    const estimatedLift = clamp(Math.round((rawLift - crowdPenalty - saturationPenalty) * 10) / 10, 0.4, 2.8)
    const predictedMostLikely = clamp(Math.round((currentUniqueness + estimatedLift) * 10) / 10, 0, 5)
    const confidence = projectedConfidence(gap.potentialImpact, hasSeg, hasComplaint, currentUniqueness)
    const spread = projectedSpread(confidence)
    const predictedMin = clamp(Math.round((predictedMostLikely - spread) * 10) / 10, 0, 5)
    const predictedMax = clamp(Math.round((predictedMostLikely + spread) * 10) / 10, 0, 5)
    const qualifier = hasSeg
      ? `specifically for ${seg.segment.toLowerCase()}, with a core differentiator around ${gap.opportunity.toLowerCase()}`
      : `with a core differentiator around ${gap.opportunity.toLowerCase()}`
    const refinedIdeaText = mergeIdeaText(baseIdea, qualifier)
    const key = normalizedKey(refinedIdeaText)
    if (!key || seen.has(key)) continue
    seen.add(key)
    suggestions.push({
      id: `uniq-${suggestions.length + 1}`,
      title: `Position around ${gap.opportunity}`,
      whyItCouldWork: hasComplaint
        ? `Targets a repeated competitor complaint: ${complaint.complaint}`
        : gap.evidence,
      refinedIdeaText,
      estimatedLift,
      predictedMin,
      predictedMostLikely,
      predictedMax,
      confidence,
      priority: gap.potentialImpact === "high" ? "high" : gap.potentialImpact === "medium" ? "medium" : "low",
    })
  }

  if (suggestions.length === 0 && segments.length > 0) {
    const seg = segments[0]
    const refinedIdeaText = mergeIdeaText(baseIdea, `built for ${seg.segment.toLowerCase()}`)
    suggestions.push({
      id: "uniq-fallback-segment",
      title: `Niche down to ${seg.segment}`,
      whyItCouldWork: seg.whyUnserved,
      refinedIdeaText,
      estimatedLift: 1.1,
      predictedMin: clamp(Math.round((currentUniqueness + 0.6) * 10) / 10, 0, 5),
      predictedMostLikely: clamp(Math.round((currentUniqueness + 1.1) * 10) / 10, 0, 5),
      predictedMax: clamp(Math.round((currentUniqueness + 1.6) * 10) / 10, 0, 5),
      confidence: "medium",
      priority: "medium",
    })
  }

  return suggestions.slice(0, maxSuggestions)
}

export function generateNextSteps(
  score: ReadinessScore,
  ddReport: DDReport,
  pivots: PivotSuggestion[],
  competitors?: Competitor[],
  gapAnalysis?: GapAnalysis | null,
): NextStep[] {
  const dd = flattenNumericKeys(ddReport) as DDReport
  const steps: NextStep[] = []
  const { grade, breakdown } = score
  const factor = (name: string) => breakdown.find((b) => b.factor === name)

  // Find weakest factors
  const sorted = [...breakdown].sort((a, b) => (a.score / a.max) - (b.score / b.max))
  const weakest = sorted[0]
  const secondWeakest = sorted[1]
  const problem = factor("Problem Severity")
  const uniqueness = factor("Uniqueness")
  const competitiveGap = factor("Competitive Gap")
  const mvpReady = grade === "A" || (
    grade === "B" &&
    (problem ? problem.score / problem.max >= 0.65 : false) &&
    (uniqueness ? uniqueness.score >= 2 : false) &&
    (competitiveGap ? competitiveGap.score / competitiveGap.max >= 0.45 : false)
  )

  if (grade === "A" && mvpReady) {
    steps.push(
      { action: "Validate with 10 customer interviews", detail: "Your fundamentals are strong. Start talking to real users to validate willingness to pay.", priority: "high" },
      { action: "Build an MVP", detail: `Focus on your wedge: ${dd.wedgeStrategy?.wedge || "core differentiator"}.`, priority: "high" },
      { action: "Run a 2-week MVP test", detail: "Ship to a small cohort and track activation, retention, and conversion.", priority: "medium" },
    )
  } else if (grade === "B" && mvpReady) {
    steps.push(
      { action: `Strengthen: ${weakest?.factor}`, detail: `This is your weakest area (${weakest?.score}/${weakest?.max}). ${weakest?.detail}.`, priority: "high" },
      { action: "Build a thin MVP", detail: "Implement the smallest version of the wedge and validate one paid use case.", priority: "high" },
      { action: "Test pricing with target customers", detail: `Validate pricing with: ${dd.idealCustomerProfile?.summary || "your ideal customers"}.`, priority: "medium" },
    )
  } else if (grade === "A" || grade === "B") {
    steps.push(
      { action: "Do not build full MVP yet", detail: "First validate problem urgency and positioning with 10-15 ICP interviews.", priority: "high" },
      { action: `Fix: ${weakest?.factor}`, detail: `Your current blocker is ${weakest?.factor} (${weakest?.score}/${weakest?.max}).`, priority: "high" },
      { action: "Run a no-code smoke test", detail: "Use a landing page + outbound to validate demand before coding.", priority: "medium" },
    )
  } else if (grade === "C") {
    steps.push(
      { action: `Fix: ${weakest?.factor}`, detail: `Critical weakness (${weakest?.score}/${weakest?.max}). Focus here first.`, priority: "high" },
      { action: `Improve: ${secondWeakest?.factor}`, detail: `Second priority (${secondWeakest?.score}/${secondWeakest?.max}). ${secondWeakest?.detail}.`, priority: "high" },
    )
    if (pivots.length > 0) {
      steps.push({ action: `Consider pivot: ${pivots[0].title}`, detail: pivots[0].description, priority: "medium" })
    }
    steps.push({ action: "Re-scan after changes", detail: "Make adjustments and run another analysis to track improvement.", priority: "low" })
  } else {
    // D or F
    if (pivots.length > 0) {
      steps.push({ action: `Strongest pivot: ${pivots[0].title}`, detail: pivots[0].whyItWorks || pivots[0].description, priority: "high" })
    }
    steps.push(
      { action: `Address #1 weakness: ${weakest?.factor}`, detail: `Score: ${weakest?.score}/${weakest?.max}. This must improve significantly.`, priority: "high" },
      { action: "Talk to potential users before building", detail: "Validate the core problem exists and people would pay to solve it.", priority: "high" },
    )
  }

  // ─── Differentiation suggestions when uniqueness is weak ───
  const uniquenessFactor = breakdown.find((b) => b.factor === "Uniqueness")
  const uniquenessPct = uniquenessFactor ? uniquenessFactor.score / uniquenessFactor.max : 1
  if (uniquenessPct < 0.7) {
    const diffSteps = prioritizeSteps(generateDifferentiationSteps(competitors || [], gapAnalysis || null, dd)).slice(0, 2)
    if (diffSteps.length > 0) {
      steps.push(...diffSteps)
    } else {
      steps.push({
        action: "Reframe core problem or ICP",
        detail: "Current position is too close to incumbents; pick a narrower pain point or different buyer persona.",
        priority: "high",
      })
    }
  }

  return prioritizeSteps(steps).slice(0, 5)
}

// ─── Differentiation helpers ───

function generateDifferentiationSteps(
  competitors: Competitor[],
  gapAnalysis: GapAnalysis | null,
  ddReport: DDReport,
): NextStep[] {
  const steps: NextStep[] = []

  // 1. Surface high-impact white space opportunities as concrete differentiators
  const whiteSpaces = safeArray(gapAnalysis?.whiteSpaceOpportunities)
  const highImpactGaps = whiteSpaces.filter((w) => w.potentialImpact === "high")
  const topGaps = highImpactGaps.length > 0 ? highImpactGaps : whiteSpaces
  if (topGaps.length > 0) {
    const top = topGaps[0]
    const others = topGaps.slice(1, 3).map((g) => g.opportunity).join("; ")
    const wedge = ddReport.wedgeStrategy?.wedge || "your core idea"
    const refinedIdeaText = `${wedge}, specifically focused on ${top.opportunity.toLowerCase()}.`
    steps.push({
      action: `Differentiate via: ${top.opportunity}`,
      detail: `${top.evidence}${others ? ` Also consider: ${others}.` : ""} Apply this angle and re-scan.`,
      priority: "high",
      refinedIdeaText,
    })
  }

  // 2. Unserved segments → niche down suggestion
  const segments = safeArray(gapAnalysis?.unservedSegments)
  if (segments.length > 0) {
    const top = segments[0]
    const wedge = ddReport.wedgeStrategy?.wedge || "your core idea"
    const refinedIdeaText = `${wedge}, built specifically for ${top.segment.toLowerCase()}.`
    steps.push({
      action: `Niche down: target ${top.segment}`,
      detail: `${top.description}. ${top.whyUnserved}. Apply this narrower focus and re-scan.`,
      priority: "medium",
      refinedIdeaText,
    })
  }

  // 3. Common complaints → build what competitors won't
  const complaints = safeArray(gapAnalysis?.commonComplaints)
  const topComplaints = complaints
    .filter((c) => c.frequency === "very_common" || c.frequency === "common")
    .slice(0, 3)
  if (topComplaints.length > 0) {
    const complaintList = topComplaints.map((c) => c.complaint).join("; ")
    steps.push({
      action: "Solve what competitors won't",
      detail: `Users commonly complain about: ${complaintList}. Making these pain points your core focus is a strong differentiator.`,
      priority: "medium",
    })
  }

  return steps
}

function prioritizeSteps(steps: NextStep[]): NextStep[] {
  const priorityWeight = (p: NextStep["priority"]) => (p === "high" ? 0 : p === "medium" ? 1 : 2)
  const actionWeight = (a: string) => {
    const lower = (a || "").toLowerCase()
    if (lower.startsWith("strengthen: uniqueness")) return -2
    if (lower.startsWith("address #1 weakness") || lower.startsWith("fix:") || lower.startsWith("strengthen:")) return -1
    return 0
  }
  const dedup = new Map<string, NextStep>()
  for (const step of steps) {
    const key = `${(step.action || "").toLowerCase().trim()}|${step.priority}`
    if (!dedup.has(key)) dedup.set(key, step)
  }
  return Array.from(dedup.values()).sort((a, b) => {
    const p = priorityWeight(a.priority) - priorityWeight(b.priority)
    if (p !== 0) return p
    const aw = actionWeight(a.action) - actionWeight(b.action)
    if (aw !== 0) return aw
    return a.action.localeCompare(b.action)
  })
}
