import type { DDReport } from "./types"
import { safeArray, parseFundingString } from "./utils"

// ─── Types ───

export interface MonthData {
  month: number
  customers: number
  newCustomers: number
  churnedCustomers: number
  mrr: number
  arr: number
  cacSpend: number
  grossProfit: number
  opex: number
  net: number
  cumulativeCashFlow: number
}

export interface ScenarioResult {
  label: string
  multiplier: number
  months: MonthData[]
  breakEvenMonth: number | null // null = never within 36 months
  totalFundingNeeded: number
  ltvCacRatio: number | null
  somExhaustionMonth: number | null
}

export interface RevenueSimulation {
  arpu: number
  cac: number
  grossMargin: number
  churnRate: number
  addressableCustomers: number
  som: number
  scenarios: ScenarioResult[]
  sensitivityNotes: string[]
  warnings: string[]
  parsed: {
    arpuSource: string
    cacSource: string
    marginSource: string
    somSource: string
  }
}

// ─── Parsers ───

/** Extract a monthly dollar amount from text like "$49/mo", "$499/yr", "$29 per month" */
export function parseMonthlyPrice(text: unknown): number | null {
  const input = typeof text === "string" ? text : text == null ? "" : String(text)
  if (!input) return null
  // Try "$X/mo" or "$X per month" or "$X/month"
  const moMatch = input.match(/\$\s*([\d,.]+)\s*(?:\/\s*mo(?:nth)?|per\s*month)/i)
  if (moMatch) return parseFloat(moMatch[1].replace(/,/g, ""))
  // Try "$X/yr" or "$X per year" or "$X/year" → divide by 12
  const yrMatch = input.match(/\$\s*([\d,.]+)\s*(?:\/\s*(?:yr|year)|per\s*year)/i)
  if (yrMatch) return parseFloat(yrMatch[1].replace(/,/g, "")) / 12
  // Try plain "$X" at the start
  const plainMatch = input.match(/\$\s*([\d,.]+)/)
  if (plainMatch) {
    const val = parseFloat(plainMatch[1].replace(/,/g, ""))
    // If > 500, assume annual
    if (val > 500) return val / 12
    return val
  }
  return null
}

/** Extract CAC from text like "$50 CAC", "$200", "low ($30-50)" */
export function parseCacFromText(text: unknown): number | null {
  const input = typeof text === "string" ? text : text == null ? "" : String(text)
  if (!input) return null
  const match = input.match(/\$\s*([\d,.]+)/)
  if (match) return parseFloat(match[1].replace(/,/g, ""))
  return null
}

/** Extract gross margin from text like "70% margins", "80% gross margin" */
export function parseGrossMargin(text: unknown): number | null {
  const input = typeof text === "string" ? text : text == null ? "" : String(text)
  if (!input) return null
  const match = input.match(/([\d.]+)\s*%/)
  if (match) {
    const val = parseFloat(match[1])
    if (val > 0 && val <= 100) return val / 100
  }
  return null
}

/** Parse a churn rate from text, or return null */
export function parseChurnRate(text: unknown): number | null {
  const input = typeof text === "string" ? text : text == null ? "" : String(text)
  if (!input) return null
  const match = input.match(/([\d.]+)\s*%\s*churn/i)
  if (match) return parseFloat(match[1]) / 100
  return null
}

// ─── Growth model ───

function baseGrowthRate(crowdednessIndex: string): number {
  switch (crowdednessIndex) {
    case "low": return 0.25
    case "moderate": return 0.18
    case "high": return 0.12
    case "red_ocean": return 0.08
    default: return 0.15
  }
}

function initialCustomersPerMonth(channelCount: number): number {
  if (channelCount >= 3) return 15
  if (channelCount >= 2) return 10
  return 5
}

