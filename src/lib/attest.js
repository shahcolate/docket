// Signed record heads: closing the one gap the hash chain cannot close itself.
//
// A hash chain proves every entry commits to the one before it. It cannot see
// its own tail being cut off — delete the last ten entries and what remains is
// a perfectly valid, internally consistent, ten-entries-shorter chain. That is
// why `docket record verify` prints the head hash and invites you to pin it
// somewhere the log can't reach.
//
// An attestation is that pin, made portable and checkable by someone else. It
// says: at this moment, this record had N entries and its head was H — signed.
// Hand it to a client, commit it, mail it to yourself, put it in the release.
//
// WHAT IT PROVES, precisely, because over-claiming here would be worse than
// not shipping it:
//
//   With the public key pinned (`--key`), an attestation proves that whoever
//   holds the private key asserted this head at this count. Verification then
//   catches a truncated tail even after the log has grown again, because it
//   checks the entry at the attested sequence number, not just the current
//   head.
//
//   WITHOUT a pinned key, an attestation carrying its own public key proves
//   only that the attestation file itself has not been edited. Anyone can
//   generate a key and sign anything. Self-carried keys make the file
//   tamper-evident; they do not make it evidence about a person. `verify`
//   says so out loud rather than printing a green check that means less than
//   it looks like.
//
// Ed25519 via node:crypto — no dependencies, small keys, no parameter choices
// to get wrong.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readRecords, verifyRecord } from './record.js';
import { resolveActor } from './actor.js';

export const ATTESTATION_VERSION = 'docket-attestation/v1';
export const ALG = 'ed25519';

export function attestationsDir(docketDir) {
  return path.join(docketDir, 'attestations');
}

export class AttestError extends Error {}

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export function publicKeyOf(privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto
    .createPublicKey(key)
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
}

// The signed payload is every field of the attestation except the signature,
// in a fixed order. Not JSON.stringify of the object — key order there is
// insertion order, and a re-serialized attestation that signs differently
// would look forged when it is merely reformatted.
export function signingPayload(a) {
  return [
    a.version,
    a.head,
    String(a.count),
    a.ts,
    a.by ?? '',
    a.alg,
    a.key,
    a.note ?? '',
  ].join('\n');
}

// Build and sign an attestation for the record's CURRENT head.
//
// Refuses to sign a broken chain. Signing a record you have not verified turns
// a signature into a rubber stamp — the one thing an attestation must never
// be. The caller gets the verification failure, not a signed lie.
export function createAttestation(docketDir, privateKeyPem, { by, note } = {}) {
  const verified = verifyRecord(docketDir);
  if (!verified.ok) {
    throw new AttestError(
      `refusing to sign a broken chain — ${verified.problem} (entry ${verified.brokenAt})`
    );
  }
  if (verified.count === 0) {
    throw new AttestError('refusing to sign an empty record — there is nothing to attest to');
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(privateKeyPem);
  } catch (err) {
    throw new AttestError(`could not read the signing key: ${err.message}`);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new AttestError(
      `the signing key is ${privateKey.asymmetricKeyType}, but docket signs with ${ALG}`
    );
  }

  const attestation = {
    version: ATTESTATION_VERSION,
    head: verified.head,
    count: verified.count,
    ts: new Date().toISOString(),
    by: resolveActor({ by }).by,
    alg: ALG,
    key: publicKeyOf(privateKeyPem),
    ...(note ? { note } : {}),
  };
  attestation.sig = crypto
    .sign(null, Buffer.from(signingPayload(attestation), 'utf8'), privateKey)
    .toString('base64');
  return attestation;
}

