// WHAT THE SPEAKERS HOLD (2026-09-13): the Read WiiM Presets shortcut posts
// each speaker's own preset table; the Worker reads it (keymap.js, the read
// half only), keeps it with its own time, and shows it. The two tables here
// are the boxes' real answers to GetKeyMapping, read from the Chromebook the
// same afternoon (test/fixtures/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";
import { parseKeyMapping, readingFrom, READ_ENVELOPE, READ_ACTION } from "../keymap.js";
import { ARCHIVE } from "../archive-identity.js";

const KEY = "abcdefabcdefabcdefabcdef";
// Preset 6 holds the archive, saved under its name: the fixture says "House
// Archive" and the house's own name goes in (archive-identity.js).
const PRO = readFileSync(new URL("./fixtures/keymap-pro-plus.xml", import.meta.url), "utf8").replaceAll("House Archive", ARCHIVE.name);
const ULTRA = readFileSync(new URL("./fixtures/keymap-ultra.xml", import.meta.url), "utf8");
const GS = "GUESTSPOTIFY0000000001";
const GT = "0b1f2c3d-aaaa-bbbb-cccc-000000000002";

function env() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.PROGRAM_BASE_URL = "https://house.example";
  e.HOUSE_TZ = "America/Los_Angeles";
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "DJ Guest · Spotify", playlist: GS, catalog: "spotify" },
    { button: 2, guest: true, live: true, name: "DJ Guest · Tidal", playlist: GT, catalog: "tidal" },
    { button: 6, archive: true },
  ]);
  e.PLAYLIST_ALIASES = JSON.stringify({ replay: `${"0".repeat(21)}9` });
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57", Ultra: "192.168.4.78" });
  return e;
}
const get = (p) => new Request(`https://x.test${p}`);
const post = (p, body, headers = {}) => new Request(`https://x.test${p}`,
  { method: "POST", body, headers: { "content-type": "text/xml", ...headers } });
const utc = (ms) => new Date(ms).toISOString().slice(0, 10);

test("a speaker's table reads as its presets: the name without its save stamp, the source in words, and the day it was saved", () => {
  const pro = readingFrom(PRO, { dayOf: utc });
  assert.equal(pro.length, 12);
  assert.deepEqual(pro[0], { btn: 1, name: "DJ Guest", source: "Spotify", saved: null });
  assert.deepEqual(pro[1], { btn: 2, name: "DJ Guest · Tidal", source: "Tidal", saved: "2026-09-12" });
  assert.deepEqual(pro[5], { btn: 6, name: ARCHIVE.name, source: "Web stream", saved: utc(1787728647000) });
  assert.deepEqual(pro[9], { btn: 10, name: "Kurt", source: "Tidal", saved: "2026-09-06" });
  const ultra = readingFrom(ULTRA, { dayOf: utc });
  assert.deepEqual(ultra[5], { btn: 6, name: "Sky Radio Hits", source: "TuneIn", saved: "2025-07-12" });
  assert.deepEqual(ultra[6], { btn: 7, name: "NPO 3FM", source: "WiiM radio", saved: "2026-09-12" });
  assert.equal(parseKeyMapping(PRO).keys.get(3).name, "The Professor");
  // Nothing that is not a table.
  assert.throws(() => readingFrom("<html>no</html>"), /not a preset table from a WiiM/);
  assert.throws(() => readingFrom(""), /not a preset table/);
  // The bare document reads too, as a phone might hand it over.
  const bare = "<KeyList><Key3><Name>Jazz FM_#~2026-09-01 10:00:00</Name><Source>newTuneIn</Source></Key3></KeyList>";
  assert.deepEqual(readingFrom(bare, { dayOf: utc }), [{ btn: 3, name: "Jazz FM", source: "TuneIn", saved: "2026-09-01" }]);
  // The question the shortcut sends is a GetKeyMapping, and the header keeps its quotes.
  assert.match(READ_ENVELOPE, /<u:GetKeyMapping xmlns:u="urn:schemas-wiimu-com:service:PlayQueue:1"><\/u:GetKeyMapping>/);
  assert.equal(READ_ACTION, '"urn:schemas-wiimu-com:service:PlayQueue:1#GetKeyMapping"');
});

