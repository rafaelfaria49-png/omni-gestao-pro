import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"
import type { IaMestreBillableAction } from "@/lib/ia-mestre/credit-costs"
import { creditsLedgerUserCreateData } from "@/lib/credits/ledger-user"

/** `userId` deve vir de `resolveCreditsUserId()` (NextAuth `session.user.id` em produção). */

type AssistantCreditMeta = {
  creditsDebited?: boolean
  creditsCost?: number
  creditAction?: IaMestreBillableAction
  debitClientMessageId?: string
  debitedAt?: string
}

function readCreditMeta(meta: unknown): AssistantCreditMeta {
  if (!meta || typeof meta !== "object") return {}
  return meta as AssistantCreditMeta
}

export async function ensureCreditsUser(userId: string): Promise<{ credits: number }> {
  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: creditsLedgerUserCreateData(userId),
    select: { credits: true },
  })
  return { credits: user.credits }
}

export class IaMestreInsufficientCreditsError extends Error {
  readonly cost: number
  readonly balance: number
  constructor(cost: number, balance: number) {
    super("Créditos insuficientes")
    this.name = "IaMestreInsufficientCreditsError"
    this.cost = cost
    this.balance = balance
  }
}

export async function validateIaMestreTurnCredits(userId: string, cost: number): Promise<{ balance: number }> {
  if (!Number.isFinite(cost) || cost <= 0) {
    const { credits } = await ensureCreditsUser(userId)
    return { balance: credits }
  }
  const { credits } = await ensureCreditsUser(userId)
  if (credits < cost) {
    throw new IaMestreInsufficientCreditsError(cost, credits)
  }
  return { balance: credits }
}

export type IaMestreCreditsPayload = {
  cost: number
  balance: number
  debited: boolean
  duplicate: boolean
  action: IaMestreBillableAction
}

export async function debitIaMestreTurnAfterSuccess(params: {
  userId: string
  storeId: string
  conversationId: string
  clientMessageId: string
  assistantMessageId: string
  action: IaMestreBillableAction
  cost: number
}): Promise<IaMestreCreditsPayload> {
  const cost = Math.max(0, Math.floor(params.cost))
  const clientMessageId = params.clientMessageId.trim()
  const action = params.action

  if (cost <= 0) {
    const { credits } = await ensureCreditsUser(params.userId)
    return { cost: 0, balance: credits, debited: false, duplicate: false, action }
  }

  return prisma.$transaction(async (tx) => {
    const assistant = await tx.iaMessage.findFirst({
      where: {
        id: params.assistantMessageId,
        storeId: params.storeId,
        conversationId: params.conversationId,
        role: "assistant",
      },
      select: { id: true, meta: true },
    })
    if (!assistant) throw new Error("Mensagem assistente não encontrada")

    const prior = readCreditMeta(assistant.meta)
    if (prior.creditsDebited && prior.debitClientMessageId === clientMessageId) {
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { credits: true },
      })
      if (!user) throw new Error("Usuário não encontrado")
      return {
        cost: typeof prior.creditsCost === "number" ? prior.creditsCost : cost,
        balance: user.credits,
        debited: false,
        duplicate: true,
        action: prior.creditAction === "image" ? "image" : action,
      }
    }

    const updated = await tx.user.updateMany({
      where: { id: params.userId, credits: { gte: cost } },
      data: { credits: { decrement: cost } },
    })
    if (updated.count !== 1) {
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { credits: true },
      })
      if (!user) throw new Error("Usuário não encontrado")
      throw new IaMestreInsufficientCreditsError(cost, user.credits)
    }

    await tx.usage.create({
      data: {
        userId: params.userId,
        action,
        cost,
      },
      select: { id: true },
    })

    const userAfter = await tx.user.findUnique({
      where: { id: params.userId },
      select: { credits: true },
    })
    if (!userAfter) throw new Error("Usuário não encontrado")

    const prevMeta =
      assistant.meta && typeof assistant.meta === "object" && !Array.isArray(assistant.meta)
        ? (assistant.meta as Record<string, unknown>)
        : {}
    const nextMeta = {
      ...prevMeta,
      creditsDebited: true,
      creditsCost: cost,
      creditAction: action,
      debitClientMessageId: clientMessageId,
      debitedAt: new Date().toISOString(),
    }

    await tx.iaMessage.update({
      where: { id: assistant.id },
      data: { meta: nextMeta as Prisma.InputJsonValue },
    })

    return {
      cost,
      balance: userAfter.credits,
      debited: true,
      duplicate: false,
      action,
    }
  })
}

export async function readIaMestreTurnCreditsState(params: {
  storeId: string
  conversationId: string
  assistantMessageId: string
  clientMessageId: string
  userId: string
  fallbackCost: number
  fallbackAction: IaMestreBillableAction
}): Promise<IaMestreCreditsPayload> {
  const assistant = await prisma.iaMessage.findFirst({
    where: {
      id: params.assistantMessageId,
      storeId: params.storeId,
      conversationId: params.conversationId,
      role: "assistant",
    },
    select: { meta: true },
  })
  const prior = readCreditMeta(assistant?.meta)
  const { credits } = await ensureCreditsUser(params.userId)
  if (prior.creditsDebited && prior.debitClientMessageId === params.clientMessageId.trim()) {
    return {
      cost: typeof prior.creditsCost === "number" ? prior.creditsCost : params.fallbackCost,
      balance: credits,
      debited: false,
      duplicate: true,
      action: prior.creditAction === "image" ? "image" : params.fallbackAction,
    }
  }
  return {
    cost: params.fallbackCost,
    balance: credits,
    debited: false,
    duplicate: false,
    action: params.fallbackAction,
  }
}
