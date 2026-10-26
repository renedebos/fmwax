// THE ENDLESS LANE, STAGE 1 (MC-27, tasks/done/mc27-endless-lane.md): one house
// playlist any DJ takes over. This stage is the ground it stands on, from
// Codex's review of the plan: the lane starts empty and is not watched until
// someone is in it; a takeover resets everything about it in one step and
// raises its tenancy; every writer filed under an old tenancy lands nowhere;
// the lane is outside MC-24's swaps; and preset 7 resolves to Endless.

import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { endlessFile, endlessHow } from "../endless.js";
import { PERSONAS } from "../djs.js";
import { HOUSE_CACHE } from "../house.js";
import { makeEnv, installFetch, track } from "./harness.js";

const { endlessWatch, endlessJobs, parseEndless, endlessLaneTakeover, endlessUpdate, endlessLoad,
  endlessSlots, endlessAssign, presetOnFile, callTool } = __test;
const P4 = "SAMPLEPLAYLIST00000013", LANE = "SAMPLEPLAYLIST00000018";
const MIN = 60_000;
const T = (n) => `spotify:track:${String(n).padStart(22, "0")}`;

function env() {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  // Preset 4 is Dr. Funkenstein's, as in the house, since Monk was cut
  // (2026-10-15); the guest Camille played here is Gatefold.
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 4, dj: "dr-funkenstein", playlist: P4 },
    { button: 7, lane: true, playlist: LANE },
  ] });
  e.AUTOFULFILL_ENABLED = "true";
  e.REQUEST_ROUTINE_ID = "trig_test";
  e.REQUEST_ROUTINE_TOKEN = "routine-token";
  return e;
}
// Ten 5-minute tracks, and a player on `pid` at track `at`.
function spotifyAt(player) {
  const f = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (String(u).startsWith("https://api.anthropic.com/")) return Response.json({ type: "routine_fire" });
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      const p = player.now;
      if (!p) return new Response(null, { status: 204 });
      return Response.json({ is_playing: true, device: { name: "Pro Plus", id: "d1" },
        context: { uri: `spotify:playlist:${p.pid}` }, progress_ms: 0,
        item: { uri: `spotify:track:t${p.at}`, name: `Track t${p.at}`, artists: [{ name: "Someone" }] } });
    }
    return inner(u, init);
  };
  return { f, restore: () => { globalThis.fetch = inner; f.restore(); } };
}
// A takeover whose songs are on, as playEndless leaves it after its copy.
const take = (e, dj) => endlessUpdate(e, (st) => {
  const r = endlessLaneTakeover(e, parseEndless(e), st, { dj, now: Date.now() });
  if (r.ok && st.lane) st.lane.ready = true;
  return r.ok ? r : { abort: true, ...r };
});
const events = (e) => e.STATION.endless.log.map((r) => r.event);

test("the config: the lane has no DJ, and an empty lane is not watched", async () => {
  const e = env();
  const c = parseEndless(e);
  assert.equal(c.presets[1].lane, true);
  assert.equal(c.presets[1].dj, null);
  const sp = spotifyAt({ now: { pid: LANE, at: 1 } });
  try {
    await endlessWatch(e, Date.now() - 30 * MIN);
    assert.ok(!events(e).includes("session-start"), "nobody in the lane: no session");
  } finally { sp.restore(); }
});

test("the lane is outside MC-24: not a slot, not a swap partner, not a place to put anyone", async () => {
  const e = env();
  await take(e, "gatefold");
  const st = await endlessLoad(e);
  assert.deepEqual(endlessSlots(e, parseEndless(e), st).map((p) => p.button), [4], "only the fixed preset");
  assert.equal((await endlessAssign(e, { dj: "hank", button: 7 })).status, "no-slot");
});

test("a takeover resets the lane in one step and raises its tenancy; a DJ with a fixed preset is refused", async () => {
  const e = env();
  const a = await take(e, "gatefold");
  assert.equal(a.tenancy, 1);
  // A session and a job on the lane, as the watch would leave them.
  await endlessUpdate(e, (st) => {
    st.sessions["7"] = { start: Date.now(), misses: 0, tracks: [] };
    st.jobs.x = { id: "x", btn: 7, kind: "topup", dj: "gatefold" };
    st.queued["7"] = { dj: "hank" };
    return {};
  });
  const b = await take(e, "hank");
  assert.equal(b.tenancy, 2);
  const st = await endlessLoad(e);
  assert.equal(st.lane.dj, "hank");
  assert.equal(st.sessions["7"], undefined, "the old session is retired");
  assert.equal(st.jobs.x, undefined, "its jobs are gone");
  assert.equal(st.queued["7"], undefined);
  assert.ok(Number(st.gen["7"]) >= 2, "a new generation");
  const refused = await take(e, "dr-funkenstein");
  assert.equal(refused.status, "has-preset", "Dr. Funkenstein has preset 4: one DJ, one endless set");
});

