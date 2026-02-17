"use client"

import { Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react"
import { useState } from "react"
import { type UseProvidersReturn } from "@/hooks/use-providers"

// Color mapping for provider families
export function providerColor(id: string): string {
  if (id.startsWith("claude")) return "bg-orange-100 border-orange-300 text-orange-800"
  if (id.startsWith("gpt")) return "bg-emerald-100 border-emerald-300 text-emerald-800"
  if (id.startsWith("gemini")) return "bg-blue-100 border-blue-300 text-blue-800"
  if (id.startsWith("deepseek")) return "bg-indigo-100 border-indigo-300 text-indigo-800"
  if (id.startsWith("qwen")) return "bg-violet-100 border-violet-300 text-violet-800"
  if (id.startsWith("kimi")) return "bg-pink-100 border-pink-300 text-pink-800"
  if (id.startsWith("glm")) return "bg-cyan-100 border-cyan-300 text-cyan-800"
  if (id.startsWith("ag-")) return "bg-amber-100 border-amber-300 text-amber-800"
  if (id.startsWith("cursor-")) return "bg-teal-100 border-teal-300 text-teal-800"
  if (id.startsWith("grok")) return "bg-rose-100 border-rose-300 text-rose-800"
  if (id.startsWith("minimax")) return "bg-lime-100 border-lime-300 text-lime-800"
  return "bg-gray-100 border-gray-300 text-gray-800"
}

function providerOwner(id: string): string {
  if (id.startsWith("claude")) return "Anthropic"
  if (id.startsWith("gpt")) return "OpenAI"
  if (id.startsWith("gemini")) return "Google"
  if (id.startsWith("deepseek")) return "DeepSeek"
  if (id.startsWith("qwen")) return "Alibaba"
  if (id.startsWith("kimi")) return "Moonshot"
  if (id.startsWith("glm")) return "Zhipu"
  if (id.startsWith("ag-")) return "Antigravity"
  if (id.startsWith("cursor-")) return "Cursor"
  if (id.startsWith("grok")) return "xAI"
  if (id.startsWith("minimax")) return "MiniMax"
  return ""
}

interface ProviderPickerProps {
  prov: UseProvidersReturn
  defaultExpanded?: boolean
}

export function ProviderPicker({ prov, defaultExpanded = false }: ProviderPickerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          AI Providers
          {prov.loading ? (
            <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin" />
          ) : (
            <span className="text-xs font-normal text-gray-500">
              {prov.enabledCount}/{prov.availableCount} enabled
              {prov.availableCount < prov.providers.length && (
                <span className="text-gray-400"> ({prov.providers.length - prov.availableCount} unavailable)</span>
              )}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {expanded && (
            <>
              <button
                onClick={prov.selectAll}
                className="text-[11px] text-brand-600 hover:text-brand-700 font-medium"
              >
                All
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={prov.selectNone}
                className="text-[11px] text-gray-500 hover:text-gray-700 font-medium"
              >
                None
              </button>
            </>
          )}
          <button
            onClick={prov.refresh}
            disabled={prov.loading}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            title="Refresh provider list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${prov.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {prov.providers.map((p) => {
            const enabled = prov.enabledIds.has(p.id)
            const color = providerColor(p.id)
            const owner = providerOwner(p.id)

            return (
              <button
                key={p.id}
                onClick={() => p.available && prov.toggle(p.id)}
                disabled={!p.available}
                className={`relative flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-all ${
                  !p.available
                    ? "bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed"
                    : enabled
                      ? `${color} ring-2 ring-offset-1 ring-brand-400 shadow-sm`
                      : "bg-white border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      !p.available
                        ? "bg-gray-300"
                        : enabled
                          ? "bg-green-500"
                          : "bg-gray-300"
                    }`}
                  />
                  <span className="text-xs font-semibold truncate">{p.label}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 pl-4">
                  {owner && (
                    <span className="text-[10px] text-gray-400">{owner}</span>
                  )}
                  {!p.available && (
                    <span className="text-[10px] text-red-400 ml-auto">offline</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Collapsed summary chips */}
      {!expanded && !prov.loading && (
        <div className="flex flex-wrap gap-1.5">
          {prov.providers.filter((p) => p.available).map((p) => {
            const enabled = prov.enabledIds.has(p.id)
            const color = providerColor(p.id)
            return (
              <button
                key={p.id}
                onClick={() => prov.toggle(p.id)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                  enabled
                    ? color
                    : "bg-white border-gray-200 text-gray-400 line-through"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-green-500" : "bg-gray-300"}`}
                />
                {p.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Compact row of active provider chips (for use during running state) */
export function ActiveProviderChips({ prov }: { prov: UseProvidersReturn }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {prov.providers.filter((p) => prov.enabledIds.has(p.id)).map((p) => (
        <span
          key={p.id}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${providerColor(p.id)}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          {p.label}
        </span>
      ))}
    </div>
  )
}
