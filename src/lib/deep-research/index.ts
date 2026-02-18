import type { DeepResearchProvider, DeepResearchResult } from "./types"

export type { DeepResearchProvider, DeepResearchResult } from "./types"
export { DeepResearchError, DeepResearchAuthError } from "./browser"
export { runDeepResearch as runGeminiDeepResearch } from "./gemini"
export { runDeepResearch as runChatGPTDeepResearch } from "./chatgpt"
export { runDeepResearch as runClaudeDeepResearch } from "./claude"

const providers: Record<
  DeepResearchProvider,
  () => Promise<{ runDeepResearch: (prompt: string) => Promise<DeepResearchResult> }>
> = {
  gemini: () => import("./gemini"),
  chatgpt: () => import("./chatgpt"),
  claude: () => import("./claude"),
}

/**
 * Run deep research on a single provider.
 */
export async function runDeepResearch(
  prompt: string,
  provider: DeepResearchProvider
): Promise<DeepResearchResult> {
  const mod = await providers[provider]()
  return mod.runDeepResearch(prompt)
}

/**
 * Run deep research on all specified providers sequentially (mutex — one browser at a time).
 * Returns results from all providers that succeed. Failures are logged but don't abort others.
 */
export async function runAllDeepResearch(
  prompt: string,
  providerList?: DeepResearchProvider[]
): Promise<DeepResearchResult[]> {
  const toRun = providerList ?? (["gemini", "chatgpt", "claude"] as DeepResearchProvider[])
  const results: DeepResearchResult[] = []

  for (const provider of toRun) {
    try {
      console.log(`[deep-research] Starting ${provider}...`)
      const result = await runDeepResearch(prompt, provider)
      results.push(result)
      console.log(
        `[deep-research] ${provider} complete (${Math.round(result.durationMs / 1000)}s, ${result.markdown.length} chars)`
      )
    } catch (err) {
      console.error(
        `[deep-research] ${provider} failed:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  return results
}
