// THE TV PAGE (MC-46 stage 2, tasks/mc46-tv-page.md): the house on a big
// screen, worked with a TV's remote. One screen, no scrolling, nothing typed:
// the rooms across the top, the picked room's presets in a grid, and what is
// playing along the bottom with Pause, Play and Skip. The owner chose this
// layout (A) on the canvas "fmwax on the TV", 2026-11-15.
//
// MEASURED ON THE SONY BRAVIA IN TV BRO (stage 0, the same night): a page is
// 960 × 540 page pixels there, drawn at 2×; the remote either moves a cursor
// (mouse moves and clicks) or sends the arrow keys and OK, which move focus
// between buttons by themselves; a text box traps the remote; the page gets
// no microphone that hears. So every control here is a real button or link,
// large enough for the cursor, with a ring that says where the remote is;
// there is no text box and no Talk.
//
// THE NEXT SCREENS (2026-11-15, the owner's choices on the canvas "fmwax on
// the TV, the next screens": the corner blank, the display with the cover
// leading, the button in hand filled amber as on WiiM's own TV app, "do all
// of them in your order"). The display: the cover large, the song, what
// comes next, with back, Pause and Skip kept on it; it opens from Now Playing,
// from the small cover, and by itself when music plays and the remote rests.
// Move: Spotify's music to another room. About this song: the DJ's own words,
// for a song from a Shelf page. The Shelf and a DJ's dials are pages of their
// own (tvpages.js).
//
// THE PAGE THINKS ON THE SERVER. What the band says of the picked room is
// worked out here (tvBand), for the first paint and for every look after
// (GET …/tv/now), so the page's script only puts words where they go. A tile
// is a form: a press is the Speakers page's press (the home helper's key
// press on a WiiM, else Spotify's start), and it comes back to this page.
import { barWords, esc, helperKeyWords, litKey, qualityFor, qualityWords, spotifyRest, steerOf } from "./programs.js";
import { aboutStop } from "./about.js";
import { dialsOf } from "./tuning.js";

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export const tvSlug = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "speaker";
// THE FMWAX TV APP says itself in its user agent ("fmwaxTV/1.6"). Talk on the
// TV is the app's alone (2026-11-19, before the app's download): a TV's
// browser gives a page no microphone, and the Talk screen opens its line as
// it opens, so in a browser it would spend minutes it can never use. A way
// to choose a page, never a lock: anyone with the house's key has the house.
export const inTvApp = (ua) => /(^|\s)fmwaxTV\/[0-9]/.test(String(ua ?? ""));

// ONE ROOM'S SHARE OF THE ANSWER: the now bar's rule (its script's `view`),
// for the room this screen shows instead of the phone's pick. Spotify playing
// here; else what the home helper read from the speaker (Tidal, the radio);
// else the bar's own pause; else Spotify stopped here as the speaker says it;
// else quiet, with Spotify elsewhere said.
export function tvNarrow(o, who, other = false) {
  const blocked = !!(o && o.state === "throttled" && o.lan && o.lan.speakers);
  if (!o || !who || (o.state !== "playing" && o.state !== "quiet" && !blocked)) return o;
  if (o.state === "playing" && norm(o.device) === norm(who)) return o;
  const raw = o.lan && o.lan.speakers ? o.lan.speakers[who] ?? null : null;
  let ln = null;
  if (raw && (raw.state === "play" || raw.state === "pause") && !/^spotify/i.test(raw.source || "")) {
    const b = o.lanBand;
    ln = { state: "lan", speaker: who, source: raw.source || "", station: raw.station || "", lanState: raw.state,
      track: raw.track || "", artists: raw.artists || "", hands: !!o.lan.hands,
      album: raw.album || "", art: raw.art || "", trackId: raw.trackId || "",
      // Its place, as of the reading (the helper sends a place only with a change, or each minute).
      pos: raw.pos && Number(raw.pos.of) > 0 ? { ms: Number(raw.pos.ms) || 0, of: Number(raw.pos.of), at: Number(o.lan.at) || 0 } : null,
      lanFrom: b && norm(b.speaker) === norm(who) ? `preset ${b.btn}${b.name ? `, ${b.name}` : ""}` : "" };
  }
  if (ln && ln.lanState === "play") return ln;
  if (o.state === "quiet" && o.paused && norm(o.paused.device) === norm(who)) return o;
  if (ln) return ln;
  const known = !!raw && raw.state !== "unreachable";
  if (o.state === "playing") return { state: "quiet", speaker: who, other, known, elsewhere: o.device || "another speaker" };
  const sr = spotifyRest(raw, who);
  if (sr && sr.preset && sr.preset.btn && o.lan && o.lan.hands) sr.hands = true;
  if (sr) return sr;
  if (blocked) return o;
  return { state: "quiet", speaker: who, other, known };
}

// WHAT THE BAND SAYS AND DOES, for one room. `tone`: live (playing; the round
// button pauses), held (stopped by a pause this house can undo; it plays), off.
// `ctl` is the transport route's verb for the round button, `skip` the speaker
// a skip may name. `pos` carries the song's place with its age, so the screen
// counts on by its own clock whatever the TV thinks the time is.
// `move` is the room Spotify plays in when it can move (Spotify only);
// `tune` the DJ whose dials may be turned now, where the house keeps them
// (`canTune`); `song` what the page asks about once a song (tvSong).
export function tvBand(o, room, now = Date.now(), { canTune = false } = {}) {
  const who = room?.name ?? "";
  const v = tvNarrow(o, who, !!room?.other) || {};
  const w = barWords(v);
  const band = { tone: w.tone === "live" ? "live" : "off", title: w.one, line2: w.two, line3: "", art: "", pos: null, quality: "", ctl: null, skip: "",
    artist: "", album: "", move: "", tune: null, song: null };
  const st = String(v.state ?? "");
  if (st === "playing") {
    band.title = v.track || "Something is playing";
    band.line2 = [v.artists, v.album].filter(Boolean).join(" · ");
    band.artist = String(v.artists || ""); band.album = String(v.album || "");
    // The program's title, unless the bar's own words already say it (a set
    // played from the Shelf: seen twice on the Bravia, 2026-11-15).
    const pt = v.who?.program?.title ? String(v.who.program.title) : "";
    band.line3 = `${w.two}${pt && !String(w.two).includes(pt) ? ` · “${pt}”` : ""}`;
    band.art = String(v.sleeve || v.art || "");
    if (v.pos && Number(v.pos.of) > 0) band.pos = { ms: Number(v.pos.ms) || 0, of: Number(v.pos.of), age: Math.max(0, now - (Number(v.pos.at) || now)) };
    band.quality = qualityWords(qualityFor(v, o));
    if (v.pausable) {
      band.ctl = { do: "pause", device: String(v.pausable), label: `Pause the ${v.pausable}` };
      band.skip = String(v.pausable);
      band.move = String(v.pausable);
    }
    const sv = steerOf(v);
    if (canTune && sv?.dj && dialsOf(sv.dj).length) band.tune = { dj: String(sv.dj), name: String(v.who?.name || "") };
    if (v.uri) band.song = { uri: String(v.uri), slug: String(v.who?.program?.slug || ""), btn: v.who?.endless && v.who.btn ? Number(v.who.btn) : 0,
      isrc: String(v.isrc || ""), ms: Number(v.pos?.of) || 0 };
  } else if (st === "lan") {
    const spot = /^spotify/i.test(v.source || "");
    const stillWord = v.lanState === "stop" ? "Stopped" : "Paused";
    // A SONG ON TIDAL (or another service that has songs, not a station):
    // its cover, album and place, Skip and one back through the home helper,
    // and About this song by its title and artist (2026-11-16, the owner).
    const songs = !spot && TRACKED.test(String(v.source || ""));
    if (songs) {
      band.art = String(v.art || "");
      band.album = String(v.album || "");
      if (v.pos && v.pos.of > 0) band.pos = { ms: v.pos.ms, of: v.pos.of, age: Math.max(0, now - (v.pos.at || now)) };
      if (v.track) band.song = { uri: v.trackId ? `tidal:track:${v.trackId}` : `lan:${String(v.track).slice(0, 80)}`, slug: "", btn: 0, isrc: "", ms: Number(v.pos?.of) || 0 };
    }
    if (v.lanState === "play") {
      band.title = v.track || w.one;
      band.line2 = [v.artists, songs ? v.album : ""].filter(Boolean).join(" · ");
      band.artist = String(v.artists || "");
      band.line3 = w.two;
      band.quality = qualityWords(qualityFor(v, o));
      if (v.hands && !spot) band.ctl = { do: "hpause", device: who, label: `Pause the ${who}` };
      if (v.hands && songs) { band.skip = who; band.skipH = true; }
    } else {
      if (songs) band.pos = band.pos ? { ...band.pos, age: 0 } : null;
      band.title = v.track || stillWord;
      band.line2 = v.artists || "";
      band.line3 = `${stillWord} · ${w.two}`;
      // A SONG THAT STOPPED OR PAUSED is still shown (the owner, 2026-11-19:
      // "I miss the now playing icon"): the note and the bar's cover open its
      // page, which says it stopped.
      if (v.track) band.still = true;
      if (spot && v.hands && v.preset?.btn) band.ctl = { do: "hkey", device: who, btn: Number(v.preset.btn), label: `Play preset ${v.preset.btn} on the ${who}` };
      else if (!spot && v.hands) band.ctl = { do: "hplay", device: who, label: `Play the ${who}` };
      if (band.ctl) band.tone = "held";
    }
  } else if (st === "quiet" && v.paused) {
    const p = v.paused;
    band.title = p.track || "Paused";
    if (p.track) band.still = true;
    band.line2 = [p.artists, p.album].filter(Boolean).join(" · ");
    band.artist = String(p.artists || ""); band.album = String(p.album || "");
    band.line3 = `Paused · ${w.two}`;
    band.art = String(p.art || "");
    if (p.again) { band.tone = "held"; band.ctl = { do: "again", device: String(p.device), label: `Play it again on the ${p.device}` }; }
  } else if (st === "quiet") {
    band.title = v.known ? `Nothing is playing on the ${who}` : `Nothing on Spotify on the ${who}`;
    band.line2 = v.elsewhere ? `Spotify is playing on the ${v.elsewhere}.`
      : v.known ? "Press a preset above to start it here."
      : v.other ? "Press a preset above to start it here."
      : "Tidal or the radio may be playing: only the speaker knows. Press a preset above to start one.";
  }
  return band;
}

// The services whose music comes as songs, so a WiiM can skip them (the WiiM's
// own words for its source: "Tidal", "Prime", "Qobuz", "Deezer").
const TRACKED = /^(tidal|prime|amazon|qobuz|deezer)/i;

// Which rooms have music now, by slug: where Spotify plays, and each WiiM the
// home helper hears playing.
export function tvRoomsOn(o) {
  const on = {};
  if (o?.state === "playing" && o.device) on[tvSlug(o.device)] = 1;
  for (const [name, r] of Object.entries(o?.lan?.speakers ?? {})) if (r?.state === "play") on[tvSlug(name)] = 1;
  return on;
}
// What the tiles were drawn from: a newer reading of the speakers, or the
// helper's hands come or gone, and the page asks for itself again.
export const tvSig = (readAt, hands) => `${String(readAt || 0)}.${hands ? 1 : 0}`;
// WHAT THE TILES SHOW, as one short mark: each speaker's presets as read,
// not when they were read. The home helper sends the tables at least once an
// hour even when nothing changed, and a mark made of the time reloaded the
// page each hour, out of whatever was open (the review, 2026-11-16).
export function tvReadSig(recs) {
  const parts = Object.entries(recs ?? {}).filter(([, r]) => r && Array.isArray(r.presets))
    .map(([slug, r]) => `${slug}:${JSON.stringify(r.presets)}`).sort();
  if (!parts.length) return "0";
  const src = parts.join("|");
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// THE HOUSE'S CLOCK, for the display: the seconds of the house's own day
// (HOUSE_TZ), which the page counts on from. Null where no zone is set.
export function tvClock(tz, now = Date.now()) {
  if (!tz) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
    const n = (t) => Number(parts.find((x) => x.type === t)?.value);
    const s = (n("hour") % 24) * 3600 + n("minute") * 60 + n("second");
    return Number.isFinite(s) ? s : null;
  } catch { return null; }
}

// WHAT COMES NEXT, AND WHAT THE DJ WROTE (GET …/tv/song, once a song): the
// next three songs of a Shelf page or of an endless set, from what the house
// already keeps (no Spotify call), and the page's paragraph that names the
// song (about.js). `rec` the program's record, `session` an endless preset's
// (its `tracks` are [uri, ms, "Artist — Title"]).
export function tvSong({ uri, title = "", rec = null, session = null, dj = null } = {}) {
  const out = { next: [], about: null };
  const want = String(uri ?? "");
  let list = null;
  if (rec) {
    list = (Array.isArray(rec.sections) ? rec.sections : []).flatMap((s) => (Array.isArray(s?.tracks) ? s.tracks : []))
      .map((t) => ({ uri: t?.uri, t: String(t?.title ?? ""), a: String(t?.artist ?? "") }));
    const stop = aboutStop(rec, want, title);
    if (stop) out.about = { label: stop.label, years: stop.years, heading: stop.heading, text: stop.text, dj: dj || null };
  } else if (Array.isArray(session?.tracks)) {
    list = session.tracks.map((t) => {
      const [a, ...rest] = String(t?.[2] ?? "").split(" — ");
      return { uri: t?.[0], t: rest.length ? rest.join(" — ") : a, a: rest.length ? a : "" };
    });
  }
  const i = list ? list.findIndex((x) => x.uri === want) : -1;
  if (i >= 0) out.next = list.slice(i + 1, i + 4).filter((x) => x.t).map(({ t, a }) => ({ t: t.slice(0, 160), a: a.slice(0, 160) }));
  return out;
}

