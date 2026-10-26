// THE ENDLESS DJ, STAGE 1: THE WATCH (MC-22, tasks/done/mc22-endless-dj.md). A cron
// every ten minutes that looks at the player (every third run while nothing
// plays), finds a session on an endless preset, works out the time left from
// the playlist's own lengths, and LOGS what it would do — a top-up, the
// ceiling, a fresh set after the session — doing none of it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch, track } from "./harness.js";

const { endlessWatch, endlessReport, parseEndless, endlessLeft } = __test;
const PL = "SAMPLEPLAYLIST00000013";
const MIN = 60_000;
// A clock near the real one, for tests that land songs: extend_endless judges
// a session's hours against the real time.
const NOW0 = Date.now() - 60 * MIN;

function env(over = {}) {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ENDLESS = JSON.stringify({ mode: "watch", dailyRuns: 12,
    presets: [{ button: 4, dj: "vibe", playlist: PL, hours: 4, topupMinutes: 20, batchMinutes: 45, ...over }] });
  return e;
}
// Ten 5-minute tracks on the endless playlist, and a player at track `at`.
function spotifyAt(player) {
  const f = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      reads++;
      const p = player.now;
      if (!p) return new Response(null, { status: 204 });
      return Response.json({ is_playing: p.playing !== false, device: { name: "Pro Plus", id: "d1" },
        context: p.pid ? { uri: `spotify:playlist:${p.pid}` } : null, progress_ms: p.progress ?? 0,
        item: { uri: `spotify:track:t${p.at}`, name: `Track t${p.at}`, artists: [{ name: "Someone" }] } });
    }
    return inner(u, init);
  };
  return { reads: () => reads, f, restore: () => { globalThis.fetch = inner; f.restore(); } };
}
const events = (e) => e.STATION.endless.log.map((r) => r.event);

test("the config: a preset, a DJ and a Spotify playlist id; defaults for the limits", () => {
  const c = parseEndless({ ENDLESS: JSON.stringify({ presets: [{ button: 4, dj: "vibe", playlist: PL }] }) });
  assert.deepEqual(c, { mode: "watch", dailyRuns: 12,
    presets: [{ button: 4, dj: "vibe", playlist: PL, hours: 4, topupMinutes: 30, batchMinutes: 45, freshMinutes: 60, noRepeatSongs: 150 }] });
  assert.equal(parseEndless({}), null);
  assert.equal(parseEndless({ ENDLESS: JSON.stringify({ presets: [{ button: 4, dj: "vibe", playlist: "not-an-id" }] }) }), null);
});

test("time left is the rest of this track and every track after it, found from where it was last seen", () => {
  const t = [["a", 300000], ["b", 200000], ["a", 300000], ["c", 100000]];
  assert.deepEqual(endlessLeft(t, "b", 50000), { idx: 1, leftMs: 150000 + 300000 + 100000, of: 4 });
  assert.equal(endlessLeft(t, "a", 0, 2).idx, 2, "a repeated record is the one at or after the last place");
  assert.equal(endlessLeft(t, "zzz", 0), null);
});

test("a session: it starts on the preset's playlist, looks each run, and would top up under twenty minutes", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  try {
    const e = env();
    let t = Date.parse("2026-09-24T02:00:00Z");
    await endlessWatch(e, t);
    assert.deepEqual(events(e), ["session-start", "look"]);
    assert.match(e.STATION.endless.log[1].detail, /track 1 of 10, 50 min left, 0 min in/);
    // Track 7 of 10, half gone: 2.5 + 15 = 17.5 minutes left — under 20.
    player.now = { pid: PL, at: 6, progress: 2.5 * MIN };
    t += 10 * MIN;
    await endlessWatch(e, t);
    assert.equal(events(e).at(-1), "would-topup");
    assert.match(e.STATION.endless.log.at(-1).detail, /18 min left: 45 min more of vibe/);
    // Once per session: the next look does not ask again.
    t += 10 * MIN;
    await endlessWatch(e, t);
    assert.equal(events(e).filter((x) => x === "would-topup").length, 1);
    // Nothing was written: stage 1 only watches.
    assert.equal((await endlessReport(e)).runs_today, "1 of 12");
  } finally { sp.restore(); }
});

test("idle, it looks every half hour and not more; a session is looked at every run", async () => {
  const player = { now: null };
  const sp = spotifyAt(player);
  try {
    const e = env();
    let t = Date.parse("2026-09-24T02:00:00Z");
    for (let i = 0; i < 6; i++) { await endlessWatch(e, t); t += 10 * MIN; }
    assert.equal(sp.reads(), 2, "an hour of quiet: two looks, not six");
    player.now = { pid: PL, at: 0 };
    await endlessWatch(e, t); t += 10 * MIN;   // due at 60 min: finds the session
    await endlessWatch(e, t); t += 10 * MIN;
    await endlessWatch(e, t);
    assert.equal(sp.reads(), 5, "then every run while it plays");
  } finally { sp.restore(); }
});

test("the session ends after two looks without it, and would make a fresh set for the next press", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  try {
    const e = env();
    let t = Date.parse("2026-09-24T02:00:00Z");
    await endlessWatch(e, t);
    player.now = { pid: "OTHERPLAYLIST000000000", at: 0 };   // switched to something else
    t += 10 * MIN; await endlessWatch(e, t);
    assert.ok(!events(e).includes("session-end"), "one miss is not the end");
    t += 10 * MIN; await endlessWatch(e, t);
    assert.deepEqual(events(e).slice(-2), ["session-end", "would-fresh"]);
    assert.deepEqual((await endlessReport(e)).sessions, []);
  } finally { sp.restore(); }
});

test("the ceiling: past four hours it never tops up, it lets the set play out", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  try {
    const e = env({ hours: 1 });
    let t = Date.parse("2026-09-24T02:00:00Z");
    await endlessWatch(e, t);
    player.now = { pid: PL, at: 8 };
    t += 61 * MIN; await endlessWatch(e, t);
    assert.equal(events(e).at(-1), "ceiling");
    assert.ok(!events(e).includes("would-topup"));
  } finally { sp.restore(); }
});

