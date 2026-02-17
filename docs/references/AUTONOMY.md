# Autonomy Model

Last reviewed: 2026-02-17
Owner: Platform

## Autonomous Loop
- Iteration command: `npm run iterate:autonomous`
- Loop includes contract checks, tests, and optional adversarial + browser validation.

## Escalation Policy
Escalate to human only when:
- requirements are ambiguous,
- policy constraints conflict,
- or environment dependencies are unavailable.
