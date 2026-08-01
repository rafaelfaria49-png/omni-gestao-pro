/**
 * Testes do runner de build — `node --test "scripts/vercel-build.test.mjs"`
 *
 * Prova que `prisma migrate deploy`:
 *   - NÃO roda local (sem VERCEL_ENV), em development nem em preview;
 *   - roda SOMENTE em production, ANTES de `prisma generate` e `next build`;
 *   - ao falhar, interrompe o build (generate/build nunca são chamados);
 *   - nenhum valor de variável secreta é impresso pelo runner.
 *
 * Nenhum comando real é executado: `run` é sempre injetado.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps, main, STEP_MIGRATE, STEP_GENERATE, STEP_BUILD } from './vercel-build.mjs';

const label = ([cmd, args]) => `${cmd} ${args.join(' ')}`;

test('local (sem VERCEL_ENV): não chama migrate deploy', () => {
  const steps = buildSteps({});
  assert.deepEqual(steps.map(label), [label(STEP_GENERATE), label(STEP_BUILD)]);
});

test('preview: não chama migrate deploy', () => {
  const steps = buildSteps({ VERCEL_ENV: 'preview' });
  assert.ok(!steps.map(label).some((s) => s.includes('migrate deploy')));
});

test('development: não chama migrate deploy', () => {
  const steps = buildSteps({ VERCEL_ENV: 'development' });
  assert.ok(!steps.map(label).some((s) => s.includes('migrate deploy')));
});

test('production: migrate deploy roda ANTES de generate e next build', () => {
  const steps = buildSteps({ VERCEL_ENV: 'production' }).map(label);
  assert.deepEqual(steps, [label(STEP_MIGRATE), label(STEP_GENERATE), label(STEP_BUILD)]);
});

test('falha da migration interrompe o build (generate/build não executam)', () => {
  const calls = [];
  const code = main({
    env: { VERCEL_ENV: 'production' },
    run: (step) => {
      calls.push(label(step));
      return calls.length === 1 ? 1 : 0; // migrate falha
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, [label(STEP_MIGRATE)]);
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
  assert.deepEqual(calls, [label(STEP_MIGRATE), label(STEP_GENERATE)]);
});

test('build completo em production retorna 0', () => {
  const code = main({ env: { VERCEL_ENV: 'production' }, run: () => 0 });
  assert.equal(code, 0);
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
