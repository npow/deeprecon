#!/usr/bin/env node
import { createClient } from "redis"

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const prefix = process.env.SCAN_REDIS_PREFIX || "deeprecon"

async function deleteByPattern(client, pattern) {
  const keys = await client.keys(pattern)
  if (keys.length === 0) return 0
  await client.del(keys)
  return keys.length
}

async function main() {
  const client = createClient({ url: redisUrl })
  await client.connect()

  const [hourlyDeleted, dailyDeleted] = await Promise.all([
    deleteByPattern(client, `${prefix}:ratelimit:hour:*`),
    deleteByPattern(client, `${prefix}:ratelimit:day:*`),
  ])

  const [activeDeleted, queuedDeleted] = await Promise.all([
    client.del(`${prefix}:scanqueue:active`),
    client.del(`${prefix}:scanqueue:queued`),
  ])

  console.log(JSON.stringify({
    redisUrl,
    prefix,
    deleted: {
      hourlyRateLimitKeys: hourlyDeleted,
      dailyRateLimitKeys: dailyDeleted,
      queueActiveKey: activeDeleted,
      queueQueuedKey: queuedDeleted,
    },
  }, null, 2))

  await client.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
