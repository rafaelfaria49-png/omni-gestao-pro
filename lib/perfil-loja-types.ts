/** Valores persistidos em `app_loja_settings.perfil_loja` e na API. */
export type PerfilLojaId = "assistencia" | "supermercado" | "variedades"

export const PERFIL_LOJA_DEFAULT: PerfilLojaId = "assistencia"

export const PERFIL_LOJA_LABELS: Record<PerfilLojaId, string> = {
  assistencia: "Assistência Técnica",
  supermercado: "Supermercado",
  variedades: "Variedades",
}

/** Quando false, ocultamos Laudo e campos de técnico na OS e o laudo em Serviços. */
export function perfilMostraModuloTecnicoAssistencia(perfil: PerfilLojaId): boolean {
  return perfil === "assistencia"
}

export function parsePerfilLoja(raw: string | null | undefined): PerfilLojaId {
  if (raw === "supermercado" || raw === "variedades" || raw === "assistencia") return raw
  return PERFIL_LOJA_DEFAULT
}
