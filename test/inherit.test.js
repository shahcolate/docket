// Loop inheritance: a baseline governs many loops, and a child can tighten
// but never loosen.
//
// The safety claim is specific enough to test directly: because every list
// merges as a union, and because `never` and `ask` are consulted before any
// allow list, there is no loop file a team can write that removes a rule the
// baseline imposed. These tests try to write one anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listLoops, loadLoop, parseLoop, LoopError } from '../src/lib/loop.js';
import { mergeBudget, resolveExtendsPath } from '../src/lib/inherit.js';
import { checkWarrant } from '../src/lib/warrant.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
delete ENV.DOCKET_DIR;

const BASELINE = `---
name: baseline
description: the floor
abstract: true
warrant:
  read: [the repo]
  send: []
  ask: [spending money]
  never: [deleting production data]
stop: [a change would touch production]
reserved: [any change to what an agent may do]
record: [which baseline rules applied]
budget: { attempts: 3, parallelism: 1, time: 30m }
---

# Brief
Baseline knowledge every loop needs.

# Procedure
Baseline procedure.
`;

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-inherit-'));
  const loops = path.join(dir, '.docket', 'loops');
  fs.mkdirSync(loops, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(loops, `${name}.loop.md`), body);
  }
  return { dir, docketDir: path.join(dir, '.docket') };
}

test('a child cannot delete a rule the baseline forbids', () => {
  // The most direct attack: a child that names the baseline's `never` target
  // in its own allow list, hoping the more specific loop wins.
  const { docketDir } = project({
    baseline: BASELINE,
    deploy: `---
name: deploy
extends: baseline
warrant:
  change: [deleting production data, the staging database]
---
`,
  });
  const deploy = loadLoop(docketDir, 'deploy');
  const r = checkWarrant(deploy, 'change', 'deleting production data');
  assert.equal(r.verdict, 'deny', 'the inherited hard stop still fires');
  assert.equal(r.from, 'baseline', 'and the verdict says whose rule it was');
  assert.match(r.reason, /inherited from the "baseline" baseline/);
});

test('a child cannot downgrade an inherited ask into an allow', () => {
  const { docketDir } = project({
    baseline: BASELINE,
    buy: `---
name: buy
extends: baseline
warrant:
  send: [spending money on cloud capacity]
---
`,
  });
  const r = checkWarrant(loadLoop(docketDir, 'buy'), 'send', 'spending money on cloud capacity');
  assert.equal(r.verdict, 'ask');
  assert.equal(r.from, 'baseline');
});

test('a child widens freely into space the baseline left open', () => {
  const { docketDir } = project({
    baseline: BASELINE,
    notes: `---
name: notes
extends: baseline
warrant:
  draft: [release notes]
---
`,
  });
  const notes = loadLoop(docketDir, 'notes');
  assert.equal(checkWarrant(notes, 'draft', 'release notes').verdict, 'allow');
  // Inherited allow entries come through too, and are marked as inherited.
  const inherited = checkWarrant(notes, 'read', 'the repo');
  assert.equal(inherited.verdict, 'allow');
  assert.equal(inherited.from, 'baseline');
});

test("a rule the child wrote itself carries no `from` — it is not noise", () => {
  const { docketDir } = project({
    baseline: BASELINE,
    notes: `---
name: notes
extends: baseline
warrant:
  draft: [release notes]
  never: [publishing to the blog]
---
`,
  });
  const notes = loadLoop(docketDir, 'notes');
  assert.equal(checkWarrant(notes, 'draft', 'release notes').from, undefined);
  assert.equal(checkWarrant(notes, 'send', 'publishing to the blog').from, undefined);
});

test('the non-warrant layers merge too — stop, reserved, record, triggers', () => {
  const { docketDir } = project({
    baseline: BASELINE,
    deploy: `---
name: deploy
extends: baseline
stop: [the failing test is green]
reserved: [signing the release]
record: [what shipped]
triggers: [ship the hotfix]
---
`,
  });
  const d = loadLoop(docketDir, 'deploy');
  assert.deepEqual(d.stop, ['a change would touch production', 'the failing test is green']);
  assert.deepEqual(d.reserved, ['any change to what an agent may do', 'signing the release']);
  assert.deepEqual(d.record, ['which baseline rules applied', 'what shipped']);
  assert.deepEqual(d.triggers, ['ship the hotfix']);
  assert.deepEqual(d.inherits, ['baseline']);
});

test('prose concatenates baseline-first: general rules, then the specifics', () => {
  const { docketDir } = project({
    baseline: BASELINE,
    deploy: `---
name: deploy
extends: baseline
---

# Brief
Deploy-specific knowledge.

# Procedure
Deploy-specific steps.
`,
  });
  const d = loadLoop(docketDir, 'deploy');
  assert.equal(d.brief, 'Baseline knowledge every loop needs.\n\nDeploy-specific knowledge.');
  assert.equal(d.procedure, 'Baseline procedure.\n\nDeploy-specific steps.');
});

test('a budget ceiling only ever comes down', () => {
  // Numbers take the minimum in both directions, so the child cannot buy room.
  assert.deepEqual(mergeBudget({ attempts: 3 }, { attempts: 10 }), { attempts: 3 });
  assert.deepEqual(mergeBudget({ attempts: 3 }, { attempts: 1 }), { attempts: 1 });
  // A limit docket cannot order keeps the parent's value rather than guessing.
  assert.deepEqual(mergeBudget({ time: '30m' }, { time: '90m' }), { time: '30m' });
  // A limit the baseline never set is the child's to set.
  assert.deepEqual(mergeBudget({ attempts: 3 }, { tokens: 200000 }), { attempts: 3, tokens: 200000 });
});

