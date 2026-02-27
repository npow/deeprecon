export type DeepResearchProvider = "gemini" | "chatgpt" | "claude" | "deerflow"

export interface DeepResearchResult {
  markdown: string
  provider: DeepResearchProvider
  durationMs: number
}
