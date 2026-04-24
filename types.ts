export type UserRole = "ADMIN" | "CAIXA"

export type CurrentUser = {
  /** Identificador local do operador do caixa (browser/dispositivo). */
  id: string
  role: UserRole
}

