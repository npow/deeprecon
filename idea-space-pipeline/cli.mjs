#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { axisOrder, taxonomyV1 } from './taxonomy.mjs';
import {
  canonicalKey,
  buildIdeaBrief,
  iterateTuples,
  noveltyDistance,
  renderIdeaPrompt,
  selectDiverseTopKFromIterator,
  tupleToRecord,
} from './generator.mjs';
import {
  closeDb,
  ensureIdeaPipelineSchema,
  hasDbConfig,
  loadLocalEnv,
  loadSeenKeysFromDb,
  markSeenKeysCompleted,
  reserveSeenKeys,
  saveRankingRows,
  saveRun,
} from './db.mjs';
import { rankCandidatesWithLLM } from './llm-ranker.mjs';

function parseArg(name, fallback = undefined) {
  const full = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (full) return full.split('=')[1];

  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];

  return fallback;
}

function loadSeenKeys(pathArg) {
  if (!pathArg) return new Set();

  const fullPath = resolve(process.cwd(), pathArg);
  const raw = readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('Seen-file JSON must be an array of canonical keys or records.');
  }

  const keys = parsed.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      return canonicalKey(axisOrder.map((axis) => item[axis]));
    }
    throw new Error('Invalid seen-file row. Expected string key or axis record object.');
  });

  return new Set(keys);
}

function mergeSets(...sets) {
  const merged = new Set();
  for (const set of sets) {
    for (const item of set) merged.add(item);
  }
  return merged;
}

function parseKeysCsv(argValue) {
  if (!argValue) return [];
  return argValue
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function clampInt(value, min, max) {
  const rounded = Math.floor(value);
  return Math.max(min, Math.min(max, rounded));
}

function pickDiverseByScore(candidates, limit, lambda = 0.75) {
  const selected = [];
  const pool = [...candidates];

  while (selected.length < limit && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i];
      const maxSimilarity = selected.length
        ? Math.max(...selected.map((s) => 1 - noveltyDistance(candidate.tuple, s.tuple)))
        : 0;
      const mmr = lambda * candidate.baseScore - (1 - lambda) * maxSimilarity;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }

    const picked = pool[bestIdx];
    picked.mmr = bestScore;
    selected.push(picked);
    pool.splice(bestIdx, 1);
  }

  selected.sort((a, b) => b.mmr - a.mmr);
  return selected;
}

