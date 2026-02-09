"use client"

import { PivotSuggestion } from "@/lib/types"
import { stringify } from "@/lib/utils"
import { ArrowRightLeft, BarChart3, Wrench } from "lucide-react"

interface PivotsTabProps {
  pivots: PivotSuggestion[]
}

export function PivotsTab({ pivots }: PivotsTabProps) {
  if (pivots.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 animate-fade-in">
        <p className="text-lg font-medium">No pivot suggestions needed</p>
        <p className="text-sm mt-1">The market looks open enough to enter directly</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-sm text-gray-500">
        Based on the competitive landscape and identified gaps, here are strategic angles to
        differentiate or find a less contested position.
      </p>

      {pivots.map((pivot, i) => (
        <div
          key={i}
          className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow animate-slide-up"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center text-sm font-bold">
                {i + 1}
              </div>
              <h3 className="font-semibold text-gray-900">{stringify(pivot.title)}</h3>
            </div>
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                pivot.difficulty === "low"
                  ? "bg-green-100 text-green-700"
                  : pivot.difficulty === "medium"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {stringify(pivot.difficulty)} difficulty
            </span>
          </div>

          <p className="text-sm text-gray-700 mb-3">{stringify(pivot.description)}</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="bg-purple-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <ArrowRightLeft className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-[10px] uppercase tracking-wider text-purple-600 font-medium">
                  Why it works
                </span>
              </div>
              <p className="text-xs text-purple-900">{stringify(pivot.whyItWorks)}</p>
            </div>

            <div className="bg-green-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 className="h-3.5 w-3.5 text-green-500" />
                <span className="text-[10px] uppercase tracking-wider text-green-600 font-medium">
                  Market size
                </span>
              </div>
              <p className="text-xs text-green-900">{stringify(pivot.estimatedMarketSize)}</p>
            </div>

            <div className="bg-blue-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Wrench className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-[10px] uppercase tracking-wider text-blue-600 font-medium">
                  Adjacent examples
                </span>
              </div>
              <p className="text-xs text-blue-900">{stringify(pivot.adjacentExamples)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
