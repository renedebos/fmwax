// THE TALK LEDGER (MC-16, 2026-09-12: "per minute, not per conversation").
// A line is charged by the SERVER'S clock from the moment it opens to the
// moment the ledger considers it over: its "done", or the last "still here"
// plus a ninety-second grace, or the moment the day's minutes run out. The
// page never supplies a number. The Durable Object's alarm hangs up at
// OpenAI whatever the page did not; "done" hangs up at OpenAI too. Kept in
// the object because KV has no compare-and-swap. The node suite drives the
// fake at the seam the Worker uses (station()), on the same reducer the
// real object runs; test-workerd/station.test.js proves the SQL and the
// alarm. Before MC-16 a conversation cost ten minutes flat.
import { test } from "node:test";
import assert from "node:assert/strict";

import { station, voiceDecide, voiceUsedSec, voiceUsedMs, voiceChargeSec, voiceLive, voiceDue, voiceNextAt, voiceDeadAt,
  voiceSweepDecide, voiceCapMs, voiceTotals, voiceCapCutoff, voiceEndFor, voiceArmAt, voiceMinutes,
  closeLiveSession, BEAT_GRACE_MS, CLOSE_TRIES, CLOSE_RETRY_MS } from "../station.js";
const totalsOf = (rows, now, capMin = 60) => voiceTotals(rows, now, capMin);
import { makeEnv } from "./harness.js";

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const cap = (n) => n.toString(16).padStart(32, "0");
const reserve = (e, n, over = {}) =>
  station(e, "voice-reserve", { cap: cap(n), day: "2026-09-12", cap_minutes: 60, now: T0, ...over });
const day = (e, now, over = {}) => station(e, "voice-day", { day: "2026-09-12", cap_minutes: 60, now, ...over });
const row = (e, n) => e.STATION.sessions.get(cap(n));

test("a line opens while a minute of the day is left, and is charged by the clock from then", async () => {
  const e = makeEnv();
  const r = await reserve(e, 1);
  assert.deepEqual(r, { ok: true, used: 1, used_sec: 15, cap_minutes: 60, remaining: 59 }, "an opening is fifteen seconds at least");
  // Two and a half minutes in, beating along: charged two and a half minutes.
  for (let t = 30_000; t <= 150_000; t += 30_000) assert.equal((await station(e, "voice-beat", { cap: cap(1), cap_minutes: 60, now: T0 + t })).ok, true);
  assert.deepEqual(await day(e, T0 + 150_000), { ok: true, used: 3, used_sec: 150, cap_minutes: 60, remaining: 57 });
  // "Done" at three minutes: the clock stops there, whatever is said later.
  const done = await station(e, "voice-settle", { cap: cap(1), now: T0 + 180_000 });
  assert.deepEqual(done, { ok: true, minutes: 3, seconds: 180, closed_by: "expired" }, "never bound: nothing to close at OpenAI");
  assert.deepEqual(await day(e, T0 + 3 * 60 * MIN), { ok: true, used: 3, used_sec: 180, cap_minutes: 60, remaining: 57 });
  assert.deepEqual(await station(e, "voice-settle", { cap: cap(1), now: T0 + 999_000 }), { ok: true, minutes: 3, seconds: 180, closed_by: "expired", note: "noop" });
  // The clock is the server's: a beat or a settle carries no seconds of the page's.
  assert.equal(row(e, 1).settled_sec, 180);
});

