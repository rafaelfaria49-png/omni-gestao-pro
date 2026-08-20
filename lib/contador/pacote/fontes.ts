/**
 * Contador HUB · Pacote do Contador — arquivos de conteúdo (puro, sem IO/DB/ZIP). GOAL 008B.
 *
 * Estrutura fixa (00-LEIA-ME, 01-VENDAS, 02-FINANCEIRO, 03-CAIXA, 04-DOCUMENTOS, 05-XML).
 * CSVs DETALHADOS (linha a linha, saneados, sem PII/payload) vindos de `carregar-fontes`.
 * Resumo/pendências derivam do DTO agregado do GOAL 006 e do checklist do GOAL 007.
 *
 * Regra de honestidade: valor indisponível → célula VAZIA (nunca 0); cada fonte carrega
 * seu estado (real/parcial/indisponível) e contagem de registros.
 */
import {
  formatCompetencia,
  labelCompetencia,
  type Competencia,
  type PeriodoUtc,
} from "@/lib/contador/competencia"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import type { ChecklistFechamento } from "@/lib/contador/fechamento"
import type { EvidenciaFiscalPacote } from "@/lib/contador/readers/fiscal"
import { mensagemFiscalIndisponivel } from "@/lib/contador/readers/fiscal"
import { montarCsv, numero, texto, type CelulaCsv } from "./csv"
import type { ArquivoPacote, EstadoFonte, FonteManifestoV1 } from "./tipos"
import type { FontesDetalhadasPacote } from "./carregar-fontes"

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

function fmtBRL(valor: number | null): string {
  return valor === null ? "—" : BRL.format(valor)
}
function seloDisp(d: EstadoFonte): string {
  return d === "real" ? "" : ` (${d === "indisponivel" ? "indisponível" : d})`
}

export type EntradaConteudoPacote = Readonly<{
  detalhadas: FontesDetalhadasPacote
  dados: ContadorDadosReais
  checklist: ChecklistFechamento
  competencia: Competencia
  periodo: PeriodoUtc
  agora: Date
  /** GOAL 018 — XML só substitui o placeholder quando a fonte está ativa e há entregáveis. */
  fiscal?: EvidenciaFiscalPacote | null
}>

/* ─────────────────────────── CSVs detalhados ─────────────────────────── */

function csvVendas(d: FontesDetalhadasPacote): string {
  const linhas: CelulaCsv[][] = d.vendas.linhas.map((v) => [
    texto(v.vendaId),
    texto(v.numero),
    texto(v.data),
    texto(v.status),
    numero(v.totalBruto),
    numero(v.descontoInformativo),
    numero(v.devolucoes),
    numero(v.totalLiquido),
    texto(v.formaPagamentoStatus),
  ])
  return montarCsv(
    ["venda_id", "numero", "data", "status", "total_bruto", "desconto_informativo", "devolucoes", "total_liquido", "forma_pagamento_status"],
    linhas,
  )
}

function csvItens(d: FontesDetalhadasPacote): string {
  const linhas: CelulaCsv[][] = d.itens.linhas.map((i) => [
    texto(i.vendaId),
    texto(i.itemId),
    texto(i.produtoCodigo),
    texto(i.produtoDescricao),
    numero(i.quantidade),
    numero(i.valorUnitario),
    numero(i.desconto),
    numero(i.totalItem),
  ])
  return montarCsv(
    ["venda_id", "item_id", "produto_codigo", "produto_descricao", "quantidade", "valor_unitario", "desconto", "total_item"],
    linhas,
  )
}

function csvDevolucoes(d: FontesDetalhadasPacote): string {
  const linhas: CelulaCsv[][] = d.devolucoes.linhas.map((r) => [
    texto(r.devolucaoId),
    texto(r.vendaId),
    texto(r.dataDevolucao),
    numero(r.valor),
    texto(r.status),
  ])
  return montarCsv(["devolucao_id", "venda_id", "data_devolucao", "valor", "status"], linhas)
}

