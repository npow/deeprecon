import { NextRequest, NextResponse } from "next/server"
import { loadMap, saveMap } from "@/lib/maps-store"
import { loadVerticals } from "@/lib/verticals-store"
import { generateVerticalMap } from "@/lib/ai/pipeline"
import { VERTICAL_MAP_PROMPT } from "@/lib/ai/prompts"
import { type VerticalMap, type MegaCategoryDef, type SubCategory } from "@/lib/types"
import {
  parallelResearch,
  mergeSubCategories,
  getAvailableProviders,
  type ResearchProvider,
} from "@/lib/research"
import { withRelayTelemetry } from "@/lib/relay-observability"

// In-memory lock per slug to prevent concurrent refresh runs
const refreshLocks = new Map<string, boolean>()

async function getMap(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const verticals = await loadVerticals()
  const vertical = verticals.find((v) => v.slug === slug)
  if (!vertical) {
    return NextResponse.json({ error: "Unknown vertical" }, { status: 404 })
  }

  const map = await loadMap(slug)
  if (!map) {
    return NextResponse.json({ error: "Map not generated yet" }, { status: 404 })
  }

  return NextResponse.json(map)
}

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

/** Merge a single provider's result into the existing map on disk and return updated stats */
async function mergeProviderIntoMap(
  slug: string,
  vertical: { name: string; description: string; slug: string },
  providerData: MapGenResult,
): Promise<{ totalPlayers: number; subCategories: number; previousPlayers: number; previousSubs: number }> {
  const existingMap = await loadMap(slug)
  const previousPlayers = existingMap?.totalPlayers || 0
  const previousSubs = existingMap?.subCategories?.length || 0

  // Merge sub-categories: existing + new provider
  const subCatSources: SubCategory[][] = []
  if (existingMap?.subCategories?.length) {
    subCatSources.push(existingMap.subCategories)
  }
  if (providerData.subCategories?.length) {
    subCatSources.push(providerData.subCategories)
  }
  const mergedSubs = subCatSources.length > 0 ? mergeSubCategories(...subCatSources) : []

  // Merge mega categories
  const megaCatMap = new Map<string, MegaCategoryDef>()
  if (existingMap?.megaCategories) {
    for (const mc of existingMap.megaCategories) {
      megaCatMap.set(mc.name, mc)
    }
  }
  for (const mc of providerData.megaCategories || []) {
    if (!megaCatMap.has(mc.name)) megaCatMap.set(mc.name, mc)
  }

  // Merge strategy canvas factors
  const factorSet = new Set<string>(existingMap?.strategyCanvasFactors || [])
  for (const f of providerData.strategyCanvasFactors || []) {
    factorSet.add(f)
  }

  const totalPlayers = mergedSubs.reduce((s, sub) => s + sub.playerCount, 0)

  const map: VerticalMap = {
    slug: vertical.slug,
    name: vertical.name,
    description: vertical.description,
    generatedAt: new Date().toISOString(),
    schemaVersion: 3,
    totalPlayers,
    totalFunding: providerData.totalFunding || existingMap?.totalFunding || "N/A",
    overallCrowdedness: mergedSubs.length > 0
      ? Math.round(mergedSubs.reduce((s, sub) => s + sub.crowdednessScore, 0) / mergedSubs.length)
      : 0,
    averageOpportunity: mergedSubs.length > 0
      ? Math.round(mergedSubs.reduce((s, sub) => s + sub.opportunityScore, 0) / mergedSubs.length)
      : 0,
    megaCategories: Array.from(megaCatMap.values()),
    strategyCanvasFactors: Array.from(factorSet).slice(0, 8),
    subCategories: mergedSubs,
  }

  await saveMap(slug, map)
  return { totalPlayers, subCategories: mergedSubs.length, previousPlayers, previousSubs }
}

