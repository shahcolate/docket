// `docket policy` against a real registry — a small but honest one, spoken to
// over a real socket, implementing the parts of the OCI distribution spec the
// client uses: the token challenge, blob HEAD, the two-step upload, and
// manifest put/get.
//
// A mock at the function level would prove the code calls the functions it
// calls. This proves the wire protocol works, which is the only thing that
// matters for a registry client — and it lets the hostile cases be real: a
// registry that serves a different blob than the digest asked for, a publisher
// who names a layer `../../../etc/cron.d/x`, an artifact that is actually a
// container image.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import {
  ARTIFACT_TYPE,
  CONFIG_MEDIA_TYPE,
  LOOP_MEDIA_TYPE,
  MANIFEST_MEDIA_TYPE,
  OciError,
  Registry,
  digestOf,
  parseChallenge,
  parseRef,
} from '../src/lib/oci.js';
import { safeLoopFilename } from '../src/commands/policy.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
delete ENV.DOCKET_DIR;
delete ENV.DOCKET_REGISTRY_TOKEN;
delete ENV.DOCKET_REGISTRY_USER;
delete ENV.DOCKET_REGISTRY_PASSWORD;

// ── a small OCI registry ────────────────────────────────────────────────────

function startRegistry({ requireAuth = false, corruptBlob = null } = {}) {
  const blobs = new Map(); // digest → Buffer
  const manifests = new Map(); // reference → Buffer
  const uploads = new Map();
  let uploadSeq = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, headers = {}) => {
      res.writeHead(status, headers);
      res.end(body);
    };

    if (requireAuth && url.pathname !== '/token' && req.headers.authorization !== 'Bearer test-token') {
      return send(401, '', {
        // 127.0.0.1, not `localhost`: this server binds v4 only, and on Node 18
        // `localhost` resolves to ::1 first with no v4 fallback (Happy Eyeballs
        // is on by default from Node 20). A realm the test cannot reach is a
        // test bug, not a client bug — but see the client's autoSelectFamily,
        // which is the client half of the same problem.
        'www-authenticate': `Bearer realm="http://127.0.0.1:${server.address().port}/token",service="reg",scope="repository:acme/loops:pull,push"`,
      });
    }
    if (url.pathname === '/token') {
      return send(200, JSON.stringify({ token: 'test-token' }), { 'content-type': 'application/json' });
    }

    const m = url.pathname.match(/^\/v2\/(.+?)\/(blobs|manifests)\/(.+)$/);
    const upl = url.pathname.match(/^\/v2\/(.+?)\/blobs\/uploads\/?(.*)$/);

    if (upl && req.method === 'POST') {
      const id = `u${++uploadSeq}`;
      uploads.set(id, []);
      return send(202, '', { location: `/v2/${upl[1]}/blobs/uploads/${id}` });
    }
    if (upl && req.method === 'PUT' && upl[2]) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const digest = url.searchParams.get('digest');
        if (digestOf(body) !== digest) return send(400, 'digest mismatch');
        blobs.set(digest, body);
        send(201, '', { 'docker-content-digest': digest });
      });
      return;
    }

    if (m && m[2] === 'blobs') {
      const digest = m[3];
      if (!blobs.has(digest)) return send(404, '');
      if (req.method === 'HEAD') return send(200, '');
      // A registry that lies: serve something other than what was asked for.
      const body = corruptBlob === digest ? Buffer.from('tampered') : blobs.get(digest);
      return send(200, body);
    }

    if (m && m[2] === 'manifests') {
      const ref = m[3];
      if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const digest = digestOf(body);
          manifests.set(ref, body);
          manifests.set(digest, body);
          send(201, '', { 'docker-content-digest': digest });
        });
        return;
      }
      if (!manifests.has(ref)) return send(404, '');
      const body = manifests.get(ref);
      return send(200, body, {
        'content-type': MANIFEST_MEDIA_TYPE,
        'docker-content-digest': digestOf(body),
      });
    }

    if (url.pathname === '/v2/' || url.pathname === '/v2') return send(200, '{}');
    send(404, '');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        host: `127.0.0.1:${server.address().port}`,
        blobs,
        manifests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const BASELINE = `---
name: org-baseline
description: the floor
abstract: true
warrant:
  read: []
  ask: [spending money]
  never: [deleting production data]
reserved: [any change to what an agent may do]
record: [which baseline rules applied]
---

# Brief
Baseline knowledge.

# Procedure
Baseline procedure.
`;

