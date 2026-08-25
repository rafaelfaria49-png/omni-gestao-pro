/**
 * Contador HUB · montagem pura do checklist de fechamento (GOAL 007 · 007B).
 *
 * Prefere o DTO já carregado pelo GOAL 006 — zero reconsulta Prisma/readers.
 * Sinais sem evidência suficiente → `nao_disponivel` (nunca inventados).
 * Semântica honesta (007B): vendas sem movimento ficam `pendente`; sessões
 * respeitam competência passada/atual/futura via `agora`; vencimento de títulos
 * permanece `nao_disponivel` sem prova agregada; o domínio Documentos existe,
 * mas este checklist não consulta o acervo dele. A Conferência do contador ainda
 * não tem persistência. Fechamento real com snapshot permanece fora de escopo
 * (GOAL 012).
 */
import { competenciaAtual, type Competencia } from "@/lib/contador/competencia"
import {
  mensagemFiscalIndisponivel,
  type EvidenciaFiscalChecklist,
} from "@/lib/contador/readers/fiscal"
import type {
  ContadorDadosReais,
  DadoMonetario,
  DadoNumerico,
} from "@/lib/contador/readers/tipos"
import type {
  ChecklistFechamento,
  ChecklistItemFechamento,
  ContagemChecklist,
  EstadoChecklistItem,
} from "./tipos"

const DISCLAIMER =
  "Checklist derivado de sinais reais da competência — somente leitura. " +
  "Não constitui fechamento oficial, snapshot nem trava de competência. " +
  "O fechamento real com snapshot será implementado em fase posterior (GOAL 012)."

/**
 * Tolerância monetária de conferência de caixa (R$ 0,01 = 1 centavo).
 * Diferença absoluta arredondada ≤ este limiar é considerada conciliada (`ok`).
 */
export const LIMIAR_DIVERGENCIA_CAIXA = 0.01

/** Explicação fixa do sinal de títulos vencidos (o DTO não prova vencimento). */
const EXPLICACAO_TITULOS_VENCIDOS =
  "O resumo atual informa títulos em aberto na competência, mas não permite " +
  "confirmar quais já estão vencidos em relação à data de hoje."

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

/**
 * Evidência opcional de guias da agenda (GOAL 016).
 *
 * Montada FORA desta função (page.tsx). Nunca consultar Prisma aqui.
 * `leituraOk: false` = a leitura da agenda falhou — o sinal fica `nao_disponivel`
 * sem derrubar os demais.
 */
export type EvidenciaAgendaGuias = Readonly<{
  leituraOk: boolean
  total: number
  vencidas: number
  vencendo: number
  pagas: number
}>

export type MontarChecklistFechamentoInput = Readonly<{
  /** DTO do GOAL 006. `null` = escopo/leitura indisponível (todos os sinais sem evidência). */
  dados: ContadorDadosReais | null
  competencia: Competencia
  /** Instante de montagem (injetável para testes). Participa da decisão temporal das sessões. */
  agora?: Date
  /** Motivo honesto quando `dados` é null (escopo, cookie, ACL, falha). */
  motivoIndisponivel?: string | null
  /**
   * Resumo mínimo de guias da competência (GOAL 016). Ausência ou falha →
   * sinal `guias_informadas_vencendo_vencidas` = `nao_disponivel`.
   */
  evidenciaAgenda?: EvidenciaAgendaGuias | null
  /**
   * Leitura fiscal (GOAL 018). Ausência / flag off / loja fora da allowlist /
   * falha → sinal `fiscal` = `nao_disponivel` (nunca “zero notas”).
   * Não altera os demais sinais.
   */
  evidenciaFiscal?: EvidenciaFiscalChecklist | null
}>

type PosicaoCompetencia = "passada" | "atual" | "futura"

function fmtMoney(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—"
  return BRL.format(valor)
}

