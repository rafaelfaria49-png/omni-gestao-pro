/**
 * Contador HUB · Portal externo read-only — utilitários de TESTE DE ROTA (GOAL 015).
 *
 * USO EXCLUSIVO dos `*.test.ts` deste namespace. Monta:
 *  - a sessão externa DE VERDADE (`autenticarECriarSessao` + cookie HMAC) sobre o
 *    fake in-memory do GOAL 014 (`criarDbFalsoAuthExterna`), injetado via
 *    `__setRepoAuthExternaParaTestes`;
 *  - os fakes in-memory das portas de domínio do portal, injetados via
 *    `__setDepsPortalParaTestes` (seam de `lib/contador/portal/deps.ts`).
 *
 * Sem `vi.mock("@/lib/prisma")`, sem banco real, sem storage real.
 */
import {
  criarDbFalsoAuthExterna,
  linhaAcesso,
  linhaUsuario,
  type DbFalsoAuthExterna,
} from "@/lib/contador/auth-externa/fakes"
import { criarRepoAuthExterna, type AuthExternaRepo } from "@/lib/contador/auth-externa/repo-prisma"
import {
  autenticarECriarSessao,
  CONTADOR_EXTERNO_COOKIE,
} from "@/lib/contador/auth-externa/sessao"
import { hashSenhaExterna } from "@/lib/contador/auth-externa/usuarios"
import type { AcessoRow } from "@/lib/contador/auth-externa/tipos"
import type { ComentarioRow, ComentariosRepo } from "@/lib/contador/comentarios/service"
import type { DocumentoRow, DocumentosRepo } from "@/lib/contador/documentos/service"
import type { StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"
import type {
  CompetenciaFechamentoRow,
  FechamentoRepo,
  PacoteRow,
  StoragePacotePort,
} from "@/lib/contador/fechamento/service"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import { monetarioReal, numericoReal } from "@/lib/contador/readers/tipos"
import { TransicaoConcorrenteError } from "@/lib/contador/status/matriz"
import type { DocumentoStatusRow, StatusRepo } from "@/lib/contador/status/service"
import type { EventoTimeline } from "@/lib/contador/timeline/projecao"
import type { TimelineRepo } from "@/lib/contador/timeline/service"
import type { NovoEventoPortal, PortalEventosRepo } from "@/lib/contador/portal/eventos"
import type { OverridesDepsPortal } from "@/lib/contador/portal/deps"

/**
 * Reexportado DA ORIGEM de propósito: os testes de rota do portal setam/limpam
 * este env por teste e importam tudo deste barrel. Sem o reexport o nome chega
 * `undefined` e `process.env[undefined] = …` grava numa chave lixo — o segredo
 * nunca é aplicado e todo login falha com 503.
 *
 * Tem de ser `export … from` (e não `import` + `export { … }`): sob
 * `isolatedModules` o esbuild não consegue provar que um binding importado é
 * valor, trata o reexport como type-only e o elide do bundle de teste.
 */
export { ENV_SEGREDO_SESSAO_EXTERNA } from "@/lib/contador/auth-externa/sessao"

export const SEGREDO_PORTAL = "segredo-teste-rotas-015"
export const SENHA_PORTAL = "senha-super-secreta-1"
export const EMAIL_PORTAL = "contador@escritorio.com"
export const AGORA_TESTE = new Date("2026-08-01T12:00:00.000Z")
export const IP_TESTE = "203.0.113.9"

export const ENV_FLAG_PORTAL = "CONTADOR_PORTAL_V2" as const

/* ───────────────────────────── auth externa (GOAL 014) ───────────────────────────── */

export type AuthPortalTeste = Readonly<{ db: DbFalsoAuthExterna; repo: AuthExternaRepo }>

/**
 * usr-1: loja-A (LEITURA) + loja-C (CONFERENCIA). usr-2: loja-B — os dados da
 * loja-B existem "no mundo", mas o usr-1 NÃO tem vínculo (cross-store → 403).
 */
export async function montarAuthPortal(acessosExtras: AcessoRow[] = []): Promise<AuthPortalTeste> {
  const db = criarDbFalsoAuthExterna({
    usuarios: [
      linhaUsuario({ id: "usr-1", email: EMAIL_PORTAL, senhaHash: await hashSenhaExterna(SENHA_PORTAL) }),
      linhaUsuario({ id: "usr-2", email: "outro@escritorio.com" }),
    ],
    acessos: [
      linhaAcesso({ id: "acs-1", usuarioId: "usr-1", storeId: "loja-A", papel: "LEITURA" }),
      linhaAcesso({ id: "acs-2", usuarioId: "usr-1", storeId: "loja-C", papel: "CONFERENCIA" }),
      linhaAcesso({ id: "acs-3", usuarioId: "usr-2", storeId: "loja-B", papel: "LEITURA" }),
      ...acessosExtras,
    ],
  })
  return { db, repo: criarRepoAuthExterna(db) }
}

export async function loginPortal(repo: AuthExternaRepo, email = EMAIL_PORTAL): Promise<string> {
  const r = await autenticarECriarSessao(repo, { email, senha: SENHA_PORTAL, env: process.env })
  if (!r.ok) throw new Error("login deveria ter sucesso")
  return r.cookie.value
}

export function reqPortal(
  path: string,
  opts: Readonly<{ cookie?: string; method?: "GET" | "POST"; body?: unknown }> = {},
): Request {
  const headers: Record<string, string> = {
    "x-forwarded-for": IP_TESTE,
    "user-agent": "vitest-portal/1.0",
  }
  if (opts.cookie) headers.cookie = `${CONTADOR_EXTERNO_COOKIE}=${opts.cookie}`
  const init: RequestInit = { method: opts.method ?? "GET", headers }
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(opts.body)
  }
  return new Request(`http://localhost${path}`, init)
}