test("the day's cap stops a top-up, and a limited account is not asked at all", async () => {
  const player = { now: { pid: PL, at: 8 } };
  const sp = spotifyAt(player);
  try {
    const e = env();
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put",
      args: { doc: { day: "2026-09-23", runs: 12, sessions: {} } } }) });
    await endlessWatch(e, Date.parse("2026-09-24T02:00:00Z"));   // 19:00 Pacific on the 23rd
    assert.equal(events(e).at(-1), "day-cap");
    const t = Date.parse("2026-09-24T02:10:00Z");
    // The throttle note is read against the real clock, not the watch's.
    await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 3600e3 }));
    const before = sp.reads();
    await endlessWatch(e, t);
    assert.equal(sp.reads(), before, "no call while throttled");
    assert.equal(events(e).at(-1), "throttled");
  } finally { sp.restore(); }
});

test("list_requests reports the watch: mode, sessions and a readable log", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  try {
    const e = env();
    await endlessWatch(e, Date.parse("2026-09-24T02:00:00Z"));
    const r = await endlessReport(e);
    assert.equal(r.mode, "watch");
    assert.deepEqual(r.presets, ["4: vibe, 4 h a start"]);
    assert.equal(r.sessions.length, 1);
    assert.match(r.log[0], /Sep 23, 19:00 · 4 · session-start — vibe on Pro Plus/);
  } finally { sp.restore(); }
});

// ---- stage 2: the top-up is real ----------------------------------------------

const { callTool, endlessJobs } = __test;
const T = (n) => `spotify:track:${String(n).padStart(22, "x")}`;
function liveEnv(over = {}) {
  const e = env(over);
  e.ENDLESS = JSON.stringify({ ...JSON.parse(e.ENDLESS), mode: "live" });
  e.AUTOFULFILL_ENABLED = "true";
  e.REQUEST_ROUTINE_ID = "trig_test";
  e.REQUEST_ROUTINE_TOKEN = "routine-token";
  return e;
}
function doorbell() {
  const inner = globalThis.fetch;
  const rung = [];
  globalThis.fetch = async (u, init = {}) => {
    if (String(u).startsWith("https://api.anthropic.com/")) {
      rung.push(JSON.parse(init.body).text.replace(/^request /, "").replace(/ \(again\)$/, ""));
      return Response.json({ type: "routine_fire" });
    }
    return inner(u, init);
  };
  return { rung, restore: () => { globalThis.fetch = inner; } };
}

test("live: running low opens a job, rings the doorbell, and offers it with the DJ's recent songs to avoid", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    let t = Date.parse("2026-09-24T02:00:00Z");
    await endlessWatch(e, t);
    player.now = { pid: PL, at: 8 };
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(events(e).at(-1), "topup");
    assert.match(e.STATION.endless.log.at(-1).detail, /asked for 45 min more of vibe/);
    assert.equal(bell.rung.length, 1);
    assert.match(bell.rung[0], /^endless-4-\d+$/);
    const jobs = await endlessJobs(e);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].job_id, bell.rung[0]);
    assert.equal(jobs[0].dj, "vibe");
    assert.equal(jobs[0].minutes, 45);
    assert.equal(jobs[0].avoid.length, 10, "the playlist's ten songs are the recent list");
    assert.match(jobs[0].avoid[0], /Someone — Track t0/);
    // The song the top-up follows, so the batch does not open on its title (2026-09-27).
    assert.match(jobs[0].ends_with, /Someone — Track t9/);
    // One job at a time: the next look while it is open asks for nothing.
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(bell.rung.length, 1);
  } finally { bell.restore(); sp.restore(); }
});

test("extend_endless appends the job's songs to the playing preset, drops recent ones, and closes the job", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    let t = (NOW0 + 10 * MIN);
    await endlessWatch(e, t);
    player.now = { pid: PL, at: 8 };
    t += 10 * MIN; await endlessWatch(e, t);
    const [job] = await endlessJobs(e);
    // A recent song and a repeat in the batch are dropped, the rest land.
    const uris = ["spotify:track:t3", T(1), T(2), T(2), T(3), T(4)].map((u) =>
      u === "spotify:track:t3" ? u : u);
    await assert.rejects(callTool(e, "extend_endless", { job_id: job.job_id, uris: ["spotify:track:t3"] }, { remaining: 40 }),
      /3 to 40/);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(2), T(3), T(4)] }, { remaining: 40 });
    assert.equal(out.status, "added");
    assert.equal(out.added, 4);
    assert.deepEqual(out.dropped_as_recent, [T(2)]);
    assert.equal((await endlessJobs(e)).length, 0, "the job is closed");
    const r = await endlessReport(e);
    assert.equal(r.sessions[0].of, 14, "the watch now sees fourteen songs");
    assert.equal(r.sessions[0].pending, false);
    assert.match(r.log.at(-1), /topup-landed — 4 songs/);
    // The same job again: refused, nothing added twice.
    await assert.rejects(callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(5), T(6), T(7)] }, { remaining: 40 }),
      /no such endless job/);
    // And the recent list, which belongs to the DJ since MC-24, holds what was just added.
    // ONLY WHAT PLAYED (2026-09-25): the songs up to the one seen playing
    // (t0 to t8), not the four just added, which nobody has heard yet.
    const had = JSON.parse(e.STATION.endless.doc).history.vibe.map((h) => h[0]);
    assert.equal(had.length, 9);
    assert.ok(![T(1), T(2), T(3), T(4)].some((u) => had.includes(u)));
    void uris;
  } finally { bell.restore(); sp.restore(); }
});

test("extend_endless refuses what it must: no live endless DJ, a foreign URI, a batch of nothing but recent songs", async () => {
  const player = { now: { pid: PL, at: 8 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    await assert.rejects(callTool(env(), "extend_endless", { job_id: "x", uris: [T(1), T(2), T(3)] }, { remaining: 40 }),
      /no such endless job/);
    const e = liveEnv();
    await endlessWatch(e, Date.parse("2026-09-24T02:00:00Z"));
    const [job] = await endlessJobs(e);
    await assert.rejects(callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), "tidal:track:9"] }, { remaining: 40 }),
      /not Spotify track URIs/);
    await assert.rejects(callTool(e, "extend_endless", { job_id: job.job_id,
      uris: ["spotify:track:t1", "spotify:track:t2", "spotify:track:t3"].map((u) => u.replace(/t(\d)$/, (m, d) => `t${d}`)) }, { remaining: 40 }),
      /not Spotify track URIs|recent/);
  } finally { bell.restore(); sp.restore(); }
});

