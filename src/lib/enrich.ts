import { SubCategoryPlayer } from "./types"

/** Lowercase, strip non-alphanumeric for fuzzy dedup */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
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

  // Apply updates for matching names
  let updatedCount = 0
  for (const up of updatedPlayers) {
    const key = normalizeName(up.name)
    if (byName.has(key)) {
      byName.set(key, { ...byName.get(key)!, ...up })
      updatedCount++
    }
  }

  // Add genuinely new players (skip if name already exists)
  let newCount = 0
  for (const np of newPlayers) {
    const key = normalizeName(np.name)
    if (!byName.has(key)) {
      byName.set(key, np)
      newCount++
    }
  }

  return {
    merged: Array.from(byName.values()),
    newCount,
    updatedCount,
  }
}
