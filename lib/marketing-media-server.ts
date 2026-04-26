import { prisma } from "@/lib/prisma"

const DEFAULT_CREDITS = 50

export async function getMarketingMediaCredits(storeId: string): Promise<number> {
  const row = await prisma.storeSettings.upsert({
    where: { storeId },
    create: { storeId },
    update: {},
    select: { marketingMediaCredits: true },
  })
  return row.marketingMediaCredits ?? DEFAULT_CREDITS
}

/** Consome 1 crédito se houver saldo; registra job no ledger. */
export async function consumeMediaCreditAndLog(opts: {
  storeId: string
  kind: "voice" | "video" | "image" | "text"
  cost?: number
  meta?: Record<string, unknown>
}): Promise<{ ok: true; creditsRemaining: number } | { ok: false; creditsRemaining: number }> {
  const { storeId, kind, meta } = opts
  const cost = Math.max(1, Math.floor(Number(opts.cost ?? 1)))
  try {
    const result = await prisma.$transaction(async (tx) => {
      const settings = await tx.storeSettings.upsert({
        where: { storeId },
        create: { storeId },
        update: {},
        select: { marketingMediaCredits: true },
      })
      const current = settings.marketingMediaCredits ?? DEFAULT_CREDITS
      if (current < cost) {
        return { ok: false as const, creditsRemaining: current }
      }
      const next = current - cost
      await tx.storeSettings.update({
        where: { storeId },
        data: { marketingMediaCredits: next },
      })
      await tx.marketingMediaJob.create({
        data: {
          storeId,
          kind: kind === "image" ? "IMAGE" : kind === "voice" ? "VOICE" : kind === "video" ? "VIDEO" : "TEXT",
          kindV2: kind === "image" ? "IMAGE" : kind === "voice" ? "VOICE" : kind === "video" ? "VIDEO" : undefined,
          meta: meta ? (meta as object) : undefined,
          creditsAfter: next,
        },
      })
      return { ok: true as const, creditsRemaining: next }
    })
    return result
  } catch {
    return { ok: false, creditsRemaining: 0 }
  }
}