// One look, as the page's script takes it (GET …/tv/now?room=<slug>).
export function tvAnswer(o, room, { readAt = 0, readSig = null, now = Date.now(), canTune = false, tz = null } = {}) {
  const lit = litKey(o);
  return { band: tvBand(o, room, now, { canTune }), ...(o?.news ? { news: o.news } : {}), clock: tvClock(tz, now), build: TV_BUILD, lit: lit && norm(lit.speaker) === norm(room.name) ? lit.btn : null,
    rooms: tvRoomsOn(o), sig: tvSig(readSig ?? readAt, o?.lan?.hands),
    // A LOOK THAT COSTS SPOTIFY NOTHING: Spotify playing on a WiiM while the
    // home helper reads the speakers (the house keeps its answer until the
    // helper sees a change or the song ends, MC-29). The page may then look
    // every thirty seconds for as long as it is on.
    // So is a song or a station the helper reads in this room (Tidal, the
    // radio: 2026-11-16, with the helper reading every 3 seconds).
    cheap: (!!o?.lan && o.state === "playing" && (o.speakers ?? []).some((sp) => norm(sp.name) === norm(o.device)))
      || (!!o?.lan?.speakers?.[room?.name]?.state && o.lan.speakers[room.name].state === "play" && !/^spotify/i.test(String(o.lan.speakers[room.name].source ?? ""))),
    // Spotify's limit: nothing is read from Spotify, so the page looks rarely.
    rest: o?.state === "throttled" && !o?.lan?.hands };
}

// A press that did not land, back from its 303, in one or two lines. And
// what a program started from the Shelf (`shelf`: { code, on }) or a turn of
// the dials (`tune`, the Tune route's code) came to.
const SHELF_SAY = {
  jumbled: (on) => `It is playing on the ${on}, but Spotify has shuffle or repeat on there, so not in the set's own order.`,
  sent: (on) => `Spotify took the program for the ${on}, but the check afterwards failed. It may well be playing.`,
  asleep: (on) => `The ${on} is not in Spotify's list right now, most likely asleep. Press a preset on its remote, then choose the program again.`,
  failed: () => "Spotify refused to start the program, so nothing changed.",
  throttled: () => "Spotify is limiting the house for a while, so nothing was started.",
  gone: () => "That program is not on the Shelf any more. Nothing was started.",
  no: () => "That program cannot be started from here. Nothing was started.",
  helper: () => "The home helper couldn't press the Tidal preset's key on the speaker. Try again.",
  "tidal-busy": () => "The Tidal requests preset is holding a set that is still being made, so this program wasn't put on. Try again once it's ready.",
};
const TUNE_SAY = {
  applied: "Tuned. The new songs come in after this one, in a few minutes.",
  saved: "Tuned. The next new songs follow it.",
  "saved-day-cap": "Tuned and kept, but no DJ runs are left today.",
  "saved-throttled": "Tuned and kept. Spotify is limiting the house, so nothing was turned now.",
  store: "The house could not keep it. Try again.",
};
export function tvFlashWords({ hflash = null, flash = null, shelf = null, tune = null, voice = null } = {}) {
  // What TV Bro's voice search heard, and what the house did (tvsay.js).
  if (voice && (voice.said || voice.heard)) return `${voice.heard ? `“${String(voice.heard).slice(0, 120)}”: ` : ""}${String(voice.said ?? "").slice(0, 400)}`;
  if (shelf) return shelf.code === "ok" ? "" : (SHELF_SAY[shelf.code] ?? SHELF_SAY.failed)(shelf.on || "speaker");
  if (tune) return TUNE_SAY[tune] ?? (/^saved-/.test(tune) ? "Tuned and kept, but the turn did not reach the DJ." : "");
  if (hflash) return helperKeyWords(hflash);
  if (!flash || flash.code === "ok") return "";
  return {
    sent: `Spotify took the request to start ${flash.name} on the ${flash.on}, but the check afterwards failed. It may well be playing.`,
    stuck: `Spotify took it, but ${flash.name} is not playing on the ${flash.on}. The speaker may be asleep or on another input. Press the tile again.`,
    asleep: `The ${flash.on} is not in Spotify's list right now, most likely asleep. Press a preset on its remote, then the tile again.`,
    failed: `Spotify refused to start ${flash.name}, so the ${flash.on} plays what it did before.`,
  }[flash.code] ?? "";
}

const SOURCE = { TIDAL: "Tidal", Prime: "Amazon Music", newTuneIn: "TuneIn", Pandora2: "Pandora", WiiMRadio: "WiiM radio", CustomRadio: "Web stream" };
const srcWord = (s) => SOURCE[s] ?? String(s ?? "");
const I_LEVELS = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path></svg>`;
const I_NOTE = `<svg class="tglyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"></circle><circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"></circle></svg>`;
const I_PAUSE = `<svg class="ipause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"></rect><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"></rect></svg>`;
const I_PLAY = `<svg class="iplay" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"></path></svg>`;
const I_SKIP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path><path d="M5 5l10 7-10 7z" fill="currentColor"></path></svg>`;
const I_PREV = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path><path d="M19 5L9 12l10 7z" fill="currentColor"></path></svg>`;
const I_INFO = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle cx="12" cy="7.6" r="1.2" fill="currentColor"></circle></svg>`;
const I_MIC_BTN = `<svg class="notei" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`;
const I_NOTE_BTN = `<svg class="notei" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="2"></circle><circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="2"></circle></svg>`;
const I_CHEV = `<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
// Move: an arrow into a speaker, so it never reads as "the next song".
const I_MOVE = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12h8M7.5 8.5l3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><rect x="13.5" y="3.5" width="8" height="17" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"></rect><circle cx="17.5" cy="14.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="17.5" cy="7.6" r="1.1" fill="currentColor"></circle></svg>`;
const I_SLIDERS = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"></circle><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="2"></circle></svg>`;
// WiiM'S OWN WORDMARK, on Move's tiles for the rooms that are WiiMs (the
// owner, 2026-11-15: "i want the WiiM logo anyway", after the word alone was
// advised). The shapes are WiiM's file as its own site serves it
// (wiimhome.com, "White wiim logo", fetched 2026-11-15), drawn in the
// tile's own ink. It is WiiM's trademark, used only to say which speakers
// are WiiMs; this house is not a WiiM product.
const WIIM_MARK = `<svg hidden aria-hidden="true"><symbol id="wiim-mark" viewBox="0 0 148 49"><path fill="currentColor" d="M45.868,33.376 C48.592,33.376 50.800,31.191 50.800,28.497 L50.800,5.101 C50.883,3.306 49.962,1.612 48.404,0.691 C46.845,-0.230 44.901,-0.230 43.343,0.691 C41.784,1.612 40.864,3.306 40.947,5.101 L40.947,28.477 C40.939,29.773 41.453,31.019 42.377,31.939 C43.301,32.858 44.558,33.376 45.868,33.376 L45.868,33.376 Z M4.986,33.376 C7.710,33.376 9.918,31.191 9.918,28.497 L9.918,5.101 C9.918,2.398 7.703,0.207 4.971,0.207 C2.239,0.207 0.024,2.398 0.024,5.101 L0.024,28.477 C0.018,29.779 0.540,31.030 1.472,31.950 C2.404,32.870 3.670,33.384 4.986,33.376 Z M50.800,42.086 L50.800,33.853 L50.800,33.853 L50.800,32.908 C49.445,34.133 47.701,34.852 45.868,34.941 C43.906,34.992 41.913,33.792 40.361,32.390 L29.059,21.952 C26.977,20.232 23.949,20.232 21.867,21.952 L10.565,32.390 C9.014,33.792 7.021,34.992 5.048,34.941 C3.215,34.852 1.471,34.133 0.116,32.908 L0.116,33.853 L0.024,33.853 L0.024,42.086 C-0.109,44.779 0.188,47.991 3.938,48.926 C7.935,49.454 8.726,47.045 11.511,44.860 L25.432,31.983 L39.344,44.820 C42.128,47.045 42.930,49.454 46.926,48.885 C50.677,47.991 50.964,44.779 50.800,42.086 Z M143.013,15.843 C145.736,15.843 147.944,18.028 147.944,20.722 L147.944,44.098 C147.944,46.792 145.736,48.977 143.013,48.977 C140.289,48.977 138.081,46.792 138.081,44.098 L138.081,20.722 C138.081,19.428 138.600,18.187 139.525,17.272 C140.450,16.357 141.705,15.843 143.013,15.843 Z M102.131,15.843 C103.438,15.843 104.691,16.358 105.614,17.273 C106.538,18.188 107.055,19.429 107.052,20.722 L107.052,44.098 C106.932,46.703 104.762,48.754 102.126,48.754 C99.489,48.754 97.319,46.703 97.199,44.098 L97.199,20.722 C97.199,18.028 99.407,15.843 102.131,15.843 Z M147.975,7.133 L147.975,15.366 L147.975,16.321 C146.623,15.093 144.877,14.374 143.043,14.288 C141.071,14.288 139.077,15.447 137.526,16.850 L126.224,27.277 C124.147,29.010 121.110,29.010 119.032,27.277 L107.730,16.850 C106.179,15.447 104.186,14.248 102.223,14.288 C100.389,14.374 98.644,15.093 97.292,16.321 L97.292,15.366 L97.292,7.133 C97.035,4.440 97.322,1.238 101.073,0.293 C105.069,-0.224 105.871,2.184 108.655,4.409 L122.567,17.246 L136.488,4.409 C139.273,2.184 140.064,-0.224 144.061,0.344 C147.811,1.238 148.109,4.440 147.975,7.133 Z M64.660,13.872 C63.352,13.872 62.098,14.386 61.173,15.301 C60.248,16.215 59.728,17.456 59.728,18.750 L59.728,44.098 C59.728,46.792 61.936,48.977 64.660,48.977 C67.384,48.977 69.592,46.792 69.592,44.098 L69.592,18.750 C69.592,17.456 69.072,16.215 68.147,15.301 C67.222,14.386 65.968,13.872 64.660,13.872 Z M83.421,13.872 C82.113,13.872 80.859,14.386 79.934,15.301 C79.009,16.215 78.489,17.456 78.489,18.750 L78.489,44.098 C78.489,46.792 80.697,48.977 83.421,48.977 C86.145,48.977 88.353,46.792 88.353,44.098 L88.353,18.750 C88.353,16.056 86.145,13.872 83.421,13.872 Z"></path></symbol></svg>`;
const WIIM_USE = `<svg class="wlogo" role="img" aria-label="WiiM" viewBox="0 0 148 49"><use href="#wiim-mark"></use></svg>`;
export const TV_I_BACK = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

// WHAT EVERY TV SCREEN SHARES (this page, and the Shelf and the dials in
// tvpages.js). Sizes are in rem, and one rem is a sixtieth of the screen's
// width (or the height's share of it, on a screen that is not 16:9): 16 px on
// the Bravia's 960 × 540, and the same picture, larger, on anything bigger.
// THE BUTTON IN HAND IS FILLED AMBER, not ringed (the owner, 2026-11-15,
// after WiiM's own TV app): its ink turns dark with it.
export const TV_BASE_CSS = `
:root{--ground:#131417;--raised:#1A1B20;--ink:#E9E8E3;--ink-2:#A9AAB2;--ink-3:#9A9CA4;--rule:#2E3037;--q-deep:#3B5378;--q-on-deep:#EDF1F7;--q-ink:#AFC2E0;--mark:#2A2C33;--sleeve:#2B2B30;--focus:#F2B63A;--on-focus:#131417}
html{font-size:16px;font-size:min(1.6667vw,2.963vh)}
html,body{margin:0;height:100%;background:var(--ground);color:var(--ink);overflow:hidden}
body{font-family:Archivo,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a,button{-webkit-tap-highlight-color:transparent}
a:focus,button:focus{outline:0;background:var(--focus)!important;border-color:var(--focus)!important;color:var(--on-focus)!important;--ink:#131417;--ink-2:#131417;--ink-3:#3A2E0E;--q-ink:#131417}
button:disabled{opacity:.35;cursor:default}
.pill{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.4375rem;height:2.75rem;padding:0 1rem;border-radius:999px;border:.125rem solid var(--rule);background:transparent;color:var(--ink);font:inherit;font-size:.9375rem;font-weight:600;white-space:nowrap;text-decoration:none;cursor:pointer}
.pill .pi{width:1.125rem;height:1.125rem;flex:0 0 auto}
[hidden]{display:none!important}`;

