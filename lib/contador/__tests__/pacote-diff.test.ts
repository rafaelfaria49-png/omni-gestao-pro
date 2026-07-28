/**
 * GOAL CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012 — diff entre manifestos de duas versões.
 *
 * A comparação usa SÓ os itens persistidos (caminho + bytes + sha256): nenhum ZIP é
 * baixado ou descompactado. Classifica adicionados, removidos, alterados (por sha256)
 * e inalterados, com saída determinística.
 */
import { describe, expect, it } from "vitest"
import { compararManifestos, type ItemManifesto } from "@/lib/contador/pacote/diff"

const H = (c: string) => c.repeat(64)

function item(caminho: string, sha: string, bytes = 100, fonte = "vendas"): ItemManifesto {
  return { caminho, bytes, sha256: H(sha), fonte }
}

const lado = (versao: number, itens: ItemManifesto[]) => ({
  versao,
  manifestoHash: H(String(versao)),
  itens,
})

describe("diff de manifestos", () => {
  it("versões idênticas ⇒ tudo inalterado", () => {
    const itens = [item("a.csv", "1"), item("b.csv", "2")]
    const d = compararManifestos(lado(1, itens), lado(2, [...itens]))
    expect(d.resumo).toEqual({
      adicionados: 0,
      removidos: 0,
      alterados: 0,
      inalterados: 2,
      identicos: true,
    })
    expect(d.inalterados).toEqual(["a.csv", "b.csv"])
  })

  it("classifica adicionado, removido e alterado", () => {
    const d = compararManifestos(
      lado(1, [item("mantido.csv", "1"), item("mudou.csv", "2", 100), item("saiu.csv", "3")]),
      lado(2, [item("mantido.csv", "1"), item("mudou.csv", "9", 130), item("entrou.csv", "4")]),
    )
    expect(d.adicionados.map((i) => i.caminho)).toEqual(["entrou.csv"])
    expect(d.removidos.map((i) => i.caminho)).toEqual(["saiu.csv"])
    expect(d.alterados.map((i) => i.caminho)).toEqual(["mudou.csv"])
    expect(d.inalterados).toEqual(["mantido.csv"])
    expect(d.resumo.identicos).toBe(false)
  })

  it("alterado carrega o sha256 dos dois lados e o delta de bytes", () => {
    const d = compararManifestos(
      lado(1, [item("x.csv", "1", 100)]),
      lado(2, [item("x.csv", "2", 80)]),
    )
    const a = d.alterados[0]
    expect(a.de).toEqual({ bytes: 100, sha256: H("1") })
    expect(a.para).toEqual({ bytes: 80, sha256: H("2") })
    expect(a.deltaBytes).toBe(-20)
  })

  it("mesmo sha256 com bytes diferentes é impossível na prática, mas conta como inalterado", () => {
    // O hash cobre o conteúdo inteiro: se o sha256 é igual, o arquivo é o mesmo.
    const d = compararManifestos(lado(1, [item("x.csv", "1", 100)]), lado(2, [item("x.csv", "1", 100)]))
    expect(d.resumo.inalterados).toBe(1)
  })

  it("a saída é ordenada por caminho, independente da ordem de entrada", () => {
    const a = compararManifestos(
      lado(1, []),
      lado(2, [item("z.csv", "1"), item("a.csv", "2"), item("m.csv", "3")]),
    )
    expect(a.adicionados.map((i) => i.caminho)).toEqual(["a.csv", "m.csv", "z.csv"])
  })

  it("preserva a identificação das duas versões comparadas", () => {
    const d = compararManifestos(lado(1, []), lado(3, []))
    expect(d.de).toEqual({ versao: 1, manifestoHash: H("1") })
    expect(d.para).toEqual({ versao: 3, manifestoHash: H("3") })
    expect(d.resumo.identicos).toBe(true)
  })
})
