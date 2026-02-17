import { NextRequest, NextResponse } from "next/server"
import {
  extractIntent,
  analyzeCompetition,
  analyzeGaps,
  generateDDReport,
  generatePivots,
} from "@/lib/ai/pipeline"
import { generateId } from "@/lib/utils"
import { ScanSettings, DEFAULT_SETTINGS, type ScanRemixType } from "@/lib/types"
import { feedScanIntoMap } from "@/lib/scan-to-map"
import { getRateLimiter, getScanQueue } from "@/lib/rate-limit"
import { loadScan, saveScan } from "@/lib/scans-store"
import { computeReadinessScore } from "@/lib/readiness-score"
import { computeLucrativenessScore } from "@/lib/lucrativeness-score"
import { runWithScanContext, timed } from "@/lib/telemetry"
import { saveScanJob, updateScanJob } from "@/lib/scan-jobs-store"

type ScanEmitter = (event: { type: string; data: unknown }) => boolean

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: { type: string; data: unknown }
) {
  try {
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    )
    return true
  } catch {
    return false
  }
}

function parseRemixType(value: unknown): ScanRemixType | undefined {
  if (value !== "uniqueness_suggestion" && value !== "uniqueness_experiment" && value !== "manual_rescan") {
    return undefined
  }
  return value
}

function shouldBypassRateLimit(request: NextRequest): boolean {
  return process.env.NODE_ENV !== "production"
    || process.env.DISABLE_SCAN_RATE_LIMIT === "1"
    || request.headers.get("x-debug-mode") === "1"
}

type ScanRunInput = {
  scanId: string
  idea: string
  settings: ScanSettings
  remixParentScanId?: string
  remixType?: ScanRemixType
  remixLabel?: string
  emit?: ScanEmitter
  onStage?: (stage: string) => void
}

