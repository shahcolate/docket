// Per-agent attribution: the `by` field, and everything that reads it back.
//
// The property that matters is not "we write a string" — it's that the string
// is resolved from explicit intent first, omitted when it would be a guess
// dressed as a fact, and covered by the hash chain once written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveActor, normalizeActor, detectAgent, gitContext } from '../src/lib/actor.js';
import { appendRecord, readRecords, verifyRecord, recordFile } from '../src/lib/record.js';
import { computeMetrics } from '../src/lib/metrics.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docket-attr-'));
}

// A bare env: the host's real CLAUDECODE/CI vars must not leak into a test
// that is asserting what docket infers from an environment.
const BARE = { PATH: process.env.PATH };

test('--by beats the environment, the environment beats a guess', () => {
  const cwd = tmpDir();
  assert.equal(resolveActor({ by: 'explicit', env: { ...BARE, DOCKET_BY: 'env' }, cwd }).by, 'explicit');
  assert.equal(resolveActor({ env: { ...BARE, DOCKET_BY: 'env', CLAUDECODE: '1' }, cwd }).by, 'env');
  assert.equal(resolveActor({ env: { ...BARE, CLAUDECODE: '1' }, cwd }).by, 'claude-code');
  // Nothing to go on: fall back to the human, and say so in the shape.
  assert.match(resolveActor({ env: BARE, cwd }).by, /^user:/);
});

test('agent signals map to stable ids, first match wins', () => {
  assert.equal(detectAgent({ CURSOR_TRACE_ID: 'abc' }), 'cursor');
  assert.equal(detectAgent({ GEMINI_CLI: '1' }), 'gemini-cli');
  assert.equal(detectAgent({ GITHUB_ACTIONS: 'true' }), 'github-actions');
  assert.equal(detectAgent({}), null);
  assert.equal(detectAgent({ CLAUDECODE: '1', CURSOR_TRACE_ID: 'x' }), 'claude-code');
});

test('actor names are normalized to one short greppable line', () => {
  assert.equal(normalizeActor('  claude  code \n'), 'claude code');
  assert.equal(normalizeActor(''), null);
  assert.equal(normalizeActor('   '), null);
  assert.equal(normalizeActor(undefined), null);
  assert.equal(normalizeActor('x'.repeat(200)).length, 64);
});

test('an empty --by falls through instead of writing a blank subject', () => {
  const cwd = tmpDir();
  const actor = resolveActor({ by: '   ', env: { ...BARE, DOCKET_BY: 'fallback' }, cwd });
  assert.equal(actor.by, 'fallback');
});

test('git context reports the branch, and names a linked worktree', () => {
  const dir = tmpDir();
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  git(dir, 'init', '-q', '-b', 'trunk', '.');
  assert.equal(gitContext(dir).branch, 'trunk');
  assert.equal(gitContext(dir).worktree, undefined, 'the main checkout is not a named worktree');

  fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const wt = path.join(dir, '..', path.basename(dir) + '-wt');
  git(dir, 'worktree', 'add', '-q', wt, '-b', 'side');
  assert.equal(gitContext(wt).branch, 'side');
  assert.equal(gitContext(wt).worktree, path.basename(wt), 'linked worktrees are named');
});

test('outside a repo, attribution degrades to just `by`', () => {
  const dir = tmpDir();
  const actor = resolveActor({ by: 'agent', env: BARE, cwd: dir });
  assert.equal(actor.by, 'agent');
  assert.equal('branch' in actor, false, 'no placeholder branch');
  assert.equal('worktree' in actor, false);
});

