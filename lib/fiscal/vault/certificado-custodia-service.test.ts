/**
 * GOAL-016C — serviço de custódia do certificado A1 (`certificado-custodia-service`).
 *
 * Prova, com `.pfx` EFÊMERO de teste (sem valor fiscal) e vaults em memória:
 *  - armazenar: certificado válido ⇒ refs opacas + metadados seguros; inválido/vencido/senha
 *    incorreta ⇒ bloqueio sanitizado e NADA gravado no cofre;
 *  - provider sem escrita (EnvVault piloto) ⇒ `custodia_indisponivel` (fail-closed);
 *  - rotação: nova versão validada e gravada ANTES; refs anteriores intactas até a confirmação;
 *    confirmada a troca, a versão anterior é revogada; se a troca falha, a nova é descartada e a
 *    anterior CONTINUA servindo (consistência);
 *  - revogação: refs destruídas; provider sem suporte ⇒ pendências reportadas, nunca escondidas;
 *  - descrever: metadados sem segredo (configurada/provider);
 *  - redaction: NENHUM resultado/erro carrega `.pfx`, senha ou chave privada.
 *
 * O `FakeVaultVersionado` simula o comportamento do provider KMS (refs versionadas por gravação),
 * que é onde a janela "nova válida antes de quebrar a antiga" de fato existe.
 */
import { describe, expect, it } from "vitest"
import { expiredTestPfx, makeTestPfx, validTestPfx, TEST_PFX_PRIVATE_KEY_PEM } from "./__fixtures__/make-test-pfx"
import { EnvVault } from "./env-vault"
import {
  FiscalVaultError,
  type FiscalSecretMetadata,
  type FiscalSecretVault,
  type FiscalVaultAvailability,
} from "./fiscal-secret-vault"
import {
  armazenarCertificadoA1,
  descreverCustodiaCertificado,
  revogarSegredosCertificado,
  rotacionarCertificadoA1,
} from "./certificado-custodia-service"
import { assertNoSecretLeak, scanForSecrets } from "./secret-scan"

const LOJA = "loja-1"

/** Vault em memória com refs VERSIONADAS (simula o provider KMS da ADR-0014). */
class FakeVaultVersionado implements FiscalSecretVault {
  readonly segredos = new Map<string, string>()
  private seq = 0
  disponivel = true

  private ref(storeId: string, kind: string): string {
    if (!storeId.trim()) throw new FiscalVaultError("store_invalida", "storeId é obrigatório.", null)
    return `kms://${storeId}/${kind}/v${++this.seq}`
  }
  private assertEscopo(storeId: string, ref: string): void {
    if (!ref.startsWith(`kms://${storeId}/`)) {
      throw new FiscalVaultError("ref_fora_de_escopo", "Referência de outra loja.", storeId)
    }
  }

  async getCertificadoPfx(storeId: string, ref: string | null | undefined): Promise<Buffer | null> {
    if (!ref?.trim()) return null
    this.assertEscopo(storeId, ref)
    const v = this.segredos.get(ref)
    return v ? Buffer.from(v, "base64") : null
  }
  async getCertificadoSenha(storeId: string, ref: string | null | undefined): Promise<string | null> {
    if (!ref?.trim()) return null
    this.assertEscopo(storeId, ref)
    return this.segredos.get(ref) ?? null
  }
  async getCscToken(storeId: string, ref: string | null | undefined): Promise<string | null> {
    return this.getCertificadoSenha(storeId, ref)
  }
  async putCertificadoPfx(storeId: string, pfx: Buffer, senha: string) {
    const blobRef = this.ref(storeId, "pfx")
    const senhaRef = this.ref(storeId, "senha")
    this.segredos.set(blobRef, pfx.toString("base64"))
    this.segredos.set(senhaRef, senha)
    return { blobRef, senhaRef }
  }
  async putCscToken(storeId: string, token: string) {
    const cscTokenRef = this.ref(storeId, "csc")
    this.segredos.set(cscTokenRef, token)
    return { cscTokenRef }
  }
  async revoke(storeId: string, ref: string): Promise<void> {
    this.assertEscopo(storeId, ref)
    this.segredos.delete(ref)
  }
  async describeSecret(storeId: string, ref: string | null | undefined): Promise<FiscalSecretMetadata | null> {
    if (!ref?.trim()) return null
    this.assertEscopo(storeId, ref)
    return { ref, storeId, configurada: this.segredos.has(ref), kind: null, backend: "fake-kms" }
  }
  async checkAvailability(): Promise<FiscalVaultAvailability> {
    return {
      disponivel: this.disponivel,
      backend: "fake-kms",
      capacidades: { leitura: true, escrita: true, rotacao: true, revogacao: true },
      mensagem: "",
    }
  }
  async rotateCertificadoPfx(storeId: string, pfx: Buffer, senha: string) {
    return this.putCertificadoPfx(storeId, pfx, senha)
  }
}

