// HOUSE RADIO, THE ALEXA DOOR (MC-38, tasks/mc38-alexa-skill.md). A private
// Alexa skill on the house's Echos sends what it heard here. The DJ comes
// from the intent's name, the speaker, the length and what to leave out from
// the words (alexa-read.js). STAGE 3, with ALEXA_ACTS "on" (house.json
// `alexa.acts`): it does it, through the house's own doors (alexa-act.js),
// and says what was done. Off, STAGE 2'S DRY RUN: it says what it WOULD do
// ("I'd ask Sessions for acoustic grunge, an hour, starting on the Ultra.")
// and starts, writes and calls nothing. Stage 1 (it only said back what it
// heard) proved a real Echo reaches the skill and hears every name.
//
// Its locks, in order: the address (`/alexa/<ALEXA_SECRET>`, matched whole
// in routes.js, else the house's usual 404), POST only, JSON only, a bounded
// body, then the skill's own id (`ALEXA_SKILL_ID`) and Amazon's 150-second
// window on the request's timestamp, then AMAZON'S SIGNATURE (stage 2b,
// alexa-sign.js: Signature-256 over the raw body, checked with the chain
// from s3.amazonaws.com/echo.api/ up to Amazon's root), then the request's
// id, once (alexaOnce: a copy sent again is refused). Only then is the
// body read for what was asked, the session's kept reading included.
//
// The log: one `alexa:` line a request (what came, what was read, what was
// said, how long). Workers Logs keep it three days (a long `wrangler tail`
// goes silent, and shows the secret part of the path as REDACTED). The
// request kept whole (`alexa:raw`, the signature check's test material in
// stages 1 and 2) is no longer logged: it held Alexa's access token.

import { ALEXA_INVOCATION, ALEXA_NAME, djFreshIntents, djIntents, djPlayIntents, roomOfId } from "./alexa-model.js";
import { alexaAct, alexaActs } from "./alexa-act.js";
import { endlessWords, readWords } from "./alexa-read.js";
import { alexaSigned } from "./alexa-sign.js";
import { ASK_LENGTHS, LENGTH_WORDS, onWords } from "./asks.js";
import { ROSTER } from "./djs.js";
import { house, presetOnFile } from "./house.js";
import { parseEndless } from "./endless.js";
import { fallbackDevice, parseRoomDevices } from "./room.js";
import { station } from "./station.js";
import { askDjOn } from "./toollist.js";

export const ALEXA_WINDOW_MS = 150 * 1000;
// The signature check the door runs: alexa-sign.js's. A test that is not
// about signatures puts a pass here; nothing a request or a setting says can.
export const alexaGate = { signed: alexaSigned };
export const ALEXA_BODY_MAX = 64 * 1024;

const DJ_INTENTS = djIntents(ROSTER);
const PLAY_INTENTS = djPlayIntents(ROSTER);
const FRESH_INTENTS = djFreshIntents(ROSTER);

// Alexa's answer: one spoken line, the session closed unless a question was
// asked, and the attributes Alexa keeps for the next turn of an open one.
export function alexaSays(text, { end = true, reprompt = null, attributes = null } = {}) {
  return {
    version: "1.0",
    ...(attributes ? { sessionAttributes: attributes } : {}),
    response: {
      outputSpeech: { type: "PlainText", text: String(text).slice(0, 600) },
      ...(reprompt ? { reprompt: { outputSpeech: { type: "PlainText", text: reprompt } } } : {}),
      shouldEndSession: end,
    },
  };
}