test("a job nobody answers expires after twenty-five minutes, and the next look may ask again", async () => {
  const player = { now: { pid: PL, at: 8 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    let t = Date.parse("2026-09-24T02:00:00Z");
    await endlessWatch(e, t);
    assert.equal(bell.rung.length, 1);
    t += 30 * MIN; await endlessWatch(e, t);
    assert.ok(events(e).includes("topup-expired"));
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(bell.rung.length, 2, "asked again");
  } finally { bell.restore(); sp.restore(); }
});

test("past the end: autoplay under the playlist's name is 'nothing left' — it asks at once, and a late top-up restarts the set at the new songs", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  const inner = globalThis.fetch;
  const plays = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/play" && init.method === "PUT") plays.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  try {
    const e = liveEnv();
    let t = (NOW0 + 10 * MIN);
    await endlessWatch(e, t);
    player.now = { pid: PL, at: 9 };          // the last song
    t += 10 * MIN; await endlessWatch(e, t);
    let [job] = await endlessJobs(e);
    // Nobody answers; the list runs out and the speaker's autoplay carries on
    // under the playlist's own context (measured 2026-09-23).
    t += 30 * MIN;
    player.now = { pid: PL, at: 99 };
    await endlessWatch(e, t);                 // the old job expires
    t += 10 * MIN; await endlessWatch(e, t);  // and a new one is asked for
    assert.match(e.STATION.endless.log.filter((r) => r.event === "look").at(-1).detail, /past the end: autoplay is playing/);
    [job] = await endlessJobs(e);
    assert.ok(job, "a job is open");
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.resumed_on, "Pro Plus");
    const first = plays.find((b) => b.offset?.uri);
    assert.deepEqual(first.offset, { uri: T(1) }, "the set starts again at the first new song");
    assert.equal(first.context_uri, `spotify:playlist:${PL}`);
    // The fake speaker stays on the old song, as the Pro Plus did (2026-09-26):
    // asked again by position, the first new song's place in the list, and said.
    assert.deepEqual(plays.at(-1).offset, { position: 10 });
    assert.match(e.STATION.endless.log.filter((r) => r.event === "topup-landed").at(-1).detail,
      /restarted on Pro Plus, but the speaker did not start at the first new song/);
  } finally { globalThis.fetch = inner; bell.restore(); sp.restore(); }
});

test("first seen past the end: a set that ran out before any look still asks for more (The Selector, 2026-09-27)", async () => {
  // Autoplay under the playlist's name at the very first look: no place in
  // the list was ever seen, and it used to log "track not in the list" all night.
  const player = { now: { pid: PL, at: 99 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    await endlessWatch(e, NOW0 + 10 * MIN);
    assert.deepEqual(events(e), ["session-start", "look", "topup"]);
    assert.match(e.STATION.endless.log[1].detail, /past the end: autoplay is playing/);
    assert.equal(bell.rung.length, 1);
    assert.equal((await endlessJobs(e)).length, 1, "a job is open");
  } finally { bell.restore(); sp.restore(); }
});

test("a session that began in watch mode does not block the first live top-up", async () => {
  const player = { now: { pid: PL, at: 8 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put",
      args: { doc: { day: "2026-09-23", runs: 1, lastLook: 0, sessions: { "4": { start: Date.parse("2026-09-24T01:50:00Z"), misses: 0, pending: true, idx: 7 } } } } }) });
    await endlessWatch(e, Date.parse("2026-09-24T02:00:00Z"));
    assert.equal(bell.rung.length, 1);
  } finally { bell.restore(); sp.restore(); }
});

test("songs already on the list are dropped even when the recent list never saw them, and a top-up does not read as a hand edit", async () => {
  const player = { now: { pid: PL, at: 8 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    // The live session of 2026-09-23: its list was read before the recent
    // list existed, so history is empty while the opening set is on the list.
    const tracks = Array.from({ length: 9 }, (_, i) => [`spotify:track:t${i}`, 5 * MIN, `Someone — Track t${i}`]);
    tracks.push([T(103), 5 * MIN, "Someone — Song 103"]);
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put",
      args: { doc: { day: "2026-09-23", runs: 1, lastLook: 0,
        sessions: { "4": { start: NOW0, misses: 0, pending: false, idx: 7, tracks } } } } }) });
    await endlessWatch(e, (NOW0 + 10 * MIN));
    const [job] = await endlessJobs(e);
    assert.ok(job.avoid.includes("Someone — Song 103"), "the job's avoid list names what is on the list");
    const out = await callTool(e, "extend_endless", { job_id: job.job_id,
      uris: [T(103), T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.added, 3);
    assert.deepEqual(out.dropped_as_recent, [T(103)]);
    const mark = await e.PROGRAMS.get(`mark:${PL}`, { type: "json" });
    assert.equal(mark?.n, 13, "the write mark follows the top-up");
  } finally { bell.restore(); sp.restore(); }
});

// ---- MC-22 stage 3 and MC-23: fresh sets, steering, the end is silence ----------

const uriList = (sp) => sp.f.state.contents.map((t) => t.uri);
const station = (e, op, args) => e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op, args }) });

test("after a session a fresh opening is asked for, and extend_endless replaces the list with it (a backup first)", async () => {
  // Stopped near the end (song 8 of 10): too little left to keep, so a fresh
  // opening, as before 2026-09-25.
  const player = { now: { pid: PL, at: 7 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    let t = Date.parse("2026-09-24T02:00:00Z");
    await endlessWatch(e, t);
    player.now = null;
    t += 10 * MIN; await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    assert.deepEqual(events(e).slice(-2), ["session-end", "fresh"]);
    const [job] = await endlessJobs(e);
    assert.equal(job.kind, "fresh");
    assert.equal(job.minutes, 60);
    assert.match(job.how, /REPLACES the playlist, which is not playing/);
    // Only what played is avoided (2026-09-25): t0 to t7, up to the song seen
    // last — not t8 and t9, which nobody heard.
    assert.equal(job.avoid.length, 8, "the songs heard are avoided, and only they");
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3), T(4)] }, { remaining: 40 });
    assert.equal(out.status, "fresh");
    assert.deepEqual(uriList(sp), [T(1), T(2), T(3), T(4)], "the list is the fresh set, and only it");
    assert.equal((await endlessJobs(e)).length, 0);
    assert.match(e.STATION.endless.log.at(-1).detail, /4 songs for the next press/);
    // A second session end does not ask twice while one waits: none waits now.
    // Two bells: the top-up it asked for while playing near the end (ten
    // minutes left), then the fresh opening.
    assert.equal(bell.rung.length, 2);
  } finally { bell.restore(); sp.restore(); }
});

