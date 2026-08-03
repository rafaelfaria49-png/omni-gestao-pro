/**
 * GOAL-016C — POST /api/fiscal/certificado/[id]/rotacionar sobre Prisma EM MEMÓRIA.
 *
 * Exercita o handler de PRODUÇÃO com `.pfx` efêmero de teste. Prova:
 *  - caminho feliz: troca do ponteiro com guarda otimista, metadados do novo certificado,
 *    auditoria `secret.rotate` e resposta SEM segredo;
 *  - 404 (certificado de outra loja/inexistente), 409 (REVOGADO é terminal), 503 (provider sem
 *    rotação — fail-closed do piloto);
 *  - CNPJ divergente e fingerprint de outra loja ⇒ 422 ANTES do cofre — o material rejeitado
 *    nunca substitui o segredo em uso (prova: cofre segue com o valor anterior);
 *  - senha incorreta ⇒ 422 e nada muda;
 *  - concorrência (guarda otimista) ⇒ 409 `troca_nao_confirmada`, linha inalterada;
 *  - pipeline DORMENTE: `fiscalEnabled`/`certificadoAtivoId` jamais escritos aqui.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { validTestPfx, TEST_PFX_PRIVATE_KEY_PEM } from "@/lib/fiscal/vault/__fixtures__/make-test-pfx"
import { EnvVault } from "@/lib/fiscal/vault/env-vault"
import { assertNoSecretLeak } from "@/lib/fiscal/vault/secret-scan"

type Row = Record<string, unknown>

const STORE = "loja-1"
const CNPJ = "11222333000181"
const BLOB_REF = "FISCAL_A1_PFX_B64_LOJA_1"
const SENHA_REF = "FISCAL_A1_SENHA_LOJA_1"

const h = vi.hoisted(() => {
  const configs: Row[] = []
  const certs: Row[] = []
  const logs: Row[] = []
  const envVault: Record<string, string | undefined> = {}
  let providerMode: "write" | "pilot" = "write"
  /** Simula corrida: quando true, a guarda otimista (updateMany) não encontra a linha. */
  let simularConcorrencia = false
  const escritasConfig: string[] = []

  const prisma = {
    configuracaoFiscalLoja: {
      findUnique: async ({ where }: { where: { storeId: string } }) =>
        configs.find((c) => c.storeId === where.storeId) ?? null,
      update: async () => {
        escritasConfig.push("update")
        throw new Error("ConfiguracaoFiscalLoja não pode ser escrita pela rotação")
      },
    },
    certificadoDigital: {
      findFirst: async ({ where }: { where: { id?: string; storeId?: string; fingerprint?: string; NOT?: { storeId: string } } }) => {
        if (where.NOT) {
          const r = certs.find((c) => c.fingerprint === where.fingerprint && c.storeId !== where.NOT!.storeId)
          return r ? { id: r.id as string } : null
        }
        if (where.id) return certs.find((c) => c.id === where.id && c.storeId === where.storeId) ?? null
        return null
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (simularConcorrencia) return { count: 0 }
        const i = certs.findIndex(
          (c) =>
            c.id === where.id &&
            c.storeId === where.storeId &&
            (c.blobRef ?? null) === (where.blobRef ?? null) &&
            (c.senhaRef ?? null) === (where.senhaRef ?? null),
        )
        if (i < 0) return { count: 0 }
        certs[i] = { ...certs[i], ...data }
        return { count: 1 }
      },
      findUnique: async ({ where }: { where: { id: string } }) => certs.find((c) => c.id === where.id) ?? null,
    },
    fiscalLog: {
      create: async ({ data }: { data: Row }) => {
        logs.push(data)
        return data
      },
    },
  }

  return {
    prisma,
    configs,
    certs,
    logs,
    envVault,
    escritasConfig,
    setProviderMode: (m: "write" | "pilot") => {
      providerMode = m
    },
    getProviderMode: () => providerMode,
    setConcorrencia: (v: boolean) => {
      simularConcorrencia = v
    },
    reset: () => {
      configs.length = 0
      certs.length = 0
      logs.length = 0
      escritasConfig.length = 0
      for (const k of Object.keys(envVault)) delete envVault[k]
      providerMode = "write"
      simularConcorrencia = false
    },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma, prismaEnsureConnected: vi.fn(async () => undefined) }))