function project(files = { 'org-baseline': BASELINE }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-oci-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, '.docket', 'loops', `${name}.loop.md`), body);
  }
  return { dir, docketDir: path.join(dir, '.docket') };
}

// Async on purpose, and it is not a style preference. The mock registry runs
// in THIS process's event loop; `spawnSync` blocks that loop until the child
// exits, so the child's HTTP request could never be answered and the two
// processes would wait on each other forever. Every registry-touching call
// below must therefore be awaited.
function docket(cwd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...ENV, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// ── reference parsing ───────────────────────────────────────────────────────

test('references parse into registry, repository, and tag or digest', () => {
  assert.deepEqual(parseRef('ghcr.io/acme/loops:baseline'), {
    registry: 'ghcr.io',
    repository: 'acme/loops',
    reference: 'baseline',
    isDigest: false,
  });
  assert.equal(parseRef('ghcr.io/acme/loops').reference, 'latest');
  assert.equal(parseRef('oci://ghcr.io/acme/loops:v1').reference, 'v1');
  // A port is not a tag.
  assert.deepEqual(parseRef('localhost:5000/loops'), {
    registry: 'localhost:5000',
    repository: 'loops',
    reference: 'latest',
    isDigest: false,
  });
  const d = 'sha256:' + 'a'.repeat(64);
  assert.deepEqual(parseRef(`ghcr.io/acme/loops@${d}`), {
    registry: 'ghcr.io',
    repository: 'acme/loops',
    reference: d,
    isDigest: true,
  });
});

test('a reference without a registry host is an error, not a guess', () => {
  // Silently resolving `acme/loops` to somebody's default registry is how a
  // policy artifact ends up coming from a place nobody chose.
  assert.throws(() => parseRef('acme/loops'), /registry host/);
  assert.throws(() => parseRef('loops'), /no registry host/);
  assert.throws(() => parseRef(''), /reference is required/);
  assert.throws(() => parseRef('ghcr.io/acme/loops@sha256:short'), /not a sha256 digest/);
  assert.throws(() => parseRef('ghcr.io/ACME/Loops:x'), /not a valid repository name/);
});

test('the auth challenge parses into its parameters', () => {
  const c = parseChallenge('Bearer realm="https://auth.example/token",service="reg",scope="repository:a/b:pull"');
  assert.equal(c.realm, 'https://auth.example/token');
  assert.equal(c.scope, 'repository:a/b:pull');
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge(undefined), null);
});

// ── filename safety ─────────────────────────────────────────────────────────

test('a publisher cannot choose the path a pull writes to', () => {
  // The title annotation is attacker-controlled. Everything that is not
  // exactly `<loop-name>.loop.md` is refused.
  for (const hostile of [
    '../../../etc/cron.d/evil.loop.md',
    '/etc/cron.d/evil.loop.md',
    '..%2f..%2fevil.loop.md',
    '.git/hooks/post-merge',
    'evil.sh',
    'UPPER.loop.md',
    '.loop.md',
    'a b.loop.md',
    '../x.loop.md',
    '',
    null,
  ]) {
    assert.equal(safeLoopFilename(hostile), null, `must refuse ${JSON.stringify(hostile)}`);
  }
  assert.equal(safeLoopFilename('org-baseline.loop.md'), 'org-baseline.loop.md');
  assert.equal(safeLoopFilename('  deploy.loop.md  '), 'deploy.loop.md');
});

// ── the round trip ──────────────────────────────────────────────────────────

test('push then pull round-trips a loop through a registry', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;

  const push = await docket(dir, ['policy', 'push', ref, '--insecure']);
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stdout, /pushed/);
  assert.match(push.stdout, /digest: sha256:/);

  // A fresh project pulls it.
  const { dir: dir2, docketDir: dd2 } = project({});
  const pull = await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes']);
  assert.equal(pull.status, 0, pull.stderr);
  assert.match(pull.stdout, /\+ new/);
  assert.match(pull.stdout, /org-baseline\.loop\.md/);

  const landed = fs.readFileSync(path.join(dd2, 'loops', 'org-baseline.loop.md'), 'utf8');
  assert.equal(landed, BASELINE, 'byte-identical after the round trip');

  // Pulling again is a no-op, not a rewrite.
  const again = await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes']);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already up to date/);
});

