/**
 * GOAL-016D-A0 — resolver do certificado ativo por loja (ADR-0020).
 *
 * Prova: isolamento por `storeId` (query combinada id+storeId, sem existence oracle), todos os
 * estados terminais/inativos, validade temporal com relógio injetado, referências ausentes,
 * Secret Provider indisponível, ZERO leitura de segredo no cofre, ZERO escrita Prisma, e ZERO
 * vazamento de `blobRef`/`senhaRef` nas mensagens de falha.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  certFindFirst: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    configuracaoFiscalLoja: { findUnique: db.configFindUnique },
    certificadoDigital: { findFirst: db.certFindFirst },
  },
}))

import { assertNoSecretLeak, EnvVault, ENV_VAULT_BACKEND, PROVIDER_SUPABASE_VAULT } from "@/lib/fiscal/vault"
import type { CertificadoStatus } from "@/generated/prisma"
import { resolveActiveCertificate } from "./resolve-active-certificate"

const STORE_A = "store-a"
const CERT_ID = "cert-1"
const AGORA = new Date("2026-08-04T12:00:00.000Z")
const NO_PASSADO = new Date("2026-01-01T00:00:00.000Z")
const NO_FUTURO = new Date("2026-12-31T23:59:59.000Z")

const BLOB_REF_SENTINELA = "FISCAL_A1_PFX_B64_STORE_A_SENTINELA"
const SENHA_REF_SENTINELA = "FISCAL_A1_SENHA_STORE_A_SENTINELA"

type CertificadoDigitalFixture = {
  status: CertificadoStatus
  ativo: boolean
  validoDe: Date | null
  validoAte: Date | null
  blobRef: string | null
  senhaRef: string | null
}

/** Linha padrão de certificado válido — cada teste sobrescreve só o campo em questão. */
function certificadoValido(overrides: Partial<CertificadoDigitalFixture> = {}): CertificadoDigitalFixture {
  return {
    status: "ATIVO",
    ativo: true,
    validoDe: NO_PASSADO,
    validoAte: NO_FUTURO,
    blobRef: BLOB_REF_SENTINELA,
    senhaRef: SENHA_REF_SENTINELA,
    ...overrides,
  }
}

beforeEach(() => {
  db.configFindUnique.mockReset()
  db.certFindFirst.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("resolveActiveCertificate — caminho feliz", () => {
  it("resolve blobRef/senhaRef opacos mesmo com fiscalEnabled=false (não é condição de sucesso)", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido())

    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })

    expect(r).toEqual({
      ok: true,
      storeId: STORE_A,
      certificadoId: CERT_ID,
      blobRef: BLOB_REF_SENTINELA,
      senhaRef: SENHA_REF_SENTINELA,
      provider: ENV_VAULT_BACKEND,
    })
  })

  it("select mínimo: configuracaoFiscalLoja não inclui fiscalEnabled; certificado é buscado por id+storeId combinados", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido())

    await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })

    expect(db.configFindUnique).toHaveBeenCalledWith({
      where: { storeId: STORE_A },
      select: { certificadoAtivoId: true },
    })
    expect(db.certFindFirst).toHaveBeenCalledWith({
      where: { id: CERT_ID, storeId: STORE_A },
      select: { status: true, ativo: true, validoDe: true, validoAte: true, blobRef: true, senhaRef: true },
    })
  })

  it("validoDe ausente não bloqueia (a regra só vale 'quando presente')", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoDe: null }))

    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r.ok).toBe(true)
  })
})

describe("resolveActiveCertificate — storeId inválido", () => {
  it.each(["", "   "])("storeId %j ⇒ store_id_invalido, sem tocar o banco", async (storeId) => {
    const r = await resolveActiveCertificate({ storeId, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "store_id_invalido", mensagem: expect.any(String) })
    expect(db.configFindUnique).not.toHaveBeenCalled()
    expect(db.certFindFirst).not.toHaveBeenCalled()
  })

  it("storeId não-string (contorna o tipo em runtime) ⇒ store_id_invalido, nunca coagido para a query", async () => {
    const storeIdForjado = { toString: () => "loja-injetada" } as unknown as string
    const r = await resolveActiveCertificate({ storeId: storeIdForjado, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "store_id_invalido", mensagem: expect.any(String) })
    expect(db.configFindUnique).not.toHaveBeenCalled()
  })
})

describe("resolveActiveCertificate — configuração fiscal ausente", () => {
  it("ConfiguracaoFiscalLoja não encontrada ⇒ configuracao_fiscal_ausente", async () => {
    db.configFindUnique.mockResolvedValueOnce(null)
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "configuracao_fiscal_ausente", mensagem: expect.any(String) })
    expect(db.certFindFirst).not.toHaveBeenCalled()
  })
})

