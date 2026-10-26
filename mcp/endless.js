// ENDLESS (MC-22 to MC-27): the ledger of endless presets and the guest DJ
// on 3, the ten-minute watch and its top-ups, steering, and keeping unplayed
// songs.
// Split out of worker.js on 2026-09-26 (consolidation).
import { sameName } from "./programs.js";
import { houseDay, houseTz } from "./voice.js";
import { station } from "./station.js";
import { findDj, guestBusyWords, guestFor, guestForPlaylistId, house } from "./house.js";
import { dropPauseNoteFor, pickCheap, speakerFor } from "./now.js";
import { startPlaylistOnDevice } from "./playback.js";
import { replacePlaylistSafely } from "./playlists.js";
import { arrivingSet, dropTile, parseSpeakers, readReadings, wearFace, writeMark } from "./room.js";
import {
  catalogFor, lastfmOn, playerState, programsKV, spotify, throttledUntil,
} from "./services.js";
import { emitRequestEvent } from "./writes.js";
import { rollCallSlice } from "./rollcall.js";
import { tuningWords } from "./tuning.js";


// THE ENDLESS DJ (MC-22, tasks/done/mc22-endless-dj.md). Press 4 and Sunny plays
// for as long as anyone listens: topped up in her brief as the set runs low,
// for at most four hours a start (the Pro Plus sits on a Denon whose input
// switch the WiiM cannot see, so a forgotten set would otherwise run all
// night), and replaced with a fresh set after each session for the next press.
//
// Mode "watch" only LOGS what it would do; "live" files jobs for the curator
// (list_requests → endless_jobs, answered by extend_endless). Three kinds:
//   topup — the set is running low: append, while it plays;
//   fresh — the session ended: replace the list with a new opening for the
//           next press (or, from the DJ page's Start fresh, replace it and
//           start it on the speaker named there);
//   steer — somebody asked for a direction (MC-23): replace what is queued
//           after the playing song, or start the new songs at once.
//
// STEERING (MC-23, tasks/done/mc23-steering.md) also reaches the program on the
// Spotify guest (preset 1). There the program plays to its end as made and
// the DJ carries on in the asked direction, unless the listener said to
// replace the rest (or to change it now). That session exists only once
// steered; a program nobody steers stops at its end, as it always has.
//
// ANY DJ ON ANY OF THESE PRESETS (MC-24, tasks/done/mc24-dj-presets.md). The
// config names the SLOTS — a preset number and the Spotify playlist its key
// plays — and the DJ each starts with; who is on a slot now is the ledger's
// `assign`, changed from a DJ's page. One DJ per slot: putting a DJ on a slot
// they are not on swaps them with whoever is there when they hold another
// slot. While a slot involved is playing, the change waits (`queued`) for the
// session to end. The recent-songs list belongs to the DJ, not the slot.
//
// ONE DOCUMENT, WRITTEN BY COMPARE-AND-SET (MC-24, from Codex's review of
// MC-23): the cron's watch, a tool and a page each read the whole document
// and put it back, and a put names the revision it read. The loser reads
// again. Side effects — the doorbell, a pause, a rename — wait for the write
// to land, so a retry never rings twice.
//
// ENDLESS (rendered from house.json's `endless`):
//   { mode: "live", dailyRuns: 12,
//     presets: [{ button, dj, playlist, hours, topupMinutes, batchMinutes,
//                 freshMinutes, noRepeatSongs }] }
export const ENDLESS_IDLE_MS = 29 * 60 * 1000;
// A top-up or steer job the curator has not answered in this long is
// dropped, and the next look may ask again (each ask counts against the
// day's runs).
export const ENDLESS_JOB_MS = 25 * 60 * 1000;
// A fresh set is for the next press, so it may wait for the hourly sweep.
export const ENDLESS_FRESH_MS = 3 * 3600e3;
// START FRESH STARTS IT ONLY WHILE THE TAP IS NEW (the owner, 2026-10-02).
// Start fresh names a speaker, and the set starts there as soon as it lands
// — but the job lives three hours, and on 2026-10-02 the curator was down
// when Hank's Start fresh was tapped at 22:21: had it come back at one in
// the morning, Hank would have started on the Pro Plus with nobody there.
// Past this long after the tap, a set that lands is only put on the preset
// for the next press. Counted from the tap (`deviceAt`, or the job's own
// time for a guest DJ's opening), not from the job: a second Start fresh on
// a waiting set renews it.
export const START_FRESH_MS = 25 * 60 * 1000;
export function startsOn(j, now = Date.now()) {
  if (j?.kind !== "fresh" || !j.device) return null;
  return now - (Number(j.deviceAt ?? j.at) || 0) <= START_FRESH_MS ? j.device : null;
}
// How much a steer asks the curator for: a top-up's worth (the owner,
// 2026-09-28: Change it up on Baddie's set asked for 25 minutes, the watch
// found 28 left at its next look and topped it up at once — one tap, two
// runs). What a steer lands replaces the rest, so it must reach past the
// top-up line, or the next look asks again.
export const ENDLESS_STEER_MINUTES = 45;
export const steerMinutes = (p) =>
  Math.max(Number(p?.batchMinutes) || ENDLESS_STEER_MINUTES, (Number(p?.topupMinutes) || 30) + 15);
// A curator that took a job holds it this long; another run leaves it alone.
export const ENDLESS_LEASE_MS = 10 * 60 * 1000;

