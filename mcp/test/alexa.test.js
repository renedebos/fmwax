// MC-38, HOUSE RADIO'S DOOR (tasks/mc38-alexa-skill.md): a private Alexa
// skill sends what it heard to /alexa/<ALEXA_SECRET>. STAGE 2, the dry run:
// the door reads it and says what it would do. It starts, writes and calls
// nothing.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../worker.js";
import { alexaCheck, alexaDoor, alexaGate, alexaHeard, ALEXA_UNCHECKED, ALEXA_WINDOW_MS } from "../alexa.js";
import { ALEXA_SEEN_KEEP_MS, station } from "../station.js";
import { alexaSigned, alexaTrust, forgetChains } from "../alexa-sign.js";
import { alexaModel, alexaRoomId, djFreshIntentName, djIntentName, djIntents, djPlayIntentName, djPlayIntents, roomOfId, spoken, spokenForms } from "../alexa-model.js";
import { ROSTER } from "../djs.js";
import { ALEXA_MODEL_FILE, renderModel } from "../install/alexa.js";
import { makeEnv, TWO_REQUESTS } from "./harness.js";

// The door's tests that are not about Amazon's signature pass it; the last
// test puts the real check back, with the test certificates
// (alexa-sign.test.js has the check's own).
alexaGate.signed = async () => ({ ok: true });
after(() => { alexaGate.signed = alexaSigned; });

const SECRET = "alexa-secret-0000000000000000";
const SKILL = "amzn1.ask.skill.00000000-test";
const NOW = Date.parse("2026-11-07T23:30:00Z");
const ROOMS = ["Pro Plus", "Ultra", "Everywhere", "Master Bedroom", "Dining Room", "Living Room", "Office", "Office2", "Den", "iPhone"];

// The house's endless presets as it has them: six house DJs and the guest
// DJ's lane on 3.
const pid = (n) => `${"A".repeat(21)}${n}`;
const ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
  { button: 4, dj: "dr-funkenstein", playlist: pid(4) }, { button: 5, dj: "hank", playlist: pid(5) },
  { button: 6, dj: "sessions", playlist: pid(6) }, { button: 7, dj: "americana", playlist: pid(7) },
  { button: 8, dj: "soul", playlist: pid(8) }, { button: 9, dj: "vibe", playlist: pid(9) },
  { button: 3, lane: true, playlist: pid(3) }] });
function env() {
  const e = makeEnv();
  e.ALEXA_SECRET = SECRET;
  e.ALEXA_SKILL_ID = SKILL;
  e.ROOM_DEVICES = JSON.stringify(ROOMS);
  e.REQUESTS_ENABLED = "true";
  e.AUTOFULFILL_ENABLED = "true";
  e.ENDLESS = ENDLESS;
  // The house's own presets 1 and 2, the Requests on Spotify and on Tidal.
  e.BUTTONS = JSON.stringify(TWO_REQUESTS);
  return e;
}
// A request as Alexa sends one: the skill's id in context and session.
// Each built request its own id: the door answers an id once (alexaOnce).
let requestSeq = 0;
function alexa(request, { skill = SKILL, at = new Date().toISOString() } = {}) {
  return {
    version: "1.0",
    session: { new: true, sessionId: "s", application: { applicationId: skill } },
    context: { System: { application: { applicationId: skill }, device: { deviceId: "amzn1.ask.device.ABCDEFGH12345678" } } },
    request: { requestId: `amzn1.echo-api.request.${++requestSeq}`, locale: "en-US", timestamp: at, ...request },
  };
}
const intent = (name, slots = {}) => ({ type: "IntentRequest",
  intent: { name, confirmationStatus: "NONE", slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, ...v }])) } });
const matched = (value, id, name = value) => ({ value, resolutions: { resolutionsPerAuthority: [
  { authority: "amzn1.er-authority.x.HOUSE", status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name } }] }] } });
const unmatched = (value) => ({ value, resolutions: { resolutionsPerAuthority: [
  { authority: "amzn1.er-authority.x.HOUSE", status: { code: "ER_SUCCESS_NO_MATCH" } }] } });

const post = (e, body, { path = `/alexa/${SECRET}`, type = "application/json; charset=utf-8", method = "POST" } = {}) =>
  worker.fetch(new Request(`https://x.test${path}`, { method, headers: { "content-type": type, "signature-256": "c2ln",
    signaturecertchainurl: "https://s3.amazonaws.com/echo.api/echo-api-cert.pem" },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }), e);

// What the door logged, for the duration of one call.
async function logged(fn) {
  const lines = [];
  const was = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try { return { out: await fn(), lines }; } finally { console.log = was; }
}

test("no secret, a wrong one, or a longer path: the house's usual 404, so a guess learns nothing", async () => {
  const bare = makeEnv();
  assert.equal((await post(bare, alexa(intent("AskHank")))).status, 404);
  const e = env();
  assert.equal((await post(e, alexa(intent("AskHank")), { path: "/alexa/wrong" })).status, 404);
  assert.equal((await post(e, alexa(intent("AskHank")), { path: `/alexa/${SECRET}/more` })).status, 404);
  assert.equal((await post(e, alexa(intent("AskHank")), { path: "/alexa/" })).status, 404);
});

