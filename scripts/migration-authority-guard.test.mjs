import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_VERCEL_PROJECT_ID,
  evaluateMigrationAuthority,
  MIGRATION_GUARD_ACTION,
  MIGRATION_GUARD_REASON,
} from './migration-authority-guard.mjs';

const decide = (env) => evaluateMigrationAuthority(env);

test('local sem VERCEL_ENV é skipped', () => {
  assert.deepEqual(decide({}), {
    action: MIGRATION_GUARD_ACTION.SKIP,
    reason: MIGRATION_GUARD_REASON.NON_PRODUCTION,
  });
});

test('development é skipped mesmo com flag', () => {
  assert.equal(
    decide({ VERCEL_ENV: 'development', MIGRATION_AUTHORITY_ENABLED: 'true' }).action,
    MIGRATION_GUARD_ACTION.SKIP,
  );
});

test('preview é skipped mesmo com flag', () => {
  assert.equal(
    decide({ VERCEL_ENV: 'preview', MIGRATION_AUTHORITY_ENABLED: 'true' }).action,
    MIGRATION_GUARD_ACTION.SKIP,
  );
});

test('production canônico sem flag é authority-disabled', () => {
  assert.deepEqual(
    decide({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID }),
    {
      action: MIGRATION_GUARD_ACTION.SKIP,
      reason: MIGRATION_GUARD_REASON.AUTHORITY_DISABLED,
    },
  );
});

test('production canônico com flag exata é autorizado', () => {
  assert.deepEqual(
    decide({
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID,
      MIGRATION_AUTHORITY_ENABLED: 'true',
    }),
    { action: MIGRATION_GUARD_ACTION.RUN, reason: MIGRATION_GUARD_REASON.AUTHORIZED },
  );
});

test('production legado é non-authoritative com e sem flag', () => {
  for (const flag of [undefined, 'true']) {
    assert.deepEqual(
      decide({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_ID: 'prj_legacy_test_fixture',
        MIGRATION_AUTHORITY_ENABLED: flag,
      }),
      {
        action: MIGRATION_GUARD_ACTION.SKIP,
        reason: MIGRATION_GUARD_REASON.NON_AUTHORITATIVE_PROJECT,
      },
    );
  }
});

test('terceiro projeto com flag não recebe autoridade', () => {
  assert.equal(
    decide({
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: 'prj_unknown_test_fixture',
      MIGRATION_AUTHORITY_ENABLED: 'true',
    }).action,
    MIGRATION_GUARD_ACTION.SKIP,
  );
});

test('ausência de VERCEL_PROJECT_ID bloqueia tentativa explícita', () => {
  assert.deepEqual(
    decide({ VERCEL_ENV: 'production', MIGRATION_AUTHORITY_ENABLED: 'true' }),
    {
      action: MIGRATION_GUARD_ACTION.BLOCK,
      reason: MIGRATION_GUARD_REASON.MISSING_PROJECT_ID,
    },
  );
});

test('ID divergente continua skipped', () => {
  assert.equal(
    decide({
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: 'prj_divergent_test_fixture',
      MIGRATION_AUTHORITY_ENABLED: 'true',
    }).reason,
    MIGRATION_GUARD_REASON.NON_AUTHORITATIVE_PROJECT,
  );
});

test('flag inválida bloqueia o projeto canônico', () => {
  assert.deepEqual(
    decide({
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: CANONICAL_VERCEL_PROJECT_ID,
      MIGRATION_AUTHORITY_ENABLED: 'TRUE',
    }),
    { action: MIGRATION_GUARD_ACTION.BLOCK, reason: MIGRATION_GUARD_REASON.INVALID_FLAG },
  );
});

test('environment desconhecido bloqueia tentativa explícita', () => {
  assert.deepEqual(
    decide({ VERCEL_ENV: 'staging', MIGRATION_AUTHORITY_ENABLED: 'true' }),
    {
      action: MIGRATION_GUARD_ACTION.BLOCK,
      reason: MIGRATION_GUARD_REASON.INVALID_ENVIRONMENT,
    },
  );
});

test('domínio canônico sem project ID não concede autoridade', () => {
  assert.equal(
    decide({
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'omni-gestao-pro.vercel.app',
      MIGRATION_AUTHORITY_ENABLED: 'true',
    }).action,
    MIGRATION_GUARD_ACTION.BLOCK,
  );
});