// The checks after the address: { ok: true, body } or { ok: false, status, why }.
export function alexaCheck(env, { method, type, raw }, now = Date.now()) {
  if (method !== "POST") return { ok: false, status: 405, why: "not a POST" };
  if (!/^application\/json\b/i.test(type ?? "")) return { ok: false, status: 415, why: "not JSON" };
  if (raw == null || raw.length > ALEXA_BODY_MAX) return { ok: false, status: 413, why: "too big" };
  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false, status: 400, why: "unreadable JSON" }; }
  if (!body || typeof body !== "object") return { ok: false, status: 400, why: "unreadable JSON" };
  const skill = env.ALEXA_SKILL_ID;
  if (!skill) return { ok: false, status: 400, why: "ALEXA_SKILL_ID is not set" };
  const id = body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId ?? null;
  if (id !== skill) return { ok: false, status: 400, why: "another skill's id" };
  const at = Date.parse(body.request?.timestamp ?? "");
  if (!Number.isFinite(at)) return { ok: false, status: 400, why: "no timestamp" };
  if (Math.abs(now - at) > ALEXA_WINDOW_MS) return { ok: false, status: 400, why: `timestamp ${Math.round((now - at) / 1000)} s off` };
  const rid = body.request?.requestId;
  if (typeof rid !== "string" || !rid) return { ok: false, status: 400, why: "no request id" };
  return { ok: true, body };
}

// ONCE A REQUEST (Codex's review of the whole skill, 2026-11-08; the owner:
// "close it"). A signed request passes every lock above for Amazon's 150
// seconds, so a copy sent again inside them would act again (a preset
// pressed twice). Each request's id is kept in the ledger (station.js
// `alexa-once`) and any other call bringing it is refused. `by` marks this
// call, so station()'s one retry after a deploy reset finds its own row and
// not a copy. "first", "again", or "unchecked" when the ledger could not say.
async function alexaOnce(env, id, now) {
  try {
    const r = await station(env, "alexa-once", { id, by: crypto.randomUUID(), now });
    return r?.ok ? (r.first ? "first" : "again") : "unchecked";
  } catch { return "unchecked"; }
}
// THE TALK TAB'S BOX (the owner, 2026-11-08): null in a house without the
// skill; else whether it acts, and the last three things it heard.
export async function alexaBox(env, now = Date.now()) {
  if (!env?.ALEXA_SECRET || !env?.ALEXA_SKILL_ID) return null;
  let heard = [];
  try { heard = (await station(env, "alexa-heard-list", { limit: 3 }))?.rows ?? []; } catch { heard = []; }
  return { acts: alexaActs(env), invocation: ALEXA_INVOCATION, heard, tz: env.HOUSE_TZ ?? null, now };
}
export const ALEXA_UNCHECKED = "The house couldn't check that request, so nothing was done. Ask again in a moment.";

// A listed slot as heard, and who or what Amazon matched it to.
function slotOf(intent, name) {
  const s = intent?.slots?.[name];
  if (!s?.value) return null;
  const auth = s.resolutions?.resolutionsPerAuthority?.find((r) => r?.status?.code === "ER_SUCCESS_MATCH");
  const v = auth?.values?.[0]?.value ?? null;
  return { heard: String(s.value), id: v?.id ?? null, name: v?.name ?? null };
}
// The speaker slot, with the house's own name for it: Amazon hands back the
// id the model gave it ("Living_Room", alexa-model.js alexaRoomId), and
// `room` is that id found in the house's list ("Living Room"), else null.
function roomSlot(intent, rooms) {
  const s = slotOf(intent, "room");
  return s ? { ...s, room: roomOfId(s.id, rooms) } : null;
}
// A DJ put on: which of the house's presets they would go on, read from the
// config alone (parseEndless). Never playEndless, which reads the lane and
// the player before its later refusals and then starts (endless.js
// playEndless); so a busy lane is not known here, only the configured one.
function putOnSays(env, key, device) {
  const dj = ROSTER[key];
  const cfg = parseEndless(env);
  const lane = cfg?.presets.find((p) => p.lane) ?? null;
  if (!cfg || cfg.mode !== "live" || !lane) return `Endless DJs are off in this house, so I couldn't put ${dj.name} on.`;
  if (dj.endless === false) return `${dj.name} doesn't play endless, so I couldn't put them on.`;
  const own = cfg.presets.find((p) => p.dj === key);
  if (own) return `I'd start ${dj.name} ${at(device)}, on preset ${own.button}, ${dj.name}'s own.`;
  const told = dj.needsWords
    ? ` ${dj.name} must be told ${dj.needsWords}, so I'd ask you for one, unless that preset is still playing one.` : "";
  return `I'd start ${dj.name} ${at(device)}, on preset ${lane.button}, the guest DJ's.${told}`;
}