test("Start fresh: a fresh job with a speaker replaces the list even while it plays, and starts it there", async () => {
  const player = { now: { pid: PL, at: 5 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  const inner = globalThis.fetch;
  const plays = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/play" && init.method === "PUT") plays.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  try {
    const e = liveEnv();
    const out0 = await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" });
    assert.equal(out0.status, "asked");
    const [job] = await endlessJobs(e);
    assert.match(job.how, /the house starts it on the Pro Plus as soon as it lands: nothing for you to start/);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(7), T(8), T(9)] }, { remaining: 40 });
    assert.equal(out.started_on, "Pro Plus");
    assert.deepEqual(uriList(sp), [T(7), T(8), T(9)]);
    assert.equal(plays.at(-1).context_uri, `spotify:playlist:${PL}`);
  } finally { globalThis.fetch = inner; bell.restore(); sp.restore(); }
});

// THE TAP MUST BE NEW (the owner, 2026-10-02): Hank's Start fresh waited
// on a curator that was down; had it come back hours later, Hank would have
// started on the Pro Plus with nobody there.
function ageJobs(e, ms) {
  const doc = JSON.parse(e.STATION.endless.doc);
  for (const j of Object.values(doc.jobs)) {
    j.at -= ms;
    if (j.deviceAt) j.deviceAt -= ms;
  }
  e.STATION.endless.doc = JSON.stringify(doc);
}
test("Start fresh landing more than 25 minutes after the tap: the list is replaced for the next press, and nothing starts", async () => {
  const player = { now: { pid: PL, at: 5 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  const inner = globalThis.fetch;
  const plays = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/play" && init.method === "PUT") plays.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  try {
    const e = liveEnv();
    assert.equal((await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" })).status, "asked");
    ageJobs(e, 26 * MIN);
    const [job] = await endlessJobs(e);
    assert.match(job.how, /asked too long ago to start on its own: it waits for the next press/);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(7), T(8), T(9)] }, { remaining: 40 });
    assert.equal(out.status, "fresh");
    assert.equal(out.started_on, undefined, "nothing started");
    assert.equal(plays.length, 0, "no play was sent to any speaker");
    assert.deepEqual(uriList(sp), [T(7), T(8), T(9)], "the fresh set is on the preset for the next press");
    assert.match(e.STATION.endless.log.at(-1).detail, /not started on the Pro Plus: asked too long ago/);
  } finally { globalThis.fetch = inner; bell.restore(); sp.restore(); }
});

test("a fresh set Spotify refuses to start says so, not that it was asked too long ago (the trial, 2026-10-17)", async () => {
  const player = { now: { pid: PL, at: 5 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/play" && init.method === "PUT") {
      return Response.json({ error: { status: 403, message: "Player command failed: Restriction violated", reason: "UNKNOWN" } }, { status: 403 });
    }
    return inner(u, init);
  };
  try {
    const e = liveEnv();
    assert.equal((await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" })).status, "asked");
    const [job] = await endlessJobs(e);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(7), T(8), T(9)] }, { remaining: 40 });
    assert.equal(out.status, "fresh");
    assert.equal(out.started_on, undefined);
    const log = e.STATION.endless.log.map((l) => l.detail).join("\n");
    assert.match(log, /Restriction violated/);
    assert.match(e.STATION.endless.log.at(-1).detail, /Spotify would not start it on the Pro Plus/);
    assert.doesNotMatch(e.STATION.endless.log.at(-1).detail, /asked too long ago/);
  } finally { globalThis.fetch = inner; bell.restore(); sp.restore(); }
});

test("Start fresh tapped again on a set still being made renews the tap: it starts when it lands", async () => {
  const player = { now: { pid: PL, at: 5 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" });
    ageJobs(e, 40 * MIN);
    assert.equal((await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" })).status, "asked");
    const [job] = await endlessJobs(e);
    assert.match(job.how, /the house starts it on the Pro Plus as soon as it lands: nothing for you to start/);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(7), T(8), T(9)] }, { remaining: 40 });
    assert.equal(out.started_on, "Pro Plus");
  } finally { bell.restore(); sp.restore(); }
});

test("steer, by default: what is queued after the playing song is replaced, and nothing is cut", async () => {
  const player = { now: { pid: PL, at: 3 } };
  const sp = spotifyAt(player);
  const inner = globalThis.fetch;
  const plays = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/play" && init.method === "PUT") plays.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  try {
    const e = liveEnv();
    const out = await callTool(e, "steer_endless", { words: "more upbeat", uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "steered");
    assert.equal(out.replaced, 6, "t4 to t9 were queued");
    assert.deepEqual(uriList(sp), ["t0", "t1", "t2", "t3"].map((x) => `spotify:track:${x}`).concat([T(1), T(2), T(3)]));
    assert.equal(plays.length, 0, "the playing song is not cut");
    const doc = JSON.parse(e.STATION.endless.doc);
    assert.equal(doc.sessions["4"].steer.words, "more upbeat", "later top-ups follow it");
  } finally { globalThis.fetch = inner; sp.restore(); }
});

test("steer now: the same write, and the speaker jumps to the first new song", async () => {
  const player = { now: { pid: PL, at: 3 } };
  const sp = spotifyAt(player);
  const inner = globalThis.fetch;
  const plays = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/play" && init.method === "PUT") plays.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  try {
    const e = liveEnv();
    const out = await callTool(e, "steer_endless", { words: "harder", when: "now", uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.started_on, "Pro Plus");
    assert.deepEqual(plays.at(-1).offset, { uri: T(1) });
  } finally { globalThis.fetch = inner; sp.restore(); }
});

