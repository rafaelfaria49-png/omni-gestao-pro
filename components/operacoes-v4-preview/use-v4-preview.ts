/**
 * Operações V4 · Beta operacional — estado local + derivação de "vals".
 *
 * Porta o `class Component extends DCLogic` do protótipo Cloud Design para
 * React: o estado vira `useState`, e `buildVals()` espelha o `renderVals()`
 * original (produz o objeto consumido pela UI). Os STAGES leem e ESCREVEM a OS
 * REAL via actions V3 reusadas (cancelar, diagnóstico, orçamento, execução,
 * entrega, assinatura, garantia, recebimento — ver blocos "REAL" abaixo). As
 * telas de rail e o modal Nova OS de fato criam/leem dados reais da loja. Só
 * os handlers marcados `PREVIEW_NOOP` continuam sem efeito (ex.: ligar/exportar
 * histórico/portal do cliente — sem contrato) e disparam um toast honesto.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HIST_FILTER_DEF,
  MODE_DEF,
  MODULE_META,
  PENDING,
  PRIMARY,
  PRIO,
  RAIL_DEF,
  RESOLVED_RAW,
  STATUS_LABEL,
  TONE,
} from "./mock-data";
import { C, fmt } from "./tokens";
import type { V4State, V4Stage } from "./types";
import type { FinancialProjectionOSV4, FinancialStatusV4 } from "@/lib/operacoes-v4/financial-projection";
import { useLojaAtiva } from "@/lib/loja-ativa";
import type { OrdemServico, Orcamento } from "@/types/os";
import { useOrdensV4, useOrdemV4 } from "./use-ordens-v4";
// Actions REAIS reaproveitadas da V3 (sem criar backend novo) — slices OPS-V4-ORCAMENTO-REAL-002 / -ENTRADA-RECEPCAO-REAL-003.
import { salvarDiagnosticoV3, salvarChecklistEntradaV3 } from "@/lib/operacoes-v3/workspace-actions";
import {
  gerarOrcamentoDaOS,
  salvarOrcamentoV3,
  corrigirOrcamentoV3,
  aprovarOrcamentoV3,
  recusarOrcamentoV3,
} from "@/lib/operacoes-v3/orcamento-actions";
import { aplicarTransicaoStatusV3 } from "@/lib/operacoes-v3/status-actions";
import { atribuirTecnicoV3, definirPrioridadeV3 } from "@/lib/operacoes-v3/producao-actions";
import { PRIORIDADE_META_V3, type PrioridadeV3 } from "@/lib/operacoes-v3/producao-model";
import {
  buildProducaoBancadaV4,
  labelAcaoBancadaV4,
  podeAvancarStatusBancadaV4,
  podeMutarProducaoV4,
  projetarOsProducaoV4,
} from "@/lib/operacoes-v4/producao-v4";
import {
  buildFilaOperacionalV4,
  FILA_VIEW_PREF_KEY,
  labelAcaoFilaV4,
  lerModoFilaV4,
  MSG_SEM_TECNICO_INICIO_V4,
  podeMoverStatusFilaV4,
  type ModoFilaV4,
} from "@/lib/operacoes-v4/fila-v4";
// Envio por canal (GOAL OPS-V4-ORC-ENVIO-WA-025) — action fina de orquestração
// (decide enviar 1ª vez vs. só registrar reenvio); a mensagem NASCE da projeção
// client-safe do GOAL 023, nunca do payload cru.
import { enviarOrcamentoPorCanalV3 } from "@/lib/operacoes-v3/orcamento-envio-actions";
import { lerComercialV4 } from "@/lib/operacoes-v4/orcamento-pre-os";
import type { CanalEnvioOrcamentoV3, PecaV3, RecusarOrcamentoV3Input, ServicoV3 } from "@/lib/operacoes-v3/orcamento-model";
import { montarOrcamentoClienteViewV4 } from "@/lib/operacoes-v4/orcamento-cliente-view";
import type { OrcamentoRapidoFormV4 } from "@/lib/operacoes-v4/orcamento-rapido-form";
import {
  patchAbrirLauncherNovoAtendimentoV4,
  patchEscolherNovoAtendimentoV4,
  type NovoAtendimentoModalidadeV4,
} from "@/lib/operacoes-v4/novo-atendimento";
// Seleção de variante (GOAL OPS-V4-ORC-APROVACAO-SELECAO-026) — utilitário
// puro que marca `selecionadaV3`; grava pelo contrato oficial (`salvarOrcamentoV3`
// com `gruposV3`, GOAL 026 aposentou o patch cru do GOAL 024).
import { marcarSelecaoVarianteV4 } from "@/lib/operacoes-v4/orcamento-selecao";
// Máquina única de status (pura, sem I/O) — reaproveitada para habilitar/desabilitar
// as ações de Execução exatamente igual ao servidor decide (slice OPS-V4-EXECUCAO-REAL-007).
import { podeTransicionarV3, statusV3FromOS, type OperacaoStatusV3 } from "@/lib/operacoes-v3/status-machine";
// PDV de Serviço V3 (slice PDV-SERVICO-OS-RECEBIMENTO-REAL-001): hook client-side
// já pronto (carrega pagamento+sessão de caixa, expõe receber/estornar/reload) —
// reaproveitado tal como é, sem motor novo. A V4 só adiciona o reload da lista/
// detalhe da OS depois do recebimento (ver `receberPagamentoV4` abaixo).
import { usePdvServicoV3, type PdvServicoState } from "@/components/operacoes-v3/hooks/use-pdv-servico-v3";
import type { EstornarRecebimentoInputV3, ReceberOSInputV3 } from "@/lib/operacoes-v3/pdv-servico-actions";
// GOAL OPS-V4-RECEBIMENTO-A-PRAZO-MINIMO-006: action separada de `receberOSV3` —
// nunca liquida título, nunca movimenta caixa, nunca exige caixa aberto.
import { lancarOSAPrazoV3, type LancarAPrazoInputV3 } from "@/lib/operacoes-v3/pdv-servico-actions";
import {
  salvarIdentificacaoV3,
  salvarProvaEntradaV3,
  salvarAcessoriosEntradaV3,
  adicionarFotoEntradaV3,
  removerFotoEntradaV3,
  salvarAssinaturaClienteV3,
  type AdicionarFotoEntradaInputV3,
  type SalvarProvaEntradaInputV3,
} from "@/lib/operacoes-v3/prova-entrada-actions";
import type { IdentificacaoV3, AcessorioEntradaV3 } from "@/lib/operacoes-v3/prova-entrada-model";
import type { ChecklistEntradaItemV3 } from "@/lib/operacoes-v3/workspace-model";
import { salvarDadosBasicosOSV3 } from "@/lib/operacoes-v3/dados-basicos-actions";
import type { SalvarDadosBasicosInputV3 } from "@/lib/operacoes-v3/dados-basicos-model";
// Assinatura de retirada real (SPRINT_3E.2) e auditoria de impressão (Fase 1E) —
// reuso direto das actions V3 (GOAL OPS-V4-DOCS-ASSINATURA-TERMOS-ANEXOS-012).
import {
  registrarEntregaV3,
  salvarAssinaturaRetiradaV3,
  adicionarFotoSaidaV3,
  removerFotoSaidaV3,
  type AdicionarFotoSaidaInputV3,
} from "@/lib/operacoes-v3/entrega-actions";
import { montarMensagemAtualizacaoOSV4 } from "@/lib/operacoes-v4/documento-mensagem";
import { montarLinkWaV4 } from "@/lib/operacoes-v4/orcamento-mensagem";
import type { EntregaSemCobrancaSolicitacaoV3 } from "@/lib/operacoes-v3/delivery-financial-guard";
import { registrarImpressaoDocumentoV3, salvarGarantiaOSV3 } from "@/lib/operacoes-v3/garantia-actions";
import { abrirRetornoV3, finalizarRetornoV3 } from "@/lib/operacoes-v3/retorno-actions";
import type { DocumentoTipoV3 } from "@/lib/operacoes-v3/documentos";
import { editorToSalvarInputV4, seedEditorFromOS, type OrcamentoEditorV4 } from "@/lib/operacoes-v4/orcamento-form";
import { seedEntradaEditor, type EntradaEditorV4 } from "@/lib/operacoes-v4/entrada-form";
import { seedDadosBasicos, type DadosBasicosEditorV4 } from "@/lib/operacoes-v4/dados-basicos-form";
import {
  PIPELINE_OPERACIONAL_IDS_V4,
  estadoNoPipelineOperacionalV4,
  labelPipelineOperacionalV4,
} from "@/lib/operacoes-v4/pipeline-operacional";
import {
  montarComercialHeaderV4,
  montarFinanceiroHeaderV4,
  montarHistoricoHeaderV4,
} from "@/lib/operacoes-v4/os-header-transversal";
import { montarResumoFinanceiroOSV4 } from "@/lib/operacoes-v4/financeiro-v4";
import { buildGarantiasPortfolioV4 } from "@/lib/operacoes-v4/posvenda-v4";
import {
  adaptAcessoriosEntrada,
  adaptAnexos,
  adaptChecklist,
  adaptDiagnostico,
  adaptEntrega,
  adaptExecucao,
  adaptFotosEntrada,
  adaptObservacoes,
  adaptOrcamento,
  adaptOsHeader,
  adaptPosVenda,
  adaptSegurancaEntrada,
  adaptTimeline,
  EMPTY_DIAGNOSTICO_VIEW,
  EMPTY_ENTREGA_VIEW,
  EMPTY_POSVENDA_VIEW,
  EMPTY_EXECUCAO_VIEW,
  EMPTY_ORCAMENTO_VIEW,
  EMPTY_OS_VIEW,
  EMPTY_SEGURANCA_ENTRADA,
  realPrioridadeToV4,
  resolverStatusV4,
  stageForStatus,
} from "./os-adapter";
import {
  useFinancialProjectionV4,
  useFinancialProjectionsV4,
  type FinancialProjectionStateV4,
} from "./use-financial-projection-v4";
import {
  buildBancadaView,
  buildDashboardResumo,
  buildFilaItens,
  buildPdvView,
  buildSlaView,
} from "./rails-adapter";

/** Entrada do editor de diagnóstico V4 → action `salvarDiagnosticoV3`. */
export interface DiagnosticoInputV4 {
  inicial: string;
  final: string;
  causa: string;
  solucao: string;
}