test("a job filed under the old tenancy lands nowhere, even for the same DJ taken over again", async () => {
  const sp = spotifyAt({ now: { pid: LANE, at: 8 } });
  try {
    const e = env();
    await take(e, "gatefold");
    let t = Date.now() - 30 * MIN;
    await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    const [job] = (await endlessJobs(e)).filter((j) => j.preset === 7);
    assert.ok(job, "a top-up was asked for the lane");
    const doc = await endlessLoad(e);
    assert.equal(doc.jobs[job.job_id].tenancy, 1, "filed under tenancy 1");
    // Taken over (by the same DJ) before the curator answers: the job is gone
    // with the takeover. Put it back as a stale answer would find it.
    const stale = doc.jobs[job.job_id];
    await take(e, "gatefold");
    await endlessUpdate(e, (st) => { st.jobs[stale.id] = stale; return {}; });
    const before = sp.f.state.contents.length;
    const out = await callTool(e, "extend_endless", { job_id: stale.id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "lane-moved");
    assert.equal(sp.f.state.contents.length, before, "nothing was written");
  } finally { sp.restore(); }
});

test("a DJ in the lane put on a fixed preset leaves the lane — not while the lane plays them", async () => {
  const e = env();
  await take(e, "gatefold");
  await endlessUpdate(e, (st) => { st.sessions["7"] = { start: Date.now(), misses: 0 }; return {}; });
  assert.equal((await endlessAssign(e, { dj: "gatefold", button: 4 })).status, "in-lane");
  await endlessUpdate(e, (st) => { delete st.sessions["7"]; return {}; });
  const out = await endlessAssign(e, { dj: "gatefold", button: 4 });
  assert.equal(out.status, "done");
  const st = await endlessLoad(e);
  assert.equal(st.lane.dj, null, "the lane is empty again");
  assert.equal(st.assign["4"].dj, "gatefold");
});

test("preset 7 resolves to Guest DJ, not to the old alias for the number", () => {
  const e = env();
  e.PLAYLIST_ALIASES = JSON.stringify({ "was button 7": "SAMPLEPLAYLIST00000015" });
  assert.deepEqual(presetOnFile(e, 7), { id: LANE, name: "Guest DJ", via: "the guest DJ slot", catalog: "spotify" });
});

test("a takeover that lands after the claim, just before the write, is caught at the write", async () => {
  const player = { now: { pid: LANE, at: 8 } };
  const sp = spotifyAt(player);
  const e = env();
  try {
    await take(e, "gatefold");
    let t = Date.now() - 30 * MIN;
    await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    const [job] = (await endlessJobs(e)).filter((j) => j.preset === 7);
    // The next player read is extend_endless's own, after its claim: the
    // lane changes hands right then.
    const inner = globalThis.fetch;
    let armed = true;
    globalThis.fetch = async (u, init = {}) => {
      if (armed && new URL(String(u)).pathname === "/v1/me/player") { armed = false; await take(e, "hank"); }
      return inner(u, init);
    };
    const before = sp.f.state.contents.length;
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    globalThis.fetch = inner;
    assert.equal(armed, false, "the takeover ran mid-call");
    assert.equal(out.status, "lane-moved");
    assert.equal(sp.f.state.contents.length, before, "nothing was appended to Hank's lane");
  } finally { sp.restore(); }
});

// ---- stage 2: Play endless -------------------------------------------------------

const { playEndless } = __test;
async function seedProgram(e, slug, dj, uris, created = "2026-09-20T10:00:00Z") {
  await e.PROGRAMS.put(`program:${slug}`, JSON.stringify({ slug, title: `A ${dj} set`, dj, created,
    sections: [{ tracks: uris.map((uri) => ({ uri, title: uri, artist: "X" })) }] }),
    { metadata: { title: `A ${dj} set`, dj, created, tracks: uris.length, runtime: "40:00", catalog: "spotify" } });
}
const PROG = [T(11), T(12), T(13), T(14)];

test("Play endless: a DJ on a fixed preset plays their own; anyone else takes the lane and starts at once from their newest program, no run spent", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
    const own = await playEndless(e, { dj: "dr-funkenstein", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(own.status, "own-preset");
    assert.equal(own.button, 4);
    await seedProgram(e, "gatefold-one", "Gatefold", PROG);
    const r = await playEndless(e, { dj: "gatefold", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(r.status, "started");
    assert.equal(r.button, 7);
    assert.deepEqual(sp.f.state.contents.map((t) => t.uri), PROG, "the program is what the lane holds");
    const st = await endlessLoad(e);
    assert.equal(st.lane.dj, "gatefold");
    assert.equal(st.lane.program.slug, "gatefold-one");
    assert.equal(st.runs ?? 0, 0, "no DJ run for a start from the Shelf");
    assert.deepEqual(st.history?.gatefold ?? [], [], "nothing counts as heard until it plays");
    // Again, stopped: it carries on, and nothing is copied.
    const again = await playEndless(e, { dj: "gatefold", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(again.status, "carry-on");
  } finally { sp.restore(); }
});

test("Play endless: a DJ with nothing on the Shelf gets an opening made, filed under the lane's tenancy with the speaker", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    const r = await playEndless(e, { dj: "americana", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(r.status, "making");
    const [job] = (await endlessJobs(e)).filter((j) => j.preset === 7);
    assert.equal(job.kind, "fresh");
    const st = await endlessLoad(e);
    const raw = st.jobs[job.job_id];
    assert.equal(raw.device, "Pro Plus");
    assert.equal(raw.tenancy, st.lane.tenancy);
    assert.equal(st.runs, 1, "an opening costs one run");
  } finally { sp.restore(); }
});

test("Play endless supersedes a steered program on the Spotify guest and closes its work", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "DJ Guest", playlist: "SAMPLEPLAYLIST00000024", catalog: "spotify" }]);
    const g = __test.guestFor(e, "spotify");
    assert.ok(g?.live, "a live Spotify guest");
    await endlessUpdate(e, (st) => {
      st.sessions[String(g.btn)] = { start: Date.now(), misses: 0, program: { dj: "hank" } };
      st.jobs.s = { id: "s", btn: g.btn, kind: "steer", dj: "hank" };
      return {};
    });
    await seedProgram(e, "gatefold-one", "Gatefold", PROG);
    assert.equal((await playEndless(e, { dj: "gatefold", device: "Pro Plus", budget: { remaining: 40 } })).status, "started");
    const st = await endlessLoad(e);
    assert.equal(st.sessions[String(g.btn)], undefined);
    assert.equal(st.jobs.s, undefined);
    assert.ok(Number(st.superseded?.[String(g.btn)]) > 0, "the moment it was superseded is kept (review 3)");
  } finally { sp.restore(); }
});

test("the tool plays endless and says so in one line", async () => {
  // The player reads back the lane playing, as a start that took would.
  const sp = spotifyAt({ now: { pid: LANE, at: 1 } });
  try {
    const e = env();
    await seedProgram(e, "gatefold-one", "Gatefold", PROG);
    const out = await callTool(e, "play_endless", { dj: "Gatefold", device: "Pro Plus" }, { remaining: 40 });
    assert.equal(out.status, "started");
    assert.equal(out.preset, 7);
    // The harness's player names another device id, so the read-back cannot
    // confirm the start: the line then says so, which is the honest answer.
    assert.match(out.said, /Gatefold is the guest DJ on the Pro Plus|the Pro Plus is not playing it/);
  } finally { sp.restore(); }
});

// ---- stage 3: handing the lane over -------------------------------------------------

async function gatefoldPlaying(e, sp, player) {
  await seedProgram(e, "gatefold-one", "Gatefold", [T(1), T(2), T(3), T(4)]);
  await seedProgram(e, "hank-less", "The Librarian", [T(21), T(22), T(23)]);
  sp.f.state.contents = Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN }));
  await take(e, "gatefold");
  player.now = { pid: LANE, at: 2 };
  await endlessWatch(e, Date.now() - 20 * MIN); // the watch sees Gatefold playing: a session
}

test("the lane playing another DJ: Play endless asks first; 'now' takes it at once", async () => {
  const player = { now: null };
  const sp = spotifyAt(player);
  try {
    const e = env();
    await gatefoldPlaying(e, sp, player);
    const ask = await playEndless(e, { dj: "the-librarian", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(ask.status, "busy");
    assert.equal(ask.current, "gatefold");
    assert.equal((await endlessLoad(e)).lane.dj, "gatefold", "nothing changed by asking");
    const now = await playEndless(e, { dj: "the-librarian", device: "Pro Plus", budget: { remaining: 40 }, when: "now" });
    assert.equal(now.status, "started");
    assert.deepEqual(sp.f.state.contents.map((t) => t.uri), [T(21), T(22), T(23)]);
  } finally { sp.restore(); }
});

test("'after this song' keeps the playing song and what came before as the leaving DJ's, and queues the new one after it", async () => {
  const player = { now: null };
  const sp = spotifyAt(player);
  try {
    const e = env();
    await gatefoldPlaying(e, sp, player);
    const r = await playEndless(e, { dj: "the-librarian", device: "Pro Plus", budget: { remaining: 40 }, when: "next" });
    assert.equal(r.status, "next");
    assert.deepEqual(sp.f.state.contents.map((t) => t.uri),
      ["spotify:track:t0", "spotify:track:t1", "spotify:track:t2", T(21), T(22), T(23)],
      "the head to the playing song, then the Librarian's opening");
    const st = await endlessLoad(e);
    assert.equal(st.lane.dj, "the-librarian");
    assert.equal(st.lane.head, 3);
    assert.deepEqual(st.history.gatefold.map((h) => h[0]), ["spotify:track:t0", "spotify:track:t1", "spotify:track:t2"],
      "Gatefold's heard songs are Gatefold's");
    // The watch, next: the Librarian's session counts nothing of Gatefold's head.
    player.now = { pid: LANE, at: 2 };
    await endlessWatch(e, Date.now() - 5 * MIN);
    assert.deepEqual((await endlessLoad(e)).history?.["the-librarian"] ?? [], [], "the head is not the Librarian's");
  } finally { sp.restore(); }
});

// ---- stage 4: the pages --------------------------------------------------------------

import worker from "../worker.js";
const KEY = "abcdefabcdefabcdefabcdef";
const page = async (e, path) => (await worker.fetch(new Request(`https://x.test${path}`), e)).text();

test("the pages: Play endless on a DJ without a preset; the lane's DJ gets the endless block instead; the DJs tab has a ▶ on every square", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Master Bedroom"]);
    const lib = await page(e, `/buttons/${KEY}/the-librarian`);
    assert.ok(lib.includes('<input type="hidden" name="do" value="lane">'), "the Librarian's page offers Play endless");
    assert.ok(lib.includes(">Play endless</button>"));
    const funk = await page(e, `/buttons/${KEY}/dr-funkenstein`);
    assert.ok(!funk.includes('class="laneform"'), "Dr. Funkenstein has preset 4: no lane pill");
    await take(e, "the-librarian");
    const mine = await page(e, `/buttons/${KEY}/the-librarian`);
    assert.ok(!mine.includes('class="laneform"'), "the lane is hers: the pill gives way to the guest DJ's own buttons");
    // Said once in the header, with Play and More ("A DJ's Page, Calmer", 2026-10-24).
    assert.match(mine, /<span class="vtag">Guest DJ · preset 7 · /);
    assert.match(mine, /<div class="calmacts"><button class="lanebtn" type="submit" form="endfresh" name="do" value="start">/);
    const deck = await page(e, `/buttons/${KEY}/djs`);
    assert.ok(deck.includes('class="dplay"'), "a ▶ on the squares");
    assert.ok(deck.includes('aria-label="Play Gatefold endless on the Pro Plus"'));
    assert.match(deck, /aria-label="Open The Librarian — the guest DJ"/);
    // Its square says 7, as Loaded and Speakers do (the review, 2026-09-26).
    assert.match(deck, /aria-label="Open The Librarian — the guest DJ"[\s\S]*?<span class="dtile num" aria-hidden="true">7<\/span>/);
    assert.ok(!deck.includes(">∞</span>"));
    // The help says each role in plain words, with this house's numbers (the owner, 2026-10-09).
    assert.match(deck, /<b>House DJs<\/b> \(preset 4\) each have a preset that works like their own radio station/);
    assert.match(deck, /<b>The guest DJ<\/b> \(preset 7\) is the same kind of endless station/);
    // The guest DJ above the house DJs (the owner, 2026-10-09).
    assert.ok(deck.indexOf("Guest DJ</h2>") > 0 && deck.indexOf("Guest DJ</h2>") < deck.indexOf("House DJs</h2>"));
  } finally { sp.restore(); }
});

