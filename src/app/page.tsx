"use client"

import { useState, useRef, useCallback, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Search, Clipboard, Download, ArrowRight, Radar, Zap, Shield, Target, Settings, ChevronDown, Map } from "lucide-react"
import { ScanProgress } from "@/components/scan-progress"
import { LandscapeTab } from "@/components/results/landscape-tab"
import { GapsTab } from "@/components/results/gaps-tab"
import { DDReportTab } from "@/components/results/dd-report-tab"
import { PivotsTab } from "@/components/results/pivots-tab"
import { exportToMarkdown } from "@/lib/export"
import {
  type IntentExtraction,
  type Competitor,
  type GapAnalysis,
  type DDReport,
  type PivotSuggestion,
  type ScanEvent,
  type ScanSettings,
  DEFAULT_SETTINGS,
} from "@/lib/types"

type AppState = "landing" | "scanning" | "results" | "error"
type ResultTab = "landscape" | "gaps" | "dd_report" | "pivots"

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
  const [activeTab, setActiveTab] = useState<ResultTab>("landscape")

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

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchParams = useSearchParams()

  // Pre-fill from ?idea= query param (deep dive from maps)
  useEffect(() => {
    const idea = searchParams.get("idea")
    if (idea && !ideaText) {
      setIdeaText(idea)
    }
  }, [searchParams])

  const startScan = useCallback(async () => {
    if (!ideaText.trim() || ideaText.trim().length < 10) return

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

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText: ideaText.trim(), settings }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Failed to start scan")
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response stream")

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

          try {
            const event = JSON.parse(jsonStr) as ScanEvent

            switch (event.type) {
              case "status_update":
                setCurrentStage(event.data.stage)
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
                // Both DD report and pivots arrive before scan_complete
                setCompletedStages((prev) =>
                  prev.includes("dd_report") ? prev : [...prev, "dd_report"]
                )
                break
              case "scan_complete":
                setAppState("results")
                break
              case "scan_error":
                setError(event.data.message)
                setAppState("error")
                break
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred")
      setAppState("error")
    }
  }, [ideaText])

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

  const handleDownloadMarkdown = useCallback(() => {
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
    const blob = new Blob([markdown], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `recon-report-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [ideaText, intent, competitors, crowdednessIndex, totalFunding, gapAnalysis, ddReport, pivots])

  const resetScan = () => {
    setAppState("landing")
    setError("")
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
            <Link
              href="/maps"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              <Map className="h-3.5 w-3.5" />
              Market Maps
            </Link>
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
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Running your recon</h2>
        <p className="text-sm text-gray-500 mb-8 max-w-sm text-center text-balance">
          Analyzing competitive landscape and generating your DD report. This usually takes 1-2
          minutes.
        </p>
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
    { key: "landscape", label: "Landscape", ready: competitors.length > 0 },
    { key: "gaps", label: "Gap Analysis", ready: gapAnalysis !== null },
    { key: "dd_report", label: "DD Report", ready: ddReport !== null },
    { key: "pivots", label: "Pivots", ready: pivots.length > 0 },
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
              onClick={handleDownloadMarkdown}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {/* Idea summary */}
        <div className="mb-6">
          <p className="text-sm text-gray-400">Your idea</p>
          <p className="text-gray-900 font-medium">{ideaText}</p>
          {intent && (
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
                {intent.vertical}
              </span>
              <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                {intent.category}
              </span>
            </div>
          )}
        </div>

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

        {/* Tab content */}
        {activeTab === "landscape" && competitors.length > 0 && (
          <LandscapeTab
            competitors={competitors}
            crowdednessIndex={crowdednessIndex}
            totalFunding={totalFunding}
          />
        )}
        {activeTab === "gaps" && gapAnalysis && <GapsTab gapAnalysis={gapAnalysis} />}
        {activeTab === "dd_report" && ddReport && <DDReportTab ddReport={ddReport} />}
        {activeTab === "pivots" && <PivotsTab pivots={pivots} />}
      </main>
    </div>
  )
}
