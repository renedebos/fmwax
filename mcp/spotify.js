// Spotify as a catalog — see catalog.js for what each verb owes.
//
// `call(method, path, { params, body })` is the Worker's transport: token,
// subrequest budget and the point-of-no-return flag all live there, so this
// file is only the endpoints and the shapes. The shapes are Spotify's own,
// which is why most verbs here pass the answer through; the few that do not
// are the places the Web API changed underneath this project — noted inline,
// because each one cost an afternoon.

import { playlistName } from "./catalog.js";

// What the house asks Spotify for at sign-in: the terminal's login
// (install/login.js) and the app's Reconnect (spotify-login.js) read this one
// list. A token carries the scopes it was minted with, so a scope added later
// is a fresh login, never a setting — which is how `cover` answered 403 for
// two days in August.
export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
  "ugc-image-upload",
].join(" ");

const PAGE = 100;

export function spotifyCatalog(call) {
  return {
    name: "spotify",
    label: "Spotify",
    batch: PAGE,

    playlistId: playlistIdFrom,
    trackUri: (id) => `spotify:track:${id}`,
    trackId(uri) {
      const m = String(uri ?? "").match(/^spotify:track:([A-Za-z0-9]+)$/);
      return m ? m[1] : null;
    },

    async playlist(id) {
      const pl = await call("GET", `/playlists/${id}`, {
        params: { fields: "id,name,description,images,external_urls" },
      });
      return {
        id: pl.id ?? id, name: pl.name ?? null, description: pl.description ?? "",
        images: pl.images ?? [], url: pl.external_urls?.spotify ?? null,
      };
    },

    // Dev Mode nests the track under `item` where the old /tracks endpoint used
    // `track`; accept either so a future rename back does not silently return
    // a list of nulls.
    async items(id, cursor) {
      const offset = Number(cursor ?? 0);
      const page = await call("GET", `/playlists/${id}/items`, {
        params: { limit: PAGE, offset },
      });
      const raw = page.items ?? [];
      const tracks = raw.map((it) => it?.item || it?.track || null);
      const total = page.total ?? null;
      // Trust `total` over a short page: a page containing a null is still full.
      const done = total !== null
        ? offset + raw.length >= total
        : raw.length < PAGE;
      return { tracks, total, next: done || !raw.length ? null : offset + raw.length };
    },

    async myPlaylists(cursor) {
      const offset = Number(cursor ?? 0);
      const page = await call("GET", "/me/playlists", { params: { limit: 50, offset } });
      const items = (page.items ?? []).filter(Boolean);
      const playlists = items.map((pl) => ({
        id: pl.id, name: pl.name, description: pl.description ?? "",
      }));
      return { playlists, next: items.length < 50 ? null : offset + 50 };
    },

    async replaceItems(id, uris) {
      await call("PUT", `/playlists/${id}/items`, { body: { uris } });
    },

    async appendItems(id, uris) {
      await call("POST", `/playlists/${id}/items`, { body: { uris } });
    },

    async describe(id, text) {
      await call("PUT", `/playlists/${id}`, { body: { description: String(text ?? "") } });
    },

    async rename(id, name) {
      await call("PUT", `/playlists/${id}`, { body: { name: playlistName(name) } });
    },

    // A bare base64 JPEG, 256 KB cap on the encoded payload, answers 202.
    // Needs the ugc-image-upload scope, which the Worker's login asks for.
    async cover(id, jpegBase64) {
      await call("PUT", `/playlists/${id}/images`,
        { raw: { body: jpegBase64, contentType: "image/jpeg" } });
    },

    // POST /me/playlists, not /users/{id}/playlists — the latter was removed
    // in the Feb 2026 Development Mode migration. See mcp/README.md.
    async createPlaylist({ name, description, public: isPublic = true }) {
      const pl = await call("POST", "/me/playlists", {
        body: {
          name, public: isPublic,
          ...(description ? { description: String(description) } : {}),
        },
      });
      return {
        id: pl.id, name: pl.name ?? name, description: pl.description ?? "",
        images: pl.images ?? [], url: pl.external_urls?.spotify ?? null,
      };
    },

    // One request per track, never `GET /tracks?ids=`: that answers a bare 403
    // under February 2026 Development Mode — the same featureless Forbidden
    // the renamed playlist endpoints give, and just as easy to misread as a
    // scope problem. Measured 2026-08-28.
    track(id) {
      return call("GET", `/tracks/${id}`);
    },

    async search(query, limit) {
      const res = await call("GET", "/search", {
        params: { q: query, type: "track", limit },
      });
      return res.tracks?.items ?? [];
    },

    async byIsrc(isrc) {
      const res = await call("GET", "/search", {
        params: { q: `isrc:${isrc}`, type: "track", limit: 10 },
      });
      return res.tracks?.items ?? [];
    },
  };
}

export function playlistIdFrom(ref) {
  const uri = String(ref ?? "").match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (uri) return uri[1];
  const url = String(ref ?? "").match(/^https?:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
  if (url) return url[1];
  return /^[A-Za-z0-9]{22}$/.test(ref) ? ref : null;
}
