#!/usr/bin/env node
/**
 * migrate-taxonomy.mjs — One-time migration to canonical taxonomy.
 *
 * For each vertical with an existing map:
 *   1. Fuzzy-match existing subcats to canonical subcats (Jaccard + substring)
 *   2. Merge players from matched subcats into canonical bucket
 *   3. Dedupe players by normalized name
 *   4. For dupes: keep longest oneLiner, average scores, merge competitiveFactors, union foundBy
 *   5. Recalculate playerCount
 *   6. Set megaCategory + description from canonical definition
 *
 * For verticals without maps: create skeleton (empty topPlayers)
 *
 * Usage:
 *   node scripts/migrations/migrate-taxonomy.mjs [--dry-run]
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..", "..")
const MAPS_DIR = path.join(ROOT, "data", "maps")
const TAXONOMY_PATH = path.join(ROOT, "data", "canonical-taxonomy.json")

const DRY_RUN = process.argv.includes("--dry-run")

// ─── Helpers ───

function normalizeName(n) {
  return n.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/** Tokenize a string into lowercase words (alphanumeric only) */
function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
}

/** Jaccard similarity + substring boost */
function fuzzyScore(a, b) {
  const tokA = new Set(tokenize(a))
  const tokB = new Set(tokenize(b))
  if (tokA.size === 0 || tokB.size === 0) return 0

  let intersection = 0
  for (const t of tokA) {
    if (tokB.has(t)) intersection++
  }
  const union = new Set([...tokA, ...tokB]).size
  let score = intersection / union

  // Substring boost: if one name contains the other
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la.includes(lb) || lb.includes(la)) score += 0.3

  return score
}

const FUZZY_THRESHOLD = 0.3

/** Find best canonical match for an existing subcat name */
function findBestMatch(existingName, canonicalSubs) {
  let best = null
  let bestScore = 0
  for (const cs of canonicalSubs) {
    // Score against canonical name
    const nameScore = fuzzyScore(existingName, cs.name)
    // Also score against canonical slug (sometimes more distinctive)
    const slugScore = fuzzyScore(existingName, cs.slug.replace(/-/g, " "))
    // Also score against canonical description (helps with semantic matches)
    const descScore = fuzzyScore(existingName, cs.description) * 0.7
    const score = Math.max(nameScore, slugScore, descScore)
    if (score > bestScore) {
      bestScore = score
      best = cs
    }
  }
  return bestScore >= FUZZY_THRESHOLD ? { match: best, score: bestScore } : null
}

/** Merge competitive factors from two players */
function mergeCompetitiveFactors(existing, incoming) {
  if (!incoming || !incoming.length) return existing || []
  if (!existing || !existing.length) return incoming

  const map = new Map()
  for (const f of existing) {
    map.set(f.factor, { factor: f.factor, score: f.score })
  }
  for (const f of incoming) {
    if (map.has(f.factor)) {
      const e = map.get(f.factor)
      e.score = Math.round((e.score + f.score) / 2)
    } else {
      map.set(f.factor, { factor: f.factor, score: f.score })
    }
  }
  return Array.from(map.values())
}

/** Merge two player objects (existing = target, incoming = to merge in) */
function mergePlayers(existing, incoming) {
  // Keep longest oneLiner
  if ((incoming.oneLiner?.length || 0) > (existing.oneLiner?.length || 0)) {
    existing.oneLiner = incoming.oneLiner
  }
  // Average scores
  if (incoming.executionScore != null && existing.executionScore != null) {
    existing.executionScore = Math.round((existing.executionScore + incoming.executionScore) / 2)
  } else if (incoming.executionScore != null) {
    existing.executionScore = incoming.executionScore
  }
  if (incoming.visionScore != null && existing.visionScore != null) {
    existing.visionScore = Math.round((existing.visionScore + incoming.visionScore) / 2)
  } else if (incoming.visionScore != null) {
    existing.visionScore = incoming.visionScore
  }
  // Merge competitive factors
  existing.competitiveFactors = mergeCompetitiveFactors(existing.competitiveFactors, incoming.competitiveFactors)
  // Union foundBy
  if (incoming.foundBy) {
    const existingFoundBy = new Set(existing.foundBy || [])
    for (const f of (Array.isArray(incoming.foundBy) ? incoming.foundBy : [incoming.foundBy])) {
      existingFoundBy.add(f)
    }
    existing.foundBy = Array.from(existingFoundBy)
  }
  // Keep more detailed funding if available
  if (incoming.funding && (!existing.funding || existing.funding === "Unknown" || existing.funding === "N/A")) {
    existing.funding = incoming.funding
  }
  if (incoming.stage && (!existing.stage || existing.stage === "Unknown")) {
    existing.stage = incoming.stage
  }
}

// ─── Main ───

