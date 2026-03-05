import { NextRequest, NextResponse } from "next/server"
import { loadScan } from "@/lib/scans-store"
import { buildPitchDeckPrompt } from "@/lib/pitch-deck-prompt"
import { generateSlidesUrl } from "@/lib/gemini-puppeteer"
import { GeminiSessionError, GeminiAPIError } from "@/lib/gemini-exporter"
import { withRelayTelemetry } from "@/lib/relay-observability"

export const maxDuration = 180

async function postPitchDeck(request: NextRequest) {
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
    const slidesUrl = await generateSlidesUrl(prompt, title)

    return NextResponse.json({ slidesUrl })
  } catch (err) {
    console.error("[pitch-deck] Error generating pitch deck:", err)

    if (err instanceof GeminiSessionError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    if (err instanceof GeminiAPIError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status === 429 ? 429 : 503 }
      )
    }

    return NextResponse.json(
      { error: "Failed to generate pitch deck" },
      { status: 500 }
    )
  }
}

export const POST = withRelayTelemetry(postPitchDeck)
