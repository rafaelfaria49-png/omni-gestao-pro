/**
 * Correspondência cliente × título de Contas a Receber — determinística e positiva.
 *
 * Substitui o casamento por substring bidirecional que existia no PDV
 * (`titulo.includes(cliente) || cliente.includes(titulo)`, achado H da auditoria
 * `AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md`), no qual "Ana" casava com
 * "Mariana" e "Joana" — e um operador podia receber a conta de outro cliente.
 *
 * Regras:
 *  - **Escada de prioridade** (identificador estável → documento → telefone → nome):
 *    o primeiro degrau em que AMBOS os lados têm valor é **decisivo**. Não bate ali,
 *    não bate em degrau nenhum — cair para o nome depois de um id divergente
 *    reabriria a porta do homônimo.
 *  - **Nunca por aproximação.** Igualdade exata sobre a forma normalizada; sem
 *    `includes`, sem prefixo, sem distância de edição.
 *  - **Falso-negativo é preferível.** Sem identificação segura o título não é
 *    atribuído ao cliente — deixar de cobrar é recuperável, receber a conta de
 *    outra pessoa não é.
 *
 * Módulo puro (sem React, sem Prisma): roda no harness `node` do Vitest.
 */

/** Nome: sem acento, sem caixa, com espaços internos colapsados. */
export function normalizeNomeCliente(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
}

/** CPF/CNPJ: só dígitos. Máscara não muda a identidade do documento. */
export function normalizeDocumento(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "")
}

/**
 * Telefone: só dígitos, sem o prefixo internacional do Brasil. `+55 (11) 98888-7777`
 * e `11988887777` são o mesmo assinante e precisam normalizar igual.
 */
export function normalizeTelefone(s: string | null | undefined): string {
  const d = String(s ?? "").replace(/\D/g, "")
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d
}

/** Identificador estável: só é chave se não for vazio depois do trim. */
function idKey(s: string | null | undefined): string {
  return String(s ?? "").trim()
}

/** Cliente selecionado na busca do PDV (`/api/clientes` → `Cliente.id`). */
export type ClienteIdentidade = {
  id?: string | null
  name?: string | null
  document?: string | null
  phone?: string | null
}

/**
 * Identidade do título. Hoje `ContaReceberTitulo` só tem a coluna `cliente` (nome) e,
 * quando a origem preencheu, `payload.clienteId` — que aponta para o MESMO
 * `Cliente.id` devolvido por `/api/clientes`. `clienteDocumento`/`clienteTelefone`
 * ficam previstos pela escada e são lidos quando a origem os fornecer.
 */
export type TituloClienteIdentidade = {
  clienteId?: string | null
  cliente?: string | null
  clienteDocumento?: string | null
  clienteTelefone?: string | null
}

export type ClienteMatchVia = "clienteId" | "documento" | "telefone" | "nome"

/**
 * Degrau em que o título foi atribuído ao cliente, ou `null` quando não há
 * identificação segura. `null` também é a resposta quando um degrau decisivo
 * DIVERGE — o resultado nunca "melhora" descendo a escada.
 */
export function matchTituloCliente(
  titulo: TituloClienteIdentidade,
  cliente: ClienteIdentidade,
): ClienteMatchVia | null {
  const tId = idKey(titulo.clienteId)
  const cId = idKey(cliente.id)
  if (tId && cId) return tId === cId ? "clienteId" : null

  const tDoc = normalizeDocumento(titulo.clienteDocumento)
  const cDoc = normalizeDocumento(cliente.document)
  if (tDoc && cDoc) return tDoc === cDoc ? "documento" : null

  const tTel = normalizeTelefone(titulo.clienteTelefone)
  const cTel = normalizeTelefone(cliente.phone)
  if (tTel && cTel) return tTel === cTel ? "telefone" : null

  const tNome = normalizeNomeCliente(titulo.cliente)
  const cNome = normalizeNomeCliente(cliente.name)
  if (tNome && cNome) return tNome === cNome ? "nome" : null

  return null
}

/** Açúcar booleano sobre `matchTituloCliente`. */
export function tituloPertenceAoCliente(
  titulo: TituloClienteIdentidade,
  cliente: ClienteIdentidade,
): boolean {
  return matchTituloCliente(titulo, cliente) !== null
}