async function main() {
  loadLocalEnv();

  const limit = Number.parseInt(parseArg('limit', '15'), 10);
  const shortlistFactor = Number.parseInt(parseArg('shortlist-factor', '4'), 10);
  const seenPath = parseArg('seen');
  const outPath = parseArg('out');
  const dbModeArg = parseArg('db');
  const completeKeysArg = parseArg('complete-keys');
  const ranker = parseArg('ranker', 'llm');
  const llmProvider = parseArg('llm-provider');
  const llmModel = parseArg('llm-model');
  const dbEnabled = dbModeArg ? dbModeArg !== '0' : hasDbConfig();

  if (Number.isNaN(limit) || limit <= 0) {
    throw new Error('limit must be a positive integer.');
  }
  if (Number.isNaN(shortlistFactor) || shortlistFactor < 1) {
    throw new Error('shortlist-factor must be >= 1.');
  }

  const fileSeenTupleKeys = loadSeenKeys(seenPath);
  let dbSeenTupleKeys = new Set();
  let runId = null;

  if (dbEnabled) {
    await ensureIdeaPipelineSchema();
    dbSeenTupleKeys = await loadSeenKeysFromDb(['reserved', 'completed']);
  }

  const seenTupleKeys = mergeSets(fileSeenTupleKeys, dbSeenTupleKeys);
  const shortlistLimit = clampInt(limit * shortlistFactor, limit, Math.max(200, limit));

  const heuristicShortlistResult = selectDiverseTopKFromIterator(
    iterateTuples(taxonomyV1),
    seenTupleKeys,
    shortlistLimit,
    0.75,
  );

  const shortlist = heuristicShortlistResult.selected.map((item) => ({
    ...item,
    baseScore: item.score,
    mmr: item.mmr,
  }));

  let rankingMeta = {
    ranker: 'heuristic',
    provider: null,
    model: null,
    llmFailed: false,
    llmError: null,
  };

  let finalSelected;
  if (ranker === 'llm') {
    try {
      const llmRanked = await rankCandidatesWithLLM({
        candidates: shortlist.map((s) => ({
          id: s.id,
          key: s.key,
          tuple: s.tuple,
          isCovered: s.isCovered,
          record: tupleToRecord(s.tuple),
          heuristicScore: s.score,
        })),
        provider: llmProvider,
        model: llmModel,
      });

      rankingMeta = {
        ranker: 'llm',
        provider: llmRanked.provider,
        model: llmRanked.model,
        llmFailed: false,
        llmError: null,
      };

      const llmCandidates = llmRanked.ranked.map((item) => ({
        tuple: item.tuple,
        key: item.key,
        id: item.id,
        isCovered: item.isCovered,
        baseScore: item.llm.score,
        mmr: 0,
        meta: {
          llmScore: item.llm.score,
          llmConfidence: item.llm.confidence,
          llmReason: item.llm.reason,
          heuristicScore: item.heuristicScore,
        },
      }));

      finalSelected = pickDiverseByScore(llmCandidates, limit, 0.8);
    } catch (error) {
      rankingMeta.llmFailed = true;
      rankingMeta.llmError = error instanceof Error ? error.message : String(error);
      finalSelected = shortlist.slice(0, limit);
    }
  } else {
    finalSelected = shortlist.slice(0, limit);
  }

  const coverage = {
    taxonomyVersion: taxonomyV1.version,
    totalCellsBeforeConstraints: heuristicShortlistResult.stats.totalCellsBeforeConstraints,
    validCellsAfterConstraints: heuristicShortlistResult.stats.validCellsAfterConstraints,
    invalidCells: heuristicShortlistResult.stats.invalidCells,
    seenCells: seenTupleKeys.size,
    seenCoveragePct: heuristicShortlistResult.stats.validCellsAfterConstraints
      ? Number(((seenTupleKeys.size / heuristicShortlistResult.stats.validCellsAfterConstraints) * 100).toFixed(2))
      : 0,
  };

  const selection = finalSelected.map((item, rank) => {
    const record = tupleToRecord(item.tuple);
    const idea = buildIdeaBrief(record);
    return {
      rank: rank + 1,
      id: item.id,
      score: Number(item.mmr.toFixed(4)),
      isCovered: item.isCovered,
      key: item.key,
      ranker: {
        name: rankingMeta.ranker,
        provider: rankingMeta.provider,
        model: rankingMeta.model,
        llmScore:
          item.meta?.llmScore !== undefined ? Number(item.meta.llmScore.toFixed(6)) : null,
        llmConfidence:
          item.meta?.llmConfidence !== undefined
            ? Number(item.meta.llmConfidence.toFixed(6))
            : null,
        llmReason: item.meta?.llmReason || null,
        heuristicScore:
          item.meta?.heuristicScore !== undefined
            ? Number(item.meta.heuristicScore.toFixed(6))
            : null,
      },
      idea,
      deepResearchTask: {
        key: item.key,
        rank: rank + 1,
        title: idea.title,
        researchQuestion: idea.researchQuestion,
        prompt: idea.deepResearchPrompt,
        context: {
          objective: idea.objective,
          evidencePlan: idea.evidencePlan,
          scope: idea.scope,
        },
      },
      record,
      prompt: renderIdeaPrompt(record),
    };
  });

  if (dbEnabled) {
    runId = await saveRun({
      taxonomyVersion: taxonomyV1.version,
      requestedLimit: limit,
      coverage,
      selection,
    });

    await reserveSeenKeys(
      runId,
      selection.map((item) => item.key),
    );

    await saveRankingRows({
      runId,
      modelId: null,
      rows: selection.map((item) => ({
        key: item.key,
        rank: item.rank,
        predictedMean: item.ranker.llmScore ?? item.score,
        uncertainty:
          item.ranker.llmConfidence !== null ? 1 - item.ranker.llmConfidence : 0.5,
        acquisitionScore: item.score,
        metadata: {
          source: 'cli_generation',
          ranker: item.ranker.name,
          provider: item.ranker.provider,
          model: item.ranker.model,
          llmReason: item.ranker.llmReason,
          llmFailed: rankingMeta.llmFailed,
          llmError: rankingMeta.llmError,
        },
      })),
    });

    const completedKeys = parseKeysCsv(completeKeysArg);
    if (completedKeys.length > 0) {
      await markSeenKeysCompleted(runId, completedKeys);
    }
  }

  const output = {
    coverage,
    persistence: {
      dbEnabled,
      runId,
      seenFromFile: fileSeenTupleKeys.size,
      seenFromDb: dbSeenTupleKeys.size,
      reservedThisRun: selection.length,
    },
    ranking: {
      ranker: rankingMeta.ranker,
      provider: rankingMeta.provider,
      model: rankingMeta.model,
      shortlistLimit,
      llmFailed: rankingMeta.llmFailed,
      llmError: rankingMeta.llmError,
    },
    selection,
  };

  const json = JSON.stringify(output, null, 2);

  if (outPath) {
    const resolvedOut = resolve(process.cwd(), outPath);
    writeFileSync(resolvedOut, json);
    // eslint-disable-next-line no-console
    console.log(`Wrote ${selection.length} candidates to ${resolvedOut}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(json);
  }

  if (dbEnabled) {
    await closeDb();
  }
}

main().catch(async (error) => {
  await closeDb();
  throw error;
});