// A preset by its number, as the house's config has it (the owner,
// 2026-11-07): a house DJ's own or the guest DJ's (the same as putting that
// DJ on), the Spotify playlist on file for the number (the Requests preset),
// and a preset on another service told to the remote, since playback from
// here goes through Spotify Connect ("press 2 on the remote" for the Tidal
// one, the owner's choice over the home helper's press).
function presetSays(env, n, device) {
  const other = Object.values(house(env).guest ?? {}).find((g) => g && g.btn === n && g.catalog !== "spotify") ?? null;
  if (other) return `Preset ${n} is ${spokenName(other.name)}, which can't be started from here. Press ${n} on the remote.`;
  const cfg = parseEndless(env);
  const slot = cfg?.mode === "live" ? cfg.presets.find((p) => p.button === n) : null;
  if (slot?.dj && ROSTER[slot.dj]) return putOnSays(env, slot.dj, device);
  if (slot?.lane) return `I'd start preset ${n}, the guest DJ's, ${at(device)}, with whoever is on it now.`;
  const file = presetOnFile(env, n);
  if (file && !file.endless) {
    return `I'd start preset ${n}, ${file.name ? spokenName(file.name) : "the playlist saved for it"}, ${at(device)}.`;
  }
  return `I don't know of anything on preset ${n} that I could start. Press ${n} on the remote.`;
}
// "Requests · Spotify" said as "Requests on Spotify".
const spokenName = (name) => String(name ?? "").replace(/\s*·\s*/g, " on ");

// WHAT'S PLAYING, HANDLED (the owner, 2026-11-07): pause, play again, skip
// and move. A speaker said is that speaker; none is whatever plays (pause,
// skip) or what was paused last (play again, the bar's own pause record,
// never Spotify's paused state, 2026-09-22). Move needs the speaker it goes
// to.
const to = (device) => (/^everywhere$/i.test(device) ? "everywhere" : `to the ${device}`);
const PLAYER_KIND = { QuietIntent: "pause", AgainIntent: "again", SkipIntent: "skip", MoveIntent: "move" };
const PLAYER_SAYS = {
  QuietIntent: (d) => (d ? `I'd pause the music ${onWords(d)}.` : "I'd pause whatever is playing."),
  AgainIntent: (d) => (d ? `I'd play again what was paused ${onWords(d)}.` : "I'd play again what was paused last."),
  SkipIntent: (d) => (d ? `I'd skip to the next song ${onWords(d)}.` : "I'd skip to the next song of whatever is playing."),
  MoveIntent: (d) => (d ? `I'd move what's playing ${to(d)}, the same song carrying on there.`
    : "Which speaker? Say, for example: move the music to the Ultra."),
};

// An ask a DJ would be given: the curator's words, the length, what to leave
// out, the speaker it starts on. Only the checks that are config: fileAsk
// writes the request record, so it is never called here. Every intent's DJ is
// from the roster, which holds no archive-only DJ (reachableDj).
function askSays(env, key, r) {
  const dj = ROSTER[key];
  if (!askDjOn(env)) return `This house has no curator taking asks, so I couldn't ask ${dj.name}.`;
  const what = r.words || "a set";
  const leave = r.avoid ? `, leaving out ${r.avoid}` : "";
  return `I'd ask ${dj.name} for ${what}${leave}, ${LENGTH_WORDS[r.minutes]}, starting ${at(r.device)}.`;
}

// What a reading of the words asks for: an ask when there is taste or a
// leave-out in it, a DJ put on when there is only a speaker or a length or
// nothing (the owner, 2026-11-07: "ask house radio for Hank" puts Hank on;
// a length said with nothing else is dropped).
const isAsk = (r) => !!(r.words || r.avoid);
// What a reading of an ask of a DJ asks for (the DJ page's buttons by voice,
// the owner, 2026-11-07): a fresh start; the DJ endless with the words; a set
// (kept when "and keep it" was said); else the DJ put on, now or after this
// song when said.
const kindOf = (r) => (r.fresh ? "fresh" : r.endless && isAsk(r) ? "endless" : isAsk(r) ? "ask-dj" : "put-on");
const WHEN_SAID = { now: ", taking the guest preset over now if another DJ is on it",
  next: ", taking the guest preset over after this song if another DJ is on it" };
