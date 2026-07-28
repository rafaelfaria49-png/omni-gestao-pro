/**
 * Contador HUB · mapeamento HTTP dos erros de fechamento (GOAL 012).
 *
 * REUTILIZA o mapeador do GOAL 011 (que já cai no do GOAL 010) como fallback — o
 * contrato de resposta (`{ ok:false, code?, mensagem }`, nunca stack/token/path) é o
 * mesmo de todo o HUB. Aqui só entram os erros que o GOAL 012 introduziu.
 */
import { NextResponse } from "next/server"
import { respostaErroContador } from "@/lib/contador/status/http"
import {
  CompetenciaJaFechadaError,
  CompetenciaNaoEncontradaError,
  CompetenciaNaoFechadaError,
  ConfirmacaoInvalidaError,
  FechamentoConcorrenteError,
  MotivoReaberturaObrigatorioError,
  PacoteNaoEncontradoError,
  PendenciaDesconhecidaError,
  PendenciasNaoAssumidasError,
  PermissaoFechamentoError,
} from "./service"

export function respostaErroFechamento(e: unknown): NextResponse {
  if (e instanceof PermissaoFechamentoError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 403 })
  }
  if (e instanceof ConfirmacaoInvalidaError) {
    return NextResponse.json(
      { ok: false, code: e.code, campo: "confirmacao", esperado: e.esperado, mensagem: e.message },
      { status: 422 },
    )
  }
  if (e instanceof MotivoReaberturaObrigatorioError) {
    return NextResponse.json(
      { ok: false, code: e.code, campo: "motivo", mensagem: e.message },
      { status: 422 },
    )
  }
  if (e instanceof PendenciasNaoAssumidasError) {
    return NextResponse.json(
      { ok: false, code: e.code, campo: "pendenciasAssumidas", faltantes: e.faltantes, mensagem: e.message },
      { status: 422 },
    )
  }
  if (e instanceof PendenciaDesconhecidaError) {
    return NextResponse.json(
      { ok: false, code: e.code, campo: "pendenciasAssumidas", desconhecidas: e.desconhecidas, mensagem: e.message },
      { status: 422 },
    )
  }
  if (e instanceof CompetenciaJaFechadaError || e instanceof CompetenciaNaoFechadaError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 409 })
  }
  if (e instanceof FechamentoConcorrenteError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 409 })
  }
  if (e instanceof CompetenciaNaoEncontradaError || e instanceof PacoteNaoEncontradoError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 404 })
  }
  return respostaErroContador(e)
}
