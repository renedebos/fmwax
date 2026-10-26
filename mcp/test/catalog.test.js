// The catalog contract (mcp/catalog.js), pinned against both implementations.
// `contract()` runs the same verbs against each adapter's fake transport, so a
// shape the Worker reads that one mapping forgot fails here rather than as a
// blank card on the buttons page. What differs per service — the answers its
// API gives and the requests each verb should have made — is the `wire`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOGS, catalogOfUri, unreachable } from "../catalog.js";
import { spotifyCatalog, playlistIdFrom } from "../spotify.js";
import { tidalCatalog, playlistIdFrom as tidalPlaylistIdFrom, durationMs } from "../tidal.js";
import { describeTrack } from "../playback.js";
import { __test } from "../worker.js";
import {
  makeEnv, installFetch, installTidalFetch, PID, TPID, buttons, track,
  tidalTrack, tidalIncluded, tidalArtwork,
} from "./harness.js";

const { callTool } = __test;
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;

// A transport that records what a verb asked for and answers from a script.
function fakeCall(answers) {
  const calls = [];
  const call = async (method, path, opts = {}) => {
    calls.push({ method, path, params: opts.params ?? null, body: opts.body ?? null });
    const key = `${method} ${path}`;
    const a = answers[key];
    if (a instanceof Error) throw a;
    if (typeof a === "function") return a(opts);
    return a ?? {};
  };
  return { call, calls };
}

