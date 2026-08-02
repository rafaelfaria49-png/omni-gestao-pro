"use client"

import { useCallback, useEffect, useRef } from "react"
import {
  clearCartDraft,
  readCartDraft,
  revalidateCartDraft,
  writeCartDraft,
  type CartDraftCatalogItem,
  type CartDraftCustomer,
  type CartDraftIssue,
  type CartDraftLine,
  type PdvModalidade,
} from "@/lib/pdv-cart-draft"

/** Espera o catálogo assentar antes de gravar/restaurar (evita flush de carrinho vazio no mount). */
const PERSIST_DEBOUNCE_MS = 400

export type CartDraftRestored = {
  lines: CartDraftLine[]
  customer: CartDraftCustomer | null
  discountReais: number
  discountPercent: number
  issues: CartDraftIssue[]
  /** Sessão de caixa em que o rascunho foi montado — pode não ser a atual. */
  caixaSessaoId: string | null
  /**
   * O rascunho veio de uma sessão de caixa que não é mais a aberta. O carrinho é
   * mantido e a venda será registrada na sessão ATUAL — o operador precisa saber
   * disso e confirmar a finalização de novo (nada é enviado automaticamente).
   */
  sessaoTrocada: boolean
}

/**
 * Rascunho do carrinho compartilhado pelos PDVs.
 *
 * Restaura uma única vez por escopo (loja + modalidade + terminal) assim que o
 * catálogo estiver disponível, revalidando produtos/preços/estoque. Depois disso
 * espelha o carrinho no localStorage a cada mudança.
 *
 * O rascunho só some quando o carrinho fica vazio — o que acontece após venda
 * confirmada ou "Limpar carrinho". F5, remount, nova aba, logout/login e erro de
 * caixa NÃO apagam nada.
 */
export function usePdvCartDraft(params: {
  storeId: string
  modalidade: PdvModalidade
  terminalId?: string | null
  /** Catálogo já carregado — sem ele a revalidação marcaria tudo como indisponível. */
  ready: boolean
  catalog: CartDraftCatalogItem[]
  lines: CartDraftLine[]
  customer?: CartDraftCustomer | null
  discountReais?: number
  discountPercent?: number
  caixaSessaoId?: string | null
  onRestore: (restored: CartDraftRestored) => void
}): { clearDraft: () => void } {
  const {
    storeId,
    modalidade,
    terminalId = null,
    ready,
    catalog,
    lines,
    customer = null,
    discountReais = 0,
    discountPercent = 0,
    caixaSessaoId = null,
    onRestore,
  } = params

  const scopeKey = `${storeId}|${modalidade}|${terminalId ?? ""}`
  const hydratedScopeRef = useRef<string | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs para não reexecutar a restauração a cada render do PDV.
  const catalogRef = useRef(catalog)
  catalogRef.current = catalog
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore
  const caixaSessaoIdRef = useRef(caixaSessaoId)
  caixaSessaoIdRef.current = caixaSessaoId

  useEffect(() => {
    if (!storeId.trim() || !ready) return
    if (hydratedScopeRef.current === scopeKey) return
    hydratedScopeRef.current = scopeKey

    const scope = { storeId, modalidade, terminalId }
    const draft = readCartDraft(scope, localStorage)
    if (!draft) return

    const { lines: restoredLines, issues } = revalidateCartDraft(draft, catalogRef.current)
    if (restoredLines.length === 0) {
      // Todos os itens sumiram do catálogo: não há o que restaurar, e manter o
      // rascunho só faria o aviso se repetir a cada abertura do PDV.
      clearCartDraft(scope, localStorage)
      return
    }

    const sessaoAtual = (caixaSessaoIdRef.current ?? "").trim()
    onRestoreRef.current({
      lines: restoredLines,
      customer: draft.customer,
      discountReais: draft.discountReais,
      discountPercent: draft.discountPercent,
      issues,
      caixaSessaoId: draft.caixaSessaoId,
      sessaoTrocada: Boolean(draft.caixaSessaoId && sessaoAtual && draft.caixaSessaoId !== sessaoAtual),
    })
  }, [modalidade, ready, scopeKey, storeId, terminalId])

  useEffect(() => {
    // Antes de hidratar, gravar sobrescreveria o rascunho salvo com o carrinho vazio.
    if (hydratedScopeRef.current !== scopeKey) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      writeCartDraft(
        {
          storeId,
          modalidade,
          terminalId,
          lines,
          customer,
          discountReais,
          discountPercent,
          caixaSessaoId,
        },
        localStorage,
      )
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [
    caixaSessaoId,
    customer,
    discountPercent,
    discountReais,
    lines,
    modalidade,
    scopeKey,
    storeId,
    terminalId,
  ])

  const clearDraft = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    if (!storeId.trim()) return
    clearCartDraft({ storeId, modalidade, terminalId }, localStorage)
  }, [modalidade, storeId, terminalId])

  return { clearDraft }
}
