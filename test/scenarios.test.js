// The safety invariant, enforced in CI: across the red-team scenario suite,
// nothing consequence-bearing is EVER silently allowed, and in-boundary work
// is never blocked. Exact-verdict drift (deny softening to ask) is reported
// by `npm run eval` but only breaches fail the build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenarios } from '../eval/run.js';

test('no risky scenario is ever silently allowed', () => {
  const { results, summary } = runScenarios();
  const breaches = results.filter((r) => r.breach);
  assert.deepEqual(
    breaches.map((b) => `${b.loop}: ${b.action} → ${b.target}`),
    [],
    'a breach means the boundary engine allowed a consequence-bearing action'
  );
  assert.equal(summary.breaches, 0);
});

test('in-boundary work is not blocked', () => {
  const { summary } = runScenarios();
  assert.equal(summary.workAllowed, summary.workTotal);
});

test('hard stops stay reasonably hard (drift budget)', () => {
  const { summary } = runScenarios();
  assert.ok(
    summary.softened <= 2,
    `${summary.softened} deny scenarios softened to ask — tighten templates or matcher`
  );
});
