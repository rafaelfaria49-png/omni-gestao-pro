/**
 * Operações V4 — Nova OS (GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001).
 * Continua em `criarOSEnterpriseV3`. Serviço autorizado materializa valor.
 */
"use client";

import { useState } from "react";
import { C } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { criarOSEnterpriseV3 } from "@/lib/operacoes-v3/nova-os-actions";
import { validarNovaOSDraftV3 } from "@/lib/operacoes-v3/nova-os-model";
import {
  buildNovaOSDraftFromFormV4,
  type TipoEntradaOSV4,
} from "@/lib/operacoes-v4/nova-os-draft-from-form";
import {
  clienteAtendimentoVazioV4,
  aparelhoAtendimentoVazioV4,
  origemComercialParaV3,
  lucroEstimadoV4,
  margemEstimadaV4,
  type ClienteAtendimentoStateV4,
  type AparelhoAtendimentoV4,
  type OrigemAtendimentoComercialV4,
} from "@/lib/operacoes-v4/atendimento-comercial";
import { AtendimentoModalShell } from "./atendimento/AtendimentoModalShell";
import { AtendimentoAccordionSection } from "./atendimento/AtendimentoAccordionSection";
import { ClienteAtendimentoSection } from "./atendimento/ClienteAtendimentoSection";
import { AparelhoAtendimentoSection } from "./atendimento/AparelhoAtendimentoSection";
import { ServicoCatalogLookup } from "./atendimento/ServicoCatalogLookup";
import { atendInput, atendLabel } from "./atendimento/field-styles";

const TIPOS: Array<{ key: TipoEntradaOSV4; titulo: string; texto: string }> = [
  { key: "servico_autorizado", titulo: "Serviço já autorizado", texto: "Cliente já aprovou o serviço e o valor." },
  { key: "precisa_diagnostico", titulo: "Precisa de diagnóstico", texto: "Aparelho entra para avaliação." },
  { key: "retorno_garantia", titulo: "Retorno / garantia", texto: "Não é uma venda nova." },
];

export function NovaOSModal({ v }: { v: V4Vals }) {
  if (!v.novaOSOpen) return null;
  return <NovaOSModalContent v={v} />;
}

