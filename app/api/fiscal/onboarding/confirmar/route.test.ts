/**
 * GOAL-016B (corretivo) — POST /api/fiscal/onboarding/confirmar sobre Prisma EM MEMÓRIA.
 *
 * Exercita o handler de PRODUÇÃO. Prova, no ponto real de gravação:
 *  - sem custódia (blobRef/senhaRef ausentes) NENHUM CertificadoDigital é criado ou ativado;
 *  - a identidade fiscal é gravada mesmo assim, separadamente;
 *  - a auditoria usa a ação sanitizada `identidade_importada_certificado_custodia_pendente`;
 *  - `fiscalEnabled` permanece false e provider/CSC não mudam;
 *  - a consulta cross-store por fingerprint pede só `{ id: true }` e vira booleano;
 *  - nenhum segredo entra em resposta ou auditoria; nenhuma chamada de rede acontece.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"

type Row = Record<string, unknown>

const STORE = "loja-1"
const OUTRA_LOJA = "loja-2"
const CNPJ = "11222333000181"
const FINGERPRINT = "aa".repeat(20)

const h = vi.hoisted(() => {
  const configs: Record<string, unknown>[] = []
  const stores: Record<string, unknown>[] = []
  const certs: Record<string, unknown>[] = []
  const logs: Record<string, unknown>[] = []
  /** Registra os `select` usados na consulta que cruza lojas (prova do "somente booleano"). */
  const crossStoreSelects: unknown[] = []
  let seq = 0

  const prisma = {
    configuracaoFiscalLoja: {
      findUnique: async ({ where }: { where: { storeId: string } }) =>
        configs.find((c) => c.storeId === where.storeId) ?? null,
      upsert: async ({ where, create, update }: { where: { storeId: string }; create: Row; update: Row }) => {
        const i = configs.findIndex((c) => c.storeId === where.storeId)
        if (i >= 0) {
          configs[i] = { ...configs[i], ...update }
          return configs[i]
        }
        const row = { id: `cfg-${++seq}`, fiscalEnabled: false, codigoPais: "1058", certificadoAtivoId: null, ...create }
        configs.push(row)
        return row
      },
    },
    store: {
      findUnique: async ({ where }: { where: { id: string } }) => stores.find((s) => s.id === where.id) ?? null,
    },
    certificadoDigital: {
      findMany: async ({ where }: { where: { storeId: string } }) =>
        certs.filter((c) => c.storeId === where.storeId),
      findFirst: async ({
        where,
        select,
      }: {
        where: { fingerprint?: string; storeId?: string; NOT?: { storeId: string } }
        select?: unknown
      }) => {
        if (where.NOT) {
          crossStoreSelects.push(select)
          const r = certs.find((c) => c.fingerprint === where.fingerprint && c.storeId !== where.NOT!.storeId)
          return r ? { id: r.id as string } : null
        }
        return certs.find((c) => c.storeId === where.storeId && c.fingerprint === where.fingerprint) ?? null
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const i = certs.findIndex((c) => c.id === where.id)
        certs[i] = { ...certs[i], ...data }
        return certs[i]
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `cert-${++seq}`, ...data }
        certs.push(row)
        return row
      },
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
    crossStoreSelects,
    reset: () => {
      configs.length = 0
      stores.length = 0
      certs.length = 0
      logs.length = 0
      crossStoreSelects.length = 0
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

import { POST } from "./route"

const CERTIFICADO_LIDO = {
  cnpj: CNPJ,
  titularCn: `RAFACELL COMERCIO LTDA:${CNPJ}`,
  subject: `CN=RAFACELL COMERCIO LTDA:${CNPJ}`,
  nomeEmpresarial: "RAFACELL COMERCIO LTDA",
  email: "fiscal@rafacell.test",
  validoDe: new Date(Date.now() - 86_400_000).toISOString(),
  validoAte: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  autoridadeCertificadora: "AC TESTE RFB v5",
  serialNumber: "0a1b2c3d",
  fingerprintSha1: FINGERPRINT,
  cadeiaDisponivel: true,
  vigente: true,
  chavePublicaRsaBits: 2048,
}

function postReq(body: Record<string, unknown>) {
  return new Request("http://local/api/fiscal/onboarding/confirmar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-assistec-loja-id": STORE },
    body: JSON.stringify(body),
  })
}

