# Browser Validation Protocol

Last reviewed: 2026-02-17
Owner: Platform

## Purpose
Ensure features are validated in a real browser path, not only unit tests.

## Required Checks
- Homepage renders without runtime error.
- Maps page renders and returns non-error body.
- Scans page renders and returns non-error body.
- Deep-dive scan page renders and all report tabs are reachable.
- Deep-link actions (`Generate in Lovable`, `Generate in Bolt`) open valid external destinations.
- Before committing UI/API changes, run a Chrome DevTools MCP pass and confirm no console/runtime errors on changed flows.

## DevTools MCP (Required Pre-Commit for UI/API Changes)
- MCP server: `chrome-devtools-mcp` (configured in Codex MCP as `chrome-devtools`).
- Minimum pre-commit sweep:
  - Open `/`, `/maps`, and `/scans`.
  - Open one scan detail page (`/scans/:id`) and verify all tabs:
    - `Deep Dive`
    - `Pivots`
    - `Gap Analysis`
    - `Threat Assessment`
  - Verify `Generate in Lovable` opens `lovable.dev` in a new tab.
  - Verify `Generate in Bolt` opens `bolt.new` in a new tab.
  - Verify page load completes and no uncaught exceptions appear.
  - Verify changed interactions complete without console errors.
  - Capture a short validation note in the commit/PR summary.
- If MCP is unavailable in-session, restart Codex so MCP servers reload, then run the sweep before commit.

## Local Run
1. Start app: `npm run build && npm run start -- --port 3100`
2. Run smoke check: `BROWSER_BASE_URL=http://127.0.0.1:3100 npm run test:browser`
3. Inspect screenshots under `artifacts/browser-smoke/`.

## CI Run
Quality gates run this in CI with Chromium installed.
