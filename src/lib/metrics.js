// Autonomy metrics, derived from the record — not asserted, computed.
//
// The record already logs every warrant check with its verdict, every note,
// and every amendment. That's enough to answer the questions a team climbing
// the autonomy ladder actually needs (after Addy Osmani's "Agentic Autonomy
// Levels"): how often does the agent proceed on its own vs stop for a human?
// how long does it run unattended? is approval fatigue setting in?
//
// Every number here is exact from the hash-chained log — except the two
// labeled `proxy`, which approximate wall-clock/instruction concepts the
// record can't measure directly. They're marked so nobody reads more into
// them than the data supports.

export function computeMetrics(entries, { loop, by } = {}) {
  let scoped = entries;
  if (loop) scoped = scoped.filter((e) => e.loop === loop);
  // Scoping by agent answers the level-4 question directly: not "how
  // autonomous are we?" but "how autonomous is *this* agent, on this branch?"
  if (by) scoped = scoped.filter((e) => e.by === by);
  const checks = scoped.filter((e) => e.kind === 'check');
  const notes = scoped.filter((e) => e.kind === 'note');
  const amends = scoped.filter((e) => e.kind === 'amend');

  const verdict = { allow: 0, ask: 0, deny: 0 };
  for (const c of checks) if (c.verdict in verdict) verdict[c.verdict]++;

  const total = checks.length;
  const interventions = verdict.ask + verdict.deny; // every ask/deny is a human touchpoint

  // Longest unattended run: the most consecutive `allow` checks with no ask
  // or deny between them — the agent proceeding without stopping for a human.
  let longestRun = 0;
  let run = 0;
  for (const c of checks) {
    if (c.verdict === 'allow') {
      run++;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
  }

  const byLoop = {};
  for (const c of checks) {
    const b = (byLoop[c.loop] ??= { checks: 0, allow: 0, ask: 0, deny: 0 });
    b.checks++;
    if (c.verdict in b) b[c.verdict]++;
  }

  const byChannel = {};
  for (const c of checks) {
    const via = c.via || 'unknown';
    byChannel[via] = (byChannel[via] || 0) + 1;
  }

  // Per-agent posture. Entries written before attribution existed have no
  // `by`, and are counted as `unattributed` rather than guessed at — the
  // record says what it knows and nothing more.
  const byActor = {};
  for (const c of checks) {
    const who = c.by || 'unattributed';
    const b = (byActor[who] ??= { checks: 0, allow: 0, ask: 0, deny: 0, branches: [] });
    b.checks++;
    if (c.verdict in b) b[c.verdict]++;
    if (c.branch && !b.branches.includes(c.branch)) b.branches.push(c.branch);
  }

  const rate = (n) => (total ? n / total : 0);
  const ts = scoped.map((e) => e.ts).filter(Boolean).sort();

  return {
    entries: scoped.length,
    checks: total,
    verdict,
    rates: {
      autoApproved: rate(verdict.allow), // share the agent ran on its own
      escalated: rate(verdict.ask), // share it stopped and asked
      denied: rate(verdict.deny), // share it hit a hard stop
    },
    // proxy: checks between human touchpoints — Addy's "mean actions per
    // instruction" / "mean time between interventions", counted in actions.
    actionsPerIntervention: interventions ? total / interventions : total,
    longestUnattendedRun: longestRun, // consecutive allows
    amendments: amends.length, // warrant widenings via `docket review`
    work: { notes: notes.length, withStop: notes.filter((n) => n.stopped).length },
    byLoop,
    byChannel,
    byActor,
    span: ts.length ? { first: ts[0], last: ts[ts.length - 1] } : null,
  };
}
