"use client"

import { useState, useCallback } from "react"
import { Zap, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react"
import { useProviders, type UseProvidersReturn } from "@/hooks/use-providers"
import { ProviderPicker, ActiveProviderChips } from "@/components/maps/provider-picker"

interface TurboEvent {
  id: number
  event: string
  data: Record<string, unknown>
  ts: number
}

interface TurboState {
  running: boolean
  done: boolean
  error?: string
  phase: string
  events: TurboEvent[]
  verticalsGenerated: number
  verticalsFailed: number
  totalSubCategories: number
  totalPlayers: number
  verticalStatus: Map<string, { started: boolean; done: boolean; providers: number; failed: number; players: number; subs: number }>
  enriched: number
  enrichTotal: number
}

const INITIAL_STATE: TurboState = {
  running: false,
  done: false,
  phase: "",
  events: [],
  verticalsGenerated: 0,
  verticalsFailed: 0,
  totalSubCategories: 0,
  totalPlayers: 0,
  verticalStatus: new Map(),
  enriched: 0,
  enrichTotal: 0,
}

export function TurboPopulateButton({ onComplete, prov: externalProv }: { onComplete: () => void; prov?: UseProvidersReturn }) {
  const [state, setState] = useState<TurboState>(INITIAL_STATE)
  const [showLog, setShowLog] = useState(false)
  const [discover, setDiscover] = useState(true)
  const internalProv = useProviders()
  const prov = externalProv || internalProv

  let eventId = 0

  const handleTurbo = useCallback(async () => {
    setState({ ...INITIAL_STATE, running: true })

    try {
      const res = await fetch("/api/maps/turbo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discover,
          providers: Array.from(prov.enabledIds),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setState((s) => ({ ...s, running: false, error: err.error || "Failed" }))
        return
      }

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let eventType = ""
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7)
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              const evt: TurboEvent = { id: eventId++, event: eventType, data, ts: Date.now() }

              setState((s) => {
                const ns = { ...s, events: [...s.events, evt] }
                const vs = new Map(s.verticalStatus)

                switch (eventType) {
                  case "turbo_status":
                    ns.phase = data.phase
                    break
                  case "discovery_complete":
                    break
                  case "vertical_start": {
                    vs.set(data.slug, { started: true, done: false, providers: 0, failed: 0, players: 0, subs: 0 })
                    ns.verticalStatus = vs
                    break
                  }
                  case "provider_complete": {
                    const v = vs.get(data.slug)
                    if (v) {
                      if (data.success) v.providers++
                      else v.failed++
                      vs.set(data.slug, v)
                      ns.verticalStatus = vs
                    }
                    break
                  }
                  case "vertical_complete": {
                    const v = vs.get(data.slug)
                    if (v) {
                      v.done = true
                      v.players = data.totalPlayers
                      v.subs = data.subCategories
                      vs.set(data.slug, v)
                      ns.verticalStatus = vs
                    }
                    break
                  }
                  case "enrich_progress":
                    ns.enriched = data.enriched
                    ns.enrichTotal = data.total
                    break
                  case "turbo_done":
                    ns.running = false
                    ns.done = true
                    ns.verticalsGenerated = data.verticalsGenerated
                    ns.verticalsFailed = data.verticalsFailed
                    ns.totalSubCategories = data.totalSubCategories
                    ns.totalPlayers = data.totalPlayers
                    break
                  case "turbo_error":
                    ns.running = false
                    ns.error = data.message
                    break
                }
                return ns
              })
            } catch {
              // skip
            }
            eventType = ""
          }
        }
      }

      onComplete()
    } catch (err) {
      setState((s) => ({
        ...s,
        running: false,
        error: err instanceof Error ? err.message : "Network error",
      }))
    }
  }, [onComplete, discover, prov.enabledIds])

  // ── Pre-run view: controls + provider picker ──
  if (!state.running && !state.done && !state.error) {
    return (
      <div className="space-y-3">
        <div className="inline-flex items-center gap-3">
          <button
            onClick={handleTurbo}
            disabled={prov.enabledCount === 0 || prov.loading}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-600 to-purple-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:from-brand-700 hover:to-purple-700 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Zap className="h-4 w-4" />
            Turbo Populate All
          </button>
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={discover}
              onChange={(e) => setDiscover(e.target.checked)}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Discover new verticals
          </label>
        </div>

        {/* Only show picker if no external prov was passed (standalone mode) */}
        {!externalProv && <ProviderPicker prov={prov} />}
      </div>
    )
  }

  // ── Running / Done / Error view ──
  const verticals = Array.from(state.verticalStatus.entries())
  const enrichPct = state.enrichTotal > 0 ? Math.round((state.enriched / state.enrichTotal) * 100) : 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8 animate-view-enter">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {state.running && <Loader2 className="h-5 w-5 text-brand-500 animate-spin" />}
          {state.done && <CheckCircle2 className="h-5 w-5 text-green-500" />}
          {state.error && <XCircle className="h-5 w-5 text-red-500" />}
          <h3 className="font-semibold text-gray-900">
            {state.running
              ? state.phase === "discovery" ? "Discovering verticals..."
                : state.phase === "enrichment" ? "Enriching subcategories..."
                : "Generating maps..."
              : state.done
                ? "Turbo populate complete"
                : "Turbo populate failed"}
          </h3>
        </div>
        {state.done && (
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>{state.verticalsGenerated} verticals</span>
            <span>{state.totalSubCategories} subcategories</span>
            <span className="font-bold text-brand-600">{state.totalPlayers} players</span>
          </div>
        )}
      </div>

      {state.error && (
        <div className="text-sm text-red-600 mb-3">{state.error}</div>
      )}

      {/* Active providers indicator */}
      {state.running && (
        <div className="mb-4">
          <ActiveProviderChips prov={prov} />
        </div>
      )}

      {/* Per-vertical status */}
      {verticals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
          {verticals.map(([slug, v]) => (
            <div
              key={slug}
              className={`rounded-lg px-3 py-2 text-xs border ${
                v.done
                  ? "bg-green-50 border-green-200"
                  : v.started
                    ? "bg-brand-50 border-brand-200"
                    : "bg-gray-50 border-gray-200"
              }`}
            >
              <div className="font-medium text-gray-900 truncate">{slug}</div>
              {v.done ? (
                <div className="text-green-600 mt-0.5">{v.players} players, {v.subs} subs</div>
              ) : v.started ? (
                <div className="text-brand-600 mt-0.5">
                  {v.providers} providers done
                  {v.failed > 0 && <span className="text-red-500"> ({v.failed} failed)</span>}
                </div>
              ) : (
                <div className="text-gray-400 mt-0.5">Waiting...</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Enrichment progress */}
      {state.phase === "enrichment" && state.running && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Enriching subcategories</span>
            <span>{state.enriched}/{state.enrichTotal}</span>
          </div>
          <div className="bg-gray-100 rounded-full h-2">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${enrichPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Event log */}
      <button
        onClick={() => setShowLog(!showLog)}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        {showLog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {state.events.length} events
      </button>
      {showLog && (
        <div className="mt-2 max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-3 text-[11px] font-mono text-gray-500 space-y-0.5">
          {state.events.map((evt) => (
            <div key={evt.id}>
              <span className="text-gray-400">[{new Date(evt.ts).toLocaleTimeString()}]</span>{" "}
              <span className="text-brand-600">{evt.event}</span>{" "}
              {JSON.stringify(evt.data).slice(0, 120)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
