import { NextRequest, NextResponse } from "next/server"
import { loadScanJob } from "@/lib/scan-jobs-store"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = loadScanJob(id)
  if (!job) {
    return NextResponse.json({ error: "Scan job not found" }, { status: 404 })
  }
  return NextResponse.json(job)
}
