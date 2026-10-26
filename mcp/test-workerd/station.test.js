import { describe, test, expect } from "vitest";
import { env, runDurableObjectAlarm } from "cloudflare:test";

// The node suite (mcp/test/station.test.js) owns the transition matrix; this
// suite exists to prove the parts a pure function cannot: the real binding
// instantiates, SQLite persists across calls, the object's input gate
// serializes rival claims, and the SQL mirror of prunable() actually deletes.
// Deliberately small — one test per claim the node suite must take on faith.

const LEASE = 60_000;
const T0 = 1_700_000_000_000;

// A fresh object per test: the name is the serialization domain, so a unique
// name is complete isolation without touching global test storage flags.
function ledger() {
  const stub = env.STATION.get(env.STATION.idFromName(crypto.randomUUID()));
  return async (op, args = {}) => {
    const res = await stub.fetch("https://station/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op, args }),
    });
    return res.json();
  };
}

async function submitted(call, over = {}) {
  const args = { id: "r1", dj: "hank", normalized: "an hour of trains",
    now: T0, ...over };
  const out = await call("submit", args);
  expect(out.ok).toBe(true);
  return args.id;
}

describe("station ledger against the real binding", () => {
  test("a submission persists and reads back across calls", async () => {
    const call = ledger();
    await submitted(call);
    const got = await call("get", { id: "r1", now: T0 + 1 });
    expect(got.ok).toBe(true);
    expect(got.row.state).toBe("pending");
    expect(got.row.dj).toBe("hank");
  });

  test("the submission gates hold through SQL: duplicate, outstanding, cap", async () => {
    const call = ledger();
    await submitted(call);
    const dup = await call("submit", { id: "r2", dj: "hank",
      normalized: "an hour of trains", now: T0 + 5000 });
    expect(dup.code).toBe("duplicate");
    expect(dup.existingId).toBe("r1");

    const second = await call("submit", { id: "r3", dj: "hank",
      normalized: "something else", now: T0 + 5000 });
    expect(second.code).toBe("outstanding");

    // Fill the household with other DJs' pending requests, then hit the cap.
    await submitted(call, { id: "r4", dj: "prof", normalized: "disco" });
    await submitted(call, { id: "r5", dj: "funk", normalized: "satellites" });
    const over = await call("submit", { id: "r6", dj: "corr",
      normalized: "news", now: T0 });
    expect(over.code).toBe("household-cap");
  });

  test("rival claims serialize through the input gate: exactly one wins", async () => {
    const call = ledger();
    await submitted(call);
    // The same fingerprint on purpose: two honest curators can produce the
    // same sequence, and identity must come from the minted token, not from
    // the payload happening to match.
    const [a, b] = await Promise.all([
      call("claim", { id: "r1", fingerprint: "fp-a", leaseMs: LEASE, now: T0 }),
      call("claim", { id: "r1", fingerprint: "fp-a", leaseMs: LEASE, now: T0 }),
    ]);
    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    expect(losses[0].code).toBe("lease-held");
    expect(wins[0].row.claim_token).toBeTruthy();

    // And only the winner's token reaches the point of no return.
    const blind = await call("mark-write", { id: "r1", now: T0 + 1 });
    expect(blind.code).toBe("not-claimant");
    const marked = await call("mark-write", { id: "r1",
      token: wins[0].row.claim_token, now: T0 + 1 });
    expect(marked.ok).toBe(true);
  });

  test("a lease expires and the request is claimable afresh", async () => {
    const call = ledger();
    await submitted(call);
    await call("claim", { id: "r1", fingerprint: "fp-a", leaseMs: LEASE, now: T0 });
    const early = await call("claim", { id: "r1", fingerprint: "fp-b",
      leaseMs: LEASE, now: T0 + LEASE - 1 });
    expect(early.code).toBe("lease-held");
    const late = await call("claim", { id: "r1", fingerprint: "fp-b",
      leaseMs: LEASE, now: T0 + LEASE + 1 });
    expect(late.ok).toBe(true);
    expect(late.row.claim_count).toBe(2);
  });

  test("invalid transitions refuse through the binding", async () => {
    const call = ledger();
    await submitted(call);
    await call("claim", { id: "r1", fingerprint: "fp-a", leaseMs: LEASE, now: T0 });
    expect((await call("dismiss", { id: "r1", now: T0 + 1 })).code).toBe("bad-transition");
    expect((await call("acknowledge", { id: "r1", now: T0 + 1 })).code).toBe("bad-transition");
    expect((await call("commit-ready", { id: "r1", token: "wrong",
      now: T0 + 1 })).code).toBe("not-claimant");
    expect((await call("claim", { id: "missing", fingerprint: "fp",
      now: T0 })).code).toBe("unknown-request");
  });

  test("past the point of no return nothing resets to pending", async () => {
    const call = ledger();
    await submitted(call);
    const c = await call("claim", { id: "r1", fingerprint: "fp-a", leaseMs: LEASE, now: T0 });
    await call("mark-write", { id: "r1", token: c.row.claim_token, now: T0 + 1 });

    // The claimant dies; the sweep arrives after the lease.
    const takeover = await call("claim", { id: "r1", fingerprint: "fp-b",
      now: T0 + LEASE + 1 });
    expect(takeover.code).toBe("reconcile-required");

    // The sweep read the live playlist and it does not match: uncertainty.
    const rec = await call("reconcile", { id: "r1", liveFingerprint: "other",
      now: T0 + LEASE + 1 });
    expect(rec.ok).toBe(true);
    expect(rec.row.state).toBe("needs-attention");
    expect(rec.row.attention_code).toBe("unverified-write");

    const got = await call("get", { id: "r1", now: T0 + LEASE + 2 });
    expect(got.row.state).toBe("needs-attention");
  });

  test("a dead claimant whose write landed reconciles to ready", async () => {
    const call = ledger();
    await submitted(call);
    const c = await call("claim", { id: "r1", fingerprint: "fp-a", leaseMs: LEASE, now: T0 });
    await call("mark-write", { id: "r1", token: c.row.claim_token, now: T0 + 1 });
    const rec = await call("reconcile", { id: "r1", liveFingerprint: "fp-a",
      playlistId: "P", now: T0 + LEASE + 1 });
    expect(rec.ok).toBe(true);
    expect(rec.row.state).toBe("ready");
    expect(rec.note).toBe("write-landed");
  });

  test("a request past retention cannot be claimed by a late event", async () => {
    const call = ledger();
    await submitted(call);
    const month = 31 * 24 * 60 * 60 * 1000;
    // The opaque-ID event arrives a month late; pruning runs before the
    // lookup, so the answer is "unknown", never a fulfilment of stale intent.
    const late = await call("claim", { id: "r1", fingerprint: "fp-a",
      now: T0 + month });
    expect(late.code).toBe("unknown-request");
  });

  test("the list state filter runs in SQL, before the row limit", async () => {
    const call = ledger();
    await submitted(call);                       // hank, pending, T0
    // Bury it under 51 newer, settled requests from other DJs.
    for (let i = 0; i < 51; i++) {
      const id = `s${i}`;
      const at = T0 + 1000 + i;
      await call("submit", { id, dj: `dj${i}`, normalized: `set ${i}`, now: at });
      const c = await call("claim", { id, fingerprint: "fp", now: at + 1 });
      await call("commit-ready", { id, token: c.row.claim_token,
        fingerprint: "fp", now: at + 2 });
    }
    const pending = await call("list", { states: ["pending"], now: T0 + 60_000 });
    expect(pending.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(pending.rows[0].claim_token).toBeUndefined();
  });

  test("a decline lands through the binding and the re-ask meets it", async () => {
    const call = ledger();
    await submitted(call);
    const d = await call("decline", { id: "r1",
      reason: "not my records", suggestedDj: "funkenstein", now: T0 + 1 });
    expect(d.ok).toBe(true);
    expect(d.row.state).toBe("declined");
    const again = await call("submit", { id: "r2", dj: "hank",
      normalized: "an hour of trains", now: T0 + 5000 });
    expect(again.code).toBe("duplicate");
    expect(again.existingId).toBe("r1");
    const fresh = await call("submit", { id: "r3", dj: "hank",
      normalized: "something else entirely", now: T0 + 5000 });
    expect(fresh.ok).toBe(true);
  });

  test("two fulfilments race through the gate: one writes, one is told to wait", async () => {
      const call = ledger();
      await submitted(call);
      // Both curators arrive with their own sequences at the same instant —
      // the shape MC-00 measured (webhook fire + sweep, seconds apart).
      const flow = async (fp) => {
        const c = await call("claim", { id: "r1", fingerprint: fp, leaseMs: LEASE, now: T0 });
        if (!c.ok) return { lost: c.code };
        const m = await call("mark-write", { id: "r1", token: c.row.claim_token, now: T0 + 1 });
        if (!m.ok) return { lost: m.code };
        const done = await call("commit-ready", { id: "r1",
          token: c.row.claim_token, fingerprint: fp, playlistId: "P", now: T0 + 2 });
        return done.ok ? { won: fp } : { lost: done.code };
      };
      const [a, b] = await Promise.all([flow("fp-a"), flow("fp-b")]);
      const winners = [a, b].filter((r) => r.won);
      const losers = [a, b].filter((r) => r.lost);
      expect(winners.length).toBe(1);
      expect(losers[0].lost).toBe("lease-held");
      const final = await call("get", { id: "r1", now: T0 + 3 });
      expect(final.row.state).toBe("ready");
      expect(final.row.fingerprint).toBe(winners[0].won);
    });

  test("release hands a lease back through the binding, claimable at once", async () => {
    const call = ledger();
    await submitted(call);
    const c = await call("claim", { id: "r1", fingerprint: "fp-a", leaseMs: LEASE, now: T0 });
    await call("mark-write", { id: "r1", token: c.row.claim_token, now: T0 + 1 });
    const rel = await call("release", { id: "r1", token: c.row.claim_token, now: T0 + 2 });
    expect(rel.ok).toBe(true);
    expect(rel.row.write_started).toBe(0);
    const next = await call("claim", { id: "r1", fingerprint: "fp-b",
      leaseMs: LEASE, now: T0 + 3 });
    expect(next.ok).toBe(true);
  });

  test("lazy retention deletes through the SQL mirror of prunable()", async () => {
    const call = ledger();
    await submitted(call);                       // pending, created T0
    const month = 31 * 24 * 60 * 60 * 1000;
    const listed = await call("list", { now: T0 + month });
    expect(listed.rows.length).toBe(0);
    // And a new submission with the same text sails through: nothing stale
    // is left to call it a duplicate or an outstanding request.
    const again = await call("submit", { id: "r9", dj: "hank",
      normalized: "an hour of trains", now: T0 + month });
    expect(again.ok).toBe(true);
  });

  // The keep columns arrive by ALTER on a deployed table (station.js,
  // ensureColumns) — the node suite owns that decision. What only the real
  // binding can show is that the columns are genuinely in the table: written,
  // persisted across calls, and carried back out through the HTTP boundary.
  test("one slug per request, through SQL and across calls", async () => {
    const call = ledger();
    await submitted(call);
    const c = await call("claim", { id: "r1", fingerprint: "fp-a",
      leaseMs: LEASE, now: T0 });
    await call("mark-write", { id: "r1", token: c.row.claim_token, now: T0 + 1 });
    await call("commit-ready", { id: "r1", token: c.row.claim_token,
      fingerprint: "fp-a", playlistId: "P", trackCount: 3, now: T0 + 2 });

    const mine = await call("keep-reserve", { id: "r1", slug: "party-aaa111",
      now: T0 + 3 });
    expect(mine.ok).toBe(true);
    expect(mine.row.kept_slug).toBe("party-aaa111");

    // The other curator, arriving with its own freshly salted slug.
    const rival = await call("keep-reserve", { id: "r1", slug: "party-bbb222",
      now: T0 + 4 });
    expect(rival.ok).toBe(true);
    expect(rival.row.kept_slug).toBe("party-aaa111");

    const done = await call("keep-commit", { id: "r1", now: T0 + 5 });
    expect(done.ok).toBe(true);
    expect(done.row.kept_at).toBe(T0 + 5);

    const after = await call("get", { id: "r1", now: T0 + 6 });
    expect(after.row.kept_slug).toBe("party-aaa111");
    expect(after.row.kept_at).toBe(T0 + 5);

    const second = await call("keep-reserve", { id: "r1", slug: "party-ccc333",
      now: T0 + 7 });
    expect(second.ok).toBe(false);
    expect(second.code).toBe("already-kept");
    expect(second.slug).toBe("party-aaa111");
  });

  // The KV counter (2026-09-06). A whole request's tally arrives in ONE call —
  // the Worker counts in memory and hands it over at the end, so a page that
  // touches twenty keys costs one write here rather than twenty. That is the
  // reason the counters live in the object and not in KV: this storage is not
  // billed by the operation, and a counter that spent what it measured would
  // be a joke.
  test("a request's KV tally lands in one call and reads back by kind and spender", async () => {
    const call = ledger();
    expect((await call("kv-count", { ops: [["get", "tiles", 4], ["put", "tiles", 1],
      ["list", "program", 1]], now: T0 })).ok).toBe(true);
    await call("kv-count", { ops: [["put", "tiles", 1], ["put", "items", 2]], now: T0 });
    const out = await call("kv-ops", { now: T0 + 1 });
    const hour = new Date(T0).toISOString().slice(0, 13);
    expect(out.hours).toEqual([
      { hour, op: "get", category: "tiles", n: 4 },
      { hour, op: "list", category: "program", n: 1 },
      { hour, op: "put", category: "items", n: 2 },
      { hour, op: "put", category: "tiles", n: 2 },
    ]);
    // A week later the hours are gone: this is a counter, not a record.
    const later = await call("kv-ops", { now: T0 + 8 * 24 * 60 * 60 * 1000 });
    expect(later.hours).toEqual([]);
  });

  // The Spotify call counter (2026-09-06): the upsert lands in SQLite, the
  // sums come back by hour and kind, a refusal is kept with its wait, and
  // the two-day window is what the read returns.
  test("calls are counted by hour and kind, refusals kept, and two days read back", async () => {
    const call = ledger();
    for (let i = 0; i < 3; i++) expect((await call("count", { category: "search", now: T0 })).ok).toBe(true);
    await call("count", { category: "read", now: T0 });
    await call("count", { category: "read", now: T0 - 3 * 24 * 60 * 60 * 1000 });
    await call("quota-hit", { retryAfter: 40322, category: "write", reason: "QUOTA_EXCEEDED", now: T0 + 1 });
    const out = await call("calls", { now: T0 + 2 });
    expect(out.ok).toBe(true);
    const hour = new Date(T0).toISOString().slice(0, 13);
    expect(out.hours).toEqual([
      { hour, category: "read", n: 1 },
      { hour, category: "search", n: 3 },
    ]);
    // The refusal carries what the counter said AT the refusal: the four
    // calls made in the hour before it, and not the one from three days back.
    // This is the whole point of the counter — a number read afterwards has
    // the lockout's worth of silence in it, and then the recovery burst.
    expect(out.hits).toEqual([{
      at: T0 + 1, retry_after: 40322, category: "write", reason: "QUOTA_EXCEEDED", calls_24h: 4,
    }]);
    // A week later the old hours are gone and the refusal stays.
    const later = await call("calls", { now: T0 + 8 * 24 * 60 * 60 * 1000 });
    expect(later.hours).toEqual([]);
    expect(later.hits.length).toBe(1);
    expect(later.hits[0].calls_24h).toBe(4);
  });
});

// THE TALK LEDGER (MC-15, 2026-09-12): the SQL the node fake takes on faith —
// a reservation persists, settles, and is summed per day across calls.
describe("the Talk ledger against the real binding", () => {
  const cap = (n) => n.toString(16).padStart(32, "0");
  const MIN = 60_000;

  test("a line is charged by the clock through SQL: reserve, beat, done, the day's total; list and relabel", async () => {
    const call = ledger();
    // The clock held at now and run forward by hand, so the object's alarm
    // (armed at the grace, in the future) never fires under the test; a row
    // a week older than "now" would be pruned, which is why not T0.
    const T1 = Date.now();
    expect(await call("voice-reserve", { cap: cap(1), day: "2026-09-12", cap_minutes: 60, now: T1 }))
      .toEqual({ ok: true, used: 1, used_sec: 15, cap_minutes: 60, remaining: 59 });
    expect(await call("voice-bind", { cap: cap(1), session_id: "live_x", now: T1 + 1 })).toEqual({ ok: true });
    expect(await call("voice-beat", { cap: cap(1), cap_minutes: 60, now: T1 + 30_000 })).toEqual({ ok: true, used: 1, used_sec: 30, cap_minutes: 60, remaining: 59 });
    expect(await call("voice-check", { cap: cap(1), now: T1 + 60_000 })).toEqual({ ok: true, live: true, day: "2026-09-12" });
    // Done at 125 s, five seconds past the grace of the one beat (30 s + 90 s):
    // charged to the grace, not to the "done" (Codex, MC16-8N2A). No
    // OPENAI_API_KEY in the test binding: nothing to attach with, expired.
    expect(await call("voice-settle", { cap: cap(1), now: T1 + 125_000 })).toEqual({ ok: true, minutes: 2, seconds: 120, closed_by: "expired" });
    expect(await call("voice-check", { cap: cap(1), now: T1 + 126_000 })).toEqual({ ok: true, live: false, day: "2026-09-12" });
    expect(await call("voice-beat", { cap: cap(1), cap_minutes: 60, now: T1 + 127_000 })).toMatchObject({ ok: false, code: "over", used: 2 });
    expect(await call("voice-day", { day: "2026-09-12", cap_minutes: 60, now: T1 + 200_000 })).toEqual({ ok: true, used: 2, used_sec: 120, cap_minutes: 60, remaining: 58 });
    expect(await call("voice-day", { day: "2026-09-13", cap_minutes: 60, now: T1 })).toEqual({ ok: true, used: 0, used_sec: 0, cap_minutes: 60, remaining: 60 });
    expect(await call("voice-reserve", { cap: cap(1), day: "2026-09-12", now: T1 + 1 })).toEqual({ ok: false, code: "exists" });
    expect((await call("voice-list", { day: "2026-09-12", now: T1 + 2 })).sessions.map((r) => r.cap)).toEqual([cap(1)]);
    expect(await call("voice-relabel", { from: "2026-09-12", to: "2026-09-11", now: T1 + 3 })).toEqual({ ok: true, moved: 1 });
    expect((await call("voice-day", { day: "2026-09-12", now: T1 + 4 })).used_sec).toBe(0);
    expect((await call("voice-day", { day: "2026-09-11", now: T1 + 5 })).used_sec).toBe(120);
  });

  test("the object's alarm: armed at the grace, re-armed by a beat, and the sweep hangs up a quiet line at its grace", async () => {
    const stub = env.STATION.get(env.STATION.idFromName(crypto.randomUUID()));
    const call = async (op, args = {}) => (await stub.fetch("https://station/", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) })).json();
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    // A line opened a minute ago that has never beaten: its grace ended
    // thirty seconds after it opened, so the alarm is due at once.
    const T1 = Date.now() - 60_000;
    expect((await call("voice-reserve", { cap: cap(1), day: "2026-09-12", cap_minutes: 60, now: T1 })).ok).toBe(true);
    expect((await call("voice-bind", { cap: cap(1), session_id: "live_x", now: T1 + 1 })).ok).toBe(true);
    // A beat now moves the grace ninety seconds out, and re-arms the alarm.
    const now = Date.now();
    expect((await call("voice-beat", { cap: cap(1), cap_minutes: 60, now })).ok).toBe(true);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    // The alarm ran early (the harness runs it now): nothing was due, the line is live.
    expect((await call("voice-check", { cap: cap(1), now: now + 1 })).live).toBe(true);
    // The sweep well past the grace: hung up (no key: expired), charged to
    // the GRACE — sixty seconds before the beat plus ninety — not to the sweep.
    const swept = await call("voice-sweep", { now: now + 200_000 });
    expect(swept.closed).toEqual([{ cap: cap(1), day: "2026-09-12", by: "expired", seconds: 150, reason: "no-key", tries: 1 }]);
    expect((await call("voice-check", { cap: cap(1), now: now + 200_001 })).live).toBe(false);
    expect((await call("voice-day", { day: "2026-09-12", cap_minutes: 60, now: now + 200_001 })).used_sec).toBe(150);
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    // Done on a line with no id: expired, no alarm left.
    expect((await call("voice-reserve", { cap: cap(2), day: "2026-09-12", now })).ok).toBe(true);
    expect(await call("voice-settle", { cap: cap(2), now: now + 10_000 })).toEqual({ ok: true, minutes: 1, seconds: 15, closed_by: "expired" });
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    // A void of an unbound line removes the row for good.
    expect((await call("voice-reserve", { cap: cap(3), day: "2026-09-12", now })).ok).toBe(true);
    expect(await call("voice-void", { cap: cap(3), now })).toEqual({ ok: true });
    expect((await call("voice-day", { day: "2026-09-12", cap_minutes: 60, now: now + 90_002 })).used_sec).toBe(165);
  });

  test("a row from before the house knew its zone is re-dated by that zone on the next wake; newer rows are not", async () => {
    // wrangler.toml carries HOUSE_TZ = America/Los_Angeles; a row opened at
    // 05:35 UTC on the 12th was labelled the 12th (Amsterdam) and is the 11th
    // in that zone. Rows are pruned a week after they open, so this test is
    // dated to the rows it is about and will go with them.
    const call = ledger();
    const legacy = Date.UTC(2026, 8, 12, 5, 35);
    if (Date.now() - legacy > 6 * 24 * 60 * 60 * 1000) return;
    expect((await call("voice-reserve", { cap: cap(7), day: "2026-09-12", cap_minutes: 60, now: legacy })).ok).toBe(true);
    expect((await call("voice-settle", { cap: cap(7), now: legacy + 60_000 })).ok).toBe(true);
    expect((await call("voice-list", { day: "2026-09-12", now: legacy + 61_000 })).sessions.map((r) => r.cap)).toEqual([], "moved on the next wake");
    expect((await call("voice-list", { day: "2026-09-11", now: legacy + 61_000 })).sessions.map((r) => r.cap)).toEqual([cap(7)]);
    // A row opened after the cutoff keeps whatever day the Worker gave it.
    const fresh = Date.now();
    expect((await call("voice-reserve", { cap: cap(8), day: "2026-09-13", cap_minutes: 60, now: fresh })).ok).toBe(true);
    expect((await call("voice-list", { day: "2026-09-13", now: fresh + 1 })).sessions.map((r) => r.cap)).toEqual([cap(8)]);
    await call("voice-settle", { cap: cap(8), now: fresh + 2 });
  });

  test("the sweep counts the day's settled minutes: a line is hung up when the day is spent, and a beat past the cap is refused", async () => {
    const stub = env.STATION.get(env.STATION.idFromName(crypto.randomUUID()));
    const call = async (op, args = {}) => (await stub.fetch("https://station/", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) })).json();
    // The clock starts now and runs FORWARD by hand: every alarm the object
    // arms lands in the real future and never fires under the test (a row
    // dated in the past would arm an alarm already due, and its sweep would
    // race the assertions).
    const T = Date.now();
    // Fifty-eight minutes of one line, beaten every half minute, then done.
    expect((await call("voice-reserve", { cap: cap(1), day: "2026-09-12", cap_minutes: 60, now: T })).ok).toBe(true);
    for (let t = 30_000; t <= 58 * MIN; t += 30_000) expect((await call("voice-beat", { cap: cap(1), cap_minutes: 60, now: T + t })).ok).toBe(true);
    expect((await call("voice-settle", { cap: cap(1), now: T + 58 * MIN })).seconds).toBe(58 * 60);
    // A new line, beating along: the alarm is due at the cap moment, two minutes on.
    const now = T + 58 * MIN;
    expect(await call("voice-reserve", { cap: cap(2), day: "2026-09-12", cap_minutes: 60, now })).toMatchObject({ ok: true, used: 59, remaining: 1 });
    expect((await call("voice-bind", { cap: cap(2), session_id: "live_2", now })).ok).toBe(true);
    expect((await call("voice-beat", { cap: cap(2), cap_minutes: 60, now: now + 60_000 })).ok).toBe(true);
    expect(await call("voice-beat", { cap: cap(2), cap_minutes: 60, now: now + 121_000 })).toMatchObject({ ok: false, code: "cap", remaining: 0 });
    // A late sweep hangs it up (no key: expired) and charges to the cap's instant, not the sweep's.
    const swept = await call("voice-sweep", { now: now + 150_000 });
    expect(swept.closed).toEqual([{ cap: cap(2), day: "2026-09-12", by: "expired", seconds: 120, reason: "no-key", tries: 1 }]);
    expect(await call("voice-day", { day: "2026-09-12", cap_minutes: 60, now: now + 150_000 })).toEqual({ ok: true, used: 60, used_sec: 3600, cap_minutes: 60, remaining: 0 });
    expect((await call("voice-reserve", { cap: cap(3), day: "2026-09-12", cap_minutes: 60, now: now + 150_000 })).code).toBe("cap");
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
});

