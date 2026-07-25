// Parallel agents must not break the chain.
//
// Appending is read-the-head-then-write, and that pair has to be atomic. Two
// agents in two worktrees would otherwise both chain to entry 5 and both write
// entry 6 — and `verify` would report tampering that nobody did. A false
// tamper alarm is worse than no alarm: it trains people to ignore the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendRecord,
  readRecords,
  verifyRecord,
  recordFile,
  withRecordLock,
  RecordLockError,
} from '../src/lib/record.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docket-conc-'));
}

// Genuinely concurrent: all children are spawned before any is awaited. A
// loop of execFileSync would serialize them and test nothing.
function runAllAtOnce(commands) {
  return Promise.all(
    commands.map(
      ({ args, cwd, env }) =>
        new Promise((resolve, reject) => {
          const p = spawn('node', args, { cwd, env: { ...ENV, ...env }, stdio: 'ignore' });
          p.on('error', reject);
          p.on('close', resolve);
        })
    )
  );
}

test('concurrent writers from separate processes keep the chain intact', async () => {
  const dir = tmpDir();
  const docketDir = path.join(dir, '.docket');
  fs.mkdirSync(docketDir);
  const writer = path.join(dir, 'writer.mjs');
  const recordLib = new URL('../src/lib/record.js', import.meta.url).pathname;
  fs.writeFileSync(
    writer,
    `import { appendRecord } from ${JSON.stringify(recordLib)};
     const [dir, id] = process.argv.slice(2);
     for (let i = 0; i < 12; i++) appendRecord(dir, { loop: 'x', kind: 'note', did: id + '-' + i }, { by: id });`
  );

  const AGENTS = 5;
  await runAllAtOnce(
    Array.from({ length: AGENTS }, (_, i) => ({ args: [writer, docketDir, `agent-${i}`] }))
  );

  const result = verifyRecord(docketDir);
  assert.equal(result.ok, true, `chain broken: ${result.problem}`);
  assert.equal(result.count, AGENTS * 12, 'every write landed — no entry lost to a lost race');

  // Every agent's work is present and attributable.
  const entries = readRecords(docketDir);
  for (let i = 0; i < AGENTS; i++) {
    assert.equal(entries.filter((e) => e.by === `agent-${i}`).length, 12);
  }
  // seq is dense and ordered — the property `verify` depends on.
  assert.deepEqual(
    entries.map((e) => e.seq),
    entries.map((_, i) => i + 1)
  );
});

test('the lock is released even when the write throws', () => {
  const dir = tmpDir();
  assert.throws(() => withRecordLock(dir, () => {
    throw new Error('disk full');
  }), /disk full/);
  assert.equal(fs.existsSync(recordFile(dir) + '.lock'), false, 'a crashed write must not wedge the record');
  // And the next writer proceeds normally.
  assert.equal(appendRecord(dir, { loop: 'x', kind: 'note', did: 'after' }).seq, 1);
});

test('a stale lock from a dead process is broken, not waited out', () => {
  const dir = tmpDir();
  const lock = recordFile(dir) + '.lock';
  fs.writeFileSync(lock, '');
  // Backdate past the stale threshold: this is what a holder killed mid-write
  // leaves behind. The record must not be wedged forever by a dead process.
  const old = Date.now() - 60_000;
  fs.utimesSync(lock, old / 1000, old / 1000);

  const started = Date.now();
  const entry = appendRecord(dir, { loop: 'x', kind: 'note', did: 'recovered' });
  assert.equal(entry.seq, 1);
  assert.ok(Date.now() - started < 5_000, 'breaking a stale lock should be immediate');
  assert.equal(verifyRecord(dir).ok, true);
});

test('a live lock held past the deadline fails loudly, never silently', () => {
  const dir = tmpDir();
  const lock = recordFile(dir) + '.lock';
  fs.writeFileSync(lock, '');
  // Fresh mtime = a live holder. We refuse to wait forever, and we refuse to
  // write unlocked: the caller hears about it rather than the chain breaking.
  assert.throws(
    () => withRecordLock(dir, () => 'never runs', { waitMs: 40 }),
    (err) => err instanceof RecordLockError && /could not lock/.test(err.message)
  );
  fs.unlinkSync(lock);
});

test('end to end: parallel `docket check` calls leave a verifiable record', async () => {
  const dir = tmpDir();
  execFileSync('node', [BIN, 'init'], { cwd: dir, env: ENV });
  execFileSync('node', [BIN, 'new', 'deploy', '--template', 'prod-hotfix'], { cwd: dir, env: ENV });

  await runAllAtOnce(
    Array.from({ length: 6 }, (_, i) => ({
      args: [BIN, 'check', 'deploy', 'read', `log file ${i}`, '--quiet'],
      cwd: dir,
      env: { DOCKET_BY: `agent-${i}` },
    }))
  );

  const docketDir = path.join(dir, '.docket');
  assert.equal(verifyRecord(docketDir).ok, true);
  assert.equal(readRecords(docketDir).length, 6);
});
