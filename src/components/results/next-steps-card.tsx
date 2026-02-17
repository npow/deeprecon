"use client"

import type { NextStep } from "@/lib/readiness-score"
import { safeStr } from "@/lib/utils"
import { ArrowRight, CheckCircle2, AlertCircle, Info } from "lucide-react"
import { RichText } from "./rich-text"

interface NextStepsCardProps {
  steps: NextStep[]
  grade: string
  onRescanStep?: (step: NextStep) => void
  isRescanningStep?: boolean
}

interface ParsedLegacyUniqueness {
  intro: string
  items: { action: string; detail: string }[]
}

function priorityIcon(priority: NextStep["priority"]) {
  switch (priority) {
    case "high": return <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
    case "medium": return <Info className="h-4 w-4 text-yellow-500 flex-shrink-0" />
    case "low": return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
  }
}

function gradeHeading(grade: string): string {
  switch (grade) {
    case "A": return "You're in great shape. Here's what to do next:"
    case "B": return "Promising — sharpen these areas to level up:"
    case "C": return "Needs work. Focus on these priorities:"
    case "D":
    case "F": return "Consider pivoting or addressing these critical gaps:"
    default: return "Recommended next steps:"
  }
}

function parseLegacyUniquenessDetail(detail: unknown): ParsedLegacyUniqueness | null {
  const s = safeStr(detail)
  const splitToken = "Recommended sequence:"
  if (!s.includes(splitToken)) return null

  const [rawIntro, rawPlan] = s.split(splitToken)
  const intro = (rawIntro || "").trim()
  const plan = (rawPlan || "").trim()
  if (!plan) return null

  const itemRegex = /(\d+)\)\s*([^:]+):\s*([\s\S]*?)(?=\s+\d+\)\s+[^:]+:\s*|$)/g
  const items: { action: string; detail: string }[] = []
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(plan)) !== null) {
    const action = (match[2] || "").trim()
    const stepDetail = (match[3] || "").trim()
    if (action || stepDetail) items.push({ action, detail: stepDetail })
  }

  if (items.length === 0) return null
  return { intro, items }
}

function isRescanStep(step: NextStep): boolean {
  return /re-?scan/i.test(safeStr(step.action)) || /re-?scan/i.test(safeStr(step.detail)) || !!step.refinedIdeaText
}

export function NextStepsCard({ steps, grade, onRescanStep, isRescanningStep = false }: NextStepsCardProps) {
  const orderedSteps = steps.slice(0, 5)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 animate-slide-up">
      <div className="flex items-center gap-2 mb-1">
        <ArrowRight className="h-5 w-5 text-brand-500" />
        <h3 className="font-semibold text-gray-900">What To Do Next</h3>
      </div>
      <p className="text-sm text-gray-500 mb-4">{gradeHeading(grade)}</p>
      <div className="space-y-2">
        {orderedSteps.map((step, i) => (
          (() => {
            const legacyUniqueness = safeStr(step.action).toLowerCase().startsWith("strengthen: uniqueness")
              ? parseLegacyUniquenessDetail(step.detail)
              : null

            return (
              <div
                key={`${step.action}-${i}`}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-gray-400 mt-0.5 w-5 flex-shrink-0">{i + 1}.</span>
                  {priorityIcon(step.priority)}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900"><RichText inline value={step.action} /></p>
                    {!legacyUniqueness && (
                      <RichText className="text-xs text-gray-500 mt-0.5 leading-relaxed break-words" value={step.detail} />
                    )}
                    {legacyUniqueness && (
                      <div className="mt-1">
                        <RichText className="text-xs text-gray-500 leading-relaxed break-words" value={legacyUniqueness.intro} />
                        <ol className="mt-1 pl-4 list-decimal space-y-1">
                          {legacyUniqueness.items.map((item, idx) => (
                            <li key={idx} className="text-xs text-gray-500">
                              <span className="font-medium text-gray-700">{item.action}:</span>{" "}
                              <RichText inline className="inline" value={item.detail} />
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {onRescanStep && isRescanStep(step) && (
                      <button
                        type="button"
                        disabled={isRescanningStep}
                        onClick={() => onRescanStep(step)}
                        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-white bg-brand-600 hover:bg-brand-700 px-2 py-1 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isRescanningStep ? "Re-scanning..." : step.refinedIdeaText ? "Apply + Re-scan" : "Re-scan"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })()
        ))}
      </div>
    </div>
  )
}
