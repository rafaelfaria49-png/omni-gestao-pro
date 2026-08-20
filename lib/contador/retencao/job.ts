/**
 * Contador HUB · Retenção — JOB idempotente (GOAL 019).
 *
 * Modo padrão: **DRY-RUN**. Em dry-run o job só conta e soma; a porta de escrita nem
 * é consultada. Em apply o descarte é do BLOB e apenas do blob.
 *
 * ─────────────────────── o que este job NUNCA faz ───────────────────────
 *  · `DELETE` em `ContadorDocumento` — nem soft, nem hard;
 *  · `DELETE`/`UPDATE` em `ContadorEvento` — a trilha é append-only;
 *  · `DELETE` em `ContadorPacote` / `ContadorPacoteItem` — o manifesto persiste;
 *  · tocar `ContadorCompetencia.snapshot` — o snapshot congelado é intocável;
 *  · escrever qualquer coisa em modo dry-run.
 *
 * Nada disso depende de disciplina do chamador: a porta `RetencaoEscritaPort`
 * simplesmente não expõe método capaz de fazê-lo (`tipos.ts`).
 *
 * ─────────────────────── idempotência ───────────────────────
 * O marcador de "já descartado" é o PRÓPRIO STORAGE. Antes de remover, o job
 * pergunta `blobExiste`. Ausente ⇒ conta em `jaAusentes`, não emite evento, não
 * escreve nada. Por isso a segunda execução sobre a mesma massa não duplica evento
 * nem falha — e um blob que nunca existiu é tratado igual, sem erro fatal.
 *
 * ─────────────────────── gate de APPLY ───────────────────────
 * `CONTADOR_RETENCAO_APPLY` precisa valer exatamente `on`. Ausente, vazia ou
 * qualquer outro valor ⇒ `RetencaoApplyBloqueadoError`. Falha FECHADO: não há
 * default, não há "assume dry-run silenciosamente" (silêncio esconderia a intenção
 * de apagar) e não há segunda variável que destrave.
 */
import {
  METRICAS,
  metricasPadrao,
  type MetricasPort,
} from "@/lib/contador/observabilidade"
import {
  BLOB_SOFT_DELETADO_RETENCAO_DIAS,
  CATEGORIAS_DOCUMENTO,
  corteBlobSoftDeletado,
  corteDocumento,
  cortePacote,
  PACOTE_RETENCAO_MESES,
  PURGE_DISABLED,
  RETENCAO_DOCUMENTOS,
  type CategoriaDocumentoRetencao,
} from "./politica"
import type {
  AlvoRetencao,
  CandidatoRetencao,
  FalhaRetencao,
  ModoRetencao,
  RelatorioRetencao,
  ResumoAlvoRetencao,
  RetencaoEscritaPort,
  RetencaoLeituraPort,
} from "./tipos"

/** Nome da variável que destrava o modo apply. */
export const ENV_RETENCAO_APPLY = "CONTADOR_RETENCAO_APPLY" as const

/** Tipos de evento anexados à trilha quando um blob é efetivamente descartado. */
export const EVENTO_DOCUMENTO_BLOB_DESCARTADO = "documento_blob_descartado" as const
export const EVENTO_PACOTE_ARTEFATO_DESCARTADO = "pacote_artefato_descartado" as const

const ALVO_DOCUMENTO = "documento" as const
const ALVO_PACOTE = "pacote" as const

/** Apply pedido sem o gate explícito. */
export class RetencaoApplyBloqueadoError extends Error {
  readonly code = "RETENCAO_APPLY_BLOQUEADO" as const
  constructor() {
    super(
      `Modo apply bloqueado: defina ${ENV_RETENCAO_APPLY}="on" no ambiente. Sem o valor exato, o job recusa apagar qualquer coisa.`,
    )
    this.name = "RetencaoApplyBloqueadoError"
  }
}

