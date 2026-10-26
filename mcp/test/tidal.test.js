// The Worker on Tidal: the transport (token, lane, one 429 retry, the point
// of no return) and the safe-write path meeting a catalog that has no replace
// of its own. The adapter's own mapping is pinned in catalog.test.js; here
// the fake Tidal sits at fetch and the Worker builds every request itself.
import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch, installTidalFetch, TPL, TPID, PID, buttons } from "./harness.js";

const { replacePlaylistSafely, snapshotPlaylist, callTool } = __test;
const uris = (...ids) => ids.map((i) => `tidal:track:${i}`);
const ITEMS = `/playlists/${TPID}/relationships/items`;

// -------------------------------------------------------------- the transport

test("the Tidal token is refreshed from its own KV entry and sent as Bearer", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const f = installTidalFetch();
  const seen = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init?.headers?.Authorization, accept: init?.headers?.Accept });
    return inner(url, init);
  };
  try {
    await callTool(env, "search_tracks", { queries: [{ title: "x" }] });
    const search = seen.find((s) => s.url.includes("/searchResults"));
    assert.equal(search.auth, "Bearer tidal-token");
    assert.equal(search.accept, "application/vnd.api+json");
    assert.match(search.url, /countryCode=NL/, "every call carries the country");
    // Not Spotify's token, and not Spotify's KV entry.
    assert.ok(seen.some((s) => s.url.startsWith("https://auth.tidal.com/")));
    assert.ok(!seen.some((s) => s.url.includes("accounts.spotify.com")));
  } finally {
    globalThis.fetch = inner;
    f.restore();
  }
});

test("a 429 is retried once after its Retry-After, and a second one surfaces", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const limited = { status: 429, body: "", headers: { "retry-after": "0" } };
  let f = installTidalFetch({ fail: { "GET /searchResults": [limited] } });
  try {
    const out = await callTool(env, "search_tracks", { queries: [{ title: "x" }] });
    assert.equal(out.resolved[0].results.length, 1);
    assert.equal(f.calls.filter((c) => c === "GET /searchResults").length, 2);
  } finally { f.restore(); }

  // Twice in a row: the transport's one retry, and then the error — and
  // search_tracks' own retry stands down, because the catalog is paced.
  f = installTidalFetch({ fail: { "GET /searchResults": [limited, limited] } });
  try {
    await assert.rejects(
      () => callTool(env, "search_tracks", { queries: [{ title: "x" }] }),
      /all 1 lookups failed[\s\S]*429/);
    assert.equal(f.calls.filter((c) => c === "GET /searchResults").length, 2,
      "the transport's one retry, and never a third try from the tool");
  } finally { f.restore(); }
});

test("a token Tidal no longer honours is dropped, refreshed once, and the call re-sent", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const stale = { status: 401, body: JSON.stringify({ errors: [{ code: "UNAUTHORIZED", detail: "Invalid token structure" }] }) };
  const f = installTidalFetch({ fail: { "GET /searchResults": [stale] } });
  // Each refresh hands out a different token, so the resend is tellable.
  const inner = globalThis.fetch;
  let minted = 0;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://auth.tidal.com/")) {
      return new Response(JSON.stringify({ access_token: `tidal-token-${++minted}`, expires_in: 14400 }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/searchResults")) sent.push(init.headers.Authorization);
    return inner(url, init);
  };
  try {
    const out = await callTool(env, "search_tracks", { queries: [{ title: "x" }] });
    assert.equal(out.resolved[0].results.length, 1);
    assert.equal(sent.length, 2, "the 401 was answered by one resend");
    assert.notEqual(sent[0], sent[1], "with a fresh token, not the refused one");
    assert.equal(sent[1], `Bearer tidal-token-${minted}`);
  } finally {
    globalThis.fetch = inner;
    f.restore();
  }

  // And a second 401 is the error, not a loop.
  const g = installTidalFetch({ fail: { "GET /searchResults": [stale, stale] } });
  try {
    await assert.rejects(() => callTool(env, "search_tracks", { queries: [{ title: "x" }] }), /-> 401 UNAUTHORIZED/);
    assert.equal(g.calls.filter((c) => c === "GET /searchResults").length, 2);
  } finally { g.restore(); }
});

