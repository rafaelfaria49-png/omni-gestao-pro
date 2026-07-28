/**
 * Contador HUB · Pacote do Contador (MVP) — contratos de dados (GOAL 008 · 008B).
 *
 * O pacote é gerado SOB DEMANDA e nunca persiste:
 * - sem storage, sem upload, sem registro em banco, sem snapshot, sem versão persistida;
 * - reflete os dados vivos da competência no instante do download;
 * - não é fechamento oficial nem apuração fiscal/contábil;
 * - não inclui XML nesta fase (fonte fiscal atrás de CONTADOR_FISCAL_READER).
 *
 * 008B: estrutura de pastas fixa, CSVs detalhados por fonte (linha a linha, sem PII),
 * manifesto canônico `omni.contador.pacote.manifest/v1` e estados por fonte.
 * Este módulo é puro (só tipos).
 */

/** Categoria de cada arquivo dentro do pacote (usada em índice e manifesto). */
export type CategoriaArquivoPacote =
  | "csv"
  | "resumo"
  | "indice"
  | "pendencias"
  | "manifesto"
  | "placeholder"

/** Estado honesto de uma fonte de dados no pacote. */
export type EstadoFonte = "real" | "parcial" | "indisponivel"

/**
 * Resultado de uma fonte carregada: linhas saneadas + contagem + estado.
 * `rejeitados` conta linhas descartadas por dado inválido (cobertura parcial).
 */
export type FonteResultado<T> = Readonly<{
  linhas: readonly T[]
  registros: number
  estado: EstadoFonte
  observacao?: string
  rejeitados?: number
}>

/**
 * Um arquivo do pacote, sempre textual (UTF-8) nesta fase — CSV, Markdown ou JSON.
 * MVP não embute binários (sem XML, sem PDF, sem anexos).
 */
export type ArquivoPacote = Readonly<{
  /** Caminho relativo dentro do ZIP (ex.: "01-VENDAS/vendas.csv"). Sem barra inicial. */
  caminho: string
  /** Conteúdo textual UTF-8. */
  conteudo: string
  /** Descrição curta para índice/manifesto. */
  descricao: string
  categoria: CategoriaArquivoPacote
  /** Fonte lógica que originou o arquivo (ex.: "vendas", "leia-me"). */
  fonte: string
  /** Registros representados (quando o arquivo é uma tabela de dados). */
  registros?: number
}>

/** Entrada de integridade de um arquivo no manifesto v1. */
export type ArquivoManifestoV1 = Readonly<{
  caminho: string
  bytes: number
  sha256: string
  fonte: string
  registros?: number
}>

/** Descrição de uma fonte no manifesto v1. */
export type FonteManifestoV1 = Readonly<{
  nome: string
  origem: string
  filtro: string
  registros: number
  estado: EstadoFonte
  observacao?: string
}>

/**
 * Manifesto canônico v1 (`manifest.json`).
 *
 * `competencia.storeId` é o ÚNICO lugar do pacote onde o storeId pode aparecer.
 * `geradoPor.id` é um identificador interno mínimo do escopo (nunca e-mail/nome).
 * É a raiz de integridade: lista hash/bytes de TODOS os demais arquivos (não a si mesmo).
 */
export type ManifestoPacoteContadorV1 = Readonly<{
  schema: "omni.contador.pacote.manifest/v1"
  pacoteVersao: 1
  competencia: Readonly<{
    storeId: string
    ano: number
    mes: number
    timezone: "America/Sao_Paulo"
    periodoUtc: Readonly<{
      inicio: string
      fimExclusivo: string
    }>
  }>
  geradoEm: string
  geradoPor: Readonly<{
    tipo: "interno"
    id: string
  }>
  fontes: readonly FonteManifestoV1[]
  arquivos: readonly ArquivoManifestoV1[]
  pendencias: readonly string[]
  itensNaoDisponiveis: readonly string[]
  avisos: readonly string[]
}>

/** Conteúdo montado do pacote antes da compactação (puro, testável sem ZIP/DB). */
export type ConteudoPacote = Readonly<{
  /** Nome sugerido do arquivo .zip (sem diretório), com storeId saneado. */
  nomeArquivo: string
  /** Todos os arquivos, na ordem de escrita (inclui INDICE, pendências e manifest.json). */
  arquivos: readonly ArquivoPacote[]
  manifesto: ManifestoPacoteContadorV1
}>

/** Pacote pronto para resposta HTTP. */
export type PacoteContador = Readonly<{
  nomeArquivo: string
  /** Bytes do ZIP. */
  bytes: Uint8Array
  manifesto: ManifestoPacoteContadorV1
  /**
   * GOAL 012 (integração): agregado e checklist da MESMA carga que gerou o pacote.
   * Expostos para o fechamento montar o snapshot sem repetir as consultas — o pacote
   * oficial e o snapshot precisam descrever exatamente o mesmo instante.
   */
  dados: import("@/lib/contador/readers/tipos").ContadorDadosReais
  checklist: import("@/lib/contador/fechamento/tipos").ChecklistFechamento
  /** Métricas para log estruturado (nunca vão ao ZIP). */
  metricas: Readonly<{
    bytesZip: number
    bytesDescompactados: number
    arquivos: number
    contagens: Readonly<Record<string, number>>
    fontesParciais: readonly string[]
    fontesIndisponiveis: readonly string[]
  }>
}>
