// The record: an append-only, hash-chained log of what the agent saw, did,
// left alone, and where it stopped. Each entry commits to the previous one,
// so `docket record verify` detects any edit, deletion, or reordering.
//
// Storage is a plain JSONL file — human-readable, diff-able, yours.
//
// Known limitation (by construction, documented in the spec): truncating the
// TAIL of the file leaves a valid shorter chain. Pin the head hash somewhere
// the log can't reach (a password manager, a commit, another machine) and
// check it with `docket record verify --head <hash>`.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveActor } from './actor.js';

export const GENESIS = 'GENESIS';

// The evidentiary fields a note entry may carry. Every writer (CLI, MCP)
// filters through collectRecordFields so the audit schema has one owner.
export const RECORD_FIELDS = ['saw', 'did', 'skipped', 'stopped', 'note'];

// Who wrote the entry — stamped by appendRecord, never by a caller's hand.
// See lib/actor.js for how each is resolved and why `by` is self-reported.
export const ATTRIBUTION_FIELDS = ['by', 'branch', 'worktree', 'session'];

export function collectRecordFields(source) {
  const fields = {};
  const dropped = [];
  for (const key of RECORD_FIELDS) {
    if (!(key in source) || source[key] === undefined) continue;
    if (typeof source[key] === 'string' && source[key].trim()) {
      fields[key] = source[key].trim();
    } else {
      dropped.push(key); // present but empty/non-string — surface, never silently drop
    }
  }
  return { fields, dropped };
}

export function recordFile(docketDir) {
  return path.join(docketDir, 'record.jsonl');
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashEntry(entry, prev) {
  const { hash, ...rest } = entry;
  return (
    'sha256:' +
    crypto.createHash('sha256').update(`${prev}\n${canonicalize(rest)}`).digest('hex')
  );
}

export function readRecords(docketDir) {
  const file = recordFile(docketDir);
  if (!fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    entries.push(JSON.parse(line));
  }
  return entries;
}

// Read only the final entry, without parsing the whole file — appends are
// the hot path (every warrant check writes one) and the log grows
// unbounded over months of agent use.
export function readLastRecord(docketDir) {
  const file = recordFile(docketDir);
  if (!fs.existsSync(file)) return null;
  const size = fs.statSync(file).size;
  if (size === 0) return null;
  const fd = fs.openSync(file, 'r');
  try {
    let chunkSize = 64 * 1024;
    for (;;) {
      const start = Math.max(0, size - chunkSize);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf8');
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length === 0) return null;
      // Walk backward to the last parseable line: the tail line may be a
      // partial interrupted write, and the chunk-head line may be cut off.
      for (let j = lines.length - 1; j >= 0; j--) {
        try {
          return JSON.parse(lines[j]);
        } catch {
          // not a complete entry — try the line before it
        }
      }
      if (start === 0) return null;
      chunkSize *= 4;
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Appending is read-then-write — read the head, chain to it, append — and that
// pair must be ATOMIC. Two agents working the same repo in parallel would
// otherwise both read entry 5 and both write entry 6, and `verify` would
// report "an entry was removed, added, or reordered": a tamper alarm raised by
// honest concurrent work. A false alarm in an audit trail is not a small bug;
// it teaches people to ignore the alarm.
//
// The lock is an exclusively-created file next to the record. Zero
// dependencies, works across processes and worktrees on one machine (which is
// the multi-agent case; a record shared over NFS is out of scope and says so).
export class RecordLockError extends Error {}

const LOCK_STALE_MS = 10_000; // a holder older than this crashed mid-write
const LOCK_WAIT_MS = 15_000; // > STALE, so a stale lock is always broken, never waited out

function lockFile(docketDir) {
  return recordFile(docketDir) + '.lock';
}

// Sync sleep with no dependencies and no busy-wait: appendRecord is sync
// everywhere it's called (CLI, hook, MCP handler), and making it async would
// change every writer's signature for a millisecond of contention.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withRecordLock(docketDir, fn, { waitMs = LOCK_WAIT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const lock = lockFile(docketDir);
  const deadline = Date.now() + waitMs;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        continue; // the holder released it between our open and our stat
      }
      if (age > staleMs) {
        // The holder died mid-write. Break the lock rather than block the
        // record forever — evidence that can't be written isn't evidence.
        try {
          fs.unlinkSync(lock);
        } catch {
          /* someone else broke it first */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new RecordLockError(
          `could not lock ${lock} within ${waitMs}ms — another process is holding it. ` +
            'If nothing else is running, delete that file.'
        );
      }
      // Jittered backoff: without it, N waiters wake together and one wins N
      // times in a row while the rest keep colliding.
      sleepSync(2 + Math.floor(Math.random() * 8));
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(lock);
    } catch {
      /* already broken as stale — the next writer creates it fresh */
    }
  }
}

// `actor` is the attribution hint from the caller ({ by, session }); every
// writer passes it and none of them can forget to, because stamping happens
// here. Attribution is part of the hashed entry, so it is as tamper-evident
// as the verdict it sits next to.
export function appendRecord(docketDir, fields, actor = {}) {
  return withRecordLock(docketDir, () => {
    const last = readLastRecord(docketDir);
    const prev = last ? last.hash : GENESIS;
    const entry = {
      seq: last ? last.seq + 1 : 1,
      ts: new Date().toISOString(),
      ...fields,
      ...resolveActor(actor),
      prev,
    };
    entry.hash = hashEntry(entry, prev);
    fs.appendFileSync(recordFile(docketDir), JSON.stringify(entry) + '\n');
    return entry;
  });
}

// One writer for warrant-check evidence, whoever asked (CLI or MCP) —
// the audit schema for checks is defined here and nowhere else.
export function recordCheck(docketDir, loopName, action, target, result, extra = {}, actor = {}) {
  return appendRecord(
    docketDir,
    {
      loop: loopName,
      kind: 'check',
      action,
      target,
      verdict: result.verdict,
      rule: result.rule,
      // Present only when the rule came from an inherited baseline rather than
      // the loop itself. "Which policy stopped this?" is the first question at
      // an audit, and it should not require re-reading four files to answer.
      ...(result.from ? { from: result.from } : {}),
      ...extra,
    },
    actor
  );
}

// Returns { ok, count, head, brokenAt, problem }.
export function verifyRecord(docketDir, { expectHead } = {}) {
  const entries = readRecords(docketDir);
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.seq !== i + 1) {
      return {
        ok: false,
        count: entries.length,
        head: null,
        brokenAt: i + 1,
        problem: `entry ${i + 1} has seq ${entry.seq} — an entry was removed, added, or reordered`,
      };
    }
    if (entry.prev !== prev) {
      return {
        ok: false,
        count: entries.length,
        head: null,
        brokenAt: entry.seq,
        problem: `entry ${entry.seq} does not chain to the previous entry`,
      };
    }
    if (hashEntry(entry, prev) !== entry.hash) {
      return {
        ok: false,
        count: entries.length,
        head: null,
        brokenAt: entry.seq,
        problem: `entry ${entry.seq} was modified after it was written`,
      };
    }
    prev = entry.hash;
  }
  const head = entries.length ? prev : GENESIS;
  if (expectHead && head !== expectHead && !head.startsWith(expectHead)) {
    return {
      ok: false,
      count: entries.length,
      head,
      brokenAt: entries.length,
      problem: `chain is internally consistent but its head is ${head.slice(0, 23)}…, not the pinned ${expectHead.slice(0, 23)}… — entries were likely truncated from the tail`,
    };
  }
  return { ok: true, count: entries.length, head, brokenAt: null, problem: null };
}
