/**
 * Testes do AEP/1.0-R2 — `node --test "scripts/*.test.mjs"`
 *
 * (A partir do Node 23 os argumentos posicionais de `node --test` são GLOB, não
 * diretório a percorrer; por isso o padrão acima, e não `node --test scripts/`.)
 *
 * Todas as simulações destrutivas (commit de teste, caminho fora da allowlist, gate não
 * autorizado, código produtivo staged, `open` com árvore limpa) acontecem EXCLUSIVAMENTE
 * em repositórios Git temporários criados aqui. Nada toca a worktree real.
 *
 * Zero dependências externas: node:test, node:assert, node:fs, node:path,
 * node:child_process.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRACK = path.join(HERE, 'track.mjs');
const HOOKS_SRC = path.join(HERE, '..', '.githooks');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: r.status === null ? 1 : r.status,
    out: (r.stdout || '').replace(/\r\n/g, '\n'),
    err: (r.stderr || '').replace(/\r\n/g, '\n'),
    all: `${(r.stdout || '')}${(r.stderr || '')}`.replace(/\r\n/g, '\n'),
  };
}

function g(cwd, ...args) {
  return sh('git', args, { cwd });
}

function aep(cwd, args, env = {}) {
  return sh(process.execPath, [TRACK, ...args], { cwd, env });
}

/**
 * Emite a SAÍDA LITERAL de uma execução quando AEP_EVIDENCE=1. As evidências das
 * validações f, g, i e k saem daqui — do mesmo repositório Git temporário do fixture,
 * nunca da worktree real.
 */
function ev(rotulo, r) {
  if (process.env.AEP_EVIDENCE !== '1') return;
  const txt = typeof r === 'string' ? r : `$ exit ${r.code}\n${r.all}`;
  console.log(`\n===== EVIDENCIA ${rotulo} =====\n${txt}===== FIM ${rotulo} =====\n`);
}

function w(root, rel, content) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return f;
}

const FIXTURE_PROTOCOL = {
  aep: '1.0-R2',
  default_branch: 'main',
  tracks_dir: 'docs/execution-tracks',
  test_runner: 'node --test "scripts/*.test.mjs"',
  max_attempts: 3,
  max_hot_goals: 3,
  gates: [
    {
      id: 'G-DADOS-SCHEMA',
      tipo: 'caminho',
      autorizacao: 'humana explícita',
      paths: ['prisma/schema.prisma', 'prisma/migrations/**'],
      motivo: 'dados reais',
    },
  ],
  adapters: [
    { slug: 'agents', file: 'AGENTS.md', linha_final: 'Adaptador: AGENTS.md — genérico.' },
  ],
  tracks: {},
  remote_layer: { ci_verify: false, branch_protection_confirmada_por: null, branch_protection_confirmada_em: null },
};

/** Cria origin bare + repo de trabalho já com o AEP instalado e hooks ativos. */
function makeRepo(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-test-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(origin, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });

  assert.equal(sh('git', ['init', '--bare', '-b', 'main', origin]).code, 0);
  assert.equal(sh('git', ['init', '-b', 'main', repo]).code, 0);
  g(repo, 'config', 'user.email', 'aep@test.local');
  g(repo, 'config', 'user.name', 'AEP Test');
  g(repo, 'config', 'commit.gpgsign', 'false');
  g(repo, 'remote', 'add', 'origin', origin);

  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.copyFileSync(TRACK, path.join(repo, 'scripts', 'track.mjs'));
  fs.mkdirSync(path.join(repo, '.githooks'), { recursive: true });
  for (const h of ['pre-commit', 'commit-msg']) {
    const dst = path.join(repo, '.githooks', h);
    fs.copyFileSync(path.join(HOOKS_SRC, h), dst);
    fs.chmodSync(dst, 0o755);
  }
  w(repo, 'scripts/goal-test.mjs',
    "import fs from 'node:fs';\nprocess.exit(fs.existsSync('TEST_MUST_FAIL') ? 1 : 0);\n");
  w(repo, '.gitignore', '.aep-active\nimport/\nTEST_MUST_FAIL\n');
  w(repo, 'app/produtivo.ts', 'export const produtivo = 1;\n');
  w(repo, 'AGENTS.md', '# Governança humana\n\nEste parágrafo é humano e não pode ser tocado.\n');
  w(repo, 'docs/ai-execution/protocol.json', `${JSON.stringify(FIXTURE_PROTOCOL, null, 2)}\n`);

  g(repo, 'add', '--', 'scripts/track.mjs', 'scripts/goal-test.mjs', '.githooks/pre-commit',
    '.githooks/commit-msg', '.gitignore', 'app/produtivo.ts', 'AGENTS.md',
    'docs/ai-execution/protocol.json');
  assert.equal(g(repo, 'commit', '-m', 'chore: fixture bootstrap').code, 0);
  assert.equal(g(repo, 'push', '-u', 'origin', 'main').code, 0);
  g(repo, 'config', 'core.hooksPath', '.githooks');

  t.after(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows segura handles */ }
  });
  return { tmp, origin, repo, name: path.basename(repo) };
}

const META_DEFAULTS = (repoName, over = {}) => ({
  aep: '1.0-R2',
  id: 'demo-001',
  track: 'demo',
  title: 'GOAL de fixture',
  status: 'READY',
  class: 'C2',
  branch: 'goal/demo-001',
  worktree: repoName,
  test_command: 'node scripts/goal-test.mjs',
  allowlist: ['app/**'],
  gates_liberados: [],
  read_budget: 4,
  ...over,
});