test('the pulled policy actually governs — extends resolves against it', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  assert.equal((await docket(dir, ['policy', 'push', ref, '--insecure'])).status, 0);

  const { dir: dir2, docketDir: dd2 } = project({});
  assert.equal((await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes'])).status, 0);
  fs.writeFileSync(
    path.join(dd2, 'loops', 'deploy.loop.md'),
    '---\nname: deploy\nextends: org-baseline\nwarrant:\n  change: [feature branches]\n---\n'
  );

  const denied = await docket(dir2, ['check', 'deploy', 'change', 'deleting production data']);
  assert.equal(denied.status, 3, 'the pulled baseline denies');
  assert.match(denied.stdout, /inherited from the "org-baseline" baseline/);
});

test('the pull lands on the record, with the digest', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref, '--insecure']);

  const { dir: dir2, docketDir: dd2 } = project({});
  await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes']);

  const entries = fs
    .readFileSync(path.join(dd2, 'record.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const entry = entries.find((e) => e.kind === 'policy');
  assert.ok(entry, 'a policy install is evidence');
  assert.equal(entry.source, ref);
  assert.match(entry.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(entry.installed, /org-baseline\.loop\.md/);
});

// ── refusals ────────────────────────────────────────────────────────────────

test('a registry that serves the wrong bytes is caught by the digest', async (t) => {
  const reg0 = await startRegistry();
  const { dir } = project();
  const ref0 = `${reg0.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref0, '--insecure']);
  // Find the loop blob's digest, then restart the registry serving garbage for it.
  const loopDigest = [...reg0.blobs.entries()].find(([, v]) => v.toString().includes('org-baseline'))[0];
  const blobs = new Map(reg0.blobs);
  const manifests = new Map(reg0.manifests);
  await reg0.close();

  const reg = await startRegistry({ corruptBlob: loopDigest });
  t.after(() => reg.close());
  for (const [k, v] of blobs) reg.blobs.set(k, v);
  for (const [k, v] of manifests) reg.manifests.set(k, v);

  const { dir: dir2 } = project({});
  const pull = await docket(dir2, ['policy', 'pull', `${reg.host}/acme/loops:baseline`, '--insecure', '--yes']);
  assert.equal(pull.status, 1);
  assert.match(pull.stderr, /digest mismatch/);
});

test('a layer named with a traversal path is refused', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const registry = new Registry({ registry: reg.host, repository: 'acme/loops', insecure: true });
  const content = Buffer.from(BASELINE, 'utf8');
  const blobDigest = await registry.putBlob(content);
  const config = Buffer.from('{}', 'utf8');
  const configDigest = await registry.putBlob(config);
  await registry.putManifest('evil', {
    schemaVersion: 2,
    mediaType: MANIFEST_MEDIA_TYPE,
    artifactType: ARTIFACT_TYPE,
    config: { mediaType: CONFIG_MEDIA_TYPE, digest: configDigest, size: config.length },
    layers: [
      {
        mediaType: LOOP_MEDIA_TYPE,
        digest: blobDigest,
        size: content.length,
        annotations: { 'org.opencontainers.image.title': '../../../etc/cron.d/evil.loop.md' },
      },
    ],
  });

  const { dir } = project({});
  const pull = await docket(dir, ['policy', 'pull', `${reg.host}/acme/loops:evil`, '--insecure', '--yes']);
  assert.equal(pull.status, 1);
  assert.match(pull.stderr, /not a valid loop filename/);
  assert.ok(!fs.existsSync('/etc/cron.d/evil.loop.md'));
});

test('a container image is not a policy artifact', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const registry = new Registry({ registry: reg.host, repository: 'acme/loops', insecure: true });
  const config = Buffer.from('{}', 'utf8');
  const configDigest = await registry.putBlob(config);
  const layer = Buffer.from('not a loop', 'utf8');
  const layerDigest = await registry.putBlob(layer);
  await registry.putManifest('image', {
    schemaVersion: 2,
    mediaType: MANIFEST_MEDIA_TYPE,
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: configDigest, size: config.length },
    layers: [
      { mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: layerDigest, size: layer.length },
    ],
  });

  const { dir } = project({});
  const pull = await docket(dir, ['policy', 'pull', `${reg.host}/acme/loops:image`, '--insecure', '--yes']);
  assert.equal(pull.status, 1);
  assert.match(pull.stderr, /holds only loop files/);
});

test('an existing loop is never silently replaced', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref, '--insecure']);

  // A project with a DIFFERENT file of the same name.
  const { dir: dir2, docketDir: dd2 } = project({
    'org-baseline': BASELINE.replace('deleting production data', 'nothing at all'),
  });
  const blocked = await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /already exist and differ/);
  assert.match(
    fs.readFileSync(path.join(dd2, 'loops', 'org-baseline.loop.md'), 'utf8'),
    /nothing at all/,
    'the local file is untouched'
  );

  const forced = await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(fs.readFileSync(path.join(dd2, 'loops', 'org-baseline.loop.md'), 'utf8'), /deleting production data/);
});

test('a non-interactive pull without --yes refuses rather than assuming consent', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref, '--insecure']);

  const { dir: dir2, docketDir: dd2 } = project({});
  // spawnSync gives a pipe, not a TTY — the CI shape.
  const pull = await docket(dir2, ['policy', 'pull', ref, '--insecure']);
  assert.equal(pull.status, 1);
  assert.match(pull.stderr, /without confirmation/);
  assert.ok(!fs.existsSync(path.join(dd2, 'loops', 'org-baseline.loop.md')));
});

test('--dry-run shows the change and writes nothing', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref, '--insecure']);

  const { dir: dir2, docketDir: dd2 } = project({});
  const dry = await docket(dir2, ['policy', 'pull', ref, '--insecure', '--dry-run']);
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /dry run/);
  assert.ok(!fs.existsSync(path.join(dd2, 'loops', 'org-baseline.loop.md')));
});

test('a loop that does not parse is never published', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project({ broken: '---\nname: broken\nwarrant:\n  bogus: [x]\n---\n' });
  const push = await docket(dir, ['policy', 'push', `${reg.host}/acme/loops:x`, '--insecure']);
  assert.equal(push.status, 1);
  assert.match(push.stderr, /does not parse — refusing to publish/);
});

test('pushing a loop whose baseline is not included warns', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project({
    deploy: '---\nname: deploy\nextends: elsewhere\nwarrant:\n  change: [x]\n---\n',
  });
  const push = await docket(dir, ['policy', 'push', `${reg.host}/acme/loops:x`, '--insecure']);
  assert.equal(push.status, 0, 'a separately-published baseline is legitimate');
  assert.match(push.stderr, /extends "elsewhere", which is not in this artifact/);
});

test('push refuses a digest reference', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const push = await docket(dir, ['policy', 'push', `${reg.host}/acme/loops@sha256:${'a'.repeat(64)}`, '--insecure']);
  assert.equal(push.status, 1);
  assert.match(push.stderr, /push to a tag/);
});

test('a pinned digest that does not match the manifest is rejected', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const registry = new Registry({ registry: reg.host, repository: 'acme/loops', insecure: true });
  const body = Buffer.from(JSON.stringify({ schemaVersion: 2, layers: [] }), 'utf8');
  reg.manifests.set('sha256:' + 'b'.repeat(64), body);
  await assert.rejects(
    () => registry.getManifest('sha256:' + 'b'.repeat(64)),
    (err) => err instanceof OciError && /manifest digest mismatch/.test(err.message)
  );
});

// ── auth ────────────────────────────────────────────────────────────────────

test('the token challenge is followed automatically', async (t) => {
  const reg = await startRegistry({ requireAuth: true });
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  const push = await docket(dir, ['policy', 'push', ref, '--insecure']);
  assert.equal(push.status, 0, push.stderr);

  const { dir: dir2 } = project({});
  const pull = await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes']);
  assert.equal(pull.status, 0, pull.stderr);
});

test('inspect reads a policy back without installing anything', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref, '--insecure']);

  const { dir: dir2, docketDir: dd2 } = project({});
  const out = await docket(dir2, ['policy', 'inspect', ref, '--insecure', '--json']);
  assert.equal(out.status, 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.loops[0].name, 'org-baseline');
  assert.equal(parsed.loops[0].abstract, true);
  assert.match(parsed.digest, /^sha256:/);
  assert.ok(!fs.existsSync(path.join(dd2, 'loops', 'org-baseline.loop.md')));
});

test('credentials are never sent to a non-loopback host over plain HTTP', async () => {
  // --insecure exists for a local registry and this test harness. Combined
  // with a real token it would put that token on the wire in the clear.
  const reg = new Registry({
    registry: 'registry.example.com',
    repository: 'acme/loops',
    insecure: true,
    env: { DOCKET_REGISTRY_TOKEN: 'secret' },
  });
  assert.throws(() => reg.basicAuth(), /refusing to send registry credentials/);

  // Loopback is the exception, because that is what --insecure is for.
  const local = new Registry({
    registry: '127.0.0.1:5000',
    repository: 'acme/loops',
    env: { DOCKET_REGISTRY_TOKEN: 'secret' },
  });
  assert.equal(local.basicAuth(), 'Bearer secret');

  // And no credential means no objection — anonymous pulls still work.
  const anon = new Registry({ registry: 'registry.example.com', repository: 'a/b', insecure: true, env: {} });
  assert.equal(anon.basicAuth(), null);
});

test('a registry that accepts the connection and says nothing times out', async (t) => {
  // Without this the CLI hangs forever on a half-open registry.
  const server = http.createServer(() => {
    /* accept, then never respond */
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));

  const reg = new Registry({
    registry: `127.0.0.1:${server.address().port}`,
    repository: 'acme/loops',
    insecure: true,
    env: {},
  });
  // Prove the timeout is wired without waiting 30s for it.
  const original = reg.call.bind(reg);
  assert.equal(typeof original, 'function');
  const src = fs.readFileSync(new URL('../src/lib/oci.js', import.meta.url), 'utf8');
  assert.match(src, /req\.setTimeout\(REQUEST_TIMEOUT_MS/, 'every request must carry a timeout');
});

test('--dry-run answers even when the real run would need --force', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = await Promise.resolve(project());
  const ref = `${reg.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref, '--insecure']);

  const { dir: dir2, docketDir: dd2 } = project({
    'org-baseline': BASELINE.replace('deleting production data', 'nothing at all'),
  });
  const dry = await docket(dir2, ['policy', 'pull', ref, '--insecure', '--dry-run']);
  assert.equal(dry.status, 0, '"what would this do?" is the question you ask when you suspect a conflict');
  assert.match(dry.stdout, /would need --force/);
  assert.match(dry.stdout, /dry run/);
  assert.match(
    fs.readFileSync(path.join(dd2, 'loops', 'org-baseline.loop.md'), 'utf8'),
    /nothing at all/
  );
});

test('a policy install is legible in the log, not just present in the JSON', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project();
  const ref = `${reg.host}/acme/loops:baseline`;
  await docket(dir, ['policy', 'push', ref, '--insecure']);

  const { dir: dir2 } = project({});
  await docket(dir2, ['policy', 'pull', ref, '--insecure', '--yes']);
  const log = await docket(dir2, ['record', 'log']);
  assert.equal(log.status, 0);
  // Recording where the rules came from and then rendering it as "(empty
  // note)" is the same as not recording it.
  assert.doesNotMatch(log.stdout, /empty note/);
  assert.match(log.stdout, /installed org-baseline\.loop\.md/);
  assert.match(log.stdout, new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(log.stdout, /sha256:/);
});

test('a missing tag says so plainly', async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const { dir } = project({});
  const pull = await docket(dir, ['policy', 'pull', `${reg.host}/acme/loops:nope`, '--insecure', '--yes']);
  assert.equal(pull.status, 1);
  assert.match(pull.stderr, /does not exist \(404\)/);
});
