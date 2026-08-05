// A zero-dependency OCI distribution client — just enough of the spec to push
// and pull a set of loop files as an artifact.
//
// Why a registry at all, when a baseline could be a git submodule? Because the
// people who need to distribute policy across forty repos already run one, and
// it already has the things policy distribution needs and git submodules do
// not: immutable digests, tags that move deliberately, access control per
// namespace, replication, and a retention policy someone else operates. The
// Docker MCP Catalog distributes its server list this way for the same reason.
//
// WHAT IS DELIBERATELY NOT HERE, and it is the important design decision:
// `extends:` does NOT accept a registry reference. A warrant check must never
// depend on the network. If it did, the interesting question stops being "what
// is this agent allowed to do" and becomes "what happens to the gate when the
// registry is down, or slow, or serving a tag that moved under us" — and every
// honest answer to that is worse than the problem it solves. So policy is
// pulled EXPLICITLY, by a human, VENDORED into the repo, and COMMITTED. The
// warrant is always evaluated from local files that a reviewer can read in a
// diff. `docket policy pull` is a supply chain step, not a runtime dependency.
//
// Implements: the token auth challenge, blob existence checks, the two-step
// blob upload, and manifest put/get. Not implemented: chunked uploads, cross-
// repository mounts, foreign layers, referrers. Small enough to audit.

import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

// One layer per loop file, so each is individually addressable, greppable in a
// registry UI, and pullable by `oras` without knowing anything about docket.
export const LOOP_MEDIA_TYPE = 'application/vnd.docket.loop.v1+markdown';
export const CONFIG_MEDIA_TYPE = 'application/vnd.docket.policy.v1+json';
export const ARTIFACT_TYPE = 'application/vnd.docket.policy.v1+json';
export const MANIFEST_MEDIA_TYPE = 'application/vnd.oci.image.manifest.v1+json';
export const EMPTY_MEDIA_TYPE = 'application/vnd.oci.empty.v1+json';

const MAX_BLOB_BYTES = 4 * 1024 * 1024; // a loop file is a page of Markdown
const MAX_REDIRECTS = 5;
// A registry that accepts the connection and then says nothing would otherwise
// hang the CLI forever. There is no good reason to wait longer than this for a
// few kilobytes of Markdown.
const REQUEST_TIMEOUT_MS = 30_000;

export class OciError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.status = status;
  }
}

export function digestOf(buffer) {
  return 'sha256:' + crypto.createHash('sha256').update(buffer).digest('hex');
}

