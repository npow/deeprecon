<div align="center">

# Recon

**Competitive intelligence and market mapping for startup founders.**

See where the opportunities are before you build.

[Getting Started](#getting-started) · [Features](#features) · [Architecture](#architecture) · [Contributing](#contributing)

</div>

---

## What is Recon?

Recon is an AI-powered competitive intelligence platform that helps startup founders discover market opportunities and validate ideas. It pre-computes interactive landscape maps across startup verticals, scores white-space opportunities, and generates deep-dive due diligence reports.

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

### Competitive Scans

- **5-stage pipeline**: intent extraction → competitive analysis → gap analysis → DD report → pivot suggestions
- Full DD report covering ICP, problem severity, wedge strategy, TAM/SAM/SOM, business model, defensibility, and GTM
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
    ├── maps-store.ts                 # File-based map persistence
    ├── verticals-store.ts            # Vertical registry
    ├── enrich.ts                     # Enrichment merge logic
    ├── types.ts                      # TypeScript interfaces
    └── utils.ts                      # Helpers
```

### Key Patterns

- **SSE streaming** on all generation endpoints — real-time progress from server to client
- **Incremental merging** — each provider's results save immediately, no waiting for all to finish
- **File-based storage** — maps stored as JSON in `/data/`, no database required
- **Parallel fanout** — single prompt sent to multiple LLM providers via OpenAI-compatible proxy, results deduplicated and merged

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 15](https://nextjs.org) (App Router) + React 19 |
| Styling | [Tailwind CSS](https://tailwindcss.com) |
| AI | [Anthropic Claude](https://anthropic.com) + [Google Gemini](https://ai.google.dev) + multi-provider proxy |
| Charts | [Recharts](https://recharts.org) |
| Icons | [Lucide](https://lucide.dev) |
| Language | TypeScript |

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