function simulateScenario(
  label: string,
  multiplier: number,
  arpu: number,
  cac: number,
  grossMargin: number,
  monthlyChurn: number,
  maxCustomers: number,
  initialRate: number,
  growthRate: number,
  teamSize: number,
): ScenarioResult {
  const adjustedGrowth = growthRate * multiplier
  const months: MonthData[] = []
  let customers = 0
  let cumulativeCash = 0
  let breakEvenMonth: number | null = null
  let somExhaustionMonth: number | null = null
  const opexPerMonth = teamSize * 15000

  for (let m = 1; m <= 36; m++) {
    let newCusts: number

    if (m <= 3) {
      // Founder-led sales
      newCusts = Math.round(initialRate * multiplier)
    } else if (m <= 12) {
      // Early traction: compound growth
      const prevNew = months[m - 2]?.newCustomers || initialRate
      newCusts = Math.round(prevNew * (1 + adjustedGrowth))
    } else if (m <= 24) {
      // Year 2: decelerated growth
      const prevNew = months[m - 2]?.newCustomers || initialRate
      newCusts = Math.round(prevNew * (1 + adjustedGrowth / 2))
    } else {
      // Year 3: maturation, growth ≈ churn
      const prevNew = months[m - 2]?.newCustomers || 0
      newCusts = Math.round(prevNew * (1 + adjustedGrowth / 4))
    }

    const churned = Math.round(customers * monthlyChurn)
    customers = Math.min(customers + newCusts - churned, maxCustomers)
    if (customers < 0) customers = 0

    // Check SOM cap
    if (customers >= maxCustomers && somExhaustionMonth === null) {
      somExhaustionMonth = m
    }

    const mrr = customers * arpu
    const arr = mrr * 12
    const cacSpend = newCusts * cac
    const gross = mrr * grossMargin
    const net = gross - cacSpend - opexPerMonth
    cumulativeCash += net

    if (breakEvenMonth === null && net > 0 && m > 1) {
      breakEvenMonth = m
    }

    months.push({
      month: m,
      customers,
      newCustomers: newCusts,
      churnedCustomers: churned,
      mrr: Math.round(mrr),
      arr: Math.round(arr),
      cacSpend: Math.round(cacSpend),
      grossProfit: Math.round(gross),
      opex: opexPerMonth,
      net: Math.round(net),
      cumulativeCashFlow: Math.round(cumulativeCash),
    })
  }

  // Total funding needed = max negative cumulative cash flow
  const minCash = Math.min(...months.map((m) => m.cumulativeCashFlow))
  const totalFundingNeeded = minCash < 0 ? Math.abs(minCash) : 0

  // LTV:CAC ratio
  let ltvCacRatio: number | null = null
  if (cac > 0 && monthlyChurn > 0) {
    const ltv = (arpu * grossMargin) / monthlyChurn
    ltvCacRatio = Math.round((ltv / cac) * 10) / 10
  }

  return {
    label,
    multiplier,
    months,
    breakEvenMonth,
    totalFundingNeeded,
    ltvCacRatio,
    somExhaustionMonth,
  }
}

// ─── Main function ───

