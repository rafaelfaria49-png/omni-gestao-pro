/**
 * Contador HUB · serviço da agenda (GOAL 016).
 *
 * PURO em relação a IO: porta `AgendaRepo` injetada. Sem cálculo fiscal, sem cron,
 * sem boot que gere obrigação. Instanciação: lote só `mensal` ativo; `nenhuma`
 * somente por seleção explícita daquele template. Idempotência = template + competência.
 */
import { randomUUID } from "node:crypto"
import { formatCompetencia, parseCompetencia, type Competencia } from "@/lib/contador/competencia"
import { CompetenciaFechadaError } from "@/lib/contador/documentos/service"
import {
  MotivoObrigatorioError,
  PermissaoTransicaoError,
  normalizarStatus,
  resolverTransicao,
  transicoesDisponiveis,
  type StatusItem,
} from "@/lib/contador/status/matriz"
import type { CapacidadesContador } from "@/lib/contador/status/permissoes"
import { estaVencido } from "@/lib/contador/status/vencido"
import {
  AgendaValidacaoError,
  DocumentoAgendaInvalidoError,
  GuiaNaoEncontradaError,
  GuiaPagaError,
  ObrigacaoNaoEncontradaError,
  TemplateInativoError,
  TemplateNaoEncontradoError,
} from "./erros"
import {
  ATOR_TIPO_INTERNO,
  ENTIDADE_GUIA,
  ENTIDADE_OBRIGACAO,
  ENTIDADE_TEMPLATE,
  EVENTO_GUIA_ATUALIZADA,
  EVENTO_GUIA_INFORMADA,
  EVENTO_GUIA_PAGA,
  EVENTO_OBRIGACAO_ATUALIZADA,
  EVENTO_OBRIGACAO_CRIADA,
  EVENTO_OBRIGACAO_STATUS,
  EVENTO_TEMPLATE_ATUALIZADO,
  EVENTO_TEMPLATE_CRIADO,
  GUIAS_ORIGEM,
  MICROCOPY_INFORMADO,
  MIME_PDF,
  MIMES_COMPROVANTE,
  OBRIGACAO_TIPOS,
  ORIGEM_AGENDA,
  RECORRENCIAS,
  type AgendaDto,
  type CompetenciaAgendaRef,
  type DocumentoAgendaRef,
  type EscopoAgenda,
  type GuiaDto,
  type GuiaOrigem,
  type GuiaRow,
  type NovoEventoAgenda,
  type ObrigacaoDto,
  type ObrigacaoRow,
  type ObrigacaoTipo,
  type Recorrencia,
  type ResumoGuiasChecklist,
  type TemplateDto,
  type TemplateRow,
} from "./tipos"
import { dataUtcDeDia, estaVencendo, resolverDiaVencimento, statusEfetivoGuia } from "./vencimento"

const STATUS_FECHADA = "FECHADA"
const TITULO_MAX = 200
const DESC_MAX = 2000
const MOTIVO_MAX = 2000
const DIA_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export interface AgendaRepo {
  getOrCreateCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaAgendaRef>
  acharCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaAgendaRef | null>
  acharCompetenciaPorId(id: string, storeId: string): Promise<CompetenciaAgendaRef | null>

  listarTemplates(storeId: string): Promise<TemplateRow[]>
  acharTemplate(id: string, storeId: string): Promise<TemplateRow | null>
  criarTemplate(row: Omit<TemplateRow, "createdAt" | "updatedAt">, evento: NovoEventoAgenda): Promise<TemplateRow>
  atualizarTemplate(
    id: string,
    storeId: string,
    data: Partial<Pick<TemplateRow, "titulo" | "descricao" | "tipo" | "diaVencimento" | "recorrencia" | "ativo">>,
    evento: NovoEventoAgenda,
  ): Promise<TemplateRow>
  contarObrigacoesDoTemplate(templateId: string, storeId: string): Promise<number>
  excluirTemplate(id: string, storeId: string): Promise<void>

  listarObrigacoes(competenciaId: string, storeId: string): Promise<ObrigacaoRow[]>
  acharObrigacao(id: string, storeId: string): Promise<ObrigacaoRow | null>
  acharObrigacaoPorTemplate(templateId: string, competenciaId: string, storeId: string): Promise<ObrigacaoRow | null>
  criarObrigacao(row: Omit<ObrigacaoRow, "createdAt" | "updatedAt" | "competenciaAno" | "competenciaMes" | "competenciaStatus">, evento: NovoEventoAgenda): Promise<ObrigacaoRow>
  atualizarObrigacao(
    id: string,
    storeId: string,
    data: Partial<Pick<ObrigacaoRow, "titulo" | "descricao" | "tipo" | "vencimento">>,
    evento: NovoEventoAgenda,
  ): Promise<ObrigacaoRow>
  aplicarStatusObrigacao(args: {
    id: string
    storeId: string
    de: StatusItem
    para: StatusItem
    evento: NovoEventoAgenda
  }): Promise<ObrigacaoRow>

  listarGuias(competenciaId: string, storeId: string): Promise<GuiaRow[]>
  acharGuia(id: string, storeId: string): Promise<GuiaRow | null>
  criarGuia(row: Omit<GuiaRow, "createdAt" | "updatedAt" | "competenciaAno" | "competenciaMes" | "competenciaStatus">, evento: NovoEventoAgenda): Promise<GuiaRow>
  atualizarGuia(
    id: string,
    storeId: string,
    data: Partial<
      Pick<
        GuiaRow,
        | "titulo"
        | "valorCentavos"
        | "vencimento"
        | "origem"
        | "obrigacaoId"
        | "pdfDocumentoId"
        | "comprovanteDocumentoId"
      >
    >,
    evento: NovoEventoAgenda,
  ): Promise<GuiaRow>
  marcarGuiaPaga(id: string, storeId: string, pagaEm: Date, comprovanteDocumentoId: string | null, evento: NovoEventoAgenda): Promise<GuiaRow>

  acharDocumentoDaLoja(id: string, storeId: string): Promise<DocumentoAgendaRef | null>
}

