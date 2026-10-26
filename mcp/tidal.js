// Tidal as a catalog — see catalog.js for what each verb owes, and
// tidal/probe3.py for every number and shape below (measured 2026-09-02).
//
// `call(method, path, { params, body })` is the Worker's transport. It adds
// the country code, the JSON:API headers and the token, counts the
// subrequest, and PACES: Tidal's bucket is about five calls with two a
// second back (tidal/probe2.py), and a Worker's round trip is fast enough to
// empty it. So this file is only the endpoints and the mapping into the
// Worker's shapes, which are Spotify's.
//
// JSON:API puts what a resource IS in `attributes`, what it is RELATED to in
// `relationships`, and delivers the related resources flattened into one
// `included` list keyed by (type, id). Every read here joins that list back
// together; `index()` is the join.

import { playlistName } from "./catalog.js";

const BATCH = 50; // what one write takes — "Size must be between 1 and 50"
const ITEMS_INCLUDE = "items,items.albums,items.artists,items.albums.coverArt";
const TRACK_INCLUDE = "albums,artists,albums.coverArt";
const SEARCH_INCLUDE = "tracks,tracks.albums,tracks.artists,tracks.albums.coverArt";

export function tidalCatalog(call) {
  const itemsPath = (id) => `/playlists/${id}/relationships/items`;

  return {
    name: "tidal",
    label: "Tidal",
    batch: BATCH,
    // The transport already waits out a 429 and retries once, so a caller
    // with its own retry would be the third try at a bucket that refills two
    // a second — and would hold its lane for it.
    paced: true,

    playlistId: playlistIdFrom,
    trackUri: (id) => `tidal:track:${id}`,
    trackId(uri) {
      const m = String(uri ?? "").match(/^tidal:track:(\d+)$/);
      return m ? m[1] : null;
    },

    async playlist(id) {
      const res = await call("GET", `/playlists/${id}`, { params: { include: "coverArt" } });
      return playlistShape(res.data, index(res.included), id);
    },

    // The first page comes off the playlist itself, which carries the count
    // for free (absent when the playlist is empty — that is 0, not unknown);
    // every later page off the items relationship with the cursor Tidal
    // handed back, and our own include re-attached, because the playlist's
    // `next` link drops it. Twenty a page, whatever page[limit] says.
    //
    // Each page also carries `entries`: the per-position handles a clear
    // needs (Tidal removes by itemId, not by track), so a replace that
    // follows a snapshot read does not read the playlist a second time.
    async items(id, cursor) {
      let data, links, total, included;
      if (cursor == null) {
        const res = await call("GET", `/playlists/${id}`, { params: { include: ITEMS_INCLUDE } });
        const rel = res.data?.relationships?.items ?? {};
        data = rel.data ?? [];
        links = rel.links ?? {};
        total = res.data?.attributes?.numberOfItems ?? 0;
        included = res.included;
      } else {
        const res = await call("GET", itemsPath(id), {
          params: { include: ITEMS_INCLUDE, "page[cursor]": cursor },
        });
        data = res.data ?? [];
        links = res.links ?? {};
        total = null;
        included = res.included;
      }
      const byKey = index(included);
      // A video, or a track the country cannot see, is a hole: the position
      // is kept and the Worker refuses to overwrite around it.
      const tracks = data.map((it) =>
        it?.type === "tracks" ? trackShape(byKey.get(`tracks:${it.id}`), byKey) : null);
      const entries = data.map((it) => ({
        id: String(it?.id ?? ""), type: it?.type ?? "tracks", itemId: it?.meta?.itemId ?? null,
      }));
      return { tracks, total, next: cursorOf(links.next), entries };
    },

    // The owner's own playlists. Page size and the cursor past the first page
    // are unmeasured (the probe account holds two); the cursor form is the
    // one every other listing uses.
    async myPlaylists(cursor) {
      const res = await call("GET", "/playlists", {
        params: { "filter[r.owners.id]": "me", ...(cursor ? { "page[cursor]": cursor } : {}) },
      });
      const playlists = (res.data ?? []).map((pl) => ({
        id: String(pl.id), name: pl.attributes?.name ?? "",
        description: pl.attributes?.description ?? "",
      }));
      return { playlists, next: cursorOf(res.links?.next) };
    },

    // Tidal has no replace. This is clear-then-add, and the moment between
    // them is the one the contract warns about: a failure after the first
    // DELETE has gone through leaves the playlist holding neither set, and
    // the error says so (`torn`) rather than letting the caller print
    // "nothing was written". Before that moment a throw means exactly that.
    //
    // `entries` are the handles from the read the caller already did; without
    // them the playlist is read again, page by page, for its itemIds. A
    // DELETE is idempotent — stale or unknown itemIds are ignored, the rest
    // go — so a retried clear is safe; a retried POST is not, because a track
    // posted twice is in the playlist twice. The transport retries only a
    // 429, which is refused before it runs.
    async replaceItems(id, uris, { entries } = {}) {
      // Every refill body is built — and a URI that is not a Tidal track
      // refused — before the clear, or a typo in batch two would tear the
      // playlist after batch one.
      const refill = bodies(uris);
      const handles = (entries ?? await readHandles(call, itemsPath(id)))
        .filter((h) => h?.itemId);
      // "Nothing changed" is claimed only when the failed call is known not
      // to have been processed (refused). A 5xx or a lost answer on the
      // FIRST call is torn too: Tidal may have done the work and the caller
      // would otherwise say the old contents are intact over a half-cleared
      // playlist — or retry a POST that landed, and double it.
      let cleared = 0;
      try {
        for (const batch of chunks(handles, BATCH)) {
          await call("DELETE", itemsPath(id), {
            body: { data: batch.map((h) => ({ id: h.id, type: h.type, meta: { itemId: h.itemId } })) },
          });
          cleared += batch.length;
        }
      } catch (e) {
        if (!cleared && refused(e)) throw e;
        throw torn(e, cleared
          ? `${cleared} of ${handles.length} old tracks were cleared and the rest were not`
          : `the clear of ${handles.length} old tracks was not confirmed and may have gone through`);
      }
      let posted = 0;
      try {
        for (const body of refill) {
          await call("POST", itemsPath(id), { body });
          posted += body.data.length;
        }
      } catch (e) {
        if (!handles.length && !posted && refused(e)) throw e;
        throw torn(e,
          `the ${handles.length} old tracks were cleared and ${posted} of ${uris.length} ` +
          `new ones landed${refused(e) ? "" : " for certain"}`, posted);
      }
    },

    async appendItems(id, uris) {
      for (const body of bodies(uris)) await call("POST", itemsPath(id), { body });
    },

    // Tidal stores "" as "" and reads it back — it does not ignore an empty
    // description the way Spotify does, so the space the Worker writes to
    // clear a Spotify line is written here as the blank it means.
    async describe(id, text) {
      const description = String(text ?? "").trim() ? String(text) : "";
      await call("PATCH", `/playlists/${id}`, {
        body: { data: { id, type: "playlists", attributes: { description } } },
      });
    },

    async rename(id, name) {
      await call("PATCH", `/playlists/${id}`, {
        body: { data: { id, type: "playlists", attributes: { name: playlistName(name) } } },
      });
    },

    // Tidal's playlist artwork is auto-generated and read-only (tidal/probe3.py
    // found it as an `artworks` resource with no write path). Refused here in
    // words, before any call, so a caller learns it from the answer and not
    // from a 4xx it has to interpret.
    async cover() {
      const err = new Error("Tidal playlist artwork is read-only — a cover cannot be set there");
      err.status = 501;
      throw err;
    },

    async createPlaylist({ name, description, public: isPublic = true }) {
      const res = await call("POST", "/playlists", {
        body: { data: { type: "playlists", attributes: {
          name, description: String(description ?? ""),
          accessType: isPublic ? "PUBLIC" : "UNLISTED",
        } } },
      });
      return playlistShape(res.data, index(res.included), res.data?.id);
    },

    async track(id) {
      const res = await call("GET", `/tracks/${id}`, { params: { include: TRACK_INCLUDE } });
      const tr = trackShape(res.data, index(res.included));
      if (!tr) {
        const err = new Error(`GET /tracks/${id} -> no track in the answer`);
        err.status = 404;
        throw err;
      }
      return tr;
    },

    // One call: the hits and their albums, artists and sleeves ride along as
    // nested includes. Twenty hits a page and no more is asked for; `limit`
    // trims. Hit order is Tidal's, not popularity's.
    async search(query, limit) {
      const res = await call("GET", "/searchResults", {
        params: { "filter[query]": query, include: SEARCH_INCLUDE },
      });
      const byKey = index(res.included);
      const result = Array.isArray(res.data) ? res.data[0] : res.data;
      const ids = (result?.relationships?.tracks?.data ?? []).map((t) => t.id);
      return ids.map((tid) => trackShape(byKey.get(`tracks:${tid}`), byKey))
        .filter(Boolean).slice(0, Math.max(1, Number(limit) || 20));
    },

    // A single ISRC is paginated on Tidal and can answer several pressings
    // (nine for one Nick Lowe single); the first page is what comes back. A
    // miss is `data: []`, never a 404.
    async byIsrc(isrc) {
      const res = await call("GET", "/tracks", {
        params: { "filter[isrc]": isrc, include: TRACK_INCLUDE },
      });
      const byKey = index(res.included);
      return (res.data ?? []).map((tr) => trackShape(tr, byKey)).filter(Boolean);
    },
  };
}

