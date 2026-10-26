// THE SHELF: the words after a play (flashes), what each program is and
// where it would load, program records and covers, and shelfState.
// Split out of worker.js on 2026-09-26 (consolidation).
import { artistMatches, clock, versionSuspect, shutWords, serviceLink } from "./programs.js";
import { PERSONAS } from "./djs.js";
import { catalogOfUri } from "./catalog.js";
import { destinationFor, guestBusyWords, guestFor, guestLabel, house, programDj } from "./house.js";
import { SHELF_QUEUE_KEY, SHELF_QUEUE_TTL_S, configuredPlaylistId } from "./now.js";
import { startPlaylistOnDevice, startUrisOnDevice } from "./playback.js";
import { pooled } from "./playlists.js";
import { catalogFor, guestCatalog, playlistRef, programsKV, spotify } from "./services.js";
import { PROGRAM_MAX_TRACKS, PROGRAM_MAX_TRACKS_HELD } from "./toollist.js";
import { ARCHIVE } from "./archive-identity.js";

// What the shelf says after a chooser POST — and it does not take the redirect's
// word for it. Success is whatever the `current:` pointer says, not what the
// query claims, for two reasons that both end the same way.
//
// The 303 leaves ?put= in browser history and in any shared URL, so reopening
// it an hour later would otherwise announce a program that has since been
// replaced. And a write whose two read-backs DISAGREED returns ok while
// deliberately clearing the pointer, precisely so that nothing claims to know
// what is loaded — a flash reading "ok" over that would be the one assertion
// the verifier refused to make.
//
// The slug still comes back through a URL the visitor can edit, so the title is
// taken from the row it matches and nothing is printed for one that does not
// exist.
// The shelf's Play, reported. The title comes from the shelf's own rows by
// slug and the room from the allow-list, never from the address as typed —
// both are reflected into the page, and a query string is anyone's to edit.
export function playedFlash(params, rows, allowed, kindOf = () => null) {
  const slug = String(params.get("slug") ?? "");
  const row = rows.find((r) => r?.id === slug);
  const title = row ? `“${String(row.title ?? row.id)}”` : "That set";
  const on = String(params.get("on") ?? "");
  const room = allowed.includes(on) ? on : "the speaker";
  switch (String(params.get("played") ?? "")) {
    case "ok":
      return `Playing ${title} on ${room}. Nothing on the presets changed.`;
    // PLAYING IS NOT PLAYING IN ORDER. Shuffle and repeat-one are cleared
    // before the tracks are sent, and a device that refuses to clear them
    // still reports the first track playing — which passes every other check.
    // The order is the set, so this is its own answer and not a success.
    case "jumbled":
      return `${title} is playing on ${room}, but the speaker still has shuffle or ` +
        "repeat on, so it is not playing in the order it was written. Clear both " +
        "on the device or in Spotify and press Play again.";
    case "sent":
      return `Spotify accepted ${title} for ${room}, but it is not playing there yet — ` +
        "the speaker is probably asleep or on another input. Press play on it once, " +
        "or start anything on it for a moment, then press Play again.";
    case "helper":
      return `${title} is on the Tidal preset, but the home helper could not press its key on ${room}. ` +
        "Press it on the remote, or try again.";
    case "ok-put":
      return `Playing ${title} on ${room}. It is on the Tidal preset now, in place of the set that was ` +
        "there, which is kept and can be put back.";
    case "tidal-busy":
      return `The Tidal preset is being written for a request right now, so ${title} was not put on it. ` +
        "Try again in a minute. Nothing was started.";
    case "tidal-failed":
      return `${title} could not be put on the Tidal preset, so nothing was started. The preset still ` +
        "holds what it did.";
    case "asleep":
      return shutWords(room, kindOf(room)) ??
        `${room} is not on Spotify’s device list right now. Play anything on it ` +
        "for a moment and press Play again. Nothing was started.";
    case "failed":
      return `Spotify refused the play request for ${title}. Nothing was started, and ` +
        "nothing on the presets changed.";
    default:
      return null;
  }
}

