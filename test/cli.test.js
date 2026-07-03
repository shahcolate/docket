// End-to-end CLI tests: run the real binary in a temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;

function docket(cwd, args, { expectExit = 0 } = {}) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
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
