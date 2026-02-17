import { describe, expect, it } from "vitest"
import { computeReadinessScore } from "./readiness-score"
import type { Competitor, DDReport, GapAnalysis } from "./types"

const strongDd: DDReport = {
  idealCustomerProfile: {
    summary: "Finance leaders at growth-stage B2B companies",
    demographics: "SMB to mid-market companies",
    psychographics: "Cost-sensitive and automation-first",
    behaviors: "Monthly workflow and procurement reviews",
    painPoints: ["Manual workflow bottlenecks", "Lack of visibility"],
    willingness_to_pay: "$200-$1000/mo",
  },
  problemSeverity: {
    score: 8,
    frequency: "daily",
    alternatives: "Manual operations and spreadsheets",
    evidenceSummary: "Operators report recurring delays and avoidable errors",
  },
  wedgeStrategy: {
    wedge: "AI operations copilot for procurement and vendor workflows",
    whyThisWorks: "Removes repetitive manual tasks and shortens cycle time",
    firstCustomers: "Procurement teams at 50-500 employee SaaS companies",
    expansionPath: "Expand to finance + legal workflows",
  },
  tamSamSom: {
    tam: { value: "$12B", methodology: "top-down" },
    sam: { value: "$2.5B", methodology: "bottom-up" },
    som: { value: "$250M", methodology: "bottom-up" },
  },
  businessModel: {
    recommendedModel: "SaaS",
    pricingStrategy: "tiered annual contracts",
    unitEconomics: "strong gross margins and healthy payback",
    comparables: "enterprise workflow tools",
  },
  defensibility: {
    moatType: "workflow data and integration depth",
    timeToMoat: "12-18 months",
    strengthAssessment: "moderate",
    risks: "copycat entrants",
  },
  goToMarket: {
    channels: [
      { channel: "Direct outbound", rationale: "clear buyer persona", estimatedCac: "medium" },
      { channel: "Partner channels", rationale: "reach target ICP", estimatedCac: "low" },
      { channel: "SEO", rationale: "high-intent demand", estimatedCac: "low" },
    ],
    firstMilestone: "10 design partners",
  },
  risksMitigations: [
    { risk: "Long sales cycles", likelihood: "medium", impact: "medium", mitigation: "Narrow ICP and ROI proof" },
  ],
  portersFiveForces: {
    competitiveRivalry: { intensity: "high", reasoning: "Established incumbents exist" },
    threatOfNewEntrants: { level: "medium", reasoning: "Moderate technical barrier" },
    threatOfSubstitutes: { level: "medium", reasoning: "Spreadsheets remain fallback" },
    buyerPower: { level: "high", reasoning: "Many vendor options" },
    supplierPower: { level: "low", reasoning: "Commodity infra" },
    overallAttractiveness: "moderate",
  },
  jobsToBeDone: {
    primaryJob: "Ship compliant vendor approvals quickly",
    functionalAspects: "Automated workflow orchestration",
    emotionalAspects: "Confidence and control",
    socialAspects: "Cross-functional trust",
    currentHiredSolutions: ["Spreadsheets", "ERP modules"],
    underservedOutcomes: ["Fast cycle times", "Auditability"],
  },
  strategyCanvas: {
    competitiveFactors: [],
    blueOceanMoves: ["Deterministic controls", "Automated exception handling"],
  },
}

const broadDd: DDReport = {
  ...strongDd,
  idealCustomerProfile: {
    ...strongDd.idealCustomerProfile,
    summary: "Everyone who uses software",
    demographics: "All businesses",
  },
  wedgeStrategy: {
    ...strongDd.wedgeStrategy,
    wedge: "AI platform for all users and all industries",
  },
}

const competitors: Competitor[] = [
  {
    name: "IncumbentA",
    description: "Large incumbent",
    similarityScore: 86,
    topComplaints: ["Complex setup"],
    keyDifferentiators: ["Brand"],
    source: "web_search",
    websiteStatus: "verified",
    confidenceLevel: "web_verified",
  },
  {
    name: "IncumbentB",
    description: "Large incumbent",
    similarityScore: 82,
    topComplaints: ["Expensive"],
    keyDifferentiators: ["Distribution"],
    source: "web_search",
    websiteStatus: "verified",
    confidenceLevel: "web_verified",
  },
]

const gaps: GapAnalysis = {
  whiteSpaceOpportunities: [
    { opportunity: "SMB-focused workflow", evidence: "Incumbents target enterprise", potentialImpact: "high" },
  ],
  commonComplaints: [
    { complaint: "Too expensive", frequency: "common", competitors: ["IncumbentA"] },
  ],
  unservedSegments: [
    { segment: "SMB operations teams", description: "Need lightweight tooling", whyUnserved: "Enterprise-first product design" },
  ],
}

describe("readiness policy contracts", () => {
  it("caps explicit copycat prompts", () => {
    const score = computeReadinessScore(
      strongDd,
      "moderate",
      competitors,
      gaps,
      "Rippling but cheaper with the same HR + IT automation stack."
    )

    expect(["C", "D", "F"]).toContain(score.grade)
    expect(score.cloneRisk).toBeTruthy()
    expect((score.cloneRisk?.penalty || 0)).toBeGreaterThanOrEqual(14)
  })

  it("penalizes broad unfocused positioning", () => {
    const score = computeReadinessScore(
      broadDd,
      "moderate",
      competitors,
      gaps,
      "AI app for everyone across all industries"
    )

    expect(score.grade).not.toBe("A")
    expect(score.verdict.toLowerCase()).toContain("focus adjustment")
  })

  it("does not force clone risk on differentiated wedge prompts", () => {
    const lowOverlapCompetitors: Competitor[] = [
      {
        name: "LegacySuite",
        description: "Generic enterprise suite",
        similarityScore: 35,
        topComplaints: ["Too complex"],
        keyDifferentiators: ["Brand"],
        source: "web_search",
        websiteStatus: "verified",
        confidenceLevel: "web_verified",
      },
      {
        name: "AdjacentTool",
        description: "Adjacent workflow product",
        similarityScore: 32,
        topComplaints: ["Limited controls"],
        keyDifferentiators: ["Integrations"],
        source: "web_search",
        websiteStatus: "verified",
        confidenceLevel: "web_verified",
      },
    ]

    const score = computeReadinessScore(
      strongDd,
      "moderate",
      lowOverlapCompetitors,
      gaps,
      "Municipal grant compliance OS for nonprofits handling 1-3 grants with evidence capture"
    )

    expect(score.cloneRisk).toBeFalsy()
  })
})
