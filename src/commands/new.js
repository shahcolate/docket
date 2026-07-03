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
import { dumpYaml } from '../lib/yaml.js';
import { bold, cyan, dim, green } from '../lib/ui.js';

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

function splitList(answer) {
  return answer
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function interview(name) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Buffer lines that arrive while no question is pending — pasted blocks of
  // prepared answers must feed successive questions, not vanish.
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
  console.log(
    `\n${bold(`Five questions build the loop "${name}".`)}\n${dim(
      'Unwritten answers get guessed at. Written answers get enforced.'
    )}\n`
  );

  const brief = await q(
    bold('1. What must the agent know before it starts?'),
    'the context that changes the answer: people, history, constraints, standards, past decisions'
  );
  const procedure = await q(
    bold('2. How is this work supposed to be done?'),
    'sources that count, what done looks like, the known ways it goes wrong'
  );
  console.log(bold('3. What may it do without asking?') + dim('  (comma-separated; empty = ask first)'));
  const read = splitList(await q('   read:'));
  const draft = splitList(await q('   draft:'));
  const change = splitList(await q('   change:'));
  const send = splitList(await q('   send:'));
  console.log(bold('4. Where does it have to stop?'));
  const ask = splitList(await q('   always ask before:', 'comma-separated'));
  const never = splitList(await q('   never, even with approval:', 'comma-separated'));
  const reserved = splitList(
    await q('   what stays human:', 'accounts, secrets, permissions, final sign-off')
  );
  const record = splitList(
    await q(
      bold('5. What evidence must it leave behind?'),
      'e.g. sources consulted, what was drafted, what was skipped, where it stopped'
    )
  );
  const description = await q(bold('One-line description of this loop:'));
  rl.close();

  return {
    name,
    description: description || `The ${name} loop.`,
    brief: brief ? `- ${brief}` : PLACEHOLDER.brief,
    procedure: procedure ? `1. ${procedure}` : PLACEHOLDER.procedure,
    warrant: { read, draft, change, send, ask, never },
    reserved,
    record,
  };
}

// Rename a template through the frontmatter layer, not blind text
// substitution — and parseLoop's name-vs-filename check backstops it.
function withName(templateText, name) {
  const { frontmatter, body } = splitFrontmatter(templateText);
  const renamed = frontmatter.replace(/^\s*name\s*:.*$/m, `name: ${name}`);
  return `---\n${renamed}\n---\n${body}`;
}

export async function cmdNew(argv) {
  const { flags, positional } = parseArgs(argv, { booleans: ['blank'] });
  const name = positional[0];
  if (!name) {
    console.error('usage: docket new <name> [--template <template>] [--blank]');
    return 1;
  }
  if (!LOOP_NAME_RE.test(name)) {
    console.error('docket: loop names are lowercase letters, digits, and dashes');
    return 1;
  }
  const docketDir = requireDocketDir();
  const dest = loopFile(docketDir, name);
  if (fs.existsSync(dest)) {
    console.error(`docket: loop "${name}" already exists at ${dest}`);
    return 1;
  }

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
  } else if (!flags.blank && process.stdin.isTTY && process.stdout.isTTY) {
    try {
      content = scaffold(await interview(name));
    } catch (err) {
      if (err && (err.code === 'ABORT_ERR' || /abort/i.test(err.message ?? ''))) {
        console.error('\ndocket: interview cancelled — nothing written');
        return 1;
      }
      throw err;
    }
  } else {
    content = scaffold({
      name,
      description: `TODO: one line on what the ${name} loop does.`,
      brief: PLACEHOLDER.brief,
      procedure: PLACEHOLDER.procedure,
      warrant: { read: [], draft: [], change: [], send: [], ask: [], never: [] },
      reserved: ['final approval'],
      record: ['what it saw', 'what it did', 'what it left alone', 'where it stopped'],
    });
  }

  // Validate before writing — a loop that can't be parsed can't protect anyone.
  try {
    parseLoop(content, { file: dest });
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
  console.log(dim(`  edit it, then: docket show ${name} · docket check ${name} send "…" · docket compile --write`));
  return 0;
}
