import type { TermosGarantia } from "@/lib/config-empresa"
import type { FormaPagamentoConfig } from "@/lib/pdv-formas-pagamento"
import type { PdvImpressaoConfig } from "@/lib/pdv-impressao-config"

export type CertificadoA1Status = "Inativo" | "Pendente" | "Ativo" | "Expirado"

export type CertificadoA1Meta = {
  status: CertificadoA1Status
  fileName?: string
  updatedAt?: string
}

/** Quando o PDV é o modelo "classic" (não supermercado): UI Lovable (atalhos F1–F9) ou tela completa legada (`services`/Assistência). */
export type PdvClassicLayoutKind = "lovable" | "services"

export type StorePdvAtalhoRapido = {
  id: string
  nome: string
  preco: number
  inventoryId?: string
  categoria?: string
  ativo?: boolean
  favorito?: boolean
  cor?: string
  posicao?: number
  /** Ausente em atalhos legados; leitores inferem sem exigir migração manual. */
  kind?: "produto" | "servico"
  serviceId?: string
  serviceCategory?: string
}

export type StorePdvParams = {
  atalhosRapidos: StorePdvAtalhoRapido[]
  ocultarCategoriasNoPdv: boolean
  categoriasOcultasNoPdv: string[]
  garantiaPadraoDias: number
  validadeOrcamentoDias: number
  incluirImpostoEstimadoNoPdv: boolean
  aliquotaImpostoEstimadoPdv: number
  moduloControleConsumo: boolean
  /** Preferência por unidade (persistida em `printerConfig.pdvParams`). */
  pdvClassicLayout?: PdvClassicLayoutKind
  /** Formas de pagamento ativas e regras por unidade (PDV runtime). */
  formasPagamento?: FormaPagamentoConfig[]
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
  impressao?: Partial<PdvImpressaoConfig>
}

export type StoreSettingsApi = {
  contactEmail?: string | null
  contactWhatsapp?: string | null
  contactWhatsappDono?: string | null
  receiptFooter?: string | null
  printerConfig?: unknown
  cardFees?: unknown
}

