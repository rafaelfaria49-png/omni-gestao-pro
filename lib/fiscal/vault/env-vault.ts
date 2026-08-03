/**
 * EnvVault — backend do piloto/homologação do cofre fiscal (BL-FISCAL-005 · ADR-0009 D2).
 *
 * Resolve as referências opacas para NOMES DE VARIÁVEIS DE AMBIENTE (secrets de plataforma,
 * cifrados em repouso pela Vercel), por loja. Espelha o precedente do WhatsApp
 * (`resolveStoreWhatsAppCredentials` / `tokenEnvKey`, ADR-0006):
 *  - `blobRef`     → env com o `.pfx` em base64.
 *  - `senhaRef`    → env com a senha do `.pfx`.
 *  - `cscTokenRef` → env com o token CSC.
 *
 * Garantias: NUNCA loga o segredo; NUNCA persiste no banco; FAIL-CLOSED (ref vazia/env vazia ⇒
 * `null` ⇒ caller não emite); multi-loja estrito (rejeita ref canônica de outra loja). A escrita
 * (rotação) é MANUAL no piloto (provisionamento de secret na plataforma) → `put*`/`revoke`
 * lançam `operacao_nao_suportada`, salvo quando um store de env mutável é injetado (testes/dev).
 */

import {
  FiscalVaultError,
  canonicalEnvRef,
  storeRefSuffix,
  type FiscalSecretMetadata,
  type FiscalSecretVault,
  type FiscalVaultAvailability,
  type VaultRefKind,
} from "./fiscal-secret-vault"

export type EnvLike = Record<string, string | undefined>

export type EnvVaultOptions = {
  /** Fonte das variáveis (default `process.env`). */
  env?: EnvLike
  /**
   * Permite gravar no `env` injetado (apenas testes/dev com store em memória). Default false:
   * no piloto o provisionamento é manual e `put*`/`revoke` ficam fail-closed (não fingem persistir).
   */
  allowWrite?: boolean
}

/** Nome do backend para metadados/disponibilidade (GOAL-016C). */
export const ENV_VAULT_BACKEND = "env-piloto"

function clean(v: string | null | undefined): string {
  return String(v ?? "").trim()
}

/** Infere o tipo de segredo a partir do prefixo canônico da env (sem ler o valor). */
function kindFromRef(ref: string): VaultRefKind | null {
  if (ref.startsWith("FISCAL_A1_PFX_B64_")) return "pfx"
  if (ref.startsWith("FISCAL_A1_SENHA_")) return "senha"
  if (ref.startsWith("FISCAL_CSC_TOKEN_")) return "csc"
  return null
}

export class EnvVault implements FiscalSecretVault {
  private readonly env: EnvLike
  private readonly allowWrite: boolean

  constructor(opts: EnvVaultOptions = {}) {
    this.env = opts.env ?? (process.env as EnvLike)
    this.allowWrite = opts.allowWrite ?? false
  }

  /** Multi-loja: uma ref canônica `FISCAL_*` só vale para a própria loja (sem cruzar lojas). */
  private assertScope(storeId: string, ref: string): void {
    if (ref.startsWith("FISCAL_")) {
      const suffix = storeRefSuffix(storeId)
      if (!suffix || !ref.endsWith(`_${suffix}`)) {
        throw new FiscalVaultError(
          "ref_fora_de_escopo",
          `Referência fiscal não pertence à loja informada (esperado sufixo _${suffix}).`,
          storeId,
        )
      }
    }
  }

  /** Resolve o valor cru de uma referência (env). `null` quando vazio (fail-closed). */
  private resolveRaw(storeId: string, ref: string | null | undefined): string | null {
    const id = clean(storeId)
    if (!id) throw new FiscalVaultError("store_invalida", "storeId é obrigatório para resolver segredo fiscal.")
    const name = clean(ref)
    if (!name) return null // ref ausente → fail-closed
    this.assertScope(id, name)
    const value = clean(this.env[name])
    return value || null // env vazia → fail-closed
  }

  async getCertificadoPfx(storeId: string, blobRef: string | null | undefined): Promise<Buffer | null> {
    const b64 = this.resolveRaw(storeId, blobRef)
    if (!b64) return null
    try {
      const buf = Buffer.from(b64, "base64")
      return buf.length > 0 ? buf : null
    } catch {
      // base64 corrompido → trata como ausente (sem expor conteúdo).
      return null
    }
  }

  /**
   * Senha do `.pfx` — NUNCA trimada: espaços nas bordas podem ser parte legítima da senha.
   * (A REFERÊNCIA continua normalizada; só o VALOR do segredo é preservado byte a byte.)
   */
  async getCertificadoSenha(storeId: string, senhaRef: string | null | undefined): Promise<string | null> {
    const id = clean(storeId)
    if (!id) throw new FiscalVaultError("store_invalida", "storeId é obrigatório para resolver segredo fiscal.")
    const name = clean(senhaRef)
    if (!name) return null
    this.assertScope(id, name)
    const value = this.env[name]
    return value === undefined || value === "" ? null : value
  }

