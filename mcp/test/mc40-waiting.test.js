// MC-40, STAGE 0: THE MATRIX (tasks/mc40-dj-presets.md). A DJ preset made in
// a house with no curator is an ENDLESS preset that WAITS: its `ENDLESS`
// setting carries `"waits": true` until a curator first checks in. This file
// says what such a house does, row by row, before any of it is built.
//
// Every row comes twice. The WAITING house's test is marked `todo` while the
// engine is not built: node reports it without failing the suite, and the
// mark comes off as stage 1 makes it pass. Its TWIN runs the same steps on a
// house like the owner's (a curator, no word) and passes today: it proves
// the steps are the right ones, and that nothing of this plan may change a
// house made before it.
//
// Talk and maple crate put a DJ on through playEndless (alexa-act.js,
// talk-press.js), and file steers through endlessPageSteer, so their rows
// are these functions' rows.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { endlessAfterSkip, endlessLoad, endlessPageSteer, endlessStartFresh, parseEndless, playEndless } from "../endless.js";
import { stampCurator, CURATOR_SEEN_KEY } from "../services.js";
import { choosePageSetting, forgetKeptSettings, withSettings } from "../settings.js";
import { setupChecklist } from "../checklist.js";
import { firstSet } from "../setup-watch.js";
import { render } from "../install/config.js";
import { nudgeWatch } from "../endless.js";
import { makeEnv, makeHouseStore, installFetch, track } from "./harness.js";

const { endlessWatch, endlessJobs, callTool, endlessAssign } = __test;
const KEY = "abcdefabcdefabcdefabcdef";
const REQ = "REQUESTS00000000000001";
const HANK = "HANKPLAYLIST0000000005";
const LANE = "LANEPLAYLIST0000000003";
const MIN = 60_000;
const T = (n) => `spotify:track:${String(n).padStart(22, "x")}`;
const B = () => ({ remaining: 40 });

// Requests on 1 and Hank on 5. `waits`: no curator has ever checked in.
// Without it: the same house with a working Claude curator, as the owner's.
function config({ waits = false, lane = false } = {}) {
  return JSON.stringify({ mode: "live", dailyRuns: 12, ...(waits ? { waits: true } : {}), presets: [
    { button: 5, dj: "hank", playlist: HANK, hours: 4 },
    ...(lane ? [{ button: 3, lane: true, playlist: LANE, hours: 4 }] : [])] });
}
function house(opts = {}) {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: REQ, catalog: "spotify" }]);
  e.ENDLESS = config(opts);
  // The word counts only in a setting the page wrote (Codex, 2026-11-10: a
  // file's house has no page to take the word away again).
  if (opts.waits && !opts.inFile) e.__page = { ENDLESS: e.ENDLESS };
  if (!opts.waits) {
    e.AUTOFULFILL_ENABLED = "true";
    e.REQUEST_ROUTINE_ID = "trig_test";
    e.REQUEST_ROUTINE_TOKEN = "routine-token";
  }
  return e;
}
const waitingHouse = (opts = {}) => house({ ...opts, waits: true });

// Spotify with ten 5-minute songs on every playlist and a player the test
// moves. Counts the player reads, the curator's bells and every write.
function spotify(player) {
  const f = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch;
  const rung = [];
  let reads = 0;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.anthropic.com") { rung.push(String(init.body ?? "")); return Response.json({ type: "routine_fire" }); }
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      reads++;
      const p = player.now;
      if (!p) return new Response(null, { status: 204 });
      return Response.json({ is_playing: true, device: { name: "Pro Plus", id: "device-1" },
        context: { uri: `spotify:playlist:${p.pid}` }, progress_ms: p.progress ?? 0,
        item: { uri: `spotify:track:t${p.at}`, name: `Track t${p.at}`, artists: [{ name: "Someone" }] } });
    }
    return inner(u, init);
  };
  const writes = () => f.calls.filter((c) => /^(PUT|POST|DELETE) \/playlists\//.test(c));
  return { f, rung, reads: () => reads, writes, calls: f.calls, restore: () => { globalThis.fetch = inner; f.restore(); } };
}
const events = (e) => (e.STATION.endless?.log ?? []).map((r) => r.event);
// The ledger as the house left it: nothing filed, no run counted, no session.
async function untouched(e, why) {
  const st = await endlessLoad(e);
  assert.deepEqual(Object.keys(st.jobs), [], `${why}: no job filed`);
  assert.equal(Number(st.runs) || 0, 0, `${why}: no run counted`);
  assert.deepEqual(Object.values(st.sessions).filter(Boolean), [], `${why}: no session`);
  assert.deepEqual(events(e), [], `${why}: nothing in the log`);
}
// A whole evening, as the watch meets it: the preset starts, plays down to
// its last songs, then the listener goes elsewhere for two looks.
async function evening(e, player) {
  let t = Date.now() - 2 * 60 * MIN;
  player.now = { pid: HANK, at: 0 };
  await endlessWatch(e, t);
  player.now = { pid: HANK, at: 7, progress: 2 * MIN };   // 13 minutes left
  t += 10 * MIN; await endlessWatch(e, t);
  player.now = { pid: "OTHERPLAYLIST000000000", at: 0 };
  t += 10 * MIN; await endlessWatch(e, t);
  t += 10 * MIN; await endlessWatch(e, t);
}

