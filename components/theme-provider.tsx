'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'
import { StudioThemeProvider } from '@/components/theme/ThemeProvider'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <StudioThemeProvider>{children}</StudioThemeProvider>
    </NextThemesProvider>
  )
}
