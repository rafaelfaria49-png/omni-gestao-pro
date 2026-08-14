"use client";

import type { FocusEvent, PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useWorkspaceFocus } from "@/components/painel-inicial/workspace-focus-context";
import { isRailDocked, type WorkspaceOverlayGroup, type WorkspaceOverlayId } from "@/lib/workspace-overlay-orchestrator";
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
  overlayId: WorkspaceOverlayId;
  overlayGroup: WorkspaceOverlayGroup;
  priority: number;
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
  overlayId,
  overlayGroup,
  priority,
  children,
  className,
  panelClassName,
  side = "left",
  openDelay = 170,
  closeDelay = 210,
}: CollapsibleHoverRailProps) {
  const {
    overlayState,
    openOverlay,
    releaseOverlay,
    toggleOverlayPinned,
    closeOverlay,
  } = useWorkspaceFocus();
  const rootRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const keyboardFocus = useRef(false);
  const groupState = overlayState.groups[overlayGroup];
  const docked = isRailDocked(overlayState, overlayId);
  const temporary = groupState.activeOverlay === overlayId;
  const expanded = docked || temporary;

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!temporary || docked) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeOverlay(overlayId, overlayGroup);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeOverlay, docked, overlayGroup, overlayId, temporary]);

  const requestOpen = useCallback(() => {
    if (docked) return;
    openOverlay(overlayId, overlayGroup);
  }, [docked, openOverlay, overlayGroup, overlayId]);

  const scheduleRelease = useCallback(() => {
    if (docked) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!hovered.current && !keyboardFocus.current) releaseOverlay(overlayId, overlayGroup);
    }, closeDelay);
  }, [closeDelay, docked, overlayGroup, overlayId, releaseOverlay]);

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    hovered.current = true;
    keyboardFocus.current = false;
    clearTimers();
    if (!docked) openTimer.current = setTimeout(requestOpen, openDelay);
  };

  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    hovered.current = false;
    keyboardFocus.current = false;
    if (openTimer.current) clearTimeout(openTimer.current);
    scheduleRelease();
  };

  const onPointerDownCapture = (event: PointerEvent<HTMLElement>) => {
    keyboardFocus.current = false;
    if (event.pointerType !== "touch" || expanded) return;
    event.preventDefault();
    event.stopPropagation();
    requestOpen();
  };

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const visible = event.target instanceof HTMLElement && event.target.matches(":focus-visible");
    if (!visible) return;
    keyboardFocus.current = true;
    clearTimers();
    requestOpen();
  };

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    keyboardFocus.current = false;
    scheduleRelease();
  };

  const collapse = () => {
    hovered.current = false;
    keyboardFocus.current = false;
    clearTimers();
    if (!docked) closeOverlay(overlayId, overlayGroup);
  };

  const reservedWidth = docked ? expandedWidth : compactWidth;

  return (
    <div
      ref={rootRef}
      className={cn("relative hidden shrink-0 lg:block", className)}
      style={{ width: reservedWidth, zIndex: docked ? undefined : priority }}
      data-overlay-slot={overlayId}
      data-reserved-width={reservedWidth}
      data-docked={docked ? "true" : "false"}
    >
      <aside
        aria-label={ariaLabel}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDownCapture={onPointerDownCapture}
        onFocus={onFocus}
        onBlur={onBlur}
        data-overlay-id={overlayId}
        data-overlay-group={overlayGroup}
        data-expanded={expanded ? "true" : "false"}
        data-pinned={docked ? "true" : "false"}
        className={cn(
          "isolate overflow-hidden border-border bg-card transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
          docked
            ? "relative h-full w-full shadow-none"
            : cn(
                "absolute inset-y-0 shadow-none",
                side === "left" ? "left-0 border-r" : "right-0 border-l",
                expanded && "shadow-[0_18px_44px_rgba(15,23,42,0.16)]",
              ),
          panelClassName,
        )}
        style={docked ? undefined : { width: expanded ? expandedWidth : compactWidth, zIndex: priority }}
      >
        {children({
          expanded,
          pinned: docked,
          togglePinned: () => toggleOverlayPinned(overlayId, overlayGroup),
          collapse,
        })}
      </aside>
    </div>
  );
}
