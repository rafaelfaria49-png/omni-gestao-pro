/**
 * Contador HUB · mapeamento HTTP dos erros de status/comentário/timeline (GOAL 011).
 *
 * REUTILIZA o mapeador de documentos (GOAL 010) como fallback — o contrato de
 * resposta (`{ ok:false, mensagem }`, nunca stack/token/path) é o mesmo do HUB.
 * Aqui só entram os erros que o GOAL 011 introduziu.
 */
import { NextResponse } from "next/server"
import { respostaErro as respostaErroDocumentos } from "@/lib/contador/documentos/http"
import { ComentarioValidacaoError } from "@/lib/contador/comentarios/service"
import {
  MotivoObrigatorioError,
  PermissaoTransicaoError,
  StatusInvalidoError,
  TransicaoConcorrenteError,
  TransicaoInvalidaError,
} from "./matriz"

export function respostaErroContador(e: unknown): NextResponse {
  if (e instanceof StatusInvalidoError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 422 })
  }
  if (e instanceof MotivoObrigatorioError) {
    return NextResponse.json(
      { ok: false, code: e.code, campo: "motivo", mensagem: e.message },
      { status: 422 },
    )
  }
  if (e instanceof ComentarioValidacaoError) {
    return NextResponse.json(
      { ok: false, code: e.code, campo: e.campo, mensagem: e.message },
      { status: 422 },
    )
  }
  if (e instanceof PermissaoTransicaoError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 403 })
  }
  if (e instanceof TransicaoInvalidaError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 409 })
  }
  if (e instanceof TransicaoConcorrenteError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 409 })
  }
  return respostaErroDocumentos(e)
}