test("a line that stops beating is over at the end of its grace, and charged to there", async () => {
  const e = makeEnv();
  await reserve(e, 1);
  await station(e, "voice-beat", { cap: cap(1), now: T0 + 30_000 });
  // Live through the grace, dead after it; the charge stops growing at the grace.
  assert.equal((await station(e, "voice-check", { cap: cap(1), now: T0 + 30_000 + BEAT_GRACE_MS })).live, true);
  assert.equal((await station(e, "voice-check", { cap: cap(1), now: T0 + 30_000 + BEAT_GRACE_MS + 1 })).live, false);
  assert.equal((await day(e, T0 + 10 * MIN)).used_sec, 120, "thirty seconds of beats plus ninety of grace");
  // A beat after the grace is refused, and told the day's count.
  const late = await station(e, "voice-beat", { cap: cap(1), cap_minutes: 60, now: T0 + 10 * MIN });
  assert.equal(late.ok, false); assert.equal(late.code, "over"); assert.equal(late.used, 2);
  // The sweep at any later moment hangs it up and settles it AT the grace, not at the sweep.
  const swept = await station(e, "voice-sweep", { now: T0 + 10 * MIN });
  assert.deepEqual(swept.closed, [{ cap: cap(1), day: "2026-09-12", by: "expired", seconds: 120, reason: "unbound", tries: 0 }]);
  // And a "done" that arrives after the grace is charged to the grace, not to now.
  const e2 = makeEnv();
  await reserve(e2, 1);
  assert.deepEqual(await station(e2, "voice-settle", { cap: cap(1), now: T0 + 10 * MIN }), { ok: true, minutes: 2, seconds: 90, closed_by: "expired" });
  assert.equal(row(e, 1).settled_at, T0 + 30_000 + BEAT_GRACE_MS);
  assert.deepEqual((await station(e, "voice-sweep", { now: T0 + 11 * MIN })).closed, [], "nothing twice");
});

test("the day's cap: no new line inside the last minute, and every open line is hung up the moment it is spent", async () => {
  const e = makeEnv();
  // Fifty-nine and a half minutes already charged today: half a minute left.
  e.STATION.sessions.set(cap(9), { cap: cap(9), day: "2026-09-12", created_at: T0 - 100 * MIN, last_beat: T0 - 40.5 * MIN,
    cap_sec: 3600, reserved_min: 0, settled_sec: 59.5 * 60, settled_at: T0 - 40.5 * MIN, session_id: "live_old", closed_by: "server", close_tries: 0, retry_after: null });
  const refused = await reserve(e, 1);
  assert.deepEqual(refused, { ok: false, code: "cap", used: 60, cap_minutes: 60 }, "less than a minute left");
  // Fifty-eight: one may open, and the alarm is due when the minutes run out.
  e.STATION.sessions.get(cap(9)).settled_sec = 58 * 60;
  e.STATION.sessions.get(cap(9)).settled_at = T0 - 42 * MIN;
  const ok = await reserve(e, 1);
  assert.deepEqual(ok, { ok: true, used: 59, used_sec: 58 * 60 + 15, cap_minutes: 60, remaining: 1 });
  await station(e, "voice-bind", { cap: cap(1), session_id: "live_1" });
  const all = () => [...e.STATION.sessions.values()];
  const pending = () => all().filter((r) => r.closed_by == null);
  assert.equal(voiceNextAt(pending(), T0, totalsOf(all(), T0)), T0 + 90_000, "the grace comes before the cap moment (two minutes on)");
  for (let t = 30_000; t <= 90_000; t += 30_000) await station(e, "voice-beat", { cap: cap(1), now: T0 + t });
  assert.equal(voiceNextAt(pending(), T0 + 90_000, totalsOf(all(), T0 + 90_000)), T0 + 2 * MIN, "beating along, the cap moment is what is next");
  assert.deepEqual((await station(e, "voice-sweep", { now: T0 + 119_000 })).closed, [], "a second before the cap: nothing due");
  // A beat once the cap is spent is refused as such, and the line stays open for the sweep.
  const capBeat = await station(e, "voice-beat", { cap: cap(1), cap_minutes: 60, now: T0 + 121_000 });
  assert.deepEqual([capBeat.ok, capBeat.code, capBeat.remaining], [false, "cap", 0]);
  // A LATE sweep charges to the cap's instant, not to the sweep (Codex, MC16-8N2A).
  const atCap = await station(e, "voice-sweep", { now: T0 + 150_000, outcome: { closed: true, seconds: 120, reason: "close_requested", retry: false } });
  assert.deepEqual(atCap.closed, [{ cap: cap(1), day: "2026-09-12", by: "server", seconds: 120, reason: "close_requested", tries: 0 }], "hung up at OpenAI, charged to the cap");
  assert.deepEqual(await day(e, T0 + 200_000), { ok: true, used: 60, used_sec: 3600, cap_minutes: 60, remaining: 0 });
  assert.equal((await reserve(e, 2, { now: T0 + 200_000 })).code, "cap");
  // Another day is a fresh count, and the cap is the caller's number.
  const tomorrow = await reserve(e, 3, { day: "2026-09-13", cap_minutes: 30 });
  assert.deepEqual(tomorrow, { ok: true, used: 1, used_sec: 15, cap_minutes: 30, remaining: 29 });
});

