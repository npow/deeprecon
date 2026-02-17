# Browser Validation Protocol

Last reviewed: 2026-02-17
Owner: Platform

## Purpose
Ensure features are validated in a real browser path, not only unit tests.

## Required Checks
- Homepage renders without runtime error.
- Maps page renders and returns non-error body.
- Scans page renders and returns non-error body.

## Local Run
1. Start app: `npm run build && npm run start -- --port 3100`
2. Run smoke check: `BROWSER_BASE_URL=http://127.0.0.1:3100 npm run test:browser`
3. Inspect screenshots under `artifacts/browser-smoke/`.

## CI Run
Quality gates run this in CI with Chromium installed.
