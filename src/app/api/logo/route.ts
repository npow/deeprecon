import { NextRequest } from "next/server"

function normalizeWebsiteUrl(value?: string | null): string | undefined {
  if (!value || typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withProtocol).toString()
  } catch {
    return undefined
  }
}

function hostFromWebsite(website?: string | null): string | undefined {
  const normalized = normalizeWebsiteUrl(website)
  if (!normalized) return undefined
  try {
    const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "")
    if (!host || host === "localhost") return undefined
    return host
  } catch {
    return undefined
  }
}

function initialsFromHost(host?: string): string {
  if (!host) return "?"
  const root = host.split(".")[0] || host
  const parts = root.split(/[-_]/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase()
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "user-agent": "recon-logo-fetcher/1.0" },
      redirect: "follow",
      cache: "force-cache",
    })
    return res
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function fallbackSvg(host?: string): string {
  const initials = initialsFromHost(host)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${initials}"><rect width="128" height="128" rx="64" fill="#e5e7eb"/><text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial" font-size="44" fill="#374151">${initials}</text></svg>`
}

export async function GET(request: NextRequest) {
  const website = request.nextUrl.searchParams.get("website")
  const host = hostFromWebsite(website)

  if (!host) {
    return new Response(fallbackSvg(undefined), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=86400",
      },
    })
  }

  const websiteUrl = normalizeWebsiteUrl(website)!
  const candidates = [
    `${new URL(websiteUrl).origin}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
    `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`,
    `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(websiteUrl)}`,
  ]

  for (const candidate of candidates) {
    const res = await fetchWithTimeout(candidate, 2500)
    if (res?.ok) {
      const body = await res.arrayBuffer()
      const contentType = res.headers.get("content-type") || "image/x-icon"
      return new Response(body, {
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=604800, stale-while-revalidate=2592000",
        },
      })
    }
  }

  return new Response(fallbackSvg(host), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  })
}
