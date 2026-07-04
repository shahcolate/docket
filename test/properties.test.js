// CI enforcement for the property suite: permission is earned by covering an
// allow pattern — never inherited by vagueness, never granted to noise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runVagueProbes, runFuzz } from '../eval/properties.js';

test('vague targets never inherit permission from specific allow entries', () => {
  const { probes, violations } = runVagueProbes();
  assert.ok(probes > 100, 'the probe generator must not quietly shrink');
  assert.deepEqual(
    violations.map((v) => `${v.loop}/${v.action} "${v.target}" (from "${v.from}")`),
    []
  );
});

test('10,000 fuzzed targets earn zero permissions', () => {
  const { count, allowed, samples, vocabSize } = runFuzz();
  assert.equal(count, 10000);
  assert.ok(vocabSize >= 40, 'fuzz vocabulary shrank — too many words collide with templates');
  assert.deepEqual(samples, []);
  assert.equal(allowed, 0);
});