test("a steer with no songs asks the curator, and its top-ups after carry the words", async () => {
  const player = { now: { pid: PL, at: 3 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    const out = await callTool(e, "steer_endless", { words: "no ballads" }, { remaining: 40 });
    assert.equal(out.status, "asked");
    let [job] = await endlessJobs(e);
    assert.equal(job.kind, "steer");
    assert.equal(job.steer, "no ballads");
    assert.match(job.how, /REPLACES what is queued after the playing song/);
    const land = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(land.status, "steered");
    // Later, running low: the top-up is asked in the steer's direction.
    // (The list is now t0–t3 and three new songs: about 13 minutes left.)
    await endlessWatch(e, Date.now() + 10 * MIN);
    [job] = await endlessJobs(e);
    assert.equal(job.kind, "topup");
    assert.equal(job.steer, "no ballads");
  } finally { bell.restore(); sp.restore(); }
});

// ONE TAP, ONE RUN (the owner, 2026-09-28: Change it up on Baddie's set asked
// for 25 minutes, landed them at 19:09, and the look at 19:10 found 28 left
// and topped it up — two runs for one tap). A steer asks for a top-up's worth,
// so what it lands reaches past the top-up line at the next look.
test("a steer asks the curator for a top-up's worth, so the next look does not top it up at once", async () => {
  const player = { now: { pid: PL, at: 3, progress: 4 * MIN } };   // a minute of t3 left
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv({ topupMinutes: 30 });                      // the house's line
    await callTool(e, "steer_endless", { words: "change it up" }, { remaining: 40 });
    const [job] = await endlessJobs(e);
    assert.equal(job.minutes, 45, "the preset's batchMinutes");
    // The curator makes what was asked: 200-second songs to the minutes.
    const n = Math.ceil((job.minutes * MIN) / 200_000);
    const land = await callTool(e, "extend_endless", { job_id: job.job_id,
      uris: Array.from({ length: n }, (_, i) => T(100 + i)) }, { remaining: 60 });
    assert.equal(land.status, "steered");
    await endlessWatch(e, Date.now() + 10 * MIN);
    assert.deepEqual((await endlessJobs(e)).filter((j) => j.kind === "topup"), [], "no top-up straight after the steer");
  } finally { bell.restore(); sp.restore(); }
});

test("a steer's minutes clear every house preset's top-up line, and the program on 1's", async () => {
  const { steerMinutes } = await import("../endless.js");
  const { readFileSync } = await import("node:fs");
  const house = JSON.parse(readFileSync(new URL("../house.json", import.meta.url), "utf8"));
  // A house with no endless preset (a copy's sample house) has none to check.
  for (const p of parseEndless({ ENDLESS: JSON.stringify(house.endless) })?.presets ?? []) {
    assert.ok(steerMinutes(p) >= p.topupMinutes + 15, `preset ${p.button}: ${steerMinutes(p)} against ${p.topupMinutes}`);
  }
  assert.equal(steerMinutes({ topupMinutes: 30, batchMinutes: 45 }), 45, "the program on 1, as steer_endless builds it");
  assert.equal(steerMinutes({ topupMinutes: 40, batchMinutes: 45 }), 55, "a batch too small for its line is raised");
});

test("steering the program on preset 1: by default the program plays out and the songs wait after it", async () => {
  const GUEST = "GUESTSPOTIFY0000000001";
  const player = { now: { pid: GUEST, at: 3 } };
  const sp = spotifyAt(player);
  try {
    const e = liveEnv();
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "DJ Guest", playlist: GUEST, catalog: "spotify" }]);
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "the-librarian", ref: "x", at: "2026-09-23T00:00:00Z" }));
    const before = uriList(sp);
    const out = await callTool(e, "steer_endless", { words: "more drums", uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "after-the-program");
    assert.deepEqual(uriList(sp), [...before, T(1), T(2), T(3)], "the program is intact, the songs follow it");
    const doc = JSON.parse(e.STATION.endless.doc);
    assert.equal(doc.sessions["1"].program.dj, "the-librarian");
    // Told to replace the rest, it does.
    const out2 = await callTool(e, "steer_endless", { words: "more drums", replace_rest: true, uris: [T(4), T(5), T(6)] }, { remaining: 40 });
    assert.equal(out2.status, "steered");
    assert.deepEqual(uriList(sp).slice(4), [T(4), T(5), T(6)]);
  } finally { sp.restore(); }
});

// THE PANEL SAYS WHY NOT (2026-09-28): the answer /playing gives for a set on
// 1, through the function the bar runs. Saturday's Talk set on 1 had no DJ,
// and the panel simply had no buttons.
test("the panel's steer: buttons for a DJ's set on 1, and a line saying why not for a set with none", async () => {
  const { default: worker } = await import("../worker.js");
  const { steerOf } = await import("../programs.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  const GUEST = "GUESTSPOTIFY0000000001";
  const sp = spotifyAt({ now: { pid: GUEST, at: 3 } });
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "DJ Guest", playlist: GUEST, catalog: "spotify" }]);
    const now = async () => JSON.parse(await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).text());
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ ref: "talk", at: "2026-09-26T00:00:00Z" }));
    const none = steerOf(await now());
    assert.equal(none.dj, undefined, "no buttons");
    assert.match(none.why, /^No More like this: this set was asked for without a DJ\. Ask a DJ by name/);
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "the-librarian", ref: "talk", at: "2026-09-28T00:00:00Z" }));
    const some = steerOf(await now());
    assert.equal(some.dj, "the-librarian");
    assert.match(some.rest, /^Replaces the rest of this set after the song, and The Librarian keeps going\.$/);
    assert.equal(some.why, undefined);
  } finally { sp.restore(); }
});

test("the panel's steer, as a rule: endless sets steer; Tidal on 2 and anything else off the requests presets say nothing but Tidal's line", async () => {
  const { steerOf } = await import("../programs.js");
  assert.deepEqual(steerOf({ state: "playing", who: { dj: "hank", name: "Hank", kind: "house", btn: 5, endless: true } }), { dj: "hank", rest: "" });
  assert.match(steerOf({ state: "lan", source: "Tidal", lanFrom: "preset 2, Monk", lanState: "play" }).why, /^No More like this on Tidal: only a Spotify set can be steered\.$/);
  assert.equal(steerOf({ state: "lan", source: "Tidal", lanFrom: "", lanState: "play" }), null, "Tidal from the Tidal app: not a DJ's set, nothing to say");
  assert.equal(steerOf({ state: "lan", source: "Prime", lanState: "play" }), null);
  assert.equal(steerOf({ state: "playing", who: { dj: "monk", kind: "preset", btn: 3 } }), null, "a DJ's old set on a key of the household's");
  assert.equal(steerOf({ state: "playing", from: "an album" }), null);
  assert.equal(steerOf({ state: "quiet" }), null);
  assert.equal(steerOf(null), null);
});

