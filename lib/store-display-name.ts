/** Rótulo amigável quando não há nome fantasia no cadastro (ex.: `loja-2` → "Loja 2"). */
export function formatLojaPublicLabel(storeId: string): string {
  const id = storeId.trim()
  if (!id) return "Loja"
  const m = /^loja-(\d+)$/i.exec(id)
  if (m) return `Loja ${m[1]}`
  return `Loja ${id}`
}

/** Nome fantasia (`Store.name`) ou fallback por id da unidade. */
export function nomeFantasiaOuFallbackUnidade(storeId: string, nameFromStore: string): string {
  const t0 = nameFromStore.trim()
  const t = isProfileLabelLike(t0) ? "" : t0
  const loja = formatLojaPublicLabel(storeId)
  if (t) return `${loja} - ${t}`
  return loja
}

/**
 * Mesmo fallback, mas quando o id não ajuda (ex.: UUID), usa a ordem/posição
 * para manter o rótulo limpo: Loja 1, Loja 2, Loja 3…
 */
export function nomeFantasiaOuFallbackUnidadePorOrdem(
  storeId: string,
  nameFromStore: string,
  indexZeroBased: number | null | undefined
): string {
  const t0 = nameFromStore.trim()
  const t = isProfileLabelLike(t0) ? "" : t0
  const id = storeId.trim()
  const loja =
    /^loja-(\d+)$/i.test(id)
      ? formatLojaPublicLabel(id)
      : typeof indexZeroBased === "number" && Number.isFinite(indexZeroBased) && indexZeroBased >= 0
        ? `Loja ${indexZeroBased + 1}`
        : formatLojaPublicLabel(id)
  if (t) return `${loja} - ${t}`
  return loja
}

const PERFIL_SELLO = {
  ASSISTENCIA: "Assistência",
  VARIEDADES: "Variedades",
  SUPERMERCADO: "Supermercado",
} as const

function norm(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * Segurança: algumas telas antigas gravaram o perfil como se fosse o nome da loja
 * (ex.: `nomeFantasia = "Supermercado"`). Isso NUNCA deve substituir o nome principal.
 */
function isProfileLabelLike(name: string): boolean {
  const n0 = norm(name)
  const n = n0.replace(/[^a-z]/g, "")
  if (!n) return false
  if (n === norm(PERFIL_SELLO.ASSISTENCIA).replace(/[^a-z]/g, "")) return true
  if (n === norm(PERFIL_SELLO.VARIEDADES).replace(/[^a-z]/g, "")) return true
  if (n === norm(PERFIL_SELLO.SUPERMERCADO).replace(/[^a-z]/g, "")) return true
  // também aceita o valor cru do enum vindo de API/config
  if (n === "assistencia" || n === "variedades" || n === "supermercado") return true
  return false
}

/** Texto curto para selo de perfil (header/sidebar). */
export function labelPerfilUnidade(profile: string | null | undefined): string {
  const p = (profile || "ASSISTENCIA").toUpperCase() as keyof typeof PERFIL_SELLO
  return PERFIL_SELLO[p] ?? PERFIL_SELLO.ASSISTENCIA
}

/** Selo só para perfis não padrão (menos ruído visual). */
export function mostrarSeloPerfilUnidade(profile: string | null | undefined): boolean {
  const p = (profile || "ASSISTENCIA").toUpperCase()
  return p === "VARIEDADES" || p === "SUPERMERCADO"
}
