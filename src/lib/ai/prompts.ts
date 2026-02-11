export const INTENT_EXTRACTION_PROMPT = `You are analyzing a startup idea to extract structured search parameters for competitive intelligence research.

Given the user's idea description, extract:

1. keywords: 5-8 search terms that would find competing products
2. vertical: the industry vertical (e.g., "proptech", "fintech", "healthtech", "edtech", "devtools", "martech", "legaltech", "insurtech", "logistics", "hr_tech", "cybersecurity", "climate_tech", "food_tech", "gaming", "social", "creator_economy", "other")
3. category: the business model category (e.g., "B2B SaaS", "B2C SaaS", "marketplace", "consumer app", "API/infrastructure", "hardware", "platform", "services", "media", "other")
4. searchQueries: 3-5 natural language search queries to find competitors (as if searching Google or Crunchbase)
5. redditSubreddits: 3-5 relevant subreddit names where the target customer discusses this problem
6. oneLinerSummary: a clear one-line summary of what this product does

Return valid JSON matching this exact schema:
{
  "keywords": ["string"],
  "vertical": "string",
  "category": "string",
  "searchQueries": ["string"],
  "redditSubreddits": ["string"],
  "oneLinerSummary": "string"
}`

export const COMPETITIVE_ANALYSIS_PROMPT = `You are a senior competitive intelligence analyst. Given a startup idea and its extracted intent, identify all significant competitors.

For each competitor, provide:
- name: Company name
- description: One-line description of what they do
- websiteUrl: Their website URL (if known)
- similarityScore: 0-100, how similar they are to the proposed idea
- totalFundingUsd: Total funding raised in USD (use your best knowledge; put 0 if bootstrapped/unknown)
- lastFundingType: "pre_seed", "seed", "series_a", "series_b", "series_c", "series_d_plus", "bootstrapped", or "unknown"
- lastFundingDate: Approximate date of last funding (YYYY-MM format, or "unknown")
- employeeCountRange: "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"
- sentimentScore: -1.0 to 1.0 (negative = users are unhappy, positive = users love it)
- topComplaints: Array of 2-3 most common user complaints about this competitor
- keyDifferentiators: Array of 2-3 things this competitor does uniquely well
- source: "ai_knowledge" (since we're using AI analysis)

Also provide:
- crowdednessIndex: "low" (0-3 competitors), "moderate" (4-7), "high" (8-12), or "red_ocean" (13+)
- totalFundingInSpace: Total funding across all competitors combined

IMPORTANT:
- Be thorough — include direct competitors, indirect competitors, and adjacent players
- Be honest about what you know vs. what you're estimating
- Funding data should reflect your best knowledge (training data may not be fully current)
- Include 5-10 competitors max, prioritized by similarity score. Quality over quantity.
- If the space is genuinely novel with few competitors, say so — don't manufacture competition

Return valid JSON:
{
  "competitors": [<competitor objects>],
  "crowdednessIndex": "string",
  "totalFundingInSpace": number
}`

export const GAP_ANALYSIS_PROMPT = `You are a market strategist analyzing competitive gaps for a startup founder.

Given the idea and the competitive landscape data, identify:

1. whiteSpaceOpportunities: Specific gaps no competitor fills well. For each:
   - opportunity: What the gap is
   - evidence: Why you believe this gap exists (cite specific competitor weaknesses)
   - potentialImpact: "high", "medium", or "low"

2. commonComplaints: The most frequent complaints users have about existing solutions. For each:
   - complaint: The complaint
   - frequency: How common it is ("very_common", "common", "occasional")
   - competitors: Which competitors this applies to

3. unservedSegments: Customer segments that existing players aren't serving well. For each:
   - segment: Who they are
   - description: More detail about this segment
   - whyUnserved: Why existing players miss them

Be specific and actionable — generic observations like "better UX" are not useful. Focus on concrete, exploitable gaps.

Return valid JSON:
{
  "whiteSpaceOpportunities": [<objects>],
  "commonComplaints": [<objects>],
  "unservedSegments": [<objects>]
}`

