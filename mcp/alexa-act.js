// HOUSE RADIO ACTS (MC-38 stage 3, tasks/mc38-alexa-skill.md). With
// ALEXA_ACTS "on" (house.json `alexa.acts`), the door does for real what the
// dry run (alexa.js) says it would, through the house's own doors: an ask
// through askByVoice, as Talk files one; a DJ put on through playEndless;
// a preset by number as the DJ on it now, or the Requests playlist; pause,
// play again, skip and move through the bar's own verbs (transport.js). Only
// ever after Amazon's signature check (alexa-sign.js).
//
// AMAZON'S EIGHT SECONDS (the plan, after Codex's review): a call budget
// counts calls, not time, so every action races a real five-second deadline.
// Done in time, its outcome is said. Not done, Alexa says what was begun and
// the work finishes after the answer (ctx.waitUntil, which Cloudflare cuts 30
// seconds later), its outcome logged as `alexa: late`. The answer never
// claims what the background has not done.

import { ROSTER } from "./djs.js";
import { askDjOn } from "./toollist.js";
import { endlessWords } from "./alexa-read.js";
import { ALEXA_INVOCATION } from "./alexa-model.js";
import { askByVoice, LENGTH_WORDS, onWords } from "./asks.js";
import { endlessLoad, endlessNoStart, endlessPageSteer, endlessPresets, endlessStartFresh, endlessUpdate, parseEndless, playEndless,
  sameWords, sleptThrough } from "./endless.js";
import { findDj, house, presetOnFile } from "./house.js";
import { helperCommand, helperGot, helperViewOf, onStream, readPauseNote } from "./now.js";
import { startPlaylistOnDevice } from "./playback.js";
import { parseSpeakers, readReadings } from "./room.js";
import { catalogFor, playerState, playlistItems, programsKV, throttledUntil, withBudget } from "./services.js";
import { trackRecord } from "./shelf.js";
import { fingerprintUris, getRequestRecord, putRequestRecord, SETTLED_TTL_MS } from "./station.js";
import { callTool } from "./tools.js";
import { writerKindFor } from "./toollist.js";
import { moveOn, pauseOn, playAgainOn, skipOn } from "./transport.js";
import { emitRequestEvent } from "./writes.js";

export const ACT_DEADLINE_MS = 5000;
// The deadline in use: a test makes it short; nothing a request says can.
export const alexaActClock = { deadlineMs: ACT_DEADLINE_MS };
export const alexaActs = (env) => env?.ALEXA_ACTS === "on";

const fold = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const nameOf = (key) => ROSTER[key]?.name ?? key;
const SPOTIFY_LIMITED = "Spotify is limiting the house's requests for a while, so I can't do that now. Try again later.";

// The work, or null when it was not done by the deadline: it goes on after
// the answer, its outcome logged.
async function inTime(ctx, work, label, ms = alexaActClock.deadlineMs) {
  let timer;
  const LATE = Symbol("late");
  const late = new Promise((r) => { timer = setTimeout(() => r(LATE), ms); });
  const out = await Promise.race([work, late]);
  clearTimeout(timer);
  if (out !== LATE) return out;
  const rest = work.then((r) => console.log(`alexa: late ${label} did=${JSON.stringify(r?.did ?? r ?? null)}`))
    .catch((e) => console.log(`alexa: late ${label} failed ${String(e?.message ?? e).slice(0, 120)}`));
  if (ctx?.waitUntil) ctx.waitUntil(rest);
  return null;
}

// A start's code said: "ok" confirmed, "sent" taken but not confirmed.
function startSaid(code, who, device) {
  if (code === "ok") return `${who} is playing ${onWords(device)}.`;
  if (code === "sent") return `${who} should be starting ${onWords(device)}: Spotify took it but hasn't confirmed it yet.`;
  if (code === "stuck") return `Spotify took the start ${onWords(device)}, but ${who} isn't playing there.`;
  if (code === "asleep") return `The ${device} didn't answer; it may be asleep.`;
  return `I couldn't start ${who} ${onWords(device)}.`;
}