export function flashFor(put, rows, onAir) {
  const raw = String(put ?? "");
  // The undo's own outcomes. They name no programme, so they never reach the
  // pointer check below — an undo's success is that the button went back to
  // something this page is deliberately not tracking.
  if (raw.startsWith("undone:")) {
    const n = Number(raw.slice(7));
    return Number.isFinite(n) && n > 0
      ? `Put back — ${n} ${n === 1 ? "track is" : "tracks are"} on the button again. ` +
        `Nothing is playing.`
      : "Put back.";
  }
  // A guest being written for a request (MC-18): the door's own sentence. The
  // DJ is looked up by key among the personas and the service is one of two —
  // the address is anyone's to edit, so nothing in it is printed as typed.
  const busy = raw.match(/^(?:busy:[a-z0-9-]{1,64}|undobusy):([a-z0-9-]{0,64}):(spotify|tidal)$/);
  if (busy) {
    const name = Object.prototype.hasOwnProperty.call(PERSONAS, busy[1]) ? PERSONAS[busy[1]].name : null;
    const words = guestBusyWords(name, guestLabel(busy[2]));
    return words[0].toUpperCase() + words.slice(1);
  }
  if (raw === "undostale") {
    return "Not undone: another set has been loaded on that preset since, and " +
      "the undo would have put an older one back over it. Nothing was changed.";
  }
  if (raw === "undofail") {
    return "That could not be undone, and the button was not changed. The saved " +
      "copy may have expired — backups last 90 days. restore_playlist can show " +
      "what else was saved.";
  }
  // The one outcome this page must not round off. Putting the old set back got
  // part of the way and could not finish or reverse itself, so the button holds
  // neither set. The backup is still there; it needs the tool, not the page.
  if (raw === "undopart") {
    return "The undo went wrong part of the way through and the button is now " +
      "holding neither set — not the one it had, and not the one being put " +
      "back. The saved copy is intact. Use restore_playlist to finish it, and " +
      "do not assume anything about what is on that button until you have.";
  }
  // Taking a set off the shelf. These name no programme on purpose: after a
  // delete there is no row left to look the title up in, and a flash that
  // quietly says nothing is how a destructive action ends up unreported.
  if (raw === "removed") {
    return "That set is off the shelf. Its page is gone and the link to it " +
      "stops working. What is on the button did not change.";
  }
  if (raw === "removefail") {
    return "That could not be taken off the shelf. The page is still there — " +
      "the parts that come first did not finish, and nothing was deleted. " +
      "Try again in a moment.";
  }
  const m = raw.match(/^(ok|failed):([a-z0-9-]{1,64})$/);
  if (!m) return null;
  const row = rows.find((r) => r.id === m[2]);
  if (!row) return null;
  const title = row.title ?? row.id;
  if (m[1] === "ok" && onAir?.has?.(row.id)) {
    return `“${title}” is on the button. Nothing is playing — press it when you want it.`;
  }
  return `“${title}” is not on the button. Either the change did not take, or ` +
    `something else has been loaded since. The rows marked below are what is ` +
    `actually there.`;
}

// The one refusal activateProgram makes that a page can see coming, and it is
// now about the SERVICE alone.
//
// It used to fire whenever a programme's playlist and its DJ's button had come
// apart at all, because that meant an alias re-pointed under a published set
// and putting it back could only bounce. Under the tenancy that is what moving
// buttons IS — the set follows its writer and the record moves with it — so a
// differing id is ordinary and the form works.
//
// What still cannot work is a different SERVICE: a Tidal-era programme holds
// Tidal track URIs and a Spotify button cannot take them, refused before
// anything is written. The row says so where the form would be, because the
// bounce is reported without its reason — this page keeps reasons off a link
// anyone can load — and "ask for it again on Spotify" is the half a reader can
// act on. Null when the form would work, or when nothing can be checked, and
// then the POST decides.
// A programme whose AUTHOR has nowhere to put it. Published from the bench
// since 2026-09-07, so the global shelf fills with rows `activateProgram` must
// refuse; this withholds the control rather than offering a press that can
// only fail (Codex, 2026-09-07). Distinct from `shelfElsewhere`, which is
// about the wrong SERVICE.
//
// A DJ on no preset places onto the requests preset for the set's service;
// with none live there, nowhere (the crates went in stage 6, 2026-09-26).
export function shelfUnplaceable(env, row) {
  const dj = programDj(env, row?.dj);
  if (!dj) return false;
  // AN ARCHIVE SET HAS A PLACE: the archive preset (2026-09-10). Its DJ has
  // no playlist and never will, and the global shelf read that as nowhere —
  // while activate_program has re-parked archive sets since 2026-09-07 and
  // the archive's own page offered the control. Unplaceable only in a house
  // with no archive button.
  if (dj.archiveOnly) return !house(env).archive;
  if (dj.button) return false;
  const cat = row?.catalog ?? (row?.playlistId ? playlistRef(row.playlistId)?.catalog : null) ?? guestCatalog(env);
  return !destinationFor(env, dj, cat).guest;
}

