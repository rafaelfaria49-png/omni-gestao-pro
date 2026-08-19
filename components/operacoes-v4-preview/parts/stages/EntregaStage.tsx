/**
 * Operações V4 Preview — etapa Entrega.
 *
 * GOAL OPS-V4-P0-012: lê apenas o que a OS persiste — retirada confirmada,
 * data de entrega, assinatura textual, acessórios reais do aparelho, eventos
 * de entrega/garantia e a garantia real (operacional ou de payload). Nenhum
 * dado fabricado: onde não houver fonte, mostra empty state honesto.
 *
 * GOAL OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008: a etapa ganha UMA ação real —
 * "Confirmar entrega" (`v.confirmarEntrega` → `registrarEntregaV3`) — o cliente
 * orienta a UX, mas a decisão financeira final é sempre refeita no servidor.
 * O restante da etapa segue
 * read-only (checklist final de entrega continua sem action V3 segura).
 *
 * GOAL OPS-V4-DOCS-ASSINATURA-TERMOS-ANEXOS-012: a assinatura de retirada passa
 * a ser a imagem digital REAL (`entregaV3.assinaturaRetirada`, mesma fonte do
 * Termo de Entrega impresso) em vez do antigo texto fabricado. Quando a OS já
 * foi entregue e ainda não há assinatura capturada, reaproveita o MESMO canvas
 * (`SignaturePadV3`) já usado pela Prova de Entrada/Entrega da V3 — sem motor
 * de captura novo — persistindo via `salvarAssinaturaRetiradaV3`.
 *
 * GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014: o card "Garantia da OS" ganha o lado de
 * escrita — definir/editar modelo + prazo — reusando o MESMO catálogo/contrato
 * da V3 (`GARANTIA_CATALOGO_V3`/`prazoPadraoGarantiaV3` de `garantia-textos.ts`,
 * `salvarGarantiaOSV3` via `v.salvarGarantia`). Paridade com `GarantiaOSV3.tsx`
 * da V3: só modelo + prazo (sem termo customizado nesta etapa).
 */
import { useEffect, useState, type ReactNode } from "react";
import { C, card, cardTitle, fmt, upLabel, pill, inputBase } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";
import { SignaturePadV3 } from "@/components/operacoes-v3/components/SignaturePadV3";
import { CATEGORIAS_FOTO_SAIDA_V3, lerGarantiaV3, type CategoriaFotoSaidaV3 } from "@/lib/operacoes-v3/pos-venda-model";
import { FOTO_MAX_V3 } from "@/lib/operacoes-v3/prova-entrada-model";
import { GARANTIA_CATALOGO_V3, prazoPadraoGarantiaV3 } from "@/lib/operacoes-v3/garantia-textos";
import type { EntregaSemCobrancaCategoriaV3, EntregaSemCobrancaSolicitacaoV3 } from "@/lib/operacoes-v3/delivery-financial-guard";
import { RealActionNotice } from "../RealActionNotice";

const col3 = "repeat(auto-fit, minmax(280px, 1fr))";
const col2 = "minmax(0,1fr) minmax(0,1fr)";

const btnPrimary: React.CSSProperties = {
  height: 34,
  padding: "0 16px",
  border: "none",
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  color: C.white,
};

/**
 * Ação real de confirmação de entrega (slice OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008).
 * Só aparece quando há algo a decidir (`podeConfirmar`, `bloqueadaPorSaldo` ou
 * `semCobrancaLancada`); busy-lock local evita duplo clique — toast e reload
 * pós-sucesso vêm do próprio handler (`runWrite`, em `use-v4-preview`), não daqui.
 *
 * GOAL OPS-V4-ENTREGA-GUARD-SEM-COBRANCA-002: uma OS com total R$ 0 (sem cobrança
 * lançada) NÃO pode ser entregue em silêncio. Nesse caso o card mostra um alerta
 * forte e dois caminhos explícitos — "Ir para Orçamento" (lançar a cobrança) ou
 * "Entregar sem cobrança". Esse caminho coleta categoria + motivo e os envia à
 * action canônica; ator, loja, horário, persistência e decisão final são server-side.
 */
