# Harness Learnings Checklist

Last reviewed: 2026-02-17
Owner: Platform

This checklist maps each learning area in OpenAI's "Harness engineering" article (published May 16, 2025) to concrete repo controls.

## 1) Start from an empty repo with constrained context
Applied:
- Repository-local system map in `AGENTS.md` and `ARCHITECTURE.md`.
- No hidden state dependency for core quality checks.

## 2) Build docs as primary memory and make them easy for agents to read
Applied:
- Root docs index and section indexes: `docs/INDEX.md`, `docs/*/INDEX.md`.
- Core canonical docs: `docs/DESIGN.md`, `docs/FRONTEND.md`, `docs/PLANS.md`, `docs/PRODUCT_SENSE.md`, `docs/QUALITY_SCORE.md`, `docs/RELIABILITY.md`, `docs/SECURITY.md`.
- Contract enforcement: `scripts/docs-contract-check.mjs`.

## 3) Encode architecture as rigid, explicit constraints
Applied:
- Architecture contract: `ARCHITECTURE.md`.
- Provider contract: `docs/references/PROVIDER_MODEL.md`.
- Enforcer: `scripts/architecture-contract-check.mjs`.

## 4) Make docs and structure index-style and navigable
Applied:
- Mandatory indexes in `docs/INDEX.md` and each docs subtree.
- Docs contract requires indexes to exist.

## 5) Increase app legibility with browser-level validation
Applied:
- Browser smoke harness: `scripts/browser-smoke.mjs`.
- CI browser execution in `.github/workflows/quality-gates.yml`.
- Validation protocol: `docs/references/BROWSER_VALIDATION.md`.

## 6) Increase app legibility with observability and telemetry
Applied:
- Telemetry instrumentation: `src/lib/telemetry.ts`.
- Telemetry reporting: `scripts/scan-telemetry-report.mjs`.
- Reliability docs: `docs/RELIABILITY.md`.

## 7) Raise autonomy in controlled stages
Applied:
- Iteration loop: `scripts/agent-iteration-loop.mjs`.
- Autonomy policy: `docs/references/AUTONOMY.md`.

## 8) Keep merge throughput high while maintaining quality bars
Applied:
- Lane/worktree parallel model: `scripts/lane-start.sh`, `scripts/lane-stop.sh`, `scripts/lane-status.sh`.
- Merge model docs: `docs/references/MERGE_PHILOSOPHY.md`, `docs/agent-contracts/PARALLEL_EXECUTION.md`.

## 9) Make quality checks mechanical and non-optional
Applied:
- Quality workflow: `.github/workflows/quality-gates.yml`.
- Required checks: contracts + docs + architecture + entropy + policy + tests + build + browser smoke.

## 10) Treat entropy reduction as continuous garbage collection
Applied:
- Golden principles: `docs/quality/GOLDEN_PRINCIPLES.md`.
- Entropy scanner: `scripts/entropy-check.mjs`.
- Scheduled cleanup workflow: `.github/workflows/repo-gc.yml`.

## 11) Convert human review insights into reusable mechanisms
Applied:
- Quality contracts and docs contracts codify review requirements.
- Provider architecture centralization in `src/lib/provider-catalog.ts` reduces drift.

## 12) Redefine engineer role around harness building
Applied:
- Role contract: `docs/references/ENGINEER_ROLE.md`.
- Engineer-owned harness controls encoded as scripts and CI.
