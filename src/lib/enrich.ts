import { SubCategoryPlayer, ConfidenceLevel } from "./types"

/** Lowercase, strip non-alphanumeric for fuzzy dedup */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Merge two player objects, preferring non-empty values from the newer entry
 * but preserving the earliest discoveredAt and accumulating sources.
 */
function mergePlayerFields(
  existing: SubCategoryPlayer,
  incoming: SubCategoryPlayer
): SubCategoryPlayer {
  const now = new Date().toISOString()

  return {
    ...existing,
    // Prefer longer/richer text fields
    oneLiner: (incoming.oneLiner?.length || 0) > (existing.oneLiner?.length || 0)
      ? incoming.oneLiner : existing.oneLiner,
    // Prefer non-"Unknown" values for structured fields
    funding: incoming.funding && incoming.funding !== "Unknown" ? incoming.funding : existing.funding,
    totalFundingUsd: incoming.totalFundingUsd ?? existing.totalFundingUsd,
    stage: incoming.stage && incoming.stage !== "Unknown" ? incoming.stage : existing.stage,
    lastFundingDate: incoming.lastFundingDate ?? existing.lastFundingDate,
    // Average scores if both have them
    executionScore: existing.executionScore && incoming.executionScore
      ? Math.round((existing.executionScore + incoming.executionScore) / 2)
      : incoming.executionScore || existing.executionScore,
    visionScore: existing.visionScore && incoming.visionScore
      ? Math.round((existing.visionScore + incoming.visionScore) / 2)
      : incoming.visionScore || existing.visionScore,
    // Prefer richer competitive factors
    competitiveFactors: (incoming.competitiveFactors?.length || 0) > (existing.competitiveFactors?.length || 0)
      ? incoming.competitiveFactors : existing.competitiveFactors,
    // Fill in missing metadata from incoming
    websiteUrl: incoming.websiteUrl || existing.websiteUrl,
    linkedinUrl: incoming.linkedinUrl || existing.linkedinUrl,
    crunchbaseUrl: incoming.crunchbaseUrl || existing.crunchbaseUrl,
    logoUrl: incoming.logoUrl || existing.logoUrl,
    foundedYear: incoming.foundedYear ?? existing.foundedYear,
    headquartersLocation: incoming.headquartersLocation || existing.headquartersLocation,
    employeeCountRange: incoming.employeeCountRange || existing.employeeCountRange,
    pricingModel: incoming.pricingModel || existing.pricingModel,
    targetCustomer: incoming.targetCustomer || existing.targetCustomer,
    similarityScore: incoming.similarityScore ?? existing.similarityScore,
    // Union tags
    tags: existing.tags || incoming.tags
      ? [...new Set([...(existing.tags || []), ...(incoming.tags || [])])]
      : undefined,
    // Keep earliest discoveredAt
    discoveredAt: existing.discoveredAt && incoming.discoveredAt
      ? (existing.discoveredAt < incoming.discoveredAt ? existing.discoveredAt : incoming.discoveredAt)
      : existing.discoveredAt || incoming.discoveredAt,
    // Always update updatedAt
    updatedAt: now,
    // Prefer existing source (first discovery), but track latest discoveredBy
    source: existing.source || incoming.source,
    discoveredBy: incoming.discoveredBy
      ? (existing.discoveredBy && existing.discoveredBy !== incoming.discoveredBy
        ? `${existing.discoveredBy}, ${incoming.discoveredBy}`
        : incoming.discoveredBy)
      : existing.discoveredBy,
    websiteStatus: incoming.websiteStatus || existing.websiteStatus,
    // Union confirmedBy arrays (deduplicated), resolve confidence to highest level
    confirmedBy: existing.confirmedBy || incoming.confirmedBy
      ? [...new Set([...(existing.confirmedBy || []), ...(incoming.confirmedBy || [])])]
      : undefined,
    confirmedByCount: Math.max(existing.confirmedByCount ?? 0, incoming.confirmedByCount ?? 0),
    confidenceLevel: resolveConfidenceLevel(existing.confidenceLevel, incoming.confidenceLevel),
  }
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  web_verified: 3,
  multi_confirmed: 2,
  ai_inferred: 1,
}

export function resolveConfidenceLevel(
  a?: ConfidenceLevel,
  b?: ConfidenceLevel
): ConfidenceLevel | undefined {
  if (!a && !b) return undefined
  if (!a) return b
  if (!b) return a
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b
}

export function mergeEnrichmentResults(
  existing: SubCategoryPlayer[],
  newPlayers: SubCategoryPlayer[],
  updatedPlayers: SubCategoryPlayer[]
): { merged: SubCategoryPlayer[]; newCount: number; updatedCount: number } {
  const byName = new Map<string, SubCategoryPlayer>()
  for (const p of existing) {
    byName.set(normalizeName(p.name), { ...p })
  }

  // Apply updates for matching names — deep merge fields
  let updatedCount = 0
  for (const up of updatedPlayers) {
    const key = normalizeName(up.name)
    const ex = byName.get(key)
    if (ex) {
      byName.set(key, mergePlayerFields(ex, up))
      updatedCount++
    }
  }

  // Add genuinely new players, or merge if name already exists
  let newCount = 0
  for (const np of newPlayers) {
    const key = normalizeName(np.name)
    const ex = byName.get(key)
    if (!ex) {
      byName.set(key, np)
      newCount++
    } else {
      // Name exists — merge in any new data (counts as update, not new)
      byName.set(key, mergePlayerFields(ex, np))
    }
  }

  return {
    merged: Array.from(byName.values()),
    newCount,
    updatedCount,
  }
}
