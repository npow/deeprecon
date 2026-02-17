#!/usr/bin/env node
/**
 * fixup-maps.mjs — Post-BFS data quality pass over all maps.
 *
 * Fixes:
 * 1. Normalize `stage` to a canonical set
 * 2. Recalculate subcategory `totalFunding` from player data
 * 3. Recalculate `crowdednessScore` and `opportunityScore` heuristically
 * 4. Fix map-level `totalPlayers`
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAPS_DIR = path.join(__dirname, "..", "data", "maps")

// ─── Stage normalization ───

const STAGE_MAP = {
  // Pre-Seed
  "pre-seed": "Pre-Seed",
  "preseed": "Pre-Seed",
  "pre seed": "Pre-Seed",
  "angel": "Pre-Seed",

  // Seed
  "seed": "Seed",
  "seed round": "Seed",

  // Series A-F
  "series a": "Series A",
  "series b": "Series B",
  "series c": "Series C",
  "series d": "Series D",
  "series e": "Series E",
  "series f": "Series F",
  "series g": "Series G",
  "series h": "Series H",

  // Early
  "early": "Early Stage",
  "early stage": "Early Stage",
  "early growth": "Early Stage",
  "early-stage": "Early Stage",

  // Growth
  "growth": "Growth",
  "growth stage": "Growth",
  "late growth": "Growth",
  "expansion": "Growth",

  // Late / Mature
  "late": "Late Stage",
  "late stage": "Late Stage",
  "late-stage": "Late Stage",
  "mature": "Late Stage",
  "established": "Late Stage",

  // IPO / Public
  "ipo": "Public",
  "public": "Public",
  "publicly traded": "Public",
  "post-ipo": "Public",

  // Private Equity
  "private equity": "Private Equity",
  "pe": "Private Equity",
  "private": "Private Equity",
  "private equity buyout": "Private Equity",

  // Acquired
  "acquired": "Acquired",
  "m&a": "Acquired",
  "acquisition": "Acquired",
  "defunct": "Acquired",

  // Bootstrapped
  "bootstrapped": "Bootstrapped",
  "self-funded": "Bootstrapped",
  "self funded": "Bootstrapped",
  "revenue-funded": "Bootstrapped",
  "profitable": "Bootstrapped",
  "smb": "Bootstrapped",
  "commercial": "Bootstrapped",

  // Open Source
  "open source": "Open Source",
  "open-source": "Open Source",
  "oss": "Open Source",
  "oss project": "Open Source",
  "open source project": "Open Source",
  "open-source project": "Open Source",
  "mature oss": "Open Source",
  "mature open source": "Open Source",
  "community": "Open Source",
  "community project": "Open Source",
  "project": "Open Source",
  "active development": "Open Source",
  "active": "Open Source",
  "production": "Open Source",

  // Corporate / Enterprise
  "corporate": "Corporate",
  "corporate venture": "Corporate",
  "enterprise": "Corporate",
  "corporate spin-off": "Corporate",
  "division": "Corporate",

  // Unknown
  "": "Unknown",
  "n/a": "Unknown",
  "unknown": "Unknown",
  "undisclosed": "Unknown",
}

function normalizeStage(stage) {
  if (!stage) return "Unknown"
  const lower = stage.toLowerCase().trim()

  // Exact match
  if (STAGE_MAP[lower]) return STAGE_MAP[lower]

  // Substring match for series
  const seriesMatch = lower.match(/series\s+([a-h])/i)
  if (seriesMatch) return `Series ${seriesMatch[1].toUpperCase()}`

  // Substring matches
  if (lower.includes("pre-seed") || lower.includes("preseed")) return "Pre-Seed"
  if (lower.includes("seed")) return "Seed"
  if (lower.includes("ipo") || lower.includes("public")) return "Public"
  if (lower.includes("acqui")) return "Acquired"
  if (lower.includes("bootstrap") || lower.includes("self-fund")) return "Bootstrapped"
  if (lower.includes("open source") || lower.includes("open-source") || lower.includes("oss")) return "Open Source"
  if (lower.includes("growth")) return "Growth"
  if (lower.includes("early")) return "Early Stage"
  if (lower.includes("late") || lower.includes("mature")) return "Late Stage"
  if (lower.includes("corporate") || lower.includes("enterprise")) return "Corporate"
  if (lower.includes("private")) return "Private Equity"

  return stage // Keep original if no match
}

// ─── Funding parsing ───

function parseFundingUsd(funding) {
  if (!funding || funding === "Unknown" || funding === "N/A" || funding === "Bootstrapped") return 0
  const str = String(funding).replace(/[,\s]/g, "")
  const match = str.match(/\$?([\d.]+)\s*(B|M|K)?/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = (match[2] || "").toUpperCase()
  if (unit === "B") return num * 1_000_000_000
  if (unit === "M") return num * 1_000_000
  if (unit === "K") return num * 1_000
  return num
}

function formatFunding(usd) {
  if (!usd || usd <= 0) return "N/A"
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(0)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`
  return `$${usd}`
}

// ─── Crowdedness & Opportunity heuristics ───

function computeCrowdedness(players) {
  const n = players.length
  // Scale: 0 players → 10, 50 → 40, 200 → 65, 500+ → 85, 1000+ → 95
  if (n === 0) return 10
  if (n <= 10) return 15 + n
  if (n <= 50) return 25 + Math.round((n - 10) * 0.375)
  if (n <= 200) return 40 + Math.round((n - 50) * 0.167)
  if (n <= 500) return 65 + Math.round((n - 200) * 0.067)
  if (n <= 1000) return 85 + Math.round((n - 500) * 0.02)
  return Math.min(98, 95 + Math.round((n - 1000) * 0.003))
}

function computeOpportunity(players, crowdedness) {
  if (players.length === 0) return 80 // Empty = high opportunity

  // Average execution and vision scores
  let execSum = 0, visSum = 0, count = 0
  for (const p of players) {
    if (p.executionScore && p.visionScore) {
      execSum += p.executionScore
      visSum += p.visionScore
      count++
    }
  }
  const avgExec = count > 0 ? execSum / count : 50
  const avgVision = count > 0 ? visSum / count : 50

  // Low avg scores + low crowdedness = high opportunity
  // High avg scores + high crowdedness = low opportunity
  const executionGap = Math.max(0, 70 - avgExec) // Room for better execution
  const visionGap = Math.max(0, 70 - avgVision)   // Room for better vision
  const crowdednessPenalty = crowdedness * 0.4      // More crowded = less opportunity

  const raw = 50 + executionGap * 0.3 + visionGap * 0.3 - crowdednessPenalty * 0.5
  return Math.max(5, Math.min(95, Math.round(raw)))
}

// ─── Main ───

const mapFiles = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
let totalFixed = 0
let totalStageNormalized = 0

for (const f of mapFiles) {
  const mapPath = path.join(MAPS_DIR, f)
  const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"))
  const slug = f.replace(".json", "")
  let mapChanged = false

  for (const sub of map.subCategories) {
    const players = sub.topPlayers || []

    // 1. Normalize stages
    for (const p of players) {
      const orig = p.stage
      p.stage = normalizeStage(p.stage)
      if (orig !== p.stage) {
        totalStageNormalized++
        mapChanged = true
      }
    }

    // 2. Recalculate totalFunding
    let totalUsd = 0
    for (const p of players) {
      const usd = p.totalFundingUsd || parseFundingUsd(p.funding)
      totalUsd += usd
    }
    const newTotalFunding = formatFunding(totalUsd)
    if (sub.totalFunding !== newTotalFunding) {
      sub.totalFunding = newTotalFunding
      mapChanged = true
    }

    // 3. Recalculate crowdedness
    const newCrowdedness = computeCrowdedness(players)
    if (sub.crowdednessScore !== newCrowdedness) {
      sub.crowdednessScore = newCrowdedness
      mapChanged = true
    }

    // 4. Recalculate opportunity
    const newOpportunity = computeOpportunity(players, newCrowdedness)
    if (sub.opportunityScore !== newOpportunity) {
      sub.opportunityScore = newOpportunity
      mapChanged = true
    }

    // 5. Fix playerCount
    if (sub.playerCount !== players.length) {
      sub.playerCount = players.length
      mapChanged = true
    }
  }

  // Map-level totals
  map.totalPlayers = map.subCategories.reduce((s, sc) => s + (sc.topPlayers?.length || 0), 0)

  if (mapChanged) {
    const tmpPath = `${mapPath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2))
    fs.renameSync(tmpPath, mapPath)
    totalFixed++

    const subcats = map.subCategories
    const avgOpp = Math.round(subcats.reduce((s, sc) => s + sc.opportunityScore, 0) / subcats.length)
    const avgCrowd = Math.round(subcats.reduce((s, sc) => s + sc.crowdednessScore, 0) / subcats.length)
    console.log(`✅ ${slug}: ${map.totalPlayers} players, avg crowdedness=${avgCrowd}, avg opportunity=${avgOpp}`)
  } else {
    console.log(`  ${slug}: no changes needed`)
  }
}

console.log(`\nDone. Fixed ${totalFixed} maps. Normalized ${totalStageNormalized} stage values.`)
