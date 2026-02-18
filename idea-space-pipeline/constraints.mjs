import { axisOrder } from './taxonomy.mjs';

function has(tuple, axis, value) {
  return tuple[axisOrder.indexOf(axis)] === value;
}

function oneOf(tuple, axis, values) {
  return values.includes(tuple[axisOrder.indexOf(axis)]);
}

const invalidComboRules = [
  {
    id: 'policy_needs_regulation_like_evidence',
    why: 'Policy analysis is low-signal without policy-adjacent evidence.',
    test: (tuple) =>
      has(tuple, 'method', 'policy_analysis') &&
      !oneOf(tuple, 'evidence', ['regulations', 'public_procurement', 'earnings_calls']),
  },
  {
    id: 'clinical_trials_should_be_health_or_bio',
    why: 'Clinical trial evidence should map to healthcare or biosecurity domains.',
    test: (tuple) =>
      has(tuple, 'evidence', 'clinical_trials') &&
      !oneOf(tuple, 'domain', ['healthcare_ai', 'biosecurity']),
  },
  {
    id: 'hospitals_should_stay_health_related',
    why: 'Hospital populations are constrained to healthcare contexts.',
    test: (tuple) =>
      has(tuple, 'population', 'hospitals') &&
      !oneOf(tuple, 'domain', ['healthcare_ai', 'public_sector_ai']),
  },
  {
    id: 'incident_analysis_prefers_incident_like_evidence',
    why: 'Incident analysis should use incident-like evidence.',
    test: (tuple) =>
      has(tuple, 'method', 'incident_analysis') &&
      !oneOf(tuple, 'evidence', ['production_incidents', 'public_procurement']),
  },
  {
    id: 'causal_inference_requires_quant_signal',
    why: 'Causal inference requires data with measurable outcomes.',
    test: (tuple) =>
      has(tuple, 'method', 'causal_inference') &&
      !oneOf(tuple, 'evidence', ['papers', 'market_data', 'clinical_trials', 'benchmarks']),
  },
  {
    id: 'benchmarking_requires_benchmarkable_evidence',
    why: 'Benchmarking should rely on benchmarkable artifacts.',
    test: (tuple) =>
      has(tuple, 'method', 'benchmarking') &&
      !oneOf(tuple, 'evidence', ['benchmarks', 'papers', 'production_incidents']),
  },
  {
    id: 'public_sector_population_prefers_public_or_regulatory_evidence',
    why: 'Public sector work should include public evidence channels.',
    test: (tuple) =>
      has(tuple, 'population', 'public_sector') &&
      !oneOf(tuple, 'evidence', ['regulations', 'public_procurement', 'papers']),
  },
  {
    id: 'short_horizon_policy_recommendation_needs_policy_method',
    why: 'Policy recommendation objective needs policy-centric method in short horizons.',
    test: (tuple) =>
      oneOf(tuple, 'time_horizon', ['6_months', '12_months']) &&
      has(tuple, 'objective', 'policy_recommendation') &&
      !oneOf(tuple, 'method', ['policy_analysis', 'comparative_case_study']),
  },
];

export function validateTuple(tuple) {
  const violations = invalidComboRules.filter((rule) => rule.test(tuple));
  return {
    valid: violations.length === 0,
    violations,
  };
}

export { invalidComboRules };