test("the locks after the address: POST, JSON, a bounded body, the skill's own id, Amazon's 150 seconds", async () => {
  const e = env();
  const ok = alexa(intent("AskHank"), { at: new Date(NOW).toISOString() });
  const raw = JSON.stringify(ok);
  assert.deepEqual(alexaCheck(e, { method: "POST", type: "application/json", raw }, NOW).ok, true);
  assert.equal(alexaCheck(e, { method: "GET", type: "application/json", raw }, NOW).status, 405);
  assert.equal(alexaCheck(e, { method: "POST", type: "text/plain", raw }, NOW).status, 415);
  assert.equal(alexaCheck(e, { method: "POST", type: "application/json", raw: null }, NOW).status, 413);
  assert.equal(alexaCheck(e, { method: "POST", type: "application/json", raw: "{" }, NOW).status, 400);
  const other = JSON.stringify(alexa(intent("AskHank"), { skill: "amzn1.ask.skill.someone-else", at: new Date(NOW).toISOString() }));
  assert.equal(alexaCheck(e, { method: "POST", type: "application/json", raw: other }, NOW).why, "another skill's id");
  const late = JSON.stringify(alexa(intent("AskHank"), { at: new Date(NOW - ALEXA_WINDOW_MS - 1000).toISOString() }));
  assert.match(alexaCheck(e, { method: "POST", type: "application/json", raw: late }, NOW).why, /timestamp 151 s off/);
  const early = JSON.stringify(alexa(intent("AskHank"), { at: new Date(NOW + ALEXA_WINDOW_MS + 1000).toISOString() }));
  assert.equal(alexaCheck(e, { method: "POST", type: "application/json", raw: early }, NOW).ok, false);
  const noRequestId = alexa(intent("AskHank"), { at: new Date(NOW).toISOString() });
  delete noRequestId.request.requestId;
  assert.equal(alexaCheck(e, { method: "POST", type: "application/json", raw: JSON.stringify(noRequestId) }, NOW).why, "no request id");
  // No skill id set yet: every request refused, in words the log shows.
  const noId = { ...e, ALEXA_SKILL_ID: "" };
  assert.equal(alexaCheck(noId, { method: "POST", type: "application/json", raw }, NOW).why, "ALEXA_SKILL_ID is not set");
  // Through the route: a body past the ceiling is refused before it is read whole.
  const big = await post(e, JSON.stringify({ pad: "x".repeat(70 * 1024) }));
  assert.equal(big.status, 413);
  assert.equal((await post(e, ok, { type: "text/plain" })).status, 415);
});

test("an ask of a DJ is said back as what the house would do, and logged with the reading, never the request whole", async () => {
  const e = env();
  const { out, lines } = await logged(() => post(e, alexa(intent("AskSessions", { words: { value: "acoustic grunge on the ultra" } }))));
  assert.equal(out.status, 200);
  const body = await out.json();
  assert.equal(body.version, "1.0");
  assert.equal(body.response.outputSpeech.text, "I'd ask Sessions for acoustic grunge, an hour, starting on the Ultra.");
  assert.equal(body.response.shouldEndSession, true);
  assert.equal(body.sessionAttributes, undefined);
  const line = lines.find((l) => l.startsWith("alexa: IntentRequest"));
  assert.match(line, /^alexa: IntentRequest AskSessions kind=ask-dj words="acoustic grunge on the ultra"/);
  assert.match(line, / dj=sessions /);
  assert.match(line, / read=\{"words":"acoustic grunge","minutes":60,"lengthSaid":false,"avoid":null,"device":"Ultra","deviceFrom":"words"\} /);
  // The request whole held Alexa's access token; stage 2b stopped keeping it.
  assert.ok(!lines.some((l) => l.startsWith("alexa:raw")), lines.join("\n"));
});