// What each verb must do, whichever service is behind it. `wire` says what a
// service's own answers look like and which request each verb should have
// made — the part that differs per adapter — and the assertions below are the
// part that must not.
function contract(name, make, wire) {
  const t = (title, fn) => test(`${name}: ${title}`, fn);

  t("names itself and its batch size", () => {
    const cat = make(fakeCall({}).call);
    assert.equal(cat.name, name);
    assert.ok(CATALOGS.includes(cat.name));
    assert.match(cat.label, /^[A-Z]/);
    assert.ok(Number.isInteger(cat.batch) && cat.batch > 0);
  });

  t("track URIs round-trip through the catalog's own prefix", () => {
    const cat = make(fakeCall({}).call);
    const uri = cat.trackUri(wire.trackId);
    assert.equal(catalogOfUri(uri), name);
    assert.equal(cat.trackId(uri), wire.trackId);
    assert.equal(cat.trackId(`${name === "spotify" ? "tidal" : "spotify"}:track:${wire.trackId}`), null);
    assert.equal(cat.trackId("spotify:local:x"), null);
  });

  t("playlist() gives id, name, description, images and a link", async () => {
    const { call, calls } = fakeCall(wire.playlistAnswer);
    const pl = await make(call).playlist(wire.playlistId);
    assert.equal(pl.id, wire.playlistId);
    assert.equal(pl.name, "Scratch");
    assert.equal(pl.description, "a line");
    assert.ok(Array.isArray(pl.images) && pl.images[0].url);
    assert.match(pl.url, /^https:\/\//);
    wire.assertPlaylistRequest(calls);
  });

  t("playlist() with a blank description says \"\", never undefined", async () => {
    const { call } = fakeCall(wire.blankPlaylistAnswer);
    const pl = await make(call).playlist(wire.playlistId);
    assert.equal(pl.description, "");
    assert.equal(pl.url, null);
  });

  t("items() pages by cursor, keeps holes, and ends with next: null", async () => {
    const { call } = fakeCall(wire.itemsAnswer);
    const cat = make(call);
    const first = await cat.items(wire.playlistId, null);
    assert.equal(first.total, wire.itemsTotal);
    assert.equal(first.tracks.length, wire.pageSize);
    assert.equal(first.tracks[1], null, "an entry the service would not describe stays a hole");
    assert.notEqual(first.next, null);
    const second = await cat.items(wire.playlistId, first.next);
    assert.equal(second.tracks.length, wire.itemsTotal - wire.pageSize);
    assert.equal(second.next, null);
    for (const tr of [...first.tracks, ...second.tracks].filter(Boolean)) {
      assert.equal(catalogOfUri(tr.uri), name);
      assert.equal(typeof tr.name, "string");
      assert.ok(Array.isArray(tr.artists) && typeof tr.artists[0].name === "string");
      assert.equal(typeof tr.duration_ms, "number");
    }
  });

  t("a track carries album, images, year and ISRC in the Worker's shape", async () => {
    const { call } = fakeCall(wire.trackAnswer);
    const tr = await make(call).track(wire.trackId);
    assert.equal(tr.uri, make(call).trackUri(wire.trackId));
    assert.equal(tr.id, wire.trackId);
    assert.equal(tr.album.name, "An Album");
    assert.match(tr.album.release_date, /^\d{4}/);
    assert.ok(tr.album.images.some((i) => i.url && i.width));
    assert.equal(tr.external_ids.isrc, "USRC17607839");
  });

  t("myPlaylists() pages by cursor and gives id, name, description", async () => {
    const { call } = fakeCall(wire.myPlaylistsAnswer);
    const cat = make(call);
    const seen = [];
    for (let cursor = null; ; ) {
      const page = await cat.myPlaylists(cursor);
      seen.push(...page.playlists);
      cursor = page.next;
      if (cursor === null) break;
    }
    assert.equal(seen.length, wire.myPlaylistsTotal);
    for (const pl of seen) {
      assert.equal(typeof pl.id, "string");
      assert.equal(typeof pl.name, "string");
      assert.equal(typeof pl.description, "string");
    }
  });

  t("replaceItems, appendItems and describe send what they were given", async () => {
    const { call, calls } = fakeCall(wire.writeAnswer ?? {});
    const cat = make(call);
    const uris = wire.writeIds.map((id) => cat.trackUri(id));
    await cat.replaceItems(wire.playlistId, uris);
    await cat.appendItems(wire.playlistId, uris);
    await cat.describe(wire.playlistId, "loaded");
    await cat.rename(wire.playlistId, "Hank");
    wire.assertWrites(calls, uris);
  });

  t("rename() refuses a blank name before any call is made", async () => {
    const { call, calls } = fakeCall({});
    const cat = make(call);
    for (const bad of ["", "   ", null, undefined]) {
      await assert.rejects(cat.rename(wire.playlistId, bad),
        (e) => { assert.equal(e.status, 400); assert.match(e.message, /needs a name/); return true; });
    }
    assert.equal(calls.length, 0);
  });

  t("createPlaylist() gives back a Playlist", async () => {
    const { call, calls } = fakeCall(wire.createAnswer);
    const pl = await make(call).createPlaylist({ name: "New", description: "d", public: true });
    assert.equal(pl.id, wire.playlistId);
    assert.equal(pl.name, "New");
    wire.assertCreateRequest(calls);
  });

  t("search() and byIsrc() give tracks, and nothing for no matches", async () => {
    const { call } = fakeCall(wire.searchAnswer);
    const cat = make(call);
    const hits = await cat.search("cruel to be kind", 5);
    assert.ok(hits.length > 0);
    assert.equal(catalogOfUri(hits[0].uri), name);
    const byIsrc = await cat.byIsrc("USRC17607839");
    assert.ok(byIsrc.length > 0);
    assert.deepEqual(await make(fakeCall({}).call).search("nothing", 5), []);
  });

  t("a failed call surfaces with its status and retry-after", async () => {
    const err = Object.assign(new Error("boom"), { status: 429, retryAfter: 4 });
    const { call } = fakeCall({ [wire.trackRequest]: err });
    await assert.rejects(() => make(call).track(wire.trackId), (e) => {
      assert.equal(e.status, 429);
      assert.equal(e.retryAfter, 4);
      return true;
    });
  });
}

// ---------------------------------------------------------------- spotify

const spTrack = (id, extra = {}) => ({
  uri: `spotify:track:${id}`, id, name: `Track ${id}`, type: "track",
  duration_ms: 200000, artists: [{ name: "Someone" }],
  album: { name: "An Album", release_date: "1979-08-24",
    images: [{ url: `https://i.scdn.co/image/${id}`, width: 300, height: 300 }] },
  external_ids: { isrc: "USRC17607839" },
  ...extra,
});

contract("spotify", spotifyCatalog, {
  playlistId: PID,
  trackId: "6k2cLXLnrAnFFqt3W6sjT8",
  trackRequest: "GET /tracks/6k2cLXLnrAnFFqt3W6sjT8",
  writeIds: ["a", "b"],
  playlistAnswer: {
    [`GET /playlists/${PID}`]: {
      id: PID, name: "Scratch", description: "a line",
      images: [{ url: "https://i.scdn.co/image/pl", width: 640 }],
      external_urls: { spotify: `https://open.spotify.com/playlist/${PID}` },
    },
  },
  blankPlaylistAnswer: { [`GET /playlists/${PID}`]: { id: PID, name: "Scratch" } },
  assertPlaylistRequest(calls) {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].path, `/playlists/${PID}`);
    // The fields the contract promises, asked for by name so the answer is
    // not the whole playlist with its tracks.
    for (const f of ["name", "description", "images", "external_urls"]) {
      assert.ok(calls[0].params.fields.includes(f), f);
    }
  },
  // How many items one read returns — Spotify's page, not its write batch,
  // which only happen to be the same number.
  pageSize: 100,
  itemsTotal: 130,
  itemsAnswer: {
    [`GET /playlists/${PID}/items`]: ({ params }) => {
      const all = Array.from({ length: 130 }, (_, i) =>
        i === 1 ? { item: null } : { item: spTrack(`t${i}`) });
      return { total: 130, items: all.slice(params.offset, params.offset + params.limit) };
    },
  },
  trackAnswer: { "GET /tracks/6k2cLXLnrAnFFqt3W6sjT8": spTrack("6k2cLXLnrAnFFqt3W6sjT8") },
  myPlaylistsTotal: 70,
  myPlaylistsAnswer: {
    "GET /me/playlists": ({ params }) => {
      const all = Array.from({ length: 70 }, (_, i) => ({ id: P(i), name: `List ${i}` }));
      return { items: all.slice(params.offset, params.offset + params.limit) };
    },
  },
  assertWrites(calls, uris) {
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
      `PUT /playlists/${PID}/items`, `POST /playlists/${PID}/items`, `PUT /playlists/${PID}`,
      `PUT /playlists/${PID}`,
    ]);
    assert.deepEqual(calls[0].body, { uris });
    assert.deepEqual(calls[1].body, { uris });
    assert.deepEqual(calls[2].body, { description: "loaded" });
    assert.deepEqual(calls[3].body, { name: "Hank" });
  },
  createAnswer: {
    "POST /me/playlists": ({ body }) => ({
      id: PID, name: body.name, description: body.description ?? "",
      external_urls: { spotify: `https://open.spotify.com/playlist/${PID}` },
    }),
  },
  assertCreateRequest(calls) {
    // /me/playlists, never /users/{id}/playlists — see spotify.js.
    assert.equal(calls[0].path, "/me/playlists");
    assert.equal(calls[0].body.public, true);
    assert.equal(calls[0].body.description, "d");
  },
  searchAnswer: {
    "GET /search": ({ params }) => {
      assert.equal(params.type, "track");
      if (params.q.startsWith("isrc:")) assert.equal(params.q, "isrc:USRC17607839");
      return { tracks: { items: [spTrack("hit")] } };
    },
  },
});