export type DepsAgenda = Readonly<{ repo: AgendaRepo }>

/* ───────────────────────────── normalização ───────────────────────────── */

export function tipoWire(valor: string): ObrigacaoTipo {
  const v = valor.trim().toLowerCase() as ObrigacaoTipo
  if (!(OBRIGACAO_TIPOS as readonly string[]).includes(v)) {
    throw new AgendaValidacaoError("tipo", "Tipo inválido. Informe um tipo da agenda (não é cálculo fiscal).")
  }
  return v
}

export function tipoPrisma(valor: ObrigacaoTipo): string {
  return valor.toUpperCase()
}

export function recorrenciaWire(valor: string): Recorrencia {
  const v = valor.trim().toLowerCase() as Recorrencia
  if (!(RECORRENCIAS as readonly string[]).includes(v)) {
    throw new AgendaValidacaoError("recorrencia", "Recorrência inválida. Use mensal ou nenhuma.")
  }
  return v
}

export function origemWire(valor: string): GuiaOrigem {
  const v = valor.trim().toLowerCase() as GuiaOrigem
  if (!(GUIAS_ORIGEM as readonly string[]).includes(v)) {
    throw new AgendaValidacaoError("origem", "Origem inválida. Use manual ou contador.")
  }
  return v
}

function competenciaOuErro(codigo: unknown): Competencia {
  const c = parseCompetencia(codigo)
  if (!c) throw new AgendaValidacaoError("competencia", "Competência inválida. Use AAAA-MM.")
  return c
}

function tituloOuErro(valor: unknown): string {
  const t = typeof valor === "string" ? valor.trim() : ""
  if (!t) throw new AgendaValidacaoError("titulo", "Título é obrigatório (informado pelo responsável).")
  return t.length > TITULO_MAX ? t.slice(0, TITULO_MAX) : t
}

function descricaoOp(valor: unknown): string | null {
  if (valor == null) return null
  const t = String(valor).trim()
  if (!t) return null
  return t.length > DESC_MAX ? t.slice(0, DESC_MAX) : t
}

function diaVencimentoOp(valor: unknown): number | null {
  if (valor == null || valor === "") return null
  const n = typeof valor === "number" ? valor : Number(valor)
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new AgendaValidacaoError("diaVencimento", "Dia de vencimento deve ser um inteiro de 1 a 31.")
  }
  return n
}

function validarRecorrenciaDia(recorrencia: Recorrencia, dia: number | null): void {
  if (recorrencia === "mensal" && dia == null) {
    throw new AgendaValidacaoError("diaVencimento", "Recorrência mensal exige dia de vencimento (1 a 31).")
  }
}

/** Data civil AAAA-MM-DD real (rejeita 31/02). Sem clamp — o responsável informa. */
export function diaInformadoOuErro(valor: unknown, campo = "vencimento"): string {
  const t = typeof valor === "string" ? valor.trim() : ""
  const m = DIA_RE.exec(t)
  if (!m) throw new AgendaValidacaoError(campo, "Vencimento inválido. Use AAAA-MM-DD (informado pelo responsável).")
  const ano = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  const dt = new Date(Date.UTC(ano, mes - 1, dia))
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) {
    throw new AgendaValidacaoError(campo, "Vencimento inválido. Data civil inexistente.")
  }
  return t
}