// `byCatalog`: with no playlistId on the row (a listing row, no record read),
// judge by the listing's own catalog — the service its tracks are on. Only
// the DJ page's shelf asks for it; the Shelf tab keeps its old rule.
export function shelfElsewhere(env, row, { byCatalog = false } = {}) {
  const dj = programDj(env, row?.dj);
  // A BENCHED DJ IS NEVER "ELSEWHERE" (2026-09-10): their set goes to the
  // crate on its own service, and one is made if it is missing. Only a tenant
  // can be on the wrong service, because a preset is on exactly one.
  if (dj && !dj.button && !dj.archiveOnly) return null;
  if (!dj?.playlist || !dj.catalog) return null;
  const listed = byCatalog && row?.catalog && row.catalog !== "files" ? row.catalog : null;
  if (!row?.playlistId && !listed) return null;
  const was = row?.playlistId ? playlistRef(row.playlistId)?.catalog ?? null : listed;
  if (!was || was === dj.catalog) return null;
  return {
    who: dj.name,
    now: catalogFor(env, dj.catalog).label,
    recorded: catalogFor(env, was).label,
  };
}

export async function listProgramSummaries(env) {
  const { keys } = await programsKV(env).list({ prefix: "program:" });
  const base = programBaseUrl(env);
  return keys.map((k) => {
    const id = k.name.slice("program:".length);
    return { id, ...(k.metadata ?? {}), url: `${base}/programs/${id}` };
  }).sort((a, b) => String(b.created ?? "").localeCompare(String(a.created ?? "")));
}

// A programme's LISTING metadata is stored apart from its record, and KV's
// put REPLACES it: a put with no `metadata` clears it. Both writes that move a
// programme to another playlist did exactly that, and the shelf builds its
// rows from metadata — so a programme dropped off the Programmes page the
// moment its DJ was dragged to a different preset, perfect at its own URL and
// invisible everywhere else, sorted to the bottom by an empty `created`.
// Measured 2026-09-06 on Camille's B-sides hour, gone from the shelf the night
// she moved to preset 10 and found only because the owner asked about it.
//
// The cover is the one listing field the record does not carry, so it is read
// back and written again; the rest is rebuilt from the record going in.
// WHICH SERVICE A PROGRAMME IS ON, for the listing (MC-11). The record knows
// — every track carries a `<catalog>:track:` URI — but the shelf builds its
// rows from KV listing metadata and reading seventy records per page view to
// find out is the wrong trade. Derived once, at every write.
//
// It is a fact the reader acts on, not decoration: a Tidal set cannot be
// started from any page here and cannot land on a Spotify playlist, so the
// mark is what says whether a row's control can do anything. An archive set's
// takes are on no service at all, and `files` is the word the wall already
// uses for them.
export function programCatalog(rec) {
  if (rec?.archive) return "files";
  for (const sec of rec?.sections ?? []) {
    for (const t of sec?.tracks ?? []) {
      const cat = catalogOfUri(t?.uri);
      if (cat) return cat;
    }
  }
  return playlistRef(rec?.playlistId)?.catalog ?? null;
}

export async function putProgramMoved(kv, slug, rec) {
  let image = null;
  try { image = (await kv.getWithMetadata(`program:${slug}`)).metadata?.image ?? null; }
  catch { /* a row with no cover is a far smaller loss than no row */ }
  await kv.put(`program:${slug}`, JSON.stringify(rec), {
    metadata: {
      title: rec.title, dj: rec.dj, shape: rec.shape, created: rec.created,
      tracks: rec.tracks, runtime: rec.runtime, catalog: programCatalog(rec),
      ...(image ? { image } : {}),
    },
  });
}

export function programBaseUrl(env) {
  const base = env.PROGRAM_BASE_URL;
  if (!base) {
    throw new Error(
      "PROGRAM_BASE_URL is not set — add it to wrangler.toml and deploy. " +
      "Without it a program would be stored with no way to say where to read it.");
  }
  return String(base).replace(/\/+$/, "");
}

