// MC-47 STAGE 1, PLAY NOW READS AN ASK (playnow.js; tasks/mc47-build.md).
// The answers are stage 0's own, kept from the 51 searches of 2026-11-18
// (tasks/mc47-stage0/) and cut down to the fields the reader reads
// (fixtures/playnow/stage0-answers.json). The rule was shaped on these, so
// their score says only that the code is the rule; the honest number is the
// gate's fresh list (tasks/mc47-build.md, stage 1).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { beforeSearch, playNow, playNowPlaces, readPlayNow, spreadSongs, wordTable } from "../playnow.js";
import { spotifyCatalog } from "../spotify.js";

const kept = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/playnow/${name}`, import.meta.url)));
// Stage 0's 51 searches, and the gate's 31 (2026-11-18, tasks/mc47-gate/).
const ANSWERS = { ...kept("stage0-answers.json"), ...kept("gate-answers.json") };
const EMPTY = { artists: [], albums: [], tracks: [] };
// A catalog that answers from the kept searches, and counts what was asked.
function keptCatalog(extra = {}) {
  const asked = [];
  return {
    asked,
    async searchAll(q) { asked.push(`all ${q}`); return ANSWERS[`artist,album,track|${q}`] ?? EMPTY; },
    async search(q) {
      asked.push(`track ${q}`);
      return extra[q] ?? (ANSWERS[`track|${q}`] ?? ANSWERS[`artist,album,track|${q}`])?.tracks ?? [];
    },
  };
}
const ROOMS = ["Pro Plus", "Ultra", "Everywhere", "Master Bedroom", "Dining Room", "Living Room", "Office", "Den", "iPhone"];
// This house's endless presets (mcp/house.json, 2026-11-18).
const PLACES = { lane: 3, own: { "dr-funkenstein": 4, "hank": 5, "sessions": 6, "americana": 7, "soul": 8, "vibe": 9 } };
const play = (words, opts = {}) => playNow(words, { catalog: opts.catalog ?? keptCatalog(), rooms: ROOMS, fallback: "Pro Plus", places: PLACES, ...opts });

// [the ask as stage 0 searched it, stage 0's "want", what the reader says]
const STAGE0 = [
  // The first set (the rule was shaped on these).
  ["the beatles", "artist", "artist The Beatles"],
  ["coltrane", "artist", "artist John Coltrane"],
  ["prince", "artist", "artist Prince"],
  ["uncle tupelo", "artist", "artist Uncle Tupelo"],
  ["the jayhawks", "artist", "artist The Jayhawks"],
  ["sharon jones", "artist", "artist Sharon Jones & The Dap-Kings"],
  ["radiohead", "artist", "artist Radiohead"],
  ["miles davis", "artist", "artist Miles Davis"],
  ["the band", "artist", "artist The Band"],
  ["hey jude", "song", "song Hey Jude / The Beatles"],
  ["so what", "song", "song So What (feat. John Coltrane, Cannonball Adderley & Bill Evans) / Miles Davis"],
  ["here comes the sun", "song", "song Here Comes The Sun - Remastered 2009 / The Beatles"],
  ["purple rain", "song/album", "unsure"],
  ["abbey road", "album", "album Abbey Road (Remastered 2009) / The Beatles"],
  ["kind of blue", "album", "album Kind Of Blue / Miles Davis"],
  ["sign o the times", "song/album", "unsure"],
  ["rumours", "album", "album Rumours / Fleetwood Mac"],
  ["funk from the 70s", "genre", "genre dr-funkenstein"],
  ["80s new wave", "genre", "genre genre"],
  ["delta blues", "genre", "genre genre"],
  ["70s hits", "genre", "era vibe"],
  ["jazz", "genre", "genre genre"],
  // The fresh set (9 of 14 under stage 0's rule; its five misses are the fixes).
  ["wilco", "artist", "artist Wilco"],
  ["neil young", "artist", "artist Neil Young"],
  ["the meters", "artist", "artist The Meters"],
  ["stevie wonder", "artist", "artist Stevie Wonder"],
  ["yes", "artist", "artist Yes"],
  ["america", "artist", "unsure"],
  ["superstition", "song", "song Superstition / Stevie Wonder"],
  ["the weight", "song", "song The Weight - Remastered 2000 / The Band"],
  ["blackbird", "song", "song Blackbird - Remastered 2009 / The Beatles"],
  ["heroes", "song/album", "unsure"],
  ["blood on the tracks", "album", "album Blood On The Tracks / Bob Dylan"],
  ["pet sounds", "album", "unsure"],
  ["whats going on", "song/album", "unsure"],
  ["blue", "album", "unsure"],
  // The owner's real asks, an artist and more.
  ["prince parade", "artist+", "album Parade - Music from the Motion Picture Under the Cherry Moon / Prince"],
  ["prince lovesexy", "artist+", "unsure"],
  ["the early years of madness", "artist+", "artist Madness"],
];
const said = (x) => (["artist"].includes(x.kind) ? `artist ${x.title}`
  : ["song", "album"].includes(x.kind) ? `${x.kind} ${x.kind === "album" ? x.album.name : x.title} / ${x.by}`
    : ["genre", "era"].includes(x.kind) ? `${x.kind} ${x.dj}` : x.kind);

test("stage 0's 39 kept answers: what the reader makes of each", async () => {
  for (const [ask, , want] of STAGE0) assert.equal(said(await play(ask)), want, ask);
});

test("stage 0's 39: none confidently wrong; the unsure are title tracks and two-things", async () => {
  let right = 0, unsure = 0, wrong = [];
  for (const [ask, want] of STAGE0) {
    const x = await play(ask);
    const kind = x.kind === "era" ? "genre" : x.kind;
    if (kind === "unsure") unsure += 1;
    else if (want.split("/").includes(kind) || (want === "artist+" && ["artist", "album", "song"].includes(kind))) right += 1;
    else wrong.push(`${ask}: ${kind}`);
  }
  assert.deepEqual(wrong, []);
  assert.equal(right, 31);
  assert.equal(unsure, 8);
});

// THE GATE (tasks/mc47-gate/asks.json, written before any was searched).
// Its honest score is the first run's, under the rule as committed in
// 25a6898: 22 right, 4 unsure, 3 none, 1 wrong (pass: at most two wrong;
// results.json). Four fixes followed, each from one miss: a compilation is
// not an album unless asked for ("bohemian rhapsody"), "st" is "street"
// ("exile on main st"), any of the first three artists inside the ask
// ("neil young harvest"), a surname with most of the tracks ("early
// bowie"), and the recording with most versions ("strange fruit": Nina
// Simone's had been taken). So the table below is shaped on these answers
// too; a third, fresh list would score the fixes.
const GATE = [
  ["fleetwood mac", "artist Fleetwood Mac"], ["aretha franklin", "artist Aretha Franklin"],
  ["talking heads", "artist Talking Heads"], ["joni mitchell", "artist Joni Mitchell"], ["al green", "artist Al Green"],
  ["the who", "artist The Who"], ["queen", "artist Queen"], ["chicago", "artist Chicago"],
  ["bohemian rhapsody", "song Bohemian Rhapsody / Queen"], ["respect", "song Respect / Aretha Franklin"],
  ["jolene", "unsure"], ["waterloo sunset", "song Waterloo Sunset / The Kinks"],
  ["a change is gonna come", "song A Change Is Gonna Come / Sam Cooke"], ["strange fruit", "song Strange Fruit / Billie Holiday"],
  ["fast car", "song Fast Car / Tracy Chapman"],
  ["exile on main st", "album Exile On Main Street (2010 Re-Mastered) / The Rolling Stones"],
  ["songs in the key of life", "album Songs In The Key Of Life / Stevie Wonder"], ["ok computer", "album OK Computer / Radiohead"],
  ["remain in light", "album Remain in Light / Talking Heads"], ["london calling", "unsure"],
  ["the album astral weeks", "album Astral Weeks / Van Morrison"], ["jolene by dolly parton", "unsure"],
  ["neil young harvest", "unsure"], ["early bowie", "artist David Bowie"],
  ["90s hip hop", "genre genre"], ["krautrock", "genre genre"], ["60s soul", "genre soul"], ["acoustic blues", "genre sessions"],
  ["80s hits", "era vibe"], ["something chill for dinner", "mood"],
];
test("the gate's 30 kept answers, under the rule as it now is", async () => {
  for (const [ask, want] of GATE) assert.equal(said(await play(ask)), want, ask);
});

test("an artist: their own songs, Deep Dive on the guest DJ's preset, one search", async () => {
  const cat = keptCatalog();
  const x = await play("play the beatles on the ultra", { catalog: cat });
  assert.equal(x.kind, "artist");
  assert.equal(x.dj, "deep-dive");
  assert.deepEqual(x.place, { button: 3, own: false });
  assert.equal(x.device, "Ultra");
  assert.equal(x.words, "the beatles");
  assert.equal(x.songs.length, 5);
  assert.ok(x.songs.every((s) => s.artist === "The Beatles" && /^spotify:track:/.test(s.uri)));
  assert.equal(x.searches, 1);
  assert.equal(x.say, "Starting The Beatles on the Ultra, In My Life first. Deep Dive takes it from there, on preset 3.");
});

test("a one-word name whose tracks are other people's: one more search for the artist's own", async () => {
  const yes = ANSWERS["artist,album,track|yes"];
  const own = (n) => ({ id: `yes${n}`, uri: `spotify:track:yes${n}`, name: `Yes song ${n}`, artists: [{ id: yes.artists[0].id, name: "Yes" }] });
  const cat = keptCatalog({ 'artist:"Yes"': [own(1), own(2), own(3), own(4)] });
  const x = await play("yes", { catalog: cat });
  assert.equal(x.kind, "artist");
  assert.deepEqual(cat.asked, ["all yes", 'track artist:"Yes"']);
  assert.equal(x.searches, 2);
  assert.deepEqual(x.songs.map((s) => s.name), ["Yes song 1", "Yes song 2", "Yes song 3", "Yes song 4"]);
});

test("a song: that song first, then more of its artist", async () => {
  const x = await play("hey jude");
  assert.equal(x.kind, "song");
  assert.equal(x.songs[0].name, "Hey Jude");
  assert.ok(x.songs.every((s) => s.artist === "The Beatles"));
  assert.equal(new Set(x.songs.map((s) => s.name)).size, x.songs.length);
  assert.equal(x.say, "Starting Hey Jude by The Beatles on the Pro Plus. Deep Dive takes it from there, on preset 3.");
});

test("an album plays as itself: no DJ, no songs, the plain edition", async () => {
  const x = await play("abbey road in the living room");
  assert.equal(x.kind, "album");
  assert.equal(x.dj, null);
  assert.deepEqual(x.songs, []);
  assert.equal(x.album.name, "Abbey Road (Remastered 2009)");
  assert.equal(x.album.year, "1969");
  assert.equal(x.say, "Starting Abbey Road, the album by The Beatles, on the Living Room.");
});

test("unsure asks and does not play; \"the album …\" and \"the song …\" settle it", async () => {
  const x = await play("pet sounds");
  assert.equal(x.kind, "unsure");
  assert.deepEqual(x.songs, []);
  assert.equal(x.say, "Pet Sounds by The Beach Boys: the album, or the song? Say \"the album …\" or \"the song …\" first.");
  const album = await play("the album pet sounds");
  assert.equal(album.kind, "album");
  assert.equal(album.album.name, "Pet Sounds");
  const song = await play("the song pet sounds");
  assert.equal(song.kind, "song");
  assert.equal(song.songs[0].name, "Pet Sounds");
  const blue = await play("blue");
  assert.equal(blue.say, "Blue: the album by Joni Mitchell, or the song by The Jayhawks? Say \"the album …\", \"the song …\" or \"the band …\" first.");
});

test("a house DJ who owns the words: their own preset, steered, no bridge and no search", async () => {
  const cat = keptCatalog();
  for (const [ask, dj, button] of [["funk from the 70s", "dr-funkenstein", 4], ["70s hits", "vibe", 9],
    ["acoustic nirvana", "sessions", 6], ["stax", "soul", 8], ["daptone 45s", "hank", 5], ["alt country", "americana", 7],
    ["60s soul", "soul", 8], ["northern soul from the 60s", "soul", 8]]) {
    const x = await play(ask, { catalog: cat });
    assert.equal(x.dj, dj, ask);
    assert.deepEqual(x.place, { button, own: true }, ask);
    assert.deepEqual(x.songs, [], ask);
  }
  assert.deepEqual(cat.asked, []);
  const x = await play("funk from the 70s on the ultra");
  assert.equal(x.say, "Starting Dr. Funkenstein on the Ultra, on preset 4, Dr. Funkenstein's own; the songs turn to funk from the 70s after this one.");
});

test("a genre nobody owns: Genre on the guest preset, the bridge searched by plain words and years", async () => {
  const cat = keptCatalog();
  const x = await play("80s new wave", { catalog: cat });
  assert.equal(x.dj, "genre");
  assert.deepEqual(x.place, { button: 3, own: false });
  assert.deepEqual(cat.asked, ["track new wave year:1980-1989"]);
  assert.equal(x.songs.length, 5);
  assert.equal(new Set(x.songs.map((s) => s.artist)).size, 5);
  // Without years, its classic years (stage 0: plain "jazz" was A Tribe Called Quest's "Jazz (We've Got)").
  const jazz = keptCatalog();
  await play("jazz", { catalog: jazz });
  assert.deepEqual(jazz.asked, ["track jazz year:1955-1969"]);
  // Funk and soul after 1979 are Genre's.
  assert.equal((await play("80s funk")).dj, "genre");
  assert.equal((await play("90s soul")).dj, "genre");
  // A guest DJ's own words, with years.
  const pub = keptCatalog();
  const p = await play("70s pub rock", { catalog: pub });
  assert.equal(p.dj, "pub-rock");
  assert.deepEqual(pub.asked, ["track pub rock year:1970-1979"]);
});

test("the words alone: what needs no search, and what the quick path does not take", () => {
  const read = (w) => beforeSearch(readPlayNow(w, { rooms: ROOMS }));
  assert.deepEqual(read("hank"), { kind: "dj", dj: "hank" });
  assert.deepEqual(read("pub rock"), { kind: "dj", dj: "pub-rock" });
  assert.equal(read("something mellow").kind, "mood");
  assert.equal(read("music for a rainy sunday").kind, "mood");
  assert.equal(read("upbeat 60s for a party").kind, "era");
  assert.equal(read("some bach").kind, "classical");
  assert.equal(read("beethoven symphonies").kind, "classical");
  assert.equal(read("the top 40").kind, "charts");
  assert.equal(read("something like radiohead").kind, "like");
  assert.equal(read("late night jazz").dj, "genre");
  // Names that hold genre words are searched.
  for (const w of ["the blues brothers", "new order", "soul ii soul", "heavy metal drummer", "funkadelic", "chicago"]) {
    assert.equal(read(w), null, w);
  }
  // A year alone or a mood alone may be a title: searched first.
  assert.equal(read("1999").titleFirst, true);
  assert.equal(read("happy").titleFirst, true);
  assert.equal(read("music from 1983").titleFirst, undefined);
  assert.equal(read("70s").titleFirst, undefined);
});

test("the years said: decades, shades, single years and spans joined", () => {
  const y = (w) => wordTable(w).years;
  assert.deepEqual(y("70s"), { from: 1970, to: 1979 });
  assert.deepEqual(y("the 1980s"), { from: 1980, to: 1989 });
  assert.deepEqual(y("'60s"), { from: 1960, to: 1969 });
  assert.deepEqual(y("70's"), { from: 1970, to: 1979 });
  assert.deepEqual(y("the seventies"), { from: 1970, to: 1979 });
  assert.deepEqual(y("early 80s"), { from: 1980, to: 1983 });
  assert.deepEqual(y("late 60s"), { from: 1966, to: 1969 });
  assert.deepEqual(y("60s and 70s"), { from: 1960, to: 1979 });
  assert.deepEqual(y("1965 to 1975"), { from: 1965, to: 1975 });
  assert.deepEqual(y("music from 1983"), { from: 1983, to: 1983 });
  assert.deepEqual(y("00s"), { from: 2000, to: 2009 });
  assert.equal(y("the beatles"), null);
});

test("reading the ask: play, some, the speaker, now, a length, and titles the set words would break", () => {
  const r = (w) => readPlayNow(w, { rooms: ROOMS, fallback: "Pro Plus" });
  assert.equal(r("play some coltrane in the den").words, "coltrane");
  assert.equal(r("play some coltrane in the den").device, "Den");
  assert.equal(r("put on the beatles now").words, "the beatles");
  assert.equal(r("the beatles on the ultra right now").device, "Ultra");
  assert.equal(r("the beatles living room").device, "Living Room");
  assert.equal(r("the beatles").deviceFrom, "default");
  const hour = r("an hour of 70s funk");
  assert.equal(hour.words, "70s funk");
  assert.equal(hour.lengthSaid, true);
  assert.equal(hour.minutes, 60);
  // readWords' set marks are not read here: these are titles.
  assert.equal(r("all night long").words, "all night long");
  assert.equal(r("no woman no cry").words, "no woman no cry");
  assert.equal(r("keep it comin").words, "keep it comin");
  // "everywhere by fleetwood mac" is a song, not a speaker.
  assert.equal(r("everywhere by fleetwood mac").device, "Pro Plus");
  assert.deepEqual(r("everywhere by fleetwood mac").by, { title: "everywhere", artist: "fleetwood mac" });
  // The kind said first, only after "the".
  assert.equal(r("the album pet sounds").forced, "album");
  assert.equal(r("the song pet sounds").body, "pet sounds");
  assert.equal(r("the band yes").forced, "artist");
  assert.equal(r("songs by the beatles").forced, "artist");
  assert.equal(r("song 2").forced, null);
  assert.equal(r("single ladies").forced, null);
  assert.equal(r("the band").forced, null);
});

test("no DJ to carry it on: the house says so", async () => {
  const x = await play("the beatles", { places: null });
  assert.equal(x.place, null);
  assert.equal(x.say, "The Beatles: no DJ can carry it on in this house, so I couldn't start it.");
});

test("the places come from the endless config: own presets and the lane", () => {
  const cfg = { mode: "live", presets: [{ button: 4, dj: "dr-funkenstein" }, { button: 3, dj: null, lane: true }, { button: 9, dj: "vibe" }] };
  assert.deepEqual(playNowPlaces(cfg), { lane: 3, own: { "dr-funkenstein": 4, "vibe": 9 } });
  assert.equal(playNowPlaces({ ...cfg, mode: "watch" }), null);
  assert.equal(playNowPlaces(null), null);
});

test("a genre's songs: no title twice and no artist twice", () => {
  const t = (id, name, artist) => ({ id, name, artists: [{ id: artist, name: artist }] });
  const got = spreadSongs([t(1, "A", "x"), t(2, "B", "x"), t(3, "A", "y"), t(4, "C", "z")]);
  assert.deepEqual(got.map((s) => s.id), [1, 4]);
});

test("searchAll asks Spotify once for all three, and drops the nulls", async () => {
  const calls = [];
  const cat = spotifyCatalog(async (method, path, opts) => {
    calls.push([method, path, opts.params]);
    return { artists: { items: [{ id: "a" }, null] }, albums: { items: [] }, tracks: { items: [null, { id: "t" }] } };
  });
  const got = await cat.searchAll("the beatles", 10);
  assert.deepEqual(calls, [["GET", "/search", { q: "the beatles", type: "artist,album,track", limit: 10 }]]);
  assert.deepEqual(got, { artists: [{ id: "a" }], albums: [], tracks: [{ id: "t" }] });
});
