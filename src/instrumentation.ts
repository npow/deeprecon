export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCookieKeepalive } = await import("@/lib/gemini-exporter")
    startCookieKeepalive()
  }
}
