import { describe, expect, it } from "vitest"
import {
  isOpenPath,
  isPlanOrSupport,
  isPublicPath,
  resolveProxyEntry,
  type ProxyEntryDecision,
} from "@/lib/auth/proxy-session-gate"

// ============================================================================
// GOAL 003D-lite — matriz de rotas do proxy.
// ----------------------------------------------------------------------------
// A entrada passou a ser: existe sessão NextAuth? O selo `assistec_sub_v1` não
// participa de nenhuma decisão — por isso não aparece em lado nenhum deste teste:
// não há input para ele.
// ============================================================================

function entrar(pathname: string, hasSession: boolean, pageParam: string | null = null): ProxyEntryDecision {
  return resolveProxyEntry({ pathname, pageParam, hasSession })
}

describe("rotas públicas (sem sessão)", () => {
  it.each([
    "/login",
    "/login/",
    "/api/auth/session",
    "/api/auth/callback/credentials",
    "/api/auth/signout",
    "/api/subscription/verify",
    "/_next/static/chunk.js",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/sw.js",
    "/icon-192.png",
    "/logo.svg",
  ])("%s é público", (p) => {
    expect(isPublicPath(p)).toBe(true)
    expect(entrar(p, false)).toEqual({ kind: "allow" })
  })

  it("landing `/` é pública", () => {
    expect(entrar("/", false)).toEqual({ kind: "allow" })
  })
})

describe("rotas de regularização (autenticado sem entitlement resolvido)", () => {
  it.each(["/meu-plano", "/meu-plano/renovar", "/suporte", "/suporte/chamado"])(
    "%s acessível sem sessão e sem selo",
    (p) => {
      expect(isPlanOrSupport(p)).toBe(true)
      expect(entrar(p, false)).toEqual({ kind: "allow" })
    },
  )

  it("/meu-plano NÃO redireciona — impossível criar loop", () => {
    expect(entrar("/meu-plano", false)).toEqual({ kind: "allow" })
    expect(entrar("/meu-plano", true)).toEqual({ kind: "allow" })
  })

  it.each(["/portal", "/portal/pagamento", "/login-admin", "/login-contador"])(
    "%s permanece aberta",
    (p) => {
      expect(isOpenPath(p)).toBe(true)
      expect(entrar(p, false)).toEqual({ kind: "allow" })
    },
  )
})

describe("rotas privadas exigem sessão", () => {
  it.each([
    "/dashboard",
    "/dashboard/pdv",
    "/dashboard/financeiro-v2",
    "/dashboard/marketplace",
    "/os",
    "/vendas",
    "/fluxo-caixa",
    "/relatorios-financeiros",
  ])("%s sem sessão redireciona para login", (p) => {
    const d = entrar(p, false)
    expect(d.kind).toBe("redirect-login")
    if (d.kind !== "redirect-login") return
    expect(d.callbackUrl).toBe(p)
  })

  it.each(["/dashboard", "/dashboard/pdv", "/os", "/vendas"])("%s com sessão passa", (p) => {
    expect(entrar(p, true)).toEqual({ kind: "allow" })
  })

  it("redirect de login aponta para /login — nunca para /meu-plano (evita loop comercial)", () => {
    const d = entrar("/dashboard", false)
    expect(d.kind).toBe("redirect-login")
    if (d.kind !== "redirect-login") return
    expect(d.callbackUrl).not.toContain("meu-plano")
  })
})

describe("atalho legado `/?page=`", () => {
  it.each([
    "vendas",
    "os",
    "fluxo-caixa",
    "contas-pagar",
    "contas-receber",
    "relatorios-financeiros",
    "dashboard-360",
  ])("página crítica `%s` sem sessão exige login", (page) => {
    const d = entrar("/", false, page)
    expect(d.kind).toBe("redirect-login")
    if (d.kind !== "redirect-login") return
    expect(d.callbackUrl).toBe(`/?page=${page}`)
  })

  it("página crítica COM sessão passa", () => {
    expect(entrar("/", true, "vendas")).toEqual({ kind: "allow" })
  })

  it("page param desconhecido não bloqueia a landing", () => {
    expect(entrar("/", false, "pagina-inexistente-xyz")).toEqual({ kind: "allow" })
  })
})

describe("ausência de lockout e de dependência do selo", () => {
  it("funcionário autenticado entra em dispositivo novo (sem qualquer cookie de selo)", () => {
    // Não há parâmetro de selo: a decisão não o considera.
    expect(entrar("/dashboard", true)).toEqual({ kind: "allow" })
    expect(entrar("/dashboard/pdv", true)).toEqual({ kind: "allow" })
  })

  it("anónimo não entra, independentemente de qualquer cookie que possua", () => {
    expect(entrar("/dashboard", false).kind).toBe("redirect-login")
  })

  it("uma rota aberta nunca redireciona (nenhum ciclo possível)", () => {
    const abertas = ["/", "/login", "/meu-plano", "/suporte", "/portal", "/login-admin", "/login-contador"]
    for (const p of abertas) {
      expect(entrar(p, false).kind).toBe("allow")
      expect(entrar(p, true).kind).toBe("allow")
    }
  })

  it("o destino do redirect é sempre uma rota aberta (não redireciona de novo)", () => {
    const d = entrar("/dashboard/pdv", false)
    expect(d.kind).toBe("redirect-login")
    // `/login` é aberta ⇒ o utilizador chega lá e para.
    expect(entrar("/login", false)).toEqual({ kind: "allow" })
  })
})
