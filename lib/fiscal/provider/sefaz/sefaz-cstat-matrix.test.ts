/**
 * GOAL-016D-B — matriz de `cStat`.
 *
 * A matriz é o ponto onde um erro custa mais caro em toda a frente fiscal: classificar mal um
 * código consome numeração, pede inutilização indevida ou dá por autorizado um documento que
 * ninguém leu. Estes testes fixam as três garantias que a tornam segura — **default incerto**,
 * **imutabilidade** e **consequência declarada por código** — e travam explicitamente as duas
 * heurísticas proibidas (faixa numérica e fallback para rejeição).
 */
import { describe, expect, it } from "vitest"
import {
  SEFAZ_CSTAT_MATRIX,
  SEFAZ_CSTAT_MATRIX_VERSION,
  lookupSefazCStat,
  type SefazCStatEntry,
} from "./sefaz-cstat-matrix"
import type { SefazServico } from "./sefaz-endpoint-catalog"

function entrada(cStat: string, servico: SefazServico = "NFeAutorizacao4"): SefazCStatEntry {
  const lookup = lookupSefazCStat(cStat, servico)
  if (!lookup.ok) throw new Error(`cStat ${cStat} recusado em ${servico}: ${lookup.reason}`)
  return lookup.entry
}

describe("matriz de cStat — cobertura obrigatória", () => {
  it("100 é AUTHORIZED e exige protocolo E XML autorizado", () => {
    const e = entrada("100")
    expect(e.outcome).toBe("AUTHORIZED")
    expect(e.exigeProtocolo).toBe(true)
    expect(e.exigeXmlAutorizado).toBe(true)
    expect(e.consequencias).toMatchObject({
      terminal: true,
      numeroConsumido: true,
      requiresInutilizacao: false,
      requiresConsultation: false,
    })
  })

  it("103 e 105 são PROCESSING e exigem recibo", () => {
    for (const cStat of ["103", "105"]) {
      const e = entrada(cStat)
      expect(e.outcome).toBe("PROCESSING")
      expect(e.exigeRecibo).toBe(true)
      expect(e.consequencias.requiresConsultation).toBe(true)
      // O lote já está com a SEFAZ: o número não volta para a fila de reaproveitamento.
      expect(e.consequencias.numeroConsumido).toBe(true)
      expect(e.consequencias.terminal).toBe(false)
    }
  })

  it("108 e 109 sinalizam serviço indisponível e mantêm consulta obrigatória", () => {
    for (const cStat of ["108", "109"]) {
      const e = entrada(cStat)
      expect(e.outcome).toBe("UNCERTAIN")
      expect(e.reason).toBe("SERVICE_UNAVAILABLE")
      expect(e.consequencias.requiresConsultation).toBe(true)
    }
  })

  it("110 é rejeição TERMINAL com número consumido — e SEM inutilização automática", () => {
    const e = entrada("110")
    expect(e.outcome).toBe("REJECTED")
    expect(e.consequencias.terminal).toBe(true)
    expect(e.consequencias.numeroConsumido).toBe(true)
    // Documento denegado já está registrado na SEFAZ; inutilizar seria ação destrutiva indevida.
    expect(e.consequencias.requiresInutilizacao).toBe(false)
    expect(e.consequencias.requiresConsultation).toBe(false)
  })

  it("204 exige consulta e nunca autoriza retransmissão por si", () => {
    const e = entrada("204")
    expect(e.outcome).toBe("UNCERTAIN")
    expect(e.reason).toBe("DUPLICATE_REQUIRES_CONSULTATION")
    expect(e.consequencias.requiresConsultation).toBe(true)
    expect(e.consequencias.numeroConsumido).toBe(true)
  })

  it("217 é NOT_FOUND SOMENTE em consulta", () => {
    const consulta = entrada("217", "NFeConsultaProtocolo4")
    expect(consulta.outcome).toBe("NOT_FOUND")
    expect(consulta.consequencias.numeroConsumido).toBe(false)

    for (const servico of ["NFeAutorizacao4", "NFeRetAutorizacao4"] as const) {
      const lookup = lookupSefazCStat("217", servico)
      expect(lookup.ok).toBe(false)
      if (!lookup.ok) expect(lookup.reason).toBe("SERVICE_MISMATCH")
    }
  })

  it("656 é THROTTLED e NÃO pede consulta — consultar é o que agrava o consumo indevido", () => {
    const e = entrada("656")
    expect(e.outcome).toBe("THROTTLED")
    expect(e.reason).toBe("CONSUMO_INDEVIDO")
    expect(e.consequencias.requiresConsultation).toBe(false)
    expect(e.consequencias.terminal).toBe(false)
    expect(e.consequencias.requiresInutilizacao).toBe(false)
  })

  it("104 instrui descida ao protocolo e não é desfecho de documento", () => {
    expect(entrada("104").outcome).toBe("LOTE_PROCESSADO")
  })

  it("101 é cancelamento homologado SOMENTE em NFeRecepcaoEvento4 — não é autorização de uso", () => {
    const e = entrada("101", "NFeRecepcaoEvento4")
    expect(e.outcome).toBe("AUTHORIZED")
    expect(e.reason).toBe("CANCELAMENTO_HOMOLOGADO")
    expect(e.exigeProtocolo).toBe(true)
    expect(e.exigeXmlAutorizado).toBe(false)
    expect(e.consequencias.terminal).toBe(true)
    for (const servico of ["NFeAutorizacao4", "NFeConsultaProtocolo4"] as const) {
      const lookup = lookupSefazCStat("101", servico)
      expect(lookup.ok).toBe(false)
      if (!lookup.ok) expect(lookup.reason).toBe("SERVICE_MISMATCH")
    }
  })

  it("135 é evento registrado SOMENTE em NFeRecepcaoEvento4", () => {
    const e = entrada("135", "NFeRecepcaoEvento4")
    expect(e.outcome).toBe("AUTHORIZED")
    expect(e.reason).toBe("EVENTO_REGISTRADO")
    expect(lookupSefazCStat("135", "NFeAutorizacao4").ok).toBe(false)
  })
})

