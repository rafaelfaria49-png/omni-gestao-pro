/**
 * Permissões enterprise por papel (Fase 1 — matriz fixa, sem ACL granular no banco).
 * Papéis canônicos: admin | gerente | caixa | tecnico | vendedor
 */

import type { Session } from "next-auth"

/** Papéis canônicos derivados do enum Prisma `UserRole` + legado. */
export type EnterpriseRole =
  | "admin"
  | "gerente"
  | "caixa"
  | "tecnico"
  | "vendedor"

export type EnterprisePermissions = {
  /** Painel / workspace geral */
  workspace: { iaMestre: boolean; omniAgent: boolean }
  /** Hubs de negócio */
  hubs: {
    marketingIa: boolean
    whatsapp: boolean
    operacoes: boolean
    cadastros: boolean
    vendas: boolean
    caixaHistorico: boolean
    marketplace: boolean
    financeiro: boolean
    /** Central `/dashboard/relatorios` (vendas + inteligência; financeiro só com hub financeiro). */
    relatorios: boolean
    /** Contador HUB (`/dashboard/contador`) — documentos, competências e pacote (GOAL 010). */
    contador: boolean
  }
  /** Administração */
  admin: { masterConsole: boolean; unidades: boolean; configuracoes: boolean }
  /**
   * Contador HUB — permissões ESPECÍFICAS do domínio (GOAL 014, ajuste G3).
   * `manageExternalAccess`: gerenciar a identidade EXTERNA do contador (convites,
   * vínculos e suspensão/reativação da identidade). Permissão explícita do
   * domínio — NÃO é derivada de `financeiro.edit` (sem fallback silencioso).
   */
  contador: { manageExternalAccess: boolean }
  /** PDV / operações de caixa (APIs devem revalidar) */
  pdv: {
    abrirCaixa: boolean
    fecharCaixa: boolean
    cancelarVenda: boolean
    devolucao: boolean
  }
  /** Financeiro (telas + ações sensíveis) */
  financeiro: { view: boolean; edit: boolean; fecharPeriodo: boolean; conciliacao: boolean }
  /** Operações / OS (API + server actions) */
  operacoes: {
    criarOs: boolean
    editarOs: boolean
    entregarOs: boolean
    cancelarOs: boolean
    gerarCobranca: boolean
    checklist: boolean
    retirada: boolean
    garantia: boolean
  }
  /** Auditoria / logs sensíveis */
  auditoria: boolean
}

const FULL: EnterprisePermissions = {
  workspace: { iaMestre: true, omniAgent: true },
  hubs: {
    marketingIa: true,
    whatsapp: true,
    operacoes: true,
    cadastros: true,
    vendas: true,
    caixaHistorico: true,
    marketplace: true,
    financeiro: true,
    relatorios: true,
    contador: true,
  },
  admin: { masterConsole: true, unidades: true, configuracoes: true },
  contador: { manageExternalAccess: true },
  pdv: { abrirCaixa: true, fecharCaixa: true, cancelarVenda: true, devolucao: true },
  financeiro: { view: true, edit: true, fecharPeriodo: true, conciliacao: true },
  operacoes: {
    criarOs: true,
    editarOs: true,
    entregarOs: true,
    cancelarOs: true,
    gerarCobranca: true,
    checklist: true,
    retirada: true,
    garantia: true,
  },
  auditoria: true,
}

function merge(a: Partial<EnterprisePermissions>, base: EnterprisePermissions = FULL): EnterprisePermissions {
  return {
    workspace: { ...base.workspace, ...a.workspace },
    hubs: { ...base.hubs, ...a.hubs },
    admin: { ...base.admin, ...a.admin },
    contador: { ...base.contador, ...a.contador },
    pdv: { ...base.pdv, ...a.pdv },
    financeiro: { ...base.financeiro, ...a.financeiro },
    operacoes: { ...base.operacoes, ...a.operacoes },
    auditoria: a.auditoria ?? base.auditoria,
  }
}

