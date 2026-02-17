import { describe, it, expect } from "vitest"
import { computeOpportunityScore } from "./opportunity-score"
import type { ValidationScore } from "./validation-score"

function makeValidationScore(overrides: Partial<ValidationScore> = {}): ValidationScore {
  return {
    total: 70,
    tier: "high",
    hasLiveSignals: true,
    gate: { status: "pass", reasons: [] },
    breakdown: [],
    verdict: "ok",
    ...overrides,
  }
}

describe("computeOpportunityScore", () => {
  it("uses 35/35/30 weighting when live validation signals exist", () => {
    const validation = makeValidationScore({ hasLiveSignals: true, total: 80 })
    const result = computeOpportunityScore(70, 60, validation)
    expect(result.weights).toEqual({ readiness: 0.35, lucrativeness: 0.35, validation: 0.30 })
    expect(result.total).toBe(70)
  })

  it("reweights to readiness+lucrativeness when no live validation signals exist", () => {
    const validation = makeValidationScore({ hasLiveSignals: false, total: 20, gate: { status: "watch", reasons: ["no signals"] } })
    const result = computeOpportunityScore(80, 70, validation)
    expect(result.weights).toEqual({ readiness: 0.5, lucrativeness: 0.5, validation: 0 })
    expect(result.total).toBe(70)
  })

  it("applies gate penalties for failed validation gates", () => {
    const validation = makeValidationScore({ hasLiveSignals: true, gate: { status: "fail", reasons: ["weak distribution"] } })
    const result = computeOpportunityScore(80, 80, validation)
    expect(result.total).toBe(65)
    expect(result.verdict).toContain("Validation gate: fail")
  })
})
