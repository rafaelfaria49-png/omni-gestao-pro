/**
 * GOAL CONTADOR-HUB-DOCUMENTOS-REAL-010B · Etapa 12 (validação/sanitização).
 */
import { describe, expect, it } from "vitest"
import {
  DocumentoValidacaoError,
  montarStorageRef,
  sanitizarNomeArquivo,
  storageRefCanonicoConfere,
  validarConteudoReal,
  validarExtensao,
  validarMimeDeclarado,
  validarTamanho,
} from "@/lib/contador/documentos/validacao"

const PDF = Buffer.from("%PDF-1.4\n...", "utf8")
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])

describe("sanitizarNomeArquivo", () => {
  it("remove componentes de diretório (path traversal)", () => {
    expect(sanitizarNomeArquivo("../../etc/passwd.txt")).toBe("passwd.txt")
    expect(sanitizarNomeArquivo("C:\\Windows\\system32\\nota.pdf")).toBe("nota.pdf")
    expect(sanitizarNomeArquivo("pasta/sub/rel.csv")).toBe("rel.csv")
  })

  it("rejeita nome vazio, só-ponto e componente iniciando por ponto", () => {
    expect(() => sanitizarNomeArquivo("")).toThrow(DocumentoValidacaoError)
    expect(() => sanitizarNomeArquivo("..")).toThrow(DocumentoValidacaoError)
    // ".htaccess" perde o ponto inicial e vira "htaccess" (sem extensão) → extensão falha depois.
    expect(sanitizarNomeArquivo(".config.pdf")).toBe("config.pdf")
  })

  it("rejeita caracteres de controle", () => {
    expect(() => sanitizarNomeArquivo("nota\u0000.pdf")).toThrow(DocumentoValidacaoError)
    expect(() => sanitizarNomeArquivo("nota\u0007.pdf")).toThrow(DocumentoValidacaoError)
  })

  it("rejeita nomes reservados do Windows", () => {
    expect(() => sanitizarNomeArquivo("CON.pdf")).toThrow(DocumentoValidacaoError)
    expect(() => sanitizarNomeArquivo("lpt1.txt")).toThrow(DocumentoValidacaoError)
  })

  it("neutraliza caracteres proibidos de nome de arquivo", () => {
    expect(sanitizarNomeArquivo('re<la>tório:*.pdf')).toBe("re_la_tório__.pdf")
  })
})

describe("validarExtensao (allowlist + extensão dupla enganosa)", () => {
  it("aceita extensões permitidas e o alias jpeg→jpg", () => {
    expect(validarExtensao("a.pdf")).toBe("pdf")
    expect(validarExtensao("a.JPEG")).toBe("jpg")
    expect(validarExtensao("a.xlsx")).toBe("xlsx")
  })

  it("rejeita extensão final não permitida mesmo com extensão dupla enganosa", () => {
    expect(() => validarExtensao("nota.pdf.exe")).toThrow(DocumentoValidacaoError)
    expect(() => validarExtensao("foto.jpg.js")).toThrow(DocumentoValidacaoError)
    expect(() => validarExtensao("semext")).toThrow(DocumentoValidacaoError)
  })
})

describe("validarMimeDeclarado", () => {
  it("aceita MIME compatível e text/* para famílias de texto", () => {
    expect(validarMimeDeclarado("pdf", "application/pdf")).toBe("application/pdf")
    expect(validarMimeDeclarado("csv", "text/plain")).toBe("text/plain")
    expect(validarMimeDeclarado("xml", "text/xml")).toBe("text/xml")
  })
  it("rejeita MIME incompatível", () => {
    expect(() => validarMimeDeclarado("pdf", "image/png")).toThrow(DocumentoValidacaoError)
    expect(() => validarMimeDeclarado("png", "application/pdf")).toThrow(DocumentoValidacaoError)
  })
})

describe("validarTamanho", () => {
  it("rejeita vazio e acima de 25 MB; aceita válido", () => {
    expect(() => validarTamanho(0)).toThrow(DocumentoValidacaoError)
    expect(() => validarTamanho(26 * 1024 * 1024)).toThrow(DocumentoValidacaoError)
    expect(validarTamanho(1234)).toBe(1234)
  })
})

