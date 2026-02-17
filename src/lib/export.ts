import {
  IntentExtraction,
  Competitor,
  GapAnalysis,
  DDReport,
  PivotSuggestion,
} from "@/lib/types"
import { formatCurrency, crowdednessLabel } from "@/lib/utils"

export function exportToMarkdown(data: {
  ideaText: string
  intent: IntentExtraction
  competitors: Competitor[]
  crowdednessIndex: string
  totalFunding: number
  gapAnalysis: GapAnalysis
  ddReport: DDReport
  pivots: PivotSuggestion[]
}): string {
  const lines: string[] = []

  lines.push(`# DeepRecon Report`)
  lines.push(``)
  lines.push(`**Idea:** ${data.ideaText}`)
  lines.push(`**Vertical:** ${data.intent.vertical} | **Category:** ${data.intent.category}`)
  lines.push(`**Generated:** ${new Date().toLocaleDateString()}`)
  lines.push(``)
  lines.push(`---`)
  lines.push(``)

  // Competitive Map
  lines.push(`## Competitive Map`)
  lines.push(``)
  lines.push(`**Crowdedness:** ${crowdednessLabel(data.crowdednessIndex)} (${data.competitors.length} competitors)`)
  if (data.totalFunding > 0) {
    lines.push(`**Total Funding in Space:** ${formatCurrency(data.totalFunding)}`)
  }
  lines.push(``)

  for (const c of data.competitors) {
    lines.push(`### ${c.name} (${c.similarityScore}% match)`)
    lines.push(`${c.description}`)
    const details: string[] = []
    if (c.totalFundingUsd && c.totalFundingUsd > 0) details.push(`Funding: ${formatCurrency(c.totalFundingUsd)}`)
    if (c.lastFundingType && c.lastFundingType !== "unknown") details.push(`Stage: ${c.lastFundingType.replace(/_/g, " ")}`)
    if (c.employeeCountRange) details.push(`Team: ${c.employeeCountRange}`)
    if (details.length > 0) lines.push(`*${details.join(" | ")}*`)
    if (c.topComplaints.length > 0) {
      lines.push(`- **Weaknesses:** ${c.topComplaints.join("; ")}`)
    }
    if (c.keyDifferentiators.length > 0) {
      lines.push(`- **Strengths:** ${c.keyDifferentiators.join("; ")}`)
    }
    lines.push(``)
  }

  // Gap Analysis
  lines.push(`## Gap Analysis`)
  lines.push(``)
  lines.push(`### White Space Opportunities`)
  for (const opp of data.gapAnalysis.whiteSpaceOpportunities) {
    lines.push(`- **${opp.opportunity}** (${opp.potentialImpact} impact): ${opp.evidence}`)
  }
  lines.push(``)
  lines.push(`### Common Complaints`)
  for (const c of data.gapAnalysis.commonComplaints) {
    lines.push(`- **${c.complaint}** (${c.frequency.replace(/_/g, " ")}): affects ${c.competitors.join(", ")}`)
  }
  lines.push(``)
  lines.push(`### Unserved Segments`)
  for (const s of data.gapAnalysis.unservedSegments) {
    lines.push(`- **${s.segment}**: ${s.description} — ${s.whyUnserved}`)
  }
  lines.push(``)

  // DD Report
  lines.push(`## Due Diligence Report`)
  lines.push(``)

  lines.push(`### Ideal Customer Profile`)
  lines.push(data.ddReport.idealCustomerProfile.summary)
  lines.push(`- **Demographics:** ${data.ddReport.idealCustomerProfile.demographics}`)
  lines.push(`- **Psychographics:** ${data.ddReport.idealCustomerProfile.psychographics}`)
  lines.push(`- **Behaviors:** ${data.ddReport.idealCustomerProfile.behaviors}`)
  lines.push(`- **Willingness to Pay:** ${data.ddReport.idealCustomerProfile.willingness_to_pay}`)
  lines.push(`- **Pain Points:** ${data.ddReport.idealCustomerProfile.painPoints.join("; ")}`)
  lines.push(``)

  lines.push(`### Problem Severity: ${data.ddReport.problemSeverity.score}/10`)
  lines.push(`- **Frequency:** ${data.ddReport.problemSeverity.frequency}`)
  lines.push(`- **Alternatives:** ${data.ddReport.problemSeverity.alternatives}`)
  lines.push(`- **Evidence:** ${data.ddReport.problemSeverity.evidenceSummary}`)
  lines.push(``)

  lines.push(`### Wedge Strategy`)
  lines.push(`> ${data.ddReport.wedgeStrategy.wedge}`)
  lines.push(`- **Why it works:** ${data.ddReport.wedgeStrategy.whyThisWorks}`)
  lines.push(`- **First customers:** ${data.ddReport.wedgeStrategy.firstCustomers}`)
  lines.push(`- **Expansion path:** ${data.ddReport.wedgeStrategy.expansionPath}`)
  lines.push(``)

  lines.push(`### Market Sizing`)
  lines.push(`| | Value | Methodology |`)
  lines.push(`|---|---|---|`)
  lines.push(`| TAM | ${data.ddReport.tamSamSom.tam.value} | ${data.ddReport.tamSamSom.tam.methodology} |`)
  lines.push(`| SAM | ${data.ddReport.tamSamSom.sam.value} | ${data.ddReport.tamSamSom.sam.methodology} |`)
  lines.push(`| SOM | ${data.ddReport.tamSamSom.som.value} | ${data.ddReport.tamSamSom.som.methodology} |`)
  lines.push(``)

  lines.push(`### Business Model`)
  lines.push(`- **Model:** ${data.ddReport.businessModel.recommendedModel}`)
  lines.push(`- **Pricing:** ${data.ddReport.businessModel.pricingStrategy}`)
  lines.push(`- **Unit Economics:** ${data.ddReport.businessModel.unitEconomics}`)
  lines.push(`- **Comparables:** ${data.ddReport.businessModel.comparables}`)
  lines.push(``)

  lines.push(`### Defensibility`)
  lines.push(`- **Moat Type:** ${data.ddReport.defensibility.moatType}`)
  lines.push(`- **Time to Moat:** ${data.ddReport.defensibility.timeToMoat}`)
  lines.push(`- **Strength:** ${data.ddReport.defensibility.strengthAssessment}`)
  lines.push(`- **Risks:** ${data.ddReport.defensibility.risks}`)
  lines.push(``)

  lines.push(`### Go-to-Market`)
  for (const ch of data.ddReport.goToMarket.channels) {
    lines.push(`- **${ch.channel}** (est. CAC: ${ch.estimatedCac}): ${ch.rationale}`)
  }
  lines.push(`- **First Milestone:** ${data.ddReport.goToMarket.firstMilestone}`)
  lines.push(``)

  lines.push(`### Risks & Mitigations`)
  for (const r of data.ddReport.risksMitigations) {
    lines.push(`- **${r.risk}** [${r.likelihood} likelihood / ${r.impact} impact]: ${r.mitigation}`)
  }
  lines.push(``)

  // Porter's Five Forces
  if (data.ddReport.portersFiveForces) {
    const p = data.ddReport.portersFiveForces
    lines.push(`### Porter's Five Forces`)
    lines.push(`| Force | Level | Reasoning |`)
    lines.push(`|---|---|---|`)
    lines.push(`| Competitive Rivalry | ${p.competitiveRivalry?.intensity} | ${p.competitiveRivalry?.reasoning} |`)
    lines.push(`| Threat of New Entrants | ${p.threatOfNewEntrants?.level} | ${p.threatOfNewEntrants?.reasoning} |`)
    lines.push(`| Threat of Substitutes | ${p.threatOfSubstitutes?.level} | ${p.threatOfSubstitutes?.reasoning} |`)
    lines.push(`| Buyer Power | ${p.buyerPower?.level} | ${p.buyerPower?.reasoning} |`)
    lines.push(`| Supplier Power | ${p.supplierPower?.level} | ${p.supplierPower?.reasoning} |`)
    lines.push(``)
    lines.push(`**Overall Attractiveness:** ${p.overallAttractiveness}`)
    lines.push(``)
  }

  // Jobs to Be Done
  if (data.ddReport.jobsToBeDone) {
    const j = data.ddReport.jobsToBeDone
    lines.push(`### Jobs to Be Done`)
    lines.push(`> ${j.primaryJob}`)
    lines.push(`- **Functional:** ${j.functionalAspects}`)
    lines.push(`- **Emotional:** ${j.emotionalAspects}`)
    lines.push(`- **Social:** ${j.socialAspects}`)
    if (Array.isArray(j.currentHiredSolutions)) {
      lines.push(`- **Currently hired solutions:** ${j.currentHiredSolutions.join("; ")}`)
    }
    if (Array.isArray(j.underservedOutcomes)) {
      lines.push(`- **Underserved outcomes:** ${j.underservedOutcomes.join("; ")}`)
    }
    lines.push(``)
  }

  // Strategy Canvas
  if (data.ddReport.strategyCanvas) {
    const s = data.ddReport.strategyCanvas
    lines.push(`### Strategy Canvas (Blue Ocean)`)
    if (Array.isArray(s.competitiveFactors)) {
      lines.push(`| Factor | Your Idea | ${s.competitiveFactors[0]?.competitors?.map((c: { name: string }) => c.name).join(" | ") || "Competitors"} |`)
      lines.push(`|---|---|${s.competitiveFactors[0]?.competitors?.map(() => "---").join("|") || "---"}|`)
      for (const f of s.competitiveFactors) {
        const compScores = Array.isArray(f.competitors) ? f.competitors.map((c: { position: number }) => c.position).join(" | ") : ""
        lines.push(`| ${f.factor} | ${f.yourPosition}/10 | ${compScores} |`)
      }
      lines.push(``)
    }
    if (Array.isArray(s.blueOceanMoves)) {
      lines.push(`**Blue Ocean Moves:**`)
      for (const m of s.blueOceanMoves) {
        lines.push(`- ${m}`)
      }
      lines.push(``)
    }
  }

  // Pivots
  if (data.pivots.length > 0) {
    lines.push(`## Pivot & Differentiation Strategies`)
    lines.push(``)
    for (const [i, p] of data.pivots.entries()) {
      lines.push(`### ${i + 1}. ${p.title} (${p.difficulty} difficulty)`)
      lines.push(p.description)
      lines.push(`- **Why it works:** ${p.whyItWorks}`)
      lines.push(`- **Market size:** ${p.estimatedMarketSize}`)
      lines.push(`- **Adjacent examples:** ${p.adjacentExamples.join(", ")}`)
      lines.push(``)
    }
  }

  lines.push(`---`)
  lines.push(`*Generated by DeepRecon — know your competition before you build*`)

  return lines.join("\n")
}