// The speaker as said; a house with no default and none said has none.
const at = (device) => (device ? onWords(device) : "on no speaker, since this house has no default one");
function doFor(env, key, r) {
  const dj = ROSTER[key].name;
  const kind = kindOf(r);
  if (kind === "fresh") return `I'd start ${dj} fresh: a new opening set, starting ${at(r.device)} once it's made.`;
  if (kind === "endless") {
    // A DJ with a preset of their own starts it and is steered by the words
    // (alexa-act.js putOn, the owner, 2026-11-08).
    const cfg = parseEndless(env);
    const own = cfg?.mode === "live" ? cfg.presets.find((p) => p.dj === key) : null;
    if (own) return `I'd start ${dj} ${at(r.device)}, on preset ${own.button}, ${dj}'s own, and steer it toward "${endlessWords(r)}".`;
    return `I'd start ${dj} endless with "${endlessWords(r)}", ${at(r.device)}${WHEN_SAID[r.when] ?? ""}.`;
  }
  if (kind === "ask-dj") return askSays(env, key, r).replace(/\.$/, r.keep ? ", and keep it on the Shelf." : ".");
  return putOnSays(env, key, r.device).replace(/\.$/, `${WHEN_SAID[r.when] ?? ""}.`);
}

// "WHICH DJ?" (the owner, 2026-11-07: an ask with no DJ asks back, no
// default). The reading rides in the session's attributes for ONE turn: the
// answer's response does not send them back, so Alexa drops them. Taken only
// from a session that is not new, the same session, two minutes at most, a
// reading of the right shape and a speaker of the list; and the only answer
// taken is a DJ's name alone (an Ask intent with no words, Codex's review).
// From stage 2b on, read only after Amazon's signature check.
const PENDING_MS = 2 * 60 * 1000;
function pendingOf(body, rooms, fallback, now) {
  const s = body?.session;
  const p = s?.attributes?.houseRadio;
  if (!s || s.new !== false || !p || p.kind !== "which-dj" || p.session !== s.sessionId) return null;
  if (!Number.isFinite(p.at) || now - p.at < 0 || now - p.at > PENDING_MS) return null;
  const r = p.reading;
  if (!r || typeof r.words !== "string" || r.words.length > 300) return null;
  if (!(r.avoid === null || (typeof r.avoid === "string" && r.avoid.length <= 200))) return null;
  if (!ASK_LENGTHS.includes(r.minutes)) return null;
  if (!(rooms.includes(r.device) || r.device === fallback)) return null;
  return { words: r.words, avoid: r.avoid, minutes: r.minutes, device: r.device, deviceFrom: r.deviceFrom === "words" ? "words" : "default" };
}

// The steering intents: the bar's two buttons, and a direction in the
// listener's words with "more" or "less" put back (Amazon hands over only
// the words after them).
const STEER = {
  MoreLikeIntent: () => ({ kind: "more", said: "more like this" }),
  ChangeUpIntent: () => ({ kind: "change", said: "change it up" }),
  SteerMoreIntent: (w) => (w ? { kind: "words", words: `more ${w}`, said: `more ${w}` } : null),
  SteerLessIntent: (w) => (w ? { kind: "words", words: `less ${w}`, said: `less ${w}` } : null),
  SteerToIntent: (w) => (!w ? null : SAME_WAY.test(w) ? { kind: "more", said: `steer ${w}` }
    : ELSEWHERE.test(w) ? { kind: "change", said: `steer ${w}` } : { kind: "words", words: w, said: w }),
};
// The bar's two buttons said with "steer" (2026-11-08), should Amazon hand
// them to "steer {words}" rather than to their own intents.
const SAME_WAY = /^(?:it )?(?:the same way|this way|more like this)$/i;
const ELSEWHERE = /^(?:it )?somewhere (?:else|different|new)$/i;

