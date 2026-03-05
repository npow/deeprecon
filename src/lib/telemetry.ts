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
type TelemetryLevel = "debug" | "info" | "warn" | "error"

type TelemetryEventBase = {
  ts: string
  type: string
  level: TelemetryLevel
  message?: string
  requestId?: string
  scanId?: string
  feature?: string
  route?: string
  method?: string
  statusCode?: number
  durationMs?: number
  ok?: boolean
  provider?: string
  host?: string
  url?: string
  error?: string
}
type TelemetryEvent = TelemetryEventBase & Record<string, unknown>
type TelemetryEventInput = Omit<TelemetryEventBase, "ts"> & Record<string, unknown>

type TelemetrySink = {
  emit: (event: TelemetryEvent) => void
}

interface ScanContext {
  scanId?: string
  requestId?: string
  feature?: string
  route?: string
  method?: string
}

const contextStorage = new AsyncLocalStorage<ScanContext>()
const tracer = trace.getTracer("recon.scan")
const timingsPath = path.join(process.cwd(), "data", "telemetry", "scan-timings.ndjson")
const eventsPath = process.env.TELEMETRY_NDJSON_PATH || path.join(process.cwd(), "data", "telemetry", "events.ndjson")
const telemetryEnabled = process.env.SCAN_TELEMETRY_ENABLED !== "0"
let initialized = false
let fetchPatched = false
let sinks: TelemetrySink[] | null = null
const TELEMETRY_INTERNAL_HEADER = "x-recon-telemetry-internal"

function redactUrl(input?: string): string | undefined {
  if (!input) return undefined
  try {
    const url = new URL(input)
    if (url.search) url.search = "?redacted=1"
    return url.toString()
  } catch {
    return input.slice(0, 300)
  }
}

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

function appendEventLine(payload: Record<string, unknown>) {
  if (!telemetryEnabled) return
  try {
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true })
    fs.appendFileSync(eventsPath, JSON.stringify(payload) + "\n", "utf8")
  } catch {
    // non-fatal
  }
}

function parseSinkList(): string[] {
  const raw = process.env.TELEMETRY_SINKS || "ndjson"
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function buildSinks(): TelemetrySink[] {
  const configured = parseSinkList()
  const selected: TelemetrySink[] = []

  if (configured.includes("console")) {
    selected.push({
      emit(event) {
        const line = JSON.stringify(event)
        if (event.level === "error" || event.level === "warn") console.error(line)
        else console.log(line)
      },
    })
  }
  if (configured.includes("ndjson")) {
    selected.push({ emit: appendEventLine })
  }
  if (configured.includes("betterstack")) {
    selected.push(buildBetterstackSink())
  }
  return selected
}

function buildBetterstackSink(): TelemetrySink {
  const endpoint = process.env.BETTERSTACK_LOG_ENDPOINT || "https://in.logs.betterstack.com"
  const sourceToken = process.env.BETTERSTACK_SOURCE_TOKEN
  const timeoutMs = Number(process.env.BETTERSTACK_LOG_TIMEOUT_MS || "2000")
  const fallback: TelemetrySink = {
    emit(event) {
      appendEventLine({ sink: "betterstack", dropped: true, reason: "missing_token", ...event })
    },
  }
  if (!sourceToken) return fallback

  return {
    emit(event) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const headers = new Headers({
        Authorization: `Bearer ${sourceToken}`,
        "Content-Type": "application/json",
      })
      headers.set(TELEMETRY_INTERNAL_HEADER, "1")
      void fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(event),
        signal: controller.signal,
      }).catch(() => {
        // best effort sink
      }).finally(() => {
        clearTimeout(timer)
      })
    },
  }
}

function parseOtlpHeaders(input?: string): Record<string, string> {
  if (!input) return {}
  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const eq = part.indexOf("=")
      if (eq <= 0) return acc
      const key = part.slice(0, eq).trim()
      const value = part.slice(eq + 1).trim()
      if (key && value) acc[key] = value
      return acc
    }, {})
}

function getSinks(): TelemetrySink[] {
  if (!sinks) sinks = buildSinks()
  return sinks
}