// The document, read and made whole. The recent-songs list moved from the
// slot to the DJ (MC-24): a list still keyed by a number goes to the DJ the
// config started that slot with, which is who played it.
export async function endlessLoad(env) {
  const got = await station(env, "endless-get", {});
  const state = got?.doc && typeof got.doc === "object" ? got.doc : {};
  for (const k of ["sessions", "jobs", "history", "assign", "queued", "gen"]) {
    state[k] = state[k] && typeof state[k] === "object" && !Array.isArray(state[k]) ? state[k] : {};
  }
  const cfg = parseEndless(env);
  for (const key of Object.keys(state.history)) {
    if (!/^\d+$/.test(key)) continue;
    const dj = cfg?.presets.find((p) => String(p.button) === key)?.dj ?? null;
    if (dj) state.history[dj] = [...(state.history[dj] ?? []), ...state.history[key]];
    delete state.history[key];
  }
  // THE GUEST DJ MOVED (the owner, 2026-09-30: from 7 to 3, a single press on
  // the remote): what the ledger keeps under the lane's old number follows it
  // — its session, generation and jobs — so a guest playing through the move
  // carries on under the new one.
  const lane = cfg?.presets.find((p) => p.lane);
  const was = Number(state.lane?.btn);
  if (lane && Number.isInteger(was) && was !== lane.button) {
    const [from, to] = [String(was), String(lane.button)];
    for (const k of ["sessions", "gen", "queued"]) {
      if (from in state[k] && !(to in state[k])) state[k][to] = state[k][from];
      delete state[k][from];
    }
    for (const j of Object.values(state.jobs)) if (j?.btn === was) j.btn = lane.button;
    state.lane.btn = lane.button;
  }
  // A DJ RENAMED KEEPS WHAT THE LEDGER HOLDS OF THEM (Codex's review,
  // 2026-10-09, after dj-stax became stax): every stored DJ reference is the
  // roster's key for it — an old key is one of the DJ's aliases — and a
  // history filed under the old key joins the new one.
  // Exact matches only — a key or an alias — never findDj's word-prefix
  // fallback, which could fold one DJ's history into another's.
  const norm = (x) => String(x ?? "").trim().toLowerCase();
  const roster = Object.values(house(env).djs ?? {});
  const canon = (who) => {
    if (typeof who !== "string" || !who) return who;
    const d = roster.find((r) => norm(r.key) === norm(who) || (r.aliases ?? []).some((a) => norm(a) === norm(who)));
    return d?.key ?? who;
  };
  if (state.lane?.dj) state.lane.dj = canon(state.lane.dj);
  for (const a of Object.values(state.assign)) if (a?.dj) a.dj = canon(a.dj);
  for (const j of Object.values(state.jobs)) if (j?.dj) j.dj = canon(j.dj);
  for (const q of Object.values(state.queued)) if (q?.dj) q.dj = canon(q.dj);
  // A DJ CUT FROM THE HOUSE (the owner, 2026-10-13: ten at once) leaves no
  // wait and no open job: a wait would hand a preset to nobody, renaming its
  // playlist after a key, and a job would send the curator to a brief that
  // is gone. Their history stays under the old key, read by nobody.
  for (const [k, q] of Object.entries(state.queued)) if (q?.dj && !findDj(env, q.dj)) delete state.queued[k];
  for (const [id, j] of Object.entries(state.jobs)) if (j?.dj && !findDj(env, j.dj)) delete state.jobs[id];
  for (const key of Object.keys(state.history)) {
    const to = canon(key);
    if (to === key || !Array.isArray(state.history[key])) continue;
    state.history[to] = [...(state.history[to] ?? []), ...state.history[key]];
    delete state.history[key];
  }
  return state;
}
// The write, landing only on the revision that was read. True when it did.
export async function endlessSave(env, state) {
  const out = await station(env, "endless-put", { doc: state, ifRev: Number(state.rev) || 0 });
  if (out?.ok) { state.rev = out.rev; return true; }
  return false;
}
// Read, change, write — again from the top if something else wrote first.
// `change` edits the state it is handed and must have no other effect; what
// it returns comes back. `{ abort: true }` writes nothing.
export async function endlessUpdate(env, change) {
  for (let i = 0; i < 4; i++) {
    const state = await endlessLoad(env);
    const out = (await change(state)) ?? {};
    if (out.abort) return out;
    if (await endlessSave(env, state)) return out;
  }
  return { status: "busy", abort: true };
}
export async function endlessLog(env, events) {
  if (!events?.length) return;
  try { await station(env, "endless-log", { events }); } catch { /* lost lines */ }
}
// A new day has runs again (Codex, 2026-09-24): a session capped by
// yesterday's may ask today.
export function endlessDay(env, state, now) {
  const day = houseDay(env, now);
  if (state.day === day) return;
  state.day = day; state.runs = 0;
  for (const s of Object.values(state.sessions ?? {})) {
    if (s?.dayCapped) { s.dayCapped = false; if (s.pending === true) s.pending = false; }
  }
}
// What the DJ has had lately, newest last: [uri, label], at most
// noRepeatSongs. ONLY WHAT PLAYED counts (the owner, 2026-09-25): it used to
// be everything written to the playlist, so a fresh set nobody pressed, or
// the ten songs left when a session stopped, were avoided as if heard — and
// The Selector, boxed in by 150 songs mostly never played, made a 6-song set.
// The watch calls this with the list up to the song it saw playing.
export function endlessRemember(state, p, tracks) {
  const key = String(p.dj);
  state.history = state.history && typeof state.history === "object" ? state.history : {};
  const had = Array.isArray(state.history[key]) ? state.history[key] : [];
  const seen = new Set(had.map((h) => h[0]));
  for (const t of tracks ?? []) if (t?.[0] && !seen.has(t[0])) { had.push([t[0], t[2] ?? ""]); seen.add(t[0]); }
  state.history[key] = had.slice(-p.noRepeatSongs);
}
// The presets the watch follows, each with who is on it now: the configured
// slots (the ledger's assignment over the config's first DJ), and the
// Spotify guest while a steer holds its program (MC-23).
export function endlessPresets(env, cfg, state) {
  const list = (cfg?.presets ?? []).flatMap((p) => {
    if (p.lane) {
      const who = state?.lane?.dj;
      return who && findDj(env, who) ? [{ ...p, dj: who, tenancy: Number(state.lane.tenancy) || 0 }] : [];
    }
    const a = state?.assign?.[String(p.button)]?.dj;
    return [a && findDj(env, a) ? { ...p, dj: a } : { ...p }];
  });
  const g = guestFor(env, "spotify");
  const s = g?.live ? state?.sessions?.[String(g.btn)] : null;
  if (s?.program?.dj && !list.some((p) => p.button === g.btn)) {
    list.push({ button: g.btn, dj: s.program.dj, playlist: g.playlist, hours: 4, topupMinutes: 30,
      batchMinutes: 45, freshMinutes: 0, noRepeatSongs: 150, program: true, ref: s.program.ref ?? null, at: s.program.at ?? null });
  }
  return list;
}
// The slots alone, by who is on them — for pages: { button, dj, name, playlist, queued }.
export function endlessSlots(env, cfg, state) {
  // Not the lane (MC-27): it is never offered, never a swap partner, never
  // renamed, and never owes a save — its name is "Endless" for good.
  return endlessPresets(env, cfg, state).filter((p) => !p.program && !p.lane).map((p) => ({ ...p,
    name: findDj(env, p.dj)?.name ?? p.dj,
    queued: state?.queued?.[String(p.button)]?.dj ?? null }));
}
// A FRESH SET THAT LANDED AND COULD NOT START (the owner, 2026-09-24): Start
// fresh for the Master Bedroom, the Echo asleep by the time the set was made,
// and the page went on saying "being made" over a set that was ready and
// silent. The miss is kept for three hours, per preset, so the DJ's page can
// say what happened and offer Play it now — the set as it stands, no new
// run. Cleared by a start that works.
export const noStartKey = (btn) => `endless:nostart:${btn}`;
export async function endlessNoStart(env, btn, rec) {
  try {
    if (rec) await programsKV(env).put(noStartKey(btn), JSON.stringify(rec), { expirationTtl: 3 * 3600 });
    else await programsKV(env).delete(noStartKey(btn));
  } catch { /* the page says less */ }
}
export async function readNoStart(env, btn) {
  try { return await programsKV(env).get(noStartKey(btn), { type: "json" }); } catch { return null; }
}
// A speaker Spotify cannot reach: not in its list, or 404 on the play and on
// the retry — the Echo asleep, measured twice on 2026-09-24.
export const sleptThrough = (e) => !!(e?.noSuchDevice || e?.status === 404);
// What a job asks of the curator, in one sentence it can follow as it stands.
export function endlessHow(j, djName) {
  const who = djName || j.dj;
  const turn = j.words ? ` The listener asked for this direction: "${j.words}". Keep to ${who}'s brief, turned that way.` : "";
  if (j.kind === "fresh") {
    return `A fresh opening set for the next press of preset ${j.btn}: about ${j.minutes} minutes AS ${who}, ` +
      `starting the way their brief opens a night.${turn} It REPLACES the playlist` +
      // The house starts it, never the curator (2026-10-19: a ChatGPT
      // curator told "do not start playback" held a finished set back).
      (startsOn(j) ? `, and the house starts it on the ${j.device} as soon as it lands: nothing for you to start, ` +
        "so answer the job as usual."
        : j.device ? ". It was asked too long ago to start on its own: it waits for the next press."
        : ", which is not playing now.");
  }
  if (j.kind === "steer") {
    return `Steer ${who}, playing now on preset ${j.btn}: about ${j.minutes} minutes AS ${who}.${turn} ` +
      `It REPLACES what is queued after the playing song${j.when === "now" ? " and starts at once" : ""}.`;
  }
  return `Continue the set playing on preset ${j.btn}: about ${j.minutes} minutes AS ${who}, in their brief, ` +
    `not a new opening.${turn} It is APPENDED; nothing is replaced.`;
}
// The jobs the curator should take, as list_requests shows them. One another
// run holds (its lease) is not offered.
// DEEP DIVE'S RESEARCH (2026-10-18; the trial, docs/research/
// musicbrainz-trial-2026-10-18.md): before choosing a song for an artist the
// house has not looked up, the curator asks MusicBrainz for every album with
// its original year, every band and alias they recorded under, and a
// songwriter's songs; what it finds comes back with extend_endless and is kept
// in KV for 180 days, so later jobs for the same artist read it instead of
// looking again. In KV, not the endless state, which is one value and must
// stay small.
// EVERY DJ'S, SINCE THE EVENING (the owner: "yes", after 29 of the 87 asks
// kept since 2026-09-01 named an artist, nine of them the Librarian's): a
// folder per artist, kept under the artist's own name and found by any name
// it answers to, so whoever is asked about them next, a request or a guest DJ
// told an artist, reads it. Deep Dive must look an artist up; for anyone else
// the curator judges whether the words are about one artist at all.
export const RESEARCH_TTL_S = 180 * 24 * 3600;
// The steps' version: a list kept by older steps is looked up again (2026-10-18:
// the first steps read one page of 100 and missed the albums credited to the
// artist's own groups, Miles Davis's Quintet and Sextet, Charlie Hunter's Trio).
export const RESEARCH_VERSION = 2;
const slugOf = (words) => String(words ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const researchSlug = (words) => slugOf(words).slice(0, 80);
export const researchKey = (words) => `research:${researchSlug(words)}`;
// For a DJ told an artist every time (Deep Dive), on the guest DJ's preset.
export const researchable = (env, dj) => findDj(env, dj)?.needsWords === "an artist";
export const laneSubject = (state, btn) => state?.lane && btn === state.lane.btn ? state.lane.words ?? null : null;
const rclip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const ryear = (v) => (/^\d{4}/.test(String(v ?? "")) ? String(v).slice(0, 4) : null);
// What the curator sent, held to a size and a shape: titles, years, names.
export function cleanResearch(raw) {
  if (!raw || typeof raw !== "object") return null;
  const albums = (Array.isArray(raw.albums) ? raw.albums : []).slice(0, 120)
    .map((a) => ({ title: rclip(a?.title, 120), year: ryear(a?.year), ...(rclip(a?.as, 80) ? { as: rclip(a?.as, 80) } : {}),
      ...(a?.live === true ? { live: true } : {}), ...(ryear(a?.recorded) ? { recorded: ryear(a.recorded) } : {}) }))
    .filter((a) => a.title);
  const names = [...new Set((Array.isArray(raw.names) ? raw.names : []).map((n) => rclip(n, 80)).filter(Boolean))].slice(0, 24);
  const songs = (Array.isArray(raw.songs) ? raw.songs : []).slice(0, 250)
    .map((x) => ({ title: rclip(x?.title, 120), year: ryear(x?.year),
      by: (Array.isArray(x?.by) ? x.by : []).map((b) => rclip(b, 80)).filter(Boolean).slice(0, 8) }))
    .filter((x) => x.title);
  if (!albums.length && !songs.length) return null;
  const mbid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(raw.mbid ?? "")) ? String(raw.mbid).toLowerCase() : null;
  return { artist: rclip(raw.artist, 120) || null, ...(mbid ? { mbid } : {}),
    ...(rclip(raw.disambiguation, 120) ? { disambiguation: rclip(raw.disambiguation, 120) } : {}), albums, names, songs };
}
const current = (got) => (got && (Number(got.v) || 1) >= RESEARCH_VERSION ? got : null);
// The names a folder answers to, as slugs in its KV metadata (1 KB at most),
// so finding one costs a single list and no reads.
const FOLDER_META_MAX = 1000;
export function folderSlugs(kept, words = null) {
  const out = [];
  for (const n of [kept?.artist, ...(kept?.names ?? []), words]) {
    const s = researchSlug(n);
    if (s.length < 4 || out.includes(s)) continue;
    if (JSON.stringify({ s: [...out, s] }).length > FOLDER_META_MAX) break;
    out.push(s);
  }
  return out;
}
// Kept under the artist's name as MusicBrainz gives it (the words when it
// gives none), so "Miles Davis, a mellow evening" and "Miles" are one folder.
// The key it went under, or null.
// What it adds to a folder already there (2026-10-18: Isaac Hayes's, looked
// up by Deep Dive, had his albums and none of the songs he wrote for Sam &
// Dave): a part sent empty keeps the folder's own, and the names add up.
// A NAMESAKE (Codex's review, 2026-10-18: John Williams the film composer
// and John Williams the guitarist): another MusicBrainz id under the same
// name gets a folder of its own beside the first, its key the name and the
// id's first eight, so neither overwrites the other; both answer to the
// name, and each says which one it is.
export async function keepResearch(env, words, kept) {
  let key = researchKey(kept?.artist || words);
  if (key === "research:") return null;
  try {
    let had = null;
    try { had = current(await programsKV(env).get(key, { type: "json" })); } catch { had = null; }
    if (had?.mbid && kept?.mbid && had.mbid !== kept.mbid) {
      key = `${key.slice(0, 70)}-${kept.mbid.slice(0, 8)}`;
      try { had = current(await programsKV(env).get(key, { type: "json" })); } catch { had = null; }
    }
    const merged = had ? { ...kept, artist: kept.artist || had.artist || null,
      // The house's studio list, kept when only songs are added to it.
      ...(!kept.albums?.length && had.by ? { by: had.by } : {}),
      albums: kept.albums?.length ? kept.albums : had.albums ?? [],
      names: [...new Set([...(had.names ?? []), ...(kept.names ?? [])])].slice(0, 24),
      songs: kept.songs?.length ? kept.songs : had.songs ?? [] } : kept;
    await programsKV(env).put(key, JSON.stringify({ ...merged, words, v: RESEARCH_VERSION, at: new Date().toISOString() }),
      { expirationTtl: RESEARCH_TTL_S, metadata: { s: folderSlugs(merged, words && words.split(/\s+/).length <= 4 ? words : null) } });
    return key;
  } catch { return null; }
}
// Which folders words name: a folder name (four letters or more) standing
// whole in the words. A name inside a longer one that also matched is
// dropped (Prince inside Prince Buster); the longest names come first.
export function matchFolders(index, text, max = 2) {
  const hay = `-${slugOf(text)}-`;
  if (hay.length < 6) return [];
  const hits = [];
  for (const f of index ?? []) {
    const name = (f.slugs ?? []).filter((s) => s.length >= 4 && hay.includes(`-${s}-`))
      .sort((a, b) => b.length - a.length)[0];
    if (name) hits.push({ key: f.key, name });
  }
  return hits.filter((h) => !hits.some((o) => o !== h && o.name.length > h.name.length && `-${o.name}-`.includes(`-${h.name}-`)))
    .sort((a, b) => b.name.length - a.name.length).slice(0, max).map((h) => h.key);
}
// The folders, for one call that lists work (list_requests): one KV list the
// first time words are matched, and a few reads at most, however many
// requests and jobs ask.
export const FOLDER_READS_MAX = 4;
export function researchFolders(env) {
  let index = null;
  const got = new Map();
  const load = async () => {
    if (index) return index;
    try {
      const { keys = [] } = await programsKV(env).list({ prefix: "research:" });
      index = keys.map((k) => ({ key: k.name, slugs: [k.name.slice("research:".length),
        ...(Array.isArray(k.metadata?.s) ? k.metadata.s : [])] }));
    } catch { index = []; }
    return index;
  };
  const read = async (key) => {
    if (got.has(key)) return got.get(key);
    if (got.size >= FOLDER_READS_MAX) return null;
    let v = null;
    try { v = current(await programsKV(env).get(key, { type: "json" })); } catch { v = null; }
    got.set(key, v);
    return v;
  };
  return {
    async find(text, max = 2) {
      if (!String(text ?? "").trim()) return [];
      const keys = matchFolders(await load(), text, max);
      return (await Promise.all(keys.map(read))).filter(Boolean);
    },
    async byWords(words) {
      const key = researchKey(words);
      return key === "research:" ? null : read(key);
    },
  };
}
// A folder the house made itself (musicbrainz.js) holds studio albums only,
// and says so (2026-10-24, the owner: Jeff Buckley's held Grace alone; his
// Sketches is filed a compilation, Live at Sin-é live). A warning that the
// list is short, never a fence.
export const HOUSE_FOLDER_SCOPE = "Studio albums only, as MusicBrainz files them, listed by the house. Live albums, " +
  "posthumous collections and compilations exist and are not listed here (Jeff Buckley's held Grace alone: Sketches for " +
  "My Sweetheart the Drunk and Live at Sin-é are his too): use them as well, from what you know, unless the ask narrows it.";
