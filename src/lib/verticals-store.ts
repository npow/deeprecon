import fs from "fs"
import path from "path"
import { VERTICALS, type VerticalDefinition } from "./types"

const VERTICALS_FILE = path.join(process.cwd(), "data", "verticals.json")

function ensureDir() {
  const dir = path.dirname(VERTICALS_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Load verticals from disk. Falls back to the hardcoded VERTICALS list
 * if no file exists yet (first run).
 */
export function loadVerticals(): VerticalDefinition[] {
  if (fs.existsSync(VERTICALS_FILE)) {
    return JSON.parse(fs.readFileSync(VERTICALS_FILE, "utf-8"))
  }
  return VERTICALS
}

/**
 * Save verticals to disk. Merges new verticals with existing ones
 * (deduplicating by slug), so discovered verticals accumulate over time.
 */
export function saveVerticals(verticals: VerticalDefinition[]): void {
  ensureDir()
  fs.writeFileSync(VERTICALS_FILE, JSON.stringify(verticals, null, 2))
}

/**
 * Merge newly discovered verticals into the existing list.
 * Keeps existing entries, adds new ones, updates descriptions if longer.
 */
export function mergeVerticals(
  existing: VerticalDefinition[],
  discovered: VerticalDefinition[],
): { merged: VerticalDefinition[]; newCount: number } {
  const bySlug = new Map<string, VerticalDefinition>()
  for (const v of existing) {
    bySlug.set(v.slug, v)
  }

  let newCount = 0
  for (const v of discovered) {
    const slug = v.slug.toLowerCase().replace(/[^a-z0-9-]/g, "")
    if (!slug) continue

    const existingEntry = bySlug.get(slug)
    if (existingEntry) {
      // Update description if the new one is more detailed
      if (v.description.length > existingEntry.description.length) {
        bySlug.set(slug, { ...existingEntry, description: v.description })
      }
    } else {
      bySlug.set(slug, { slug, name: v.name, description: v.description })
      newCount++
    }
  }

  return { merged: Array.from(bySlug.values()), newCount }
}
