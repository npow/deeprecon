# Idea Space Pipeline Prototype

Purpose: generate deterministic, non-duplicate research candidates from a bounded idea space.

## What this includes
- `taxonomy.mjs`: versioned axis vocabularies.
- `constraints.mjs`: invalid-combination rules.
- `generator.mjs`: tuple generation, canonical IDs, scoring, and diverse top-K selection.
- `cli.mjs`: command-line entrypoint.
- `export-tasks.mjs`: converts generated selections into task payloads for deep-research executors.
- `llm-ranker.mjs`: LLM bootstrap ranker for shortlist reranking.
- `model.mjs`: ridge + UCB model for online reward-per-token ranking.
- `retrain.mjs`: hourly/daily model retraining from observations.
- `observe.mjs`: write reward observations from completed deep-research runs.
- `db.mjs`: Postgres persistence for runs, seen keys, observations, models, and ranking logs.
- `examples/seen-tuples.json`: example historical runs used to reduce repeat ideas.

## Run
From repository root:

```bash
npm run ideas:generate
```

If DB credentials are present in `.env` (`DATABASE_URL` or `PG*`), runs and seen keys are persisted automatically.

With seen history and custom limit:

```bash
node idea-space-pipeline/cli.mjs --seen idea-space-pipeline/examples/seen-tuples.json --limit 20
```

Write output to file:

```bash
node idea-space-pipeline/cli.mjs --seen idea-space-pipeline/examples/seen-tuples.json --limit 25 --out idea-space-pipeline/examples/candidates.json
```

Export deep-research tasks for an external execution utility:

```bash
npm run ideas:export-tasks -- --input idea-space-pipeline/examples/candidates.json --out idea-space-pipeline/examples/deep-research-tasks.jsonl
```

Force heuristic-only ranking:

```bash
node idea-space-pipeline/cli.mjs --ranker heuristic --limit 20
```

Run LLM ranking with explicit provider/model:

```bash
node idea-space-pipeline/cli.mjs --ranker llm --llm-provider cliproxy --llm-model gpt-5 --limit 20
```

Disable DB persistence for a run:

```bash
node idea-space-pipeline/cli.mjs --db=0 --limit 20
```

Mark completed keys while generating:

```bash
node idea-space-pipeline/cli.mjs --complete-keys "domain=ai_safety|problem=reliability|method=benchmarking|evidence=papers|population=startups|geography=eu|time_horizon=6_months|objective=gap_mapping"
```

Record a completed run observation (for training labels):

```bash
npm run ideas:observe -- --key "domain=ai_safety|problem=reliability|method=benchmarking|evidence=papers|population=startups|geography=eu|time_horizon=6_months|objective=gap_mapping" --token-cost 220000 --proxy-score 0.71 --deep-score 0.83 --outcome-score 0.6
```

Retrain model from recent observations:

```bash
npm run ideas:retrain
```

## Online Loop (hours/days)
1. Generate candidates (`ideas:generate`), execute deep research on selected tuples.
2. Log outcomes with `ideas:observe` as runs complete.
3. Retrain model every 2-4 hours (`ideas:retrain`) for future model-based ranking.
4. Current default generator ranking is LLM-bootstrap (`--ranker llm`) with heuristic fallback on provider failures.

Objective used for training label:
- `reward_per_token = reward / max(1, token_cost)`
- If `--reward` is omitted, observe script computes:
  - `reward = 0.3*proxy + 0.5*deep + 0.2*outcome - 0.00002*token_cost - 0.0000005*latency_ms`

## How to extend
1. Update axis values in `taxonomy.mjs` (keep values coarse first).
2. Add/adjust rules in `constraints.mjs`.
3. Re-run generation and execute highest-ranked candidates.
4. Mark completed keys with `--complete-keys` (status in DB becomes `completed`).

## Output format
The CLI emits:
- `coverage`: total/valid/invalid cells and seen coverage percent.
- `persistence`: DB run metadata and seen-source counts.
- `ranking`: ranker metadata, shortlist size, and LLM failure fallback info.
- `selection[].ranker`: ranker-side scoring details (LLM score/confidence/reason when available).
- `selection`: ranked candidate tuples with stable IDs and ready-to-run prompt text.
- `selection[].idea`: concrete idea brief (`title`, `researchQuestion`, scope, evidence plan).
- `selection[].deepResearchTask`: execution-ready payload to hand to a deep-research utility.
