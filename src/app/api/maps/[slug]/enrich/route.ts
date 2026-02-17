import { NextRequest } from "next/server"
import { loadMap, saveMap } from "@/lib/maps-store"
import { loadVerticals } from "@/lib/verticals-store"
import { enrichSubCategory } from "@/lib/ai/pipeline"
import { mergeEnrichmentResults } from "@/lib/enrich"

// In-memory lock per slug to prevent concurrent enrichment runs
const enrichLocks = new Map<string, boolean>()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const verticals = await loadVerticals()
  const vertical = verticals.find((v) => v.slug === slug)
  if (!vertical) {
    return new Response(JSON.stringify({ error: "Unknown vertical" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }

  const map = await loadMap(slug)
  if (!map) {
    return new Response(JSON.stringify({ error: "Map not generated yet" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!process.env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Check lock
  if (enrichLocks.get(slug)) {
    return new Response(JSON.stringify({ error: "Enrichment already running for this map" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Parse body for optional subSlugs filter
  let subSlugs: string[] | undefined
  try {
    const body = await request.json()
    subSlugs = body.subSlugs
  } catch {
    // No body or invalid JSON — enrich all
  }

  // Determine which subcategories to enrich
  const targets = subSlugs
    ? map.subCategories.filter((s) => subSlugs!.includes(s.slug))
    : map.subCategories

  if (targets.length === 0) {
    return new Response(JSON.stringify({ error: "No matching subcategories" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Lock
  enrichLocks.set(slug, true)

  // SSE stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      let totalNew = 0
      let totalUpdated = 0

      try {
        for (let i = 0; i < targets.length; i++) {
          const sub = targets[i]

          send("enrich_start", {
            subSlug: sub.slug,
            subName: sub.name,
            index: i + 1,
            total: targets.length,
          })

          try {
            const result = await enrichSubCategory(
              map.name,
              sub,
              map.strategyCanvasFactors
            )

            const { merged, newCount, updatedCount } = mergeEnrichmentResults(
              sub.topPlayers,
              result.newPlayers || [],
              result.updatedPlayers || []
            )

            // Update the map in place
            const subIndex = map.subCategories.findIndex((s) => s.slug === sub.slug)
            if (subIndex !== -1) {
              map.subCategories[subIndex].topPlayers = merged
              map.subCategories[subIndex].playerCount = merged.length
              map.subCategories[subIndex].lastEnrichedAt = new Date().toISOString()
            }

            // Save after each subcategory for partial progress persistence
            await saveMap(slug, map)

            totalNew += newCount
            totalUpdated += updatedCount

            send("enrich_complete", {
              subSlug: sub.slug,
              newCount,
              updatedCount,
            })
          } catch (err) {
            send("enrich_error", {
              message: err instanceof Error ? err.message : "Enrichment failed",
              subSlug: sub.slug,
            })
            // Continue with next subcategory
          }
        }

        // Update top-level stats
        map.totalPlayers = map.subCategories.reduce((sum, s) => sum + s.playerCount, 0)
        map.lastEnrichedAt = new Date().toISOString()
        await saveMap(slug, map)

        send("enrich_done", { totalNew, totalUpdated })
      } catch (err) {
        send("enrich_error", {
          message: err instanceof Error ? err.message : "Enrichment failed",
        })
      } finally {
        enrichLocks.delete(slug)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
