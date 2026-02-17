import { Pool } from "pg"

let pool: Pool | null = null
let initPromise: Promise<void> | null = null

function getEnv(name: string): string | undefined {
  const val = process.env[name]
  return val && val.trim() ? val.trim() : undefined
}

function withNoVerifySslMode(url: string): string {
  if (/sslmode=/i.test(url)) {
    return url.replace(/sslmode=[^&]+/i, "sslmode=no-verify")
  }
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=no-verify`
}

function connectionConfig() {
  const databaseUrl = getEnv("DATABASE_URL")
  if (databaseUrl) {
    const url = withNoVerifySslMode(databaseUrl)
    return {
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      ssl: { rejectUnauthorized: false },
    }
  }

  return {
    host: getEnv("PGHOST") || getEnv("PSQL_HOST"),
    port: Number(getEnv("PGPORT") || getEnv("PSQL_PORT") || "5432"),
    user: getEnv("PGUSER") || getEnv("PSQL_USER"),
    password: getEnv("PGPASSWORD") || getEnv("PSQL_PASSWORD"),
    database: getEnv("PGDATABASE") || getEnv("PSQL_DATABASE") || "postgres",
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: false },
  }
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(connectionConfig())
  }
  return pool
}

export async function ensureDbSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const p = getPool()
      await p.query(`
        create table if not exists verticals (
          slug text primary key,
          name text not null,
          description text not null,
          updated_at timestamptz not null default now()
        );
      `)
      await p.query(`
        create table if not exists maps (
          slug text primary key,
          payload jsonb not null,
          updated_at timestamptz not null default now()
        );
      `)
      await p.query(`
        create table if not exists scans (
          id text primary key,
          created_at timestamptz not null,
          payload jsonb not null
        );
      `)
      await p.query(`
        create table if not exists scan_jobs (
          id text primary key,
          updated_at timestamptz not null,
          payload jsonb not null
        );
      `)
    })()
  }
  await initPromise
}
