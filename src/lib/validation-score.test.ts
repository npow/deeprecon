import { describe, it, expect } from "vitest"
import type { Competitor, DDReport, GapAnalysis } from "./types"
import { computeValidationScore } from "./validation-score"

function makeDDReport(overrides: Partial<DDReport> = {}): DDReport {
  return {
    idealCustomerProfile: {
      summary: "Ops leaders at mid-market logistics teams",
      demographics: "US-based mid-market",
      psychographics: "process-driven",
      behaviors: "run weekly ops reviews",
      painPoints: ["manual reconciliation"],
      willingness_to_pay: "$400/mo",
    },
    problemSeverity: { score: 8, frequency: "daily", alternatives: "spreadsheets and email", evidenceSummary: "8 hours/week of rework and compliance risk" },
    wedgeStrategy: { wedge: "single workflow automation for reconciliations", whyThisWorks: "narrow painful workflow", firstCustomers: "logistics ops teams", expansionPath: "expand to adjacent back-office workflows" },
    tamSamSom: {
      tam: { value: "$5B", methodology: "top down" },
      sam: { value: "$500M", methodology: "segment down" },
      som: { value: "$50M", methodology: "bottom up" },
    },
    businessModel: {
      recommendedModel: "Per-seat annual contract",
      pricingStrategy: "Annual contract with usage add-on",
      unitEconomics: "healthy gross margin",
      comparables: "N/A",
    },
    defensibility: { moatType: "workflow data", timeToMoat: "12 months", strengthAssessment: "moderate", risks: "incumbent response" },
    goToMarket: {
      channels: [
        { channel: "LinkedIn outbound", rationale: "targeted", estimatedCac: "low" },
        { channel: "Referral partners", rationale: "warm intros", estimatedCac: "$0" },
      ],
      firstMilestone: "Book 30 calls in first 30 days",
    },
    risksMitigations: [
      { risk: "integration delays", likelihood: "medium", impact: "medium", mitigation: "start with CSV imports" },
    ],
    portersFiveForces: {
      competitiveRivalry: { intensity: "medium", reasoning: "few focused incumbents" },
      threatOfNewEntrants: { level: "medium", reasoning: "moderate switching cost" },
      threatOfSubstitutes: { level: "medium", reasoning: "internal tooling" },
      buyerPower: { level: "medium", reasoning: "can delay purchase" },
      supplierPower: { level: "low", reasoning: "commodity infra" },
      overallAttractiveness: "good",
    },
    jobsToBeDone: {
      primaryJob: "reduce reconciliation time",
      functionalAspects: "automate repetitive checks",
      emotionalAspects: "reduce anxiety during audits",
      socialAspects: "look reliable to leadership",
      currentHiredSolutions: ["spreadsheets"],
      underservedOutcomes: ["fewer manual errors"],
    },
    strategyCanvas: {
      competitiveFactors: [],
      blueOceanMoves: [],
    },
    ...overrides,
  }
}

function makeCompetitors(): Competitor[] {
  return [
    {
      name: "Comp A",
      description: "Incumbent",
      websiteUrl: "https://a.example.com",
      totalFundingUsd: 50_000_000,
      lastFundingType: "Series B",
      employeeCountRange: "51-200",
      yearFounded: 2018,
      similarityScore: 72,
      websiteStatus: "verified",
      confidenceLevel: "web_verified",
      topComplaints: [],
      keyDifferentiators: [],
      source: "web_search",
    },
    {
      name: "Comp B",
      description: "Adjacent",
      websiteUrl: "https://b.example.com",
      totalFundingUsd: 5_000_000,
      lastFundingType: "Seed",
      employeeCountRange: "11-50",
      yearFounded: 2021,
      similarityScore: 55,
      websiteStatus: "verified",
      confidenceLevel: "multi_confirmed",
      topComplaints: [],
      keyDifferentiators: [],
      source: "web_search",
    },
  ]
}

const GAP_ANALYSIS: GapAnalysis = {
  whiteSpaceOpportunities: [{ opportunity: "audit workflow automation", evidence: "complaints in reviews", potentialImpact: "high" }],
  commonComplaints: [{ complaint: "manual process", frequency: "high", competitors: ["Comp A"] }],
  unservedSegments: [{ segment: "mid-market logistics", description: "underserved", whyUnserved: "incumbents focus enterprise" }],
}

describe("computeValidationScore", () => {
  it("returns watch gate when no live validation signals are provided", () => {
    const score = computeValidationScore(makeDDReport(), makeCompetitors(), GAP_ANALYSIS)
    expect(score.total).toBeGreaterThan(40)
    expect(score.gate.status).toBe("watch")
    expect(score.hasLiveSignals).toBe(false)
  })

  it("upgrades with live traction signals", () => {
    const score = computeValidationScore(
      makeDDReport(),
      makeCompetitors(),
      GAP_ANALYSIS,
      { outreachCount: 60, responseCount: 9, discoveryCalls: 6, pilots: 2, prepayments: 1 },
    )
    expect(score.hasLiveSignals).toBe(true)
    expect(score.gate.status).toBe("pass")
    expect(score.total).toBeGreaterThan(65)
  })
})
