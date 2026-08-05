import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../lib/args.js';
import { requireDocketDir, loopExists, loopNames } from '../lib/loop.js';
import {
  appendRecord,
  collectRecordFields,
  readRecords,
  verifyRecord,
  recordFile,
} from '../lib/record.js';
import {
  AttestError,
  createAttestation,
  generateKeyPair,
  latestAttestation,
  parseAttestation,
  publicKeyOf,
  verifyAgainstAttestation,
  writeAttestation,
} from '../lib/attest.js';
import { bold, cyan, dim, green, red, yellow, VERDICT_STYLE } from '../lib/ui.js';

// The signing key lives OUTSIDE the repo by default. A private key committed
// next to the log it signs is not a signature, it is a decoration: anyone who
// can rewrite the record can re-sign it. `DOCKET_KEY` overrides for CI, where
// the key comes from a secret store and never touches the working tree.
export function defaultKeyPath() {
  return process.env.DOCKET_KEY || path.join(os.homedir(), '.docket', 'signing.key');
}

// Who wrote it, appended dim so it never crowds out what was written.
// Entries predating attribution simply have nothing to show — the log stays
// readable across the whole history of a project.
function attribution(e) {
  if (!e.by) return '';
  const where = e.worktree ? `${e.worktree}:${e.branch ?? '?'}` : e.branch;
  return dim(`  ← ${e.by}${where ? ` @ ${where}` : ''}`);
}

function formatEntry(e) {
  const ts = dim(String(e.ts ?? '').replace('T', ' ').replace(/\.\d+Z$/, 'Z'));
  const head = `${dim(`#${e.seq}`)} ${ts} ${cyan(e.loop)}`;
  if (e.kind === 'check') {
    const style = VERDICT_STYLE[e.verdict] ?? { color: (s) => s, badge: e.verdict };
    return `${head} ${style.color(style.badge.toLowerCase())} ${e.action} → "${e.target}" ${dim(`(${e.rule})`)}${attribution(e)}`;
  }
  if (e.kind === 'amend') {
    return `${head} amended warrant: ${e.action} now covers "${e.added}" ${dim(`(after ${e.asks} asks)`)}${attribution(e)}`;
  }
  if (e.kind === 'policy') {
    // Recording a policy install and then rendering it as "(empty note)" is
    // the same as not recording it. Where the rules came from is the whole
    // point of the entry, so it goes in the line.
    return `${head} installed ${e.installed} from ${e.source} ${dim(`(${String(e.digest ?? '').slice(0, 19)}…)`)}${attribution(e)}`;
  }
  const parts = [];
  if (e.saw) parts.push(`saw: ${e.saw}`);
  if (e.did) parts.push(`did: ${e.did}`);
  if (e.skipped) parts.push(`skipped: ${e.skipped}`);
  if (e.stopped) parts.push(`stopped: ${e.stopped}`);
  if (e.note) parts.push(e.note);
  return `${head} ${parts.join(' · ') || dim('(empty note)')}${attribution(e)}`;
}

export function cmdRecord(argv) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'add':
      return recordAdd(rest);
    case 'log':
      return recordLog(rest);
    case 'verify':
      return recordVerify(rest);
    case 'keygen':
      return recordKeygen(rest);
    case 'sign':
      return recordSign(rest);
    default:
      console.error('usage: docket record <add|log|verify|sign|keygen>');
      return 1;
  }
}

function recordKeygen(argv) {
  const { flags } = parseArgs(argv, { booleans: ['force'] });
  const keyPath = typeof flags.out === 'string' ? flags.out : defaultKeyPath();
  if (fs.existsSync(keyPath) && !flags.force) {
    console.error(
      `docket: ${keyPath} already exists — refusing to overwrite a signing key.\n` +
        '  Every attestation ever made with it would stop verifying. Pass --force if you mean it.'
    );
    return 1;
  }
  const { privateKeyPem, publicKeyBase64 } = generateKeyPair();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  // 0600 at creation, not after: a key that is world-readable for even one
  // moment has been readable.
  fs.writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  console.log(green('✓') + ` signing key written to ${keyPath} ${dim('(mode 0600)')}`);
  console.log(`\n${bold('public key')} — share this; it is what others pin to trust your attestations:`);
  console.log(`  ${publicKeyBase64}`);
  console.log(
    dim('\n  Keep the private key out of the repo it signs. A key committed next to')
  );
  console.log(dim('  the log it attests to proves nothing: anyone who can rewrite the log'));
  console.log(dim('  can re-sign it.'));
  return 0;
}

