import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import { denyIfNoStoreAccess, filterStoresForSession } from "@/lib/stores-api-access"
import { recordConfigAuditFromSession } from "@/lib/config-audit/record"
import {
  provisionStoreSaleNumberingCode,
  readStoreSaleNumberingStatuses,
} from "@/lib/vendas/store-sale-numbering-provision"
import type { StoreSaleNumberingCodeRejectionReason } from "@/lib/vendas/store-sale-numbering-code"

/**
 * Superfície versionada de provisionamento de `Store.codigoNumeracaoVenda` (GOAL 002C-0b).
 *
 * GET  — estado por loja acessível (leitura: `requireAdmin` + ACL da loja).
 * PUT  — configura/substitui o código (escrita: `requireAdmin` + ACL da loja).
 *
 * Leitura e escrita compartilham o MESMO gate administrativo: o código é insumo de
 * configuração fiscal/comercial da rede, não dado operacional. `admin.unidades` é
 * verdadeiro também para GERENTE (ver `lib/auth/enterprise-permissions.ts`), então a
 * página que hospeda esta superfície NÃO é suficiente como controle de acesso — a rota
 * precisa decidir sozinha, e decide fechado.
 *
 * Configurar o código NÃO ativa a numeração server-side: o writer v2 continua
 * desconectado e a flag de ambiente que o habilitaria continua ausente.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const INVALID_MESSAGES: Record<StoreSaleNumberingCodeRejectionReason, string> = {
  MISSING: "Informe o código de numeração da loja.",
  NOT_A_STRING: "Informe o código de numeração da loja.",
  EMPTY: "Informe o código de numeração da loja.",
  TOO_SHORT: "O código precisa ter pelo menos 2 caracteres.",
  TOO_LONG: "O código pode ter no máximo 8 caracteres.",
  INVALID_CHARACTERS:
    "Use apenas letras (A–Z) e números, sem espaços, hífens, acentos ou símbolos.",
  DUPLICATE: "Este código já está em uso por outra loja.",
}

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  try {
    const stores = await prisma.store.findMany({ orderBy: { id: "asc" }, select: { id: true } })
    const scoped = filterStoresForSession(gate.session, stores)
    const statuses = await readStoreSaleNumberingStatuses(scoped.map((s) => s.id))
    return NextResponse.json({ stores: statuses })
  } catch {
    return NextResponse.json(
      { stores: [], error: "Falha ao carregar a numeração das unidades." },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  let body: { storeId?: unknown; codigo?: unknown } = {}
  try {
    body = (await req.json()) as { storeId?: unknown; codigo?: unknown }
  } catch {
    body = {}
  }

  // A loja é resolvida no servidor a partir deste id; nada validado no cliente é confiado.
  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : ""
  if (!storeId) {
    return NextResponse.json(
      { ok: false, code: "STORE_REQUIRED", error: "Informe a unidade a configurar." },
      { status: 400 },
    )
  }

  const denied = denyIfNoStoreAccess(gate.session, storeId)
  if (denied) return denied

  try {
    const result = await provisionStoreSaleNumberingCode({ storeId, codigo: body.codigo })

    switch (result.status) {
      case "STORE_NOT_FOUND":
        return NextResponse.json(
          { ok: false, code: "STORE_NOT_FOUND", error: "Unidade não encontrada." },
          { status: 404 },
        )

      case "INVALID":
        return NextResponse.json(
          { ok: false, code: "INVALID", reason: result.reason, error: INVALID_MESSAGES[result.reason] },
          { status: 400 },
        )

      case "CONFLICT": {
        // Política: a loja ocupante só é revelada a quem já tem acesso a ela.
        const visivel =
          result.conflitoStoreId && canAccessStore(gate.session, result.conflitoStoreId)
            ? result.conflitoStoreId
            : null
        return NextResponse.json(
          {
            ok: false,
            code: "CONFLICT",
            conflitoStoreId: visivel,
            error: visivel
              ? `Este código já está em uso pela unidade ${visivel}.`
              : "Este código já está em uso por outra unidade.",
          },
          { status: 409 },
        )
      }

      case "IMMUTABLE":
        return NextResponse.json(
          {
            ok: false,
            code: "IMMUTABLE",
            store: result.store,
            error:
              "Esta unidade já iniciou a série de numeração; o código não pode mais ser trocado.",
          },
          { status: 409 },
        )

      case "UNCHANGED":
        return NextResponse.json({ ok: true, unchanged: true, store: result.store })

      case "SAVED": {
        try {
          await recordConfigAuditFromSession(req, gate.session, {
            storeId: result.store.storeId,
            section: "geral",
            changes: [
              {
                field: "store.codigoNumeracaoVenda",
                oldValue: result.codigoAnterior,
                newValue: result.store.codigo,
                area: "pdv",
              },
            ],
          })
        } catch {
          /* auditoria não deve desfazer uma escrita já confirmada */
        }
        return NextResponse.json({ ok: true, unchanged: false, store: result.store })
      }
    }
  } catch {
    return NextResponse.json(
      { ok: false, code: "ERROR", error: "Falha ao salvar o código de numeração." },
      { status: 500 },
    )
  }
}
