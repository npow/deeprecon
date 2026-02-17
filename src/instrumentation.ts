export async function register() {
  // Start Gemini cookie keepalive when cookies are configured
  if (process.env.GEMINI_COOKIES_BASE64 || process.env.NODE_ENV === "production") {
    try {
      const { startCookieKeepalive } = await import("./lib/gemini-exporter")
      startCookieKeepalive()
    } catch {
      // Gemini not configured — skip keepalive
    }
  }
}
