import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { parseArgs } from '../lib/args.js';
import {
  requireDocketDir,
  loopFile,
  parseLoop,
  splitFrontmatter,
  LoopError,
  LOOP_NAME_RE,
} from '../lib/loop.js';
import { checkWarrant } from '../lib/warrant.js';
import { dumpYaml } from '../lib/yaml.js';
import { bold, cyan, dim, green, VERDICT_STYLE } from '../lib/ui.js';

const TEMPLATES_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), '../../templates');

export function listTemplates() {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.loop.md'))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8');
      const loop = parseLoop(text, { file: f });
      return { name: loop.name, description: loop.description, file: path.join(TEMPLATES_DIR, f) };
    });
}

export function cmdTemplates() {
  console.log(bold('Starter loops') + dim(' — each is one recurring task, five layers, ready to edit\n'));
  for (const t of listTemplates()) {
    console.log(`  ${cyan(t.name.padEnd(20))} ${t.description}`);
  }
  console.log(dim('\nUse one:  docket new <name> --template <template>'));
  return 0;
}

function scaffold({ name, description, brief, procedure, warrant, reserved, record }) {
  const frontmatter = dumpYaml({
    name,
    description,
    version: 1,
    warrant,
    reserved,
    record,
  });
  return `---\n${frontmatter}---\n\n# Brief\n\n${brief}\n\n# Procedure\n\n${procedure}\n`;
}

const PLACEHOLDER = {
  brief: `<!-- The context that changes the answer: the people involved, the history
so far, hard constraints, standards, and decisions already made. Without
this, the agent guesses. -->\n\n- TODO`,
  procedure: `<!-- How this job is done properly. Which sources count, what finished
looks like, and the known ways it goes wrong. -->\n\n1. TODO`,
};

const DEFAULT_RESERVED = ['final approval'];
const DEFAULT_RECORD = ['what it saw', 'what it did', 'what it left alone', 'where it stopped'];

function splitList(answer) {
  return answer
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// One readline wrapper for the whole guided session. Lines that arrive while
// no question is pending are buffered — pasted or piped blocks of prepared
// answers must feed successive questions, not vanish.
function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const buffered = [];
  let waiter = null;
  let closed = false;
  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.resolve(line);
    } else {
      buffered.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const err = new Error('interview aborted');
      err.code = 'ABORT_ERR';
      waiter.reject(err);
    }
  });
  const readAnswer = () => {
    if (buffered.length) return Promise.resolve(buffered.shift());
    if (closed) {
      const err = new Error('interview aborted');
      err.code = 'ABORT_ERR';
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      waiter = { resolve, reject };
    });
  };
  const q = async (prompt, hint) => {
    if (hint) console.log(dim(`  ${hint}`));
    rl.setPrompt(`${prompt} `);
    rl.prompt();
    const a = await readAnswer();
    console.log();
    return a.trim();
  };
  const confirm = async (prompt) => {
    const a = await q(`${prompt} ${dim('[Y/n]')}`);
    return !/^n/i.test(a);
  };
  return { q, confirm, close: () => rl.close() };
}

// Each step opens with the layer's question and one short paragraph of the
// spec's reasoning — the creator is a tour of spec/SPEC.md, not a form.
function step(n, layer, question, why) {
  console.log(`\n${bold(`Step ${n} of 5 · ${layer}`)} — ${question}`);
  for (const line of why.split('\n')) console.log(dim(`  ${line}`));
}

const VERB_PROMPTS = [
  ['read', 'look at it'],
  ['draft', 'produce it — it goes nowhere on its own'],
  ['change', 'mutate state that stays inside the sandbox'],
  ['send', 'consequences leave the sandbox: email, publish, file, deploy, pay'],
];