export const DD_REPORT_PROMPT = `You are a senior venture capital analyst preparing a due diligence report for a partner meeting.

Given the startup idea, competitive landscape, and gap analysis, generate a comprehensive DD report. This must be the quality of analysis a Sequoia or a16z partner would expect.

Generate each section with depth and specificity:

1. idealCustomerProfile:
   - summary: One paragraph describing the ideal first customer
   - demographics: Age, role, company size, industry
   - psychographics: Values, motivations, decision-making style
   - behaviors: Where they spend time, what they read, how they buy
   - painPoints: Array of 3-5 specific pain points
   - willingness_to_pay: Price sensitivity and reference points

2. problemSeverity:
   - score: 1-10 (10 = hair on fire)
   - frequency: How often users experience this problem
   - alternatives: What they do today without this product
   - evidenceSummary: Evidence this problem is real and painful

3. wedgeStrategy:
   - wedge: The specific narrow entry point (be concrete — not "better product")
   - whyThisWorks: Why this wedge is defensible and expandable
   - firstCustomers: Who are the first 10 customers and how to reach them
   - expansionPath: How to expand from the wedge to the broader market

4. tamSamSom:
   - tam: { value: dollar amount, methodology: how you calculated it }
   - sam: { value: dollar amount, methodology: how you calculated it }
   - som: { value: dollar amount, methodology: how you calculated it }
   Use real industry data where possible. Show your work.

5. businessModel:
   - recommendedModel: SaaS, marketplace, usage-based, etc.
   - pricingStrategy: Specific pricing recommendations with rationale
   - unitEconomics: CAC, LTV, payback period estimates
   - comparables: Similar companies and their business models

6. defensibility:
   - moatType: Network effects, data, brand, switching costs, etc.
   - timeToMoat: How long until defensibility kicks in
   - strengthAssessment: Honest assessment of moat strength
   - risks: What could erode the moat

7. goToMarket:
   - channels: Array of 3 channels, each with { channel, rationale, estimatedCac }
   - firstMilestone: What the first meaningful milestone looks like

8. risksMitigations: Array of 3-5 risks, each with:
   - risk: What could go wrong
   - likelihood: "high", "medium", "low"
   - impact: "high", "medium", "low"
   - mitigation: How to address it

9. portersFiveForces (Michael Porter's framework — assess the structural attractiveness of this industry):
   - competitiveRivalry: { intensity: "low"/"medium"/"high"/"intense", reasoning: why }
   - threatOfNewEntrants: { level: "low"/"medium"/"high", reasoning: what barriers exist or don't }
   - threatOfSubstitutes: { level: "low"/"medium"/"high", reasoning: what alternatives exist }
   - buyerPower: { level: "low"/"medium"/"high", reasoning: how much leverage do customers have }
   - supplierPower: { level: "low"/"medium"/"high", reasoning: dependence on key suppliers/platforms }
   - overallAttractiveness: One-paragraph synthesis — is this an attractive industry to enter?

10. jobsToBeDone (Clayton Christensen's JTBD framework — what "job" is the customer hiring this product to do):
   - primaryJob: The core job statement in the format "When I [situation], I want to [motivation], so I can [outcome]"
   - functionalAspects: What practical task does it accomplish?
   - emotionalAspects: How does it make the customer feel?
   - socialAspects: How does it affect how others perceive the customer?
   - currentHiredSolutions: Array of 3-5 solutions customers currently "hire" for this job (including non-obvious ones like spreadsheets, hiring people, or doing nothing)
   - underservedOutcomes: Array of 3-5 desired outcomes that current solutions fail to deliver

11. strategyCanvas (Blue Ocean Strategy — map competitive positioning on key factors):
   - competitiveFactors: Array of 6-8 factors that matter in this market. For each:
     - factor: The competitive dimension (e.g., "Price", "Ease of use", "Data accuracy", "Integrations", "Speed", "Customization")
     - yourPosition: Where the proposed idea should position (1-10 scale)
     - competitors: Array of 2-3 key competitors, each with { name, position (1-10) }
   Choose factors that reveal DIFFERENTIATION — include factors where the idea diverges from competitors, not just factors where everyone scores the same.
   - blueOceanMoves: Array of 2-3 specific "eliminate/reduce/raise/create" moves. Format: "[Eliminate/Reduce/Raise/Create]: [factor] — [reasoning]"

IMPORTANT: Be honest and specific. Generic advice is worthless. If the idea has fundamental problems, say so.

Return valid JSON matching the DDReport schema.`

