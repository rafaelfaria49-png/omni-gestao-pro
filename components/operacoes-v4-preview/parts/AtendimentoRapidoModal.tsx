/**
 * Operações V4 — Atendimento rápido (GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001).
 * Motor inalterado: `finalizarAtendimentoRapidoV3`.
 */
"use client";

import { useEffect, useState } from "react";
import { C, fmt } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { finalizarAtendimentoRapidoV3 } from "@/lib/operacoes-v3/atendimento-rapido-actions";
import { validarAtendimentoRapidoV3, SERVICOS_RAPIDOS_V3 } from "@/lib/operacoes-v3/atendimento-rapido-model";
import { getCaixaSessaoAbertaV3 } from "@/lib/operacoes-v3/pdv-servico-actions";
import { FORMAS_RECEBIMENTO_V3, type FormaRecebimentoV3 } from "@/lib/operacoes-v3/payment-model";
import {
  atendimentoRapidoFormVazioV4,
  buildAtendimentoRapidoInputFromFormV4,
  selecionarServicoRapidoV4,
  type AtendimentoRapidoFormV4,
} from "@/lib/operacoes-v4/atendimento-rapido-form";
import { AtendimentoModalShell } from "./atendimento/AtendimentoModalShell";
import { ClienteAtendimentoSection } from "./atendimento/ClienteAtendimentoSection";
import { ServicoCatalogLookup } from "./atendimento/ServicoCatalogLookup";
import { atendInput, atendLabel } from "./atendimento/field-styles";

const FORMAS_SUPORTADAS = FORMAS_RECEBIMENTO_V3.filter((f) => f.suportada);

export function AtendimentoRapidoModal({ v }: { v: V4Vals }) {
  if (!v.atendimentoRapidoOpen) return null;
  return <AtendimentoRapidoModalContent v={v} />;
}