// ---------------------------------------------------------------- the word
test("the config keeps the word: a house whose presets wait says so, and one without the word does not", () => {
  assert.equal(parseEndless({ ENDLESS: config({ waits: true }) }).waits, true);
  assert.equal(parseEndless({ ENDLESS: config() }).waits, undefined, "no word: exactly today's config");
  assert.equal(parseEndless({ ENDLESS: JSON.stringify({ ...JSON.parse(config()), waits: "yes" }) }).waits, undefined, "only true is the word");
});

test("a word written in a house's own file is not the word: that house is as it is today", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    const e = waitingHouse({ inFile: true });
    await evening(e, player);
    assert.ok(sp.reads() >= 3, "the watch looks, as in any house whose ENDLESS comes from its file");
    assert.ok(events(e).includes("session-start"));
  } finally { sp.restore(); }
});
test("the installer refuses a house.json whose endless carries the word", () => {
  const file = (endless) => ({ buttons: [{ button: 1, guest: true, name: "G", playlist: "0000000000000000000001", catalog: "spotify" }],
    aliases: { replay: "0000000000000000000002" }, endless });
  const presets = [{ button: 5, dj: "hank", playlist: HANK }];
  assert.throws(() => render(file({ mode: "live", waits: true, presets }), ""), /"waits" in "endless" is not for house\.json/);
  assert.throws(() => render(file({ mode: "live", waits: false, presets }), ""), /not for house\.json/, "the word in any form");
});

// --------------------------------------------------------------- the watch
test("twin: with a curator the watch opens a session, asks for a top-up, rings, counts a run and ends the session", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    const e = house();
    await evening(e, player);
    assert.ok(sp.reads() >= 3, "it reads the player");
    assert.ok(events(e).includes("session-start") && events(e).includes("topup") && events(e).includes("session-end"), events(e).join(","));
    assert.equal(sp.rung.length >= 1, true, "the curator's bell");
    assert.equal(Number((await endlessLoad(e)).runs) >= 1, true, "a run counted");
  } finally { sp.restore(); }
});

test("waiting: the watch does not look at all: no player read, no session, no job, no run, no trim, no rename, no pause, no bell", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    const e = waitingHouse();
    await evening(e, player);
    assert.equal(sp.reads(), 0, "not one Spotify read");
    assert.deepEqual(sp.calls.filter((c) => c.includes("/me/player")), [], "no player call of any kind, a pause included");
    assert.deepEqual(sp.writes(), [], "the starter hour is not cut, and the playlist not renamed");
    assert.deepEqual(sp.rung, [], "no curator to ring");
    await untouched(e, "the watch");
    assert.deepEqual((await endlessJobs(e)).jobs ?? [], [], "nothing waits for a curator");
  } finally { sp.restore(); }
});

// ----------------------------------------------- the producers all refuse
test("twin: with a curator Start fresh files a set and counts the day; a steer on the playing preset files too", async () => {
  const player = { now: { pid: HANK, at: 0 } };
  const sp = spotify(player);
  try {
    const e = house();
    assert.equal((await endlessStartFresh(e, { button: 5, device: "Pro Plus" })).status, "asked");
    assert.equal((await endlessPageSteer(e, { button: 5, words: "more like this" })).status, "asked");
    const st = await endlessLoad(e);
    assert.deepEqual(Object.values(st.jobs).map((j) => j.kind).sort(), ["fresh", "steer"]);
  } finally { sp.restore(); }
});

