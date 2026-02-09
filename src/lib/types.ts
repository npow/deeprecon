export interface ScanSettings {
  maxCompetitors: number
  depthLevel: "quick" | "standard" | "deep"
}

export const DEFAULT_SETTINGS: ScanSettings = {
  maxCompetitors: 10,
  depthLevel: "standard",
}

export interface ScanRequest {
  ideaText: string
  vertical?: string
  settings?: ScanSettings
}

export interface IntentExtraction {
  keywords: string[]
  vertical: string
  category: string
  searchQueries: string[]
  redditSubreddits: string[]
  oneLinerSummary: string
}

export interface Competitor {
  name: string
  description: string
  websiteUrl?: string
  similarityScore: number
  totalFundingUsd?: number
  lastFundingType?: string
  lastFundingDate?: string
  employeeCountRange?: string
  sentimentScore?: number
  topComplaints: string[]
  keyDifferentiators: string[]
  source: "crunchbase" | "producthunt" | "reddit" | "ai_knowledge"
}

export interface GapAnalysis {
  whiteSpaceOpportunities: {
    opportunity: string
    evidence: string
    potentialImpact: "high" | "medium" | "low"
  }[]
  commonComplaints: {
    complaint: string
    frequency: string
    competitors: string[]
  }[]
  unservedSegments: {
    segment: string
    description: string
    whyUnserved: string
  }[]
}

export interface DDReport {
  idealCustomerProfile: {
    summary: string
    demographics: string
    psychographics: string
    behaviors: string
    painPoints: string[]
    willingness_to_pay: string
  }
  problemSeverity: {
    score: number // 1-10
    frequency: string
    alternatives: string
    evidenceSummary: string
  }
  wedgeStrategy: {
    wedge: string
    whyThisWorks: string
    firstCustomers: string
    expansionPath: string
  }
  tamSamSom: {
    tam: { value: string; methodology: string }
    sam: { value: string; methodology: string }
    som: { value: string; methodology: string }
  }
  businessModel: {
    recommendedModel: string
    pricingStrategy: string
    unitEconomics: string
    comparables: string
  }
  defensibility: {
    moatType: string
    timeToMoat: string
    strengthAssessment: string
    risks: string
  }
  goToMarket: {
    channels: { channel: string; rationale: string; estimatedCac: string }[]
    firstMilestone: string
  }
  risksMitigations: {
    risk: string
    likelihood: "high" | "medium" | "low"
    impact: "high" | "medium" | "low"
    mitigation: string
  }[]
  portersFiveForces: {
    competitiveRivalry: { intensity: string; reasoning: string }
    threatOfNewEntrants: { level: string; reasoning: string }
    threatOfSubstitutes: { level: string; reasoning: string }
    buyerPower: { level: string; reasoning: string }
    supplierPower: { level: string; reasoning: string }
    overallAttractiveness: string
  }
  jobsToBeDone: {
    primaryJob: string
    functionalAspects: string
    emotionalAspects: string
    socialAspects: string
    currentHiredSolutions: string[]
    underservedOutcomes: string[]
  }
  strategyCanvas: {
    competitiveFactors: {
      factor: string
      yourPosition: number // 1-10
      competitors: { name: string; position: number }[]
    }[]
    blueOceanMoves: string[]
  }
}

export interface PivotSuggestion {
  title: string
  description: string
  whyItWorks: string
  estimatedMarketSize: string
  adjacentExamples: string[]
  difficulty: "low" | "medium" | "high"
}

export interface ScanResult {
  id: string
  ideaText: string
  intent: IntentExtraction
  crowdednessIndex: "low" | "moderate" | "high" | "red_ocean"
  competitors: Competitor[]
  totalFundingInSpace: number
  gapAnalysis: GapAnalysis
  ddReport: DDReport
  pivotSuggestions: PivotSuggestion[]
  createdAt: string
}

// SSE event types
export type ScanEvent =
  | { type: "intent_extracted"; data: IntentExtraction }
  | { type: "competitors_found"; data: Competitor[] }
  | { type: "crowdedness_assessed"; data: { index: string; totalFunding: number; count: number } }
  | { type: "gap_analysis_complete"; data: GapAnalysis }
  | { type: "dd_report_section"; data: { section: string; content: unknown } }
  | { type: "dd_report_complete"; data: DDReport }
  | { type: "pivots_generated"; data: PivotSuggestion[] }
  | { type: "scan_complete"; data: { id: string } }
  | { type: "scan_error"; data: { message: string } }
  | { type: "status_update"; data: { stage: string; message: string } }
