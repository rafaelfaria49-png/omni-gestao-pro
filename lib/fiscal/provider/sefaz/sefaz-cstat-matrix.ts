/**
 * Matriz versionada de `cStat` → desfecho canônico (GOAL-016D-B · plano 016D §3.4 · D2 · D12).
 *
 * Mapa **estático, fechado e congelado**. As três regras que o governam:
 *
 *  1. ⛔ **Sem classificação por faixa numérica.** `6xx` não é "rejeição", `1xx` não é "sucesso".
 *     Cada código é uma entrada explícita, escrita à mão, com sua consequência fiscal declarada.
 *  2. ⛔ **Sem fallback para rejeição.** Código ausente da matriz ⇒ `UNCERTAIN/UNKNOWN`. Rejeitar
 *     por desconhecimento consumiria o número de um documento cujo desfecho ninguém leu — o
 *     defeito mais caro desta frente (plano 016D, slice 016D-B, "Risco").
 *  3. ⛔ **Sem herança de comportamento destrutivo.** `requiresInutilizacao` é uma decisão POR
 *     CÓDIGO, nunca um literal genérico. Nenhum código não coberto pode herdá-la.
 *
 * ## Consequências fiscais são explícitas
 *
 * Cada entrada declara as quatro dimensões que o resto do sistema precisa e que antes estavam
 * hard-coded no coordenador (`requiresInutilizacao: true`): **terminalidade**, **consumo de
 * número**, **necessidade de inutilização** e **necessidade de consulta**. Quem decide é a
 * matriz; o coordenador apenas obedece.
 *
 * ## Restrição por serviço
 *
 * Um `cStat` só é reconhecido nos serviços onde a SEFAZ pode legitimamente devolvê-lo. `217`
 * ("não consta") só faz sentido numa **consulta**: encontrá-lo numa resposta de autorização é
 * divergência estrutural, não "documento inexistente" — e é classificado como incerto.
 *
 * ## Fontes
 *
 * Códigos e significados vêm do que já está VERSIONADO no repositório
 * (`docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md` · plano 016D §3.4, herdado do GOAL-015 §10).
 * Nenhuma consulta de rede foi feita para montá-la. A pendência **H-8** (anexo completo de
 * `cStat` do MOC vigente) permanece aberta — o que a matriz cobre é o conjunto mínimo do plano,
 * e é exatamente por isso que o default é `UNCERTAIN`.
 */
import type { SefazServico } from "./sefaz-endpoint-catalog"

/**
 * Versão da matriz. Muda sempre que uma entrada é adicionada, removida ou tem consequência
 * alterada — vai para a trilha de auditoria junto com a classificação, de modo que se saiba
 * QUAL matriz classificou um documento.
 */
export const SEFAZ_CSTAT_MATRIX_VERSION = "018.2" as const

/**
 * Desfecho canônico de um `cStat`.
 *
 * ⚠️ `LOTE_PROCESSADO` **não é um desfecho de documento** — é a instrução estrutural de que a
 * resposta é de lote (`cStat 104`) e que a decisão real está no protocolo interno
 * (`protNFe/infProt/cStat`). O parser desce até lá e reclassifica; nada além do parser deve
 * observar este valor.
 */
export type SefazCStatOutcome =
  | "AUTHORIZED"
  | "REJECTED"
  | "PROCESSING"
  | "THROTTLED"
  | "NOT_FOUND"
  | "LOTE_PROCESSADO"
  | "UNCERTAIN"

/**
 * Motivo estável da classificação. Cobre tanto os motivos vindos da matriz quanto os motivos
 * ESTRUTURAIS que o parser produz antes de haver qualquer `cStat` para consultar.
 *
 * Nenhum motivo carrega conteúdo do documento: são constantes fechadas, próprias para log.
 */
