# Golden Principles

Last reviewed: 2026-02-17
Owner: Platform

## Engineering Taste and Entropy Control
- Prefer explicit contracts over implicit convention.
- Keep files small and focused; split files over 500 LOC unless justified.
- Remove dead scripts and stale docs continuously.
- Keep provider architecture centralized.
- Fail closed on missing contracts and structural checks.
- Favor fast, repeatable, automated checks over manual review.

## Garbage Collection Loop
- Run `npm run entropy:check` before merge windows.
- Run scheduled cleanup scan weekly via workflow.
- Track and burn down TODO/FIXME debt from script output.
