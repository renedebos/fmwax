// MC-38 STAGE 4, PRESETS PRESSED BY THE HOME HELPER (alexa-act.js): with the
// helper on, a preset by voice is pressed on the WiiM as its remote presses
// it (its saved settings, Tidal, the radio); hush and carry on reach what Spotify
// can't see. A stand-in helper answers as the real one does (the station's
// helper-command, as test/helper.test.js fakes it).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { alexaAct, alexaActClock, ACT_DEADLINE_MS } from "../alexa-act.js";
import { alexaHeard } from "../alexa.js";
import { station } from "../station.js";
import { makeEnv, TWO_REQUESTS } from "./harness.js";

const SKILL = "amzn1.ask.skill.00000000-test";
const ROOMS = ["Pro Plus", "Ultra", "Everywhere", "Living Room"];
const pid = (n) => `${"A".repeat(21)}${n}`;
const ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
  { button: 4, dj: "dr-funkenstein", playlist: pid(4) }, { button: 5, dj: "hank", playlist: pid(5) },
  { button: 3, lane: true, playlist: pid(3) }] });
const HOUSE_BUTTONS = TWO_REQUESTS;

// The Pro Plus's own preset table, as a phone or the helper last read it.
const TABLE = [
  { btn: 1, name: "Requests · Spotify", source: "Spotify" }, { btn: 2, name: "Requests · Tidal", source: "TIDAL" },
  { btn: 4, name: "Dr. Funkenstein", source: "Spotify" }, { btn: 5, name: "Hank", source: "Spotify" },
  { btn: 10, name: "KQED", source: "TuneIn" },
];

async function house({ speakers = { "Pro Plus": { name: "Pro Plus", state: "stop" }, Ultra: { name: "Ultra", state: "stop" } },
  hands = null, table = TABLE } = {}) {
  const e = makeEnv();
  Object.assign(e, { ALEXA_SKILL_ID: SKILL, ROOM_DEVICES: JSON.stringify(ROOMS), REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true",
    ENDLESS, BUTTONS: JSON.stringify(HOUSE_BUTTONS), ALEXA_ACTS: "on", HELPER_SECRET: "home-key",
    WIIM_SPEAKERS: JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" }) });
  const asked = [];
  if (hands) e.STATION.endless.hands = async (a) => { asked.push(a); return hands(a); };
  await station(e, "helper-put", { doc: { at: Date.now(), speakers: Object.fromEntries(Object.entries(speakers)) } });
  await e.PROGRAMS.put("reading:pro-plus", JSON.stringify({ presets: table, at: new Date().toISOString(), by: "shortcut" }));
  return { e, asked };
}
// Each built request its own id: the door answers an id once (alexaOnce).
let requestSeq = 0;
function alexa(request) {
  return { version: "1.0", session: { new: true, sessionId: "s", application: { applicationId: SKILL } },
    context: { System: { application: { applicationId: SKILL } } }, request: { requestId: `amzn1.echo-api.request.${++requestSeq}`, timestamp: new Date().toISOString(), ...request } };
}
const intent = (name, slots = {}) => ({ type: "IntentRequest",
  intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, ...v }])) } });
const matched = (value, id) => ({ value, resolutions: { resolutionsPerAuthority: [
  { status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: value } }] }] } });
const presetN = (n, room) => intent("PresetIntent", { number: { value: String(n) }, ...(room ? { room } : {}) });

// Spotify, quiet, recording what it is asked.
let calls = [];
let original = null;
function spotify() {
  calls = [];
  original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push(`${init.method || "GET"} ${u.pathname.replace(/^\/v1/, "")}`);
    if (u.hostname === "accounts.spotify.com") return Response.json({ access_token: "t", expires_in: 3600 });
    if (u.pathname.endsWith("/me/player/devices")) return Response.json({ devices: [{ id: "d-pro", name: "Pro Plus" }, { id: "d-ultra", name: "Ultra" }] });
    if (u.pathname.endsWith("/me/player") && (init.method || "GET") === "GET") return new Response(null, { status: 204 });
    if (u.pathname.includes("/me/player")) return new Response(null, { status: 204 });
    return Response.json({});
  };
}
afterEach(() => { if (original) globalThis.fetch = original; original = null; alexaActClock.deadlineMs = ACT_DEADLINE_MS; });
const pressed = (a) => ({ ok: true, reading: { name: a.speaker, state: "play", source: "TuneIn", station: "KQED" } });

