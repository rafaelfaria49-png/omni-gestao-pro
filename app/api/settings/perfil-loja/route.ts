import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parsePerfilLoja, type PerfilLojaId } from "@/lib/perfil-loja-types"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"

export const runtime = "nodejs"

function storeProfileToPerfilLoja(profile: string | null | undefined): PerfilLojaId {
  if (profile === "VARIEDADES") return "variedades"
  if (profile === "SUPERMERCADO") return "supermercado"
  return "assistencia"
}

function perfilLojaToStoreProfile(perfil: PerfilLojaId): "ASSISTENCIA" | "VARIEDADES" | "SUPERMERCADO" {
  if (perfil === "variedades") return "VARIEDADES"
  if (perfil === "supermercado") return "SUPERMERCADO"
  return "ASSISTENCIA"
}

function getLojaId(req?: Request): string {
  if (!req) return LEGACY_PRIMARY_STORE_ID
  return storeIdFromAssistecRequestForRead(req)
}

export async function GET(req: Request) {
  try {
    const lojaId = getLojaId(req)
    const store = await prisma.store.findUnique({ where: { id: lojaId } })
    const perfilLoja = store ? storeProfileToPerfilLoja(String(store.profile)) : parsePerfilLoja(undefined)
    return NextResponse.json({ perfilLoja, lojaId })
  } catch {
    return NextResponse.json({ perfilLoja: parsePerfilLoja(undefined), lojaId: LEGACY_PRIMARY_STORE_ID })
  }
}

export async function PUT(req: Request) {
  // Perfil é atributo da Store e deve ser editado em "Gestão de Unidades".
  // Esta rota fica read-only para evitar criação automática de unidades e efeitos colaterais.
  void req
  return NextResponse.json(
    { ok: false, error: 'Operação desativada. Edite o perfil em "Gestão de Unidades".' },
    { status: 405 }
  )
}