// ---- Codex's code review, 2026-09-25: the races, one test each ---------------------

const { laneLock, laneUnlock, endlessTrim } = __test;

test("review 1: a curator's write waits for the lane's lease, and lands nowhere once the lane has changed hands", async () => {
  const sp = spotifyAt({ now: { pid: LANE, at: 8 } });
  try {
    const e = env();
    e.__laneLockWaitMs = 0;
    await take(e, "gatefold");
    let t = Date.now() - 30 * MIN;
    await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    const [job] = (await endlessJobs(e)).filter((j) => j.preset === 7);
    // A takeover holds the lease: the answer waits, then says busy, and writes nothing.
    assert.equal(await laneLock(e, { id: "take-x" }), "ok");
    const before = sp.f.state.contents.length;
    const busy = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(busy.status, "lane-busy");
    assert.equal(sp.f.state.contents.length, before);
    // The takeover lands and lets go: the same job is now for a lane that moved on.
    await take(e, "the-librarian");
    await laneUnlock(e, "take-x");
    await endlessUpdate(e, (st) => { st.jobs[job.job_id] = { id: job.job_id, btn: 7, kind: "topup", dj: "gatefold", tenancy: 1, playlist: LANE, minutes: 45, at: Date.now() }; return {}; });
    const moved = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.match(moved.status, /^(lane-moved|dj-changed)$/, "closed, whichever check sees it first");
    assert.equal(sp.f.state.contents.length, before);
  } finally { sp.restore(); }
});

test("review 2: a takeover is not ready until its songs are on — the watch leaves it alone, and an opening that never lands empties it", async () => {
  const sp = spotifyAt({ now: { pid: LANE, at: 2 } });
  try {
    const e = env();
    const r = await playEndless(e, { dj: "americana", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(r.status, "making");
    assert.equal((await endlessLoad(e)).lane.ready, false);
    await endlessWatch(e, Date.now());
    assert.equal((await endlessLoad(e)).sessions["7"], undefined, "the last DJ's list playing is not Americana's session");
    // The opening never comes: past its time, the lane empties.
    await endlessWatch(e, Date.now() + 3 * 3600e3);
    const st = await endlessLoad(e);
    assert.equal(st.lane.dj, null);
    assert.notEqual(st.lane.ready, false);
    assert.equal(st.lane.tenancy, 2, "a new tenancy, so a late landing of the opening is refused (fix check 4)");
  } finally { sp.restore(); }
});

test("review 4: a trim is not made over a press that came after the stop", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    const before = sp.f.state.contents.map((t) => t.uri);
    const said = [];
    // The trim was decided at generation 0; the preset was pressed since (generation 1).
    await endlessUpdate(e, (st) => { st.gen["4"] = 1; return {}; });
    await endlessTrim(e, parseEndless(e), [{ btn: 4, dj: "dr-funkenstein", playlist: P4, uris: [T(1), T(2), T(3), T(4)], gen: 0 }],
      (b, ev, d) => said.push(ev));
    assert.deepEqual(said, ["keep-skipped"]);
    assert.deepEqual(sp.f.state.contents.map((t) => t.uri), before, "nothing cut");
  } finally { sp.restore(); }
});

test("review 5: taking the lane drops that DJ's wait for a fixed preset", async () => {
  const e = env();
  await endlessUpdate(e, (st) => { st.queued["4"] = { dj: "gatefold", at: Date.now() }; return {}; });
  await take(e, "gatefold");
  assert.equal((await endlessLoad(e)).queued["4"], undefined);
});

test("review 6: busy and carry-on are the player's word, not the watch's lagging session", async () => {
  const player = { now: { pid: LANE, at: 1 } };
  const sp = spotifyAt(player);
  try {
    const e = env();
    await take(e, "gatefold");
    // No session yet (the watch has not looked), but the lane is playing: ask.
    const r = await playEndless(e, { dj: "the-librarian", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(r.status, "busy");
    // A session left from before, but nothing playing: carry on, not "already".
    player.now = null;
    await endlessUpdate(e, (st) => { st.sessions["7"] = { start: Date.now(), misses: 1 }; return {}; });
    const again = await playEndless(e, { dj: "gatefold", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(again.status, "carry-on");
  } finally { sp.restore(); }
});

test("review 8: the page's poll finds the guest DJ's opening being made", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    await playEndless(e, { dj: "americana", device: "Pro Plus", budget: { remaining: 40 } });
    const got = JSON.parse(await page(e, `/buttons/${KEY}/americana/endless`));
    assert.deepEqual(got, { ok: true, making: true, steering: false });
  } finally { sp.restore(); }
});

test("the Loaded tab: a Guest DJ band under the requests — who, from which set, when picked, and Play; nobody yet, and how to pick", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
    const empty = await page(e, `/buttons/${KEY}`);
    assert.match(empty, /<h3 class="bname"><span class="vh">Guest DJ: <\/span>Nobody yet<\/h3>/);
    // ▶ is the drawn play icon since MC-30 stage 5, as on the squares.
    assert.match(empty, /Tap <svg class="ic"[^>]*>[\s\S]*?<\/svg> on any DJ to make them the guest DJ/);
    await seedProgram(e, "gatefold-one", "Gatefold", PROG);
    await playEndless(e, { dj: "gatefold", device: "Pro Plus", budget: { remaining: 40 } });
    const full = await page(e, `/buttons/${KEY}`);
    assert.match(full, /<h3 class="bname"><span class="vh">Guest DJ: <\/span>Gatefold<\/h3>/);
    assert.ok(full.includes("Endless · started from “A Gatefold set”"));
    assert.match(full, /<span class="bmeta">picked /);
    assert.ok(full.includes(`action="/buttons/${KEY}/gatefold/endless" class="bplay"`), "Play carries on through the DJ's own door");
  } finally { sp.restore(); }
});

