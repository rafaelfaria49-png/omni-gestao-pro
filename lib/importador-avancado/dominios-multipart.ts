/**
 * Contrato multipart da seleção de domínios do importador avançado.
 *
 * Fecha o F-06 da readiness `CADASTROS_IMPORTACAO_PRODUTOS_REVIEW_HARDENING_READINESS_001`:
 * o hook enviava `dominios[]` (igual a `arquivos[]`) e a rota lia `getAll("dominios")`.
 * A seleção do usuário era descartada em silêncio e TODOS os domínios detectados eram
 * importados. Não havia dano hoje só porque nenhum caller passava seleção — no instante
 * em que um seletor existisse, a escolha seria ignorada sem erro.
 *
 * Chave canônica: `dominios[]`. A chave legada `dominios` continua aceita por
 * compatibilidade, e a normalização é a MESMA em preview e import — a leitura acontece
 * em um único ponto da rota.
 */

import type { DominioImport } from "./types"

/**
 * Domínios que um caller pode selecionar. `desconhecido` NÃO entra: é resultado de
 * detecção falhada, nunca uma escolha válida.
 */
export const DOMINIOS_IMPORT_SELECIONAVEIS = [
  "clientes",
  "clientes_enderecos",
  "fornecedores",
  "fornecedores_enderecos",
  "produtos",
  "servicos_catalogo",
  "ordens_servicos",
  "os_equipamentos",
  "os_pagamentos",
  "os_servicos",
  "os_situacoes",
  "vendas",
  "vendas_historicos",
  "vendas_pagamentos",
  "vendas_produtos",
  "contas_pagar",
  "contas_receber",
] as const satisfies readonly DominioImport[]

export type DominioImportSelecionavel = (typeof DOMINIOS_IMPORT_SELECIONAVEIS)[number]

/** Chave canônica enviada pelo cliente. */
export const CHAVE_DOMINIOS_CANONICA = "dominios[]"
/** Chave legada, mantida por compatibilidade temporária. */
export const CHAVE_DOMINIOS_LEGADA = "dominios"

export type SelecaoDominios =
  | {
      ok: true
      /** Vazio = sem filtro ("importar todos os domínios detectados"). */
      dominios: DominioImportSelecionavel[]
    }
  | { ok: false; invalidos: string[] }

/**
 * Normaliza a seleção: `trim` → descarta vazio → deduplica (mantendo a primeira
 * ocorrência) → valida contra a allowlist. Valor desconhecido é REJEITADO, não
 * descartado: ignorar em silêncio é exatamente o defeito que este contrato fecha.
 */
export function normalizarSelecaoDominios(bruto: readonly unknown[]): SelecaoDominios {
  const vistos = new Set<string>()
  const dominios: DominioImportSelecionavel[] = []
  const invalidos: string[] = []

  for (const item of bruto) {
    const valor = String(item ?? "").trim()
    if (!valor) continue
    if (vistos.has(valor)) continue
    vistos.add(valor)
    if ((DOMINIOS_IMPORT_SELECIONAVEIS as readonly string[]).includes(valor)) {
      dominios.push(valor as DominioImportSelecionavel)
    } else {
      invalidos.push(valor.slice(0, 60))
    }
  }

  if (invalidos.length > 0) return { ok: false, invalidos }
  return { ok: true, dominios }
}

/**
 * Lê a seleção do FormData aceitando as duas convenções. Chamada UMA vez na rota,
 * antes de decidir entre preview e import — por construção os dois modos recebem
 * exatamente a mesma seleção.
 */
export function lerSelecaoDominiosDoFormData(formData: {
  getAll(name: string): unknown[]
}): SelecaoDominios {
  return normalizarSelecaoDominios([
    ...formData.getAll(CHAVE_DOMINIOS_CANONICA),
    ...formData.getAll(CHAVE_DOMINIOS_LEGADA),
  ])
}