test("a Tidal error surfaces with its status, code and detail", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const f = installTidalFetch({ fail: { "GET /searchResults": {
    status: 400, body: JSON.stringify({ errors: [{ code: "INVALID_RESOURCE_ID", detail: "Invalid resource ID" }] }),
  } } });
  try {
    await assert.rejects(
      () => callTool(env, "search_tracks", { queries: [{ title: "x" }] }),
      /GET \/searchResults -> 400 INVALID_RESOURCE_ID: Invalid resource ID/);
  } finally { f.restore(); }
});

// ----------------------------------------------------------- the safe write

test("a Tidal replace clears by the snapshot's handles, refills, verifies, and blanks the line", async () => {
  const f = installTidalFetch({ contents: ["10", "11", "12"] });
  try {
    const env = makeEnv();
    const out = await replacePlaylistSafely(env, { pl: TPL, uris: uris("1", "2"), budget: null });
    assert.equal(out.ok, true);
    assert.equal(out.verified, "confirmed");
    assert.deepEqual(out.warnings, []);
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["1", "2"]);
    assert.deepEqual(out.snapshot.uris, uris("10", "11", "12"));
    assert.equal(out.snapshot.catalog, "tidal");
    // The clear used the handles the snapshot read carried: no second read.
    assert.ok(!f.calls.includes(`GET ${ITEMS}`), "the handles were not read twice");
    assert.equal(f.calls.filter((c) => c === `DELETE ${ITEMS}`).length, 1);
    // A blank is "" here — Tidal keeps a space as a space.
    assert.deepEqual(f.descriptionWrites, [""]);
  } finally { f.restore(); }
});

test("the stored backup does not carry the handles", async () => {
  const f = installTidalFetch({ contents: ["10"] });
  try {
    const env = makeEnv();
    const snap = await snapshotPlaylist(env, TPL, null);
    assert.equal(snap.entries.length, 1, "the write that follows gets them");
    const stored = await env.PROGRAMS.get(snap.key, { type: "json" });
    assert.equal(stored.entries, undefined, "a restore months later reads the playlist as it is then");
    assert.equal(stored.catalog, "tidal");
  } finally { f.restore(); }
});

test("a refill that fails after the clear is rolled back and reported, not thrown", async () => {
  // First POST is the refill, which fails; the second is the rollback's.
  const f = installTidalFetch({ contents: ["10", "11"], fail: { [`POST ${ITEMS}`]: ["boom"] } });
  try {
    const out = await replacePlaylistSafely(makeEnv(), { pl: TPL, uris: uris("1"), budget: null });
    assert.equal(out.ok, false);
    assert.equal(out.rolledBack, true);
    assert.equal(out.cleared, true);
    assert.equal(out.landed, 0);
    assert.match(out.what_happened, /put back[\s\S]*as it was/);
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["10", "11"]);
  } finally { f.restore(); }
});

test("when the rollback also fails, it says the playlist may be empty", async () => {
  const f = installTidalFetch({ contents: ["10"], fail: { [`POST ${ITEMS}`]: ["boom", "still boom"] } });
  try {
    const out = await replacePlaylistSafely(makeEnv(), { pl: TPL, uris: uris("1"), budget: null });
    assert.equal(out.ok, false);
    assert.equal(out.rolledBack, false);
    assert.match(out.what_happened, /may be EMPTY/);
    assert.match(out.what_happened, /restore_playlist/);
    assert.match(out.what_happened, /Do NOT claim the old contents are safe/);
    assert.deepEqual(f.state.items, []);
  } finally { f.restore(); }
});

test("a clear that is refused throws: nothing was written", async () => {
  const refused = { status: 403, body: JSON.stringify({ errors: [{ code: "FORBIDDEN", detail: "not yours" }] }) };
  const f = installTidalFetch({ contents: ["10"], fail: { [`DELETE ${ITEMS}`]: refused } });
  try {
    await assert.rejects(
      () => replacePlaylistSafely(makeEnv(), { pl: TPL, uris: uris("1"), budget: null }),
      /FORBIDDEN: not yours[\s\S]*Nothing was written; the previous contents are intact/);
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["10"]);
    assert.equal(f.calls.filter((c) => c === `POST ${ITEMS}`).length, 0, "no refill, no rollback");
  } finally { f.restore(); }
});