// A playlist reference: a bare UUID, the URI form BUTTONS may use, or the
// share links Tidal prints — listen.tidal.com/playlist/<uuid> is what "share"
// copies, tidal.com/playlist/<uuid>?play=true what the app opens, and
// tidal.com/browse/playlist/<uuid> the older form. A query string is ignored.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BARE_UUID = new RegExp(`^${UUID}$`, "i");
const PLAYLIST_URI = new RegExp(`^tidal:playlist:(${UUID})$`, "i");
const PLAYLIST_URL = new RegExp(
  `^https?://(?:listen\\.|www\\.)?tidal\\.com/(?:browse/)?playlist/(${UUID})(?:[/?#]|$)`, "i");

export function playlistIdFrom(ref) {
  const s = String(ref ?? "").trim();
  if (BARE_UUID.test(s)) return s.toLowerCase();
  const m = s.match(PLAYLIST_URI) || s.match(PLAYLIST_URL);
  return m ? m[1].toLowerCase() : null;
}

// ------------------------------------------------------------- the mapping

function index(included) {
  const byKey = new Map();
  for (const r of included ?? []) {
    if (r?.type && r?.id != null) byKey.set(`${r.type}:${r.id}`, r);
  }
  return byKey;
}

// The share link, out of the externalLinks every resource carries: the one
// typed TIDAL_SHARING, else the first, else nothing.
function shareLink(links) {
  const list = Array.isArray(links) ? links.filter((l) => typeof l?.href === "string") : [];
  return (list.find((l) => l.meta?.type === "TIDAL_SHARING") ?? list[0])?.href ?? null;
}