function csvMovimentacoes(d: FontesDetalhadasPacote): string {
  const linhas: CelulaCsv[][] = d.movimentacoes.linhas.map((m) => [
    texto(m.movimentacaoId),
    texto(m.data),
    texto(m.tipo),
    texto(m.classificacao),
    numero(m.valor),
    texto(m.origem),
  ])
  return montarCsv(["movimentacao_id", "data", "tipo", "classificacao", "valor", "origem"], linhas)
}

function csvTitulos(linhasFonte: FontesDetalhadasPacote["contasReceber"]["linhas"]): string {
  const linhas: CelulaCsv[][] = linhasFonte.map((t) => [
    texto(t.tituloId),
    texto(t.vencimento),
    texto(t.status),
    numero(t.valorOriginal),
    numero(t.valorAberto),
    texto(t.disponibilidade),
  ])
  return montarCsv(["titulo_id", "vencimento", "status", "valor_original", "valor_aberto", "disponibilidade"], linhas)
}

function csvSessoes(d: FontesDetalhadasPacote): string {
  const linhas: CelulaCsv[][] = d.sessoes.linhas.map((s) => [
    texto(s.sessaoId),
    texto(s.abertura),
    texto(s.fechamento),
    texto(s.status),
    numero(s.saldoInicial),
    numero(s.saldoFinal),
    numero(s.saldoContado),
    texto(s.diferencaDisponivel ? "sim" : "nao"),
    numero(s.diferenca),
  ])
  return montarCsv(
    ["sessao_id", "abertura", "fechamento", "status", "saldo_inicial", "saldo_final", "saldo_contado", "diferenca_disponivel", "diferenca"],
    linhas,
  )
}

function csvOperacoes(d: FontesDetalhadasPacote): string {
  const linhas: CelulaCsv[][] = d.operacoes.linhas.map((o) => [
    texto(o.operacaoId),
    texto(o.sessaoId),
    texto(o.data),
    texto(o.tipo),
    texto(o.classificacao),
    numero(o.valor),
  ])
  return montarCsv(["operacao_id", "sessao_id", "data", "tipo", "classificacao", "valor"], linhas)
}

/* ─────────────────────────── fontes do manifesto ─────────────────────────── */

/** Descritores de fonte em ordem determinística (para o manifesto). */
export function montarFontesManifesto(
  d: FontesDetalhadasPacote,
  fiscal?: EvidenciaFiscalPacote | null,
): FonteManifestoV1[] {
  const f = (
    nome: string,
    origem: string,
    filtro: string,
    r: { registros: number; estado: EstadoFonte; observacao?: string },
  ): FonteManifestoV1 => ({ nome, origem, filtro, registros: r.registros, estado: r.estado, observacao: r.observacao })
  const PERIODO = "storeId + período UTC da competência [inicio, fimExclusivo)"
  const xml = fonteXml(fiscal)
  return [
    f("vendas", "Venda", `${PERIODO} por at`, d.vendas),
    f("itens", "ItemVenda", "itens de vendas não canceladas da competência", d.itens),
    f("devolucoes", "DevolucaoVenda", `${PERIODO} por at (data da devolução)`, d.devolucoes),
    f("movimentacoes", "MovimentacaoFinanceira", `${PERIODO} por createdAt`, d.movimentacoes),
    f("contas_receber", "ContaReceberTitulo", "títulos em aberto com vencimento na competência (posição atual)", d.contasReceber),
    f("contas_pagar", "ContaPagarTitulo", "títulos em aberto com vencimento na competência (posição atual)", d.contasPagar),
    f("sessoes", "SessaoCaixa", `${PERIODO} por abertaEm`, d.sessoes),
    f("operacoes", "CaixaOperacao", `${PERIODO} por at`, d.operacoes),
    f("xml", "NotaFiscal.xmlAutorizado", "storeId + predicado ADR-007 (HOMOLOGACAO, dhEmi no período, vigente)", xml),
  ]
}

function fonteXml(fiscal?: EvidenciaFiscalPacote | null): {
  registros: number
  estado: EstadoFonte
  observacao?: string
} {
  if (!fiscal || fiscal.disponivel !== true) {
    return {
      registros: 0,
      estado: "indisponivel",
      observacao: mensagemFiscalIndisponivel(fiscal?.motivo),
    }
  }
  return {
    registros: fiscal.entregaveis.length,
    estado: "real",
    observacao:
      fiscal.entregaveis.length === 0
        ? "Leitura fiscal ativa; nenhum XML entregável nesta competência (contagem real)."
        : "XML empacotado = texto UTF-8 persistido em xmlAutorizado, sem reconstrução.",
  }
}