test("the question is served; a reading is kept with the server's own time, and answered in words for the phone", async () => {
  const e = env();
  const f = installFetch();
  try {
    const q = await worker.fetch(get(`/buttons/${KEY}/readings/ask.xml`), e);
    assert.equal(q.status, 200);
    assert.match(q.headers.get("content-type"), /^text\/xml/);
    assert.equal(await q.text(), READ_ENVELOPE);
    const before = Date.now();
    const r = await worker.fetch(post(`/buttons/${KEY}/readings/pro-plus`, PRO), e);
    assert.equal(r.status, 200);
    const said = await r.text();
    assert.match(said, /^Pro Plus, read at \d\d:\d\d:\n1 {2}DJ Guest \(Spotify\)\n2 {2}DJ Guest · Tidal \(Tidal\)\n/);
    assert.match(said, new RegExp(`\\n6 {2}${ARCHIVE.name} \\(Web stream\\)\\n`));
    const rec = JSON.parse(await e.PROGRAMS.get("reading:pro-plus"));
    assert.equal(rec.speaker, "Pro Plus");
    assert.equal(rec.presets.length, 12);
    assert.ok(Date.parse(rec.at) >= before, "stamped by the server, when it arrived");
    assert.equal((await worker.fetch(post(`/buttons/${KEY}/readings/ultra`, ULTRA), e)).status, 200);
  } finally { f.restore(); }
});

test("the page shows where the speakers agree once, where they differ per speaker, a guest saved under an old name, and the recipe with this house's addresses", async () => {
  const e = env();
  const f = installFetch();
  try {
    await worker.fetch(post(`/buttons/${KEY}/readings/pro-plus`, PRO), e);
    await worker.fetch(post(`/buttons/${KEY}/readings/ultra`, ULTRA), e);
    const html = await (await worker.fetch(get(`/buttons/${KEY}/readings`), e)).text();
    assert.match(html, /<h1>What the speakers hold<\/h1>/);
    assert.match(html, /Pro Plus read at \d\d:\d\d · Ultra read at \d\d:\d\d/);
    const row = (n) => html.match(new RegExp(`<li[^>]*><span class="rnum" aria-hidden="true">${n}</span>[\\s\\S]*?</li>`))?.[0] ?? "";
    // Agreed: one line.
    assert.equal((row(3).match(/class="rline"/g) ?? []).length, 1);
    assert.match(row(3), /<b>The Professor<\/b><span class="rsrc">Spotify<\/span>/);
    // Differ: a line per speaker, each named.
    assert.match(row(6), /^<li id="p6" class="split">/);
    assert.ok(html.includes('<li id="p3"><span class="rnum"'), "each preset is a place to land");
    assert.ok(row(6).includes(`<span class="rbox">Pro Plus</span><b>${ARCHIVE.name}</b>`));
    assert.match(row(6), /<span class="rbox">Ultra<\/span><b>Sky Radio Hits<\/b><span class="rsrc">TuneIn · saved 12 Jul 2025<\/span>/);
    assert.match(row(7), /<span class="rbox">Ultra<\/span><b>NPO 3FM<\/b>/);
    // The guest the house renamed, still saved under the old name on both.
    assert.match(row(1), /The page calls it DJ Guest · Spotify — re-save preset 1 to match, then read the speakers again\./);
    assert.ok(!/The page calls it/.test(row(2)), "the Tidal guest reads as the house calls it");
    // The recipe: this house's addresses, each with a Copy.
    for (const v of [`https://house.example/buttons/${KEY}/readings/ask.xml`,
      "http://192.168.4.57:49152/upnp/control/PlayQueue1", "http://192.168.4.78:49152/upnp/control/PlayQueue1",
      `https://house.example/buttons/${KEY}/readings/pro-plus`, `https://house.example/buttons/${KEY}/readings/ultra`]) {
      assert.ok(html.includes(`data-copy="${v}"`), v);
    }
    assert.ok(html.includes('data-copy="&quot;urn:schemas-wiimu-com:service:PlayQueue:1#GetKeyMapping&quot;"'));
    assert.ok(html.includes('href="shortcuts://run-shortcut?name=Read%20WiiM%20Presets"'));
    // The recipe as the first build on an iPhone found it (2026-09-13).
    assert.match(html, /tap that blue token, then <b>Clear Variable<\/b>/, "a new Get Contents of URL fills in the step before's result");
    assert.match(html, /<b>Show Content<\/b> \(<i>Show Result<\/i> on older iPhones\)/);
    assert.match(html, /<b>Select Variable<\/b>, and tap the Pro Plus action above/);
    assert.match(html, /pasted, not typed — a typed quote turns curly/);
    assert.ok(!html.includes("Show More"), "the options open from the circled arrow now");
    assert.match(html, /<details class="recipe">/, "folded once a speaker has been read");
    // And the Speakers page leads here.
    assert.ok((await (await worker.fetch(get(`/buttons/${KEY}/wiim`), e)).text())
      .includes(`<a class="chip" href="/buttons/${KEY}/readings">What the speakers hold</a>`));
  } finally { f.restore(); }
});

