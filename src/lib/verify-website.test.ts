import { describe, it, expect, vi, beforeEach } from "vitest"
import { verifyWebsiteUrl, verifyCompetitorWebsites } from "./verify-website"
import type { Competitor } from "./types"

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

function htmlResponse(body: string, status = 200): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { "Content-Type": "text/html" } })
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe("verifyWebsiteUrl", () => {
  it("returns verified for a normal site", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>Acme Corp - Project Management</title></head><body>Hello</body></html>")
    )
    const result = await verifyWebsiteUrl("https://acme.com", "Acme Corp")
    expect(result.status).toBe("verified")
    expect(result.url).toBe("https://acme.com")
  })

  it("returns dead for network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const result = await verifyWebsiteUrl("https://deadsite.com", "DeadSite")
    expect(result.status).toBe("dead")
  })

  it("returns dead for 404", async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse("Not Found", 404))
    const result = await verifyWebsiteUrl("https://missing.com", "Missing")
    expect(result.status).toBe("dead")
  })

  it("returns dead for 500", async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse("Server Error", 500))
    const result = await verifyWebsiteUrl("https://broken.com", "Broken")
    expect(result.status).toBe("dead")
  })

  it("detects GoDaddy parking page", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>parked-domain</title></head><body>This domain is for sale on GoDaddy</body></html>")
    )
    const result = await verifyWebsiteUrl("https://parked.com", "Parked Inc")
    expect(result.status).toBe("parked")
  })

  it("detects Sedo parking page", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>sedo.com</title></head><body>Buy this domain on sedo.com</body></html>")
    )
    const result = await verifyWebsiteUrl("https://forsale.ai", "ForSale")
    expect(result.status).toBe("parked")
  })

  it("detects generic 'domain for sale' parking", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>Domain</title></head><body>This domain is for sale. Contact us.</body></html>")
    )
    const result = await verifyWebsiteUrl("https://example.ai", "Example")
    expect(result.status).toBe("parked")
  })

  it("detects LANDER_SYSTEM parking", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>Landing</title></head><body><script>var LANDER_SYSTEM = true;</script></body></html>")
    )
    const result = await verifyWebsiteUrl("https://landed.com", "Landed")
    expect(result.status).toBe("parked")
  })

  it("returns verified for Cloudflare challenge", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse('<html><head><title>Just a moment...</title></head><body><div id="cf-browser-verification"></div></body></html>')
    )
    const result = await verifyWebsiteUrl("https://protected.com", "Protected")
    expect(result.status).toBe("verified")
  })

  it("detects mismatch when both title and domain do not match", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>Bob's Pizza Delivery - Order Now</title></head><body>Pizza!</body></html>")
    )
    const result = await verifyWebsiteUrl("https://totallydifferentdomain.com", "TechStartup AI")
    expect(result.status).toBe("mismatch")
  })

  it("returns verified for generic title (React App)", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>React App</title></head><body><div id='root'></div></body></html>")
    )
    const result = await verifyWebsiteUrl("https://myapp.com", "MyApp")
    expect(result.status).toBe("verified")
  })

  it("returns verified for empty title", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title></title></head><body>Content</body></html>")
    )
    const result = await verifyWebsiteUrl("https://notitle.com", "NoTitle")
    expect(result.status).toBe("verified")
  })

  it("returns unknown for missing URL", async () => {
    const result = await verifyWebsiteUrl("", "NoUrl")
    expect(result.status).toBe("unknown")
  })

  it("prepends https:// if missing", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>Acme</title></head><body>Hello</body></html>")
    )
    const result = await verifyWebsiteUrl("acme.com", "Acme")
    expect(result.url).toBe("https://acme.com")
    expect(mockFetch).toHaveBeenCalledWith(
      "https://acme.com",
      expect.objectContaining({ redirect: "follow" })
    )
  })

  it("returns verified when company name appears in title", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>Dime A Dozen - Validate Your Business Idea</title></head><body>Content</body></html>")
    )
    const result = await verifyWebsiteUrl("https://dimeadozen.ai", "Dime a Dozen")
    expect(result.status).toBe("verified")
  })
})

describe("verifyCompetitorWebsites", () => {
  it("verifies all competitors in parallel", async () => {
    const competitors: Competitor[] = [
      {
        name: "GoodCo",
        description: "A good company",
        websiteUrl: "https://goodco.com",
        similarityScore: 80,
        topComplaints: [],
        keyDifferentiators: [],
        source: "ai_knowledge",
      },
      {
        name: "DeadCo",
        description: "A dead company",
        websiteUrl: "https://deadco.com",
        similarityScore: 60,
        topComplaints: [],
        keyDifferentiators: [],
        source: "ai_knowledge",
      },
      {
        name: "NoUrl",
        description: "No website",
        similarityScore: 50,
        topComplaints: [],
        keyDifferentiators: [],
        source: "ai_knowledge",
      },
    ]

    mockFetch
      .mockResolvedValueOnce(
        htmlResponse("<html><head><title>GoodCo - Great Software</title></head><body>Content</body></html>")
      )
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))

    const results = await verifyCompetitorWebsites(competitors)
    expect(results).toHaveLength(3)
    expect(results[0].websiteStatus).toBe("verified")
    expect(results[1].websiteStatus).toBe("dead")
    expect(results[2].websiteStatus).toBe("unknown")
  })

  it("preserves original competitor data", async () => {
    const competitors: Competitor[] = [
      {
        name: "TestCo",
        description: "Test company",
        websiteUrl: "https://testco.com",
        similarityScore: 75,
        totalFundingUsd: 5000000,
        topComplaints: ["slow"],
        keyDifferentiators: ["fast"],
        source: "web_search",
      },
    ]

    mockFetch.mockResolvedValueOnce(
      htmlResponse("<html><head><title>TestCo</title></head><body>Content</body></html>")
    )

    const results = await verifyCompetitorWebsites(competitors)
    expect(results[0].name).toBe("TestCo")
    expect(results[0].totalFundingUsd).toBe(5000000)
    expect(results[0].topComplaints).toEqual(["slow"])
    expect(results[0].websiteStatus).toBe("verified")
  })
})
