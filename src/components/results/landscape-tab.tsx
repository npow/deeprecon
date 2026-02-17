"use client"

import { useMemo, useState } from "react"
import { Competitor } from "@/lib/types"
import { CompetitorCard } from "@/components/competitor-card"
import { formatCurrency, crowdednessLabel, crowdednessBgColor, crowdednessColor, fundingConfidence } from "@/lib/utils"
import type { EvidenceConfidence } from "@/lib/evidence-confidence"
import { competitorThreat, summarizeThreats } from "@/lib/competition-threat"

interface LandscapeTabProps {
  competitors: Competitor[]
  crowdednessIndex: string
  totalFunding: number
  evidence?: EvidenceConfidence | null
}

export function LandscapeTab({ competitors, crowdednessIndex, totalFunding, evidence = null }: LandscapeTabProps) {
  const [view, setView] = useState<"primary" | "review">("primary")
  const [showEvidenceDetails, setShowEvidenceDetails] = useState(false)
  const sorted = [...competitors].sort((a, b) => competitorThreat(b).score - competitorThreat(a).score)
  const threatSummary = summarizeThreats(competitors)
  const verifiedWebsites = competitors.filter((c) => c.websiteStatus === "verified").length
  const multiConfirmed = competitors.filter((c) => c.confidenceLevel === "multi_confirmed").length
  const unverified = competitors.filter((c) => c.confidenceLevel === "ai_inferred").length
  const funded = competitors.filter((c) => (c.totalFundingUsd ?? 0) > 0)
  const highFundingConfidence = funded.filter((c) => fundingConfidence(c) === "high").length
  const mediumFundingConfidence = funded.filter((c) => fundingConfidence(c) === "medium").length
  const lowFundingConfidence = funded.filter((c) => fundingConfidence(c) === "low").length

  const isNeedsReview = (c: Competitor): boolean =>
    c.websiteStatus === "dead" ||
    c.websiteStatus === "parked" ||
    c.websiteStatus === "mismatch" ||
    c.confidenceLevel === "ai_inferred"

  const primaryCompetitors = useMemo(
    () => sorted.filter((c) => !isNeedsReview(c)),
    [sorted]
  )
  const reviewCompetitors = useMemo(
    () => sorted.filter((c) => isNeedsReview(c)),
    [sorted]
  )
  const shown = view === "primary" ? primaryCompetitors : reviewCompetitors

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Summary bar */}
      <div className={`border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${crowdednessBgColor(crowdednessIndex)}`}>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-1">
            Final Threat Post-Check (after full DD synthesis)
          </p>
          <span className={`text-lg font-bold ${crowdednessColor(crowdednessIndex)}`}>
            {crowdednessLabel(crowdednessIndex)}
          </span>
          <span className="text-sm text-gray-600 ml-2">
            {competitors.length} competitor{competitors.length !== 1 ? "s" : ""} found
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
              {threatSummary.direct} direct threats
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {threatSummary.adjacent} adjacent
            </span>
            <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
              {threatSummary.low} low-threat
            </span>
          </div>
        </div>
        {totalFunding > 0 && (
          <div className="text-sm text-gray-600">
            <span className="font-semibold text-gray-800">{formatCurrency(totalFunding)}</span> total
            funding in space
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 text-xs text-gray-600">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700">Evidence confidence</span>
            <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
              {evidence?.score ?? 0}/100
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowEvidenceDetails((v) => !v)}
            className="text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            {showEvidenceDetails ? "Hide details" : "Show details"}
          </button>
        </div>
        {showEvidenceDetails && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
              {verifiedWebsites}/{competitors.length} websites verified
            </span>
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {multiConfirmed} multi-confirmed
            </span>
            <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
              {unverified} unverified
            </span>
            {funded.length > 0 && (
              <>
                <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                  funding: {highFundingConfidence} high-confidence
                </span>
                <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
                  {mediumFundingConfidence} medium-confidence
                </span>
                <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                  {lowFundingConfidence} low-confidence
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setView("primary")}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            view === "primary"
              ? "bg-brand-50 border-brand-200 text-brand-700"
              : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
          }`}
        >
          Primary ({primaryCompetitors.length})
        </button>
        <button
          type="button"
          onClick={() => setView("review")}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            view === "review"
              ? "bg-amber-50 border-amber-200 text-amber-700"
              : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
          }`}
        >
          Needs Review ({reviewCompetitors.length})
        </button>
      </div>

      {/* Competitor cards */}
      <div className="space-y-3">
        {shown.map((competitor, i) => (
          <CompetitorCard key={i} competitor={competitor} />
        ))}
      </div>

      {shown.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg font-medium">{view === "primary" ? "No primary competitors found" : "No competitors need review"}</p>
          <p className="text-sm mt-1">
            {view === "primary"
              ? "This could be a novel space — or the idea may need more specificity"
              : "All listed competitors currently look verified or higher confidence"}
          </p>
        </div>
      )}
    </div>
  )
}
