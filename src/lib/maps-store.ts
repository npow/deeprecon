import fs from "fs"
import path from "path"
import { VerticalMap } from "./types"
import { applyLogosToMap } from "./company-logo"

const MAPS_DIR = path.join(process.cwd(), "data", "maps")

function ensureDir() {
  if (!fs.existsSync(MAPS_DIR)) {
    fs.mkdirSync(MAPS_DIR, { recursive: true })
  }
}

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
    const map = loadMap(slug)
    const result = await fn(map)
    return result
  } finally {
    release()
  }
}

// ─── Atomic write ───
// Write to temp file, then rename. Prevents corruption from crashes mid-write.

export function saveMap(slug: string, data: VerticalMap): void {
  ensureDir()
  const filePath = path.join(MAPS_DIR, `${slug}.json`)
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(applyLogosToMap(data), null, 2))
  fs.renameSync(tmpPath, filePath)
}

export function loadMap(slug: string): VerticalMap | null {
  const filePath = path.join(MAPS_DIR, `${slug}.json`)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, "utf-8"))
}

export function listGeneratedSlugs(): string[] {
  ensureDir()
  return fs
    .readdirSync(MAPS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
}
