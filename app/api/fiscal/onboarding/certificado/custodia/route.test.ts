/**
 * GOAL-016C — POST/GET /api/fiscal/onboarding/certificado/custodia sobre Prisma EM MEMÓRIA.
 *
 * Exercita o handler de PRODUÇÃO com `.pfx` efêmero de teste. Prova:
 *  - caminho feliz: segredo gravado SOMENTE no cofre (env mutável de teste); a linha do
 *    `CertificadoDigital` recebe REFERÊNCIAS OPACAS + metadados, `PENDENTE_VALIDACAO` e inativo;
 *  - API sem vazamento: resposta, erros e auditoria NUNCA carregam `.pfx`, senha ou chave;
 *  - CNPJ divergente / fingerprint de outra loja / revogado / ativo ⇒ recusa ANTES do cofre
 *    (pré-inspeção + reconciliação em memória): segredo rejeitado nunca é armazenado;
 *  - certificado vencido / senha incorreta ⇒ 422 sanitizado, nada gravado;
 *  - provider sem escrita ⇒ 503 fail-closed, nada gravado;
 *  - pipeline DORMENTE: `fiscalEnabled` e `ConfiguracaoFiscalLoja` jamais são tocados;
 *  - GET expõe apenas provider/disponibilidade/capacidades (diagnóstico sanitizado).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { validTestPfx, expiredTestPfx, TEST_PFX_PRIVATE_KEY_PEM } from "@/lib/fiscal/vault/__fixtures__/make-test-pfx"
import { EnvVault } from "@/lib/fiscal/vault/env-vault"
import { assertNoSecretLeak } from "@/lib/fiscal/vault/secret-scan"

type Row = Record<string, unknown>

const STORE = "loja-1"
const CNPJ = "11222333000181"

const h = vi.hoisted(() => {
  const configs: Row[] = []
  const stores: Row[] = []
  const certs: Row[] = []
  const logs: Row[] = []
  const envVault: Record<string, string | undefined> = {}
  /** "write" = provider com escrita (teste) · "pilot" = só leitura · "off" = indisponível */
  let providerMode: "write" | "pilot" | "off" = "write"
  const chamadasConfig: string[] = []
  let seq = 0

  const prisma = {
    configuracaoFiscalLoja: {
      findUnique: async ({ where }: { where: { storeId: string } }) =>
        configs.find((c) => c.storeId === where.storeId) ?? null,
      upsert: async () => {
        chamadasConfig.push("upsert")
        throw new Error("ConfiguracaoFiscalLoja não pode ser tocada pela custódia")
      },
      update: async () => {
        chamadasConfig.push("update")
        throw new Error("ConfiguracaoFiscalLoja não pode ser tocada pela custódia")
      },
    },
    store: {
      findUnique: async ({ where }: { where: { id: string } }) => stores.find((s) => s.id === where.id) ?? null,
    },
    certificadoDigital: {
      findMany: async ({ where }: { where: { storeId: string } }) =>
        certs.filter((c) => c.storeId === where.storeId),
      findFirst: async ({ where }: { where: { fingerprint?: string; storeId?: string; NOT?: { storeId: string }; id?: string } }) => {
        if (where.NOT) {
          const r = certs.find((c) => c.fingerprint === where.fingerprint && c.storeId !== where.NOT!.storeId)
          return r ? { id: r.id as string } : null
        }
        if (where.id) return certs.find((c) => c.id === where.id && c.storeId === where.storeId) ?? null
        return certs.find((c) => c.storeId === where.storeId && c.fingerprint === where.fingerprint) ?? null
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `cert-${++seq}`, ...data }
        certs.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const i = certs.findIndex((c) => c.id === where.id)
        certs[i] = { ...certs[i], ...data }
        return certs[i]
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
    stores,
    certs,
    logs,
    envVault,
    chamadasConfig,
    setProviderMode: (m: "write" | "pilot" | "off") => {
      providerMode = m
    },
    getProviderMode: () => providerMode,
    reset: () => {
      configs.length = 0
      stores.length = 0
      certs.length = 0
      logs.length = 0
      chamadasConfig.length = 0
      for (const k of Object.keys(envVault)) delete envVault[k]
      providerMode = "write"
      seq = 0
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
      const mode = h.getProviderMode()
      if (mode === "off") {
        return {
          provider: "supabase_vault",
          vault: null,
          availability: {
            disponivel: false,
            backend: "supabase_vault",
            capacidades: { leitura: false, escrita: false, rotacao: false, revogacao: false },
            mensagem: "provider não implementado",
          },
        }
      }
      const allowWrite = mode === "write"
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

import { POST, GET } from "./route"

function seedLoja(cnpj: string | null = CNPJ) {
  h.configs.push({
    storeId: STORE,
    fiscalEnabled: false,
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    provider: "STUB",
    cscId: "",
    cscTokenRef: null,
    razaoSocial: "RAFACELL COMERCIO LTDA",
    nomeFantasia: "",
    cnpj: cnpj ?? "",
    inscricaoEstadual: "",
    inscricaoMunicipal: "",
    regimeTributario: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    codigoMunicipioIbge: "",
    municipio: "",
    uf: "",
    cep: "",
    fone: "",
    email: "",
    providerConfig: null,
  })
  h.stores.push({ id: STORE, name: "Matriz", cnpj: cnpj ?? "", phone: "", address: {} })
}

function requestComPfx(pfx: Buffer, senha: string, nome = "cert.pfx"): Request {
  const fd = new FormData()
  fd.append("certificado", new File([pfx], nome, { type: "application/x-pkcs12" }))
  fd.append("senha", senha)
  return new Request("http://localhost/api/fiscal/onboarding/certificado/custodia", { method: "POST", body: fd })
}

async function corpoJson(res: Response): Promise<Row> {
  return (await res.json()) as Row
}

beforeEach(() => {
  h.reset()
})

describe("POST custodia — caminho feliz", () => {
  it("grava o segredo SÓ no cofre, registra refs opacas e não vaza nada", async () => {
    seedLoja()
    const t = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    const j = await corpoJson(res)

    expect(res.status).toBe(200)
    expect(j.ok).toBe(true)
    expect(j.custodia).toMatchObject({ armazenada: true, provider: "env-piloto" })
    expect(j.transmissao).toBe("nenhuma")

    // Segredo foi parar APENAS no cofre (env mutável de teste).
    expect(h.envVault["FISCAL_A1_PFX_B64_LOJA_1"]).toBe(t.pfx.toString("base64"))
    expect(h.envVault["FISCAL_A1_SENHA_LOJA_1"]).toBe(t.senha)

    // Linha registrada com refs opacas, PENDENTE_VALIDACAO e inativa.
    expect(h.certs.length).toBe(1)
    const cert = h.certs[0]!
    expect(cert.blobRef).toBe("FISCAL_A1_PFX_B64_LOJA_1")
    expect(cert.senhaRef).toBe("FISCAL_A1_SENHA_LOJA_1")
    expect(cert.status).toBe("PENDENTE_VALIDACAO")
    expect(cert.ativo).toBe(false)
    expect(cert.fingerprint).toBe((j.certificado as Row).fingerprint)

    // Pipeline DORMENTE: config jamais tocada.
    expect(h.chamadasConfig).toEqual([])
    expect(h.configs[0]!.fiscalEnabled).toBe(false)

    // Auditoria registrada e sanitizada.
    expect(h.logs.map((l) => l.acao)).toContain("secret.set")
    expect(h.logs.map((l) => l.acao)).toContain("certificado.custodia.armazenar")

    // API SEM VAZAMENTO: resposta + auditoria + erros.
    const segredos = { senha: t.senha, pfxBytes: t.pfx, privateKeyPem: TEST_PFX_PRIVATE_KEY_PEM }
    assertNoSecretLeak(j, segredos, "resposta da custodia")
    assertNoSecretLeak(h.logs, segredos, "auditoria da custodia")
  })

  it("reenvio da mesma fingerprint atualiza a linha existente (sem duplicar)", async () => {
    seedLoja()
    const t = validTestPfx()
    const r1 = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    expect(r1.status).toBe(200)
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    expect(res.status).toBe(200)
    expect(h.certs.length).toBe(1) // mesma linha atualizada, sem duplicar
  })

  it("reenvio sobre linha REVOGADA ⇒ 409 (revogação é terminal) e cofre intacto", async () => {
    seedLoja()
    const t = validTestPfx()
    const r1 = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    expect(r1.status).toBe(200)
    // Revoga a linha (simulado) e tenta reenviar o mesmo certificado.
    h.certs[0]!.status = "REVOGADO"
    h.certs[0]!.ativo = false
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    const j = await corpoJson(res)
    expect(res.status).toBe(409)
    expect(j.codigo).toBe("certificado_revogado")
    expect(h.certs.length).toBe(1)
    expect(h.certs[0]!.status).toBe("REVOGADO") // NÃO ressuscitou
    // A guarda roda ANTES do cofre: nada novo foi gravado e o segredo anterior ficou preservado.
    expect(Object.keys(h.envVault).sort()).toEqual(["FISCAL_A1_PFX_B64_LOJA_1", "FISCAL_A1_SENHA_LOJA_1"])
    expect(h.envVault["FISCAL_A1_PFX_B64_LOJA_1"]).toBe(t.pfx.toString("base64"))
  })

  it("reenvio sobre certificado ATIVO ⇒ 409 orientando rotação e cofre intacto", async () => {
    seedLoja()
    const t = validTestPfx()
    const r1 = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    expect(r1.status).toBe(200)
    h.certs[0]!.status = "ATIVO"
    h.certs[0]!.ativo = true
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    const j = await corpoJson(res)
    expect(res.status).toBe(409)
    expect(j.codigo).toBe("certificado_ativo_use_rotacao")
    expect(h.certs[0]!.status).toBe("ATIVO") // não derrubou o certificado em uso
    // Guarda antes do cofre: o material em uso segue preservado, nada órfão.
    expect(Object.keys(h.envVault).sort()).toEqual(["FISCAL_A1_PFX_B64_LOJA_1", "FISCAL_A1_SENHA_LOJA_1"])
  })
})

describe("POST custodia — rejeições fail-closed", () => {
  it("CNPJ divergente da unidade ⇒ 422 ANTES do cofre (nada gravado)", async () => {
    seedLoja("99999999000199") // CNPJ da loja diferente do certificado
    const t = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    const j = await corpoJson(res)

    expect(res.status).toBe(422)
    expect((j.bloqueios as Row[]).map((b) => b.codigo)).toContain("cnpj_divergente")
    expect(h.certs.length).toBe(0)
    // Nada órfão no cofre.
    expect(Object.keys(h.envVault).length).toBe(0)
    assertNoSecretLeak(j, { senha: t.senha, pfxBytes: t.pfx }, "cnpj divergente")
  })

  it("fingerprint vinculada a OUTRA loja ⇒ 422 e nada gravado", async () => {
    seedLoja()
    const t = validTestPfx()
    // Precisamos da fingerprint real: grava primeiro na loja-2 com o mesmo arquivo.
    const { inspecionarCertificadoPfx } = await import("@/lib/fiscal/certificate")
    const insp = inspecionarCertificadoPfx({ pfx: Buffer.from(t.pfx), senha: t.senha })
    h.certs.push({
      id: "cert-outra",
      storeId: "loja-2",
      fingerprint: insp.extraido!.fingerprintSha1,
      ativo: true,
      status: "ATIVO",
      blobRef: "FISCAL_A1_PFX_B64_LOJA_2",
      senhaRef: "FISCAL_A1_SENHA_LOJA_2",
    })

    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    const j = await corpoJson(res)
    expect(res.status).toBe(422)
    expect((j.bloqueios as Row[]).map((b) => b.codigo)).toContain("certificado_de_outra_loja")
    expect(h.certs.filter((c) => c.storeId === STORE).length).toBe(0)
    expect(Object.keys(h.envVault).length).toBe(0)
  })

  it("certificado vencido ⇒ 422 sanitizado, cofre e banco intactos", async () => {
    seedLoja()
    const t = expiredTestPfx()
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    const j = await corpoJson(res)
    expect(res.status).toBe(422)
    expect((j.bloqueios as Row[]).map((b) => b.codigo)).toContain("certificado_vencido")
    expect(h.certs.length).toBe(0)
    expect(Object.keys(h.envVault).length).toBe(0)
    assertNoSecretLeak(j, { senha: t.senha, pfxBytes: t.pfx }, "vencido")
  })

  it("senha incorreta ⇒ 422 sanitizado, nada gravado", async () => {
    seedLoja()
    const t = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(t.pfx), "senha-errada-016c"))
    const j = await corpoJson(res)
    expect(res.status).toBe(422)
    expect((j.bloqueios as Row[]).map((b) => b.codigo)).toContain("senha_incorreta")
    expect(h.certs.length).toBe(0)
    expect(Object.keys(h.envVault).length).toBe(0)
    assertNoSecretLeak(j, { senha: t.senha, pfxBytes: t.pfx }, "senha incorreta")
  })

  it("provider sem escrita (piloto) ⇒ 503 fail-closed, nada gravado", async () => {
    seedLoja()
    h.setProviderMode("pilot")
    const t = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    const j = await corpoJson(res)
    expect(res.status).toBe(503)
    expect(j.codigo).toBe("custodia_indisponivel")
    expect(h.certs.length).toBe(0)
    expect(Object.keys(h.envVault).length).toBe(0)
    expect(h.logs.map((l) => l.acao)).toContain("certificado.custodia.indisponivel")
    assertNoSecretLeak(j, { senha: t.senha, pfxBytes: t.pfx }, "503")
  })

  it("provider indisponível ⇒ 503 fail-closed", async () => {
    seedLoja()
    h.setProviderMode("off")
    const t = validTestPfx()
    const res = await POST(requestComPfx(Buffer.from(t.pfx), t.senha))
    expect(res.status).toBe(503)
    expect(h.certs.length).toBe(0)
  })

  it("arquivo ausente / senha ausente ⇒ 400 sem processar", async () => {
    seedLoja()
    const fd = new FormData()
    fd.append("senha", "x")
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: fd }))
    expect(res.status).toBe(400)
    expect(Object.keys(h.envVault).length).toBe(0)
  })
})

describe("GET custodia — diagnóstico sanitizado", () => {
  it("expõe apenas provider, disponibilidade e capacidades", async () => {
    const res = await GET(new Request("http://localhost/api", { method: "GET" }))
    const j = await corpoJson(res)
    expect(res.status).toBe(200)
    expect(j.custodia).toMatchObject({ provider: "env-piloto", disponivel: true })
    expect((j.custodia as Row).capacidades).toMatchObject({ leitura: true, escrita: true })
    assertNoSecretLeak(j, {}, "GET custodia")
  })
})
