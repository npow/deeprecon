"use client"

import { stringify } from "@/lib/utils"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

function promoteCommaSeparatedSentenceList(raw: string): string {
  // Some model outputs are sentence lists flattened as:
  // "Sentence one., Sentence two., Sentence three."
  const text = raw.replace(/\r\n/g, "\n").trim()
  if (!text || text.includes("\n")) return text
  const parts = text
    .split(/(?<=[.!?])\s*,\s+(?=[A-Z0-9"'])/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 3) return text
  const allSentenceLike = parts.every((p) => p.length >= 20 && /[.!?]$/.test(p))
  if (!allSentenceLike) return text
  return parts.map((p) => `- ${p}`).join("\n")
}

function normalizeForMarkdown(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/^"([\s\S]*)"$/, "$1")
    // Flatten artifacts from comma-joined sentence arrays: "foo., bar" -> "foo. bar"
    .replace(/([.!?])\s*,\s+/g, "$1 ")
    .replace(/([.!?])\1+(?=\s|$)/g, "$1")
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
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => normalizeForMarkdown(stringify(entry)))
      .map((entry) => entry.replace(/^\s*[-*]\s+/, "").trim())
      .filter(Boolean)
    if (items.length === 0) return null

    const markdown = inline
      ? items.join(", ")
      : items.map((entry) => `- ${entry}`).join("\n")

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
          {markdown}
        </ReactMarkdown>
      </Wrapper>
    )
  }

  const raw = stringify(value)
  if (!raw) return null

  const normalized = normalizeForMarkdown(
    inline ? raw : promoteCommaSeparatedSentenceList(raw)
  )
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