/** Dados reais injetados no `buildVals` (leitura + ações de escrita reais da V3). */
export interface V4DataCtx {
  ordens: OrdemServico[];
  ordensLoading: boolean;
  ordensPrimeiraCarga: boolean;
  ordensError: string | null;
  reloadOrdens: () => void;
  /** Recarrega o detalhe da OS selecionada após uma escrita. */
  reloadDetail: () => void;
  /** OS selecionada já hidratada (detalhe) ou linha da lista enquanto carrega. */
  realOS: OrdemServico | null;
  detailLoading: boolean;
  /** Projeção financeira server-side da OS selecionada; nunca contém payload bruto. */
  financialProjection: FinancialProjectionStateV4;
  /** Projeções server-side carregadas em lote exclusivamente para o rail PDV. */
  financialProjectionsByOsId: ReadonlyMap<string, FinancialProjectionOSV4>;
  financialRailLoading: boolean;
  financialRailError: string | null;
  // ---- Ações de escrita REAIS (slice OPS-V4-ORCAMENTO-REAL-002) ----
  // Cada uma chama uma action real da V3 (storeId+osId da loja/OS ativas),
  // recarrega lista+detalhe e devolve `true` em sucesso. Sem caixa/estoque/financeiro.
  salvarDiagnostico: (input: DiagnosticoInputV4) => Promise<boolean>;
  gerarOrcamento: () => Promise<boolean>;
  salvarOrcamento: (editor: OrcamentoEditorV4) => Promise<boolean>;
  // GOAL OPS-V4-ORCAMENTO-REABRIR-MOTOR-003: correção controlada de orçamento em OS
  // avançada (aprovada/em execução/pronta/recebida/entregue). Action SEPARADA de
  // `salvarOrcamentoV3` (que só aceita rascunho/enviado) — recalcula valorTotal e
  // preserva o status da OS. O editor em modo revisão chama isto em vez do salvar comum.
  corrigirOrcamento: (editor: OrcamentoEditorV4) => Promise<boolean>;
  aprovarOrcamento: () => Promise<boolean>;
  // GOAL 026: motivo estruturado (enum + observação opcional) — substitui o
  // texto livre solto de antes; `recusarOrcamentoV3` (motor) ainda aceita
  // string legada para OUTROS chamadores (hub V3), mas a V4 sempre manda a
  // entrada estruturada a partir daqui.
  recusarOrcamento: (input: RecusarOrcamentoV3Input) => Promise<boolean>;
  // Marca a variante escolhida de um grupo (grava via `salvarOrcamentoV3`,
  // contrato oficial com `gruposV3`) — estado sempre do servidor.
  selecionarVarianteOrcamento: (grupoId: string, itemId: string) => Promise<boolean>;
  iniciarDiagnostico: () => Promise<boolean>;
  iniciarServico: () => Promise<boolean>;
  // ---- Execução (slice OPS-V4-EXECUCAO-REAL-007) ----
  // "iniciarServico" (acima) é reaproveitado para em_execucao a partir de aprovado
  // OU aguardando_peca (mesmo destino "em_execucao"; o rótulo muda na UI).
  marcarAguardandoPeca: () => Promise<boolean>;
  marcarPronta: () => Promise<boolean>;
  // ---- Entrega (slice OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008) ----
  // Confirma pela action canônica `registrarEntregaV3`; o servidor sempre revalida
  // financeiro, mesmo quando o cliente chama fora do gate visual.
  confirmarEntrega: (semCobranca?: EntregaSemCobrancaSolicitacaoV3) => Promise<boolean>;
  // ---- Assinatura de retirada + auditoria de impressão (GOAL OPS-V4-DOCS-
  // ASSINATURA-TERMOS-ANEXOS-012) ----
  /** Persiste a assinatura de retirada (reuso de `salvarAssinaturaRetiradaV3`). */
  salvarAssinaturaRetirada: (dataUrl: string) => Promise<boolean>;
  /** Persiste foto de saída em `entregaV3.fotosSaida`. */
  adicionarFotoSaida: (input: AdicionarFotoSaidaInputV3) => Promise<boolean>;
  removerFotoSaida: (fotoId: string) => Promise<boolean>;
  /** Registra na timeline que um documento foi impresso (best-effort). */
  registrarImpressaoDoc: (tipo: DocumentoTipoV3) => void;
  // ---- Garantia da OS (GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014) ----
  /** Define/edita a garantia prevista da OS (reuso de `salvarGarantiaOSV3`). */
  salvarGarantia: (input: { modeloId: string; prazoDias?: number }) => Promise<boolean>;
  /** Abre retorno no payload da OS original via motor V3 e, se entregue, o atendimento vinculado. */
  abrirRetorno: (motivo: string, observacao?: string) => Promise<boolean>;
  /** Finaliza o retorno indicado via motor V3. */
  finalizarRetorno: (retornoId: string, observacao?: string) => Promise<boolean>;
  /** Abre a OS original ou o atendimento de retorno pelo id persistido. */
  abrirOsVinculada: (osId: string) => void;
  // ---- Cancelamento de OS (GOAL OPS-V4-CANCELAR-OS-CONNECT-021) ----
  /** Cancela a OS via `aplicarTransicaoStatusV3(sid, osId, "cancelada", { motivo })` (motivo obrigatório, contrato já blindado — commit f825867). */
  cancelarOS: (motivo: string) => Promise<boolean>;
  // GOAL 026: link honesto (não automático) pós-recusa/expiração — abre o
  // MESMO modal de cancelamento acima, só que com um motivo pré-preenchido
  // (o operador ainda confirma/edita antes de cancelar de verdade).
  cancelamentoMotivoPrefill: string | null;
  definirCancelamentoMotivoPrefill: (motivo: string | null) => void;
  // ---- PDV de Serviço / recebimento real (slice PDV-SERVICO-OS-RECEBIMENTO-REAL-001) ----
  // Estado + ações vêm DIRETO do hook V3 `usePdvServicoV3` (pagamento/sessão de
  // caixa/receber/estornar/recibo) — só o `receber` é envolvido para também
  // recarregar lista+detalhe da V4 depois do sucesso.
  pdvServico: PdvServicoState;
  // ---- "A prazo" (GOAL OPS-V4-RECEBIMENTO-A-PRAZO-MINIMO-006) ----
  // Action SEPARADA de `receberOSV3`/`pdvServico.receber` — formaliza o saldo
  // aberto como Conta a Receber PENDENTE (vencimento), sem receber dinheiro.
  lancarAPrazo: (input: LancarAPrazoInputV3) => Promise<boolean>;
  // ---- Entrada/Recepção (slice OPS-V4-ENTRADA-RECEPCAO-REAL-003) ----
  salvarIdentificacao: (input: IdentificacaoV3) => Promise<boolean>;
  salvarProvaEntrada: (input: SalvarProvaEntradaInputV3) => Promise<boolean>;
  salvarAcessorios: (acessorios: AcessorioEntradaV3[]) => Promise<boolean>;
  salvarChecklist: (itens: ChecklistEntradaItemV3[]) => Promise<boolean>;
  adicionarFotoEntrada: (input: AdicionarFotoEntradaInputV3) => Promise<boolean>;
  removerFotoEntrada: (fotoId: string) => Promise<boolean>;
  salvarAssinaturaCliente: (dataUrl: string) => Promise<boolean>;
  // ---- Dados básicos da OS (slice OPS-V4-DADOS-BASICOS-OS-REAL-003B) ----
  salvarDadosBasicos: (input: SalvarDadosBasicosInputV3) => Promise<boolean>;
  // ---- Produção / Bancada (GOAL OPS-V4-PRODUCAO-TECNICO-BANCADA-003) ----
  // Mutations sobre QUALQUER OS da lista (não só a selecionada). Reusam o motor V3.
  atribuirTecnico: (osId: string, nome: string, id?: string) => Promise<boolean>;
  removerTecnico: (osId: string) => Promise<boolean>;
  definirPrioridade: (osId: string, prioridade: PrioridadeV3) => Promise<boolean>;
  avancarStatusBancada: (osId: string, to: OperacaoStatusV3) => Promise<boolean>;
  // ---- Fila / Kanban (GOAL OPS-V4-FILA-KANBAN-WRITE-004) ----
  // Mesma action V3; o recorte de destinos (sem recebida/entregue/cancelada) vive no adapter.
  moverStatusFila: (osId: string, to: OperacaoStatusV3) => Promise<boolean>;
  modoFila: ModoFilaV4;
  setModoFila: (modo: ModoFilaV4) => void;
  // ---- Envio de orçamento por canal (GOAL OPS-V4-ORC-ENVIO-WA-025) ----
  // Diferente do padrão `runWrite` (booleano): devolve `reenvio`/`avisoRegistro`
  // porque o painel pós-envio precisa saber qual mensagem honesta mostrar.
  enviarOrcamentoPorCanal: (canal: CanalEnvioOrcamentoV3) => Promise<EnviarOrcamentoPorCanalUiResultV4>;
  // ---- Prefill de "Duplicar orçamento" (GOAL 025) — estado do prefill vive
  // fora do `V4State` (objeto rico, não é um flag visual simples); o modal só
  // lê `orcamentoRapidoPrefill` quando abre.
  orcamentoRapidoPrefill: OrcamentoRapidoFormV4 | null;
  definirOrcamentoRapidoPrefill: (values: OrcamentoRapidoFormV4 | null) => void;
}

/** Resultado honesto de `enviarOrcamentoPorCanal` para a UI decidir o que mostrar. */
export interface EnviarOrcamentoPorCanalUiResultV4 {
  ok: boolean;
  reenvio?: boolean;
  avisoRegistro?: boolean;
}

/**
 * GOAL OPS-V4-RIGHT-RAIL-DEDUP-001: preferência aberto/fechado da lateral
 * "Atividade", por navegador. Chave isolada da V4 — não colide com nenhuma
 * outra tela ("1" = aberta, "0" = fechada; ausente = default fechado).
 */
export const RIGHT_RAIL_PREF_KEY = "omnigestao:operacoes-v4:right-rail-open";

/**
 * Grava a preferência SÓ no toggle explícito da coluna (nunca em efeito de
 * mount — o StrictMode do dev roda efeitos 2× e acabaria gravando o default
 * sem o usuário ter escolhido nada). Sem storage (SSR, teste em node,
 * navegação privada), vira no-op e o aberto/fechado segue em memória.
 */
function persistFilaViewPref(modo: ModoFilaV4) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FILA_VIEW_PREF_KEY, modo);
  } catch {
    /* preferência visual — falha silenciosa */
  }
}

function persistRightRailPref(open: boolean) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RIGHT_RAIL_PREF_KEY, open ? "1" : "0");
  } catch {
    /* storage indisponível — preferência não persiste, UI continua normal */
  }
}

const INITIAL: V4State = {
  view: "cockpit",
  module: "workspace",
  stage: "execucao",
  status: "em_execucao",
  left: true,
  // GOAL OPS-V4-RIGHT-RAIL-DEDUP-001: a lateral "Atividade" nasce FECHADA para
  // não espremer o workspace; a preferência do navegador (localStorage) é
  // reaplicada pós-mount em `useV4Preview` — nunca aqui, para o primeiro render
  // do cliente bater com o HTML do SSR.
  right: false,
  menu: null,
  toast: "",
  prioridade: "alta",
  histFilter: "todos",
  novaOS: false,
  novoAtendimento: false,
  recibo: false,
  atendimentoRapido: false,
  orcamentoRapido: false,
  estornoRecebimento: false,
  receberPagamento: false,
  cancelamentoOS: false,
  selectedOsId: null,
  focus: false,
  authState: "autorizado",
  pin4: 3,
  pin6: 3,
  pattern: [0, 3, 4, 7],
  senha: "",
  motivo: "",
  docPrint: null,
};

type Patch = Partial<V4State> | ((s: V4State) => Partial<V4State>);

/**
 * Mensagem honesta reservada aos handlers residuais que ainda NÃO persistem
 * (ex.: WhatsApp, exportar histórico, alguns documentos/atalhos). A maioria
 * das ações de escrita da V4 (cancelar OS, diagnóstico, orçamento, execução,
 * entrega, assinatura, garantia, recebimento, Nova OS) já é real e persiste
 * via actions V3 — este toast NÃO se aplica a elas.
 */
const PREVIEW_NOOP = "Indisponível nesta versão — nenhuma alteração foi salva.";

/**
 * PDV-SERVICO-OS-RECEBIMENTO-REAL-001: o recebimento passou a ser real (aba
 * Financeiro, via `usePdvServicoV3`/`receberOSV3`) — este toast só confirma a
 * navegação, sem prometer nada que a aba não entregue.
 */
const RECEBIMENTO_NO_FINANCEIRO = "Receba o pagamento na aba Financeiro.";

/**
 * GOAL OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008: quando a OS está pronta e sem saldo
 * pendente confirmado, a ação primária global passa a levar à aba Entrega (onde
 * vive o botão real "Confirmar entrega") em vez de repetir "Receba o pagamento" —
 * a OS já não deve nada.
 */
const ENTREGA_NA_ABA_ENTREGA = "Confirme a entrega na aba Entrega.";

/**
 * OPS-V4-ACTIONS-RECONCILE-010: "Marcar pronta" (em_execucao) e "Peça chegou —
 * retomar" (aguardando_peca) já têm ação real (`marcarPronta`/`iniciarServico`
 * via `aplicarTransicaoStatusV3`), mas o botão dedicado — com seu próprio
 * busy-lock — vive na aba Execução, nunca no header. Este toast só confirma a
 * navegação, igual ao padrão já usado para Financeiro/Entrega.
 */
const EXECUCAO_NA_ABA_EXECUCAO = "Confirme a transição na aba Execução.";

/**
 * Saldo confirmado zerado: exige o pagamento JÁ carregado (`!!pag`) e `saldo<=0`.
 * Nunca libera "Entregar OS" só por o pagamento ainda não ter carregado — nesse
 * caso (`pag` null) o default seguro é continuar tratando como saldo pendente.
 * Cobre também OS sem cobrança nenhuma (`saldo` já nasce 0 quando `total` é 0).
 */
/**
 * Ação primária quando a OS está "pronta" E sem saldo pendente (ver
 * `pagamentoSemSaldoPendente`). Tipada a partir de `PRIMARY` (mock-data) para não
 * precisar importar `V4Status`/`V4Stage` só para esta constante.
 */
const PRIMARY_ENTREGAR_OS: NonNullable<(typeof PRIMARY)[keyof typeof PRIMARY]> = {
  label: "Entregar OS",
  to: "entregue",
  stage: "entrega",
};

const PRIMARY_REVISAR_COBRANCA: NonNullable<(typeof PRIMARY)[keyof typeof PRIMARY]> = {
  label: "Revisar cobrança",
  to: "pronta",
  stage: "financeiro",
};

const FINANCIAL_STATUS_LABEL: Record<FinancialStatusV4, string> = {
  UNKNOWN: "Financeiro indisponível",
  NO_PRICE: "Sem preço autorizado",
  PRICE_DEFINED: "Preço definido",
  CHARGE_NOT_CREATED: "Cobrança não criada",
  OPEN: "Em aberto",
  PARTIAL: "Pagamento parcial",
  PAID: "Quitado",
  AUTHORIZED_CREDIT: "Autorizado a prazo",
  AUTHORIZED_NO_CHARGE: "Sem cobrança autorizada",
  INCONSISTENT: "Financeiro inconsistente",
  CANCELLED: "Cobrança cancelada",
  REVERSED: "Pagamento estornado",
};