// Are these the recordings the essay is about?
//
// The model hands over URIs it got from search_tracks, and a URI can be a
// re-recording, a live take, a covers-band upload or the wrong artist entirely.
// A read-back only checks the ORDER, so every one of those verifies green — a
// program arguing about the 1968 single ships with a 2004 re-cut in slot three,
// immutably, at a permanent URL. Nothing downstream catches it and no machine
// listens to the result.
//
// So: look the tracks up before writing anything, and refuse the whole call on
// a mismatch. Titles and durations come from here too, which means the page is
// right about them even when the later verification is inconclusive.
// ONE definition of what a track looks like on a record, because there are now
// two ways to make one: an essay resolves its claims track by track, and a
// fulfilment reads back the set it just wrote. A setlist and a programme have
// to render through the same template, so they had better be the same shape —
// and two mappings would drift the first time a field is added to one of them.
export function trackRecord(t, { year = null, variant = null, issued = null } = {}) {
  const artists = (t?.artists ?? []).map((a) => a.name);
  return {
    uri: t.uri,
    title: t.name,
    artist: artists.join(", "),
    // The billed lead, kept apart from the credit line, and only when they
    // differ. `artist` is the whole billing — "Stan Getz, Charlie Byrd" and
    // "Stan Getz, João Gilberto" are two strings for one man's catalogue, so
    // anything grouping by it reads fourteen Getz records as a roster. It
    // cannot be recovered by splitting on the comma either: Earth, Wind &
    // Fire is one artist with two of them in its name.
    ...(artists.length > 1 && artists[0] ? { lead: artists[0] } : {}),
    duration: clock(t.duration_ms),
    duration_ms: t.duration_ms,
    // The recording's own number, the same on every service that carries it.
    // A Spotify URI names a track on Spotify and nothing else; the ISRC is
    // what a set moves house on, so it is kept the day the set is kept.
    ...(t.external_ids?.isrc ? { isrc: String(t.external_ids.isrc) } : {}),
    // Spotify has no field for either of these, and both are the model's job —
    // so they arrive from the claim or not at all.
    ...(year ? { year } : {}),
    // For a recording first issued years after it was made (the house rules'
    // THREE DATES, 2026-10-18): the year it first came out, beside `year`,
    // which is when it was made.
    ...(/^\d{4}$/.test(String(issued ?? "").trim()) ? { issued: String(issued).trim() } : {}),
    ...(variant ? { variant } : {}),
    ...(t.is_playable === false ? { unplayable: true } : {}),
    // Tidal's quality, "max" or "high" (tidal.js), kept the day the set is
    // kept: the program page is public and may not ask Tidal (2026-09-27).
    ...(t.quality === "max" || t.quality === "high" ? { quality: t.quality } : {}),
    released: String(t.album?.release_date ?? "").slice(0, 4) || null,
    // The record it came off. Colour on most sets; on the ones that argue from
    // where and when a track was cut it is the evidence itself — a live album
    // names the venue and the night, a studio one places the era — and none of
    // that is recoverable from the song title alone.
    ...(t.album?.name ? { album: t.album.name } : {}),
    // Album art, off a lookup that was happening anyway. Stored rather than
    // fetched later because the pages that show it are public and must never
    // make this Worker talk to Spotify.
    image: pickImage(t.album?.images),
  };
}

export async function resolveProgramTracks(env, cat, claims, budget) {
  // One request per track; the adapter says why.
  const looked = await pooled(claims, 6, async (c) => {
    try {
      const id = cat.trackId(c.uri);
      return id ? await cat.track(id) : null;
    } catch {
      return null;
    }
  });

  const wrong = [];
  const tracks = claims.map((c, i) => {
    const t = looked[i];
    if (!t?.uri) {
      wrong.push(`${c.where}: ${c.uri} is not a track ${cat.label} will return`);
      return null;
    }
    const artists = (t.artists ?? []).map((a) => a.name);
    // A claim with no artist is one a revision made — the record already
    // vouches for the set, and the essay path never gets here without one
    // (programClaims refuses first).
    if (c.artist != null && !artistMatches(c.artist, artists)) {
      wrong.push(
        `${c.where}: the essay says "${c.artist}" but that URI is ` +
        `"${t.name}" by ${artists.join(", ") || "nobody listed"}`);
      return null;
    }
    return trackRecord(t, { year: c.year, variant: c.variant, issued: c.issued });
  });

  if (wrong.length) {
    throw new Error(
      "not written — these recordings are not what the program says they are:\n" +
      wrong.map((w) => `  ${w}`).join("\n") +
      "\nResolve them again with search_tracks and check the artist before " +
      "retrying. Nothing was changed.");
  }

  // The artist check cannot see a later mix credited to the same name. See
  // versionSuspect for why this looks at the title and the year together rather
  // than the year alone — the year alone fired on seven of twelve real tracks
  // and buried the one that mattered.
  const suspect = [];
  tracks.forEach((t, i) => {
    const why = versionSuspect(claims[i].year, t.title, t.released, claims[i].issued);
    if (why) suspect.push({ where: claims[i].where, title: t.title, why });
  });
  return { tracks, suspect };
}

