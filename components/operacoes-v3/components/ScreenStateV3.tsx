"use client";

import { AlertTriangle, Loader2, Store } from "lucide-react";
import { EmptyStateV3 } from "./EmptyStateV3";

export function LoadingBlockV3({ label = "Carregando ordens de serviço…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] py-12 text-sm text-[var(--ops-v3-muted)] shadow-sm"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function NoStoreBlockV3() {
  return (
    <EmptyStateV3
      icon={<Store className="h-8 w-8" />}
      titulo="Selecione uma unidade"
      descricao="Escolha uma loja ativa no topo do sistema para carregar as ordens de serviço desta unidade."
    />
  );
}

export function ErrorBlockV3({ message }: { message: string }) {
  return (
    <EmptyStateV3
      icon={<AlertTriangle className="h-8 w-8 text-[var(--ops-v3-warning)]" />}
      titulo="Não foi possível carregar"
      descricao={message}
    />
  );
}
