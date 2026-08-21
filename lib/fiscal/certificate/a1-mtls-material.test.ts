import { describe, expect, it } from "vitest"
import { validTestPfx } from "@/lib/fiscal/vault/__fixtures__/make-test-pfx"
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { scanForSecrets } from "@/lib/fiscal/vault/secret-scan"
import {
  A1MtlsMaterialError,
  loadA1MtlsMaterial,
  loadA1MtlsSecureContext,
} from "./a1-mtls-material"

const STORE = "store-mtls-offline"
const PFX_REF = canonicalEnvRef("pfx", STORE)
const SENHA_REF = canonicalEnvRef("senha", STORE)

function testEnv(pfx: Buffer, senha: string): Record<string, string> {
  return {
    FISCAL_SECRET_PROVIDER: "env",
    [PFX_REF]: pfx.toString("base64"),
    [SENHA_REF]: senha,
  }
}

describe("A1 mTLS material · somente memória e referências opacas", () => {
  it("resolve PFX+senha server-side, encapsula e zera o Buffer ao descartar", async () => {
    const fixture = validTestPfx({ senha: "senha-a1-mtls-somente-teste" })
    const material = await loadA1MtlsMaterial({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env: testEnv(fixture.pfx, fixture.senha),
    })

    let pfxMatches = false
    let passphraseMatches = false
    material.withTlsOptions((options) => {
      pfxMatches = options.pfx.equals(fixture.pfx)
      passphraseMatches = options.passphrase === fixture.senha
    })
    expect(pfxMatches).toBe(true)
    expect(passphraseMatches).toBe(true)
    expect(JSON.stringify(material)).toBe("{}")

    material.dispose()
    expect(() => material.withTlsOptions(() => null)).toThrowError(A1MtlsMaterialError)
  })

  it("documenta que dispose é best-effort e não apaga cópia/captura feita pelo consumer", async () => {
    const fixture = validTestPfx({ senha: "senha-a1-captura-sintetica-004" })
    const material = await loadA1MtlsMaterial({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env: testEnv(fixture.pfx, fixture.senha),
    })

    const retained: {
      borrowedPfx: Buffer | null
      pfxCopy: Buffer | null
      passphrase: string | null
    } = { borrowedPfx: null, pfxCopy: null, passphrase: null }
    material.withTlsOptions(({ pfx, passphrase }) => {
      retained.borrowedPfx = pfx
      retained.pfxCopy = Buffer.from(pfx)
      retained.passphrase = passphrase
    })

    material.dispose()
    expect(retained.borrowedPfx).not.toBeNull()
    expect(retained.borrowedPfx?.every((byte) => byte === 0)).toBe(true)
    expect(retained.pfxCopy?.equals(fixture.pfx)).toBe(true)
    expect(retained.passphrase).toBe(fixture.senha)

    retained.pfxCopy?.fill(0)
    retained.borrowedPfx = null
    retained.pfxCopy = null
    retained.passphrase = null
  })

  it("falha fechado quando PFX, senha ou provider não estão disponíveis", async () => {
    const fixture = validTestPfx({ senha: "segredo-sentinela-mtls-003" })
    const base = testEnv(fixture.pfx, fixture.senha)

    const withoutPfx = { ...base, [PFX_REF]: "" }
    await expect(
      loadA1MtlsMaterial({ storeId: STORE, blobRef: PFX_REF, senhaRef: SENHA_REF, env: withoutPfx }),
    ).rejects.toMatchObject({ code: "pfx_indisponivel" })

    const withoutPassword = { ...base, [SENHA_REF]: "" }
    await expect(
      loadA1MtlsMaterial({
        storeId: STORE,
        blobRef: PFX_REF,
        senhaRef: SENHA_REF,
        env: withoutPassword,
      }),
    ).rejects.toMatchObject({ code: "senha_indisponivel" })

    await expect(
      loadA1MtlsMaterial({
        storeId: STORE,
        blobRef: PFX_REF,
        senhaRef: SENHA_REF,
        env: { ...base, FISCAL_SECRET_PROVIDER: "supabase_vault" },
      }),
    ).rejects.toMatchObject({ code: "secret_provider_indisponivel" })
  })

  it("não cruza lojas e não serializa segredo em erros", async () => {
    const fixture = validTestPfx({ senha: "senha-super-secreta-sentinela-003" })
    const error = await loadA1MtlsMaterial({
      storeId: "outra-loja",
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env: testEnv(fixture.pfx, fixture.senha),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(A1MtlsMaterialError)
    expect((error as A1MtlsMaterialError).code).toBe("falha_ao_resolver_material")
    expect(
      scanForSecrets(error, {
        senha: fixture.senha,
        pfxBytes: fixture.pfx,
      }),
    ).toEqual({ vazou: false, ocorrencias: [] })
  })

  it("não aceita referências vazias", async () => {
    await expect(
      loadA1MtlsMaterial({ storeId: STORE, blobRef: "", senhaRef: SENHA_REF, env: {} }),
    ).rejects.toMatchObject({ code: "referencias_invalidas" })
  })

  it("abre e valida PFX sintético em SecureContext TLS antes de liberar o consumer", async () => {
    const fixture = validTestPfx({ senha: "senha-preconsume-valida-sintetica" })

    const secureContext = await loadA1MtlsSecureContext({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env: testEnv(fixture.pfx, fixture.senha),
    })

    expect(secureContext).toBeDefined()
    fixture.pfx.fill(0)
  })

  it("PFX inválido ou senha incorreta falham sanitizados durante o preconsume", async () => {
    const fixture = validTestPfx({ senha: "senha-preconsume-correta-sintetica" })
    const wrongPassword = "senha-preconsume-incorreta-sintetica"
    const invalidPfx = Buffer.from("pkcs12-invalido-somente-teste", "utf8")

    const passwordError = await loadA1MtlsSecureContext({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env: testEnv(fixture.pfx, wrongPassword),
    }).catch((error: unknown) => error)
    const pfxError = await loadA1MtlsSecureContext({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env: testEnv(invalidPfx, fixture.senha),
    }).catch((error: unknown) => error)

    expect(passwordError).toMatchObject({ code: "secure_context_invalido" })
    expect(pfxError).toMatchObject({ code: "secure_context_invalido" })
    expect(scanForSecrets([passwordError, pfxError], {
      senha: wrongPassword,
      pfxBytes: invalidPfx,
      extras: [fixture.senha],
    })).toEqual({ vazou: false, ocorrencias: [] })
    fixture.pfx.fill(0)
    invalidPfx.fill(0)
  })
})
