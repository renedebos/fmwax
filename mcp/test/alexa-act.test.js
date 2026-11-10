// MC-38 STAGE 3, HOUSE RADIO ACTS (alexa-act.js): with ALEXA_ACTS "on", each
// sentence the dry run reads is done through the house's own doors, and what
// is said is what was done. A small Spotify stands in, keeping what plays
// where, so a start, a pause, a skip and a move can be read back as the
// house reads them.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { alexaAct, alexaActClock, alexaActs, ACT_DEADLINE_MS } from "../alexa-act.js";
import { alexaDoor, alexaGate, alexaHeard } from "../alexa.js";
import { alexaSigned } from "../alexa-sign.js";
import { readPauseNote } from "../now.js";
import { getRequestRecord, putRequestRecord, station } from "../station.js";
import { makeEnv, track, TWO_REQUESTS } from "./harness.js";

const SKILL = "amzn1.ask.skill.00000000-test";
const SECRET = "alexa-secret-0000000000000000";
const ROOMS = ["Pro Plus", "Ultra", "Everywhere", "Master Bedroom", "Dining Room", "Living Room", "Office", "Office2", "Den", "iPhone"];
const pid = (n) => `${"A".repeat(21)}${n}`;
const ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
  { button: 4, dj: "dr-funkenstein", playlist: pid(4) }, { button: 5, dj: "hank", playlist: pid(5) },
  { button: 6, dj: "sessions", playlist: pid(6) }, { button: 7, dj: "americana", playlist: pid(7) },
  { button: 8, dj: "soul", playlist: pid(8) }, { button: 9, dj: "vibe", playlist: pid(9) },
  { button: 3, lane: true, playlist: pid(3) }] });
const HOUSE_BUTTONS = TWO_REQUESTS;
const REQUESTS_PL = HOUSE_BUTTONS.find((b) => b.button === 1).playlist;

function env(extra = {}) {
  const e = makeEnv();
  Object.assign(e, { ALEXA_SECRET: SECRET, ALEXA_SKILL_ID: SKILL, ROOM_DEVICES: JSON.stringify(ROOMS),
    REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true", ENDLESS, BUTTONS: JSON.stringify(HOUSE_BUTTONS),
    ALEXA_ACTS: "on" }, extra);
  return e;
}
// Each built request its own id: the door answers an id once (alexaOnce).
let requestSeq = 0;
function alexa(request) {
  return { version: "1.0", session: { new: true, sessionId: "s", application: { applicationId: SKILL } },
    context: { System: { application: { applicationId: SKILL }, device: { deviceId: "amzn1.ask.device.TEST" } } },
    request: { requestId: `amzn1.echo-api.request.${++requestSeq}`, locale: "en-US", timestamp: new Date().toISOString(), ...request } };
}
const intent = (name, slots = {}) => ({ type: "IntentRequest",
  intent: { name, confirmationStatus: "NONE", slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, ...v }])) } });
const matched = (value, id) => ({ value, resolutions: { resolutionsPerAuthority: [
  { authority: "x", status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: value } }] }] } });
const words = (value) => ({ words: { value } });

