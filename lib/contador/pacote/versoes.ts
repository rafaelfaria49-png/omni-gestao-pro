/**
 * Contador HUB · versões persistidas do pacote oficial (GOAL 012).
 *
 * Diferente do pacote sob demanda do GOAL 008 (gerado e descartado a cada request),
 * aqui as versões são MATERIALIZADAS: cada fechamento grava um `ContadorPacote`
 * imutável, e estas funções listam, baixam e comparam essas versões.
 *
 * PURO em relação a IO: tudo passa pelas portas `FechamentoRepo` e `StoragePacotePort`.
 */
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import {
  ALVO_COMPETENCIA,
  ATOR_TIPO_INTERNO,
  CompetenciaNaoEncontradaError,
  EVENTO_PACOTE_BAIXADO,
  ORIGEM_FECHAMENTO,
  PacoteNaoEncontradoError,
  type EscopoFechamento,
  type FechamentoRepo,
  type StoragePacotePort,
} from "@/lib/contador/fechamento/service"
import { compararManifestos, type DiffManifestos } from "./diff"

export type DepsVersoes = Readonly<{ repo: FechamentoRepo }>
export type DepsDownload = Readonly<{ repo: FechamentoRepo; storage: StoragePacotePort }>

/** Nome sugerido do arquivo entregue ao usuário — sem storeId cru no nome. */
export function nomeArquivoPacote(codigoCompetencia: string, versao: number): string {
  return `pacote-contador-${codigoCompetencia}-v${versao}.zip`
}

/* ───────────────────────────── download ───────────────────────────── */

export type DownloadPacoteDto = Readonly<{
  versao: number
  manifestoHash: string
  bytes: number
  nomeArquivo: string
  url: string
  expiresInSec: number
}>

/**
 * Autoriza o download de UMA versão persistida.
 *
 * Registra `pacote_baixado` — evento honesto: autoriza o download, não afirma que o
 * arquivo chegou. A URL assinada é de curta duração e NUNCA é persistida; o
 * `storageRef` não sai no DTO.
 */
export async function autorizarDownloadPacote(
  escopo: EscopoFechamento,
  comp: Competencia,
  versao: number,
  deps: DepsDownload,
): Promise<DownloadPacoteDto> {
  const codigo = formatCompetencia(comp)
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) throw new CompetenciaNaoEncontradaError()

  const pacote = await deps.repo.acharPacote(competencia.id, versao)
  if (!pacote) throw new PacoteNaoEncontradoError()

  // Coerência storage × banco: uma linha commitada sem blob é falha real, não 404 mudo.
  const existe = await deps.storage.verificarExistencia(pacote.storageRef)
  if (!existe) throw new PacoteNaoEncontradoError()

  const nomeArquivo = nomeArquivoPacote(codigo, pacote.versao)
  const { signedUrl, expiresInSec } = await deps.storage.criarDownloadAssinado(
    pacote.storageRef,
    nomeArquivo,
  )

  await deps.repo.registrarEvento({
    storeId: escopo.storeId,
    competenciaId: competencia.id,
    tipo: EVENTO_PACOTE_BAIXADO,
    atorTipo: ATOR_TIPO_INTERNO,
    atorId: escopo.userId,
    entidade: ALVO_COMPETENCIA,
    entidadeId: competencia.id,
    origem: ORIGEM_FECHAMENTO,
    // Metadata saneada: ponteiros de integridade, nunca storageRef nem URL assinada.
    metadata: {
      competencia: codigo,
      versao: pacote.versao,
      manifestoHash: pacote.manifestoHash,
      bytes: pacote.bytes,
    },
  })

  return Object.freeze({
    versao: pacote.versao,
    manifestoHash: pacote.manifestoHash,
    bytes: pacote.bytes,
    nomeArquivo,
    url: signedUrl,
    expiresInSec,
  })
}

/* ───────────────────────────── comparação ───────────────────────────── */

/**
 * Compara duas versões usando SOMENTE os itens de manifesto persistidos.
 * Nenhum ZIP é baixado: o `sha256` por arquivo já prova a mudança de conteúdo.
 */
export async function compararVersoes(
  escopo: EscopoFechamento,
  comp: Competencia,
  versaoDe: number,
  versaoPara: number,
  deps: DepsVersoes,
): Promise<DiffManifestos> {
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) throw new CompetenciaNaoEncontradaError()

  const [pDe, pPara] = await Promise.all([
    deps.repo.acharPacote(competencia.id, versaoDe),
    deps.repo.acharPacote(competencia.id, versaoPara),
  ])
  if (!pDe || !pPara) throw new PacoteNaoEncontradoError()

  const [itensDe, itensPara] = await Promise.all([
    deps.repo.listarItensPacote(pDe.id),
    deps.repo.listarItensPacote(pPara.id),
  ])

  return compararManifestos(
    { versao: pDe.versao, manifestoHash: pDe.manifestoHash, itens: itensDe },
    { versao: pPara.versao, manifestoHash: pPara.manifestoHash, itens: itensPara },
  )
}

/** Converte `?v=` em inteiro positivo, recusando lixo com erro de domínio. */
export function versaoOuErro(valor: unknown): number {
  const n = Number(typeof valor === "string" ? valor.trim() : valor)
  if (!Number.isInteger(n) || n < 1) throw new PacoteNaoEncontradoError()
  return n
}
