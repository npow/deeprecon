export type WebsiteStatus = "verified" | "dead" | "parked" | "mismatch" | "unknown"
export type ConfidenceLevel = "web_verified" | "multi_confirmed" | "ai_inferred"

export interface ScanSettings {
  maxCompetitors: number
  depthLevel: "quick" | "standard" | "deep"
  workflowMode: "founder" | "investor"
  experimentVariants: number
}

export const DEFAULT_SETTINGS: ScanSettings = {
  maxCompetitors: 10,
  depthLevel: "standard",
  workflowMode: "founder",
  experimentVariants: 3,
}

export interface ScanRequest {
  ideaText: string
  vertical?: string
  settings?: ScanSettings
  remix?: {
    parentScanId: string
    remixType?: ScanRemixType
    remixLabel?: string
  }
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
  id?: string                 // stable UUID — for DB PK
  name: string
  description: string
  websiteUrl?: string
  linkedinUrl?: string
  crunchbaseUrl?: string
  similarityScore: number
  totalFundingUsd?: number
  lastFundingType?: string
  lastFundingDate?: string
  employeeCountRange?: string
  yearFounded?: number
  headquartersLocation?: string
  pricingModel?: string       // e.g. "freemium", "usage-based", "enterprise"
  targetCustomer?: string     // e.g. "SMB", "mid-market", "enterprise"
  logoUrl?: string
  sentimentScore?: number
  topComplaints: string[]
  keyDifferentiators: string[]
  tags?: string[]             // faceted search labels
  source: "crunchbase" | "producthunt" | "reddit" | "ai_knowledge" | "web_search"
  discoveredBy?: string       // which model/provider found this
  discoveredAt?: string       // ISO timestamp
  websiteStatus?: WebsiteStatus
  websiteStatusReason?: string
  confirmedBy?: string[]
  confirmedByCount?: number
  confidenceLevel?: ConfidenceLevel
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

// ─── Market Maps ───

export interface SubCategoryPlayer {
  id?: string                // stable UUID — for DB PK
  name: string
  oneLiner: string
  funding: string            // formatted string e.g. "$50M"
  totalFundingUsd?: number   // raw numeric value for sorting/filtering
  stage: string
  lastFundingDate?: string
  executionScore: number     // 0-100, for Magic Quadrant
  visionScore: number        // 0-100, for Magic Quadrant
  competitiveFactors: { factor: string; score: number }[]  // 1-10, for Strategy Canvas
  websiteUrl?: string
  linkedinUrl?: string
  crunchbaseUrl?: string
  logoUrl?: string
  foundedYear?: number
  headquartersLocation?: string
  employeeCountRange?: string
  pricingModel?: string      // e.g. "freemium", "usage-based", "enterprise"
  targetCustomer?: string    // e.g. "SMB", "mid-market", "enterprise"
  tags?: string[]            // faceted search / cross-subcategory discovery
  similarityScore?: number   // relevance to the scan that discovered it
  source?: string            // provenance: "crunchbase", "web_search", "enrich", etc.
  discoveredAt?: string      // ISO timestamp — when first seen
  updatedAt?: string         // ISO timestamp — last data refresh
  discoveredBy?: string      // model/provider that found it
  websiteStatus?: WebsiteStatus
  websiteStatusReason?: string
  confirmedBy?: string[]
  confirmedByCount?: number
  confidenceLevel?: ConfidenceLevel
}

export interface SubCategory {
  id?: string              // UUID for DB PK (slug used as fallback)
  slug: string
  name: string
  description: string
  crowdednessScore: number // 0-100
  opportunityScore: number // 0-100
  playerCount: number
  totalFunding: string
  trendDirection: "heating_up" | "stable" | "cooling_down"
  topPlayers: SubCategoryPlayer[]
  keyGaps: string[]
  deepDivePrompt: string
  megaCategory: string    // grouping label, e.g. "AI & Automation"
  lastEnrichedAt?: string
  createdAt?: string       // ISO timestamp
  updatedAt?: string       // ISO timestamp
}

export interface MegaCategoryDef {
  name: string
  color: string
}

export interface VerticalMap {
  id?: string              // UUID for DB PK (slug used as fallback)
  slug: string
  name: string
  description: string
  generatedAt: string
  totalPlayers: number
  totalFunding: string
  overallCrowdedness: number // 0-100
  averageOpportunity: number // 0-100
  subCategories: SubCategory[]
  schemaVersion: number
  megaCategories: MegaCategoryDef[]
  strategyCanvasFactors: string[]  // shared factor names
  lastEnrichedAt?: string
  updatedAt?: string       // ISO timestamp
  createdBy?: string       // user/system attribution
}

export interface VerticalDefinition {
  slug: string
  name: string
  description: string
}

export const VERTICALS: VerticalDefinition[] = [
  { slug: "ai-ml", name: "AI & Machine Learning", description: "AI infrastructure, applications, and tooling across all industries" },
  { slug: "fintech", name: "Fintech", description: "Financial technology including payments, banking, lending, insurance, and crypto" },
  { slug: "devtools", name: "Developer Tools", description: "Tools, platforms, and infrastructure for software developers" },
  { slug: "cybersecurity", name: "Cybersecurity", description: "Security tools, platforms, and services for threat detection, prevention, and response" },
  { slug: "healthtech", name: "Healthtech", description: "Digital health, telemedicine, clinical tools, biotech platforms, and health data infrastructure" },
  { slug: "climate-tech", name: "Climate Tech", description: "Carbon capture, clean energy, sustainability software, and environmental monitoring" },
  { slug: "edtech", name: "Edtech", description: "Learning platforms, ed-AI, credentialing, upskilling, and knowledge management tools" },
  { slug: "martech", name: "Martech", description: "Marketing technology including analytics, automation, CRM, ad-tech, and content tools" },
  { slug: "proptech", name: "Proptech", description: "Real estate technology for buying, selling, managing, and financing properties" },
  { slug: "hr-tech", name: "HR Tech", description: "Recruiting, workforce management, payroll, benefits, and employee engagement platforms" },
]

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
  | { type: "map_enriched"; data: { slug: string; subCategory: string; newCount: number; updatedCount: number } }
  | { type: "queue_position"; data: { position: number } }
  | { type: "rate_limited"; data: { retryAfterMs: number; message: string } }

// ─── Saved Scans ───

export interface SavedScan {
  id: string
  ideaText: string
  intent: IntentExtraction
  crowdednessIndex: string
  competitors: Competitor[]
  totalFundingInSpace: number
  gapAnalysis: GapAnalysis
  ddReport: DDReport
  pivotSuggestions: PivotSuggestion[]
  readinessScore: {
    total: number
    grade: string
    breakdown: { factor: string; score: number; max: number; detail: string }[]
    verdict: string
    cloneRisk?: {
      level: "low" | "medium" | "high"
      penalty: number
      reason: string
    }
  }
  lucrativenessScore?: {
    total: number
    tier: "low" | "medium" | "high" | "very_high"
    breakdown: { factor: string; score: number; max: number; detail: string }[]
    verdict: string
  }
  parentScanId?: string
  rootScanId?: string
  remixType?: ScanRemixType
  remixLabel?: string
  remixDepth?: number
  createdAt: string
}

export type ScanRemixType = "uniqueness_suggestion" | "uniqueness_experiment" | "manual_rescan"

export interface SavedScanSummary {
  id: string
  ideaText: string
  vertical: string
  category: string
  score: number
  grade: string
  uniquenessScore?: number
  lucrativenessScore?: number
  lucrativenessTier?: "low" | "medium" | "high" | "very_high"
  crowdednessIndex: string
  parentScanId?: string
  rootScanId?: string
  remixType?: ScanRemixType
  remixLabel?: string
  remixDepth?: number
  createdAt: string
}

// Enrichment SSE events
export type EnrichEvent =
  | { type: "enrich_start"; data: { subSlug: string; subName: string; index: number; total: number } }
  | { type: "enrich_complete"; data: { subSlug: string; newCount: number; updatedCount: number } }
  | { type: "enrich_done"; data: { totalNew: number; totalUpdated: number } }
  | { type: "enrich_error"; data: { message: string; subSlug?: string } }
