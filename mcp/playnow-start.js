// PLAY NOW STARTS IT (MC-47 stage 3, tasks/mc47-build.md). What playnow.js
// read ("the Beatles, an artist, Deep Dive on the guest DJ's preset, these
// five songs") is started here, for any door (Alexa first; Talk, the apps and
// the TV in stage 4):
// - on the guest DJ's preset: the songs found are written to its playlist and
//   started at once, whoever was on it (the owner, 2026-11-18: "yes at
//   once"), and the DJ is asked to follow straight after the playing song
//   (playEndless's bridge, endless.js);
// - a genre or an era the search found no songs for: the DJ makes an opening,
//   today's way, about four minutes;
// - a house DJ's own preset: it starts as it is and the words steer it;
// - an album: the album itself, in order, on no preset.
// Each answers { say, did }: the one sentence, and what was done for the log.
// Only called with the house's `playNow` "on" (playNowMode); nothing here
// reads the switch.

import { onWords } from "./asks.js";
import { ROSTER } from "./djs.js";
import { endlessPageSteer, parseEndless, playEndless, sleptThrough, NO_CURATOR } from "./endless.js";
import { startAlbumOnDevice } from "./playback.js";
import { parseSpeakers } from "./room.js";
import { playNow, playNowPlaces, sayFor, spoken } from "./playnow.js";
import { catalogFor } from "./services.js";
import { NOT_PRESSED, wiimPress } from "./alexa-act.js";

// The kinds that play; the rest are said (unsure asks, none, a mood…).
const PLAYS = ["artist", "song", "album", "genre", "era"];
export const playNowPlays = (x) => !!x && PLAYS.includes(x.kind);

const djName = (key) => ROSTER[key]?.name ?? key;
const owns = (name) => (/s$/.test(name) ? `${name}'` : `${name}'s`);
const what = (x) => (x.kind === "song" ? `${spoken(x.title)} by ${x.by}` : x.kind === "artist" ? x.title
  : x.kind === "album" ? `${spoken(x.album.name)} by ${x.album.artist}` : x.words);

// What the guest DJ is told: the artist first (the DJ's research and the
// nearby artists are kept under the words up to the first ";"), then what
// else was said. A genre or an era as said.
export function laneWords(x) {
  if (x.kind === "artist") return x.withWords && x.words ? `${x.title}; ${x.words}` : x.title;
  if (x.kind === "song") return `${x.by}; starting from the song ${spoken(x.title)}`;
  return x.words;
}

// A start that did not simply work, said. `on`: the preset it sits on now.
function notStarted(code, x, on = null) {
  const there = on ? ` It is on preset ${on}: press it there.` : "";
  if (code === "asleep") return `The ${x.device} didn't answer; it may be asleep.${there}`;
  if (code === "press-sent") return `I've sent the press for ${on ?? "the guest preset"} ${onWords(x.device)}; it may still happen.${on ? ` If nothing plays, press ${on}.` : ""}`;
  if (code === "stuck") return `Spotify took the start ${onWords(x.device)}, but ${what(x)} isn't playing there.${there}`;
  return `I couldn't start ${what(x)} ${onWords(x.device)}.${there}`;
}
const unconfirmed = (code) => (code === "sent" ? " Spotify took it but hasn't confirmed it yet." : "");

