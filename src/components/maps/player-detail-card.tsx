"use client"

import { stringify } from "@/lib/utils"
import { type SubCategoryPlayer } from "@/lib/types"
import { ExternalLink } from "lucide-react"
import { WebsiteStatusBadge } from "@/components/website-status-badge"
import { SourceConfidenceBadge } from "@/components/source-confidence-badge"

export const stageBadgeColor: Record<string, string> = {
  "Pre-Seed": "bg-gray-100 text-gray-600",
  "Seed": "bg-amber-50 text-amber-700",
  "Series A": "bg-blue-50 text-blue-700",
  "Series B": "bg-indigo-50 text-indigo-700",
  "Series C": "bg-purple-50 text-purple-700",
  "Series D+": "bg-pink-50 text-pink-700",
  "Public": "bg-green-50 text-green-700",
  "Bootstrapped": "bg-gray-50 text-gray-600",
  "Open Source": "bg-emerald-50 text-emerald-700",
  "Corporate": "bg-slate-100 text-slate-700",
  "Private Equity": "bg-violet-50 text-violet-700",
  "Research": "bg-cyan-50 text-cyan-700",
  "Late Stage": "bg-orange-50 text-orange-700",
  "Growth": "bg-lime-50 text-lime-700",
  "Early Stage": "bg-sky-50 text-sky-700",
  "Acquired": "bg-rose-50 text-rose-700",
  "Unknown": "bg-gray-50 text-gray-400",
}

export function getStageColor(stage: string): string {
  const key = Object.keys(stageBadgeColor).find(
    (k) => stage.toLowerCase().includes(k.toLowerCase())
  )
  return key ? stageBadgeColor[key] : "bg-gray-100 text-gray-600"
}

function ScoreBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const color =
    pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-gray-400"

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-16 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-medium text-gray-600 w-6 text-right">{value}</span>
    </div>
  )
}

export function PlayerDetailCard({
  player,
  strategyCanvasFactors,
}: {
  player: SubCategoryPlayer
  strategyCanvasFactors?: string[]
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="font-semibold text-gray-900 text-sm">{stringify(player.name)}</h4>
            {player.websiteUrl && (
              <a
                href={String(player.websiteUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-brand-500"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <WebsiteStatusBadge status={player.websiteStatus} />
            <SourceConfidenceBadge level={player.confidenceLevel} confirmedBy={player.confirmedBy} confirmedByCount={player.confirmedByCount} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{stringify(player.oneLiner)}</p>
        </div>
      </div>

      {/* Funding + Stage */}
      <div className="flex items-center gap-2 mb-3">
        {player.funding && (
          <span className="text-xs font-medium text-gray-700">
            {stringify(player.funding)}
          </span>
        )}
        {player.stage && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${getStageColor(stringify(player.stage))}`}>
            {stringify(player.stage)}
          </span>
        )}
      </div>

      {/* Execution / Vision scores */}
      <div className="space-y-1.5 mb-3">
        <ScoreBar label="Execution" value={player.executionScore} />
        <ScoreBar label="Vision" value={player.visionScore} />
      </div>

      {/* Competitive factors */}
      {Array.isArray(player.competitiveFactors) && player.competitiveFactors.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1.5">
            Competitive Factors
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {player.competitiveFactors.map((cf, i) => {
              const label = strategyCanvasFactors?.[i] || stringify(cf.factor)
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-500 truncate flex-1">{label}</span>
                  <div className="flex gap-px">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <div
                        key={j}
                        className={`w-1 h-2.5 rounded-sm ${
                          j < cf.score ? "bg-brand-500" : "bg-gray-100"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