test('every entry is stamped, and the stamp is part of the hash', () => {
  const dir = tmpDir();
  const entry = appendRecord(dir, { loop: 'x', kind: 'note', did: 'work' }, { by: 'agent-a' });
  assert.equal(entry.by, 'agent-a');

  // Rewrite the attribution of a past entry: the chain must notice. An audit
  // trail whose subject can be swapped afterward attributes nothing.
  const lines = fs.readFileSync(recordFile(dir), 'utf8').trim().split('\n');
  const forged = { ...JSON.parse(lines[0]), by: 'someone-else' };
  fs.writeFileSync(recordFile(dir), JSON.stringify(forged) + '\n');
  const result = verifyRecord(dir);
  assert.equal(result.ok, false);
  assert.match(result.problem, /modified after it was written/);
});

test('a session id rides along when the harness knows it', () => {
  const dir = tmpDir();
  const e = appendRecord(dir, { loop: 'x', kind: 'note', did: 'w' }, { by: 'a', session: 'sess-99' });
  assert.equal(e.session, 'sess-99');
  const bare = appendRecord(dir, { loop: 'x', kind: 'note', did: 'w' }, { by: 'a', env: {} });
  assert.equal('session' in bare, false, 'no session, no field');
});

test('metrics break down by agent and scope to one', () => {
  const entries = [
    { loop: 'a', kind: 'check', verdict: 'allow', by: 'claude-code', branch: 'main' },
    { loop: 'a', kind: 'check', verdict: 'allow', by: 'claude-code', branch: 'side' },
    { loop: 'a', kind: 'check', verdict: 'ask', by: 'cursor', branch: 'main' },
    { loop: 'a', kind: 'check', verdict: 'deny' }, // predates attribution
  ];
  const m = computeMetrics(entries);
  assert.equal(m.byActor['claude-code'].checks, 2);
  assert.deepEqual(m.byActor['claude-code'].branches, ['main', 'side']);
  assert.equal(m.byActor.cursor.ask, 1);
  assert.equal(m.byActor.unattributed.deny, 1, 'never guess a subject for old entries');

  const scoped = computeMetrics(entries, { by: 'claude-code' });
  assert.equal(scoped.checks, 2);
  assert.equal(scoped.verdict.allow, 2);
});

test('end to end: two agents stay separable in the log and the metrics', () => {
  const dir = tmpDir();
  const run = (args, env = {}) =>
    execFileSync('node', [BIN, ...args], { cwd: dir, env: { ...ENV, ...env }, encoding: 'utf8' });
  run(['init']);
  run(['new', 'deploy', '--template', 'prod-hotfix']);
  run(['record', 'add', 'deploy', '--did', 'first pass', '--by', 'claude-code']);
  run(['record', 'add', 'deploy', '--did', 'second pass', '--by', 'cursor']);
  run(['record', 'add', 'deploy', '--did', 'third pass'], { DOCKET_BY: 'claude-code' });

  const log = run(['record', 'log']);
  assert.match(log, /← claude-code/);
  assert.match(log, /← cursor/);

  const filtered = run(['record', 'log', '--by', 'cursor']);
  assert.match(filtered, /second pass/);
  assert.doesNotMatch(filtered, /first pass/);
  assert.match(filtered, /1 total by cursor/);

  const entries = readRecords(path.join(dir, '.docket'));
  assert.deepEqual(
    entries.map((e) => e.by),
    ['claude-code', 'cursor', 'claude-code']
  );
  assert.equal(verifyRecord(path.join(dir, '.docket')).ok, true);
});

test('record log rejects a mistyped --n instead of dumping everything', () => {
  const dir = tmpDir();
  const run = (args) =>
    execFileSync('node', [BIN, ...args], { cwd: dir, env: ENV, encoding: 'utf8' });
  run(['init']);
  run(['new', 'deploy', '--template', 'prod-hotfix']);
  for (let i = 0; i < 3; i++) run(['record', 'add', 'deploy', '--did', `entry ${i}`]);
  assert.throws(
    () => execFileSync('node', [BIN, 'record', 'log', '--n', 'abc'], { cwd: dir, env: ENV, stdio: 'pipe' }),
    /--n must be a positive number/
  );
  assert.equal(run(['record', 'log', '--n', '2']).split('\n').filter((l) => l.startsWith('#')).length, 2);
});