// SPOTIFY, IN SMALL: two speakers, one player. A play makes the playlist play
// on the device asked; a pause stops it; a move takes it to the other.
const DEVICES = [{ id: "d-pro", name: "Pro Plus" }, { id: "d-ultra", name: "Ultra" }, { id: "d-dining", name: "Dining Room" }];
let fake = null;
function spotify({ playing = null } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  const me = { st: playing };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const m = init.method || "GET";
    const path = u.pathname.replace(/^\/v1/, "");
    calls.push(`${m} ${path}${u.search}`);
    const body = (() => { try { return init.body ? JSON.parse(init.body) : null; } catch { return null; } })();
    if (u.hostname === "accounts.spotify.com") return Response.json({ access_token: "t", expires_in: 3600 });
    if (path === "/me/player/devices") return Response.json({ devices: DEVICES.map((d) => ({ ...d, is_active: me.st?.device?.id === d.id })) });
    if (path === "/me/player" && m === "GET") return me.st ? Response.json(me.st) : new Response(null, { status: 204 });
    const dev = DEVICES.find((d) => d.id === u.searchParams.get("device_id")) ?? null;
    if (path === "/me/player/play" && m === "PUT") {
      const ctx = body?.context_uri ?? me.st?.context?.uri ?? null;
      me.st = { is_playing: true, device: dev ?? me.st?.device, context: ctx ? { uri: ctx } : null, progress_ms: 0,
        shuffle_state: false, repeat_state: "off",
        item: { name: "Long Black Veil", uri: body?.offset?.uri ?? "spotify:track:T1", type: "track", duration_ms: 200000,
          artists: [{ name: "Johnny Cash" }], album: { name: "Orange Blossom Special" } } };
      return new Response(null, { status: 204 });
    }
    if (path === "/me/player/pause") { if (me.st) me.st = { ...me.st, is_playing: false }; return new Response(null, { status: 204 }); }
    if (path === "/me/player/next") { if (me.st) me.st = { ...me.st, item: { ...me.st.item, name: "Ring of Fire", uri: "spotify:track:T2" } }; return new Response(null, { status: 204 }); }
    if (path === "/me/player" && m === "PUT") {
      const to = DEVICES.find((d) => d.id === body?.device_ids?.[0]);
      if (me.st && to) me.st = { ...me.st, device: to, is_playing: body?.play !== false ? true : me.st.is_playing };
      return new Response(null, { status: 204 });
    }
    if (m !== "GET" && path.startsWith("/me/player")) return new Response(null, { status: 204 });
    if (m === "GET" && /^\/playlists\/[^/]+\/items$/.test(path)) {
      // The Requests preset holds a set of three; every other list is empty.
      const items = path.split("/")[2] === REQUESTS_PL ? ["S1", "S2", "S3"].map((id) => ({ item: track(id, `Song ${id}`, "Paul McCartney") })) : [];
      return Response.json({ total: items.length, items });
    }
    if (m === "GET" && /^\/playlists\/[^/]+$/.test(path)) return Response.json({ id: path.split("/")[2], name: "Set", description: "" });
    return Response.json({});
  };
  fake = { calls, me, restore() { globalThis.fetch = original; } };
  return fake;
}
afterEach(() => { fake?.restore(); fake = null; alexaActClock.deadlineMs = ACT_DEADLINE_MS; });
const playingOn = (device, list = pid(5), playingNow = true) => ({ is_playing: playingNow, device: DEVICES.find((d) => d.name === device),
  context: { uri: `spotify:playlist:${list}` }, progress_ms: 61000,
  item: { name: "Long Black Veil", uri: "spotify:track:T1", type: "track", duration_ms: 200000, artists: [{ name: "Johnny Cash" }], album: { name: "X" } } });

// The act for one request, as the door reads it, with a context that keeps
// what runs after the answer.
async function act(req, e = env()) {
  const later = [];
  const ctx = { waitUntil: (p) => later.push(p) };
  const heard = alexaHeard(alexa(req), e, Date.now());
  const out = await alexaAct(e, ctx, heard);
  await Promise.all(later);
  return { ...out, heard, e };
}

test("the switch: only ALEXA_ACTS \"on\" acts", () => {
  assert.equal(alexaActs({ ALEXA_ACTS: "on" }), true);
  for (const v of [undefined, "", "off", "true", "ON"]) assert.equal(alexaActs({ ALEXA_ACTS: v }), false, String(v));
});

test("an ask is filed as Talk files one, via alexa, and said as filed, never as started", async () => {
  spotify();
  const { say, did, e } = await act(intent("AskSessions", words("acoustic grunge on the ultra for two hours")));
  assert.equal(say, "Sessions is on it: two hours, starting on the Ultra in about five minutes, unless something else is " +
    "started before then. It goes on preset 1.");
  assert.equal(did.ask, "sent");
  assert.equal(did.preset, 1);
  const rec = await getRequestRecord(e, did.id);
  assert.equal(rec.via, "alexa");
  assert.equal(rec.device, "Ultra");
  assert.equal(rec.mood, "acoustic grunge");
  assert.equal(String(rec.length), "120");
  // Only a leave-out: the words as said, the leave-out the curator checks.
  spotify();
  const only = await act(intent("AskAmericana", words("no eagles")));
  const r2 = await getRequestRecord(only.e, only.did.id);
  assert.equal(r2.mood, "no eagles");
  assert.equal(r2.avoid, "eagles");
  // No curator taking asks: said, nothing filed.
  spotify();
  const off = await act(intent("AskHank", words("honky tonk")), env({ AUTOFULFILL_ENABLED: "false" }));
  assert.equal(off.say, "This house has no curator taking asks, so I couldn't ask Hank.");
  assert.equal(off.did.ask, "off");
});