function maybeProviderFromHost(host?: string): string | undefined {
  if (!host) return undefined
  const normalized = host.toLowerCase()
  if (normalized.includes("localhost:8317")) return "cliproxy"
  if (normalized.includes("api.anthropic.com")) return "anthropic"
  if (normalized.includes("api.openai.com")) return "openai"
  if (normalized.includes("generativelanguage.googleapis.com")) return "gemini"
  if (normalized.includes("api.x.ai")) return "xai"
  return undefined
}

function bodyBytes(body: BodyInit | null | undefined): number | undefined {
  if (!body) return undefined
  if (typeof body === "string") return Buffer.byteLength(body)
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString())
  return undefined
}

function withContext(event: TelemetryEventInput): TelemetryEvent {
  const ctx = contextStorage.getStore()
  const requestId = typeof event.requestId === "string" ? event.requestId : ctx?.requestId
  const scanId = typeof event.scanId === "string" ? event.scanId : ctx?.scanId
  const feature = typeof event.feature === "string" ? event.feature : ctx?.feature
  const route = typeof event.route === "string" ? event.route : ctx?.route
  const method = typeof event.method === "string" ? event.method : ctx?.method
  return {
    ts: new Date().toISOString(),
    ...event,
    requestId,
    scanId,
    feature,
    route,
    method,
  }
}

export function emitTelemetry(event: TelemetryEventInput): void {
  if (!telemetryEnabled) return
  const payload = withContext(event)
  for (const sink of getSinks()) {
    try {
      sink.emit(payload)
    } catch {
      // non-fatal
    }
  }
}

export function initTelemetry(): void {
  if (initialized) return
  initialized = true

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS)
  const consoleExporter = process.env.OTEL_CONSOLE_EXPORTER === "1"
  if (!endpoint && !consoleExporter) return

  const spanProcessors: BatchSpanProcessor[] = []
  if (endpoint) {
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint, headers })))
  }
  if (consoleExporter) {
    spanProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter()))
  }
  const provider = new NodeTracerProvider({ spanProcessors })
  provider.register()
}

export function runWithTelemetryContext<T>(context: Partial<ScanContext>, fn: () => Promise<T>): Promise<T> {
  const current = contextStorage.getStore() || {}
  return contextStorage.run({ ...current, ...context }, fn)
}

export function runWithScanContext<T>(scanId: string, fn: () => Promise<T>): Promise<T> {
  return runWithTelemetryContext({ scanId }, fn)
}

export function currentScanId(): string | undefined {
  return contextStorage.getStore()?.scanId
}

export function installFetchTelemetry(): void {
  if (fetchPatched) return
  fetchPatched = true
  const originalFetch = globalThis.fetch
  if (!originalFetch) return

  globalThis.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const initialHeaders = new Headers(init?.headers)
    if (initialHeaders.get(TELEMETRY_INTERNAL_HEADER) === "1") {
      return originalFetch(input, init)
    }
    const started = Date.now()
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase()
    const inputUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    const safeUrl = redactUrl(inputUrl)
    const host = (() => {
      try {
        return new URL(inputUrl).host
      } catch {
        return undefined
      }
    })()
    const provider = maybeProviderFromHost(host)
    const reqBytes = bodyBytes(init?.body)
    emitTelemetry({
      type: "outbound.request",
      level: "debug",
      method,
      url: safeUrl,
      host,
      provider,
      req_bytes: reqBytes,
    })

    try {
      const response = await originalFetch(input, init)
      const durationMs = Date.now() - started
      const contentLength = response.headers.get("content-length")
      emitTelemetry({
        type: "outbound.response",
        level: response.ok ? "info" : "warn",
        method,
        url: safeUrl,
        host,
        provider,
        statusCode: response.status,
        durationMs,
        ok: response.ok,
        resp_bytes: contentLength ? Number(contentLength) : undefined,
      })
      return response
    } catch (error) {
      const durationMs = Date.now() - started
      const msg = error instanceof Error ? error.message : String(error)
      emitTelemetry({
        type: "outbound.error",
        level: "error",
        method,
        url: safeUrl,
        host,
        provider,
        durationMs,
        ok: false,
        error: msg,
      })
      throw error
    }
  }
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
    emitTelemetry({
      type: "timing",
      level: ok ? "info" : "error",
      kind,
      name,
      durationMs,
      ok,
      error: errorMessage || undefined,
      ...attrs,
    })
  }
}
