import { VERTICALS, type VerticalDefinition } from "./types"
import { ensureDbSchema, getPool } from "./db"

/**
 * Load verticals from Postgres. Falls back to the hardcoded VERTICALS list
 * if no rows exist yet (first run).
 */
export async function loadVerticals(): Promise<VerticalDefinition[]> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<VerticalDefinition>(
    "select slug, name, description from verticals order by slug asc",
  )
  if (res.rowCount && res.rowCount > 0) return res.rows
  await saveVerticals(VERTICALS)
  return VERTICALS
}

/**
 * Save verticals to Postgres. Merges new verticals with existing ones
 * (deduplicating by slug), so discovered verticals accumulate over time.
 */
export async function saveVerticals(verticals: VerticalDefinition[]): Promise<void> {
  await ensureDbSchema()
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query("delete from verticals")
    for (const v of verticals) {
      await client.query(
        `
        insert into verticals (slug, name, description, updated_at)
        values ($1, $2, $3, now())
        `,
        [v.slug, v.name, v.description],
      )
    }
    await client.query("commit")
  } catch (err) {
    await client.query("rollback")
    throw err
  } finally {
    client.release()
  }
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
