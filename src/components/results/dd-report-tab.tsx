"use client"

import { DDReport } from "@/lib/types"
import { stringify, safeArray, flattenNumericKeys, formatMarketSize } from "@/lib/utils"
import { RichText } from "./rich-text"
import {
  Target,
  Flame,
  Crosshair,
  BarChart3,
  DollarSign,
  Shield,
  Rocket,
  AlertTriangle,
  Factory,
  Briefcase,
  Map,
} from "lucide-react"
import { simulateRevenue } from "@/lib/revenue-sim"
import { RevenueSimCard } from "./revenue-sim-card"

interface DDReportTabProps {
  ddReport: DDReport
  crowdednessIndex?: string
}

function forceLevelBadge(level: string, color: "red" | "orange" | "yellow" | "blue" | "purple"): string {
  const normalized = level.toLowerCase()
  if (normalized === "high" || normalized === "intense") {
    switch (color) {
      case "red": return "bg-red-100 text-red-700"
      case "orange": return "bg-orange-100 text-orange-700"
      case "yellow": return "bg-amber-100 text-amber-700"
      case "blue": return "bg-blue-100 text-blue-700"
      case "purple": return "bg-purple-100 text-purple-700"
    }
  }
  if (normalized === "medium") return "bg-yellow-100 text-yellow-700"
  return "bg-green-100 text-green-700"
}

function Section({
  icon,
  title,
  children,
  index,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  index: number
}) {
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-5 animate-slide-up"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  )
}

function LabelValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mb-2">
      <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">{label}</span>
      <RichText className="text-sm text-gray-700 mt-1 leading-relaxed break-words" value={value} />
    </div>
  )
}