function valorCentavosOuErro(valor: unknown): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0) {
    throw new AgendaValidacaoError(
      "valorCentavos",
      "Valor em centavos deve ser um inteiro ≥ 0 (informado pelo responsável; sem cálculo fiscal).",
    )
  }
  return valor
}

function assertAberta(status: string): void {
  if (status === STATUS_FECHADA) throw new CompetenciaFechadaError()
}

function eventoBase(
  escopo: EscopoAgenda,
  competenciaId: string | null,
  tipo: string,
  entidade: string,
  entidadeId: string,
  metadata: NovoEventoAgenda["metadata"],
): NovoEventoAgenda {
  return {
    storeId: escopo.storeId,
    competenciaId,
    tipo,
    atorTipo: ATOR_TIPO_INTERNO,
    atorId: escopo.userId,
    entidade,
    entidadeId,
    origem: ORIGEM_AGENDA,
    metadata,
  }
}

/* ───────────────────────────── projeções ───────────────────────────── */

export function toTemplateDto(row: TemplateRow): TemplateDto {
  return Object.freeze({
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao,
    tipo: tipoWire(String(row.tipo).toLowerCase()),
    diaVencimento: row.diaVencimento,
    recorrencia: recorrenciaWire(row.recorrencia),
    ativo: row.ativo,
    atualizadoEm: row.updatedAt.toISOString(),
    microcopy: MICROCOPY_INFORMADO,
  })
}

export function toObrigacaoDto(
  row: ObrigacaoRow,
  capacidades: CapacidadesContador,
  agora: Date = new Date(),
): ObrigacaoDto {
  const status = normalizarStatus(row.status)
  const tipo = tipoWire(String(row.tipo).toLowerCase())
  return Object.freeze({
    id: row.id,
    competenciaId: row.competenciaId,
    competencia: formatCompetencia({ ano: row.competenciaAno, mes: row.competenciaMes }),
    templateId: row.templateId,
    titulo: row.titulo,
    descricao: row.descricao,
    tipo,
    status,
    vencimento: row.vencimento ? row.vencimento.toISOString() : null,
    vencido: estaVencido({ status, vencimento: row.vencimento }, agora),
    vencendo: estaVencendo({ status, vencimento: row.vencimento }, agora),
    transicoes: Object.freeze(
      transicoesDisponiveis(status, capacidades).map((t) =>
        Object.freeze({ para: t.para, acao: t.acao, rotulo: t.rotulo, exigeMotivo: t.exigeMotivo }),
      ),
    ),
    atualizadoEm: row.updatedAt.toISOString(),
    microcopy: MICROCOPY_INFORMADO,
  })
}

export function toGuiaDto(row: GuiaRow, agora: Date = new Date()): GuiaDto {
  const paga = row.pagaEm != null
  const status = statusEfetivoGuia(row.pagaEm)
  return Object.freeze({
    id: row.id,
    competenciaId: row.competenciaId,
    competencia: formatCompetencia({ ano: row.competenciaAno, mes: row.competenciaMes }),
    obrigacaoId: row.obrigacaoId,
    titulo: row.titulo,
    valorCentavos: row.valorCentavos,
    vencimento: row.vencimento.toISOString(),
    origem: origemWire(String(row.origem).toLowerCase()),
    pdfDocumentoId: row.pdfDocumentoId,
    pdfAusente: !row.pdfDocumentoId,
    comprovanteDocumentoId: row.comprovanteDocumentoId,
    comprovanteAusente: !row.comprovanteDocumentoId,
    paga,
    pagaEm: row.pagaEm ? row.pagaEm.toISOString() : null,
    vencido: estaVencido({ status, vencimento: row.vencimento }, agora),
    vencendo: estaVencendo({ status, vencimento: row.vencimento, pagaEm: row.pagaEm }, agora),
    atualizadoEm: row.updatedAt.toISOString(),
    microcopy: MICROCOPY_INFORMADO,
  })
}

export function montarResumoGuias(guias: readonly GuiaRow[], agora: Date = new Date()): ResumoGuiasChecklist {
  let vencidas = 0
  let vencendo = 0
  let pagas = 0
  for (const g of guias) {
    const dto = toGuiaDto(g, agora)
    if (dto.paga) pagas += 1
    if (dto.vencido) vencidas += 1
    else if (dto.vencendo) vencendo += 1
  }
  return Object.freeze({
    leituraOk: true,
    total: guias.length,
    vencidas,
    vencendo,
    pagas,
  })
}

/* ───────────────────────────── templates ───────────────────────────── */

