/**
 * Resolver do Secret Provider fiscal (GOAL-016C) — ponto ÚNICO de decisão de backend.
 *
 * Lê a configuração do ambiente (`FISCAL_SECRET_PROVIDER`) e devolve o provider server-only:
 *  - ausente/`"env"` → `EnvVault` (piloto/homologação, ADR-0009 D2);
 *  - qualquer outro valor (ex.: `"supabase_vault"`, ADR-0014) → provider declarado mas AINDA NÃO
 *    implementado ⇒ `vault = null` + `disponivel = false` ⇒ TUDO fail-closed. Nunca cai em
 *    fallback permissivo e nunca finge um backend que não existe.
 *
 * SERVER-ONLY: este módulo decide sobre secrets de plataforma — nunca importar no cliente.
 */
import { EnvVault, ENV_VAULT_BACKEND, type EnvLike } from "./env-vault"
import type { FiscalSecretVault, FiscalVaultAvailability } from "./fiscal-secret-vault"

/** Nome de configuração do provider de produção (ADR-0014) — ainda não implementado. */
export const PROVIDER_SUPABASE_VAULT = "supabase_vault"

export type FiscalSecretProviderResolution = {
  /** Nome canônico do provider resolvido (`env-piloto` ou o valor declarado indisponível). */
  provider: string
  /** Instância do cofre quando disponível; `null` ⇒ fail-closed (nada resolve). */
  vault: FiscalSecretVault | null
  availability: FiscalVaultAvailability
}

const CAPACIDADES_DESLIGADAS = { leitura: false, escrita: false, rotacao: false, revogacao: false } as const

/**
 * Resolve o provider do cofre fiscal. Nunca lança: provider ausente/desconhecido vira
 * indisponibilidade declarada, e o caller decide (fail-closed por contrato).
 */
export function resolveFiscalSecretProvider(env: EnvLike = process.env as EnvLike): FiscalSecretProviderResolution {
  const declarado = String(env.FISCAL_SECRET_PROVIDER ?? "").trim().toLowerCase()

  if (declarado === "" || declarado === "env") {
    const vault = new EnvVault({ env })
    return {
      provider: ENV_VAULT_BACKEND,
      vault,
      availability: {
        disponivel: true,
        backend: ENV_VAULT_BACKEND,
        capacidades: { leitura: true, escrita: false, rotacao: false, revogacao: false },
        mensagem:
          "EnvVault do piloto: leitura por env de plataforma; escrita/rotação/revogação por provisionamento manual.",
      },
    }
  }

  // Provider declarado mas não implementado neste GOAL (ex.: supabase_vault — ADR-0014).
  // Fail-closed honesto: reporta indisponível; NUNCA cai em outro backend silenciosamente.
  return {
    provider: declarado,
    vault: null,
    availability: {
      disponivel: false,
      backend: declarado,
      capacidades: { ...CAPACIDADES_DESLIGADAS },
      mensagem: `Secret provider "${declarado}" declarado, mas ainda não implementado neste ambiente — cofre indisponível (fail-closed).`,
    },
  }
}