export function buildVals(
  st: V4State,
  update: (p: Patch) => void,
  notify: (msg: string) => void,
  ctx: V4DataCtx,
) {
  // OS real selecionada → identidade/financeiro reais (vazio honesto quando ausente).
  const realOS = ctx.realOS;
  const financialProjection = ctx.financialProjection.projection;
  const financialStatusLabel = financialProjection
    ? FINANCIAL_STATUS_LABEL[financialProjection.financialStatus]
    : ctx.financialProjection.loading
      ? "Carregando financeiro"
      : "Financeiro indisponível";
  const paymentMethodSummary = financialProjection?.paymentMethods.map((item) => item.label).join(" + ") || "Não registrada";
  const osView = realOS ? adaptOsHeader(realOS) : EMPTY_OS_VIEW;
  const timelineReal = realOS ? adaptTimeline(realOS) : [];
  const anexosReais = realOS ? adaptAnexos(realOS) : [];
  const observacoesReais = realOS ? adaptObservacoes(realOS) : [];
  // Diagnóstico REAL (defeito/observações/anexos/eventos); vazio honesto sem dado.
  const diagnosticoReal = realOS ? adaptDiagnostico(realOS) : EMPTY_DIAGNOSTICO_VIEW;
  // Execução REAL (técnico/checklist técnico/apontamentos/estoque/anexos de bancada);
  // vazio honesto quando não houver execução registrada. Sem técnico/timer/mock.
  const execucaoReal = realOS ? adaptExecucao(realOS) : EMPTY_EXECUCAO_VIEW;
  // Entrega REAL (retirada/assinatura/acessórios/eventos + garantia real); vazio
  // honesto quando a OS ainda não foi entregue. Sem retirada/garantia/checklist mock.
  const entregaReal = realOS ? adaptEntrega(realOS) : EMPTY_ENTREGA_VIEW;
  // Pós-venda REAL (garantia/retornos em garantia/eventos de pós-venda); vazio
  // honesto quando não houver registro. Sem NPS/satisfação/follow-up fabricados.
  const posVendaReal = realOS ? adaptPosVenda(realOS) : EMPTY_POSVENDA_VIEW;
  const garantiasPortfolio = buildGarantiasPortfolioV4(ctx.ordens, { vencendoDias: 7 });
  // Orçamento REAL — calculado cedo (GOAL 023) para gatear o item "Orçamento
  // (via cliente)" do menu Docs por dado real (`estado === "persistido"`).
  const orcamentoReal = realOS ? adaptOrcamento(realOS) : EMPTY_ORCAMENTO_VIEW;
  // Projeção client-safe do orçamento (GOAL 023) — fonte ÚNICA da mensagem de
  // envio (GOAL 025): nunca lemos o payload cru para montar a mensagem.
  const orcamentoClienteView = realOS ? montarOrcamentoClienteViewV4(realOS) : null;
  // Status exibido: SEMPRE o da OS real carregada (sem drift após escritas/reloads);
  // o snapshot local `st.status` é só fallback enquanto nenhuma OS está selecionada.
  const status = realOS ? resolverStatusV4(realOS) : st.status;

  const go = (stage: V4Stage) =>
    update({ stage, view: "cockpit", module: "workspace", menu: null });
  const setModule = (m: V4State["module"]) =>
    update({ module: m, view: "cockpit", menu: null });
  const setView = (v: V4State["view"]) => update({ view: v, menu: null });
  const toggleMenu = (m: "print" | "more") =>
    update((s) => ({ menu: s.menu === m ? null : m }));
  // Ação primária. SOMENTE as transições seguras desta fase persistem de verdade
  // (aberta → diagnostico; aprovado → em_execucao), via `aplicarTransicaoStatusV3`.
  // As demais (enviar orçamento, registrar aprovação…) seguem PREVIEW honesto:
  // apenas NAVEGAM à etapa relacionada + toast — NUNCA mudam o status exibido (o
  // status mostrado é sempre o real da OS carregada). "pronta" é especial: navega
  // a Financeiro OU Entrega conforme o saldo real — nunca confirma a entrega a
  // partir do header (a ação real fica no botão dedicado da aba Entrega, com seu
  // próprio busy-lock — ver `entregaAcoes`/`confirmarEntrega`).
  const advance = () => {
    const canDeliver = financialProjection?.canDeliver === true;
    const p = status === "pronta"
      ? canDeliver
        ? PRIMARY_ENTREGAR_OS
        : financialProjection?.financialStatus === "OPEN" || financialProjection?.financialStatus === "PARTIAL"
          ? PRIMARY[status]
          : PRIMARY_REVISAR_COBRANCA
      : PRIMARY[status];
    if (!p) return;
    if (status === "aberta") {
      void ctx.iniciarDiagnostico();
      return;
    }
    if (status === "aprovado") {
      void ctx.iniciarServico();
      return;
    }
    if (status === "em_execucao" || status === "aguardando_peca") {
      // "Marcar pronta" / "Peça chegou — retomar" já têm ação real, mas o botão
      // com busy-lock vive na aba Execução (`execAcoes` + marcarPronta/iniciarServico)
      // — aqui só navegamos e avisamos, nunca disparamos a transição direto do header.
      update({ stage: "execucao" });
      notify(EXECUCAO_NA_ABA_EXECUCAO);
      return;
    }
    if (status === "pronta") {
      if (canDeliver) {
        // Quitada (sem saldo pendente confirmado): leva à Entrega, onde vive o
        // botão real de confirmação.
        update({ stage: "entrega" });
        notify(ENTREGA_NA_ABA_ENTREGA);
        return;
      }
      // Saldo pendente — "Receber pagamento" leva ao Financeiro (o recebimento
      // real acontece lá, no card de recebimento; aqui só navegamos + avisamos).
      update({ stage: p.stage });
      notify(
        financialProjection?.financialStatus === "OPEN" || financialProjection?.financialStatus === "PARTIAL"
          ? RECEBIMENTO_NO_FINANCEIRO
          : "Revise a situação financeira antes de entregar.",
      );
      return;
    }
    update({ stage: p.stage });
    notify(PREVIEW_NOOP);
  };
  const setMode = (mode: "recepcao" | "bancada" | "auditoria") => {
    const map = {
      recepcao: [true, true],
      bancada: [false, false],
      auditoria: [false, true],
    } as const;
    const lr = map[mode] || [true, true];
    // Escolher um modo de trabalho sai do Modo foco (as laterais voltam ao layout do modo).
    update({ left: lr[0], right: lr[1], focus: false, module: "workspace", view: "cockpit", menu: null });
    notify("Modo: " + { recepcao: "Recepção", bancada: "Bancada", auditoria: "Auditoria" }[mode]);
  };
  // Modo foco: recolhe rail + as duas gavetas de uma vez (e as reabre ao sair). Só estado visual.
  const toggleFocus = () => {
    update((s) => {
      const f = !s.focus;
      return { focus: f, left: !f, right: !f, menu: null, module: "workspace", view: "cockpit" };
    });
  };

  // ---- rail ----
  const rail = RAIL_DEF.map(([id, label]) => {
    const active =
      id === "workspace"
        ? st.view === "cockpit" && st.module === "workspace"
        : st.view === "cockpit" && st.module === id;
    return {
      id,
      label,
      bg: active ? C.black : "transparent",
      fg: active ? C.white : C.subtle,
      onClick: () => setModule(id === "workspace" ? "workspace" : (id as V4State["module"])),
    };
  });

  // ---- modos ----
  let curMode = "custom";
  if (st.left && st.right) curMode = "recepcao";
  else if (!st.left && !st.right) curMode = "bancada";
  else if (!st.left && st.right) curMode = "auditoria";
  const modeBtns = MODE_DEF.map(([k, label, icon, hint]) => {
    const sel = curMode === k && st.view === "cockpit" && st.module === "workspace";
    return {
      label,
      icon,
      hint,
      onClick: () => setMode(k),
      bg: sel ? C.surface : "transparent",
      fg: sel ? C.primaryHover : C.muted,
      shadow: sel ? "0 1px 2px rgba(17,19,26,.12)" : "none",
    };
  });

  // ---- checklist de entrada (REAL da OS; vazio honesto quando não registrado) ----
  // Exibição somente-leitura do estado real de cada item; nada de tri-estado mock.
  const checklistReal = realOS ? adaptChecklist(realOS) : [];
  const checklist = checklistReal.map((it) => {
    const m =
      it.estado === "ok"
        ? { label: "OK", bg: C.successBg, fg: C.successFg, bd: C.successBd }
        : it.estado === "ruim"
          ? { label: "RUIM", bg: C.dangerBg, fg: C.dangerFg, bd: C.dangerBd }
          : { label: "N/T", bg: C.infoBg, fg: C.infoFg, bd: C.infoBd };
    return {
      id: it.id,
      label: it.label,
      observacao: it.observacao,
      estadoLabel: m.label,
      bg: m.bg,
      fg: m.fg,
      bd: m.bd,
    };
  });
  const check = {
    ok: checklistReal.filter((c) => c.estado === "ok").length,
    ruim: checklistReal.filter((c) => c.estado === "ruim").length,
    nt: checklistReal.filter((c) => c.estado === "nao_testado").length,
  };
  const checklistVazio = checklistReal.length === 0;

  // ---- Entrada: acessórios / fotos / segurança REAIS (vazio honesto) ----
  // Leitura direta da OS real selecionada; quando ausente, listas vazias /
  // segurança sem credencial — nada de valor inventado.
  const entradaAcessorios = realOS ? adaptAcessoriosEntrada(realOS) : [];
  const entradaFotos = realOS ? adaptFotosEntrada(realOS) : [];
  const entradaSeguranca = realOS ? adaptSegurancaEntrada(realOS) : EMPTY_SEGURANCA_ENTRADA;

  // ---- pipeline operacional (5 etapas técnicas) ----
  // Orçamento, Financeiro e Histórico saíram da trilha — vivem no header.
  const hasOpenCharge =
    financialProjection?.financialStatus === "OPEN" || financialProjection?.financialStatus === "PARTIAL";
  const pipeline = PIPELINE_OPERACIONAL_IDS_V4.map((id) => {
    const node = estadoNoPipelineOperacionalV4(id, status, {
      canDeliver: financialProjection?.canDeliver,
      hasOpenCharge,
    });
    const selected = st.stage === id;
    const label = labelPipelineOperacionalV4(id);
    return {
      id,
      label,
      sub: node.alertReason ?? "",
      done: node.done,
      current: node.current,
      pending: node.pending,
      alert: node.alert,
      alertReason: node.alertReason,
      ref: false,
      selected,
      onClick: () => go(id),
      bg: selected ? C.primarySoft : C.surface,
      underline: selected ? C.primary : node.alert ? C.warn : node.current ? C.primaryBd : "transparent",
      labelColor: selected ? C.primaryHover : node.alert ? C.warnFg : node.pending ? C.muted : C.ink,
    };
  });

  // ---- atividade ----
  // GOAL OPS-V4-RIGHT-RAIL-DEDUP-001: o trilho `steps` (cópia do STAGE_DEF que a
  // Atividade renderizava) foi removido — a spine é a única dona das etapas e a
  // lateral virou painel contextual (comunicação, anexos, observações, histórico).

  // ---- histórico real (filtrável) ----
  const hist = st.histFilter === "todos" ? timelineReal : timelineReal.filter((h) => h.type === st.histFilter);
  const histFilters = HIST_FILTER_DEF.map(([k, label]) => {
    const sel = st.histFilter === k;
    return {
      label, onClick: () => update({ histFilter: k }),
      bg: sel ? C.primaryBg : C.surface, fg: sel ? C.primaryHover : C.muted, bd: sel ? C.primaryBd : C.inputBd,
    };
  });

  // Barra de busca do topo E "Trocar OS": levam ao seletor de OS real (limpa a
  // seleção; nunca auto-abre outra OS por fallback). Definido antes dos menus
  // porque "Trocar OS" reusa este fluxo real (GOAL 006 — fim do no-op).
  const goToOSSearch = () =>
    update({ selectedOsId: null, focus: false, left: true, module: "workspace", view: "cockpit", menu: null });

  // ---- menus ----
  // GOAL OPS-V4-DOCUMENTOS-ASSINATURA-ANEXOS-015: o menu Docs abre o MESMO
  // modal V3 (`PrintPreviewV3`) para todos os tipos com motor real. Portal do
  // cliente continua fora — não há contrato de leitura/envio.
  const openDocPrint = (tipo: DocumentoTipoV3) => update({ docPrint: tipo, menu: null });
  // GOAL 023: "Orçamento (via cliente)" só aparece no menu com orçamento REAL
  // materializado (`estado === "persistido"`) — prévia/ausente não têm o que
  // mostrar; empty honesto = item nem aparece (mesmo padrão de gating do resto
  // da V4, nunca um item habilitado que abriria um documento vazio).
  const printItems = [
    { icon: "📄", label: "Imprimir OS (cliente)", onClick: () => openDocPrint("os_cliente") },
    { icon: "🛡", label: "Termo de Garantia", onClick: () => openDocPrint("termo_garantia") },
    { icon: "📦", label: "Termo de Entrega", onClick: () => openDocPrint("termo_entrega") },
    ...(orcamentoReal.estado === "persistido"
      ? [{ icon: "🧾", label: "Orçamento (via cliente)", onClick: () => openDocPrint("orcamento_cliente") }]
      : []),
    { icon: "🔒", label: "Via Interna", onClick: () => openDocPrint("comprovante_interno") },
    { icon: "🏷", label: "Etiqueta", onClick: () => openDocPrint("etiqueta") },
  ];
  const moreItems: Array<{ icon: string; label: string; color: string; onClick: () => void }> = [
    // "Editar OS" leva à aba Entrada real (edição dos grupos seguros) — não é mais no-op.
    { icon: "✏", label: "Editar OS (Entrada)", color: C.body, onClick: () => go("entrada") },
    // "Trocar OS" usa o fluxo real de busca: limpa a seleção e abre o seletor.
    { icon: "⇄", label: "Trocar OS", color: C.body, onClick: goToOSSearch },
  ];
  // OPS-V4-ACTIONS-RECONCILE-010: "Aguardando peça"/"retomar" já têm ação real na
  // aba Execução (`execAcoes` + marcarAguardandoPeca/iniciarServico) — o menu só
  // NAVEGA até lá (mesmo padrão de "Editar OS (Entrada)" acima), nunca finge um
  // no-op. "Cancelar OS" deixou de ser no-op (GOAL OPS-V4-CANCELAR-OS-CONNECT-021):
  // abre o modal real, que reaproveita o mesmo veredito da máquina única
  // (`v.cancelamento`, computado abaixo) para explicar bloqueio por status ou
  // pagamento — a visibilidade aqui usa a mesma dupla de status finais (entregue/
  // cancelada) que a máquina única já bloquearia de qualquer forma.
  if (status === "em_execucao" || status === "aprovado")
    moreItems.push({ icon: "⏸", label: "Marcar “Aguardando peça”", color: C.body, onClick: () => go("execucao") });
  if (status === "aguardando_peca")
    moreItems.push({ icon: "▶", label: "Peça chegou — retomar", color: C.body, onClick: () => go("execucao") });
  if (status !== "entregue" && status !== "cancelada")
    moreItems.push({ icon: "✕", label: "Cancelar OS", color: C.danger, onClick: () => update({ cancelamentoOS: true }) });

  // ---- módulos (rail) — metadados; Fila e Bancada são operacionais, demais rails RO ----
  const mod = MODULE_META[st.module] || MODULE_META.dashboard;

  // ---- auditoria ----
  const resolved = RESOLVED_RAW.map((r, i) => ({
    feat: r[0], detail: r[1], status: "✓", bg: i % 2 ? C.surface2 : C.surface,
  }));

  // ---- Nova OS ----
  // O formulário da Nova OS vive LOCALMENTE no `NovaOSModal` (decisão de design A) e
  // chama `criarOSEnterpriseV3` direto. Aqui só expomos abrir/fechar o modal e o
  // callback de sucesso `onOSCriada` (abaixo), que seleciona a OS criada e recarrega a lista.

  // ---- orçamento REAL da OS (view read-only) + estado de edição (slice 002) ----
  // A view read-only segue mostrando persistido/prévia/ausente. As flags abaixo
  // habilitam o EDITOR real: materializado = orçamento real (não sintetizado);
  // editável/decidível = materializado E status rascunho|enviado (mesma regra das
  // actions `salvarOrcamentoV3`/`aprovar`/`recusar`). O seed alimenta o editor V4.
  // (`orcamentoReal` já foi calculado acima, antes do menu Docs.)
  const orcRaw = (realOS as { orcamento?: Orcamento } | null)?.orcamento ?? null;
  const orcamentoMaterializado = !!orcRaw && orcRaw.sintetizado !== true;
  const orcStatusRaw = orcRaw?.status;
  const orcamentoEditavel = orcamentoMaterializado && (orcStatusRaw === "rascunho" || orcStatusRaw === "enviado");
  const orcamentoPodeDecidir = orcamentoEditavel;
  const orcamentoEditorSeed = seedEditorFromOS(realOS);
  const comercialHeader = montarComercialHeaderV4({
    estado: orcamentoReal.estado,
    status: orcStatusRaw,
    total: typeof orcRaw?.total === "number" ? orcRaw.total : financialProjection?.approvedBudgetTotal,
  });
  const financeiroResumo = montarResumoFinanceiroOSV4({
    loading: ctx.financialProjection.loading,
    error: ctx.financialProjection.error,
    projection: financialProjection,
    caixaAberto: !!ctx.pdvServico.sessao?.aberta,
  });
  const financeiroHeader = montarFinanceiroHeaderV4({
    loading: ctx.financialProjection.loading,
    error: ctx.financialProjection.error,
    financialStatus: financialProjection?.financialStatus,
    expectedTotal: financialProjection?.expectedTotal,
    receivedTotal: financialProjection?.receivedTotal,
    balance: financialProjection?.balance,
  });
  const historicoHeader = montarHistoricoHeaderV4(timelineReal.length);

  // ---- Execução (slice OPS-V4-EXECUCAO-REAL-007): ações habilitadas SÓ quando a
  // máquina única (`podeTransicionarV3`) permite a partir do status real atual —
  // mesma regra que o servidor aplica em `aplicarTransicaoStatusV3`. Sem OS real
  // selecionada, nenhuma ação fica disponível (nada de status fabricado).
  const execAcoes = {
    podeIniciar: !!realOS && podeTransicionarV3(status, "em_execucao").ok,
    iniciarLabel: status === "aguardando_peca" ? "Retomar execução" : "Iniciar execução",
    podeAguardarPeca: !!realOS && podeTransicionarV3(status, "aguardando_peca").ok,
    podePronta: !!realOS && podeTransicionarV3(status, "pronta").ok,
  };

  // ---- PDV de Serviço / recebimento real (slice PDV-SERVICO-OS-RECEBIMENTO-REAL-001) ----
  // Total, recebido, saldo e consistência vêm exclusivamente da projeção server-side.
  // O hook do PDV fornece somente a sessão de caixa e as mutações já existentes.
  const pdvCaixaAberto = !!ctx.pdvServico.sessao?.aberta;
  const semTotal = !!financialProjection && financialProjection.expectedTotal === 0;
  // OPS-V4-RECEBIMENTO-PREVIA-HONESTY-002: o card de Faturamento mostra `financeiroReal.temTotal`
  // (aceita orçamento sintetizado pela hidratação — prévia, não materializado; ver
  // `orcamentoMaterializado` acima). Quando esse total visível é > 0 mas a projeção
  // não reconhece valor cobrável (`semTotal`), a causa é sempre a mesma: falta
  // materializar/aprovar o orçamento — nunca "a OS não tem valor". Sem essa distinção,
  // a tela contradiz a si mesma (Total R$ X + "não tem valor a cobrar"). Não muda o
  // gate real (`podeReceber` continua exigindo projeção consistente, ou seja, nunca
  // habilita recebimento sobre prévia) — só corrige a mensagem.
  const previaNaoMaterializada = financialProjection?.financialStatus === "PRICE_DEFINED";
  const recebimento = {
    semTotal,
    previaNaoMaterializada,
    quitado: financialProjection?.financialStatus === "PAID",
    caixaAberto: pdvCaixaAberto,
    podeReceber: financialProjection?.canReceive === true && pdvCaixaAberto,
    indisponivel: !financialProjection || financialProjection.financialStatus === "UNKNOWN" || financialProjection.financialStatus === "INCONSISTENT",
  };

  // ---- Estorno de recebimento (slice OPS-V4-RECEBIMENTO-ESTORNO-016) ----
  // Mesma projeção financeira do recebimento, combinada apenas com a sessão de caixa.
  // `estornarRecebimentoOSV3` (V3) exige `titulo.recebido > 0` E caixa aberto —
  // `temRecebido` espelha a primeira condição; `podeEstornar` as duas juntas.
  const estorno = {
    temRecebido: (financialProjection?.receivedTotal ?? 0) > 0,
    caixaAberto: pdvCaixaAberto,
    podeEstornar: (financialProjection?.receivedTotal ?? 0) > 0 && pdvCaixaAberto,
  };

  // ---- Cancelamento de OS (slice OPS-V4-CANCELAR-OS-CONNECT-021) ----
  // `statusPermite` reaproveita a MESMA máquina única que já governa `execAcoes`
  // (`podeTransicionarV3`, pura, importada da V3) — nunca inventa status; bloqueia
  // sozinha entregue/cancelada (estados finais). `statusMotivoBloqueio` guarda o
  // motivo exato que o servidor usaria, para a UI mostrar a mesma mensagem sem
  // duplicar texto. `semPagamento` exige recebido conhecido pela projeção — mesma
  // regra que a V3 já aplica
  // (bloqueia cancelamento com QUALQUER valor recebido, total ou parcial).
  const cancelamentoVeredito = podeTransicionarV3(status, "cancelada");
  const semPagamentoConhecido = financialProjection?.receivedTotal != null && financialProjection.receivedTotal <= 0;
  const cancelamento = {
    statusPermite: !!realOS && cancelamentoVeredito.ok,
    statusMotivoBloqueio: cancelamentoVeredito.motivo,
    semPagamento: semPagamentoConhecido,
    podeCancelar: !!realOS && cancelamentoVeredito.ok && semPagamentoConhecido,
  };

  // ---- Entrega (GOAL OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008) ----
  // Só libera "Confirmar entrega" quando a OS está "pronta" (view V4 — nunca
  // mostra "recebida": ver `projetarStatusV2`) E o pagamento confirma saldo<=0.
  // NÃO usamos `podeTransicionarV3(status, "entregue")` aqui: o grafo puro da V3
  // só liga pronta→recebida→entregue em 2 passos, mas `aplicarTransicaoStatusV3`
  // trata "entregue" como caso especial (delega a `registrarEntregaV3`, que aceita
  // "pronta" OU "recebida" direto) — usar o grafo genérico bloquearia o botão
  // incorretamente para uma OS "pronta" de verdade. Sem caixa envolvido (a
  // condição é só o saldo, igual à regra pedida — "bloquear se saldo > 0").
  //
  // GOAL OPS-V4-ENTREGA-GUARD-SEM-COBRANCA-002: `saldo <= 0` sozinho é ambíguo —
  // casa tanto a OS realmente quitada (total>0) quanto a OS SEM cobrança lançada
  // (total<=0, ex.: orçamento nunca materializado). Antes as duas caíam em "pode
  // entregar", deixando uma OS sem cobrança ser entregue em silêncio (o buraco da
  // auditoria). Agora as três situações são distintas e a entrega sem cobrança exige
  // classificação + justificativa enviadas à action canônica, que deriva ator/horário,
  // persiste a autorização e decide novamente no servidor.
  // Tudo derivado da mesma projeção server-side; sem projeção nada se decide
  // (anti-flicker). `semSaldoPendenteEntrega` (quitada OU autorizada) segue
  // alimentando só o CTA global (`prim`), que apenas NAVEGA à aba Entrega — o guard
  // real mora lá.
  const semSaldoPendenteEntrega = financialProjection?.canDeliver === true;
  const cobrancaAusente = financialProjection?.deliveryDecision === "BLOCK_NO_CHARGE_AUTH_REQUIRED";
  const saldoPendenteConfirmado =
    financialProjection?.financialStatus === "OPEN" || financialProjection?.financialStatus === "PARTIAL";
  // ---- "A prazo" (GOAL OPS-V4-RECEBIMENTO-A-PRAZO-MINIMO-006) ----
  // A autorização a prazo já foi validada pelo núcleo compartilhado do guard.
  // Se a OS for quitada depois, a projeção deixa de retornar AUTHORIZED_CREDIT.
  const aPrazoAutorizado = financialProjection?.financialStatus === "AUTHORIZED_CREDIT";
  const leituraFinanceiraBloqueada =
    !!realOS && status === "pronta" && (
      ctx.financialProjection.loading ||
      !!ctx.financialProjection.error ||
      !financialProjection ||
      financialProjection.financialStatus === "UNKNOWN" ||
      financialProjection.financialStatus === "INCONSISTENT" ||
      financialProjection.financialStatus === "CHARGE_NOT_CREATED" ||
      financialProjection.financialStatus === "CANCELLED" ||
      financialProjection.financialStatus === "REVERSED"
    );
  const entregaAcoes = {
    // Confirmação DIRETA (sem passo extra) só na OS quitada de verdade (total>0,
    // saldo<=0) ou já autorizada a prazo. OS sem cobrança NÃO entra aqui — segue
    // pelo fluxo de cortesia (`semCobrancaLancada`), que exige "Entregar sem
    // cobrança" explícito na UI antes de liberar a confirmação real.
    podeConfirmar: !!realOS && status === "pronta" && financialProjection?.canDeliver === true,
    bloqueadaPorSaldo: !!realOS && status === "pronta" && saldoPendenteConfirmado && !aPrazoAutorizado,
    autorizadaAPrazo: !!realOS && status === "pronta" && aPrazoAutorizado,
    autorizadaSemCobranca: !!realOS && status === "pronta" && financialProjection?.financialStatus === "AUTHORIZED_NO_CHARGE",
    // total<=0 (nenhuma cobrança lançada): a entrega só acontece após confirmação
    // explícita de cortesia na UI — nunca em silêncio.
    semCobrancaLancada: !!realOS && status === "pronta" && cobrancaAusente,
    leituraFinanceiraBloqueada,
    financeiroCarregando: leituraFinanceiraBloqueada && ctx.financialProjection.loading,
    financeiroErro: leituraFinanceiraBloqueada ? ctx.financialProjection.error : null,
    financeiroMotivo: financialProjection?.consistencyIssues[0] ?? null,
    saldoPendente: saldoPendenteConfirmado ? financialProjection?.balance ?? null : null,
  };

  // ---- Entrada/Recepção (slice 003): seed do editor a partir da OS real ----
  const entradaEditorSeed: EntradaEditorV4 = seedEntradaEditor(realOS);
  // ---- Dados básicos da OS (slice 003B): seed do editor a partir da OS real ----
  const dadosBasicosSeed: DadosBasicosEditorV4 = seedDadosBasicos(realOS);

  // ---- telas de rail (Visão geral / Fila / Bancada / SLA / PDV) ----
  // View-models READ-ONLY derivados da MESMA lista de OS reais já carregada
  // (`ctx.ordens`). Cada builder sinaliza `temDados` para a UI escolher entre dado
  // real e empty state honesto específico do módulo. Sem número/técnico/SLA fabricado.
  const dashboardResumo = buildDashboardResumo(ctx.ordens);
  const filaItens = buildFilaItens(ctx.ordens);
  const filaOperacional = buildFilaOperacionalV4(ctx.ordens);
  const bancadaView = buildBancadaView(ctx.ordens);
  const producaoBancada = buildProducaoBancadaV4(ctx.ordens);
  const producaoAtual = ctx.realOS ? projetarOsProducaoV4(ctx.realOS) : null;
  const slaView = buildSlaView(ctx.ordens);
  const pdvView = buildPdvView(ctx.ordens, ctx.financialProjectionsByOsId);

  // Seleciona a OS REAL (identidade/financeiro reais no workspace). Único caminho de
  // seleção — sempre por clique explícito do operador, nunca por fallback automático.
  const selectOS = (o: OrdemServico, stageOverride?: V4Stage) => {
    update({
      selectedOsId: o.id,
      status: resolverStatusV4(o),
      prioridade: realPrioridadeToV4(o.prioridade),
      stage: stageOverride ?? stageForStatus(resolverStatusV4(o)),
      module: "workspace",
      view: "cockpit",
      menu: null,
      focus: true,
      left: false,
      right: false,
    });
    notify("OS " + (o.codigo || "") + " carregada");
  };
  /**
   * Abrir a OS de uma linha de rail (Fila/Bancada/SLA/PDV) → leva ao workspace real.
   *
   * GOAL OPS-V4-PDV-SERVICO-FINANCEIRO-SHORTCUT-005: quando a origem é o rail
   * "PDV de serviço" (`fromPdv`) e a projeção server-side tem saldo real aberto,
   * abre direto na aba
   * Financeiro em vez do `stageForStatus` genérico (que levaria "pronta" para
   * Entrega, escondendo o recebimento). Quitada/prévia/sem cobrança seguem o
   * stage normal — só existe atalho quando há saldo de verdade a receber.
   */
  const openOSFromRail = (id: string, fromPdv = false, stageOverride?: V4Stage) => {
    const o = ctx.ordens.find((x) => x.id === id);
    if (!o) return;
    const projection = ctx.financialProjectionsByOsId.get(o.id);
    const temSaldoAberto = fromPdv && (projection?.financialStatus === "OPEN" || projection?.financialStatus === "PARTIAL");
    selectOS(o, stageOverride ?? (temSaldoAberto ? "financeiro" : undefined));
  };

  // Nova OS criada (REAL) pelo modal → fecha o modal, abre a OS recém-criada no workspace
  // e recarrega a lista. Recebe apenas o id resultante; a identidade/financeiro são
  // hidratados pelo detalhe (`useOrdemV4`). Uma OS nova nasce "aberta" → etapa "entrada".
  const onOSCriada = (osId: string) => {
    update({
      novaOS: false,
      novoAtendimento: false,
      selectedOsId: osId,
      status: "aberta",
      stage: "entrada",
      module: "workspace",
      view: "cockpit",
      menu: null,
      focus: true,
      left: false,
      right: false,
    });
    ctx.reloadOrdens();
    notify("OS criada e aberta no workspace.");
  };

  // Atendimento rápido concluído (REAL, GOAL OPS-V4-ATENDIMENTO-RAPIDO-CONNECT-014)
  // pelo modal → fecha o modal, abre a OS já finalizada no workspace e recarrega a
  // lista. `finalizarAtendimentoRapidoV3` (V3) cria + orça + aprova + recebe + entrega
  // em um único passo — por isso o snapshot local aponta direto "entregue"/"entrega"
  // (nunca "aberta"), evitando o flicker de mostrar a OS como recém-aberta até o
  // detalhe real (`realOS`) carregar e sobrescrever o snapshot.
  const onAtendimentoRapidoConcluido = (osId: string) => {
    update({
      atendimentoRapido: false,
      novoAtendimento: false,
      selectedOsId: osId,
      status: "entregue",
      stage: "entrega",
      module: "workspace",
      view: "cockpit",
      menu: null,
      focus: true,
      left: false,
      right: false,
    });
    ctx.reloadOrdens();
    notify("Atendimento rápido concluído — OS criada, recebida e entregue.");
  };

  // Orçamento Rápido criado (REAL, GOAL OPS-V4-ORC-RAPIDO-024) pelo modal → fecha
  // o modal, abre a OS no workspace já na aba Orçamento (o rascunho multiopção já
  // está lá) e recarrega a lista. A OS nasce "aberta" — SEM transição de status
  // manual (o envio, em 025, é quem move para "aguardando_aprovacao").
  const onOrcamentoRapidoCriado = (osId: string) => {
    update({
      orcamentoRapido: false,
      novoAtendimento: false,
      selectedOsId: osId,
      status: "aberta",
      stage: "orcamento",
      module: "workspace",
      view: "cockpit",
      menu: null,
      focus: true,
      left: false,
      right: false,
    });
    ctx.reloadOrdens();
    notify("Orçamento rápido criado — OS aberta com orçamento em rascunho.");
  };

  const prim = status === "pronta"
    ? semSaldoPendenteEntrega
      ? PRIMARY_ENTREGAR_OS
      : financialProjection?.financialStatus === "OPEN" || financialProjection?.financialStatus === "PARTIAL"
        ? PRIMARY[status]
        : PRIMARY_REVISAR_COBRANCA
    : PRIMARY[status];
  const tone = TONE[status] || TONE.em_execucao;
  const prioM = PRIO[st.prioridade];

  // ---- handlers "visuais" (não persistem nada → toast honesto de Preview) ----
  // "pdv" (Receber no PDV) saiu daqui: o recebimento é real agora (ver
  // `v.pdvServico` + `ReceberPagamentoV4`, no stage Financeiro).
  const act = {
    addFoto: () => {
      if (status === "pronta" || status === "entregue") go("entrega");
      else go("entrada");
    },
    whatsapp: () => {
      if (!realOS) {
        notify("Selecione uma OS para enviar atualização.");
        return;
      }
      const link = montarLinkWaV4(
        realOS.cliente?.telefone || realOS.cliente?.whatsapp,
        montarMensagemAtualizacaoOSV4(realOS),
      );
      if (!link.valido) {
        notify(link.motivo);
        return;
      }
      window.open(link.url, "_blank", "noopener,noreferrer");
    },
    ligar: () => notify(PREVIEW_NOOP),
    novaObs: () => notify(PREVIEW_NOOP),
    exportHist: () => notify(PREVIEW_NOOP),
  };

  // ---- Segurança/autorização (PREVIEW) ----------------------------------------
  // Superfície 100% visual: PIN 4/6, padrão 3×3, senha/motivo e estados da
  // autorização. NADA autentica, NADA persiste, NÃO altera permissões reais —
  // apenas demonstra os componentes. A interação local serve só à demonstração.
  const SEG_PREVIEW = "Segurança é apenas demonstração na Preview — nada é autenticado nem salvo.";
  const mkPin = (n: number, filled: number) =>
    Array.from({ length: n }, (_, i) => {
      const on = i < filled;
      return {
        v: on ? "•" : "",
        bd: on ? C.primaryBd : C.inputBd,
        bg: on ? C.primarySoft : C.surface2,
      };
    });
  const pin4 = mkPin(4, st.pin4);
  const pin6 = mkPin(6, st.pin6);
  const patternSel = st.pattern;
  const patternCells = Array.from({ length: 9 }, (_, i) => {
    const pos = patternSel.indexOf(i);
    const on = pos >= 0;
    return {
      key: i,
      n: on ? String(pos + 1) : "",
      bd: on ? C.primary : C.inputBd,
      bg: on ? C.primary : "transparent",
      onClick: () =>
        update((s) => {
          const a = s.pattern.slice();
          const x = a.indexOf(i);
          if (x >= 0) a.splice(x, 1);
          else a.push(i);
          return { pattern: a };
        }),
    };
  });
  const patternHint = patternSel.length
    ? "sequência: " + patternSel.map((i) => i + 1).join(" → ")
    : "toque os pontos para desenhar";
  const AUTH_DEFS = [
    { key: "autorizado", label: "Autorizado", glyph: "✓", color: C.success, fg: C.successFg, bd: C.successBd, wash: C.successBg2 },
    { key: "negado", label: "Negado", glyph: "✕", color: C.danger, fg: C.dangerFg, bd: C.dangerBd, wash: C.dangerBg },
    { key: "expirado", label: "Expirado", glyph: "⏱", color: C.warn, fg: C.warnFg, bd: C.warnBd, wash: C.warnBg },
  ] as const;
  const authStates = AUTH_DEFS.map((d) => ({
    ...d,
    active: d.key === st.authState,
    opacity: d.key === st.authState ? 1 : 0.5,
    ring: d.key === st.authState ? `0 0 0 2px ${d.color}` : "none",
    onClick: () => update({ authState: d.key }),
  }));
  const curAuth = AUTH_DEFS.find((d) => d.key === st.authState) ?? AUTH_DEFS[0];
  const seg = {
    pin4,
    pin6,
    onPin4: () => update((s) => ({ pin4: (s.pin4 + 1) % 5 })),
    onPin6: () => update((s) => ({ pin6: (s.pin6 + 1) % 7 })),
    pattern: patternCells,
    patternHint,
    authStates,
    authLabel: curAuth.label,
    authColor: curAuth.color,
    authFg: curAuth.fg,
    senha: st.senha,
    motivo: st.motivo,
    onSenha: (val: string) => update({ senha: val }),
    onMotivo: (val: string) => update({ motivo: val }),
    onAutorizar: () => notify(SEG_PREVIEW),
    audit: [
      { dot: C.success, text: "Autorização concedida · alterar status crítico", meta: "preview" },
      { dot: C.danger, text: "Autorização negada · aprovar desconto", meta: "preview" },
      { dot: C.warn, text: "Sessão de autorização expirada", meta: "preview" },
    ],
  };

  return {
    view: st.view,
    isAuditoria: st.view === "auditoria",
    isWorkspace: st.view === "cockpit" && st.module === "workspace",
    isModule: st.view === "cockpit" && st.module !== "workspace",
    goCockpit: () => setModule("workspace"),
    goAuditoria: () => setView("auditoria"),
    railWorkspace: () => setModule("workspace"),
    railFila: () => setModule("fila"),
    railSettings: () => notify(PREVIEW_NOOP),

    rail, modeBtns,
    mod,

    stage: st.stage, pipeline,
    isEntrada: st.stage === "entrada", isDiag: st.stage === "diagnostico", isOrc: st.stage === "orcamento",
    isExec: st.stage === "execucao", isFin: st.stage === "financeiro", isEntrega: st.stage === "entrega",
    isPos: st.stage === "posvenda", isHist: st.stage === "historico",
    isSeg: st.stage === "seguranca",

    leftOpen: st.left, leftClosed: !st.left, rightOpen: st.right, rightClosed: !st.right,
    toggleLeft: () => update((s) => ({ left: !s.left })),
    // Toggle explícito da lateral "Atividade" persiste a escolha do usuário
    // (GOAL OPS-V4-RIGHT-RAIL-DEDUP-001). Fora do updater do setState — ele
    // precisa ser puro (StrictMode pode executá-lo 2×).
    toggleRight: () => {
      const right = !st.right;
      persistRightRailPref(right);
      update({ right });
    },
    // "Trocar OS" (coluna de contexto) usa o fluxo real de busca/seleção.
    onTrocar: goToOSSearch,
    toHistCliente: () => notify(PREVIEW_NOOP),

    // ---- Modo foco (recolhe rail + gavetas; só visual) ----
    focusActive: st.focus && !!st.selectedOsId,
    focoLabel: st.focus && st.selectedOsId ? "Sair do foco" : "Modo foco",
    onFoco: toggleFocus,

    // ---- Segurança (preview) ----
    seg,
    goSeguranca: () => update({ stage: "seguranca", module: "workspace", view: "cockpit", menu: null }),
    // GOAL OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008: usado pelo aviso "quitada, falta
    // entregar" do FinanceiroStage — só navega (a ação real vive no botão da Entrega).
    goEntrega: () => update({ stage: "entrega", module: "workspace", view: "cockpit", menu: null }),
    // GOAL OPS-V4-PDV-SERVICO-FINANCEIRO-SHORTCUT-005: usado pelo bloqueio "saldo em
    // aberto" da Entrega — só navega (o recebimento real vive no botão do Financeiro).
    goFinanceiro: () => update({ stage: "financeiro", module: "workspace", view: "cockpit", menu: null }),
    openReceberPagamento: () => update({ stage: "financeiro", receberPagamento: true, module: "workspace", view: "cockpit", menu: null }),
    closeReceberPagamento: () => update({ receberPagamento: false }),
    receberPagamentoOpen: st.receberPagamento,
    // GOAL OPS-V4-ENTREGA-GUARD-SEM-COBRANCA-002: usado pelo alerta "OS sem cobrança"
    // da Entrega — leva o operador a lançar o orçamento antes de entregar (só navega).
    goOrcamento: () => update({ stage: "orcamento", module: "workspace", view: "cockpit", menu: null }),
    goHistorico: () => update({ stage: "historico", module: "workspace", view: "cockpit", menu: null }),
    openHeaderDestino: (destino: "orcamento" | "financeiro" | "historico" | "posvenda") =>
      update({ stage: destino, module: "workspace", view: "cockpit", menu: null }),
    comercialHeader,
    financeiroHeader,
    financeiroResumo,
    historicoHeader,
    backFromSeguranca: () => update({ stage: "execucao", module: "workspace", view: "cockpit", menu: null }),

    menu: st.menu, menuPrint: st.menu === "print", menuMore: st.menu === "more",
    togglePrint: () => toggleMenu("print"), toggleMore: () => toggleMenu("more"),
    closeMenus: () => update({ menu: null }),
    printItems, moreItems,

    statusLabel: STATUS_LABEL[status], tone,
    primaryLabel: prim ? prim.label : "Concluído", hasPrimary: !!prim, noPrimary: !prim,
    onPrimary: () => advance(), showKbd: true,

    prio: { label: prioM.label, fg: prioM.fg, dot: prioM.dot },
    checklist, check, checklistVazio,
    entradaAcessorios, entradaFotos, entradaSeguranca,
    posVenda: posVendaReal,
    garantiasPortfolio,
    financial: {
      projection: financialProjection,
      loading: ctx.financialProjection.loading,
      error: ctx.financialProjection.error,
      reload: ctx.financialProjection.reload,
      statusLabel: financialStatusLabel,
      paymentMethodSummary,
    },
    hist, histCount: hist.length, histFilters, anexos: anexosReais, observacoes: observacoesReais,
    resolved, pending: PENDING, act,

    openNovaOS: () => update({ novaOS: true, novoAtendimento: false }),
    closeNovaOS: () => update({ novaOS: false }),
    novaOSOpen: st.novaOS,
    // ---- + Novo (GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001) ----
    // Entrada única. Não persiste: só escolhe qual dos três motores reais abre.
    // Duplicar orçamento continua em `abrirOrcamentoRapidoComPrefill` (sem launcher).
    openNovoAtendimento: () => update(patchAbrirLauncherNovoAtendimentoV4()),
    closeNovoAtendimento: () => update({ novoAtendimento: false }),
    novoAtendimentoOpen: st.novoAtendimento,
    escolherNovoAtendimento: (id: NovoAtendimentoModalidadeV4) => {
      if (id === "orcamento") ctx.definirOrcamentoRapidoPrefill(null);
      update(patchEscolherNovoAtendimentoV4(id));
    },
    // Nova OS real: o modal coleta o formulário localmente, cria via `criarOSEnterpriseV3`
    // e chama `onOSCriada(osId)` no sucesso (fecha modal + abre a OS criada + recarrega).
    onOSCriada,

    // ---- Atendimento rápido REAL (GOAL OPS-V4-ATENDIMENTO-RAPIDO-CONNECT-014) ----
    // O modal coleta o formulário localmente e chama `finalizarAtendimentoRapidoV3`
    // direto (mesmo padrão do Nova OS acima) — sem motor novo. `onAtendimentoRapidoConcluido`
    // fecha o modal, abre a OS já finalizada no workspace e recarrega a lista.
    openAtendimentoRapido: () => update({ atendimentoRapido: true, novoAtendimento: false }),
    closeAtendimentoRapido: () => update({ atendimentoRapido: false }),
    atendimentoRapidoOpen: st.atendimentoRapido,
    onAtendimentoRapidoConcluido,

    // ---- ⚡ Orçamento Rápido REAL (GOAL OPS-V4-ORC-RAPIDO-024) ----
    // O modal coleta o formulário localmente e chama `criarOrcamentoRapidoV3`
    // direto (mesmo padrão do Nova OS/Atendimento Rápido) — sem motor novo. A OS
    // nasce mínima com o orçamento multiopção já em rascunho; `onOrcamentoRapidoCriado`
    // fecha o modal, abre a OS no workspace (aba Orçamento) e recarrega a lista.
    // Abrir "do zero" (via launcher `+ Novo` → Novo Orçamento) limpa qualquer
    // prefill anterior — nunca herda dados de uma duplicação prévia por engano.
    openOrcamentoRapido: () => {
      ctx.definirOrcamentoRapidoPrefill(null);
      update({ orcamentoRapido: true, novoAtendimento: false });
    },
    closeOrcamentoRapido: () => {
      update({ orcamentoRapido: false });
      ctx.definirOrcamentoRapidoPrefill(null);
    },
    orcamentoRapidoOpen: st.orcamentoRapido,
    orcamentoRapidoInitialValues: ctx.orcamentoRapidoPrefill,
    // "Duplicar orçamento" (GOAL 025): o OrcamentoStage monta o prefill (visão
    // INTERNA — inclui custo) e chama isto para abrir a modal já preenchida.
    abrirOrcamentoRapidoComPrefill: (values: OrcamentoRapidoFormV4) => {
      ctx.definirOrcamentoRapidoPrefill(values);
      update({ orcamentoRapido: true, novoAtendimento: false });
    },
    onOrcamentoRapidoCriado,

    // ---- Estorno de recebimento REAL (GOAL OPS-V4-RECEBIMENTO-ESTORNO-016) ----
    // Modal só abre atrás de ação explícita (botão na aba Financeiro, já gated por
    // `v.estorno.podeEstornar`); a escrita real é `v.pdvServico.estornar` (acima).
    openEstornoRecebimento: () => update({ estornoRecebimento: true }),
    closeEstornoRecebimento: () => update({ estornoRecebimento: false }),
    estornoRecebimentoOpen: st.estornoRecebimento,

    // ---- Cancelamento de OS REAL (GOAL OPS-V4-CANCELAR-OS-CONNECT-021) ----
    // Modal só abre atrás de ação explícita (menu "Mais ações"); a escrita real é
    // `cancelarOS` (acima, via runWrite → aplicarTransicaoStatusV3 já blindada).
    // `cancelamento` é o gating pré-computado (mesma máquina única + mesma leitura
    // de pagamento que já alimentam execAcoes/estorno — nunca um novo read).
    openCancelamentoOS: () => {
      ctx.definirCancelamentoMotivoPrefill(null);
      update({ cancelamentoOS: true });
    },
    closeCancelamentoOS: () => {
      update({ cancelamentoOS: false });
      ctx.definirCancelamentoMotivoPrefill(null);
    },
    cancelamentoOSOpen: st.cancelamentoOS,
    cancelamentoMotivoPrefill: ctx.cancelamentoMotivoPrefill,
    // GOAL 026: link honesto pós-recusa — abre o MESMO modal já com um motivo
    // sugerido (o operador confirma/edita antes de cancelar de verdade).
    abrirCancelamentoComMotivo: (motivo: string) => {
      ctx.definirCancelamentoMotivoPrefill(motivo);
      update({ cancelamentoOS: true });
    },
    cancelamento,
    cancelarOS: ctx.cancelarOS,

    openRecibo: () => update({ recibo: true }), closeRecibo: () => update({ recibo: false }), reciboOpen: st.recibo,

    diag: diagnosticoReal, execucao: execucaoReal, orcamento: orcamentoReal, entrega: entregaReal,
    os: osView,

    // ---- Execução REAL (slice OPS-V4-EXECUCAO-REAL-007) ----
    // Transições reais via `aplicarTransicaoStatusV3` (reuso, sem editar V3).
    // "iniciarServico" é o MESMO handler usado pelo avanço aprovado→em_execucao
    // (ação primária); aqui também serve a aguardando_peca→em_execucao ("retomar") —
    // o rótulo certo vem de `execAcoes.iniciarLabel`. Peças/estoque/observação
    // técnica seguem read-only (sem action V3 segura para isso ainda).
    iniciarServico: ctx.iniciarServico,
    marcarAguardandoPeca: ctx.marcarAguardandoPeca,
    marcarPronta: ctx.marcarPronta,
    execAcoes,

    // ---- Entrega REAL (GOAL OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008) ----
    // `confirmarEntrega` reusa `aplicarTransicaoStatusV3(sid, osId, "entregue")`
    // (mesmo `runWrite`); `entregaAcoes` é o gating pré-computado (mesma regra do
    // saldo usada pelo CTA global e pelo aviso do Financeiro).
    confirmarEntrega: ctx.confirmarEntrega,
    entregaAcoes,

    // ---- Assinatura de retirada + documentos reais (GOAL OPS-V4-DOCS-
    // ASSINATURA-TERMOS-ANEXOS-012) ----
    // `salvarAssinaturaRetirada` reusa `salvarAssinaturaRetiradaV3` (mesmo canvas
    // `SignaturePadV3` da V3); `docPrintTipo`/`closeDocPrint` controlam o modal de
    // impressão real (`DocPrintModal` → `PrintPreviewV3`, sem motor novo).
    salvarAssinaturaRetirada: ctx.salvarAssinaturaRetirada,
    adicionarFotoSaida: ctx.adicionarFotoSaida,
    removerFotoSaida: ctx.removerFotoSaida,
    docPrintTipo: st.docPrint as DocumentoTipoV3 | null,
    closeDocPrint: () => update({ docPrint: null }),
    registrarImpressaoDoc: ctx.registrarImpressaoDoc,
    // ---- Garantia da OS (GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014) ----
    // `salvarGarantia` reusa `salvarGarantiaOSV3` (mesmo contrato da V3, mesmo
    // campo `aberturaV3.garantiaPrevista`); consumido pelo form do EntregaStage.
    salvarGarantia: ctx.salvarGarantia,
    abrirRetorno: ctx.abrirRetorno,
    finalizarRetorno: ctx.finalizarRetorno,
    abrirOsVinculada: ctx.abrirOsVinculada,
    realOS,

    // ---- PDV de Serviço / recebimento real (slice PDV-SERVICO-OS-RECEBIMENTO-REAL-001) ----
    // Sessão de caixa/recibo e ações do motor V3; totais vêm da projeção server-side.
    // `recebimento` é o gating pré-computado dessa projeção com a sessão do caixa.
    pdvServico: ctx.pdvServico,
    recebimento,
    estorno,
    // ---- "A prazo" (GOAL OPS-V4-RECEBIMENTO-A-PRAZO-MINIMO-006) ----
    // Action separada: nunca recebe dinheiro nem movimenta caixa.
    lancarAPrazo: ctx.lancarAPrazo,

    // ---- Diagnóstico / Orçamento REAIS (slice OPS-V4-ORCAMENTO-REAL-002) ----
    // Handlers de escrita reais (chamam actions da V3 e recarregam lista+detalhe).
    // Execução/Financeiro/Entrega/Documentos também já são reais (ver blocos acima).
    // Pós-venda também é operacional via actions V3; WhatsApp/PDV residual
    // permanece read-only quando não há contrato seguro conectado.
    salvarDiagnostico: ctx.salvarDiagnostico,
    gerarOrcamento: ctx.gerarOrcamento,
    salvarOrcamento: ctx.salvarOrcamento,
    // GOAL OPS-V4-ORCAMENTO-REABRIR-MOTOR-003: handler de correção avançada — o
    // OrcamentoStage em modo revisão chama isto (nunca o salvar comum, que o
    // motor rejeitaria para OS avançada).
    corrigirOrcamento: ctx.corrigirOrcamento,
    aprovarOrcamento: ctx.aprovarOrcamento,
    recusarOrcamento: ctx.recusarOrcamento,
    orcamentoMaterializado,
    orcamentoEditavel,
    orcamentoPodeDecidir,
    orcamentoEditorSeed,
    // ---- Envio de orçamento por canal + projeção client-safe (GOAL 025) ----
    orcamentoClienteView,
    enviarOrcamentoPorCanal: ctx.enviarOrcamentoPorCanal,
    openDocPrint,
    // ---- Seleção de variante + decisão granular (GOAL 026) ----
    selecionarVarianteOrcamento: ctx.selecionarVarianteOrcamento,
    comercialV4: lerComercialV4(ctx.realOS),

    // ---- Entrada/Recepção REAL (slice OPS-V4-ENTRADA-RECEPCAO-REAL-003) ----
    salvarIdentificacao: ctx.salvarIdentificacao,
    salvarProvaEntrada: ctx.salvarProvaEntrada,
    salvarAcessorios: ctx.salvarAcessorios,
    salvarChecklist: ctx.salvarChecklist,
    adicionarFotoEntrada: ctx.adicionarFotoEntrada,
    removerFotoEntrada: ctx.removerFotoEntrada,
    salvarAssinaturaCliente: ctx.salvarAssinaturaCliente,
    entradaEditorSeed,
    // ---- Dados básicos da OS REAL (slice OPS-V4-DADOS-BASICOS-OS-REAL-003B) ----
    salvarDadosBasicos: ctx.salvarDadosBasicos,
    dadosBasicosSeed,

    toast: st.toast, showToast: !!st.toast,

    // ---- seleção de OS real ----
    osSelected: !!st.selectedOsId,
    selectedOsId: st.selectedOsId,
    selectOS,
    openOSFromRail,
    goToOSSearch,
    clearSelection: () => update({ selectedOsId: null, focus: false, left: true }),
    // lista real para o seletor
    ordens: ctx.ordens,
    ordensLoading: ctx.ordensLoading,
    ordensPrimeiraCarga: ctx.ordensPrimeiraCarga,
    ordensError: ctx.ordensError,
    reloadOrdens: ctx.reloadOrdens,
    detailLoading: ctx.detailLoading,

    // ---- telas de rail (identidade própria; dado real ou empty honesto) ----
    moduleId: st.module,
    dashboardResumo,
    filaItens,
    filaOperacional,
    bancadaView,
    producaoBancada,
    producaoAtual,
    atribuirTecnico: ctx.atribuirTecnico,
    removerTecnico: ctx.removerTecnico,
    definirPrioridade: ctx.definirPrioridade,
    avancarStatusBancada: ctx.avancarStatusBancada,
    moverStatusFila: ctx.moverStatusFila,
    modoFila: ctx.modoFila,
    setModoFila: ctx.setModoFila,
    slaView,
    pdvView,
    pdvFinancialLoading: ctx.financialRailLoading,
    pdvFinancialError: ctx.financialRailError,
  };
}

