import type { TermosGarantia } from "@/lib/config-empresa"

export type CertificadoA1Status = "Inativo" | "Pendente" | "Ativo" | "Expirado"

export type CertificadoA1Meta = {
  status: CertificadoA1Status
  fileName?: string
  updatedAt?: string
}

export type StorePdvParams = {
  atalhosRapidos: Array<{ id: string; nome: string; preco: number }>
  ocultarCategoriasNoPdv: boolean
  categoriasOcultasNoPdv: string[]
  garantiaPadraoDias: number
  validadeOrcamentoDias: number
  incluirImpostoEstimadoNoPdv: boolean
  aliquotaImpostoEstimadoPdv: number
  moduloControleConsumo: boolean
}

/**
 * Payload persistido por unidade dentro de `StoreSettings.printerConfig` (JSON).
 * Mantém compatibilidade com o schema atual sem migração de colunas.
 */
export type StoreSettingsBlob = {
  pdvParams?: Partial<StorePdvParams>
  termosGarantia?: Partial<TermosGarantia>
  certificadoA1?: Partial<CertificadoA1Meta>
  /** Preferência de modelo da IA Mestre (apenas plano ouro). */
  aiMestreModel?: string
}

export type StoreSettingsApi = {
  contactEmail?: string | null
  contactWhatsapp?: string | null
  contactWhatsappDono?: string | null
  receiptFooter?: string | null
  printerConfig?: unknown
  cardFees?: unknown
}

