// ============================================================================
// Operações V4 — "⚡ Orçamento Rápido" · mapeamento PURO do formulário V4 →
// OrcamentoRapidoInputV3 (GOAL OPS-V4-ORC-RAPIDO-024).
// ----------------------------------------------------------------------------
// Módulo PURO (sem I/O, sem React, sem Prisma). Converte o formulário do modal
// no input canônico já aceito por `criarOrcamentoRapidoV3` (V3, reaproveitada
// tal como é — nenhum motor novo). NÃO persiste nada e NÃO substitui a
// validação da V3 (`validarOrcamentoRapidoInputV3`) — a validação daqui é só
// para gating de UI (mensagens iguais quando fazem sentido no client).
// ============================================================================

import { MAX_LINHAS_POR_GRUPO_V3, computeTotaisV3, type TotaisOrcamentoV3 } from "@/lib/operacoes-v3/orcamento-model";
import { montarServicosOrcamentoRapidoV3, type OrcamentoRapidoInputV3 } from "@/lib/operacoes-v3/orcamento-rapido-model";

const MIN_VARIANTES = 2;

function uid(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

/** Trim → string não-vazia ou undefined (não inventa valor). */
function clean(value: string | undefined | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length ? s : undefined;
}

/** Cliente existente selecionado pela busca real (read-only) da loja ativa. */
export interface OrcamentoRapidoClienteExistenteV4 {
  id: string;
  nome: string;
  telefone?: string;
  documento?: string;
  email?: string;
}

export interface OrcamentoRapidoItemFixoFormV4 {
  /** Só uso local (key de lista) — nunca vai para o servidor. */
  id: string;
  descricao: string;
  valor: number;
  cortesia: boolean;
  /** 0 = não informado. */
  custoV3: number;
  quantidade: number;
}

export interface OrcamentoRapidoVarianteFormV4 {
  /** Só uso local (key de lista) — nunca vai para o servidor. */
  id: string;
  rotulo: string;
  valor: number;
  /** 0 = não informado. */
  garantiaDias: number;
  descricaoCurta: string;
  badge: string;
  /** 0 = não informado. */
  custoV3: number;
  prazoTexto: string;
}

/** Estado controlado do formulário do modal "⚡ Orçamento Rápido" da V4. */
export interface OrcamentoRapidoFormV4 {
  clienteModo: "existente" | "novo";
  /** modo === "existente" */
  clienteExistente: OrcamentoRapidoClienteExistenteV4 | null;
  /** modo === "novo" */
  clienteNovoNome: string;
  clienteNovoTelefone: string;
  clienteNovoDocumento: string;
  clienteNovoEmail: string;
  origemAtendimento: "whatsapp" | "balcao" | "instagram" | "ligacao" | "outro";
  equipamentoTipo: "celular" | "tablet" | "notebook" | "videogame" | "outro";
  aparelhoMarca: string;
  aparelhoModelo: string;
  aparelhoImei: string;
  aparelhoCor: string;
  defeitoRelatado: string;
  causaProvavel: string;
  solucaoSugerida: string;
  observacaoTecnica: string;
  validadeDias: number;
  prazoEstimado: string;
  observacaoCliente: string;
  observacaoInterna: string;
  itensFixos: OrcamentoRapidoItemFixoFormV4[];
  grupoRotulo: string;
  variantes: OrcamentoRapidoVarianteFormV4[];
}

export function novaVarianteVaziaV4(): OrcamentoRapidoVarianteFormV4 {
  return { id: uid("var"), rotulo: "", valor: 0, garantiaDias: 0, descricaoCurta: "", badge: "", custoV3: 0, prazoTexto: "" };
}

export function novoItemFixoVazioV4(): OrcamentoRapidoItemFixoFormV4 {
  return { id: uid("fix"), descricao: "", valor: 0, cortesia: false, custoV3: 0, quantidade: 1 };
}

/** Formulário vazio (estado inicial do modal, sempre que abre) — já com 2 variantes. */
export function orcamentoRapidoFormVazioV4(): OrcamentoRapidoFormV4 {
  return {
    clienteModo: "existente",
    clienteExistente: null,
    clienteNovoNome: "",
    clienteNovoTelefone: "",
    clienteNovoDocumento: "",
    clienteNovoEmail: "",
    origemAtendimento: "whatsapp",
    equipamentoTipo: "celular",
    aparelhoMarca: "",
    aparelhoModelo: "",
    aparelhoImei: "",
    aparelhoCor: "",
    defeitoRelatado: "",
    causaProvavel: "",
    solucaoSugerida: "",
    observacaoTecnica: "",
    validadeDias: 7,
    prazoEstimado: "",
    observacaoCliente: "",
    observacaoInterna: "",
    itensFixos: [],
    grupoRotulo: "",
    variantes: [novaVarianteVaziaV4(), novaVarianteVaziaV4()],
  };
}

/** Acrescenta uma variante vazia (no-op quando já está no limite de 4). */
export function adicionarVarianteV4(form: OrcamentoRapidoFormV4): OrcamentoRapidoFormV4 {
  if (form.variantes.length >= MAX_LINHAS_POR_GRUPO_V3) return form;
  return { ...form, variantes: [...form.variantes, novaVarianteVaziaV4()] };
}

/** Remove uma variante pelo id (no-op quando já está no piso de 2). */
export function removerVarianteV4(form: OrcamentoRapidoFormV4, id: string): OrcamentoRapidoFormV4 {
  if (form.variantes.length <= MIN_VARIANTES) return form;
  return { ...form, variantes: form.variantes.filter((v) => v.id !== id) };
}

export function adicionarItemFixoV4(form: OrcamentoRapidoFormV4): OrcamentoRapidoFormV4 {
  return { ...form, itensFixos: [...form.itensFixos, novoItemFixoVazioV4()] };
}

export function removerItemFixoV4(form: OrcamentoRapidoFormV4, id: string): OrcamentoRapidoFormV4 {
  return { ...form, itensFixos: form.itensFixos.filter((it) => it.id !== id) };
}

/**
 * Validação de UI (gating do botão salvar). Mensagens compatíveis com
 * `validarOrcamentoRapidoInputV3` (V3) quando fazem sentido no client, mais a
 * exigência de telefone no modo "novo" — regra SÓ desta UI (o motor continua
 * sem exigir telefone; ver GOAL 024, "regra de UI deste fluxo").
 */
export function validarOrcamentoRapidoFormV4(form: OrcamentoRapidoFormV4): string | null {
  if (form.clienteModo === "existente" && !form.clienteExistente) {
    return "Selecione o cliente existente.";
  }
  if (form.clienteModo === "novo") {
    if (!form.clienteNovoNome.trim()) return "Informe o nome do cliente.";
    if (!form.clienteNovoTelefone.trim()) {
      return "Informe o telefone do cliente (necessário para enviar o orçamento depois).";
    }
  }
  if (!form.aparelhoMarca.trim() || !form.aparelhoModelo.trim()) {
    return "Informe marca e modelo do aparelho.";
  }
  if (!form.defeitoRelatado.trim()) {
    return "Descreva o defeito relatado.";
  }
  if (!form.grupoRotulo.trim()) {
    return "Informe o rótulo do grupo de escolha.";
  }
  if (form.variantes.length < MIN_VARIANTES) {
    return "O grupo de escolha precisa de pelo menos 2 opções.";
  }
  if (form.variantes.length > MAX_LINHAS_POR_GRUPO_V3) {
    return `O grupo de escolha aceita no máximo ${MAX_LINHAS_POR_GRUPO_V3} opções.`;
  }
  for (const v of form.variantes) {
    if (!v.rotulo.trim()) return "Toda opção do grupo precisa de um rótulo.";
    if (!(v.valor >= 0)) return `Informe um preço válido para "${v.rotulo}".`;
  }
  const comBadge = form.variantes.filter((v) => v.badge.trim()).length;
  if (comBadge > 1) return "Use no máximo 1 selo (badge) por grupo.";
  for (const it of form.itensFixos) {
    if (!it.descricao.trim()) return "Há um item fixo sem descrição.";
  }
  return null;
}

/**
 * Converte o formulário V4 no input canônico da V3. Não valida nem persiste —
 * use `validarOrcamentoRapidoFormV4` (gating de UI) e a própria
 * `criarOrcamentoRapidoV3` (que valida de novo no servidor) antes de chamar.
 */
export function buildOrcamentoRapidoInputFromFormV4(form: OrcamentoRapidoFormV4): OrcamentoRapidoInputV3 {
  const cliente: OrcamentoRapidoInputV3["cliente"] =
    form.clienteModo === "existente"
      ? { modo: "existente", clienteId: clean(form.clienteExistente?.id), nome: clean(form.clienteExistente?.nome), telefone: clean(form.clienteExistente?.telefone) }
      : { modo: "novo", nome: clean(form.clienteNovoNome), telefone: clean(form.clienteNovoTelefone) };

  const itensFixos = form.itensFixos
    .filter((it) => it.descricao.trim())
    .map((it) => ({
      descricao: it.descricao.trim(),
      valor: Math.max(0, Number(it.valor) || 0),
      kindV3: it.cortesia ? ("brinde" as const) : ("cobrado" as const),
      custoV3: it.custoV3 > 0 ? it.custoV3 : undefined,
    }));

  const variantes = form.variantes.map((v) => ({
    rotulo: v.rotulo.trim(),
    valor: Math.max(0, Number(v.valor) || 0),
    garantiaDias: v.garantiaDias > 0 ? Math.trunc(v.garantiaDias) : undefined,
    descricaoCurta: clean(v.descricaoCurta),
    prazoTexto: clean(v.prazoTexto),
    badge: clean(v.badge),
    custoV3: v.custoV3 > 0 ? v.custoV3 : undefined,
  }));

  return {
    cliente,
    aparelho: { marca: form.aparelhoMarca.trim(), modelo: form.aparelhoModelo.trim() },
    defeitoRelatado: form.defeitoRelatado.trim(),
    itensFixos: itensFixos.length ? itensFixos : undefined,
    grupo: { rotulo: form.grupoRotulo.trim(), variantes },
  };
}

/**
 * Prévia dos totais (faixa/exato) — REUSA `montarServicosOrcamentoRapidoV3` +
 * `computeTotaisV3` (V3, mesmas funções da action real). Zero aritmética
 * própria aqui: o número exibido no rodapé é sempre o que o servidor calcularia.
 */
export function previaTotaisOrcamentoRapidoV4(form: OrcamentoRapidoFormV4): TotaisOrcamentoV3 {
  const input = buildOrcamentoRapidoInputFromFormV4(form);
  if (!input.grupo.variantes.length) return computeTotaisV3({ servicos: [], pecas: [], desconto: 0 });
  const servicos = montarServicosOrcamentoRapidoV3(input, "preview");
  return computeTotaisV3({ servicos, pecas: [], desconto: 0 });
}
