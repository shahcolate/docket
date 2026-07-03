// Regression tests for the findings of the initial code review.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseYaml, dumpYaml } from '../src/lib/yaml.js';
import { parseLoop, extractSections, LoopError } from '../src/lib/loop.js';
import { checkWarrant, matchPattern } from '../src/lib/warrant.js';
import { parseArgs } from '../src/lib/args.js';
import {
  appendRecord,
  readLastRecord,
  verifyRecord,
  collectRecordFields,
  recordFile,
} from '../src/lib/record.js';
import { renderLoop, compileToFile } from '../src/lib/compile.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function mkLoop(boundary) {
  return parseLoop(`---\nname: x\nwarrant:\n${boundary}\n---\n`);
}

// ── boundary: allow is strict, ask/never stay cautious ──────────────────

test('a vague target no longer inherits permission from a specific allow entry', () => {
  const loop = mkLoop('  send:\n    - status update email to the team');
  assert.equal(checkWarrant(loop, 'send', 'email').verdict, 'ask');
  assert.equal(checkWarrant(loop, 'send', 'status').verdict, 'ask');
  // but a target that covers the pattern still allows
  assert.equal(
    checkWarrant(loop, 'send', 'the weekly status update email to the team').verdict,
    'allow'
  );
});

test('vague targets still match ask/never (cautious direction unchanged)', () => {
  const loop = mkLoop('  send:\n    - reports\n  never:\n    - wiring funds to external accounts');
  assert.equal(checkWarrant(loop, 'send', 'funds').verdict, 'deny');
});

test('an all-stopword never pattern is a wildcard, not a no-op', () => {
  const loop = mkLoop('  send:\n    - reports\n  never:\n    - anything');
  assert.equal(checkWarrant(loop, 'send', 'reports').verdict, 'deny');
});

test('commas, "or", and "and" split patterns into alternatives', () => {
  assert.ok(matchPattern('secrets, tokens, or passwords', 'storing the API token'));
  assert.ok(matchPattern('family dinners, family commitments, or family events', 'rescheduling family dinner'));
  assert.ok(!matchPattern('secrets, tokens, or passwords', 'a public blog post'));
});

test('stemming matches across plural/gerund forms in both directions', () => {
  assert.ok(matchPattern('made-up customer quotes', 'a made-up customer quote for the homepage'));
  assert.ok(matchPattern('contacting the insurer', 'insurer contact form'));
  assert.ok(matchPattern("a loop's boundary sections", 'the boundary section of a loop'));
});

// ── yaml: quoting and hand-written list styles ───────────────────────────

test('values with embedded double quotes round-trip exactly', () => {
  const original = { description: 'say "urgent" to: client', judgment: ['reply "approved": never'] };
  assert.deepEqual(parseYaml(dumpYaml(original)), original);
});

test('single-quoted scalars unescape doubled quotes', () => {
  assert.deepEqual(parseYaml("a: 'it''s fine'"), { a: "it's fine" });
});

test('list items at the same indent as their key parse (common hand-written style)', () => {
  const doc = parseYaml('judgment:\n- final approval\n- budget\nname: x');
  assert.deepEqual(doc, { judgment: ['final approval', 'budget'], name: 'x' });
});

// ── loop: sections and name enforcement ──────────────────────────────────

test('subheadings and fenced code stay inside Brief/Procedure', () => {
  const s = extractSections(
    '# Brief\nfacts.\n### Contacts\n- Dr. Chen\n```bash\n# install deps\nnpm i\n```\nmore facts.\n# Procedure\nsteps.'
  );
  assert.match(s.brief, /Dr\. Chen/);
  assert.match(s.brief, /install deps/);
  assert.match(s.brief, /more facts\./);
  assert.equal(s.procedure, 'steps.');
});

test('loop name must match the filename', () => {
  assert.throws(
    () => parseLoop('---\nname: refunds\n---\n', { file: '/x/billing.loop.md' }),
    /must match/
  );
});

test('future spec versions are rejected, not silently misread', () => {
  assert.throws(() => parseLoop('---\nname: x\nversion: 2\n---\n'), /version 2/);
});

// ── args: flag values are never silently dropped ─────────────────────────

test('a value starting with -- is kept as the value', () => {
  const { flags } = parseArgs(['--note', '--urgent: follow up'], { booleans: [] });
  assert.equal(flags.note, '--urgent: follow up');
});

test('collectRecordFields surfaces dropped fields instead of losing them', () => {
  const { fields, dropped } = collectRecordFields({ did: true, note: 'ok' });
  assert.deepEqual(fields, { note: 'ok' });
  assert.deepEqual(dropped, ['did']);
});

// ── receipts: tail reads and truncation pinning ──────────────────────────

test('readLastRecord returns the newest entry and appends chain from it', () => {
  const dir = tmp('docket-tail-');
  for (let i = 1; i <= 50; i++) appendRecord(dir, { loop: 'x', kind: 'note', did: `s${i}` });
  const last = readLastRecord(dir);
  assert.equal(last.seq, 50);
  const next = appendRecord(dir, { loop: 'x', kind: 'note', did: 's51' });
  assert.equal(next.seq, 51);
  assert.equal(next.prev, last.hash);
  assert.equal(verifyRecord(dir).ok, true);
});

