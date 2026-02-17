#!/usr/bin/env node
import fs from "fs"
import path from "path"

const root = process.cwd()
const requiredFiles = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/INDEX.md",
  "docs/DESIGN.md",
  "docs/FRONTEND.md",
  "docs/PLANS.md",
  "docs/PRODUCT_SENSE.md",
  "docs/QUALITY_SCORE.md",
  "docs/RELIABILITY.md",
  "docs/SECURITY.md",
  "docs/design-docs/INDEX.md",
  "docs/product-specs/INDEX.md",
  "docs/exec-plans/INDEX.md",
  "docs/quality/INDEX.md",
  "docs/reliability/INDEX.md",
  "docs/security/INDEX.md",
  "docs/references/INDEX.md",
  "docs/references/HARNESS_LEARNINGS_CHECKLIST.md",
  "docs/references/PROVIDER_MODEL.md",
  "docs/references/BROWSER_VALIDATION.md",
  "docs/references/AUTONOMY.md",
  "docs/references/MERGE_PHILOSOPHY.md",
  "docs/references/ENGINEER_ROLE.md",
]

let failures = 0

function fail(msg) {
  console.error(msg)
  failures += 1
}

for (const rel of requiredFiles) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) fail(`MISSING: ${rel}`)
}

function collectMd(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...collectMd(full))
    else if (name.endsWith(".md")) out.push(full)
  }
  return out
}

for (const file of [path.join(root, "AGENTS.md"), path.join(root, "ARCHITECTURE.md"), ...collectMd(path.join(root, "docs"))]) {
  const text = fs.readFileSync(file, "utf8")
  if (!/Last reviewed:\s*\d{4}-\d{2}-\d{2}/.test(text)) {
    fail(`MISSING Last reviewed marker: ${path.relative(root, file)}`)
  }
  if (!/Owner:\s*[A-Za-z]/.test(text)) {
    fail(`MISSING Owner marker: ${path.relative(root, file)}`)
  }
}

if (failures > 0) {
  console.error(`docs-contract-check failed (${failures} issue(s))`)
  process.exit(2)
}

console.log("docs-contract-check passed")