async function act(e, req) {
  const later = [];
  const out = await alexaAct(e, { waitUntil: (p) => later.push(p) }, alexaHeard(alexa(req), e, Date.now()));
  await Promise.all(later);
  return out;
}

test("with the helper on, a preset is pressed on the WiiM, whatever it holds: the radio, Tidal, a DJ", async () => {
  spotify();
  const { e, asked } = await house({ hands: pressed });
  assert.equal((await act(e, presetN(10))).say, "Pressed 10 on the Pro Plus: KQED.");
  assert.deepEqual(asked.at(-1), { cmd: "key", n: 10, speaker: "Pro Plus" });
  assert.equal((await act(e, presetN(2))).say, "Pressed 2 on the Pro Plus: Requests on Tidal.");
  const five = await act(e, presetN(5));
  assert.equal(five.say, "Pressed 5 on the Pro Plus: Hank.");
  assert.deepEqual(five.did, { preset: 5, press: 5, on: "Pro Plus", code: "ok", heard: { state: "play", source: "TuneIn" } });
  // Pressed, so Spotify was never asked to start anything.
  assert.ok(!calls.some((c) => c.startsWith("PUT /me/player/play")), calls.join("\n"));
  // On the Ultra, its own table unread: pressed, named by number only.
  assert.equal((await act(e, presetN(10, matched("ultra", "Ultra")))).say, "Pressed 10 on the Ultra.");
});

