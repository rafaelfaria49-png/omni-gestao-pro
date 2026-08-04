import { describe, expect, it } from "vitest"

import { CANONICAL_VERCEL_PROJECT_ID } from "@/lib/deploy/canonical-deployment"

import { SALE_WRITER_FLOW } from "./sale-identity-contracts"
import {
  evaluateSaleNumberingWriter,
  isServerSaleNumberingEnabled,
  SALE_NUMBERING_GATE_REASON,
  SALE_SERVER_NUMBERING_FLAG,
  SALE_SERVER_NUMBERING_FLAG_ENABLED_VALUE,
  type SaleNumberingGateEnv,
} from "./sale-numbering-runtime-gate"

/** Fixtures de projeto não canônico. Nenhum ID real de terceiro entra no repo. */
const LEGACY_PROJECT_ID = "prj_legacy_test_fixture"
const THIRD_PROJECT_ID = "prj_terceiro_test_fixture"

const CANONICAL: SaleNumberingGateEnv = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID,
}

describe("gate de runtime — matriz de ambiente", () => {
  it("local, development e preview usam v1 mesmo com a flag exata", () => {
    const casos: Array<[string, SaleNumberingGateEnv]> = [
      ["local", { SALE_SERVER_NUMBERING_ENABLED: "true" }],
      [
        "development",
        {
          VERCEL_ENV: "development",
          VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID,
          SALE_SERVER_NUMBERING_ENABLED: "true",
        },
      ],
      [
        "preview",
        {
          VERCEL_ENV: "preview",
          VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID,
          SALE_SERVER_NUMBERING_ENABLED: "true",
        },
      ],
    ]
    for (const [nome, env] of casos) {
      expect(evaluateSaleNumberingWriter(env).writer, nome).toBe(SALE_WRITER_FLOW.V1)
      expect(evaluateSaleNumberingWriter(env).reason, nome).toBe(
        SALE_NUMBERING_GATE_REASON.NON_PRODUCTION,
      )
    }
  })

  it("VERCEL_ENV vazio é tratado como local", () => {
    expect(evaluateSaleNumberingWriter({ VERCEL_ENV: "" })).toEqual({
      writer: SALE_WRITER_FLOW.V1,
      reason: SALE_NUMBERING_GATE_REASON.NON_PRODUCTION,
    })
  })

  it("ambiente desconhecido usa v1 e é classificado como desconhecido", () => {
    for (const ambiente of ["staging", "PRODUCTION", "production ", "prod"]) {
      const decision = evaluateSaleNumberingWriter({
        VERCEL_ENV: ambiente,
        VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID,
        SALE_SERVER_NUMBERING_ENABLED: "true",
      })
      expect(decision.writer, ambiente).toBe(SALE_WRITER_FLOW.V1)
      expect(decision.reason, ambiente).toBe(SALE_NUMBERING_GATE_REASON.UNKNOWN_ENVIRONMENT)
    }
  })
})

describe("gate de runtime — matriz de projeto", () => {
  it("production sem VERCEL_PROJECT_ID usa v1", () => {
    expect(
      evaluateSaleNumberingWriter({
        VERCEL_ENV: "production",
        SALE_SERVER_NUMBERING_ENABLED: "true",
      }),
    ).toEqual({
      writer: SALE_WRITER_FLOW.V1,
      reason: SALE_NUMBERING_GATE_REASON.MISSING_PROJECT_ID,
    })
    expect(
      evaluateSaleNumberingWriter({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: "",
        SALE_SERVER_NUMBERING_ENABLED: "true",
      }).reason,
    ).toBe(SALE_NUMBERING_GATE_REASON.MISSING_PROJECT_ID)
  })

  it("projeto legado continua v1 mesmo com a flag exata configurada por erro", () => {
    expect(
      evaluateSaleNumberingWriter({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: LEGACY_PROJECT_ID,
        SALE_SERVER_NUMBERING_ENABLED: SALE_SERVER_NUMBERING_FLAG_ENABLED_VALUE,
      }),
    ).toEqual({
      writer: SALE_WRITER_FLOW.V1,
      reason: SALE_NUMBERING_GATE_REASON.NON_CANONICAL_PROJECT,
    })
  })

  it("terceiro projeto continua v1", () => {
    expect(
      evaluateSaleNumberingWriter({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: THIRD_PROJECT_ID,
        SALE_SERVER_NUMBERING_ENABLED: "true",
      }).reason,
    ).toBe(SALE_NUMBERING_GATE_REASON.NON_CANONICAL_PROJECT)
  })

  it("o projeto é avaliado antes da flag — a flag nunca compensa projeto errado", () => {
    const decision = evaluateSaleNumberingWriter({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: LEGACY_PROJECT_ID,
      SALE_SERVER_NUMBERING_ENABLED: "true",
    })
    expect(decision.reason).not.toBe(SALE_NUMBERING_GATE_REASON.FLAG_ABSENT)
    expect(decision.reason).toBe(SALE_NUMBERING_GATE_REASON.NON_CANONICAL_PROJECT)
  })
})

