/**
 * GOAL-016C — PATCH /api/fiscal/certificado/[id], fluxo de REVOGAÇÃO, sobre Prisma EM MEMÓRIA.
 *
 * Correções da 3ª revisão independente (`FISCAL-PR33-CONDITIONS-CORRECTION-002`). Prova:
 *  - a revogação LÓGICA (status REVOGADO + inativo + `certificadoAtivoId` limpo) é SEMPRE aplicada,
 *    independentemente do provider — é ela que garante o fail-closed da assinatura;
 *  - a capacidade `revogacao` do provider é consultada para RELATAR, nunca para bloquear;
 *  - provider sem revogação ⇒ a resposta NÃO afirma remoção física;
 *  - referência compartilhada por outra linha viva ⇒ material NÃO é removido e NENHUMA orientação
 *    de exclusão manual é emitida;
 *  - certificado revogado não pode ser reativado (terminal);
 *  - erro interno responde texto fixo + código estável, sem `e.message` do Prisma;
 *  - pipeline DORMENTE: `fiscalEnabled` jamais escrito.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { EnvVault } from "@/lib/fiscal/vault/env-vault"
import { assertNoSecretLeak } from "@/lib/fiscal/vault/secret-scan"

type Row = Record<string, unknown>

const STORE = "loja-1"
const BLOB_REF = "FISCAL_A1_PFX_B64_LOJA_1"
const SENHA_REF = "FISCAL_A1_SENHA_LOJA_1"

const h = vi.hoisted(() => {
  const configs: Row[] = []
  const certs: Row[] = []
  const logs: Row[] = []
  const envVault: Record<string, string | undefined> = {}
  /** "write" = provider revoga · "pilot" = só leitura · "off" = provider indisponível */
  let providerMode: "write" | "pilot" | "off" = "pilot"
  /** Quando setado, a transação de revogação explode com uma mensagem "de Prisma". */
  let erroNaTransacao: string | null = null

  /**
   * Projeta como o Prisma real: só os campos pedidos em `select`. Sem isto o mock devolveria a
   * linha inteira (inclusive `blobRef`/`senhaRef`) e esconderia um alargamento de projeção na rota.
   */
  const projetar = (row: Row | undefined, select?: Record<string, boolean>): Row | null => {
    if (!row) return null
    if (!select) return row
    return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]))
  }

  const certificadoDigital = {
    findFirst: async ({ where, select }: { where: { id?: string; storeId?: string }; select?: Record<string, boolean> }) =>
      projetar(
        certs.find((c) => c.id === where.id && c.storeId === where.storeId),
        select,
      ),
    findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) =>
      projetar(
        certs.find((c) => c.id === where.id),
        select,
      ),
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const i = certs.findIndex((c) => c.id === where.id)
      certs[i] = { ...certs[i], ...data }
      return certs[i]
    },
    updateMany: async () => ({ count: 0 }),
    /** Conta linhas vivas da unidade que ainda apontam para as mesmas refs (OR de blobRef/senhaRef). */
    count: async ({ where }: { where: Row }) => {
      const w = where as {
        storeId: string
        id: { not: string }
        status: { not: string }
        OR: Array<{ blobRef?: string; senhaRef?: string }>
      }
      return certs.filter(
        (c) =>
          c.storeId === w.storeId &&
          c.id !== w.id.not &&
          c.status !== w.status.not &&
          w.OR.some((o) => (o.blobRef && c.blobRef === o.blobRef) || (o.senhaRef && c.senhaRef === o.senhaRef)),
      ).length
    },
  }

  const configuracaoFiscalLoja = {
    findUnique: async ({ where }: { where: { storeId: string } }) =>
      configs.find((c) => c.storeId === where.storeId) ?? null,
    update: async ({ where, data }: { where: { storeId: string }; data: Row }) => {
      const i = configs.findIndex((c) => c.storeId === where.storeId)
      // Guarda de dormência: a rota só pode mexer no ponteiro do certificado ativo.
      for (const k of Object.keys(data)) {
        if (k !== "certificadoAtivoId") throw new Error(`campo proibido na config: ${k}`)
      }
      configs[i] = { ...configs[i], ...data }
      return configs[i]
    },
  }

  const prisma = {
    certificadoDigital,
    configuracaoFiscalLoja,
    fiscalLog: {
      create: async ({ data }: { data: Row }) => {
        logs.push(data)
        return data
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (erroNaTransacao) throw new Error(erroNaTransacao)
      return fn({ certificadoDigital, configuracaoFiscalLoja })
    },
  }

  return {
    prisma,
    configs,
    certs,
    logs,
    envVault,
    setProviderMode: (m: "write" | "pilot" | "off") => {
      providerMode = m
    },
    getProviderMode: () => providerMode,
    setErroNaTransacao: (msg: string | null) => {
      erroNaTransacao = msg
    },
    reset: () => {
      configs.length = 0
      certs.length = 0
      logs.length = 0
      for (const k of Object.keys(envVault)) delete envVault[k]
      providerMode = "pilot"
      erroNaTransacao = null
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
      return {
        provider: "env-piloto",
        vault: new EnvVault({ env: h.envVault, allowWrite }),
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

import { PATCH } from "./route"

function seedCert(overrides: Row = {}): void {
  h.certs.push({
    id: "cert-1",
    storeId: STORE,
    apelido: "Certificado da matriz",
    status: "ATIVO",
    ativo: true,
    blobRef: BLOB_REF,
    senhaRef: SENHA_REF,
    ...overrides,
  })
}

function seedConfig(): void {
  h.configs.push({ storeId: STORE, fiscalEnabled: false, certificadoAtivoId: "cert-1" })
}

function seedMaterial(): void {
  h.envVault[BLOB_REF] = "material-em-custodia"
  h.envVault[SENHA_REF] = "senha-em-custodia"
}

function req(body: Row): Request {
  return new Request("http://localhost/api/fiscal/certificado/cert-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

function ctx(id = "cert-1") {
  return { params: Promise.resolve({ id }) }
}

async function corpo(res: Response): Promise<Row> {
  return (await res.json()) as Row
}

beforeEach(() => {
  h.reset()
})

describe("PATCH revogar — revogação lógica é sempre aplicada", () => {
  it("marca REVOGADO + inativo e limpa certificadoAtivoId, mesmo com provider dormente", async () => {
    seedCert()
    seedConfig()
    seedMaterial()

    const res = await PATCH(req({ revogar: true }), ctx())
    const j = await corpo(res)

    expect(res.status).toBe(200)
    expect(j.ok).toBe(true)
    expect(h.certs[0]!.status).toBe("REVOGADO")
    expect(h.certs[0]!.ativo).toBe(false)
    expect(h.configs[0]!.certificadoAtivoId).toBeNull()
    // Dormência preservada.
    expect(h.configs[0]!.fiscalEnabled).toBe(false)
  })

  it("certificado revogado não pode ser reativado — a revogação é durável (409)", async () => {
    seedCert()
    seedConfig()
    const rev = await PATCH(req({ revogar: true }), ctx())
    expect(rev.status).toBe(200)

    const res = await PATCH(req({ ativo: true }), ctx())
    const j = await corpo(res)
    expect(res.status).toBe(409)
    expect(j.codigo).toBe("certificado_revogado")
    // Continua bloqueado para assinatura: inativo e terminal.
    expect(h.certs[0]!.ativo).toBe(false)
    expect(h.certs[0]!.status).toBe("REVOGADO")
  })

  it("revogar duas vezes ⇒ 409 na segunda", async () => {
    seedCert()
    seedConfig()
    expect((await PATCH(req({ revogar: true }), ctx())).status).toBe(200)
    expect((await PATCH(req({ revogar: true }), ctx())).status).toBe(409)
  })
})

describe("PATCH revogar — honestidade sobre a remoção FÍSICA do material", () => {
  it("provider sem revogação ⇒ não afirma remoção; material segue no cofre", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    h.setProviderMode("pilot")

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    const revogacao = j.revogacao as Row

    expect(revogacao.logica).toBe("aplicada")
    expect(revogacao.remocaoFisica).toBe("nao_executada_provider_sem_revogacao")
    // A prova material: o segredo NÃO saiu do cofre.
    expect(h.envVault[BLOB_REF]).toBe("material-em-custodia")
    // A orientação não pode afirmar remoção.
    expect(String(revogacao.orientacao)).not.toMatch(/foi removido/i)
    expect(String(revogacao.orientacao)).toMatch(/não remove material do cofre em runtime/i)
  })

  it("provider indisponível (vault null) ⇒ mesmo tratamento honesto", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    h.setProviderMode("off")

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    expect((j.revogacao as Row).remocaoFisica).toBe("nao_executada_provider_sem_revogacao")
    expect(h.certs[0]!.status).toBe("REVOGADO")
  })

  it("provider que revoga e ref exclusiva ⇒ remoção executada de fato", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    h.setProviderMode("write")

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    expect((j.revogacao as Row).remocaoFisica).toBe("executada")
    // Material efetivamente destruído.
    expect(h.envVault[BLOB_REF]).toBeUndefined()
    expect(h.envVault[SENHA_REF]).toBeUndefined()
  })

  it("linha sem refs ⇒ 'nao_aplicavel' (não havia material a remover)", async () => {
    seedCert({ blobRef: null, senhaRef: null })
    seedConfig()
    h.setProviderMode("write")

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    expect((j.revogacao as Row).remocaoFisica).toBe("nao_aplicavel")
  })
})

describe("PATCH revogar — referência compartilhada (slot canônico por loja)", () => {
  /** Outra linha VIVA da unidade apontando para o MESMO material — caso normal do EnvVault. */
  function seedOutraLinhaViva() {
    h.certs.push({
      id: "cert-2",
      storeId: STORE,
      apelido: "Outro certificado da matriz",
      status: "ATIVO",
      ativo: true,
      blobRef: BLOB_REF,
      senhaRef: SENHA_REF,
    })
  }

  it("provider que revoga NÃO destrói material ainda usado por outra linha viva", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    seedOutraLinhaViva()
    h.setProviderMode("write") // provider COM capacidade de revogar

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    const revogacao = j.revogacao as Row

    expect(revogacao.refCompartilhada).toBe(true)
    expect(revogacao.remocaoFisica).toBe("nao_executada_ref_compartilhada")
    // PROVA CENTRAL: o certificado que continua ativo não perdeu o material.
    expect(h.envVault[BLOB_REF]).toBe("material-em-custodia")
    expect(h.envVault[SENHA_REF]).toBe("senha-em-custodia")
    // E a linha alvo foi revogada assim mesmo.
    expect(h.certs[0]!.status).toBe("REVOGADO")
    expect(h.certs.find((c) => c.id === "cert-2")!.ativo).toBe(true)
  })

  it("orientação NUNCA manda apagar secret quando a ref é compartilhada", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    seedOutraLinhaViva()

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    const orientacao = String((j.revogacao as Row).orientacao)

    expect(orientacao).toMatch(/não remova o secret manualmente/i)
    // Nada de instrução de exclusão manual nem nome de referência exposto.
    expect(orientacao).not.toMatch(/remova a env/i)
    expect(orientacao).not.toContain(BLOB_REF)
    expect(orientacao).not.toContain(SENHA_REF)
    expect(JSON.stringify(j)).not.toContain(BLOB_REF)
  })

  it("outra linha JÁ REVOGADA não conta como compartilhamento", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    h.certs.push({
      id: "cert-morto",
      storeId: STORE,
      status: "REVOGADO",
      ativo: false,
      blobRef: BLOB_REF,
      senhaRef: SENHA_REF,
    })
    h.setProviderMode("write")

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    expect((j.revogacao as Row).refCompartilhada).toBe(false)
    expect((j.revogacao as Row).remocaoFisica).toBe("executada")
  })

  it("linha de OUTRA loja com a mesma ref não conta como compartilhamento", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    h.certs.push({
      id: "cert-loja-2",
      storeId: "loja-2",
      status: "ATIVO",
      ativo: true,
      blobRef: BLOB_REF,
      senhaRef: SENHA_REF,
    })
    h.setProviderMode("write")

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))
    expect((j.revogacao as Row).refCompartilhada).toBe(false)
  })
})

