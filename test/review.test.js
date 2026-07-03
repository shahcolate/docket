// `docket review`: automatic iteration with a human veto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

function docket(cwd, args, { expectExit = 0 } = {}) {
  try {
    return execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: ENV });
  } catch (err) {
    assert.equal(err.status, expectExit, `${err.stdout}\n${err.stderr}`);
    return (err.stdout ?? '') + (err.stderr ?? '');
  }
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-review-'));
  docket(dir, ['init', '--quiet']);
  docket(dir, ['new', 'appeal', '--template', 'insurance-appeal']);
  return dir;
}

test('repeated unlisted asks become proposals; --yes applies and records the amendment', () => {
  const dir = project();
  // twice asked about an unlisted read → proposal material
  docket(dir, ['check', 'appeal', 'read', 'state insurance regulations'], { expectExit: 2 });
  docket(dir, ['check', 'appeal', 'read', 'state insurance regulations'], { expectExit: 2 });

  const dry = docket(dir, ['review']);
  assert.match(dry, /allow read: "state insurance regulations"/);
  assert.match(dry, /asked 2×/);
  assert.match(dry, /dry run/); // non-TTY without --yes changes nothing
  assert.match(
    fs.readFileSync(path.join(dir, '.docket', 'loops', 'appeal.loop.md'), 'utf8'),
    /read:\n(?![\s\S]*state insurance regulations)/
  );

  const applied = docket(dir, ['review', '--yes']);
  assert.match(applied, /read now covers "state insurance regulations"/);

  // the warrant actually widened…
  const allow = docket(dir, ['check', 'appeal', 'read', 'state insurance regulations']);
  assert.match(allow, /ALLOW/);
  // …the amendment is on the record…
  assert.match(docket(dir, ['record', 'log']), /amended warrant: read now covers/);
  // …and the chain still verifies.
  assert.match(docket(dir, ['record', 'verify']), /chain intact/);
  // idempotent: nothing left to propose
  assert.match(docket(dir, ['review', '--yes']), /nothing to iterate on/);
});

test('a single ask is below the default threshold', () => {
  const dir = project();
  docket(dir, ['check', 'appeal', 'read', 'the claims portal'], { expectExit: 2 });
  assert.match(docket(dir, ['review']), /nothing to iterate on/);
  assert.match(docket(dir, ['review', '--min', '1']), /allow read: "the claims portal"/);
});

test('ask-list and never-list targets are never proposed, however often they recur', () => {
  const dir = project();
  // "contacting the insurer" is on the ask list — deliberate policy, not friction
  docket(dir, ['check', 'appeal', 'send', 'contacting the insurer'], { expectExit: 2 });
  docket(dir, ['check', 'appeal', 'send', 'contacting the insurer'], { expectExit: 2 });
  const out = docket(dir, ['review', '--min', '1']);
  assert.doesNotMatch(out, /contacting the insurer/);
});

test('amending through review keeps the loop file parseable', () => {
  const dir = project();
  docket(dir, ['check', 'appeal', 'draft', 'a cover note "with quotes": and a colon'], { expectExit: 2 });
  docket(dir, ['check', 'appeal', 'draft', 'a cover note "with quotes": and a colon'], { expectExit: 2 });
  docket(dir, ['review', '--yes']);
  const shown = docket(dir, ['show', 'appeal']);
  assert.match(shown, /with quotes/);
  const allow = docket(dir, ['check', 'appeal', 'draft', 'a cover note "with quotes": and a colon']);
  assert.match(allow, /ALLOW/);
});