async function guided(initialName, docketDir) {
  const p = createPrompter();
  try {
    console.log(
      `\n${bold('A loop is one recurring task wrapped in five layers.')}\n` +
        dim('Five steps, one per layer. Comma-separate lists; an empty answer means\n') +
        dim('"nothing yet" — the result is a plain Markdown file you can edit anytime.')
    );

    let name = initialName;
    while (!name) {
      const a = await p.q(
        `\n${bold('Name this loop:')}`,
        'one recurring task, not an assistant — e.g. insurance-appeal, weekly-planning'
      );
      if (!LOOP_NAME_RE.test(a)) {
        console.log(dim('  loop names are lowercase letters, digits, and dashes\n'));
      } else if (fs.existsSync(loopFile(docketDir, a))) {
        console.log(dim(`  loop "${a}" already exists — pick another name\n`));
      } else {
        name = a;
      }
    }
    const description = await p.q(bold('One line on what this loop does:'));

    step(
      1,
      'Brief',
      'what must the agent know before it starts?',
      'The context that changes the answer: the people involved, the history\nso far, hard constraints, decisions already made. Without this, the\nagent guesses.'
    );
    const brief = await p.q(bold('  brief:'));

    step(
      2,
      'Procedure',
      'how is this work supposed to be done?',
      'Which sources count, what finished looks like, and the known ways this\njob goes wrong.'
    );
    const procedure = await p.q(bold('  procedure:'));

    step(
      3,
      'Warrant',
      'what may it do without asking?',
      'Four verbs, in escalating order of consequence. This is the heart of\nthe spec: anything you do NOT list here, the agent must ask about.\nUnlisted means ask — silence is never permission. Leaving a list empty\nis safe, not broken: it means every such action asks first.'
    );
    const warrant = {};
    for (const [verb, meaning] of VERB_PROMPTS) {
      warrant[verb] = splitList(await p.q(bold(`  ${verb.padEnd(7)}`) + dim(`— ${meaning}:`)));
    }

    step(
      4,
      'Stops',
      'where does it have to stop?',
      '`ask` always needs a human first, whatever the verb. `never` does not\nhappen even WITH approval — you are pre-deciding, under calm conditions,\nwhat no in-the-moment persuasion may undo. `reserved` names what stays\nwith the human, always.'
    );
    warrant.ask = splitList(await p.q(bold('  always ask before:')));
    warrant.never = splitList(await p.q(bold('  never, even with approval:')));
    const reserved = splitList(
      await p.q(bold('  reserved for the human:'), 'empty = "final approval" stays human')
    );

    step(
      5,
      'Record',
      'what evidence must it leave behind?',
      'What the agent must report when it finishes or stops. Entries land in\nan append-only, hash-chained log — `docket record verify` makes silent\nedits visible.'
    );
    const record = splitList(
      await p.q(bold('  record:'), 'empty = what it saw, did, left alone, and where it stopped')
    );

    const content = scaffold({
      name,
      description: description || `The ${name} loop.`,
      brief: brief ? `- ${brief}` : PLACEHOLDER.brief,
      procedure: procedure ? `1. ${procedure}` : PLACEHOLDER.procedure,
      warrant,
      reserved: reserved.length ? reserved : DEFAULT_RESERVED,
      record: record.length ? record : DEFAULT_RECORD,
    });

    const dest = loopFile(docketDir, name);
    console.log(bold('Your loop, as one file:') + dim(`  ${path.relative(process.cwd(), dest)}\n`));
    for (const line of content.trimEnd().split('\n')) console.log(dim('  │ ') + line);
    console.log();
    if (!(await p.confirm(bold('Write it?')))) {
      console.error('docket: not written — run `docket new` again when ready');
      return null;
    }
    return { name, dest, content };
  } finally {
    p.close();
  }
}

