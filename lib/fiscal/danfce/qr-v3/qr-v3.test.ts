/**
 * Encoder puro QR NFC-e v3 — testes determinísticos (GOAL 021A).
 *
 * Fixtures derivadas só dos contratos já versionados (chave NFC-e, TDec_1302/XSD QR v3,
 * certificado de teste XMLDSig). Nenhuma rede. Nenhum certificado real.
 */
import { createPublicKey } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM } from "@/lib/fiscal/signing/__fixtures__/test-cert"
import { montarChaveAcesso } from "@/lib/fiscal/xml/nfce-chave-acesso"
import {
  QR_V3_VERSAO,
  buildNfceQrV3OfflineCanonical,
  createQrV3OfflinePemSigner,
  encodeNfceQrV3Offline,
  encodeNfceQrV3OfflineUrl,
  encodeNfceQrV3Online,
  encodeNfceQrV3OnlineUrl,
  verifyQrV3OfflineSignature,
} from "./index"
import { assertNoCsc } from "./canonical"

const SYNTHETIC_BASE = "https://qr.example.test/nfce"

const CHAVE_ONLINE = montarChaveAcesso({
  cUF: "35",
  aamm: "2608",
  cnpj: "11222333000181",
  modelo: "65",
  serie: 1,
  numero: 123,
  tpEmis: 1,
  cNF: "00000001",
})

const CHAVE_OFFLINE = montarChaveAcesso({
  cUF: "35",
  aamm: "2608",
  cnpj: "11222333000181",
  modelo: "65",
  serie: 1,
  numero: 123,
  tpEmis: 9,
  cNF: "00000001",
})

const XSD_V3_ONLINE =
  /^((HTTPS?|https?):\/\/.*\?p=([0-9]{6}[0-9A-Z]{12}[0-9]{16}(1|3|4)[0-9]{9})\|[3]\|[1-2])$/
const XSD_V3_OFFLINE =
  /^((HTTPS?|https?):\/\/.*\?p=([0-9]{6}[0-9A-Z]{12}[0-9]{16}(9)[0-9]{9})\|[3]\|[1-2]\|(0[1-9]|[12][0-9]|3[01])\|(0|0\.[0-9]{2}|[1-9][0-9]{0,12}(\.[0-9]{2})?)\|((1|2|3)?)\|((([0-9A-Z]{12}[0-9]{2})|([0-9]{11}))?)\|([a-zA-Z0-9+/]+[=]{0,2}))$/

const sign = createQrV3OfflinePemSigner(TEST_KEY_PLAIN_PEM)
const publicKey = createPublicKey(TEST_CERT_PEM)

const HERE = dirname(fileURLToPath(import.meta.url))

function sourceOf(file: string): string {
  return readFileSync(resolve(HERE, file), "utf8")
}

describe("QR v3 online", () => {
  it("é determinístico em homologação e produção, versão exatamente 3", () => {
    const homo = encodeNfceQrV3Online({ chave: CHAVE_ONLINE, tpAmb: 2 })
    const prod = encodeNfceQrV3Online({ chave: CHAVE_ONLINE, tpAmb: "1" })
    expect(homo.ok).toBe(true)
    expect(prod.ok).toBe(true)
    if (!homo.ok || !prod.ok) return
    expect(homo.versao).toBe("3")
    expect(homo.versao).toBe(QR_V3_VERSAO)
    expect(homo.payload).toBe(`${CHAVE_ONLINE}|3|2`)
    expect(homo.p).toBe(homo.payload)
    expect(prod.payload).toBe(`${CHAVE_ONLINE}|3|1`)
    expect(encodeNfceQrV3Online({ chave: CHAVE_ONLINE, tpAmb: 2 })).toEqual(homo)
  })

  it("casa o pattern XSD QRCODE V3 ONLINE quando a URL base é injetada", () => {
    const encoded = encodeNfceQrV3OnlineUrl({
      chave: CHAVE_ONLINE,
      tpAmb: 2,
      baseUrl: SYNTHETIC_BASE,
    })
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.url).toBe(`${SYNTHETIC_BASE}?p=${CHAVE_ONLINE}|3|2`)
    expect(encoded.url).toMatch(XSD_V3_ONLINE)
    expect(encoded.url).not.toMatch(/csc|idCSC|cIdToken/i)
  })

  it("rejeita chave inválida e tpAmb inválido", () => {
    expect(encodeNfceQrV3Online({ chave: "123", tpAmb: 2 })).toEqual({
      ok: false,
      code: "chave_invalida",
    })
    const brokenDv = `${CHAVE_ONLINE.slice(0, 43)}0`
    expect(encodeNfceQrV3Online({ chave: brokenDv === CHAVE_ONLINE ? `${CHAVE_ONLINE.slice(0, 43)}1` : brokenDv, tpAmb: 2 }).ok).toBe(
      false,
    )
    expect(encodeNfceQrV3Online({ chave: CHAVE_ONLINE, tpAmb: 3 as never })).toEqual({
      ok: false,
      code: "tp_amb_invalido",
    })
  })

  it("rejeita chave de contingência (tpEmis=9) no encoder online", () => {
    expect(encodeNfceQrV3Online({ chave: CHAVE_OFFLINE, tpAmb: 2 })).toEqual({
      ok: false,
      code: "tp_emis_incompativel",
    })
  })
})

