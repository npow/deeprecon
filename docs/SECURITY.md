# Security

Last reviewed: 2026-02-17
Owner: Platform

## Secret Handling
- Runtime secrets are sourced from environment files/secrets.
- Deploy workflow injects runtime secrets at deploy time.

## Guardrails
- Never commit production secrets.
- Keep `.env.example` and `.env.production.example` current.
