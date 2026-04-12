"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Search } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

type Restricao = { tipo: string; detalhe: string }

const mockRestricoes: Restricao[] = [
  { tipo: "Protesto", detalhe: "Título em aberto no cartório local" },
  { tipo: "Pendência Financeira", detalhe: "Atraso em financiamento comercial" },
]

function getScore(doc: string) {
  const n = parseInt(doc.replace(/\D/g, "").slice(-4) || "0", 10)
  return Math.min(1000, 180 + (n % 820))
}

export function ConsultaCredito() {
  const [doc, setDoc] = useState("")
  const [consultado, setConsultado] = useState(false)
  const score = useMemo(() => getScore(doc), [doc])

  const faixa =
    score <= 300
      ? { label: "Crítico", color: "text-red-400", bar: "bg-red-500" }
      : score <= 700
      ? { label: "Alerta", color: "text-amber-400", bar: "bg-amber-500" }
      : { label: "Confiável", color: "text-green-400", bar: "bg-green-500" }

  const restricoes = score > 700 ? [] : mockRestricoes

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            Consulta de Crédito
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Digite CPF ou CNPJ"
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            className="h-12 bg-secondary border-border"
          />
          <Button className="h-12 bg-primary hover:bg-primary/90" onClick={() => setConsultado(true)}>
            Consultar
          </Button>
        </CardContent>
      </Card>

      {consultado && (
        <>
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base">Score de Crédito</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-3xl font-bold">{score}</p>
                <Badge className={`${faixa.color} border-current bg-transparent`}>{faixa.label}</Badge>
              </div>
              <div className="h-3 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full ${faixa.bar}`} style={{ width: `${(score / 1000) * 100}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">Faixas: 0-300 Crítico | 301-700 Alerta | 701-1000 Confiável</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base">Restrições Encontradas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {restricoes.length === 0 ? (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Nenhuma restrição relevante encontrada.
                </div>
              ) : (
                restricoes.map((r, i) => (
                  <div key={`${r.tipo}-${i}`} className="p-3 rounded-lg bg-secondary/40 border border-border">
                    <p className="font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      {r.tipo}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">{r.detalhe}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

