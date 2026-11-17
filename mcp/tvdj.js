// THE DJS ON THE TV (MC-46, the owner, 2026-11-16: "how would we be able to
// use the DJs currently not on a preset ... select for example genre and be
// able to give it instructions ... the settings for writing an ask"; the
// canvas "fmwax on the TV, the DJs", then "build it"). Decided by the owner:
// a DJ's settings are REMEMBERED PER DJ ON THIS TV; the idea buttons are the
// DJ's own examples and the last asks to that DJ; Start fresh, More like this
// and Change it up wherever they work.
//
// Three kinds of DJ, by what the house already does with them:
//   house   a DJ with an endless preset of their own (Hank on 5): Play the
//           preset, Start fresh, a turn in your words while they play;
//   guest   an endless DJ with no preset of their own (Genre, Pub Rock, Deep
//           Dive): they go on the guest preset with your words;
//   writer  a DJ who writes (the Librarian, Gatefold): a set asked for, with
//           its length, notes, kept on the Shelf or not, played when ready
//           or not.
// What each button and each sentence DOES is the Echo door's (alexa-act.js)
// and the voice ask's (asks.js askByVoice): nothing here decides it again.
import { DJ_ASKS, WHICH } from "./djs.js";
import { findDj, house } from "./house.js";
import { endlessLoad, endlessSlots, nextPressWords, endlessLogRows, parseEndless } from "./endless.js";
import { writerKindFor } from "./toollist.js";
import { alexaAct } from "./alexa-act.js";
import { readWords, endlessWords } from "./alexa-read.js";
import { askByVoice } from "./asks.js";
import { helperView } from "./now.js";
import { houseCatalogNames } from "./services.js";
import { ASK_LENGTHS } from "./asks.js";

