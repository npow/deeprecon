"use client"

import { GapAnalysis } from "@/lib/types"
import { stringify, safeArray } from "@/lib/utils"
import { Lightbulb, MessageSquareWarning, Users } from "lucide-react"
import { RichText } from "./rich-text"

interface GapsTabProps {
  gapAnalysis: GapAnalysis
}

export function GapsTab({ gapAnalysis }: GapsTabProps) {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* White space opportunities */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          <h3 className="text-lg font-semibold text-gray-900">White Space Opportunities</h3>
        </div>
        <div className="space-y-3">
          {safeArray(gapAnalysis.whiteSpaceOpportunities).map((opp, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-xl p-4 animate-slide-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <RichText className="font-medium text-gray-900 leading-snug break-words" value={opp.opportunity} />
                  <RichText className="text-sm text-gray-500 mt-1 leading-relaxed break-words" value={opp.evidence} />
                </div>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
                    opp.potentialImpact === "high"
                      ? "bg-green-100 text-green-700"
                      : opp.potentialImpact === "medium"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {stringify(opp.potentialImpact)} impact
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Common complaints */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <MessageSquareWarning className="h-5 w-5 text-red-500" />
          <h3 className="text-lg font-semibold text-gray-900">Common Complaints About Competitors</h3>
        </div>
        <div className="space-y-3">
          {safeArray(gapAnalysis.commonComplaints).map((complaint, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-xl p-4 animate-slide-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <RichText className="font-medium text-gray-900 leading-snug break-words" value={complaint.complaint} />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    complaint.frequency === "very_common"
                      ? "bg-red-100 text-red-700"
                      : complaint.frequency === "common"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {stringify(complaint.frequency).replace(/_/g, " ")}
                </span>
                {(Array.isArray(complaint.competitors) ? complaint.competitors : []).map((comp, j) => (
                  <span key={j} className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
                    {stringify(comp)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Unserved segments */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-brand-500" />
          <h3 className="text-lg font-semibold text-gray-900">Unserved Segments</h3>
        </div>
        <div className="space-y-3">
          {safeArray(gapAnalysis.unservedSegments).map((segment, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-xl p-4 animate-slide-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <RichText className="font-medium text-gray-900 leading-snug break-words" value={segment.segment} />
              <RichText className="text-sm text-gray-500 mt-1 leading-relaxed break-words" value={segment.description} />
              <div className="text-sm text-brand-600 mt-2 font-medium leading-relaxed break-words">
                <span>Why unserved: </span>
                <RichText inline value={segment.whyUnserved} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
