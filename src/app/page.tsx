"use client"

import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Search, Clipboard, FileText, ArrowRight, Radar, Zap, Shield, Target, Settings, ChevronDown, Map, List, CheckCircle, ExternalLink } from "lucide-react"
import { ScanProgress } from "@/components/scan-progress"
import { LandscapeTab } from "@/components/results/landscape-tab"
import { GapsTab } from "@/components/results/gaps-tab"
import { DDReportTab } from "@/components/results/dd-report-tab"
import { PivotsTab } from "@/components/results/pivots-tab"
import { ReadinessScoreCard } from "@/components/results/readiness-score-card"
import { DecisionHeader } from "@/components/results/decision-header"
import { ShareButtons } from "@/components/results/share-buttons"
import { NextStepsCard } from "@/components/results/next-steps-card"
import { UniquenessOptimizerCard } from "@/components/results/uniqueness-optimizer-card"
import { LovableIcon, BoltIcon } from "@/components/results/builder-icons"
import { exportToMarkdown } from "@/lib/export"
import {
  computeReadinessScore,
  generateNextSteps,
  generateUniquenessSuggestions,
  type UniquenessSuggestion,
} from "@/lib/readiness-score"
import { buildLandingPagePrompt, buildDeepLinks } from "@/lib/landing-page-gen"
import { computeEvidenceConfidence } from "@/lib/evidence-confidence"
import {
  type IntentExtraction,
  type Competitor,
  type GapAnalysis,
  type DDReport,
  type PivotSuggestion,
  type ScanEvent,
  type ScanSettings,
  type ScanRemixType,
  DEFAULT_SETTINGS,
} from "@/lib/types"

type AppState = "landing" | "scanning" | "results" | "error"
type ResultTab = "landscape" | "gaps" | "dd_report" | "pivots"

interface UniquenessComparison {
  suggestionTitle: string
  before: number
  after: number
  delta: number
}

interface ScanSnapshot {
  id: string | null
  intent: IntentExtraction | null
  competitors: Competitor[]
  crowdednessIndex: string
  totalFunding: number
  gapAnalysis: GapAnalysis | null
  ddReport: DDReport | null
  pivots: PivotSuggestion[]
}

interface UniquenessExperimentResult {
  suggestionId: string
  suggestionTitle: string
  refinedIdeaText: string
  scanId: string | null
  totalScore: number
  grade: string
  uniquenessBefore: number
  uniquenessAfter: number
  uniquenessDelta: number
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  )
}

