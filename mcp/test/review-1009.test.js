// THE REVIEWS OF 2026-10-09: Codex's adversarial pass over the week's changes,
// and the two reviews of the pages at phone size. One test per fix that the
// other suites do not already pin.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { shelfFor } from "../house.js";
import { makeEnv, installFetch } from "./harness.js";

const { presetOnFile, endlessLoad } = __test;
const KEY = "abcdefabcdefabcdefabcdef";
const AMERICANA = "SAMPLEPLAYLIST00000025";

function env() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" });
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 7, dj: "americana", playlist: AMERICANA },
    { button: 3, lane: true, playlist: "SAMPLEPLAYLIST00000018" }] });
  // An older list still aliased to the number, as "was button 7" is here.
  e.PLAYLIST_ALIASES = JSON.stringify({ "was button 7": "SAMPLEPLAYLIST00000015" });
  return e;
}

test("a house DJ's preset is its endless playlist, before an old alias for the same number", () => {
  const on = presetOnFile(env(), 7);
  assert.equal(on.id, AMERICANA);
  assert.equal(on.endless, true);
});

test("the ledger's DJ references follow a rename: the old key is the new one, and its history joins", async () => {
  const e = env();
  e.STATION.endless.doc = JSON.stringify({ rev: 1, lane: { dj: "dj-stax", btn: 3, tenancy: 12 },
    assign: { "7": { dj: "dj-motown", at: 1 } }, jobs: { j: { dj: "dj-stax", btn: 3 } }, queued: {},
    history: { "dj-stax": [["spotify:track:a", 1]], stax: [["spotify:track:b", 2]], "not-a-dj": [["spotify:track:c", 3]] } });
  const st = await endlessLoad(e);
  // Stax and Soul Factory (Motown before it) are Soul since the merges, 2026-10-13.
  assert.equal(st.lane.dj, "soul");
  assert.equal(st.assign["7"].dj, "soul", "dj-motown, three renames ago");
  assert.equal(st.jobs.j.dj, "soul");
  assert.deepEqual(st.history.soul.map((h) => h[0]).sort(), ["spotify:track:a", "spotify:track:b"]);
  assert.equal(st.history["dj-stax"], undefined);
  assert.equal(st.history.stax, undefined);
  assert.ok(st.history["not-a-dj"], "a key no DJ answers to is left as it was, never guessed");
});

// THE MERGES (the owner, 2026-10-13): Sunny, Morning and Nightside are Vibe,
// Stax and Soul Factory are Soul, KRS-One was Hip Hop. Preset 9 was "sunny" in
// the live ledger; every reference follows, and two DJs' histories become one.
// Hip Hop was cut on 2026-10-15 (the owner), so "krs-one" finds nobody now:
// the guest DJ here is Soul under Stax's key, and KRS-One's songs stay where
// they were, read by nobody.
test("the merges: an assignment, a wait, a job and the guest DJ under an old key are the new DJ's, and histories join", async () => {
  const e = env();
  e.STATION.endless.doc = JSON.stringify({ rev: 1, lane: { dj: "stax", btn: 3, tenancy: 4, words: "the South (Stax)" },
    assign: { "9": { dj: "sunny", at: 1 } }, queued: { "7": { dj: "nightside", at: 2 } },
    jobs: { a: { id: "a", dj: "morning", btn: 9, kind: "topup" }, b: { id: "b", dj: "soul-factory", btn: 7, kind: "fresh" } },
    history: { sunny: [["spotify:track:s", 1]], nightside: [["spotify:track:n", 2]], morning: [["spotify:track:m", 3]],
      vibe: [["spotify:track:v", 4]], "krs-one": [["spotify:track:k", 5]], "soul-factory": [["spotify:track:f", 6]] } });
  const st = await endlessLoad(e);
  assert.equal(st.lane.dj, "soul");
  assert.equal(st.lane.words, "the South (Stax)", "the guest's words stay");
  assert.equal(st.assign["9"].dj, "vibe");
  assert.equal(st.queued["7"].dj, "vibe", "a wait under an old key is kept, not dropped as a cut DJ's");
  assert.deepEqual([st.jobs.a?.dj, st.jobs.b?.dj], ["vibe", "soul"], "and its jobs too");
  assert.deepEqual(st.history.vibe.map((h) => h[0]).sort(),
    ["spotify:track:m", "spotify:track:n", "spotify:track:s", "spotify:track:v"], "three DJs' songs, one no-repeat list");
  assert.deepEqual(st.history["krs-one"], [["spotify:track:k", 5]], "a cut DJ's history stays under the old key");
  assert.equal(st.history["hip-hop"], undefined);
  assert.deepEqual(st.history.soul.map((h) => h[0]), ["spotify:track:f"]);
  for (const old of ["sunny", "nightside", "morning", "soul-factory"]) assert.equal(st.history[old], undefined, old);
});