test("the playing answer names the guest DJ's band, so the Loaded tab lights it and puts its line back after", async () => {
  const sp = spotifyAt({ now: { pid: LANE, at: 1 } });
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "SAMPLEPLAYLIST00000024", catalog: "spotify" }]);
    await take(e, "gatefold");
    await endlessUpdate(e, (st) => { st.lane.program = { slug: "g", title: "Seven Sleeves, 1971" }; return {}; });
    const o = JSON.parse(await page(e, `/buttons/${KEY}/playing`));
    assert.equal(o.state, "playing");
    assert.equal(o.lane, 7);
    const loaded = await page(e, `/buttons/${KEY}`);
    assert.ok(loaded.includes('data-rest="Endless · started from “Seven Sleeves, 1971”"'), "the line the script restores");
    assert.ok(loaded.includes("7 is the guest DJ: whoever you last played endless"));
  } finally { sp.restore(); }
});

// THE NOW PANEL, DESIGN A (2026-09-25): the DJ row, skip and steer.
test("the panel: /playing names the guest DJ and the sleeve; next skips only the speaker named; steer answers the panel in JSON", async () => {
  const sp = spotifyAt({ now: { pid: LANE, at: 1 } });
  const inner = globalThis.fetch, sent = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/next" || url.pathname === "/v1/me/player/previous") {
      sent.push(`${init.method} ${url.pathname}?${url.searchParams}`);
      return new Response(null, { status: 204 });
    }
    return inner(u, init);
  };
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
    await take(e, "gatefold");
    const o = JSON.parse(await page(e, `/buttons/${KEY}/playing?fresh=1`));
    assert.deepEqual(o.who, { dj: "gatefold", name: "Gatefold", kind: "guest", btn: 7, endless: true });
    const post = (path, body) => worker.fetch(new Request(`https://x.test${path}`, { method: "POST", body: new URLSearchParams(body),
      headers: { origin: "https://x.test", accept: "application/json" } }), e).then((r) => r.json());
    assert.deepEqual(await post(`/buttons/${KEY}/wiim/transport`, { do: "next", device: "Ultra" }), { ok: false, code: "gone" }, "not the Ultra's music");
    assert.deepEqual(sent, []);
    assert.deepEqual(await post(`/buttons/${KEY}/wiim/transport`, { do: "next", device: "Pro Plus" }), { ok: true, code: "ok" });
    assert.deepEqual(sent, ["POST /v1/me/player/next?device_id=d1"]);
    const s = await post(`/buttons/${KEY}/gatefold/endless`, { do: "more" });
    assert.equal(typeof s.code, "string", "a code the panel can say, not a redirect");
    const nobody = await post(`/buttons/${KEY}/nobody/endless`, { do: "more" }).catch(() => null);
    assert.equal(nobody, null, "an unknown DJ is not JSON");
  } finally { globalThis.fetch = inner; sp.restore(); }
});

test("the lane moved (7 to 3, 2026-09-30): its session, generation and jobs follow it", async () => {
  const e = env();
  await take(e, "gatefold");
  await endlessUpdate(e, (st) => {
    st.sessions["7"] = { start: Date.now(), misses: 0, tracks: [[T(1), "", "a"]] };
    st.jobs.x = { id: "x", btn: 7, kind: "topup", dj: "gatefold", tenancy: st.lane.tenancy };
    st.jobs.y = { id: "y", btn: 4, kind: "topup", dj: "dr-funkenstein" };
    return {};
  });
  const genWas = Number((await endlessLoad(e)).gen["7"]);
  e.ENDLESS = JSON.stringify({ ...JSON.parse(e.ENDLESS), presets: [
    { button: 4, dj: "dr-funkenstein", playlist: P4 },
    { button: 3, lane: true, playlist: LANE },
  ] });
  const st = await endlessLoad(e);
  assert.equal(st.lane.btn, 3);
  assert.equal(st.lane.dj, "gatefold", "the same guest");
  assert.equal(st.sessions["3"].tracks.length, 1, "the session carries on under 3");
  assert.equal(st.sessions["7"], undefined);
  assert.equal(Number(st.gen["3"]), genWas);
  assert.equal(st.gen["7"], undefined);
  assert.equal(st.jobs.x.btn, 3, "a job in flight lands on 3");
  assert.equal(st.jobs.y.btn, 4, "the house DJs' jobs are left alone");
  // Written once, it stays moved.
  await endlessUpdate(e, () => ({}));
  assert.equal((await endlessLoad(e)).lane.btn, 3);
});

// Comedy was the one asked-sets-only DJ until the cut (2026-10-13); the rule
// stays for the next one, so Pub Rock stands in for the length of the test
// (Chanson did, until Chanson was cut the same day).
test("an asked-sets-only DJ is never endless: not the guest, not a house preset, no ▶", async () => {
  const sp = spotifyAt({ now: null });
  PERSONAS["pub-rock"].endless = false;
  HOUSE_CACHE.src = null;
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    const out = await callTool(e, "play_endless", { dj: "Pub Rock", device: "Pro Plus" }, { remaining: 40 });
    assert.equal(out.status, "no-endless");
    assert.match(out.said, /asked-for sets only/);
    assert.equal((await endlessLoad(e)).lane?.dj ?? null, null, "the guest DJ slot is untouched");
    assert.equal((await endlessAssign(e, { dj: "pub-rock", button: 4 })).status, "no-endless");
    const own = await page(e, `/buttons/${KEY}/pub-rock`);
    assert.ok(!own.includes('class="laneform"'), "no Play endless on the page");
    const deck = await page(e, `/buttons/${KEY}/djs`);
    assert.ok(!deck.includes('aria-label="Play Pub Rock endless'), "no ▶ on the square");
    assert.ok(deck.includes('aria-label="Play Soul endless'), "the other new DJs have one");
  } finally {
    delete PERSONAS["pub-rock"].endless;
    HOUSE_CACHE.src = null;
    sp.restore();
  }
});

// A DJ CUT FROM THE HOUSE (the owner cut ten, 2026-10-13) can be left in the
// endless ledger: waiting for a preset, on an open job, in the history, or as
// the guest DJ. The wait and the job go; the history stays where nobody reads
// it; the watch, the queue and the pages carry on, and the guest DJ is free.
test("the endless ledger shrugs off a DJ who was cut", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    const now = Date.now();
    await endlessUpdate(e, (st) => {
      st.queued["4"] = { dj: "tempo", at: now };
      st.jobs.gone = { id: "gone", btn: 4, kind: "fresh", dj: "grunge", playlist: P4, minutes: 60, at: now };
      st.jobs.kept = { id: "kept", btn: 4, kind: "fresh", dj: "dr-funkenstein", playlist: P4, minutes: 60, at: now };
      // The cut of 2026-10-15: preset 4 had been handed to Monk on the
      // ledger, and the Selector had a job open. Monk's hand-off falls back
      // to the config's DJ for 4; the job goes.
      st.assign["4"] = { dj: "monk", at: now - 1000 };
      st.jobs.sel = { id: "sel", btn: 4, kind: "topup", dj: "the-selector", playlist: P4, minutes: 45, at: now };
      st.history.youp = [[now, T(1), "A — B"]];
      st.lane = { btn: 7, dj: "the-projectionist", tenancy: 3, since: now, head: 0 };
      return {};
    });
    const st = await endlessLoad(e);
    assert.equal(st.queued["4"], undefined, "nobody takes preset 4 from Dr. Funkenstein");
    assert.deepEqual(Object.keys(st.jobs), ["kept"]);
    assert.deepEqual(st.history.youp, [[now, T(1), "A — B"]]);
    assert.deepEqual((await endlessJobs(e)).map((j) => j.job_id), ["kept"]);
    await endlessWatch(e, now);
    assert.deepEqual(endlessSlots(e, parseEndless(e), await endlessLoad(e)).map((p) => p.dj), ["dr-funkenstein"],
      "Monk's hand-off on the ledger finds nobody, so 4 is the config's");
    assert.ok(!events(e).includes("assigned"), "no preset handed to nobody");
    assert.match(await page(e, `/buttons/${KEY}`), /Guest DJ/);
    assert.ok((await callTool(e, "list_requests", {}, { remaining: 40 })).endless);
    const r = await playEndless(e, { dj: "americana", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(r.status, "making", "the guest DJ is taken by somebody who is here");
  } finally { sp.restore(); }
});