async function postMap(
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

  // Check lock
  if (refreshLocks.get(slug)) {
    return new Response(JSON.stringify({ error: "Refresh already running for this map" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Parse optional provider selection from body
  let selectedProviderIds: string[] | undefined
  try {
    const body = await request.json()
    selectedProviderIds = body.providers
  } catch {
    // No body — use all available
  }

  // Determine providers
  const availableProviders = await getAvailableProviders()
  const providers: ResearchProvider[] = selectedProviderIds
    ? availableProviders.filter((p) => selectedProviderIds!.includes(p.id))
    : availableProviders

  // If no proxy providers and no Gemini key, bail early (non-SSE)
  if (providers.length === 0 && !process.env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "No AI providers available (CLIProxyAPI offline and GEMINI_API_KEY not configured)" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    )
  }

  // Lock
  refreshLocks.set(slug, true)

  // Track stats for the final summary
  let providersUsed = 0
  let providersFailed = 0
  let latestStats = { totalPlayers: 0, subCategories: 0, previousPlayers: 0, previousSubs: 0 }
  const startingMap = await loadMap(slug)
  const startingPlayers = startingMap?.totalPlayers || 0
  const startingSubs = startingMap?.subCategories?.length || 0

  const encoder = new TextEncoder()
  let streamDead = false

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        if (streamDead) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          // Client disconnected — stream is dead, but work continues
          streamDead = true
        }
      }

      try {
        if (providers.length > 0) {
          // ── Multi-provider fanout via CLIProxyAPI ──
          send("refresh_start", {
            slug,
            name: vertical.name,
            providerCount: providers.length,
            providers: providers.map((p) => ({ id: p.id, label: p.label })),
          })

          await parallelResearch<MapGenResult>({
            systemPrompt: VERTICAL_MAP_PROMPT,
            userMessage: `Generate a comprehensive market map for this vertical:\n\nVERTICAL: ${vertical.name}\nDESCRIPTION: ${vertical.description}`,
            providers,
            timeoutMs: 600_000,
            onStart: (provider) => {
              const p = providers.find((pr) => pr.id === provider)
              send("provider_start", {
                provider,
                label: p?.label || provider,
              })
            },
            onProgress: (provider, progress) => {
              send("provider_progress", {
                provider,
                phase: progress.phase,
                tokens: progress.tokens,
              })
            },
            onResult: async (provider, data, durationMs) => {
              const p = providers.find((pr) => pr.id === provider)
              const d = data as MapGenResult
              providersUsed++

              // Immediately merge this provider's data into the map on disk
              latestStats = await mergeProviderIntoMap(slug, vertical, d)

              send("provider_done", {
                provider,
                label: p?.label || provider,
                success: true,
                durationMs,
                summary: {
                  subCategories: d.subCategories?.length || 0,
                  totalPlayers: d.subCategories?.reduce((s, sub) => s + (sub.topPlayers?.length || 0), 0) || 0,
                },
                // Running totals after this merge
                mergedTotals: {
                  totalPlayers: latestStats.totalPlayers,
                  subCategories: latestStats.subCategories,
                },
              })
            },
            onError: (provider, error) => {
              const p = providers.find((pr) => pr.id === provider)
              providersFailed++
              send("provider_done", {
                provider,
                label: p?.label || provider,
                success: false,
                durationMs: 0,
                error,
              })
            },
          })

          if (providersUsed > 0) {
            send("refresh_complete", {
              totalPlayers: latestStats.totalPlayers,
              subCategories: latestStats.subCategories,
              providersUsed,
              providersFailed,
              previousPlayers: startingPlayers,
              previousSubs: startingSubs,
              newPlayers: latestStats.totalPlayers - startingPlayers,
              newSubs: latestStats.subCategories - startingSubs,
            })
          } else {
            // All providers failed — try Gemini fallback
            await geminiRefreshFallback(slug, vertical, send)
          }
        } else {
          // No proxy providers available — Gemini fallback
          await geminiRefreshFallback(slug, vertical, send)
        }
      } catch (err) {
        send("refresh_error", {
          message: err instanceof Error ? err.message : "Refresh failed",
        })
      } finally {
        refreshLocks.delete(slug)
        if (!streamDead) {
          try { controller.close() } catch { /* already closed */ }
        }
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

export const GET = withRelayTelemetry(getMap)
export const POST = withRelayTelemetry(postMap)

/** Fallback: single-provider Gemini pipeline, still emits SSE events */
async function geminiRefreshFallback(
  slug: string,
  vertical: { name: string; description: string; slug: string },
  send: (event: string, data: unknown) => void,
) {
  if (!process.env.GEMINI_API_KEY) {
    send("refresh_error", {
      message: "No AI providers available (CLIProxyAPI offline and GEMINI_API_KEY not configured)",
    })
    return
  }

  const geminiProvider = { id: "gemini", label: "Gemini" }
  send("refresh_start", {
    slug,
    name: vertical.name,
    providerCount: 1,
    providers: [geminiProvider],
  })

  const start = Date.now()
  try {
    const result = await generateVerticalMap(vertical.name, vertical.description)
    const durationMs = Date.now() - start

    send("provider_done", {
      provider: "gemini",
      label: "Gemini",
      success: true,
      durationMs,
    })

    const map = {
      slug: vertical.slug,
      name: vertical.name,
      description: vertical.description,
      generatedAt: new Date().toISOString(),
      ...result,
    }

    await saveMap(slug, map as VerticalMap)

    send("refresh_complete", {
      totalPlayers: (result as MapGenResult).totalPlayers || 0,
      subCategories: (result as MapGenResult).subCategories?.length || 0,
      providersUsed: 1,
      providersFailed: 0,
    })
  } catch (err) {
    send("provider_done", {
      provider: "gemini",
      label: "Gemini",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Gemini generation failed",
    })
    send("refresh_error", {
      message: err instanceof Error ? err.message : "Generation failed",
    })
  }
}