// THE GUEST LOCK (MC-18 stage 2): what the node suite takes on faith — the
// destination column really in the table and carried through every #save,
// and the object's one input gate serializing two claims toward one guest.
describe("the guest lock against the real binding", () => {
  const G = "GUESTSPOTIFY0000000001";
  const two = async (call) => {
    await submitted(call, { id: "a", dj: "hank", normalized: "an hour of trains", destination: G });
    await submitted(call, { id: "b", dj: "monk", normalized: "monk at the vanguard", destination: G });
  };

  test("two claims toward one guest race: exactly one wins, the other stays pending and claims after the commit", async () => {
    const call = ledger();
    await two(call);
    const [ra, rb] = await Promise.all([
      call("claim", { id: "a", fingerprint: "fp-a", destination: G, leaseMs: LEASE, now: T0 + 1 }),
      call("claim", { id: "b", fingerprint: "fp-b", destination: G, leaseMs: LEASE, now: T0 + 1 }),
    ]);
    const wins = [ra, rb].filter((r) => r.ok);
    const losses = [ra, rb].filter((r) => !r.ok);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    const winner = wins[0].row;
    const loser = winner.id === "a" ? "b" : "a";
    expect(losses[0].code).toBe("destination-busy");
    expect(losses[0].holder).toEqual({ request_id: winner.id, dj: winner.dj });
    expect(winner.destination).toBe(G);
    const waiting = (await call("get", { id: loser, now: T0 + 2 })).row;
    expect(waiting.state).toBe("pending");
    expect(waiting.claim_count).toBe(0);
    // The listing marks the loser and names the winner; the guest filter finds it.
    const listed = await call("list", { states: ["pending", "claimed"], now: T0 + 2 });
    expect(listed.rows.find((r) => r.id === loser).waiting_for).toEqual({ request_id: winner.id, dj: winner.dj });
    expect(listed.rows.find((r) => r.id === winner.id).waiting_for).toBeUndefined();
    expect((await call("list", { states: ["pending"], destination: G, now: T0 + 2 })).rows.map((r) => r.id))
      .toEqual([loser]);
    // Written but not yet committed: still held.
    await call("mark-write", { id: winner.id, token: winner.claim_token, now: T0 + 3 });
    expect((await call("claim", { id: loser, fingerprint: "fp-x", destination: G, leaseMs: LEASE, now: T0 + 4 })).code)
      .toBe("destination-busy");
    await call("commit-ready", { id: winner.id, token: winner.claim_token, fingerprint: winner.fingerprint,
      playlistId: G, now: T0 + 5 });
    const after = await call("claim", { id: loser, fingerprint: "fp-x", destination: G, leaseMs: LEASE, now: T0 + 6 });
    expect(after.ok).toBe(true);
    expect(after.row.destination).toBe(G);
  });

  test("a ready row keeps write_started = 1 and does not hold the guest", async () => {
    const call = ledger();
    await two(call);
    const a = await call("claim", { id: "a", fingerprint: "fp-a", destination: G, leaseMs: LEASE, now: T0 + 1 });
    await call("mark-write", { id: "a", token: a.row.claim_token, now: T0 + 2 });
    await call("commit-ready", { id: "a", token: a.row.claim_token, fingerprint: "fp-a", playlistId: G, now: T0 + 3 });
    const ready = (await call("get", { id: "a", now: T0 + 4 })).row;
    expect(ready.state).toBe("ready");
    expect(ready.write_started).toBe(1);
    expect(ready.destination).toBe(G);
    expect((await call("destination-busy", { destination: G, now: T0 + 4 })).busy).toBe(null);
    expect((await call("claim", { id: "b", fingerprint: "fp-b", destination: G, leaseMs: LEASE, now: T0 + 5 })).ok)
      .toBe(true);
  });

  test("a winner dead past mark-write refuses the loser until its reconcile; one dead before writing refuses nobody", async () => {
    const call = ledger();
    await two(call);
    await submitted(call, { id: "c", dj: "prof", normalized: "disco", destination: G });
    const a = await call("claim", { id: "a", fingerprint: "fp-a", destination: G, leaseMs: LEASE, now: T0 + 1 });
    await call("mark-write", { id: "a", token: a.row.claim_token, now: T0 + 2 });
    // The claimant dies mid-write. Long past its lease the guest is still held,
    // and the door's guard, reading by the same rule, says so too.
    const late = T0 + LEASE + 60_000;
    const refused = await call("claim", { id: "b", fingerprint: "fp-b", destination: G, leaseMs: LEASE, now: late });
    expect(refused.code).toBe("destination-busy");
    expect(refused.holder).toEqual({ request_id: "a", dj: "hank" });
    expect((await call("destination-busy", { destination: G, now: late })).busy).toEqual({ request_id: "a", dj: "hank" });
    expect((await call("destination-busy", { destination: G, except: "a", now: late })).busy).toBe(null);
    // Its own reconcile: the write landed. The row is ready and the guest free.
    const rec = await call("reconcile", { id: "a", liveFingerprint: "fp-a", playlistId: G, now: late + 1 });
    expect(rec.row.state).toBe("ready");
    const b = await call("claim", { id: "b", fingerprint: "fp-b", destination: G, leaseMs: LEASE, now: late + 2 });
    expect(b.ok).toBe(true);
    // b dies BEFORE writing: a dead lease with no write holds nothing, and c claims.
    const c = await call("claim", { id: "c", fingerprint: "fp-c", destination: G, leaseMs: LEASE,
      now: late + 2 + LEASE + 1 });
    expect(c.ok).toBe(true);
  });

  test("the column is in the table and survives every save; a busy refusal notes it on a row that had none", async () => {
    const call = ledger();
    // A dismissal is a transition through #save's INSERT OR REPLACE.
    await submitted(call, { id: "p", dj: "prof", normalized: "disco", destination: G });
    expect((await call("dismiss", { id: "p", now: T0 + 1 })).ok).toBe(true);
    expect((await call("get", { id: "p", now: T0 + 2 })).row.destination).toBe(G);
    // A row asked before the flip carries none, until a refusal or a claim says where it goes.
    await submitted(call, { id: "h", dj: "hank", normalized: "an hour of trains", destination: G });
    await submitted(call, { id: "m", dj: "monk", normalized: "monk at the vanguard" });
    expect((await call("get", { id: "m", now: T0 + 2 })).row.destination).toBe(null);
    const h = await call("claim", { id: "h", fingerprint: "fp-h", destination: G, leaseMs: LEASE, now: T0 + 3 });
    expect((await call("claim", { id: "m", fingerprint: "fp-m", destination: G, leaseMs: LEASE, now: T0 + 4 })).code)
      .toBe("destination-busy");
    const m = (await call("get", { id: "m", now: T0 + 5 })).row;
    expect(m.state).toBe("pending");
    expect(m.claim_count).toBe(0);
    expect(m.updated_at).toBe(T0);
    expect(m.destination).toBe(G);
    // The holder's commit and keep: still on the row.
    await call("mark-write", { id: "h", token: h.row.claim_token, now: T0 + 6 });
    await call("commit-ready", { id: "h", token: h.row.claim_token, fingerprint: "fp-h", playlistId: G, now: T0 + 7 });
    await call("keep-reserve", { id: "h", slug: "trains-aaa111", now: T0 + 8 });
    await call("keep-commit", { id: "h", now: T0 + 9 });
    expect((await call("get", { id: "h", now: T0 + 10 })).row.destination).toBe(G);
    // A claim toward no guest stamps none: that set goes to a DJ's own preset.
    expect((await call("claim", { id: "m", fingerprint: "fp-m", leaseMs: LEASE, now: T0 + 11 })).ok).toBe(true);
    expect((await call("get", { id: "m", now: T0 + 12 })).row.destination).toBe(null);
  });
});

