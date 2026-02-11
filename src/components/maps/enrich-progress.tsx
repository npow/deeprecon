"use client"

import { Loader2, Sparkles, CheckCircle2 } from "lucide-react"

export interface EnrichProgressState {
  running: boolean
  currentSub: string
  index: number
  total: number
  totalNew: number
  totalUpdated: number
  done: boolean
  error?: string
}

export const INITIAL_ENRICH_STATE: EnrichProgressState = {
  running: false,
  currentSub: "",
  index: 0,
  total: 0,
  totalNew: 0,
  totalUpdated: 0,
  done: false,
}

export function EnrichProgressBanner({ state }: { state: EnrichProgressState }) {
  if (!state.running && !state.done && !state.error) return null

  const pct = state.total > 0 ? Math.round((state.index / state.total) * 100) : 0

  if (state.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
        <div className="flex items-center gap-2 text-sm text-red-700">
          <span className="font-medium">Enrichment failed:</span>
          {state.error}
        </div>
      </div>
    )
  }

  if (state.done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-6 animate-view-enter">
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          <span className="font-medium">Enrichment complete</span>
          <span className="text-green-600">
            — {state.totalNew} new players, {state.totalUpdated} updated
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 mb-6 animate-view-enter">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm text-brand-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-medium">Enriching</span>
          {state.currentSub && (
            <span className="text-brand-600">— {state.currentSub}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-brand-600">
          <span>{state.index}/{state.total} categories</span>
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            +{state.totalNew} new, {state.totalUpdated} updated
          </span>
        </div>
      </div>
      <div className="bg-brand-100 rounded-full h-1.5">
        <div
          className="bg-brand-500 h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