// A shelf thumbnail wants the smallest size that will not blur on a phone.
// Spotify's album art comes as 640 / 300 / 64, so that is the 300. Tidal's
// ladder (measured in tidal/probe3.py) is 1280 / 1080 / 750 / 640 / 320 / 160
// for an album and 1080 / 480 / 320 / 160 for a playlist's own cover, so that
// is the 320 on both. A floor of 240 picks each without knowing which service
// answered: it sits above Spotify's 64 and Tidal's 160, below every other rung.
export function pickImage(images) {
  const list = (images ?? []).filter((i) => i?.url);
  if (!list.length) return null;
  const usable = list.filter((i) => (i.width ?? 0) >= 240);
  const best = usable.length
    ? usable.reduce((a, b) => ((a.width ?? 0) <= (b.width ?? 0) ? a : b))
    : list[0];
  return typeof best.url === "string" ? best.url : null;
}

// Which record represents a programme on the shelf. The subject is almost always
// the artist who appears most — Bowie nine times in a programme about Bowie, the
// La's three times in one about the La's — so the most frequent artist's first
// cover is a better answer than the first track's, which is usually an ancestor
// rather than the subject. Ties go to whoever appeared first, which is the
// programme's own order and therefore its author's.
// Grouped by the billed LEAD, falling back to the credit line for records
// written before `lead` was stored.
export function coverArtist(t) {
  return String(t?.lead || t?.artist || "").trim();
}

