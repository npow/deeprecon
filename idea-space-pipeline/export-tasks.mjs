#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArg(name, fallback = undefined) {
  const full = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (full) return full.split('=')[1];

  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];

  return fallback;
}

function main() {
  const inputPath = parseArg('input');
  const outputPath = parseArg('out', 'idea-space-pipeline/examples/deep-research-tasks.jsonl');
  const format = parseArg('format', 'jsonl');

  if (!inputPath) {
    throw new Error('Missing --input path.');
  }

  const input = JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8'));
  if (!Array.isArray(input.selection)) {
    throw new Error('Input file missing selection array.');
  }

  const tasks = input.selection.map((item) => ({
    key: item.key,
    rank: item.rank,
    title: item.idea?.title || item.deepResearchTask?.title || item.key,
    researchQuestion:
      item.idea?.researchQuestion || item.deepResearchTask?.researchQuestion || '',
    prompt: item.deepResearchTask?.prompt || item.prompt,
    context: item.deepResearchTask?.context || {
      objective: item.idea?.objective || null,
      evidencePlan: item.idea?.evidencePlan || [],
      scope: item.idea?.scope || null,
    },
    tuple: item.record,
  }));

  const outFull = resolve(process.cwd(), outputPath);
  if (format === 'json') {
    writeFileSync(outFull, JSON.stringify({ tasks }, null, 2));
  } else {
    writeFileSync(outFull, `${tasks.map((t) => JSON.stringify(t)).join('\n')}\n`);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote ${tasks.length} tasks to ${outFull}`);
}

main();
