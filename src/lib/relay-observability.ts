import { randomUUID } from "crypto"
import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { emitTelemetry, runWithTelemetryContext } from "@/lib/telemetry"

type RouteHandler<TContext = unknown> = (
  request: NextRequest,
  context: TContext
) => Promise<Response>

function inferFeature(pathname: string, method: string): string {
  if (pathname === "/api/scan" && method === "POST") return "scan.realtime"
  if (pathname.startsWith("/api/scan/jobs/health")) return "scan.jobs.health"
  if (pathname.startsWith("/api/scan/jobs/")) return "scan.jobs.status"
  if (pathname === "/api/scans" && method === "GET") return "scans.list"
  if (pathname.startsWith("/api/scans/") && method === "GET") return "scans.view"
  if (pathname === "/api/maps" && method === "GET") return "maps.list"
  if (pathname.startsWith("/api/maps/turbo")) return "maps.turbo.populate"
  if (pathname.endsWith("/enrich")) return "maps.enrich"
  if (pathname.startsWith("/api/maps/") && method === "POST") return "maps.refresh"
  if (pathname.startsWith("/api/maps/") && method === "GET") return "maps.view"
  if (pathname.startsWith("/api/pitch-deck")) return "pitchdeck.generate"
  if (pathname.startsWith("/api/logo")) return "logo.resolve"
  return "relay.unknown"
}

export function withRelayTelemetry<TContext = unknown>(
  handler: RouteHandler<TContext>,
  options?: { feature?: string }
): RouteHandler<TContext> {
  return async function wrappedRouteHandler(request: NextRequest, context: TContext): Promise<Response> {
    const started = Date.now()
    const method = request.method.toUpperCase()
    const route = request.nextUrl.pathname
    const requestId = request.headers.get("x-request-id") || randomUUID()
    const feature = options?.feature || inferFeature(route, method)

    return runWithTelemetryContext(
      { requestId, feature, route, method },
      async () => {
        emitTelemetry({
          type: "relay.request",
          level: "info",
          method,
          route,
          feature,
        })
        try {
          const response = await handler(request, context)
          const durationMs = Date.now() - started
          response.headers.set("x-request-id", requestId)
          emitTelemetry({
            type: "relay.response",
            level: response.ok ? "info" : "warn",
            method,
            route,
            feature,
            statusCode: response.status,
            durationMs,
            ok: response.ok,
          })
          return response
        } catch (error) {
          const durationMs = Date.now() - started
          const msg = error instanceof Error ? error.message : String(error)
          Sentry.withScope((scope) => {
            scope.setTag("feature", feature)
            scope.setTag("route", route)
            scope.setTag("method", method)
            scope.setContext("relay", {
              requestId,
              durationMs,
              feature,
              route,
              method,
            })
            Sentry.captureException(error)
          })
          emitTelemetry({
            type: "relay.error",
            level: "error",
            method,
            route,
            feature,
            durationMs,
            ok: false,
            error: msg,
          })
          throw error
        }
      }
    )
  }
}
