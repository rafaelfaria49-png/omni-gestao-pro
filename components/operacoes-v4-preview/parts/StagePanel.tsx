/** Operações V4 Preview — painel da etapa selecionada (área rolável do workspace). */
import type { V4Vals } from "../use-v4-preview";
import { EntradaStage } from "./stages/EntradaStage";
import { DiagnosticoStage } from "./stages/DiagnosticoStage";
import { OrcamentoStage } from "./stages/OrcamentoStage";
import { ExecucaoStage } from "./stages/ExecucaoStage";
import { FinanceiroStage } from "./stages/FinanceiroStage";
import { EntregaStage } from "./stages/EntregaStage";
import { PosVendaStage } from "./stages/PosVendaStage";
import { HistoricoStage } from "./stages/HistoricoStage";
import { SegurancaStage } from "./stages/SegurancaStage";

export function StagePanel({ v }: { v: V4Vals }) {
  if (v.isEntrada) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
        <EntradaStage v={v} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px" }}>
      {v.isDiag && <DiagnosticoStage v={v} />}
      {v.isOrc && <OrcamentoStage v={v} />}
      {v.isExec && <ExecucaoStage v={v} />}
      {v.isFin && <FinanceiroStage v={v} />}
      {v.isEntrega && <EntregaStage v={v} />}
      {v.isPos && <PosVendaStage v={v} />}
      {v.isHist && <HistoricoStage v={v} />}
      {v.isSeg && <SegurancaStage v={v} />}
    </div>
  );
}
