#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { axisOrder } from './taxonomy.mjs';
import { closeDb, ensureIdeaPipelineSchema, fetchObservationTrainingRows, hasDbConfig, loadLocalEnv, saveModelSnapshot } from './db.mjs';
import { serializeModel, trainRidgeModel } from './model.mjs';

function parseArg(name, fallback = undefined) {
  const full = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (full) return full.split('=')[1];

  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];

  return fallback;
}

function toTuple(record) {
  return axisOrder.map((axis) => {
    if (!(axis in record)) {
      throw new Error(`Observation tuple missing axis ${axis}`);
    }
    return record[axis];
  });
}

async function main() {
  loadLocalEnv();
  if (!hasDbConfig()) {
    throw new Error('DB config missing. Set DATABASE_URL or PG* env variables.');
  }

  const limit = Number.parseInt(parseArg('limit', '5000'), 10);
  const lookbackHours = Number.parseInt(parseArg('lookback-hours', '336'), 10);
  const alpha = Number.parseFloat(parseArg('alpha', '2.0'));

  if (Number.isNaN(limit) || limit <= 0) throw new Error('limit must be > 0');
  if (Number.isNaN(lookbackHours) || lookbackHours <= 0) throw new Error('lookback-hours must be > 0');
  if (!Number.isFinite(alpha) || alpha <= 0) throw new Error('alpha must be > 0');

  await ensureIdeaPipelineSchema();
  const rawRows = await fetchObservationTrainingRows({ limit, lookbackHours });
  const rows = rawRows.map((row) => ({
    key: row.key,
    tuple: toTuple(row.tupleRecord),
    rewardPerToken: row.rewardPerToken,
  }));

  const model = trainRidgeModel({ rows, alpha });
  const modelId = randomUUID();
  const blob = serializeModel(model);

  await saveModelSnapshot({
    modelId,
    modelType: model.modelType,
    trainingRows: rows.length,
    modelBlob: blob,
    metrics: {
      mse: model.metrics.mse,
      sigma2: model.sigma2,
      lookbackHours,
      alpha,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        modelId,
        modelType: model.modelType,
        trainingRows: rows.length,
        mse: model.metrics.mse,
        sigma2: model.sigma2,
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
