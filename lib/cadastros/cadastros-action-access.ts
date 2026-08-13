"use server"

/** Autoriza Server Actions do Cadastros HUB contra a sessão e a unidade informada. */
export async function requireCadastrosStoreAccess(storeId: string): Promise<string> {
  const sid = (storeId ?? "").trim()
  if (!sid) throw new Error("Loja não selecionada")
  // Import dinâmico mantém os helpers puros de cadastro testáveis em Node sem
  // carregar NextAuth/next/server antes de uma action protegida ser executada.
  const { requireStoreAccess } = await import("@/lib/auth/guard-enterprise")
  const gate = await requireStoreAccess(sid)
  if (!gate.ok) throw new Error(gate.error)
  return sid
}