test("a DJ put on starts their own preset on the speaker, read back from Spotify", async () => {
  spotify();
  const { say, did } = await act(intent("PlayHank", { room: matched("ultra", "Ultra") }));
  assert.equal(say, "Hank is playing on the Ultra.");
  assert.equal(did.put, "own-preset");
  assert.equal(did.start, "ok");
  assert.equal(fake.me.st.device.name, "Ultra");
  assert.equal(fake.me.st.context.uri, `spotify:playlist:${pid(5)}`);
  // A name alone does the same, on the default speaker.
  spotify();
  const alone = await act(intent("AskVibe"));
  assert.equal(alone.say, "Vibe is playing on the Pro Plus.");
  assert.equal(fake.me.st.context.uri, `spotify:playlist:${pid(9)}`);
});

test("a preset by number: a DJ's is that DJ put on, 1 the Requests playlist, 2 the remote", async () => {
  spotify();
  const seven = await act(intent("PresetIntent", { number: { value: "7" }, room: matched("ultra", "Ultra") }));
  assert.equal(seven.say, "Americana is playing on the Ultra.");
  assert.equal(seven.did.preset, 7);
  assert.equal(seven.did.dj, "americana");
  assert.equal(fake.me.st.context.uri, `spotify:playlist:${pid(7)}`);
  spotify();
  const one = await act(intent("PresetIntent", { number: { value: "1" } }));
  assert.equal(one.say, "Preset 1, Requests on Spotify is playing on the Pro Plus.");
  assert.equal(fake.me.st.context.uri, `spotify:playlist:${REQUESTS_PL}`);
  spotify();
  const two = await act(intent("PresetIntent", { number: { value: "2" } }));
  assert.equal(two.say, "Preset 2 is Requests on Tidal, which can't be started from here. Press 2 on the remote.");
  assert.ok(!fake.calls.some((c) => c.startsWith("PUT /me/player/play")), "nothing was started");
  // The guest preset with no DJ on it.
  spotify();
  const three = await act(intent("PresetIntent", { number: { value: "3" } }));
  assert.equal(three.say, "Preset 3 has no DJ on it right now.");
});

test("what's playing: the song, the speaker and the preset; paused told from nothing", async () => {
  spotify({ playing: playingOn("Pro Plus") });
  assert.equal((await act(intent("NowIntent"))).say, "On the Pro Plus: Long Black Veil, by Johnny Cash, from preset 5, Hank's.");
  spotify({ playing: playingOn("Pro Plus", pid(5), false) });
  assert.equal((await act(intent("NowIntent"))).say, "Paused on the Pro Plus: Long Black Veil, by Johnny Cash, from preset 5, Hank's.");
  spotify({ playing: playingOn("Pro Plus", REQUESTS_PL) });
  assert.equal((await act(intent("NowIntent"))).say, "On the Pro Plus: Long Black Veil, by Johnny Cash, from preset 1, Requests on Spotify.");
  spotify({ playing: playingOn("Pro Plus") });
  assert.equal((await act(intent("NowIntent", { room: matched("ultra", "Ultra") }))).say,
    "The Ultra isn't playing. On the Pro Plus: Long Black Veil, by Johnny Cash, from preset 5, Hank's.");
  spotify();
  assert.equal((await act(intent("NowIntent"))).say, "Nothing is playing on Spotify.");
});

test("pause, then play again: the bar's own pause note, never Spotify's resume", async () => {
  spotify({ playing: playingOn("Pro Plus") });
  const e = env();
  const paused = await act(intent("QuietIntent"), e);
  assert.equal(paused.say, "Paused on the Pro Plus.");
  assert.ok(fake.calls.some((c) => c === "PUT /me/player/pause?device_id=d-pro"), fake.calls.join("\n"));
  const note = await readPauseNote(e);
  assert.equal(note.device, "Pro Plus");
  assert.equal(note.pid, pid(5));
  const again = await act(intent("AgainIntent"), e);
  assert.equal(again.say, "Playing again on the Pro Plus.");
  const play = fake.calls.filter((c) => c.startsWith("PUT /me/player/play"));
  assert.equal(play.length, 1, "a fresh start of the set, not a bare resume");
  assert.equal(fake.me.st.is_playing, true);
  // Nothing paused now: said so.
  assert.equal((await act(intent("AgainIntent"), e)).say, "There's nothing paused to play again.");
  // A pause on a speaker that is not the one playing touches nothing.
  spotify({ playing: playingOn("Pro Plus") });
  const elsewhere = await act(intent("QuietIntent", { room: matched("ultra", "Ultra") }));
  assert.equal(elsewhere.say, "Nothing is playing on Spotify on the Ultra.");
  assert.ok(!fake.calls.some((c) => c.startsWith("PUT /me/player/pause")));
  // Nothing playing at all.
  spotify();
  assert.equal((await act(intent("QuietIntent"))).say, "Nothing is playing on Spotify.");
});

