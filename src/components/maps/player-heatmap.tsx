"use client"

import { useState, useEffect, useMemo, Fragment } from "react"
import { Search, ChevronUp, ChevronDown, LayoutGrid, Table2 } from "lucide-react"
import { stringify } from "@/lib/utils"
import { type SubCategoryPlayer } from "@/lib/types"
import { PlayerDetailCard, getStageColor } from "./player-detail-card"
import { CompanyIcon } from "./company-icon"

// ── Factor abbreviations ──────────────────────────────────────────────

const FACTOR_ABBREVS: [string, string][] = [
  ["developer experience", "DX"],
  ["ai capabilities", "AI"],
  ["enterprise readiness", "Ent"],
  ["open source", "OSS"],
  ["integration ecosystem", "Integ"],
  ["cost efficiency", "Cost"],
  ["scalability", "Scale"],
  ["ease of use", "EoU"],
]

function lowerText(value: unknown): string {
  return stringify(value).toLowerCase()
}

function abbreviateFactor(factor: unknown): string {
  const text = stringify(factor)
  const lower = text.toLowerCase()
  for (const [key, abbrev] of FACTOR_ABBREVS) {
    if (lower.includes(key)) return abbrev
  }
  return text.split(/[\s(/]+/)[0].slice(0, 5)
}

// ── Heatmap color scale: white → indigo (colorblind-safe) ─────────────

function heatmapBg(ratio: number): string {
  if (ratio <= 0) return "#f9fafb"
  const l = 97 - ratio * (97 - 45)
  return `hsl(230, 70%, ${l.toFixed(1)}%)`
}

function heatmapText(ratio: number): string {
  return ratio > 0.55 ? "#ffffff" : "#1f2937"
}

// ── Funding parser (for sorting) ──────────────────────────────────────

function parseFundingForSort(f: string): number {
  if (!f || typeof f !== "string") return 0
  const cleaned = f.replace(/[^0-9.BMKbmk]/g, "")
  const match = cleaned.match(/^([\d.]+)\s*([BMKbmk])?/)
  if (!match) return 0
  const num = parseFloat(match[1])
  if (isNaN(num)) return 0
  const suffix = (match[2] || "").toUpperCase()
  if (suffix === "B") return num * 1e9
  if (suffix === "M") return num * 1e6
  if (suffix === "K") return num * 1e3
  return num
}

// ── Stage chip labels ─────────────────────────────────────────────────

function stageChipLabel(stage: string): string {
  if (!stage || typeof stage !== "string") return "?"
  const s = stage.toLowerCase()
  if (s.includes("pre-seed") || s.includes("pre seed")) return "Pre"
  if (s.includes("seed")) return "Seed"
  if (s.includes("series a")) return "A"
  if (s.includes("series b")) return "B"
  if (s.includes("series c")) return "C"
  if (s.includes("series d")) return "D+"
  if (s.includes("ipo") || s.includes("public")) return "IPO"
  if (s.includes("bootstrap")) return "Boot"
  if (s.includes("research")) return "R&D"
  if (s.includes("open source")) return "OSS"
  if (s.includes("corporate")) return "Corp"
  if (s.includes("private equity")) return "PE"
  if (s.includes("late")) return "Late"
  if (s.includes("growth")) return "Grth"
  if (s.includes("early")) return "Erly"
  if (s.includes("acquired")) return "Acq"
  if (s.includes("unknown")) return "?"
  return stage.slice(0, 4)
}

// ── Factor matching (word-overlap for fuzzy names) ────────────────────

function extractWords(s: unknown): string[] {
  return lowerText(s).replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3)
}

function factorsMatch(playerFactor: unknown, canonicalFactor: unknown): boolean {
  const pLower = lowerText(playerFactor)
  const cLower = lowerText(canonicalFactor)
  // Direct substring
  if (pLower.includes(cLower) || cLower.includes(pLower)) return true
  // Word overlap
  const pWords = extractWords(playerFactor)
  const cWords = extractWords(canonicalFactor)
  for (const pw of pWords) {
    for (const cw of cWords) {
      if (pw === cw || (pw.length >= 4 && cw.length >= 4 && (pw.includes(cw) || cw.includes(pw)))) return true
    }
  }
  return false
}

// ── Types ─────────────────────────────────────────────────────────────

type ShowFilter = "top50" | "top100" | "funded" | "all"
type SortKey = "composite" | "name" | "funding" | "execution" | "vision" | `factor-${number}`
type ViewMode = "heatmap" | "cards"

