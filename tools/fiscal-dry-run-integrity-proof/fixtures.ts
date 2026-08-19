/**
 * Fixtures sintéticas da prova FISCAL-DRY-RUN-INTEGRITY-PROOF-005.
 *
 * SEM VALOR FISCAL. Não representam empresa, cliente, produto ou loja reais.
 * CNPJ com DV válido apenas por necessidade estrutural do builder (00.000.000/0001-91).
 * Material criptográfico: reutiliza exclusivamente o certificado de teste do GOAL-003/signing.
 */

import { sanitizeProdutoFiscal } from "@/lib/produto-fiscal"
import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type SnapshotLojaInput,
  type VendaFiscalSnapshot,
} from "@/lib/fiscal/venda-fiscal-snapshot"
import { DRY_RUN_TEST_CERT } from "@/lib/fiscal/dry-run"
import type { FiscalCertificateMaterial } from "@/lib/fiscal/signing"
import type { NfceXmlContext } from "@/lib/fiscal/xml"

export const PROOF_GOAL = "FISCAL-DRY-RUN-INTEGRITY-PROOF-005" as const
export const PROOF_VERSION = "1" as const
export const FIXTURE_VERSION = "1" as const
export const PROOF_SEED = "FISCAL-DRY-RUN-INTEGRITY-PROOF-005/v1" as const
export const PROOF_CLOCK_ISO = "2026-01-15T12:00:00.000Z" as const
export const STORE_PROOF_A = "store-fiscal-proof-a" as const
export const STORE_PROOF_B = "store-fiscal-proof-b" as const
export const XSD_PACKAGE_ID = "PL_010e_v1.02" as const
export const LAYOUT_VERSION = "4.00" as const
export const MODEL_NFCE = "65" as const

/** CNPJ sintético com dígitos verificadores válidos (não é empresa real). */
export const SYNTHETIC_CNPJ = "00.000.000/0001-91"

export const SYNTHETIC_LOJA: SnapshotLojaInput = {
  cnpj: SYNTHETIC_CNPJ,
  razaoSocial: "EMPRESA SINTETICA TESTE",
  nomeFantasia: "EMPRESA SINTETICA TESTE",
  inscricaoEstadual: "ISENTO",
  inscricaoMunicipal: "",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "RUA SINTETICA SEM VALOR FISCAL",
  numero: "0",
  complemento: "SEM VALOR FISCAL",
  bairro: "BAIRRO SINTETICO",
  codigoMunicipioIbge: "3550308",
  municipio: "MUNICIPIO SINTETICO",
  uf: "SP",
  cep: "01001000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

export type SyntheticStoreId = typeof STORE_PROOF_A | typeof STORE_PROOF_B

export type SyntheticFixtureInput = {
  storeId: SyntheticStoreId | string
  clockIso?: string
  seed?: string
}

/**
 * Constrói snapshot sintético store-scoped e determinístico.
 * `storeId` entra no vendaId/pedidoId para isolar fingerprints multi-loja sem dados reais.
 */
export function buildSyntheticSnapshot(input: SyntheticFixtureInput): VendaFiscalSnapshot {
  const clockIso = input.clockIso ?? PROOF_CLOCK_ISO
  const seed = input.seed ?? PROOF_SEED
  const storeId = String(input.storeId)
  if (!storeId.startsWith("store-fiscal-proof-")) {
    throw new Error(`storeId sintético inválido para a prova: ${storeId}`)
  }

  const payload: BuildSnapshotInput = {
    storeId,
    vendaId: `${seed}/${storeId}/venda-sintetica-1`,
    loja: SYNTHETIC_LOJA,
    cliente: null,
    venda: {
      pedidoId: `${seed}/${storeId}/pedido-sintetico-1`,
      data: clockIso,
      total: 10,
      desconto: 0,
      operador: "OPERADOR SINTETICO SEM VALOR FISCAL",
      terminal: "TERM-SINTETICO",
      paymentBreakdown: { dinheiro: 10 },
    },
    itens: [
      {
        itemVendaId: `${storeId}-item-1`,
        produtoId: `${storeId}-prod-1`,
        codigoProduto: "SKU-SINTETICO-001",
        descricao: "ITEM SINTETICO SEM VALOR FISCAL",
        gtin: "SEM GTIN",
        quantidade: 1,
        valorUnitario: 10,
        valorDesconto: 0,
        valorTotal: 10,
        fiscal: sanitizeProdutoFiscal({
          ncm: "85176200",
          cfop: "5102",
          csosn: "102",
          origem: "0",
          unidade: "UN",
        }),
      },
    ],
  }

  const result = buildVendaFiscalSnapshot(payload)
  if (!result.ok) {
    throw new Error(`fixture sintética inválida: ${result.code}`)
  }
  return result.snapshot
}

/** Comprimento máximo de `verProc` no XSD oficial NFC-e 4.00 (`TString` maxLength=20). */
export const VER_PROC_MAX_LENGTH = 20

/**
 * Contexto XML fixo (numeração de teste — nunca alocada em produção).
 *
 * `versaoAplicativo` alimenta `<verProc>`, cujo tipo XSD impõe `maxLength=20`. O valor
 * anterior ("OmniGestao-FiscalProof005", 25 chars) violava esse facet e fazia o `xmllint`
 * real reprovar o positivo (`xsd_invalido`) no worker do 005B. Manter ≤ 20 caracteres.
 */
export function syntheticXmlContext(clockIso: string = PROOF_CLOCK_ISO): NfceXmlContext {
  return {
    serie: 1,
    numero: 1,
    dataEmissao: clockIso,
    naturezaOperacao: "VENDA SINTETICA SEM VALOR FISCAL",
    versaoAplicativo: "OmniGestaoProof005",
  }
}

/** Material criptográfico sintético herdado do GOAL-003 (sem A1 real). */
export function syntheticCertificateMaterial(): FiscalCertificateMaterial {
  return DRY_RUN_TEST_CERT
}

/** Assertiva de segurança: fixture não carrega dados operacionais conhecidos. */
export function assertSyntheticSafety(serialized: string): void {
  const banned = [
    /rafacell/i,
    /loja-1\b/i,
    /sk_live|sk_test|BEGIN CERTIFICATE[\s\S]{200,}Rafa/i,
    /CSC|idToken/i,
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  ]
  for (const re of banned) {
    if (re.test(serialized)) {
      throw new Error(`fixture/resultado contém padrão proibido: ${re}`)
    }
  }
  if (serialized.includes("PRIVATE KEY") && !serialized.includes("TEST")) {
    // resultado serializado da prova nunca deve incluir a chave
    throw new Error("resultado serializado não pode conter chave privada")
  }
}
