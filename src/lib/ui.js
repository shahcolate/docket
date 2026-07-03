// Tiny ANSI helpers. Colors only when writing to a TTY (or FORCE_COLOR).

const on =
  process.env.FORCE_COLOR === '1' ||
  (process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== '0');

const wrap = (open, close) => (s) => (on ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

export const VERDICT_STYLE = {
  allow: { color: green, badge: 'ALLOW' },
  ask: { color: yellow, badge: 'ASK' },
  deny: { color: red, badge: 'DENY' },
};
