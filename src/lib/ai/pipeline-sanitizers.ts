import { jsonrepair } from "jsonrepair"
import { flattenNumericKeys } from "@/lib/utils"
import type { Competitor, DDReport, GapAnalysis } from "@/lib/types"

export function sanitizeCompetitor(raw: any): Competitor {
  const cleaned: any = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k && typeof k === "string" && k.length > 0) cleaned[k] = v
  }
  return {
    ...cleaned,
    name: cleaned.name || "Unknown",
    description: cleaned.description || "",
    similarityScore: typeof cleaned.similarityScore === "number" ? cleaned.similarityScore : 50,
    topComplaints: Array.isArray(cleaned.topComplaints) ? cleaned.topComplaints : [],
    keyDifferentiators: Array.isArray(cleaned.keyDifferentiators) ? cleaned.keyDifferentiators : [],
    tags: Array.isArray(cleaned.tags) ? cleaned.tags : [],
    source: cleaned.source || "ai_knowledge",
    websiteStatus: cleaned.websiteStatus || "unknown",
    websiteStatusReason: cleaned.websiteStatusReason || "",
    confirmedBy: Array.isArray(cleaned.confirmedBy) ? cleaned.confirmedBy : [],
    confirmedByCount: typeof cleaned.confirmedByCount === "number" ? cleaned.confirmedByCount : 0,
    confidenceLevel: cleaned.confidenceLevel || "ai_inferred",
  }
}

export function finalizeCompetitorConfidence(competitors: Competitor[]): Competitor[] {
  return competitors.map((c) => {
    const confirmedBy = Array.isArray(c.confirmedBy) ? c.confirmedBy : []
    const confirmedByCount = c.confirmedByCount ?? confirmedBy.length
    const websiteStatus = c.websiteStatus || "unknown"
    const websiteStatusReason = c.websiteStatusReason || ""
    const confidenceLevel = websiteStatus === "verified"
      ? "web_verified"
      : confirmedByCount >= 2
        ? "multi_confirmed"
        : "ai_inferred"

    return {
      ...c,
      confirmedBy,
      confirmedByCount,
      websiteStatus,
      websiteStatusReason,
      confidenceLevel,
    }
  })
}

export function extractJSON(text: string): string {
  const trimmed = text.trim()

  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {}

  try {
    const repaired = jsonrepair(trimmed)
    JSON.parse(repaired)
    return repaired
  } catch {}

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  let raw = codeBlockMatch ? codeBlockMatch[1].trim() : null

  if (!raw) {
    const jsonMatch = trimmed.match(/[\[{][\s\S]*[\]}]/)
    if (jsonMatch) raw = jsonMatch[0]
  }

  if (!raw) throw new Error("No JSON found in response")

  const repaired = jsonrepair(raw)
  JSON.parse(repaired)
  return repaired
}

export function sanitizeGapAnalysis(raw: any): GapAnalysis {
  return {
    whiteSpaceOpportunities: Array.isArray(raw.whiteSpaceOpportunities) ? raw.whiteSpaceOpportunities : [],
    commonComplaints: Array.isArray(raw.commonComplaints) ? raw.commonComplaints : [],
    unservedSegments: Array.isArray(raw.unservedSegments) ? raw.unservedSegments : [],
  }
}

export function sanitizeDDReport(raw: any): DDReport {
  const data = flattenNumericKeys(raw)
  return {
    ...data,
    idealCustomerProfile: {
      ...data.idealCustomerProfile,
      painPoints: Array.isArray(data.idealCustomerProfile?.painPoints) ? data.idealCustomerProfile.painPoints : [],
    },
    goToMarket: {
      ...data.goToMarket,
      channels: Array.isArray(data.goToMarket?.channels) ? data.goToMarket.channels : [],
    },
    risksMitigations: Array.isArray(data.risksMitigations) ? data.risksMitigations : [],
    strategyCanvas: data.strategyCanvas ? {
      ...data.strategyCanvas,
      competitiveFactors: Array.isArray(data.strategyCanvas.competitiveFactors) ? data.strategyCanvas.competitiveFactors : [],
      blueOceanMoves: Array.isArray(data.strategyCanvas.blueOceanMoves) ? data.strategyCanvas.blueOceanMoves : [],
    } : data.strategyCanvas,
    jobsToBeDone: data.jobsToBeDone ? {
      ...data.jobsToBeDone,
      currentHiredSolutions: Array.isArray(data.jobsToBeDone.currentHiredSolutions) ? data.jobsToBeDone.currentHiredSolutions : [],
      underservedOutcomes: Array.isArray(data.jobsToBeDone.underservedOutcomes) ? data.jobsToBeDone.underservedOutcomes : [],
    } : data.jobsToBeDone,
  }
}

export function ddMissingFields(report: DDReport): string[] {
  const missing: string[] = []
  if (!String(report?.wedgeStrategy?.wedge || "").trim()) missing.push("wedgeStrategy.wedge")
  if (!String(report?.wedgeStrategy?.whyThisWorks || "").trim()) missing.push("wedgeStrategy.whyThisWorks")
  if (!String(report?.wedgeStrategy?.firstCustomers || "").trim()) missing.push("wedgeStrategy.firstCustomers")
  if (!String(report?.wedgeStrategy?.expansionPath || "").trim()) missing.push("wedgeStrategy.expansionPath")
  if (!String(report?.tamSamSom?.tam?.value || "").trim()) missing.push("tamSamSom.tam.value")
  if (!String(report?.tamSamSom?.sam?.value || "").trim()) missing.push("tamSamSom.sam.value")
  if (!String(report?.tamSamSom?.som?.value || "").trim()) missing.push("tamSamSom.som.value")
  if (!String(report?.businessModel?.recommendedModel || "").trim()) missing.push("businessModel.recommendedModel")
  if (!String(report?.businessModel?.pricingStrategy || "").trim()) missing.push("businessModel.pricingStrategy")
  if (!String(report?.businessModel?.unitEconomics || "").trim()) missing.push("businessModel.unitEconomics")
  if (!Array.isArray(report?.goToMarket?.channels) || report.goToMarket.channels.length === 0) missing.push("goToMarket.channels")
  if (!Array.isArray(report?.risksMitigations) || report.risksMitigations.length === 0) missing.push("risksMitigations")
  if (!String(report?.jobsToBeDone?.primaryJob || "").trim()) missing.push("jobsToBeDone.primaryJob")
  if (!Array.isArray(report?.strategyCanvas?.blueOceanMoves) || report.strategyCanvas.blueOceanMoves.length === 0) missing.push("strategyCanvas.blueOceanMoves")
  return missing
}