test("spotify: playlist references come as id, URI or share URL", () => {
  for (const ref of [PID, `spotify:playlist:${PID}`, `https://open.spotify.com/playlist/${PID}?si=x`]) {
    assert.equal(playlistIdFrom(ref), PID);
  }
  assert.equal(playlistIdFrom("button 3"), null);
  assert.equal(playlistIdFrom(undefined), null);
});

// ------------------------------------------------------------------ tidal

// A page of a playlist's items as Tidal's relationship endpoint answers it:
// the handles in `data`, the resources in `included`, twenty a page.
const T_ITEMS = 30;
const T_PAGE = 20;
function tidalItemsPage(offset) {
  const ids = Array.from({ length: T_ITEMS }, (_, i) => `${100 + i}`);
  const slice = ids.slice(offset, offset + T_PAGE);
  // Position 1 is a video: the Worker gets a hole there, not a track.
  const data = slice.map((id, i) => offset + i === 1
    ? { id: "v1", type: "videos", meta: { itemId: `it-${id}` } }
    : { id, type: "tracks", meta: { itemId: `it-${id}` } });
  const more = offset + T_PAGE < T_ITEMS;
  return {
    data,
    included: tidalIncluded(slice.filter((_, i) => offset + i !== 1)),
    links: more
      ? { next: `/playlists/${TPID}/relationships/items?include=items.albums%2Citems.artists&countryCode=NL&page%5Bcursor%5D=c${offset + T_PAGE}` }
      : {},
  };
}