export function simulateRevenue(
  ddReport: DDReport,
  crowdednessIndex: string,
): RevenueSimulation {
  const warnings: string[] = []
  const sensitivityNotes: string[] = []

  // 1. Parse ARPU
  let arpu: number | null = null
  let arpuSource = ""

  const pricing = ddReport.businessModel?.pricingStrategy ?? ""
  arpu = parseMonthlyPrice(pricing)
  if (arpu) {
    arpuSource = "pricing strategy"
  }

  if (!arpu) {
    const wtp = ddReport.idealCustomerProfile?.willingness_to_pay ?? ""
    arpu = parseMonthlyPrice(wtp)
    if (arpu) arpuSource = "willingness to pay"
  }

  // 2. Parse SOM
  const somText = ddReport.tamSamSom?.som?.value ?? ""
  const som = parseFundingString(somText)

  // Fallback ARPU from SOM
  if (!arpu && som > 0) {
    arpu = Math.round(som / 1000 / 12) // assume 1000 customers
    arpuSource = "SOM-derived estimate"
    warnings.push("No explicit pricing found — ARPU estimated from SOM assuming ~1,000 customers.")
  }
  if (!arpu) {
    arpu = 49 // SaaS default
    arpuSource = "default ($49/mo)"
    warnings.push("Could not parse pricing from report. Using default $49/mo ARPU.")
  }

  // 3. Parse CAC
  let cac: number | null = null
  let cacSource = ""
  const channels = safeArray(ddReport.goToMarket?.channels)
  for (const ch of channels) {
    const parsed = parseCacFromText(ch.estimatedCac ?? "")
    if (parsed) {
      cac = parsed
      cacSource = ch.channel
      break
    }
  }
  if (!cac) {
    cac = arpu * 3 // standard 3x ARPU assumption
    cacSource = "estimated (3x ARPU)"
  }

  // 4. Parse gross margin
  let grossMargin: number | null = parseGrossMargin(ddReport.businessModel?.unitEconomics ?? "")
  let marginSource = "unit economics"
  if (!grossMargin) {
    grossMargin = 0.70 // SaaS default
    marginSource = "SaaS default (70%)"
  }

  // 5. Churn rate
  const churnRate = 0.06 // 6% monthly default for early-stage

  // 6. Addressable customers
  const addressableCustomers = som > 0 ? Math.round(som / (arpu * 12)) : 10000

  // 7. Growth parameters
  const growth = baseGrowthRate(crowdednessIndex)
  const initialRate = initialCustomersPerMonth(channels.length)

  // 8. Run 3 scenarios
  const scenarios: ScenarioResult[] = [
    simulateScenario("Conservative", 0.7, arpu, cac, grossMargin, churnRate + 0.02, addressableCustomers, initialRate, growth, 2),
    simulateScenario("Base", 1.0, arpu, cac, grossMargin, churnRate, addressableCustomers, initialRate, growth, 2),
    simulateScenario("Aggressive", 1.4, arpu, cac, grossMargin, churnRate - 0.02, addressableCustomers, initialRate, growth, 2),
  ]

  // 9. Sensitivity notes
  const baseScenario = scenarios[1]
  if (baseScenario.breakEvenMonth) {
    // Estimate effect of lower churn
    const lowerChurn = simulateScenario("LowChurn", 1.0, arpu, cac, grossMargin, churnRate - 0.03, addressableCustomers, initialRate, growth, 2)
    if (lowerChurn.breakEvenMonth && lowerChurn.breakEvenMonth < baseScenario.breakEvenMonth) {
      sensitivityNotes.push(
        `If churn drops from ${Math.round(churnRate * 100)}% to ${Math.round((churnRate - 0.03) * 100)}%, break-even moves from month ${baseScenario.breakEvenMonth} to month ${lowerChurn.breakEvenMonth}.`
      )
    }
  }

  // 10. Sanity checks
  if (baseScenario.somExhaustionMonth) {
    warnings.push(`SOM exhaustion at month ${baseScenario.somExhaustionMonth} — growth capped by market size.`)
  }
  if (!baseScenario.breakEvenMonth) {
    warnings.push("Break-even not reached within 36 months — requires significant funding runway.")
  }
  if (baseScenario.ltvCacRatio !== null && baseScenario.ltvCacRatio < 1) {
    warnings.push(`LTV:CAC ratio is ${baseScenario.ltvCacRatio}x — unit economics are negative. Improve retention or lower CAC.`)
  }

  return {
    arpu,
    cac,
    grossMargin,
    churnRate,
    addressableCustomers,
    som,
    scenarios,
    sensitivityNotes,
    warnings,
    parsed: {
      arpuSource,
      cacSource,
      marginSource,
      somSource: somText || "Unknown",
    },
  }
}
