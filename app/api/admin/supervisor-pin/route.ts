/**
 * Gerenciamento do PIN de supervisor do PDV (modelo `User`, role ADMIN/admin).
 *
 *  - GET    /api/admin/supervisor-pin  → status { exists, isDefault, name }
 *  - POST   /api/admin/supervisor-pin  → troca: { currentPin, newPin } → { ok }
 *
 * Protegido por sessão NextAuth com role SUPER_ADMIN ou ADMIN
 * (modelo `AdminUser`, fluxo NextAuth v5). NÃO confundir com `User`/PIN do PDV
 * — esse endpoint usa NextAuth admin para autorizar a TROCA do PIN.
 *
 * Importante:
 *  - O PIN NUNCA é retornado pelo GET (apenas a flag `isDefault`).
 *  - O default detectado é o seed inicial ("1234") — ver scripts/seed-supervisor-pin.ts.
 *  - Após troca bem-sucedida, o cookie `assistec_admin_session` antigo
 *    permanece válido (não logamos o admin de novo no PDV); o próximo login
 *    via PDV terá que usar o novo PIN.
 */

import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { auth } from "@/auth"
import { isBlockedLegacySupervisorPin, LEGACY_DEFAULT_SUPERVISOR_PIN } from "@/lib/auth/pin-authorization"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Fonte única do valor legado (GOAL PLAT-AUTH-PIN-CONTAINMENT-001A): `POST /api/auth/admin`
 * recusa este PIN sempre, então permitir uma rotação de volta a ele deixaria o supervisor
 * com um PIN que nunca autentica. A constante vive no helper de autorização para que os
 * dois lados não possam divergir.
 */
const DEFAULT_PIN = LEGACY_DEFAULT_SUPERVISOR_PIN
const PIN_REGEX = /^\d{4,12}$/

const trocarSchema = z.object({
  currentPin: z.string().trim().min(1, "PIN atual obrigatório."),
  newPin: z
    .string()
    .trim()
    .regex(PIN_REGEX, "Novo PIN deve ter 4 a 12 dígitos numéricos."),
})

async function requireAdminNextAuth(): Promise<
  | { ok: true; userId: string; userName?: string | null }
  | { ok: false; status: number; error: string }
> {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false, status: 401, error: "Não autorizado." }
  }
  const role = String((session.user as { role?: string }).role ?? "").toUpperCase()
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return { ok: false, status: 403, error: "Apenas administradores podem alterar o PIN do supervisor." }
  }
  return { ok: true, userId: session.user.id, userName: session.user.name }
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdminNextAuth()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  try {
    await prismaEnsureConnected()
    const supervisor = await prisma.user.findFirst({
      where: { OR: [{ role: "ADMIN" }, { role: "admin" }] },
      select: { id: true, name: true, pin: true },
      orderBy: { createdAt: "asc" },
    })

    if (!supervisor) {
      return NextResponse.json({ exists: false, isDefault: false, name: null })
    }

    return NextResponse.json({
      exists: true,
      isDefault: supervisor.pin === DEFAULT_PIN,
      name: supervisor.name || null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[admin/supervisor-pin GET]", msg)
    return NextResponse.json({ error: "Falha ao consultar status do PIN." }, { status: 503 })
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireAdminNextAuth()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const parsed = trocarSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.errors[0]?.message ?? "Dados inválidos"
    return NextResponse.json({ error: first }, { status: 422 })
  }

  const { currentPin, newPin } = parsed.data

  if (currentPin === newPin) {
    return NextResponse.json(
      { error: "O novo PIN deve ser diferente do atual." },
      { status: 422 },
    )
  }

  // Um PIN bloqueado é sempre recusado por `POST /api/auth/admin`; gravá-lo aqui
  // deixaria o supervisor sem PIN utilizável. A mensagem não repete o valor.
  if (isBlockedLegacySupervisorPin(newPin)) {
    return NextResponse.json(
      { error: "Este PIN é um valor padrão bloqueado. Escolha outro." },
      { status: 422 },
    )
  }

  try {
    await prismaEnsureConnected()
    const supervisor = await prisma.user.findFirst({
      where: { OR: [{ role: "ADMIN" }, { role: "admin" }] },
      select: { id: true, pin: true },
      orderBy: { createdAt: "asc" },
    })

    if (!supervisor) {
      return NextResponse.json(
        { error: "Nenhum supervisor configurado. Rode `npm run db:seed-supervisor-pin` primeiro." },
        { status: 404 },
      )
    }

    if (supervisor.pin !== currentPin) {
      return NextResponse.json({ error: "PIN atual incorreto." }, { status: 401 })
    }

    // Bloqueia colisão com outro User (campo @unique).
    const collision = await prisma.user.findFirst({
      where: { pin: newPin, NOT: { id: supervisor.id } },
      select: { id: true },
    })
    if (collision) {
      return NextResponse.json(
        { error: "Este PIN já está em uso por outro usuário. Escolha outro." },
        { status: 409 },
      )
    }

    await prisma.user.update({
      where: { id: supervisor.id },
      data: { pin: newPin },
    })

    return NextResponse.json({ ok: true, isDefault: newPin === DEFAULT_PIN })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[admin/supervisor-pin POST]", msg)
    return NextResponse.json({ error: "Falha ao atualizar o PIN." }, { status: 503 })
  }
}