// A 5xx on the first DELETE is not a refusal: Tidal may have cleared and
// lost the answer. The Worker treats it as torn — puts the backup back and
// says so — rather than claim the contents are intact.
test("a clear that is not confirmed is rolled back and reported, not called unchanged", async () => {
  const f = installTidalFetch({ contents: ["10", "11"], fail: { [`DELETE ${ITEMS}`]: ["gateway fell over"] } });
  try {
    const out = await replacePlaylistSafely(makeEnv(), { pl: TPL, uris: uris("1"), budget: null });
    assert.equal(out.ok, false);
    assert.equal(out.cleared, true);
    assert.equal(out.rolledBack, true);
    assert.match(out.what_happened, /not confirmed and may have gone through/);
    assert.match(out.what_happened, /put back[\s\S]*as it was/);
    // The rollback read the playlist as it is (the fake's DELETE did not go
    // through), cleared it, and posted the backup.
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["10", "11"]);
    assert.equal(f.calls.filter((c) => c === `GET ${ITEMS}`).length, 1, "the rollback reads the handles afresh");
  } finally { f.restore(); }
});

test("the first clear is the point of no return: the budget stands down after it", async () => {
  const f = installTidalFetch({ contents: ["10"] });
  try {
    // One read and the clear, and not a call more.
    const budget = { remaining: 2 };
    const out = await replacePlaylistSafely(makeEnv(), { pl: TPL, uris: uris("1", "2"), budget });
    assert.equal(out.ok, true, "the refill and the read-backs were not refused");
    assert.equal(budget.critical, true);
    assert.ok(budget.remaining < 0);
  } finally { f.restore(); }
});

test("an unconfirmed clear crosses the point of no return too: the rollback is not cut short", async () => {
  const f = installTidalFetch({ contents: ["10"], fail: { [`DELETE ${ITEMS}`]: ["gateway fell over"] } });
  try {
    // One read and the clear that got a 502 — the rollback needs three more.
    const budget = { remaining: 2 };
    const out = await replacePlaylistSafely(makeEnv(), { pl: TPL, uris: uris("1"), budget });
    assert.equal(out.ok, false);
    assert.equal(out.rolledBack, true, "the rollback ran to the end on a spent budget");
    assert.equal(budget.critical, true);
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["10"]);
  } finally { f.restore(); }
});

test("a budget that runs out BEFORE the clear refuses cleanly, with the playlist intact", async () => {
  const f = installTidalFetch({ contents: ["10"] });
  try {
    const budget = { remaining: 1 };
    await assert.rejects(
      () => replacePlaylistSafely(makeEnv(), { pl: TPL, uris: uris("1"), budget }),
      /Nothing was written; the previous contents are intact/);
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["10"]);
  } finally { f.restore(); }
});

test("a long Tidal set is cleared and refilled in fifties, and read back in twenties", async () => {
  const before = Array.from({ length: 60 }, (_, i) => `${100 + i}`);
  const f = installTidalFetch({ contents: before });
  try {
    const long = Array.from({ length: 120 }, (_, i) => `tidal:track:${i}`);
    const out = await replacePlaylistSafely(makeEnv(), { pl: TPL, uris: long, budget: null });
    assert.equal(out.ok, true);
    assert.equal(out.verified, "confirmed");
    assert.equal(out.landed, 120);
    assert.deepEqual(f.state.items.map((it) => it.trackId), long.map((u) => u.split(":").pop()));
    assert.equal(f.calls.filter((c) => c === `DELETE ${ITEMS}`).length, 2);
    assert.equal(f.calls.filter((c) => c === `POST ${ITEMS}`).length, 3);
  } finally { f.restore(); }
});

// ------------------------------------------------------------ the identity

