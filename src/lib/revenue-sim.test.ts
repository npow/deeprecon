import { describe, it, expect } from "vitest"
import { parseMonthlyPrice, parseCacFromText, parseGrossMargin, parseChurnRate, simulateRevenue } from "./revenue-sim"
import type { DDReport } from "./types"

// ─── Parser tests ───

describe("parseMonthlyPrice", () => {
  it("parses $49/mo", () => {
    expect(parseMonthlyPrice("$49/mo")).toBe(49)
  })
  it("parses $99/month", () => {
    expect(parseMonthlyPrice("$99/month")).toBe(99)
  })
  it("parses $29 per month", () => {
    expect(parseMonthlyPrice("$29 per month")).toBe(29)
  })
  it("parses $499/yr and divides by 12", () => {
    const result = parseMonthlyPrice("$499/yr")!
    expect(result).toBeCloseTo(499 / 12, 1)
  })
  it("parses $1,200/year and divides by 12", () => {
    const result = parseMonthlyPrice("$1,200/year")!
    expect(result).toBe(100)
  })
  it("parses plain $49", () => {
    expect(parseMonthlyPrice("$49")).toBe(49)
  })
  it("parses large plain amount as annual", () => {
    // > 500 assumed annual
    expect(parseMonthlyPrice("$600")).toBe(50)
  })
  it("returns null for empty string", () => {
    expect(parseMonthlyPrice("")).toBeNull()
  })
  it("returns null for unparseable text", () => {
    expect(parseMonthlyPrice("free forever")).toBeNull()
  })
  it("handles non-string inputs safely", () => {
    expect(parseMonthlyPrice({ amount: "$49/mo" })).toBeNull()
    expect(parseMonthlyPrice(99)).toBeNull()
    expect(parseMonthlyPrice(null)).toBeNull()
  })
})

describe("parseCacFromText", () => {
  it("parses $50 from text", () => {
    expect(parseCacFromText("$50 CAC")).toBe(50)
  })
  it("parses $200", () => {
    expect(parseCacFromText("Estimated $200 per customer")).toBe(200)
  })
  it("returns null for empty", () => {
    expect(parseCacFromText("")).toBeNull()
  })
  it("returns null for no dollar amount", () => {
    expect(parseCacFromText("low cost organic")).toBeNull()
  })
  it("handles non-string inputs safely", () => {
    expect(parseCacFromText({ estimated: "$120" })).toBeNull()
    expect(parseCacFromText(45)).toBeNull()
    expect(parseCacFromText(undefined)).toBeNull()
  })
})

describe("parseGrossMargin", () => {
  it("parses 70% margins", () => {
    expect(parseGrossMargin("70% margins")).toBe(0.70)
  })
  it("parses 85% gross margin", () => {
    expect(parseGrossMargin("85% gross margin")).toBe(0.85)
  })
  it("returns null for empty", () => {
    expect(parseGrossMargin("")).toBeNull()
  })
  it("handles non-string inputs safely", () => {
    expect(parseGrossMargin({ value: "80%" })).toBeNull()
    expect(parseGrossMargin(70)).toBeNull()
    expect(parseGrossMargin(null)).toBeNull()
  })
})

describe("parseChurnRate", () => {
  it("parses churn percentages", () => {
    expect(parseChurnRate("5% churn")).toBe(0.05)
  })
  it("handles non-string inputs safely", () => {
    expect(parseChurnRate({ monthly: "3% churn" })).toBeNull()
    expect(parseChurnRate(2)).toBeNull()
    expect(parseChurnRate(null)).toBeNull()
  })
})

// ─── Simulation tests ───

function makeDDReport(overrides: Partial<DDReport> = {}): DDReport {
  return {
    idealCustomerProfile: {
      summary: "SMB founders",
      demographics: "25-45 year olds",
      psychographics: "ambitious",
      behaviors: "build things",
      painPoints: ["pain1"],
      willingness_to_pay: "$50/mo",
    },
    problemSeverity: { score: 7, frequency: "daily", alternatives: "spreadsheets", evidenceSummary: "evidence" },
    wedgeStrategy: { wedge: "wedge", whyThisWorks: "works", firstCustomers: "founders", expansionPath: "expand" },
    tamSamSom: {
      tam: { value: "$5B", methodology: "top down" },
      sam: { value: "$500M", methodology: "filter" },
      som: { value: "$50M", methodology: "bottoms up" },
    },
    businessModel: {
      recommendedModel: "SaaS",
      pricingStrategy: "$49/mo per seat, with enterprise tier at $199/mo",
      unitEconomics: "70% gross margin with positive unit economics",
      comparables: "Similar to Notion",
    },
    defensibility: { moatType: "data", timeToMoat: "18 months", strengthAssessment: "moderate", risks: "competition" },
    goToMarket: {
      channels: [
        { channel: "Content Marketing", rationale: "organic", estimatedCac: "$30" },
        { channel: "Product Hunt", rationale: "launch", estimatedCac: "$0" },
        { channel: "LinkedIn Ads", rationale: "targeted", estimatedCac: "$100" },
      ],
      firstMilestone: "100 users",
    },
    risksMitigations: [
      { risk: "competition", likelihood: "medium", impact: "medium", mitigation: "differentiate" },
    ],
    portersFiveForces: {
      competitiveRivalry: { intensity: "high", reasoning: "many players" },
      threatOfNewEntrants: { level: "high", reasoning: "low barriers" },
      threatOfSubstitutes: { level: "medium", reasoning: "some alternatives" },
      buyerPower: { level: "medium", reasoning: "many options" },
      supplierPower: { level: "low", reasoning: "commoditized" },
      overallAttractiveness: "moderate",
    },
    jobsToBeDone: {
      primaryJob: "validate idea",
      functionalAspects: "analyze market",
      emotionalAspects: "confidence",
      socialAspects: "impress investors",
      currentHiredSolutions: ["manual research"],
      underservedOutcomes: ["speed"],
    },
    strategyCanvas: {
      competitiveFactors: [],
      blueOceanMoves: [],
    },
    ...overrides,
  }
}

