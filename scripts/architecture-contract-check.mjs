#!/usr/bin/env node
import fs from "fs"
import path from "path"

const root = process.cwd()
let failures = 0

function fail(msg) {
  console.error(msg)
  failures += 1
}

const catalogPath = path.join(root, "src/lib/provider-catalog.ts")
if (!fs.existsSync(catalogPath)) fail("MISSING: src/lib/provider-catalog.ts")

const researchPath = path.join(root, "src/lib/research.ts")
const pipelinePath = path.join(root, "src/lib/ai/pipeline.ts")

const researchText = fs.existsSync(researchPath) ? fs.readFileSync(researchPath, "utf8") : ""
const pipelineText = fs.existsSync(pipelinePath) ? fs.readFileSync(pipelinePath, "utf8") : ""

if (!researchText.includes('from "@/lib/provider-catalog"')) {
  fail("ARCH: src/lib/research.ts must import provider catalog")
}
if (!pipelineText.includes('from "@/lib/provider-catalog"')) {
  fail("ARCH: src/lib/ai/pipeline.ts must import provider catalog")
}

const catalogText = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, "utf8") : ""
const idMatches = [...catalogText.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1])
const modelMatches = [...catalogText.matchAll(/model:\s*"([^"]+)"/g)].map((m) => m[1])

const dupIds = idMatches.filter((id, idx) => idMatches.indexOf(id) !== idx)
if (dupIds.length) fail(`ARCH: duplicate provider ids in catalog: ${[...new Set(dupIds)].join(", ")}`)

if (new Set(modelMatches).size < 8) {
  fail("ARCH: provider catalog model diversity unexpectedly low")
}

// Layering guardrails (lightweight static checks)
const componentFiles = []
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full)
    else if (/\.(ts|tsx)$/.test(name)) componentFiles.push(full)
  }
}
walk(path.join(root, "src/components"))

for (const file of componentFiles) {
  const text = fs.readFileSync(file, "utf8")
  if (text.includes("@/app/api/") || text.includes("src/app/api/")) {
    fail(`ARCH: UI layer importing API route internals: ${path.relative(root, file)}`)
  }
}

if (failures > 0) {
  console.error(`architecture-contract-check failed (${failures} issue(s))`)
  process.exit(2)
}

console.log("architecture-contract-check passed")
