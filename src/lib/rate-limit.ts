// ─── Token bucket rate limiter (in-memory, per IP) ───

interface Bucket {
  tokens: number
  lastRefill: number
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export class RateLimiter {
  private hourly = new Map<string, Bucket>()
  private daily = new Map<string, Bucket>()
  private maxPerHour: number
  private maxPerDay: number

  constructor(
    maxPerHour = parseInt(process.env.RATE_LIMIT_HOUR || "3", 10),
    maxPerDay = parseInt(process.env.RATE_LIMIT_DAY || "10", 10),
  ) {
    this.maxPerHour = maxPerHour
    this.maxPerDay = maxPerDay
  }

  /**
   * Check if request is allowed. Returns { allowed, retryAfterMs }.
   */
  check(ip: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now()

    // Hourly bucket
    let hBucket = this.hourly.get(ip)
    if (!hBucket) {
      hBucket = { tokens: this.maxPerHour, lastRefill: now }
      this.hourly.set(ip, hBucket)
    } else {
      const elapsed = now - hBucket.lastRefill
      if (elapsed >= HOUR_MS) {
        hBucket.tokens = this.maxPerHour
        hBucket.lastRefill = now
      }
    }

    // Daily bucket
    let dBucket = this.daily.get(ip)
    if (!dBucket) {
      dBucket = { tokens: this.maxPerDay, lastRefill: now }
      this.daily.set(ip, dBucket)
    } else {
      const elapsed = now - dBucket.lastRefill
      if (elapsed >= DAY_MS) {
        dBucket.tokens = this.maxPerDay
        dBucket.lastRefill = now
      }
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

  /** Periodic cleanup of stale entries */
  cleanup() {
    const now = Date.now()
    for (const [ip, bucket] of this.hourly) {
      if (now - bucket.lastRefill > HOUR_MS * 2) this.hourly.delete(ip)
    }
    for (const [ip, bucket] of this.daily) {
      if (now - bucket.lastRefill > DAY_MS * 2) this.daily.delete(ip)
    }
  }
}

// ─── Scan queue (concurrency limiter) ───

export class ScanQueue {
  private active = 0
  private waiting: { resolve: (position: number) => void }[] = []
  private maxConcurrency: number

  constructor(maxConcurrency = parseInt(process.env.SCAN_MAX_CONCURRENCY || "2", 10)) {
    this.maxConcurrency = maxConcurrency
  }

  /**
   * Acquire a slot. Returns queue position (0 = immediate, 1+ = waiting).
   */
  async acquire(): Promise<number> {
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

  /** Get current queue length */
  get queueLength(): number {
    return this.waiting.length
  }

  release() {
    this.active--
    const next = this.waiting.shift()
    if (next) {
      this.active++
      next.resolve(0)
    }
  }
}

// ─── Singletons (survive across requests in the same process) ───

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
