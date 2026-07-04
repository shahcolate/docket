// End-to-end tests for `docket install`: run the real binary in a temp repo
// and assert the ambient setup it produces — compiled context, a merge-safe
// PreToolUse hook, an MCP config — is correct, idempotent, and never clobbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

function docket(cwd, args) {
  return execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: ENV });
}

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-install-'));
  docket(dir, ['init', '--quiet']);
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  return dir;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('install compiles context for every agent target', () => {
  const dir = repo();
  docket(dir, ['install', '--quiet']);
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', path.join('.cursor', 'rules', 'docket.mdc')]) {
    const p = path.join(dir, f);
    assert.ok(fs.existsSync(p), `${f} should exist`);
    assert.match(fs.readFileSync(p, 'utf8'), /docket:begin/);
  }
});

test('install wires a Claude Code PreToolUse hook in pass-through mode', () => {
  const dir = repo();
  docket(dir, ['install', '--quiet']);
  const s = readJson(path.join(dir, '.claude', 'settings.json'));
  const entries = s.hooks.PreToolUse;
  assert.equal(entries.length, 1);
  const cmd = entries[0].hooks[0].command;
  assert.match(cmd, /docket-agent hook claude/);
  assert.doesNotMatch(cmd, /--loop/, 'pass-through by default: no pinned loop');
  assert.doesNotMatch(cmd, /--strict/, 'pass-through by default: not strict');
});

test('--loop and --strict change the hook posture', () => {
  const dir = repo();
  docket(dir, ['install', '--quiet', '--loop', 'appeal', '--strict']);
  const cmd = readJson(path.join(dir, '.claude', 'settings.json')).hooks.PreToolUse[0].hooks[0].command;
  assert.match(cmd, /hook claude --loop appeal --strict/);
});

test('install writes an MCP server config', () => {
  const dir = repo();
  docket(dir, ['install', '--quiet']);
  const mcp = readJson(path.join(dir, '.mcp.json'));
  assert.deepEqual(mcp.mcpServers.docket, { command: 'npx', args: ['-y', 'docket-agent', 'mcp'] });
});

test('install merges into existing settings.json without clobbering other hooks', () => {
  const dir = repo();
  const settingsFile = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    })
  );
  docket(dir, ['install', '--quiet']);
  const s = readJson(settingsFile);
  assert.deepEqual(s.permissions, { allow: ['Bash(ls:*)'] }, 'unrelated settings preserved');
  const commands = s.hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(commands.includes('echo mine'), 'existing hook preserved');
  assert.ok(commands.some((c) => /docket-agent hook/.test(c)), 'docket hook added');
});

test('install is idempotent — re-running does not duplicate the hook', () => {
  const dir = repo();
  docket(dir, ['install', '--quiet']);
  docket(dir, ['install', '--quiet']);
  const s = readJson(path.join(dir, '.claude', 'settings.json'));
  const docketEntries = s.hooks.PreToolUse.filter((e) =>
    e.hooks.some((h) => /docket-agent hook/.test(h.command))
  );
  assert.equal(docketEntries.length, 1, 'exactly one docket hook after two installs');
});

test('install refuses to clobber a settings.json it cannot parse', () => {
  const dir = repo();
  const settingsFile = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, '{ not valid json ');
  assert.throws(
    () => docket(dir, ['install', '--quiet']),
    /isn't valid JSON|Refusing to overwrite/,
  );
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{ not valid json ', 'file left untouched');
});

test('install runs init itself when the repo has no .docket yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-install-bare-'));
  const out = docket(dir, ['install']);
  assert.ok(fs.existsSync(path.join(dir, '.docket', 'loops')));
  // No loops yet → context compile is skipped with a note, hook/mcp still written.
  assert.match(out, /no loops yet/);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')));
  assert.ok(fs.existsSync(path.join(dir, '.mcp.json')));
});

test('--no-hook and --no-mcp scope the install to context only', () => {
  const dir = repo();
  docket(dir, ['install', '--quiet', '--no-hook', '--no-mcp']);
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'settings.json')));
  assert.ok(!fs.existsSync(path.join(dir, '.mcp.json')));
});