test('verify --head catches tail truncation the chain alone cannot see', () => {
  const dir = tmp('docket-trunc-');
  for (let i = 1; i <= 5; i++) appendRecord(dir, { loop: 'x', kind: 'note', did: `s${i}` });
  const { head } = verifyRecord(dir);
  const lines = fs.readFileSync(recordFile(dir), 'utf8').trim().split('\n');
  fs.writeFileSync(recordFile(dir), lines.slice(0, 2).join('\n') + '\n');
  assert.equal(verifyRecord(dir).ok, true, 'plain verify cannot detect tail truncation');
  const pinned = verifyRecord(dir, { expectHead: head });
  assert.equal(pinned.ok, false);
  assert.match(pinned.problem, /truncated/);
});

// ── compile: markers cannot be injected or orphaned into data loss ───────

test('loop content quoting the end marker cannot corrupt recompiles', () => {
  const loop = parseLoop(
    '---\nname: meta\n---\n# Brief\nlook between `<!-- docket:begin -->` and `<!-- docket:end -->` markers.\n'
  );
  assert.ok(!renderLoop(loop).includes('<!-- docket:end -->'));
  const dir = tmp('docket-compile-');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# mine\n\nkeep me.\n');
  compileToFile(dir, 'claude', [loop]);
  const once = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  compileToFile(dir, 'claude', [loop]);
  compileToFile(dir, 'claude', [loop]);
  const thrice = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(once, thrice, 'recompiling must be idempotent even with quoted markers');
  assert.match(thrice, /keep me\./);
});

test('an orphaned begin marker errors instead of eating user content', () => {
  const loop = parseLoop('---\nname: x\n---\n# Brief\nm\n');
  const dir = tmp('docket-orphan-');
  compileToFile(dir, 'claude', [loop]);
  const file = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('<!-- docket:end -->', '') + '\nhand-written notes\n'
  );
  assert.throws(() => compileToFile(dir, 'claude', [loop]), /docket:end/);
  assert.match(fs.readFileSync(file, 'utf8'), /hand-written notes/);
});

// ── CLI-level integration for the same fixes ─────────────────────────────

function docket(cwd, args, env = {}) {
  return execFileSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...env },
  });
}

test('new --template writes the new name and receipts attribute correctly', () => {
  const dir = tmp('docket-rename-');
  docket(dir, ['init', '--quiet']);
  docket(dir, ['new', 'my-appeal', '--template', 'insurance-appeal']);
  const text = fs.readFileSync(path.join(dir, '.docket', 'loops', 'my-appeal.loop.md'), 'utf8');
  assert.match(text, /^name: my-appeal$/m);
  try {
    docket(dir, ['check', 'my-appeal', 'draft', 'appeal letter']);
  } catch (err) {
    assert.fail(String(err.stdout) + String(err.stderr));
  }
  assert.match(docket(dir, ['record', 'log', 'my-appeal']), /allow draft/);
});

test('init creates a nested project even when an ancestor has .docket', () => {
  const parent = tmp('docket-nested-');
  docket(parent, ['init', '--quiet']);
  const child = path.join(parent, 'project');
  fs.mkdirSync(child);
  const out = docket(child, ['init', '--quiet']);
  assert.match(out, /exists above/);
  assert.ok(fs.existsSync(path.join(child, '.docket', 'loops')));
});

test('compile --loop --write is refused instead of deleting other loops', () => {
  const dir = tmp('docket-loopwrite-');
  docket(dir, ['init', '--quiet']);
  docket(dir, ['new', 'a', '--blank']);
  docket(dir, ['new', 'b', '--blank']);
  docket(dir, ['compile', '--target', 'claude', '--write']);
  assert.throws(
    () => docket(dir, ['compile', '--target', 'claude', '--write', '--loop', 'a']),
    /previewing/
  );
  const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /Loop: a/);
  assert.match(claude, /Loop: b/);
});

test('mcp serves from --dir regardless of cwd, and degrades gracefully without a project', () => {
  const dir = tmp('docket-mcpdir-');
  docket(dir, ['init', '--quiet']);
  docket(dir, ['new', 'x', '--blank']);
  const elsewhere = tmp('docket-elsewhere-');
  const reqs =
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'docket_list_loops', arguments: {} } },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n';
  const out = execFileSync(process.execPath, [BIN, 'mcp', '--dir', dir], {
    cwd: elsewhere,
    input: reqs,
    encoding: 'utf8',
  });
  const responses = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(responses[0].result.serverInfo.name, 'docket');
  assert.match(responses[1].result.content[0].text, /x:/);

  // no project anywhere: initialize still works, tools/call explains
  const bare = execFileSync(process.execPath, [BIN, 'mcp'], {
    cwd: elsewhere,
    input: reqs,
    encoding: 'utf8',
  });
  const bareResponses = bare.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(bareResponses[0].result.serverInfo.name, 'docket');
  assert.equal(bareResponses[1].result.isError, true);
  assert.match(bareResponses[1].result.content[0].text, /--dir/);
});
