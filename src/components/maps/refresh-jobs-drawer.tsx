"use client"

import { useState, useEffect, useRef } from "react"
import { ChevronDown, ChevronUp, X, Check, AlertCircle, Loader2, Clock } from "lucide-react"
import { providerColor } from "@/components/maps/provider-picker"
import { type UseRefreshJobsReturn, type RefreshJob, type ProviderStatus } from "@/hooks/use-refresh-jobs"

const VERTICAL_ICONS: Record<string, string> = {
  "ai-ml": "🤖",
  fintech: "💳",
  devtools: "🛠️",
  cybersecurity: "🛡️",
  healthtech: "🏥",
  "climate-tech": "🌍",
  edtech: "🎓",
  martech: "📣",
  proptech: "🏠",
  "hr-tech": "👥",
}

const PHASE_LABELS: Record<string, string> = {
  connecting: "Connecting",
  generating: "Generating",
  parsing: "Parsing",
}

export function RefreshJobsDrawer({ refreshJobs }: { refreshJobs: UseRefreshJobsReturn }) {
  const { jobs, activeCount, dismissDone } = refreshJobs
  const [expanded, setExpanded] = useState(true)

  // Auto-expand when new jobs start
  const prevActiveCount = useRef(0)
  useEffect(() => {
    if (activeCount > prevActiveCount.current) {
      setExpanded(true)
    }
    prevActiveCount.current = activeCount
  }, [activeCount])

  if (jobs.size === 0) return null

  const jobList = Array.from(jobs.values())
  const doneCount = jobList.filter((j) => j.done).length
  const hasActive = activeCount > 0

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="max-w-4xl mx-auto px-4 pb-4 pointer-events-auto">
        <div className="bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              {hasActive ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
              ) : (
                <Check className="h-4 w-4 text-green-500" />
              )}
              {hasActive
                ? `Refreshing ${activeCount} map${activeCount > 1 ? "s" : ""}`
                : `${doneCount} refresh${doneCount > 1 ? "es" : ""} complete`}
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
              )}
            </div>
            {doneCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  dismissDone()
                }}
                className="text-xs text-gray-400 hover:text-gray-600 font-medium px-2 py-0.5 rounded hover:bg-gray-200 transition-colors"
              >
                Dismiss
              </button>
            )}
          </button>

          {/* Job rows */}
          {expanded && (
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {jobList.map((job) => (
                <JobRow key={job.slug} job={job} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function JobRow({ job }: { job: RefreshJob }) {
  const providerList = Array.from(job.providers.values())
  const completedCount = providerList.filter(
    (p) => p.status === "success" || p.status === "error",
  ).length
  const runningCount = providerList.filter((p) => p.status === "running").length
  const totalTokens = providerList.reduce((s, p) => s + (p.tokens || 0), 0)
  const progressPct =
    job.providerCount > 0 ? (completedCount / job.providerCount) * 100 : 0

  return (
    <div className="px-4 py-3">
      {/* Top line: icon + name + status */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{VERTICAL_ICONS[job.slug] || "📊"}</span>
          <span className="text-sm font-semibold text-gray-900">{job.name}</span>
          {!job.done && (
            <span className="text-xs text-gray-400">
              {completedCount}/{job.providerCount} done
              {runningCount > 0 && ` · ${runningCount} generating`}
              {totalTokens > 0 && ` · ${totalTokens.toLocaleString()} tokens`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {job.error && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              Failed
            </span>
          )}
          <ElapsedTime startedAt={job.startedAt} done={job.done} />
        </div>
      </div>

      {/* Provider rows — each gets its own line with detail */}
      {providerList.length > 0 && (
        <div className="space-y-1 mb-2">
          {providerList.map((p) => (
            <ProviderRow key={p.id} provider={p} />
          ))}
        </div>
      )}

      {/* Progress bar (only while running) */}
      {!job.done && job.providerCount > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-100 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-brand-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">
            {completedCount}/{job.providerCount}
          </span>
        </div>
      )}

      {/* Done summary */}
      {job.done && job.result && (
        <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3 text-green-500" />
            {job.result.totalPlayers} players
            {job.result.newPlayers != null && job.result.newPlayers > 0 && (
              <span className="text-green-600 font-medium">(+{job.result.newPlayers} new)</span>
            )}
            {job.result.newPlayers != null && job.result.newPlayers === 0 && (
              <span className="text-gray-400">(no new)</span>
            )}
          </span>
          <span>
            {job.result.subCategories} subs
            {job.result.newSubs != null && job.result.newSubs > 0 && (
              <span className="text-green-600 font-medium"> (+{job.result.newSubs})</span>
            )}
          </span>
          <span>
            {job.result.providersUsed}/{job.result.providersUsed + job.result.providersFailed} providers
          </span>
        </div>
      )}
    </div>
  )
}

function ProviderRow({ provider }: { provider: ProviderStatus }) {
  const baseColor = providerColor(provider.id)
  const isPending = provider.status === "pending"
  const isRunning = provider.status === "running"
  const isError = provider.status === "error"
  const isDone = provider.status === "success"

  return (
    <div className="flex items-center gap-2 text-[11px]">
      {/* Status icon */}
      <span className="w-3.5 flex-shrink-0 flex items-center justify-center">
        {isPending && <Clock className="h-3 w-3 text-gray-300" />}
        {isRunning && <Loader2 className="h-3 w-3 text-brand-500 animate-spin" />}
        {isDone && <Check className="h-3 w-3 text-green-500" />}
        {isError && <X className="h-3 w-3 text-red-500" />}
      </span>

      {/* Provider name chip */}
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
          isPending
            ? "bg-gray-50 border-gray-200 text-gray-400"
            : isError
              ? "bg-red-50 border-red-200 text-red-600"
              : baseColor
        }`}
      >
        {provider.label}
      </span>

      {/* Phase + details */}
      <span className="text-gray-400 flex-1 truncate">
        {isPending && "Queued"}
        {isRunning && provider.phase && (
          <>
            {PHASE_LABELS[provider.phase] || provider.phase}
            {provider.phase === "generating" && provider.tokens != null && provider.tokens > 0 && (
              <span className="text-gray-500 font-medium">
                {" "}— {provider.tokens.toLocaleString()} tokens
              </span>
            )}
            {provider.phase === "connecting" && (
              <span className="text-gray-400"> — sending prompt</span>
            )}
            {provider.phase === "parsing" && (
              <span className="text-gray-400"> — extracting JSON</span>
            )}
          </>
        )}
        {isRunning && !provider.phase && "Starting..."}
        {isDone && provider.summary && (
          <span className="text-gray-500">
            Found {provider.summary.subCategories} subs, {provider.summary.totalPlayers} players
          </span>
        )}
        {isDone && !provider.summary && "Done"}
        {isError && (
          <span className="text-red-400 truncate" title={provider.error}>
            {provider.error || "Failed"}
          </span>
        )}
      </span>

      {/* Timer / Duration */}
      <span className="text-gray-400 tabular-nums flex-shrink-0">
        {isRunning && provider.startedAt && <ProviderTimer startedAt={provider.startedAt} />}
        {isDone && provider.durationMs != null && (
          <span>{(provider.durationMs / 1000).toFixed(1)}s</span>
        )}
      </span>
    </div>
  )
}

function ProviderTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt)

  useEffect(() => {
    setElapsed(Date.now() - startedAt)
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 100)
    return () => clearInterval(interval)
  }, [startedAt])

  return (
    <span className="tabular-nums">{(elapsed / 1000).toFixed(1)}s</span>
  )
}

function ElapsedTime({ startedAt, done }: { startedAt: number; done: boolean }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (done) {
      setElapsed(Date.now() - startedAt)
      return
    }

    setElapsed(Date.now() - startedAt)
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 100)

    return () => clearInterval(interval)
  }, [startedAt, done])

  const seconds = (elapsed / 1000).toFixed(1)

  return (
    <span className="text-xs text-gray-400 tabular-nums font-medium">
      {seconds}s
    </span>
  )
}
