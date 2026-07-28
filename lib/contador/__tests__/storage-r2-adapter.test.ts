/**
 * GOAL CONTADOR-HUB-STORAGE-R2-ADAPTER-012C.
 *
 * Testes focados do adapter Cloudflare R2 (`storage-r2.ts`). O S3Client e o
 * `getSignedUrl` são MOCKED via `vi.mock` — nada toca rede, nada instancia client
 * real, nada pede credenciais. Os mocks interceptam os comandos S3 para afirmar
 * que o adapter:
 *   - passa `storageRef` VERBATIM ao Key (path traversal é defendido no service);
 *   - capar TTL nos tetos do contrato (upload 120s, download 300s);
 *   - converte erros externos em `StorageError` (mensagem segura, sem secret/URL);
 *   - download gera Content-Disposition attachment (nunca inline);
 *   - bucket privado — `verificarBucket` não inventa `publico=true`.
 *
 * Os testes que cobrem isolamento entre lojas, path traversal, MIME/tamanho
 * inválidos e hash divergente vivem em `documentos-service.test.ts` e
 * `fechamento-service.test.ts` (provider-agnostic, fakes in-memory). Opacote v1/v2
 * com snapshot.json é coberto em `fechamento-snapshot.test.ts` e
 * `fechamento-closure-012a.test.ts`. Aqui fica apenas o que é específico do R2.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

/* ───────────────────────── mocks S3 / presigner / config ───────────────────────── */

const mocks = vi.hoisted(() => {
  return {
    send: vi.fn(),
    getSignedUrl: vi.fn(),
  }
})

vi.mock("@aws-sdk/client-s3", () => ({
  // `new S3Client(config)` deve instanciar; arrow não pode ser `new`'d, por isso
  // função regular que retorna o objeto com `send` espiado.
  S3Client: vi.fn().mockImplementation(function () {
    return { send: mocks.send } as unknown
  }),
  PutObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { name: "PutObjectCommand", input } as unknown
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { name: "GetObjectCommand", input } as unknown
  }),
  HeadObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { name: "HeadObjectCommand", input } as unknown
  }),
  HeadBucketCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { name: "HeadBucketCommand", input } as unknown
  }),
  DeleteObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { name: "DeleteObjectCommand", input } as unknown
  }),
}))

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mocks.getSignedUrl,
}))

vi.mock("../documentos/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../documentos/config")>()
  return {
    ...actual,
    lerStorageR2Config: vi.fn(() => ({
      accountId: "acc-test",
      accessKeyId: "AKIA-X",
      secretAccessKey: "shh-X",
      bucket: "bucket-test",
      signedUrlTtlSeconds: null as number | null,
      endpoint: "https://acc-test.r2.cloudflarestorage.com",
    })),
  }
})

import { storageR2 } from "@/lib/contador/documentos/storage-r2"
import { StorageError } from "@/lib/contador/documentos/storage-types"
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"

/* ───────────────────────── helpers ───────────────────────── */

function lastCommand(): { name: string; input: unknown } {
  const call = mocks.send.mock.calls.at(-1)
  expect(call, "send deve ter sido chamado").toBeDefined()
  return call![0] as { name: string; input: unknown }
}

function notFoundError(): unknown {
  const err = Object.assign(new Error("Not Found"), { name: "NotFound" })
  Object.assign(err, { $metadata: { httpStatusCode: 404 } })
  return err
}

beforeEach(() => {
  mocks.send.mockReset()
  mocks.getSignedUrl.mockReset()
})

/* ───────────────────────── verificarBucket ───────────────────────── */

describe("storage-r2 · verificarBucket", () => {
  it("devolve { existe:true, publico:null } quando HeadBucket resolve", async () => {
    mocks.send.mockResolvedValueOnce({})
    const out = await storageR2.verificarBucket()
    expect(out).toEqual({ existe: true, publico: null })
    expect(lastCommand().name).toBe("HeadBucketCommand")
    expect((lastCommand().input as { Bucket: string }).Bucket).toBe("bucket-test")
  })

  it("devolve { existe:false, publico:null } quando bucket não existe (NotFound/404)", async () => {
    mocks.send.mockRejectedValueOnce(notFoundError())
    expect(await storageR2.verificarBucket()).toEqual({ existe: false, publico: null })
  })

  it("StorageError em falha externa genérica (sem expor detalhe)", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Network down"))
    await expect(storageR2.verificarBucket()).rejects.toBeInstanceOf(StorageError)
  })
})

