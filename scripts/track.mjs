#!/usr/bin/env node
/**
 * AEP/1.0-R2 — Agent Execution Protocol
 *
 * Núcleo agnóstico de executor: Git + Node + arquivos estruturados.
 * ZERO dependências externas. Roda sem `npm install`, em Linux e em Git for Windows.
 *
 * LIMITE HONESTO — leia antes de confiar neste arquivo:
 * este script e os hooks em .githooks/ são proteção LOCAL contra ACIDENTE e contra
 * desvio de um agente COOPERATIVO. NÃO são barreira contra um executor deliberadamente
 * não cooperativo, que pode usar `git commit --no-verify`, definir `AEP_WRITE=1`,
 * reapontar `core.hooksPath`, usar `--amend` ou manipular `.git` diretamente.
 * Isso é propriedade do Git, não defeito do protocolo. A ratificação só vira garantia
 * com a camada remota (PR obrigatório + CI rodando `verify --all` + branch protection).
 * Ver docs/ai-execution/EXECUTION_PROTOCOL.md § MODELO DE SEGURANÇA.
 *
 * REGRA DE OURO DO CICLO DE ESTADO:
 *   status, open, check e `attempt --fail` NÃO escrevem nenhum arquivo versionado.
 *   Somente close, block, import, registry, init e sync-adapters escrevem.
 *   open escreve apenas .aep-active (gitignored).
 *   state.json representa exclusivamente o ÚLTIMO ESTADO RATIFICADO.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const AEP_VERSION = '1.0-R2';
export const AEP_LABEL = `AEP/${AEP_VERSION}`;

const PROTOCOL_REL = 'docs/ai-execution/protocol.json';
const DEFAULT_TRACKS_DIR = 'docs/execution-tracks';
const ACTIVE_FILE = '.aep-active';
const BLOCK_BEGIN = '<!-- AEP:BEGIN -->';
const BLOCK_END = '<!-- AEP:END -->';

// ---------------------------------------------------------------------------
// Erros — formato de saída sempre em TRÊS linhas.
// ---------------------------------------------------------------------------

export class AepError extends Error {
  constructor(code, categoria, evidenciaCmd, evidenciaOut, acao) {
    super(`${categoria}: ${acao}`);
    this.code = code;
    this.categoria = categoria;
    this.evidenciaCmd = evidenciaCmd;
    this.evidenciaOut = evidenciaOut;
    this.acao = acao;
  }
}

function fail(code, categoria, evidenciaCmd, evidenciaOut, acao) {
  throw new AepError(code, categoria, evidenciaCmd, evidenciaOut, acao);
}

function oneLine(value) {
  let s = String(value ?? '').replace(/\r/g, '').trim();
  s = s.split('\n').map((l) => l.trim()).filter(Boolean).join(' | ');
  if (!s) s = '(sem saída)';
  return s.length > 500 ? `${s.slice(0, 497)}...` : s;
}

function printFail(err) {
  process.stderr.write(`FALHA [${err.code}] ${err.categoria}\n`);
  process.stderr.write(`  evidência: ${err.evidenciaCmd} → ${oneLine(err.evidenciaOut)}\n`);
  process.stderr.write(`  ação: ${err.acao}\n`);
}

// ---------------------------------------------------------------------------
// Processo / Git
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    encoding: 'utf8',
    shell: opts.shell === true,
    env: opts.env || process.env,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: r.status === null || r.status === undefined ? 1 : r.status,
    stdout: (r.stdout || '').replace(/\r\n/g, '\n'),
    stderr: (r.stderr || '').replace(/\r\n/g, '\n'),
    error: r.error,
  };
}

function git(args, opts = {}) {
  const r = run('git', args, opts);
  r.cmd = `git ${args.join(' ')}`;
  return r;
}

/** git que lista caminhos: desliga quotepath para não escapar acentos. */
function gitPaths(args, opts = {}) {
  const r = git(['-c', 'core.quotepath=false', ...args], opts);
  r.lines = r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  return r;
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function repoRoot(cwd = process.cwd()) {
  const r = git(['rev-parse', '--show-toplevel'], { cwd });
  if (r.code !== 0) {
    fail(5, 'pré-condição de ambiente', r.cmd, r.stderr || r.stdout,
      'Execute o comando de dentro de um repositório Git.');
  }
  return toPosix(r.stdout.trim());
}

function currentBranch(root) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  return r.code === 0 ? r.stdout.trim() : '';
}

// ---------------------------------------------------------------------------
// Protocolo
// ---------------------------------------------------------------------------

function readJson(file, acaoSeInvalido) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(1, 'metadado inválido', `cat ${toPosix(file)}`, e.message, acaoSeInvalido);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(1, 'metadado inválido', `node -e "JSON.parse(fs.readFileSync('${toPosix(file)}'))"`,
      e.message, acaoSeInvalido);
  }
  return null;
}

export function loadProtocol(root) {
  const file = path.join(root, PROTOCOL_REL);
  if (!fs.existsSync(file)) {
    fail(5, 'pré-condição de ambiente', `ls ${PROTOCOL_REL}`, 'arquivo ausente',
      `Rode o bootstrap do AEP: ${PROTOCOL_REL} é obrigatório.`);
  }
  const p = readJson(file, `Corrija ${PROTOCOL_REL}: deve ser JSON válido.`);
  if (p.aep !== AEP_VERSION) {
    fail(1, 'metadado inválido', `cat ${PROTOCOL_REL}`, `aep=${p.aep}`,
      `Este track.mjs implementa ${AEP_LABEL}. Alinhe protocol.json.aep.`);
  }
  p.tracks_dir = p.tracks_dir || DEFAULT_TRACKS_DIR;
  p.gates = Array.isArray(p.gates) ? p.gates : [];
  p.tracks = p.tracks && typeof p.tracks === 'object' ? p.tracks : {};
  p.max_attempts = Number(p.max_attempts) > 0 ? Number(p.max_attempts) : 3;
  p.max_hot_goals = Number(p.max_hot_goals) > 0 ? Number(p.max_hot_goals) : 3;
  for (const g of p.gates) {
    for (const pat of g.paths || []) assertPattern(pat, `protocol.json gates[${g.id}].paths`);
  }
  return p;
}

/** Fallback tolerante: usado pelos hooks, que precisam funcionar mesmo sem protocol.json. */
function loadProtocolSoft(root) {
  try {
    return loadProtocol(root);
  } catch {
    return { aep: AEP_VERSION, tracks_dir: DEFAULT_TRACKS_DIR, gates: [], tracks: {}, max_attempts: 3, max_hot_goals: 3 };
  }
}

function tracksRoot(root, protocol) {
  return path.join(root, protocol.tracks_dir);
}

function trackDir(root, protocol, track) {
  const entry = protocol.tracks[track];
  const sub = entry && entry.dir ? entry.dir : track;
  return path.join(tracksRoot(root, protocol), sub);
}

function trackRel(protocol, track, ...rest) {
  const entry = protocol.tracks[track];
  const sub = entry && entry.dir ? entry.dir : track;
  return [protocol.tracks_dir, sub, ...rest].join('/');
}

function requireTrack(root, protocol, track) {
  if (!track) {
    fail(1, 'erro de uso', 'node scripts/track.mjs <comando> <trilha>', 'trilha ausente',
      `Informe a trilha. Disponíveis: ${Object.keys(protocol.tracks).join(', ') || '(nenhuma)'}`);
  }
  const dir = trackDir(root, protocol, track);
  if (!fs.existsSync(dir)) {
    fail(1, 'erro de uso', `ls ${trackRel(protocol, track)}`, 'diretório ausente',
      `Trilha "${track}" não existe. Crie com: node scripts/track.mjs init ${track}`);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Gramática de caminhos — DUAS FORMAS APENAS
//   "a/b/c/arquivo.ts" → igualdade exata
//   "a/b/c/**"         → prefixo "a/b/c/"
// Sem `*` isolado, sem `?`, sem chaves, sem negação.
// ---------------------------------------------------------------------------

const GRAMMAR_HINT = 'Use apenas "a/b/c/arquivo.ext" (igualdade exata) ou "a/b/c/**" (prefixo).';

export function assertPattern(pattern, where) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    fail(1, 'metadado inválido', where, JSON.stringify(pattern),
      `Padrão de caminho deve ser string não vazia. ${GRAMMAR_HINT}`);
  }
  if (pattern.includes('\\')) {
    fail(1, 'metadado inválido', where, pattern,
      `Use barra normal "/" em caminhos. ${GRAMMAR_HINT}`);
  }
  const body = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
  if (/[*?[\]{}!]/.test(body)) {
    fail(1, 'metadado inválido', where, pattern,
      `Glob não suportado neste protocolo. ${GRAMMAR_HINT}`);
  }
  if (body.length === 0) {
    fail(1, 'metadado inválido', where, pattern,
      `Prefixo vazio não é permitido. ${GRAMMAR_HINT}`);
  }
  return pattern;
}

export function matchPattern(pattern, p) {
  if (pattern.endsWith('/**')) return p.startsWith(pattern.slice(0, -2));
  return p === pattern;
}

export function matchAny(patterns, p) {
  return (patterns || []).some((pat) => matchPattern(pat, p));
}

/** Pathspec Git equivalente (para `git log -- ...`). */
function toPathspec(pattern) {
  return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regras ESTRUTURAIS do protocolo (não são padrões fornecidos por usuário e por isso
 * não passam pela gramática limitada).
 */
function structuralRules(protocol) {
  const td = escapeRe(protocol.tracks_dir);
  return {
    goalsHot: new RegExp(`^${td}/[^/]+/goals/`),
    immutable: new RegExp(`^${td}/[^/]+/(state\\.json|LEDGER\\.jsonl)$`),
    registry: `${protocol.tracks_dir}/REGISTRY.md`,
  };
}

function isImmutablePath(p, rules) {
  return rules.immutable.test(p) || p === rules.registry;
}

// ---------------------------------------------------------------------------
// Blocos delimitados — sem YAML, sem parser artesanal.
// ---------------------------------------------------------------------------

export function extractBlock(text, tag, fileLabel) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const open = `<!-- ${tag}`;
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === open) hits.push(i);
  }
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    fail(1, 'metadado inválido', `grep -n "${open}" ${fileLabel}`,
      `linhas ${hits.map((i) => i + 1).join(', ')}`,
      `O arquivo deve conter EXATAMENTE UMA linha "${open}". Remova as duplicadas.`);
  }
  const start = hits[0];
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '-->') { end = i; break; }
  }
  if (end === -1) {
    fail(1, 'metadado inválido', `sed -n '${start + 1}p' ${fileLabel}`,
      `bloco aberto na linha ${start + 1} sem "-->"`,
      `Feche o bloco ${tag} com uma linha contendo apenas "-->".`);
  }
  const inner = lines.slice(start + 1, end).join('\n');
  try {
    return JSON.parse(inner);
  } catch (e) {
    fail(1, 'metadado inválido', `sed -n '${start + 2},${end}p' ${fileLabel}`,
      e.message,
      `O miolo do bloco ${tag} (linhas ${start + 2}–${end}) deve ser JSON válido.`);
  }
  return null;
}

const REQUIRED_META = ['aep', 'id', 'track', 'title', 'status', 'class', 'branch',
  'worktree', 'test_command', 'allowlist', 'gates_liberados', 'read_budget'];

export function readGoalMeta(file, protocol) {
  const label = toPosix(file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(1, 'metadado inválido', `cat ${label}`, e.message, 'Arquivo de GOAL ilegível.');
  }
  const meta = extractBlock(text, 'AEP:META', label);
  if (meta === null) {
    fail(1, 'metadado inválido', `grep -n "<!-- AEP:META" ${label}`, 'nenhuma ocorrência',
      'Todo arquivo de GOAL precisa de um bloco <!-- AEP:META ... --> com JSON.');
  }
  for (const key of REQUIRED_META) {
    if (meta[key] === undefined || meta[key] === null) {
      fail(1, 'metadado inválido', `grep -n "${key}" ${label}`, 'campo ausente',
        `O bloco AEP:META precisa do campo "${key}".`);
    }
  }
  if (meta.aep !== AEP_VERSION) {
    fail(1, 'metadado inválido', `grep -n '"aep"' ${label}`, `aep=${meta.aep}`,
      `Este GOAL declara outra versão. Esperado "${AEP_VERSION}".`);
  }
  if (!Array.isArray(meta.allowlist) || meta.allowlist.length === 0) {
    fail(1, 'metadado inválido', `grep -n '"allowlist"' ${label}`, JSON.stringify(meta.allowlist),
      'allowlist deve ser um array não vazio de padrões.');
  }
  meta.allowlist.forEach((pat) => assertPattern(pat, `${label} allowlist`));
  if (!Array.isArray(meta.gates_liberados)) {
    fail(1, 'metadado inválido', `grep -n '"gates_liberados"' ${label}`,
      JSON.stringify(meta.gates_liberados), 'gates_liberados deve ser um array (pode ser vazio).');
  }
  if (protocol) {
    const known = new Set(protocol.gates.map((g) => g.id));
    for (const id of meta.gates_liberados) {
      if (!known.has(id)) {
        fail(1, 'metadado inválido', `grep -n '"${id}"' ${label}`, 'gate desconhecido',
          `Gate "${id}" não existe em ${PROTOCOL_REL}.`);
      }
    }
  }
  meta.__file = label;
  return meta;
}

// ---------------------------------------------------------------------------
// Ledger, GOALs e estado derivado
// ---------------------------------------------------------------------------

function readLedger(dir, relLabel) {
  const file = path.join(dir, 'LEDGER.jsonl');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const out = [];
  raw.split('\n').forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      fail(1, 'metadado inválido', `sed -n '${idx + 1}p' ${relLabel}/LEDGER.jsonl`, e.message,
        'Cada linha do LEDGER.jsonl deve ser um JSON válido em uma única linha.');
    }
  });
  return out;
}

function listGoalFiles(dir) {
  const g = path.join(dir, 'goals');
  if (!fs.existsSync(g)) return [];
  return fs.readdirSync(g)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(g, f));
}

