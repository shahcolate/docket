// CI enforcement for the tamper suite: with a pinned head, every mutation of
// the record — edits, rehashed edits, deletions, reorders, forgeries, and
// truncations — must be detected. The chain alone must catch every interior
// tamper; only tail rewrites legitimately need the pinned head (that gap is
// the documented reason `verify` prints the head hash).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTamper } from '../eval/tamper.js';

// Deterministic — run the 239-mutation torture once, assert on the shared result.
const r = runTamper();

test('every tampering attempt is detected with a pinned head', () => {
  assert.ok(r.total > 200, 'the mutation generator must not quietly shrink');
  assert.equal(r.detectedWithHead, r.total);
});

test('interior tampers are caught by the chain alone — no head needed', () => {
  // Only tail-rewrite/truncation classes may depend on the pinned head.
  for (const [kind, k] of Object.entries(r.byKind)) {
    const headDependent = k.total - k.chainAlone;
    if (kind === 'truncate') {
      assert.ok(headDependent > 0, 'truncation is only catchable via the pinned head');
    } else {
      // at most the single tail-entry variant of each class may need the head
      assert.ok(
        headDependent <= 1,
        `${kind}: ${headDependent} mutations escaped the bare chain`
      );
    }
  }
});