/** Arredondamento monetário consistente (2 casas), evitando ruído de ponto flutuante. */
function arredCentavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Posição temporal da competência selecionada em relação a `agora`,
 * usando o contrato canônico (`competenciaAtual`, America/Sao_Paulo).
 * Sem parser paralelo de competência.
 */
function posicaoCompetencia(alvo: Competencia, agora: Date): PosicaoCompetencia {
  const atual = competenciaAtual(agora)
  const a = alvo.ano * 12 + (alvo.mes - 1)
  const b = atual.ano * 12 + (atual.mes - 1)
  if (a < b) return "passada"
  if (a > b) return "futura"
  return "atual"
}

function contagemDe(itens: readonly ChecklistItemFechamento[]): ContagemChecklist {
  const c = { ok: 0, atencao: 0, pendente: 0, nao_disponivel: 0, total: itens.length }
  for (const it of itens) {
    c[it.estado] += 1
  }
  return Object.freeze(c)
}

function item(
  partial: Omit<ChecklistItemFechamento, "estado"> & { estado: EstadoChecklistItem },
): ChecklistItemFechamento {
  return Object.freeze({ ...partial })
}

function dispDe(d: DadoMonetario | DadoNumerico): "real" | "parcial" | "indisponivel" {
  return d.disponibilidade
}

/**
 * Monta o checklist de fechamento a partir do DTO já carregado.
 * Puro e determinístico para o mesmo `dados` + `agora`.
 */
export function montarChecklistFechamento(
  input: MontarChecklistFechamentoInput,
): ChecklistFechamento {
  const { dados, competencia, motivoIndisponivel } = input
  const agora = input.agora ?? new Date()
  const geradoEm = agora.toISOString()
  const posicao = posicaoCompetencia(competencia, agora)

  // Sinais sem Prisma nesta função: Documentos/Conferência (ainda sem evidência
  // agregada), guias (GOAL 016 — evidência opcional injetada) e Fechamento oficial.
  const cauda = [
    derivarDocumentos(),
    derivarConferenciaContador(),
    derivarGuiasInformadas(input.evidenciaAgenda),
    derivarFechamentoOficial(),
  ]

  if (!dados) {
    const motivo =
      motivoIndisponivel?.trim() ||
      "Dados reais da competência não estão disponíveis (escopo ou leitura)."
    const derivados = SINAIS_DERIVADOS_BASE.map((s) =>
      s.id === "fiscal"
        ? derivarFiscal(input.evidenciaFiscal)
        : item({
            id: s.id,
            titulo: s.titulo,
            estado: "nao_disponivel",
            origem: "ContadorDadosReais (ausente)",
            explicacao: motivo,
            evidencia: "sem DTO",
          }),
    )
    const itens = [...derivados, ...cauda]
    return Object.freeze({
      competencia: Object.freeze({ ano: competencia.ano, mes: competencia.mes }),
      itens: Object.freeze(itens),
      contagem: contagemDe(itens),
      disclaimer: DISCLAIMER,
      geradoEm,
    })
  }

  const derivados: ChecklistItemFechamento[] = [
    derivarVendas(dados),
    derivarDevolucoes(dados),
    derivarLiquido(dados),
    derivarFormasPagamento(dados),
    derivarMovimentacoes(dados),
    derivarTitulosVencidosReceber(dados),
    derivarTitulosVencidosPagar(dados),
    derivarSessoesCaixa(dados, posicao),
    derivarDiferencasCaixa(dados),
    derivarFiscal(input.evidenciaFiscal),
  ]
  const itens = [...derivados, ...cauda]

  return Object.freeze({
    competencia: Object.freeze({
      ano: dados.competencia.ano,
      mes: dados.competencia.mes,
    }),
    itens: Object.freeze(itens),
    contagem: contagemDe(itens),
    disclaimer: DISCLAIMER,
    geradoEm,
  })
}

/* ─────────────────────────── sinais ─────────────────────────── */

