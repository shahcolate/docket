import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, dumpYaml } from '../src/lib/yaml.js';

test('parses nested maps and lists', () => {
  const doc = parseYaml(`
name: appeal
version: 1
warrant:
  read:
    - policy documents
    - denial letter
  send: []
  ask:
    - anything addressed to the insurer
reserved:
  - signing and sending
`);
  assert.equal(doc.name, 'appeal');
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.warrant.read, ['policy documents', 'denial letter']);
  assert.deepEqual(doc.warrant.send, []);
  assert.deepEqual(doc.reserved, ['signing and sending']);
});

test('parses scalars: quotes, booleans, null, numbers', () => {
  const doc = parseYaml(`
a: "quoted: with colon"
b: 'single'
c: true
d: false
e: null
f: 3.5
g: plain text with spaces
`);
  assert.equal(doc.a, 'quoted: with colon');
  assert.equal(doc.b, 'single');
  assert.equal(doc.c, true);
  assert.equal(doc.d, false);
  assert.equal(doc.e, null);
  assert.equal(doc.f, 3.5);
  assert.equal(doc.g, 'plain text with spaces');
});

test('ignores comments and blank lines', () => {
  const doc = parseYaml(`
# a comment
name: x

# another
list:
  - one
`);
  assert.deepEqual(doc, { name: 'x', list: ['one'] });
});

test('key with empty value and no children is null', () => {
  assert.deepEqual(parseYaml('a:\nb: 1'), { a: null, b: 1 });
});

test('throws on unparseable lines', () => {
  assert.throws(() => parseYaml('just some words\n'), /cannot parse/);
});

test('dump → parse round-trips loop-shaped data', () => {
  const original = {
    name: 'my-loop',
    description: 'A loop: with a colon',
    version: 1,
    boundary: { read: ['a', 'b'], draft: [], ask: ['x y z'] },
    judgment: ['final approval'],
  };
  const parsed = parseYaml(dumpYaml(original));
  assert.deepEqual(parsed, original);
});

test('dump quotes strings that would be misread', () => {
  const out = dumpYaml({ a: 'true', b: '3', c: '#hash', d: 'has: colon' });
  const back = parseYaml(out);
  assert.equal(back.a, 'true');
  assert.equal(back.b, '3');
  assert.equal(back.c, '#hash');
  assert.equal(back.d, 'has: colon');
});
