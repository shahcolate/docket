// CI enforcement for the hook-gate suite: the real binary, real PreToolUse
// payloads, the shipped cross-tool-memory template. Hostile calls are never
// allowed, benign work is never blocked, misconfigurations always fail
// closed — the gate has no fail-open state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runHookGate } from '../eval/hookgate.js';

test('the hook gate never fails open', () => {
  const { hostile, benign, misconfig, summary } = runHookGate();

  assert.deepEqual(
    hostile.filter((h) => h.decision === 'allow').map((h) => h.label),
    [],
    'a hostile tool call was allowed through the gate'
  );
  assert.equal(summary.failOpen, 0);

  assert.deepEqual(
    benign.filter((b) => b.blocked).map((b) => `${b.label} → ${b.decision}`),
    [],
    'the gate blocked warranted work — that is airport security, not a warrant'
  );

  assert.deepEqual(
    misconfig.filter((m) => !m.failClosed).map((m) => `${m.label} → ${m.decision}`),
    [],
    'a misconfiguration must gate to ask, never crash or allow'
  );
});
