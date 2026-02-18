import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

let pool = null;

function getEnv(name) {
  const val = process.env[name];
  return val && val.trim() ? val.trim() : undefined;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;

  let [, key, value] = match;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadLocalEnv() {
  const candidates = ['.env', '.env.local'];
  for (const rel of candidates) {
    const full = resolve(process.cwd(), rel);
    if (!existsSync(full)) continue;

    const lines = readFileSync(full, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}

function withNoVerifySslMode(url) {
  if (/sslmode=/i.test(url)) {
    return url.replace(/sslmode=[^&]+/i, 'sslmode=no-verify');
  }
  return `${url}${url.includes('?') ? '&' : '?'}sslmode=no-verify`;
}

function connectionConfig() {
  const databaseUrl = getEnv('DATABASE_URL');
  if (databaseUrl) {
    return {
      connectionString: withNoVerifySslMode(databaseUrl),
      max: 5,
      idleTimeoutMillis: 30_000,
      ssl: { rejectUnauthorized: false },
    };
  }

  return {
    host: getEnv('PGHOST') || getEnv('PSQL_HOST'),
    port: Number(getEnv('PGPORT') || getEnv('PSQL_PORT') || '5432'),
    user: getEnv('PGUSER') || getEnv('PSQL_USER'),
    password: getEnv('PGPASSWORD') || getEnv('PSQL_PASSWORD'),
    database: getEnv('PGDATABASE') || getEnv('PSQL_DATABASE') || 'postgres',
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: false },
  };
}

export function hasDbConfig() {
  return Boolean(
    getEnv('DATABASE_URL') ||
      getEnv('PGHOST') ||
      getEnv('PSQL_HOST') ||
      getEnv('PGUSER') ||
      getEnv('PSQL_USER'),
  );
}

function getPool() {
  if (!pool) {
    pool = new Pool(connectionConfig());
  }
  return pool;
}

export async function ensureIdeaPipelineSchema() {
  const p = getPool();
  await p.query(`
    create table if not exists idea_pipeline_runs (
      run_id text primary key,
      created_at timestamptz not null default now(),
      taxonomy_version text not null,
      requested_limit integer not null,
      coverage jsonb not null,
      selection jsonb not null
    );
  `);

  await p.query(`
    create table if not exists idea_pipeline_seen (
      key text primary key,
      status text not null default 'reserved',
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      last_run_id text references idea_pipeline_runs(run_id) on delete set null,
      metadata jsonb not null default '{}'::jsonb,
      check (status in ('reserved', 'completed', 'ignored'))
    );
  `);

  await p.query(`
    create index if not exists idx_idea_pipeline_seen_status
      on idea_pipeline_seen(status);
  `);

  await p.query(`
    create table if not exists idea_pipeline_observations (
      observation_id text primary key,
      created_at timestamptz not null default now(),
      key text not null,
      tuple_record jsonb not null,
      run_id text references idea_pipeline_runs(run_id) on delete set null,
      token_cost integer not null default 0,
      latency_ms integer not null default 0,
      proxy_score double precision,
      deep_score double precision,
      outcome_score double precision,
      reward double precision not null,
      reward_per_token double precision not null,
      metadata jsonb not null default '{}'::jsonb
    );
  `);

  await p.query(`
    create index if not exists idx_idea_pipeline_obs_created_at
      on idea_pipeline_observations(created_at desc);
  `);

  await p.query(`
    create index if not exists idx_idea_pipeline_obs_key
      on idea_pipeline_observations(key);
  `);

  await p.query(`
    create table if not exists idea_pipeline_models (
      model_id text primary key,
      created_at timestamptz not null default now(),
      model_type text not null,
      training_rows integer not null,
      model_blob jsonb not null,
      metrics jsonb not null default '{}'::jsonb
    );
  `);

  await p.query(`
    create index if not exists idx_idea_pipeline_models_created_at
      on idea_pipeline_models(created_at desc);
  `);

  await p.query(`
    create table if not exists idea_pipeline_rankings (
      ranking_id text primary key,
      created_at timestamptz not null default now(),
      run_id text references idea_pipeline_runs(run_id) on delete set null,
      model_id text references idea_pipeline_models(model_id) on delete set null,
      key text not null,
      rank integer not null,
      predicted_mean double precision not null,
      uncertainty double precision not null,
      acquisition_score double precision not null,
      metadata jsonb not null default '{}'::jsonb
    );
  `);
}

export async function loadSeenKeysFromDb(statuses = ['reserved', 'completed']) {
  const p = getPool();
  const { rows } = await p.query(
    `select key from idea_pipeline_seen where status = any($1::text[])`,
    [statuses],
  );
  return new Set(rows.map((row) => row.key));
}

export async function saveRun({ taxonomyVersion, requestedLimit, coverage, selection }) {
  const runId = randomUUID();
  const p = getPool();
  await p.query(
    `
      insert into idea_pipeline_runs (run_id, taxonomy_version, requested_limit, coverage, selection)
      values ($1, $2, $3, $4::jsonb, $5::jsonb)
    `,
    [runId, taxonomyVersion, requestedLimit, JSON.stringify(coverage), JSON.stringify(selection)],
  );
  return runId;
}

export async function reserveSeenKeys(runId, keys) {
  if (!keys.length) return;
  const p = getPool();
  await p.query(
    `
      insert into idea_pipeline_seen (key, status, last_run_id, metadata)
      select unnest($1::text[]), 'reserved', $2, '{"source":"generator"}'::jsonb
      on conflict (key) do update
      set
        status = case
          when idea_pipeline_seen.status = 'completed' then 'completed'
          else 'reserved'
        end,
        last_seen_at = now(),
        last_run_id = excluded.last_run_id
    `,
    [keys, runId],
  );
}

export async function markSeenKeysCompleted(runId, keys) {
  if (!keys.length) return;
  const p = getPool();
  await p.query(
    `
      insert into idea_pipeline_seen (key, status, last_run_id, metadata)
      select unnest($1::text[]), 'completed', $2, '{"source":"manual_complete"}'::jsonb
      on conflict (key) do update
      set
        status = 'completed',
        last_seen_at = now(),
        last_run_id = excluded.last_run_id
    `,
    [keys, runId || null],
  );
}

export async function insertObservation({
  observationId,
  key,
  tupleRecord,
  runId = null,
  tokenCost = 0,
  latencyMs = 0,
  proxyScore = null,
  deepScore = null,
  outcomeScore = null,
  reward,
  rewardPerToken,
  metadata = {},
}) {
  const p = getPool();
  await p.query(
    `
      insert into idea_pipeline_observations (
        observation_id, key, tuple_record, run_id, token_cost, latency_ms,
        proxy_score, deep_score, outcome_score, reward, reward_per_token, metadata
      )
      values (
        $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
      )
      on conflict (observation_id) do nothing
    `,
    [
      observationId,
      key,
      JSON.stringify(tupleRecord),
      runId,
      tokenCost,
      latencyMs,
      proxyScore,
      deepScore,
      outcomeScore,
      reward,
      rewardPerToken,
      JSON.stringify(metadata),
    ],
  );
}

export async function fetchObservationTrainingRows({ limit = 5000, lookbackHours = 24 * 14 } = {}) {
  const p = getPool();
  const { rows } = await p.query(
    `
      select key, tuple_record, reward_per_token
      from idea_pipeline_observations
      where created_at >= now() - ($1::text || ' hours')::interval
      order by created_at desc
      limit $2
    `,
    [String(lookbackHours), limit],
  );

  return rows.map((row) => ({
    key: row.key,
    tupleRecord: row.tuple_record,
    rewardPerToken: Number(row.reward_per_token),
  }));
}

export async function saveModelSnapshot({ modelId, modelType, trainingRows, modelBlob, metrics }) {
  const p = getPool();
  await p.query(
    `
      insert into idea_pipeline_models (model_id, model_type, training_rows, model_blob, metrics)
      values ($1, $2, $3, $4::jsonb, $5::jsonb)
    `,
    [modelId, modelType, trainingRows, JSON.stringify(modelBlob), JSON.stringify(metrics || {})],
  );
}

export async function loadLatestModelSnapshot() {
  const p = getPool();
  const { rows } = await p.query(
    `
      select model_id, model_type, training_rows, model_blob, metrics, created_at
      from idea_pipeline_models
      order by created_at desc
      limit 1
    `,
  );
  return rows[0] || null;
}

export async function saveRankingRows({ runId, modelId, rows }) {
  if (!rows?.length) return;
  const p = getPool();
  const rankingIds = rows.map(() => randomUUID());
  const keys = rows.map((row) => row.key);
  const ranks = rows.map((row) => row.rank);
  const means = rows.map((row) => row.predictedMean);
  const uncertainties = rows.map((row) => row.uncertainty);
  const acquisitionScores = rows.map((row) => row.acquisitionScore);
  const metadata = rows.map((row) => JSON.stringify(row.metadata || {}));

  await p.query(
    `
      insert into idea_pipeline_rankings (
        ranking_id, run_id, model_id, key, rank, predicted_mean, uncertainty, acquisition_score, metadata
      )
      select
        unnest($1::text[]),
        $2,
        $3,
        unnest($4::text[]),
        unnest($5::int[]),
        unnest($6::float8[]),
        unnest($7::float8[]),
        unnest($8::float8[]),
        unnest($9::text[])::jsonb
    `,
    [rankingIds, runId, modelId || null, keys, ranks, means, uncertainties, acquisitionScores, metadata],
  );
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
