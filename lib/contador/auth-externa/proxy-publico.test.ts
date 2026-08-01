/**
 * TESTE 25 (obrigatório, ajuste G3 #4 do GOAL 014) — as rotas públicas do proxy
 * para o portal externo são SOMENTE as três exatas autorizadas:
 *   /contador-externo/login · /contador-externo/convite · /contador-externo/sessao-expirada
 */
import { describe, expect, it } from "vitest"
import {
  CONTADOR_EXTERNO_ROTAS_PUBLICAS,
  isRotaPublicaContadorExterno,
  isSegmentoContadorExterno,
} from "./proxy-publico"

describe("TESTE 25 · rotas públicas do proxy — exatamente as 3 autorizadas", () => {
  it("a lista pública é EXATAMENTE login, convite e sessao-expirada (nem mais, nem menos)", () => {
    expect([...CONTADOR_EXTERNO_ROTAS_PUBLICAS].sort()).toEqual([
      "/contador-externo/convite",
      "/contador-externo/login",
      "/contador-externo/sessao-expirada",
    ])
  })

  it("as 3 rotas exatas são públicas", () => {
    for (const rota of CONTADOR_EXTERNO_ROTAS_PUBLICAS) {
      expect(isRotaPublicaContadorExterno(rota), rota).toBe(true)
    }
  })

  it("match EXATO: subpaths e variantes NÃO são públicos", () => {
    const negativos = [
      "/contador-externo", // portal autenticado — autoprotegido no servidor
      "/contador-externo/",
      "/contador-externo/login/x",
      "/contador-externo/convite/abc",
      "/contador-externo/convite?token=x",
      "/contador-externo/sessao-expirada/detalhe",
      "/contador-externox",
      "/contador-externox/login",
      "/contador",
      "/login-contador",
    ]
    for (const rota of negativos) {
      expect(isRotaPublicaContadorExterno(rota), rota).toBe(false)
    }
  })

  it("segmento detectado para qualquer path sob /contador-externo (selo não se aplica)", () => {
    expect(isSegmentoContadorExterno("/contador-externo")).toBe(true)
    expect(isSegmentoContadorExterno("/contador-externo/login")).toBe(true)
    expect(isSegmentoContadorExterno("/contador-externo/qualquer-coisa")).toBe(true)
    expect(isSegmentoContadorExterno("/contador-externox")).toBe(false)
    expect(isSegmentoContadorExterno("/contador")).toBe(false)
    expect(isSegmentoContadorExterno("/dashboard/contador")).toBe(false)
  })

  it("rotas autenticadas do segmento NÃO constam como públicas (fail-closed no servidor)", () => {
    // Hoje só existe o portal home; futuras páginas do 015 também não podem
    // "virar públicas" por acidente de prefixo.
    expect(isRotaPublicaContadorExterno("/contador-externo")).toBe(false)
    expect(isRotaPublicaContadorExterno("/contador-externo/lojas")).toBe(false)
    expect(isRotaPublicaContadorExterno("/contador-externo/documentos")).toBe(false)
  })
})
