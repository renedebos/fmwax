// MC-47 STAGE 3, PLAY NOW STARTS IT (playnow-start.js; playEndless's bridge in
// endless.js; tasks/mc47-build.md). The songs a search found are the guest
// DJ's opening, started at once; the DJ follows by a steer, straight after
// the song playing when their songs land. An album plays as itself; a house
// DJ's own preset starts and is steered.

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { alexaGate } from "../alexa.js";
import { alexaSigned } from "../alexa-sign.js";
import { alexaActClock, ACT_DEADLINE_MS } from "../alexa-act.js";
import { startPlayNow, laneWords } from "../playnow-start.js";
import { makeEnv, installFetch, track, TWO_REQUESTS } from "./harness.js";

const { endlessWatch, endlessJobs, parseEndless, endlessLaneTakeover, endlessUpdate, endlessLoad, callTool, playEndless } = __test;
const P4 = "SAMPLEPLAYLIST00000013", LANE = "SAMPLEPLAYLIST00000018";
const MIN = 60_000;
const T = (n) => `spotify:track:${String(n).padStart(22, "0")}`;
const FIVE = [T(1), T(2), T(3), T(4), T(5)];

alexaGate.signed = async () => ({ ok: true });
after(() => { alexaGate.signed = alexaSigned; });

