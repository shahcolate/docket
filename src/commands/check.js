import { parseArgs } from '../lib/args.js';
import { requireDocketDir, loadLoop, ACTIONS } from '../lib/loop.js';
import { checkWarrant } from '../lib/warrant.js';
import { recordCheck } from '../lib/record.js';
import { bold, dim, VERDICT_STYLE } from '../lib/ui.js';

// Exit codes are part of the contract, so scripts and hooks can gate on them:
//   0 = allow, 2 = ask, 3 = deny.
const EXIT = { allow: 0, ask: 2, deny: 3 };

export function cmdCheck(argv) {
  const { flags, positional } = parseArgs(argv, { booleans: ['no-record', 'quiet'] });
  const [loopName, action, ...targetParts] = positional;
  const target = targetParts.join(' ');
  if (!loopName || !action || !target) {
    console.error('usage: docket check <loop> <read|draft|change|send> <target…>');
    return 1;
  }
  if (!ACTIONS.includes(action)) {
    console.error(`docket: "${action}" is not an action — use one of: ${ACTIONS.join(', ')}`);
    return 1;
  }
  const docketDir = requireDocketDir();
  const loop = loadLoop(docketDir, loopName);
  const result = checkWarrant(loop, action, target);

  // The check itself is evidence: record what was asked, what was answered,
  // and who asked — `--by` names the agent when the environment can't.
  if (!flags['no-record']) {
    recordCheck(docketDir, loop.name, action, target, result, { via: 'cli' }, { by: flags.by });
  }

  const style = VERDICT_STYLE[result.verdict];
  if (!flags.quiet) {
    console.log(`${style.color(bold(style.badge))}  ${action} → "${target}"`);
    console.log(`  ${result.reason}`);
    console.log(dim(`  rule: ${result.rule} · loop: ${loop.name} · exit ${EXIT[result.verdict]}`));
  } else {
    console.log(result.verdict);
  }
  return EXIT[result.verdict];
}
