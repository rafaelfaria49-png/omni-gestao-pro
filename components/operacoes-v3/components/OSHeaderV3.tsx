"use client";

import type { ReactNode } from "react";
import { CalendarClock, Clock, Hash, Smartphone, Tag, User, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrdemServico } from "@/types/os";
import { statusV3FromOS } from "@/lib/operacoes-v3/status-machine";
import { lerRecepcaoV3 } from "@/lib/operacoes-v3/workspace-model";
import { lerPagamentoV3 } from "@/lib/operacoes-v3/payment-model";
import { StatusBadgeV3 } from "./StatusBadgeV3";
import { PaymentBadgeV3 } from "./PaymentBadgeV3";
import { formatBRL, formatDataHora } from "../lib/format";
import { isAtrasada, isEmRisco, type PagamentoEstado } from "../lib/os-derive";

function Field({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ops-v3-subtle)]">
        <span className="shrink-0">{icon}</span>
        {label}
      </div>
      <div className={cn("mt-0.5 truncate text-sm font-medium text-[var(--ops-v3-body)]", tone)}>{value || "—"}</div>
    </div>
  );
}

/** Cabeçalho fixo/sticky da OS no Workspace. Campos sem dado → traço (—). */
export function OSHeaderV3({ os, actions }: { os: OrdemServico; actions?: ReactNode }) {
  const pagV3 = lerPagamentoV3(os);
  const pagEstado: PagamentoEstado = pagV3.status === "sem_cobranca" ? "sem-cobranca" : pagV3.status;
  const atrasada = isAtrasada(os);
  const risco = isEmRisco(os);
  const recepcao = lerRecepcaoV3(os);
  const marcaModelo = [os.equipamento?.marca, os.equipamento?.modelo].filter(Boolean).join(" ").trim() || os.equipamento?.tipo || "";

  return (
    <div className="sticky top-0 z-10 rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)]/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[var(--ops-v3-surface)]/85">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h2 className="truncate text-[16px] font-extrabold tracking-tight tabular-nums text-[var(--ops-v3-ink)]">{os.codigo}</h2>
          <StatusBadgeV3 status={statusV3FromOS(os)} />
          <PaymentBadgeV3 estado={pagEstado} total={pagV3.total} recebido={pagV3.recebido} />
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--ops-v3-subtle)]">Total da OS</p>
          <p className="text-lg font-extrabold tabular-nums text-[var(--ops-v3-ink)]">
            {pagV3.total > 0 ? formatBRL(pagV3.total) : "—"}
          </p>
          {pagV3.saldo > 0 && pagV3.recebido > 0 ? (
            <p className="text-[11px] font-medium text-[var(--ops-v3-warning-fg)]">saldo {formatBRL(pagV3.saldo)}</p>
          ) : null}
        </div>
      </div>

      {actions ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div> : null}

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Field icon={<User className="h-3 w-3" />} label="Cliente" value={os.cliente?.nome} />
        <Field icon={<Smartphone className="h-3 w-3" />} label="Equipamento" value={marcaModelo} />
        <Field icon={<Tag className="h-3 w-3" />} label="Marca / modelo" value={[os.equipamento?.marca, os.equipamento?.modelo].filter(Boolean).join(" ")} />
        <Field icon={<Hash className="h-3 w-3" />} label="IMEI / série" value={os.equipamento?.numeroSerie} />
        <Field icon={<Wrench className="h-3 w-3" />} label="Técnico" value={os.tecnico?.nome} />
        <Field icon={<CalendarClock className="h-3 w-3" />} label="Entrada" value={recepcao.dataEntrada ? formatDataHora(recepcao.dataEntrada) : ""} />
        <Field
          icon={<Clock className="h-3 w-3" />}
          label="Previsão / SLA"
          value={recepcao.previsaoEntrega ? formatDataHora(recepcao.previsaoEntrega) : ""}
          tone={atrasada ? "text-destructive" : risco ? "text-warning" : undefined}
        />
      </div>
    </div>
  );
}