interface PlayerHeatmapProps {
  players: SubCategoryPlayer[]
  strategyCanvasFactors: string[]
}

type NormalizedCompetitiveFactor = { factor: string; score: number }
type NormalizedPlayer = Omit<SubCategoryPlayer, "name" | "oneLiner" | "funding" | "stage" | "executionScore" | "visionScore" | "competitiveFactors"> & {
  name: string
  oneLiner: string
  funding: string
  stage: string
  executionScore: number
  visionScore: number
  competitiveFactors: NormalizedCompetitiveFactor[]
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

// ── Component ─────────────────────────────────────────────────────────

export function PlayerHeatmap({ players, strategyCanvasFactors }: PlayerHeatmapProps) {
  const [showFilter, setShowFilter] = useState<ShowFilter>("top50")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [activeStages, setActiveStages] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>("composite")
  const [sortAsc, setSortAsc] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("heatmap")
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const normalizedFactors = useMemo(
    () => (Array.isArray(strategyCanvasFactors) ? strategyCanvasFactors : [])
      .map((f) => stringify(f).trim())
      .filter(Boolean),
    [strategyCanvasFactors],
  )
  const normalizedPlayers = useMemo<NormalizedPlayer[]>(
    () => (Array.isArray(players) ? players : []).map((player) => ({
      ...player,
      name: stringify(player?.name),
      oneLiner: stringify(player?.oneLiner),
      funding: stringify(player?.funding),
      stage: stringify(player?.stage),
      executionScore: clampNumber(player?.executionScore, 0, 100),
      visionScore: clampNumber(player?.visionScore, 0, 100),
      websiteUrl: typeof player?.websiteUrl === "string" ? player.websiteUrl : undefined,
      logoUrl: typeof player?.logoUrl === "string" ? player.logoUrl : undefined,
      competitiveFactors: (Array.isArray(player?.competitiveFactors) ? player.competitiveFactors : []).map((cf: any) => ({
        factor: stringify(cf?.factor),
        score: clampNumber(cf?.score, 0, 10),
      })),
    })),
    [players],
  )

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Build factor score map per player: Map<canonicalFactorIndex, score>
  const factorScoreMap = useMemo(() => {
    return normalizedPlayers.map((player) => {
      const scores = new Map<number, number>()
      for (const cf of player.competitiveFactors) {
        const factorName = lowerText(cf.factor)
        for (let i = 0; i < normalizedFactors.length; i++) {
          const canonical = lowerText(normalizedFactors[i])
          if (factorsMatch(factorName, canonical)) {
            scores.set(i, cf.score)
            break
          }
        }
      }
      return scores
    })
  }, [normalizedPlayers, normalizedFactors])

  // Composite score: (exec+vision)/2 * 0.6 + avgFactor*10 * 0.4
  const compositeScores = useMemo(() => {
    return normalizedPlayers.map((player, idx) => {
      const execVision = (player.executionScore + player.visionScore) / 2
      const factors = factorScoreMap[idx]
      let avgFactor = 0
      if (factors.size > 0) {
        let sum = 0
        for (const v of factors.values()) sum += v
        avgFactor = sum / factors.size
      }
      return execVision * 0.6 + avgFactor * 10 * 0.4
    })
  }, [normalizedPlayers, factorScoreMap])

  // Unique stages with counts
  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of normalizedPlayers) {
      const stage = stringify(p.stage)
      if (stage) counts.set(stage, (counts.get(stage) || 0) + 1)
    }
    return counts
  }, [normalizedPlayers])

  // Filter + sort → array of original player indices
  const filteredIndices = useMemo(() => {
    let indices = normalizedPlayers.map((_, i) => i)

    // Stage filter
    if (activeStages.size > 0) {
      indices = indices.filter((i) => activeStages.has(stringify(normalizedPlayers[i].stage)))
    }

    // Search filter
    if (debouncedSearch) {
      const q = lowerText(debouncedSearch)
      indices = indices.filter((i) => {
        const p = normalizedPlayers[i]
        return (
          lowerText(p.name).includes(q) ||
          lowerText(p.oneLiner).includes(q)
        )
      })
    }

    // Funded-only filter
    if (showFilter === "funded") {
      indices = indices.filter((i) => parseFundingForSort(stringify(normalizedPlayers[i].funding)) > 0)
    }

    // Sort
    indices.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "composite":
          cmp = compositeScores[a] - compositeScores[b]
          break
        case "name":
          cmp = stringify(normalizedPlayers[a].name).localeCompare(stringify(normalizedPlayers[b].name))
          break
        case "funding":
          cmp =
            parseFundingForSort(stringify(normalizedPlayers[a].funding)) -
            parseFundingForSort(stringify(normalizedPlayers[b].funding))
          break
        case "execution":
          cmp = normalizedPlayers[a].executionScore - normalizedPlayers[b].executionScore
          break
        case "vision":
          cmp = normalizedPlayers[a].visionScore - normalizedPlayers[b].visionScore
          break
        default:
          if (sortKey.startsWith("factor-")) {
            const fi = parseInt(sortKey.slice(7))
            cmp = (factorScoreMap[a].get(fi) || 0) - (factorScoreMap[b].get(fi) || 0)
          }
      }
      return sortAsc ? cmp : -cmp
    })

    // Limit
    if (showFilter === "top50") indices = indices.slice(0, 50)
    else if (showFilter === "top100") indices = indices.slice(0, 100)

    return indices
  }, [normalizedPlayers, activeStages, debouncedSearch, showFilter, sortKey, sortAsc, compositeScores, factorScoreMap])

  function handleColumnSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(false)
    }
    setExpandedRow(null)
  }

  function toggleStage(stage: string) {
    setActiveStages((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  const factorAbbrevs = useMemo(
    () => normalizedFactors.map(abbreviateFactor),
    [normalizedFactors],
  )

  const colCount = 6 + normalizedFactors.length

  function SortIndicator({ column }: { column: SortKey }) {
    if (sortKey !== column) return null
    return sortAsc ? (
      <ChevronUp className="h-3 w-3 inline ml-0.5" />
    ) : (
      <ChevronDown className="h-3 w-3 inline ml-0.5" />
    )
  }

  return (
    <div>
      {/* ── Filter Bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Show dropdown */}
        <select
          id="players-show-filter"
          name="playersShowFilter"
          value={showFilter}
          onChange={(e) => setShowFilter(e.target.value as ShowFilter)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="top50">Top 50</option>
          <option value="top100">Top 100</option>
          <option value="funded">Funded only</option>
          <option value="all">All</option>
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            id="players-search-query"
            name="playersSearchQuery"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full text-xs border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 bg-white text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {/* Stage chips */}
        <div className="flex items-center gap-1">
          {Array.from(stageCounts.entries()).map(([stage, count]) => (
            <button
              key={stage}
              onClick={() => toggleStage(stage)}
              className={`text-[10px] font-medium px-2 py-1 rounded-full border transition-colors ${
                activeStages.size === 0 || activeStages.has(stage)
                  ? getStageColor(stage) + " border-transparent"
                  : "bg-gray-50 text-gray-400 border-gray-200"
              }`}
            >
              {stageChipLabel(stage)}
              <span className="ml-0.5 opacity-60">{count}</span>
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <select
          id="players-sort-key"
          name="playersSortKey"
          value={sortKey}
          onChange={(e) => {
            setSortKey(e.target.value as SortKey)
            setSortAsc(false)
            setExpandedRow(null)
          }}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="composite">Sort: Composite</option>
          <option value="execution">Sort: Execution</option>
          <option value="vision">Sort: Vision</option>
          <option value="funding">Sort: Funding</option>
          <option value="name">Sort: Name</option>
        </select>

        {/* View toggle */}
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode("heatmap")}
            className={`p-1.5 transition-colors ${
              viewMode === "heatmap"
                ? "bg-brand-600 text-white"
                : "bg-white text-gray-500 hover:bg-gray-50"
            }`}
            title="Heatmap view"
          >
            <Table2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("cards")}
            className={`p-1.5 transition-colors ${
              viewMode === "cards"
                ? "bg-brand-600 text-white"
                : "bg-white text-gray-500 hover:bg-gray-50"
            }`}
            title="Cards view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Count */}
        <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
          {filteredIndices.length} of {normalizedPlayers.length} players
        </span>
      </div>

      {/* ── Content ── */}
      {viewMode === "heatmap" ? (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table
            className="w-full"
            style={{ tableLayout: "fixed", fontVariantNumeric: "tabular-nums" }}
          >
            <colgroup>
              <col style={{ width: 32 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 48 }} />
              <col style={{ width: 48 }} />
              {normalizedFactors.map((_, i) => (
                <col key={i} style={{ width: 48 }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-1 py-2 text-[10px] font-medium text-gray-500 text-right">
                  #
                </th>
                <th
                  className="px-3 py-2 text-[10px] font-medium text-gray-500 text-left cursor-pointer hover:text-gray-900 select-none"
                  onClick={() => handleColumnSort("name")}
                >
                  Name <SortIndicator column="name" />
                </th>
                <th className="px-2 py-2 text-[10px] font-medium text-gray-500 text-left">
                  Stage
                </th>
                <th
                  className="px-2 py-2 text-[10px] font-medium text-gray-500 text-right cursor-pointer hover:text-gray-900 select-none"
                  onClick={() => handleColumnSort("funding")}
                >
                  Fund <SortIndicator column="funding" />
                </th>
                <th
                  className="px-1 py-2 text-[10px] font-medium text-gray-500 text-center cursor-pointer hover:text-gray-900 select-none"
                  onClick={() => handleColumnSort("execution")}
                  title="Execution Score (0-100)"
                >
                  Exec <SortIndicator column="execution" />
                </th>
                <th
                  className="px-1 py-2 text-[10px] font-medium text-gray-500 text-center cursor-pointer hover:text-gray-900 select-none"
                  onClick={() => handleColumnSort("vision")}
                  title="Vision Score (0-100)"
                >
                  Vis <SortIndicator column="vision" />
                </th>
                {normalizedFactors.map((factor, fi) => (
                  <th
                    key={fi}
                    className="px-1 py-2 text-[10px] font-medium text-gray-500 text-center cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => handleColumnSort(`factor-${fi}`)}
                    title={factor}
                  >
                    {factorAbbrevs[fi]} <SortIndicator column={`factor-${fi}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredIndices.map((playerIdx, rank) => {
                const player = normalizedPlayers[playerIdx]
                const factors = factorScoreMap[playerIdx]
                const isExpanded = expandedRow === playerIdx

                return (
                  <Fragment key={playerIdx}>
                    <tr
                      className={`cursor-pointer transition-colors border-b border-gray-100 ${
                        isExpanded ? "bg-indigo-50/60" : "hover:bg-indigo-50/40"
                      }`}
                      style={{ height: 32 }}
                      onClick={() => setExpandedRow(isExpanded ? null : playerIdx)}
                    >
                      <td className="px-1 text-[11px] text-gray-400 text-right">
                        {rank + 1}
                      </td>
                      <td
                        className="px-3 text-xs font-medium text-gray-900 truncate"
                        title={stringify(player.oneLiner)}
                      >
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <CompanyIcon
                            name={stringify(player.name)}
                            websiteUrl={player.websiteUrl}
                            logoUrl={player.logoUrl}
                            size={16}
                          />
                          <span className="truncate">{stringify(player.name)}</span>
                        </span>
                      </td>
                      <td className="px-2">
                        {player.stage && (
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getStageColor(
                              stringify(player.stage),
                            )}`}
                          >
                            {stageChipLabel(stringify(player.stage))}
                          </span>
                        )}
                      </td>
                      <td className="px-2 text-[11px] text-gray-600 text-right truncate">
                        {stringify(player.funding)}
                      </td>
                      <td
                        className="px-1 text-[11px] font-medium text-center"
                        style={{
                          backgroundColor: heatmapBg(player.executionScore / 100),
                          color: heatmapText(player.executionScore / 100),
                        }}
                      >
                        {player.executionScore}
                      </td>
                      <td
                        className="px-1 text-[11px] font-medium text-center"
                        style={{
                          backgroundColor: heatmapBg(player.visionScore / 100),
                          color: heatmapText(player.visionScore / 100),
                        }}
                      >
                        {player.visionScore}
                      </td>
                      {normalizedFactors.map((_, fi) => {
                        const score = factors.get(fi) || 0
                        const ratio = score / 10
                        return (
                          <td
                            key={fi}
                            className="px-1 text-[11px] font-medium text-center"
                            style={{
                              backgroundColor: heatmapBg(ratio),
                              color: heatmapText(ratio),
                            }}
                          >
                            {score || ""}
                          </td>
                        )
                      })}
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td
                          colSpan={colCount}
                          className="p-3 bg-gray-50/80 border-b border-gray-200"
                        >
                          <div className="max-w-md">
                            <PlayerDetailCard
                              player={player}
                              strategyCanvasFactors={normalizedFactors}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Cards view — no stagger animation */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredIndices.map((playerIdx) => (
            <PlayerDetailCard
              key={playerIdx}
              player={normalizedPlayers[playerIdx]}
              strategyCanvasFactors={normalizedFactors}
            />
          ))}
        </div>
      )}

      {filteredIndices.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          No players match the current filters.
        </div>
      )}
    </div>
  )
}
