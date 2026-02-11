"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  Radar,
  Map,
  Loader2,
  ArrowLeft,
  Sparkles,
  ArrowUpDown,
  Search,
  ArrowRight,
  Flame,
  TrendingDown,
  Minus,
} from "lucide-react"
import { stringify } from "@/lib/utils"
import { type VerticalMap, type SubCategory } from "@/lib/types"
import { PlayerDetailCard } from "@/components/maps/player-detail-card"
import {
  EnrichProgressBanner,
  INITIAL_ENRICH_STATE,
  type EnrichProgressState,
} from "@/components/maps/enrich-progress"

type SortKey = "name" | "funding" | "execution" | "vision"

function parseFundingForSort(f: string): number {
  if (!f) return 0
  const cleaned = f.replace(/[^0-9.BMKbmk]/g, "")
  const match = cleaned.match(/^([\d.]+)\s*([BMKbmk])?/)
  if (!match) return 0
  const num = parseFloat(match[1])
  if (isNaN(num)) return 0
  const suffix = (match[2] || "").toUpperCase()
  if (suffix === "B") return num * 1e9
  if (suffix === "M") return num * 1e6
  if (suffix === "K") return num * 1e3
  return num
}

export default function SubCategoryDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const subSlug = params.subSlug as string

  const [map, setMap] = useState<VerticalMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("execution")
  const [sortAsc, setSortAsc] = useState(false)
  const [enrichState, setEnrichState] = useState<EnrichProgressState>(INITIAL_ENRICH_STATE)

  const fetchMap = useCallback(async () => {
    const res = await fetch(`/api/maps/${slug}`)
    if (!res.ok) {
      setError("Map not found")
      setLoading(false)
      return
    }
    const data = await res.json()
    setMap(data)
    setLoading(false)
  }, [slug])

  useEffect(() => {
    fetchMap()
  }, [fetchMap])

  const sub = map?.subCategories.find((s) => s.slug === subSlug)

  const sortedPlayers = sub
    ? [...sub.topPlayers].sort((a, b) => {
        let cmp = 0
        switch (sortKey) {
          case "name":
            cmp = stringify(a.name).localeCompare(stringify(b.name))
            break
          case "funding":
            cmp = parseFundingForSort(stringify(a.funding)) - parseFundingForSort(stringify(b.funding))
            break
          case "execution":
            cmp = a.executionScore - b.executionScore
            break
          case "vision":
            cmp = a.visionScore - b.visionScore
            break
        }
        return sortAsc ? cmp : -cmp
      })
    : []

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  async function handleEnrich() {
    setEnrichState({ ...INITIAL_ENRICH_STATE, running: true })

    try {
      const res = await fetch(`/api/maps/${slug}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subSlugs: [subSlug] }),
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
                  // Re-fetch map to get updated data
                  fetchMap()
                  break
                case "enrich_error":
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

  if (error || !map || !sub) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <p className="text-gray-500 mb-4">{error || "Sub-category not found"}</p>
        <Link
          href={`/maps/${slug}`}
          className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Map
        </Link>
      </div>
    )
  }

  const trendIcon =
    sub.trendDirection === "heating_up" ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full">
        <Flame className="h-3.5 w-3.5" /> Heating Up
      </span>
    ) : sub.trendDirection === "cooling_down" ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
        <TrendingDown className="h-3.5 w-3.5" /> Cooling
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full">
        <Minus className="h-3.5 w-3.5" /> Stable
      </span>
    )

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
              <Radar className="h-5 w-5 text-brand-600" />
              <span className="font-bold text-gray-900">Recon</span>
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
            <Link
              href={`/maps/${slug}`}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              {map.name}
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm font-medium text-gray-900">{stringify(sub.name)}</span>
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
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{stringify(sub.name)}</h1>
                {trendIcon}
              </div>
              <p className="text-gray-500 mt-1 max-w-2xl">{stringify(sub.description)}</p>
            </div>
            <button
              onClick={handleEnrich}
              disabled={enrichState.running}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              {enrichState.running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Enrich
            </button>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-4 mt-6">
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Players</div>
              <div className="text-sm font-bold text-gray-900">{sub.playerCount}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Total Funding</div>
              <div className="text-sm font-bold text-gray-900">{stringify(sub.totalFunding)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Crowdedness</div>
              <div className={`text-sm font-bold ${sub.crowdednessScore >= 70 ? "text-red-600" : sub.crowdednessScore >= 40 ? "text-orange-500" : "text-green-600"}`}>
                {sub.crowdednessScore}/100
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Opportunity</div>
              <div className={`text-sm font-bold ${sub.opportunityScore >= 60 ? "text-green-600" : sub.opportunityScore >= 35 ? "text-yellow-600" : "text-red-500"}`}>
                {sub.opportunityScore}/100
              </div>
            </div>
            {sub.lastEnrichedAt && (
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider">Last Enriched</div>
                <div className="text-sm font-bold text-gray-900">
                  {new Date(sub.lastEnrichedAt).toLocaleDateString()}
                </div>
              </div>
            )}
          </div>

          {/* Key Gaps */}
          {Array.isArray(sub.keyGaps) && sub.keyGaps.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1.5">Key Gaps</div>
              <div className="flex flex-wrap gap-2">
                {sub.keyGaps.map((gap, i) => (
                  <span key={i} className="text-xs bg-green-50 text-green-700 border border-green-100 px-2.5 py-1 rounded-full">
                    {stringify(gap)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Deep dive */}
          {sub.deepDivePrompt && (
            <Link
              href={`/?idea=${encodeURIComponent(stringify(sub.deepDivePrompt))}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors mt-4"
            >
              <Search className="h-3 w-3" />
              Deep Dive Scan
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <EnrichProgressBanner state={enrichState} />

        {/* Sort controls */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            All Players
            <span className="text-sm font-normal text-gray-400 ml-2">{sortedPlayers.length} companies</span>
          </h2>
          <div className="flex items-center gap-1">
            <ArrowUpDown className="h-3.5 w-3.5 text-gray-400 mr-1" />
            {(["execution", "vision", "funding", "name"] as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => handleSort(key)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  sortKey === key
                    ? "bg-brand-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
                {sortKey === key && (sortAsc ? " ↑" : " ↓")}
              </button>
            ))}
          </div>
        </div>

        {/* Player grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedPlayers.map((player, i) => (
            <div key={i} className="animate-view-enter" style={{ animationDelay: `${i * 30}ms` }}>
              <PlayerDetailCard
                player={player}
                strategyCanvasFactors={map.strategyCanvasFactors}
              />
            </div>
          ))}
        </div>

        {sortedPlayers.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="mb-2">No players catalogued yet.</p>
            <button
              onClick={handleEnrich}
              disabled={enrichState.running}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              <Sparkles className="h-4 w-4" />
              Enrich this category
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