// `press(button)`: the door's press of a key on the speaker (alexa-act.js
// wiimPress through the home helper), tried before any Spotify start: its
// code, or null when nothing reached the WiiM. Without it, Spotify starts.
const STARTED = ["ok", "sent", "pressed"];
// The press for a speaker, for any door: a WiiM of the house's, its key
// through the home helper (alexa-act.js wiimPress); null for anything else.
// It answers null too when nothing reached the WiiM (the helper off).
export function pressFor(env, device) {
  return parseSpeakers(env).some((b) => b.name === device) ? async (n) => {
    const code = (await wiimPress(env, device, n)).code;
    return NOT_PRESSED.includes(code) ? null : code;
  } : null;
}
export async function startPlayNow(env, x, { budget = { remaining: 40 }, press = null } = {}) {
  if (!playNowPlays(x)) return { say: x.say, did: { play: x.kind } };
  if (!x.device) return { say: "This house has no default speaker, so say which one: for example, on the Ultra.", did: { play: x.kind, put: "no-speaker" } };

  // AN ALBUM, as itself.
  if (x.kind === "album") {
    let code;
    try { code = await startAlbumOnDevice(env, x.album, x.device, budget); }
    catch (e) { code = sleptThrough(e) ? "asleep" : "failed"; }
    const did = { play: "album", album: x.album.uri, start: code };
    if (code === "ok" || code === "sent") return { say: `${sayFor(x)}${unconfirmed(code)}`, did };
    return { say: notStarted(code, x), did };
  }

  if (!x.place) return { say: sayFor(x), did: { play: x.kind, put: "no-place" } };
  const who = djName(x.dj);

  // A HOUSE DJ'S OWN PRESET: started as it is, steered by the words.
  if (x.place.own) {
    let r = null, code = null;
    if (press) { try { code = await press(x.place.button); } catch { code = "failed"; } }
    if (code === "ok") r = { status: "own-preset", button: x.place.button, start: "pressed" };
    else if (code) {
      return { say: `I've sent the press for ${x.place.button} ${onWords(x.device)}; it may still happen. Once ${who} plays, say "steer toward ${x.words}".`,
        did: { play: x.kind, put: "pressed", press: code, button: x.place.button } };
    } else {
      try { r = await playEndless(env, { dj: x.dj, device: x.device, budget }); }
      catch (e) { return { say: `I couldn't start ${who}.`, did: { play: x.kind, put: "failed", why: String(e?.message ?? e).slice(0, 80) } }; }
    }
    const did = { play: x.kind, put: r.status, ...(r.start ? { start: r.start } : {}), ...(r.button ? { button: r.button } : {}) };
    if (r.status !== "own-preset") return { say: `I couldn't start ${who} ${onWords(x.device)}.`, did };
    if (!STARTED.includes(r.start)) return { say: notStarted(r.start, { ...x, kind: "artist", title: who }, r.button), did };
    const s = await endlessPageSteer(env, { button: r.button, words: x.words, by: "by play now" }).catch(() => ({ status: "failed" }));
    const head = `Starting ${who} ${onWords(x.device)}, on preset ${r.button}, ${owns(who)} own`;
    if (s.status === "asked") return { say: `${head}; the songs turn to ${x.words} after this one.${unconfirmed(r.start)}`, did: { ...did, steer: "asked" } };
    return { say: `${head}. ${s.status === "day-cap" ? `No more DJ runs today, so it can't be steered toward ${x.words}.`
      : `Steering toward ${x.words} didn't reach ${who}: say "steer toward ${x.words}" to try again.`}`, did: { ...did, steer: s.status } };
  }

  // THE GUEST DJ'S PRESET: the songs found as the bridge, or an opening made.
  const words = laneWords(x);
  const uris = x.songs.map((s) => s.uri);
  let r;
  try {
    r = await playEndless(env, { dj: x.dj, device: x.device, budget, when: "now", words, ...(press ? { press } : {}),
      ...(uris.length ? { opening: { uris, title: x.title } } : {}) });
  } catch (e) {
    return { say: `I couldn't start ${what(x)}.`, did: { play: x.kind, put: "failed", why: String(e?.message ?? e).slice(0, 80) } };
  }
  const did = { play: x.kind, dj: x.dj, put: r.status, ...(r.start ? { start: r.start } : {}), ...(r.button ? { button: r.button } : {}),
    ...(r.bridge ? { bridge: r.bridge } : {}), ...(r.follows ? { follows: r.follows } : {}) };
  const where = ` ${onWords(x.device)}`;
  switch (r.status) {
    case "started": {
      if (!STARTED.includes(r.start)) return { say: notStarted(r.start, x, r.button), did };
      if (!r.bridge || r.follows === "asked") return { say: `${sayFor(x)}${unconfirmed(r.start)}`, did };
      const first = x.kind === "song" || !x.songs[0] ? "" : `, ${spoken(x.songs[0].name)} first`;
      const after = r.follows === "day-cap" ? `No more DJ runs today, so ${who} can't follow: these ${r.bridge} songs play, on preset ${r.button}.`
        : `${who} couldn't be asked to follow just now; these ${r.bridge} songs play, on preset ${r.button}.`;
      return { say: `Starting ${what(x)}${where}${first}. ${after}`, did };
    }
    case "making": return { say: sayFor({ ...x, songs: [] }), did };
    case "already": return { say: `${who} is already playing ${x.words}, on preset ${r.button}.`, did };
    case "carry-on": return (r.start === "ok" || r.start === "sent")
      ? { say: `${who} carries on with ${x.words}${where}, on preset ${r.button}.${unconfirmed(r.start)}`, did }
      : { say: notStarted(r.start, x, r.button), did };
    case "day-cap": return { say: `The guest preset has made all its sets for today, so ${who} can't make one for ${x.words}. Try again tomorrow.`, did };
    case "moved": return { say: "Something changed on the guest preset while I asked. Ask again.", did };
    case "off": return { say: "Endless DJs are off in this house, so I couldn't start it.", did };
    case "no-curator": return { say: `${NO_CURATOR}, so ${who} has no preset to play on.`, did };
    default: return { say: `I couldn't start ${what(x)}${where}.`, did };
  }
}

// A DJ NAMED WITH WORDS, NO LENGTH (MC-47 stage 5, the owner, 2026-11-18:
// "play" means now, a length or "a set" makes a set, the name says who):
// "Hank, some 70s soul" starts Hank's own preset at once and steers it
// toward the words; a guest DJ takes preset 3 at once, Deep Dive with the
// artist's songs found first and Genre with the genre's (a search, as play
// now's), any other guest with an opening made (their words are a mood or a
// label, which a search cannot read). `catalog` for a test.
export async function startDjWithWords(env, { dj, words, device, budget = { remaining: 40 }, press = null, catalog = null }) {
  const places = playNowPlaces(parseEndless(env));
  const who = ROSTER[dj];
  if (!places || !who) return { say: `Endless DJs are off in this house, so I couldn't start ${djName(dj)}.`, did: { play: "dj", put: "off" } };
  const own = places.own?.[dj] ?? null;
  const base = { dj, words, title: words, by: null, songs: [], album: null, device, deviceFrom: "words" };
  if (own) return startPlayNow(env, { ...base, kind: "genre", place: { button: own, own: true } }, { budget, press });
  if (!places.lane) return { say: `${who.name} has no preset to play on in this house.`, did: { play: "dj", put: "off" } };
  let x = { ...base, kind: "genre", place: { button: places.lane, own: false } };
  const needs = who.needsWords;
  if (needs === "an artist" || needs === "a genre") {
    let found = null;
    try {
      found = await playNow(words, { catalog: catalog ?? catalogFor(env, "spotify"), rooms: [], fallback: device, places });
    } catch { found = null; }
    const fits = found && (needs === "an artist" ? ["artist", "song"].includes(found.kind) : ["genre", "era"].includes(found.kind));
    if (fits && found.songs.length >= 3) {
      x = { ...x, kind: found.kind === "song" || found.kind === "artist" ? found.kind : "genre", title: found.title, by: found.by,
        withWords: found.withWords, songs: found.songs };
    }
  }
  return startPlayNow(env, x, { budget, press });
}
