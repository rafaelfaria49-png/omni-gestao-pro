/**
 * Catálogo oficial P-URL-SP — URLs públicas NFC-e SEFAZ-SP (GOAL 021).
 *
 * Sem SOAP, sem env, sem rede.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import {
  NFCE_SP_PUBLIC_URL_CATALOG,
  NFCE_SP_URL_CONFIRMADO_EM,
  NFCE_SP_URL_FONTE_OFICIAL,
  isOfficialNfceSpQrBaseUrl,
  isOfficialNfceSpUrlChave,
  qrCodeBaseFromPersisted,
  selectNfceSpPublicUrls,
  selectNfceSpPublicUrlsByTpAmb,
} from "./urls-sp"

const HERE = dirname(fileURLToPath(import.meta.url))

describe("P-URL-SP · catálogo oficial SEFAZ-SP", () => {
  it("adjudica homologação e produção com fonte e data versionadas", () => {
    const homo = selectNfceSpPublicUrls("HOMOLOGACAO")
    const prod = selectNfceSpPublicUrls("PRODUCAO")
    expect(homo.qrCodeBaseUrl).toBe("https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode")
    expect(homo.urlChave).toBe("https://www.homologacao.nfce.fazenda.sp.gov.br/consulta")
    expect(prod.qrCodeBaseUrl).toBe("https://www.nfce.fazenda.sp.gov.br/qrcode")
    expect(prod.urlChave).toBe("https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica")
    expect(prod.urlChaveAliases).toEqual(["https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica"])
    expect(prod.urlChave.length).toBeGreaterThanOrEqual(21)
    expect(prod.urlChave.length).toBeLessThanOrEqual(85)
    expect(homo.urlChaveAliases).toEqual([
      "https://www.homologacao.nfce.fazenda.sp.gov.br/consulta",
      "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica",
    ])
    expect(homo.fonteOficial).toBe(NFCE_SP_URL_FONTE_OFICIAL)
    expect(homo.confirmadoEm).toBe(NFCE_SP_URL_CONFIRMADO_EM)
    expect(NFCE_SP_PUBLIC_URL_CATALOG).toHaveLength(2)
    expect(selectNfceSpPublicUrlsByTpAmb("2")).toBe(homo)
    expect(selectNfceSpPublicUrlsByTpAmb(1)).toBe(prod)
  })

  it("aceita aliases oficiais da mesma página e recusa host genérico/env", () => {
    expect(isOfficialNfceSpQrBaseUrl("https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode/", "HOMOLOGACAO")).toBe(true)
    expect(
      isOfficialNfceSpUrlChave(
        "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica",
        "HOMOLOGACAO",
      ),
    ).toBe(true)
    expect(isOfficialNfceSpUrlChave("https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica", "PRODUCAO")).toBe(true)
    expect(isOfficialNfceSpUrlChave("https://www.homologacao.nfce.fazenda.sp.gov.br/consulta", "HOMOLOGACAO")).toBe(
      true,
    )
    expect(isOfficialNfceSpUrlChave("https://www.nfce.fazenda.sp.gov.br/consulta", "PRODUCAO")).toBe(false)
    expect(isOfficialNfceSpUrlChave("https://www.nfce.fazenda.sp.gov.br/consulta")).toBe(false)
    expect(isOfficialNfceSpQrBaseUrl("https://qr.example.test/nfce")).toBe(false)
    expect(isOfficialNfceSpUrlChave("https://consulta.example.test")).toBe(false)
    expect(qrCodeBaseFromPersisted("https://www.nfce.fazenda.sp.gov.br/qrcode?p=ABC|3|1")).toBe(
      "https://www.nfce.fazenda.sp.gov.br/qrcode",
    )
  })

  it("não contém endpoints SOAP nem lê process.env", () => {
    const src = readFileSync(resolve(HERE, "urls-sp.ts"), "utf8")
    expect(src).not.toMatch(/\.asmx|NFeAutorizacao|statusServico|process\.env/i)
    expect(src).not.toMatch(/urlChave:\s*"https:\/\/www\.nfce\.fazenda\.sp\.gov\.br\/consulta"/)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    selectNfceSpPublicUrls("HOMOLOGACAO")
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
