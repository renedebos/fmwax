// The catalog: what a music service has to be able to do for this Worker.
//
// Everything above this line talks about buttons, DJs, sets and programs;
// everything below it is one service's HTTP. This is the seam. spotify.js
// and tidal.js each implement exactly these verbs and nothing else — the
// safe-write path, the snapshots, the room pages and the tools do not change
// between them, because none of them name a service.
//
// The PLAYER is not here. Playing a playlist on the WiiM goes through
// Spotify Connect, and the Tidal probe (tidal/probe2.py) measured that the
// equivalent does not port: a Tidal button gets pressed on the remote, not
// started from a phone. So "play" stays Spotify's, and a catalog is only ever
// asked about playlists and tracks.
//
// ---------------------------------------------------------------- the shapes
//
// The shapes are Spotify's, cut down to the fields the Worker actually reads
// (measured 2026-09-02: eleven of them). Inventing a neutral shape would have
// meant a rename at every one of those reads for no gain; adopting Spotify's
// means the second implementation maps INTO it, once, in one file. What a
// field is called here is a fact about this Worker now, not about Spotify.
//
//   Track
//     uri           "<catalog>:track:<id>" — the identity every ledger, snapshot
//                   and program record stores. catalogOfUri() reads the prefix.
//     id            the service's own id for it
//     name
//     artists       [{ name }] in billing order; artists[0] is the lead
//     album         { name, release_date, images } or null. release_date is a
//                   string whose first four characters are the year.
//     images        [{ url, width, height }], any order; pickImage chooses
//     duration_ms
//     external_ids  { isrc } when the service knows it — the recording's own
//                   number, the same on every service, and what a set moves
//                   house on
//     is_playable   false when the service says so; absent otherwise
//     linked_from   { uri, id } when the service substituted a regional
//                   equivalent, so a read-back can be matched to what was sent
//
//   Playlist
//     id, name, description ("" when blank), images, url (public link or null)
//
//   A page of items — { tracks, total, next, entries? }
//     tracks        Track or null per position. Null is an entry the service
//                   would not describe; it is KEPT, because positions are what
//                   make "#4 of 12" true and a snapshot with a hole in it must
//                   refuse rather than shift everything after it up.
//     total         the service's count of the whole playlist, or null on a
//                   page that does not carry it (the Worker keeps the last)
//     next          an opaque cursor for the following page, or null at the
//                   end. Spotify's is an offset, Tidal's a page cursor; the
//                   Worker passes it back and never reads it.
//     entries       optional: one opaque handle per position, for a catalog
//                   that removes by position rather than by track (Tidal's
//                   itemId). The Worker collects them across pages and hands
//                   them to replaceItems, which is then spared a second read.
//                   A catalog with no use for them leaves the field out.
//
// ----------------------------------------------------------------- the verbs
//
//   name                          "spotify" | "tidal" — the key in BUTTONS
//   label                         "Spotify" | "Tidal" — the word in a sentence
//   batch                         the most uris one WRITE call takes. Reads
//                                 page at whatever size the service chooses.
//   paced                         true when the transport already spaces its
//                                 calls and retries a 429 once, so a caller's
//                                 own retry would be a third try — Tidal
//   playlistId(ref)               id from a bare id, URI or share URL, else null
//   trackUri(id)                  "<name>:track:<id>"
//   trackId(uri)                  the id out of one of this catalog's URIs, else null
//
//   playlist(id)                  → Playlist. Throws with .status on failure.
//   items(id, cursor)             → page of items; cursor null for the first
//   myPlaylists(cursor)           → { playlists: [{ id, name, description }], next }
//   replaceItems(id, uris, opts)  the playlist now holds exactly these (≤ batch).
//                                 opts.entries: the handles from a read of the
//                                 playlist as it is now, if the caller has them.
//                                 Spotify does this in one call, so a throw
//                                 means nothing changed. Tidal has no replace:
//                                 it clears and then adds, and a failure in
//                                 between throws with `.torn = true` and
//                                 `.landed` (how many of the new uris are in) —
//                                 the old set is gone and the new one is not
//                                 there, and the caller must say so rather than
//                                 "nothing was written". A throw without
//                                 `.torn` still means nothing changed — which
//                                 the adapter may claim only for a call the
//                                 service REFUSED (a 4xx) or the Worker never
//                                 sent; a 5xx or a lost answer on the first
//                                 call is torn too, because the work may have
//                                 been done.
//   appendItems(id, uris)         these go on the end (≤ batch)
//   describe(id, text)            set the line under the name; blank clears it
//   rename(id, name)              set the name itself. A blank is refused
//                                 before any call, with .status 400 — a
//                                 nameless playlist is never what was meant
//   cover(id, jpegBase64)         set the picture. Spotify takes a base64
//                                 JPEG (256 KB encoded) and answers 202;
//                                 Tidal's artwork is read-only and the verb
//                                 throws with .status 501 before any call
//   createPlaylist({ name, description, public }) → Playlist
//   track(id)                     → Track. Throws with .status.
//   search(query, limit)          → Track[]
//   byIsrc(isrc)                  → Track[], the pressings the service returns
//                                 for that number (Spotify: at most ten)
//
// Every verb is one or more subrequests through the transport the Worker
// hands the implementation, so the per-invocation budget and the point-of-no-
// return flag are counted there, not here. A verb throws an Error carrying
// `.status` (HTTP) and `.retryAfter` (seconds, 0 when absent) for a failed
// call, and the Worker's own text is wrapped around it by whoever catches.

export const CATALOGS = ["spotify", "tidal"];

// The one check both services share on a rename. What each service would do
// with a blank name is unmeasured, and it does not matter: a nameless
// playlist is never what a caller meant, so it is refused here first.
export function playlistName(name) {
  const n = String(name ?? "").trim();
  if (!n) {
    const err = new Error("a playlist needs a name — nothing was renamed");
    err.status = 400;
    throw err;
  }
  return n;
}

// Which service a track URI names, from its prefix — "spotify:track:…" or
// "tidal:track:…". Null for anything else, including Spotify's local files
// and episodes, which no catalog verb takes.
export function catalogOfUri(uri) {
  const m = String(uri ?? "").match(/^([a-z]+):track:[^:]+$/);
  return m && CATALOGS.includes(m[1]) ? m[1] : null;
}

// Refused in words, in one place, so every path that cannot reach a catalog
// says the same sentence. The parser in the Worker accepts the name because a
// house can be written down before it can be served.
export function unreachable(name) {
  const err = new Error(
    `${name} playlists cannot be reached by this version — ` +
    `${CATALOGS.map((c) => c[0].toUpperCase() + c.slice(1)).join(" and ")} can. ` +
    "Nothing was changed.");
  err.status = 501;
  return err;
}
