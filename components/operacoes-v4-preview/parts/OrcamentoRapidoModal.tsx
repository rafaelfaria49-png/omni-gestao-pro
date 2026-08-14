/**
 * Operações V4 — Novo orçamento (GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001).
 * Continua no motor `criarOrcamentoRapidoV3`. Depois carimba pré-OS no payload.
 */
"use client";

import { useState } from "react";
import { C, fmt } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { criarOrcamentoRapidoV3 } from "@/lib/operacoes-v3/orcamento-rapido-actions";
import { enviarOrcamentoPorCanalV3 } from "@/lib/operacoes-v3/orcamento-envio-actions";
import { marcarOrcamentoPreOsV3, atualizarStatusComercialV3 } from "@/lib/operacoes-v3/comercial-pre-os-actions";
import { MAX_LINHAS_POR_GRUPO_V3 } from "@/lib/operacoes-v3/orcamento-model";
import {
  adicionarItemFixoV4,
  adicionarVarianteV4,
  buildOrcamentoRapidoInputFromFormV4,
  orcamentoRapidoFormVazioV4,
  previaTotaisOrcamentoRapidoV4,
  removerItemFixoV4,
  removerVarianteV4,
  validarOrcamentoRapidoFormV4,
  type OrcamentoRapidoFormV4,
} from "@/lib/operacoes-v4/orcamento-rapido-form";

import { AtendimentoModalShell } from "./atendimento/AtendimentoModalShell";
import { AtendimentoAccordionSection } from "./atendimento/AtendimentoAccordionSection";
import { ClienteAtendimentoSection } from "./atendimento/ClienteAtendimentoSection";
import { AparelhoAtendimentoSection } from "./atendimento/AparelhoAtendimentoSection";
import { CommercialOptionEditor } from "./atendimento/CommercialOptionEditor";
import { ServicoCatalogLookup } from "./atendimento/ServicoCatalogLookup";
import { atendInput, atendLabel } from "./atendimento/field-styles";

export function OrcamentoRapidoModal({ v }: { v: V4Vals }) {
  if (!v.orcamentoRapidoOpen) return null;
  return <OrcamentoRapidoModalContent v={v} />;
}

