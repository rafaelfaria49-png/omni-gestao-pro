/**
 * Contador HUB · testes do checker de storage R2 (`setup-storage.mjs`).
 *
 * GOAL CONTADOR-POST-019-STORAGE-ROLLOUT-REMEDIATION · gap 2. O checker anterior
 * validava o Supabase legado enquanto o provider produtivo já era o R2 — um
 * `--check` verde não provava nada sobre o storage real.
 *
 * SEM REDE: o cliente S3 é INJETADO (`criarCliente`), então nenhum teste resolve
 * DNS, assina requisição nem fala com a Cloudflare. O módulo é importado por
 * especificador dinâmico — o `.mjs` não tem tipos, e a importação direta quebraria
 * o `npm run typecheck`.
 *
 * O último bloco é o que segura o checker no lugar: paridade de veredito com os
 * leitores REAIS de `lib/contador/documentos/config.ts`. Sem ele, o script e o
 * runtime poderiam divergir em silêncio (que foi exatamente o defeito corrigido).
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import {
  StorageConfigError,
  StorageProviderError,
  lerStorageProvider,
  lerStorageR2Config,
} from "@/lib/contador/documentos/config"

const MODULO = new URL("./setup-storage.mjs", import.meta.url).href

type Relatorio = {
  modo: string
  provider: string | null
  configCompleta: boolean
  bucket: string | null
  bucketExiste: boolean | null
  acessoLeitura: boolean | null
  acessoEscrita: string
  problemas: readonly string[]
}

type Checker = {
  ENV_KEYS_R2_CHECK: Record<string, string>
  PROVIDER_ESPERADO: string
  validarEnvR2: (env: Record<string, string | undefined>) => {
    ok: boolean
    provider: string | null
    bucket: string | null
    problemas: readonly string[]
  }
  sondarBucketR2: (
    env: Record<string, string | undefined>,
    criarCliente: (env: Record<string, string | undefined>) => unknown,
  ) => Promise<{ bucketExiste: boolean; acessoLeitura: boolean; motivo: string | null }>
  checarStorageR2: (
    env: Record<string, string | undefined>,
    criarCliente: (env: Record<string, string | undefined>) => unknown,
  ) => Promise<{ relatorio: Relatorio; exitCode: number }>
  lerModo: (argv: string[]) => { modo?: string; erro?: string }
}

// Especificador em variável: TS trata como `any` e o `.mjs` sem tipos não vaza para o typecheck.
// Carregado em `beforeAll` porque o `module` do tsconfig não admite top-level await.
let checker: Checker
beforeAll(async () => {
  checker = (await import(MODULO)) as Checker
})

const ACCOUNT_ID = "acc1234567890abcdef"
const ACCESS_KEY = "AKIA-fake-para-teste"
const SECRET = "segredo-que-nao-pode-vazar-123"
const BUCKET = "omni-contador-documentos-prod"

const ENV_OK = Object.freeze({
  CONTADOR_STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: ACCOUNT_ID,
  R2_ACCESS_KEY_ID: ACCESS_KEY,
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_BUCKET: BUCKET,
})

/** Erro no formato que o SDK devolve, para o checker classificar sem rede. */
function erroS3(name: string, httpStatusCode: number): Error {
  const e = new Error(name)
  e.name = name
  ;(e as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode }
  return e
}

/**
 * Cliente S3 falso. `send` decide pelo nome da classe do comando — não há rede,
 * não há credencial real, e o teste registra a sequência de comandos emitidos.
 */
function clienteFake(opts: { head?: Error; list?: Error }) {
  const comandos: string[] = []
  const send = vi.fn(async (cmd: object) => {
    const nome = cmd.constructor.name
    comandos.push(nome)
    if (nome === "HeadBucketCommand" && opts.head) throw opts.head
    if (nome === "ListObjectsV2Command" && opts.list) throw opts.list
    return {}
  })
  return { criarCliente: () => ({ send }), comandos, send }
}

