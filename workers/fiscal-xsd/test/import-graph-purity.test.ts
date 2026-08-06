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
 *
 * FISCAL-PR46-IMPORT-GRAPH-FAIL-CLOSED-CORRECTION-002 — correção de um furo achado em revisão
 * independente: a primeira versão comparava o TEXTO do identificador em `new X()`. Como
 * `@/generated/prisma` é tolerado (é de lá que vêm os enums `AmbienteFiscal`/`ModeloFiscal`/
 * `RegimeTributario`), `import { PrismaClient } from "@/generated/prisma"; const C =
 * PrismaClient; new C()` evadia a checagem. A regra agora é FAIL-CLOSED NA ORIGEM DO BINDING:
 * de `generated/prisma` só os três enums realmente consumidos hoje podem ser importados por
 * nome — qualquer outro nome (inclusive `PrismaClient`, mesmo sob outro alias, mesmo via
 * reexport `export { PrismaClient as X } from "@/generated/prisma"`) é proibido no PRÓPRIO
 * ponto de import/export, não no ponto de uso a jusante. Isso fecha reexport nomeado, alias de
 * dois saltos e alias entre dois módulos de uma vez: o bloqueio nasce onde a taint ENTRA no
 * grafo, então não importa quantos arquivos ou aliases a repassam depois. Default import,
 * namespace import e `export *` de `generated/prisma` são banidos incondicionalmente — não há
 * como allow-listar o conteúdo de um namespace em análise estática. `import()`/`require()`
 * dinâmicos de qualquer módulo ligado a Prisma (`generated/prisma` incluído) também são banidos
 * incondicionalmente, pela mesma razão. O rastreador de `new PrismaClient(...)` por alias
 * dentro do mesmo arquivo permanece como defesa adicional (útil mesmo quando o import de
 * origem já deveria ter sido pego — não deve haver um único ponto de falha).
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

/** `@prisma/client`, `lib/prisma` e `prisma/client`: QUALQUER binding de valor é proibido,
 *  não importa o nome. O sufixo de extensão é opcional para que `@/lib/prisma.ts` não escape
 *  da âncora `$`. */
const FORBIDDEN_SPECIFIER =
  /(^|\/)@prisma\/client($|\/)|(^|\/)lib\/prisma(\.[cm]?[jt]s)?$|(^\.\.?\/)?prisma\/client(\.[cm]?[jt]s)?$/

/** Qualquer profundidade de `generated/prisma` — a família tolerada, mas só por nome permitido. */
const GENERATED_PRISMA_SPECIFIER = /(^|\/)generated\/prisma($|\/)/

/**
 * Únicos nomes seguros para importar de `generated/prisma`: os enums runtime realmente
 * consumidos hoje pelo grafo (inventariados lendo `venda-fiscal-snapshot.ts` e
 * `fiscal-validators.ts`, os dois únicos módulos alcançados que importam de lá). QUALQUER outro
 * nome — inclusive `PrismaClient`, mesmo sob alias, mesmo via reexport — é proibido. Adicionar
 * um enum novo aqui é uma mudança deliberada e visível no diff; não é aceito "de graça" só por
 * não se chamar `PrismaClient`.
 */
const ALLOWED_GENERATED_PRISMA_ENUMS = new Set(["AmbienteFiscal", "ModeloFiscal", "RegimeTributario"])

/**
 * Percorre declarações de import/export-from e chamadas `import()`/`require()` de UM módulo e
 * devolve uma mensagem por binding que atravessa a fronteira de forma proibida.
 *
 * Regra fail-closed NA ORIGEM do binding — não no ponto de uso. Um `new`, um alias local ou um
 * reexport a jusante não importam: a taint já é recusada aqui, então não há necessidade de
 * perseguir cada alias possível em cada arquivo consumidor.
 */
