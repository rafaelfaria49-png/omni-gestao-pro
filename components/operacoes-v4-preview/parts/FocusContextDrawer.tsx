"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  History,
  Mail,
  MessageCircle,
  Phone,
  Pin,
  Smartphone,
  UserRound,
  X,
} from "lucide-react";
import { useWorkspaceFocus } from "@/components/painel-inicial/workspace-focus-context";
import { WORKSPACE_OVERLAY_PRIORITY } from "@/lib/workspace-overlay-orchestrator";
import { C, MONO } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { maskSenhaV4, NI } from "../os-adapter";

const OVERLAY_ID = "os-context" as const;
const OVERLAY_GROUP = "workspace-left" as const;

function SenhaContextRow({ senha, senhaTipo }: { senha: string; senhaTipo: string }) {
  const [revealed, setRevealed] = useState(false);
  const hasPassword = Boolean(senha && senha !== NI);
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">Senha</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          title={hasPassword && !revealed ? "Senha oculta — use o botão para revelar" : undefined}
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-muted px-2 py-1 font-semibold text-foreground"
          style={{ fontFamily: MONO }}
        >
          {hasPassword ? (revealed ? senha : maskSenhaV4(senha, senhaTipo)) : NI}
        </span>
        {hasPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? "Ocultar senha" : "Revelar senha"}
            title={revealed ? "Ocultar senha" : "Revelar senha"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        ) : null}
      </span>
    </div>
  );
}

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-semibold text-foreground" style={{ color: valueColor }}>{value}</span>
    </div>
  );
}

export function FocusContextDrawer({ v }: { v: V4Vals }) {
  const {
    overlayState,
    openOverlay,
    releaseOverlay,
    toggleOverlayPinned,
    closeOverlay,
  } = useWorkspaceFocus();
  const panelRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupState = overlayState.groups[OVERLAY_GROUP];
  const expanded = groupState.activeOverlay === OVERLAY_ID;
  const pinned = groupState.pinnedOverlay === OVERLAY_ID;
  const os = v.os;

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const scheduleRelease = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      const triggerHovered = document.querySelector('[data-overlay-trigger="os-context"]:hover');
      if (!panelRef.current?.matches(":hover") && !triggerHovered) {
        releaseOverlay(OVERLAY_ID, OVERLAY_GROUP);
      }
    }, 210);
  }, [clearCloseTimer, releaseOverlay]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ((event.target as Element | null)?.closest?.('[data-overlay-trigger="os-context"]')) return;
      closeOverlay(OVERLAY_ID, OVERLAY_GROUP);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeOverlay, expanded]);

  return (
    <aside
      ref={panelRef}
      aria-label="Contexto da OS"
      aria-hidden={!expanded}
      inert={!expanded}
      data-overlay-id={OVERLAY_ID}
      data-overlay-group={OVERLAY_GROUP}
      data-expanded={expanded ? "true" : "false"}
      onPointerEnter={() => {
        clearCloseTimer();
        openOverlay(OVERLAY_ID, OVERLAY_GROUP);
      }}
      onPointerLeave={scheduleRelease}
      className="absolute inset-y-0 left-0 isolate flex w-80 flex-col overflow-hidden border-r border-border bg-card shadow-[0_20px_48px_rgba(15,23,42,0.18)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
      style={{
        zIndex: WORKSPACE_OVERLAY_PRIORITY[OVERLAY_ID],
        transform: expanded ? "translateX(0)" : "translateX(-102%)",
        opacity: expanded ? 1 : 0,
        pointerEvents: expanded ? "auto" : "none",
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><UserRound size={14} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Contexto da OS</div>
          <div className="truncate text-xs font-semibold text-foreground">Cliente · aparelho · SLA</div>
        </div>
        <button
          type="button"
          onClick={() => toggleOverlayPinned(OVERLAY_ID, OVERLAY_GROUP)}
          aria-label={pinned ? "Desafixar contexto" : "Fixar contexto aberto"}
          aria-pressed={pinned}
          title={pinned ? "Desafixar" : "Fixar aberto"}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pin size={13} fill={pinned ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={() => closeOverlay(OVERLAY_ID, OVERLAY_GROUP)}
          aria-label="Fechar contexto da OS"
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-extrabold text-primary">{os.avatarInitials}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-foreground">{os.cliente}</div>
            <div className="truncate text-[11px] text-muted-foreground">{os.documento}</div>
          </div>
        </div>

        <div className="flex gap-2 py-3">
          <button type="button" onClick={v.act.whatsapp} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted"><MessageCircle size={13} /> WhatsApp</button>
          <button type="button" onClick={v.act.ligar} title="Ligar" aria-label="Ligar para cliente" className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"><Phone size={13} /></button>
          <button type="button" onClick={v.toHistCliente} title="Histórico" aria-label="Abrir histórico do cliente" className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"><History size={13} /></button>
        </div>

        <div className="grid gap-2 text-xs text-foreground">
          <span className="flex items-center gap-2"><Phone size={12} className="text-muted-foreground" />{os.telefone}</span>
          <span className="flex min-w-0 items-center gap-2"><Mail size={12} className="shrink-0 text-muted-foreground" /><span className="truncate">{os.email}</span></span>
        </div>

        <div className="mt-5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground"><Smartphone size={13} /> Aparelho</div>
        <div className="mt-2 text-sm font-bold text-foreground">{os.aparelho}</div>
        <div className="text-xs text-muted-foreground">{os.cor} · {os.tipo}</div>

        <div className="mt-4 grid gap-2.5 border-b border-border pb-4">
          <DetailRow label="IMEI / Série" value={os.serieCurta} />
          <SenhaContextRow senha={os.senha} senhaTipo={os.senhaTipo} />
          <DetailRow label="Recebido por" value={os.recebidoPor} />
        </div>

        <div className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: C.warnFg }}>Defeito relatado</div>
        <p className="mt-2 text-xs leading-5 text-foreground/80">{os.defeito}</p>

        <div className="mt-4 grid gap-2.5 border-y border-border py-3">
          <DetailRow label="Prioridade" value={v.prio.label} valueColor={v.prio.fg} />
          <DetailRow label="Localização" value={os.localizacao} />
          <DetailRow label="Previsão / SLA" value={os.previsao} valueColor={C.successFg} />
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={v.railFila} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted"><ArrowLeft size={13} /> Voltar à fila</button>
          <button type="button" onClick={v.onTrocar} className="h-9 flex-1 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted">Trocar OS</button>
        </div>
      </div>
    </aside>
  );
}
