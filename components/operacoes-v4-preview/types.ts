/**
 * Operações V4 Preview — tipos do estado local (visual, mock).
 *
 * Portados do `data-dc-script` do protótipo `design/operacoes-v4`. NÃO há
 * relação com os tipos reais da Operações V3 (`@/types/os`); este módulo é
 * totalmente isolado.
 */

export type V4Stage =
  | "entrada"
  | "diagnostico"
  | "orcamento"
  | "execucao"
  | "financeiro"
  | "entrega"
  | "posvenda"
  | "historico"
  /**
   * Superfície de **segurança/autorização (preview)** — não é uma fase do fluxo
   * da OS (não entra no pipeline de 8 etapas). É um destino lateral, alcançado a
   * partir da Execução, que demonstra os componentes de autorização do gerente
   * (PIN, padrão 3×3, senha, estados). 100% visual/no-op — não autentica nada.
   */
  | "seguranca";

/** Estado da autorização demonstrada na superfície de Segurança (preview). */
export type V4AuthState = "autorizado" | "negado" | "expirado";

export type V4Status =
  | "aberta"
  | "diagnostico"
  | "aguardando_aprovacao"
  | "aprovado"
  | "aguardando_peca"
  | "em_execucao"
  | "pronta"
  | "entregue"
  /**
   * OPS-V4-STATUS-AUTHORITY-FIX-003 (F-03) — estado NÃO reconhecido. Não é um
   * status de negócio nem uma etapa do pipeline: é o resultado fail-closed de
   * `resolverStatusV4` quando a OS carrega um status fora do domínio conhecido.
   * Nunca habilita ação primária (`PRIMARY.desconhecido === null`).
   */
  | "desconhecido"
  | "cancelada";

export type V4Mode = "recepcao" | "bancada" | "auditoria";

export type V4View = "cockpit" | "auditoria";

export type V4Module = "workspace" | "dashboard" | "fila" | "bancada" | "sla" | "pdv";

export type V4Menu = "print" | "more" | null;

export interface V4State {
  view: V4View;
  module: V4Module;
  stage: V4Stage;
  status: V4Status;
  left: boolean;
  right: boolean;
  menu: V4Menu;
  toast: string;
  prioridade: "baixa" | "normal" | "alta" | "urgente";
  histFilter: string;
  novaOS: boolean;
  /** Launcher `+ Novo` (GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001). */
  novoAtendimento: boolean;
  recibo: boolean;
  /** Modal "Atendimento rápido" (GOAL OPS-V4-ATENDIMENTO-RAPIDO-CONNECT-014). */
  atendimentoRapido: boolean;
  /** Modal "⚡ Orçamento Rápido" (GOAL OPS-V4-ORC-RAPIDO-024). */
  orcamentoRapido: boolean;
  /** Modal de confirmação "Estornar recebimento" (GOAL OPS-V4-RECEBIMENTO-ESTORNO-016). */
  estornoRecebimento: boolean;
  /** Modal de confirmação "Cancelar OS" (GOAL OPS-V4-CANCELAR-OS-CONNECT-021). */
  cancelamentoOS: boolean;
  /** null = tela limpa (empty state); id = OS real selecionada. */
  selectedOsId: string | null;
  /**
   * Modo foco: recolhe rail interno + as duas gavetas (Cliente/Aparelho e
   * Atividade) de uma vez, maximizando o workspace. Apenas estado visual local.
   */
  focus: boolean;
  // ---- Segurança/autorização (preview · totalmente visual, não autentica) ----
  authState: V4AuthState;
  /** Quantidade de casas preenchidas no PIN de 4 dígitos (0–4, demonstração). */
  pin4: number;
  /** Quantidade de casas preenchidas no PIN de 6 dígitos (0–6, demonstração). */
  pin6: number;
  /** Pontos selecionados do padrão 3×3 (índices 0–8, na ordem do traçado). */
  pattern: number[];
  /** Texto digitado nos campos da demonstração (não é enviado a lugar nenhum). */
  senha: string;
  motivo: string;
  /**
   * Documento aberto no modal de impressão real (GOAL OPS-V4-DOCS-ASSINATURA-
   * TERMOS-ANEXOS-012) — `null` = fechado. Tipado como string (não `DocumentoTipoV3`)
   * para manter este módulo isolado dos tipos da V3; a leitura tipada acontece em
   * `use-v4-preview`, que já consome contratos da V3.
   */
  docPrint: string | null;
}

/** Tom de cor de um status/badge. */
export interface V4Tone {
  bg: string;
  fg: string;
  dot: string;
}
