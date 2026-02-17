#!/usr/bin/env node
/**
 * ingest-sources.mjs
 *
 * Pull external market-map sources and normalize them into a single candidate schema.
 *
 * Usage:
 *   node scripts/import/ingest-sources.mjs --source ai-native-dev-landscape --dry-run
 *   node scripts/import/ingest-sources.mjs --source all --write
 */

import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const IMPORTS_DIR = path.join(ROOT, "data", "imports")

const args = process.argv.slice(2)
function hasFlag(flag) {
  return args.includes(`--${flag}`)
}
function getFlag(flag, fallback = "") {
  const i = args.indexOf(`--${flag}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const selected = getFlag("source", "all")
const dryRun = hasFlag("dry-run")
const write = hasFlag("write") && !dryRun
const limit = Number(getFlag("limit", "0"))

const NOW = new Date().toISOString()
const DATE = NOW.slice(0, 10)

const KNOWN_SOURCES = [
  "ai-native-dev-landscape",
  "awesome-ai-market-maps",
  "hf-ai-market-maps",
  "cncf-landscape",
]

function log(msg) {
  console.log(`[import-sources] ${msg}`)
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "recon-import-bot/1.0" },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
}

function makeId(parts) {
  return parts
    .filter(Boolean)
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, "-")
}

function parseCsv(csv) {
  const rows = []
  let row = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    const next = csv[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (ch === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }
    if (ch === "\r") continue
    cell += ch
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).filter((r) => r.length > 0).map((r) => {
    const obj = {}
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = (r[i] || "").trim()
    return obj
  })
}

function parseAiNativeYaml(yaml) {
  const lines = yaml.split(/\r?\n/)
  const out = []

  let currentCategory = ""
  let inTools = false
  let tool = null
  let inTags = false

  function finishTool() {
    if (!tool) return
    const name = normalizeName(tool.name)
    if (!name) {
      tool = null
      return
    }

    out.push({
      id: makeId(["ai-native", currentCategory, name]),
      source: "ai-native-dev-landscape",
      sourceType: "landscape_dataset",
      sourceUrl: "https://github.com/AI-Native-Dev-Community/ai-native-dev-landscape",
      license: "MIT",
      capturedAt: NOW,
      entityType: "company",
      name,
      websiteUrl: tool.website_url || "",
      description: (tool.description || "").trim(),
      vertical: "ai-ml",
      category: currentCategory || "Uncategorized",
      subCategory: currentCategory || "Uncategorized",
      tags: Array.isArray(tool.tags) ? tool.tags : [],
      metadata: {
        oss: tool.oss,
        verified: tool.verified,
        popular: tool.popular,
        dateAdded: tool.date_added || "",
      },
      legal: { restricted: false, notes: "MIT" },
    })
    tool = null
  }

  function parseBool(v) {
    if (v === "true") return true
    if (v === "false") return false
    return null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    const maybeCategoryName = line.match(/^\s*name:\s*(.+)$/)
    if (maybeCategoryName) {
      const nearby = lines.slice(i + 1, i + 6).join("\n")
      if (/\n\s*tools:\s*\n?/.test(`\n${nearby}`)) {
        finishTool()
        currentCategory = normalizeName(maybeCategoryName[1])
        inTools = false
        inTags = false
        continue
      }
    }

    if (/^\s*tools:\s*$/.test(line)) {
      inTools = true
      inTags = false
      continue
    }

    if (inTools && /^\s*-\s+description:\s*/.test(line)) {
      finishTool()
      inTools = false
      inTags = false
      continue
    }

    const toolStart = line.match(/^\s*-\s+date_added:\s*(.*)$/)
    if (inTools && toolStart) {
      finishTool()
      tool = { date_added: toolStart[1] || "", tags: [] }
      inTags = false
      continue
    }

    if (!tool) continue

    if (/^\s*tags:\s*$/.test(line)) {
      inTags = true
      continue
    }

    if (inTags) {
      const tag = line.match(/^\s*-\s+(.+)$/)
      if (tag) {
        tool.tags.push(tag[1].trim())
        continue
      }
      inTags = false
    }

    const kv = line.match(/^\s*([a-zA-Z_]+):\s*(.*)$/)
    if (kv) {
      const key = kv[1]
      let value = kv[2] || ""
      value = value.replace(/^['\"]|['\"]$/g, "")

      if (key === "oss" || key === "verified" || key === "popular") {
        tool[key] = parseBool(value)
      } else if (key === "description") {
        const clean = value.replace(/^>\s*/, "")
        tool[key] = clean
      } else {
        tool[key] = value
      }
    }
  }

  finishTool()
  return out
}

async function importAiNative() {
  const url = "https://raw.githubusercontent.com/AI-Native-Dev-Community/ai-native-dev-landscape/main/aind-landing-Page/public/tools-data.yaml"
  const yaml = await fetchText(url)
  return parseAiNativeYaml(yaml)
}

async function importAwesomeAiMarketMapsCsv(url, sourceName, sourceType) {
  const csv = await fetchText(url)
  const rows = parseCsv(csv)

  return rows.map((r, idx) => {
    const link = r.URL || r.url || ""
    const category = r.Category || r.category || "Uncategorized"
    const title = r.Title || r.title || ""

    return {
      id: makeId([sourceName, idx, title, link]),
      source: sourceName,
      sourceType,
      sourceUrl: "https://github.com/joylarkin/Awesome-AI-Market-Maps",
      license: "MIT",
      capturedAt: NOW,
      entityType: "market_map_reference",
      name: normalizeName(title || `Market map ${idx + 1}`),
      websiteUrl: link,
      description: `Author: ${r.Author || r.author || "Unknown"}. Date: ${r.Date || r.date || "Unknown"}.`,
      vertical: "ai-ml",
      category,
      subCategory: category,
      tags: ["market-map", "reference"],
      metadata: {
        author: r.Author || r.author || "",
        publishedAt: r.Date || r.date || "",
      },
      legal: { restricted: false, notes: "MIT index; linked content may have separate terms" },
    }
  })
}

async function importAwesomeAiMarketMaps() {
  return importAwesomeAiMarketMapsCsv(
    "https://raw.githubusercontent.com/joylarkin/Awesome-AI-Market-Maps/main/ai_market_maps.csv",
    "awesome-ai-market-maps",
    "market_map_index",
  )
}

async function importHfAiMarketMaps() {
  return importAwesomeAiMarketMapsCsv(
    "https://huggingface.co/datasets/joylarkin/2026AIMarketMaps/resolve/main/ai_market_maps19012026.csv",
    "hf-ai-market-maps",
    "market_map_index",
  )
}

async function importCncfLandscape() {
  const html = await fetchText("https://landscape.cncf.io")
  const match = html.match(/window\.baseDS\s*=\s*(\{[\s\S]*?\});/)
  if (!match) throw new Error("Could not locate CNCF baseDS blob")
  const ds = JSON.parse(match[1])
  const items = Array.isArray(ds.items) ? ds.items : []

  return items.map((item, idx) => {
    const category = item.category || "Uncategorized"
    const subCategory = item.subcategory || "Uncategorized"
    return {
      id: makeId(["cncf", item.id || idx, item.name]),
      source: "cncf-landscape",
      sourceType: "landscape_dataset",
      sourceUrl: "https://landscape.cncf.io",
      license: "Mixed",
      capturedAt: NOW,
      entityType: "company",
      name: normalizeName(item.name || `Item ${idx + 1}`),
      websiteUrl: "",
      description: `${category} / ${subCategory}`,
      vertical: "devtools",
      category,
      subCategory,
      tags: ["cncf", item.oss ? "oss" : "proprietary"].filter(Boolean),
      metadata: {
        oss: !!item.oss,
        maturity: item.maturity || "",
        originalId: item.id || "",
      },
      legal: {
        restricted: true,
        notes: "CNCF/LF landscape pages include Crunchbase data usage restrictions; run legal filter before promotion.",
      },
    }
  })
}

const CONNECTORS = {
  "ai-native-dev-landscape": importAiNative,
  "awesome-ai-market-maps": importAwesomeAiMarketMaps,
  "hf-ai-market-maps": importHfAiMarketMaps,
  "cncf-landscape": importCncfLandscape,
}

function dedupe(records) {
  const by = new Map()
  for (const r of records) {
    const key = `${(r.name || "").toLowerCase()}|${(r.websiteUrl || "").toLowerCase()}|${r.source}`
    if (!by.has(key)) by.set(key, r)
  }
  return Array.from(by.values())
}

function summarize(records) {
  const bySource = new Map()
  for (const r of records) {
    bySource.set(r.source, (bySource.get(r.source) || 0) + 1)
  }
  return {
    total: records.length,
    bySource: Array.from(bySource.entries()).map(([source, count]) => ({ source, count })),
  }
}

async function main() {
  const sources = selected === "all" ? KNOWN_SOURCES : [selected]
  for (const src of sources) {
    if (!KNOWN_SOURCES.includes(src)) {
      console.error(`Unknown source: ${src}`)
      process.exit(1)
    }
  }

  const all = []
  for (const src of sources) {
    log(`Fetching source: ${src}`)
    const records = await CONNECTORS[src]()
    const sliced = limit > 0 ? records.slice(0, limit) : records
    log(`  Parsed ${sliced.length} records`)
    all.push(...sliced)
  }

  const normalized = dedupe(all)
  const summary = summarize(normalized)

  if (write) {
    ensureDir(IMPORTS_DIR)

    const perSource = new Map()
    for (const r of normalized) {
      if (!perSource.has(r.source)) perSource.set(r.source, [])
      perSource.get(r.source).push(r)
    }

    for (const [src, rows] of perSource.entries()) {
      const dir = path.join(IMPORTS_DIR, src)
      ensureDir(dir)

      const payload = {
        source: src,
        generatedAt: NOW,
        count: rows.length,
        records: rows,
      }

      const datedPath = path.join(dir, `${DATE}.json`)
      const latestPath = path.join(dir, "latest.json")
      fs.writeFileSync(datedPath, JSON.stringify(payload, null, 2))
      fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2))
      log(`  Wrote ${rows.length} records -> ${path.relative(ROOT, datedPath)}`)
    }

    const manifest = {
      generatedAt: NOW,
      sources,
      totalRecords: normalized.length,
      summary,
    }
    fs.writeFileSync(path.join(IMPORTS_DIR, "manifest.latest.json"), JSON.stringify(manifest, null, 2))
  }

  console.log(JSON.stringify({
    dryRun,
    wrote: write,
    summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(`[import-sources] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