export async function listarTemplates(escopo: EscopoAgenda, deps: DepsAgenda): Promise<readonly TemplateDto[]> {
  const rows = await deps.repo.listarTemplates(escopo.storeId)
  return Object.freeze(rows.map(toTemplateDto))
}

export async function criarTemplate(
  escopo: EscopoAgenda,
  entrada: { titulo: unknown; descricao?: unknown; tipo: unknown; diaVencimento?: unknown; recorrencia?: unknown },
  deps: DepsAgenda,
): Promise<TemplateDto> {
  const titulo = tituloOuErro(entrada.titulo)
  const tipo = tipoWire(String(entrada.tipo ?? ""))
  const recorrencia = entrada.recorrencia == null || entrada.recorrencia === ""
    ? ("mensal" as Recorrencia)
    : recorrenciaWire(String(entrada.recorrencia))
  const diaVencimento = diaVencimentoOp(entrada.diaVencimento)
  validarRecorrenciaDia(recorrencia, diaVencimento)
  const id = `tpl-${randomUUID()}`
  const row = await deps.repo.criarTemplate(
    {
      id,
      storeId: escopo.storeId,
      titulo,
      descricao: descricaoOp(entrada.descricao),
      tipo: tipoPrisma(tipo),
      diaVencimento,
      recorrencia: recorrencia.toUpperCase(),
      ativo: true,
      criadoPorTipo: ATOR_TIPO_INTERNO,
      criadoPorId: escopo.userId,
    },
    eventoBase(escopo, null, EVENTO_TEMPLATE_CRIADO, ENTIDADE_TEMPLATE, id, {
      titulo,
      tipo,
      recorrencia,
    }),
  )
  return toTemplateDto(row)
}

export async function atualizarTemplate(
  escopo: EscopoAgenda,
  id: string,
  entrada: {
    titulo?: unknown
    descricao?: unknown
    tipo?: unknown
    diaVencimento?: unknown
    recorrencia?: unknown
    ativo?: unknown
  },
  deps: DepsAgenda,
): Promise<TemplateDto> {
  const atual = await deps.repo.acharTemplate(id, escopo.storeId)
  if (!atual) throw new TemplateNaoEncontradoError()
  const data: Partial<Pick<TemplateRow, "titulo" | "descricao" | "tipo" | "diaVencimento" | "recorrencia" | "ativo">> = {}
  if (entrada.titulo !== undefined) data.titulo = tituloOuErro(entrada.titulo)
  if (entrada.descricao !== undefined) data.descricao = descricaoOp(entrada.descricao)
  if (entrada.tipo !== undefined) data.tipo = tipoPrisma(tipoWire(String(entrada.tipo)))
  if (entrada.diaVencimento !== undefined) data.diaVencimento = diaVencimentoOp(entrada.diaVencimento)
  if (entrada.recorrencia !== undefined) data.recorrencia = recorrenciaWire(String(entrada.recorrencia)).toUpperCase()
  if (entrada.ativo !== undefined) {
    if (typeof entrada.ativo !== "boolean") throw new AgendaValidacaoError("ativo", "ativo deve ser boolean.")
    data.ativo = entrada.ativo
  }
  const rec = recorrenciaWire(String(data.recorrencia ?? atual.recorrencia))
  const dia = data.diaVencimento !== undefined ? data.diaVencimento : atual.diaVencimento
  validarRecorrenciaDia(rec, dia ?? null)
  const row = await deps.repo.atualizarTemplate(
    id,
    escopo.storeId,
    data,
    eventoBase(escopo, null, EVENTO_TEMPLATE_ATUALIZADO, ENTIDADE_TEMPLATE, id, { id }),
  )
  return toTemplateDto(row)
}

/** Inativa se já houver instâncias; exclui só quando não há obrigação ligada. */
export async function removerTemplate(escopo: EscopoAgenda, id: string, deps: DepsAgenda): Promise<{ inativado: boolean }> {
  const atual = await deps.repo.acharTemplate(id, escopo.storeId)
  if (!atual) throw new TemplateNaoEncontradoError()
  const n = await deps.repo.contarObrigacoesDoTemplate(id, escopo.storeId)
  if (n > 0) {
    await deps.repo.atualizarTemplate(
      id,
      escopo.storeId,
      { ativo: false },
      eventoBase(escopo, null, EVENTO_TEMPLATE_ATUALIZADO, ENTIDADE_TEMPLATE, id, { inativado: true }),
    )
    return { inativado: true }
  }
  await deps.repo.excluirTemplate(id, escopo.storeId)
  return { inativado: false }
}

/* ───────────────────────────── obrigações ───────────────────────────── */

