# Provider Model Contract

Last reviewed: 2026-02-17
Owner: Platform

## Contract
- Canonical provider definitions live in `src/lib/provider-catalog.ts`.
- Runtime provider fanout uses `src/lib/research.ts`.
- Scan model pool composition uses `src/lib/ai/pipeline.ts` via catalog imports.

## Change Protocol
1. Update the provider catalog.
2. Run `npm run architecture:contracts`.
3. Run `npm run test`.
4. Update this document if model semantics changed.