export type SefazResponseReason =
  /** `100` com protocolo e XML autorizado verificáveis. */
  | "AUTORIZADO"
  /** `101` em NFeRecepcaoEvento4 — Cancelamento de NF-e homologado (Q-05). */
  | "CANCELAMENTO_HOMOLOGADO"
  /** `135` em NFeRecepcaoEvento4 — Evento registrado e vinculado à NF-e. */
  | "EVENTO_REGISTRADO"
  /** Rejeição definitiva lida e reconhecida na matriz. */
  | "REJEICAO_TERMINAL"
  /** `103`/`105` — lote com a SEFAZ, aguardando processamento. */
  | "LOTE_EM_PROCESSAMENTO"
  /** `656` — consumo indevido. Parada dura. */
  | "CONSUMO_INDEVIDO"
  /** `217` em consulta — documento não consta. */
  | "NAO_CONSTA"
  /** `108`/`109` — serviço paralisado. */
  | "SERVICE_UNAVAILABLE"
  /** `204` — duplicidade: consultar e convergir, jamais retransmitir por conta própria. */
  | "DUPLICATE_REQUIRES_CONSULTATION"
  /** `100` sem protocolo ou sem XML autorizado verificável. Nunca vira AUTHORIZED. */
  | "INCOMPLETE_AUTHORIZATION"
  /** `103`/`105` sem recibo — sem `nRec` não há o que consultar. */
  | "PROCESSING_SEM_RECIBO"
  /** `cStat` fora da matriz. */
  | "UNKNOWN"
  /** SOAP Fault identificado explicitamente. */
  | "SOAP_FAULT"
  /** Resposta estruturalmente válida, porém sem `cStat` no caminho esperado. */
  | "MISSING_CSTAT"
  /** Bytes ilegíveis, XML mal-formado, DTD, CDATA, BOM inesperado, tamanho excedido. */
  | "MALFORMED_RESPONSE"
  /** Dois `cStat` conflitantes, dois `Body`, dois wrappers — leitura ambígua. */
  | "AMBIGUOUS_RESPONSE"
  /** Wrapper, namespace ou payload de serviço diferente do esperado. */
  | "SERVICE_MISMATCH"
  /** Resposta bem-formada, porém referente a OUTRA chave de acesso. */
  | "DOCUMENT_MISMATCH"
  /**
   * O chamador não informou (ou informou em formato inválido) a chave de acesso que espera.
   *
   * Sem esse contexto não existe prova de vínculo entre a resposta e o documento em curso, e
   * uma autorização "bem-formada" poderia pertencer a outra nota. Recusa-se a leitura inteira.
   */
  | "MISSING_DOCUMENT_CONTEXT"

/**
 * Consequências fiscais de um desfecho. São a razão de ser da matriz: substituem o literal
 * `requiresInutilizacao: true` que o coordenador aplicava a QUALQUER rejeição.
 */
export type SefazFiscalConsequences = {
  /** O desfecho encerra a vida do documento (nada mais a esperar da SEFAZ)? */
  readonly terminal: boolean
  /** O número de série foi (ou pode ter sido) consumido e não pode ser reutilizado? */
  readonly numeroConsumido: boolean
  /** Exige inutilização do número? ⚠️ Ação fiscal destrutiva — só quando a matriz manda. */
  readonly requiresInutilizacao: boolean
  /** Exige consulta à SEFAZ para convergir? */
  readonly requiresConsultation: boolean
}

export type SefazCStatEntry = {
  readonly cStat: string
  readonly outcome: SefazCStatOutcome
  readonly reason: SefazResponseReason
  /** Rótulo curto e estável para trilha. Não é o `xMotivo` da resposta. */
  readonly rotulo: string
  /** Serviços em que a SEFAZ pode legitimamente devolver este código. */
  readonly servicos: readonly SefazServico[]
  /** `nProt` não vazio é obrigatório para o desfecho valer. */
  readonly exigeProtocolo: boolean
  /** XML autorizado verificável é obrigatório para o desfecho valer. */
  readonly exigeXmlAutorizado: boolean
  /** `nRec` não vazio é obrigatório para o desfecho valer. */
  readonly exigeRecibo: boolean
  readonly consequencias: SefazFiscalConsequences
}

function consequencias(input: Partial<SefazFiscalConsequences>): SefazFiscalConsequences {
  return Object.freeze({
    terminal: input.terminal ?? false,
    numeroConsumido: input.numeroConsumido ?? false,
    requiresInutilizacao: input.requiresInutilizacao ?? false,
    requiresConsultation: input.requiresConsultation ?? false,
  })
}

/** Consequências de uma resposta que não classificou nada. Nenhuma ação fiscal decorre daqui. */
export const SEFAZ_CONSEQUENCIA_INDETERMINADA: SefazFiscalConsequences = consequencias({
  requiresConsultation: true,
})

/**
 * Consequências de uma falha ESTRUTURAL (mal-formada, ambígua, serviço divergente, SOAP Fault).
 *
 * `requiresConsultation: false` é deliberado e diferente do caso acima: uma resposta que sequer
 * pôde ser lida não prova que houve transmissão a consultar. Quem decide agendar consulta é o
 * coordenador, a partir do desfecho — não este objeto.
 */
