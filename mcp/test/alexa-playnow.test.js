// MC-47 STAGE 2, PLAY NOW BY ALEXA IN DRY RUN (alexa.js alexaPlayNow;
// tasks/mc47-build.md). "Ask maple crate to play the Beatles on the Ultra":
// the ask is read and searched as playnow.js reads it, and the door says what
// it WOULD play, the first songs named. It starts, writes and files nothing,
// even with ALEXA_ACTS on. The searches answer from the kept ones of stage 0
// and the gate (fixtures/playnow/), as Spotify sent them, cut down.

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import worker from "../worker.js";
import { alexaGate, alexaHeard, alexaPlayNow, heardWords } from "../alexa.js";
import { alexaSigned } from "../alexa-sign.js";
import { alexaModel } from "../alexa-model.js";
import { ROSTER } from "../djs.js";
import { THROTTLE_KEY } from "../services.js";
import { makeEnv, TWO_REQUESTS } from "./harness.js";

alexaGate.signed = async () => ({ ok: true });
after(() => { alexaGate.signed = alexaSigned; });

const kept = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/playnow/${name}`, import.meta.url)));
const ANSWERS = { ...kept("stage0-answers.json"), ...kept("gate-answers.json") };
const EMPTY = { artists: [], albums: [], tracks: [] };
const keptCatalog = () => ({
  async searchAll(q) { return ANSWERS[`artist,album,track|${q}`] ?? EMPTY; },
  async search(q) { return (ANSWERS[`track|${q}`] ?? ANSWERS[`artist,album,track|${q}`])?.tracks ?? []; },
});

const SECRET = "alexa-secret-0000000000000000";
const SKILL = "amzn1.ask.skill.00000000-test";
const ROOMS = ["Pro Plus", "Ultra", "Everywhere", "Master Bedroom", "Dining Room", "Living Room", "Office", "Den", "iPhone"];
const pid = (n) => `${"A".repeat(21)}${n}`;
const ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
  { button: 4, dj: "dr-funkenstein", playlist: pid(4) }, { button: 5, dj: "hank", playlist: pid(5) },
  { button: 6, dj: "sessions", playlist: pid(6) }, { button: 7, dj: "americana", playlist: pid(7) },
  { button: 8, dj: "soul", playlist: pid(8) }, { button: 9, dj: "vibe", playlist: pid(9) },
  { button: 3, lane: true, playlist: pid(3) }] });
function env(extra = {}) {
  return Object.assign(makeEnv(), { ALEXA_SECRET: SECRET, ALEXA_SKILL_ID: SKILL, ROOM_DEVICES: JSON.stringify(ROOMS),
    DEFAULT_DEVICE: "Pro Plus", REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true", ENDLESS,
    BUTTONS: JSON.stringify(TWO_REQUESTS), PLAY_NOW: "dry", ALEXA_ACTS: "on" }, extra);
}
let seq = 0;
function alexa(request, session = {}) {
  return { version: "1.0", session: { new: true, sessionId: "s", application: { applicationId: SKILL }, ...session },
    context: { System: { application: { applicationId: SKILL }, device: { deviceId: "amzn1.ask.device.TEST" } } },
    request: { requestId: `amzn1.echo-api.request.pn${++seq}`, locale: "en-US", timestamp: new Date().toISOString(), ...request } };
}
const intent = (name, slots = {}) => ({ type: "IntentRequest",
  intent: { name, confirmationStatus: "NONE", slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, ...v }])) } });
const playNowIntent = (words) => intent("PlayNowIntent", { words: { value: words } });
// The door's reading of one request, the search answered from the kept ones.
async function heard(request, e = env(), { session, catalog = keptCatalog(), ms } = {}) {
  const body = alexa(request, session);
  return alexaPlayNow(body, e, alexaHeard(body, e, Date.now()), { catalog, ...(ms ? { ms } : {}) });
}

// Spotify at the network, for the door's own catalog: the kept searches, and
// every call written down, so a test can say nothing but searches was asked.
let fake = null;
function spotify() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const m = init.method || "GET";
    const path = u.pathname.replace(/^\/v1/, "");
    if (u.hostname === "accounts.spotify.com") return Response.json({ access_token: "t", expires_in: 3600 });
    calls.push(`${m} ${path}`);
    if (m === "GET" && path === "/search") {
      const a = ANSWERS[`${u.searchParams.get("type")}|${u.searchParams.get("q")}`] ?? EMPTY;
      const list = (x) => ({ items: x ?? [] });
      return Response.json({ artists: list(a.artists), albums: list(a.albums), tracks: list(a.tracks) });
    }
    return Response.json({});
  };
  fake = { calls, restore() { globalThis.fetch = original; } };
  return fake;
}
afterEach(() => { fake?.restore(); fake = null; });
const post = (e, body) => worker.fetch(new Request(`https://x.test/alexa/${SECRET}`, { method: "POST",
  headers: { "content-type": "application/json", "signature-256": "c2ln", signaturecertchainurl: "https://s3.amazonaws.com/echo.api/echo-api-cert.pem" },
  body: JSON.stringify(body) }), e);