const LAUNCH = `${ALEXA_NAME}. Ask for a DJ and what you'd like, for example: Sessions, acoustic grunge, on the Ultra.`;
const WHICH = "Which DJ? For example Hank, Soul or Sessions.";
const AGAIN = "Ask for a DJ and what you'd like, or a preset by number.";
const NO_DJ = `I didn't catch a DJ, so I've let it go. Ask again with one, for example: ask ${ALEXA_INVOCATION} for Soul, something mellow.`;

// STAGE 2, THE DRY RUN: what the door says back to a request, the DJ from the
// intent's name and the rest read from the words (alexa-read.js), and what it
// WOULD do; it files, starts, writes and calls nothing.
export function alexaHeard(body, env = {}, now = Date.now()) {
  const rooms = parseRoomDevices(env);
  const fallback = fallbackDevice(env) || null;
  const req = body?.request ?? {};
  const type = String(req.type ?? "");
  if (type === "LaunchRequest") return { kind: "launch", say: LAUNCH, end: false, reprompt: "Which DJ, and what would you like?" };
  if (type === "SessionEndedRequest") return { kind: "ended", say: null, end: true, reason: req.reason ?? null };
  if (type !== "IntentRequest") return { kind: "other", say: `I heard something ${ALEXA_INVOCATION} does not know.`, end: true };
  const intent = req.intent ?? {};
  const name = String(intent.name ?? "");
  const words = intent.slots?.words?.value ? String(intent.slots.words.value) : null;
  const djKey = DJ_INTENTS[name];
  const stop = name === "AMAZON.StopIntent" || name === "AMAZON.CancelIntent" || name === "AMAZON.NavigateHomeIntent";
  if (stop) return { kind: "stop", intent: name, say: "Okay.", end: true };

  // The answer to "Which DJ?".
  const pending = pendingOf(body, rooms, fallback, now);
  if (pending) {
    if (djKey && !words) {
      return { kind: kindOf(pending), intent: name, dj: djKey, reading: pending, answered: true,
        say: doFor(env, djKey, pending), end: true };
    }
    return { kind: "no-dj", intent: name, words, say: NO_DJ, end: true };
  }

  if (djKey) {
    const reading = readWords(words, { rooms, fallback });
    return { kind: kindOf(reading), intent: name, dj: djKey, words, reading,
      say: doFor(env, djKey, reading), end: true };
  }
  if (name === "AskIntent") {
    const reading = readWords(words, { rooms, fallback });
    const sessionId = body?.session?.sessionId ?? null;
    if (!sessionId) return { kind: "no-dj", intent: name, words, reading, say: NO_DJ, end: true };
    return { kind: "which-dj", intent: name, words, reading, say: WHICH, reprompt: "Which DJ?", end: false,
      attributes: { houseRadio: { kind: "which-dj", session: sessionId, at: now,
        reading: { words: reading.words, avoid: reading.avoid, minutes: reading.minutes, device: reading.device, deviceFrom: reading.deviceFrom } } } };
  }
  const freshKey = FRESH_INTENTS[name];
  if (freshKey) {
    const room = roomSlot(intent, rooms);
    if (room && !room.room) return { kind: "no-speaker", intent: name, dj: freshKey, room, say: `I heard ${room.heard}, which is not one of the speakers.`, end: true };
    const device = room?.room ?? fallback;
    return { kind: "fresh", intent: name, dj: freshKey, room, device, say: doFor(env, freshKey, { fresh: true, device }), end: true };
  }
  if (STEER[name]) {
    const w = words ? String(words).trim() : "";
    const steer = STEER[name](w);
    if (!steer) return { kind: "fallback", intent: name, say: "I didn't catch which way to steer it.", end: true };
    return { kind: "steer", intent: name, steer, words: w || null, say: `I'd steer the DJ that's playing: ${steer.said}.`, end: true };
  }
  if (name === "BackIntent") return { kind: "back", intent: name, say: "I'd go back a song on whatever is playing.", end: true };
  if (name === "KeepIntent") return { kind: "keep", intent: name, say: "I'd keep the requested set that's playing on the Shelf.", end: true };
  const playKey = PLAY_INTENTS[name];
  if (name === "PresetIntent") {
    const n = Number(intent.slots?.number?.value);
    const room = roomSlot(intent, rooms);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      return { kind: "no-preset", intent: name, room, say: "I didn't catch a preset number. The remote has 1 to 12.", end: true };
    }
    if (room && !room.room) {
      return { kind: "no-speaker", intent: name, preset: n, room, say: `I heard ${room.heard}, which is not one of the speakers.`, end: true };
    }
    const device = room?.room ?? fallback;
    return { kind: "preset", intent: name, preset: n, room, device, say: presetSays(env, n, device), end: true };
  }
  if (PLAYER_SAYS[name]) {
    const room = roomSlot(intent, rooms);
    if (room && !room.room) {
      return { kind: "no-speaker", intent: name, room, say: `I heard ${room.heard}, which is not one of the speakers.`, end: true };
    }
    return { kind: PLAYER_KIND[name], intent: name, room, device: room?.room ?? null, say: PLAYER_SAYS[name](room?.room ?? null), end: true };
  }
  if (playKey || name === "NowIntent") {
    const room = roomSlot(intent, rooms);
    if (room && !room.room) {
      return { kind: "no-speaker", intent: name, dj: playKey ?? null, room, say: `I heard ${room.heard}, which is not one of the speakers.`, end: true };
    }
    const device = room?.room ?? fallback;
    if (playKey) {
      const when = slotOf(intent, "when")?.id ?? null;
      return { kind: "put-on", intent: name, dj: playKey, room, device, when: when === "now" || when === "next" ? when : null,
        say: putOnSays(env, playKey, device).replace(/\.$/, `${WHEN_SAID[when] ?? ""}.`), end: true };
    }
    return { kind: "now", intent: name, room, device, say: `I'd tell you what's playing ${at(device)}.`, end: true };
  }
  if (name === "AMAZON.HelpIntent") return { kind: "help", intent: name, say: LAUNCH, end: false, reprompt: "Which DJ, and what would you like?" };
  if (name === "AMAZON.FallbackIntent") {
    // Kept open, asking again (the owner's test, 2026-11-08): closed, the
    // next words went to Alexa itself, never to the skill.
    return { kind: "fallback", intent: name, say: `I didn't catch that as a ${ALEXA_INVOCATION} request. ${AGAIN}`, end: false,
      reprompt: "Which DJ, and what would you like?" };
  }
  return { kind: "other", intent: name, say: `I heard ${name || "an intent"} that ${ALEXA_INVOCATION} does not know.`, end: true };
}

