import { bold, cyan, dim } from './lib/ui.js';
import { VERSION } from './lib/pkg.js';
import { cmdInit } from './commands/init.js';
import { cmdNew, cmdTemplates } from './commands/new.js';
import { cmdList, cmdShow } from './commands/list.js';
import { cmdCheck } from './commands/check.js';
import { cmdRecord } from './commands/record.js';
import { cmdCompile } from './commands/compile.js';
import { cmdReview } from './commands/review.js';
import { cmdMcp } from './commands/mcp.js';

const HELP = `
${bold('docket')} — brief the agent, warrant the actions, keep the record

${bold('Usage:')} docket <command> [args]

${bold('Getting started')}
  ${cyan('init')}                       create a .docket directory here
  ${cyan('new')} <name>                 create a loop (interactive, or --template <t>)
  ${cyan('templates')}                  list the starter loop templates

${bold('Working with loops')}
  ${cyan('list')}                       list your loops
  ${cyan('show')} <loop>                print a loop's five layers
  ${cyan('check')} <loop> <action> <target>
                             ask the warrant: allow, ask, or deny?
                             (actions: read, draft, change, send)

${bold('Iterating')}
  ${cyan('review')} [--min 2] [--loop <name>] [--yes]
                             propose warrant updates from repeated asks —
                             you approve each one; approvals go on the record

${bold('The record')}
  ${cyan('record add')} <loop> [--did ..] [--saw ..] [--skipped ..] [--stopped ..] [--note ..]
  ${cyan('record log')} [loop] [--n 20]
  ${cyan('record verify')}             verify the hash chain end to end

${bold('Portability')}
  ${cyan('compile')} [--target claude|agents|cursor|raw] [--loop <name>] [--write]
                             render loops into CLAUDE.md / AGENTS.md / Cursor rules
  ${cyan('mcp')}                        run the MCP server (stdio) for agent integration

${dim('Every loop answers five questions: what must it know, how is the work')}
${dim('done, what may it do without asking, where does it stop, and what')}
${dim('evidence must it leave. Unwritten answers get guessed at.')}
`;

export async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP.trimEnd());
      return 0;
    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION);
      return 0;
    case 'init':
      return cmdInit(rest);
    case 'new':
      return cmdNew(rest);
    case 'templates':
      return cmdTemplates(rest);
    case 'list':
      return cmdList(rest);
    case 'show':
      return cmdShow(rest);
    case 'check':
      return cmdCheck(rest);
    case 'record':
      return cmdRecord(rest);
    case 'compile':
      return cmdCompile(rest);
    case 'review':
      return cmdReview(rest);
    case 'mcp':
      return cmdMcp(rest);
    default:
      console.error(`docket: unknown command "${command}" — try \`docket help\``);
      return 1;
  }
}
