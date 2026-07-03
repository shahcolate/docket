// Dependency-free flag parsing: `--key value`, `--key=value`, boolean flags.
//
// Only flags declared in `booleans` are ever treated as boolean — everything
// else consumes the next token as its value even if that token starts with
// `--`. Guessing from the token's shape silently drops user data (a --note
// whose text begins with a dash would vanish from the record).

export function parseArgs(argv, { booleans = [] } = {}) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        if (booleans.includes(key)) {
          flags[key] = true;
        } else if (i + 1 < argv.length) {
          flags[key] = argv[++i];
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}
