import type { Competitor, SubCategoryPlayer, VerticalMap } from "./types"

function normalizeWebsiteUrl(value?: string): string | undefined {
  if (!value || typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    return parsed.toString()
  } catch {
    return undefined
  }
}

function hostnameFromWebsiteUrl(websiteUrl?: string): string | undefined {
  const normalized = normalizeWebsiteUrl(websiteUrl)
  if (!normalized) return undefined

  try {
    const parsed = new URL(normalized)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
    if (!host || host === "localhost") return undefined
    return host
  } catch {
    return undefined
  }
}

function isGeneratedFaviconUrl(value?: string): boolean {
  if (!value || typeof value !== "string") return false
  const v = value.trim().toLowerCase()
  return v.includes("google.com/s2/favicons")
    || v.includes("gstatic.com/faviconv2")
    || v.includes("icons.duckduckgo.com/ip3/")
    || v.startsWith("/api/logo?")
}

function proxyLogoUrl(websiteUrl?: string): string | undefined {
  const normalized = normalizeWebsiteUrl(websiteUrl)
  if (!normalized) return undefined
  return `/api/logo?website=${encodeURIComponent(normalized)}`
}

export function deriveLogoUrl(
  websiteUrl?: string,
  existingLogoUrl?: string,
): string | undefined {
  const existing = existingLogoUrl?.trim()
  if (existing && !isGeneratedFaviconUrl(existing)) return existing
  const proxy = proxyLogoUrl(websiteUrl)
  if (proxy) return proxy
  const host = hostnameFromWebsiteUrl(websiteUrl)
  if (!host) return undefined
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`
}

export function applyLogoToPlayer(player: SubCategoryPlayer): SubCategoryPlayer {
  return {
    ...player,
    logoUrl: deriveLogoUrl(player.websiteUrl, player.logoUrl),
  }
}

export function applyLogosToMap(map: VerticalMap): VerticalMap {
  return {
    ...map,
    subCategories: map.subCategories.map((sub) => ({
      ...sub,
      topPlayers: sub.topPlayers.map(applyLogoToPlayer),
    })),
  }
}

export function applyLogoToCompetitor(competitor: Competitor): Competitor {
  return {
    ...competitor,
    logoUrl: deriveLogoUrl(competitor.websiteUrl, competitor.logoUrl),
  }
}

export function applyLogosToCompetitors(competitors: Competitor[]): Competitor[] {
  return competitors.map(applyLogoToCompetitor)
}
