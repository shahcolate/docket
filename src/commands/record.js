import { parseArgs } from '../lib/args.js';
import { requireDocketDir, loopExists, loopNames } from '../lib/loop.js';
import {
  appendRecord,
  collectRecordFields,
  readRecords,
  verifyRecord,
  recordFile,
} from '../lib/record.js';
import { bold, cyan, dim, green, red, VERDICT_STYLE } from '../lib/ui.js';

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
    default:
      console.error('usage: docket record <add|log|verify>');
      return 1;
  }
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
  const { flags } = parseArgs(argv);
  const docketDir = requireDocketDir();
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
