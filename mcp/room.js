// THE ROOM: the roster of presets, the speakers the play form may name, the
// tile cache, the WiiMs and their readings, and the DJs' faces on the keys.
// Split out of worker.js on 2026-09-26 (consolidation).
import { PERSONAS } from "./djs.js";
import { ARCHIVE } from "./archive-identity.js";
import { houseDay } from "./voice.js";
import { readingFrom } from "./keymap.js";
import { catalogOfUri } from "./catalog.js";
import { atWords, findDj, house, houseClockWords, newestOn } from "./house.js";
import { SERVICES, playlistItems, programsKV, totalDuration } from "./services.js";
import { listProgramSummaries, pickImage } from "./shelf.js";

export const ROOM_TILE_TTL_MS = 10 * 60 * 1000;
// LONGER THAN THE PAGE'S OWN REFRESH (2026-09-06). The DJ page reloads itself
// every 60 seconds while a request is in flight, and this was 90 — so a page
// left open on a phone re-read and re-cached the tracklist about every ninety
// seconds, all day, at two KV writes a time. Five minutes is clear of the
// refresh, and every write through this server deletes the entry anyway, so a
// set that lands is never waited for.
export const ITEMS_TTL_MS = 5 * 60 * 1000;
// How old a cached tile may be and still stand in when the refresh fails. Past
// this the grid shows a card without numbers rather than a deleted playlist's
// old count and cover, indefinitely, as if it were current.
export const ROOM_TILE_STALE_MAX_MS = 24 * 60 * 60 * 1000;

// How recently a programme must have been published for its button to be
// marked "new" on the wall. A WINDOW, not "a programme is loaded" — that is
// true of most buttons most of the time and would pin the marker on forever,
// which is a badge that cannot be false and so says nothing.
//
// TWENTY-FOUR HOURS, cut from seven days on 2026-09-09. The seven-day span was
// reasoned from the reader — "long enough that somebody told about a set has
// probably not heard it" — and it ignored the writing RATE. This house cuts
// sets most days across a dozen DJs, so a week-wide window caught nearly every
// button at once and the owner had a wall of red flags: a badge that marks
// everything marks nothing, which is the same failure its own comment warns
// about, arrived at from the other end. A day is what "new" can mean on a wall
// that changes daily. If the house ever goes quiet for weeks, this is the
// number to raise again — the window should track how often sets are cut, not
// how long a person takes to listen.
export const ROOM_NEW_PROGRAM_MS = 24 * 60 * 60 * 1000;

// The one tile that is not a DJ. Its button comes from the house like the
// others' — `{ button = 6, archive = true }` — and a house with no such entry
// has no archive on the wall and no card for it.
// The persona the archive's requests are filed against. Named once: the page
// slug is "archive" and the DJ key is not, and two places guessing at that
// relationship is how a request ends up filed against nobody.
export const ARCHIVE_DJ = ARCHIVE.dj;

export const ROOM_ARCHIVE_TILE = {
  key: "archive", name: ARCHIVE.name, unit: "takes",
  summary: ARCHIVE.tileSummary,
  // What the DJs tab's square says under the name (2026-09-24).
  programsBy: PERSONAS[ARCHIVE.dj]?.programsBy ?? null,
};

