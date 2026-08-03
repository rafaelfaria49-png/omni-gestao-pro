/**
 * GOAL-016C — contrato server-only do Secret Provider (port `FiscalSecretVault` + EnvVault +
 * resolver). Prova, sem nenhum segredo real:
 *  - CRUD lógico: put → get → describe → rotate → revoke (com store de env mutável de teste);
 *  - referências opacas: o caller só vê nomes canônicos, nunca conteúdo;
 *  - isolamento multi-loja: ref canônica de outra loja ⇒ `ref_fora_de_escopo` em TODAS as operações;
 *  - provider ausente/desconhecido: resolver devolve `vault = null` + indisponível (fail-closed);
 *  - segredo inexistente: leitura resolve `null`; describe reporta `configurada = false`;
 *  - disponibilidade: leitura sempre; escrita/rotação/revogação só com store mutável;
 *  - rotação no nível do provider: grava nova versão SEM revogar as refs anteriores;
 *  - piloto real (sem `allowWrite`): escrita/rotação/revogação lançam `operacao_nao_suportada`.
 */
import { describe, expect, it } from "vitest"
import { EnvVault, ENV_VAULT_BACKEND } from "./env-vault"
import { FiscalVaultError, canonicalEnvRef } from "./fiscal-secret-vault"
import { PROVIDER_SUPABASE_VAULT, resolveFiscalSecretProvider } from "./provider-resolver"
import { assertNoSecretLeak } from "./secret-scan"

const LOJA_A = "loja-1"
const LOJA_B = "loja-2"
const SENHA = "senha-super-secreta-016c"
const PFX = Buffer.from("conteudo-pfx-falso-016c".repeat(8))

function envMutavel() {
  return {} as Record<string, string | undefined>
}

describe("Secret Provider — CRUD lógico (EnvVault com store mutável)", () => {
  it("put → get → describe → revoke completa o ciclo com refs opacas", async () => {
    const env = envMutavel()
    const vault = new EnvVault({ env, allowWrite: true })

    const refs = await vault.putCertificadoPfx(LOJA_A, PFX, SENHA)
    // Referência opaca: nome canônico por loja, nunca o conteúdo.
    expect(refs.blobRef).toBe(canonicalEnvRef("pfx", LOJA_A))
    expect(refs.senhaRef).toBe(canonicalEnvRef("senha", LOJA_A))
    expect(refs.blobRef).not.toContain(SENHA)

    expect((await vault.getCertificadoPfx(LOJA_A, refs.blobRef))?.equals(PFX)).toBe(true)
    expect(await vault.getCertificadoSenha(LOJA_A, refs.senhaRef)).toBe(SENHA)

    const meta = await vault.describeSecret(LOJA_A, refs.blobRef)
    expect(meta).toMatchObject({
      ref: refs.blobRef,
      storeId: LOJA_A,
      configurada: true,
      kind: "pfx",
      backend: ENV_VAULT_BACKEND,
    })

    const csc = await vault.putCscToken(LOJA_A, "token-csc-falso")
    expect(await vault.getCscToken(LOJA_A, csc.cscTokenRef)).toBe("token-csc-falso")

    await vault.revoke(LOJA_A, refs.blobRef)
    await vault.revoke(LOJA_A, refs.senhaRef)
    expect(await vault.getCertificadoPfx(LOJA_A, refs.blobRef)).toBeNull()
    expect(await vault.getCertificadoSenha(LOJA_A, refs.senhaRef)).toBeNull()
    expect((await vault.describeSecret(LOJA_A, refs.blobRef))?.configurada).toBe(false)
  })

  it("segredo inexistente: leitura resolve null (fail-closed) e describe reporta não configurado", async () => {
    const vault = new EnvVault({ env: envMutavel(), allowWrite: true })
    expect(await vault.getCertificadoPfx(LOJA_A, canonicalEnvRef("pfx", LOJA_A))).toBeNull()
    expect(await vault.getCertificadoSenha(LOJA_A, canonicalEnvRef("senha", LOJA_A))).toBeNull()
    expect(await vault.getCscToken(LOJA_A, canonicalEnvRef("csc", LOJA_A))).toBeNull()

    const meta = await vault.describeSecret(LOJA_A, canonicalEnvRef("pfx", LOJA_A))
    expect(meta?.configurada).toBe(false)
    // ref vazia/ausente ⇒ describe resolve null, sem erro
    expect(await vault.describeSecret(LOJA_A, null)).toBeNull()
    expect(await vault.describeSecret(LOJA_A, "  ")).toBeNull()
  })

  it("disponibilidade reflete as capacidades reais do backend", async () => {
    const comEscrita = await new EnvVault({ env: envMutavel(), allowWrite: true }).checkAvailability()
    expect(comEscrita).toMatchObject({
      disponivel: true,
      backend: ENV_VAULT_BACKEND,
      capacidades: { leitura: true, escrita: true, rotacao: true, revogacao: true },
    })

    const piloto = await new EnvVault({ env: envMutavel() }).checkAvailability()
    expect(piloto.disponivel).toBe(true)
    expect(piloto.capacidades).toEqual({ leitura: true, escrita: false, rotacao: false, revogacao: false })
    assertNoSecretLeak(piloto, { senha: SENHA, pfxBytes: PFX }, "checkAvailability")
  })
})

