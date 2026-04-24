"use client"

import { Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function AiMestreCommandBar() {
  const router = useRouter()

  return (
    <div className="pointer-events-none fixed top-16 left-0 right-0 z-40 flex justify-center px-3 md:px-4">
      <div className="pointer-events-auto">
        <Button
          type="button"
          className="rounded-full shadow-lg shadow-primary/10 border border-primary/25 bg-background/95 backdrop-blur-md"
          onClick={() => router.push("/dashboard/ia-mestre")}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          IA Mestre
        </Button>
      </div>
    </div>
  )
}
