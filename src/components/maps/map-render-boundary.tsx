"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"

interface MapRenderBoundaryProps {
  children: ReactNode
}

interface MapRenderBoundaryState {
  hasError: boolean
}

export class MapRenderBoundary extends Component<MapRenderBoundaryProps, MapRenderBoundaryState> {
  state: MapRenderBoundaryState = { hasError: false }

  static getDerivedStateFromError(): MapRenderBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Map render crash prevented by boundary", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-red-200 bg-red-50 text-red-700 rounded-lg p-4 text-sm">
          We hit a rendering issue with this map data. Please refresh or re-run enrichment.
        </div>
      )
    }
    return this.props.children
  }
}
