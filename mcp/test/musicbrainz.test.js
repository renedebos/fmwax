// THE HOUSE LOOKS AN ARTIST UP ITSELF (2026-10-24; musicbrainz.js): a ChatGPT
// curator cannot reach MusicBrainz (its robots rule bars /ws to crawlers), so
// the house makes a folder's base by rule, keeps it for every DJ, and the
// curator adds what needs judgment on top when it can.
import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";
import { houseLookUp, lookUpAndKeep, MB_UA } from "../musicbrainz.js";
import { keepResearch } from "../endless.js";

const { callTool, toolsWithMeta } = __test;
const ID = "a89487ab-0000-4000-8000-000000000001", TRIO = "c0000000-0000-4000-8000-000000000002",
  GARAJ = "d0000000-0000-4000-8000-000000000003";
const SEARCH = { artists: [{ id: ID, name: "Charlie Hunter", score: 100, disambiguation: "jazz guitarist" },
  { id: "b0000000-0000-4000-8000-000000000004", name: "Charlie Hunter", score: 55 }] };
const ARTIST = { id: ID, name: "Charlie Hunter", aliases: [{ name: "C. Hunter" }, { name: "Charlie Hunter" }], relations: [
  { type: "member of band", direction: "forward", artist: { id: TRIO, name: "Charlie Hunter Trio" } },
  { type: "member of band", direction: "forward", artist: { id: GARAJ, name: "Garaj Mahal" } },
  { type: "member of band", direction: "backward", artist: { id: "e0000000-0000-4000-8000-000000000005", name: "Charlie Hunter Fan Club" } }] };
const GROUPS = { "release-groups": [
  { title: "Baboon Strength", "first-release-date": "2008-06-15", "artist-credit": [{ name: "Charlie Hunter", artist: { name: "Charlie Hunter" } }] },
  { title: "Bing, Bing, Bing!", "first-release-date": "1995", "artist-credit": [{ name: "Charlie Hunter Trio", artist: { name: "Charlie Hunter Trio" } }] },
  { title: "Baboon Strength", "first-release-date": "2008-06-15", "artist-credit": [{ artist: { name: "Charlie Hunter" } }] }] };

// MusicBrainz, faked: what each address answers, and every call it heard.
function musicbrainz({ search = SEARCH, busy = 0 } = {}) {
  const heard = [];
  const inner = globalThis.fetch;
  let busyLeft = busy;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname !== "musicbrainz.org") return inner(u, init);
    heard.push({ path: url.pathname, query: url.searchParams.get("query"), ua: new Headers(init.headers).get("user-agent") });
    if (busyLeft > 0) { busyLeft--; return Response.json({ error: "busy" }, { status: 503 }); }
    if (url.pathname === "/ws/2/artist") return Response.json(search);
    if (url.pathname === `/ws/2/artist/${ID}`) return Response.json(ARTIST);
    if (url.pathname === "/ws/2/release-group") return Response.json(GROUPS);
    return new Response("not found", { status: 404 });
  };
  return { heard, restore: () => { globalThis.fetch = inner; } };
}
const house = () => {
  const e = makeEnv();
  e.ARTIST_LOOKUP = "on";
  e.__mbSleep = async (ms) => { (e.__naps ??= []).push(ms); };
  return e;
};

test("the base of a folder, by rule: the best match, the names they recorded under, studio albums by year", async () => {
  const mb = musicbrainz();
  try {
    const e = house();
    const f = await houseLookUp(e, "Charlie Hunter");
    assert.equal(f.artist, "Charlie Hunter");
    assert.equal(f.mbid, ID);
    assert.equal(f.disambiguation, "jazz guitarist");
    assert.deepEqual(f.names, ["Charlie Hunter", "C. Hunter", "Charlie Hunter Trio"], "his own groups, never a band he was merely in");
    assert.deepEqual(f.albums, [{ title: "Bing, Bing, Bing!", year: "1995", as: "Charlie Hunter Trio" }, { title: "Baboon Strength", year: "2008" }]);
    assert.equal(f.by, "house");
    assert.equal(mb.heard.length, 3);
    assert.ok(mb.heard.every((h) => h.ua === MB_UA), "the house names itself, as MusicBrainz asks");
    assert.match(mb.heard[2].query, new RegExp(`arid:${ID} OR arid:${TRIO}\\)`));
    assert.ok(!mb.heard[2].query.includes(GARAJ));
    assert.deepEqual(e.__naps, [0, 1100, 1100], "a second apart");
  } finally { mb.restore(); }
});

