#!/usr/bin/env node
/**
 * Contador HUB · checker do storage de documentos — provider produtivo **Cloudflare R2**.
 *
 * GOAL CONTADOR-POST-019-STORAGE-ROLLOUT-REMEDIATION · gap 2. Substitui o checker
 * anterior, que ainda validava o Supabase legado (`setup-storage-supabase-legacy.mjs`,
 * mantido intacto como caminho de rollback manual — GOAL 012B §7.1).
 *
 * Modo único: `--check`. Somente LEITURA — não cria, não corrige, não apaga nada.
 * Provisionar bucket e credencial R2 é ato de console/Cloudflare, feito por humano;
 * `--apply` foi deliberadamente removido para que este script não possa alterar
 * infraestrutura de produção.
 *
 * Sem fallback: nenhuma variável Supabase é lida aqui, em nenhuma circunstância.
 *
 * O que valida (nesta ordem, fail-closed):
 *   1. CONTADOR_STORAGE_PROVIDER === "r2"
 *   2. R2_ACCOUNT_ID presente e válido como rótulo de subdomínio
 *   3. R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET presentes
 *   4. endpoint S3-compatible do R2: bucket existe? leitura autorizada?
 *
 * O que reporta (SÓ não-sensível): provider, nome do bucket, bucketExiste,
 * acessoLeitura. NUNCA imprime account id, access key, secret, URL assinada nem
 * storageRef — variáveis aparecem apenas pelo NOME quando faltam.
 *
 * `acessoEscrita` NÃO é testado: provar escrita exigiria criar/apagar objeto real
 * no bucket produtivo. A escrita é exercida pelo fluxo de upload real, com o
 * `If-None-Match: *` do adapter; um probe aqui só acrescentaria risco.
 *
 * Uso:
 *   node --env-file=.env scripts/contador/setup-storage.mjs --check
 */
import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { HeadBucketCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

/** Nomes das variáveis — só os NOMES entram em relatório/erro, nunca os valores. */
export const ENV_KEYS_R2_CHECK = Object.freeze({
  provider: "CONTADOR_STORAGE_PROVIDER",
  accountId: "R2_ACCOUNT_ID",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
  bucket: "R2_BUCKET",
})

/** Único provider produtivo aceito. */
export const PROVIDER_ESPERADO = "r2"

/**
 * Mesmo alfabeto exigido por `lerStorageR2Config` (lib/contador/documentos/config.ts):
 * o account id é interpolado no HOST do endpoint, então um valor com ".", "/", "@",
 * ":" ou espaço apresentaria as credenciais R2 a outro destino.
 */
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]+$/

function texto(env, chave) {
  const v = env[chave]
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Valida o ambiente sem tocar a rede. Devolve `{ ok, provider, bucket, problemas }`
 * — `problemas` cita NOMES de variáveis, jamais valores.
 */
export function validarEnvR2(env = process.env) {
  const problemas = []

  const provider = texto(env, ENV_KEYS_R2_CHECK.provider).toLowerCase()
  if (provider === "") {
    problemas.push(`${ENV_KEYS_R2_CHECK.provider} ausente (defina "${PROVIDER_ESPERADO}")`)
  } else if (provider !== PROVIDER_ESPERADO) {
    // O valor declarado NÃO é ecoado: só o nome da variável e o valor exigido.
    problemas.push(`${ENV_KEYS_R2_CHECK.provider} não é "${PROVIDER_ESPERADO}"`)
  }

  const accountId = texto(env, ENV_KEYS_R2_CHECK.accountId)
  if (accountId === "") problemas.push(`${ENV_KEYS_R2_CHECK.accountId} ausente`)
  else if (!ACCOUNT_ID_RE.test(accountId)) {
    problemas.push(`${ENV_KEYS_R2_CHECK.accountId} inválido (só letras, números, "-" e "_")`)
  }

  if (texto(env, ENV_KEYS_R2_CHECK.accessKeyId) === "") {
    problemas.push(`${ENV_KEYS_R2_CHECK.accessKeyId} ausente`)
  }
  if (texto(env, ENV_KEYS_R2_CHECK.secretAccessKey) === "") {
    problemas.push(`${ENV_KEYS_R2_CHECK.secretAccessKey} ausente`)
  }

  const bucket = texto(env, ENV_KEYS_R2_CHECK.bucket)
  if (bucket === "") problemas.push(`${ENV_KEYS_R2_CHECK.bucket} ausente`)

  return Object.freeze({
    ok: problemas.length === 0,
    // `provider` só é reportado quando é exatamente o esperado — nunca ecoa lixo.
    provider: provider === PROVIDER_ESPERADO ? PROVIDER_ESPERADO : null,
    // O NOME do bucket é o único identificador de infra permitido no relatório.
    bucket: bucket === "" ? null : bucket,
    problemas: Object.freeze(problemas),
  })
}

/** Cria o cliente S3 apontado ao endpoint R2 da conta. Sem sessão persistida. */
function criarClienteR2(env) {
  const accountId = texto(env, ENV_KEYS_R2_CHECK.accountId)
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: texto(env, ENV_KEYS_R2_CHECK.accessKeyId),
      secretAccessKey: texto(env, ENV_KEYS_R2_CHECK.secretAccessKey),
    },
  })
}

