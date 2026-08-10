/**
 * Material A1 efêmero para mTLS (GOAL-016D-C foundation 003).
 *
 * Resolve PFX e senha exclusivamente server-side, a partir das referências opacas já
 * persistidas. O material nunca é aceito de request, nunca é escrito em arquivo/banco e não
 * possui representação JSON. O Buffer é zerado no descarte (best-effort); strings JavaScript
 * não são zeráveis, portanto a referência da senha é removida e fica a cargo do GC.
 */
import "server-only"

import type { EnvLike } from "@/lib/fiscal/vault/env-vault"
import { resolveFiscalSecretProvider } from "@/lib/fiscal/vault/provider-resolver"
import { zeroBuffer } from "@/lib/fiscal/vault/pkcs12-loader"

export type A1MtlsMaterialErrorCode =
  | "referencias_invalidas"
  | "secret_provider_indisponivel"
  | "pfx_indisponivel"
  | "senha_indisponivel"
  | "falha_ao_resolver_material"
  | "material_descartado"

/** Erro sanitizado: nunca inclui PFX, senha, PEM, private key ou valores de env. */
export class A1MtlsMaterialError extends Error {
  readonly code: A1MtlsMaterialErrorCode

  constructor(code: A1MtlsMaterialErrorCode, message: string) {
    super(message)
    this.name = "A1MtlsMaterialError"
    this.code = code
  }
}

export type A1MtlsSecretRefs = {
  readonly storeId: string
  readonly blobRef: string
  readonly senhaRef: string
}

export type A1MtlsTlsOptions = {
  readonly pfx: Buffer
  readonly passphrase: string
}

/**
 * Cápsula não serializável. O consumidor só enxerga os valores dentro do callback síncrono
 * usado para construir o SecureContext; depois disso deve chamar `dispose`.
 */
export interface A1MtlsMaterial {
  /** O callback não pode devolver o material; serve somente para consumo síncrono pelo TLS. */
  withTlsOptions(consumer: (options: A1MtlsTlsOptions) => void): void
  dispose(): void
}

class EphemeralA1MtlsMaterial implements A1MtlsMaterial {
  #pfx: Buffer | null
  #passphrase: string | null

  constructor(pfx: Buffer, passphrase: string) {
    this.#pfx = pfx
    this.#passphrase = passphrase
  }

  withTlsOptions(consumer: (options: A1MtlsTlsOptions) => void): void {
    if (!this.#pfx || this.#passphrase === null) {
      throw new A1MtlsMaterialError("material_descartado", "Material A1 já foi descartado.")
    }
    consumer({ pfx: this.#pfx, passphrase: this.#passphrase })
  }

  dispose(): void {
    zeroBuffer(this.#pfx)
    this.#pfx = null
    this.#passphrase = null
  }
}

export type LoadA1MtlsMaterialParams = A1MtlsSecretRefs & {
  /** Somente para testes determinísticos; produção usa `process.env` server-side. */
  env?: EnvLike
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Resolve o A1 diretamente do provider configurado. Lê primeiro o PFX e depois a senha;
 * qualquer falha posterior zera o Buffer já obtido antes de devolver erro sanitizado.
 */
export async function loadA1MtlsMaterial(
  params: LoadA1MtlsMaterialParams,
): Promise<A1MtlsMaterial> {
  const storeId = text(params.storeId)
  const blobRef = text(params.blobRef)
  const senhaRef = text(params.senhaRef)
  if (!storeId || !blobRef || !senhaRef) {
    throw new A1MtlsMaterialError(
      "referencias_invalidas",
      "Loja e referências opacas do certificado A1 são obrigatórias.",
    )
  }

  const resolution = resolveFiscalSecretProvider(params.env ?? (process.env as EnvLike))
  if (!resolution.availability.disponivel || !resolution.vault) {
    throw new A1MtlsMaterialError(
      "secret_provider_indisponivel",
      "Secret provider fiscal indisponível para leitura do certificado A1.",
    )
  }

  let pfx: Buffer | null = null
  try {
    pfx = await resolution.vault.getCertificadoPfx(storeId, blobRef)
    if (!pfx || pfx.length === 0) {
      throw new A1MtlsMaterialError("pfx_indisponivel", "PFX do certificado A1 indisponível.")
    }

    const passphrase = await resolution.vault.getCertificadoSenha(storeId, senhaRef)
    if (passphrase === null || passphrase === "") {
      throw new A1MtlsMaterialError("senha_indisponivel", "Senha do certificado A1 indisponível.")
    }

    const material = new EphemeralA1MtlsMaterial(pfx, passphrase)
    pfx = null // ownership transferido para a cápsula
    return material
  } catch (error) {
    zeroBuffer(pfx)
    if (error instanceof A1MtlsMaterialError) throw error
    throw new A1MtlsMaterialError(
      "falha_ao_resolver_material",
      "Não foi possível resolver o material A1 de forma segura.",
    )
  }
}
