/**
 * Contador HUB · Pacote do Contador — índice e manifesto v1 canônico (puro). GOAL 008B.
 *
 * `manifest.json` schema `omni.contador.pacote.manifest/v1`. É a raiz de integridade:
 * lista hash/bytes de TODOS os demais arquivos (inclusive INDICE.md), nunca a si mesmo.
 * `competencia.storeId` é o único lugar do pacote onde o storeId aparece.
 * `geradoPor.id` é pseudônimo interno (hash curto do userId) — nunca e-mail/nome.
 */
import {
  formatCompetencia,
  labelCompetencia,
  type Competencia,
  type PeriodoUtc,
} from "@/lib/contador/competencia"
import { bytesUtf8, sha256Hex } from "./seguranca"
import type {
  ArquivoManifestoV1,
  ArquivoPacote,
  EstadoFonte,
  FonteManifestoV1,
  ManifestoPacoteContadorV1,
} from "./tipos"

/** Calcula bytes + sha256 de cada arquivo (ordem preservada). */
export function descreverArquivos(arquivos: readonly ArquivoPacote[]): ArquivoManifestoV1[] {
  return arquivos.map((a) => ({
    caminho: a.caminho,
    bytes: bytesUtf8(a.conteudo),
    sha256: sha256Hex(a.conteudo),
    fonte: a.fonte,
    ...(a.registros !== undefined ? { registros: a.registros } : {}),
  }))
}

/** Identificador interno pseudônimo do gerador (nunca e-mail/nome). */
export function geradoPorInterno(userId: string): { tipo: "interno"; id: string } {
  return { tipo: "interno", id: `u_${sha256Hex(String(userId ?? "")).slice(0, 16)}` }
}

/** Renderiza o `INDICE.md` humano a partir dos arquivos de conteúdo. */
export function renderIndiceMd(
  conteudo: readonly ArquivoPacote[],
  descritores: readonly ArquivoManifestoV1[],
  estadoPorFonte: ReadonlyMap<string, EstadoFonte>,
  competencia: Competencia,
  agora: Date,
): string {
  const linhas: string[] = [
    `# Índice do Pacote do Contador — ${labelCompetencia(competencia)}`,
    "",
    `- Competência: \`${formatCompetencia(competencia)}\``,
    `- Gerado em: ${agora.toISOString()}`,
    "",
    "| Arquivo | Finalidade | Fonte | Estado | Registros | Bytes | sha256 |",
    "|---|---|---|---|---|---|---|",
  ]
  for (let i = 0; i < conteudo.length; i++) {
    const a = conteudo[i]
    const d = descritores[i]
    const estado = estadoPorFonte.get(a.fonte) ?? "—"
    const registros = a.registros !== undefined ? String(a.registros) : "—"
    const desc = a.descricao.replace(/\|/g, "\\|")
    linhas.push(`| \`${a.caminho}\` | ${desc} | ${a.fonte} | ${estado} | ${registros} | ${d.bytes} | \`${d.sha256}\` |`)
  }
  linhas.push(
    "| `00-LEIA-ME/indice.md` | Este índice | indice | — | — | — | (hash em manifest.json) |",
    "| `manifest.json` | Raiz de integridade (v1) | manifesto | — | — | — | (não se auto-referencia) |",
    "",
    "Os hashes acima cobrem os arquivos de conteúdo. O `manifest.json` é a raiz de",
    "integridade e lista também o hash do próprio `00-LEIA-ME/indice.md`.",
    "",
  )
  return linhas.join("\n")
}

/** Monta o `manifest.json` canônico v1. */
export function montarManifesto(input: {
  descritores: readonly ArquivoManifestoV1[]
  fontes: readonly FonteManifestoV1[]
  competencia: Competencia
  periodo: PeriodoUtc
  agora: Date
  storeId: string
  userId: string
  pendencias: readonly string[]
  itensNaoDisponiveis: readonly string[]
  avisos: readonly string[]
  /** GOAL 012A — referência ao snapshot do fechamento (dependência unidirecional). */
  snapshotHash?: string
}): ManifestoPacoteContadorV1 {
  return {
    schema: "omni.contador.pacote.manifest/v1",
    pacoteVersao: 1,
    competencia: {
      storeId: input.storeId,
      ano: input.competencia.ano,
      mes: input.competencia.mes,
      timezone: "America/Sao_Paulo",
      periodoUtc: {
        inicio: input.periodo.inicio.toISOString(),
        fimExclusivo: input.periodo.fimExclusivo.toISOString(),
      },
    },
    geradoEm: input.agora.toISOString(),
    geradoPor: geradoPorInterno(input.userId),
    fontes: input.fontes,
    arquivos: input.descritores,
    pendencias: input.pendencias,
    itensNaoDisponiveis: input.itensNaoDisponiveis,
    avisos: input.avisos,
    ...(input.snapshotHash ? { snapshotHash: input.snapshotHash } : {}),
  }
}

/** Serializa o manifesto de forma estável (2 espaços) para `manifest.json`. */
export function serializarManifesto(manifesto: ManifestoPacoteContadorV1): string {
  return JSON.stringify(manifesto, null, 2) + "\n"
}
