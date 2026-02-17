import { withMap, saveMap } from "./maps-store"
import { mergeEnrichmentResults } from "./enrich"
import {
  type IntentExtraction,
  type Competitor,
  type SubCategoryPlayer,
  type SubCategory,
  VERTICALS,
} from "./types"

// ─── Heuristic scoring ───

function formatFunding(usd?: number): string {
  if (!usd || usd <= 0) return "Unknown"
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(0)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`
  return `$${usd}`
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * Parse the upper bound from an employee count range string.
 * Handles formats like "51-200", "201-500", "1001-5000", "10001+", "500+", "~200", "200".
 * Returns 0 if unparseable.
 */
export function parseEmployeeUpperBound(range: string): number {
  if (!range) return 0
  const cleaned = range.replace(/[,~≈]/g, "").trim()
  // "N+" format → use N
  const plusMatch = cleaned.match(/(\d+)\+/)
  if (plusMatch) return parseInt(plusMatch[1], 10)
  // "N-M" format → use M (upper bound)
  const rangeMatch = cleaned.match(/(\d+)\s*[-–—]\s*(\d+)/)
  if (rangeMatch) return parseInt(rangeMatch[2], 10)
  // Single number
  const singleMatch = cleaned.match(/(\d+)/)
  if (singleMatch) return parseInt(singleMatch[1], 10)
  return 0
}

function computeExecutionScore(c: Competitor): number {
  const stage = (c.lastFundingType || "").toLowerCase()
  let score = 30 // default

  if (stage.includes("pre-seed") || stage.includes("preseed")) score = 20
  else if (stage.includes("seed")) score = 20
  else if (stage.includes("series a")) score = 35
  else if (stage.includes("series b")) score = 50
  else if (stage.includes("series c")) score = 65
  else if (stage.includes("series d") || stage.includes("series e") || stage.includes("late") || stage.includes("ipo") || stage.includes("public")) score = 80

  const upperBound = parseEmployeeUpperBound(c.employeeCountRange || "")
  if (upperBound > 200) score += 10
  else if (upperBound > 50) score += 5

  return clamp(score, 10, 95)
}

function computeVisionScore(c: Competitor): number {
  let score = 45

  // +5 per differentiator, max +20
  const diffBonus = Math.min((c.keyDifferentiators || []).length * 5, 20)
  score += diffBonus

  // Similarity adjustment (inverse: more unique = higher vision)
  // Default to 70 (neutral) if similarityScore is missing — avoids rewarding missing data
  const sim = c.similarityScore ?? 70
  if (sim > 85) score -= 15
  else if (sim > 70) score -= 5
  else if (sim > 50) score += 5
  else score += 15

  return clamp(score, 10, 95)
}

function competitorToPlayer(c: Competitor): SubCategoryPlayer {
  const now = new Date().toISOString()
  return {
    name: c.name,
    oneLiner: c.description || "",
    funding: formatFunding(c.totalFundingUsd),
    totalFundingUsd: c.totalFundingUsd,
    stage: c.lastFundingType || "Unknown",
    lastFundingDate: c.lastFundingDate,
    executionScore: computeExecutionScore(c),
    visionScore: computeVisionScore(c),
    competitiveFactors: [],
    websiteUrl: c.websiteUrl,
    linkedinUrl: c.linkedinUrl,
    crunchbaseUrl: c.crunchbaseUrl,
    logoUrl: c.logoUrl,
    foundedYear: c.yearFounded,
    headquartersLocation: c.headquartersLocation,
    employeeCountRange: c.employeeCountRange,
    pricingModel: c.pricingModel,
    targetCustomer: c.targetCustomer,
    tags: c.tags,
    similarityScore: c.similarityScore,
    source: c.source,
    discoveredAt: c.discoveredAt || now,
    updatedAt: now,
    discoveredBy: c.discoveredBy,
    websiteStatus: c.websiteStatus,
    confirmedBy: c.confirmedBy,
    confirmedByCount: c.confirmedByCount,
    confidenceLevel: c.confidenceLevel,
  }
}

// ─── Vertical matching ───

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()
}

function matchVerticalSlug(vertical: string): string | null {
  const norm = normalize(vertical)

  // Exact slug match
  const exact = VERTICALS.find((v) => v.slug === norm.replace(/ /g, "-"))
  if (exact) return exact.slug

  // Exact name match
  const byName = VERTICALS.find((v) => normalize(v.name) === norm)
  if (byName) return byName.slug

  // Substring match on name or description
  const bySub = VERTICALS.find(
    (v) =>
      normalize(v.name).includes(norm) ||
      norm.includes(normalize(v.name)) ||
      normalize(v.description).includes(norm)
  )
  if (bySub) return bySub.slug

  // Word overlap on description
  const normWords = norm.split(/\s+/)
  let bestSlug: string | null = null
  let bestOverlap = 0
  for (const v of VERTICALS) {
    const descWords = normalize(v.description).split(/\s+/)
    const overlap = normWords.filter((w) => descWords.includes(w)).length
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestSlug = v.slug
    }
  }
  return bestOverlap >= 2 ? bestSlug : null
}

// ─── Sub-category matching ───

function matchSubCategory(subCategories: SubCategory[], category: string): SubCategory | null {
  const normCat = normalize(category)

  // Exact name match
  const exact = subCategories.find((sc) => normalize(sc.name) === normCat)
  if (exact) return exact

  // Substring match
  const bySub = subCategories.find(
    (sc) => normalize(sc.name).includes(normCat) || normCat.includes(normalize(sc.name))
  )
  if (bySub) return bySub

  // Word-overlap scoring
  const catWords = normCat.split(/\s+/).filter((w) => w.length > 2)
  let best: SubCategory | null = null
  let bestScore = 0
  for (const sc of subCategories) {
    const scWords = normalize(sc.name).split(/\s+/)
    const descWords = normalize(sc.description).split(/\s+/)
    const allWords = [...scWords, ...descWords]
    const overlap = catWords.filter((w) => allWords.some((aw) => aw.includes(w) || w.includes(aw))).length
    if (overlap > bestScore) {
      bestScore = overlap
      best = sc
    }
  }

  return bestScore >= 2 ? best : null
}

// ─── Main entry point ───

export interface MapMergeResult {
  slug: string
  subCategory: string
  newCount: number
  updatedCount: number
}

export async function feedScanIntoMap(
  intent: IntentExtraction,
  competitors: Competitor[]
): Promise<MapMergeResult | null> {
  if (!competitors.length) return null

  // 1. Match vertical → slug
  const slug = matchVerticalSlug(intent.vertical)
  if (!slug) return null

  // 2. Lock the map file and do read-modify-write atomically
  return withMap(slug, (map) => {
    if (!map) return null

    // 3. Match sub-category
    const subCat = matchSubCategory(map.subCategories, intent.category)
    if (!subCat) return null

    // 4. Convert competitors → players
    const convertedPlayers = competitors.map(competitorToPlayer)

    // 5. Merge using existing dedup logic
    const { merged, newCount, updatedCount } = mergeEnrichmentResults(
      subCat.topPlayers,
      convertedPlayers,
      [] // no updated players — scan data goes into "new" slot
    )

    if (newCount === 0 && updatedCount === 0) {
      return { slug, subCategory: subCat.name, newCount: 0, updatedCount: 0 }
    }

    // 6. Update sub-category
    subCat.topPlayers = merged
    subCat.playerCount = merged.length
    subCat.lastEnrichedAt = new Date().toISOString()

    // 7. Recalc map-level totalPlayers
    map.totalPlayers = map.subCategories.reduce((sum, sc) => sum + sc.playerCount, 0)

    // 8. Atomic save
    saveMap(slug, map)

    return { slug, subCategory: subCat.name, newCount, updatedCount }
  })
}