test("waiting: Start fresh, More like this and Change it up refuse, and leave the ledger as it was", async () => {
  const player = { now: { pid: HANK, at: 0 } };
  const sp = spotify(player);
  try {
    const e = waitingHouse();
    assert.equal((await endlessStartFresh(e, { button: 5, device: "Pro Plus" })).status, "no-curator");
    assert.equal((await endlessPageSteer(e, { button: 5, words: "more like this" })).status, "no-curator");
    assert.equal((await endlessPageSteer(e, { button: 5, words: "change it up", leaveWords: true })).status, "no-curator");
    assert.deepEqual(sp.rung, []);
    await untouched(e, "the page's buttons");
  } finally { sp.restore(); }
});

test("twin: with a curator a DJ put on a house preset takes it, and their first set is asked for", async () => {
  const sp = spotify({ now: null });
  try {
    const e = house();
    const r = await endlessAssign(e, { dj: "vibe", button: 5 });
    assert.equal(r.status, "done");
    assert.ok(Object.values((await endlessLoad(e)).jobs).some((j) => j.kind === "fresh" && j.dj === "vibe"));
  } finally { sp.restore(); }
});

test("waiting: Swap and \"Make X a house DJ\" refuse: no assignment, no job, no rename", async () => {
  const sp = spotify({ now: null });
  try {
    const e = waitingHouse();
    const r = await endlessAssign(e, { dj: "vibe", button: 5 });
    assert.equal(r.status, "no-curator");
    assert.deepEqual((await endlessLoad(e)).assign, {}, "Hank keeps his preset");
    assert.deepEqual(sp.writes(), [], "not renamed");
    await untouched(e, "the assign");
  } finally { sp.restore(); }
});

test("twin: with a curator steer_endless takes a direction for the DJ playing", async () => {
  const sp = spotify({ now: { pid: HANK, at: 0 } });
  try {
    const out = await callTool(house(), "steer_endless", { words: "no ballads" }, B());
    assert.ok(out, "taken");
  } finally { sp.restore(); }
});

test("waiting: steer_endless is refused in the house's words, with nothing filed", async () => {
  const sp = spotify({ now: { pid: HANK, at: 0 } });
  try {
    const e = waitingHouse();
    await assert.rejects(callTool(e, "steer_endless", { words: "no ballads" }, B()), /This house has no curator yet[\s\S]*Nothing was changed/);
    await assert.rejects(callTool(e, "steer_endless", { words: "harder", when: "now", uris: [T(1), T(2), T(3)] }, B()), /This house has no curator yet/);
    assert.deepEqual(sp.writes(), [], "a steer that brings its own songs writes nothing either");
    await untouched(e, "the steer");
  } finally { sp.restore(); }
});

test("waiting: endless with words, for a DJ who has no preset, says the house has no curator (not \"no guest DJ slot\")", async () => {
  const sp = spotify({ now: null });
  try {
    const e = waitingHouse();
    const out = await callTool(e, "play_endless", { dj: "Genre", words: "ska", device: "Pro Plus" }, B());
    assert.match(out.said, /This house has no curator yet/);
    assert.ok(!sp.calls.includes("PUT /me/player/play"), "nothing started");
    await untouched(e, "endless with words");
  } finally { sp.restore(); }
});

test("extend_endless with no job to answer is refused, waiting or not, and writes nothing", async () => {
  const sp = spotify({ now: null });
  try {
    for (const e of [waitingHouse(), house()]) {
      await assert.rejects(callTool(e, "extend_endless", { job_id: "endless-5-topup-1", uris: [T(1), T(2), T(3)] }, B()));
      assert.deepEqual(sp.writes(), []);
    }
  } finally { sp.restore(); }
});

// -------------------------------------- put a DJ on: their own preset plays
test("twin: in a house with a guest DJ preset, \"put on Hank\" starts his own preset", async () => {
  const sp = spotify({ now: null });
  try {
    const r = await playEndless(house({ lane: true }), { dj: "hank", device: "Pro Plus", budget: B() });
    assert.deepEqual([r.status, r.button], ["own-preset", 5]);
    assert.ok(sp.calls.includes("PUT /me/player/play"));
  } finally { sp.restore(); }
});