function recordSign(argv) {
  const { flags } = parseArgs(argv, { booleans: ['json'] });
  const docketDir = requireDocketDir();
  const keyPath = typeof flags.key === 'string' ? flags.key : defaultKeyPath();
  if (!fs.existsSync(keyPath)) {
    console.error(
      `docket: no signing key at ${keyPath} — run \`docket record keygen\` first,\n` +
        '  or point at one with --key <path> or DOCKET_KEY.'
    );
    return 1;
  }

  let attestation;
  try {
    attestation = createAttestation(docketDir, fs.readFileSync(keyPath, 'utf8'), {
      by: flags.by,
      note: typeof flags.note === 'string' ? flags.note : undefined,
    });
  } catch (err) {
    if (err instanceof AttestError) {
      console.error(red('✗ ') + err.message);
      return 1;
    }
    throw err;
  }

  if (flags.json) {
    console.log(JSON.stringify(attestation, null, 2));
    return 0;
  }
  const file = writeAttestation(docketDir, attestation);
  console.log(
    green('✓') + ` signed the record at ${attestation.count} entr${attestation.count === 1 ? 'y' : 'ies'}`
  );
  console.log(dim(`  head: ${attestation.head}`));
  console.log(dim(`  by:   ${attestation.by}`));
  console.log(dim(`  → ${file}`));
  console.log(
    dim('\n  Commit it. Anyone with your public key can now prove this record has not')
  );
  console.log(dim('  had its tail cut off, even after it grows: `docket record verify --attest`.'));
  return 0;
}

function recordAdd(argv) {
  const { flags, positional } = parseArgs(argv);
  const loopName = positional[0];
  if (!loopName) {
    console.error(
      'usage: docket record add <loop> [--saw ..] [--did ..] [--skipped ..] [--stopped ..] [--note ..] [--by <agent>]'
    );
    return 1;
  }
  const docketDir = requireDocketDir();
  // Existence check by filename, deliberately not a full parse: a loop file
  // with a frontmatter typo must not block the agent from leaving evidence.
  if (!loopExists(docketDir, loopName)) {
    const available = loopNames(docketDir);
    console.error(
      `docket: no loop named "${loopName}"${available.length ? ` — have: ${available.join(', ')}` : ''}`
    );
    return 1;
  }
  const { fields, dropped } = collectRecordFields(flags);
  if (dropped.length) {
    // A record entry that silently loses evidence is worse than an error.
    console.error(
      `docket: refusing to write — ${dropped.map((d) => `--${d}`).join(', ')} ` +
        `${dropped.length === 1 ? 'has' : 'have'} no text (empty or missing value)`
    );
    return 1;
  }
  if (!Object.keys(fields).length) {
    console.error('docket: a record entry with nothing in it proves nothing — pass --saw/--did/--skipped/--stopped/--note');
    return 1;
  }
  const entry = appendRecord(
    docketDir,
    { loop: loopName, kind: 'note', via: 'cli', ...fields },
    { by: flags.by }
  );
  console.log(
    green('✓') +
      ` record #${entry.seq} ${dim(entry.hash.slice(0, 23) + '…')} ${dim(`by ${entry.by}`)}`
  );
  return 0;
}

function recordLog(argv) {
  const { flags, positional } = parseArgs(argv);
  const docketDir = requireDocketDir();
  const loopName = positional[0];
  // A mistyped --n must not silently print the whole log: "20 lines" and
  // "everything since March" are very different answers to the same command.
  const n = Number(flags.n ?? 20);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`docket: --n must be a positive number (got "${flags.n}")`);
    return 1;
  }
  const by = typeof flags.by === 'string' ? flags.by : null;
  let entries = readRecords(docketDir);
  if (loopName) entries = entries.filter((e) => e.loop === loopName);
  if (by) entries = entries.filter((e) => e.by === by);
  if (!entries.length) {
    console.log(by ? `no record entries by "${by}"` : 'no record entries yet');
    return 0;
  }
  for (const e of entries.slice(-n)) console.log(formatEntry(e));
  const scope = by ? ` by ${by}` : '';
  console.log(dim(`\n${entries.length} total${scope} · file: ${recordFile(docketDir)}`));
  return 0;
}

