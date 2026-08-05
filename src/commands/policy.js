// `docket policy push` / `docket policy pull` — loop files as an OCI artifact.
//
// A platform team writes the baseline once and forty repos need it. `extends:`
// solved "one file governs many loops"; this solves "one file reaches many
// repos", using the distribution primitive those teams already run.
//
// PULLING POLICY IS THE DANGEROUS DIRECTION, and the whole design of the pull
// path follows from that. A loop file is not data — it is the thing that
// decides what an agent may do. Fetching one from the network and dropping it
// into `.docket/loops/` is, structurally, exactly the failure docket exists to
// prevent: permissions widening without a human deciding. So:
//
//   - Pull PREVIEWS first and writes only after a human keystroke, the same
//     rule `docket review` follows for the same reason. `--yes` exists for CI,
//     and CI pinning a digest is a human decision made earlier.
//   - Every incoming filename is validated against the loop-name grammar.
//     The name comes from an annotation the publisher controls, and an
//     attacker-controlled path that reaches writeFileSync is a hole.
//   - Every blob's digest is verified before it is written (in lib/oci.js).
//   - Existing files are never silently overwritten; `--force` is required,
//     and the diff is shown either way.
//   - What was pulled goes ON THE RECORD, with the digest. "Where did this
//     rule come from?" is answerable later, from the log, not from memory.
//
// And the thing that is NOT here: `extends:` cannot name a registry. Policy is
// vendored and committed; a warrant check never touches the network. See the
// header of lib/oci.js.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from '../lib/args.js';
import {
  LOOP_EXT,
  LOOP_NAME_RE,
  loopsDir,
  parseLoop,
  requireDocketDir,
} from '../lib/loop.js';
import { appendRecord } from '../lib/record.js';
import {
  ARTIFACT_TYPE,
  CONFIG_MEDIA_TYPE,
  EMPTY_MEDIA_TYPE,
  LOOP_MEDIA_TYPE,
  MANIFEST_MEDIA_TYPE,
  OciError,
  Registry,
  digestOf,
  parseRef,
} from '../lib/oci.js';
import { bold, cyan, dim, green, red, yellow } from '../lib/ui.js';

const TITLE_ANNOTATION = 'org.opencontainers.image.title';

export function usage() {
  console.error(
    'usage: docket policy push <ref> [--loop <name>[,<name>…]]\n' +
      '       docket policy pull <ref> [--yes] [--force] [--dry-run]\n' +
      '       docket policy inspect <ref>\n' +
      '\n' +
      '  <ref> is a full registry reference: ghcr.io/acme/loops:baseline\n' +
      '  Credentials come from DOCKET_REGISTRY_TOKEN, or DOCKET_REGISTRY_USER\n' +
      '  and DOCKET_REGISTRY_PASSWORD. Nothing is read from ~/.docker/config.json.'
  );
  return 1;
}

export async function cmdPolicy(argv) {
  const [sub, ...rest] = argv;
  try {
    switch (sub) {
      case 'push':
        return await policyPush(rest);
      case 'pull':
        return await policyPull(rest);
      case 'inspect':
        return await policyInspect(rest);
      default:
        return usage();
    }
  } catch (err) {
    if (err instanceof OciError) {
      console.error(red('✗ ') + err.message);
      return 1;
    }
    throw err;
  }
}

function openRegistry(ref, flags) {
  const parsed = parseRef(ref);
  return {
    parsed,
    registry: new Registry({
      registry: parsed.registry,
      repository: parsed.repository,
      insecure: Boolean(flags.insecure),
    }),
  };
}

// Which loops go in the artifact. `--loop a,b` selects a subset; without it,
// everything. (parseArgs keeps the last value of a repeated flag, so a comma
// list is the spelling that cannot silently drop one.)
function selectLoops(docketDir, flags) {
  const dir = loopsDir(docketDir);
  if (!fs.existsSync(dir)) return [];
  const wanted =
    typeof flags.loop === 'string'
      ? flags.loop.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(LOOP_EXT))
    .filter((f) => !wanted || wanted.includes(f.slice(0, -LOOP_EXT.length)))
    .sort();
  return files.map((f) => ({
    name: f.slice(0, -LOOP_EXT.length),
    file: f,
    content: fs.readFileSync(path.join(dir, f)),
  }));
}

