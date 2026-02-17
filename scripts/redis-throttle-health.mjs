#!/usr/bin/env node
import { createClient } from "redis"

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const prefix = process.env.SCAN_REDIS_PREFIX || "deeprecon"

async function main() {
  const client = createClient({ url: redisUrl })
  await client.connect()

  const [activeRaw, queuedRaw] = await Promise.all([
    client.get(`${prefix}:scanqueue:active`),
    client.get(`${prefix}:scanqueue:queued`),
  ])

  const hourlyKeys = await client.keys(`${prefix}:ratelimit:hour:*`)
  const dailyKeys = await client.keys(`${prefix}:ratelimit:day:*`)

  console.log(JSON.stringify({
    redisUrl,
    prefix,
    queue: {
      active: Number(activeRaw || 0),
      queued: Number(queuedRaw || 0),
    },
    rateLimitKeys: {
      hourly: hourlyKeys.length,
      daily: dailyKeys.length,
    },
  }, null, 2))

  await client.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