test("two open lines spend two seconds a second: the cap moment comes twice as fast", () => {
  const rows = [
    { cap: cap(1), day: "d", created_at: T0, last_beat: T0 + 30_000, cap_sec: 100, settled_at: null, closed_by: null, session_id: "a" },
    { cap: cap(2), day: "d", created_at: T0, last_beat: T0 + 30_000, cap_sec: 100, settled_at: null, closed_by: null, session_id: "b" },
  ];
  // Sixty seconds used at T0+30s, forty left, two lines: twenty seconds on — before either grace (T0+120s).
  const at = (rs, now) => voiceNextAt(rs.filter((r) => r.closed_by == null), now, totalsOf(rs, now));
  assert.equal(at(rows, T0 + 30_000), T0 + 30_000 + 20_000);
  assert.equal(at([rows[0]], T0 + 30_000), T0 + 30_000 + 70_000, "one line: seventy seconds of cap left, still before its grace");
  assert.equal(at([{ ...rows[0], cap_sec: 3600 }], T0 + 30_000), T0 + 30_000 + 90_000, "plenty of cap: its grace comes first");
  assert.equal(at([{ ...rows[0], closed_by: "server", settled_at: T0 + 10 }], T0 + 30_000), null, "nothing pending");
  const due = (rs, now) => voiceDue(rs.filter((r) => r.closed_by == null), now, totalsOf(rs, now)).map((r) => r.cap);
  assert.deepEqual(due(rows, T0 + 30_000 + 20_000), [cap(1), cap(2)], "both, once the cap is spent");
  assert.deepEqual(due(rows, T0 + 30_000 + 19_000), [], "a second before it, neither");
  assert.equal(voiceCapMs(rows), 100_000);
  assert.equal(voiceCapMs([], 45), 2_700_000, "no rows: the caller's number");
  // The settled rows count (Codex, MC16-8N2A): fifty-eight minutes done, one line open — hung up two minutes in.
  const settled = { cap: cap(3), day: "d", created_at: T0 - 100 * MIN, last_beat: T0 - 42 * MIN, cap_sec: 3600, settled_at: T0 - 42 * MIN, settled_sec: 58 * 60, session_id: "c", closed_by: "server" };
  const line = { ...rows[0], cap_sec: 3600 };
  assert.equal(at([settled, line], T0 + 30_000), T0 + 30_000 + 90_000, "grace first: ninety seconds left of cap, ninety of grace");
  assert.deepEqual(due([settled, line], T0 + 2 * MIN), [cap(1)], "at two minutes the day is spent: the line is due");
  // The cap cutoff: a sweep thirty seconds late charges to the instant the cap fell,
  // for a line still beating (its grace not yet the bound).
  const beating = { ...line, last_beat: T0 + 140_000 };
  const t = totalsOf([settled, beating], T0 + 150_000);
  assert.equal(voiceCapCutoff(t, T0 + 150_000), T0 + 120_000);
  assert.equal(voiceEndFor(beating, t, T0 + 150_000), T0 + 120_000);
  assert.equal(voiceEndFor(line, totalsOf([settled, line], T0 + 150_000), T0 + 150_000), T0 + 120_000, "a line dead at its grace: the grace, which came first");
  // Two lines over by sixty seconds together: each charged to thirty seconds before now.
  const two = [settled, { ...beating, cap: cap(1) }, { ...beating, cap: cap(2) }];
  assert.equal(voiceCapCutoff(totalsOf(two, T0 + 150_000), T0 + 150_000), T0 + 60_000, "3480 + 150 + 150 = 3780: 180 over, ninety each");
  // The alarm is never moved later; an earlier one is left to fire early.
  assert.equal(voiceArmAt(null, T0), T0);
  assert.equal(voiceArmAt(T0 + 10, T0), T0, "earlier wins");
  assert.equal(voiceArmAt(T0, T0 + 10), null, "later leaves the armed one");
  assert.equal(voiceArmAt(T0, null), null);
  // Rounding happens once, at the end, and every line is fifteen seconds at
  // least (OpenAI bills the opening): two half-second lines are thirty seconds.
  const halves = [{ ...rows[0], created_at: T0, settled_at: T0 + 500, closed_by: "server" }, { ...rows[1], created_at: T0, settled_at: T0 + 500, closed_by: "server" }];
  assert.equal(voiceUsedMs(halves, T0 + 1000), 30_000);
  assert.equal(voiceUsedSec(halves, T0 + 1000), 30);
  assert.equal(voiceMinutes(voiceUsedMs(halves, T0 + 1000)), 1);
  const long = [{ ...rows[0], created_at: T0, settled_at: T0 + 20_500, closed_by: "server" }, { ...rows[1], created_at: T0, settled_at: T0 + 20_500, closed_by: "server" }];
  assert.equal(voiceUsedMs(long, T0 + 30_000), 41_000, "past the floor, the clock, unrounded until the end");
});