describe("gate de runtime — matriz da flag", () => {
  it("canônico sem flag usa v1", () => {
    expect(evaluateSaleNumberingWriter(CANONICAL)).toEqual({
      writer: SALE_WRITER_FLOW.V1,
      reason: SALE_NUMBERING_GATE_REASON.FLAG_ABSENT,
    })
    expect(
      evaluateSaleNumberingWriter({ ...CANONICAL, SALE_SERVER_NUMBERING_ENABLED: "" }).reason,
    ).toBe(SALE_NUMBERING_GATE_REASON.FLAG_ABSENT)
  })

  it("canônico com a flag exata usa v2", () => {
    expect(
      evaluateSaleNumberingWriter({ ...CANONICAL, SALE_SERVER_NUMBERING_ENABLED: "true" }),
    ).toEqual({
      writer: SALE_WRITER_FLOW.V2,
      reason: SALE_NUMBERING_GATE_REASON.ENABLED,
    })
    expect(
      isServerSaleNumberingEnabled({ ...CANONICAL, SALE_SERVER_NUMBERING_ENABLED: "true" }),
    ).toBe(true)
  })

  it("TRUE, 1, yes, espaços e newline NÃO ativam v2", () => {
    for (const valor of [
      "TRUE",
      "True",
      "1",
      "yes",
      "on",
      "enabled",
      " true",
      "true ",
      " true ",
      "true\n",
      "\ntrue",
      "true\r\n",
      "\ttrue",
      "false",
      "0",
    ]) {
      const decision = evaluateSaleNumberingWriter({
        ...CANONICAL,
        SALE_SERVER_NUMBERING_ENABLED: valor,
      })
      expect(decision.writer, JSON.stringify(valor)).toBe(SALE_WRITER_FLOW.V1)
      expect(decision.reason, JSON.stringify(valor)).toBe(
        SALE_NUMBERING_GATE_REASON.FLAG_NOT_EXACTLY_TRUE,
      )
    }
  })

  it("o nome da flag é o contrato publicado", () => {
    expect(SALE_SERVER_NUMBERING_FLAG).toBe("SALE_SERVER_NUMBERING_ENABLED")
    expect(SALE_SERVER_NUMBERING_FLAG_ENABLED_VALUE).toBe("true")
  })
})

describe("gate de runtime — segurança da decisão", () => {
  const matriz: SaleNumberingGateEnv[] = [
    {},
    { VERCEL_ENV: "development" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "staging", SALE_SERVER_NUMBERING_ENABLED: "true" },
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "production", VERCEL_PROJECT_ID: LEGACY_PROJECT_ID },
    { VERCEL_ENV: "production", VERCEL_PROJECT_ID: THIRD_PROJECT_ID },
    { ...CANONICAL },
    { ...CANONICAL, SALE_SERVER_NUMBERING_ENABLED: "TRUE" },
    { ...CANONICAL, SALE_SERVER_NUMBERING_ENABLED: "true" },
  ]

  it("é função total: nunca lança e sempre devolve uma decisão válida", () => {
    for (const env of matriz) {
      const decision = evaluateSaleNumberingWriter(env)
      expect([SALE_WRITER_FLOW.V1, SALE_WRITER_FLOW.V2]).toContain(decision.writer)
      expect(Object.values(SALE_NUMBERING_GATE_REASON)).toContain(decision.reason)
    }
  })

  it("v2 só aparece na única combinação autorizada", () => {
    const habilitados = matriz.filter(
      (env) => evaluateSaleNumberingWriter(env).writer === SALE_WRITER_FLOW.V2,
    )
    expect(habilitados).toEqual([{ ...CANONICAL, SALE_SERVER_NUMBERING_ENABLED: "true" }])
  })

  it("a decisão não carrega project ID, valor de flag nem o environment completo", () => {
    const razoesConstantes: string[] = Object.values(SALE_NUMBERING_GATE_REASON)
    for (const env of matriz) {
      const decision = evaluateSaleNumberingWriter(env)
      const serialized = JSON.stringify(decision)
      // A decisão é só `{ writer, reason }`, e `reason` é sempre um literal fixo —
      // nenhum valor lido do ambiente pode atravessar para a saída.
      expect(Object.keys(decision).sort()).toEqual(["reason", "writer"])
      expect(razoesConstantes).toContain(decision.reason)
      expect(serialized).not.toContain(CANONICAL_VERCEL_PROJECT_ID)
      expect(serialized).not.toContain("prj_")
      expect(serialized).not.toContain(SALE_SERVER_NUMBERING_FLAG)
      expect(serialized).not.toContain("VERCEL")
    }
  })

  it("a decisão é imutável", () => {
    const decision = evaluateSaleNumberingWriter(CANONICAL)
    expect(Object.isFrozen(decision)).toBe(true)
  })
})