// ---- Deep Dive: a DJ told what to play (2026-10-10) ----------------------------------

// ONE ARTIST, ENDLESS (the owner named Deep Dive, 2026-10-10). The artist is
// asked for, never guessed; it rides on the guest DJ and on every job the
// lane files, because the curator sees the job and never the list; and
// another artist is a new opening, never an old program of theirs.
test("Deep Dive: asked for an artist, kept on the guest DJ, and on every job the lane files", async () => {
  const player = { now: null };
  const sp = spotifyAt(player);
  try {
    const e = env();
    // A program of theirs on the Shelf, about somebody else: never the opening.
    await seedProgram(e, "deep-dive-prince", "Deep Dive", PROG);
    const none = await callTool(e, "play_endless", { dj: "Deep Dive", device: "Pro Plus" }, { remaining: 40 });
    assert.equal(none.status, "needs-words");
    assert.match(none.said, /Deep Dive needs an artist/);
    assert.equal((await endlessLoad(e)).lane?.dj ?? null, null, "nothing changed");

    const mj = await callTool(e, "play_endless", { dj: "Deep Dive", device: "Pro Plus", words: "Michael Jackson" }, { remaining: 40 });
    assert.equal(mj.status, "making", "an opening is made, not the Prince program");
    assert.match(mj.said, /making a set of Michael Jackson/);
    let st = await endlessLoad(e);
    assert.equal(st.lane.dj, "deep-dive");
    assert.equal(st.lane.words, "Michael Jackson");
    const fresh = Object.values(st.jobs).find((j) => j.kind === "fresh" && j.btn === 7);
    assert.equal(fresh.words, "Michael Jackson");
    assert.match(endlessHow(fresh, "Deep Dive"), /The listener asked for this direction: "Michael Jackson"/);

    // A top-up and a steer the lane files later carry it too; a steer's own words come after.
    await endlessUpdate(e, (s) => {
      s.lane.ready = true;
      endlessFile(s, { id: "up", kind: "topup", btn: 7, dj: "deep-dive" }, []);
      endlessFile(s, { id: "st", kind: "steer", btn: 7, dj: "deep-dive", words: "the ballads" }, []);
      endlessFile(s, { id: "m", kind: "topup", btn: 4, dj: "dr-funkenstein" }, []);
      return {};
    });
    st = await endlessLoad(e);
    assert.equal(st.jobs.up.words, "Michael Jackson");
    assert.equal(st.jobs.st.words, "Michael Jackson; the ballads");
    assert.equal(st.jobs.m.words, undefined, "another preset's jobs are untouched");

    // Asked again, the same artist carries on; no artist carries on too; another artist is a new opening.
    assert.equal((await playEndless(e, { dj: "deep-dive", device: "Pro Plus", budget: { remaining: 40 }, words: "michael  jackson" })).status, "carry-on");
    assert.equal((await playEndless(e, { dj: "deep-dive", device: "Pro Plus", budget: { remaining: 40 } })).status, "carry-on");
    const tenancy = st.lane.tenancy;
    assert.equal((await playEndless(e, { dj: "deep-dive", device: "Pro Plus", budget: { remaining: 40 }, words: "Prince" })).status, "making");
    st = await endlessLoad(e);
    assert.equal(st.lane.words, "Prince");
    assert.ok(st.lane.tenancy > tenancy, "a new tenancy: Michael Jackson's jobs land nowhere");
    assert.ok(!st.jobs.up && !st.jobs.st, "the old artist's jobs are gone");
  } finally { sp.restore(); }
});

// DEEP DIVE LOOKS THE ARTIST UP ONCE (2026-10-18; docs/research/
// musicbrainz-trial-2026-10-18.md): a job for an artist the house has not
// looked up asks for research; what the curator sends back is kept under the
// guest DJ's words; later jobs for that artist read it and ask nothing.
test("Deep Dive's research: asked for once, kept by the house, read back by later jobs", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    await callTool(e, "play_endless", { dj: "Deep Dive", device: "Pro Plus", words: "Charlie Hunter" }, { remaining: 40 });
    let jobs = await endlessJobs(e);
    const fresh = jobs.find((j) => j.kind === "fresh" && j.preset === 7);
    assert.match(fresh.research, /RESEARCH FIRST: the house has not looked up "Charlie Hunter" yet/);
    assert.match(fresh.research, /release-group\?query=%28arid:<id>%20OR%20arid:<group id>%29%20AND%20primarytype:album%20AND%20NOT%20secondarytype:compilation/,
      "the artist and their own groups (the Quintet, the Trio) in one search");
    assert.match(fresh.research, /work\?artist=<id>/, "a songwriter's songs too");
    assert.equal(fresh.discography, undefined);
    await callTool(e, "extend_endless", { job_id: fresh.job_id, uris: [T(1), T(2), T(3)], discography: {
      artist: "Charlie Hunter",
      albums: [{ title: "Bing, Bing, Bing!", year: "1995", as: "Charlie Hunter Trio" }, { title: "Baboon Strength", year: "2008-06-15" }, { title: "  " }],
      names: ["Charlie Hunter Trio", "Charlie Hunter Quartet", "Charlie Hunter Trio"] } }, { remaining: 40 }).catch(() => null);
    const kept = await e.PROGRAMS.get("research:charlie-hunter", { type: "json" });
    assert.deepEqual(kept.albums, [{ title: "Bing, Bing, Bing!", year: "1995", as: "Charlie Hunter Trio" }, { title: "Baboon Strength", year: "2008" }],
      "titles and years kept, an empty one dropped");
    assert.deepEqual(kept.names, ["Charlie Hunter Trio", "Charlie Hunter Quartet"]);
    await endlessUpdate(e, (s) => {
      s.lane.ready = true;
      endlessFile(s, { id: "up2", kind: "topup", btn: 7, dj: "deep-dive", minutes: 45, at: Date.now() }, []);
      endlessFile(s, { id: "m2", kind: "topup", btn: 4, dj: "dr-funkenstein", minutes: 45, at: Date.now() }, []);
      return {};
    });
    jobs = await endlessJobs(e);
    const up = jobs.find((j) => j.job_id === "up2");
    assert.equal(up.research, undefined, "looked up once");
    assert.equal(up.discography.artist, "Charlie Hunter");
    assert.equal(up.discography.albums.length, 2);
    // A list kept by the first steps (one page, no groups' albums) is looked up again.
    await e.PROGRAMS.put("research:charlie-hunter", JSON.stringify({ ...kept, v: undefined }));
    assert.match((await endlessJobs(e)).find((j) => j.job_id === "up2").research, /RESEARCH FIRST/);
    const m = jobs.find((j) => j.job_id === "m2");
    assert.ok(!("research" in m) && !("discography" in m), "a DJ who is not told an artist looks nothing up");
  } finally { sp.restore(); }
});

