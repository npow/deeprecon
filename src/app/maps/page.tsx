"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Radar, Map, Loader2, RefreshCw, ArrowRight, TrendingUp } from "lucide-react"
import { TurboPopulateButton } from "@/components/maps/turbo-populate"
import { useProviders } from "@/hooks/use-providers"
import { ProviderPicker } from "@/components/maps/provider-picker"
import { useRefreshJobs } from "@/hooks/use-refresh-jobs"
import { RefreshJobsDrawer } from "@/components/maps/refresh-jobs-drawer"

interface VerticalSummary {
  slug: string
  name: string
  description: string
  generated: boolean
  generatedAt: string | null
  totalPlayers: number | null
  totalFunding: string | null
  overallCrowdedness: number | null
  averageOpportunity: number | null
  subCategoryCount: number | null
}

export default function MapsPage() {
  const [verticals, setVerticals] = useState<VerticalSummary[]>([])
  const [loading, setLoading] = useState(true)
  const prov = useProviders()

  const fetchVerticals = useCallback(async () => {
    const res = await fetch("/api/maps")
    const data = await res.json()
    setVerticals(data.verticals)
    setLoading(false)
  }, [])

  const refreshJobs = useRefreshJobs({
    onComplete: () => fetchVerticals(),
  })

  const refreshVerticals = useCallback(() => fetchVerticals(), [fetchVerticals])

  useEffect(() => {
    fetchVerticals()
  }, [fetchVerticals])

  function handleGenerate(slug: string, name: string) {
    refreshJobs.startRefresh(slug, name, Array.from(prov.enabledIds))
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
              <Radar className="h-5 w-5 text-brand-600" />
              <span className="font-bold text-gray-900">Recon</span>
            </Link>
            <span className="text-gray-300">|</span>
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
              <Map className="h-4 w-4 text-brand-500" />
              Market Maps
            </div>
          </div>
          <Link
            href="/"
            className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            Deep Dive Scan
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="bg-gradient-to-b from-brand-50 to-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
            Spot opportunities{" "}
            <span className="bg-gradient-to-r from-brand-500 to-purple-600 bg-clip-text text-transparent">
              before you build
            </span>
          </h1>
          <p className="mt-3 text-gray-500 max-w-lg mx-auto text-balance">
            Browse AI-generated landscape maps across startup verticals. See every player, funding
            signal, and white-space opportunity. Click any gap to deep-dive.
          </p>
          <div className="mt-6">
            <TurboPopulateButton onComplete={refreshVerticals} prov={prov} />
          </div>
        </div>
      </div>

      {/* Provider picker (shared across turbo + per-card refresh) */}
      <div className="max-w-5xl mx-auto w-full px-4 pt-6">
        <ProviderPicker prov={prov} />
      </div>

      {/* Verticals grid */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {verticals.map((v) => {
              const job = refreshJobs.jobs.get(v.slug)
              const generating = !!job && !job.done
              return (
                <VerticalCard
                  key={v.slug}
                  vertical={v}
                  generating={generating}
                  onGenerate={() => handleGenerate(v.slug, v.name)}
                />
              )
            })}
          </div>
        )}

        <div className="mt-12 text-center">
          <p className="text-sm text-gray-400">
            More verticals coming soon. Each landscape is AI-generated and fans out across all enabled providers.
          </p>
        </div>
      </main>

      {/* Refresh progress drawer */}
      <RefreshJobsDrawer refreshJobs={refreshJobs} />
    </div>
  )
}

function VerticalCard({
  vertical,
  generating,
  onGenerate,
}: {
  vertical: VerticalSummary
  generating: boolean
  onGenerate: () => void
}) {
  const icons: Record<string, string> = {
    "ai-ml": "🤖",
    fintech: "💳",
    devtools: "🛠️",
    cybersecurity: "🛡️",
    healthtech: "🏥",
    "climate-tech": "🌍",
    edtech: "🎓",
    martech: "📣",
    proptech: "🏠",
    "hr-tech": "👥",
  }

  if (vertical.generated) {
    return (
      <div className={`bg-white border rounded-xl p-5 transition-shadow ${generating ? "border-brand-300 shadow-md ring-2 ring-brand-100" : "border-gray-200 hover:shadow-md"}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="text-2xl">{icons[vertical.slug] || "📊"}</div>
          <span className="text-[10px] text-gray-400">
            {vertical.generatedAt
              ? new Date(vertical.generatedAt).toLocaleDateString()
              : ""}
          </span>
        </div>
        <h3 className="font-semibold text-gray-900 text-lg">{vertical.name}</h3>
        <p className="text-sm text-gray-500 mt-1 mb-4">{vertical.description}</p>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
          <div className="bg-gray-50 rounded-lg p-2">
            <div className="text-gray-400 uppercase tracking-wider text-[10px]">Players</div>
            <div className="font-bold text-gray-900">{vertical.totalPlayers}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <div className="text-gray-400 uppercase tracking-wider text-[10px]">Funding</div>
            <div className="font-bold text-gray-900">{vertical.totalFunding}</div>
          </div>
        </div>

        {/* Score bars */}
        <div className="space-y-2 mb-4">
          <ScoreBar
            label="Crowdedness"
            value={vertical.overallCrowdedness ?? 0}
            colorClass="bg-red-400"
          />
          <ScoreBar
            label="Opportunity"
            value={vertical.averageOpportunity ?? 0}
            colorClass="bg-green-500"
          />
        </div>

        <div className="text-xs text-gray-400 mb-3">
          {vertical.subCategoryCount} sub-categories mapped
        </div>

        <div className="flex gap-2">
          <Link
            href={`/maps/${vertical.slug}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            View Map
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="inline-flex items-center justify-center p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
            title="Refresh landscape (uses all enabled providers)"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    )
  }

  // Not generated yet
  return (
    <div className="bg-white border border-gray-200 border-dashed rounded-xl p-5">
      <div className="text-2xl mb-3">{icons[vertical.slug] || "📊"}</div>
      <h3 className="font-semibold text-gray-900 text-lg">{vertical.name}</h3>
      <p className="text-sm text-gray-500 mt-1 mb-6">{vertical.description}</p>

      <button
        onClick={onGenerate}
        disabled={generating}
        className="w-full inline-flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-60"
      >
        {generating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating landscape...
          </>
        ) : (
          <>
            <TrendingUp className="h-4 w-4" />
            Generate Landscape
          </>
        )}
      </button>
      {generating && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          Fanning out to all enabled providers...
        </p>
      )}
    </div>
  )
}

function ScoreBar({
  label,
  value,
  colorClass,
}: {
  label: string
  value: number
  colorClass: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-400 uppercase tracking-wider w-20 flex-shrink-0">
        {label}
      </span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${colorClass}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-bold text-gray-600 w-6 text-right">{value}</span>
    </div>
  )
}