test("before any reading the page says so, and opens the recipe", async () => {
  const e = env();
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/readings`), e)).text();
    assert.match(html, /Pro Plus not read yet · Ultra not read yet/);
    assert.match(html, /<details class="recipe" open>/);
    assert.ok(!html.includes('class="rlist"'));
  } finally { f.restore(); }
});

test("refused in words: a wrong key, a speaker the house does not name, a GET where a POST goes, not a table, too big, another site", async () => {
  const e = env();
  const f = installFetch();
  try {
    assert.equal((await worker.fetch(get(`/buttons/${"x".repeat(24)}/readings`), e)).status, 404);
    const nobody = await worker.fetch(post(`/buttons/${KEY}/readings/kitchen`, PRO), e);
    assert.equal(nobody.status, 404);
    assert.match(await nobody.text(), /No speaker called "kitchen" in this house — it has pro-plus and ultra\./);
    const look = await worker.fetch(get(`/buttons/${KEY}/readings/pro-plus`), e);
    assert.equal(look.status, 405);
    assert.match(await look.text(), /sent here with POST, by the Read WiiM Presets shortcut/);
    const junk = await worker.fetch(post(`/buttons/${KEY}/readings/pro-plus`, '{"not":"xml"}'), e);
    assert.equal(junk.status, 400);
    assert.match(await junk.text(), /^Pro Plus: That is not a preset table from a WiiM/);
    const big = await worker.fetch(post(`/buttons/${KEY}/readings/pro-plus`, "x".repeat(70 * 1024)), e);
    assert.equal(big.status, 413);
    const elsewhere = await worker.fetch(post(`/buttons/${KEY}/readings/pro-plus`, PRO, { origin: "https://evil.example" }), e);
    assert.equal(elsewhere.status, 403);
    assert.equal(await e.PROGRAMS.get("reading:pro-plus"), null, "none of that kept a reading");
    // The withdrawn shortcut's addresses are gone.
    assert.equal((await worker.fetch(post(`/buttons/${KEY}/wiim/pro-plus`, PRO), e)).status, 404);
  } finally { f.restore(); }
});

// THE PRESETS PAGE FROM THE READINGS. It used to draw, under a line, every
// preset it had no band for, as the speakers held it (2026-09-13, option A of
// the canvas). That list went on 2026-09-22 — the Speakers tab lists the
// twelve per speaker and plays the Spotify ones, and this tab is the guests.
// What the readings still reach here is the GUESTS' own bands: a speaker that
// calls a guest by another name, or has nothing saved on its number, is said
// on the band itself.
const bandIn = (html, n) => html.match(new RegExp(`<li class="band[^"]*" data-btn="${n}"[\\s\\S]*?</li>`))?.[0] ?? "";

test("the readings reach the guests' bands: a guest the speakers still call by its old name, and the page and /playing carry the same reading time", async () => {
  const e = env();
  const f = installFetch();
  try {
    // Nothing read yet: the house's own line, as before — the archive on 6 and nothing else.
    const before = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!before.includes("data-read-at="));
    assert.equal(bandIn(before, 3), "", "no band for a preset the house does not name");
    assert.ok(!bandIn(before, 6).includes(ARCHIVE.name), "and none for the archive since 2026-09-22");
    assert.ok(!bandIn(before, 1).includes("bheard"));

    await worker.fetch(post(`/buttons/${KEY}/readings/pro-plus`, PRO), e);
    await worker.fetch(post(`/buttons/${KEY}/readings/ultra`, ULTRA), e);
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    // NOT A BAND BETWEEN 3 AND 12 any more, however the speakers are read:
    // that list is the Speakers tab's, where it can also be played.
    for (let n = 3; n <= 12; n++) assert.equal(bandIn(html, n), "", `preset ${n} is the Speakers tab's`);
    assert.ok(!html.includes("Started from the remote"), "no line, and nothing under it");
    assert.ok(!html.includes('class="slimread"'), "its reading line went with it");
    assert.ok(!html.includes(`/buttons/${KEY}/archive`), "the archive's door is the DJs tab's");
    // The guest the house renamed: both speakers still say the old name. The
    // Tidal guest reads as the house calls it.
    assert.match(bandIn(html, 1), /^<li class="band fixed guest live tall heard" data-btn="1"/);
    // Said as a moment, with when: the page cannot see the speakers.
    assert.match(bandIn(html, 1), /<span class="bmeta bheard"><span>Both speakers said “DJ Guest”( at \d\d:\d\d)?<\/span><\/span>/);
    assert.ok(!bandIn(html, 2).includes("bheard"));
    // A page left open reloads for a newer reading: the page and /playing carry the same time.
    const drawn = Number(html.match(/data-read-at="(\d+)"/)?.[1]);
    assert.equal(drawn, Date.parse(JSON.parse(await e.PROGRAMS.get("reading:ultra")).at));
    assert.equal((await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json()).readAt, drawn);
  } finally { f.restore(); }
});

