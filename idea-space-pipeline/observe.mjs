#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { axisOrder } from './taxonomy.mjs';
import { canonicalKey, parseCanonicalKey } from './generator.mjs';
import {
  closeDb,
  ensureIdeaPipelineSchema,
  hasDbConfig,
  insertObservation,
  loadLocalEnv,
} from './db.mjs';

function parseArg(name, fallback = undefined) {
  const full = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (full) return full.split('=')[1];

  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];

  return fallback;
}

function parseNum(name, fallback = null) {
  const raw = parseArg(name);
  if (raw === undefined) return fallback;
  const val = Number(raw);
  if (Number.isNaN(val)) {
    throw new Error(`${name} must be numeric.`);
  }
  return val;
}

function normalizeTupleRecord(record) {
  const tuple = axisOrder.map((axis) => {
    if (!(axis in record)) {
      throw new Error(`Missing axis ${axis} in tuple record.`);
    }
    return record[axis];
  });
  return {
    tuple,
    record: Object.fromEntries(axisOrder.map((axis, i) => [axis, tuple[i]])),
  };
}

async function main() {
  loadLocalEnv();

  if (!hasDbConfig()) {
    throw new Error('DB config missing. Set DATABASE_URL or PG* env variables.');
  }

  const keyArg = parseArg('key');
  const tupleJsonArg = parseArg('tuple-json');
  const runId = parseArg('run-id', null);
  const tokenCost = Math.max(0, parseNum('token-cost', 0) ?? 0);
  const latencyMs = Math.max(0, parseNum('latency-ms', 0) ?? 0);
  const proxyScore = parseNum('proxy-score', null);
  const deepScore = parseNum('deep-score', null);
  const outcomeScore = parseNum('outcome-score', null);
  const rewardArg = parseNum('reward', null);

  if (!keyArg && !tupleJsonArg) {
    throw new Error('Provide either --key or --tuple-json.');
  }

  let key = keyArg;
  let tupleRecord;

  if (keyArg) {
    const parsed = parseCanonicalKey(keyArg);
    key = keyArg;
    tupleRecord = parsed.record;
  } else {
    const parsed = normalizeTupleRecord(JSON.parse(tupleJsonArg));
    tupleRecord = parsed.record;
    key = canonicalKey(parsed.tuple);
  }

  const computedReward =
    rewardArg ??
    (proxyScore ?? 0) * 0.3 +
      (deepScore ?? 0) * 0.5 +
      (outcomeScore ?? 0) * 0.2 -
      tokenCost * 0.00002 -
      latencyMs * 0.0000005;

  const rewardPerToken = computedReward / Math.max(1, tokenCost);

  await ensureIdeaPipelineSchema();
  const observationId = randomUUID();
  await insertObservation({
    observationId,
    key,
    tupleRecord,
    runId,
    tokenCost,
    latencyMs,
    proxyScore,
    deepScore,
    outcomeScore,
    reward: computedReward,
    rewardPerToken,
    metadata: {
      source: 'manual_observe',
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        observationId,
        key,
        reward: Number(computedReward.toFixed(6)),
        rewardPerToken: Number(rewardPerToken.toFixed(8)),
      },
      null,
      2,
    ),
  );

  await closeDb();
}

main().catch(async (error) => {
  await closeDb();
  throw error;
});
