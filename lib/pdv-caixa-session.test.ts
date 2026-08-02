/**
 * PDV-CAIXA-SESSION-RECOVERY-CART-DRAFT-001 — reprodução do incidente da Loja 2.
 *
 * Cenário real: o computador do PDV travou e foi reiniciado. A `SessaoCaixa`
 * continuou ABERTA no servidor, mas o cliente voltou com a referência local
 * ausente (abertura marcou `caixa.isOpen` antes do POST confirmar) ou apontando
 * para uma sessão antiga. O PDV mostrava "Caixa Aberto" e mesmo assim recusava
 * a finalização com "Sessão de caixa inválida. Abra ou atualize o caixa antes
 * de finalizar." — sem nenhuma ação de atualizar disponível.
 */

import { describe, it, expect } from "vitest"
import {
  decideCaixaSessionSync,
  isCaixaReferenceStale,
  type ServerCaixaSession,
} from "@/lib/pdv-caixa-session"

const LOJA = "loja-2"

const sessaoAberta: ServerCaixaSession = {
  id: "sess-servidor-aberta",
  storeId: LOJA,
  saldoInicial: 200,
  abertaEm: "2026-08-02T11:00:00.000Z",
}

describe("decideCaixaSessionSync — servidor é a fonte da verdade", () => {
  it("referência local AUSENTE + caixa aberto no servidor → adota a sessão do servidor", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: true, sessaoId: null },
      server: sessaoAberta,
    })

    expect(decision).toEqual({
      action: "adopt",
      reason: "referencia-ausente",
      sessaoId: "sess-servidor-aberta",
      saldoInicial: 200,
      abertaEm: "2026-08-02T11:00:00.000Z",
      replaced: null,
    })
  })

  it("referência local OBSOLETA (sessão antiga) + caixa aberto → substitui pela sessão atual", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: true, sessaoId: "sess-antiga-de-ontem" },
      server: sessaoAberta,
    })

    expect(decision).toMatchObject({
      action: "adopt",
      reason: "referencia-obsoleta",
      sessaoId: "sess-servidor-aberta",
      replaced: "sess-antiga-de-ontem",
    })
  })

  it("referência local só com espaços conta como ausente", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: true, sessaoId: "   " },
      server: sessaoAberta,
    })

    expect(decision).toMatchObject({ action: "adopt", reason: "referencia-ausente" })
  })

  it("cliente achando que está fechado + caixa aberto no servidor → adota (comportamento já existente)", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: false, sessaoId: null },
      server: sessaoAberta,
    })

    expect(decision).toMatchObject({ action: "adopt", reason: "local-fechado", sessaoId: "sess-servidor-aberta" })
  })

  it("cliente em sincronia com o servidor → não mexe no estado", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: true, sessaoId: "sess-servidor-aberta" },
      server: sessaoAberta,
    })

    expect(decision).toEqual({ action: "keep", reason: "em-sincronia" })
  })

  it("caixa realmente fechado no servidor + cliente aberto → fecha o cliente (segue bloqueando venda)", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: true, sessaoId: "sess-antiga-de-ontem" },
      server: null,
    })

    expect(decision).toEqual({ action: "close", reason: "servidor-sem-sessao-aberta" })
  })

  it("caixa fechado dos dois lados → nada a fazer", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: false, sessaoId: null },
      server: null,
    })

    expect(decision).toEqual({ action: "keep", reason: "sem-sessao-em-ambos" })
  })

  it("sessão de OUTRA loja nunca é adotada nem fecha o caixa local", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: true, sessaoId: "sess-da-loja-2" },
      server: { ...sessaoAberta, id: "sess-da-loja-1", storeId: "loja-1" },
    })

    expect(decision).toEqual({ action: "keep", reason: "sessao-de-outra-loja" })
  })

  it("resposta legada sem storeId é aceita para a loja consultada", () => {
    const decision = decideCaixaSessionSync({
      storeId: LOJA,
      local: { isOpen: true, sessaoId: null },
      server: { id: "sess-legada", saldoInicial: 0, abertaEm: "2026-08-02T11:00:00.000Z" },
    })

    expect(decision).toMatchObject({ action: "adopt", sessaoId: "sess-legada" })
  })
})

describe("isCaixaReferenceStale", () => {
  it("caixa aberto sem sessaoId é o estado degradado que bloqueia a finalização", () => {
    expect(isCaixaReferenceStale({ isOpen: true, sessaoId: null })).toBe(true)
    expect(isCaixaReferenceStale({ isOpen: true, sessaoId: "" })).toBe(true)
    expect(isCaixaReferenceStale({ isOpen: true, sessaoId: "  " })).toBe(true)
  })

  it("caixa aberto com sessão, ou caixa fechado, não é estado degradado", () => {
    expect(isCaixaReferenceStale({ isOpen: true, sessaoId: "sess-1" })).toBe(false)
    expect(isCaixaReferenceStale({ isOpen: false, sessaoId: null })).toBe(false)
  })
})