test("a DJ's shelf finds programmes filed under their old name", async () => {
  const e = env();
  const djs = Object.values(__test.house(e).djs);
  const of = (key) => djs.find((d) => d.key === key);
  const rows = [["a", "DJ Stax"], ["b", "Stax"], ["c", "Soul Factory"], ["d", "Motown"], ["e", "Sunny"], ["f", "Morning"],
    ["g", "Nightside"], ["h", "KRS-One"], ["i", "Hip Hop"], ["j", "Vibe"]]
    .map(([slug, dj]) => ({ slug, id: slug, dj, title: slug, created: "2026-10-01T00:00:00Z" }));
  // The merges, 2026-10-13: "Sunny", "Morning" and "KRS-One" are on real programs.
  // KRS-One's and Hip Hop's are nobody's shelf since Hip Hop was cut (2026-10-15).
  assert.deepEqual((await shelfFor(e, of("soul"), rows, null))?.rows.map((r) => r.id), ["a", "b", "c", "d"]);
  assert.deepEqual((await shelfFor(e, of("vibe"), rows, null))?.rows.map((r) => r.id), ["e", "f", "g", "j"]);
  assert.equal(of("hip-hop"), undefined);
});

test("the Shelf files a merged DJ's programs under the new name: one byline, one filter", async () => {
  const e = env();
  const f = installFetch();
  try {
    const put = (slug, dj) => e.PROGRAMS.put(`program:${slug}`, JSON.stringify({ slug, title: `T ${slug}`, dj, created: "2026-10-01T00:00:00Z",
      sections: [{ tracks: [{ uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa", title: "x", artist: "X" }] }] }),
      { metadata: { title: `T ${slug}`, dj, created: "2026-10-01T00:00:00Z", tracks: 1, runtime: "3:00", catalog: "spotify" } });
    await put("old-sunny", "Sunny");
    await put("old-morning", "Morning");
    await put("old-krs", "KRS-One");
    await put("gone", "Baddie");
    const html = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}?dj=vibe`), e)).text();
    assert.match(html, /aria-label="Filter the shelf — Vibe shown">Vibe<b class="n">2<\/b>/, "Sunny's and Morning's under Vibe");
    assert.ok(!/>(?:Sunny|Morning)<b class="n">/.test(html), "no old bylines");
    assert.match(html, />Baddie<b class="n">1<\/b>/, "a cut DJ's name stays as written");
    // KRS-One's was under Hip Hop until Hip Hop was cut (2026-10-15): as written now.
    assert.match(html, />KRS-One<b class="n">1<\/b>/);
  } finally { f.restore(); }
});

test("an endless Play is refused in words while Spotify is limiting the account, and nothing is sent", async () => {
  const e = env();
  const f = installFetch();
  try {
    await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 30 * 60_000 }));
    const before = f.calls.length;
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/americana/endless`, { method: "POST",
      body: new URLSearchParams({ do: "lane", device: "Pro Plus" }) }), e);
    assert.equal(r.status, 503);
    assert.match(await r.text(), /quota exceeded/);
    assert.equal(f.calls.length, before, "no Spotify call");
  } finally { f.restore(); }
});

test("an Undo offered for one load is refused once another set has gone on that preset", async () => {
  const e = env();
  const f = installFetch();
  try {
    const pid = "SAMPLEPLAYLIST00000024";
    const snap = `snap:${pid}:001790000000000-000000-abc123`;
    await e.PROGRAMS.put(snap, JSON.stringify({ playlistId: pid, playlistName: "Requests - Spotify", catalog: "spotify",
      savedAt: "2026-10-09T00:00:00Z", total: 1, tracks: [{ uri: "spotify:track:aaaa", name: "Old" }] }));
    await e.PROGRAMS.put(`current:${pid}`, "programme-b");
    const before = f.calls.length;
    const r = await worker.fetch(new Request(`https://x.test/notes/${KEY}/undo`, { method: "POST",
      body: new URLSearchParams({ snapshot: snap, loaded: "programme-a" }) }), e);
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), /put=undostale/);
    assert.equal(f.calls.length, before, "nothing written");
  } finally { f.restore(); }
});

test("a band's pause that Spotify refuses is said in words, not swallowed", async () => {
  const e = env();
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "SAMPLEPLAYLIST00000024", catalog: "spotify" }]);
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    const m = init.method ?? "GET";
    if (url.pathname === "/v1/me/player" && m === "GET") {
      return Response.json({ is_playing: true, device: { name: "Pro Plus", id: "d1" }, progress_ms: 1000,
        context: { uri: "spotify:playlist:SAMPLEPLAYLIST00000024" }, item: { name: "Song", uri: "spotify:track:s", artists: [{ name: "A" }] } });
    }
    if (url.pathname === "/v1/me/player/pause") return new Response(JSON.stringify({ error: { status: 403, message: "no" } }), { status: 403 });
    return inner(u, init);
  };
  try {
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/guest/play`, { method: "POST",
      body: new URLSearchParams({ btn: "1", device: "Pro Plus", pause: "1" }) }), e);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), `/buttons/${KEY}?paused=failed`);
    const html = await (await worker.fetch(new Request(`https://x.test${r.headers.get("location")}`), e)).text();
    assert.match(html, /Spotify refused the pause, so it plays on\./);
  } finally { globalThis.fetch = inner; f.restore(); }
});
