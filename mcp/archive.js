// THE ARCHIVE (whose, archive-identity.js): its index and cache, stream URLs, and the station
// window the archive preset plays from.
// Split out of worker.js on 2026-09-26 (consolidation).
import { TEMPLATE_VERSION, clock } from "./programs.js";
import { PERSONAS } from "./djs.js";
import { house } from "./house.js";
import { ARCHIVE_DJ } from "./room.js";
import { programsKV, subrequest, tokensKV } from "./services.js";
import { programCatalog } from "./shelf.js";
import { PROGRAM_TITLE_MAX } from "./toollist.js";

// ---------------------------------------------------------------- archive
//
// The live-recording archive behind the archive's own site (house.json
// `archive.siteUrl`). Both files are already public — the site itself fetches them — so nothing is
// duplicated here and nothing needs a credential.

// WHOSE ARCHIVE, from config (2026-09-07). These were constants naming one
// household's website, which meant two things: every install carried that
// domain, and the archive was usable by exactly one house because nothing else
// could point it anywhere. They come off `house.json` now. No fallback on
// purpose — a house with an archive button and no index configured is a
// misconfiguration, and silently reading somebody else's recordings is a worse
// answer than saying so.
export function archiveIndexUrls(env) {
  const occ = String(env.ARCHIVE_OCCURRENCES_URL ?? "").trim();
  const spec = String(env.ARCHIVE_TRACKS_URL ?? "").trim();
  if (!occ || !spec) {
    throw new Error(
      "this house has an archive button but no archive index configured — set " +
      "archive.occurrencesUrl and archive.tracksUrl in house.json, run " +
      "`npm run config`, and deploy. The recordings and the index are yours to " +
      "host; this server only reads the list.");
  }
  return [occ, spec];
}

// 1.3 MB across the two files. Parsing that on every call would cost more than
// the search does, so memoise per isolate and let the edge cache absorb the rest.
export let archiveCache = null;

