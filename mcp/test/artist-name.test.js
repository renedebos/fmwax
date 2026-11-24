// THE ARTIST BY NAME, EXACTLY (2026-11-23, the owner: Ace's "Time Ain't
// Long" showed Ace of Base in About this song). MusicBrainz scored Ace of
// Base 100 and Ace, the 1970s band, 88 for the name "Ace".
import { test } from "node:test";
import assert from "node:assert/strict";

import { artistArticle, sameNamed } from "../musicbrainz.js";
import { makeEnv } from "./harness.js";

const ACES = [
  { id: "aob", score: 100, name: "Ace of Base", aliases: [{ name: "Ace of Bass" }] },
  { id: "ace-jp", score: 96, name: "ACE" },
  { id: "frehley", score: 94, name: "Ace Frehley" },
  { id: "ace-uk", score: 88, name: "Ace", "sort-name": "Ace" },
];

test("only an artist whose name, or one of its names, is the asked one", () => {
  assert.deepEqual(sameNamed(ACES, "Ace").map((a) => a.id), ["ace-jp", "ace-uk"]);
  assert.deepEqual(sameNamed([{ id: "k", score: 100, name: "Kilburn and the High Roads" }], "Kilburn & The High Roads").map((a) => a.id), ["k"]);
  assert.deepEqual(sameNamed([{ id: "b", score: 100, name: "The Budos Band" }], "Budos Band").map((a) => a.id), ["b"]);
  assert.deepEqual(sameNamed(ACES, "Ace of Bass").map((a) => a.id), ["aob"], "an alias counts");
  assert.deepEqual(sameNamed(ACES, ""), []);
});

function mb(recordingsBy) {
  const real = globalThis.fetch, asked = [];
  globalThis.fetch = async (u) => {
    const url = decodeURIComponent(String(u)); asked.push(url);
    if (url.includes("/ws/2/artist?")) return Response.json({ artists: ACES });
    const arid = url.match(/arid:([\w-]+)/)?.[1];
    if (url.includes("/ws/2/recording?")) return Response.json({ count: recordingsBy[arid] ?? 0, recordings: [] });
    if (url.includes("/ws/2/artist/ace-uk")) return Response.json({ relations: [{ url: { resource: "https://www.wikidata.org/wiki/Q339889" } }] });
    if (url.includes("wikidata.org") && url.includes("Q339889")) return Response.json({ entities: { Q339889: { sitelinks: { enwiki: { title: "Ace (band)" } } } } });
    if (url.includes("page/summary/Ace_(band)")) return Response.json({ type: "standard", title: "Ace (band)",
      extract: "Ace were an English rock band active from 1972 to 1977.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Ace_(band)" } } });
    return new Response("{}", { status: 404 });
  };
  return { asked, done: () => { globalThis.fetch = real; } };
}
const env = () => ({ ...makeEnv(), ARTIST_LOOKUP: "on", __mbSleep: async () => {} });

test("several of one name: the one with a recording of the song playing; never the act whose name only contains it", async () => {
  const f = mb({ "ace-uk": 1 });
  try {
    const got = await artistArticle(env(), "Ace", { title: "Time Ain't Long - 2005 Remaster" });
    assert.equal(got.title, "Ace (band)"); assert.equal(got.artist, "Ace");
    assert.ok(f.asked.some((u) => u.includes('recording:"Time Ain\'t Long" AND arid:ace-jp')), "the title without the remaster");
    assert.ok(!f.asked.some((u) => u.includes("arid:aob") || u.includes("/artist/aob")), "Ace of Base is never asked");
  } finally { f.done(); }
});

test("several of one name and none recorded the song, or no song to tell them by: no article at all", async () => {
  const f = mb({});
  try {
    assert.equal(await artistArticle(env(), "Ace", { title: "Unknown Song" }), null);
    assert.equal(await artistArticle(env(), "Ace"), null);
  } finally { f.done(); }
});