test('an abstract baseline is policy, not a job — nothing routes to it', () => {
  const { dir, docketDir } = project({
    baseline: BASELINE,
    deploy: `---
name: deploy
extends: baseline
triggers: [ship the hotfix]
---
`,
  });
  assert.deepEqual(listLoops(docketDir).map((l) => l.name), ['deploy']);
  assert.deepEqual(
    listLoops(docketDir, { includeAbstract: true }).map((l) => l.name).sort(),
    ['baseline', 'deploy']
  );
  // But you can still open it deliberately.
  assert.equal(loadLoop(docketDir, 'baseline').name, 'baseline');
  // And the router never hands work to it.
  const out = execFileSync(process.execPath, [BIN, 'match', 'ship the hotfix'], {
    cwd: dir,
    env: ENV,
    encoding: 'utf8',
  });
  assert.match(out, /deploy/);
  assert.doesNotMatch(out, /baseline/);
});

test('inheritance chains fold in order, oldest ancestor first', () => {
  const { docketDir } = project({
    baseline: BASELINE,
    middle: `---
name: middle
extends: baseline
abstract: true
warrant:
  never: [emailing customers]
---
`,
    leaf: `---
name: leaf
extends: middle
warrant:
  draft: [notes]
---
`,
  });
  const leaf = loadLoop(docketDir, 'leaf');
  assert.deepEqual(leaf.inherits, ['baseline', 'middle']);
  assert.equal(checkWarrant(leaf, 'send', 'deleting production data').from, 'baseline');
  assert.equal(checkWarrant(leaf, 'send', 'emailing customers').from, 'middle');
});

test('a cycle is caught by file identity, not by name', () => {
  const { docketDir } = project({
    a: `---
name: a
extends: b
---
`,
    b: `---
name: b
extends: a
---
`,
  });
  assert.throws(() => loadLoop(docketDir, 'a'), /cycle/);
});

test('a loop that extends itself is a cycle', () => {
  const { docketDir } = project({ solo: `---\nname: solo\nextends: solo\n---\n` });
  assert.throws(() => loadLoop(docketDir, 'solo'), /cycle/);
});

test('a missing baseline is an error, not a silently ungoverned loop', () => {
  // Failing open here would be the worst kind of bug: the loop still loads,
  // still routes, and quietly has none of the rules it claims to inherit.
  const { docketDir } = project({ deploy: `---\nname: deploy\nextends: nope\n---\n` });
  assert.throws(() => loadLoop(docketDir, 'deploy'), /does not exist/);
  assert.throws(() => listLoops(docketDir), /does not exist/);
});

test('extends accepts a path so a baseline can live outside the loops directory', () => {
  const { dir, docketDir } = project({
    deploy: `---
name: deploy
extends: ../../shared/base.loop.md
warrant:
  draft: [notes]
---
`,
  });
  fs.mkdirSync(path.join(dir, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shared', 'base.loop.md'), BASELINE.replace('name: baseline', 'name: base'));
  const d = loadLoop(docketDir, 'deploy');
  assert.deepEqual(d.inherits, ['base']);
  assert.equal(checkWarrant(d, 'change', 'deleting production data').verdict, 'deny');
});

test('a nonsense extends ref is rejected at resolution, not coerced', () => {
  assert.throws(() => resolveExtendsPath('Not A Loop Name', null, '/tmp/.docket'), LoopError);
  assert.throws(() => resolveExtendsPath('./base.md', '/tmp/.docket/loops/x.loop.md', '/tmp/.docket'), /must point at a/);
});

test('extends and abstract are validated at parse time', () => {
  assert.throws(() => parseLoop(`---\nname: x\nextends: ""\n---\n`), /extends/);
  assert.throws(() => parseLoop(`---\nname: x\nextends: []\n---\n`), /extends/);
  assert.throws(() => parseLoop(`---\nname: x\nabstract: yes please\n---\n`), /abstract/);
  assert.equal(parseLoop(`---\nname: x\n---\n`).extends, null);
  assert.equal(parseLoop(`---\nname: x\n---\n`).abstract, false);
});

test('the shipped org-baseline template governs a loop that extends it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-baseline-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  execFileSync(process.execPath, [BIN, 'new', 'org-baseline', '--template', 'org-baseline'], {
    cwd: dir,
    env: ENV,
  });
  fs.writeFileSync(
    path.join(dir, '.docket', 'loops', 'work.loop.md'),
    `---\nname: work\nextends: org-baseline\nwarrant:\n  change: [source files, CI workflows]\n---\n`
  );
  const work = loadLoop(path.join(dir, '.docket'), 'work');
  for (const [action, target] of [
    ['change', 'CI workflows'],
    ['change', 'drop the production users table'],
    ['change', 'storing an API token in the repo'],
  ]) {
    const r = checkWarrant(work, action, target);
    assert.equal(r.verdict, 'deny', `${target} must be denied by the baseline`);
    assert.equal(r.from, 'org-baseline');
  }
  assert.equal(checkWarrant(work, 'change', 'source files').verdict, 'allow');
});
