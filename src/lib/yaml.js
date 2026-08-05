// Minimal YAML subset parser/emitter — enough for loop frontmatter, zero deps.
//
// Supported: nested maps, lists of scalars, quoted/unquoted scalars,
// booleans, null, numbers, `#` comment lines, and single-level flow
// collections — `[a, b, c]` and `{ tokens: 200000, attempts: 3 }`.
// Deliberately NOT supported: anchors, multi-line scalars, lists of maps,
// nested flow collections. Loop files never need them; keeping the grammar
// small keeps the format auditable.
//
// Flow collections are here because they were documented before they worked.
// The README's headline loop file has always been written
// `read: [policy documents, denial letter]`, and the agent contract as
// `budget: { attempts: 3, parallelism: 1 }` — both of which the parser used to
// hand back as plain strings, so anyone who copied the example got
// "`warrant.read` must be a list" and no clue why. A format's real grammar is
// whatever its examples use.

export function parseYaml(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    lines.push({ indent: raw.match(/^ */)[0].length, content: trimmed });
  }
  let i = 0;

  // Split a flow collection's interior on commas that are not inside quotes,
  // so an entry may contain one ("send: [\"the note, signed\"]"). Nested flow
  // collections are rejected rather than mangled: a warrant entry that quietly
  // parses into the wrong shape is a permission bug waiting to happen.
  function splitFlow(inner, whole) {
    const parts = [];
    let cur = '';
    let quote = null;
    for (const ch of inner) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === ',') {
        parts.push(cur);
        cur = '';
        continue;
      }
      if ('[]{}'.includes(ch)) {
        throw new Error(
          `docket: nested flow collections are not supported in frontmatter: "${whole}" — use block style`
        );
      }
      cur += ch;
    }
    if (quote) throw new Error(`docket: unterminated quote in frontmatter: "${whole}"`);
    parts.push(cur);
    // Empties absorb `[]`, `{}`, and a trailing comma.
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function parseScalar(s) {
    if (s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s.startsWith('[') && s.endsWith(']')) {
      return splitFlow(s.slice(1, -1), s).map(parseScalar);
    }
    if (s.startsWith('{') && s.endsWith('}')) {
      const map = {};
      for (const part of splitFlow(s.slice(1, -1), s)) {
        const colon = part.indexOf(':');
        if (colon === -1) {
          throw new Error(`docket: flow map entry "${part}" is missing its colon in "${s}"`);
        }
        map[part.slice(0, colon).trim()] = parseScalar(part.slice(colon + 1).trim());
      }
      return map;
    }
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      try {
        return JSON.parse(s); // unescape \" and \\ — the emitter uses JSON quoting
      } catch {
        return s.slice(1, -1);
      }
    }
    if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
      return s.slice(1, -1).replace(/''/g, "'");
    }
    return s;
  }

  function parseBlock(indent) {
    if (i >= lines.length) return null;
    return lines[i].content.startsWith('- ') || lines[i].content === '-'
      ? parseList(indent)
      : parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (i < lines.length) {
      const line = lines[i];
      if (line.indent !== indent || line.content.startsWith('- ')) break;
      const m = line.content.match(/^([^:]+):(.*)$/);
      if (!m) throw new Error(`docket: cannot parse frontmatter line: "${line.content}"`);
      const key = m[1].trim();
      const rest = m[2].trim();
      i++;
      if (rest === '') {
        if (i < lines.length && lines[i].indent > indent) {
          obj[key] = parseBlock(lines[i].indent);
        } else if (
          // Common hand-written style: list items at the same indent as the key.
          i < lines.length &&
          lines[i].indent === indent &&
          (lines[i].content.startsWith('- ') || lines[i].content === '-')
        ) {
          obj[key] = parseList(indent);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.indent !== indent || !(line.content.startsWith('- ') || line.content === '-')) break;
      const rest = line.content === '-' ? '' : line.content.slice(2).trim();
      i++;
      arr.push(rest === '' ? null : parseScalar(rest));
    }
    return arr;
  }

  const result = parseBlock(0);
  if (i < lines.length) {
    throw new Error(`docket: unexpected indentation near: "${lines[i].content}"`);
  }
  return result ?? {};
}

function needsQuotes(s) {
  return (
    s === '' ||
    /^[\s#\-?:@&*!|>%'"[\]{}]/.test(s) ||
    /[:#]\s/.test(s) ||
    /\s$/.test(s) ||
    ['null', 'true', 'false', '~'].includes(s) ||
    /^-?\d+(\.\d+)?$/.test(s)
  );
}

function emitScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return needsQuotes(s) ? JSON.stringify(s) : s;
}

export function dumpYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value.map((v) => `${pad}- ${emitScalar(v)}`).join('\n') + '\n';
  }
  if (value && typeof value === 'object') {
    let out = '';
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v)) {
        out += v.length === 0 ? `${pad}${k}: []\n` : `${pad}${k}:\n${dumpYaml(v, indent + 2)}`;
      } else if (v && typeof v === 'object') {
        out += `${pad}${k}:\n${dumpYaml(v, indent + 2)}`;
      } else {
        out += `${pad}${k}: ${emitScalar(v)}\n`;
      }
    }
    return out;
  }
  return `${pad}${emitScalar(value)}\n`;
}
