#!/usr/bin/env node
import fs from "fs"
import path from "path"

const scansDir = path.join(process.cwd(), "data", "scans")
const writeMode = process.argv.includes("--write")

/**
 * Conservative lineage inference:
 * - Exact same idea text -> manual_rescan
 * - Otherwise require strong combined similarity + short time distance
 */
const MAX_GAP_HOURS = 6
const MIN_REMIX_SCORE = 0.22

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your",
  "you", "are", "our", "their", "will", "using", "use", "platform",
  "tool", "startup", "startups",
])

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenSet(text) {
  const tokens = normalize(text)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  return new Set(tokens)
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0
  let inter = 0
  for (const t of a) {
    if (b.has(t)) inter += 1
  }
  const union = new Set([...a, ...b]).size
  return union ? inter / union : 0
}

function parseJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n")
}

if (!fs.existsSync(scansDir)) {
  console.error(`No scans directory found at ${scansDir}`)
  process.exit(1)
}

const files = fs
  .readdirSync(scansDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => path.join(scansDir, f))

const scans = files
  .map((filePath) => ({ filePath, data: parseJson(filePath) }))
  .sort((a, b) => new Date(a.data.createdAt).getTime() - new Date(b.data.createdAt).getTime())

let updated = 0
const logs = []

for (let i = 0; i < scans.length; i += 1) {
  const current = scans[i].data

  const hasLineage =
    Boolean(current.parentScanId) ||
    Boolean(current.rootScanId) ||
    Boolean(current.remixType) ||
    typeof current.remixDepth === "number"

  if (hasLineage) continue

  const currentIdea = normalize(current.ideaText)
  const currentIdeaTokens = tokenSet(current.ideaText)
  const currentKeywordTokens = tokenSet((current.intent?.keywords || []).join(" "))
  const currentTs = new Date(current.createdAt).getTime()

  let best = null

  for (let j = 0; j < i; j += 1) {
    const prev = scans[j].data
    const prevTs = new Date(prev.createdAt).getTime()
    const gapHours = (currentTs - prevTs) / (1000 * 60 * 60)
    if (gapHours < 0 || gapHours > MAX_GAP_HOURS) continue

    const prevIdea = normalize(prev.ideaText)
    if (!prevIdea) continue

    if (prevIdea === currentIdea) {
      best = {
        parent: prev,
        remixType: "manual_rescan",
        score: 1,
      }
      continue
    }

    const ideaSim = jaccard(currentIdeaTokens, tokenSet(prev.ideaText))
    const kwSim = jaccard(currentKeywordTokens, tokenSet((prev.intent?.keywords || []).join(" ")))
    const sameCategory = current.intent?.category && prev.intent?.category && current.intent.category === prev.intent.category ? 0.04 : 0
    const sameVertical = current.intent?.vertical && prev.intent?.vertical && current.intent.vertical === prev.intent.vertical ? 0.04 : 0
    const recencyBonus = Math.max(0, 1 - gapHours / MAX_GAP_HOURS) * 0.1
    const score = ideaSim * 0.45 + kwSim * 0.37 + sameCategory + sameVertical + recencyBonus

    if (!best || score > best.score) {
      best = {
        parent: prev,
        remixType: "uniqueness_suggestion",
        score,
      }
    }
  }

  if (!best || (best.remixType !== "manual_rescan" && best.score < MIN_REMIX_SCORE)) {
    current.rootScanId = current.id
    current.remixDepth = 0
    logs.push(`${current.id} <- root`)
  } else {
    const parent = best.parent
    current.parentScanId = parent.id
    current.rootScanId = parent.rootScanId || parent.id
    current.remixType = best.remixType
    current.remixLabel = best.remixType === "manual_rescan"
      ? "Backfilled: same-idea rescan"
      : "Backfilled: inferred remix"
    current.remixDepth = typeof parent.remixDepth === "number" ? parent.remixDepth + 1 : 1
    logs.push(`${current.id} <- ${parent.id} (${best.remixType}, score=${best.score.toFixed(3)})`)
  }

  updated += 1
}

if (writeMode) {
  for (const item of scans) {
    writeJson(item.filePath, item.data)
  }
}

console.log(`Scans processed: ${scans.length}`)
console.log(`Scans updated: ${updated}`)
for (const line of logs) {
  console.log(`- ${line}`)
}
if (!writeMode) {
  console.log("Dry run only. Re-run with --write to persist changes.")
}