function AtendimentoRapidoModalContent({ v }: { v: V4Vals }) {
  const { lojaAtivaId } = useLojaAtiva();
  const sid = (lojaAtivaId ?? "").trim();
  const [form, setForm] = useState<AtendimentoRapidoFormV4>(() => atendimentoRapidoFormVazioV4());
  const [caixaAberta, setCaixaAberta] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [garantiaDias, setGarantiaDias] = useState(0);
  const [custoInterno, setCustoInterno] = useState(0);

  useEffect(() => {
    if (!sid) {
      setCaixaAberta(null);
      return;
    }
    let vivo = true;
    getCaixaSessaoAbertaV3(sid)
      .then((s) => vivo && setCaixaAberta(!!s.aberta))
      .catch(() => vivo && setCaixaAberta(false));
    return () => {
      vivo = false;
    };
  }, [sid]);

  const clienteOk =
    form.clienteModo === "balcao" ||
    (form.clienteModo === "existente" && !!form.clienteExistente) ||
    (form.clienteModo === "novo" && form.clienteNovoNome.trim().length > 0);
  const podeFinalizar =
    !!sid && caixaAberta === true && clienteOk && form.servicoNome.trim().length > 0 && form.servicoValor > 0 && !busy;

  const handleFinalizar = async () => {
    setErro(null);
    if (!sid) {
      setErro("Selecione uma loja ativa para finalizar o atendimento.");
      return;
    }
    if (caixaAberta !== true) {
      setErro("Abra o caixa no PDV para finalizar o atendimento rápido (o recebimento entra no fechamento).");
      return;
    }
    const inputV3 = buildAtendimentoRapidoInputFromFormV4(form);
    const invalido = validarAtendimentoRapidoV3(inputV3);
    if (invalido) {
      setErro(invalido);
      return;
    }
    const confirmado = window.confirm(
      "Finalizar atendimento real: o sistema vai criar a OS, registrar o recebimento no caixa e marcar a OS como entregue. Confirmar?",
    );
    if (!confirmado) return;
    setBusy(true);
    try {
      const resultado = await finalizarAtendimentoRapidoV3(sid, inputV3);
      v.onAtendimentoRapidoConcluido(resultado.osId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível finalizar o atendimento.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AtendimentoModalShell
      titulo="Atendimento rápido"
      subtitulo="Serviço simples, pagamento e conclusão na hora."
      onClose={v.closeAtendimentoRapido}
      busy={busy}
      width={560}
      erro={erro}
      footer={
        <>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Total {fmt(form.servicoValor || 0)}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={v.closeAtendimentoRapido} disabled={busy} style={ghost}>
              Cancelar
            </button>
            <button type="button" onClick={() => void handleFinalizar()} disabled={!podeFinalizar} style={primary}>
              {busy ? "Finalizando…" : "Finalizar e emitir recibo"}
            </button>
          </div>
        </>
      }
    >
      {caixaAberta === false ? (
        <div style={{ background: C.warnBg, border: `1px solid ${C.warnBd}`, borderRadius: 9, padding: "9px 11px", marginBottom: 12, fontSize: 12, color: C.warnFg, lineHeight: 1.45 }}>
          <strong>Caixa fechado.</strong> Abra o caixa para finalizar.
        </div>
      ) : caixaAberta === true ? (
        <div style={{ background: C.successBg, border: `1px solid ${C.successBd}`, borderRadius: 9, padding: "8px 11px", marginBottom: 12, fontSize: 12, color: C.successFg }}>
          Caixa aberto
        </div>
      ) : null}

      <ClienteAtendimentoSection
        storeId={lojaAtivaId}
        permitirBalcao
        value={{
          modo: form.clienteModo,
          existente: form.clienteExistente,
          novo: { nome: form.clienteNovoNome, telefone: form.clienteNovoTelefone, documento: "", email: "" },
        }}
        onChange={(c) =>
          setForm((f) => ({
            ...f,
            clienteModo: c.modo,
            clienteExistente: c.existente,
            clienteNovoNome: c.novo.nome,
            clienteNovoTelefone: c.novo.telefone,
          }))
        }
      />

      <ServicoCatalogLookup
        storeId={lojaAtivaId}
        onSelect={(s) => {
          setForm((f) => ({ ...f, servicoNome: s.nome, servicoValor: s.preco }));
          setCustoInterno(s.custo);
          setGarantiaDias(s.garantia);
        }}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {SERVICOS_RAPIDOS_V3.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setForm((f) => selecionarServicoRapidoV4(f, s))}
            style={{
              height: 26,
              padding: "0 10px",
              border: `1px solid ${C.inputBd}`,
              background: form.servicoNome === s.nome ? C.primaryBg : C.surface,
              color: form.servicoNome === s.nome ? C.primaryHover : C.body,
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {s.nome}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,0.7fr)", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={atendLabel}>Serviço *</div>
          <input value={form.servicoNome} onChange={(e) => setForm((f) => ({ ...f, servicoNome: e.target.value }))} style={atendInput} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>Valor *</div>
          <input type="number" min={0} step="0.01" value={form.servicoValor || ""} onChange={(e) => setForm((f) => ({ ...f, servicoValor: Math.max(0, Number(e.target.value) || 0) }))} style={atendInput} />
        </div>
        <div>
          <div style={atendLabel}>Garantia (dias)</div>
          <input type="number" min={0} value={garantiaDias || ""} onChange={(e) => setGarantiaDias(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} style={atendInput} />
        </div>
        <div>
          <div style={atendLabel}>Custo interno</div>
          <input type="number" min={0} step="0.01" value={custoInterno || ""} onChange={(e) => setCustoInterno(Math.max(0, Number(e.target.value) || 0))} title="Custo interno — não aparece para o cliente." style={{ ...atendInput, background: C.muted100 }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={atendLabel}>Marca (opcional)</div>
          <input value={form.equipMarca} onChange={(e) => setForm((f) => ({ ...f, equipMarca: e.target.value }))} style={atendInput} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>Modelo (opcional)</div>
          <input value={form.equipModelo} onChange={(e) => setForm((f) => ({ ...f, equipModelo: e.target.value }))} style={atendInput} autoComplete="off" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 8 }}>
        <div>
          <div style={atendLabel}>Pagamento</div>
          <select value={form.formaPagamento} onChange={(e) => setForm((f) => ({ ...f, formaPagamento: e.target.value as FormaRecebimentoV3 }))} style={{ ...atendInput, cursor: "pointer" }}>
            {FORMAS_SUPORTADAS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={atendLabel}>Observação</div>
          <input value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} style={atendInput} autoComplete="off" />
        </div>
      </div>
    </AtendimentoModalShell>
  );
}

const ghost: React.CSSProperties = {
  height: 36,
  padding: "0 14px",
  border: `1px solid ${C.inputBd}`,
  background: C.surface,
  color: C.body,
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const primary: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  border: "none",
  background: C.primary,
  color: C.white,
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