describe("matriz de cStat — default fail-closed", () => {
  it("qualquer código fora da matriz é UNKNOWN, nunca rejeição", () => {
    const foraDaMatriz = [
      "000",
      "102",
      "106",
      "107",
      "111",
      "199",
      "203",
      "205",
      "216",
      "218",
      "301",
      "409",
      "539",
      "655",
      "657",
      "999",
    ]
    for (const cStat of foraDaMatriz) {
      const lookup = lookupSefazCStat(cStat, "NFeAutorizacao4")
      expect(lookup.ok, `cStat ${cStat} não deveria constar da matriz`).toBe(false)
      if (!lookup.ok) expect(lookup.reason).toBe("UNKNOWN")
    }
  })

  it("não classifica por FAIXA numérica: vizinhos de um código coberto não herdam nada", () => {
    // `110` é REJECTED; `111` e `109` têm significados próprios e nada em comum com ele.
    expect(entrada("110").outcome).toBe("REJECTED")
    expect(lookupSefazCStat("111", "NFeAutorizacao4").ok).toBe(false)
    expect(entrada("109").outcome).toBe("UNCERTAIN")
    // `656` é THROTTLED; `655`/`657` não são nada.
    expect(entrada("656").outcome).toBe("THROTTLED")
    expect(lookupSefazCStat("655", "NFeAutorizacao4").ok).toBe(false)
    expect(lookupSefazCStat("657", "NFeAutorizacao4").ok).toBe(false)
  })

  it("nenhuma entrada exige inutilização — nenhum código herda ação destrutiva", () => {
    const destrutivas = SEFAZ_CSTAT_MATRIX.filter((e) => e.consequencias.requiresInutilizacao)
    expect(destrutivas.map((e) => e.cStat)).toEqual([])
  })

  it("REJECTED existe apenas para códigos explicitamente marcados", () => {
    expect(SEFAZ_CSTAT_MATRIX.filter((e) => e.outcome === "REJECTED").map((e) => e.cStat)).toEqual([
      "110",
    ])
  })
})

describe("matriz de cStat — imutabilidade e versionamento", () => {
  it("expõe uma versão estável", () => {
    expect(SEFAZ_CSTAT_MATRIX_VERSION).toBe("018.1")
  })

  it("entradas, listas de serviço e consequências estão congeladas", () => {
    expect(Object.isFrozen(SEFAZ_CSTAT_MATRIX)).toBe(true)
    for (const e of SEFAZ_CSTAT_MATRIX) {
      expect(Object.isFrozen(e), `entrada ${e.cStat} não congelada`).toBe(true)
      expect(Object.isFrozen(e.consequencias), `consequências de ${e.cStat}`).toBe(true)
      expect(Object.isFrozen(e.servicos), `serviços de ${e.cStat}`).toBe(true)
    }
  })

  it("mutação em runtime não altera a matriz", () => {
    const alvo = entrada("110")
    expect(() => {
      ;(alvo.consequencias as { requiresInutilizacao: boolean }).requiresInutilizacao = true
    }).toThrow()
    expect(entrada("110").consequencias.requiresInutilizacao).toBe(false)
  })

  it("não há códigos duplicados", () => {
    const codigos = SEFAZ_CSTAT_MATRIX.map((e) => e.cStat)
    expect(new Set(codigos).size).toBe(codigos.length)
  })

  it("todo código coberto declara pelo menos um serviço", () => {
    for (const e of SEFAZ_CSTAT_MATRIX) {
      expect(e.servicos.length, `cStat ${e.cStat} sem serviço`).toBeGreaterThan(0)
    }
  })
})