describe("simulateRevenue", () => {
  it("parses ARPU from pricing strategy", () => {
    const sim = simulateRevenue(makeDDReport(), "moderate")
    expect(sim.arpu).toBe(49)
    expect(sim.parsed.arpuSource).toBe("pricing strategy")
  })

  it("falls back to willingness_to_pay for ARPU", () => {
    const dd = makeDDReport({
      businessModel: {
        recommendedModel: "SaaS",
        pricingStrategy: "freemium model with premium tier",
        unitEconomics: "positive",
        comparables: "N/A",
      },
    })
    const sim = simulateRevenue(dd, "moderate")
    expect(sim.arpu).toBe(50) // from willingness_to_pay
  })

  it("falls back to SOM-derived estimate when no pricing", () => {
    const dd = makeDDReport({
      businessModel: {
        recommendedModel: "SaaS",
        pricingStrategy: "freemium model",
        unitEconomics: "positive",
        comparables: "N/A",
      },
      idealCustomerProfile: {
        summary: "founders",
        demographics: "",
        psychographics: "",
        behaviors: "",
        painPoints: [],
        willingness_to_pay: "unclear",
      },
    })
    const sim = simulateRevenue(dd, "moderate")
    expect(sim.parsed.arpuSource).toBe("SOM-derived estimate")
  })

  it("generates 36 months of data per scenario", () => {
    const sim = simulateRevenue(makeDDReport(), "moderate")
    expect(sim.scenarios).toHaveLength(3)
    expect(sim.scenarios[0].months).toHaveLength(36)
    expect(sim.scenarios[1].months).toHaveLength(36)
    expect(sim.scenarios[2].months).toHaveLength(36)
  })

  it("labels scenarios correctly", () => {
    const sim = simulateRevenue(makeDDReport(), "moderate")
    expect(sim.scenarios.map((s) => s.label)).toEqual(["Conservative", "Base", "Aggressive"])
  })

  it("aggressive scenario grows faster than conservative", () => {
    const sim = simulateRevenue(makeDDReport(), "moderate")
    const conservativeM12 = sim.scenarios[0].months[11].customers
    const aggressiveM12 = sim.scenarios[2].months[11].customers
    expect(aggressiveM12).toBeGreaterThan(conservativeM12)
  })

  it("customers never go negative", () => {
    const sim = simulateRevenue(makeDDReport(), "red_ocean")
    for (const scenario of sim.scenarios) {
      for (const m of scenario.months) {
        expect(m.customers).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("handles zero SOM gracefully", () => {
    const dd = makeDDReport({
      tamSamSom: {
        tam: { value: "unknown", methodology: "" },
        sam: { value: "unknown", methodology: "" },
        som: { value: "unknown", methodology: "" },
      },
    })
    const sim = simulateRevenue(dd, "moderate")
    expect(sim.scenarios).toHaveLength(3)
    expect(sim.som).toBe(0)
  })

  it("warns about unit economics when LTV:CAC < 1", () => {
    const dd = makeDDReport({
      goToMarket: {
        channels: [{ channel: "Google Ads", rationale: "paid", estimatedCac: "$5000" }],
        firstMilestone: "10 users",
      },
    })
    const sim = simulateRevenue(dd, "moderate")
    const hasWarning = sim.warnings.some((w) => w.includes("unit economics"))
    expect(hasWarning).toBe(true)
  })

  it("calculates break-even month", () => {
    const sim = simulateRevenue(makeDDReport(), "low")
    const base = sim.scenarios[1]
    // With low competition and decent economics, should eventually break even
    if (base.breakEvenMonth !== null) {
      expect(base.breakEvenMonth).toBeGreaterThan(0)
      expect(base.breakEvenMonth).toBeLessThanOrEqual(36)
    }
  })
})
