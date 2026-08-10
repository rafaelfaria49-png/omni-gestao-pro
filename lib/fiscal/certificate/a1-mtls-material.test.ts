import { describe, expect, it } from "vitest"
import { validTestPfx } from "@/lib/fiscal/vault/__fixtures__/make-test-pfx"
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { scanForSecrets } from "@/lib/fiscal/vault/secret-scan"
import {
  A1MtlsMaterialError,
  loadA1MtlsMaterial,
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
})
