// End-to-end tests for `docket hook`, the Claude Code PreToolUse gate: run
// the real binary with a hook payload on stdin, assert on the JSON decision.
// The invariant under test everywhere: no failure mode ever fails open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;

const LOOP = `---
name: repo-work
description: gated repo work for the hook tests
version: 1
warrant:
  read:
    - "*docs/*"
  change:
    - "*README.md*"
  send: []
  ask:
    - anything in src
  never:
    - git hooks, CI workflows, or scheduled jobs
---

# Brief

Hook test loop.

# Procedure

Gate everything.
`;

function project(extraLoops = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-hook-'));
  fs.mkdirSync(path.join(dir, '.docket', 'loops'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.docket', 'loops', 'repo-work.loop.md'), LOOP);
  for (const [name, text] of Object.entries(extraLoops)) {
    fs.writeFileSync(path.join(dir, '.docket', 'loops', `${name}.loop.md`), text);
  }
  return dir;
}

function hook(cwd, payload, args = []) {
  const out = execFileSync(process.execPath, [BIN, 'hook', ...args], {
    cwd,
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', DOCKET_DIR: '' },
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  return parsed.hookSpecificOutput;
}

test('warranted read is allowed', () => {
  const dir = project();
  const d = hook(dir, { tool_name: 'Read', tool_input: { file_path: '/repo/docs/guide.md' }, cwd: dir });
  assert.equal(d.permissionDecision, 'allow');
  assert.match(d.permissionDecisionReason, /read warrant/);
});

test('the scheduled escape is denied at the harness: a write to .git/hooks', () => {
  const dir = project();
  const d = hook(dir, {
    tool_name: 'Write',
    tool_input: { file_path: '/repo/.git/hooks/post-merge', content: 'evil' },
    cwd: dir,
  });
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /never: git hooks/);
});

test('a Bash command planting a git hook is denied too', () => {
  const dir = project();
  const d = hook(dir, {
    tool_name: 'Bash',
    tool_input: { command: 'echo pwned > .git/hooks/post-checkout' },
    cwd: dir,
  });
  assert.equal(d.permissionDecision, 'deny');
});

test('unknown and MCP tools map to send and fall to ask by default', () => {
  const dir = project();
  const d = hook(dir, {
    tool_name: 'mcp__slack__send_message',
    tool_input: { channel: '#general', text: 'hi' },
    cwd: dir,
  });
  assert.equal(d.permissionDecision, 'ask');
  assert.match(d.permissionDecisionReason, /not listed under `send`/);
});

test('ask list screens the target before the allow list', () => {
  const dir = project();
  const d = hook(dir, { tool_name: 'Edit', tool_input: { file_path: '/repo/src/README.md' }, cwd: dir });
  assert.equal(d.permissionDecision, 'ask');
  assert.match(d.permissionDecisionReason, /ask: anything in src/);
});

test('a single loop is picked automatically; the check lands in the record', () => {
  const dir = project();
  hook(dir, { tool_name: 'Read', tool_input: { file_path: '/repo/docs/a.md' }, cwd: dir });
  const record = fs.readFileSync(path.join(dir, '.docket', 'record.jsonl'), 'utf8').trim();
  const entry = JSON.parse(record.split('\n').at(-1));
  assert.equal(entry.kind, 'check');
  assert.equal(entry.via, 'hook');
  assert.equal(entry.tool, 'Read');
  assert.equal(entry.loop, 'repo-work');
  assert.equal(entry.verdict, 'allow');
});

test('--loop selects among multiple loops; ambiguity without it gates to ask', () => {
  const other = LOOP.replace(/repo-work/g, 'other-loop');
  const dir = project({ 'other-loop': other });
  const ambiguous = hook(dir, { tool_name: 'Read', tool_input: { file_path: '/repo/docs/a.md' }, cwd: dir });
  assert.equal(ambiguous.permissionDecision, 'ask');
  assert.match(ambiguous.permissionDecisionReason, /--loop/);
  const explicit = hook(dir, { tool_name: 'Read', tool_input: { file_path: '/repo/docs/a.md' }, cwd: dir }, ['--loop', 'repo-work']);
  assert.equal(explicit.permissionDecision, 'allow');
});

test('every misconfiguration fails toward ask, never open', () => {
  const dir = project();
  // garbage stdin
  assert.equal(hook(dir, 'not json{').permissionDecision, 'ask');
  // no tool_name
  assert.equal(hook(dir, { tool_input: {} }).permissionDecision, 'ask');
  // no .docket anywhere near cwd
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-nohook-'));
  const d = hook(bare, { tool_name: 'Read', tool_input: { file_path: 'x' }, cwd: bare });
  assert.equal(d.permissionDecision, 'ask');
  assert.match(d.permissionDecisionReason, /no \.docket directory/);
  // named loop does not exist
  assert.equal(
    hook(dir, { tool_name: 'Read', tool_input: { file_path: 'x' }, cwd: dir }, ['--loop', 'missing']).permissionDecision,
    'ask'
  );
});

test('--no-record leaves no trace; the decision still comes back', () => {
  const dir = project();
  const d = hook(dir, { tool_name: 'Read', tool_input: { file_path: '/repo/docs/a.md' }, cwd: dir }, ['--no-record']);
  assert.equal(d.permissionDecision, 'allow');
  assert.ok(!fs.existsSync(path.join(dir, '.docket', 'record.jsonl')));
});