/** Apply pedido sem a porta de escrita — erro de programação, não de configuração. */
export class RetencaoEscritaAusenteError extends Error {
  readonly code = "RETENCAO_ESCRITA_AUSENTE" as const
  constructor() {
    super("Modo apply exige a porta de escrita (deps.escrita). Em dry-run ela nao deve ser fornecida.")
    this.name = "RetencaoEscritaAusenteError"
  }
}

/** `true` somente com o valor exato `on` (trim + lowercase, padrão das flags do HUB). */
export function applyHabilitado(env: Record<string, string | undefined> = process.env): boolean {
  return (env[ENV_RETENCAO_APPLY] ?? "").trim().toLowerCase() === "on"
}

export type DepsJobRetencao = Readonly<{
  leitura: RetencaoLeituraPort
  /** Só em apply. Fornecer em dry-run é inofensivo — o job não a consulta. */
  escrita?: RetencaoEscritaPort
  env?: Record<string, string | undefined>
  metricas?: MetricasPort
}>

export type OpcoesJobRetencao = Readonly<{
  /** Lojas a varrer. Toda consulta é escopada por `storeId`. */
  storeIds: readonly string[]
  modo?: ModoRetencao
  agora?: Date
}>

/** Rótulo curto e seguro da política, para label de métrica. */
function rotuloPolitica(categoria: CategoriaDocumentoRetencao): string {
  const p = RETENCAO_DOCUMENTOS[categoria]
  return p.tipo === PURGE_DISABLED ? PURGE_DISABLED : `${p.unidade}_${p.quantidade}`
}

/** Acumulador mutável de um alvo; congelado no fim da execução. */
type Acumulador = {
  alvo: AlvoRetencao
  candidatos: number
  bytesCandidatos: number
  protegidos: number
  porCategoria: Record<string, number>
  descartados: number
  jaAusentes: number
  falhas: number
}

function novoAcumulador(alvo: AlvoRetencao): Acumulador {
  return {
    alvo,
    candidatos: 0,
    bytesCandidatos: 0,
    protegidos: 0,
    porCategoria: {},
    descartados: 0,
    jaAusentes: 0,
    falhas: 0,
  }
}

function congelar(a: Acumulador): ResumoAlvoRetencao {
  return Object.freeze({
    alvo: a.alvo,
    candidatos: a.candidatos,
    bytesCandidatos: a.bytesCandidatos,
    protegidos: a.protegidos,
    porCategoria: Object.freeze({ ...a.porCategoria }),
    descartados: a.descartados,
    jaAusentes: a.jaAusentes,
    falhas: a.falhas,
  })
}

/**
 * Rótulo técnico curto do erro. NUNCA a mensagem crua: mensagem de provider pode
 * carregar URL assinada, bucket, chave ou path.
 */
function rotularFalha(erro: unknown): string {
  if (erro && typeof erro === "object" && "code" in erro) {
    const code = String((erro as { code?: unknown }).code ?? "")
    if (/^[A-Za-z0-9_]{1,40}$/.test(code)) return code
  }
  if (erro instanceof Error && /^[A-Za-z0-9_]{1,40}$/.test(erro.name)) return erro.name
  return "erro_desconhecido"
}

/**
 * Executa o job. Uma falha isolada (leitura de um lote, remoção de um blob, escrita
 * de um evento) é registrada e o job segue: um documento problemático não pode
 * impedir a varredura das outras lojas.
 */