/** Cria a trilha `demo` e ratifica o esqueleto no primeiro commit (tudo CRIAÇÃO). */
function initTrack(repo) {
  assert.equal(aep(repo, ['init', 'demo', '--risk=MEDIO']).code, 0);
  g(repo, 'add', '--', 'docs/ai-execution/protocol.json', 'docs/ai-execution/GATES.md',
    'docs/execution-tracks');
  assert.equal(g(repo, 'commit', '-m', 'chore: trilha demo').code, 0);
}

/** Escreve um GOAL, reconcilia com `registry` e ratifica com AEP_WRITE=1 (ritual de plano). */
function addGoal(repo, meta, bodyOverride) {
  const rel = `docs/execution-tracks/demo/goals/${meta.id}.md`;
  const body = bodyOverride !== undefined
    ? bodyOverride
    : `<!-- AEP:META\n${JSON.stringify(meta, null, 2)}\n-->\n\n# ${meta.id}\n\ncorpo\n`;
  w(repo, rel, body);
  const r = aep(repo, ['registry']);
  if (r.code !== 0) return { rel, registry: r, commit: null };
  const c = g(repo, 'add', '--', rel, 'docs/execution-tracks/demo/state.json',
    'docs/execution-tracks/REGISTRY.md');
  assert.equal(c.code, 0, c.err);
  const commit = sh('git', ['commit', '-m', `aep(demo): plan ${meta.id}`], { cwd: repo, env: { AEP_WRITE: '1' } });
  return { rel, registry: r, commit };
}

function openGoal(repo, branch = 'goal/demo-001') {
  // origin/main precisa refletir o esqueleto já ratificado: base_commit é
  // `git merge-base HEAD origin/<default>`.
  assert.equal(g(repo, 'push', 'origin', 'main').code, 0);
  assert.equal(g(repo, 'checkout', '-q', '-b', branch).code, 0);
  return aep(repo, ['open', 'demo']);
}

// ---------------------------------------------------------------------------
// Gramática de paths e bloco AEP:META
// ---------------------------------------------------------------------------

test('path com glob não suportado falha com exit 1 antes de qualquer execução', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  const meta = META_DEFAULTS(name, { allowlist: ['app/**/*.ts'] });
  const r = addGoal(repo, meta);
  assert.equal(r.registry.code, 1);
  assert.match(r.registry.all, /FALHA \[1\] metadado inválido/);
  assert.match(r.registry.all, /Glob não suportado/);
});

test('bloco AEP:META ausente falha com exit 1', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  const r = addGoal(repo, META_DEFAULTS(name), '# demo-001\n\nsem bloco de metadados\n');
  assert.equal(r.registry.code, 1);
  assert.match(r.registry.all, /bloco.*AEP:META|<!-- AEP:META/);
});

test('bloco AEP:META duplicado falha com exit 1 apontando as linhas', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  const meta = META_DEFAULTS(name);
  const bloco = `<!-- AEP:META\n${JSON.stringify(meta, null, 2)}\n-->\n`;
  const r = addGoal(repo, meta, `${bloco}\n${bloco}`);
  assert.equal(r.registry.code, 1);
  assert.match(r.registry.all, /EXATAMENTE UMA linha/);
});

test('bloco AEP:META malformado falha com exit 1 citando as linhas do miolo', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  const r = addGoal(repo, META_DEFAULTS(name), '<!-- AEP:META\n{ "aep": "1.0-R2", }\n-->\n');
  assert.equal(r.registry.code, 1);
  assert.match(r.registry.all, /deve ser JSON válido/);
});

test('bloco AEP:META sem "-->" falha com exit 1', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  const r = addGoal(repo, META_DEFAULTS(name), `<!-- AEP:META\n${JSON.stringify(META_DEFAULTS(name))}\n`);
  assert.equal(r.registry.code, 1);
  assert.match(r.registry.all, /sem "-->"/);
});

// ---------------------------------------------------------------------------
// open — não troca de branch, não suja a árvore
// ---------------------------------------------------------------------------

test('open falha por branch errada com exit 5 e NÃO troca de branch', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  const antes = g(repo, 'rev-parse', '--abbrev-ref', 'HEAD').out.trim();
  const r = aep(repo, ['open', 'demo']);
  assert.equal(r.code, 5);
  assert.match(r.all, /FALHA \[5\] pré-condição de ambiente/);
  assert.match(r.all, /nunca executa checkout/);
  const depois = g(repo, 'rev-parse', '--abbrev-ref', 'HEAD').out.trim();
  assert.equal(depois, antes, 'open não pode trocar de branch');
  assert.equal(fs.existsSync(path.join(repo, '.aep-active')), false);
});

test('open falha por worktree divergente com exit 5', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name, { worktree: 'worktree-que-nao-existe' }));
  g(repo, 'checkout', '-q', '-b', 'goal/demo-001');
  const r = aep(repo, ['open', 'demo']);
  assert.equal(r.code, 5);
  assert.match(r.all, /uma worktree/);
});

