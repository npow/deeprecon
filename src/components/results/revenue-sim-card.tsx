"use client"

import { useState } from "react"
import type { RevenueSimulation, ScenarioResult, MonthData } from "@/lib/revenue-sim"
import { TrendingUp, AlertTriangle, ChevronDown, DollarSign } from "lucide-react"

interface RevenueSimCardProps {
  sim: RevenueSimulation
}

function formatK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function MetricCard({ label, value, subtext }: { label: string; value: string; subtext?: string }) {
  return (
    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
      <div className="text-xs text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold text-gray-900 mt-1">{value}</div>
      {subtext && <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>}
    </div>
  )
}

function MrrBar({ month, maxMrr }: { month: MonthData; maxMrr: number }) {
  const pct = maxMrr > 0 ? (month.mrr / maxMrr) * 100 : 0
  const isPositive = month.net >= 0
  return (
    <div className="flex items-end flex-1 min-w-0">
      <div className="w-full h-16 flex items-end">
        <div
          className={`w-full rounded-t-sm transition-all ${isPositive ? "bg-green-400" : "bg-brand-400"}`}
          style={{ height: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  )
}

function QuarterlyTable({ months }: { months: MonthData[] }) {
  // Show quarterly (every 3rd month)
  const quarters = months.filter((m) => m.month % 3 === 0)
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-1.5 px-1 text-gray-400 font-medium">Quarter</th>
            <th className="text-right py-1.5 px-1 text-gray-400 font-medium">Customers</th>
            <th className="text-right py-1.5 px-1 text-gray-400 font-medium">MRR</th>
            <th className="text-right py-1.5 px-1 text-gray-400 font-medium">ARR</th>
            <th className="text-right py-1.5 px-1 text-gray-400 font-medium">CAC Spend</th>
            <th className="text-right py-1.5 px-1 text-gray-400 font-medium">Net</th>
            <th className="text-right py-1.5 px-1 text-gray-400 font-medium">Cash Flow</th>
          </tr>
        </thead>
        <tbody>
          {quarters.map((m) => (
            <tr key={m.month} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-1.5 px-1 font-medium text-gray-700">Q{m.month / 3}</td>
              <td className="py-1.5 px-1 text-right text-gray-600">{m.customers.toLocaleString()}</td>
              <td className="py-1.5 px-1 text-right text-gray-600">{formatK(m.mrr)}</td>
              <td className="py-1.5 px-1 text-right text-gray-600">{formatK(m.arr)}</td>
              <td className="py-1.5 px-1 text-right text-gray-600">{formatK(m.cacSpend)}</td>
              <td className={`py-1.5 px-1 text-right font-medium ${m.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatK(m.net)}
              </td>
              <td className={`py-1.5 px-1 text-right ${m.cumulativeCashFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatK(m.cumulativeCashFlow)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RevenueSimCard({ sim }: RevenueSimCardProps) {
  const [activeScenario, setActiveScenario] = useState(1) // Base case
  const [showTable, setShowTable] = useState(false)

  const scenario: ScenarioResult = sim.scenarios[activeScenario]
  const maxMrr = Math.max(...scenario.months.map((m) => m.mrr), 1)
  const month36 = scenario.months[35]

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-green-500" />
          <h3 className="font-semibold text-gray-900">Revenue Simulation</h3>
        </div>
        {/* Scenario toggle */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {sim.scenarios.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setActiveScenario(i)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                activeScenario === i
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Assumptions */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-500">
        <span><DollarSign className="h-3 w-3 inline" /> ARPU: ${sim.arpu}/mo <span className="text-gray-400">({sim.parsed.arpuSource})</span></span>
        <span>CAC: ${sim.cac} <span className="text-gray-400">({sim.parsed.cacSource})</span></span>
        <span>Margin: {Math.round(sim.grossMargin * 100)}%</span>
        <span>Churn: {Math.round(sim.churnRate * 100)}%/mo</span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <MetricCard
          label="Break-even"
          value={scenario.breakEvenMonth ? `Month ${scenario.breakEvenMonth}` : "36+ mo"}
          subtext={scenario.breakEvenMonth ? `~${Math.ceil(scenario.breakEvenMonth / 12)} year${Math.ceil(scenario.breakEvenMonth / 12) > 1 ? "s" : ""}` : "Not reached"}
        />
        <MetricCard
          label="Funding Needed"
          value={scenario.totalFundingNeeded > 0 ? formatK(scenario.totalFundingNeeded) : "$0"}
          subtext="To reach profitability"
        />
        <MetricCard
          label="LTV:CAC"
          value={scenario.ltvCacRatio ? `${scenario.ltvCacRatio}x` : "N/A"}
          subtext={scenario.ltvCacRatio && scenario.ltvCacRatio >= 3 ? "Healthy" : scenario.ltvCacRatio && scenario.ltvCacRatio >= 1 ? "Needs improvement" : "Negative unit econ"}
        />
        <MetricCard
          label="Month 36 ARR"
          value={month36 ? formatK(month36.arr) : "N/A"}
          subtext={month36 ? `${month36.customers.toLocaleString()} customers` : ""}
        />
      </div>

      {/* MRR chart */}
      <div className="mb-4">
        <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">MRR Growth (36 months)</div>
        <div className="flex gap-px items-end h-20 bg-gray-50 rounded-lg p-2">
          {scenario.months.map((m) => (
            <MrrBar key={m.month} month={m} maxMrr={maxMrr} />
          ))}
        </div>
        <div className="grid grid-cols-12 text-[9px] text-gray-400 mt-1 px-1">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="text-center">
              M{(i + 1) * 3}
            </span>
          ))}
        </div>
        <div className="flex justify-between text-[9px] text-gray-400 mt-1 px-1">
          <span>Month 1</span>
          <span>Month 12</span>
          <span>Month 24</span>
          <span>Month 36</span>
        </div>
      </div>

      {/* Warnings */}
      {sim.warnings.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {sim.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Sensitivity notes */}
      {sim.sensitivityNotes.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {sim.sensitivityNotes.map((n, i) => (
            <div key={i} className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              {n}
            </div>
          ))}
        </div>
      )}

      {/* Expandable quarterly table */}
      <button
        onClick={() => setShowTable(!showTable)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTable ? "rotate-180" : ""}`} />
        {showTable ? "Hide" : "Show"} quarterly breakdown
      </button>
      {showTable && (
        <div className="mt-3 animate-fade-in">
          <QuarterlyTable months={scenario.months} />
        </div>
      )}
    </div>
  )
}
