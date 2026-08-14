"use client";

import type { FocusEvent, PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type CollapsibleRailState = {
  expanded: boolean;
  pinned: boolean;
  togglePinned: () => void;
  collapse: () => void;
};

type CollapsibleHoverRailProps = {
  ariaLabel: string;
  compactWidth: number;
  expandedWidth: number;
  children: (state: CollapsibleRailState) => ReactNode;
  className?: string;
  panelClassName?: string;
  side?: "left" | "right";
  openDelay?: number;
  closeDelay?: number;
};

export function CollapsibleHoverRail({
  ariaLabel,
  compactWidth,
  expandedWidth,
  children,
  className,
  panelClassName,
  side = "left",
  openDelay = 170,
  closeDelay = 220,
}: CollapsibleHoverRailProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expanded = pinned || hovered || focused;

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    clearTimers();
    openTimer.current = setTimeout(() => setHovered(true), openDelay);
  };

  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    clearTimers();
    closeTimer.current = setTimeout(() => setHovered(false), closeDelay);
  };

  const onFocus = () => {
    clearTimers();
    setFocused(true);
  };

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
  };

  const collapse = () => {
    setPinned(false);
    setHovered(false);
  };

  return (
    <div
      className={cn("relative z-40 hidden shrink-0 lg:block", className)}
      style={{ width: compactWidth }}
    >
      <aside
        aria-label={ariaLabel}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(
          "absolute inset-y-0 overflow-hidden border-border bg-background shadow-none transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          expanded && "shadow-xl",
          panelClassName,
        )}
        style={{ width: expanded ? expandedWidth : compactWidth }}
      >
        {children({
          expanded,
          pinned,
          togglePinned: () => setPinned((value) => !value),
          collapse,
        })}
      </aside>
    </div>
  );
}
