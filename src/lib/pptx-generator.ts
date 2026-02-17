import PptxGenJS from "pptxgenjs"
import type { SavedScan } from "./types"
import { formatCurrency, crowdednessLabel, safeArray, safeStr } from "./utils"

// ─── Theme ───

const DARK_BG = "0F172A"       // slate-900
const ACCENT = "6366F1"        // indigo-500
const ACCENT_LIGHT = "818CF8"  // indigo-400
const TEXT_WHITE = "F8FAFC"    // slate-50
const TEXT_MUTED = "94A3B8"    // slate-400
const GREEN = "22C55E"
const YELLOW = "EAB308"
const RED = "EF4444"
const CYAN = "06B6D4"

const TITLE_OPTS: PptxGenJS.TextPropsOptions = {
  fontSize: 28, color: TEXT_WHITE, bold: true, fontFace: "Arial",
}
const SUBTITLE_OPTS: PptxGenJS.TextPropsOptions = {
  fontSize: 14, color: TEXT_MUTED, fontFace: "Arial",
}
const HEADING_OPTS: PptxGenJS.TextPropsOptions = {
  fontSize: 18, color: ACCENT_LIGHT, bold: true, fontFace: "Arial",
}
const BODY_OPTS: PptxGenJS.TextPropsOptions = {
  fontSize: 12, color: TEXT_WHITE, fontFace: "Arial",
}
const BULLET_OPTS: PptxGenJS.TextPropsOptions = {
  fontSize: 11, color: TEXT_WHITE, fontFace: "Arial", bullet: true,
}
const LABEL_OPTS: PptxGenJS.TextPropsOptions = {
  fontSize: 10, color: TEXT_MUTED, fontFace: "Arial",
}

function addBackground(slide: PptxGenJS.Slide) {
  slide.background = { color: DARK_BG }
}

function addSlideNumber(slide: PptxGenJS.Slide, num: number) {
  slide.addText(String(num), {
    x: 9.2, y: 7.0, w: 0.6, h: 0.3,
    fontSize: 8, color: TEXT_MUTED, fontFace: "Arial", align: "right",
  })
}

function s(val: unknown): string {
  return safeStr(val)
}

// ─── Slide Builders ───

function slide1_Title(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)

  // Accent line at top
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 0.06, fill: { color: ACCENT },
  })

  slide.addText(s(scan.ideaText), {
    x: 0.8, y: 2.0, w: 8.4, h: 1.5,
    ...TITLE_OPTS, fontSize: 32, align: "center",
  })

  slide.addText(s(scan.intent.oneLinerSummary), {
    x: 1.2, y: 3.6, w: 7.6, h: 0.8,
    ...SUBTITLE_OPTS, fontSize: 16, align: "center",
  })

  const tag = `${s(scan.intent.vertical)} | ${s(scan.intent.category)}`
  slide.addText(tag, {
    x: 2.5, y: 4.8, w: 5.0, h: 0.4,
    fontSize: 11, color: ACCENT_LIGHT, fontFace: "Arial", align: "center",
    shape: pptx.ShapeType.roundRect, rectRadius: 0.15,
    line: { color: ACCENT, width: 1 },
  })

  addSlideNumber(slide, 1)
}