test('open NÃO suja a árvore: git status --porcelain segue vazio', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  assert.equal(g(repo, 'status', '--porcelain').out.trim(), '');
  const r = openGoal(repo);
  assert.equal(r.code, 0, r.all);
  const porcelain = g(repo, 'status', '--porcelain');
  ev('k — open + git status --porcelain (árvore limpa antes e depois)',
    `$ node scripts/track.mjs open demo\n${r.all}\n$ git status --porcelain\n[saída literal: ${JSON.stringify(porcelain.out)}]\n$ ls .aep-active\n${fs.existsSync(path.join(repo, '.aep-active')) ? '.aep-active (presente, gitignored)' : 'AUSENTE'}\n`);
  assert.equal(porcelain.out.trim(), '',
    '.aep-active é gitignored; open não escreve nada versionado');
  assert.equal(fs.existsSync(path.join(repo, '.aep-active')), true);
  assert.match(r.all, /LEIA EXATAMENTE UM ARQUIVO DE GOAL/);
  assert.match(r.all, /CLASSIFICAÇÃO \(8 campos/);
  assert.match(r.all, /tentativa:\s+1\/3/);
});

// ---------------------------------------------------------------------------
// check / close
// ---------------------------------------------------------------------------

function trabalhaECommita(repo, msg = 'goal(demo-001): trabalho') {
  w(repo, 'app/produtivo.ts', 'export const produtivo = 2;\n');
  assert.equal(g(repo, 'add', '--', 'app/produtivo.ts').code, 0);
  return g(repo, 'commit', '-m', msg);
}

test('check falha com árvore suja', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  openGoal(repo);
  trabalhaECommita(repo);
  w(repo, 'app/produtivo.ts', 'export const produtivo = 3;\n'); // não commitado
  const r = aep(repo, ['check', 'demo']);
  assert.equal(r.code, 3);
  assert.match(r.all, / 3 \[FAIL \] árvore limpa/);
});

test('check falha quando o teste do GOAL falha e close ABORTA sem escrever', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  openGoal(repo);
  trabalhaECommita(repo);
  w(repo, 'TEST_MUST_FAIL', 'x'); // gitignored: não suja a árvore
  const ledgerAntes = fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/LEDGER.jsonl'), 'utf8');
  const r = aep(repo, ['close', 'demo']);
  assert.equal(r.code, 3);
  assert.match(r.all, /10 \[FAIL \] teste do GOAL passa/);
  assert.match(r.all, /close ABORTADO/);
  assert.match(r.all, /CONTEXTO: CONTINUE/);
  assert.equal(fs.existsSync(path.join(repo, '.aep-active')), true, 'close preserva .aep-active na falha');
  assert.equal(fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/LEDGER.jsonl'), 'utf8'), ledgerAntes);
  assert.equal(g(repo, 'status', '--porcelain').out.trim(), '');
});

test('close com check verde ratifica, remove .aep-active e fecha o ÚLTIMO GOAL sem próximo', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  openGoal(repo);
  trabalhaECommita(repo);
  const headAgente = g(repo, 'rev-parse', 'HEAD').out.trim();

  const r = aep(repo, ['close', 'demo']);
  assert.equal(r.code, 0, r.all);
  assert.match(r.all, /RATIFICADO/);
  assert.match(r.all, /CONTEXTO: CLEAR/, 'sem próximo GOAL o veredito é CLEAR');
  assert.equal(fs.existsSync(path.join(repo, '.aep-active')), false, 'close remove .aep-active no sucesso');

  const linhas = fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/LEDGER.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].result, 'DONE');
  assert.equal(linhas[0].head_commit, headAgente);
  assert.equal(linhas[0].source, 'executado');

  const st = JSON.parse(fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/state.json'), 'utf8'));
  assert.equal(st.next_goal, null);
  assert.equal(st.current_goal, null);
  assert.equal(st.status, 'PAUSED');
  assert.equal(st.counters.goals_done, 1);

  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/_closed/goals/demo-001.md')), true);
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/goals/demo-001.md')), false);
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/_closed/reports/demo-001-a1.md')), true);

  // dois commits: o do agente e o de estado
  const log = g(repo, 'log', '--format=%s', '-2').out.trim().split('\n');
  assert.equal(log[0], 'aep(demo): close demo-001');
  assert.equal(log[1], 'goal(demo-001): trabalho');
  assert.equal(g(repo, 'status', '--porcelain').out.trim(), '');
  assert.equal(aep(repo, ['verify', '--all']).code, 0);
});

test('check acusa base_commit inexistente e commit em branch errada', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  openGoal(repo);
  trabalhaECommita(repo);

  const activeFile = path.join(repo, '.aep-active');
  const a = JSON.parse(fs.readFileSync(activeFile, 'utf8'));

  // 1) commit inexistente
  fs.writeFileSync(activeFile, JSON.stringify({ ...a, base_commit: '0'.repeat(40) }, null, 2));
  const r1 = aep(repo, ['check', 'demo']);
  assert.equal(r1.code, 3);
  assert.match(r1.all, / 5 \[FAIL \] base_commit é ancestral da branch/);

  // 2) commit real, mas de outra branch (não ancestral)
  g(repo, 'checkout', '-q', '-b', 'outra');
  w(repo, 'app/produtivo.ts', 'export const produtivo = 99;\n');
  g(repo, 'add', '--', 'app/produtivo.ts');
  g(repo, 'commit', '--no-verify', '-m', 'goal(demo-001): commit de outra branch');
  const shaOutra = g(repo, 'rev-parse', 'HEAD').out.trim();
  g(repo, 'checkout', '-q', 'goal/demo-001');
  fs.writeFileSync(activeFile, JSON.stringify({ ...a, base_commit: shaOutra }, null, 2));
  const r2 = aep(repo, ['check', 'demo']);
  assert.equal(r2.code, 3);
  assert.match(r2.all, / 5 \[FAIL \] base_commit é ancestral da branch/);
});

