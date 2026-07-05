// Metrics are derived from the record — so build a real record and assert the
// numbers, both at the pure-function layer and end-to-end through the binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeMetrics } from '../src/lib/metrics.js';
import { appendRecord } from '../src/lib/record.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

function check(loop, verdict, via = 'hook') {
  return { loop, kind: 'check', action: 'change', target: 't', verdict, rule: 'r', via };
}

test('verdict split, rates, and unattended run compute from checks', () => {
  const entries = [
    check('a', 'allow'), check('a', 'allow'), check('a', 'ask'),
    check('a', 'allow'), check('a', 'allow'), check('a', 'allow'), check('a', 'deny'),
    { loop: 'a', kind: 'note', did: 'x', stopped: 'before prod' },
    { loop: 'a', kind: 'amend', action: 'read', added: 'logs', asks: 3 },
  ];
  const m = computeMetrics(entries);
  assert.equal(m.checks, 7);
  assert.deepEqual(m.verdict, { allow: 5, ask: 1, deny: 1 });
  assert.equal(m.longestUnattendedRun, 3, 'the middle run of 3 allows');
  assert.equal(m.amendments, 1);
  assert.equal(m.work.notes, 1);
  assert.equal(m.work.withStop, 1);
  // 7 checks / 2 interventions (1 ask + 1 deny) = 3.5
  assert.equal(m.actionsPerIntervention, 3.5);
  assert.ok(Math.abs(m.rates.autoApproved - 5 / 7) < 1e-9);
});

test('--loop filter scopes every number to one loop', () => {
  const entries = [check('a', 'allow'), check('b', 'ask'), check('b', 'deny')];
  const m = computeMetrics(entries, { loop: 'b' });
  assert.equal(m.checks, 2);
  assert.deepEqual(m.verdict, { allow: 0, ask: 1, deny: 1 });
  assert.deepEqual(Object.keys(m.byLoop), ['b']);
});

test('no interventions → actions-per-intervention is the full count', () => {
  const m = computeMetrics([check('a', 'allow'), check('a', 'allow')]);
  assert.equal(m.actionsPerIntervention, 2);
  assert.equal(m.longestUnattendedRun, 2);
});

test('empty record yields zeroed, non-crashing metrics', () => {
  const m = computeMetrics([]);
  assert.equal(m.checks, 0);
  assert.equal(m.actionsPerIntervention, 0);
  assert.equal(m.span, null);
});

test('docket metrics runs end-to-end and emits --json from a real record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-metrics-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  const docketDir = path.join(dir, '.docket');
  appendRecord(docketDir, check('appeal', 'allow', 'cli'));
  appendRecord(docketDir, check('appeal', 'ask', 'mcp'));

  const out = execFileSync(process.execPath, [BIN, 'metrics', '--json'], { cwd: dir, encoding: 'utf8', env: ENV });
  const m = JSON.parse(out);
  assert.equal(m.checks, 2);
  assert.equal(m.verdict.allow, 1);
  assert.equal(m.verdict.ask, 1);
  assert.deepEqual(m.byChannel, { cli: 1, mcp: 1 });

  const human = execFileSync(process.execPath, [BIN, 'metrics'], { cwd: dir, encoding: 'utf8', env: ENV });
  assert.match(human, /Warrant checks\s+2/);
  assert.match(human, /ran on its own/);
});
