/**
 * Contador HUB · porta de persistência dos alertas (GOAL 017).
 *
 * Leitura e escrita são interfaces separadas: GET só recebe a de leitura.
 */
import type { Competencia } from "@/lib/contador/competencia"
import type {
  CompetenciaAlerta,
  DocumentoAlerta,
  EventoAlertaRow,
  GuiaAlerta,
  NovoEventoAlerta,
  PacoteAlerta,
} from "./tipos"

export type DedupeAlerta = Readonly<{
  competenciaId: string
  tipo: string
  regra: string
  alvo: string
  janela: string
}>

export interface NotificacoesRepoLeitura {
  acharCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaAlerta | null>
  listarDocumentos(competenciaId: string, storeId: string): Promise<DocumentoAlerta[]>
  listarGuias(competenciaId: string, storeId: string): Promise<GuiaAlerta[]>
  listarPacotes(competenciaId: string, storeId: string): Promise<PacoteAlerta[]>
  listarEventos(
    competenciaId: string,
    storeId: string,
    tipos: readonly string[],
  ): Promise<EventoAlertaRow[]>
}

export type DedupeChaveAlerta = Readonly<{
  competenciaId: string
  regra: string
  alvo: string
  janela: string
}>

export interface NotificacoesRepo extends NotificacoesRepoLeitura {
  /**
   * Lock da competência (`SELECT … FOR UPDATE`) + findFirst da chave + create.
   * Duas avaliações concorrentes da mesma chave → um único evento.
   * Falha da transação → zero evento parcial.
   */
  registrarEventoUnico(evento: NovoEventoAlerta, dedupe: DedupeAlerta): Promise<{ criado: boolean }>
  /**
   * Trilha auditável na mesma transação: `alerta_emitido` (se ainda não existir)
   * e `alerta_tratado` (se ainda não existir). Idempotente. Rollback total se falhar.
   */
  garantirEmitidoETratado(
    emitido: NovoEventoAlerta,
    tratado: NovoEventoAlerta,
    chave: DedupeChaveAlerta,
  ): Promise<{ emitidoCriado: boolean; tratadoCriado: boolean }>
}
