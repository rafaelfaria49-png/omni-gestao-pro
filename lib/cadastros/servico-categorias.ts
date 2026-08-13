export type ServicoCategoriaOption = {
  id: string
  name: string
  type: string
  active: boolean
}
export function categoriasAtivasDeServico<T extends ServicoCategoriaOption>(categorias: T[]): T[] {
  return categorias.filter((categoria) => categoria.active && categoria.type === "servico")
}

export function categoriaCriadaSelecionada<T extends ServicoCategoriaOption>(
  categorias: T[],
  criada: T,
): { categorias: T[]; selectedName: string } {
  const semDuplicata = categorias.filter((categoria) => categoria.id !== criada.id)
  return {
    categorias: categoriasAtivasDeServico([...semDuplicata, criada]).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    ),
    selectedName: criada.name,
  }
}
