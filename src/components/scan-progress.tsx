"use client"

import { CheckCircle2, Circle, Loader2 } from "lucide-react"

const STAGES = [
  { key: "intent", label: "Analyzing idea" },
  { key: "competitors", label: "Scanning competitive map" },
  { key: "gaps", label: "Identifying market gaps" },
  { key: "dd_report", label: "Generating DD report & pivot strategies" },
]

interface ScanProgressProps {
  currentStage: string
  completedStages: string[]
  error?: string
}

export function ScanProgress({ currentStage, completedStages, error }: ScanProgressProps) {
  return (
    <div className="w-full max-w-md mx-auto space-y-3">
      {STAGES.map((stage) => {
        const isCompleted = completedStages.includes(stage.key)
        const isCurrent = currentStage === stage.key
        const isPending = !isCompleted && !isCurrent

        return (
          <div
            key={stage.key}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${
              isCompleted
                ? "bg-green-50 text-green-700"
                : isCurrent
                  ? "bg-brand-50 text-brand-700"
                  : "bg-gray-100 text-gray-400"
            }`}
          >
            {isCompleted ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
            ) : isCurrent ? (
              <Loader2 className="h-5 w-5 text-brand-500 animate-spin flex-shrink-0" />
            ) : (
              <Circle className="h-5 w-5 flex-shrink-0" />
            )}
            <span className={`text-sm font-medium ${isPending ? "opacity-50" : ""}`}>
              {stage.label}
            </span>
          </div>
        )
      })}
      {error && (
        <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