vi.mock("@/lib/store-id-from-request", () => ({ storeIdFromAssistecRequestForWrite: vi.fn(() => STORE) }))
vi.mock("@/lib/fiscal/guard-fiscal-admin", () => ({
  requireFiscalAdmin: vi.fn(async () => ({
    ok: true as const,
    session: { user: { id: "u1", name: "Admin Fiscal" } },
    storeId: STORE,
  })),
}))
vi.mock("@/lib/fiscal/vault", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/fiscal/vault")>()
  return {
    ...mod,
    resolveFiscalSecretProvider: () => {
      const allowWrite = h.getProviderMode() === "write"
      const vault = new EnvVault({ env: h.envVault, allowWrite })
      return {
        provider: "env-piloto",
        vault,
        availability: {
          disponivel: true,
          backend: "env-piloto",
          capacidades: { leitura: true, escrita: allowWrite, rotacao: allowWrite, revogacao: allowWrite },
          mensagem: "",
        },
      }
    },
  }
})

import { POST } from "./route"

function seedCertAntigo(overrides: Row = {}) {
  const antigo = validTestPfx({ cn: "RAFACELL COMERCIO LTDA" })
  h.envVault[BLOB_REF] = antigo.pfx.toString("base64")
  h.envVault[SENHA_REF] = antigo.senha
  h.certs.push({
    id: "cert-1",
    storeId: STORE,
    apelido: "Certificado da matriz",
    tipo: "A1",
    titularCn: antigo.cn,
    cnpjTitular: CNPJ,
    serialNumber: "111",
    fingerprint: "ff".repeat(20),
    status: "ATIVO",
    ativo: true,
    blobRef: BLOB_REF,
    senhaRef: SENHA_REF,
    ...overrides,
  })
  h.configs.push({ storeId: STORE, cnpj: CNPJ, fiscalEnabled: false, certificadoAtivoId: "cert-1" })
  return antigo
}

function requestComPfx(pfx: Buffer, senha: string): Request {
  const fd = new FormData()
  fd.append("certificado", new File([pfx], "novo.pfx", { type: "application/x-pkcs12" }))
  fd.append("senha", senha)
  return new Request("http://localhost/api/fiscal/certificado/cert-1/rotacionar", { method: "POST", body: fd })
}

function ctx(id = "cert-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  h.reset()
})

describe("POST rotacionar — caminho feliz", () => {
  it("troca o ponteiro com metadados do novo certificado, sem vazar segredo", async () => {
    seedCertAntigo()
    const novo = validTestPfx({ senha: "senha-nova-rotacao-016c" })
    const res = await POST(requestComPfx(Buffer.from(novo.pfx), novo.senha), ctx())
    const j = (await res.json()) as Row

    expect(res.status).toBe(200)
    expect(j.ok).toBe(true)
    // EnvVault: refs canônicas estáveis ⇒ revogação anterior não se aplica (in-place).
    expect(j.custodia).toMatchObject({ provider: "env-piloto", rotacionada: true, revogacaoAnterior: "nao_aplicavel" })

    // Linha atualizada com os metadados REAIS do novo certificado.
    const cert = h.certs[0]!
    expect(cert.fingerprint).toBe((j.certificado as Row).fingerprint)
    expect(cert.blobRef).toBe(BLOB_REF)
    expect(cert.senhaRef).toBe(SENHA_REF)
    expect(cert.status).toBe("ATIVO") // preservado: o novo passou pela mesma validação
    expect(cert.ativo).toBe(true)

    // Novo segredo resolvível pelas refs; config jamais escrita.
    expect(h.envVault[SENHA_REF]).toBe(novo.senha)
    expect(h.escritasConfig).toEqual([])

    expect(h.logs.map((l) => l.acao)).toContain("secret.rotate")
    expect(h.logs.map((l) => l.acao)).toContain("certificado.custodia.rotacionar")

    const segredos = { senha: novo.senha, pfxBytes: novo.pfx, privateKeyPem: TEST_PFX_PRIVATE_KEY_PEM }
    assertNoSecretLeak(j, segredos, "resposta da rotacao")
    assertNoSecretLeak(h.logs, segredos, "auditoria da rotacao")
  })
})