describe("custodia A1 — armazenar", () => {
  it("certificado válido ⇒ refs opacas + extração saneada; buffer de entrada zerado", async () => {
    const vault = new FakeVaultVersionado()
    const t = validTestPfx()
    const pfx = Buffer.from(t.pfx)

    const r = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx, senha: t.senha })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.refs.blobRef).toMatch(/^kms:\/\/loja-1\/pfx\/v\d+$/)
    expect(r.refs.senhaRef).toMatch(/^kms:\/\/loja-1\/senha\/v\d+$/)
    expect(r.extraido.cnpj).toBe(t.cnpj)
    expect(r.extraido.vigente).toBe(true)
    // O material ficou no cofre, resolvível pelas refs opacas.
    expect(await vault.getCertificadoSenha(LOJA, r.refs.senhaRef)).toBe(t.senha)
    // Buffer original zerado pelo serviço.
    expect(pfx.every((b) => b === 0)).toBe(true)
    // Nada de segredo no resultado.
    assertNoSecretLeak(r, { senha: t.senha, pfxBytes: t.pfx, privateKeyPem: TEST_PFX_PRIVATE_KEY_PEM }, "armazenar.ok")
  })

  it("certificado vencido ⇒ bloqueio fail-closed e NADA gravado no cofre", async () => {
    const vault = new FakeVaultVersionado()
    const t = expiredTestPfx()
    const r = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(t.pfx), senha: t.senha })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("certificado_invalido")
    expect(r.bloqueios.map((b) => b.codigo)).toContain("certificado_vencido")
    expect(vault.segredos.size).toBe(0)
    assertNoSecretLeak(r, { senha: t.senha, pfxBytes: t.pfx }, "armazenar.vencido")
  })

  it("senha incorreta ⇒ bloqueio específico e NADA gravado", async () => {
    const vault = new FakeVaultVersionado()
    const t = validTestPfx()
    const r = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(t.pfx), senha: "senha-errada-016c" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.bloqueios.map((b) => b.codigo)).toContain("senha_incorreta")
    expect(vault.segredos.size).toBe(0)
  })

  it("arquivo inválido (não-PKCS12) ⇒ bloqueio e NADA gravado", async () => {
    const vault = new FakeVaultVersionado()
    const r = await armazenarCertificadoA1({
      vault,
      storeId: LOJA,
      pfx: Buffer.from("isso-nao-e-um-pfx"),
      senha: "qualquer",
    })
    expect(r.ok).toBe(false)
    expect(vault.segredos.size).toBe(0)
  })

  it("provider sem escrita (EnvVault piloto) ⇒ custodia_indisponivel (fail-closed)", async () => {
    const vault = new EnvVault({ env: {} }) // piloto: sem allowWrite
    const t = validTestPfx()
    const r = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(t.pfx), senha: t.senha })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("custodia_indisponivel")
    assertNoSecretLeak(r, { senha: t.senha, pfxBytes: t.pfx }, "armazenar.indisponivel")
  })
})