function findForbiddenBindings(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const offenders: string[] = []

  const checkNamedElements = (
    elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[],
    specifier: string,
    label: string
  ) => {
    for (const element of elements) {
      if (element.isTypeOnly) continue
      // Nome ORIGINAL no módulo de origem (antes do `as`) — é ele que decide o perigo, não o
      // alias/local binding, que pode se chamar qualquer coisa.
      const originalName = (element.propertyName ?? element.name).text
      if (!ALLOWED_GENERATED_PRISMA_ENUMS.has(originalName)) {
        offenders.push(`${label} "${originalName}" de ${specifier}`)
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      const clause = node.importClause
      const blanket = FORBIDDEN_SPECIFIER.test(specifier)
      const generated = !blanket && GENERATED_PRISMA_SPECIFIER.test(specifier)
      if (clause && !clause.isTypeOnly && (blanket || generated)) {
        if (blanket) {
          offenders.push(`import de ${specifier}`)
        } else {
          if (clause.name) offenders.push(`default import de ${specifier}`)
          const bindings = clause.namedBindings
          if (bindings) {
            if (ts.isNamespaceImport(bindings)) {
              offenders.push(`namespace import (* as ${bindings.name.text}) de ${specifier}`)
            } else {
              checkNamedElements(bindings.elements, specifier, "import nomeado")
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      const blanket = FORBIDDEN_SPECIFIER.test(specifier)
      const generated = !blanket && GENERATED_PRISMA_SPECIFIER.test(specifier)
      if (!node.isTypeOnly && (blanket || generated)) {
        if (blanket) {
          offenders.push(`export-from de ${specifier}`)
        } else if (!node.exportClause) {
          offenders.push(`export * de ${specifier}`) // export star: impossível allow-listar
        } else if (ts.isNamespaceExport(node.exportClause)) {
          offenders.push(`export * as ${node.exportClause.name.text} de ${specifier}`)
        } else {
          checkNamedElements(node.exportClause.elements, specifier, "reexport nomeado")
        }
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      if (isDynamicImport || isRequire) {
        const arg = node.arguments[0]
        if (arg && ts.isStringLiteral(arg)) {
          const specifier = arg.text
          // Sem allow-list para acesso dinâmico: não dá para enumerar estaticamente o que uma
          // Promise resolvida ou um `require()` desestruturam depois. Nega por padrão.
          if (FORBIDDEN_SPECIFIER.test(specifier) || GENERATED_PRISMA_SPECIFIER.test(specifier)) {
            offenders.push(`${isDynamicImport ? "import() dinâmico" : "require()"} de ${specifier}`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return offenders
}

/**
 * Fonte de contaminação para `instantiatesPrismaClient`: qualquer binding vindo de um módulo de
 * client. Mais ampla que `ALLOWED_GENERATED_PRISMA_ENUMS` DE PROPÓSITO — é defesa adicional,
 * então prefere over-tainting (ex.: tratar `AmbienteFiscal` como "contaminado" para fins de
 * `new` é inofensivo, ninguém instancia um enum) a deixar escapar um caso real.
 */
const PRISMA_CLIENT_SOURCE = /(^|\/)@prisma\/client($|\/)|(^|\/)generated\/prisma($|\/)|(^|\/)lib\/prisma$/

/**
 * `true` se o módulo constrói um Prisma Client REAL. Via AST, não regex: comentários e strings
 * que citam a expressão (inclusive os que documentam esta própria regressão) não contam.
 *
 * Defesa ADICIONAL a `findForbiddenBindings` (que já fecha a origem do binding). Rastreia
 * bindings locais + aliases `const X = Y` até ponto fixo dentro do MESMO arquivo, e sinaliza
 * `new <binding>` — inclusive `new Namespace.PrismaClient()`.
 */
function instantiatesPrismaClient(file: string, source: string): boolean {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)

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

  it("não alcança nenhum binding proibido de Prisma — import, reexport, namespace, default ou dinâmico", () => {
    const offenders: string[] = []
    for (const [file, source] of graph.modules) {
      for (const offense of findForbiddenBindings(file, source)) {
        const trail = [...(graph.trails.get(file) ?? []), toPosix(file)].join(" → ")
        offenders.push(`${offense} via ${trail}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("não instancia PrismaClient em nenhum módulo do grafo (defesa adicional)", () => {
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

/**
 * Variante de `buildGraph` para módulos SINTÉTICOS em memória — não toca o disco, não usa
 * `ENTRY_POINTS`, não reduz a cobertura do grafo real acima. Existe só para provar que a
 * detecção funciona ATRAVÉS de fronteiras de arquivo (alias entre dois módulos), não apenas
 * dentro de um único arquivo. `"./b"` casa com a chave `"b.ts"` no mesmo mapa `files`.
 */
function buildVirtualGraph(entryFiles: string[], files: Record<string, string>): Map<string, string> {
  const modules = new Map<string, string>()
  const resolveVirtual = (specifier: string): string | null => {
    if (!specifier.startsWith(".")) return specifier in files ? specifier : null
    const bare = specifier.replace(/^\.\//, "")
    if (bare in files) return bare
    if (`${bare}.ts` in files) return `${bare}.ts`
    return null
  }
  const walk = (key: string) => {
    if (modules.has(key)) return
    const source = files[key]
    if (source === undefined) throw new Error(`fixture ausente: ${key}`)
    modules.set(key, source)
    for (const edge of readEdges(key, source)) {
      if (edge.typeOnly) continue
      const target = resolveVirtual(edge.specifier)
      if (target) walk(target)
    }
  }
  for (const entry of entryFiles) walk(entry)
  return modules
}

/** Roda `findForbiddenBindings` sobre todos os módulos de um grafo virtual, achatado. */
function forbiddenBindingsAcross(modules: Map<string, string>): string[] {
  return [...modules].flatMap(([file, source]) => findForbiddenBindings(file, source))
}

describe("detecção adversarial do guard (fixtures sintéticas em memória — não tocam o grafo real)", () => {
  it("fecha reexport nomeado: export { PrismaClient as DbClient } from generated/prisma", () => {
    const source = `export { PrismaClient as DbClient } from "@/generated/prisma"`
    expect(findForbiddenBindings("reexport.ts", source)).toHaveLength(1)
  })

  it("fecha alias ATRAVÉS de dois módulos: reexport num arquivo, consumo (new) em outro", () => {
    const files = {
      "reexport.ts": `export { PrismaClient as DbClient } from "@/generated/prisma"`,
      "consumer.ts": `
        import { DbClient } from "./reexport"
        export function build() { return new DbClient() }
      `,
    }
    const modules = buildVirtualGraph(["consumer.ts"], files)
    // A taint é recusada NA ORIGEM (reexport.ts) — não é preciso perseguir "DbClient" até
    // consumer.ts para que o grafo acuse a violação.
    expect(forbiddenBindingsAcross(modules).length).toBeGreaterThan(0)
  })

  it("fecha alias de dois saltos no MESMO arquivo: const C = PrismaClient; const D = C; new D()", () => {
    const source = `
      import { PrismaClient } from "@/generated/prisma"
      const C = PrismaClient
      const D = C
      export const db = new D()
    `
    expect(findForbiddenBindings("synthetic.ts", source).length).toBeGreaterThan(0)
    expect(instantiatesPrismaClient("synthetic.ts", source)).toBe(true)
  })

  it("fecha namespace import de generated/prisma", () => {
    const source = `import * as GeneratedPrisma from "@/generated/prisma"\nnew GeneratedPrisma.PrismaClient()`
    expect(findForbiddenBindings("synthetic.ts", source).length).toBeGreaterThan(0)
  })

  it("fecha default import de generated/prisma", () => {
    const source = `import GeneratedPrismaDefault from "@/generated/prisma"`
    expect(findForbiddenBindings("synthetic.ts", source).length).toBeGreaterThan(0)
  })

  it("fecha export * (star) de generated/prisma", () => {
    const source = `export * from "@/generated/prisma"`
    expect(findForbiddenBindings("synthetic.ts", source).length).toBeGreaterThan(0)
  })

  it("fecha export * as ns de generated/prisma", () => {
    const source = `export * as GeneratedPrismaNs from "@/generated/prisma"`
    expect(findForbiddenBindings("synthetic.ts", source).length).toBeGreaterThan(0)
  })

  it("fecha import() dinâmico de generated/prisma", () => {
    const source = `
      async function build() {
        const { PrismaClient } = await import("@/generated/prisma")
        return new PrismaClient()
      }
    `
    expect(findForbiddenBindings("synthetic.ts", source).length).toBeGreaterThan(0)
  })

  it("fecha require() de generated/prisma — chamada de valor, sem allow-list", () => {
    const source = `const { PrismaClient } = require("@/generated/prisma")`
    expect(findForbiddenBindings("synthetic.ts", source).length).toBeGreaterThan(0)
  })

  it("fecha acesso por propriedade (estática e computada) sobre require() de generated/prisma", () => {
    const bySimpleProperty = `const Ctor = require("@/generated/prisma").PrismaClient; new Ctor()`
    const byComputedProperty = `const Ctor = require("@/generated/prisma")["PrismaClient"]; new Ctor()`
    // O require() em si já é a violação — não importa qual propriedade é lida depois.
    expect(findForbiddenBindings("synthetic.ts", bySimpleProperty).length).toBeGreaterThan(0)
    expect(findForbiddenBindings("synthetic.ts", byComputedProperty).length).toBeGreaterThan(0)
  })

  it("fecha import()/require() de @prisma/client e lib/prisma (blanket, não só generated/prisma)", () => {
    expect(findForbiddenBindings("synthetic.ts", `const { prisma } = require("@/lib/prisma")`).length).toBeGreaterThan(0)
    expect(
      findForbiddenBindings("synthetic.ts", `const { PrismaClient } = await import("@prisma/client")`).length
    ).toBeGreaterThan(0)
  })

  it("PERMITE os enums realmente usados, mesmo sob alias local", () => {
    const source = `
      import { AmbienteFiscal, ModeloFiscal as Modelo, RegimeTributario } from "@/generated/prisma"
      export function usa() { return { AmbienteFiscal, Modelo, RegimeTributario } }
    `
    expect(findForbiddenBindings("synthetic.ts", source)).toEqual([])
    expect(instantiatesPrismaClient("synthetic.ts", source)).toBe(false)
  })

  it("PERMITE import type de PrismaClient — sem efeito em runtime", () => {
    const wholeClauseTypeOnly = `import type { PrismaClient } from "@/generated/prisma"`
    const perSpecifierTypeOnly = `import { type PrismaClient, AmbienteFiscal } from "@/generated/prisma"`
    expect(findForbiddenBindings("synthetic.ts", wholeClauseTypeOnly)).toEqual([])
    expect(findForbiddenBindings("synthetic.ts", perSpecifierTypeOnly)).toEqual([])
  })

  it("PERMITE export type * from generated/prisma — tipos somem na emissão", () => {
    const source = `export type * from "@/generated/prisma"`
    expect(findForbiddenBindings("synthetic.ts", source)).toEqual([])
  })

  it("NÃO gera falso positivo a partir de comentário ou string que citam PrismaClient", () => {
    const source = `
      // new PrismaClient() é proibido nesta camada — ver import-graph-purity.test.ts
      /** Documentação que menciona "PrismaClient" e require("@/generated/prisma") como texto. */
      import { AmbienteFiscal } from "@/generated/prisma"
      export const aviso = "nunca chame new PrismaClient() aqui, nem require('@/lib/prisma')"
      export function usa() { return AmbienteFiscal }
    `
    expect(findForbiddenBindings("synthetic.ts", source)).toEqual([])
    expect(instantiatesPrismaClient("synthetic.ts", source)).toBe(false)
  })

  it("o grafo real atual (produção) permanece verde sob a nova regra", () => {
    const offenders = forbiddenBindingsAcross(graph.modules)
    expect(offenders).toEqual([])
  })
})