test("done hangs up at OpenAI: the outcome decides the row, and a transport failure is retried without moving the charge", async () => {
  const e = makeEnv();
  await reserve(e, 1);
  await station(e, "voice-bind", { cap: cap(1), session_id: "live_1" });
  await station(e, "voice-beat", { cap: cap(1), now: T0 + 60_000 });
  const lost = { closed: false, seconds: null, reason: "attach-failed: reset", retry: true };
  const done = await station(e, "voice-settle", { cap: cap(1), now: T0 + 70_000, outcome: lost });
  assert.deepEqual(done, { ok: true, minutes: 2, seconds: 70, closed_by: "retry" });
  assert.equal(row(e, 1).settled_at, T0 + 70_000, "the charge stopped at done");
  assert.equal(row(e, 1).retry_after, T0 + 70_000 + CLOSE_RETRY_MS);
  assert.equal((await station(e, "voice-check", { cap: cap(1), now: T0 + 71_000 })).live, false, "over for the page");
  assert.deepEqual((await station(e, "voice-sweep", { now: T0 + 70_000 + CLOSE_RETRY_MS - 1, outcome: lost })).closed, [], "not before its wait");
  const t2 = await station(e, "voice-sweep", { now: T0 + 70_000 + CLOSE_RETRY_MS, outcome: lost });
  assert.deepEqual([t2.closed[0].by, t2.closed[0].tries, t2.closed[0].seconds, t2.closed[0].day], ["retry", 2, 70, "2026-09-12"], "still seventy seconds");
  const t3 = await station(e, "voice-sweep", { now: row(e, 1).retry_after, outcome: lost });
  assert.deepEqual([t3.closed[0].by, t3.closed[0].tries], ["expired", CLOSE_TRIES]);
  assert.equal(row(e, 1).settled_sec, 70, "the charge never moved");
  // A close that succeeds is the server's, and gone-at-OpenAI is expired.
  const e2 = makeEnv();
  await reserve(e2, 1); await station(e2, "voice-bind", { cap: cap(1), session_id: "live_1" });
  assert.deepEqual(await station(e2, "voice-settle", { cap: cap(1), now: T0 + 5_000, outcome: { closed: true, seconds: 5, reason: "close_requested", retry: false } }),
    { ok: true, minutes: 1, seconds: 15, closed_by: "server" }, "five seconds of line is fifteen: the opening's floor");
  await reserve(e2, 2); await station(e2, "voice-bind", { cap: cap(2), session_id: "live_2" });
  assert.deepEqual(await station(e2, "voice-settle", { cap: cap(2), now: T0 + 5_000, outcome: { closed: false, seconds: null, reason: "attach-refused: 404", retry: false } }),
    { ok: true, minutes: 1, seconds: 15, closed_by: "expired" });
  // The pure decision: an unbound row expires without a try; a due retry row keeps its settle time.
  const unbound = { cap: cap(5), day: "d", created_at: T0, last_beat: T0, cap_sec: 3600, settled_sec: null, settled_at: null, session_id: null, closed_by: null, close_tries: 0, retry_after: null };
  assert.equal(voiceSweepDecide(unbound, { closed: false, retry: true }, T0 + 1).closed_by, "expired");
  assert.equal(voiceSweepDecide(unbound, { closed: false, retry: true }, T0 + 200_000, T0 + 90_000).settled_at, T0 + 90_000, "settled at the grace, not the sweep");
  assert.equal(voiceChargeSec({ ...unbound, settled_at: T0 + 90_000 }, T0 + 200_000), 90);
  const retrying = [{ ...unbound, settled_at: T0 + 10, retry_after: T0 + 50 }];
  assert.deepEqual(voiceDue(retrying, T0 + 49, totalsOf(retrying, T0 + 49)), []);
  assert.equal(voiceDue(retrying, T0 + 50, totalsOf(retrying, T0 + 50)).length, 1);
});

