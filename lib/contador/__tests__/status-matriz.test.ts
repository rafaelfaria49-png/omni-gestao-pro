/**
 * GOAL CONTADOR-HUB-STATUS-COMENTARIOS-011 — matriz de transição, flag `vencido`
 * derivada e capacidades por papel. Tudo PURO: sem banco, sem rede, sem Supabase.
 */
import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import {
  STATUS_ITEM,
  TRANSICOES,
  TransicaoInvalidaError,
  StatusInvalidoError,
  acharTransicao,
  normalizarStatus,
  resolverTransicao,
  transicoesDisponiveis,
  type StatusItem,
} from "@/lib/contador/status/matriz"
import { diaLocal, estaVencido } from "@/lib/contador/status/vencido"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"

/** As 5 transições aprovadas na ADR-CONTADOR-005 — nada além disso pode passar. */
const PERMITIDAS: ReadonlySet<string> = new Set([
  "PENDENTE>ENVIADO",
  "ENVIADO>CONFERIDO",
  "CONFERIDO>RESOLVIDO",
  "ENVIADO>PENDENTE",
  "CONFERIDO>PENDENTE",
])

describe("status · matriz exaustiva (todas as combinações)", () => {
  const pares: [StatusItem, StatusItem][] = []
  for (const de of STATUS_ITEM) for (const para of STATUS_ITEM) pares.push([de, para])

  it("cobre as 16 combinações possíveis de 4 estados", () => {
    expect(pares).toHaveLength(16)
    expect(PERMITIDAS.size).toBe(5)
  })

  it.each(pares)("%s → %s obedece exatamente à matriz aprovada", (de, para) => {
    const chave = `${de}>${para}`
    if (PERMITIDAS.has(chave)) {
      expect(acharTransicao(de, para), chave).not.toBeNull()
      expect(() => resolverTransicao(de, para)).not.toThrow()
    } else {
      expect(acharTransicao(de, para), chave).toBeNull()
      expect(() => resolverTransicao(de, para)).toThrow(TransicaoInvalidaError)
    }
  })

  it("nenhuma transição de um estado para ele mesmo é permitida", () => {
    for (const s of STATUS_ITEM) {
      expect(acharTransicao(s, s), `${s}→${s}`).toBeNull()
    }
  })

  it("RESOLVIDO é terminal: nenhuma transição parte dele", () => {
    expect(TRANSICOES.filter((t) => t.de === "RESOLVIDO")).toHaveLength(0)
  })

  it("só a rejeição exige motivo; só conferir/resolver exigem papel elevado", () => {
    for (const t of TRANSICOES) {
      expect(t.exigeMotivo, `${t.de}→${t.para}`).toBe(t.acao === "rejeitar")
      expect(t.exigePapelElevado, `${t.de}→${t.para}`).toBe(
        t.acao === "conferir" || t.acao === "resolver",
      )
    }
  })

  it("o erro de transição inválida é TIPADO (code estável para o HTTP)", () => {
    try {
      resolverTransicao("PENDENTE", "RESOLVIDO")
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect(e).toBeInstanceOf(TransicaoInvalidaError)
      expect((e as TransicaoInvalidaError).code).toBe("TRANSICAO_INVALIDA")
    }
  })
})

describe("status · normalização de entrada", () => {
  it("aceita minúsculo/espaços e devolve a forma canônica", () => {
    expect(normalizarStatus(" conferido ")).toBe("CONFERIDO")
    expect(normalizarStatus("PENDENTE")).toBe("PENDENTE")
  })

  it.each([["vencido"], ["fechada"], [""], [null], [42], [{}]])(
    "recusa %s com StatusInvalidoError",
    (valor) => {
      expect(() => normalizarStatus(valor)).toThrow(StatusInvalidoError)
    },
  )

  it("`vencido` NÃO é um status persistível", () => {
    expect((STATUS_ITEM as readonly string[]).includes("VENCIDO")).toBe(false)
  })
})

describe("status · transições oferecidas por papel", () => {
  const elevado = { podeConferir: true }
  const basico = { podeConferir: false }

  it("papel elevado pode conferir a partir de ENVIADO; papel básico não", () => {
    expect(transicoesDisponiveis("ENVIADO", elevado).map((t) => t.para).sort()).toEqual([
      "CONFERIDO",
      "PENDENTE",
    ])
    expect(transicoesDisponiveis("ENVIADO", basico).map((t) => t.para)).toEqual(["PENDENTE"])
  })

  it("papel básico ainda pode enviar e rejeitar", () => {
    expect(transicoesDisponiveis("PENDENTE", basico).map((t) => t.para)).toEqual(["ENVIADO"])
    expect(transicoesDisponiveis("CONFERIDO", basico).map((t) => t.para)).toEqual(["PENDENTE"])
  })

  it("papel elevado a partir de CONFERIDO enxerga resolver e rejeitar", () => {
    expect(transicoesDisponiveis("CONFERIDO", elevado).map((t) => t.para).sort()).toEqual([
      "PENDENTE",
      "RESOLVIDO",
    ])
  })
})

