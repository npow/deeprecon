import * as Sentry from "@sentry/nextjs"

const sentryDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
const sentryTraceRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || "0")

export async function register() {
  Sentry.init({
    dsn: sentryDsn,
    enabled: Boolean(sentryDsn),
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: Number.isFinite(sentryTraceRate) ? sentryTraceRate : 0,
    sendDefaultPii: false,
  })

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation-node")
    await registerNodeInstrumentation()
  }
}

export const onRequestError = Sentry.captureRequestError
