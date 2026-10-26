// LAST.FM FOR THE DJS (2026-10-18; lastfm.js; the trial,
// docs/research/lastfm-trial-2026-10-18.md). Similar artists to widen a
// DJ's choices and listening popularity per song, fetched by the house,
// kept with the day it was read, and never in the way when Last.fm is not.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv } from "./harness.js";
import { cleanLastfm } from "../lastfm.js";
import { keepResearch } from "../endless.js";
import { toolsWithMeta } from "../toollist.js";

const { callTool } = __test;
const KEY = "c0ffeec0ffeec0ffeec0ffeec0ffee00";
const TOP = { toptracks: { "@attr": { artist: "Isaac Hayes" }, track: [
  { name: "Theme from Shaft", listeners: "248000" }, { name: "Run Fay Run", listeners: "244000" },
  { name: "Walk on By", listeners: "242000" }, { name: "Theme From \"Shaft\"", listeners: "63000" },
  { name: "Theme From Shaft - Remastered 2009", listeners: "43000" }] } };
const SIMILAR = { similarartists: { "@attr": { artist: "Isaac Hayes" }, artist: [
  { name: "Curtis Mayfield", match: "1" }, { name: "Donny Hathaway", match: "0.6412" }] } };

function lastfmFetch(answer) {
  const inner = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, init) => {
    const url = new URL(String(u));
    if (url.hostname === "ws.audioscrobbler.com") {
      asked.push(url.searchParams.get("method"));
      assert.equal(url.searchParams.get("api_key"), KEY);
      return answer(url.searchParams.get("method"));
    }
    return inner(u, init);
  };
  return { asked, restore: () => { globalThis.fetch = inner; } };
}

test("Last.fm's answers held to a size: one entry a song, the versions merged", () => {
  const got = cleanLastfm(TOP, SIMILAR);
  assert.equal(got.artist, "Isaac Hayes");
  assert.deepEqual(got.listening, [{ title: "Theme from Shaft", listeners: 248000 }, { title: "Run Fay Run", listeners: 244000 },
    { title: "Walk on By", listeners: 242000 }], "three spellings of Shaft are one song");
  assert.deepEqual(got.similar, [{ name: "Curtis Mayfield", match: 1 }, { name: "Donny Hathaway", match: 0.64 }]);
});

