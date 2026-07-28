/**
 * GOAL CONTADOR-HUB-STORAGE-R2-ADAPTER-012C.
 *
 * Testes da configuração R2 do Contador (`lerStorageR2Config`, `lerStorageProvider`
 * e guards de fail-closed). PURO: sem IO, sem rede, sem SDK. Cada teste injeta um
 * env fake — nada toca `process.env` real, nada imprime valores.
 */
import { describe, expect, it } from "vitest"
import {
  ENV_KEYS_R2,
  ENV_KEY_PROVIDER,
  StorageConfigError,
  StorageProviderError,
  lerStorageProvider,
  lerStorageR2Config,
  storageR2ConfigDisponivel,
  DOWNLOAD_EXPIRACAO_SEG,
  UPLOAD_EXPIRACAO_SEG,
  MAX_BYTES_DOCUMENTO,
} from "@/lib/contador/documentos/config"

const ENV_R2_OK = {
  R2_ACCOUNT_ID: "acc-1234567890abcdef",
  R2_ACCESS_KEY_ID: "AKIA-test",
  R2_SECRET_ACCESS_KEY: "shh-test-secret",
  R2_BUCKET: "omni-contador-documentos-preview",
} as const

describe("config R2 · fail-closed quando variáveis obrigatórias faltam", () => {
  it("lança StorageConfigError listando SOMENTE os nomes das vars faltantes (sem valores)", () => {
    try {
      lerStorageR2Config({})
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect(e).toBeInstanceOf(StorageConfigError)
      if (e instanceof StorageConfigError) {
        expect(e.code).toBe("STORAGE_CONFIG_INDISPONIVEL")
        expect(e.faltando).toEqual(
          expect.arrayContaining([
            ENV_KEYS_R2.accountId,
            ENV_KEYS_R2.accessKeyId,
            ENV_KEYS_R2.secretAccessKey,
            ENV_KEYS_R2.bucket,
          ]),
        )
        // A mensagem jamais contém valores reais.
        expect(String(e.message)).not.toContain("acc-123")
        expect(String(e.message)).not.toContain("AKIA")
        expect(String(e.message)).not.toContain("test-secret")
      }
    }
  })

  it("storageR2ConfigDisponivel devolve false quando incompleto e true quando completo", () => {
    expect(storageR2ConfigDisponivel({})).toBe(false)
    expect(storageR2ConfigDisponivel({ ...ENV_R2_OK })).toBe(true)
  })

  it("aceita R2_SIGNED_URL_TTL_SECONDS ausente (opcional)", () => {
    const cfg = lerStorageR2Config({ ...ENV_R2_OK })
    expect(cfg.signedUrlTtlSeconds).toBeNull()
    expect(cfg.endpoint).toBe(`https://${ENV_R2_OK.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
    expect(cfg.bucket).toBe(ENV_R2_OK.R2_BUCKET)
  })

  it("rejeita R2_SIGNED_URL_TTL_SECONDS inválido (não-inteiro, zero, negativo)", () => {
    // `"  "` (whitespace) vira `""` após o trim → é tratado como ausente (opcional),
    // então não está neste conjunto de inválidos.
    for (const invalido of ["abc", "0", "-1", "1.5"]) {
      expect(() =>
        lerStorageR2Config({ ...ENV_R2_OK, R2_SIGNED_URL_TTL_SECONDS: invalido }),
      ).toThrow(StorageConfigError)
    }
  })
})

describe("config R2 · hard guard contra segredo exposto em NEXT_PUBLIC_*", () => {
  it("rejeita NEXT_PUBLIC_R2_SECRET_ACCESS_KEY como erro de segurança explícito", () => {
    expect(() =>
      lerStorageR2Config({
        ...ENV_R2_OK,
        NEXT_PUBLIC_R2_SECRET_ACCESS_KEY: "qualquer",
      }),
    ).toThrow(StorageConfigError)
  })

  it("rejeita NEXT_PUBLIC_R2_ACCESS_KEY_ID como erro de segurança explícito", () => {
    expect(() =>
      lerStorageR2Config({
        ...ENV_R2_OK,
        NEXT_PUBLIC_R2_ACCESS_KEY_ID: "qualquer",
      }),
    ).toThrow(StorageConfigError)
  })

  it("rejeita NEXT_PUBLIC_*SERVICE_ROLE* (compat com adapter Supabase legado)", () => {
    expect(() =>
      lerStorageR2Config({
        ...ENV_R2_OK,
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "qualquer",
      }),
    ).toThrow(StorageConfigError)
  })

  it("não expõe valor do segredo na mensagem mesmo no hard guard", () => {
    try {
      lerStorageR2Config({
        ...ENV_R2_OK,
        NEXT_PUBLIC_R2_SECRET_ACCESS_KEY: "VAZAMENTO-SENSIVEL",
      })
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("VAZAMENTO-SENSIVEL")
    }
  })
})

describe("config R2 · provider gate (CONTADOR_STORAGE_PROVIDER)", () => {
  // GOAL 012E · P2: não há mais default. Um gate que assume o provider quando a
  // variável some não distingue "configurado certo" de "esquecido" — e era assim
  // que o R2 acabava ativo sem ninguém ter declarado nada.
  it("ausente lança StorageProviderError (sem default silencioso)", () => {
    expect(() => lerStorageProvider({})).toThrow(StorageProviderError)
  })

  it("vazio/espaços lança StorageProviderError", () => {
    expect(() => lerStorageProvider({ [ENV_KEY_PROVIDER]: "   " })).toThrow(StorageProviderError)
  })

  it("'r2' explícito = r2", () => {
    expect(lerStorageProvider({ [ENV_KEY_PROVIDER]: "r2" })).toBe("r2")
  })

  it("case-insensitive: 'R2' = r2", () => {
    expect(lerStorageProvider({ [ENV_KEY_PROVIDER]: "R2" })).toBe("r2")
  })

  it("'supabase' lança StorageProviderError (sem fallback automático)", () => {
    expect(() => lerStorageProvider({ [ENV_KEY_PROVIDER]: "supabase" })).toThrow(
      StorageProviderError,
    )
  })

  it("provider desconhecido lança StorageProviderError", () => {
    expect(() => lerStorageProvider({ [ENV_KEY_PROVIDER]: "s3-generico" })).toThrow(
      StorageProviderError,
    )
  })

  it("StorageProviderError nunca instancia o adapter Supabase (falha cerrada)", () => {
    try {
      lerStorageProvider({ [ENV_KEY_PROVIDER]: "supabase" })
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect(e).toBeInstanceOf(StorageProviderError)
      // Mensagem confirma que o caminho produtivo é r2 (sem instanciar adapter deprecated).
      expect(String((e as Error).message)).toContain("r2")
    }
  })
})

describe("config R2 · tetos do contrato preservados", () => {
  it("DOWNLOAD_EXPIRACAO_SEG = 300s (teto do download assinado)", () => {
    expect(DOWNLOAD_EXPIRACAO_SEG).toBe(300)
  })

  it("UPLOAD_EXPIRACAO_SEG = 120s (teto do upload assinado do navegador)", () => {
    expect(UPLOAD_EXPIRACAO_SEG).toBe(120)
  })

  it("MAX_BYTES_DOCUMENTO = 25 MB", () => {
    expect(MAX_BYTES_DOCUMENTO).toBe(25 * 1024 * 1024)
  })
})