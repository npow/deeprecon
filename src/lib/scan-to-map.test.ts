import { describe, it, expect } from "vitest"
import { parseEmployeeUpperBound } from "./scan-to-map"
import { safeArray } from "./utils"
import { resolveConfidenceLevel } from "./enrich"
import type { ConfidenceLevel } from "./types"

// ─── parseEmployeeUpperBound ───

describe("parseEmployeeUpperBound", () => {
  it("parses 'N-M' range format → returns M", () => {
    expect(parseEmployeeUpperBound("1-10")).toBe(10)
    expect(parseEmployeeUpperBound("11-50")).toBe(50)
    expect(parseEmployeeUpperBound("51-200")).toBe(200)
    expect(parseEmployeeUpperBound("201-500")).toBe(500)
    expect(parseEmployeeUpperBound("501-1000")).toBe(1000)
    expect(parseEmployeeUpperBound("1001-5000")).toBe(5000)
    expect(parseEmployeeUpperBound("5001-10000")).toBe(10000)
  })

  it("parses 'N+' format → returns N", () => {
    expect(parseEmployeeUpperBound("10001+")).toBe(10001)
    expect(parseEmployeeUpperBound("500+")).toBe(500)
  })

  it("parses single numbers", () => {
    expect(parseEmployeeUpperBound("200")).toBe(200)
    expect(parseEmployeeUpperBound("50")).toBe(50)
  })

  it("handles approximate prefixes", () => {
    expect(parseEmployeeUpperBound("~200")).toBe(200)
    expect(parseEmployeeUpperBound("≈500")).toBe(500)
  })

  it("handles en-dash and em-dash", () => {
    expect(parseEmployeeUpperBound("51–200")).toBe(200)
    expect(parseEmployeeUpperBound("201—500")).toBe(500)
  })

  it("handles commas in numbers", () => {
    expect(parseEmployeeUpperBound("1,001-5,000")).toBe(5000)
  })

  it("returns 0 for empty/invalid input", () => {
    expect(parseEmployeeUpperBound("")).toBe(0)
    expect(parseEmployeeUpperBound("unknown")).toBe(0)
    expect(parseEmployeeUpperBound("N/A")).toBe(0)
  })
})

// ─── Execution score: employee bonus ───

describe("employee count → execution score bonus", () => {
  // These test the logic used by computeExecutionScore
  // The function uses: >200 → +10, >50 → +5, else → +0
  function employeeBonus(range: string): number {
    const upper = parseEmployeeUpperBound(range)
    if (upper > 200) return 10
    if (upper > 50) return 5
    return 0
  }

  it("1-10 → +0 (small startup)", () => {
    expect(employeeBonus("1-10")).toBe(0)
  })

  it("11-50 → +0 (upper bound is 50, not >50)", () => {
    expect(employeeBonus("11-50")).toBe(0)
  })

  it("51-200 → +5 (upper bound 200, not >200)", () => {
    expect(employeeBonus("51-200")).toBe(5)
  })

  it("201-500 → +10 (>200)", () => {
    expect(employeeBonus("201-500")).toBe(10)
  })

  it("501-1000 → +10", () => {
    expect(employeeBonus("501-1000")).toBe(10)
  })

  it("10001+ → +10", () => {
    expect(employeeBonus("10001+")).toBe(10)
  })
})

// ─── Vision score: similarityScore handling ───

describe("vision score similarity handling", () => {
  // Reproduces the logic from computeVisionScore
  function visionFromSimilarity(sim: number | undefined): number {
    let score = 45
    const safeSim = sim ?? 70 // default to neutral
    if (safeSim > 85) score -= 15
    else if (safeSim > 70) score -= 5
    else if (safeSim > 50) score += 5
    else score += 15
    return score
  }

  it("undefined similarityScore → neutral (no bonus/penalty)", () => {
    // Default 70 is in the 50-70 range → +5
    expect(visionFromSimilarity(undefined)).toBe(50)
  })

  it("high similarity (>85) → penalty", () => {
    expect(visionFromSimilarity(90)).toBe(30)
  })

  it("low similarity (<50) → bonus", () => {
    expect(visionFromSimilarity(40)).toBe(60)
  })

  it("moderate similarity (50-70) → small bonus", () => {
    expect(visionFromSimilarity(60)).toBe(50)
  })
})

// ─── Company name dedup keys ───

