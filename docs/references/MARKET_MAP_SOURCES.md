# Market Map Source Inventory

Last reviewed: 2026-02-17
Owner: Platform

## High-priority (ingestable now)

1. AI Native Dev Landscape
- URL: https://github.com/AI-Native-Dev-Community/ai-native-dev-landscape
- Format: YAML (`tools-data.yaml`)
- License: MIT
- Approx size: ~370 tools
- Status: integrated in `scripts/import-sources.mjs`

2. Awesome AI Market Maps
- URL: https://github.com/joylarkin/Awesome-AI-Market-Maps
- Format: CSV (`ai_market_maps.csv`)
- License: MIT
- Approx size: 398 rows (398 unique URLs)
- Status: integrated in `scripts/import-sources.mjs`

3. Hugging Face mirror (Joy Larkin)
- URL: https://huggingface.co/datasets/joylarkin/2026AIMarketMaps
- Format: CSV (`ai_market_maps19012026.csv`)
- License: MIT
- Approx size: 398 rows
- Status: integrated in `scripts/import-sources.mjs`

## High-value (restricted / policy-gated)

4. CNCF Landscape
- URL: https://landscape.cncf.io
- Format: embedded JSON (`window.baseDS`)
- Approx size: 2,332 items
- Legal note: landscape includes Crunchbase terms text for usage; keep restricted until policy allows.
- Status: integrated with `legal.restricted=true` in `scripts/import-sources.mjs`

5. Linux Foundation landscape network
- Registry: https://github.com/cncf/landscapeapp/blob/master/landscapes.yml
- Approx size: 18 landscape repos
- Format: mostly `landscape.yml`
- License: mostly Apache-2.0/MIT, verify per repo
- Status: next connector batch

## Reference-only (taxonomy/benchmark)

6. KeywordsAI Market Map
- URL: https://www.keywordsai.co/market-map
- Notes: useful structure reference; add connector after legal/robots review.

7. FirstMark MAD Landscape
- URL: https://mad.firstmark.com
- Notes: useful benchmark reference; assess extraction feasibility and policy.

## Methodology standards (scoring/governance)

- Gartner Magic Quadrant
- Forrester Wave
- G2 Grid
- IDC MarketScape