test("with no guest DJ preset, \"put on Hank\" still starts his own preset: waiting, and with a curator", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    for (const e of [waitingHouse(), house()]) {
      sp.calls.length = 0;
      const r = await playEndless(e, { dj: "hank", device: "Pro Plus", budget: B() });
      assert.deepEqual([r.status, r.button], ["own-preset", 5]);
      assert.ok(sp.calls.includes("PUT /me/player/play"), "the playlist is started");
    }
    // By the tool, as Claude, ChatGPT, Talk and maple crate ask it.
    const w = waitingHouse();
    player.now = { pid: HANK, at: 0 };   // the speaker takes it, so the read-back hears his list
    const out = await callTool(w, "play_endless", { dj: "Hank", device: "Pro Plus" }, B());
    assert.equal(out.preset, 5);
    assert.match(out.said, /Hank is playing their own .*preset 5 on the Pro Plus/);
    await untouched(w, "a start");
    assert.equal(w.STATION.endless?.doc ?? null, null, "and the watch is not nudged: nothing at all is written to the ledger");
  } finally { sp.restore(); }
});

// ------------------------------------------- where an asked set lands
const asked = (e, dj) => callTool(e, "replace_playlist", { playlist: "guest on spotify", uris: [T(1), T(2), T(3)], dj, ask: "an hour" }, B());
const wroteTo = (sp) => [...new Set(sp.writes().filter((c) => c.endsWith("/items")).map((c) => c.split("/")[2]))];

test("twin: with a curator a set asked of Hank goes on Requests, and his endless playlist is never written", async () => {
  const sp = spotify({ now: null });
  try {
    const out = await asked(house(), "hank");
    assert.deepEqual(wroteTo(sp), [REQ]);
    assert.ok(out);
  } finally { sp.restore(); }
});

test("waiting: a set asked of Hank lands on his own preset, the answer says where, and Requests is as it was", async () => {
  const sp = spotify({ now: null });
  try {
    const e = waitingHouse();
    const out = await asked(e, "hank");
    assert.deepEqual(wroteTo(sp), [HANK], "the house decides, not the chat: the write goes to Hank's own playlist");
    assert.match(JSON.stringify(out), /Hank's own preset, 5[\s\S]*Requests is as it was/);
    assert.match(JSON.stringify(out), new RegExp(HANK), "the playlist to play is named, for play_playlist");
    // endlessWrote ran: the pages' mark for this playlist is the new set's.
    assert.equal(JSON.parse(await e.PROGRAMS.get(`mark:${HANK}`))?.n, 3, "the write is marked, as every endless write is");
    await untouched(e, "an asked set");   // and a waiting preset has no session, job, run or history to mend
  } finally { sp.restore(); }
});

test("waiting: a set asked of a DJ with no preset still goes on Requests", async () => {
  const sp = spotify({ now: null });
  try {
    await asked(waitingHouse(), "vibe");
    assert.deepEqual(wroteTo(sp), [REQ]);
  } finally { sp.restore(); }
});

test("waiting: a set aimed straight at Hank's endless playlist, with no DJ named, is still refused", async () => {
  const sp = spotify({ now: null });
  try {
    await assert.rejects(callTool(waitingHouse(), "replace_playlist", { playlist: HANK, uris: [T(1), T(2), T(3)] }, B()), /Nothing was written/);
    assert.deepEqual(sp.writes(), []);
  } finally { sp.restore(); }
});

test("waiting: get_dj tells the chat where Hank's set lands and how to play him, with no guest DJ preset", async () => {
  const hank = await callTool(waitingHouse(), "get_dj", { name: "Hank" }, B());
  assert.equal(hank.endless_preset, 5);
  assert.match(hank.how_to_play, /"Play Hank" .* is play_endless \(their own preset, 5\)/);
  assert.match(hank.how_to_play, /In this house their set lands on their own preset, 5/);
  assert.doesNotMatch(hank.how_to_play, /This house plays no DJ endless|steer_endless/);
  const vibe = await callTool(waitingHouse(), "get_dj", { name: "Vibe" }, B());
  assert.match(vibe.how_to_play, /replace_playlist onto the requests preset/);
  assert.doesNotMatch(vibe.how_to_play, /lands on their own preset/);
});

// ----------------------------------------------------------- the handover
async function pageHouse(waits) {
  const e = house({ waits });
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = "setup-key-0123456789abcdef";
  e.AGENT_SECRET = "agent-key-0123456789";
  delete e.ENDLESS;
  await choosePageSetting(e, "ENDLESS", config({ waits }));
  return e;
}
const settled = async (e) => { forgetKeptSettings(e); return withSettings(e, null); };

test("the word is the page's to keep: a waiting house reads as waiting through the settings store", async () => {
  const e = await settled(await pageHouse(true));
  assert.equal(parseEndless(e).waits, true);
});

test("the handover: the curator's first check-in takes the word away, once, and the house is endless from then on", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    const base = await pageHouse(true);
    await stampCurator(await settled(base));
    const e = await settled(base);
    assert.equal(JSON.parse(e.ENDLESS).waits, undefined, "the word is gone from the stored setting");
    assert.deepEqual(JSON.parse(e.ENDLESS).presets, JSON.parse(config()).presets, "every preset and number kept");
    assert.ok(await e.PROGRAMS.get(CURATOR_SEEN_KEY), "and the check-in is stamped as ever");
    // From the next request the watch looks, and a low list asks its curator.
    e.AUTOFULFILL_ENABLED = "true"; e.REQUEST_ROUTINE_ID = "trig_test"; e.REQUEST_ROUTINE_TOKEN = "routine-token";
    await evening(e, player);
    assert.ok(events(e).includes("session-start") && events(e).includes("topup"), events(e).join(","));
    // And a set asked of Hank goes on Requests again.
    sp.calls.length = 0;
    await asked(e, "hank");
    assert.deepEqual(wroteTo(sp), [REQ]);
  } finally { sp.restore(); }
});

