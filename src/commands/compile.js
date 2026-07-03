import path from 'node:path';
import { parseArgs } from '../lib/args.js';
import { requireDocketDir, listLoops, loadLoop } from '../lib/loop.js';
import { renderBlock, compileToFile, TARGETS } from '../lib/compile.js';
import { dim, green } from '../lib/ui.js';

export function cmdCompile(argv) {
  const { flags } = parseArgs(argv, { booleans: ['write'] });
  const target = flags.target ?? 'raw';
  if (!TARGETS[target]) {
    console.error(`docket: unknown target "${target}" — targets: ${Object.keys(TARGETS).join(', ')}`);
    return 1;
  }
  const docketDir = requireDocketDir();
  if (flags.loop && flags.write) {
    // The managed block always holds every loop; writing just one would
    // silently delete the rest from the agent's context file.
    console.error(
      'docket: --loop is for previewing one loop on stdout — --write always compiles all loops'
    );
    return 1;
  }
  const loops = flags.loop ? [loadLoop(docketDir, flags.loop)] : listLoops(docketDir);
  if (!loops.length) {
    console.error('docket: no loops to compile — create one with `docket new <name>`');
    return 1;
  }

  if (!flags.write || target === 'raw') {
    console.log(renderBlock(loops));
    if (flags.write && target === 'raw') {
      console.error(dim('(raw target always prints to stdout)'));
    }
    return 0;
  }

  const rootDir = path.dirname(docketDir);
  const file = compileToFile(rootDir, target, loops);
  console.log(
    green('✓') +
      ` compiled ${loops.length} loop${loops.length === 1 ? '' : 's'} → ${path.relative(process.cwd(), file)} ${dim(`(${TARGETS[target].label})`)}`
  );
  console.log(dim('  re-run after editing loops; the docket block is replaced in place'));
  return 0;
}