// MC-25: THE HOME HELPER'S LINE, on the real object. The node fake passed a
// command's arguments whole, so it could not see that the real object dropped
// the key's number on the way down (2026-09-24, 21:39: "The Pro Plus did not
// take 2"). This drives the real socket.
describe("the home helper's line against the real binding", () => {
  test("a command goes down the socket with its key number, and the helper's answer comes back", async () => {
    const stub = env.STATION.get(env.STATION.idFromName(crypto.randomUUID()));
    const up = await stub.fetch("https://station/", { headers: { upgrade: "websocket" } });
    expect(up.status).toBe(101);
    const ws = up.webSocket;
    ws.accept();
    const seen = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      seen.push(m);
      ws.send(JSON.stringify({ id: m.id, ok: true, reading: { name: "Pro Plus", state: "play", source: "Tidal" } }));
    });
    const call = (op, args) => stub.fetch("https://station/", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) }).then((r) => r.json());
    expect((await call("helper-get", {})).hands).toBe(true);
    const out = await call("helper-command", { cmd: "key", n: 2, speaker: "Pro Plus" });
    expect(out.ok).toBe(true);
    expect(out.reading.source).toBe("Tidal");
    expect(seen[0]).toMatchObject({ cmd: "key", n: 2, speaker: "Pro Plus" });
    ws.close();
  });
});