/* ───────────────────────── criarUploadAssinado (signed PUT) ───────────────────────── */

describe("storage-r2 · criarUploadAssinado (signed PUT para o navegador)", () => {
  it("devolve signedUrl com token vazio (compat contrato) e TTL dentro do teto upload", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/put-url")
    const out = await storageR2.criarUploadAssinado("contador/loja-1/2026-07/doc-x/FATURA.pdf")
    expect(out.signedUrl).toBe("https://r2-fake/put-url")
    expect(out.token).toBe("")
    expect(out.storageRef).toBe("contador/loja-1/2026-07/doc-x/FATURA.pdf")
    expect(out.expiresInSec).toBeLessThanOrEqual(120)
    expect(out.expiresInSec).toBeGreaterThanOrEqual(1)
  })

  it("passa storageRef VERBATIM ao Key do PutObjectCommand (sem normalizar/reescrita)", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/put")
    await storageR2.criarUploadAssinado("contador/loja-1/2026-07/doc-x/FATURA.pdf")
    expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1)
    const [client, cmd] = mocks.getSignedUrl.mock.calls[0] as [unknown, { name: string; input: { Bucket: string; Key: string } }]
    expect((cmd as { name: string }).name).toBe("PutObjectCommand")
    const input = (cmd as { input: { Bucket: string; Key: string } }).input
    expect(input.Bucket).toBe("bucket-test")
    expect(input.Key).toBe("contador/loja-1/2026-07/doc-x/FATURA.pdf")
  })

  /* ── criação exclusiva: o 2º PUT no mesmo path não pode passar (GOAL 012E · P2) ── */

  it("assina o PUT com If-None-Match:* — escrita condicional, não upsert", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/put")
    const out = await storageR2.criarUploadAssinado("contador/loja-1/2026-07/doc-x/a.pdf")
    const [, cmd, opts] = mocks.getSignedUrl.mock.calls[0] as [
      unknown,
      { input: { IfNoneMatch?: string } },
      { signableHeaders?: Set<string> },
    ]
    // É o R2 que recusa o segundo PUT (412 PreconditionFailed): o objeto só é
    // gravado se ainda não existir. Sem este header a URL seria upsert.
    expect(cmd.input.IfNoneMatch).toBe("*")
    // E o header precisa estar ASSINADO, senão o navegador poderia simplesmente
    // não enviá-lo e recuperar o upsert.
    expect(opts.signableHeaders).toBeInstanceOf(Set)
    expect([...(opts.signableHeaders as Set<string>)]).toContain("if-none-match")
    // O contrato devolve o header ao chamador: é obrigação do cliente reenviá-lo.
    expect(out.headersObrigatorios).toEqual({ "If-None-Match": "*" })
  })

  it("headersObrigatorios é a prova do contrato — sem ele o PUT não fecha assinatura", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/put")
    const out = await storageR2.criarUploadAssinado("a/b.pdf")
    // Um cliente que ignore `headersObrigatorios` envia um PUT sem `If-None-Match`;
    // o conjunto de SignedHeaders da URL não bate e o storage devolve 403. Ou seja:
    // não existe caminho em que a URL ainda válida sobrescreva bytes já gravados —
    // nem após o `complete`, porque o objeto passa a existir.
    expect(Object.keys(out.headersObrigatorios)).toEqual(["If-None-Match"])
  })

  it("capa TTL em 120s mesmo que caller peça maior (assinatura nunca ultrapassa teto)", async () => {
    mocks.getSignedUrl.mockResolvedValue("https://r2-fake/put")
    await storageR2.criarUploadAssinado("a/b.pdf", 9999)
    const [_c, cmd, opts] = mocks.getSignedUrl.mock.calls[0] as [unknown, unknown, { expiresIn: number }]
    expect(opts.expiresIn).toBeLessThanOrEqual(120)
  })

  it("aceita TTL custom menor que o teto (curto = expira mais rápido)", async () => {
    mocks.getSignedUrl.mockResolvedValue("https://r2-fake/put")
    const out = await storageR2.criarUploadAssinado("a/b.pdf", 30)
    expect(out.expiresInSec).toBe(30)
  })

  it("StorageError em falha do getSignedUrl (sem expor URL/secret)", async () => {
    mocks.getSignedUrl.mockRejectedValueOnce(new Error("credenciais inválidas"))
    await expect(storageR2.criarUploadAssinado("a/b.pdf")).rejects.toBeInstanceOf(StorageError)
  })
})

