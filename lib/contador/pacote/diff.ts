/**
 * Contador HUB · comparação entre duas versões do pacote oficial (GOAL 012).
 *
 * Responde "o que mudou entre a v1 e a v2?" usando SOMENTE os itens de manifesto já
 * persistidos (`ContadorPacoteItem`) — nenhum ZIP é baixado, descompactado ou lido.
 * O `sha256` de cada arquivo já é a prova de mudança de conteúdo; abrir os binários
 * seria custo de IO sem ganho de informação.
 *
 * PURO: recebe duas listas de itens e devolve o diff ordenado.
 */

/** Item de manifesto persistido (espelha `ContadorPacoteItem`). */
export type ItemManifesto = Readonly<{
  caminho: string
  bytes: number
  sha256: string
  fonte: string
}>

export type ArquivoAlterado = Readonly<{
  caminho: string
  fonte: string
  de: Readonly<{ bytes: number; sha256: string }>
  para: Readonly<{ bytes: number; sha256: string }>
  /** `para.bytes - de.bytes` — sinaliza crescimento/encolhimento do arquivo. */
  deltaBytes: number
}>

export type DiffManifestos = Readonly<{
  de: Readonly<{ versao: number; manifestoHash: string }>
  para: Readonly<{ versao: number; manifestoHash: string }>
  adicionados: readonly ItemManifesto[]
  removidos: readonly ItemManifesto[]
  alterados: readonly ArquivoAlterado[]
  /** Só os caminhos — o conteúdo inalterado não precisa ser repetido no DTO. */
  inalterados: readonly string[]
  resumo: Readonly<{
    adicionados: number
    removidos: number
    alterados: number
    inalterados: number
    /** `true` quando as duas versões têm exatamente o mesmo conteúdo. */
    identicos: boolean
  }>
}>

export type LadoDiff = Readonly<{
  versao: number
  manifestoHash: string
  itens: readonly ItemManifesto[]
}>

/**
 * Compara dois manifestos por `caminho`.
 *
 * Classificação: presente só em `para` = adicionado; só em `de` = removido;
 * nos dois com `sha256` diferente = alterado; `sha256` igual = inalterado
 * (bytes iguais por definição — o hash cobre o conteúdo inteiro).
 */
export function compararManifestos(de: LadoDiff, para: LadoDiff): DiffManifestos {
  const mapaDe = new Map(de.itens.map((i) => [i.caminho, i]))
  const mapaPara = new Map(para.itens.map((i) => [i.caminho, i]))

  const adicionados: ItemManifesto[] = []
  const removidos: ItemManifesto[] = []
  const alterados: ArquivoAlterado[] = []
  const inalterados: string[] = []

  for (const caminho of [...new Set([...mapaDe.keys(), ...mapaPara.keys()])].sort()) {
    const antes = mapaDe.get(caminho)
    const depois = mapaPara.get(caminho)

    if (!antes && depois) {
      adicionados.push(depois)
    } else if (antes && !depois) {
      removidos.push(antes)
    } else if (antes && depois) {
      if (antes.sha256 === depois.sha256) {
        inalterados.push(caminho)
      } else {
        alterados.push(
          Object.freeze({
            caminho,
            fonte: depois.fonte,
            de: Object.freeze({ bytes: antes.bytes, sha256: antes.sha256 }),
            para: Object.freeze({ bytes: depois.bytes, sha256: depois.sha256 }),
            deltaBytes: depois.bytes - antes.bytes,
          }),
        )
      }
    }
  }

  return Object.freeze({
    de: Object.freeze({ versao: de.versao, manifestoHash: de.manifestoHash }),
    para: Object.freeze({ versao: para.versao, manifestoHash: para.manifestoHash }),
    adicionados: Object.freeze(adicionados),
    removidos: Object.freeze(removidos),
    alterados: Object.freeze(alterados),
    inalterados: Object.freeze(inalterados),
    resumo: Object.freeze({
      adicionados: adicionados.length,
      removidos: removidos.length,
      alterados: alterados.length,
      inalterados: inalterados.length,
      identicos: adicionados.length === 0 && removidos.length === 0 && alterados.length === 0,
    }),
  })
}