async function competenciaEscrita(
  escopo: EscopoAgenda,
  codigo: unknown,
  deps: DepsAgenda,
): Promise<CompetenciaAgendaRef> {
  const comp = competenciaOuErro(codigo)
  const ref = await deps.repo.getOrCreateCompetencia(escopo.storeId, comp)
  assertAberta(ref.status)
  return ref
}

export async function listarAgenda(
  escopo: EscopoAgenda,
  codigo: unknown,
  capacidades: CapacidadesContador,
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<AgendaDto> {
  const comp = competenciaOuErro(codigo)
  const ref = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!ref) {
    return Object.freeze({
      competencia: formatCompetencia(comp),
      obrigacoes: Object.freeze([] as ObrigacaoDto[]),
      guias: Object.freeze([] as GuiaDto[]),
      microcopy: MICROCOPY_INFORMADO,
    })
  }
  const [obrigacoes, guias] = await Promise.all([
    deps.repo.listarObrigacoes(ref.id, escopo.storeId),
    deps.repo.listarGuias(ref.id, escopo.storeId),
  ])
  return Object.freeze({
    competencia: formatCompetencia(comp),
    obrigacoes: Object.freeze(obrigacoes.map((o) => toObrigacaoDto(o, capacidades, agora))),
    guias: Object.freeze(guias.map((g) => toGuiaDto(g, agora))),
    microcopy: MICROCOPY_INFORMADO,
  })
}

export async function carregarResumoGuiasChecklist(
  escopo: EscopoAgenda,
  codigo: unknown,
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<ResumoGuiasChecklist> {
  const comp = competenciaOuErro(codigo)
  const ref = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!ref) {
    return Object.freeze({ leituraOk: true, total: 0, vencidas: 0, vencendo: 0, pagas: 0 })
  }
  const guias = await deps.repo.listarGuias(ref.id, escopo.storeId)
  return montarResumoGuias(guias, agora)
}

async function materializarDeTemplate(
  escopo: EscopoAgenda,
  template: TemplateRow,
  ref: CompetenciaAgendaRef,
  deps: DepsAgenda,
): Promise<{ row: ObrigacaoRow; jaExistia: boolean }> {
  if (!template.ativo) throw new TemplateInativoError()
  const existente = await deps.repo.acharObrigacaoPorTemplate(template.id, ref.id, escopo.storeId)
  if (existente) return { row: existente, jaExistia: true }
  const tipo = tipoWire(String(template.tipo).toLowerCase())
  const dia = template.diaVencimento
  const vencimento =
    dia != null ? dataUtcDeDia(resolverDiaVencimento(ref.ano, ref.mes, dia)) : null
  const id = `obg-${randomUUID()}`
  try {
    const row = await deps.repo.criarObrigacao(
      {
        id,
        storeId: escopo.storeId,
        competenciaId: ref.id,
        templateId: template.id,
        titulo: template.titulo,
        descricao: template.descricao,
        tipo: tipoPrisma(tipo),
        vencimento,
        status: "PENDENTE",
        criadoPorTipo: ATOR_TIPO_INTERNO,
        criadoPorId: escopo.userId,
      },
      eventoBase(escopo, ref.id, EVENTO_OBRIGACAO_CRIADA, ENTIDADE_OBRIGACAO, id, {
        titulo: template.titulo,
        tipo,
        templateId: template.id,
        competencia: formatCompetencia({ ano: ref.ano, mes: ref.mes }),
      }),
    )
    return { row, jaExistia: false }
  } catch (e) {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : ""
    if (code === "P2002") {
      const deNovo = await deps.repo.acharObrigacaoPorTemplate(template.id, ref.id, escopo.storeId)
      if (deNovo) return { row: deNovo, jaExistia: true }
    }
    throw e
  }
}

/**
 * Lote «Gerar deste mês»: somente templates `mensal` **ativos**.
 * `nenhuma` é excluída mesmo se ativa.
 */
