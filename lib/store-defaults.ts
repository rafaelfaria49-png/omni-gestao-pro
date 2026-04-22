/**
 * Identificador da unidade matriz padrão (multi-loja). Demais unidades vêm do banco / header / cookie.
 */
export const LEGACY_PRIMARY_STORE_ID = "loja-1" as const

/** Cookie HTTP (Path=/) espelhando a unidade ativa do Header — leitura em rotas API sem header explícito. */
export const ASSISTEC_ACTIVE_STORE_COOKIE = "assistec-active-store"