function listClosedGoalFiles(dir) {
  const g = path.join(dir, '_closed', 'goals');
  if (!fs.existsSync(g)) return [];
  return fs.readdirSync(g).filter((f) => f.endsWith('.md')).sort();
}

function readTrackCompletion(dir) {
  const file = path.join(dir, 'TRACK.md');
  if (!fs.existsSync(file)) return 'PAUSED';
  const block = extractBlock(fs.readFileSync(file, 'utf8'), 'AEP:TRACK', toPosix(file));
  const v = block && block.completion_when_empty;
  return v === 'DONE' ? 'DONE' : 'PAUSED';
}

/** GOALs elegíveis: status READY, ordenados por id. */
function eligibleGoals(dir, protocol) {
  return listGoalFiles(dir)
    .map((f) => readGoalMeta(f, protocol))
    .filter((m) => m.status === 'READY')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Estado derivado — 100% função de protocol.json + LEDGER.jsonl + goals/ +
 * _closed/goals/ + TRACK.md. Nenhum campo não derivável (por isso `verify` funciona).
 */
export function deriveState(root, protocol, track) {
  const dir = trackDir(root, protocol, track);
  const rel = trackRel(protocol, track);
  const ledger = readLedger(dir, rel);
  const goals = eligibleGoals(dir, protocol);
  const closed = listClosedGoalFiles(dir);
  const cfg = protocol.tracks[track] || {};
  const last = ledger.length ? ledger[ledger.length - 1] : null;

  let status;
  if (ledger.length === 0 && goals.length === 0 && closed.length === 0) status = 'PLANNED';
  else if (goals.length > 0) status = 'RUNNING';
  else if (last && last.result === 'BLOCKED') status = 'BLOCKED';
  else status = readTrackCompletion(dir);

  let bootstrap = null;
  for (const line of ledger) if (line.bootstrap_commit) bootstrap = line.bootstrap_commit;

  return {
    aep: AEP_VERSION,
    track,
    status,
    risk_tier: cfg.risk_tier || 'MEDIO',
    current_goal: goals[0] ? goals[0].id : null,
    next_goal: goals[1] ? goals[1].id : null,
    bootstrap_commit: bootstrap,
    counters: {
      goals_done: ledger.filter((l) => l.result === 'DONE').length,
      goals_blocked: ledger.filter((l) => l.result === 'BLOCKED').length,
      goals_imported: ledger.filter((l) => l.source === 'importado').length,
      ledger_lines: ledger.length,
    },
    last_goal: last ? last.goal : null,
    last_result: last ? last.result : null,
    last_ratified_at: last ? last.ts : null,
  };
}

function canonicalJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function writeState(root, protocol, track) {
  const derived = deriveState(root, protocol, track);
  fs.writeFileSync(path.join(trackDir(root, protocol, track), 'state.json'), canonicalJson(derived));
  return derived;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// REGISTRY.md e GATES.md — gerados
// ---------------------------------------------------------------------------

const SEMAFORO = {
  RUNNING: '🟢 verde',
  PLANNED: '🟡 amarelo',
  PAUSED: '🟡 amarelo',
  BLOCKED: '🔴 vermelho',
  DONE: '⚫ concluída',
};

function renderRegistry(root, protocol) {
  const names = Object.keys(protocol.tracks).sort();
  const out = [];
  out.push('<!-- GERADO por `node scripts/track.mjs registry`. Não edite à mão. -->');
  out.push('');
  out.push(`# Registro de trilhas — ${AEP_LABEL}`);
  out.push('');
  out.push('Semáforo: 🟢 rodando · 🟡 esperando humano · 🔴 bloqueado ou check falhando · ⚫ concluída.');
  out.push('');
  out.push('| Trilha | Semáforo | Status | Risco | GOAL atual | Próximo | DONE | BLOCKED | Última ratificação |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  if (names.length === 0) {
    out.push('| _(nenhuma trilha registrada)_ | — | — | — | — | — | — | — | — |');
  }
  for (const name of names) {
    const s = deriveState(root, protocol, name);
    out.push(`| ${name} | ${SEMAFORO[s.status] || s.status} | ${s.status} | ${s.risk_tier} | ${s.current_goal || '—'} | ${s.next_goal || '—'} | ${s.counters.goals_done} | ${s.counters.goals_blocked} | ${s.last_ratified_at || '—'} |`);
  }
  out.push('');
  return `${out.join('\n')}`;
}

function renderGates(protocol) {
  const out = [];
  out.push('<!-- GERADO por `node scripts/track.mjs registry` a partir de docs/ai-execution/protocol.json. Não edite à mão. -->');
  out.push('');
  out.push(`# Gates universais — ${AEP_LABEL}`);
  out.push('');
  out.push('Gate de CAMINHO: se um caminho staged casar com o gate e o id do gate **não** estiver');
  out.push('em `gates_liberados` do GOAL ativo, o commit é recusado (exit 2).');
  out.push('');
  out.push('Não existe gate por conteúdo do diff. Varredura de conteúdo, quando existir, é');
  out.push('**AVISO HEURÍSTICO** e nunca gate — não crie confiança falsa nela.');
  out.push('');
  out.push('| Gate | Tipo | Autorização | Caminhos | Motivo |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const g of protocol.gates) {
    out.push(`| \`${g.id}\` | ${g.tipo || 'caminho'} | ${g.autorizacao || 'humana explícita'} | ${(g.paths || []).map((p) => `\`${p}\``).join('<br>')} | ${g.motivo || ''} |`);
  }
  out.push('');
  out.push('## Gramática de caminhos');
  out.push('');
  out.push('Duas formas apenas: `a/b/c/arquivo.ext` (igualdade exata) e `a/b/c/**` (prefixo).');
  out.push('Qualquer outra forma falha na leitura do GOAL, com exit 1, antes de qualquer execução.');
  out.push('');
  return out.join('\n');
}

function writeGenerated(root, protocol) {
  const registryFile = path.join(tracksRoot(root, protocol), 'REGISTRY.md');
  const gatesFile = path.join(root, 'docs/ai-execution/GATES.md');
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  fs.mkdirSync(path.dirname(gatesFile), { recursive: true });
  fs.writeFileSync(registryFile, renderRegistry(root, protocol));
  fs.writeFileSync(gatesFile, renderGates(protocol));
  return {
    registry: `${protocol.tracks_dir}/REGISTRY.md`,
    gates: 'docs/ai-execution/GATES.md',
  };
}

// ---------------------------------------------------------------------------
// .aep-active (gitignored)
// ---------------------------------------------------------------------------

function activePath(root) {
  return path.join(root, ACTIVE_FILE);
}

function readActive(root) {
  const f = activePath(root);
  if (!fs.existsSync(f)) return null;
  return readJson(f, `Remova ${ACTIVE_FILE} corrompido e rode "open" de novo.`);
}

function writeActive(root, active) {
  fs.writeFileSync(activePath(root), canonicalJson(active));
}

function removeActive(root) {
  const f = activePath(root);
  if (fs.existsSync(f)) fs.rmSync(f);
}

function requireActive(root, track) {
  const a = readActive(root);
  if (!a) {
    fail(5, 'pré-condição de ambiente', `ls ${ACTIVE_FILE}`, 'arquivo ausente',
      `Nenhum GOAL aberto nesta worktree. Rode: node scripts/track.mjs open ${track}`);
  }
  if (track && a.track !== track) {
    fail(5, 'pré-condição de ambiente', `cat ${ACTIVE_FILE}`, `track=${a.track}`,
      `O GOAL aberto pertence à trilha "${a.track}", não a "${track}".`);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Branch default e worktree
// ---------------------------------------------------------------------------

/**
 * A branch default é DECLARADA em protocol.json.default_branch. Isso é deliberado:
 * `refs/remotes/origin/HEAD` local fica obsoleto com frequência e produz falso positivo.
 * O `doctor` confronta a declaração com `git ls-remote --symref origin HEAD`.
 */
function defaultBranch(protocol) {
  return protocol.default_branch || 'main';
}

function worktreeMatches(root, declared) {
  if (!declared || declared === '<PREENCHER>') return false;
  const d = toPosix(declared);
  const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s).replace(/\/+$/, '');
  if (d.includes('/') || d.includes(':')) {
    return norm(toPosix(path.resolve(d))) === norm(root);
  }
  return norm(path.basename(root)) === norm(d);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function dispatch(cmd, positional, flags) {
  if (cmd === 'hook') return cmdHook(positional[0], positional[1]);
  const root = repoRoot();
  if (cmd === 'doctor') return cmdDoctor(root);
  if (cmd === 'sync-adapters') return cmdSyncAdapters(root, flags);
  if (cmd === 'init') return cmdInit(root, positional[0], flags);
  const protocol = loadProtocol(root);
  if (cmd === 'registry') return cmdRegistry(root, protocol);
  if (cmd === 'verify') return cmdVerify(root, protocol, positional[0], flags);
  if (cmd === 'import') return cmdImport(root, protocol, positional[0], flags);
  if (cmd === 'status') return cmdStatus(root, protocol, positional[0], flags);
  if (cmd === 'open') return cmdOpen(root, protocol, positional[0]);
  if (cmd === 'check') return cmdCheck(root, protocol, positional[0]);
  if (cmd === 'close') return cmdClose(root, protocol, positional[0]);
  if (cmd === 'attempt') return cmdAttempt(root, protocol, positional[0], flags);
  if (cmd === 'block') return cmdBlock(root, protocol, positional[0], flags);
  return 1;
}

// ---------------------------------------------------------------------------
// status — SOMENTE LEITURA. Máximo 18 linhas.
// ---------------------------------------------------------------------------

function cmdStatus(root, protocol, track, flags) {
  requireTrack(root, protocol, track);
  const dir = trackDir(root, protocol, track);
  const rel = trackRel(protocol, track);
  const derived = deriveState(root, protocol, track);
  const ledger = readLedger(dir, rel);
  const tail = ledger.slice(-3);
  const active = readActive(root);
  const branch = currentBranch(root);
  const dirty = gitPaths(['status', '--porcelain'], { cwd: root }).lines.length;

  if (flags.json) {
    process.stdout.write(canonicalJson({
      ...derived,
      branch_atual: branch,
      arvore_suja: dirty > 0,
      aep_active: active ? { goal: active.goal, attempt: active.attempt } : null,
      ledger_tail: tail,
    }));
    return 0;
  }

  const lines = [];
  lines.push(`${AEP_LABEL} · trilha ${track} · ${SEMAFORO[derived.status] || ''} ${derived.status}`);
  lines.push(`risco ${derived.risk_tier} · GOAL atual ${derived.current_goal || '—'} · próximo ${derived.next_goal || '—'}`);
  lines.push(`ratificados: ${derived.counters.goals_done} DONE · ${derived.counters.goals_blocked} BLOCKED · ${derived.counters.ledger_lines} linhas de ledger`);
  lines.push(`bootstrap_commit: ${derived.bootstrap_commit || '(nenhum)'} · última ratificação: ${derived.last_ratified_at || '—'}`);
  lines.push(`git: branch ${branch || '?'} · árvore ${dirty ? `${dirty} caminho(s) sujo(s)` : 'limpa'}`);
  lines.push(active
    ? `sessão: GOAL ${active.goal} ABERTO (tentativa ${active.attempt}/${active.max_attempts}) — ${ACTIVE_FILE} presente`
    : `sessão: nenhum GOAL aberto nesta worktree (${ACTIVE_FILE} ausente)`);
  lines.push('');
  lines.push(`ledger (últimas ${tail.length}):`);
  if (tail.length === 0) lines.push('  (vazio)');
  for (const l of tail) {
    lines.push(`  ${l.ts || '?'} ${l.goal || '?'} → ${l.result}${l.blocked_by ? ` (${l.blocked_by})` : ''}${l.source === 'importado' ? ' [importado]' : ''}`);
  }
  lines.push('');
  lines.push(derived.current_goal
    ? `próximo passo: node scripts/track.mjs open ${track}`
    : `próximo passo: nenhum GOAL elegível em ${rel}/goals/ — planejamento humano.`);
  process.stdout.write(`${lines.slice(0, 18).join('\n')}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// open — escreve SOMENTE .aep-active
// ---------------------------------------------------------------------------

function cmdOpen(root, protocol, track) {
  requireTrack(root, protocol, track);
  const dir = trackDir(root, protocol, track);
  const existing = readActive(root);
  const goals = eligibleGoals(dir, protocol);
  if (goals.length === 0) {
    fail(1, 'erro de uso', `ls ${trackRel(protocol, track)}/goals/`, 'nenhum GOAL com status READY',
      'Não há GOAL elegível. Planejamento é humano — nada a abrir.');
  }
  const meta = goals[0];

  if (existing && existing.goal !== meta.id) {
    fail(5, 'pré-condição de ambiente', `cat ${ACTIVE_FILE}`, `goal=${existing.goal}`,
      `Já existe GOAL aberto. Feche com "close" ou registre com "block" antes de abrir ${meta.id}.`);
  }

  const branch = currentBranch(root);
  if (branch !== meta.branch) {
    fail(5, 'pré-condição de ambiente', 'git rev-parse --abbrev-ref HEAD',
      `${branch} (GOAL exige ${meta.branch})`,
      `Troque de branch VOCÊ MESMO. O AEP nunca executa checkout/switch/stash/reset.`);
  }
  if (!worktreeMatches(root, meta.worktree)) {
    fail(5, 'pré-condição de ambiente', 'git rev-parse --show-toplevel',
      `${root} (GOAL exige ${meta.worktree})`,
      'Abra o GOAL na worktree declarada no bloco AEP:META. Uma trilha = uma branch = uma worktree.');
  }

  const def = defaultBranch(protocol);
  const mb = git(['merge-base', 'HEAD', `origin/${def}`], { cwd: root });
  if (mb.code !== 0) {
    fail(5, 'pré-condição de ambiente', mb.cmd, mb.stderr || mb.stdout,
      `Rode "git fetch origin" — origin/${def} precisa existir localmente.`);
  }
  const base = mb.stdout.trim();

  const active = existing || {
    aep: AEP_VERSION,
    track,
    goal: meta.id,
    goal_file: toPosix(path.relative(root, meta.__file)),
    goal_file_abs: toPosix(meta.__file),
    branch: meta.branch,
    worktree: root,
    base_commit: base,
    default_branch: def,
    attempt: 1,
    max_attempts: protocol.max_attempts,
    allowlist: meta.allowlist,
    gates_liberados: meta.gates_liberados,
    test_command: meta.test_command,
    read_budget: meta.read_budget,
    classe: meta.class,
    opened_at: new Date().toISOString(),
    attempts_log: [],
  };
  active.base_commit = base;
  writeActive(root, active);

  const gatesRelevantes = protocol.gates
    .filter((g) => (meta.allowlist || []).some((a) => (g.paths || []).some((gp) => overlaps(a, gp))))
    .map((g) => g.id);

  const out = [];
  out.push(`${AEP_LABEL} · open ${track} · GOAL ${meta.id} — ${meta.title}`);
  out.push('');
  out.push('LEIA EXATAMENTE UM ARQUIVO DE GOAL:');
  out.push(`  ${toPosix(meta.__file)}`);
  out.push('');
  out.push(`branch:        ${meta.branch}   (atual: ${branch})`);
  out.push(`worktree:      ${root}`);
  out.push(`base_commit:   ${base}   (git merge-base HEAD origin/${def})`);
  out.push(`tentativa:     ${active.attempt}/${active.max_attempts}`);
  out.push(`teste do GOAL: ${meta.test_command}`);
  out.push(`orçamento de leitura declarado: ${meta.read_budget} arquivo(s)`);
  out.push('');
  out.push('allowlist (única superfície de escrita permitida):');
  for (const a of meta.allowlist) out.push(`  ${a}`);
  out.push('gates liberados por este GOAL:');
  if (meta.gates_liberados.length === 0) out.push('  (nenhum)');
  for (const g of meta.gates_liberados) out.push(`  ${g}`);
  if (gatesRelevantes.filter((g) => !meta.gates_liberados.includes(g)).length) {
    out.push('gates que tocam esta superfície e NÃO estão liberados:');
    for (const g of gatesRelevantes.filter((x) => !meta.gates_liberados.includes(x))) out.push(`  ${g} → pare e peça autorização humana`);
  }
  out.push('');
  out.push('CLASSIFICAÇÃO (8 campos — ver docs/ai-execution/TASK_LEVELS.md):');
  out.push(`  1 classe:                 ${meta.class}`);
  out.push(`  2 revisão independente R: ${meta.revisao_independente ? 'SIM' : 'não'}`);
  out.push(`  3 família do executor:    ${meta.familia_executor || '(não declarada)'}`);
  out.push(`  4 risco:                  ${meta.risk_tier || (protocol.tracks[track] || {}).risk_tier || 'MEDIO'}`);
  out.push(`  5 superfície:             ${meta.allowlist.length} padrão(ões) de caminho`);
  out.push(`  6 reversibilidade:        ${meta.reversibilidade || '(não declarada)'}`);
  out.push(`  7 gates envolvidos:       ${gatesRelevantes.length ? gatesRelevantes.join(', ') : '(nenhum)'}`);
  out.push(`  8 orçamento de leitura:   ${meta.read_budget}`);
  out.push('');
  out.push('REGRAS DA SESSÃO:');
  out.push('  · escreva apenas dentro da allowlist acima;');
  out.push('  · adicione por caminho explícito — nunca `git add .`, `git add -A` ou `git commit -a`;');
  out.push('  · mensagem do commit do agente: `goal(<trilha>-<nnn>): ...`;');
  out.push('  · gate não liberado = pare e peça autorização humana, não contorne;');
  out.push(`  · terminou: node scripts/track.mjs close ${track}   (roda check antes de ratificar);`);
  out.push(`  · falhou: node scripts/track.mjs attempt ${track} --fail --reason="..."`);
  out.push('');
  out.push(`${ACTIVE_FILE} escrito (gitignored). Nenhum arquivo versionado foi tocado.`);
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

function overlaps(a, b) {
  const pa = a.endsWith('/**') ? a.slice(0, -2) : a;
  const pb = b.endsWith('/**') ? b.slice(0, -2) : b;
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// ---------------------------------------------------------------------------
// check — SOMENTE LEITURA. 12 itens, nesta ordem.
// ---------------------------------------------------------------------------

function runCheck(root, protocol, track) {
  const active = requireActive(root, track);
  const dir = trackDir(root, protocol, track);
  const rules = structuralRules(protocol);
  const items = [];
  const add = (n, nome, veredito, cmd, saida) => items.push({ n, nome, veredito, cmd, saida });

  // 1 branch
  const branch = currentBranch(root);
  add(1, 'branch atual = branch do GOAL', branch === active.branch ? 'PASS' : 'FAIL',
    'git rev-parse --abbrev-ref HEAD', `${branch} (esperado ${active.branch})`);

  // 2 worktree
  add(2, 'worktree = a registrada no open', toPosix(root) === toPosix(active.worktree) ? 'PASS' : 'FAIL',
    'git rev-parse --show-toplevel', `${root} (esperado ${active.worktree})`);

  // 3 árvore limpa
  const st = gitPaths(['status', '--porcelain'], { cwd: root });
  add(3, 'árvore limpa', st.lines.length === 0 ? 'PASS' : 'FAIL',
    'git status --porcelain', st.lines.length ? st.lines.join(' ') : '(vazio)');

  // 4 HEAD é commit
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root });
  add(4, 'HEAD aponta para um commit', head.code === 0 ? 'PASS' : 'FAIL',
    'git rev-parse --verify HEAD^{commit}', head.code === 0 ? head.stdout.trim() : head.stderr);
  const headSha = head.code === 0 ? head.stdout.trim() : null;

  // 5 base é ancestral da branch
  const anc = git(['merge-base', '--is-ancestor', active.base_commit, active.branch], { cwd: root });
  add(5, 'base_commit é ancestral da branch', anc.code === 0 ? 'PASS' : 'FAIL',
    `git merge-base --is-ancestor ${active.base_commit} ${active.branch}`,
    anc.code === 0 ? 'ancestral confirmado' : (anc.stderr || 'não é ancestral'));

  // 6 caminhos dentro da allowlist
  const diff = gitPaths(['diff', '--name-only', `${active.base_commit}..HEAD`], { cwd: root });
  const changed = diff.lines;
  const fora = changed.filter((p) => !matchAny(active.allowlist, p));
  add(6, 'caminhos do diff dentro da allowlist', fora.length === 0 ? 'PASS' : 'FAIL',
    `git diff --name-only ${active.base_commit}..HEAD`,
    fora.length ? `fora da allowlist: ${fora.join(' ')}` : `${changed.length} caminho(s), todos dentro`);

  // 7 gates de caminho
  const violados = [];
  for (const g of protocol.gates) {
    if ((active.gates_liberados || []).includes(g.id)) continue;
    const hits = changed.filter((p) => matchAny(g.paths || [], p));
    if (hits.length) violados.push(`${g.id}: ${hits.join(' ')}`);
  }
  add(7, 'nenhum gate de caminho não liberado', violados.length === 0 ? 'PASS' : 'FAIL',
    `git diff --name-only ${active.base_commit}..HEAD`,
    violados.length ? violados.join(' | ') : 'nenhum gate tocado');

  // 8 goals/ intocado
  const hotHits = changed.filter((p) => rules.goalsHot.test(p));
  add(8, `${protocol.tracks_dir}/*/goals/** não alterado`, hotHits.length === 0 ? 'PASS' : 'FAIL',
    `git diff --name-only ${active.base_commit}..HEAD`,
    hotHits.length ? hotHits.join(' ') : 'caminho quente intocado');

  // 9 ledger sem deleções
  const ledgerRel = `${trackRel(protocol, track)}/LEDGER.jsonl`;
  const num = git(['diff', '--numstat', `${active.base_commit}..HEAD`, '--', ledgerRel], { cwd: root });
  const delet = num.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => Number(l.split(/\s+/)[1] || 0)).reduce((a, b) => a + b, 0);
  add(9, 'LEDGER.jsonl sem deleções', delet === 0 ? 'PASS' : 'FAIL',
    `git diff --numstat ${active.base_commit}..HEAD -- ${ledgerRel}`,
    delet === 0 ? '0 linha removida' : `${delet} linha(s) removida(s)`);

  // 10 teste do GOAL
  const test = run(active.test_command, [], { cwd: root, shell: true });
  add(10, 'teste do GOAL passa', test.code === 0 ? 'PASS' : 'FAIL',
    active.test_command, test.code === 0 ? 'exit 0' : `exit ${test.code} | ${oneLine(test.stderr || test.stdout)}`);

  // 11 upstream — nunca bloqueia o close
  const def = active.default_branch || defaultBranch(protocol);
  const fetched = git(['fetch', '--quiet', 'origin'], { cwd: root });
  let upstream = 'ok';
  let upEvid = `git fetch origin && git log ${active.base_commit}..origin/${def}`;
  let upOut;
  if (fetched.code !== 0) {
    upstream = 'indeterminado';
    upOut = `git fetch origin falhou → ${oneLine(fetched.stderr || fetched.stdout)}`;
  } else {
    const specs = (active.allowlist || []).map(toPathspec);
    const log = git(['log', '--oneline', `${active.base_commit}..origin/${def}`, '--', ...specs], { cwd: root });
    const commits = log.stdout.split('\n').filter(Boolean);
    upstream = commits.length ? 'rebase_needed' : 'ok';
    upOut = commits.length ? `${commits.length} commit(s) upstream no escopo: ${commits.slice(0, 3).join(' | ')}` : 'sem commits upstream no escopo';
  }
  add(11, `upstream origin/${def} no escopo`,
    upstream === 'ok' ? 'PASS' : 'AVISO', upEvid, `${upstream}: ${upOut}`);

  // 12 próximo GOAL — INFORMATIVO
  const restantes = eligibleGoals(dir, protocol).filter((m) => m.id !== active.goal);
  add(12, 'próximo GOAL elegível (informativo)', 'AVISO',
    `ls ${trackRel(protocol, track)}/goals/`,
    restantes.length ? `próximo: ${restantes[0].id}` : 'nenhum — fechar o último GOAL da trilha é permitido');

  const bloqueantes = items.filter((i) => i.veredito === 'FAIL');
  return {
    active, items, changed, headSha, upstream,
    ok: bloqueantes.length === 0,
    proximo: restantes.length ? restantes[0].id : null,
    gate_pending: upstream !== 'ok',
    testCode: test.code,
  };
}

function printCheck(res, track) {
  const out = [`${AEP_LABEL} · check ${track} · GOAL ${res.active.goal} (tentativa ${res.active.attempt}/${res.active.max_attempts})`, ''];
  for (const i of res.items) {
    out.push(`${String(i.n).padStart(2, ' ')} [${i.veredito.padEnd(5, ' ')}] ${i.nome}`);
    out.push(`      evidência: ${i.cmd} → ${oneLine(i.saida)}`);
  }
  out.push('');
  out.push(res.ok ? 'check: PASSOU — apto a ratificar (close).' : `check: FALHOU em ${res.items.filter((i) => i.veredito === 'FAIL').map((i) => i.n).join(', ')} — nada foi escrito.`);
  process.stdout.write(`${out.join('\n')}\n`);
}

function cmdCheck(root, protocol, track) {
  requireTrack(root, protocol, track);
  const res = runCheck(root, protocol, track);
  printCheck(res, track);
  return res.ok ? 0 : 3;
}

// ---------------------------------------------------------------------------
// Escrita ratificada (ledger / commit de estado)
// ---------------------------------------------------------------------------

function appendLedger(dir, line) {
  const file = path.join(dir, 'LEDGER.jsonl');
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const sep = prev.length && !prev.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${sep}${JSON.stringify(line)}\n`);
}

function stateCommit(root, message, paths) {
  const uniq = [...new Set(paths.filter(Boolean))];
  const addR = git(['add', '--', ...uniq], { cwd: root });
  if (addR.code !== 0) {
    fail(1, 'erro de uso', addR.cmd, addR.stderr || addR.stdout, 'Falha ao adicionar os caminhos de estado.');
  }
  const env = { ...process.env, AEP_WRITE: '1' };
  const c = git(['commit', '-m', message], { cwd: root, env });
  if (c.code !== 0) {
    fail(3, 'verificação falhou', c.cmd, c.stderr || c.stdout,
      'O commit de estado foi recusado. Nada foi ratificado; corrija e repita.');
  }
  const sha = git(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  return sha;
}

function moveGoalToClosed(root, protocol, track, goalId) {
  const dir = trackDir(root, protocol, track);
  const from = path.join(dir, 'goals', `${goalId}.md`);
  const to = path.join(dir, '_closed', 'goals', `${goalId}.md`);
  if (!fs.existsSync(from)) return null;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  return {
    from: `${trackRel(protocol, track)}/goals/${goalId}.md`,
    to: `${trackRel(protocol, track)}/_closed/goals/${goalId}.md`,
  };
}

function setGoalStatus(file, status) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === '<!-- AEP:META');
  const end = lines.findIndex((l, i) => i > start && l.trim() === '-->');
  const meta = JSON.parse(lines.slice(start + 1, end).join('\n'));
  meta.status = status;
  const rendered = JSON.stringify(meta, null, 2).split('\n');
  fs.writeFileSync(file, [...lines.slice(0, start + 1), ...rendered, ...lines.slice(end)].join('\n'));
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

function cmdClose(root, protocol, track) {
  requireTrack(root, protocol, track);
  const res = runCheck(root, protocol, track);
  printCheck(res, track);
  if (!res.ok) {
    process.stdout.write([
      '',
      'close ABORTADO. Nenhum arquivo versionado foi escrito.',
      `${ACTIVE_FILE} PRESERVADO — a sessão continua no mesmo GOAL e na mesma tentativa.`,
      `Corrija os itens FAIL e rode de novo: node scripts/track.mjs close ${track}`,
      `Se a abordagem falhou: node scripts/track.mjs attempt ${track} --fail --reason="..."`,
      '',
      'CONTEXTO: CONTINUE',
      '',
    ].join('\n'));
    return 3;
  }

  const active = res.active;
  const dir = trackDir(root, protocol, track);
  const ts = new Date().toISOString();
  const reportRel = `${trackRel(protocol, track)}/_closed/reports/${active.goal}-a${active.attempt}.md`;

  const line = {
    aep: AEP_VERSION,
    ts,
    track,
    goal: active.goal,
    result: 'DONE',
    attempt: active.attempt,
    source: 'executado',
    branch: active.branch,
    base_commit: active.base_commit,
    head_commit: res.headSha,
    test_command: active.test_command,
    paths: res.changed,
    upstream: res.upstream,
    previous_attempts: active.attempts_log || [],
    report: reportRel,
  };
  appendLedger(dir, line);

  fs.mkdirSync(path.join(dir, '_closed', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, reportRel), [
    `# ${active.goal} — tentativa ${active.attempt}`,
    '',
    `- trilha: \`${track}\``,
    `- resultado: **DONE**`,
    `- ratificado em: ${ts}`,
    `- branch: \`${active.branch}\``,
    `- base_commit: \`${active.base_commit}\``,
    `- head_commit: \`${res.headSha}\``,
    `- teste: \`${active.test_command}\` → exit ${res.testCode}`,
    `- upstream: ${res.upstream}`,
    '',
    '## Caminhos alterados',
    '',
    ...(res.changed.length ? res.changed.map((p) => `- \`${p}\``) : ['- (nenhum)']),
    '',
    '## Tentativas anteriores',
    '',
    ...((active.attempts_log || []).length
      ? active.attempts_log.map((a) => `- tentativa ${a.n} (${a.at}): ${a.reason}`)
      : ['- (nenhuma)']),
    '',
    '## Evidência do check',
    '',
    ...res.items.map((i) => `- [${i.veredito}] ${i.nome} — \`${i.cmd}\` → ${oneLine(i.saida)}`),
    '',
  ].join('\n'));

  const moved = moveGoalToClosed(root, protocol, track, active.goal);
  const derived = writeState(root, protocol, track);
  const gen = writeGenerated(root, protocol);

  const sha = stateCommit(root, `aep(${track}): close ${active.goal}`, [
    `${trackRel(protocol, track)}/LEDGER.jsonl`,
    `${trackRel(protocol, track)}/state.json`,
    reportRel,
    moved ? moved.from : null,
    moved ? moved.to : null,
    gen.registry,
    gen.gates,
  ]);

  removeActive(root);

  const proximo = derived.current_goal;
  let veredito;
  if (!proximo) veredito = 'CLEAR';
  else if ((active.attempts_log || []).length > 0 || derived.risk_tier === 'ALTO' || derived.risk_tier === 'CRITICO') veredito = 'NEW_SESSION';
  else veredito = 'CONTINUE';

  const out = [];
  out.push('');
  out.push(`RATIFICADO · ${AEP_LABEL} · trilha ${track} · GOAL ${active.goal} → DONE`);
  out.push(`commit de estado: ${sha}  (aep(${track}): close ${active.goal})`);
  out.push(`commit do agente: ${res.headSha}`);
  out.push(`ledger: +1 linha em ${trackRel(protocol, track)}/LEDGER.jsonl`);
  out.push(`relatório: ${reportRel}`);
  out.push(`GOAL movido: goals/ → _closed/goals/${active.goal}.md`);
  out.push(`state.json: status ${derived.status} · DONE ${derived.counters.goals_done} · BLOCKED ${derived.counters.goals_blocked}`);
  out.push(`REGISTRY.md e GATES.md regenerados`);
  out.push(`${ACTIVE_FILE} REMOVIDO — a sessão do GOAL terminou.`);
  out.push('');
  out.push(`próximo GOAL: ${proximo || '(nenhum — trilha em ' + derived.status + ')'}`);
  out.push(`next_goal em state.json: ${derived.next_goal || 'null'}`);
  out.push(`upstream no fechamento: ${res.upstream}${res.gate_pending ? ' (gate_pending — avaliar rebase antes do PR)' : ''}`);
  out.push('');
  out.push('Lembrete honesto: esta ratificação é LOCAL. Ela vira garantia apenas com PR');
  out.push('obrigatório + CI rodando `verify --all` + branch protection (camada remota).');
  out.push('Ver docs/ai-execution/EXECUTION_PROTOCOL.md § MODELO DE SEGURANÇA.');
  out.push('');
  out.push(proximo
    ? `siga com: node scripts/track.mjs open ${track}`
    : `nada a abrir. Planejamento humano define os próximos GOALs.`);
  out.push('');
  out.push(`CONTEXTO: ${veredito}`);
  out.push('');
  process.stdout.write(`${out.slice(0, 25).join('\n')}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// attempt / block
// ---------------------------------------------------------------------------

function cmdAttempt(root, protocol, track, flags) {
  requireTrack(root, protocol, track);
  if (!flags.fail) {
    fail(1, 'erro de uso', 'node scripts/track.mjs attempt <trilha> --fail --reason="..."', 'flag --fail ausente',
      'attempt só registra FALHA de tentativa. Sucesso é ratificado por "close".');
  }
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  if (!reason) {
    fail(1, 'erro de uso', 'node scripts/track.mjs attempt <trilha> --fail --reason="..."', '--reason vazio',
      'Descreva por que a tentativa falhou. O motivo entra no ledger se o GOAL for bloqueado.');
  }
  const active = requireActive(root, track);
  active.attempts_log = active.attempts_log || [];
  active.attempts_log.push({ n: active.attempt, at: new Date().toISOString(), reason });

  if (active.attempt >= active.max_attempts) {
    process.stdout.write([
      `${AEP_LABEL} · attempt ${track} · GOAL ${active.goal}`,
      `tentativa ${active.attempt}/${active.max_attempts} falhou — TETO DE TENTATIVAS ESGOTADO.`,
      'Convertendo para BLOCKED (by=externo se não houver causa melhor).',
      '',
    ].join('\n'));
    return blockGoal(root, protocol, track, active, reason, flags.by || 'externo');
  }

  active.attempt += 1;
  writeActive(root, active);
  process.stdout.write([
    `${AEP_LABEL} · attempt ${track} · GOAL ${active.goal}`,
    `falha registrada: ${reason}`,
    `nova tentativa: ${active.attempt}/${active.max_attempts}`,
    `Somente ${ACTIVE_FILE} foi escrito (gitignored). Nenhum arquivo versionado mudou.`,
    'Um corretivo é TENTATIVA, não GOAL novo.',
    '',
  ].join('\n'));
  return 0;
}

function cmdBlock(root, protocol, track, flags) {
  requireTrack(root, protocol, track);
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  const by = flags.by;
  const validos = ['gate', 'dependencia', 'externo', 'decisao'];
  if (!reason) {
    fail(1, 'erro de uso', 'node scripts/track.mjs block <trilha> --reason="..." --by=...', '--reason vazio',
      'Descreva o motivo do bloqueio. Ele é gravado no ledger.');
  }
  if (!validos.includes(by)) {
    fail(1, 'erro de uso', `--by=${by}`, 'valor inválido',
      `--by deve ser um de: ${validos.join(' | ')}`);
  }
  const active = requireActive(root, track);
  return blockGoal(root, protocol, track, active, reason, by);
}

function blockGoal(root, protocol, track, active, reason, by) {
  const dir = trackDir(root, protocol, track);
  const ts = new Date().toISOString();
  appendLedger(dir, {
    aep: AEP_VERSION,
    ts,
    track,
    goal: active.goal,
    result: 'BLOCKED',
    attempt: active.attempt,
    source: 'executado',
    blocked_by: by,
    reason,
    branch: active.branch,
    base_commit: active.base_commit,
    previous_attempts: active.attempts_log || [],
  });

  const goalFile = path.join(dir, 'goals', `${active.goal}.md`);
  if (fs.existsSync(goalFile)) setGoalStatus(goalFile, 'BLOCKED');
  const moved = moveGoalToClosed(root, protocol, track, active.goal);
  const derived = writeState(root, protocol, track);
  const gen = writeGenerated(root, protocol);

  const sha = stateCommit(root, `aep(${track}): block ${active.goal}`, [
    `${trackRel(protocol, track)}/LEDGER.jsonl`,
    `${trackRel(protocol, track)}/state.json`,
    moved ? moved.from : null,
    moved ? moved.to : null,
    gen.registry,
    gen.gates,
  ]);
  removeActive(root);

  process.stdout.write([
    '',
    `BLOQUEADO · ${AEP_LABEL} · trilha ${track} · GOAL ${active.goal} → BLOCKED (${by})`,
    `motivo: ${reason}`,
    `tentativas anteriores: ${(active.attempts_log || []).length}`,
    `commit de estado: ${sha}`,
    `state.json: status ${derived.status}`,
    `${ACTIVE_FILE} REMOVIDO.`,
    'Desbloqueio é ato HUMANO: mover o arquivo de _closed/goals/ de volta para goals/',
    'com status READY, ou planejar um GOAL sucessor.',
    '',
    'CONTEXTO: NEW_SESSION',
    '',
  ].join('\n'));
  return 3;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const TRACK_SKELETON = (track) => `<!-- AEP:TRACK
{
  "completion_when_empty": "PAUSED"
}
-->

# Trilha \`${track}\`

> Esqueleto gerado por \`node scripts/track.mjs init ${track}\`.
> Todo campo \`<PREENCHER>\` exige decisão humana. O AEP não inventa conteúdo de trilha.

## Objetivo

<PREENCHER>

## Escopo — paths_base (gramática limitada: "a/b/c/arquivo.ext" ou "a/b/c/**")

- <PREENCHER>

## Fora de escopo

- <PREENCHER>

## Comando de teste da trilha

\`\`\`
<PREENCHER>
\`\`\`

## Gates extras exigidos por esta trilha

- <PREENCHER>

## Branch e worktree

- padrão de branch: <PREENCHER>
- padrão de worktree: <PREENCHER>

## Plano de origem

- plan_ref: <PREENCHER>
- plan_rev: <PREENCHER>

## Estado

O estado ratificado vive em \`state.json\` (derivado) e \`LEDGER.jsonl\` (append-only).
Não edite nenhum dos dois à mão: \`node scripts/track.mjs verify\` detecta a divergência.
`;

function cmdInit(root, track, flags) {
  if (!track || !/^[a-z0-9][a-z0-9-]*$/.test(track)) {
    fail(1, 'erro de uso', `node scripts/track.mjs init ${track || ''}`, 'nome inválido',
      'Nome da trilha: minúsculas, dígitos e hífen.');
  }
  const protocolFile = path.join(root, PROTOCOL_REL);
  if (!fs.existsSync(protocolFile)) {
    fail(5, 'pré-condição de ambiente', `ls ${PROTOCOL_REL}`, 'ausente',
      `Crie ${PROTOCOL_REL} antes de inicializar trilhas.`);
  }
  const protocol = loadProtocol(root);
  const risk = flags.risk || 'MEDIO';
  if (!['BAIXO', 'MEDIO', 'ALTO', 'CRITICO'].includes(risk)) {
    fail(1, 'erro de uso', `--risk=${risk}`, 'valor inválido', '--risk=BAIXO|MEDIO|ALTO|CRITICO');
  }
  const dir = trackDir(root, protocol, track);
  if (fs.existsSync(dir)) {
    fail(1, 'erro de uso', `ls ${trackRel(protocol, track)}`, 'diretório já existe',
      `A trilha "${track}" já existe. Nada foi alterado.`);
  }
  fs.mkdirSync(path.join(dir, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_closed', 'goals'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_closed', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'goals', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, '_closed', 'goals', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, '_closed', 'reports', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, 'LEDGER.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'TRACK.md'), TRACK_SKELETON(track));

  const raw = readJson(protocolFile, 'protocol.json deve ser JSON válido.');
  raw.tracks = raw.tracks || {};
  raw.tracks[track] = { dir: track, risk_tier: risk, titulo: '<PREENCHER>' };
  fs.writeFileSync(protocolFile, canonicalJson(raw));

  const p2 = loadProtocol(root);
  const derived = writeState(root, p2, track);
  writeGenerated(root, p2);

  process.stdout.write([
    `${AEP_LABEL} · init ${track}`,
    `criado: ${trackRel(p2, track)}/ (TRACK.md, state.json, LEDGER.jsonl, goals/, _closed/)`,
    `status inicial: ${derived.status} · risco ${derived.risk_tier}`,
    `registrado em ${PROTOCOL_REL}`,
    'REGISTRY.md e GATES.md regenerados.',
    'Nenhum commit foi criado — o commit é seu, por caminho explícito.',
    '',
  ].join('\n'));
  return 0;
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

/**
 * Também reescreve state.json de todas as trilhas. Planejamento humano (adicionar ou
 * remover GOAL em goals/) muda o estado DERIVADO sem passar por close/block; `registry`
 * é o comando que reconcilia isso. Ritual: edite goals/, rode `registry`, e ratifique com
 *   AEP_WRITE=1 git commit -m "aep(<trilha>): plan ..." -- <caminhos>
 * AEP_WRITE=1 aqui é fluxo interno declarado, não segredo (ver MODELO DE SEGURANÇA).
 */
function cmdRegistry(root, protocol) {
  const out = [`${AEP_LABEL} · registry`];
  for (const t of Object.keys(protocol.tracks).sort()) {
    const s = writeState(root, protocol, t);
    out.push(`  state.json de ${t}: ${s.status} · current_goal ${s.current_goal || 'null'} · next_goal ${s.next_goal || 'null'}`);
  }
  const gen = writeGenerated(root, protocol);
  out.push(`regenerado: ${gen.registry}`);
  out.push(`regenerado: ${gen.gates}`);
  out.push(`trilhas: ${Object.keys(protocol.tracks).join(', ') || '(nenhuma)'}`);
  out.push('');
  process.stdout.write(out.join('\n'));
  return 0;
}

// ---------------------------------------------------------------------------
// verify — recalcula o estado a partir do Git. Exit 4 em divergência.
// ---------------------------------------------------------------------------

function verifyTrack(root, protocol, track) {
  const problemas = [];
  const dir = trackDir(root, protocol, track);
  const rel = trackRel(protocol, track);
  const stateFile = path.join(dir, 'state.json');

  if (!fs.existsSync(stateFile)) {
    problemas.push({ cmd: `ls ${rel}/state.json`, out: 'ausente', acao: `Regenere com: node scripts/track.mjs registry` });
    return problemas;
  }
  const onDisk = readJson(stateFile, `${rel}/state.json deve ser JSON válido.`);
  const derived = deriveState(root, protocol, track);
  if (!deepEqual(onDisk, derived)) {
    const difs = Object.keys(derived).filter((k) => !deepEqual(onDisk[k], derived[k]));
    problemas.push({
      cmd: `node scripts/track.mjs verify ${track}`,
      out: difs.map((k) => `${k}: arquivo=${JSON.stringify(onDisk[k])} derivado=${JSON.stringify(derived[k])}`).join(' | '),
      acao: `state.json divergiu do estado derivado (ledger + goals/ + TRACK.md). Ele não deve ser editado à mão.`,
    });
  }

  // LEDGER.jsonl da árvore deve ser CONTINUAÇÃO do LEDGER em HEAD (append-only).
  const ledgerRel = `${rel}/LEDGER.jsonl`;
  const show = git(['show', `HEAD:${ledgerRel}`], { cwd: root });
  if (show.code === 0) {
    const committed = show.stdout;
    const working = fs.existsSync(path.join(dir, 'LEDGER.jsonl'))
      ? fs.readFileSync(path.join(dir, 'LEDGER.jsonl'), 'utf8').replace(/\r\n/g, '\n')
      : '';
    if (!working.startsWith(committed)) {
      problemas.push({
        cmd: `git show HEAD:${ledgerRel}`,
        out: 'a versão da árvore não começa pela versão ratificada em HEAD',
        acao: 'O ledger é append-only. Linhas ratificadas foram alteradas ou removidas.',
      });
    }
  }
  return problemas;
}

function cmdVerify(root, protocol, track, flags) {
  const all = flags.all === true || !track;
  const alvos = all ? Object.keys(protocol.tracks).sort() : [track];
  if (!all) requireTrack(root, protocol, track);

  const out = [`${AEP_LABEL} · verify${all ? ' --all' : ` ${track}`}`];
  let divergencias = 0;

  for (const t of alvos) {
    const probs = verifyTrack(root, protocol, t);
    if (probs.length === 0) out.push(`  [OK]   ${t} — state.json bate com o estado derivado; ledger append-only.`);
    for (const p of probs) {
      divergencias += 1;
      out.push(`  [DIVERGE] ${t}`);
      out.push(`      evidência: ${p.cmd} → ${oneLine(p.out)}`);
      out.push(`      ação: ${p.acao}`);
    }
  }

  const genRegistry = renderRegistry(root, protocol);
  const registryFile = path.join(tracksRoot(root, protocol), 'REGISTRY.md');
  const registryOk = fs.existsSync(registryFile) && fs.readFileSync(registryFile, 'utf8').replace(/\r\n/g, '\n') === genRegistry;
  if (!registryOk) {
    divergencias += 1;
    out.push('  [DIVERGE] REGISTRY.md');
    out.push(`      evidência: node scripts/track.mjs registry → ${protocol.tracks_dir}/REGISTRY.md difere do gerado`);
    out.push('      ação: rode `node scripts/track.mjs registry` e ratifique.');
  } else out.push('  [OK]   REGISTRY.md idêntico ao gerado.');

  const genGates = renderGates(protocol);
  const gatesFile = path.join(root, 'docs/ai-execution/GATES.md');
  const gatesOk = fs.existsSync(gatesFile) && fs.readFileSync(gatesFile, 'utf8').replace(/\r\n/g, '\n') === genGates;
  if (!gatesOk) {
    divergencias += 1;
    out.push('  [DIVERGE] GATES.md');
    out.push('      evidência: node scripts/track.mjs registry → docs/ai-execution/GATES.md difere do gerado');
    out.push('      ação: rode `node scripts/track.mjs registry` e ratifique.');
  } else out.push('  [OK]   GATES.md idêntico ao gerado a partir de protocol.json.');

  out.push('');
  out.push(divergencias === 0
    ? 'verify: sem divergências.'
    : `verify: ${divergencias} divergência(s). verify DETECTA depois do fato — não impede a escrita.`);
  out.push('');
  process.stdout.write(out.join('\n'));
  return divergencias === 0 ? 0 : 4;
}

// ---------------------------------------------------------------------------
// sync-adapters — MERGE-SAFE
// ---------------------------------------------------------------------------

function adapterInner(adapter) {
  return [
    `## Protocolo de execução — ${AEP_LABEL}`,
    '',
    'Antes de qualquer tarefa neste repositório, leia `docs/ai-execution/ENTRYPOINT.md`.',
    '',
    '- início: `node scripts/track.mjs status <trilha>` e depois `node scripts/track.mjs open <trilha>`',
    '- término: `node scripts/track.mjs close <trilha>`',
    '- regra 1: escreva apenas dentro da allowlist impressa pelo `open`.',
    '- regra 2: adicione por caminho explícito — nunca `git add .`, `git add -A` ou `git commit -a`.',
    '- regra 3: gate não liberado no GOAL = pare e peça autorização humana.',
    '',
    'O protocolo é OPT-IN: sem `.aep-active` nesta worktree, nada aqui se aplica.',
    'Este bloco é GERADO. A governança completa NÃO está aqui — está em `docs/ai-execution/`.',
    adapter.linha_final,
  ].join('\n');
}

function applyAdapterBlock(file, inner, check) {
  const label = toPosix(file);
  if (!fs.existsSync(file)) {
    if (check) return { estado: 'AUSENTE', ok: false };
    fs.writeFileSync(file, `${BLOCK_BEGIN}\n${inner}\n${BLOCK_END}\n`);
    return { estado: 'CRIADO', ok: true };
  }
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const begins = lines.map((l, i) => (l.trim() === BLOCK_BEGIN ? i : -1)).filter((i) => i >= 0);
  const ends = lines.map((l, i) => (l.trim() === BLOCK_END ? i : -1)).filter((i) => i >= 0);
  if (begins.length > 1 || ends.length > 1) {
    fail(1, 'metadado inválido', `grep -n "AEP:BEGIN\\|AEP:END" ${label}`,
      `BEGIN em ${begins.map((i) => i + 1).join(',')} · END em ${ends.map((i) => i + 1).join(',')}`,
      'Mais de um bloco AEP no arquivo. Não adivinho qual é o certo — resolva à mão.');
  }
  if (begins.length !== ends.length) {
    fail(1, 'metadado inválido', `grep -n "AEP:BEGIN\\|AEP:END" ${label}`,
      `BEGIN=${begins.length} END=${ends.length}`,
      'Marcador AEP sem par. Nada foi escrito — feche o bloco à mão.');
  }
  if (begins.length === 0) {
    if (check) return { estado: 'SEM BLOCO', ok: false };
    const sep = text.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(file, `${sep}\n${BLOCK_BEGIN}\n${inner}\n${BLOCK_END}\n`);
    return { estado: 'ACRESCENTADO AO FINAL', ok: true };
  }
  if (begins[0] > ends[0]) {
    fail(1, 'metadado inválido', `grep -n "AEP:BEGIN\\|AEP:END" ${label}`,
      `END (linha ${ends[0] + 1}) antes de BEGIN (linha ${begins[0] + 1})`,
      'Marcadores fora de ordem. Nada foi escrito.');
  }
  const atual = lines.slice(begins[0] + 1, ends[0]).join('\n');
  if (check) return { estado: atual === inner ? 'EM DIA' : 'MIOLO DESATUALIZADO', ok: atual === inner };
  if (atual === inner) return { estado: 'EM DIA', ok: true };
  const novo = [...lines.slice(0, begins[0] + 1), ...inner.split('\n'), ...lines.slice(ends[0])];
  fs.writeFileSync(file, novo.join('\n'));
  return { estado: 'MIOLO SUBSTITUÍDO', ok: true };
}

function cmdSyncAdapters(root, flags) {
  const protocol = loadProtocol(root);
  const check = flags.check === true;
  const out = [`${AEP_LABEL} · sync-adapters${check ? ' --check' : ''}`];
  let ruim = 0;
  for (const adapter of protocol.adapters || []) {
    const file = path.join(root, adapter.file);
    const r = applyAdapterBlock(file, adapterInner(adapter), check);
    if (!r.ok) ruim += 1;
    out.push(`  ${r.ok ? '[OK]' : '[DIVERGE]'} ${adapter.file} — ${r.estado}`);
  }
  out.push('');
  out.push('O AEP escreve SOMENTE entre <!-- AEP:BEGIN --> e <!-- AEP:END -->.');
  out.push('Conteúdo humano fora dos marcadores nunca é removido, movido nem reordenado.');
  out.push('');
  process.stdout.write(out.join('\n'));
  if (check && ruim > 0) return 4;
  return 0;
}

// ---------------------------------------------------------------------------
// doctor — DUAS SEÇÕES SEPARADAS. Nunca bloqueia o bootstrap local.
// ---------------------------------------------------------------------------

function cmdDoctor(root) {
  const out = [];
  const avisos = [];
  const push = (ok, texto, evid) => out.push(`  [${ok ? 'OK ' : ok === null ? 'INFO' : 'AVISO'}] ${texto}${evid ? `\n         evidência: ${evid}` : ''}`);

  out.push(`${AEP_LABEL} · doctor`);
  out.push('');
  out.push('== CAMADA LOCAL ==');

  const major = Number(process.versions.node.split('.')[0]);
  push(major >= 20, `node ${process.version} (exigido >= 20)`, 'node --version');

  const gv = run('git', ['--version']);
  push(gv.code === 0, `git disponível: ${oneLine(gv.stdout)}`, 'git --version');

  const hp = git(['config', 'core.hooksPath'], { cwd: root });
  const hooksPath = hp.code === 0 ? hp.stdout.trim() : '';
  if (!hooksPath) {
    push(false, 'core.hooksPath NÃO configurado — os hooks locais estão INATIVOS nesta worktree.', 'git config core.hooksPath');
    out.push('         ação: git config core.hooksPath .githooks   (caminho RELATIVO, ver ADAPTERS.md)');
    avisos.push('core.hooksPath ausente');
  } else if (path.isAbsolute(hooksPath) || /^[A-Za-z]:/.test(hooksPath)) {
    push(false, `core.hooksPath é ABSOLUTO (${hooksPath}) — quebra a propriedade multi-worktree.`, 'git config core.hooksPath');
    out.push('         ação: troque por `.githooks` (relativo). A config vive no .git comum; o');
    out.push('               caminho relativo resolve dentro do checkout de CADA worktree, então');
    out.push('               uma worktree em branch anterior ao AEP simplesmente não tem hooks.');
    avisos.push('core.hooksPath absoluto');
  } else {
    push(true, `core.hooksPath = ${hooksPath} (relativo — correto para multi-worktree)`, 'git config core.hooksPath');
  }

  const eff = git(['rev-parse', '--git-path', 'hooks'], { cwd: root });
  push(null, `caminho efetivo de hooks: ${oneLine(eff.stdout)}`, 'git rev-parse --git-path hooks');

  const wtc = git(['config', 'extensions.worktreeConfig'], { cwd: root });
  push(null, `extensions.worktreeConfig: ${wtc.code === 0 ? oneLine(wtc.stdout) : 'não definido'}`, 'git config extensions.worktreeConfig');

  for (const h of ['pre-commit', 'commit-msg']) {
    const f = path.join(root, '.githooks', h);
    if (!fs.existsSync(f)) {
      push(false, `.githooks/${h} ausente`, `ls .githooks/${h}`);
      avisos.push(`hook ${h} ausente`);
      continue;
    }
    let exec = true;
    if (process.platform !== 'win32') {
      try { fs.accessSync(f, fs.constants.X_OK); } catch { exec = false; }
    }
    push(exec, `.githooks/${h} presente${process.platform === 'win32' ? ' (bit de execução não se aplica no Windows)' : exec ? ' e executável' : ' mas SEM bit de execução'}`, `ls -l .githooks/${h}`);
    if (!exec) avisos.push(`hook ${h} não executável`);
  }

  let protocol = null;
  try {
    protocol = loadProtocol(root);
    push(true, `protocol.json válido · runner de teste: ${protocol.test_runner || '(não declarado)'} · trilhas: ${Object.keys(protocol.tracks).join(', ') || '(nenhuma)'}`, `cat ${PROTOCOL_REL}`);
  } catch (e) {
    push(false, `protocol.json inválido ou ausente: ${e.acao || e.message}`, `cat ${PROTOCOL_REL}`);
    avisos.push('protocol.json');
  }

  const activeExiste = fs.existsSync(activePath(root));
  push(null, `${ACTIVE_FILE}: ${activeExiste ? 'PRESENTE — protocolo ATIVO nesta worktree' : 'ausente — protocolo INATIVO (opt-in) nesta worktree'}`, `ls ${ACTIVE_FILE}`);
  push(null, `versão do protocolo: ${AEP_LABEL}`, 'node scripts/track.mjs doctor');

  out.push('');
  out.push('== CAMADA REMOTA ==');

  const remotes = git(['remote', '-v'], { cwd: root });
  const temOrigin = /^origin\s/m.test(remotes.stdout);
  push(temOrigin, `remote origin ${temOrigin ? 'presente' : 'AUSENTE'}`, 'git remote -v');
  if (!temOrigin) avisos.push('sem remote origin');

  const wfDir = path.join(root, '.github', 'workflows');
  let ciFiles = [];
  if (fs.existsSync(wfDir)) {
    ciFiles = fs.readdirSync(wfDir).filter((f) => {
      try { return fs.readFileSync(path.join(wfDir, f), 'utf8').includes('track.mjs verify'); } catch { return false; }
    });
  }
  push(ciFiles.length > 0, ciFiles.length
    ? `workflow com "track.mjs verify": ${ciFiles.join(', ')}`
    : 'NENHUM workflow em .github/workflows/** contém literalmente "track.mjs verify"',
  'grep -rl "track.mjs verify" .github/workflows/');
  if (!ciFiles.length) avisos.push('CI verify ausente');

  push(null, 'branch protection: NÃO VERIFICÁVEL LOCALMENTE (exige API do forge).', '—');

  const rl = (protocol && protocol.remote_layer) || {};
  out.push('  [INFO] protocol.json.remote_layer — CONFIRMAÇÃO DECLARADA, nunca fato verificado:');
  out.push(`         ci_verify: ${JSON.stringify(rl.ci_verify)}`);
  out.push(`         branch_protection_confirmada_por: ${JSON.stringify(rl.branch_protection_confirmada_por)}`);
  out.push(`         branch_protection_confirmada_em: ${JSON.stringify(rl.branch_protection_confirmada_em)}`);

  const remotaOk = ciFiles.length > 0 && rl.ci_verify === true && rl.branch_protection_confirmada_por;
  if (!remotaOk) {
    out.push('');
    out.push('  AVISO — CAMADA REMOTA NÃO CONFIGURADA.');
    out.push('  Os hooks locais protegem contra ACIDENTE e mantêm no trilho um agente COOPERATIVO.');
    out.push('  Eles NÃO são barreira contra um executor deliberadamente não cooperativo, que pode');
    out.push('  usar `git commit --no-verify`, definir `AEP_WRITE=1`, reapontar `core.hooksPath`,');
    out.push('  usar `--amend` ou manipular `.git` diretamente.');
    out.push('  A ratificação só vira GARANTIA com PR obrigatório + CI rodando `verify --all` +');
    out.push('  branch protection. Ver docs/ai-execution/EXECUTION_PROTOCOL.md § MODELO DE SEGURANÇA.');
    out.push('  Implantação da camada remota: Comando Mestre 3.');
    out.push('  Até lá, `verify --all` continua servindo para DETECTAR divergência depois do fato.');
  }

  out.push('');
  out.push(`doctor: ${avisos.length} aviso(s)${avisos.length ? ` — ${avisos.join('; ')}` : ''}.`);
  out.push('doctor NUNCA bloqueia o bootstrap local: exit 0.');
  out.push('');
  process.stdout.write(out.join('\n'));
  return 0;
}

// ---------------------------------------------------------------------------
// hook — pre-commit / commit-msg
//
// NATUREZA DESTES HOOKS: proteção LOCAL contra ACIDENTE e contra desvio de agente
// COOPERATIVO. NÃO são barreira inviolável. AEP_WRITE=1 é detalhe de fluxo interno
// para o `close` distinguir a própria escrita de uma edição manual — não é segredo,
// não é credencial, e qualquer um pode reproduzi-lo.
//
// O hook NÃO consegue saber se o usuário digitou `git add .`. Ele valida apenas o
// CONJUNTO STAGED. A regra "não use git add ." é operacional humana e vive no
// ENTRYPOINT.
// ---------------------------------------------------------------------------

function cmdHook(kind, arg) {
  const root = repoRoot();
  const protocol = loadProtocolSoft(root);
  const rules = structuralRules(protocol);
  const active = readActive(root);
  const aepWrite = process.env.AEP_WRITE === '1';

  if (kind === 'commit-msg') {
    if (!active) return 0; // OPT-IN: sem .aep-active, nenhum padrão de mensagem é imposto.
    if (!arg) {
      fail(1, 'erro de uso', 'track.mjs hook commit-msg <arquivo>', 'arquivo ausente',
        'O hook commit-msg precisa do caminho do arquivo de mensagem ($1).');
    }
    const file = path.isAbsolute(arg) ? arg : path.join(root, arg);
    const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const first = raw.split('\n').find((l) => l.trim() && !l.trimStart().startsWith('#')) || '';
    const okGoal = /^goal\([a-z0-9][a-z0-9-]*-\d{3}\): \S/.test(first.trim());
    const okAep = /^aep\([a-z0-9][a-z0-9._/-]*\): \S/.test(first.trim());
    if (!okGoal && !okAep) {
      fail(1, 'erro de uso', `head -1 ${toPosix(arg)}`, first.trim() || '(vazio)',
        'Com GOAL aberto a mensagem deve ser `goal(<trilha>-<nnn>): ...` ou `aep(<escopo>): ...`.');
    }
    return 0;
  }

  if (kind !== 'pre-commit') {
    fail(1, 'erro de uso', `track.mjs hook ${kind}`, 'hook desconhecido',
      'Hooks suportados: pre-commit, commit-msg.');
  }

  // 1 IMUTABILIDADE — vale SEMPRE, com ou sem .aep-active.
  //   Só MODIFICAÇÃO (M) e DELEÇÃO (D). CRIAÇÃO (A) é permitida — é assim que o
  //   commit de bootstrap passa naturalmente, sem nenhuma exceção especial.
  const md = gitPaths(['diff', '--cached', '--name-only', '--diff-filter=MD'], { cwd: root });
  const imutaveis = md.lines.filter((p) => isImmutablePath(p, rules));
  if (imutaveis.length && !aepWrite) {
    fail(2, 'gate violado', 'git diff --cached --name-only --diff-filter=MD', imutaveis.join(' '),
      'state.json, LEDGER.jsonl e REGISTRY.md são ratificados pelo AEP, não editados à mão. Use `close`/`block`/`registry`.');
  }

  const staged = gitPaths(['diff', '--cached', '--name-only'], { cwd: root }).lines;

  // 2 Escrita do próprio protocolo: mantém o escopo confinado à governança.
  if (aepWrite) {
    const fora = staged.filter((p) => !p.startsWith(`${protocol.tracks_dir}/`) && !p.startsWith('docs/ai-execution/'));
    if (fora.length) {
      fail(2, 'gate violado', 'git diff --cached --name-only', fora.join(' '),
        `Commit com AEP_WRITE=1 só pode tocar ${protocol.tracks_dir}/** e docs/ai-execution/**.`);
    }
    return 0;
  }

  // 3 OPT-IN: sem .aep-active nesta worktree, o AEP não existe para este commit.
  if (!active) return 0;

  const branch = currentBranch(root);
  if (branch !== active.branch) {
    fail(2, 'gate violado', 'git rev-parse --abbrev-ref HEAD', `${branch} (GOAL exige ${active.branch})`,
      'Commit fora da branch do GOAL aberto. Troque de branch ou feche o GOAL.');
  }

  const fora = staged.filter((p) => !matchAny(active.allowlist, p));
  if (fora.length) {
    fail(2, 'gate violado', 'git diff --cached --name-only', fora.join(' '),
      `Caminho staged fora da allowlist do GOAL ${active.goal}. Remova do índice ou amplie a allowlist no GOAL (ato humano).`);
  }

  for (const g of protocol.gates) {
    if ((active.gates_liberados || []).includes(g.id)) continue;
    const hits = staged.filter((p) => matchAny(g.paths || [], p));
    if (hits.length) {
      fail(2, 'gate violado', 'git diff --cached --name-only', `${g.id}: ${hits.join(' ')}`,
        `Gate "${g.id}" não está em gates_liberados do GOAL ${active.goal}. Pare e peça autorização humana.`);
    }
  }

  const hot = staged.filter((p) => rules.goalsHot.test(p));
  if (hot.length) {
    fail(2, 'gate violado', 'git diff --cached --name-only', hot.join(' '),
      `${protocol.tracks_dir}/*/goals/** é caminho quente do protocolo: só o AEP move GOALs.`);
  }

  const ledgers = staged.filter((p) => /LEDGER\.jsonl$/.test(p));
  for (const l of ledgers) {
    const num = git(['diff', '--cached', '--numstat', '--', l], { cwd: root });
    const del = num.stdout.split('\n').filter(Boolean)
      .map((x) => Number(x.trim().split(/\s+/)[1] || 0)).reduce((a, b) => a + b, 0);
    if (del > 0) {
      fail(2, 'gate violado', `git diff --cached --numstat -- ${l}`, `${del} linha(s) removida(s)`,
        'O ledger é append-only. Deleção de linha ratificada é proibida.');
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// import — FUNCIONAL. Reconcilia um plano humano com a verdade do Git.
//
// Limites duros: não altera código produtivo · não reimplementa nada · commita
// apenas dentro de docs/execution-tracks/ · mantém no máximo `max_hot_goals` GOALs
// no caminho quente (goals/) · import/ é GITIGNORED e seu conteúdo bruto não é
// commitado · o manifesto é copiado para _closed/reports/ como proveniência.
// ---------------------------------------------------------------------------

const MANIFEST_REQUIRED = ['aep', 'track', 'plan_ref', 'plan_rev', 'risk_tier', 'branch_pattern',
  'test_command', 'paths_base', 'gates_extra', 'bootstrap_commit', 'fontes', 'goals_declarados'];

/**
 * Fontes do manifesto — o formato CANÔNICO da especificação é OBJETO
 * ({ rotulo: caminho }). Aceita array legado ["caminho", ...] apenas para
 * retrocompatibilidade. Normaliza SEMPRE para um array determinístico de
 * { rotulo, caminho }, ordenado por rotulo, para que a representação interna
 * não dependa da ordem de inserção das chaves do objeto.
 */
export function normalizeFontes(fontes) {
  if (fontes === undefined || fontes === null) return [];
  if (Array.isArray(fontes)) {
    for (const f of fontes) {
      if (typeof f !== 'string' || !f.trim()) {
        fail(1, 'metadado inválido', 'JSON.stringify(fontes)', JSON.stringify(fontes),
          'fontes em array legado deve conter apenas strings não vazias.');
      }
    }
    return fontes.map((f) => ({ rotulo: f, caminho: f }));
  }
  if (typeof fontes === 'object') {
    const out = [];
    for (const rotulo of Object.keys(fontes)) {
      const caminho = fontes[rotulo];
      if (typeof caminho !== 'string' || !caminho.trim()) {
        fail(1, 'metadado inválido', `JSON.stringify(fontes.${rotulo})`, JSON.stringify(caminho),
          'Cada valor do objeto fontes deve ser um caminho (string não vazia).');
      }
      out.push({ rotulo, caminho });
    }
    out.sort((a, b) => a.rotulo.localeCompare(b.rotulo));
    return out;
  }
  fail(1, 'metadado inválido', 'JSON.stringify(fontes)', JSON.stringify(fontes),
    'fontes deve ser um objeto { rotulo: caminho } (canônico) ou um array de caminhos (legado).');
  return [];
}

function goalDoc(meta, manifest, extra) {
  const fontes = normalizeFontes(manifest.fontes);
  return [
    '<!-- AEP:META',
    JSON.stringify(meta, null, 2),
    '-->',
    '',
    `# ${meta.id} — ${meta.title}`,
    '',
    `- trilha: \`${meta.track}\``,
    `- classe: ${meta.class} · status: ${meta.status}`,
    `- plano: \`${manifest.plan_ref}\` (plan_rev ${meta.plan_rev})`,
    `- branch: \`${meta.branch}\``,
    `- teste: \`${meta.test_command}\``,
    '',
    '## Fontes (documentos de origem — o importador NÃO reimplementa nada)',
    '',
    ...fontes.map((f) => (f.rotulo === f.caminho ? `- \`${f.caminho}\`` : `- \`${f.rotulo}\`: \`${f.caminho}\``)),
    '',
    '## Allowlist',
    '',
    ...meta.allowlist.map((p) => `- \`${p}\``),
    '',
    ...(extra || []),
    '',
  ].join('\n');
}

function verifyCommit(root, sha, branch) {
  if (!sha) return { ok: false, cmd: 'git cat-file -e <commit>^{commit}', out: 'commit não declarado no manifesto' };
  const exists = git(['cat-file', '-e', `${sha}^{commit}`], { cwd: root });
  if (exists.code !== 0) {
    return { ok: false, cmd: `git cat-file -e ${sha}^{commit}`, out: oneLine(exists.stderr || `exit ${exists.code}`) };
  }
  if (!branch) return { ok: false, cmd: `git cat-file -e ${sha}^{commit}`, out: 'branch não declarada no manifesto' };
  const anc = git(['merge-base', '--is-ancestor', sha, branch], { cwd: root });
  if (anc.code !== 0) {
    return { ok: false, cmd: `git merge-base --is-ancestor ${sha} ${branch}`, out: oneLine(anc.stderr || `exit ${anc.code} — commit fora da branch declarada`) };
  }
  return { ok: true, cmd: `git merge-base --is-ancestor ${sha} ${branch}`, out: 'commit existe e está na branch declarada' };
}

/** Status permitidos para gates de domínio (gates_extra). */
const GATE_EXTRA_STATUS = ['pendente', 'aprovado', 'liberado', 'ativo', 'requer_aprovacao'];

/**
 * Correção 1 — gates_extra de DOMÍNIO. Aceita duas formas por entrada:
 *   - string: "main"                        → { id: "main", status: "pendente", dependencias: [] }
 *   - objeto: { id, status?, dependencias? } → validado campo a campo
 * NÃO exige interseção com os gates centrais (IDs G-*) do protocolo — são
 * vocabulários separados por natureza. Valida estrutura, ID não vazio,
 * unicidade dentro do track, status permitido e dependências referenciadas.
 * Devolve array normalizado e determinístico (ordem de declaração preservada).
 */
export function normalizeGatesExtra(gatesExtra, manifestLabel) {
  if (gatesExtra === undefined || gatesExtra === null) return [];
  if (!Array.isArray(gatesExtra)) {
    fail(1, 'metadado inválido', `grep -n '"gates_extra"' ${manifestLabel}`, JSON.stringify(gatesExtra),
      'gates_extra deve ser um array de strings ou de objetos { id, status?, dependencias? }.');
  }
  const vistos = new Set();
  const ids = [];
  const out = gatesExtra.map((entrada, idx) => {
    const onde = `grep -n '"gates_extra"' ${manifestLabel} (índice ${idx})`;
    let g;
    if (typeof entrada === 'string') {
      g = { id: entrada, status: 'pendente', dependencias: [] };
    } else if (entrada && typeof entrada === 'object' && !Array.isArray(entrada)) {
      g = {
        id: entrada.id,
        status: entrada.status === undefined ? 'pendente' : entrada.status,
        dependencias: entrada.dependencias === undefined ? [] : entrada.dependencias,
      };
    } else {
      fail(1, 'metadado inválido', onde, JSON.stringify(entrada),
        'Cada gate_extra deve ser string (id) ou objeto { id, status?, dependencias? }.');
    }
    if (typeof g.id !== 'string' || !g.id.trim()) {
      fail(1, 'metadado inválido', onde, JSON.stringify(entrada),
        'gate_extra precisa de um "id" (string não vazia).');
    }
    g.id = g.id.trim();
    if (vistos.has(g.id)) {
      fail(1, 'metadado inválido', onde, g.id,
        `gate_extra "${g.id}" duplicado dentro do mesmo manifesto — IDs de domínio devem ser únicos no track.`);
    }
    vistos.add(g.id);
    ids.push(g.id);
    if (!GATE_EXTRA_STATUS.includes(g.status)) {
      fail(1, 'metadado inválido', onde, `status="${g.status}"`,
        `status de gate_extra deve ser um de: ${GATE_EXTRA_STATUS.join(' | ')}.`);
    }
    if (!Array.isArray(g.dependencias)) {
      fail(1, 'metadado inválido', onde, JSON.stringify(g.dependencias),
        'dependencias de gate_extra deve ser um array de IDs (pode ser vazio).');
    }
    for (const dep of g.dependencias) {
      if (typeof dep !== 'string' || !dep.trim()) {
        fail(1, 'metadado inválido', onde, JSON.stringify(dep),
          'cada dependência de gate_extra deve ser um ID (string não vazia).');
      }
    }
    return g;
  });
  // Validação de dependências referenciadas (após coletar todos os IDs).
  const declarados = new Set(ids);
  for (const g of out) {
    for (const dep of g.dependencias) {
      if (!declarados.has(dep)) {
        fail(1, 'metadado inválido', `grep -n '"${g.id}"' ${manifestLabel}`, `dependencia "${dep}"`,
          `gate_extra "${g.id}" depende de "${dep}", que não está declarado em gates_extra.`);
      }
    }
  }
  return out;
}

/**
 * Motivo canônico de gate humano pendente. É o valor determinístico quando o
 * manifesto não fornece um motivo explícito — nenhuma regra depende do ID do GOAL.
 */
const GATE_HUMANO_MOTIVO_CANONICO = 'HUMAN_PUSH_AUTHORIZATION_NOT_SENT';

/**
 * Correção 3 — gate_humano. Aprovação humana EXIGE evidência explícita. Ausência,
 * silêncio, `false`, `null` ou valor indefinido NUNCA são interpretados como
 * aprovação. Só libera o gate um objeto de evidência com `aprovado: true` e
 * um identificador de autorização registrado pelo fluxo oficial do AEP.
 *
 * Gate pendente NÃO cria estado novo na máquina do § 3 do EXECUTION_PROTOCOL:
 * o GOAL vira `BLOCKED` (estado já existente), com `blocked_by: "gate"` — a
 * categoria já prevista em `block --by=gate|dependencia|externo|decisao` — e o
 * motivo canônico em `reason`.
 */
function resolveGateHumano(g, manifestLabel) {
  const gh = g.gate_humano;
  if (gh === undefined || gh === null) return { requerido: false, pendente: false, motivo: null, decisao: null };
  // Forma simples: gate_humano: true → requerido e pendente (sem evidência).
  if (gh === true) {
    return {
      requerido: true, pendente: true,
      motivo: 'gate humano exigido pelo manifesto; nenhuma evidência de aprovação registrada',
      decisao: GATE_HUMANO_MOTIVO_CANONICO,
    };
  }
  if (gh === false) return { requerido: false, pendente: false, motivo: null, decisao: null };
  if (typeof gh === 'object' && !Array.isArray(gh)) {
    const requerido = gh.requerido !== false; // objeto presente implica exigência, salvo requerido:false
    if (!requerido) return { requerido: false, pendente: false, motivo: null, decisao: null };
    const ev = gh.aprovacao;
    const aprovado = ev && typeof ev === 'object' && ev.aprovado === true
      && typeof ev.autorizacao === 'string' && ev.autorizacao.trim();
    if (aprovado) {
      return {
        requerido: true, pendente: false, motivo: null, decisao: null,
        aprovacao: { aprovado: true, autorizacao: ev.autorizacao.trim(), registrado_por: ev.registrado_por || null, em: ev.em || null },
      };
    }
    // Motivo explícito do manifesto é normalizado e preservado; na ausência dele,
    // o motivo é o canônico — determinístico, nunca derivado do ID do GOAL.
    const decisao = typeof gh.decisao === 'string' && gh.decisao.trim()
      ? gh.decisao.trim() : GATE_HUMANO_MOTIVO_CANONICO;
    return {
      requerido: true, pendente: true,
      motivo: gh.motivo || 'gate humano pendente — aprovação explícita ausente',
      decisao,
    };
  }
  fail(1, 'metadado inválido', `grep -n '"gate_humano"' ${manifestLabel}`, JSON.stringify(gh),
    'gate_humano deve ser boolean ou objeto { requerido?, motivo?, decisao?, aprovacao? }.');
  return { requerido: false, pendente: false, motivo: null, decisao: null };
}

/**
 * Correção 4 — `plano_ids` e `goals_declarados` têm funções DIFERENTES e não são
 * intercambiáveis: `plano_ids` é a lista de IDs do plano humano (`plan_ref`);
 * `goals_declarados` é o subconjunto que o manifesto declara com situação
 * operacional. Não existe fallback de um para o outro — o fallback anterior
 * (`plano_ids || goals_declarados`) tornava as regras 1 e 5 do § 12 letra morta.
 *
 * Ausente → lista vazia. Presente → precisa ser array de strings não vazias.
 * Duplicatas internas são eliminadas preservando a primeira ocorrência.
 */
export function normalizePlanoIds(planoIds, manifestLabel) {
  if (planoIds === undefined || planoIds === null) return [];
  if (!Array.isArray(planoIds)) {
    fail(1, 'metadado inválido', `grep -n '"plano_ids"' ${manifestLabel}`, JSON.stringify(planoIds),
      'plano_ids deve ser um array de IDs (strings não vazias). Objeto, número, boolean ou string isolada são inválidos.');
  }
  const vistos = new Set();
  const out = [];
  planoIds.forEach((id, idx) => {
    if (typeof id !== 'string' || !id.trim()) {
      fail(1, 'metadado inválido', `grep -n '"plano_ids"' ${manifestLabel} (índice ${idx})`, JSON.stringify(id),
        'Cada item de plano_ids deve ser um ID (string não vazia).');
    }
    const v = id.trim();
    if (vistos.has(v)) return; // duplicata interna: determinística, primeira ocorrência vence
    vistos.add(v);
    out.push(v);
  });
  return out;
}

function cmdImport(root, protocol, track, flags) {
  requireTrack(root, protocol, track);
  const manifestArg = flags.manifest;
  if (typeof manifestArg !== 'string' || !manifestArg) {
    fail(1, 'erro de uso', 'node scripts/track.mjs import <trilha> --manifest=<caminho>', '--manifest ausente',
      `Aponte o manifesto, por padrão import/${track}/MANIFEST.json (diretório gitignored).`);
  }
  const manifestFile = path.isAbsolute(manifestArg) ? manifestArg : path.join(root, manifestArg);
  if (!fs.existsSync(manifestFile)) {
    fail(1, 'erro de uso', `ls ${toPosix(manifestArg)}`, 'arquivo ausente', 'Manifesto não encontrado.');
  }
  const manifest = readJson(manifestFile, 'O manifesto deve ser JSON (não YAML — consequência da gramática do protocolo).');
  for (const k of MANIFEST_REQUIRED) {
    if (manifest[k] === undefined) {
      fail(1, 'metadado inválido', `grep -n "${k}" ${toPosix(manifestArg)}`, 'campo ausente',
        `MANIFEST.json precisa do campo "${k}".`);
    }
  }
  if (manifest.aep !== AEP_VERSION) {
    fail(1, 'metadado inválido', `grep -n '"aep"' ${toPosix(manifestArg)}`, `aep=${manifest.aep}`,
      `Manifesto de outra versão. Esperado "${AEP_VERSION}".`);
  }
  if (manifest.track !== track) {
    fail(1, 'metadado inválido', `grep -n '"track"' ${toPosix(manifestArg)}`, `track=${manifest.track}`,
      `O manifesto declara a trilha "${manifest.track}", mas o comando pediu "${track}".`);
  }
  manifest.paths_base.forEach((p) => assertPattern(p, `${toPosix(manifestArg)} paths_base`));

  // Correção 1 — gates_extra são gates de DOMÍNIO do track importado, NÃO os
  // gates centrais do protocolo (IDs G-*). Não exigem interseção com os centrais.
  // Validação: estrutura, ID não vazio, unicidade no track, status permitido e
  // dependências referenciadas quando aplicável.
  const gatesExtra = normalizeGatesExtra(manifest.gates_extra, toPosix(manifestArg));

  const dir = trackDir(root, protocol, track);
  const rel = trackRel(protocol, track);
  // Correção 4 — sem fallback: `plano_ids` ausente é lista VAZIA, nunca os IDs de
  // `goals_declarados`. Um plano vazio não carrega evidência de divergência, então a
  // regra 1 (§ 12) só pode disparar quando existe uma lista de plano para contradizer
  // o manifesto; a regra 5 (DRAFT) opera sobre o excedente do plano.
  const planoIds = normalizePlanoIds(manifest.plano_ids, toPosix(manifestArg));
  const planoIdsSet = new Set(planoIds);
  const declaradosIds = new Set(manifest.goals_declarados.map((g) => g.id));
  const planRev = Number(manifest.plan_rev);

  const confirmados = [];
  const divergentes = [];
  const pendentes = [];
  const rascunhos = [];
  const supersedidos = [];
  const prontos = [];
  const bloqueadosGateHumano = [];
  const ts = new Date().toISOString();

  const baseMeta = (g, status, gateHumano) => {
    const meta = {
      aep: AEP_VERSION,
      id: g.id,
      track,
      title: g.title || '<PREENCHER>',
      status,
      class: g.class || 'C2',
      risk_tier: manifest.risk_tier,
      branch: g.branch || manifest.branch_pattern.replace('<nnn>', String(g.id).split('-').pop()),
      worktree: g.worktree || '<PREENCHER>',
      test_command: manifest.test_command,
      allowlist: Array.isArray(g.allowlist) && g.allowlist.length ? g.allowlist : manifest.paths_base,
      gates_liberados: Array.isArray(g.gates_liberados) ? g.gates_liberados : [],
      read_budget: Number(g.read_budget) > 0 ? Number(g.read_budget) : 8,
      plan_ref: manifest.plan_ref,
      plan_rev: g.plan_rev === undefined ? planRev : Number(g.plan_rev),
      familia_executor: g.familia_executor || null,
      revisao_independente: g.revisao_independente === true,
      reversibilidade: g.reversibilidade || null,
    };
    // gates_extra são metadata governada do track — preservadas no GOAL importado.
    if (gatesExtra.length) meta.gates_extra = gatesExtra;
    if (gateHumano && gateHumano.requerido) {
      meta.gate_humano = gateHumano.pendente
        ? { requerido: true, pendente: true, motivo: gateHumano.motivo, decisao: gateHumano.decisao }
        : { requerido: true, pendente: false, aprovacao: gateHumano.aprovacao };
    }
    return meta;
  };

  for (const g of manifest.goals_declarados) {
    const gateHumano = resolveGateHumano(g, toPosix(manifestArg));
    // Regra 1 — no manifesto mas não no plano → BLOCKED (decisao). Só é aplicável
    // quando o manifesto declarou uma lista de plano: sem ela não há com o que
    // confrontar, e ausência de campo opcional nunca vira bloqueio universal.
    if (planoIds.length && !planoIdsSet.has(g.id)) {
      divergentes.push({
        id: g.id, motivo: 'no manifesto mas não no plano', blocked_by: 'decisao',
        cmd: `grep -n "${g.id}" ${manifest.plan_ref}`, out: 'ausente em plano_ids',
      });
      continue;
    }
    // Regra 2 — DONE exige prova no Git: o commit deve existir E estar na branch
    // declarada pelo manifesto. Branch não declarada NUNCA é presumida.
    if (g.situacao === 'DONE') {
      const v = verifyCommit(root, g.commit, g.branch);
      if (v.ok) confirmados.push({ ...g, evid_cmd: v.cmd, evid_out: v.out, meta: baseMeta(g, 'DONE', gateHumano) });
      else divergentes.push({ id: g.id, motivo: 'DONE sem prova no Git', blocked_by: 'divergencia', cmd: v.cmd, out: v.out });
      continue;
    }
    // Regra 3 — superado por plan_rev mais novo, ou declarado SUPERSEDED explicitamente
    const gRev = g.plan_rev === undefined ? planRev : Number(g.plan_rev);
    if (g.situacao === 'SUPERSEDED') {
      supersedidos.push({ ...g, meta: baseMeta(g, 'SUPERSEDED', gateHumano), gRev });
      continue;
    }
    if (gRev < planRev) {
      supersedidos.push({ ...g, meta: baseMeta(g, 'SUPERSEDED', gateHumano), gRev });
      continue;
    }
    // Regra 4 — READY. Gate humano PENDENTE impede READY: o GOAL vira BLOCKED
    //   (estado já existente na máquina do § 3), fora do caminho quente e da
    //   elegibilidade. Nenhum estado novo é criado para este corretivo.
    if (g.situacao === 'READY') {
      if (gateHumano.requerido && gateHumano.pendente) {
        bloqueadosGateHumano.push({ ...g, meta: baseMeta(g, 'BLOCKED', gateHumano), gateHumano });
      } else {
        prontos.push({ ...g, meta: baseMeta(g, 'READY', gateHumano) });
      }
      continue;
    }
    divergentes.push({
      id: g.id, motivo: `situacao "${g.situacao}" não é DONE nem READY nem SUPERSEDED`, blocked_by: 'decisao',
      cmd: `grep -n '"situacao"' ${toPosix(manifestArg)}`, out: String(g.situacao),
    });
  }

  // Regra 5 — no plano mas não no manifesto → DRAFT, fora de goals/.
  // O AEP não tem diretório de planejamento frio: DRAFT é representado no
  // tracking (RECONCILIACAO.md + saída do import), sem arquivo em goals/, sem
  // linha de ledger e sem exigir commit, branch ou prova Git. Quando o ID também
  // está em goals_declarados, prevalece o declarado — nunca duas entradas.
  for (const id of planoIds) {
    if (!declaradosIds.has(id)) rascunhos.push({ id });
  }

  // Caminho quente: no máximo `max_hot_goals`.
  const hot = prontos.slice(0, protocol.max_hot_goals);
  const excedentes = prontos.slice(protocol.max_hot_goals);
  for (const e of excedentes) pendentes.push({ id: e.id, motivo: `READY além do teto de ${protocol.max_hot_goals} GOALs no caminho quente → fica fora de goals/` });

  // ---- DRY-RUN: executa toda a validação e classificação, mas NÃO escreve nada
  // (state.json, LEDGER.jsonl, REGISTRY.md, goals/, _closed/goals/ ficam intactos).
  if (flags['dry-run'] === true || flags.dry_run === true) {
    process.stdout.write([
      `${AEP_LABEL} · import ${track} · DRY-RUN · manifesto ${toPosix(manifestArg)}`,
      'MODO DRY-RUN: nenhum arquivo operacional do AEP foi escrito.',
      `confirmados (DONE):   ${confirmados.length} → ${confirmados.map((c) => c.id).join(', ') || '—'}`,
      `divergentes (BLOCKED):${divergentes.length} → ${divergentes.map((d) => `${d.id}[${d.blocked_by}]`).join(', ') || '—'}`,
      `superados (SUPERSEDED):${supersedidos.length} → ${supersedidos.map((s) => s.id).join(', ') || '—'}`,
      `gate humano (BLOCKED):${bloqueadosGateHumano.length} → ${bloqueadosGateHumano.map((w) => `${w.id}[${w.gateHumano.decisao}]`).join(', ') || '—'}`,
      `prontos (READY, quente):${hot.length} → ${hot.map((h) => h.id).join(', ') || '—'}`,
      `rascunhos (DRAFT):    ${rascunhos.length} → ${rascunhos.map((p) => p.id).join(', ') || '—'}`,
      `pendências:           ${pendentes.length} → ${pendentes.map((p) => p.id).join(', ') || '—'}`,
      '',
    ].join('\n'));
    return 0;
  }

  // ---- escrita
  const escritos = [];
  fs.mkdirSync(path.join(dir, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_closed', 'goals'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_closed', 'reports'), { recursive: true });

  for (const c of confirmados) {
    const f = path.join(dir, '_closed', 'goals', `${c.id}.md`);
    fs.writeFileSync(f, goalDoc(c.meta, manifest, ['## Proveniência', '',
      `- importado de \`${manifest.plan_ref}\` em ${ts}`,
      `- commit confirmado: \`${c.commit}\` na branch \`${c.branch}\``,
      `- evidência: \`${c.evid_cmd}\` → ${c.evid_out}`]));
    escritos.push(`${rel}/_closed/goals/${c.id}.md`);
    appendLedger(dir, {
      aep: AEP_VERSION, ts, track, goal: c.id, result: 'DONE', attempt: 1,
      source: 'importado', bootstrap_commit: manifest.bootstrap_commit,
      branch: c.branch, head_commit: c.commit, plan_ref: manifest.plan_ref, plan_rev: planRev,
      evidencia: { cmd: c.evid_cmd, out: c.evid_out },
    });
  }
  for (const s of supersedidos) {
    const f = path.join(dir, '_closed', 'goals', `${s.id}.md`);
    fs.writeFileSync(f, goalDoc(s.meta, manifest, ['## Proveniência', '', `- SUPERSEDED: plan_rev do GOAL ${s.gRev} < plan_rev do manifesto ${planRev}`]));
    escritos.push(`${rel}/_closed/goals/${s.id}.md`);
    appendLedger(dir, {
      aep: AEP_VERSION, ts, track, goal: s.id, result: 'SUPERSEDED', attempt: 1,
      source: 'importado', bootstrap_commit: manifest.bootstrap_commit,
      plan_ref: manifest.plan_ref, plan_rev: planRev, superseded_from_rev: s.gRev,
    });
  }
  for (const d of divergentes) {
    appendLedger(dir, {
      aep: AEP_VERSION, ts, track, goal: d.id, result: 'BLOCKED', attempt: 1,
      source: 'importado', blocked_by: d.blocked_by, reason: d.motivo,
      bootstrap_commit: manifest.bootstrap_commit, plan_ref: manifest.plan_ref, plan_rev: planRev,
      evidencia: { cmd: d.cmd, out: d.out },
    });
  }
  for (const h of hot) {
    const f = path.join(dir, 'goals', `${h.id}.md`);
    fs.writeFileSync(f, goalDoc(h.meta, manifest, ['## Critério de pronto', '', '- <PREENCHER>']));
    escritos.push(`${rel}/goals/${h.id}.md`);
  }
  // Correção 3 — gate humano pendente: o GOAL fica NÃO EXECUTÁVEL, com status
  // BLOCKED em _closed/goals/ (§ 3: BLOCKED → _closed/goals/). Não entra no caminho
  // quente, não é elegível e não é abrível por `open` (que só lê goals/ com status
  // READY). O bloqueio É ratificado no ledger, com a categoria já existente
  // `blocked_by: "gate"` e o motivo canônico em `reason`.
  for (const w of bloqueadosGateHumano) {
    const f = path.join(dir, '_closed', 'goals', `${w.id}.md`);
    fs.writeFileSync(f, goalDoc(w.meta, manifest, [
      '## Gate humano pendente — BLOCKED', '',
      `- motivo: ${w.gateHumano.motivo}`,
      `- decisão humana requerida: \`${w.gateHumano.decisao}\``,
      '- este GOAL NÃO está READY, NÃO é elegível e NÃO pode ser aberto por track.mjs.',
      '- ausência de aprovação NÃO libera o GOAL — a liberação exige evidência explícita registrada pelo fluxo oficial do AEP.',
    ]));
    escritos.push(`${rel}/_closed/goals/${w.id}.md`);
    appendLedger(dir, {
      aep: AEP_VERSION, ts, track, goal: w.id, result: 'BLOCKED', attempt: 1,
      source: 'importado', blocked_by: 'gate', reason: w.gateHumano.decisao,
      bootstrap_commit: manifest.bootstrap_commit, plan_ref: manifest.plan_ref, plan_rev: planRev,
      evidencia: { cmd: `grep -n '"gate_humano"' ${toPosix(manifestArg)}`, out: w.gateHumano.motivo },
    });
  }

  const n = fs.readdirSync(path.join(dir, '_closed', 'reports')).filter((f) => /^IMPORT-\d+-MANIFEST\.json$/.test(f)).length + 1;
  const manifestCopyRel = `${rel}/_closed/reports/IMPORT-${n}-MANIFEST.json`;
  fs.copyFileSync(manifestFile, path.join(root, manifestCopyRel));
  escritos.push(manifestCopyRel);

  const rec = [];
  rec.push(`# Reconciliação de importação — trilha \`${track}\``);
  rec.push('');
  rec.push(`- importação nº ${n} · ${ts}`);
  rec.push(`- plano: \`${manifest.plan_ref}\` (plan_rev ${planRev})`);
  rec.push(`- bootstrap_commit declarado: \`${manifest.bootstrap_commit}\``);
  rec.push(`- manifesto (proveniência): \`${manifestCopyRel}\``);
  rec.push(`- o diretório \`import/\` é gitignored; o manifesto bruto NÃO é commitado.`);
  rec.push('');
  rec.push('## 1. Confirmados (DONE com prova no Git)');
  rec.push('');
  if (!confirmados.length) rec.push('_(nenhum)_');
  for (const c of confirmados) rec.push(`- \`${c.id}\` → DONE · commit \`${c.commit}\` · branch \`${c.branch}\`\n  - evidência: \`${c.evid_cmd}\` → ${c.evid_out}`);
  rec.push('');
  rec.push('## 2. Divergentes (BLOCKED — nunca presumidos DONE)');
  rec.push('');
  if (!divergentes.length) rec.push('_(nenhum)_');
  for (const d of divergentes) rec.push(`- \`${d.id}\` → BLOCKED (\`${d.blocked_by}\`) · ${d.motivo}\n  - evidência: \`${d.cmd}\` → ${d.out}`);
  rec.push('');
  rec.push('## 3. Pendentes de planejamento (DRAFT — fora de goals/)');
  rec.push('');
  if (!rascunhos.length && !pendentes.length) rec.push('_(nenhum)_');
  for (const p of rascunhos) {
    rec.push(`- \`${p.id}\` → DRAFT · no plano (\`plano_ids\`) e não declarado no manifesto`
      + '\n  - planejamento futuro: não exige commit, branch nem prova no Git.'
      + '\n  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.');
  }
  for (const p of pendentes) rec.push(`- \`${p.id}\` — ${p.motivo}`);
  rec.push('');
  rec.push('## 4. Bloqueados por gate humano (BLOCKED — não executáveis)');
  rec.push('');
  if (!bloqueadosGateHumano.length) rec.push('_(nenhum)_');
  for (const w of bloqueadosGateHumano) {
    rec.push(`- \`${w.id}\` → BLOCKED (\`gate\`) · ${w.gateHumano.motivo}\n  - decisão humana requerida: \`${w.gateHumano.decisao}\`\n  - ausência de aprovação NÃO libera o GOAL — exige evidência explícita registrada pelo fluxo oficial do AEP.`);
  }
  rec.push('');
  rec.push('## 5. Superados (SUPERSEDED → _closed/goals/)');
  rec.push('');
  if (!supersedidos.length) rec.push('_(nenhum)_');
  for (const s of supersedidos) rec.push(`- \`${s.id}\` — plan_rev ${s.gRev} < ${planRev}`);
  rec.push('');
  rec.push('## 6. Caminho quente após a importação');
  rec.push('');
  if (!hot.length) rec.push('_(vazio)_');
  for (const h of hot) rec.push(`- \`${h.id}\` → \`${rel}/goals/${h.id}.md\` (READY)`);
  rec.push('');
  const recRel = `${rel}/_closed/reports/RECONCILIACAO.md`;
  fs.writeFileSync(path.join(root, recRel), rec.join('\n'));
  escritos.push(recRel);

  const derived = writeState(root, protocol, track);
  const gen = writeGenerated(root, protocol);
  const sha = stateCommit(root, `aep(${track}): import ${n} (plan_rev ${planRev})`, [
    `${rel}/LEDGER.jsonl`, `${rel}/state.json`, ...escritos, gen.registry, gen.gates,
  ]);

  process.stdout.write([
    `${AEP_LABEL} · import ${track} · manifesto ${toPosix(manifestArg)}`,
    `confirmados (DONE):   ${confirmados.length} → ${confirmados.map((c) => c.id).join(', ') || '—'}`,
    `divergentes (BLOCKED):${divergentes.length} → ${divergentes.map((d) => `${d.id}[${d.blocked_by}]`).join(', ') || '—'}`,
    `superados (SUPERSEDED):${supersedidos.length} → ${supersedidos.map((s) => s.id).join(', ') || '—'}`,
    `gate humano (BLOCKED):${bloqueadosGateHumano.length} → ${bloqueadosGateHumano.map((w) => `${w.id}[${w.gateHumano.decisao}]`).join(', ') || '—'}`,
    `prontos (READY, quente):${hot.length} → ${hot.map((h) => h.id).join(', ') || '—'}`,
    `rascunhos (DRAFT):    ${rascunhos.length} → ${rascunhos.map((p) => p.id).join(', ') || '—'}`,
    `pendências:           ${pendentes.length} → ${pendentes.map((p) => p.id).join(', ') || '—'}`,
    `reconciliação: ${recRel}`,
    `proveniência:  ${manifestCopyRel}`,
    `state.json: status ${derived.status} · current_goal ${derived.current_goal || 'null'}`,
    `commit de estado: ${sha}`,
    '',
  ].join('\n'));
  return 0;
}



// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) flags[a.slice(2)] = true;
      else flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else positional.push(a);
  }
  return { positional, flags };
}

const COMMANDS = new Set(['status', 'open', 'check', 'close', 'attempt', 'block', 'init',
  'import', 'registry', 'verify', 'doctor', 'sync-adapters', 'hook']);

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(usage());
    return 0;
  }
  if (!COMMANDS.has(cmd)) {
    fail(1, 'erro de uso', `node scripts/track.mjs ${cmd}`, 'comando desconhecido',
      `Comandos: ${[...COMMANDS].join(', ')}`);
  }
  const { positional, flags } = parseArgs(argv.slice(1));
  return dispatch(cmd, positional, flags);
}

function usage() {
  return [
    `${AEP_LABEL} — node scripts/track.mjs <comando>`,
    '',
    '  status <trilha> [--json]        somente leitura',
    '  open <trilha>                   escreve só .aep-active (gitignored)',
    '  check <trilha>                  somente leitura; 12 verificações',
    '  close <trilha>                  ratifica: ledger + state + registry + commit aep(...)',
    '  attempt <trilha> --fail --reason="..."',
    '  block <trilha> --reason="..." --by=gate|dependencia|externo|decisao',
    '  init <trilha> [--risk=BAIXO|MEDIO|ALTO|CRITICO]',
    '  import <trilha> --manifest=<caminho> [--dry-run]',
    '  registry                        regenera REGISTRY.md e GATES.md',
    '  verify [<trilha>] [--all]       recalcula o estado a partir do Git',
    '  doctor                          camada local + camada remota',
    '  sync-adapters [--check]         bloco AEP:BEGIN/END nos adaptadores da raiz',
    '  hook pre-commit | hook commit-msg <arquivo>',
    '',
  ].join('\n');
}

const entry = toPosix(process.argv[1] || '');
const isDirect = entry.endsWith('/track.mjs') || entry.endsWith('track.mjs');
if (isDirect) {
  try {
    const code = await main();
    process.exit(typeof code === 'number' ? code : 0);
  } catch (err) {
    if (err instanceof AepError) {
      printFail(err);
      process.exit(err.code);
    }
    process.stderr.write(`FALHA [1] erro interno\n  evidência: node scripts/track.mjs → ${oneLine(err && err.stack)}\n  ação: reporte o stack acima; nada foi escrito.\n`);
    process.exit(1);
  }
}