test("voiding gives an unopened line back; a bound or settled one cannot be voided", async () => {
  const e = makeEnv();
  await reserve(e, 1); await reserve(e, 2); await reserve(e, 3);
  assert.deepEqual(await station(e, "voice-void", { cap: cap(1) }), { ok: true });
  assert.deepEqual(await station(e, "voice-check", { cap: cap(1), now: T0 + 1 }), { ok: true, live: false, day: null }, "gone");
  assert.deepEqual(await station(e, "voice-void", { cap: cap(1) }), { ok: false, code: "unknown-session" });
  assert.deepEqual(await station(e, "voice-bind", { cap: cap(2), session_id: "live_abc" }), { ok: true });
  assert.deepEqual(await station(e, "voice-bind", { cap: cap(2), session_id: "live_other" }), { ok: true, note: "noop" }, "bound once");
  assert.deepEqual(await station(e, "voice-void", { cap: cap(2) }), { ok: false, code: "bound" });
  await station(e, "voice-settle", { cap: cap(3), now: T0 + 1 });
  assert.deepEqual(await station(e, "voice-void", { cap: cap(3) }), { ok: false, code: "bound" });
  assert.deepEqual(await station(e, "voice-bind", { cap: cap(3), session_id: "live_late" }), { ok: false, code: "settled" });
  assert.deepEqual(await station(e, "voice-bind", { cap: cap(9), session_id: "live_9" }), { ok: false, code: "unknown-session" });
  assert.deepEqual(await station(e, "voice-bind", { cap: cap(2), session_id: "" }), { ok: false, code: "bad-session-id" });
  assert.deepEqual(await station(e, "voice-beat", { cap: cap(9), now: T0 + 1 }), { ok: false, code: "unknown-session" });
});

