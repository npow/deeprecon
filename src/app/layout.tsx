import type { Metadata } from "next"
import Script from "next/script"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "DeepRecon — Know your competition before you build",
  description:
    "Get a VC-grade competitive analysis in under 5 minutes. Real data. Actionable strategy. Not another AI idea validator.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "DeepRecon — Know your competition before you build",
    description:
      "Get a VC-grade competitive analysis in under 5 minutes. Real data. Actionable strategy.",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <Script
          defer
          data-domain="deeprecon.app"
          src="https://plausible.deeprecon.app/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js"
          strategy="afterInteractive"
        />
        <Script id="plausible-queue" strategy="afterInteractive">
          {`window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }`}
        </Script>
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
