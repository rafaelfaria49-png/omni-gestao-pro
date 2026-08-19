/**
 * Criação de User só para o ledger de créditos.
 *
 * Nunca cria supervisor autenticável: role CAIXA (não ADMIN) e `User.pin` opaco,
 * sem `pinHash`. O PIN real nunca entra aqui — inclusive o antigo `mock-${userId}`.
 */

import { newOpaqueUnusablePin } from "@/lib/auth/pin-hash"

export const CREDITS_LEDGER_USER_ROLE = "CAIXA"

export function creditsLedgerUserCreateData(userId: string): {
  id: string
  name: string
  pin: string
  role: string
} {
  return {
    id: userId,
    name: "Administrador",
    pin: newOpaqueUnusablePin(),
    role: CREDITS_LEDGER_USER_ROLE,
  }
}