// `ghcr.io/acme/loops:baseline` → { registry, repository, reference, isDigest }
//
// Docker Hub's implicit `library/` and implicit `docker.io` are deliberately
// NOT supported: a policy artifact's address should be unambiguous on its
// face, because the whole point is that a reviewer can tell where a rule came
// from. Bare `acme/loops` is an error that says so, rather than a silent
// resolution to somebody's default registry.
export function parseRef(ref) {
  const raw = String(ref ?? '').trim().replace(/^oci:\/\//, '');
  if (!raw) throw new OciError('a policy reference is required, e.g. ghcr.io/acme/loops:baseline');

  const slash = raw.indexOf('/');
  if (slash === -1) {
    throw new OciError(
      `"${ref}" has no registry host — write it out in full, e.g. ghcr.io/acme/loops:baseline`
    );
  }
  const registry = raw.slice(0, slash);
  if (!registry.includes('.') && !registry.includes(':') && registry !== 'localhost') {
    throw new OciError(
      `"${registry}" does not look like a registry host — write the reference in full, ` +
        'e.g. ghcr.io/acme/loops:baseline (docket does not assume a default registry)'
    );
  }
  let rest = raw.slice(slash + 1);

  let reference = 'latest';
  let isDigest = false;
  const at = rest.indexOf('@');
  if (at !== -1) {
    reference = rest.slice(at + 1);
    rest = rest.slice(0, at);
    isDigest = true;
    if (!/^sha256:[0-9a-f]{64}$/.test(reference)) {
      throw new OciError(`"${reference}" is not a sha256 digest`);
    }
  } else {
    // Only the LAST colon can be a tag separator, and only after the last
    // slash — `localhost:5000/loops` is a port, not a tag.
    const colon = rest.lastIndexOf(':');
    if (colon > rest.lastIndexOf('/')) {
      reference = rest.slice(colon + 1);
      rest = rest.slice(0, colon);
    }
  }
  if (!rest) throw new OciError(`"${ref}" has no repository path`);
  if (!/^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/.test(rest)) {
    throw new OciError(`"${rest}" is not a valid repository name (lowercase, dots, dashes, slashes)`);
  }
  if (!isDigest && !/^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/.test(reference)) {
    throw new OciError(`"${reference}" is not a valid tag`);
  }
  return { registry, repository: rest, reference, isDigest };
}

function request(url, { method = 'GET', headers = {}, body, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const req = transport.request(
      target,
      { method, headers },
      (res) => {
        const chunks = [];
        let length = 0;
        res.on('data', (c) => {
          length += c.length;
          if (length > MAX_BLOB_BYTES) {
            req.destroy();
            reject(new OciError(`response exceeded ${MAX_BLOB_BYTES} bytes — refusing to buffer it`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const location = res.headers.location;
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && location) {
            if (redirects >= MAX_REDIRECTS) {
              reject(new OciError('too many redirects'));
              return;
            }
            // Registries redirect blob GETs to object storage that rejects an
            // Authorization header meant for the registry. Drop it on a
            // cross-host hop — and never send our token somewhere new.
            const next = new URL(location, url);
            const forwarded = { ...headers };
            if (next.host !== target.host) delete forwarded.Authorization;
            resolve(
              request(next.toString(), {
                method: res.statusCode === 303 ? 'GET' : method,
                headers: forwarded,
                body: res.statusCode === 303 ? undefined : body,
                redirects: redirects + 1,
              })
            );
            return;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new OciError(`${method} ${target.host} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    });
    if (body) req.write(body);
    req.end();
  });
}

// Parse `Bearer realm="https://…",service="…",scope="…"` into its parameters.
export function parseChallenge(header) {
  if (typeof header !== 'string' || !/^bearer\s/i.test(header)) return null;
  const params = {};
  for (const m of header.slice(7).matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) {
    params[m[1]] = m[2];
  }
  return params.realm ? params : null;
}

// A registry client scoped to one repository.
//
// Credentials come from the environment, never from a file docket writes:
// DOCKET_REGISTRY_TOKEN for a bearer/PAT, or DOCKET_REGISTRY_USER +
// DOCKET_REGISTRY_PASSWORD for basic. Reading ~/.docker/config.json would be
// convenient and is deliberately not done — a tool that silently picks up
// whatever credentials happen to be lying around is a tool that pushes your
// policy to the wrong registry one day.
export class Registry {
  constructor({ registry, repository, insecure = false, env = process.env } = {}) {
    this.registry = registry;
    this.repository = repository;
    this.scheme = insecure || registry.startsWith('localhost') || /^127\./.test(registry) ? 'http' : 'https';
    this.env = env;
    this.token = null;
  }

  base() {
    return `${this.scheme}://${this.registry}/v2/${this.repository}`;
  }

  // Loopback is the only place a plaintext connection may carry a credential.
  // `--insecure` exists for a local registry and a test harness; combined with
  // a real token it would put that token on the wire in the clear, which is a
  // thing a tool should refuse to do rather than warn about.
  isLoopback() {
    const host = this.registry.split(':')[0];
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  basicAuth() {
    const { DOCKET_REGISTRY_TOKEN, DOCKET_REGISTRY_USER, DOCKET_REGISTRY_PASSWORD } = this.env;
    const hasCredential = Boolean(
      DOCKET_REGISTRY_TOKEN || (DOCKET_REGISTRY_USER && DOCKET_REGISTRY_PASSWORD)
    );
    if (hasCredential && this.scheme === 'http' && !this.isLoopback()) {
      throw new OciError(
        `refusing to send registry credentials to ${this.registry} over plain HTTP — ` +
          'drop --insecure, or unset DOCKET_REGISTRY_TOKEN / DOCKET_REGISTRY_USER'
      );
    }
    if (DOCKET_REGISTRY_TOKEN) return `Bearer ${DOCKET_REGISTRY_TOKEN}`;
    if (DOCKET_REGISTRY_USER && DOCKET_REGISTRY_PASSWORD) {
      const pair = Buffer.from(`${DOCKET_REGISTRY_USER}:${DOCKET_REGISTRY_PASSWORD}`).toString('base64');
      return `Basic ${pair}`;
    }
    return null;
  }

  // Exchange the challenge for a token. Anonymous pulls work when the registry
  // hands out a token without credentials, which is how public repositories on
  // ghcr.io and Docker Hub behave.
  async authenticate(challenge) {
    const url = new URL(challenge.realm);
    if (challenge.service) url.searchParams.set('service', challenge.service);
    if (challenge.scope) url.searchParams.set('scope', challenge.scope);
    const headers = {};
    const basic = this.basicAuth();
    // A bearer token from the env is the final credential, not something to
    // trade for another one.
    if (basic && basic.startsWith('Basic ')) headers.Authorization = basic;
    const res = await request(url.toString(), { headers });
    if (res.status !== 200) {
      throw new OciError(
        `the registry refused to issue a token (${res.status}) — check DOCKET_REGISTRY_USER / ` +
          'DOCKET_REGISTRY_PASSWORD, or DOCKET_REGISTRY_TOKEN',
        { status: res.status }
      );
    }
    const payload = JSON.parse(res.body.toString('utf8'));
    this.token = payload.token || payload.access_token || null;
    if (!this.token) throw new OciError('the registry issued an empty token');
  }

  async call(url, opts = {}, { retried = false } = {}) {
    const headers = { ...(opts.headers ?? {}) };
    const explicit = this.basicAuth();
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    else if (explicit) headers.Authorization = explicit;

    const res = await request(url, { ...opts, headers });
    if (res.status === 401 && !retried) {
      const challenge = parseChallenge(res.headers['www-authenticate']);
      if (challenge) {
        await this.authenticate(challenge);
        return this.call(url, opts, { retried: true });
      }
    }
    return res;
  }

  async blobExists(digest) {
    const res = await this.call(`${this.base()}/blobs/${digest}`, { method: 'HEAD' });
    return res.status === 200;
  }

  async putBlob(buffer) {
    const digest = digestOf(buffer);
    if (await this.blobExists(digest)) return digest;

    const start = await this.call(`${this.base()}/blobs/uploads/`, { method: 'POST' });
    if (start.status !== 202) {
      throw new OciError(
        `could not start a blob upload (${start.status}) — you may not have push access to ` +
          `${this.registry}/${this.repository}`,
        { status: start.status }
      );
    }
    const location = start.headers.location;
    if (!location) throw new OciError('the registry accepted the upload but gave no Location');
    const upload = new URL(location, `${this.scheme}://${this.registry}`);
    upload.searchParams.set('digest', digest);

    const done = await this.call(upload.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buffer.length) },
      body: buffer,
    });
    if (done.status !== 201) {
      throw new OciError(`the registry rejected the blob (${done.status})`, { status: done.status });
    }
    return digest;
  }

  async getBlob(digest) {
    const res = await this.call(`${this.base()}/blobs/${digest}`, { method: 'GET' });
    if (res.status !== 200) {
      throw new OciError(`could not fetch blob ${digest.slice(0, 19)}… (${res.status})`, { status: res.status });
    }
    // Verify before the bytes go anywhere. A registry is infrastructure like
    // any other: the digest is the thing that makes it trustworthy, so
    // checking it is not optional politeness.
    const actual = digestOf(res.body);
    if (actual !== digest) {
      throw new OciError(
        `content digest mismatch: asked for ${digest.slice(0, 19)}…, got ${actual.slice(0, 19)}… — ` +
          'the registry served something other than what was requested'
      );
    }
    return res.body;
  }

  async putManifest(reference, manifest) {
    const body = Buffer.from(JSON.stringify(manifest), 'utf8');
    const res = await this.call(`${this.base()}/manifests/${reference}`, {
      method: 'PUT',
      headers: { 'Content-Type': MANIFEST_MEDIA_TYPE, 'Content-Length': String(body.length) },
      body,
    });
    if (res.status !== 201 && res.status !== 200) {
      throw new OciError(`the registry rejected the manifest (${res.status})`, { status: res.status });
    }
    return { digest: res.headers['docker-content-digest'] || digestOf(body) };
  }

  async getManifest(reference) {
    const res = await this.call(`${this.base()}/manifests/${reference}`, {
      method: 'GET',
      headers: { Accept: `${MANIFEST_MEDIA_TYPE}, application/vnd.oci.image.index.v1+json` },
    });
    if (res.status === 404) {
      throw new OciError(
        `${this.registry}/${this.repository}:${reference} does not exist (404)`,
        { status: 404 }
      );
    }
    if (res.status !== 200) {
      throw new OciError(`could not fetch the manifest (${res.status})`, { status: res.status });
    }
    // When the caller pinned a digest, the manifest must hash to it. This is
    // the check that makes `@sha256:…` mean something.
    const digest = digestOf(res.body);
    if (/^sha256:[0-9a-f]{64}$/.test(reference) && digest !== reference) {
      throw new OciError(
        `manifest digest mismatch: asked for ${reference.slice(0, 19)}…, got ${digest.slice(0, 19)}…`
      );
    }
    return { manifest: JSON.parse(res.body.toString('utf8')), digest };
  }
}