describe("validarEnvR2 · fail-closed antes de qualquer rede", () => {
  it("env vazio reprova e nomeia as CINCO variáveis exigidas", () => {
    const r = checker.validarEnvR2({})
    expect(r.ok).toBe(false)
    expect(r.provider).toBeNull()
    expect(r.bucket).toBeNull()
    const texto = r.problemas.join(" | ")
    for (const nome of [
      "CONTADOR_STORAGE_PROVIDER",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ]) {
      expect(texto, `deveria citar ${nome}`).toContain(nome)
    }
  })

  it("env completo aprova e reporta provider=r2 e o nome do bucket", () => {
    const r = checker.validarEnvR2({ ...ENV_OK })
    expect(r.ok).toBe(true)
    expect(r.provider).toBe("r2")
    expect(r.bucket).toBe(BUCKET)
    expect(r.problemas).toEqual([])
  })

  it('provider "supabase" reprova SEM ecoar o valor declarado', () => {
    const r = checker.validarEnvR2({ ...ENV_OK, CONTADOR_STORAGE_PROVIDER: "supabase" })
    expect(r.ok).toBe(false)
    expect(r.provider).toBeNull()
    expect(r.problemas.join(" ")).not.toContain("supabase")
  })

  it("R2_ACCOUNT_ID com ponto/barra reprova (viraria outro host de endpoint)", () => {
    for (const ruim of ["evil.example.com", "acc/../x", "acc:8080", "acc id"]) {
      const r = checker.validarEnvR2({ ...ENV_OK, R2_ACCOUNT_ID: ruim })
      expect(r.ok, `deveria reprovar ${ruim}`).toBe(false)
      expect(r.problemas.join(" ")).not.toContain(ruim)
    }
  })

  it("valor só com espaços conta como ausente", () => {
    const r = checker.validarEnvR2({ ...ENV_OK, R2_SECRET_ACCESS_KEY: "   " })
    expect(r.ok).toBe(false)
    expect(r.problemas.join(" ")).toContain("R2_SECRET_ACCESS_KEY")
  })

  it("nenhuma variável Supabase substitui variável R2 faltante (sem fallback)", () => {
    const r = checker.validarEnvR2({
      CONTADOR_STORAGE_PROVIDER: "r2",
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "srk",
      SUPABASE_STORAGE_BUCKET: "contador-documentos",
    })
    expect(r.ok).toBe(false)
    expect(r.bucket).toBeNull()
  })
})

describe("checarStorageR2 · sonda o bucket sem escrever nada", () => {
  it("bucket existe + leitura autorizada → exit 0 e relatório verde", async () => {
    const fake = clienteFake({})
    const { relatorio, exitCode } = await checker.checarStorageR2({ ...ENV_OK }, fake.criarCliente)

    expect(exitCode).toBe(0)
    expect(relatorio).toEqual({
      modo: "check",
      provider: "r2",
      configCompleta: true,
      bucket: BUCKET,
      bucketExiste: true,
      acessoLeitura: true,
      acessoEscrita: "nao_testado",
      problemas: [],
    })
    // Só comandos de LEITURA — nenhum Put/Delete tocou o bucket.
    expect(fake.comandos).toEqual(["HeadBucketCommand", "ListObjectsV2Command"])
  })

  it("HeadBucket 404 → bucketExiste false, exit 1, motivo bucket_inexistente", async () => {
    const fake = clienteFake({ head: erroS3("NotFound", 404) })
    const { relatorio, exitCode } = await checker.checarStorageR2({ ...ENV_OK }, fake.criarCliente)

    expect(exitCode).toBe(1)
    expect(relatorio.bucketExiste).toBe(false)
    expect(relatorio.acessoLeitura).toBe(false)
    expect(relatorio.problemas).toEqual(["bucket_inexistente"])
    expect(fake.comandos).toEqual(["HeadBucketCommand"])
  })

  it("HeadBucket 403 → não afirma existência; motivo acesso_negado", async () => {
    const fake = clienteFake({ head: erroS3("AccessDenied", 403) })
    const { relatorio, exitCode } = await checker.checarStorageR2({ ...ENV_OK }, fake.criarCliente)

    expect(exitCode).toBe(1)
    expect(relatorio.bucketExiste).toBe(false)
    expect(relatorio.problemas).toEqual(["acesso_negado"])
  })

  it("bucket existe mas List negado → acessoLeitura false, exit 1", async () => {
    const fake = clienteFake({ list: erroS3("AccessDenied", 403) })
    const { relatorio, exitCode } = await checker.checarStorageR2({ ...ENV_OK }, fake.criarCliente)

    expect(exitCode).toBe(1)
    expect(relatorio.bucketExiste).toBe(true)
    expect(relatorio.acessoLeitura).toBe(false)
    expect(relatorio.problemas).toEqual(["leitura_negada"])
  })

  it("config incompleta → exit 2 e o cliente NUNCA é criado (não sai da máquina)", async () => {
    const criarCliente = vi.fn(() => ({ send: vi.fn() }))
    const { relatorio, exitCode } = await checker.checarStorageR2({}, criarCliente)

    expect(exitCode).toBe(2)
    expect(criarCliente).not.toHaveBeenCalled()
    expect(relatorio.configCompleta).toBe(false)
    expect(relatorio.bucketExiste).toBeNull()
    expect(relatorio.acessoLeitura).toBeNull()
  })

  it("acessoEscrita nunca é exercido — em nenhum dos desfechos", async () => {
    for (const opts of [{}, { head: erroS3("NotFound", 404) }, { list: erroS3("AccessDenied", 403) }]) {
      const fake = clienteFake(opts)
      const { relatorio } = await checker.checarStorageR2({ ...ENV_OK }, fake.criarCliente)
      expect(relatorio.acessoEscrita).toBe("nao_testado")
      expect(fake.comandos.join(",")).not.toMatch(/Put|Delete|Copy|Create/)
    }
  })
})

