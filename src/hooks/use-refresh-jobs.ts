"use client"

import { useState, useCallback, useRef, useEffect } from "react"

export interface ProviderStatus {
  id: string
  label: string
  status: "pending" | "running" | "success" | "error"
  phase?: "connecting" | "generating" | "parsing"
  tokens?: number
  startedAt?: number
  durationMs?: number
  error?: string
  summary?: { subCategories: number; totalPlayers: number }
}

export interface RefreshJob {
  slug: string
  name: string
  startedAt: number
  providers: Map<string, ProviderStatus>
  providerCount: number
  result?: {
    totalPlayers: number
    subCategories: number
    providersUsed: number
    providersFailed: number
    previousPlayers?: number
    previousSubs?: number
    newPlayers?: number
    newSubs?: number
  }
  done: boolean
  error?: string
}

export interface UseRefreshJobsReturn {
  jobs: Map<string, RefreshJob>
  activeCount: number
  startRefresh: (slug: string, name: string, providerIds: string[]) => void
  dismissDone: () => void
}

export function useRefreshJobs(opts?: {
  onComplete?: (slug: string) => void
}): UseRefreshJobsReturn {
  const [jobs, setJobs] = useState<Map<string, RefreshJob>>(new Map())
  const onCompleteRef = useRef(opts?.onComplete)

  useEffect(() => {
    onCompleteRef.current = opts?.onComplete
  }, [opts?.onComplete])

  const activeCount = Array.from(jobs.values()).filter((j) => !j.done).length

  const startRefresh = useCallback(
    (slug: string, name: string, providerIds: string[]) => {
      // Don't start if already running for this slug
      const existing = jobs.get(slug)
      if (existing && !existing.done) return

      const job: RefreshJob = {
        slug,
        name,
        startedAt: Date.now(),
        providers: new Map(),
        providerCount: 0,
        done: false,
      }

      setJobs((prev) => {
        const next = new Map(prev)
        next.set(slug, job)
        return next
      })

      // Fire SSE request
      fetch(`/api/maps/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: providerIds }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Request failed" }))
            setJobs((prev) => {
              const next = new Map(prev)
              const j = next.get(slug)
              if (j) {
                next.set(slug, { ...j, done: true, error: err.error || `HTTP ${res.status}` })
              }
              return next
            })
            return
          }

          const reader = res.body?.getReader()
          if (!reader) return

          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            let eventType = ""
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7)
              } else if (line.startsWith("data: ") && eventType) {
                try {
                  const data = JSON.parse(line.slice(6))
                  handleEvent(slug, eventType, data)
                } catch {
                  // skip malformed JSON
                }
                eventType = ""
              }
            }
          }
        })
        .catch((err) => {
          setJobs((prev) => {
            const next = new Map(prev)
            const j = next.get(slug)
            if (j) {
              next.set(slug, {
                ...j,
                done: true,
                error: err instanceof Error ? err.message : "Network error",
              })
            }
            return next
          })
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs],
  )

  function handleEvent(slug: string, event: string, data: Record<string, unknown>) {
    setJobs((prev) => {
      const next = new Map(prev)
      const job = next.get(slug)
      if (!job) return prev

      switch (event) {
        case "refresh_start": {
          const providers = new Map<string, ProviderStatus>()
          const provList = data.providers as { id: string; label: string }[]
          for (const p of provList || []) {
            providers.set(p.id, { id: p.id, label: p.label, status: "pending" })
          }
          next.set(slug, {
            ...job,
            providerCount: (data.providerCount as number) || provList?.length || 0,
            providers,
          })
          break
        }
        case "provider_start": {
          const providers = new Map(job.providers)
          const id = data.provider as string
          const existing = providers.get(id)
          providers.set(id, {
            id,
            label: (data.label as string) || existing?.label || id,
            status: "running",
            phase: "connecting",
            startedAt: Date.now(),
          })
          next.set(slug, { ...job, providers })
          break
        }
        case "provider_progress": {
          const providers = new Map(job.providers)
          const id = data.provider as string
          const existing = providers.get(id)
          if (existing && existing.status === "running") {
            providers.set(id, {
              ...existing,
              phase: data.phase as ProviderStatus["phase"],
              tokens: data.tokens as number,
            })
            next.set(slug, { ...job, providers })
          }
          break
        }
        case "provider_done": {
          const providers = new Map(job.providers)
          const id = data.provider as string
          const existing = providers.get(id)
          providers.set(id, {
            id,
            label: (data.label as string) || existing?.label || id,
            status: data.success ? "success" : "error",
            startedAt: existing?.startedAt,
            durationMs: data.durationMs as number | undefined,
            error: data.error as string | undefined,
            tokens: existing?.tokens,
            summary: data.summary as ProviderStatus["summary"],
          })
          next.set(slug, { ...job, providers })
          break
        }
        case "refresh_complete": {
          next.set(slug, {
            ...job,
            done: true,
            result: {
              totalPlayers: data.totalPlayers as number,
              subCategories: data.subCategories as number,
              providersUsed: data.providersUsed as number,
              providersFailed: data.providersFailed as number,
              previousPlayers: data.previousPlayers as number | undefined,
              previousSubs: data.previousSubs as number | undefined,
              newPlayers: data.newPlayers as number | undefined,
              newSubs: data.newSubs as number | undefined,
            },
          })
          // Notify parent to re-fetch data
          setTimeout(() => onCompleteRef.current?.(slug), 0)
          break
        }
        case "refresh_error": {
          next.set(slug, {
            ...job,
            done: true,
            error: data.message as string,
          })
          break
        }
      }

      return next
    })
  }

  const dismissDone = useCallback(() => {
    setJobs((prev) => {
      const next = new Map<string, RefreshJob>()
      for (const [slug, job] of prev) {
        if (!job.done) next.set(slug, job)
      }
      return next
    })
  }, [])

  return { jobs, activeCount, startRefresh, dismissDone }
}
