// Signed record heads.
//
// The chain proves entries commit to each other. It cannot see its own tail
// being cut off — that is a documented limitation, and an attestation is the
// fix. So the tests that matter here are the truncation ones: cut the tail,
// then grow the log back, and check that verification still catches it. A
// signature that only compared current heads would not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAttestation,
  generateKeyPair,
  latestAttestation,
  parseAttestation,
  signatureValid,
  signingPayload,
  verifyAgainstAttestation,
  writeAttestation,
  AttestError,
} from '../src/lib/attest.js';
import { appendRecord, recordFile } from '../src/lib/record.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
delete ENV.DOCKET_DIR;
delete ENV.DOCKET_KEY;

function project(entries = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-attest-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  const docketDir = path.join(dir, '.docket');
  for (let i = 1; i <= entries; i++) {
    appendRecord(docketDir, { loop: 'work', kind: 'note', did: `step ${i}` }, { by: 'tester' });
  }
  return { dir, docketDir };
}

function keys() {
  const { privateKeyPem, publicKeyBase64 } = generateKeyPair();
  return { privateKeyPem, publicKeyBase64 };
}

test('an attestation over an intact record verifies', () => {
  const { docketDir } = project();
  const { privateKeyPem, publicKeyBase64 } = keys();
  const a = createAttestation(docketDir, privateKeyPem, { by: 'tester' });
  assert.equal(a.count, 5);
  assert.equal(a.key, publicKeyBase64);
  assert.ok(signatureValid(a));

  const r = verifyAgainstAttestation(docketDir, a, { trustedKey: publicKeyBase64 });
  assert.equal(r.ok, true);
  assert.equal(r.trusted, true);
  assert.equal(r.grew, 0);
});

test('the log may grow after signing — that is not tampering', () => {
  const { docketDir } = project();
  const { privateKeyPem } = keys();
  const a = createAttestation(docketDir, privateKeyPem);
  appendRecord(docketDir, { loop: 'work', kind: 'note', did: 'later work' }, { by: 'tester' });
  const r = verifyAgainstAttestation(docketDir, a);
  assert.equal(r.ok, true);
  assert.equal(r.grew, 1);
});

test('a cut tail is caught — even after the log grows back past the signed length', () => {
  // This is the case a bare head comparison misses completely: remove two
  // entries, append three, and the current head is simply a new valid head.
  const { docketDir } = project();
  const { privateKeyPem } = keys();
  const a = createAttestation(docketDir, privateKeyPem);

  const file = recordFile(docketDir);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, lines.slice(0, 3).join('\n') + '\n');
  for (let i = 0; i < 3; i++) {
    appendRecord(docketDir, { loop: 'work', kind: 'note', did: `replacement ${i}` }, { by: 'attacker' });
  }

  const r = verifyAgainstAttestation(docketDir, a);
  assert.equal(r.ok, false);
  assert.match(r.problem, /rewritten below the signed point/);
});

test('a record shorter than its attestation reports how many entries went missing', () => {
  const { docketDir } = project();
  const { privateKeyPem } = keys();
  const a = createAttestation(docketDir, privateKeyPem);
  const file = recordFile(docketDir);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, lines.slice(0, 2).join('\n') + '\n');

  const r = verifyAgainstAttestation(docketDir, a);
  assert.equal(r.ok, false);
  assert.match(r.problem, /3 were removed from the tail/);
});

test('an edited attestation fails its own signature', () => {
  const { docketDir } = project();
  const { privateKeyPem } = keys();
  const a = createAttestation(docketDir, privateKeyPem);
  const forged = { ...a, count: 99 };
  assert.equal(signatureValid(forged), false);
  assert.equal(verifyAgainstAttestation(docketDir, forged).ok, false);
});

test('a signature from the wrong key is rejected when a key is pinned', () => {
  const { docketDir } = project();
  const mine = keys();
  const theirs = keys();
  const a = createAttestation(docketDir, theirs.privateKeyPem);
  // It is internally valid — it just is not the key you said to trust.
  assert.ok(signatureValid(a));
  const r = verifyAgainstAttestation(docketDir, a, { trustedKey: mine.publicKeyBase64 });
  assert.equal(r.ok, false);
  assert.match(r.problem, /different key than the one you pinned/);
});

test('an unpinned attestation verifies but is never reported as trusted', () => {
  // The honesty invariant: a self-carried key makes the file tamper-evident
  // and says nothing about who made it.
  const { docketDir } = project();
  const a = createAttestation(docketDir, keys().privateKeyPem);
  const r = verifyAgainstAttestation(docketDir, a);
  assert.equal(r.ok, true);
  assert.equal(r.trusted, false);
});

test('signing refuses on a broken chain rather than rubber-stamping it', () => {
  const { docketDir } = project();
  const file = recordFile(docketDir);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const tampered = JSON.parse(lines[1]);
  tampered.did = 'something else entirely';
  lines[1] = JSON.stringify(tampered);
  fs.writeFileSync(file, lines.join('\n') + '\n');

  assert.throws(
    () => createAttestation(docketDir, keys().privateKeyPem),
    (err) => err instanceof AttestError && /refusing to sign a broken chain/.test(err.message)
  );
});