/* ───────────────────────── enviarConteudoPrivado (upload server-side do ZIP) ───────────────────────── */

describe("storage-r2 · enviarConteudoPrivado (PUT server-side PutObject)", () => {
  it("PutObject com ContentType do MIME declarado e Key verbatim", async () => {
    mocks.send.mockResolvedValueOnce({})
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x05, 0x06])
    await storageR2.enviarConteudoPrivado(
      "contador/loja-1/2026-07/pacotes/v1/abc.zip",
      bytes,
      "application/zip",
    )
    const cmd = lastCommand()
    expect(cmd.name).toBe("PutObjectCommand")
    const input = cmd.input as { Bucket: string; Key: string; ContentType: string; Body: Buffer }
    expect(input.Bucket).toBe("bucket-test")
    expect(input.Key).toBe("contador/loja-1/2026-07/pacotes/v1/abc.zip")
    expect(input.ContentType).toBe("application/zip")
    expect(input.Body).toBeInstanceOf(Buffer)
  })

  it("StorageError quando PutObject falha (sem expor detalhe do erro R2)", async () => {
    mocks.send.mockRejectedValueOnce(new Error("inner S3 boom"))
    await expect(
      storageR2.enviarConteudoPrivado("a/b.zip", new Uint8Array([1, 2]), "application/zip"),
    ).rejects.toBeInstanceOf(StorageError)
  })
})

/* ───────────────────────── obterMetadata / verificarExistencia ───────────────────────── */

describe("storage-r2 · obterMetadata e verificarExistencia", () => {
  it("HeadObject devolve bytes + mime quando existe", async () => {
    mocks.send.mockResolvedValueOnce({ ContentLength: 12345, ContentType: "application/pdf" })
    const out = await storageR2.obterMetadata("contador/loja-1/2026-07/doc-x/FATURA.pdf")
    expect(out).toEqual({ bytes: 12345, mime: "application/pdf" })
    expect(lastCommand().name).toBe("HeadObjectCommand")
  })

  it("HeadObject devolve null quando NotFound (404)", async () => {
    mocks.send.mockRejectedValueOnce(notFoundError())
    expect(await storageR2.obterMetadata("a/b.pdf")).toBeNull()
  })

  it("/StorageError quando HeadObject falha por outro motivo", async () => {
    mocks.send.mockRejectedValueOnce(new Error("boom"))
    await expect(storageR2.obterMetadata("a/b.pdf")).rejects.toBeInstanceOf(StorageError)
  })

  it("verificarExistencia = true quando metadata existe", async () => {
    mocks.send.mockResolvedValueOnce({ ContentLength: 1, ContentType: "application/pdf" })
    expect(await storageR2.verificarExistencia("a/b.pdf")).toBe(true)
  })

  it("verificarExistencia = false quando metadata não existe", async () => {
    mocks.send.mockRejectedValueOnce(notFoundError())
    expect(await storageR2.verificarExistencia("a/b.pdf")).toBe(false)
  })
})

/* ───────────────────────── abrirConteudoPrivado ───────────────────────── */

describe("storage-r2 · abrirConteudoPrivado (GET server-side)", () => {
  it("devolve Buffer do binário preservado", async () => {
    const body = { transformToByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])) }
    mocks.send.mockResolvedValueOnce({ Body: body })
    const out = await storageR2.abrirConteudoPrivado("a/b.pdf")
    expect(out).toBeInstanceOf(Buffer)
    expect(out.length).toBe(4)
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
    expect(lastCommand().name).toBe("GetObjectCommand")
  })

  it("StorageError quando Body ausente", async () => {
    mocks.send.mockResolvedValueOnce({})
    await expect(storageR2.abrirConteudoPrivado("a/b.pdf")).rejects.toBeInstanceOf(StorageError)
  })

  it("StorageError quando send falha (sem expor detalhe)", async () => {
    mocks.send.mockRejectedValueOnce(new Error("network"))
    await expect(storageR2.abrirConteudoPrivado("a/b.pdf")).rejects.toBeInstanceOf(StorageError)
  })
})

/* ───────────────────────── criarDownloadAssinado (signed GET) ───────────────────────── */