describe("Secret Provider — isolamento multi-loja", () => {
  it("ref canônica de outra loja é rejeitada em get, describe e revoke", async () => {
    const env = envMutavel()
    const vault = new EnvVault({ env, allowWrite: true })
    const refsA = await vault.putCertificadoPfx(LOJA_A, PFX, SENHA)

    await expect(vault.getCertificadoPfx(LOJA_B, refsA.blobRef)).rejects.toMatchObject({
      code: "ref_fora_de_escopo",
    })
    await expect(vault.getCertificadoSenha(LOJA_B, refsA.senhaRef)).rejects.toMatchObject({
      code: "ref_fora_de_escopo",
    })
    await expect(vault.describeSecret(LOJA_B, refsA.blobRef)).rejects.toMatchObject({
      code: "ref_fora_de_escopo",
    })
    await expect(vault.revoke(LOJA_B, refsA.blobRef)).rejects.toMatchObject({
      code: "ref_fora_de_escopo",
    })

    // A loja dona continua resolvendo normalmente.
    expect(await vault.getCertificadoSenha(LOJA_A, refsA.senhaRef)).toBe(SENHA)
  })

  it("storeId vazio é rejeitado (store_invalida) em leitura e describe", async () => {
    const vault = new EnvVault({ env: envMutavel(), allowWrite: true })
    await expect(vault.getCertificadoPfx("", "FISCAL_A1_PFX_B64_LOJA_1")).rejects.toMatchObject({
      code: "store_invalida",
    })
    await expect(vault.describeSecret("  ", "FISCAL_A1_PFX_B64_LOJA_1")).rejects.toMatchObject({
      code: "store_invalida",
    })
  })
})

describe("Secret Provider — rotação no nível do provider", () => {
  it("rotate grava a nova versão SEM revogar refs anteriores (a troca é do caller)", async () => {
    const env = envMutavel()
    const vault = new EnvVault({ env, allowWrite: true })
    const refsAntigas = await vault.putCertificadoPfx(LOJA_A, PFX, SENHA)

    const novaSenha = "senha-rotacionada-016c"
    const novoPfx = Buffer.from("pfx-novo-016c".repeat(8))
    const novasRefs = await vault.rotateCertificadoPfx(LOJA_A, novoPfx, novaSenha)

    // No EnvVault as refs são canônicas por loja (estáveis): o valor novo já resolve...
    expect(await vault.getCertificadoSenha(LOJA_A, novasRefs.senhaRef)).toBe(novaSenha)
    // ...e NADA foi revogado pelo provider — revogação da versão anterior é ato do caller.
    expect(novasRefs.blobRef).toBe(refsAntigas.blobRef)
  })
})

describe("Secret Provider — piloto real (sem allowWrite): escrita fail-closed", () => {
  it("put/rotate/revoke lançam operacao_nao_suportada (provisionamento manual)", async () => {
    const env = envMutavel()
    const vault = new EnvVault({ env }) // piloto: somente leitura
    await expect(vault.putCertificadoPfx(LOJA_A, PFX, SENHA)).rejects.toMatchObject({
      code: "operacao_nao_suportada",
    })
    await expect(vault.rotateCertificadoPfx(LOJA_A, PFX, SENHA)).rejects.toMatchObject({
      code: "operacao_nao_suportada",
    })
    await expect(vault.revoke(LOJA_A, canonicalEnvRef("pfx", LOJA_A))).rejects.toMatchObject({
      code: "operacao_nao_suportada",
    })
    // Leitura continua fail-closed (env vazia ⇒ null).
    expect(await vault.getCertificadoPfx(LOJA_A, canonicalEnvRef("pfx", LOJA_A))).toBeNull()
  })

  it("mensagens de erro NUNCA carregam o segredo", async () => {
    const vault = new EnvVault({ env: envMutavel() })
    const erro = await vault.putCertificadoPfx(LOJA_A, PFX, SENHA).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(FiscalVaultError)
    assertNoSecretLeak(erro, { senha: SENHA, pfxBytes: PFX }, "erro do vault")
  })
})

describe("Secret Provider — resolver (decisão de backend)", () => {
  it("default (sem FISCAL_SECRET_PROVIDER) resolve EnvVault do piloto, sem escrita", () => {
    const r = resolveFiscalSecretProvider({})
    expect(r.provider).toBe(ENV_VAULT_BACKEND)
    expect(r.vault).not.toBeNull()
    expect(r.availability.disponivel).toBe(true)
    expect(r.availability.capacidades.escrita).toBe(false)
  })

  it("provider declarado mas não implementado ⇒ indisponível, fail-closed, sem fallback", () => {
    const r = resolveFiscalSecretProvider({ FISCAL_SECRET_PROVIDER: PROVIDER_SUPABASE_VAULT })
    expect(r.provider).toBe(PROVIDER_SUPABASE_VAULT)
    expect(r.vault).toBeNull()
    expect(r.availability.disponivel).toBe(false)
    expect(r.availability.capacidades).toEqual({
      leitura: false,
      escrita: false,
      rotacao: false,
      revogacao: false,
    })
  })

  it("provider desconhecido ⇒ indisponível (nunca cai em outro backend)", () => {
    const r = resolveFiscalSecretProvider({ FISCAL_SECRET_PROVIDER: "provider-inexistente" })
    expect(r.vault).toBeNull()
    expect(r.availability.disponivel).toBe(false)
  })
})