describe("resolveActiveCertificate — certificadoAtivoId não configurado", () => {
  it.each([null, "", "   "])("certificadoAtivoId %j ⇒ certificado_ativo_nao_configurado", async (certificadoAtivoId) => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId })
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_ativo_nao_configurado", mensagem: expect.any(String) })
    expect(db.certFindFirst).not.toHaveBeenCalled()
  })
})

describe("resolveActiveCertificate — isolamento por loja: sem existence oracle", () => {
  it("certificado inexistente e certificado de outra loja produzem o MESMO código e a MESMA mensagem", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(null) // inexistente
    const inexistente = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })

    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    // Query real com where:{id,storeId} combinado devolveria null para um certificado de outra loja.
    db.certFindFirst.mockResolvedValueOnce(null) // de outra loja
    const outraLoja = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })

    expect(inexistente).toEqual({ ok: false, codigo: "certificado_ativo_indisponivel", mensagem: expect.any(String) })
    expect(outraLoja).toEqual(inexistente)
  })

  it("a query do certificado sempre combina id + storeId — nunca busca só por id", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(null)
    await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    const args = db.certFindFirst.mock.calls[0][0]
    expect(args.where).toEqual({ id: CERT_ID, storeId: STORE_A })
  })
})

describe("resolveActiveCertificate — estados inativos/terminais", () => {
  it("ativo=false ⇒ certificado_inativo", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ ativo: false }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_inativo", mensagem: expect.any(String) })
  })

  it("status PENDENTE_VALIDACAO ⇒ certificado_inativo", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "PENDENTE_VALIDACAO", ativo: false }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_inativo", mensagem: expect.any(String) })
  })

  it("status INVALIDO ⇒ certificado_inativo (mesmo com ativo=true, defensivo)", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "INVALIDO", ativo: true }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_inativo", mensagem: expect.any(String) })
  })

  it("status REVOGADO ⇒ certificado_revogado (estado terminal, prioridade sobre outros códigos)", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "REVOGADO", ativo: false }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_revogado", mensagem: expect.any(String) })
  })

  it("status EXPIRADO (persistido) ⇒ certificado_expirado", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "EXPIRADO" }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_expirado", mensagem: expect.any(String) })
  })
})

describe("resolveActiveCertificate — validade temporal (relógio injetado, nunca Date.now)", () => {
  it("validoAte no passado (status ainda ATIVO, coluna desatualizada) ⇒ certificado_expirado", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoAte: NO_PASSADO }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_expirado", mensagem: expect.any(String) })
  })

  it("validoAte ausente (null) ⇒ certificado_expirado (fail-closed: sem prova de validade, trata como vencido)", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoAte: null }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_expirado", mensagem: expect.any(String) })
  })

  it("validoAte EXATAMENTE igual a agora não é 'posterior' ⇒ certificado_expirado", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoAte: new Date(AGORA.getTime()) }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_expirado", mensagem: expect.any(String) })
  })

  // Regressão: `Invalid Date` (`getTime()` = NaN) faz toda comparação `<=`/`>` devolver `false` —
  // sem guarda explícita de `Number.isFinite`, os três casos abaixo "passariam" pela checagem em
  // vez de falhar fechado. Achado da revisão independente (F1), fechado nestes três testes.
  it("validoAte é uma data inválida (Invalid Date) ⇒ certificado_expirado, nunca sucesso", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoAte: new Date("data-invalida") }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_expirado", mensagem: expect.any(String) })
  })

  it("relógio injetado (now) é uma data inválida ⇒ certificado_expirado, mesmo com validoAte vencido de verdade", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoAte: NO_PASSADO }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: new Date("data-invalida"), env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_expirado", mensagem: expect.any(String) })
  })

  it("validoDe é uma data inválida (Invalid Date) ⇒ certificado_ainda_nao_valido, nunca sucesso", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoDe: new Date("data-invalida") }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_ainda_nao_valido", mensagem: expect.any(String) })
  })

  it("validoDe no futuro (validade futura) ⇒ certificado_ainda_nao_valido", async () => {
    const validoDeFuturo = new Date("2027-01-01T00:00:00.000Z")
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ validoDe: validoDeFuturo, validoAte: new Date("2028-01-01T00:00:00.000Z") }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "certificado_ainda_nao_valido", mensagem: expect.any(String) })
  })
})

describe("resolveActiveCertificate — referências do cofre ausentes", () => {
  it.each([null, "", "   "])("blobRef %j ⇒ referencias_do_certificado_ausentes", async (blobRef) => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ blobRef }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "referencias_do_certificado_ausentes", mensagem: expect.any(String) })
  })

  it.each([null, "", "   "])("senhaRef %j ⇒ referencias_do_certificado_ausentes", async (senhaRef) => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ senhaRef }))
    const r = await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
    expect(r).toEqual({ ok: false, codigo: "referencias_do_certificado_ausentes", mensagem: expect.any(String) })
  })
})

