#!/usr/bin/env node
/**
 * Runner de build (Vercel e local).
 *
 * - `npx prisma migrate deploy` executa somente quando o guard fail-closed
 *   confirma Production + flag explícita + project ID canônico.
 * - Local, development, preview e projetos não canônicos continuam o build
 *   sem baseline e sem migration.
 * - O runner emite somente eventos constantes para a decisão de migration.
 * - Nenhuma variável, ID, domínio, credencial ou comando é incluído nos logs.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateMigrationAuthority,
  MIGRATION_GUARD_ACTION,
} from './migration-authority-guard.mjs';

export const STEP_BASELINE = Object.freeze(['node', ['scripts/prisma-baseline.mjs']]);
export const STEP_MIGRATE = Object.freeze(['npx', ['prisma', 'migrate', 'deploy']]);
export const STEP_GENERATE = Object.freeze(['npx', ['prisma', 'generate']]);
export const STEP_BUILD = Object.freeze(['npx', ['next', 'build', '--webpack']]);

export const MIGRATION_LOG = Object.freeze({
  RUN: 'MIGRATION_RUN',
  SKIPPED: 'MIGRATION_SKIPPED',
  BLOCKED: 'MIGRATION_GUARD_BLOCKED',
  SUCCEEDED: 'MIGRATION_SUCCEEDED',
  FAILED: 'MIGRATION_FAILED',
});

function resolveMigrationAction(env, evaluate) {
  try {
    const decision = evaluate(env);
    if (decision === null || typeof decision !== 'object' || Array.isArray(decision)) {
      return null;
    }

    const { action } = decision;
    if (
      action === MIGRATION_GUARD_ACTION.RUN ||
      action === MIGRATION_GUARD_ACTION.SKIP ||
      action === MIGRATION_GUARD_ACTION.BLOCK
    ) {
      return action;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildSteps(env = process.env, evaluate = evaluateMigrationAuthority) {
  const action = resolveMigrationAction(env, evaluate);
  if (action === MIGRATION_GUARD_ACTION.RUN) {
    return [STEP_BASELINE, STEP_MIGRATE, STEP_GENERATE, STEP_BUILD];
  }
  if (action === MIGRATION_GUARD_ACTION.SKIP) return [STEP_GENERATE, STEP_BUILD];
  return [];
}

function defaultRun([cmd, args]) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (res.error) return 1;
  return res.status ?? 1;
}

function runSafely(run, step) {
  try {
    const code = run(step);
    return Number.isInteger(code) ? code : 1;
  } catch {
    return 1;
  }
}

export function main({
  env = process.env,
  run = defaultRun,
  log = console.log,
  evaluate = evaluateMigrationAuthority,
} = {}) {
  const action = resolveMigrationAction(env, evaluate);

  if (action === MIGRATION_GUARD_ACTION.BLOCK || action === null) {
    log(MIGRATION_LOG.BLOCKED);
    return 1;
  }

  if (action === MIGRATION_GUARD_ACTION.SKIP) {
    log(MIGRATION_LOG.SKIPPED);
  } else if (action === MIGRATION_GUARD_ACTION.RUN) {
    log(MIGRATION_LOG.RUN);
    for (const step of [STEP_BASELINE, STEP_MIGRATE]) {
      const code = runSafely(run, step);
      if (code !== 0) {
        log(MIGRATION_LOG.FAILED);
        return code || 1;
      }
    }
    log(MIGRATION_LOG.SUCCEEDED);
  }

  for (const step of [STEP_GENERATE, STEP_BUILD]) {
    const code = runSafely(run, step);
    if (code !== 0) return code || 1;
  }
  return 0;
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exit(main());
}
