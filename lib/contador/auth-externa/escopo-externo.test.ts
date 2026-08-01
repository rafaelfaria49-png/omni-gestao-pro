/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — escopo externo: identidade por sessão
 * e loja por vínculo ATIVO conferido a cada request (§D + testes 17, 18 e 23 do §14).
 */
import { describe, expect, it } from "vitest"
import { listarLojasDoEscopo, reativarVinculo, revogarVinculo, suspenderVinculo } from "./acessos"
import { resolverEscopoExterno, resolverIdentidadeExterna } from "./escopo-externo"
import { criarDbFalsoAuthExterna, linhaAcesso, linhaUsuario } from "./fakes"
import { criarRepoAuthExterna } from "./repo-prisma"
import { ENV_SEGREDO_SESSAO_EXTERNA, autenticarECriarSessao } from "./sessao"
import { hashSenhaExterna } from "./usuarios"

const T0 = new Date("2026-08-01T12:00:00.000Z")
const ENV = { [ENV_SEGREDO_SESSAO_EXTERNA]: "segredo-teste-014-externo" }
const SENHA = "senha-super-secreta-1"
const ADMIN = "admin-1"

async function montar() {
  const db = criarDbFalsoAuthExterna({
    usuarios: [
      linhaUsuario({ id: "usr-1", email: "contador@escritorio.com", senhaHash: await hashSenhaExterna(SENHA) }),
    ],
    acessos: [
      linhaAcesso({ id: "acs-1", usuarioId: "usr-1", storeId: "loja-1", papel: "LEITURA" }),
      linhaAcesso({ id: "acs-2", usuarioId: "usr-1", storeId: "loja-2", papel: "CONFERENCIA" }),
    ],
  })
  const repo = criarRepoAuthExterna(db)
  const login = await autenticarECriarSessao(repo, {
    email: "contador@escritorio.com",
    senha: SENHA,
    env: ENV,
    agora: T0,
  })
  if (!login.ok) throw new Error("login deveria ter sucesso")
  return { db, repo, token: login.cookie.value }
}

describe("resolverIdentidadeExterna (rotas sem loja)", () => {
  it("resolve a identidade da sessão válida", async () => {
    const { repo, token } = await montar()
    const r = await resolverIdentidadeExterna(repo, { token, env: ENV, agora: T0 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.usuario.id).toBe("usr-1")
  })

  it("sem cookie → nao_autenticado; adulterado → sessao_invalida; sem segredo → indisponivel", async () => {
    const { repo, token } = await montar()
    expect(await resolverIdentidadeExterna(repo, { token: undefined, env: ENV, agora: T0 })).toEqual({
      ok: false,
      motivo: "nao_autenticado",
    })
    expect(await resolverIdentidadeExterna(repo, { token: `${token}x`, env: ENV, agora: T0 })).toEqual({
      ok: false,
      motivo: "sessao_invalida",
    })
    expect(await resolverIdentidadeExterna(repo, { token, env: {}, agora: T0 })).toEqual({
      ok: false,
      motivo: "indisponivel",
    })
  })
})

describe("resolverEscopoExterno (rotas de loja — vínculo conferido por request)", () => {
  it("vínculo ATIVO da loja resolve com o papel da linha", async () => {
    const { repo, token } = await montar()
    const r = await resolverEscopoExterno(repo, { token, storeId: "loja-2", env: ENV, agora: T0 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.storeId).toBe("loja-2")
      expect(r.papel).toBe("CONFERENCIA")
    }
  })

  it("loja sem vínculo → acesso_negado", async () => {
    const { repo, token } = await montar()
    const r = await resolverEscopoExterno(repo, { token, storeId: "loja-999", env: ENV, agora: T0 })
    expect(r).toEqual({ ok: false, motivo: "acesso_negado" })
  })

  it("vínculo SUSPENSO bloqueia aquela loja na request seguinte e mantém as demais (teste 17)", async () => {
    const { repo, token } = await montar()
    await suspenderVinculo(repo, { acessoId: "acs-1", storeId: "loja-1", adminId: ADMIN, agora: T0 })

    expect(await resolverEscopoExterno(repo, { token, storeId: "loja-1", env: ENV, agora: T0 })).toEqual({
      ok: false,
      motivo: "acesso_negado",
    })
    const outra = await resolverEscopoExterno(repo, { token, storeId: "loja-2", env: ENV, agora: T0 })
    expect(outra.ok).toBe(true)

    // Evento auditado; reativação devolve o acesso.
    await reativarVinculo(repo, { acessoId: "acs-1", storeId: "loja-1", adminId: ADMIN, agora: T0 })
    const depois = await resolverEscopoExterno(repo, { token, storeId: "loja-1", env: ENV, agora: T0 })
    expect(depois.ok).toBe(true)
  })

  it("vínculo REVOGADO: loja some da lista e a URL direta é negada (teste 18)", async () => {
    const { repo, token } = await montar()
    await revogarVinculo(repo, { acessoId: "acs-1", storeId: "loja-1", adminId: ADMIN, agora: T0 })

    const lojas = await listarLojasDoEscopo(repo, "usr-1")
    expect(lojas.map((l) => l.storeId)).toEqual(["loja-2"])
    expect(await resolverEscopoExterno(repo, { token, storeId: "loja-1", env: ENV, agora: T0 })).toEqual({
      ok: false,
      motivo: "acesso_negado",
    })
    // Revogação é terminal: reativar falha.
    await expect(
      reativarVinculo(repo, { acessoId: "acs-1", storeId: "loja-1", adminId: ADMIN, agora: T0 }),
    ).rejects.toThrow()
  })

  it("suspensão de vínculo grava evento com escopo duplo — outra loja não é tocada", async () => {
    const { db, repo } = await montar()
    // acessoId da loja-1 com storeId da loja-2 → não encontrado, nada acontece.
    await expect(
      suspenderVinculo(repo, { acessoId: "acs-1", storeId: "loja-2", adminId: ADMIN, agora: T0 }),
    ).rejects.toThrow()
    expect(db.estado.acessos.find((a) => a.id === "acs-1")!.status).toBe("ATIVO")
  })
})