describe("resolveActiveCertificate — Secret Provider indisponível", () => {
  it("provider declarado e não implementado ⇒ secret_provider_indisponivel (fail-closed)", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido())
    const r = await resolveActiveCertificate({
      storeId: STORE_A,
      now: AGORA,
      env: { FISCAL_SECRET_PROVIDER: PROVIDER_SUPABASE_VAULT },
    })
    expect(r).toEqual({ ok: false, codigo: "secret_provider_indisponivel", mensagem: expect.any(String) })
  })

  it("checagem do provider só acontece DEPOIS do certificado validar (infra é a última porta)", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "REVOGADO", ativo: false }))
    const r = await resolveActiveCertificate({
      storeId: STORE_A,
      now: AGORA,
      env: { FISCAL_SECRET_PROVIDER: PROVIDER_SUPABASE_VAULT },
    })
    // O certificado revogado já falha antes de qualquer checagem de provider.
    expect(r).toEqual({ ok: false, codigo: "certificado_revogado", mensagem: expect.any(String) })
  })
})

describe("resolveActiveCertificate — zero contato com segredo", () => {
  it("nenhum método do cofre é chamado, no sucesso nem em nenhuma falha", async () => {
    const espioes = [
      vi.spyOn(EnvVault.prototype, "getCertificadoPfx"),
      vi.spyOn(EnvVault.prototype, "getCertificadoSenha"),
      vi.spyOn(EnvVault.prototype, "getCscToken"),
      vi.spyOn(EnvVault.prototype, "putCertificadoPfx"),
      vi.spyOn(EnvVault.prototype, "putCscToken"),
      vi.spyOn(EnvVault.prototype, "revoke"),
      vi.spyOn(EnvVault.prototype, "describeSecret"),
      vi.spyOn(EnvVault.prototype, "checkAvailability"),
      vi.spyOn(EnvVault.prototype, "rotateCertificadoPfx"),
    ]

    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido())
    await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} }) // sucesso

    db.configFindUnique.mockResolvedValueOnce(null)
    await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} }) // falha

    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "REVOGADO", ativo: false }))
    await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} }) // falha

    for (const espiao of espioes) {
      expect(espiao).not.toHaveBeenCalled()
    }
  })
})

describe("resolveActiveCertificate — zero escrita Prisma", () => {
  it("o mock do Prisma só expõe leituras (findUnique/findFirst) — qualquer escrita quebraria o teste", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido())
    await resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })

    // O stub de `prisma` só tem findUnique/findFirst (ver vi.mock no topo do arquivo) — não há
    // create/update/upsert/delete disponíveis para o resolver chamar, nem por engano.
    expect(db.configFindUnique).toHaveBeenCalledTimes(1)
    expect(db.certFindFirst).toHaveBeenCalledTimes(1)
  })
})

describe("resolveActiveCertificate — zero vazamento das referências sentinela", () => {
  it("nenhuma falha (revogado/expirado/inativo/refs ausentes) expõe blobRef/senhaRef na resposta", async () => {
    const cenarios: Array<() => Promise<unknown>> = [
      async () => {
        db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
        db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "REVOGADO", ativo: false }))
        return resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
      },
      async () => {
        db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
        db.certFindFirst.mockResolvedValueOnce(certificadoValido({ status: "EXPIRADO" }))
        return resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
      },
      async () => {
        db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
        db.certFindFirst.mockResolvedValueOnce(certificadoValido({ ativo: false }))
        return resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
      },
      async () => {
        db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
        db.certFindFirst.mockResolvedValueOnce(certificadoValido({ blobRef: null }))
        return resolveActiveCertificate({ storeId: STORE_A, now: AGORA, env: {} })
      },
    ]

    for (const cenario of cenarios) {
      const resultado = await cenario()
      expect((resultado as { ok: boolean }).ok).toBe(false)
      assertNoSecretLeak(resultado, { extras: [BLOB_REF_SENTINELA, SENHA_REF_SENTINELA] }, "falha do resolver")
    }
  })

  it("a mensagem de secret_provider_indisponivel também não carrega as referências sentinela", async () => {
    db.configFindUnique.mockResolvedValueOnce({ certificadoAtivoId: CERT_ID })
    db.certFindFirst.mockResolvedValueOnce(certificadoValido())
    const r = await resolveActiveCertificate({
      storeId: STORE_A,
      now: AGORA,
      env: { FISCAL_SECRET_PROVIDER: PROVIDER_SUPABASE_VAULT },
    })
    assertNoSecretLeak(r, { extras: [BLOB_REF_SENTINELA, SENHA_REF_SENTINELA] }, "secret_provider_indisponivel")
  })
})
