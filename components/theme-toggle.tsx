"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { cn } from "@/lib/utils"

export function ThemeToggle() {
  const { mode, toggle } = useStudioTheme()
  const [mounted, setMounted] = React.useState(false)
  const isBlack = mode === "black"

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="relative">
        <Sun className="h-5 w-5" />
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => toggle()}
      className={cn("relative", isBlack ? "text-white hover:bg-white/10" : "text-foreground hover:bg-slate-200/80")}
    >
      {isBlack ? (
        <Sun className="h-5 w-5 transition-all" aria-hidden />
      ) : (
        <Moon className="h-5 w-5 transition-all" aria-hidden />
      )}
      <span className="sr-only">Alternar tema (Black / Classic)</span>
    </Button>
  )
}
