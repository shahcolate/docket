import path from 'node:path';
import { parseArgs } from '../lib/args.js';
import { requireDocketDir, listLoops, loadLoop } from '../lib/loop.js';
import { renderBlock, renderIndexBlock, compileToFile, TARGETS } from '../lib/compile.js';
import { dim, green } from '../lib/ui.js';

// Above this, the full render starts crowding out the actual work — suggest
// the index. ~4 chars per token is close enough to warn honestly.
const TOKEN_HINT_AT = 2500;
const estimateTokens = (text) => Math.round(text.length / 4);

export function cmdCompile(argv) {
  const { flags } = parseArgs(argv, { booleans: ['write', 'index'] });
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
  if (flags.loop && flags.index) {
    console.error(
      'docket: --index compiles the routing table over all loops; --loop previews one full loop — pick one'
    );
    return 1;
  }
  const loops = flags.loop ? [loadLoop(docketDir, flags.loop)] : listLoops(docketDir);
  if (!loops.length) {
    console.error('docket: no loops to compile — create one with `docket new <name>`');
    return 1;
  }

  const block = flags.index ? renderIndexBlock(loops) : renderBlock(loops);
  // The hint goes to stderr so `docket compile > file` stays clean.
  const hintIndex = () => {
    if (flags.index || flags.loop) return;
    const tokens = estimateTokens(block);
    if (tokens < TOKEN_HINT_AT) return;
    console.error(
      dim(
        `  ~${tokens} tokens will sit in the agent's context on every turn — \`docket compile --index\`\n` +
          `  compiles the protocol plus one line per loop instead; full loops load on demand`
      )
    );
  };

  if (!flags.write || target === 'raw') {
    console.log(block);
    if (flags.write && target === 'raw') {
      console.error(dim('(raw target always prints to stdout)'));
    }
    hintIndex();
    return 0;
  }

  const rootDir = path.dirname(docketDir);
  const file = compileToFile(rootDir, target, loops, { index: flags.index });
  const what = flags.index
    ? `index of ${loops.length} loop${loops.length === 1 ? '' : 's'}`
    : `${loops.length} loop${loops.length === 1 ? '' : 's'}`;
  console.log(
    green('✓') +
      ` compiled ${what} → ${path.relative(process.cwd(), file)} ${dim(`(${TARGETS[target].label})`)}`
  );
  console.log(dim('  re-run after editing loops; the docket block is replaced in place'));
  hintIndex();
  return 0;
}
