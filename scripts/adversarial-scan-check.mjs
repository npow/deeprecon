#!/usr/bin/env node
const apiBase = process.env.SCAN_API_BASE || 'http://localhost:3000'
const pollMs = Number(process.env.ADV_POLL_MS || 2500)
const timeoutMs = Number(process.env.ADV_TIMEOUT_MS || 8 * 60 * 1000)

const cases = [
  {
    id: 'clone_stripe',
    idea: 'A payment processing platform exactly like Stripe: developer-first APIs for online payments, subscriptions, invoicing, fraud tools, and global payouts for internet businesses.',
    expect: (s) => ({
      pass: s.grade !== 'A' && s.grade !== 'B' && s.uniqueness <= 2,
      reason: `expected non-A/B and low uniqueness; got ${s.score}/${s.grade}, uniqueness=${s.uniqueness}`,
    }),
  },
  {
    id: 'clone_notion',
    idea: 'An all-in-one workspace exactly like Notion: docs, wikis, tasks, databases, templates, and team collaboration for companies and creators.',
    expect: (s) => ({
      pass: s.grade === 'C' || s.grade === 'D' || s.grade === 'F',
      reason: `expected C/D/F; got ${s.score}/${s.grade}`,
    }),
  },
  {
    id: 'generic_vague',
    idea: 'AI app that helps everyone do everything better using automation and analytics across all industries.',
    expect: (s) => ({
      pass: s.score <= 70,
      reason: `expected <=70 for vague idea; got ${s.score}`,
    }),
  },
  {
    id: 'differentiated_control',
    idea: 'Municipal grant compliance OS for nonprofits handling 1-3 grants with line-item spend guards, evidence capture, and audit-ready closeout packets.',
    expect: (s) => ({
      pass: s.score >= 75,
      reason: `expected >=75 for differentiated control; got ${s.score}`,
    }),
  },
  {
    id: 'contradictory_claims',
    idea: 'A B2B SaaS for hospitals with a $10 monthly price, zero integration, no compliance work, guaranteed 99% denial reduction, and enterprise-only sales.',
    expect: (s) => ({
      pass: s.score <= 75,
      reason: `expected constrained score for contradictory claims; got ${s.score}`,
    }),
  },
]

function getUniq(scan) {
  const b = Array.isArray(scan?.readinessScore?.breakdown) ? scan.readinessScore.breakdown : []
  return Number((b.find((x) => x.factor === 'Uniqueness') || {}).score || 0)
}

async function startBackgroundScan(idea) {
  const response = await fetch(`${apiBase}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-debug-mode': '1' },
    body: JSON.stringify({
      ideaText: idea,
      runInBackground: true,
      settings: {
        maxCompetitors: 5,
        depthLevel: 'quick',
        workflowMode: 'founder',
        experimentVariants: 1,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`start failed ${response.status}: ${text.slice(0, 200)}`)
  }
  return response.json()
}

async function pollJob(jobId) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`${apiBase}/api/scan/jobs/${jobId}`)
    if (r.ok) {
      const job = await r.json()
      if (job.status === 'completed') return job.scanId
      if (job.status === 'failed') throw new Error(job.error || 'job failed')
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error(`job timeout after ${Math.round(timeoutMs / 1000)}s`)
}

async function fetchScan(scanId) {
  const r = await fetch(`${apiBase}/api/scans/${scanId}`)
  if (!r.ok) throw new Error(`scan fetch failed ${r.status}`)
  const scan = await r.json()
  return {
    scanId,
    score: Number(scan?.readinessScore?.total || 0),
    grade: scan?.readinessScore?.grade || '?',
    uniqueness: getUniq(scan),
    crowdedness: scan?.crowdednessIndex || 'unknown',
    cloneRisk: scan?.readinessScore?.cloneRisk || null,
    verdict: scan?.readinessScore?.verdict || '',
  }
}

async function runCase(c) {
  const started = await startBackgroundScan(c.idea)
  const scanId = await pollJob(started.jobId)
  const summary = await fetchScan(scanId)
  const result = c.expect(summary)
  return {
    id: c.id,
    idea: c.idea,
    ...summary,
    pass: !!result.pass,
    expectation: result.reason,
  }
}

const out = []
let failed = 0
for (const c of cases) {
  process.stdout.write(`\n[CASE] ${c.id}\n`)
  try {
    const r = await runCase(c)
    out.push(r)
    process.stdout.write(`  -> ${r.pass ? 'PASS' : 'FAIL'} | ${r.score}/${r.grade} uniq=${r.uniqueness} crowd=${r.crowdedness} id=${r.scanId}\n`)
    if (!r.pass) {
      failed += 1
      process.stdout.write(`     expectation: ${r.expectation}\n`)
      if (r.cloneRisk) process.stdout.write(`     cloneRisk: ${r.cloneRisk.level} (-${r.cloneRisk.penalty})\n`)
    }
  } catch (err) {
    failed += 1
    out.push({ id: c.id, pass: false, error: err instanceof Error ? err.message : String(err) })
    process.stdout.write(`  -> ERROR ${err instanceof Error ? err.message : String(err)}\n`)
  }
}

console.log('\n=== ADVERSARIAL SUMMARY ===')
for (const r of out) {
  if (r.pass) {
    console.log(`PASS ${r.id} ${r.score}/${r.grade} uniq=${r.uniqueness} id=${r.scanId}`)
  } else {
    console.log(`FAIL ${r.id} ${r.error || r.expectation}`)
  }
}
console.log(`\nTOTAL: ${out.length} | FAILURES: ${failed}`)

if (failed > 0) process.exit(2)