test("a day lists its lines in order, and a relabel moves them whole", async () => {
  const e = makeEnv();
  await reserve(e, 2, { now: T0 + 5_000 }); await reserve(e, 1); await reserve(e, 3, { day: "2026-09-13" });
  assert.deepEqual((await station(e, "voice-list", { day: "2026-09-12" })).sessions.map((r) => r.cap), [cap(1), cap(2)], "by opening time");
  assert.deepEqual(await station(e, "voice-relabel", { from: "2026-09-12", to: "2026-09-11" }), { ok: true, moved: 2 });
  assert.equal((await day(e, T0 + 10_000)).used_sec, 0);
  assert.equal((await station(e, "voice-day", { day: "2026-09-11", now: T0 + 10_000 })).used_sec, 30, "two openings' floors, moved whole");
  assert.equal((await station(e, "voice-day", { day: "2026-09-13", now: T0 + 10_000 })).used_sec, 15, "another day untouched");
  assert.deepEqual(await station(e, "voice-relabel", { from: "2026-09-11", to: "2026-09-11" }), { ok: true, moved: 0 });
  assert.deepEqual(await station(e, "voice-relabel", { from: "yesterday", to: "2026-09-11" }), { ok: false, code: "bad-day" });
});

test("the shapes are checked: a bad capability, a bad day, a repeated capability", async () => {
  const e = makeEnv();
  assert.deepEqual(await reserve(e, 1, { cap: "short" }), { ok: false, code: "bad-cap" });
  assert.deepEqual(await reserve(e, 1, { day: "today" }), { ok: false, code: "bad-day" });
  assert.equal((await reserve(e, 1)).ok, true);
  assert.deepEqual(await reserve(e, 1), { ok: false, code: "exists" }, "a capability is minted once");
  assert.deepEqual(await station(e, "voice-nonsense", { cap: cap(1) }), { ok: false, code: "unknown-request" },
    "an unknown voice op falls to the request gate, which knows no such request");
});

test("the reducer is pure, and the fake runs the same one the object does", () => {
  const rows = [
    { cap: cap(1), day: "2026-09-12", created_at: T0, last_beat: T0 + 40_000, cap_sec: 3600, settled_sec: null, settled_at: null, session_id: "a", closed_by: null },
    { cap: cap(2), day: "2026-09-12", created_at: T0, last_beat: T0 + 80_000, cap_sec: 3600, settled_sec: 90, settled_at: T0 + 90_000, session_id: "b", closed_by: "server" },
  ];
  assert.equal(voiceUsedSec(rows, T0 + 60_000), 60 + 90, "the open line to now, the settled one to its settle");
  assert.equal(voiceUsedSec(rows, T0 + 400_000), 130 + 90, "the open line stops at its grace: forty seconds of beats plus ninety");
  assert.equal(voiceLive(rows[0], T0 + 130_000), true);
  assert.equal(voiceLive(rows[0], T0 + 130_001), false, "dead past the grace");
  assert.equal(voiceLive(rows[1], T0 + 1), false);
  assert.equal(voiceLive(null, T0), false);
  assert.equal(voiceDeadAt(rows[0]), T0 + 130_000);
  assert.deepEqual(voiceDue(rows, T0 + 129_999, totalsOf(rows, T0 + 129_999)), []);
  assert.deepEqual(voiceDue(rows, T0 + 130_000, totalsOf(rows, T0 + 130_000)).map((r) => r.cap), [cap(1)], "the open one, at its grace");
  // The closing step: the end is written before any I/O, and a settle after it keeps that end.
  const closing = voiceDecide("voice-closing", {}, rows, rows[0], T0 + 60_000);
  assert.deepEqual([closing.ok, closing.end_at, closing.write.settled_at, closing.write.settled_sec], [true, T0 + 60_000, T0 + 60_000, 60]);
  const after = voiceDecide("voice-settle", { outcome: { closed: true, seconds: 60, reason: "close_requested", retry: false } }, rows, closing.write, T0 + 70_000);
  assert.deepEqual([after.seconds, after.closed_by, after.write.settled_at], [60, "server", T0 + 60_000], "the end did not move while OpenAI was asked");
  assert.deepEqual(voiceDecide("voice-closing", {}, rows, closing.write, T0 + 80_000), { ok: true, note: "noop", end_at: T0 + 60_000 });
  const beatLate = voiceDecide("voice-beat", {}, rows, closing.write, T0 + 65_000);
  assert.equal(beatLate.code, "over", "a beat after the closing step is refused");
  const r = voiceDecide("voice-reserve", { cap: cap(3), day: "2026-09-12", cap_minutes: 3 }, rows, null, T0 + 60_000);
  assert.equal(r.ok, false, "150 of 180 seconds used: less than a minute left");
  assert.equal(r.code, "cap");
  const r2 = voiceDecide("voice-reserve", { cap: cap(3), day: "2026-09-12", cap_minutes: 4 }, rows, null, T0 + 60_000);
  assert.equal(r2.ok, true);
  assert.deepEqual([r2.write.cap_sec, r2.write.last_beat, r2.write.reserved_min], [240, T0 + 60_000, 0]);
});

