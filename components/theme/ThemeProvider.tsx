"use client"

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useTheme as useNextThemes } from "next-themes"

export type StudioThemeMode = "black" | "classic"

const STORAGE_KEY = "omni-studio-dual-theme"

type StudioThemeContextValue = {
  /** Modo do estúdio / shell (Black vs Classic). */
  mode: StudioThemeMode
  setMode: (m: StudioThemeMode) => void
  toggle: () => void
}

const StudioThemeContext = createContext<StudioThemeContextValue | null>(null)

function readInitialMode(): StudioThemeMode {
  if (typeof window === "undefined") return "black"
  try {
    const v = String(localStorage.getItem(STORAGE_KEY) || "").trim()
    return v === "classic" ? "classic" : "black"
  } catch {
    return "black"
  }
}

function persistAndSyncDom(m: StudioThemeMode, setTheme: (t: string) => void) {
  try {
    localStorage.setItem(STORAGE_KEY, m)
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-studio-theme", m)
  }
  setTheme(m === "classic" ? "light" : "dark")
}

/**
 * Tema dual do produto (Marketing Studio + shell): sincroniza `data-studio-theme` no `<html>`
 * e espelha em `next-themes` (dark = Black, light = Classic) para tokens globais.
 */
export function StudioThemeProvider({ children }: { children: ReactNode }) {
  const { setTheme } = useNextThemes()
  const [mode, setModeState] = useState<StudioThemeMode>("black")

  useLayoutEffect(() => {
    const initial = readInitialMode()
    setModeState(initial)
    persistAndSyncDom(initial, setTheme)
  }, [setTheme])

  const setMode = useCallback(
    (m: StudioThemeMode) => {
      setModeState(m)
      persistAndSyncDom(m, setTheme)
    },
    [setTheme]
  )

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next = prev === "black" ? "classic" : "black"
      persistAndSyncDom(next, setTheme)
      return next
    })
  }, [setTheme])

  const value = useMemo<StudioThemeContextValue>(
    () => ({
      mode,
      setMode,
      toggle,
    }),
    [mode, setMode, toggle]
  )

  return <StudioThemeContext.Provider value={value}>{children}</StudioThemeContext.Provider>
}

export function useStudioTheme(): StudioThemeContextValue {
  const c = useContext(StudioThemeContext)
  if (!c) {
    throw new Error("useStudioTheme must be used within StudioThemeProvider")
  }
  return c
}

/** API compatível com o snippet Lovable (`theme === "dark"` = Black Edition). */
export function useTheme() {
  const { mode, setMode, toggle } = useStudioTheme()
  return {
    theme: mode === "black" ? ("dark" as const) : ("light" as const),
    mode,
    setTheme: (t: "dark" | "light") => setMode(t === "dark" ? "black" : "classic"),
    toggle,
  }
}
