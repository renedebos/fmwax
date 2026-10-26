// EVERY DJ LOOKS THE ARTIST UP (2026-10-18; the owner: "yes", after 29 of the
// 87 asks kept since 2026-09-01 named an artist, nine of them the
// Librarian's). One folder per artist, kept under the artist's own name,
// found by any name it answers to, and read by whichever DJ is asked next.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";
import { cleanResearch, folderSlugs, keepResearch, matchFolders, researchFolders, FOLDER_READS_MAX } from "../endless.js";

const { callTool } = __test;
const b = () => ({ remaining: 40 });
const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const T = (n) => `spotify:track:${String(n).padStart(22, "0")}`;

function house() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.REQUESTS_ENABLED = "true";
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" },
    { button: 3, dj: "the-librarian", playlist: P(3) }]);
  return e;
}
const ask = (e, dj, mood) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/${dj}/request`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `mood=${encodeURIComponent(mood)}&length=60` }), e);
const RAY = { artist: "Ray Charles", names: ["Ray Charles Robinson"], albums: [
  { title: "Modern Sounds in Country and Western Music", year: "1962" },
  { title: "Ray Charles at Newport", year: "1958", live: true }] };

test("a folder is found by a name standing whole in the words, the longest first", () => {
  const index = [
    { key: "research:prince", slugs: ["prince"] },
    { key: "research:prince-buster", slugs: ["prince-buster"] },
    { key: "research:sir-mack-rice", slugs: ["sir-mack-rice", "mack-rice"] },
    { key: "research:low", slugs: ["low"] },
  ];
  assert.deepEqual(matchFolders(index, "All the B-sides of Prince's that never made an album"), ["research:prince"]);
  assert.deepEqual(matchFolders(index, "Prince Buster and the ska that came before"), ["research:prince-buster"],
    "Prince inside Prince Buster is dropped");
  assert.deepEqual(matchFolders(index, "Deep dive into Mack Rice during his time with Stax"), ["research:sir-mack-rice"],
    "by a name the folder answers to");
  assert.deepEqual(matchFolders(index, "low and slow, for a Sunday"), [], "a name under four letters is never matched");
  assert.deepEqual(matchFolders(index, "princely sums"), [], "a whole name, never part of a word");
  assert.deepEqual(matchFolders(index, ""), []);
});

test("a folder's names fit its metadata, and a live album stays marked", () => {
  const s = folderSlugs({ artist: "Charlie Hunter", names: ["Charlie Hunter Trio", "Charlie Hunter Trio", "T.J. Kirk", "X",
    ...Array.from({ length: 60 }, (_, i) => `A band with a very long name, number ${i}`)] });
  assert.deepEqual(s.slice(0, 3), ["charlie-hunter", "charlie-hunter-trio", "t-j-kirk"]);
  assert.ok(!s.includes("x"), "too short to find anything by");
  assert.ok(JSON.stringify({ s }).length <= 1000, "inside KV's 1 KB of metadata");
  assert.deepEqual(cleanResearch(RAY).albums, RAY.albums);
  assert.equal(cleanResearch({ albums: [{ title: "A", live: "yes" }] }).albums[0].live, undefined, "true or nothing");
});

test("an ask about an artist: the folder if the house has one, else the steps, and what is found is kept for every DJ", async () => {
  const sp = installFetch({});
  try {
    const e = house();
    assert.match((await ask(e, "the-librarian", "Set about Ray Charles before 1980")).headers.get("location"), /ask=sent$/);
    let out = await callTool(e, "list_requests", {}, b());
    const lib = out.requests.find((r) => r.dj === "the-librarian");
    assert.match(lib.research_if_artist, /IF "Set about Ray Charles before 1980" is about one artist/);
    assert.match(lib.research_if_artist, /"like Okonski"\) needs no looking up/);
    assert.equal(lib.artist_folders, undefined);
    assert.match(out.research_steps, /release-group\?query=%28arid:<id>%20OR%20arid:<group id>%29/, "the steps, said once");
    assert.match(out.research_steps, /%20AND%20secondarytype:live in place of/, "the live albums where they matter");
    assert.match(out.research_steps, /fulfill_request or extend_endless/);
    assert.equal(out.artist_folders_note, undefined);

    // The curator looks him up and sends it with the set; whatever becomes of the write, it is kept.
    await callTool(e, "fulfill_request", { request_id: lib.request_id, uris: [T(1), T(2), T(3)], discography: RAY }, b()).catch(() => null);
    const kept = await e.PROGRAMS.getWithMetadata("research:ray-charles", { type: "json" });
    assert.deepEqual(kept.value.albums, RAY.albums);
    assert.deepEqual(kept.metadata.s, ["ray-charles", "ray-charles-robinson"]);
    // A discography with no artist has no name to keep it under.
    await callTool(e, "fulfill_request", { request_id: lib.request_id, uris: [T(1)], discography: { albums: RAY.albums } }, b()).catch(() => null);
    assert.deepEqual((await e.PROGRAMS.list({ prefix: "research:" })).keys.map((k) => k.name), ["research:ray-charles"]);

    // The next DJ asked about him reads the folder; an ask about nobody in it still may need looking up.
    assert.match((await ask(e, "soul", "an hour of Ray Charles, the Atlantic years")).headers.get("location"), /ask=sent$/);
    assert.match((await ask(e, "hank", "Instrumentals for cruising")).headers.get("location"), /ask=sent$/);
    out = await callTool(e, "list_requests", {}, b());
    const soul = out.requests.find((r) => r.dj === "soul");
    assert.equal(soul.artist_folders.length, 1);
    assert.equal(soul.artist_folders[0].artist, "Ray Charles");
    assert.equal(soul.artist_folders[0].albums[1].live, true);
    assert.equal(soul.research_if_artist, undefined, "looked up once");
    assert.match(out.artist_folders_note, /not a playlist/);
    assert.match(out.artist_folders_note, /namesake/);
    assert.match(out.artist_folders_note, /A folder with no `songs` has not looked up what the artist WROTE/);
    assert.match(out.research_steps, /\(5\) For a songwriter/, "the steps come along for a folder with no songs");
    assert.match(out.requests.find((r) => r.dj === "hank").research_if_artist, /Instrumentals for cruising/,
      "the house cannot tell a mood from a name: the curator judges");
  } finally { sp.restore(); }
});

test("one list and a few reads for a whole listing, however many ask", async () => {
  const e = house();
  for (const a of ["Ray Charles", "Otis Redding", "Sam Cooke", "Aretha Franklin", "Al Green", "Etta James"]) {
    await keepResearch(e, null, { artist: a, albums: [{ title: "X", year: "1960" }], names: [] });
  }
  let lists = 0, gets = 0;
  const real = e.PROGRAMS;
  e.PROGRAMS = { ...real, list: (o) => { lists++; return real.list(o); }, get: (k, o) => { gets++; return real.get(k, o); } };
  const folders = researchFolders(e);
  const a = await folders.find("Ray Charles and Otis Redding, then Sam Cooke");
  const c = await folders.find("Aretha Franklin, Al Green and Etta James");
  assert.equal(lists, 1);
  assert.equal(a.length, 2, "two folders a request at most");
  assert.equal(a.length + c.length, FOLDER_READS_MAX);
  assert.deepEqual(await folders.find("Sam Cooke, live at the Harlem Square"), [], "the reads are capped for the whole call");
  assert.equal(gets, FOLDER_READS_MAX);
  assert.equal(lists, 1);
});

// ISAAC HAYES'S FOLDER (2026-10-18): Deep Dive kept his albums and none of
// the songs he wrote; a writer's ask sends only the songs, which are added.
test("a part sent empty keeps the folder's own, and the names add up", async () => {
  const e = house();
  await keepResearch(e, "Isaac hayes", { artist: "Isaac Hayes", albums: [{ title: "Hot Buttered Soul", year: "1969" }],
    names: ["Isaac Hayes Movement"], songs: [] });
  await keepResearch(e, null, cleanResearch({ artist: "Isaac Hayes", names: ["Hayes & Porter"],
    songs: [{ title: "Soul Man", year: "1967", by: ["Sam & Dave"] }] }));
  const got = await e.PROGRAMS.getWithMetadata("research:isaac-hayes", { type: "json" });
  assert.deepEqual(got.value.albums, [{ title: "Hot Buttered Soul", year: "1969" }], "the albums stay");
  assert.deepEqual(got.value.songs, [{ title: "Soul Man", year: "1967", by: ["Sam & Dave"] }], "the songs are added");
  assert.deepEqual(got.value.names, ["Isaac Hayes Movement", "Hayes & Porter"]);
  assert.ok(got.metadata.s.includes("hayes-porter"), "found by the new name too");
  // A fresh look replaces what it sends.
  await keepResearch(e, null, cleanResearch({ artist: "Isaac Hayes", albums: [{ title: "Shaft", year: "1971" }] }));
  const again = await e.PROGRAMS.get("research:isaac-hayes", { type: "json" });
  assert.deepEqual(again.albums.map((a) => a.title), ["Shaft"]);
  assert.equal(again.songs.length, 1);
});

// CODEX'S REVIEW (2026-10-18): namesakes, a bogus request, a writer's pages.
test("a namesake gets a folder of its own, and both answer to the name", async () => {
  const e = house();
  const A = "11111111-2222-3333-4444-555555555555", B = "99999999-8888-7777-6666-555555555555";
  await keepResearch(e, null, cleanResearch({ artist: "John Williams", mbid: A, disambiguation: "film composer",
    albums: [{ title: "Star Wars", year: "1977" }] }));
  await keepResearch(e, null, cleanResearch({ artist: "John Williams", mbid: B, disambiguation: "classical guitarist",
    albums: [{ title: "Cavatina", year: "1979" }] }));
  const keys = (await e.PROGRAMS.list({ prefix: "research:" })).keys.map((k) => k.name).sort();
  assert.deepEqual(keys, ["research:john-williams", "research:john-williams-99999999"]);
  const found = await researchFolders(e).find("an hour of John Williams");
  assert.deepEqual(found.map((f) => f.disambiguation).sort(), ["classical guitarist", "film composer"]);
  // The same artist again is one folder, merged.
  await keepResearch(e, null, cleanResearch({ artist: "John Williams", mbid: A, songs: [{ title: "Theme from Jaws", year: "1975" }] }));
  const composer = await e.PROGRAMS.get("research:john-williams", { type: "json" });
  assert.equal(composer.albums[0].title, "Star Wars");
  assert.equal(composer.songs[0].title, "Theme from Jaws");
  assert.equal(cleanResearch({ artist: "X", mbid: "not-an-id", albums: [{ title: "Y" }] }).mbid, undefined);
  assert.equal(cleanResearch({ artist: "Dan Penn", songs: Array.from({ length: 300 }, (_, i) => ({ title: `S${i}` })) }).songs.length, 250,
    "room for a writer's 171 songs");
});

test("fulfill_request keeps nothing for a request the ledger does not have", async () => {
  const sp = installFetch({});
  try {
    const e = house();
    await callTool(e, "fulfill_request", { request_id: "no-such-request", uris: [T(1), T(2), T(3)], discography: RAY }, b()).catch(() => null);
    assert.deepEqual((await e.PROGRAMS.list({ prefix: "research:" })).keys, []);
  } finally { sp.restore(); }
});

// THE CLAUDE APP AND TALK READ THE FOLDERS TOO (2026-10-24, the owner: "do
// both"): get_dj hands over the house's folder on an artist the ask names,
// as a request carries it; and the steps say how without a shell, since a
// ChatGPT curator given only "curl" made no folder (Elliott Smith).
test("get_dj with an ask about an artist the house has looked up carries the folder; the steps work without a shell", async () => {
  const sp = installFetch({});
  try {
    const e = house();
    await keepResearch(e, null, RAY);
    const soul = await callTool(e, "get_dj", { name: "Soul", ask: "an hour of Ray Charles, the Atlantic years" }, b());
    assert.equal(soul.artist_folders.length, 1);
    assert.equal(soul.artist_folders[0].artist, "Ray Charles");
    assert.deepEqual(soul.artist_folders[0].albums, RAY.albums);
    assert.match(soul.artist_folders_note, /never from search_tracks' `released`/);
    assert.equal((await callTool(e, "get_dj", { name: "Soul" }, b())).artist_folders, undefined, "no ask, no folder");
    assert.equal((await callTool(e, "get_dj", { name: "Hank", ask: "Instrumentals for cruising" }, b())).artist_folders, undefined);

    assert.match((await ask(e, "the-librarian", "Set about Elliott Smith")).headers.get("location"), /ask=sent$/);
    const steps = (await callTool(e, "list_requests", {}, b())).research_steps;
    assert.match(steps, /FIRST call look_up_artist with the name/);
    assert.match(steps, /ONLY IF YOU HAVE A SHELL \(a web tool is turned away/);
  } finally { sp.restore(); }
});
