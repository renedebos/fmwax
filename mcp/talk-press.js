// TALK PRESSES THE BUTTONS (MC-39, tasks/mc39-talk-presses.md). Two things
// maple crate does that Talk could not: a WiiM's preset pressed as its remote
// presses it ("press 12 on the Pro Plus", "put on Radio Paradise"), and a
// house DJ put on by name pressed on their own key ("put on Hank"), so the
// preset's saved settings come along and Tidal, Pandora and the radio start too. The work
// is maple crate's own (alexa-act.js), so both say the same words; this file
// is only Talk's half: the bounded arguments, the answer the backend speaks,
// and which speaker the page should follow afterwards.
//
// Called from Talk's tool door after the capability, the allow-list and the
// speaker rule (routes.js), so `device` is already one of the house's own.
// Arguments are forgeable (voice.js): nothing here trusts one beyond its
// bounds, and a WiiM is only ever reached through the helper's own list.

import { helperTransport, keyNamed, pressOwnKey, presetAct, wiimReadings } from "./alexa-act.js";
import { findDj } from "./house.js";
import { onStream } from "./now.js";
import { parseSpeakers } from "./room.js";
import { moveOn } from "./transport.js";

export const PRESS_NAME_MAX = 80;

// Refused before anything is read: a whole number 1 to 12, or a name, and
// nothing else. A sentence the backend can say.
//
// THE BACKEND FILLS EVERY FIELD (the owner's room test, 2026-11-08 23:14:
// six presses refused as "not both"; the logs show it sends every field of a
// schema, "" or 0 for the ones it means to leave out, as with play_endless's
// `"words":"","when":"now"`). So an empty name, or a number of 0, is no
// answer at all; and a real number beside a real name is the number, which
// is unambiguous where a name may not be.
const PRESS_KEYS = new Set(["n", "name", "device"]);
const blank = (v) => v === undefined || v === null || v === "" || v === 0;
export function pressArgs(args) {
  const extra = Object.keys(args ?? {}).filter((k) => !PRESS_KEYS.has(k));
  if (extra.length) throw new Error(`press_preset takes n or name, and device; not ${extra.slice(0, 3).join(", ").slice(0, 60)}.`);
  const hasN = !blank(args?.n);
  const name = typeof args?.name === "string" ? args.name.trim() : args?.name;
  const hasName = !blank(name);
  if (!hasN && !hasName) throw new Error("Say which preset: a number from 1 to 12, or the name saved on it.");
  if (hasN) {
    if (!Number.isInteger(args.n) || args.n < 1 || args.n > 12) {
      throw new Error("A preset is a whole number from 1 to 12, as on the remote.");
    }
    return { n: args.n };
  }
  if (typeof name !== "string" || name.length > PRESS_NAME_MAX) {
    throw new Error(`A preset's name is the words saved on it, at most ${PRESS_NAME_MAX} characters.`);
  }
  return { name };
}

// The speaker the page follows after a press (a start by voice is a choice,
// routes.js): only a press the helper confirmed, or a Spotify start that
// said ok or sent. Never "sent, it may still happen", a timeout, or "press
// it on the remote" (Codex's review).
export function pressStarted(did, device) {
  if (!did) return null;
  if (did.press) return did.code === "ok" ? did.on ?? device : null;
  return did.start === "ok" || did.start === "sent" ? device : null;
}

// press_preset: { out, stamp }. `out` is what the backend reads: `said`, the
// line to say as it is, and `did`, maple crate's record of what was done.
export async function talkPressPreset(env, args) {
  const want = pressArgs(args);
  const device = String(args.device);
  let n = want.n ?? null;
  if (n === null) {
    const k = await keyNamed(env, device, want.name);
    if (k.n === null) {
      const said = k.many
        ? `More than one preset is saved as "${want.name}".`
        : `No preset on the ${device} is saved as "${want.name}".`;
      return { out: { said, pressed: false, keys: k.keys }, stamp: null };
    }
    n = k.n;
  }
  const r = await presetAct(env, n, device);
  return { out: { said: r.say, preset: n, did: r.did }, stamp: pressStarted(r.did, device) };
}