async function executeScanRun(input: ScanRunInput): Promise<string> {
  const { scanId, idea, settings, remixParentScanId, remixType, remixLabel, emit, onStage } = input
  const send = emit || (() => true)

  await runWithScanContext(scanId, async () => timed(
    "scan.total",
    "scan",
    { route: "/api/scan", workflow_mode: settings.workflowMode, depth_level: settings.depthLevel },
    async () => {
      onStage?.("intent")
      send({
        type: "status_update",
        data: { stage: "intent", message: "Analyzing your idea..." },
      })

      const intent = await timed("scan.stage.intent", "stage", { stage: "intent" }, async () =>
        extractIntent(idea)
      )
      send({ type: "intent_extracted", data: intent })

      onStage?.("competitors")
      send({
        type: "status_update",
        data: { stage: "competitors", message: "Scanning competitive map..." },
      })

      const { competitors, crowdednessIndex, totalFundingInSpace } = await timed(
        "scan.stage.competitors",
        "stage",
        { stage: "competitors" },
        async () => analyzeCompetition(idea, intent, settings)
      )

      send({ type: "competitors_found", data: competitors })
      send({
        type: "crowdedness_assessed",
        data: { index: crowdednessIndex, totalFunding: totalFundingInSpace, count: competitors.length },
      })

      onStage?.("gaps")
      send({
        type: "status_update",
        data: { stage: "gaps", message: "Identifying market gaps..." },
      })

      const gapAnalysis = await timed("scan.stage.gaps", "stage", { stage: "gaps" }, async () =>
        analyzeGaps(idea, intent, competitors, settings)
      )
      send({
        type: "gap_analysis_complete",
        data: gapAnalysis,
      })

      onStage?.("dd_report")
      send({
        type: "status_update",
        data: { stage: "dd_report", message: "Generating DD report & differentiation strategies..." },
      })

      const [ddReport, pivots] = await Promise.all([
        timed("scan.stage.dd_report", "stage", { stage: "dd_report" }, async () =>
          generateDDReport(idea, intent, competitors, gapAnalysis, settings)
        ),
        timed("scan.stage.pivots", "stage", { stage: "pivots" }, async () =>
          generatePivots(idea, intent, competitors, gapAnalysis, crowdednessIndex, settings)
        ),
      ])

      send({ type: "dd_report_complete", data: ddReport })
      send({ type: "pivots_generated", data: pivots })

      try {
        onStage?.("map_sync")
        send({
          type: "status_update",
          data: { stage: "map_sync", message: "Syncing to market map..." },
        })
        await timed("scan.stage.map_sync", "stage", { stage: "map_sync" }, async () => {
          const mergeResult = await feedScanIntoMap(intent, competitors)
          if (mergeResult && (mergeResult.newCount > 0 || mergeResult.updatedCount > 0)) {
            send({
              type: "map_enriched",
              data: mergeResult,
            })
          }
        })
      } catch (mapErr) {
        console.error("Map sync error (non-fatal):", mapErr)
      }

      onStage?.("persist")
      await timed("scan.stage.persist", "stage", { stage: "persist" }, async () => {
        const readinessScore = computeReadinessScore(ddReport, crowdednessIndex, competitors, gapAnalysis, idea)
        const lucrativenessScore = computeLucrativenessScore(ddReport, competitors, gapAnalysis)
        const parentScan = remixParentScanId ? await loadScan(remixParentScanId) : null
        const rootScanId = parentScan?.rootScanId ?? parentScan?.id
        const remixDepth = parentScan ? (parentScan.remixDepth ?? 0) + 1 : (remixParentScanId ? 1 : undefined)

        await saveScan({
          id: scanId,
          ideaText: idea,
          intent,
          crowdednessIndex,
          competitors,
          totalFundingInSpace,
          gapAnalysis,
          ddReport,
          pivotSuggestions: pivots,
          readinessScore,
          lucrativenessScore,
          parentScanId: remixParentScanId,
          rootScanId,
          remixType,
          remixLabel,
          remixDepth,
          createdAt: new Date().toISOString(),
        })
      })
    }
  ))

  return scanId
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { ideaText, settings: userSettings, remix, runInBackground } = body
  const settings: ScanSettings = { ...DEFAULT_SETTINGS, ...userSettings }
  const remixParentScanId =
    remix && typeof remix.parentScanId === "string" && remix.parentScanId.trim().length > 0
      ? remix.parentScanId.trim()
      : undefined
  const remixType = parseRemixType(remix?.remixType)
  const remixLabel =
    remix && typeof remix.remixLabel === "string" && remix.remixLabel.trim().length > 0
      ? remix.remixLabel.trim()
      : undefined

  if (!ideaText || typeof ideaText !== "string" || ideaText.trim().length < 10) {
    return new Response(JSON.stringify({ error: "Please describe your idea in at least 10 characters" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!shouldBypassRateLimit(request)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "127.0.0.1"
    const rateLimiter = getRateLimiter()
    const { allowed, retryAfterMs } = await rateLimiter.check(ip)
    if (!allowed) {
      const retryAfterSec = Math.ceil(retryAfterMs / 1000)
      return new Response(
        JSON.stringify({ error: `Rate limit exceeded. Please try again in ${Math.ceil(retryAfterSec / 60)} minutes.` }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSec),
          },
        },
      )
    }
  }

  if (!process.env.GEMINI_API_KEY && !process.env.CLIPROXY_URL) {
    console.warn("Neither GEMINI_API_KEY nor CLIPROXY_URL configured — using CLIProxy defaults")
  }

  const scanQueue = getScanQueue()

  if (runInBackground === true) {
    const jobId = generateId()
    const scanId = generateId()
    const now = new Date().toISOString()
    const idea = ideaText.trim()
    await saveScanJob({
      id: jobId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      ideaText: idea,
      settings,
      remix,
      queuePosition: await scanQueue.queueLength(),
    })

    void (async () => {
      await scanQueue.acquire()
      try {
        await updateScanJob(jobId, { status: "running", queuePosition: 0, startedAt: new Date().toISOString(), currentStage: "queued" })
        await executeScanRun({
          scanId,
          idea,
          settings,
          remixParentScanId,
          remixType,
          remixLabel,
          onStage: (stage) => {
            void updateScanJob(jobId, { currentStage: stage })
          },
        })
        await updateScanJob(jobId, { status: "completed", scanId, finishedAt: new Date().toISOString(), currentStage: "done" })
      } catch (error) {
        console.error("Background scan pipeline error:", error)
        await updateScanJob(jobId, {
          status: "failed",
          error: error instanceof Error ? error.message : "Unexpected error",
          finishedAt: new Date().toISOString(),
        })
      } finally {
        await scanQueue.release()
      }
    })()

    return NextResponse.json({ jobId, status: "pending" }, { status: 202 })
  }

  const encoder = new TextEncoder()
  const scanId = generateId()

  const stream = new ReadableStream({
    async start(controller) {
      const queuePos = await scanQueue.queueLength()
      if (queuePos > 0) {
        sendEvent(controller, encoder, {
          type: "queue_position",
          data: { position: queuePos },
        })
      }
      await scanQueue.acquire()

      try {
        await executeScanRun({
          scanId,
          idea: ideaText.trim(),
          settings,
          remixParentScanId,
          remixType,
          remixLabel,
          emit: (event) => sendEvent(controller, encoder, event),
        })

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
        await scanQueue.release()
        try {
          controller.close()
        } catch {
          // stream may already be closed if client disconnected
        }
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