test("steering refuses when no endless DJ or steerable program is playing, or the named DJ is not the one playing", async () => {
  const player = { now: { pid: "0000000000000000000009", at: 3 } };
  const sp = spotifyAt(player);
  try {
    const e = liveEnv();
    await assert.rejects(callTool(e, "steer_endless", { words: "x" }, { remaining: 40 }), /steering works while/);
    player.now = { pid: PL, at: 3 };
    await assert.rejects(callTool(e, "steer_endless", { words: "x", dj: "hank" }, { remaining: 40 }), /is not the one playing/);
  } finally { sp.restore(); }
});

test("the end is silence: past the ceiling, autoplay after the last song is paused once", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  const inner = globalThis.fetch;
  const pauses = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/pause") pauses.push(url.searchParams.get("device_id"));
    return inner(u, init);
  };
  try {
    const e = liveEnv({ hours: 1 });
    let t = Date.parse("2026-09-24T02:00:00Z");
    await endlessWatch(e, t);
    player.now = { pid: PL, at: 5 };
    t += 61 * MIN; await endlessWatch(e, t);
    assert.ok(events(e).includes("ceiling"));
    player.now = { pid: PL, at: 9 };
    t += 10 * MIN; await endlessWatch(e, t);
    player.now = { pid: PL, at: 99 };          // autoplay, past the end
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(events(e).at(-1), "stopped");
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(pauses.length, 1, "once");
    assert.deepEqual(pauses, ["d1"]);
  } finally { globalThis.fetch = inner; sp.restore(); }
});

test("the bar's endless line: until the four hours end, then when the last songs run out", async () => {
  const player = { now: { pid: PL, at: 0 } };
  const sp = spotifyAt(player);
  try {
    const e = liveEnv();
    await endlessWatch(e, Date.parse("2026-09-24T02:00:00Z"));   // 19:00 Pacific
    assert.deepEqual(await __test.endlessBar(e, 4), { last: false, until: "23:00" });
    assert.equal(await __test.endlessBar(e, 5), null);
  } finally { sp.restore(); }
});

// THE HOUSE DJs ON LOADED (2026-10-24, the owner's A of docs/design/loaded-house).
test("Loaded lists the house DJs under a label, each saying what a press would do", async () => {
  const { default: worker } = await import("../worker.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  const player = { now: { pid: PL, at: 2 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    await endlessWatch(e, Date.now());
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}`), e)).text();
    assert.match(page, /<h2 class="hlabel" id="zhouse">House DJs<\/h2>/);
    assert.match(page, /data-hplay="4"/, "the house DJ playing, for the live script");
    // Playing: the bars, how long it goes on, no ▶ (the bar has the pause).
    assert.match(page, /<li class="hrow playing" data-btn="4">[^]*?<span class="hname"><span class="plv"[^]*?Vibe<\/span><span class="hdoes">Endless until \d\d:\d\d<\/span><span class="hmore">The hour decides: the (morning|room|small hours) now<\/span><\/a>\s*<span class="bside"><\/span>/);
    const rows = page.slice(page.indexOf('<ul class="hlist"'), page.indexOf("</ul>", page.indexOf('<ul class="hlist"')));
    assert.doesNotMatch(rows, /Track t2/, "the song is the bar's to say, not the row's");
  } finally { sp.restore(); bell.restore(); }
});

test("a house DJ not playing: the next press from the log, and ▶ plays their list as it stands", async () => {
  const { default: worker } = await import("../worker.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  const sp = spotifyAt({ now: null });
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.DJ_TUNING = JSON.stringify({ vibe: { mood: "late" } });
    await station(e, "endless-log", { events: [{ at: Date.now() - 60000, btn: 4, event: "kept", detail: "13 unplayed songs (50 min) kept: the next press carries on" }] });
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}`), e)).text();
    assert.match(page, /<li class="hrow" data-btn="4">[^]*?<span class="hdoes">Carries on: 13 songs kept \(50 min\)<\/span><span class="hmore"><i class="tdot" aria-hidden="true"><\/i>Tuned: always the small hours<\/span>/);
    assert.match(page, /<form method="post" action="\/buttons\/abcdefabcdefabcdefabcdef\/vibe\/endless" class="bplay"><input type="hidden" name="do" value="start">/);
    assert.match(page, /data-hplay=""/);
  } finally { sp.restore(); }
});