test('check acusa caminho fora da allowlist e gate de caminho não liberado', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name, { allowlist: ['app/**', 'prisma/migrations/**'] }));
  openGoal(repo);
  // gate G-DADOS-SCHEMA não está em gates_liberados.
  w(repo, 'prisma/migrations/0001/migration.sql', 'SELECT 1;\n');
  g(repo, 'add', '--', 'prisma/migrations/0001/migration.sql');
  // O hook recusaria; --no-verify simula justamente o desvio que só `check` detecta.
  assert.equal(g(repo, 'commit', '--no-verify', '-m', 'goal(demo-001): migration').code, 0);
  const r = aep(repo, ['check', 'demo']);
  assert.equal(r.code, 3);
  assert.match(r.all, / 7 \[FAIL \] nenhum gate de caminho não liberado/);
  assert.match(r.all, /G-DADOS-SCHEMA/);

  // e um caminho simplesmente fora da allowlist
  w(repo, 'services/fora.ts', 'export const x = 1;\n');
  g(repo, 'add', '--', 'services/fora.ts');
  g(repo, 'commit', '--no-verify', '-m', 'goal(demo-001): fora');
  const r2 = aep(repo, ['check', 'demo']);
  assert.equal(r2.code, 3);
  assert.match(r2.all, / 6 \[FAIL \] caminhos do diff dentro da allowlist/);
  assert.match(r2.all, /services\/fora\.ts/);
});

// ---------------------------------------------------------------------------
// tentativas
// ---------------------------------------------------------------------------

test('teto de 3 tentativas: a falha que o esgota converte o GOAL em BLOCKED (exit 3)', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  openGoal(repo);

  const a1 = aep(repo, ['attempt', 'demo', '--fail', '--reason=abordagem A nao funcionou']);
  assert.equal(a1.code, 0);
  assert.match(a1.all, /nova tentativa: 2\/3/);
  assert.equal(g(repo, 'status', '--porcelain').out.trim(), '', 'attempt não escreve versionado');

  const a2 = aep(repo, ['attempt', 'demo', '--fail', '--reason=abordagem B nao funcionou']);
  assert.equal(a2.code, 0);
  assert.match(a2.all, /nova tentativa: 3\/3/);

  const a3 = aep(repo, ['attempt', 'demo', '--fail', '--reason=abordagem C nao funcionou']);
  assert.equal(a3.code, 3);
  assert.match(a3.all, /TETO DE TENTATIVAS ESGOTADO/);
  assert.match(a3.all, /BLOCKED/);
  assert.equal(fs.existsSync(path.join(repo, '.aep-active')), false);

  const linhas = fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/LEDGER.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].result, 'BLOCKED');
  assert.equal(linhas[0].previous_attempts.length, 3);
  const st = JSON.parse(fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/state.json'), 'utf8'));
  assert.equal(st.status, 'BLOCKED');
  assert.equal(aep(repo, ['verify', '--all']).code, 0);
});

// ---------------------------------------------------------------------------
// Hooks — OPT-IN. Proteção contra ACIDENTE e desvio de agente COOPERATIVO.
// Nada aqui afirma que o hook detecta `git add .`: ele valida o CONJUNTO STAGED.
// ---------------------------------------------------------------------------

test('SEM .aep-active: commit feat(...) tocando código produtivo passa normalmente', (t) => {
  const { repo } = makeRepo(t);
  initTrack(repo);
  assert.equal(fs.existsSync(path.join(repo, '.aep-active')), false);
  w(repo, 'app/produtivo.ts', 'export const produtivo = 42;\n');
  assert.equal(g(repo, 'add', '--', 'app/produtivo.ts').code, 0);
  const c = g(repo, 'commit', '-m', 'feat(app): mexe em codigo produtivo sem AEP');
  ev('g1 — SEM .aep-active: feat(...) em código produtivo PASSA',
    `$ git add -- app/produtivo.ts\n$ git commit -m "feat(app): mexe em codigo produtivo sem AEP"\n$ exit ${c.code}\n${c.all}`);
  assert.equal(c.code, 0, c.all);
  assert.equal(g(repo, 'log', '--format=%s', '-1').out.trim(), 'feat(app): mexe em codigo produtivo sem AEP');
});

test('SEM .aep-active: modificar state.json à mão é RECUSADO pelo hook (exit 2)', (t) => {
  const { repo } = makeRepo(t);
  initTrack(repo);
  const stateRel = 'docs/execution-tracks/demo/state.json';
  const st = JSON.parse(fs.readFileSync(path.join(repo, stateRel), 'utf8'));
  st.counters.goals_done = 99;
  w(repo, stateRel, `${JSON.stringify(st, null, 2)}\n`);
  assert.equal(g(repo, 'add', '--', stateRel).code, 0);
  const c = g(repo, 'commit', '-m', 'chore: mexe no state a mao');
  ev('g2 — SEM .aep-active: modificar state.json à mão é RECUSADO pelo hook',
    `$ git add -- ${stateRel}\n$ git commit -m "chore: mexe no state a mao"\n$ exit ${c.code}\n${c.all}`);
  assert.notEqual(c.code, 0);
  assert.match(c.all, /FALHA \[2\] gate violado/);
  assert.match(c.all, /não editados à mão/);
  // e o ledger idem
  const ledgerRel = 'docs/execution-tracks/demo/LEDGER.jsonl';
  g(repo, 'reset', '-q');
  w(repo, ledgerRel, '{"linha":"forjada"}\n');
  g(repo, 'add', '--', ledgerRel);
  const c2 = g(repo, 'commit', '-m', 'chore: forja ledger');
  assert.notEqual(c2.code, 0);
  assert.match(c2.all, /FALHA \[2\] gate violado/);
});

