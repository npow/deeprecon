import { describe, expect, it } from "vitest"
import { computeReadinessScore, generateUniquenessSuggestions } from "./readiness-score"
import type { Competitor, DDReport, GapAnalysis } from "./types"

const ddReportFixture: DDReport = {
  idealCustomerProfile: {
    summary: "Pre-seed founders validating B2B SaaS ideas",
    demographics: "Early stage founders",
    psychographics: "Execution focused",
    behaviors: "Runs frequent market tests",
    painPoints: ["Unclear market demand"],
    willingness_to_pay: "$49-$199/mo",
  },
  problemSeverity: {
    score: 7,
    frequency: "weekly",
    alternatives: "Manual desk research",
    evidenceSummary: "Founders spend days validating ideas",
  },
  wedgeStrategy: {
    wedge: "startup idea validation platform",
    whyThisWorks: "Founders need fast answers",
    firstCustomers: "Indie founders",
    expansionPath: "VC and accelerators",
  },
  tamSamSom: {
    tam: { value: "$1B", methodology: "top-down" },
    sam: { value: "$200M", methodology: "bottom-up" },
    som: { value: "$20M", methodology: "bottom-up" },
  },
  businessModel: {
    recommendedModel: "SaaS",
    pricingStrategy: "tiered",
    unitEconomics: "unknown",
    comparables: "none",
  },
  defensibility: {
    moatType: "workflow data",
    timeToMoat: "12 months",
    strengthAssessment: "moderate",
    risks: "copycats",
  },
  goToMarket: {
    channels: [{ channel: "SEO", rationale: "intent traffic", estimatedCac: "low" }],
    firstMilestone: "100 signups",
  },
  risksMitigations: [{ risk: "noise", likelihood: "medium", impact: "medium", mitigation: "human review" }],
  portersFiveForces: {
    competitiveRivalry: { intensity: "high", reasoning: "many players" },
    threatOfNewEntrants: { level: "high", reasoning: "easy to build MVP" },
    threatOfSubstitutes: { level: "medium", reasoning: "manual alternatives exist" },
    buyerPower: { level: "high", reasoning: "many options" },
    supplierPower: { level: "low", reasoning: "commodity infra" },
    overallAttractiveness: "moderate",
  },
  jobsToBeDone: {
    primaryJob: "Assess viability quickly",
    functionalAspects: "competitive analysis",
    emotionalAspects: "confidence",
    socialAspects: "investor credibility",
    currentHiredSolutions: ["Google", "ChatGPT"],
    underservedOutcomes: ["verifiable evidence"],
  },
  strategyCanvas: {
    competitiveFactors: [],
    blueOceanMoves: [],
  },
}

const competitorsFixture: Competitor[] = [
  {
    name: "CompA",
    description: "Validation tool",
    similarityScore: 94,
    topComplaints: ["generic output"],
    keyDifferentiators: ["speed"],
    source: "web_search",
  },
  {
    name: "CompB",
    description: "Another validation tool",
    similarityScore: 90,
    topComplaints: ["hallucinations"],
    keyDifferentiators: ["UI"],
    source: "web_search",
  },
]

const gapFixture: GapAnalysis = {
  whiteSpaceOpportunities: [
    {
      opportunity: "Evidence-first due diligence",
      evidence: "Users report trust issues",
      potentialImpact: "high",
    },
    {
      opportunity: "Continuous monitoring",
      evidence: "Most reports are static",
      potentialImpact: "high",
    },
  ],
  commonComplaints: [
    {
      complaint: "Reports are generic",
      frequency: "very_common",
      competitors: ["CompA"],
    },
  ],
  unservedSegments: [
    {
      segment: "VC analysts",
      description: "Need faster screening",
      whyUnserved: "Founder-centric tools dominate",
    },
  ],
}

describe("generateUniquenessSuggestions", () => {
  it("returns concrete refined idea variants with lift estimates", () => {
    const score = computeReadinessScore(ddReportFixture, "high", competitorsFixture, gapFixture)
    const suggestions = generateUniquenessSuggestions(
      "startup idea validator that performs due diligence and competitive market analysis",
      score,
      ddReportFixture,
      competitorsFixture,
      gapFixture,
      3
    )

    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.length).toBeLessThanOrEqual(3)
    expect(suggestions[0].refinedIdeaText.toLowerCase()).toContain("specifically for")
    expect(suggestions[0].estimatedLift).toBeGreaterThan(0)
  })
})

describe("computeReadinessScore uniqueness threat weighting", () => {
  it("does not over-penalize when most competitors are weak threats", () => {
    const mixedCompetitors: Competitor[] = [
      {
        name: "DirectA",
        description: "very similar",
        similarityScore: 90,
        topComplaints: [],
        keyDifferentiators: [],
        source: "web_search",
        websiteStatus: "verified",
        confidenceLevel: "multi_confirmed",
      },
      {
        name: "Weak1",
        description: "loosely related",
        similarityScore: 85,
        topComplaints: [],
        keyDifferentiators: [],
        source: "web_search",
        websiteStatus: "mismatch",
        confidenceLevel: "ai_inferred",
      },
      {
        name: "Weak2",
        description: "loosely related",
        similarityScore: 80,
        topComplaints: [],
        keyDifferentiators: [],
        source: "web_search",
        websiteStatus: "dead",
        confidenceLevel: "ai_inferred",
      },
    ]

    const score = computeReadinessScore(ddReportFixture, "high", mixedCompetitors, gapFixture)
    const uniq = score.breakdown.find((b) => b.factor === "Uniqueness")
    expect(uniq).toBeTruthy()
    // Ensure weak-threat-heavy overlap doesn't collapse uniqueness.
    expect((uniq?.score ?? 0)).toBeGreaterThanOrEqual(2)
    expect(uniq?.detail.toLowerCase()).toContain("threat-weighted")
    expect((uniq?.explanation || "").toLowerCase()).toContain("direct-threat-adjusted")
  })
})