// THE HOME HELPER'S HANDS (MC-38 stage 4, the owner, 2026-11-07: "can it
// basically press any preset on the wiim once the helper is on?"). With the
// helper on, a preset is PRESSED on the WiiM, as its remote presses it: its
// saved settings, a Tidal or radio preset, whatever the key holds. Codex's review:
// one guarded press (a WiiM of the house's list, a key 1 to 12, the hands
// fresh), said as "pressed", never as playing (the read-back is the
// speaker's, not proof of the key's source); a timeout is not a no, so
// nothing else is started after one.
async function helperLan(env) {
  try { return helperViewOf(env, await helperGot(env)).lan ?? null; } catch { return null; }
}
// Its hands: on, and listening for a command now (a reading alone is not).
async function helperHands(env) {
  const lan = await helperLan(env);
  return lan?.hands ? lan : null;
}
const wiimOf = (env, name) => (name ? parseSpeakers(env).find((b) => b.name === name) ?? null : null);
// Each house WiiM as the helper last heard it, by name ({} with the helper off).
export async function wiimReadings(env) {
  const lan = await helperLan(env);
  return Object.fromEntries(Object.entries(lan?.speakers ?? {}).filter(([name]) => wiimOf(env, name)));
}
const notSpotify = (r) => !!r?.source && !/spotify/i.test(r.source);
// Known not pressed: nothing reached the WiiM, so today's start may follow.
const NOT_PRESSED = ["not-wiim", "bad-key", "helper-off", "unreachable"];
export async function wiimPress(env, deviceName, n) {
  const box = wiimOf(env, deviceName);
  if (!box) return { code: "not-wiim" };
  if (!Number.isInteger(n) || n < 1 || n > 12) return { code: "bad-key", box };
  if (!(await helperHands(env))) return { code: "helper-off", box };
  const out = await helperCommand(env, { cmd: "key", n, speaker: box.name });
  return { code: out.code, heard: out.heard ?? null, box };
}
// What the WiiM holds on a key, by its own reading (name and source).
async function heldOn(env, box, n) {
  try { return (await readReadings(env, [box]))[box.slug]?.presets?.find((x) => x.btn === n) ?? null; } catch { return null; }
}
const heldName = (held) => (held?.name ? String(held.name).replace(/\s*·\s*/g, " on ") : null);
// A press, said: { say, did } once it was sent (pressed, or not known), or
// { fallback: code } when nothing reached the WiiM.
async function pressSaid(env, n, device, label = null) {
  const p = await wiimPress(env, device, n);
  if (NOT_PRESSED.includes(p.code)) return { fallback: p.code };
  const held = p.box ? await heldOn(env, p.box, n) : null;
  const name = label ?? heldName(held);
  const did = { press: n, on: p.box.name, code: p.code, ...(p.heard ? { heard: { state: p.heard.state, source: p.heard.source ?? null } } : {}) };
  if (p.code !== "ok") {
    return { say: `I've sent the press for ${n} on the ${p.box.name}; it may still happen. The app shows what plays.`, did };
  }
  // An endless preset pressed: the watch looks on its next run, as after the
  // Speakers page's Play, so its session and top-ups begin at once.
  if ((parseEndless(env)?.presets ?? []).some((x) => x.button === n)) {
    try { await endlessNoStart(env, n, null); await endlessUpdate(env, (st) => { st.lastLook = 0; return {}; }); } catch { /* the watch finds it */ }
  }
  // Read back about four seconds after the press: the radio and Pandora are
  // often still starting then (preset 11, 2026-11-08: playing within the
  // minute), so it is said as starting, never as not playing.
  const quiet = p.heard && p.heard.state !== "play" ? " It may take a few seconds to start." : "";
  return { say: `Pressed ${n} on the ${p.box.name}${name ? `: ${name}` : ""}.${quiet}`, did };
}
// WHAT A PRESS BRINGS (2026-11-08, both WiiMs' tables read): a WiiM Home
// "Smart Preset" can save a volume and an EQ with a button, and only a few
// buttons have any (none of Hank's), so this never promises an EQ.
const HELPER_OFF = (device) => ` The home helper is off, so any settings saved with the preset aren't applied on the ${device}.`;

// 1. AN ASK, filed as Talk files one, `via` "alexa".
async function ask(env, ctx, key, r) {
  const dj = nameOf(key);
  if (!askDjOn(env)) return { say: `This house has no curator taking asks, so I couldn't ask ${dj}.`, did: { ask: "off" } };
  let res;
  try {
    res = await askByVoice(env, ctx, { dj, words: r.words || `no ${r.avoid}`, avoid: r.avoid ?? undefined,
      minutes: r.minutes, device: r.device, via: "alexa", ...(r.keep ? { keep: true } : {}) });
  } catch (e) {
    return { say: `I couldn't ask ${dj}. Nothing was filed.`, did: { ask: "refused", why: String(e?.message ?? e).slice(0, 120) } };
  }
  if (res.status === "sent") {
    const say = res.tidal === false
      ? String(res.said ?? "").replace(/\s*You can hang up\.$/, "")
      // What already plays gives way; only something started after the ask
      // keeps it from starting (2026-11-08: "unless something else is
      // playing" was said while Deep Dive played, and Sessions replaced him).
      : `${dj} is on it: ${LENGTH_WORDS[res.minutes]}, starting ${onWords(r.device)} in about five minutes, ` +
        `unless something else is started before then. It goes on preset ${res.preset}${r.keep ? ", and on the Shelf as well" : ""}.`;
    return { say, did: { ask: "sent", id: res.id ?? null, preset: res.preset, ...(r.keep ? { keep: true } : {}) } };
  }
  return { say: String(res.said ?? `${dj} couldn't take the ask.`).replace(/\s*You can hang up\.$/, ""), did: { ask: res.status } };
}

// 2. A DJ PUT ON, through playEndless, each outcome said.
const NEEDS_EXAMPLE = { "an artist": "for Deep Dive on Solomon Burke", "a genre": "for Genre, nineties shoegaze" };
// ONE OPENING AT A TIME (the owner, 2026-11-07: Michael Jackson asked twice
// two minutes apart, and the guest preset's opening was made twice, an
// endless run spent twice). The same DJ asked again while their opening is
// still being made, with no new words or the same ones, is told so.
async function stillMaking(env, key, words) {
  try {
    const lane = (await endlessLoad(env))?.lane ?? null;
    const theirs = lane?.dj && findDj(env, lane.dj)?.key === key && lane.ready === false;
    if (theirs && (!words || sameWords(words, lane.words))) {
      return { say: `${nameOf(key)} is already making that set; it starts by itself in a few minutes.`, did: { put: "already-making" } };
    }
  } catch { /* playEndless reads the state itself */ }
  return null;
}
// A HOUSE DJ'S OWN KEY, PRESSED (stage 4): the key they hold now (MC-24's
// assignment over the config), and only when the WiiM's own reading of
// that key still names them (a swap can leave it saying who left). A guest
// is never pressed: 3 plays whoever is on it, not the DJ asked.
async function ownKeyOf(env, key) {
  try {
    const cfg = parseEndless(env);
    return cfg?.mode === "live" ? endlessPresets(env, cfg, await endlessLoad(env))
      .find((x) => !x.lane && !x.program && x.dj && findDj(env, x.dj)?.key === key) ?? null : null;
  } catch { return null; }
}
// { say, did } once the press was sent, or null: nothing reached the WiiM.
async function pressKeyOf(env, own, key, device) {
  const who = nameOf(key);
  const held = await heldOn(env, wiimOf(env, device), own.button);
  // The key's own name is the DJ's, exactly (Codex's review, 2026-11-08:
  // "Soul Train" on Soul's key once read as Soul).
  if (!held || fold(held.name) !== fold(who)) return null;
  const p = await pressSaid(env, own.button, device, who);
  return p.fallback ? null : { say: p.say, did: { put: "pressed", ...p.did } };
}
// THE SAME PRESS, FROM TALK (MC-39, tasks/mc39-talk-presses.md): "put on
// Hank" on a WiiM presses Hank's own key. One entry point with the guard
// above inside it (Codex's review), so Talk and maple crate press alike.
// Null for a DJ with no key of their own, a speaker that isn't a WiiM, or a
// press that never reached it: the caller goes on as before.
export async function pressOwnKey(env, key, device) {
  const own = wiimOf(env, device) ? await ownKeyOf(env, key) : null;
  if (!own) return null;
  return (await stillMaking(env, key, null)) ?? pressKeyOf(env, own, key, device);
}

