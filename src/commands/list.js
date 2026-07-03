import { parseArgs } from '../lib/args.js';
import { requireDocketDir, listLoops, loadLoop } from '../lib/loop.js';
import { warrantLines } from '../lib/compile.js';
import { bold, cyan, dim, red, yellow } from '../lib/ui.js';

export function cmdList() {
  const docketDir = requireDocketDir();
  const loops = listLoops(docketDir);
  if (!loops.length) {
    console.log('no loops yet — create one with `docket new <name>`');
    return 0;
  }
  console.log(bold(`${loops.length} loop${loops.length === 1 ? '' : 's'}`) + '\n');
  for (const loop of loops) {
    console.log(`  ${cyan(loop.name.padEnd(22))} ${loop.description}`);
  }
  console.log(dim('\ndetails: docket show <loop>'));
  return 0;
}

export function cmdShow(argv) {
  const { positional } = parseArgs(argv);
  const name = positional[0];
  if (!name) {
    console.error('usage: docket show <loop>');
    return 1;
  }
  const docketDir = requireDocketDir();
  const loop = loadLoop(docketDir, name);

  const section = (title, body) => {
    console.log(bold(title));
    console.log(body ? body.replace(/^/gm, '  ') : dim('  (empty)'));
    console.log();
  };

  console.log(`${bold(cyan(loop.name))} — ${loop.description}\n${dim(loop.file)}\n`);
  section('Brief — what it knows before it starts', loop.brief);
  section('Procedure — how the work is done', loop.procedure);

  console.log(bold('Warrant — what it may do on its own'));
  for (const row of warrantLines(loop)) {
    const label =
      row.kind === 'ask' ? yellow('ask'.padEnd(7)) : row.kind === 'never' ? red('never'.padEnd(7)) : row.label.padEnd(7);
    const text = row.text.startsWith('(') ? dim(row.text) : row.text;
    console.log(`  ${label} ${text}`);
  }
  console.log(dim('  unlisted = ask. Silence is never permission.\n'));

  section('Reserved — stays human', loop.reserved.map((j) => `- ${j}`).join('\n'));
  section('Record — evidence it owes', loop.record.map((r) => `- ${r}`).join('\n'));
  return 0;
}