test("what the door would do for each kind of request (the dry run)", () => {
  const say = (req, e = env()) => alexaHeard(alexa(req), e, Date.now());
  const ask = (dj, words) => say(intent(dj, words == null ? {} : { words: { value: words } })).say;
  // Asks of a DJ, with stage 1's words.
  assert.equal(ask("AskPubRock", "something loud on the pro plus"),
    "I'd ask Pub Rock for something loud, an hour, starting on the Pro Plus.");
  assert.equal(ask("AskAmericana", "no eagles"), "I'd ask Americana for a set, leaving out eagles, an hour, starting on the Pro Plus.");
  assert.equal(ask("AskSoul", "memphis horns in the living room"), "I'd ask Soul for memphis horns, an hour, starting on the Living Room.");
  assert.equal(ask("AskDeepDive", "on solomon burke"), "I'd ask Deep Dive for solomon burke, an hour, starting on the Pro Plus.");
  assert.equal(ask("AskGenre", "19s 90s shoegaze for two hours"), "I'd ask Genre for 19s 90s shoegaze, two hours, starting on the Pro Plus.");
  // A name alone, or with only a speaker or a length, puts the DJ on (the
  // owner, 2026-11-07); the length is dropped.
  assert.equal(ask("AskHank"), "I'd start Hank on the Pro Plus, on preset 5, Hank's own.");
  assert.equal(ask("AskVibe", "on the ultra"), "I'd start Vibe on the Ultra, on preset 9, Vibe's own.");
  assert.equal(ask("AskDrFunkenstein", "2 hours"), "I'd start Dr. Funkenstein on the Pro Plus, on preset 4, Dr. Funkenstein's own.");
  assert.equal(say(intent("AskHank")).kind, "put-on");
  // Put on: the configured preset, a house DJ's own or the guest DJ's.
  assert.equal(say(intent("PlayHank", { room: matched("ultra", "Ultra") })).say, "I'd start Hank on the Ultra, on preset 5, Hank's own.");
  assert.equal(say(intent("PlaySoul", { room: matched("everywhere", "Everywhere") })).say, "I'd start Soul everywhere, on preset 8, Soul's own.");
  assert.equal(say(intent("PlayPubRock", { room: matched("dining room", "Dining_Room") })).say,
    "I'd start Pub Rock on the Dining Room, on preset 3, the guest DJ's.");
  assert.equal(say(intent("PlayDeepDive", {})).say, "I'd start Deep Dive on the Pro Plus, on preset 3, the guest DJ's. " +
    "Deep Dive must be told an artist, so I'd ask you for one, unless that preset is still playing one.");
  assert.equal(say(intent("PlayPubRock", { room: unmatched("kitchen") })).say, "I heard kitchen, which is not one of the speakers.");
  // An id the house's list does not hold (a speaker renamed since the model
  // was pasted) is no speaker, whatever Amazon matched.
  assert.equal(say(intent("PlayHank", { room: matched("kitchen", "Kitchen") })).kind, "no-speaker");
  // What's playing.
  assert.equal(say(intent("NowIntent", {})).say, "I'd tell you what's playing on the Pro Plus.");
  assert.equal(say(intent("NowIntent", { room: matched("living room", "Living_Room") })).say, "I'd tell you what's playing on the Living Room.");
  // The house's own refusals that are config, said, never a guess.
  const noAsks = { ...env(), AUTOFULFILL_ENABLED: "false" };
  assert.equal(ask("AskHank", "honky tonk"), "I'd ask Hank for honky tonk, an hour, starting on the Pro Plus.");
  assert.equal(say(intent("AskHank", { words: { value: "honky tonk" } }), noAsks).say,
    "This house has no curator taking asks, so I couldn't ask Hank.");
  const noEndless = { ...env(), ENDLESS: "" };
  assert.equal(say(intent("PlayPubRock", {}), noEndless).say, "Endless DJs are off in this house, so I couldn't put Pub Rock on.");
  // The intents of the first model (2026-11-07 17:00) are gone.
  assert.equal(say(intent("PauseIntent", {})).kind, "other");
  assert.equal(say(intent("PutOnIntent", {})).kind, "other");
  // Kept open, asking again: closed, the next words went to Alexa itself.
  const fb = say(intent("AMAZON.FallbackIntent"));
  assert.equal(fb.say, "I didn't catch that as a maple crate request. Ask for a DJ and what you'd like, or a preset by number.");
  assert.equal(fb.end, false);
  assert.equal(fb.reprompt, "Which DJ, and what would you like?");
  assert.equal(say(intent("AMAZON.StopIntent")).say, "Okay.");
  const launch = say({ type: "LaunchRequest" });
  assert.equal(launch.end, false);
  assert.ok(launch.reprompt);
  assert.equal(say({ type: "SessionEndedRequest", reason: "USER_INITIATED" }).say, null);
});

test("a preset by its number: a DJ's, the guest DJ's, the Requests playlist, and the Tidal one told to the remote", () => {
  const say = (slots) => alexaHeard(alexa(intent("PresetIntent", slots)), env(), Date.now());
  const n = (v, room) => say({ number: { value: String(v) }, ...(room ? { room } : {}) });
  assert.equal(n(1).say, "I'd start preset 1, Requests on Spotify, on the Pro Plus.");
  assert.equal(n(2).say, "Preset 2 is Requests on Tidal, which can't be started from here. Press 2 on the remote.");
  assert.equal(n(3).say, "I'd start preset 3, the guest DJ's, on the Pro Plus, with whoever is on it now.");
  assert.equal(n(7).say, "I'd start Americana on the Pro Plus, on preset 7, Americana's own.");
  assert.equal(n(7, matched("ultra", "Ultra")).say, "I'd start Americana on the Ultra, on preset 7, Americana's own.");
  assert.equal(n(5).preset, 5);
  assert.equal(n(11).say, "I don't know of anything on preset 11 that I could start. Press 11 on the remote.");
  // A number Alexa was not sure of comes as "?".
  assert.equal(n("?").say, "I didn't catch a preset number. The remote has 1 to 12.");
  assert.equal(n(13).kind, "no-preset");
  assert.equal(say({}).kind, "no-preset");
  assert.equal(n(7, unmatched("kitchen")).say, "I heard kitchen, which is not one of the speakers.");
  // Endless off: a DJ's number is no DJ's, and nothing on file is started.
  const off = alexaHeard(alexa(intent("PresetIntent", { number: { value: "7" } })), { ...env(), ENDLESS: "" }, Date.now());
  assert.equal(off.say, "I don't know of anything on preset 7 that I could start. Press 7 on the remote.");
});

