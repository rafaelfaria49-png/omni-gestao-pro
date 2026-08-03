/**
 * Contrato do Cofre de Segredos Fiscais (BL-FISCAL-005 · ADR-0009).
 *
 * Port ÚNICO server-side para resolver os segredos fiscais a partir de REFERÊNCIAS OPACAS
 * (`blobRef`/`senhaRef`/`cscTokenRef`). Os callers (assinatura, CSC) NUNCA sabem qual backend
 * está por trás (EnvVault no piloto, KmsStorageVault em produção) e NUNCA acessam env/segredo
 * fora deste port. Regras inegociáveis (ADR-0009 §2):
 *  - ❌ segredo nunca em log/trace/cliente/IA · ❌ segredo nunca persistido em claro no banco.
 *  - ✅ fail-closed: referência ausente/órfã ⇒ resolve `null` ⇒ caller NÃO emite (sem fallback global).
 *  - ✅ multi-loja estrito: escopado por `storeId`, sem cruzar lojas, sem fallback `loja-1`.
 *
 * Esta camada é PURA quanto a I/O de banco: não importa Prisma/Next/fetch. O EnvVault lê apenas
 * variáveis de ambiente (secrets de plataforma). A auditoria `FiscalLog.secret.*` (ADR-0009 D7)
 * é responsabilidade da ORQUESTRAÇÃO que chama o vault (camada com Prisma — fase futura), não daqui.
 */

/** Tipo de referência guardada na `ConfiguracaoFiscalLoja`/`CertificadoDigital`. */
export type VaultRefKind = "pfx" | "senha" | "csc"

export type FiscalVaultErrorCode =
  | "ref_ausente" // referência vazia/nula
  | "segredo_ausente" // referência válida, mas o segredo não existe (env vazia / blob inexistente)
  | "store_invalida" // storeId ausente
  | "ref_fora_de_escopo" // a referência não pertence à loja (proteção multi-loja)
  | "operacao_nao_suportada" // escrita/rotação não suportada por este backend (ex.: EnvVault)
  | "backend_indisponivel"

/** Erro do cofre — mensagem NUNCA contém o segredo (só a referência/causa). */
export class FiscalVaultError extends Error {
  readonly code: FiscalVaultErrorCode
  readonly storeId: string | null
  constructor(code: FiscalVaultErrorCode, message: string, storeId: string | null = null) {
    super(message)
    this.name = "FiscalVaultError"
    this.code = code
    this.storeId = storeId
  }
}

/** Material do certificado A1 (PKCS#12) resolvido do cofre — bytes + senha (em memória, efêmero). */
export type FiscalCertificadoSegredo = {
  /** Bytes do `.pfx` (PKCS#12). NUNCA logar/serializar. */
  pfx: Buffer
  /** Senha do `.pfx`. NUNCA logar/serializar. */
  senha: string
}

/**
 * Metadados de uma referência de segredo (GOAL-016C). Descreve a referência SEM revelar o
 * segredo: serve para a UI/API dizer "configurado ou não" e para o ciclo de vida (rotação,
 * revogação) sem nunca serializar conteúdo.
 */
export type FiscalSecretMetadata = {
  /** A referência opaca consultada (não é o segredo). */
  ref: string
  storeId: string
  /** `true` quando a referência aponta para um segredo que existe no backend. */
  configurada: boolean
  /** Tipo inferido da referência (`null` quando não segue o padrão canônico). */
  kind: VaultRefKind | null
  /** Nome do backend que respondeu (ex.: `env-piloto`). */
  backend: string
}

/** Capacidades do backend de cofre — o que o ambiente atual suporta de fato. */
export type FiscalVaultCapabilities = {
  leitura: boolean
  escrita: boolean
  rotacao: boolean
  revogacao: boolean
}

/**
 * Disponibilidade do provider (GOAL-016C). `disponivel = false` ⇒ TUDO fail-closed: nenhuma
 * resolução, nenhuma assinatura, nenhuma emissão. A mensagem é sempre sanitizada (sem segredo).
 */
export type FiscalVaultAvailability = {
  disponivel: boolean
  backend: string
  capacidades: FiscalVaultCapabilities
  /** Explicação sanitizada (limitação do piloto, provider não configurado etc.). */
  mensagem: string
}

/**
 * Port do cofre (ADR-0009 D1). Leitura resolve segredo por referência (fail-closed = `null`).
 * Escrita/rotação são admin-only e auditadas pela orquestração; podem não ser suportadas por
 * um backend (EnvVault → provisionamento manual de env), caso em que lançam `operacao_nao_suportada`.
 */
export interface FiscalSecretVault {
  /** Resolve os bytes do `.pfx`. `null` se a referência está vazia ou o segredo não existe. */
  getCertificadoPfx(storeId: string, blobRef: string | null | undefined): Promise<Buffer | null>
  /** Resolve a senha do `.pfx`. `null` se ausente. */
  getCertificadoSenha(storeId: string, senhaRef: string | null | undefined): Promise<string | null>
  /** Resolve o token CSC. `null` se ausente. */
  getCscToken(storeId: string, cscTokenRef: string | null | undefined): Promise<string | null>

  /** Grava/rotaciona o `.pfx`+senha; devolve as NOVAS referências. Pode não ser suportado. */
  putCertificadoPfx(storeId: string, pfx: Buffer, senha: string): Promise<{ blobRef: string; senhaRef: string }>
  /** Grava/rotaciona o token CSC; devolve a nova referência. Pode não ser suportado. */
  putCscToken(storeId: string, token: string): Promise<{ cscTokenRef: string }>
  /** Revoga (destrói) o material apontado por uma referência. Pode não ser suportado. */
  revoke(storeId: string, ref: string): Promise<void>

  /**
   * Descreve os METADADOS de uma referência (GOAL-016C) — nunca o segredo. `null` quando a
   * referência está vazia/ausente. Lança `ref_fora_de_escopo` se a ref canônica for de outra loja.
   */
  describeSecret(storeId: string, ref: string | null | undefined): Promise<FiscalSecretMetadata | null>

  /**
   * Verifica a disponibilidade e as capacidades do backend (GOAL-016C). NUNCA lança por backend
   * indisponível — reporta `disponivel = false`, e o caller trata como fail-closed.
   */
  checkAvailability(): Promise<FiscalVaultAvailability>

  /**
   * Rotação do `.pfx`+senha (GOAL-016C · ADR-0014 §2.1): grava uma NOVA versão e devolve as
   * NOVAS referências. NUNCA toca as referências anteriores — a troca atômica do ponteiro e a
   * revogação da versão anterior são responsabilidade do caller, APÓS a nova versão confirmada.
   */
  rotateCertificadoPfx(storeId: string, pfx: Buffer, senha: string): Promise<{ blobRef: string; senhaRef: string }>
}

/** Sufixo canônico por loja (uppercase, só A-Z0-9_) — evita cruzar lojas nos nomes de env. */
export function storeRefSuffix(storeId: string): string {
  return String(storeId ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/** Nome canônico de env por (tipo, loja) — ADR-0009 D2 (ex.: `FISCAL_A1_PFX_B64_LOJA_1`). */
export function canonicalEnvRef(kind: VaultRefKind, storeId: string): string {
  const suffix = storeRefSuffix(storeId)
  switch (kind) {
    case "pfx":
      return `FISCAL_A1_PFX_B64_${suffix}`
    case "senha":
      return `FISCAL_A1_SENHA_${suffix}`
    case "csc":
      return `FISCAL_CSC_TOKEN_${suffix}`
  }
}
