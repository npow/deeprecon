import { NextRequest, NextResponse } from "next/server"
import { VERTICALS } from "@/lib/types"
import { loadMap, saveMap } from "@/lib/maps-store"
import { generateVerticalMap } from "@/lib/ai/pipeline"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const vertical = VERTICALS.find((v) => v.slug === slug)
  if (!vertical) {
    return NextResponse.json({ error: "Unknown vertical" }, { status: 404 })
  }

  const map = loadMap(slug)
  if (!map) {
    return NextResponse.json({ error: "Map not generated yet" }, { status: 404 })
  }

  return NextResponse.json(map)
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const vertical = VERTICALS.find((v) => v.slug === slug)
  if (!vertical) {
    return NextResponse.json({ error: "Unknown vertical" }, { status: 404 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    )
  }

  try {
    const result = await generateVerticalMap(vertical.name, vertical.description)

    const map = {
      slug: vertical.slug,
      name: vertical.name,
      description: vertical.description,
      generatedAt: new Date().toISOString(),
      ...result,
    }

    saveMap(slug, map)

    return NextResponse.json(map)
  } catch (error) {
    console.error(`Failed to generate map for ${slug}:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    )
  }
}