test("with one speaker read the page says which; another spelling of a guest's name is the same name; a speaker without the guest says so", async () => {
  const e = env();
  const f = installFetch();
  try {
    await worker.fetch(post(`/buttons/${KEY}/readings/pro-plus`,
      PRO.replace("&lt;Name&gt;DJ Guest&lt;/Name&gt;", "&lt;Name&gt;DJ Guest - Spotify&lt;/Name&gt;")), e);
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    // The reading line and the archive's band are both gone from this tab
    // (2026-09-22); the guests' own bands still read from the speakers.
    assert.ok(!html.includes("read at"), "no reading line on this tab");
    assert.equal(bandIn(html, 6), "", "no archive band");
    assert.ok(!bandIn(html, 1).includes("bheard"), "DJ Guest - Spotify is the house's DJ Guest · Spotify");
    assert.ok(!(await (await worker.fetch(get(`/buttons/${KEY}/readings`), e)).text()).includes("The page calls it"),
      "and the readings page agrees");
    // A speaker with nothing saved on a guest's number.
    await worker.fetch(post(`/buttons/${KEY}/readings/ultra`, ULTRA.replace(/&lt;Key2&gt;[\s\S]*?&lt;\/Key2&gt;/, "")), e);
    assert.match(bandIn(await (await worker.fetch(get(`/buttons/${KEY}`), e)).text(), 2),
      /<span class="bmeta bheard"><span>Not saved on the Ultra when read at \d\d:\d\d<\/span><\/span>/);
  } finally { f.restore(); }
});
