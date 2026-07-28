"use client"

/**
 * Contador HUB · primitivas visuais compartilhadas (GOAL 011).
 *
 * Extraídas de `documentos/contador-documentos-real.tsx` (GOAL 010) para que a
 * seção Documentos, a Timeline e a caixa de comentários usem exatamente o mesmo
 * botão, overlay e chip de status — sem copiar estilo entre arquivos.
 *
 * Só tokens semânticos (`bg-card`, `text-foreground`, `border-border`, `primary`…).
 * As cores de estado (sky/violet/emerald/rose/amber) seguem a paleta já adotada
 * pelos chips do HUB desde o preview, com variante dark explícita.
 */
import { cn } from "@/lib/utils"

/* ─────────────────────────── botão ─────────────────────────── */

export function Botao({
  variant = "default",
  size = "md",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger"
  size?: "sm" | "md"
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-[13px]",
        variant === "primary" && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "ghost" && "border-transparent bg-transparent text-primary hover:bg-primary/10",
        variant === "danger" && "border-rose-500/40 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20",
        variant === "default" && "border-border bg-card text-foreground hover:bg-muted/60",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ─────────────────────────── overlay ─────────────────────────── */

export function Overlay({
  children,
  onClose,
  alinhar = "center",
}: {
  children: React.ReactNode
  onClose?: () => void
  alinhar?: "center" | "right"
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex bg-black/40 p-0 backdrop-blur-sm",
        alinhar === "center" ? "items-center justify-center p-4" : "items-stretch justify-end",
      )}
      onClick={onClose}
    >
      <div className="contents" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/* ─────────────────────────── chips de estado ─────────────────────────── */

const STATUS_CHIP: Record<string, string> = {
  PENDENTE: "border-border bg-muted text-muted-foreground",
  ENVIADO: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  CONFERIDO: "border-violet-500/30 bg-violet-500/10 text-violet-500",
  RESOLVIDO: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
}

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold",
        STATUS_CHIP[status] ?? STATUS_CHIP.PENDENTE,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.toLowerCase()}
    </span>
  )
}

/** `vencido` é flag DERIVADA (nunca um status) — por isso é um chip separado. */
export function VencidoChip() {
  return (
    <span
      title="Derivado do vencimento — não é um status gravado."
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-rose-500"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      vencido
    </span>
  )
}

/** Distingue visualmente comentário interno de comentário compartilhado. */
export function VisibilidadeChip({ visibilidade }: { visibilidade: string }) {
  const compartilhada = visibilidade === "compartilhada"
  return (
    <span
      title={
        compartilhada
          ? "Compartilhado — ficará visível ao contador no portal externo."
          : "Interno — nunca sai para o contador externo."
      }
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
        compartilhada
          ? "border-sky-500/30 bg-sky-500/10 text-sky-500"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {compartilhada ? "compartilhado" : "interno"}
    </span>
  )
}

/* ─────────────────────────── util comum ─────────────────────────── */

export async function lerErroResposta(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { mensagem?: string }
    return j?.mensagem || `Erro ${res.status}.`
  } catch {
    return `Erro ${res.status}.`
  }
}

/** `2026-07-28T13:05:09.000Z` → `28/07/2026 10:05` (America/Sao_Paulo). */
const DATA_HORA_FMT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DATA_HORA_FMT.format(d)
}