test('SEM .aep-active: CRIAÇÃO de state.json/LEDGER/REGISTRY passa (sem exceção de bootstrap)', (t) => {
  const { repo } = makeRepo(t);
  // initTrack cria state.json, LEDGER.jsonl e REGISTRY.md pela primeira vez (diff-filter A)
  // e não existe .aep-active: precisa passar naturalmente, sem flag nenhuma.
  assert.equal(aep(repo, ['init', 'demo', '--risk=MEDIO']).code, 0);
  g(repo, 'add', '--', 'docs/ai-execution/protocol.json', 'docs/ai-execution/GATES.md',
    'docs/execution-tracks');
  const filtro = g(repo, 'diff', '--cached', '--name-only', '--diff-filter=A').out;
  assert.match(filtro, /docs\/execution-tracks\/demo\/state\.json/);
  assert.match(filtro, /docs\/execution-tracks\/REGISTRY\.md/);
  const c = g(repo, 'commit', '-m', 'chore: bootstrap da trilha');
  assert.equal(c.code, 0, c.all);
});

test('COM .aep-active: hook recusa CONJUNTO STAGED fora da allowlist (exit 2)', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  assert.equal(openGoal(repo).code, 0);
  w(repo, 'services/fora-da-allowlist.ts', 'export const x = 1;\n');
  assert.equal(g(repo, 'add', '--', 'services/fora-da-allowlist.ts').code, 0);
  const c = g(repo, 'commit', '-m', 'goal(demo-001): caminho fora da allowlist');
  ev('f1 — COM .aep-active: CONJUNTO STAGED com caminho fora da allowlist é RECUSADO',
    `$ git add -- services/fora-da-allowlist.ts\n$ git commit -m "goal(demo-001): caminho fora da allowlist"\n$ exit ${c.code}\n${c.all}`);
  assert.notEqual(c.code, 0);
  assert.match(c.all, /FALHA \[2\] gate violado/);
  assert.match(c.all, /fora da allowlist do GOAL demo-001/);
  assert.match(c.all, /services\/fora-da-allowlist\.ts/);
});

test('COM .aep-active: hook recusa caminho que bate em gate NÃO autorizado (exit 2)', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  // allowlist cobre o caminho, mas o gate G-DADOS-SCHEMA não está liberado
  addGoal(repo, META_DEFAULTS(name, { allowlist: ['app/**', 'prisma/migrations/**'] }));
  assert.equal(openGoal(repo).code, 0);
  w(repo, 'prisma/migrations/0001_init/migration.sql', 'SELECT 1;\n');
  assert.equal(g(repo, 'add', '--', 'prisma/migrations/0001_init/migration.sql').code, 0);
  const c = g(repo, 'commit', '-m', 'goal(demo-001): migration nao autorizada');
  ev('f2 — COM .aep-active: CONJUNTO STAGED batendo em gate NÃO autorizado é RECUSADO',
    `$ git add -- prisma/migrations/0001_init/migration.sql\n$ git commit -m "goal(demo-001): migration nao autorizada"\n$ exit ${c.code}\n${c.all}`);
  assert.notEqual(c.code, 0);
  assert.match(c.all, /FALHA \[2\] gate violado/);
  assert.match(c.all, /G-DADOS-SCHEMA/);
  assert.match(c.all, /peça autorização humana/);
});

test('ledger com linha deletada: hook recusa e, se contornado, check item 9 acusa', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name, { allowlist: ['app/**', 'docs/execution-tracks/demo/LEDGER.jsonl'] }));
  const ledgerRel = 'docs/execution-tracks/demo/LEDGER.jsonl';
  // semeia duas linhas ratificadas
  w(repo, ledgerRel, '{"a":1}\n{"a":2}\n');
  g(repo, 'add', '--', ledgerRel);
  assert.equal(sh('git', ['commit', '-m', 'aep(demo): semeia ledger'], { cwd: repo, env: { AEP_WRITE: '1' } }).code, 0);
  assert.equal(openGoal(repo).code, 0);

  // remove uma linha
  w(repo, ledgerRel, '{"a":1}\n');
  g(repo, 'add', '--', ledgerRel);
  const c = g(repo, 'commit', '-m', 'goal(demo-001): apaga linha do ledger');
  assert.notEqual(c.code, 0, 'o hook precisa recusar');
  assert.match(c.all, /FALHA \[2\] gate violado/);
  // a imutabilidade é a regra que dispara primeiro: LEDGER.jsonl é MODIFICADO (filtro M)
  assert.match(c.all, /ratificados pelo AEP, não editados à mão/);

  // desvio deliberado (--no-verify) — o hook local não impede; `check` DETECTA
  assert.equal(g(repo, 'commit', '--no-verify', '-m', 'goal(demo-001): apaga linha do ledger').code, 0);
  const r = aep(repo, ['check', 'demo']);
  assert.equal(r.code, 3);
  assert.match(r.all, / 9 \[FAIL \] LEDGER\.jsonl sem deleções/);
  assert.match(r.all, /1 linha\(s\) removida\(s\)/);
});