// WHAT MAPLE CRATE HEARD, IN WORDS (the Talk tab's box, the owner,
// 2026-11-08): a request as Alexa passed it on, near enough to the sentence
// said ("Deep Dive frank Sinatra and Cupid" shows the "keep it" Alexa lost).
// Amazon hands over the DJ by intent and the rest as words, so it is put
// back together from those; null for what is not worth showing.
const SAID_AS = { NowIntent: "what's playing", QuietIntent: "hush", AgainIntent: "carry on", SkipIntent: "skip",
  BackIntent: "one song back", KeepIntent: "keep this set", MoreLikeIntent: "more like this", ChangeUpIntent: "change it up",
  "AMAZON.HelpIntent": "help", "AMAZON.FallbackIntent": "something not caught" };
export function heardWords(h) {
  if (!h || h.kind === "ended" || h.kind === "stop" || h.kind === "other") return null;
  if (h.kind === "launch") return "maple crate, opened";
  const dj = h.dj ? ROSTER[h.dj]?.name ?? h.dj : null;
  const room = h.room?.heard ?? null;
  const w = h.words ? String(h.words) : "";
  if (h.kind === "preset") return [`preset ${h.preset}`, room].filter(Boolean).join(" ");
  if (h.intent === "MoveIntent") return `send the music${room ? ` to ${room}` : ""}`;
  if (h.steer) return /^steer /.test(h.steer.said) ? h.steer.said : `steer ${h.steer.said}`;
  if (dj) return [h.kind === "fresh" ? `${dj} fresh` : dj, w, room].filter(Boolean).join(" ");
  const fixed = SAID_AS[h.intent];
  return [fixed ?? w, fixed ? room : null].filter(Boolean).join(" ") || null;
}

