#!/usr/bin/env node
import { main } from '../src/cli.js';

// Set exitCode and let Node drain stdout, rather than process.exit() which can
// truncate a buffered pipe write. The `docket hook` decision JSON goes to a
// pipe under Claude Code; a dropped write reads as "no decision" and fails
// open — so the last bytes must flush before we exit.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    console.error(`docket: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  }
);