// A playlist is (catalog, id), and the id's shape says which: a UUID is
// Tidal's, 22 base-62 characters Spotify's. So a reference resolves without
// the house being asked — a direct UUID, a tidal:playlist: alias, a share
// link — and lands on the right service's write path.
test("a Tidal playlist resolves by UUID, URI, link or alias, and is written through Tidal", async () => {
  const env = makeEnv();
  env.PLAYLIST_ALIASES = JSON.stringify({ deep: `tidal:playlist:${TPID}` });
  const sp = installFetch();
  const f = installTidalFetch({ contents: ["1"] });
  try {
    for (const ref of [TPID, TPID.toUpperCase(), `tidal:playlist:${TPID}`,
      `https://listen.tidal.com/playlist/${TPID}`, "deep"]) {
      const read = await callTool(env, "read_playlist", { playlist: ref }, { remaining: 40 });
      assert.equal(read.id, TPID, ref);
      assert.equal(read.catalog, "tidal", ref);
      assert.equal(read.playlist, "Scratch", ref);
    }
    const out = await callTool(env, "replace_playlist", { playlist: "deep", uris: uris("5", "6") }, { remaining: 40 });
    assert.equal(out.tracks, 2);
    assert.equal(out.resolved_via, 'alias "deep"');
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["5", "6"]);
    assert.deepEqual(sp.calls, [], "Spotify saw nothing");
  } finally {
    f.restore();
    sp.restore();
  }
});

// The backup taken before a Tidal write is keyed by the UUID, and restore
// reads it back through the same key shape — the undo path is not Spotify's.
test("a Tidal write's backup is listed and restored under the UUID key", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch();
  const f = installTidalFetch({ contents: ["1", "2"] });
  try {
    await callTool(env, "replace_playlist", { playlist: "button 2", uris: uris("9") }, { remaining: 40 });
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["9"]);
    const preview = await callTool(env, "restore_playlist", { playlist: "button 2" }, { remaining: 40 });
    assert.match(preview.would_restore.from, new RegExp(`^snap:${TPID}:`));
    assert.equal(preview.would_restore.tracks, 2);
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["9"], "a preview writes nothing");
    const done = await callTool(env, "restore_playlist", { playlist: "button 2", confirm: true }, { remaining: 40 });
    assert.equal(done.restored, 2);
    assert.deepEqual(f.state.items.map((it) => it.trackId), ["1", "2"]);
    assert.deepEqual(sp.calls, [], "Spotify saw nothing");
  } finally {
    f.restore();
    sp.restore();
  }
});