// The DJ whose screen the TV shows: a cookie the DJ's screen sets and the
// TV's other screens clear, so what is said to TV Bro's voice search goes to
// that DJ without their name.
export const TV_DJ_COOKIE = "tvdj";
export const tvDjCookie = (key) => `${TV_DJ_COOKIE}=${key}; Path=/; Max-Age=1800; SameSite=Lax; Secure`;
export const tvDjClear = `${TV_DJ_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
export function cookieOf(request, name) {
  const all = String(request?.headers?.get("cookie") ?? "");
  for (const part of all.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) { try { return decodeURIComponent(part.slice(i + 1)); } catch { return null; } }
  }
  return null;
}

// A DJ's settings on this TV: "60.long.1.1.next.spotify" in the cookie
// `tvs-<key>` (length, notes, keep, play when ready, a busy guest preset
// taken after the song or now, a writer's set on Spotify or Tidal). Anything
// unreadable is the default.
export const tvSetName = (key) => `tvs-${key}`;
export function tvDjSettings(request, key, env = {}) {
  const raw = String(cookieOf(request, tvSetName(key)) ?? "").split(".");
  const len = Number(raw[0]);
  return {
    len: ASK_LENGTHS.includes(len) ? len : 60,
    notes: raw[1] === "long" || raw[1] === "short" ? raw[1] : env.REQUEST_NOTES === "long" ? "long" : "short",
    keep: raw[2] === "1",
    start: raw[3] !== "0",
    when: raw[4] === "now" ? "now" : "next",
    svc: raw[5] === "tidal" ? "tidal" : "spotify",
  };
}

// Which kind of DJ, and the house DJs' presets.
export function tvDjKind(env, key, state = null) {
  const dj = findDj(env, key);
  if (!dj || dj.archiveOnly) return null;
  if (writerKindFor(env, dj)) return "writer";
  const cfg = parseEndless(env);
  const slot = cfg?.mode === "live" ? endlessSlots(env, cfg, state ?? {}).find((s) => s.dj === dj.key) : null;
  if (slot) return "house";
  return dj.endless === false ? "writer" : "guest";
}

// IS THE SESSION STILL PLAYING? An endless session ends at the watch's next
// look, up to ten minutes after the music stopped (the owner, 2026-11-16:
// preset 2 pressed, and the DJs page still said 9 was playing). Where the
// session's speaker is a WiiM the home helper reads, its reading decides:
// Spotify on that DJ's own playlist, playing. Anywhere else, the session's
// word stands.
async function readSpeakers(env) {
  try { return (await helperView(env))?.lan?.speakers ?? null; } catch { return null; }
}
function stillPlaying(session, playlist, speakers) {
  if (!session) return false;
  const r = session.device && speakers ? speakers[session.device] ?? null : null;
  if (!r) return true;
  return r.state === "play" && /^spotify/i.test(String(r.source ?? "")) && (!r.playlist || !playlist || r.playlist === playlist);
}
const presetPlaylist = (cfg, btn) => (cfg?.presets ?? []).find((p) => p.button === btn)?.playlist ?? null;

// Every DJ the TV lists, in three groups, with what each is doing now.
export async function tvDjList(env) {
  const cfg = parseEndless(env);
  let state = null;
  try { state = cfg?.mode === "live" && env.STATION ? await endlessLoad(env) : null; } catch { state = null; }
  const slots = cfg?.mode === "live" ? endlessSlots(env, cfg, state ?? {}) : [];
  const lane = state?.lane?.dj ? state.lane : null;
  const laneBtn = cfg?.presets?.find((p) => p.lane)?.button ?? null;
  const speakers = await readSpeakers(env);
  const live = (btn) => stillPlaying(state?.sessions?.[String(btn)] ?? null, presetPlaylist(cfg, btn), speakers);
  const out = { house: [], guests: [], writers: [], laneBtn };
  for (const dj of house(env).roster) {
    const slot = slots.find((s) => s.dj === dj.key);
    const base = { key: dj.key, name: dj.name, colour: dj.colour ?? null };
    if (writerKindFor(env, dj)) {
      out.writers.push({ ...base, what: dj.key === "gatefold" ? "An album side" : "A set with notes" });
    } else if (slot) {
      out.house.push({ ...base, btn: slot.button, playing: live(slot.button),
        what: `Preset ${slot.button}` });
    } else if (dj.endless !== false) {
      const onLane = lane && findDj(env, lane.dj)?.key === dj.key;
      out.guests.push({ ...base, playing: !!(onLane && laneBtn && live(laneBtn)),
        // Only the guest holding the guest preset names it ("Now on 3"); the
        // others say what they play (the owner, 2026-11-16: "Endless on 3"
        // under Pub Rock read as Pub Rock being on 3 beside Deep Dive).
        what: onLane && lane.words ? `Now on ${laneBtn ?? 3}: ${String(lane.words).slice(0, 60)}` : onLane ? `Now on ${laneBtn ?? 3}`
          : dj.needsWords ? `Needs ${dj.needsWords}` : shortField(dj.key) || "Endless" });
    }
  }
  out.house.sort((a, b) => a.btn - b.btn);
  return out;
}

// What a guest DJ plays, in a few words: their field up to its first "and",
// comma or dash ("London pub rock and what its people made later" →
// "London pub rock").
const shortField = (key) => String(WHICH[key]?.field ?? "").split(/\s+and\s+|,|—|:/)[0].trim().slice(0, 40);

// The words of a DJ's own example asks, without the name they start with
// ("Hank, an hour of Daptone and its neighbours." -> "an hour of Daptone and
// its neighbours"), and without "endless" or "publish it", which the screen
// and its Keep setting say themselves.
export function djIdeas(key, n = 3) {
  return (DJ_ASKS[key]?.asks ?? []).slice(0, n).map((a) => String(a)
    .replace(/^[^,—]{1,24},\s*/, "").replace(/,?\s*endless\.?$/i, "").replace(/\.$/, "").replace(/\s*[—–-]\s*publish it$/i, "").trim())
    .filter(Boolean);
}

// THE LAST ASKS ARE GONE from the DJ screens (the owner, 2026-11-16: "remove
// the 'last asks' sections ... to free up room"), and with them the words
// the TV kept for them (`tvwords:<dj>`, which now lapse).

// THE SERVICES A WRITER'S SET MAY GO TO (the owner, 2026-11-16: "dj sets
// can not be created with a tidal check box"): each requests preset, by its
// service and key, when the house has more than one.
function setServices(env) {
  const g = house(env).guest ?? {};
  const list = ["spotify", "tidal"].filter((k) => g[k]?.btn).map((k) => ({ key: k, btn: g[k].btn }));
  return list.length > 1 && houseCatalogNames(env).includes("tidal") ? list : null;
}

// What one DJ's screen shows.
export async function tvDjFacts(env, key) {
  const dj = findDj(env, key);
  if (!dj || dj.archiveOnly) return null;
  const cfg = parseEndless(env);
  let state = null;
  try { state = cfg?.mode === "live" && env.STATION ? await endlessLoad(env) : null; } catch { state = null; }
  const kind = tvDjKind(env, dj.key, state);
  const slot = kind === "house" ? endlessSlots(env, cfg, state ?? {}).find((s) => s.dj === dj.key) : null;
  const laneBtn = cfg?.presets?.find((p) => p.lane)?.button ?? null;
  const lane = state?.lane?.dj && findDj(env, state.lane.dj)?.key === dj.key ? state.lane : null;
  const session = slot ? state?.sessions?.[String(slot.button)] ?? null : lane && laneBtn ? state?.sessions?.[String(laneBtn)] ?? null : null;
  const playing = session ? stillPlaying(session, presetPlaylist(cfg, slot ? slot.button : laneBtn), await readSpeakers(env)) : false;
  // Where it plays: the session's own speaker, which need not be the TV's room.
  const playingOn = session?.device && session.device !== "the speaker" ? String(session.device) : null;
  let carries = null;
  if (slot) { try { carries = nextPressWords(state ?? {}, slot.button, await endlessLogRows(env)); } catch { carries = null; } }
  const runsLeft = cfg ? Math.max(0, cfg.dailyRuns - (Number(state?.runs) || 0)) : 0;
  const near = lane?.nearby?.list?.length ? { label: lane.nearby.label === "Similar artists" ? "Artists like it" : `Next to ${lane.nearby.words ?? lane.words}`,
    list: lane.nearby.list.slice(0, 4) } : null;
  return { key: dj.key, name: dj.name, colour: dj.colour ?? null, summary: dj.summary ?? "", needs: dj.needsWords ?? null,
    kind, btn: slot?.button ?? null, laneBtn, onLane: !!lane, laneWords: lane?.words ?? null, playing, playingOn, carries, runsLeft,
    ideas: djIdeas(dj.key), near, services: kind === "writer" ? setServices(env) : null };
}

// WHAT A BUTTON OR A SENTENCE ON A DJ'S SCREEN DOES. `act`: play, fresh,
// more, change, or words (with `words`). `room` the TV's room; `set` the DJ's
// settings on this TV. Answers { said, heard }.
const SURPRISE = "surprise me: a subject of your own choice";
export async function tvDjAct(env, ctx, { key, act, words = "", set, room, rooms = [] }) {
  const dj = findDj(env, key);
  if (!dj || dj.archiveOnly) return { said: "That DJ isn't in this house.", heard: "" };
  let state = null;
  try { state = parseEndless(env)?.mode === "live" && env.STATION ? await endlessLoad(env) : null; } catch { state = null; }
  const kind = tvDjKind(env, dj.key, state);
  const envTv = room ? { ...env, DEFAULT_DEVICE: room } : env;
  const run = async (heard) => {
    let acted = null;
    try { acted = await alexaAct(envTv, ctx, heard); } catch { acted = null; }
    return acted?.say ?? "Something went wrong on the house's side; nothing more was done.";
  };
  if (act === "play") return { heard: `Play ${dj.name}`, said: await run({ kind: "put-on", dj: dj.key, device: room }) };
  if (act === "fresh") return { heard: `Start ${dj.name} fresh`, said: await run({ kind: "fresh", dj: dj.key, device: room }) };
  if (act === "more" || act === "change") {
    return { heard: act === "more" ? "More like this" : "Change it up",
      said: await run({ kind: "steer", steer: { kind: act, said: act === "more" ? "more like this" : "change it up", dj: dj.key } }) };
  }
  let w = String(words ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (act === "surprise") w = SURPRISE;
  if (!w) return { heard: dj.name, said: `Say what you'd like from ${dj.name}, or press one of the ideas.` };
  if (kind === "writer") {
    let res;
    try {
      res = await askByVoice(env, ctx, { dj: dj.name, words: w, minutes: set.len, keep: set.keep, notes: set.notes,
        device: set.start ? room : null, via: "tv", ...(setServices(env) ? { service: set.svc } : {}) });
    } catch (e) { return { heard: w, said: String(e?.message ?? e).slice(0, 300) }; }
    return { heard: w, said: String(res.said ?? "").replace(/\s*You can hang up\.$/, "") };
  }
  // A house DJ who is playing is turned; otherwise their preset starts, and
  // the words steer it. A guest DJ goes on the guest preset with the words.
  const sessionOn = kind === "house"
    ? !!state?.sessions?.[String(endlessSlots(env, parseEndless(env), state ?? {}).find((s) => s.dj === dj.key)?.button)] : false;
  if (sessionOn) return { heard: w, said: await run({ kind: "steer", steer: { kind: "words", words: w, said: w } }) };
  const reading = { ...readWords(w, { rooms, fallback: room }), endless: true, ...(kind === "guest" ? { when: set.when } : {}) };
  // A room said with the words wins over the TV's.
  return { heard: w, said: await run({ kind: "endless", dj: dj.key, reading, device: reading.deviceFrom === "words" ? reading.device : room }) };
}
export { endlessWords };
