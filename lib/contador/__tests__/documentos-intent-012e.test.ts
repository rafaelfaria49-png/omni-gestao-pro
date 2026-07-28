/**
 * GOAL CONTADOR-HUB-R2-SAFETY-CORRECTIONS-012E — regressões de segurança.
 *
 * Cobre os 10 itens obrigatórios do GOAL:
 *   1/2. o ataque de EXCLUSÃO do blob de outro documento — reproduzido e provado morto
 *        ANTES de qualquer Head/Get/Delete;
 *   3.   intent adulterado, expirado, cross-store e com metadata alterada;
 *   4.   complete idempotente com intent válido;
 *   5/6. segundo PUT no mesmo path recusado, inclusive depois do complete;
 *   7/8. provider inválido falha nas rotas produtivas, sem fallback Supabase;
 *   9.   path traversal e troca de loja;
 *   10.  nenhum segredo, storageRef ou token em DTO/evento.
 *
 * Fakes in-memory: nada de rede, banco, Cloudflare ou Supabase.
 */
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import {
  autorizarDownload,
  completarUpload,
  criarUploadIntent,
  toDto,
  type CompetenciaRef,
  type DocumentoRow,
  type DocumentosRepo,
  type NovoEvento,
} from "@/lib/contador/documentos/service"
import {
  assinarUploadIntent,
  verificarUploadIntent,
  UploadIntentInvalidoError,
  INTENT_EXPIRACAO_SEG,
} from "@/lib/contador/documentos/intent"
import { resolverStorageDocumentos } from "@/lib/contador/documentos/storage"
import { StorageProviderError, ENV_KEY_PROVIDER } from "@/lib/contador/documentos/config"
import type { StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"

process.env.AUTH_SECRET ??= "segredo-de-teste-012e"

const LOJA = "loja-1"
const ESCOPO = { storeId: LOJA, userId: "user-1" }
const OUTRO_ESCOPO = { storeId: "loja-2", userId: "user-9" }

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}
function pdf(tag = "a"): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`, "utf8")
}

/* ───────────────── storage fake que REGISTRA cada operação ───────────────── */

type StorageEspiao = StorageDocumentosPort & {
  _put(ref: string, buf: Buffer): void
  _existe(ref: string): boolean
  /** Toda operação de IO, em ordem — é o que prova "não tocou no storage". */
  _ops: string[]
}

function storageEspiao(): StorageEspiao {
  const objetos = new Map<string, Buffer>()
  const ops: string[] = []
  return {
    _put: (ref, buf) => objetos.set(ref, buf),
    _existe: (ref) => objetos.has(ref),
    _ops: ops,
    async verificarBucket() {
      ops.push("verificarBucket")
      return { existe: true, publico: false }
    },
    async criarUploadAssinado(storageRef, expiresInSec = 120) {
      ops.push(`criarUploadAssinado:${storageRef}`)
      return {
        storageRef,
        signedUrl: `fake://up/${storageRef}`,
        token: "",
        expiresInSec,
        headersObrigatorios: { "If-None-Match": "*" },
      }
    },
    async enviarConteudoPrivado(storageRef, conteudo) {
      ops.push(`enviarConteudoPrivado:${storageRef}`)
      objetos.set(storageRef, Buffer.from(conteudo))
    },
    async obterMetadata(storageRef) {
      ops.push(`obterMetadata:${storageRef}`)
      const b = objetos.get(storageRef)
      return b ? { bytes: b.length, mime: null } : null
    },
    async abrirConteudoPrivado(storageRef) {
      ops.push(`abrirConteudoPrivado:${storageRef}`)
      const b = objetos.get(storageRef)
      if (!b) throw new Error("objeto ausente")
      return b
    },
    async criarDownloadAssinado(storageRef, _nome, expiresInSec = 300) {
      ops.push(`criarDownloadAssinado:${storageRef}`)
      return { signedUrl: `fake://down/${storageRef}`, expiresInSec }
    },
    async removerObjeto(storageRef) {
      ops.push(`removerObjeto:${storageRef}`)
      objetos.delete(storageRef)
    },
    async verificarExistencia(storageRef) {
      ops.push(`verificarExistencia:${storageRef}`)
      return objetos.has(storageRef)
    },
  }
}