test("a busy answer is tried again; a weak match or no answer is nothing, remembered for an hour; off is off", async () => {
  let mb = musicbrainz({ busy: 2 });
  try {
    const e = house();
    assert.equal((await houseLookUp(e, "Charlie Hunter")).albums.length, 2);
    assert.deepEqual(e.__naps.slice(0, 3), [0, 1500, 3000], "busy twice, then answered");
  } finally { mb.restore(); }
  mb = musicbrainz({ search: { artists: [{ id: ID, name: "Charlie Hunt", score: 70 }] } });
  try {
    const e = house();
    assert.equal(await lookUpAndKeep(e, "Charlie Hunter"), null);
    assert.equal(await lookUpAndKeep(e, "Charlie Hunter"), null);
    assert.equal(mb.heard.length, 1, "the miss is remembered: asked once");
    assert.deepEqual((await e.PROGRAMS.list({ prefix: "research:" })).keys, []);
  } finally { mb.restore(); }
  mb = musicbrainz({ busy: 9 });
  try {
    assert.equal(await houseLookUp(house(), "Charlie Hunter"), null, "busy every time: nothing, and the set is made from memory");
  } finally { mb.restore(); }
  mb = musicbrainz();
  try {
    const e = house();
    e.ARTIST_LOOKUP = "off";
    assert.equal(await lookUpAndKeep(e, "Charlie Hunter"), null);
    assert.equal(mb.heard.length, 0);
  } finally { mb.restore(); }
});

test("look_up_artist makes the folder when the house has none, keeps it for every DJ, and reads it back next time", async () => {
  const sp = installFetch({});
  const mb = musicbrainz();
  try {
    const e = house();
    assert.ok(toolsWithMeta(e).some((t) => t.name === "look_up_artist"), "listed with no Last.fm key: the house's own lookup");
    const first = await callTool(e, "look_up_artist", { artist: "Charlie Hunter" }, { remaining: 40 });
    assert.equal(first.folder.artist, "Charlie Hunter");
    assert.equal(first.folder.albums.length, 2);
    assert.match(first.folder_made, /Just now, by the house, from MusicBrainz/);
    assert.equal(first.lastfm, undefined, "no Last.fm key, nothing said of it");
    const kept = await e.PROGRAMS.getWithMetadata("research:charlie-hunter", { type: "json" });
    assert.ok(kept.metadata.s.includes("charlie-hunter-trio"), "found by the Trio's name too");
    const again = await callTool(e, "look_up_artist", { artist: "Charlie Hunter" }, { remaining: 40 });
    assert.equal(again.folder_made, undefined);
    assert.equal(again.folder.albums.length, 2);
    assert.equal(mb.heard.length, 3, "looked up once");
    const soul = await callTool(e, "get_dj", { name: "Soul", ask: "an hour of Charlie Hunter" }, { remaining: 40 });
    assert.equal(soul.artist_folders[0].artist, "Charlie Hunter", "and the chat's DJs read it");
    assert.match(first.folder.scope, /Studio albums only[\s\S]*use them as well/, "a short list says it is short");
    assert.match(soul.artist_folders[0].scope, /Studio albums only/);
  } finally { mb.restore(); sp.restore(); }
});

// The curator's own albums replace the house's list, and its scope note with
// it; songs added alone keep both.
test("a house folder's scope note stays while only songs are added, and goes when the curator sends albums", async () => {
  const sp = installFetch({});
  const mb = musicbrainz();
  try {
    const e = house();
    await lookUpAndKeep(e, "Charlie Hunter");
    await keepResearch(e, null, { artist: "Charlie Hunter", albums: [], names: [], songs: [{ title: "Ashby Man", year: "1997", by: [] }] });
    let out = await callTool(e, "look_up_artist", { artist: "Charlie Hunter" }, { remaining: 40 });
    assert.match(out.folder.scope, /Studio albums only/);
    assert.equal(out.folder.songs[0].title, "Ashby Man");
    await keepResearch(e, null, { artist: "Charlie Hunter", albums: [{ title: "Bing, Bing, Bing!", year: "1995" },
      { title: "Charlie Hunter Live", year: "2001", live: true }], names: [], songs: [] });
    out = await callTool(e, "look_up_artist", { artist: "Charlie Hunter" }, { remaining: 40 });
    assert.equal(out.folder.scope, undefined, "the curator's list, live album and all");
  } finally { mb.restore(); sp.restore(); }
});

// CODEX'S REVIEW (2026-10-24): a lookup waited on by list_requests must stay
// short and must never fail the listing.
test("the lookup stops at its deadline, leaves the budget room, and skips while one is already running", async () => {
  const mb = musicbrainz();
  try {
    let e = house();
    e.__mbDeadlineMs = 100;
    assert.equal(await houseLookUp(e, "Charlie Hunter"), null, "no time left for a call: nothing asked");
    e = house();
    e.__budget = { remaining: 5 };
    assert.equal(await lookUpAndKeep(e, "Charlie Hunter"), null, "under ten subrequests left: not started");
    e = house();
    await e.PROGRAMS.put("mbbusy:charlie-hunter", "1");
    assert.equal(await lookUpAndKeep(e, "Charlie Hunter"), null, "another run is looking them up");
    assert.equal(mb.heard.length, 0);
    e = house();
    assert.equal((await lookUpAndKeep(e, "Charlie Hunter")).artist, "Charlie Hunter");
    assert.equal(await e.PROGRAMS.get("mbbusy:charlie-hunter"), null, "the mark is lifted when it is done");
  } finally { mb.restore(); }
});