test("the handover keeps a preset added while it ran: the store takes the word away itself, from what it holds then", async () => {
  const base = await pageHouse(true);
  const stale = await settled(base);            // the curator's request, read before...
  const two = JSON.parse(config({ waits: true }));
  two.presets.push({ button: 7, dj: "vibe", playlist: "VIBEPLAYLIST0000000007", hours: 4 });
  await choosePageSetting(base, "ENDLESS", JSON.stringify(two));   // ...the owner adds Vibe on 7
  await stampCurator(stale);
  const after = JSON.parse((await settled(base)).ENDLESS);
  assert.equal(after.waits, undefined);
  assert.deepEqual(after.presets.map((p) => p.button), [5, 7], "Vibe's preset is not written away by a stale copy");
});
test("the handover's write fails: the word stays, the check-in is stamped all the same, and the next check-in takes it", async () => {
  const base = await pageHouse(true);
  const good = base.HOUSE;
  let down = true, tried = 0;
  // The settings store, not answering its /unwait (and its second try).
  base.HOUSE = { idFromName: good.idFromName, get: () => {
    const stub = good.get();
    return { fetch: (u, init) => {
      if (down && String(u).endsWith("/unwait")) { tried++; return Promise.resolve(new Response("down", { status: 503 })); }
      return stub.fetch(u, init);
    } };
  } };
  await stampCurator(await settled(base));
  assert.ok(tried >= 1, "the store was asked");
  let e = await settled(base);
  assert.equal(JSON.parse(e.ENDLESS).waits, true, "still waiting");
  assert.deepEqual(JSON.parse(e.ENDLESS).presets, JSON.parse(config()).presets, "and nothing else changed");
  assert.ok(await e.PROGRAMS.get(CURATOR_SEEN_KEY), "the curator did check in");
  down = false;
  await stampCurator(e);
  e = await settled(base);
  assert.equal(JSON.parse(e.ENDLESS).waits, undefined, "the next check-in takes the word");
});

test("twin: a check-in changes nothing in a house that never waited", async () => {
  const base = await pageHouse(false);
  const before = (await settled(base)).ENDLESS;
  await stampCurator(await settled(base));
  assert.equal((await settled(base)).ENDLESS, before);
});

// --------------------------------------------------- what the pages read
const get = async (e, path) => (await worker.fetch(new Request(`https://x.test${path}`), e)).text();

test("twin: with a curator Hank's page offers Start fresh", async () => {
  const sp = spotify({ now: null });
  try {
    assert.match(await get(house(), `/buttons/${KEY}/hank`), /Start fresh/);
  } finally { sp.restore(); }
});

