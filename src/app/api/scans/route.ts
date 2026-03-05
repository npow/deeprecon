import { NextResponse } from "next/server"
import { listScans } from "@/lib/scans-store"
import { withRelayTelemetry } from "@/lib/relay-observability"

async function getScans() {
  try {
    const scans = await listScans()
    return NextResponse.json(scans)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[GET /api/scans] error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const GET = withRelayTelemetry(async (_request, _context) => getScans())
