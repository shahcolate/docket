import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWarrant, matchPattern } from '../src/lib/warrant.js';
import { parseLoop } from '../src/lib/loop.js';

const loop = parseLoop(`---
name: appeal
warrant:
  read:
    - policy documents
    - claim correspondence
  draft:
    - appeal letter
  ask:
    - anything addressed to the insurer
  never:
    - settlement decisions
---
`);

test('allow: target inside the action list', () => {
  const r = checkWarrant(loop, 'draft', 'appeal letter');
  assert.equal(r.verdict, 'allow');
  const r2 = checkWarrant(loop, 'read', 'the policy documents folder');
  assert.equal(r2.verdict, 'allow');
});

test('ask: target matches the ask list even if the action would allow', () => {
  const withOverlap = parseLoop(`---
name: x
warrant:
  send:
    - email
  ask:
    - email to the insurer
---
`);
  const r = checkWarrant(withOverlap, 'send', 'email to the insurer');
  assert.equal(r.verdict, 'ask'); // ask outranks allow
});

test('deny: never beats everything', () => {
  const r = checkWarrant(loop, 'draft', 'settlement decisions memo');
  assert.equal(r.verdict, 'deny');
});

test('default: unlisted means ask, never silent allow', () => {
  const r = checkWarrant(loop, 'send', 'a tweet about the claim');
  assert.equal(r.verdict, 'ask');
  assert.equal(r.rule, 'default');
});

test('the lemonade scenario: frustration is not permission', () => {
  // The loop allows drafting the appeal but sending anything to the insurer asks.
  assert.equal(checkWarrant(loop, 'draft', 'appeal letter').verdict, 'allow');
  assert.equal(
    checkWarrant(loop, 'send', 'appeal email addressed to the insurer').verdict,
    'ask'
  );
});

test('unknown action throws', () => {
  assert.throws(() => checkWarrant(loop, 'execute', 'anything'), /unknown action/);
});

test('glob patterns match the whole target', () => {
  assert.ok(matchPattern('*.env', 'production.env'));
  assert.ok(matchPattern('email to *', 'email to the insurer'));
  assert.ok(!matchPattern('email to *', 'draft of email'));
});

test('substring matching is case-insensitive and bidirectional', () => {
  assert.ok(matchPattern('Policy Documents', 'the policy documents'));
  // pattern-contains-target also matches (fuzzy in the direction of caution)
  assert.ok(matchPattern('anything addressed to the insurer', 'the insurer'));
  assert.ok(!matchPattern('calendar', 'email'));
});

test('word-subset matching survives phrasing differences', () => {
  // filler words and word order don't matter
  assert.ok(matchPattern('contacting the insurer', 'insurer contact form'));
  // trailing s is ignored
  assert.ok(matchPattern('appeal letters', 'the appeal letter'));
  // -ed/-ing restore the trailing e: inflection must not decide permission
  assert.ok(matchPattern('scheduled or automated sending', 'schedule the email for Friday'));
  assert.ok(matchPattern('scheduled or automated sending', 'scheduling the email for Friday'));
  // " or " splits into alternatives
  assert.ok(matchPattern('accepting or rejecting a settlement', 'accepting a settlement'));
  assert.ok(matchPattern('accepting or rejecting a settlement', 'rejecting the settlement'));
  // unrelated targets still don't match
  assert.ok(!matchPattern('accepting or rejecting a settlement', 'drafting a timeline'));
  assert.ok(!matchPattern('contacting the insurer', 'reading the policy'));
});

test('a phrasing difference never grants permission — it asks', () => {
  const l = parseLoop(`---
name: x
warrant:
  draft:
    - status summary for the client
---
`);
  // vague target ⊂ pattern words → still allowed (both-direction subset)…
  assert.equal(checkWarrant(l, 'draft', 'client status summary').verdict, 'allow');
  // …but a genuinely different target falls through to ask, never allow
  assert.equal(checkWarrant(l, 'draft', 'contract amendment').verdict, 'ask');
});
