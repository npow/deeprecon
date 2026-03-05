import { NextResponse } from "next/server"
import { loadAllMaps } from "@/lib/maps-store"
import { loadVerticals } from "@/lib/verticals-store"
import { withRelayTelemetry } from "@/lib/relay-observability"

async function getMaps() {
  const maps = await loadAllMaps()
  const mapBySlug = new Map(maps.map((m) => [m.slug, m]))
  const allVerticals = await loadVerticals()

  const verticals = allVerticals.map((v) => {
    const map = mapBySlug.get(v.slug) || null
    return {
      ...v,
      generated: !!map,
      generatedAt: map?.generatedAt ?? null,
      totalPlayers: map?.totalPlayers ?? null,
      totalFunding: map?.totalFunding ?? null,
      overallCrowdedness: map?.overallCrowdedness ?? null,
      averageOpportunity: map?.averageOpportunity ?? null,
      subCategoryCount: map?.subCategories.length ?? null,
    }
  })

  return NextResponse.json({ verticals })
}

export const GET = withRelayTelemetry(async (_request, _context) => getMaps())