contract("tidal", tidalCatalog, {
  playlistId: TPID,
  trackId: "251380837",
  trackRequest: "GET /tracks/251380837",
  writeIds: ["1", "2"],
  playlistAnswer: {
    [`GET /playlists/${TPID}`]: {
      data: {
        id: TPID, type: "playlists",
        attributes: { name: "Scratch", description: "a line", numberOfItems: 3,
          externalLinks: [
            { href: `https://tidal.com/playlist/${TPID}?play=true`, meta: { type: "TIDAL_AUTOPLAY_ANDROID" } },
            { href: `https://listen.tidal.com/playlist/${TPID}`, meta: { type: "TIDAL_SHARING" } },
          ] },
        relationships: { coverArt: { data: [{ id: "art-pl", type: "artworks" }] } },
      },
      included: [tidalArtwork("art-pl", "pl")],
    },
  },
  blankPlaylistAnswer: {
    [`GET /playlists/${TPID}`]: {
      data: { id: TPID, type: "playlists", attributes: { name: "Scratch" } },
    },
  },
  assertPlaylistRequest(calls) {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].path, `/playlists/${TPID}`);
    assert.ok(calls[0].params.include.split(",").includes("coverArt"), "asks for the sleeve");
  },
  pageSize: T_PAGE,
  itemsTotal: T_ITEMS,
  itemsAnswer: {
    // The first page rides on the playlist itself, whose `next` link comes
    // without the include; the rest come off the relationship, by cursor.
    [`GET /playlists/${TPID}`]: ({ params }) => {
      assert.ok(params.include.includes("items.albums.coverArt"), "sleeves ride along");
      const first = tidalItemsPage(0);
      return {
        data: { id: TPID, type: "playlists",
          attributes: { name: "Scratch", numberOfItems: T_ITEMS },
          relationships: { items: { data: first.data,
            links: { next: `/playlists/${TPID}/relationships/items?countryCode=NL&page%5Bcursor%5D=c${T_PAGE}` } } } },
        included: first.included,
      };
    },
    [`GET /playlists/${TPID}/relationships/items`]: ({ params }) => {
      assert.equal(params["page[cursor]"], `c${T_PAGE}`, "the cursor out of the link, as given");
      assert.ok(params.include.includes("items.albums.coverArt"), "re-attached: the link dropped it");
      return tidalItemsPage(T_PAGE);
    },
  },
  trackAnswer: {
    "GET /tracks/251380837": { data: tidalTrack("251380837"), included: tidalIncluded(["251380837"]) },
  },
  myPlaylistsTotal: 3,
  myPlaylistsAnswer: {
    "GET /playlists": ({ params }) => {
      assert.equal(params["filter[r.owners.id]"], "me");
      const pl = (i) => ({ id: `0b1f2c3d-0000-0000-0000-00000000000${i}`, type: "playlists",
        attributes: { name: `List ${i}`, description: "" } });
      return params["page[cursor]"]
        ? { data: [pl(3)], links: {} }
        : { data: [pl(1), pl(2)], links: { next: "/playlists?page%5Bcursor%5D=p2" } };
    },
  },
  // No entries handed in, so the replace reads the handles first — and an
  // empty playlist has nothing to clear.
  writeAnswer: { [`GET /playlists/${TPID}/relationships/items`]: { data: [], links: {} } },
  assertWrites(calls, uris) {
    const items = `/playlists/${TPID}/relationships/items`;
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
      `GET ${items}`, `POST ${items}`, `POST ${items}`, `PATCH /playlists/${TPID}`,
      `PATCH /playlists/${TPID}`,
    ]);
    const data = uris.map((u) => ({ id: u.split(":").pop(), type: "tracks" }));
    assert.deepEqual(calls[1].body, { data });
    assert.deepEqual(calls[2].body, { data });
    assert.deepEqual(calls[3].body,
      { data: { id: TPID, type: "playlists", attributes: { description: "loaded" } } });
    assert.deepEqual(calls[4].body,
      { data: { id: TPID, type: "playlists", attributes: { name: "Hank" } } });
  },
  createAnswer: {
    "POST /playlists": ({ body }) => ({
      data: { id: TPID, type: "playlists",
        attributes: { ...body.data.attributes,
          externalLinks: [{ href: `https://listen.tidal.com/playlist/${TPID}`, meta: { type: "TIDAL_SHARING" } }] } },
    }),
  },
  assertCreateRequest(calls) {
    assert.equal(calls[0].path, "/playlists");
    assert.equal(calls[0].body.data.type, "playlists");
    // PUBLIC as measured: a program's listen link has to work for a stranger.
    assert.equal(calls[0].body.data.attributes.accessType, "PUBLIC");
    assert.equal(calls[0].body.data.attributes.description, "d");
  },
  searchAnswer: {
    "GET /searchResults": ({ params }) => {
      assert.equal(params["filter[query]"], "cruel to be kind");
      assert.ok(params.include.includes("tracks.albums.coverArt"), "one call, sleeves and all");
      return {
        data: { id: "cruel to be kind", type: "searchResults",
          relationships: { tracks: { data: [{ id: "hit", type: "tracks" }] } } },
        included: tidalIncluded(["hit"]),
      };
    },
    "GET /tracks": ({ params }) => {
      assert.equal(params["filter[isrc]"], "USRC17607839");
      return { data: [tidalTrack("hit")], included: tidalIncluded(["hit"]) };
    },
  },
});