test("a house DJ the house knows nothing recent of: what they play", async () => {
  const { default: worker } = await import("../worker.js");
  const { WHICH } = await import("../djs.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  const sp = spotifyAt({ now: null });
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}`), e)).text();
    assert.ok(page.includes(`<span class="hdoes">${WHICH.vibe.field}</span>`));
  } finally { sp.restore(); }
});

test("what a press plays next, and Vibe's hour, in words", async () => {
  const { nextPressWords, vibeHourWords } = await import("../endless.js");
  const kept = { btn: 5, event: "kept", detail: "18 unplayed songs (63 min) kept: the next press carries on" };
  assert.equal(nextPressWords({}, 5, [kept]), "Carries on: 18 songs kept (63 min)");
  assert.equal(nextPressWords({}, 5, [kept, { btn: 5, event: "fresh-landed", detail: "19 songs for the next press" }]), "A fresh set: 19 songs");
  assert.equal(nextPressWords({}, 5, [kept, { btn: 5, event: "session-start" }]), null, "a newer session leaves the old keep behind");
  assert.equal(nextPressWords({}, 5, [], 14), "14 songs waiting");
  assert.equal(nextPressWords({ jobs: { a: { btn: 5, kind: "fresh" } } }, 5, [kept]), "A fresh set is being made");
  assert.equal(nextPressWords({ sessions: { 5: {} } }, 5, [kept]), "Carries on where it stopped");
  assert.equal(nextPressWords({}, 5, [{ btn: 4, event: "kept", detail: "9 unplayed songs (30 min)" }]), null, "another preset's log is not this one's");
  const tz = { HOUSE_TZ: "America/Los_Angeles" };
  assert.equal(vibeHourWords(tz, Date.parse("2026-10-24T06:10:00Z")), "The hour decides: the small hours now"); // 23:10
  assert.equal(vibeHourWords(tz, Date.parse("2026-10-24T15:00:00Z")), "The hour decides: the morning now"); // 08:00
  assert.equal(vibeHourWords(tz, Date.parse("2026-10-24T20:00:00Z")), "The hour decides: the room now"); // 13:00
});

// TUNING (MC-32 2a): Apply while the DJ plays keeps the dials and turns what
// is queued, as Change it up does; the job carries the tuning words.
test("Tune's Apply while the DJ plays keeps the dials, files a steer, and the job carries the tuning", async () => {
  const { default: worker } = await import("../worker.js");
  const { makeHouseStore } = await import("./harness.js");
  const { withSettings } = await import("../settings.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  const player = { now: { pid: PL, at: 2 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.HOUSE = (await makeHouseStore()).binding;
    await e.PROGRAMS.put("house:claimed", "2026-10-23T00:00:00Z");
    await endlessWatch(e, Date.now());
    // While Vibe plays, the header's two turns, and Start fresh in More
    // ("A DJ's Page, Calmer", 2026-10-24); the sheet applies after the song (MC-32 2b).
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe`), e, { waitUntil() {} })).text();
    assert.match(page, /<div class="calmacts">[^]*?value="more"><button class="lanebtn" type="submit">More like this<\/button>[^]*?value="change"><button class="calmout" type="submit">Change it up<\/button><\/form>/);
    assert.match(page, /<div class="tvsheet msheet" id="more">[^]*?<button class="mrow" type="submit" form="endfresh" name="do" value="fresh">/);
    assert.match(page, /<button type="submit" class="tvapply">Apply after this song<\/button>/);
    // One Tune on the page, in the Tuning row beside Reset (2026-10-24).
    assert.equal((page.match(/data-tune-open>/g) ?? []).length, 1);
    assert.match(page, /<section class="block tuning"[^]*?data-tune-open/);
    const body = new FormData();
    body.set("do", "apply"); body.set("same", "sometimes"); body.set("mood", "late");
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/tune`, { method: "POST", body,
      headers: { accept: "application/json" } }), e, { waitUntil() {} });
    const said = await r.json();
    assert.equal(said.code, "applied");
    assert.equal(said.summary, "the same artist now and then, always the small hours");
    const jobs = await endlessJobs(await withSettings(e, null));
    assert.equal(jobs[0].kind, "steer");
    assert.match(jobs[0].steer, /^New tuning from the listener: the same artist now and then, always the small hours\./);
    assert.match(jobs[0].tuning, /MOOD: always THE SMALL HOURS/);
    assert.match(jobs[0].tuning, /no act more than twice an hour/);
  } finally { sp.restore(); bell.restore(); }
});

test("the DJ page: an endless block with Start fresh, and More like this / Change it up while it plays", async () => {
  const { default: worker } = await import("../worker.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  const player = { now: { pid: PL, at: 2 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
    await endlessWatch(e, Date.now());
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe`), e)).text();
    // Said once ("A DJ's Page, Calmer", 2026-10-24): the header's one line
    // says house DJ, the preset, how long it goes on and where; the bar the song.
    assert.match(page, /<p class="vload"><span class="vtag"><span class="plv" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span>House DJ · preset 4 · endless until \d\d:\d\d<span data-djdev="vibe"> · Pro Plus<\/span><\/span><\/p>/);
    assert.doesNotMatch(page, /class="endsong"/);
    assert.doesNotMatch(page, /class="endnow"/, "nothing happening but the music: no line under the header");
    assert.match(page, /value="change"/);
    assert.match(page, /open\.spotify\.com\/playlist\/SAMPLEPLAYLIST00000013/);
    const post = (fields) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/endless`, {
      method: "POST", body: new URLSearchParams(fields) }), e);
    const r = await post({ do: "change" });
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), /endless=change-asked/);
    let jobs = await endlessJobs(e);
    assert.equal(jobs[0].kind, "steer");
    assert.match(jobs[0].steer, /Change it up/);
    assert.equal(jobs[0].minutes, 45, "a top-up's worth, as the tool's steer asks");
    const f = await post({ do: "fresh", device: "Ultra" });
    assert.match(f.headers.get("location"), /endless=fresh-asked&on=Ultra/);
    jobs = await endlessJobs(e);
    assert.ok(jobs.some((j) => j.kind === "fresh" && /the house starts it on the Ultra/.test(j.how)));
    const back = await (await worker.fetch(new Request(`https://x.test${f.headers.get("location")}`), e)).text();
    assert.match(back, /A fresh set of Vibe is being made\. It starts on the Ultra in a few minutes\./);
    // Hank is not a house DJ here: no block, and the route refuses.
    const hank = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/hank`), e)).text();
    assert.doesNotMatch(hank, /House DJ · preset/);
    assert.equal((await worker.fetch(new Request(`https://x.test/buttons/${KEY}/hank/endless`, { method: "POST", body: "do=fresh" }), e)).status, 404);
  } finally { bell.restore(); sp.restore(); }
});

test("the DJ page says when the day's runs are used up", async () => {
  const { default: worker } = await import("../worker.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  const sp = spotifyAt({ now: null });
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    const day = __test.houseDay(e, Date.now());
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put",
      args: { doc: { day, runs: 12, lastLook: 0, sessions: {} } } }) });
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe`), e)).text();
    assert.match(page, /Today's 12 DJ runs are used up\. The next press plays the last set again\. New songs again after midnight\./);
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put",
      args: { doc: { day, runs: 3, lastLook: 0, sessions: {} } } }) });
    const ok = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe`), e)).text();
    assert.doesNotMatch(ok, /used up/);
  } finally { sp.restore(); }
});

// ---- Codex's review, 2026-09-24 ------------------------------------------------

test("a new program on preset 1 ends the old program's steer, and its jobs land nowhere", async () => {
  const GUEST = "GUESTSPOTIFY0000000001";
  const player = { now: { pid: GUEST, at: 3 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "DJ Guest", playlist: GUEST, catalog: "spotify" }]);
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "the-librarian", ref: "a", at: "2026-09-23T00:00:00Z" }));
    await callTool(e, "steer_endless", { words: "more drums", replace_rest: true }, { remaining: 40 });
    const [job] = await endlessJobs(e);
    assert.equal(job.kind, "steer");
    // Program B goes on preset 1 before the songs are made.
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "the-librarian", ref: "b", at: "2026-09-24T00:00:00Z" }));
    const before = uriList(sp);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "program-changed");
    assert.deepEqual(uriList(sp), before, "nothing written into program B");
  } finally { bell.restore(); sp.restore(); }
});