/* ───────────────────────────── estado de domínio ───────────────────────────── */

export type EventoTrilhaTeste = NovoEventoPortal & { criadoEm: Date }

export type EstadoDominioPortal = {
  competencias: CompetenciaFechamentoRow[]
  pacotes: PacoteRow[]
  documentos: DocumentoRow[]
  comentarios: ComentarioRow[]
  /** Eventos gravados pelo PortalEventosRepo (downloads, recebimento). */
  eventos: EventoTrilhaTeste[]
  /** Eventos gravados pelas portas transacionais do domínio (comentário/status). */
  eventosDominio: Record<string, unknown>[]
  /** Eventos lidos pela timeline (ContadorEvento projetado). */
  timelineEventos: EventoTimeline[]
  /** Refs existentes no storage fake. */
  storageRefs: Set<string>
  downloadsAssinados: { storageRef: string; nomeArquivo: string; ttl: number | undefined }[]
  carregarDadosChamadas: { storeId: string; ano: number; mes: number }[]
}

export function estadoDominioVazio(): EstadoDominioPortal {
  return {
    competencias: [],
    pacotes: [],
    documentos: [],
    comentarios: [],
    eventos: [],
    eventosDominio: [],
    timelineEventos: [],
    storageRefs: new Set(),
    downloadsAssinados: [],
    carregarDadosChamadas: [],
  }
}

export function linhaCompetenciaTeste(over: Partial<CompetenciaFechamentoRow>): CompetenciaFechamentoRow {
  return {
    id: "comp-1",
    storeId: "loja-A",
    ano: 2026,
    mes: 7,
    status: "ABERTA",
    versao: 1,
    snapshot: null,
    snapshotHash: null,
    fechadaEm: null,
    fechadaPorId: null,
    reabertaEm: null,
    updatedAt: AGORA_TESTE,
    ...over,
  }
}

export function linhaPacoteTeste(over: Partial<PacoteRow>): PacoteRow {
  return {
    id: "pct-1",
    competenciaId: "comp-1",
    versao: 1,
    manifestoHash: "b".repeat(64),
    storageRef: "contador/loja-A/2026-07/pacotes/v1/hash.zip",
    bytes: 4096,
    geradoPorTipo: "interno",
    geradoPorId: "admin-user-7",
    geradoEm: AGORA_TESTE,
    ...over,
  }
}

export function linhaDocumentoTeste(over: Partial<DocumentoRow>): DocumentoRow {
  return {
    id: "doc-1",
    competenciaId: "comp-1",
    storeId: "loja-A",
    categoria: "FISCAL",
    titulo: "NF-e julho",
    nomeArquivo: "nfe-julho.pdf",
    mime: "application/pdf",
    bytes: 2048,
    sha256: "a".repeat(64),
    storageRef: "contador/loja-A/2026-07/doc-1/nfe-julho.pdf",
    status: "ENVIADO",
    vencimento: null,
    enviadoPorTipo: "interno",
    enviadoPorId: "admin-user-42",
    versaoDeId: null,
    excluidoEm: null,
    excluidoPorId: null,
    excluidoMotivo: null,
    createdAt: AGORA_TESTE,
    updatedAt: AGORA_TESTE,
    ...over,
  }
}

/* ───────────────────────────── fakes das portas ───────────────────────────── */

function naoUsado(nome: string): never {
  throw new Error(`porta não usada pelo portal nesta rota: ${nome}`)
}