function env(extra = {}) {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 4, dj: "dr-funkenstein", playlist: P4 },
    { button: 7, lane: true, playlist: LANE },
  ] });
  e.AUTOFULFILL_ENABLED = "true";
  e.REQUEST_ROUTINE_ID = "trig_test";
  e.REQUEST_ROUTINE_TOKEN = "routine-token";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.__staleWaitsMs = [0];
  return Object.assign(e, extra);
}
// Spotify with a player that plays what it is told to: a playlist's first
// song (or the song at `at`), an album, on the Pro Plus. `asleep` refuses.
let fake = null;
function spotify({ asleep = false } = {}) {
  const f = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`old${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch;
  const me = { ctx: null, at: 0, plays: [], bells: 0 };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    const m = init.method ?? "GET";
    if (String(u).startsWith("https://api.anthropic.com/")) { me.bells += 1; return Response.json({ type: "routine_fire" }); }
    if (url.pathname === "/v1/me/player/play" && m === "PUT") {
      if (asleep) return Response.json({ error: { status: 404, message: "Device not found" } }, { status: 404 });
      const body = JSON.parse(init.body ?? "{}");
      me.plays.push(body);
      if (body.context_uri) { me.ctx = body.context_uri; me.at = 0; }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/v1/me/player" && m === "GET") {
      if (!me.ctx) return new Response(null, { status: 204 });
      const item = me.ctx === `spotify:playlist:${LANE}` || me.ctx === `spotify:playlist:${P4}` ? f.state.contents[me.at] ?? null
        : track("albumtrack1");
      return Response.json({ is_playing: true, device: { name: "Pro Plus", id: "device-1" }, context: { uri: me.ctx }, progress_ms: 0,
        shuffle_state: false, repeat_state: "off", item });
    }
    return inner(u, init);
  };
  fake = { f, me, restore: () => { globalThis.fetch = inner; f.restore(); } };
  return fake;
}
afterEach(() => { fake?.restore(); fake = null; alexaActClock.deadlineMs = ACT_DEADLINE_MS; });
const list = () => fake.f.state.contents.map((t) => t.uri);
const events = (e) => e.STATION.endless.log.map((r) => r.event);
const bridge = (e, extra = {}) => playEndless(e, { dj: "deep-dive", device: "Pro Plus", budget: { remaining: 40 }, when: "now",
  words: "The Beatles", opening: { uris: FIVE, title: "The Beatles" }, ...extra });

test("the bridge: the songs found are the guest DJ's opening, started at once, and a steer asks the DJ to follow", async () => {
  const sp = spotify();
  const e = env();
  const r = await bridge(e);
  assert.deepEqual(r, { status: "started", button: 7, start: "ok", bridge: 5, follows: "asked" });
  assert.deepEqual(list(), FIVE, "the five songs are the lane's list");
  assert.equal(sp.me.ctx, `spotify:playlist:${LANE}`, "and it plays");
  const st = await endlessLoad(e);
  assert.equal(st.lane.dj, "deep-dive");
  assert.equal(st.lane.words, "The Beatles");
  assert.equal(st.lane.program, null, "no program of the Shelf's behind it");
  assert.equal(st.lane.ready, true);
  assert.equal(st.runs, 1, "one run: the DJ's own songs; the opening cost none");
  const jobs = Object.values(st.jobs);
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job.kind, "steer");
  assert.equal(job.when, "next");
  assert.equal(job.words, "The Beatles");
  assert.equal(job.tenancy, st.lane.tenancy);
  assert.equal(st.sessions["7"].pending, job.id, "the session holds the steer as its open job");
  assert.equal(sp.me.bells, 1, "the curator is rung once");
  assert.ok(events(e).includes("lane-started") && events(e).includes("steer"));

  // The watch's first look: five songs is under its top-up line, and it asks
  // for nothing beside the steer.
  await endlessWatch(e, Date.now());
  assert.deepEqual(Object.keys((await endlessLoad(e)).jobs), [job.id]);

  // The curator answers while song 2 plays: its songs follow that song, and
  // the three found songs not yet played are gone.
  sp.me.at = 1;
  const out = await callTool(e, "extend_endless", { job_id: job.id, uris: [T(31), T(32), T(33), T(34)] }, { remaining: 40 });
  assert.equal(out.status, "steered");
  assert.deepEqual(list(), [T(1), T(2), T(31), T(32), T(33), T(34)]);
  assert.equal(sp.me.plays.length, 1, "nothing was started again: the playing song plays out");
  const done = await endlessLoad(e);
  assert.equal(done.sessions["7"].pending, false);
  assert.deepEqual(Object.keys(done.jobs), []);
});

test("the bridge takes the guest preset at once from whoever plays on it, and asked again it is a new opening", async () => {
  const sp = spotify();
  const e = env();
  // Gatefold on the lane, playing.
  await endlessUpdate(e, (st) => { const r = endlessLaneTakeover(e, parseEndless(e), st, { dj: "gatefold", now: Date.now() }); st.lane.ready = true; return r; });
  sp.me.ctx = `spotify:playlist:${LANE}`;
  const r = await bridge(e);
  assert.equal(r.status, "started", "no \"after this song, or now?\"");
  assert.equal((await endlessLoad(e)).lane.dj, "deep-dive");
  // The same artist again: the songs asked for play first, not a carry-on.
  const t1 = (await endlessLoad(e)).lane.tenancy;
  const again = await bridge(e, { opening: { uris: [T(9), T(8), T(7)], title: "The Beatles" } });
  assert.equal(again.status, "started");
  assert.deepEqual(list(), [T(9), T(8), T(7)]);
  const st = await endlessLoad(e);
  assert.ok(st.lane.tenancy > t1);
  assert.equal(Object.values(st.jobs).length, 1, "the first steer went with its tenancy");
});

test("the day's runs spent: the songs play and nobody follows; too few songs or no words is today's opening made", async () => {
  spotify();
  const e = env();
  // A first start sets today's count; then the day's twelve are spent.
  await bridge(e);
  // The first steer taken by a curator, so its run stays spent.
  await endlessUpdate(e, (st) => { st.runs = 12; for (const j of Object.values(st.jobs)) j.claimed = Date.now(); return {}; });
  const r = await bridge(e);
  assert.equal(r.status, "started");
  assert.equal(r.follows, "day-cap");
  const st = await endlessLoad(e);
  assert.deepEqual(Object.values(st.jobs), [], "no steer: the first went with its tenancy, the second was not filed");
  assert.ok(events(e).includes("steer-day-cap"));
  const said = await startPlayNow(e, artist());
  assert.equal(said.say, "Starting The Beatles on the Pro Plus, Song 1 first. No more DJ runs today, so Deep Dive can't follow: these 5 songs play, on preset 7.");
  const e2 = env();
  const few = await playEndless(e2, { dj: "deep-dive", device: "Pro Plus", budget: { remaining: 40 }, when: "now", words: "The Beatles",
    opening: { uris: [T(1), T(2)], title: "The Beatles" } });
  assert.equal(few.status, "making");
});

const artist = (extra = {}) => ({ kind: "artist", dj: "deep-dive", place: { button: 7, own: false }, words: "the beatles", title: "The Beatles",
  by: null, songs: FIVE.map((uri, i) => ({ uri, name: `Song ${i + 1}`, artist: "The Beatles" })), album: null, withWords: false,
  device: "Pro Plus", deviceFrom: "default", ...extra });

test("play now, started: an artist on the guest preset, said as done", async () => {
  spotify();
  const e = env();
  const r = await startPlayNow(e, artist());
  assert.equal(r.say, "Starting The Beatles on the Pro Plus, Song 1 first. Deep Dive takes it from there, on preset 7.");
  assert.deepEqual(r.did, { play: "artist", dj: "deep-dive", put: "started", start: "ok", button: 7, bridge: 5, follows: "asked" });
  assert.equal((await endlessLoad(e)).lane.words, "The Beatles");
  assert.equal(laneWords(artist({ withWords: true, words: "early bowie", title: "David Bowie" })), "David Bowie; early bowie");
  assert.equal(laneWords({ kind: "song", title: "Waterloo Sunset - 2014 Remaster", by: "The Kinks" }), "The Kinks; starting from the song Waterloo Sunset");
  assert.equal(laneWords({ kind: "genre", words: "90s hip hop" }), "90s hip hop");
});

test("play now, started: an album as itself, a house DJ's own preset steered, a genre with no songs found made, a speaker asleep", async () => {
  let sp = spotify();
  let e = env();
  const album = { kind: "album", dj: null, place: null, words: "abbey road", title: "Abbey Road (Remastered 2009)", by: "The Beatles", songs: [],
    album: { id: "0ETFjACtuP2ADo6LFhL6HN", uri: "spotify:album:0ETFjACtuP2ADo6LFhL6HN", name: "Abbey Road (Remastered 2009)", artist: "The Beatles" },
    device: "Pro Plus" };
  const a = await startPlayNow(e, album);
  assert.equal(a.say, "Starting Abbey Road, the album by The Beatles, on the Pro Plus.");
  assert.deepEqual(sp.me.plays.at(-1), { context_uri: "spotify:album:0ETFjACtuP2ADo6LFhL6HN", offset: { position: 0 }, position_ms: 0 });
  assert.equal((await endlessLoad(e)).lane?.dj ?? null, null, "no preset is touched");

  const funk = { kind: "genre", dj: "dr-funkenstein", place: { button: 4, own: true }, words: "funk from the 70s", title: "funk from the 70s", songs: [],
    album: null, device: "Pro Plus" };
  const o = await startPlayNow(e, funk);
  assert.equal(o.say, "Starting Dr. Funkenstein on the Pro Plus, on preset 4, Dr. Funkenstein's own; the songs turn to funk from the 70s after this one.");
  assert.equal(sp.me.ctx, `spotify:playlist:${P4}`);
  const steer = Object.values((await endlessLoad(e)).jobs).find((j) => j.kind === "steer" && j.btn === 4);
  assert.equal(steer.words, "funk from the 70s");

  const kraut = { kind: "genre", dj: "genre", place: { button: 7, own: false }, words: "krautrock", title: "krautrock", songs: [], album: null, device: "Pro Plus" };
  const g = await startPlayNow(e, kraut);
  assert.equal(g.say, "Genre makes an opening for krautrock, about four minutes, then it starts on the Pro Plus on preset 7.");
  assert.equal(g.did.put, "making");
  const fresh = Object.values((await endlessLoad(e)).jobs).find((j) => j.kind === "fresh" && j.btn === 7);
  assert.equal(fresh.words, "krautrock");

  sp.restore();
  sp = spotify({ asleep: true });
  e = env();
  const z = await startPlayNow(e, artist());
  assert.equal(z.say, "The Pro Plus didn't answer; it may be asleep. It is on preset 7: press it there.");
  assert.equal(z.did.follows, "no", "nobody is asked to follow a set that is not playing");
  assert.equal(Object.values((await endlessLoad(e)).jobs).length, 0);
  assert.equal((await startPlayNow(e, { kind: "mood", say: "That's a mood." })).say, "That's a mood.");

  // A WiiM with the door's press (through the home helper): the key is
  // pressed FIRST, Spotify is not asked to start it, and the DJ follows.
  sp.restore();
  sp = spotify();
  const e2 = env();
  const pressed = [];
  const p = await startPlayNow(e2, artist(), { press: async (n) => { pressed.push(n); return "ok"; } });
  assert.deepEqual(pressed, [7]);
  assert.equal(sp.me.plays.length, 0, "no Spotify start beside the press");
  assert.equal(p.did.start, "pressed");
  assert.equal(p.did.follows, "asked");
  assert.equal(p.say, "Starting The Beatles on the Pro Plus, Song 1 first. Deep Dive takes it from there, on preset 7.");
  assert.ok(events(e2).includes("lane-pressed"));
  // A press not confirmed, and the list not playing: no start after it, nobody follows.
  const e3 = env();
  const lost = await startPlayNow(e3, artist(), { press: async () => "timeout" });
  assert.equal(sp.me.plays.length, 0, "a timeout is never followed by a start");
  assert.equal(lost.did.follows, "no");
  assert.equal(lost.say, "I've sent the press for 7 on the Pro Plus; it may still happen. If nothing plays, press 7.");
  // Not confirmed, but the list plays: as pressed.
  const e4 = env();
  sp.me.ctx = `spotify:playlist:${LANE}`;
  const late = await startPlayNow(e4, artist(), { press: async () => "timeout" });
  assert.equal(late.did.start, "pressed");
  assert.equal(late.did.follows, "asked");
  // Nothing reached the WiiM (the helper off): Spotify starts it, as before.
  sp.me.ctx = null;
  const e5 = env();
  const off = await startPlayNow(e5, artist(), { press: async () => null });
  assert.equal(off.did.start, "ok");
  assert.equal(sp.me.plays.length, 1);
  // A house DJ's own preset, pressed first and then steered.
  const e6 = env();
  const keys = [];
  sp.me.ctx = `spotify:playlist:${P4}`;
  const own = await startPlayNow(e6, funk, { press: async (n) => { keys.push(n); return "ok"; } });
  assert.deepEqual(keys, [4]);
  assert.equal(own.did.start, "pressed");
  assert.equal(own.did.steer, "asked");
  // And when Spotify has not caught up with the press yet (the review,
  // 2026-11-19): the helper pressed the key and read the speaker back, so the
  // words are filed all the same. They were dropped as "not playing".
  const e7 = env();
  sp.me.ctx = "spotify:playlist:somethingelse0000000000";
  const lag = await startPlayNow(e7, funk, { press: async () => "ok" });
  assert.equal(lag.did.start, "pressed");
  assert.equal(lag.did.steer, "asked", "the steer is filed without waiting for Spotify");
  assert.match(lag.say, /the songs turn to/);
});

// Through the Alexa door, the search answered at the network.
const SECRET = "alexa-secret-0000000000000000", SKILL = "amzn1.ask.skill.00000000-test";
let seq = 0;
const ask = (e, words) => worker.fetch(new Request(`https://x.test/alexa/${SECRET}`, { method: "POST",
  headers: { "content-type": "application/json", "signature-256": "c2ln", signaturecertchainurl: "https://s3.amazonaws.com/echo.api/echo-api-cert.pem" },
  body: JSON.stringify({ version: "1.0", session: { new: true, sessionId: "s", application: { applicationId: SKILL } },
    context: { System: { application: { applicationId: SKILL }, device: { deviceId: "amzn1.ask.device.TEST" } } },
    request: { type: "IntentRequest", requestId: `amzn1.echo-api.request.start${++seq}`, locale: "en-US", timestamp: new Date().toISOString(),
      intent: { name: "PlayNowIntent", confirmationStatus: "NONE", slots: { words: { name: "words", value: words } } } } }) }), e);

