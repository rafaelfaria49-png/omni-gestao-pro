/**
 * Autoridade versionada de migrations da Vercel.
 *
 * O ID é server-only e deliberadamente não é emitido em logs. Nome de projeto,
 * domínio e flag isolada nunca concedem autoridade.
 */
export const CANONICAL_VERCEL_PROJECT_ID = 'prj_wjkHKw2jFQfY8regMYtkYXwgavuz';

export const MIGRATION_GUARD_ACTION = Object.freeze({
  RUN: 'run',
  SKIP: 'skip',
  BLOCK: 'block',
});

export const MIGRATION_GUARD_REASON = Object.freeze({
  NON_PRODUCTION: 'non-production',
  AUTHORITY_DISABLED: 'authority-disabled',
  NON_AUTHORITATIVE_PROJECT: 'non-authoritative-project',
  MISSING_PROJECT_ID: 'missing-project-id',
  INVALID_FLAG: 'invalid-flag',
  INVALID_ENVIRONMENT: 'invalid-environment',
  AUTHORIZED: 'authorized',
});

const KNOWN_VERCEL_ENVIRONMENTS = new Set(['production', 'preview', 'development']);

function result(action, reason) {
  if (!Object.values(MIGRATION_GUARD_ACTION).includes(action)) {
    throw new TypeError('invalid migration guard action');
  }
  if (!Object.values(MIGRATION_GUARD_REASON).includes(reason)) {
    throw new TypeError('invalid migration guard reason');
  }
  return Object.freeze({ action, reason });
}

/**
 * Avalia somente metadados de build. Não lê banco, domínio nem nome de projeto.
 */
export function evaluateMigrationAuthority(env = {}) {
  const vercelEnvironment = env.VERCEL_ENV;
  const authorityFlag = env.MIGRATION_AUTHORITY_ENABLED;
  const projectId = env.VERCEL_PROJECT_ID;

  if (vercelEnvironment == null || vercelEnvironment === '') {
    return result(MIGRATION_GUARD_ACTION.SKIP, MIGRATION_GUARD_REASON.NON_PRODUCTION);
  }

  if (!KNOWN_VERCEL_ENVIRONMENTS.has(vercelEnvironment)) {
    if (authorityFlag != null && authorityFlag !== '' && authorityFlag !== 'false') {
      return result(MIGRATION_GUARD_ACTION.BLOCK, MIGRATION_GUARD_REASON.INVALID_ENVIRONMENT);
    }
    return result(MIGRATION_GUARD_ACTION.SKIP, MIGRATION_GUARD_REASON.NON_PRODUCTION);
  }

  if (vercelEnvironment !== 'production') {
    return result(MIGRATION_GUARD_ACTION.SKIP, MIGRATION_GUARD_REASON.NON_PRODUCTION);
  }

  if (projectId == null || projectId === '') {
    if (authorityFlag === 'true') {
      return result(MIGRATION_GUARD_ACTION.BLOCK, MIGRATION_GUARD_REASON.MISSING_PROJECT_ID);
    }
    return result(MIGRATION_GUARD_ACTION.SKIP, MIGRATION_GUARD_REASON.NON_AUTHORITATIVE_PROJECT);
  }

  if (projectId !== CANONICAL_VERCEL_PROJECT_ID) {
    return result(MIGRATION_GUARD_ACTION.SKIP, MIGRATION_GUARD_REASON.NON_AUTHORITATIVE_PROJECT);
  }

  if (authorityFlag == null || authorityFlag === '' || authorityFlag === 'false') {
    return result(MIGRATION_GUARD_ACTION.SKIP, MIGRATION_GUARD_REASON.AUTHORITY_DISABLED);
  }

  if (authorityFlag !== 'true') {
    return result(MIGRATION_GUARD_ACTION.BLOCK, MIGRATION_GUARD_REASON.INVALID_FLAG);
  }

  return result(MIGRATION_GUARD_ACTION.RUN, MIGRATION_GUARD_REASON.AUTHORIZED);
}
