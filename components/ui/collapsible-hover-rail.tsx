"use client";

import type { FocusEvent, PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useWorkspaceFocus } from "@/components/painel-inicial/workspace-focus-context";
import type { WorkspaceOverlayGroup, WorkspaceOverlayId } from "@/lib/workspace-overlay-orchestrator";
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
  const focused = useRef(false);
  const groupState = overlayState.groups[overlayGroup];
  const expanded = groupState.activeOverlay === overlayId;
  const pinned = groupState.pinnedOverlay === overlayId;

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!expanded || pinned) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeOverlay(overlayId, overlayGroup);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeOverlay, expanded, overlayGroup, overlayId, pinned]);

  const requestOpen = useCallback(() => {
    openOverlay(overlayId, overlayGroup);
  }, [openOverlay, overlayGroup, overlayId]);

  const scheduleRelease = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!hovered.current && !focused.current) releaseOverlay(overlayId, overlayGroup);
    }, closeDelay);
  }, [closeDelay, overlayGroup, overlayId, releaseOverlay]);

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    hovered.current = true;
    clearTimers();
    openTimer.current = setTimeout(requestOpen, openDelay);
  };

  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    hovered.current = false;
    if (openTimer.current) clearTimeout(openTimer.current);
    scheduleRelease();
  };

  const onPointerDownCapture = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" || expanded) return;
    event.preventDefault();
    event.stopPropagation();
    requestOpen();
  };

  const onFocus = () => {
    focused.current = true;
    clearTimers();
    requestOpen();
  };

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    focused.current = false;
    scheduleRelease();
  };

  const collapse = () => {
    hovered.current = false;
    focused.current = false;
    clearTimers();
    closeOverlay(overlayId, overlayGroup);
  };

  return (
    <div
      ref={rootRef}
      className={cn("relative hidden shrink-0 lg:block", className)}
      style={{ width: compactWidth, zIndex: priority }}
      data-overlay-slot={overlayId}
      data-reserved-width={compactWidth}
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
        data-pinned={pinned ? "true" : "false"}
        className={cn(
          "absolute inset-y-0 isolate overflow-hidden border-border bg-card shadow-none transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          expanded && "shadow-[0_18px_44px_rgba(15,23,42,0.16)]",
          panelClassName,
        )}
        style={{ width: expanded ? expandedWidth : compactWidth, zIndex: priority }}
      >
        {children({
          expanded,
          pinned,
          togglePinned: () => toggleOverlayPinned(overlayId, overlayGroup),
          collapse,
        })}
      </aside>
    </div>
  );
}
