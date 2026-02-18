export type DeepResearchProvider = "gemini" | "chatgpt" | "claude"

export interface DeepResearchResult {
  markdown: string
  provider: DeepResearchProvider
  durationMs: number
}
