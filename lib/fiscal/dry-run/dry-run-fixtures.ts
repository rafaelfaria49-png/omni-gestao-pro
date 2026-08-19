/**
 * Fixtures do Dry-Run fiscal (BL-FISCAL-006) — material de TESTE, descartável, SEM VALOR FISCAL.
 *
 * Reúne o certificado de teste (auto-assinado, NÃO ICP-Brasil, NÃO resolvido pelo cofre, NÃO
 * persistido) e construtores de snapshots-exemplo (golden cases). Tudo determinístico e offline.
 * Permite rodar o Dry-Run em CI sem qualquer segredo/rede.
 */

import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type SnapshotClienteInput,
  type SnapshotItemInput,
  type SnapshotLojaInput,
  type VendaFiscalSnapshot,
} from "../venda-fiscal-snapshot"
import { sanitizeProdutoFiscal, PRODUTO_FISCAL_VAZIO } from "@/lib/produto-fiscal"
import { loadCertificateMaterialFromPem, type FiscalCertificateMaterial } from "../signing"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM, TEST_CERT_PASSPHRASE } from "../signing/__fixtures__/test-cert"

/** Certificado de TESTE pronto para o Dry-Run (chave em claro — sem senha). */
export const DRY_RUN_TEST_CERT: FiscalCertificateMaterial = loadCertificateMaterialFromPem(
  TEST_KEY_PLAIN_PEM,
  TEST_CERT_PEM,
)
export { TEST_CERT_PASSPHRASE as DRY_RUN_TEST_PASSPHRASE }

const LOJA_TESTE: SnapshotLojaInput = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "RafaCell Comércio LTDA",
  nomeFantasia: "RafaCell",
  inscricaoEstadual: "123456789",
  inscricaoMunicipal: "987654",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "Rua das Flores",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001-000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

function itemTeste(over: Partial<SnapshotItemInput> = {}): SnapshotItemInput {
  return {
    itemVendaId: "iv-1",
    produtoId: "prod-1",
    codigoProduto: "SKU-1",
    descricao: "Cabo USB-C",
    gtin: "7891234567890",
    quantidade: 2,
    valorUnitario: 25,
    valorDesconto: 0,
    valorTotal: 50,
    fiscal: sanitizeProdutoFiscal({ ncm: "85176200", cfop: "5102", csosn: "102", origem: "0", unidade: "UN" }),
    ...over,
  }
}

const CLIENTE_COM_CPF: SnapshotClienteInput = {
  nome: "Maria Consumidora",
  documento: "123.456.789-09",
  kind: "PF",
  telefone: "",
  email: "",
  municipio: "São Paulo",
}

/** Casos golden cobertos pelo Dry-Run. */
export type DryRunCaseKind =
  | "simples"
  | "com_desconto"
  | "multiplos_itens"
  | "consumidor_sem_cpf"
  | "consumidor_com_cpf"
  | "invalido_item_sem_ncm"

function buildCaseInput(kind: DryRunCaseKind): BuildSnapshotInput {
  const base: BuildSnapshotInput = {
    storeId: "loja-1",
    vendaId: `venda-${kind}`,
    loja: LOJA_TESTE,
    cliente: null,
    venda: {
      pedidoId: `VDA-${kind}`,
      data: "2026-06-18T12:00:00.000Z",
      total: 50,
      desconto: 0,
      operador: "João",
      terminal: "PDV1",
      paymentBreakdown: { dinheiro: 50 },
    },
    itens: [itemTeste()],
  }

  switch (kind) {
    case "simples":
      return base
    case "com_desconto":
      return { ...base, venda: { ...base.venda, total: 40, desconto: 10, paymentBreakdown: { dinheiro: 40 } } }
    case "multiplos_itens":
      return {
        ...base,
        venda: { ...base.venda, total: 400, paymentBreakdown: { dinheiro: 400 } },
        itens: [
          itemTeste({ itemVendaId: "a", quantidade: 1, valorUnitario: 100, valorTotal: 100 }),
          itemTeste({ itemVendaId: "b", quantidade: 1, valorUnitario: 300, valorTotal: 300 }),
        ],
      }
    case "consumidor_sem_cpf":
      return { ...base, cliente: null }
    case "consumidor_com_cpf":
      return { ...base, cliente: CLIENTE_COM_CPF }
    case "invalido_item_sem_ncm":
      return { ...base, itens: [itemTeste({ fiscal: { ...PRODUTO_FISCAL_VAZIO } })] }
  }
}

/** Constrói o snapshot congelado de um caso golden (determinístico). */
export function dryRunSnapshot(kind: DryRunCaseKind): VendaFiscalSnapshot {
  const r = buildVendaFiscalSnapshot(buildCaseInput(kind))
  if (!r.ok) throw new Error(`fixture de snapshot inválida (${kind}): ${r.code}`)
  return r.snapshot
}