/** Sinais derivados do DTO — quando `dados` é null viram `nao_disponivel`. */
const SINAIS_DERIVADOS_BASE = [
  { id: "vendas", titulo: "Vendas da competência" },
  { id: "devolucoes", titulo: "Devoluções da competência" },
  { id: "liquido", titulo: "Líquido da competência" },
  { id: "formas_pagamento", titulo: "Formas de pagamento das vendas" },
  { id: "movimentacoes", titulo: "Movimentações financeiras" },
  { id: "titulos_vencidos_receber", titulo: "Títulos vencidos a receber" },
  { id: "titulos_vencidos_pagar", titulo: "Títulos vencidos a pagar" },
  { id: "sessoes_caixa", titulo: "Sessões de caixa da competência" },
  { id: "diferencas_caixa", titulo: "Diferenças de conferência de caixa" },
  { id: "fiscal", titulo: "Notas fiscais da competência" },
] as const

function derivarVendas(dados: ContadorDadosReais): ChecklistItemFechamento {
  const { quantidade, total } = dados.vendas
  const origem = total.fonte
  if (dispDe(total) === "indisponivel" || dispDe(quantidade) === "indisponivel") {
    return item({
      id: "vendas",
      titulo: "Vendas da competência",
      estado: "nao_disponivel",
      origem,
      explicacao: total.observacao ?? "Fonte de vendas indisponível; não há evidência segura.",
      evidencia: "—",
    })
  }
  const qtd = quantidade.valor ?? 0
  const valor = total.valor ?? 0
  if (qtd === 0) {
    // Zero real NÃO é conclusão de fechamento: exige confirmação humana.
    return item({
      id: "vendas",
      titulo: "Vendas da competência",
      estado: "pendente",
      origem,
      explicacao:
        "Nenhuma venda foi registrada nesta competência. Confirme se o período realmente não teve movimento.",
      evidencia: `${qtd} · ${fmtMoney(valor)}`,
    })
  }
  return item({
    id: "vendas",
    titulo: "Vendas da competência",
    estado: "ok",
    origem,
    explicacao: `${qtd} venda(s) não-cancelada(s) lidas de Venda.total (exclui canceladas).`,
    evidencia: `${qtd} · ${fmtMoney(valor)}`,
  })
}

function derivarDevolucoes(dados: ContadorDadosReais): ChecklistItemFechamento {
  const { quantidade, total } = dados.devolucoes
  const origem = total.fonte
  if (dispDe(total) === "indisponivel") {
    return item({
      id: "devolucoes",
      titulo: "Devoluções da competência",
      estado: "nao_disponivel",
      origem,
      explicacao: total.observacao ?? "Fonte de devoluções indisponível.",
      evidencia: "—",
    })
  }
  const qtd = quantidade.valor ?? 0
  const valor = total.valor ?? 0
  return item({
    id: "devolucoes",
    titulo: "Devoluções da competência",
    estado: "ok",
    origem,
    explicacao:
      qtd === 0
        ? "Nenhuma devolução na competência (leitura real)."
        : `${qtd} devolução(ões) reduzem o líquido da competência em que ocorreram.`,
    evidencia: `${qtd} · ${fmtMoney(valor)}`,
  })
}

function derivarLiquido(dados: ContadorDadosReais): ChecklistItemFechamento {
  const liq = dados.liquidoCompetencia
  if (dispDe(liq) === "indisponivel") {
    return item({
      id: "liquido",
      titulo: "Líquido da competência",
      estado: "nao_disponivel",
      origem: liq.fonte,
      explicacao: liq.observacao ?? "Líquido não calculável sem vendas e devoluções.",
      evidencia: "—",
    })
  }
  return item({
    id: "liquido",
    titulo: "Líquido da competência",
    estado: "ok",
    origem: liq.fonte,
    explicacao: liq.observacao ?? "Vendas − devoluções (subtração única).",
    evidencia: fmtMoney(liq.valor),
  })
}