test('COM .aep-active: commit-msg exige goal(...) ou aep(...)', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  assert.equal(openGoal(repo).code, 0);
  w(repo, 'app/produtivo.ts', 'export const produtivo = 7;\n');
  g(repo, 'add', '--', 'app/produtivo.ts');
  const ruim = g(repo, 'commit', '-m', 'feat(app): mensagem fora do padrao com GOAL aberto');
  assert.notEqual(ruim.code, 0);
  assert.match(ruim.all, /goal\(<trilha>-<nnn>\)/);
  const bom = g(repo, 'commit', '-m', 'goal(demo-001): mensagem correta');
  assert.equal(bom.code, 0, bom.all);
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

test('verify detecta state.json editado à mão e sai com 4', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  assert.equal(aep(repo, ['verify', '--all']).code, 0);

  const stateRel = path.join(repo, 'docs/execution-tracks/demo/state.json');
  const st = JSON.parse(fs.readFileSync(stateRel, 'utf8'));
  st.counters.goals_done = 7;
  st.status = 'DONE';
  fs.writeFileSync(stateRel, `${JSON.stringify(st, null, 2)}\n`);

  const r = aep(repo, ['verify', '--all']);
  assert.equal(r.code, 4);
  assert.match(r.all, /\[DIVERGE\] demo/);
  assert.match(r.all, /counters/);
  assert.match(r.all, /status/);
  assert.match(r.all, /DETECTA depois do fato/);
});

test('verify detecta LEDGER.jsonl com linha ratificada removida', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  addGoal(repo, META_DEFAULTS(name));
  openGoal(repo);
  w(repo, 'app/produtivo.ts', 'export const produtivo = 2;\n');
  g(repo, 'add', '--', 'app/produtivo.ts');
  g(repo, 'commit', '-m', 'goal(demo-001): trabalho');
  assert.equal(aep(repo, ['close', 'demo']).code, 0);
  assert.equal(aep(repo, ['verify', '--all']).code, 0);

  // apaga a linha ratificada direto no arquivo
  fs.writeFileSync(path.join(repo, 'docs/execution-tracks/demo/LEDGER.jsonl'), '');
  const r = aep(repo, ['verify', '--all']);
  assert.equal(r.code, 4);
  assert.match(r.all, /append-only/);
});

// ---------------------------------------------------------------------------
// sync-adapters
// ---------------------------------------------------------------------------

test('sync-adapters preserva conteúdo humano fora do bloco e é idempotente', (t) => {
  const { repo } = makeRepo(t);
  const file = path.join(repo, 'AGENTS.md');
  const original = fs.readFileSync(file, 'utf8');

  assert.equal(aep(repo, ['sync-adapters']).code, 0);
  const depois = fs.readFileSync(file, 'utf8');
  assert.equal(depois.startsWith(original), true, 'o conteúdo humano é prefixo byte-a-byte');
  assert.match(depois, /<!-- AEP:BEGIN -->/);
  assert.match(depois, /<!-- AEP:END -->/);
  assert.equal(aep(repo, ['sync-adapters', '--check']).code, 0);

  // substituir SOMENTE o miolo
  const mexido = depois.replace(/regra 1:[^\n]*/, 'regra 1: MIOLO ADULTERADO');
  fs.writeFileSync(file, mexido);
  assert.equal(aep(repo, ['sync-adapters', '--check']).code, 4);
  assert.equal(aep(repo, ['sync-adapters']).code, 0);
  const restaurado = fs.readFileSync(file, 'utf8');
  assert.equal(restaurado.startsWith(original), true);
  assert.equal(restaurado, depois);

  // conteúdo humano acrescentado DEPOIS do bloco também sobrevive
  fs.appendFileSync(file, '\n## Seção humana posterior\n\nnão pode sumir\n');
  const comCauda = fs.readFileSync(file, 'utf8');
  assert.equal(aep(repo, ['sync-adapters']).code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), comCauda);
});

test('sync-adapters recusa bloco duplicado e marcador sem par, sem escrever nada', (t) => {
  const { repo } = makeRepo(t);
  const file = path.join(repo, 'AGENTS.md');

  fs.writeFileSync(file, '# h\n<!-- AEP:BEGIN -->\na\n<!-- AEP:END -->\n<!-- AEP:BEGIN -->\nb\n<!-- AEP:END -->\n');
  const antes = fs.readFileSync(file, 'utf8');
  const r1 = aep(repo, ['sync-adapters']);
  assert.equal(r1.code, 1);
  assert.match(r1.all, /Mais de um bloco AEP/);
  assert.equal(fs.readFileSync(file, 'utf8'), antes);

  fs.writeFileSync(file, '# h\n<!-- AEP:BEGIN -->\na\n');
  const antes2 = fs.readFileSync(file, 'utf8');
  const r2 = aep(repo, ['sync-adapters']);
  assert.equal(r2.code, 1);
  assert.match(r2.all, /sem par/);
  assert.equal(fs.readFileSync(file, 'utf8'), antes2);
});

// ---------------------------------------------------------------------------
// status / doctor
// ---------------------------------------------------------------------------

test('status é somente leitura, cabe em 18 linhas e suporta --json', (t) => {
  const { repo } = makeRepo(t);
  initTrack(repo);
  const antes = g(repo, 'status', '--porcelain').out;
  const r = aep(repo, ['status', 'demo']);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /AEP\/1\.0-R2/);
  assert.match(r.out, /PLANNED/);
  assert.ok(r.out.trimEnd().split('\n').length <= 18, 'status excedeu 18 linhas');
  assert.equal(g(repo, 'status', '--porcelain').out, antes);

  const j = aep(repo, ['status', 'demo', '--json']);
  assert.equal(j.code, 0);
  const parsed = JSON.parse(j.out);
  assert.equal(parsed.aep, '1.0-R2');
  assert.equal(parsed.status, 'PLANNED');
  assert.equal(parsed.current_goal, null);
});