test("pause, play again, skip and move: what the house would do, on the speaker said or whatever plays", () => {
  const say = (name, room) => alexaHeard(alexa(intent(name, room ? { room } : {})), env(), Date.now());
  assert.equal(say("QuietIntent").say, "I'd pause whatever is playing.");
  assert.equal(say("QuietIntent", matched("ultra", "Ultra")).say, "I'd pause the music on the Ultra.");
  assert.equal(say("QuietIntent").kind, "pause");
  assert.equal(say("AgainIntent").say, "I'd play again what was paused last.");
  assert.equal(say("AgainIntent", matched("pro plus", "Pro_Plus")).say, "I'd play again what was paused on the Pro Plus.");
  assert.equal(say("SkipIntent").say, "I'd skip to the next song of whatever is playing.");
  assert.equal(say("SkipIntent", matched("dining room", "Dining_Room")).say, "I'd skip to the next song on the Dining Room.");
  assert.equal(say("MoveIntent", matched("ultra", "Ultra")).say, "I'd move what's playing to the Ultra, the same song carrying on there.");
  assert.equal(say("MoveIntent", matched("everywhere", "Everywhere")).say, "I'd move what's playing everywhere, the same song carrying on there.");
  assert.equal(say("MoveIntent").say, "Which speaker? Say, for example: move the music to the Ultra.");
  assert.equal(say("SkipIntent", unmatched("kitchen")).say, "I heard kitchen, which is not one of the speakers.");
});

test("the DJ page's buttons by voice, in the dry run: endless with words, fresh, keep, now, steering, back", () => {
  const say = (req) => alexaHeard(alexa(req), env(), Date.now());
  const ask = (dj, w) => say(intent(dj, { words: { value: w } }));
  assert.equal(ask("AskDeepDive", "on michael jackson endless").say, "I'd start Deep Dive endless with \"michael jackson\", on the Pro Plus.");
  assert.equal(ask("AskDeepDive", "on michael jackson endless").kind, "endless");
  assert.equal(ask("AskGenre", "eighties new wave no synths all night now").say,
    "I'd start Genre endless with \"eighties new wave, no synths\", on the Pro Plus, taking the guest preset over now if another DJ is on it.");
  assert.equal(ask("AskHank", "fresh").say, "I'd start Hank fresh: a new opening set, starting on the Pro Plus once it's made.");
  assert.equal(say(intent("FreshHank", { room: matched("ultra", "Ultra") })).say, "I'd start Hank fresh: a new opening set, starting on the Ultra once it's made.");
  assert.equal(ask("AskSessions", "acoustic grunge and keep it").say,
    "I'd ask Sessions for acoustic grunge, an hour, starting on the Pro Plus, and keep it on the Shelf.");
  assert.equal(say(intent("PlayPubRock", { when: matched("now", "now") })).say,
    "I'd start Pub Rock on the Pro Plus, on preset 3, the guest DJ's, taking the guest preset over now if another DJ is on it.");
  assert.equal(say(intent("PlayPubRock", { when: matched("now", "now") })).when, "now");
  assert.equal(ask("AskPubRock", "after this song").say,
    "I'd start Pub Rock on the Pro Plus, on preset 3, the guest DJ's, taking the guest preset over after this song if another DJ is on it.");
  assert.equal(say(intent("MoreLikeIntent")).say, "I'd steer the DJ that's playing: more like this.");
  assert.equal(say(intent("ChangeUpIntent")).say, "I'd steer the DJ that's playing: change it up.");
  assert.equal(say(intent("SteerMoreIntent", { words: { value: "upbeat" } })).say, "I'd steer the DJ that's playing: more upbeat.");
  assert.equal(say(intent("SteerLessIntent", { words: { value: "hits" } })).steer.words, "less hits");
  assert.equal(say(intent("SteerToIntent", { words: { value: "mellower" } })).steer.words, "mellower");
  // The bar's two buttons said with "steer" (2026-11-08: "steer" gets past
  // Alexa in one breath), even if Amazon hands them to "steer {words}".
  assert.equal(say(intent("SteerToIntent", { words: { value: "the same way" } })).steer.kind, "more");
  assert.equal(say(intent("SteerToIntent", { words: { value: "it somewhere else" } })).steer.kind, "change");
  assert.equal(say(intent("SteerToIntent", { words: { value: "toward Stax" } })).steer.kind, "words");
  assert.equal(say(intent("SteerMoreIntent")).kind, "fallback");
  assert.equal(say(intent("BackIntent")).say, "I'd go back a song on whatever is playing.");
  assert.equal(say(intent("KeepIntent")).say, "I'd keep the requested set that's playing on the Shelf.");
  // Taste with "fresh" or "now" in it stays taste.
  assert.equal(ask("AskVibe", "fresh produce market").kind, "ask-dj");
  assert.equal(ask("AskVibe", "songs from right now").kind, "ask-dj");
});

