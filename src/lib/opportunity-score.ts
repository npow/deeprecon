import type { ValidationScore } from "./validation-score"

export interface OpportunityScore {
  total: number
  tier: "low" | "medium" | "high" | "very_high"
  weights: {
    readiness: number
    lucrativeness: number
    validation: number
  }
  inputs: {
    readiness: number
    lucrativeness: number
    validation: number
  }
  verdict: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function tierFromTotal(total: number): OpportunityScore["tier"] {
  if (total >= 80) return "very_high"
  if (total >= 65) return "high"
  if (total >= 45) return "medium"
  return "low"
}

function verdictForTier(tier: OpportunityScore["tier"]): string {
  if (tier === "very_high") return "Top opportunity profile across readiness, economics, and validation."
  if (tier === "high") return "Strong opportunity profile with good upside and execution viability."
  if (tier === "medium") return "Moderate opportunity profile. Improve validation or economics before scaling."
  return "Low opportunity profile. Refine wedge, demand evidence, or ICP before building."
}

export function computeOpportunityScore(
  readinessScore: number,
  lucrativenessScore: number,
  validationScore: ValidationScore,
): OpportunityScore {
  const useValidationWeight = validationScore.hasLiveSignals
  const weights = useValidationWeight
    ? { readiness: 0.35, lucrativeness: 0.35, validation: 0.30 }
    : { readiness: 0.5, lucrativeness: 0.5, validation: 0 }

  let total = Math.round(
    readinessScore * weights.readiness
    + lucrativenessScore * weights.lucrativeness
    + validationScore.total * weights.validation
  )

  if (validationScore.gate.status === "fail") total -= 12
  else if (validationScore.gate.status === "watch") total -= 5

  total = clamp(total, 0, 100)
  const tier = tierFromTotal(total)
  const gateSuffix = validationScore.gate.status === "pass"
    ? ""
    : ` Validation gate: ${validationScore.gate.status}.`

  return {
    total,
    tier,
    weights,
    inputs: {
      readiness: readinessScore,
      lucrativeness: lucrativenessScore,
      validation: validationScore.total,
    },
    verdict: `${verdictForTier(tier)}${gateSuffix}`,
  }
}
