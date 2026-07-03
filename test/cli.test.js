// End-to-end CLI tests: run the real binary in a temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;

function docket(cwd, args, { expectExit = 0, input } = {}) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      input,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    assert.equal(0, expectExit, `expected exit ${expectExit}, got 0\n${out}`);
    return out;
  } catch (err) {
    assert.equal(
      err.status,
      expectExit,
      `expected exit ${expectExit}, got ${err.status}\n${err.stdout}\n${err.stderr}`
    );
    return (err.stdout ?? '') + (err.stderr ?? '');
  }
}

function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-cli-'));
  docket(dir, ['init']);
  return dir;
}

test('init creates .docket and is idempotent', () => {
  const dir = freshProject();
  assert.ok(fs.existsSync(path.join(dir, '.docket', 'loops')));
  const again = docket(dir, ['init']);
  assert.match(again, /already initialized/);
});

test('templates lists all seven starters', () => {
  const dir = freshProject();
  const out = docket(dir, ['templates']);
  for (const t of [
    'insurance-appeal',
    'client-follow-up',
    'travel-morning',
    'weekly-planning',
    'marketing-brain',
    'ticket-handoff',
    'cross-tool-memory',
  ]) {
    assert.match(out, new RegExp(t));
  }
});

test('new from template, list, show', () => {
  const dir = freshProject();
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  assert.ok(fs.existsSync(path.join(dir, '.docket', 'loops', 'appeal.loop.md')));
  assert.match(docket(dir, ['list']), /appeal/);
  const shown = docket(dir, ['show', 'appeal']);
  assert.match(shown, /Brief/);
  assert.match(shown, /Warrant/);
  assert.match(shown, /Silence is never permission/);
});

test('new without a TTY writes a valid scaffold', () => {
  const dir = freshProject();
  docket(dir, ['new', 'my-loop']);
  const text = fs.readFileSync(path.join(dir, '.docket', 'loops', 'my-loop.loop.md'), 'utf8');
  assert.match(text, /^---\nname: my-loop\n/);
  docket(dir, ['show', 'my-loop']);
});

test('match routes a task to its loop; no coverage exits 2', () => {
  const dir = freshProject();
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  docket(dir, ['new', 'followup', '--template', 'client-follow-up']);

  const hit = docket(dir, ['match', 'draft an appeal for my denied claim']);
  assert.match(hit, /appeal/);
  assert.match(hit, /trigger/);

  const none = docket(dir, ['match', 'wire funds to a vendor'], { expectExit: 2 });
  assert.match(none, /NO LOOP/);
  assert.match(none, /defaults to ask/);

  docket(dir, ['match'], { expectExit: 1 });
});

// The guided creator reads answers line by line; --guided forces it on
// without a TTY so the whole tour is testable through a pipe.
const GUIDED_ANSWERS = [
  'Build the appeal, cite the policy.', // description
  'the denial reason code and the appeal deadline', // brief
  'read the denial letter first', // procedure
  'policy documents, denial letter', // read
  'appeal letter', // draft
  '', // change
  '', // send
  'contacting the insurer', // ask
  'accepting a settlement', // never
  'signing and sending', // reserved
  'every policy clause cited', // record
];

test('guided creator walks the five layers, previews, writes, and demos verdicts', () => {
  const dir = freshProject();
  const input = ['appeal', ...GUIDED_ANSWERS, 'y'].join('\n') + '\n';
  const out = docket(dir, ['new', '--guided'], { input });
  for (const n of [1, 2, 3, 4, 5]) assert.match(out, new RegExp(`Step ${n} of 5`));
  assert.match(out, /Unlisted means ask/);
  // the live demo shows all three verdicts against the warrant just written
  assert.match(out, /ALLOW\s+read → "policy documents"/);
  assert.match(out, /ASK\s+send → /);
  assert.match(out, /DENY\s+change → "accepting a settlement"/);
  const text = fs.readFileSync(path.join(dir, '.docket', 'loops', 'appeal.loop.md'), 'utf8');
  assert.match(text, /^---\nname: appeal\n/);
  assert.match(text, /never:\n    - accepting a settlement/);
  assert.match(text, /# Brief\n\n- the denial reason code/);
  // the written file is immediately usable by the rest of the CLI
  docket(dir, ['check', 'appeal', 'draft', 'appeal letter']);
  // demo checks are demonstrations, not agent checks — only ours is recorded
  assert.equal(docket(dir, ['record', 'log']).trim().split('\n').filter((l) => /appeal/.test(l)).length, 1);
});

test('guided creator re-asks on invalid or taken names and honors declining the write', () => {
  const dir = freshProject();
  docket(dir, ['new', 'taken', '--template', 'insurance-appeal']);
  const input = ['Bad Name', 'taken', 'appeal', ...GUIDED_ANSWERS, 'n'].join('\n') + '\n';
  const out = docket(dir, ['new', '--guided'], { input, expectExit: 1 });
  assert.match(out, /lowercase letters, digits, and dashes/);
  assert.match(out, /already exists/);
  assert.match(out, /not written/);
  assert.ok(!fs.existsSync(path.join(dir, '.docket', 'loops', 'appeal.loop.md')));
});

test('guided creator aborts cleanly when input runs out', () => {
  const dir = freshProject();
  const out = docket(dir, ['new', 'appeal', '--guided'], { input: 'desc\n', expectExit: 1 });
  assert.match(out, /cancelled — nothing written/);
  assert.ok(!fs.existsSync(path.join(dir, '.docket', 'loops', 'appeal.loop.md')));
});

test('new without a name and without a TTY is a usage error', () => {
  const dir = freshProject();
  const out = docket(dir, ['new'], { expectExit: 1 });
  assert.match(out, /usage: docket new/);
});

test('check verdicts and exit codes: allow=0 ask=2 deny=3', () => {
  const dir = freshProject();
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);

  const allow = docket(dir, ['check', 'appeal', 'draft', 'appeal letter']);
  assert.match(allow, /ALLOW/);

  const ask = docket(dir, ['check', 'appeal', 'send', 'appeal email addressed to the insurer'], {
    expectExit: 2,
  });
  assert.match(ask, /ASK/);

  const deny = docket(
    dir,
    ['check', 'appeal', 'change', 'accepting or rejecting a settlement'],
    { expectExit: 3 }
  );
  assert.match(deny, /DENY/);

  const unlisted = docket(dir, ['check', 'appeal', 'send', 'a tweet'], { expectExit: 2 });
  assert.match(unlisted, /not listed/);
});