// The second turn of a session Alexa holds open: the attributes the last
// answer sent come back, under the same session id.
function turn(request, attributes, { sessionId = "s", fresh = false } = {}) {
  const b = alexa(request);
  b.session = { ...b.session, new: fresh, sessionId, attributes };
  return b;
}

test("an ask with no DJ asks which, keeps the reading one turn, and takes only a DJ's name for an answer", async () => {
  const e = env();
  const first = alexaHeard(alexa(intent("AskIntent", { words: { value: "mellow for dinner on the ultra" } })), e, NOW);
  assert.equal(first.kind, "which-dj");
  assert.equal(first.say, "Which DJ? For example Hank, Soul or Sessions.");
  assert.equal(first.end, false);
  const kept = first.attributes;
  assert.deepEqual(kept.houseRadio.reading, { words: "mellow for dinner", avoid: null, minutes: 60, device: "Ultra", deviceFrom: "words" });
  // The answer: a DJ's name alone.
  const soul = alexaHeard(turn(intent("AskSoul"), kept), e, NOW + 5000);
  assert.equal(soul.say, "I'd ask Soul for mellow for dinner, an hour, starting on the Ultra.");
  assert.equal(soul.answered, true);
  assert.equal(soul.attributes, undefined, "the reading is good for one turn");
  // Anything else ends it, never a guess.
  const NO = "I didn't catch a DJ, so I've let it go. Ask again with one, for example: ask maple crate for Soul, something mellow.";
  for (const other of [intent("PlaySoul"), intent("AskSoul", { words: { value: "on the ultra" } }),
    intent("AskIntent", { words: { value: "something else" } }), intent("AMAZON.FallbackIntent"), intent("AMAZON.HelpIntent")]) {
    assert.equal(alexaHeard(turn(other, kept), e, NOW + 5000).say, NO, other.intent.name);
  }
  assert.equal(alexaHeard(turn(intent("AMAZON.StopIntent"), kept), e, NOW + 5000).say, "Okay.");
  // A kept reading not taken: another session, a new one, too old, the wrong
  // shape, a speaker not on the list. The name is then a name alone.
  const notTaken = (attributes, opts, at = NOW + 5000) => alexaHeard(turn(intent("AskSoul"), attributes, opts), e, at).answered;
  assert.equal(notTaken(kept, { sessionId: "other" }), undefined);
  assert.equal(notTaken(kept, { fresh: true }), undefined);
  assert.equal(notTaken(kept, {}, NOW + 3 * 60 * 1000), undefined);
  const shaped = (r) => ({ houseRadio: { ...kept.houseRadio, reading: { ...kept.houseRadio.reading, ...r } } });
  assert.equal(notTaken(shaped({ minutes: 45 }), {}), undefined);
  assert.equal(notTaken(shaped({ device: "Kitchen" }), {}), undefined);
  assert.equal(notTaken(shaped({ words: 7 }), {}), undefined);
  assert.equal(alexaHeard(turn(intent("AskSoul"), kept, { sessionId: "other" }), e, NOW + 5000).say,
    "I'd start Soul on the Pro Plus, on preset 8, Soul's own.");
  // An ask with no DJ and nothing but a speaker: the DJ named is put on there.
  const bare = alexaHeard(alexa(intent("AskIntent", { words: { value: "on the ultra" } })), e, NOW).attributes;
  assert.equal(alexaHeard(turn(intent("AskHank"), bare), e, NOW + 5000).say, "I'd start Hank on the Ultra, on preset 5, Hank's own.");
  // Through the door: the attributes ride the answer, and the line stays open.
  const { out } = await logged(() => post(e, alexa(intent("AskIntent", { words: { value: "mellow for dinner" } }))));
  const body = await out.json();
  assert.equal(body.response.shouldEndSession, false);
  assert.equal(body.sessionAttributes.houseRadio.kind, "which-dj");
  assert.equal(body.response.reprompt.outputSpeech.text, "Which DJ?");
});

test("a session's end gets Alexa's empty answer, and a launch keeps the line open for the next sentence", async () => {
  const e = env();
  const ended = await (await logged(() => post(e, alexa({ type: "SessionEndedRequest", reason: "EXCEEDED_MAX_REPROMPTS" })))).out.json();
  assert.deepEqual(ended, { version: "1.0", response: {} });
  const open = await (await logged(() => post(e, alexa({ type: "LaunchRequest" })))).out.json();
  assert.equal(open.response.shouldEndSession, false);
  assert.match(open.response.reprompt.outputSpeech.text, /Which DJ/);
});

