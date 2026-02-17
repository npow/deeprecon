import { NextRequest, NextResponse } from "next/server"
import { loadScan } from "@/lib/scans-store"
import { generatePitchDeck } from "@/lib/pptx-generator"

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
    const pptxBuffer = await generatePitchDeck(scan)

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
    console.error("[pitch-deck] Error generating pitch deck:", err)
    return NextResponse.json(
      { error: "Failed to generate pitch deck" },
      { status: 500 }
    )
  }
}