// MC-29: the kept player answer and the helper's changedAt, in real SQLite.
describe("the kept player answer against the real binding", () => {
  test("helper-put stamps changedAt only on a change; player-put keeps, player-forget refuses older reads; helper-get returns both", async () => {
    const stub = env.STATION.get(env.STATION.idFromName(crypto.randomUUID()));
    const call = (op, args) => stub.fetch("https://station/", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) }).then((r) => r.json());
    const sp = { "Pro Plus": { state: "play", source: "Spotify", track: "Cold Sweat" } };
    await call("helper-put", { doc: { at: 1000, speakers: sp }, now: 1000 });
    await call("helper-put", { doc: { at: 2000, speakers: sp }, now: 2000 });
    expect((await call("helper-get", {})).doc).toMatchObject({ at: 2000, changedAt: 1000 });
    await call("helper-put", { doc: { at: 3000, speakers: { "Pro Plus": { ...sp["Pro Plus"], track: "Mother Popcorn" } } }, now: 3000 });
    expect((await call("helper-get", {})).doc.changedAt).toBe(3000);
    expect((await call("player-put", { at: 4000, st: { is_playing: true, item: { name: "Mother Popcorn" } } })).kept).toBe(true);
    expect((await call("helper-get", {})).player).toEqual({ at: 4000, st: { is_playing: true, item: { name: "Mother Popcorn" } } });
    expect((await call("player-put", { at: 3500, st: {} })).kept).toBe(false);
    await call("player-forget", { until: 9000, now: 5000 });
    expect((await call("helper-get", {})).player).toBe(null);
    expect((await call("player-put", { at: 8000, st: {} })).kept).toBe(false);
    expect((await call("player-put", { at: 9000, st: {} })).kept).toBe(true);
  });
});

