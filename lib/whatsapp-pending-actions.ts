import { prisma } from "@/lib/prisma"
import { normalizeBrPhoneDigits } from "@/lib/whatsapp-owner"
import type { VisionProductResult } from "@/lib/vision-product-openai"

export type PendingKind = "expense_confirm" | "product_confirm"

export type ExpensePayload = {
  amountBrl: number
  description: string
  transcript: string
}

export type ProductPayload = {
  product: VisionProductResult
}

export function phoneKeyFromDigits(digits: string): string {
  return normalizeBrPhoneDigits(digits)
}

export async function savePending(
  phoneDigits: string,
  kind: PendingKind,
  payload: ExpensePayload | ProductPayload
): Promise<void> {
  const key = phoneKeyFromDigits(phoneDigits)
  await prisma.whatsAppPendingAction.upsert({
    where: { phoneKey: key },
    create: {
      phoneKey: key,
      kind,
      payload: JSON.stringify(payload),
    },
    update: {
      kind,
      payload: JSON.stringify(payload),
    },
  })
}

export async function takePending(phoneDigits: string): Promise<{
  kind: PendingKind
  payload: ExpensePayload | ProductPayload
} | null> {
  const key = phoneKeyFromDigits(phoneDigits)
  const row = await prisma.whatsAppPendingAction.findUnique({
    where: { phoneKey: key },
  })
  if (!row) return null
  try {
    const parsed = JSON.parse(row.payload) as ExpensePayload | ProductPayload
    return { kind: row.kind as PendingKind, payload: parsed }
  } catch {
    return null
  }
}

export async function clearPending(phoneDigits: string): Promise<void> {
  const key = phoneKeyFromDigits(phoneDigits)
  await prisma.whatsAppPendingAction.deleteMany({ where: { phoneKey: key } })
}
