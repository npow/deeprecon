"use client"

import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center px-4 py-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-4 max-w-md text-center">
            An error occurred while rendering this section. Try refreshing the page.
          </p>
          <details className="text-xs text-gray-400 max-w-md">
            <summary className="cursor-pointer hover:text-gray-600">Error details</summary>
            <pre className="mt-2 p-2 bg-gray-50 rounded text-[11px] overflow-auto max-h-32">
              {this.state.error.message}
            </pre>
          </details>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
