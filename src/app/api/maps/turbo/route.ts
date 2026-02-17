import { NextRequest } from "next/server"
import { type VerticalMap, type VerticalDefinition, type SubCategory, type MegaCategoryDef } from "@/lib/types"
import { saveMap, loadMap } from "@/lib/maps-store"
import { loadVerticals, saveVerticals, mergeVerticals } from "@/lib/verticals-store"
import { VERTICAL_MAP_PROMPT, SUBCATEGORY_ENRICH_PROMPT, VERTICAL_DISCOVERY_PROMPT } from "@/lib/ai/prompts"
import {
  parallelResearch,
  mergeSubCategories,
  mergePlayerLists,
  getAvailableProviders,
  DEFAULT_PROVIDERS,
  type ResearchProvider,
} from "@/lib/research"

let turboRunning = false

interface MapGenResult {
  schemaVersion: number
  totalPlayers: number
  totalFunding: string
  overallCrowdedness: number
  averageOpportunity: number
  megaCategories: MegaCategoryDef[]
  strategyCanvasFactors: string[]
  subCategories: SubCategory[]
}

export async function POST(request: NextRequest) {
  if (turboRunning) {
    return new Response(
      JSON.stringify({ error: "Turbo populate already running" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    )
  }

  // Parse options
  let selectedSlugs: string[] | undefined
  let selectedProviderIds: string[] | undefined
  let enrichAfter = true
  let enrichConcurrency = 3
  let discoverVerticals = false
  try {
    const body = await request.json()
    selectedSlugs = body.verticals
    selectedProviderIds = body.providers
    if (body.enrich === false) enrichAfter = false
    if (body.enrichConcurrency) enrichConcurrency = body.enrichConcurrency
    if (body.discover === true) discoverVerticals = true
  } catch {
    // defaults
  }

  // Discover which providers are actually available on CLIProxyAPI
  const availableProviders = await getAvailableProviders()
  const providers: ResearchProvider[] = selectedProviderIds
    ? availableProviders.filter((p) => selectedProviderIds!.includes(p.id))
    : availableProviders

  if (providers.length === 0) {
    return new Response(
      JSON.stringify({
        error: "No AI providers available. Check that CLIProxyAPI is running and at least one provider is authenticated.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )
  }

  turboRunning = true

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }

      try {
        // ── Phase 0: Vertical Discovery (optional) ──
        let allVerticals: VerticalDefinition[] = loadVerticals()

        if (discoverVerticals) {
          send("turbo_status", {
            phase: "discovery",
            message: `Discovering verticals across ${providers.length} providers...`,
            providers: providers.map((p) => ({ id: p.id, label: p.label })),
          })

          const { results, errors } = await parallelResearch<{
            verticals: VerticalDefinition[]
          }>({
            systemPrompt: VERTICAL_DISCOVERY_PROMPT,
            userMessage: "Identify ALL investable startup technology verticals worth mapping. Be comprehensive — cover every meaningful category from infrastructure to vertical SaaS to deep tech.",
            providers,
            timeoutMs: 120_000,
            onResult: (providerId, data) => {
              send("discovery_result", {
                provider: providerId,
                count: data.verticals?.length || 0,
              })
            },
            onError: (providerId, error) => {
              send("discovery_result", {
                provider: providerId,
                count: 0,
                error,
              })
            },
          })

          // Merge discovered verticals from all providers
          const allDiscovered = results.flatMap((r) => r.data.verticals || [])
          const { merged, newCount } = mergeVerticals(allVerticals, allDiscovered)
          allVerticals = merged
          saveVerticals(allVerticals)

          send("discovery_complete", {
            totalVerticals: allVerticals.length,
            newlyDiscovered: newCount,
            providersFailed: errors.length,
          })
        }

        // Determine which verticals to generate maps for
        const verticals = selectedSlugs
          ? allVerticals.filter((v) => selectedSlugs!.includes(v.slug))
          : allVerticals

        if (verticals.length === 0) {
          send("turbo_error", { message: "No verticals to process" })
          return
        }

        // ── Phase 1: Generate all vertical maps in parallel ──
        send("turbo_status", {
          phase: "map_generation",
          message: `Generating ${verticals.length} vertical maps across ${providers.length} providers (${verticals.length * providers.length} total calls)`,
          providers: providers.map((p) => ({ id: p.id, label: p.label, model: p.model })),
        })

        const mapResults = await Promise.allSettled(
          verticals.map(async (vertical) => {
            send("vertical_start", {
              slug: vertical.slug,
              name: vertical.name,
              providerCount: providers.length,
            })

            const { results, errors } = await parallelResearch<MapGenResult>({
              systemPrompt: VERTICAL_MAP_PROMPT,
              userMessage: `Generate a comprehensive landscape map for this vertical:\n\nVERTICAL: ${vertical.name}\nDESCRIPTION: ${vertical.description}`,
              providers,
              timeoutMs: 600_000, // 10 min — map gen is a big call
              onResult: (providerId, _data, dur) => {
                send("provider_complete", {
                  slug: vertical.slug,
                  provider: providerId,
                  durationMs: dur,
                  success: true,
                })
              },
              onError: (providerId, error) => {
                send("provider_complete", {
                  slug: vertical.slug,
                  provider: providerId,
                  success: false,
                  error,
                })
              },
            })

            if (results.length === 0) {
              send("vertical_error", {
                slug: vertical.slug,
                errors: errors.map((e) => `${e.label}: ${e.error}`),
              })
              return null
            }

            // Merge subcategories from all successful providers
            const allSubCats = results.map((r) => r.data.subCategories || [])
            const mergedSubs = mergeSubCategories(...allSubCats)

            // Collect all megaCategories and strategyCanvasFactors
            const megaCatMap = new Map<string, MegaCategoryDef>()
            const factorSet = new Set<string>()
            for (const r of results) {
              for (const mc of r.data.megaCategories || []) {
                if (!megaCatMap.has(mc.name)) megaCatMap.set(mc.name, mc)
              }
              for (const f of r.data.strategyCanvasFactors || []) {
                factorSet.add(f)
              }
            }

            const totalPlayers = mergedSubs.reduce((s, sub) => s + sub.playerCount, 0)

            const map: VerticalMap = {
              slug: vertical.slug,
              name: vertical.name,
              description: vertical.description,
              generatedAt: new Date().toISOString(),
              schemaVersion: 3,
              totalPlayers,
              totalFunding: results[0].data.totalFunding || "N/A",
              overallCrowdedness: Math.round(
                mergedSubs.reduce((s, sub) => s + sub.crowdednessScore, 0) / mergedSubs.length,
              ),
              averageOpportunity: Math.round(
                mergedSubs.reduce((s, sub) => s + sub.opportunityScore, 0) / mergedSubs.length,
              ),
              megaCategories: Array.from(megaCatMap.values()),
              strategyCanvasFactors: Array.from(factorSet).slice(0, 8),
              subCategories: mergedSubs,
            }

            saveMap(vertical.slug, map)

            send("vertical_complete", {
              slug: vertical.slug,
              subCategories: mergedSubs.length,
              totalPlayers,
              providersUsed: results.length,
              providersFailed: errors.length,
            })

            return map
          }),
        )

        // Gather successfully generated maps
        const maps: VerticalMap[] = []
        for (const r of mapResults) {
          if (r.status === "fulfilled" && r.value) maps.push(r.value)
        }

        // ── Phase 2: Parallel enrichment (optional) ──
        if (enrichAfter && maps.length > 0) {
          const enrichTargets: { map: VerticalMap; sub: SubCategory }[] = []
          for (const map of maps) {
            for (const sub of map.subCategories) {
              enrichTargets.push({ map, sub })
            }
          }

          send("turbo_status", {
            phase: "enrichment",
            message: `Enriching ${enrichTargets.length} subcategories across ${providers.length} providers`,
          })

          // Concurrency limiter
          const sem = { active: 0, max: enrichConcurrency, queue: [] as (() => void)[] }
          async function acquire() {
            if (sem.active < sem.max) { sem.active++; return }
            await new Promise<void>((r) => sem.queue.push(r))
          }
          function release() {
            sem.active--
            const next = sem.queue.shift()
            if (next) { sem.active++; next() }
          }

          let enrichedCount = 0
          let totalNewPlayers = 0

          await Promise.allSettled(
            enrichTargets.map(async ({ map, sub }) => {
              await acquire()
              try {
                const existingNames = sub.topPlayers.map((p) => p.name).join(", ")

                const { results } = await parallelResearch<{
                  newPlayers: SubCategory["topPlayers"]
                  updatedPlayers: SubCategory["topPlayers"]
                }>({
                  systemPrompt: SUBCATEGORY_ENRICH_PROMPT,
                  userMessage: `VERTICAL: ${map.name}\n\nSUB-CATEGORY: ${sub.name}\nDESCRIPTION: ${sub.description}\nKEY GAPS: ${sub.keyGaps.join("; ")}\n\nSTRATEGY CANVAS FACTORS: ${map.strategyCanvasFactors.join(", ")}\n\nEXISTING PLAYERS (do NOT re-list these as new):\n${existingNames}\n\nFind additional players in this sub-category that are NOT in the existing list above.`,
                  providers,
                  timeoutMs: 300_000,
                })

                const allNewPlayers = results.flatMap((r) => r.data.newPlayers || [])
                if (allNewPlayers.length > 0) {
                  const { merged } = mergePlayerLists(sub.topPlayers, allNewPlayers)
                  const newCount = merged.length - sub.topPlayers.length

                  const subIdx = map.subCategories.findIndex((s) => s.slug === sub.slug)
                  if (subIdx !== -1) {
                    map.subCategories[subIdx].topPlayers = merged
                    map.subCategories[subIdx].playerCount = merged.length
                    map.subCategories[subIdx].lastEnrichedAt = new Date().toISOString()
                  }

                  totalNewPlayers += newCount
                  saveMap(map.slug, map)
                }

                enrichedCount++
                send("enrich_progress", {
                  slug: map.slug,
                  subSlug: sub.slug,
                  subName: sub.name,
                  enriched: enrichedCount,
                  total: enrichTargets.length,
                  newPlayersThisSub: allNewPlayers.length,
                })
              } catch {
                enrichedCount++
              } finally {
                release()
              }
            }),
          )

          for (const map of maps) {
            map.totalPlayers = map.subCategories.reduce((s, sub) => s + sub.playerCount, 0)
            map.lastEnrichedAt = new Date().toISOString()
            saveMap(map.slug, map)
          }

          send("turbo_status", {
            phase: "enrichment_complete",
            message: `Enriched ${enrichedCount} subcategories, found ${totalNewPlayers} new players`,
          })
        }

        // ── Done ──
        const totalPlayers = maps.reduce((s, m) => s + m.totalPlayers, 0)
        const totalSubs = maps.reduce((s, m) => s + m.subCategories.length, 0)

        send("turbo_done", {
          verticalsGenerated: maps.length,
          verticalsFailed: verticals.length - maps.length,
          totalSubCategories: totalSubs,
          totalPlayers,
        })
      } catch (err) {
        send("turbo_error", {
          message: err instanceof Error ? err.message : "Turbo populate failed",
        })
      } finally {
        turboRunning = false
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

// GET returns current provider availability and verticals
export async function GET() {
  const available = await getAvailableProviders()
  const availableIds = new Set(available.map((p) => p.id))
  const verticals = loadVerticals()

  return new Response(
    JSON.stringify({
      running: turboRunning,
      providers: DEFAULT_PROVIDERS
        .map((p) => ({
          id: p.id,
          label: p.label,
          model: p.model,
          available: availableIds.has(p.id),
        }))
        .sort((a, b) => {
          // Sort: available first, then alphabetically by label
          if (a.available !== b.available) return a.available ? -1 : 1
          return a.label.localeCompare(b.label)
        }),
      availableCount: available.length,
      verticals: verticals.map((v) => ({
        slug: v.slug,
        name: v.name,
        description: v.description,
        hasMap: !!loadMap(v.slug),
      })),
    }),
    { headers: { "Content-Type": "application/json" } },
  )
}