export async function executarJobRetencao(
  deps: DepsJobRetencao,
  opcoes: OpcoesJobRetencao,
): Promise<RelatorioRetencao> {
  const modo: ModoRetencao = opcoes.modo ?? "dry-run"
  const agora = opcoes.agora ?? new Date()
  const env = deps.env ?? process.env
  const metricas = deps.metricas ?? metricasPadrao

  if (modo === "apply") {
    if (!applyHabilitado(env)) throw new RetencaoApplyBloqueadoError()
    if (!deps.escrita) throw new RetencaoEscritaAusenteError()
  }

  const documentos = novoAcumulador("documentos")
  const blobs = novoAcumulador("blobs_soft_deletados")
  const pacotes = novoAcumulador("pacotes")
  const erros: FalhaRetencao[] = []

  const corteBlobs = corteBlobSoftDeletado(agora)
  const cortePac = cortePacote(agora)
  const cortesDocumentos: Record<string, string | null> = {}
  for (const categoria of CATEGORIAS_DOCUMENTO) {
    const corte = corteDocumento(categoria, agora)
    cortesDocumentos[categoria] = corte ? corte.toISOString() : null
  }

  /**
   * Descarta o blob de um candidato. Só é chamada em apply — o dry-run nunca chega
   * aqui, e é por isso que `deps.escrita` pode ser `undefined` sem risco.
   */
  const descartar = async (
    candidato: CandidatoRetencao,
    acc: Acumulador,
    tipoEvento: string,
    entidade: string,
    metadata: Record<string, string | number>,
  ): Promise<void> => {
    const escrita = deps.escrita!
    try {
      const existe = await escrita.blobExiste(candidato.storageRef)
      if (!existe) {
        // Idempotente: já descartado (ou nunca existiu). Sem evento, sem escrita.
        acc.jaAusentes += 1
        return
      }
      await escrita.removerBlob(candidato.storageRef)
      await escrita.registrarEventoDescarte({
        storeId: candidato.storeId,
        competenciaId: candidato.competenciaId,
        tipo: tipoEvento,
        entidade,
        entidadeId: candidato.id,
        metadata,
      })
      acc.descartados += 1
    } catch (erro) {
      acc.falhas += 1
      erros.push(
        Object.freeze({
          alvo: acc.alvo,
          motivo: rotularFalha(erro),
          registroId: candidato.id,
          storeId: candidato.storeId,
        }),
      )
    }
  }

  const registrarFalhaLeitura = (alvo: AlvoRetencao, storeId: string, erro: unknown): void => {
    erros.push(
      Object.freeze({ alvo, motivo: rotularFalha(erro), registroId: null, storeId }),
    )
  }

  for (const storeId of opcoes.storeIds) {
    /* ── alvo 1 · documentos vivos além da janela da categoria ── */
    for (const categoria of CATEGORIAS_DOCUMENTO) {
      const corte = corteDocumento(categoria, agora)

      try {
        documentos.protegidos += await deps.leitura.contarDocumentosProtegidos({
          storeId,
          categoria,
          corte,
        })
      } catch (erro) {
        documentos.falhas += 1
        registrarFalhaLeitura("documentos", storeId, erro)
      }

      // PURGE_DISABLED: nem sequer consulta candidatos. Não existe caminho que
      // produza candidato FISCAL/JURIDICO/FOLHA por idade.
      if (corte === null) continue

      let lote: readonly CandidatoRetencao[] = []
      try {
        lote = await deps.leitura.documentosAlemDaRetencao({ storeId, categoria, corte })
      } catch (erro) {
        documentos.falhas += 1
        registrarFalhaLeitura("documentos", storeId, erro)
        continue
      }

      for (const candidato of lote) {
        documentos.candidatos += 1
        documentos.bytesCandidatos += candidato.bytes
        documentos.porCategoria[categoria] = (documentos.porCategoria[categoria] ?? 0) + 1
        if (modo === "apply") {
          await descartar(candidato, documentos, EVENTO_DOCUMENTO_BLOB_DESCARTADO, ALVO_DOCUMENTO, {
            categoria,
            bytes: candidato.bytes,
            politica: rotuloPolitica(categoria),
          })
        }
      }
    }

    /* ── alvo 2 · blobs de documentos soft-deletados (todas as categorias) ── */
    try {
      blobs.protegidos += await deps.leitura.contarBlobsSoftDeletadosProtegidos({
        storeId,
        corte: corteBlobs,
      })
    } catch (erro) {
      blobs.falhas += 1
      registrarFalhaLeitura("blobs_soft_deletados", storeId, erro)
    }

    try {
      const lote = await deps.leitura.blobsSoftDeletadosAlemDaRetencao({
        storeId,
        corte: corteBlobs,
      })
      for (const candidato of lote) {
        blobs.candidatos += 1
        blobs.bytesCandidatos += candidato.bytes
        const cat = candidato.categoria ?? "DESCONHECIDA"
        blobs.porCategoria[cat] = (blobs.porCategoria[cat] ?? 0) + 1
        if (modo === "apply") {
          await descartar(candidato, blobs, EVENTO_DOCUMENTO_BLOB_DESCARTADO, ALVO_DOCUMENTO, {
            categoria: cat,
            bytes: candidato.bytes,
            politica: `dias_${BLOB_SOFT_DELETADO_RETENCAO_DIAS}`,
          })
        }
      }
    } catch (erro) {
      blobs.falhas += 1
      registrarFalhaLeitura("blobs_soft_deletados", storeId, erro)
    }

    /* ── alvo 3 · artefato ZIP de pacotes gerados há mais de 12 meses ── */
    try {
      pacotes.protegidos += await deps.leitura.contarPacotesProtegidos({
        storeId,
        corte: cortePac,
      })
    } catch (erro) {
      pacotes.falhas += 1
      registrarFalhaLeitura("pacotes", storeId, erro)
    }

    try {
      const lote = await deps.leitura.pacotesAlemDaRetencao({ storeId, corte: cortePac })
      for (const candidato of lote) {
        pacotes.candidatos += 1
        pacotes.bytesCandidatos += candidato.bytes
        if (modo === "apply") {
          await descartar(candidato, pacotes, EVENTO_PACOTE_ARTEFATO_DESCARTADO, ALVO_PACOTE, {
            bytes: candidato.bytes,
            politica: `meses_${PACOTE_RETENCAO_MESES}`,
            versao: candidato.versao ?? 0,
          })
        }
      }
    } catch (erro) {
      pacotes.falhas += 1
      registrarFalhaLeitura("pacotes", storeId, erro)
    }
  }

  const resumoDocumentos = congelar(documentos)
  const resumoBlobs = congelar(blobs)
  const resumoPacotes = congelar(pacotes)
  const totais = [resumoDocumentos, resumoBlobs, resumoPacotes]

  const relatorio: RelatorioRetencao = Object.freeze({
    modo,
    executadoEm: agora.toISOString(),
    lojas: Object.freeze([...opcoes.storeIds]),
    cortesDocumentos: Object.freeze(cortesDocumentos),
    cortePacotes: cortePac.toISOString(),
    corteBlobsSoftDeletados: corteBlobs.toISOString(),
    documentos: resumoDocumentos,
    blobsSoftDeletados: resumoBlobs,
    pacotes: resumoPacotes,
    bytesEstimadosLiberados: totais.reduce((acc, r) => acc + r.bytesCandidatos, 0),
    protegidosPorPolitica: totais.reduce((acc, r) => acc + r.protegidos, 0),
    erros: Object.freeze([...erros]),
  })

  emitirMetricas(relatorio, metricas)
  return relatorio
}

/** Publica o relatório como métricas. Labels passam pelo saneador do módulo. */
function emitirMetricas(relatorio: RelatorioRetencao, metricas: MetricasPort): void {
  const modo = relatorio.modo
  metricas.registrar(
    modo === "apply" ? METRICAS.retencaoApplyTotal : METRICAS.retencaoDryRunTotal,
    1,
    { modo },
  )
  for (const resumo of [relatorio.documentos, relatorio.blobsSoftDeletados, relatorio.pacotes]) {
    metricas.registrar(METRICAS.retencaoCandidatosTotal, resumo.candidatos, {
      alvo: resumo.alvo,
      modo,
    })
    metricas.registrar(METRICAS.retencaoBytesCandidatos, resumo.bytesCandidatos, {
      alvo: resumo.alvo,
      modo,
    })
    if (resumo.falhas > 0) {
      metricas.registrar(METRICAS.retencaoFalhasTotal, resumo.falhas, {
        alvo: resumo.alvo,
        modo,
      })
    }
  }
}
