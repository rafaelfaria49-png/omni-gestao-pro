/** CPF/CNPJ apenas dígitos para chave de cadastro e crédito em haver. */
export function normalizeDocDigits(doc: string): string {
  return doc.replace(/\D/g, "").slice(0, 14)
}
