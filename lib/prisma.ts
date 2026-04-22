import { PrismaClient } from "@/generated/prisma"

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

/** Margem para `$connect` explícito (ms). Complementa `connect_timeout` na `DATABASE_URL`. */
const PRISMA_CONNECT_WAIT_MS = Math.min(
  90_000,
  Math.max(8_000, Number(process.env.PRISMA_CONNECT_WAIT_MS || "35000"))
)

/**
 * Uma única instância por processo Node (evita estourar conexões com o Postgres no dev/HMR).
 * Timeouts: use `connect_timeout` e `sslmode` na URL (ver `.env`).
 *
 * O Prisma Client não faz cache HTTP de `findMany`; para evitar respostas antigas no Next.js,
 * use `export const dynamic = "force-dynamic"` nas rotas de API que leem dados ao vivo.
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma
}

/**
 * Aguarda o banco aceitar conexão (útil se a rede oscila 1–2s). Não obrigatório — o Prisma conecta sob demanda.
 */
export async function prismaEnsureConnected(): Promise<void> {
  await Promise.race([
    prisma.$connect(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Prisma $connect > ${PRISMA_CONNECT_WAIT_MS}ms`)), PRISMA_CONNECT_WAIT_MS)
    ),
  ])
}

/**
 * Executa uma operação Prisma com tratamento seguro: não lança se o banco estiver indisponível (evita 500 genérico).
 */
export async function withPrismaSafe<T>(
  op: (db: PrismaClient) => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await op(prisma)
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.error("[prisma]", e)
    }
    return fallback
  }
}