test("look_up_artist: read once, kept with its day, beside the house's folder", async () => {
  const lf = lastfmFetch((m) => Response.json(m === "artist.gettoptracks" ? TOP : SIMILAR));
  try {
    const e = makeEnv();
    e.LASTFM_KEY = KEY;
    await keepResearch(e, "Isaac hayes", { artist: "Isaac Hayes", albums: [{ title: "Hot Buttered Soul", year: "1969" }], names: [], songs: [] });
    const budget = { remaining: 40 };
    const out = await callTool(e, "look_up_artist", { artist: "isaac hayes" }, budget);
    assert.deepEqual(lf.asked, ["artist.gettoptracks", "artist.getsimilar"]);
    assert.equal(budget.remaining, 38, "two calls, on the request's budget");
    assert.equal(out.artist, "Isaac Hayes");
    assert.equal(out.similar[0].name, "Curtis Mayfield");
    assert.equal(out.listening[1].title, "Run Fay Run");
    assert.match(out.retrieved, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(out.folder.albums[0].title, "Hot Buttered Soul");
    assert.match(out.note, /candidates, never approvals: ideas to choose from, not the set/);
    assert.match(out.note, /"piano" means piano music/, "Vibe's Okonski set, 2026-10-18");
    assert.match(out.note, /picks of your own/);
    assert.match(out.note, /not the charts of the day/);
    const kept = await e.PROGRAMS.get("lastfm:isaac-hayes", { type: "json" });
    assert.equal(kept.retrieved, out.retrieved);
    const again = await callTool(e, "look_up_artist", { artist: "Isaac Hayes" }, { remaining: 40 });
    assert.equal(lf.asked.length, 2, "the house's copy, no second read");
    assert.deepEqual(again.similar, out.similar);
  } finally { lf.restore(); }
});

test("when Last.fm does not answer, or does not know the name, the answer says so and nothing waits", async () => {
  const e = makeEnv();
  e.LASTFM_KEY = KEY;
  let lf = lastfmFetch(() => new Response("busy", { status: 503 }));
  try {
    const out = await callTool(e, "look_up_artist", { artist: "Kursaal Flyers" }, { remaining: 40 });
    assert.match(out.lastfm, /did not answer: curate from what you know/);
    assert.equal(out.similar, undefined);
    assert.match(out.note, /no folder on this artist's albums/);
  } finally { lf.restore(); }
  lf = lastfmFetch(() => Response.json({ error: 6, message: "The artist you supplied could not be found" }));
  try {
    assert.match((await callTool(e, "look_up_artist", { artist: "Nobody At All" }, { remaining: 40 })).lastfm, /does not know this name/);
  } finally { lf.restore(); }
  lf = lastfmFetch((m) => m === "artist.gettoptracks" ? Response.json(TOP) : new Response("busy", { status: 503 }));
  try {
    const half = await callTool(e, "look_up_artist", { artist: "Isaac Hayes" }, { remaining: 40 });
    assert.equal(half.listening.length, 3, "half an answer is used");
    assert.equal(await e.PROGRAMS.get("lastfm:isaac-hayes"), null, "and never kept");
  } finally { lf.restore(); }
});

test("a house with no key has no such tool, and its notes never name it", async () => {
  const e = makeEnv();
  assert.ok(!toolsWithMeta(e).some((t) => t.name === "look_up_artist"));
  await assert.rejects(callTool(e, "look_up_artist", { artist: "Isaac Hayes" }, { remaining: 40 }), /no LASTFM_KEY secret/);
  const P = "0000000000000000000003";
  const K = "abcdefabcdefabcdefabcdef";
  for (const key of [null, KEY]) {
    const h = makeEnv();
    h.PROGRAM_LIBRARY_KEY = K;
    h.REQUESTS_ENABLED = "true";
    h.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" },
      { button: 3, dj: "the-librarian", playlist: P }]);
    if (key) h.LASTFM_KEY = key;
    await worker.fetch(new Request(`https://x.test/buttons/${K}/vibe/request`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: "mood=piano%20like%20Okonski&length=60" }), h);
    const row = (await callTool(h, "list_requests", {}, { remaining: 40 })).requests[0];
    assert.equal(/look_up_artist/.test(row.research_if_artist), !!key, key ? "named with the key" : "never named without it");
    if (key) assert.match(row.research_if_artist, /ideas, not the set\. Every song must still fit the ask's other words/);
    assert.equal(toolsWithMeta(h).some((t) => t.name === "look_up_artist"), !!key);
  }
});

test("Last.fm's corrected name finds the folder and the copy, and a hung call is given up", async () => {
  let signal = null;
  const lf = lastfmFetch((m) => Response.json(m === "artist.gettoptracks" ? TOP : SIMILAR));
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => { if (String(u).includes("audioscrobbler")) signal = init?.signal ?? null; return inner(u, init); };
  try {
    const e = makeEnv();
    e.LASTFM_KEY = KEY;
    await keepResearch(e, null, { artist: "Isaac Hayes", albums: [{ title: "Hot Buttered Soul", year: "1969" }], names: [], songs: [] });
    const out = await callTool(e, "look_up_artist", { artist: "Issac Hayes" }, { remaining: 40 });
    assert.equal(out.artist, "Isaac Hayes");
    assert.equal(out.folder?.albums[0].title, "Hot Buttered Soul", "the folder under the right name");
    assert.ok(signal instanceof AbortSignal, "every call carries a time limit");
    assert.ok(await e.PROGRAMS.get("lastfm:issac-hayes"), "kept under the name asked");
    assert.ok(await e.PROGRAMS.get("lastfm:isaac-hayes"), "and the right one");
  } finally { globalThis.fetch = inner; lf.restore(); }
});
