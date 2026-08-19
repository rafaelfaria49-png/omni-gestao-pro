/**
 * GOAL 016 — honestidade da agenda: zero cálculo fiscal, zero cron, zero vencido persistido.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(DIR, "../../..")

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}

describe("GOAL 016 — zero cálculo fiscal / cron / vencido persistido", () => {
  const blob = [
    "lib/contador/agenda/service.ts",
    "lib/contador/agenda/repo-prisma.ts",
    "lib/contador/agenda/tipos.ts",
    "lib/contador/agenda/vencimento.ts",
    "lib/contador/agenda/http.ts",
    "lib/contador/agenda/index.ts",
    "lib/contador/fechamento/montar-checklist.ts",
    "app/dashboard/contador/page.tsx",
    "components/dashboard/contador/agenda/contador-agenda-real.tsx",
    "app/api/contador/agenda/route.ts",
    "app/api/contador/agenda/obrigacoes/instanciar/route.ts",
    "app/api/contador/agenda/templates/route.ts",
    "app/api/contador/agenda/templates/[id]/route.ts",
  ]
    .map((f) => read(f))
    .join("\n")

  it("não importa agregados fiscais nem estimativa de imposto", () => {
    expect(blob).not.toMatch(/contador-aggregates/)
    expect(blob).not.toMatch(/estimativaImposto/)
    expect(blob).not.toMatch(/from ["']@\/lib\/fiscal/)
  })

  it("não agenda cron, trigger nem geração no boot", () => {
    expect(blob).not.toMatch(/node-cron/)
    expect(blob).not.toMatch(/setInterval\s*\(/)
    expect(blob).not.toMatch(/CronJob/)
    expect(blob).not.toMatch(/schedule\.(cron|job)/i)
  })

  it("POST/PATCH/DELETE de template exigem podeConferir; GET não", () => {
    const post = read("app/api/contador/agenda/templates/route.ts")
    const id = read("app/api/contador/agenda/templates/[id]/route.ts")
    expect(post).toMatch(/resolverCapacidadesContador/)
    expect(id).toMatch(/resolverCapacidadesContador/)
    expect(read("lib/contador/agenda/service.ts")).toMatch(/assertEscritaTemplate/)
    const getFn = post.slice(post.indexOf("export async function GET"), post.indexOf("export async function POST"))
    expect(getFn).not.toMatch(/resolverCapacidadesContador/)
    expect(getFn).not.toMatch(/podeConferir/)
  })

  it("checklist permanece puro (sem Prisma)", () => {
    const src = read("lib/contador/fechamento/montar-checklist.ts")
    expect(src).not.toMatch(/from ["']@\/lib\/prisma["']/)
    expect(src).not.toMatch(/prisma\./)
    expect(src).not.toMatch(/criarRepoAgenda/)
  })

  it("migration 0017: 3 tabelas, 3 enums, CHECKs, zero backfill/destrutivo", () => {
    const sqlRaw = read("prisma/migrations/0017_contador_agenda/migration.sql")
    const sql = sqlRaw
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
    expect(sql).not.toMatch(/"vencido"/)
    expect(sql).not.toMatch(/^\s*INSERT\b/m)
    expect(sql).not.toMatch(/^\s*UPDATE\b/m)
    expect(sql).not.toMatch(/^\s*DELETE\b/m)
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i)
    expect(sql).not.toMatch(/loja-1/)
    expect(sql).toContain('CREATE TYPE "ContadorObrigacaoTipo"')
    expect(sql).toContain('CREATE TYPE "ContadorObrigacaoRecorrencia"')
    expect(sql).toContain('CREATE TYPE "ContadorGuiaOrigem"')
    expect(sql).toContain('CREATE TABLE "contador_obrigacao_templates"')
    expect(sql).toContain('CREATE TABLE "contador_obrigacoes"')
    expect(sql).toContain('CREATE TABLE "contador_guias"')
    expect(sql).toContain("contador_obrigacao_templates_diaVencimento_chk")
    expect(sql).toContain("contador_obrigacao_templates_recorrencia_dia_chk")
    expect(sql).toContain("contador_guias_valorCentavos_chk")
    expect(sql).not.toContain("DROP TABLE")
    expect((sql.match(/CREATE TABLE/g) ?? []).length).toBe(3)
    expect((sql.match(/CREATE TYPE/g) ?? []).length).toBe(3)
  })
})