// Codex's review, 2026-11-08 (the owner: "close it"): a signed request is
// good for Amazon's 150 seconds, so a copy sent again inside them is refused.
test("a request sent twice is answered once: the copy is refused, another request still passes", async () => {
  const e = env();
  const body = alexa(intent("PlayHank"));
  const first = await logged(() => post(e, body));
  assert.equal(first.out.status, 200);
  assert.equal((await first.out.json()).response.outputSpeech.text, "I'd start Hank on the Pro Plus, on preset 5, Hank's own.");
  const copy = await logged(() => post(e, body));
  assert.equal(copy.out.status, 400);
  assert.deepEqual(await copy.out.json(), { error: "request already answered" });
  assert.ok(copy.lines.some((l) => l.startsWith("alexa: refused a request already answered (400)")), copy.lines.join("\n"));
  assert.ok(!copy.lines.some((l) => / kind=/.test(l)), "the copy is never read");
  assert.equal((await post(e, alexa(intent("PlayHank")))).status, 200);
});

test("the ledger keeps a request's id past the door's window, and the first call asking again is still the first", async () => {
  assert.ok(ALEXA_SEEN_KEEP_MS >= 2 * ALEXA_WINDOW_MS, "a copy passes the timestamp check up to 300 s after the first");
  const e = env();
  const t = NOW;
  assert.deepEqual(await station(e, "alexa-once", { id: "q1", by: "call-a", now: t }), { ok: true, first: true });
  assert.deepEqual(await station(e, "alexa-once", { id: "q1", by: "call-a", now: t + 1000 }), { ok: true, first: true }, "station()'s own retry");
  assert.deepEqual(await station(e, "alexa-once", { id: "q1", by: "call-b", now: t + 2 * ALEXA_WINDOW_MS }), { ok: true, first: false });
  assert.deepEqual(await station(e, "alexa-once", { id: "q1", by: "call-c", now: t + ALEXA_SEEN_KEEP_MS + 1 }), { ok: true, first: true }, "pruned after its keep");
  assert.equal((await station(e, "alexa-once", { id: "", by: "x", now: t })).ok, false);
});

test("a ledger that does not answer: nothing is read or done, and Alexa says so", async () => {
  const e = env();
  e.STATION = undefined;
  const { out, lines } = await logged(() => post(e, alexa(intent("PlayHank"))));
  assert.equal(out.status, 200);
  assert.equal((await out.json()).response.outputSpeech.text, ALEXA_UNCHECKED);
  assert.ok(lines.some((l) => /^alexa: IntentRequest unchecked: the ledger did not answer; nothing done/.test(l)), lines.join("\n"));
  assert.ok(!lines.some((l) => / kind=/.test(l)), "nothing was read");
});