describe("the rule check's tables against the real binding", () => {
  test("seen-put keeps what search showed for two days; sent-back marks a set once", async () => {
    const call = ledger();
    const day = 24 * 60 * 60 * 1000;
    await call("seen-put", { rows: [["spotify:track:a", "Kursaal Flyers", "Hit Records", "Golden Mile", 200000], [null, "x"]], now: T0 });
    let got = await call("seen-get", { uris: ["spotify:track:a", "spotify:track:b"], key: "job:1", now: T0 + day });
    expect(got.tracks).toEqual({ "spotify:track:a": { uri: "spotify:track:a", lead: "Kursaal Flyers", title: "Hit Records", album: "Golden Mile", ms: 200000 } });
    expect(got.sent_back).toBe(false);
    await call("sent-back", { key: "job:1", now: T0 + day });
    got = await call("seen-get", { uris: ["spotify:track:a"], key: "job:1", now: T0 + 3 * day });
    expect(got.tracks).toEqual({});
    expect(got.sent_back).toBe(true);
  });

  test("a chat write's send-back lapses after its window, is used up by the write, and counts for the day", async () => {
    const call = ledger();
    const min = 60 * 1000;
    await call("sent-back", { key: "write:p:vibe", now: T0 });
    await call("sent-back", { key: "req:r1", now: T0 });
    const back = async (key, now, within) => (await call("seen-get", { key, uris: [], now, ...(within ? { sent_within_ms: within } : {}) })).sent_back;
    expect(await back("write:p:vibe", T0 + 10 * min, 15 * min)).toBe(true);
    expect(await back("write:p:vibe", T0 + 16 * min, 15 * min)).toBe(false);
    expect(await back("req:r1", T0 + 16 * min)).toBe(true);
    await call("sent-used", { key: "write:p:vibe", now: T0 + 2 * min });
    expect(await back("write:p:vibe", T0 + 3 * min, 15 * min)).toBe(false);
    expect(await call("sent-back-day", { now: T0 + 5 * min })).toEqual({ ok: true, requests: 1, endless: 0, chat_and_talk: 1 });
    expect(await call("sent-back-day", { now: T0 + 25 * 60 * min })).toEqual({ ok: true, requests: 0, endless: 0, chat_and_talk: 0 });
  });
});