/* ─────────────────────────── Markdown ─────────────────────────── */

export function montarAvisos(fiscal?: EvidenciaFiscalPacote | null): string[] {
  const xmlAviso =
    fiscal?.disponivel === true
      ? fiscal.entregaveis.length > 0
        ? "Notas fiscais (XML): somente AUTORIZADA/HOMOLOGACAO entregáveis (ADR-007); texto UTF-8 persistido, sem reconstrução."
        : "Notas fiscais (XML): leitura fiscal ativa e sem XML entregável nesta competência (contagem real, não ausência da fonte)."
      : "Notas fiscais (XML) não consultadas — placeholder honesto (CONTADOR_FISCAL_READER off, loja fora da allowlist, config inválida ou falha de leitura). Isto não significa zero notas."
  return [
    "Pacote gerado sob demanda; não fica armazenado. Reflete os dados vivos da competência no momento do download.",
    "Não é fechamento oficial, snapshot nem apuração contábil/fiscal.",
    "Dados minimizados: sem nomes, documentos, contatos ou observações livres — apenas IDs técnicos, códigos, valores, datas e status.",
    xmlAviso,
    "Documentos anexos ainda não têm domínio real (chegam após GOALs 009/010).",
  ]
}

/** Pendências para o manifesto e para pendencias.md (checklist ≠ ok + fontes parciais). */
export function montarPendencias(entrada: EntradaConteudoPacote): string[] {
  const { checklist, detalhadas } = entrada
  const out: string[] = []
  for (const it of checklist.itens) {
    if (it.estado !== "ok" && it.estado !== "nao_disponivel") {
      out.push(`[${it.estado}] ${it.titulo} — ${it.explicacao}`)
    }
  }
  for (const fonte of montarFontesManifesto(detalhadas, entrada.fiscal)) {
    if (fonte.estado === "parcial") {
      out.push(`Fonte parcial: ${fonte.nome} — ${fonte.observacao ?? "cobertura incompleta"}`)
    }
  }
  return out
}

/** Itens sem evidência: checklist nao_disponivel + fontes indisponíveis. */
export function montarItensNaoDisponiveis(entrada: EntradaConteudoPacote): string[] {
  const { checklist, detalhadas } = entrada
  const out: string[] = []
  for (const it of checklist.itens) {
    if (it.estado === "nao_disponivel") out.push(`${it.titulo} — ${it.explicacao}`)
  }
  for (const fonte of montarFontesManifesto(detalhadas, entrada.fiscal)) {
    if (fonte.estado === "indisponivel") out.push(`Fonte indisponível: ${fonte.nome} — ${fonte.observacao ?? "leitura falhou"}`)
  }
  return out
}

