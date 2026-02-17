import { NextResponse } from "next/server"
import { listScans } from "@/lib/scans-store"

export async function GET() {
  try {
    const scans = await listScans()
    return NextResponse.json(scans)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[GET /api/scans] error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