describe("storage-r2 · criarDownloadAssinado (signed GET attachment)", () => {
  it("devolve signedUrl e TTL dentro do teto download (300s)", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/get")
    const out = await storageR2.criarDownloadAssinado("a/b.pdf", "FATURA.pdf")
    expect(out.signedUrl).toBe("https://r2-fake/get")
    expect(out.expiresInSec).toBeLessThanOrEqual(300)
    expect(out.expiresInSec).toBeGreaterThanOrEqual(1)
  })

  it("comanda GetObjectCommand com ResponseContentDisposition attachment (nunca inline)", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/get")
    await storageR2.criarDownloadAssinado("a/b.pdf", "FATURA.pdf")
    const [_c, cmd] = mocks.getSignedUrl.mock.calls[0] as [unknown, { name: string; input: { ResponseContentDisposition: string } }]
    expect((cmd as { name: string }).name).toBe("GetObjectCommand")
    expect((cmd as { input: { ResponseContentDisposition: string } }).input.ResponseContentDisposition).toMatch(/^attachment;\s*filename=/)
  })

  it("passa storageRef verbatim ao Key (sem reescrita que mascararia traversal)", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/get")
    await storageR2.criarDownloadAssinado("contador/loja-2/2026-08/pacotes/v2/deadbeef.zip", "pacote.zip")
    const cmd = mocks.getSignedUrl.mock.calls[0]![1] as { input: { Key: string } }
    expect(cmd.input.Key).toBe("contador/loja-2/2026-08/pacotes/v2/deadbeef.zip")
  })

  it("capa TTL em 300s mesmo que caller peça maior", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/get")
    const out = await storageR2.criarDownloadAssinado("a/b.pdf", "FATURA.pdf", 99999)
    expect(out.expiresInSec).toBeLessThanOrEqual(300)
  })

  it("sanitiza nome do arquivo no Content-Disposition (defesa em profundidade contra header injection)", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://r2-fake/get")
    await storageR2.criarDownloadAssinado("a/b.pdf", "FATURA\";\r\nX-Evil:1.pdf")
    const cmd = mocks.getSignedUrl.mock.calls[0]![1] as { input: { ResponseContentDisposition: string } }
    const disp = cmd.input.ResponseContentDisposition
    expect(disp).not.toContain("\r")
    expect(disp).not.toContain("\n")
    expect(disp).not.toContain("\";")
  })

  it("StorageError em falha do getSignedUrl (sem expor URL/secret)", async () => {
    mocks.getSignedUrl.mockRejectedValueOnce(new Error("inner boom"))
    await expect(
      storageR2.criarDownloadAssinado("a/b.pdf", "FATURA.pdf"),
    ).rejects.toBeInstanceOf(StorageError)
  })
})

/* ───────────────────────── removerObjeto ───────────────────────── */

describe("storage-r2 · removerObjeto (DeleteObject)", () => {
  it("comanda DeleteObject com Key verbatim", async () => {
    mocks.send.mockResolvedValueOnce({})
    await storageR2.removerObjeto("a/b.pdf")
    const cmd = lastCommand()
    expect(cmd.name).toBe("DeleteObjectCommand")
    expect((cmd.input as { Key: string }).Key).toBe("a/b.pdf")
    expect((cmd.input as { Bucket: string }).Bucket).toBe("bucket-test")
  })

  it("StorageError em falha (sem expor detalhe)", async () => {
    mocks.send.mockRejectedValueOnce(new Error("delete failed"))
    await expect(storageR2.removerObjeto("a/b.pdf")).rejects.toBeInstanceOf(StorageError)
  })
})

/* ────────────── nenhum StorageError expõe token/URL/secret ────────────── */

describe("storage-r2 · StorageError nunca expõe URL/token/secret", () => {
  it("mensagem de falha é genérica (sem URL, token, access key)", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Forbidden! AKIA-X encountered at https://acc-test.r2.cloudflarestorage.com/bucket-test/a/b.pdf?X-Amz-Signature=deadbeef"))
    try {
      await storageR2.abrirConteudoPrivado("a/b.pdf")
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError)
      const msg = String((e as Error).message)
      expect(msg).not.toContain("AKIA")
      expect(msg).not.toContain("deadbeef")
      expect(msg).not.toContain("X-Amz-Signature")
      expect(msg).not.toContain("cloudflarestorage.com")
    }
  })
})