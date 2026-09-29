// Model adapter for the Claude Messages API.
//
// Raw fetch, not @anthropic-ai/sdk: zero dependencies is a hard rule in this
// repo (CONTRIBUTING.md), and the eval ships inside the npm package.
//
// Deliberately NOT enabled: server-side refusal fallbacks. A fallback re-runs
// the turn on a different model, which would silently mix two models into one
// score. A refusal is recorded as its own outcome instead.

export const DEFAULT_MODEL = 'claude-opus-5-5';
const API_VERSION = '2023-06-01';

function credentials(env) {
  if (env.ANTHROPIC_API_KEY) return { 'x-api-key': env.ANTHROPIC_API_KEY };
  if (env.ANTHROPIC_AUTH_TOKEN) {
    return { authorization: `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`, 'anthropic-beta': 'oauth-2025-04-20' };
  }
  return null;
}

export function hasCredentials(env = process.env) {
  return credentials(env) !== null;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function anthropicAdapter({
  model = DEFAULT_MODEL,
  effort,
  maxTokens = 16000,
  env = process.env,
  fetchImpl = globalThis.fetch,
  retries = 4,
} = {}) {
  const auth = credentials(env);
  if (!auth) throw new Error('no ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the environment');
  const base = (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');

  return {
    name: model + (effort ? ` (effort ${effort})` : ''),
    async turn({ system, tools, messages }) {
      const body = { model, max_tokens: maxTokens, system, tools, messages };
      if (effort) body.output_config = { effort };
      let lastErr;
      for (let attempt = 0; attempt <= retries; attempt++) {
        let res;
        try {
          res = await fetchImpl(`${base}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'anthropic-version': API_VERSION, ...auth },
            body: JSON.stringify(body),
          });
        } catch (err) {
          lastErr = err; // connection-level: retry
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (res.ok) return res.json();
        const text = await res.text();
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
        if (!RETRYABLE.has(res.status)) throw lastErr;
        const after = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
      }
      throw lastErr;
    },
  };
}
