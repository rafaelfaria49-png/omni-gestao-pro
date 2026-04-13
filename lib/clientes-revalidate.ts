/** Evento disparado após importação/atualização de clientes para a lista refazer o fetch. */
export const CLIENTES_REVALIDATE_EVENT = "assistec:clientes-revalidate"

export function dispatchClientesRevalidate(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(CLIENTES_REVALIDATE_EVENT))
}

export function subscribeClientesRevalidate(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const fn = () => handler()
  window.addEventListener(CLIENTES_REVALIDATE_EVENT, fn)
  return () => window.removeEventListener(CLIENTES_REVALIDATE_EVENT, fn)
}
