import { createClient } from "redis"

const HOUR_SEC = 60 * 60
const DAY_SEC = 24 * HOUR_SEC

const RATE_LIMIT_CHECK_LUA = `
local hour_key = KEYS[1]
local day_key = KEYS[2]
local max_hour = tonumber(ARGV[1])
local max_day = tonumber(ARGV[2])
local hour_ttl = tonumber(ARGV[3])
local day_ttl = tonumber(ARGV[4])

local hour_count = redis.call("INCR", hour_key)
if hour_count == 1 then redis.call("EXPIRE", hour_key, hour_ttl) end
local day_count = redis.call("INCR", day_key)
if day_count == 1 then redis.call("EXPIRE", day_key, day_ttl) end

local hour_left = redis.call("TTL", hour_key)
local day_left = redis.call("TTL", day_key)

if hour_count > max_hour then
  return {0, hour_left}
end
if day_count > max_day then
  return {0, day_left}
end
return {1, 0}
`

const QUEUE_TRY_ACQUIRE_LUA = `
local active_key = KEYS[1]
local queue_key = KEYS[2]
local max_concurrency = tonumber(ARGV[1])
local active_ttl = tonumber(ARGV[2])
local queue_ttl = tonumber(ARGV[3])

local active = tonumber(redis.call("GET", active_key) or "0")
if active < max_concurrency then
  redis.call("INCR", active_key)
  redis.call("EXPIRE", active_key, active_ttl)
  local q = tonumber(redis.call("DECR", queue_key))
  if q < 0 then redis.call("SET", queue_key, "0") end
  redis.call("EXPIRE", queue_key, queue_ttl)
  return 1
end
return 0
`

const QUEUE_RELEASE_LUA = `
local active_key = KEYS[1]
local active = tonumber(redis.call("GET", active_key) or "0")
if active <= 0 then
  redis.call("SET", active_key, "0")
  return 0
end
active = redis.call("DECR", active_key)
if active < 0 then
  redis.call("SET", active_key, "0")
  return 0
end
return active
`

type RedisClient = ReturnType<typeof createClient>

let redis: RedisClient | null = null
let redisConnectPromise: Promise<RedisClient | null> | null = null

function redisUrl(): string | undefined {
  const val = process.env.REDIS_URL
  return val && val.trim() ? val.trim() : undefined
}

function keyPrefix(): string {
  const val = process.env.SCAN_REDIS_PREFIX
  return val && val.trim() ? val.trim() : "deeprecon"
}

async function getRedis(): Promise<RedisClient | null> {
  if (redis) return redis
  if (redisConnectPromise) return redisConnectPromise

  const url = redisUrl()
  if (!url) return null

  redisConnectPromise = (async () => {
    const client = createClient({ url })
    client.on("error", (err) => {
      console.error("Redis error:", err)
    })
    await client.connect()
    redis = client
    return redis
  })().catch((err) => {
    console.error("Failed to connect Redis for throttling:", err)
    redis = null
    return null
  })

  return redisConnectPromise
}

export class RateLimiter {
  private maxPerHour: number
  private maxPerDay: number
  private prefix: string
  private hourly = new Map<string, { tokens: number; lastRefill: number }>()
  private daily = new Map<string, { tokens: number; lastRefill: number }>()

  constructor(
    maxPerHour = parseInt(process.env.RATE_LIMIT_HOUR || "3", 10),
    maxPerDay = parseInt(process.env.RATE_LIMIT_DAY || "10", 10),
  ) {
    this.maxPerHour = maxPerHour
    this.maxPerDay = maxPerDay
    this.prefix = `${keyPrefix()}:ratelimit`
  }