function HomeInner() {
  const [appState, setAppState] = useState<AppState>("landing")
  const [ideaText, setIdeaText] = useState("")
  const [currentStage, setCurrentStage] = useState("")
  const [completedStages, setCompletedStages] = useState<string[]>([])
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<ResultTab>("dd_report")

  // Scan results
  const [intent, setIntent] = useState<IntentExtraction | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [crowdednessIndex, setCrowdednessIndex] = useState("")
  const [totalFunding, setTotalFunding] = useState(0)
  const [gapAnalysis, setGapAnalysis] = useState<GapAnalysis | null>(null)
  const [ddReport, setDdReport] = useState<DDReport | null>(null)
  const [pivots, setPivots] = useState<PivotSuggestion[]>([])
  const [copySuccess, setCopySuccess] = useState(false)
  const [settings, setSettings] = useState<ScanSettings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [mapEnriched, setMapEnriched] = useState<{ slug: string; subCategory: string; newCount: number; updatedCount: number } | null>(null)
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  const [scanSaved, setScanSaved] = useState(false)
  const [scanId, setScanId] = useState<string | null>(null)
  const [pendingUniquenessComparison, setPendingUniquenessComparison] = useState<{ suggestionTitle: string; before: number } | null>(null)
  const [uniquenessComparison, setUniquenessComparison] = useState<UniquenessComparison | null>(null)
  const [isExperimentingUniqueness, setIsExperimentingUniqueness] = useState(false)
  const [experimentProgress, setExperimentProgress] = useState<{ done: number; total: number } | null>(null)
  const [uniquenessExperimentResults, setUniquenessExperimentResults] = useState<UniquenessExperimentResult[]>([])
  const [isRescanningFromNextStep, setIsRescanningFromNextStep] = useState(false)
  const autoScanStartedRef = useRef(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchParams = useSearchParams()

  const uniquenessScoreFromReadiness = useCallback((score: ReturnType<typeof computeReadinessScore> | null): number => {
    if (!score) return 0
    const factor = score.breakdown.find((b) => b.factor === "Uniqueness")
    return factor ? factor.score : 0
  }, [])

  // ─── Computed: Readiness Score ───
  const readinessScore = useMemo(() => {
    if (!ddReport) return null
    return computeReadinessScore(ddReport, crowdednessIndex, competitors, gapAnalysis, ideaText)
  }, [ddReport, crowdednessIndex, competitors, gapAnalysis, ideaText])

  // ─── Computed: Next Steps ───
  const nextSteps = useMemo(() => {
    if (!readinessScore || !ddReport) return null
    return generateNextSteps(readinessScore, ddReport, pivots, competitors, gapAnalysis)
  }, [readinessScore, ddReport, pivots, competitors, gapAnalysis])

  // ─── Computed: Structured uniqueness optimization suggestions ───
  const uniquenessSuggestions = useMemo(() => {
    if (!readinessScore || !ddReport || !gapAnalysis) return [] as UniquenessSuggestion[]
    return generateUniquenessSuggestions(ideaText, readinessScore, ddReport, competitors, gapAnalysis, 3)
  }, [ideaText, readinessScore, ddReport, competitors, gapAnalysis])

  // ─── Computed: Landing Page Deep Links ───
  const deepLinks = useMemo(() => {
    if (!intent || !ddReport) return null
    const prompt = buildLandingPagePrompt(intent, ddReport)
    return buildDeepLinks(prompt)
  }, [intent, ddReport])

  const evidenceConfidence = useMemo(
    () => computeEvidenceConfidence(competitors, ddReport, gapAnalysis),
    [competitors, ddReport, gapAnalysis]
  )

  // Pre-fill from ?idea= query param (deep dive from maps)
  useEffect(() => {
    const idea = searchParams.get("idea")
    if (idea && !ideaText) {
      setIdeaText(idea)
    }
  }, [searchParams])

  // Finalize uniqueness delta once a suggestion-triggered re-scan completes.
  useEffect(() => {
    if (!pendingUniquenessComparison || appState !== "results" || !readinessScore) return
    const after = uniquenessScoreFromReadiness(readinessScore)
    const delta = Math.round((after - pendingUniquenessComparison.before) * 10) / 10
    setUniquenessComparison({
      suggestionTitle: pendingUniquenessComparison.suggestionTitle,
      before: pendingUniquenessComparison.before,
      after,
      delta,
    })
    setPendingUniquenessComparison(null)
  }, [pendingUniquenessComparison, appState, readinessScore, uniquenessScoreFromReadiness])

  const executeScanStream = useCallback(async (
    scanIdeaText: string,
    options?: {
      remix?: {
        parentScanId: string
        remixType?: ScanRemixType
        remixLabel?: string
      }
    },
    onEvent?: (event: ScanEvent) => void
  ): Promise<ScanSnapshot> => {
    const trimmedIdea = scanIdeaText.trim()
    if (!trimmedIdea || trimmedIdea.length < 10) {
      throw new Error("Please describe your idea in at least 10 characters")
    }

    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideaText: trimmedIdea, settings, remix: options?.remix }),
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || "Failed to start scan")
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response stream")

    const snapshot: ScanSnapshot = {
      id: null,
      intent: null,
      competitors: [],
      crowdednessIndex: "",
      totalFunding: 0,
      gapAnalysis: null,
      ddReport: null,
      pivots: [],
    }

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const jsonStr = line.slice(6)
        if (!jsonStr.trim()) continue

        let event: ScanEvent
        try {
          event = JSON.parse(jsonStr) as ScanEvent
        } catch {
          continue
        }

        onEvent?.(event)

        switch (event.type) {
          case "intent_extracted":
            snapshot.intent = event.data
            break
          case "competitors_found":
            snapshot.competitors = event.data
            break
          case "crowdedness_assessed":
            snapshot.crowdednessIndex = event.data.index
            snapshot.totalFunding = event.data.totalFunding
            break
          case "gap_analysis_complete":
            snapshot.gapAnalysis = event.data
            break
          case "dd_report_complete":
            snapshot.ddReport = event.data
            break
          case "pivots_generated":
            snapshot.pivots = event.data
            break
          case "scan_complete":
            snapshot.id = event.data.id
            break
          case "scan_error":
            throw new Error(event.data.message)
        }
      }
    }

    return snapshot
  }, [settings])

  const runScan = useCallback(async (
    scanIdeaText: string,
    options?: {
      remix?: {
        parentScanId: string
        remixType?: ScanRemixType
        remixLabel?: string
      }
    },
  ) => {
    const trimmedIdea = scanIdeaText.trim()
    if (!trimmedIdea || trimmedIdea.length < 10) return

    setIdeaText(trimmedIdea)
    setAppState("scanning")
    setError("")
    setCurrentStage("intent")
    setCompletedStages([])
    setIntent(null)
    setCompetitors([])
    setCrowdednessIndex("")
    setTotalFunding(0)
    setGapAnalysis(null)
    setDdReport(null)
    setPivots([])
    setMapEnriched(null)
    setQueuePosition(null)
    setScanSaved(false)
    setScanId(null)

    try {
      await executeScanStream(trimmedIdea, options, (event) => {
        switch (event.type) {
          case "status_update":
            setCurrentStage(event.data.stage)
            setQueuePosition(null)
            break
          case "queue_position":
            setQueuePosition(event.data.position)
            break
          case "intent_extracted":
            setIntent(event.data)
            setCompletedStages((prev) => [...prev, "intent"])
            break
          case "competitors_found":
            setCompetitors(event.data)
            break
          case "crowdedness_assessed":
            setCrowdednessIndex(event.data.index)
            setTotalFunding(event.data.totalFunding)
            setCompletedStages((prev) => [...prev, "competitors"])
            break
          case "gap_analysis_complete":
            setGapAnalysis(event.data)
            setCompletedStages((prev) => [...prev, "gaps"])
            break
          case "dd_report_complete":
            setDdReport(event.data)
            break
          case "pivots_generated":
            setPivots(event.data)
            setCompletedStages((prev) =>
              prev.includes("dd_report") ? prev : [...prev, "dd_report"]
            )
            break
          case "map_enriched":
            setMapEnriched(event.data)
            break
          case "scan_complete":
            setScanSaved(true)
            setScanId(event.data.id)
            setAppState("results")
            break
          case "scan_error":
            setError(event.data.message)
            setAppState("error")
            break
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred")
      setAppState("error")
    }
  }, [executeScanStream])

  const startScan = useCallback(async () => {
    await runScan(ideaText)
  }, [ideaText, runScan])

  useEffect(() => {
    const auto = searchParams.get("autoscan")
    const idea = searchParams.get("idea")
    if (auto !== "1" || !idea || autoScanStartedRef.current) return
    if (appState !== "landing") return
    autoScanStartedRef.current = true
    setIdeaText(idea)
    void runScan(idea)
  }, [searchParams, appState, runScan])

  const handleUseSuggestion = useCallback((text: string) => {
    setIdeaText(text)
  }, [])

  const handleUseSuggestionAndRescan = useCallback(async (suggestion: UniquenessSuggestion) => {
    const before = uniquenessScoreFromReadiness(readinessScore)
    setPendingUniquenessComparison({
      suggestionTitle: suggestion.title,
      before,
    })
    if (!scanId) {
      await runScan(suggestion.refinedIdeaText)
      return
    }
    await runScan(suggestion.refinedIdeaText, {
      remix: {
        parentScanId: scanId,
        remixType: "uniqueness_suggestion",
        remixLabel: suggestion.title,
      },
    })
  }, [readinessScore, runScan, scanId, uniquenessScoreFromReadiness])

  const handleRunTopRemix = useCallback(async () => {
    if (!uniquenessSuggestions.length) return
    await handleUseSuggestionAndRescan(uniquenessSuggestions[0])
  }, [uniquenessSuggestions, handleUseSuggestionAndRescan])

  const handleRunUniquenessExperiments = useCallback(async () => {
    if (!readinessScore || !uniquenessSuggestions.length) return

    const baselineUniqueness = uniquenessScoreFromReadiness(readinessScore)
    const variants = uniquenessSuggestions.slice(0, Math.max(1, settings.experimentVariants || 3))

    setIsExperimentingUniqueness(true)
    setExperimentProgress({ done: 0, total: variants.length })
    setUniquenessExperimentResults([])

    try {
      const results: UniquenessExperimentResult[] = []

      for (let i = 0; i < variants.length; i++) {
        const suggestion = variants[i]
        const snapshot = await executeScanStream(
          suggestion.refinedIdeaText,
          scanId ? {
            remix: {
              parentScanId: scanId,
              remixType: "uniqueness_experiment",
              remixLabel: suggestion.title,
            },
          } : undefined
        )
        if (!snapshot.ddReport) continue

        const score = computeReadinessScore(
          snapshot.ddReport,
          snapshot.crowdednessIndex,
          snapshot.competitors,
          snapshot.gapAnalysis,
          suggestion.refinedIdeaText
        )
        const uniquenessAfter = uniquenessScoreFromReadiness(score)
        const uniquenessDelta = Math.round((uniquenessAfter - baselineUniqueness) * 10) / 10

        results.push({
          suggestionId: suggestion.id,
          suggestionTitle: suggestion.title,
          refinedIdeaText: suggestion.refinedIdeaText,
          scanId: snapshot.id,
          totalScore: score.total,
          grade: score.grade,
          uniquenessBefore: baselineUniqueness,
          uniquenessAfter,
          uniquenessDelta,
        })
        setExperimentProgress({ done: i + 1, total: variants.length })
      }

      const ranked = [...results].sort((a, b) => {
        if (b.uniquenessDelta !== a.uniquenessDelta) return b.uniquenessDelta - a.uniquenessDelta
        return b.totalScore - a.totalScore
      })
      setUniquenessExperimentResults(ranked)
    } finally {
      setIsExperimentingUniqueness(false)
    }
  }, [readinessScore, uniquenessSuggestions, settings.experimentVariants, executeScanStream, scanId, uniquenessScoreFromReadiness])

  const handleApplyExperimentResult = useCallback((result: UniquenessExperimentResult) => {
    setIdeaText(result.refinedIdeaText)
  }, [])

  const handleRescanFromNextStep = useCallback(async (step: { action: string; refinedIdeaText?: string }) => {
    const targetIdea = step.refinedIdeaText?.trim() || ideaText.trim()
    if (!targetIdea || targetIdea.length < 10) return
    setIsRescanningFromNextStep(true)
    try {
      if (!scanId) {
        await runScan(targetIdea)
        return
      }
      await runScan(targetIdea, {
        remix: {
          parentScanId: scanId,
          remixType: "manual_rescan",
          remixLabel: step.action,
        },
      })
    } finally {
      setIsRescanningFromNextStep(false)
    }
  }, [ideaText, scanId, runScan])

  const handleExportMarkdown = useCallback(() => {
    if (!intent || !gapAnalysis || !ddReport) return
    const markdown = exportToMarkdown({
      ideaText,
      intent,
      competitors,
      crowdednessIndex,
      totalFunding,
      gapAnalysis,
      ddReport,
      pivots,
    })
    navigator.clipboard.writeText(markdown)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }, [ideaText, intent, competitors, crowdednessIndex, totalFunding, gapAnalysis, ddReport, pivots])

  const resetScan = () => {
    setAppState("landing")
    setError("")
    setPendingUniquenessComparison(null)
    setUniquenessComparison(null)
    setIsExperimentingUniqueness(false)
    setExperimentProgress(null)
    setUniquenessExperimentResults([])
  }

  // ─── Landing ───
  if (appState === "landing") {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Nav */}
        <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radar className="h-5 w-5 text-brand-600" />
              <span className="font-bold text-gray-900">Recon</span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/scans"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                <List className="h-3.5 w-3.5" />
                Feed
              </Link>
              <Link
                href="/maps"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                <Map className="h-3.5 w-3.5" />
                Market Maps
              </Link>
            </div>
          </div>
        </nav>

        {/* Hero */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
          <div className="max-w-2xl w-full text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 tracking-tight text-balance">
              Know your competition
              <br />
              <span className="bg-gradient-to-r from-brand-500 to-purple-600 bg-clip-text text-transparent">
                before you build
              </span>
            </h1>
            <p className="mt-4 text-lg text-gray-500 max-w-lg mx-auto text-balance">
              Get a VC-grade competitive analysis in under 5 minutes. Real insights. Actionable
              strategy. Not another generic AI validator.
            </p>

            {/* Input */}
            <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-200 p-4">
              <textarea
                ref={textareaRef}
                value={ideaText}
                onChange={(e) => setIdeaText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey) startScan()
                }}
                placeholder="Describe your startup idea in 1-2 sentences... &#10;&#10;e.g. &quot;A tool that helps landlords automate tenant screening using AI to analyze rental applications and credit reports&quot;"
                className="w-full h-28 resize-none border-0 focus:ring-0 text-gray-900 placeholder:text-gray-400 text-base outline-none"
              />
              {/* Settings toggle */}
              {showSettings && (
                <div className="pt-3 pb-1 border-t border-gray-100 space-y-3 animate-fade-in">
                  <div className="flex items-center gap-4">
                    <label className="text-xs font-medium text-gray-500 w-28">Competitors</label>
                    <div className="flex gap-1.5">
                      {[5, 10, 15].map((n) => (
                        <button
                          key={n}
                          onClick={() => setSettings((s) => ({ ...s, maxCompetitors: n }))}
                          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                            settings.maxCompetitors === n
                              ? "bg-brand-100 text-brand-700 border border-brand-300"
                              : "bg-gray-100 text-gray-500 border border-transparent hover:bg-gray-200"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-xs font-medium text-gray-500 w-28">Depth</label>
                    <div className="flex gap-1.5">
                      {([
                        { key: "quick", label: "Quick", desc: "~45s" },
                        { key: "standard", label: "Standard", desc: "~75s" },
                        { key: "deep", label: "Deep", desc: "~90s" },
                      ] as const).map(({ key, label, desc }) => (
                        <button
                          key={key}
                          onClick={() => setSettings((s) => ({ ...s, depthLevel: key }))}
                          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                            settings.depthLevel === key
                              ? "bg-brand-100 text-brand-700 border border-brand-300"
                              : "bg-gray-100 text-gray-500 border border-transparent hover:bg-gray-200"
                          }`}
                        >
                          {label} <span className="text-gray-400 font-normal">{desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-xs font-medium text-gray-500 w-28">Workflow</label>
                    <div className="flex gap-1.5">
                      {([
                        { key: "founder", label: "Founder" },
                        { key: "investor", label: "Investor" },
                      ] as const).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setSettings((s) => ({ ...s, workflowMode: key }))}
                          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                            settings.workflowMode === key
                              ? "bg-brand-100 text-brand-700 border border-brand-300"
                              : "bg-gray-100 text-gray-500 border border-transparent hover:bg-gray-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-xs font-medium text-gray-500 w-28">Experiments</label>
                    <div className="flex gap-1.5">
                      {[2, 3, 4].map((n) => (
                        <button
                          key={n}
                          onClick={() => setSettings((s) => ({ ...s, experimentVariants: n }))}
                          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                            settings.experimentVariants === n
                              ? "bg-brand-100 text-brand-700 border border-brand-300"
                              : "bg-gray-100 text-gray-500 border border-transparent hover:bg-gray-200"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowSettings((s) => !s)}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                    <ChevronDown className={`h-3 w-3 transition-transform ${showSettings ? "rotate-180" : ""}`} />
                  </button>
                  <span className="text-xs text-gray-300">
                    {ideaText.length > 0 ? `${ideaText.length} chars` : "Cmd+Enter to scan"}
                  </span>
                </div>
                <button
                  onClick={startScan}
                  disabled={ideaText.trim().length < 10}
                  className="inline-flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Search className="h-4 w-4" />
                  Run Recon
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Features */}
            <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
              <div className="p-4">
                <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center mb-3">
                  <Zap className="h-5 w-5 text-brand-600" />
                </div>
                <h3 className="font-semibold text-gray-900 text-sm">Competitive Scan</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Find every competitor, their funding, team size, and user sentiment — in seconds.
                </p>
              </div>
              <div className="p-4">
                <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center mb-3">
                  <Target className="h-5 w-5 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900 text-sm">VC-Grade DD Report</h3>
                <p className="text-sm text-gray-500 mt-1">
                  ICP, wedge, TAM/SAM/SOM, defensibility, GTM — the exact framework investors use.
                </p>
              </div>
              <div className="p-4">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center mb-3">
                  <Shield className="h-5 w-5 text-green-600" />
                </div>
                <h3 className="font-semibold text-gray-900 text-sm">Pivot Strategies</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Market too crowded? Get specific differentiation angles based on real competitor
                  weaknesses.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ─── Scanning ───
  if (appState === "scanning") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="flex items-center gap-2 mb-8">
          <Radar className="h-5 w-5 text-brand-600 animate-pulse" />
          <span className="font-bold text-gray-900">Recon</span>
        </div>
        {queuePosition !== null && queuePosition > 0 ? (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">You&apos;re in the queue</h2>
            <p className="text-sm text-gray-500 mb-8 max-w-sm text-center text-balance">
              Position #{queuePosition}. Your scan will start shortly.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Running your recon</h2>
            <p className="text-sm text-gray-500 mb-8 max-w-sm text-center text-balance">
              Analyzing competitive landscape and generating your DD report. This usually takes 1-2
              minutes.
            </p>
          </>
        )}
        <ScanProgress currentStage={currentStage} completedStages={completedStages} />
      </div>
    )
  }

  // ─── Error ───
  if (appState === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-red-600 mb-6">{error}</p>
          <button
            onClick={resetScan}
            className="inline-flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm hover:bg-brand-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  // ─── Results ───
  const TABS: { key: ResultTab; label: string; ready: boolean }[] = [
    { key: "dd_report", label: "Deep Dive", ready: ddReport !== null },
    { key: "pivots", label: "Pivots", ready: pivots.length > 0 },
    { key: "gaps", label: "Gap Analysis", ready: gapAnalysis !== null },
    { key: "landscape", label: "Threat Assessment", ready: competitors.length > 0 },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={resetScan} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <Radar className="h-5 w-5 text-brand-600" />
            <span className="font-bold text-gray-900">Recon</span>
          </button>
          <div className="flex items-center gap-2">
            {/* Share buttons */}
            {readinessScore && <ShareButtons score={readinessScore} ideaText={ideaText} />}
            <Link
              href="/scans"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <List className="h-3.5 w-3.5" />
              Feed
            </Link>
            <Link
              href="/maps"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Map className="h-3.5 w-3.5" />
              Maps
            </Link>
            <button
              onClick={handleExportMarkdown}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Clipboard className="h-3.5 w-3.5" />
              {copySuccess ? "Copied!" : "Copy MD"}
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              Share PDF
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {/* Idea summary */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-400">Your idea</p>
            {deepLinks && (
              <div className="screen-only flex flex-wrap items-center gap-2">
                <a
                  href={deepLinks.lovable}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 hover:border-purple-300 hover:bg-purple-100 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <LovableIcon size={14} />
                  Generate in Lovable
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a
                  href={deepLinks.bolt}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 hover:border-brand-300 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <BoltIcon size={14} />
                  Generate in Bolt
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
          <p className="text-gray-900 font-medium">{ideaText}</p>
          {intent && (
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
                {intent.vertical}
              </span>
              <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                {intent.category}
              </span>
              <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                {settings.workflowMode} workflow
              </span>
            </div>
          )}
        </div>

        {/* Readiness Score Card — hero metric, always visible above tabs */}
        {readinessScore && <ReadinessScoreCard score={readinessScore} evidenceConfidence={evidenceConfidence.score} />}

        {readinessScore && nextSteps && (
          <DecisionHeader
            score={readinessScore}
            onPrimaryAction={uniquenessSuggestions.length > 0 ? handleRunTopRemix : undefined}
            primaryLabel={uniquenessSuggestions.length > 0 ? "Run Recommended Remix" : "No Remix Available"}
          />
        )}

        {/* Uniqueness optimization loop */}
        {readinessScore && ddReport && gapAnalysis && (
          <UniquenessOptimizerCard
            suggestions={uniquenessSuggestions}
            currentUniqueness={uniquenessScoreFromReadiness(readinessScore)}
            isRescanning={pendingUniquenessComparison !== null}
            isExperimenting={isExperimentingUniqueness}
            experimentProgress={experimentProgress}
            experimentResults={uniquenessExperimentResults}
            comparison={uniquenessComparison}
            onUseSuggestion={handleUseSuggestion}
            onUseAndRescan={handleUseSuggestionAndRescan}
            onRunExperiments={handleRunUniquenessExperiments}
            onApplyExperiment={handleApplyExperimentResult}
          />
        )}

        {/* Action plan should stay visible during the full review flow */}
        {nextSteps && readinessScore && (
          <div className="mb-6 screen-only">
            <NextStepsCard
              steps={nextSteps}
              grade={readinessScore.grade}
              onRescanStep={handleRescanFromNextStep}
              isRescanningStep={isRescanningFromNextStep}
            />
          </div>
        )}

        {/* Saved to feed indicator */}
        {scanSaved && scanId && (
          <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-sm animate-fade-in">
            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
            <span className="text-gray-700">
              Saved to{" "}
              <Link href={`/scans/${scanId}`} className="font-medium text-green-600 hover:underline">
                feed
              </Link>
            </span>
          </div>
        )}

        {/* Map enrichment notification */}
        {mapEnriched && mapEnriched.newCount > 0 && (
          <div className="mb-4 px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg flex items-center gap-2 text-sm">
            <Map className="h-4 w-4 text-brand-500 flex-shrink-0" />
            <span className="text-gray-700">
              Added {mapEnriched.newCount} competitor{mapEnriched.newCount !== 1 ? "s" : ""} to{" "}
              <Link href={`/maps/${mapEnriched.slug}`} className="font-medium text-brand-600 hover:underline">
                {mapEnriched.slug}
              </Link>
              {" "}&rarr; {mapEnriched.subCategory}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <div className="flex gap-1 -mb-px">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => tab.ready && setActiveTab(tab.key)}
                disabled={!tab.ready}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-brand-500 text-brand-600"
                    : tab.ready
                      ? "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      : "border-transparent text-gray-300 cursor-not-allowed"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content (screen only) */}
        <div className="screen-only">
          {activeTab === "landscape" && competitors.length > 0 && (
            <LandscapeTab
              competitors={competitors}
              crowdednessIndex={crowdednessIndex}
              totalFunding={totalFunding}
              evidence={evidenceConfidence}
            />
          )}
          {activeTab === "gaps" && gapAnalysis && <GapsTab gapAnalysis={gapAnalysis} />}
          {activeTab === "dd_report" && ddReport && (
            <DDReportTab ddReport={ddReport} crowdednessIndex={crowdednessIndex} />
          )}
          {activeTab === "pivots" && <PivotsTab pivots={pivots} />}
        </div>

        {/* Print-only: all sections sequentially */}
        <div className="print-only">
          {competitors.length > 0 && (
            <div className="print-section">
              <h2 className="text-xl font-bold text-gray-900 mb-4 print:text-lg">Competitive Landscape</h2>
              <LandscapeTab
                competitors={competitors}
                crowdednessIndex={crowdednessIndex}
                totalFunding={totalFunding}
                evidence={evidenceConfidence}
              />
            </div>
          )}
          {gapAnalysis && (
            <div className="print-section">
              <h2 className="text-xl font-bold text-gray-900 mb-4 print:text-lg">Gap Analysis</h2>
              <GapsTab gapAnalysis={gapAnalysis} />
            </div>
          )}
          {ddReport && (
            <div className="print-section">
              <h2 className="text-xl font-bold text-gray-900 mb-4 print:text-lg">DD Report</h2>
              <DDReportTab ddReport={ddReport} crowdednessIndex={crowdednessIndex} />
            </div>
          )}
          {pivots.length > 0 && (
            <div className="print-section">
              <h2 className="text-xl font-bold text-gray-900 mb-4 print:text-lg">Pivot Strategies</h2>
              <PivotsTab pivots={pivots} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
