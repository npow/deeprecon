import type { DDReport, Competitor, GapAnalysis, PivotSuggestion } from "./types"
import { safeArray, safeStr, flattenNumericKeys } from "./utils"
import type { ReadinessScore } from "./readiness-score"

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
  estimatedLift: number
  predictedMin: number
  predictedMostLikely: number
  predictedMax: number
  confidence: "high" | "medium" | "low"
  priority: "high" | "medium" | "low"
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
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
  if (currentUniqueness >= 3.5) score -= 1

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
      ? `specifically for ${safeStr(seg.segment).toLowerCase()}, with a core differentiator around ${safeStr(gap.opportunity).toLowerCase()}`
      : `with a core differentiator around ${safeStr(gap.opportunity).toLowerCase()}`
    const refinedIdeaText = mergeIdeaText(baseIdea, qualifier)
    const key = normalizedKey(refinedIdeaText)
    if (!key || seen.has(key)) continue
    seen.add(key)
    suggestions.push({
      id: `uniq-${suggestions.length + 1}`,
      title: `Position around ${safeStr(gap.opportunity)}`,
      whyItCouldWork: hasComplaint
        ? `Targets a repeated competitor complaint: ${safeStr(complaint.complaint)}`
        : safeStr(gap.evidence),
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
    const refinedIdeaText = mergeIdeaText(baseIdea, `built for ${safeStr(seg.segment).toLowerCase()}`)
    suggestions.push({
      id: "uniq-fallback-segment",
      title: `Niche down to ${safeStr(seg.segment)}`,
      whyItCouldWork: safeStr(seg.whyUnserved),
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
      { action: "Build an MVP", detail: `Focus on your wedge: ${safeStr(dd.wedgeStrategy?.wedge) || "core differentiator"}.`, priority: "high" },
      { action: "Run a 2-week MVP test", detail: "Ship to a small cohort and track activation, retention, and conversion.", priority: "medium" },
    )
  } else if (grade === "B" && mvpReady) {
    steps.push(
      { action: `Strengthen: ${safeStr(weakest?.factor)}`, detail: `This is your weakest area (${weakest?.score}/${weakest?.max}). ${safeStr(weakest?.detail)}.`, priority: "high" },
      { action: "Build a thin MVP", detail: "Implement the smallest version of the wedge and validate one paid use case.", priority: "high" },
      { action: "Test pricing with target customers", detail: `Validate pricing with: ${safeStr(dd.idealCustomerProfile?.summary) || "your ideal customers"}.`, priority: "medium" },
    )
  } else if (grade === "A" || grade === "B") {
    steps.push(
      { action: "Do not build full MVP yet", detail: "First validate problem urgency and positioning with 10-15 ICP interviews.", priority: "high" },
      { action: `Fix: ${safeStr(weakest?.factor)}`, detail: `Your current blocker is ${safeStr(weakest?.factor)} (${weakest?.score}/${weakest?.max}).`, priority: "high" },
      { action: "Run a no-code smoke test", detail: "Use a landing page + outbound to validate demand before coding.", priority: "medium" },
    )
  } else if (grade === "C") {
    steps.push(
      { action: `Fix: ${safeStr(weakest?.factor)}`, detail: `Critical weakness (${weakest?.score}/${weakest?.max}). Focus here first.`, priority: "high" },
      { action: `Improve: ${safeStr(secondWeakest?.factor)}`, detail: `Second priority (${secondWeakest?.score}/${secondWeakest?.max}). ${safeStr(secondWeakest?.detail)}.`, priority: "high" },
    )
    if (pivots.length > 0) {
      steps.push({ action: `Consider pivot: ${safeStr(pivots[0].title)}`, detail: safeStr(pivots[0].description), priority: "medium" })
    }
    steps.push({ action: "Re-scan after changes", detail: "Make adjustments and run another analysis to track improvement.", priority: "low" })
  } else {
    if (pivots.length > 0) {
      steps.push({ action: `Strongest pivot: ${safeStr(pivots[0].title)}`, detail: safeStr(pivots[0].whyItWorks) || safeStr(pivots[0].description), priority: "high" })
    }
    steps.push(
      { action: `Address #1 weakness: ${safeStr(weakest?.factor)}`, detail: `Score: ${weakest?.score}/${weakest?.max}. This must improve significantly.`, priority: "high" },
      { action: "Talk to potential users before building", detail: "Validate the core problem exists and people would pay to solve it.", priority: "high" },
    )
  }

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

function generateDifferentiationSteps(
  competitors: Competitor[],
  gapAnalysis: GapAnalysis | null,
  ddReport: DDReport,
): NextStep[] {
  const steps: NextStep[] = []

  const whiteSpaces = safeArray(gapAnalysis?.whiteSpaceOpportunities)
  const highImpactGaps = whiteSpaces.filter((w) => w.potentialImpact === "high")
  const topGaps = highImpactGaps.length > 0 ? highImpactGaps : whiteSpaces
  if (topGaps.length > 0) {
    const top = topGaps[0]
    const others = topGaps.slice(1, 3).map((g) => safeStr(g.opportunity)).join("; ")
    const wedge = safeStr(ddReport.wedgeStrategy?.wedge) || "your core idea"
    const refinedIdeaText = `${wedge}, specifically focused on ${safeStr(top.opportunity).toLowerCase()}.`
    steps.push({
      action: `Differentiate via: ${safeStr(top.opportunity)}`,
      detail: `${safeStr(top.evidence)}${others ? ` Also consider: ${others}.` : ""} Apply this angle and re-scan.`,
      priority: "high",
      refinedIdeaText,
    })
  }

  const segments = safeArray(gapAnalysis?.unservedSegments)
  if (segments.length > 0) {
    const top = segments[0]
    const wedge = safeStr(ddReport.wedgeStrategy?.wedge) || "your core idea"
    const refinedIdeaText = `${wedge}, built specifically for ${safeStr(top.segment).toLowerCase()}.`
    steps.push({
      action: `Niche down: target ${safeStr(top.segment)}`,
      detail: `${safeStr(top.description)}. ${safeStr(top.whyUnserved)}. Apply this narrower focus and re-scan.`,
      priority: "medium",
      refinedIdeaText,
    })
  }

  const complaints = safeArray(gapAnalysis?.commonComplaints)
  const topComplaints = complaints
    .filter((c) => c.frequency === "very_common" || c.frequency === "common")
    .slice(0, 3)
  if (topComplaints.length > 0) {
    const complaintList = topComplaints.map((c) => safeStr(c.complaint)).join("; ")
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