test("skip and move: on the speaker playing, and only while something plays", async () => {
  spotify({ playing: playingOn("Pro Plus") });
  assert.equal((await act(intent("SkipIntent"))).say, "Skipped.");
  assert.ok(fake.calls.some((c) => c === "POST /me/player/next?device_id=d-pro"), fake.calls.join("\n"));
  spotify({ playing: playingOn("Pro Plus") });
  const moved = await act(intent("MoveIntent", { room: matched("ultra", "Ultra") }));
  assert.equal(moved.say, "Moved to the Ultra.");
  assert.equal(fake.me.st.device.name, "Ultra");
  spotify({ playing: playingOn("Ultra") });
  assert.equal((await act(intent("MoveIntent", { room: matched("ultra", "Ultra") }))).say, "It's already playing on the Ultra.");
  spotify();
  assert.equal((await act(intent("MoveIntent", { room: matched("ultra", "Ultra") }))).say, "Nothing is playing on Spotify to move.");
  assert.equal((await act(intent("MoveIntent"))).say, "Which speaker? Say, for example: move the music to the Ultra.");
});

test("Amazon's eight seconds: a start not done by the deadline is said as begun, and finishes after the answer", async () => {
  spotify();
  alexaActClock.deadlineMs = 50;
  const lines = [];
  const was = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const { say, did } = await act(intent("PlayHank", { room: matched("ultra", "Ultra") }));
    assert.equal(say, "I've asked for Hank on the Ultra; it may take a moment. The app shows when it plays.");
    assert.equal(did.late, true);
  } finally { console.log = was; }
  // It went on after the answer, and its outcome was logged.
  assert.equal(fake.me.st?.device?.name, "Ultra");
  assert.ok(lines.some((l) => /^alexa: late PlayHank did=\{"put":"own-preset","start":"ok"/.test(l)), lines.join("\n"));
  // A preset late on a speaker the helper doesn't press is a start, never a
  // press (2026-11-08: "I've sent the press for preset 7 on the Master
  // Bedroom" was said of a start on the Echo).
  spotify();
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const seven = await act(intent("PresetIntent", { number: { value: "7" }, room: matched("ultra", "Ultra") }));
    assert.equal(seven.say, "Starting preset 7 on the Ultra; it may take a moment. The app shows when it plays.");
  } finally { console.log = was; }
});

test("own words over a set on the Requests preset: it plays out, then the DJ carries on, said as taken", async () => {
  // 2026-11-07 22:03: "more upbeat" over Sessions' set on 1 was taken, and
  // Alexa said "That didn't reach the DJ".
  const e = env();
  await e.PROGRAMS.put(`on:${REQUESTS_PL}`, JSON.stringify({ dj: "sessions", ref: null, at: Date.now() }));
  spotify({ playing: playingOn("Pro Plus", REQUESTS_PL) });
  const out = await act(intent("SteerMoreIntent", words("upbeat")), e);
  assert.equal(out.say, "Sessions plays this set to its end, then carries on that way.");
  assert.deepEqual(out.did, { steer: "after" });
  assert.equal(out.end, false, "the line stays open for the next one");
});

test("Spotify limiting the account: nothing that needs it is tried; preset 2 is still told to the remote", async () => {
  spotify({ playing: playingOn("Pro Plus") });
  const e = env();
  await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 3600 * 1000 }));
  const paused = await act(intent("QuietIntent"), e);
  assert.match(paused.say, /^Spotify is limiting the house's requests/);
  assert.ok(!fake.calls.some((c) => c.startsWith("PUT /me/player/pause")));
  assert.match((await act(intent("PresetIntent", { number: { value: "2" } }), e)).say, /Press 2 on the remote/);
});

