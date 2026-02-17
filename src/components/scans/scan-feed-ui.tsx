import type { SavedScanSummary } from "@/lib/types"

export function crowdednessBadgeColor(index: string) {
  switch (index) {
    case "low": return "bg-green-50 text-green-700 border-green-200"
    case "moderate": return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "high": return "bg-orange-50 text-orange-700 border-orange-200"
    case "red_ocean": return "bg-red-50 text-red-700 border-red-200"
    default: return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

export function gradeColor(grade: string) {
  switch (grade) {
    case "A": return "text-green-600 bg-green-50 border-green-200"
    case "B": return "text-blue-600 bg-blue-50 border-blue-200"
    case "C": return "text-yellow-600 bg-yellow-50 border-yellow-200"
    case "D": return "text-orange-600 bg-orange-50 border-orange-200"
    default: return "text-red-600 bg-red-50 border-red-200"
  }
}

export function remixTypeLabel(scan: SavedScanSummary): string | null {
  if (scan.remixType === "uniqueness_suggestion") return "Uniqueness Remix"
  if (scan.remixType === "uniqueness_experiment") return "Experiment"
  if (scan.remixType === "manual_rescan") return "Rescan"
  return null
}

export function lucrativenessBadgeColor(tier?: SavedScanSummary["lucrativenessTier"]) {
  switch (tier) {
    case "very_high": return "bg-emerald-50 text-emerald-700 border-emerald-200"
    case "high": return "bg-green-50 text-green-700 border-green-200"
    case "medium": return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "low": return "bg-gray-50 text-gray-700 border-gray-200"
    default: return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

export function validationBadgeColor(tier?: SavedScanSummary["validationTier"]) {
  switch (tier) {
    case "very_high": return "bg-emerald-50 text-emerald-700 border-emerald-200"
    case "high": return "bg-green-50 text-green-700 border-green-200"
    case "medium": return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "low": return "bg-gray-50 text-gray-700 border-gray-200"
    default: return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

export function opportunityBadgeColor(tier?: SavedScanSummary["opportunityTier"]) {
  switch (tier) {
    case "very_high": return "bg-cyan-50 text-cyan-700 border-cyan-200"
    case "high": return "bg-sky-50 text-sky-700 border-sky-200"
    case "medium": return "bg-blue-50 text-blue-700 border-blue-200"
    case "low": return "bg-gray-50 text-gray-700 border-gray-200"
    default: return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ScoreCircle({ score, grade, size = "md" }: { score: number; grade: string; size?: "sm" | "md" }) {
  const radius = size === "sm" ? 18 : 22
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const colors = gradeColor(grade)
  const boxSize = size === "sm" ? "w-11 h-11" : "w-14 h-14"

  return (
    <div className={`relative ${boxSize} flex-shrink-0`}>
      <svg className="w-full h-full -rotate-90" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100" />
        <circle
          cx="26" cy="26" r={radius} fill="none" strokeWidth="3"
          stroke="currentColor"
          className={colors.split(" ")[0]}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={size === "sm" ? "text-[11px] font-bold text-gray-900" : "text-xs font-bold text-gray-900"}>{score}</span>
        <span className={`text-[10px] font-bold ${colors.split(" ")[0]}`}>{grade}</span>
      </div>
    </div>
  )
}
