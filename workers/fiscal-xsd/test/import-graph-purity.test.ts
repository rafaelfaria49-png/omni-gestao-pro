/**
 * Prova estrutural permanente: a camada XSD (worker + cliente) é PURA quanto a persistência.
 *
 * Regressão de FISCAL-XSD-CI-PRISMA-TRANSITIVE-DEPENDENCY-001. O job "Container, offline
 * integration and supply chain" executa `test:fiscal-xsd:integration` DENTRO de um
 * `node:*-bookworm-slim` sem OpenSSL. Qualquer módulo do grafo que instancie `PrismaClient`
 * faz o Prisma resolver a engine para `debian-openssl-1.1.x` (fallback do detector) enquanto o
 * client foi gerado no host para `debian-openssl-3.0.x` — o processo terminava com
 * `PrismaClientInitializationError` como unhandled rejection DEPOIS dos 11 testes passarem.
 *
 * O grafo é percorrido por ANÁLISE ESTÁTICA (AST do TypeScript), sem `import()` dos módulos —
 * carregá-los seria justamente o efeito colateral que este teste existe para proibir.
 * Imports `type`-only são ignorados: são apagados na emissão e não têm efeito em runtime.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

/** Entradas do conjunto XSD: os dois arquivos do job de container e as suítes puras do worker. */
const ENTRY_POINTS = [
  "workers/fiscal-xsd/test/container.integration.test.ts",
  "workers/fiscal-xsd/test/container.security.test.ts",
  "workers/fiscal-xsd/test/validator.test.ts",
  "lib/fiscal/xsd-worker/client.test.ts",
]

/** Extensões testadas na resolução, na ordem em que o Vite/Vitest resolve. */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]

const toPosix = (absolute: string) => relative(REPO_ROOT, absolute).split("\\").join("/")

/**
 * Espelha o `resolve.alias` de `vitest.config.ts` (`@` → raiz do repo) e a resolução de
 * arquivo/diretório. Retorna `null` para pacotes bare (`vitest`, `node:crypto`, `typescript`…),
 * que não são percorridos: só o código do REPOSITÓRIO é auditado.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier)
  else if (specifier === "@" || specifier.startsWith("@/")) base = resolve(REPO_ROOT, specifier.slice(2))
  else return null

  for (const extension of EXTENSIONS) {
    const candidate = base + extension
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  if (existsSync(base)) {
    if (statSync(base).isFile()) return base
    for (const extension of EXTENSIONS) {
      const candidate = join(base, "index" + extension)
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  return null
}

type Edge = { specifier: string; typeOnly: boolean }

/** Extrai os specifiers de um módulo pela AST, separando os que somem na emissão. */
function readEdges(file: string, source: string): Edge[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const edges: Edge[] = []

  const push = (node: ts.Expression | undefined, typeOnly: boolean) => {
    if (node && ts.isStringLiteral(node)) edges.push({ specifier: node.text, typeOnly })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // `import "x"` (side-effect) não tem importClause e NUNCA é type-only.
      const clause = node.importClause
      const namedTypeOnly =
        clause?.namedBindings !== undefined &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly)
      push(node.moduleSpecifier, clause !== undefined && (clause.isTypeOnly || namedTypeOnly))
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const namedTypeOnly =
        node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((element) => element.isTypeOnly)
      push(node.moduleSpecifier, node.isTypeOnly || namedTypeOnly)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      // `import("x")` dinâmico: carrega em runtime, então conta como aresta de valor.
      push(node.arguments[0], false)
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      push(node.arguments[0], false)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return edges
}

/**
 * Qualquer módulo que EXPORTE o construtor do client, independentemente de o import dele ser
 * tolerado. `@/generated/prisma` é aceito como fonte de enums (ver FORBIDDEN_SPECIFIER), mas
 * também exporta `PrismaClient` — então continua sendo fonte de contaminação para construção.
 */
const PRISMA_CLIENT_SOURCE = /(^|\/)@prisma\/client($|\/)|(^|\/)generated\/prisma($|\/)|(^|\/)lib\/prisma$/

/**
 * `true` se o módulo constrói um Prisma Client REAL. Via AST, não regex: comentários e strings
 * que citam a expressão (inclusive os que documentam esta própria regressão) não contam.
 *
 * Não basta comparar o nome no `new`: `import { PrismaClient } from "@/generated/prisma"` seguido
 * de `const C = PrismaClient; new C()` evadiria as duas checagens deste arquivo ao mesmo tempo.
 * Então rastreamos a ORIGEM do construtor — os bindings locais vindos de um módulo de client, mais
 * os aliases `const X = Y` que os propagam (ponto fixo) — e sinalizamos `new <binding>`.
 */