function main() {
  // Load canonical taxonomy
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, "utf-8"))
  console.log(`Loaded canonical taxonomy: ${taxonomy.verticals.length} verticals`)

  // Ensure maps directory exists
  if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true })

  const stats = {
    verticals: 0,
    existingMaps: 0,
    newSkeletons: 0,
    totalCanonicalSubs: 0,
    totalExistingSubs: 0,
    matchedSubs: 0,
    unmatchedSubs: 0,
    totalPlayersBefore: 0,
    totalPlayersAfter: 0,
    deduplicatedPlayers: 0,
  }

  for (const vertical of taxonomy.verticals) {
    stats.verticals++
    stats.totalCanonicalSubs += vertical.subCategories.length

    const mapPath = path.join(MAPS_DIR, `${vertical.slug}.json`)
    const hasExistingMap = fs.existsSync(mapPath)

    if (hasExistingMap) {
      stats.existingMaps++
      const existingMap = JSON.parse(fs.readFileSync(mapPath, "utf-8"))
      const existingSubs = existingMap.subCategories || []
      stats.totalExistingSubs += existingSubs.length

      const playersBefore = existingSubs.reduce((s, sc) => s + (sc.topPlayers?.length || 0), 0)
      stats.totalPlayersBefore += playersBefore

      console.log(`\n${"═".repeat(60)}`)
      console.log(`  ${vertical.name} (${vertical.slug})`)
      console.log(`  Existing: ${existingSubs.length} subcats, ${playersBefore} players`)
      console.log(`  Canonical: ${vertical.subCategories.length} subcats`)
      console.log(`${"═".repeat(60)}`)

      // Build mapping: canonical slug → list of existing subcats matched to it
      const canonicalBuckets = new Map()
      for (const cs of vertical.subCategories) {
        canonicalBuckets.set(cs.slug, { canonical: cs, matchedSubs: [], players: new Map() })
      }

      const unmatched = []
      for (const existingSub of existingSubs) {
        const result = findBestMatch(existingSub.name, vertical.subCategories)
        if (result) {
          const bucket = canonicalBuckets.get(result.match.slug)
          bucket.matchedSubs.push(existingSub)
          stats.matchedSubs++
          console.log(`  ✅ "${existingSub.name}" → "${result.match.name}" (score: ${result.score.toFixed(2)})`)
        } else {
          unmatched.push(existingSub)
          stats.unmatchedSubs++
          console.log(`  ❌ "${existingSub.name}" → no match (best-effort reassignment)`)
        }
      }

      // Best-effort: assign unmatched subcats to the closest canonical bucket (even below threshold)
      // Uses broader matching: name-to-name, name-to-description, description-to-description
      for (const existingSub of unmatched) {
        let best = null, bestScore = 0
        for (const cs of vertical.subCategories) {
          const nameScore = fuzzyScore(existingSub.name, cs.name)
          const slugScore = fuzzyScore(existingSub.name, cs.slug.replace(/-/g, " "))
          const nameToDescScore = fuzzyScore(existingSub.name, cs.description) * 0.7
          // Also compare descriptions if available
          const descToDescScore = existingSub.description
            ? fuzzyScore(existingSub.description, cs.description) * 0.6
            : 0
          const descToNameScore = existingSub.description
            ? fuzzyScore(existingSub.description, cs.name) * 0.5
            : 0
          const score = Math.max(nameScore, slugScore, nameToDescScore, descToDescScore, descToNameScore)
          if (score > bestScore) { bestScore = score; best = cs }
        }
        if (best) {
          const bucket = canonicalBuckets.get(best.slug)
          bucket.matchedSubs.push(existingSub)
          console.log(`  🔀 "${existingSub.name}" → "${best.name}" (forced, score: ${bestScore.toFixed(2)})`)
        }
      }

      // Merge players per canonical bucket
      for (const [slug, bucket] of canonicalBuckets) {
        for (const existingSub of bucket.matchedSubs) {
          for (const player of (existingSub.topPlayers || [])) {
            const key = normalizeName(player.name)
            if (!key) continue
            if (bucket.players.has(key)) {
              mergePlayers(bucket.players.get(key), player)
              stats.deduplicatedPlayers++
            } else {
              bucket.players.set(key, { ...player })
            }
          }
        }
      }

      // Build new map
      const newMap = {
        slug: vertical.slug,
        name: vertical.name,
        description: vertical.description,
        generatedAt: existingMap.generatedAt,
        migratedAt: new Date().toISOString(),
        schemaVersion: 2,
        totalPlayers: 0,
        totalFunding: existingMap.totalFunding || "N/A",
        overallCrowdedness: existingMap.overallCrowdedness || 50,
        averageOpportunity: existingMap.averageOpportunity || 50,
        megaCategories: vertical.megaCategories,
        strategyCanvasFactors: vertical.strategyCanvasFactors,
        subCategories: [],
      }

      for (const cs of vertical.subCategories) {
        const bucket = canonicalBuckets.get(cs.slug)
        const players = Array.from(bucket.players.values())

        // Compute aggregate stats from matched subcats
        const matchedSubs = bucket.matchedSubs
        const avgCrowdedness = matchedSubs.length > 0
          ? Math.round(matchedSubs.reduce((s, sc) => s + (sc.crowdednessScore || 50), 0) / matchedSubs.length)
          : 50
        const avgOpportunity = matchedSubs.length > 0
          ? Math.round(matchedSubs.reduce((s, sc) => s + (sc.opportunityScore || 50), 0) / matchedSubs.length)
          : 50
        const trend = matchedSubs.length > 0
          ? mostCommon(matchedSubs.map(sc => sc.trendDirection).filter(Boolean)) || "stable"
          : "stable"

        // Merge keyGaps from all matched subcats
        const allGaps = matchedSubs.flatMap(sc => sc.keyGaps || [])
        const uniqueGaps = [...new Set(allGaps)].slice(0, 5)

        // Merge deepDivePrompts — keep the longest
        const deepDivePrompt = matchedSubs
          .map(sc => sc.deepDivePrompt)
          .filter(Boolean)
          .sort((a, b) => b.length - a.length)[0] || ""

        newMap.subCategories.push({
          slug: cs.slug,
          name: cs.name,
          description: cs.description,
          megaCategory: cs.megaCategory,
          crowdednessScore: avgCrowdedness,
          opportunityScore: avgOpportunity,
          playerCount: players.length,
          totalFunding: "N/A",
          trendDirection: trend,
          lastEnrichedAt: new Date().toISOString(),
          keyGaps: uniqueGaps,
          deepDivePrompt: deepDivePrompt,
          topPlayers: players,
        })
      }

      newMap.totalPlayers = newMap.subCategories.reduce((s, sc) => s + sc.playerCount, 0)
      stats.totalPlayersAfter += newMap.totalPlayers

      console.log(`  Result: ${newMap.subCategories.length} subcats, ${newMap.totalPlayers} players`)
      console.log(`  Players: ${playersBefore} → ${newMap.totalPlayers} (deduped ${playersBefore - newMap.totalPlayers})`)

      if (!DRY_RUN) {
        fs.writeFileSync(mapPath, JSON.stringify(newMap, null, 2))
        console.log(`  Written: ${mapPath}`)
      } else {
        console.log(`  [DRY RUN] Would write: ${mapPath}`)
      }
    } else {
      // No existing map — create skeleton
      stats.newSkeletons++
      console.log(`\n  📦 ${vertical.name} (${vertical.slug}) — creating skeleton`)

      const newMap = {
        slug: vertical.slug,
        name: vertical.name,
        description: vertical.description,
        generatedAt: new Date().toISOString(),
        schemaVersion: 2,
        totalPlayers: 0,
        totalFunding: "N/A",
        overallCrowdedness: 50,
        averageOpportunity: 50,
        megaCategories: vertical.megaCategories,
        strategyCanvasFactors: vertical.strategyCanvasFactors,
        subCategories: vertical.subCategories.map(cs => ({
          slug: cs.slug,
          name: cs.name,
          description: cs.description,
          megaCategory: cs.megaCategory,
          crowdednessScore: 50,
          opportunityScore: 50,
          playerCount: 0,
          totalFunding: "N/A",
          trendDirection: "stable",
          lastEnrichedAt: null,
          keyGaps: [],
          deepDivePrompt: "",
          topPlayers: [],
        })),
      }

      if (!DRY_RUN) {
        fs.writeFileSync(mapPath, JSON.stringify(newMap, null, 2))
        console.log(`  Written: ${mapPath}`)
      } else {
        console.log(`  [DRY RUN] Would write: ${mapPath}`)
      }
    }
  }

  // ─── Summary ───
  console.log(`\n${"═".repeat(60)}`)
  console.log(`  MIGRATION SUMMARY`)
  console.log(`${"═".repeat(60)}`)
  console.log(`  Verticals: ${stats.verticals} (${stats.existingMaps} existing, ${stats.newSkeletons} new skeletons)`)
  console.log(`  Canonical subcats: ${stats.totalCanonicalSubs}`)
  console.log(`  Existing subcats processed: ${stats.totalExistingSubs}`)
  console.log(`  Matched: ${stats.matchedSubs} | Unmatched (force-assigned): ${stats.unmatchedSubs}`)
  console.log(`  Players before: ${stats.totalPlayersBefore}`)
  console.log(`  Players after: ${stats.totalPlayersAfter}`)
  console.log(`  Deduplicated: ${stats.deduplicatedPlayers}`)
  if (DRY_RUN) console.log(`\n  ⚠️  DRY RUN — no files written`)
  console.log(`${"═".repeat(60)}\n`)
}

/** Return the most common element in an array */
function mostCommon(arr) {
  if (!arr.length) return null
  const counts = new Map()
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1)
  let best = arr[0], bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

main()