test("the model: every DJ has an ask and a put-on of their own, said with their name; the door reads the same intent names", () => {
  const m = alexaModel({ roster: ROSTER, rooms: ["Pro Plus", "Ultra", "Everywhere", "Office2", "iPhone"] }).interactionModel.languageModel;
  assert.equal(m.invocationName, "maple crate");
  const names = m.intents.map((i) => i.name);
  for (const [key, p] of Object.entries(ROSTER)) {
    const it = m.intents.find((i) => i.name === djIntentName(key));
    assert.ok(it, `${p.name} has no intent`);
    assert.ok(it.samples.includes(spoken(p.name)), `${p.name} alone is not a sample`);
    assert.equal(djIntents(ROSTER)[it.name], key);
    const put = m.intents.find((i) => i.name === djPlayIntentName(key));
    assert.ok(put, `${p.name} has no put-on`);
    assert.ok(put.samples.includes(`put on ${spoken(p.name)}`) && put.samples.includes(`play ${spoken(p.name)} on the {room}`),
      `${p.name}'s name is not written into the put-on`);
    assert.deepEqual(put.slots, [{ name: "room", type: "HOUSE_ROOM" }, { name: "when", type: "HOUSE_WHEN" }]);
    assert.ok(put.samples.includes(`put on ${spoken(p.name)} {when}`), `${p.name}: "now" or "after this song" said with it`);
    const fresh = m.intents.find((i) => i.name === djFreshIntentName(key));
    assert.ok(fresh?.samples.includes(`start ${spoken(p.name)} fresh`), `${p.name} has no fresh start`);
    assert.equal(djPlayIntents(ROSTER)[put.name], key);
  }
  assert.equal(djIntentName("pub-rock"), "AskPubRock");
  assert.equal(djIntentName("dr-funkenstein"), "AskDrFunkenstein");
  assert.equal(djPlayIntentName("pub-rock"), "PlayPubRock");
  assert.deepEqual(spokenForms(ROSTER["dr-funkenstein"]), ["doctor funkenstein", "funkenstein"]);
  assert.deepEqual(spokenForms(ROSTER["the-librarian"]), ["the librarian", "librarian"]);
  // The name split in two, or with an s less: stage 1 lost "Gatefold, a
  // classic album side" and "Sessions, acoustic grunge" in an open session.
  assert.deepEqual(spokenForms(ROSTER.gatefold), ["gatefold", "gate fold"]);
  assert.deepEqual(spokenForms(ROSTER.sessions), ["sessions", "the sessions", "session"]);
  // A name run together is not a form ("pubrock" is never what Alexa writes).
  assert.deepEqual(spokenForms(ROSTER["pub-rock"]), ["pub rock"]);
  // "DJ <name>" is the DJ's own name, never an alias's, with DJ as Amazon
  // writes letters said one by one, and as the word.
  const samplesOf = (key) => m.intents.find((i) => i.name === djIntentName(key)).samples;
  assert.ok(samplesOf("soul").includes("d. j. soul {words}") && samplesOf("soul").includes("deejay soul {words}"));
  assert.ok(!samplesOf("soul").includes("d. j. southern soul"));
  assert.ok(samplesOf("sessions").includes("d. j. sessions") && !samplesOf("sessions").includes("d. j. the sessions"));
  assert.ok(samplesOf("the-librarian").includes("d. j. librarian"));
  // "play Soul everywhere": the speaker may come bare, and everywhere is one.
  const putOf = (key) => m.intents.find((i) => i.name === djPlayIntentName(key)).samples;
  assert.ok(putOf("soul").includes("play soul {room}"));
  assert.ok(!putOf("soul").some((s) => s.includes("everywhere")), "everywhere is a speaker, not fixed words");
  // A nickname that is a mood too never names a DJ in an ask.
  assert.ok(!m.intents.some((i) => i.samples.some((s) => /^(morning|albums|late) /.test(s))));
  assert.ok(names.includes("AskIntent") && names.includes("NowIntent") && names.includes("AMAZON.FallbackIntent"));
  const preset = m.intents.find((i) => i.name === "PresetIntent");
  assert.deepEqual(preset.slots, [{ name: "number", type: "AMAZON.NUMBER" }, { name: "room", type: "HOUSE_ROOM" }]);
  assert.ok(preset.samples.includes("play preset {number}") && preset.samples.includes("play preset {number} on the {room}"));
  for (const n of ["QuietIntent", "AgainIntent", "SkipIntent", "MoveIntent"]) {
    const it = m.intents.find((i) => i.name === n);
    assert.ok(it, `${n} is missing`);
    assert.deepEqual(it.slots, [{ name: "room", type: "HOUSE_ROOM" }]);
  }
  // "Pause" never reaches a skill (stage 1): other words stand in for it.
  assert.ok(!m.intents.some((i) => i.samples.some((x) => /\bpause\b/.test(x))));
  // Alexa keeps "pause" for itself; the model never offers one.
  assert.ok(!names.some((n) => /Pause|PutOn/.test(n)));
  assert.deepEqual(m.types.map((t) => t.name), ["HOUSE_ROOM", "HOUSE_WHEN"]);
  for (const n of ["MoreLikeIntent", "ChangeUpIntent", "SteerMoreIntent", "SteerLessIntent", "SteerToIntent", "BackIntent", "KeepIntent"]) {
    assert.ok(names.includes(n), `${n} is missing`);
  }
  // Each of the bar's buttons has a "steer" form, said in one breath.
  const samplesFor = (n) => m.intents.find((i) => i.name === n).samples;
  assert.ok(samplesFor("MoreLikeIntent").includes("steer the same way"));
  assert.ok(samplesFor("ChangeUpIntent").includes("steer somewhere else"));
  // No sample is offered twice (Amazon's build refuses it).
  const all = m.intents.flatMap((i) => i.samples);
  assert.equal(new Set(all).size, all.length);
  // The speakers as Alexa says them, each carrying the house's own spelling.
  const rooms = m.types.find((t) => t.name === "HOUSE_ROOM").values;
  assert.deepEqual(rooms.find((r) => r.id === "Office2").name.value, "office two");
  assert.deepEqual(rooms.find((r) => r.id === "iPhone").name.value, "iphone");
  assert.deepEqual(rooms.find((r) => r.id === "Pro_Plus").name.value, "pro plus");
});

