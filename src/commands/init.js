import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../lib/args.js';
import { findDocketDir } from '../lib/loop.js';
import { bold, cyan, dim, green } from '../lib/ui.js';

const GITIGNORE_HINT = `# Docket keeps everything in plain files on purpose — commit them.
# If a loop's Memory section holds things you don't want in git, move the
# loop here and ignore it explicitly, e.g.:
# loops/private-*.loop.md
`;

export function cmdInit(argv) {
  const { flags } = parseArgs(argv, { booleans: ['quiet'] });
  const root = path.resolve(flags.dir ?? process.cwd());
  const dir = path.join(root, '.docket');
  if (fs.existsSync(dir)) {
    console.log(`already initialized: ${dir}`);
    return 0;
  }
  // A .docket in an ancestor doesn't block a nested project — it would
  // silently swallow this project's loops and record. Create locally, warn.
  const ancestor = findDocketDir(root);
  if (ancestor) {
    console.log(
      `note: ${ancestor} exists above this directory; commands run here will now use the new one`
    );
  }
  fs.mkdirSync(path.join(dir, 'loops'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), GITIGNORE_HINT);

  if (!flags.quiet) {
    console.log(green('✓') + ` created ${path.relative(process.cwd(), dir) || dir}`);
    console.log(`
${bold('A loop is one recurring task the agent does for you, wrapped in five layers.')}
Before an agent touches anything, a loop answers:

  1. What must it ${bold('know')} before it starts?
  2. How is this work ${bold('supposed to be done')}?
  3. What may it do ${bold('without asking')}?
  4. Where does it have to ${bold('stop')}?
  5. What ${bold('evidence')} must it leave behind?

${dim('Unwritten answers get guessed at. Written answers get enforced.')}

Next:
  ${cyan('docket templates')}              see the starter loops
  ${cyan('docket new')}                    build a loop step by step — it teaches the five layers
  ${cyan('docket new appeal --template insurance-appeal')}
  ${cyan('docket compile --target claude --write')}   put your loops in front of the agent
`);
  }
  return 0;
}