function derivarFormasPagamento(dados: ContadorDadosReais): ChecklistItemFechamento {
  const v = dados.vendas
  const origem = "Venda.payload.paymentBreakdown"
  if (v.formaPagamentoDisponibilidade === "indisponivel" || dispDe(v.total) === "indisponivel") {
    return item({
      id: "formas_pagamento",
      titulo: "Formas de pagamento das vendas",
      estado: "nao_disponivel",
      origem,
      explicacao: "Fonte de vendas/breakdown indisponível; não há evidência de formas de pagamento.",
      evidencia: "—",
    })
  }

  const rec = v.reconciliacaoPagamento
  const residual = rec?.residualNaoIdentificado ?? 0
  const excedente = rec?.excedenteBreakdown ?? 0
  const naoId = v.naoIdentificadoQuantidade.valor ?? 0

  if (residual > 0 || excedente > 0 || naoId > 0 || v.formaPagamentoDisponibilidade === "parcial") {
    const partes: string[] = []
    if (residual > 0) partes.push(`residual ${fmtMoney(residual)}`)
    if (excedente > 0) partes.push(`excedente ${fmtMoney(excedente)}`)
    if (naoId > 0) partes.push(`${naoId} venda(s) sem forma completa`)
    if (v.formaPagamentoDisponibilidade === "parcial" && partes.length === 0) {
      partes.push("cobertura parcial do breakdown")
    }
    return item({
      id: "formas_pagamento",
      titulo: "Formas de pagamento das vendas",
      estado: "atencao",
      origem,
      explicacao: `Breakdown com ressalva: ${partes.join("; ")}. O total autoritativo continua sendo Venda.total.`,
      evidencia: rec
        ? `reconciliado=${rec.reconciliado ? "sim" : "não"} · divergência ${fmtMoney(rec.divergenciaAbsoluta)}`
        : "parcial",
    })
  }

  return item({
    id: "formas_pagamento",
    titulo: "Formas de pagamento das vendas",
    estado: "ok",
    origem,
    explicacao: "Breakdown reconciliado com Venda.total (sem residual/excedente reportado).",
    evidencia: rec ? `total breakdown ${fmtMoney(rec.totalBreakdown)}` : "ok",
  })
}

function derivarMovimentacoes(dados: ContadorDadosReais): ChecklistItemFechamento {
  const f = dados.financeiro
  const origem = f.entradasRealizadas.fonte
  if (
    dispDe(f.entradasRealizadas) === "indisponivel" ||
    dispDe(f.saidasRealizadas) === "indisponivel"
  ) {
    return item({
      id: "movimentacoes",
      titulo: "Movimentações financeiras",
      estado: "nao_disponivel",
      origem,
      explicacao:
        f.entradasRealizadas.observacao ??
        "Fonte MovimentacaoFinanceira indisponível.",
      evidencia: "—",
    })
  }

  const naoClass = f.naoClassificadosQuantidade.valor ?? 0
  if (naoClass > 0) {
    return item({
      id: "movimentacoes",
      titulo: "Movimentações financeiras",
      estado: "atencao",
      origem,
      explicacao: `${naoClass} movimento(s) com origem não classificada ficaram fora de entradas/saídas.`,
      evidencia: `entradas ${fmtMoney(f.entradasRealizadas.valor)} · saídas ${fmtMoney(f.saidasRealizadas.valor)} · não class. ${fmtMoney(f.naoClassificados.valor)}`,
    })
  }

  return item({
    id: "movimentacoes",
    titulo: "Movimentações financeiras",
    estado: "ok",
    origem,
    explicacao: "Entradas e saídas realizadas lidas de MovimentacaoFinanceira (sem origens órfãs).",
    evidencia: `entradas ${fmtMoney(f.entradasRealizadas.valor)} · saídas ${fmtMoney(f.saidasRealizadas.valor)}`,
  })
}

/**
 * Títulos vencidos — o DTO só informa títulos em aberto com vencimento NA competência,
 * não a posição comprovadamente vencida contra `agora`. Estado permanece `nao_disponivel`
 * (não inferimos vencimento); a evidência reporta honestamente o que existe.
 */