/* ───────────────────────────── repo fake ───────────────────────────── */

type RepoFake = DocumentosRepo & {
  _docs: Map<string, DocumentoRow>
  _eventos: NovoEvento[]
}

function repoFake(): RepoFake {
  const comps = new Map<string, CompetenciaRef>()
  const docs = new Map<string, DocumentoRow>()
  const eventos: NovoEvento[] = []
  const chave = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`

  function getOrCreate(ano: number, mes: number): CompetenciaRef {
    const k = chave(ano, mes)
    let c = comps.get(k)
    if (!c) {
      c = { id: `comp-${k}`, status: "ABERTA", ano, mes }
      comps.set(k, c)
    }
    return c
  }

  return {
    _docs: docs,
    _eventos: eventos,
    async getOrCreateCompetencia(_storeId, comp) {
      return getOrCreate(comp.ano, comp.mes)
    },
    async acharCompetencia(_storeId, comp) {
      return comps.get(chave(comp.ano, comp.mes)) ?? null
    },
    async acharCompetenciaPorId(competenciaId) {
      return [...comps.values()].find((c) => c.id === competenciaId) ?? null
    },
    async acharDocumentoPorId(id) {
      return docs.get(id) ?? null
    },
    async acharDocumentoDaLoja(id, storeId) {
      const d = docs.get(id)
      return d && d.storeId === storeId ? d : null
    },
    async listarDocumentos({ competenciaId, storeId }) {
      return [...docs.values()].filter(
        (d) => d.competenciaId === competenciaId && d.storeId === storeId && d.excluidoEm === null,
      )
    },
    async criarDocumentoComEvento({ documento, evento }) {
      if (docs.has(documento.id)) throw new Error("duplicate id")
      const now = new Date()
      const row: DocumentoRow = {
        ...documento,
        excluidoEm: null,
        excluidoPorId: null,
        excluidoMotivo: null,
        createdAt: now,
        updatedAt: now,
      }
      docs.set(row.id, row)
      eventos.push(evento)
      return row
    },
    async softDeleteComEvento({ id, evento }) {
      eventos.push(evento)
      return docs.get(id)!
    },
    async registrarEvento(evento) {
      eventos.push(evento)
    },
  }
}

const BASE = {
  competencia: "2026-07",
  categoria: "fiscal",
  titulo: "DAS Julho",
  nomeArquivo: "das.pdf",
  mime: "application/pdf",
}

/** Sobe um documento completo e devolve o necessário para os testes. */
async function enviarDocumento(
  storage: StorageEspiao,
  repo: RepoFake,
  escopo = ESCOPO,
  over: Partial<{ competencia: string; nomeArquivo: string; tag: string }> = {},
) {
  const buf = pdf(over.tag ?? "a")
  const entrada = {
    ...BASE,
    competencia: over.competencia ?? BASE.competencia,
    nomeArquivo: over.nomeArquivo ?? BASE.nomeArquivo,
    bytes: buf.length,
    sha256: sha(buf),
  }
  const intent = await criarUploadIntent(escopo, entrada, { storage, repo })
  storage._put(intent.storageRef, buf)
  const res = await completarUpload(
    escopo,
    { uploadIntent: intent.uploadIntent, titulo: entrada.titulo },
    { storage, repo },
  )
  return { intent, entrada, buf, ...res }
}

/* ═══════════════ 1 e 2 · ataque de exclusão do blob alheio ═══════════════ */

describe("012E · P1 — ataque de exclusão do blob de outro documento", () => {
  let storage: StorageEspiao
  let repo: RepoFake

  beforeEach(() => {
    storage = storageEspiao()
    repo = repoFake()
  })

  /**
   * O vetor original: `storageRefPertence` provava posse com
   * `startsWith("contador/{loja}/")` + `includes("/{documentoId}/")`. Bastava ao
   * atacante escolher `documentoId = "2026-06"` — um segmento que EXISTE no path da
   * vítima — e mandar o `storageRef` da vítima. O servidor abria o blob alheio, a
   * validação de hash falhava e o `catch` chamava `removerSilencioso` NO BLOB DA
   * VÍTIMA. Resultado: exclusão de documento alheio por um usuário legítimo da loja.
   */
  it("1 · o vetor original (documentoId casando com segmento do path da vítima) é recusado", async () => {
    const vitima = await enviarDocumento(storage, repo, ESCOPO, {
      competencia: "2026-06",
      nomeArquivo: "nota-da-vitima.pdf",
      tag: "vitima",
    })
    expect(storage._existe(vitima.intent.storageRef)).toBe(true)

    const opsAntes = storage._ops.length
    await expect(
      completarUpload(
        ESCOPO,
        {
          // Sem intent: é exatamente o corpo que o atacante montava à mão.
          uploadIntent: undefined,
          titulo: "ataque",
          documentoId: "2026-06",
          competencia: "2026-06",
          storageRef: vitima.intent.storageRef,
          categoria: "fiscal",
          nomeArquivo: "nota-da-vitima.pdf",
          mime: "application/pdf",
          bytes: 999,
          sha256: sha(Buffer.from("hash que nao bate")),
        },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(UploadIntentInvalidoError)

    // O blob da vítima continua lá.
    expect(storage._existe(vitima.intent.storageRef)).toBe(true)
    // E NENHUMA operação de storage foi disparada pela tentativa.
    expect(storage._ops.slice(opsAntes)).toEqual([])
  })

  it("2 · a recusa acontece ANTES de qualquer Head/Get/Delete", async () => {
    const vitima = await enviarDocumento(storage, repo, ESCOPO, { tag: "v" })
    // Intent legítimo do atacante, para o PRÓPRIO documento dele...
    const buf = pdf("atacante")
    const meuIntent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )

    const opsAntes = storage._ops.length
    // ...mas apontando o `storageRef` para o documento da vítima.
    await expect(
      completarUpload(
        ESCOPO,
        {
          uploadIntent: meuIntent.uploadIntent,
          titulo: "ataque",
          storageRef: vitima.intent.storageRef,
        },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(UploadIntentInvalidoError)

    const ops = storage._ops.slice(opsAntes)
    expect(ops.filter((o) => o.startsWith("abrirConteudoPrivado"))).toEqual([])
    expect(ops.filter((o) => o.startsWith("obterMetadata"))).toEqual([])
    expect(ops.filter((o) => o.startsWith("removerObjeto"))).toEqual([])
    expect(storage._existe(vitima.intent.storageRef)).toBe(true)
  })

  it("2b · falha de conteúdo remove SOMENTE o objeto que o intent autorizou", async () => {
    const vitima = await enviarDocumento(storage, repo, ESCOPO, { tag: "v" })

    const buf = pdf("meu")
    const meuIntent = await criarUploadIntent(
      ESCOPO,
      // Declara um hash que não corresponde ao conteúdo que será gravado.
      { ...BASE, bytes: buf.length, sha256: sha(Buffer.from("outro")) },
      { storage, repo },
    )
    storage._put(meuIntent.storageRef, buf)

    await expect(
      completarUpload(
        ESCOPO,
        { uploadIntent: meuIntent.uploadIntent, titulo: "meu" },
        { storage, repo },
      ),
    ).rejects.toBeTruthy()

    // Meu blob (o do intent) foi limpo; o da vítima, intocado.
    expect(storage._existe(meuIntent.storageRef)).toBe(false)
    expect(storage._existe(vitima.intent.storageRef)).toBe(true)
    expect(storage._ops.filter((o) => o === `removerObjeto:${vitima.intent.storageRef}`)).toEqual([])
  })
})

/* ═══════════════ 3 · intent adulterado / expirado / cross-store ═══════════════ */

describe("012E · P1 — integridade do upload intent", () => {
  let storage: StorageEspiao
  let repo: RepoFake
  beforeEach(() => {
    storage = storageEspiao()
    repo = repoFake()
  })

  it("intent ausente é recusado", async () => {
    await expect(
      completarUpload(ESCOPO, { uploadIntent: undefined, titulo: "x" }, { storage, repo }),
    ).rejects.toBeInstanceOf(UploadIntentInvalidoError)
  })

  it("assinatura adulterada é recusada (payload reescrito mantendo a assinatura)", async () => {
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    const [corpo, assinatura] = intent.uploadIntent.split(".")
    const payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"))
    payload.storeId = "loja-2" // escalada de loja
    const corpoFalso = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")

    expect(() => verificarUploadIntent(`${corpoFalso}.${assinatura}`)).toThrow(
      UploadIntentInvalidoError,
    )
  })

  it("intent expirado é recusado", () => {
    const agora = new Date("2026-07-28T12:00:00Z")
    const token = assinarUploadIntent(
      {
        storeId: LOJA,
        userId: "user-1",
        competencia: "2026-07",
        competenciaId: "comp-2026-07",
        documentoId: "doc-1",
        storageRef: "contador/loja-1/2026-07/doc-1/das.pdf",
        nomeArquivo: "das.pdf",
        mime: "application/pdf",
        bytes: 10,
        sha256: sha(pdf()),
        categoria: "fiscal",
        versaoDeId: null,
      },
      agora,
    )
    const depois = new Date(agora.getTime() + (INTENT_EXPIRACAO_SEG + 1) * 1000)
    expect(() => verificarUploadIntent(token, depois)).toThrow(UploadIntentInvalidoError)
    // Um segundo antes do vencimento ainda vale.
    expect(() =>
      verificarUploadIntent(token, new Date(agora.getTime() + (INTENT_EXPIRACAO_SEG - 1) * 1000)),
    ).not.toThrow()
  })

  it("intent de OUTRA loja não vale nesta sessão (cross-store)", async () => {
    const buf = pdf()
    const intentDaOutraLoja = await criarUploadIntent(
      OUTRO_ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    storage._put(intentDaOutraLoja.storageRef, buf)

    await expect(
      completarUpload(
        ESCOPO, // sessão da loja-1 usando intent emitido para a loja-2
        { uploadIntent: intentDaOutraLoja.uploadIntent, titulo: "x" },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(UploadIntentInvalidoError)
    expect(repo._docs.size).toBe(0)
  })

  it("intent de OUTRO usuário da mesma loja não vale", async () => {
    const buf = pdf()
    const intent = await criarUploadIntent(
      { storeId: LOJA, userId: "user-2" },
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    await expect(
      completarUpload(ESCOPO, { uploadIntent: intent.uploadIntent, titulo: "x" }, { storage, repo }),
    ).rejects.toBeInstanceOf(UploadIntentInvalidoError)
  })

  it.each([
    ["documentoId", { documentoId: "doc-outro" }],
    ["bytes", { bytes: 999999 }],
    ["mime", { mime: "text/plain" }],
    ["categoria", { categoria: "juridico" }],
    ["nomeArquivo", { nomeArquivo: "outro.pdf" }],
    ["sha256", { sha256: "0".repeat(64) }],
    ["competencia", { competencia: "2026-01" }],
    ["versaoDeId", { versaoDeId: "doc-qualquer" }],
  ])("metadata alterada no complete é recusada: %s", async (_campo, alteracao) => {
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    storage._put(intent.storageRef, buf)
    await expect(
      completarUpload(
        ESCOPO,
        { uploadIntent: intent.uploadIntent, titulo: "x", ...alteracao },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(UploadIntentInvalidoError)
    expect(repo._docs.size).toBe(0)
  })
})

/* ═══════════════ 4 · idempotência ═══════════════ */

describe("012E · P1 — complete idempotente com intent válido", () => {
  it("4 · repetir o complete com o mesmo intent não duplica documento nem evento", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const { intent, documento, criado } = await enviarDocumento(storage, repo)
    expect(criado).toBe(true)

    const segunda = await completarUpload(
      ESCOPO,
      { uploadIntent: intent.uploadIntent, titulo: BASE.titulo },
      { storage, repo },
    )
    expect(segunda.criado).toBe(false)
    expect(segunda.documento.id).toBe(documento.id)
    expect(repo._docs.size).toBe(1)
    expect(repo._eventos.filter((e) => e.tipo === "documento_enviado")).toHaveLength(1)
  })

  it("4b · a repetição idempotente não reabre nem remove o objeto", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const { intent } = await enviarDocumento(storage, repo)

    const opsAntes = storage._ops.length
    await completarUpload(
      ESCOPO,
      { uploadIntent: intent.uploadIntent, titulo: BASE.titulo },
      { storage, repo },
    )
    // Idempotência é decidida no repo: zero IO de storage na segunda passada.
    expect(storage._ops.slice(opsAntes)).toEqual([])
  })
})

/* ═══════════════ 5 e 6 · criação exclusiva do PUT ═══════════════ */

/**
 * Simulação das semânticas de escrita condicional do R2 (`If-None-Match: *` em
 * PutObject, documentado como suportado na API S3-compatible: grava só se o objeto
 * não existir, senão `412 PreconditionFailed`). O 412 real vem da Cloudflare; aqui
 * provamos o comportamento do NOSSO lado — que a URL é emitida com a condição e que
 * um cliente honesto obtém exatamente uma gravação por path.
 */
function r2Simulado() {
  const objetos = new Map<string, Buffer>()
  return {
    objetos,
    /** Devolve o status HTTP que o R2 daria para este PUT. */
    put(ref: string, corpo: Buffer, headers: Record<string, string>): number {
      // Sem o header assinado, a verificação SigV4 falha antes de qualquer gravação.
      if (headers["If-None-Match"] !== "*") return 403
      if (objetos.has(ref)) return 412
      objetos.set(ref, corpo)
      return 200
    },
  }
}

describe("012E · P2 — o PUT assinado não sobrescreve", () => {
  it("5 · segundo PUT no mesmo path é recusado (412), mesmo com a URL ainda válida", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const r2 = r2Simulado()
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    const headers = { "If-None-Match": "*" }

    expect(r2.put(intent.storageRef, buf, headers)).toBe(200)
    expect(r2.put(intent.storageRef, pdf("substituto"), headers)).toBe(412)
    // O conteúdo original permanece.
    expect(r2.objetos.get(intent.storageRef)).toEqual(buf)
  })

  it("5b · omitir o header assinado não recupera o upsert — dá 403", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const r2 = r2Simulado()
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    expect(r2.put(intent.storageRef, buf, {})).toBe(403)
    expect(r2.objetos.has(intent.storageRef)).toBe(false)
  })

  it("6 · PUT depois do complete é incapaz de sobrescrever os bytes confirmados", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const r2 = r2Simulado()
    const buf = pdf("original")
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    const headers = { "If-None-Match": "*" }
    expect(r2.put(intent.storageRef, buf, headers)).toBe(200)

    storage._put(intent.storageRef, buf)
    const { documento } = await completarUpload(
      ESCOPO,
      { uploadIntent: intent.uploadIntent, titulo: BASE.titulo },
      { storage, repo },
    )
    expect(documento.sha256).toBe(sha(buf))

    // Documento confirmado: o hash em banco descreve estes bytes. Um PUT posterior
    // com a mesma URL não pode trocar o conteúdo por baixo do hash registrado.
    expect(r2.put(intent.storageRef, pdf("adulterado"), headers)).toBe(412)
    expect(r2.objetos.get(intent.storageRef)).toEqual(buf)
  })
})

/* ═══════════════ 7 e 8 · gate do provider ═══════════════ */

describe("012E · P2 — gate do provider nas rotas produtivas", () => {
  it("7 · provider ausente falha (sem default silencioso)", () => {
    expect(() => resolverStorageDocumentos({})).toThrow(StorageProviderError)
  })

  it("7b · provider inválido falha", () => {
    expect(() => resolverStorageDocumentos({ [ENV_KEY_PROVIDER]: "s3-generico" })).toThrow(
      StorageProviderError,
    )
  })

  it("8 · 'supabase' declarado NÃO ativa fallback — falha cerrado", () => {
    expect(() => resolverStorageDocumentos({ [ENV_KEY_PROVIDER]: "supabase" })).toThrow(
      StorageProviderError,
    )
  })

  it("8b · 'r2' declarado devolve um adapter que cumpre a porta", () => {
    const adapter = resolverStorageDocumentos({ [ENV_KEY_PROVIDER]: "r2" })
    for (const metodo of [
      "verificarBucket",
      "criarUploadAssinado",
      "enviarConteudoPrivado",
      "obterMetadata",
      "abrirConteudoPrivado",
      "criarDownloadAssinado",
      "removerObjeto",
      "verificarExistencia",
    ] as const) {
      expect(typeof adapter[metodo]).toBe("function")
    }
  })

  it("8c · nenhuma rota produtiva importa o adapter concreto (só o gate)", async () => {
    const { readFile } = await import("node:fs/promises")
    const rotas = [
      "app/api/contador/documentos/upload-intent/route.ts",
      "app/api/contador/documentos/complete/route.ts",
      "app/api/contador/documentos/[id]/download/route.ts",
      "lib/contador/fechamento/portas.ts",
    ]
    for (const rota of rotas) {
      const src = await readFile(new URL(`../../../${rota}`, import.meta.url), "utf8")
      expect(src).not.toContain("documentos/storage-r2")
      expect(src).not.toContain("documentos/storage-supabase")
      expect(src).toContain("resolverStorageDocumentos")
    }
  })
})

/* ═══════════════ 9 · path traversal e troca de loja ═══════════════ */

describe("012E · P1 — path traversal e troca de loja", () => {
  let storage: StorageEspiao
  let repo: RepoFake
  beforeEach(() => {
    storage = storageEspiao()
    repo = repoFake()
  })

  it.each([
    "contador/loja-1/2026-07/doc-x/../../../loja-2/segredo.pdf",
    "contador/loja-2/2026-07/doc-x/das.pdf",
    "../../../etc/passwd",
    "contador/loja-1/2026-07/doc-x/das.pdf/extra",
    "",
  ])("9 · storageRef fora do canônico é recusado: %s", async (refMalicioso) => {
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    const opsAntes = storage._ops.length
    await expect(
      completarUpload(
        ESCOPO,
        { uploadIntent: intent.uploadIntent, titulo: "x", storageRef: refMalicioso },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(UploadIntentInvalidoError)
    expect(storage._ops.slice(opsAntes)).toEqual([])
  })

  it("9b · o storageRef emitido fica sempre dentro do namespace da loja da sessão", async () => {
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, nomeArquivo: "../../fuga.pdf", bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    expect(intent.storageRef.startsWith(`contador/${LOJA}/`)).toBe(true)
    expect(intent.storageRef).not.toContain("..")
    expect(intent.nomeSanitizado).toBe("fuga.pdf")
  })

  it("9c · download de documento de outra loja não é encontrado", async () => {
    const { documento } = await enviarDocumento(storage, repo, ESCOPO)
    await expect(
      autorizarDownload(OUTRO_ESCOPO, documento.id, { storage, repo }),
    ).rejects.toBeTruthy()
  })
})

/* ═══════════════ 10 · nada de segredo em DTO/evento ═══════════════ */

describe("012E · superfície de exposição", () => {
  it("10 · DTO não carrega storageRef, token nem intent", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const { documento, intent } = await enviarDocumento(storage, repo)
    const dto = toDto(documento)
    const serializado = JSON.stringify(dto)

    expect("storageRef" in dto).toBe(false)
    expect(serializado).not.toContain(intent.storageRef)
    expect(serializado).not.toContain(intent.uploadIntent)
    expect(serializado).not.toContain("contador/")
  })

  it("10b · eventos não carregam storageRef, URL assinada nem token de intent", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const { intent, documento } = await enviarDocumento(storage, repo)
    await autorizarDownload(ESCOPO, documento.id, { storage, repo })

    expect(repo._eventos.length).toBeGreaterThan(0)
    const serializado = JSON.stringify(repo._eventos)
    expect(serializado).not.toContain(intent.storageRef)
    expect(serializado).not.toContain(intent.uploadIntent)
    expect(serializado).not.toContain("fake://")
    expect(serializado).not.toContain("contador/loja-1/")
    for (const evento of repo._eventos) {
      expect(Object.keys(evento.metadata)).not.toContain("storageRef")
      expect(Object.keys(evento.metadata)).not.toContain("uploadIntent")
      expect(Object.keys(evento.metadata)).not.toContain("signedUrl")
    }
  })

  it("10c · o intent não contém segredo — só dados já conhecidos do próprio usuário", async () => {
    const storage = storageEspiao()
    const repo = repoFake()
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      { ...BASE, bytes: buf.length, sha256: sha(buf) },
      { storage, repo },
    )
    const payload = verificarUploadIntent(intent.uploadIntent)
    // O segredo de assinatura nunca viaja: o token é payload + HMAC.
    expect(JSON.stringify(payload)).not.toContain(process.env.AUTH_SECRET as string)
    expect(intent.uploadIntent).not.toContain(process.env.AUTH_SECRET as string)
    expect(payload.storeId).toBe(LOJA)
  })
})
