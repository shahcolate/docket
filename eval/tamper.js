// Tamper torture: build a real record, then apply every single-point
// mutation an adversary (or an embarrassed agent) might try, and count how
// many `docket record verify` catches.
//
// Mutation classes:
//   edit       — change a field, keep the recorded hash
//   edit+rehash— change a field AND recompute that entry's hash
//   delete     — remove one entry
//   swap       — reorder two adjacent entries
//   forge      — insert a fabricated entry
//   truncate   — cut the tail at every possible length
//
// Honesty note, same as the spec's: a hash chain cannot see its own tail
// being cut (or the tail entry being rewritten with a fresh hash) — those
// leave a shorter-but-valid chain. That's exactly why `verify` prints the
// head hash to pin externally. This suite verifies BOTH claims: what the
// chain alone catches, and that with a pinned head, detection is total.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendRecord, verifyRecord, hashEntry, readRecords } from '../src/lib/record.js';

const CHAIN_LENGTH = 40;

function buildChain() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-tamper-'));
  fs.mkdirSync(path.join(dir, '.docket'), { recursive: true });
  const docketDir = path.join(dir, '.docket');
  for (let i = 0; i < CHAIN_LENGTH; i++) {
    if (i % 2 === 0) {
      appendRecord(docketDir, {
        loop: 'appeal', kind: 'check', action: 'send',
        target: `appeal email draft ${i}`, verdict: 'ask', rule: 'default',
      });
    } else {
      appendRecord(docketDir, {
        loop: 'appeal', kind: 'note',
        did: `drafted section ${i}`, stopped: 'before send',
      });
    }
  }
  return docketDir;
}

function writeMutated(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-tamper-mut-'));
  fs.mkdirSync(path.join(dir, '.docket'), { recursive: true });
  const docketDir = path.join(dir, '.docket');
  fs.writeFileSync(
    path.join(docketDir, 'record.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')
  );
  return docketDir;
}

export function runTamper() {
  const original = buildChain();
  const entries = readRecords(original);
  const head = verifyRecord(original).head;
  const clone = () => entries.map((e) => ({ ...e }));

  const mutations = [];
  for (let i = 0; i < entries.length; i++) {
    mutations.push({ kind: 'edit', make: () => { const m = clone(); m[i].target = 'TAMPERED'; m[i].did = 'TAMPERED'; return m; } });
    mutations.push({ kind: 'edit+rehash', make: () => {
      const m = clone();
      m[i].target = 'TAMPERED'; m[i].did = 'TAMPERED';
      delete m[i].hash;
      m[i].hash = hashEntry(m[i], m[i].prev);
      return m;
    } });
    mutations.push({ kind: 'delete', make: () => clone().filter((_, j) => j !== i) });
    mutations.push({ kind: 'forge', make: () => {
      const m = clone();
      const forged = { ...m[i], did: 'FORGED ENTRY' };
      forged.hash = hashEntry(forged, forged.prev);
      m.splice(i, 0, forged);
      return m;
    } });
  }
  for (let i = 0; i < entries.length - 1; i++) {
    mutations.push({ kind: 'swap', make: () => { const m = clone(); [m[i], m[i + 1]] = [m[i + 1], m[i]]; return m; } });
  }
  for (let k = 0; k < entries.length; k++) {
    mutations.push({ kind: 'truncate', make: () => clone().slice(0, k) });
  }

  const byKind = {};
  let detectedChainAlone = 0;
  let detectedWithHead = 0;
  for (const mut of mutations) {
    const dir = writeMutated(mut.make());
    const plain = verifyRecord(dir);
    const pinned = verifyRecord(dir, { expectHead: head });
    if (!plain.ok) detectedChainAlone++;
    if (!pinned.ok) detectedWithHead++;
    byKind[mut.kind] ??= { total: 0, chainAlone: 0, withHead: 0 };
    byKind[mut.kind].total++;
    if (!plain.ok) byKind[mut.kind].chainAlone++;
    if (!pinned.ok) byKind[mut.kind].withHead++;
  }
  return {
    chainLength: entries.length,
    total: mutations.length,
    detectedChainAlone,
    detectedWithHead,
    byKind,
  };
}
