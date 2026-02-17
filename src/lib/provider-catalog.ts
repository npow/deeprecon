export interface ProviderCatalogEntry {
  id: string
  model: string
  label: string
  maxTokens: number
  family: string
  track: "runtime" | "scan" | "experimental"
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: "claude-opus-4-6", model: "claude-opus-4-6", label: "Claude Opus 4.6", maxTokens: 16384, family: "claude", track: "runtime" },
  { id: "claude-sonnet-4-5", model: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", maxTokens: 16384, family: "claude", track: "runtime" },
  { id: "gpt-5", model: "gpt-5", label: "GPT-5", maxTokens: 32768, family: "openai", track: "runtime" },
  { id: "gpt-5.2", model: "gpt-5.2", label: "GPT-5.2", maxTokens: 32768, family: "openai", track: "runtime" },
  { id: "deepseek-v3.2", model: "deepseek-v3.2", label: "DeepSeek V3.2", maxTokens: 16384, family: "deepseek", track: "runtime" },
  { id: "qwen3-max", model: "qwen3-max", label: "Qwen 3 Max", maxTokens: 16384, family: "qwen", track: "runtime" },
  { id: "kimi-k2.5", model: "kimi-k2.5", label: "Kimi K2.5", maxTokens: 16384, family: "kimi", track: "runtime" },
  { id: "glm-4.7", model: "glm-4.7", label: "GLM 4.7", maxTokens: 16384, family: "glm", track: "runtime" },
  { id: "gemini-3-pro", model: "gemini-3-pro-preview", label: "Gemini 3 Pro", maxTokens: 65536, family: "gemini", track: "runtime" },
  { id: "gemini-2.5-pro", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro", maxTokens: 65536, family: "gemini", track: "runtime" },
  { id: "gemini-2.5-flash", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", maxTokens: 65536, family: "gemini", track: "runtime" },
  { id: "cursor-claude-4.5-sonnet", model: "cursor/claude-4.5-sonnet", label: "Cursor Claude 4.5 Sonnet", maxTokens: 16384, family: "claude", track: "runtime" },
  { id: "cursor-gpt-5", model: "cursor/gpt-5", label: "Cursor GPT-5", maxTokens: 32768, family: "openai", track: "runtime" },
  { id: "cursor-gpt-5.2", model: "cursor/gpt-5.2", label: "Cursor GPT-5.2", maxTokens: 32768, family: "openai", track: "runtime" },
  { id: "cursor-gemini-2.5-pro", model: "cursor/gemini-2.5-pro", label: "Cursor Gemini 2.5 Pro", maxTokens: 65536, family: "gemini", track: "runtime" },
  { id: "cursor-gemini-3-pro", model: "cursor/gemini-3-pro-preview", label: "Cursor Gemini 3 Pro", maxTokens: 65536, family: "gemini", track: "runtime" },
  { id: "cursor-grok-3", model: "cursor/grok-3", label: "Cursor Grok 3", maxTokens: 16384, family: "xai", track: "runtime" },
  { id: "cursor-deepseek-v3", model: "cursor/deepseek-v3", label: "Cursor DeepSeek V3", maxTokens: 16384, family: "deepseek", track: "runtime" },
  { id: "cursor-o3", model: "cursor/o3", label: "Cursor o3", maxTokens: 32768, family: "openai", track: "runtime" },
  { id: "ag-opus-4-6-thinking", model: "claude-opus-4-6-thinking", label: "AG Opus 4.6 Thinking", maxTokens: 16384, family: "claude", track: "runtime" },
  { id: "ag-opus-4-5-thinking", model: "claude-opus-4-5-thinking", label: "AG Opus 4.5 Thinking", maxTokens: 16384, family: "claude", track: "runtime" },
  { id: "ag-sonnet-4-5", model: "claude-sonnet-4-5", label: "AG Sonnet 4.5", maxTokens: 16384, family: "claude", track: "runtime" },
  { id: "ag-gemini-3-pro-high", model: "gemini-3-pro-high", label: "AG Gemini 3 Pro High", maxTokens: 65536, family: "gemini", track: "runtime" },
  { id: "ag-gemini-3-flash", model: "gemini-3-flash", label: "AG Gemini 3 Flash", maxTokens: 65536, family: "gemini", track: "runtime" },
  { id: "ag-gpt-oss-120b", model: "gpt-oss-120b-medium", label: "AG GPT-OSS 120B", maxTokens: 16384, family: "openai", track: "runtime" },

  { id: "gemini-3-flash", model: "gemini-3-flash", label: "Gem3Flash", maxTokens: 16384, family: "gemini", track: "scan" },
  { id: "gemini-3-pro-high", model: "gemini-3-pro-high", label: "Gem3ProH", maxTokens: 16384, family: "gemini", track: "scan" },
  { id: "qwen3-235b-a22b-instruct", model: "qwen3-235b-a22b-instruct", label: "Qwen3-235b", maxTokens: 16384, family: "qwen", track: "scan" },
  { id: "deepseek-v3.2-reasoner", model: "deepseek-v3.2-reasoner", label: "DSv3.2", maxTokens: 16384, family: "deepseek", track: "scan" },
  { id: "kimi-k2", model: "kimi-k2", label: "KimiK2", maxTokens: 16384, family: "kimi", track: "scan" },
]

export function runtimeProviders(): ProviderCatalogEntry[] {
  return PROVIDER_CATALOG.filter((p) => p.track === "runtime")
}

export function scanProviders(): ProviderCatalogEntry[] {
  const scanPoolModels = new Set([
    "claude-opus-4-6",
    "qwen3-max",
    "gemini-3-flash",
    "gemini-3-pro-high",
    "qwen3-235b-a22b-instruct",
    "deepseek-v3.2-reasoner",
    "kimi-k2",
  ])
  return PROVIDER_CATALOG.filter((p) => p.track === "scan" || scanPoolModels.has(p.model))
}