test("tidal: playlist references come as a UUID, a URI or any of the share links", () => {
  const upper = TPID.toUpperCase();
  for (const ref of [
    TPID, upper, `tidal:playlist:${TPID}`,
    `https://listen.tidal.com/playlist/${TPID}`,
    `https://tidal.com/playlist/${TPID}?play=true`,
    `https://tidal.com/browse/playlist/${TPID}`,
    `https://www.tidal.com/browse/playlist/${TPID}/`,
  ]) {
    assert.equal(tidalPlaylistIdFrom(ref), TPID, ref);
  }
  assert.equal(tidalPlaylistIdFrom(PID), null, "a Spotify id is not a UUID");
  assert.equal(tidalPlaylistIdFrom(`https://tidal.com/browse/track/${TPID}`), null);
  assert.equal(tidalPlaylistIdFrom("button 3"), null);
  assert.equal(tidalPlaylistIdFrom(undefined), null);
});

test("tidal: ISO durations become milliseconds, and nothing becomes 0", () => {
  assert.equal(durationMs("PT3M34S"), 214000);
  assert.equal(durationMs("PT1H2M3.5S"), 3723500);
  assert.equal(durationMs("PT45S"), 45000);
  assert.equal(durationMs("PT4M"), 240000);
  assert.equal(durationMs(undefined), 0);
  assert.equal(durationMs("3:34"), 0);
});

test("tidal: a track's version joins its title, and only a missing STREAM says unplayable", async () => {
  const answers = {
    "GET /tracks/1": { data: tidalTrack("1", { title: "Song", version: "Live" }), included: tidalIncluded(["1"]) },
    "GET /tracks/2": { data: tidalTrack("2", { availability: ["DJ"] }), included: tidalIncluded(["2"]) },
    "GET /tracks/3": { data: tidalTrack("3", { availability: null }), included: tidalIncluded(["3"]) },
  };
  const cat = tidalCatalog(fakeCall(answers).call);
  const live = await cat.track("1");
  assert.equal(live.name, "Song (Live)");
  assert.equal(live.artists[0].name, "Someone");
  assert.equal(live.duration_ms, 200000);
  assert.ok(live.images.every((i) => i.url.startsWith("https://resources.tidal.com/images/")));
  assert.equal((await cat.track("2")).is_playable, false);
  assert.equal("is_playable" in await cat.track("3"), false, "unsaid is not unplayable");
});

test("tidal: the quality Tidal plays a track at — max for HIRES_LOSSLESS, high for LOSSLESS alone, nothing unsaid — reaches the search answer", async () => {
  const answers = {
    "GET /tracks/1": { data: tidalTrack("1", { mediaTags: ["HIRES_LOSSLESS", "LOSSLESS"] }), included: tidalIncluded(["1"]) },
    "GET /tracks/2": { data: tidalTrack("2", { mediaTags: ["LOSSLESS"] }), included: tidalIncluded(["2"]) },
    "GET /tracks/3": { data: tidalTrack("3", { mediaTags: [] }), included: tidalIncluded(["3"]) },
  };
  const cat = tidalCatalog(fakeCall(answers).call);
  assert.equal((await cat.track("1")).quality, "max");
  assert.equal((await cat.track("2")).quality, "high");
  assert.equal("quality" in await cat.track("3"), false);
  assert.equal(describeTrack(await cat.track("1")).quality, "max");
  assert.equal("quality" in describeTrack(await cat.track("3")), false);
});

test("tidal: items() carries a handle per position, holes included", async () => {
  const { call } = fakeCall({
    [`GET /playlists/${TPID}`]: () => {
      const first = tidalItemsPage(0);
      return { data: { id: TPID, type: "playlists", attributes: { numberOfItems: T_ITEMS },
        relationships: { items: { data: first.data, links: {} } } }, included: first.included };
    },
  });
  const page = await tidalCatalog(call).items(TPID, null);
  assert.equal(page.entries.length, page.tracks.length);
  assert.deepEqual(page.entries[0], { id: "100", type: "tracks", itemId: "it-100" });
  assert.equal(page.tracks[1], null);
  assert.equal(page.entries[1].type, "videos", "the hole keeps its handle, so a clear can still remove it");
  assert.equal(page.next, null);
});

test("tidal: an empty playlist reads as 0 of nothing, not unknown", async () => {
  const { call } = fakeCall({
    [`GET /playlists/${TPID}`]: { data: { id: TPID, type: "playlists", attributes: { name: "Scratch" },
      relationships: { items: { data: [], links: {} } } } },
  });
  const page = await tidalCatalog(call).items(TPID, null);
  assert.deepEqual(page, { tracks: [], total: 0, next: null, entries: [] });
});