export const SEFAZ_CONSEQUENCIA_ESTRUTURAL: SefazFiscalConsequences = consequencias({})

/** Serviços que carregam desfecho de documento. `NFeStatusServico4` não está entre eles. */
const SERVICOS_COM_DESFECHO: readonly SefazServico[] = Object.freeze([
  "NFeAutorizacao4",
  "NFeRetAutorizacao4",
  "NFeConsultaProtocolo4",
])

/** Serviços de LOTE — os únicos que falam de recibo, processamento e protocolo de lote. */
const SERVICOS_DE_LOTE: readonly SefazServico[] = Object.freeze([
  "NFeAutorizacao4",
  "NFeRetAutorizacao4",
])

/** Consulta por chave — o único lugar onde "não consta" é resposta legítima. */
const SERVICOS_DE_CONSULTA: readonly SefazServico[] = Object.freeze(["NFeConsultaProtocolo4"])

/** Evento de cancelamento/CC-e — NFeRecepcaoEvento4. Não herda códigos de autorização. */
const SERVICOS_DE_EVENTO: readonly SefazServico[] = Object.freeze(["NFeRecepcaoEvento4"])

const ENTRADAS: readonly SefazCStatEntry[] = Object.freeze([
  Object.freeze({
    cStat: "100",
    outcome: "AUTHORIZED",
    reason: "AUTORIZADO",
    rotulo: "Autorizado o uso da NF-e",
    servicos: SERVICOS_COM_DESFECHO,
    exigeProtocolo: true,
    exigeXmlAutorizado: true,
    exigeRecibo: false,
    // Documento autorizado: número definitivamente consumido, nada a inutilizar, nada a consultar.
    consequencias: consequencias({ terminal: true, numeroConsumido: true }),
  }),
  Object.freeze({
    cStat: "101",
    outcome: "AUTHORIZED",
    reason: "CANCELAMENTO_HOMOLOGADO",
    rotulo: "Cancelamento de NF-e homologado (consulta de documento; não autoriza RecepcaoEvento4)",
    servicos: SERVICOS_DE_CONSULTA,
    exigeProtocolo: true,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    consequencias: consequencias({ terminal: true, numeroConsumido: true }),
  }),
  Object.freeze({
    cStat: "135",
    outcome: "AUTHORIZED",
    reason: "EVENTO_REGISTRADO",
    rotulo: "Evento registrado e vinculado a NF-e",
    servicos: SERVICOS_DE_EVENTO,
    exigeProtocolo: true,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    consequencias: consequencias({ terminal: true, numeroConsumido: true }),
  }),
  Object.freeze({
    cStat: "103",
    outcome: "PROCESSING",
    reason: "LOTE_EM_PROCESSAMENTO",
    rotulo: "Lote recebido com sucesso",
    servicos: SERVICOS_DE_LOTE,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: true,
    /**
     * O lote JÁ está com a SEFAZ. `numeroConsumido: true` é conservador e correto: mesmo antes
     * de saber o desfecho, aquele número não pode ser reaproveitado por outro documento.
     */
    consequencias: consequencias({ numeroConsumido: true, requiresConsultation: true }),
  }),
  Object.freeze({
    cStat: "104",
    outcome: "LOTE_PROCESSADO",
    reason: "UNKNOWN",
    rotulo: "Lote processado",
    servicos: SERVICOS_DE_LOTE,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    /**
     * Instrução estrutural, não desfecho. As consequências reais vêm do `cStat` do protocolo
     * interno; por isso nada é declarado aqui — e `reason: "UNKNOWN"` nunca chega a ser
     * publicado, porque o parser SEMPRE reclassifica ao descer.
     */
    consequencias: SEFAZ_CONSEQUENCIA_ESTRUTURAL,
  }),
  Object.freeze({
    cStat: "105",
    outcome: "PROCESSING",
    reason: "LOTE_EM_PROCESSAMENTO",
    rotulo: "Lote em processamento",
    servicos: SERVICOS_DE_LOTE,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: true,
    consequencias: consequencias({ numeroConsumido: true, requiresConsultation: true }),
  }),
  Object.freeze({
    cStat: "108",
    outcome: "UNCERTAIN",
    reason: "SERVICE_UNAVAILABLE",
    rotulo: "Serviço paralisado momentaneamente",
    servicos: SERVICOS_COM_DESFECHO,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    /**
     * Serviço fora do ar **não** prova que o documento não chegou. Consulta obrigatória antes
     * de qualquer novo envio (D7).
     */
    consequencias: consequencias({ requiresConsultation: true }),
  }),
  Object.freeze({
    cStat: "109",
    outcome: "UNCERTAIN",
    reason: "SERVICE_UNAVAILABLE",
    rotulo: "Serviço paralisado sem previsão",
    servicos: SERVICOS_COM_DESFECHO,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    consequencias: consequencias({ requiresConsultation: true }),
  }),
  Object.freeze({
    cStat: "110",
    outcome: "REJECTED",
    reason: "REJEICAO_TERMINAL",
    rotulo: "Uso denegado",
    servicos: SERVICOS_COM_DESFECHO,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    /**
     * ⚠️ Denegação: terminal e com **número consumido**, porém **`requiresInutilizacao: false`**.
     * Um documento denegado já está registrado na SEFAZ — a inutilização se aplica a números
     * que NUNCA foram usados, e emiti-la aqui seria pedir uma ação fiscal destrutiva e indevida.
     * O tratamento do número denegado pertence ao GOAL-019, sob decisão humana.
     */
    consequencias: consequencias({ terminal: true, numeroConsumido: true }),
  }),
  Object.freeze({
    cStat: "204",
    outcome: "UNCERTAIN",
    reason: "DUPLICATE_REQUIRES_CONSULTATION",
    rotulo: "Duplicidade de NF-e",
    servicos: SERVICOS_DE_LOTE,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    /**
     * "Já existe" — logo o número foi consumido por ALGUMA transmissão. O desfecho daquela
     * transmissão é desconhecido, então a única saída é **consultar e convergir**. Jamais tratar
     * como erro nem como autorização para retransmitir (D7).
     */
    consequencias: consequencias({ numeroConsumido: true, requiresConsultation: true }),
  }),
  Object.freeze({
    cStat: "217",
    outcome: "NOT_FOUND",
    reason: "NAO_CONSTA",
    rotulo: "NF-e não consta na base",
    /** ⛔ SOMENTE em consulta. Em resposta de autorização é divergência estrutural. */
    servicos: SERVICOS_DE_CONSULTA,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    /** Documento inexistente na SEFAZ: número não consumido, retransmissão exata liberada. */
    consequencias: consequencias({}),
  }),
  Object.freeze({
    cStat: "656",
    outcome: "THROTTLED",
    reason: "CONSUMO_INDEVIDO",
    rotulo: "Consumo indevido",
    servicos: SERVICOS_COM_DESFECHO,
    exigeProtocolo: false,
    exigeXmlAutorizado: false,
    exigeRecibo: false,
    /**
     * ⛔ `requiresConsultation: false` é o coração do D12.2. Consultar após um `656` alimenta
     * exatamente o padrão de *looping* que o código denuncia. O documento continua
     * `TRANSMITINDO` e o desfecho continua desconhecido — por isso `numeroConsumido: true`,
     * conservador — mas **nada é agendado**: a retomada é humana.
     */
    consequencias: consequencias({ numeroConsumido: true }),
  }),
])

