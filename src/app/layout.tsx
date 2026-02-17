import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Recon — Know your competition before you build",
  description:
    "Get a VC-grade competitive analysis in under 5 minutes. Real data. Actionable strategy. Not another AI idea validator.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "Recon — Know your competition before you build",
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
      <body className={inter.className}>{children}</body>
    </html>
  )
}
