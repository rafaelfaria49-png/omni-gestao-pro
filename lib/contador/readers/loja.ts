/**
 * Contador HUB · identificação da loja ativa (GOAL 023).
 *
 * Fonte canônica: a linha `Store` da loja já resolvida pelo escopo interno
 * (`requireContadorScope`). Somente leitura, sempre escopada — o `storeId` nunca
 * vem do cliente. Não substitui `useConfigEmpresa` (contexto de navegador,
 * hidratado do `localStorage`): esta leitura é server-side e é a única exibida
 * pela aba Configurações do HUB como cadastro persistido.
 *
 * Devolve `null` só quando a linha não existe; falha de banco propaga para o
 * chamador decidir (a page isola e mostra estado honesto, nunca dado inventado).
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"

/** Projeção mínima exibida no HUB. Sem endereço, telefone, plano ou logo. */
export type IdentificacaoLoja = Readonly<{
  id: string
  /** `Store.name` — vazio quando a loja ainda não preencheu o cadastro. */
  nome: string
  /** `Store.cnpj` verbatim — nunca formatado aqui, nunca substituído por exemplo. */
  cnpj: string
}>

/** Porta mínima injetável (espelha o padrão dos demais readers). */
export type LojaReaderClient = {
  store: {
    findUnique(args: Record<string, unknown>): Promise<{ id: string; name: string; cnpj: string } | null>
  }
}

export async function lerIdentificacaoLojaComCliente(
  scope: ContadorScopeInterno,
  client: LojaReaderClient,
): Promise<IdentificacaoLoja | null> {
  const row = await client.store.findUnique({
    where: { id: scope.storeId },
    select: { id: true, name: true, cnpj: true },
  })
  if (!row) return null
  return Object.freeze({
    id: row.id,
    nome: (row.name ?? "").trim(),
    cnpj: (row.cnpj ?? "").trim(),
  })
}

export async function lerIdentificacaoLoja(
  scope: ContadorScopeInterno,
): Promise<IdentificacaoLoja | null> {
  await prismaEnsureConnected()
  return lerIdentificacaoLojaComCliente(scope, prisma as unknown as LojaReaderClient)
}
