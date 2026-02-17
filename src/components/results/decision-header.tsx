"use client"

import type { ReadinessScore } from "@/lib/readiness-score"
import { Compass, ExternalLink } from "lucide-react"
import { LovableIcon, BoltIcon } from "./builder-icons"

interface DecisionHeaderProps {
  score: ReadinessScore
  onPrimaryAction?: () => void
  primaryLabel?: string
  lovableUrl?: string
  boltUrl?: string
}

function decisionFromGrade(grade: string): { title: string; tone: string } {
  if (grade === "A") return { title: "Go build and validate", tone: "bg-green-50 text-green-700 border-green-200" }
  if (grade === "B") return { title: "Go, but iterate fast", tone: "bg-blue-50 text-blue-700 border-blue-200" }
  if (grade === "C") return { title: "Iterate before committing", tone: "bg-yellow-50 text-yellow-700 border-yellow-200" }
  return { title: "Reposition before building", tone: "bg-red-50 text-red-700 border-red-200" }
}

export function DecisionHeader({
  score,
  onPrimaryAction,
  primaryLabel = "Run Recommended Remix",
  lovableUrl,
  boltUrl,
}: DecisionHeaderProps) {
  const decision = decisionFromGrade(score.grade)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 animate-slide-up">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400 font-medium">Decision</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-1 rounded-full border font-medium ${decision.tone}`}>
              {decision.title}
            </span>
            <span className="text-xs text-gray-500">Score {score.total}/100 · Grade {score.grade}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onPrimaryAction && (
            <button
              type="button"
              onClick={onPrimaryAction}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Compass className="h-3.5 w-3.5" />
              {primaryLabel}
            </button>
          )}
          {lovableUrl && (
            <a
              href={lovableUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 hover:border-purple-300 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <LovableIcon size={14} />
              Lovable
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {boltUrl && (
            <a
              href={boltUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 hover:border-brand-300 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <BoltIcon size={14} />
              Bolt
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-600">{score.verdict}</p>
    </div>
  )
}