describe("QR v3 offline", () => {
  const baseOffline = {
    chave: CHAVE_OFFLINE,
    tpAmb: 2 as const,
    dhEmi: "2026-08-20T15:00:00-03:00",
    vNF: "50.00",
  }

  it("monta a mensagem canônica 1–7 antes de assinar (destinatário ausente)", () => {
    const canonical = buildNfceQrV3OfflineCanonical({
      ...baseOffline,
      destinatario: { kind: "ausente" },
    })
    expect(canonical.ok).toBe(true)
    if (!canonical.ok) return
    expect(canonical.versao).toBe("3")
    expect(canonical.dia).toBe("20")
    expect(canonical.vNF).toBe("50.00")
    expect(canonical.tpId).toBe("")
    expect(canonical.idDest).toBe("")
    expect(canonical.canonical).toBe(`${CHAVE_OFFLINE}|3|2|20|50.00||`)
  })

  it("é determinístico com destinatário CPF/CNPJ e vNF numérico", () => {
    const cpf = encodeNfceQrV3Offline({
      ...baseOffline,
      vNF: 10.5,
      destinatario: { kind: "cpf", cpf: "529.982.247-25" },
      sign,
    })
    const cnpj = encodeNfceQrV3Offline({
      ...baseOffline,
      tpAmb: 1,
      destinatario: { kind: "cnpj", cnpj: "11.222.333/0001-81" },
      sign,
    })
    expect(cpf.ok && cnpj.ok).toBe(true)
    if (!cpf.ok || !cnpj.ok) return
    expect(cpf.canonical).toBe(`${CHAVE_OFFLINE}|3|2|20|10.50|2|52998224725`)
    expect(cnpj.canonical).toBe(`${CHAVE_OFFLINE}|3|1|20|50.00|1|11222333000181`)
    expect(cpf.payload).toBe(`${cpf.canonical}|${cpf.assinatura}`)
    expect(cnpj.payload).toBe(`${cnpj.canonical}|${cnpj.assinatura}`)
    expect(verifyQrV3OfflineSignature(cpf.canonical, cpf.assinatura, publicKey)).toBe(true)
    expect(encodeNfceQrV3Offline({ ...baseOffline, vNF: 10.5, destinatario: { kind: "cpf", cpf: "52998224725" }, sign })).toEqual(
      cpf,
    )
  })

  it("destinatário estrangeiro preenche tpId=3 e idDest vazio", () => {
    const encoded = encodeNfceQrV3Offline({
      ...baseOffline,
      destinatario: { kind: "estrangeiro" },
      sign,
    })
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.tpId).toBe("3")
    expect(encoded.idDest).toBe("")
    expect(encoded.canonical).toBe(`${CHAVE_OFFLINE}|3|2|20|50.00|3|`)
  })

  it("aceita dhEmi válido e rejeita calendário impossível / formato solto", () => {
    const ok = buildNfceQrV3OfflineCanonical({ ...baseOffline, dhEmi: "2026-01-01T00:00:00-03:00" })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.dia).toBe("01")
    expect(buildNfceQrV3OfflineCanonical({ ...baseOffline, dhEmi: "2026-02-30T12:00:00-03:00" })).toEqual({
      ok: false,
      code: "dh_emi_invalido",
    })
    expect(buildNfceQrV3OfflineCanonical({ ...baseOffline, dhEmi: "20/08/2026" })).toEqual({
      ok: false,
      code: "dh_emi_invalido",
    })
  })

  it("rejeita vNF inválido, chave online e assinatura ausente", () => {
    expect(encodeNfceQrV3Offline({ ...baseOffline, vNF: -1, sign })).toEqual({
      ok: false,
      code: "vnf_invalido",
    })
    expect(encodeNfceQrV3Offline({ ...baseOffline, vNF: "10,00", sign })).toEqual({
      ok: false,
      code: "vnf_invalido",
    })
    expect(encodeNfceQrV3Offline({ ...baseOffline, chave: CHAVE_ONLINE, sign })).toEqual({
      ok: false,
      code: "tp_emis_incompativel",
    })
    expect(encodeNfceQrV3Offline(baseOffline)).toEqual({
      ok: false,
      code: "assinatura_ausente",
    })
  })

  it("integra assinatura Base64 já produzida sem reabrir chave", () => {
    const first = encodeNfceQrV3Offline({ ...baseOffline, sign })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const replay = encodeNfceQrV3Offline({
      ...baseOffline,
      assinaturaBase64: first.assinatura,
    })
    expect(replay).toEqual(first)
    expect(first.assinatura).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(verifyQrV3OfflineSignature(first.canonical, first.assinatura, publicKey)).toBe(true)
  })

  it("casa o pattern XSD QRCODE V3 OFFLINE com URL injetada", () => {
    const encoded = encodeNfceQrV3OfflineUrl({
      ...baseOffline,
      destinatario: { kind: "ausente" },
      sign,
      baseUrl: SYNTHETIC_BASE,
    })
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.url).toMatch(XSD_V3_OFFLINE)
    expect(encoded.url.startsWith(`${SYNTHETIC_BASE}?p=`)).toBe(true)
    expect(encoded.url).not.toContain(encodeURIComponent("|"))
  })
})

