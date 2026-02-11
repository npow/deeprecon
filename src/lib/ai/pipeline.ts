import { GoogleGenerativeAI } from "@google/generative-ai"
import {
  IntentExtraction,
  Competitor,
  GapAnalysis,
  DDReport,
  PivotSuggestion,
  ScanSettings,
  DEFAULT_SETTINGS,
  SubCategory,
  SubCategoryPlayer,
} from "@/lib/types"
import {
  INTENT_EXTRACTION_PROMPT,
  COMPETITIVE_ANALYSIS_PROMPT,
  GAP_ANALYSIS_PROMPT,
  DD_REPORT_PROMPT,
  PIVOT_SUGGESTIONS_PROMPT,
  VERTICAL_MAP_PROMPT,
  SUBCATEGORY_ENRICH_PROMPT,
} from "./prompts"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  model: string = "gemini-2.5-flash",
  maxTokens: number = 8192
): Promise<string> {
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  })

  const result = await genModel.generateContent(userMessage)
  const text = result.response.text()
  if (!text) {
    throw new Error("No text response from Gemini")
  }
  return text
}

function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  let raw = codeBlockMatch ? codeBlockMatch[1].trim() : null

  if (!raw) {
    // Try to find raw JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) raw = jsonMatch[0]
  }

  if (!raw) throw new Error("No JSON found in response")

  // Fix common LLM JSON issues: trailing commas before } or ]
  raw = raw.replace(/,\s*([}\]])/g, "$1")

  return raw
}

export async function extractIntent(ideaText: string): Promise<IntentExtraction> {
  const response = await callLLM(
    INTENT_EXTRACTION_PROMPT,
    `Analyze this startup idea:\n\n"${ideaText}"`,
    "gemini-2.5-flash",
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

  const response = await callLLM(
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

  const response = await callLLM(
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

  const response = await callLLM(
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

  const response = await callLLM(
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
    "gemini-2.5-flash",
    4096
  )

  const parsed = JSON.parse(extractJSON(response))
  return parsed.pivotSuggestions || parsed
}

export async function generateVerticalMap(
  verticalName: string,
  verticalDescription: string
): Promise<{
  schemaVersion: number
  totalPlayers: number
  totalFunding: string
  overallCrowdedness: number
  averageOpportunity: number
  megaCategories: import("@/lib/types").MegaCategoryDef[]
  strategyCanvasFactors: string[]
  subCategories: import("@/lib/types").SubCategory[]
}> {
  const response = await callLLM(
    VERTICAL_MAP_PROMPT,
    `Generate a comprehensive landscape map for this vertical:\n\nVERTICAL: ${verticalName}\nDESCRIPTION: ${verticalDescription}`,
    "gemini-2.5-flash",
    65536
  )
  return JSON.parse(extractJSON(response))
}

export async function enrichSubCategory(
  verticalName: string,
  subCategory: SubCategory,
  strategyCanvasFactors: string[]
): Promise<{ newPlayers: SubCategoryPlayer[]; updatedPlayers: SubCategoryPlayer[] }> {
  const existingNames = subCategory.topPlayers.map((p) => p.name).join(", ")

  const response = await callLLM(
    SUBCATEGORY_ENRICH_PROMPT,
    `VERTICAL: ${verticalName}

SUB-CATEGORY: ${subCategory.name}
DESCRIPTION: ${subCategory.description}
KEY GAPS: ${subCategory.keyGaps.join("; ")}

STRATEGY CANVAS FACTORS (use these exact factor names): ${strategyCanvasFactors.join(", ")}

EXISTING PLAYERS (do NOT re-list these as new):
${existingNames}

Find additional players in this sub-category that are NOT in the existing list above.`,
    "gemini-2.5-flash",
    16384
  )

  return JSON.parse(extractJSON(response))
}