// The grid, in two zones.
//
// THE WALL is the buttons: every preset this house has, in number order,
// each carrying whoever is on it or saying that nobody is. It is one row per
// BUTTON, not per DJ, which is the change the tenancy makes here — a button
// with nobody on it used to have no row at all and simply vanished from the
// page, and an empty button is not an exotic state: it arrives whenever a
// placed DJ moves somewhere else.
//
// THE BENCH is everyone else. It used to be a card saying "not on a button
// here", which is the right sentence for an edge case and the wrong one for
// most of a page once a house has more DJs than presets.
//
// An empty button's line is worded from the wall and costs no read. A move
// never clears the button it vacates, so "still holds X's last set" is true
// by construction; a slot installed empty has nobody to name and says so.
export function roomRoster(env) {
  const h = house(env);
  const onWall = new Set();
  const wall = [];
  for (const b of [...h.buttons, ...h.fixed].sort((a, c) => a.btn - c.btn)) {
    if (b.fixed) {
      wall.push({ zone: "wall", key: null, fixed: true, btn: b.btn, button: b.button, label: b.label });
      continue;
    }
    // A guest preset (MC-18): on the wall under its saved name, on its
    // service, nobody's — and until it is live, a slot that says so.
    if (b.guest) {
      wall.push({ zone: "wall", key: null, guest: true, live: b.live, name: b.name,
        btn: b.btn, button: b.button, catalog: b.catalog, playlist: b.playlist });
      continue;
    }
    if (b.archive) {
      wall.push({ ...ROOM_ARCHIVE_TILE, zone: "wall", btn: b.btn, button: null });
      continue;
    }
    if (b.key) {
      const dj = h.djs[b.key];
      onWall.add(b.key);
      wall.push({
        zone: "wall", key: dj.key, name: dj.name, summary: dj.summary,
        button: dj.button, btn: dj.btn, unit: "tracks", catalog: dj.catalog,
        programsBy: dj.programsBy, colour: dj.colour ?? null,
        ...(dj.endless === false ? { noEndless: true } : {}),
        ...(dj.needsWords ? { needsWords: dj.needsWords } : {}),
      });
      continue;
    }
    wall.push({
      zone: "wall", key: null, empty: true, btn: b.btn, button: b.button,
      catalog: b.catalog, left: b.left ? (h.djs[b.left]?.name ?? null) : null,
    });
  }
  const bench = h.roster
    .filter((dj) => !onWall.has(dj.key))
    .map((dj) => ({
      zone: "bench", key: dj.key, name: dj.name, summary: dj.summary,
      button: null, btn: 99, unit: "tracks",
      catalog: null,
      programsBy: dj.programsBy, colour: dj.colour ?? null,
      ...(dj.endless === false ? { noEndless: true } : {}),
      ...(dj.needsWords ? { needsWords: dj.needsWords } : {}),
    }));
  return [...wall.sort((a, b) => a.btn - b.btn), ...bench];
}

// Which speakers the play form may name. Config, not discovery: a form field
// must not be able to aim the account at an arbitrary device name, and a
// /devices read per render would spend budget answering a question whose
// answer is a household constant.
// The speaker a play with none named goes to: the default, else the first
// room, else none (an empty string for the pages, which print it).
export const fallbackDevice = (env) => env.DEFAULT_DEVICE || parseRoomDevices(env)[0] || "";
// WHICH SPEAKERS ARE WIIMS (MC-31, the owner, 2026-10-17: "my house only
// sees the 2 WiiM devices and whatever the current active non-WiiM device
// is"). A house with WiiM addresses knows from them; a door-made house was
// asked at setup (WIIM_NAMES, names only, no address); one never asked
// counts every speaker it keeps.
export function wiimNames(env) {
  const boxes = parseSpeakers(env);
  if (boxes.length) return boxes.map((b) => b.name);
  const rooms = parseRoomDevices(env);
  if (!env.WIIM_NAMES) return rooms;
  try {
    const said = JSON.parse(env.WIIM_NAMES);
    return Array.isArray(said) ? rooms.filter((r) => said.includes(r)) : rooms;
  } catch { return rooms; }
}
export function parseRoomDevices(env) {
  // A house with no default names no speaker (the trial, 2026-10-17: a
  // blank house's bar said "Pro Plus", the code's old stand-in).
  const fallback = env.DEFAULT_DEVICE ? [env.DEFAULT_DEVICE] : [];
  if (!env.ROOM_DEVICES) return fallback;
  try {
    const list = JSON.parse(env.ROOM_DEVICES);
    const names = (Array.isArray(list) ? list : [])
      .map((d) => String(d).trim()).filter((d) => d && d.length <= 60);
    return names.length ? names : fallback;
  } catch {
    return fallback;
  }
}