// The payoff of the tour: run the verdict algorithm live against the warrant
// the author just wrote, so allow / ask / deny stop being abstract. Nothing
// here touches the record — these are demonstrations, not agent checks.
function demoChecks(loop) {
  const demos = [];
  for (const [verb] of VERB_PROMPTS) {
    if (loop.warrant[verb].length) {
      demos.push([verb, loop.warrant[verb][0]]);
      break;
    }
  }
  for (const target of ['ordering 500 pizzas', 'renaming the company', 'posting on the CEO’s behalf']) {
    if (checkWarrant(loop, 'send', target).rule === 'default') {
      demos.push(['send', target]);
      break;
    }
  }
  if (loop.warrant.never.length) demos.push(['change', loop.warrant.never[0]]);
  if (!demos.length) return;

  console.log(`\n${bold('Watch the warrant answer — the verdict algorithm, live:')}`);
  for (const [action, target] of demos) {
    const result = checkWarrant(loop, action, target);
    const style = VERDICT_STYLE[result.verdict];
    console.log(`\n  ${style.color(bold(style.badge))}  ${action} → "${target}"`);
    console.log(dim(`    ${result.reason} (rule: ${result.rule})`));
  }
  console.log(
    dim('\n  Real checks work the same way — and land on the record:\n') +
      dim(`    docket check ${loop.name} send "…"   (exit 0 allow · 2 ask · 3 deny)`)
  );
}

// Rename a template through the frontmatter layer, not blind text
// substitution — and parseLoop's name-vs-filename check backstops it.
function withName(templateText, name) {
  const { frontmatter, body } = splitFrontmatter(templateText);
  const renamed = frontmatter.replace(/^\s*name\s*:.*$/m, `name: ${name}`);
  return `---\n${renamed}\n---\n${body}`;
}

export async function cmdNew(argv) {
  const { flags, positional } = parseArgs(argv, { booleans: ['blank', 'guided'] });
  const name = positional[0];
  const interactive =
    !flags.blank &&
    !flags.template &&
    (flags.guided || (process.stdin.isTTY && process.stdout.isTTY));
  if (!name && !interactive) {
    console.error('usage: docket new [name] [--template <template>] [--blank] [--guided]');
    return 1;
  }
  if (name && !LOOP_NAME_RE.test(name)) {
    console.error('docket: loop names are lowercase letters, digits, and dashes');
    return 1;
  }
  const docketDir = requireDocketDir();
  if (name && fs.existsSync(loopFile(docketDir, name))) {
    console.error(`docket: loop "${name}" already exists at ${loopFile(docketDir, name)}`);
    return 1;
  }

  let dest = name ? loopFile(docketDir, name) : null;
  let content;
  if (flags.template) {
    const tpl = listTemplates().find((t) => t.name === flags.template);
    if (!tpl) {
      console.error(
        `docket: no template "${flags.template}" — run \`docket templates\` to see them`
      );
      return 1;
    }
    content = withName(fs.readFileSync(tpl.file, 'utf8'), name);
  } else if (interactive) {
    let result;
    try {
      result = await guided(name, docketDir);
    } catch (err) {
      if (err && (err.code === 'ABORT_ERR' || /abort/i.test(err.message ?? ''))) {
        console.error('\ndocket: interview cancelled — nothing written');
        return 1;
      }
      throw err;
    }
    if (!result) return 1;
    ({ dest, content } = result);
  } else {
    content = scaffold({
      name,
      description: `TODO: one line on what the ${name} loop does.`,
      brief: PLACEHOLDER.brief,
      procedure: PLACEHOLDER.procedure,
      warrant: { read: [], draft: [], change: [], send: [], ask: [], never: [] },
      reserved: DEFAULT_RESERVED,
      record: DEFAULT_RECORD,
    });
  }

  // Validate before writing — a loop that can't be parsed can't protect anyone.
  let loop;
  try {
    loop = parseLoop(content, { file: dest });
  } catch (err) {
    if (err instanceof LoopError) {
      console.error(`docket: refusing to write an invalid loop: ${err.message}`);
      return 1;
    }
    throw err;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  console.log(green('✓') + ` wrote ${path.relative(process.cwd(), dest)}`);
  if (interactive) demoChecks(loop);
  console.log(dim(`  edit it, then: docket show ${loop.name} · docket check ${loop.name} send "…" · docket compile --write`));
  return 0;
}
