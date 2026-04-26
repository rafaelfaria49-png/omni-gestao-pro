"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme/ThemeProvider"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-10 w-10 shrink-0 rounded-xl border-white/10 bg-white/5 text-white/80 transition-colors duration-300 hover:bg-white/10 data-[studio=classic]:border-slate-200 data-[studio=classic]:bg-white data-[studio=classic]:text-slate-800 data-[studio=classic]:hover:bg-slate-50"
      data-studio={theme === "dark" ? "black" : "classic"}
      aria-label={theme === "dark" ? "Ativar tema Classic" : "Ativar tema Black"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