export function archiveSeconds(dur) {
  const m = /^(\d+):(\d\d)$/.exec(String(dur ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function archiveClock(s) {
  if (s == null) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function loadArchive(env, budget) {
  if (archiveCache && Date.now() - archiveCache.at < 3600_000) return archiveCache.data;
  if (budget && budget.remaining < 2) {
    throw new Error(
      "out of per-request lookup budget before the archive could be read — " +
      "call search_archive on its own");
  }

  const opts = { cf: { cacheEverything: true, cacheTtl: 3600 } };
  const [occUrl, specUrl] = archiveIndexUrls(env);
  const [occRes, specRes] = await Promise.all([
    subrequest(env, occUrl, opts),
    subrequest(env, specUrl, opts),
  ]);
  if (!occRes.ok || !specRes.ok) {
    // Whoever hosts the index serves these, not this Worker. Name the host, or
    // the next reader debugs the wrong system.
    const host = (() => { try { return new URL(occUrl).hostname; } catch { return "the index host"; } })();
    throw new Error(
      `archive data unavailable (${occRes.status}/${specRes.status}) from ` +
      `${host} — that is that site's outage, not this Worker's`);
  }
  const [occ, spec] = await Promise.all([occRes.json(), specRes.json()]);

  // track-spec carries the audio analysis; song-occurrences carries the
  // grouping. The join is slug + zero-padded track number, and it is total —
  // 680/680 as of 2026-08-26. A miss leaves the analysis fields null rather
  // than dropping the take, because a take with no loudness data is still a
  // take you can play.
  const byId = new Map((spec ?? []).map((t) => [t.id, t]));
  const takes = [];
  for (const [songSlug, entry] of Object.entries(occ ?? {})) {
    for (const o of entry.occ ?? []) {
      // The join key is ALSO the archive site's track id — the site builds its
      // catalog from this same file, so `<show-slug>-<NN>` is what its player
      // resolves (verified 2026-09-07: every take of the first parked set maps
      // and exists there). Kept on the take, because a programme page links a
      // whole set into that player by these ids.
      const siteId = `${o.slug}-${String(o.num).padStart(2, "0")}`;
      const t = byId.get(siteId);
      // Song identity is the top-level key and entry.title, NOT the fields on
      // the occurrence: `o.slug` names the SHOW ("mad-marin-brewing-co-1998-04-01")
      // and `o.title` carries per-take variants — "(incomplete)", "(alt
      // version)", and in a few rows nothing but stray whitespace. 31 of the 136
      // songs have at least one take whose title differs from the canonical.
      const variant = String(o.title ?? "").trim();
      takes.push({
        ref: o.code,
        siteId,
        song: entry.title,
        songSlug,
        ...(variant && variant !== entry.title ? { variant } : {}),
        showSlug: o.slug,
        artist: o.artist_name,
        venue: o.venue,
        // Dates are mostly ISO but not all: "1999-12" and "Unknown date" both
        // occur, so never parse one as a Date.
        date: o.date,
        year: /^\d{4}/.test(o.date ?? "") ? Number(String(o.date).slice(0, 4)) : null,
        seconds: archiveSeconds(o.duration),
        duration: o.duration,
        source: o.source,
        file: o.file,
        ver: o.ver,
        loudFile: o.loud ?? null,
        loudVer: o.loud_ver ?? null,
        dynamics: t?.lra ?? null,
        dropouts: t?.dropouts ?? null,
        tags: t?.tags ?? [],
        songwriter: t?.songwriter ?? null,
        performer: t?.performer ?? null,
      });
    }
  }
  const songs = [...new Map(Object.entries(occ ?? {}).map(([slug, v]) =>
    [slug, { song: v.title, slug, takes: (v.occ ?? []).length }])).values()];

  const data = { takes, songs, byRef: new Map(takes.map((t) => [t.ref, t])) };
  archiveCache = { at: Date.now(), data };
  return data;
}

// The audio itself is served by a different Worker in front of R2. The `v` is a
// content hash for cache-busting; the URL works without it, but sending it keeps
// a re-processed take from being served stale.
//
// **Always the -14 LUFS "Loud" master, never the -20 archive master.** Spotify
// normalises to roughly -14, and buttons 1-5 are Spotify — an archive set built
// from the -20 files is about 6 dB quieter than every other button, which reads
// as a broken speaker rather than a quiet recording. `docs/dj-mode.md` says so
// and this is the code that has to honour it. All 680 takes have a loud master;
// the fallback exists only so a future take without one plays quietly instead of
// not at all.
//
// **The HOST is configuration (2026-09-08), and it was a constant until then.**
// The index moved into config on 2026-09-07 and this did not, so every install
// would still have streamed one household's recordings however its own archive
// was configured — bring-your-own that was not. It refuses rather than falling
// back for the same reason `archiveIndexUrls` does: silently serving somebody
// else's tapes is the worse answer, and a house that has said nothing has said
// nothing. The endpoint must take `?file=<key>&v=<hash>` and serve byte ranges,
// which is the contract the m3u and the range probe are both written against.
export function archiveStreamUrl(env, take) {
  const base = String(env.ARCHIVE_MEDIA_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "this house has an archive button but no archive media host configured — " +
      "set archive.mediaUrl in house.json, run `npm run config`, and deploy. " +
      "The recordings are yours to host; this server only names them.");
  }
  const file = take.loudFile || take.file;
  const ver = take.loudFile ? take.loudVer : take.ver;
  return `${base}?file=${encodeURIComponent(file)}&v=${ver}`;
}

// How many entries the speaker actually plays. Measured, not chosen: a preset
// starts at position N-2 and loops the last three, so anything earlier in the
// file is dead. See "The archive" in docs/handoff-history.md.
export const ARCHIVE_WINDOW = 3;

// THE ROTATING STATION (2026-09-06).
//
// Three is the hardware and does not move. But the other measured fact is that
// THE SPEAKER RE-READS THE M3U ON EVERY LOOP — rewriting KV mid-playback
// changed the titles within one cycle with nothing touched on the device. So
// the window is three and the FILE is ours, which means a set of any length can
// be fed through three at a time: each time the speaker comes back for the
// list, hand it the next three. 680 takes is about 45 hours before it repeats.
//
// WHAT MAKES THIS SAFE WITHOUT KNOWING THE RE-READ CADENCE. If the speaker asks
// twice in one cycle and the window advanced on each ask, three takes would be
// skipped in silence — the worst kind of bug, because nothing looks broken. So
// the ask is the TRIGGER and the clock is the GUARD: the window only moves once
// most of what was served has had time to play. A second ask inside that window
// gets the same three, whatever the device is doing.
//
// Set at 0.8 of the served duration: a speaker that re-reads at the top of each
// loop has played the whole window and moves on; one that re-reads every track
// does not.
export const STATION_GATE = 0.8;
export const STATION_KEY = (key) => `station:${key}`;
// Enough to hold every take in the archive twice over, and small enough that
// the record stays one KV value.
export const STATION_MAX = 400;

// THE SITE'S PLAYER (2026-09-07). The archive's site carries a playlist player
// whose whole queue is a URL: `/playlist/#p=<id>,<id>,…`, parsed client-side,
// unknown ids dropped, cued paused on track 1. No API and no account — so a
// programme page can hand a set to that player anywhere, while this server
// keeps the permanent record. The base is configuration (ARCHIVE_SITE_URL),
// because the day the site answers at a second hostname this must not need a
// deploy to follow it.
// No fallback host: unset means this house has no site player, and the record
// carries `site: null` — which every reader already handles, because a set with
// no site ids has always produced one. A default here would have put one
// household's domain on another's programme page.
export function archiveSiteUrl(env, takes) {
  const base = String(env.ARCHIVE_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const ids = takes.map((t) => t?.siteId).filter(Boolean);
  return ids.length ? `${base}/playlist/#p=${ids.join(",")}` : null;
}

// Park a set on the archive preset: the station record the m3u route turns
// through three at a time. One writer for it, shared by play_archive and by
// activateProgram putting a programme back on the button.
export async function parkStation(env, key, refs, { title = null, loop = true } = {}) {
  await tokensKV(env).put(STATION_KEY(key), JSON.stringify({
    refs, pos: 0, nextAt: null, loop: loop !== false,
    title: String(title ?? "").slice(0, 80) || null,
    at: new Date().toISOString(), asks: [],
  }));
}

// A PROGRAMME RECORD FOR AN ARCHIVE SET (2026-09-07). Every other DJ's work
// has a permanent page; a set parked on the archive left none, because the
// station is not a programme. This is the setlist shape renderProgram already
// prints, with three things only the archive has: `playlistId` is
// `archive:<key>` — so the existing `current:<playlistId>` pointer says
// whether the set is on the button with no renderer change — the tracks carry
// `archive:take:<ref>` uris, which serviceLink declines and the row prints as
// plain text, and `archive` names the preset and the site link.
export function archiveProgramRecord(env, { slug, key, takes, title, loop, requestId = null, ask = null }) {
  const slot = house(env).archive;
  const totalMs = takes.reduce((n, t) => n + (t.seconds ?? 0), 0) * 1000;
  const tracks = takes.map((t) => ({
    uri: `archive:take:${t.ref}`,
    title: t.variant ? `${t.song} (${t.variant})` : t.song,
    artist: t.artist,
    // Where and when: on these tapes that is the identity of a recording,
    // and the row prints it where a record's album goes.
    album: `${t.venue}, ${t.date}`,
    duration: t.duration,
    duration_ms: (t.seconds ?? 0) * 1000,
    year: t.year,
  }));
  return {
    slug,
    dj: PERSONAS[ARCHIVE_DJ].name,
    shape: "setlist",
    title: String(title || "Archive set").slice(0, PROGRAM_TITLE_MAX),
    thesis: `${takes.length} takes from the family tapes, three at a time on preset ${slot?.btn ?? "?"}.`,
    sections: [{ label: null, years: null, heading: null, prose: [], tracks }],
    complications: [], coda: [], sources: [], notes: [],
    playlistId: `archive:${key}`,
    playlistName: PERSONAS[ARCHIVE_DJ].name,
    created: new Date().toISOString(),
    loaded: true,
    templateVersion: TEMPLATE_VERSION,
    tracks: tracks.length,
    runtime: clock(totalMs),
    archive: { key, btn: slot?.btn ?? null, site: archiveSiteUrl(env, takes), loop: loop !== false },
    ...(requestId ? { requestId } : {}),
    ...(ask ? { ask } : {}),
  };
}

export async function putArchiveProgram(env, rec) {
  const kv = programsKV(env);
  await kv.put(`program:${rec.slug}`, JSON.stringify(rec), {
    metadata: {
      title: rec.title, dj: rec.dj, shape: rec.shape, created: rec.created,
      tracks: rec.tracks, runtime: rec.runtime, catalog: programCatalog(rec),
    },
  });
  await kv.put(`current:${rec.playlistId}`, rec.slug);
}

export async function readStation(env, key) {
  try {
    const doc = await tokensKV(env).get(STATION_KEY(key), { type: "json" });
    return doc && Array.isArray(doc.refs) && doc.refs.length ? doc : null;
  } catch { return null; }
}

// The three the speaker should be hearing now, and whether the window moved.
// Pure, so the decision can be tested without a clock or a KV.
export function stationWindow(rec, now) {
  const n = rec.refs.length;
  let pos = Number.isInteger(rec.pos) ? rec.pos : 0;
  let moved = false;
  if (rec.nextAt == null) {
    moved = true;                       // first serve: this window, not the next
  } else if (now >= rec.nextAt) {
    pos += ARCHIVE_WINDOW;
    moved = true;
    if (pos >= n) {
      // Off the end. A looping set goes round; one that does not keeps serving
      // its last window, which is what the button did before any of this.
      if (rec.loop === false) pos = Math.max(0, n - ARCHIVE_WINDOW);
      else pos = 0;
    }
  }
  const refs = rec.refs.slice(pos, pos + ARCHIVE_WINDOW);
  return { pos, refs, moved };
}
