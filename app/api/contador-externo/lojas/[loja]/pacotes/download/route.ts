/**
 * POST /api/contador-externo/lojas/[loja]/pacotes/download — autoriza o download
 * de UMA versão do pacote oficial (GOAL 015). Body `{ competencia, versao }`
 * validados (AAAA-MM + inteiro ≥ 1); evento `pacote_baixado` externo + IP/UA
 * ANTES da URL; presigned ≤ 300s; storageRef nunca na resposta.
 */
import { autorizarDownloadPacotePortal, repoEventosPortal, repoFechamentoPortal, storagePacotesPortal } from "@/lib/contador/portal"
import { respostaErroPortal } from "@/lib/contador/portal/erros"
import { lerCorpoJsonExterno } from "@/lib/contador/auth-externa/http"
import { aplicarRotacaoExterna, jsonExterno, jsonOkExterno, temChaveProibida } from "../../../../_shared"
import {
  competenciaDoBody,
  contextoAtorPortal,
  guardPortalExterno,
  respostaChaveProibidaPortal,
  respostaValidacaoPortal,
  versaoDoBody,
} from "../../../../_portal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request, ctx: { params: Promise<{ loja: string }> }) {
  const { loja } = await ctx.params
  const guard = await guardPortalExterno(req, loja)
  if (!guard.ok) return guard.resposta

  const body = await lerCorpoJsonExterno(req)
  if (temChaveProibida(body)) return respostaChaveProibidaPortal()

  const comp = competenciaDoBody(body.competencia)
  if (!comp) return respostaValidacaoPortal("competencia", "Competência inválida. Use AAAA-MM.")
  const versao = versaoDoBody(body.versao)
  if (versao === null) return respostaValidacaoPortal("versao", "Versão inválida. Use um inteiro maior ou igual a 1.")

  try {
    const download = await autorizarDownloadPacotePortal(
      guard.escopo,
      comp,
      versao,
      contextoAtorPortal(req, guard.escopo),
      { repo: repoFechamentoPortal(), storage: storagePacotesPortal(), eventos: repoEventosPortal() },
    )
    const res = jsonOkExterno({ ok: true, download })
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