test("the sideband close is refused without a key and reports an attach that yields no socket", { timeout: 5000 }, async () => {
  assert.deepEqual(await closeLiveSession({}, "live_1"), { closed: false, seconds: null, reason: "no-key", retry: false });
  assert.deepEqual(await closeLiveSession({ OPENAI_API_KEY: "sk" }, ""), { closed: false, seconds: null, reason: "no-session", retry: false });
  const seen = [];
  const fetcher = async (url, init) => { seen.push({ url, init }); return { status: 404, webSocket: null }; };
  const out = await closeLiveSession({ OPENAI_API_KEY: "sk-x" }, "live_1", { fetcher });
  assert.deepEqual(out, { closed: false, seconds: null, reason: "attach-refused: 404", retry: false }, "gone is gone");
  assert.equal(seen[0].url, "https://api.openai.com/v1/live/sessions/live_1/attach");
  assert.deepEqual(seen[0].init.headers, { upgrade: "websocket", authorization: "Bearer sk-x" });
  const five = await closeLiveSession({ OPENAI_API_KEY: "sk-x" }, "live_1", { fetcher: async () => ({ status: 502, webSocket: null }) });
  assert.deepEqual(five, { closed: false, seconds: null, reason: "attach-refused: 502", retry: true }, "a 5xx is worth another try");
  const thrown = await closeLiveSession({ OPENAI_API_KEY: "sk-x" }, "live_1", { fetcher: async () => { throw new Error("no route"); } });
  assert.match(thrown.reason, /attach-failed: no route/);
  assert.equal(thrown.retry, true);
  // A fetch that never answers: the one timeout covers the attach too.
  const hung = await closeLiveSession({ OPENAI_API_KEY: "sk-x" }, "live_1", { fetcher: () => new Promise(() => {}), timeoutMs: 20 });
  assert.deepEqual(hung, { closed: false, seconds: null, reason: "attach-timeout", retry: true });
  // A socket that answers session.closed: the usage comes back and the socket is closed.
  const sent = []; let closedWith = null; const listeners = {};
  const ws = {
    accept() {}, send(m) { sent.push(JSON.parse(m)); },
    addEventListener(k, fn) { listeners[k] = fn; }, close(code, why) { closedWith = [code, why]; },
  };
  const p = closeLiveSession({ OPENAI_API_KEY: "sk-x" }, "live_2", { fetcher: async () => ({ status: 101, webSocket: ws }) });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent[0].type, "session.close");
  assert.match(sent[0].event_id, /^house_close_/);
  listeners.message({ data: JSON.stringify({ type: "session.closed", reason: "close_requested", usage: { seconds: 598.4 } }) });
  assert.deepEqual(await p, { closed: true, seconds: 598, reason: "close_requested", retry: false });
  assert.deepEqual(closedWith, [1000, "closed by the house"]);
  // A socket that never answers: the timeout, not a hang.
  const ws2 = { accept() {}, send() {}, addEventListener() {}, close() {} };
  const late = await closeLiveSession({ OPENAI_API_KEY: "sk-x" }, "live_3", { fetcher: async () => ({ status: 101, webSocket: ws2 }), timeoutMs: 20 });
  assert.deepEqual(late, { closed: false, seconds: null, reason: "no-closed-event", retry: true });
});