// Every image Tidal serves is resources.tidal.com/images/<uuid as five path
// segments>/<W>x<H>.jpg, listed under an `artworks` resource as files with
// their sizes. programs.js pins that shape before a page shows one.
function imagesOf(res, byKey) {
  const arts = (res?.relationships?.coverArt?.data ?? [])
    .map((a) => byKey.get(`artworks:${a.id}`)).filter(Boolean);
  const out = [];
  for (const art of arts) {
    for (const f of art.attributes?.files ?? []) {
      if (typeof f?.href !== "string") continue;
      out.push({ url: f.href, width: f.meta?.width ?? null, height: f.meta?.height ?? null });
    }
  }
  return out;
}

function playlistShape(pl, byKey, id) {
  const at = pl?.attributes ?? {};
  return {
    id: String(pl?.id ?? id), name: at.name ?? null, description: at.description ?? "",
    images: imagesOf(pl, byKey), url: shareLink(at.externalLinks),
  };
}

// ISO 8601: "PT3M34S"; hours, minutes and seconds each optional, seconds
// possibly fractional. Anything else is 0 rather than NaN, so a sum stays a
// number — a track with no duration is rare and prints as 0:00.
const ISO_DURATION = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/;

export function durationMs(iso) {
  const m = ISO_DURATION.exec(String(iso ?? ""));
  if (!m) return 0;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return Math.round(s * 1000);
}

