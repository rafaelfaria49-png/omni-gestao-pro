#!/usr/bin/env node
/**
 * Baseline seguro do histórico Prisma em produção (execução ÚNICA por banco).
 *
 * Contexto: o banco de produção foi criado fora do fluxo `prisma migrate`
 * (não possui `_prisma_migrations`), então `migrate deploy` falha com P3005.
 *
 * Este script, SOMENTE quando VERCEL_ENV === 'production':
 *   1. Verifica se `_prisma_migrations` existe. Se sim → no-op (exit 0).
 *   2. Se não existe, faz a prova READ-ONLY de que o banco real é idêntico ao
 *      schema pré-0015 (commit canônico 950cc18, fechamento do GOAL 013):
 *        `prisma migrate diff --from-schema-datamodel <pre-0015> --to-schema-datasource <pre-0015>`
 *      Diff vazio ⇒ migrations 0001–0014 estão comprovadamente refletidas.
 *   3. QUALQUER divergência → imprime o resumo do diff (sem segredos) e aborta
 *      com exit 1 ANTES de qualquer escrita (fail-closed).
 *   4. Diff vazio → marca como aplicadas SOMENTE as migrations 0001–0014
 *      (lista explícita congelada abaixo) via `migrate resolve --applied`.
 *      A 0015 NUNCA é marcada — ela é aplicada de verdade pelo `migrate deploy`
 *      que o runner executa logo em seguida.
 *
 * Nunca imprime variáveis de ambiente ou segredos. Testes: vercel-build.test.mjs
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SCHEMA_PRE_0015 = path.join(REPO, 'prisma', 'schema-pre-0015.prisma');

/** Migrations existentes no commit canônico 950cc18 (pré-GOAL-014). Congelado. */
export const BASELINE_MIGRATIONS = Object.freeze([
  '0001_init_clientes_produtos',
  '0002_product_price_cost',
  '0003_aux_ledger_audit_whatsapp_app_settings',
  '0004_multistore_stores_units',
  '0005_multitenant_product_sku_composite',
  '0006_store_settings_contact_per_store',
  '0007_ledger_per_store_conta_receber_composite_localkey',
  '0008_fornecedores_contas_pagar',
  '0009_produto_barcode',
  '0010_whatsapp_phone_number',
  '0011_deposito_produto_deposito',
  '0012_inventario_assistido',
  '0013_fiscal_foundation',
  '0014_contador_hub_nucleo',
]);

function run(cmd, args, { capture = false } = {}) {
  const res = spawnSync(cmd, args, {
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
    cwd: REPO,
  });
  if (res.error) return { code: 1, out: '', err: String(res.error.message) };
  return {
    code: res.status ?? 1,
    out: res.stdout ? res.stdout.toString() : '',
    err: res.stderr ? res.stderr.toString() : '',
  };
}

/**
 * Interpreta a saída de `migrate diff --script`: vazia (sem DDL) significa
 * banco idêntico ao datamodel pré-0015. Comentários (`-- ...`), linhas em
 * branco e ponto-e-vírgula soltos não contam como divergência.
 */
export function diffContemDDL(scriptOutput) {
  const linhas = scriptOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && l !== ';' && !l.startsWith('--'));
  return linhas.length > 0;
}

/** Read-only: a tabela `_prisma_migrations` existe no banco? */
async function migrationsTableExiste() {
  const { PrismaClient } = await import(path.join(REPO, 'generated', 'prisma', 'index.js'));
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT to_regclass('public._prisma_migrations') AS t",
    );
    return rows?.[0]?.t != null;
  } finally {
    await prisma.$disconnect();
  }
}

export async function main() {
  if (process.env.VERCEL_ENV !== 'production') {
    console.log('[baseline] fora de production — nada a fazer.');
    return 0;
  }

  if (await migrationsTableExiste()) {
    console.log('[baseline] _prisma_migrations existe — baseline não necessário.');
    return 0;
  }

  console.log('[baseline] _prisma_migrations ausente — prova read-only contra o schema pré-0015 (950cc18)...');
  const diff = run('npx', [
    'prisma', 'migrate', 'diff',
    '--from-schema-datamodel', SCHEMA_PRE_0015,
    '--to-schema-datasource', SCHEMA_PRE_0015,
    '--script',
  ], { capture: true });

  if (diff.code !== 0) {
    console.error('[baseline] FALHA na verificação read-only (migrate diff exit ' + diff.code + '). Nenhuma escrita feita.');
    if (diff.err) console.error(diff.err.slice(0, 2000));
    return 1;
  }

  if (diffContemDDL(diff.out)) {
    console.error('[baseline] DRIFT REAL: o banco de produção diverge do schema pré-0015. Nenhuma escrita feita. Diff:');
    console.error(diff.out.slice(0, 4000));
    return 1;
  }

  console.log('[baseline] prova OK: banco idêntico ao pré-0015. Marcando 0001–0014 como aplicadas...');
  for (const nome of BASELINE_MIGRATIONS) {
    const r = run('npx', ['prisma', 'migrate', 'resolve', '--applied', nome]);
    if (r.code !== 0) {
      console.error(`[baseline] FALHA ao marcar ${nome} (exit ${r.code}). Abortando.`);
      return r.code;
    }
  }
  console.log('[baseline] baseline concluído: 0001–0014 registradas. 0015 segue pendente para o migrate deploy.');
  return 0;
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error('[baseline] erro inesperado: ' + (err?.message || String(err)));
      process.exit(1);
    },
  );
}
