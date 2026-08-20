#!/usr/bin/env node
/**
 * Contador HUB · setup do bucket Supabase — **LEGADO / ROLLBACK MANUAL**.
 *
 * @deprecated O provider produtivo é Cloudflare R2 (GOAL 012C). Este script existe
 * só para manter executável o caminho de rollback documentado em GOAL 012B §7.1,
 * espelhando o adapter `lib/contador/documentos/storage-supabase.ts`.
 *
 * NÃO é o checker oficial. O checker do provider produtivo é
 * `scripts/contador/setup-storage.mjs --check` (R2). Os dois NUNCA se misturam:
 * este script não lê variável R2 e o checker R2 não lê variável Supabase — não há
 * fallback de um provider para o outro em nenhuma direção.
 *
 * Modos:
 *   --check  valida variáveis, verifica o bucket e informa apenas dados NÃO sensíveis.
 *            Não altera nada.
 *   --apply  cria/corrige EXCLUSIVAMENTE o bucket `contador-documentos` para o estado
 *            aprovado (privado, 25 MB, MIMEs permitidos).
 *
 * Nunca cria bucket em build/runtime/inicialização da app — só quando este script é
 * executado à mão. Nunca imprime secrets (só nomes de variáveis).
 *
 * Uso:
 *   node --env-file=.env scripts/contador/setup-storage-supabase-legacy.mjs --check
 *   node --env-file=.env scripts/contador/setup-storage-supabase-legacy.mjs --apply
 */
import { createClient } from "@supabase/supabase-js"

const BUCKET_ESPERADO = process.env.SUPABASE_STORAGE_BUCKET || "contador-documentos"
const FILE_SIZE_LIMIT = 25 * 1024 * 1024 // 25 MB
const ALLOWED_MIME = [
  "application/pdf",
  "application/xml",
  "text/xml",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "application/x-ofx",
  "application/ofx",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
]

function lerModo(argv) {
  const apply = argv.includes("--apply")
  const check = argv.includes("--check")
  if (apply && check) return { erro: "Use apenas um modo: --check OU --apply." }
  if (!apply && !check) return { erro: "Informe o modo: --check ou --apply." }
  return { modo: apply ? "apply" : "check" }
}

function variaveisFaltando() {
  const faltando = []
  if (!process.env.SUPABASE_URL?.trim()) faltando.push("SUPABASE_URL")
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) faltando.push("SUPABASE_SERVICE_ROLE_KEY")
  if (!process.env.SUPABASE_STORAGE_BUCKET?.trim()) faltando.push("SUPABASE_STORAGE_BUCKET")
  return faltando
}

function resumoBucket(b) {
  if (!b) return null
  return {
    name: b.name,
    public: b.public,
    fileSizeLimit: b.file_size_limit ?? null,
    allowedMimeTypes: Array.isArray(b.allowed_mime_types) ? b.allowed_mime_types.length : null,
  }
}

async function main() {
  const { modo, erro } = lerModo(process.argv.slice(2))
  if (erro) {
    console.error(erro)
    process.exit(2)
  }

  const faltando = variaveisFaltando()
  if (faltando.length > 0) {
    console.error(
      `Configuração externa pendente. Defina no ambiente: ${faltando.join(", ")} ` +
        "(valores nunca são impressos por este script).",
    )
    process.exit(2)
  }

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: bucket, error: getErr } = await client.storage.getBucket(BUCKET_ESPERADO)

  if (modo === "check") {
    if (getErr || !bucket) {
      console.log(JSON.stringify({ modo, bucket: BUCKET_ESPERADO, existe: false }, null, 2))
      console.log("Bucket ausente. Rode com --apply para criá-lo com o estado aprovado.")
      process.exit(0)
    }
    console.log(JSON.stringify({ modo, existe: true, ...resumoBucket(bucket) }, null, 2))
    if (bucket.public) {
      console.error("ATENÇÃO: bucket está PÚBLICO. Rode --apply para torná-lo privado.")
      process.exit(1)
    }
    process.exit(0)
  }

  // modo apply
  const opcoes = {
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: ALLOWED_MIME,
  }

  if (getErr || !bucket) {
    const { error } = await client.storage.createBucket(BUCKET_ESPERADO, opcoes)
    if (error) {
      console.error(`Falha ao criar o bucket ${BUCKET_ESPERADO}: ${error.message}`)
      process.exit(1)
    }
    console.log(`Bucket ${BUCKET_ESPERADO} criado (privado, 25 MB, MIMEs permitidos).`)
    process.exit(0)
  }

  const { error } = await client.storage.updateBucket(BUCKET_ESPERADO, opcoes)
  if (error) {
    console.error(`Falha ao corrigir o bucket ${BUCKET_ESPERADO}: ${error.message}`)
    process.exit(1)
  }
  console.log(`Bucket ${BUCKET_ESPERADO} corrigido para o estado aprovado (privado, 25 MB, MIMEs permitidos).`)
  process.exit(0)
}

main().catch((e) => {
  console.error(`Erro inesperado: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
