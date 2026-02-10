"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  Radar,
  Map,
  Loader2,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  Flame,
} from "lucide-react"
import { stringify } from "@/lib/utils"
import { type VerticalMap, type SubCategory } from "@/lib/types"

export default function VerticalDetailPage() {
  const params = useParams()
  const slug = params.slug as string

  const [map, setMap] = useState<VerticalMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetchMap()
  }, [slug])

  async function fetchMap() {
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
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/maps/${slug}`, { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setMap(data)
      }
    } finally {
      setRefreshing(false)
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
            <button
              onClick={handleRefresh}
              disabled={refreshing}
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
        </div>
      </div>

      {/* Sub-categories */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Sub-Categories
            <span className="text-sm font-normal text-gray-400 ml-2">sorted by opportunity</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {map.subCategories.map((sub, i) => (
            <SubCategoryCard key={sub.slug || i} sub={sub} index={i} />
          ))}
        </div>
      </main>
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

function SubCategoryCard({ sub, index }: { sub: SubCategory; index: number }) {
  const trendIcon =
    sub.trendDirection === "heating_up" ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
        <Flame className="h-3 w-3" /> Heating Up
      </span>
    ) : sub.trendDirection === "cooling_down" ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
        <TrendingDown className="h-3 w-3" /> Cooling
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
        <Minus className="h-3 w-3" /> Stable
      </span>
    )

  const opportunityColor =
    sub.opportunityScore >= 70
      ? "text-green-600"
      : sub.opportunityScore >= 45
        ? "text-yellow-600"
        : "text-gray-500"

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow animate-slide-up"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">{stringify(sub.name)}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{stringify(sub.description)}</p>
        </div>
        <div className="flex-shrink-0 ml-3 text-right">
          <div className={`text-xl font-bold ${opportunityColor}`}>
            {sub.opportunityScore}
          </div>
          <div className="text-[9px] text-gray-400 uppercase tracking-wider">opportunity</div>
        </div>
      </div>

      {/* Scores */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-gray-400">Crowdedness</span>
            <span className="text-[10px] font-medium text-gray-600">{sub.crowdednessScore}</span>
          </div>
          <div className="bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${
                sub.crowdednessScore >= 70 ? "bg-red-400" : sub.crowdednessScore >= 40 ? "bg-orange-300" : "bg-green-400"
              }`}
              style={{ width: `${sub.crowdednessScore}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {trendIcon}
          <span className="text-xs text-gray-400">{sub.playerCount} players</span>
          {sub.totalFunding && (
            <span className="text-xs text-gray-400">{stringify(sub.totalFunding)}</span>
          )}
        </div>
      </div>

      {/* Top players */}
      {Array.isArray(sub.topPlayers) && sub.topPlayers.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1">
            Top Players
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sub.topPlayers.map((p, i) => (
              <span
                key={i}
                className="text-[11px] bg-gray-50 text-gray-700 px-2 py-0.5 rounded-full border border-gray-100"
                title={`${stringify(p.oneLiner)} | ${stringify(p.funding)} (${stringify(p.stage)})`}
              >
                {stringify(p.name)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gaps */}
      {Array.isArray(sub.keyGaps) && sub.keyGaps.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1">
            Key Gaps
          </div>
          <ul className="space-y-0.5">
            {sub.keyGaps.map((gap, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                <span className="text-green-500 mt-0.5 flex-shrink-0">●</span>
                {stringify(gap)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deep dive */}
      {sub.deepDivePrompt && (
        <Link
          href={`/?idea=${encodeURIComponent(stringify(sub.deepDivePrompt))}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors mt-1"
        >
          <Search className="h-3 w-3" />
          Deep Dive
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}