  async getCscToken(storeId: string, cscTokenRef: string | null | undefined): Promise<string | null> {
    return this.resolveRaw(storeId, cscTokenRef)
  }

  /** Escrita — só com store de env mutável injetado (allowWrite). Senão, provisionamento manual. */
  private writeOrThrow(storeId: string, kind: VaultRefKind, value: string): string {
    const id = clean(storeId)
    if (!id) throw new FiscalVaultError("store_invalida", "storeId é obrigatório.")
    const ref = canonicalEnvRef(kind, id)
    if (!this.allowWrite) {
      throw new FiscalVaultError(
        "operacao_nao_suportada",
        `EnvVault (piloto) não persiste segredo em runtime — provisione a env "${ref}" na plataforma.`,
        id,
      )
    }
    this.env[ref] = value
    return ref
  }

  async putCertificadoPfx(storeId: string, pfx: Buffer, senha: string): Promise<{ blobRef: string; senhaRef: string }> {
    // Senha preservada byte a byte (sem trim) — apenas vazia é rejeitada, ANTES de gravar o blob.
    if (senha === "") throw new FiscalVaultError("ref_ausente", "Senha do certificado não pode ser vazia.", clean(storeId) || null)
    const blobRef = this.writeOrThrow(storeId, "pfx", pfx.toString("base64"))
    const senhaRef = this.writeOrThrow(storeId, "senha", senha)
    return { blobRef, senhaRef }
  }

  async putCscToken(storeId: string, token: string): Promise<{ cscTokenRef: string }> {
    const cscTokenRef = this.writeOrThrow(storeId, "csc", clean(token))
    return { cscTokenRef }
  }

  async revoke(storeId: string, ref: string): Promise<void> {
    const id = clean(storeId)
    if (!id) throw new FiscalVaultError("store_invalida", "storeId é obrigatório.")
    const name = clean(ref)
    if (!name) return
    this.assertScope(id, name)
    if (!this.allowWrite) {
      throw new FiscalVaultError(
        "operacao_nao_suportada",
        `EnvVault (piloto) não remove secret em runtime — remova a env "${name}" na plataforma.`,
        id,
      )
    }
    delete this.env[name]
  }

  /**
   * Descreve a referência SEM ler/devolver o segredo (GOAL-016C): só verifica existência.
   * `null` quando a ref está vazia. Multi-loja: ref canônica de outra loja ⇒ `ref_fora_de_escopo`.
   */
  async describeSecret(storeId: string, ref: string | null | undefined): Promise<FiscalSecretMetadata | null> {
    const id = clean(storeId)
    if (!id) throw new FiscalVaultError("store_invalida", "storeId é obrigatório.")
    const name = clean(ref)
    if (!name) return null
    this.assertScope(id, name)
    return {
      ref: name,
      storeId: id,
      configurada: clean(this.env[name]) !== "",
      kind: kindFromRef(name),
      backend: ENV_VAULT_BACKEND,
    }
  }

  /**
   * Disponibilidade do EnvVault (GOAL-016C): a LEITURA sempre está disponível (envs de plataforma);
   * escrita/rotação/revogação dependem de store mutável injetado (`allowWrite`) — no piloto real
   * o provisionamento é manual e essas capacidades ficam desligadas (fail-closed, sem fingir).
   */
  async checkAvailability(): Promise<FiscalVaultAvailability> {
    return {
      disponivel: true,
      backend: ENV_VAULT_BACKEND,
      capacidades: {
        leitura: true,
        escrita: this.allowWrite,
        rotacao: this.allowWrite,
        revogacao: this.allowWrite,
      },
      mensagem: this.allowWrite
        ? "EnvVault com store mutável (somente testes/dev)."
        : "EnvVault do piloto: leitura por env de plataforma; escrita/rotação/revogação por provisionamento manual.",
    }
  }

  /**
   * Rotação (GOAL-016C): grava a NOVA versão e devolve as referências. As referências anteriores
   * NÃO são revogadas aqui — quem chama troca o ponteiro (no banco) e só depois revoga a versão
   * anterior, mantendo a janela "nova válida antes de quebrar a antiga".
   *
   * Limite honesto do piloto: as refs do EnvVault são canônicas por loja (estáveis entre
   * versões), então a gravação substitui o valor da env no store mutável. Refs versionadas e
   * DEK por versão (ADR-0014) são do provider KMS de produção, não deste backend.
   */
  async rotateCertificadoPfx(storeId: string, pfx: Buffer, senha: string): Promise<{ blobRef: string; senhaRef: string }> {
    return this.putCertificadoPfx(storeId, pfx, senha)
  }
}

/** Conveniência: instancia o EnvVault sobre `process.env` (piloto, leitura fail-closed). */
export function createEnvVault(opts: EnvVaultOptions = {}): EnvVault {
  return new EnvVault(opts)
}
