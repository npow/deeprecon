import { NextRequest, NextResponse } from "next/server"
import { loadScanJob } from "@/lib/scan-jobs-store"
import { withRelayTelemetry } from "@/lib/relay-observability"

async function getScanJob(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = await loadScanJob(id)
  if (!job) {
    return NextResponse.json({ error: "Scan job not found" }, { status: 404 })
  }
  return NextResponse.json(job)
}

export const GET = withRelayTelemetry(getScanJob)