export function DDReportTab({ ddReport: rawDdReport, crowdednessIndex }: DDReportTabProps) {
  const ddReport = flattenNumericKeys(rawDdReport) as DDReport
  const revSim = simulateRevenue(ddReport, crowdednessIndex || "moderate")

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ICP */}
      {ddReport.idealCustomerProfile && (
      <Section icon={<Target className="h-5 w-5 text-brand-500" />} title="Ideal Customer Profile" index={0}>
        <RichText className="text-sm text-gray-700 mb-3 leading-relaxed break-words" value={ddReport.idealCustomerProfile.summary} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabelValue label="Demographics" value={ddReport.idealCustomerProfile.demographics} />
          <LabelValue label="Psychographics" value={ddReport.idealCustomerProfile.psychographics} />
          <LabelValue label="Behaviors" value={ddReport.idealCustomerProfile.behaviors} />
          <LabelValue
            label="Willingness to Pay"
            value={ddReport.idealCustomerProfile.willingness_to_pay}
          />
        </div>
        <div className="mt-3">
          <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">
            Key Pain Points
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {safeArray(ddReport.idealCustomerProfile?.painPoints).map((point, i) => (
              <span
                key={i}
                className="inline-block text-xs bg-red-50 text-red-700 px-2.5 py-1 rounded-full"
              >
                {stringify(point)}
              </span>
            ))}
          </div>
        </div>
      </Section>
      )}

      {/* Problem Severity */}
      {ddReport.problemSeverity && (
      <Section icon={<Flame className="h-5 w-5 text-orange-500" />} title="Problem Severity" index={1}>
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-6 rounded-sm ${
                    i < (ddReport.problemSeverity?.score ?? 0)
                      ? (ddReport.problemSeverity?.score ?? 0) >= 8
                        ? "bg-red-500"
                        : (ddReport.problemSeverity?.score ?? 0) >= 5
                          ? "bg-orange-400"
                          : "bg-yellow-400"
                      : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
            <span className="text-lg font-bold text-gray-900">
              {ddReport.problemSeverity?.score ?? 0}/10
            </span>
          </div>
        </div>
        <LabelValue label="Frequency" value={ddReport.problemSeverity?.frequency} />
        <LabelValue label="Current Alternatives" value={ddReport.problemSeverity?.alternatives} />
        <LabelValue label="Evidence" value={ddReport.problemSeverity?.evidenceSummary} />
      </Section>
      )}

      {/* Wedge Strategy */}
      {ddReport.wedgeStrategy && (
      <Section icon={<Crosshair className="h-5 w-5 text-purple-500" />} title="Wedge Strategy" index={2}>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
          <RichText className="text-sm font-medium text-purple-900 leading-relaxed break-words" value={ddReport.wedgeStrategy?.wedge} />
        </div>
        <LabelValue label="Why This Works" value={ddReport.wedgeStrategy?.whyThisWorks} />
        <LabelValue label="First Customers" value={ddReport.wedgeStrategy?.firstCustomers} />
        <LabelValue label="Expansion Path" value={ddReport.wedgeStrategy?.expansionPath} />
      </Section>
      )}

      {/* TAM/SAM/SOM */}
      {ddReport.tamSamSom && (
      <Section icon={<BarChart3 className="h-5 w-5 text-green-500" />} title="Market Sizing (TAM/SAM/SOM)" index={3}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["tam", "sam", "som"] as const).map((key) => {
            const label = key.toUpperCase()
            const data = ddReport.tamSamSom?.[key]
            return (
              <div key={key} className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wider text-center">{label}</div>
                <div className="text-xl font-bold text-gray-900 mt-1 text-center">{formatMarketSize(data?.value)}</div>
                <details className="mt-2 pt-2 border-t border-gray-200 group">
                  <summary className="cursor-pointer list-none text-[10px] uppercase tracking-wider text-gray-500 font-medium select-none">
                    View calculation details
                  </summary>
                  <RichText className="mt-2 text-xs text-gray-600 leading-relaxed break-words" value={data?.methodology} />
                </details>
              </div>
            )
          })}
        </div>
      </Section>
      )}

      {/* Revenue Simulation */}
      <RevenueSimCard sim={revSim} />

      {/* Business Model */}
      {ddReport.businessModel && (
      <Section icon={<DollarSign className="h-5 w-5 text-green-600" />} title="Business Model" index={4}>
        <LabelValue label="Recommended Model" value={ddReport.businessModel?.recommendedModel} />
        <LabelValue label="Pricing Strategy" value={ddReport.businessModel?.pricingStrategy} />
        <LabelValue label="Unit Economics" value={ddReport.businessModel?.unitEconomics} />
        <LabelValue label="Comparables" value={ddReport.businessModel?.comparables} />
      </Section>
      )}

      {/* Defensibility */}
      {ddReport.defensibility && (
      <Section icon={<Shield className="h-5 w-5 text-blue-500" />} title="Defensibility & Moat" index={5}>
        <LabelValue label="Moat Type" value={ddReport.defensibility?.moatType} />
        <LabelValue label="Time to Moat" value={ddReport.defensibility?.timeToMoat} />
        <LabelValue label="Strength Assessment" value={ddReport.defensibility?.strengthAssessment} />
        <LabelValue label="Risks to Moat" value={ddReport.defensibility?.risks} />
      </Section>
      )}

      {/* GTM */}
      {ddReport.goToMarket && (
      <Section icon={<Rocket className="h-5 w-5 text-brand-500" />} title="Go-to-Market" index={6}>
        <div className="space-y-3 mb-3">
          {safeArray(ddReport.goToMarket?.channels).map((channel, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900"><RichText inline value={channel.channel} /></p>
                  <RichText className="text-xs text-gray-500 mt-0.5 leading-relaxed break-words" value={channel.rationale} />
                </div>
                <span className="text-xs font-medium text-gray-600 bg-white px-2 py-1 rounded-full border">
                  CAC: {stringify(channel.estimatedCac)}
                </span>
              </div>
            </div>
          ))}
        </div>
        <LabelValue label="First Milestone" value={ddReport.goToMarket?.firstMilestone} />
      </Section>
      )}

      {/* Risks */}
      <Section icon={<AlertTriangle className="h-5 w-5 text-red-500" />} title="Risks & Mitigations" index={7}>
        <div className="space-y-3">
          {safeArray(ddReport.risksMitigations).map((risk, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between mb-1">
                <p className="text-sm font-medium text-gray-900"><RichText inline value={risk.risk} /></p>
                <div className="flex gap-1.5 flex-shrink-0 ml-2">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      risk.likelihood === "high"
                        ? "bg-red-100 text-red-700"
                        : risk.likelihood === "medium"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                    }`}
                  >
                    {risk.likelihood} likelihood
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      risk.impact === "high"
                        ? "bg-red-100 text-red-700"
                        : risk.impact === "medium"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                    }`}
                  >
                    {risk.impact} impact
                  </span>
                </div>
              </div>
              <RichText className="text-xs text-gray-500 leading-relaxed break-words" value={risk.mitigation} />
            </div>
          ))}
        </div>
      </Section>

      {/* Porter's Five Forces */}
      {ddReport.portersFiveForces && (
        <Section icon={<Factory className="h-5 w-5 text-indigo-500" />} title="Porter's Five Forces" index={8}>
          <div className="space-y-3">
            {([
              { key: "competitiveRivalry", label: "Competitive Rivalry", color: "red" },
              { key: "threatOfNewEntrants", label: "Threat of New Entrants", color: "orange" },
              { key: "threatOfSubstitutes", label: "Threat of Substitutes", color: "yellow" },
              { key: "buyerPower", label: "Buyer Power", color: "blue" },
              { key: "supplierPower", label: "Supplier Power", color: "purple" },
            ] as const).map(({ key, label, color }) => {
              const force = ddReport.portersFiveForces[key]
              if (!force) return null
              const level = stringify(
                "intensity" in force ? force.intensity : "level" in force ? force.level : ""
              )
              return (
                <div key={key} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-1 rounded flex-shrink-0 mt-0.5 ${forceLevelBadge(level, color)}`}
                  >
                    {level}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <RichText className="text-xs text-gray-500 mt-0.5 leading-relaxed break-words" value={force.reasoning} />
                  </div>
                </div>
              )
            })}
          </div>
          {ddReport.portersFiveForces.overallAttractiveness && (
            <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              <span className="text-[10px] uppercase tracking-wider text-indigo-600 font-medium">Overall Industry Attractiveness</span>
              <RichText className="text-sm text-indigo-900 mt-1 leading-relaxed break-words" value={ddReport.portersFiveForces.overallAttractiveness} />
            </div>
          )}
        </Section>
      )}

      {/* Jobs to Be Done */}
      {ddReport.jobsToBeDone && (
        <Section icon={<Briefcase className="h-5 w-5 text-amber-500" />} title="Jobs to Be Done" index={9}>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
            <span className="text-[10px] uppercase tracking-wider text-amber-600 font-medium">Primary Job</span>
            <RichText className="text-sm font-medium text-amber-900 mt-1 leading-relaxed break-words" value={ddReport.jobsToBeDone.primaryJob} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Functional</span>
              <RichText className="text-xs text-gray-700 mt-1 leading-relaxed break-words" value={ddReport.jobsToBeDone.functionalAspects} />
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Emotional</span>
              <RichText className="text-xs text-gray-700 mt-1 leading-relaxed break-words" value={ddReport.jobsToBeDone.emotionalAspects} />
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Social</span>
              <RichText className="text-xs text-gray-700 mt-1 leading-relaxed break-words" value={ddReport.jobsToBeDone.socialAspects} />
            </div>
          </div>
          {Array.isArray(ddReport.jobsToBeDone.currentHiredSolutions) && (
            <div className="mb-3">
              <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">Currently Hired Solutions</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {ddReport.jobsToBeDone.currentHiredSolutions.map((s, i) => (
                  <span key={i} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">{stringify(s)}</span>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(ddReport.jobsToBeDone.underservedOutcomes) && (
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">Underserved Outcomes</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {ddReport.jobsToBeDone.underservedOutcomes.map((o, i) => (
                  <span key={i} className="text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">{stringify(o)}</span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Strategy Canvas */}
      {ddReport.strategyCanvas && (
        <Section icon={<Map className="h-5 w-5 text-teal-500" />} title="Strategy Canvas (Blue Ocean)" index={10}>
          {Array.isArray(ddReport.strategyCanvas.competitiveFactors) && (
            <div className="space-y-2 mb-4">
              {/* Header */}
              <div className="grid grid-cols-[1fr_80px_1fr] gap-2 text-[10px] uppercase tracking-wider text-gray-400 font-medium px-1">
                <span>Factor</span>
                <span className="text-center">Your idea</span>
                <span>Competitors</span>
              </div>
              {ddReport.strategyCanvas.competitiveFactors.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center bg-gray-50 rounded-lg p-2">
                  <span className="text-xs font-medium text-gray-900"><RichText inline value={f.factor} /></span>
                  <div className="flex items-center justify-center gap-1">
                    <div className="w-full bg-gray-200 rounded-full h-2 max-w-[48px]">
                      <div
                        className="bg-teal-500 h-2 rounded-full"
                        style={{ width: `${(Number(f.yourPosition) || 0) * 10}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-teal-700 w-4">{f.yourPosition}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Array.isArray(f.competitors) && f.competitors.map((c, j) => (
                      <span key={j} className="text-[10px] text-gray-500">
                        <RichText inline value={c.name} />: <span className="font-bold">{c.position}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {Array.isArray(ddReport.strategyCanvas.blueOceanMoves) && ddReport.strategyCanvas.blueOceanMoves.length > 0 && (
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">Blue Ocean Moves</span>
              <div className="space-y-1.5 mt-2">
                {ddReport.strategyCanvas.blueOceanMoves.map((move, i) => (
                  <div key={i} className="text-xs bg-teal-50 text-teal-800 px-3 py-2 rounded-lg leading-relaxed break-words"><RichText value={move} /></div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