// THE ARROWS, where the browser does not move focus itself: the nearest
// control that way. Left and right stay in the row; up and down take the
// nearest row, and in it the nearest control. No backticks: it is put inside
// a page's script.
export const TV_ARROWS_JS = `
  function tvControls(root) {
    return Array.prototype.filter.call(root.querySelectorAll("a[href], button"), function (el) { return !el.disabled && el.offsetParent !== null; });
  }
  /* A bar that stays at the top while the page scrolls (data-bar): up and
     down reach it only when nothing else lies that way, so a row half under
     it is not skipped (the review, 2026-11-16: up from row 5 of a long
     Shelf went to Home, then to row 2). */
  function tvMove(root, dir, home) {
    var cur = document.activeElement, all = tvControls(root);
    if (!cur || all.indexOf(cur) < 0) { var h = home(); if (h) h.focus(); return; }
    var r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, best = null, score = Infinity, last = null, lastScore = Infinity;
    var flat = dir === "left" || dir === "right";
    function inBar(el) { return !!(el.closest && el.closest("[data-bar]")); }
    var fromBar = inBar(cur);
    all.forEach(function (el) {
      if (el === cur) return;
      var b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
      var along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
      if (along < 4) return;
      if (flat && (b.bottom <= r.top + 2 || b.top >= r.bottom - 2)) return;
      var off = flat ? Math.abs(dy) : Math.abs(dx);
      var s = flat ? along : along * 4 + off;
      if (!flat && !fromBar && inBar(el)) { if (s < lastScore) { lastScore = s; last = el; } return; }
      if (s < score) { score = s; best = el; }
    });
    best = best || last;
    /* A DJ's SCREEN (the review, 2026-11-19): right from the first idea
       reached the options beside it, from the second and third nothing,
       because the panel is shorter than the list and "the row" was empty.
       From an idea or the foot's buttons, with nothing in the row, the
       nearest control lying wholly that way is taken. Tiles elsewhere keep to their row,
       so an edge stays an edge. */
    if (!best && flat && cur.closest && cur.closest(".idea, .steer")) {
      all.forEach(function (el) {
        if (el === cur) return;
        var b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
        var along = dir === "left" ? -dx : dx;
        if (along < 4) return;
        /* Wholly on that side: not a button above or below that only
           reaches further that way. */
        if (dir === "right" ? b.left < r.right - 2 : b.right > r.left + 2) return;
        var s = along + Math.abs(dy) * 2;
        if (s < score) { score = s; best = el; }
      });
    }
    if (best) best.focus();
  }
  /* ONE PRESS, ONE ACT (the review, 2026-11-16): OK held down, or pressed
     again within half a second of a screen or a view opening, does nothing,
     so a second OK never lands on the next screen's first button. */
  var tvQuietUntil = Date.now() + 500;
  function tvQuiet(ms) { tvQuietUntil = Date.now() + (ms || 500); }
  document.addEventListener("keydown", function (ev) {
    if ((ev.key === "Enter" || ev.key === " ") && (ev.repeat || Date.now() < tvQuietUntil)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);
  document.addEventListener("click", function (ev) {
    if (ev.detail === 0 && Date.now() < tvQuietUntil) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);
  /* A PICTURE THAT DOES NOT LOAD is hidden, so its place shows its colours
     (a sleeve) or the note (a cover), never a broken-image mark; and it is
     not asked for again on every look. */
  var tvBadImg = {};
  document.addEventListener("error", function (ev) {
    var t = ev.target;
    if (!t || t.tagName !== "IMG") return;
    tvBadImg[t.getAttribute("src") || ""] = 1;
    var box = t.parentNode, note = box && box.getAttribute ? box.getAttribute("data-note") : null;
    if (note !== null && note !== undefined && box) box.innerHTML = note; else t.style.visibility = "hidden";
  }, true);
  var TV_DIRS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  /* A PAGE TURN THAT ENDS ON A WHOLE LINE (the owner, 2026-11-15: a page
     turned by seven tenths of the screen, so the eye had to hunt for where
     the sentence went on). Page down puts the first line not wholly seen at
     the top, under the bar; Page up puts the line just above the old top at
     the foot. The lines are the text's own, read from the page. */
  function tvLines(box) {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0, out = [];
    Array.prototype.forEach.call(box.querySelectorAll("p, h1, h2, h3, li, dt, dd"), function (el) {
      if (el.offsetParent === null) return;
      var rs = [el.getBoundingClientRect()];
      if (el.tagName === "P" && document.createRange) {
        var r = document.createRange(); r.selectNodeContents(el);
        var cs = r.getClientRects(); if (cs.length) rs = Array.prototype.slice.call(cs);
      }
      rs.forEach(function (b) { if (b.height > 2) out.push([b.top + y, b.bottom + y]); });
    });
    out.sort(function (a, b) { return a[0] - b[0]; });
    var lines = [];
    out.forEach(function (l) {
      var last = lines[lines.length - 1];
      if (last && Math.abs(last[0] - l[0]) < 4) last[1] = Math.max(last[1], l[1]); else lines.push([l[0], l[1]]);
    });
    return lines;
  }
  /* SCROLLING WITH THE ARROWS (the owner, 2026-11-16: "scrolling rather
     than page up/down"): a press of up or down moves the text about three
     lines, smoothly; held down, it keeps going, a little at a time. Page up
     and Page down still turn a whole page, ending on a whole line. */
  function tvScroll(d, held) {
    var V = window.innerHeight, step = Math.round(V * (held ? 0.05 : 0.18));
    try { window.scrollBy({ top: d * step, left: 0, behavior: held ? "auto" : "smooth" }); } catch (e) { window.scrollBy(0, d * step); }
  }
  function tvTurn(box, head, d) {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0, V = window.innerHeight, GAP = 12;
    var H = head ? head.getBoundingClientRect().bottom : 0, L = tvLines(box), to = null, i;
    if (d > 0) {
      for (i = 0; i < L.length; i++) if (L[i][1] > y + V - 1) { to = L[i][0] - H - GAP; break; }
      if (to === null) to = document.documentElement.scrollHeight;
      if (to <= y + 4) to = y + (V - H) * 0.85;
    } else {
      var top = -1;
      for (i = 0; i < L.length; i++) if (L[i][0] >= y + H - 1) { top = i; break; }
      if (top <= 0) to = 0;
      else {
        var want = L[top - 1][1] - V + GAP;
        to = 0;
        for (i = 0; i < top; i++) if (L[i][0] - H - GAP >= want) { to = L[i][0] - H - GAP; break; }
        if (to >= y - 4) to = y - (V - H) * 0.85;
      }
    }
    window.scrollTo(0, Math.max(0, Math.round(to)));
  }`;

const TV_CSS = `${TV_BASE_CSS}
main.tv{box-sizing:border-box;width:100vw;height:100vh;position:relative}
.view{display:none;box-sizing:border-box;width:100%;height:100%}
main.tv[data-view=ctl] .vctl,main.tv[data-view=move] .vmove,main.tv[data-view=rooms] .vrooms,main.tv[data-view=about] .vabout,main.tv[data-view=voice] .vvoice{display:flex}
main.tv[data-view=dis] .vdis{display:block}
.vctl{padding:1.125rem 1.75rem 1.25rem;flex-direction:column;gap:.875rem}
.rooms{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .625rem;flex:0 0 auto}
.wm{font-size:1.1875rem;font-weight:800;letter-spacing:.01em;color:var(--ink-2);margin-right:.375rem;padding:.25rem .625rem;margin-left:-.625rem;border-radius:999px;text-decoration:none}
.room{box-sizing:border-box;display:inline-flex;align-items:center;gap:.4rem;height:3rem;padding:0 1.25rem;border-radius:999px;border:.125rem solid var(--rule);background:transparent;color:var(--ink);font:inherit;font-size:1.0625rem;font-weight:600;text-decoration:none;white-space:nowrap;cursor:pointer}
.room.pick{background:var(--q-deep);border-color:var(--q-deep);color:var(--q-on-deep);font-weight:700}
.room svg{display:none}.room.on svg{display:block}.room svg.chev{display:block;width:1rem;height:1rem;margin-left:.125rem}
.room.now,.room.mic{width:3rem;padding:0;justify-content:center}.room svg.notei{display:block;width:1.375rem;height:1.375rem}
.room.more,.room.app,.room.now,.room.mic,.room.shelf,.room.djs{border-color:var(--q-ink);color:var(--q-ink)}
.vvoice{align-items:center;justify-content:center}
.vcard{box-sizing:border-box;width:44rem;max-width:calc(100% - 4rem);display:flex;flex-direction:column;gap:1rem;padding:1.5rem 1.75rem;border-radius:1.25rem;background:var(--raised);border:.125rem solid var(--rule)}
.vcard .vhead h1{font-size:1.625rem}
.vcard .vmic{width:3rem;height:3rem;border-radius:50%;background:var(--q-deep);color:var(--q-on-deep);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.vcard .vmic svg{width:1.5rem;height:1.5rem}
.vstep{margin:0;font-size:1.25rem;line-height:1.4}.vapp,.inapp .vbro{display:none}.inapp .vapp{display:block}
.vsays{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem .875rem}
.vsays li{font-size:1.125rem;font-weight:700;padding:.5rem .875rem;border-radius:.75rem;background:var(--ground);color:var(--ink)}
.vsays li span{display:block;font-size:.875rem;font-weight:500;color:var(--ink-3);margin-top:.125rem}
.vfine{margin:0;font-size:.9375rem;line-height:1.4;color:var(--ink-3)}
.rooms.many .room{height:2.5rem;padding:0 .875rem;font-size:.9375rem}
.rooms .gap{flex:1}
.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);gap:.75rem;flex:1 1 auto;min-height:0}
.grid form{display:flex;min-width:0;min-height:0;margin:0}
.tile{box-sizing:border-box;flex:1;display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;text-align:left;padding:.75rem .875rem;border-radius:.875rem;border:.125rem solid var(--rule);background:var(--raised);color:var(--ink);font:inherit;min-width:0;min-height:0;overflow:hidden;cursor:pointer}
div.tile{cursor:default}
.tile.dim{background:transparent}.tile.dim .tnum,.tile.dim .tname{color:var(--ink-3)}
.tile.lit{border-color:var(--q-ink)}
.ttop{display:flex;align-items:center;justify-content:space-between;min-height:1.875rem}
.tnum{font-size:1.875rem;font-weight:800;line-height:1}
.tplay{display:none;align-items:center;gap:.3125rem;height:1.625rem;padding:0 .625rem;border-radius:999px;background:var(--q-deep);color:var(--q-on-deep);font-size:.8125rem;font-weight:700}
.tplay svg{width:.875rem;height:.875rem}
.tile.lit .tplay{display:inline-flex}
.tbody{display:flex;flex-direction:column;gap:.1875rem;min-width:0}
.tname{font-size:1.0625rem;font-weight:700;line-height:1.15;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.tsub{font-size:.875rem;line-height:1.25;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* A key's small line too long for it (2026-11-18): slides along and back
   once when shown, then rests with its "…"; keeps sliding on the key that
   is playing and on the one the remote is on. */
.tsub.run{text-overflow:clip}
.tsub.run>span{display:inline-block;animation:tvslide var(--dur,6s) ease-in-out 2 alternate}
.tile.lit .tsub.run>span,.tile:focus .tsub.run>span{animation-iteration-count:infinite}
@media (prefers-reduced-motion:reduce){.tsub.run>span{animation:none}}
.tile.busy{border-color:var(--focus)}.tile.busy .tsub{color:var(--focus)}.tile.busy:focus .tsub{color:var(--on-focus)}
.gnote{grid-column:1 / -1;align-self:center;margin:0;font-size:1.1875rem;line-height:1.4;color:var(--ink-2);max-width:44rem}
.gnote.side{font-size:.9375rem;color:var(--ink-3);padding:0 .5rem}
.band{display:flex;align-items:center;gap:1.125rem;height:9.25rem;box-sizing:border-box;padding:.875rem 1.125rem .875rem .875rem;border-radius:1rem;background:var(--raised);border:.125rem solid var(--rule);flex:0 0 auto}
.sleeve{width:7.25rem;height:7.25rem;border-radius:.625rem;border:0;padding:0;background:var(--sleeve);color:var(--ink-3);display:flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden;cursor:pointer}
.sleeve:disabled{opacity:1;cursor:default}
.sleeve:focus{box-shadow:0 0 0 .3125rem var(--focus)}
.sleeve img{width:100%;height:100%;object-fit:cover;display:block}
.sleeve svg{width:2.75rem;height:2.75rem}
.btext{display:flex;flex-direction:column;gap:.3125rem;flex:1 1 auto;min-width:0}
.btext p{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b1{font-size:1.625rem;font-weight:800;line-height:1.15}
.b2{font-size:1.1875rem;color:var(--ink-2)}
.b3{font-size:.9375rem;color:var(--ink-3)}
main.tv[data-tone=off] .b1{font-size:1.5rem}
.bprog{display:flex;align-items:center;gap:.625rem;margin-top:.25rem;font-size:.8125rem;color:var(--ink-3);min-height:1rem}
.bline{flex:1;height:.3125rem;border-radius:999px;background:var(--rule);position:relative;overflow:hidden}
.bline i,.dline i{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:999px;background:var(--q-ink)}
.btext p.bsay{margin-top:.25rem;font-size:1rem;line-height:1.3;color:var(--focus);white-space:normal}
.bctl,.dctl{display:flex;align-items:center;gap:.75rem;flex:0 0 auto}
.bmain{width:4.25rem;height:4.25rem;border-radius:50%;border:0;padding:0;background:var(--q-deep);color:var(--q-on-deep);display:flex;align-items:center;justify-content:center;cursor:pointer}
.bmain svg{width:1.75rem;height:1.75rem}
.bskip,.bprev{width:3.75rem;height:3.75rem;border-radius:50%;border:.125rem solid var(--rule);padding:0;background:transparent;color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer}
.bskip svg{width:1.625rem;height:1.625rem}
.bprev{width:3.25rem;height:3.25rem}.bprev svg{width:1.375rem;height:1.375rem}
.dctl .bmain{width:3.75rem;height:3.75rem}.dctl .bskip,.dctl .bprev{width:3rem;height:3rem}
.bmain .ipause{display:none}main.tv[data-tone=live] .bmain .ipause{display:block}main.tv[data-tone=live] .bmain .iplay{display:none}
[data-t][aria-busy=true],.mroom[aria-busy=true]{opacity:.55}

/* ICONS, NOT WORDS (the owner, 2026-11-15: "the screens are becoming a bit
   busy"): About this song is the circled i, Tune the sliders, each a round
   button like Back and Skip; the words stay in their labels for a reader. */
.iconbtn{box-sizing:border-box;width:3rem;height:3rem;border-radius:50%;border:.125rem solid var(--rule);padding:0;background:transparent;color:var(--ink);display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;text-decoration:none;cursor:pointer}
.iconbtn .pi{width:1.5rem;height:1.5rem}
/* A web search for this song came back (readfind.js): a dot on the i. */
.iconbtn.news{position:relative}.iconbtn.news::after{content:"";position:absolute;top:-.1875rem;right:-.1875rem;width:.875rem;height:.875rem;border-radius:50%;background:var(--focus);border:.1875rem solid var(--ground)}
.bicons{display:flex;align-items:center;gap:.5rem;flex:0 0 auto}
.vdis{position:relative;overflow:hidden;background:#0B0C0E}
.dbg{position:absolute;left:-12%;top:-22%;width:124%;height:144%;opacity:.36;transform:translateZ(0)}
.dbg img{width:100%;height:100%;object-fit:cover;display:block;filter:blur(5rem)}
.dwrap{position:relative;box-sizing:border-box;width:100%;height:100%;padding:1.5rem 3rem 1.375rem;display:flex;flex-direction:column;gap:.875rem;transition:opacity 2s}
.vdis.dimmed .dwrap{opacity:.42}
.dtop{display:flex;align-items:center;justify-content:space-between;gap:1rem;height:1.5rem;flex:0 0 auto}
.dfrom{margin:0;font-size:.875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#E3B27A;white-space:nowrap;overflow:hidden;min-width:0;flex:1 1 auto}
.slide>span{display:inline-block;white-space:nowrap}
.slide.run>span{animation:tvslide var(--dur,16s) ease-in-out infinite alternate}
@keyframes tvslide{0%,14%{transform:translateX(0)}86%,100%{transform:translateX(var(--shift,0))}}
.dtr{display:flex;align-items:baseline;gap:1.25rem;flex:0 0 auto}
.dclock{font-size:1.125rem;font-weight:600;color:var(--ink-2)}
.dwm{font-size:1.0625rem;font-weight:800;letter-spacing:.01em;color:var(--ink-3)}
.dmid{display:flex;align-items:center;gap:2.75rem;flex:1 1 auto;min-height:0}
.dcover{width:21rem;height:21rem;border-radius:.875rem;background:var(--sleeve);color:var(--ink-3);overflow:hidden;flex:0 0 auto;display:flex;align-items:center;justify-content:center}
.dcover img,.acover img{width:100%;height:100%;object-fit:cover;display:block}
.dcover svg{width:7rem;height:7rem}
.dtext{flex:1 1 auto;min-width:0;height:21rem;display:flex;flex-direction:column;gap:.625rem}
.d1{margin:0;font-size:2.875rem;font-weight:800;line-height:1.06;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.d2{margin:0;font-size:1.625rem;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.d3{margin:0;font-size:1.0625rem;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dgrow{flex:1}
.dnext{display:flex;flex-direction:column;gap:.3125rem}
.dnl{margin:0;font-size:.8125rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.dn{margin:0;font-size:1.125rem;color:var(--ink-3);white-space:nowrap;overflow:hidden}
.dn b{font-weight:400}.dn i{font-style:normal}
.dnl + .dn b{color:var(--ink-2)}
.dprog{display:flex;flex-direction:column;gap:.375rem;flex:0 0 auto}
/* What a voice request heard and did, over the song page for a while (the
   owner, 2026-11-15: a skip said to the TV went to the presets to show it). */
.dsay{position:absolute;left:3rem;right:3rem;bottom:5.75rem;margin:0;padding:.625rem 1rem;border-radius:.75rem;background:rgba(19,20,23,.94);border:.125rem solid var(--focus);color:var(--focus);font-size:1.0625rem;line-height:1.35;z-index:2}
.dline{height:.3125rem;border-radius:999px;background:#3A3D45;position:relative;overflow:hidden}
.dtimes{display:flex;justify-content:space-between;font-size:.875rem;color:var(--ink-3);min-height:1rem}
.dbot{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:1rem;height:3.75rem;flex:0 0 auto}
.dright .pill{padding:0 .875rem}
.dq{margin:0;display:flex;flex-direction:column;gap:.125rem;min-width:0}
.dq span{font-size:1.0625rem;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dq span+span{font-size:.9375rem;color:var(--ink-3)}
.dright{display:flex;align-items:center;justify-content:flex-end;gap:.625rem}
.vmove,.vrooms,.vabout{padding:1.5rem 2.5rem;flex-direction:column;gap:1.25rem}
.vrooms .rver{margin:auto 0 0;font-size:.9375rem;line-height:1.4;color:var(--ink-3)}
a.mroom{text-decoration:none}
html.scroll,html.scroll body{height:auto;overflow:visible}
html.scroll{overflow-y:auto;overflow-x:hidden}
html.scroll main.tv{width:100%;height:auto;min-height:100vh}
.vabout{height:auto;min-height:100vh;padding-top:6rem}
.vabout .vhead{position:fixed;top:0;left:0;right:0;z-index:1;background:var(--ground);padding:1.5rem 2.5rem .75rem}
.vhead{display:flex;align-items:center;gap:1rem;flex:0 0 auto}
.vhead h1{margin:0;font-size:1.75rem;font-weight:800;flex:1}
.mgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}
.mroom{box-sizing:border-box;height:5.5rem;border-radius:.875rem;border:.125rem solid var(--rule);background:var(--raised);color:var(--ink);font:inherit;font-size:1.25rem;font-weight:700;text-align:left;padding:.75rem 1rem;display:flex;flex-direction:column;justify-content:space-between;cursor:pointer;min-width:0}
.mroom small{display:flex;align-items:center;gap:.5rem;font-size:.8125rem;font-weight:600;color:var(--ink-3);min-height:1.125rem}
.wlogo{width:3.375rem;height:1.125rem;flex:0 0 auto;color:var(--ink-2)}
.mst{margin-left:auto}
.mroom:disabled{opacity:1}.mroom.here{border-color:var(--q-ink);background:transparent}.mroom.here small{color:var(--q-ink)}
.msay{margin:0;font-size:1.0625rem;line-height:1.4;color:var(--focus);max-width:46rem}
.abody{display:flex;align-items:flex-start;gap:2.25rem}
.aside{display:flex;flex-direction:column;gap:.5rem;width:12.5rem;flex:0 0 auto;position:sticky;top:6rem}
/* THE BAR AT THE TOP IS FIXED, NOT STICKY: a browser that brings the button
   in hand into view scrolls a sticky bar's page back to its top (seen in a
   browser, 2026-11-15: Page down reached the end, the hand went to Page up,
   and the page jumped to the top). A fixed bar is always in view. */
.acover{width:12.5rem;height:12.5rem;border-radius:.75rem;background:var(--sleeve);color:var(--ink-3);overflow:hidden;display:flex;align-items:center;justify-content:center;margin-bottom:.375rem}
.acover svg{width:3.5rem;height:3.5rem}
.aside p{margin:0}
.a1{font-size:1.375rem;font-weight:800;line-height:1.15}
.a2{font-size:1.0625rem;color:var(--ink-2)}
.a3{font-size:.9375rem;color:var(--ink-3)}
.ascroll{flex:1 1 auto;min-width:0;padding-bottom:1.5rem}
.albl{margin:0 0 .5rem;font-size:.8125rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#E08A62}
.ah{margin:0 0 .75rem;font-size:1.375rem;font-weight:800;line-height:1.2}
.ap{margin:0;font-family:Newsreader,Georgia,serif;font-size:1.3125rem;line-height:1.5;color:var(--ink);white-space:pre-wrap}
.afacts.after{margin-top:1.75rem;padding-top:1.25rem;border-top:.125rem solid var(--rule)}
.afl{color:var(--q-ink)}
.adl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.5rem 1.25rem;margin:0 0 1.25rem;font-size:1.125rem}
.adl dt{color:var(--ink-3)}.adl dd{margin:0;color:var(--ink)}
.awiki{margin-bottom:1rem}
.axp{white-space:pre-line}
.awmore h3{margin:1.25rem 0 .5rem;font-size:1.125rem;font-weight:800;letter-spacing:.02em;color:var(--ink)}
.awmore .ap+.ap{margin-top:.75rem}
.asrc{margin:0;font-size:.875rem;color:var(--ink-3)}`;