/** 404 / NotFound / NoSuchBucket = bucket inexistente. */
function ehBucketInexistente(e) {
  const nome = e?.name ?? ""
  const status = e?.$metadata?.httpStatusCode
  return status === 404 || nome === "NotFound" || nome === "NoSuchBucket"
}

/**
 * Sonda o bucket: existência (`HeadBucket`) e leitura (`ListObjectsV2` com
 * `MaxKeys: 1`). Ambos são não-destrutivos. `criarCliente` é injetável para o teste
 * exercitar este caminho sem rede.
 *
 * Qualquer falha no `HeadBucket` — 404 ou credencial recusada — devolve o mesmo
 * `bucketExiste: false`: o checker não afirma existência que não conseguiu observar.
 * O `motivo` distingue os casos para o operador humano (nunca é segredo).
 */
export async function sondarBucketR2(env = process.env, criarCliente = criarClienteR2) {
  const bucket = texto(env, ENV_KEYS_R2_CHECK.bucket)
  const client = criarCliente(env)

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (e) {
    return Object.freeze({
      bucketExiste: false,
      acessoLeitura: false,
      motivo: ehBucketInexistente(e) ? "bucket_inexistente" : "acesso_negado",
    })
  }

  try {
    await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }))
  } catch {
    return Object.freeze({ bucketExiste: true, acessoLeitura: false, motivo: "leitura_negada" })
  }

  return Object.freeze({ bucketExiste: true, acessoLeitura: true, motivo: null })
}

/**
 * Executa o `--check` completo e devolve `{ relatorio, exitCode }`.
 *
 * `exitCode`: 0 = tudo verde · 2 = configuração incompleta (nem chega na rede) ·
 * 1 = configuração completa mas bucket ausente ou leitura negada.
 */
export async function checarStorageR2(env = process.env, criarCliente = criarClienteR2) {
  const cfg = validarEnvR2(env)

  if (!cfg.ok) {
    return Object.freeze({
      relatorio: Object.freeze({
        modo: "check",
        provider: cfg.provider,
        configCompleta: false,
        bucket: cfg.bucket,
        bucketExiste: null,
        acessoLeitura: null,
        acessoEscrita: "nao_testado",
        problemas: cfg.problemas,
      }),
      exitCode: 2,
    })
  }

  const sonda = await sondarBucketR2(env, criarCliente)
  const verde = sonda.bucketExiste && sonda.acessoLeitura

  return Object.freeze({
    relatorio: Object.freeze({
      modo: "check",
      provider: cfg.provider,
      configCompleta: true,
      bucket: cfg.bucket,
      bucketExiste: sonda.bucketExiste,
      acessoLeitura: sonda.acessoLeitura,
      acessoEscrita: "nao_testado",
      problemas: sonda.motivo ? Object.freeze([sonda.motivo]) : Object.freeze([]),
    }),
    exitCode: verde ? 0 : 1,
  })
}

/* ─────────────────────────────── CLI ─────────────────────────────── */

export function lerModo(argv) {
  if (argv.includes("--apply")) {
    return {
      erro:
        "--apply não existe no checker R2. Criar bucket e credencial é ato de provisionamento " +
        "Cloudflare (console/wrangler), feito por humano. Este script apenas verifica.",
    }
  }
  if (!argv.includes("--check")) return { erro: "Informe o modo: --check." }
  return { modo: "check" }
}

async function main() {
  const { erro } = lerModo(process.argv.slice(2))
  if (erro) {
    console.error(erro)
    process.exit(2)
  }

  const { relatorio, exitCode } = await checarStorageR2()
  console.log(JSON.stringify(relatorio, null, 2))
  // Linhas estáveis para o relatório de rollout (fáceis de grepar em log/CI).
  console.log(`R2_CONFIG_COMPLETE=${relatorio.configCompleta}`)
  console.log(`R2_CHECK_PASS=${exitCode === 0}`)
  if (exitCode !== 0) {
    console.error(
      relatorio.configCompleta
        ? "Bucket ausente ou leitura não autorizada com a credencial atual."
        : "Configuração externa pendente (valores nunca são impressos por este script).",
    )
  }
  process.exit(exitCode)
}

/** Só executa o CLI quando invocado diretamente — o teste importa as funções puras. */
const invocadoDireto =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (invocadoDireto) await main()
