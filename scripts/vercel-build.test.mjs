/**
 * Testes permanentes do runner e do baseline. Nenhum comando real é executado:
 * `run` é sempre injetado nos cenários de build.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSteps,
  main,
  MIGRATION_LOG,
  STEP_BASELINE,
  STEP_MIGRATE,
  STEP_GENERATE,
  STEP_BUILD,
} from './vercel-build.mjs';
import { CANONICAL_VERCEL_PROJECT_ID } from './migration-authority-guard.mjs';
import { BASELINE_MIGRATIONS, diffContemDDL } from './prisma-baseline.mjs';

const label = ([cmd, args]) => `${cmd} ${args.join(' ')}`;
const AUTHORIZED_ENV = Object.freeze({
  VERCEL_ENV: 'production',
  VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID,
  MIGRATION_AUTHORITY_ENABLED: 'true',
});

test('local, preview e development não chamam baseline nem migrate', () => {
  for (const env of [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }]) {
    assert.deepEqual(buildSteps(env).map(label), [label(STEP_GENERATE), label(STEP_BUILD)]);
  }
});

test('production canônico autorizado roda baseline e migrate antes do build', () => {
  assert.deepEqual(buildSteps(AUTHORIZED_ENV).map(label), [
    label(STEP_BASELINE),
    label(STEP_MIGRATE),
    label(STEP_GENERATE),
    label(STEP_BUILD),
  ]);
});

test('falha do baseline interrompe o build', () => {
  const calls = [];
  const code = main({
    env: AUTHORIZED_ENV,
    run: (step) => {
      calls.push(label(step));
      return calls.length === 1 ? 1 : 0;
    },
    log: () => {},
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, [label(STEP_BASELINE)]);
});

test('Prisma com exit zero executa exatamente uma vez e registra sucesso', () => {
  const calls = [];
  const logs = [];
  const code = main({
    env: AUTHORIZED_ENV,
    run: (step) => (calls.push(label(step)), 0),
    log: (message) => logs.push(message),
  });
  assert.equal(code, 0);
  assert.equal(calls.filter((step) => step === label(STEP_MIGRATE)).length, 1);
  assert.deepEqual(logs, [MIGRATION_LOG.RUN, MIGRATION_LOG.SUCCEEDED]);
});

test('Prisma com erro registra falha e não continua o build', () => {
  const calls = [];
  const logs = [];
  const code = main({
    env: AUTHORIZED_ENV,
    run: (step) => {
      calls.push(label(step));
      return step === STEP_MIGRATE ? 9 : 0;
    },
    log: (message) => logs.push(message),
  });
  assert.equal(code, 9);
  assert.deepEqual(calls, [label(STEP_BASELINE), label(STEP_MIGRATE)]);
  assert.deepEqual(logs, [MIGRATION_LOG.RUN, MIGRATION_LOG.FAILED]);
});

test('exceção no processo de migration falha fechada', () => {
  const logs = [];
  const code = main({
    env: AUTHORIZED_ENV,
    run: (step) => {
      if (step === STEP_MIGRATE) throw new Error('process exception');
      return 0;
    },
    log: (message) => logs.push(message),
  });
  assert.equal(code, 1);
  assert.deepEqual(logs, [MIGRATION_LOG.RUN, MIGRATION_LOG.FAILED]);
});

test('falha do generate propaga exit code após migration bem-sucedida', () => {
  const calls = [];
  const code = main({
    env: AUTHORIZED_ENV,
    run: (step) => {
      calls.push(label(step));
      return step === STEP_GENERATE ? 7 : 0;
    },
    log: () => {},
  });
  assert.equal(code, 7);
  assert.deepEqual(calls, [label(STEP_BASELINE), label(STEP_MIGRATE), label(STEP_GENERATE)]);
});

test('todos os estados skipped executam zero baseline/migrate', () => {
  const skippedEnvironments = [
    {},
    { VERCEL_ENV: 'development' },
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'production', VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID },
    {
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: 'prj_legacy_test_fixture',
      MIGRATION_AUTHORITY_ENABLED: 'true',
    },
  ];
  for (const env of skippedEnvironments) {
    const calls = [];
    assert.equal(main({ env, run: (step) => (calls.push(label(step)), 0), log: () => {} }), 0);
    assert.deepEqual(calls, [label(STEP_GENERATE), label(STEP_BUILD)]);
  }
});

test('build continua no legado mesmo com flag configurada', () => {
  const calls = [];
  const logs = [];
  const code = main({
    env: {
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: 'prj_legacy_test_fixture',
      MIGRATION_AUTHORITY_ENABLED: 'true',
    },
    run: (step) => (calls.push(label(step)), 0),
    log: (message) => logs.push(message),
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [label(STEP_GENERATE), label(STEP_BUILD)]);
  assert.deepEqual(logs, [MIGRATION_LOG.SKIPPED]);
});

test('estado bloqueado falha antes de qualquer processo', () => {
  const calls = [];
  const logs = [];
  const code = main({
    env: { VERCEL_ENV: 'production', MIGRATION_AUTHORITY_ENABLED: 'true' },
    run: (step) => (calls.push(label(step)), 0),
    log: (message) => logs.push(message),
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(logs, [MIGRATION_LOG.BLOCKED]);
});

test('baseline: lista congelada cobre 0001–0014 e nunca inclui a 0015', () => {
  assert.equal(BASELINE_MIGRATIONS.length, 14);
  assert.equal(BASELINE_MIGRATIONS[0], '0001_init_clientes_produtos');
  assert.equal(BASELINE_MIGRATIONS[13], '0014_contador_hub_nucleo');
  assert.ok(BASELINE_MIGRATIONS.every((migration) => !migration.startsWith('0015')));
});

test('baseline: parser de diff distingue saída vazia de DDL', () => {
  assert.equal(diffContemDDL(''), false);
  assert.equal(diffContemDDL('\n-- No differences found\n\n'), false);
  assert.equal(diffContemDDL(';\n-- comentário\n'), false);
  assert.equal(diffContemDDL('CREATE TABLE "x" ("id" TEXT);'), true);
  assert.equal(diffContemDDL('-- comentário\nALTER TABLE "stores" ADD COLUMN "y" TEXT;'), true);
  assert.equal(diffContemDDL('DROP TABLE "fantasma";'), true);
});

test('nenhum secret ou project ID é impresso pelo runner', () => {
  const environment = {
    ...AUTHORIZED_ENV,
    DATABASE_URL: 'database-secret-test-fixture',
    DIRECT_URL: 'direct-secret-test-fixture',
    CONTADOR_EXTERNO_SESSION_SECRET: 'segredo-de-sessao-ficticio',
  };
  const logs = [];
  main({ env: environment, run: () => 1, log: (message) => logs.push(message) });
  const output = logs.join('\n');
  for (const value of Object.values(environment)) {
    assert.ok(!output.includes(value), `vazou valor de ambiente: ${value.slice(0, 12)}...`);
  }
});

test('logs do runner pertencem somente ao vocabulário permitido', () => {
  const logs = [];
  main({ env: AUTHORIZED_ENV, run: () => 0, log: (message) => logs.push(message) });
  const allowed = new Set(Object.values(MIGRATION_LOG));
  assert.ok(logs.every((message) => allowed.has(message)));
});