test("waiting: Hank's page has one line in place of the endless buttons: ask him in the chat, or set up the curator", async () => {
  const sp = spotify({ now: null });
  try {
    const page = await get(waitingHouse(), `/buttons/${KEY}/hank`);
    assert.match(page, /New songs: ask Hank in Claude or ChatGPT/);
    assert.match(page, /set up the curator/);
    // No button of the page's own asks for songs or moves a DJ (the bar's
    // panel keeps its two hidden steer buttons on every page; the bar's own
    // row, below, says they are not offered).
    assert.doesNotMatch(page, /name="do" value="(fresh|more|change|put|new)"/);
    assert.doesNotMatch(page, /Start fresh|Make Hank a house DJ|Swap with another preset/);
    assert.match(page, /House DJ · preset 5 · not playing/, "never \"endless\" while it waits");
    assert.match(page, /name="do" value="start"[^>]*>.*Play</, "Play stays: it spends no run");
    assert.match(page, /Press 5 on the remote and Hank plays the songs on this preset, about an hour/, "How this works, as it is");
  } finally { sp.restore(); }
});

test("waiting: the DJs tab offers no guest-DJ play, and files Hank under his own preset", async () => {
  const sp = spotify({ now: null });
  try {
    const page = await get(waitingHouse(), `/buttons/${KEY}/djs`);
    assert.doesNotMatch(page, /action="[^"]*\/(vibe|soul|americana|genre|deep-dive)\/endless"/, "no guest-DJ play: there is no lane until its step");
    assert.match(page, /action="[^"]*\/hank\/endless"/, "Hank's square plays his own preset");
  } finally { sp.restore(); }
});

test("waiting: the checklist has a DJ presets section with Hank's preset made, and no curator row, first-set wait or work waiting", async () => {
  const e = waitingHouse();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = "setup-key-0123456789abcdef";
  e.AGENT_SECRET = "agent-key-0123456789";
  e.__page = { ENDLESS: e.ENDLESS };
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  const sec = list.sections.find((s) => /DJ presets/.test(s.title));
  assert.ok(sec, "its own section, between Core and Endless");
  assert.match(JSON.stringify(sec.rows), /Hank[\s\S]*5[\s\S]*starter set/);
  assert.ok(sec.rows.some((r) => r.href === "/setup/dj-preset"), "Add a DJ preset");
  const rows = list.sections.flatMap((s) => s.rows);
  assert.ok(!rows.some((r) => /first set|waiting on the curator|work waiting/i.test(`${r.detail ?? ""}`)), "nothing waits on a curator");
  assert.equal(await firstSet(e), null, "the setup's first-set wait is the curator's, not a waiting preset's");
});

test("twin: with a curator the first-set wait knows the house DJ's preset", async () => {
  const fs = await firstSet(house());
  assert.ok(fs && typeof fs.state === "string");
});

test("waiting: a skip on Hank's list asks nobody for songs", async () => {
  const sp = spotify({ now: { pid: HANK, at: 8 } });
  try {
    const e = waitingHouse();
    assert.equal(await endlessAfterSkip(e, { pid: HANK, uri: "spotify:track:t8" }), null);
    assert.deepEqual(sp.rung, []);
    await untouched(e, "a skip");
  } finally { sp.restore(); }
});

test("a rewrite of the page's ENDLESS keeps the word: giving up or adding a preset does not end the waiting", async () => {
  const { endlessJson } = await import("../endless.js");
  const w = parseEndless(waitingHouse());
  assert.equal(JSON.parse(endlessJson(w, w.presets)).waits, true);
  assert.equal(JSON.parse(endlessJson(w, [])).waits, true, "the last preset given up: still a house that waits");
  const t = parseEndless(house());
  assert.equal("waits" in JSON.parse(endlessJson(t, t.presets)), false, "and never added to a house that does not");
});