// The verb the contract warns about. Tidal has no replace, so this is a
// clear and a refill, and the tests below are the moments in between.
test("tidal: replaceItems clears by the handles it was given and reads nothing", async () => {
  const { call, calls } = fakeCall({});
  const entries = [{ id: "7", type: "tracks", itemId: "it-7" }, { id: "v", type: "videos", itemId: "it-v" }];
  await tidalCatalog(call).replaceItems(TPID, ["tidal:track:1", "tidal:track:2"], { entries });
  assert.deepEqual(calls.map((c) => c.method), ["DELETE", "POST"]);
  assert.deepEqual(calls[0].body, { data: [
    { id: "7", type: "tracks", meta: { itemId: "it-7" } },
    { id: "v", type: "videos", meta: { itemId: "it-v" } },
  ] });
  assert.deepEqual(calls[1].body, { data: [{ id: "1", type: "tracks" }, { id: "2", type: "tracks" }] });
});

test("tidal: without handles it reads them, and writes in batches of fifty", async () => {
  const items = `/playlists/${TPID}/relationships/items`;
  const ids = Array.from({ length: 60 }, (_, i) => `${i}`);
  const { call, calls } = fakeCall({
    [`GET ${items}`]: ({ params }) => params["page[cursor]"]
      ? { data: ids.slice(20).map((id) => ({ id, type: "tracks", meta: { itemId: `it-${id}` } })), links: {} }
      : { data: ids.slice(0, 20).map((id) => ({ id, type: "tracks", meta: { itemId: `it-${id}` } })),
          links: { next: `${items}?page%5Bcursor%5D=next` } },
  });
  await tidalCatalog(call).replaceItems(TPID, ids.map((id) => `tidal:track:${id}`));
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET", "DELETE", "DELETE", "POST", "POST"]);
  assert.equal(calls[0].params.include, undefined, "handles only — no sleeves for a clear");
  assert.equal(calls[2].body.data.length, 50);
  assert.equal(calls[3].body.data.length, 10);
  assert.equal(calls[4].body.data.length, 50);
  assert.equal(calls[5].body.data.length, 10);
});

test("tidal: a refusal before anything is cleared is a plain error; after, it is torn", async () => {
  const items = `/playlists/${TPID}/relationships/items`;
  const refusedDelete = Object.assign(new Error("DELETE -> 403"), { status: 403 });
  const entries = [{ id: "7", type: "tracks", itemId: "it-7" }];
  // The clear itself is refused: nothing changed.
  await assert.rejects(
    () => tidalCatalog(fakeCall({ [`DELETE ${items}`]: refusedDelete }).call)
      .replaceItems(TPID, ["tidal:track:1"], { entries }),
    (e) => { assert.equal(e.torn, undefined); assert.equal(e.status, 403); return true; });

  // So is a budget that ran out before it: the Worker never sent it.
  const unsent = Object.assign(new Error("out of budget"), { budgetExhausted: true });
  await assert.rejects(
    () => tidalCatalog(fakeCall({ [`DELETE ${items}`]: unsent }).call)
      .replaceItems(TPID, ["tidal:track:1"], { entries }),
    (e) => { assert.equal(e.torn, undefined); return true; });

  // The clear went through and the refill did not.
  const fail = Object.assign(new Error("POST -> 500"), { status: 500 });
  await assert.rejects(
    () => tidalCatalog(fakeCall({ [`POST ${items}`]: fail }).call)
      .replaceItems(TPID, ["tidal:track:1"], { entries }),
    (e) => {
      assert.equal(e.torn, true);
      assert.equal(e.landed, 0);
      assert.match(e.message, /1 old tracks were cleared and 0 of 1 new ones landed for certain/);
      return true;
    });

  // The second batch of the refill fails: torn, and it says how many are in.
  let posts = 0;
  const flaky = fakeCall({ [`POST ${items}`]: () => { if (posts++) throw fail; return {}; } });
  const many = Array.from({ length: 60 }, (_, i) => `tidal:track:${i}`);
  await assert.rejects(
    () => tidalCatalog(flaky.call).replaceItems(TPID, many, { entries }),
    (e) => { assert.equal(e.torn, true); assert.equal(e.landed, 50); return true; });

  // An empty playlist whose refill is refused on its first batch: nothing changed.
  const refusedPost = Object.assign(new Error("POST -> 400"), { status: 400 });
  await assert.rejects(
    () => tidalCatalog(fakeCall({ [`POST ${items}`]: refusedPost }).call)
      .replaceItems(TPID, ["tidal:track:1"], { entries: [] }),
    (e) => { assert.equal(e.torn, undefined); return true; });
});