test("through the Alexa door: with play now on it starts and says so; dry, it only says", async () => {
  const sp = spotify();
  const inner = globalThis.fetch;
  const beatles = { id: "b", name: "The Beatles" };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/search") {
      const tracks = FIVE.map((uri, i) => ({ id: uri.split(":").pop(), uri, name: `Song ${i + 1}`, artists: [beatles], album: { id: `al${i}`, name: `Album ${i}`, album_type: "album" } }));
      return Response.json({ artists: { items: [beatles] }, albums: { items: [] }, tracks: { items: tracks } });
    }
    return inner(u, init);
  };
  try {
    const on = env({ ALEXA_SECRET: SECRET, ALEXA_SKILL_ID: SKILL, ALEXA_ACTS: "on", PLAY_NOW: "on", BUTTONS: JSON.stringify(TWO_REQUESTS) });
    const lines = [];
    const was = console.log;
    console.log = (...a) => lines.push(a.join(" "));
    let body;
    try { body = await (await ask(on, "the beatles on the pro plus")).json(); } finally { console.log = was; }
    assert.equal(body.response.outputSpeech.text, "Starting The Beatles on the Pro Plus, Song 1 first. Deep Dive takes it from there, on preset 7.");
    assert.deepEqual(list(), FIVE);
    assert.match(lines.find((l) => l.startsWith("alexa: IntentRequest")), / did=\{"play":"artist","dj":"deep-dive","put":"started","start":"ok","button":7,"bridge":5,"follows":"asked"\} /);

    const dry = env({ ALEXA_SECRET: SECRET, ALEXA_SKILL_ID: SKILL, ALEXA_ACTS: "on", PLAY_NOW: "dry", BUTTONS: JSON.stringify(TWO_REQUESTS) });
    const before = sp.me.plays.length;
    const d = await (await ask(dry, "the beatles on the pro plus")).json();
    assert.match(d.response.outputSpeech.text, /^I'd start The Beatles on the Pro Plus: /);
    assert.equal(sp.me.plays.length, before, "nothing started");
    assert.equal((await endlessLoad(dry)).lane?.dj ?? null, null);
  } finally { globalThis.fetch = inner; }
});

