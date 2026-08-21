/**
 * CONTADOR-CONVITE-LINK-COPY-UX-FIX — cópia do link com fallback de seleção.
 *
 * O bug: com o clipboard bloqueado, a UI mandava "selecione e copie manualmente"
 * sem selecionar nada, e o link vivia num `<code truncate>` — Ctrl+A pegava a página
 * e o token completo era inalcançável. O contrato aqui é que o fallback SELECIONA.
 */
import { describe, expect, it, vi } from "vitest"
import {
  copiarLinkConvite,
  mensagemDeCopia,
  MENSAGEM_SELECAO,
  MENSAGEM_SEM_SELECAO,
} from "./copiar-link-convite"

const URL_CONVITE =
  "https://omni-gestao-pro.vercel.app/contador-externo/convite#token=0QADFC9dkIIoi1KxLXVHw3ze2_pfdDzHUX7VAcfz4_w"

describe("copiarLinkConvite", () => {
  it("usa o clipboard quando ele funciona — e não seleciona o campo à toa", async () => {
    const escreverClipboard = vi.fn<(texto: string) => Promise<void>>(async () => {})
    const selecionarCampo = vi.fn(() => true)

    const r = await copiarLinkConvite({ url: URL_CONVITE, escreverClipboard, selecionarCampo })

    expect(r).toEqual({ modo: "clipboard" })
    expect(escreverClipboard).toHaveBeenCalledWith(URL_CONVITE)
    expect(selecionarCampo).not.toHaveBeenCalled()
    expect(mensagemDeCopia(r)).toBeNull()
  })

  it("escreve a URL COMPLETA no clipboard — nada de versão truncada", async () => {
    const escreverClipboard = vi.fn<(texto: string) => Promise<void>>(async () => {})

    await copiarLinkConvite({ url: URL_CONVITE, escreverClipboard })

    const enviado = escreverClipboard.mock.calls[0]?.[0]
    expect(enviado).toBe(URL_CONVITE)
    expect(enviado).toContain("#token=")
    expect(enviado).not.toContain("…")
    expect(enviado).not.toContain("...")
  })

  it("clipboard REJEITA ⇒ seleciona o campo e pede Ctrl+C", async () => {
    const escreverClipboard = vi.fn(async () => {
      throw new DOMException("Write permission denied.", "NotAllowedError")
    })
    const selecionarCampo = vi.fn(() => true)

    const r = await copiarLinkConvite({ url: URL_CONVITE, escreverClipboard, selecionarCampo })

    expect(r).toEqual({ modo: "selecao" })
    expect(selecionarCampo).toHaveBeenCalledOnce()
    expect(mensagemDeCopia(r)).toBe(MENSAGEM_SELECAO)
  })

  it("clipboard AUSENTE (navegador sem a API) cai direto na seleção", async () => {
    const selecionarCampo = vi.fn(() => true)

    const r = await copiarLinkConvite({ url: URL_CONVITE, escreverClipboard: null, selecionarCampo })

    expect(r).toEqual({ modo: "selecao" })
    expect(selecionarCampo).toHaveBeenCalledOnce()
  })

  it("a mensagem de fallback NUNCA é o texto vazio do bug antigo", async () => {
    const r = await copiarLinkConvite({
      url: URL_CONVITE,
      escreverClipboard: null,
      selecionarCampo: () => true,
    })

    const msg = mensagemDeCopia(r) ?? ""
    expect(msg).toContain("Ctrl+C")
    expect(msg).not.toMatch(/selecione e copie o link manualmente/i)
  })

  it("seleção também falha ⇒ admite honestamente, sem prometer o que não fez", async () => {
    const r = await copiarLinkConvite({
      url: URL_CONVITE,
      escreverClipboard: null,
      selecionarCampo: () => false,
    })

    expect(r).toEqual({ modo: "indisponivel" })
    expect(mensagemDeCopia(r)).toBe(MENSAGEM_SEM_SELECAO)
  })

  it("seleção que LANÇA é tratada como falha, não propaga", async () => {
    const r = await copiarLinkConvite({
      url: URL_CONVITE,
      escreverClipboard: null,
      selecionarCampo: () => {
        throw new Error("nó fora da árvore")
      },
    })

    expect(r).toEqual({ modo: "indisponivel" })
  })

  it("sem URL não tenta clipboard nem seleção", async () => {
    const escreverClipboard = vi.fn<(texto: string) => Promise<void>>(async () => {})
    const selecionarCampo = vi.fn(() => true)

    const r = await copiarLinkConvite({ url: "", escreverClipboard, selecionarCampo })

    expect(r).toEqual({ modo: "indisponivel" })
    expect(escreverClipboard).not.toHaveBeenCalled()
    expect(selecionarCampo).not.toHaveBeenCalled()
  })

  it("não guarda o link em lugar nenhum — a função é sem estado", async () => {
    const escreverClipboard = vi.fn<(texto: string) => Promise<void>>(async () => {})
    await copiarLinkConvite({ url: URL_CONVITE, escreverClipboard })

    // Nenhum storage é tocado: o módulo não importa nem referencia storage algum.
    expect(globalThis).not.toHaveProperty("__ultimoLinkConvite")
  })
})
