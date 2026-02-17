"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import Link from "next/link"
import { Radar, Map as MapIcon, ArrowRight, Clock, TrendingUp, Rows3, LayoutGrid, GitBranch, ChevronDown, ChevronUp, RefreshCcw, Activity, AlertTriangle } from "lucide-react"
import type { SavedScanSummary } from "@/lib/types"
import {
  crowdednessBadgeColor,
  gradeColor,
  remixTypeLabel,
  lucrativenessBadgeColor,
  relativeTime,
  ScoreCircle,
} from "@/components/scans/scan-feed-ui"

type FeedView = "cards" | "threads"
type SortObjective = "latest" | "highest_score" | "highest_uniqueness" | "most_lucrative" | "fastest_to_mvp"

interface ThreadNode {
  scan: SavedScanSummary
  children: ThreadNode[]
  latestActivityTs: number
}

interface JobsHealthState {
  total: number
  counts: {
    pending: number
    running: number
    completed: number
    failed: number
  }
  staleThresholdMinutes: number
  staleRunningJobs: Array<{
    id: string
    minutesSinceUpdate: number
    stage: string
  }>
}

function ThreadScanCard({
  scan,
  compact = false,
  showRerun = false,
  onRerun,
  isRerunning = false,
}: {
  scan: SavedScanSummary
  compact?: boolean
  showRerun?: boolean
  onRerun?: (scan: SavedScanSummary) => void
  isRerunning?: boolean
}) {
  const remixLabel = remixTypeLabel(scan)
  return (
    <div className={`group block bg-white border border-gray-200 rounded-xl ${compact ? "p-3" : "p-4"} hover:border-brand-300 hover:shadow-md transition-all`}>
      <Link href={`/scans/${scan.id}`} className="block">
        <div className="flex items-start gap-3">
          <ScoreCircle score={scan.score} grade={scan.grade} size={compact ? "sm" : "md"} />
          <div className="flex-1 min-w-0">
            <p className={`font-medium text-gray-900 line-clamp-2 group-hover:text-brand-700 transition-colors ${compact ? "text-[13px]" : "text-sm"}`}>
              {scan.ideaText}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="text-[10px] bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded-full">
                {scan.vertical}
              </span>
              {scan.category && (
                <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">
                  {scan.category}
                </span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${crowdednessBadgeColor(scan.crowdednessIndex)}`}>
                {scan.crowdednessIndex.replace("_", " ")}
              </span>
              {typeof scan.lucrativenessScore === "number" && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${lucrativenessBadgeColor(scan.lucrativenessTier)}`}>
                  ${" "}
                  L{scan.lucrativenessScore}
                </span>
              )}
              {remixLabel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">
                  {remixLabel}
                </span>
              )}
              {scan.remixLabel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-700 max-w-full truncate">
                  {scan.remixLabel}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <Clock className="h-3 w-3" />
          {relativeTime(scan.createdAt)}
        </div>
        {showRerun ? (
          <button
            type="button"
            disabled={isRerunning}
            onClick={() => onRerun?.(scan)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 bg-brand-50 border border-brand-200 hover:border-brand-300 hover:bg-brand-100 px-2 py-1 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCcw className="h-3 w-3" />
            {isRerunning ? "Re-running..." : "Re-run"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ThreadBranch({ node }: { node: ThreadNode }) {
  return (
    <div className="relative">
      <span className="absolute -left-4 top-6 h-px w-3 bg-gray-200" />
      <ThreadScanCard scan={node.scan} compact />
      {node.children.length > 0 && (
        <div className="mt-3 ml-5 pl-4 border-l border-gray-200 space-y-3">
          {node.children.map((child) => (
            <ThreadBranch key={child.scan.id} node={child} />
          ))}
        </div>
      )}
    </div>
  )
}

function annotateThread(node: ThreadNode): number {
  const ownTs = new Date(node.scan.createdAt).getTime()
  if (!node.children.length) {
    node.latestActivityTs = ownTs
    return ownTs
  }
  const childMax = Math.max(...node.children.map(annotateThread))
  node.latestActivityTs = Math.max(ownTs, childMax)
  return node.latestActivityTs
}

function sortThread(node: ThreadNode): void {
  node.children.sort((a, b) => new Date(a.scan.createdAt).getTime() - new Date(b.scan.createdAt).getTime())
  for (const child of node.children) sortThread(child)
}

function buildThreads(scans: SavedScanSummary[]): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>()
  for (const scan of scans) {
    nodes.set(scan.id, { scan, children: [], latestActivityTs: new Date(scan.createdAt).getTime() })
  }

  const roots: ThreadNode[] = []
  for (const node of nodes.values()) {
    const parentId = node.scan.parentScanId
    const rootId = node.scan.rootScanId
    const fallbackRootParent = rootId && rootId !== node.scan.id ? rootId : undefined
    const attachToId = parentId || fallbackRootParent
    if (attachToId && nodes.has(attachToId)) {
      nodes.get(attachToId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  for (const root of roots) {
    sortThread(root)
    annotateThread(root)
  }

  roots.sort((a, b) => b.latestActivityTs - a.latestActivityTs)
  return roots
}

function flattenThreadNodes(root: ThreadNode): ThreadNode[] {
  const out: ThreadNode[] = []
  function walk(node: ThreadNode) {
    out.push(node)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return out.sort((a, b) => new Date(a.scan.createdAt).getTime() - new Date(b.scan.createdAt).getTime())
}

function bestRemixNode(root: ThreadNode): ThreadNode | null {
  const flat = flattenThreadNodes(root)
  const descendants = flat.filter((n) => n.scan.id !== root.scan.id)
  if (!descendants.length) return null
  return descendants.sort((a, b) => {
    if (b.scan.score !== a.scan.score) return b.scan.score - a.scan.score
    return new Date(b.scan.createdAt).getTime() - new Date(a.scan.createdAt).getTime()
  })[0]
}

export default function ScansPage() {
  const [scans, setScans] = useState<SavedScanSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<FeedView>("threads")
  const [objective, setObjective] = useState<SortObjective>("latest")
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [rerunningIds, setRerunningIds] = useState<Set<string>>(new Set())
  const [jobsHealth, setJobsHealth] = useState<JobsHealthState | null>(null)
  const [isReapingJobs, setIsReapingJobs] = useState(false)
  const showDebugActions = process.env.NEXT_PUBLIC_DEBUG_MODE === "1"

  const loadScans = useCallback(async () => {
    const r = await fetch("/api/scans")
    const data = await r.json()
    setScans(data)
  }, [])

  const loadJobsHealth = useCallback(async () => {
    const r = await fetch("/api/scan/jobs/health")
    if (!r.ok) return
    const data = await r.json() as JobsHealthState
    setJobsHealth(data)
  }, [])

  const runBackgroundRerun = useCallback(async (scan: SavedScanSummary) => {
    if (!showDebugActions) return
    if (rerunningIds.has(scan.id)) return
    setRerunningIds((prev) => new Set(prev).add(scan.id))
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaText: scan.ideaText,
          runInBackground: true,
          remix: {
            parentScanId: scan.id,
            remixType: "manual_rescan",
            remixLabel: "Feed Re-run",
          },
        }),
      })
      if (!response.ok) throw new Error("Failed to start background re-run")
      const started = await response.json() as { jobId?: string }
      if (!started.jobId) throw new Error("No job id returned")
      for (let i = 0; i < 120; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const jobResponse = await fetch(`/api/scan/jobs/${started.jobId}`)
        if (!jobResponse.ok) continue
        const job = await jobResponse.json() as { status?: string }
        if (job.status === "completed" || job.status === "failed") {
          break
        }
      }
      loadScans().catch(() => {})
      loadJobsHealth().catch(() => {})
    } catch {
      // best-effort background action; keep feed usable even if one rerun fails
    } finally {
      setRerunningIds((prev) => {
        const next = new Set(prev)
        next.delete(scan.id)
        return next
      })
    }
  }, [loadScans, rerunningIds, showDebugActions])

  useEffect(() => {
    loadScans()
      .then(() => loadJobsHealth())
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [loadScans, loadJobsHealth])

  useEffect(() => {
    const timer = setInterval(() => {
      loadJobsHealth().catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
  }, [loadJobsHealth])

  const handleReapStaleJobs = useCallback(async () => {
    if (!showDebugActions || isReapingJobs) return
    setIsReapingJobs(true)
    try {
      await fetch("/api/scan/jobs/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staleMinutes: 20 }),
      })
      await loadJobsHealth()
    } catch {
      // keep UI responsive even if cleanup endpoint fails
    } finally {
      setIsReapingJobs(false)
    }
  }, [isReapingJobs, loadJobsHealth, showDebugActions])

  const sortedScans = useMemo(() => {
    const out = [...scans]
    if (objective === "highest_score") {
      return out.sort((a, b) => b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    if (objective === "highest_uniqueness") {
      return out.sort((a, b) => (b.uniquenessScore || 0) - (a.uniquenessScore || 0) || b.score - a.score)
    }
    if (objective === "most_lucrative") {
      return out.sort((a, b) => (b.lucrativenessScore || 0) - (a.lucrativenessScore || 0) || b.score - a.score)
    }
    if (objective === "fastest_to_mvp") {
      const mvpPenalty = (s: SavedScanSummary) => {
        if (s.crowdednessIndex === "low") return 0
        if (s.crowdednessIndex === "moderate") return 4
        if (s.crowdednessIndex === "high") return 8
        return 12
      }
      return out.sort((a, b) => (b.score - mvpPenalty(b)) - (a.score - mvpPenalty(a)))
    }
    return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [scans, objective])

  const threads = useMemo(() => buildThreads(sortedScans), [sortedScans])
  const orderedThreads = useMemo(() => {
    const out = [...threads]
    if (objective === "latest") return out
    return out.sort((a, b) => {
      const as = a.scan
      const bs = b.scan
      if (objective === "highest_score") return bs.score - as.score
      if (objective === "highest_uniqueness") return (bs.uniquenessScore || 0) - (as.uniquenessScore || 0) || bs.score - as.score
      if (objective === "most_lucrative") return (bs.lucrativenessScore || 0) - (as.lucrativenessScore || 0) || bs.score - as.score
      const mvpPenalty = (s: SavedScanSummary) => (s.crowdednessIndex === "low" ? 0 : s.crowdednessIndex === "moderate" ? 4 : s.crowdednessIndex === "high" ? 8 : 12)
      return (bs.score - mvpPenalty(bs)) - (as.score - mvpPenalty(as))
    })
  }, [threads, objective])
  const remixedThreadCount = useMemo(() => orderedThreads.filter((t) => t.children.length > 0).length, [orderedThreads])

  const toggleThreadExpanded = (threadId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return next
    })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <Radar className="h-5 w-5 text-brand-600" />
            <span className="font-bold text-gray-900">DeepRecon</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/maps"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              <MapIcon className="h-3.5 w-3.5" />
              Maps
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Scan Feed</h1>
            <p className="text-sm text-gray-500 mt-1">
              {view === "threads"
                ? `${remixedThreadCount} threaded remix chains`
                : "Browse your past competitive analyses"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
              <button
                onClick={() => setObjective("latest")}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${objective === "latest" ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:text-gray-800"}`}
              >
                Latest
              </button>
              <button
                onClick={() => setObjective("highest_score")}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${objective === "highest_score" ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:text-gray-800"}`}
              >
                Top Score
              </button>
              <button
                onClick={() => setObjective("highest_uniqueness")}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${objective === "highest_uniqueness" ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:text-gray-800"}`}
              >
                Uniqueness
              </button>
              <button
                onClick={() => setObjective("most_lucrative")}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${objective === "most_lucrative" ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:text-gray-800"}`}
              >
                Lucrative
              </button>
              <button
                onClick={() => setObjective("fastest_to_mvp")}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${objective === "fastest_to_mvp" ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:text-gray-800"}`}
              >
                Fastest MVP
              </button>
            </div>
            <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
              <button
                onClick={() => setView("threads")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  view === "threads" ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                <Rows3 className="h-3.5 w-3.5" />
                Threads
              </button>
              <button
                onClick={() => setView("cards")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  view === "cards" ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Cards
              </button>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <TrendingUp className="h-4 w-4" />
              New Scan
            </Link>
          </div>
        </div>

        {jobsHealth && (
          <div className="mb-5 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span className="inline-flex items-center gap-1.5 font-medium text-gray-800">
                <Activity className="h-3.5 w-3.5" />
                Scan Ops
              </span>
              <span>pending {jobsHealth.counts.pending}</span>
              <span>running {jobsHealth.counts.running}</span>
              <span>failed {jobsHealth.counts.failed}</span>
              <span>completed {jobsHealth.counts.completed}</span>
              {jobsHealth.staleRunningJobs.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {jobsHealth.staleRunningJobs.length} stale running job(s)
                </span>
              )}
              {showDebugActions && jobsHealth.staleRunningJobs.length > 0 && (
                <button
                  type="button"
                  onClick={handleReapStaleJobs}
                  disabled={isReapingJobs}
                  className="inline-flex items-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-2 py-0.5 font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isReapingJobs ? "Reaping..." : "Reap Stale Jobs"}
                </button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        ) : scans.length === 0 ? (
          <div className="text-center py-20">
            <Radar className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">No scans yet</h2>
            <p className="text-sm text-gray-500 mb-6">Run your first DeepRecon scan to see it here.</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Run DeepRecon
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : view === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedScans.map((scan) => (
              <ThreadScanCard
                key={scan.id}
                scan={scan}
                showRerun={showDebugActions}
                onRerun={runBackgroundRerun}
                isRerunning={rerunningIds.has(scan.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {orderedThreads.map((root) => (
              <div key={root.scan.id} className="bg-gray-50/70 border border-gray-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
                  <GitBranch className="h-3.5 w-3.5" />
                  Thread activity: {relativeTime(new Date(root.latestActivityTs).toISOString())}
                </div>
                <ThreadScanCard
                  scan={root.scan}
                  showRerun={showDebugActions}
                  onRerun={runBackgroundRerun}
                  isRerunning={rerunningIds.has(root.scan.id)}
                />
                {root.children.length > 0 ? (() => {
                  const flat = flattenThreadNodes(root)
                  const totalRuns = flat.length
                  const isExpanded = expandedThreads.has(root.scan.id)
                  const topRemix = bestRemixNode(root)
                  const hiddenCount = Math.max(0, totalRuns - (topRemix ? 2 : 1))
                  return (
                    <>
                      <div className="mt-3 ml-6 pl-4 border-l border-gray-200 space-y-3">
                        {isExpanded
                          ? root.children.map((child) => <ThreadBranch key={child.scan.id} node={child} />)
                          : topRemix
                            ? (
                              <div>
                                <div className="text-[11px] font-medium text-gray-500 mb-1.5">Top Remix Idea</div>
                                <ThreadScanCard
                                  key={topRemix.scan.id}
                                  scan={topRemix.scan}
                                  compact
                                  showRerun={showDebugActions}
                                  onRerun={runBackgroundRerun}
                                  isRerunning={rerunningIds.has(topRemix.scan.id)}
                                />
                              </div>
                            )
                            : null}
                      </div>
                      <div className="mt-3 ml-1">
                        <button
                          onClick={() => toggleThreadExpanded(root.scan.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isExpanded
                            ? `Collapse thread (${totalRuns} runs)`
                            : `Show full thread (${totalRuns} runs${hiddenCount > 0 ? `, +${hiddenCount} hidden` : ""})`}
                        </button>
                      </div>
                    </>
                  )
                })() : (
                  <p className="text-xs text-gray-400 mt-3 ml-1">No remixes yet in this thread.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