async function policyPush(argv) {
  const { flags, positional } = parseArgs(argv, { booleans: ['insecure'] });
  const ref = positional[0];
  if (!ref) return usage();
  const docketDir = requireDocketDir();
  const loops = selectLoops(docketDir, flags);
  if (!loops.length) {
    console.error('docket: no loops to push — `docket new` one first, or check --loop');
    return 1;
  }

  // Parse before publishing. Pushing a loop file that does not parse means
  // handing forty repos a policy none of them can load.
  const described = [];
  for (const l of loops) {
    let parsed;
    try {
      parsed = parseLoop(l.content.toString('utf8'), { file: l.file });
    } catch (err) {
      console.error(red('✗ ') + `${l.file} does not parse — refusing to publish it: ${err.message}`);
      return 1;
    }
    described.push({
      name: parsed.name,
      description: parsed.description,
      abstract: parsed.abstract,
      extends: parsed.extends,
    });
  }

  // A loop that extends a baseline outside this artifact will not resolve for
  // whoever pulls it. Warn rather than block: the baseline may legitimately be
  // published separately and pulled alongside.
  const included = new Set(described.map((d) => d.name));
  const dangling = described.filter((d) => d.extends && !included.has(d.extends));
  for (const d of dangling) {
    console.error(
      yellow('! ') +
        `${d.name} extends "${d.extends}", which is not in this artifact — ` +
        'whoever pulls it needs that baseline too, or the loop will not load'
    );
  }

  const { parsed: refParts, registry } = openRegistry(ref, flags);
  if (refParts.isDigest) {
    console.error('docket: push to a tag, not a digest — a digest is what the registry gives back');
    return 1;
  }

  const configBlob = Buffer.from(
    JSON.stringify(
      {
        artifactType: ARTIFACT_TYPE,
        specVersion: 1,
        loops: described.map(({ name, description, abstract }) => ({
          name,
          description,
          ...(abstract ? { abstract: true } : {}),
        })),
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  console.log(`pushing ${loops.length} loop${loops.length === 1 ? '' : 's'} → ${cyan(ref)}`);
  const layers = [];
  for (const l of loops) {
    const digest = await registry.putBlob(l.content);
    layers.push({
      mediaType: LOOP_MEDIA_TYPE,
      digest,
      size: l.content.length,
      annotations: { [TITLE_ANNOTATION]: l.file },
    });
    console.log(`  ${dim(digest.slice(7, 19))}  ${l.file}`);
  }
  const configDigest = await registry.putBlob(configBlob);

  const manifest = {
    schemaVersion: 2,
    mediaType: MANIFEST_MEDIA_TYPE,
    artifactType: ARTIFACT_TYPE,
    config: { mediaType: CONFIG_MEDIA_TYPE, digest: configDigest, size: configBlob.length },
    layers,
    annotations: {
      'org.opencontainers.image.created': new Date().toISOString(),
      'org.opencontainers.image.description': `docket policy — ${loops.length} loop${loops.length === 1 ? '' : 's'}`,
    },
  };
  const { digest } = await registry.putManifest(refParts.reference, manifest);

  console.log(green('✓') + ` pushed ${ref}`);
  console.log(dim(`  digest: ${digest}`));
  console.log(
    dim(`\n  Pin the digest downstream — a tag can move, a digest cannot:`)
  );
  console.log(dim(`  docket policy pull ${refParts.registry}/${refParts.repository}@${digest}`));
  return 0;
}

// The publisher chooses this string. Treat it as hostile.
export function safeLoopFilename(title) {
  if (typeof title !== 'string') return null;
  const base = title.trim();
  if (!base || base !== path.basename(base)) return null; // any path separator, `.`, `..`
  if (!base.endsWith(LOOP_EXT)) return null;
  const name = base.slice(0, -LOOP_EXT.length);
  if (!LOOP_NAME_RE.test(name)) return null;
  return base;
}

async function fetchPolicy(ref, flags) {
  const { parsed, registry } = openRegistry(ref, flags);
  const { manifest, digest } = await registry.getManifest(parsed.reference);

  if (manifest.mediaType === 'application/vnd.oci.image.index.v1+json') {
    throw new OciError(
      `${ref} is an image index, not a docket policy — did you point at a container image?`
    );
  }
  if (manifest.artifactType && manifest.artifactType !== ARTIFACT_TYPE) {
    throw new OciError(
      `${ref} is a "${manifest.artifactType}" artifact, not a docket policy — refusing to install it`
    );
  }

  const items = [];
  for (const layer of manifest.layers ?? []) {
    if (layer.mediaType !== LOOP_MEDIA_TYPE) {
      throw new OciError(
        `${ref} contains a "${layer.mediaType}" layer — a docket policy holds only loop files`
      );
    }
    const title = layer.annotations?.[TITLE_ANNOTATION];
    const file = safeLoopFilename(title);
    if (!file) {
      throw new OciError(
        `${ref} names a layer "${title}" — that is not a valid loop filename, and docket will ` +
          'not write a path a publisher chose freely'
      );
    }
    const content = await registry.getBlob(layer.digest);
    // Parse it here, before anyone is asked to approve it: a preview of a file
    // that cannot load is not a preview worth approving.
    let parsedLoop;
    try {
      parsedLoop = parseLoop(content.toString('utf8'), { file });
    } catch (err) {
      throw new OciError(`${file} in ${ref} does not parse — refusing to install it: ${err.message}`);
    }
    items.push({ file, content, digest: layer.digest, loop: parsedLoop });
  }
  if (!items.length) throw new OciError(`${ref} contains no loop files`);
  return { items, digest, manifest };
}

function summarize(loop) {
  const w = loop.warrant;
  const counts = [
    ['never', w.never.length],
    ['ask', w.ask.length],
    ['read', w.read.length],
    ['draft', w.draft.length],
    ['change', w.change.length],
    ['send', w.send.length],
  ]
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
  return counts || 'no warrant entries';
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function policyPull(argv) {
  const { flags, positional } = parseArgs(argv, {
    booleans: ['yes', 'force', 'dry-run', 'insecure'],
  });
  const ref = positional[0];
  if (!ref) return usage();
  const docketDir = requireDocketDir();
  const dir = loopsDir(docketDir);
  fs.mkdirSync(dir, { recursive: true });

  const { items, digest } = await fetchPolicy(ref, flags);

  // Show what would change before asking. An approval given without the diff
  // is not an approval, it is a habit.
  console.log(`${bold(ref)}`);
  console.log(dim(`  digest ${digest}`));
  console.log('');
  const conflicts = [];
  for (const item of items) {
    const target = path.join(dir, item.file);
    const exists = fs.existsSync(target);
    const same = exists && digestOf(fs.readFileSync(target)) === item.digest;
    item.state = !exists ? 'new' : same ? 'unchanged' : 'differs';
    if (item.state === 'differs') conflicts.push(item);
    const mark =
      item.state === 'new' ? green('+ new     ') : item.state === 'unchanged' ? dim('  same    ') : yellow('~ replaces');
    const flags2 = [item.loop.abstract ? 'abstract' : null, item.loop.extends ? `extends ${item.loop.extends}` : null]
      .filter(Boolean)
      .join(', ');
    console.log(`  ${mark} ${cyan(item.file)}${flags2 ? dim(` (${flags2})`) : ''}`);
    console.log(`             ${dim(summarize(item.loop))}`);
  }
  console.log('');

  const changing = items.filter((i) => i.state !== 'unchanged');
  if (!changing.length) {
    console.log(green('✓') + ' already up to date — nothing to write');
    return 0;
  }
  // Dry run answers before the conflict check refuses. "What would this do?"
  // is exactly the question someone asks when they already suspect a
  // conflict, and erroring instead of answering makes the flag useless
  // precisely when it is most wanted.
  if (flags['dry-run']) {
    if (conflicts.length && !flags.force) {
      console.log(
        yellow('! ') +
          `${conflicts.length} of these already exist and differ — the real run would need --force`
      );
    }
    console.log(dim('dry run — nothing written'));
    return 0;
  }
  if (conflicts.length && !flags.force) {
    console.error(
      red('✗ ') +
        `${conflicts.length} loop file${conflicts.length === 1 ? '' : 's'} already exist and differ: ` +
        conflicts.map((c) => c.file).join(', ')
    );
    console.error(
      dim('  Pass --force to replace them. Review the diff first — these files decide what your agents may do.')
    );
    return 1;
  }

  // The keystroke. A loop file grants and withholds authority; installing one
  // from a registry is a decision, not a download.
  if (!flags.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        red('✗ ') + 'refusing to install policy without confirmation on a non-interactive stdin.'
      );
      console.error(dim('  Pass --yes, and pin a digest rather than a tag when you do.'));
      return 1;
    }
    const ok = await confirm(
      `install ${changing.length} loop file${changing.length === 1 ? '' : 's'} into ${dir}? [y/N] `
    );
    if (!ok) {
      console.log('nothing written');
      return 0;
    }
  }

  for (const item of changing) {
    fs.writeFileSync(path.join(dir, item.file), item.content);
    console.log(green('✓') + ` ${item.file}`);
  }

  // On the record, with the digest — so "where did this rule come from?" is a
  // question the log answers.
  appendRecord(
    docketDir,
    {
      loop: changing[0].loop.name,
      kind: 'policy',
      via: 'cli',
      source: ref,
      digest,
      installed: changing.map((i) => i.file).join(', '),
    },
    { by: flags.by }
  );

  console.log(
    dim(`\n  Commit these files. Policy is vendored, not fetched at check time —`)
  );
  console.log(dim('  a warrant check never depends on a registry being reachable.'));
  return 0;
}

async function policyInspect(argv) {
  const { flags, positional } = parseArgs(argv, { booleans: ['insecure', 'json'] });
  const ref = positional[0];
  if (!ref) return usage();
  const { items, digest, manifest } = await fetchPolicy(ref, flags);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          ref,
          digest,
          created: manifest.annotations?.['org.opencontainers.image.created'] ?? null,
          loops: items.map((i) => ({
            file: i.file,
            digest: i.digest,
            name: i.loop.name,
            description: i.loop.description,
            abstract: i.loop.abstract,
            extends: i.loop.extends,
          })),
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(bold(ref));
  console.log(dim(`  digest  ${digest}`));
  const created = manifest.annotations?.['org.opencontainers.image.created'];
  if (created) console.log(dim(`  created ${created}`));
  console.log('');
  for (const item of items) {
    console.log(`  ${cyan(item.loop.name)}${item.loop.abstract ? dim(' (abstract baseline)') : ''}`);
    if (item.loop.description) console.log(`    ${item.loop.description}`);
    if (item.loop.extends) console.log(dim(`    extends ${item.loop.extends}`));
    console.log(dim(`    ${summarize(item.loop)}`));
    for (const n of item.loop.warrant.never) console.log(dim(`      never: ${n}`));
  }
  return 0;
}
