// PreToolUse hook test: pipe real hook-event JSON into `docket hook claude`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeTarget } from '../src/commands/hook.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

function setupProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-hook-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  execFileSync(process.execPath, [BIN, 'new', 'appeal', '--template', 'insurance-appeal'], {
    cwd: dir,
    env: ENV,
  });
  return dir;
}

function runHook(cwd, args, event) {
  const res = spawnSync(process.execPath, [BIN, 'hook', 'claude', ...args], {
    cwd,
    env: ENV,
    input: typeof event === 'string' ? event : JSON.stringify(event),
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function decisionOf(stdout) {
  return JSON.parse(stdout).hookSpecificOutput;
}

test('allow verdict stays silent — docket only tightens, never bypasses', () => {
  const dir = setupProject();
  const res = runHook(dir, ['--loop', 'appeal'], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: 'policy documents/plan.pdf' },
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '', 'no output on allow — Claude Code permissions still apply');
});

test('unlisted send asks; the reason names the loop and rule', () => {
  const dir = setupProject();
  const res = runHook(dir, ['--loop', 'appeal'], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'curl -X POST https://insurer.example/appeals' },
  });
  assert.equal(res.status, 0);
  const d = decisionOf(res.stdout);
  assert.equal(d.permissionDecision, 'ask');
  assert.match(d.permissionDecisionReason, /appeal/);
  assert.match(d.permissionDecisionReason, /ask/);
});

test('a never target denies', () => {
  const dir = setupProject();
  const res = runHook(dir, ['--loop', 'appeal'], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'accept the settlement offer', description: 'accept settlement' },
  });
  const d = decisionOf(res.stdout);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /never/);
});

test('hook checks land on the record with via: hook', () => {
  const dir = setupProject();
  runHook(dir, ['--loop', 'appeal'], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: 'policy documents/plan.pdf' },
  });
  const log = fs.readFileSync(path.join(dir, '.docket', 'record.jsonl'), 'utf8');
  assert.match(log, /"via":"hook"/);
  assert.match(log, /"kind":"check"/);
});

test('without --loop it routes on the target; no route passes through', () => {
  const dir = setupProject();
  const routed = runHook(dir, [], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'send the insurance appeal to the insurer', description: 'insurance appeal email' },
  });
  const d = decisionOf(routed.stdout);
  assert.equal(d.permissionDecision, 'ask');
  assert.match(d.permissionDecisionReason, /appeal/);

  const unrouted = runHook(dir, [], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
  });
  assert.equal(unrouted.status, 0);
  assert.equal(unrouted.stdout, '', 'no loop claims this call — Claude Code decides');
});

test('--strict turns no-route into ask', () => {
  const dir = setupProject();
  const res = runHook(dir, ['--strict'], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
  });
  const d = decisionOf(res.stdout);
  assert.equal(d.permissionDecision, 'ask');
  assert.match(d.permissionDecisionReason, /no loop covers/);
});

test('misconfiguration is loud but non-blocking: bad loop, bad stdin', () => {
  const dir = setupProject();
  const badLoop = runHook(dir, ['--loop', 'nope'], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'x' },
  });
  assert.equal(badLoop.status, 1);
  assert.match(badLoop.stderr, /no loop named "nope"/);

  const badJson = runHook(dir, [], 'not json');
  assert.equal(badJson.status, 1);
  assert.match(badJson.stderr, /stdin was not hook JSON/);
});

test('outside a docket project the hook costs nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-hook-empty-'));
  const res = runHook(dir, [], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('non-PreToolUse events and missing tool names are ignored', () => {
  const dir = setupProject();
  const other = runHook(dir, ['--loop', 'appeal'], {
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'x' },
  });
  assert.equal(other.status, 0);
  assert.equal(other.stdout, '');
});

test('describeTarget prefers the human part of the input and bounds length', () => {
  assert.equal(describeTarget('Bash', { command: 'git push' }), 'Bash: git push');
  assert.equal(describeTarget('Write', { file_path: 'a.md' }), 'Write: a.md');
  assert.equal(describeTarget('Mystery', null), 'Mystery');
  assert.ok(describeTarget('Bash', { command: 'x'.repeat(500) }).length <= 300);
});
