# Architecture

Last reviewed: 2026-02-17
Owner: Platform

## System Shape
- UI: Next.js App Router pages and components under `src/app` and `src/components`.
- API orchestration: route handlers under `src/app/api`.
- Domain logic: `src/lib`.
- Operational scripts: `scripts`.
- Contracts and process docs: `docs`.
- Persistence normalization: `saveMap` and `saveScan` must persist `logoUrl` for players/competitors when a `websiteUrl` exists.

## Layer Contracts
- `src/components` may not import from `src/app/api` or `scripts`.
- `src/app/api` may import from `src/lib` but not from `src/components`.
- `scripts` may import shared logic from `src/lib` only when deterministic and side-effect safe.
- Provider definitions must come from `src/lib/provider-catalog.ts` in app/runtime paths.

## Provider Architecture
- Single source of truth: `src/lib/provider-catalog.ts`.
- Runtime fanout engine: `src/lib/research.ts`.
- Scan model pool: `src/lib/ai/pipeline.ts` via provider catalog exports.
- Any provider/model addition requires:
  1. Catalog update.
  2. Architecture contract check pass.
  3. Docs update in `docs/references/PROVIDER_MODEL.md`.

## Enforced Gates
- Contracts: `npm run quality:contracts`.
- Docs contracts: `npm run docs:contracts`.
- Architecture contracts: `npm run architecture:contracts`.
- Entropy check: `npm run entropy:check`.
- Policy tests: `npm run test:policy`.
- Browser smoke: `npm run test:browser`.
