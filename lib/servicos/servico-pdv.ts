export type ServicoOperacional = {
  nome?: string | null
  categoria?: string | null
  preco?: number | null
  active?: boolean
  status?: string | null
}

/** Regra única para um Serviço real poder ser oferecido no PDV. */
export function isServicoDisponivelParaVenda(servico: ServicoOperacional): boolean {
  const nome = servico.nome?.trim() ?? ""
  const categoria = servico.categoria?.trim() ?? ""
  const preco = Number(servico.preco ?? 0)
  return (
    servico.active === true &&
    servico.status === "Ativo" &&
    nome.length > 0 &&
    categoria.length > 0 &&
    categoria !== "—" &&
    Number.isFinite(preco) &&
    preco > 0
  )
}