export type V4Vals = ReturnType<typeof buildVals>;

/** Hook principal do Preview: mantém o estado e devolve o objeto `vals`. */
export function useV4Preview(): V4Vals {
  const [st, setSt] = useState<V4State>(INITIAL);
  const [modoFila, setModoFilaState] = useState<ModoFilaV4>("kanban");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { lojaAtivaId } = useLojaAtiva();
  const {
    ordens,
    loading: ordensLoading,
    primeiraCarga: ordensPrimeiraCarga,
    error: ordensError,
    reload: reloadOrdens,
  } = useOrdensV4(lojaAtivaId);
  const { ordem: ordemDetail, loading: detailLoading, reload: reloadDetail } = useOrdemV4(lojaAtivaId, st.selectedOsId);
  // Workspace lê a OS selecionada; o módulo PDV usa somente o reader em lote do rail.
  // Assim uma mesma OS não dispara dois readers concorrentes na troca de módulo.
  const selectedFinancial = useFinancialProjectionV4(
    lojaAtivaId,
    st.module === "workspace" ? st.selectedOsId : null,
  );
  const { reload: reloadSelectedFinancial } = selectedFinancial;
  const railFinancialIds = useMemo(
    () => st.module === "pdv" ? ordens.map((ordem) => ordem.id) : [],
    [st.module, ordens],
  );
  const railFinancial = useFinancialProjectionsV4(lojaAtivaId, railFinancialIds);
  const { reload: reloadRailFinancial } = railFinancial;
  const reloadFinancial = useCallback(() => {
    reloadSelectedFinancial();
    if (railFinancialIds.length > 0) reloadRailFinancial();
  }, [reloadSelectedFinancial, reloadRailFinancial, railFinancialIds.length]);
  const financialProjection = useMemo<FinancialProjectionStateV4>(
    () => ({ ...selectedFinancial, reload: reloadFinancial }),
    [selectedFinancial, reloadFinancial],
  );

  // ---- PDV de Serviço / recebimento real (slice PDV-SERVICO-OS-RECEBIMENTO-REAL-001) ----
  // Hook V3 já pronto: carrega pagamento (saldo/status) + sessão de caixa da OS
  // selecionada, e expõe receber/estornar/recibo. Sem motor novo — só envolvemos
  // `receber` abaixo para também recarregar a lista/detalhe da V4.
  const pdvServicoV3 = usePdvServicoV3(lojaAtivaId, st.selectedOsId);
  const {
    limparRecibo: limparReciboPdvV3,
    receber: receberPdvV3,
    estornar: estornarPdvV3,
  } = pdvServicoV3;
  // Troca de OS não deve arrastar o recibo da OS anterior para a próxima seleção.
  useEffect(() => {
    limparReciboPdvV3();
  }, [st.selectedOsId, limparReciboPdvV3]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // ---- preferência da lateral "Atividade" (GOAL OPS-V4-RIGHT-RAIL-DEDUP-001) ----
  // Reaplica a escolha salva SÓ pós-mount (nunca no initializer: o HTML do SSR
  // precisa bater com o primeiro render do cliente). Ler é idempotente — seguro
  // sob o duplo-mount do StrictMode. A ESCRITA fica no toggle explícito
  // (`persistRightRailPref`), nunca em efeito. Sem storage (navegação privada/
  // embed), fica o default fechado — sem quebrar nada.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RIGHT_RAIL_PREF_KEY);
      if (saved === "1" || saved === "0") {
        const right = saved === "1";
        setSt((prev) => (prev.right === right ? prev : { ...prev, right }));
      }
      setModoFilaState(lerModoFilaV4(window.localStorage.getItem(FILA_VIEW_PREF_KEY)));
    } catch {
      // storage indisponível — mantém o default em memória
    }
  }, []);

  const setModoFila = useCallback((modo: ModoFilaV4) => {
    setModoFilaState(modo);
    persistFilaViewPref(modo);
  }, []);

  const update = useCallback((p: Patch) => {
    setSt((prev) => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) }));
  }, []);

  const notify = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setSt((prev) => ({ ...prev, toast: msg, menu: null }));
    timer.current = setTimeout(() => setSt((prev) => ({ ...prev, toast: "" })), 1900);
  }, []);

  // ---- Ações de escrita REAIS (slice OPS-V4-ORCAMENTO-REAL-002) ----------------
  // Wrapper único: resolve loja/OS ativas (sem fallback loja-1), executa a action
  // real da V3, recarrega lista+detalhe e dá toast honesto. Devolve `true`/`false`.
  const selectedOsId = st.selectedOsId;
  const runWrite = useCallback(
    async (
      fn: (sid: string, osId: string) => Promise<unknown>,
      okMsg: string,
      after?: () => void,
    ): Promise<boolean> => {
      const sid = (lojaAtivaId ?? "").trim();
      const osId = (selectedOsId ?? "").trim();
      if (!sid || !osId) {
        notify("Selecione uma OS na loja ativa para concluir a ação.");
        return false;
      }
      try {
        await fn(sid, osId);
        reloadOrdens();
        reloadDetail();
        reloadFinancial();
        if (after) after();
        notify(okMsg);
        return true;
      } catch (e) {
        // A action pode falhar porque outra sessão alterou a OS/retorno. Nesse
        // caso a UI preserva o formulário, mas recarrega a autoridade server.
        reloadOrdens();
        reloadDetail();
        reloadFinancial();
        notify(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
        return false;
      }
    },
    [lojaAtivaId, selectedOsId, reloadOrdens, reloadDetail, reloadFinancial, notify],
  );

  // Mutations da Bancada / produção: mesma loja ativa e mesmo reload, mas o
  // alvo é a OS da linha (não a selecionada no workspace).
  const runWriteOnOs = useCallback(
    async (
      osIdArg: string,
      fn: (sid: string, osId: string) => Promise<unknown>,
      okMsg: string,
    ): Promise<boolean> => {
      const sid = (lojaAtivaId ?? "").trim();
      const osId = (osIdArg ?? "").trim();
      const gate = podeMutarProducaoV4(sid, osId);
      if (!gate.ok) {
        notify(gate.motivo);
        return false;
      }
      try {
        await fn(sid, osId);
        reloadOrdens();
        if ((selectedOsId ?? "").trim() === osId) {
          reloadDetail();
          reloadFinancial();
        }
        notify(okMsg);
        return true;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
        return false;
      }
    },
    [lojaAtivaId, selectedOsId, reloadOrdens, reloadDetail, reloadFinancial, notify],
  );

  // ---- PDV de Serviço / recebimento real: envolve `receber` para também
  // recarregar lista+detalhe da V4 depois do sucesso (o hook V3 só atualiza o
  // próprio estado local de pagamento/recibo — reload/patch de status da V4
  // NUNCA rodam se `receber` falhar, porque só entram no `if (ok)` abaixo).
  const receberPagamentoV4 = useCallback(
    async (input: ReceberOSInputV3) => {
      const ok = await receberPdvV3(input);
      if (ok) {
        reloadOrdens();
        reloadDetail();
        reloadFinancial();
      } else {
        notify("Não foi possível registrar o pagamento.");
      }
      return ok;
    },
    [receberPdvV3, reloadOrdens, reloadDetail, reloadFinancial, notify],
  );
  // ---- Estorno de recebimento (slice OPS-V4-RECEBIMENTO-ESTORNO-016): mesmo
  // padrão do `receberPagamentoV4` acima — envolve `estornar` (já pronto no hook
  // V3) só para também recarregar lista+detalhe da V4 depois do sucesso.
  const estornarRecebimentoV4 = useCallback(
    async (input: EstornarRecebimentoInputV3) => {
      const ok = await estornarPdvV3(input);
      if (ok) {
        reloadOrdens();
        reloadDetail();
        reloadFinancial();
      }
      return ok;
    },
    [estornarPdvV3, reloadOrdens, reloadDetail, reloadFinancial],
  );
  const pdvServico = useMemo<PdvServicoState>(
    () => ({ ...pdvServicoV3, receber: receberPagamentoV4, estornar: estornarRecebimentoV4 }),
    [pdvServicoV3, receberPagamentoV4, estornarRecebimentoV4],
  );

  const salvarDiagnostico = useCallback(
    (input: DiagnosticoInputV4) =>
      runWrite((sid, osId) => salvarDiagnosticoV3(sid, osId, input), "Diagnóstico salvo."),
    [runWrite],
  );
  const gerarOrcamento = useCallback(
    () => runWrite((sid, osId) => gerarOrcamentoDaOS(sid, osId), "Orçamento gerado."),
    [runWrite],
  );
  const salvarOrcamento = useCallback(
    (editor: OrcamentoEditorV4) =>
      runWrite((sid, osId) => salvarOrcamentoV3(sid, osId, editorToSalvarInputV4(editor)), "Orçamento salvo."),
    [runWrite],
  );
  // GOAL OPS-V4-ORCAMENTO-REABRIR-MOTOR-003: mesmo wrapper `runWrite` (reload + toast
  // honesto), mas chama a action de correção avançada — aceita OS já aprovada/em
  // execução/pronta/recebida/entregue, recalcula valorTotal e preserva o status.
  // Nenhum caixa/CR/venda/estoque envolvido; só persiste orçamento + timeline.
  const corrigirOrcamento = useCallback(
    (editor: OrcamentoEditorV4) =>
      runWrite((sid, osId) => corrigirOrcamentoV3(sid, osId, editorToSalvarInputV4(editor)), "Orçamento corrigido."),
    [runWrite],
  );
  const aprovarOrcamento = useCallback(
    () => runWrite((sid, osId) => aprovarOrcamentoV3(sid, osId), "Orçamento aprovado.", () => update({ status: "aprovado" })),
    [runWrite, update],
  );
  const recusarOrcamento = useCallback(
    (input: RecusarOrcamentoV3Input) => runWrite((sid, osId) => recusarOrcamentoV3(sid, osId, input), "Orçamento recusado."),
    [runWrite],
  );

  // ---- Envio de orçamento por canal (GOAL OPS-V4-ORC-ENVIO-WA-025) ----
  // Bespoke (não usa `runWrite`) porque o painel pós-envio precisa saber
  // `reenvio`/`avisoRegistro` para mostrar a mensagem honesta certa — o
  // `runWrite` genérico só devolve `boolean`. Mesma resolução de loja/OS,
  // mesmo reload de lista+detalhe.
  const enviarOrcamentoPorCanal = useCallback(
    async (canal: CanalEnvioOrcamentoV3): Promise<EnviarOrcamentoPorCanalUiResultV4> => {
      const sid = (lojaAtivaId ?? "").trim();
      const osId = (selectedOsId ?? "").trim();
      if (!sid || !osId) {
        notify("Selecione uma OS na loja ativa para concluir a ação.");
        return { ok: false };
      }
      try {
        const res = await enviarOrcamentoPorCanalV3(sid, osId, canal);
        reloadOrdens();
        reloadDetail();
        notify(
          res.avisoRegistro
            ? "Orçamento enviado — o registro do canal falhou (auditoria incompleta)."
            : res.reenvio
              ? "Novo envio registrado."
              : "Orçamento enviado ao cliente.",
        );
        return { ok: true, reenvio: res.reenvio, avisoRegistro: res.avisoRegistro };
      } catch (e) {
        notify(e instanceof Error ? e.message : "Não foi possível enviar o orçamento.");
        return { ok: false };
      }
    },
    [lojaAtivaId, selectedOsId, reloadOrdens, reloadDetail, notify],
  );

  // ---- Prefill de "Duplicar orçamento" (GOAL 025) — objeto rico, fora do
  // `V4State` (que só guarda flags visuais simples). O modal lê isto só na
  // abertura; `null` = formulário vazio (abertura normal, botão ⚡ do header).
  const [orcamentoRapidoPrefill, setOrcamentoRapidoPrefill] = useState<OrcamentoRapidoFormV4 | null>(null);
  const definirOrcamentoRapidoPrefill = useCallback((values: OrcamentoRapidoFormV4 | null) => {
    setOrcamentoRapidoPrefill(values);
  }, []);
  const iniciarDiagnostico = useCallback(
    () =>
      runWrite(
        (sid, osId) => aplicarTransicaoStatusV3(sid, osId, "diagnostico"),
        "OS movida para diagnóstico.",
        () => update({ status: "diagnostico", stage: "diagnostico" }),
      ),
    [runWrite, update],
  );
  const iniciarServico = useCallback(
    () =>
      runWrite(
        (sid, osId) => aplicarTransicaoStatusV3(sid, osId, "em_execucao"),
        "Serviço iniciado.",
        () => update({ status: "em_execucao", stage: "execucao" }),
      ),
    [runWrite, update],
  );

  // ---- Execução (slice OPS-V4-EXECUCAO-REAL-007): demais transições seguras da
  // Execução — mesmo wrapper `runWrite` (reload + toast honesto; sem mutar status
  // local se a action falhar). Sem estoque/caixa/financeiro.
  const marcarAguardandoPeca = useCallback(
    () =>
      runWrite(
        (sid, osId) => aplicarTransicaoStatusV3(sid, osId, "aguardando_peca"),
        "OS marcada como aguardando peça.",
        () => update({ status: "aguardando_peca" }),
      ),
    [runWrite, update],
  );
  const marcarPronta = useCallback(
    () =>
      runWrite(
        (sid, osId) => aplicarTransicaoStatusV3(sid, osId, "pronta"),
        "OS marcada como pronta.",
        () => update({ status: "pronta" }),
      ),
    [runWrite, update],
  );

  // ---- Entrega (GOAL OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008): mesmo wrapper
  // `runWrite` (reload + toast honesto; sem mutar status local se a action falhar).
  // `registrarEntregaV3` é o caminho canônico e agora sempre refaz a decisão
  // financeira no servidor. O gate cliente serve apenas para orientar a UX.
  const confirmarEntrega = useCallback(
    (semCobranca?: EntregaSemCobrancaSolicitacaoV3) =>
      runWrite(
        (sid, osId) => registrarEntregaV3(sid, osId, semCobranca ? { semCobranca } : {}),
        "Entrega confirmada.",
        () => update({ status: "entregue", stage: "entrega" }),
      ),
    [runWrite, update],
  );

  // ---- Assinatura de retirada (SPRINT_3E.2, GOAL OPS-V4-DOCS-ASSINATURA-
  // TERMOS-ANEXOS-012): mesmo wrapper `runWrite`; reusa `salvarAssinaturaRetiradaV3`
  // (só grava após a entrega já registrada — a própria action valida o estado).
  const salvarAssinaturaRetirada = useCallback(
    (dataUrl: string) =>
      runWrite((sid, osId) => salvarAssinaturaRetiradaV3(sid, osId, dataUrl), "Assinatura de retirada salva."),
    [runWrite],
  );
  const adicionarFotoSaida = useCallback(
    (input: AdicionarFotoSaidaInputV3) =>
      runWrite((sid, osId) => adicionarFotoSaidaV3(sid, osId, input), "Foto de saída adicionada."),
    [runWrite],
  );
  const removerFotoSaida = useCallback(
    (fotoId: string) =>
      runWrite((sid, osId) => removerFotoSaidaV3(sid, osId, fotoId), "Foto de saída removida."),
    [runWrite],
  );

  // ---- Auditoria de impressão (Fase 1E, GOAL OPS-V4-DOCS-ASSINATURA-TERMOS-
  // ANEXOS-012): best-effort, mesma action usada pelo `onPrinted` da V3
  // (`PrintPreviewV3`) — registra na timeline, nunca bloqueia a impressão.
  const registrarImpressaoDoc = useCallback(
    (tipo: DocumentoTipoV3) => {
      const sid = (lojaAtivaId ?? "").trim();
      const osId = (selectedOsId ?? "").trim();
      if (!sid || !osId) return;
      void registrarImpressaoDocumentoV3(sid, osId, tipo).catch(() => {});
    },
    [lojaAtivaId, selectedOsId],
  );

  // ---- Garantia da OS (GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014): mesmo wrapper
  // `runWrite`; reusa `salvarGarantiaOSV3` (mesma action que a V3 usa em
  // `GarantiaOSV3.tsx`), gravando no mesmo `payload.aberturaV3.garantiaPrevista`.
  // Paridade com a V3: só modelo + prazo (sem termoCustom nesta etapa).
  const salvarGarantia = useCallback(
    (input: { modeloId: string; prazoDias?: number }) =>
      runWrite((sid, osId) => salvarGarantiaOSV3(sid, osId, input), "Garantia salva."),
    [runWrite],
  );

  // ---- Pós-venda real: contratos exatos da V3. O wrapper só recarrega depois
  // da confirmação do servidor; nenhum retorno é projetado otimisticamente.
  // Se o servidor devolver atendimento novo (OS entregue), abre esse workspace.
  const abrirOsVinculada = useCallback(
    (osIdArg: string) => {
      const id = osIdArg.trim();
      if (!id) return;
      const existente = ordens.find((item) => item.id === id);
      const status = existente ? resolverStatusV4(existente) : "aberta";
      update({
        selectedOsId: id,
        status,
        stage: existente ? stageForStatus(status) : "entrada",
        module: "workspace",
        view: "cockpit",
        menu: null,
        focus: true,
        left: false,
        right: false,
      });
      reloadOrdens();
    },
    [ordens, update, reloadOrdens],
  );
  const abrirRetorno = useCallback(
    async (motivo: string, observacao?: string) => {
      const sid = (lojaAtivaId ?? "").trim();
      const osId = (selectedOsId ?? "").trim();
      if (!sid || !osId) {
        notify("Selecione uma OS na loja ativa para concluir a ação.");
        return false;
      }
      try {
        const result = await abrirRetornoV3(sid, osId, { motivo, observacao });
        reloadOrdens();
        reloadDetail();
        reloadFinancial();
        const atendimentoId = result.atendimento?.id?.trim();
        if (atendimentoId) {
          update({
            selectedOsId: atendimentoId,
            status: "aberta",
            stage: "entrada",
            module: "workspace",
            view: "cockpit",
            menu: null,
            focus: true,
            left: false,
            right: false,
          });
          notify(
            result.atendimento?.codigo
              ? `Retorno aberto. Atendimento ${result.atendimento.codigo} vinculado.`
              : "Retorno aberto e atendimento vinculado.",
          );
        } else {
          notify("Retorno aberto.");
        }
        return true;
      } catch (e) {
        reloadOrdens();
        reloadDetail();
        reloadFinancial();
        notify(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
        return false;
      }
    },
    [lojaAtivaId, selectedOsId, reloadOrdens, reloadDetail, reloadFinancial, notify, update],
  );
  const finalizarRetorno = useCallback(
    (retornoId: string, observacao?: string) =>
      runWrite((sid, osId) => finalizarRetornoV3(sid, osId, retornoId, { observacao }), "Retorno finalizado."),
    [runWrite],
  );

  // ---- "A prazo" (GOAL OPS-V4-RECEBIMENTO-A-PRAZO-MINIMO-006): mesmo wrapper
  // `runWrite` — reusa `lancarOSAPrazoV3`, uma action SEPARADA do recebimento
  // imediato (nunca liquida título, nunca movimenta caixa, nunca exige caixa
  // aberto). Reload de lista+detalhe (via `runWrite`) atualiza `pdvServico` e o
  // espelho `aPrazoV3` da OS, liberando `entregaAcoes.podeConfirmar` na hora.
  const lancarAPrazo = useCallback(
    (input: LancarAPrazoInputV3) =>
      runWrite((sid, osId) => lancarOSAPrazoV3(sid, osId, input), "Conta a receber criada — entrega autorizada a prazo."),
    [runWrite],
  );

  // ---- Cancelamento de OS (GOAL OPS-V4-CANCELAR-OS-CONNECT-021): mesmo wrapper
  // `runWrite` (reload + toast honesto; sem mutar status local se a action
  // falhar) — reaproveita `aplicarTransicaoStatusV3` já blindada na V3 (commit
  // f825867: exige motivo, bloqueia pagamento recebido, nunca ignora o retorno
  // do cancelamento do CR). O modal só fecha via `after`, ou seja, só em sucesso
  // real confirmado pelo servidor — nunca estado otimista.
  const cancelarOS = useCallback(
    (motivo: string) =>
      runWrite(
        (sid, osId) => aplicarTransicaoStatusV3(sid, osId, "cancelada", { motivo }),
        "OS cancelada.",
        () => update({ status: "cancelada", cancelamentoOS: false }),
      ),
    [runWrite, update],
  );

  // ---- Entrada/Recepção (slice 003): handlers reais (prova-entrada / checklist) ----
  const salvarIdentificacao = useCallback(
    (input: IdentificacaoV3) =>
      runWrite((sid, osId) => salvarIdentificacaoV3(sid, osId, input), "Identificação salva."),
    [runWrite],
  );
  const salvarProvaEntrada = useCallback(
    (input: SalvarProvaEntradaInputV3) =>
      runWrite((sid, osId) => salvarProvaEntradaV3(sid, osId, input), "Prova de entrada salva."),
    [runWrite],
  );
  const salvarAcessorios = useCallback(
    (acessorios: AcessorioEntradaV3[]) =>
      runWrite((sid, osId) => salvarAcessoriosEntradaV3(sid, osId, acessorios), "Acessórios salvos."),
    [runWrite],
  );
  const salvarChecklist = useCallback(
    (itens: ChecklistEntradaItemV3[]) =>
      runWrite((sid, osId) => salvarChecklistEntradaV3(sid, osId, itens), "Checklist salvo."),
    [runWrite],
  );
  const adicionarFotoEntrada = useCallback(
    (input: AdicionarFotoEntradaInputV3) =>
      runWrite((sid, osId) => adicionarFotoEntradaV3(sid, osId, input), "Foto da entrada adicionada."),
    [runWrite],
  );
  const removerFotoEntrada = useCallback(
    (fotoId: string) =>
      runWrite((sid, osId) => removerFotoEntradaV3(sid, osId, fotoId), "Foto da entrada removida."),
    [runWrite],
  );
  const salvarAssinaturaCliente = useCallback(
    (dataUrl: string) =>
      runWrite((sid, osId) => salvarAssinaturaClienteV3(sid, osId, dataUrl), "Assinatura da entrada salva."),
    [runWrite],
  );

  // ---- Dados básicos da OS (slice 003B): handler real (payload-only, sem financeiro) ----
  const salvarDadosBasicos = useCallback(
    (input: SalvarDadosBasicosInputV3) =>
      runWrite((sid, osId) => salvarDadosBasicosOSV3(sid, osId, input), "Dados básicos salvos."),
    [runWrite],
  );

  // OS real: detalhe hidratado quando já carregou; senão, a linha da lista (identidade imediata).
  const realOS = useMemo<OrdemServico | null>(() => {
    if (!st.selectedOsId) return null;
    if (ordemDetail && ordemDetail.id === st.selectedOsId) return ordemDetail;
    return ordens.find((o) => o.id === st.selectedOsId) ?? null;
  }, [st.selectedOsId, ordemDetail, ordens]);

  const osDaLista = useCallback(
    (osId: string): OrdemServico | null => {
      if (realOS && realOS.id === osId) return realOS;
      return ordens.find((o) => o.id === osId) ?? null;
    },
    [realOS, ordens],
  );

  const atribuirTecnico = useCallback(
    (osId: string, nome: string, id?: string) => {
      const label = nome.trim();
      if (!label) {
        notify("Informe o nome do técnico.");
        return Promise.resolve(false);
      }
      const atual = osDaLista(osId);
      return runWriteOnOs(
        osId,
        (sid, idOs) => atribuirTecnicoV3(sid, idOs, { nome: label, id }),
        atual?.tecnico?.id ? "Técnico atualizado." : "Técnico atribuído.",
      );
    },
    [runWriteOnOs, osDaLista, notify],
  );
  const removerTecnico = useCallback(
    (osId: string) => runWriteOnOs(osId, (sid, idOs) => atribuirTecnicoV3(sid, idOs, null), "Técnico removido."),
    [runWriteOnOs],
  );
  const definirPrioridade = useCallback(
    (osId: string, prioridade: PrioridadeV3) =>
      runWriteOnOs(
        osId,
        (sid, idOs) => definirPrioridadeV3(sid, idOs, prioridade),
        `Prioridade: ${PRIORIDADE_META_V3[prioridade].label}.`,
      ),
    [runWriteOnOs],
  );
  const avancarStatusBancada = useCallback(
    (osId: string, to: OperacaoStatusV3) => {
      const alvo = osDaLista(osId);
      const gate = podeAvancarStatusBancadaV4(alvo, to);
      if (!gate.ok) {
        notify(gate.motivo);
        return Promise.resolve(false);
      }
      const from = statusV3FromOS(alvo);
      return runWriteOnOs(osId, (sid, idOs) => aplicarTransicaoStatusV3(sid, idOs, to), `${labelAcaoBancadaV4(from, to)}.`);
    },
    [runWriteOnOs, osDaLista, notify],
  );
  const moverStatusFila = useCallback(
    async (osId: string, to: OperacaoStatusV3) => {
      const alvo = osDaLista(osId);
      const gate = podeMoverStatusFilaV4(alvo, to);
      if (!gate.ok) {
        notify(gate.motivo);
        return false;
      }
      const from = statusV3FromOS(alvo);
      const semTecnico = !(`${alvo?.tecnico?.id ?? ""}`.trim() || `${alvo?.tecnico?.nome ?? ""}`.trim());
      const ok = await runWriteOnOs(
        osId,
        (sid, idOs) => aplicarTransicaoStatusV3(sid, idOs, to),
        `${labelAcaoFilaV4(from, to)}.`,
      );
      if (!ok) {
        reloadOrdens();
        if ((selectedOsId ?? "").trim() === osId) {
          reloadDetail();
          reloadFinancial();
        }
        return false;
      }
      if (to === "em_execucao" && semTecnico) notify(MSG_SEM_TECNICO_INICIO_V4);
      return true;
    },
    [runWriteOnOs, osDaLista, notify, reloadOrdens, reloadDetail, reloadFinancial, selectedOsId],
  );

  // ---- Seleção de variante (GOAL OPS-V4-ORC-APROVACAO-SELECAO-026) ----
  // Lê o orçamento REAL (não o estado local do editor de itens) para nunca
  // gravar uma seleção sobre dados desatualizados; marca via helper puro e
  // grava pelo contrato oficial (`gruposV3` preservado explicitamente).
  const selecionarVarianteOrcamento = useCallback(
    (grupoId: string, itemId: string) =>
      runWrite((sid, osId) => {
        const orc = (realOS as { orcamento?: { servicos?: ServicoV3[]; pecas?: PecaV3[]; desconto?: number; gruposV3?: unknown } } | null)
          ?.orcamento;
        const servicosAtuais = Array.isArray(orc?.servicos) ? orc!.servicos! : [];
        const pecasAtuais = Array.isArray(orc?.pecas) ? orc!.pecas! : [];
        const marcado = marcarSelecaoVarianteV4({ servicos: servicosAtuais, pecas: pecasAtuais }, grupoId, itemId);
        return salvarOrcamentoV3(sid, osId, {
          servicos: marcado.servicos,
          pecas: marcado.pecas,
          desconto: orc?.desconto ?? 0,
          gruposV3: orc?.gruposV3 as Parameters<typeof salvarOrcamentoV3>[2]["gruposV3"],
        });
      }, "Opção selecionada."),
    [runWrite, realOS],
  );

  // ---- Prefill do cancelamento pós-recusa (GOAL 026) — objeto simples, fora
  // do `V4State`, mesmo padrão do prefill do Orçamento Rápido (GOAL 025).
  const [cancelamentoMotivoPrefill, setCancelamentoMotivoPrefill] = useState<string | null>(null);
  const definirCancelamentoMotivoPrefill = useCallback((motivo: string | null) => {
    setCancelamentoMotivoPrefill(motivo);
  }, []);

  const ctx = useMemo<V4DataCtx>(
    () => ({
      ordens,
      ordensLoading,
      ordensPrimeiraCarga,
      ordensError,
      reloadOrdens,
      reloadDetail,
      realOS,
      detailLoading,
      financialProjection,
      financialProjectionsByOsId: railFinancial.projectionsByOsId,
      financialRailLoading: railFinancial.loading,
      financialRailError: railFinancial.error,
      salvarDiagnostico,
      gerarOrcamento,
      salvarOrcamento,
      corrigirOrcamento,
      aprovarOrcamento,
      recusarOrcamento,
      iniciarDiagnostico,
      iniciarServico,
      marcarAguardandoPeca,
      marcarPronta,
      confirmarEntrega,
      salvarAssinaturaRetirada,
      adicionarFotoSaida,
      removerFotoSaida,
      registrarImpressaoDoc,
      salvarGarantia,
      abrirRetorno,
      finalizarRetorno,
      abrirOsVinculada,
      lancarAPrazo,
      cancelarOS,
      pdvServico,
      salvarIdentificacao,
      salvarProvaEntrada,
      salvarAcessorios,
      salvarChecklist,
      adicionarFotoEntrada,
      removerFotoEntrada,
      salvarAssinaturaCliente,
      salvarDadosBasicos,
      atribuirTecnico,
      removerTecnico,
      definirPrioridade,
      avancarStatusBancada,
      moverStatusFila,
      modoFila,
      setModoFila,
      enviarOrcamentoPorCanal,
      orcamentoRapidoPrefill,
      definirOrcamentoRapidoPrefill,
      selecionarVarianteOrcamento,
      cancelamentoMotivoPrefill,
      definirCancelamentoMotivoPrefill,
    }),
    [
      ordens,
      ordensLoading,
      ordensPrimeiraCarga,
      ordensError,
      reloadOrdens,
      reloadDetail,
      realOS,
      detailLoading,
      financialProjection,
      railFinancial.projectionsByOsId,
      railFinancial.loading,
      railFinancial.error,
      salvarDiagnostico,
      gerarOrcamento,
      salvarOrcamento,
      corrigirOrcamento,
      aprovarOrcamento,
      recusarOrcamento,
      iniciarDiagnostico,
      iniciarServico,
      marcarAguardandoPeca,
      marcarPronta,
      confirmarEntrega,
      salvarAssinaturaRetirada,
      adicionarFotoSaida,
      removerFotoSaida,
      registrarImpressaoDoc,
      salvarGarantia,
      abrirRetorno,
      finalizarRetorno,
      abrirOsVinculada,
      lancarAPrazo,
      cancelarOS,
      pdvServico,
      salvarIdentificacao,
      salvarProvaEntrada,
      salvarAcessorios,
      salvarChecklist,
      adicionarFotoEntrada,
      removerFotoEntrada,
      salvarAssinaturaCliente,
      salvarDadosBasicos,
      atribuirTecnico,
      removerTecnico,
      definirPrioridade,
      avancarStatusBancada,
      moverStatusFila,
      modoFila,
      setModoFila,
      enviarOrcamentoPorCanal,
      orcamentoRapidoPrefill,
      definirOrcamentoRapidoPrefill,
      selecionarVarianteOrcamento,
      cancelamentoMotivoPrefill,
      definirCancelamentoMotivoPrefill,
    ],
  );

  return useMemo(() => buildVals(st, update, notify, ctx), [st, update, notify, ctx]);
}
