import { NextRequest, NextResponse } from "next/server"
import { loadScan } from "@/lib/scans-store"
import { buildPitchDeckPrompt } from "@/lib/pitch-deck-prompt"
import {
  generatePresentation,
  GeminiSessionError,
  GeminiAPIError,
} from "@/lib/gemini-exporter"

export async function POST(request: NextRequest) {
  let body: { scanId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { scanId } = body
  if (!scanId || typeof scanId !== "string") {
    return NextResponse.json({ error: "scanId is required" }, { status: 400 })
  }

  const scan = await loadScan(scanId)
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  if (!scan.ddReport) {
    return NextResponse.json(
      { error: "Scan does not have a DD report — cannot generate pitch deck" },
      { status: 400 }
    )
  }

  try {
    const { prompt, title } = buildPitchDeckPrompt(scan)
    const pptxBuffer = await generatePresentation(prompt, title)

    const filename = `pitch-deck-${scanId.slice(0, 20)}.pptx`

    return new NextResponse(new Uint8Array(pptxBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pptxBuffer.length),
      },
    })
  } catch (err) {
    if (err instanceof GeminiSessionError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    if (err instanceof GeminiAPIError) {
      const status = err.status === 429 ? 429 : 502
      return NextResponse.json({ error: err.message }, { status })
    }
    console.error("[pitch-deck] Unexpected error:", err)
    return NextResponse.json(
      { error: "Failed to generate pitch deck" },
      { status: 500 }
    )
  }
}
