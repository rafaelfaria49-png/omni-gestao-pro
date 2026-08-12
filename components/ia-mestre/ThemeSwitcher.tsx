"use client";

import { motion } from "framer-motion";
import { Check, Sun, Gem, Snowflake, Moon, Zap, Hexagon, Star, Coffee } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useEffect, useState } from "react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Theme =
  | "light"
  | "soft-ice"
  | "midnight"
  | "black-edition"
  | "quantum-violet"
  | "coffee-gold"
  | "ruby-black"
  | "neon-ice"
  | "violet-ice"
  | "coffee-cream";

const options: { value: Theme; label: string; icon: any }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "ruby-black", label: "Ruby Black", icon: Gem },
  { value: "soft-ice", label: "Soft Ice", icon: Snowflake },
  { value: "midnight", label: "Midnight", icon: Moon },
  { value: "neon-ice", label: "Neon Ice", icon: Zap },
  { value: "black-edition", label: "Black", icon: Hexagon },
  { value: "violet-ice", label: "Violet Ice", icon: Star },
  { value: "quantum-violet", label: "Quantum Violet", icon: Gem },
  { value: "coffee-cream", label: "Coffee Cream", icon: Coffee },
  { value: "coffee-gold", label: "Coffee Gold", icon: Coffee },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={compact ? "h-8 w-8 rounded-md border border-border bg-panel" : "h-10 w-[340px] rounded-xl border border-border/80 bg-card/60 backdrop-blur-md"} />;
  }

  if (compact) {
    const activeOption = options.find((option) => option.value === theme) ?? options[0];

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Tema atual: ${activeOption.label}. Abrir seletor de temas`}
            title={`Tema: ${activeOption.label}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel text-primary transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="h-3.5 w-3.5 rounded-full border-2 border-background bg-primary shadow-sm" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2.5">
          <div className="px-1 pb-2">
            <p className="text-xs font-semibold text-foreground">Tema da interface</p>
            <p className="text-[11px] text-muted-foreground">Escolha entre os 10 temas existentes.</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-1" role="listbox" aria-label="Temas da interface">
            {options.map((opt) => {
              const Icon = opt.icon;
              const active = theme === opt.value;

              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setTheme(opt.value)}
                  className="relative flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {active && (
                    <motion.span
                      layoutId="active-theme-bg"
                      className="absolute inset-0 rounded-md border border-border bg-muted/80 shadow-sm"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <Icon className="relative z-10 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="relative z-10 min-w-0 flex-1 truncate text-foreground">{opt.label}</span>
                  {active ? <Check className="relative z-10 h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className="relative inline-flex items-center gap-1 rounded-xl border border-border/80 bg-card/60 p-1 backdrop-blur-md shadow-soft">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          
          return (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTheme(opt.value)}
                  className="group relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={opt.label}
                  type="button"
                >
                  {active && (
                    <motion.span
                      layoutId="active-theme-bg"
                      className="absolute inset-0 rounded-lg bg-muted/80 border border-border/60 shadow-sm"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <Icon 
                    className={`relative z-10 h-4 w-4 transition-all duration-300 ${active ? "scale-110 text-primary" : "group-hover:scale-105"}`}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="z-50 text-[11px] font-semibold bg-popover text-popover-foreground border border-border shadow-md px-2 py-1">
                {opt.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
