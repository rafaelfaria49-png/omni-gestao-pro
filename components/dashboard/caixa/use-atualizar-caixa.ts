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
        // Estado local ainda não restaurado / loja trocada no meio da consulta:
        // não é erro do servidor e nada foi decidido — pedir nova tentativa.
        if (outcome.reason === "nao-hidratado" || outcome.reason === "loja-trocada") {
          toast({
            title: "Caixa ainda carregando",
            description:
              outcome.reason === "loja-trocada"
                ? "A loja ativa mudou durante a consulta. Tente atualizar de novo."
                : "O estado do caixa deste dispositivo ainda está sendo carregado. Tente de novo em instantes.",
          })
          return outcome
        }
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

/**
 * Garante que existe sessão de caixa utilizável ANTES de abrir o pagamento.
 *
 * Roda a recuperação contra o servidor em vez de recusar a finalização com uma
 * mensagem morta. Nunca envia a venda: quando a sessão é recuperada, quem
 * finaliza de novo é o operador — assim uma primeira resposta inconclusiva não
 * vira venda duplicada.
 */
export function useGarantirSessaoCaixa() {
  const { caixa, sessaoId } = useCaixa()
  const { atualizando, atualizarCaixa } = useAtualizarCaixa("finalizacao")

  const garantirSessao = useCallback(async (): Promise<"ok" | "recuperada" | "bloqueada"> => {
    if (caixa.isOpen && sessaoId?.trim()) return "ok"

    const outcome = await atualizarCaixa()
    if (outcome?.ok && (outcome.status === "adotada" || outcome.status === "em-sincronia")) {
      return "recuperada"
    }
    return "bloqueada"
  }, [atualizarCaixa, caixa.isOpen, sessaoId])

  return { garantirSessao, atualizando }
}
