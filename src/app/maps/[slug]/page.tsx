"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  Radar,
  Map,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Sparkles,
} from "lucide-react"
import { stringify } from "@/lib/utils"
import { type VerticalMap } from "@/lib/types"
import { MapViewTabs } from "@/components/maps/view-tabs"
import {
  EnrichProgressBanner,
  INITIAL_ENRICH_STATE,
  type EnrichProgressState,
} from "@/components/maps/enrich-progress"
import { useProviders } from "@/hooks/use-providers"
import { ProviderPicker } from "@/components/maps/provider-picker"
import { useRefreshJobs } from "@/hooks/use-refresh-jobs"
import { RefreshJobsDrawer } from "@/components/maps/refresh-jobs-drawer"

export default function VerticalDetailPage() {
  const params = useParams()
  const slug = params.slug as string

  const [map, setMap] = useState<VerticalMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [enrichState, setEnrichState] = useState<EnrichProgressState>(INITIAL_ENRICH_STATE)
  const prov = useProviders()

  const fetchMap = useCallback(async () => {
    setLoading(true)
    setError("")
    const res = await fetch(`/api/maps/${slug}`)
    if (!res.ok) {
      setError("Map not generated yet")
      setLoading(false)
      return
    }
    const data = await res.json()
    setMap(data)
    setLoading(false)
  }, [slug])

  const refreshJobs = useRefreshJobs({
    onComplete: () => fetchMap(),
  })

  useEffect(() => {
    fetchMap()
  }, [fetchMap])

  const refreshJob = refreshJobs.jobs.get(slug)
  const refreshing = !!refreshJob && !refreshJob.done

  function handleRefresh() {
    if (map) {
      refreshJobs.startRefresh(slug, map.name, Array.from(prov.enabledIds))
    }
  }

  async function handleEnrichAll() {
    setEnrichState({ ...INITIAL_ENRICH_STATE, running: true })

    try {
      const res = await fetch(`/api/maps/${slug}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: Array.from(prov.enabledIds),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setEnrichState((s) => ({ ...s, running: false, error: err.error || "Failed to start enrichment" }))
        return
      }

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let eventType = ""
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7)
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              switch (eventType) {
                case "enrich_start":
                  setEnrichState((s) => ({
                    ...s,
                    currentSub: data.subName,
                    index: data.index,
                    total: data.total,
                  }))
                  break
                case "enrich_complete":
                  setEnrichState((s) => ({
                    ...s,
                    totalNew: s.totalNew + data.newCount,
                    totalUpdated: s.totalUpdated + data.updatedCount,
                  }))
                  break
                case "enrich_done":
                  setEnrichState((s) => ({
                    ...s,
                    running: false,
                    done: true,
                    totalNew: data.totalNew,
                    totalUpdated: data.totalUpdated,
                  }))
                  fetchMap()
                  break
                case "enrich_error":
                  if (data.subSlug) {
                    // Per-subcategory error, continue
                    break
                  }
                  setEnrichState((s) => ({
                    ...s,
                    running: false,
                    error: data.message,
                  }))
                  break
              }
            } catch {
              // skip malformed JSON
            }
            eventType = ""
          }
        }
      }
    } catch (err) {
      setEnrichState((s) => ({
        ...s,
        running: false,
        error: err instanceof Error ? err.message : "Network error",
      }))
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
      </div>
    )
  }

  if (error || !map) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <p className="text-gray-500 mb-4">{error || "Map not found"}</p>
        <Link
          href="/maps"
          className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Maps
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
              <Radar className="h-5 w-5 text-brand-600" />
              <span className="font-bold text-gray-900">DeepRecon</span>
            </Link>
            <span className="text-gray-300">|</span>
            <Link
              href="/maps"
              className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              <Map className="h-4 w-4" />
              Maps
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm font-medium text-gray-900">{map.name}</span>
          </div>
          <Link
            href="/"
            className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            Deep Dive Scan
          </Link>
        </div>
      </nav>

      {/* Header */}
      <div className="bg-gradient-to-b from-brand-50 to-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{map.name}</h1>
              <p className="text-gray-500 mt-1">{map.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleEnrichAll}
                disabled={enrichState.running || refreshing || prov.enabledCount === 0}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              >
                {enrichState.running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Enrich All
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing || enrichState.running || prov.enabledCount === 0}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-4 mt-6">
            <Stat label="Total Players" value={String(map.totalPlayers)} />
            <Stat label="Total Funding" value={stringify(map.totalFunding)} />
            <Stat
              label="Crowdedness"
              value={`${map.overallCrowdedness}/100`}
              color={
                map.overallCrowdedness >= 70
                  ? "text-red-600"
                  : map.overallCrowdedness >= 40
                    ? "text-orange-500"
                    : "text-green-600"
              }
            />
            <Stat
              label="Avg Opportunity"
              value={`${map.averageOpportunity}/100`}
              color={
                map.averageOpportunity >= 60
                  ? "text-green-600"
                  : map.averageOpportunity >= 35
                    ? "text-yellow-600"
                    : "text-red-500"
              }
            />
            <Stat
              label="Sub-Categories"
              value={String(map.subCategories.length)}
            />
            <Stat
              label="Generated"
              value={new Date(map.generatedAt).toLocaleDateString()}
            />
          </div>

          {/* Provider picker */}
          <div className="mt-6">
            <ProviderPicker prov={prov} />
          </div>
        </div>
      </div>

      {/* Views */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <EnrichProgressBanner state={enrichState} />
        <MapViewTabs map={map} />
      </main>

      {/* Refresh progress drawer */}
      <RefreshJobsDrawer refreshJobs={refreshJobs} />
    </div>
  )
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold ${color || "text-gray-900"}`}>{value}</div>
    </div>
  )
}
