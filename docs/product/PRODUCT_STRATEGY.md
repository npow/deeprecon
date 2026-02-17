# Product Strategy (Agent-Driven)

Last reviewed: 2026-02-17
Owner: Product

## North Star
Recon should be the fastest path from rough idea to decision-quality strategy, with scores that are realistic and action-driving.

## Core Promise
- If the idea is copycat, vague, or price-only: score should be constrained and explain why.
- If the idea has a sharp wedge: score should surface that advantage and concrete next actions.
- Every recommendation should be runnable (buttons/workflows), not just text.

## Target Outcomes (30 days)
- 0 high-severity scoring regressions in adversarial suite.
- 95%+ scans finish without stale jobs.
- Median scan latency stable while maintaining quality.
- Feed and detail views consistently explain score rationale (clone risk, evidence, lucrativeness, validation, opportunity).

## Product Roadmap Priorities
1. Scoring realism and interpretability.
2. Orchestration reliability (queue/jobs/timeouts).
3. Actionability UX (rescan/optimize loops with explicit expected lift).
4. Continuous benchmark-driven optimization.

## Agent Operating Model
- Every optimization cycle must:
  1) run benchmark suites,
  2) identify failing metrics,
  3) patch only the narrow cause,
  4) re-run, and
  5) persist a changelog entry.
