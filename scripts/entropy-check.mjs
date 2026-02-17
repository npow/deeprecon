#!/usr/bin/env node
import fs from "fs"
import path from "path"

const root = process.cwd()
const maxLoc = Number(process.env.ENTROPY_MAX_LOC || 1200)
const warnLoc = Number(process.env.ENTROPY_WARN_LOC || 1000)
const staleDocDays = Number(process.env.ENTROPY_DOC_STALE_DAYS || 45)
const now = Date.now()
let failures = 0

function fail(msg) {
  console.error(msg)
  failures += 1
}

function walk(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

const codeFiles = walk(path.join(root, "src"), [".ts", ".tsx"])
for (const file of codeFiles) {
  const rel = path.relative(root, file)
  const loc = fs.readFileSync(file, "utf8").split("\n").length
  if (loc > warnLoc) {
    console.warn(`ENTROPY_WARN: ${rel} has ${loc} LOC (> ${warnLoc})`)
  }
  if (loc > maxLoc) fail(`ENTROPY: ${rel} has ${loc} LOC (> ${maxLoc})`)
}

const allFiles = walk(root, [".ts", ".tsx", ".js", ".mjs", ".md"])
let todoCount = 0
for (const file of allFiles) {
  const rel = path.relative(root, file)
  if (rel.startsWith(".next/") || rel.includes("package-lock.json")) continue
  const text = fs.readFileSync(file, "utf8")
  const matches = text.match(/\b(TODO|FIXME|HACK)\b/g)
  if (matches) todoCount += matches.length
}
if (todoCount > 80) fail(`ENTROPY: TODO/FIXME/HACK count too high (${todoCount})`)

const mdFiles = walk(path.join(root, "docs"), [".md"])
for (const file of mdFiles) {
  const text = fs.readFileSync(file, "utf8")
  const m = text.match(/Last reviewed:\s*(\d{4}-\d{2}-\d{2})/)
  if (!m) continue
  const ageDays = (now - new Date(`${m[1]}T00:00:00Z`).getTime()) / (24 * 3600 * 1000)
  if (ageDays > staleDocDays) {
    fail(`ENTROPY: stale docs review marker in ${path.relative(root, file)} (${Math.floor(ageDays)} days old)`)
  }
}

if (failures > 0) {
  console.error(`entropy-check failed (${failures} issue(s))`)
  process.exit(2)
}
console.log("entropy-check passed")
