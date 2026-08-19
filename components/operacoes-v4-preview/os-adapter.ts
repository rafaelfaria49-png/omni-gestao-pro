/**
 * Operações V4 Preview — adaptador READ-ONLY de OS real → view-models da V4.
 *
 * Recebe uma `OrdemServico` real (de `@/types/os`, carregada por `getOrdem` /
 * `listOrdens`) e produz os objetos que os componentes da V4 já consomem
 * (`os`, `pag`, eventos de histórico, checklist). Puro, sem efeitos colaterais.
 *
 * Princípio (GOAL OPS-V4-P0-002..005): **vazio honesto**. Onde não há dado real,
 * mostramos `NI` ("Não informado") em vez de inventar valor. Nada de mock novo.
 */
import type {
  OrdemServico,
  OSStatus,
  EventoTimeline,
  EventoTipo,
  ChecklistItem,
  Anexo,
  AnexoTipo,
  ObservacaoTecnica,
  Orcamento,
  PecaUsada,
  Servico,
  OrcamentoStatus,
} from "@/types/os";
import type { V4Status, V4Stage } from "./types";
import { destinoOperacionalPorStatusV4 } from "@/lib/operacoes-v4/pipeline-operacional";
import { C, fmt } from "./tokens";
// Reuso PURO (read-only) dos readers da V3: identificação rica da prova de entrada
// e dados básicos da recepção (recebido por / localização / origem / observações).
import { lerProvaEntradaV3 } from "@/lib/operacoes-v3/prova-entrada-model";
// Reuso PURO (read-only) do leitor de pagamento da V3: lê o espelho
// `payload.pagamentoV3` gravado pelo PDV de Serviço (GOAL 006). Nenhuma escrita.
import { lerPagamentoV3, PAGAMENTO_STATUS_META_V3 } from "@/lib/operacoes-v3/payment-model";
import {
  lerDadosBasicosV3,
  LOCAL_FISICO_LABEL_V3,
  ORIGEM_LABEL_V3,
} from "@/lib/operacoes-v3/dados-basicos-model";
// Reuso PURO da máquina de status da V3 (Fase 1B) — fonte da AUTORIDADE de status
// (`operacaoStatusV3`) e da projeção oficial "recebida" → "pronta". Sem I/O.
import { isOperacaoStatusV3, projetarStatusV2 } from "@/lib/operacoes-v3/status-machine";
// Reuso PURO (read-only) da garantia/entrega REAIS da V3 (GOAL OPS-V4-DOCS-
// ASSINATURA-TERMOS-ANEXOS-012): mesma fonte já usada pelas telas de pós-venda
// e pela impressão da OS (`aberturaV3.garantiaPrevista` / `entregaV3`).
import { lerEntregaV3, lerFotosSaidaV3 } from "@/lib/operacoes-v3/pos-venda-model";
import {
  buildGarantiaPosVendaV4,
  buildPosVendaV4,
  EMPTY_POSVENDA_V4,
  type PosVendaV4,
} from "@/lib/operacoes-v4/posvenda-v4";
// Reuso PURO (read-only) dos totais com faixa/grupo da V3 (GOAL OPS-V4-ORC-
// MULTIOPCAO-MODEL-021): mesma função que a V3 usa para persistir o total.
import { computeTotaisV3, pecaValorCliente, servicoValorCliente, type PecaV3, type ServicoV3 } from "@/lib/operacoes-v3/orcamento-model";

export const NI = "Não informado";

const ORIGEM_LABEL: Record<string, string> = {
  manual: "Manual",
  whatsapp: "WhatsApp",
  site: "Site",
  telefone: "Telefone",
  email: "E-mail",
  balcao: "Balcão",
};

