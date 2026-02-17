#!/usr/bin/env node
/**
 * Populate missing logoUrl fields in persisted map/scan JSON files.
 * Source strategy: derive Google S2 favicon URL from website hostname.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")
const MAPS_DIR = path.join(ROOT, "data", "maps")
const SCANS_DIR = path.join(ROOT, "data", "scans")

function normalizeWebsiteUrl(value) {
  if (!value || typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withProtocol).toString()
  } catch {
    return null
  }
}

function deriveLogoUrl(websiteUrl, logoUrl) {
  const existing = typeof logoUrl === "string" ? logoUrl.trim() : ""
  if (
    existing
    && !existing.includes("google.com/s2/favicons")
    && !existing.includes("gstatic.com/faviconV2")
    && !existing.includes("icons.duckduckgo.com/ip3/")
    && !existing.startsWith("/api/logo?")
  ) {
    return existing
  }

  const normalized = normalizeWebsiteUrl(websiteUrl)
  if (!normalized) return null
  return `/api/logo?website=${encodeURIComponent(normalized)}`
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, filePath)
}

function backfillMaps() {
  if (!fs.existsSync(MAPS_DIR)) return { files: 0, playersUpdated: 0 }
  const files = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"))
  let playersUpdated = 0

  for (const file of files) {
    const filePath = path.join(MAPS_DIR, file)
    const map = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    let changed = false

    for (const sub of map.subCategories || []) {
      for (const player of sub.topPlayers || []) {
        const next = deriveLogoUrl(player.websiteUrl, player.logoUrl)
        if (next && next !== player.logoUrl) {
          player.logoUrl = next
          playersUpdated++
          changed = true
        }
      }
    }

    if (changed) writeJsonAtomic(filePath, map)
  }

  return { files: files.length, playersUpdated }
}

function backfillScans() {
  if (!fs.existsSync(SCANS_DIR)) return { files: 0, competitorsUpdated: 0 }
  const files = fs.readdirSync(SCANS_DIR).filter((f) => f.endsWith(".json"))
  let competitorsUpdated = 0

  for (const file of files) {
    const filePath = path.join(SCANS_DIR, file)
    const scan = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    let changed = false

    for (const competitor of scan.competitors || []) {
      const next = deriveLogoUrl(competitor.websiteUrl, competitor.logoUrl)
      if (next && next !== competitor.logoUrl) {
        competitor.logoUrl = next
        competitorsUpdated++
        changed = true
      }
    }

    if (changed) writeJsonAtomic(filePath, scan)
  }

  return { files: files.length, competitorsUpdated }
}

const mapStats = backfillMaps()
const scanStats = backfillScans()

console.log(
  `Backfill complete: maps=${mapStats.files} files, map_players=${mapStats.playersUpdated}; scans=${scanStats.files} files, scan_competitors=${scanStats.competitorsUpdated}`,
)