describe("PATCH — erro interno sanitizado", () => {
  it("falha do Prisma não vaza `e.message` para o cliente", async () => {
    seedCert()
    seedConfig()
    const mensagemInterna =
      'Invalid `prisma.certificadoDigital.update()` invocation: column "blobRef" violates constraint'
    h.setErroNaTransacao(mensagemInterna)

    const res = await PATCH(req({ revogar: true }), ctx())
    const j = await corpo(res)

    expect(res.status).toBe(500)
    expect(j.codigo).toBe("erro_inesperado")
    expect(j.error).toBe("Falha ao atualizar certificado.")
    // Nada do detalhe interno atravessa a fronteira HTTP.
    const serializado = JSON.stringify(j)
    expect(serializado).not.toContain("prisma")
    expect(serializado).not.toContain("constraint")
    expect(serializado).not.toContain("blobRef")
  })

  it("certificado de outra unidade ⇒ 404 genérico", async () => {
    seedCert({ storeId: "loja-2" })
    const res = await PATCH(req({ revogar: true }), ctx())
    expect(res.status).toBe(404)
  })
})

describe("PATCH revogar — auditoria e ausência de vazamento", () => {
  it("registra certificado.revogar + secret.revoke sem afirmar remoção não executada", async () => {
    seedCert()
    seedConfig()
    seedMaterial()
    h.setProviderMode("pilot")

    const j = await corpo(await PATCH(req({ revogar: true }), ctx()))

    const acoes = h.logs.map((l) => l.acao)
    expect(acoes).toContain("certificado.revogar")
    expect(acoes).toContain("secret.revoke")

    const secretLog = h.logs.find((l) => l.acao === "secret.revoke")!
    expect(String(secretLog.mensagem)).toMatch(/remoção física do material NÃO executada/i)
    expect((secretLog.detalhe as Row).remocaoFisica).toBe("nao_executada_provider_sem_revogacao")
    expect((secretLog.detalhe as Row).providerRevoga).toBe(false)

    assertNoSecretLeak(
      { resposta: j, logs: h.logs },
      { senha: "senha-em-custodia", pfxBytes: Buffer.from("material-em-custodia") },
      "revogação",
    )
  })
})
