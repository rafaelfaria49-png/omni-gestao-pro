/**
 * GOAL-016D-B · correção 002 — teto de corpo e contexto do documento (bloqueios 3 e 4 da
 * revisão cruzada do PR #44).
 *
 * ## Bloqueio 3 — o teto era de bytes só para `Uint8Array`
 *
 * Entrada `string` passava direto para o parser. E `string.length` não serve de substituto:
 * conta unidades UTF-16. Um corpo com 1,5 milhão de caracteres CJK ocupa ~4,5 MB em UTF-8 e
 * passaria por qualquer verificação baseada em `length`. O teto existe justamente para não
 * parsear XML hostil grande — medir depois de parsear não protege de nada.
 *
 * ## Bloqueio 4 — `chaveAcessoEsperada` era opcional
 *
 * Sem o contexto do documento, uma resposta perfeitamente bem-formada de OUTRA nota é
 * indistinguível de uma correta. Agora é obrigatória e validada em runtime.
 *
 * O arquivo é separado porque **espiona `parseXml`** via mock de módulo, e isso não deve
 * contaminar a suíte principal do parser.
 */
import { describe, expect, it, vi } from "vitest"
import { parseXml } from "@/lib/fiscal/signing/c14n"
import {
  SEFAZ_MAX_RESPONSE_BYTES,
  parseSefazSoapResponse,
} from "./sefaz-response-parser"
import * as F from "./__fixtures__/sefaz-soap-fixtures"

vi.mock("@/lib/fiscal/signing/c14n", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/fiscal/signing/c14n")>()
  return { ...real, parseXml: vi.fn(real.parseXml) }
})

const parseXmlEspiao = vi.mocked(parseXml)

function classificar(body: string | Uint8Array, chave: string = F.CHAVE_SINTETICA) {
  return parseSefazSoapResponse({
    servico: "NFeAutorizacao4",
    body,
    chaveAcessoEsperada: chave,
  })
}

/** Constrói um envelope válido cujo corpo total tem EXATAMENTE `alvo` bytes UTF-8. */
function envelopeComTamanhoExato(alvo: number, preenchimento = "a"): string {
  const base = F.AUTORIZACAO_LOTE_RECEBIDO_103
  const marcador = "<xMotivo>Lote recebido com sucesso</xMotivo>"
  const bytesBase = new TextEncoder().encode(base).byteLength
  const bytesPreenchimento = new TextEncoder().encode(preenchimento).byteLength
  const faltando = alvo - bytesBase
  if (faltando < 0 || faltando % bytesPreenchimento !== 0) {
    throw new Error(`alvo ${alvo} não é alcançável com o preenchimento escolhido`)
  }
  const recheio = preenchimento.repeat(faltando / bytesPreenchimento)
  return base.replace(marcador, `<xMotivo>Lote recebido com sucesso${recheio}</xMotivo>`)
}

describe("teto de 2 MB — bytes", () => {
  it("Uint8Array acima do teto é recusado", () => {
    const grande = new Uint8Array(SEFAZ_MAX_RESPONSE_BYTES + 1)
    grande.fill(0x20)
    const c = classificar(grande)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("MALFORMED_RESPONSE")
    expect(c.mensagem).toContain("limite de corpo")
  })
})

describe("teto de 2 MB — string", () => {
  it("string ASCII acima do teto é recusada", () => {
    const c = classificar("a".repeat(SEFAZ_MAX_RESPONSE_BYTES + 1))
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.mensagem).toContain("limite de corpo")
  })

  it("string MULTIBYTE com poucos caracteres, porém acima do teto em bytes UTF-8", () => {
    // "漢" ocupa 3 bytes. Metade do teto em caracteres ⇒ 1,5× o teto em bytes.
    const caracteres = Math.floor(SEFAZ_MAX_RESPONSE_BYTES / 2)
    const corpo = "漢".repeat(caracteres)
    expect(corpo.length).toBeLessThan(SEFAZ_MAX_RESPONSE_BYTES)
    expect(new TextEncoder().encode(corpo).byteLength).toBeGreaterThan(SEFAZ_MAX_RESPONSE_BYTES)

    const c = classificar(corpo)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.mensagem).toContain("limite de corpo")
  })

  it("string multibyte ABAIXO do teto em bytes não é recusada por tamanho", () => {
    // Um terço do teto em caracteres de 3 bytes ⇒ exatamente sob o limite.
    const corpo = "漢".repeat(Math.floor(SEFAZ_MAX_RESPONSE_BYTES / 3) - 10)
    expect(new TextEncoder().encode(corpo).byteLength).toBeLessThan(SEFAZ_MAX_RESPONSE_BYTES)
    const c = classificar(corpo)
    // Recusada por não ser XML — não pelo tamanho. É a distinção que importa.
    expect(c.mensagem).not.toContain("limite de corpo")
  })

  it("o limite EXATO é aceito e um byte acima é recusado", () => {
    const noLimite = envelopeComTamanhoExato(SEFAZ_MAX_RESPONSE_BYTES)
    expect(new TextEncoder().encode(noLimite).byteLength).toBe(SEFAZ_MAX_RESPONSE_BYTES)
    const aceito = classificar(noLimite)
    expect(aceito.mensagem).not.toContain("limite de corpo")
    expect(aceito.outcome).toBe("PROCESSING")

    const umAcima = envelopeComTamanhoExato(SEFAZ_MAX_RESPONSE_BYTES + 1)
    expect(new TextEncoder().encode(umAcima).byteLength).toBe(SEFAZ_MAX_RESPONSE_BYTES + 1)
    const recusado = classificar(umAcima)
    expect(recusado.outcome).toBe("UNCERTAIN")
    expect(recusado.mensagem).toContain("limite de corpo")
  })
})

