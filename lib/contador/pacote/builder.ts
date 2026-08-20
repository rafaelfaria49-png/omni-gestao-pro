/**
 * Contador HUB · Pacote do Contador — montagem e geração (GOAL 008 · 008B).
 *
 * `montarConteudoPacote` é PURO (sem IO/DB/ZIP): monta os 14 arquivos (conteúdo + INDICE +
 * manifesto v1) e aplica as guardas de segurança. `gerarPacoteContador` é o único ponto com
 * IO: carrega as fontes detalhadas UMA vez (`carregarFontesPacote`), deriva o DTO agregado
 * (GOAL 006) e o checklist (GOAL 007) da MESMA carga, compacta e afere os limites.
 *
 * Imports de Prisma (via carregar-fontes/readers) são DINÂMICOS — o grafo estático deste
 * módulo fica livre de Prisma, para `montarConteudoPacote` ser testável sem banco.
 */
import {
  formatCompetencia,
  resolvePeriodoUtc,
  type Competencia,
} from "@/lib/contador/competencia"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import type { ChecklistFechamento } from "@/lib/contador/fechamento"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import type { EvidenciaFiscalPacote } from "@/lib/contador/readers/fiscal"
import type { FontesDetalhadasPacote } from "./carregar-fontes"
import {
  montarArquivosConteudo,
  montarAvisos,
  montarFontesManifesto,
  montarItensNaoDisponiveis,
  montarPendencias,
} from "./fontes"
import {
  descreverArquivos,
  montarManifesto,
  renderIndiceMd,
  serializarManifesto,
} from "./manifest"
import {
  assertBytesDescompactados,
  assertBytesZip,
  assertPacoteSeguro,
  executarComTimeoutLogico,
  sanitizarStoreIdParaArquivo,
  TIMEOUT_LOGICO_MS,
  MAX_ARQUIVOS_PACOTE,
  PacoteLimiteExcedidoError,
} from "./seguranca"
import { ziparArquivos } from "./zip"
import type { ArquivoPacote, ConteudoPacote, EstadoFonte, PacoteContador } from "./tipos"

export type MontarConteudoPacoteInput = Readonly<{
  detalhadas: FontesDetalhadasPacote
  dados: ContadorDadosReais
  checklist: ChecklistFechamento
  competencia: Competencia
  agora: Date
  storeId: string
  userId: string
  /**
   * GOAL 012A — arquivos extra injetados ANTES do manifesto (hoje: o snapshot do
   * fechamento). Entram no `descreverArquivos`, portanto o manifesto lista o hash deles.
   * A dependência é unidirecional: manifesto → extras; extras nunca leem o manifesto.
   */
  arquivosExtra?: readonly ArquivoPacote[]
  /** Referência opcional de integridade citada no manifesto (ex.: `snapshotHash`). */
  snapshotHash?: string
  /** GOAL 018 — XML só substitui o placeholder quando a fonte está ativa e há entregáveis. */
  fiscal?: EvidenciaFiscalPacote | null
}>

/** Monta o conteúdo completo (14 arquivos) com hashes e guardas. Puro/determinístico. */
export function montarConteudoPacote(input: MontarConteudoPacoteInput): ConteudoPacote {
  const { detalhadas, dados, checklist, competencia, agora, storeId, userId } = input
  const periodo = resolvePeriodoUtc(competencia)
  const entrada = { detalhadas, dados, checklist, competencia, periodo, agora, fiscal: input.fiscal }

  // Extras entram junto do conteúdo: aparecem no índice e no manifesto como qualquer
  // outro arquivo, e o manifesto passa a ser a raiz de integridade também deles.
  const conteudo = [...montarArquivosConteudo(entrada), ...(input.arquivosExtra ?? [])]
  const descritoresConteudo = descreverArquivos(conteudo)

  const fontes = montarFontesManifesto(detalhadas, input.fiscal)
  const estadoPorFonte = new Map<string, EstadoFonte>(fontes.map((f) => [f.nome, f.estado]))

  const indice: ArquivoPacote = {
    caminho: "00-LEIA-ME/indice.md",
    categoria: "indice",
    fonte: "indice",
    descricao: "Índice com finalidade, fonte, estado, registros, bytes e hash de cada arquivo.",
    conteudo: renderIndiceMd(conteudo, descritoresConteudo, estadoPorFonte, competencia, agora),
  }

  const arquivosComIndice = [...conteudo, indice]
  const descritoresTodos = descreverArquivos(arquivosComIndice)

  const manifesto = montarManifesto({
    descritores: descritoresTodos,
    fontes,
    competencia,
    periodo,
    agora,
    storeId,
    userId,
    pendencias: montarPendencias(entrada),
    itensNaoDisponiveis: montarItensNaoDisponiveis(entrada),
    avisos: montarAvisos(input.fiscal),
    ...(input.snapshotHash ? { snapshotHash: input.snapshotHash } : {}),
  })

  const manifestoArquivo: ArquivoPacote = {
    caminho: "manifest.json",
    categoria: "manifesto",
    fonte: "manifesto",
    descricao: "Manifesto v1 — raiz de integridade do pacote.",
    conteudo: serializarManifesto(manifesto),
  }

  const arquivos = [...arquivosComIndice, manifestoArquivo]
  if (arquivos.length > MAX_ARQUIVOS_PACOTE) {
    throw new PacoteLimiteExcedidoError(
      "arquivos_pacote",
      `Pacote excedeu MAX_ARQUIVOS_PACOTE=${MAX_ARQUIVOS_PACOTE} (${arquivos.length} arquivos). A lista de XML não foi truncada.`,
    )
  }
  assertBytesDescompactados(arquivos)
  assertPacoteSeguro(arquivos, { storeId })

  return {
    nomeArquivo: `pacote-contador-${sanitizarStoreIdParaArquivo(storeId)}-${formatCompetencia(competencia)}.zip`,
    arquivos,
    manifesto,
  }
}

