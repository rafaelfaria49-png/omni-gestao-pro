/**
 * GOAL-008 — Ponte Cofre → assinatura "a seco" (itens 1 e 10). Resolve o A1 de teste do EnvVault,
 * assina um XML NFC-e sintético e verifica a assinatura; prova fail-closed e zero vazamento.
 */
import { describe, it, expect } from "vitest"
import { EnvVault } from "../vault/env-vault"
import { canonicalEnvRef } from "../vault/fiscal-secret-vault"
import { scanForSecrets } from "../vault/secret-scan"
import { makeTestPfx, TEST_PFX_PRIVATE_KEY_PEM } from "../vault/__fixtures__/make-test-pfx"
import { drySignNfceFromVault } from "./dry-sign-from-vault"
import { verifyNfceSignature } from "./nfce-signer"
import { NfceSignError } from "./signer.types"
import { buildVendaFiscalSnapshot, type BuildSnapshotInput, type SnapshotLojaInput } from "../venda-fiscal-snapshot"
import { sanitizeProdutoFiscal } from "@/lib/produto-fiscal"
import { buildNfceXmlAssinavel } from "../xml"

const LOJA_OK: SnapshotLojaInput = {
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

/** XML NFC-e sintético (nunca um documento real). */
function nfceXml(): string {
  const input: BuildSnapshotInput = {
    storeId: "loja-1",
    vendaId: "venda-1",
    loja: LOJA_OK,
    cliente: null,
    venda: {
      pedidoId: "VDA-2026-0001",
      data: "2026-06-18T12:00:00.000Z",
      total: 50,
      desconto: 0,
      operador: "João",
      terminal: "PDV1",
      paymentBreakdown: { dinheiro: 50 },
    },
    itens: [
      {
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
      },
    ],
  }
  const r = buildVendaFiscalSnapshot(input)
  if (!r.ok) throw new Error(`snapshot inválido: ${r.code}`)
  return buildNfceXmlAssinavel(r.snapshot, { serie: 1, numero: 42 })
}

function seedVault(storeId: string, pfx: Buffer, senha: string) {
  const blobRef = canonicalEnvRef("pfx", storeId)
  const senhaRef = canonicalEnvRef("senha", storeId)
  const env: Record<string, string | undefined> = { [blobRef]: pfx.toString("base64"), [senhaRef]: senha }
  return { vault: new EnvVault({ env }), blobRef, senhaRef, env }
}

describe("drySignNfceFromVault · assinatura a seco com certificado de teste", () => {
  it("resolve o A1 do cofre, assina o XML sintético e a verificação confere", async () => {
    const { pfx, senha } = makeTestPfx({ cnpj: "11222333000181" })
    const { vault, blobRef, senhaRef } = seedVault("loja-1", pfx, senha)

    const r = await drySignNfceFromVault({ vault, storeId: "loja-1", blobRef, senhaRef, xml: nfceXml() })

    expect(r.xml).toContain("<Signature")
    expect(r.referenciaId).toMatch(/^NFe\d{44}$/)
    const v = verifyNfceSignature(r.xml)
    expect(v.valido).toBe(true)
    expect(r.certificado.cnpj).toBe("11222333000181")
    expect(r.certificado.fingerprintSha1).toMatch(/^[0-9a-f]{40}$/)
  })

  it("não vaza segredo no resultado da assinatura (senha/bytes/chave privada)", async () => {
    const senha = "SENHA-ULTRA-SECRETA-NAO-VAZAR"
    const { pfx } = makeTestPfx({ senha, cnpj: "11222333000181" })
    const bytes = Buffer.from(pfx)
    const { vault, blobRef, senhaRef } = seedVault("loja-1", pfx, senha)

    const r = await drySignNfceFromVault({ vault, storeId: "loja-1", blobRef, senhaRef, xml: nfceXml() })
    const scan = scanForSecrets(r, { senha, pfxBytes: bytes, privateKeyPem: TEST_PFX_PRIVATE_KEY_PEM })
    expect(scan.vazou).toBe(false)
  })
})

describe("drySignNfceFromVault · fail-closed", () => {
  it("blobRef ausente ⇒ NfceSignError(vault_erro), sem assinar", async () => {
    const { pfx, senha } = makeTestPfx()
    const { vault, senhaRef } = seedVault("loja-1", pfx, senha)
    await expect(
      drySignNfceFromVault({ vault, storeId: "loja-1", blobRef: "", senhaRef, xml: nfceXml() }),
    ).rejects.toBeInstanceOf(NfceSignError)
  })

  it("segredo ausente no cofre ⇒ NfceSignError(vault_erro)", async () => {
    const { pfx, senha } = makeTestPfx()
    const { blobRef, senhaRef, env } = seedVault("loja-1", pfx, senha)
    delete env[blobRef]
    const vault = new EnvVault({ env })
    await expect(
      drySignNfceFromVault({ vault, storeId: "loja-1", blobRef, senhaRef, xml: nfceXml() }),
    ).rejects.toMatchObject({ code: "vault_erro" })
  })

  it("senha incorreta ⇒ NfceSignError (fail-closed), sem assinar", async () => {
    const { pfx } = makeTestPfx({ senha: "certa" })
    const { vault, blobRef, senhaRef } = seedVault("loja-1", pfx, "errada")
    await expect(
      drySignNfceFromVault({ vault, storeId: "loja-1", blobRef, senhaRef, xml: nfceXml() }),
    ).rejects.toBeInstanceOf(NfceSignError)
  })
})