describe("acima do teto, parseXml NUNCA é chamado", () => {
  it("string oversized aborta antes do parser", () => {
    parseXmlEspiao.mockClear()
    classificar("漢".repeat(Math.floor(SEFAZ_MAX_RESPONSE_BYTES / 2)))
    expect(parseXmlEspiao).not.toHaveBeenCalled()
  })

  it("bytes oversized abortam antes do parser", () => {
    parseXmlEspiao.mockClear()
    const grande = new Uint8Array(SEFAZ_MAX_RESPONSE_BYTES + 1)
    grande.fill(0x20)
    classificar(grande)
    expect(parseXmlEspiao).not.toHaveBeenCalled()
  })

  it("contraprova: um corpo dentro do teto CHEGA ao parser", () => {
    parseXmlEspiao.mockClear()
    classificar(F.AUTORIZACAO_LOTE_RECEBIDO_103)
    expect(parseXmlEspiao).toHaveBeenCalled()
  })

  it("chave esperada inválida também aborta antes do parser", () => {
    parseXmlEspiao.mockClear()
    classificar(F.AUTORIZACAO_AUTORIZADA, "123")
    expect(parseXmlEspiao).not.toHaveBeenCalled()
  })
})

describe("contexto do documento é obrigatório", () => {
  const invalidas: Array<[string, unknown]> = [
    ["ausente", undefined],
    ["nula", null],
    ["vazia", ""],
    ["curta", "123"],
    ["44 caracteres não numéricos", "A".repeat(44)],
    ["43 dígitos", "9".repeat(43)],
    ["45 dígitos", "9".repeat(45)],
    ["com espaço", ` ${F.CHAVE_SINTETICA.slice(1)}`],
    ["não string", 12345],
  ]

  it.each(invalidas)("chave %s ⇒ MISSING_DOCUMENT_CONTEXT", (_nome, chave) => {
    const c = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.CONSULTA_AUTORIZADA_100,
      chaveAcessoEsperada: chave as string,
    })
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("MISSING_DOCUMENT_CONTEXT")
    expect(c.xmlAutorizado).toBeNull()
    expect(c.protocolo).toBeNull()
  })

  it("NENHUM AUTHORIZED sai sem prova de vínculo com a chave do chamador", () => {
    // A fixture é o caminho feliz completo: 100 + protocolo + nfeProc coerente.
    for (const [, chave] of invalidas) {
      const c = parseSefazSoapResponse({
        servico: "NFeConsultaProtocolo4",
        body: F.CONSULTA_AUTORIZADA_100,
        chaveAcessoEsperada: chave as string,
      })
      expect(c.outcome).not.toBe("AUTHORIZED")
    }
    // Chave válida porém de outro documento: também não autoriza.
    const outra = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.CONSULTA_AUTORIZADA_100,
      chaveAcessoEsperada: F.OUTRA_CHAVE_SINTETICA,
    })
    expect(outra.outcome).toBe("UNCERTAIN")
    expect(outra.reason).toBe("DOCUMENT_MISMATCH")

    // Só a chave correta autoriza.
    const correta = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.CONSULTA_AUTORIZADA_100,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    expect(correta.outcome).toBe("AUTHORIZED")
  })

  it("a chave da RESPOSTA não é autoridade: ela é conferida contra a do chamador", () => {
    // Mesmo com a resposta declarando `OUTRA_CHAVE`, o escopo é o do chamador — e diverge.
    const respostaDeOutro = F.CONSULTA_AUTORIZADA_100.split(F.CHAVE_SINTETICA).join(
      F.OUTRA_CHAVE_SINTETICA,
    )
    const c = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: respostaDeOutro,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("DOCUMENT_MISMATCH")
  })
})