describe("custodia A1 — rotação", () => {
  it("nova versão gravada antes da troca; anterior revogada só após a confirmação", async () => {
    const vault = new FakeVaultVersionado()
    const antigo = validTestPfx()
    const gravado = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(antigo.pfx), senha: antigo.senha })
    if (!gravado.ok) throw new Error("setup falhou")

    const novo = validTestPfx({ senha: "senha-nova-rotacao-016c" })
    const ordem: string[] = []
    const r = await rotacionarCertificadoA1({
      vault,
      storeId: LOJA,
      novoPfx: Buffer.from(novo.pfx),
      novaSenha: novo.senha,
      refsAnteriores: gravado.refs,
      confirmarTroca: async (novasRefs) => {
        // No momento da troca, a versão anterior AINDA resolve (janela segura).
        expect(await vault.getCertificadoSenha(LOJA, gravado.refs.senhaRef)).toBe(antigo.senha)
        // E a nova versão JÁ resolve pelas novas refs.
        expect(await vault.getCertificadoSenha(LOJA, novasRefs.senhaRef)).toBe(novo.senha)
        ordem.push("troca")
      },
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(ordem).toEqual(["troca"])
    expect(r.revogacaoAnterior).toBe("concluida")
    expect(r.refs.blobRef).not.toBe(gravado.refs.blobRef)
    // Após a confirmação: a anterior foi revogada; a nova serve.
    expect(await vault.getCertificadoSenha(LOJA, gravado.refs.senhaRef)).toBeNull()
    expect(await vault.getCertificadoSenha(LOJA, r.refs.senhaRef)).toBe(novo.senha)
    assertNoSecretLeak(r, { senha: novo.senha, pfxBytes: novo.pfx }, "rotacao.ok")
  })

  it("troca NÃO confirmada ⇒ versão nova descartada e anterior CONTINUA servindo", async () => {
    const vault = new FakeVaultVersionado()
    const antigo = validTestPfx()
    const gravado = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(antigo.pfx), senha: antigo.senha })
    if (!gravado.ok) throw new Error("setup falhou")

    const novo = validTestPfx({ senha: "senha-descartada-016c" })
    const r = await rotacionarCertificadoA1({
      vault,
      storeId: LOJA,
      novoPfx: Buffer.from(novo.pfx),
      novaSenha: novo.senha,
      refsAnteriores: gravado.refs,
      confirmarTroca: async () => {
        throw new Error("falha de banco simulada")
      },
    })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("troca_nao_confirmada")
    // Consistência: a anterior segue íntegra; a nova foi revogada (nada órfão).
    expect(await vault.getCertificadoSenha(LOJA, gravado.refs.senhaRef)).toBe(antigo.senha)
    expect(scanForSecrets(r, { senha: novo.senha }).vazou).toBe(false)
    // Apenas os 2 segredos da versão anterior permanecem no cofre.
    expect(vault.segredos.size).toBe(2)
  })

  it("novo certificado inválido ⇒ rejeitado antes de gravar; anterior intacta", async () => {
    const vault = new FakeVaultVersionado()
    const antigo = validTestPfx()
    const gravado = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(antigo.pfx), senha: antigo.senha })
    if (!gravado.ok) throw new Error("setup falhou")

    const vencido = expiredTestPfx()
    let trocaChamada = false
    const r = await rotacionarCertificadoA1({
      vault,
      storeId: LOJA,
      novoPfx: Buffer.from(vencido.pfx),
      novaSenha: vencido.senha,
      refsAnteriores: gravado.refs,
      confirmarTroca: async () => {
        trocaChamada = true
      },
    })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.bloqueios.map((b) => b.codigo)).toContain("certificado_vencido")
    expect(trocaChamada).toBe(false)
    expect(await vault.getCertificadoSenha(LOJA, gravado.refs.senhaRef)).toBe(antigo.senha)
  })

  it("provider sem rotação (EnvVault piloto) ⇒ custodia_indisponivel", async () => {
    const vault = new EnvVault({ env: {} })
    const novo = validTestPfx()
    const r = await rotacionarCertificadoA1({
      vault,
      storeId: LOJA,
      novoPfx: Buffer.from(novo.pfx),
      novaSenha: novo.senha,
      refsAnteriores: { blobRef: null, senhaRef: null },
      confirmarTroca: async () => {},
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("custodia_indisponivel")
  })

  it("refs canônicas idênticas (EnvVault gravável): rotação in-place NÃO se autodestrói", async () => {
    // Regressão da revisão independente: com refs estáveis, revogar "a anterior" apagaria a nova.
    const env: Record<string, string | undefined> = {}
    const vault = new EnvVault({ env, allowWrite: true })
    const antigo = validTestPfx()
    const refsAntigas = await vault.putCertificadoPfx(LOJA, Buffer.from(antigo.pfx), antigo.senha)

    const novo = validTestPfx({ senha: "senha-in-place-016c" })
    const r = await rotacionarCertificadoA1({
      vault,
      storeId: LOJA,
      novoPfx: Buffer.from(novo.pfx),
      novaSenha: novo.senha,
      refsAnteriores: refsAntigas,
      confirmarTroca: async () => {},
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.refs.blobRef).toBe(refsAntigas.blobRef) // refs estáveis
    expect(r.revogacaoAnterior).toBe("nao_aplicavel") // NADA revogado
    // O valor novo continua resolvível — a rotação não apagou o que acabou de gravar.
    expect(await vault.getCertificadoSenha(LOJA, refsAntigas.senhaRef)).toBe(novo.senha)
  })

  it("refs idênticas + troca não confirmada: NADA é revogado (valor in-place preservado)", async () => {
    const env: Record<string, string | undefined> = {}
    const vault = new EnvVault({ env, allowWrite: true })
    const antigo = validTestPfx()
    const refsAntigas = await vault.putCertificadoPfx(LOJA, Buffer.from(antigo.pfx), antigo.senha)

    const novo = validTestPfx({ senha: "senha-falha-in-place-016c" })
    const r = await rotacionarCertificadoA1({
      vault,
      storeId: LOJA,
      novoPfx: Buffer.from(novo.pfx),
      novaSenha: novo.senha,
      refsAnteriores: refsAntigas,
      confirmarTroca: async () => {
        throw new Error("falha de banco simulada")
      },
    })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("troca_nao_confirmada")
    // Sem refs versionadas não há "versão nova separada" para descartar — e revogar destruiria
    // o segredo. O serviço NÃO revoga nada nesse backend.
    expect(await vault.getCertificadoSenha(LOJA, refsAntigas.senhaRef)).toBe(novo.senha)
  })
})

describe("custodia A1 — revogação e descrição", () => {
  it("revoga as duas refs; ref ausente é tolerada; pendências são reportadas", async () => {
    const vault = new FakeVaultVersionado()
    const t = validTestPfx()
    const gravado = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(t.pfx), senha: t.senha })
    if (!gravado.ok) throw new Error("setup falhou")

    const rev = await revogarSegredosCertificado({ vault, storeId: LOJA, ...gravado.refs, senhaRef: gravado.refs.senhaRef })
    expect(rev.pendentes).toEqual([])
    expect(rev.revogadas).toContain(gravado.refs.blobRef)
    expect(await vault.getCertificadoSenha(LOJA, gravado.refs.senhaRef)).toBeNull()

    // refs nulas/vazias: nada acontece, sem erro.
    const vazio = await revogarSegredosCertificado({ vault, storeId: LOJA, blobRef: null, senhaRef: "  " })
    expect(vazio).toEqual({ revogadas: [], pendentes: [] })
  })

  it("provider sem revogação (EnvVault piloto) ⇒ pendente reportado, nunca escondido", async () => {
    const vault = new EnvVault({ env: {} })
    const rev = await revogarSegredosCertificado({
      vault,
      storeId: LOJA,
      blobRef: "FISCAL_A1_PFX_B64_LOJA_1",
      senhaRef: "FISCAL_A1_SENHA_LOJA_1",
    })
    expect(rev.revogadas).toEqual([])
    expect(rev.pendentes).toEqual(["FISCAL_A1_PFX_B64_LOJA_1", "FISCAL_A1_SENHA_LOJA_1"])
  })

  it("descrever expõe só metadados: configurada + provider, sem segredo", async () => {
    const vault = new FakeVaultVersionado()
    const t = validTestPfx()
    const gravado = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(t.pfx), senha: t.senha })
    if (!gravado.ok) throw new Error("setup falhou")

    const d = await descreverCustodiaCertificado({ vault, storeId: LOJA, ...gravado.refs })
    expect(d.configurada).toBe(true)
    expect(d.availability.backend).toBe("fake-kms")
    expect(d.blob?.configurada).toBe(true)
    assertNoSecretLeak(d, { senha: t.senha, pfxBytes: t.pfx }, "descrever")

    const vazia = await descreverCustodiaCertificado({ vault, storeId: LOJA, blobRef: null, senhaRef: null })
    expect(vazia.configurada).toBe(false)
  })
})

describe("custodia A1 — isolamento multi-loja no serviço", () => {
  it("uma loja não descreve nem revoga ref de outra loja (fail-closed)", async () => {
    const vault = new FakeVaultVersionado()
    const t = validTestPfx()
    const gravado = await armazenarCertificadoA1({ vault, storeId: LOJA, pfx: Buffer.from(t.pfx), senha: t.senha })
    if (!gravado.ok) throw new Error("setup falhou")

    await expect(descreverCustodiaCertificado({ vault, storeId: "loja-2", ...gravado.refs })).rejects.toMatchObject({
      code: "ref_fora_de_escopo",
    })
    const rev = await revogarSegredosCertificado({ vault, storeId: "loja-2", ...gravado.refs })
    // Revogação cross-store não destrói nada — vira pendência reportada.
    expect(rev.revogadas).toEqual([])
    expect(rev.pendentes.length).toBe(2)
    expect(await vault.getCertificadoSenha(LOJA, gravado.refs.senhaRef)).toBe(t.senha)
  })
})
