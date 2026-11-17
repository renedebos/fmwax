// GENIUS FOR THE SONGS (genius.js, 2026-11-16): found by title and artist,
// the open lists ranked by readers, kept, and nothing without a token.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { geniusSong, geniusForTv, geniusOn } from "../genius.js";
import { makeEnv } from "./harness.js";

const TOKEN = "t".repeat(40);
const song = (over = {}) => ({
  id: 99, title: "Teardrop", url: "https://genius.com/Massive-attack-teardrop-lyrics", release_date_for_display: "April 20, 1998",
  primary_artist: { name: "Massive Attack" }, description: { plain: "Teardrop was the lead single from Mezzanine." },
  producer_artists: [{ name: "Neil Davidge" }, { name: "Massive Attack" }], writer_artists: [{ name: "Elizabeth Fraser" }],
  song_relationships: [
    { relationship_type: "samples", songs: [{ title: "Sometimes I Cry", primary_artist: { name: "Les McCann" }, stats: {} }] },
    { relationship_type: "sampled_in", songs: [
      { title: "reliving hell", primary_artist: { name: "christtt" }, stats: {} },
      { title: "Her Revolution", primary_artist: { name: "Burial" }, stats: { pageviews: 16777 }, release_date_components: { year: 2020 } },
      { title: "Something", primary_artist: { name: "Someone" }, stats: { pageviews: 200 } }] },
    { relationship_type: "translations", songs: [{ title: "x", primary_artist: { name: "y" }, stats: { pageviews: 9 } }] },
  ],
  ...over,
});

function stub(answer) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.genius.com/")) {
      calls.push(u.replace("https://api.genius.com", ""));
      assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
      return Response.json({ response: answer(u) });
    }
    return original(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Genius: the song found by title and artist; its open lists ranked by readers; kept, and nothing without a token", async () => {
  const e = { ...makeEnv(), GENIUS_TOKEN: TOKEN };
  assert.equal(geniusOn({}), false);
  assert.equal(await geniusSong({ ...e, GENIUS_TOKEN: "" }, { title: "Teardrop", artist: "Massive Attack" }), null);
  const s = stub((u) => (u.includes("/search") ? { hits: [
    { result: { id: 1, title: "Teardrop (Cover)", primary_artist: { name: "Some Choir" } } },
    { result: { id: 99, title: "Teardrop", primary_artist: { name: "Massive Attack" } } }] } : { song: song() }));
  try {
    const g = await geniusSong(e, { title: "Teardrop - Remastered 2019", artist: "Massive Attack" });
    assert.equal(g.title, "Teardrop"); assert.deepEqual(g.producers, ["Neil Davidge", "Massive Attack"]);
    assert.deepEqual(g.samples.top.map((x) => x.t), ["Sometimes I Cry"], "what it samples, whole");
    assert.deepEqual(g.sampledIn.top.map((x) => x.a), ["Burial", "Someone"], "who sampled it: the read ones, most read first");
    assert.equal(g.sampledIn.n, 3);
    assert.equal(g.translations, undefined);
    assert.equal(g.about, "Teardrop was the lead single from Mezzanine.");
    assert.deepEqual(s.calls.map((c) => c.split("?")[0]), ["/search", "/songs/99"]);
    await geniusSong(e, { title: "Teardrop", artist: "Massive Attack" });
    assert.equal(s.calls.length, 2, "kept, not asked again");
    const tv = geniusForTv(g);
    assert.deepEqual(tv.sampledIn, { n: 3, top: [{ t: "Her Revolution", a: "Burial", y: 2020 }, { t: "Something", a: "Someone", y: null }] });
  } finally { s.restore(); }
  // Filed under the first of two names; a song nobody filed is a miss, kept a while.
  const m = stub((u) => (u.includes("/search") ? { hits: [{ result: { id: 5, title: "Ain't Nobody", primary_artist: { name: "Rufus" } } }] }
    : { song: song({ id: 5, title: "Ain't Nobody", primary_artist: { name: "Rufus" }, song_relationships: [] }) }));
  try {
    assert.equal((await geniusSong(e, { title: "Ain't Nobody", artist: "Rufus & Chaka Khan" })).artist, "Rufus");
    assert.equal(await geniusSong(e, { title: "So Glad To Have You", artist: "Bettye Crutcher" }), null);
    const n = m.calls.length;
    assert.equal(await geniusSong(e, { title: "So Glad To Have You", artist: "Bettye Crutcher" }), null);
    assert.equal(m.calls.length, n, "a miss is kept too");
  } finally { m.restore(); }
});

test("the TV's /tv/song carries Genius beside the song facts", async () => {
  const KEY = "abcdefabcdefabcdefabcdef";
  const e = { ...makeEnv(), GENIUS_TOKEN: TOKEN, PROGRAM_LIBRARY_KEY: KEY };
  const s = stub((u) => (u.includes("/search") ? { hits: [{ result: { id: 99, title: "Teardrop", primary_artist: { name: "Massive Attack" } } }] } : { song: song() }));
  try {
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/tv/song?uri=x&t=Teardrop&a=${encodeURIComponent("Massive Attack")}`), e, { waitUntil() {} });
    const a = await r.json();
    assert.deepEqual(a.genius.producers, ["Neil Davidge", "Massive Attack"]);
    assert.equal(a.genius.sampledIn.top[0].a, "Burial");
  } finally { s.restore(); }
});

test("the DJs' look_up_song: the lists, for sets built on samples and covers; no token, a plain refusal", async () => {
  const { callTool } = await import("../tools.js");
  const e = { ...makeEnv(), GENIUS_TOKEN: TOKEN };
  await assert.rejects(callTool({ ...e, GENIUS_TOKEN: "" }, "look_up_song", { title: "Teardrop", artist: "Massive Attack" }, { remaining: 5 }), /no GENIUS_TOKEN/);
  const s = stub((u) => (u.includes("/search") ? { hits: [{ result: { id: 99, title: "Teardrop", primary_artist: { name: "Massive Attack" } } }] } : { song: song() }));
  try {
    const r = await callTool(e, "look_up_song", { title: "Teardrop", artist: "Massive Attack" }, { remaining: 5 });
    assert.equal(r.found, true);
    assert.deepEqual(r.samples, { count: 1, most_read: [{ title: "Sometimes I Cry", artist: "Les McCann" }] });
    assert.deepEqual(r.sampled_in.most_read[0], { title: "Her Revolution", artist: "Burial", year: 2020 });
    assert.equal(r.sampled_in.count, 3);
    assert.equal(r.cover_of.count, 0);
    assert.ok(!("lyrics" in r));
  } finally { s.restore(); }
});
