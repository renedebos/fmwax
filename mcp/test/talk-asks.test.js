// TALK TAKES THE ORDER (MC-36, deploy 1; tasks/mc36-talk-hands-off.md). A set
// asked of a DJ by voice used to be made on the call, step by step through the
// phone's page, and a hang-up, another tab or a locked phone lost it (the
// owner, 2026-10-27). Now Talk files it through the Ask form's own door
// (asks.js): the record, the ledger's row and the curator's doorbell, the
// same as a typed ask, and Talk says the person can hang up. Only where asks
// are on and the curator is woken for them; anywhere else nothing changed.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { VOICE_PROMPT, backendPrompt } from "../voice.js";
import { askMinutes, logArgs, playingMark, startAsked, startedSince } from "../asks.js";
import { callTool } from "../tools.js";
import { findSpokenDj } from "../house.js";
import { makeEnv, installFetch } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const GS = "GUESTSPOTIFY0000000001";
const GT = "0b1f2c3d-aaaa-bbbb-cccc-000000000002";
const OFFER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n";
const ANSWER = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\ns=answer\r\n";

// The owner's house in small: the Spotify requests preset live on 1, a DJ on
// a preset of their own on 3, two speakers, a voice, and (unless `asks` is
// false) asks on with the curator's routine to ring.
function env({ asks = true, tidal = false } = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "DJ Guest", playlist: GS, catalog: "spotify" },
    ...(tidal ? [{ button: 2, guest: true, live: true, name: "DJ Guest Tidal", playlist: GT, catalog: "tidal" }] : []),
    { button: 3, dj: "pub-rock", playlist: P(3) },
  ]);
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.TIDAL_COUNTRY = "NL";
  e.OPENAI_API_KEY = "sk-test-secret-never-shown";
  if (asks) {
    e.REQUESTS_ENABLED = "true";
    e.AUTOFULFILL_ENABLED = "true";
    e.REQUEST_ROUTINE_ID = "trig_test";
    e.REQUEST_ROUTINE_TOKEN = "routine-token";
  }
  return e;
}
const req = (door, { type, body, cap } = {}) => new Request(`https://x.test/buttons/${KEY}/talk${door ? `/${door}` : ""}`, {
  method: "POST", headers: { origin: "https://x.test", ...(type ? { "content-type": type } : {}), ...(cap ? { "x-talk-session": cap } : {}) },
  body });
// The OpenAI fake keeps what each session was told; the routine's doorbell is
// counted; Spotify's player is quiet until a play (or what `player.st` says),
// then plays what was started where it was started, unless `player.asleep`;
// everything else goes to the harness.
function line() {
  const seen = [], rung = [];
  const player = { st: null, plays: [], asleep: false };
  const f = installFetch({ openai: ({ body }) => {
    seen.push(body);
    return new Response(JSON.stringify({ session: { id: "live_abc" }, transport: { type: "webrtc", sdp: ANSWER } }),
      { status: 201, headers: { "content-type": "application/json" } });
  } });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.anthropic.com") {
      rung.push(String(init.body ?? ""));
      return Response.json({ type: "routine_fire" });
    }
    if (u.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return player.st ? Response.json(player.st) : new Response(null, { status: 204 });
    }
    if (u.pathname === "/v1/me/player/play") {
      const body = JSON.parse(init.body ?? "{}");
      player.plays.push({ device: u.searchParams.get("device_id"), context: body.context_uri });
      if (player.asleep) return Response.json({ error: { status: 404, message: "Not found." } }, { status: 404 });
      player.st = { is_playing: true, device: { id: u.searchParams.get("device_id"), name: "Pro Plus" },
        context: { uri: body.context_uri }, item: { name: "One", uri: "spotify:track:h1", duration_ms: 200000, artists: [] } };
      return new Response(null, { status: 204 });
    }
    return inner(url, init);
  };
  return { seen, rung, player, restore: () => { globalThis.fetch = inner; f.restore(); } };
}
async function open(e) {
  const res = await worker.fetch(req("session", { type: "application/sdp", body: OFFER }), e);
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).cap;
}
const ask = async (e, cap, args) => {
  const res = await worker.fetch(req("tool", { type: "application/json", cap,
    body: JSON.stringify({ name: "ask_dj", arguments: JSON.stringify(args) }) }), e);
  return { res, body: await res.json() };
};
const said = (b) => JSON.parse(b.output);
const rows = (e) => [...e.STATION.rows.values()];
const record = (e, id) => e.PROGRAMS.get(`request:${id}`, { type: "json" });