function EntregaAcaoCard({ v }: { v: V4Vals }) {
  const [busy, setBusy] = useState(false);
  const [formSemCobrancaAberto, setFormSemCobrancaAberto] = useState(false);
  const [categoria, setCategoria] = useState<EntregaSemCobrancaCategoriaV3 | "">("");
  const [motivo, setMotivo] = useState("");
  const ea = v.entregaAcoes;
  const osKey = v.realOS?.id ?? "";
  useEffect(() => {
    setFormSemCobrancaAberto(false);
    setCategoria("");
    setMotivo("");
  }, [osKey, ea.semCobrancaLancada]);

  if (!ea.podeConfirmar && !ea.bloqueadaPorSaldo && !ea.semCobrancaLancada && !ea.leituraFinanceiraBloqueada) return null;

  const run = async (semCobranca?: EntregaSemCobrancaSolicitacaoV3) => {
    if (busy) return;
    const confirmado = window.confirm(
      semCobranca
        ? "A entrega será registrada sem cobrança, com categoria, motivo e responsável na auditoria. Confirmar?"
        : "Entrega real: ao confirmar, a OS será marcada como entregue no histórico. Confirmar?"
    );
    if (!confirmado) return;
    setBusy(true);
    try {
      await v.confirmarEntrega(semCobranca);
    } finally {
      setBusy(false);
    }
  };

  if (ea.leituraFinanceiraBloqueada) {
    return (
      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 6 }}>Entrega</div>
        <div style={{ fontSize: 11.5, color: C.warnFg, lineHeight: 1.5 }}>
          {ea.financeiroCarregando
            ? "Confirmando a situação financeira desta OS…"
            : ea.financeiroMotivo ?? "Não foi possível confirmar a situação financeira desta OS. Revise a cobrança antes de entregar."}
        </div>
      </div>
    );
  }

  if (ea.bloqueadaPorSaldo) {
    return (
      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 6 }}>Entrega</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.warnFg, marginBottom: 4 }}>
          Pagamento pendente{ea.saldoPendente != null ? `  ${fmt(ea.saldoPendente)}` : ""}
        </div>
        <div style={{ fontSize: 11.5, color: C.warnFg, lineHeight: 1.5, marginBottom: 10 }}>
          Receba o pagamento (ou lance a prazo) antes de confirmar a entrega.
        </div>
        <button
          type="button"
          onClick={v.openReceberPagamento}
          style={{ height: 30, padding: "0 12px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}
        >
          Receber pagamento
        </button>
      </div>
    );
  }

  if (ea.semCobrancaLancada && !formSemCobrancaAberto) {
    return (
      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 8 }}>Entrega</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: C.warnBg, border: `1px solid ${C.warnBd}`, borderRadius: 9, padding: "10px 12px", marginBottom: 12 }}>
          <span style={{ fontSize: 14, lineHeight: "18px", flex: "none" }}>⚠️</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.warnFg, marginBottom: 3 }}>OS sem cobrança lançada</div>
            <div style={{ fontSize: 11.5, color: C.warnFg, lineHeight: 1.5 }}>
              Esta OS está com total <strong>R$ 0</strong>. Se houve serviço cobrado, lance o orçamento ou recebimento antes de entregar.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 9 }}>
          <button
            type="button"
            onClick={v.goOrcamento}
            style={{ ...btnPrimary, background: C.primary, cursor: "pointer" }}
          >
            Ir para Orçamento
          </button>
          <button
            type="button"
            onClick={() => setFormSemCobrancaAberto(true)}
            style={{ height: 34, padding: "0 14px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Entregar sem cobrança
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: C.subtle, lineHeight: 1.5 }}>
          Use entrega sem cobrança apenas para cortesia, garantia ou serviço realmente sem valor.
        </div>
      </div>
    );
  }

  if (ea.semCobrancaLancada) {
    const podeEnviar = !!categoria && motivo.trim().length > 0 && !busy;
    return (
      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 8 }}>Entrega sem cobrança</div>
        <div style={{ fontSize: 11.5, color: C.warnFg, lineHeight: 1.5, marginBottom: 12 }}>
          A classificação e a justificativa serão validadas e auditadas pelo servidor antes da entrega.
        </div>
        <label style={{ display: "grid", gap: 5, marginBottom: 10 }}>
          <span style={upLabel}>Categoria obrigatória</span>
          <select
            value={categoria}
            onChange={(event) => setCategoria(event.target.value as EntregaSemCobrancaCategoriaV3 | "")}
            style={{ ...inputBase, height: 36 }}
          >
            <option value="">Selecione</option>
            <option value="cortesia">Cortesia</option>
            <option value="garantia">Garantia</option>
            <option value="sem_valor">Serviço sem valor</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 5, marginBottom: 12 }}>
          <span style={upLabel}>Motivo obrigatório</span>
          <textarea
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            placeholder="Explique por que esta OS será entregue sem cobrança"
            style={{ ...inputBase, minHeight: 76, paddingTop: 9, resize: "vertical" }}
          />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!podeEnviar}
            onClick={() => void run({ categoria: categoria as EntregaSemCobrancaCategoriaV3, motivo })}
            style={{ ...btnPrimary, background: C.success, cursor: podeEnviar ? "pointer" : "default", opacity: podeEnviar ? 1 : 0.6 }}
          >
            {busy ? "Confirmando…" : "Confirmar entrega sem cobrança"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setFormSemCobrancaAberto(false)}
            style={{ height: 34, padding: "0 14px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer" }}
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ ...cardTitle, marginBottom: 10 }}>Entrega</div>
      {ea.autorizadaAPrazo ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: C.infoBg, border: `1px solid ${C.infoBd}`, borderRadius: 9, padding: "9px 11px", marginBottom: 14 }}>
          <span style={{ fontSize: 13, lineHeight: "16px", flex: "none" }}>ℹ️</span>
          <span style={{ fontSize: 11.5, color: C.infoFg, lineHeight: 1.45 }}>
            <strong>Entrega autorizada a prazo.</strong> O cliente possui conta a receber pendente — esta OS não está quitada.
          </span>
        </div>
      ) : ea.autorizadaSemCobranca ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: C.infoBg, border: `1px solid ${C.infoBd}`, borderRadius: 9, padding: "9px 11px", marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: C.infoFg, lineHeight: 1.45 }}><strong>Entrega sem cobrança autorizada.</strong> A classificação persistida será revalidada pelo servidor.</span>
        </div>
      ) : (
        <RealActionNotice kind="entrega" />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        style={{ ...btnPrimary, background: C.success, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
      >
        {busy ? "Confirmando…" : "Confirmar entrega real"}
      </button>
    </div>
  );
}

type Tone = "success" | "info" | "warn" | "danger" | "neutro";

const TONE_MAP: Record<Tone, { bg: string; fg: string; dot: string }> = {
  success: { bg: C.successBg, fg: C.successFg, dot: C.success },
  info: { bg: C.infoBg, fg: C.infoFg, dot: C.info },
  warn: { bg: C.warnBg, fg: C.warnFg, dot: C.warn },
  danger: { bg: C.dangerBg, fg: C.dangerFg, dot: C.danger },
  neutro: { bg: C.muted100, fg: C.muted, dot: C.subtle },
};

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const t = TONE_MAP[tone];
  return (
    <span style={pill(t.bg, t.fg)}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.dot }} />
      {label}
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, color: C.subtle, lineHeight: 1.5 }}>{children}</div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={upLabel}>{label}</div>
      <div style={{ fontSize: 12.5, color: C.body, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

/**
 * Captura da assinatura de retirada (só aparece após a entrega, quando ainda não
 * há assinatura salva). Reaproveita `SignaturePadV3` (canvas já usado pela V3) e
 * `v.salvarAssinaturaRetirada` (reuso de `salvarAssinaturaRetiradaV3`).
 */
function AssinaturaRetiradaCard({ v }: { v: V4Vals }) {
  const [salvando, setSalvando] = useState(false);
  const onSave = async (dataUrl: string) => {
    setSalvando(true);
    try {
      await v.salvarAssinaturaRetirada(dataUrl);
    } finally {
      setSalvando(false);
    }
  };
  return (
    <SignaturePadV3
      onSave={onSave}
      salvando={salvando}
      height={110}
      label="Salvar assinatura"
      hint="Colete a assinatura de quem retirou o equipamento."
    />
  );
}

/**
 * Definir/editar a garantia da OS (GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014). Seed
 * vem de `lerGarantiaV3(v.realOS)` — mesmo leitor puro que `os-adapter` usa —
 * só para ler o `modeloId` bruto (não exposto em `V4GarantiaView`, que já
 * resolve o texto pronto para exibição). Salva via `v.salvarGarantia`, reuso
 * direto de `salvarGarantiaOSV3` (mesmo contrato/payload que a V3 grava).
 */
function GarantiaFormCard({ v }: { v: V4Vals }) {
  const seed = lerGarantiaV3(v.realOS);
  const seedModeloId = seed.temGarantia ? seed.modeloId : "sem_garantia";
  const seedPrazoDias = seed.temGarantia ? seed.prazoDias : prazoPadraoGarantiaV3("sem_garantia");

  const [modeloId, setModeloId] = useState(seedModeloId);
  const [prazoDias, setPrazoDias] = useState(seedPrazoDias);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reseta o formulário quando a OS/garantia muda (troca de OS ou reload pós-save).
  const seedKey = `${v.realOS?.id ?? ""}:${v.realOS?.atualizadoEm ?? ""}`;
  useEffect(() => {
    setModeloId(seedModeloId);
    setPrazoDias(seedPrazoDias);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const aplicarModelo = (id: string) => {
    setModeloId(id);
    setPrazoDias(prazoPadraoGarantiaV3(id));
    setDirty(true);
  };

  const onSalvar = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      const ok = await v.salvarGarantia({ modeloId, prazoDias });
      if (ok) setDirty(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ ...upLabel, marginBottom: 8 }}>{seed.temGarantia ? "Editar garantia" : "Definir garantia"}</div>
      <div style={{ display: "grid", gridTemplateColumns: col2, gap: 10, marginBottom: 10 }}>
        <label>
          <div style={{ ...upLabel, marginBottom: 4 }}>Modelo de garantia</div>
          <select value={modeloId} onChange={(e) => aplicarModelo(e.target.value)} style={inputBase}>
            {GARANTIA_CATALOGO_V3.map((m) => (
              <option key={m.id} value={m.id}>{m.titulo}</option>
            ))}
          </select>
        </label>
        <label>
          <div style={{ ...upLabel, marginBottom: 4 }}>Prazo em dias</div>
          <input
            type="number"
            min={0}
            value={prazoDias}
            onChange={(e) => {
              setPrazoDias(Math.max(0, Math.trunc(Number(e.target.value) || 0)));
              setDirty(true);
            }}
            style={inputBase}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !dirty}
        onClick={() => void onSalvar()}
        style={{
          ...btnPrimary,
          background: C.primary,
          cursor: busy || !dirty ? "default" : "pointer",
          opacity: busy || !dirty ? 0.6 : 1,
        }}
      >
        {busy ? "Salvando…" : "Salvar garantia"}
      </button>
      <div style={{ fontSize: 10.5, color: C.subtle, marginTop: 8, lineHeight: 1.5 }}>
        A garantia fica prevista na OS e passa a valer na entrega.
      </div>
    </div>
  );
}

async function comprimirFotoSaida(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Imagem inválida."));
    image.src = dataUrl;
  });
  const scale = Math.min(1, 1024 / Math.max(img.width || 1, img.height || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
  canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

function FotosSaidaCard({ v }: { v: V4Vals }) {
  const [categoria, setCategoria] = useState<CategoriaFotoSaidaV3>("reparado");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fotos = v.entrega.fotosSaida;
  const remaining = Math.max(0, FOTO_MAX_V3 - fotos.length);

  const onUpload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await comprimirFotoSaida(file);
      const ok = await v.adicionarFotoSaida({ categoria, nome: file.name, dataUrl });
      if (!ok) setError("Não foi possível adicionar a foto de saída.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar a foto de saída.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={cardTitle}>Fotos de saída</span>
        <span style={{ fontSize: 11, color: C.subtle }}>{fotos.length} de {FOTO_MAX_V3}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: col2, gap: 10, marginBottom: 10 }}>
        <label>
          <div style={{ ...upLabel, marginBottom: 4 }}>Categoria</div>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaFotoSaidaV3)} style={inputBase}>
            {CATEGORIAS_FOTO_SAIDA_V3.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <div style={{ ...upLabel, marginBottom: 4 }}>Adicionar foto</div>
          <input
            type="file"
            accept="image/*"
            disabled={busy || remaining <= 0}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onUpload(file);
            }}
            style={inputBase}
          />
        </label>
      </div>
      {fotos.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 8 }}>
          {fotos.map((foto) => (
            <figure key={foto.id} style={{ margin: 0, border: `1px solid ${C.line2}`, borderRadius: 8, overflow: "hidden", position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto.dataUrl} alt={foto.name} style={{ display: "block", width: "100%", height: 72, objectFit: "cover" }} />
              <figcaption style={{ fontSize: 9, fontWeight: 700, padding: "3px 6px", color: C.muted }}>{foto.tag}</figcaption>
              <button type="button" onClick={() => void v.removerFotoSaida(foto.id)} aria-label="Remover foto de saída" style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, border: "none", borderRadius: 6, background: "rgba(0,0,0,.55)", color: C.white, cursor: "pointer", fontSize: 12 }}>×</button>
            </figure>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.subtle }}>Nenhuma foto de saída registrada.</div>
      )}
      {error ? <div style={{ fontSize: 12, color: C.danger, marginTop: 8 }} role="alert">{error}</div> : null}
    </div>
  );
}