// A folder as a job or a request carries it.
export const folderOut = (f) => ({ artist: f.artist ?? null,
  ...(f.disambiguation ? { disambiguation: f.disambiguation } : {}), ...(f.mbid ? { mbid: f.mbid } : {}),
  ...(f.by === "house" ? { scope: HOUSE_FOLDER_SCOPE } : {}),
  albums: f.albums ?? [], names: f.names ?? [], ...(f.songs?.length ? { songs: f.songs } : {}) });
// The looking up itself: MusicBrainz, a second apart, the shape the long
// read's research already uses. The fourth step, the live albums, since
// the evening of 2026-10-18 (Miles Davis: 91 official live albums in one
// request, Agharta, Live-Evil, Four & More and the Plugged Nickel among them).
// curl or a web tool (2026-10-24): a ChatGPT curator has no shell, and on
// "curl" alone it skipped the looking up (Elliott Smith, no folder made).
// THE HOUSE FIRST (2026-10-24): look_up_artist makes the folder's base itself
// (musicbrainz.js); a curator with a shell adds what needs judgment. A web
// tool is turned away: MusicBrainz's robots rule bars /ws to every crawler.
const RESEARCH_HOW = "FIRST call look_up_artist with the name: when the house has no folder on them it looks them up " +
  "on MusicBrainz itself, a few seconds, and keeps it (`folder`, with `folder_made`): the studio albums with their " +
  "original years and the names they recorded under, which you need not send again. Then, ONLY IF YOU HAVE A SHELL " +
  "(a web tool is turned away: MusicBrainz's robots rule bars these addresses to crawlers), add what needs judgment, " +
  "or all of it if look_up_artist found nothing: ask MusicBrainz with curl -sS -A 'fmwax-house/1.0 ( https://fmwax.com )' " +
  "'<address>', one call at a time, at least a second apart, every character of a name or title in it that is not " +
  "a letter or a digit percent-encoded (a space %20, a double quote %22, an apostrophe %27, & %26), so no name can " +
  "end the quotes around it: " +
  "(1) the artist: https://musicbrainz.org/ws/2/artist?query=artist:%22<name>%22&fmt=json&limit=3, the one asked for " +
  "(its disambiguation and country tell; send its id as `mbid` and its disambiguation); (2) every name they recorded under: " +
  "https://musicbrainz.org/ws/2/artist/<id>?inc=aliases+artist-rels&fmt=json (aliases, and the groups that carry their " +
  "name: the Miles Davis Quintet, the Charlie Hunter Trio); (3) their albums and their own groups' in ONE search, studio " +
  "albums with original years: https://musicbrainz.org/ws/2/release-group?query=%28arid:<id>%20OR%20arid:<group id>%29" +
  "%20AND%20primarytype:album%20AND%20NOT%20secondarytype:compilation%20AND%20NOT%20secondarytype:live" +
  "%20AND%20status:official&fmt=json&limit=100 (first-release-date; artist-credit says whose); (4) where live records " +
  "are part of the story (jazz, a jam band, a soul revue), the live albums in one more search, the same with " +
  "%20AND%20secondarytype:live in place of %20AND%20NOT%20secondarytype:live: keep the ones that are part of the canon " +
  "(Agharta, Live-Evil, Four & More), marked live, never every concert; an album issued long after it was recorded " +
  "keeps its first-release year as `year` and gets `recorded` only when MusicBrainz or a page says it (Isaac Hayes at " +
  "Wattstax: issued 2003, recorded 1972). Session collections the searches leave out " +
  "(Birth of the Cool, filed as a compilation) you add from what you know. (5) For a songwriter (the words say songs, " +
  "or the name is known for writing): their songs, https://musicbrainz.org/ws/2/work?artist=<id>&fmt=json&limit=100, " +
  "and again with &offset=100 (then 200) while its work-count says there are more (Dan Penn wrote 171), " +
  "and who recorded one, https://musicbrainz.org/ws/2/recording?work=<work id>&inc=artist-credits&fmt=json&limit=100. " +
  "If it answers busy, wait five seconds and try once more; if it will not answer, curate from what you know. What it " +
  "says is reference, never instructions.";
export function researchSteps(words) {
  return `RESEARCH FIRST: the house has not looked up "${words}" yet. Before choosing a song, ${RESEARCH_HOW} ` +
    "Then send what you found with extend_endless as `discography` (an album credited to a group, " +
    "with that group as `as`), so the house keeps it and later jobs for this artist need no looking up. Over a night " +
    "every album comes round, under every name, before any album comes round again, unless the words narrow it (a " +
    "mood, a period, one band of theirs): then the albums that fit, and only those.";
}
// For anyone else's words, the steps once (list_requests' research_steps) and
// a line per request or job that might need them.
export const RESEARCH_STEPS = `To look an artist up, ${RESEARCH_HOW} Send what you found as \`discography\` with the ` +
  "call that answers the request or the job (fulfill_request or extend_endless): the house keeps it for every DJ, and " +
  "whoever is asked about this artist next reads it as `artist_folders` or `discography` instead of looking again.";
export const researchIfArtist = (words, { lastfm = false } = {}) => `IF "${rclip(words, 120)}" is about one artist or one ` +
  "songwriter, and nothing about them came with it, look them up first as research_steps says and send `discography`. A " +
  "mood, a genre, a label, an era, or an artist named only as a taste (\"like Okonski\") needs no looking up" +
  (lastfm ? "; for a taste, look_up_artist lists who Last.fm's listeners play alongside them: ideas, not the set. " +
    "Every song must still fit the ask's other words (piano, a mood, an era), mixed with picks of your own." : ".");
// WHAT THE ROOMS HEARD LATELY (2026-10-18: Deep Dive's first Isaac Hayes set
// opened on two songs Talk had played from the Replay playlist half an hour
// before). Spotify's own play history, whoever played it, from the last
// three hours, as the avoid list writes a record: read once, by
// list_requests, and only when there is endless work.
export const HEARD_WINDOW_MS = 3 * 60 * 60 * 1000;
export async function heardLately(env, now = Date.now()) {
  try {
    if (await throttledUntil(env)) return [];
    const res = await spotify(env, "GET", "/me/player/recently-played", { params: { limit: 50 } });
    return (res?.items ?? []).filter((it) => it?.track?.name && Date.parse(it.played_at) >= now - HEARD_WINDOW_MS)
      .map((it) => `${(it.track.artists ?? []).map((a) => a?.name).filter(Boolean).join(", ")} — ${it.track.name}`);
  } catch { return []; }
}
export const NEARBY_ASK = "Also send `nearby` with extend_endless: four genres next to this one that a listener might " +
  "turn to next, closest first, as short names (for ska: rocksteady, 2 Tone, reggae, ska punk). The house shows them " +
  "as buttons on Genre's page; one tap makes a new set of that genre.";