async function putOn(env, key, device, { words = null, when = null, limited = false } = {}) {
  const who = nameOf(key);
  const making = await stillMaking(env, key, words);
  if (making) return making;
  if (!words && !when && wiimOf(env, device)) {
    const own = await ownKeyOf(env, key);
    const p = own ? await pressKeyOf(env, own, key, device) : null;
    if (p) return p;
  }
  if (limited) return { say: SPOTIFY_LIMITED, did: { throttled: true } };
  let r;
  try {
    r = await playEndless(env, { dj: key, device, budget: { remaining: 40 }, ...(words ? { words } : {}),
      ...(when === "now" || when === "next" ? { when } : {}) });
  } catch (e) {
    return { say: `I couldn't start ${who}.`, did: { put: "failed", why: String(e?.message ?? e).slice(0, 80) } };
  }
  const did = { put: r.status, ...(r.start ? { start: r.start } : {}), ...(r.button ? { button: r.button } : {}) };
  const dj = ROSTER[key];
  switch (r.status) {
    case "own-preset": {
      // WORDS ON A DJ'S OWN PRESET, STEERED (the owner, 2026-11-08:
      // "Sessions, acoustic grunge, endless" started 6 and dropped the
      // words). The preset starts as made, and once it plays the words steer
      // it, as the box on the DJ's page does: the new songs come in after
      // the song that is playing.
      if (!words) return { say: startSaid(r.start, who, device), did };
      if (r.start !== "ok") return { say: `${startSaid(r.start, who, device)} Once it plays, say "steer toward ${words}".`, did };
      const s = await endlessPageSteer(env, { button: r.button, words, by: "by voice" }).catch(() => ({ status: "failed" }));
      if (s.status === "asked") {
        return { say: `${who} is playing ${onWords(device)}, steering toward ${words}: the new songs come in after this one, in a few minutes.`,
          did: { ...did, steer: "asked" } };
      }
      return { say: `${startSaid(r.start, who, device)} ${s.status === "day-cap" ? "No more DJ runs today, so it can't be steered until after midnight."
        : `Steering toward ${words} didn't reach ${who}: say "steer toward ${words}" to try again.`}`, did: { ...did, steer: s.status } };
    }
    case "carry-on": case "started":
      return { say: startSaid(r.start, who, device), did };
    case "already": return { say: `${who} is already playing, on preset ${r.button}.`, did };
    case "busy": return { say: `${nameOf(findDj(env, r.current)?.key ?? r.current)} is playing on the guest preset` +
      `${r.on ? ` on the ${r.on}` : ""}. To put ${who} on instead, ask again with "now" or "after this song".`, did };
    case "needs-words": {
      const ex = NEEDS_EXAMPLE[r.needs];
      return { say: `${who} needs to be told ${r.needs ?? dj?.needsWords ?? "what to play"}.` +
        (ex ? ` Ask again with it, for example: ask ${ALEXA_INVOCATION} ${ex}.` : " Ask again with it."), did };
    }
    case "making": return { say: `${who} is making an opening set for the guest preset; it starts by itself in a few minutes.`, did };
    case "next": return { say: `${who} takes the guest preset over after this song.`, did };
    case "day-cap": return { say: "The guest preset has made all its sets for today. Try a house DJ, or tomorrow.", did };
    case "moved": return { say: "Something changed on the guest preset while I asked. Ask again.", did };
    case "off": return { say: `Endless DJs are off in this house, so I couldn't put ${who} on.`, did };
    case "no-endless": return { say: `${who} doesn't play endless, so I couldn't put them on.`, did };
    default: return { say: `I couldn't start ${who} ${onWords(device)}.`, did };
  }
}

// 3. A PRESET BY NUMBER: 2 (Tidal) to the remote; a DJ's preset as that DJ
// put on; the Requests playlist (or another Spotify list on file) started as
// the Speakers page's Play starts it.
//
// A SPEAKER WITH NO KEYS (the owner's test, 2026-11-08, presets 10 and 12
// asked of the bedroom Echo): what a key holds is the WiiMs' own word, read
// by the helper or the phone. A key that isn't Spotify there is said by name
// and where it plays; an old "was button N" alias is a guess from before
// those readings, and is never started over the table's word (it named an
// old list for 10, and Americana's for 11).
async function keyHeld(env, device, n) {
  const boxes = parseSpeakers(env);
  if (!boxes.length) return null;
  const own = wiimOf(env, device);
  const order = own ? [own, ...boxes.filter((b) => b.slug !== own.slug)] : boxes;
  let recs = {};
  try { recs = await readReadings(env, order); } catch { recs = {}; }
  const read = order.filter((b) => recs[b.slug]);
  if (!read.length) return null;
  for (const b of read) {
    const k = recs[b.slug].presets.find((x) => x.btn === n);
    if (k) return { held: k };
  }
  return { held: null };
}
const keySource = (src) => (/tunein|radio|iheart/i.test(src ?? "") ? "the radio" : /pandora/i.test(src ?? "") ? "Pandora"
  : /tidal/i.test(src ?? "") ? "Tidal" : String(src ?? "").replace(/\d+$/, ""));
// "the Pro Plus and the Ultra"
const wiimsSaid = (boxes) => boxes.map((b) => `the ${b.name}`).join(boxes.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, ", and $1");
async function preset(env, n, device, { limited = false } = {}) {
  // Pressed for real when the helper is on and the speaker is a WiiM.
  const pressed = await pressSaid(env, n, device);
  if (!pressed.fallback) return { say: pressed.say, did: { preset: n, ...pressed.did } };
  const why = pressed.fallback === "helper-off" ? " The home helper is off" : pressed.fallback === "unreachable" ? " The helper couldn't reach it" : "";
  // Asked of a speaker with no keys, in a house with WiiMs: where it plays,
  // never "the remote", which an Echo has not.
  const boxes = parseSpeakers(env);
  const keyless = boxes.length > 0 && !wiimOf(env, device);
  const notHere = (what) => keyless
    ? { say: `Preset ${n} is ${what}, which plays only on ${wiimsSaid(boxes)}. Ask for preset ${n} on the ${boxes[0].name}.`, to: "wiim" }
    : { say: `Preset ${n} is ${what}, which can't be started from here${why ? `:${why.toLowerCase()}` : ""}. Press ${n} on the remote.`, to: "remote" };
  const other = Object.values(house(env).guest ?? {}).find((g) => g && g.btn === n && g.catalog !== "spotify") ?? null;
  if (other) {
    const said = notHere(String(other.name).replace(/\s*·\s*/g, " on "));
    return { say: said.say, did: { preset: n, to: said.to, ...(why ? { press: pressed.fallback } : {}) } };
  }
  if (limited) return { say: SPOTIFY_LIMITED, did: { throttled: true } };
  const eqNote = pressed.fallback === "helper-off" && wiimOf(env, device) ? HELPER_OFF(device) : "";
  const cfg = parseEndless(env);
  const slot = cfg?.mode === "live" ? cfg.presets.find((p) => p.button === n) : null;
  if (slot) {
    let on = null;
    try { on = endlessPresets(env, cfg, await endlessLoad(env)).find((p) => p.button === n)?.dj ?? null; } catch { on = null; }
    const key = on ? findDj(env, on)?.key ?? null : null;
    if (!key || !ROSTER[key]) return { say: `Preset ${n} has no DJ on it right now.`, did: { preset: n, dj: null } };
    const out = await putOn(env, key, device);
    return { ...out, say: out.say + eqNote, did: { preset: n, dj: key, ...out.did } };
  }
  const k = await keyHeld(env, device, n);
  if (k?.held && notSpotify(k.held)) {
    const said = notHere(`${heldName(k.held)}, on ${keySource(k.held.source)}`);
    return { say: said.say, did: { preset: n, held: k.held.source, to: said.to } };
  }
  let file = presetOnFile(env, n);
  if (k && file && /^alias "was button/.test(file.via ?? "")) file = null;
  if (!file || file.endless) {
    // A Spotify key the house has no list for: its name, and where it plays.
    if (k?.held) {
      const what = `${heldName(k.held)}, on Spotify`;
      return { say: keyless
        ? `Preset ${n} is ${what}, which I can only press on ${wiimsSaid(boxes)}. Ask for preset ${n} on the ${boxes[0].name}.`
        : `Preset ${n} is ${what}, which I can't start from here${why ? `:${why.toLowerCase()}` : ""}. Press ${n} on the remote.`,
      did: { preset: n, held: k.held.source, to: keyless ? "wiim" : "remote" } };
    }
    return { say: `I don't know of anything on preset ${n} that I could start${why ? `:${why.toLowerCase()}` : ""}. ` +
      (keyless ? `Ask for preset ${n} on the ${boxes[0].name}.` : `Press ${n} on the remote.`), did: { preset: n, file: null } };
  }
  const label = file.name ? String(file.name).replace(/\s*·\s*/g, " on ") : `preset ${n}`;
  try {
    const out = await startPlaylistOnDevice(env, { id: file.id, name: file.name ?? `preset ${n}`, catalog: "spotify" }, device, { remaining: 16 });
    const code = out.preset_safe ? "ok" : out.unverified ? "sent" : "stuck";
    return { say: startSaid(code, `Preset ${n}, ${label}`, device) + eqNote, did: { preset: n, start: code } };
  } catch (e) {
    const code = sleptThrough(e) || e?.noSuchDevice ? "asleep" : "failed";
    return { say: startSaid(code, `preset ${n}`, device), did: { preset: n, start: code } };
  }
}

// A PRESET BY NUMBER, UNDER SPOTIFY'S LIMIT (alexaAct's until MC-39, now
// shared with Talk): a press by the helper costs no Spotify call, so on a
// WiiM with the helper's hands it goes on while the account is limited, and
// its Spotify fallback says the limit. A Tidal preset is never refused for
// it. Anywhere else, the limit is said and nothing is tried.
export async function presetAct(env, n, device) {
  const tidal = Object.values(house(env).guest ?? {}).some((g) => g && g.btn === n && g.catalog !== "spotify");
  let limited = false;
  if (!tidal && await throttledUntil(env)) {
    if (!(wiimOf(env, device) && await helperHands(env))) return { say: SPOTIFY_LIMITED, did: { throttled: true } };
    limited = true;
  }
  return preset(env, n, device, { limited });
}

// A PRESET BY WHAT IT HOLDS (MC-39: "put on Radio Paradise"): the one key
// saved under that name in the named WiiM's own table, or, for a speaker
// with no keys, in the WiiMs' tables where they agree. The names are text
// from the WiiM app, so they are matched whole (case, spaces and punctuation
// aside), never fuzzily, and handed back as data, never as instructions
// (Codex's review). `n` null: no key, or more than one; `keys` is the table
// to choose from, at most twelve, each name cut short.
export async function keyNamed(env, device, name) {
  const want = fold(name);
  const own = wiimOf(env, device);
  const look = own ? [own] : parseSpeakers(env);
  let recs = {};
  try { recs = await readReadings(env, look); } catch { recs = {}; }
  const tables = look.map((b) => recs[b.slug]?.presets).filter(Array.isArray);
  const hits = [...new Set(tables.flat().filter((k) => want && fold(k?.name) === want).map((k) => k.btn))];
  const keys = (tables[0] ?? []).filter((k) => Number.isInteger(k?.btn)).slice(0, 12)
    .map((k) => ({ n: k.btn, name: String(k.name ?? "").slice(0, 60), on: keySource(k.source) }));
  return { n: hits.length === 1 ? hits[0] : null, many: hits.length > 1, keys };
}

// Which preset a playing playlist is, and whose: the house's guest presets
// and endless presets, by playlist id.
async function presetOfPlaylist(env, pid) {
  if (!pid) return null;
  const g = Object.values(house(env).guest ?? {}).find((x) => x?.playlist === pid) ?? null;
  if (g) return { n: g.btn, label: String(g.name).replace(/\s*·\s*/g, " on ") };
  const cfg = parseEndless(env);
  const p = cfg?.presets.find((x) => x.playlist === pid) ?? null;
  if (!p) return null;
  let dj = null;
  try { dj = endlessPresets(env, cfg, await endlessLoad(env)).find((x) => x.button === p.button)?.dj ?? null; } catch { dj = null; }
  const who = dj ? findDj(env, dj)?.name ?? null : null;
  return { n: p.button, label: who ? `${who}'s` : p.lane ? "the guest DJ's" : null };
}

// 4. WHAT'S PLAYING: one player read; paused told from nothing.
// What a WiiM plays that Spotify can't see, by the helper's reading.
const sourceWords = (r) => (r.station || /tunein|radio|iheart/i.test(r.source ?? "") ? "the radio" : r.source);
function helperSaid(name, r) {
  const what = r.track ? `${r.track}${r.artists ? `, by ${r.artists}` : ""}` : r.station ?? null;
  return `On the ${name}: ${what ? `${what}, on ${sourceWords(r)}` : sourceWords(r)}.`;
}
async function nowSays(env, room) {
  const envB = withBudget(env, { remaining: 4 });
  const st = await playerState(envB);
  // Stage 4: a WiiM on Tidal or the radio, by the helper's reading, is what
  // plays when Spotify plays nothing (or nothing on the speaker said).
  const lan = await helperLan(env);
  const live = lan ? Object.entries(lan.speakers ?? {}).filter(([name, r]) => wiimOf(env, name) && r.state === "play" && onStream(r)
    && (!room || fold(name) === fold(room))) : [];
  const spotifyHere = st?.is_playing === true && st?.item && (!room || fold(st.device?.name) === fold(room));
  if (!spotifyHere && live.length) return { say: helperSaid(live[0][0], live[0][1]), did: { now: "helper", on: live[0][0] } };
  if (!st?.item) return { say: "Nothing is playing on Spotify.", did: { now: "nothing" } };
  const where = st.device?.name ?? "a speaker";
  const isEpisode = st.currently_playing_type === "episode" || st.item.type === "episode";
  const what = isEpisode ? `${st.item.name}, from ${st.item.show?.name ?? "a podcast"}`
    : `${st.item.name}, by ${(st.item.artists ?? []).map((a) => a.name).slice(0, 3).join(" and ")}`;
  const pid = String(st.context?.uri ?? "").match(/^spotify:playlist:([A-Za-z0-9]{22})$/)?.[1] ?? null;
  const from = await presetOfPlaylist(env, pid);
  const fromSaid = from ? `, from preset ${from.n}${from.label ? `, ${from.label}` : ""}` : "";
  const head = st.is_playing ? `On the ${where}` : `Paused on the ${where}`;
  const other = room && fold(room) !== fold(where) ? `The ${room} isn't playing. ` : "";
  return { say: `${other}${head}: ${what}${fromSaid}.`, did: { now: st.is_playing ? "playing" : "paused", on: where } };
}

// The speaker an act on what plays means: the one said, else the one Spotify
// plays on now (null: nothing plays).
async function playingBox(env, room) {
  if (room) return { name: room };
  const st = await playerState(withBudget(env, { remaining: 2 }));
  return st?.device?.name && st.is_playing === true ? { name: st.device.name } : null;
}

// HUSH AND CARRY ON PAST SPOTIFY (stage 4): a WiiM on Tidal or the radio,
// by the helper's fresh reading, paused or resumed by the helper, as the
// bar's hpause and hplay do. One room surely (Codex's review): the speaker
// said, or the only WiiM in that state; two or more, Alexa asks which.
// Spotify itself is never resumed this way: only a source the helper plays.
export async function helperTransport(env, room, kind) {
  const hands = await helperHands(env);
  if (!hands) return null;
  const want = kind === "pause" ? "play" : "pause";
  const cands = Object.entries(hands.speakers ?? {}).filter(([name, r]) => wiimOf(env, name) && r.state === want && onStream(r)
    && (!room || fold(name) === fold(room)));
  if (!cands.length) return null;
  if (cands.length > 1) {
    const names = cands.map(([n]) => `the ${n}`).join(" and ");
    return { say: `${names[0].toUpperCase()}${names.slice(1)} are both ${want === "play" ? "playing" : "paused"}: say which, for example: ${kind === "pause" ? "hush" : "carry on"} on the ${cands[1][0]}.`,
      did: { [kind]: "which", on: cands.map(([n]) => n) } };
  }
  const [name, r] = cands[0];
  const out = await helperCommand(env, { cmd: kind === "pause" ? "pause" : "resume", speaker: name });
  const what = sourceWords(r);
  if (out.code === "ok") return { say: kind === "pause" ? `Paused ${what} on the ${name}.` : `Playing ${what} again on the ${name}.`, did: { [kind]: "helper", on: name } };
  if (out.code === "timeout" || out.code === "failed") return { say: `I've sent that to the ${name}; it may take a moment.`, did: { [kind]: out.code, on: name } };
  return { say: `The helper couldn't reach the ${name}.`, did: { [kind]: out.code, on: name } };
}

// 5 to 8. PAUSE, PLAY AGAIN, SKIP, MOVE: the bar's own verbs.
async function player(env, ctx, kind, room) {
  if (kind === "again") {
    const note = await readPauseNote(env);
    const box = room ? { name: room } : note?.device ? { name: note.device } : null;
    if (!box || (room && note?.device && fold(note.device) !== fold(room)) || !(note?.pid || note?.uris?.length)) {
      // No Spotify pause to play again there: a WiiM the helper paused, if one.
      const h = await helperTransport(env, room, "again");
      if (h) return h;
    }
    if (!box) return { say: "There's nothing paused to play again.", did: { again: "expired" } };
    const { code } = await playAgainOn(env, box);
    if (code === "expired") return { say: room && note?.device && fold(note.device) !== fold(room)
      ? `The last pause was on the ${note.device}, not the ${room}.` : "There's nothing paused to play again.", did: { again: code } };
    return { say: code === "ok" ? `Playing again ${onWords(box.name)}.` : startSaid(code, "it", box.name), did: { again: code, on: box.name } };
  }
  if (kind === "move") {
    if (!room) return { say: "Which speaker? Say, for example: move the music to the Ultra.", did: { move: "no-speaker" } };
    const { code } = await moveOn(env, { name: room });
    const to = /^everywhere$/i.test(room) ? "everywhere" : `to the ${room}`;
    const said = { ok: `Moved ${to}.`, quiet: "Nothing is playing on Spotify to move.", here: `It's already playing ${onWords(room)}.`,
      asleep: `The ${room} didn't answer; it may be asleep.` }[code] ?? `I couldn't move the music ${to}.`;
    return { say: said, did: { move: code, to: room } };
  }
  if (kind === "pause") {
    // A WiiM the helper reads on Tidal or the radio is paused by the helper,
    // even when Spotify still calls a stale session there "playing".
    const hands = await helperHands(env);
    const r = room && hands ? hands.speakers?.[room] : null;
    if (r && r.state === "play" && onStream(r) && wiimOf(env, room)) {
      const h = await helperTransport(env, room, "pause");
      if (h) return h;
    }
  }
  const box = await playingBox(env, room);
  if (!box) {
    const h = kind === "pause" ? await helperTransport(env, room, "pause") : null;
    return h ?? { say: "Nothing is playing on Spotify.", did: { [kind]: "quiet" } };
  }
  const { code } = kind === "pause" ? await pauseOn(env, box, parseSpeakers(env))
    : await skipOn(env, ctx, box, kind === "back" ? "prev" : "next");
  if (code === "gone") {
    const h = kind === "pause" ? await helperTransport(env, room, "pause") : null;
    return h ?? { say: room ? `Nothing is playing on Spotify ${onWords(room)}.` : "Nothing is playing on Spotify.", did: { [kind]: code } };
  }
  if (code !== "ok") return { say: kind === "pause" ? `I couldn't pause ${onWords(box.name)}.` : `I couldn't skip ${onWords(box.name)}.`, did: { [kind]: code } };
  return { say: kind === "pause" ? `Paused ${onWords(box.name)}.` : kind === "back" ? "Back a song." : "Skipped.", did: { [kind]: "ok", on: box.name } };
}

// A FRESH START of the preset the DJ is on (the DJ page's Start fresh): a new
// opening set, made by the curator, started on the speaker once it lands.
async function fresh(env, key, device) {
  const who = nameOf(key);
  const cfg = parseEndless(env);
  if (!cfg || cfg.mode !== "live") return { say: `Endless DJs are off in this house, so I couldn't start ${who} fresh.`, did: { fresh: "off" } };
  let p = null;
  try {
    p = endlessPresets(env, cfg, await endlessLoad(env)).find((x) => !x.program && x.dj && findDj(env, x.dj)?.key === key) ?? null;
  } catch { p = null; }
  if (!p) return { say: `${who} isn't on a preset right now, so there's nothing to start fresh. Say: put on ${who}.`, did: { fresh: "no-preset" } };
  const r = await endlessStartFresh(env, { button: p.button, device });
  const did = { fresh: r.status, button: p.button };
  if (r.status === "asked") return { say: `${who} is making a fresh set for preset ${p.button}. It starts ${onWords(device)} in about four minutes.`, did };
  if (r.status === "day-cap") return { say: "No more DJ runs today; new sets again after midnight.", did };
  return { say: `I couldn't start ${who} fresh.`, did };
}

// STEERING the DJ who is playing. The bar's two buttons as the bar sends
// them: on an endless preset, its own steer (endlessPageSteer, "change it
// up" leaving the guest's words behind); on a set on the Requests preset,
// steer_endless with the rest replaced, a tap being the asking. A direction
// in the listener's words goes as Talk sends one: steer_endless.
const MORE_WORDS = (pl) => `More like what is playing now${pl?.item?.name ? `: "${String(pl.item.name).slice(0, 80)}"${
  pl.item.artists?.[0]?.name ? ` by ${String(pl.item.artists[0].name).slice(0, 60)}` : ""}` : ""}, and the last few songs`;
const CHANGE_WORDS = "Change it up: a different corner of your brief from the last few songs";
const STEERED = {
  asked: "Asked: the new songs come in after this one, in a few minutes.",
  "not-playing": "No DJ is playing to steer. Put one on first.",
  "day-cap": "No more DJ runs today; steering works again after midnight.",
  throttled: SPOTIFY_LIMITED,
  failed: "That didn't reach the DJ. Try again.",
};
async function steer(env, s) {
  let code;
  if (s.kind === "more" || s.kind === "change") {
    let pl = null;
    try { pl = await playerState(withBudget(env, { remaining: 2 })); } catch { pl = null; }
    const pid = String(pl?.context?.uri ?? "").match(/^spotify:playlist:([A-Za-z0-9]{22})$/)?.[1] ?? null;
    const preset = pl?.is_playing === true && pid ? (parseEndless(env)?.presets ?? []).find((x) => x.playlist === pid) ?? null : null;
    if (preset) {
      const r = await endlessPageSteer(env, { button: preset.button, words: s.kind === "more" ? MORE_WORDS : CHANGE_WORDS, leaveWords: s.kind === "change" });
      code = r.status === "asked" ? "asked" : ["not-playing", "day-cap", "throttled"].includes(r.status) ? r.status : "failed";
      return { say: STEERED[code], did: { steer: code, on: preset.button } };
    }
    return steerWords(env, s.kind === "more" ? MORE_WORDS(pl) : CHANGE_WORDS, true);
  }
  return steerWords(env, s.words, false);
}
async function steerWords(env, words, replaceRest) {
  let code;
  try {
    const r = await callTool(env, "steer_endless", { words, when: "next", ...(replaceRest ? { replace_rest: true } : {}) }, { remaining: 20 });
    // Own words over a set on the Requests preset take the gentle way: the
    // set plays to its end as made, then the DJ carries on that way. Taken,
    // so never said as not reaching the DJ (2026-11-07 22:03, "more upbeat").
    if (r?.status === "after-the-program") {
      return { say: `${nameOf(findDj(env, r.dj)?.key ?? r.dj)} plays this set to its end, then carries on that way.`, did: { steer: "after" } };
    }
    code = r?.status === "asked" || r?.status === "steered" ? "asked" : "failed";
  } catch (e) {
    const m = String(e?.message ?? e);
    code = /runs are used up/.test(m) ? "day-cap" : /limiting this account/.test(m) ? "throttled"
      : /steering works while|is not the one playing|names no DJ|took over|not playing|nothing .*plays/i.test(m) ? "not-playing" : "failed";
  }
  return { say: STEERED[code], did: { steer: code } };
}

// KEEP the requested set that is playing (the DJ page's Keep, after the
// fact): its ask is marked kept, as the Ask form's box marks one, and the
// curator is woken to write its page for the Shelf, a writer's notes at the
// house's default. The skill writes no page of its own.
async function keepPlaying(env, ctx) {
  const g = house(env).guest?.spotify ?? null;
  if (!g?.playlist) return { say: "This house has no Requests preset on Spotify, so there's nothing to keep.", did: { keep: "none" } };
  let st = null;
  try { st = await playerState(withBudget(env, { remaining: 2 })); } catch { st = null; }
  const pid = String(st?.context?.uri ?? "").match(/^spotify:playlist:([A-Za-z0-9]{22})$/)?.[1] ?? null;
  if (!st?.item || pid !== g.playlist) {
    return { say: "No requested set is playing right now. To keep one, say \"and keep it\" when you ask for it.", did: { keep: "not-playing" } };
  }
  let ptr = null;
  try { ptr = await programsKV(env).get(`ask:${pid}`, { type: "json" }); } catch { ptr = null; }
  const rec = ptr?.requestId ? await getRequestRecord(env, ptr.requestId) : null;
  if (!rec) return { say: "I can't find the ask behind this set, so it can't be kept from here.", did: { keep: "no-ask" } };
  if (rec.keep === true) return { say: "This set is already being kept on the Shelf.", did: { keep: "already", id: rec.id } };
  // ITS SONGS, SAVED FIRST (the owner, 2026-11-07: the first keep by voice
  // reached the curator with no track list, since the house saves one only
  // when Keep is ticked as the set is made, and the curator closed it with no
  // page, as it must). Read off the preset as it is now, the way keep_set
  // reads it, into the record fulfil_request writes for a ticked Keep.
  let saved = null;
  try { saved = await programsKV(env).get(`fulfilled:${rec.id}`); } catch { saved = null; }
  if (!saved) {
    let live = null;
    try { live = await playlistItems(catalogFor(env, "spotify"), pid, { remaining: 4 }, 200); } catch { live = null; }
    if (!live?.complete || !live.items.length || !live.items.every(Boolean)) {
      return { say: "I couldn't read the set whole just now, so it isn't kept. Try again in a moment.", did: { keep: "unread", id: rec.id } };
    }
    await programsKV(env).put(`fulfilled:${rec.id}`, JSON.stringify({
      requestId: rec.id, playlistId: pid, fingerprint: await fingerprintUris(live.items.map((t) => t.uri)),
      at: new Date().toISOString(), tracks: live.items.map((t) => trackRecord(t)), via: "alexa keep",
    }), { expirationTtl: Math.ceil(SETTLED_TTL_MS / 1000) });
  }
  const dj = findDj(env, rec.dj);
  const notes = dj && writerKindFor(env, dj) && !rec.notes ? (env.REQUEST_NOTES === "long" ? "long" : "short") : null;
  await putRequestRecord(env, { ...rec, keep: true, ...(notes ? { notes } : {}) }, { settled: true });
  if (env.AUTOFULFILL_ENABLED === "true") {
    const ring = emitRequestEvent(env, rec.id, `.keep${Date.now()}`).catch(() => false);
    if (ctx?.waitUntil) ctx.waitUntil(ring); else await ring;
  }
  return { say: `Keeping it: ${dj?.name ?? "the DJ"} writes its page for the Shelf in a few minutes.`, did: { keep: "asked", id: rec.id } };
}

const BEGUN = {
  "ask-dj": (h) => `Asking ${nameOf(h.dj)}; the app shows the set when it lands.`,
  "put-on": (h) => `I've asked for ${nameOf(h.dj)} ${onWords(h.device ?? h.reading?.device)}; it may take a moment. The app shows when it plays.`,
  // A press only where the helper presses; anywhere else the preset's
  // playlist is started (an Echo has no keys: 2026-11-08, "I've sent the
  // press for preset 7 on the Master Bedroom" was said of a start).
  preset: (h) => (h.pressing ? `I've sent the press for preset ${h.preset} ${onWords(h.device)}`
    : `Starting preset ${h.preset} ${onWords(h.device)}`) + "; it may take a moment. The app shows when it plays.",
  endless: (h) => `Starting ${nameOf(h.dj)} endless ${onWords(h.device ?? h.reading?.device)}; the app shows when it plays.`,
  fresh: (h) => `Asking ${nameOf(h.dj)} for a fresh set; the app shows when it plays.`,
  steer: () => "Asking the DJ; the app shows the new songs when they come.",
  keep: () => "Asking the DJ to keep it; the Shelf shows it when the page is written.",
};

// The act for what the dry run read: { say, did } or null when this kind of
// request does nothing more than the dry run says (launch, help, which DJ?,
// a refusal of the words).
export async function alexaAct(env, ctx, heard) {
  const kinds = ["ask-dj", "put-on", "preset", "now", "pause", "again", "skip", "move", "endless", "fresh", "steer", "back", "keep"];
  if (!kinds.includes(heard.kind)) return null;
  // Spotify limiting the account (its daily quota): nothing that needs it is
  // tried. An ask still files (the curator makes it later); a preset by
  // number has the same rule inside presetAct, which Talk shares.
  // A press by the helper costs no Spotify call (stage 4): a house DJ on a
  // WiiM goes on, and its Spotify fallback says the limit.
  let limited = false;
  if (heard.kind !== "ask-dj" && heard.kind !== "preset" && await throttledUntil(env)) {
    const dev = heard.device ?? heard.reading?.device ?? null;
    const pressable = heard.kind === "put-on" && wiimOf(env, dev) && await helperHands(env);
    if (!pressable) return { say: SPOTIFY_LIMITED, did: { throttled: true } };
    limited = true;
  }
  const device = heard.device ?? heard.reading?.device ?? null;
  const room = heard.room?.room ?? (heard.reading?.deviceFrom === "words" ? heard.reading.device : null);
  // Whether a preset is pressed or started, read beside the work so a late
  // answer can say which without waiting.
  const pressingP = heard.kind === "preset" && wiimOf(env, device) ? helperHands(env).catch(() => false) : Promise.resolve(false);
  const work = (async () => {
    if (heard.kind === "ask-dj") return ask(env, ctx, heard.dj, heard.reading);
    if (heard.kind === "put-on") return putOn(env, heard.dj, device, { when: heard.when ?? heard.reading?.when ?? null, limited });
    if (heard.kind === "endless") {
      return putOn(env, heard.dj, device, { words: endlessWords(heard.reading), when: heard.reading?.when ?? null });
    }
    if (heard.kind === "fresh") return fresh(env, heard.dj, device);
    // Steering and back are said inside an open session (Alexa keeps them
    // otherwise): the line stays open for the next one (the owner, 2026-11-07).
    if (heard.kind === "steer") return { ...(await steer(env, heard.steer)), end: false };
    if (heard.kind === "keep") return keepPlaying(env, ctx);
    if (heard.kind === "preset") return presetAct(env, heard.preset, device);
    if (heard.kind === "now") return nowSays(env, heard.room?.room ?? null);
    if (heard.kind === "back") return { ...(await player(env, ctx, "back", room)), end: false };
    return player(env, ctx, heard.kind, room);
  })();
  const out = await inTime(ctx, work, `${heard.intent ?? heard.kind}`);
  if (out) return out;
  const begun = BEGUN[heard.kind];
  const pressing = await pressingP;
  return { say: begun ? begun({ ...heard, device, pressing }) : "I'm on it; the app shows when it's done.", did: { late: true } };
}
