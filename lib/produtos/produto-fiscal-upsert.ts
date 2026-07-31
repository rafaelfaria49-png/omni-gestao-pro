/**
 * Canonização fiscal do caminho Cadastros V2 (`upsertProduto`).
 *
 * Fecha a paridade fiscal da porta do Cadastros V2 com REST/importadores: reutiliza o
 * contrato canônico já publicado (`lib/produto-fiscal.ts`) — mesmo saneamento, mesma forma
 * compacta em `metadata.fiscal`. NÃO calcula imposto, NÃO emite nada, NÃO cria contrato novo.
 *
 * Diferente da REST (que faz whole-block replace), o Cadastros V2 já mescla `metadata.fiscal`
 * campo a campo no merge de 2 níveis do `upsertProduto`. Este helper apenas lê esse bloco já
 * mesclado como base canônica, sobrepõe os campos fiscais top-level do body (paridade REST) e
 * reescreve `metadata.fiscal` na forma canônica — preservando os campos fiscais não reenviados
 * (update parcial não-destrutivo) e todos os demais namespaces do metadata.
 */
import {
  getProdutoFiscal,
  mergeProdutoFiscalIntoMetadata,
  type ProdutoFiscalInput,
} from "@/lib/produto-fiscal"

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Reescreve `metadata.fiscal` na forma canônica a partir de um metadata JÁ mesclado
 * (merge de 2 níveis do `upsertProduto`) e do input fiscal extraído do body.
 *
 * A SEMÂNTICA do merge parcial não mora aqui: é a de `mergeProdutoFiscalIntoMetadata`, a
 * mesma usada por REST e importadores. Este adaptador só acrescenta a regra da porta V2 —
 * descartar o bloco `fiscal` recebido do body, que pode trazer resíduo não canônico.
 *
 * Chame apenas quando houver sinal fiscal (`fiscalInputFromBody(body) != null`); sem sinal,
 * o merge de 2 níveis já preserva o `fiscal` existente e este helper não deve ser chamado.
 */
export function canonicalizeProdutoFiscalMetadata(
  mergedMetadata: unknown,
  fiscalInput: ProdutoFiscalInput,
): Record<string, unknown> {
  // Identidade já mesclada (existente + `metadata.fiscal` do body), lida ANTES do descarte.
  const fiscalAtual = getProdutoFiscal({ metadata: mergedMetadata })
  const semFiscal = { ...(asObject(mergedMetadata) ?? {}) }
  delete semFiscal.fiscal
  // Duas passadas do MESMO contrato: a primeira regrava o bloco só com os campos canônicos,
  // a segunda aplica o patch do body campo a campo (preservando o que não foi reenviado).
  return mergeProdutoFiscalIntoMetadata(
    mergeProdutoFiscalIntoMetadata(semFiscal, fiscalAtual),
    fiscalInput,
  )
}
