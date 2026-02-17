#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const scansDir = path.join(process.cwd(), 'data', 'scans')
const apiBase = process.env.SCAN_API_BASE || 'http://localhost:3000'
const dryRun = process.argv.includes('--dry-run')
const timeoutMsArg = process.argv.find((arg) => arg.startsWith('--timeout-ms='))
const timeoutMs = timeoutMsArg ? Number(timeoutMsArg.split('=')[1]) : 12 * 60 * 1000
const onlyIdArg = process.argv.find((arg) => arg.startsWith('--only-id='))
const onlyId = onlyIdArg ? onlyIdArg.split('=')[1] : null

function readScans() {
  const files = fs.readdirSync(scansDir).filter((f) => f.endsWith('.json'))
  return files.map((f) => {
    const full = path.join(scansDir, f)
    return JSON.parse(fs.readFileSync(full, 'utf8'))
  })
}

function scoreOf(scan) {
  return Number(scan?.readinessScore?.total || 0)
}

async function runOne(scan) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
  const body = {
    ideaText: scan.ideaText,
    remix: {
      parentScanId: scan.id,
      remixType: 'manual_rescan',
      remixLabel: 'Batch Root Re-run',
    },
  }

  const response = await fetch(`${apiBase}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const err = await response.json()
      if (err?.error) message = `${message}: ${err.error}`
    } catch {}
    throw new Error(message)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response stream')

  const decoder = new TextDecoder()
  let buffer = ''
  let newScanId = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''

      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const payload = line.slice(6).trim()
        if (!payload) continue
        let event
        try {
          event = JSON.parse(payload)
        } catch {
          continue
        }
        if (event.type === 'status_update') {
          const stage = event?.data?.stage || 'unknown'
          process.stdout.write(`  - stage=${stage}\n`)
        }
        if (event.type === 'scan_complete') {
          newScanId = event?.data?.id || null
        }
        if (event.type === 'scan_error') {
          throw new Error(event?.data?.message || 'scan_error')
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }

  if (!newScanId) throw new Error('Scan finished without scan_complete id')
  return newScanId
}

async function main() {
  const scans = readScans()
  const roots = scans
    .filter((s) => !s.parentScanId)
    .filter((s) => (onlyId ? s.id === onlyId : true))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  console.log(`Found ${roots.length} root scans (timeout ${Math.round(timeoutMs / 1000)}s)`)
  for (const [idx, root] of roots.entries()) {
    const oldScore = scoreOf(root)
    const label = `${idx + 1}/${roots.length} ${root.id}`
    console.log(`\\n[${label}] old=${oldScore} idea=${root.ideaText.slice(0, 90).replace(/\\s+/g, ' ')}`)

    if (dryRun) continue

    const started = Date.now()
    try {
      const newId = await runOne(root)
      const all = readScans()
      const fresh = all.find((s) => s.id === newId)
      const newScore = scoreOf(fresh)
      const delta = newScore - oldScore
      const tookSec = Math.round((Date.now() - started) / 1000)
      console.log(`[${label}] new=${newScore} delta=${delta >= 0 ? '+' : ''}${delta} id=${newId} took=${tookSec}s`)
    } catch (err) {
      const tookSec = Math.round((Date.now() - started) / 1000)
      console.log(`[${label}] FAILED after ${tookSec}s: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
