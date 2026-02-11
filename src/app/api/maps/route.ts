import { NextResponse } from "next/server"
import { listGeneratedSlugs, loadMap } from "@/lib/maps-store"
import { loadVerticals } from "@/lib/verticals-store"

export async function GET() {
  const generated = listGeneratedSlugs()
  const allVerticals = loadVerticals()

  const verticals = allVerticals.map((v) => {
    const map = generated.includes(v.slug) ? loadMap(v.slug) : null
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