function resumoMd(entrada: EntradaConteudoPacote): string {
  const { dados, detalhadas, competencia, periodo, agora, checklist, fiscal } = entrada
  const v = dados.vendas
  const f = dados.financeiro
  const c = dados.caixa
  const fontes = montarFontesManifesto(detalhadas, fiscal)
  const xmlFonte = fontes.find((s) => s.nome === "xml")
  const xmlLinha =
    fiscal?.disponivel === true
      ? `- Fiscal (XML): **${xmlFonte?.estado ?? "real"}** · ${fiscal.entregaveis.length} entregável(is) (ADR-007, HOMOLOGACAO).`
      : `- Fiscal (XML): **não disponível** — ${mensagemFiscalIndisponivel(fiscal?.motivo)}`
  const linhas = [
    `# Pacote do Contador — ${labelCompetencia(competencia)}`,
    "",
    "- Loja: ver `competencia.storeId` no `manifest.json` (omitido dos CSVs por minimização).",
    `- Competência: \`${formatCompetencia(competencia)}\` (America/Sao_Paulo)`,
    `- Período (UTC): \`${periodo.inicio.toISOString()}\` → \`${periodo.fimExclusivo.toISOString()}\` (fim exclusivo)`,
    `- Gerado em: ${agora.toISOString()}`,
    "- Aplicação: OmniGestão Pro (geração interna)",
    "",
    "> **Não é fechamento oficial** e não substitui a apuração contábil/fiscal.",
    "> Pacote sob demanda, não arquivado. Dados minimizados (sem PII).",
    "",
    "## Totais da competência (agregado GOAL 006)",
    "",
    `- Líquido da competência: ${fmtBRL(dados.liquidoCompetencia.valor)}${seloDisp(dados.liquidoCompetencia.disponibilidade)}`,
    `- Vendas (não canceladas): ${v.quantidade.valor ?? "—"} · ${fmtBRL(v.total.valor)}${seloDisp(v.total.disponibilidade)}`,
    `- Devoluções: ${dados.devolucoes.quantidade.valor ?? "—"} · ${fmtBRL(dados.devolucoes.total.valor)}${seloDisp(dados.devolucoes.total.disponibilidade)}`,
    `- Entradas realizadas: ${fmtBRL(f.entradasRealizadas.valor)} · Saídas realizadas: ${fmtBRL(f.saidasRealizadas.valor)}`,
    `- Títulos a receber em aberto (competência): ${fmtBRL(f.titulosReceberAberto.valor)}${seloDisp(f.titulosReceberAberto.disponibilidade)}`,
    `- Títulos a pagar em aberto (competência): ${fmtBRL(f.titulosPagarAberto.valor)}${seloDisp(f.titulosPagarAberto.disponibilidade)}`,
    `- Sessões de caixa: ${c.sessoes.valor ?? "—"} (${c.sessoesAbertas.valor ?? "—"} aberta(s))`,
    `- Diferenças de conferência de caixa: ${fmtBRL(c.diferencas.valor)}${seloDisp(c.diferencas.disponibilidade)}`,
    xmlLinha,
    "",
    "## Estado das fontes (detalhado)",
    "",
    ...fontes.map((s) => `- ${s.nome}: **${s.estado}** · ${s.registros} registro(s)${s.observacao ? ` — ${s.observacao}` : ""}`),
    "",
    "## Checklist de fechamento (somente leitura)",
    "",
    `- ${checklist.contagem.ok} ok · ${checklist.contagem.atencao} atenção · ${checklist.contagem.pendente} pendente · ${checklist.contagem.nao_disponivel} não disponível · ${checklist.contagem.total} sinais.`,
    "- Pendências e ausências em `00-LEIA-ME/pendencias.md`.",
    "",
  ]
  return linhas.join("\n")
}

function pendenciasMd(entrada: EntradaConteudoPacote): string {
  const pend = montarPendencias(entrada)
  const naoDisp = montarItensNaoDisponiveis(entrada)
  const avisos = montarAvisos(entrada.fiscal)
  const linhas: string[] = [
    `# Pendências e avisos — ${labelCompetencia(entrada.competencia)}`,
    "",
    "## Pendências (checklist ≠ ok e fontes parciais)",
    "",
    ...(pend.length ? pend.map((p) => `- ${p}`) : ["- Nenhuma pendência de checklist/fonte parcial."]),
    "",
    "## Itens sem evidência (não disponíveis)",
    "",
    ...(naoDisp.length ? naoDisp.map((p) => `- ${p}`) : ["- Nenhum item marcado como não disponível."]),
    "",
    "## Avisos",
    "",
    ...avisos.map((a) => `- ${a}`),
    "",
    "> Itens em estado `ok` não são listados como pendência.",
    "",
  ]
  return linhas.join("\n")
}

const PLACEHOLDER_DOCUMENTOS = [
  "# Documentos — nenhum documento foi incluído nesta fase",
  "",
  "Esta pasta está intencionalmente **vazia de anexos**. A ausência de arquivos aqui",
  "**não prova** que a loja não possua documentos — apenas que o domínio real de",
  "documentos do Contador ainda não existe.",
  "",
  "O domínio de documentos chega depois dos GOALs 009/010.",
  "",
].join("\n")