function recordVerify(argv) {
  const { flags, positional } = parseArgs(argv, { booleans: ['attest'] });
  const docketDir = requireDocketDir();

  if (flags.attest !== undefined) return verifyWithAttestation(docketDir, flags, positional);

  const result = verifyRecord(docketDir, {
    expectHead: typeof flags.head === 'string' ? flags.head : undefined,
  });
  if (result.ok) {
    console.log(
      green('✓ chain intact') +
        ` — ${result.count} entr${result.count === 1 ? 'y' : 'ies'}, every entry commits to the one before it`
    );
    console.log(dim(`  head: ${result.head}`));
    console.log(
      dim('  pin this head somewhere the log can\'t reach, then: docket record verify --head <hash>')
    );
    return 0;
  }
  console.error(red(bold('✗ chain broken')) + ` at entry ${result.brokenAt}: ${result.problem}`);
  console.error(dim('  a record that can be edited quietly is not a record'));
  return 1;
}

// `--attest` alone uses the newest attestation in .docket/attestations;
// `--attest <file>`, `--attest=<file>`, or a trailing path names one.
// `--key <pub|path>` pins who must have signed it.
//
// `attest` is declared boolean so that `--attest --key K` doesn't swallow
// `--key` as its value. That means a bare `--attest <file>` arrives as a
// positional, and it must be honored: silently verifying a DIFFERENT
// attestation than the one the user named is the worst possible outcome here
// — a green check about a file they never asked about.
function verifyWithAttestation(docketDir, flags, positional = []) {
  let attestation;
  let source;
  const named = typeof flags.attest === 'string' ? flags.attest : positional[0];
  if (named) {
    source = named;
    try {
      attestation = parseAttestation(fs.readFileSync(source, 'utf8'));
    } catch (err) {
      console.error(red('✗ ') + (err instanceof AttestError ? err.message : err.message));
      return 1;
    }
  } else {
    const found = latestAttestation(docketDir);
    if (!found) {
      console.error(
        'docket: no attestations found — run `docket record sign` to make one,\n' +
          '  or point at a file with --attest <path>.'
      );
      return 1;
    }
    ({ attestation, file: source } = found);
  }

  // A pinned key may be given as the base64 key itself or as a file holding
  // one — a public key is usually pasted, sometimes committed.
  let trustedKey;
  if (typeof flags.key === 'string') {
    if (fs.existsSync(flags.key)) {
      const text = fs.readFileSync(flags.key, 'utf8').trim();
      trustedKey = text.includes('BEGIN') ? publicKeyOf(text) : text;
    } else {
      trustedKey = flags.key.trim();
    }
  }

  const result = verifyAgainstAttestation(docketDir, attestation, { trustedKey });
  if (!result.ok) {
    console.error(red(bold('✗ record does not match the attestation')) + `: ${result.problem}`);
    console.error(dim(`  attestation: ${source}`));
    return 1;
  }

  console.log(
    green('✓ record matches the attestation') +
      ` — signed at ${attestation.count} entr${attestation.count === 1 ? 'y' : 'ies'}` +
      (result.grew ? `, ${result.grew} appended since` : '')
  );
  console.log(dim(`  signed: ${attestation.ts} by ${attestation.by ?? '(unstated)'}`));
  console.log(dim(`  head:   ${attestation.head}`));
  if (result.trusted) {
    console.log(green('  key:    pinned — this is the key you said to trust'));
    return 0;
  }
  // The honest version of a green check. Without a pinned key this run proved
  // the record is intact and the attestation unedited — and nothing about who
  // made it. Saying so is the difference between evidence and decoration.
  console.log(
    yellow('  key:    not pinned') +
      dim(' — this proves the record is intact and the attestation unedited,')
  );
  console.log(dim('          but not who signed it. Anyone can generate a key.'));
  console.log(dim(`          Pin it: docket record verify --attest --key ${attestation.key.slice(0, 24)}…`));
  return 0;
}