describe("checarStorageR2 · o relatório não carrega segredo", () => {
  it.each([
    ["verde", {} as { head?: Error; list?: Error }],
    ["bucket ausente", { head: erroS3("NotFound", 404) }],
    ["leitura negada", { list: erroS3("AccessDenied", 403) }],
  ])("%s → sem account id, access key, secret ou endpoint no JSON", async (_n, opts) => {
    const fake = clienteFake(opts)
    const { relatorio } = await checker.checarStorageR2({ ...ENV_OK }, fake.criarCliente)
    const json = JSON.stringify(relatorio)

    expect(json).not.toContain(ACCOUNT_ID)
    expect(json).not.toContain(ACCESS_KEY)
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain("r2.cloudflarestorage.com")
    // O NOME do bucket é o único identificador de infra permitido no relatório.
    expect(json).toContain(BUCKET)
  })

  it("config incompleta cita NOMES de variáveis, nunca valores", async () => {
    const { relatorio } = await checker.checarStorageR2(
      { CONTADOR_STORAGE_PROVIDER: "r2", R2_ACCOUNT_ID: ACCOUNT_ID, R2_ACCESS_KEY_ID: ACCESS_KEY },
      () => ({ send: vi.fn() }),
    )
    const json = JSON.stringify(relatorio)

    expect(json).toContain("R2_SECRET_ACCESS_KEY")
    expect(json).toContain("R2_BUCKET")
    expect(json).not.toContain(ACCOUNT_ID)
    expect(json).not.toContain(ACCESS_KEY)
  })
})

describe("lerModo · o checker não pode alterar infraestrutura", () => {
  it("--check é o modo válido", () => {
    expect(checker.lerModo(["--check"])).toEqual({ modo: "check" })
  })

  it("--apply é recusado com explicação (provisionamento é ato humano)", () => {
    const r = checker.lerModo(["--apply"])
    expect(r.modo).toBeUndefined()
    expect(r.erro).toContain("--apply")
  })

  it("sem modo é recusado", () => {
    expect(checker.lerModo([]).erro).toContain("--check")
  })
})

describe("paridade de veredito com lib/contador/documentos/config.ts", () => {
  /** `true` quando os leitores REAIS do runtime aceitam este ambiente. */
  function runtimeAceita(env: Record<string, string | undefined>): boolean {
    try {
      lerStorageProvider(env)
      lerStorageR2Config(env)
      return true
    } catch (e) {
      if (e instanceof StorageProviderError || e instanceof StorageConfigError) return false
      throw e
    }
  }

  const casos: ReadonlyArray<readonly [string, Record<string, string | undefined>]> = [
    ["completo", { ...ENV_OK }],
    ["vazio", {}],
    ["sem provider", { ...ENV_OK, CONTADOR_STORAGE_PROVIDER: undefined }],
    ["provider supabase", { ...ENV_OK, CONTADOR_STORAGE_PROVIDER: "supabase" }],
    ["provider s3", { ...ENV_OK, CONTADOR_STORAGE_PROVIDER: "s3" }],
    ["sem account id", { ...ENV_OK, R2_ACCOUNT_ID: undefined }],
    ["account id com ponto", { ...ENV_OK, R2_ACCOUNT_ID: "evil.example.com" }],
    ["sem access key", { ...ENV_OK, R2_ACCESS_KEY_ID: undefined }],
    ["sem secret", { ...ENV_OK, R2_SECRET_ACCESS_KEY: undefined }],
    ["sem bucket", { ...ENV_OK, R2_BUCKET: undefined }],
    ["só espaços no bucket", { ...ENV_OK, R2_BUCKET: "   " }],
    ["só Supabase configurado", {
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "srk",
      SUPABASE_STORAGE_BUCKET: "contador-documentos",
    }],
  ]

  it.each(casos)("%s → checker e runtime concordam", (_nome, env) => {
    expect(checker.validarEnvR2(env).ok).toBe(runtimeAceita(env))
  })
})