// ANYONE ELSE ON THE GUEST DJ (2026-10-18, the evening): told an artist,
// they may look them up too; whoever is told that artist next reads the
// folder, kept under the artist's own name and found by it in longer words.
test("another guest DJ told an artist may look them up, and Deep Dive reads it after", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    await callTool(e, "play_endless", { dj: "Americana", device: "Pro Plus", words: "Lucinda Williams" }, { remaining: 40 });
    const fresh = (await endlessJobs(e)).find((j) => j.kind === "fresh" && j.preset === 7);
    assert.match(fresh.research_if_artist, /IF "Lucinda Williams" is about one artist/);
    assert.equal(fresh.research, undefined, "only Deep Dive must");
    const listed = await callTool(e, "list_requests", {}, { remaining: 40 });
    assert.match(listed.research_steps, /musicbrainz\.org\/ws\/2\/artist\?query=/);
    await callTool(e, "extend_endless", { job_id: fresh.job_id, uris: [T(1), T(2), T(3)], discography: {
      artist: "Lucinda Williams", albums: [{ title: "Car Wheels on a Gravel Road", year: "1998" }] } }, { remaining: 40 }).catch(() => null);
    assert.equal((await e.PROGRAMS.get("research:lucinda-williams", { type: "json" })).albums[0].year, "1998");

    const e2 = env();
    e2.PROGRAMS = e.PROGRAMS;
    await callTool(e2, "play_endless", { dj: "Deep Dive", device: "Pro Plus", words: "Lucinda Williams, the quiet ones" }, { remaining: 40 });
    const dd = (await endlessJobs(e2)).find((j) => j.kind === "fresh" && j.preset === 7);
    assert.equal(dd.discography.artist, "Lucinda Williams", "found by her name inside the words");
    assert.equal(dd.research, undefined);
    assert.equal(dd.research_if_artist, undefined);
  } finally { sp.restore(); }
});

// WHAT THE ROOMS HEARD (2026-10-18): Deep Dive's first Isaac Hayes set
// opened on two songs Talk had played half an hour before. Every job leaves
// out what Spotify says the house played in the last three hours.
test("an endless job leaves out what the rooms heard lately, whoever played it", async () => {
  const { heardLately } = await import("../endless.js");
  const sp = spotifyAt({ now: null });
  const inner = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async (u, init = {}) => {
    if (new URL(String(u)).pathname === "/v1/me/player/recently-played") {
      asked++;
      const at = (min) => new Date(Date.now() - min * MIN).toISOString();
      return Response.json({ items: [
        { played_at: at(31), track: { name: "Never Can Say Goodbye", artists: [{ name: "Isaac Hayes" }] } },
        { played_at: at(46), track: { name: "Theme From Shaft", artists: [{ name: "Isaac Hayes" }] } },
        { played_at: at(200), track: { name: "Purple Rain", artists: [{ name: "Prince" }] } },
        { played_at: at(10), track: null }] });
    }
    return inner(u, init);
  };
  try {
    const e = env();
    assert.deepEqual(await endlessJobs(e, { heard: () => heardLately(e) }), []);
    assert.equal(asked, 0, "no job, no call");
    await callTool(e, "play_endless", { dj: "Deep Dive", device: "Pro Plus", words: "Isaac Hayes" }, { remaining: 40 });
    const job = (await endlessJobs(e, { heard: () => heardLately(e) })).find((j) => j.kind === "fresh");
    assert.ok(job.avoid.includes("Isaac Hayes — Never Can Say Goodbye"));
    assert.ok(job.avoid.includes("Isaac Hayes — Theme From Shaft"));
    assert.ok(!job.avoid.includes("Prince — Purple Rain"), "three hours, no more");
    assert.equal(asked, 1);
    const listed = await callTool(e, "list_requests", {}, { remaining: 40 });
    assert.ok(listed.endless_jobs[0].avoid.includes("Isaac Hayes — Theme From Shaft"), "list_requests reads it");
    assert.match(listed.endless_note, /whatever the house's rooms heard in the last three hours/);
  } finally { globalThis.fetch = inner; sp.restore(); }
});

// THE RULES THE HOUSE COUNTS, ON AN ENDLESS JOB (setcheck.js, 2026-10-18):
// Genre's set with one act twice in a row is sent back once; the next call
// lands as sent, and the log says what it held.
test("an endless set that breaks its DJ's spacing is sent back once, then written as sent", async () => {
  const { station } = await import("../station.js");
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    await callTool(e, "play_endless", { dj: "Genre", device: "Pro Plus", words: "pub rock" }, { remaining: 40 });
    const fresh = (await endlessJobs(e)).find((j) => j.kind === "fresh" && j.preset === 7);
    await station(e, "seen-put", { rows: [[T(1), "Kursaal Flyers", "Little Does She Know", "The Great Artiste", 200000],
      [T(2), "Kursaal Flyers", "Hit Records", "Golden Mile", 200000], [T(3), "Dr. Feelgood", "Roxette", "Down by the Jetty", 200000]] });
    await assert.rejects(callTool(e, "extend_endless", { job_id: fresh.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 }),
      /Not written: this set breaks rules the house counts for Genre \(never two songs by the same artist in a row.*songs 1 and 2 are both Kursaal Flyers/);
    const again = (await endlessJobs(e)).find((j) => j.job_id === fresh.job_id);
    assert.ok(again, "the job is still open, its claim let go");
    const out = await callTool(e, "extend_endless", { job_id: fresh.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "fresh");
    assert.deepEqual(out.written_as_sent, ["songs 1 and 2 are both Kursaal Flyers"]);
    const log = (await callTool(e, "list_requests", {}, { remaining: 40 })).endless.log.join("\n");
    assert.match(log, /rules-as-sent — songs 1 and 2 are both Kursaal Flyers/);
  } finally { sp.restore(); }
});

test("Deep Dive goes through every album unless the words narrow it, and looks up the live ones that matter", async () => {
  const { researchSteps } = await import("../endless.js");
  assert.match(PERSONAS["deep-dive"].brief, /unless the listener narrows it \('Miles, a mellow evening'/);
  const r = researchSteps("Miles Davis");
  assert.match(r, /send its id as `mbid` and its disambiguation/);
  assert.match(r, /&offset=100 \(then 200\) while its work-count says there are more/);
  assert.match(r, /unless the words narrow it/);
  assert.match(r, /the live albums in one more search/);
  assert.match(r, /marked live, never every concert/);
});

test("the research is held to a shape and a size, and its key is the words", async () => {
  const { cleanResearch, researchKey } = await import("../endless.js");
  assert.equal(cleanResearch(null), null);
  assert.equal(cleanResearch({ artist: "X", albums: [], songs: [] }), null, "nothing to keep");
  const big = cleanResearch({ albums: Array.from({ length: 150 }, (_, i) => ({ title: `A${i}`, year: "19x5" })),
    names: Array.from({ length: 40 }, (_, i) => `N${i}`), songs: [{ title: "Song\u0000", by: Array(12).fill("B") }] });
  assert.equal(big.albums.length, 120, "room for Miles Davis and his groups");
  assert.equal(big.albums[0].year, null, "a year is four digits or nothing");
  assert.equal(big.names.length, 24);
  assert.deepEqual(big.songs, [{ title: "Song", year: null, by: Array(8).fill("B") }]);
  assert.equal(researchKey("Charlie  Hunter!"), "research:charlie-hunter");
  assert.equal(researchKey("Beyoncé"), "research:beyonce");
});

test("Deep Dive's square on the DJs tab has no bare play, and its page asks which artist", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = "abcdefabcdefabcdefabcdef";
    const base = "https://x.test/buttons/abcdefabcdefabcdefabcdef";
    const deck = await (await worker.fetch(new Request(`${base}/djs`), e)).text();
    const sq = deck.slice(deck.indexOf(`href="/buttons/abcdefabcdefabcdefabcdef/deep-dive"`));
    assert.ok(sq.length > 0, "Deep Dive is on the DJs tab");
    assert.ok(!sq.slice(0, sq.indexOf("</li>")).includes('class="dplay"'), "no play without an artist");
    const page = await (await worker.fetch(new Request(`${base}/deep-dive`), e)).text();
    assert.match(page, /<input class="lanewords" type="text" name="words" required/);
    assert.match(page, /placeholder="Which artist\?"/);
  } finally { sp.restore(); }
});

// GENRE, TOLD LIKE DEEP DIVE (the owner, 2026-10-10): asked for a genre, never
// guessed; the genre rides on the guest DJ and its opening.
test("Genre: asked for a genre, and it goes on the guest DJ and its opening", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    const none = await callTool(e, "play_endless", { dj: "Genre", device: "Pro Plus" }, { remaining: 40 });
    assert.equal(none.status, "needs-words");
    assert.match(none.said, /Genre needs a genre/);
    const nw = await callTool(e, "play_endless", { dj: "Genre", device: "Pro Plus", words: "80s new wave" }, { remaining: 40 });
    assert.equal(nw.status, "making");
    const st = await endlessLoad(e);
    assert.equal(st.lane.dj, "genre");
    assert.equal(st.lane.words, "80s new wave");
    assert.equal(Object.values(st.jobs).find((j) => j.kind === "fresh" && j.btn === 7).words, "80s new wave");
  } finally { sp.restore(); }
});

