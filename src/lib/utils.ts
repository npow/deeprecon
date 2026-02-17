import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Competitor } from "./types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Safely flatten any value to a display string — handles objects/arrays Claude sometimes returns */
export function stringify(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(stringify).join(", ")
  if (typeof value === "object") {
    return Object.values(value).map(stringify).join(" · ")
  }
  return String(value)
}

export function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`
  return `$${amount}`
}

function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const cleaned = value.trim().replace(/[$,\s]/g, "")
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmbt])?$/i)
  if (!match) return null
  const n = Number.parseFloat(match[1])
  if (!Number.isFinite(n)) return null
  const suffix = (match[2] || "").toUpperCase()
  if (suffix === "K") return n * 1_000
  if (suffix === "M") return n * 1_000_000
  if (suffix === "B") return n * 1_000_000_000
  if (suffix === "T") return n * 1_000_000_000_000
  return n
}

export function formatMarketSize(value: unknown): string {
  const parsed = parseNumberish(value)
  if (parsed == null) return stringify(value)
  const abs = Math.abs(parsed)
  if (abs >= 1_000_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(parsed)
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(parsed)
}

export function generateId(): string {
  return `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function crowdednessColor(index: string): string {
  switch (index) {
    case "low": return "text-green-600"
    case "moderate": return "text-yellow-600"
    case "high": return "text-orange-600"
    case "red_ocean": return "text-red-600"
    default: return "text-gray-600"
  }
}

export function crowdednessLabel(index: string): string {
  switch (index) {
    case "low": return "Low Competition"
    case "moderate": return "Moderate Competition"
    case "high": return "High Competition"
    case "red_ocean": return "Red Ocean"
    default: return index
  }
}

export function crowdednessBgColor(index: string): string {
  switch (index) {
    case "low": return "bg-green-100 border-green-300"
    case "moderate": return "bg-yellow-100 border-yellow-300"
    case "high": return "bg-orange-100 border-orange-300"
    case "red_ocean": return "bg-red-100 border-red-300"
    default: return "bg-gray-100 border-gray-300"
  }
}

/** Coerce any LLM value to a plain string — safe for .replace(), .toLowerCase(), etc. */
export function safeStr(value: unknown): string {
  return stringify(value)
}

/** Ensure a value is an array — guards against undefined/null from LLM responses */
export function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function valueRichness(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "string") return value.trim().length > 0 ? Math.min(value.trim().length, 120) : 0
  if (typeof value === "number" || typeof value === "boolean") return 4
  if (Array.isArray(value)) return value.reduce((sum, v) => sum + valueRichness(v), 0)
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((sum, [k, v]) => {
      if (!k) return sum
      return sum + valueRichness(v)
    }, 0)
  }
  return 0
}

function mergePreferRicher(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, incoming] of Object.entries(source)) {
    if (!key) continue
    const existing = out[key]
    if (isPlainObject(existing) && isPlainObject(incoming)) {
      out[key] = mergePreferRicher(existing, incoming)
      continue
    }
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      out[key] = valueRichness(incoming) >= valueRichness(existing) ? incoming : existing
      continue
    }
    if (valueRichness(incoming) >= valueRichness(existing)) {
      out[key] = incoming
    }
  }
  return out
}

/**
 * Detect and flatten the numeric-key nesting pattern that jsonrepair sometimes
 * produces, e.g. { "0": { idealCustomerProfile: ... }, "1": "portersFiveForces", "2": ":", "3": { ... } }
 * Merges all object-valued numeric keys into a single flat object.
 * Numeric-key objects and non-numeric keys are merged with a "prefer richer value" strategy
 * so empty sanitizer stubs never overwrite populated sections.
 */
export function flattenNumericKeys(raw: any): any {
  if (!isPlainObject(raw)) return raw
  const numericKeys = Object.keys(raw).filter((k) => /^\d+$/.test(k))
  if (numericKeys.length === 0) return raw
  const flat: Record<string, unknown> = {}
  // First: copy non-numeric keys
  for (const key of Object.keys(raw)) {
    if (!/^\d+$/.test(key)) {
      flat[key] = raw[key]
    }
  }
  // Then: merge numeric-key objects (prefer richer sections over stubs)
  for (const key of numericKeys) {
    const val = raw[key]
    if (isPlainObject(val)) {
      const merged = mergePreferRicher(flat, val)
      Object.keys(flat).forEach((k) => delete flat[k])
      Object.assign(flat, merged)
    }
  }
  return flat
}

/** Parse funding strings like "$3.8B", "$150M", "$2.4K" into numbers */
export function parseFundingString(raw: unknown): number {
  if (!raw) return 0
  const str = typeof raw === "string" ? raw : String(raw)
  const cleaned = str.replace(/[^0-9.BMKbmk]/g, "")
  const match = cleaned.match(/^([\d.]+)\s*([BMKbmk])?/)
  if (!match) return 0
  const num = parseFloat(match[1])
  if (isNaN(num)) return 0
  const suffix = (match[2] || "").toUpperCase()
  if (suffix === "B") return num * 1_000_000_000
  if (suffix === "M") return num * 1_000_000
  if (suffix === "K") return num * 1_000
  return num
}

export type FundingConfidence = "high" | "medium" | "low" | "unknown"

export function fundingConfidence(competitor: Competitor): FundingConfidence {
  if ((competitor.totalFundingUsd ?? 0) <= 0) return "unknown"

  const source = (competitor.source || "").toLowerCase()
  const lastType = (competitor.lastFundingType || "").toLowerCase()
  const hasFundingMeta = Boolean(competitor.lastFundingDate) || (lastType !== "" && lastType !== "unknown")
  const confirmationStrength = competitor.confirmedByCount ?? competitor.confirmedBy?.length ?? 0
  const confidence = competitor.confidenceLevel || "ai_inferred"

  if (confidence === "multi_confirmed" || confidence === "web_verified" || confirmationStrength >= 2) {
    return "high"
  }

  if (hasFundingMeta || source === "crunchbase" || source === "web_search") {
    return "medium"
  }

  return "low"
}