export async function instanciarLoteMensal(
  escopo: EscopoAgenda,
  codigo: unknown,
  capacidades: CapacidadesContador,
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<{ criadas: number; existentes: number; obrigacoes: readonly ObrigacaoDto[] }> {
  const ref = await competenciaEscrita(escopo, codigo, deps)
  const templates = await deps.repo.listarTemplates(escopo.storeId)
  const mensais = templates.filter(
    (t) => t.ativo && recorrenciaWire(t.recorrencia) === "mensal",
  )
  let criadas = 0
  let existentes = 0
  const rows: ObrigacaoRow[] = []
  for (const t of mensais) {
    const r = await materializarDeTemplate(escopo, t, ref, deps)
    if (r.jaExistia) existentes += 1
    else criadas += 1
    rows.push(r.row)
  }
  return {
    criadas,
    existentes,
    obrigacoes: Object.freeze(rows.map((o) => toObrigacaoDto(o, capacidades, agora))),
  }
}

export async function criarObrigacao(
  escopo: EscopoAgenda,
  entrada: {
    competencia: unknown
    titulo?: unknown
    descricao?: unknown
    tipo?: unknown
    vencimento?: unknown
    templateId?: unknown
  },
  capacidades: CapacidadesContador,
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<ObrigacaoDto> {
  const ref = await competenciaEscrita(escopo, entrada.competencia, deps)
  const templateId = typeof entrada.templateId === "string" ? entrada.templateId.trim() : ""
  if (templateId) {
    const template = await deps.repo.acharTemplate(templateId, escopo.storeId)
    if (!template) throw new TemplateNaoEncontradoError()
    // Seleção explícita: `nenhuma` e `mensal` são permitidas. Inativo não.
    const r = await materializarDeTemplate(escopo, template, ref, deps)
    return toObrigacaoDto(r.row, capacidades, agora)
  }
  const titulo = tituloOuErro(entrada.titulo)
  const tipo = tipoWire(String(entrada.tipo ?? ""))
  const vencimento = entrada.vencimento == null || entrada.vencimento === ""
    ? null
    : dataUtcDeDia(diaInformadoOuErro(entrada.vencimento))
  const id = `obg-${randomUUID()}`
  const row = await deps.repo.criarObrigacao(
    {
      id,
      storeId: escopo.storeId,
      competenciaId: ref.id,
      templateId: null,
      titulo,
      descricao: descricaoOp(entrada.descricao),
      tipo: tipoPrisma(tipo),
      vencimento,
      status: "PENDENTE",
      criadoPorTipo: ATOR_TIPO_INTERNO,
      criadoPorId: escopo.userId,
    },
    eventoBase(escopo, ref.id, EVENTO_OBRIGACAO_CRIADA, ENTIDADE_OBRIGACAO, id, {
      titulo,
      tipo,
      competencia: formatCompetencia({ ano: ref.ano, mes: ref.mes }),
    }),
  )
  return toObrigacaoDto(row, capacidades, agora)
}

export async function atualizarObrigacao(
  escopo: EscopoAgenda,
  id: string,
  entrada: { titulo?: unknown; descricao?: unknown; tipo?: unknown; vencimento?: unknown },
  capacidades: CapacidadesContador,
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<ObrigacaoDto> {
  const atual = await deps.repo.acharObrigacao(id, escopo.storeId)
  if (!atual) throw new ObrigacaoNaoEncontradaError()
  assertAberta(atual.competenciaStatus)
  const data: Partial<Pick<ObrigacaoRow, "titulo" | "descricao" | "tipo" | "vencimento">> = {}
  if (entrada.titulo !== undefined) data.titulo = tituloOuErro(entrada.titulo)
  if (entrada.descricao !== undefined) data.descricao = descricaoOp(entrada.descricao)
  if (entrada.tipo !== undefined) data.tipo = tipoPrisma(tipoWire(String(entrada.tipo)))
  if (entrada.vencimento !== undefined) {
    data.vencimento =
      entrada.vencimento == null || entrada.vencimento === ""
        ? null
        : dataUtcDeDia(diaInformadoOuErro(entrada.vencimento))
  }
  const row = await deps.repo.atualizarObrigacao(
    id,
    escopo.storeId,
    data,
    eventoBase(escopo, atual.competenciaId, EVENTO_OBRIGACAO_ATUALIZADA, ENTIDADE_OBRIGACAO, id, { id }),
  )
  return toObrigacaoDto(row, capacidades, agora)
}

export async function alterarStatusObrigacao(
  escopo: EscopoAgenda,
  entrada: { obrigacaoId: unknown; para: unknown; motivo?: unknown },
  capacidades: CapacidadesContador,
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<ObrigacaoDto> {
  const id = String(entrada.obrigacaoId ?? "").trim()
  if (!id) throw new ObrigacaoNaoEncontradaError()
  const para = normalizarStatus(entrada.para)
  const atual = await deps.repo.acharObrigacao(id, escopo.storeId)
  if (!atual) throw new ObrigacaoNaoEncontradaError()
  assertAberta(atual.competenciaStatus)
  const de = normalizarStatus(atual.status)
  const transicao = resolverTransicao(de, para)
  const motivo = typeof entrada.motivo === "string" ? entrada.motivo.trim() : ""
  const motivoCortado = motivo.length > MOTIVO_MAX ? motivo.slice(0, MOTIVO_MAX) : motivo
  if (transicao.exigeMotivo && !motivoCortado) throw new MotivoObrigatorioError()
  if (transicao.exigePapelElevado && !capacidades.podeConferir) {
    throw new PermissaoTransicaoError(transicao.acao)
  }
  const row = await deps.repo.aplicarStatusObrigacao({
    id,
    storeId: escopo.storeId,
    de,
    para,
    evento: eventoBase(escopo, atual.competenciaId, EVENTO_OBRIGACAO_STATUS, ENTIDADE_OBRIGACAO, id, {
      statusAnterior: de,
      statusNovo: para,
      acao: transicao.acao,
      competencia: formatCompetencia({ ano: atual.competenciaAno, mes: atual.competenciaMes }),
      ...(transicao.exigeMotivo ? { motivoLen: motivoCortado.length } : {}),
    }),
  })
  return toObrigacaoDto(row, capacidades, agora)
}

/* ───────────────────────────── guias ───────────────────────────── */

async function validarDocumento(
  deps: DepsAgenda,
  documentoId: string | null,
  storeId: string,
  competenciaId: string,
  papel: "pdf" | "comprovante",
): Promise<string | null> {
  if (!documentoId) return null
  const doc = await deps.repo.acharDocumentoDaLoja(documentoId, storeId)
  // Outra loja / inexistente: 404 — não confirma existência alheia.
  if (!doc || doc.excluidoEm) throw new DocumentoAgendaInvalidoError("Documento não encontrado nesta unidade.")
  if (doc.competenciaId !== competenciaId) {
    throw new DocumentoAgendaInvalidoError("O documento precisa ser da mesma competência da guia.")
  }
  const mime = (doc.mime ?? "").toLowerCase()
  if (papel === "pdf") {
    if (mime !== MIME_PDF) throw new AgendaValidacaoError("pdfDocumentoId", "O PDF da guia deve ser application/pdf.")
  } else if (!(MIMES_COMPROVANTE as readonly string[]).includes(mime)) {
    throw new AgendaValidacaoError(
      "comprovanteDocumentoId",
      "O comprovante deve ser PDF, PNG ou JPG.",
    )
  }
  return doc.id
}

export async function criarGuia(
  escopo: EscopoAgenda,
  entrada: {
    competencia: unknown
    titulo: unknown
    valorCentavos: unknown
    vencimento: unknown
    origem?: unknown
    obrigacaoId?: unknown
    pdfDocumentoId?: unknown
    comprovanteDocumentoId?: unknown
  },
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<GuiaDto> {
  const ref = await competenciaEscrita(escopo, entrada.competencia, deps)
  const titulo = tituloOuErro(entrada.titulo)
  const valorCentavos = valorCentavosOuErro(entrada.valorCentavos)
  const vencimento = dataUtcDeDia(diaInformadoOuErro(entrada.vencimento))
  const origem = entrada.origem == null || entrada.origem === ""
    ? ("manual" as GuiaOrigem)
    : origemWire(String(entrada.origem))
  const obrigacaoId = typeof entrada.obrigacaoId === "string" && entrada.obrigacaoId.trim()
    ? entrada.obrigacaoId.trim()
    : null
  if (obrigacaoId) {
    const ob = await deps.repo.acharObrigacao(obrigacaoId, escopo.storeId)
    if (!ob || ob.competenciaId !== ref.id) throw new ObrigacaoNaoEncontradaError()
  }
  const pdfDocumentoId = await validarDocumento(
    deps,
    typeof entrada.pdfDocumentoId === "string" ? entrada.pdfDocumentoId.trim() : null,
    escopo.storeId,
    ref.id,
    "pdf",
  )
  const comprovanteDocumentoId = await validarDocumento(
    deps,
    typeof entrada.comprovanteDocumentoId === "string" ? entrada.comprovanteDocumentoId.trim() : null,
    escopo.storeId,
    ref.id,
    "comprovante",
  )
  const id = `guia-${randomUUID()}`
  const row = await deps.repo.criarGuia(
    {
      id,
      storeId: escopo.storeId,
      competenciaId: ref.id,
      obrigacaoId,
      titulo,
      valorCentavos,
      vencimento,
      origem: origem.toUpperCase(),
      pdfDocumentoId,
      comprovanteDocumentoId,
      pagaEm: null,
      criadoPorTipo: ATOR_TIPO_INTERNO,
      criadoPorId: escopo.userId,
    },
    eventoBase(escopo, ref.id, EVENTO_GUIA_INFORMADA, ENTIDADE_GUIA, id, {
      titulo,
      valorCentavos,
      origem,
      competencia: formatCompetencia({ ano: ref.ano, mes: ref.mes }),
    }),
  )
  return toGuiaDto(row, agora)
}

export async function atualizarGuia(
  escopo: EscopoAgenda,
  id: string,
  entrada: {
    titulo?: unknown
    valorCentavos?: unknown
    vencimento?: unknown
    origem?: unknown
    obrigacaoId?: unknown
    pdfDocumentoId?: unknown
    comprovanteDocumentoId?: unknown
  },
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<GuiaDto> {
  const atual = await deps.repo.acharGuia(id, escopo.storeId)
  if (!atual) throw new GuiaNaoEncontradaError()
  assertAberta(atual.competenciaStatus)
  if (atual.pagaEm) throw new GuiaPagaError()
  const data: Partial<
    Pick<
      GuiaRow,
      | "titulo"
      | "valorCentavos"
      | "vencimento"
      | "origem"
      | "obrigacaoId"
      | "pdfDocumentoId"
      | "comprovanteDocumentoId"
    >
  > = {}
  if (entrada.titulo !== undefined) data.titulo = tituloOuErro(entrada.titulo)
  if (entrada.valorCentavos !== undefined) data.valorCentavos = valorCentavosOuErro(entrada.valorCentavos)
  if (entrada.vencimento !== undefined) data.vencimento = dataUtcDeDia(diaInformadoOuErro(entrada.vencimento))
  if (entrada.origem !== undefined) data.origem = origemWire(String(entrada.origem)).toUpperCase()
  if (entrada.obrigacaoId !== undefined) {
    const obrigacaoId =
      entrada.obrigacaoId == null || entrada.obrigacaoId === "" ? null : String(entrada.obrigacaoId).trim()
    if (obrigacaoId) {
      const ob = await deps.repo.acharObrigacao(obrigacaoId, escopo.storeId)
      if (!ob || ob.competenciaId !== atual.competenciaId) throw new ObrigacaoNaoEncontradaError()
    }
    data.obrigacaoId = obrigacaoId
  }
  if (entrada.pdfDocumentoId !== undefined) {
    data.pdfDocumentoId = await validarDocumento(
      deps,
      entrada.pdfDocumentoId == null || entrada.pdfDocumentoId === ""
        ? null
        : String(entrada.pdfDocumentoId).trim(),
      escopo.storeId,
      atual.competenciaId,
      "pdf",
    )
  }
  if (entrada.comprovanteDocumentoId !== undefined) {
    data.comprovanteDocumentoId = await validarDocumento(
      deps,
      entrada.comprovanteDocumentoId == null || entrada.comprovanteDocumentoId === ""
        ? null
        : String(entrada.comprovanteDocumentoId).trim(),
      escopo.storeId,
      atual.competenciaId,
      "comprovante",
    )
  }
  const row = await deps.repo.atualizarGuia(
    id,
    escopo.storeId,
    data,
    eventoBase(escopo, atual.competenciaId, EVENTO_GUIA_ATUALIZADA, ENTIDADE_GUIA, id, { id }),
  )
  return toGuiaDto(row, agora)
}

export async function pagarGuia(
  escopo: EscopoAgenda,
  id: string,
  entrada: { comprovanteDocumentoId?: unknown },
  capacidades: CapacidadesContador,
  deps: DepsAgenda,
  agora: Date = new Date(),
): Promise<GuiaDto> {
  if (!capacidades.podeConferir) {
    throw new PermissaoTransicaoError("resolver")
  }
  const atual = await deps.repo.acharGuia(id, escopo.storeId)
  if (!atual) throw new GuiaNaoEncontradaError()
  assertAberta(atual.competenciaStatus)
  if (atual.pagaEm) throw new GuiaPagaError()
  let comprovante = atual.comprovanteDocumentoId
  if (entrada.comprovanteDocumentoId !== undefined) {
    comprovante = await validarDocumento(
      deps,
      entrada.comprovanteDocumentoId == null || entrada.comprovanteDocumentoId === ""
        ? null
        : String(entrada.comprovanteDocumentoId).trim(),
      escopo.storeId,
      atual.competenciaId,
      "comprovante",
    )
  }
  const row = await deps.repo.marcarGuiaPaga(
    id,
    escopo.storeId,
    agora,
    comprovante,
    eventoBase(escopo, atual.competenciaId, EVENTO_GUIA_PAGA, ENTIDADE_GUIA, id, {
      comprovanteAusente: !comprovante,
      competencia: formatCompetencia({ ano: atual.competenciaAno, mes: atual.competenciaMes }),
    }),
  )
  return toGuiaDto(row, agora)
}
