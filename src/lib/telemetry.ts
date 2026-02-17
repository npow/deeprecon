import fs from "fs"
import path from "path"
import { AsyncLocalStorage } from "async_hooks"
import { trace, SpanStatusCode, type Attributes } from "@opentelemetry/api"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { BatchSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"

type Primitive = string | number | boolean
type Attrs = Record<string, Primitive | undefined>
type TimingKind = "scan" | "stage" | "provider"

interface ScanContext {
  scanId: string
}

const scanContextStorage = new AsyncLocalStorage<ScanContext>()
const tracer = trace.getTracer("recon.scan")
const timingsPath = path.join(process.cwd(), "data", "telemetry", "scan-timings.ndjson")
const telemetryEnabled = process.env.SCAN_TELEMETRY_ENABLED !== "0"
let initialized = false

function sanitizeAttributes(attrs?: Attrs): Attributes {
  const out: Attributes = {}
  if (!attrs) return out
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v
  }
  return out
}

function appendTimingLine(payload: Record<string, unknown>) {
  if (!telemetryEnabled) return
  try {
    fs.mkdirSync(path.dirname(timingsPath), { recursive: true })
    fs.appendFileSync(timingsPath, JSON.stringify(payload) + "\n", "utf8")
  } catch {
    // non-fatal
  }
}

export function initTelemetry(): void {
  if (initialized) return
  initialized = true

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const consoleExporter = process.env.OTEL_CONSOLE_EXPORTER === "1"
  if (!endpoint && !consoleExporter) return

  const spanProcessors: BatchSpanProcessor[] = []
  if (endpoint) {
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })))
  }
  if (consoleExporter) {
    spanProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter()))
  }
  const provider = new NodeTracerProvider({ spanProcessors })
  provider.register()
}

export function runWithScanContext<T>(scanId: string, fn: () => Promise<T>): Promise<T> {
  return scanContextStorage.run({ scanId }, fn)
}

export function currentScanId(): string | undefined {
  return scanContextStorage.getStore()?.scanId
}

export async function timed<T>(
  name: string,
  kind: TimingKind,
  attrs: Attrs,
  fn: () => Promise<T>
): Promise<T> {
  initTelemetry()
  const scanId = currentScanId()
  const mergedAttrs = sanitizeAttributes({ ...attrs, scan_id: scanId })
  const span = tracer.startSpan(name, { attributes: mergedAttrs })
  const startedAt = Date.now()
  let ok = true
  let errorMessage = ""

  try {
    const value = await fn()
    span.setStatus({ code: SpanStatusCode.OK })
    return value
  } catch (err: any) {
    ok = false
    errorMessage = err instanceof Error ? err.message : String(err)
    span.recordException(err)
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage })
    throw err
  } finally {
    span.end()
    const durationMs = Date.now() - startedAt
    appendTimingLine({
      ts: new Date().toISOString(),
      scanId,
      kind,
      name,
      durationMs,
      ok,
      error: errorMessage || undefined,
      ...attrs,
    })
  }
}
