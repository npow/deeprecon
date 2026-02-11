"use client"

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  Cell,
} from "recharts"
import { type VerticalMap, type SubCategory } from "@/lib/types"
import { parseFundingString, stringify } from "@/lib/utils"

const TREND_COLORS: Record<string, string> = {
  heating_up: "#f97316",
  stable: "#6b7280",
  cooling_down: "#3b82f6",
}

interface BubbleData {
  name: string
  crowdedness: number
  opportunity: number
  funding: number
  radius: number
  trend: string
  playerCount: number
  slug: string
}

function prepareData(map: VerticalMap): BubbleData[] {
  const fundings = map.subCategories.map((s) => parseFundingString(s.totalFunding))
  const maxFunding = Math.max(...fundings, 1)

  return map.subCategories.map((sub: SubCategory, i: number) => ({
    name: stringify(sub.name),
    crowdedness: sub.crowdednessScore,
    opportunity: sub.opportunityScore,
    funding: fundings[i],
    radius: 8 + (fundings[i] / maxFunding) * 24,
    trend: sub.trendDirection,
    playerCount: sub.playerCount,
    slug: sub.slug,
  }))
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BubbleData }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs max-w-[220px]">
      <div className="font-semibold text-gray-900 mb-1">{d.name}</div>
      <div className="space-y-0.5 text-gray-600">
        <div>Crowdedness: <span className="font-medium">{d.crowdedness}</span></div>
        <div>Opportunity: <span className="font-medium">{d.opportunity}</span></div>
        <div>Funding: <span className="font-medium">{d.funding > 0 ? `$${(d.funding / 1e6).toFixed(0)}M` : "N/A"}</span></div>
        <div>Players: <span className="font-medium">{d.playerCount}</span></div>
      </div>
    </div>
  )
}

export function OpportunityScatterView({ map }: { map: VerticalMap }) {
  const data = prepareData(map)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Opportunity Scatter</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Bubble size = funding, color = trend. Sweet spot: low crowdedness, high opportunity (green zone).
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            {/* Sweet spot zone */}
            <ReferenceArea
              x1={0}
              x2={45}
              y1={55}
              y2={100}
              fill="#10b981"
              fillOpacity={0.08}
              stroke="#10b981"
              strokeOpacity={0.2}
              strokeDasharray="4 4"
            />
            <XAxis
              type="number"
              dataKey="crowdedness"
              domain={[0, 100]}
              name="Crowdedness"
              tick={{ fontSize: 11 }}
              label={{ value: "Crowdedness →", position: "bottom", offset: 0, fontSize: 11, fill: "#9ca3af" }}
            />
            <YAxis
              type="number"
              dataKey="opportunity"
              domain={[0, 100]}
              name="Opportunity"
              tick={{ fontSize: 11 }}
              label={{ value: "Opportunity →", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "#9ca3af" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Scatter data={data} shape="circle">
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={TREND_COLORS[entry.trend] || "#6b7280"}
                  fillOpacity={0.7}
                  stroke={TREND_COLORS[entry.trend] || "#6b7280"}
                  strokeWidth={1}
                  r={entry.radius}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Heating Up
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-500" /> Stable
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Cooling Down
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-auto">
            <span className="inline-block w-3 h-3 rounded border border-green-400 bg-green-50" /> Sweet Spot
          </div>
        </div>
      </div>
    </div>
  )
}