// A button's card: name, count, runtime, cover. Cached in KV for ten minutes
// because eight fresh tiles cost sixteen external calls against a ceiling of
// fifty; every write through this server deletes the entry, so the cache can
// only be stale about edits made in the Spotify app — which the captions
// already refuse to overclaim about. Degrades to the stale copy, then to
// nothing: a tile without numbers beats a page that throws.
// WHAT THIS SERVER LEFT ON A PLAYLIST, so a later read can tell whether
// somebody has edited it by hand since (the owner, 2026-09-06, asking what
// happens if they add tracks to Kurt's playlist in the Tidal app).
//
// Nothing here watches a playlist, and no service tells us. What we can do is
// write down what we left and compare. The consequence that matters is not
// cosmetic: a preset carries a POINTER to the programme loaded on it, and that
// pointer is a name rather than a comparison — the programme page asks "does
// this playlist still claim me" and never "does it still contain me". So a
// hand-edited playlist went on offering a public listen link for a set that
// was no longer there. A drift clears the pointer, and the page stops
// claiming.
//
// The fingerprint is FNV-1a over the URIs in order: a count catches tracks
// added or removed, the hash catches a reorder or a swap that keeps the count.
export const MARK_TTL_S = 180 * 24 * 3600;
export function fingerprint(uris) {
  let h = 0x811c9dc5;
  for (const u of uris) {
    for (let i = 0; i < u.length; i++) {
      h ^= u.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x0a;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export async function writeMark(env, pid, uris) {
  try {
    await programsKV(env).put(`mark:${pid}`, JSON.stringify({
      n: uris.length, h: fingerprint(uris), at: new Date().toISOString(),
    }), { expirationTtl: MARK_TTL_S });
  } catch { /* a mark that fails to land only costs the next read its warning */ }
}

// Has the playlist moved since we last wrote it? `uris` is the exact answer;
// `count` is the cheap one, which catches tracks added or taken away and is
// what a tile read already has in hand. No mark means no claim either way —
// a playlist written before this existed is not evidence of anything.
export async function driftOf(env, pid, { uris = null, count = null }) {
  let mark = null;
  try { mark = await programsKV(env).get(`mark:${pid}`, { type: "json" }); } catch { return null; }
  if (!mark || typeof mark.n !== "number") return null;
  const now = uris ? uris.length : count;
  if (typeof now !== "number") return null;
  const drifted = uris ? (uris.length !== mark.n || fingerprint(uris) !== mark.h) : now !== mark.n;
  if (!drifted) return null;
  // The pointer is the thing that was lying, so it goes here rather than
  // waiting for the next write. Best effort: a page that still claims is the
  // state we are already in, and failing to clear it changes nothing.
  try { await programsKV(env).delete(`current:${pid}`); } catch { /* as it was */ }
  return { was: mark.n, now, since: mark.at, exact: !!uris };
}

// ONE KEY FOR EVERY TILE, not one per preset (2026-09-06). The wall reads all
// eleven together, every time, and never one on its own — so a cold cache cost
// TEN KV WRITES per page load, and Cloudflare's free tier allows a thousand a
// day. Measured that evening at 50% of the daily cap with an hour and a half
// still to run. A cache split across keys that are always read together was
// the wrong shape before it was a billing problem.
//
// `cache` is how the wall keeps it to one read and one write: the caller reads
// the map once, hands it to every tileFor, and writes it back at the end if
// anything changed. A caller with one preset (the DJ page) passes nothing and
// gets the same read-modify-write on its own.
export const TILES_KEY = "tiles";
export async function readTiles(env) {
  try {
    const doc = await programsKV(env).get(TILES_KEY, { type: "json" });
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  } catch { return {}; }
}
// Last writer wins on the whole map, so two page loads a moment apart can lose
// each other's fresh tile. The cost of losing one is one extra read of a
// playlist that was already going to be read; the cost of a key apiece was the
// daily cap. Re-read before writing, which narrows the window to the write
// itself.
export async function writeTiles(env, changed) {
  try {
    const now = await readTiles(env);
    await programsKV(env).put(TILES_KEY, JSON.stringify({ ...now, ...changed }));
  } catch { /* a cache that fails to save costs the next load a read */ }
}
export async function dropTile(env, pid) {
  try {
    const now = await readTiles(env);
    if (!(pid in now)) return;
    delete now[pid];
    await programsKV(env).put(TILES_KEY, JSON.stringify(now));
  } catch { /* the stale tile is a cache and ages out on its own */ }
}

// `serveStale`: a tile past its ten minutes but under a day is answered as
// it is, marked stale, and its id put on `cache.refresh` for the caller to
// re-read AFTER the response (the wall, 2026-09-12: a cold wall re-read
// eleven playlists in front of the page, six seconds on a slow morning).
export async function tileFor(env, cat, pid, budget, cache = null, { serveStale = false } = {}) {
  let cached = null;
  if (cache) cached = cache.map[pid] ?? null;
  else {
    try { cached = (await readTiles(env))[pid] ?? null; } catch { /* cache */ }
  }
  // A cached ZERO is trusted for a minute, not ten. Every write through this
  // server clears the tile, but a set added in the Spotify app does not, and
  // the count now decides whether a card offers Play at all — so a stale zero
  // hid the control on a full button. A minute is the cost of that one case;
  // any other count keeps the ten.
  const age = Date.now() - (cached?.at ?? 0);
  if (cached && age < ROOM_TILE_TTL_MS && !(cached.count === 0 && age > 60_000)) return cached;
  // A stale ZERO is still read in front of the page: it decides whether the
  // card offers Play at all, and "nothing on this button" a day late is the
  // wrong thing to draw on a preset that was filled since.
  if (serveStale && cache && cached && cached.count !== 0 && age < ROOM_TILE_STALE_MAX_MS) {
    (cache.refresh ??= []).push(pid);
    return { ...cached, stale: true };
  }
  try {
    const [meta, read] = await Promise.all([
      cat.playlist(pid),
      playlistItems(cat, pid, budget, 200),
    ]);
    const t = {
      name: meta.name ?? null,
      count: read.total,
      runtime: totalDuration(read.items.filter(Boolean)),
      cover: pickImage(meta.images) ?? null,
      at: Date.now(),
    };
    // The count alone, which this read already has: it catches tracks added
    // or taken away in the service's own app, which is the case that happens.
    // A swap that keeps the count is caught by read_playlist, where the URIs
    // are in hand. Cached with the tile, and every write clears both.
    const moved = await driftOf(env, pid, { count: read.total });
    if (moved) t.drifted = { was: moved.was, now: moved.now, since: moved.since };
    if (cache) { cache.map[pid] = t; cache.dirty = true; }
    else await writeTiles(env, { [pid]: t });
    return t;
  } catch {
    const fresh = cached && Date.now() - (cached.at ?? 0) < ROOM_TILE_STALE_MAX_MS;
    return fresh ? { ...cached, stale: true } : null;
  }
}

// #EXTINF lines out of the archive m3u — the only per-take metadata this
// transport carries, and this server wrote them, so they are trustworthy here
// in a way the speaker's own display is not.
export function parseM3uEntries(text) {
  const out = [];
  let pending = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^#EXTINF:(\d+)\s*,(.*)$/);
    if (m) { pending = { secs: Number(m[1]), title: m[2].trim() }; continue; }
    if (/^https?:\/\//.test(line)) {
      out.push(pending ?? { secs: 0, title: "(untitled)" });
      pending = null;
    }
  }
  return out;
}

// The speakers by name and LAN address, from config, so the setup page can
// print a recipe with nothing left to look up. Optional: a house without
// the var gets the recipe with a blank where the address goes.
export function parseSpeakers(env) {
  let raw = env.WIIM_SPEAKERS;
  try { if (typeof raw === "string") raw = JSON.parse(raw); } catch { raw = null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(([n, ip]) => typeof n === "string" && n.trim() && typeof ip === "string" && /^[0-9a-zA-Z.:-]{1,64}$/.test(ip))
    .map(([name, ip]) => ({ name: name.trim(), ip, slug: speakerSlug(name) }));
}
export function speakerSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "speaker";
}

// A SPEAKER'S PRESET TABLE, AS A PHONE LAST READ IT (2026-09-13): one KV
// record per speaker, overwritten by each run of the "Read WiiM Presets"
// shortcut and stamped with the server's own time, never the phone's.
export const READING_MAX_BYTES = 64 * 1024;
export const readingKey = (slug) => `reading:${slug}`;
export async function readReadings(env, boxes) {
  const out = {};
  await Promise.all(boxes.map(async (sp) => {
    let rec = null;
    try { rec = await programsKV(env).get(readingKey(sp.slug), { type: "json" }); } catch { rec = null; }
    out[sp.slug] = rec && typeof rec === "object" && Array.isArray(rec.presets) ? rec : null;
  }));
  return out;
}
// The readings as the pages draw them, each with when it was read in words,
// and the newest reading's time, which a Loaded tab left open compares.
export function readingsShown(env, recs) {
  return {
    readings: Object.fromEntries(Object.entries(recs).map(([slug, rec]) =>
      [slug, rec ? { ...rec, when: atWords(houseClockWords(env, rec.at)) } : null])),
    readAt: newestOn(Object.values(recs).filter(Boolean)),
  };
}
// A speaker's preset table kept, from the phone's shortcut or (MC-25) the
// home helper: the same parse, the same record, the server's own time.
export async function keepReading(env, box, text, by = "shortcut") {
  let presets;
  try {
    presets = readingFrom(text, { dayOf: (ms) => {
      try { return houseDay(env, ms); } catch { return new Date(ms).toISOString().slice(0, 10); }
    } });
  } catch (err) {
    return { ok: false, bad: err.message };
  }
  const at = new Date().toISOString();
  try {
    await programsKV(env).put(readingKey(box.slug), JSON.stringify({ at, speaker: box.name, presets, by }));
  } catch {
    return { ok: false };
  }
  console.log(`readings:${box.slug} presets=${presets.length} by=${by}`);
  return { ok: true, at, presets };
}
// What the phone shows after a run: the speaker, when, and a line a preset.
export function readingWords(name, presets, when) {
  if (!presets.length) return `${name}, read ${when}: nothing is saved on any preset.`;
  return `${name}, read ${when}:\n` + presets.map((p) =>
    `${p.btn}  ${p.name}${p.source ? ` (${p.source})` : ""}`).join("\n");
}

// A face out of art/covers/ as base64, for a cover upload. Through the same
// assets binding the /covers route serves from, so the picture a swap puts on
// the playlist is byte-for-byte the one these pages draw. Null when the
// binding is missing or the file is — a swap must not fail on a picture.
//
// `nobody` is a real file there, and the only key this reads that is not a
// roster key: the plain sleeve a vacated playlist wears so the Spotify app
// stops showing the face of a DJ who has left.
export async function faceBase64(env, key) {
  if (typeof env.COVERS?.fetch !== "function") return null;
  if (!/^[a-z0-9-]{1,40}$/.test(String(key ?? ""))) return null;
  try {
    const res = await env.COVERS.fetch(
      new Request(`https://covers.invalid/${key}.jpg`, { method: "GET" }));
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  } catch {
    return null;
  }
}

// Put a face on a playlist, best-effort. Only Spotify takes one; a Tidal
// button is skipped in silence because the seam already says why and the
// swap's own warning covers the remote. A missing file, a token without the
// scope, a 4xx — each is one warning and never a failed swap.
export async function wearFace(env, cat, pid, key, what) {
  if (cat.name !== "spotify") return null;
  const b64 = await faceBase64(env, key);
  if (!b64) {
    return `${what} keeps its previous cover in the Spotify app — the face for ` +
      `"${key}" could not be read from art/covers/.`;
  }
  try {
    await cat.cover(pid, b64);
    return null;
  } catch (e) {
    return `${what} keeps its previous cover in the Spotify app (${e.message}). ` +
      "Cosmetic — art/upload-covers.sh puts the right faces on by hand.";
  }
}

// WHAT A DJ ARRIVES WITH.
//
// A swap used to leave the button empty, which is a dead button: pressing it
// does nothing at all (measured on the speaker, 2026-09-04). But the incoming
// DJ may already have published work, and the occupancy rule has always said
// published work belongs to the DJ and follows them — so it follows them here,
// and the button is alive the moment the swap finishes.
//
// NEWEST PLAYABLE, not simply newest. A programme's tracks belong to the
// service it was written on, and a button is one service or the other: Hank's
// most recent set at the time of writing was cut during the Tidal test and his
// button is Spotify, so "newest" would have picked the one thing that cannot
// land. This walks the shelf newest-first and takes the first that fits.
//
// KV reads only — no subrequests — and capped, because a DJ with a long shelf
// and nothing playable would otherwise read all of it.
export const ARRIVAL_SCAN = 12;

export async function arrivingSet(env, dj, cat) {
  let summaries;
  try { summaries = await listProgramSummaries(env); } catch { return null; }
  const mine = summaries.filter((s) => findDj(env, s.dj ?? "")?.key === dj.key);
  for (const s of mine.slice(0, ARRIVAL_SCAN)) {
    let rec = null;
    try { rec = await programsKV(env).get(`program:${s.id}`, { type: "json" }); } catch { continue; }
    if (!rec) continue;
    const uris = (rec.sections ?? []).flatMap((sec) =>
      (sec.tracks ?? []).map((t) => t?.uri).filter(Boolean));
    if (!uris.length) continue;
    if (uris.some((u) => catalogOfUri(u) !== cat.name)) continue;
    return { slug: s.id, title: rec.title ?? s.id, uris, rec };
  }
  return null;
}

// A service this house can actually sign in to. The switcher must never offer
// a preset a service with no client id, which would fail at the first call
// with a sentence about configuration in front of somebody holding a phone.
export function catalogAvailable(env, name) {
  const svc = SERVICES[name];
  return !!(svc && env[svc.clientId]);
}