const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// Back, the round button and Skip: once in the band, once on the display.
function transport(b, where) {
  const f = (n) => (where ? `${where}-${n}` : n);
  return `<button type="button" class="bprev" data-f="${f("prev")}" data-t="prev" data-do="${b.skipH ? "hprev" : "prev"}" data-device="${esc(b.skip)}" aria-label="Back to the song before"${b.skip ? "" : " disabled"}>${I_PREV}</button>
      <button type="button" class="bmain" data-f="${f("main")}" data-t="main" data-do="${esc(b.ctl?.do ?? "")}" data-device="${esc(b.ctl?.device ?? "")}" data-btn="${esc(String(b.ctl?.btn ?? ""))}" aria-label="${esc(b.ctl?.label ?? "Nothing here to pause or play")}"${b.ctl ? "" : " disabled"}>${I_PAUSE}${I_PLAY}</button>
      <button type="button" class="bskip" data-f="${f("skip")}" data-t="skip" data-do="${b.skipH ? "hnext" : "next"}" data-device="${esc(b.skip)}" aria-label="Skip to the next song"${b.skip ? "" : " disabled"}>${I_SKIP}</button>`;
}

// The band, drawn whole: every part is always there, hidden when it has
// nothing to say, so the script fills the same places.
function bandHtml(b, say, tuneHref) {
  const at = b.pos ? Math.max(0, Math.min(b.pos.of, b.pos.ms + b.pos.age)) : 0;
  return `
  <section class="band" aria-label="Now playing" data-tone="${esc(b.tone)}">
    <button type="button" class="sleeve" data-f="sleeve" data-open="dis" data-note="${esc(I_NOTE)}" aria-label="Show the cover large"${b.tone === "off" && !b.still ? " disabled" : ""}>${b.art ? `<img src="${esc(b.art)}" alt="">` : I_NOTE}</button>
    <div class="btext">
      <p class="b1 slide"><span>${esc(b.title)}</span></p>
      <p class="b2 slide"${b.line2 ? "" : " hidden"}><span>${esc(b.line2)}</span></p>
      <p class="b3 slide"${b.line3 ? "" : " hidden"}><span>${esc(b.line3)}</span></p>
      <div class="bprog"${say || !(b.pos || b.quality) ? " hidden" : ""}>
        <span class="bp0"${b.pos ? "" : " hidden"}>${b.pos ? mmss(at) : ""}</span>
        <span class="bline"${b.pos ? "" : " hidden"}><i style="width:${b.pos ? (100 * at / b.pos.of).toFixed(1) : 0}%"></i></span>
        <span class="bp1"${b.pos ? "" : " hidden"}>${b.pos ? `−${mmss(b.pos.of - at)}` : ""}</span>
        <span class="bq"${b.quality ? "" : " hidden"}>${esc(b.quality)}</span>
      </div>
      <p class="bsay" role="status"${say ? "" : " hidden"}>${esc(say)}</p>
    </div>
    <div class="bctl"${b.ctl || b.skip ? "" : " hidden"}>
      ${transport(b, "")}
    </div>
    <div class="bicons"${b.move || b.tune ? "" : " hidden"}><button type="button" class="iconbtn bmove" data-f="move" data-open="move" aria-label="Move the music"${b.move ? "" : " hidden"}>${I_MOVE}</button>` +
      `<button type="button" class="iconbtn babout" data-f="about" data-open="about" aria-label="About this song" hidden>${I_INFO}</button>` +
      `<a class="iconbtn btune" data-f="tune" href="${esc(tuneHref)}" aria-label="Tune ${esc(b.tune?.name || "the DJ")}"${b.tune ? "" : " hidden"}>${I_SLIDERS}</a></div>
  </section>`;
}

// THE DISPLAY, MOVE AND ABOUT THIS SONG: three more views of the same page,
// drawn empty and filled by the script from the same answer the band shows.
function viewsHtml(b, rooms, room = null, on = {}, base = "", version = null) {
  return `
  <div class="view vdis" aria-label="Now playing, large">
    <div class="dbg" aria-hidden="true"></div>
    <div class="dwrap">
      <div class="dtop"><p class="dfrom slide"><span></span></p><div class="dtr"><span class="dclock" hidden></span><span class="dwm" aria-hidden="true">fmwax</span></div></div>
      <div class="dmid">
        <div class="dcover" data-note="${esc(I_NOTE)}">${I_NOTE}</div>
        <div class="dtext"><h1 class="d1"></h1><p class="d2 slide"><span></span></p><p class="d3 slide"><span></span></p><span class="dgrow"></span>
          <div class="dnext" hidden><p class="dnl">Up next</p><p class="dn slide"><span><b></b><i></i></span></p><p class="dn slide"><span><b></b><i></i></span></p><p class="dn slide"><span><b></b><i></i></span></p></div>
        </div>
      </div>
      <p class="dsay" role="status" hidden></p>
      <div class="dprog"><div class="dline"><i></i></div><div class="dtimes"><span class="dp0"></span><span class="dp1"></span></div></div>
      <div class="dbot"><p class="dq"><span class="dq1"></span><span class="dq2" hidden></span></p>
        <div class="dctl">
      ${transport(b, "d")}
        </div>
        <div class="dright"><button type="button" class="iconbtn dmove" data-f="d-move" data-open="move" aria-label="Move the music" hidden>${I_MOVE}</button><button type="button" class="iconbtn dabout" data-f="d-about" data-open="about" aria-label="About this song" hidden>${I_INFO}</button>` +
    `<a class="iconbtn dtune" data-f="d-tune" href="#" aria-label="Tune the DJ" hidden>${I_SLIDERS}</a><button type="button" class="pill dpre" data-f="d-presets" data-open="ctl">Home</button></div>
      </div>
    </div>
  </div>
  <div class="view vmove" aria-label="Move the music">
    <div class="vhead"><h1>Move the music to</h1><button type="button" class="pill mcancel" data-open="back">Cancel</button></div>
    <div class="mgrid">${rooms.map((r) => `<button type="button" class="mroom" data-name="${esc(r.name)}" data-slug="${esc(r.slug)}" data-kind="${r.wiim ? "wiim" : /phone/i.test(r.name) ? "phone" : "other"}"><span>${esc(r.name)}</span><small>${r.wiim ? WIIM_USE : ""}<span class="mst"></span></small></button>`).join("")}</div>${rooms.some((r) => r.wiim) ? WIIM_MARK : ""}
    <p class="msay" role="status" hidden></p>
  </div>
  <div class="view vrooms" aria-label="Choose a room">
    <div class="vhead"><h1>Choose a room</h1><button type="button" class="pill rcancel" data-open="ctl">Cancel</button></div>
    <div class="mgrid">${rooms.map((r) => `<a class="mroom rroom${r.slug === room?.slug ? " here" : ""}" data-f="r:${esc(r.slug)}" data-room="${esc(r.slug)}" href="${esc(base)}/tv?room=${esc(encodeURIComponent(r.slug))}"><span>${esc(r.name)}</span><small>${r.wiim ? WIIM_USE : ""}<span class="mst">${r.slug === room?.slug ? "Showing" : on[r.slug] ? "Playing" : ""}</span></small></a>`).join("")}</div>${version ? `
    <p class="rver">${esc(version)}</p>` : ""}
  </div>
  <div class="view vvoice" aria-label="Say it to the TV">
    <div class="vcard">
      <div class="vhead"><span class="vmic">${I_MIC_BTN}</span><h1>Say it to the TV</h1><button type="button" class="pill vclose" data-open="back">Got it</button></div>
      <p class="vstep vapp">Press <b>Guide</b> on the remote. When <b>Listening…</b> shows at the bottom, say:</p>
      <p class="vstep vbro">Press <b>Guide</b> on the remote (the key TV Bro's voice search is on). When TV Bro listens, say:</p>
      <ul class="vsays">
        <li>What's playing<span>the song, on the screen</span></li>
        <li>Skip<span>also: pause, play, go back</span></li>
        <li>Preset 7<span>any preset, by its number</span></li>
        <li>Hank, Daptone<span>a DJ and what you'd like</span></li>
        <li>More like this<span>or: change it up, more upbeat</span></li>
        <li>Move the music to the ${esc(rooms.find((r) => r.slug !== room?.slug)?.name ?? "Ultra")}<span>Spotify, to another room</span></li>
      </ul>
      <p class="vfine">On a DJ's screen, just say what you'd like. The whole list is on the phone: Speakers, Voice on the TV.</p>
    </div>
  </div>
  <div class="view vabout" aria-label="About this song">
    <div class="vhead"><button type="button" class="pill aback" data-open="back">${TV_I_BACK}Back</button><h1>About this song</h1>` +
    `<a class="pill aread" data-f="a-read" href="#" hidden>Read more</a><a class="pill anotes" data-f="a-notes" href="#" hidden>Program notes</a><button type="button" class="pill awbtn" data-f="a-wiki" data-more hidden>More from Wikipedia</button><button type="button" class="pill apage" data-page="-1">Page up</button><button type="button" class="pill apage" data-page="1">Page down</button></div>
    <div class="abody">
      <div class="aside"><div class="acover" data-note="${esc(I_NOTE)}">${I_NOTE}</div><p class="a1"></p><p class="a2"></p><p class="a3"></p></div>
      <div class="ascroll"><div class="awords"><p class="albl"></p><h2 class="ah"></h2><p class="ap"></p></div>
        <div class="afacts" hidden><p class="albl afl">Song facts</p><dl class="adl"></dl>
          <div class="awiki" hidden><p class="albl afl awlbl">From Wikipedia</p><p class="ap awp"></p><div class="awmore"></div></div>` +
    `<div class="awiki axsong" hidden><p class="albl afl">About the song, from Last.fm</p><p class="ap axp axsp"></p></div>` +
    `<div class="awiki axart" hidden><p class="albl afl axalbl"></p><p class="ap axp axap"></p></div><p class="asrc"></p></div></div>
    </div>
  </div>`;
}

