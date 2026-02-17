"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Radar, Map, ArrowLeft, List, ExternalLink, Presentation, Loader2 } from "lucide-react"
import { LandscapeTab } from "@/components/results/landscape-tab"
import { GapsTab } from "@/components/results/gaps-tab"
import { DDReportTab } from "@/components/results/dd-report-tab"
import { PivotsTab } from "@/components/results/pivots-tab"
import { ReadinessScoreCard } from "@/components/results/readiness-score-card"
import { DecisionHeader } from "@/components/results/decision-header"
import { NextStepsCard } from "@/components/results/next-steps-card"
import { LovableIcon, BoltIcon } from "@/components/results/builder-icons"
import { ErrorBoundary } from "@/components/error-boundary"
import { generateNextSteps, generateUniquenessSuggestions, type UniquenessSuggestion } from "@/lib/readiness-score"
import { buildLandingPagePrompt, buildDeepLinks } from "@/lib/landing-page-gen"
import { computeEvidenceConfidence } from "@/lib/evidence-confidence"
import type { SavedScan } from "@/lib/types"

type ResultTab = "landscape" | "gaps" | "dd_report" | "pivots"

export default function ScanDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [scan, setScan] = useState<SavedScan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<ResultTab>("dd_report")
  const [deckLoading, setDeckLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/scans/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Scan not found")
        return r.json()
      })
      .then((data) => setScan(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const nextSteps = useMemo(() => {
    if (!scan?.readinessScore || !scan?.ddReport) return null
    return generateNextSteps(scan.readinessScore, scan.ddReport, scan.pivotSuggestions, scan.competitors, scan.gapAnalysis)
  }, [scan])
  const uniquenessSuggestions = useMemo(() => {
    if (!scan?.readinessScore || !scan?.ddReport || !scan?.gapAnalysis) return [] as UniquenessSuggestion[]
    return generateUniquenessSuggestions(
      scan.ideaText,
      scan.readinessScore,
      scan.ddReport,
      scan.competitors,
      scan.gapAnalysis,
      3
    )
  }, [scan])

  const deepLinks = useMemo(() => {
    if (!scan?.intent || !scan?.ddReport) return null
    const prompt = buildLandingPagePrompt(scan.intent, scan.ddReport)
    return buildDeepLinks(prompt)
  }, [scan])

  const handleRescanStep = useCallback((step: { refinedIdeaText?: string }) => {
    const target = (step.refinedIdeaText || scan?.ideaText || "").trim()
    if (!target) return
    router.push(`/?idea=${encodeURIComponent(target)}&autoscan=1`)
  }, [router, scan?.ideaText])
  const handleOptimizeScore = useCallback(() => {
    const top = uniquenessSuggestions[0]
    const target = (top?.refinedIdeaText || scan?.ideaText || "").trim()
    if (!target) return
    router.push(`/?idea=${encodeURIComponent(target)}&autoscan=1`)
  }, [router, scan?.ideaText, uniquenessSuggestions])

  const handleGenerateDeck = useCallback(async () => {
    setDeckLoading(true)
    try {
      const res = await fetch("/api/pitch-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        alert(`Failed to generate pitch deck: ${err.error || res.statusText}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `pitch-deck-${id.slice(0, 20)}.pptx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Failed to generate pitch deck: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setDeckLoading(false)
    }
  }, [id])

  const evidenceConfidence = useMemo(
    () => computeEvidenceConfidence(scan?.competitors || [], scan?.ddReport, scan?.gapAnalysis),
    [scan]
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    )
  }

  if (error || !scan) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Scan not found</h2>
        <p className="text-sm text-gray-500 mb-6">{error || "This scan may have been deleted."}</p>
        <Link
          href="/scans"
          className="inline-flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Feed
        </Link>
      </div>
    )
  }

  const TABS: { key: ResultTab; label: string; ready: boolean }[] = [
    { key: "dd_report", label: "Deep Dive", ready: !!scan.ddReport },
    { key: "pivots", label: "Pivots", ready: scan.pivotSuggestions.length > 0 },
    { key: "gaps", label: "Gap Analysis", ready: !!scan.gapAnalysis },
    { key: "landscape", label: "Threat Assessment", ready: scan.competitors.length > 0 },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <Radar className="h-5 w-5 text-brand-600" />
            <span className="font-bold text-gray-900">DeepRecon</span>
          </Link>
          <div className="flex items-center gap-2">
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
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {/* Idea summary */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-400">Your idea</p>
            {deepLinks && (
              <div className="flex flex-wrap items-center gap-2">
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
                <button
                  onClick={handleGenerateDeck}
                  disabled={deckLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:border-amber-300 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deckLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Presentation className="h-3.5 w-3.5" />}
                  {deckLoading ? "Generating..." : "Pitch Deck"}
                </button>
              </div>
            )}
          </div>
          <p className="text-gray-900 font-medium">{scan.ideaText}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
              {scan.intent.vertical}
            </span>
            <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
              {scan.intent.category}
            </span>
          </div>
        </div>

        {/* Readiness Score */}
        <ErrorBoundary>
        {scan.readinessScore && (
          <ReadinessScoreCard
            score={scan.readinessScore}
            evidenceConfidence={evidenceConfidence.score}
            lucrativenessScore={scan.lucrativenessScore?.total ?? null}
            lucrativenessTier={scan.lucrativenessScore?.tier ?? null}
            validationScore={scan.validationScore?.total ?? null}
            validationTier={scan.validationScore?.tier ?? null}
            validationGate={scan.validationScore?.gate.status ?? null}
            opportunityScore={scan.opportunityScore?.total ?? null}
            opportunityTier={scan.opportunityScore?.tier ?? null}
          />
        )}

        {scan.readinessScore && nextSteps && (
          <DecisionHeader
            score={scan.readinessScore}
            onPrimaryAction={uniquenessSuggestions.length > 0 ? handleOptimizeScore : undefined}
            primaryLabel={
              uniquenessSuggestions.length > 0
                ? `Optimize Score (up to +${uniquenessSuggestions[0].estimatedLift.toFixed(1)} uniqueness)`
                : "No Remix Available"
            }
          />
        )}
        {uniquenessSuggestions.length > 0 && (
          <div className="mb-6 px-3 py-2 rounded-lg border border-brand-100 bg-brand-50/50 text-xs text-brand-800">
            Predicted uniqueness after recommended remix: {uniquenessSuggestions[0].predictedMin.toFixed(1)}-{uniquenessSuggestions[0].predictedMax.toFixed(1)} / 5
            {" · "}Most likely {uniquenessSuggestions[0].predictedMostLikely.toFixed(1)} / 5
          </div>
        )}

        {/* Action plan stays near the top so it isn't buried under deep-dive tabs */}
        {nextSteps && scan.readinessScore && (
          <div className="mb-6">
            <NextStepsCard
              steps={nextSteps}
              grade={scan.readinessScore.grade}
              onRescanStep={handleRescanStep}
            />
          </div>
        )}
        </ErrorBoundary>

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
        <ErrorBoundary>
        {activeTab === "landscape" && scan.competitors.length > 0 && (
          <LandscapeTab
            competitors={scan.competitors}
            crowdednessIndex={scan.crowdednessIndex}
            totalFunding={scan.totalFundingInSpace}
            evidence={evidenceConfidence}
          />
        )}
        {activeTab === "gaps" && scan.gapAnalysis && <GapsTab gapAnalysis={scan.gapAnalysis} />}
        {activeTab === "dd_report" && scan.ddReport && (
          <DDReportTab ddReport={scan.ddReport} crowdednessIndex={scan.crowdednessIndex} />
        )}
        {activeTab === "pivots" && <PivotsTab pivots={scan.pivotSuggestions} />}
        </ErrorBoundary>

      </main>
    </div>
  )
}
