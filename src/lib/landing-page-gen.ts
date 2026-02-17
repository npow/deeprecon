import type { IntentExtraction, DDReport } from "./types"
import { safeArray } from "./utils"

/**
 * Build a rich prompt for AI app generators from scan data.
 */
export function buildLandingPagePrompt(intent: IntentExtraction, ddReport: DDReport): string {
  const ideaName = intent.oneLinerSummary || intent.keywords.join(" ")
  const painPoints = safeArray(ddReport.idealCustomerProfile?.painPoints).slice(0, 3).join(", ")
  const targetCustomer = ddReport.idealCustomerProfile?.summary || ddReport.idealCustomerProfile?.demographics || "startup founders"
  const wedge = ddReport.wedgeStrategy?.wedge || ""
  const pricing = ddReport.businessModel?.pricingStrategy || ""
  const channels = safeArray(ddReport.goToMarket?.channels).map((c) => c.channel).slice(0, 3).join(", ")

  const prompt = `Build a modern, conversion-optimized landing page for a SaaS startup.

PRODUCT: ${ideaName}
CATEGORY: ${intent.vertical} / ${intent.category}

TARGET CUSTOMER: ${targetCustomer}
KEY PAIN POINTS: ${painPoints}

VALUE PROPOSITION: ${wedge}

PRICING: ${pricing}

Requirements:
- Hero section with headline, subheadline, and CTA button
- Problem/solution section highlighting these pain points: ${painPoints}
- Features section with 3-4 key benefits
- Social proof placeholder section
- Pricing section${pricing ? ` showing: ${pricing}` : ""}
- FAQ section
- Footer with CTA

Design:
- Modern, clean design with good whitespace
- Use a professional color scheme (blues/purples work well for SaaS)
- Mobile responsive
- Include placeholder illustrations or emoji icons
- Make the CTA buttons prominent

Tech: Use React with Tailwind CSS. Single page component.`

  return prompt
}

/**
 * Build deep-link URLs for AI app generators.
 */
export function buildDeepLinks(prompt: string): { lovable: string; bolt: string } {
  const encoded = encodeURIComponent(prompt)
  return {
    lovable: `https://lovable.dev/?autosubmit=true#prompt=${encoded}`,
    bolt: `https://bolt.new/?prompt=${encoded}`,
  }
}