const SENHA_TIPO_LABEL: Record<string, string> = {
  numerica: "PIN",
  texto: "senha",
  padrao: "padrão",
};

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Data/hora curta "dd/mm HH:MM" a partir de ISO; vazio honesto se inválida. */
export function fmtDataHora(iso?: string | null): string {
  const s = txt(iso);
  if (!s) return NI;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return NI;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

/** Data curta "dd/mm/aaaa". */
export function fmtData(iso?: string | null): string {
  const s = txt(iso);
  if (!s) return NI;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return NI;
  return d.toLocaleDateString("pt-BR");
}

/** Iniciais do nome para o avatar (até 2 letras). */
export function iniciais(nome: string): string {
  const parts = txt(nome).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const V4_STATUS_VALIDOS: V4Status[] = [
  "aberta",
  "diagnostico",
  "aguardando_aprovacao",
  "aprovado",
  "aguardando_peca",
  "em_execucao",
  "pronta",
  "entregue",
  "cancelada",
];

/**
 * Apelidos LEGADOS aceitos no fallback (OS antigas gravadas antes da V3).
 *
 * NÃO reusa `normalizeOperacaoStatus` de propósito: lá o apelido `recebida` cai
 * em "aberta" — o que faria uma OS a um passo da entrega voltar a exibir
 * "Iniciar diagnóstico" (exatamente o F-02). Aqui `recebida` segue a projeção
 * oficial da V3 (`projetarStatusV2`) e vira "pronta".
 */
const ALIAS_LEGADO_V4: Record<string, V4Status> = {
  aberto: "aberta",
  novo: "aberta",
  recebida: "pronta",
  em_analise: "diagnostico",
  "em-analise": "diagnostico",
  em_reparo: "em_execucao",
  pronto: "pronta",
  finalizado: "entregue",
};

/**
 * Status real (OSStatus) → V4Status. Os conjuntos coincidem 1:1.
 *
 * OPS-V4-STATUS-AUTHORITY-FIX-003 (F-03) — FAIL-CLOSED: valor fora do domínio
 * (e legado não mapeado) vira "desconhecido", nunca "aberta". Converter um status
 * desconhecido em "aberta" oferecia CTA operacional ("Iniciar diagnóstico") sobre
 * uma OS cujo estado real ninguém sabe.
 *
 * Preferir `resolverStatusV4(os)` — esta função só converte um valor solto e não
 * conhece a autoridade (`operacaoStatusV3`).
 */
export function realStatusToV4(status: OSStatus | string | undefined): V4Status {
  if (V4_STATUS_VALIDOS.includes(status as V4Status)) return status as V4Status;
  const chave = typeof status === "string" ? status.trim().toLowerCase() : "";
  return ALIAS_LEGADO_V4[chave] ?? "desconhecido";
}

/** Fontes de status que uma OS hidratada pode carregar no payload. */
export interface OSStatusFonteV4 {
  status?: unknown;
  operacaoStatus?: unknown;
  operacaoStatusV3?: unknown;
}

/**
 * AUTORIDADE ÚNICA de status operacional da V4 (OPS-V4-STATUS-AUTHORITY-FIX-003).
 *
 * Pura, determinística, sem I/O. Toda superfície da V4 (Fila, Header, stage, CTA,
 * dashboard, picker) resolve o status por AQUI — antes existiam duas leituras
 * divergentes (`hydration-service` preferia `operacaoStatus`; a V3 preferia
 * `operacaoStatusV3`), e a V4 exibia o resultado da primeira.
 *
 * Precedência (documentada em `status-machine.ts`, Fase 1B):
 *   1. `payload.operacaoStatusV3` — AUTORITATIVO da V3. É o único campo que TODOS
 *      os write-paths da V3 atualizam (`status-actions`, `entrega-actions`,
 *      `atendimento-rapido-actions`, `orcamento-actions`). "recebida" não existe
 *      na V4 → projeta para "pronta" via `projetarStatusV2`.
 *      Presente porém fora do domínio → "desconhecido" (não cai para o legado:
 *      a autoridade falou, e falou algo que não entendemos).
 *   2. Fallback LEGADO `operacaoStatus` ?? `status` — OS anteriores à V3, que
 *      nunca receberam `operacaoStatusV3`.
 *   3. Nada reconhecível → "desconhecido" (fail-closed).
 */
export function resolverStatusV4(os: OSStatusFonteV4 | null | undefined): V4Status {
  if (!os) return "desconhecido";
  const v3 = os.operacaoStatusV3;
  if (v3 !== undefined && v3 !== null && v3 !== "") {
    return isOperacaoStatusV3(v3) ? (projetarStatusV2(v3) as V4Status) : "desconhecido";
  }
  const legado = os.operacaoStatus ?? os.status;
  if (legado === undefined || legado === null || legado === "") return "desconhecido";
  return realStatusToV4(legado as string);
}

/** Estágio inicial sugerido a partir do status real da OS. */
export function stageForStatus(status: OSStatus | string | undefined): V4Stage {
  return destinoOperacionalPorStatusV4(status as V4Status);
}

/** Prioridade real (baixa|media|alta|critica) → prioridade da V4 (baixa|normal|alta|urgente). */
export function realPrioridadeToV4(p: string | undefined): "baixa" | "normal" | "alta" | "urgente" {
  switch (p) {
    case "baixa":
      return "baixa";
    case "media":
      return "normal";
    case "alta":
      return "alta";
    case "critica":
      return "urgente";
    default:
      return "normal";
  }
}

/** Label curto de aparelho: "Marca Modelo" (ou tipo, ou NI). */
export function aparelhoLabel(os: OrdemServico): string {
  const eq = os.equipamento;
  if (!eq) return NI;
  const marcaModelo = [txt(eq.marca), txt(eq.modelo)].filter(Boolean).join(" ");
  return marcaModelo || txt(eq.tipo) || NI;
}

export interface V4OsView {
  codigo: string;
  cliente: string;
  avatarInitials: string;
  documento: string;
  telefone: string;
  email: string;
  aparelho: string;
  tipo: string;
  cor: string;
  serieCurta: string;
  imei: string;
  serial: string;
  operadora: string;
  senha: string;
  senhaTipo: string;
  acessorios: string;
  origem: string;
  recebidoPor: string;
  contaGoogle: string;
  contaApple: string;
  defeito: string;
  /** Observações internas da recepção (aberturaV3.observacoesInternas); "" quando ausente. */
  observacoesInternas: string;
  entrada: string;
  previsao: string;
  tecnico: string;
  sla: string;
  localizacao: string;
  garantiaPrazo: string;
}

const SLA_LABEL: Record<string, string> = {
  ok: "No prazo",
  atencao: "Atenção",
  estourado: "Estourado",
};

/** Total real da OS, na melhor fonte disponível. */
export function osTotalNumero(os: OrdemServico): number {
  const cand = [os.orcamento?.total, os.faturamentoTotal, os.prismaValorTotal];
  for (const v of cand) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

export interface V4CobrancaResumo {
  /** true quando há orçamento aprovado real (não prévia sintetizada), via `lerPagamentoV3`/`totalCobravelV3`. */
  temCobrancaReal: boolean;
  /** true quando o único valor disponível vem de um orçamento sintetizado (prévia, `orcamento.sintetizado === true`). */
  ePrevia: boolean;
  total: number;
  /** Saldo aberto real; só significativo quando `temCobrancaReal` é true. */
  saldo: number;
  quitado: boolean;
}

/**
 * Estado financeiro honesto e ÚNICO da OS para uso em listas/rails (GOAL
 * OPS-V4-FIN-STATE-RECONCILE-003) — MESMA fonte que `adaptPag`/`adaptFinanceiro`
 * usam no Workspace: `lerPagamentoV3` (espelho real quando existe; senão deriva
 * saldo=total via `totalCobravelV3`, idêntico ao fallback do motor real
 * `lerPagamentoOSV3` quando ainda não há título de recebimento). Distingue a
 * prévia sintetizada da hidratação (`orcamento.sintetizado === true`) de um
 * orçamento aprovado de verdade — nunca promete cobrança sobre a prévia.
 */
export function resumoCobrancaV4(os: OrdemServico): V4CobrancaResumo {
  const orc = os.orcamento;
  const previaSintetizada = !!orc && orc.sintetizado === true;
  const materializado = !!orc && orc.sintetizado !== true;
  const pag = lerPagamentoV3(os);
  const temCobrancaReal = materializado && pag.total > 0;
  const totalExibivel = temCobrancaReal ? pag.total : osTotalNumero(os);
  return {
    temCobrancaReal,
    ePrevia: !temCobrancaReal && previaSintetizada && totalExibivel > 0,
    total: totalExibivel,
    saldo: temCobrancaReal ? pag.saldo : 0,
    quitado: temCobrancaReal && pag.saldo <= 0,
  };
}

export function adaptOsHeader(os: OrdemServico): V4OsView {
  const eq = os.equipamento;
  const acessorios = Array.isArray(eq?.acessorios) ? eq!.acessorios.filter(Boolean) : [];
  // Identificação rica da prova de entrada (V3): prefere serial/operadora/cor reais.
  // `lerProvaEntradaV3` já semeia imei/modelo dos campos legados.
  const ident = lerProvaEntradaV3(os).identificacao;
  const imei = txt(ident.imei) || txt(eq?.numeroSerie);
  const serial = txt(ident.serial);
  const operadora = txt(ident.operadora);
  const cor = txt(ident.cor);
  // Dados básicos reais da recepção (slice 3B): recebido por / localização / origem
  // rica / observações — antes eram "Não informado" fixos.
  const db = lerDadosBasicosV3(os);
  const senha = txt(os.senhaEquipamento);
  const senhaTipo = txt(os.senhaEquipamentoTipo);
  const prazoGar =
    os.garantiasOperacionais?.[0]?.prazoDias ?? (os.garantia?.ativa ? os.garantia?.prazoDias : undefined);

  return {
    codigo: txt(os.codigo) || NI,
    cliente: txt(os.cliente?.nome) || NI,
    avatarInitials: iniciais(os.cliente?.nome ?? ""),
    documento: txt(os.cliente?.documento) || NI,
    telefone: txt(os.cliente?.telefone) || txt(os.cliente?.whatsapp) || NI,
    email: txt(os.cliente?.email) || NI,
    aparelho: aparelhoLabel(os),
    tipo: txt(eq?.tipo) || NI,
    cor: cor || NI,
    serieCurta: imei || NI,
    imei: imei || NI,
    serial: serial || NI,
    operadora: operadora || NI,
    senha: senha ? (senhaTipo ? `${senha} (${SENHA_TIPO_LABEL[senhaTipo] ?? senhaTipo})` : senha) : NI,
    senhaTipo,
    acessorios: acessorios.length ? acessorios.join(", ") : NI,
    // Origem rica (aberturaV3) prevalece; cai para a origem colapsada do top-level.
    origem: db.origem ? (ORIGEM_LABEL_V3[db.origem] ?? db.origem) : (ORIGEM_LABEL[txt(os.origem)] ?? (txt(os.origem) || NI)),
    recebidoPor: db.recebidoPor || NI,
    contaGoogle: NI,
    contaApple: NI,
    defeito: txt(eq?.defeitoRelatado) || txt(os.observacaoCliente) || NI,
    observacoesInternas: db.observacoes,
    entrada: fmtDataHora(os.criadoEm),
    previsao: os.sla?.prazo ? fmtDataHora(os.sla.prazo) : NI,
    tecnico: txt(os.tecnico?.nome) || NI,
    sla: os.sla?.status ? (SLA_LABEL[os.sla.status] ?? os.sla.status) : NI,
    localizacao: db.localFisico ? (LOCAL_FISICO_LABEL_V3[db.localFisico] ?? db.localFisico) : NI,
    garantiaPrazo: typeof prazoGar === "number" && prazoGar > 0 ? `${prazoGar} dias` : NI,
  };
}

export interface V4PagView {
  total: string;
  recebido: string;
  saldo: string;
  statusPagamento: string;
  ultimaForma: string;
  previsto: string;
  /** true quando há recebimento REAL espelhado (payload.pagamentoV3, recebido > 0). */
  temPagamento: boolean;
  /** "Parcial" / "Quitado" (do espelho real); "" quando não há pagamento. */
  pagamentoStatusLabel: string;
}

/**
 * Espelho de pagamento REAL da OS (`payload.pagamentoV3`), gravado pelo PDV de
 * Serviço V3 a cada recebimento. Só existe depois de uma baixa real — por isso
 * é o gate de "temPagamento": sem espelho, recebido/saldo ficam NI (não inventamos
 * um "saldo devedor" para OS que nunca teve título/recebimento).
 */
function pagamentoEspelhado(os: OrdemServico): boolean {
  const m = (os as { pagamentoV3?: { total?: unknown } }).pagamentoV3;
  return !!m && typeof m === "object" && typeof m.total === "number";
}

export function adaptPag(os: OrdemServico): V4PagView {
  const temEspelho = pagamentoEspelhado(os);
  const pag = lerPagamentoV3(os);
  const temPagamento = temEspelho && pag.recebido > 0;
  // Total: o espelho (valor do título real) prevalece; sem espelho, mesma fonte
  // que o restante da V4 (`osTotalNumero`).
  const totalNum = temEspelho && pag.total > 0 ? pag.total : osTotalNumero(os);
  const statusPag =
    os.faturamentoStatus === "cancelado"
      ? "Faturamento cancelado"
      : os.faturamentoPendente
        ? "Faturamento pendente"
        : NI;
  return {
    total: totalNum > 0 ? fmt(totalNum) : NI,
    recebido: temPagamento ? fmt(pag.recebido) : NI,
    saldo: temPagamento ? fmt(pag.saldo) : NI,
    statusPagamento: statusPag,
    ultimaForma: (temPagamento && txt(pag.ultimaForma)) || txt(os.faturamentoFormaPagamento) || NI,
    previsto: NI,
    temPagamento,
    pagamentoStatusLabel: temPagamento ? PAGAMENTO_STATUS_META_V3[pag.status].label : "",
  };
}

/** View de identidade vazia (nenhuma OS selecionada) — tudo honesto. */
export const EMPTY_OS_VIEW: V4OsView = {
  codigo: NI,
  cliente: NI,
  avatarInitials: "—",
  documento: NI,
  telefone: NI,
  email: NI,
  aparelho: NI,
  tipo: NI,
  cor: NI,
  serieCurta: NI,
  imei: NI,
  serial: NI,
  operadora: NI,
  senha: NI,
  senhaTipo: "",
  acessorios: NI,
  origem: NI,
  recebidoPor: NI,
  contaGoogle: NI,
  contaApple: NI,
  defeito: NI,
  observacoesInternas: "",
  entrada: NI,
  previsao: NI,
  tecnico: NI,
  sla: NI,
  localizacao: NI,
  garantiaPrazo: NI,
};

export const EMPTY_PAG_VIEW: V4PagView = {
  total: NI,
  recebido: NI,
  saldo: NI,
  statusPagamento: NI,
  ultimaForma: NI,
  previsto: NI,
  temPagamento: false,
  pagamentoStatusLabel: "",
};

/**
 * Máscara LOCAL (só exibição) da credencial do aparelho na coluna de contexto —
 * GOAL 006. Nunca altera payload nem o mascaramento de impressão da V3
 * (`print-model`). Comprimento fixo para não vazar o tamanho da senha.
 */
export function maskSenhaV4(senha: string, senhaTipo?: string): string {
  const s = txt(senha);
  if (!s || s === NI) return NI;
  if (senhaTipo === "padrao") return "Padrão cadastrado";
  return "••••••";
}

// ---- Financeiro da OS (GOAL OPS-V4-P0-008 + 006) ----------------------------
// Expõe o que a OS carrega: total, status do faturamento, forma/modo de cobrança
// e o plano de parcelas. Recebido/saldo/status de pagamento vêm do espelho REAL
// `payload.pagamentoV3` (gravado pelo PDV de Serviço V3) via `lerPagamentoV3` —
// leitura pura, sem tocar PDV/Caixa/Financeiro. Sem espelho → vazio honesto.

const MODO_COBRANCA_LABEL: Record<string, string> = {
  avista: "À vista",
  parcelado: "Parcelado",
  carteira: "Carteira / crediário",
  dinheiro_pix_cartao: "Dinheiro / PIX / cartão",
};

export interface V4ParcelaView {
  numero: string;
  valor: string;
  vencimento: string;
}

export interface V4FinanceiroView {
  /** true quando existe qualquer informação financeira real na OS. */
  temDados: boolean;
  temTotal: boolean;
  total: string;
  /** "Faturamento pendente" / "Faturamento cancelado" / "Não informado". */
  statusFaturamento: string;
  statusTone: "pendente" | "cancelado" | "neutro";
  formaPagamento: string;
  modoCobranca: string;
  parcelas: V4ParcelaView[];
  /** true quando há recebimento REAL espelhado (payload.pagamentoV3, recebido > 0). */
  temPagamento: boolean;
  /** Recebido/saldo do espelho real; NI quando não há pagamento. */
  recebido: string;
  saldo: string;
  /** true quando ainda resta saldo a receber (> 0) no espelho real. */
  temSaldo: boolean;
  /** "Parcial" / "Quitado" (do espelho real); "" quando não há pagamento. */
  pagamentoStatusLabel: string;
  pagamentoStatusTone: "success" | "info";
}

export const EMPTY_FINANCEIRO_VIEW: V4FinanceiroView = {
  temDados: false,
  temTotal: false,
  total: NI,
  statusFaturamento: NI,
  statusTone: "neutro",
  formaPagamento: NI,
  modoCobranca: NI,
  parcelas: [],
  temPagamento: false,
  recebido: NI,
  saldo: NI,
  temSaldo: false,
  pagamentoStatusLabel: "",
  pagamentoStatusTone: "info",
};

export function adaptFinanceiro(os: OrdemServico): V4FinanceiroView {
  // Espelho de pagamento real (mesma regra do adaptPag): título/recebido/saldo.
  const temEspelho = pagamentoEspelhado(os);
  const pag = lerPagamentoV3(os);
  const temPagamento = temEspelho && pag.recebido > 0;
  const totalNum = temEspelho && pag.total > 0 ? pag.total : osTotalNumero(os);
  const temTotal = totalNum > 0;
  const forma = txt(os.faturamentoFormaPagamento);
  const modo = txt(os.faturamentoModoCobranca);
  const parcelasRaw = Array.isArray(os.faturamentoParcelas) ? os.faturamentoParcelas : [];
  const parcelas = parcelasRaw
    .filter((p) => p && typeof p.valor === "number")
    .map((p) => ({
      numero: `${p.numero}ª`,
      valor: fmt(p.valor),
      vencimento: fmtData(p.vencimentoIso),
    }));
  const statusTone: V4FinanceiroView["statusTone"] =
    os.faturamentoStatus === "cancelado"
      ? "cancelado"
      : os.faturamentoPendente || os.faturamentoStatus === "pendente"
        ? "pendente"
        : "neutro";
  const statusFaturamento =
    statusTone === "cancelado"
      ? "Faturamento cancelado"
      : statusTone === "pendente"
        ? "Faturamento pendente"
        : NI;
  return {
    temDados: temTotal || !!forma || !!modo || parcelas.length > 0 || statusTone !== "neutro" || temPagamento,
    temTotal,
    total: temTotal ? fmt(totalNum) : NI,
    statusFaturamento,
    statusTone,
    formaPagamento: forma || NI,
    modoCobranca: modo ? (MODO_COBRANCA_LABEL[modo] ?? modo) : NI,
    parcelas,
    temPagamento,
    recebido: temPagamento ? fmt(pag.recebido) : NI,
    saldo: temPagamento ? fmt(pag.saldo) : NI,
    temSaldo: temPagamento && pag.saldo > 0,
    pagamentoStatusLabel: temPagamento ? PAGAMENTO_STATUS_META_V3[pag.status].label : "",
    pagamentoStatusTone: temPagamento && pag.status === "quitado" ? "success" : "info",
  };
}

// ---- Histórico / timeline (GOAL OPS-V4-P0-004) -----------------------------

export interface V4HistEvento {
  id: string;
  /** Categoria do filtro da V4: status | financeiro | comunicacao | tecnico. */
  type: "status" | "financeiro" | "comunicacao" | "tecnico";
  text: string;
  meta: string;
  /** Cor do marcador na timeline (derivada da categoria). */
  dot: string;
}

/** Mapeia o tipo do evento real para a categoria de filtro da V4. */
function eventoCategoria(tipo: string): V4HistEvento["type"] {
  if (tipo.startsWith("financeiro") || tipo.startsWith("faturamento") || tipo.startsWith("operacao_cobranca"))
    return "financeiro";
  if (tipo === "mensagem_cliente" || tipo === "mensagem_interna") return "comunicacao";
  if (tipo === "mudanca_status" || tipo === "criacao" || tipo === "os_cancelada") return "status";
  return "tecnico";
}

const CATEGORIA_DOT: Record<V4HistEvento["type"], string> = {
  status: C.primary,
  financeiro: C.success,
  comunicacao: C.warn,
  tecnico: C.info,
};

export function adaptTimeline(os: OrdemServico): V4HistEvento[] {
  const tl = Array.isArray(os.timeline) ? os.timeline : [];
  return tl
    .slice()
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
    .map((ev: EventoTimeline) => {
      const type = eventoCategoria(ev.tipo);
      return {
        id: ev.id,
        type,
        text: txt(ev.titulo) || txt(ev.conteudo) || ev.tipo,
        meta: `${txt(ev.autor) || "Sistema"} · ${fmtDataHora(ev.criadoEm)}`,
        dot: CATEGORIA_DOT[type],
      };
    });
}

const ANEXO_KIND_LABEL: Record<string, string> = {
  foto_antes: "ANTES",
  foto_depois: "DEPOIS",
  foto_defeito: "DEFEITO",
  video: "VÍDEO",
  audio: "ÁUDIO",
  laudo: "LAUDO",
  nota: "NOTA",
  comprovante: "COMPROV.",
  documento_tecnico: "DOC",
  outro: "ANEXO",
};

export interface V4Anexo {
  id: string;
  kind: string;
  name: string;
  /** Thumb real quando a fonte é data URL (prova de entrada / fotos de saída). */
  dataUrl?: string;
}

const CATEGORIA_FOTO_SAIDA_TAG: Record<string, string> = {
  reparado: "SAÍDA",
  acessorio: "ACESSÓRIO",
  outro: "SAÍDA",
};

export function adaptFotosSaida(os: OrdemServico): V4FotoEntrada[] {
  return lerFotosSaidaV3(os).map((f) => ({
    id: f.id,
    tag: CATEGORIA_FOTO_SAIDA_TAG[f.categoria] ?? "SAÍDA",
    name: txt(f.nome) || "Foto de saída",
    dataUrl: f.dataUrl,
  }));
}

export function adaptAnexos(os: OrdemServico): V4Anexo[] {
  const entrada = adaptFotosEntrada(os).map((f) => ({
    id: f.id,
    kind: f.tag,
    name: f.name,
    dataUrl: f.dataUrl,
  }));
  const saida = adaptFotosSaida(os).map((f) => ({
    id: f.id,
    kind: f.tag,
    name: f.name,
    dataUrl: f.dataUrl,
  }));
  const ids = new Set([...entrada, ...saida].map((a) => a.id));
  const lista = Array.isArray(os.anexos) ? os.anexos : [];
  const legado = lista
    .filter((a: Anexo) => a?.id && !ids.has(a.id))
    .map((a: Anexo) => ({
      id: a.id,
      kind: ANEXO_KIND_LABEL[a.tipo] ?? "ANEXO",
      name: txt(a.nome) || "Anexo",
    }));
  return [...entrada, ...saida, ...legado];
}

export interface V4Observacao {
  id: string;
  autor: string;
  conteudo: string;
  interna: boolean;
}

export function adaptObservacoes(os: OrdemServico): V4Observacao[] {
  const lista = Array.isArray(os.observacoes) ? os.observacoes : [];
  return lista.map((o: ObservacaoTecnica) => ({
    id: o.id,
    autor: txt(o.autor) || "—",
    conteudo: txt(o.conteudo),
    interna: !!o.interna,
  }));
}

// ---- Checklist de entrada (GOAL OPS-V4-P0-005) -----------------------------

export interface V4ChecklistItem {
  id: string;
  label: string;
  /** Estado real do checklist da OS. */
  estado: "ok" | "ruim" | "nao_testado";
  observacao: string;
}

export function adaptChecklist(os: OrdemServico): V4ChecklistItem[] {
  const cl = Array.isArray(os.checklist) ? os.checklist : [];
  return cl.map((it: ChecklistItem) => ({
    id: it.id,
    label: txt(it.label),
    estado: it.estado,
    observacao: txt(it.observacao),
  }));
}

// ---- Entrada: acessórios / fotos / segurança (GOAL OPS-V4-P0-006) ----------

/** Acessórios recebidos (limpos) do equipamento da OS; lista vazia = honesto. */
export function adaptAcessoriosEntrada(os: OrdemServico): string[] {
  const lista = Array.isArray(os.equipamento?.acessorios) ? os.equipamento!.acessorios! : [];
  return lista.map((a) => txt(a)).filter(Boolean);
}

const CATEGORIA_FOTO_TAG: Record<string, string> = {
  frontal: "FRONTAL",
  traseira: "TRASEIRA",
  lateral: "LATERAL",
  defeito: "DEFEITO",
};

export interface V4FotoEntrada {
  id: string;
  /** Etiqueta curta derivada da categoria da foto (FRONTAL / TRASEIRA / LATERAL / DEFEITO). */
  tag: string;
  name: string;
  /** Imagem real (data URL JPEG), já reduzida na captura — SPRINT_3E.1. */
  dataUrl: string;
}

/**
 * Fotos de entrada reais — lidas de `payload.provaEntradaV3.fotos` (SPRINT_3E.1),
 * o contrato que efetivamente grava fotos da OS (`salvarProvaEntradaV3`). O campo
 * legado `os.anexos` nunca é escrito por nenhuma action da V3; lista vazia = honesto.
 */
export function adaptFotosEntrada(os: OrdemServico): V4FotoEntrada[] {
  return lerProvaEntradaV3(os).fotos.map((f) => ({
    id: f.id,
    tag: CATEGORIA_FOTO_TAG[f.categoria] ?? "FOTO",
    name: txt(f.nome) || "Foto",
    dataUrl: f.dataUrl,
  }));
}

export interface V4SegurancaEntrada {
  /** true quando há credencial real registrada na OS. */
  temCredencial: boolean;
  /** PIN / senha / padrão (ou "Não informado"). */
  tipoLabel: string;
  /** Valor real da credencial (vazio quando ausente). */
  valor: string;
}

export const EMPTY_SEGURANCA_ENTRADA: V4SegurancaEntrada = {
  temCredencial: false,
  tipoLabel: NI,
  valor: "",
};

/** Segurança / acesso real: senha do equipamento + tipo; vazio honesto. */
export function adaptSegurancaEntrada(os: OrdemServico): V4SegurancaEntrada {
  const valor = txt(os.senhaEquipamento);
  const tipo = txt(os.senhaEquipamentoTipo);
  return {
    temCredencial: !!valor,
    tipoLabel: tipo ? (SENHA_TIPO_LABEL[tipo] ?? tipo) : NI,
    valor,
  };
}

// ---- Diagnóstico (GOAL OPS-V4-P0-009) --------------------------------------
// Read-only: o stage Diagnóstico passa a ler só o que a OS persiste — defeito
// relatado, observações técnicas (parecer), anexos/laudos de diagnóstico e
// eventos de diagnóstico na timeline. Sem laudo/técnico/data fabricados.

/** Eventos da timeline considerados "registro de diagnóstico". */
const DIAG_EVENTO_TIPOS = new Set<string>(["diagnostico_registrado"]);
/** Tipos de anexo considerados de diagnóstico (laudo / foto do defeito). */
const DIAG_ANEXO_TIPOS = new Set<AnexoTipo>(["laudo", "foto_defeito"]);

export interface V4DiagnosticoView {
  defeito: string;
  temDefeito: boolean;
  /** Parecer técnico estruturado real (payload.diagnosticoV3). Campos vazios = "". */
  parecerInicial: string;
  parecerFinal: string;
  causa: string;
  solucao: string;
  /** true quando há QUALQUER campo de parecer estruturado preenchido. */
  temParecer: boolean;
  observacoes: V4Observacao[];
  anexos: V4Anexo[];
  eventos: V4HistEvento[];
  /** true quando há QUALQUER trabalho de diagnóstico real (parecer/observação/anexo/evento). */
  temDiagnostico: boolean;
}

export const EMPTY_DIAGNOSTICO_VIEW: V4DiagnosticoView = {
  defeito: NI,
  temDefeito: false,
  parecerInicial: "",
  parecerFinal: "",
  causa: "",
  solucao: "",
  temParecer: false,
  observacoes: [],
  anexos: [],
  eventos: [],
  temDiagnostico: false,
};

/**
 * Lê o parecer estruturado real da OS (payload.diagnosticoV3), com semente do
 * diagnóstico inicial da Nova OS (aberturaV3) — espelha `lerDiagnosticoV3` da V3
 * sem importar o model. Somente leitura.
 */
function lerParecerV3(os: OrdemServico): { inicial: string; final: string; causa: string; solucao: string } {
  const d = (os as { diagnosticoV3?: Partial<{ inicial: unknown; final: unknown; causa: unknown; solucao: unknown }> } | null | undefined)
    ?.diagnosticoV3;
  const abertura = (os as { aberturaV3?: { diagnosticoInicial?: { diagnosticoTecnico?: unknown; solucaoPrevista?: unknown } } } | null | undefined)
    ?.aberturaV3;
  return {
    inicial: txt(d?.inicial) || txt(abertura?.diagnosticoInicial?.diagnosticoTecnico),
    final: txt(d?.final),
    causa: txt(d?.causa),
    solucao: txt(d?.solucao) || txt(abertura?.diagnosticoInicial?.solucaoPrevista),
  };
}

export function adaptDiagnostico(os: OrdemServico): V4DiagnosticoView {
  const defeito = txt(os.equipamento?.defeitoRelatado) || txt(os.observacaoCliente);
  const observacoes = adaptObservacoes(os);
  const parecer = lerParecerV3(os);
  const temParecer = !!(parecer.inicial || parecer.final || parecer.causa || parecer.solucao);

  const anexosLista = Array.isArray(os.anexos) ? os.anexos : [];
  const anexos = anexosLista
    .filter((a: Anexo) => a.categoria === "diagnostico" || DIAG_ANEXO_TIPOS.has(a.tipo))
    .map((a: Anexo) => ({
      id: a.id,
      kind: ANEXO_KIND_LABEL[a.tipo] ?? "ANEXO",
      name: txt(a.nome) || "Anexo",
    }));

  const tl = Array.isArray(os.timeline) ? os.timeline : [];
  const eventos = tl
    .filter((ev: EventoTimeline) => DIAG_EVENTO_TIPOS.has(ev.tipo))
    .slice()
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
    .map((ev: EventoTimeline): V4HistEvento => ({
      id: ev.id,
      type: "tecnico",
      text: txt(ev.titulo) || txt(ev.conteudo) || ev.tipo,
      meta: `${txt(ev.autor) || "Sistema"} · ${fmtDataHora(ev.criadoEm)}`,
      dot: C.info,
    }));

  return {
    defeito: defeito || NI,
    temDefeito: !!defeito,
    parecerInicial: parecer.inicial,
    parecerFinal: parecer.final,
    causa: parecer.causa,
    solucao: parecer.solucao,
    temParecer,
    observacoes,
    anexos,
    eventos,
    temDiagnostico: temParecer || observacoes.length > 0 || anexos.length > 0 || eventos.length > 0,
  };
}

// ---- Orçamento (GOAL OPS-V4-P0-010) ----------------------------------------
// Read-only sobre a OS já carregada. O orçamento NÃO tem model Prisma próprio:
// chega em `os.orcamento` (payload), `itensPersistidos` (OrdemServicoItem) e
// `prismaValorTotal`. Três estados (Decisão 1): persistido (status enum real),
// previa (`sintetizado: true`, badge fixo "Prévia — não aprovado"), ausente.
// Custo/lucro só quando `custoUnitario` real existir (Decisão 2) — `Servico`
// não tem custo, logo só orçamentos 100% de peças com custo exibem o agregado.

// "vazio" (GOAL OPS-V4-ORCAMENTO-READBACK-EDIT-002): orçamento REAL materializado
// (sintetizado !== true) porém sem linhas e total 0 — existe, mas está vazio. NÃO é
// "ausente": esconder um orçamento materializado-vazio como se não existisse foi o
// que fez a OS-2026-00014 parecer "sem orçamento" depois de aprovada/entregue.
export type V4OrcamentoEstado = "persistido" | "previa" | "ausente" | "vazio";

const ORC_STATUS_LABEL: Record<OrcamentoStatus, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  expirado: "Expirado",
};

const ORC_STATUS_TONE: Record<OrcamentoStatus, V4OrcamentoView["statusTone"]> = {
  rascunho: "neutro",
  enviado: "info",
  aprovado: "success",
  recusado: "danger",
  expirado: "warn",
};

/** Classificação real da linha (V3 `kindV3`); rótulos read-only da V4 (GOAL 006). */
export type V4OrcKind = "cobrado" | "brinde" | "interno";

export const ORC_KIND_LABEL: Record<V4OrcKind, string> = {
  cobrado: "Cobrado",
  brinde: "Brinde",
  interno: "Interno",
};

/** Lê o `kindV3` persistido de uma linha de orçamento; null quando ausente/inválido. */
export function lerOrcKindV4(linha: unknown): V4OrcKind | null {
  const k = (linha as { kindV3?: unknown } | null | undefined)?.kindV3;
  return k === "cobrado" || k === "brinde" || k === "interno" ? k : null;
}

/** Lê o `grupoId` persistido de uma linha; "" quando a linha é fixa (sem grupo). */
function lerGrupoIdV4(linha: unknown): string {
  const g = (linha as { grupoId?: unknown } | null | undefined)?.grupoId;
  return typeof g === "string" ? g.trim() : "";
}

/** Lê `selecionadaV3` persistido de uma linha de grupo. */
function lerSelecionadaV4(linha: unknown): boolean {
  return (linha as { selecionadaV3?: unknown } | null | undefined)?.selecionadaV3 === true;
}

export interface V4OrcVarianteView {
  rotulo: string;
  descricaoCurta: string;
  garantiaDias: number | null;
  prazoTexto: string;
  badge: string;
}

/** Lê `varianteV3` persistido de uma linha; null quando ausente/sem rótulo. */
function lerVarianteV4(linha: unknown): V4OrcVarianteView | null {
  const v = (linha as { varianteV3?: unknown } | null | undefined)?.varianteV3;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const rotulo = txt(o.rotulo);
  if (!rotulo) return null;
  const garantiaDias = typeof o.garantiaDias === "number" && o.garantiaDias > 0 ? o.garantiaDias : null;
  return { rotulo, descricaoCurta: txt(o.descricaoCurta), garantiaDias, prazoTexto: txt(o.prazoTexto), badge: txt(o.badge) };
}

export interface V4OrcItemView {
  id: string;
  descricao: string;
  /** Detalhe real curto (qtd × · garantia Nd); vazio quando não houver. */
  detalhe: string;
  /** Total da linha (qtd × unitário − desconto), formatado. */
  valor: string;
  /** Custo da linha — somente quando `custoUnitario` real existir; senão null. */
  custo: string | null;
  /** Classificação persistida da linha (`kindV3`); null quando a OS não registra. */
  kind: V4OrcKind | null;
  /** "Cobrado" / "Brinde" / "Interno"; "" quando sem classificação. */
  kindLabel: string;
  /** Id do grupo de escolha; "" quando a linha é fixa (fora de grupo). */
  grupoId: string;
  /** Metadados de exibição da variante (rótulo/garantia/badge); null quando ausentes. */
  variante: V4OrcVarianteView | null;
  /** true quando esta é a linha escolhida do grupo. */
  selecionada: boolean;
}

export interface V4OrcGrupoView {
  id: string;
  /** Rótulo do grupo (`gruposV3` da OS); fallback honesto quando não cadastrado. */
  rotulo: string;
  itens: V4OrcItemView[];
  /** true quando alguma linha do grupo já foi selecionada. */
  resolvido: boolean;
  selecionadaId: string | null;
  /** Faixa de valor possível (menor/maior opção do grupo), formatada. */
  faixaMin: string;
  faixaMax: string;
}

export interface V4OrcamentoView {
  estado: V4OrcamentoEstado;
  isPrevia: boolean;
  statusLabel: string;
  statusTone: "success" | "info" | "warn" | "danger" | "neutro";
  servicos: V4OrcItemView[];
  pecas: V4OrcItemView[];
  /** Total ao cliente (fonte autoritativa: orcamento.total). */
  total: string;
  /** Soma de descontos de linha (R$); null quando 0. */
  desconto: string | null;
  /** Agregado de custo — só quando TODAS as linhas têm custo real; senão null. */
  custoTotal: string | null;
  /** Lucro = total − custoTotal; só quando custoTotal existir; senão null. */
  lucroTotal: string | null;
  /** Versões reais (revisões registradas na OS). */
  versoesCount: number;
  temVersoes: boolean;
  /** Grupos de escolha reais da OS; [] quando não há nenhum (empty honesto). */
  grupos: V4OrcGrupoView[];
  temGrupos: boolean;
  /** true quando ≥1 grupo ainda não tem linha selecionada (total é faixa, não fixo). */
  temFaixa: boolean;
  /** Faixa de total (menor/maior conforme escolhas pendentes); NI quando não há grupo pendente. */
  faixaMin: string;
  faixaMax: string;
}

export const EMPTY_ORCAMENTO_VIEW: V4OrcamentoView = {
  estado: "ausente",
  isPrevia: false,
  statusLabel: "",
  statusTone: "neutro",
  servicos: [],
  pecas: [],
  total: NI,
  desconto: null,
  custoTotal: null,
  lucroTotal: null,
  versoesCount: 0,
  temVersoes: false,
  grupos: [],
  temGrupos: false,
  temFaixa: false,
  faixaMin: NI,
  faixaMax: NI,
};

function servicoLineTotal(s: Servico): number {
  return Math.max(0, (s.valor || 0) - (s.desconto ?? 0));
}

function pecaLineTotal(p: PecaUsada): number {
  return Math.max(0, (p.quantidade || 0) * (p.valorUnitario || 0) - (p.desconto ?? 0));
}

export function adaptOrcamento(os: OrdemServico): V4OrcamentoView {
  const orc: Orcamento | undefined = os.orcamento;
  const servicosRaw = Array.isArray(orc?.servicos) ? orc!.servicos : [];
  const pecasRaw = Array.isArray(orc?.pecas) ? orc!.pecas : [];
  const declaredTotal = typeof orc?.total === "number" ? orc!.total : 0;
  const hasLines = servicosRaw.length > 0 || pecasRaw.length > 0;

  // Inexistente (estado "ausente"): sem orçamento OU prévia sintetizada sem
  // conteúdo — nada real para mostrar/editar (CTA "Gerar orçamento").
  if (!orc || (orc.sintetizado === true && !hasLines && declaredTotal <= 0)) {
    return EMPTY_ORCAMENTO_VIEW;
  }
  // Materializado vazio (estado "vazio"): orçamento REAL (não prévia) sem linhas e
  // total 0 — existe de fato (foi criado/aprovado vazio). Mostrar honestamente com
  // status/total reais, em vez de fingir "Nenhum orçamento registrado".
  if (!hasLines && declaredTotal <= 0) {
    return {
      ...EMPTY_ORCAMENTO_VIEW,
      estado: "vazio",
      statusLabel: ORC_STATUS_LABEL[orc.status] ?? orc.status ?? "",
      statusTone: ORC_STATUS_TONE[orc.status] ?? "neutro",
      total: fmt(0),
    };
  }

  const isPrevia = orc.sintetizado === true;
  const estado: V4OrcamentoEstado = isPrevia ? "previa" : "persistido";

  const servicos: V4OrcItemView[] = servicosRaw.map((s, i) => {
    const kind = lerOrcKindV4(s);
    return {
      id: txt(s.id) || `svc_${i}`,
      descricao: txt(s.descricao) || "Serviço",
      detalhe: typeof s.prazoGarantiaDias === "number" && s.prazoGarantiaDias > 0 ? `garantia ${s.prazoGarantiaDias}d` : "",
      valor: fmt(servicoLineTotal(s)),
      // Servico não tem custo no modelo → nunca exibe margem por linha.
      custo: null,
      kind,
      kindLabel: kind ? ORC_KIND_LABEL[kind] : "",
      grupoId: lerGrupoIdV4(s),
      variante: lerVarianteV4(s),
      selecionada: lerSelecionadaV4(s),
    };
  });

  const pecas: V4OrcItemView[] = pecasRaw.map((p, i) => {
    const det: string[] = [`${p.quantidade || 0}×`];
    if (typeof p.prazoGarantiaDias === "number" && p.prazoGarantiaDias > 0) det.push(`garantia ${p.prazoGarantiaDias}d`);
    const temCusto = typeof p.custoUnitario === "number";
    const kind = lerOrcKindV4(p);
    return {
      id: txt(p.id) || `peca_${i}`,
      descricao: txt(p.nome) || "Peça",
      detalhe: det.join(" · "),
      valor: fmt(pecaLineTotal(p)),
      custo: temCusto ? fmt((p.custoUnitario as number) * (p.quantidade || 0)) : null,
      kind,
      kindLabel: kind ? ORC_KIND_LABEL[kind] : "",
      grupoId: lerGrupoIdV4(p),
      variante: lerVarianteV4(p),
      selecionada: lerSelecionadaV4(p),
    };
  });

  // Desconto agregado (somente linhas com desconto real).
  const descNum =
    servicosRaw.reduce((a, s) => a + (s.desconto ?? 0), 0) +
    pecasRaw.reduce((a, p) => a + (p.desconto ?? 0), 0);

  // Total autoritativo: orcamento.total; cai para soma das linhas se ausente.
  const lineSum =
    servicosRaw.reduce((a, s) => a + servicoLineTotal(s), 0) +
    pecasRaw.reduce((a, p) => a + pecaLineTotal(p), 0);
  const totalNum = declaredTotal > 0 ? declaredTotal : lineSum;

  // Custo/lucro agregado: SÓ quando todas as linhas têm custo real (Decisão 2).
  // Como Servico não tem custo, basta haver 1 serviço para suprimir o agregado.
  const todasComCusto =
    hasLines && servicosRaw.length === 0 && pecasRaw.every((p) => typeof p.custoUnitario === "number");
  const custoNum = todasComCusto
    ? pecasRaw.reduce((a, p) => a + (p.custoUnitario as number) * (p.quantidade || 0), 0)
    : null;

  const versoesCount = Array.isArray(os.orcamentoHistorico) ? os.orcamentoHistorico.length : 0;

  // Grupos de escolha: rótulo real de `gruposV3` (fallback honesto quando a OS
  // referencia um grupoId sem metadado cadastrado) + faixa via `computeTotaisV3`
  // (mesma função que a V3 usa para persistir o total — nenhuma conta nova aqui).
  const gruposMetaRaw = Array.isArray((orc as { gruposV3?: unknown }).gruposV3) ? ((orc as { gruposV3?: unknown }).gruposV3 as unknown[]) : [];
  const rotuloPorGrupo = new Map<string, string>();
  for (const g of gruposMetaRaw) {
    const o = g as Record<string, unknown>;
    const gid = txt(o.id);
    const rotulo = txt(o.rotulo);
    if (gid && rotulo) rotuloPorGrupo.set(gid, rotulo);
  }

  const itensPorGrupo = new Map<string, V4OrcItemView[]>();
  const valoresPorGrupo = new Map<string, number[]>();
  const selecionadaPorGrupo = new Map<string, string | null>();
  for (const item of [...servicos, ...pecas]) {
    if (!item.grupoId) continue;
    itensPorGrupo.set(item.grupoId, [...(itensPorGrupo.get(item.grupoId) ?? []), item]);
    if (item.selecionada) selecionadaPorGrupo.set(item.grupoId, item.id);
    else if (!selecionadaPorGrupo.has(item.grupoId)) selecionadaPorGrupo.set(item.grupoId, null);
  }
  for (const s of servicosRaw) {
    const gid = lerGrupoIdV4(s);
    if (gid) valoresPorGrupo.set(gid, [...(valoresPorGrupo.get(gid) ?? []), servicoValorCliente(s as ServicoV3)]);
  }
  for (const p of pecasRaw) {
    const gid = lerGrupoIdV4(p);
    if (gid) valoresPorGrupo.set(gid, [...(valoresPorGrupo.get(gid) ?? []), pecaValorCliente(p as PecaV3)]);
  }

  const grupos: V4OrcGrupoView[] = Array.from(itensPorGrupo.keys()).map((gid, idx) => {
    const valores = valoresPorGrupo.get(gid) ?? [0];
    const selecionadaId = selecionadaPorGrupo.get(gid) ?? null;
    return {
      id: gid,
      rotulo: rotuloPorGrupo.get(gid) || `Opções ${idx + 1}`,
      itens: itensPorGrupo.get(gid) ?? [],
      resolvido: selecionadaId != null,
      selecionadaId,
      faixaMin: fmt(Math.min(...valores)),
      faixaMax: fmt(Math.max(...valores)),
    };
  });

  // Faixa de total do orçamento inteiro (reusa `computeTotaisV3`, fonte única
  // do cálculo de faixa — nenhuma lógica de min/max duplicada aqui).
  const totaisComFaixa = computeTotaisV3({
    pecas: pecasRaw as PecaV3[],
    servicos: servicosRaw as ServicoV3[],
    desconto: typeof orc?.desconto === "number" ? orc.desconto : 0,
  });

  return {
    estado,
    isPrevia,
    statusLabel: isPrevia ? "Prévia — não aprovado" : (ORC_STATUS_LABEL[orc.status] ?? orc.status ?? ""),
    statusTone: isPrevia ? "info" : (ORC_STATUS_TONE[orc.status] ?? "neutro"),
    servicos,
    pecas,
    total: totalNum > 0 ? fmt(totalNum) : NI,
    desconto: descNum > 0 ? fmt(descNum) : null,
    custoTotal: custoNum != null ? fmt(custoNum) : null,
    lucroTotal: custoNum != null ? fmt(totalNum - custoNum) : null,
    versoesCount,
    temVersoes: versoesCount > 0,
    grupos,
    temGrupos: grupos.length > 0,
    temFaixa: !!totaisComFaixa.faixa,
    faixaMin: totaisComFaixa.faixa ? fmt(totaisComFaixa.faixa.min) : NI,
    faixaMax: totaisComFaixa.faixa ? fmt(totaisComFaixa.faixa.max) : NI,
  };
}

// ---- Execução (GOAL OPS-V4-P0-011) -----------------------------------------
// Read-only sobre a OS já carregada. O stage Execução passa a ler só o que a OS
// persiste: técnico responsável, checklist técnico (pós-reparo, `checklistTecnico`),
// apontamentos reais (eventos de execução da timeline), peças consumidas
// (`estoqueMovimentos`) e anexos de bancada. Sem técnico/timer/apontamentos/
// bancada fabricados. Nada de valor inventado.

/** Eventos da timeline considerados "apontamento de execução / bancada". */
const EXEC_EVENTO_TIPOS = new Set<EventoTipo>([
  "servico_iniciado",
  "servico_concluido",
  "atribuicao_tecnico",
  "peca_adicionada",
  "estoque_consumido",
  "estoque_item_consumido",
  "estoque_restaurado",
  "checklist_finalizado",
]);

export interface V4ExecChecklistItem {
  id: string;
  label: string;
  ok: boolean;
}

export interface V4ExecEstoqueItem {
  id: string;
  nome: string;
  /** "2×" quando houver quantidade; vazio honesto caso contrário. */
  quantidade: string;
  /** "12 → 10" quando o saldo antes/depois existir; vazio honesto caso contrário. */
  saldo: string;
}

export interface V4ExecucaoView {
  /** true quando há QUALQUER sinal real de execução (técnico/checklist/apontamento/estoque/anexo). */
  temExecucao: boolean;
  tecnico: string;
  temTecnico: boolean;
  checklist: V4ExecChecklistItem[];
  checklistOk: number;
  apontamentos: V4HistEvento[];
  estoque: V4ExecEstoqueItem[];
  estoqueConsumido: boolean;
  /** Data/hora da baixa, "dd/mm HH:MM"; vazio quando ausente. */
  estoqueConsumidoEm: string;
  anexos: V4Anexo[];
}

export const EMPTY_EXECUCAO_VIEW: V4ExecucaoView = {
  temExecucao: false,
  tecnico: NI,
  temTecnico: false,
  checklist: [],
  checklistOk: 0,
  apontamentos: [],
  estoque: [],
  estoqueConsumido: false,
  estoqueConsumidoEm: "",
  anexos: [],
};

export function adaptExecucao(os: OrdemServico): V4ExecucaoView {
  const tecnicoNome = txt(os.tecnico?.nome);

  const checklistRaw = Array.isArray(os.checklistTecnico) ? os.checklistTecnico : [];
  const checklist: V4ExecChecklistItem[] = checklistRaw.map((it, i) => ({
    id: txt(it.id) || `chk_${i}`,
    label: txt(it.label),
    ok: !!it.ok,
  }));

  const tl = Array.isArray(os.timeline) ? os.timeline : [];
  const apontamentos = tl
    .filter((ev: EventoTimeline) => EXEC_EVENTO_TIPOS.has(ev.tipo))
    .slice()
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
    .map((ev: EventoTimeline): V4HistEvento => ({
      id: ev.id,
      type: "tecnico",
      text: txt(ev.titulo) || txt(ev.conteudo) || ev.tipo,
      meta: `${txt(ev.autor) || "Sistema"} · ${fmtDataHora(ev.criadoEm)}`,
      dot: C.info,
    }));

  const movRaw = Array.isArray(os.estoqueMovimentos) ? os.estoqueMovimentos : [];
  const estoque: V4ExecEstoqueItem[] = movRaw.map((m, i) => {
    const temSaldo = typeof m.estoqueAnterior === "number" && typeof m.estoqueDepois === "number";
    return {
      id: txt(m.id) || txt(m.produtoId) || `mov_${i}`,
      nome: txt(m.nome) || "Item",
      quantidade: typeof m.quantidade === "number" ? `${m.quantidade}×` : "",
      saldo: temSaldo ? `${m.estoqueAnterior} → ${m.estoqueDepois}` : "",
    };
  });

  const anexosLista = Array.isArray(os.anexos) ? os.anexos : [];
  const anexos: V4Anexo[] = anexosLista
    .filter((a: Anexo) => a.categoria === "bancada")
    .map((a: Anexo) => ({
      id: a.id,
      kind: ANEXO_KIND_LABEL[a.tipo] ?? "ANEXO",
      name: txt(a.nome) || "Anexo",
    }));

  return {
    temExecucao:
      !!tecnicoNome ||
      checklist.length > 0 ||
      apontamentos.length > 0 ||
      estoque.length > 0 ||
      anexos.length > 0,
    tecnico: tecnicoNome || NI,
    temTecnico: !!tecnicoNome,
    checklist,
    checklistOk: checklist.filter((c) => c.ok).length,
    apontamentos,
    estoque,
    estoqueConsumido: !!os.estoqueConsumido,
    estoqueConsumidoEm: os.estoqueConsumidoEm ? fmtDataHora(os.estoqueConsumidoEm) : "",
    anexos,
  };
}

// ---- Entrega (GOAL OPS-V4-P0-012) ------------------------------------------
// Read-only sobre a OS já carregada. O stage Entrega passa a ler só o que a OS
// persiste: retirada confirmada (`retirada`), data de entrega (`entregueEm`),
// assinatura textual, acessórios do aparelho, eventos de entrega/garantia da
// timeline e a garantia real (operacional `garantiasOperacionais` ou de payload
// `garantia`). Sem retirada/garantia/checklist/assinatura fabricados. Não há
// "checklist final de entrega" no modelo → empty honesto. Nada inventado.

/** Eventos da timeline considerados de entrega / garantia. */
const ENTREGA_EVENTO_TIPOS = new Set<EventoTipo>([
  "entrega_cliente",
  "retirada_confirmada",
  "garantia_gerada",
  "garantia_acionada",
]);

export interface V4GarantiaView {
  /** true quando há garantia real (operacional ou de payload). */
  temGarantia: boolean;
  situacao: string;
  situacaoTone: "success" | "info" | "warn" | "danger" | "neutro";
  prazo: string;
  inicio: string;
  fim: string;
  cobertura: string;
  /** Condições/observações reais; vazio quando não houver. */
  observacoes: string;
  /** Nº de acionamentos quando > 0; vazio honesto caso contrário. */
  acionamentos: string;
}

export const EMPTY_GARANTIA_VIEW: V4GarantiaView = {
  temGarantia: false,
  situacao: NI,
  situacaoTone: "neutro",
  prazo: NI,
  inicio: NI,
  fim: NI,
  cobertura: NI,
  observacoes: "",
  acionamentos: "",
};

/**
 * Garantia real da OS — reusa os leitores PUROS já usados pelo pós-venda e pela
 * impressão da OS (`lerGarantiaV3` para situação/prazo/vigência a partir de
 * `aberturaV3.garantiaPrevista`, com fallback `os.garantia`/`garantiasOperacionais`;
 * `termoGarantiaDaOSV3` para o texto de cobertura/exclusões/observação do MESMO
 * catálogo oficial usado no Termo de Garantia impresso). Nenhuma lógica nova.
 */
function adaptGarantia(os: OrdemServico): V4GarantiaView {
  const view = buildGarantiaPosVendaV4(os);
  if (!view.temGarantia) return EMPTY_GARANTIA_VIEW;
  const acionamentos = buildPosVendaV4(os).retornos.length;

  return {
    temGarantia: true,
    situacao: view.situacaoLabel,
    situacaoTone: view.tone,
    prazo: !view.semCobertura && view.prazoDias > 0 ? `${view.prazoDias} dias` : NI,
    inicio: view.inicio ? fmtData(view.inicio) : NI,
    fim: view.vencimento ? fmtData(view.vencimento) : NI,
    cobertura: view.cobertura.length ? view.cobertura.join(" · ") : NI,
    observacoes: view.observacoes ?? "",
    acionamentos: acionamentos > 0 ? String(acionamentos) : "",
  };
}

export interface V4EntregaView {
  /** true quando há QUALQUER registro real de entrega/retirada/garantia/evento. */
  temRegistro: boolean;
  /** Equipamento efetivamente entregue/retirado. */
  entregue: boolean;
  statusLabel: string;
  statusTone: "success" | "info" | "neutro";
  retiradoPor: string;
  retiradoEm: string;
  /** Observação real da retirada; vazio quando não houver. */
  observacao: string;
  temAssinatura: boolean;
  /** Assinatura digital real de retirada (data URL PNG); vazio quando ausente. */
  assinaturaDataUrl: string;
  /** Fotos de saída reais (`entregaV3.fotosSaida`). */
  fotosSaida: V4FotoEntrada[];
  /** Acessórios reais do aparelho (devolvidos com o equipamento). */
  acessorios: string[];
  eventos: V4HistEvento[];
  garantia: V4GarantiaView;
}

export const EMPTY_ENTREGA_VIEW: V4EntregaView = {
  temRegistro: false,
  entregue: false,
  statusLabel: "Não entregue",
  statusTone: "neutro",
  retiradoPor: NI,
  retiradoEm: NI,
  observacao: "",
  temAssinatura: false,
  assinaturaDataUrl: "",
  fotosSaida: [],
  acessorios: [],
  eventos: [],
  garantia: EMPTY_GARANTIA_VIEW,
};

export function adaptEntrega(os: OrdemServico): V4EntregaView {
  const retirada = os.retirada;
  const entregaV3 = lerEntregaV3(os);
  const entregue = os.status === "entregue" || !!retirada?.confirmado || !!txt(os.entregueEm);
  const statusLabel = entregue ? "Entregue" : os.status === "pronta" ? "Pronta para retirada" : "Não entregue";
  const statusTone: V4EntregaView["statusTone"] = entregue
    ? "success"
    : os.status === "pronta"
      ? "info"
      : "neutro";

  const retiradoPor = txt(retirada?.retiradoPor);
  const retiradoEmRaw = txt(retirada?.retiradoEm) || txt(os.entregueEm);
  // Assinatura digital real de retirada (SPRINT_3E.2) — mesma fonte usada pelo
  // Termo de Entrega impresso (`montarTermoEntregaV3`). Nunca texto fabricado.
  const assinaturaDataUrl = txt(entregaV3.assinaturaRetiradaDataUrl);
  const observacao = txt(retirada?.observacao);
  const acessorios = adaptAcessoriosEntrada(os);

  const tl = Array.isArray(os.timeline) ? os.timeline : [];
  const eventos = tl
    .filter((ev: EventoTimeline) => ENTREGA_EVENTO_TIPOS.has(ev.tipo))
    .slice()
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
    .map((ev: EventoTimeline): V4HistEvento => ({
      id: ev.id,
      type: "status",
      text: txt(ev.titulo) || txt(ev.conteudo) || ev.tipo,
      meta: `${txt(ev.autor) || "Sistema"} · ${fmtDataHora(ev.criadoEm)}`,
      dot: C.primary,
    }));

  const garantia = adaptGarantia(os);
  const fotosSaida = adaptFotosSaida(os);

  return {
    temRegistro:
      entregue || !!retiradoPor || !!assinaturaDataUrl || !!observacao || eventos.length > 0 || garantia.temGarantia || fotosSaida.length > 0,
    entregue,
    statusLabel,
    statusTone,
    retiradoPor: retiradoPor || NI,
    retiradoEm: retiradoEmRaw ? fmtDataHora(retiradoEmRaw) : NI,
    observacao,
    temAssinatura: !!assinaturaDataUrl,
    assinaturaDataUrl,
    fotosSaida,
    acessorios,
    eventos,
    garantia,
  };
}

// ---- Pós-venda -------------------------------------------------------------
// Adapter fino: a projeção inteira vive no helper puro V4, que por sua vez lê
// exclusivamente os readers V3. Retornos vêm de `payload.retornosV3[]`, nunca
// são reconstruídos a partir de texto da timeline.
export type V4PosVendaView = PosVendaV4;
export const EMPTY_POSVENDA_VIEW: V4PosVendaView = EMPTY_POSVENDA_V4;
export function adaptPosVenda(os: OrdemServico): V4PosVendaView {
  return buildPosVendaV4(os);
}

// ---- Busca da lista de OS (GOAL OPS-V4-P0-002) -----------------------------

function norm(s: string): string {
  // Remove acentos (combining marks U+0300–U+036F) para busca tolerante.
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Casa a OS contra um termo de busca: Nº OS, Cliente, Aparelho, IMEI. */
export function osMatchesQuery(os: OrdemServico, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const campos = [
    txt(os.codigo),
    txt(os.cliente?.nome),
    txt(os.cliente?.documento),
    txt(os.cliente?.telefone),
    aparelhoLabel(os),
    txt(os.equipamento?.tipo),
    txt(os.equipamento?.numeroSerie), // IMEI / série
  ];
  return campos.some((c) => c && norm(c).includes(q));
}