test("through the door: acts only when the switch is on, and logs what was done", async () => {
  alexaGate.signed = async () => ({ ok: true });
  try {
    const post = async (e, req) => {
      const raw = JSON.stringify(alexa(req));
      const lines = [];
      const was = console.log;
      console.log = (...a) => lines.push(a.join(" "));
      try {
        const res = await alexaDoor(new Request(`https://x.test/alexa/${SECRET}`, { method: "POST",
          headers: { "content-type": "application/json", "signature-256": "x", signaturecertchainurl: "x" }, body: raw }),
        e, raw, Date.now(), { waitUntil() {} });
        return { body: await res.json(), lines };
      } finally { console.log = was; }
    };
    spotify();
    const on = await post(env(), intent("PlayHank"));
    assert.equal(on.body.response.outputSpeech.text, "Hank is playing on the Pro Plus.");
    assert.ok(on.lines.some((l) => / did=\{"put":"own-preset","start":"ok"/.test(l)), on.lines.join("\n"));
    spotify();
    const off = await post(env({ ALEXA_ACTS: undefined }), intent("PlayHank"));
    assert.equal(off.body.response.outputSpeech.text, "I'd start Hank on the Pro Plus, on preset 5, Hank's own.");
    assert.ok(off.lines.some((l) => / dry /.test(l)), off.lines.join("\n"));
    assert.ok(!fake.calls.some((c) => c.startsWith("PUT /me/player/play")), "the dry run started nothing");
  } finally { alexaGate.signed = alexaSigned; }
});

test("through the door, a request sent again is never acted on twice", async () => {
  alexaGate.signed = async () => ({ ok: true });
  try {
    const e = env();
    const raw = JSON.stringify(alexa(intent("PlayHank")));
    const send = () => alexaDoor(new Request(`https://x.test/alexa/${SECRET}`, { method: "POST",
      headers: { "content-type": "application/json", "signature-256": "x", signaturecertchainurl: "x" }, body: raw }),
    e, raw, Date.now(), { waitUntil() {} });
    spotify();
    const was = console.log;
    console.log = () => {};
    let first, copy;
    try { first = await send(); copy = await send(); } finally { console.log = was; }
    assert.equal((await first.json()).response.outputSpeech.text, "Hank is playing on the Pro Plus.");
    assert.equal(copy.status, 400);
    assert.equal(fake.calls.filter((c) => c.startsWith("PUT /me/player/play")).length, 1, fake.calls.join("\n"));
  } finally { alexaGate.signed = alexaSigned; }
});

test("endless with words: a guest DJ takes the guest preset with them; a house DJ's own preset starts and is steered by them", async () => {
  spotify();
  const dd = await act(intent("AskDeepDive", words("on michael jackson endless")));
  assert.equal(dd.heard.kind, "endless");
  assert.equal(dd.did.put, "making");
  assert.equal(dd.say, "Deep Dive is making an opening set for the guest preset; it starts by itself in a few minutes.");
  spotify();
  const hank = await act(intent("AskHank", words("honky tonk endless")));
  // A house DJ's own preset starts as made, and the words steer it (the
  // owner, 2026-11-08: "Sessions, acoustic grunge, endless" had dropped them).
  assert.equal(hank.say, "Hank is playing on the Pro Plus, steering toward honky tonk: the new songs come in after this one, in a few minutes.");
  assert.equal(hank.did.steer, "asked");
  assert.equal(fake.me.st.context.uri, `spotify:playlist:${pid(5)}`);
  const log = (await station(hank.e, "endless-list", { limit: 40 })).rows ?? [];
  assert.ok(log.some((r) => r.event === "steer" && /"honky tonk", by voice/.test(r.detail ?? "")), JSON.stringify(log));
});

test("a fresh start: the preset the DJ is on, made new and started on the speaker; a DJ on none is told how", async () => {
  spotify();
  const hank = await act(intent("FreshHank", { room: matched("ultra", "Ultra") }));
  assert.equal(hank.say, "Hank is making a fresh set for preset 5. It starts on the Ultra in about four minutes.");
  assert.deepEqual(hank.did, { fresh: "asked", button: 5 });
  spotify();
  const said = await act(intent("AskHank", words("fresh")));
  assert.equal(said.heard.kind, "fresh");
  spotify();
  const pub = await act(intent("FreshPubRock"));
  assert.equal(pub.say, "Pub Rock isn't on a preset right now, so there's nothing to start fresh. Say: put on Pub Rock.");
});

test("steering: the bar's two buttons on an endless preset, and a direction in the listener's words", async () => {
  spotify({ playing: playingOn("Pro Plus") });
  const more = await act(intent("MoreLikeIntent"));
  assert.equal(more.say, "Asked: the new songs come in after this one, in a few minutes.");
  assert.deepEqual(more.did, { steer: "asked", on: 5 });
  spotify({ playing: playingOn("Pro Plus") });
  const up = await act(intent("SteerMoreIntent", words("upbeat")));
  assert.equal(up.did.steer, "asked", JSON.stringify(up));
  spotify();
  const none = await act(intent("ChangeUpIntent"));
  assert.equal(none.say, "No DJ is playing to steer. Put one on first.");
});

test("back a song: Spotify's previous, on the speaker playing", async () => {
  spotify({ playing: playingOn("Pro Plus") });
  assert.equal((await act(intent("BackIntent"))).say, "Back a song.");
  assert.ok(fake.calls.some((c) => c === "POST /me/player/previous?device_id=d-pro"), fake.calls.join("\n"));
  spotify();
  assert.equal((await act(intent("BackIntent"))).say, "Nothing is playing on Spotify.");
});

test("keep: said with an ask, its record is kept; said over a requested set playing, its ask is marked kept", async () => {
  spotify();
  const asked = await act(intent("AskSessions", words("acoustic grunge and keep it")));
  assert.match(asked.say, /It goes on preset 1, and on the Shelf as well\.$/);
  assert.equal((await getRequestRecord(asked.e, asked.did.id)).keep, true);
  // A set already made, playing on the Requests preset.
  spotify({ playing: playingOn("Pro Plus", REQUESTS_PL) });
  const e = env();
  await e.PROGRAMS.put(`ask:${REQUESTS_PL}`, JSON.stringify({ requestId: "req-1", text: "acoustic grunge", at: null }));
  await putRequestRecord(e, { id: "req-1", dj: "sessions", mood: "acoustic grunge", length: 60, avoid: null }, { settled: true });
  const kept = await act(intent("KeepIntent"), e);
  assert.equal(kept.say, "Keeping it: Sessions writes its page for the Shelf in a few minutes.");
  assert.equal((await getRequestRecord(e, "req-1")).keep, true);
  // Its songs saved first, read off the preset, so the curator can write the
  // page (the first keep by voice, 2026-11-07, reached it with none).
  const saved = JSON.parse(await e.PROGRAMS.get("fulfilled:req-1"));
  assert.equal(saved.playlistId, REQUESTS_PL);
  assert.deepEqual(saved.tracks.map((t) => t.uri), ["spotify:track:S1", "spotify:track:S2", "spotify:track:S3"]);
  assert.match(saved.fingerprint, /^[0-9a-f]+$/);
  assert.equal((await act(intent("KeepIntent"), e)).say, "This set is already being kept on the Shelf.");
  // Nothing requested playing.
  spotify({ playing: playingOn("Pro Plus") });
  assert.match((await act(intent("KeepIntent"), e)).say, /^No requested set is playing right now/);
});

test("no second opening: the same guest DJ asked again while theirs is being made is told so", async () => {
  spotify();
  const e = env();
  const first = await act(intent("AskDeepDive", words("on michael jackson endless")), e);
  assert.equal(first.did.put, "making");
  const again = await act(intent("AskDeepDive", words("on michael jackson endless")), e);
  assert.equal(again.say, "Deep Dive is already making that set; it starts by itself in a few minutes.");
  assert.equal(again.did.put, "already-making");
  assert.equal((await act(intent("PlayDeepDive"), e)).did.put, "already-making", "a bare put-on of them too");
  // Other words are a new ask.
  assert.equal((await act(intent("AskDeepDive", words("on prince endless")), e)).did.put, "making");
});

test("steering and back keep the line open for the next one; everything else closes it", async () => {
  spotify({ playing: playingOn("Pro Plus") });
  assert.equal((await act(intent("MoreLikeIntent"))).end, false);
  spotify({ playing: playingOn("Pro Plus") });
  assert.equal((await act(intent("BackIntent"))).end, false);
  spotify({ playing: playingOn("Pro Plus") });
  assert.equal((await act(intent("SkipIntent"))).end, undefined);
  // Through the door, Alexa is told to listen on.
  alexaGate.signed = async () => ({ ok: true });
  try {
    spotify({ playing: playingOn("Pro Plus") });
    const raw = JSON.stringify(alexa(intent("ChangeUpIntent")));
    const res = await alexaDoor(new Request(`https://x.test/alexa/${SECRET}`, { method: "POST",
      headers: { "content-type": "application/json", "signature-256": "x", signaturecertchainurl: "x" }, body: raw }),
    env(), raw, Date.now(), { waitUntil() {} });
    const body = await res.json();
    assert.equal(body.response.shouldEndSession, false);
  } finally { alexaGate.signed = alexaSigned; }
});