function DocumentosEntregaCard({ v }: { v: V4Vals }) {
  const btn: React.CSSProperties = {
    height: 32,
    padding: "0 12px",
    border: `1px solid ${C.inputBd}`,
    background: C.surface,
    color: C.body,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };
  return (
    <div style={card}>
      <div style={{ ...cardTitle, marginBottom: 10 }}>Documentos</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" style={btn} onClick={() => v.openDocPrint("termo_garantia")}>Imprimir Termo de Garantia</button>
        <button type="button" style={btn} onClick={() => v.openDocPrint("termo_entrega")}>Imprimir Termo de Entrega</button>
        <button type="button" style={btn} onClick={() => v.openDocPrint("os_cliente")}>Imprimir OS (cliente)</button>
      </div>
      <div style={{ fontSize: 10.5, color: C.subtle, marginTop: 8, lineHeight: 1.5 }}>
        Reimpressão abre o mesmo documento. WhatsApp no modal, quando o cliente tiver telefone válido.
      </div>
    </div>
  );
}

export function EntregaStage({ v }: { v: V4Vals }) {
  const e = v.entrega;
  const g = e.garantia;

  if (!e.temRegistro) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <EntregaAcaoCard v={v} />
        <div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "40px 18px", textAlign: "center" }}>
          <span style={{ fontSize: 22 }}>📦</span>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.body }}>Esta Ordem de Serviço ainda não foi entregue.</div>
          <div style={{ fontSize: 11.5, color: C.subtle, maxWidth: 360, lineHeight: 1.5 }}>
            O registro de retirada, a assinatura e a garantia aparecem aqui assim que a entrega for concluída.
          </div>
        </div>
        <FotosSaidaCard v={v} />
        <DocumentosEntregaCard v={v} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <EntregaAcaoCard v={v} />
      <DocumentosEntregaCard v={v} />
      <FotosSaidaCard v={v} />
      <div style={{ display: "grid", gridTemplateColumns: col3, gap: 12, alignItems: "start" }}>
      {/* Registro de entrega (real) */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={cardTitle}>📦 Registro de entrega</span>
          <StatusBadge label={e.statusLabel} tone={e.statusTone} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: col2, gap: 10 }}>
          <Field label="Retirado por" value={e.retiradoPor} />
          <Field label="Data / hora" value={e.retiradoEm} />
        </div>
        {e.observacao && (
          <div style={{ marginTop: 11 }}>
            <div style={{ ...upLabel, marginBottom: 3 }}>Observação</div>
            <div style={{ fontSize: 12, color: C.bodySoft, lineHeight: 1.5 }}>{e.observacao}</div>
          </div>
        )}

        <div style={{ ...upLabel, margin: "13px 0 5px" }}>Assinatura de retirada</div>
        {e.temAssinatura ? (
          <div style={{ border: `1px solid ${C.line2}`, background: C.surface2, borderRadius: 8, padding: 8, display: "flex", justifyContent: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.assinaturaDataUrl} alt="Assinatura de retirada" style={{ maxHeight: 90, objectFit: "contain" }} />
          </div>
        ) : e.entregue ? (
          <AssinaturaRetiradaCard v={v} />
        ) : (
          <Empty>Nenhuma assinatura de entrega registrada.</Empty>
        )}

        <div style={{ ...upLabel, margin: "14px 0 6px" }}>Linha do tempo da entrega</div>
        {e.eventos.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {e.eventos.map((ev) => (
              <div key={ev.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: ev.dot, marginTop: 5, flex: "none" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.body }}>{ev.text}</div>
                  <div style={{ fontSize: 10.5, color: C.subtle }}>{ev.meta}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Nenhum evento de entrega registrado.</Empty>
        )}
      </div>

      {/* Checklist final + acessórios */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>Checklist final de entrega</div>
          <Empty>Nenhum checklist de entrega registrado.</Empty>
        </div>
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 9 }}>Acessórios do aparelho</div>
          {e.acessorios.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: col2, gap: 6 }}>
              {e.acessorios.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, border: `1px solid ${C.line2}`, background: C.surface, borderRadius: 7, padding: "6px 8px" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.subtle, flex: "none" }} />
                  <span style={{ fontSize: 11.5, color: C.body, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Nenhum acessório registrado para esta OS.</Empty>
          )}
        </div>
      </div>

      {/* Garantia da OS (real) */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
          <span style={cardTitle}>🛡 Garantia da OS</span>
          {g.temGarantia && <StatusBadge label={g.situacao} tone={g.situacaoTone} />}
        </div>
        {g.temGarantia && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: col2, gap: 10, marginBottom: 11 }}>
              <Field label="Prazo" value={g.prazo} />
              <Field label="Cobertura" value={g.cobertura} />
              <Field label="Início" value={g.inicio} />
              <Field label="Validade" value={g.fim} />
            </div>
            {g.observacoes && (
              <div style={{ marginBottom: 11 }}>
                <div style={{ ...upLabel, marginBottom: 3 }}>Condições</div>
                <div style={{ fontSize: 12, color: C.bodySoft, lineHeight: 1.5 }}>{g.observacoes}</div>
              </div>
            )}
            {g.acionamentos && (
              <div style={{ fontSize: 11.5, color: C.warnFg, marginBottom: 11 }}>
                Acionamentos registrados: <b>{g.acionamentos}</b>
              </div>
            )}
            <div style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 11 }}>
              <GarantiaFormCard v={v} />
            </div>
          </>
        )}
        {!g.temGarantia && <GarantiaFormCard v={v} />}
      </div>
      </div>
    </div>
  );
}
