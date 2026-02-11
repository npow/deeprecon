"use client"

import { useState } from "react"
import {
  LayoutGrid,
  Grid3X3,
  Target,
  Circle,
  Activity,
} from "lucide-react"
import { type VerticalMap } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CardsView } from "./cards-view"
import { OpportunityScatterView } from "./opportunity-scatter-view"
import { LandscapeView } from "./landscape-view"
import { QuadrantView } from "./quadrant-view"
import { StrategyCanvasView } from "./strategy-canvas-view"

type ViewId = "cards" | "landscape" | "quadrant" | "scatter" | "canvas"

const VIEWS: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "cards", label: "Cards", icon: LayoutGrid },
  { id: "landscape", label: "Landscape", icon: Grid3X3 },
  { id: "quadrant", label: "Quadrant", icon: Target },
  { id: "scatter", label: "Scatter", icon: Circle },
  { id: "canvas", label: "Canvas", icon: Activity },
]

export function MapViewTabs({ map }: { map: VerticalMap }) {
  const [activeView, setActiveView] = useState<ViewId>("cards")

  return (
    <div>
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        {VIEWS.map((view) => {
          const active = activeView === view.id
          const Icon = view.icon
          return (
            <button
              key={view.id}
              onClick={() => setActiveView(view.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all",
                active
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-900"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {view.label}
            </button>
          )
        })}
      </div>

      {/* View content */}
      <div className="animate-view-enter" key={activeView}>
        {activeView === "cards" && <CardsView subCategories={map.subCategories} verticalSlug={map.slug} />}
        {activeView === "scatter" && <OpportunityScatterView map={map} />}
        {activeView === "landscape" && <LandscapeView map={map} />}
        {activeView === "quadrant" && <QuadrantView map={map} />}
        {activeView === "canvas" && <StrategyCanvasView map={map} />}
      </div>
    </div>
  )
}