// play_endless, first: a house DJ by name, with no words, on a WiiM, is
// pressed on their own key when the WiiM's table still names them there.
// Null otherwise, and the door plays them as before. `when` is not read: the
// backend fills it on every call (the room test, 2026-11-08: "when":"next"
// for a plain "put on Hank"), and it only means anything for the guest
// preset, which is never pressed; a house DJ's own preset starts at once
// either way (playEndless, endless.js).
export async function talkOwnKey(env, args, device) {
  const words = typeof args?.words === "string" ? args.words.trim() : "";
  if (words || !device) return null;
  const key = findDj(env, String(args?.dj ?? ""))?.key ?? null;
  if (!key) return null;
  const r = await pressOwnKey(env, key, device);
  if (!r) return null;
  return { out: { said: r.say, did: r.did }, stamp: pressStarted(r.did, device) };
}

// MOVE THE MUSIC (MC-39 deploy 2): Spotify Connect's own transfer, as the
// bar's move and maple crate's: the same song, the same place, the speaker
// named. Only Spotify moves (the owner, 2026-09-26); the radio's move stays
// on the bar. The page follows only a move that was made.
const MOVE_SAID = {
  ok: (to) => `Moved ${to}.`,
  quiet: () => "Nothing is playing on Spotify to move.",
  here: (to, room) => `It's already playing on the ${room}.`,
  asleep: (to, room) => `The ${room} didn't answer; it may be asleep.`,
};
export async function talkMove(env, device) {
  const { code } = await moveOn(env, { name: device });
  const to = /^everywhere$/i.test(device) ? "everywhere" : `to the ${device}`;
  const said = (MOVE_SAID[code] ?? (() => `I couldn't move the music ${to}.`))(to, device);
  return { out: { said, code }, stamp: code === "ok" ? device : null };
}

// THE WIIMS AS THE HELPER HEARS THEM (MC-39 deploy 2), for now_playing: each
// one's state, the EQ it plays through (EQGetBand, read by the helper), and
// what it plays when that isn't Spotify (Tidal, the radio, Pandora; never an
// input, which can read "play" while silent). Spotify's own answer is the
// rest of now_playing's. Nothing with the helper off.
export async function talkWiims(env) {
  const heard = await wiimReadings(env);
  return parseSpeakers(env).map((b) => [b.name, heard[b.name]]).filter(([, r]) => r && r.state !== "unreachable")
    .map(([speaker, r]) => ({ speaker, state: r.state, ...(r.eq ? { eq: r.eq } : {}),
      ...(onStream(r) ? { source: r.source, ...(r.station ? { station: r.station } : {}),
        ...(r.track ? { track: r.track } : {}), ...(r.artists ? { artists: r.artists } : {}) } : {}) }));
}

// PAUSE AND RESUME ON TIDAL OR THE RADIO (MC-39 deploy 2): the speaker named
// (the backend fills it, [the room test]), when the helper hears that WiiM on
// a stream that isn't Spotify, playing for a pause or paused for a resume,
// is paused or resumed by the helper, as maple crate's hush and carry on.
// Null otherwise, and the door goes on to Spotify as before. Spotify itself is
// never resumed this way.
export async function talkTransport(env, args, device) {
  const kind = args?.action === "pause" ? "pause" : args?.action === "resume" ? "again" : null;
  if (!kind || !device) return null;
  const r = (await wiimReadings(env))[device];
  if (!r || !onStream(r) || r.state !== (kind === "pause" ? "play" : "pause")) return null;
  const h = await helperTransport(env, device, kind);
  if (!h) return null;
  return { out: { said: h.say, did: h.did }, stamp: kind === "again" && h.did?.again === "helper" ? device : null };
}