// A 5xx, or no answer at all, on the FIRST call is not "nothing changed":
// Tidal may have done the work and lost the answer. A DELETE that went
// through would leave the playlist half empty behind a claim that it is
// intact; a POST that landed would be doubled by the retry that claim invites.
test("tidal: a first call that is not confirmed is torn, not unchanged", async () => {
  const items = `/playlists/${TPID}/relationships/items`;
  const entries = [{ id: "7", type: "tracks", itemId: "it-7" }];
  const lost = Object.assign(new Error("DELETE -> 502"), { status: 502 });
  await assert.rejects(
    () => tidalCatalog(fakeCall({ [`DELETE ${items}`]: lost }).call)
      .replaceItems(TPID, ["tidal:track:1"], { entries }),
    (e) => {
      assert.equal(e.torn, true);
      assert.equal(e.landed, 0);
      assert.match(e.message, /clear of 1 old tracks was not confirmed and may have gone through/);
      return true;
    });

  // No status at all — the fetch itself failed.
  const dropped = new TypeError("fetch failed");
  await assert.rejects(
    () => tidalCatalog(fakeCall({ [`POST ${items}`]: dropped }).call)
      .replaceItems(TPID, ["tidal:track:1"], { entries: [] }),
    (e) => {
      assert.equal(e.torn, true);
      assert.match(e.message, /0 of 1 new ones landed for certain/);
      return true;
    });
});

test("tidal: a URI that is not a Tidal track is refused before the clear", async () => {
  const { call, calls } = fakeCall({});
  const cat = tidalCatalog(call);
  await assert.rejects(
    () => cat.appendItems(TPID, ["tidal:track:1", "spotify:track:x"]),
    /spotify:track:x is not a Tidal track URI/);
  // In the SECOND batch of a replace, with a playlist to clear first: still
  // no call, or a typo would tear the playlist after batch one.
  const entries = [{ id: "7", type: "tracks", itemId: "it-7" }];
  const many = Array.from({ length: 50 }, (_, i) => `tidal:track:${i}`).concat("spotify:track:x");
  await assert.rejects(
    () => cat.replaceItems(TPID, many, { entries }),
    (e) => { assert.equal(e.torn, undefined); assert.equal(e.status, 400); return true; });
  assert.equal(calls.length, 0);
});

test("tidal: describe() writes a blank as \"\" — Tidal stores what it is sent", async () => {
  const { call, calls } = fakeCall({});
  const cat = tidalCatalog(call);
  await cat.describe(TPID, " ");
  await cat.describe(TPID, "A title");
  assert.equal(calls[0].body.data.attributes.description, "");
  assert.equal(calls[1].body.data.attributes.description, "A title");
});

// ------------------------------------------------------- the seam itself

test("catalogOfUri reads the prefix and refuses what no catalog takes", () => {
  assert.equal(catalogOfUri("spotify:track:abc"), "spotify");
  assert.equal(catalogOfUri("tidal:track:123"), "tidal");
  assert.equal(catalogOfUri("spotify:local:x"), null);
  assert.equal(catalogOfUri("spotify:episode:x"), null);
  assert.equal(catalogOfUri("deezer:track:1"), null);
  assert.equal(catalogOfUri(null), null);
});

test("an unreachable catalog is refused with a 501 and the same sentence everywhere", () => {
  const e = unreachable("tidal");
  assert.equal(e.status, 501);
  assert.match(e.message, /tidal playlists cannot be reached[\s\S]*Nothing was changed/);
});

// The tools resolve a playlist first and then check that every URI is that
// playlist's catalog's own. A Tidal URI aimed at a Spotify playlist is refused
// before anything is written — and so before the backup is taken, because a
// backup of a write that was never going to happen is noise in the store.
for (const tool of ["replace_playlist", "append_to_playlist"]) {
  test(`${tool} refuses URIs from another catalog before touching the playlist`, async () => {
    const env = makeEnv();
    env.BUTTONS = buttons({ 3: P(3) });
    const f = installFetch({ contents: [] });
    try {
      await assert.rejects(
        () => callTool(env, tool, { playlist: "button 3", uris: ["tidal:track:1"] }),
        /is a Spotify playlist and these are not Spotify track URIs[\s\S]*Nothing was changed/);
      assert.ok(!f.calls.some((c) => c.includes("/items")), "nothing was read or written");
    } finally {
      f.restore();
    }
  });
}