test("the guard: an Echo has no keys and the helper off presses nothing; today's start, said with why", async () => {
  spotify();
  const off = await house();
  assert.equal((await act(off.e, presetN(2))).say,
    "Preset 2 is Requests on Tidal, which can't be started from here: the home helper is off. Press 2 on the remote.");
  const five = await act(off.e, presetN(5));
  assert.match(five.say, / The home helper is off, so any settings saved with the preset aren't applied on the Pro Plus\.$/);
  assert.equal(five.did.dj, "hank");
  spotify();
  const on = await house({ hands: pressed });
  const echo = await act(on.e, presetN(2, matched("living room", "Living_Room")));
  // An Echo has no remote: where the preset plays instead.
  assert.equal(echo.say, "Preset 2 is Requests on Tidal, which plays only on the Pro Plus and the Ultra. Ask for preset 2 on the Pro Plus.");
  assert.equal(on.asked.length, 0, "nothing sent to an Echo");
});

test("a speaker with no keys: what a preset holds is the WiiMs' own word, and an old alias is never started over it", async () => {
  // 2026-11-08, the bedroom Echo: 10 tried an old Spotify list and said "I
  // couldn't start"; 12 said "Press 12 on the remote"; 11 would have started
  // Americana's list, its old "was button 11 spotify" alias.
  spotify();
  const table = [...TABLE, { btn: 6, name: "Old Mix", source: "Spotify" }, { btn: 11, name: "Party Music for Everyone", source: "Pandora2" },
    { btn: 12, name: "Radio Paradise", source: "WiiM radio" }];
  const { e, asked } = await house({ hands: pressed, table });
  // Spotify-shaped ids (22 characters), so each alias would start if trusted.
  const sp = (n) => `${"B".repeat(20)}${String(n).padStart(2, "0")}`;
  e.PLAYLIST_ALIASES = JSON.stringify({ "was button 10 spotify": sp(10), "was button 11 spotify": sp(7), "was button 6": sp(6) });
  const at = (n) => intent("PresetIntent", { number: { value: String(n) }, room: matched("living room", "Living_Room") });
  assert.equal((await act(e, at(10))).say,
    "Preset 10 is KQED, on the radio, which plays only on the Pro Plus and the Ultra. Ask for preset 10 on the Pro Plus.");
  assert.equal((await act(e, at(11))).say,
    "Preset 11 is Party Music for Everyone, on Pandora, which plays only on the Pro Plus and the Ultra. Ask for preset 11 on the Pro Plus.");
  assert.equal((await act(e, at(12))).say,
    "Preset 12 is Radio Paradise, on the radio, which plays only on the Pro Plus and the Ultra. Ask for preset 12 on the Pro Plus.");
  // A Spotify key the house has no list for: named, never its old alias.
  assert.equal((await act(e, at(6))).say,
    "Preset 6 is Old Mix, on Spotify, which I can only press on the Pro Plus and the Ultra. Ask for preset 6 on the Pro Plus.");
  assert.ok(!calls.some((c) => c.startsWith("PUT /me/player/play")), calls.join("\n"));
  assert.equal(asked.length, 0, "nothing sent to an Echo");
  // A DJ's preset still starts on the Echo (its playlist is the house's own).
  spotify();
  const seven = await act(e, at(4));
  assert.equal(seven.did.dj, "dr-funkenstein");
});

test("a press the WiiM hasn't begun playing four seconds on is said as starting, never as not playing", async () => {
  spotify();
  const { e } = await house({ hands: async (a) => ({ ok: true, reading: { name: a.speaker, state: "stop", source: "Web stream" } }) });
  assert.equal((await act(e, presetN(10))).say, "Pressed 10 on the Pro Plus: KQED. It may take a few seconds to start.");
});

test("a timeout is not a no: said as sent, and nothing else is started", async () => {
  spotify();
  const { e } = await house({ hands: async () => ({ ok: false, code: "timeout" }) });
  const five = await act(e, presetN(5));
  assert.equal(five.say, "I've sent the press for 5 on the Pro Plus; it may still happen. The app shows what plays.");
  assert.ok(!calls.some((c) => c.startsWith("PUT /me/player/play")), "no fallback start after a timeout");
  // Unreachable is a known no: today's start follows.
  spotify();
  const un = await house({ hands: async () => ({ ok: false, code: "unreachable" }) });
  assert.equal((await act(un.e, presetN(10))).say,
    "Preset 10 is KQED, on the radio, which can't be started from here: the helper couldn't reach it. Press 10 on the remote.");
});

test("a slow helper: past the deadline the press is said as sent, never as playing", async () => {
  spotify();
  alexaActClock.deadlineMs = 30;
  const { e } = await house({ hands: async (a) => { await new Promise((r) => setTimeout(r, 120)); return pressed(a); } });
  const out = await act(e, presetN(10));
  assert.equal(out.say, "I've sent the press for preset 10 on the Pro Plus; it may take a moment. The app shows when it plays.");
});

test("a house DJ put on by name is pressed on the key they hold now, only when the WiiM's table still names them", async () => {
  spotify();
  const { e, asked } = await house({ hands: pressed });
  const hank = await act(e, intent("PlayHank"));
  assert.equal(hank.say, "Pressed 5 on the Pro Plus: Hank.");
  assert.equal(hank.did.put, "pressed");
  assert.deepEqual(asked.at(-1), { cmd: "key", n: 5, speaker: "Pro Plus" });
  // Swapped (MC-24): Hank now holds 4, but the WiiM's 4 still reads Dr.
  // Funkenstein, so it is not pressed; the playlist is started as before.
  await station(e, "endless-put", { doc: { assign: { 4: { dj: "hank" }, 5: { dj: "dr-funkenstein" } } } });
  spotify();
  const swapped = await act(e, intent("PlayHank"));
  assert.notEqual(swapped.did.put, "pressed");
  assert.equal(asked.filter((a) => a.n === 4).length, 0, "the key the table names for someone else is never pressed");
  // A key whose name only contains the DJ's is someone else's (Codex's
  // review, 2026-11-08: "Soul Train" on Soul's key).
  spotify();
  const other = await house({ hands: pressed, table: TABLE.map((k) => (k.btn === 5 ? { ...k, name: "Hank Williams Classics" } : k)) });
  const notHis = await act(other.e, intent("PlayHank"));
  assert.notEqual(notHis.did.put, "pressed");
  assert.equal(other.asked.filter((a) => a.n === 5).length, 0, "a key that only contains the name is not pressed");
  // A guest is never pressed: 3 plays whoever is on it.
  spotify();
  const guest = await act(e, intent("PlayPubRock"));
  assert.notEqual(guest.did.put, "pressed");
});

test("hush and carry on reach the radio and Tidal through the helper, one room surely", async () => {
  spotify();
  const one = await house({ speakers: { "Pro Plus": { name: "Pro Plus", state: "play", source: "TuneIn", station: "KQED" }, Ultra: { name: "Ultra", state: "stop" } },
    hands: async (a) => ({ ok: true, reading: { name: a.speaker, state: a.cmd === "pause" ? "pause" : "play", source: "TuneIn", station: "KQED" } }) });
  assert.equal((await act(one.e, intent("QuietIntent"))).say, "Paused the radio on the Pro Plus.");
  assert.deepEqual(one.asked.at(-1), { cmd: "pause", speaker: "Pro Plus" });
  // Its reading now says paused: carry on resumes it, with no Spotify note.
  assert.equal((await act(one.e, intent("AgainIntent"))).say, "Playing the radio again on the Pro Plus.");
  assert.deepEqual(one.asked.at(-1), { cmd: "resume", speaker: "Pro Plus" });
  // Two WiiMs on the radio and no room said: Alexa asks which.
  spotify();
  const two = await house({ speakers: { "Pro Plus": { name: "Pro Plus", state: "play", source: "TuneIn" }, Ultra: { name: "Ultra", state: "play", source: "TIDAL" } },
    hands: pressed });
  const which = await act(two.e, intent("QuietIntent"));
  assert.match(which.say, /^The Pro Plus and the Ultra are both playing: say which/);
  assert.equal(two.asked.length, 0, "nothing paused");
  // The room said: only that one.
  assert.equal((await act(two.e, intent("QuietIntent", { room: matched("ultra", "Ultra") }))).say, "Paused TIDAL on the Ultra.");
  assert.deepEqual(two.asked.at(-1), { cmd: "pause", speaker: "Ultra" });
});

test("what's playing names the radio or Tidal when Spotify plays nothing", async () => {
  spotify();
  const { e } = await house({ speakers: { "Pro Plus": { name: "Pro Plus", state: "play", source: "TuneIn", station: "KQED" } } });
  assert.equal((await act(e, intent("NowIntent"))).say, "On the Pro Plus: KQED, on the radio.");
  spotify();
  const t = await house({ speakers: { Ultra: { name: "Ultra", state: "play", source: "TIDAL", track: "Just Like Honey", artists: "The Jesus and Mary Chain" } } });
  assert.equal((await act(t.e, intent("NowIntent"))).say, "On the Ultra: Just Like Honey, by The Jesus and Mary Chain, on TIDAL.");
});

// THE INPUTS ARE NOT MUSIC (MC-39, the owner's yes, 2026-11-08): a WiiM left
// on the TV's optical, a line-in or Bluetooth reads "play" while silent, so
// maple crate never calls it playing and never pauses it, as the bar has not
// since 2026-09-27. A stream that isn't Spotify still is music: WiiM radio.
test("a WiiM on an input is not playing: what's playing passes it by, and hush never pauses it", async () => {
  for (const source of ["Optical", "Line-In", "Line-In 2", "Bluetooth", "HDMI", "USB"]) {
    spotify();
    const { e, asked } = await house({ speakers: { "Pro Plus": { name: "Pro Plus", state: "play", source }, Ultra: { name: "Ultra", state: "stop" } },
      hands: pressed });
    assert.equal((await act(e, intent("NowIntent"))).say, "Nothing is playing on Spotify.", source);
    await act(e, intent("QuietIntent"));
    assert.equal(asked.filter((a) => a.cmd === "pause").length, 0, `${source}: nothing paused`);
  }
  spotify();
  const radio = await house({ speakers: { "Pro Plus": { name: "Pro Plus", state: "play", source: "WiiM radio", station: "Radio Paradise" } } });
  assert.equal((await act(radio.e, intent("NowIntent"))).say, "On the Pro Plus: Radio Paradise, on the radio.");
});