  /**
   * Check if request is allowed. Returns { allowed, retryAfterMs }.
   */
  async check(ip: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const client = await getRedis()
    if (!client) {
      // Fallback for local/dev if Redis isn't configured.
      const now = Date.now()
      const HOUR_MS = HOUR_SEC * 1000
      const DAY_MS = DAY_SEC * 1000

      let hBucket = this.hourly.get(ip)
      if (!hBucket) {
        hBucket = { tokens: this.maxPerHour, lastRefill: now }
        this.hourly.set(ip, hBucket)
      } else if (now - hBucket.lastRefill >= HOUR_MS) {
        hBucket.tokens = this.maxPerHour
        hBucket.lastRefill = now
      }

      let dBucket = this.daily.get(ip)
      if (!dBucket) {
        dBucket = { tokens: this.maxPerDay, lastRefill: now }
        this.daily.set(ip, dBucket)
      } else if (now - dBucket.lastRefill >= DAY_MS) {
        dBucket.tokens = this.maxPerDay
        dBucket.lastRefill = now
      }

      if (hBucket.tokens <= 0) {
        const retryAfterMs = HOUR_MS - (now - hBucket.lastRefill)
        return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) }
      }
      if (dBucket.tokens <= 0) {
        const retryAfterMs = DAY_MS - (now - dBucket.lastRefill)
        return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) }
      }

      hBucket.tokens--
      dBucket.tokens--
      return { allowed: true, retryAfterMs: 0 }
    }

    const hourKey = `${this.prefix}:hour:${ip}`
    const dayKey = `${this.prefix}:day:${ip}`

    const raw = await client.eval(RATE_LIMIT_CHECK_LUA, {
      keys: [hourKey, dayKey],
      arguments: [
        String(this.maxPerHour),
        String(this.maxPerDay),
        String(HOUR_SEC),
        String(DAY_SEC),
      ],
    })

    const res = (raw as number[]) || [0, 1]
    const allowed = res[0] === 1
    const retryAfterSec = Math.max(Number(res[1] || 1), 1)
    return {
      allowed,
      retryAfterMs: allowed ? 0 : retryAfterSec * 1000,
    }
  }
}

export class ScanQueue {
  private maxConcurrency: number
  private prefix: string
  private pollMs: number
  private active = 0
  private waiting: { resolve: (position: number) => void }[] = []

  constructor(maxConcurrency = parseInt(process.env.SCAN_MAX_CONCURRENCY || "2", 10)) {
    this.maxConcurrency = maxConcurrency
    this.prefix = `${keyPrefix()}:scanqueue`
    this.pollMs = parseInt(process.env.SCAN_QUEUE_POLL_MS || "250", 10)
  }

  private activeKey() {
    return `${this.prefix}:active`
  }

  private queuedKey() {
    return `${this.prefix}:queued`
  }

  /**
   * Acquire a slot. Returns queue position (0 = immediate, 1+ = waiting).
   */
  async acquire(): Promise<number> {
    const client = await getRedis()
    if (!client) {
      if (this.active < this.maxConcurrency) {
        this.active++
        return 0
      }
      const position = this.waiting.length + 1
      await new Promise<number>((resolve) => {
        this.waiting.push({ resolve })
      })
      return position
    }

    const position = await client.incr(this.queuedKey())
    await client.expire(this.queuedKey(), DAY_SEC)

    while (true) {
      const acquired = await client.eval(QUEUE_TRY_ACQUIRE_LUA, {
        keys: [this.activeKey(), this.queuedKey()],
        arguments: [
          String(this.maxConcurrency),
          String(DAY_SEC),
          String(DAY_SEC),
        ],
      })

      if (Number(acquired) === 1) {
        return Math.max(position - 1, 0)
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
    }
  }

  /** Get current queue length */
  async queueLength(): Promise<number> {
    const client = await getRedis()
    if (!client) return this.waiting.length
    const raw = await client.get(this.queuedKey())
    return Math.max(Number(raw || 0), 0)
  }

  async release(): Promise<void> {
    const client = await getRedis()
    if (!client) {
      this.active--
      const next = this.waiting.shift()
      if (next) {
        this.active++
        next.resolve(0)
      }
      return
    }
    await client.eval(QUEUE_RELEASE_LUA, {
      keys: [this.activeKey()],
      arguments: [],
    })
  }
}

// ─── Singletons ───

let _rateLimiter: RateLimiter | undefined
let _scanQueue: ScanQueue | undefined

export function getRateLimiter(): RateLimiter {
  if (!_rateLimiter) _rateLimiter = new RateLimiter()
  return _rateLimiter
}

export function getScanQueue(): ScanQueue {
  if (!_scanQueue) _scanQueue = new ScanQueue()
  return _scanQueue
}