test("ask_dj files the set as the Ask form would, rings the curator, and says the person can hang up", async () => {
  const l = line();
  try {
    const e = env();
    const cap = await open(e);
    const { res, body } = await ask(e, cap, { dj: "Hank", words: "something for cooking", minutes: 45, device: "pro plus" });
    const out = said(body);
    assert.equal(out.status, "sent");
    assert.equal(out.preset, 1, "the Spotify requests preset");
    assert.equal(out.minutes, 60, "45 minutes said is the form's hour");
    assert.equal(out.said, "Hank's on it: an hour, starting on the Pro Plus in about five minutes, unless something else is " +
      "started before then. It goes on preset 1, in place of the set there. You can hang up.");
    assert.equal(res.headers.get("set-cookie"), null, "nothing started, so no speaker is stamped");
    const [row] = rows(e);
    assert.equal(rows(e).length, 1);
    assert.equal(row.dj, "hank");
    assert.equal(row.state, "pending");
    assert.equal(row.destination, GS, "bound for the live guest, as the form binds it");
    const rec = await record(e, row.id);
    assert.equal(rec.mood, "something for cooking");
    assert.equal(rec.length, 60);
    assert.equal(rec.avoid, null);
    assert.equal(rec.via, "talk");
    assert.equal(rec.device, "Pro Plus", "the house's own spelling, for the start when it lands");
    assert.deepEqual(rec.playing, { spotify: null, speaker: null }, "and what was playing: nothing");
    assert.ok(!("keep" in rec));
    assert.deepEqual(l.rung.map((b) => JSON.parse(b)), [{ text: `request ${row.id}` }], "one ring, the id and nothing else");
  } finally { l.restore(); }
});

test("the ledger's other answers are said, and what no door could offer is refused in words", async () => {
  const l = line();
  try {
    const e = env();
    const cap = await open(e);
    const first = { dj: "sessions", words: "acoustic grunge", device: "Ultra" };
    assert.equal(said((await ask(e, cap, first)).body).status, "sent");
    const again = said((await ask(e, cap, first)).body);
    assert.equal(again.status, "already");
    assert.equal(again.said, "You just asked for that; it's on its way.");
    const busy = said((await ask(e, cap, { ...first, words: "Peel sessions, the eighties" })).body);
    assert.equal(busy.status, "busy");
    assert.equal(busy.said, "Sessions is still making the last set you asked for.");
    const blank = said((await ask(e, cap, { dj: "Hank", words: " ​ ", device: "Ultra" })).body);
    assert.equal(blank.status, "blank");
    assert.match(blank.said, /What should the set be\?/);
    assert.match((await ask(e, cap, { dj: "Nobody", words: "x", device: "Ultra" })).body.error,
      /^No DJ named "Nobody"\. The DJs: Dr\. Funkenstein, Hank, .*Sessions\. Ask again with the one that was meant; ask the person only if none is near\.$/,
      "who there is, so the backend asks again in the same breath");
    const noSpeaker = await ask(e, cap, { dj: "Hank", words: "trains" });
    assert.equal(noSpeaker.res.status, 422);
    assert.match(noSpeaker.body.error, /Which speaker\?/);
    assert.equal(rows(e).length, 1, "only the first ask is in the ledger");
    assert.equal(l.rung.length, 1, "and only it rang");
  } finally { l.restore(); }
});