function derivarTitulosVencidos(args: {
  id: string
  titulo: string
  mon: DadoMonetario
  qtd: DadoNumerico
}): ChecklistItemFechamento {
  const { id, titulo, mon, qtd } = args
  const disp = dispDe(mon)
  let evidencia: string
  if (disp === "indisponivel") {
    evidencia = "fonte de títulos indisponível — sem base para apurar vencimento"
  } else {
    const n = qtd.valor ?? 0
    const partes = [`${n} em aberto`, fmtMoney(mon.valor)]
    if (disp === "parcial") partes.push("cobertura parcial")
    partes.push("vencimento não comprovado")
    evidencia = partes.join(" · ")
  }
  return item({
    id,
    titulo,
    estado: "nao_disponivel",
    origem: mon.fonte,
    explicacao: EXPLICACAO_TITULOS_VENCIDOS,
    evidencia,
  })
}

function derivarTitulosVencidosReceber(dados: ContadorDadosReais): ChecklistItemFechamento {
  return derivarTitulosVencidos({
    id: "titulos_vencidos_receber",
    titulo: "Títulos vencidos a receber",
    mon: dados.financeiro.titulosReceberAberto,
    qtd: dados.financeiro.titulosReceberQuantidade,
  })
}

function derivarTitulosVencidosPagar(dados: ContadorDadosReais): ChecklistItemFechamento {
  return derivarTitulosVencidos({
    id: "titulos_vencidos_pagar",
    titulo: "Títulos vencidos a pagar",
    mon: dados.financeiro.titulosPagarAberto,
    qtd: dados.financeiro.titulosPagarQuantidade,
  })
}

function derivarSessoesCaixa(
  dados: ContadorDadosReais,
  posicao: PosicaoCompetencia,
): ChecklistItemFechamento {
  const sessoes = dados.caixa.sessoes
  const abertas = dados.caixa.sessoesAbertas
  const origem = sessoes.fonte
  if (dispDe(sessoes) === "indisponivel") {
    return item({
      id: "sessoes_caixa",
      titulo: "Sessões de caixa da competência",
      estado: "nao_disponivel",
      origem,
      explicacao: sessoes.observacao ?? "Fonte SessaoCaixa indisponível.",
      evidencia: "—",
    })
  }
  const total = sessoes.valor ?? 0
  const nAbertas = abertas.valor ?? 0
  const evidencia = `${total} sessão(ões) · ${nAbertas} aberta(s)`

  // Competência futura nunca é `ok`: sinais de caixa não representam fechamento concluído.
  if (posicao === "futura") {
    return item({
      id: "sessoes_caixa",
      titulo: "Sessões de caixa da competência",
      estado: "pendente",
      origem,
      explicacao:
        "A competência ainda é futura; os sinais de caixa não representam um fechamento concluído.",
      evidencia,
    })
  }

  if (nAbertas > 0) {
    if (posicao === "passada") {
      return item({
        id: "sessoes_caixa",
        titulo: "Sessões de caixa da competência",
        estado: "atencao",
        origem,
        explicacao: `Há ${nAbertas} sessão(ões) de caixa da competência passada ainda aberta(s).`,
        evidencia,
      })
    }
    // atual
    return item({
      id: "sessoes_caixa",
      titulo: "Sessões de caixa da competência",
      estado: "pendente",
      origem,
      explicacao: `Há ${nAbertas} sessão(ões) de caixa em andamento na competência atual.`,
      evidencia,
    })
  }

  // Passada ou atual, sem sessão aberta e com fonte disponível → ok.
  return item({
    id: "sessoes_caixa",
    titulo: "Sessões de caixa da competência",
    estado: "ok",
    origem,
    explicacao:
      total === 0
        ? "Nenhuma sessão de caixa no período da competência; nada em aberto."
        : `${total} sessão(ões) no período; nenhuma permanece aberta.`,
    evidencia,
  })
}