// ---- Words for any guest DJ (the merges, 2026-10-13) ---------------------------------

// WORDS FOR ANY GUEST (the owner, 2026-10-13, with the merges: "Soul, the
// South", "Hip Hop, Houston" until Hip Hop was cut, "Vibe, the small hours"). Optional, unlike Deep
// Dive's and Genre's: kept on the guest DJ and on every job it files, other
// words a new opening, none a carry-on, and never an old program to open on.
test("any guest DJ may be told what to play: on the guest DJ and every job, other words a new opening, none carries on", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    // A program of Soul's on the Shelf: never the opening for words.
    await seedProgram(e, "soul-north", "Soul", PROG);
    // Stax's old name finds Soul, and the South is the listener's word.
    const south = await callTool(e, "play_endless", { dj: "Stax", device: "Pro Plus", words: "the South (Stax)" }, { remaining: 40 });
    assert.equal(south.status, "making", "an opening is made, not the program");
    assert.match(south.said, /Soul is making a set of the South \(Stax\)/);
    let st = await endlessLoad(e);
    assert.equal(st.lane.dj, "soul");
    assert.equal(st.lane.words, "the South (Stax)");
    assert.equal(st.lane.program, null);
    const fresh = Object.values(st.jobs).find((j) => j.kind === "fresh" && j.btn === 7);
    assert.equal(fresh.words, "the South (Stax)");
    assert.match(endlessHow(fresh, "Soul"), /The listener asked for this direction: "the South \(Stax\)"/);

    // A top-up and a steer the lane files later carry them too.
    await endlessUpdate(e, (s) => {
      s.lane.ready = true;
      endlessFile(s, { id: "up", kind: "topup", btn: 7, dj: "soul" }, []);
      endlessFile(s, { id: "st", kind: "steer", btn: 7, dj: "soul", words: "more Hi Records" }, []);
      return {};
    });
    st = await endlessLoad(e);
    assert.equal(st.jobs.up.words, "the South (Stax)");
    assert.equal(st.jobs.st.words, "the South (Stax); more Hi Records");

    // No words carries on, and so do the same words; the words stay.
    assert.equal((await playEndless(e, { dj: "soul", device: "Pro Plus", budget: { remaining: 40 } })).status, "carry-on");
    assert.equal((await playEndless(e, { dj: "soul", device: "Pro Plus", budget: { remaining: 40 }, words: "the south  (stax)" })).status, "carry-on");
    assert.equal((await endlessLoad(e)).lane.words, "the South (Stax)");

    // Other words: a new opening under a new tenancy, and the South's jobs land nowhere.
    const tenancy = st.lane.tenancy;
    assert.equal((await playEndless(e, { dj: "soul", device: "Pro Plus", budget: { remaining: 40 }, words: "the North (Motown)" })).status, "making");
    st = await endlessLoad(e);
    assert.equal(st.lane.words, "the North (Motown)");
    assert.ok(st.lane.tenancy > tenancy);
    assert.ok(!st.jobs.up && !st.jobs.st, "the old words' jobs are gone");
    assert.equal(Object.values(st.jobs).find((j) => j.kind === "fresh" && j.btn === 7).words, "the North (Motown)");
  } finally { sp.restore(); }
});

test("a guest with no words plays as before, from their newest program; words later are a new opening", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    // Hip Hop's, with KRS-One's old name and a city, until Hip Hop was cut
    // (2026-10-15); Vibe's now, with Nightside's.
    await seedProgram(e, "vibe-room", "Vibe", PROG);
    const r = await playEndless(e, { dj: "vibe", device: "Pro Plus", budget: { remaining: 40 } });
    assert.equal(r.status, "started", "at once, from the Shelf");
    let st = await endlessLoad(e);
    assert.equal(st.lane.dj, "vibe");
    assert.equal(st.lane.words, undefined, "no words on the guest DJ");
    assert.equal(st.lane.program?.slug, "vibe-room");
    assert.equal(Object.values(st.jobs).length, 0, "no run spent");
    // Nightside's old name is Vibe's, and a mood is a new opening.
    const h = await callTool(e, "play_endless", { dj: "Nightside", device: "Pro Plus", words: "the small hours" }, { remaining: 40 });
    assert.equal(h.status, "making");
    st = await endlessLoad(e);
    assert.equal(st.lane.dj, "vibe");
    assert.equal(st.lane.words, "the small hours");
    assert.equal(st.lane.program, null, "never the room's program");
  } finally { sp.restore(); }
});

test("a house DJ told what to play plays their own preset as it is, and says the words were not used", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    const out = await callTool(e, "play_endless", { dj: "Dr. Funkenstein", device: "Pro Plus", words: "organ trios" }, { remaining: 40 });
    assert.equal(out.status, "own-preset");
    assert.equal(out.words_unused, true);
    // `said` carries the line too, unless the start itself went wrong (here
    // the fake speaker never confirms one, and that line wins).
    assert.ok(out.start === "ok" ? /ask to steer it/.test(out.said) : /not playing it/.test(out.said), out.said);
    const st = await endlessLoad(e);
    assert.equal(st.lane?.dj ?? null, null, "the guest DJ is untouched");
    assert.deepEqual(Object.values(st.jobs), [], "and no run is spent");
    const plain = await callTool(e, "play_endless", { dj: "Dr. Funkenstein", device: "Pro Plus" }, { remaining: 40 });
    assert.equal("words_unused" in plain, false);
  } finally { sp.restore(); }
});

