import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseLoop, extractSections, LoopError } from '../src/lib/loop.js';

const VALID = `---
name: appeal
description: Build the appeal.
triggers:
  - insurance appeal, denied claim
warrant:
  read:
    - policy documents
  draft:
    - appeal letter
  ask:
    - anything addressed to the insurer
  never:
    - settlement decisions
reserved:
  - signing and sending
record:
  - clauses cited
---

# Brief

The deadline matters.

# Procedure

Read the denial first.
`;

test('parses a valid loop file', () => {
  const loop = parseLoop(VALID);
  assert.equal(loop.name, 'appeal');
  assert.deepEqual(loop.warrant.read, ['policy documents']);
  assert.deepEqual(loop.warrant.change, []); // omitted actions default to empty
  assert.deepEqual(loop.warrant.never, ['settlement decisions']);
  assert.equal(loop.brief, 'The deadline matters.');
  assert.equal(loop.procedure, 'Read the denial first.');
  assert.deepEqual(loop.reserved, ['signing and sending']);
  assert.deepEqual(loop.triggers, ['insurance appeal, denied claim']);
});

test('triggers are optional and default to empty', () => {
  const loop = parseLoop('---\nname: x\n---\n');
  assert.deepEqual(loop.triggers, []);
});

test('rejects non-list triggers', () => {
  assert.throws(() => parseLoop('---\nname: x\ntriggers: appeal\n---\n'), /must be a list/);
});

test('rejects files without frontmatter', () => {
  assert.throws(() => parseLoop('# just markdown\n'), LoopError);
});

test('rejects bad names', () => {
  assert.throws(() => parseLoop('---\nname: Bad Name\n---\n'), /lowercase/);
});

test('rejects unknown warrant keys', () => {
  assert.throws(
    () => parseLoop('---\nname: x\nwarrant:\n  execute:\n    - stuff\n---\n'),
    /warrant\.execute/
  );
});

test('rejects non-list reserved', () => {
  assert.throws(() => parseLoop('---\nname: x\nreserved: everything\n---\n'), /must be a list/);
});

test('extractSections is case-insensitive and heading-level tolerant', () => {
  const s = extractSections('## BRIEF\n\nfacts here\n\n### procedure\n\nsteps here\n');
  assert.equal(s.brief, 'facts here');
  assert.equal(s.procedure, 'steps here');
});

test('all shipped templates parse and have every layer', () => {
  const dir = new URL('../templates/', import.meta.url).pathname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.loop.md'));
  assert.equal(files.length, 7);
  for (const f of files) {
    const loop = parseLoop(fs.readFileSync(path.join(dir, f), 'utf8'), { file: f });
    assert.equal(`${loop.name}.loop.md`, f, `${f}: name must match filename`);
    assert.ok(loop.description, `${f}: needs a description`);
    assert.ok(loop.brief.length > 50, `${f}: memory section too thin`);
    assert.ok(loop.procedure.length > 50, `${f}: method section too thin`);
    assert.ok(loop.reserved.length > 0, `${f}: reserved must not be empty`);
    assert.ok(loop.record.length > 0, `${f}: record must not be empty`);
    assert.ok(loop.triggers.length > 0, `${f}: needs triggers so routing can find it`);
    assert.deepEqual(loop.warrant.send, [], `${f}: starter loops never allow send on their own`);
  }
});
