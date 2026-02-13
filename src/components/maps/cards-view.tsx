"use client"

import Link from "next/link"
import {
  TrendingDown,
  Minus,
  Search,
  ArrowRight,
  Flame,
} from "lucide-react"
import { stringify } from "@/lib/utils"
import { type SubCategory } from "@/lib/types"

export function CardsView({ subCategories, verticalSlug }: { subCategories: SubCategory[]; verticalSlug?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Sub-Categories
          <span className="text-sm font-normal text-gray-400 ml-2">sorted by opportunity</span>
        </h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {subCategories.map((sub, i) => (
          <SubCategoryCard key={sub.slug || i} sub={sub} index={i} verticalSlug={verticalSlug} />
        ))}
      </div>
    </div>
  )
}

function SubCategoryCard({ sub, index, verticalSlug }: { sub: SubCategory; index: number; verticalSlug?: string }) {
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

  const Wrapper = verticalSlug
    ? ({ children }: { children: React.ReactNode }) => (
        <Link href={`/maps/${verticalSlug}/${sub.slug}`} className="block">
          {children}
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => <>{children}</>

  return (
    <Wrapper>
    <div
      className={`bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow animate-view-enter ${verticalSlug ? "cursor-pointer" : ""}`}
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
            {sub.topPlayers.slice(0, 20).map((p, i) => (
              <span
                key={i}
                className="text-[11px] bg-gray-50 text-gray-700 px-2 py-0.5 rounded-full border border-gray-100"
                title={`${stringify(p.oneLiner)} | ${stringify(p.funding)} (${stringify(p.stage)})`}
              >
                {stringify(p.name)}
              </span>
            ))}
            {sub.topPlayers.length > 20 && (
              <span className="text-[11px] text-gray-400 px-2 py-0.5">
                +{sub.topPlayers.length - 20} more
              </span>
            )}
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
          onClick={(e) => e.stopPropagation()}
        >
          <Search className="h-3 w-3" />
          Deep Dive
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
    </Wrapper>
  )
}