function derivarDiferencasCaixa(dados: ContadorDadosReais): ChecklistItemFechamento {
  const d = dados.caixa.diferencas
  const origem = d.fonte
  if (dispDe(d) === "indisponivel") {
    return item({
      id: "diferencas_caixa",
      titulo: "Diferenças de conferência de caixa",
      estado: "nao_disponivel",
      origem,
      explicacao: d.observacao ?? "Sem sessões fechadas com conferência de saldo.",
      evidencia: "—",
    })
  }
  const valor = arredCentavos(d.valor ?? 0)
  const abs = Math.abs(valor)
  const tol = fmtMoney(LIMIAR_DIVERGENCIA_CAIXA)

  if (dispDe(d) === "parcial") {
    return item({
      id: "diferencas_caixa",
      titulo: "Diferenças de conferência de caixa",
      estado: "atencao",
      origem,
      explicacao: d.observacao ?? "Conferência parcial entre sessões fechadas.",
      evidencia: fmtMoney(valor),
    })
  }

  if (abs > LIMIAR_DIVERGENCIA_CAIXA) {
    return item({
      id: "diferencas_caixa",
      titulo: "Diferenças de conferência de caixa",
      estado: "atencao",
      origem,
      explicacao: `Diferença de conferência acima da tolerância de ${tol} (Σ saldoContado − saldoFinal = ${fmtMoney(valor)}).`,
      evidencia: fmtMoney(valor),
    })
  }

  return item({
    id: "diferencas_caixa",
    titulo: "Diferenças de conferência de caixa",
    estado: "ok",
    origem,
    explicacao: `Sessões conferidas dentro da tolerância de ${tol} (Σ saldoContado − saldoFinal = ${fmtMoney(valor)}).`,
    evidencia: fmtMoney(valor),
  })
}

function derivarFiscal(evidencia: EvidenciaFiscalChecklist | null | undefined): ChecklistItemFechamento {
  const id = "fiscal"
  const titulo = "Notas fiscais da competência"
  const origem = "NotaFiscal (CONTADOR_FISCAL_READER)"

  if (!evidencia || evidencia.disponivel !== true || evidencia.leituraOk !== true) {
    return item({
      id,
      titulo,
      estado: "nao_disponivel",
      origem,
      explicacao: mensagemFiscalIndisponivel(evidencia?.motivo),
      evidencia: evidencia?.motivo ?? "não consultado",
    })
  }

  const ev = `${evidencia.entregaveis} entregável(is) · ${evidencia.rejeitadas} rejeitada(s) · ${evidencia.canceladas} cancelada(s)`

  if (evidencia.rejeitadas > 0) {
    return item({
      id,
      titulo,
      estado: "atencao",
      origem,
      explicacao: `${evidencia.rejeitadas} nota(s) REJEITADA(s) na leitura. Nenhuma rejeitada entra em 05-XML.`,
      evidencia: ev,
    })
  }

  if (evidencia.entregaveis === 0 && evidencia.canceladas > 0) {
    return item({
      id,
      titulo,
      estado: "atencao",
      origem,
      explicacao: `${evidencia.canceladas} nota(s) CANCELADA(s). Canceladas não entram em 05-XML nesta fase.`,
      evidencia: ev,
    })
  }

  if (evidencia.entregaveis === 0) {
    return item({
      id,
      titulo,
      estado: "pendente",
      origem,
      explicacao:
        "Leitura fiscal ativa e sem XML entregável nesta competência. Zero entregáveis é contagem real da fonte, não ausência dela.",
      evidencia: ev,
    })
  }

  return item({
    id,
    titulo,
    estado: "ok",
    origem,
    explicacao:
      evidencia.canceladas > 0
        ? `${evidencia.entregaveis} XML entregável(is). ${evidencia.canceladas} cancelada(s) listada(s) e fora de 05-XML.`
        : `${evidencia.entregaveis} XML autorizado(s) HOMOLOGACAO entregável(is) (ADR-007).`,
    evidencia: ev,
  })
}