test('signing refuses on an empty record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-attest-empty-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  assert.throws(
    () => createAttestation(path.join(dir, '.docket'), keys().privateKeyPem),
    /nothing to attest/
  );
});

test('an RSA key is rejected — docket signs with ed25519 and says so', () => {
  const { docketDir } = project();
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => createAttestation(docketDir, privateKey.export({ type: 'pkcs8', format: 'pem' })),
    /docket signs with ed25519/
  );
});

test('the signed payload is field-ordered, so reformatting is not forgery', () => {
  const a = {
    version: 'docket-attestation/v1',
    head: 'sha256:abc',
    count: 3,
    ts: '2026-01-01T00:00:00.000Z',
    by: 'me',
    alg: 'ed25519',
    key: 'K',
  };
  // Same fields, different insertion order — the payload must be identical.
  const reordered = { key: 'K', alg: 'ed25519', by: 'me', ts: a.ts, count: 3, head: 'sha256:abc', version: a.version };
  assert.equal(signingPayload(a), signingPayload(reordered));
});

test('latestAttestation picks the newest by count and skips junk files', () => {
  const { docketDir } = project(3);
  const { privateKeyPem } = keys();
  const first = createAttestation(docketDir, privateKeyPem);
  writeAttestation(docketDir, first);
  appendRecord(docketDir, { loop: 'work', kind: 'note', did: 'more' }, { by: 'tester' });
  const second = createAttestation(docketDir, privateKeyPem);
  writeAttestation(docketDir, second);
  fs.writeFileSync(path.join(docketDir, 'attestations', 'garbage.json'), 'not json');

  const found = latestAttestation(docketDir);
  assert.equal(found.attestation.count, 4);
});

test('parseAttestation rejects the wrong version and missing fields', () => {
  assert.throws(() => parseAttestation('nope'), /not JSON/);
  assert.throws(() => parseAttestation(JSON.stringify({ version: 'x' })), /missing/);
  assert.throws(
    () =>
      parseAttestation(
        JSON.stringify({ version: 'other/v9', head: 'h', count: 1, ts: 't', alg: 'ed25519', key: 'k', sig: 's' })
      ),
    /this docket reads/
  );
});

// ── the CLI, end to end ────────────────────────────────────────────────────

function docket(cwd, args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...ENV, ...env },
    encoding: 'utf8',
  });
}

test('keygen → sign → verify --attest works end to end', () => {
  const { dir, docketDir } = project();
  const keyPath = path.join(dir, 'signing.key');

  const gen = docket(dir, ['record', 'keygen', '--out', keyPath]);
  assert.equal(gen.status, 0, gen.stderr);
  assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600, 'a signing key is never group- or world-readable');
  const publicKey = gen.stdout.split('\n').find((l) => l.startsWith('  ') && l.trim().length > 40).trim();

  const sign = docket(dir, ['record', 'sign'], { DOCKET_KEY: keyPath });
  assert.equal(sign.status, 0, sign.stderr);
  assert.match(sign.stdout, /signed the record at 5 entries/);

  const ok = docket(dir, ['record', 'verify', '--attest', '--key', publicKey], { DOCKET_KEY: keyPath });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /record matches the attestation/);
  assert.match(ok.stdout, /key:\s+pinned/);

  // Unpinned says plainly what it did and did not prove.
  const unpinned = docket(dir, ['record', 'verify', '--attest'], { DOCKET_KEY: keyPath });
  assert.equal(unpinned.status, 0);
  assert.match(unpinned.stdout, /not pinned/);
  assert.match(unpinned.stdout, /not who signed it/);

  // Now cut the tail and watch it fail.
  const file = recordFile(docketDir);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, lines.slice(0, 2).join('\n') + '\n');
  const broken = docket(dir, ['record', 'verify', '--attest'], { DOCKET_KEY: keyPath });
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /removed from the tail/);
});

test('keygen refuses to clobber an existing key without --force', () => {
  const { dir } = project();
  const keyPath = path.join(dir, 'signing.key');
  assert.equal(docket(dir, ['record', 'keygen', '--out', keyPath]).status, 0);
  const second = docket(dir, ['record', 'keygen', '--out', keyPath]);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /Every attestation ever made with it would stop verifying/);
  assert.equal(docket(dir, ['record', 'keygen', '--out', keyPath, '--force']).status, 0);
});

test('sign without a key explains where to get one instead of stack-tracing', () => {
  const { dir } = project();
  const res = docket(dir, ['record', 'sign'], { DOCKET_KEY: path.join(dir, 'absent.key') });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /docket record keygen/);
});

test('verify --attest with no attestations says how to make one', () => {
  const { dir } = project();
  const res = docket(dir, ['record', 'verify', '--attest']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /docket record sign/);
});
