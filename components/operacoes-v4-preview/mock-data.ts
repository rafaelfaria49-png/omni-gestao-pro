/**
 * Operações V4 Preview — definições de fluxo e rótulos (config visual, sem dados fake).
 *
 * Mantém apenas as constantes de apoio da Preview: ordem/labels/tons de status,
 * prioridades, definição de etapas/rail/modos, filtros de histórico e o changelog
 * da Auditoria de UX. NÃO contém clientes, OS, técnicos, SLA, fila ou números
 * operacionais fabricados — as telas operacionais leem dados REAIS (workspace da OS)
 * ou exibem estado vazio honesto (rail/Nova OS). Estático e local; sem Prisma/Server Action.
 */
import { C } from "./tokens";
import type { V4Status, V4Stage, V4Tone } from "./types";

/** Ordem linear do fluxo (governa concluído/atual/pendente). */
export const ORDER: V4Status[] = [
  "aberta",
  "diagnostico",
  "aguardando_aprovacao",
  "aprovado",
  "em_execucao",
  "pronta",
  "entregue",
];

export const STATUS_LABEL: Record<V4Status, string> = {
  aberta: "Aberta",
  diagnostico: "Diagnóstico",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovada",
  aguardando_peca: "Aguardando peça",
  em_execucao: "Em execução",
  pronta: "Pronta",
  entregue: "Entregue",
  cancelada: "Cancelada",
  desconhecido: "Status não reconhecido",
};

export const TONE: Record<V4Status, V4Tone> = {
  aberta: { bg: C.infoBg, fg: C.infoFg, dot: C.info },
  diagnostico: { bg: C.infoBg, fg: C.infoFg, dot: C.info },
  aguardando_aprovacao: { bg: C.warnBg, fg: C.warnFg, dot: C.warn },
  aprovado: { bg: C.primaryBg, fg: C.primaryHover, dot: C.primary },
  aguardando_peca: { bg: C.warnBg, fg: C.warnFg, dot: C.warn },
  em_execucao: { bg: C.primaryBg, fg: C.primaryHover, dot: C.primary },
  pronta: { bg: C.successBg, fg: C.successFg, dot: C.success },
  entregue: { bg: C.line3, fg: C.bodySoft, dot: C.subtle },
  cancelada: { bg: C.dangerBg, fg: C.dangerFg, dot: C.danger },
  // Estado inconsistente — tom de alerta para o operador notar e escalar.
  desconhecido: { bg: C.dangerBg, fg: C.dangerFg, dot: C.danger },
};

export const PRIO = {
  baixa: { label: "Baixa", fg: C.successFg, dot: C.success },
  normal: { label: "Normal", fg: C.infoFg, dot: C.info },
  alta: { label: "Alta", fg: C.warnFg, dot: C.warn },
  urgente: { label: "Urgente", fg: C.dangerFg, dot: C.danger },
} as const;

/** Ação primária por status (label + transição + etapa de destino). */
export const PRIMARY: Record<
  V4Status,
  { label: string; to: V4Status; stage: V4Stage } | null
> = {
  aberta: { label: "Iniciar diagnóstico", to: "diagnostico", stage: "diagnostico" },
  diagnostico: { label: "Enviar orçamento", to: "aguardando_aprovacao", stage: "orcamento" },
  aguardando_aprovacao: { label: "Registrar aprovação", to: "aprovado", stage: "orcamento" },
  aprovado: { label: "Iniciar serviço", to: "em_execucao", stage: "execucao" },
  aguardando_peca: { label: "Marcar peça chegou", to: "em_execucao", stage: "execucao" },
  em_execucao: { label: "Marcar pronta", to: "pronta", stage: "execucao" },
  // "Receber pagamento" leva ao Financeiro (a baixa real vive no PDV de Serviço).
  pronta: { label: "Receber pagamento", to: "entregue", stage: "financeiro" },
  entregue: null,
  cancelada: null,
  // F-03 fail-closed: status não reconhecido NUNCA vira ação operacional.
  desconhecido: null,
};

/* ---- definições de etapas / módulos ---- */

export const RAIL_DEF: Array<[string, string]> = [
  ["dashboard", "Visão geral"],
  ["fila", "Fila"],
  ["workspace", "OS"],
  ["bancada", "Bancada"],
  ["sla", "SLA"],
  ["pdv", "Receber"],
  ["garantias", "Garantias"],
];

export const MODE_DEF: Array<["recepcao" | "bancada" | "auditoria", string, string, string]> = [
  ["recepcao", "Recepção", "🛎", "Cliente + Atividade abertos"],
  ["bancada", "Bancada", "🔧", "Laterais recolhidas · workspace máximo"],
  ["auditoria", "Auditoria", "🔍", "Cliente recolhido · Atividade aberta"],
];

/**
 * Pipeline operacional da OS (GOAL OPS-V4-PIPELINE-ENTRADA-NAV-SIMPLIFY-002).
 * Só o ciclo técnico. Orçamento, Financeiro e Histórico saíram da trilha.
 */
