import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendRecord,
  readRecords,
  verifyRecord,
  recordFile,
} from '../src/lib/record.js';

function tmpDocket() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docket-test-'));
}

test('appends a chained entry', () => {
  const dir = tmpDocket();
  const a = appendRecord(dir, { loop: 'x', kind: 'note', did: 'first' });
  const b = appendRecord(dir, { loop: 'x', kind: 'note', did: 'second' });
  assert.equal(a.seq, 1);
  assert.equal(a.prev, 'GENESIS');
  assert.equal(b.seq, 2);
  assert.equal(b.prev, a.hash);
  assert.match(b.hash, /^sha256:[0-9a-f]{64}$/);
});

test('verify passes on an intact chain (and an empty one)', () => {
  const dir = tmpDocket();
  assert.equal(verifyRecord(dir).ok, true);
  for (let i = 0; i < 5; i++) appendRecord(dir, { loop: 'x', kind: 'note', did: `step ${i}` });
  const result = verifyRecord(dir);
  assert.equal(result.ok, true);
  assert.equal(result.count, 5);
});

test('verify catches a modified entry', () => {
  const dir = tmpDocket();
  appendRecord(dir, { loop: 'x', kind: 'note', did: 'honest work' });
  appendRecord(dir, { loop: 'x', kind: 'note', did: 'more honest work' });
  const file = recordFile(dir);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('honest work', 'revised story'));
  const result = verifyRecord(dir);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 1);
  assert.match(result.problem, /modified/);
});

test('verify catches a deleted entry', () => {
  const dir = tmpDocket();
  for (let i = 1; i <= 3; i++) appendRecord(dir, { loop: 'x', kind: 'note', did: `step ${i}` });
  const file = recordFile(dir);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
  const result = verifyRecord(dir);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2);
});

test('verify catches reordering', () => {
  const dir = tmpDocket();
  for (let i = 1; i <= 3; i++) appendRecord(dir, { loop: 'x', kind: 'note', did: `step ${i}` });
  const file = recordFile(dir);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, [lines[0], lines[2], lines[1]].join('\n') + '\n');
  assert.equal(verifyRecord(dir).ok, false);
});

test('readRecords returns entries in order', () => {
  const dir = tmpDocket();
  appendRecord(dir, { loop: 'a', kind: 'note', did: 'one' });
  appendRecord(dir, { loop: 'b', kind: 'note', did: 'two' });
  const entries = readRecords(dir);
  assert.deepEqual(
    entries.map((e) => e.did),
    ['one', 'two']
  );
});
