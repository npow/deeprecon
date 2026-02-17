"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { ReadinessScore } from "@/lib/readiness-score"

interface ReadinessScoreCardProps {
  score: ReadinessScore
  evidenceConfidence?: number | null
  lucrativenessScore?: number | null
  lucrativenessTier?: "low" | "medium" | "high" | "very_high" | null
}

function gradeColor(grade: string) {
  switch (grade) {
    case "A": return { ring: "text-green-500", bg: "bg-green-50", text: "text-green-700", border: "border-green-200" }
    case "B": return { ring: "text-blue-500", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" }
    case "C": return { ring: "text-yellow-500", bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" }
    case "D": return { ring: "text-orange-500", bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" }
    default: return { ring: "text-red-500", bg: "bg-red-50", text: "text-red-700", border: "border-red-200" }
  }
}

function CircularProgress({ value, grade }: { value: number; grade: string }) {
  const colors = gradeColor(grade)
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference

  return (
    <div className="relative w-32 h-32 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-100" />
        <circle
          cx="60" cy="60" r={radius} fill="none" strokeWidth="8"
          stroke="currentColor"
          className={colors.ring}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease-in-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        <span className={`text-sm font-bold ${colors.text}`}>{grade}</span>
      </div>
    </div>
  )
}

function RadarChart({ breakdown }: { breakdown: ReadinessScore["breakdown"] }) {
  const n = breakdown.length
  const cx = 130, cy = 130, maxR = 80
  const angleStep = (2 * Math.PI) / n

  // Polygon points for each factor
  const points = breakdown.map((b, i) => {
    const pct = b.score / b.max
    const angle = i * angleStep - Math.PI / 2
    return {
      x: cx + maxR * pct * Math.cos(angle),
      y: cy + maxR * pct * Math.sin(angle),
    }
  })

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1.0]

  // Label positions (outside the chart with room for text)
  const labels = breakdown.map((b, i) => {
    const angle = i * angleStep - Math.PI / 2
    const labelR = maxR + 28
    return {
      x: cx + labelR * Math.cos(angle),
      y: cy + labelR * Math.sin(angle),
      name: b.factor.replace("Competitive ", "Comp. "),
      pct: Math.round((b.score / b.max) * 100),
    }
  })

  return (
    <svg viewBox="0 0 260 260" className="w-full max-w-[220px]">
      {/* Grid */}
      {rings.map((r) => (
        <polygon
          key={r}
          points={Array.from({ length: n }, (_, i) => {
            const angle = i * angleStep - Math.PI / 2
            return `${cx + maxR * r * Math.cos(angle)},${cy + maxR * r * Math.sin(angle)}`
          }).join(" ")}
          fill="none" stroke="#e5e7eb" strokeWidth="0.5"
        />
      ))}
      {/* Axis lines */}
      {Array.from({ length: n }, (_, i) => {
        const angle = i * angleStep - Math.PI / 2
        return (
          <line key={i}
            x1={cx} y1={cy}
            x2={cx + maxR * Math.cos(angle)}
            y2={cy + maxR * Math.sin(angle)}
            stroke="#e5e7eb" strokeWidth="0.5"
          />
        )
      })}
      {/* Data polygon */}
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="rgba(99, 102, 241, 0.15)"
        stroke="rgb(99, 102, 241)"
        strokeWidth="1.5"
      />
      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="rgb(99, 102, 241)" />
      ))}
      {/* Labels */}
      {labels.map((l, i) => (
        <text
          key={i} x={l.x} y={l.y}
          textAnchor="middle" dominantBaseline="middle"
          className="text-[6px] fill-gray-500 font-medium"
        >
          {l.name}
        </text>
      ))}
    </svg>
  )
}

function BreakdownList({ breakdown }: { breakdown: ReadinessScore["breakdown"] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-1">
      {breakdown.map((b) => {
        const pct = Math.round((b.score / b.max) * 100)
        const isOpen = expanded === b.factor
        const hasExplanation = !!b.explanation

        return (
          <div key={b.factor}>
            <button
              type="button"
              onClick={() => hasExplanation && setExpanded(isOpen ? null : b.factor)}
              className={`w-full flex items-center gap-2 group ${hasExplanation ? "cursor-pointer" : "cursor-default"}`}
            >
              <span className="text-xs text-gray-500 w-28 flex-shrink-0 truncate text-left" title={b.factor}>
                {b.factor}
              </span>
              <div className="flex-1 bg-white/60 rounded-full h-2 min-w-0">
                <div
                  className={`h-2 rounded-full transition-all duration-700 ${
                    pct >= 70 ? "bg-green-400" : pct >= 40 ? "bg-yellow-400" : "bg-red-400"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-600 w-10 text-right">
                {b.score}/{b.max}
              </span>
              {hasExplanation && (
                <ChevronDown
                  className={`h-3 w-3 text-gray-400 transition-transform flex-shrink-0 ${
                    isOpen ? "rotate-180" : ""
                  } group-hover:text-gray-600`}
                />
              )}
            </button>
            {isOpen && b.explanation && (
              <p className="text-xs text-gray-500 mt-1 ml-[7.5rem] mr-8 mb-1.5 leading-relaxed animate-fade-in">
                {b.explanation}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function evidenceTone(score: number): string {
  if (score >= 80) return "bg-green-50 text-green-700 border-green-200"
  if (score >= 60) return "bg-yellow-50 text-yellow-700 border-yellow-200"
  return "bg-red-50 text-red-700 border-red-200"
}

function cloneRiskTone(level?: "low" | "medium" | "high"): string {
  if (level === "high") return "bg-red-50 text-red-700 border-red-200"
  if (level === "medium") return "bg-orange-50 text-orange-700 border-orange-200"
  return "bg-yellow-50 text-yellow-700 border-yellow-200"
}

function lucrativenessTone(tier?: "low" | "medium" | "high" | "very_high" | null): string {
  if (tier === "very_high") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (tier === "high") return "bg-green-50 text-green-700 border-green-200"
  if (tier === "medium") return "bg-yellow-50 text-yellow-700 border-yellow-200"
  return "bg-gray-50 text-gray-700 border-gray-200"
}

export function ReadinessScoreCard({
  score,
  evidenceConfidence = null,
  lucrativenessScore = null,
  lucrativenessTier = null,
}: ReadinessScoreCardProps) {
  const colors = gradeColor(score.grade)

  return (
    <div className={`${colors.bg} ${colors.border} border rounded-xl p-5 mb-6 animate-slide-up`}>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Left: Circular score */}
        <CircularProgress value={score.total} grade={score.grade} />

        {/* Center: Verdict + breakdown bars */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-gray-900">Startup Readiness Score</h2>
            {evidenceConfidence != null && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${evidenceTone(evidenceConfidence)}`}>
                Evidence Confidence: {evidenceConfidence}/100
              </span>
            )}
            {lucrativenessScore != null && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${lucrativenessTone(lucrativenessTier)}`}>
                Lucrativeness: {lucrativenessScore}/100
              </span>
            )}
            {score.cloneRisk && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${cloneRiskTone(score.cloneRisk.level)}`}>
                Clone Risk: {score.cloneRisk.level}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mb-4">{score.verdict}</p>

          <BreakdownList breakdown={score.breakdown} />
        </div>

        {/* Right: Radar chart (hidden on small screens) */}
        <div className="hidden lg:block flex-shrink-0">
          <RadarChart breakdown={score.breakdown} />
        </div>
      </div>
    </div>
  )
}
