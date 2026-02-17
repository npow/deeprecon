"use client"

import { Sparkles, RefreshCcw, Wand2, TrendingUp } from "lucide-react"
import type { UniquenessSuggestion } from "@/lib/readiness-score"
import { RichText } from "./rich-text"

interface UniquenessComparison {
  suggestionTitle: string
  before: number
  after: number
  delta: number
}

interface ExperimentResult {
  suggestionId: string
  suggestionTitle: string
  refinedIdeaText: string
  scanId: string | null
  totalScore: number
  grade: string
  uniquenessBefore: number
  uniquenessAfter: number
  uniquenessDelta: number
}

interface UniquenessOptimizerCardProps {
  suggestions: UniquenessSuggestion[]
  currentUniqueness?: number | null
  isRescanning?: boolean
  isExperimenting?: boolean
  experimentProgress?: { done: number; total: number } | null
  experimentResults?: ExperimentResult[]
  onUseSuggestion: (text: string) => void
  onUseAndRescan: (suggestion: UniquenessSuggestion) => void
  onRunExperiments?: () => void
  onApplyExperiment?: (result: ExperimentResult) => void
  comparison?: UniquenessComparison | null
}

function deltaTone(delta: number): string {
  if (delta > 0) return "text-green-700 bg-green-50 border-green-200"
  if (delta < 0) return "text-red-700 bg-red-50 border-red-200"
  return "text-gray-700 bg-gray-50 border-gray-200"
}

export function UniquenessOptimizerCard({
  suggestions,
  currentUniqueness = null,
  isRescanning = false,
  isExperimenting = false,
  experimentProgress = null,
  experimentResults = [],
  onUseSuggestion,
  onUseAndRescan,
  onRunExperiments,
  onApplyExperiment,
  comparison,
}: UniquenessOptimizerCardProps) {
  if (!suggestions.length) return null
  const bestProjected = Math.max(...suggestions.map((s) => s.predictedMax))
  const minProjected = Math.min(...suggestions.map((s) => s.predictedMin))

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 animate-slide-up">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-5 w-5 text-amber-500" />
        <h3 className="font-semibold text-gray-900">Uniqueness Optimizer</h3>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Apply one of these positioning tweaks and re-run the scan to validate differentiation. Projections below estimate likely uniqueness impact before you re-scan.
      </p>

      <div className="mb-4 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-900">
        Projected uniqueness outcome: {minProjected.toFixed(1)}-{bestProjected.toFixed(1)} / 5 across these suggestions.
      </div>

      {onRunExperiments && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRunExperiments}
            disabled={isExperimenting || isRescanning || suggestions.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {isExperimenting
              ? `Running experiments (${experimentProgress?.done ?? 0}/${experimentProgress?.total ?? suggestions.length})`
              : `Run Top ${Math.min(3, suggestions.length)} Experiments`}
          </button>
          <p className="text-xs text-gray-500">
            Tests multiple positioning variants and compares score/uniqueness outcomes.
          </p>
        </div>
      )}

      {comparison && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${deltaTone(comparison.delta)}`}>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="font-medium">{comparison.suggestionTitle}</span>
          </div>
          <p className="mt-1 text-xs">
            Uniqueness score: {comparison.before.toFixed(1)} → {comparison.after.toFixed(1)} ({comparison.delta >= 0 ? "+" : ""}
            {comparison.delta.toFixed(1)})
          </p>
        </div>
      )}

      <div className="space-y-3">
        {suggestions.map((s) => (
          <div key={s.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-sm font-medium text-gray-900">{s.title}</p>
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                est +{s.estimatedLift.toFixed(1)}
              </span>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
                projected uniqueness: {s.predictedMin.toFixed(1)}-{s.predictedMax.toFixed(1)} / 5
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
                most likely: {s.predictedMostLikely.toFixed(1)}
                {currentUniqueness != null ? ` (from ${currentUniqueness.toFixed(1)})` : ""}
              </span>
              <span className={`px-1.5 py-0.5 rounded border ${
                s.confidence === "high"
                  ? "bg-green-50 border-green-200 text-green-700"
                  : s.confidence === "medium"
                    ? "bg-yellow-50 border-yellow-200 text-yellow-700"
                    : "bg-gray-50 border-gray-200 text-gray-600"
              }`}>
                confidence: {s.confidence}
              </span>
            </div>
            <RichText className="text-xs text-gray-600 mb-2 leading-relaxed break-words" value={s.whyItCouldWork} />
            <div className="text-xs text-gray-500 bg-white border border-gray-200 rounded p-2 mb-2 leading-relaxed break-words">
              <RichText value={s.refinedIdeaText} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onUseSuggestion(s.refinedIdeaText)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:border-gray-400 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Use This
              </button>
              <button
                type="button"
                disabled={isRescanning}
                onClick={() => onUseAndRescan(s)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {isRescanning ? "Re-scanning..." : "Use + Re-scan"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {experimentResults.length > 0 && (
        <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-700">
            Experiment Results
          </div>
          <div className="divide-y divide-gray-100">
            {experimentResults.map((r, i) => (
              <div key={r.suggestionId} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-gray-900">
                    {i === 0 ? "Winner: " : ""}{r.suggestionTitle}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                      score {r.totalScore} ({r.grade})
                    </span>
                    <span className={`px-1.5 py-0.5 rounded border ${deltaTone(r.uniquenessDelta)}`}>
                      uniq {r.uniquenessBefore.toFixed(1)} → {r.uniquenessAfter.toFixed(1)} ({r.uniquenessDelta >= 0 ? "+" : ""}{r.uniquenessDelta.toFixed(1)})
                    </span>
                    {onApplyExperiment && (
                      <button
                        type="button"
                        onClick={() => onApplyExperiment(r)}
                        className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                      >
                        Apply
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
