#!/usr/bin/env node
/**
 * Runner de build (Vercel e local).
 *
 * - `npx prisma migrate deploy` executa SOMENTE quando VERCEL_ENV === 'production'
 *   (deployment de Production da Vercel). Local, development, preview e qualquer
 *   ambiente sem VERCEL_ENV NUNCA aplicam migration.
 * - Sempre executa, nesta ordem: `npx prisma generate` e `npx next build --webpack`.
 * - Falha em qualquer passo interrompe imediatamente o build (exit code propagado).
 * - NUNCA imprime variáveis de ambiente, DATABASE_URL, DIRECT_URL ou qualquer
 *   segredo: o stdout/stderr dos comandos filhos é apenas repassado (inherit).
 *
 * Testável: a lógica é exportada pura; a execução real só ocorre quando o
 * arquivo é o entrypoint. Testes: scripts/vercel-build.test.mjs
 * (`node --test "scripts/vercel-build.test.mjs"`).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STEP_BASELINE = Object.freeze(['node', ['scripts/prisma-baseline.mjs']]);
export const STEP_MIGRATE = Object.freeze(['npx', ['prisma', 'migrate', 'deploy']]);
export const STEP_GENERATE = Object.freeze(['npx', ['prisma', 'generate']]);
export const STEP_BUILD = Object.freeze(['npx', ['next', 'build', '--webpack']]);

/**
 * Passos do build para o ambiente informado. Em production: baseline seguro
 * (no-op se `_prisma_migrations` já existe) e migration entram PRIMEIRO.
 */
export function buildSteps(env = process.env) {
  const steps = [];
  if (env.VERCEL_ENV === 'production') steps.push(STEP_BASELINE, STEP_MIGRATE);
  steps.push(STEP_GENERATE, STEP_BUILD);
  return steps;
}

/**
 * Executor padrão: spawn síncrono, stdio herdado (sem capturar nem ecoar
 * ambiente), shell apenas no Windows (npx é shim .cmd). Retorna o exit code.
 */
function defaultRun([cmd, args]) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (res.error) {
    console.error(`[vercel-build] falha ao iniciar comando: ${cmd} (${res.error.message})`);
    return 1;
  }
  return res.status ?? 1;
}

/**
 * Executa os passos em ordem; para no primeiro exit code != 0 e o propaga.
 * `run` injetável apenas para testes.
 */
export function main({ env = process.env, run = defaultRun } = {}) {
  for (const step of buildSteps(env)) {
    const code = run(step);
    if (code !== 0) {
      console.error(`[vercel-build] abortando build: passo falhou com exit ${code}: ${step[0]} ${step[1].join(' ')}`);
      return code || 1;
    }
  }
  return 0;
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exit(main());
}