function semearLoja() {
  h.stores.push({
    id: STORE,
    name: "Rafacell Matriz",
    cnpj: CNPJ,
    phone: "1140028922",
    address: { rua: "Rua das Flores", numero: "100", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01001000" },
  })
  h.configs.push({
    id: "cfg-seed",
    storeId: STORE,
    fiscalEnabled: false,
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    provider: "STUB_HOMOLOGACAO",
    cscId: "",
    cscTokenRef: null,
    codigoPais: "1058",
    certificadoAtivoId: null,
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: CNPJ,
    inscricaoEstadual: "",
    inscricaoMunicipal: "",
    regimeTributario: "SIMPLES_NACIONAL",
    crt: 1,
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
}

beforeEach(() => {
  h.reset()
  semearLoja()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("POST confirmar · sem custódia (blobRef/senhaRef ausentes)", () => {
  it("grava a identidade fiscal e NÃO cria nenhum CertificadoDigital", async () => {
    const res = await POST(postReq({ certificado: CERTIFICADO_LIDO, campos: { nomeFantasia: "Loja do Centro" } }))
    const j = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(j.ok).toBe(true)
    expect(j.identidadeSalva).toBe(true)

    // Identidade salva de fato, com os dados do certificado.
    const cfg = h.configs.find((c) => c.storeId === STORE)!
    expect(cfg.razaoSocial).toBe("RAFACELL COMERCIO LTDA")
    expect(cfg.nomeFantasia).toBe("Loja do Centro")
    expect(cfg.cnpj).toBe(CNPJ)

    // Nenhum certificado fantasma.
    expect(h.certs).toHaveLength(0)
    expect(j.certificado).toBeNull()
    expect(j.certificadoArmazenado).toBe(false)
    expect(j.certificadoAtivo).toBe(false)
  })

  it("responde com custódia pendente e a mensagem de reenvio", async () => {
    const res = await POST(postReq({ certificado: CERTIFICADO_LIDO }))
    const j = (await res.json()) as { custodia?: { pendente?: boolean; mensagem?: string } }

    expect(j.custodia?.pendente).toBe(true)
    expect(j.custodia?.mensagem).toContain("não foi armazenado")
    expect(j.custodia?.mensagem).toContain("reenviar o certificado")
  })

  it("audita com a ação sanitizada identidade_importada_certificado_custodia_pendente", async () => {
    await POST(postReq({ certificado: CERTIFICADO_LIDO }))

    const log = h.logs.at(-1) as Row
    expect(log.acao).toBe("identidade_importada_certificado_custodia_pendente")
    expect(log.storeId).toBe(STORE)
    const detalhe = log.detalhe as Row
    expect(detalhe.certificadoArmazenado).toBe(false)
    expect(detalhe.certificadoAtivo).toBe(false)
    expect(detalhe.custodiaPendente).toBe(true)
    expect(detalhe.certificadoId).toBeNull()
    // A mensagem não pode sugerir instalação/conclusão.
    expect(String(log.mensagem)).not.toMatch(/instalado|conclu[ií]d/i)
  })

  it("fiscalEnabled permanece false e provider/CSC não são alterados", async () => {
    const res = await POST(postReq({ certificado: CERTIFICADO_LIDO }))
    const j = (await res.json()) as { fiscalEnabled?: boolean; transmissao?: string }

    expect(j.fiscalEnabled).toBe(false)
    expect(j.transmissao).toBe("nenhuma")

    const cfg = h.configs.find((c) => c.storeId === STORE)!
    expect(cfg.fiscalEnabled).toBe(false)
    expect(cfg.provider).toBe("STUB_HOMOLOGACAO")
    expect(cfg.ambiente).toBe("HOMOLOGACAO")
    expect(cfg.modeloFiscal).toBe("NFCE")
    expect(cfg.cscId).toBe("")
    expect(cfg.cscTokenRef).toBeNull()
  })

  it("uma linha só de metadados já existente NÃO é reaproveitada nem ativada", async () => {
    h.certs.push({
      id: "cert-fantasma",
      storeId: STORE,
      fingerprint: FINGERPRINT,
      status: "PENDENTE_VALIDACAO",
      ativo: false,
      blobRef: null,
      senhaRef: null,
      apelido: "antigo",
    })

    const res = await POST(postReq({ certificado: CERTIFICADO_LIDO }))
    const j = (await res.json()) as Record<string, unknown>

    expect(j.certificadoArmazenado).toBe(false)
    expect(j.certificado).toBeNull()
    const fantasma = h.certs.find((c) => c.id === "cert-fantasma")!
    expect(fantasma.ativo).toBe(false)
    expect(fantasma.apelido).toBe("antigo") // intocado
    expect(fantasma.blobRef).toBeNull()
  })
})

describe("POST confirmar · com custódia já configurada", () => {
  beforeEach(() => {
    h.certs.push({
      id: "cert-com-cofre",
      storeId: STORE,
      fingerprint: FINGERPRINT,
      status: "PENDENTE_VALIDACAO",
      ativo: false,
      blobRef: "FISCAL_A1_PFX_B64_LOJA_1",
      senhaRef: "FISCAL_A1_SENHA_LOJA_1",
      apelido: "antigo",
    })
  })

  it("atualiza apenas os metadados e continua NÃO ativando o certificado", async () => {
    const res = await POST(postReq({ certificado: CERTIFICADO_LIDO, apelido: "Certificado da matriz" }))
    const j = (await res.json()) as Record<string, unknown>

    expect(j.certificadoArmazenado).toBe(true)
    expect(j.certificadoAtivo).toBe(false)

    const cert = h.certs.find((c) => c.id === "cert-com-cofre")!
    expect(cert.apelido).toBe("Certificado da matriz")
    expect(cert.titularCn).toBe(CERTIFICADO_LIDO.titularCn)
    expect(cert.ativo).toBe(false) // a ativação continua sendo ato administrativo separado
    expect(cert.status).toBe("PENDENTE_VALIDACAO")
    expect(h.certs).toHaveLength(1) // não duplicou
  })

  it("audita como confirmação de onboarding (não como importação sem custódia)", async () => {
    await POST(postReq({ certificado: CERTIFICADO_LIDO }))
    const log = h.logs.at(-1) as Row
    expect(log.acao).toBe("certificado.onboarding.confirmar")
    expect((log.detalhe as Row).custodiaPendente).toBe(false)
  })
})

describe("POST confirmar · bloqueios continuam fail-closed", () => {
  it("CNPJ divergente ⇒ 422, sem gravar identidade nem certificado", async () => {
    const res = await POST(postReq({ certificado: { ...CERTIFICADO_LIDO, cnpj: "45723174000110" } }))
    expect(res.status).toBe(422)

    const cfg = h.configs.find((c) => c.storeId === STORE)!
    expect(cfg.razaoSocial).toBe("") // nada foi gravado
    expect(h.certs).toHaveLength(0)
  })

  it("certificado vencido declarado ⇒ 422 mesmo com vigente=true forjado", async () => {
    const res = await POST(
      postReq({
        certificado: {
          ...CERTIFICADO_LIDO,
          validoDe: new Date(Date.now() - 800 * 86_400_000).toISOString(),
          validoAte: new Date(Date.now() - 10 * 86_400_000).toISOString(),
          vigente: true,
        },
      }),
    )
    expect(res.status).toBe(422)
    expect(h.certs).toHaveLength(0)
  })

  it("fingerprint vinculada a outra unidade ⇒ 422 e a consulta cross-store pede só { id: true }", async () => {
    h.certs.push({
      id: "cert-outra-loja",
      storeId: OUTRA_LOJA,
      fingerprint: FINGERPRINT,
      status: "ATIVO",
      ativo: true,
      blobRef: "FISCAL_A1_PFX_B64_LOJA_2",
      senhaRef: "FISCAL_A1_SENHA_LOJA_2",
    })

    const res = await POST(postReq({ certificado: CERTIFICADO_LIDO }))
    const j = (await res.json()) as { bloqueios?: { codigo: string }[] }

    expect(res.status).toBe(422)
    expect(j.bloqueios?.map((b) => b.codigo)).toContain("certificado_de_outra_loja")

    // Só o id é selecionado — nenhum dado da outra loja atravessa a fronteira.
    expect(h.crossStoreSelects).toHaveLength(1)
    expect(h.crossStoreSelects[0]).toEqual({ id: true })
    // E nada da outra loja aparece na resposta.
    expect(JSON.stringify(j)).not.toContain("FISCAL_A1_PFX_B64_LOJA_2")
    expect(JSON.stringify(j)).not.toContain(OUTRA_LOJA)
  })
})

describe("POST confirmar · zero segredo e zero transmissão", () => {
  it("campos de segredo enviados por engano são descartados e não aparecem na resposta nem na auditoria", async () => {
    const SENHA = "SENHA-DO-PFX-SUPER-SECRETA"
    const PFX_B64 = "MIIKZgIBAzCCCiwGCSqGSIb3DQEHAaCCCh0EggoZ"

    const res = await POST(
      postReq({
        certificado: { ...CERTIFICADO_LIDO, senha: SENHA, pfxBase64: PFX_B64, privateKeyPem: "-----BEGIN PRIVATE KEY-----" },
        senha: SENHA,
        pfxBase64: PFX_B64,
      }),
    )
    const texto = await res.text()

    expect(res.status).toBe(200)
    expect(texto).not.toContain(SENHA)
    expect(texto).not.toContain(PFX_B64)
    expect(texto).not.toContain("PRIVATE KEY")

    const tudoAuditado = JSON.stringify(h.logs)
    expect(tudoAuditado).not.toContain(SENHA)
    expect(tudoAuditado).not.toContain(PFX_B64)
    expect(tudoAuditado).not.toContain("PRIVATE KEY")

    // E o segredo tampouco foi parar no banco.
    const tudoPersistido = JSON.stringify({ configs: h.configs, certs: h.certs })
    expect(tudoPersistido).not.toContain(SENHA)
    expect(tudoPersistido).not.toContain(PFX_B64)
  })

  it("a confirmação não faz nenhuma chamada de rede", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await POST(postReq({ certificado: CERTIFICADO_LIDO }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
