#!/usr/bin/env node
import fs from "fs"
import path from "path"

const apiBase = process.env.SCAN_API_BASE || "http://localhost:3000"
const scansDir = path.join(process.cwd(), "data", "scans")
const maxRounds = Number(process.env.OPT_MAX_ROUNDS || 3)
const attemptsPerRound = Number(process.env.OPT_ATTEMPTS_PER_ROUND || 3)
const timeoutMs = Number(process.env.OPT_TIMEOUT_MS || 10 * 60 * 1000)
const onlyRootIds = new Set(process.argv.slice(2))

function readScans() {
  return fs
    .readdirSync(scansDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(scansDir, f), "utf8")))
}

function scoreOf(scan) {
  return Number(scan?.readinessScore?.total || 0)
}

function uniquenessOf(scan) {
  const uniq = (scan?.readinessScore?.breakdown || []).find((b) => b.factor === "Uniqueness")
  return Number(uniq?.score || 0)
}

function chainForRoot(scans, rootId) {
  return scans
    .filter((s) => s.id === rootId || s.rootScanId === rootId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function latestForRoot(scans, rootId) {
  const chain = chainForRoot(scans, rootId)
  return chain[chain.length - 1]
}

function bestForRoot(scans, rootId) {
  const chain = chainForRoot(scans, rootId)
  return [...chain].sort((a, b) => {
    const s = scoreOf(b) - scoreOf(a)
    if (s !== 0) return s
    return uniquenessOf(b) - uniquenessOf(a)
  })[0]
}

function topGap(scan, idx = 0) {
  const gaps = [...(scan?.gapAnalysis?.whiteSpaceOpportunities || [])]
  if (!gaps.length) return null
  gaps.sort((a, b) => {
    const rank = (x) => (x === "high" ? 3 : x === "medium" ? 2 : 1)
    return rank(b.potentialImpact) - rank(a.potentialImpact)
  })
  return gaps[idx] || gaps[0]
}

function topSegment(scan, idx = 0) {
  const segs = scan?.gapAnalysis?.unservedSegments || []
  return segs[idx] || segs[0] || null
}

function topComplaint(scan, idx = 0) {
  const complaints = scan?.gapAnalysis?.commonComplaints || []
  return complaints[idx] || complaints[0] || null
}

function remixIdeas(scan) {
  const baseIdea = String(scan.ideaText || "").trim()
  const wedge = String(scan?.ddReport?.wedgeStrategy?.wedge || "").trim()
  const base = baseIdea || wedge

  const g1 = topGap(scan, 0)
  const g2 = topGap(scan, 1)
  const s1 = topSegment(scan, 0)
  const c1 = topComplaint(scan, 0)

  const out = []
  if (g1 && s1) {
    out.push(
      `${base}, specifically for ${String(s1.segment || "underserved buyers").toLowerCase()}, with a deterministic advantage around ${String(g1.opportunity || "a core gap").toLowerCase()}.`
    )
  }
  if (g2) {
    out.push(
      `${base}, focused narrowly on ${String(g2.opportunity || "the highest-impact gap").toLowerCase()} and explicit workflows where incumbents fail.`
    )
  }
  if (c1) {
    out.push(
      `${base}, designed to eliminate this repeated complaint from existing tools: ${String(c1.complaint || "low trust and generic output").toLowerCase()}.`
    )
  }
  if (!out.length) {
    out.push(`${base}, with a strict wedge around compliance-grade differentiation for a narrow ICP.`)
  }

  // Deduplicate normalized text
  const seen = new Set()
  return out.filter((idea) => {
    const k = idea.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

async function runScan(ideaText, parentScanId, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        ideaText,
        remix: {
          parentScanId,
          remixType: "uniqueness_experiment",
          remixLabel: label,
        },
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")
    const dec = new TextDecoder()
    let buffer = ""
    let newId = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += dec.decode(value, { stream: true })
      const chunks = buffer.split("\n\n")
      buffer = chunks.pop() || ""
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "))
        if (!line) continue
        const payload = line.slice(6).trim()
        if (!payload) continue
        let evt
        try {
          evt = JSON.parse(payload)
        } catch {
          continue
        }
        if (evt.type === "scan_complete") newId = evt?.data?.id || null
        if (evt.type === "scan_error") throw new Error(evt?.data?.message || "scan_error")
      }
    }
    if (!newId) throw new Error("No scan_complete id")
    return newId
  } finally {
    clearTimeout(timer)
  }
}

async function optimizeRoot(rootId) {
  let scans = readScans()
  const root = scans.find((s) => s.id === rootId && !s.parentScanId)
  if (!root) return

  let latest = latestForRoot(scans, rootId)
  let best = bestForRoot(scans, rootId)

  console.log(`\n=== Optimize ${rootId} ===`)
  console.log(`root=${scoreOf(root)} best=${scoreOf(best)} latest=${scoreOf(latest)} uniq=${uniquenessOf(latest)}`)

  for (let round = 1; round <= maxRounds; round++) {
    const beforeBestScore = scoreOf(best)
    const beforeBestUniq = uniquenessOf(best)
    const parent = bestForRoot(scans, rootId)
    const ideas = remixIdeas(parent).slice(0, attemptsPerRound)
    if (!ideas.length) break

    console.log(`Round ${round}: parent=${parent.id} score=${scoreOf(parent)} uniq=${uniquenessOf(parent)} attempts=${ideas.length}`)

    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i]
      const label = `Auto Optimize R${round}.${i + 1}`
      const start = Date.now()
      try {
        const newId = await runScan(idea, parent.id, label)
        scans = readScans()
        const out = scans.find((s) => s.id === newId)
        const took = Math.round((Date.now() - start) / 1000)
        console.log(`  ${label}: score=${scoreOf(out)} uniq=${uniquenessOf(out)} id=${newId} took=${took}s`)
      } catch (err) {
        const took = Math.round((Date.now() - start) / 1000)
        console.log(`  ${label}: failed after ${took}s (${err instanceof Error ? err.message : String(err)})`)
      }
    }

    scans = readScans()
    latest = latestForRoot(scans, rootId)
    best = bestForRoot(scans, rootId)
    const improved = scoreOf(best) > beforeBestScore || (scoreOf(best) === beforeBestScore && uniquenessOf(best) > beforeBestUniq)
    console.log(`Round ${round} done: best=${scoreOf(best)} uniq=${uniquenessOf(best)} latest=${scoreOf(latest)} (${latest.id})`)

    if (!improved) {
      console.log(`No improvement in round ${round}; stopping ${rootId}`)
      break
    }
  }
}

async function main() {
  const scans = readScans()
  const roots = scans
    .filter((s) => !s.parentScanId)
    .filter((r) => (onlyRootIds.size ? onlyRootIds.has(r.id) : true))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  for (const root of roots) {
    await optimizeRoot(root.id)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