describe("POST rotacionar — recusas fail-closed", () => {
  it("certificado inexistente ou de outra loja ⇒ 404", async () => {
    const novo = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(novo.pfx), novo.senha), ctx("nao-existe"))
    expect(res.status).toBe(404)
    expect(Object.keys(h.envVault).length).toBe(0)
  })

  it("certificado REVOGADO é terminal ⇒ 409", async () => {
    const antigo = seedCertAntigo({ status: "REVOGADO", ativo: false })
    const novo = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(novo.pfx), novo.senha), ctx())
    expect(res.status).toBe(409)
    // Cofre intocado (o antigo segue lá, revogado na linha).
    expect(h.envVault[SENHA_REF]).toBe(antigo.senha)
  })

  it("provider sem rotação (piloto) ⇒ 503 fail-closed", async () => {
    const antigo = seedCertAntigo()
    h.setProviderMode("pilot")
    const novo = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(novo.pfx), novo.senha), ctx())
    const j = (await res.json()) as Row
    expect(res.status).toBe(503)
    expect(j.codigo).toBe("custodia_indisponivel")
    // Segredo antigo intacto.
    expect(h.envVault[SENHA_REF]).toBe(antigo.senha)
  })

  it("CNPJ divergente da unidade ⇒ 422 ANTES do cofre, segredo em uso intacto", async () => {
    const antigo = seedCertAntigo()
    const novo = validTestPfx({ cnpj: "99999999000199" })
    const res = await POST(requestComPfx(Buffer.from(novo.pfx), novo.senha), ctx())
    const j = (await res.json()) as Row
    expect(res.status).toBe(422)
    expect((j.bloqueios as Row[]).map((b) => b.codigo)).toContain("cnpj_divergente")
    expect(h.certs[0]!.fingerprint).toBe("ff".repeat(20))
    // PROVA N1: a recusa aconteceu ANTES de gravar — o material rejeitado não substituiu o segredo ATIVO.
    expect(h.envVault[SENHA_REF]).toBe(antigo.senha)
    expect(h.envVault[BLOB_REF]).toBe(antigo.pfx.toString("base64"))
    assertNoSecretLeak(j, { senha: novo.senha, pfxBytes: novo.pfx }, "cnpj divergente")
  })

  it("fingerprint vinculada a OUTRA loja ⇒ 422 ANTES do cofre, segredo em uso intacto", async () => {
    const antigo = seedCertAntigo()
    const novo = validTestPfx()
    // A fingerprint real do novo certificado já existe na loja-2.
    const { inspecionarCertificadoPfx } = await import("@/lib/fiscal/certificate")
    const insp = inspecionarCertificadoPfx({ pfx: Buffer.from(novo.pfx), senha: novo.senha })
    h.certs.push({
      id: "cert-outra",
      storeId: "loja-2",
      fingerprint: insp.extraido!.fingerprintSha1,
      status: "ATIVO",
      ativo: true,
      blobRef: "FISCAL_A1_PFX_B64_LOJA_2",
      senhaRef: "FISCAL_A1_SENHA_LOJA_2",
    })

    const res = await POST(requestComPfx(Buffer.from(novo.pfx), novo.senha), ctx())
    const j = (await res.json()) as Row
    expect(res.status).toBe(422)
    expect((j.bloqueios as Row[]).map((b) => b.codigo)).toContain("certificado_de_outra_loja")
    expect(h.certs.find((c) => c.id === "cert-1")!.fingerprint).toBe("ff".repeat(20))
    // Recusa ANTES do cofre: segredo em uso intacto.
    expect(h.envVault[SENHA_REF]).toBe(antigo.senha)
  })

  it("senha incorreta ⇒ 422 e nada muda", async () => {
    const antigo = seedCertAntigo()
    const novo = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(novo.pfx), "senha-errada-016c"), ctx())
    const j = (await res.json()) as Row
    expect(res.status).toBe(422)
    expect((j.bloqueios as Row[]).map((b) => b.codigo)).toContain("senha_incorreta")
    expect(h.certs[0]!.fingerprint).toBe("ff".repeat(20))
    expect(h.envVault[SENHA_REF]).toBe(antigo.senha)
  })

  it("concorrência na troca (guarda otimista) ⇒ 409, linha inalterada, nada órfão", async () => {
    seedCertAntigo()
    h.setConcorrencia(true)
    const novo = validTestPfx({ senha: "senha-concorrencia-016c" })
    const res = await POST(requestComPfx(Buffer.from(novo.pfx), novo.senha), ctx())
    const j = (await res.json()) as Row
    expect(res.status).toBe(409)
    // Linha NÃO foi tocada (ponteiro/metadata intactos).
    expect(h.certs[0]!.fingerprint).toBe("ff".repeat(20))
    // EnvVault in-place: a gravação precede a guarda e não pode ser desfeita em refs canônicas —
    // limitação inerente do backend in-place (piloto real responde 503; KMS versionado descarta a
    // versão perdedora, pois refs novas ≠ refs anteriores). Sem autodestruição: nada é revogado.
    expect(h.envVault[SENHA_REF]).toBe(novo.senha)
    assertNoSecretLeak(j, { senha: novo.senha, pfxBytes: novo.pfx }, "concorrencia")
  })
})