test("the model keeps Amazon's rules: plain words in samples, one free-text slot and never beside another, no repeats", () => {
  const m = alexaModel({ roster: ROSTER, rooms: JSON.parse(readFileSync(new URL("../house.json", import.meta.url))).devices.rooms })
    .interactionModel.languageModel;
  const seen = new Map();
  for (const it of m.intents) {
    assert.match(it.name, /^(AMAZON\.[A-Za-z]+|[A-Za-z_]+)$/, it.name);
    const slots = new Set((it.slots ?? []).map((s) => s.name));
    const free = (it.slots ?? []).filter((s) => s.type === "AMAZON.SearchQuery");
    assert.ok(free.length <= 1, `${it.name}: more than one free-text slot`);
    for (const s of it.samples) {
      // Words, slots, and letters said one by one as Amazon writes them ("d. j.").
      for (const w of s.split(" ")) assert.match(w, /^(\{[a-z]+\}|[a-z']+|[a-z]\.)$/, `${it.name}: "${s}"`);
      assert.equal(s, s.trim().replace(/\s+/g, " "), `${it.name}: spacing in "${s}"`);
      const used = [...s.matchAll(/\{([a-z]+)\}/g)].map((x) => x[1]);
      for (const u of used) assert.ok(slots.has(u), `${it.name}: "${s}" names an undeclared slot`);
      if (free.length && used.includes(free[0].name)) {
        assert.equal(used.length, 1, `${it.name}: "${s}" puts the free-text slot beside another`);
        assert.notEqual(s.replace(`{${free[0].name}}`, "").trim(), "", `${it.name}: "${s}" has no fixed words`);
      }
      assert.ok(!seen.has(s), `"${s}" is in ${seen.get(s)} and ${it.name}`);
      seen.set(s, it.name);
    }
  }
  for (const t of m.types) {
    const ids = new Set();
    const words = new Set();
    for (const v of t.values) {
      assert.ok(!ids.has(v.id), `${t.name}: id ${v.id} twice`);
      // Amazon refuses a slot id with a space (the owner's console, 2026-11-07).
      assert.doesNotMatch(v.id, /\s/, `${t.name}: id "${v.id}" has a space`);
      ids.add(v.id);
      for (const w of [v.name.value, ...(v.name.synonyms ?? [])]) {
        assert.match(w, /^[a-z' ]+$/, `${t.name}: "${w}"`);
        assert.ok(!words.has(w), `${t.name}: "${w}" names two values`);
        words.add(w);
      }
    }
  }
});

test("the file the owner pastes is the model this house makes now (npm run alexa)", () => {
  assert.equal(readFileSync(ALEXA_MODEL_FILE, "utf8"), renderModel());
});

test("a speaker's id in the skill has underscores for spaces, and the door turns it back into the house's own name", async () => {
  assert.equal(alexaRoomId("Pro Plus"), "Pro_Plus");
  assert.equal(alexaRoomId("Master Bedroom"), "Master_Bedroom");
  assert.equal(alexaRoomId("Office2"), "Office2");
  for (const r of ROOMS) assert.equal(roomOfId(alexaRoomId(r), ROOMS), r);
  assert.equal(roomOfId("Kitchen", ROOMS), null);
  assert.equal(roomOfId(null, ROOMS), null);
  // Through the door: the log names the speaker as the house does.
  const e = env();
  const { out, lines } = await logged(() => post(e, alexa(intent("PlayHank",
    { room: matched("dining room", "Dining_Room") }))));
  assert.equal((await out.json()).response.outputSpeech.text, "I'd start Hank on the Dining Room, on preset 5, Hank's own.");
  assert.ok(lines.some((l) => l.includes('room="dining room"->Dining Room')), lines.join("\n"));
});

test("Amazon's signature, checked by the door before anything in the body is read: signed passes, changed or unsigned is refused", async () => {
  const fx = (name) => readFileSync(new URL(`./fixtures/alexa/${name}`, import.meta.url), "utf8");
  const real = { roots: alexaTrust.roots, fetch: alexaTrust.fetch, signed: alexaGate.signed };
  forgetChains();
  alexaTrust.roots = [fx("test-root.pem")];
  alexaTrust.fetch = async () => new Response(fx("test-chain.pem"));
  alexaGate.signed = alexaSigned;
  try {
    const e = env();
    const body = fx("body.json");
    const at = Date.parse("2026-11-08T04:00:00Z");
    const req = (raw, sig = fx("body.sig")) => new Request(`https://x.test/alexa/${SECRET}`, { method: "POST",
      headers: { "content-type": "application/json", "signature-256": sig,
        signaturecertchainurl: "https://s3.amazonaws.com/echo.api/echo-api-cert-test.pem" }, body: raw });
    const { out, lines } = await logged(() => alexaDoor(req(body), e, body, at));
    assert.equal(out.status, 200);
    assert.equal((await out.json()).response.outputSpeech.text, "I'd start Hank on the Pro Plus, on preset 5, Hank's own.");
    assert.ok(lines.some((l) => /^alexa: IntentRequest AskHank kind=put-on/.test(l)), lines.join("\n"));
    const changed = body.replace('"AskHank"', '"AskSoul"');
    const refused = await logged(() => alexaDoor(req(changed), e, changed, at));
    assert.equal(refused.out.status, 400);
    assert.deepEqual(await refused.out.json(), { error: "not signed by Amazon" });
    assert.ok(refused.lines.some((l) => l.startsWith("alexa: refused the signature does not match the body (400) sig=yes")), refused.lines.join("\n"));
    const unsigned = await logged(() => alexaDoor(req(body, ""), e, body, at));
    assert.equal(unsigned.out.status, 400);
    assert.ok(unsigned.lines.some((l) => l.startsWith("alexa: refused no Signature-256 (400) sig=no")), unsigned.lines.join("\n"));
  } finally {
    alexaTrust.roots = real.roots;
    alexaTrust.fetch = real.fetch;
    alexaGate.signed = real.signed;
    forgetChains();
  }
});
