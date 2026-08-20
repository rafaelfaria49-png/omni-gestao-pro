/**
 * Contador HUB · Portal externo — contrato HTTP de storage indisponível.
 *
 * GOAL CONTADOR-POST-019-STORAGE-ROLLOUT-REMEDIATION · gap 1.
 *
 * Antes deste corretivo, `StorageProviderError` (provider não declarado/indevido) e
 * `StorageConfigError` (config R2 incompleta) caíam no `return` genérico e o portal
 * respondia **500** — ou seja, uma pendência de configuração externa se apresentava
 * como falha interna. Agora as três causas de storage indisponível compartilham o
 * MESMO contrato operacional: 503 com corpo fixo.
 *
 * PURO: sem rede, sem SDK, sem `process.env` real. Os erros são produzidos pelos
 * leitores REAIS (`lerStorageProvider` / `lerStorageR2Config`) com env injetado —
 * o teste cobre o caminho de produção, não uma instância fabricada à mão.
 */
import { describe, expect, it } from "vitest"
import {
  ENV_KEYS_R2,
  ENV_KEY_PROVIDER,
  StorageConfigError,
  StorageProviderError,
  lerStorageProvider,
  lerStorageR2Config,
} from "@/lib/contador/documentos/config"
import { StorageError } from "@/lib/contador/documentos/storage-types"
import { DocumentoNaoEncontradoError } from "@/lib/contador/documentos/service"
import { PortalPapelInsuficienteError, respostaErroPortal } from "../erros"

const MENSAGEM_STORAGE = "Storage indisponível no momento. Tente novamente em instantes."

const ENV_R2_COMPLETO = {
  [ENV_KEY_PROVIDER]: "r2",
  [ENV_KEYS_R2.accountId]: "acc1234567890abcdef",
  [ENV_KEYS_R2.accessKeyId]: "AKIA-fake-para-teste",
  [ENV_KEYS_R2.secretAccessKey]: "segredo-que-nao-pode-vazar-123",
  [ENV_KEYS_R2.bucket]: "omni-contador-documentos-prod",
} as const

/** Captura o erro lançado por `fn` (falha o teste se não lançar). */
function capturar(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error("deveria ter lançado")
}

describe("respostaErroPortal · storage indisponível vira 503 (nunca 500)", () => {
  it("provider AUSENTE → 503 com o corpo fixo de storage indisponível", () => {
    const erro = capturar(() => lerStorageProvider({}))
    expect(erro).toBeInstanceOf(StorageProviderError)

    const r = respostaErroPortal(erro)
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ ok: false, mensagem: MENSAGEM_STORAGE })
  })

  it("provider INVÁLIDO (supabase descontinuado) → 503, sem ecoar o valor declarado", () => {
    const erro = capturar(() => lerStorageProvider({ [ENV_KEY_PROVIDER]: "supabase" }))
    expect(erro).toBeInstanceOf(StorageProviderError)

    const r = respostaErroPortal(erro)
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ ok: false, mensagem: MENSAGEM_STORAGE })
    expect(JSON.stringify(r.body)).not.toContain("supabase")
  })

  it("config R2 INCOMPLETA → 503, sem listar os nomes das variáveis faltantes", () => {
    const { [ENV_KEYS_R2.secretAccessKey]: _omitida, ...incompleto } = ENV_R2_COMPLETO
    const erro = capturar(() => lerStorageR2Config(incompleto))
    expect(erro).toBeInstanceOf(StorageConfigError)

    const r = respostaErroPortal(erro)
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ ok: false, mensagem: MENSAGEM_STORAGE })
    // O `message` do domínio nomeia a var faltante — útil no log, proibido na resposta.
    expect(JSON.stringify(r.body)).not.toContain(ENV_KEYS_R2.secretAccessKey)
  })

  it("erro desconhecido continua 500 genérico (o corretivo não alarga o 503)", () => {
    const r = respostaErroPortal(new Error("boom interno inesperado"))
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toContain("boom interno inesperado")
  })

  it("StorageError (falha externa) segue 503 com o MESMO corpo — as 3 causas são indistinguíveis", () => {
    const externo = respostaErroPortal(new StorageError("download", "falha do provider"))
    const semProvider = respostaErroPortal(capturar(() => lerStorageProvider({})))
    const semConfig = respostaErroPortal(capturar(() => lerStorageR2Config({})))

    expect(externo).toEqual(semProvider)
    expect(externo).toEqual(semConfig)
    expect(externo.status).toBe(503)
  })
})

describe("respostaErroPortal · o corpo 503 não vaza segredo nem detalhe de infra", () => {
  const proibidos = [
    ENV_KEY_PROVIDER,
    "r2",
    ENV_R2_COMPLETO[ENV_KEYS_R2.accountId],
    ENV_R2_COMPLETO[ENV_KEYS_R2.accessKeyId],
    ENV_R2_COMPLETO[ENV_KEYS_R2.secretAccessKey],
    ENV_R2_COMPLETO[ENV_KEYS_R2.bucket],
    "cloudflarestorage.com",
    "X-Amz-Signature",
    "contador/loja-1/2026-07",
  ]

  it.each([
    ["provider ausente", () => lerStorageProvider({})],
    ["provider inválido", () => lerStorageProvider({ [ENV_KEY_PROVIDER]: "s3" })],
    ["config R2 vazia", () => lerStorageR2Config({})],
    ["config R2 parcial", () => lerStorageR2Config({ [ENV_KEYS_R2.bucket]: "x" })],
  ])("%s → corpo sem provider, account id, access key, secret, bucket, storageRef ou URL assinada", (_n, fn) => {
    const corpo = JSON.stringify(respostaErroPortal(capturar(fn)))
    for (const termo of proibidos) {
      expect(corpo).not.toContain(termo)
    }
  })
})

describe("respostaErroPortal · mapeamentos anteriores preservados", () => {
  it("papel insuficiente segue 403", () => {
    expect(respostaErroPortal(new PortalPapelInsuficienteError()).status).toBe(403)
  })

  it("documento inexistente segue 404", () => {
    expect(respostaErroPortal(new DocumentoNaoEncontradoError()).status).toBe(404)
  })
})
