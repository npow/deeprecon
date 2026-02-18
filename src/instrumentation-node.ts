export async function registerNodeInstrumentation() {
  // Start Gemini cookie keepalive when cookies are configured
  if (process.env.GEMINI_COOKIES_BASE64 || process.env.NODE_ENV === "production") {
    try {
      // Keep this runtime-only so client/edge bundles never chase Node-only deps.
      const importer = (0, eval)("(p) => import(p)") as (path: string) => Promise<{
        startCookieKeepalive: () => void
      }>
      const { startCookieKeepalive } = await importer("./lib/gemini-exporter")
      startCookieKeepalive()
    } catch {
      // Gemini not configured — skip keepalive
    }
  }
}
