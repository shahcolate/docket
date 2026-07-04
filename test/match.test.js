import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLoop } from '../src/lib/loop.js';
import { scoreLoop, matchLoops, MIN_SCORE } from '../src/lib/match.js';

const APPEAL = parseLoop(`---
name: insurance-appeal
description: Build the appeal, cite the policy — stop before send.
triggers:
  - insurance appeal, appeal a denial
  - denied claim, denial letter
warrant:
  read:
    - policy documents
    - denial letter
  draft:
    - appeal letter
  ask:
    - contacting the insurer
  never:
    - settlement decisions
---
`);

const FOLLOWUP = parseLoop(`---
name: client-follow-up
description: Follow up with a client — promises, tone, approved language.
triggers:
  - follow up with a client, client follow-up
  - client email, client status update
warrant:
  read:
    - past email threads with this client
  draft:
    - follow-up email
---
`);

const LOOPS = [APPEAL, FOLLOWUP];

test('a trigger hit qualifies a loop on its own', () => {
  const { score, hits } = scoreLoop(APPEAL, 'my claim was denied, dispute it');
  assert.ok(score >= MIN_SCORE, `score ${score} should clear MIN_SCORE`);
  assert.ok(hits.some((h) => h.field === 'trigger'));
});

test('the loop name matches as a phrase, dashes as spaces', () => {
  const { hits } = scoreLoop(APPEAL, 'work on the insurance appeal');
  assert.ok(hits.some((h) => h.field === 'name'));
});

test('warrant targets count as routing evidence, capped', () => {
  const { hits } = scoreLoop(APPEAL, 'read the denial letter and the policy documents');
  const warrantHits = hits.filter((h) => h.field.startsWith('warrant.'));
  assert.ok(warrantHits.length >= 1);
  assert.ok(warrantHits.length <= 3, 'warrant hits are capped');
});

test('one shared description word never routes on its own', () => {
  // "send" appears in the appeal description; nothing else matches.
  const { score } = scoreLoop(APPEAL, 'send a birthday card');
  assert.ok(score < MIN_SCORE, `score ${score} must stay below MIN_SCORE`);
});

test('matchLoops ranks the covering loop first', () => {
  const candidates = matchLoops(LOOPS, 'draft an appeal for the denied claim');
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].loop.name, 'insurance-appeal');
});

test('matchLoops routes the other intent to the other loop', () => {
  const candidates = matchLoops(LOOPS, 'follow up with the acme client');
  assert.equal(candidates[0].loop.name, 'client-follow-up');
});

test('retrieval fails closed: unrelated intent matches nothing', () => {
  assert.deepEqual(matchLoops(LOOPS, 'wire funds to a vendor'), []);
});

test('limit bounds the candidate list', () => {
  const many = matchLoops(LOOPS, 'client appeal follow-up email about the denied claim', {
    limit: 1,
  });
  assert.equal(many.length, 1);
});

test('ranking is deterministic: score desc, then name', () => {
  const a = matchLoops(LOOPS, 'draft the client follow-up email about their denied claim appeal');
  const b = matchLoops(LOOPS, 'draft the client follow-up email about their denied claim appeal');
  assert.deepEqual(
    a.map((c) => c.loop.name),
    b.map((c) => c.loop.name)
  );
  for (let i = 1; i < a.length; i++) {
    assert.ok(
      a[i - 1].score > a[i].score ||
        (a[i - 1].score === a[i].score && a[i - 1].loop.name < a[i].loop.name)
    );
  }
});