function mapDocStatus(doc: DocumentoRow, estado: EstadoDominioPortal): DocumentoStatusRow {
  const comp = estado.competencias.find((c) => c.id === doc.competenciaId)
  return {
    id: doc.id,
    competenciaId: doc.competenciaId,
    storeId: doc.storeId,
    titulo: doc.titulo,
    categoria: doc.categoria,
    status: doc.status,
    vencimento: doc.vencimento,
    excluidoEm: doc.excluidoEm,
    updatedAt: doc.updatedAt,
    competenciaStatus: comp?.status ?? "ABERTA",
    competenciaAno: comp?.ano ?? 2026,
    competenciaMes: comp?.mes ?? 7,
  }
}

/** Monta os overrides completos do seam `deps.ts` sobre o estado in-memory. */
export function criarDepsFalsasPortal(estado: EstadoDominioPortal): OverridesDepsPortal {
  const repoFechamento: FechamentoRepo = {
    getOrCreateCompetencia: () => Promise.reject(naoUsado("getOrCreateCompetencia")),
    acharCompetencia: async (storeId, comp) =>
      estado.competencias.find(
        (c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes,
      ) ?? null,
    listarDocumentosParaSnapshot: () => Promise.reject(naoUsado("listarDocumentosParaSnapshot")),
    aplicarFechamento: () => Promise.reject(naoUsado("aplicarFechamento")),
    aplicarReabertura: () => Promise.reject(naoUsado("aplicarReabertura")),
    listarPacotes: async (competenciaId) =>
      estado.pacotes.filter((p) => p.competenciaId === competenciaId),
    acharPacote: async (competenciaId, versao) =>
      estado.pacotes.find((p) => p.competenciaId === competenciaId && p.versao === versao) ?? null,
    listarItensPacote: () => Promise.reject(naoUsado("listarItensPacote")),
    registrarEventoUnico: () => Promise.reject(naoUsado("registrarEventoUnico")),
    registrarEvento: () => Promise.reject(naoUsado("fechamento.registrarEvento")),
  }

  const repoDocumentos: DocumentosRepo = {
    getOrCreateCompetencia: () => Promise.reject(naoUsado("getOrCreateCompetencia")),
    acharCompetencia: async (storeId, comp) =>
      estado.competencias.find(
        (c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes,
      ) ?? null,
    acharCompetenciaPorId: () => Promise.reject(naoUsado("acharCompetenciaPorId")),
    acharDocumentoPorId: () => Promise.reject(naoUsado("acharDocumentoPorId")),
    acharDocumentoDaLoja: async (id, storeId) =>
      estado.documentos.find((d) => d.id === id && d.storeId === storeId) ?? null,
    listarDocumentos: async ({ competenciaId, storeId, incluirExcluidos }) =>
      estado.documentos.filter(
        (d) =>
          d.competenciaId === competenciaId &&
          d.storeId === storeId &&
          (incluirExcluidos || !d.excluidoEm),
      ),
    criarDocumentoComEvento: () => Promise.reject(naoUsado("criarDocumentoComEvento")),
    softDeleteComEvento: () => Promise.reject(naoUsado("softDeleteComEvento")),
    registrarEvento: () => Promise.reject(naoUsado("documentos.registrarEvento")),
  }

  const repoComentarios: ComentariosRepo = {
    getOrCreateCompetencia: () => Promise.reject(naoUsado("getOrCreateCompetencia")),
    acharCompetencia: async (storeId, comp) =>
      estado.competencias.find(
        (c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes,
      ) ?? null,
    documentoPertence: async ({ documentoId, competenciaId, storeId }) =>
      estado.documentos.some(
        (d) => d.id === documentoId && d.competenciaId === competenciaId && d.storeId === storeId && !d.excluidoEm,
      ),
    criarComentarioComEvento: async ({ comentario, evento }) => {
      const row: ComentarioRow = { ...comentario, createdAt: new Date() }
      estado.comentarios.push(row)
      estado.eventosDominio.push({ ...evento })
      return row
    },
    listarComentarios: async ({ competenciaId, visibilidade, limite }) =>
      estado.comentarios
        .filter((c) => c.competenciaId === competenciaId)
        .filter((c) => !visibilidade || c.visibilidade === visibilidade)
        .slice(0, limite),
  }

  const repoTimeline: TimelineRepo = {
    acharCompetencia: async (storeId, comp) =>
      estado.competencias.find(
        (c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes,
      ) ?? null,
    listarEventos: async () => estado.timelineEventos,
    listarComentarios: async ({ visibilidade }) =>
      estado.comentarios.filter((c) => !visibilidade || c.visibilidade === visibilidade),
  }

  const repoStatus: StatusRepo = {
    acharDocumentoParaTransicao: async (id, storeId) => {
      const doc = estado.documentos.find((d) => d.id === id && d.storeId === storeId)
      return doc ? mapDocStatus(doc, estado) : null
    },
    aplicarTransicao: async (args) => {
      const doc = estado.documentos.find(
        (d) => d.id === args.documentoId && d.storeId === args.storeId,
      )
      if (!doc || doc.status !== args.de) throw new TransicaoConcorrenteError()
      doc.status = args.para
      doc.updatedAt = new Date()
      estado.eventosDominio.push({ ...args.evento })
      return mapDocStatus(doc, estado)
    },
  }

  const repoEventos: PortalEventosRepo = {
    registrarEvento: async (evento) => {
      const criadoEm = new Date()
      estado.eventos.push({ ...evento, criadoEm })
      return { criadoEm }
    },
    acharRecebimentoPacote: async ({ storeId, competenciaId, atorId, versao }) => {
      const ev = estado.eventos.find(
        (e) =>
          e.tipo === "pacote_recebimento_confirmado" &&
          e.storeId === storeId &&
          e.competenciaId === competenciaId &&
          e.atorId === atorId &&
          e.metadata?.versao === versao,
      )
      return ev ? { criadoEm: ev.criadoEm } : null
    },
  }

  const storage = {
    verificarExistencia: async (ref: string) => estado.storageRefs.has(ref),
    criarDownloadAssinado: async (storageRef: string, nomeArquivo: string, ttl?: number) => {
      estado.downloadsAssinados.push({ storageRef, nomeArquivo, ttl })
      return {
        signedUrl: `https://storage.test/assinado?arquivo=${encodeURIComponent(nomeArquivo)}`,
        expiresInSec: Math.min(ttl ?? 300, 300),
      }
    },
  }

  return {
    repoFechamento,
    repoDocumentos,
    repoComentarios,
    repoTimeline,
    repoStatus,
    repoEventos,
    storageDocumentos: storage as unknown as StorageDocumentosPort,
    storagePacotes: storage as unknown as StoragePacotePort,
    carregarDados: async (scope, comp) => {
      estado.carregarDadosChamadas.push({ storeId: scope.storeId, ano: comp.ano, mes: comp.mes })
      return dadosVivosTeste(comp.ano, comp.mes)
    },
  }
}

/** DTO vivo mínimo e coerente (suficiente para a rota de resumo/checklist). */
export function dadosVivosTeste(ano: number, mes: number): ContadorDadosReais {
  const m = (v: number, f: string) => monetarioReal(v, f)
  const n = (v: number, f: string) => numericoReal(v, f)
  return Object.freeze({
    competencia: Object.freeze({ ano, mes }),
    liquidoCompetencia: m(900, "Venda.total − DevolucaoVenda.valorTotal"),
    vendas: Object.freeze({
      quantidade: n(4, "Venda"),
      total: m(1000, "Venda.total"),
      canceladasQuantidade: n(0, "Venda"),
      canceladasTotal: m(0, "Venda.total"),
      descontoTotal: m(0, "Venda.payload.discountTotal"),
      descontoCoberturaQuantidade: n(0, "Venda.payload.discountTotal"),
      formasPagamento: Object.freeze([]),
      formaPagamentoDisponibilidade: "real" as const,
      naoIdentificadoQuantidade: n(0, "Venda"),
      naoIdentificadoValor: m(0, "Venda"),
      divergenciaPagamentoQuantidade: n(0, "Venda"),
      reconciliacaoPagamento: null,
    }),
    devolucoes: Object.freeze({ quantidade: n(1, "DevolucaoVenda"), total: m(100, "DevolucaoVenda.valorTotal") }),
    financeiro: Object.freeze({
      entradasRealizadas: m(800, "MovimentacaoFinanceira"),
      saidasRealizadas: m(50, "MovimentacaoFinanceira"),
      estornos: m(0, "MovimentacaoFinanceira"),
      transferencias: m(0, "MovimentacaoFinanceira"),
      transferenciasQuantidade: n(0, "MovimentacaoFinanceira"),
      naoClassificados: m(0, "MovimentacaoFinanceira"),
      naoClassificadosQuantidade: n(0, "MovimentacaoFinanceira"),
      titulosReceberAberto: m(0, "ContaReceberTitulo"),
      titulosReceberQuantidade: n(0, "ContaReceberTitulo"),
      titulosPagarAberto: m(0, "ContaPagarTitulo"),
      titulosPagarQuantidade: n(0, "ContaPagarTitulo"),
    }),
    caixa: Object.freeze({
      sessoes: n(2, "SessaoCaixa"),
      sessoesAbertas: n(0, "SessaoCaixa"),
      sangriasTotal: m(0, "CaixaOperacao"),
      sangriasQuantidade: n(0, "CaixaOperacao"),
      suprimentosTotal: m(0, "CaixaOperacao"),
      suprimentosQuantidade: n(0, "CaixaOperacao"),
      diferencas: m(0, "SessaoCaixa"),
    }),
    alertas: Object.freeze([]),
    fiscal: m(0, "NotaFiscal (CONTADOR_FISCAL_READER)"),
  })
}
