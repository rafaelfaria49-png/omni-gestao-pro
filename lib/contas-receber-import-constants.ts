/** Nomes após o hífen na descrição que são vendedor/dono, não cliente final (evita poluir busca). */
/** Nomes tratados como “consumidor final” em importações legadas (evitar dados pessoais fixos). */
export const NOMES_EQUIV_VENDEDOR_CONSUMIDOR_FINAL = ["Consumidor final"] as const

export function normNomePessoa(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
}

export function isNomeVendedorLojaTratarConsumidorFinal(nome: string): boolean {
  const n = normNomePessoa(nome)
  if (!n) return false
  return NOMES_EQUIV_VENDEDOR_CONSUMIDOR_FINAL.some((v) => normNomePessoa(v) === n)
}
