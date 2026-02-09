"use client"

import { Competitor } from "@/lib/types"
import { CompetitorCard } from "@/components/competitor-card"
import { formatCurrency, crowdednessLabel, crowdednessBgColor, crowdednessColor } from "@/lib/utils"

interface LandscapeTabProps {
  competitors: Competitor[]
  crowdednessIndex: string
  totalFunding: number
}

export function LandscapeTab({ competitors, crowdednessIndex, totalFunding }: LandscapeTabProps) {
  const sorted = [...competitors].sort((a, b) => b.similarityScore - a.similarityScore)

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Summary bar */}
      <div className={`border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${crowdednessBgColor(crowdednessIndex)}`}>
        <div>
          <span className={`text-lg font-bold ${crowdednessColor(crowdednessIndex)}`}>
            {crowdednessLabel(crowdednessIndex)}
          </span>
          <span className="text-sm text-gray-600 ml-2">
            {competitors.length} competitor{competitors.length !== 1 ? "s" : ""} found
          </span>
        </div>
        {totalFunding > 0 && (
          <div className="text-sm text-gray-600">
            <span className="font-semibold text-gray-800">{formatCurrency(totalFunding)}</span> total
            funding in space
          </div>
        )}
      </div>

      {/* Competitor cards */}
      <div className="space-y-3">
        {sorted.map((competitor, i) => (
          <CompetitorCard key={i} competitor={competitor} />
        ))}
      </div>

      {competitors.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg font-medium">No direct competitors found</p>
          <p className="text-sm mt-1">This could be a novel space — or the idea may need more specificity</p>
        </div>
      )}
    </div>
  )
}