const q = (s) => JSON.stringify(s ?? null);
// Heard -> the speaker it is, by the house's own name (Amazon's id when the
// house's list does not hold it).
const slotLog = (s) => s ? `${q(s.heard)}->${s.room ?? s.id ?? "none"}` : "-";

// The door: the checks, the answer, the log. `raw` is the body as read with
// a ceiling (routes.js readBounded): null when it was past ALEXA_BODY_MAX.
export async function alexaDoor(request, env, raw, now = Date.now(), ctx = null) {
  const t0 = Date.now();
  const sig = request.headers.get("signature-256");
  const chain = request.headers.get("signaturecertchainurl");
  const checked = alexaCheck(env, { method: request.method, type: request.headers.get("content-type"), raw }, now);
  if (!checked.ok) {
    console.log(`alexa: refused ${checked.why} (${checked.status}) sig=${sig ? "yes" : "no"} ${Date.now() - t0}ms`);
    return Response.json({ error: checked.why }, { status: checked.status, headers: { "cache-control": "no-store" } });
  }
  const signed = await alexaGate.signed({ sig, chainUrl: chain, raw }, now);
  if (!signed.ok) {
    console.log(`alexa: refused ${signed.why} (400) sig=${sig ? "yes" : "no"} ${Date.now() - t0}ms`);
    return Response.json({ error: "not signed by Amazon" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const body = checked.body;
  const once = await alexaOnce(env, body.request.requestId, now);
  if (once === "again") {
    console.log(`alexa: refused a request already answered (400) sig=yes ${Date.now() - t0}ms`);
    return Response.json({ error: "request already answered" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (once === "unchecked") {
    console.log(`alexa: ${body.request?.type ?? "?"} unchecked: the ledger did not answer; nothing done ${Date.now() - t0}ms`);
    return Response.json(alexaSays(ALEXA_UNCHECKED), { headers: { "cache-control": "no-store" } });
  }
  const read = alexaHeard(body, env, now);
  // STAGE 3: with ALEXA_ACTS "on" the reading is acted on (alexa-act.js),
  // and what is said is what was done. Off, the dry run's answer stands.
  let heard = read;
  if (alexaActs(env)) {
    let acted = null;
    try { acted = await alexaAct(env, ctx, read); } catch (e) {
      acted = { say: "Something went wrong on the house's side; nothing more was done.", did: { error: String(e?.message ?? e).slice(0, 120) } };
    }
    if (acted) heard = { ...read, say: acted.say, end: acted.end !== false, reprompt: null, attributes: null, did: acted.did };
  }
  const device = String(body.context?.System?.device?.deviceId ?? "").slice(-8) || "-";
  console.log(`alexa: ${body.request?.type ?? "?"}${heard.intent ? ` ${heard.intent}` : ""} kind=${heard.kind}` +
    `${heard.words != null ? ` words=${q(heard.words)}` : ""}` +
    `${heard.room !== undefined ? ` room=${slotLog(heard.room)}` : ""}${heard.reason ? ` reason=${heard.reason}` : ""}` +
    `${heard.dj ? ` dj=${heard.dj}` : ""}${heard.preset ? ` preset=${heard.preset}` : ""}${heard.answered ? " answered=which-dj" : ""}` +
    `${heard.when ? ` when=${heard.when}` : ""}${heard.steer ? ` steer=${q(heard.steer.said)}` : ""}` +
    `${heard.reading ? ` read=${JSON.stringify((({ said, ...r }) => r)(heard.reading))}` : ""}` +
    `${heard.did ? ` did=${JSON.stringify(heard.did)}` : alexaActs(env) ? "" : " dry"}` +
    ` said=${q(heard.say)} locale=${body.request?.locale ?? "-"} device=…${device} ${Date.now() - t0}ms`);
  // Kept for the Talk tab's box, after the answer where the runtime allows.
  const words = heardWords(heard);
  if (words) {
    const kept = station(env, "alexa-heard", { heard: words, said: heard.say ?? null }).catch(() => null);
    if (ctx?.waitUntil) ctx.waitUntil(kept); else await kept;
  }
  const out = heard.say == null ? { version: "1.0", response: {} }
    : alexaSays(heard.say, { end: heard.end, reprompt: heard.reprompt, attributes: heard.attributes });
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
