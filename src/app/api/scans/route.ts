import { NextResponse } from "next/server"
import { listScans } from "@/lib/scans-store"

export async function GET() {
  const scans = await listScans()
  return NextResponse.json(scans)
}