// A NAME HEARD, NOT TYPED (2026-11-05): Talk heard "DJ Pup Rock", get_dj
// refused it, and the ask went in 15 seconds later.
test("by voice a DJ's name a letter off finds that DJ; a name nobody is near, or typed, does not", async () => {
  const l = line();
  try {
    const e = env();
    const cap = await open(e);
    const out = said((await ask(e, cap, { dj: "DJ Pup Rock", words: "your pick", device: "Ultra" })).body);
    assert.equal(out.status, "sent");
    assert.match(out.said, /^Pub Rock's on it: an hour, starting on the Ultra/, "said with the DJ's own name");
    assert.equal(rows(e)[0].dj, "pub-rock");
    const voice = async (name, args) => (await worker.fetch(req("tool", { type: "application/json", cap,
      body: JSON.stringify({ name, arguments: JSON.stringify(args) }) }), e)).json();
    const brief = await voice("get_dj", { name: "DJ Pup Rock" });
    assert.equal(JSON.parse(brief.output).name, "Pub Rock", "get_dj by voice too");
    assert.match((await voice("get_dj", { name: "Monk" })).error, /no DJ called "Monk"/, "a DJ the house does not have");
    await assert.rejects(callTool(e, "get_dj", { name: "DJ Pup Rock" }), /no DJ called "DJ Pup Rock"/,
      "typed, a name is a name");
  } finally { l.restore(); }
  const e = env();
  const name = (s) => findSpokenDj(e, s)?.name ?? null;
  assert.equal(name("Pub rock DJ"), "Pub Rock");
  assert.equal(name("Hans"), "Hank");
  assert.equal(name("Sesions"), "Sessions");
  assert.equal(name("Dr Funkenstien"), "Dr. Funkenstein", "two letters off in a long name");
  assert.equal(name("Librarien"), "The Librarian");
  assert.equal(name("DJ Sol"), "Soul", "three letters, one off (2026-11-05, 20:35)");
  for (const gone of ["Monk", "Camille", "Professor", "Grunge", "Tempo", "ken", "Bob", "Jen", "DJ", "So"]) assert.equal(name(gone), null, gone);
});

// SAID ONLY ONCE IT IS IN (2026-11-05): the voice said "Pub Rock's on it" before
// the backend had filed anything, and the hang-up on it lost the ask.
test("the voice says it is asking until the house has the ask, and the backend files it before it says a word", async () => {
  const l = line();
  try {
    const e = env();
    await open(e);
    const s = l.seen[0].session;
    assert.match(s.instructions, /But nothing\nis asked until the backend's answer comes back, and a hang-up before it loses\nthe ask: until then say only that you are asking \("Asking Hank…"\), never that\nit is on its way, where or when it will play, or that they can hang up\./);
    const back = s.delegation.responses.instructions;
    assert.match(back, /Call ask_dj before you say anything about the set,\nwith no words of your own first: a hang-up before its answer loses the ask\./);
    assert.match(back, /\("DJ Pup Rock"\): the house finds the DJ it is nearest to, or says there is\nnone and lists the DJs: then call ask_dj again at once with the one that was\nmeant, and ask the person only when none is near\. Then say the one line in\n`said`, as it is\./);
    assert.match(back, /A set ASKED of a DJ is not curated here: it is ask_dj, as\n"Where a set goes" says, with no get_dj first\./);
    const plain = backendPrompt({ devices: ["Pro Plus", "Ultra"], defaultDevice: "Pro Plus" });
    assert.ok(!plain.includes("A set ASKED of a DJ") && !VOICE_PROMPT.includes("Asking Hank"), "without asks, as they were");
  } finally { l.restore(); }
});

test("keep, a writer's notes and the service ride the record; a Tidal ask lands on the Tidal preset", async () => {
  const l = line();
  try {
    const e = env({ tidal: true });
    const cap = await open(e);
    const lib = said((await ask(e, cap, { dj: "the Librarian", words: "Ray Charles before 1980", minutes: 90, keep: true,
      device: "Ultra" })).body);
    assert.equal(lib.status, "sent");
    assert.match(lib.said, /^The Librarian's on it: an hour and a half, starting on the Ultra .* It goes on the Shelf as well\./);
    const libRec = await record(e, rows(e).find((r) => r.dj === "the-librarian").id);
    assert.equal(libRec.keep, true);
    assert.equal(libRec.notes, "short", "a writer's kept set takes the house's notes when none were said");
    const tidal = said((await ask(e, cap, { dj: "Hank", words: "trains", service: "tidal", minutes: 200, device: "Ultra" })).body);
    assert.equal(tidal.preset, 2);
    assert.match(tidal.said, /on preset 2 in about five minutes, in place of the set there\. Press 2 to hear it: the Ultra is not a WiiM/,
      "a Tidal set starts only through the helper, on a WiiM");
    assert.equal(tidal.minutes, 120);
    const hankRow = rows(e).find((r) => r.dj === "hank");
    assert.equal(hankRow.destination, GT);
    assert.equal((await record(e, hankRow.id)).service, "tidal");
    const fns = __test.voiceFunctions(e);
    assert.deepEqual(fns.find((f) => f.name === "ask_dj").parameters.properties.service.enum, ["spotify", "tidal"],
      "a house with both offers the switch");
  } finally { l.restore(); }
});

test("lengths said aloud go onto the form's four, the nearest, a tie up, an hour when nothing was said", () => {
  for (const [said_, m] of [[45, 60], [20, 30], [100, 90], [105, 120], [75, 90], [300, 120], [0, 60], [undefined, 60], ["x", 60]]) {
    assert.equal(askMinutes(said_), m, String(said_));
  }
});

test("with asks on, Talk is offered ask_dj and told what it is; the house's other prompts carry on", async () => {
  const l = line();
  try {
    const e = env();
    await open(e);
    const s = l.seen[0].session;
    const back = s.delegation.responses;
    const fn = back.tools.find((t) => t.name === "ask_dj");
    assert.ok(fn, "offered");
    assert.deepEqual(fn.parameters.required, ["dj", "words", "device"]);
    assert.match(fn.parameters.properties.device.description, /exactly as the house names it/);
    assert.ok(!("service" in fn.parameters.properties), "no switch in a Spotify-only house");
    assert.match(back.instructions, /is ask_dj, never made on the call: the house's curator makes\nit after the call/);
    assert.match(back.instructions, /the requests preset \(preset 1 for a Spotify set\) in place of the set there/);
    assert.match(back.instructions, /A NEW program is ask_dj with that DJ and `keep` true/);
    assert.match(back.instructions, /the "replay" playlist — never over a guest or a DJ's preset/, "a set with no DJ is made on the call");
    assert.match(back.tools.find((t) => t.name === "replace_playlist").description, /A NEW set asked of a DJ is ask_dj, never this/);
    assert.match(s.instructions, /A set asked\nof a DJ needs no yes either: the house makes it after the call/);
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/talk`), e)).text();
    assert.match(page, /<b>A set you ask a DJ for<\/b> is made by the house after the call: you can hang up as soon as Talk says it's on its way\. Hang up while it is still asking and the line stays open until the ask is in\. It goes on preset 1 in place of the set there, about five minutes later, and starts on the speaker you named, unless something else has started playing since/);
    assert.match(back.instructions, /the house starts it\non `device` as it lands, unless something else has started playing since/);
  } finally { l.restore(); }
});

test("without asks or a curator, nothing changed: no ask_dj offered, refused at the door, the prompts as they were", async () => {
  const l = line();
  try {
    for (const e of [env({ asks: false }), { ...env(), AUTOFULFILL_ENABLED: "false" }]) {
      assert.ok(!__test.voiceFunctions(e).some((f) => f.name === "ask_dj"));
      const cap = await open(e);
      const s = l.seen.at(-1).session;
      assert.equal(s.instructions, VOICE_PROMPT);
      assert.equal(s.delegation.responses.instructions, backendPrompt({ devices: ["Pro Plus", "Ultra"], defaultDevice: "Pro Plus",
        replay: "replay", guests: [{ alias: "guest on spotify", btn: 1, label: "Spotify" }] }));
      assert.match((await ask(e, cap, { dj: "Hank", words: "trains", device: "Ultra" })).body.error,
        /no curator taking asks, so a set is made on the call/);
      assert.equal(rows(e).length, 0);
      const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/talk`), e)).text();
      assert.match(page, /<b>Before a playlist changes or a new set starts<\/b>, it says what it will do and waits for a yes\./);
    }
    assert.equal(l.rung.length, 0);
  } finally { l.restore(); }
});

// ------------------------------------------------- deploy 2: the start when it lands
// The house starts a set asked by voice on the speaker it named, once the
// curator's fulfil_request has written and recorded it: only while the ask is
// new, only while the preset still holds it, and only when nothing else has
// started playing since the ask (the owner's defaults 2 and 3, 2026-10-31).

const uris = (...ids) => ids.map((id) => `spotify:track:${id}`);
async function asked(e, l, args = { dj: "Hank", words: "trains", device: "Pro Plus" }) {
  const cap = await open(e);
  assert.equal(said((await ask(e, cap, args)).body).status, "sent");
  return rows(e).at(-1).id;
}

test("the set starts on the named speaker as it lands, and the curator is told", async () => {
  const l = line();
  try {
    const e = env();
    const id = await asked(e, l);
    const out = await callTool(e, "fulfill_request", { request_id: id, uris: uris("h1", "h2", "h3") }, { remaining: 40 });
    assert.equal(out.status, "ready", JSON.stringify(out));
    assert.equal(out.started_on, "Pro Plus");
    assert.match(out.note, /and the house started it on the Pro Plus, where the listener asked for it by voice\./);
    assert.deepEqual(l.player.plays, [{ device: "device-1", context: `spotify:playlist:${GS}` }], "the requests preset's list, there");
  } finally { l.restore(); }
});

test("it does not start over music somebody chose since, after 25 minutes, or for a typed ask", async () => {
  const l = line();
  try {
    // Something else started on Spotify between the ask and the landing.
    const e = env();
    const id = await asked(e, l);
    l.player.st = { is_playing: true, device: { id: "device-1", name: "Pro Plus" }, context: { uri: "spotify:album:somebodys" },
      item: { name: "X", uri: "spotify:track:x", duration_ms: 1000, artists: [] } };
    const out = await callTool(e, "fulfill_request", { request_id: id, uris: uris("h1", "h2", "h3") }, { remaining: 40 });
    assert.equal(out.status, "ready");
    assert.deepEqual(out.not_started, { on: "Pro Plus", why: "something else is playing on Spotify" });
    assert.match(out.note, /Nothing was started on the Pro Plus: something else is playing on Spotify — preset 1 plays it on its next press\./);
    assert.deepEqual(l.player.plays, []);

    // The same music still playing that played at the ask is no reason to wait.
    const same = env();
    l.player.st = { is_playing: true, device: { id: "device-1", name: "Pro Plus" }, context: { uri: "spotify:album:before" },
      item: { name: "Y", uri: "spotify:track:y", duration_ms: 1000, artists: [] } };
    const sid = await asked(same, l);
    assert.deepEqual((await record(same, sid)).playing, { spotify: "spotify:album:before", speaker: null });
    assert.equal((await callTool(same, "fulfill_request", { request_id: sid, uris: uris("s1", "s2", "s3") }, { remaining: 40 })).started_on,
      "Pro Plus");

    // Asked more than 25 minutes ago.
    const late = env();
    l.player.st = null;
    const lid = await asked(late, l);
    const rec = await record(late, lid);
    await late.PROGRAMS.put(`request:${lid}`, JSON.stringify({ ...rec, at: new Date(Date.now() - 26 * 60_000).toISOString() }));
    const lout = await callTool(late, "fulfill_request", { request_id: lid, uris: uris("l1", "l2", "l3") }, { remaining: 40 });
    assert.deepEqual(lout.not_started, { on: "Pro Plus", why: "it was asked more than 25 minutes ago" });

    // An ask typed on a DJ's page names no speaker: nothing starts, the note is as it was.
    const typed = env();
    const res = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/hank/request`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: "mood=trains&length=60" }), typed);
    assert.equal(res.status, 303);
    const plays = l.player.plays.length;
    const tout = await callTool(typed, "fulfill_request", { request_id: rows(typed)[0].id, uris: uris("t1", "t2", "t3") },
      { remaining: 40 });
    assert.ok(!("started_on" in tout) && !("not_started" in tout));
    assert.match(tout.note, /Nothing was started — preset 1 plays it on its next press\./);
    assert.equal(l.player.plays.length, plays);
  } finally { l.restore(); }
});

test("an asleep speaker is said, and the start's calls are reserved before anything is claimed", async () => {
  const l = line();
  try {
    const e = { ...env(), __playWakeWaitsMs: [1, 1] };
    const id = await asked(e, l);
    l.player.asleep = true;
    await assert.rejects(callTool(e, "fulfill_request", { request_id: id, uris: uris("h1", "h2", "h3") }, { remaining: 20 }),
      /asked by voice and starts when it lands: 24 lookups, but only 19 are left in this request — make this call on its own/);
    assert.equal(rows(e)[0].state, "pending", "nothing was claimed");
    const out = await callTool(e, "fulfill_request", { request_id: id, uris: uris("h1", "h2", "h3") }, { remaining: 40 });
    assert.equal(out.status, "ready");
    assert.deepEqual(out.not_started, { on: "Pro Plus", why: "the speaker did not answer: it is asleep" });
  } finally { l.restore(); }
});

test("what counts as other music: a new list or album, or the speaker's own source; never the set's own list", async () => {
  const st = (uri, playing = true) => ({ is_playing: playing, item: { uri: "spotify:track:t" }, context: uri ? { uri } : null });
  assert.deepEqual(playingMark(st("spotify:playlist:A"), null), { spotify: "spotify:playlist:A", speaker: null });
  assert.deepEqual(playingMark(st("spotify:playlist:A", false), null), { spotify: null, speaker: null }, "paused is quiet");
  assert.deepEqual(playingMark(st(null), null).spotify, "tracks", "a queue with no list");
  assert.equal(playingMark(null, { state: "play", source: "Tidal", playlist: "abc123def0" }).speaker, "tidal|abc123def0");
  assert.equal(playingMark(null, { state: "play", source: "Spotify" }).speaker, null, "Spotify on the speaker is Spotify's");
  assert.equal(playingMark(null, { state: "pause", source: "Tidal" }).speaker, null);
  const quiet = { spotify: null, speaker: null };
  assert.equal(startedSince(quiet, { spotify: "spotify:album:x", speaker: null }, "spotify:playlist:G"), "something else is playing on Spotify");
  assert.equal(startedSince(quiet, { spotify: "spotify:playlist:G", speaker: null }, "spotify:playlist:G"), null, "its own list");
  assert.equal(startedSince({ spotify: "spotify:album:x", speaker: null }, { spotify: "spotify:album:x", speaker: null }, "g"), null);
  assert.equal(startedSince(quiet, { spotify: null, speaker: "tuneIn|kexp" }, "g"), "the speaker is playing something else");
  assert.equal(startedSince(quiet, quiet, "g"), null);
});

test("a set that is no longer on its preset is not started", async () => {
  const e = env();
  await e.PROGRAMS.put(`ask:${GS}`, JSON.stringify({ requestId: "another" }));
  const out = await startAsked(e, { requestId: "mine", record: { device: "Pro Plus", at: new Date().toISOString(),
    playing: { spotify: null, speaker: null } }, pid: GS, catalog: "spotify", btn: 1, name: "DJ Guest" });
  assert.deepEqual(out, { not_started: "Pro Plus", why: "another set has landed on the preset since" });
  assert.equal(await startAsked(e, { requestId: "mine", record: { at: new Date().toISOString() }, pid: GS }), null,
    "nothing asked to start");
});

// WHAT THE LOG SAYS OF A VOICE CALL (Codex's review, 2026-11-11): the tool's
// choices, and of a listener's own words only their length.
test("a Talk log line names the DJ and the speaker, never the listener's words", () => {
  const line = logArgs({ dj: "vibe", words: "something for my mother's funeral", avoid: "", minutes: 20, keep: false,
    device: "Pro Plus", uris: ["a", "b"], query: "Nick Drake Pink Moon" });
  assert.ok(!/funeral|mother|Nick Drake/.test(line), line);
  assert.match(line, /"dj":"vibe"/);
  assert.match(line, /"device":"Pro Plus"/);
  assert.match(line, /"words":"<33 chars>"/, "how long, which is how an empty field shows");
  assert.match(line, /"avoid":"<0 chars>"/);
  assert.match(line, /"minutes":20/);
  assert.match(line, /"uris":"\[2\]"/);
  assert.ok(logArgs(null) === "{}" && logArgs({ a: "x".repeat(5000) }).length <= 160);
});