test("a URI no catalog knows is refused for what it is", async () => {
  const env = makeEnv();
  await assert.rejects(
    () => callTool(env, "replace_playlist", { playlist: "scratch", uris: ["deezer:track:1"] }),
    /not track URIs: deezer:track:1/);
});

// The house decides which catalog a search means. One catalog: that one. Two:
// say which, because the wrong guess hands a Tidal id to Spotify — and
// `catalog` says which, on the tool that would otherwise have to guess.
test("search_tracks goes to the house's catalog, and a mixed house is refused unless told", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 1: P(1), 3: P(3) });
  const f = installFetch();
  try {
    const out = await callTool(env, "search_tracks", { queries: [{ title: "x" }] });
    assert.equal(out.resolved[0].query, "x");
    assert.ok(f.calls.includes("GET /search"));
  } finally {
    f.restore();
  }
  env.BUTTONS = JSON.stringify([
    { button: 1, dj: "dr-funkenstein", playlist: P(1), catalog: "spotify" },
    { button: 2, dj: "hank", playlist: TPID, catalog: "tidal" },
  ]);
  await assert.rejects(
    () => callTool(env, "search_tracks", { queries: [{ title: "x" }] }),
    /buttons on spotify and tidal — pass catalog: "spotify" or "tidal"/);
  await assert.rejects(
    () => callTool(env, "search_tracks", { queries: [{ title: "x" }], catalog: "deezer" }),
    /catalog "deezer" is not one of spotify, tidal/);
  const sp = installFetch();
  const td = installTidalFetch();
  try {
    const out = await callTool(env, "search_tracks", { queries: [{ title: "x" }], catalog: "tidal" });
    assert.equal(out.resolved[0].results[0].uri, "tidal:track:hit");
    assert.ok(td.calls.includes("GET /searchResults"));
    assert.ok(!sp.calls.includes("GET /search"), "Spotify was not asked");
  } finally {
    td.restore();
    sp.restore();
  }
});

test("a house entirely on Tidal searches Tidal, and gets Tidal URIs back", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch();
  const f = installTidalFetch();
  try {
    const out = await callTool(env, "search_tracks", { queries: [{ title: "x" }] });
    assert.ok(f.calls.includes("GET /searchResults"));
    assert.ok(!sp.calls.includes("GET /search"), "Spotify was not asked");
    assert.equal(out.resolved[0].results[0].uri, "tidal:track:hit");
  } finally {
    f.restore();
    sp.restore();
  }
});

// THREE STATES, because two would lie. A brief that refuses explicit records
// has to be able to tell "the service says clean" from "the service did not
// say", and the tools used to report neither: a set curated on 2026-09-04
// under exactly such a brief put the album cut of Hollaback Girl on a
// child's button, because remembering which pressing is clean was
// the only method available. `true` is said, `null` is not said, and absent
// is clean — a DJ who must refuse explicit records refuses the null too.
test("read_playlist says whether each track is explicit, and says nothing only for clean", async () => {
  const env = makeEnv();
  const f = installFetch({ contents: [
    { ...track("a"), explicit: true },
    { ...track("b"), explicit: false },
    // The field absent altogether: a service that does not answer the
    // question, which must never read as an answer.
    (({ explicit, ...rest }) => rest)({ ...track("c") }),
  ] });
  try {
    const out = await callTool(env, "read_playlist", { playlist: "scratch" }, { remaining: 40 });
    assert.equal(out.tracks[0].explicit, true, "said explicit");
    assert.ok(!("explicit" in out.tracks[1]), "said clean — the field is left off");
    assert.equal(out.tracks[2].explicit, null, "not said is null, never clean");
  } finally {
    f.restore();
  }
});

// The same three states on the tool a set is actually built with, and on a
// catalog that does not carry the field: Tidal's stub answers no `explicit`,
// so every result must come back null rather than quietly clean.
test("a search result whose catalog never says is null, not clean", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch();
  const f = installTidalFetch();
  try {
    const out = await callTool(env, "search_tracks", { queries: [{ title: "x" }] });
    assert.equal(out.resolved[0].results[0].explicit, null);
  } finally {
    f.restore();
    sp.restore();
  }
});

test("resolvePlaylist stamps the catalog on what it returns", async () => {
  const env = makeEnv();
  const f = installFetch({ contents: [] });
  try {
    const out = await callTool(env, "read_playlist", { playlist: "scratch" });
    assert.equal(out.id, PID);
    assert.equal(out.catalog, "spotify");
  } finally {
    f.restore();
  }
});