// ----------------------------------------------------------- still to write
// The pages that write (Add a DJ preset, Remove, the guest DJ preset's step,
// a backup while waiting, the Speakers invite) are stage 4's:
// test/setup-dj-preset.test.js and test/speakers-door.test.js.
test("the watch's nudge (a press by voice, Play on a page, a DJ put on) writes nothing while the house waits, and is the one way to nudge", async () => {
  const w = waitingHouse();
  await nudgeWatch(w);
  assert.equal(w.STATION.endless?.doc ?? null, null, "waiting: the ledger is not written at all");
  const e = house();
  await nudgeWatch(e);
  assert.equal(JSON.parse(e.STATION.endless.doc).lastLook, 0, "twin: the watch looks on its next run");
  // Every caller goes through the helper: nobody zeroes lastLook by hand.
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../", import.meta.url);
  const byHand = readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "endless.js")
    .filter((f) => /lastLook\s*=\s*0/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(byHand, []);
});
test("waiting: Loaded shows Hank's preset under House DJs and never calls it endless; the twin does", async () => {
  const sp = spotify({ now: null });
  try {
    const page = await get(waitingHouse(), `/buttons/${KEY}`);
    assert.match(page, /5 is the house DJs, each with about an hour of their songs: ask one for a set and it lands there\./);
    assert.match(page, /each hold one DJ's songs on their own preset, about an hour/);
    assert.doesNotMatch(page, /each endless on their own preset|each play one DJ, endless/);
    assert.match(page, /House DJs[\s\S]{0,600}Hank/);
    assert.match(await get(house(), `/buttons/${KEY}`), /5 is the house DJs, each endless on their own preset\./);
  } finally { sp.restore(); }
});
test("waiting: a house with no WiiM addresses lists preset 5 as Hank's on Speakers, with what it holds and not \"endless\"", async () => {
  const { ownPresetRows } = await import("../house.js");
  const sp = spotify({ now: null });
  try {
    const row = (await ownPresetRows(waitingHouse())).find((r) => r.btn === 5);
    assert.deepEqual([row.kind, row.eyebrow, row.name, row.meta], ["house", "House DJ", "Hank", "About an hour of songs · ask Hank for new ones"]);
    const twin = (await ownPresetRows(house())).find((r) => r.btn === 5);
    assert.deepEqual([twin.eyebrow, twin.meta], ["House DJ · endless", "Plays for as long as you listen"]);
  } finally { sp.restore(); }
});
test("waiting: the bar names Hank on preset 5 while his list plays, never \"endless\", and offers no steering", async () => {
  const player = { now: { pid: HANK, at: 2 } };
  const sp = spotify(player);
  try {
    const w = waitingHouse();
    const o = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), w)).json();
    assert.deepEqual(o.preset, { btn: 5, name: "Hank", dj: "hank", waits: true }, "his preset, with no session to read it from");
    assert.equal(o.who?.dj, "hank");
    assert.equal(o.who?.endless, undefined);
    const { steerOf, barWords } = await import("../programs.js");
    assert.equal(steerOf(o), null, "More like this and Change it up are not offered");
    assert.doesNotMatch(JSON.stringify(barWords(o)), /endless/);
    assert.match(JSON.stringify(barWords(o)), /preset 5, Hank/);
    await untouched(w, "the bar");
    // The twin says endless and offers the two buttons.
    const t = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), house())).json();
    assert.equal(t.preset.endless, true);
    assert.equal(steerOf(t)?.dj, "hank");
  } finally { sp.restore(); }
});
test("waiting: the house rules say what a DJ preset is and where an asked set lands, and nothing of endless; the twin's are as they were", async () => {
  const sp = spotify({ now: null });
  try {
    const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
    const w = text(await get(waitingHouse(), `/buttons/${KEY}/rules`));
    assert.match(w, /A DJ preset \(5\) holds one DJ's songs: about an hour to start with/);
    assert.match(w, /It lands on their own preset , in place of the songs there, and Requests stays as it was/);
    assert.match(w, /Hank's own preset: about an hour of their songs\. Ask Hank for a set in Claude or ChatGPT and it lands here/);
    assert.match(w, /Why did a DJ's preset stop\?/);
    assert.match(w, /Once a curator is set up .* the same presets add songs by themselves/);
    assert.doesNotMatch(w, /Always Hank, endless|endless runs a day|When does a DJ add songs|One DJ, endless/);
    const t = text(await get(house(), `/buttons/${KEY}/rules`));
    assert.match(t, /Always Hank, endless, until you put another DJ on 5/);
    assert.match(t, /12 endless runs a day/);
    assert.doesNotMatch(t, /A DJ preset \(5\) holds one DJ's songs|Why did a DJ's preset stop/);
  } finally { sp.restore(); }
});
