/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — varredura programática do namespace
 * (teste 24 do §14): NENHUMA rota de dados contábeis existe em
 * `app/api/contador-externo/**` (competências/documentos/pacotes/dashboard são
 * GOAL 015). O 404 dos paths inexistentes é do roteador do Next — aqui se prova
 * que nenhum handler desses paths existe para responder.
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
const SEGMENTOS_PROIBIDOS = /competencia|documento|pacote|dashboard|fechamento|snapshot/i

describe("namespace /api/contador-externo — higiene (teste 24)", () => {
  it("existe exatamente o conjunto de rotas do GOAL 014 (nada do 015)", () => {
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
      "lojas/route.ts",
      "usuarios/[id]/reativar/route.ts",
      "usuarios/[id]/suspender/route.ts",
    ])
  })

  it("nenhum segmento de path remete a dados contábeis", () => {
    for (const rota of ROTAS) {
      expect(relative(RAIZ, rota)).not.toMatch(SEGMENTOS_PROIBIDOS)
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
