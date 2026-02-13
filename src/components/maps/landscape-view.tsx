"use client"

import Link from "next/link"
import { stringify } from "@/lib/utils"
import { type VerticalMap, type SubCategory, type MegaCategoryDef } from "@/lib/types"

interface MegaGroup {
  name: string
  color: string
  subCategories: SubCategory[]
}

function groupByMega(map: VerticalMap): MegaGroup[] {
  const colorMap = new Map<string, string>()
  map.megaCategories.forEach((mc: MegaCategoryDef) => colorMap.set(mc.name, mc.color))

  const groupMap = new Map<string, SubCategory[]>()
  for (const sub of map.subCategories) {
    const key = sub.megaCategory
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(sub)
  }

  return Array.from(groupMap.entries()).map(([name, subs]) => ({
    name,
    color: colorMap.get(name) || "#6366f1",
    subCategories: subs,
  }))
}

export function LandscapeView({ map }: { map: VerticalMap }) {
  const groups = groupByMega(map)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Landscape Map</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Market landscape grouped by mega-categories. Companies shown as chips within each sub-category.
        </p>
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <div
            key={group.name}
            className="bg-white border border-gray-200 rounded-xl overflow-hidden"
          >
            {/* Mega-category header */}
            <div
              className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100"
              style={{ borderLeft: `4px solid ${group.color}` }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: group.color }}
              />
              <span className="text-sm font-semibold text-gray-900">{group.name}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {group.subCategories.length} sub-categories
              </span>
            </div>

            {/* Sub-category cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
              {group.subCategories.map((sub) => (
                <Link
                  key={sub.slug}
                  href={`/maps/${map.slug}/${sub.slug}`}
                  className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50 transition-colors block"
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">{stringify(sub.name)}</h4>
                      <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{stringify(sub.description)}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <div className="text-xs font-bold text-gray-700">{sub.opportunityScore}</div>
                      <div className="text-[9px] text-gray-400">opp.</div>
                    </div>
                  </div>

                  {/* Player chips — show top 20, link to detail for all */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {sub.topPlayers.slice(0, 20).map((p, i) => (
                      <span
                        key={i}
                        className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"
                        title={stringify(p.oneLiner)}
                      >
                        {stringify(p.name)}
                      </span>
                    ))}
                    {sub.topPlayers.length > 20 && (
                      <span className="text-[10px] text-gray-400 px-1 py-0.5">
                        +{sub.topPlayers.length - 20} more
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