function OrcamentoRapidoModalContent({ v }: { v: V4Vals }) {
  const { lojaAtivaId } = useLojaAtiva();
  const sid = (lojaAtivaId ?? "").trim();
  const [form, setForm] = useState<OrcamentoRapidoFormV4>(() => v.orcamentoRapidoInitialValues ?? orcamentoRapidoFormVazioV4());
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState({ cliente: true, aparelho: true, diagnostico: false, proposta: true, condicoes: false });

  const invalido = validarOrcamentoRapidoFormV4(form);
  const podeSalvar = !!sid && !invalido && !busy;
  const totais = previaTotaisOrcamentoRapidoV4(form);

  const persistir = async (enviar: boolean) => {
    setErro(null);
    if (!sid) {
      setErro("Selecione uma loja ativa para criar o orçamento.");
      return;
    }
    const invalidoAgora = validarOrcamentoRapidoFormV4(form);
    if (invalidoAgora) {
      setErro(invalidoAgora);
      return;
    }
    setBusy(true);
    try {
      const resultado = await criarOrcamentoRapidoV3(sid, buildOrcamentoRapidoInputFromFormV4(form));
      await marcarOrcamentoPreOsV3(sid, resultado.osId, {
        origemAtendimento: form.origemAtendimento,
        validadeDias: form.validadeDias,
        prazoEstimado: form.prazoEstimado,
        observacaoCliente: form.observacaoCliente,
        observacaoInterna: form.observacaoInterna,
        diagnosticoInicial: {
          causaProvavel: form.causaProvavel || undefined,
          solucaoSugerida: form.solucaoSugerida || undefined,
          observacaoTecnica: form.observacaoTecnica || undefined,
        },
        aparelho: { tipo: form.equipamentoTipo, imei: form.aparelhoImei, cor: form.aparelhoCor },
        statusComercial: enviar ? "enviado" : "rascunho",
      });
      if (enviar) {
        await enviarOrcamentoPorCanalV3(sid, resultado.osId, form.origemAtendimento === "whatsapp" ? "whatsapp" : "impresso");
        await atualizarStatusComercialV3(sid, resultado.osId, "enviado").catch(() => undefined);
      }
      v.onOrcamentoRapidoCriado(resultado.osId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o orçamento.");
    } finally {
      setBusy(false);
    }
  };

  const clienteState = {
    modo: form.clienteModo,
    existente: form.clienteExistente,
    novo: { nome: form.clienteNovoNome, telefone: form.clienteNovoTelefone, documento: form.clienteNovoDocumento, email: form.clienteNovoEmail },
  };

  const faixa = totais.faixa;

  return (
    <AtendimentoModalShell
      titulo="Novo orçamento"
      subtitulo="Monte uma proposta profissional e envie ao cliente antes da abertura definitiva da OS."
      onClose={v.closeOrcamentoRapido}
      busy={busy}
      erro={erro}
      footer={
        <>
          <span style={{ fontSize: 12, color: C.subtle, minWidth: 0 }}>
            {faixa ? (
              <>Preço mínimo {fmt(faixa.min)} · máximo {fmt(faixa.max)}</>
            ) : (
              <>Total {fmt(totais.total)}</>
            )}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={v.closeOrcamentoRapido} disabled={busy} style={btnGhost}>Cancelar</button>
            <button type="button" onClick={() => void persistir(false)} disabled={!podeSalvar} style={btnGhost}>Salvar rascunho</button>
            <button type="button" onClick={() => void persistir(false)} disabled={!podeSalvar} style={btnGhost}>Criar sem enviar</button>
            <button type="button" onClick={() => void persistir(true)} disabled={!podeSalvar} style={btnPrimary}>
              {busy ? "Salvando…" : "Criar e enviar orçamento"}
            </button>
          </div>
        </>
      }
    >
      <AtendimentoAccordionSection titulo="Cliente" aberto={abertos.cliente} onToggle={() => setAbertos((a) => ({ ...a, cliente: !a.cliente }))} resumo={form.clienteExistente?.nome || form.clienteNovoNome || undefined}>
        <ClienteAtendimentoSection
          storeId={lojaAtivaId}
          value={clienteState}
          origem={form.origemAtendimento}
          onOrigemChange={(o) => setForm((f) => ({ ...f, origemAtendimento: o }))}
          onChange={(c) =>
            setForm((f) => ({
              ...f,
              clienteModo: c.modo === "balcao" ? "existente" : c.modo,
              clienteExistente: c.existente,
              clienteNovoNome: c.novo.nome,
              clienteNovoTelefone: c.novo.telefone,
              clienteNovoDocumento: c.novo.documento,
              clienteNovoEmail: c.novo.email,
            }))
          }
        />
      </AtendimentoAccordionSection>

      <AtendimentoAccordionSection titulo="Aparelho" aberto={abertos.aparelho} onToggle={() => setAbertos((a) => ({ ...a, aparelho: !a.aparelho }))} resumo={[form.aparelhoMarca, form.aparelhoModelo].filter(Boolean).join(" ") || undefined}>
        <AparelhoAtendimentoSection
          value={{
            tipo: form.equipamentoTipo,
            marca: form.aparelhoMarca,
            modelo: form.aparelhoModelo,
            imei: form.aparelhoImei,
            cor: form.aparelhoCor,
            defeitoRelatado: form.defeitoRelatado,
          }}
          onChange={(a) =>
            setForm((f) => ({
              ...f,
              equipamentoTipo: a.tipo,
              aparelhoMarca: a.marca,
              aparelhoModelo: a.modelo,
              aparelhoImei: a.imei,
              aparelhoCor: a.cor,
              defeitoRelatado: a.defeitoRelatado,
            }))
          }
        />
      </AtendimentoAccordionSection>

      <AtendimentoAccordionSection titulo="Diagnóstico inicial" aberto={abertos.diagnostico} onToggle={() => setAbertos((a) => ({ ...a, diagnostico: !a.diagnostico }))} resumo="Opcional numa consulta de preço">
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <div style={atendLabel}>Causa provável</div>
            <input value={form.causaProvavel} onChange={(e) => setForm((f) => ({ ...f, causaProvavel: e.target.value }))} placeholder="Display danificado após queda." style={atendInput} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>Solução sugerida</div>
            <input value={form.solucaoSugerida} onChange={(e) => setForm((f) => ({ ...f, solucaoSugerida: e.target.value }))} placeholder="Substituição completa do conjunto frontal." style={atendInput} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>Observação técnica inicial</div>
            <textarea value={form.observacaoTecnica} onChange={(e) => setForm((f) => ({ ...f, observacaoTecnica: e.target.value }))} style={area} autoComplete="off" />
          </div>
        </div>
      </AtendimentoAccordionSection>

      <AtendimentoAccordionSection titulo="Proposta comercial" aberto={abertos.proposta} onToggle={() => setAbertos((a) => ({ ...a, proposta: !a.proposta }))}>
        <ServicoCatalogLookup
          storeId={lojaAtivaId}
          onSelect={(s) =>
            setForm((f) => ({
              ...f,
              itensFixos: [...f.itensFixos, { id: `fix_${Date.now()}`, descricao: s.nome, valor: s.preco, custoV3: s.custo, cortesia: false, quantidade: 1 }],
            }))
          }
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.subtle, letterSpacing: ".04em", textTransform: "uppercase" }}>Itens fixos</div>
          <button type="button" onClick={() => setForm((f) => adicionarItemFixoV4(f))} style={chipBtn}>+ item</button>
        </div>
        {form.itensFixos.map((it) => (
          <div key={it.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,0.7fr) minmax(0,0.7fr) auto auto", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <input value={it.descricao} onChange={(e) => setForm((f) => ({ ...f, itensFixos: f.itensFixos.map((x) => (x.id === it.id ? { ...x, descricao: e.target.value } : x)) }))} placeholder="Mão de obra" style={atendInput} maxLength={120} />
            <input type="number" min={0} step="0.01" value={it.valor || ""} onChange={(e) => setForm((f) => ({ ...f, itensFixos: f.itensFixos.map((x) => (x.id === it.id ? { ...x, valor: Math.max(0, Number(e.target.value) || 0) } : x)) }))} placeholder="Venda" style={atendInput} disabled={it.cortesia} />
            <input type="number" min={0} step="0.01" value={it.custoV3 || ""} onChange={(e) => setForm((f) => ({ ...f, itensFixos: f.itensFixos.map((x) => (x.id === it.id ? { ...x, custoV3: Math.max(0, Number(e.target.value) || 0) } : x)) }))} placeholder="Custo" title="Custo interno — não aparece para o cliente." style={{ ...atendInput, background: C.muted100, color: C.subtle }} />
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={it.cortesia} onChange={(e) => setForm((f) => ({ ...f, itensFixos: f.itensFixos.map((x) => (x.id === it.id ? { ...x, cortesia: e.target.checked, valor: e.target.checked ? 0 : x.valor } : x)) }))} />
              Cortesia
            </label>
            <button type="button" onClick={() => setForm((f) => removerItemFixoV4(f, it.id))} style={{ border: "none", background: "transparent", color: C.dangerFg, cursor: "pointer" }}>×</button>
          </div>
        ))}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 8px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.subtle, letterSpacing: ".04em", textTransform: "uppercase" }}>Grupo de escolha</div>
          <button type="button" onClick={() => setForm((f) => adicionarVarianteV4(f))} disabled={form.variantes.length >= MAX_LINHAS_POR_GRUPO_V3} style={chipBtn}>
            + opção ({form.variantes.length}/{MAX_LINHAS_POR_GRUPO_V3})
          </button>
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={atendLabel}>Rótulo do grupo *</div>
          <input value={form.grupoRotulo} onChange={(e) => setForm((f) => ({ ...f, grupoRotulo: e.target.value }))} placeholder="ESCOLHA A TELA" style={atendInput} autoComplete="off" />
        </div>
        {form.variantes.map((variante, i) => (
          <CommercialOptionEditor
            key={variante.id}
            index={i}
            value={variante}
            canRemove={form.variantes.length > 2}
            onRemove={() => setForm((f) => removerVarianteV4(f, variante.id))}
            onChange={(next) => setForm((f) => ({ ...f, variantes: f.variantes.map((x) => (x.id === variante.id ? next : x)) }))}
          />
        ))}
      </AtendimentoAccordionSection>

      <AtendimentoAccordionSection titulo="Condições" aberto={abertos.condicoes} onToggle={() => setAbertos((a) => ({ ...a, condicoes: !a.condicoes }))}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
          <div>
            <div style={atendLabel}>Validade (dias)</div>
            <input type="number" min={1} value={form.validadeDias || ""} onChange={(e) => setForm((f) => ({ ...f, validadeDias: Math.max(1, Math.trunc(Number(e.target.value) || 7)) }))} style={atendInput} />
          </div>
          <div>
            <div style={atendLabel}>Prazo estimado</div>
            <input value={form.prazoEstimado} onChange={(e) => setForm((f) => ({ ...f, prazoEstimado: e.target.value }))} placeholder="2 horas após aprovação" style={atendInput} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>Observação para o cliente</div>
            <textarea value={form.observacaoCliente} onChange={(e) => setForm((f) => ({ ...f, observacaoCliente: e.target.value }))} style={area} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>Observação interna</div>
            <textarea value={form.observacaoInterna} onChange={(e) => setForm((f) => ({ ...f, observacaoInterna: e.target.value }))} style={{ ...area, background: C.muted100 }} autoComplete="off" />
          </div>
        </div>
      </AtendimentoAccordionSection>
    </AtendimentoModalShell>
  );
}

const area: React.CSSProperties = {
  width: "100%",
  minHeight: 52,
  padding: "8px 11px",
  border: `1px solid ${C.inputBd}`,
  borderRadius: 8,
  fontSize: 12.5,
  color: C.body,
  resize: "vertical",
  fontFamily: "inherit",
  background: C.surface,
};

const btnGhost: React.CSSProperties = {
  height: 36,
  padding: "0 14px",
  border: `1px solid ${C.inputBd}`,
  background: C.surface,
  color: C.body,
  borderRadius: 9,
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  border: "none",
  background: C.primary,
  color: C.white,
  borderRadius: 9,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

const chipBtn: React.CSSProperties = {
  height: 24,
  padding: "0 10px",
  border: `1px solid ${C.inputBd}`,
  background: C.surface,
  color: C.body,
  borderRadius: 7,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
