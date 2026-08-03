/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 + PORTAL-EXTERNO-READONLY-015 —
 * varredura programática do namespace (teste 24 do §14, atualizado no 015):
 * o conjunto de rotas é FECHADO (identidade do 014 + dados read-only do 015),
 * dados contábeis existem SOMENTE sob `lojas/[loja]/` (prefixo cuja loja é
 * validada contra `ContadorAcesso` ATIVO a cada request) e nenhuma rota expõe
 * segmentos de escrita interna (dashboard/fechamento/snapshot).
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const RAIZ = join(__dirname)

function listarRotas(dir: string = RAIZ): string[] {
  const achadas: string[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) {
      if (!entrada.startsWith(".") && entrada !== "node_modules") achadas.push(...listarRotas(caminho))
    } else if (entrada === "route.ts") {
      achadas.push(caminho)
    }
  }
  return achadas.sort()
}

const ROTAS = listarRotas()
const EXPORTS_PERMITIDOS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "runtime", "dynamic", "revalidate"])
const MODULOS_PROIBIDOS = /contador\/(documentos|pacote|fechamento|readers|comentarios|timeline)|fiscal|financeiro/
/** Dados read-only do portal — permitidos SOMENTE sob o prefixo de loja validada. */
const SEGMENTOS_DADOS_PORTAL = /competencia|documento|pacote/i
const PREFIXO_DADOS_PORTAL = "lojas/[loja]/"
/** Escrita/gestão interna — proibidos em qualquer path deste namespace. */
const SEGMENTOS_PROIBIDOS = /dashboard|fechamento|snapshot/i

describe("namespace /api/contador-externo — higiene (teste 24, rev. 015)", () => {
  it("existe exatamente o conjunto de rotas do GOAL 014 + as 11 do portal read-only (015)", () => {
    const relativas = ROTAS.map((r) => relative(RAIZ, r).replaceAll("\\", "/")).sort()
    expect(relativas).toEqual([
      "acessos/[id]/reativar/route.ts",
      "acessos/[id]/revogar/route.ts",
      "acessos/[id]/suspender/route.ts",
      "acessos/route.ts",
      "auth/login/route.ts",
      "auth/logout/route.ts",
      "auth/sessao/route.ts",
      "convite/aceitar/route.ts",
      "convite/consultar/route.ts",
      "convites/[id]/revogar/route.ts",
      "convites/route.ts",
      "lojas/[loja]/comentarios/route.ts",
      "lojas/[loja]/competencias/[c]/checklist/route.ts",
      "lojas/[loja]/competencias/[c]/documentos/route.ts",
      "lojas/[loja]/competencias/[c]/pacotes/route.ts",
      "lojas/[loja]/competencias/[c]/resumo/route.ts",
      "lojas/[loja]/competencias/[c]/timeline/route.ts",
      "lojas/[loja]/competencias/route.ts",
      "lojas/[loja]/documentos/[id]/conferir/route.ts",
      "lojas/[loja]/documentos/[id]/download/route.ts",
      "lojas/[loja]/pacotes/confirmar/route.ts",
      "lojas/[loja]/pacotes/download/route.ts",
      "lojas/route.ts",
      "usuarios/[id]/reativar/route.ts",
      "usuarios/[id]/suspender/route.ts",
    ])
  })

  it("dados contábeis SÓ sob lojas/[loja]/ (loja validada); segmentos internos proibidos", () => {
    for (const rota of ROTAS) {
      const rel = relative(RAIZ, rota).replaceAll("\\", "/")
      expect(rel, rel).not.toMatch(SEGMENTOS_PROIBIDOS)
      if (SEGMENTOS_DADOS_PORTAL.test(rel)) {
        expect(rel.startsWith(PREFIXO_DADOS_PORTAL), `${rel} fora do prefixo ${PREFIXO_DADOS_PORTAL}`).toBe(true)
      }
    }
  })

  it("handlers exportam SOMENTE métodos HTTP + config do Next", () => {
    for (const rota of ROTAS) {
      const conteudo = readFileSync(rota, "utf8")
      const exports = [...conteudo.matchAll(/export\s+(?:async\s+function|const)\s+(\w+)/g)].map((m) => m[1]!)
      expect(exports.length).toBeGreaterThan(0)
      for (const nome of exports) {
        expect(EXPORTS_PERMITIDOS.has(nome), `${rota} exporta ${nome}`).toBe(true)
      }
      // Toda rota é dinâmica (sem cache de dados autenticados).
      expect(conteudo).toContain('dynamic = "force-dynamic"')
    }
  })

  it("nenhuma rota importa domínio de dados contábeis/fiscais/financeiros", () => {
    for (const rota of ROTAS) {
      const conteudo = readFileSync(rota, "utf8")
      expect(conteudo, relative(RAIZ, rota)).not.toMatch(MODULOS_PROIBIDOS)
    }
  })
})
