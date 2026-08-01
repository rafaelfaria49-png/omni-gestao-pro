/**
 * Portal externo — login (GOAL 014, §13).
 *
 * Server component: quem já tem sessão válida vai direto ao portal; sessão
 * inválida/ausente/expirada cai no formulário (client component). O formulário
 * NUNCA diferencia "usuário inexistente" de "senha errada" — a API responde
 * uma única mensagem genérica (R-2).
 */
import { redirect } from "next/navigation"
import { validarSessaoDaPagina } from "../_sessao"
import { LoginForm } from "./login-form"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const sessao = await validarSessaoDaPagina()
  if (sessao.ok) redirect("/contador-externo")
  return <LoginForm indisponivel={!sessao.ok && sessao.motivo === "indisponivel"} />
}