test('doctor emite AVISO de camada remota ausente e ainda assim retorna exit 0', (t) => {
  const { repo } = makeRepo(t);
  initTrack(repo);
  const r = aep(repo, ['doctor']);
  assert.equal(r.code, 0, 'doctor nunca bloqueia o bootstrap local');
  assert.match(r.out, /== CAMADA LOCAL ==/);
  assert.match(r.out, /== CAMADA REMOTA ==/);
  assert.match(r.out, /CAMADA REMOTA NÃO CONFIGURADA/);
  assert.match(r.out, /não cooperativo/);
  assert.match(r.out, /NÃO VERIFICÁVEL LOCALMENTE/);
  assert.match(r.out, /CONFIRMAÇÃO DECLARADA/);
});

// ---------------------------------------------------------------------------
// Importador — FUNCIONAL. Fixture Git cobrindo os cinco casos de reconciliação.
// ---------------------------------------------------------------------------

/** Cria uma branch com um commit real e devolve o SHA. */
function commitReal(repo, branch, rel, conteudo, msg) {
  const atual = g(repo, 'rev-parse', '--abbrev-ref', 'HEAD').out.trim();
  assert.equal(g(repo, 'checkout', '-q', '-b', branch).code, 0);
  w(repo, rel, conteudo);
  g(repo, 'add', '--', rel);
  assert.equal(g(repo, 'commit', '--no-verify', '-m', msg).code, 0);
  const sha = g(repo, 'rev-parse', 'HEAD').out.trim();
  g(repo, 'checkout', '-q', atual);
  return sha;
}

