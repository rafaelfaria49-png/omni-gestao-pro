/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — auditoria: metadata por allowlist,
 * montagem E.1 e log E.2 sem PII/segredos (§E + teste 20 do §14).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { logEventoExterno, montarEventoContador, sanearMetadataEvento } from "./eventos"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("sanearMetadataEvento (allowlist — §E.1)", () => {
  it("descarta tudo fora da allowlist: e-mail, token e senha morrem aqui", () => {
    const limpa = sanearMetadataEvento({
      papel: "LEITURA",
      email: "contador@escritorio.com",
      token: "tok_super_secreto",
      senha: "12345678",
      cookie: "assistec_contador_ext_session=xyz",
      motivo: "substituido_por_novo_convite",
    })
    expect(limpa).toEqual({ papel: "LEITURA", motivo: "substituido_por_novo_convite" })
    expect(JSON.stringify(limpa)).not.toContain("@")
    expect(JSON.stringify(limpa)).not.toContain("tok_super_secreto")
  })

  it("mantém só primitivos; objetos/arrays são descartados; strings truncadas em 120", () => {
    const limpa = sanearMetadataEvento({
      motivo: "x".repeat(500),
      papel: { valor: "LEITURA" },
      statusAnterior: ["ATIVO"],
      statusNovo: "SUSPENSO",
    })
    expect(limpa).toEqual({ motivo: "x".repeat(120), statusNovo: "SUSPENSO" })
  })

  it("metadata vazia/irrelevante vira null (não grava objeto vazio)", () => {
    expect(sanearMetadataEvento(null)).toBeNull()
    expect(sanearMetadataEvento({ email: "a@b.com" })).toBeNull()
  })
})

describe("montarEventoContador (E.1)", () => {
  it("competenciaId NULL, ator = ID técnico, ip = ipHash (nunca bruto), metadata saneada", () => {
    const e = montarEventoContador({
      storeId: "loja-1",
      tipo: "convite_aceito",
      atorTipo: "externo",
      atorId: "usr-1",
      entidade: "contador_convite",
      entidadeId: "cnv-1",
      metadata: { papel: "LEITURA", email: "nao@pode.com" },
      ipHash: "0123456789abcdef",
      userAgentResumo: "Mozilla/5.0",
    })
    expect(e.competenciaId).toBeNull()
    expect(e.atorId).toBe("usr-1")
    expect(e.ip).toBe("0123456789abcdef")
    expect(e.userAgent).toBe("Mozilla/5.0")
    expect(e.metadata).toEqual({ papel: "LEITURA" })
    expect(JSON.stringify(e)).not.toContain("nao@pode.com")
  })
})

describe("logEventoExterno (E.2 — JSON de 1 linha)", () => {
  it("emite JSON de uma linha com ipHash/motivo e NUNCA e-mail/token/cookie", () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => {})
    logEventoExterno("login_externo_falha", { ipHash: "0123456789abcdef", motivo: "credenciais_invalidas" })
    logEventoExterno("rate_limit_externo", { ipHash: "0123456789abcdef" })

    expect(espiao).toHaveBeenCalledTimes(2)
    const linha = espiao.mock.calls[0]![0] as string
    expect(linha).not.toContain("\n")
    const parsed = JSON.parse(linha)
    expect(parsed.evento).toBe("login_externo_falha")
    expect(parsed.ipHash).toBe("0123456789abcdef")
    expect(parsed.motivo).toBe("credenciais_invalidas")
    expect(parsed.timestamp).toBeTruthy()
    // Nenhum campo além do contrato E.2.
    expect(Object.keys(parsed).sort()).toEqual(["evento", "ipHash", "motivo", "timestamp"])
  })
})
