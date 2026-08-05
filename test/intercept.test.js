// Gateway-interceptor test: pipe real tool-call request JSON into
// `docket intercept` and check the contract the Docker MCP Gateway actually
// implements (docker/mcp-gateway, pkg/interceptors/interceptors.go):
//
//   empty stdout            → the gateway calls the real tool
//   a CallToolResult JSON   → the gateway returns THAT and never calls the tool
//   non-zero exit           → the gateway aborts the call with an opaque error
//
// So the invariants under test are: allow is silent, ask and deny both BLOCK
// (a gateway has no human to prompt), the blocking result carries the
// `type: "text"` discriminator the gateway's unmarshaller requires, and every
// decision exits 0 so the model gets a reason instead of a crash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeCall, parseCall, argumentStrings, blockResult } from '../src/commands/intercept.js';
import { readLastRecord } from '../src/lib/record.js';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
delete ENV.DOCKET_DIR;

function setupProject(template = 'insurance-appeal', name = 'appeal') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-intercept-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  execFileSync(process.execPath, [BIN, 'new', name, '--template', template], {
    cwd: dir,
    env: ENV,
  });
  return dir;
}

function run(cwd, args, payload) {
  const res = spawnSync(process.execPath, [BIN, 'intercept', ...args], {
    cwd,
    env: ENV,
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const call = (name, args) => ({ params: { name, arguments: args } });

test('allow is silence — the gateway proceeds to the real tool', () => {
  const dir = setupProject();
  const res = run(dir, ['--loop', 'appeal', '--action', 'read'], call('fetch_policy', {
    path: 'policy documents/plan.pdf',
  }));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '', 'empty stdout is how the gateway is told to run the tool');
});

test('an unlisted call blocks — a gateway cannot prompt, so ask does not run', () => {
  const dir = setupProject();
  const res = run(dir, ['--loop', 'appeal'], call('gmail_send_email', {
    to: 'claims@insurer.example',
    subject: 'appeal',
  }));
  assert.equal(res.status, 0, 'a decision always exits 0 — non-zero is an opaque gateway error');
  const result = JSON.parse(res.stdout);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /gmail_send_email/);
  assert.match(result.content[0].text, /approve/i, 'the model is told a human must approve');
});

test('a never target denies, and says retrying by another route will not help', () => {
  const dir = setupProject();
  const res = run(dir, ['--loop', 'appeal'], call('claims_api', {
    command: 'accepting a settlement',
  }));
  const result = JSON.parse(res.stdout);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /DENIED/);
  assert.match(result.content[0].text, /hard stop/i);
});

test('the block result carries the type discriminator the gateway unmarshals on', () => {
  const dir = setupProject();
  const res = run(dir, ['--loop', 'appeal'], call('wire_transfer', { amount: '9999' }));
  const result = JSON.parse(res.stdout);
  // The gateway decodes stdout into mcp.CallToolResult, whose Content is an
  // interface dispatched on "type". Omit it and the whole call errors out.
  assert.equal(result.content[0].type, 'text');
  assert.equal(typeof result.content[0].text, 'string');
});

test('every gated decision lands on the record, marked as coming from the gateway', () => {
  const dir = setupProject();
  run(dir, ['--loop', 'appeal', '--server', 'gmail'], call('gmail_send_email', { to: 'x@y.z' }));
  const entry = readLastRecord(path.join(dir, '.docket'));
  assert.equal(entry.kind, 'check');
  assert.equal(entry.via, 'gateway');
  assert.equal(entry.tool, 'gmail_send_email');
  assert.equal(entry.server, 'gmail');
  assert.equal(entry.verdict, 'ask');
});

test('unknown tools default to send — the verb whose allow list stays shortest', () => {
  const dir = setupProject();
  // No --action: a tool docket has never heard of must not be guessed into a
  // gentler verb just because its name sounds harmless.
  const res = run(dir, ['--loop', 'appeal'], call('search_and_purge', { query: 'old claims' }));
  const result = JSON.parse(res.stdout);
  assert.equal(result.isError, true);
});