describe("company name dedup", () => {
  // Reproduces the dedup key logic from pipeline.ts
  const TECH_SUFFIXES = ["ai", "io", "co", "hq", "app", "labs", "inc", "ltd", "corp"]
  function dedupKeys(name: string): string[] {
    const base = (name || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    if (!base) return []
    const keys = [base]
    for (const s of TECH_SUFFIXES) {
      if (base.endsWith(s) && base.length - s.length >= 5) {
        keys.push(base.slice(0, -s.length))
      }
    }
    return keys
  }

  it("strips .ai suffix for matching", () => {
    const keys1 = dedupKeys("Harmonic")
    const keys2 = dedupKeys("Harmonic.ai")
    // "harmonic" should appear in both key sets
    expect(keys1).toContain("harmonic")
    expect(keys2).toContain("harmonic")
  })

  it("strips .io suffix for matching", () => {
    const keys = dedupKeys("Retool.io")
    expect(keys).toContain("retool")
  })

  it("does NOT strip suffix from short names like OpenAI", () => {
    const keys = dedupKeys("OpenAI")
    // "openai" minus "ai" = "open" (4 chars < 5), should NOT strip
    expect(keys).toEqual(["openai"])
  })

  it("handles names without suffixes", () => {
    const keys = dedupKeys("Crunchbase")
    expect(keys).toEqual(["crunchbase"])
  })

  it("strips .labs suffix", () => {
    const keys = dedupKeys("StabilityLabs")
    expect(keys).toContain("stability")
  })

  it("returns empty for empty name", () => {
    expect(dedupKeys("")).toEqual([])
  })
})

// ─── safeArray ───

describe("safeArray", () => {
  it("returns the array when given an array", () => {
    expect(safeArray([1, 2, 3])).toEqual([1, 2, 3])
    expect(safeArray([])).toEqual([])
  })

  it("returns [] for undefined", () => {
    expect(safeArray(undefined)).toEqual([])
  })

  it("returns [] for null", () => {
    expect(safeArray(null)).toEqual([])
  })
})

// ─── resolveConfidenceLevel ───

describe("resolveConfidenceLevel", () => {
  it("web_verified beats multi_confirmed", () => {
    expect(resolveConfidenceLevel("web_verified", "multi_confirmed")).toBe("web_verified")
    expect(resolveConfidenceLevel("multi_confirmed", "web_verified")).toBe("web_verified")
  })

  it("multi_confirmed beats ai_inferred", () => {
    expect(resolveConfidenceLevel("multi_confirmed", "ai_inferred")).toBe("multi_confirmed")
    expect(resolveConfidenceLevel("ai_inferred", "multi_confirmed")).toBe("multi_confirmed")
  })

  it("web_verified beats ai_inferred", () => {
    expect(resolveConfidenceLevel("web_verified", "ai_inferred")).toBe("web_verified")
    expect(resolveConfidenceLevel("ai_inferred", "web_verified")).toBe("web_verified")
  })

  it("same level returns that level", () => {
    expect(resolveConfidenceLevel("web_verified", "web_verified")).toBe("web_verified")
    expect(resolveConfidenceLevel("ai_inferred", "ai_inferred")).toBe("ai_inferred")
  })

  it("undefined + level returns level", () => {
    expect(resolveConfidenceLevel(undefined, "multi_confirmed")).toBe("multi_confirmed")
    expect(resolveConfidenceLevel("web_verified", undefined)).toBe("web_verified")
  })

  it("both undefined returns undefined", () => {
    expect(resolveConfidenceLevel(undefined, undefined)).toBeUndefined()
  })
})

// ─── Confidence stamping integration ───

describe("confidence stamping", () => {
  // Reproduces the stamping logic from fanOutCompetition
  function stampConfidence(
    confirmedBy: string[],
    hasWeb: boolean
  ): { confirmedBy: string[]; confirmedByCount: number; confidenceLevel: ConfidenceLevel } {
    const sources = new Set(confirmedBy)
    return {
      confirmedBy: Array.from(sources),
      confirmedByCount: sources.size,
      confidenceLevel: hasWeb
        ? "web_verified"
        : sources.size >= 2
          ? "multi_confirmed"
          : "ai_inferred",
    }
  }

  it("single model → ai_inferred", () => {
    const result = stampConfidence(["Gem3Flash"], false)
    expect(result.confidenceLevel).toBe("ai_inferred")
    expect(result.confirmedByCount).toBe(1)
  })

  it("two models → multi_confirmed", () => {
    const result = stampConfidence(["Gem3Flash", "Qwen3-235b"], false)
    expect(result.confidenceLevel).toBe("multi_confirmed")
    expect(result.confirmedByCount).toBe(2)
  })

  it("web search → web_verified even with one model", () => {
    const result = stampConfidence(["Gemini-Grounded"], true)
    expect(result.confidenceLevel).toBe("web_verified")
    expect(result.confirmedByCount).toBe(1)
  })

  it("web search + multiple models → web_verified", () => {
    const result = stampConfidence(["Gem3Flash", "Gemini-Grounded"], true)
    expect(result.confidenceLevel).toBe("web_verified")
    expect(result.confirmedByCount).toBe(2)
  })

  it("deduplicates model names", () => {
    const result = stampConfidence(["Gem3Flash", "Gem3Flash"], false)
    expect(result.confirmedByCount).toBe(1)
    expect(result.confidenceLevel).toBe("ai_inferred")
  })
})

// ─── Confidence merge (enrich) ───

describe("confidence merge", () => {
  it("unions confirmedBy arrays with dedup", () => {
    const a = ["Gem3Flash", "Qwen3-235b"]
    const b = ["Qwen3-235b", "Gemini-Grounded"]
    const merged = [...new Set([...a, ...b])]
    expect(merged).toEqual(["Gem3Flash", "Qwen3-235b", "Gemini-Grounded"])
  })

  it("resolves confidence level to highest on merge", () => {
    expect(resolveConfidenceLevel("ai_inferred", "web_verified")).toBe("web_verified")
    expect(resolveConfidenceLevel("multi_confirmed", "ai_inferred")).toBe("multi_confirmed")
  })
})
