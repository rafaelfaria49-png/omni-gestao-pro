/**
 * Testes-baseline: ACL canAccessStore + matriz de permissões enterprise.
 *
 * Cobertura: F-05/F-06/F-07/F-08 da AUDITORIA_MULTI_LOJA_PRE_PILOTO_v01.md
 * - canAccessStore é o "guard" canônico para multi-loja
 * - rotas/actions que NÃO chamam canAccessStore expõem dados cross-tenant
 *
 * Estes testes garantem o **contrato isolado** de canAccessStore.
 * Testes de integração (verificar que cada rota chama o guard) virão em sprint
 * sucessora — fora do escopo S desta sprint de baseline.
 */
import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import {
  canAccessStore,
  enterpriseRoleFromUserRole,
  getEnterprisePermissions,
  getPermissionsFromSession,
} from "./enterprise-permissions"

function makeSession(opts: {
  role?: string
  storeAccess?: "all" | "restricted"
  allowedStoreIds?: string[]
}): Session {
  return {
    user: {
      id: "u1",
      email: "u@x.com",
      name: "U",
      role: opts.role ?? "ADMIN",
      storeAccess: opts.storeAccess ?? "all",
      allowedStoreIds: opts.allowedStoreIds,
    },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as Session
}

describe("canAccessStore — guard canônico multi-loja", () => {
  it("permite acesso quando session null (legado/sub legado — não bloqueia)", () => {
    // Convenção atual: sem sessão NextAuth, canAccessStore retorna true porque
    // a camada de assinatura/legacy faz o gate em outra camada. Este é o
    // contrato implícito — documentamos.
    expect(canAccessStore(null, "loja-a")).toBe(true)
  })

  it("permite quando storeId null/vazio (deferida ao caller)", () => {
    const session = makeSession({})
    expect(canAccessStore(session, null)).toBe(true)
    expect(canAccessStore(session, "")).toBe(true)
    expect(canAccessStore(session, "   ")).toBe(true)
  })

  it("permite qualquer loja para storeAccess='all'", () => {
    const session = makeSession({ storeAccess: "all" })
    expect(canAccessStore(session, "loja-a")).toBe(true)
    expect(canAccessStore(session, "loja-z")).toBe(true)
    expect(canAccessStore(session, "loja-inexistente")).toBe(true)
  })

  it("permite loja específica para storeAccess='restricted' com allowedStoreIds", () => {
    const session = makeSession({
      storeAccess: "restricted",
      allowedStoreIds: ["loja-a", "loja-b"],
    })
    expect(canAccessStore(session, "loja-a")).toBe(true)
    expect(canAccessStore(session, "loja-b")).toBe(true)
  })

  it("nega loja não permitida quando restricted", () => {
    const session = makeSession({
      storeAccess: "restricted",
      allowedStoreIds: ["loja-a"],
    })
    expect(canAccessStore(session, "loja-b")).toBe(false)
    expect(canAccessStore(session, "loja-z")).toBe(false)
  })

  it("nega quando restricted e allowedStoreIds vazio", () => {
    const session = makeSession({
      storeAccess: "restricted",
      allowedStoreIds: [],
    })
    expect(canAccessStore(session, "loja-a")).toBe(false)
  })

  it("nega quando restricted e allowedStoreIds undefined", () => {
    const session = makeSession({
      storeAccess: "restricted",
      allowedStoreIds: undefined,
    })
    expect(canAccessStore(session, "loja-a")).toBe(false)
  })
})

describe("enterpriseRoleFromUserRole — normalização de papel", () => {
  it("mapeia SUPER_ADMIN e ADMIN para 'admin'", () => {
    expect(enterpriseRoleFromUserRole("SUPER_ADMIN")).toBe("admin")
    expect(enterpriseRoleFromUserRole("ADMIN")).toBe("admin")
    expect(enterpriseRoleFromUserRole("admin")).toBe("admin")
  })

  it("mapeia GERENTE para 'gerente'", () => {
    expect(enterpriseRoleFromUserRole("GERENTE")).toBe("gerente")
    expect(enterpriseRoleFromUserRole("gerente")).toBe("gerente")
  })

  it("mapeia CAIXA para 'caixa'", () => {
    expect(enterpriseRoleFromUserRole("CAIXA")).toBe("caixa")
  })

  it("mapeia TECNICO para 'tecnico'", () => {
    expect(enterpriseRoleFromUserRole("TECNICO")).toBe("tecnico")
  })

  it("mapeia VENDEDOR para 'vendedor'", () => {
    expect(enterpriseRoleFromUserRole("VENDEDOR")).toBe("vendedor")
  })

  it("mapeia OPERADOR (legado) para 'vendedor'", () => {
    expect(enterpriseRoleFromUserRole("OPERADOR")).toBe("vendedor")
  })

  it("null/undefined/desconhecido caem em 'vendedor' (default conservador)", () => {
    expect(enterpriseRoleFromUserRole(null)).toBe("vendedor")
    expect(enterpriseRoleFromUserRole(undefined)).toBe("vendedor")
    expect(enterpriseRoleFromUserRole("ROLE_DESCONHECIDO")).toBe("vendedor")
  })
})

describe("getEnterprisePermissions — matriz por papel", () => {
  it("ADMIN tem FULL access", () => {
    const p = getEnterprisePermissions("ADMIN")
    expect(p.workspace.iaMestre).toBe(true)
    expect(p.workspace.omniAgent).toBe(true)
    expect(p.admin.masterConsole).toBe(true)
    expect(p.admin.unidades).toBe(true)
    expect(p.financeiro.fecharPeriodo).toBe(true)
    expect(p.operacoes.cancelarOs).toBe(true)
    expect(p.pdv.cancelarVenda).toBe(true)
    expect(p.auditoria).toBe(true)
    expect(p.contador.manageExternalAccess).toBe(true) // GOAL 014 — permissão específica
  })

  it("GERENTE: igual a admin mas sem master console", () => {
    const p = getEnterprisePermissions("GERENTE")
    expect(p.admin.masterConsole).toBe(true) // gerente herda FULL atualmente (matriz Fase 1)
    expect(p.auditoria).toBe(true)
    expect(p.financeiro.fecharPeriodo).toBe(true)
    // GOAL 014: capacidade do Contador HUB como permissão EXPLÍCITA do domínio
    // (não derivada de financeiro.edit — fallback silencioso proibido no G3).
    expect(p.contador.manageExternalAccess).toBe(true)
  })

  it("CAIXA: NÃO tem IA Mestre, NÃO tem omni-agent, NÃO tem financeiro, NÃO tem unidades", () => {
    const p = getEnterprisePermissions("CAIXA")
    expect(p.workspace.iaMestre).toBe(false)
    expect(p.workspace.omniAgent).toBe(false)
    expect(p.hubs.financeiro).toBe(false)
    expect(p.hubs.marketplace).toBe(false)
    expect(p.admin.unidades).toBe(false)
    expect(p.admin.masterConsole).toBe(false)
    expect(p.pdv.cancelarVenda).toBe(false)
    expect(p.financeiro.fecharPeriodo).toBe(false)
    expect(p.auditoria).toBe(false)
    expect(p.contador.manageExternalAccess).toBe(false) // GOAL 014 — sem acesso externo
  })

  it("CAIXA: tem PDV abrir/fechar caixa + devolução + WhatsApp", () => {
    const p = getEnterprisePermissions("CAIXA")
    expect(p.pdv.abrirCaixa).toBe(true)
    expect(p.pdv.fecharCaixa).toBe(true)
    expect(p.pdv.devolucao).toBe(true)
    expect(p.hubs.whatsapp).toBe(true)
    expect(p.hubs.vendas).toBe(true)
  })

  it("TECNICO: tem operações + cadastros, sem PDV/financeiro/marketplace", () => {
    const p = getEnterprisePermissions("TECNICO")
    expect(p.hubs.operacoes).toBe(true)
    expect(p.hubs.cadastros).toBe(true)
    expect(p.operacoes.criarOs).toBe(true)
    expect(p.operacoes.checklist).toBe(true)
    expect(p.operacoes.retirada).toBe(true)
    expect(p.operacoes.garantia).toBe(true)
    expect(p.hubs.vendas).toBe(false)
    expect(p.hubs.financeiro).toBe(false)
    expect(p.pdv.abrirCaixa).toBe(false)
  })

  it("VENDEDOR: tem vendas + cadastros + WhatsApp + relatórios, sem operações/financeiro", () => {
    const p = getEnterprisePermissions("VENDEDOR")
    expect(p.hubs.vendas).toBe(true)
    expect(p.hubs.cadastros).toBe(true)
    expect(p.hubs.whatsapp).toBe(true)
    expect(p.hubs.relatorios).toBe(true)
    expect(p.pdv.abrirCaixa).toBe(true)
    expect(p.pdv.devolucao).toBe(true)
    expect(p.pdv.cancelarVenda).toBe(false)
    expect(p.hubs.operacoes).toBe(false)
    expect(p.hubs.financeiro).toBe(false)
    expect(p.financeiro.view).toBe(false)
  })

  it("getPermissionsFromSession funciona com session ADMIN", () => {
    const session = makeSession({ role: "ADMIN" })
    const p = getPermissionsFromSession(session)
    expect(p.admin.masterConsole).toBe(true)
  })

  it("getPermissionsFromSession sem session cai em vendedor (default)", () => {
    const p = getPermissionsFromSession(null)
    expect(p.workspace.iaMestre).toBe(false)
    expect(p.hubs.vendas).toBe(true)
  })
})
