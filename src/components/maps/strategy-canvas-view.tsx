"use client"

import { useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts"
import { type VerticalMap, type SubCategoryPlayer } from "@/lib/types"
import { stringify, parseFundingString, cn } from "@/lib/utils"
import { CompanyIcon } from "@/components/maps/company-icon"

const LINE_COLORS = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

interface PlayerLine {
  name: string
  funding: number
  scores: Map<string, number>
  color: string
  websiteUrl?: string
  logoUrl?: string
}

interface ChartPoint {
  factor: string
  [playerName: string]: string | number
}

interface ZoneInfo {
  factor: string
  type: "convergence" | "divergence" | "neutral"
}

function prepareData(map: VerticalMap): { players: PlayerLine[]; chartData: ChartPoint[]; zones: ZoneInfo[] } {
  // Collect all players, pick top 8 by funding
  const allPlayers: SubCategoryPlayer[] = []
  for (const sub of map.subCategories) {
    for (const p of sub.topPlayers) {
      allPlayers.push(p)
    }
  }
  allPlayers.sort((a, b) => parseFundingString(b.funding) - parseFundingString(a.funding))
  const topPlayers = allPlayers.slice(0, 8)

  const factors = map.strategyCanvasFactors

  // Build player lines
  const playerLines: PlayerLine[] = topPlayers.map((p, i) => {
    const scoreMap = new Map<string, number>()
    for (const cf of p.competitiveFactors || []) {
      scoreMap.set(stringify(cf.factor), cf.score)
    }
    return {
      name: stringify(p.name),
      funding: parseFundingString(p.funding),
      scores: scoreMap,
      color: LINE_COLORS[i % LINE_COLORS.length],
      websiteUrl: p.websiteUrl,
      logoUrl: p.logoUrl,
    }
  })

  // Build chart data points
  const chartData: ChartPoint[] = factors.map((factor) => {
    const point: ChartPoint = { factor }
    for (const pl of playerLines) {
      point[pl.name] = pl.scores.get(factor) ?? 0
    }
    return point
  })

  // Detect convergence/divergence zones
  const zones: ZoneInfo[] = factors.map((factor) => {
    const scores = playerLines.map((pl) => pl.scores.get(factor) ?? 0).filter((s) => s > 0)
    if (scores.length < 2) return { factor, type: "neutral" as const }
    const gap = Math.max(...scores) - Math.min(...scores)
    if (gap <= 2) return { factor, type: "convergence" as const }
    if (gap >= 4) return { factor, type: "divergence" as const }
    return { factor, type: "neutral" as const }
  })

  return { players: playerLines, chartData, zones }
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs max-w-[200px]">
      <div className="font-semibold text-gray-900 mb-1.5">{label}</div>
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-gray-600">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="font-medium text-gray-900">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StrategyCanvasView({ map }: { map: VerticalMap }) {
  const { players, chartData, zones } = prepareData(map)
  const [highlightedPlayer, setHighlightedPlayer] = useState<string | null>(null)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Strategy Canvas</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Blue Ocean style — red zones show convergence (red ocean), blue zones show divergence (white space opportunity).
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            {zones.map((z, i) => {
              if (z.type === "neutral") return null
              return (
                <ReferenceArea
                  key={`zone-${i}`}
                  x1={z.factor}
                  x2={z.factor}
                  fill={z.type === "convergence" ? "#ef4444" : "#3b82f6"}
                  fillOpacity={0.06}
                />
              )
            })}
            <XAxis
              dataKey="factor"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={60}
            />
            <YAxis
              domain={[0, 10]}
              tick={{ fontSize: 11 }}
              label={{ value: "Score", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "#9ca3af" }}
            />
            <Tooltip content={<CustomTooltip />} />
            {players.map((pl) => (
              <Line
                key={pl.name}
                type="monotone"
                dataKey={pl.name}
                stroke={pl.color}
                strokeWidth={highlightedPlayer === null || highlightedPlayer === pl.name ? 2.5 : 1}
                strokeOpacity={highlightedPlayer === null || highlightedPlayer === pl.name ? 1 : 0.2}
                dot={{ r: 3.5, fill: pl.color }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100">
          {players.map((pl) => (
            <button
              key={pl.name}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-all",
                highlightedPlayer === pl.name
                  ? "border-gray-400 bg-gray-50 font-medium text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              )}
              onClick={() => setHighlightedPlayer(highlightedPlayer === pl.name ? null : pl.name)}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: pl.color }} />
              <CompanyIcon name={pl.name} websiteUrl={pl.websiteUrl} logoUrl={pl.logoUrl} size={14} />
              {pl.name}
            </button>
          ))}
          <div className="flex items-center gap-3 ml-auto text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border border-red-200" /> Red Ocean</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-50 border border-blue-200" /> White Space</span>
          </div>
        </div>
      </div>
    </div>
  )
}