/** Converte `UserRole` Prisma / string legada para papel canônico. */
export function enterpriseRoleFromUserRole(role: string | undefined | null): EnterpriseRole {
  const r = String(role || "").toUpperCase()
  if (r === "SUPER_ADMIN" || r === "ADMIN") return "admin"
  if (r === "GERENTE") return "gerente"
  if (r === "CAIXA") return "caixa"
  if (r === "TECNICO") return "tecnico"
  if (r === "VENDEDOR") return "vendedor"
  // OPERADOR legado → vendedor (acesso comercial padrão)
  return "vendedor"
}

export function getEnterprisePermissions(role: string | undefined | null): EnterprisePermissions {
  const e = enterpriseRoleFromUserRole(role)
  switch (e) {
    case "admin":
      return FULL
    case "gerente":
      return merge({
        auditoria: true,
        financeiro: { view: true, edit: true, fecharPeriodo: true, conciliacao: true },
        // Capacidade operacional do Contador HUB como permissão EXPLÍCITA do
        // domínio (antes derivada de financeiro.edit — fallback proibido no G3).
        contador: { manageExternalAccess: true },
      })
    case "caixa":
      return merge({
        workspace: { iaMestre: false, omniAgent: false },
        hubs: {
          marketingIa: false,
          whatsapp: true,
          operacoes: false,
          cadastros: false,
          vendas: true,
          caixaHistorico: true,
          marketplace: false,
          financeiro: false,
          relatorios: false,
          contador: false,
        },
        admin: { masterConsole: false, unidades: false, configuracoes: false },
        contador: { manageExternalAccess: false },
        pdv: { abrirCaixa: true, fecharCaixa: true, cancelarVenda: false, devolucao: true },
        financeiro: { view: false, edit: false, fecharPeriodo: false, conciliacao: false },
        operacoes: {
          criarOs: false,
          editarOs: false,
          entregarOs: false,
          cancelarOs: false,
          gerarCobranca: false,
          checklist: false,
          retirada: false,
          garantia: false,
        },
        auditoria: false,
      })
    case "tecnico":
      return merge({
        workspace: { iaMestre: false, omniAgent: false },
        hubs: {
          marketingIa: false,
          whatsapp: false,
          operacoes: true,
          cadastros: true,
          vendas: false,
          caixaHistorico: false,
          marketplace: false,
          financeiro: false,
          relatorios: false,
          contador: false,
        },
        admin: { masterConsole: false, unidades: false, configuracoes: false },
        contador: { manageExternalAccess: false },
        pdv: { abrirCaixa: false, fecharCaixa: false, cancelarVenda: false, devolucao: false },
        financeiro: { view: false, edit: false, fecharPeriodo: false, conciliacao: false },
        operacoes: {
          criarOs: true,
          editarOs: true,
          entregarOs: true,
          cancelarOs: false,
          gerarCobranca: false,
          checklist: true,
          retirada: true,
          garantia: true,
        },
        auditoria: false,
      })
    case "vendedor":
    default:
      return merge({
        workspace: { iaMestre: false, omniAgent: false },
        hubs: {
          marketingIa: false,
          whatsapp: true,
          operacoes: false,
          cadastros: true,
          vendas: true,
          caixaHistorico: true,
          marketplace: false,
          financeiro: false,
          relatorios: true,
          contador: false,
        },
        admin: { masterConsole: false, unidades: false, configuracoes: false },
        contador: { manageExternalAccess: false },
        pdv: { abrirCaixa: true, fecharCaixa: true, cancelarVenda: false, devolucao: true },
        financeiro: { view: false, edit: false, fecharPeriodo: false, conciliacao: false },
        operacoes: {
          criarOs: false,
          editarOs: false,
          entregarOs: false,
          cancelarOs: false,
          gerarCobranca: false,
          checklist: false,
          retirada: false,
          garantia: false,
        },
        auditoria: false,
      })
  }
}

export function getPermissionsFromSession(session: Session | null): EnterprisePermissions {
  return getEnterprisePermissions(session?.user?.role)
}

/** Escopo de loja na sessão NextAuth (Fase 1). */
export function canAccessStore(session: Session | null, storeId: string | null | undefined): boolean {
  if (!session?.user || !storeId?.trim()) return true
  if (session.user.storeAccess !== "restricted") return true
  const ids = session.user.allowedStoreIds ?? []
  return ids.includes(storeId)
}