function slide2_Problem(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const dd = scan.ddReport

  slide.addText("The Problem", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  // Severity score badge
  const score = dd.problemSeverity?.score ?? 0
  const scoreColor = score >= 7 ? RED : score >= 4 ? YELLOW : GREEN
  slide.addText(`${score}/10`, {
    x: 0.6, y: 1.2, w: 1.2, h: 1.2,
    fontSize: 28, color: scoreColor, bold: true, fontFace: "Arial", align: "center",
    shape: pptx.ShapeType.roundRect, rectRadius: 0.1,
    line: { color: scoreColor, width: 2 },
  })
  slide.addText("Severity", {
    x: 0.6, y: 2.4, w: 1.2, h: 0.3, ...LABEL_OPTS, align: "center",
  })

  // Problem details
  const details = [
    { label: "Frequency", value: s(dd.problemSeverity?.frequency) },
    { label: "Current Alternatives", value: s(dd.problemSeverity?.alternatives) },
    { label: "Evidence", value: s(dd.problemSeverity?.evidenceSummary) },
  ]

  let y = 1.2
  for (const d of details) {
    slide.addText(d.label, { x: 2.2, y, w: 7.2, h: 0.3, ...HEADING_OPTS, fontSize: 12 })
    slide.addText(d.value, { x: 2.2, y: y + 0.3, w: 7.2, h: 0.5, ...BODY_OPTS, fontSize: 10 })
    y += 0.9
  }

  // Pain points
  const painPoints = safeArray(dd.idealCustomerProfile?.painPoints).slice(0, 4)
  if (painPoints.length > 0) {
    slide.addText("Customer Pain Points", { x: 0.6, y: 4.2, w: 8.8, h: 0.3, ...HEADING_OPTS, fontSize: 12 })
    painPoints.forEach((p, i) => {
      slide.addText(s(p), { x: 0.6, y: 4.6 + i * 0.35, w: 8.8, h: 0.3, ...BULLET_OPTS })
    })
  }

  // ICP Summary
  slide.addText(s(dd.idealCustomerProfile?.summary), {
    x: 0.6, y: 6.2, w: 8.8, h: 0.6, ...BODY_OPTS, fontSize: 10, italic: true, color: TEXT_MUTED,
  })

  addSlideNumber(slide, 2)
}

function slide3_Solution(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const dd = scan.ddReport
  const gap = scan.gapAnalysis

  slide.addText("The Solution", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  slide.addText(s(scan.ideaText), {
    x: 0.6, y: 1.2, w: 8.8, h: 0.6, ...BODY_OPTS, fontSize: 14, italic: true,
  })

  const sections = [
    { label: "Wedge Strategy", value: s(dd.wedgeStrategy?.wedge) },
    { label: "Why It Works", value: s(dd.wedgeStrategy?.whyThisWorks) },
    { label: "First Customers", value: s(dd.wedgeStrategy?.firstCustomers) },
  ]

  let y = 2.0
  for (const sec of sections) {
    slide.addText(sec.label, { x: 0.6, y, w: 8.8, h: 0.3, ...HEADING_OPTS, fontSize: 12 })
    slide.addText(sec.value, { x: 0.6, y: y + 0.3, w: 8.8, h: 0.6, ...BODY_OPTS, fontSize: 10 })
    y += 1.1
  }

  // White space opportunities
  const whiteSpace = safeArray(gap?.whiteSpaceOpportunities).slice(0, 3)
  if (whiteSpace.length > 0) {
    slide.addText("White Space Opportunities", { x: 0.6, y: 5.4, w: 8.8, h: 0.3, ...HEADING_OPTS, fontSize: 12 })
    whiteSpace.forEach((o, i) => {
      slide.addText(`${s(o.opportunity)} (${s(o.potentialImpact)} impact)`, {
        x: 0.6, y: 5.8 + i * 0.35, w: 8.8, h: 0.3, ...BULLET_OPTS,
      })
    })
  }

  addSlideNumber(slide, 3)
}

function slide4_MarketSize(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const tam = scan.ddReport.tamSamSom

  slide.addText("Market Size", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  // TAM/SAM/SOM as three columns
  const markets = [
    { label: "TAM", value: s(tam?.tam?.value), method: s(tam?.tam?.methodology), color: ACCENT },
    { label: "SAM", value: s(tam?.sam?.value), method: s(tam?.sam?.methodology), color: ACCENT_LIGHT },
    { label: "SOM", value: s(tam?.som?.value), method: s(tam?.som?.methodology), color: CYAN },
  ]

  markets.forEach((m, i) => {
    const x = 0.6 + i * 3.1
    // Box
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 1.5, w: 2.8, h: 3.0, rectRadius: 0.15,
      fill: { color: "1E293B" }, line: { color: m.color, width: 1.5 },
    })
    slide.addText(m.label, {
      x, y: 1.7, w: 2.8, h: 0.5,
      fontSize: 20, color: m.color, bold: true, fontFace: "Arial", align: "center",
    })
    slide.addText(m.value, {
      x, y: 2.4, w: 2.8, h: 0.6,
      fontSize: 16, color: TEXT_WHITE, bold: true, fontFace: "Arial", align: "center",
    })
    slide.addText(m.method, {
      x: x + 0.2, y: 3.2, w: 2.4, h: 1.0,
      fontSize: 9, color: TEXT_MUTED, fontFace: "Arial", align: "center", valign: "top",
    })
  })

  addSlideNumber(slide, 4)
}

function slide5_Competition(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const competitors = safeArray(scan.competitors)
  const top = competitors.slice(0, 5)

  slide.addText("Competitive Landscape", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  // Overview stats
  const crowded = crowdednessLabel(scan.crowdednessIndex)
  const totalFunding = scan.totalFundingInSpace > 0 ? formatCurrency(scan.totalFundingInSpace) : "N/A"
  slide.addText(`Crowdedness: ${crowded}  |  ${competitors.length} competitors  |  Total funding: ${totalFunding}`, {
    x: 0.6, y: 1.1, w: 8.8, h: 0.4, ...SUBTITLE_OPTS, fontSize: 11,
  })

  // Competitor table
  if (top.length > 0) {
    const tableRows: PptxGenJS.TableRow[] = [
      [
        { text: "Competitor", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" } } },
        { text: "Similarity", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" }, align: "center" } },
        { text: "Funding", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" }, align: "right" } },
        { text: "Team", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" }, align: "center" } },
        { text: "Description", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" } } },
      ],
    ]

    for (const c of top) {
      const cellOpts: PptxGenJS.TableCellProps = { fontSize: 9, color: TEXT_WHITE, fill: { color: DARK_BG } }
      tableRows.push([
        { text: s(c.name), options: { ...cellOpts, bold: true } },
        { text: `${c.similarityScore ?? 0}%`, options: { ...cellOpts, align: "center" } },
        { text: c.totalFundingUsd && c.totalFundingUsd > 0 ? formatCurrency(c.totalFundingUsd) : "-", options: { ...cellOpts, align: "right" } },
        { text: s(c.employeeCountRange || "-"), options: { ...cellOpts, align: "center" } },
        { text: s(c.description || "").slice(0, 80), options: cellOpts },
      ])
    }

    slide.addTable(tableRows, {
      x: 0.6, y: 1.7, w: 8.8,
      border: { type: "solid", pt: 0.5, color: "334155" },
      colW: [1.8, 0.9, 1.2, 1.0, 3.9],
      rowH: [0.35, ...Array(top.length).fill(0.45)],
    })
  }

  addSlideNumber(slide, 5)
}

function slide6_BusinessModel(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const bm = scan.ddReport.businessModel

  slide.addText("Business Model", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  const sections = [
    { label: "Recommended Model", value: s(bm?.recommendedModel) },
    { label: "Pricing Strategy", value: s(bm?.pricingStrategy) },
    { label: "Unit Economics", value: s(bm?.unitEconomics) },
    { label: "Comparables", value: s(bm?.comparables) },
  ]

  sections.forEach((sec, i) => {
    const x = i < 2 ? 0.6 : 5.0
    const y = i % 2 === 0 ? 1.4 : 3.8

    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: 4.2, h: 2.0, rectRadius: 0.1,
      fill: { color: "1E293B" }, line: { color: "334155", width: 1 },
    })
    slide.addText(sec.label, {
      x: x + 0.2, y: y + 0.15, w: 3.8, h: 0.35, ...HEADING_OPTS, fontSize: 12,
    })
    slide.addText(sec.value, {
      x: x + 0.2, y: y + 0.55, w: 3.8, h: 1.3, ...BODY_OPTS, fontSize: 10, valign: "top",
    })
  })

  addSlideNumber(slide, 6)
}

function slide7_GTM(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const dd = scan.ddReport

  slide.addText("Go-to-Market Strategy", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  // Channels
  const channels = safeArray(dd.goToMarket?.channels).slice(0, 4)
  if (channels.length > 0) {
    slide.addText("Channels", { x: 0.6, y: 1.2, w: 4.0, h: 0.3, ...HEADING_OPTS, fontSize: 12 })
    channels.forEach((ch, i) => {
      slide.addText(`${s(ch.channel)} (CAC: ${s(ch.estimatedCac)})`, {
        x: 0.6, y: 1.6 + i * 0.6, w: 4.2, h: 0.25, ...BODY_OPTS, fontSize: 10, bold: true,
      })
      slide.addText(s(ch.rationale), {
        x: 0.6, y: 1.85 + i * 0.6, w: 4.2, h: 0.3, ...LABEL_OPTS,
      })
    })
  }

  // Right side: milestone & expansion
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.2, y: 1.2, w: 4.4, h: 2.2, rectRadius: 0.1,
    fill: { color: "1E293B" }, line: { color: "334155", width: 1 },
  })
  slide.addText("First Milestone", {
    x: 5.4, y: 1.35, w: 4.0, h: 0.3, ...HEADING_OPTS, fontSize: 12,
  })
  slide.addText(s(dd.goToMarket?.firstMilestone), {
    x: 5.4, y: 1.7, w: 4.0, h: 0.6, ...BODY_OPTS, fontSize: 10, valign: "top",
  })

  slide.addText("Expansion Path", {
    x: 5.4, y: 2.5, w: 4.0, h: 0.3, ...HEADING_OPTS, fontSize: 12,
  })
  slide.addText(s(dd.wedgeStrategy?.expansionPath), {
    x: 5.4, y: 2.85, w: 4.0, h: 0.5, ...BODY_OPTS, fontSize: 10, valign: "top",
  })

  addSlideNumber(slide, 7)
}

function slide8_Defensibility(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const def = scan.ddReport.defensibility

  slide.addText("Defensibility & Moat", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  const sections = [
    { label: "Moat Type", value: s(def?.moatType) },
    { label: "Time to Build", value: s(def?.timeToMoat) },
    { label: "Strength Assessment", value: s(def?.strengthAssessment) },
    { label: "Key Risks", value: s(def?.risks) },
  ]

  sections.forEach((sec, i) => {
    const y = 1.3 + i * 1.3
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6, y, w: 0.06, h: 0.9, fill: { color: ACCENT },
    })
    slide.addText(sec.label, {
      x: 0.9, y, w: 8.5, h: 0.3, ...HEADING_OPTS, fontSize: 12,
    })
    slide.addText(sec.value, {
      x: 0.9, y: y + 0.35, w: 8.5, h: 0.55, ...BODY_OPTS, fontSize: 10, valign: "top",
    })
  })

  addSlideNumber(slide, 8)
}

function slide9_Risks(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)
  const risks = safeArray(scan.ddReport.risksMitigations).slice(0, 4)

  slide.addText("Risks & Mitigations", { x: 0.6, y: 0.4, w: 8.8, h: 0.6, ...TITLE_OPTS })

  if (risks.length > 0) {
    // Table header
    const tableRows: PptxGenJS.TableRow[] = [
      [
        { text: "Risk", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" } } },
        { text: "Likelihood", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" }, align: "center" } },
        { text: "Impact", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" }, align: "center" } },
        { text: "Mitigation", options: { bold: true, color: ACCENT_LIGHT, fontSize: 10, fill: { color: "1E293B" } } },
      ],
    ]

    for (const r of risks) {
      const cellOpts: PptxGenJS.TableCellProps = { fontSize: 9, color: TEXT_WHITE, fill: { color: DARK_BG }, valign: "top" }
      tableRows.push([
        { text: s(r.risk), options: { ...cellOpts, bold: true } },
        { text: s(r.likelihood), options: { ...cellOpts, align: "center" } },
        { text: s(r.impact), options: { ...cellOpts, align: "center" } },
        { text: s(r.mitigation), options: cellOpts },
      ])
    }

    slide.addTable(tableRows, {
      x: 0.6, y: 1.3, w: 8.8,
      border: { type: "solid", pt: 0.5, color: "334155" },
      colW: [2.5, 1.0, 1.0, 4.3],
      rowH: [0.35, ...Array(risks.length).fill(0.7)],
    })
  }

  addSlideNumber(slide, 9)
}

function slide10_Ask(pptx: PptxGenJS, scan: SavedScan) {
  const slide = pptx.addSlide()
  addBackground(slide)

  // Accent line at bottom
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 7.44, w: 10, h: 0.06, fill: { color: ACCENT },
  })

  slide.addText("The Ask", {
    x: 0.6, y: 1.5, w: 8.8, h: 0.8, ...TITLE_OPTS, fontSize: 36, align: "center",
  })

  slide.addText("[Funding amount] to achieve [key milestones]", {
    x: 1.5, y: 2.8, w: 7.0, h: 0.6,
    ...SUBTITLE_OPTS, fontSize: 18, align: "center", italic: true,
  })

  const bullets = [
    "Product development & engineering",
    "Go-to-market & customer acquisition",
    "Team expansion",
    "Operations & infrastructure",
  ]
  bullets.forEach((b, i) => {
    slide.addText(b, {
      x: 2.5, y: 3.8 + i * 0.45, w: 5.0, h: 0.4, ...BULLET_OPTS, fontSize: 12,
    })
  })

  slide.addText(s(scan.ideaText), {
    x: 1.5, y: 5.8, w: 7.0, h: 0.4,
    fontSize: 14, color: ACCENT_LIGHT, fontFace: "Arial", align: "center", bold: true,
  })
  slide.addText("contact@example.com", {
    x: 1.5, y: 6.3, w: 7.0, h: 0.3,
    fontSize: 11, color: TEXT_MUTED, fontFace: "Arial", align: "center",
  })

  addSlideNumber(slide, 10)
}

// ─── Public API ───

export async function generatePitchDeck(scan: SavedScan): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE" // 13.33 x 7.5 — standard widescreen
  pptx.author = "DeepRecon"
  pptx.title = `${s(scan.intent?.vertical)}: ${s(scan.ideaText).slice(0, 60)}`

  slide1_Title(pptx, scan)
  slide2_Problem(pptx, scan)
  slide3_Solution(pptx, scan)
  slide4_MarketSize(pptx, scan)
  slide5_Competition(pptx, scan)
  slide6_BusinessModel(pptx, scan)
  slide7_GTM(pptx, scan)
  slide8_Defensibility(pptx, scan)
  slide9_Risks(pptx, scan)
  slide10_Ask(pptx, scan)

  const output = await pptx.write({ outputType: "nodebuffer" })
  return Buffer.from(output as ArrayBuffer)
}