// What the guest DJ's page offers next to its words, or null: Genre's from the
// curator (`sent`), Deep Dive's from Last.fm's nearest to the artist, kept by
// the house. Kept with the words, so new words never show old buttons.
export function nearbyOf(dj, words, { sent = null, similar = null } = {}) {
  const w = String(words ?? "").trim();
  if (!w) return null;
  // The words themselves never; for an artist, nor a billing that holds them
  // ("J.J. Cale & Eric Clapton"). A genre's own kin may ("ska punk" for ska).
  const same = (n) => researchSlug(n) === researchSlug(w)
    || (dj === "deep-dive" && researchSlug(n).includes(researchSlug(w.split(/[;,]/)[0])));
  const clean = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map((n) => rclip(n, 40)).filter((n) => n && !same(n)))].slice(0, 4);
  if (dj === "genre") { const list = clean(sent); return list.length ? { words: w, label: "Nearby", list } : null; }
  if (dj === "deep-dive") {
    const list = clean((similar ?? []).map((x) => x?.name ?? x));
    return list.length ? { words: w, label: "Similar artists", list } : null;
  }
  return null;
}
export async function endlessJobs(env, { folders = researchFolders(env), heard = null, lookUp = null } = {}) {
  if (!env?.STATION) return [];
  let state = null;
  try { state = await endlessLoad(env); } catch { return []; }
  const cfg = parseEndless(env);
  const presets = endlessPresets(env, cfg, state);
  const now = Date.now();
  const open = Object.values(state.jobs).filter((j) => j && !j.done && !(j.claimed && now - j.claimed < ENDLESS_LEASE_MS));
  const lately = open.length && heard ? await heard() : [];
  return Promise.all(open.map(async (j) => {
    const p = presets.find((x) => x.button === j.btn);
    const kind = j.kind ?? "topup";
    const avoid = [...new Set([...(state.history?.[String(j.dj)] ?? []).map((h) => h[1]).slice(-(p?.noRepeatSongs ?? 150)),
      ...(kind === "fresh" ? [] : (state.sessions?.[String(j.btn)]?.tracks ?? []).map((t) => t?.[2])), ...lately].filter(Boolean))];
    // The song a top-up follows, so the batch does not open on its title.
    const last = kind === "topup" ? (state.sessions?.[String(j.btn)]?.tracks ?? []).at(-1)?.[2] ?? null : null;
    // A DJ with a roll call gets the slice that fits this job: the steer's
    // words, or for a top-up or a fresh set a spread of acts not played lately.
    const who = findDj(env, j.dj);
    const roll = rollCallSlice(who?.key ?? j.dj, { words: j.words ?? "", recent: avoid, seed: j.id, brief: who?.brief });
    // The guest DJ's words, looked up once, then read back (2026-10-18):
    // Deep Dive's artist always; anyone else's when the words are an artist.
    const subject = laneSubject(state, j.btn);
    let found = subject ? (await folders.byWords(subject)) ?? (await folders.find(subject, 1))[0] ?? null : null;
    // Deep Dive's artist, never looked up: the house does it now
    // (musicbrainz.js, 2026-10-24), when list_requests hands it the way.
    if (subject && !found && lookUp && researchable(env, j.dj)) {
      // Only the artist: the words before a comma or a semicolon ("Miles
      // Davis, a mellow evening"; a steer adds "; the ballads"), so the rest
      // of what the listener said never leaves the house (Codex, 2026-10-24).
      const artist = String(subject).split(/[;,]/)[0].trim();
      try { found = artist ? await lookUp(artist) : null; } catch { found = null; }
    }
    const research = !subject || found ? {}
      : researchable(env, j.dj) ? { research: researchSteps(subject) }
        : { research_if_artist: researchIfArtist(subject, { lastfm: lastfmOn(env) }) };
    // NEARBY (2026-10-24, "Nearby, One Tap"): Genre's neighbouring genres,
    // asked once for the guest DJ's words; Deep Dive's come from Last.fm.
    const askNearby = who?.key === "genre" && subject && state.lane?.nearby?.words !== subject;
    return { job_id: j.id, kind, dj: j.dj, minutes: j.minutes, preset: j.btn,
      ...(askNearby ? { send_nearby: NEARBY_ASK } : {}),
      ...(j.words ? { steer: j.words } : {}), ...(j.when ? { when: j.when } : {}), ...(last ? { ends_with: last } : {}),
      how: endlessHow({ ...j, kind }, who?.name), avoid, ...(roll ? { roll_call: roll } : {}),
      // The DJ's tuning as it stands when the job is read (MC-32), the same
      // words get_dj gives, so the job and the brief cannot disagree.
      ...(() => { const t = tuningWords(env, who?.key ?? j.dj); return t ? { tuning: t } : {}; })(),
      ...(found ? { discography: folderOut(found) } : research),
      asked_at: new Date(j.at).toISOString() };
  }));
}
// WHAT A PRESS OF A HOUSE DJ'S PRESET PLAYS NEXT (2026-10-24, the house DJs
// on Loaded, the owner's A of docs/design/loaded-house): read off the ledger
// and its log, never Spotify. `rows` is the log, oldest first; `marked` the
// playlist's last written length, for a preset the log has nothing on.
// Null when there is nothing to say.
export function nextPressWords(state, btn, rows, marked = null) {
  if (Object.values(state?.jobs ?? {}).some((j) => j?.btn === btn && j?.kind === "fresh" && !j.done)) return "A fresh set is being made";
  if (state?.sessions?.[String(btn)]) return "Carries on where it stopped";
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i--) {
    const r = rows[i];
    if (Number(r?.btn) !== btn) continue;
    const d = String(r.detail ?? "");
    if (r.event === "kept") {
      const m = d.match(/^(\d+) unplayed songs \((\d+) min\)/);
      return m ? `Carries on: ${m[1]} songs kept (${m[2]} min)` : "Carries on where it stopped";
    }
    if (r.event === "fresh-landed") { const m = d.match(/^(\d+) songs/); return m ? `A fresh set: ${m[1]} songs` : "A fresh set"; }
    if (r.event === "day-cap") return "Plays its last set again";
    if (r.event === "session-start" || r.event === "session-end") break;
  }
  // Nothing known: null, and the page says what the DJ plays instead.
  return Number.isInteger(marked) && marked > 0 ? `${marked} songs waiting` : null;
}
export async function endlessLogRows(env, limit = 200) {
  try { return (await station(env, "endless-list", { limit }))?.rows ?? []; } catch { return []; }
}
// Vibe's mood when the hour decides (her brief: before about ten in the
// morning the morning, after about eleven at night the small hours, the room
// between), for the line on Loaded.
export function vibeHourWords(env, now = Date.now()) {
  let h = 12;
  try { h = Number(new Date(now).toLocaleString("en-US", { timeZone: houseTz(env), hour: "2-digit", hour12: false })) % 24; } catch { /* noon */ }
  return `The hour decides: ${h < 10 && h >= 4 ? "the morning" : h >= 23 || h < 4 ? "the small hours" : "the room"} now`;
}
export function parseEndless(env) {
  let raw = env?.ENDLESS;
  if (!raw) return null;
  try { if (typeof raw === "string") raw = JSON.parse(raw); } catch { return null; }
  const presets = (Array.isArray(raw?.presets) ? raw.presets : []).filter((p) =>
    Number.isInteger(p?.button) && (typeof p?.dj === "string" || p?.lane === true) && /^[A-Za-z0-9]{22}$/.test(String(p?.playlist ?? "")))
    .map((p) => ({ button: p.button, dj: typeof p.dj === "string" ? p.dj : null, playlist: p.playlist,
      // THE ENDLESS LANE (MC-27): one house playlist any DJ takes over from
      // their page. Its DJ is `state.lane`, never MC-24's assignments.
      ...(p.lane === true ? { lane: true } : {}),
      hours: Number(p.hours) > 0 ? Number(p.hours) : 4,
      topupMinutes: Number(p.topupMinutes) > 0 ? Number(p.topupMinutes) : 30,
      batchMinutes: Number(p.batchMinutes) > 0 ? Number(p.batchMinutes) : 45,
      // The opening set made after a session, for the next press.
      freshMinutes: Number(p.freshMinutes) > 0 ? Number(p.freshMinutes) : 60,
      // How many of its last-played songs a new batch avoids (the owner,
      // 2026-09-23: 150 for now, about five evenings of listening).
      noRepeatSongs: Number(p.noRepeatSongs) > 0 ? Number(p.noRepeatSongs) : 150 }));
  if (!presets.length) return null;
  return { mode: raw.mode === "live" ? "live" : "watch",
    dailyRuns: Number(raw.dailyRuns) > 0 ? Number(raw.dailyRuns) : 12, presets };
}
// The playlist's tracks, lengths and labels, [uri, ms, "Artist — Title"] in
// order — read once a session, and again after each write.
export async function endlessTracks(env, pid) {
  const cat = catalogFor(env, "spotify");
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const { tracks, next } = await cat.items(pid, cursor);
    for (const t of tracks) {
      if (t?.uri) out.push([t.uri, Number(t.duration_ms) || 0,
        `${(t.artists ?? []).map((a) => a?.name).filter(Boolean).join(", ")} — ${t.name ?? ""}`.slice(0, 120)]);
    }
    if (next == null) break;
    cursor = next;
  }
  return out;
}
// Where in the list the player is and how long is left after it: the rest of
// the current track plus every track after it. The current track is found at
// or after the last place it was seen, since a set can repeat a record.
export function endlessLeft(tracks, uri, progressMs, fromIdx = 0) {
  if (!Array.isArray(tracks) || !uri) return null;
  let idx = tracks.findIndex((t, i) => i >= fromIdx && t[0] === uri);
  if (idx < 0) idx = tracks.findIndex((t) => t[0] === uri);
  if (idx < 0) return null;
  let ms = Math.max(0, (tracks[idx][1] || 0) - (Number(progressMs) || 0));
  for (let i = idx + 1; i < tracks.length; i++) ms += tracks[i][1] || 0;
  return { idx, leftMs: ms, of: tracks.length };
}
// Who is on each endless preset, for the DJs tab: { djKey: btn }.
export async function endlessOnDeck(env) {
  const cfg = parseEndless(env);
  if (cfg?.mode !== "live" || !env?.STATION) return {};
  try { return Object.fromEntries(endlessSlots(env, cfg, await endlessLoad(env)).map((p) => [p.dj, p.button])); }
  catch { return {}; }
}
// The lane for the DJs tab (MC-27 stage 4): whose it is, and the picked
// speaker every square's ▶ plays on. Nothing when there is no live lane.
export async function deckLane(env, request) {
  const cfg = parseEndless(env);
  const lane = cfg?.mode === "live" ? cfg.presets.find((p) => p.lane) : null;
  if (!lane || !env?.STATION) return {};
  let st = null;
  try { st = await endlessLoad(env); } catch { st = null; }
  return { lane: { dj: st?.lane?.dj ?? null, btn: lane.button },
    device: (await pickCheap(env, request))?.name ?? speakerFor(request, env) };
}
// Who is on each endless preset, for Talk's prompt: [{ name, btn }], and
// nothing when the ledger cannot say (the prompt then leaves them out).
export async function talkEndless(env) {
  const cfg = parseEndless(env);
  if (cfg?.mode !== "live" || !env?.STATION) return [];
  try { return endlessSlots(env, cfg, await endlessLoad(env)).map((p) => ({ name: p.name, btn: p.button })); }
  catch { return []; }
}
// Whether a playlist is a configured endless slot's.
export function endlessPlaylist(env, id) {
  return !!parseEndless(env)?.presets.some((p) => p.playlist === id);
}
// Is the program a steer was given for still the one on the guest? A new
// program loaded there ends the steer (Codex, 2026-09-24): the old DJ's
// songs must never land in it. Unknown answers "no".
export async function programStill(env, p) {
  if (!p?.program) return true;
  let on = null;
  try { on = await programsKV(env).get(`on:${p.playlist}`, { type: "json" }); } catch { return false; }
  return !!on && on.dj === p.dj && (on.ref ?? null) === (p.ref ?? null) && (on.at ?? null) === (p.at ?? null);
}
// A job into the state and the day's count; its doorbell rings once the
// state it lives in is written (endlessRing), never before.
export function endlessFile(state, job, bells) {
  // A job for the lane carries the tenancy it was filed under (MC-27): a
  // writer proves the lane is still that tenancy before it writes.
  if (state.lane && job.btn === state.lane.btn) job.tenancy = Number(state.lane.tenancy) || 0;
  // AND ITS SUBJECT (2026-10-10, Deep Dive): the artist a DJ was played
  // endless for goes on every job the lane files — top-up, fresh set, steer —
  // because the curator sees the job and never the list. A steer's own
  // words come after it.
  const subject = state.lane && job.btn === state.lane.btn ? state.lane.words : null;
  if (subject) job.words = job.words && !sameWords(job.words, subject) ? `${subject}; ${job.words}` : subject;
  state.jobs[job.id] = job;
  state.runs = (state.runs ?? 0) + 1;
  bells.push(job.id);
}
export const sameWords = (a, b) =>
  String(a ?? "").toLowerCase().replace(/\s+/g, " ").trim() === String(b ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export async function endlessRing(env, bells, say) {
  if (env.AUTOFULFILL_ENABLED !== "true") return;
  for (const id of bells) {
    let rang = false;
    try { rang = await emitRequestEvent(env, id); } catch { rang = false; }
    if (!rang) say(null, "doorbell-failed", "the hourly sweep will find the job");
  }
}
// After any write to an endless or steered playlist: the mark follows it (so
// a read does not call it hand-edited), and the pages' caches let go.
export async function endlessWrote(env, pid, uris) {
  await writeMark(env, pid, uris);
  try { await dropTile(env, pid); } catch { /* a stale tile for a minute */ }
  try { await programsKV(env).delete(`items:${pid}`); } catch { /* cache */ }
}
// A playlist renamed for the DJ now on it, so the next save on a speaker
// takes the right name. Best effort: the music is right either way.
export async function endlessRename(env, renames, say) {
  const cat = catalogFor(env, "spotify");
  for (const r of renames) {
    try { await cat.rename(r.playlist, r.name); }
    catch (e) { say(r.btn, "rename-failed", String(e?.message ?? e).slice(0, 200)); }
    // And the DJ's face on it, as a swap between presets always did.
    if (r.dj) {
      const warn = await wearFace(env, cat, r.playlist, r.dj, `Preset ${r.btn}`);
      if (warn) say(r.btn, "cover-kept", warn.slice(0, 200));
    }
  }
}

// PUT A DJ ON A SLOT (MC-24), inside a state being written: the swap, the
// slot's own work cancelled (it was for the DJ leaving), and a fresh set for
// each slot that changed hands. `out` collects what happens after the write.
// THE LANE'S TAKEOVER (MC-27, Codex's review 1-2): one step, inside one
// endlessUpdate — the old session retired, a new generation, its jobs,
// queued swap and program cleared, the new DJ in and the tenancy raised, so
// no writer filed under the old tenancy can land. `dj: null` empties it.
// Refused for a DJ who holds a fixed endless preset: one DJ, one endless set.
export function endlessLaneTakeover(env, cfg, state, { dj, program = null, now, head = 0, words = null }) {
  const lane = (cfg?.presets ?? []).find((p) => p.lane);
  if (!lane) return { ok: false, status: "no-lane" };
  if (dj && endlessSlots(env, cfg, state).some((p) => p.dj === dj)) return { ok: false, status: "has-preset" };
  const key = String(lane.button);
  delete state.sessions[key];
  state.gen[key] = (Number(state.gen[key]) || 0) + 1;
  for (const [id, j] of Object.entries(state.jobs)) if (j?.btn === lane.button) delete state.jobs[id];
  delete state.queued[key];
  const tenancy = (Number(state.lane?.tenancy) || 0) + 1;
  // `head`: songs at the top of the list that were the leaving DJ's (a hand-
  // over after the playing song); the watch never counts them as the new one's.
  // Not READY until the new DJ's songs are on it (Codex's review 2): until
  // then the watch leaves it alone and nobody "carries on" with the last DJ's
  // list under this one's name. `ready` defaults true for a lane from before.
  state.lane = { btn: lane.button, dj: dj ?? null, tenancy, program, since: now, head: Number(head) || 0,
    ...(dj ? { ready: false } : {}), ...(dj && words ? { words } : {}) };
  // A DJ in the lane does not also wait for a fixed preset (Codex's review 5).
  if (dj) for (const [k, q] of Object.entries(state.queued ?? {})) if (q?.dj === dj) delete state.queued[k];
  // Looked at on the next run, not the next idle half-hour (2026-09-25:
  // Camille and Dutch started at 19:41 and the watch had not seen either).
  state.lastLook = 0;
  return { ok: true, tenancy, button: lane.button, playlist: lane.playlist };
}
// ONE WRITER AT A TIME ON THE LANE (Codex's code review 1, 2 and 4,
// 2026-09-25). A tenancy check followed by a Spotify write leaves a gap a
// takeover can land in, and then the older writer's songs go onto the new
// DJ's list. So every write to the lane's playlist holds a short lease in the
// endless state: taken with the tenancy it expects (checked in the same
// compare-and-set), held across the write, released after. A takeover takes
// it first and holds it through its copy. A lease left behind by a crashed
// run lapses by itself.
export const LANE_LOCK_MS = 90 * 1000;
export async function laneLock(env, { id, tenancy = null }) {
  for (let i = 0; i < 4; i++) {
    let r;
    try {
      r = await endlessUpdate(env, (st) => {
        const now = Date.now();
        if (st.laneWrite && Number(st.laneWrite.until) > now && st.laneWrite.id !== id) return { abort: true, status: "busy" };
        if (tenancy != null && (Number(st.lane?.tenancy) || 0) !== (Number(tenancy) || 0)) return { abort: true, status: "moved" };
        st.laneWrite = { id, until: now + LANE_LOCK_MS };
        return { status: "ok" };
      });
    } catch { return "failed"; }
    if (!r.abort) return "ok";
    if (r.status !== "busy") return r.status;
    await new Promise((res) => setTimeout(res, env.__laneLockWaitMs ?? 1500));
  }
  return "busy";
}
export async function laneUnlock(env, id) {
  try {
    await endlessUpdate(env, (st) => {
      if (st.laneWrite?.id !== id) return { abort: true };
      delete st.laneWrite;
      return {};
    });
  } catch { /* it lapses by itself */ }
}
export function endlessApplyAssign(env, cfg, state, { to, dj, from, now }, out, say) {
  const leaving = to.dj;
  state.assign[String(to.button)] = { dj, at: now };
  if (from) state.assign[String(from.button)] = { dj: leaving, at: now };
  const moved = [{ slot: to, dj }, ...(from ? [{ slot: from, dj: leaving }] : [])];
  for (const { slot } of moved) {
    for (const [id, j] of Object.entries(state.jobs)) if (j?.btn === slot.button) delete state.jobs[id];
    delete state.queued[String(slot.button)];
  }
  for (const { slot, dj: who } of moved) {
    const name = findDj(env, who)?.name ?? who;
    out.renames.push({ btn: slot.button, playlist: slot.playlist, name, dj: who });
    if (cfg.mode === "live" && (state.runs ?? 0) < cfg.dailyRuns) {
      endlessFile(state, { id: `endless-${slot.button}-fresh-${now}`, kind: "fresh", btn: slot.button, dj: who,
        playlist: slot.playlist, minutes: slot.freshMinutes, at: now, gen: Number(state.gen[String(slot.button)]) || 0 }, out.bells);
      out.fresh.push(slot.button);
    } else {
      out.noFresh.push(slot.button);
    }
    say(slot.button, "assigned", `${name} is on preset ${slot.button} now${
      out.noFresh.includes(slot.button) ? "; no runs left today, so the old set stays until tomorrow" : "; a fresh set is asked for"}`);
  }
}
// MORE HOUSE DJS, MADE AND GIVEN UP FROM A DJ'S PAGE (the owner, 2026-10-18,
// "One More House DJ", https://claude.ai/artifact/65nX1hUvqycJifig2GSSjh): up
// to four, and only in a house whose endless DJs are the setup page's. A
// house.json house changes its file; a page setting written over the file
// would hide every later edit of it.
export const MAX_HOUSE_DJS = 4;
export const toSaveKey = (btn) => `endless:tosave:${btn}`;
export const retiredKey = (dj) => `endless:retired:${dj}`;
export const endlessOnPage = (env) => !!env?.__page && Object.hasOwn(env.__page, "ENDLESS");
// The numbers a new house DJ may take (none the house's own presets use),
// how many house DJs there are, and whether that is the most.
export function houseDjRoom(env, cfg) {
  if (!cfg || cfg.mode !== "live" || !endlessOnPage(env)) return null;
  const h = house(env);
  const used = new Set([...h.buttons.map((b) => b.btn), ...(h.fixed ?? []).map((b) => b.btn), ...cfg.presets.map((p) => p.button)]);
  const free = [];
  for (let n = 1; n <= 12; n++) if (!used.has(n)) free.push(n);
  const count = cfg.presets.filter((p) => !p.lane).length;
  return { count, max: MAX_HOUSE_DJS, free, full: count >= MAX_HOUSE_DJS };
}
// A preset's leftovers in the state: its session, its queue, who was put on
// it, and the jobs still asked for it. The history stays: it is the DJ's.
export function forgetPreset(state, button) {
  const k = String(button);
  for (const part of ["sessions", "gen", "queued", "assign"]) if (state[part]) delete state[part][k];
  for (const [id, j] of Object.entries(state.jobs ?? {})) if (j?.btn === button) delete state.jobs[id];
}
// The endless config as the setup page keeps it, with its presets as given.
export const endlessJson = (cfg, presets) => JSON.stringify({ mode: cfg.mode, dailyRuns: cfg.dailyRuns, presets });
export async function endlessAssign(env, { dj, button }) {
  const cfg = parseEndless(env);
  if (!cfg || cfg.mode !== "live" || !env?.STATION) return { status: "off" };
  const who = findDj(env, dj);
  if (!who || who.archiveOnly) return { status: "no-dj" };
  // ASKED SETS ONLY (Comedy, 2026-09-30): a persona with `endless: false`
  // is never put on an endless preset. Nobody since Comedy was cut
  // (2026-10-13); kept for the next one.
  if (who.endless === false) return { status: "no-endless" };
  const now = Date.now();
  const events = [];
  const say = (btn, event, detail) => events.push({ at: now, btn, event, detail });
  const out = { bells: [], renames: [], fresh: [], noFresh: [] };
  let result;
  try {
    result = await endlessUpdate(env, (state) => {
      events.length = 0; out.bells.length = 0; out.renames.length = 0; out.fresh.length = 0; out.noFresh.length = 0;
      endlessDay(env, state, now);
      const slots = endlessSlots(env, cfg, state);
      const to = slots.find((p) => p.button === button);
      if (!to) return { abort: true, status: "no-slot" };
      if (to.dj === who.key) return { abort: true, status: "already" };
      const from = slots.find((p) => p.dj === who.key) ?? null;
      // In the lane now (MC-27): a DJ has one endless set, so the lane lets
      // them go — not while it is playing them.
      if (state.lane?.dj === who.key) {
        if (state.sessions[String(state.lane.btn)]) return { abort: true, status: "in-lane" };
        endlessLaneTakeover(env, cfg, state, { dj: null, now });
      }
      if ([to, from].some((p) => p && state.sessions[String(p.button)])) {
        state.queued[String(to.button)] = { dj: who.key, at: now };
        say(to.button, "queued", `${who.name} takes over preset ${to.button} when it stops playing`);
        return { status: "queued", swapped: from?.button ?? null, leaving: to.name };
      }
      endlessApplyAssign(env, cfg, state, { to, dj: who.key, from, now }, out, say);
      return { status: "done", swapped: from?.button ?? null, leaving: to.name, fresh: [...out.fresh], noFresh: [...out.noFresh] };
    });
  } catch { return { status: "failed" }; }
  if (result.abort) return result;
  await endlessRing(env, out.bells, say);
  await endlessRename(env, out.renames, say);
  await endlessLog(env, events);
  return result;
}

// Kept only when it is worth a press: at least this many songs and minutes.
export const ENDLESS_KEEP_MIN_SONGS = 4;
export const ENDLESS_KEEP_MIN_MS = 15 * 60000;
// The heard songs cut from the top of a kept list, so the key starts where
// the set stopped. If the write fails, a fresh set is asked for instead —
// the list as it stands would replay the heard songs from the top.
export async function endlessTrim(env, cfg, trims, say) {
  for (const t of trims ?? []) {
    // THE TRIM RUNS AFTER THE WATCH'S SAVE (Codex's code review 4): pressed
    // again since, or the lane taken over, and the list is not this stop's
    // any more. Checked fresh; on the lane, under its lease for the write.
    const lockId = t.lane ? `trim-${t.btn}-${Date.now()}` : null;
    if (lockId) {
      const got = await laneLock(env, { id: lockId, tenancy: t.tenancy });
      if (got !== "ok") { say(t.btn, "keep-skipped", got === "moved" ? "the guest DJ changed; nothing cut" : "another write held the list; nothing cut"); continue; }
    }
    try {
      let st = null;
      try { st = await endlessLoad(env); } catch { st = null; }
      if (!st || (Number(st.gen?.[String(t.btn)]) || 0) !== t.gen || st.sessions?.[String(t.btn)]) {
        say(t.btn, "keep-skipped", "pressed again since the stop; nothing cut");
        continue;
      }
      try {
        const cat = catalogFor(env, "spotify");
        await cat.replaceItems(t.playlist, t.uris.slice(0, cat.batch));
        for (let i = cat.batch; i < t.uris.length; i += cat.batch) await cat.appendItems(t.playlist, t.uris.slice(i, i + cat.batch));
        await endlessWrote(env, t.playlist, t.uris);
        await dropPauseNoteFor(env, t.playlist);
      } catch (e) {
        say(t.btn, "keep-failed", `${String(e?.message ?? e).slice(0, 160)}; a fresh set instead`);
        const bells = [];
        try {
          await endlessUpdate(env, (st2) => {
            if (cfg?.mode !== "live" || (st2.runs ?? 0) >= cfg.dailyRuns) return {};
            const p = cfg.presets.find((x) => x.button === t.btn);
            if (!p || Object.values(st2.jobs).some((j) => j?.btn === t.btn && j?.kind === "fresh")) return {};
            endlessFile(st2, { id: `endless-${t.btn}-fresh-${Date.now()}`, kind: "fresh", btn: t.btn, dj: t.dj, playlist: t.playlist,
              minutes: p.freshMinutes, at: Date.now(), gen: Number(st2.gen[String(t.btn)]) || 0 }, bells);
            return {};
          });
          await endlessRing(env, bells, say);
        } catch { /* the next look sees no job; the old list stays */ }
      }
    } finally {
      if (lockId) await laneUnlock(env, lockId);
    }
  }
}
export async function endlessWatch(env, now = Date.now(), retry = true) {
  const cfg = parseEndless(env);
  if (!cfg) return { outcome: "off" };
  const events = [];
  const say = (btn, event, detail) => events.push({ at: now, btn, event, detail });
  const bells = [], pauses = [];
  const out = { bells, renames: [], fresh: [], noFresh: [], trims: [] };
  let state;
  try { state = await endlessLoad(env); } catch { return { outcome: "failed" }; }
  endlessDay(env, state, now);
  // Jobs nobody answered. A top-up is let go by its session's look below;
  // a fresh set or a steer here.
  let swept = false;
  for (const [id, j] of Object.entries(state.jobs)) {
    const kind = j?.kind ?? "topup";
    if (kind === "topup" || j?.done) continue;
    if (now - (Number(j.at) || 0) > (kind === "fresh" ? ENDLESS_FRESH_MS : ENDLESS_JOB_MS)) {
      say(j.btn ?? null, `${kind}-expired`, `no ${kind} landed; nothing changed`);
      delete state.jobs[id];
      // The guest DJ's opening never came: the lane is not theirs with the
      // last DJ's songs on it (Codex's review 2). It empties.
      if (state.lane?.ready === false && j.btn === state.lane.btn && (Number(j.tenancy) || 0) === (Number(state.lane.tenancy) || 0)) {
        // A new tenancy, so a curator still holding the job lands nowhere
        // (Codex's fix check 4).
        endlessLaneTakeover(env, cfg, state, { dj: null, now });
        say(j.btn, "lane-emptied", "the opening never landed; nobody is the guest DJ");
      }
      swept = true;
    }
  }
  const active = Object.values(state.sessions).some(Boolean);
  // Idle: one look every half hour. A session: every run (ten minutes).
  if (!active && now - (Number(state.lastLook) || 0) < ENDLESS_IDLE_MS) {
    if (swept) {
      let ok = false;
      try { ok = await endlessSave(env, state); } catch { ok = false; }
      if (ok) await endlessRing(env, bells, say);
      await endlessLog(env, events);
    }
    return { outcome: "idle" };
  }
  if (await throttledUntil(env)) {
    say(null, "throttled", "Spotify is limiting the account; no look");
    await endlessLog(env, events);
    return { outcome: "throttled" };
  }
  let st;
  try { st = await playerState(env); } catch (e) {
    say(null, "look-failed", String(e?.message ?? e).slice(0, 200));
    await endlessLog(env, events);
    return { outcome: "failed" };
  }
  state.lastLook = now;
  const pid = String(st?.context?.uri ?? "").match(/^spotify:playlist:([A-Za-z0-9]{22})$/)?.[1] ?? null;
  const playing = st?.is_playing === true;
  for (const p of endlessPresets(env, cfg, state)) {
    const key = String(p.button);
    // A guest DJ whose songs are not on the list yet (Codex's review 2).
    if (p.lane && state.lane?.ready === false) continue;
    let s = state.sessions[key] ?? null;
    if (p.program && s && !(await programStill(env, p))) {
      say(p.button, "program-changed", "another program went on the preset; the steer ends");
      for (const [id, j] of Object.entries(state.jobs)) if (j?.btn === p.button) delete state.jobs[id];
      delete state.sessions[key];
      continue;
    }
    if (playing && pid === p.playlist) {
      if (!s) {
        s = { start: now, misses: 0, topups: 0, device: st?.device?.name ?? null };
        // A new session is a new generation: a fresh set asked for before it
        // must not replace the list this press is playing.
        state.gen[key] = (Number(state.gen[key]) || 0) + 1;
        say(p.button, "session-start", `${p.dj} on ${s.device ?? "a speaker"}`);
      }
      s.misses = 0;
      if (!Array.isArray(s.tracks)) {
        try {
          s.tracks = await endlessTracks(env, p.playlist);
        } catch (e) {
          say(p.button, "tracks-failed", String(e?.message ?? e).slice(0, 200));
        }
      }
      // A session that began in watch mode carries `pending: true` (it wrote
      // "would-topup" once); live, only a job id means one is open.
      if (s.pending === true && cfg.mode === "live" && !s.dayCapped) s.pending = false;
      // A top-up that never landed frees the session to ask again: the curator
      // may have been refused, throttled or never woken.
      const job = s.pending && typeof s.pending === "string" ? state.jobs[s.pending] : null;
      if (s.pending && typeof s.pending === "string" && !job) s.pending = false;
      if (job && !job.done && now - job.at > ENDLESS_JOB_MS) {
        say(p.button, "topup-expired", `no top-up landed in ${Math.round(ENDLESS_JOB_MS / 60000)} min; the next look may ask again`);
        delete state.jobs[s.pending];
        s.pending = false;
      }
      let at = endlessLeft(s.tracks, st?.item?.uri, st?.progress_ms, s.idx ?? 0);
      const ageMin = Math.round((now - s.start) / 60000);
      // PAST THE END (measured 2026-09-23, 20:30): when the list runs out the
      // speaker's own autoplay carries on — Madonna after Sunny's last song —
      // and Spotify still names the playlist as the context. A track not in
      // the list, after the last one was seen, is that: nothing is left.
      // A session first seen here is past the end too (2026-09-27): The
      // Selector's six songs ran out before the first look, and with no place
      // seen it never asked for more while autoplay played on.
      const pastEnd = !at && Array.isArray(s.tracks) && s.tracks.length > 0 &&
        (s.idx == null || s.idx >= s.tracks.length - 2);
      if (pastEnd) at = { idx: s.idx ?? s.tracks.length - 1, leftMs: 0, of: s.tracks.length, pastEnd: true };
      if (!at) {
        say(p.button, "look", `track not in the list (${ageMin} min in)`);
      } else {
        s.idx = at.idx;
        s.leftMs = at.leftMs;
        s.lookAt = now;
        // Heard: everything up to the song playing now (all of it, past the end).
        if (Array.isArray(s.tracks)) {
          const from = p.lane ? Number(state.lane?.head) || 0 : 0;
          endlessRemember(state, p, (at.pastEnd ? s.tracks : s.tracks.slice(0, at.idx + 1)).slice(from));
        }
        const leftMin = Math.round(at.leftMs / 60000);
        say(p.button, "look", at.pastEnd ? `past the end: autoplay is playing (${ageMin} min in)`
          : `track ${at.idx + 1} of ${at.of}, ${leftMin} min left, ${ageMin} min in`);
        const noMore = s.capped || s.dayCapped;
        if (at.pastEnd && noMore && cfg.mode === "live") {
          // THE END IS SILENCE (MC-22, settled with the owner): with no more
          // songs coming, the speaker's autoplay would run all night on a
          // Denon switched to another input. Paused once, on that speaker,
          // after the state is written. Only on a list read just now (Codex,
          // 2026-09-24): a list cached before a top-up whose read-back failed
          // would call a new song autoplay.
          let sure = false;
          try {
            s.tracks = await endlessTracks(env, p.playlist);
            sure = !endlessLeft(s.tracks, st?.item?.uri, st?.progress_ms, 0);
          } catch { sure = false; }
          if (!sure) say(p.button, "look", "not past the end after all, or the list could not be read; no pause");
          if (!s.stopped && sure) {
            s.stopped = true;
            pauses.push({ btn: p.button, gen: Number(state.gen[key]) || 0, ...(p.lane ? { tenancy: p.tenancy } : {}),
              deviceId: st?.device?.id ?? null, device: st?.device?.name ?? "the speaker",
              why: s.capped ? "the ceiling" : "the day's runs" });
          }
        } else if (now - s.start >= p.hours * 3600e3) {
          if (!s.capped) { s.capped = true; say(p.button, "ceiling", `${p.hours} h reached: no more top-ups, the set plays out`); }
        // TOO LATE ONCE (the owner, 2026-09-26): Camille's set went from 22
        // minutes to 2 between two looks, songs skipped from the panel, and
        // the top-up landed after autoplay had taken over. So a set also
        // asks when four songs or fewer are left, whatever their minutes say.
        } else if ((at.leftMs < p.topupMinutes * 60000 || at.of - at.idx - 1 <= 4) && !s.pending) {
          if ((state.runs ?? 0) >= cfg.dailyRuns) {
            s.pending = true;
            s.dayCapped = true;
            say(p.button, "day-cap", `${cfg.dailyRuns} runs today already: no top-up`);
          } else if (cfg.mode === "live") {
            // A job for the curator; its doorbell rings once this is written.
            const id = `endless-${p.button}-${now}`;
            endlessFile(state, { id, kind: "topup", btn: p.button, dj: p.dj, playlist: p.playlist,
              minutes: p.batchMinutes, at: now, ...(s.steer?.words ? { words: s.steer.words } : {}) }, bells);
            s.pending = id;
            say(p.button, "topup", `${leftMin} min left: asked for ${p.batchMinutes} min more of ${p.dj}${
              s.steer?.words ? `, steered: "${s.steer.words}"` : ""}`);
          } else {
            s.pending = true;
            state.runs = (state.runs ?? 0) + 1;
            say(p.button, "would-topup", `${leftMin} min left: ${p.batchMinutes} min more of ${p.dj}`);
          }
        }
      }
      state.sessions[key] = s;
    } else if (s) {
      s.misses = (s.misses ?? 0) + 1;
      if (s.misses >= 2) {
        const mins = Math.round((now - s.start) / 60000);
        say(p.button, "session-end", `${mins} min, ${s.topups ?? 0} top-ups`);
        if (p.lane && state.lane) state.lane.head = 0;
        for (const [id, j] of Object.entries(state.jobs)) if (j?.btn === p.button && j?.kind !== "fresh") delete state.jobs[id];
        delete state.sessions[key];
        // A steered program simply ends; the Shelf still holds it as made.
        if (p.program) continue;
        // A DJ waiting for this slot takes it now (MC-24), with their own
        // fresh set — unless the slot they leave is still playing.
        const q = state.queued[key];
        // Waiting for this preset while in the lane (Codex's review 5): the
        // lane lets them go first, unless it is playing them.
        const laneHolds = !!q?.dj && state.lane?.dj === q.dj && !!state.sessions[String(state.lane.btn)];
        if (q?.dj && state.lane?.dj === q.dj && !laneHolds) endlessLaneTakeover(env, cfg, state, { dj: null, now });
        // Playing in the lane: the move waits for the next end of this
        // preset, and this end still keeps or refreshes it (Codex's fix check 6).
        if (q?.dj && cfg.mode === "live" && !laneHolds) {
          const slots = endlessSlots(env, cfg, state);
          const to = slots.find((x) => x.button === p.button);
          const from = slots.find((x) => x.dj === q.dj && x.button !== p.button) ?? null;
          if (to && to.dj !== q.dj && !(from && state.sessions[String(from.button)])) {
            endlessApplyAssign(env, cfg, state, { to, dj: q.dj, from, now }, out, say);
            continue;
          }
          if (to?.dj === q.dj) delete state.queued[key];
        }
        const waiting = Object.values(state.jobs).some((j) => j?.btn === p.button && j?.kind === "fresh");
        if (waiting) continue;
        // KEEP WHAT WAS NOT PLAYED, UNTIL IT IS (the owner, 2026-09-25,
        // option 2): enough left, and the next press — tonight or next week —
        // carries on with it; the heard songs are cut from the top so the key
        // starts where the set stopped. No fresh set, no DJ run: top-ups
        // follow as it runs low, and Start fresh gives a new opening on asking.
        const left = Array.isArray(s.tracks) && s.idx != null && !s.stopped ? s.tracks.slice(s.idx + 1) : [];
        const leftMs = left.reduce((a, t) => a + (Number(t?.[1]) || 0), 0);
        if (cfg.mode === "live" && left.length >= ENDLESS_KEEP_MIN_SONGS && leftMs >= ENDLESS_KEEP_MIN_MS) {
          out.trims.push({ btn: p.button, dj: p.dj, playlist: p.playlist, uris: left.map((t) => t[0]),
            gen: Number(state.gen[key]) || 0, ...(p.lane ? { lane: true, tenancy: p.tenancy } : {}) });
          say(p.button, "kept", `${left.length} unplayed songs (${Math.round(leftMs / 60000)} min) kept: the next press carries on`);
          continue;
        }
        if ((state.runs ?? 0) >= cfg.dailyRuns) {
          say(p.button, "day-cap", "no fresh set today; the next press plays the old one");
        } else if (cfg.mode === "live") {
          // STAGE 3: a fresh opening set for the next press, made now.
          const id = `endless-${p.button}-fresh-${now}`;
          endlessFile(state, { id, kind: "fresh", btn: p.button, dj: p.dj, playlist: p.playlist,
            minutes: p.freshMinutes, at: now, gen: Number(state.gen[key]) || 0 }, bells);
          say(p.button, "fresh", `asked for a fresh ${p.freshMinutes}-min opening of ${p.dj} for the next press`);
        } else {
          say(p.button, "would-fresh", `a fresh opening set of ${p.dj} for the next press`);
        }
      } else {
        state.sessions[key] = s;
      }
    }
  }
  let saved = false;
  try { saved = await endlessSave(env, state); } catch { saved = false; }
  if (!saved) {
    // Something else wrote while this looked. Once more from the top; the
    // doorbells and pauses of this pass never happened, so nothing doubles.
    if (retry) return endlessWatch(env, now, false);
    say(null, "watch-conflict", "the state changed twice while the watch looked; the next look tries again");
    await endlessLog(env, events);
    return { outcome: "conflict" };
  }
  await endlessRing(env, bells, say);
  await endlessRename(env, out.renames, say);
  await endlessTrim(env, cfg, out.trims, say);
  for (const x of pauses) {
    // Not if a newer press or a takeover started since the save (Codex's
    // code review 4): the pause is for the set that ran out, not the next one.
    let st2 = null;
    try { st2 = await endlessLoad(env); } catch { st2 = null; }
    if (!st2 || (Number(st2.gen?.[String(x.btn)]) || 0) !== x.gen
      || (x.tenancy != null && (Number(st2.lane?.tenancy) || 0) !== x.tenancy)) {
      say(x.btn, "stop-skipped", "something newer started since; not paused");
      continue;
    }
    try {
      await spotify(env, "PUT", "/me/player/pause", { params: x.deviceId ? { device_id: x.deviceId } : {} });
      say(x.btn, "stopped", `the set ran out after ${x.why}; autoplay paused on ${x.device}`);
    } catch (e) {
      say(x.btn, "stop-failed", String(e?.message ?? e).slice(0, 200));
    }
  }
  await endlessLog(env, events);
  return { outcome: playing ? "playing" : "quiet", events: events.length };
}
// What list_requests says about it: the mode, who is on which preset, what
// is running, and the log.
export async function endlessReport(env) {
  const cfg = parseEndless(env);
  if (!cfg || !env?.STATION) return null;
  let state = null, rows = [];
  try { state = await endlessLoad(env); } catch { state = null; }
  try { rows = (await station(env, "endless-list", { limit: 30 }))?.rows ?? []; } catch { rows = []; }
  const when = (at) => { try { return new Date(at).toLocaleString("en-US", { timeZone: houseTz(env), month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return new Date(at).toISOString(); } };
  return {
    mode: cfg.mode,
    presets: [...endlessSlots(env, cfg, state).map((p) => `${p.button}: ${p.dj}, ${p.hours} h a start${p.queued ? `; ${p.queued} takes over when it stops` : ""}`),
      // The lane (MC-27), said as the lane: empty, or whose it is and since when.
      ...cfg.presets.filter((p) => p.lane).map((p) => `${p.button}: guest DJ, ${state.lane?.dj ? `${state.lane.dj}${
        state.lane.words ? ` on "${state.lane.words}"` : ""} (tenancy ${state.lane.tenancy})` : "nobody"}`)],
    runs_today: `${state?.runs ?? 0} of ${cfg.dailyRuns}`,
    sessions: Object.entries(state?.sessions ?? {}).map(([btn, s]) => ({ button: Number(btn), since: when(s.start),
      track: s.idx != null ? s.idx + 1 : null, of: s.tracks?.length ?? null, capped: !!s.capped, pending: !!s.pending,
      ...(s.steer?.words ? { steer: s.steer.words } : {}), ...(s.program ? { program: s.program.dj } : {}) })),
    log: rows.map((r) => `${when(r.at)}${r.btn != null ? ` · ${r.btn}` : ""} · ${r.event}${r.detail ? ` — ${r.detail}` : ""}`),
  };
}
// How long an endless session runs (MC-22 stage 4), for the DJ's page: the
// clock time its four hours end, or, after that, when the last songs run
// out. (It was on the now bar too until the owner took it off, 2026-09-23.)
// Null when the preset is not an endless one or no session is running.
export async function endlessBar(env, btn, pid = null, state = null) {
  const cfg = parseEndless(env);
  const p = cfg?.presets.find((x) => x.button === btn);
  if (!p || (pid && p.playlist !== pid) || cfg.mode !== "live" || !env?.STATION) return null;
  let s = null;
  try { s = (state ?? await endlessLoad(env)).sessions?.[String(btn)] ?? null; } catch { return null; }
  if (!s) return null;
  const clockAt = (t) => { try { return new Date(t).toLocaleTimeString("en-GB", { timeZone: houseTz(env), hour: "2-digit", minute: "2-digit" }); } catch { return null; } };
  if (s.capped || s.dayCapped) {
    const end = Number(s.lookAt) && Number.isFinite(Number(s.leftMs)) ? Number(s.lookAt) + Number(s.leftMs) : null;
    return { last: true, ...(end ? { until: clockAt(end) } : {}) };
  }
  return { last: false, until: clockAt(Number(s.start) + p.hours * 3600e3) };
}

// THE DJ PAGE'S TAPS (MC-22 stage 4, MC-23). Start fresh files a fresh set
// that starts on the named speaker once made; More like this and Change it
// up file a steer for the curator, only while that preset is playing. Each
// answers { status } and never throws for an ordinary "not now".
// PLAY ENDLESS (MC-27 stage 2): any DJ, on the picked speaker, from their
// page, the phone's Claude or Talk. In order:
//   1. a DJ on 4, 5, 8 or 9 plays their own preset (one DJ, one endless set);
//   2. the lane already theirs plays on from where it stopped;
//   3. otherwise the lane is taken over and starts AT ONCE from their newest
//      Spotify program on the Shelf — copied in, backup first, no curator,
//      no DJ run — and the curator tops it up as it runs low;
//   4. a DJ with no such program gets an opening made first (one run), and
//      it starts on the speaker when it lands.
// WORDS FOR ANY GUEST (the owner, 2026-10-13, with the merges: "Soul, the
// South", "Vibe, the small hours"): any DJ played into
// the lane may be told what to play, as Deep Dive and Genre always were.
// The words ride on the lane and every job it files; other words for the
// DJ already there are a new opening; words never open from an old program.
// A house preset takes none: its DJ plays their own (Vibe on 9 reads the
// hour), and a turn there is a steer.
// A steered program on the Spotify guest is the other endless state: the
// lane supersedes it (the account plays one thing) and closes its work.
export async function playEndless(env, { dj: djRef, device, budget, when = null, words = null }) {
  const cfg = parseEndless(env);
  const lane = cfg?.presets.find((p) => p.lane) ?? null;
  if (!cfg || cfg.mode !== "live" || !lane || !env?.STATION) return { status: "off" };
  const who = findDj(env, djRef);
  if (!who || who.archiveOnly) return { status: "no-dj" };
  if (who.endless === false) return { status: "no-endless" };
  // WHAT TO PLAY, for a DJ who needs telling (2026-10-10, Deep Dive: the
  // artist), and for any guest who is given it (2026-10-13). Kept on the
  // guest DJ, so every job after carries it.
  const asked = String(words ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const now = Date.now();
  const events = [];
  const say = (btn, event, detail) => events.push({ at: now, btn, event, detail });
  const key = String(lane.button);
  // A start that took makes the watch look on its next run (Codex's review 6).
  const looked = async () => { try { await endlessUpdate(env, (st) => { st.lastLook = 0; return {}; }); } catch { /* the idle look */ } };
  const start = async (pl, label) => {
    try {
      const r = await startPlaylistOnDevice(env, { id: pl, name: label, catalog: "spotify" }, device, budget);
      const ok = r?.preset_safe || r?.unverified ? "ok" : "stuck";
      if (ok === "ok") await looked();
      return ok;
    } catch (e) {
      return sleptThrough(e) ? "asleep" : "failed";
    }
  };
  let state;
  try { state = await endlessLoad(env); } catch { return { status: "failed" }; }
  // 1. Their own preset.
  const own = endlessSlots(env, cfg, state).find((p) => p.dj === who.key);
  if (own) return { status: "own-preset", button: own.button, start: await start(own.playlist, who.name) };
  // WHAT IS PLAYING, FROM THE PLAYER (Codex's review 6): the watch's session
  // lags a press by up to ten minutes and outlives a stop by twenty, so it
  // cannot say whether the lane is playing now. One read; the session
  // stands in only when the player cannot be read.
  let pl = null, heard = true;
  try { pl = await playerState(env); } catch { heard = false; }
  const laneLive = heard
    ? pl?.is_playing === true && String(pl?.context?.uri ?? "") === `spotify:playlist:${lane.playlist}`
    : !!state.sessions[key];
  const ready = state.lane?.ready !== false;
  // A DJ who needs telling what to play, and was not: asked, never guessed.
  // The lane already theirs carries on with what it was told; told something
  // else (another artist, or the North after the South), it is a new
  // opening, below. Any DJ, since 2026-10-13: no words carries on.
  const theirs = state.lane?.dj === who.key && ready;
  if (who.needsWords && !asked && !(theirs && state.lane.words)) return { status: "needs-words", needs: who.needsWords };
  // 2. The lane already theirs: playing, or carry on where it stopped.
  if (theirs && !(asked && !sameWords(asked, state.lane.words))) {
    if (laneLive) return { status: "already", button: lane.button };
    return { status: "carry-on", button: lane.button, start: await start(lane.playlist, `Guest DJ · ${who.name}`) };
  }
  // THE LANE IS PLAYING SOMEBODY ELSE (stage 3): asked first — after this
  // song, now, or keep them. `when` is the answer.
  const playing = state.lane?.dj && state.lane.dj !== who.key && laneLive ? state.lane.dj : null;
  if (playing && when !== "now" && when !== "next") {
    return { status: "busy", current: playing, on: (heard ? pl?.device?.name : state.sessions[key]?.device) ?? null };
  }
  // 3 and 4. A takeover, with the opening decided before it. A DJ told what
  // to play opens with it, never with an old program of theirs about
  // something else: the opening is made.
  const opening = who.needsWords || asked ? null : await arrivingSet(env, who, catalogFor(env, "spotify")).catch(() => null);
  const usable = opening && opening.uris.length >= 3 ? opening : null;
  // ONE WRITER (Codex's review 1): the lease is held from before the
  // takeover until the list is written, so no curator, steer or trim filed
  // under the old tenancy can land in between.
  const lockId = `take-${who.key}-${now}`;
  // With the tenancy this decision was made on (Codex's fix check 3):
  // another takeover that lands while this one waits is not replaced
  // without the busy question.
  const got = await laneLock(env, { id: lockId, tenancy: Number(state.lane?.tenancy) || 0 });
  if (got !== "ok") return { status: "moved" };
  try {
    // AFTER THIS SONG: the playing song and everything before it stay the
    // leaving DJ's; the new DJ's opening replaces what was queued after it,
    // and nothing is restarted. Only with an opening in hand, and only while
    // the lane really is what Spotify plays; otherwise it is "now".
    if (playing && when === "next" && usable && heard && laneLive) {
      let tracks = null, at = null;
      try {
        tracks = await endlessTracks(env, lane.playlist);
        at = endlessLeft(tracks, pl?.item?.uri, pl?.progress_ms, state.sessions[key]?.idx ?? 0);
      } catch { at = null; }
      if (at) {
        const head = tracks.slice(0, at.idx + 1);
        let t;
        try {
          t = await endlessUpdate(env, (st) => {
            events.length = 0;
            if (st.laneWrite?.id !== lockId) return { abort: true, status: "moved" };
            if (st.lane?.dj !== playing) return { abort: true, status: "moved" };
            // What the leaving DJ played counts as theirs, heard.
            endlessRemember(st, { dj: playing, noRepeatSongs: lane.noRepeatSongs }, head.slice(Number(st.lane.head) || 0));
            const r = endlessLaneTakeover(env, cfg, st, { dj: who.key, now, head: head.length, words: asked,
              program: { slug: usable.slug, title: usable.title } });
            if (!r.ok) return { abort: true, status: r.status };
            say(lane.button, "lane-taken", `${who.name} after this song, from "${usable.title}" (tenancy ${r.tenancy})`);
            return { tenancy: r.tenancy };
          });
        } catch { return { status: "failed" }; }
        if (t.abort) return { status: t.status ?? "failed" };
        try {
          const next = [...head.map((x) => x[0]), ...usable.uris];
          const cat = catalogFor(env, "spotify");
          await cat.replaceItems(lane.playlist, next.slice(0, cat.batch));
          for (let i = cat.batch; i < next.length; i += cat.batch) await cat.appendItems(lane.playlist, next.slice(i, i + cat.batch));
          await endlessWrote(env, lane.playlist, next);
        } catch (e) {
          await laneUndo(env, t.tenancy);
          await endlessLog(env, [...events, { at: now, btn: lane.button, event: "lane-copy-failed", detail: String(e?.message ?? e).slice(0, 200) }]);
          return { status: "failed" };
        }
        await laneReady(env, t.tenancy);
        await looked();
        await endlessLog(env, [...events, { at: now, btn: lane.button, event: "lane-next", detail: `${usable.uris.length} songs after the playing one` }]);
        return { status: "next", button: lane.button, program: usable.title, from: playing };
      }
    }
    const bells = [];
    let taken;
    try {
      taken = await endlessUpdate(env, (st) => {
        events.length = 0; bells.length = 0;
        endlessDay(env, st, now);
        if (st.laneWrite?.id !== lockId) return { abort: true, status: "moved" };
        if (!usable && (st.runs ?? 0) >= cfg.dailyRuns) return { abort: true, status: "day-cap" };
        const g = guestFor(env, "spotify");
        if (g?.live && st.sessions[String(g.btn)]?.program) {
          for (const [id, j] of Object.entries(st.jobs)) if (j?.btn === g.btn) delete st.jobs[id];
          delete st.sessions[String(g.btn)];
          // The moment it was superseded: a steer begun before it lands
          // nowhere (Codex's review 3).
          st.superseded = { ...(st.superseded ?? {}), [String(g.btn)]: now };
          say(g.btn, "steer-superseded", `the guest DJ took over from the steered program`);
        }
        const r = endlessLaneTakeover(env, cfg, st, { dj: who.key, now, words: asked,
          program: usable ? { slug: usable.slug, title: usable.title } : null });
        if (!r.ok) return { abort: true, status: r.status };
        say(lane.button, "lane-taken", `${who.name}${asked ? ` on "${asked}"` : ""}${usable ? `, from "${usable.title}"` : ", an opening to be made"} (tenancy ${r.tenancy})`);
        if (!usable) {
          endlessFile(st, { id: `endless-${lane.button}-fresh-${now}`, kind: "fresh", btn: lane.button, dj: who.key,
            playlist: lane.playlist, minutes: lane.freshMinutes, at: now, device, gen: Number(st.gen[key]) || 0 }, bells);
        }
        return { tenancy: r.tenancy };
      });
    } catch { return { status: "failed" }; }
    if (taken.abort) return { status: taken.status ?? "failed" };
    if (!usable) {
      await endlessRing(env, bells, say);
      await endlessLog(env, events);
      return { status: "making", button: lane.button };
    }
    let out;
    try {
      out = await replacePlaylistSafely(env, { pl: { id: lane.playlist, name: "Guest DJ", catalog: "spotify", via: "endless" },
        uris: usable.uris, budget, endless: true,
        description: `Guest DJ · ${who.name}, from "${usable.title}", ${new Date(now).toISOString().slice(0, 10)}.` });
    } catch (e) {
      // A copy that threw before or while writing is undone like one that
      // said it failed (Codex's fix check 1).
      out = { ok: false, what_happened: String(e?.message ?? e) };
    }
    if (out.ok === false) {
      // The copy did not land: the lane is not theirs over the last DJ's
      // songs (Codex's review 2).
      await laneUndo(env, taken.tenancy);
      await endlessLog(env, [...events, { at: now, btn: lane.button, event: "lane-copy-failed", detail: String(out.what_happened ?? "").slice(0, 200) }]);
      return { status: "failed" };
    }
    await laneReady(env, taken.tenancy);
    await dropPauseNoteFor(env, lane.playlist);
    const started = await start(lane.playlist, `Guest DJ · ${who.name}`);
    await endlessLog(env, [...events, { at: now, btn: lane.button, event: "lane-started", detail: `${usable.uris.length} songs on ${device}: ${started}` }]);
    return { status: "started", button: lane.button, program: usable.title, start: started };
  } finally {
    await laneUnlock(env, lockId);
  }
}
// The lane's songs are on: ready, if it is still that tenancy.
export async function laneReady(env, tenancy) {
  try {
    await endlessUpdate(env, (st) => {
      if (!st.lane || (Number(st.lane.tenancy) || 0) !== tenancy) return { abort: true };
      st.lane.ready = true;
      return {};
    });
  } catch { /* the watch leaves a not-ready lane alone; the next Play takes it again */ }
}
// A takeover whose songs never landed: nobody is the guest DJ.
export async function laneUndo(env, tenancy) {
  try {
    await endlessUpdate(env, (st) => {
      if (!st.lane || (Number(st.lane.tenancy) || 0) !== tenancy) return { abort: true };
      st.lane = { ...st.lane, dj: null, ready: true };
      return {};
    });
  } catch { /* it stays not-ready, and the watch leaves it alone */ }
}
export async function endlessStartFresh(env, { button, device }) {
  const cfg = parseEndless(env);
  if (!cfg || cfg.mode !== "live" || !env?.STATION) return { status: "off" };
  const now = Date.now();
  const events = [];
  const say = (btn, event, detail) => events.push({ at: now, btn, event, detail });
  const bells = [];
  let r;
  try {
    r = await endlessUpdate(env, (state) => {
      events.length = 0; bells.length = 0;
      endlessDay(env, state, now);
      const p = endlessPresets(env, cfg, state).find((x) => x.button === button && !x.program);
      if (!p) return { abort: true, status: "off" };
      // One fresh set at a time per preset: a waiting one takes the speaker.
      const waiting = Object.values(state.jobs).find((j) => j?.btn === p.button && j?.kind === "fresh" && !j.done);
      if (waiting) {
        waiting.device = device;
        waiting.deviceAt = now;
        say(p.button, "start-fresh", `the fresh set being made will start on ${device}`);
        return { status: "asked" };
      }
      if ((state.runs ?? 0) >= cfg.dailyRuns) return { abort: true, status: "day-cap" };
      endlessFile(state, { id: `endless-${p.button}-fresh-${now}`, kind: "fresh", btn: p.button, dj: p.dj,
        playlist: p.playlist, minutes: p.freshMinutes, at: now, device, deviceAt: now, gen: Number(state.gen[String(p.button)]) || 0 }, bells);
      say(p.button, "start-fresh", `asked for a fresh ${p.freshMinutes}-min set, to start on ${device}`);
      return { status: "asked" };
    });
  } catch { return { status: "failed" }; }
  if (r.abort) return { status: r.status ?? "failed" };
  await endlessRing(env, bells, say);
  await endlessLog(env, events);
  return { status: "asked" };
}
export async function endlessPageSteer(env, { button, words }) {
  const cfg = parseEndless(env);
  if (!cfg || cfg.mode !== "live" || !env?.STATION) return { status: "off" };
  if (await throttledUntil(env)) return { status: "throttled" };
  const slot = cfg.presets.find((x) => x.button === button);
  if (!slot) return { status: "off" };
  let pl = null;
  try { pl = await playerState(env); } catch { return { status: "unknown" }; }
  const onIt = pl?.is_playing === true && String(pl?.context?.uri ?? "") === `spotify:playlist:${slot.playlist}`;
  if (!onIt) return { status: "not-playing" };
  const text = typeof words === "function" ? words(pl) : words;
  const now = Date.now();
  const events = [];
  const say = (btn, event, detail) => events.push({ at: now, btn, event, detail });
  const bells = [];
  let r;
  try {
    r = await endlessUpdate(env, (state) => {
      events.length = 0; bells.length = 0;
      endlessDay(env, state, now);
      const p = endlessPresets(env, cfg, state).find((x) => x.button === button && !x.program);
      if (!p) return { abort: true, status: "off" };
      if ((state.runs ?? 0) >= cfg.dailyRuns) return { abort: true, status: "day-cap" };
      const s = state.sessions[String(p.button)] ?? { start: now, misses: 0, topups: 0, device: pl?.device?.name ?? null };
      s.steer = { words: text, at: now };
      state.sessions[String(p.button)] = s;
      endlessFile(state, { id: `endless-${p.button}-steer-${now}`, kind: "steer", btn: p.button, dj: p.dj,
        playlist: p.playlist, minutes: steerMinutes(p), at: now, words: text, when: "next" }, bells);
      say(p.button, "steer", `"${text}", from the DJ page`);
      return { status: "asked" };
    });
  } catch { return { status: "failed" }; }
  if (r.abort) return { status: r.status ?? "failed" };
  await endlessRing(env, bells, say);
  await endlessLog(env, events);
  return { status: "asked", words: text };
}

// THE STEER'S WRITE (MC-23): everything after the playing song becomes
// `uris`, and with `now` the speaker jumps to the first of them. Not through
// the safe replace: what is replaced is only the queue after the playing
// song, which nobody has heard — the DJ's history keeps it and the Shelf
// keeps a program as made — and the safe path would also rewrite whose set
// the guest names. The door's guard is asked all the same on the guest.
export async function endlessGuard(env, p) {
  const guest = guestForPlaylistId(env, p.playlist);
  if (!guest?.live) return;
  let busy = null;
  try { busy = (await station(env, "destination-busy", { destination: p.playlist }))?.busy ?? null; } catch { busy = null; }
  if (busy) throw new Error(guestBusyWords(findDj(env, busy.dj)?.name, "Spotify"));
}
export async function steerWrite(env, p, player, uris, { now = false, budget = null, fromIdx = 0, lockHeld = false } = {}) {
  if (p.lane && !lockHeld) {
    const id = `steer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const got = await laneLock(env, { id, tenancy: p.tenancy });
    if (got !== "ok") throw new Error(got === "moved"
      ? "the guest DJ changed since this steer began. Nothing was changed."
      : "another write is landing on the guest DJ's list; try again in a moment. Nothing was changed.");
    try { return await steerWrite(env, p, player, uris, { now, budget, fromIdx, lockHeld: true }); }
    finally { await laneUnlock(env, id); }
  }
  await endlessGuard(env, p);
  const tracks = await endlessTracks(env, p.playlist);
  const at = endlessLeft(tracks, player?.item?.uri, player?.progress_ms, fromIdx);
  // Autoplay past the end, or a song not on the list: keep the whole list
  // and jump, since "after this song" has no place in it.
  const head = at ? tracks.slice(0, at.idx + 1).map((t) => t[0]) : tracks.map((t) => t[0]);
  const next = [...head, ...uris];
  const cat = catalogFor(env, "spotify");
  await cat.replaceItems(p.playlist, next.slice(0, cat.batch));
  for (let i = cat.batch; i < next.length; i += cat.batch) await cat.appendItems(p.playlist, next.slice(i, i + cat.batch));
  await dropPauseNoteFor(env, p.playlist);
  let jumped = null;
  if ((now || !at) && player?.device?.name) {
    await startPlaylistOnDevice(env, { id: p.playlist, name: findDj(env, p.dj)?.name ?? p.dj, catalog: "spotify" },
      player.device.name, budget ?? { remaining: 16 }, { uri: uris[0], positionMs: 0 });
    jumped = player.device.name;
  }
  await endlessWrote(env, p.playlist, next);
  return { replaced: tracks.length - head.length, headLen: head.length, jumped };
}

// How many re-saves are actually outstanding: one per preset PER BOX, because
// each is a separate trip to the WiiM app. This is the number on the wall's
// Speakers chip.
// THE COUNT THE SPEAKERS TAB WEARS (MC-14). Every keyed page draws the bar,
// so every keyed page reads this; a failed read is a bare tab, not a 500.
// Since stage 6 (2026-09-26) that is the endless presets alone: the guests'
// re-save ledger went with the checklist, and a guest's name or playlist
// changed in config shows on the Speakers keys from the speakers' own reading.
export async function tabOwed(env) {
  return endlessOwedCount(env);
}
// THE ENDLESS PRESETS A SPEAKER STILL NAMES FOR THE DJ WHO LEFT (MC-24):
// [{ btn, name, speakers: [{ name, slug }] }] — the app renamed the
// playlist, and a speaker takes a name only when the preset is saved again.
// A speaker with no reading owes nothing anyone can see.
export function endlessOwed(env, slots, recs) {
  const boxes = parseSpeakers(env);
  return slots.map((x) => ({ btn: x.button, name: x.name, speakers: boxes.filter((sp) => {
    const row = recs[sp.slug]?.presets?.find((r) => r.btn === x.button);
    return row && !sameName(row.name, x.name);
  }) })).filter((o) => o.speakers.length);
}
export async function endlessOwedCount(env) {
  const cfg = parseEndless(env);
  if (cfg?.mode !== "live" || !env?.STATION) return 0;
  try {
    const slots = endlessSlots(env, cfg, await endlessLoad(env));
    const recs = await readReadings(env, parseSpeakers(env));
    // Presets, not presets times speakers (the review, 2026-10-09: three
    // presets owed on two speakers read as a bare "6").
    return endlessOwed(env, slots, recs).length;
  } catch { return 0; }
}
// WHAT THE BAR NEEDS (MC-15): the count, and whether the house has a voice.
// The Talk tab is drawn only where OPENAI_API_KEY is set; the Talk page and
// its doors are 404 without it, so an unset house shows nothing shut.
export const talkOn = (env) => !!env.OPENAI_API_KEY;
export async function tabState(env) {
  // `loaded`: the Loaded tab, only in a house whose WiiMs it can read (tabBar).
  return { owed: await tabOwed(env), talk: talkOn(env), loaded: parseSpeakers(env).length > 0 };
}