function instantiatesPrismaClient(file: string, source: string): boolean {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)

  // 1. Bindings locais importados de um módulo que exporta o client.
  const tainted = new Set<string>(["PrismaClient"])
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!PRISMA_CLIENT_SOURCE.test(statement.moduleSpecifier.text)) continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    if (clause.name) tainted.add(clause.name.text) // default / `import Prisma from`
    const bindings = clause.namedBindings
    if (!bindings) continue
    if (ts.isNamespaceImport(bindings)) tainted.add(bindings.name.text) // `import * as P`
    else for (const element of bindings.elements) {
      if (!element.isTypeOnly) tainted.add(element.name.text)
    }
  }

  // 2. Propaga por aliases simples até estabilizar (`const C = PrismaClient`, `const D = C`).
  const aliases: { alias: string; from: string }[] = []
  const collectAliases = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer
      const origin = ts.isIdentifier(init)
        ? init.text
        : ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression)
          ? init.expression.text
          : undefined
      if (origin) aliases.push({ alias: node.name.text, from: origin })
    }
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(sourceFile)
  for (let changed = true; changed; ) {
    changed = false
    for (const { alias, from } of aliases) {
      if (tainted.has(from) && !tainted.has(alias)) {
        tainted.add(alias)
        changed = true
      }
    }
  }

  // 3. Qualquer `new <contaminado>` — inclusive `new Namespace.PrismaClient()`.
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isNewExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined
      if (name !== undefined && tainted.has(name)) {
        found = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

type Graph = {
  modules: Map<string, string>
  /** Caminho de import (raiz → módulo) para cada módulo, para mensagens de erro úteis. */
  trails: Map<string, string[]>
  unresolved: { from: string; specifier: string }[]
}

function buildGraph(entryPoints: string[]): Graph {
  const modules = new Map<string, string>()
  const trails = new Map<string, string[]>()
  const unresolved: { from: string; specifier: string }[] = []

  const walk = (file: string, trail: string[]) => {
    if (modules.has(file)) return
    const source = readFileSync(file, "utf8")
    modules.set(file, source)
    trails.set(file, trail)

    for (const edge of readEdges(file, source)) {
      if (edge.typeOnly) continue
      const isRepoSpecifier = edge.specifier.startsWith(".") || edge.specifier.startsWith("@/")
      const target = resolveSpecifier(edge.specifier, file)
      if (target === null) {
        // Um specifier do repo que não resolve significa que a varredura PAROU cedo — um
        // rename poderia tornar este teste vacuamente verde. Falha explicitamente.
        if (isRepoSpecifier) unresolved.push({ from: toPosix(file), specifier: edge.specifier })
        continue
      }
      walk(target, [...trail, toPosix(file)])
    }
  }

  for (const entry of entryPoints) {
    const absolute = resolve(REPO_ROOT, entry)
    expect(existsSync(absolute), `entrada inexistente: ${entry}`).toBe(true)
    walk(absolute, [])
  }

  return { modules, trails, unresolved }
}

const graph = buildGraph(ENTRY_POINTS)

/** Módulos que ligam a aplicação ao banco. `@/generated/prisma` NÃO entra: o grafo o usa
 *  apenas para enums (`AmbienteFiscal`, `ModeloFiscal`…), que não instanciam client nem engine —
 *  a construção do client é coberta separadamente por `instantiatesPrismaClient`.
 *  O sufixo de extensão é opcional para que `@/lib/prisma.ts` não escape da âncora. */
const FORBIDDEN_SPECIFIER =
  /(^|\/)@prisma\/client($|\/)|(^|\/)lib\/prisma(\.[cm]?[jt]s)?$|(^\.\.?\/)?prisma\/client(\.[cm]?[jt]s)?$/

describe("pureza do grafo de imports do worker XSD", () => {
  it("percorre um grafo real e resolve todo specifier do repositório", () => {
    // Guarda anti-vacuidade: sem isto, um rename que zere a varredura deixaria as
    // asserções seguintes verdes sem terem inspecionado nada. A guarda FORTE é a lista de
    // módulos abaixo — são justamente os que carregam o risco (builder, fixtures, cliente HTTP)
    // e por onde a regressão original entrou. O piso numérico é só um sanity check grosseiro,
    // deliberadamente folgado para não quebrar em consolidação legítima de arquivos.
    expect(graph.unresolved).toEqual([])
    expect(graph.modules.size).toBeGreaterThan(20)
    const reached = [...graph.modules.keys()].map(toPosix)
    for (const required of [
      "lib/fiscal/xsd-worker/client.ts",
      "lib/fiscal/xml/nfce-xml-builder.ts",
      "lib/fiscal/dry-run/dry-run-fixtures.ts",
      "lib/fiscal/venda-fiscal-snapshot.ts",
      "lib/fiscal/fiscal-validators.ts",
      "lib/fiscal/signing/nfce-signer.ts",
    ]) {
      expect(reached).toContain(required)
    }
  })

  it("não alcança @prisma/client nem lib/prisma por nenhum caminho de valor", () => {
    const offenders: string[] = []
    for (const [file, source] of graph.modules) {
      for (const edge of readEdges(file, source)) {
        if (edge.typeOnly || !FORBIDDEN_SPECIFIER.test(edge.specifier)) continue
        const trail = [...(graph.trails.get(file) ?? []), toPosix(file)].join(" → ")
        offenders.push(`${edge.specifier} via ${trail}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("não instancia PrismaClient em nenhum módulo do grafo", () => {
    const offenders = [...graph.modules]
      .filter(([file, source]) => instantiatesPrismaClient(file, source))
      .map(([file]) => toPosix(file))
    expect(offenders).toEqual([])
  })

  it("não depende de setup global da aplicação", () => {
    const config = readFileSync(resolve(REPO_ROOT, "vitest.config.ts"), "utf8")
    expect(config).not.toMatch(/\bsetupFiles\b/)
    expect(config).not.toMatch(/\bglobalSetup\b/)
    expect(config).not.toMatch(/\bglobalTeardown\b/)
  })
})