/* ─────────────────────────── vencido (derivado) ─────────────────────────── */

/** Meio-dia UTC = 09:00 em São Paulo — evita ambiguidade de fronteira de dia. */
const HOJE = new Date("2026-07-28T12:00:00.000Z")
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe("status · `vencido` é derivado, nunca persistido", () => {
  it("antes do vencimento → não vencido", () => {
    expect(estaVencido({ status: "ENVIADO", vencimento: dia("2026-07-29") }, HOJE)).toBe(false)
    expect(estaVencido({ status: "PENDENTE", vencimento: dia("2026-08-10") }, HOJE)).toBe(false)
  })

  it("NO DIA do vencimento → ainda não vencido", () => {
    expect(estaVencido({ status: "PENDENTE", vencimento: dia("2026-07-28") }, HOJE)).toBe(false)
    expect(estaVencido({ status: "ENVIADO", vencimento: dia("2026-07-28") }, HOJE)).toBe(false)
  })

  it("depois do vencimento → vencido", () => {
    expect(estaVencido({ status: "PENDENTE", vencimento: dia("2026-07-27") }, HOJE)).toBe(true)
    expect(estaVencido({ status: "ENVIADO", vencimento: dia("2026-01-05") }, HOJE)).toBe(true)
    expect(estaVencido({ status: "CONFERIDO", vencimento: dia("2026-07-01") }, HOJE)).toBe(true)
  })

  it("RESOLVIDO nunca aparece como vencido, por mais antigo que seja", () => {
    expect(estaVencido({ status: "RESOLVIDO", vencimento: dia("2020-01-01") }, HOJE)).toBe(false)
    expect(estaVencido({ status: "resolvido", vencimento: dia("2020-01-01") }, HOJE)).toBe(false)
  })

  it("sem vencimento → nunca vencido", () => {
    expect(estaVencido({ status: "PENDENTE", vencimento: null }, HOJE)).toBe(false)
    expect(estaVencido({ status: "PENDENTE", vencimento: undefined }, HOJE)).toBe(false)
    expect(estaVencido({ status: "PENDENTE", vencimento: "data-lixo" }, HOJE)).toBe(false)
  })

  it("'hoje' é o dia civil de America/Sao_Paulo, não o do servidor em UTC", () => {
    // 2026-07-29T02:00Z ainda é 28/07 às 23:00 em São Paulo → nada vence ainda.
    const madrugadaUtc = new Date("2026-07-29T02:00:00.000Z")
    expect(diaLocal(madrugadaUtc)).toBe("2026-07-28")
    expect(estaVencido({ status: "PENDENTE", vencimento: dia("2026-07-28") }, madrugadaUtc)).toBe(false)
    // Já no dia 29 em São Paulo, o mesmo documento está vencido.
    expect(
      estaVencido({ status: "PENDENTE", vencimento: dia("2026-07-28") }, new Date("2026-07-29T12:00:00.000Z")),
    ).toBe(true)
  })

  it("o vencimento é lido como DATA (dia UTC gravado), não deslocado para o dia anterior", () => {
    // `new Date("2026-07-28")` do formulário grava meia-noite UTC; o dia digitado
    // pelo usuário é 28 — e é esse dia que vale, não 27 (21:00 em SP).
    const gravadoPeloFormulario = new Date("2026-07-28")
    expect(gravadoPeloFormulario.toISOString()).toBe("2026-07-28T00:00:00.000Z")
    expect(estaVencido({ status: "PENDENTE", vencimento: gravadoPeloFormulario }, HOJE)).toBe(false)
  })
})

/* ─────────────────────────── capacidades por papel ─────────────────────────── */

function sessao(over: Record<string, unknown>): Session {
  return { user: { id: "user-1", ...over }, expires: "2999-01-01" } as unknown as Session
}

describe("status · capacidades derivadas da sessão (nunca do cliente)", () => {
  it("admin e gerente (papel financeiro) podem conferir/resolver", () => {
    expect(resolverCapacidadesContador(sessao({ role: "ADMIN" })).podeConferir).toBe(true)
    expect(resolverCapacidadesContador(sessao({ role: "GERENTE" })).podeConferir).toBe(true)
  })

  it.each(["CAIXA", "TECNICO", "VENDEDOR", "OPERADOR"])(
    "%s não acessa o HUB e portanto não confere",
    (role) => {
      const c = resolverCapacidadesContador(sessao({ role }))
      expect(c.acessaHub).toBe(false)
      expect(c.podeConferir).toBe(false)
    },
  )

  it("sessão ausente → fail-closed", () => {
    expect(resolverCapacidadesContador(null)).toEqual({ acessaHub: false, podeConferir: false })
  })
})