const PLACEHOLDER_XML = [
  "# Notas fiscais (XML) — nenhum XML foi incluído nesta leitura",
  "",
  "**Nenhum XML** de NF-e/NFC-e foi incluído. A fonte Fiscal **não está disponível**",
  "nesta leitura (`CONTADOR_FISCAL_READER` off, loja fora da allowlist, configuração",
  "inválida ou falha de leitura).",
  "",
  "Isto **não significa zero notas**. Este pacote **não substitui** os arquivos fiscais",
  "oficiais do seu contador.",
  "",
].join("\n")

function arquivosXml(fiscal?: EvidenciaFiscalPacote | null): ArquivoPacote[] {
  if (fiscal?.disponivel === true && fiscal.entregaveis.length > 0) {
    return fiscal.entregaveis.map((e) => ({
      caminho: `05-XML/${e.chaveAcesso}.xml`,
      categoria: "xml" as const,
      fonte: "xml",
      descricao: "XML autorizado persistido (UTF-8 da coluna, sem reconstrução).",
      conteudo: e.xmlAutorizado,
      registros: 1,
    }))
  }
  return [
    {
      caminho: "05-XML/LEIA-ME.md",
      categoria: "placeholder",
      fonte: "xml",
      descricao: "Placeholder honesto: XML fiscal não incluído.",
      conteudo: PLACEHOLDER_XML,
    },
  ]
}

/**
 * Monta os arquivos de CONTEÚDO (resumo, pendências, 8 CSVs, documentos, XML).
 * `INDICE.md` e `manifest.json` são derivados destes no builder.
 * Placeholder `05-XML/LEIA-ME.md` só é substituído quando há XML entregável.
 */
export function montarArquivosConteudo(entrada: EntradaConteudoPacote): ArquivoPacote[] {
  const d = entrada.detalhadas
  const csvFonte = (
    caminho: string,
    fonte: string,
    descricao: string,
    conteudo: string,
    r: { registros: number },
  ): ArquivoPacote => ({ caminho, categoria: "csv", fonte, descricao, conteudo, registros: r.registros })

  return [
    { caminho: "00-LEIA-ME/resumo.md", categoria: "resumo", fonte: "resumo", descricao: "Resumo legível da competência.", conteudo: resumoMd(entrada) },
    { caminho: "00-LEIA-ME/pendencias.md", categoria: "pendencias", fonte: "pendencias", descricao: "Pendências, ausências e avisos.", conteudo: pendenciasMd(entrada) },
    csvFonte("01-VENDAS/vendas.csv", "vendas", "Vendas não canceladas da competência (canceladas ficam só no agregado informativo).", csvVendas(d), d.vendas),
    csvFonte("01-VENDAS/itens.csv", "itens", "Itens das vendas não canceladas.", csvItens(d), d.itens),
    csvFonte("01-VENDAS/devolucoes.csv", "devolucoes", "Devoluções (pela data da devolução).", csvDevolucoes(d), d.devolucoes),
    csvFonte("02-FINANCEIRO/movimentacoes.csv", "movimentacoes", "Movimentações financeiras classificadas.", csvMovimentacoes(d), d.movimentacoes),
    csvFonte("02-FINANCEIRO/contas_receber.csv", "contas_receber", "Títulos a receber em aberto com vencimento na competência (posição atual).", csvTitulos(d.contasReceber.linhas), d.contasReceber),
    csvFonte("02-FINANCEIRO/contas_pagar.csv", "contas_pagar", "Títulos a pagar em aberto com vencimento na competência (posição atual).", csvTitulos(d.contasPagar.linhas), d.contasPagar),
    csvFonte("03-CAIXA/sessoes.csv", "sessoes", "Sessões de caixa da competência.", csvSessoes(d), d.sessoes),
    csvFonte("03-CAIXA/operacoes.csv", "operacoes", "Operações de caixa (sangria/suprimento/…).", csvOperacoes(d), d.operacoes),
    { caminho: "04-DOCUMENTOS/LEIA-ME.md", categoria: "placeholder", fonte: "documentos", descricao: "Placeholder honesto: documentos não incluídos.", conteudo: PLACEHOLDER_DOCUMENTOS },
    ...arquivosXml(entrada.fiscal),
  ]
}