test("the optional words box: beside Play endless for a DJ with a wordsHint, never required; none for the rest", async () => {
  const sp = spotifyAt({ now: null });
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    // Hip Hop's box ("A year, an era or a city") went with him, 2026-10-15.
    for (const [key, hint] of [["vibe", "A mood: the room, the morning, the small hours"],
      ["soul", "The South, the North, or a label"]]) {
      const html = await page(e, `/buttons/${KEY}/${key}`);
      const box = html.match(/<input class="lanewords[^>]*>/)?.[0] ?? "";
      assert.match(box, /^<input class="lanewords opt" type="text" name="words"/, key);
      assert.ok(!box.includes("required"), `${key}: optional`);
      assert.ok(box.includes(`placeholder="${hint}"`), key);
      assert.match(box, /aria-label="Optional: /, key);
    }
    for (const key of ["gatefold", "americana", "the-librarian"]) {
      const html = await page(e, `/buttons/${KEY}/${key}`);
      assert.ok(html.includes('class="laneform"'), `${key} has Play endless`);
      assert.ok(!html.includes('class="lanewords'), `${key} has no box`);
    }
    assert.match(await page(e, `/buttons/${KEY}/deep-dive`), /<input class="lanewords" type="text" name="words" required/,
      "Deep Dive's stays required");

    // The form sends the words, and the page says what is being made.
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/soul/endless`, { method: "POST",
      body: new URLSearchParams({ do: "lane", device: "Pro Plus", words: "Hi Records" }) }), e);
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), /endless=lane-making/);
    assert.equal((await endlessLoad(e)).lane.words, "Hi Records");
    assert.match(await page(e, r.headers.get("location")), /Soul is making a set of Hi Records, about four minutes\./);
    // While the guest DJ is theirs the box stays, so other words can follow.
    await endlessUpdate(e, (s) => { s.lane.ready = true; return {}; });
    const mine = await page(e, `/buttons/${KEY}/soul`);
    assert.match(mine, /<input class="lanewords opt"/);
    assert.ok(!mine.includes("Play endless · carry on"), "the box can start a new set, so the button does not promise a carry-on");
  } finally { sp.restore(); }
});

// THE HOUSE LOOKS DEEP DIVE'S ARTIST UP ITSELF (2026-10-24; musicbrainz.js):
// a ChatGPT curator cannot reach MusicBrainz, so list_requests does it for a
// job whose artist has no folder, once a listing, and the job carries it.
test("list_requests looks Deep Dive's artist up when the house has no folder, and the job carries it", async () => {
  const sp = spotifyAt({ now: null });
  const inner = globalThis.fetch;
  const heard = [], searched = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname !== "musicbrainz.org") return inner(u, init);
    heard.push(url.pathname);
    if (url.pathname === "/ws/2/artist") {
      searched.push(url.searchParams.get("query"));
      return Response.json({ artists: [{ id: "4b0be624-6b87-47e8-bbf0-588a2c6c0439", name: "J.J. Cale", score: 100 }] });
    }
    if (url.pathname.startsWith("/ws/2/artist/")) return Response.json({ name: "J.J. Cale", aliases: [{ name: "JJ Cale" }], relations: [] });
    return Response.json({ "release-groups": [{ title: "Naturally", "first-release-date": "1971" }, { title: "Okie", "first-release-date": "1974" }] });
  };
  try {
    const e = env();
    e.ARTIST_LOOKUP = "on";
    e.__mbSleep = async () => {};
    await callTool(e, "play_endless", { dj: "Deep Dive", device: "Pro Plus", words: "J.j. Cale, the Okie years" }, { remaining: 40 });
    const listed = await callTool(e, "list_requests", {}, { remaining: 40 });
    const fresh = listed.endless_jobs.find((j) => j.kind === "fresh" && j.preset === 7);
    assert.equal(fresh.research, undefined, "nothing left for the curator to look up");
    assert.equal(fresh.discography.artist, "J.J. Cale");
    assert.deepEqual(fresh.discography.albums, [{ title: "Naturally", year: "1971" }, { title: "Okie", year: "1974" }]);
    assert.match(fresh.discography.scope, /Studio albums only/);
    assert.equal(heard.length, 3);
    assert.deepEqual(searched, ['artist:"J.j. Cale"'], "only the artist leaves the house, never the rest of the words");
    await callTool(e, "list_requests", {}, { remaining: 40 });
    assert.equal(heard.length, 3, "kept: the next listing reads the folder");
  } finally { globalThis.fetch = inner; sp.restore(); }
});

// NEARBY, ONE TAP (the owner, 2026-10-24, from the canvas of that name): while
// a guest DJ who is told what to play plays it, four places to turn, under the
// header and in the bar's panel. Genre's come from the curator, asked once for
// the words; Deep Dive's from Last.fm. A tap is Play endless with those words.
test("nearby: kept for the guest DJ's words, offered on the page and the bar's panel, a tap is Play endless with them", async () => {
  const { nearbyOf } = await import("../endless.js");
  assert.deepEqual(nearbyOf("genre", "ska", { sent: ["Rocksteady", " 2 Tone ", "ska", "Reggae", "Ska punk", "Dub"] }),
    { words: "ska", label: "Nearby", list: ["Rocksteady", "2 Tone", "Reggae", "Ska punk"] }, "the words themselves never; a genre's kin may");
  assert.deepEqual(nearbyOf("deep-dive", "J.J. Cale", { similar: [{ name: "J.J. Cale & Eric Clapton" }, { name: "Tony Joe White" }, { name: "Ry Cooder" }] }),
    { words: "J.J. Cale", label: "Similar artists", list: ["Tony Joe White", "Ry Cooder"] }, "never a billing that holds the artist");
  assert.equal(nearbyOf("vibe", "rain", { sent: ["x"] }), null, "only the DJs who are told what to play");

  const player = { now: null };
  const sp = spotifyAt(player);
  try {
    const e = env();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Master Bedroom"]);
    await callTool(e, "play_endless", { dj: "Genre", device: "Pro Plus", words: "ska" }, { remaining: 40 });
    let fresh = (await endlessJobs(e)).find((j) => j.kind === "fresh" && j.preset === 7);
    assert.match(fresh.send_nearby, /four genres next to this one/);
    await callTool(e, "extend_endless", { job_id: fresh.job_id, uris: [T(1), T(2), T(3)],
      nearby: ["Rocksteady", "2 Tone", "Reggae", "Ska punk"] }, { remaining: 40 }).catch(() => null);
    assert.deepEqual((await endlessLoad(e)).lane.nearby, { words: "ska", label: "Nearby", list: ["Rocksteady", "2 Tone", "Reggae", "Ska punk"] });
    await endlessUpdate(e, (s) => { endlessFile(s, { id: "up9", kind: "topup", btn: 7, dj: "genre", minutes: 45, at: Date.now(), tenancy: s.lane.tenancy }, []); return {}; });
    assert.equal((await endlessJobs(e)).find((j) => j.job_id === "up9").send_nearby, undefined, "asked once for the words");

    const genre = await page(e, `/buttons/${KEY}/genre`);
    assert.match(genre, /<section class="block nearby" aria-labelledby="nearh">\s*<h2 class="blabel" id="nearh">Nearby <small>a new set in a few minutes<\/small><\/h2>/);
    assert.match(genre, /<input type="hidden" name="do" value="lane"><input type="hidden" name="words" value="Rocksteady">/);
    assert.match(genre, /<\/header>\s*<section class="block nearby"/, "right under the header");

    player.now = { pid: LANE, at: 1 };
    const now = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.deepEqual(now.who.nearby, { label: "Nearby", list: ["Rocksteady", "2 Tone", "Reggae", "Ska punk"] }, "the bar's panel offers them");
    assert.match(genre, /<div class="nbnear" hidden><p class="nbnlbl"><\/p><div class="nbnchips" role="group"><\/div><\/div>/);

    // The panel's tap asks by fetch, and is answered in JSON.
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/genre/endless`, { method: "POST",
      headers: { accept: "application/json" }, body: new URLSearchParams({ do: "lane", words: "Rocksteady", device: "Pro Plus" }) }), e);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    const said = await r.json();
    assert.equal(typeof said.code, "string");
    assert.equal((await endlessLoad(e)).lane.words, "Rocksteady", "new words: the list of nearby for ska no longer shows");
    assert.doesNotMatch(await page(e, `/buttons/${KEY}/genre`), /class="block nearby"/);
  } finally { sp.restore(); }
});
