import { parseArgs } from '../lib/args.js';
import { requireDocketDir, listLoops } from '../lib/loop.js';
import { matchLoops } from '../lib/match.js';
import { bold, cyan, dim, yellow } from '../lib/ui.js';

// Exit codes mirror the warrant's contract: 0 = a loop covers this,
// 2 = nothing does (which means ask), 1 = usage error. Hooks can gate on it.
export function cmdMatch(argv) {
  const { flags, positional } = parseArgs(argv);
  const intent = positional.join(' ').trim();
  if (!intent) {
    console.error('usage: docket match <the task, in plain words…>');
    return 1;
  }
  const limit = Number.parseInt(flags.limit ?? '3', 10);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error('docket: --limit must be a positive integer');
    return 1;
  }

  const docketDir = requireDocketDir();
  const loops = listLoops(docketDir);
  if (!loops.length) {
    console.error('docket: no loops defined — create one with `docket new <name>`');
    return 1;
  }

  const candidates = matchLoops(loops, intent, { limit });
  if (!candidates.length) {
    console.log(`${yellow(bold('NO LOOP'))}  "${intent}"`);
    console.log('  No loop covers this task. Work outside a loop defaults to ask —');
    console.log('  check with a human, or write the loop: docket new <name>');
    return 2;
  }

  console.log(
    bold(`${candidates.length} candidate loop${candidates.length === 1 ? '' : 's'}`) +
      dim(` for "${intent}"`) +
      '\n'
  );
  for (const c of candidates) {
    const why = c.hits.map((h) => `${h.field}: ${h.pattern}`).join(' · ');
    console.log(`  ${cyan(c.loop.name.padEnd(22))} ${c.loop.description}`);
    console.log(dim(`  ${''.padEnd(22)} score ${c.score} — ${why}`));
  }
  console.log(dim('\nload the winner before working: docket show <loop> · docket compile --loop <loop>'));
  return 0;
}