test("the now panel's More like this on a DJ's request set on preset 1 replaces the rest after the song, naming it (2026-09-27)", async () => {
  const GUEST = "GUESTSPOTIFY0000000001";
  const player = { now: { pid: GUEST, at: 3 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  const { default: worker } = await import("../worker.js");
  const KEY = "abcdefabcdefabcdefabcdef";
  try {
    const e = liveEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "DJ Guest", playlist: GUEST, catalog: "spotify" }]);
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "the-librarian", ref: "x", at: "2026-09-27T00:00:00Z" }));
    const post = (dj, body) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/${dj}/endless`, { method: "POST",
      body: new URLSearchParams(body), headers: { origin: "https://x.test", accept: "application/json" } }), e).then((r) => r.json());
    // Somebody else's set is not steered from the Librarian's button (the Professor's until he
    // was cut, 2026-10-15), and nothing is filed.
    assert.deepEqual(await post("hank", { do: "more" }), { ok: false, code: "not-playing" });
    assert.equal((await endlessJobs(e)).length, 0);
    assert.deepEqual(await post("the-librarian", { do: "more" }), { ok: true, code: "asked" });
    const [job] = await endlessJobs(e);
    assert.equal(job.kind, "steer");
    assert.equal(job.preset, 1);
    assert.equal(job.dj, "the-librarian");
    assert.match(job.steer, /^More like what is playing now: "Track t3" by Someone/);
    assert.match(job.how, /REPLACES what is queued after the playing song/, "the rest of the set, not after it");
    assert.equal(bell.rung.length, 1);
  } finally { bell.restore(); sp.restore(); }
});

test("the watch ends a steer whose program was replaced", async () => {
  const GUEST = "GUESTSPOTIFY0000000001";
  const player = { now: { pid: GUEST, at: 3 } };
  const sp = spotifyAt(player);
  try {
    const e = liveEnv();
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "DJ Guest", playlist: GUEST, catalog: "spotify" }]);
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "the-librarian", ref: "a", at: "2026-09-23T00:00:00Z" }));
    await callTool(e, "steer_endless", { words: "more drums", uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "the-librarian", ref: "b", at: "2026-09-24T00:00:00Z" }));
    await endlessWatch(e, Date.now());
    assert.ok(events(e).includes("program-changed"));
    assert.equal(JSON.parse(e.STATION.endless.doc).sessions["1"], undefined);
  } finally { sp.restore(); }
});

test("a new day clears yesterday's cap on a session that runs past midnight", async () => {
  const player = { now: { pid: PL, at: 8 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    await station(e, "endless-put", { doc: { day: "2000-01-01", runs: 12, lastLook: 0,
      sessions: { "4": { start: NOW0, misses: 0, pending: true, dayCapped: true, idx: 7 } } } });
    await endlessWatch(e, NOW0 + 10 * MIN);
    assert.equal(events(e).at(-1), "topup", "today has runs, so it asks");
  } finally { bell.restore(); sp.restore(); }
});

test("a top-up that lands after the music stopped writes nothing", async () => {
  const player = { now: { pid: PL, at: 8 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    await endlessWatch(e, NOW0 + 10 * MIN);
    const [job] = await endlessJobs(e);
    player.now = null;
    const before = uriList(sp);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "not-playing");
    assert.deepEqual(uriList(sp), before);
    assert.equal((await endlessJobs(e)).length, 0);
  } finally { bell.restore(); sp.restore(); }
});

// ---- 2026-09-25: only what played is remembered; leftovers kept for the day ----

test("a session stopped with enough left keeps it until it is played: the heard songs are cut from the top, no run is spent, and days later the press carries on", async () => {
  const player = { now: { pid: PL, at: 2 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    const e = liveEnv();
    let t = Date.parse("2026-09-24T02:00:00Z");      // 19:00 Pacific, the 23rd
    await endlessWatch(e, t);
    player.now = null;
    t += 10 * MIN; await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    assert.deepEqual(events(e).slice(-2), ["session-end", "kept"]);
    assert.match(e.STATION.endless.log.at(-1).detail, /7 unplayed songs \(35 min\) kept: the next press carries on/);
    assert.equal((await endlessJobs(e)).length, 0, "no fresh set asked");
    assert.equal(bell.rung.length, 0, "and no curator woken");
    const doc = JSON.parse(e.STATION.endless.doc);
    assert.equal(doc.runs ?? 0, 0, "no DJ run spent");
    assert.deepEqual(uriList(sp), Array.from({ length: 7 }, (_, i) => `spotify:track:t${i + 3}`),
      "the list now starts after the song that was playing");
    assert.deepEqual(doc.history.vibe.map((h) => h[0]), ["spotify:track:t0", "spotify:track:t1", "spotify:track:t2"],
      "only the songs heard are remembered");
    // Three days on, idle looks all the while: nothing is asked, nothing replaced.
    for (const day of ["2026-09-24T15:00:00Z", "2026-09-25T15:00:00Z", "2026-09-26T15:00:00Z"]) await endlessWatch(e, Date.parse(day));
    assert.equal((await endlessJobs(e)).length, 0);
    assert.equal(bell.rung.length, 0);
    assert.deepEqual(uriList(sp), Array.from({ length: 7 }, (_, i) => `spotify:track:t${i + 3}`), "the kept songs wait");
    // Pressed on the 26th: it plays on from t3, and stopped again with six left, keeps them again.
    player.now = { pid: PL, at: 3 };
    t = Date.parse("2026-09-27T02:00:00Z"); await endlessWatch(e, t);
    player.now = null;
    t += 10 * MIN; await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(events(e).at(-1), "kept");
    assert.equal(uriList(sp).length, 6);
  } finally { bell.restore(); sp.restore(); }
});

test("four songs left asks for more even with minutes to spare, as a set skipped through runs out between looks (2026-09-26)", async () => {
  const player = { now: { pid: PL, at: 3 } };
  const sp = spotifyAt(player);
  const bell = doorbell();
  try {
    // A five-minute threshold, so only the songs can trigger it.
    const e = liveEnv({ topupMinutes: 5 });
    let t = NOW0 + 10 * MIN;
    await endlessWatch(e, t);
    assert.ok(!events(e).includes("topup"), "six songs left: not yet");
    player.now = { pid: PL, at: 6 };
    t += 10 * MIN; await endlessWatch(e, t);
    assert.ok(events(e).includes("topup"), "three songs left: asked, whatever the minutes");
  } finally { bell.restore(); sp.restore(); }
});
