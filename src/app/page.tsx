import { Suspense } from "react"
import HomeInner from "@/components/home/home-inner"

export default function HomePage() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  )
}
