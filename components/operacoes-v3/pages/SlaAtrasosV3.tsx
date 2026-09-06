"use client";

import { useMemo } from "react";
import { AlarmClock, CheckCircle2 } from "lucide-react";
import { SectionShellV3 } from "../components/SectionShellV3";
import { OSCardV3 } from "../components/OSCardV3";
import { MetricCardV3 } from "../components/MetricCardV3";
import { EmptyStateV3 } from "../components/EmptyStateV3";
import { LoadingBlockV3, NoStoreBlockV3 } from "../components/ScreenStateV3";
import { useOperacoesV3 } from "../context/OperacoesV3Context";
import { SCREEN_COPY } from "../data/screen-copy";
import { isAtrasada, isEmRisco } from "../lib/os-derive";

export function SlaAtrasosV3() {
  const { ordens, loading, primeiraCarga, storeId, openOS } = useOperacoesV3();

  const { atrasadas, emRisco, noPrazo } = useMemo(() => {
    const ativas = ordens.filter((o) => o.status !== "entregue" && o.status !== "cancelada");
    return {
      atrasadas: ativas.filter(isAtrasada),
      emRisco: ativas.filter(isEmRisco),
      noPrazo: ativas.filter((o) => !isAtrasada(o) && !isEmRisco(o)).length,
    };
  }, [ordens]);

  if (!storeId) {
    return (
      <SectionShellV3 kicker="Prazos · risco e estourados" titulo={SCREEN_COPY.sla.titulo} subtitulo={SCREEN_COPY.sla.subtitulo}>
        <NoStoreBlockV3 />
      </SectionShellV3>
    );
  }

  return (
    <SectionShellV3 kicker="Prazos · risco e estourados" titulo={SCREEN_COPY.sla.titulo} subtitulo={SCREEN_COPY.sla.subtitulo}>
      {primeiraCarga && loading ? (
        <LoadingBlockV3 />
      ) : (
        <div className="space-y-4 sm:space-y-5">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <MetricCardV3 label="Atrasadas" value={atrasadas.length} tone="danger" />
            <MetricCardV3 label="Em risco" value={emRisco.length} tone="warning" />
            <MetricCardV3 label="No prazo" value={noPrazo} tone="success" />
          </div>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlarmClock className="h-4 w-4" aria-hidden /> Atrasadas (SLA estourado)
            </h3>
            {atrasadas.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {atrasadas.map((os) => (
                  <OSCardV3 key={os.id} os={os} onOpen={openOS} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhuma OS atrasada.
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
              <AlarmClock className="h-4 w-4" aria-hidden /> Em risco (atenção)
            </h3>
            {emRisco.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {emRisco.map((os) => (
                  <OSCardV3 key={os.id} os={os} onOpen={openOS} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhuma OS em risco.
              </p>
            )}
          </section>

          {atrasadas.length === 0 && emRisco.length === 0 ? (
            <EmptyStateV3
              icon={<CheckCircle2 className="h-8 w-8 text-success" />}
              titulo="Tudo dentro do prazo"
              descricao="O cálculo usa o SLA já presente em cada OS (ok / atenção / estourado)."
            />
          ) : null}
        </div>
      )}
    </SectionShellV3>
  );
}
