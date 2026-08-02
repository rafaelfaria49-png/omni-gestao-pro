/**
 * Testes do runner de build — `node --test "scripts/vercel-build.test.mjs"`
 *
 * Prova que o baseline e o `prisma migrate deploy`:
 *   - NÃO rodam local (sem VERCEL_ENV), em development nem em preview;
 *   - rodam SOMENTE em production, ANTES de `prisma generate` e `next build`;
 *   - ao falhar, interrompem o build (passos seguintes nunca são chamados);
 *   - nenhum valor de variável secreta é impresso pelo runner;
 *   - a lista de baseline cobre 0001–0014 e nunca inclui a 0015;
 *   - o parser de diff distingue drift real de saída vazia.
 *
 * Nenhum comando real é executado: `run` é sempre injetado.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps, main, STEP_BASELINE, STEP_MIGRATE, STEP_GENERATE, STEP_BUILD } from './vercel-build.mjs';
import { BASELINE_MIGRATIONS, diffContemDDL } from './prisma-baseline.mjs';

const label = ([cmd, args]) => `${cmd} ${args.join(' ')}`;

test('local (sem VERCEL_ENV): não chama baseline nem migrate deploy', () => {
  const steps = buildSteps({}).map(label);
  assert.deepEqual(steps, [label(STEP_GENERATE), label(STEP_BUILD)]);
});

test('preview: não chama baseline nem migrate deploy', () => {
  const steps = buildSteps({ VERCEL_ENV: 'preview' }).map(label);
  assert.ok(!steps.some((s) => s.includes('migrate deploy') || s.includes('prisma-baseline')));
});

test('development: não chama baseline nem migrate deploy', () => {
  const steps = buildSteps({ VERCEL_ENV: 'development' }).map(label);
  assert.ok(!steps.some((s) => s.includes('migrate deploy') || s.includes('prisma-baseline')));
});

test('production: baseline e migrate deploy rodam ANTES de generate e next build', () => {
  const steps = buildSteps({ VERCEL_ENV: 'production' }).map(label);
  assert.deepEqual(steps, [label(STEP_BASELINE), label(STEP_MIGRATE), label(STEP_GENERATE), label(STEP_BUILD)]);
});

test('falha do baseline interrompe o build (migrate/generate/build não executam)', () => {
  const calls = [];
  const code = main({
    env: { VERCEL_ENV: 'production' },
    run: (step) => {
      calls.push(label(step));
      return calls.length === 1 ? 1 : 0; // baseline falha
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, [label(STEP_BASELINE)]);
});

test('falha da migration interrompe o build (generate/build não executam)', () => {
  const calls = [];
  const code = main({
    env: { VERCEL_ENV: 'production' },
    run: (step) => {
      calls.push(label(step));
      return label(step) === label(STEP_MIGRATE) ? 1 : 0;
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, [label(STEP_BASELINE), label(STEP_MIGRATE)]);
});

test('falha em qualquer passo propaga o exit code e para a fila', () => {
  const calls = [];
  const code = main({
    env: { VERCEL_ENV: 'production' },
    run: (step) => {
      calls.push(label(step));
      return label(step) === label(STEP_GENERATE) ? 7 : 0;
    },
  });
  assert.equal(code, 7);
  assert.deepEqual(calls, [label(STEP_BASELINE), label(STEP_MIGRATE), label(STEP_GENERATE)]);
});

test('build completo em production retorna 0', () => {
  const code = main({ env: { VERCEL_ENV: 'production' }, run: () => 0 });
  assert.equal(code, 0);
});

test('baseline: lista congelada cobre 0001–0014 e NUNCA inclui a 0015', () => {
  assert.equal(BASELINE_MIGRATIONS.length, 14);
  assert.equal(BASELINE_MIGRATIONS[0], '0001_init_clientes_produtos');
  assert.equal(BASELINE_MIGRATIONS[13], '0014_contador_hub_nucleo');
  assert.ok(BASELINE_MIGRATIONS.every((m) => !m.startsWith('0015')));
});

test('baseline: parser de diff — vazio/comentários não são drift', () => {
  assert.equal(diffContemDDL(''), false);
  assert.equal(diffContemDDL('\n-- No differences found\n\n'), false);
  assert.equal(diffContemDDL(';\n-- comentário\n'), false);
});

test('baseline: parser de diff — qualquer DDL é drift real', () => {
  assert.equal(diffContemDDL('CREATE TABLE "x" ("id" TEXT);'), true);
  assert.equal(diffContemDDL('-- comentário\nALTER TABLE "stores" ADD COLUMN "y" TEXT;'), true);
  assert.equal(diffContemDDL('DROP TABLE "fantasma";'), true);
});


test('nenhuma variável secreta é impressa pelo runner', () => {
  const secretos = {
    VERCEL_ENV: 'production',
    DATABASE_URL: 'postgresql://user:SENHA-FICTICIA-SECRETA@host/db',
    DIRECT_URL: 'postgresql://user:SENHA-DIRETA-FICTICIA@host/db',
    CONTADOR_EXTERNO_SESSION_SECRET: 'segredo-de-sessao-ficticio',
  };
  const saidas = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (...a) => saidas.push(a.join(' '));
  console.log = (...a) => saidas.push(a.join(' '));
  try {
    main({ env: secretos, run: () => 1 }); // força mensagem de falha
  } finally {
    console.error = origErr;
    console.log = origLog;
  }
  const tudo = saidas.join('\n');
  for (const valor of Object.values(secretos)) {
    assert.ok(!tudo.includes(valor), `vazou valor de ambiente: ${valor.slice(0, 12)}...`);
  }
});