test('--strict blocks a call no loop covers; without it, unrouted calls pass through', () => {
  const dir = setupProject();
  const payload = call('spotify_play', { name: 'a song about insurance' });

  const strict = run(dir, ['--strict'], payload);
  assert.equal(strict.status, 0);
  assert.match(JSON.parse(strict.stdout).content[0].text, /strict mode/);

  const loose = run(dir, [], payload);
  assert.equal(loose.status, 0);
  assert.equal(loose.stdout, '', 'docket governs what you wrote loops for; it does not seize the rest');
});

test('a gate that was asked for fails closed on every misconfiguration', () => {
  const dir = setupProject();
  const payload = call('anything', { query: 'x' });

  for (const [label, args, input] of [
    ['bad stdin', ['--loop', 'appeal'], 'not json at all'],
    ['no tool name', ['--loop', 'appeal'], JSON.stringify({ params: {} })],
    ['misnamed loop', ['--loop', 'nope'], JSON.stringify(payload)],
  ]) {
    const res = run(dir, args, input);
    assert.equal(res.status, 0, `${label}: still exits 0`);
    const result = JSON.parse(res.stdout);
    assert.equal(result.isError, true, `${label}: blocked`);
    assert.match(result.content[0].text, /misconfigured/, `${label}: says why`);
  }
});

test('an ungated interceptor outside a docket project costs nothing and logs nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-nointercept-'));
  const res = run(dir, [], call('anything', { query: 'x' }));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '', 'one log line per tool call would drown the gateway output');
});

test('a gated interceptor outside a docket project fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-nointercept-'));
  const res = run(dir, ['--loop', 'appeal'], call('anything', { query: 'x' }));
  assert.equal(JSON.parse(res.stdout).isError, true);
});

test('--action rejects a verb that is not in the warrant vocabulary', () => {
  const dir = setupProject();
  const res = run(dir, ['--loop', 'appeal', '--action', 'delete'], call('rm', { path: '/' }));
  assert.equal(res.status, 1, 'a typo in the config must not silently pick a default verb');
  assert.match(res.stderr, /--action must be one of/);
});

test('the target carries every argument, not just the first one found', () => {
  // Picking one argument lets a caller hide the consequential half of a call
  // behind an innocuous first field. Everything goes in.
  const target = describeCall('send_email', {
    subject: 'quarterly update',
    to: 'the insurer',
    body: 'accepting a settlement',
  });
  assert.match(target, /accepting a settlement/);
  assert.match(target, /the insurer/);
  assert.match(target, /quarterly update/);
});

test('salient argument keys lead the target', () => {
  const target = describeCall('run', { zzz_meta: 'trace-1', command: 'rm -rf /' });
  assert.match(target, /^run: rm -rf \/ trace-1/);
});

test('argument walking is depth-limited and survives hostile shapes', () => {
  let deep = 'bottom';
  for (let i = 0; i < 50; i++) deep = { next: deep };
  assert.doesNotThrow(() => argumentStrings(deep));
  assert.deepEqual(argumentStrings(null), []);
  assert.deepEqual(argumentStrings({ a: [1, 'two', true] }), ['1', 'two', 'true']);
});

test('both spellings of the request payload parse', () => {
  assert.deepEqual(parseCall({ params: { name: 'a', arguments: { x: 1 } } }), {
    name: 'a',
    arguments: { x: 1 },
  });
  // The http interceptor type can hand the payload through a re-serializer.
  assert.deepEqual(parseCall({ name: 'a', arguments: { x: 1 } }), { name: 'a', arguments: { x: 1 } });
  assert.equal(parseCall({ params: {} }), null);
  assert.equal(parseCall(null), null);
});

test('blockResult is shaped like a CallToolResult and is always an error', () => {
  const r = blockResult('nope');
  assert.deepEqual(r, { content: [{ type: 'text', text: 'nope' }], isError: true });
});