// A house on both services searches both by name and refuses to guess when
// the same name is on each — the id says which, so the refusal offers it.
test("a name is looked for on every service the house is on, and one found on both is refused with both ids", async () => {
  const env = makeEnv();
  env.BUTTONS = JSON.stringify([
    { button: 1, dj: "dr-funkenstein", playlist: PID, catalog: "spotify" },
    { button: 2, dj: "hank", playlist: TPID, catalog: "tidal" },
  ]);
  // makeEnv's "scratch" alias would catch the name first; the point here is
  // the search that runs when no label matches.
  env.PLAYLIST_ALIASES = "{}";
  const sp = installFetch({ contents: [] });
  const f = installTidalFetch();
  // The Spotify fake lists no playlists of its own; the Tidal one lists a
  // "Scratch". So the name resolves to Tidal's — until Spotify has one too.
  let spotifyOwns = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === "api.spotify.com" && u.pathname === "/v1/me/playlists") {
      sp.calls.push("GET /me/playlists");
      return new Response(JSON.stringify({ items: spotifyOwns, total: spotifyOwns.length }),
        { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const one = await callTool(env, "read_playlist", { playlist: "scratch " }, { remaining: 40 });
    assert.equal(one.catalog, "tidal");
    assert.equal(one.id, TPID);
    assert.equal(one.resolved_via, "name");
    assert.ok(sp.calls.includes("GET /me/playlists"), "Spotify was searched by name");
    assert.ok(f.calls.includes("GET /playlists"), "and so was Tidal");

    spotifyOwns = [{ id: PID, name: "Scratch", description: "" }];
    await assert.rejects(
      () => callTool(env, "read_playlist", { playlist: "Scratch" }, { remaining: 40 }),
      new RegExp(`"Scratch" matches 2 playlists: ${PID} \\([A-Za-z]+\\), ${TPID} \\([A-Za-z]+\\) — pass one of those ids as`));
    await assert.rejects(
      () => callTool(env, "read_playlist", { playlist: "No Such Set" }, { remaining: 40 }),
      /no playlist named "No Such Set". Visible: Scratch \(Spotify\), Scratch \(Tidal\)/);
  } finally {
    globalThis.fetch = inner;
    f.restore();
    sp.restore();
  }
});

test("a name that one service could not list is refused, and the refusal says which service", async () => {
  const env = makeEnv();
  env.BUTTONS = JSON.stringify([
    { button: 1, dj: "dr-funkenstein", playlist: PID, catalog: "spotify" },
    { button: 2, dj: "hank", playlist: TPID, catalog: "tidal" },
  ]);
  env.PLAYLIST_ALIASES = "{}";
  const sp = installFetch();
  const f = installTidalFetch({ fail: { "GET /playlists": "down" } });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === "api.spotify.com" && u.pathname === "/v1/me/playlists") {
      return new Response(JSON.stringify({ items: [{ id: PID, name: "Mine", description: "" }], total: 1 }),
        { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    // Found on Spotify, but Tidal did not answer, so a second "Mine" there
    // cannot be ruled out — and "GET /playlists -> 500" on its own would not
    // say that Tidal was the one asked.
    await assert.rejects(
      () => callTool(env, "read_playlist", { playlist: "Mine" }, { remaining: 40 }),
      /"Mine" could not be looked for on Tidal: [\s\S]*Pass the id/);
  } finally {
    globalThis.fetch = inner;
    f.restore();
    sp.restore();
  }
});

// A new playlist in a house on both services goes where the caller says, and
// only after its name has been checked on both — a clash on either would
// leave two playlists no name can reach.
test("create_playlist in a mixed house needs a catalog, checks the name on both, and creates on the one named", async () => {
  const env = makeEnv();
  env.BUTTONS = JSON.stringify([
    { button: 1, dj: "dr-funkenstein", playlist: PID, catalog: "spotify" },
    { button: 2, dj: "hank", playlist: TPID, catalog: "tidal" },
  ]);
  // makeEnv's "scratch" alias would refuse the name below as an alias before
  // the clash check ran; the point here is the clash.
  env.PLAYLIST_ALIASES = "{}";
  const sp = installFetch();
  const f = installTidalFetch();
  const spotifyOwns = [{ id: PID, name: "Late Shift", description: "" }];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === "api.spotify.com" && u.pathname === "/v1/me/playlists") {
      sp.calls.push(`${init?.method ?? "GET"} /me/playlists`);
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: PID, name: JSON.parse(init.body).name }),
          { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ items: spotifyOwns, total: spotifyOwns.length }),
        { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    await assert.rejects(
      () => callTool(env, "create_playlist", { name: "Fresh" }, { remaining: 40 }),
      /this house has buttons on spotify and tidal — pass catalog: "spotify" or "tidal"/);
    await assert.rejects(
      () => callTool(env, "create_playlist", { name: "Fresh", catalog: "deezer" }, { remaining: 40 }),
      /catalog "deezer" is not one of spotify, tidal/);
    // The name is on the OTHER service from the one asked for, both ways.
    await assert.rejects(
      () => callTool(env, "create_playlist", { name: "late shift", catalog: "tidal" }, { remaining: 40 }),
      new RegExp(`"late shift" already exists on Spotify \\(${PID}\\)`));
    await assert.rejects(
      () => callTool(env, "create_playlist", { name: "Scratch", catalog: "spotify" }, { remaining: 40 }),
      new RegExp(`"Scratch" already exists on Tidal \\(${TPID}\\)`));
    assert.ok(!sp.calls.includes("POST /me/playlists"), "nothing was created on Spotify");
    assert.ok(!f.calls.includes("POST /playlists"), "nothing was created on Tidal");

    const made = await callTool(env, "create_playlist", { name: "Fresh", catalog: "tidal" }, { remaining: 40 });
    assert.equal(made.catalog, "tidal");
    assert.equal(made.id, TPID);
    assert.ok(f.calls.includes("POST /playlists"), "created on Tidal");
    assert.ok(!sp.calls.includes("POST /me/playlists"), "and not on Spotify");
  } finally {
    globalThis.fetch = inner;
    f.restore();
    sp.restore();
  }
});

