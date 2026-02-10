import fs from "fs"
import path from "path"
import { VerticalMap } from "./types"

const MAPS_DIR = path.join(process.cwd(), "data", "maps")

function ensureDir() {
  if (!fs.existsSync(MAPS_DIR)) {
    fs.mkdirSync(MAPS_DIR, { recursive: true })
  }
}

export function saveMap(slug: string, data: VerticalMap): void {
  ensureDir()
  fs.writeFileSync(
    path.join(MAPS_DIR, `${slug}.json`),
    JSON.stringify(data, null, 2)
  )
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
