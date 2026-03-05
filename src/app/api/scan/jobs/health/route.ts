import { NextRequest, NextResponse } from "next/server"
import { reapStaleRunningJobs, summarizeScanJobsHealth } from "@/lib/scan-jobs-store"
import { withRelayTelemetry } from "@/lib/relay-observability"

async function getScanJobsHealth(request: NextRequest) {
  const staleMinutesRaw = request.nextUrl.searchParams.get("staleMinutes")
  const staleMinutes = staleMinutesRaw ? Number(staleMinutesRaw) : 20
  const safeStaleMinutes = Number.isFinite(staleMinutes) && staleMinutes > 0 ? staleMinutes : 20
  return NextResponse.json(await summarizeScanJobsHealth(safeStaleMinutes))
}

async function postScanJobsHealth(request: NextRequest) {
  const debugEnabled =
    process.env.NODE_ENV !== "production"
    || process.env.NEXT_PUBLIC_DEBUG_MODE === "1"
    || request.headers.get("x-debug-mode") === "1"
  if (!debugEnabled) {
    return NextResponse.json({ error: "Not available" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { staleMinutes?: number }
  const staleMinutes = Number(body?.staleMinutes)
  const safeStaleMinutes = Number.isFinite(staleMinutes) && staleMinutes > 0 ? staleMinutes : 20
  const reaped = await reapStaleRunningJobs(safeStaleMinutes)
  const health = await summarizeScanJobsHealth(safeStaleMinutes)
  return NextResponse.json({ reaped, health })
}

export const GET = withRelayTelemetry(getScanJobsHealth)
export const POST = withRelayTelemetry(postScanJobsHealth)
