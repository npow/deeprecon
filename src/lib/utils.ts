import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

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

/** Parse funding strings like "$3.8B", "$150M", "$2.4K" into numbers */
export function parseFundingString(str: string | undefined | null): number {
  if (!str) return 0
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
