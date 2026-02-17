import { VerticalMap } from "./types"
import { applyLogosToMap } from "./company-logo"
import { ensureDbSchema, getPool } from "./db"

// ─── Per-slug mutex ───
// Prevents concurrent read-modify-write cycles from clobbering each other.
// Works because Next.js runs in a single Node process.

const locks = new Map<string, Promise<void>>()

/**
 * Acquire a per-slug lock. Returns a release function.
 * Callers must call release() when done (use try/finally).
 */
function acquireLock(slug: string): Promise<() => void> {
  const prev = locks.get(slug) || Promise.resolve()
  let release: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(slug, next)
  return prev.then(() => release!)
}

/**
 * Run a read-modify-write operation on a map with exclusive access.
 * The callback receives the current map (or null) and returns the updated map to save.
 * Returns whatever the callback returns.
 */
export async function withMap<T>(
  slug: string,
  fn: (map: VerticalMap | null) => T | Promise<T>
): Promise<T> {
  const release = await acquireLock(slug)
  try {
    const map = await loadMap(slug)
    const result = await fn(map)
    return result
  } finally {
    release()
  }
}

export async function saveMap(slug: string, data: VerticalMap): Promise<void> {
  const normalized = applyLogosToMap(data)
  await ensureDbSchema()
  const pool = getPool()
  await pool.query(
    `
    insert into maps (slug, payload, updated_at)
    values ($1, $2::jsonb, now())
    on conflict (slug) do update
    set payload = excluded.payload,
        updated_at = now()
    `,
    [slug, JSON.stringify(normalized)],
  )
}

export async function loadMap(slug: string): Promise<VerticalMap | null> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<{ payload: VerticalMap }>(
    "select payload from maps where slug = $1",
    [slug],
  )
  if (res.rowCount && res.rows[0]) return res.rows[0].payload
  return null
}

export async function listGeneratedSlugs(): Promise<string[]> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<{ slug: string }>("select slug from maps order by slug asc")
  return res.rows.map((r) => r.slug)
}

export async function loadAllMaps(): Promise<VerticalMap[]> {
  await ensureDbSchema()
  const pool = getPool()
  const res = await pool.query<{ payload: VerticalMap }>(
    "select payload from maps order by slug asc",
  )
  return res.rows.map((r) => r.payload)
}
