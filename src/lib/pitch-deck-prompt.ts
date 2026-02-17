import type { SavedScan } from "./types"
import { formatCurrency, crowdednessLabel, safeArray } from "./utils"

export function buildPitchDeckPrompt(scan: SavedScan): { prompt: string; title: string } {
  const dd = scan.ddReport
  const gap = scan.gapAnalysis
  const intent = scan.intent
  const competitors = safeArray(scan.competitors)
  const topCompetitors = competitors.slice(0, 5)

  const title = `${intent.vertical}: ${scan.ideaText.slice(0, 60)}`

  // Format competitor data
  const competitorLines = topCompetitors
    .map((c) => {
      const parts = [`${c.name} (${c.similarityScore ?? 0}% similar)`]
      if (c.totalFundingUsd && c.totalFundingUsd > 0) parts.push(`Funding: ${formatCurrency(c.totalFundingUsd)}`)
      if (c.employeeCountRange) parts.push(`Team: ${c.employeeCountRange}`)
      if (c.description) parts.push(c.description)
      return `- ${parts.join(" | ")}`
    })
    .join("\n")

  // Format GTM channels
  const gtmChannels = safeArray(dd.goToMarket.channels)
    .map((ch) => `- ${ch.channel} (est. CAC: ${ch.estimatedCac}): ${ch.rationale}`)
    .join("\n")

  // Format risks
  const risks = safeArray(dd.risksMitigations)
    .slice(0, 3)
    .map((r) => `- ${r.risk} [${r.likelihood} likelihood / ${r.impact} impact]: ${r.mitigation}`)
    .join("\n")

  // Format white space opportunities
  const whiteSpace = safeArray(gap.whiteSpaceOpportunities)
    .slice(0, 3)
    .map((o) => `- ${o.opportunity} (${o.potentialImpact} impact)`)
    .join("\n")

  // Pain points
  const painPoints = safeArray(dd.idealCustomerProfile.painPoints).slice(0, 4).join("; ")

  const prompt = `Create a 10-slide investor pitch deck presentation with a modern dark theme, bold typography, data visualizations, and clean layouts. Use icons and charts where appropriate. Make it visually polished and professional.

Here is the data for the pitch deck:

SLIDE 1 — TITLE
Company/Idea: ${scan.ideaText}
One-liner: ${intent.oneLinerSummary}
Vertical: ${intent.vertical} | Category: ${intent.category}

SLIDE 2 — THE PROBLEM
Problem Severity Score: ${dd.problemSeverity.score}/10
Frequency: ${dd.problemSeverity.frequency}
Current Alternatives: ${dd.problemSeverity.alternatives}
Evidence: ${dd.problemSeverity.evidenceSummary}
Target Customer Pain Points: ${painPoints}
ICP Summary: ${dd.idealCustomerProfile.summary}

SLIDE 3 — THE SOLUTION
${scan.ideaText}
Wedge Strategy: ${dd.wedgeStrategy.wedge}
Why It Works: ${dd.wedgeStrategy.whyThisWorks}
First Customers: ${dd.wedgeStrategy.firstCustomers}
Key White Space Opportunities:
${whiteSpace}

SLIDE 4 — MARKET SIZE
TAM: ${dd.tamSamSom.tam.value} (${dd.tamSamSom.tam.methodology})
SAM: ${dd.tamSamSom.sam.value} (${dd.tamSamSom.sam.methodology})
SOM: ${dd.tamSamSom.som.value} (${dd.tamSamSom.som.methodology})
Show this as a nested circles or funnel visualization.

SLIDE 5 — COMPETITIVE LANDSCAPE
Crowdedness: ${crowdednessLabel(scan.crowdednessIndex)} (${competitors.length} competitors found)
Total Funding in Space: ${scan.totalFundingInSpace > 0 ? formatCurrency(scan.totalFundingInSpace) : "N/A"}
Top Competitors:
${competitorLines}
Show a competitive positioning chart or comparison table.

SLIDE 6 — BUSINESS MODEL
Recommended Model: ${dd.businessModel.recommendedModel}
Pricing Strategy: ${dd.businessModel.pricingStrategy}
Unit Economics: ${dd.businessModel.unitEconomics}
Comparables: ${dd.businessModel.comparables}

SLIDE 7 — GO-TO-MARKET STRATEGY
Channels:
${gtmChannels}
First Milestone: ${dd.goToMarket.firstMilestone}
Expansion Path: ${dd.wedgeStrategy.expansionPath}

SLIDE 8 — DEFENSIBILITY & MOAT
Moat Type: ${dd.defensibility.moatType}
Time to Build Moat: ${dd.defensibility.timeToMoat}
Strength Assessment: ${dd.defensibility.strengthAssessment}
Key Risks to Moat: ${dd.defensibility.risks}

SLIDE 9 — RISKS & MITIGATIONS
${risks}

SLIDE 10 — THE ASK
This is a placeholder slide for the funding ask. Include:
- "The Ask" as the title
- Placeholder text: "[Funding amount] to achieve [key milestones]"
- A bullet list placeholder for use of funds
- Contact information placeholder

Make sure each slide has a clear title, is visually distinct, and uses data visualizations (charts, graphs, icons) wherever possible. The overall theme should be dark with accent colors that convey professionalism and innovation.`

  return { prompt, title }
}