const POR_CODIGO: ReadonlyMap<string, SefazCStatEntry> = new Map(
  ENTRADAS.map((entrada) => [entrada.cStat, entrada]),
)

/** Matriz completa, congelada. Exportada para que os testes a percorram inteira. */
export const SEFAZ_CSTAT_MATRIX: readonly SefazCStatEntry[] = ENTRADAS

export type SefazCStatLookup =
  | { readonly ok: true; readonly entry: SefazCStatEntry }
  | { readonly ok: false; readonly reason: Extract<SefazResponseReason, "UNKNOWN" | "SERVICE_MISMATCH"> }

/**
 * Consulta a matriz para um `cStat` **no contexto do serviço** que produziu a resposta.
 *
 * Duas recusas possíveis, ambas terminando em `UNCERTAIN` no parser:
 *  - `UNKNOWN` — código fora da matriz;
 *  - `SERVICE_MISMATCH` — código conhecido, porém impossível naquele serviço (ex.: `217` numa
 *    resposta de autorização). Tratá-lo como `NOT_FOUND` ali autorizaria uma retransmissão sem
 *    que consulta alguma tivesse ocorrido.
 */
export function lookupSefazCStat(cStat: string, servico: SefazServico): SefazCStatLookup {
  const entry = POR_CODIGO.get(cStat)
  if (!entry) return { ok: false, reason: "UNKNOWN" }
  if (!entry.servicos.includes(servico)) return { ok: false, reason: "SERVICE_MISMATCH" }
  return { ok: true, entry }
}