// ---- stage 4: the other doors -------------------------------------------------

// The search, answered at the network: the Beatles, five songs of theirs.
function beatlesSearch() {
  const inner = globalThis.fetch;
  const beatles = { id: "b", name: "The Beatles" };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/search") {
      const tracks = FIVE.map((uri, i) => ({ id: uri.split(":").pop(), uri, name: `Song ${i + 1}`, artists: [beatles], album: { id: `al${i}`, name: `Album ${i}`, album_type: "album" } }));
      return Response.json({ artists: { items: [beatles] }, albums: { items: [] }, tracks: { items: tracks } });
    }
    return inner(u, init);
  };
  return () => { globalThis.fetch = inner; };
}

test("play_now, the tool every door shares: on, it starts; dry, it says; off, it is not offered and refuses", async () => {
  const sp = spotify();
  const back = beatlesSearch();
  try {
    const on = env({ PLAY_NOW: "on" });
    const r = await callTool(on, "play_now", { words: "the beatles", device: "Pro Plus" }, { remaining: 40 });
    assert.equal(r.status, "started");
    assert.equal(r.started, true);
    assert.equal(r.dj, "Deep Dive");
    assert.equal(r.preset, 7);
    assert.equal(r.dj_follows, "asked");
    assert.equal(r.said, "Starting The Beatles on the Pro Plus, Song 1 first. Deep Dive takes it from there, on preset 7.");
    assert.deepEqual(list(), FIVE);

    const dry = env({ PLAY_NOW: "dry" });
    const before = sp.me.plays.length;
    const d = await callTool(dry, "play_now", { words: "the beatles" }, { remaining: 40 });
    assert.equal(d.status, "dry");
    assert.equal(d.started, false);
    assert.match(d.said, /^I'd start The Beatles on the Pro Plus: Song 1, Song 2, then Song 3\./);
    assert.equal(sp.me.plays.length, before);

    // A DJ's name is play_endless's; a speaker not of the house is refused.
    const hank = await callTool(on, "play_now", { words: "hank" }, { remaining: 40 });
    assert.equal(hank.status, "a-dj");
    assert.match(hank.said, /call play_endless with dj "Hank"/);
    await assert.rejects(callTool(on, "play_now", { words: "the beatles", device: "Kitchen" }, { remaining: 40 }), /no speaker called "Kitchen"/);
    await assert.rejects(callTool(env(), "play_now", { words: "the beatles" }, { remaining: 40 }), /Playing at once is off in this house/);
    assert.ok(!__test.toolsWithMeta(env()).some((t) => t.name === "play_now"), "not listed where it is off");
  } finally { back(); }
});

test("Talk is told about play now only where it is on, and the TV's words reach it", async () => {
  const { backendPrompt } = await import("../voice.js");
  assert.match(backendPrompt({ playNow: true }), /# Play something now\n"Play the Beatles"/);
  assert.doesNotMatch(backendPrompt({}), /Play something now/);
  const { tvIntent } = await import("../tvsay.js");
  const rooms = ["Pro Plus", "Ultra"];
  assert.equal(tvIntent("play the beatles on the ultra", rooms, { playNow: true }).body.request.intent.name, "PlayNowIntent");
  assert.equal(tvIntent("play the beatles on the ultra", rooms), null, "off: nothing to match, as before");
  // The neighbours keep theirs on the TV too.
  assert.equal(tvIntent("play hank on the ultra", rooms, { playNow: true }).body.request.intent.name, "PlayHank");
  assert.equal(tvIntent("play the music", rooms, { playNow: true }).body.request.intent.name, "AgainIntent");
  assert.equal(tvIntent("play preset 3", rooms, { playNow: true }).body.request.intent.name, "PresetIntent");
});

test("a takeover before any curator began the last ask gives its run back; one a curator took keeps it spent", async () => {
  spotify();
  const e = env();
  await bridge(e);
  assert.equal((await endlessLoad(e)).runs, 1);
  // Asked again a moment later, nobody working on the first: still one.
  await bridge(e, { words: "The Kinks", opening: { uris: [T(9), T(8), T(7)], title: "The Kinks" } });
  let st = await endlessLoad(e);
  assert.equal(st.runs, 1, "the first steer's run came back");
  assert.equal(Object.values(st.jobs).length, 1);
  // A curator takes the second; the third ask leaves its run spent.
  await endlessUpdate(e, (s) => { for (const j of Object.values(s.jobs)) j.claimed = Date.now(); return {}; });
  await bridge(e, { words: "Coltrane", opening: { uris: [T(4), T(5), T(6)], title: "Coltrane" } });
  st = await endlessLoad(e);
  assert.equal(st.runs, 2);
});

// ---- stage 5: a DJ named with words --------------------------------------------

test("stage 5: a DJ with words and no length plays now; a length, \"a set\" or keeping it makes a set; the name alone puts them on", async () => {
  const { alexaHeard } = await import("../alexa.js");
  const ask = (intent, words) => ({ version: "1.0", request: { type: "IntentRequest", requestId: "r", timestamp: new Date().toISOString(),
    intent: { name: intent, slots: words ? { words: { name: "words", value: words } } : {} } } });
  const on = env({ PLAY_NOW: "on", REQUESTS_ENABLED: "true", BUTTONS: JSON.stringify(TWO_REQUESTS) });
  const kind = (e, intent, words) => alexaHeard(ask(intent, words), e).kind;
  assert.equal(kind(on, "AskDrFunkenstein", "some 70s soul"), "endless");
  assert.equal(kind(on, "AskDrFunkenstein", "an hour of 70s soul"), "ask-dj");
  assert.equal(kind(on, "AskDrFunkenstein", "a set of 70s soul"), "ask-dj");
  assert.equal(kind(on, "AskDrFunkenstein", "70s soul and put it on the shelf"), "ask-dj");
  assert.equal(kind(on, "AskDrFunkenstein", null), "put-on");
  const dry = env({ PLAY_NOW: "dry", REQUESTS_ENABLED: "true", BUTTONS: JSON.stringify(TWO_REQUESTS) });
  assert.equal(kind(dry, "AskDrFunkenstein", "some 70s soul"), "ask-dj", "not on: today's set");
});

test("stage 5: a house DJ with words is their preset steered; Deep Dive with an artist gets the songs found first", async () => {
  const { startDjWithWords } = await import("../playnow-start.js");
  const sp = spotify();
  const e = env();
  const own = await startDjWithWords(e, { dj: "dr-funkenstein", words: "70s soul", device: "Pro Plus" });
  assert.equal(own.say, "Starting Dr. Funkenstein on the Pro Plus, on preset 4, Dr. Funkenstein's own; the songs turn to 70s soul after this one.");
  assert.equal(sp.me.ctx, `spotify:playlist:${P4}`);
  const beatles = { id: "b", name: "The Beatles" };
  const tracks = FIVE.map((uri, i) => ({ id: uri.split(":").pop(), uri, name: `Song ${i + 1}`, artists: [beatles], album: { id: `al${i}`, name: `Album ${i}`, album_type: "album" } }));
  const catalog = { async searchAll() { return { artists: [beatles], albums: [], tracks }; }, async search() { return tracks; } };
  const dd = await startDjWithWords(e, { dj: "deep-dive", words: "the beatles", device: "Pro Plus", catalog });
  assert.equal(dd.did.bridge, 5);
  assert.equal(dd.did.follows, "asked");
  assert.deepEqual(list(), FIVE);
  // Vibe told a mood: no search, an opening made, today's way.
  const asked = [];
  const counting = { async searchAll(q) { asked.push(q); return { artists: [], albums: [], tracks: [] }; }, async search() { return []; } };
  const vibe = await startDjWithWords(e, { dj: "vibe", words: "the small hours", device: "Pro Plus", catalog: counting });
  assert.equal(vibe.did.put, "making");
  assert.deepEqual(asked, []);
});

// THE REVIVAL'S LABELS ARE HANK'S (the owner, 2026-11-19: "the Ubiquity
// label" by Talk, no DJ named, went to Soul, whose years end in 1979).
test("a revival label said with no DJ is Hank's; Stax stays Soul's", async () => {
  const { readPlayNow, beforeSearch } = await import("../playnow.js");
  for (const w of ["Ubiquity Records", "the Ubiquity label", "music from the Ubiquity label", "some Daptone", "Now-Again", "Truth & Soul"]) {
    assert.equal(beforeSearch(readPlayNow(`play ${w}`, { rooms: [] }))?.dj, "hank", w);
  }
  assert.equal(beforeSearch(readPlayNow("play some Stax", { rooms: [] }))?.dj, "soul");
});