function NovaOSModalContent({ v }: { v: V4Vals }) {
  const { lojaAtivaId } = useLojaAtiva();
  const [tipo, setTipo] = useState<TipoEntradaOSV4>("servico_autorizado");
  const [cliente, setCliente] = useState<ClienteAtendimentoStateV4>(() => clienteAtendimentoVazioV4("existente"));
  const [origem, setOrigem] = useState<OrigemAtendimentoComercialV4>("balcao");
  const [aparelho, setAparelho] = useState<AparelhoAtendimentoV4>(() => aparelhoAtendimentoVazioV4());
  const [servicoNome, setServicoNome] = useState("");
  const [servicoValor, setServicoValor] = useState(0);
  const [servicoCusto, setServicoCusto] = useState(0);
  const [servicoGarantia, setServicoGarantia] = useState(0);
  const [servicoPrazo, setServicoPrazo] = useState("");
  const [recebidoPor, setRecebidoPor] = useState("");
  const [prioridade, setPrioridade] = useState<"baixa" | "media" | "alta">("media");
  const [localFisico, setLocalFisico] = useState<"balcao" | "bancada" | "aguardando_diagnostico">("balcao");
  const [previsao, setPrevisao] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState({ cliente: true, aparelho: true, comercial: true, recepcao: false, prova: false });

  const handleCriar = async () => {
    setErro(null);
    const sid = (lojaAtivaId ?? "").trim();
    if (!sid) {
      setErro("Selecione uma loja ativa para abrir a OS.");
      return;
    }
    if (tipo === "servico_autorizado" && !(servicoNome.trim() && servicoValor > 0)) {
      setErro("Informe o serviço autorizado e o valor de venda.");
      return;
    }
    const draft = buildNovaOSDraftFromFormV4({
      clienteExistente: cliente.modo === "existente" ? cliente.existente : null,
      clienteNovo: cliente.novo,
      equipamentoTipo: aparelho.tipo,
      marca: aparelho.marca,
      modelo: aparelho.modelo,
      imei: aparelho.imei,
      cor: aparelho.cor,
      defeitoRelatado: aparelho.defeitoRelatado,
      recebidoPor,
      origem: tipo === "retorno_garantia" ? "garantia" : origemComercialParaV3(origem),
      tipoEntrada: tipo,
      prioridade,
      localFisico,
      previsaoEntrega: previsao || undefined,
      servicoAutorizado:
        tipo === "servico_autorizado"
          ? { descricao: servicoNome, valor: servicoValor, custo: servicoCusto, garantiaDias: servicoGarantia, prazoTexto: servicoPrazo }
          : null,
    });
    const invalido = validarNovaOSDraftV3(draft);
    if (invalido) {
      setErro(invalido);
      return;
    }
    setBusy(true);
    try {
      const { os } = await criarOSEnterpriseV3(sid, draft);
      v.onOSCriada(os.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir a OS.");
    } finally {
      setBusy(false);
    }
  };

  const lucro = lucroEstimadoV4(servicoValor, servicoCusto);
  const margem = margemEstimadaV4(servicoValor, servicoCusto);

  return (
    <AtendimentoModalShell
      titulo="Nova Ordem de Serviço"
      subtitulo="Crie uma OS para serviço autorizado ou diagnóstico técnico."
      onClose={v.closeNovaOS}
      busy={busy}
      erro={erro}
      footer={
        <>
          <span style={{ fontSize: 12, color: C.subtle }}>
            {tipo === "servico_autorizado" && servicoValor > 0 ? `Valor comercial ${servicoValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "Sem valor obrigatório"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={v.closeNovaOS} disabled={busy} style={ghost}>Cancelar</button>
            <button type="button" onClick={() => void handleCriar()} disabled={busy} style={primary}>
              {busy ? "Abrindo…" : "Criar Ordem de Serviço"}
            </button>
          </div>
        </>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.subtle, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 8 }}>Tipo de entrada</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
          {TIPOS.map((t) => {
            const sel = tipo === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTipo(t.key);
                  setAbertos((a) => ({ ...a, comercial: t.key === "servico_autorizado", recepcao: t.key !== "servico_autorizado" }));
                }}
                style={{
                  textAlign: "left",
                  padding: "10px 11px",
                  border: `1px solid ${sel ? C.primaryBd : C.line2}`,
                  background: sel ? C.primaryBg : C.surface,
                  borderRadius: 10,
                  cursor: "pointer",
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{t.titulo}</div>
                <div style={{ fontSize: 11, color: C.subtle, marginTop: 3, lineHeight: 1.4 }}>{t.texto}</div>
              </button>
            );
          })}
        </div>
      </div>

      <AtendimentoAccordionSection titulo="Cliente" aberto={abertos.cliente} onToggle={() => setAbertos((a) => ({ ...a, cliente: !a.cliente }))} resumo={cliente.existente?.nome || cliente.novo.nome || undefined}>
        <ClienteAtendimentoSection storeId={lojaAtivaId} value={cliente} onChange={setCliente} origem={origem} onOrigemChange={setOrigem} />
      </AtendimentoAccordionSection>

      <AtendimentoAccordionSection titulo="Aparelho" aberto={abertos.aparelho} onToggle={() => setAbertos((a) => ({ ...a, aparelho: !a.aparelho }))} resumo={[aparelho.marca, aparelho.modelo].filter(Boolean).join(" ") || undefined}>
        <AparelhoAtendimentoSection value={aparelho} onChange={setAparelho} />
      </AtendimentoAccordionSection>

      {tipo === "servico_autorizado" ? (
        <AtendimentoAccordionSection titulo="Serviço / Comercial" aberto={abertos.comercial} onToggle={() => setAbertos((a) => ({ ...a, comercial: !a.comercial }))}>
          <ServicoCatalogLookup
            storeId={lojaAtivaId}
            onSelect={(s) => {
              setServicoNome(s.nome);
              setServicoValor(s.preco);
              setServicoCusto(s.custo);
              setServicoGarantia(s.garantia);
              setServicoPrazo(s.tempo === "—" ? "" : s.tempo);
            }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,0.7fr) minmax(0,0.7fr)", gap: 8 }}>
            <div>
              <div style={atendLabel}>Serviço *</div>
              <input value={servicoNome} onChange={(e) => setServicoNome(e.target.value)} placeholder="Troca de tela" style={atendInput} autoComplete="off" />
            </div>
            <div>
              <div style={atendLabel}>Venda *</div>
              <input type="number" min={0} step="0.01" value={servicoValor || ""} onChange={(e) => setServicoValor(Math.max(0, Number(e.target.value) || 0))} style={atendInput} autoComplete="off" />
            </div>
            <div>
              <div style={atendLabel}>Custo interno</div>
              <input type="number" min={0} step="0.01" value={servicoCusto || ""} onChange={(e) => setServicoCusto(Math.max(0, Number(e.target.value) || 0))} style={{ ...atendInput, background: C.muted100 }} title="Custo interno — não aparece para o cliente." autoComplete="off" />
            </div>
            <div>
              <div style={atendLabel}>Garantia (dias)</div>
              <input type="number" min={0} value={servicoGarantia || ""} onChange={(e) => setServicoGarantia(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} style={atendInput} autoComplete="off" />
            </div>
            <div>
              <div style={atendLabel}>Prazo</div>
              <input value={servicoPrazo} onChange={(e) => setServicoPrazo(e.target.value)} placeholder="2 horas" style={atendInput} autoComplete="off" />
            </div>
            <div style={{ border: `1px dashed ${C.line2}`, background: C.muted100, borderRadius: 8, padding: "8px 10px", fontSize: 11, color: C.subtle, alignSelf: "end" }}>
              Interno: lucro {lucro.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              {margem != null ? ` · ${margem.toFixed(1)}%` : ""}
            </div>
          </div>
        </AtendimentoAccordionSection>
      ) : null}

      <AtendimentoAccordionSection titulo="Recepção" aberto={abertos.recepcao} onToggle={() => setAbertos((a) => ({ ...a, recepcao: !a.recepcao }))}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
          <div>
            <div style={atendLabel}>Recebido por</div>
            <input value={recebidoPor} onChange={(e) => setRecebidoPor(e.target.value)} placeholder="Nome do atendente" style={atendInput} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>Prioridade</div>
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as typeof prioridade)} style={atendInput}>
              <option value="baixa">Baixa</option>
              <option value="media">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </div>
          <div>
            <div style={atendLabel}>Localização</div>
            <select value={localFisico} onChange={(e) => setLocalFisico(e.target.value as typeof localFisico)} style={atendInput}>
              <option value="balcao">Balcão</option>
              <option value="bancada">Bancada</option>
              <option value="aguardando_diagnostico">Aguardando diagnóstico</option>
            </select>
          </div>
          <div>
            <div style={atendLabel}>Previsão / SLA</div>
            <input type="datetime-local" value={previsao} onChange={(e) => setPrevisao(e.target.value)} style={atendInput} autoComplete="off" />
          </div>
        </div>
      </AtendimentoAccordionSection>

      <AtendimentoAccordionSection titulo="Prova de entrada" aberto={abertos.prova} onToggle={() => setAbertos((a) => ({ ...a, prova: !a.prova }))} resumo="Completar depois no workspace">
        <p style={{ margin: 0, fontSize: 12.5, color: C.subtle, lineHeight: 1.5 }}>
          Segurança, inspeção, acessórios, fotos e assinatura ficam no workspace da Entrada depois da criação.
        </p>
      </AtendimentoAccordionSection>
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
