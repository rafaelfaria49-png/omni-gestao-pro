/**
 * Operações V4 · Beta operacional — casca raiz (client component).
 *
 * Conversão React do protótipo Cloud Design `design/operacoes-v4`. Isolado da V3
 * (não importa nada dela). Os STAGES leem a OS REAL e várias ações de escrita
 * (cancelar, diagnóstico, orçamento, execução, entrega, assinatura, garantia,
 * recebimento operacional da OS, Nova OS, produção da Bancada, Fila/Kanban, SLA)
 * persistem de verdade via actions V3 reusadas. Bancada, Fila e SLA são operacionais.
 * O Financeiro transversal da OS recebe de verdade (`receberOSV3`) — não é
 * preview/read-only. O rail Receber abre o Financeiro real da OS. O estado é local (`useV4Preview`); handlers
 * residuais sem persistência avisam via toast honesto no momento do clique.
 *
 * `height:100%` (e não 100vh) mantém o AppShell como dono do scroll — este
 * módulo só rola internamente no painel de etapa / nas telas de módulo.
 */
"use client";

import { useEffect } from "react";
import { useWorkspaceFocus } from "@/components/painel-inicial/workspace-focus-context";
import { useV4Preview } from "./use-v4-preview";
import { TopBar } from "./parts/TopBar";
import { IconRail } from "./parts/IconRail";
import { WorkspaceView } from "./parts/WorkspaceView";
import { ModuleView } from "./parts/ModuleView";
import { BancadaV4 } from "./parts/BancadaV4";
import { FilaV4 } from "./parts/FilaV4";
import { SlaV4 } from "./parts/SlaV4";
import { DashboardV4 } from "./parts/DashboardV4";
import { NovaOSModal } from "./parts/NovaOSModal";
import { NovoAtendimentoLauncher } from "./parts/NovoAtendimentoLauncher";
import { AtendimentoRapidoModal } from "./parts/AtendimentoRapidoModal";
import { OrcamentoRapidoModal } from "./parts/OrcamentoRapidoModal";
import { EstornoRecebimentoModal } from "./parts/EstornoRecebimentoModal";
import { CancelamentoOSModal } from "./parts/CancelamentoOSModal";
import { ReciboModal } from "./parts/ReciboModal";
import { DocPrintModal } from "./parts/DocPrintModal";
import { Toast } from "./parts/Toast";

export function OperacoesV4Preview() {
  const v = useV4Preview();
  const { setFocusMode } = useWorkspaceFocus();

  useEffect(() => {
    setFocusMode(v.focusActive);
    return () => setFocusMode(false);
  }, [setFocusMode, v.focusActive]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--background)",
        overflow: "hidden",
        fontSize: 14,
        position: "relative",
        color: "var(--foreground)",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <TopBar v={v} />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <IconRail v={v} />
        {v.isWorkspace && <WorkspaceView v={v} />}
        {v.isModule && v.moduleId === "dashboard" && <DashboardV4 v={v} />}
        {v.isModule && v.moduleId === "bancada" && <BancadaV4 v={v} />}
        {v.isModule && v.moduleId === "fila" && <FilaV4 v={v} />}
        {v.isModule && v.moduleId === "sla" && <SlaV4 v={v} />}
        {v.isModule && v.moduleId !== "dashboard" && v.moduleId !== "bancada" && v.moduleId !== "fila" && v.moduleId !== "sla" && <ModuleView v={v} />}
      </div>

      <NovoAtendimentoLauncher v={v} />
      <NovaOSModal v={v} />
      <AtendimentoRapidoModal v={v} />
      <OrcamentoRapidoModal v={v} />
      <EstornoRecebimentoModal v={v} />
      <CancelamentoOSModal v={v} />
      <ReciboModal v={v} />
      <DocPrintModal v={v} />
      <Toast v={v} />
    </div>
  );
}
