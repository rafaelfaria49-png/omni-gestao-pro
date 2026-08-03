/**
 * POST /api/contador-externo/lojas/[loja]/pacotes/confirmar — confirmação de
 * recebimento do pacote, IDEMPOTENTE (GOAL 015). Body `{ competencia, versao }`;
 * a confirmação é o evento `pacote_recebimento_confirmado` — repetir devolve o
 * MESMO `{ confirmado, confirmadoEm }` sem gravar nada. Permitida aos dois
 * papéis (matriz §7.2).
 */
import { confirmarRecebimentoPacotePortal, repoEventosPortal, repoFechamentoPortal } from "@/lib/contador/portal"
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
    const recebimento = await confirmarRecebimentoPacotePortal(
      guard.escopo,
      comp,
      versao,
      contextoAtorPortal(req, guard.escopo),
      { repo: repoFechamentoPortal(), eventos: repoEventosPortal() },
    )
    const res = jsonOkExterno({ ok: true, recebimento })
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
