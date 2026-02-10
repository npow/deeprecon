import { NextResponse } from "next/server"
import { VERTICALS } from "@/lib/types"
import { listGeneratedSlugs, loadMap } from "@/lib/maps-store"

export async function GET() {
  const generated = listGeneratedSlugs()

  const verticals = VERTICALS.map((v) => {
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
