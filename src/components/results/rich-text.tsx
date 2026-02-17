"use client"

import { stringify } from "@/lib/utils"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

function normalizeForMarkdown(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(\d+\.)\*\*/g, "$1")
    .replace(/\n?\s*[•]\s*/g, "\n- ")
    .replace(/;\s*(?=\d+\.\s+)/g, "\n")
    .replace(/\s+(\d+\.\s+)/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function RichText({
  value,
  className = "",
  inline = false,
}: {
  value: unknown
  className?: string
  inline?: boolean
}) {
  const raw = stringify(value)
  if (!raw) return null

  const normalized = normalizeForMarkdown(raw)
  if (!normalized) return null

  const Wrapper = inline ? "span" : "div"

  return (
    <Wrapper className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => inline
            ? <span className="leading-relaxed">{children}</span>
            : <p className="leading-relaxed mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 mb-2 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 mb-2 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </Wrapper>
  )
}