/**
 * GOAL 012A — produz arquivos extra a partir da MESMA carga que gerou o pacote.
 * Roda depois de `dados`/`checklist` e ANTES da montagem do manifesto e do ZIP, então
 * lançar aqui aborta a geração cedo (sem custo de compactação).
 */
export type MontarExtras = (entrada: {
  dados: ContadorDadosReais
  checklist: ChecklistFechamento
}) => { arquivos: readonly ArquivoPacote[]; snapshotHash?: string }

export type GerarPacoteContadorInput = Readonly<{
  scope: ContadorScopeInterno
  competencia: Competencia
  agora: Date
  montarExtras?: MontarExtras
}>

/**
 * Gera o pacote sob demanda: carga única detalhada → agregado + checklist → conteúdo → ZIP.
 * Nada é persistido. Lança `PacoteLimiteExcedidoError` se algum teto for excedido e
 * `PacoteTimeoutError` se a geração ultrapassar `TIMEOUT_LOGICO_MS` (teto lógico de duração).
 */
export async function gerarPacoteContador(
  input: GerarPacoteContadorInput,
): Promise<PacoteContador> {
  return executarComTimeoutLogico(() => gerarPacoteContadorInterno(input), TIMEOUT_LOGICO_MS)
}

async function gerarPacoteContadorInterno(
  input: GerarPacoteContadorInput,
): Promise<PacoteContador> {
  // Imports dinâmicos: só aqui o grafo toca Prisma (mantém o módulo testável sem banco).
  const { carregarFontesPacote } = await import("./carregar-fontes")
  const { montarDados } = await import("@/lib/contador/readers")
  const { lerNotasFiscais, toEvidenciaPacote, toEvidenciaChecklist } = await import(
    "@/lib/contador/readers/fiscal"
  )

  const detalhadas = await carregarFontesPacote({ scope: input.scope, competencia: input.competencia })
  const dados = montarDados(detalhadas.agregado, input.competencia)
  const fiscalLeitura = await lerNotasFiscais(input.scope, input.competencia)
  const checklist = montarChecklistFechamento({
    dados,
    competencia: input.competencia,
    agora: input.agora,
    evidenciaFiscal: toEvidenciaChecklist(fiscalLeitura),
  })

  const extras = input.montarExtras?.({ dados, checklist })

  const conteudo = montarConteudoPacote({
    detalhadas,
    dados,
    checklist,
    competencia: input.competencia,
    agora: input.agora,
    storeId: input.scope.storeId,
    userId: input.scope.userId,
    fiscal: toEvidenciaPacote(fiscalLeitura),
    ...(extras ? { arquivosExtra: extras.arquivos, snapshotHash: extras.snapshotHash } : {}),
  })

  const bytesDescompactados = conteudo.arquivos.reduce(
    (acc, a) => acc + Buffer.byteLength(a.conteudo, "utf8"),
    0,
  )
  const bytes = await ziparArquivos(conteudo.arquivos, input.agora)
  assertBytesZip(bytes.byteLength)

  const fontes = montarFontesManifesto(detalhadas, toEvidenciaPacote(fiscalLeitura))
  const contagens: Record<string, number> = {}
  for (const f of fontes) contagens[f.nome] = f.registros
  const fontesParciais = fontes.filter((f) => f.estado === "parcial").map((f) => f.nome)
  const fontesIndisponiveis = fontes.filter((f) => f.estado === "indisponivel").map((f) => f.nome)

  return {
    nomeArquivo: conteudo.nomeArquivo,
    bytes,
    manifesto: conteudo.manifesto,
    // GOAL 012: devolvidos para o fechamento montar o snapshot da MESMA carga.
    dados,
    checklist,
    metricas: {
      bytesZip: bytes.byteLength,
      bytesDescompactados,
      arquivos: conteudo.arquivos.length,
      contagens,
      fontesParciais,
      fontesIndisponiveis,
    },
  }
}