// Starting is the one verb that stays Spotify's, and the refusal is the same
// at every door: play_playlist, a bare queue, and play_program — whether the
// program is still on its Tidal button or would need the replay copy.
test("a Tidal playlist cannot be started from here, and every start path says where the press is", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch();
  const f = installTidalFetch();
  try {
    await assert.rejects(
      () => callTool(env, "play_playlist", { playlist: TPID }, { remaining: 40 }),
      /can only start Spotify playlists[\s\S]*Press 2 on the remote \(Hank's button\)[\s\S]*nothing was sent/);
    await assert.rejects(
      () => callTool(env, "play_uris", { uris: uris("1") }, { remaining: 40 }),
      /tidal:track:1 are Tidal tracks, and this server can only start Spotify ones[\s\S]*Nothing was sent/);
    assert.deepEqual(sp.calls, [], "nothing reached Spotify's player");
  } finally {
    f.restore();
    sp.restore();
  }
});

const written = (calls) => calls.filter((c) => /^(POST|DELETE|PATCH) /.test(c));

test("play_program refuses a Tidal set its button still holds, pointing at the remote, and writes nothing", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  await env.PROGRAMS.put("program:a-night", JSON.stringify({
    slug: "a-night", dj: "Hank", title: "A Night", playlistId: TPID,
    sections: [{ tracks: [{ uri: "tidal:track:1" }, { uri: "tidal:track:2" }] }],
  }));
  await env.PROGRAMS.put(`current:${TPID}`, "a-night");
  const sp = installFetch();
  const f = installTidalFetch({ contents: ["1", "2"] });
  try {
    await assert.rejects(
      () => callTool(env, "play_program", { id: "a-night" }, { remaining: 40 }),
      /can only start Spotify playlists[\s\S]*Press 2 on the remote \(Hank's button\)/);
    assert.deepEqual(written(f.calls), [], "nothing written");
    assert.deepEqual(sp.calls, [], "nothing reached Spotify's player");
  } finally {
    f.restore();
    sp.restore();
  }
});

test("play_program refuses a Tidal set no preset holds, and a set with a track Spotify cannot start, before anything is sent", async () => {
  const env = makeEnv();
  env.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  await env.PROGRAMS.put("program:a-night", JSON.stringify({
    slug: "a-night", dj: "Hank", title: "A Night", playlistId: TPID,
    sections: [{ tracks: [{ uri: "tidal:track:1" }, { uri: "tidal:track:2" }] }],
  }));
  // Mostly Spotify, one Tidal track further down: the whole set or nothing.
  await env.PROGRAMS.put("program:mixed", JSON.stringify({
    slug: "mixed", dj: "Hank", title: "Mixed", playlistId: PID,
    sections: [{ tracks: [{ uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa" }, { uri: "tidal:track:2" }] }],
  }));
  const sp = installFetch();
  const f = installTidalFetch({ contents: ["9"] });
  try {
    await assert.rejects(
      () => callTool(env, "play_program", { id: "a-night" }, { remaining: 40 }),
      /"A Night" is a Tidal set, and no preset holds it[\s\S]*activate_program with id "a-night"[\s\S]*Nothing was changed/);
    await assert.rejects(
      () => callTool(env, "play_program", { id: "mixed" }, { remaining: 40 }),
      /"Mixed" has 1 recorded track\(s\) this server cannot start[\s\S]*Nothing was started/);
    assert.deepEqual(written(f.calls), []);
    assert.ok(!sp.calls.some((c) => /^(PUT|POST|DELETE) /.test(c)), "Spotify saw no write and no play");
  } finally {
    f.restore();
    sp.restore();
  }
});