test('checks are recorded as receipts; verify passes; tamper breaks it', () => {
  const dir = freshProject();
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  docket(dir, ['check', 'appeal', 'draft', 'appeal letter']);
  docket(dir, ['record', 'add', 'appeal', '--did', 'drafted the appeal', '--stopped', 'before send']);

  const log = docket(dir, ['record', 'log']);
  assert.match(log, /allow draft/);
  assert.match(log, /did: drafted the appeal/);
  assert.match(docket(dir, ['record', 'verify']), /chain intact/);

  const file = path.join(dir, '.docket', 'record.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('drafted the appeal', 'nothing'));
  const broken = docket(dir, ['record', 'verify'], { expectExit: 1 });
  assert.match(broken, /chain broken/);
});

test('receipt add with no fields is rejected', () => {
  const dir = freshProject();
  docket(dir, ['new', 'x', '--blank']);
  const out = docket(dir, ['record', 'add', 'x'], { expectExit: 1 });
  assert.match(out, /proves nothing/);
});

test('compile writes and idempotently replaces the block', () => {
  const dir = freshProject();
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My project\n\nHand-written notes.\n');

  docket(dir, ['compile', '--target', 'claude', '--write']);
  const first = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(first, /Hand-written notes/);
  assert.match(first, /docket:begin/);
  assert.match(first, /Loop: appeal/);

  docket(dir, ['compile', '--target', 'claude', '--write']);
  const second = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(first, second, 'recompiling must not duplicate the block');
  assert.equal(second.match(/docket:begin/g).length, 1);

  docket(dir, ['compile', '--target', 'agents', '--write']);
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
  docket(dir, ['compile', '--target', 'gemini', '--write']);
  assert.ok(fs.existsSync(path.join(dir, 'GEMINI.md')));
  docket(dir, ['compile', '--target', 'cursor', '--write']);
  assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'docket.mdc')));
});

test('compile --index writes the routing table, and switching modes replaces the block', () => {
  const dir = freshProject();
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  docket(dir, ['new', 'followup', '--template', 'client-follow-up']);

  docket(dir, ['compile', '--index', '--target', 'claude', '--write']);
  const index = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(index, /Docket loops \(index\)/);
  assert.match(index, /docket_match_loop/);
  assert.match(index, /\*\*appeal\*\*/);
  assert.match(index, /triggers:/);
  assert.doesNotMatch(index, /Procedure — how this work is done/, 'index must not inline full loops');

  // Full → index → full all replace the same managed block.
  docket(dir, ['compile', '--target', 'claude', '--write']);
  docket(dir, ['compile', '--index', '--target', 'claude', '--write']);
  const again = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(again.match(/docket:begin/g).length, 1, 'mode switches must not stack blocks');

  docket(dir, ['compile', '--index', '--loop', 'appeal'], { expectExit: 1 });
});

test('raw compile prints to stdout', () => {
  const dir = freshProject();
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  const out = docket(dir, ['compile']);
  assert.match(out, /Warrant — what you may do on your own/);
});

test('commands fail cleanly outside a docket project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-empty-'));
  const out = docket(dir, ['list'], { expectExit: 1 });
  assert.match(out, /docket init/);
});

test('help and version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-empty-'));
  assert.match(docket(dir, ['help']), /keep the record/);
  assert.match(docket(dir, ['version']), /\d+\.\d+\.\d+/);
});