async function logged(fn) {
  const lines = [];
  const was = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try { return { out: await fn(), lines }; } finally { console.log = was; }
}

test("the model has play now only where it is on: \"play {words}\" and the three answers to album or song", () => {
  const model = (playNow) => alexaModel({ roster: ROSTER, rooms: ROOMS, playNow }).interactionModel.languageModel.intents;
  const names = (playNow) => model(playNow).map((i) => i.name);
  for (const n of ["PlayNowIntent", "PickAlbumIntent", "PickSongIntent", "PickArtistIntent"]) {
    assert.ok(names(true).includes(n), n);
    assert.ok(!names(false).includes(n), `${n} in a house without play now`);
  }
  const it = model(true).find((i) => i.name === "PlayNowIntent");
  assert.deepEqual(it.slots, [{ name: "words", type: "AMAZON.SearchQuery" }]);
  for (const s of ["play {words}", "play some {words}", "put on {words}"]) assert.ok(it.samples.includes(s), s);
  // The neighbours keep their own words: a DJ, a preset, play again.
  const all = model(true);
  const owner = (s) => all.find((i) => i.samples.includes(s))?.name;
  assert.equal(owner("play hank on the {room}"), "PlayHank");
  assert.equal(owner("play preset {number}"), "PresetIntent");
  assert.equal(owner("play again"), "AgainIntent");
  assert.ok(model(true).find((i) => i.name === "PickAlbumIntent").samples.includes("the album"));
});

