# Frontend

Last reviewed: 2026-02-17
Owner: Frontend

## Validation Requirements
- All frontend changes must pass browser smoke validation.
- Regression checks rely on route-level render and error signal scanning.

## Commands
- `npm run build`
- `BROWSER_BASE_URL=http://127.0.0.1:3100 npm run test:browser`
