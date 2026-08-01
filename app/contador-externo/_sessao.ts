/**
 * Portal externo do contador — helper SERVER-SIDE de sessão das páginas (GOAL 014).
 *
 * Autoproteção das páginas: o cookie externo é validado a CADA render contra a
 * linha persistida (`validarSessaoExterna` + repo padrão singleton) — revogação,
 * suspensão e expiração valem na navegação seguinte. O gate no proxy é GOAL 015;
 * até lá, cada página chama este helper no servidor (fail-closed).
 *
 * Rotação (§D.1): server components não podem regravar cookie na resposta — a
 * rotação acontece nas chamadas de API (`/api/contador-externo/**`). Na página,
 * uma sessão com rotação devida apenas segue válida até o `exp` original.
 */
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { listarLojasDoEscopo } from "@/lib/contador/auth-externa/acessos"
import { criarRepoAuthExterna } from "@/lib/contador/auth-externa/repo-prisma"
import {
  CONTADOR_EXTERNO_COOKIE,
  validarSessaoExterna,
  type ValidarSessaoResult,
} from "@/lib/contador/auth-externa/sessao"
import type { PapelExterno } from "@/lib/contador/auth-externa/tipos"

/** Valida a sessão externa da request (cookie → cadeia completa do §D.1). */
export async function validarSessaoDaPagina(): Promise<ValidarSessaoResult> {
  const token = (await cookies()).get(CONTADOR_EXTERNO_COOKIE)?.value ?? null
  return validarSessaoExterna(criarRepoAuthExterna(), token)
}

export type LojaDoEscopo = Readonly<{
  storeId: string
  nome: string
  papel: PapelExterno
}>

/**
 * Lojas do escopo com o NOME da loja — o único dado além do papel que o portal
 * exibe no 014 (prova de identidade/escopo; NENHUM dado contábil — GOAL 015).
 * O nome vem da tabela `stores` no servidor; o cliente nunca escolhe loja.
 */
export async function lojasDoEscopoComNome(usuarioId: string): Promise<LojaDoEscopo[]> {
  const repo = criarRepoAuthExterna()
  const lojas = await listarLojasDoEscopo(repo, usuarioId)
  if (lojas.length === 0) return []
  const stores = await prisma.store.findMany({
    where: { id: { in: lojas.map((l) => l.storeId) } },
    select: { id: true, name: true },
  })
  const nomes = new Map(stores.map((s) => [s.id, s.name]))
  return lojas.map((l) =>
    Object.freeze({
      storeId: l.storeId,
      nome: nomes.get(l.storeId)?.trim() || "Loja parceira",
      papel: l.papel,
    }),
  )
}