test('importador reconcilia DONE verificado, DONE sem prova, READY, SUPERSEDED e DRAFT', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);

  const shaBom = commitReal(repo, 'goal/demo-001', 'app/feito.ts', 'export const feito = 1;\n', 'goal(demo-001): feito de verdade');
  const shaOrfao = commitReal(repo, 'goal/orfa', 'app/orfao.ts', 'export const orfao = 1;\n', 'goal(demo-004): commit em outra branch');
  const bootstrap = g(repo, 'rev-parse', 'HEAD').out.trim();

  const manifest = {
    aep: '1.0-R2',
    track: 'demo',
    plan_ref: 'docs/planos/PLANO_DEMO.md',
    plan_rev: 3,
    risk_tier: 'MEDIO',
    branch_pattern: 'goal/demo-<nnn>',
    test_command: 'node scripts/goal-test.mjs',
    paths_base: ['app/**'],
    gates_extra: [],
    bootstrap_commit: bootstrap,
    fontes: ['docs/planos/PLANO_DEMO.md', 'docs/audits/AUDITORIA_DEMO.md'],
    plano_ids: ['demo-001', 'demo-002', 'demo-003', 'demo-004', 'demo-005', 'demo-007'],
    goals_declarados: [
      // 1) DONE com commit que existe E está na branch declarada
      { id: 'demo-001', situacao: 'DONE', commit: shaBom, branch: 'goal/demo-001', title: 'Feito e provado', worktree: name },
      // 2) DONE com commit INEXISTENTE → BLOCKED divergencia
      { id: 'demo-002', situacao: 'DONE', commit: 'f'.repeat(40), branch: 'goal/demo-002', title: 'Fantasma', worktree: name },
      // 3) READY → goals/
      { id: 'demo-003', situacao: 'READY', title: 'Pronto para executar', worktree: name },
      // 4) DONE com commit real, porém FORA da branch declarada → BLOCKED divergencia
      { id: 'demo-004', situacao: 'DONE', commit: shaOrfao, branch: 'goal/demo-004', title: 'Commit fora da branch', worktree: name },
      // 5) SUPERSEDED por plan_rev mais novo
      { id: 'demo-005', situacao: 'READY', plan_rev: 2, title: 'Plano velho', worktree: name },
      // 6) no manifesto mas NÃO no plano → BLOCKED decisao
      { id: 'demo-006', situacao: 'READY', title: 'Nunca foi planejado', worktree: name },
    ],
  };
  // demo-007 está no plano e NÃO no manifesto → DRAFT / pendência

  const manifestRel = 'import/demo/MANIFEST.json';
  w(repo, manifestRel, `${JSON.stringify(manifest, null, 2)}\n`);

  const r = aep(repo, ['import', 'demo', `--manifest=${manifestRel}`]);
  ev('i — importador: DONE verificado, DONE sem prova (BLOCKED), READY, SUPERSEDED, DRAFT',
    `$ node scripts/track.mjs import demo --manifest=${manifestRel}\n$ exit ${r.code}\n${r.all}`);
  assert.equal(r.code, 0, r.all);

  const linhas = fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/LEDGER.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const porId = Object.fromEntries(linhas.map((l) => [l.goal, l]));

  // 1) DONE verificado
  assert.equal(porId['demo-001'].result, 'DONE');
  assert.equal(porId['demo-001'].source, 'importado');
  assert.equal(porId['demo-001'].bootstrap_commit, bootstrap);
  assert.equal(porId['demo-001'].head_commit, shaBom);
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/_closed/goals/demo-001.md')), true);

  // 2) DONE com commit inexistente → BLOCKED divergencia, NUNCA presumido DONE
  assert.equal(porId['demo-002'].result, 'BLOCKED');
  assert.equal(porId['demo-002'].blocked_by, 'divergencia');
  assert.match(porId['demo-002'].evidencia.cmd, /git cat-file -e f{40}\^\{commit\}/);

  // 3) READY → goals/
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/goals/demo-003.md')), true);
  assert.equal(porId['demo-003'], undefined, 'READY não gera linha de ledger');

  // 4) DONE fora da branch declarada → BLOCKED divergencia
  assert.equal(porId['demo-004'].result, 'BLOCKED');
  assert.equal(porId['demo-004'].blocked_by, 'divergencia');
  assert.match(porId['demo-004'].evidencia.cmd, /merge-base --is-ancestor/);

  // 5) SUPERSEDED
  assert.equal(porId['demo-005'].result, 'SUPERSEDED');
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/_closed/goals/demo-005.md')), true);
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/goals/demo-005.md')), false);

  // 6) no manifesto mas não no plano → BLOCKED decisao
  assert.equal(porId['demo-006'].result, 'BLOCKED');
  assert.equal(porId['demo-006'].blocked_by, 'decisao');

  // 7) no plano mas não no manifesto → DRAFT / pendência, fora de goals/
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/goals/demo-007.md')), false);

  const rec = fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/_closed/reports/RECONCILIACAO.md'), 'utf8');
  ev('i — RECONCILIACAO.md gerado pelo importador',
    `$ cat docs/execution-tracks/demo/_closed/reports/RECONCILIACAO.md\n${rec}\n`);
  ev('i — LEDGER.jsonl após a importação',
    `$ cat docs/execution-tracks/demo/LEDGER.jsonl\n${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`);
  assert.match(rec, /## 1\. Confirmados/);
  assert.match(rec, /## 2\. Divergentes/);
  assert.match(rec, /## 3\. Pendentes de planejamento/);
  assert.match(rec, /demo-007/);
  assert.match(rec, new RegExp(shaBom));

  // proveniência do manifesto
  assert.equal(fs.existsSync(path.join(repo, 'docs/execution-tracks/demo/_closed/reports/IMPORT-1-MANIFEST.json')), true);
  // o import/ bruto é gitignored e não entra no commit
  assert.equal(g(repo, 'ls-files', '--', 'import').out.trim(), '');
  // commit de estado só dentro de docs/execution-tracks/
  const tocados = g(repo, 'show', '--name-only', '--format=', 'HEAD').out.split('\n').filter(Boolean);
  assert.equal(tocados.every((p) => p.startsWith('docs/execution-tracks/') || p.startsWith('docs/ai-execution/')), true, tocados.join(' '));
  assert.equal(g(repo, 'log', '--format=%s', '-1').out.trim(), 'aep(demo): import 1 (plan_rev 3)');

  const st = JSON.parse(fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/state.json'), 'utf8'));
  assert.equal(st.bootstrap_commit, bootstrap);
  assert.equal(st.current_goal, 'demo-003');
  assert.equal(st.counters.goals_imported, linhas.length);
  assert.equal(aep(repo, ['verify', '--all']).code, 0);
  assert.equal(g(repo, 'status', '--porcelain').out.trim(), '');
});

test('importador mantém no máximo 3 GOALs no caminho quente e reporta o excedente', (t) => {
  const { repo, name } = makeRepo(t);
  initTrack(repo);
  const bootstrap = g(repo, 'rev-parse', 'HEAD').out.trim();
  const ids = ['demo-001', 'demo-002', 'demo-003', 'demo-004', 'demo-005'];
  const manifest = {
    aep: '1.0-R2',
    track: 'demo',
    plan_ref: 'docs/planos/PLANO_DEMO.md',
    plan_rev: 1,
    risk_tier: 'BAIXO',
    branch_pattern: 'goal/demo-<nnn>',
    test_command: 'node scripts/goal-test.mjs',
    paths_base: ['app/**'],
    gates_extra: [],
    bootstrap_commit: bootstrap,
    fontes: ['docs/planos/PLANO_DEMO.md'],
    plano_ids: ids,
    goals_declarados: ids.map((id) => ({ id, situacao: 'READY', title: id, worktree: name })),
  };
  w(repo, 'import/demo/MANIFEST.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const r = aep(repo, ['import', 'demo', '--manifest=import/demo/MANIFEST.json']);
  assert.equal(r.code, 0, r.all);
  const quentes = fs.readdirSync(path.join(repo, 'docs/execution-tracks/demo/goals')).filter((f) => f.endsWith('.md'));
  assert.equal(quentes.length, 3);
  const rec = fs.readFileSync(path.join(repo, 'docs/execution-tracks/demo/_closed/reports/RECONCILIACAO.md'), 'utf8');
  assert.match(rec, /demo-004.*READY além do teto de 3/);
  assert.match(rec, /demo-005.*READY além do teto de 3/);
  assert.equal(aep(repo, ['verify', '--all']).code, 0);
});

test('importador recusa manifesto com path fora da gramática (exit 1)', (t) => {
  const { repo } = makeRepo(t);
  initTrack(repo);
  const manifest = {
    aep: '1.0-R2', track: 'demo', plan_ref: 'p.md', plan_rev: 1, risk_tier: 'BAIXO',
    branch_pattern: 'goal/demo-<nnn>', test_command: 'node scripts/goal-test.mjs',
    paths_base: ['app/**/*.ts'], gates_extra: [], bootstrap_commit: 'x',
    fontes: [], goals_declarados: [],
  };
  w(repo, 'import/demo/MANIFEST.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const r = aep(repo, ['import', 'demo', '--manifest=import/demo/MANIFEST.json']);
  assert.equal(r.code, 1);
  assert.match(r.all, /Glob não suportado/);
});