// Tidal keeps "Remastered 2011" or "Live" in `version`, apart from the title,
// where Spotify runs them together. Joined here so a name reads the same
// whichever service it came from and two pressings stay tellable apart.
function trackShape(tr, byKey) {
  if (!tr?.id) return null;
  const at = tr.attributes ?? {};
  const rel = tr.relationships ?? {};
  const artists = (rel.artists?.data ?? [])
    .map((a) => byKey.get(`artists:${a.id}`)?.attributes?.name)
    .filter((n) => typeof n === "string").map((name) => ({ name }));
  const albumRes = (rel.albums?.data ?? [])
    .map((a) => byKey.get(`albums:${a.id}`)).find(Boolean) ?? null;
  const album = albumRes ? {
    name: albumRes.attributes?.title ?? "",
    release_date: albumRes.attributes?.releaseDate ?? "",
    images: imagesOf(albumRes, byKey),
  } : null;
  const availability = at.availability;
  return {
    uri: `tidal:track:${tr.id}`,
    id: String(tr.id),
    name: at.version ? `${at.title ?? ""} (${at.version})` : (at.title ?? ""),
    artists,
    album,
    images: album?.images ?? [],
    duration_ms: durationMs(at.duration),
    external_ids: at.isrc ? { isrc: String(at.isrc) } : {},
    // Only said when the service says it: a track without the list is not
    // known to be unplayable.
    ...(Array.isArray(availability) && !availability.includes("STREAM")
      ? { is_playable: false } : {}),
    // Passed through in the shape describeTrack reads, so a Tidal house gets
    // the same three states as a Spotify one. TIDAL carries this on the
    // track's attributes; where it does not, the field stays absent and the
    // Worker reports it as "not said" rather than as clean.
    ...(typeof at.explicit === "boolean" ? { explicit: at.explicit } : {}),
    // THE QUALITY TIDAL PLAYS IT AT (the owner, 2026-09-27): "max" is
    // HIRES_LOSSLESS, what the Tidal app calls Max (up to 24-bit/192 kHz);
    // "high" is LOSSLESS alone, CD quality. A track with neither says nothing.
    // Measured the same day: Kind of Blue max, every So What high.
    ...(Array.isArray(at.mediaTags) && at.mediaTags.includes("HIRES_LOSSLESS") ? { quality: "max" }
      : Array.isArray(at.mediaTags) && at.mediaTags.includes("LOSSLESS") ? { quality: "high" } : {}),
  };
}

// The opaque cursor out of a `next` link — the page[cursor] value, which is
// what every later request re-attaches to a path of its own. Null at the
// end, and null for a link with no cursor in it, which would otherwise loop.
function cursorOf(next) {
  if (typeof next !== "string" || !next) return null;
  try {
    return new URL(next, "https://openapi.tidal.com").searchParams.get("page[cursor]");
  } catch {
    return null;
  }
}

// Every (id, type, itemId) in a playlist, in order — the read a clear needs
// when the caller did not bring one. No include: the handles are all that is
// wanted, and a bare page is the cheaper answer.
async function readHandles(call, path) {
  const out = [];
  for (let cursor = null, hops = 0; hops < 200; hops++) {
    const res = await call("GET", path, {
      params: cursor ? { "page[cursor]": cursor } : {},
    });
    for (const it of res.data ?? []) {
      out.push({ id: String(it?.id ?? ""), type: it?.type ?? "tracks", itemId: it?.meta?.itemId ?? null });
    }
    cursor = cursorOf(res.links?.next);
    if (!cursor) break;
  }
  return out;
}

// The POST bodies for a list of URIs, fifty to a body, every URI checked
// first: a caller that clears before it posts must know none will be
// refused, and Tidal would 400 the whole batch for one bad id.
function bodies(uris) {
  const refs = uris.map((u) => {
    const m = String(u ?? "").match(/^tidal:track:(\d+)$/);
    if (!m) {
      const err = new Error(`${u} is not a Tidal track URI`);
      err.status = 400;
      throw err;
    }
    return { id: m[1], type: "tracks" };
  });
  return chunks(refs, BATCH).map((data) => ({ data }));
}

// Whether a failed call is known NOT to have been processed: Tidal refused
// it (a 4xx — a 429 included, which is turned away before any work), or the
// Worker never sent it (the budget). A 5xx, or no answer at all, is neither:
// the work may have been done and the answer lost.
function refused(e) {
  return e?.budgetExhausted === true || (e?.status >= 400 && e?.status < 500);
}

function torn(cause, what, landed = 0) {
  const err = new Error(`${what} (${cause?.message ?? cause})`);
  err.status = cause?.status ?? 500;
  err.retryAfter = cause?.retryAfter ?? 0;
  err.torn = true;
  err.landed = landed;
  return err;
}

function chunks(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
