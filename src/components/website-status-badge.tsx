"use client"

import { type WebsiteStatus } from "@/lib/types"
import { CheckCircle2, XCircle, AlertTriangle, ShieldAlert } from "lucide-react"

interface WebsiteStatusBadgeProps {
  status?: WebsiteStatus
  reason?: string
}

export function WebsiteStatusBadge({ status, reason }: WebsiteStatusBadgeProps) {
  if (!status || status === "unknown" || status === "verified") {
    if (status === "verified") {
      return <span title={reason || "Website verified"}><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /></span>
    }
    return null
  }

  if (status === "dead") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600" title={reason || "Website unreachable"}>
        <XCircle className="h-3.5 w-3.5" />
        Dead
      </span>
    )
  }

  if (status === "parked") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600" title={reason || "Domain appears parked or for sale"}>
        <AlertTriangle className="h-3.5 w-3.5" />
        Parked
      </span>
    )
  }

  if (status === "mismatch") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-orange-600" title={reason || "Website title doesn't match company name"}>
        <ShieldAlert className="h-3.5 w-3.5" />
        Mismatch
      </span>
    )
  }

  return null
}
