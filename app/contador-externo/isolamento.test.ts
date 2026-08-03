/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — teste ESTÁTICO de isolamento
 * do portal externo (critério 28).
 *
 * O portal é uma árvore própria: nasce do escopo externo e não pode arrastar
 * NADA do ERP. Um import de `operations-store`, do provider de loja ativa ou de
 * qualquer provider/shell do dashboard traria consigo o contexto multi-loja
 * interno (e, com ele, a chance de o portal enxergar loja fora do vínculo).
 *
 * Varredura estática de propósito: falha ANTES de o bundler resolver o grafo, e
 * pega também import dinâmico e `require`, que a checagem de tipos não pegaria.
 *
 * Casa contra os ESPECIFICADORES de módulo, nunca contra o texto cru do arquivo:
 * comentários que apenas CITAM o que o portal não importa (há vários, herdados
 * do GOAL 014) não podem reprovar o teste.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const RAIZ_APP = join(__dirname)
const RAIZ_COMPONENTES = join(__dirname, "..", "..", "components", "contador-externo")

function listarFontes(dir: string): string[] {
  const achadas: string[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) {
      if (!entrada.startsWith(".") && entrada !== "node_modules") achadas.push(...listarFontes(caminho))
    } else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
      achadas.push(caminho)
    }
  }
  return achadas.sort()
}

const FONTES = [...listarFontes(RAIZ_APP), ...listarFontes(RAIZ_COMPONENTES)]

/**
 * Proibidos no portal externo. `components/ui/**` (primitivos shadcn, sem estado
 * de loja) e `lib/contador/**` seguem permitidos — são a base read-only do HUB.
 */
const IMPORTS_PROIBIDOS: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/operations?-store/i, "store de operações do ERP"],
  [/loja-ativa|lojaAtiva|useLojaAtiva/i, "provider/hook de loja ativa do ERP"],
  [/components\/painel-inicial|AppShell/i, "shell do dashboard"],
  [/components\/dashboard\//i, "componentes do dashboard"],
  [/providers?\/(dashboard|loja|store)/i, "providers do dashboard"],
  [/@\/store\//i, "stores globais do ERP"],
  [/next-auth|@\/auth\b/i, "autenticação interna (o portal usa só a sessão externa)"],
  [/@\/lib\/contador\/scope\b/, "gate interno do HUB (o portal usa o escopo externo)"],
])

/** Especificadores de `import … from "X"`, `import("X")` e `require("X")`. */
function especificadores(conteudo: string): string[] {
  const achados: string[] = []
  const padroes = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const p of padroes) for (const m of conteudo.matchAll(p)) achados.push(m[1]!)
  return achados
}

describe("portal externo — isolamento estático do ERP (critério 28)", () => {
  it("encontra as fontes do portal (guarda contra varredura vazia)", () => {
    expect(FONTES.length).toBeGreaterThan(0)
  })

  it("nenhuma página/componente do portal importa store, loja ativa ou provider do dashboard", () => {
    for (const arquivo of FONTES) {
      const rel = relative(join(__dirname, "..", ".."), arquivo).replaceAll("\\", "/")
      for (const spec of especificadores(readFileSync(arquivo, "utf8"))) {
        for (const [padrao, motivo] of IMPORTS_PROIBIDOS) {
          expect(padrao.test(spec), `${rel} importa "${spec}" — ${motivo}`).toBe(false)
        }
      }
    }
  })

  it("toda página de DADOS do portal (015) é dinâmica; as públicas do 014 seguem intocadas", () => {
    // Só as páginas sob `lojas/**` servem conteúdo autenticado. `login`,
    // `convite` e `sessao-expirada` são do GOAL 014 e não podem mudar aqui.
    const paginas = FONTES.filter(
      (f) => f.endsWith("page.tsx") && f.replaceAll("\\", "/").includes("/contador-externo/lojas/"),
    )
    expect(paginas.length).toBeGreaterThan(0)
    for (const pagina of paginas) {
      const conteudo = readFileSync(pagina, "utf8")
      expect(conteudo, relative(RAIZ_APP, pagina)).toContain('dynamic = "force-dynamic"')
    }
  })
})
