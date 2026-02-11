"use client"

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Label,
} from "recharts"
import { type VerticalMap, type MegaCategoryDef } from "@/lib/types"
import { stringify } from "@/lib/utils"

interface QuadrantDot {
  name: string
  vision: number
  execution: number
  funding: string
  oneLiner: string
  megaCategory: string
  color: string
}

/** Normalize scores so median=50 and values spread across 5-95 range */
function normalizeScores(values: number[]): number[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  if (max === min) return values.map(() => 50)
  return values.map((v) => {
    const normalized = 5 + ((v - min) / (max - min)) * 90 // map to 5-95
    return Math.round(normalized)
  })
}

function prepareData(map: VerticalMap): QuadrantDot[] {
  const colorMap = new Map<string, string>()
  map.megaCategories.forEach((mc: MegaCategoryDef) => colorMap.set(mc.name, mc.color))

  // Collect raw data
  const raw: { name: string; exec: number; vision: number; funding: string; oneLiner: string; mega: string }[] = []
  for (const sub of map.subCategories) {
    for (const p of sub.topPlayers) {
      raw.push({
        name: stringify(p.name),
        exec: p.executionScore,
        vision: p.visionScore,
        funding: stringify(p.funding),
        oneLiner: stringify(p.oneLiner),
        mega: sub.megaCategory,
      })
    }
  }

  // Normalize to spread across full range
  const normExec = normalizeScores(raw.map((r) => r.exec))
  const normVision = normalizeScores(raw.map((r) => r.vision))

  return raw.map((r, i) => ({
    name: r.name,
    vision: normVision[i],
    execution: normExec[i],
    funding: r.funding,
    oneLiner: r.oneLiner,
    megaCategory: r.mega,
    color: colorMap.get(r.mega) || "#6366f1",
  }))
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: QuadrantDot }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs max-w-[240px]">
      <div className="font-semibold text-gray-900 mb-1">{d.name}</div>
      <p className="text-gray-500 mb-1.5 line-clamp-2">{d.oneLiner}</p>
      <div className="space-y-0.5 text-gray-600">
        <div>Execution: <span className="font-medium">{d.execution}</span></div>
        <div>Vision: <span className="font-medium">{d.vision}</span></div>
        <div>Funding: <span className="font-medium">{d.funding}</span></div>
      </div>
    </div>
  )
}

export function QuadrantView({ map }: { map: VerticalMap }) {
  const dots = prepareData(map)

  const megaColors = Array.from(new Set(dots.map((d) => d.megaCategory))).map((name) => ({
    name,
    color: dots.find((d) => d.megaCategory === name)!.color,
  }))

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Magic Quadrant</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Players positioned by execution strength (Y) and vision/innovation (X). Inspired by Gartner methodology.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <ResponsiveContainer width="100%" height={480}>
          <ScatterChart margin={{ top: 30, right: 30, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <ReferenceLine x={50} stroke="#d1d5db" strokeDasharray="6 4">
              <Label value="" />
            </ReferenceLine>
            <ReferenceLine y={50} stroke="#d1d5db" strokeDasharray="6 4">
              <Label value="" />
            </ReferenceLine>
            <XAxis
              type="number"
              dataKey="vision"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              label={{ value: "Vision →", position: "bottom", offset: 0, fontSize: 11, fill: "#9ca3af" }}
            />
            <YAxis
              type="number"
              dataKey="execution"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              label={{ value: "Execution →", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "#9ca3af" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Scatter data={dots}>
              {dots.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.color}
                  fillOpacity={0.8}
                  stroke={entry.color}
                  strokeWidth={1.5}
                  r={6}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>

        {/* Quadrant labels */}
        <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-gray-400 uppercase tracking-wider">
          <div className="text-right pr-4">Niche Players</div>
          <div className="pl-4">Visionaries</div>
          <div className="text-right pr-4">Challengers</div>
          <div className="pl-4">Leaders</div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-gray-100">
          {megaColors.map((mc) => (
            <div key={mc.name} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: mc.color }} />
              {mc.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