/** O domínio Documentos existe; este sinal não consulta o acervo de documentos. */
function derivarDocumentos(): ChecklistItemFechamento {
  return item({
    id: "documentos",
    titulo: "Documentos do fechamento",
    estado: "nao_disponivel",
    origem: "Documentos não avaliados neste sinal do checklist",
    explicacao: "Este sinal não consulta o acervo real do domínio Documentos.",
    evidencia: "sem evidência neste builder",
  })
}

/** Confirmação/conferência do contador ainda não tem persistência (sem checkbox/estado). */
function derivarConferenciaContador(): ChecklistItemFechamento {
  return item({
    id: "conferencia_contador",
    titulo: "Conferência pelo contador",
    estado: "nao_disponivel",
    origem: "Confirmação do contador — ainda sem persistência",
    explicacao:
      "Confirmação e conferência pelo contador ainda não possuem persistência real.",
    evidencia: "sem confirmação persistida",
  })
}

/**
 * Guias informadas (GOAL 016). Puro: só lê `evidenciaAgenda` já carregada.
 * Zero guias NUNCA é `ok` — não prova ausência de obrigação.
 */
function derivarGuiasInformadas(evidencia: EvidenciaAgendaGuias | null | undefined): ChecklistItemFechamento {
  const id = "guias_informadas_vencendo_vencidas"
  const titulo = "Guias informadas (vencendo / vencidas)"
  const origem = "ContadorGuia (agenda · informado pelo responsável)"

  if (!evidencia || evidencia.leituraOk !== true) {
    return item({
      id,
      titulo,
      estado: "nao_disponivel",
      origem,
      explicacao:
        "Não foi possível ler as guias informadas desta competência. " +
        "Os demais sinais do checklist não dependem desta leitura.",
      evidencia: "agenda indisponível",
    })
  }

  if (evidencia.total === 0) {
    return item({
      id,
      titulo,
      estado: "nao_disponivel",
      origem,
      explicacao:
        "Não há guias informadas nesta competência. Isso não prova ausência de obrigação: " +
        "o responsável pode ainda informar uma guia. Valor e vencimento nunca são calculados pelo sistema.",
      evidencia: "0 guias informadas",
    })
  }

  const evidenciaTxt = `${evidencia.total} guia(s) · ${evidencia.vencidas} vencida(s) · ${evidencia.vencendo} vencendo · ${evidencia.pagas} paga(s)`

  if (evidencia.vencidas > 0) {
    return item({
      id,
      titulo,
      estado: "atencao",
      origem,
      explicacao: `${evidencia.vencidas} guia(s) informada(s) já vencida(s) (flag derivada; informado pelo responsável).`,
      evidencia: evidenciaTxt,
    })
  }

  if (evidencia.vencendo > 0) {
    return item({
      id,
      titulo,
      estado: "pendente",
      origem,
      explicacao: `${evidencia.vencendo} guia(s) informada(s) vencendo em até 7 dias (flag derivada; informado pelo responsável).`,
      evidencia: evidenciaTxt,
    })
  }

  return item({
    id,
    titulo,
    estado: "ok",
    origem,
    explicacao:
      "Há guia(s) informada(s) pelo responsável, nenhuma vencida nem vencendo. " +
      "Não constitui apuração fiscal.",
    evidencia: evidenciaTxt,
  })
}

function derivarFechamentoOficial(): ChecklistItemFechamento {
  return item({
    id: "fechamento_oficial",
    titulo: "Fechamento oficial com snapshot",
    estado: "pendente",
    origem: "GOAL 012 (não implementado)",
    explicacao:
      "Não há fechamento real, snapshot nem trava de competência. O botão «Fechar competência» permanece desabilitado até o GOAL 012.",
    evidencia: "sem snapshot",
  })
}
