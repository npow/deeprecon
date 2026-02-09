"use client"

import { Competitor } from "@/lib/types"
import { formatCurrency, stringify } from "@/lib/utils"
import { ExternalLink, TrendingDown, TrendingUp, Minus } from "lucide-react"

interface CompetitorCardProps {
  competitor: Competitor
}

export function CompetitorCard({ competitor }: CompetitorCardProps) {
  const sentimentIcon =
    (competitor.sentimentScore ?? 0) > 0.2 ? (
      <TrendingUp className="h-4 w-4 text-green-500" />
    ) : (competitor.sentimentScore ?? 0) < -0.2 ? (
      <TrendingDown className="h-4 w-4 text-red-500" />
    ) : (
      <Minus className="h-4 w-4 text-gray-400" />
    )

  const complaints = Array.isArray(competitor.topComplaints) ? competitor.topComplaints : []
  const differentiators = Array.isArray(competitor.keyDifferentiators) ? competitor.keyDifferentiators : []

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow animate-slide-up">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{stringify(competitor.name)}</h3>
            {competitor.websiteUrl && (
              <a
                href={String(competitor.websiteUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-brand-500"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{stringify(competitor.description)}</p>
        </div>
        <div className="flex-shrink-0 ml-4">
          <div
            className={`text-lg font-bold ${
              competitor.similarityScore >= 80
                ? "text-red-600"
                : competitor.similarityScore >= 60
                  ? "text-orange-500"
                  : competitor.similarityScore >= 40
                    ? "text-yellow-600"
                    : "text-green-600"
            }`}
          >
            {competitor.similarityScore}%
          </div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider text-right">match</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500 mb-3">
        {competitor.totalFundingUsd != null && competitor.totalFundingUsd > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-gray-700">
              {formatCurrency(competitor.totalFundingUsd)}
            </span>{" "}
            raised
          </span>
        )}
        {competitor.lastFundingType && competitor.lastFundingType !== "unknown" && (
          <span className="inline-flex items-center gap-1">
            {stringify(competitor.lastFundingType).replace(/_/g, " ")}
          </span>
        )}
        {competitor.employeeCountRange && (
          <span>{stringify(competitor.employeeCountRange)} employees</span>
        )}
        <span className="inline-flex items-center gap-1">
          {sentimentIcon}
          sentiment
        </span>
      </div>

      {complaints.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 font-medium">
            Weaknesses
          </div>
          <div className="flex flex-wrap gap-1.5">
            {complaints.map((complaint, i) => (
              <span
                key={i}
                className="inline-block text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full"
              >
                {stringify(complaint)}
              </span>
            ))}
          </div>
        </div>
      )}

      {differentiators.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 font-medium">
            Strengths
          </div>
          <div className="flex flex-wrap gap-1.5">
            {differentiators.map((diff, i) => (
              <span
                key={i}
                className="inline-block text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full"
              >
                {stringify(diff)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
