"use server"

import { revalidatePath } from "next/cache"
import { Prisma } from "@/generated/prisma"
import {
  assertActiveSubscriptionForImport,
  importClientesItems,
  listClientesForLoja,
  type ClienteListItem,
} from "@/lib/clientes-import-handler"
import { resolveLojaIdParaConsultaClientes } from "@/lib/clientes-loja-resolve"

/** Lista clientes da loja (substitui GET /api/clientes/importar). */
export async function listarClientesParaCadastro(lojaId: string | null | undefined): Promise<
  | { ok: true; clientes: ClienteListItem[] }
  | { ok: false; error: string }
> {
  try {
    const auth = await assertActiveSubscriptionForImport()
    if (!auth.ok) return { ok: false, error: auth.message }

    const lid = resolveLojaIdParaConsultaClientes(lojaId)
    const clientes = await listClientesForLoja(lid)
    return { ok: true, clientes }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined
    console.error("[listarClientesParaCadastro] exceção:", e)
    if (e instanceof Error && e.stack) console.error("[listarClientesParaCadastro] stack:\n", e.stack)
    return { ok: false, error: code ? `${msg} (Prisma ${code})` : msg }
  }
}

/** Importa um lote de clientes e revalida a página inicial (dashboard). */
export async function importarClientesLote(
  lojaId: string | null | undefined,
  items: unknown[]
): Promise<
  | { ok: true; created: number; updated: number; skippedDuplicate: number }
  | { ok: false; error: string; detail?: string }
> {
  try {
    const auth = await assertActiveSubscriptionForImport()
    if (!auth.ok) return { ok: false, error: "Não autorizado", detail: auth.message }

    if (!Array.isArray(items)) {
      return { ok: false, error: "Payload inválido", detail: "Envie um array de { Nome, Telefone }." }
    }

    const lid = lojaId?.trim()
    if (!lid) {
      return { ok: false, error: "Unidade obrigatória", detail: "Informe a loja (id) para importar clientes." }
    }
    const { created, updated, skippedDuplicate } = await importClientesItems(lid, items)

    revalidatePath("/")

    return { ok: true, created, updated, skippedDuplicate }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined
    console.error("[importarClientesLote]", e)
    return {
      ok: false,
      error: "Falha na importação",
      detail: code ? `${detail} (${code})` : detail,
    }
  }
}