function publicKeyObject(base64) {
  return crypto.createPublicKey({
    key: Buffer.from(base64, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

export function signatureValid(attestation) {
  try {
    return crypto.verify(
      null,
      Buffer.from(signingPayload(attestation), 'utf8'),
      publicKeyObject(attestation.key),
      Buffer.from(attestation.sig, 'base64')
    );
  } catch {
    return false;
  }
}

export function parseAttestation(text) {
  let a;
  try {
    a = JSON.parse(text);
  } catch {
    throw new AttestError('that attestation file is not JSON');
  }
  for (const field of ['version', 'head', 'count', 'ts', 'alg', 'key', 'sig']) {
    if (a[field] === undefined) throw new AttestError(`attestation is missing \`${field}\``);
  }
  if (a.version !== ATTESTATION_VERSION) {
    throw new AttestError(
      `attestation says version "${a.version}", but this docket reads ${ATTESTATION_VERSION}`
    );
  }
  if (a.alg !== ALG) throw new AttestError(`attestation uses ${a.alg}; docket verifies ${ALG}`);
  return a;
}

// Check a record against a signed attestation.
//
// The important case is the one a bare `verify` cannot see: entries removed
// from the TAIL. Comparing only the current head would miss it the moment the
// log grows again — cut ten entries, append one, and the head is simply new.
// So this looks up the entry at the attested SEQUENCE NUMBER and checks its
// hash. A record that diverges from what was signed cannot hide behind later
// appends.
//
// Returns { ok, problem, trusted, grew }.
export function verifyAgainstAttestation(docketDir, attestation, { trustedKey } = {}) {
  const chain = verifyRecord(docketDir);
  if (!chain.ok) {
    return { ok: false, problem: `${chain.problem} (entry ${chain.brokenAt})`, trusted: false, grew: 0 };
  }
  if (!signatureValid(attestation)) {
    return {
      ok: false,
      problem: 'the attestation\'s own signature does not check out — it was edited after signing',
      trusted: false,
      grew: 0,
    };
  }
  // A signature that verifies against a key nobody vouched for says only that
  // the file is internally consistent. Trust is the caller pinning a key.
  const trusted = trustedKey ? trustedKey === attestation.key : false;
  if (trustedKey && !trusted) {
    return {
      ok: false,
      problem:
        'the attestation is signed by a different key than the one you pinned — ' +
        'someone else attested to this record',
      trusted: false,
      grew: 0,
    };
  }

  const entries = readRecords(docketDir);
  if (entries.length < attestation.count) {
    return {
      ok: false,
      problem:
        `the record has ${entries.length} entries but was signed at ${attestation.count} — ` +
        `${attestation.count - entries.length} were removed from the tail`,
      trusted,
      grew: 0,
    };
  }
  const attested = entries[attestation.count - 1];
  if (!attested || attested.seq !== attestation.count) {
    return { ok: false, problem: `entry ${attestation.count} is missing or out of order`, trusted, grew: 0 };
  }
  if (attested.hash !== attestation.head) {
    return {
      ok: false,
      problem:
        `entry ${attestation.count} hashes to ${attested.hash.slice(0, 23)}…, but the attestation ` +
        `signed ${attestation.head.slice(0, 23)}… — the record was rewritten below the signed point`,
      trusted,
      grew: 0,
    };
  }
  return { ok: true, problem: null, trusted, grew: entries.length - attestation.count };
}

// The newest attestation on disk, by attested count — that is the one with
// something to say about truncation. An older one still verifies against a
// record that has since had its tail cut back to that older point.
export function latestAttestation(docketDir) {
  const dir = attestationsDir(docketDir);
  if (!fs.existsSync(dir)) return null;
  let best = null;
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(dir, entry);
    let a;
    try {
      a = parseAttestation(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // a malformed file in the folder must not hide the good ones
    }
    if (!best || a.count > best.attestation.count) best = { file, attestation: a };
  }
  return best;
}

export function writeAttestation(docketDir, attestation) {
  const dir = attestationsDir(docketDir);
  fs.mkdirSync(dir, { recursive: true });
  // Named by count and head prefix: sorts chronologically, and two
  // attestations of the same head never collide into one file.
  const name = `${String(attestation.count).padStart(6, '0')}-${attestation.head.slice(7, 19)}.json`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(attestation, null, 2) + '\n');
  return file;
}