// THE PAGE. `rooms`: every room the house may play on, the WiiMs first, each
// { name, slug, wiim }; `room` the one shown. `readings`, `endlessKeys`,
// `playable`, `fills` and `lan` as the Speakers page takes them; `ownKeys`
// the house's own Spotify presets ({ btn, name, sub }), for a room that is
// not a WiiM and for a house that reads no speaker; `reqDj` the DJ whose set
// is on each requests preset, by number.
// `canTune`: the house keeps dials; `tz` its zone, for the display's clock;
// `shelf` and `tune` what a press on the Shelf or the dials came to.
// `talk`: the microphone opens Talk; the route gives it only to the fmwax TV
// app (inTvApp), since a TV's browser gives a page no microphone.
export function renderTv({ base, rooms = [], room = null, now = null, readings = {}, readAt = 0, endlessKeys = {},
  playable = {}, fills = [], lan = null, ownKeys = null, reqDj = {}, keyLines = {}, hflash = null, flash = null,
  canTune = false, tz = null, shelf = null, tune = null, voice = null, version = null, talk = false, clock = Date.now() }) {
  const answer = tvAnswer(now ?? { state: "unknown" }, room ?? { name: "" }, { readAt, readSig: tvReadSig(readings), now: clock, canTune, tz });
  const say = tvFlashWords({ hflash, flash, shelf, tune, voice });
  const band = answer.band;
  const rq = room ? `?room=${encodeURIComponent(room.slug)}` : "";
  // THE ROOM: one button with the room shown (the owner, 2026-11-16: "make
  // the home screen a little less busy... only show the current active
  // speaker"); it opens the rooms as tiles, the ones with music marked. Then
  // Now Playing (the display), the Shelf. (The App link left 2026-11-19,
  // MC-48: the owner, "Yes remove app"; Talk was what it was still for.)
  const roomsRow = `
  <nav class="rooms" aria-label="Room"><a class="wm" data-f="fmwax" href="${esc(base)}/tv/about${esc(rq)}" aria-label="About fmwax">fmwax</a>` +
    (room ? `<button type="button" class="room pick${answer.rooms[room.slug] ? " on" : ""}" data-f="rooms" data-open="rooms" data-room="${esc(room.slug)}" aria-label="${esc(room.name)}: choose another room">${I_LEVELS}${esc(room.name)}${I_CHEV}</button>` : "") +
    `<span class="gap"></span>` +
    // Now Playing as a note (the owner, 2026-11-16: "a musical note symbol to save space").
    // Voice, as a microphone (the owner, 2026-11-16): a page can't open TV
    // Bro's voice search (only TV Bro's own start page may), so it says how.
    // Where the house has Talk, the microphone opens Talk made for the TV
    // (MC-48, the owner 2026-11-19: "Keep mic icon"); else the voice help.
    (talk ? `<a class="room mic" data-f="mic" href="${esc(base)}/tv/talk${esc(rq)}" aria-label="Talk">${I_MIC_BTN}</a>`
      : `<button type="button" class="room mic" data-f="mic" data-open="voice" aria-label="Voice: how to say it">${I_MIC_BTN}</button>`) +
    `<button type="button" class="room now" data-f="now" data-open="dis" aria-label="Now playing"${band.tone === "off" && !band.still ? " hidden" : ""}>${I_NOTE_BTN}</button>` +
    `<a class="room djs" data-f="djs" href="${esc(base)}/tv/djs${esc(rq)}">DJs</a>` +
    `<a class="room shelf" data-f="shelf" href="${esc(base)}/tv/shelf${esc(rq)}">Shelf</a>
  </nav>`;

  // THE GRID. A tile's corner is blank at rest (the owner, 2026-11-15); the
  // one that plays says "Playing" there.
  const tileInner = (n, name, sub) => `<span class="ttop"><span class="tnum">${n}</span><span class="tplay">${I_LEVELS}Playing</span></span>` +
    `<span class="tbody"><span class="tname">${esc(name)}</span><span class="tsub" data-sub="${esc(sub)}"><span>${esc(sub)}</span></span></span>`;
  const litCls = (n) => (answer.lit === n ? " lit" : "");
  const form = (action, n, busy, label, inner) => `
    <form method="post" action="${esc(base)}${action}"><input type="hidden" name="btn" value="${n}"><input type="hidden" name="device" value="${esc(room.name)}"><input type="hidden" name="back" value="tv">` +
    `<button type="submit" class="tile${litCls(n)}" data-k="${n}" data-f="k:${n}" data-busy="${busy}" aria-label="${esc(label)}">${inner}</button></form>`;
  let grid = "";
  let label = room ? `Presets on the ${room.name}` : "Presets";
  if (!room) {
    grid = `<p class="gnote">This house has named no speakers yet. The setup page names them.</p>`;
  } else if (ownKeys) {
    // The house's own Spotify presets, over Spotify Connect: a room that is
    // not a WiiM (an Echo), or a house that reads no speaker.
    label = `The house's Spotify presets, on the ${room.name}`;
    grid = ownKeys.length ? ownKeys.map((k) => form("/preset/play", k.btn, "Starting…", `Play preset ${k.btn}, ${k.name}, on the ${room.name}`,
      tileInner(k.btn, k.name, k.sub || "Spotify"))).join("") +
      (room.wiim ? "" : `<p class="gnote side" style="grid-column:span ${6 - (ownKeys.length % 6)}">Tidal, the radio and other services are keys on a WiiM.</p>`)
      : `<p class="gnote">This house has no Spotify presets of its own yet. The setup page makes them.</p>`;
  } else {
    const rows = readings[room.slug]?.presets ?? null;
    const plays = new Set(playable[room.slug] ?? []);
    if (!rows) {
      grid = `<p class="gnote">The ${esc(room.name)}'s presets have not been read yet. On the phone, open the Speakers tab and tap Read the speakers; this screen shows them after that.</p>`;
    } else {
      const tiles = [];
      for (let n = 1; n <= 12; n++) {
        const p = rows.find((x) => x.btn === n) ?? null;
        if (!p) {
          tiles.push(`
    <div class="tile dim" data-k="${n}"><span class="ttop"><span class="tnum">${n}</span></span><span class="tbody"><span class="tsub">Nothing saved</span></span></div>`);
          continue;
        }
        const spotify = p.source === "Spotify";
        const ek = spotify ? endlessKeys[n] ?? null : null;
        const req = fills.includes(n);
        const src = srcWord(p.source);
        // A REQUESTS OR GUEST DJ KEY (2026-11-18), as the phone's grid says
        // it: the DJ on it now, and the set's title or the words asked
        // (house.js requestKeyLines, laneKeyLine); only over a key saved on
        // the same service.
        const kl = !ek && keyLines[n] && (!keyLines[n].source || p.source === keyLines[n].source) ? keyLines[n] : null;
        const name = ek ? ek.name : kl ? kl.name : req ? "Requests" : p.name;
        // Whose set is on a requests preset; its service only when that is not Spotify.
        const sub = ek ? "Endless" : kl ? kl.sub : req ? [reqDj[n], spotify && reqDj[n] ? null : src].filter(Boolean).join(" · ") : src;
        if (lan?.hands) {
          tiles.push(form("/wiim/key", n, "Pressing…", `Press ${n}, ${name}, on the ${room.name}`, tileInner(n, name, sub)));
        } else if (spotify && plays.has(n)) {
          tiles.push(form("/preset/play", n, "Starting…", `Play ${name} on the ${room.name}`, tileInner(n, name, sub)));
        } else {
          // Not Spotify, and no helper at home to press it: the remote's.
          tiles.push(`
    <div class="tile dim${litCls(n)}" data-k="${n}">${tileInner(n, name, "On the remote")}</div>`);
        }
      }
      grid = tiles.join("");
    }
  }
  const tuneHref = band.tune ? `${base}/tv/tune/${encodeURIComponent(band.tune.dj)}${rq}` : "#";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>fmwax on the TV</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=Newsreader:opsz,wght@6..72,400&display=swap">
<style>${TV_CSS}
</style>
</head>
<body>
<main class="tv" data-build="${TV_BUILD}" data-base="${esc(base)}" data-room="${esc(room?.slug ?? "")}" data-sig="${esc(answer.sig)}"${answer.cheap ? ` data-cheap="1"` : ""}${answer.rest ? ` data-rest="1"` : ""} data-band="${esc(JSON.stringify(band))}" data-view="ctl" data-tone="${esc(band.tone)}" data-room-name="${esc(room?.name ?? "")}" data-clock="${answer.clock ?? ""}">
<div class="view vctl">${roomsRow}
  <section class="grid" aria-label="${esc(label)}">${grid}
  </section>${bandHtml(band, say, tuneHref)}
</div>${viewsHtml(band, rooms, room, answer.rooms, base, version)}
</main>
${TV_SCRIPT}
</body>
</html>
`;
}

// THE SCRIPT. No backticks in here: it lives inside a template literal.
//
// LOOKING. The phone's pages stop looking ten minutes after the last touch;
// a TV is left on, so this one slows down instead. Every thirty seconds for
// ten minutes after the remote was last used, and for as long as a look costs
// Spotify nothing (`cheap`: Spotify on a WiiM, the home helper reading it).
// Otherwise when the song should have ended, and every five minutes; every
// fifteen once the remote has rested an hour. Any key looks at once. Hidden,
// it does not look at all.
//
// THE VIEWS. The controls, the display, Move and About this song are one
// page: `data-view` on <main> says which shows. The display opens from Now
// Playing and the small cover, and by itself once music has played a minute
// with the remote at rest; Home brings the controls back, and they come
// back by themselves when the music is over. At night by the house's clock
// (ten to seven) the display dims while the remote rests, and it shifts a
// little every two minutes for an OLED's sake.
//
// ONCE A SONG the page asks what comes next and whether the DJ wrote about
// it (…/tv/song: the house's own records, no Spotify call).
//
// THE ARROWS: TV Bro moves focus between buttons by itself in one of its
// modes. Where a browser does not, this does: a tick after an arrow key, if
// focus has not moved, it goes to the nearest control that way.
const TV_SCRIPT = `<script>
(function () {
  var main = document.querySelector("main.tv"); if (!main) return;
  // In the fmwax TV app (tools/tv/shell, 2026-11-18) Guide listens in the app itself; in TV Bro it is TV Bro's voice search.
  if (navigator.userAgent.indexOf("fmwaxTV/") >= 0) document.documentElement.classList.add("inapp");
  var base = main.getAttribute("data-base") || "", room = main.getAttribute("data-room") || "", roomName = main.getAttribute("data-room-name") || "";
  var build = main.getAttribute("data-build") || "", sig = main.getAttribute("data-sig") || "", cheap = main.hasAttribute("data-cheap"), rest = main.hasAttribute("data-rest");
  var EVERY = 30000, CHEAP = 10000, IDLE = 600000, REST = 300000, LONG = 3600000, SLOW = 900000, SHOW = 60000;
  var band = null; try { band = JSON.parse(main.getAttribute("data-band") || "null"); } catch (e) {}
  var loadedAt = Date.now(), touched = loadedAt, timer = null, busy = false, hold = null, tick = null, sayTimer = null;
  var skipHold = null, pending = null, fails = 0, lostSaid = "";
  function songId(b) { return b ? ((b.song && b.song.uri) || b.title || "") : ""; }
  var c0 = main.getAttribute("data-clock"), clock = c0 ? { s: Number(c0), got: loadedAt } : null;
  var view = "ctl", backTo = "ctl", lastCtl = null, wantDis = false, offAt = 0, GAP = 45000, song = { key: "", next: [], about: null };
  /* ABOUT THIS SONG STAYS OPEN (the owner, 2026-11-18: it went back to the
     song page when the song changed, before the article was read). It closes
     only with Back, or ten minutes after the remote was last used. */
  var aboutKey = "", aboutTouch = 0, ABOUT_HOLD = 10 * 60000;
  setInterval(function () { if (view === "about" && Date.now() - aboutTouch > ABOUT_HOLD) open("back"); }, 30000);
  var root = document.documentElement;
  function q(s) { return main.querySelector(s); }
  function all(s) { return Array.prototype.slice.call(main.querySelectorAll(s)); }
  function set(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function show(el, on) { if (el) el.hidden = !on; }
  function seen(el) { return !!el && !el.disabled && el.offsetParent !== null; }
  function first(list) { for (var i = 0; i < list.length; i++) if (seen(list[i])) return list[i]; return null; }
  function enc(x) { return encodeURIComponent(x == null ? "" : String(x)); }
  function mmss(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function anchor(b, at) { if (b && b.pos) b.pos.got = at - (Number(b.pos.age) || 0); }
  anchor(band, loadedAt);
  var sayEl = q(".bsay"), prog = q(".bprog"), dis = q(".vdis");
  ${TV_ARROWS_JS}
  function home() { return q(".tile.lit[data-f]") || q(".tile[data-f]") || q(".room.pick") || tvControls(main)[0] || null; }
  /* The remote always has a button in hand: when the one it was on has gone
     (a view changed, a button went dim), the view's own first one takes it. */
  function mend() {
    var a = document.activeElement;
    if (a && a !== document.body && main.contains(a) && seen(a)) return;
    var el = view === "dis" ? first([q(".dctl .bmain"), q(".dpre")])
      : view === "move" ? first([q(".vmove .mroom:not([disabled])"), q(".mcancel")])
      : view === "rooms" ? first([q(".rroom.here"), q(".rroom"), q(".rcancel")])
      : view === "voice" ? q(".vclose")
      : view === "about" ? first([q('.apage[data-page="1"]'), q('.apage[data-page="-1"]'), q(".aback")]) : home();
    if (el) el.focus();
  }
  function start() { if (view === "ctl") return home(); mend(); return null; }
  function where() { var p = band && band.pos; return p ? Math.max(0, Math.min(p.of, p.ms + (Date.now() - p.got))) : 0; }
  function progress() {
    var p = band && band.tone === "live" ? band.pos : null;
    show(q(".bp0"), !!p); show(q(".bline"), !!p); show(q(".bp1"), !!p);
    show(q(".bq"), !!(band && band.quality)); set(q(".bq"), (band && band.quality) || "");
    show(prog, sayEl.hidden && !!(p || (band && band.quality)));
    q(".dprog").style.visibility = p ? "visible" : "hidden";
    if (!p) { if (tick) { clearInterval(tick); tick = null; } return; }
    var at = where(), w = (100 * at / p.of).toFixed(1) + "%";
    q(".bline i").style.width = w; q(".dline i").style.width = w;
    set(q(".bp0"), mmss(at)); set(q(".bp1"), "\\u2212" + mmss(p.of - at));
    set(q(".dp0"), mmss(at)); set(q(".dp1"), "\\u2212" + mmss(p.of - at));
    if (!tick) tick = setInterval(progress, 1000);
  }
  /* The line in the band, and the same words over the song page, so a
     message is read wherever the screen is. */
  function say(t, keep) {
    clearTimeout(sayTimer);
    set(sayEl, t || ""); show(sayEl, !!t);
    var ds = q(".dsay"); set(ds, t || ""); show(ds, !!t);
    progress();
    if (t && !keep) sayTimer = setTimeout(function () { say(""); }, 20000);
  }
  if (!sayEl.hidden) say(sayEl.textContent);
  function pic(box, url) {
    if (!box) return;
    if (url && tvBadImg[url]) url = "";
    var img = box.querySelector("img");
    if (url) {
      if (!img) { img = document.createElement("img"); img.alt = ""; box.textContent = ""; box.appendChild(img); }
      if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    } else if (img) { box.innerHTML = box.getAttribute("data-note") || ""; }
  }
  /* A LINE TOO LONG FOR ITS PLACE SLIDES, slowly, there and back (the owner,
     2026-11-15: a long program title was cut off). Measured while shown. */
  function slide(el) {
    var sp = el && el.firstElementChild; if (!sp || el.offsetParent === null) return;
    var over = sp.scrollWidth - el.clientWidth;
    if (over > 6) { el.style.setProperty("--shift", "-" + over + "px"); el.style.setProperty("--dur", Math.max(8, Math.round(over / 24)) + "s"); el.classList.add("run"); }
    else el.classList.remove("run");
  }
  /* A line too long for the screen slides along and back, slowly: the song,
     artist and album too (the owner, 2026-11-18: a title cut off at the edge). */
  function slides() { slide(q(".dfrom")); all(".dn,.b1,.b2,.b3,.d2,.d3").forEach(slide); }
  /* A key's small line: once, then at rest (CSS keeps the playing key's and
     the focused key's going). */
  function tslide(el) {
    if (!el || !el.firstElementChild || el.offsetParent === null) return;
    el.classList.remove("run");
    var over = el.scrollWidth - el.clientWidth;
    if (over > 4) {
      el.style.setProperty("--shift", "-" + (over + 2) + "px");
      el.style.setProperty("--dur", Math.max(3, Math.round(over / 24)) + "s");
      void el.offsetWidth; el.classList.add("run");
    }
  }
  function tslides() { all(".tile .tsub").forEach(tslide); }
  main.addEventListener("animationend", function (e) {
    var s = e.target && e.target.parentNode;
    if (s && s.classList && s.classList.contains("tsub")) s.classList.remove("run");
  });
  main.addEventListener("focusin", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".tile") : null;
    if (t) tslide(t.querySelector(".tsub"));
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(tslides); else tslides();
  /* WHAT COMES NEXT, AND THE DJ'S WORDS: asked once a song. */
  function drawSong() {
    var b = band || {};
    show(q(".dnext"), song.next.length > 0);
    all(".dn").forEach(function (el, i) {
      var n = song.next[i]; show(el, !!n);
      if (n) { set(el.querySelector("b"), n.t); set(el.querySelector("i"), n.a ? " \\u00b7 " + n.a : ""); }
    });
    var has = !!(song.about || song.facts || song.genius || song.extra || song.read || song.find);
    show(q(".babout"), has); show(q(".dabout"), has);
    /* THE RESULTS ARE IN (the owner, 2026-11-22): a dot on the i while a
       web search for THIS song has come back and About was not opened since. */
    /* Also for a search that found nothing (Codex, 2026-11-23): it came
       back, and the page behind the i says so, as the phone's line does. */
    var dot = !!(news && song.find && song.find.slug === news.slug && newsSeen() !== news.at);
    all(".babout,.dabout").forEach(function (el) { el.classList.toggle("news", dot); });
    show(q(".bicons"), !!(b.move || b.tune || has));
    /* Not for the next song: the article open is the last song's, and stays. */
    if (view === "about" && !has && aboutKey === song.key) open("back");
    if (view === "move" && !b.move) open("ctl");
    /* The music is over: the buttons come back, and the display with the
       next music unless the remote is used meanwhile. */
    if (view === "dis" && !look(b)) { open("ctl"); wantDis = true; }
    slides(); mend();
  }
  /* A song to show: one playing, or one that stopped or paused (band.still). */
  function look(b) { return !!b && (b.tone !== "off" || !!b.still); }
  function songLook() {
    /* Paused: the song is still the one it was, with its words (the owner,
       2026-11-15: About this song went away on a pause). */
    if (band && band.tone === "held" && !band.song && song.key) return;
    var s = band && band.tone !== "off" ? band.song : null;
    var key = s && s.uri ? s.uri + "|" + (s.slug || "") + "|" + (s.btn || "") : "";
    if (key === song.key) return;
    song = { key: key, next: [], about: null, facts: null, genius: null, extra: null, more: null };
    song.readAt = "";
    if (!key || !(s.slug || s.btn || s.isrc || band.artist)) return;
    /* Two asks: what comes next and the DJ's words (the house's own records,
       at once), and the song facts (open databases, a few seconds the first
       time a song is played, then kept), so up next never waits for them. */
    var at = base + "/tv/song?uri=" + enc(s.uri) + "&slug=" + enc(s.slug) + "&btn=" + enc(s.btn || "") + "&t=" + enc(band.title);
    function got() {
      return function (r) { return r.ok ? r.json() : null; };
    }
    if (s.slug || s.btn) fetch(at, { cache: "no-store" }).then(got()).then(function (a) {
      if (!a || song.key !== key) return;
      song.next = a.next || []; song.about = a.about || null; drawSong();
    }).catch(function () {});
    /* By the song's code when the answer carries one, else by its title and
       artist (the house finds it by name). */
    if (s.isrc || band.artist) song.readAt = at + "&isrc=" + enc(s.isrc || "") + "&ms=" + enc(s.ms || "") + "&a=" + enc(band.artist || "") + "&al=" + enc(band.album || "");
    song.readGot = Date.now();
    if (s.isrc || band.artist) fetch(at + "&isrc=" + enc(s.isrc || "") + "&ms=" + enc(s.ms || "") + "&a=" + enc(band.artist || "") + "&al=" + enc(band.album || ""), { cache: "no-store" }).then(got()).then(function (a) {
      /* Reading alone is an answer too (Codex, 2026-11-22): a song with no
         facts still has its Guardian pieces or its web search. */
      if (!a || song.key !== key || !(a.facts || a.genius || a.extra || a.read || a.find)) return;
      song.facts = a.facts || null; song.genius = a.genius || null; song.extra = a.extra || null; song.read = a.read || null; song.find = a.find || null; drawSong();
    }).catch(function () {});
  }
  /* The band and the display, from the one answer. */
  function draw() {
    var b = band || { tone: "off" };
    main.setAttribute("data-tone", b.tone); q(".band").setAttribute("data-tone", b.tone);
    set(q(".b1 span"), b.title || ""); set(q(".b2 span"), b.line2 || ""); show(q(".b2"), !!b.line2);
    set(q(".b3 span"), b.line3 || ""); show(q(".b3"), !!b.line3);
    pic(q(".sleeve"), b.art); pic(q(".dcover"), b.art); pic(q(".dbg"), b.art); pic(q(".acover"), b.art);
    var c = b.ctl || null;
    all("[data-t=main]").forEach(function (m) {
      m.setAttribute("data-do", c ? c.do : ""); m.setAttribute("data-device", c ? c.device : "");
      m.setAttribute("data-btn", c && c.btn ? String(c.btn) : "");
      m.setAttribute("aria-label", c ? c.label : "Nothing here to pause or play"); m.disabled = !c;
    });
    all("[data-t=skip],[data-t=prev]").forEach(function (s) {
      s.setAttribute("data-device", b.skip || ""); s.disabled = !b.skip;
      /* Through the home helper for a song on Tidal, through Spotify otherwise. */
      var nx = s.getAttribute("data-t") === "skip";
      s.setAttribute("data-do", b.skipH ? (nx ? "hnext" : "hprev") : (nx ? "next" : "prev"));
    });
    show(q(".bctl"), !!(c || b.skip));
    q(".sleeve").disabled = !look(b); show(q(".room.now"), look(b));
    show(q(".bmove"), !!b.move); show(q(".dmove"), !!b.move);
    all(".btune,.dtune").forEach(function (tn) {
      show(tn, !!b.tune);
      if (b.tune) { tn.setAttribute("href", base + "/tv/tune/" + enc(b.tune.dj) + "?room=" + enc(room)); tn.setAttribute("aria-label", "Tune " + (b.tune.name || "the DJ")); }
    });
    /* The room is said at the foot of the display, so not twice. */
    var from = b.line3 || "", lead = roomName + " \\u00b7 ";
    if (roomName && from.indexOf(lead) === 0) from = from.slice(lead.length);
    set(q(".dfrom span"), from); set(q(".d1"), b.title || "");
    set(q(".d2 span"), b.artist || ""); show(q(".d2"), !!b.artist);
    set(q(".d3 span"), b.album || ""); show(q(".d3"), !!b.album);
    /* The room, and the stream's quality on a line of its own under it (the
       owner, 2026-11-16: on Tidal it was cut off beside the room). */
    set(q(".dq1"), roomName); set(q(".dq2"), b.quality || ""); show(q(".dq2"), !!b.quality);
    songLook(); drawSong(); progress(); slides();
  }
  function fillAbout() {
    var a = song.about, b = band || {}, f = song.facts;
    set(q(".a1"), b.title || ""); set(q(".a2"), b.artist || ""); set(q(".a3"), b.album || "");
    show(q(".awords"), !!a);
    if (a) {
      set(q(".albl"), [a.dj, a.label, a.years].filter(Boolean).join(" \\u00b7 "));
      set(q(".ah"), a.heading || ""); show(q(".ah"), !!a.heading);
      set(q(".ap"), a.text || "");
    }
    /* SONG FACTS (the owner's choice A): what open databases say of the
       song, for any Spotify song; under the DJ's words where there are some. */
    var g = song.genius, x = song.extra;
    show(q(".afacts"), !!(f || g || x)); q(".afacts").classList.toggle("after", !!a);
    var dl = q(".adl"); dl.textContent = "";
    function row(k, v) {
      if (!v) return;
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = k; dd.textContent = v; dl.appendChild(dt); dl.appendChild(dd);
    }
    /* GENIUS (2026-11-16): who made it, and what it took from and gave to
       other records, a few names each, the most read first. */
    function names(r) {
      if (!r || !r.top || !r.top.length) return "";
      var s = r.top.map(function (x) { return "\u201c" + x.t + "\u201d, " + x.a + (x.y ? " (" + x.y + ")" : ""); }).join("; ");
      return s + (r.n > r.top.length ? " \u00b7 " + (r.n - r.top.length) + " more" : "");
    }
    if (f || g || x) {
      row("Written by", ((f && f.writers && f.writers.length ? f.writers : g && g.writers) || []).join(", "));
      if (f) {
        /* "1985-04-27 to 1986-02-10" said as years: "1985 to 1986". */
        var rec = f.recorded ? String(f.recorded).replace(/(\\d{4})(-\\d{2}){0,2}/g, "$1").replace(/^(\\d{4}) to \\1$/, "$1") : "";
        row(f.live ? "Recorded live" : "Recorded", [rec, f.place].filter(Boolean).join(", "));
        row("First released", f.released ? String(f.released) : "");
      }
      if (f) row("On the album", f.album && f.album.title ? f.album.title + (f.album.year ? " (" + f.album.year + ")" : "") : "");
      if (g) {
        row("Produced by", (g.producers || []).join(", "));
        row("A cover of", names(g.coverOf));
        row("Samples", names(g.samples));
        row("Sampled in", names(g.sampledIn));
        row("Covered by", names(g.coveredBy));
      }
      /* The song's own article; else its album's, said as the album's
         (2026-11-17); else Genius's own words, which are shorter and written
         by its readers. */
      var w = wikiOf(f), aw = w && w === f.albumWiki;
      var gw = !w && g && g.about ? g.about : "";
      show(q(".awiki"), !!(w || gw));
      set(q(".awlbl"), aw ? "From Wikipedia, about the album " + (w.album || w.title) : gw ? "From Genius" : "From Wikipedia");
      set(q(".awp"), w ? w.text : gw);
      /* MORE FROM WIKIPEDIA (the owner, 2026-11-16): the rest of the article's
         story, asked for only when the button is pressed. */
      /* LITTLE SAID OF THE SONG (the owner, 2026-11-20: "we need to beef that
         up"): Last.fm's words on the song, and the artist's story, each under
         a label saying whose words and about whom (songextra.js). */
      var xs = x && x.song && x.song.text ? x.song : null, xa = x && x.artist && x.artist.text ? x.artist : null;
      show(q(".axsong"), !!xs); set(q(".axsp"), xs ? xs.text : "");
      show(q(".axart"), !!xa); set(q(".axap"), xa ? xa.text : "");
      if (xa) set(q(".axalbl"), "About the artist" + (xa.name ? " " + xa.name : "") + ", from " + (xa.from === "wikipedia" ? "Wikipedia" : "Last.fm"));
      drawMore();
      var xw = !!(xa && xa.from === "wikipedia"), xl = !!(xs || (xa && xa.from === "lastfm"));
      var dbs = [f ? "MusicBrainz" : "", w || xw ? "Wikipedia" : ""].filter(Boolean).join(" and ");
      set(q(".asrc"), [dbs ? "From " + dbs + ", open databases anyone can edit." : "", g ? "From Genius, written by its readers." : "",
        xl ? "From Last.fm, written by its listeners." : ""].filter(Boolean).join(" "));
    }
    /* The whole page the DJ wrote, on a page of its own (the owner,
       2026-11-15: "maybe have button for full program notes"). */
    /* READ MORE (the owner, 2026-11-22): the Guardian's pieces about the
       artist, on a page of their own; only when some were found, with how
       many (readmore.js). */
    /* AND FIND MORE (readfind.js): the web's pieces the curator found for
       this song count too; with none yet, the button says a search can be
       asked for, or that one is under way. */
    var rd = song.read, fd = song.find, rl = q(".aread");
    var rn = (rd && rd.n ? rd.n : 0) + (fd && fd.state === "found" ? fd.n || 0 : 0);
    /* "none" shows too (Codex): the page is where "the curator found
       nothing" is said. */
    var rshow = !!(rn || (fd && (fd.state === "ask" || fd.state === "asked" || fd.state === "none")));
    show(rl, rshow);
    if (rshow) {
      set(rl, rn ? "Read more \u00b7 " + rn : fd.state === "asked" ? "Searching\u2026" : fd.state === "none" ? "Read more" : "Find articles");
      rl.setAttribute("href", base + "/tv/read?room=" + enc(room) + "&a=" + enc(b.artist || (rd && rd.name) || "") + "&t=" + enc(b.title || "") + "&al=" + enc(b.album || ""));
    }
    var s = b.song || {}, nl = q(".anotes");
    show(nl, !!s.slug);
    if (s.slug) nl.setAttribute("href", base + "/tv/notes/" + enc(s.slug) + "?room=" + enc(room) + "&uri=" + enc(s.uri || ""));
  }
  /* THE READING, ASKED AGAIN for the song showing: when a web search came
     back (the look's news), and each minute while one is under way, so
     "Searching\u2026" becomes "Read more" by itself. The facts are kept by the
     house, so this costs it its own records only. */
  var news = null;
  function newsSeen() { try { return localStorage.getItem("tv:news") || ""; } catch (e) { return ""; } }
  function readAgain() {
    var key = song.key, at = song.readAt; if (!key || !at) return;
    song.readGot = Date.now();
    fetch(at, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) {
      if (!a || song.key !== key) return;
      song.read = a.read || null; song.find = a.find || null; drawSong();
      if (view === "about" && aboutKey === song.key) fillAbout();
    }).catch(function () {});
  }
  function newsTake(nw) {
    var was = news ? news.at : ""; news = nw || null;
    if (news && news.at !== was) readAgain();
    else if (song.find && song.find.state === "asked" && Date.now() - (song.readGot || 0) > 60000) readAgain();
    else if ((news ? news.at : "") !== was) drawSong();
  }
  function wikiOf(f) {
    return f && f.wiki && f.wiki.text ? f.wiki : f && f.albumWiki && f.albumWiki.text ? f.albumWiki : null;
  }
  /* The article "More from Wikipedia" reads on: the song's or its album's,
     else the artist's (2026-11-20). */
  function moreOf() {
    var w = wikiOf(song.facts), xa = song.extra && song.extra.artist;
    return w || (xa && xa.wiki && xa.text ? { title: xa.wiki, text: xa.from === "wikipedia" ? xa.text : "" } : null);
  }
  function drawMore() {
    var f = song.facts, w = moreOf(), box = q(".awmore"), btn = q(".awbtn");
    box.textContent = "";
    /* Under the text it goes on from. */
    var under = q(wikiOf(f) ? ".awiki" : ".axart"); if (box.parentNode !== under) under.appendChild(box);
    var m = song.more;
    if (m && m.sections) {
      m.sections.forEach(function (sec) {
        if (sec.h) { var h = document.createElement("h3"); h.textContent = sec.h; box.appendChild(h); }
        (sec.p || []).forEach(function (t) { var p = document.createElement("p"); p.className = "ap"; p.textContent = t; box.appendChild(p); });
      });
    }
    show(btn, !!(w && w.title) && !(m && m.sections));
    if (btn && !btn.getAttribute("aria-busy")) set(btn, m && m.none ? "No more on Wikipedia" : "More from Wikipedia");
  }
  function askMore(btn) {
    var w = moreOf(), key = song.key;
    if (!w || !w.title || btn.getAttribute("aria-busy") === "true") return;
    btn.setAttribute("aria-busy", "true"); set(btn, "Loading\u2026");
    fetch(base + "/tv/song?more=1&w=" + enc(w.title) + "&s=" + enc(String(w.text || "").slice(0, 80)), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (a) {
        btn.removeAttribute("aria-busy");
        if (song.key !== key) return;
        var m = a && a.more;
        song.more = m && m.sections && m.sections.length ? m : { none: true };
        drawMore();
        if (song.more.sections) { var pd = q('.apage[data-page="1"]'); if (pd) pd.focus(); pages(); }
      })
      .catch(function () { btn.removeAttribute("aria-busy"); set(btn, "Try Wikipedia again"); });
  }
  /* About this song scrolls as a page, which a TV's browser can do by
     itself; Page up and Page down turn it with OK (the owner, 2026-11-15:
     the text was cut off and nothing scrolled). They are always there, and
     go dim at the top and at the end, so "that is all of it" is seen. */
  function pages() {
    if (view !== "about") return;
    var y = window.pageYOffset || root.scrollTop || 0;
    all(".apage").forEach(function (b) {
      var up = b.getAttribute("data-page") === "-1";
      b.disabled = up ? y < 4 : y + window.innerHeight >= root.scrollHeight - 4;
    });
    mend();
  }
  window.addEventListener("scroll", function () { pages(); }, { passive: true });
  function turn(d) { tvTurn(q(".ascroll"), q(".vabout .vhead"), d); setTimeout(pages, 300); }
  function roomWord(r) { return r.disabled ? "Playing here" : ""; }
  function fillMove() {
    var here = band ? band.move : "";
    all(".mroom").forEach(function (r) {
      var is = r.getAttribute("data-name") === here;
      r.disabled = is; r.classList.toggle("here", is); r.removeAttribute("aria-busy");
      set(r.querySelector(".mst"), roomWord(r));
    });
    set(q(".msay"), ""); show(q(".msay"), false);
  }
  function open(v) {
    if (v === "back") v = backTo;
    if (v === view) return;
    if (v === "dis" && !look(band)) return;
    /* Opens for whatever knows the song: the DJ's words, the open databases,
       or Genius alone (2026-11-16, the owner: the i did nothing for a song
       only Genius knew). */
    if (v === "about") { if (!(song.about || song.facts || song.genius || song.read || song.find)) return;
      if (news && song.find && song.find.slug === news.slug) { try { localStorage.setItem("tv:news", news.at); } catch (e) {} drawSong(); }
      fillAbout(); aboutKey = song.key; aboutTouch = Date.now(); }
    if (v === "move") { if (!band || !band.move) return; fillMove(); }
    if (view === "ctl") { var a = document.activeElement; lastCtl = a && a !== document.body && main.contains(a) ? a : null; }
    backTo = v === "about" || v === "move" || v === "rooms" || v === "voice" ? view : "ctl";
    view = v; main.setAttribute("data-view", v); tvQuiet();
    root.classList.toggle("scroll", v === "about"); window.scrollTo(0, 0);
    dis.classList.remove("dimmed"); pages(); slides();
    if (v === "ctl" && seen(lastCtl)) lastCtl.focus();
    else { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); mend(); }
  }
  function remember() {
    var a = document.activeElement, f = a && a.getAttribute ? a.getAttribute("data-f") : null;
    try { if (f) sessionStorage.setItem("tv:focus", f); sessionStorage.setItem("tv:view", view === "dis" ? "dis" : "ctl"); } catch (e) {}
  }
  function paint(a) {
    if (!a || !a.band) return;
    /* The tiles were drawn from an older reading, or the helper came or
       went: the page asks for itself again, once for each such change. */
    /* A NEW PAGE WAS DEPLOYED (the owner, 2026-11-15: song facts went live
       and the TV, left on, kept the page from before): it asks for itself
       again, once for each new page. */
    /* Never out of a view being read or chosen in (About this song, Move,
       the rooms): the next look after it closes asks. A browser that keeps
       nothing between pages gets no reload at all, and the page goes on
       being painted (the review, 2026-11-16: it stopped painting). */
    var inView = view === "about" || view === "move" || view === "rooms" || view === "voice";
    function again(key, mark) {
      var had = null; try { had = sessionStorage.getItem(key); } catch (e) { return false; }
      if (had === mark) return false;
      try { sessionStorage.setItem(key, mark); } catch (e) { return false; }
      remember(); location.replace(base + "/tv?room=" + encodeURIComponent(room)); return true;
    }
    if (!inView && a.build && a.build !== build && again("tv:build", a.build)) return;
    if (!inView && a.sig && a.sig !== sig && again("tv:reloaded", a.sig)) return;
    cheap = !!a.cheap; rest = !!a.rest;
    newsTake(a.news);
    if (a.clock != null) clock = { s: Number(a.clock), got: Date.now() };
    var b = a.band;
    /* A PAUSE OR A PLAY THE HOUSE ACCEPTED, NOT YET IN SPOTIFY'S ANSWER:
       an answer that still says the old thing is not drawn until the wait
       is over (Spotify's read lags its own yes, measured 2026-09-22). */
    if (hold) {
      if (Date.now() < hold.until && (b.tone === "live") !== hold.live) return;
      hold = null;
    }
    /* THE DISPLAY STAYS THROUGH A GAP (the owner, 2026-11-15: "should stay in
       song page"): one answer that finds no music, between two songs or
       when Spotify was slow, is not the end of the music. It is asked again,
       once fresh, and believed only after 45 seconds of the same. */
    if (b.tone === "off" && view !== "ctl" && band && band.tone !== "off") {
      var first0 = !offAt; if (first0) offAt = Date.now();
      if (Date.now() - offAt < GAP) { setTimeout(function () { ask(first0); }, first0 ? 5000 : 12000); return; }
    }
    offAt = 0;
    /* Skip and one back stay busy until the song has changed, or 4 seconds
       (the review, 2026-11-16: a second OK a moment later skipped again). */
    if (skipHold && (songId(b) !== skipHold.id || Date.now() >= skipHold.until)) skipHold = null;
    all("[data-t]").forEach(function (t) {
      var d = t.getAttribute("data-do");
      if (skipHold && /^h?(next|prev)$/.test(d || "")) return;
      t.removeAttribute("aria-busy");
    });
    /* A press on its way: its line stays until the music shows it. */
    if (pending && (songId(b) !== pending.id || Date.now() >= pending.until)) {
      if (sayEl.textContent === pending.text) say("");
      pending = null;
    }
    anchor(b, Date.now()); band = b;
    draw();
    all(".tile[data-k]").forEach(function (t) {
      var was = t.classList.contains("lit");
      t.classList.toggle("lit", a.lit != null && Number(t.getAttribute("data-k")) === Number(a.lit));
      if (!was && t.classList.contains("lit")) tslide(t.querySelector(".tsub"));
    });
    all(".room[data-room]").forEach(function (r) {
      r.classList.toggle("on", !!(a.rooms && a.rooms[r.getAttribute("data-room")]));
    });
    /* The rooms view: the room shown, and the rooms with music. */
    all(".rroom").forEach(function (r) {
      if (!r.classList.contains("here")) set(r.querySelector(".mst"), a.rooms && a.rooms[r.getAttribute("data-room")] ? "Playing" : "");
    });
    /* Music just started (a tile, a program from the Shelf), or back after
       the display left by itself: its cover, as soon as it plays. */
    if (wantDis && b.tone === "live" && view === "ctl" && sayEl.hidden) { wantDis = false; open("dis"); }
  }
  /* BACK IN THE FMWAX TV APP (the owner, 2026-11-19: "the back arrow from
     the room page ... doesn't go back"): the app asks here first; a view
     open (the rooms, Move, About, the voice help, the song page) closes as
     Escape closes it, and only on the buttons does Back leave the page. */
  window.fmwaxBack = function () {
    if (view === "ctl") return false;
    touched = Date.now(); open(view === "dis" ? "ctl" : "back");
    return true;
  };
  /* THE DISPLAY BY ITSELF, the house's clock, the night's dim, the shift. */
  var DRIFT = [[0, 0], [.25, .125], [0, .25], [-.25, .125]];
  function auto() {
    var idle = Date.now() - touched, tone = band ? band.tone : "off";
    if (view === "ctl" && tone === "live" && idle >= SHOW && sayEl.hidden) open("dis");
    else if (view === "dis" && !look(band)) open("ctl");
    var s = clock ? (clock.s + (Date.now() - clock.got) / 1000) % 86400 : null, ck = q(".dclock");
    show(ck, s !== null);
    if (s !== null) { var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; set(ck, (h % 12 || 12) + ":" + ("0" + m).slice(-2)); }
    dis.classList.toggle("dimmed", view === "dis" && s !== null && (s >= 79200 || s < 25200) && idle >= SHOW);
    var d = DRIFT[Math.floor(Date.now() / 120000) % 4];
    q(".dwrap").style.transform = view === "dis" ? "translate(" + d[0] + "rem," + d[1] + "rem)" : "";
  }
  function plan() {
    clearTimeout(timer); timer = null;
    if (document.visibilityState !== "visible") return;
    var idle = Date.now() - touched;
    /* Every ten seconds while a look costs Spotify nothing (the helper reads
       the speakers every ten): a song skipped in the Spotify app shows here
       within about ten seconds, not thirty (the owner, 2026-11-15). */
    var d = rest ? REST : cheap ? CHEAP : idle < IDLE ? EVERY : idle < LONG ? REST : SLOW;
    if (!rest && band && band.tone === "live" && band.pos) {
      /* Once, a moment after the song should have ended. A song already
         at its end by this clock (an answer that did not move on) waits
         for the usual look, or this would ask every few seconds. */
      var left = band.pos.of - where() + 2000;
      if (left > 4000 && left < d) d = left;
    }
    /* A PRESS ON ITS WAY IS LOOKED FOR EVERY 3 SECONDS until the music shows
       it (the owner, 2026-11-16: Radio Paradise on 12 played well before the
       song page came: a station is seen through the home helper, which reads
       the speakers every 10 seconds (3 since the same night), and the page's next look was 30 seconds
       or more away). */
    if (pending && Date.now() < pending.until) d = Math.min(d, 3000);
    timer = setTimeout(function () { ask(false); }, d);
  }
  function ask(fresh) {
    if (busy || !room) return;
    busy = true;
    var ctl = window.AbortController ? new AbortController() : null;
    var cut = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
    function end() { clearTimeout(cut); busy = false; plan(); }
    /* THE HOUSE OUT OF REACH (the review, 2026-11-16: a Wi-Fi drop left
       an old song up with nothing said): after two looks that failed, a
       line says so until the next one that answers. */
    function lost() {
      fails += 1;
      if (fails >= 2 && !lostSaid) { lostSaid = "The house can't be reached just now. The screen catches up when it can."; say(lostSaid, true); }
      end();
    }
    fetch(base + "/tv/now?room=" + encodeURIComponent(room) + (fresh ? "&fresh=1" : ""), ctl ? { cache: "no-store", signal: ctl.signal } : { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (a) {
        if (!a) { lost(); return; }
        fails = 0;
        if (lostSaid) { if (sayEl.textContent === lostSaid) say(""); lostSaid = ""; }
        paint(a); end();
      })
      .catch(lost);
  }
  window.addEventListener("resize", function () { pages(); slides(); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") { clearTimeout(timer); timer = null; return; }
    touched = Date.now(); ask(false);
  });
  ["pointerdown", "keydown", "mousemove"].forEach(function (type) {
    window.addEventListener(type, function () {
      var resting = type !== "mousemove" && !cheap && Date.now() - touched >= IDLE;
      touched = Date.now(); wantDis = false;
      dis.classList.remove("dimmed");
      if (resting) ask(false);
    }, { passive: true });
  });
  /* PAUSE, PLAY, SKIP AND BACK: the transport route the app's own bar uses. */
  var NO = { gone: "Spotify is not playing there any more.", throttled: "Spotify is limiting the house for a while, so this cannot be sent now.",
    "helper-off": "The home helper is not connected.", timeout: "The home helper did not answer. Try again.",
    unreachable: "The home helper could not reach the speaker.", "not-wiim": "That speaker is not a WiiM." };
  var HEAD = { accept: "application/json", "content-type": "application/x-www-form-urlencoded" };
  function send(btn) {
    var what = btn.getAttribute("data-do"), dev = btn.getAttribute("data-device"), n = btn.getAttribute("data-btn");
    if (!what || !dev || btn.getAttribute("aria-busy") === "true") return;
    btn.setAttribute("aria-busy", "true"); say("");
    var body = "do=" + enc(what) + "&device=" + enc(dev) + (n ? "&btn=" + enc(n) : "");
    fetch(base + "/wiim/transport", { method: "POST", cache: "no-store", body: body, headers: HEAD })
      .then(function (r) { return r.json(); })
      .then(function (out) {
        if (!out || !out.ok) {
          btn.removeAttribute("aria-busy");
          say((out && (NO[out.code] || out.why)) || "That did not work. Try again.");
          ask(true); return;
        }
        if (!/^h?(next|prev)$/.test(what)) hold = { until: Date.now() + 3900, live: what !== "pause" && what !== "hpause" };
        else {
          skipHold = { until: Date.now() + 4000, id: songId(band) };
          all('[data-do="' + what + '"]').forEach(function (x) { x.setAttribute("aria-busy", "true"); });
          setTimeout(function () {
            if (skipHold && Date.now() >= skipHold.until) { skipHold = null; all("[data-t]").forEach(function (t) { t.removeAttribute("aria-busy"); }); }
          }, 4100);
        }
        setTimeout(function () { ask(true); }, 1500);
        setTimeout(function () { ask(true); }, 4000);
      })
      .catch(function () { btn.removeAttribute("aria-busy"); say("The house could not be reached. Try again."); });
  }
  /* MOVE: Spotify's own transfer to the room pressed; then this screen shows
     that room. */
  function moveTo(btn) {
    var name = btn.getAttribute("data-name"), slug = btn.getAttribute("data-slug"), msay = q(".msay");
    if (!name || btn.getAttribute("aria-busy") === "true") return;
    btn.setAttribute("aria-busy", "true"); set(btn.querySelector(".mst"), "Moving\\u2026"); show(msay, false);
    function no(t) { btn.removeAttribute("aria-busy"); set(btn.querySelector(".mst"), ""); set(msay, t); show(msay, true); }
    fetch(base + "/wiim/transport", { method: "POST", cache: "no-store", body: "do=move&device=" + enc(name), headers: HEAD })
      .then(function (r) { return r.json(); })
      .then(function (out) {
        if (out && (out.ok || out.code === "here")) { location.replace(base + "/tv?room=" + enc(slug) + "&mv=1"); return; }
        if (out && out.code === "quiet") { open("ctl"); say("Nothing is playing on Spotify any more, so there was nothing to move."); ask(true); return; }
        var kind = btn.getAttribute("data-kind");
        no(out && out.code === "asleep" ? "The " + name + (kind === "phone" ? " is not in Spotify\u2019s list: a phone is only there while its Spotify app is open. Open Spotify on it and play anything for a moment, then try again."
            : kind === "wiim" ? " did not take it. It has signed off Spotify after sitting idle: press a Spotify preset on its remote, then try again."
            : " did not take it. An Echo that has sat quiet may need waking: say \u201cAlexa, play Spotify\u201d to it, then try again.")
          : out && out.code === "throttled" ? "Spotify is limiting the house for a while, so nothing was moved."
          : "Spotify refused to move the music to the " + name + ".");
      })
      .catch(function () { no("The house could not be reached. Try again."); });
  }
  main.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-t],[data-open],[data-page],[data-more],.mroom") : null;
    if (!t || t.disabled) return;
    if (t.hasAttribute("data-page")) turn(Number(t.getAttribute("data-page")));
    else if (t.hasAttribute("data-more")) askMore(t);
    else if (t.hasAttribute("data-t")) send(t);
    else if (t.hasAttribute("data-open")) open(t.getAttribute("data-open"));
    else moveTo(t);
  });
  /* A TILE: the form goes as it is; the tile says so, and a second press
     while it is on its way does nothing. */
  main.addEventListener("submit", function (ev) {
    var f = ev.target, b = f && f.querySelector ? f.querySelector("button.tile") : null;
    if (!b) return;
    if (f.getAttribute("data-sent")) { ev.preventDefault(); return; }
    f.setAttribute("data-sent", "1");
    b.classList.add("busy"); set(b.querySelector(".tsub"), b.getAttribute("data-busy") || "…");
  });
  /* Back from the browser's own Back, a sent form is a form again. */
  window.addEventListener("pageshow", function (ev) {
    /* The TV page names no DJ for TV Bro's voice search, also when the
       remote's Back brings it from the browser's history (tvdj.js). */
    try { document.cookie = "tvdj=; Path=/; Max-Age=0; SameSite=Lax; Secure"; } catch (e) {}
    if (!ev.persisted) return;
    all("form[data-sent]").forEach(function (f) {
      f.removeAttribute("data-sent");
      var b = f.querySelector("button.tile"), s = b && b.querySelector(".tsub");
      if (b) b.classList.remove("busy"); if (s) s.textContent = s.getAttribute("data-sub") || "";
    });
  });
  document.addEventListener("keydown", function (ev) {
    aboutTouch = Date.now();
    var mb = first(all("[data-t=main]")), sb = first(all("[data-t=skip]"));
    if (ev.key === "MediaPlayPause" || ev.key === "MediaPlay" || ev.key === "MediaPause") { if (mb) send(mb); return; }
    if (ev.key === "MediaTrackNext") { if (sb) send(sb); return; }
    if (ev.key === "Escape" && view !== "ctl") { touched = Date.now(); open(view === "dis" ? "ctl" : "back"); return; }
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    /* About this song: up and down scroll it (Page up and Page down turn it). */
    if (view === "about" && (dir === "up" || dir === "down")) {
      tvScroll(dir === "down" ? 1 : -1, !!ev.repeat); ev.preventDefault(); return;
    }
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, start); }, 0);
  });
  /* WHERE THE REMOTE STARTS: the tile just pressed (back from its press),
     the control it was on before the page asked for itself again, the room
     just chosen, the tile that is playing, the first tile. AND WHICH VIEW:
     the display when music plays and the page was opened plainly (or it was
     showing before the page asked for itself again, or a program was just
     started from the Shelf); the controls otherwise. */
  (function () {
    var qs = location.search, el = null, k = (qs.match(/[?&]k=(\\d{1,2})(?:&|$)/) || [])[1], f = null, keep = null;
    try { f = sessionStorage.getItem("tv:focus"); sessionStorage.removeItem("tv:focus"); keep = sessionStorage.getItem("tv:view"); sessionStorage.removeItem("tv:view"); } catch (e) {}
    if (k) el = q('.tile[data-f="k:' + k + '"]');
    if (!el && f && /^[a-z0-9:-]+$/.test(f)) el = q('[data-f="' + f + '"]');
    if (!el && /[?&]rooms=all/.test(qs)) el = q(".room.pick") || q(".room");
    if (!el && /[?&]room=/.test(qs)) el = q(".room.pick");
    if (!seen(el)) el = home();
    if (el) el.focus();
    draw();
    /* THE SONG FIRST (the owner, 2026-11-15: "just start with the song page
       not the preset page"). The buttons only when the remote was steering:
       a room just chosen, every room asked for, words to read in the band (a press
       that did not land, a turn of the dials), or the buttons were showing
       before the page asked for itself again. */
    /* A voice request's answer is read over the song page (vs=): it does
       not send the screen to the buttons. */
    var voiced = /[?&]vs=/.test(qs);
    var steering = keep === "ctl" || (!sayEl.hidden && !voiced) || /[?&](rooms=all|tn=)/.test(qs) || (!voiced && keep !== "dis" && /^\\?room=[^&]*$/.test(qs));
    if (/[?&]v=dis(?:&|$)/.test(qs)) steering = false;
    if (!steering) { if (band && band.tone !== "off") open("dis"); else wantDis = /[?&](k|sp|mv)=/.test(qs); }
    /* Back from a press: Spotify's own answer comes a moment after its yes,
       so two more looks, the first a fresh read. */
    if (k || /[?&](sp|mv|tn)=/.test(qs)) { setTimeout(function () { ask(true); }, 2500); setTimeout(function () { ask(false); }, 8000); }
    /* A PRESS THAT WENT THROUGH, NOT YET HEARD (the review, 2026-11-16: the
       old song showed as if the press had failed): a line says it is on its
       way until the song changes, or 25 seconds, and the page looks every 3. */
    var started = sayEl.hidden ? (k ? "Starting preset " + k + "\u2026" : /[?&]sp=(ok|sent)(?:&|$)/.test(qs) ? "Starting the program\u2026" : /[?&]mv=/.test(qs) ? "Moving the music here\u2026" : "") : "";
    if (started) { pending = { until: Date.now() + 25000, id: songId(band), text: started }; say(started, true); }
    /* The address without the press's outcome, so a reload does not say it twice. */
    if (/[?&](hk|kp|sp|mv|tn|v|vs|vx)=/.test(qs) && window.history && history.replaceState) history.replaceState(null, "", base + "/tv?room=" + encodeURIComponent(room));
  })();
  auto(); setInterval(auto, 5000); plan();
})();
</script>`;

// WHICH PAGE THIS IS: a short mark of the page's own code, so a page left
// open on a TV sees a deploy that changed it and asks for itself again.
export const TV_BUILD = (() => {
  const src = TV_CSS + TV_SCRIPT + renderTv.toString() + viewsHtml.toString() + bandHtml.toString();
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
})();
