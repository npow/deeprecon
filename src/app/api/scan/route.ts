import { NextRequest } from "next/server"
import {
  extractIntent,
  analyzeCompetition,
  analyzeGaps,
  generateDDReport,
  generatePivots,
} from "@/lib/ai/pipeline"
import { generateId } from "@/lib/utils"
import { ScanSettings, DEFAULT_SETTINGS } from "@/lib/types"

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: { type: string; data: unknown }
) {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  )
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { ideaText, settings: userSettings } = body
  const settings: ScanSettings = { ...DEFAULT_SETTINGS, ...userSettings }

  if (!ideaText || typeof ideaText !== "string" || ideaText.trim().length < 10) {
    return new Response(JSON.stringify({ error: "Please describe your idea in at least 10 characters" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!process.env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const encoder = new TextEncoder()
  const scanId = generateId()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Stage 1: Intent extraction
        sendEvent(controller, encoder, {
          type: "status_update",
          data: { stage: "intent", message: "Analyzing your idea..." },
        })

        const intent = await extractIntent(ideaText.trim())
        sendEvent(controller, encoder, { type: "intent_extracted", data: intent })

        // Stage 2: Competitive analysis
        sendEvent(controller, encoder, {
          type: "status_update",
          data: { stage: "competitors", message: "Scanning competitive landscape..." },
        })

        const { competitors, crowdednessIndex, totalFundingInSpace } =
          await analyzeCompetition(ideaText.trim(), intent, settings)

        sendEvent(controller, encoder, {
          type: "competitors_found",
          data: competitors,
        })
        sendEvent(controller, encoder, {
          type: "crowdedness_assessed",
          data: { index: crowdednessIndex, totalFunding: totalFundingInSpace, count: competitors.length },
        })

        // Stage 3: Gap analysis
        sendEvent(controller, encoder, {
          type: "status_update",
          data: { stage: "gaps", message: "Identifying market gaps..." },
        })

        const gapAnalysis = await analyzeGaps(ideaText.trim(), intent, competitors)
        sendEvent(controller, encoder, {
          type: "gap_analysis_complete",
          data: gapAnalysis,
        })

        // Stages 4 & 5: DD Report + Pivot suggestions (run in parallel)
        sendEvent(controller, encoder, {
          type: "status_update",
          data: { stage: "dd_report", message: "Generating DD report & differentiation strategies..." },
        })

        const idea = ideaText.trim()
        const [ddReport, pivots] = await Promise.all([
          generateDDReport(idea, intent, competitors, gapAnalysis),
          generatePivots(idea, intent, competitors, gapAnalysis, crowdednessIndex),
        ])

        sendEvent(controller, encoder, { type: "dd_report_complete", data: ddReport })
        sendEvent(controller, encoder, { type: "pivots_generated", data: pivots })

        // Done
        sendEvent(controller, encoder, {
          type: "scan_complete",
          data: { id: scanId },
        })
      } catch (error) {
        console.error("Scan pipeline error:", error)
        sendEvent(controller, encoder, {
          type: "scan_error",
          data: {
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
