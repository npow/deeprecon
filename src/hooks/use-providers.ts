"use client"

import { useState, useCallback, useEffect } from "react"

export interface ProviderInfo {
  id: string
  label: string
  model: string
  available: boolean
}

export interface UseProvidersReturn {
  providers: ProviderInfo[]
  enabledIds: Set<string>
  loading: boolean
  availableCount: number
  enabledCount: number
  toggle: (id: string) => void
  selectAll: () => void
  selectNone: () => void
  refresh: () => Promise<void>
}

export function useProviders(): UseProvidersReturn {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/maps/turbo")
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      const provs: ProviderInfo[] = data.providers || []
      setProviders(provs)
      // Enable all available providers by default (only on first load or refresh)
      setEnabledIds(new Set(provs.filter((p) => p.available).map((p) => p.id)))
    } catch {
      setProviders([])
      setEnabledIds(new Set())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = useCallback((id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setEnabledIds(new Set(providers.filter((p) => p.available).map((p) => p.id)))
  }, [providers])

  const selectNone = useCallback(() => {
    setEnabledIds(new Set())
  }, [])

  return {
    providers,
    enabledIds,
    loading,
    availableCount: providers.filter((p) => p.available).length,
    enabledCount: enabledIds.size,
    toggle,
    selectAll,
    selectNone,
    refresh,
  }
}
