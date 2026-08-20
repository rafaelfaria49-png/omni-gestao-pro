/**
 * Contador HUB · Portal externo read-only — erros de domínio e mapeamento HTTP (GOAL 015).
 *
 * Mesmo padrão de `auth-externa/http.ts`: devolve `{ status, body }` PURO (sem
 * `next/server`) para o domínio continuar testável em node — a conversão para
 * `NextResponse` fica na camada de rota (fase 2).
 *
 * Reuso deliberado dos erros tipados já existentes (documentos, comentários,
 * fechamento, status): a mensagem segura já é a do domínio e o mapeamento fica
 * consistente com o HUB interno. Erros NOVOS do portal ficam neste módulo.
 */
import {
  CompetenciaFechadaError,
  DocumentoNaoEncontradoError,
} from "@/lib/contador/documentos/service"
import { ComentarioValidacaoError } from "@/lib/contador/comentarios/service"
import {
  CompetenciaNaoEncontradaError,
  PacoteNaoEncontradoError,
} from "@/lib/contador/fechamento/service"
import {
  StatusInvalidoError,
  TransicaoConcorrenteError,
  TransicaoInvalidaError,
} from "@/lib/contador/status/matriz"
import {
  StorageConfigError,
  StorageProviderError,
} from "@/lib/contador/documentos/config"
import { StorageError } from "@/lib/contador/documentos/storage-types"
import type { RespostaHttp } from "@/lib/contador/auth-externa/http"

/** Papel LEITURA tentou uma ação exclusiva de CONFERENCIA (403 de domínio). */
export class PortalPapelInsuficienteError extends Error {
  readonly code = "PORTAL_PAPEL_INSUFICIENTE" as const
  constructor() {
    super("Esta ação exige o papel de conferência nesta loja.")
    this.name = "PortalPapelInsuficienteError"
  }
}

function resposta(status: number, body: Record<string, unknown>): RespostaHttp {
  return Object.freeze({ status, body })
}

/**
 * Traduz um erro de domínio do portal para `{ status, body }` seguro.
 *
 * Anti-enumeração: "não encontrado" é sempre 404 com a mensagem do domínio —
 * um documento/pacote de OUTRA loja produz exatamente a mesma resposta de um
 * id inexistente (a existência alheia nunca é confirmada).
 */
export function respostaErroPortal(e: unknown): RespostaHttp {
  if (e instanceof PortalPapelInsuficienteError) {
    return resposta(403, { ok: false, mensagem: e.message })
  }
  if (
    e instanceof DocumentoNaoEncontradoError ||
    e instanceof PacoteNaoEncontradoError ||
    e instanceof CompetenciaNaoEncontradaError
  ) {
    return resposta(404, { ok: false, mensagem: e.message })
  }
  if (e instanceof CompetenciaFechadaError) {
    return resposta(409, { ok: false, mensagem: e.message })
  }
  if (e instanceof TransicaoInvalidaError || e instanceof TransicaoConcorrenteError) {
    // Transição fora da matriz ou corrida perdida: conflito com o estado atual.
    return resposta(409, { ok: false, mensagem: e.message })
  }
  if (e instanceof ComentarioValidacaoError) {
    return resposta(422, { ok: false, campo: e.campo, mensagem: e.message })
  }
  if (e instanceof StatusInvalidoError) {
    return resposta(422, { ok: false, mensagem: e.message })
  }
  // Storage indisponível — MESMO contrato operacional para as três causas:
  //   `StorageProviderError`  provider não declarado ou não produtivo;
  //   `StorageConfigError`    configuração R2 ausente/incompleta;
  //   `StorageError`          falha externa do provider já convertida.
  // A causa exata fica no log server-side; o corpo é fixo e não distingue as três.
  // Distinguir vazaria estado de configuração do servidor para o contador externo, e o
  // `message` de cada erro carrega detalhe (provider declarado, nomes de variáveis) que
  // não pertence a uma resposta pública — por isso NUNCA se usa `e.message` aqui.
  if (
    e instanceof StorageProviderError ||
    e instanceof StorageConfigError ||
    e instanceof StorageError
  ) {
    return resposta(503, {
      ok: false,
      mensagem: "Storage indisponível no momento. Tente novamente em instantes.",
    })
  }
  return resposta(500, {
    ok: false,
    mensagem: "Não foi possível concluir a operação agora. Tente novamente em instantes.",
  })
}
