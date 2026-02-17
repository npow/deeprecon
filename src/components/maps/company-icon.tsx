"use client"

import { useEffect, useMemo, useState } from "react"

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase()
}

function fallbackColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 45% 92%)`
}

function websiteHost(value?: string): string | undefined {
  if (!value || !value.trim()) return undefined
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    return new URL(withProtocol).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

function iconUrls(websiteUrl?: string, logoUrl?: string, size: number = 24): string[] {
  const urls: string[] = []
  if (logoUrl && logoUrl.trim()) urls.push(logoUrl.trim())
  if (websiteUrl && websiteUrl.trim()) {
    urls.push(`/api/logo?website=${encodeURIComponent(websiteUrl.trim())}`)
    const faviconSize = Math.max(16, size * 2)
    const host = websiteHost(websiteUrl)
    if (host) {
      urls.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`)
    }
    urls.push(`https://www.google.com/s2/favicons?sz=${faviconSize}&domain_url=${encodeURIComponent(websiteUrl)}`)
  }
  return Array.from(new Set(urls))
}

export function CompanyIcon({
  name,
  websiteUrl,
  logoUrl,
  size = 20,
  className = "",
}: {
  name: string
  websiteUrl?: string
  logoUrl?: string
  size?: number
  className?: string
}) {
  const [sourceIndex, setSourceIndex] = useState(0)
  const sources = useMemo(() => iconUrls(websiteUrl, logoUrl, size), [websiteUrl, logoUrl, size])

  useEffect(() => {
    setSourceIndex(0)
  }, [websiteUrl, logoUrl, size])

  const src = sources[sourceIndex]
  if (!src) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full border border-gray-200 text-[10px] font-semibold text-gray-700 ${className}`}
        style={{ width: size, height: size, backgroundColor: fallbackColor(name) }}
        aria-label={`${name} icon fallback`}
      >
        {initials(name)}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={`inline-block rounded-full border border-gray-200 bg-white object-cover ${className}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setSourceIndex((idx) => idx + 1)}
    />
  )
}
