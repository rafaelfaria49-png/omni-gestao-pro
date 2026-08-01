/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — convites: criação, listagem, revogação,
 * consulta pública e aceite transacional (§C da proposta + testes 2-9 e 20 do §14).
 *
 * Exercita o REPOSITÓRIO real (`criarRepoAuthExterna`) contra o fake in-memory com
 * `$transaction` serializada e rollback de verdade — a atomicidade verificada é a
 * do código que vai para produção.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CONVITE_EXPIRACAO_MS,
  ConviteAceiteFalhaError,
  ConviteNaoEncontradoError,
  aceitarConvite,
  consultarConvitePublico,
  criarConvite,
  hashTokenConvite,
  listarConvites,
  mascararEmail,
  revogarConvite,
} from "./convites"
import { listarLojasDoEscopo, revogarVinculo } from "./acessos"
import { criarDbFalsoAuthExterna, linhaUsuario } from "./fakes"
import { criarRepoAuthExterna } from "./repo-prisma"

const T0 = new Date("2026-08-01T12:00:00.000Z")
const ADMIN = "admin-1"
const LOJA_A = "loja-A"
const LOJA_B = "loja-B"

function montar(estado: Parameters<typeof criarDbFalsoAuthExterna>[0] = {}) {
  const db = criarDbFalsoAuthExterna(estado)
  const repo = criarRepoAuthExterna(db)
  return { db, repo }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("criarConvite", () => {
  it("normaliza o e-mail (trim + lowercase) antes de gravar", async () => {
    const { db, repo } = montar()
    await criarConvite(repo, { email: "  A@B.COM ", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    expect(db.estado.convites[0]!.email).toBe("a@b.com")
  })

  it("persiste SOMENTE o hash do token — o token bruto não aparece em campo algum", async () => {
    const { db, repo } = montar()
    const { token, convite } = await criarConvite(repo, {
      email: "a@b.com",
      storeId: LOJA_A,
      criadoPorId: ADMIN,
      agora: T0,
    })
    const row = db.estado.convites[0]!
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.tokenHash).toBe(await hashTokenConvite(token))
    expect(row.tokenHash).not.toBe(token)
    // O token bruto não vaza em nenhum campo/serialização da linha nem do retorno.
    expect(JSON.stringify(row)).not.toContain(token)
    expect(JSON.stringify(convite)).not.toContain(token)
    expect(convite).not.toHaveProperty("tokenHash")
  })

  it("expira em 72h e usa papel default LEITURA", async () => {
    const { db, repo } = montar()
    await criarConvite(repo, { email: "a@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    const row = db.estado.convites[0]!
    expect(row.expiraEm.getTime() - T0.getTime()).toBe(CONVITE_EXPIRACAO_MS)
    expect(row.papel).toBe("LEITURA")
  })

  it("revoga o convite aberto anterior do mesmo (email, storeId) na MESMA transação", async () => {
    const { db, repo } = montar()
    const primeiro = await criarConvite(repo, { email: "a@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    const transacoesAntes = db.transacoes
    await criarConvite(repo, { email: "A@b.com ", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })

    expect(db.transacoes).toBe(transacoesAntes + 1) // revogação + criação numa tx só
    expect(db.estado.convites).toHaveLength(2)
    const anterior = db.estado.convites.find((c) => c.id === primeiro.convite.id)!
    expect(anterior.revogadoEm).not.toBeNull()
    expect(anterior.revogadoPorId).toBe(ADMIN)
    // Trilha: convite_revogado (substituído) + 2× convite_criado.
    const tipos = db.estado.eventos.map((e) => e.tipo)
    expect(tipos).toEqual(["convite_criado", "convite_revogado", "convite_criado"])
  })

  it("grava evento convite_criado SEM token/e-mail na metadata", async () => {
    const { db, repo } = montar()
    const { token } = await criarConvite(repo, {
      email: "contador@escritorio.com",
      storeId: LOJA_A,
      criadoPorId: ADMIN,
      agora: T0,
    })
    const evento = db.estado.eventos.find((e) => e.tipo === "convite_criado")!
    expect(evento.competenciaId).toBeNull()
    expect(evento.atorTipo).toBe("interno")
    expect(evento.atorId).toBe(ADMIN)
    expect(JSON.stringify(db.estado.eventos)).not.toContain(token)
    expect(JSON.stringify(db.estado.eventos)).not.toContain("contador@escritorio.com")
  })
})

describe("listarConvites", () => {
  it("lista da loja SEM tokenHash, isolada por loja", async () => {
    const { repo } = montar()
    await criarConvite(repo, { email: "a@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    await criarConvite(repo, { email: "c@d.com", storeId: LOJA_B, criadoPorId: ADMIN, agora: T0 })

    const listaA = await listarConvites(repo, LOJA_A)
    expect(listaA).toHaveLength(1)
    expect(listaA[0]!.email).toBe("a@b.com")
    expect(listaA[0]).not.toHaveProperty("tokenHash")
    expect(JSON.stringify(listaA)).not.toContain("tokenHash")
  })
})

describe("revogarConvite", () => {
  it("revoga com escopo duplo e grava evento; convite de outra loja nem é tocado", async () => {
    const { db, repo } = montar()
    const { convite } = await criarConvite(repo, { email: "a@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })

    await expect(
      revogarConvite(repo, { conviteId: convite.id, storeId: LOJA_B, adminId: ADMIN, agora: T0 }),
    ).rejects.toBeInstanceOf(ConviteNaoEncontradoError)
    expect(db.estado.convites[0]!.revogadoEm).toBeNull()

    await revogarConvite(repo, { conviteId: convite.id, storeId: LOJA_A, adminId: ADMIN, agora: T0 })
    expect(db.estado.convites[0]!.revogadoEm).toEqual(T0)
    expect(db.estado.eventos.some((e) => e.tipo === "convite_revogado")).toBe(true)

    // Segunda revogação: falha honesta, evento não duplica.
    await expect(
      revogarConvite(repo, { conviteId: convite.id, storeId: LOJA_A, adminId: ADMIN, agora: T0 }),
    ).rejects.toBeInstanceOf(ConviteNaoEncontradoError)
    expect(db.estado.eventos.filter((e) => e.tipo === "convite_revogado")).toHaveLength(1)
  })
})

describe("consultarConvitePublico", () => {
  it("expõe estados honestos com e-mail SEMPRE mascarado", async () => {
    const { repo } = montar()
    const { token } = await criarConvite(repo, {
      email: "contador@escritorio.com",
      storeId: LOJA_A,
      criadoPorId: ADMIN,
      agora: T0,
    })

    const valido = await consultarConvitePublico(repo, token, T0)
    expect(valido.estado).toBe("valido")
    expect(valido.emailMascarado).toBe("c***@escritorio.com")
    expect(JSON.stringify(valido)).not.toContain("contador@")

    const depoisDas72h = new Date(T0.getTime() + CONVITE_EXPIRACAO_MS + 1000)
    expect((await consultarConvitePublico(repo, token, depoisDas72h)).estado).toBe("expirado")
  })

  it("token desconhecido vira 'invalido' genérico (sem enumeração)", async () => {
    const { repo } = montar()
    const r = await consultarConvitePublico(repo, "token-que-nao-existe", T0)
    expect(r.estado).toBe("invalido")
    expect(r.emailMascarado).toBeUndefined()
  })

  it("mascararEmail nunca revela mais que a primeira letra da parte local", () => {
    expect(mascararEmail("joao.silva@escritorio.com.br")).toBe("j***@escritorio.com.br")
  })
})

describe("aceitarConvite", () => {
  const SENHA = "senha-super-secreta-1"

  async function conviteAberto(repo: ReturnType<typeof criarRepoAuthExterna>, email = "contador@escritorio.com", storeId = LOJA_A) {
    return criarConvite(repo, { email, storeId, criadoPorId: ADMIN, agora: T0 })
  }

  it("cria usuário e vínculo com e-mail e storeId DA LINHA do convite", async () => {
    const { db, repo } = montar()
    const { token } = await conviteAberto(repo)
    const r = await aceitarConvite(repo, { token, nome: " Ana Contadora ", senha: SENHA, agora: T0 })

    const usuario = db.estado.usuarios[0]!
    expect(usuario.email).toBe("contador@escritorio.com")
    expect(usuario.nome).toBe("Ana Contadora")
    expect(usuario.senhaHash).not.toBe(SENHA)
    expect(usuario.senhaHash).toMatch(/^\$2[aby]\$12\$/) // bcrypt custo 12

    const acesso = db.estado.acessos[0]!
    expect(acesso.usuarioId).toBe(usuario.id)
    expect(acesso.storeId).toBe(LOJA_A)
    expect(acesso.papel).toBe("LEITURA")
    expect(acesso.status).toBe("ATIVO")
    expect(acesso.concedidoPorId).toBe(ADMIN)

    expect(r.usuario.id).toBe(usuario.id)
    expect(r.acesso.storeId).toBe(LOJA_A)

    // Eventos do aceite: convite_aceito (externo, ator = id técnico) + acesso_concedido.
    const tipos = db.estado.eventos.map((e) => e.tipo)
    expect(tipos).toContain("convite_aceito")
    expect(tipos).toContain("acesso_concedido")
    const aceito = db.estado.eventos.find((e) => e.tipo === "convite_aceito")!
    expect(aceito.atorTipo).toBe("externo")
    expect(aceito.atorId).toBe(usuario.id)
    expect(JSON.stringify(db.estado.eventos)).not.toContain("contador@")
  })

  it("convite da loja A NUNCA cria vínculo com a loja B (§9)", async () => {
    const { db, repo } = montar()
    const { token } = await conviteAberto(repo, "contador@escritorio.com", LOJA_A)
    await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 })

    expect(db.estado.acessos).toHaveLength(1)
    expect(db.estado.acessos[0]!.storeId).toBe(LOJA_A)
    expect(db.estado.acessos.some((a) => a.storeId === LOJA_B)).toBe(false)
    const lojas = await listarLojasDoEscopo(repo, db.estado.usuarios[0]!.id)
    expect(lojas.map((l) => l.storeId)).toEqual([LOJA_A])
  })

  it("segundo uso do MESMO token falha honestamente", async () => {
    const { db, repo } = montar()
    const { token } = await conviteAberto(repo)
    await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 })

    const erro = await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 }).catch((e) => e)
    expect(erro).toBeInstanceOf(ConviteAceiteFalhaError)
    expect((erro as ConviteAceiteFalhaError).motivo).toBe("utilizado")
    expect(db.estado.usuarios).toHaveLength(1)
    expect(db.estado.acessos).toHaveLength(1)
  })

  it("dois aceites CONCORRENTES → exatamente um sucesso (update condicional, R-6)", async () => {
    const { db, repo } = montar()
    const { token } = await conviteAberto(repo)

    const [r1, r2] = await Promise.allSettled([
      aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 }),
      aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 }),
    ])
    const sucessos = [r1, r2].filter((r) => r.status === "fulfilled")
    const falhas = [r1, r2].filter((r) => r.status === "rejected")
    expect(sucessos).toHaveLength(1)
    expect(falhas).toHaveLength(1)
    expect((falhas[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConviteAceiteFalhaError)
    expect(((falhas[0] as PromiseRejectedResult).reason as ConviteAceiteFalhaError).motivo).toBe("utilizado")
    expect(db.estado.usuarios).toHaveLength(1)
    expect(db.estado.acessos).toHaveLength(1)
  })

  it("convite expirado (72h) falha e grava convite_expirado DEDUPLICADO", async () => {
    const { db, repo } = montar()
    const { token } = await conviteAberto(repo)
    const depois = new Date(T0.getTime() + CONVITE_EXPIRACAO_MS + 1000)

    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const erro = await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: depois }).catch((e) => e)
      expect(erro).toBeInstanceOf(ConviteAceiteFalhaError)
      expect((erro as ConviteAceiteFalhaError).motivo).toBe("expirado")
    }
    // Duas tentativas, UMA linha de evento (dedupe por convite, §E.1).
    const expirados = db.estado.eventos.filter((e) => e.tipo === "convite_expirado")
    expect(expirados).toHaveLength(1)
    expect(expirados[0]!.atorTipo).toBe("externo")
    expect(db.estado.usuarios).toHaveLength(0) // rollback: nada sobrou
  })

  it("convite revogado falha honestamente", async () => {
    const { repo } = montar()
    const { token, convite } = await conviteAberto(repo)
    await revogarConvite(repo, { conviteId: convite.id, storeId: LOJA_A, adminId: ADMIN, agora: T0 })

    const erro = await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 }).catch((e) => e)
    expect(erro).toBeInstanceOf(ConviteAceiteFalhaError)
    expect((erro as ConviteAceiteFalhaError).motivo).toBe("revogado")
  })

  it("reutiliza o usuário existente pelo e-mail DA LINHA e reativa vínculo revogado na MESMA linha", async () => {
    const { db, repo } = montar()
    // Aceite 1: loja A.
    const primeiro = await conviteAberto(repo)
    await aceitarConvite(repo, { token: primeiro.token, nome: "Ana", senha: SENHA, agora: T0 })
    const usuarioId = db.estado.usuarios[0]!.id
    const acessoAId = db.estado.acessos[0]!.id

    // Revoga o vínculo da loja A e emite novo convite para a MESMA loja.
    await revogarVinculo(repo, { acessoId: acessoAId, storeId: LOJA_A, adminId: ADMIN, agora: T0 })
    const segundo = await conviteAberto(repo)
    await aceitarConvite(repo, { token: segundo.token, nome: "Outro Nome Ignorado", senha: "outra-senha-1", agora: T0 })

    expect(db.estado.usuarios).toHaveLength(1) // reutilizado
    expect(db.estado.usuarios[0]!.id).toBe(usuarioId)
    expect(db.estado.usuarios[0]!.nome).toBe("Ana") // nome/senha originais preservados
    expect(db.estado.acessos).toHaveLength(1) // MESMA linha reativada (§B)
    const acesso = db.estado.acessos[0]!
    expect(acesso.id).toBe(acessoAId)
    expect(acesso.status).toBe("ATIVO")
    expect(acesso.revogadoEm).toBeNull()
    expect(acesso.revogadoPorId).toBeNull()
  })

  it("identidade suspensa não ganha vínculo novo (recusa genérica)", async () => {
    const { repo } = montar({
      usuarios: [linhaUsuario({ id: "usr-1", email: "contador@escritorio.com", status: "SUSPENSO" })],
    })
    const { token } = await conviteAberto(repo)
    const erro = await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 }).catch((e) => e)
    expect(erro).toBeInstanceOf(ConviteAceiteFalhaError)
    expect((erro as ConviteAceiteFalhaError).motivo).toBe("indisponivel")
  })

  it("o token bruto NUNCA aparece em logs (assert sobre logger espião)", async () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => {})
    const { repo } = montar()
    const { token } = await conviteAberto(repo)
    await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 })
    await aceitarConvite(repo, { token, nome: "Ana", senha: SENHA, agora: T0 }).catch(() => {})

    for (const chamada of espiao.mock.calls) {
      expect(JSON.stringify(chamada)).not.toContain(token)
      expect(JSON.stringify(chamada)).not.toContain(SENHA)
      expect(JSON.stringify(chamada)).not.toContain("contador@escritorio.com")
    }
  })
})