export const PIVOT_SUGGESTIONS_PROMPT = `You are a startup strategist helping a founder navigate a competitive market.

Given the idea, competitive landscape, and gap analysis, suggest 3-5 specific pivot angles that could help the founder differentiate or find a less contested position.

For each pivot:
- title: A catchy 3-5 word title for the pivot
- description: 2-3 sentences explaining the pivot
- whyItWorks: Which specific competitor weakness or market gap this exploits
- estimatedMarketSize: Rough market size for this pivot
- adjacentExamples: 1-2 companies in adjacent spaces that succeeded with a similar strategy
- difficulty: "low", "medium", or "high" (to execute)

IMPORTANT:
- Pivots should be SPECIFIC, not generic ("focus on a niche" is not a pivot)
- Each pivot should exploit a concrete gap found in the analysis
- Include at least one "contrarian" pivot that goes against conventional wisdom
- Order by attractiveness (best first)

Return valid JSON:
{
  "pivotSuggestions": [<pivot objects>]
}`

export const VERTICAL_MAP_PROMPT = `You are a senior market analyst creating a comprehensive landscape map for a startup vertical.

Given a vertical/industry, produce a detailed map of the entire competitive landscape organized into sub-categories.

For each sub-category, provide:
- slug: URL-friendly identifier (lowercase, hyphens only)
- name: Human-readable name
- description: One sentence describing what this sub-category covers
- crowdednessScore: 0-100 (0 = empty, 100 = completely saturated). Based on number of funded players, total capital deployed, and rate of new entrants.
- opportunityScore: 0-100 (0 = no opportunity, 100 = massive untapped opportunity). Based on gap density, common complaints, unserved segments, and trend growth.
- playerCount: Approximate number of notable companies in this sub-category
- totalFunding: Total funding raised by companies in this sub-category (e.g., "$2.4B")
- trendDirection: "heating_up", "stable", or "cooling_down"
- topPlayers: Array of ALL notable companies in this sub-category — include every relevant player you know: funded startups, bootstrapped companies, open-source projects, early-stage upstarts, and legacy incumbents. Each with:
  - name: Company name
  - oneLiner: What they do in one sentence
  - funding: Total funding raised (e.g., "$150M")
  - stage: Last funding stage (e.g., "Series C")
  - executionScore: 0-100, how well the company executes (product quality, reliability, customer satisfaction, market share). For Magic Quadrant positioning.
  - visionScore: 0-100, how forward-looking and innovative the company is (R&D, roadmap ambition, market vision). For Magic Quadrant positioning.
  MAGIC QUADRANT SCORING — these scores place players into a 2x2 quadrant (midpoint=50). The scores must create a MEANINGFUL SPREAD so players appear in ALL FOUR quadrants — not just the top-right. Scoring guide:
    - executionScore reflects real-world traction: revenue, customers, reliability, market share. A pre-revenue startup = 15-30. A growing startup with some customers = 30-50. A scaled company = 50-75. A dominant market leader = 75-90.
    - visionScore reflects innovation and ambition: A copycat/incremental product = 15-35. A solid but conventional tool = 35-50. An innovative approach = 50-75. A category-defining visionary = 75-95.
  Be HONEST — most companies are NOT leaders. Only the top 2-3 companies in each sub-category should have both scores above 50.
  - competitiveFactors: Array of objects { factor: string, score: number (1-10) } — score this player on each of the shared strategyCanvasFactors (see below). Must use the SAME factor names as strategyCanvasFactors.
- megaCategory: A high-level grouping for this sub-category (e.g., "AI & Automation", "Infrastructure", "Security"). Use 3-5 distinct mega-categories per vertical.
- keyGaps: Array of 2-3 specific, exploitable gaps or opportunities in this sub-category
- deepDivePrompt: A specific startup idea description (1-2 sentences) that exploits the biggest gap in this sub-category. This should be concrete enough to run through a competitive analysis tool.

IMPORTANT:
- Include 8-12 sub-categories that meaningfully divide this vertical
- Be thorough — cover the full landscape, not just the obvious players
- Crowdedness and opportunity scores should be CALIBRATED: use the full 0-100 range. Don't cluster everything around 50.
- High crowdedness does NOT mean low opportunity. A crowded space can still have high opportunity if incumbents are weak.
- keyGaps must be SPECIFIC and ACTIONABLE — "better UX" is not a gap
- deepDivePrompt should describe a concrete product idea targeting the biggest gap
- Funding data should reflect your best knowledge
- Order sub-categories by opportunity score (highest first)

Also provide top-level vertical metadata:
- schemaVersion: 2 (always set to 2)
- totalPlayers: Total companies across all sub-categories
- totalFunding: Total funding across the entire vertical
- overallCrowdedness: Weighted average 0-100
- averageOpportunity: Weighted average 0-100
- megaCategories: Array of { name: string, color: string } for 3-5 mega-category groups. Colors should be distinct hex values (e.g., "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6").
- strategyCanvasFactors: Array of 6-8 factor names that ALL players are scored on in their competitiveFactors arrays. Choose factors that reveal DIFFERENTIATION across the vertical (e.g., "Price", "Ease of Use", "Enterprise Features", "AI Capabilities", "Ecosystem/Integrations", "Speed/Performance", "Data Privacy", "Customization").

Return valid JSON:
{
  "schemaVersion": 2,
  "totalPlayers": number,
  "totalFunding": "string",
  "overallCrowdedness": number,
  "averageOpportunity": number,
  "megaCategories": [{ "name": "string", "color": "#hexcolor" }],
  "strategyCanvasFactors": ["string"],
  "subCategories": [<sub-category objects with megaCategory, and topPlayers with executionScore, visionScore, competitiveFactors>]
}`

