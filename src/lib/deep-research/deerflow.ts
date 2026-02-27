import { DeepResearchError } from "./browser"
import type { DeepResearchResult } from "./types"

const PROVIDER = "deerflow" as const
const DEERFLOW_BASE_URL = process.env.DEERFLOW_URL || "http://localhost:9000"
const DEERFLOW_ENDPOINT = process.env.DEERFLOW_ENDPOINT || "/research"
const TIMEOUT_MS = parseInt(process.env.DEEP_RESEARCH_DEERFLOW_TIMEOUT_MS || "600000", 10)

function extractMarkdown(payload: unknown): string {
  if (typeof payload === "string") return payload.trim()
  if (!payload || typeof payload !== "object") return ""

  const obj = payload as Record<string, unknown>
  const direct =
    obj.markdown ??
    obj.report ??
    obj.content ??
    obj.result

  if (typeof direct === "string") return direct.trim()
  if (direct && typeof direct === "object") {
    const nested = direct as Record<string, unknown>
    const nestedText = nested.markdown ?? nested.content ?? nested.text
    if (typeof nestedText === "string") return nestedText.trim()
  }
  return ""
}

export async function runDeepResearch(prompt: string): Promise<DeepResearchResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (process.env.DEERFLOW_API_KEY) {
      headers.Authorization = `Bearer ${process.env.DEERFLOW_API_KEY}`
    }

    const res = await fetch(`${DEERFLOW_BASE_URL}${DEERFLOW_ENDPOINT}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new DeepResearchError(
        `DeerFlow request failed (${res.status}): ${body.slice(0, 200)}`,
        PROVIDER
      )
    }

    const contentType = res.headers.get("content-type") || ""
    const payload = contentType.includes("application/json")
      ? await res.json()
      : await res.text()

    const markdown = extractMarkdown(payload)
    if (markdown.length < 50) {
      throw new DeepResearchError(
        "DeerFlow response did not include a substantial markdown/report payload.",
        PROVIDER
      )
    }

    return {
      markdown,
      provider: PROVIDER,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    if (err instanceof DeepResearchError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new DeepResearchError(`DeerFlow deep research failed: ${message}`, PROVIDER)
  } finally {
    clearTimeout(timeout)
  }
}
