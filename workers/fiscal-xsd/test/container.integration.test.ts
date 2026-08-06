import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { createXsdWorkerHttpClient } from "../../../lib/fiscal/xsd-worker"
import { XSD_CONTRACT_VERSION, XSD_MAX_PAYLOAD_BYTES, XSD_SCHEMA_PACKAGE, type XsdValidationRequest } from "../../../lib/fiscal/xsd"
import { OFFICIAL_XSD_MANIFEST_SHA256 } from "../../../lib/fiscal/xsd/official-package"
import { DRY_RUN_TEST_CERT, dryRunSnapshot } from "../../../lib/fiscal/dry-run"
import { signNfceXmlDetailed } from "../../../lib/fiscal/signing"
import { buildNfceXmlAssinavel } from "../../../lib/fiscal/xml"
import {
  VALID_NFCE_XML, NFCE_XML_MISSING_REQUIRED, NFCE_XML_OUT_OF_ORDER, NFCE_XML_INVALID_TYPE,
  NFCE_XML_FIELD_TOO_LONG, NFCE_XML_WRONG_NAMESPACE, NFCE_XML_MALFORMED, NFCE_XML_VERPROC_21,
} from "../../../lib/fiscal/xsd/__fixtures__/nfce-xsd-fixtures"

const baseUrl = process.env.FISCAL_XSD_WORKER_URL
const integration = baseUrl ? describe : describe.skip
const client = createXsdWorkerHttpClient({ baseUrl: baseUrl ?? "http://127.0.0.1:18080" })

function request(xml: string, suffix: string): XsdValidationRequest {
  const hash = createHash("sha256").update(xml).digest("hex")
  return {
    jobId: `integration-${suffix}`, storeId: "synthetic-store", correlationId: `correlation-${suffix}`,
    contractVersion: XSD_CONTRACT_VERSION, schemaVersion: XSD_SCHEMA_PACKAGE,
    schemaManifestHash: OFFICIAL_XSD_MANIFEST_SHA256, xmlSha256: hash, xmlPayload: xml,
    payloadBytes: Buffer.byteLength(xml), maxPayloadBytes: XSD_MAX_PAYLOAD_BYTES, attempt: 1,
    requestedAt: new Date().toISOString(), deadline: new Date(Date.now() + 5_000).toISOString(),
  }
}

integration("container B2 real", () => {
  it("aprova XML válido, verProc 20 e grafo de imports offline", async () => {
    const result = await client.validate(request(VALID_NFCE_XML, "valid"))
    expect(result.valid).toBe(true)
    expect(result.engine?.libxml2Version).toBe("2.15.3")
    expect(result.engine?.schemaManifestHash).toBe(OFFICIAL_XSD_MANIFEST_SHA256)
    expect(result.engine?.binaryHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("aprova o XML ASSINADO produzido pelo builder fiscal real", async () => {
    const xml = buildNfceXmlAssinavel(dryRunSnapshot("simples"), { serie: 1, numero: 42 })
    expect(xml).toContain("<verProc>OmniGestao-Fiscal1.0</verProc>")
    // O schema exige <Signature> (`<xs:element ref="ds:Signature"/>`, sem minOccurs="0"), então o
    // documento que o XSD julga — e que a SEFAZ recebe — é o assinado. O XML cru é inválido por construção.
    const assinado = signNfceXmlDetailed(xml, DRY_RUN_TEST_CERT, "", { ignorarValidade: true }).xml
    expect((await client.validate(request(assinado, "production-builder"))).valid).toBe(true)
  })

  it("rejeita o XML do builder sem assinatura (Signature é obrigatório no schema)", async () => {
    const xml = buildNfceXmlAssinavel(dryRunSnapshot("simples"), { serie: 1, numero: 42 })
    const result = await client.validate(request(xml, "production-builder-unsigned"))
    expect(result.valid).toBe(false)
    expect(result.outcome).toBe("XML_INVALIDO")
  })

  it.each([
    ["required", NFCE_XML_MISSING_REQUIRED], ["order", NFCE_XML_OUT_OF_ORDER],
    ["type", NFCE_XML_INVALID_TYPE], ["length", NFCE_XML_FIELD_TOO_LONG],
    ["namespace", NFCE_XML_WRONG_NAMESPACE], ["malformed", NFCE_XML_MALFORMED],
    ["verproc21", NFCE_XML_VERPROC_21],
  ])("rejeita negativo %s", async (name, xml) => {
    expect((await client.validate(request(xml, name))).valid).toBe(false)
  })

  it("é idempotente e serializa concorrência sem mudar resultado", async () => {
    const repeated = request(VALID_NFCE_XML, "repeat")
    const first = await client.validate(repeated)
    const second = await client.validate(repeated)
    expect(second).toEqual(first)
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => client.validate(request(VALID_NFCE_XML, `concurrent-${index}`))))
    expect(results.every((result) => result.valid)).toBe(true)
  })
})
