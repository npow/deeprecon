import Anthropic from "@anthropic-ai/sdk"
import {
  IntentExtraction,
  Competitor,
  GapAnalysis,
  DDReport,
  PivotSuggestion,
  ScanSettings,
  DEFAULT_SETTINGS,
} from "@/lib/types"
import {
  INTENT_EXTRACTION_PROMPT,
  COMPETITIVE_ANALYSIS_PROMPT,
  GAP_ANALYSIS_PROMPT,
  DD_REPORT_PROMPT,
  PIVOT_SUGGESTIONS_PROMPT,
  VERTICAL_MAP_PROMPT,
} from "./prompts"

const client = new Anthropic()

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  model: string = "claude-sonnet-4-5-20250929",
  maxTokens: number = 8192
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: userMessage }],
    system: systemPrompt,
  })

  const textBlock = response.content.find((block) => block.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude")
  }
  return textBlock.text
}

function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlockMatch) return codeBlockMatch[1].trim()

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) return jsonMatch[0]

  throw new Error("No JSON found in response")
}

export async function extractIntent(ideaText: string): Promise<IntentExtraction> {
  const response = await callClaude(
    INTENT_EXTRACTION_PROMPT,
    `Analyze this startup idea:\n\n"${ideaText}"`,
    "claude-haiku-4-5-20251001",
    1024
  )
  return JSON.parse(extractJSON(response))
}

export async function analyzeCompetition(
  ideaText: string,
  intent: IntentExtraction,
  settings: ScanSettings = DEFAULT_SETTINGS
): Promise<{
  competitors: Competitor[]
  crowdednessIndex: "low" | "moderate" | "high" | "red_ocean"
  totalFundingInSpace: number
}> {
  const depthInstruction = settings.depthLevel === "quick"
    ? "Be concise. Include 3-5 most relevant competitors only."
    : settings.depthLevel === "deep"
      ? `Be exhaustive. Include up to ${settings.maxCompetitors} competitors — direct, indirect, and adjacent players. Provide maximum detail per competitor.`
      : `Include up to ${settings.maxCompetitors} competitors, prioritized by similarity score.`

  const response = await callClaude(
    COMPETITIVE_ANALYSIS_PROMPT + `\n\nADDITIONAL INSTRUCTIONS: ${depthInstruction}`,
    `STARTUP IDEA: "${ideaText}"

EXTRACTED INTENT:
- Vertical: ${intent.vertical}
- Category: ${intent.category}
- Keywords: ${intent.keywords.join(", ")}
- Search queries: ${intent.searchQueries.join("; ")}
- One-liner: ${intent.oneLinerSummary}`
  )
  return JSON.parse(extractJSON(response))
}

export async function analyzeGaps(
  ideaText: string,
  intent: IntentExtraction,
  competitors: Competitor[]
): Promise<GapAnalysis> {
  const competitorSummary = competitors
    .slice(0, 10)
    .map(
      (c) =>
        `- ${c.name} (Similarity: ${c.similarityScore}%, Funding: $${c.totalFundingUsd || "unknown"}): ${c.description}. Complaints: ${c.topComplaints.join("; ")}. Differentiators: ${c.keyDifferentiators.join("; ")}`
    )
    .join("\n")

  const response = await callClaude(
    GAP_ANALYSIS_PROMPT,
    `STARTUP IDEA: "${ideaText}"
ONE-LINER: ${intent.oneLinerSummary}
VERTICAL: ${intent.vertical}

COMPETITIVE LANDSCAPE:
${competitorSummary}`
  )
  return JSON.parse(extractJSON(response))
}

export async function generateDDReport(
  ideaText: string,
  intent: IntentExtraction,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis
): Promise<DDReport> {
  const competitorSummary = competitors
    .slice(0, 10)
    .map(
      (c) =>
        `- ${c.name}: ${c.description} | Funding: $${c.totalFundingUsd || "unknown"} (${c.lastFundingType}) | Employees: ${c.employeeCountRange} | Sentiment: ${c.sentimentScore} | Complaints: ${c.topComplaints.join("; ")}`
    )
    .join("\n")

  const gapSummary = gapAnalysis.whiteSpaceOpportunities
    .map((g) => `- ${g.opportunity} (${g.potentialImpact} impact): ${g.evidence}`)
    .join("\n")

  const response = await callClaude(
    DD_REPORT_PROMPT,
    `STARTUP IDEA: "${ideaText}"
ONE-LINER: ${intent.oneLinerSummary}
VERTICAL: ${intent.vertical}
CATEGORY: ${intent.category}

COMPETITIVE LANDSCAPE (${competitors.length} competitors found):
${competitorSummary}

WHITE SPACE OPPORTUNITIES:
${gapSummary}

UNSERVED SEGMENTS:
${gapAnalysis.unservedSegments.map((s) => `- ${s.segment}: ${s.description} (${s.whyUnserved})`).join("\n")}`
  )
  return JSON.parse(extractJSON(response))
}

export async function generatePivots(
  ideaText: string,
  intent: IntentExtraction,
  competitors: Competitor[],
  gapAnalysis: GapAnalysis,
  crowdednessIndex: string
): Promise<PivotSuggestion[]> {
  const competitorSummary = competitors
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.name} (${c.similarityScore}% similar, $${c.totalFundingUsd || "?"} raised): ${c.description}. Weaknesses: ${c.topComplaints.join("; ")}`
    )
    .join("\n")

  const gaps = gapAnalysis.whiteSpaceOpportunities
    .map((g) => `- ${g.opportunity}: ${g.evidence}`)
    .join("\n")

  const response = await callClaude(
    PIVOT_SUGGESTIONS_PROMPT,
    `STARTUP IDEA: "${ideaText}"
ONE-LINER: ${intent.oneLinerSummary}
VERTICAL: ${intent.vertical}
CROWDEDNESS: ${crowdednessIndex}

COMPETITORS:
${competitorSummary}

IDENTIFIED GAPS:
${gaps}

UNSERVED SEGMENTS:
${gapAnalysis.unservedSegments.map((s) => `- ${s.segment}: ${s.whyUnserved}`).join("\n")}`,
    "claude-sonnet-4-5-20250929",
    4096
  )

  const parsed = JSON.parse(extractJSON(response))
  return parsed.pivotSuggestions || parsed
}

export async function generateVerticalMap(
  verticalName: string,
  verticalDescription: string
): Promise<{
  totalPlayers: number
  totalFunding: string
  overallCrowdedness: number
  averageOpportunity: number
  subCategories: import("@/lib/types").SubCategory[]
}> {
  const response = await callClaude(
    VERTICAL_MAP_PROMPT,
    `Generate a comprehensive landscape map for this vertical:\n\nVERTICAL: ${verticalName}\nDESCRIPTION: ${verticalDescription}`,
    "claude-sonnet-4-5-20250929",
    8192
  )
  return JSON.parse(extractJSON(response))
}
