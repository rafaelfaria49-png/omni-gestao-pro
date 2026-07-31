"use client"

import { useEffect, useState } from "react"
import { Boxes, FileText, Info, Truck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { listFornecedores, type FornecedorDTO } from "@/app/actions/cadastros"
import type { ContextoProdutosForm } from "./hooks/use-importador-avancado"

/**
 * Bloco "Contexto da importação de produtos" (Parte 7 do contrato).
 *
 * Tudo é opcional: o contexto enriquece a proveniência gravada em
 * `Produto.metadata.importacao`, não é validação. O fornecedor pode ser escolhido
 * entre os já cadastrados ou digitado livremente — NENHUM cadastro de fornecedor
 * é criado por este fluxo.
 *
 * A política de estoque é a única decisão com efeito no banco, e o padrão é o
 * conservador: cadastrar sem movimentar saldo.
 */

export type ContextoProdutosLoteProps = {
  valor: ContextoProdutosForm
  onChange: (patch: Partial<ContextoProdutosForm>) => void
  /** Loja ativa — usada para listar fornecedores da própria unidade. */
  storeId: string
  /** Quantidade de linhas de produto detectadas no lote. */
  totalLinhas: number
  desabilitado?: boolean
}

export function ContextoProdutosLote({
  valor,
  onChange,
  storeId,
  totalLinhas,
  desabilitado = false,
}: ContextoProdutosLoteProps) {
  const [fornecedores, setFornecedores] = useState<FornecedorDTO[]>([])

  useEffect(() => {
    if (!storeId) return
    let ativo = true
    listFornecedores(storeId)
      .then((rows) => {
        if (ativo) setFornecedores(rows.filter((f) => f.status !== "Inativo"))
      })
      .catch(() => {
        // Sem lista de fornecedores o campo continua funcionando como texto livre.
        if (ativo) setFornecedores([])
      })
    return () => {
      ativo = false
    }
  }, [storeId])

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Truck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Contexto da importação de produtos</p>
            <p className="text-xs text-muted-foreground">
              Opcional. Fica gravado na proveniência de cada produto e permite reabrir este lote
              depois na conferência.
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"}
        </Badge>
      </div>

      {/* Fornecedor */}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="ctx-fornecedor" className="text-xs">
            Fornecedor
          </Label>
          <Input
            id="ctx-fornecedor"
            list="ctx-fornecedores-existentes"
            value={valor.fornecedorNome}
            disabled={desabilitado}
            placeholder="Selecione ou digite o nome"
            onChange={(e) => onChange({ fornecedorNome: e.target.value })}
          />
          <datalist id="ctx-fornecedores-existentes">
            {fornecedores.map((f) => (
              <option key={f.id} value={f.nome} />
            ))}
          </datalist>
          <p className="text-[11px] text-muted-foreground">
            Nome livre é aceito — nenhum cadastro de fornecedor é criado automaticamente.
          </p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="ctx-fornecedor-doc" className="text-xs">
            CNPJ / CPF do fornecedor
          </Label>
          <Input
            id="ctx-fornecedor-doc"
            value={valor.fornecedorDocumento}
            disabled={desabilitado}
            placeholder="00.000.000/0000-00"
            onChange={(e) => onChange({ fornecedorDocumento: e.target.value })}
          />
        </div>
      </div>

      {/* Documento de origem */}
      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          Documento de origem
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="ctx-doc-tipo" className="text-xs">
              Tipo
            </Label>
            <select
              id="ctx-doc-tipo"
              value={valor.documentoTipo}
              disabled={desabilitado}
              onChange={(e) => onChange({ documentoTipo: e.target.value === "nfe" ? "nfe" : "outro" })}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:opacity-60"
            >
              <option value="nfe">NF-e</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="ctx-doc-numero" className="text-xs">
              Número
            </Label>
            <Input
              id="ctx-doc-numero"
              value={valor.documentoNumero}
              disabled={desabilitado}
              placeholder="5380135"
              onChange={(e) => onChange({ documentoNumero: e.target.value })}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="ctx-doc-serie" className="text-xs">
              Série
            </Label>
            <Input
              id="ctx-doc-serie"
              value={valor.documentoSerie}
              disabled={desabilitado}
              placeholder="0"
              onChange={(e) => onChange({ documentoSerie: e.target.value })}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="ctx-doc-data" className="text-xs">
              Data de emissão
            </Label>
            <Input
              id="ctx-doc-data"
              type="date"
              value={valor.documentoDataEmissao}
              disabled={desabilitado}
              onChange={(e) => onChange({ documentoDataEmissao: e.target.value })}
            />
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="ctx-doc-chave" className="text-xs">
            Chave da NF-e
          </Label>
          <Input
            id="ctx-doc-chave"
            value={valor.documentoChave}
            disabled={desabilitado}
            placeholder="44 dígitos"
            className="font-mono text-xs"
            onChange={(e) => onChange({ documentoChave: e.target.value })}
          />
        </div>
      </div>

      {/* Política de estoque */}
      <fieldset className="space-y-2" disabled={desabilitado}>
        <legend className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
          Política de estoque deste lote
        </legend>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <OpcaoEstoque
            valorAtual={valor.politicaEstoque}
            valor="nao_movimentar"
            titulo="Cadastro sem movimentar estoque"
            descricao="Produtos novos entram com saldo zero. Recomendado para nota antiga."
            recomendado
            onSelect={() => onChange({ politicaEstoque: "nao_movimentar" })}
          />
          <OpcaoEstoque
            valorAtual={valor.politicaEstoque}
            valor="planilha_somente_novos"
            titulo="Usar estoque da planilha somente em produtos novos"
            descricao="Aplica a quantidade da planilha apenas na criação."
            onSelect={() => onChange({ politicaEstoque: "planilha_somente_novos" })}
          />
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Em nenhuma das opções o estoque de produto já existente é sobrescrito. Entrada física e
          fiscal por XML é outro fluxo.
        </p>
      </fieldset>

      {/* Observação interna */}
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="ctx-observacao" className="text-xs">
          Observação interna
        </Label>
        <Input
          id="ctx-observacao"
          value={valor.observacao}
          disabled={desabilitado}
          placeholder="Ex.: nota de janeiro, revisar preços antes de ativar"
          onChange={(e) => onChange({ observacao: e.target.value })}
        />
      </div>
    </div>
  )
}

function OpcaoEstoque({
  valorAtual,
  valor,
  titulo,
  descricao,
  recomendado = false,
  onSelect,
}: {
  valorAtual: string
  valor: string
  titulo: string
  descricao: string
  recomendado?: boolean
  onSelect: () => void
}) {
  const ativo = valorAtual === valor
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border p-3 transition",
        ativo ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent/40",
      )}
    >
      <input
        type="radio"
        name="politica-estoque-lote"
        checked={ativo}
        onChange={onSelect}
        className="mt-0.5 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
          {titulo}
          {recomendado && (
            <Badge variant="secondary" className="text-[10px]">
              recomendado
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{descricao}</span>
      </span>
    </label>
  )
}
