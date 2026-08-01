/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — identidade externa: normalização de
 * e-mail, hash bcrypt e suspensão/reativação (§A + teste 16 do §14).
 */
import { describe, expect, it } from "vitest"
import { criarDbFalsoAuthExterna, linhaUsuario } from "./fakes"
import { criarRepoAuthExterna } from "./repo-prisma"
import {
  BCRYPT_CUSTO_EXTERNO,
  UsuarioNaoEncontradoError,
  compararSenhaExterna,
  hashSenhaExterna,
  normalizarEmail,
  reativarIdentidade,
  suspenderIdentidade,
  validarEmailExterno,
} from "./usuarios"
import { ValidacaoExternaError } from "./tipos"

const T0 = new Date("2026-08-01T12:00:00.000Z")
const ADMIN = "admin-1"

function montar(estado: Parameters<typeof criarDbFalsoAuthExterna>[0] = {}) {
  const db = criarDbFalsoAuthExterna(estado)
  const repo = criarRepoAuthExterna(db)
  return { db, repo }
}

describe("normalizarEmail / validarEmailExterno", () => {
  it("trim + lowercase em qualquer entrada", () => {
    expect(normalizarEmail("  A@B.COM ")).toBe("a@b.com")
    expect(validarEmailExterno("  Contador@Escritorio.COM ")).toBe("contador@escritorio.com")
  })

  it("rejeita formato inválido com erro tipado por campo", () => {
    expect(() => validarEmailExterno("nao-e-email")).toThrow(ValidacaoExternaError)
    expect(() => validarEmailExterno("")).toThrow(ValidacaoExternaError)
    expect(() => validarEmailExterno(42)).toThrow(ValidacaoExternaError)
  })
})

describe("hashSenhaExterna", () => {
  it("bcrypt custo 12 e verificação correspondente", async () => {
    const hash = await hashSenhaExterna("senha-super-secreta-1")
    expect(hash).toContain(`$${BCRYPT_CUSTO_EXTERNO}$`)
    expect(await compararSenhaExterna("senha-super-secreta-1", hash)).toBe(true)
    expect(await compararSenhaExterna("senha-errada", hash)).toBe(false)
  })
})

describe("suspenderIdentidade (teste 16 — suspensão derruba tudo numa transação)", () => {
  it("tokenVersion++ E revogação em massa das sessões na MESMA transação + evento", async () => {
    const { db, repo } = montar({
      usuarios: [linhaUsuario({ id: "usr-1" })],
      sessoes: [
        { id: "ses-1", usuarioId: "usr-1", expiraEm: new Date("2026-08-02T00:00:00Z"), revogadoEm: null, ultimoUsoEm: null, ipHash: "abc", userAgentResumo: "UA", createdAt: T0, updatedAt: T0 },
        { id: "ses-2", usuarioId: "usr-1", expiraEm: new Date("2026-08-02T00:00:00Z"), revogadoEm: null, ultimoUsoEm: null, ipHash: "abc", userAgentResumo: "UA", createdAt: T0, updatedAt: T0 },
        { id: "ses-outro", usuarioId: "usr-2", expiraEm: new Date("2026-08-02T00:00:00Z"), revogadoEm: null, ultimoUsoEm: null, ipHash: null, userAgentResumo: null, createdAt: T0, updatedAt: T0 },
      ],
    })
    const transacoesAntes = db.transacoes
    const atualizado = await suspenderIdentidade(repo, {
      usuarioId: "usr-1",
      adminId: ADMIN,
      storeIdOrigem: "loja-1",
      agora: T0,
    })

    expect(db.transacoes).toBe(transacoesAntes + 1)
    expect(atualizado.status).toBe("SUSPENSO")
    expect(atualizado.tokenVersion).toBe(2)

    const [s1, s2, sOutro] = db.estado.sessoes
    expect(s1!.revogadoEm).toEqual(T0)
    expect(s2!.revogadoEm).toEqual(T0)
    expect(sOutro!.revogadoEm).toBeNull() // sessão de OUTRO usuário intacta

    const evento = db.estado.eventos.find((e) => e.tipo === "usuario_suspenso")!
    expect(evento.storeId).toBe("loja-1") // loja de origem da ação (R-7)
    expect(evento.atorTipo).toBe("interno")
    expect(evento.atorId).toBe(ADMIN)
    expect(evento.entidadeId).toBe("usr-1")
  })

  it("identidade inexistente → erro tipado, nada escrito", async () => {
    const { db, repo } = montar()
    await expect(
      suspenderIdentidade(repo, { usuarioId: "usr-x", adminId: ADMIN, storeIdOrigem: "loja-1", agora: T0 }),
    ).rejects.toBeInstanceOf(UsuarioNaoEncontradoError)
    expect(db.estado.eventos).toHaveLength(0)
  })
})

describe("reativarIdentidade", () => {
  it("volta para ATIVO sem mexer no tokenVersion, com evento auditado", async () => {
    const { db, repo } = montar({
      usuarios: [linhaUsuario({ id: "usr-1", status: "SUSPENSO", tokenVersion: 3 })],
    })
    const atualizado = await reativarIdentidade(repo, {
      usuarioId: "usr-1",
      adminId: ADMIN,
      storeIdOrigem: "loja-1",
      agora: T0,
    })
    expect(atualizado.status).toBe("ATIVO")
    expect(atualizado.tokenVersion).toBe(3) // inalterado: sessões novas exigem login
    expect(db.estado.eventos.some((e) => e.tipo === "usuario_reativado")).toBe(true)
  })
})