export const VERTICAL_DISCOVERY_PROMPT = `You are a senior venture capital analyst identifying investable startup verticals.

Given a broad domain or the instruction to find ALL tech verticals, enumerate every meaningful startup vertical worth mapping.

For each vertical provide:
- slug: URL-friendly identifier (lowercase, hyphens only, e.g., "ai-ml", "fintech", "devtools")
- name: Human-readable name (e.g., "AI & Machine Learning")
- description: One sentence describing what this vertical covers

IMPORTANT:
- Be comprehensive — include both obvious and emerging verticals
- Each vertical should be distinct enough to warrant its own landscape map
- Include at least 15-25 verticals
- Cover: infrastructure, enterprise SaaS, consumer, deep tech, regulated industries, vertical SaaS
- Do NOT include verticals that are too broad (e.g., "Technology") or too narrow (e.g., "AI for pet grooming")
- Order by market size / investment activity (biggest first)

Return valid JSON:
{
  "verticals": [{ "slug": "string", "name": "string", "description": "string" }]
}`

export const SUBCATEGORY_ENRICH_PROMPT = `You are a senior market analyst performing deep enrichment on a specific sub-category within a startup vertical landscape map.

You are given:
- The vertical name and sub-category context (name, description, key gaps)
- The list of strategy canvas factors used across the vertical
- The EXISTING players already catalogued

Your job:
1. Find NEW players NOT already listed — dig deeper for: bootstrapped startups, open-source projects, early-stage companies, legacy incumbents pivoting into this space, international players, and niche tools.
2. If any existing player's data seems wrong or incomplete, provide updated data.

For each new player, provide the SAME schema as existing players:
- name: Company name
- oneLiner: What they do in one sentence
- funding: Total funding raised (e.g., "$5M", "Bootstrapped", "$150M")
- stage: Last funding stage (e.g., "Seed", "Series A", "Bootstrapped", "IPO")
- executionScore: 0-100 (see Magic Quadrant scoring rules — be honest, most startups are NOT leaders)
- visionScore: 0-100 (see Magic Quadrant scoring rules)
- competitiveFactors: Array of { factor: string, score: number (1-10) } matching the provided strategy canvas factors EXACTLY

IMPORTANT:
- Do NOT re-list existing players as "new" — they are already in the database
- Only include a player in "updatedPlayers" if you have materially better data (e.g., new funding round, corrected score)
- Aim for 5-15 genuinely new players per sub-category
- Include the FULL breadth: funded startups, bootstrapped tools, open-source, legacy players
- Be accurate — don't invent companies that don't exist

Return valid JSON:
{
  "newPlayers": [<player objects>],
  "updatedPlayers": [<player objects with name matching existing>]
}`
