"use client"

import { type ConfidenceLevel } from "@/lib/types"
import { Globe, Users, Brain } from "lucide-react"

interface SourceConfidenceBadgeProps {
  level?: ConfidenceLevel
  confirmedBy?: string[]
  confirmedByCount?: number
}

export function SourceConfidenceBadge({ level, confirmedBy, confirmedByCount }: SourceConfidenceBadgeProps) {
  if (!level) return null

  const tooltip = confirmedBy?.length
    ? `Sources: ${confirmedBy.join(", ")}`
    : undefined

  if (level === "web_verified") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full"
        title={tooltip}
      >
        <Globe className="h-3 w-3" />
        Web Verified
      </span>
    )
  }

  if (level === "multi_confirmed") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full"
        title={tooltip}
      >
        <Users className="h-3 w-3" />
        Multi-Confirmed{confirmedByCount && confirmedByCount > 1 ? ` (${confirmedByCount})` : ""}
      </span>
    )
  }

  if (level === "ai_inferred") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full"
        title={tooltip || "Single-source model result; not yet web/multi-source verified"}
      >
        <Brain className="h-3 w-3" />
        Unverified
      </span>
    )
  }

  return null
}
