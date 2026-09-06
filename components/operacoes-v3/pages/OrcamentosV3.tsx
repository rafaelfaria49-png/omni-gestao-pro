"use client";

import { useMemo } from "react";
import { FileText } from "lucide-react";
import type { OrdemServico } from "@/types/os";
import { SectionShellV3 } from "../components/SectionShellV3";
import { EmptyStateV3 } from "../components/EmptyStateV3";
import { ButtonV3 } from "../components/UiV3";
import { LoadingBlockV3, NoStoreBlockV3 } from "../components/ScreenStateV3";
import { useOperacoesV3 } from "../context/OperacoesV3Context";
import { SCREEN_COPY } from "../data/screen-copy";
import { formatBRL, formatData } from "../lib/format";
import { agruparPorOrcamento, orcamentoTotal, type OrcamentoStatusV3 } from "../lib/os-derive";

const COLUNAS: { id: OrcamentoStatusV3; label: string }[] = [
  { id: "rascunho", label: "Rascunhos" },
  { id: "enviado", label: "Enviados" },
  { id: "aprovado", label: "Aprovados" },
  { id: "recusado", label: "Recusados" },
  { id: "expirado", label: "Expirados" },
];

function somaTotais(ordens: OrdemServico[]): number {
  return ordens.reduce((s, o) => s + orcamentoTotal(o), 0);
}

export function OrcamentosV3() {
  const { ordens, loading, primeiraCarga, storeId, openOS } = useOperacoesV3();
  const grupos = useMemo(() => agruparPorOrcamento(ordens), [ordens]);

  if (!storeId) {
    return (
      <SectionShellV3 kicker="Comercial · funil por status" titulo={SCREEN_COPY.orcamentos.titulo} subtitulo={SCREEN_COPY.orcamentos.subtitulo}>
        <NoStoreBlockV3 />
      </SectionShellV3>
    );
  }

  const semOrcamento = grupos["sem-orcamento"].length;
  const totalComOrcamento = COLUNAS.reduce((s, c) => s + grupos[c.id].length, 0);

  return (
    <SectionShellV3 kicker="Comercial · funil por status" titulo={SCREEN_COPY.orcamentos.titulo} subtitulo={SCREEN_COPY.orcamentos.subtitulo}>
      {primeiraCarga && loading ? (
        <LoadingBlockV3 />
      ) : totalComOrcamento === 0 ? (
        <EmptyStateV3
          icon={<FileText className="h-8 w-8" />}
          titulo="Nenhum orçamento ainda"
          descricao={
            semOrcamento > 0
              ? `${semOrcamento} OS ainda não têm orçamento. Quando houver, o funil aparece aqui.`
              : "Quando as OS tiverem orçamento, o funil por status aparece aqui."
          }
        />
      ) : (
        <>
          {semOrcamento > 0 ? (
            <p className="mb-3 text-xs text-muted-foreground">
              {semOrcamento} OS sem orçamento (não exibidas no funil).
            </p>
          ) : null}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {COLUNAS.map((col) => {
              const lista = grupos[col.id];
              return (
                <div key={col.id} className="flex w-[248px] shrink-0 flex-col rounded-[10px] border border-border bg-muted/20">
                  <div className="border-b border-border px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold text-foreground">{col.label}</span>
                      <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{lista.length}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{formatBRL(somaTotais(lista))}</p>
                  </div>
                  <div className="max-h-[480px] min-h-[80px] space-y-2 overflow-y-auto p-2">
                    {lista.length > 0 ? (
                      lista.map((os) => (
                        <div key={os.id} className="rounded-lg border border-border bg-card p-2 shadow-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-bold tabular-nums text-foreground">{os.codigo}</span>
                            <span className="shrink-0 text-[13px] font-bold tabular-nums text-foreground">
                              {formatBRL(orcamentoTotal(os))}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{os.cliente?.nome ?? "Cliente"}</p>
                          {os.orcamento?.validoAte ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">Válido até {formatData(os.orcamento.validoAte)}</p>
                          ) : null}
                          <ButtonV3 variant="outline" className="mt-1.5 w-full" onClick={() => openOS(os.id)}>
                            Abrir OS
                          </ButtonV3>
                        </div>
                      ))
                    ) : (
                      <p className="px-2 py-6 text-center text-xs text-muted-foreground">—</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </SectionShellV3>
  );
}
