"use client"

/**
 * Portal externo — botão de logout (GOAL 014).
 * Chama a API de logout (revoga a linha da sessão e limpa o cookie) e volta ao login.
 */
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function LogoutButton() {
  const router = useRouter()
  const [saindo, setSaindo] = useState(false)

  const sair = async () => {
    setSaindo(true)
    try {
      await fetch("/api/contador-externo/auth/logout", { method: "POST" })
    } finally {
      // Mesmo com falha de rede, o cookie local é limpo pelo response quando ele
      // chega; em qualquer caso, a tela de login é o destino seguro.
      router.push("/contador-externo/login")
      router.refresh()
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={sair} disabled={saindo}>
      {saindo ? "Saindo…" : "Sair"}
    </Button>
  )
}