test("play the Beatles on the Ultra, through the door: said as what it would play, and nothing but a search, with ALEXA_ACTS on", async () => {
  const sp = spotify();
  const e = env();
  const { out, lines } = await logged(() => post(e, alexa(playNowIntent("the beatles on the ultra"))));
  const body = await out.json();
  assert.equal(body.response.outputSpeech.text,
    "I'd start The Beatles on the Ultra: In My Life, Don't Let Me Down, then Something. Deep Dive takes it from there, on preset 3.");
  assert.equal(body.response.shouldEndSession, true);
  assert.deepEqual(sp.calls, ["GET /search"], "one search, nothing started or written");
  const line = lines.find((l) => l.startsWith("alexa: IntentRequest"));
  assert.match(line, /^alexa: IntentRequest PlayNowIntent kind=play-now words="the beatles on the ultra"/);
  assert.match(line, / play=\{"kind":"artist","dj":"deep-dive","button":3,"title":"The Beatles",/);
  assert.match(line, / dry said=/);
});

test("what it would play: a song, an album, a genre on the guest preset, a DJ's own preset steered, a mood, a length left out", async () => {
  const say = async (w) => (await heard(playNowIntent(w))).say;
  assert.equal(await say("waterloo sunset"),
    "I'd start Waterloo Sunset by The Kinks on the Pro Plus, then Sunny Afternoon and A Well Respected Man. Deep Dive takes it from there, on preset 3.");
  assert.equal(await say("abbey road on the living room"), "I'd play Abbey Road, the album by The Beatles, in order, on the Living Room.");
  assert.equal(await say("krautrock"), "I'd start krautrock on the Pro Plus: By This River by Brian Eno, Trans-Europe Express by Kraftwerk, " +
    "then The Four Horsemen by Aphrodite's Child. Genre takes it from there, on preset 3.");
  assert.equal(await say("funk from the 70s on the ultra"),
    "I'd start Dr. Funkenstein on the Ultra, on preset 4, Dr. Funkenstein's own, and steer it toward funk from the 70s.");
  assert.equal(await say("something chill for dinner"), "That's a mood, not something I can look up; ask a DJ for it, Vibe for one.");
  assert.match(await say("an hour of the beatles"), /^I'd start The Beatles on the Pro Plus: .* I'd leave out the length: a set of a length is asked of a DJ\.$/);
  const x = await heard(playNowIntent("fleetwood mac"));
  assert.deepEqual(x.play.first, ["Dreams", "Landslide", "The Chain - 2004 Remaster"], "the log keeps the names as Spotify has them");
  assert.equal(x.play.searches, 1);
  assert.equal(heardWords(x), "play fleetwood mac");
});

test("unsure asks with the line open, and \"the album\" or \"the song\" answers it, once, in the same session", async () => {
  const first = await heard(playNowIntent("pet sounds on the ultra"));
  assert.equal(first.say, "Pet Sounds by The Beach Boys: the album, or the song?");
  assert.equal(first.end, false);
  assert.equal(first.reprompt, "The album, or the song?");
  const kept = first.attributes;
  assert.deepEqual({ ...kept.houseRadio, at: 0 }, { kind: "play-now-which", session: "s", at: 0, words: "pet sounds on the ultra", kinds: ["album", "song"] });
  const turn = (req, opts = {}) => heard(req, env(), { session: { new: false, attributes: kept, ...opts } });
  const song = await turn(intent("PickSongIntent"));
  assert.equal(song.say, "I'd start Pet Sounds by The Beach Boys on the Ultra, then God Only Knows and Good Vibrations. Deep Dive takes it from there, on preset 3.");
  assert.equal(song.end, true);
  assert.equal(song.attributes, undefined, "asked once");
  assert.equal((await turn(intent("PickAlbumIntent"))).say, "I'd play Pet Sounds, the album by The Beach Boys, in order, on the Ultra.");
  // Said as a "play …": the answer all the same.
  assert.equal((await turn(playNowIntent("the album"))).say, "I'd play Pet Sounds, the album by The Beach Boys, in order, on the Ultra.");
  // Not one of the two, another session, a new one: never a guess.
  assert.match((await turn(intent("PickArtistIntent"))).say, /^That wasn't one of the two/);
  assert.match((await turn(intent("PickSongIntent"), { sessionId: "other" })).say, /^Say play, then what to play/);
  assert.match((await turn(intent("PickSongIntent"), { new: true })).say, /^Say play, then what to play/);
  // A new ask inside the open line is a new ask.
  assert.match((await turn(playNowIntent("fleetwood mac"))).say, /^I'd start Fleetwood Mac/);
  // Two artists' readings: the album by one, the song by the other.
  const blue = await heard(playNowIntent("blue"));
  assert.equal(blue.say, "Blue: the album by Joni Mitchell, or the song by The Jayhawks?");
  // With no session to keep it in, the question says how to answer.
  const body = alexa(playNowIntent("jolene"));
  delete body.session;
  const closed = await alexaPlayNow(body, env(), alexaHeard(body, env(), Date.now()), { catalog: keptCatalog() });
  assert.equal(closed.say, "Jolene by Dolly Parton: the album, or the song? Say \"the album …\" or \"the song …\" first.");
  assert.equal(closed.end, true);
});

test("a neighbour said as \"play …\" is read as its own intent would be: a DJ, a preset, play again, the next song", async () => {
  const e = env({ ALEXA_ACTS: undefined });
  const via = await heard(playNowIntent("hank on the ultra"), e);
  assert.equal(via.kind, "put-on");
  assert.equal(via.via, "PlayNowIntent");
  assert.equal(via.dj, "hank");
  assert.equal(via.device, "Ultra");
  assert.equal(via.say, "I'd start Hank on the Ultra, on preset 5, Hank's own.");
  assert.equal(heardWords(via), "play hank on the ultra");
  assert.equal((await heard(playNowIntent("preset 3"), e)).kind, "preset");
  assert.equal((await heard(playNowIntent("preset seven on the ultra"), e)).preset, 7);
  const again = await heard(playNowIntent("again on the ultra"), e);
  assert.equal(again.kind, "again");
  assert.equal(again.device, "Ultra");
  assert.equal((await heard(playNowIntent("the next song"), e)).kind, "skip");
  // None of them searched.
  const none = { async searchAll() { throw new Error("searched"); }, async search() { throw new Error("searched"); } };
  assert.equal((await heard(playNowIntent("soul everywhere"), e, { catalog: none })).kind, "put-on");
});

test("off, Spotify limiting, Spotify slow, Spotify failing: said, and nothing more", async () => {
  assert.match((await heard(playNowIntent("the beatles"), env({ PLAY_NOW: undefined }))).say, /^Playing at once is off in this house/);
  const limited = env();
  await limited.PROGRAMS.put(THROTTLE_KEY, JSON.stringify({ until: Date.now() + 60000 }));
  const asked = [];
  const counting = { async searchAll(q) { asked.push(q); return EMPTY; }, async search(q) { asked.push(q); return []; } };
  assert.match((await heard(playNowIntent("the beatles"), limited, { catalog: counting })).say, /^Spotify is limiting/);
  assert.deepEqual(asked, []);
  const never = { searchAll: () => new Promise(() => {}), search: () => new Promise(() => {}) };
  assert.match((await heard(playNowIntent("the beatles"), env(), { catalog: never, ms: 20 })).say, /^Spotify took too long/);
  const broken = { async searchAll() { throw new Error("Spotify 502"); }, async search() { throw new Error("Spotify 502"); } };
  const failed = await heard(playNowIntent("the beatles"), env(), { catalog: broken });
  assert.match(failed.say, /^I couldn't search Spotify just now/);
  assert.equal(failed.error, "Spotify 502");
  assert.equal((await heard(intent("PlayNowIntent"))).say, "What should I play? For example: play the Beatles on the Ultra.");
});
