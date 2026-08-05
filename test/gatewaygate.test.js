// CI enforcement for the gateway-gate suite: the real `docket intercept`
// binary, real Docker MCP Gateway tool-call payloads, the shipped
// cross-tool-memory template.
//
// The invariant that matters most here is the one the hook does not have:
// at the gateway, an interceptor that says nothing has ALLOWED the call. So
// "hostile call produced no output" is a breach, not a pass, and a crash is
// a breach too — the gateway's error path tells the model nothing it can act
// on and tells the operator nothing about why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGatewayGate } from '../eval/gatewaygate.js';

test('the gateway gate never fails open', () => {
  const { hostile, benign, misconfig, summary } = runGatewayGate();

  assert.deepEqual(
    hostile.filter((h) => h.decision === 'allow').map((h) => h.label),
    [],
    'a hostile MCP tool call was allowed — at the gateway, silence runs the tool'
  );
  assert.deepEqual(
    hostile.filter((h) => h.decision === 'CRASHED' || h.decision === 'UNPARSEABLE' || h.decision === 'MALFORMED')
      .map((h) => `${h.label} → ${h.decision}`),
    [],
    'a block the gateway cannot unmarshal is not a block'
  );
  assert.equal(summary.failOpen, 0);

  assert.deepEqual(
    benign.filter((b) => b.blocked).map((b) => `${b.label} → ${b.decision}`),
    [],
    'the gate blocked read-only work it was configured to permit'
  );

  assert.deepEqual(
    misconfig.filter((m) => !m.failClosed).map((m) => `${m.label} → ${m.decision}`),
    [],
    'a misconfigured gateway gate must block with a reason, never pass the call through'
  );
});

test('every hostile block reaches the model as an error, in words', () => {
  const { hostile } = runGatewayGate();
  for (const h of hostile) {
    assert.equal(h.decision, 'block', `${h.label} should block`);
    // isError and shaped content are checked by invoke(); this checks the
    // reason is actually usable — a refusal with no explanation trains an
    // agent to retry by another route.
    assert.ok(h.reason.length > 40, `${h.label}: the block must say why`);
    assert.match(h.reason, /docket/, `${h.label}: the model must learn who blocked it`);
  }
});
