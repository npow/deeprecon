<div align="center">

# DeepRecon

**Competitive intelligence and market mapping for startup founders.**

See where the opportunities are before you build.

[Getting Started](#getting-started) · [Features](#features) · [Architecture](#architecture) · [Contributing](#contributing)

</div>

---

## What is DeepRecon?

DeepRecon is an AI-powered competitive intelligence platform that helps startup founders discover market opportunities and validate ideas. It pre-computes interactive landscape maps across startup verticals, scores white-space opportunities, and generates deep-dive due diligence reports.

**Two modes of use:**

1. **Browse** — Explore pre-computed market maps across verticals (AI/ML, Fintech, DevTools, etc.) to find gaps before you even have an idea
2. **Scan** — Paste a startup idea and get a full competitive analysis with landscape, gap analysis, VC-grade DD report, and pivot suggestions

## Features

### Market Maps

- **Vertical landscapes** with all major players, funding flows, and sub-category taxonomy
- **Crowdedness Score** (0-100) per sub-vertical — composite of player count, funding deployed, and recent entry rate
- **Opportunity Score** — composite of gap density, complaint volume, funding gaps, and trend growth
- **5 visualization modes** — Landscape cards, Quadrant matrix, Strategy Canvas, Opportunity Scatter, and Grid view
- **Sub-category deep dives** — drill into any segment to see every player with funding, team size, and trend signals

### Multi-Provider Parallel Research

- Fans out to **11+ AI providers** simultaneously (Claude, GPT-5, Gemini, DeepSeek, Qwen, GLM, Kimi)
- Each provider's results are **merged incrementally** — data saves to disk as each provider completes
- Real-time SSE progress tracking with per-provider status, token counts, and phase indicators
- Automatic deduplication of players and sub-categories across providers
- Optional `deerflow` deep-research sidecar can run in addition to browser-based providers when `DEERFLOW_URL` is set

### Competitive Scans

- **5-stage pipeline**: intent extraction → competitive analysis → gap analysis → DD report → pivot suggestions
- Full DD report covering ICP, problem severity, wedge strategy, TAM/SAM/SOM, business model, defensibility, and GTM
- Multi-layer scoring: **Readiness**, **Lucrativeness**, **Validation**, and blended **Opportunity** score
- Validation gating: pass/watch/fail guardrails for distribution access, buyer budget fit, evidence quality, and live demand signals
- Configurable depth (quick/standard/deep) and competitor count
- Markdown export (copy or download)

### Turbo Populate

- One-click bulk generation of all vertical maps
- Optional vertical discovery — AI proposes new verticals you haven't mapped yet
- Parallel generation + enrichment with concurrency control

## Getting Started

### Prerequisites

- Node.js 18+
- An API key for at least one AI provider

### Setup

```bash
# Clone the repo
git clone https://github.com/your-username/recon.git
cd recon

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

Edit `.env` with your API keys:

```bash
# Required — at least one AI provider
ANTHROPIC_API_KEY=your-anthropic-api-key
GEMINI_API_KEY=your-gemini-api-key
```

Postgres persistence (recommended):

```bash
# Preferred
DATABASE_URL=postgres://user:password@host:5432/dbname

# Or standard PG* vars
PGHOST=host
PGPORT=5432
PGUSER=user
PGPASSWORD=password
PGDATABASE=dbname
```

When Postgres is configured, DeepRecon persists maps, DD scans, scan jobs, and feed data in Postgres.  
When Postgres is not configured, it falls back to local JSON files under `data/`.

Redis throttling (recommended for production):

```bash
REDIS_URL=redis://localhost:6379
SCAN_REDIS_PREFIX=deeprecon
SCAN_QUEUE_POLL_MS=250
```

With Redis configured, scan rate limits and queue throttling survive app restarts/deployments.

### Run

```bash
# Development
npm run dev

# Production build
npm run build && npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
src/
├── app/
│   ├── page.tsx                      # Landing page + scan interface
│   ├── maps/
│   │   ├── page.tsx                  # Vertical grid with stats
│   │   └── [slug]/
│   │       ├── page.tsx              # Vertical detail (5 viz tabs)
│   │       └── [subSlug]/page.tsx    # Sub-category deep dive
│   └── api/
│       ├── scan/route.ts             # 5-stage scan pipeline (SSE)
│       └── maps/
│           ├── route.ts              # List verticals
│           ├── [slug]/
│           │   ├── route.ts          # Get/refresh vertical map (SSE)
│           │   └── enrich/route.ts   # Enrich sub-categories (SSE)
│           └── turbo/route.ts        # Bulk generate all maps (SSE)
├── components/
│   ├── maps/                         # Map visualizations + controls
│   └── results/                      # Scan result tabs
├── hooks/
│   ├── use-providers.ts              # Provider selection state
│   └── use-refresh-jobs.ts           # Multi-job SSE progress tracker
└── lib/
    ├── ai/
    │   ├── pipeline.ts               # AI orchestration functions
    │   └── prompts.ts                # System prompts
    ├── research.ts                   # Multi-provider parallel engine
    ├── db.ts                         # Postgres connection + schema bootstrap
    ├── maps-store.ts                 # Map persistence (Postgres primary, file fallback)
    ├── scans-store.ts                # DD scan + feed persistence
    ├── scan-jobs-store.ts            # Scan job lifecycle persistence
    ├── verticals-store.ts            # Vertical registry persistence
    ├── enrich.ts                     # Enrichment merge logic
    ├── types.ts                      # TypeScript interfaces
    └── utils.ts                      # Helpers
```

### Key Patterns

- **SSE streaming** on all generation endpoints — real-time progress from server to client
- **Incremental merging** — each provider's results save immediately, no waiting for all to finish
- **Postgres-backed persistence** — maps, scans, feed summaries, and scan jobs persist in Postgres when configured
- **Local file fallback** — JSON files under `/data/` are used only when DB env vars are not configured
- **Parallel fanout** — single prompt sent to multiple LLM providers via OpenAI-compatible proxy, results deduplicated and merged
- **Relay observability** — route-level request/response/error telemetry with request IDs and automatic feature tagging
- **Outbound req/resp telemetry** — all server-side `fetch` calls are logged with duration, status, host, and inferred provider

### Telemetry Sinks

- `TELEMETRY_SINKS=ndjson` (default) writes JSON lines to `data/telemetry/events.ndjson`
- `TELEMETRY_SINKS=console` logs structured events to stdout
- `TELEMETRY_SINKS=betterstack` ships structured events to Better Stack ingest
- `TELEMETRY_SINKS=console,ndjson,betterstack` enables multiple sinks
- `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>` adds auth headers for OTLP trace export (Grafana Cloud, Better Stack, etc.)

### Sentry

- Install + configure with `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (client).
- Optional build upload settings: `SENTRY_ORG` and `SENTRY_PROJECT`.
- Runtime sampling: `SENTRY_TRACES_SAMPLE_RATE` and `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`.
## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 15](https://nextjs.org) (App Router) + React 19 |
| Styling | [Tailwind CSS](https://tailwindcss.com) |
| AI | [Anthropic Claude](https://anthropic.com) + [Google Gemini](https://ai.google.dev) + multi-provider proxy |
| Charts | [Recharts](https://recharts.org) |
| Icons | [Lucide](https://lucide.dev) |
| Language | TypeScript |

## Harness Enforcement

- Docs contracts: `npm run docs:contracts`
- Architecture contracts: `npm run architecture:contracts`
- Entropy guard: `npm run entropy:check`
- Browser smoke validation: `npm run test:browser`
- Autonomous iteration loop: `npm run iterate:autonomous`

These gates are enforced in `.github/workflows/quality-gates.yml`.

## Roadmap

- [ ] Auth + saved scans (Supabase)
- [ ] Crunchbase API integration for real funding data
- [ ] Reddit API for demand signals
- [ ] PDF export
- [ ] Weekly monitoring alerts
- [ ] Battle cards and board briefs
- [ ] Stripe payments

## License

MIT

---

<div align="center">
Built with Claude, Gemini, and a mass hallucination of funding data.
</div>