describe("validarConteudoReal", () => {
  it("valida magic bytes de pdf/png/zip", () => {
    expect(() => validarConteudoReal("pdf", PDF)).not.toThrow()
    expect(() => validarConteudoReal("png", PNG)).not.toThrow()
    expect(() => validarConteudoReal("zip", ZIP)).not.toThrow()
    expect(() => validarConteudoReal("xlsx", ZIP)).not.toThrow() // xlsx é zip
  })

  it("rejeita binário incoerente com a extensão", () => {
    expect(() => validarConteudoReal("pdf", Buffer.from("hello"))).toThrow(DocumentoValidacaoError)
    expect(() => validarConteudoReal("png", PDF)).toThrow(DocumentoValidacaoError)
  })

  it("bloqueia HTML, SVG e script em arquivos de texto", () => {
    expect(() => validarConteudoReal("txt", Buffer.from("<!DOCTYPE html><html></html>"))).toThrow(
      DocumentoValidacaoError,
    )
    expect(() => validarConteudoReal("xml", Buffer.from("<svg xmlns='...'></svg>"))).toThrow(
      DocumentoValidacaoError,
    )
    expect(() => validarConteudoReal("csv", Buffer.from("a,b\n<script>x</script>"))).toThrow(
      DocumentoValidacaoError,
    )
  })

  it("rejeita texto não-UTF-8 e com bytes NUL", () => {
    expect(() => validarConteudoReal("txt", Buffer.from([0x61, 0x00, 0x62]))).toThrow(DocumentoValidacaoError)
    expect(() => validarConteudoReal("csv", Buffer.from([0xff, 0xfe, 0x00]))).toThrow(DocumentoValidacaoError)
  })

  it("aceita csv e xml coerentes", () => {
    expect(() => validarConteudoReal("csv", Buffer.from("nome,valor\nDAS,100"))).not.toThrow()
    expect(() => validarConteudoReal("xml", Buffer.from("<?xml version='1.0'?><nota/>"))).not.toThrow()
  })

  it("rejeita arquivo vazio", () => {
    expect(() => validarConteudoReal("pdf", Buffer.alloc(0))).toThrow(DocumentoValidacaoError)
  })
})

describe("montarStorageRef / storageRefCanonicoConfere", () => {
  it("monta o path canônico contador/{store}/{aaaa-mm}/{docId}/{nome}", () => {
    const ref = montarStorageRef({
      storeId: "loja-1",
      aaaaMm: "2026-07",
      documentoId: "doc-abc",
      nomeSanitizado: "das.pdf",
    })
    expect(ref).toBe("contador/loja-1/2026-07/doc-abc/das.pdf")
  })

  it("rejeita competência fora de AAAA-MM", () => {
    expect(() =>
      montarStorageRef({ storeId: "loja-1", aaaaMm: "2026-13", documentoId: "d", nomeSanitizado: "a.pdf" }),
    ).toThrow(DocumentoValidacaoError)
  })

  it("storageRefCanonicoConfere exige igualdade estrita com o path canônico", () => {
    const ref = "contador/loja-1/2026-07/doc-abc/das.pdf"
    const params = {
      storeId: "loja-1",
      aaaaMm: "2026-07",
      documentoId: "doc-abc",
      nomeSanitizado: "das.pdf",
    }
    expect(storageRefCanonicoConfere(ref, params)).toBe(true)
    expect(storageRefCanonicoConfere(ref, { ...params, storeId: "loja-2" })).toBe(false)
    expect(storageRefCanonicoConfere(ref, { ...params, documentoId: "doc-xyz" })).toBe(false)
    expect(storageRefCanonicoConfere(ref, { ...params, aaaaMm: "2026-06" })).toBe(false)
    expect(storageRefCanonicoConfere(ref, { ...params, nomeSanitizado: "outro.pdf" })).toBe(false)
  })

  /**
   * Regressão do P1 (GOAL 012E). A checagem anterior usava
   * `startsWith(contador/{loja}/)` + `includes(/{docId}/)`, então um `documentoId`
   * escolhido para casar com QUALQUER segmento do path alheio (aqui, a própria
   * competência) dava posse sobre o blob de outro documento. Com igualdade estrita
   * não existe segmento "coringa".
   */
  it("não aceita um documentoId que apenas APAREÇA como segmento do path alheio", () => {
    const refDaVitima = "contador/loja-1/2026-07/doc-vitima/nota.pdf"
    expect(
      storageRefCanonicoConfere(refDaVitima, {
        storeId: "loja-1",
        aaaaMm: "2026-07",
        documentoId: "2026-07", // segmento que existe no path da vítima
        nomeSanitizado: "nota.pdf",
      }),
    ).toBe(false)
  })

  it("rejeita ref com prefixo correto mas caminho estendido (sem prova por prefixo)", () => {
    expect(
      storageRefCanonicoConfere("contador/loja-1/2026-07/doc-abc/sub/das.pdf", {
        storeId: "loja-1",
        aaaaMm: "2026-07",
        documentoId: "doc-abc",
        nomeSanitizado: "das.pdf",
      }),
    ).toBe(false)
  })
})
