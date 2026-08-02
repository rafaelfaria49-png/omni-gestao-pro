"use client"

import { useCallback, useRef, useState } from "react"
import { useCaixa } from "./caixa-provider"
import { useToast } from "@/hooks/use-toast"
import type { CaixaRefreshOutcome } from "@/lib/pdv-caixa-session"

/**
 * Ação "Atualizar caixa" — única em todos os PDVs.
 *
 * Reconsulta a sessão ativa da loja no servidor, re-hidrata o estado local e
 * informa o resultado real (recuperada / já em dia / não existe caixa aberto /
 * falha de consulta). NUNCA mexe no carrinho e NUNCA reenvia venda.
 *
 * `contexto: "finalizacao"` só muda o texto: depois de um 409 do servidor o
 * operador precisa revisar e finalizar de novo, por ação dele.
 */
export function useAtualizarCaixa(contexto: "manual" | "finalizacao" = "manual") {
  const { refreshSession } = useCaixa()
  const { toast } = useToast()
  const [atualizando, setAtualizando] = useState(false)
  // Impede execuções simultâneas mesmo com cliques repetidos rápidos (o state
  // de React não atualiza a tempo entre dois cliques no mesmo frame).
  const emAndamentoRef = useRef(false)

  const atualizarCaixa = useCallback(async (): Promise<CaixaRefreshOutcome | null> => {
    if (emAndamentoRef.current) return null
    emAndamentoRef.current = true
    setAtualizando(true)
    try {
      const outcome = await refreshSession()

      if (!outcome.ok) {
        toast({
          variant: "destructive",
          title: "Não foi possível atualizar o caixa",
          description:
            outcome.reason === "rede"
              ? "Sem resposta do servidor. Verifique a conexão e tente de novo — o carrinho foi mantido."
              : "O servidor recusou a consulta da sessão de caixa. O carrinho foi mantido.",
        })
        return outcome
      }

      if (outcome.status === "adotada") {
        toast({
          title: "Caixa atualizado",
          description:
            contexto === "finalizacao"
              ? "Caixa atualizado. Revise e finalize novamente."
              : "Sessão de caixa recuperada do servidor. O carrinho foi mantido.",
        })
        return outcome
      }

      if (outcome.status === "em-sincronia") {
        toast({
          title: "Caixa já estava atualizado",
          description: "A sessão local já é a mesma que está aberta no servidor.",
        })
        return outcome
      }

      if (outcome.status === "outra-loja") {
        toast({
          variant: "destructive",
          title: "Sessão de outra unidade",
          description: "O caixa aberto pertence a outra loja e não pode ser usado aqui.",
        })
        return outcome
      }

      toast({
        variant: "destructive",
        title: "Nenhum caixa aberto",
        description: "Não há sessão de caixa aberta nesta loja. Abra o caixa — o carrinho foi mantido.",
      })
      return outcome
    } finally {
      emAndamentoRef.current = false
      setAtualizando(false)
    }
  }, [contexto, refreshSession, toast])

  return { atualizando, atualizarCaixa }
}
