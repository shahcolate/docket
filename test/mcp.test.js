// MCP server test: speak real newline-delimited JSON-RPC to the spawned server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/docket.js', import.meta.url).pathname;
// Color must be off regardless of the host shell's FORCE_COLOR/CLICOLOR exports —
// assertions match plain text.
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

function setupProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-mcp-'));
  execFileSync(process.execPath, [BIN, 'init', '--quiet'], { cwd: dir, env: ENV });
  execFileSync(process.execPath, [BIN, 'new', 'appeal', '--template', 'insurance-appeal'], {
    cwd: dir,
    env: ENV,
  });
  return dir;
}

async function mcpSession(dir, requests) {
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: dir });
  const responses = [];
  let buffer = '';
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) responses.push(JSON.parse(line));
      }
      if (responses.length >= requests.filter((r) => r.id !== undefined).length) {
        child.stdin.end();
      }
    });
    child.on('close', resolve);
    child.on('error', reject);
    setTimeout(() => {
      child.kill();
      reject(new Error(`mcp server timed out; got ${responses.length} responses`));
    }, 10_000).unref();
  });
  for (const req of requests) child.stdin.write(JSON.stringify(req) + '\n');
  await done;
  return responses;
}

test('initialize, list tools, check boundary, leave receipt', async () => {
  const dir = setupProject();
  const responses = await mcpSession(dir, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'docket_warrant_check',
        arguments: { loop: 'appeal', action: 'send', target: 'appeal email to the insurer' },
      },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'docket_record',
        arguments: { loop: 'appeal', did: 'drafted appeal', stopped: 'before send' },
      },
    },
  ]);

  const byId = Object.fromEntries(responses.map((r) => [r.id, r]));
  assert.equal(byId[1].result.serverInfo.name, 'docket');
  assert.equal(byId[2].result.tools.length, 4);
  assert.match(byId[3].result.content[0].text, /verdict: ask/);
  assert.match(byId[3].result.content[0].text, /STOP/);
  assert.match(byId[4].result.content[0].text, /record #\d+ appended/);

  // Both the check and the note landed in the chain, verifiably.
  const verify = execFileSync(process.execPath, [BIN, 'record', 'verify'], {
    cwd: dir,
    encoding: 'utf8',
    env: ENV,
  });
  assert.match(verify, /chain intact/);
  const log = execFileSync(process.execPath, [BIN, 'record', 'log'], {
    cwd: dir,
    encoding: 'utf8',
    env: ENV,
  });
  assert.match(log, /ask send/);
  assert.match(log, /did: drafted appeal/);
});

test('unknown method gets a JSON-RPC error; unknown tool an isError result', async () => {
  const dir = setupProject();
  const responses = await mcpSession(dir, [
    { jsonrpc: '2.0', id: 1, method: 'no/such/method' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bogus', arguments: {} } },
  ]);
  const byId = Object.fromEntries(responses.map((r) => [r.id, r]));
  assert.equal(byId[1].error.code, -32601);
  assert.equal(byId[2].result.isError, true);
});