describe("invariantes do encoder v3", () => {
  it("nunca emite CSC, idCSC ou token CSC no payload", () => {
    const online = encodeNfceQrV3Online({ chave: CHAVE_ONLINE, tpAmb: 2 })
    const offline = encodeNfceQrV3Offline({
      chave: CHAVE_OFFLINE,
      tpAmb: 2,
      dhEmi: "2026-08-20T15:00:00-03:00",
      vNF: "0.00",
      sign,
    })
    expect(online.ok && offline.ok).toBe(true)
    if (!online.ok || !offline.ok) return
    for (const text of [online.payload, online.p, offline.payload, offline.p, offline.canonical, offline.assinatura]) {
      expect(assertNoCsc(text)).toBe(true)
      expect(text).not.toMatch(/csc/i)
      expect(text).not.toMatch(/idcsc/i)
      expect(text).not.toMatch(/cidtoken/i)
    }
  })

  it("não dispara rede e os fontes não importam Prisma/vault/PFX", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    encodeNfceQrV3Online({ chave: CHAVE_ONLINE, tpAmb: 1 })
    encodeNfceQrV3Offline({
      chave: CHAVE_OFFLINE,
      tpAmb: 2,
      dhEmi: "2026-08-20T15:00:00-03:00",
      vNF: 1,
      sign,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    const sources = ["canonical.ts", "online.ts", "offline.ts", "index.ts", "types.ts"].map(sourceOf)
    const imports = sources
      .flatMap((src) => src.split("\n").filter((line) => /^\s*import\s/.test(line)))
      .join("\n")
    expect(imports).not.toMatch(/prisma|FiscalSecretVault|pkcs12|EnvVault|wsdl-ephemeral/i)
  })
})
