/**
 * Contador HUB · Portal externo read-only — helpers de TESTE (GOAL 015).
 *
 * USO EXCLUSIVO DOS TESTES colocalizados. Nenhum banco é tocado: os repos são
 * fakes in-memory com a semântica relevante (mesmo padrão de `auth-externa/fakes.ts`
 * e `__tests__/status-service.test.ts`).
 */
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import type { PapelExterno } from "@/lib/contador/auth-externa/tipos"
import type { NovoEventoPortal, PortalEventosRepo } from "../eventos"

/**
 * Loja padrão das fixtures. Constante NOMEADA de propósito: o guard estático
 * `lib/multi-loja-no-hardcoded-fallback.test.ts` (F-02) exige ZERO ocorrências
 * do id da loja legada aplicado como fallback de coalescência em `app/` e `lib/`,
 * e a varredura não abre exceção para arquivos de teste. Aqui não há fallback de
 * escopo real — é só o valor default de um fixture in-memory.
 */
export const LOJA_FIXTURE = "loja-1"

/**
 * Escopo externo de FIXTURE. Os serviços do portal consomem apenas
 * `storeId`/`usuario.id`/`papel`; a prova de que o escopo REAL do gate é aceito
 * pela factory nominal fica em `escopo.test.ts` (integração com o GOAL 014).
 */
export function escopoExternoFake(
  over: Readonly<{ storeId?: string; usuarioId?: string; papel?: PapelExterno }> = {},
): ContadorScopeExterno {
  return {
    ok: true,
    usuario: Object.freeze({
      id: over.usuarioId ?? "usr-ext-1",
      email: "contador@escritorio.com",
      nome: "Contador Fixture",
      tokenVersion: 1,
    }),
    sessaoId: "ses-1",
    storeId: over.storeId ?? LOJA_FIXTURE,
    papel: over.papel ?? "LEITURA",
    rotacao: null,
  } as unknown as ContadorScopeExterno
}

export type RepoEventosFalso = PortalEventosRepo & {
  eventos: NovoEventoPortal[]
}

/** Repo de eventos in-memory com o dedupe de recebimento por (competencia, ator, versao). */
export function criarRepoEventosFalso(): RepoEventosFalso {
  const eventos: NovoEventoPortal[] = []
  return {
    eventos,
    async registrarEvento(evento) {
      eventos.push(evento)
      // O serviço devolve este `criadoEm` já na 1ª resposta — instante da trilha,
      // determinístico no fake, para a 1ª e a 2ª chamadas responderem igual.
      return { criadoEm: CRIADO_EM_FAKE }
    },
    async acharRecebimentoPacote({ storeId, competenciaId, atorId, versao }) {
      const existente = eventos.find(
        (e) =>
          e.tipo === "pacote_recebimento_confirmado" &&
          e.storeId === storeId &&
          e.competenciaId === competenciaId &&
          e.atorId === atorId &&
          e.metadata?.versao === versao,
      )
      // O serviço devolve `existente.criadoEm` na 2ª chamada — instante fixo e
      // determinístico no fake, para o teste comparar com o da 1ª chamada.
      return existente ? { criadoEm: CRIADO_EM_FAKE } : null
    },
  }
}

/** Instante determinístico devolvido pelo dedupe do fake (2ª chamada em diante). */
export const CRIADO_EM_FAKE = new Date("2026-08-01T12:00:00.000Z")