export const STAGE_DEF: Array<[V4Stage, string]> = [
  ["entrada", "Entrada"],
  ["diagnostico", "Diagnóstico"],
  ["execucao", "Execução"],
  ["entrega", "Entrega"],
  ["posvenda", "Pós-venda"],
];

export const HIST_FILTER_DEF: Array<[string, string]> = [
  ["todos", "Tudo"],
  ["status", "Status"],
  ["financeiro", "Financeiro"],
  ["comunicacao", "Comunicação"],
  ["tecnico", "Técnico"],
];

/* ---- metadados dos módulos (rail) — só ícone/título; sem dados operacionais fabricados ---- */

export const MODULE_META: Record<string, { icon: string; title: string }> = {
  dashboard: { icon: "📊", title: "Visão geral" },
  fila: { icon: "📋", title: "Fila de OS" },
  bancada: { icon: "🔧", title: "Bancada" },
  sla: { icon: "⏱", title: "SLA & atrasos" },
  pdv: { icon: "💳", title: "Recebimento da OS" },
  garantias: { icon: "🛡", title: "Garantias" },
};

/* ---- auditoria ---- */

export const RESOLVED_RAW: Array<[string, string]> = [
  ["Rolagem horizontal", "Raiz agora 100% fluida (100vw/100vh); grids em fr; só o palco rola. Cabe em FHD, notebook e ultrawide."],
  ["Recolhíveis reais", "Cliente e Atividade recolhem para trilhos de 32px; o workspace central expande sozinho."],
  ["3 modos de uso", "Recepção, Bancada e Auditoria no topo — ajustam as duas laterais de uma vez e refletem o estado atual."],
  ["Aba Financeiro", "Total, forma de pagamento, plano de parcelas e histórico financeiro reais; recebido/saldo/status lidos do espelho real de pagamento (payload.pagamentoV3) quando há recebimento; CTA Receber no PDV honesto (integração ainda não conectada)."],
  ["Aba Entrega", "Retirado por, documento, data/hora, assinatura, checklist final, acessórios devolvidos, garantia e imprimir termo + estado “precisa estar Pronta”."],
  ["Aba Pós-venda", "Garantia e retornos reais do payload V3, com abertura, finalização, resolução, vínculo à OS original e histórico sem eventos duplicados."],
  ["Espaços vazios", "Execução, Histórico, Financeiro e Entrega agora usam colunas densas — sem cards enormes vazios."],
  ["Rail de ícones", "Visão geral, Fila, OS, Bancada, SLA, PDV e Garantias navegáveis pelo rail. Fila, Bancada e Pós-venda são operacionais; Garantias abre o cockpit V4."],
  ["Header e etapas", "Topo 44→40px, comando 54→46px, spine 66→52px — mais conteúdo útil por tela."],
  ["Nova OS completa (v4)", "Modal com buscar/cadastrar cliente, equipamento, marca/modelo/IMEI/cor, defeito, observações, origem e recebido por."],
  ["Segurança / acesso (v4)", "PIN, senha, padrão de 9 pontos interativo, Face/biometria, Google, iCloud, observação e aviso de máscara na impressão."],
  ["Orçamento por tipo (v4)", "Editor mock substituído por leitura real: serviços, peças, total e desconto da OS (ou prévia sintetizada); custo/lucro quando há custo real disponível."],
  ["Recibo + saldo devedor (v4)", "Recibo fabricado removido — a baixa é registrada no PDV de Serviço; o modal exibe empty state honesto quando não há recibo real na OS."],
  ["Auditoria filtrável (v4)", "Filtros de Status / Financeiro / Comunicação / Técnico agora filtram a linha do tempo de verdade."],
  ["Identidade visual", "Mesma paleta (índigo #4f46e5 + neutros) e tipografia; nenhum tema novo."],
];

export const PENDING = [
  { title: "Ações ainda sem contrato", text: "WhatsApp, portal e documentos residuais permanecem sem persistência quando não existe action V3 segura." },
  { title: "Catálogo / ProductPicker", text: "Os botões + Serviço / + Peça abrem o catálogo real do estoque na integração final." },
  { title: "Cadastro de técnicos livres", text: "O seletor usa o cadastro real da loja e os técnicos já atribuídos nas OS. Não há cadastro paralelo de equipe na V4." },
  { title: "Responsivo < 1280px", text: "Colunas dos painéis de etapa já colapsam 3→2→1 automaticamente (auto-fit); breakpoints finos do shell (largura das gavetas/rail) ficam para a próxima fase." },
];

/* ---- Nova OS / segurança ---- */

export const EQUIP_DEF: Array<[string, string]> = [
  ["celular", "Celular"],
  ["tablet", "Tablet"],
  ["notebook", "Notebook"],
  ["videogame", "Videogame"],
  ["outro", "Outro"],
];

export const ORIGEM_DEF: Array<[string, string]> = [
  ["balcao", "Balcão"],
  ["whatsapp", "WhatsApp"],
  ["retorno", "Retorno"],
  ["garantia", "Garantia"],
];
