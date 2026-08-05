import { bold, cyan, dim } from './lib/ui.js';
import { VERSION } from './lib/pkg.js';
import { cmdInit } from './commands/init.js';
import { cmdNew, cmdTemplates } from './commands/new.js';
import { cmdList, cmdShow } from './commands/list.js';
import { cmdCheck } from './commands/check.js';
import { cmdMatch } from './commands/match.js';
import { cmdRecord } from './commands/record.js';
import { cmdMetrics } from './commands/metrics.js';
import { cmdCompile } from './commands/compile.js';
import { cmdReview } from './commands/review.js';
import { cmdMcp } from './commands/mcp.js';
import { cmdHook } from './commands/hook.js';
import { cmdIntercept } from './commands/intercept.js';
import { cmdInstall } from './commands/install.js';

const HELP = `
${bold('docket')} — brief the agent, warrant the actions, keep the record

${bold('Usage:')} docket <command> [args]

${bold('Getting started')}
  ${cyan('init')}                       create a .docket directory here
  ${cyan('install')}                    make docket ambient in this repo: compile context for
                             every agent, wire the Claude Code hook, add MCP config
  ${cyan('new')} [name]                 create a loop — a step-by-step guided creator
                             that teaches the five layers (or --template <t>, --blank)
  ${cyan('templates')}                  list the starter loop templates

${bold('Working with loops')}
  ${cyan('list')}                       list your loops
  ${cyan('show')} <loop>                print a loop's five layers
  ${cyan('match')} <task…>              which loop covers this task? ranked, with why —
                             exit 0 = matched, 2 = no loop covers it (ask)
  ${cyan('check')} <loop> <action> <target>
                             ask the warrant: allow, ask, or deny?
                             (actions: read, draft, change, send)

${bold('Iterating')}
  ${cyan('review')} [--min 2] [--loop <name>] [--yes]
                             propose warrant updates from repeated asks —
                             you approve each one; approvals go on the record

${bold('The record')}
  ${cyan('record add')} <loop> [--did ..] [--saw ..] [--skipped ..] [--stopped ..] [--note ..]
  ${cyan('record log')} [loop] [--n 20] [--by <agent>]
  ${cyan('record verify')} [--head <hash>] [--attest [file]] [--key <pub>]
                             verify the hash chain end to end; --attest also checks
                             it against a signed head, which catches a cut tail even
                             after the log grows back
  ${cyan('record keygen')} [--out <path>]
                             make an ed25519 signing key (kept outside the repo)
  ${cyan('record sign')} [--key <path>] [--note ..] [--json]
                             sign the current head — portable proof of what the
                             record contained, for a client, an auditor, a release
  ${cyan('metrics')} [--loop <name>] [--by <agent>] [--json]
                             autonomy posture from the record: auto-approve vs
                             ask vs deny, longest unattended run, actions/intervention

${dim('Every entry is stamped with who wrote it — agent, branch, worktree —')}
${dim('so parallel agents stay separable at merge time. Override the guess')}
${dim('with --by <agent> or DOCKET_BY; scope any read back with --by.')}

${bold('Portability')}
  ${cyan('compile')} [--target claude|agents|gemini|cursor|raw] [--loop <name>] [--index] [--write]
                             render loops into CLAUDE.md / AGENTS.md / Cursor rules
                             (--index: one line per loop + the protocol, instead of
                             full loops — keeps context flat as rule count grows)
  ${cyan('mcp')}                        run the MCP server (stdio) for agent integration

${bold('Enforcement')}
  ${cyan('hook')} claude [--loop <name>] [--strict]
                             Claude Code PreToolUse hook: gate every tool call on
                             the warrant — deny blocks, ask prompts the human, allow
                             stays silent. --loop or --strict makes failures fail closed.
  ${cyan('intercept')} [--loop <name>] [--strict] [--action <verb>] [--server <name>]
                             Docker MCP Gateway interceptor: gate every tools/call
                             through the gateway, whatever the client or server.
                             Wire it with --interceptor before:exec:'docket intercept'.
                             A gateway can't prompt, so ask blocks rather than asks.

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
    case 'install':
      return cmdInstall(rest);
    case 'new':
      return cmdNew(rest);
    case 'templates':
      return cmdTemplates(rest);
    case 'list':
      return cmdList(rest);
    case 'show':
      return cmdShow(rest);
    case 'match':
      return cmdMatch(rest);
    case 'check':
      return cmdCheck(rest);
    case 'record':
      return cmdRecord(rest);
    case 'metrics':
      return cmdMetrics(rest);
    case 'compile':
      return cmdCompile(rest);
    case 'review':
      return cmdReview(rest);
    case 'mcp':
      return cmdMcp(rest);
    case 'hook':
      return cmdHook(rest);
    case 'intercept':
      return cmdIntercept(rest);
    default:
      console.error(`docket: unknown command "${command}" — try \`docket help\``);
      return 1;
  }
}