// `taken` is the covers other programmes already show. Two programmes on one
// subject legitimately share a top artist — the Bootlegger cut two hair-metal
// nights eleven minutes apart and Twisted Sister topped both — and identical
// adjacent rows read as a bug rather than as agreement. So the ranking is
// walked rather than only its head taken, and the first record nobody else is
// showing wins. Every fallback is still a record from THIS programme, so the
// cover never stops being true; it just stops being the most canonical answer.
export function pickCover(tracks, taken = null) {
  const list = (tracks ?? []).filter(Boolean);
  const counts = new Map();
  for (const t of list) {
    const a = coverArtist(t);
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  // Insertion order is first appearance, and sort is stable, so ties keep the
  // programme's own order and therefore its author's.
  const ranked = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const artFor = (a) => list.find((t) => coverArtist(t) === a && t.image)?.image ?? null;
  const used = taken instanceof Set ? taken : new Set();

  for (const a of ranked) {
    const img = artFor(a);
    if (img && !used.has(img)) return img;
  }
  // No candidate artist has a free record: any other sleeve in the programme
  // beats a duplicate.
  const free = list.find((t) => t.image && !used.has(t.image))?.image;
  if (free) return free;
  // Everything in it is already on the shelf. A repeated cover is still better
  // than a hole in the row, so this falls back to what it would have chosen.
  return (ranked.length ? artFor(ranked[0]) : null)
    ?? list.find((t) => t.image)?.image ?? null;
}

// WHAT THE SHELF KNOWS ABOUT EVERY PROGRAM (2026-09-23): the listing with
// where each would load and which are live, read from KV and never from
// Spotify. Factored out of the Shelf's route when Load and Delete moved to a
// program's own page (the owner chose the grid, B), which needs the same
// facts for one row.
export async function shelfState(env) {
  let rows = [];
  let unreadable = false;
  try {
    // No standfirsts since the grid (2026-09-23): the cards do not show them,
    // and a program's page runs this too — one read each would be ninety.
    rows = (await listProgramSummaries(env))
      .map((r) => ({ ...r, elsewhere: shelfElsewhere(env, r),
        unplaceable: shelfUnplaceable(env, r),
        // WHERE the control would put it, so the button can say so (MC-11).
        // "Put on preset" is a lie for a DJ who has no preset, and the
        // difference is the one a reader acts on: only one of the two ends
        // with somebody pressing a number in the room.
        // A benched roster DJ's set goes to their crate — made at the
        // press if they have none (2026-09-10) — so the words say crate
        // for every one of them, not only those who already hold one.
        ...((() => {
          const d = programDj(env, r?.dj);
          const catalog = r?.catalog ?? d?.catalog ?? guestCatalog(env);
          // WHERE THE PUT GOES ONCE A GUEST IS LIVE (MC-18 stage 3): the
          // guest on the set's service, by the lookup the put itself
          // makes — "Put on 1", "Load on Tidal · press 2".
          const g = d && !d.button && !d.archiveOnly ? destinationFor(env, d, catalog).guest : null;
          return {
            // The service the control would load on (2026-09-11), so the
            // row can say "Load on Tidal". Listing metadata carries it for every record
            // written since MC-11; a row without it falls back to the
            // DJ's own service, then the house default, so the control
            // never reads "Load on their service".
            catalog,
            ...(g ? { guest: { btn: g.btn, catalog: g.catalog, name: g.name ?? null } } : {}),
          };
        })()) }));
  } catch {
    // An unset base URL or a missing namespace. Still not a stack trace —
    // but not an empty shelf either, which is what this used to render.
    // "Nothing published yet" is a claim about the writers; a failed list
    // is a claim about the server, and the two must not look alike on a
    // page whose whole subject is what has been written.
    unreadable = true;
  }
  // Which ones are live, read from KV and never from Spotify: this route is
  // reachable by anyone holding the link, and a page view must not spend
  // the account's token. Playlist ids come from the alias map, which is
  // configuration rather than a lookup.
  //
  // A SET, no longer one slug. The shelf lists every DJ's programmes and
  // each DJ has their own button, so two rows can be on the air at the same
  // time on different buttons. Only the DJs actually present in the listing
  // are looked up, and each button only once.
  const onAir = new Set();
  // WHERE A LIVE TIDAL SET IS HEARD (2026-09-10). Nothing here can start
  // Tidal, so a row whose set is loaded on a Tidal playlist gets the two
  // things a person can do with it: the number to press when it is on a
  // preset, and a link that opens the playlist in the Tidal app. Built from
  // the same pointer read as the on-air mark, so it costs nothing extra.
  const open = {};
  // slug → the preset number of the live guest holding it (MC-18 stage 3).
  const guestOn = new Map();
  const presetOn = new Map();
  try {
    const kvp = programsKV(env);
    const seen = new Set();
    for (const row of rows) {
      const who = programDj(env, row?.dj);
      // The archive's DJ has no button; its pointer hangs off the archive
      // key instead, read once for the whole list.
      if (who?.archiveOnly) {
        if (!seen.has("archive")) {
          seen.add("archive");
          const live = await kvp.get(`current:archive:${env.ARCHIVE_M3U_KEY || ARCHIVE.key}`);
          if (live) onAir.add(live);
        }
        continue;
      }
      // By alias, not button (MC-11): a programme loaded on a DJ's crate
      // is as live as one on a preset, and without this its row would
      // never be marked and its listen link never appear.
      if (!who?.alias || seen.has(who.alias)) continue;
      seen.add(who.alias);
      const pid = configuredPlaylistId(env, who.alias);
      if (!pid) continue;
      const live = await kvp.get(`current:${pid}`);
      if (live) {
        onAir.add(live);
        // Its number, for the card's corner (the grid, 2026-09-23), whatever
        // the service: a Spotify set on a DJ's own preset wears it too.
        if (who.btn != null) presetOn.set(live, who.btn);
        if (who.catalog && who.catalog !== "spotify") {
          const link = serviceLink("playlist", pid);
          open[live] = { href: link?.href ?? null, service: link?.service ?? catalogFor(env, who.catalog).label,
            btn: who.btn ?? null };
        }
      }
    }
    // WHAT A LIVE GUEST HOLDS (MC-18 stage 3): its pointer, read as a
    // DJ's is, so a set put on a guest reads as on the air and the put's
    // own flash can say it landed. One read per live guest; none while
    // every guest is dark.
    for (const g of Object.values(house(env).guest ?? {})) {
      if (!g?.live) continue;
      const live = await kvp.get(`current:${g.playlist}`);
      if (!live) continue;
      onAir.add(live);
      guestOn.set(live, g.btn);
      if (g.catalog !== "spotify") {
        const link = serviceLink("playlist", g.playlist);
        open[live] = { href: link?.href ?? null, service: link?.service ?? catalogFor(env, g.catalog).label,
          btn: null };
      }
    }
  } catch { /* the shelf still lists; it just cannot say which is live */ }
  if (guestOn.size) rows = rows.map((r) => (guestOn.has(r.id) ? { ...r, guestOn: guestOn.get(r.id) } : r));
  if (presetOn.size) rows = rows.map((r) => (presetOn.has(r.id) ? { ...r, presetBtn: presetOn.get(r.id) } : r));
  return { rows, unreadable, onAir, open, guestOn };
}

// THE ONE SPEAKER CHOICE, AS THE SERVER SEES IT (2026-09-23): the pages'
// scripts keep it in the `spk` cookie (a speaker's slug) so the Shelf, which
// runs no script, can be drawn with it. A slug that names no configured
// speaker is nobody's choice.
// A MOVE TO A SPEAKER THAT IS SLOW TO TAKE IT (the owner, 2026-09-24): the
// Master Bedroom Echo was in Spotify's list and still answered the transfer
// 404, as it answered the first play that morning and took the second. So:
// the transfer, once more after a breath, and then the same song started
// there at the same place — what a play does, and what worked before. Only
// the last refusal is thrown.
export async function moveTo(env, deviceId, st) {
  const tries = [
    () => spotify(env, "PUT", "/me/player", { body: { device_ids: [deviceId], play: true } }),
    async () => { await new Promise((r) => setTimeout(r, 1500));
      return spotify(env, "PUT", "/me/player", { body: { device_ids: [deviceId], play: true } }); },
    () => {
      const ctx = String(st?.context?.uri ?? "");
      const body = /^spotify:(playlist|album|artist|show):/.test(ctx) && st?.item?.uri
        ? { context_uri: ctx, offset: { uri: st.item.uri }, position_ms: Number(st.progress_ms) || 0 }
        : { uris: [st?.item?.uri].filter(Boolean), position_ms: Number(st?.progress_ms) || 0 };
      return spotify(env, "PUT", "/me/player/play", { params: { device_id: deviceId }, body });
    },
  ];
  let last = null;
  for (const t of tries) {
    try { await t(); return; } catch (e) {
      last = e;
      if (!(e?.status === 404 || e?.status === 502)) throw e;
    }
  }
  throw last;
}
// THE SHELF'S FILTER, CARRIED (2026-09-24): a DJ's slug and a service, both
// display only and both going straight back into a URL, so checked here the
// way the Shelf's forms check them.
// And the search (the review, 2026-09-27: a search was lost after Play,
// Load, Delete and Undo), cut by characters, never inside an emoji.
export function shelfFind(q) {
  return [...String(q ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()].slice(0, 80).join("").trim() || null;
}
export function shelfFilter(dj, svc, q = null) {
  const d = String(dj ?? "").trim(), v = String(svc ?? "").trim();
  return { dj: /^[a-z0-9-]{1,64}$/.test(d) ? d : null, svc: /^(spotify|tidal|files)$/.test(v) ? v : null, q: shelfFind(q) };
}
export function shelfFilterQs(f, lead = "&") {
  const q = [f?.dj ? `dj=${encodeURIComponent(f.dj)}` : "", f?.svc ? `svc=${f.svc}` : "",
    f?.q ? `q=${encodeURIComponent(f.q)}` : ""].filter(Boolean).join("&");
  return q ? lead + q : "";
}

// What the shelf is already showing. A KV list, which is a subrequest to a
// Cloudflare service and NOT one of the fifty external calls a programme is
// fighting for — the two ceilings are separate, and folding this into the
// budget would refuse real work.
export async function usedCovers(env) {
  try {
    const { keys } = await programsKV(env).list({ prefix: "program:" });
    return new Set(keys.map((k) => k?.metadata?.image).filter(Boolean));
  } catch {
    // A shelf that cannot be listed is not a reason to refuse a programme.
    // The cost of guessing wrong here is one repeated thumbnail.
    return new Set();
  }
}

// Flatten the sections into one ordered claim list, validating as it goes.
export function programClaims(sections, max = PROGRAM_MAX_TRACKS) {
  if (!Array.isArray(sections) || !sections.length) {
    throw new Error("sections must be a non-empty array");
  }
  if (sections.length > 20) throw new Error("at most 20 sections");
  const claims = [];
  sections.forEach((sec, si) => {
    if (!sec?.heading) throw new Error(`section ${si + 1} has no heading`);
    if (!Array.isArray(sec.prose) || !sec.prose.length) {
      throw new Error(`section ${si + 1} ("${sec.heading}") has no prose`);
    }
    for (const b of sec.prose) {
      if (String(b?.text ?? "").length > 4000) {
        throw new Error(`a paragraph in section ${si + 1} is over 4000 characters`);
      }
    }
    if (!Array.isArray(sec.tracks) || !sec.tracks.length) {
      throw new Error(`section ${si + 1} ("${sec.heading}") has no tracks — a claim ` +
                      "with no evidence is not a section");
    }
    sec.tracks.forEach((t, ti) => {
      const where = `section ${si + 1} track ${ti + 1}`;
      if (!catalogOfUri(t?.uri)) {
        throw new Error(`${where}: "${t?.uri}" is not a track URI`);
      }
      if (!String(t?.artist ?? "").trim()) {
        throw new Error(
          `${where}: no artist given. It is what the recording is checked against ` +
          "before anything is written, so it is not optional.");
      }
      claims.push({ ...t, where });
    });
  });
  if (claims.length > max) {
    throw new Error(
      `${claims.length} tracks is over the ${max} limit` +
      (max === PROGRAM_MAX_TRACKS
        ? `. Publishing WITHOUT loading the button allows ${PROGRAM_MAX_TRACKS_HELD}, ` +
          "because it does not pay for the backup, the write and the read-backs. " +
          "Leave load_button off and put it on the button afterwards."
        : ". Nothing longer fits in one invocation's subrequest allowance."));
  }
  const dupes = claims.map((c) => c.uri).filter((u, i, a) => a.indexOf(u) !== i);
  if (dupes.length) {
    // A repeated URI also breaks read_playlist's "how much is left", which
    // cannot tell which of the positions is the one playing.
    throw new Error(`the same track appears twice: ${[...new Set(dupes)].join(", ")}`);
  }
  return claims;
}

// A PROGRAMME'S SET, HEARD — the Shelf's Play (2026-09-10) and, since
// 2026-10-12, play_program, which had a way of its own (the set copied to the
// replay playlist first). Nothing is written.
//
// EVERY recorded URI, so a caller can refuse if one of them is not a Spotify
// track (Codex, 2026-09-10). `programCatalog` reads the FIRST track that names
// a service, so a record with a foreign or malformed URI further down — a
// legacy row, or one repaired by hand — would pass that gate and then have
// those entries quietly dropped: a short set played under the whole set's
// name. A subset is not this set.
export function programSpotifyUris(rec) {
  const uris = (rec?.sections ?? []).flatMap((sec) => (sec?.tracks ?? []).map((t) => t?.uri).filter(Boolean));
  return { uris, notSpotify: uris.filter((u) => !/^spotify:track:[A-Za-z0-9]+$/.test(u)) };
}
// A SET THAT IS ON A PRESET RIGHT NOW PLAYS AS THAT PRESET (the owner,
// 2026-09-23: the Floyd set was on 1 and playing from the Shelf, yet preset
// 1's band showed a play and the bar said "a queue of tracks"). Its playlist
// holds these same tracks in this order, so starting the playlist is the same
// music — and then every page can see it is preset 1, and a pause can play it
// again. Any other set goes as its own tracks, and the Shelf's record says
// whose they are. The caller has checked the catalog, the quota and the
// speaker. `code`: ok, jumbled (shuffled or on repeat-one), sent (Spotify took
// it and the read-back could not say), asleep or failed (with `error`).
export async function playShelfSet(env, rec, uris, device, budget) {
  const slug = rec.slug;
  let live = null;
  for (const pid of [guestFor(env, "spotify")?.live ? guestFor(env, "spotify").playlist : null, rec.playlistId]) {
    if (!pid || live) continue;
    try { if (await programsKV(env).get(`current:${pid}`) === slug) live = pid; } catch { /* then as tracks */ }
  }
  let code = "failed", out = null, error = null;
  try {
    if (live) {
      out = await startPlaylistOnDevice(env, { id: live, name: String(rec.title ?? slug), catalog: "spotify" }, device, budget);
      code = !out.preset_safe ? "sent" : (out.shuffle_warning || out.repeat_warning) ? "jumbled" : "ok";
    } else {
      out = await startUrisOnDevice(env, uris, device, budget);
      // `unverified` is a read-back that failed AFTER the tracks were sent,
      // so it is not a failure; `warning` is the verdict that they are not
      // playing on the device asked for; and a set playing SHUFFLED or on
      // repeat-one is playing, but not as the set it is (Codex, 2026-09-10).
      code = (out.unverified || out.warning) ? "sent" : (out.shuffle_warning || out.repeat_warning) ? "jumbled" : "ok";
    }
  } catch (err) {
    error = err;
    code = err?.noSuchDevice ? "asleep" : "failed";
  }
  if (!live && code !== "failed" && code !== "asleep") {
    try {
      await programsKV(env).put(SHELF_QUEUE_KEY, JSON.stringify({ slug, title: String(rec.title ?? slug).slice(0, 120), uris,
        at: Date.now(), dj: programDj(env, rec.dj)?.key ?? null }), { expirationTtl: SHELF_QUEUE_TTL_S });
    } catch { /* the set plays; it is only called a queue */ }
  }
  return { code, live, out, error };
}
