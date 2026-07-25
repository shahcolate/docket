// `docket metrics` — read the record, report the autonomy posture.
//
// The record is the evidence; this reads it back as the dashboard a team
// needs to climb the autonomy ladder deliberately. Exact numbers from the
// hash chain, two labeled proxies, no new data collected.

import { parseArgs } from '../lib/args.js';
import { requireDocketDir, loopNames } from '../lib/loop.js';
import { readRecords, recordFile } from '../lib/record.js';
import { computeMetrics } from '../lib/metrics.js';
import { bold, cyan, dim, green, yellow, red } from '../lib/ui.js';

function pct(x) {
  return `${Math.round(x * 100)}%`;
}
function bar(x, width = 18) {
  const n = Math.round(x * width);
  return '█'.repeat(n) + dim('░'.repeat(width - n));
}

export function cmdMetrics(argv) {
  const { flags } = parseArgs(argv, { booleans: ['json'] });
  const docketDir = requireDocketDir();

  if (flags.loop && !loopNames(docketDir).includes(String(flags.loop))) {
    console.error(`docket: no loop named "${flags.loop}" — have: ${loopNames(docketDir).join(', ') || '(none)'}`);
    return 1;
  }

  const entries = readRecords(docketDir);
  const m = computeMetrics(entries, {
    loop: flags.loop ? String(flags.loop) : undefined,
    by: typeof flags.by === 'string' ? flags.by : undefined,
  });

  if (flags.json) {
    console.log(JSON.stringify(m, null, 2));
    return 0;
  }

  const scope =
    (flags.loop ? ` · loop ${cyan(String(flags.loop))}` : '') +
    (typeof flags.by === 'string' ? ` · by ${cyan(flags.by)}` : '');
  console.log(`${bold('docket metrics')}${scope} ${dim(`· ${recordFile(docketDir)}`)}`);

  if (!m.checks) {
    const why =
      typeof flags.by === 'string'
        ? `\nno warrant checks recorded by "${flags.by}" — check \`docket metrics\` for who has been writing.`
        : '\nno warrant checks recorded yet — the numbers appear once the agent starts checking.';
    console.log(dim(why));
    return 0;
  }

  console.log(`\n${bold('Warrant checks')}  ${m.checks}`);
  console.log(`  ${green('allow'.padEnd(6))} ${String(m.verdict.allow).padStart(4)}  ${bar(m.rates.autoApproved)}  ${pct(m.rates.autoApproved).padStart(4)}  ${dim('ran on its own')}`);
  console.log(`  ${yellow('ask'.padEnd(6))} ${String(m.verdict.ask).padStart(4)}  ${bar(m.rates.escalated)}  ${pct(m.rates.escalated).padStart(4)}  ${dim('stopped for a human')}`);
  console.log(`  ${red('deny'.padEnd(6))} ${String(m.verdict.deny).padStart(4)}  ${bar(m.rates.denied)}  ${pct(m.rates.denied).padStart(4)}  ${dim('hard stop')}`);

  console.log(`\n${bold('Autonomy')}`);
  console.log(`  actions per intervention   ${m.actionsPerIntervention.toFixed(1).padStart(5)}   ${dim('proxy — checks ÷ (asks + denies)')}`);
  console.log(`  longest unattended run     ${String(m.longestUnattendedRun).padStart(5)}   ${dim('consecutive allows, no human stop')}`);
  console.log(`  warrant amendments         ${String(m.amendments).padStart(5)}   ${dim('human-approved widenings (docket review)')}`);
  console.log(`  work notes                 ${String(m.work.notes).padStart(5)}   ${dim(`${m.work.withStop} recorded where they stopped`)}`);

  const loopKeys = Object.keys(m.byLoop);
  if (loopKeys.length > 1 || !flags.loop) {
    console.log(`\n${bold('By loop')}`);
    for (const [name, b] of Object.entries(m.byLoop).sort((a, c) => c[1].checks - a[1].checks)) {
      console.log(`  ${cyan(name.padEnd(20))} ${String(b.checks).padStart(4)} checks   ${dim(`allow ${b.allow} · ask ${b.ask} · deny ${b.deny}`)}`);
    }
  }

  // Only worth a section when the record has more than one subject: with a
  // single agent this is a row that says what the header already said.
  const actorKeys = Object.keys(m.byActor);
  if (actorKeys.length > 1) {
    console.log(`\n${bold('By agent')}`);
    for (const [who, b] of Object.entries(m.byActor).sort((a, c) => c[1].checks - a[1].checks)) {
      const where = b.branches.length ? ` ${dim(`· ${b.branches.join(', ')}`)}` : '';
      console.log(
        `  ${cyan(who.padEnd(20))} ${String(b.checks).padStart(4)} checks   ${dim(`allow ${b.allow} · ask ${b.ask} · deny ${b.deny}`)}${where}`
      );
    }
    console.log(dim('  scope to one with --by <agent> · attribution is self-reported, and hash-chained once written'));
  }

  const chans = Object.entries(m.byChannel).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`\n${bold('By channel')}  ${dim(chans)}`);
  console.log(dim('\nEvery number is exact from the hash chain except the labeled proxy.'));
  return 0;
}
