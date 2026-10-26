// THE PAGES FOR THE GUESTS, stage 4 (MC-18, tasks/done/mc18-guest-presets.md),
// option C as the owner chose it on 2026-09-13: each guest a tall band saying
// whose set is on it and since when, the presets only the remote starts slim
// under one line; the DJ page's block for a DJ on a guest; the request card
// judged on the guest's own record, and superseded said in one quiet line;
// the Speakers page as a checklist for the guests' saves; Use at its own
// address. Before the switch-over the DJs' bands stay exactly as they were.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, installTidalFetch, track } from "./harness.js";
import { fingerprintUris } from "../station.js";
import { PERSONAS } from "../djs.js";
import { barWords } from "../programs.js";
import { ARCHIVE } from "../archive-identity.js";

const { houseClockWords, sinceWords, loadedWords, atWords, askDay, djPlaces, guestHolders, djSlotsExist, callTool } = __test;

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const GS = "GUESTSPOTIFY0000000001";
const GT = "0b1f2c3d-aaaa-bbbb-cccc-000000000002";
const TIDC = "0b1f2c3d-aaaa-bbbb-cccc-000000000077";
const SINCE = "2026-09-07T06:47:41.466Z";
const HANK = PERSONAS.hank.name;
// Monk stood for the DJ with no preset until the owner cut him (2026-10-15);
// Dr. Funkenstein does now, and the Librarian and Soul hold the Professor's
// 3 and the Selector's 7 below.
const FUNK = PERSONAS["dr-funkenstein"].name;
const VIBE = PERSONAS.vibe.name;

const guest = (over = {}) => ({
  button: 1, guest: true, live: true, name: "DJ Guest", playlist: GS, catalog: "spotify", ...over,
});
const tidalGuest = (over = {}) => ({
  button: 2, guest: true, live: true, name: "DJ Guest · Tidal", playlist: GT, catalog: "tidal", ...over,
});
function houseEnv(list, over = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.BUTTONS = JSON.stringify(list);
  e.PLAYLIST_ALIASES = JSON.stringify({ replay: P(9), "was button 1": P(1), "was button 2": P(2) });
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57", Ultra: "192.168.4.78" });
  return Object.assign(e, over);
}
// After the switch-over: the guests live on 1 and 2, stations on 3, 4 and 7,
// the archive on 6, and no preset a DJ can hold.
const flipEnv = (over) => houseEnv([guest(), tidalGuest(), { button: 3, label: "Jazz FM" },
  { button: 4, label: "KEXP" }, { button: 6, archive: true }, { button: 7, label: "NPO Radio 2" }], over);
// Before it, as the house stands: the guests dark, DJs on 3 and 7, the archive on 6.
const darkEnv = (over) => houseEnv([guest({ live: false }), tidalGuest({ live: false }),
  { button: 3, dj: "the-librarian", playlist: P(3) }, { button: 6, archive: true },
  { button: 7, dj: "soul", playlist: P(7) }], over);

const get = (p) => new Request(`https://x.test${p}`);
const post = (p, body) => new Request(`https://x.test${p}`, { method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" }, body });
const page = async (e, path) => (await worker.fetch(get(path), e)).text();
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
// "since 20:02" as a band prints it, every space unbreakable.
const nbsp = (s) => s.replace(/ /g, "\u00a0");

async function seedProgram(e, slug, by, title, catalog = "spotify", created = "2026-09-10T10:00:00Z") {
  await e.PROGRAMS.put(`program:${slug}`, JSON.stringify({ slug, dj: by, title, shape: "setlist", thesis: "t",
    created, tracks: 2, runtime: "7:00", sections: [] }),
  { metadata: { title, dj: by, created, shape: "setlist", tracks: 2, runtime: "7:00", catalog } });
}
// A set on a guest as the door leaves it: the record of who is on it and,
// when a program was put there, its pointer.
async function putOn(e, pid, { dj = null, ref, at = minutesAgo(1), program = null }) {
  await e.PROGRAMS.put(`on:${pid}`, JSON.stringify({ dj, ref, at }));
  if (program) {
    await e.PROGRAMS.put(`current:${pid}`, program.slug);
    await seedProgram(e, program.slug, program.by, program.title, program.catalog ?? "spotify");
  }
}
// The whole <li> of the band for one preset.
function bandOf(html, n) {
  const at = html.indexOf(`data-btn="${n}"`);
  assert.ok(at > 0, `a band for ${n}`);
  return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
}
// Every play request's body, for the context it named.
function playBodies() {
  const bodies = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (String(u).includes("/me/player/play")) bodies.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  return { bodies, restore: () => { globalThis.fetch = inner; } };
}

// ------------------------------------------------------------ the clock

test("when, in the house's own clock: the time today, the weekday this week, the date before that", () => {
  const e = { HOUSE_TZ: "America/Los_Angeles" };
  const now = Date.parse("2026-09-13T19:00:00Z"); // Sunday, noon in San Francisco
  assert.deepEqual(houseClockWords(e, "2026-09-13T16:05:00Z", now), { time: "09:05", day: null });
  // 23:30 on Saturday in the house is 06:30 on Sunday in UTC: the house's day decides.
  assert.deepEqual(houseClockWords(e, "2026-09-13T06:30:00Z", now), { time: "23:30", day: "Sat" });
  assert.deepEqual(houseClockWords(e, "2026-09-03T03:02:00Z", now), { time: null, day: "2 Sep" });
  assert.equal(sinceWords(houseClockWords(e, "2026-09-13T16:05:00Z", now)), "since 09:05");
  assert.equal(sinceWords(houseClockWords(e, "2026-09-13T06:30:00Z", now)), "since Sat 23:30");
  assert.equal(sinceWords(houseClockWords(e, "2026-09-03T03:02:00Z", now)), "since 2 Sep");
  assert.equal(atWords(houseClockWords(e, "2026-09-13T16:05:00Z", now)), "at 09:05");
  assert.equal(atWords(houseClockWords(e, "2026-09-13T06:30:00Z", now)), "on Sat at 23:30");
  assert.equal(atWords(houseClockWords(e, "2026-09-03T03:02:00Z", now)), "on 2 Sep");
  // The same instant, in a house in Amsterdam, is this morning.
  assert.deepEqual(houseClockWords({ HOUSE_TZ: "Europe/Amsterdam" }, "2026-09-13T06:30:00Z", now),
    { time: "08:30", day: null });
  for (const bad of [null, undefined, "", "not a date", 42]) assert.equal(houseClockWords(e, bad, now), null);
  assert.equal(sinceWords(null), null);
  assert.equal(atWords(null), null);
});

test("the day a request was asked, on the house's calendar", () => {
  const la = { HOUSE_TZ: "America/Los_Angeles" };
  assert.equal(askDay(la, "2026-09-13T03:30:00Z"), "2026-09-12", "20:30 in the house is still the 12th there");
  assert.equal(askDay(la, "2026-09-13T19:00:00Z"), "2026-09-13");
  assert.equal(askDay(la, "2026-09-11"), "2026-09-11", "a stored day is already a day");
  assert.equal(askDay({ HOUSE_TZ: "Mars/Olympus" }, "2026-09-13T03:30:00Z"), "2026-09-13",
    "a zone that will not parse falls back to UTC's day rather than breaking the page");
  for (const bad of [null, undefined, "", "yesterday", 42]) assert.equal(askDay(la, bad), null);
});

// ------------------------------------------------------ the presets page

test("after the switch-over each guest is a tall band saying whose set is on it and since when; the rest are slim under one line", async () => {
  const f = installFetch({ contents: Array.from({ length: 14 }, (_, i) => track(`h${i}`)) });
  const td = installTidalFetch({ contents: Array.from({ length: 11 }, (_, i) => String(i + 1)) });
  try {
    const e = flipEnv();
    const at = minutesAgo(2);
    await putOn(e, GS, { dj: "hank", ref: "deep-cuts", at,
      program: { slug: "deep-cuts", by: HANK, title: "Deep cuts for a Sunday" } });
    // A request's set: no program, so the listener's own words.
    await putOn(e, GT, { dj: "dr-funkenstein", ref: "request r-9", at });
    await e.PROGRAMS.put(`ask:${GT}`, JSON.stringify({ requestId: "r-9", text: "piano trios, late", at }));
    const res = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    // "loaded 20:02" (2026-09-23): "since" read as something still running.
    const since = nbsp(loadedWords(houseClockWords(e, at)));

    const one = bandOf(html, 1);
    assert.match(one, /^<li class="band fixed guest live tall" data-btn="1" data-name="DJ Guest" data-rest="Deep cuts for a Sunday">/);
    assert.ok(one.includes(`<a class="bfill" href="/buttons/${KEY}/hank" aria-label="Open ${HANK} — their set is on DJ Guest, preset 1">`),
      "the band opens the page of the DJ on it");
    assert.ok(one.includes(`<span class="beyebrow" aria-hidden="true">DJ Guest</span><h3 class="bname"><span class="vh">DJ Guest: </span>${HANK}</h3>` +
      `<span class="bsum bset">Deep cuts for a Sunday</span><span class="bmeta">14\u00a0tracks, ${since}</span>`), one);
    assert.ok(one.includes(`<form method="post" action="/buttons/${KEY}/guest/play" class="bplay"><input type="hidden" name="btn" value="1">` +
      `<input type="hidden" name="device" value="Pro Plus" data-wall>`));
    assert.match(one, /aria-label="Play DJ Guest on Pro Plus"/);

    const two = bandOf(html, 2);
    assert.match(two, /^<li class="band fixed guest live tall" data-btn="2"/);
    assert.ok(two.includes(`<h3 class="bname"><span class="vh">DJ Guest · Tidal: </span>${FUNK}</h3>` +
      `<span class="bsum bset">“piano trios, late”</span><span class="bmeta">11\u00a0tracks, ${since}</span>`), two);
    assert.ok(two.includes(`<span class="bsrc">Tidal</span><span class="bnote gpress">Press 2</span>` +
      `<a class="bopen" href="https://listen.tidal.com/playlist/${GT}" rel="noopener noreferrer">Open in Tidal<span class="arr" aria-hidden="true">&nbsp;<svg class="ic"`));
    assert.ok(!two.includes("<form"), "nothing here can start Tidal");

    // THE SLIM GROUP IS GONE (2026-09-22, the owner). The stations and the
    // archive used to follow the guests here, by name and number, which is
    // what the Speakers tab lists per speaker and plays the Spotify ones of.
    // This tab is the guests: what is loaded, and whose it is.
    assert.ok(!html.includes("Started from the remote"), "no line, and no group under it");
    assert.ok(!/<li class="band fixed slim/.test(html), "no slim bands of any kind");
    assert.ok(!html.includes("Jazz FM"), "a station's name is the Speakers tab's");
    assert.ok(!/<li[^>]*data-dj=/.test(html), "no DJ holds a preset any more");
    // The help says what the page is now.
    assert.match(html, /Each row says whose set it is and since when/);
    assert.ok(!html.includes("<b>To move a DJ</b>"), "nothing to move: no preset takes a DJ");
    // The request-preset paragraph folded into the first (2026-09-23): the line above the
    // bands already says a new set replaces the one before.
    assert.match(html, /<b>1<\/b> holds your last request on Spotify, <b>2<\/b> holds your last request on Tidal/);
  } finally { td.restore(); f.restore(); }
});

test("a guest band names a Talk set, a set nobody is recorded for, an empty guest, and a set from before today by its day", async () => {
  const f = installFetch({ contents: [track("a"), track("b")] });
  const td = installTidalFetch({ contents: [] });
  try {
    const e = flipEnv();
    await putOn(e, GS, { ref: "talk", at: new Date(Date.now() - 3.5 * 86400000).toISOString() });
    let html = await page(e, `/buttons/${KEY}`);
    const one = bandOf(html, 1);
    assert.ok(one.includes(`<span class="bfill"><span class="beyebrow" aria-hidden="true">DJ Guest</span>` +
      `<h3 class="bname"><span class="vh">DJ Guest: </span>A set from Talk</h3><span class="bsum bset">Asked for on the Talk tab</span>`),
    "no DJ named, so no page to open");
    assert.match(one, /<span class="bmeta">2\u00a0tracks, loaded\u00a0[A-Z][a-z]{2}\u00a0\d\d:\d\d<\/span>/,
      "the day, when it went on before today");
    // TALK'S OWN WORDS (2026-09-27): replace_playlist keeps them as ask: with no request id, and the band says them.
    await e.PROGRAMS.put(`ask:${GS}`, JSON.stringify({ text: "Vibe, an easy end-of-day hour", at: new Date().toISOString() }));
    const said = bandOf(await page(e, `/buttons/${KEY}`), 1);
    assert.ok(said.includes(`A set from Talk</h3><span class="bsum bset">\u201cVibe, an easy end-of-day hour\u201d</span>`), said);
    await e.PROGRAMS.delete(`ask:${GS}`);
    // Nothing on the Tidal guest and no record: nobody, and the one thing to do.
    const two = bandOf(html, 2);
    assert.match(two, /<span class="vh">DJ Guest · Tidal: <\/span>Nobody yet<\/h3><span class="bsum bset">Ask any DJ — a set on Tidal lands here<\/span>/);
    assert.ok(!two.includes("Press 2"), "no press on an empty preset");
    // A set with no record — a hand edit, or a write that could not record — is a set, not nobody.
    await e.PROGRAMS.delete(`on:${GS}`);
    html = await page(e, `/buttons/${KEY}`);
    assert.match(bandOf(html, 1), /<span class="vh">DJ Guest: <\/span>A set<\/h3><span class="bmeta">2\u00a0tracks<\/span>/);
  } finally { td.restore(); f.restore(); }
});

test("before the switch-over the DJs' bands are as they were, the dark guests tall with no Play, and no guest record is read", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = darkEnv();
    const read = [];
    const inner = e.PROGRAMS.get.bind(e.PROGRAMS);
    e.PROGRAMS.get = async (k, ...rest) => { read.push(String(k)); return inner(k, ...rest); };
    const html = await page(e, `/buttons/${KEY}`);
    const order = [...html.matchAll(/<li class="band[^"]*" data-btn="(\d+)"/g)].map((m) => Number(m[1]));
    // 6, the archive, had a band under a line after these until 2026-09-22;
    // the Speakers tab lists the twelve now. 7 was always one of these.
    assert.deepEqual(order, [1, 2, 3, 7], "number order, and no archive after them");
    for (const n of [1, 2]) {
      const g = bandOf(html, n);
      assert.match(g, /^<li class="band fixed guest tall" data-btn="\d">/);
      assert.match(g, /Not live yet<\/h3><span class="bsum bset">Being saved on the speakers<\/span><span class="bmeta">The Speakers tab says how\. Sets still go to the DJs’ own presets\.<\/span>/);
      assert.ok(!g.includes("<form") && !g.includes("<a "), "no Play and no page");
    }
    const prof = bandOf(html, 3);
    assert.match(prof, /^<li class="band" data-btn="3" data-dj="the-librarian" data-name="The Librarian" data-rest="[^"]+">/);
    assert.ok(prof.includes(`<a class="bnum" href="/buttons/${KEY}/the-librarian" tabindex="-1" aria-hidden="true">3</a>`));
    assert.ok(prof.includes(`<form method="post" action="/buttons/${KEY}/the-librarian/play" class="bplay">`));
    assert.ok(!html.includes("Started from the remote"), "no line under the wall");
    assert.match(html, /<b>To move a DJ<\/b>/, "the DJs still move");
    assert.match(html, /the name is the DJ who has it/);
    assert.match(html, /<b>A request preset<\/b> is nobody's: once it is live/);
    assert.deepEqual(read.filter((k) => /^(on|ask):/.test(k)), [], "no guest record read while the guests are dark");
  } finally { f.restore(); }
});

test("a guest's Play starts its playlist on the speaker chosen and comes back to the presets page; Tidal and a number that is no guest are refused", async () => {
  const f = installFetch({ contents: [track("a")] });
  const cap = playBodies();
  try {
    const e = flipEnv();
    const res = await worker.fetch(post(`/buttons/${KEY}/guest/play`, "btn=1&device=Pro+Plus"), e);
    assert.equal(res.status, 303);
    // The fake never confirms a play, so the outcome is "stuck", as a DJ's is.
    assert.equal(res.headers.get("location"), `/buttons/${KEY}?played=stuck&g=1&on=Pro%20Plus`);
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${GS}`);
    const back = await page(e, res.headers.get("location"));
    assert.match(back, /<p class="quietline" role="status">Spotify accepted it, but DJ Guest is not playing on Pro Plus — the speaker may be asleep/);
    // Only what the Worker can check is printed.
    assert.ok(!(await page(e, `/buttons/${KEY}?played=asleep&g=9&on=Pro+Plus`)).includes("device list"), "no guest 9, no line");
    assert.match(await page(e, `/buttons/${KEY}?played=asleep&g=1&on=Kitchen`), /That speaker is not in Spotify(?:&#39;|')s device list right now/);
    const tidal = await worker.fetch(post(`/buttons/${KEY}/guest/play`, "btn=2&device=Pro+Plus"), e);
    assert.equal(tidal.status, 400);
    assert.match(await tidal.text(), /DJ Guest · Tidal is on Tidal, which cannot be started from a page — playback from here goes through Spotify Connect\. Press 2 on the remote\./);
    assert.equal((await worker.fetch(post(`/buttons/${KEY}/guest/play`, "btn=5"), e)).status, 404);
    // From the Speakers page a guest not live yet plays — it is how a speaker
    // saves it — and comes back to its steps. A play writes nothing.
    const d = darkEnv();
    const save = await worker.fetch(post(`/buttons/${KEY}/guest/play`, "btn=1&device=Pro+Plus&back=wiim"), d);
    assert.equal(save.headers.get("location"), `/buttons/${KEY}/wiim?on=pro-plus&ask=1&played=stuck#asked`);
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${GS}`);
    assert.deepEqual([...d.PROGRAMS.store.keys()].filter((k) => /^(on|current|ask):/.test(k)), []);
  } finally { cap.restore(); f.restore(); }
});

// A PRESET KEY'S PLAY (MC-19 stage 2, tasks/done/mc19-key-play.md). The `preset`
// target starts the playlist on file for a number, on the WiiM named, when
// that speaker's own reading says the key is Spotify and the playlist's name
// still matches the reading's. The fake calls every playlist "Scratch".
const KEYED = (over = {}) => flipEnv({ PLAYLIST_ALIASES: JSON.stringify({ replay: P(9), "was button 1": P(1),
  "was button 2": P(2), "was button 4": P(4), "was button 5": P(5), "was button 10": GT, "was button 10 spotify": P(10) }), ...over });
// (1 is "Scratch" too: the fake names every playlist so, and the gate compares names.)
const PRO_READ = [[1, "Scratch", "Spotify"], [2, "DJ Guest · Tidal", "Tidal"], [3, "Novato", "Prime"],
  [4, "Sunny", "Spotify"], [5, "Scratch", "Spotify"], [6, ARCHIVE.name, "Web stream"], [7, "NPO 3FM", "WiiM radio"],
  [8, "Scratch", "Spotify"], [10, "Scratch", "Spotify"]].map(([btn, name, source]) => ({ btn, name, source, saved: null }));
const readPro = (e) => e.PROGRAMS.put("reading:pro-plus", JSON.stringify({ at: new Date().toISOString(), speaker: "Pro Plus", presets: PRO_READ }));

test("a preset key's Play of an endless DJ's playlist has the watch look on its next run, not the idle half-hour (2026-09-27)", async () => {
  const f = installFetch({ contents: [track("a")] });
  const cap = playBodies();
  try {
    const e = KEYED({ ENDLESS: JSON.stringify({ mode: "live", presets: [{ button: 5, dj: "hank", playlist: P(5) }] }) });
    await readPro(e);
    await __test.endlessUpdate(e, (st) => { st.lastLook = 12345; return {}; });
    await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=10&device=Pro+Plus"), e);
    assert.equal((await __test.endlessLoad(e)).lastLook, 12345, "not an endless playlist: the idle look stands");
    await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=5&device=Pro+Plus"), e);
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${P(5)}`);
    assert.equal((await __test.endlessLoad(e)).lastLook, 0, "the next run of the watch looks");
  } finally { cap.restore(); f.restore(); }
});

test("a preset key's Play: the playlist on file for that number, on the WiiM named, when its reading says Spotify and the names agree — and back to the Speakers page with a flash of its own", async () => {
  const f = installFetch({ contents: [track("a")] });
  const cap = playBodies();
  try {
    const e = KEYED();
    await readPro(e);
    // 5 plays through "was button 5"; the name was read first, through Spotify, then the play sent.
    f.calls.length = 0;
    const res = await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=5&device=Pro+Plus"), e);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}/wiim?kp=stuck&k=5&kon=pro-plus`);
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${P(5)}`);
    const read = f.calls.findIndex((c) => c === `GET /playlists/${P(5)}`);
    const play = f.calls.findIndex((c) => /\/me\/player\/play/.test(c));
    assert.ok(read >= 0 && play > read, `the name is read, then the play sent: ${f.calls.join(" | ")}`);
    // 1 plays through the guest; 10 through "was button 10 spotify", the Tidal alias of the same number set aside.
    await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=1&device=Pro+Plus"), e);
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${GS}`);
    await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=10&device=Pro+Plus"), e);
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${P(10)}`);
    // back=wiim is ignored: a key's Play never lands on the checklist.
    const b = await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=5&device=Pro+Plus&back=wiim"), e);
    assert.equal(b.headers.get("location"), `/buttons/${KEY}/wiim?kp=stuck&k=5&kon=pro-plus`);
    // No remembered room and no default: a key without its speaker is refused, not guessed.
    const sent = cap.bodies.length;
    const refused = async (body, status, words) => {
      const r = await worker.fetch(post(`/buttons/${KEY}/preset/play`, body), e);
      assert.equal(r.status, status, body);
      assert.match(await r.text(), words, body);
      assert.equal(cap.bodies.length, sent, `${body}: nothing was sent`);
    };
    await refused("btn=5", 400, /The preset keys belong to the speakers this house named \(Pro Plus, Ultra\); (?:&quot;|")(?:&quot;|") is not one of them/);
    await refused("btn=5&device=Kitchen", 400, /(?:&quot;|")Kitchen(?:&quot;|") is not one of them\. Nothing was played\./);
    await refused("btn=3&device=Pro+Plus", 400, /The Pro Plus holds Novato \(Prime\) on preset 3 — nothing this server can start[\s\S]*Press 3 on the remote\./);
    await refused("btn=2&device=Pro+Plus", 400, /holds DJ Guest · Tidal \(Tidal\) on preset 2/);
    await refused("btn=6&device=Pro+Plus", 400, new RegExp(`holds ${ARCHIVE.name} \\(Web stream\\) on preset 6`));
    await refused("btn=7&device=Pro+Plus", 400, /holds NPO 3FM \(WiiM radio\) on preset 7/);
    await refused("btn=8&device=Pro+Plus", 400, /holds Scratch on preset 8, but this house has no Spotify playlist on file for 8/);
    await refused("btn=9&device=Pro+Plus", 400, /has nothing saved on preset 9, as the speakers were last read/);
    await refused("btn=4&device=Pro+Plus", 409, /The Pro Plus calls preset 4 (?:&quot;|")Sunny(?:&quot;|"); the playlist on file for 4 is (?:&quot;|")Scratch(?:&quot;|")\. They no longer match/);
    await refused("btn=13&device=Pro+Plus", 404, /There is no preset with that number/);
    await refused("btn=5&device=Ultra", 400, /No phone has read the Ultra yet[\s\S]*Read the speakers first/);
    // The flash, parsed before it shows: a valid one draws C+ with the key's name, even with a re-save owed.
    const back = await page(e, b.headers.get("location"));
    assert.match(back, /<main class="page wall spknow tabbed"/);
    assert.match(back, /<\/header>\n  <p class="quietline" role="status">Spotify accepted it, but Scratch is not playing on the Pro Plus — the speaker may be asleep or on another input\. Press play on the device once, or tap the key again\.<\/p>/);
    // "ok" prints NOTHING (the owner, 2026-09-22) -- the block and the bar
    // show what is true -- but it still PARSES: with a re-save owed, an
    // unparsed query would fall to the checklist, and this lands on C+,
    // which is the carve-out that reads the player fresh the instant the
    // tap comes back. Same rule the Presets tab already has for its Play.
    const okBack = await page(e, `/buttons/${KEY}/wiim?kp=ok&k=5&kon=pro-plus`);
    assert.match(okBack, /<main class="page wall spknow tabbed"/, "ok still parses: C+, not the checklist");
    assert.ok(!okBack.includes('class="quietline"'), "and prints no line");
    assert.ok(!/Started Scratch/.test(okBack), "and never the old sentence");
    assert.match(await page(e, `/buttons/${KEY}/wiim?kp=asleep&k=5&kon=pro-plus`), /The Pro Plus has signed off Spotify after sitting idle[^<]*then tap the key again\./);
    assert.match(await page(e, `/buttons/${KEY}/wiim?kp=stuck&k=5&kon=pro-plus`), /class="page wall spknow[\s\S]*Spotify accepted it, but Scratch/, "a valid flash is said");
    // Forged or unknown, it is no flash at all.
    for (const q of ["kp=zzz&k=5&kon=pro-plus", "kp=stuck&k=8&kon=pro-plus", "kp=stuck&k=5&kon=kitchen", "kp=stuck&k=0&kon=pro-plus"]) {
      const h = await page(e, `/buttons/${KEY}/wiim?${q}`);
      assert.ok(!h.includes('class="quietline"'), `${q}: no flash`);
    }
  } finally { cap.restore(); f.restore(); }
});

test("a preset key's Play under Spotify's throttle sends nothing at all — not the name read, not the play; and a WiiM the play form may not name is refused after the gate", async () => {
  const f = installFetch({ contents: [track("a")] });
  const cap = playBodies();
  try {
    const e = KEYED();
    await readPro(e);
    await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 600000 }));
    f.calls.length = 0;
    const r = await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=5&device=Pro+Plus"), e);
    assert.equal(r.status, 503);
    assert.match(await r.text(), /Spotify is limiting this account/);
    assert.ok(!f.calls.some((c) => /\/playlists\//.test(c)), "no playlist read under a throttle");
    assert.equal(cap.bodies.length, 0, "no play under a throttle");
    // The Ultra is a WiiM with a reading, but not a room the play form may name here.
    const d = KEYED({ ROOM_DEVICES: JSON.stringify(["Pro Plus"]) });
    await d.PROGRAMS.put("reading:ultra", JSON.stringify({ at: new Date().toISOString(), speaker: "Ultra", presets: PRO_READ }));
    const u = await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=5&device=Ultra"), d);
    assert.equal(u.status, 400);
    assert.match(await u.text(), /(?:&quot;|")Ultra(?:&quot;|") is not one of the configured speakers \(Pro Plus\)\. Nothing was played\./);
    assert.equal(cap.bodies.length, 0);
  } finally { cap.restore(); f.restore(); }
});

test("the play forms (MC-19 stage 3b): a playable key is a form and nothing else, aimed at its own grid's speaker; every other key is a link; the block names a key's set, at render and from /playing", async () => {
  const f = installFetch({ contents: [track("a")] });
  const restore = playerOn("Pro Plus", P(5));
  try {
    const e = KEYED();
    await readPro(e);
    // The Ultra: 5 is the radio there, 8 is Spotify with nothing on file — so 5 plays on one grid and not the other.
    const ultraRead = PRO_READ.map((r) => r.btn === 5 ? { ...r, name: "NPO 3FM", source: "WiiM radio" } : r);
    await e.PROGRAMS.put("reading:ultra", JSON.stringify({ at: new Date().toISOString(), speaker: "Ultra", presets: ultraRead }));
    f.calls.length = 0;
    const html = await page(e, `/buttons/${KEY}/wiim`);
    assert.ok(!f.calls.some((c) => /\/playlists\//.test(c)), "drawing the forms reads no playlist");
    const pro = html.slice(html.indexOf('data-slug="pro-plus" aria-label'), html.indexOf('data-slug="ultra" aria-label'));
    const ultra = html.slice(html.indexOf('data-slug="ultra" aria-label'), html.indexOf('<footer class="roomfoot"'));
    // 1 (the guest), 4, 5 and 10 (legacy aliases) are forms on the Pro Plus; each carries its own speaker.
    const form = (n, name, device) => `<form method="post" action="/buttons/${KEY}/preset/play" class="kform"><input type="hidden" name="btn" value="${n}">` +
      `<input type="hidden" name="device" value="${device}"><button type="submit" class="key${n === 1 ? " fill" : ""}${n === 5 ? " dot lit" : ""} play" data-k="${n}" data-busy="Starting…" aria-label="Play ${name} on the ${device}"`;
    assert.ok(pro.includes(form(1, "Scratch", "Pro Plus")), "1, the guest: a form, filled");
    assert.ok(pro.includes(form(4, "Sunny", "Pro Plus")), "4: a form (the name check waits for the press)");
    assert.ok(pro.includes(form(5, "Scratch", "Pro Plus")), "5: a form, with the dot");
    assert.ok(pro.includes(form(10, "Scratch", "Pro Plus")), "10: a form through the Spotify alias");
    assert.equal((pro.match(/<form method="post"/g) ?? []).length, 4, "and no other key on the Pro Plus is one");
    // THE KEY THAT IS PLAYING (2026-09-27): 5, on the Pro Plus alone — the Ultra's 5 is the radio, and quiet.
    assert.equal((pro.match(/class="key[^"]*\blit\b/g) ?? []).length, 1, "one key lit, the one playing");
    // Every other key is a link, as before: Prime, Tidal, the archive, the radio, Spotify with nothing on file, nothing saved.
    for (const n of [2, 3, 6, 7, 8, 9, 11, 12]) {
      assert.ok(pro.includes(`href="/buttons/${KEY}/readings#p${n}"`), `${n} links to the readings`);
    }
    assert.ok(!pro.includes('<a class="key" data-k="5" href="/buttons/' + KEY + '/readings#p5"'), "5 has no link: one job");
    // The Ultra's grid: 5 is a link there, and its forms name the Ultra.
    assert.ok(ultra.includes(`<a class="key dot" data-k="5" href="/buttons/${KEY}/readings#p5" title="Held differently on the Pro Plus"><span class="knum">5</span><span class="kname">NPO 3FM</span>`), "5 on the Ultra is the radio: a link");
    assert.ok(ultra.includes(form(1, "Scratch", "Ultra")), "the Ultra's 1 is aimed at the Ultra");
    assert.equal((ultra.match(/<form method="post"/g) ?? []).length, 3);
    assert.ok(!/class="key[^"]*\blit\b/.test(ultra), "the Ultra is not playing: none of its keys is lit");
    // The double-tap guard is on the page now that it has forms; the glyph is decorative.
    assert.match(html, /<script[^>]*>\ndocument\.addEventListener\("submit"/, "the guard, with the page's nonce on it");
    assert.match(html, /<span class="kplay" aria-hidden="true">/);
    // THE BLOCK NAMES A KEY'S SET: the Pro Plus plays "was button 5", which its reading holds as 5 (Scratch).
    assert.match(html, /<button type="button" class="sblock on pick" data-speaker="Pro Plus"[\s\S]*?From preset 5 \(Scratch\)<\/span>/);
    // And /playing says the same in its own field, leaving btn — a band — alone.
    const now = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.equal(now.btn, null, "a legacy key is no band: the presets page's poll must not light one");
    assert.deepEqual(now.speakerPreset, { btn: 5, name: "Scratch" });
    assert.equal(now.from, undefined === now.from ? undefined : now.from);
    assert.match(html, /o\.speakerPreset \? \(o\.speakerPreset\.autoplay \? "Spotify's pick, after preset " : "From preset "\) \+ o\.speakerPreset\.btn/, "the poll draws it from that field");
  } finally { restore(); f.restore(); }
  // A WiiM the play form may not name: its grid is drawn, every key a link.
  const f2 = installFetch({ contents: [track("a")] });
  const restore2 = playerOn(null);
  try {
    const d = KEYED({ ROOM_DEVICES: JSON.stringify(["Pro Plus"]) });
    await readPro(d);
    await d.PROGRAMS.put("reading:ultra", JSON.stringify({ at: new Date().toISOString(), speaker: "Ultra", presets: PRO_READ }));
    const html = await page(d, `/buttons/${KEY}/wiim`);
    const ultra = html.slice(html.indexOf('data-slug="ultra" aria-label'), html.indexOf('<footer class="roomfoot"'));
    assert.ok(!ultra.includes("<form"), "not a room the play form may name: no forms");
    assert.ok(ultra.includes(`<a class="key fill" data-k="1" href="/buttons/${KEY}/readings#p1">`), "but its keys, as links");
    const pro = html.slice(html.indexOf('data-slug="pro-plus" aria-label'), html.indexOf('data-slug="ultra" aria-label'));
    assert.equal((pro.match(/<form method="post"/g) ?? []).length, 4, "the Pro Plus's are forms");
  } finally { restore2(); f2.restore(); }
});

test("the Loaded tab names a key's set the way the Speakers tab does, in the now bar", async () => {
  const f = installFetch({ contents: [track("a")] });
  const restore = playerOn("Pro Plus", P(5));
  try {
    const e = KEYED();
    await readPro(e);
    const html = await page(e, `/buttons/${KEY}`);
    // The now bar says it; since 2026-09-24 no line above the wall repeats it (the owner).
    assert.match(html, /Pro Plus · preset 5, Scratch/);
    assert.ok(!html.includes('id="nowline"'), "one sentence, not two");
    // No band lights: a legacy key is not a band, and /playing's btn stays null for it.
    assert.ok(!/<li class="band[^"]*\bplaying\b/.test(html), "no band lit");
  } finally { restore(); f.restore(); }
});

// PAUSE AND PLAY ON THE SPEAKER BLOCK (MC-20, tasks/done/mc20-speaker-pause.md).
function playerHeld(device, pid, { paused = false } = {}) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (new URL(String(u)).pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      if (!device) return new Response(null, { status: 204 });
      return Response.json({ is_playing: !paused, device: { name: device, id: "device-1" }, context: { uri: `spotify:playlist:${pid}` },
        item: { name: "Cold Sweat", uri: "spotify:track:cs", artists: [{ name: "James Brown" }] } });
    }
    return inner(u, init);
  };
  return () => { globalThis.fetch = inner; };
}
const DISC = (device, verb) => `<form method="post" action="/buttons/${KEY}/wiim/transport" class="sdiscf"><input type="hidden" name="do" value="${verb}">` +
  `<input type="hidden" name="device" value="${device}"><button type="submit" class="sdisc" aria-label="${verb === "play" ? `Play the ${device} again` : `Pause the ${device}`}">`;

test("the now bar (MC-21) on the Speakers page is filled at paint, in the route's own words, and asks Spotify nothing extra", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Pro Plus", P(5));
  try {
    const e = KEYED();
    await readPro(e);
    // PLAYING, on a key of the speaker's own: the bar names the record and
    // the preset, and carries no data-fill — this page read the player to
    // draw its blocks, so the bar has the answer already and the script has
    // nothing to fetch. A skeleton here would flash a placeholder and then
    // spend a second player read on one view.
    const html = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(html, new RegExp(`<div class="nowbar" data-nowbar data-now="/buttons/${KEY}/playing\\?fresh=1" data-base="/buttons/${KEY}" data-o="[^"]+">`), "filled, not a skeleton, and the answer kept for the pick");
    // The record's door is in the panel now; the answer carries it.
    assert.match(html, /data-o="[^"]*https:\/\/open\.spotify\.com\/track\/cs/);
    assert.ok(!/<div class="nowbar[^>]*data-fill/.test(html), "and nothing for the script to fetch");
    assert.match(html, /window\.__nowbar = paint;/, "but the script is here for the page's own poll to hand answers to");
    assert.match(html, /<span class="nb1">Cold Sweat · James Brown<\/span>/);
    assert.match(html, /<span class="nb2">Pro Plus · preset 5, Scratch<\/span>/);
    // THE DISC (MC-21), live and aimed at the speaker the bar names.
    assert.ok(html.includes(`<button type="button" class="nbdisc" data-pause="/buttons/${KEY}/wiim/transport" data-device="Pro Plus" data-do="pause" aria-label="Pause the Pro Plus">`),
      "the bar's pause, aimed at the Pro Plus");
    // A SESSION SPOTIFY HAS PAUSED draws as quiet (2026-09-22, the owner's
    // choice after tasks/done/stale-pause-codex-review.md): it says nothing about
    // the speaker, which may be on Tidal, the radio or the archive since.
    restore(); restore = playerHeld("Pro Plus", P(5), { paused: true });
    const paused = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(paused, /<div class="nowbar off" data-nowbar data-now="[^"]+" data-base="[^"]+" data-o="[^"]+">/);
    assert.match(paused, /<span class="nb1">Not on Spotify<\/span>/);
    assert.match(paused, /class="nbdisc" [^>]*data-device="" data-do="pause" aria-label="Nothing here to pause" disabled>/, "dimmed, never gone");
    assert.ok(!/paused/i.test(paused.replace(/<script[\s\S]*?<\/script>/g, "")), "the word never reaches the page");
    // QUIET is not "nothing playing": the bar says what Spotify cannot see,
    // and goes to the flat tone rather than leaving the screen.
    restore(); restore = playerHeld(null);
    const quiet = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(quiet, /<div class="nowbar off" data-nowbar data-now="[^"]+" data-base="[^"]+" data-o="[^"]+">/);
    assert.match(quiet, /class="nbdisc" [^>]*aria-label="Nothing here to pause" disabled>/);
    assert.match(quiet, /<span class="nb1">Not on Spotify<\/span>/);
    assert.match(quiet, /<span class="nb2">Quiet, or Tidal, the radio or the archive — only the speaker knows<\/span>/);
  } finally { restore(); f.restore(); }
});

test("no disc on the block (MC-21): the pause is the now bar's; a paused session draws as quiet and dims it; a WiiM the form may not name dims it; no play, no tick anywhere", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Pro Plus", P(5));
  const BAR_DISC = (d) => `class="nbdisc" data-pause="/buttons/${KEY}/wiim/transport" data-device="${d}" data-do="pause" aria-label="Pause the ${d}">`;
  const DIMMED = /class="nbdisc" [^>]*data-device="" data-do="pause" aria-label="Nothing here to pause" disabled>/;
  try {
    const e = KEYED();
    await readPro(e);
    const html = await page(e, `/buttons/${KEY}/wiim`);
    assert.ok(!html.includes('class="stick"'), "no tick");
    assert.ok(!/sdisc/.test(html), "no disc on any block, and no rule for one");
    assert.match(html, /<div class="sblockwrap on pick" data-wrap="pro-plus">\n    <button type="button" class="sblock on pick" data-speaker="Pro Plus"/);
    assert.ok(html.includes(BAR_DISC("Pro Plus")), "the pause is on the bar, aimed at the playing speaker");
    assert.match(html, /From preset 5 \(Scratch\)<\/span>/);
    // Paused in Spotify: the block draws as QUIET and the bar's disc dims.
    // Spotify still lists the speaker as active and holds the track, and
    // none of that says what the speaker is doing -- the owner pressed a
    // Tidal preset and Spotify kept saying "paused on preset 8".
    restore(); restore = playerHeld("Pro Plus", P(5), { paused: true });
    const paused = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(paused, /<div class="sblockwrap pick" data-wrap="pro-plus">\n    <button type="button" class="sblock pick" data-speaker="Pro Plus"[\s\S]*?Not on Spotify<\/span>/);
    assert.ok(!paused.includes('class="snow"'), "no track line: the page does not know what the speaker is playing");
    assert.ok(!/class="sblock(wrap)? [^"]*paused/.test(paused), "no .paused anywhere");
    assert.ok(!paused.includes('value="play"'), "no play verb anywhere");
    assert.ok(!/class="sblock on/.test(paused), "paused is not playing: no bars");
    assert.match(paused, DIMMED, "the bar's disc dims");
    restore(); restore = playerHeld(null);
    const quiet = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(quiet, DIMMED, "quiet: dimmed, never absent");
    // The stylesheet and the poll carry no play and no paused at all.
    // (The bar's play-again disc reads a pause the BAR sent, `o.paused` — a
    // different thing, tested below — and carries no .paused class.)
    const css = (quiet.match(/<style>[\s\S]*?<\/style>/g) ?? []).join("");
    assert.ok(!/gplay|\.paused/.test(css), "no play glyph, no .paused rule");
    assert.ok(!quiet.includes("nbdisc again"), "and no play-again without a pause the bar sent");
    assert.ok(!/var paused =|"paused"/.test(quiet), "the poll never draws a paused state");
    // The flashes, parsed before they show; ok prints nothing.
    // A flash for a play, or for the codes only a play produced, is ignored.
    for (const q of ["tp=asleep&tdo=play&ton=pro-plus", "tp=gone&tdo=play&ton=pro-plus", "tp=ok&tdo=play&ton=pro-plus"]) {
      assert.ok(!/class="quietline"/.test(await page(e, `/buttons/${KEY}/wiim?${q}`)), `${q}: nothing printed`);
    }
    assert.match(await page(e, `/buttons/${KEY}/wiim?tp=failed&tdo=pause&ton=pro-plus`), /Spotify refused to pause the Pro Plus\./);
    assert.match(await page(e, `/buttons/${KEY}/wiim?tp=gone&tdo=pause&ton=pro-plus`), /Spotify is not playing on the Pro Plus any more, so nothing was paused\./);
    assert.ok(!(await page(e, `/buttons/${KEY}/wiim?tp=ok&tdo=pause&ton=pro-plus`)).includes('class="quietline"'), "ok says nothing");
    for (const q of ["tp=zzz&tdo=pause&ton=pro-plus", "tp=ok&tdo=stop&ton=pro-plus", "tp=ok&tdo=pause&ton=kitchen"]) {
      assert.ok(!(await page(e, `/buttons/${KEY}/wiim?${q}`)).includes('class="quietline"'), `${q}: no flash`);
    }
    // A WiiM the play form may not name: playing, and the disc still dims,
    // because the route would refuse it.
    const d = KEYED({ ROOM_DEVICES: JSON.stringify(["Ultra"]) });
    restore(); restore = playerHeld("Pro Plus", P(5));
    const noRoom = await page(d, `/buttons/${KEY}/wiim`);
    assert.match(noRoom, /<div class="sblockwrap on pick" data-wrap="pro-plus">[\s\S]*?data-room="0"/);
    assert.match(noRoom, /<span class="nb1">Cold Sweat · James Brown<\/span>/, "the bar still says what is playing");
    assert.match(noRoom, DIMMED, "but offers no pause the route would refuse");
  } finally { restore(); f.restore(); }
});

test("back from a pause Spotify accepted, the paused speaker draws quiet even if the read still says playing (2026-09-22, measured in the room); only that speaker; and the page re-checks at three seconds", async () => {
  const f = installFetch({ contents: [track("a")] });
  // Spotify still says PLAYING on the Pro Plus: the lag the phone lands
  // inside. The landing must not believe it about the speaker it just paused.
  let restore = playerHeld("Pro Plus", P(5));
  try {
    const e = KEYED();
    await readPro(e);
    const back = await page(e, `/buttons/${KEY}/wiim?tp=ok&tdo=pause&ton=pro-plus`);
    assert.match(back, /<main class="page wall spknow tabbed"[^>]* data-paused="pro-plus"/, "marked for the early re-check");
    assert.match(back, /data-speaker="Pro Plus"[\s\S]*?<span class="seyebrow">[\s\S]*?<\/span>Not on Spotify<\/span>/, "drawn quiet from the acceptance");
    assert.ok(!back.includes('class="snow"'), "no scrolling track");
    assert.ok(!/class="sdiscf">/.test(back), "no disc shown");
    assert.match(back, /<span class="nb1">Not on Spotify<\/span>/, "and the bar agrees");
    assert.match(back, /if \(main\.hasAttribute\("data-paused"\)\) setTimeout\(function \(\) \{ touched = Date\.now\(\); ask\(\); \}, 3000\);/, "the early re-check");
    // The same read on a plain landing is still believed: nothing was paused.
    const plain = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(plain, /data-speaker="Pro Plus"[\s\S]*?Playing now · Spotify/);
    // The attribute on <main>, not the word: the poll script names it on every page.
    assert.ok(!/<main class="page wall spknow tabbed"[^>]* data-paused=/.test(plain), "no mark, no early re-check");
    // ONLY the paused speaker: Spotify playing on the Ultra after a pause of
    // the Pro Plus is still said, on the Ultra.
    restore(); restore = playerHeld("Ultra", P(5));
    const other = await page(e, `/buttons/${KEY}/wiim?tp=ok&tdo=pause&ton=pro-plus`);
    assert.match(other, /data-speaker="Ultra"[\s\S]*?Playing now · Spotify/, "the Ultra is still playing");
    assert.match(other, /data-speaker="Pro Plus"[\s\S]*?Not on Spotify/, "the Pro Plus quiet");
    // A failed pause draws what the read says: nothing was accepted.
    restore(); restore = playerHeld("Pro Plus", P(5));
    const failed = await page(e, `/buttons/${KEY}/wiim?tp=failed&tdo=pause&ton=pro-plus`);
    assert.match(failed, /data-speaker="Pro Plus"[\s\S]*?Playing now · Spotify/, "still playing: the pause was refused");
    assert.ok(!/<main class="page wall spknow tabbed"[^>]* data-paused=/.test(failed), "a refused pause leaves no mark");
  } finally { restore(); f.restore(); }
});

test("the transport route (MC-20, MC-21): a pause names its device, and only a speaker Spotify is playing on; play is refused; refused in words otherwise", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Pro Plus", P(5));
  // What the pause was sent with: the device matters, not only the verb.
  const inner0 = globalThis.fetch;
  const pauses = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/pause" && init.method === "PUT") pauses.push(url.searchParams.get("device_id"));
    return inner0(u, init);
  };
  try {
    const e = KEYED();
    f.calls.length = 0;
    const paused = await worker.fetch(post(`/buttons/${KEY}/wiim/transport`, "do=pause&device=Pro+Plus"), e);
    assert.equal(paused.status, 303);
    assert.equal(paused.headers.get("location"), `/buttons/${KEY}/wiim?tp=ok&tdo=pause&ton=pro-plus`);
    assert.deepEqual(pauses, ["device-1"], "the pause names the device Spotify is playing on");
    // THE BAR MAY BE MINUTES OLD: a pause for the Ultra while Spotify plays
    // on the Pro Plus sends nothing, and says so.
    pauses.length = 0;
    const d2 = KEYED({ ROOM_DEVICES: JSON.stringify(["Pro Plus", "Ultra"]) });
    const wrong = await worker.fetch(post(`/buttons/${KEY}/wiim/transport`, "do=pause&device=Ultra"), d2);
    assert.equal(wrong.headers.get("location"), `/buttons/${KEY}/wiim?tp=gone&tdo=pause&ton=ultra`);
    assert.deepEqual(pauses, [], "nothing paused on a speaker Spotify is not playing on");
    // Nor on a session Spotify has already paused.
    restore(); restore = playerHeld("Pro Plus", P(5), { paused: true });
    const idle = await worker.fetch(post(`/buttons/${KEY}/wiim/transport`, "do=pause&device=Pro+Plus"), e);
    assert.equal(idle.headers.get("location"), `/buttons/${KEY}/wiim?tp=gone&tdo=pause&ton=pro-plus`);
    assert.deepEqual(pauses, []);
    restore(); restore = playerHeld("Pro Plus", P(5));
    // PLAY IS GONE (2026-09-22). It resumed Spotify on the named speaker,
    // which on a speaker that had moved to Tidal would take the room away
    // from Tidal and call it un-pausing. Refused, and nothing is sent.
    f.calls.length = 0;
    const played = await worker.fetch(post(`/buttons/${KEY}/wiim/transport`, "do=play&device=Pro+Plus"), e);
    assert.equal(played.status, 400);
    assert.match(await played.text(), /The form must say pause\./);
    assert.ok(!f.calls.some((c) => /me\/player/.test(c)), "nothing sent for a play");
    // Refusals, with nothing sent.
    const refused = async (body, status, words, req = post(`/buttons/${KEY}/wiim/transport`, body)) => {
      f.calls.length = 0; pauses.length = 0;
      const r = await worker.fetch(req, e);
      assert.equal(r.status, status, body);
      assert.match(await r.text(), words, body);
      assert.ok(!f.calls.some((c) => /me\/player/.test(c)) && !pauses.length, `${body}: nothing sent`);
    };
    await refused("do=pause&device=Kitchen", 400, /(?:&quot;|")Kitchen(?:&quot;|") is not one of them\. Nothing was sent\./);
    await refused("do=stop&device=Pro+Plus", 400, /The form must say pause\./);
    await refused("", 405, /takes a POST/, get(`/buttons/${KEY}/wiim/transport`));
    await refused("do=pause&device=Pro+Plus", 403, /sent from https:\/\/evil\.test/, new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.test" }, body: "do=pause&device=Pro+Plus" }));
    const d = KEYED({ ROOM_DEVICES: JSON.stringify(["Ultra"]) });
    const r = await worker.fetch(post(`/buttons/${KEY}/wiim/transport`, "do=pause&device=Pro+Plus"), d);
    assert.equal(r.status, 400);
    assert.match(await r.text(), /(?:&quot;|")Pro Plus(?:&quot;|") is not one of the configured speakers \(Ultra\)\. Nothing was sent\./);
    await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 600000 }));
    await refused("do=pause&device=Pro+Plus", 503, /Spotify is limiting this account/);
    await e.PROGRAMS.delete("spotify:throttled");
    // Spotify answers the pause 404 (it let go between the read and the
    // pause): "gone". Anything else it refuses: "failed", said in words.
    const inner = globalThis.fetch;
    for (const [status, code] of [[404, "gone"], [500, "failed"]]) {
      globalThis.fetch = async (u, init = {}) => {
        if (new URL(String(u)).pathname === "/v1/me/player/pause" && init.method === "PUT") return new Response("no", { status });
        return inner(u, init);
      };
      try {
        const res = await worker.fetch(post(`/buttons/${KEY}/wiim/transport`, "do=pause&device=Pro+Plus"), e);
        assert.equal(res.headers.get("location"), `/buttons/${KEY}/wiim?tp=${code}&tdo=pause&ton=pro-plus`, String(status));
      } finally { globalThis.fetch = inner; }
    }
    assert.match(await page(e, `/buttons/${KEY}/wiim?tp=failed&tdo=pause&ton=pro-plus`),
      /<p class="quietline" role="status">Spotify refused to pause the Pro Plus\. It is playing whatever it was\./);
  } finally { globalThis.fetch = inner0; restore(); f.restore(); }
});

test("the transport route's JSON answer (MC-21): the bar's press stays on its page; every refusal is JSON too; the JSON path wants its own Origin", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Pro Plus", P(5));
  const ask = (e, body, headers = {}) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json",
      origin: "https://x.test", ...headers } }), e);
  const json = async (res, status, want) => {
    assert.equal(res.status, status);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const o = await res.json();
    assert.equal(o.code, want);
    return o;
  };
  try {
    const e = KEYED();
    const ok = await json(await ask(e, "do=pause&device=Pro+Plus"), 200, "ok");
    assert.equal(ok.ok, true);
    assert.equal((await json(await ask(e, "do=pause&device=Kitchen"), 400, "device")).ok, false);
    await json(await ask(e, "do=play&device=Pro+Plus"), 400, "verb");
    // Missing or foreign Origin: the form path takes a missing one, the
    // JSON path does not — only our own page's fetch reaches it.
    await json(await ask(e, "do=pause&device=Pro+Plus", { origin: "https://evil.test" }), 403, "origin");
    const bare = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", body: "do=pause&device=Pro+Plus",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" } }), e);
    await json(bare, 403, "origin");
    await json(await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      headers: { accept: "application/json" } }), e), 405, "method");
    await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 600000 }));
    await json(await ask(e, "do=pause&device=Pro+Plus"), 503, "throttled");
    await e.PROGRAMS.delete("spotify:throttled");
    restore(); restore = playerHeld(null);
    await json(await ask(e, "do=pause&device=Pro+Plus"), 200, "gone");
  } finally { restore(); f.restore(); }
});

// ANOTHER SPOTIFY SPEAKER (the owner, 2026-09-23, playing a set on the
// Master Bedroom Echo): the bar speaks for any speaker the play form may
// name, and the Speakers page gives the one in use a block of its own, with
// no keys. Spotify reads an Echo exactly as it reads a WiiM, so none of this
// costs a call.
test("an Echo in use gets a block on the Speakers page, the bar speaks for it and pauses it, and it goes when it is not in use", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Master Bedroom", GS);
  const inner0 = globalThis.fetch;
  const pauses = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player/pause" && init.method === "PUT") pauses.push(url.searchParams.get("device_id"));
    return inner0(u, init);
  };
  const ROOMS = JSON.stringify(["Pro Plus", "Ultra", "Master Bedroom", "Dining Room"]);
  const ask = (e, body) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json",
      origin: "https://x.test" } }), e);
  try {
    const e = KEYED({ ROOM_DEVICES: ROOMS });
    await readPro(e);
    // /playing names the other speakers, and the Echo is pausable.
    const got = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.deepEqual(got.others, [{ name: "Master Bedroom", slug: "master-bedroom" }, { name: "Dining Room", slug: "dining-room" }]);
    assert.equal(got.pausable, "Master Bedroom");
    // PLAYING ON THE ECHO: a block of its own, picked for playing (rule 1),
    // and no "not one of these speakers" line any more.
    const html = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(html, /data-live="master-bedroom"/);
    assert.match(html, /<button type="button" class="sblock on pick" data-speaker="Master Bedroom" data-slug="master-bedroom" data-room="1" data-other aria-pressed="true"/);
    assert.ok(!html.includes('data-speaker="Dining Room"'), "only the speaker in use, not every room");
    assert.ok(!html.includes('class="elsewhere"'));
    assert.match(html, /<section class="holds" data-slug="master-bedroom" aria-label="The Master Bedroom">\s*<p class="unread">The Master Bedroom is not a WiiM, so it has no presets here\./);
    assert.match(html, /<section class="holds" data-slug="pro-plus"[^>]* hidden>/, "the Pro Plus's keys are hidden while the Echo is picked");
    assert.match(html, /<span class="nb1">Cold Sweat · James Brown<\/span>/);
    assert.match(html, /<span class="nb2">Master Bedroom · preset 1, DJ Guest<\/span>/);
    assert.ok(html.includes(`data-device="Master Bedroom" data-do="pause" aria-label="Pause the Master Bedroom">`), "the bar can pause it");
    // THE PAUSE: named for the Echo, and its note keeps the block on the page.
    const a = await (await ask(e, "do=pause&device=Master+Bedroom")).json();
    assert.equal(a.code, "ok");
    assert.deepEqual(pauses, ["device-1"]);
    assert.equal(a.paused.again, true, "and it may be played again there");
    restore(); restore = playerHeld(null);
    const held = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(held, /data-speaker="Master Bedroom"[^>]*data-other[\s\S]*?Paused · Spotify/);
    // QUIET, NO NOTE: the block is gone.
    const e2 = KEYED({ ROOM_DEVICES: ROOMS });
    assert.ok(!(await page(e2, `/buttons/${KEY}/wiim`)).includes('data-speaker="Master Bedroom"'), "no block for a quiet Echo");
    // Spotify on a speaker the form may not name: the old line, no block.
    restore(); restore = playerHeld("Kitchen", GS);
    const kitchen = await page(e2, `/buttons/${KEY}/wiim`);
    assert.ok(!kitchen.includes('data-speaker="Kitchen"'));
    assert.match(kitchen, /Spotify is playing on Kitchen, which is not one of these speakers\./);
    assert.equal((await (await ask(e2, "do=pause&device=Kitchen")).json()).code, "device");
  } finally { globalThis.fetch = inner0; restore(); f.restore(); }
});

test("the bar's words for a quiet speaker that is not a WiiM", () => {
  assert.deepEqual(barWords({ state: "quiet", speaker: "Master Bedroom", other: true }), { tone: "off",
    one: "Master Bedroom · Not on Spotify", two: "Quiet, or playing something that is not Spotify" });
  assert.equal(barWords({ state: "quiet", speaker: "Master Bedroom", other: true, elsewhere: "Pro Plus" }).two,
    "Spotify is playing on the Pro Plus");
});

test("the bar's pause remembers what it stopped (the owner, 2026-09-22): the bar says it, with its time, and plays it again from there — a fresh start, never Spotify's resume", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Pro Plus", P(5));
  const ask = (e, body) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json",
      origin: "https://x.test" } }), e);
  let cap = null;
  try {
    const e = KEYED();
    await readPro(e);
    // The pause answers with what the bar now says.
    const a = await (await ask(e, "do=pause&device=Pro+Plus")).json();
    assert.equal(a.code, "ok");
    assert.equal(a.paused.track, "Cold Sweat");
    assert.equal(a.paused.device, "Pro Plus");
    assert.deepEqual(a.paused.preset, { btn: 5, name: "Scratch" });
    assert.equal(a.paused.again, true);
    // Quiet afterwards: /playing and the page's own bar both carry it.
    restore(); restore = playerHeld(null);
    const now = await (await worker.fetch(get(`/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.equal(now.state, "quiet");
    assert.equal(now.paused.track, "Cold Sweat");
    const html = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(html, /<span class="nb1">Paused · Cold Sweat<\/span>/, "no clock time");
    assert.match(html, /<span class="nb2">Pro Plus · preset 5, Scratch<\/span>/);
    assert.match(html, /class="nbdisc again" [^>]*data-device="Pro Plus" data-do="again" aria-label="Play it again on the Pro Plus">/);
    // And on the speaker's own block (2026-09-23): the same note, no bars, no control.
    assert.match(html, /data-speaker="Pro Plus"[\s\S]*?<span class="seyebrow">[\s\S]*?<\/span>Paused · Spotify<\/span>[\s\S]*?aria-label="Paused: Cold Sweat — James Brown"[\s\S]*?<span class="smeta">From preset 5 \(Scratch\)<\/span>/);
    assert.ok(!/class="sblock on/.test(html), "paused is not playing: no level bars");
    assert.match(html, /data-speaker="Ultra"[\s\S]*?Not on Spotify<\/span>/, "the other speaker stays quiet");
    // Not by a plain form: only the bar's script plays again.
    const form = await worker.fetch(post(`/buttons/${KEY}/wiim/transport`, "do=again&device=Pro+Plus"), e);
    assert.equal(form.status, 400);
    // PLAY AGAIN: the set's own playlist, from the track the pause stopped,
    // on the speaker it named — what tapping the key does, from a point.
    restore(); restore = playerHeld("Pro Plus", P(5));
    cap = playBodies();
    const b = await (await ask(e, "do=again&device=Pro+Plus")).json();
    assert.equal(b.code, "ok");
    assert.deepEqual(cap.bodies[0], { context_uri: `spotify:playlist:${P(5)}`, offset: { uri: "spotify:track:cs" }, position_ms: 0 });
    assert.equal(e.PROGRAMS.store.get("pause:last"), undefined, "played again: the note is done");
    // Nothing written down, nothing to play: said, and nothing sent.
    cap.bodies.length = 0;
    assert.equal((await (await ask(e, "do=again&device=Pro+Plus")).json()).code, "expired");
    assert.equal(cap.bodies.length, 0);
    // A note for the other speaker plays nothing here either.
    await e.PROGRAMS.put("pause:last", JSON.stringify({ at: Date.now(), device: "Ultra", pid: P(5), uri: "spotify:track:cs" }));
    assert.equal((await (await ask(e, "do=again&device=Pro+Plus")).json()).code, "expired");
    assert.equal(cap.bodies.length, 0);
  } finally { cap?.restore(); restore(); f.restore(); }
});

test("the pause note ends when Spotify is seen playing anything, but not on the second of lag after the pause", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Pro Plus", P(5));
  try {
    const e = KEYED();
    const note = (at) => e.PROGRAMS.put("pause:last", JSON.stringify({ at, device: "Pro Plus", track: "Cold Sweat",
      uri: "spotify:track:cs", pid: P(5), positionMs: 0 }));
    // Moments after the pause, Spotify still reporting the same record on
    // the same speaker is its lag: the note stays.
    await note(Date.now() - 2000);
    await worker.fetch(get(`/buttons/${KEY}/playing?fresh=1`), e);
    assert.ok(e.PROGRAMS.store.get("pause:last"), "kept through the lag");
    // Later, playing is playing: the note is dropped.
    await note(Date.now() - 60_000);
    await worker.fetch(get(`/buttons/${KEY}/playing?fresh=1`), e);
    assert.equal(e.PROGRAMS.store.get("pause:last"), undefined);
    // And an hour on, a quiet room shows none.
    await note(Date.now() - 61 * 60_000);
    restore(); restore = playerHeld(null);
    const q = await (await worker.fetch(get(`/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.equal(q.paused, undefined);
  } finally { restore(); f.restore(); }
});

test("the bar speaks for one speaker (2026-09-23): quiet is said of that speaker, and Spotify elsewhere is named", () => {
  assert.deepEqual(barWords({ state: "quiet", speaker: "Pro Plus" }), { tone: "off",
    one: "Pro Plus · Not on Spotify", two: "Tidal, the radio or the archive — only the speaker knows" });
  assert.deepEqual(barWords({ state: "quiet", speaker: "Pro Plus", elsewhere: "Ultra" }), { tone: "off",
    one: "Pro Plus · Not on Spotify", two: "Spotify is playing on the Ultra" });
  // No speaker named: the house-wide words, as before.
  assert.equal(barWords({ state: "quiet" }).one, "Not on Spotify");
});

test("/playing?fresh=1 reads past the memo, and names what the bar may pause", async () => {
  const f = installFetch({ contents: [track("a")] });
  let restore = playerHeld("Pro Plus", P(5));
  try {
    const e = KEYED();
    await readPro(e);
    await page(e, `/buttons/${KEY}`); // the wall seeds the memo
    const now = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.equal(now.pausable, "Pro Plus");
    restore(); restore = playerHeld(null);
    const memo = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.equal(memo.state, "playing", "the memo still says playing");
    const fresh = await (await worker.fetch(get(`/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.equal(fresh.state, "quiet", "fresh reads Spotify again");
  } finally { restore(); f.restore(); }
});

test("/playing says QUIET for a session Spotify has paused (2026-09-22); the presets page lights nothing; the Speakers page draws it quiet through the memo", async () => {
  const f = installFetch({ contents: [track("a")] });
  const restore = playerHeld("Pro Plus", P(5), { paused: true });
  try {
    const e = KEYED();
    await readPro(e);
    // Not "paused": that word claimed the speaker was idle, and Spotify's
    // paused session survives the speaker moving to Tidal from the remote.
    const now = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.equal(now.state, "quiet");
    assert.ok(!("track" in now) && !("device" in now) && !("preset" in now), "and nothing about the session");
    // The presets page: no band lit, no line over the wall — a paused set is not playing there.
    const wall = await page(e, `/buttons/${KEY}`);
    assert.ok(!/<li class="band[^"]*\bplaying\b/.test(wall), "no band lit");
    assert.ok(!wall.includes('id="nowline"'), "no line");
    // The Speakers page right after it reads the memo -- the raw read -- and draws it quiet too.
    const spk = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(spk, /class="sblock pick" data-speaker="Pro Plus"[\s\S]*?Not on Spotify/, "quiet through the memo");
    assert.ok(!/paused/.test(spk.replace(/<script[\s\S]*?<\/script>/g, "")), "and never the word");
  } finally { restore(); f.restore(); }
});

test("/playing names a live guest's band by its number, and a quick player lights it in the page", async () => {
  const f = installFetch({ contents: [track("cs")] });
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (new URL(String(u)).pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return Response.json({ is_playing: true, device: { name: "Pro Plus" }, context: { uri: `spotify:playlist:${GS}` },
        item: { name: "Cold Sweat", uri: "spotify:track:cs", artists: [{ name: "James Brown" }] } });
    }
    return inner(u, init);
  };
  try {
    const e = flipEnv();
    const got = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    // Every answer names the speakers, for the bar's pick (2026-09-23).
    assert.deepEqual(got.speakers.map((x) => x.name), ["Pro Plus", "Ultra"]);
    delete got.speakers;
    // And the house's other Spotify speakers, for a pick that is not a WiiM.
    assert.deepEqual(got.others, []);
    delete got.others;
    // And the Tidal guest's door, for the panel when Spotify is quiet (2026-09-24).
    assert.deepEqual(got.tidal, { name: "DJ Guest · Tidal", url: "https://listen.tidal.com/playlist/0b1f2c3d-aaaa-bbbb-cccc-000000000002" });
    delete got.tidal;
    // The one speaker (MC-28): nothing chosen, so where the music is.
    assert.deepEqual(got.pick, { name: "Pro Plus", slug: "pro-plus", why: "music" });
    delete got.pick;
    assert.deepEqual(got,
      { state: "playing", dj: null, btn: 1, guest: true,
        // MC-21: one preset field carrying the NAME too, so a page that knows
        // nothing of the roster — the now bar, on every tab — can print
        // "preset 1, DJ Guest" without reassembling it from a DJ key.
        preset: { btn: 1, name: "DJ Guest" }, track: "Cold Sweat", artists: "James Brown",
        device: "Pro Plus", live: "Pro Plus", pausable: "Pro Plus", song: "https://open.spotify.com/track/cs",
        list: "https://open.spotify.com/playlist/GUESTSPOTIFY0000000001" });
    assert.equal((await (await worker.fetch(get(`/buttons/${KEY}/playing`), darkEnv())).json()).btn, null,
      "a dark guest lights nothing");
    const one = bandOf(await page(e, `/buttons/${KEY}`), 1);
    assert.match(one, /^<li class="band fixed guest live tall playing" data-btn="1"/);
    assert.match(one, /aria-label="Playing now: Cold Sweat — James Brown"/);
    assert.match(one, /aria-label="Pause DJ Guest"/);
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("a page left open learns a guest took a newer set: the page and /playing read the same time, and a newer put moves it", async () => {
  const f = installFetch({ contents: [track("a"), track("b")] });
  try {
    const e = flipEnv();
    const at = minutesAgo(5);
    await putOn(e, GS, { dj: "hank", ref: "deep-cuts", at,
      program: { slug: "deep-cuts", by: HANK, title: "Deep cuts for a Sunday" } });
    const html = await page(e, `/buttons/${KEY}`);
    const drawn = Number(html.match(/data-guests-at="(\d+)"/)?.[1]);
    assert.equal(drawn, Date.parse(at), "the page carries the newest set's time");
    assert.equal((await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json()).guestsAt, drawn,
      "and /playing says the same, so a page left open does not reload for nothing");
    const later = minutesAgo(1);
    await putOn(e, GT, { dj: "dr-funkenstein", ref: "request r-1", at: later });
    assert.equal((await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json()).guestsAt, Date.parse(later),
      "a newer set on either guest moves it");
    assert.match(bandOf(html, 1), /data-rest="Deep cuts for a Sunday"/,
      "the band keeps its own line for when the music leaves it");
    // No set on any guest: nothing to compare, and no field.
    const bare = flipEnv();
    assert.ok(!(await page(bare, `/buttons/${KEY}`)).includes('data-guests-at="'));
    assert.equal((await (await worker.fetch(get(`/buttons/${KEY}/playing`), bare)).json()).guestsAt, undefined);
  } finally { f.restore(); }
});

// A HOUSE DJ WITH AN ASKED SET (the owner, 2026-10-09: Sunny endless on 9
// and her set on 1 as one "1·9" square was "too confusing"): two squares,
// each with its own preset, and the ▶ only on the endless one.
test("the DJs tab: a house DJ with a set on a guest shows under House DJs and Your requests, each with its own number", async () => {
  const f = installFetch();
  try {
    const e = flipEnv();
    e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
      { button: 9, dj: "vibe", playlist: P(19) }, { button: 8, lane: true, playlist: P(18) }] });
    await putOn(e, GS, { dj: "vibe", ref: "talk" });
    const html = await page(e, `/buttons/${KEY}/djs`);
    const sec = (label) => html.slice(html.indexOf(`<h2 class="dlabel">${label}</h2>`)).split("</section>")[0];
    const sunnyIn = (label) => sec(label).match(new RegExp(`<li class="drow"><a href="/buttons/${KEY}/vibe"[\\s\\S]*?</li>`))?.[0] ?? "";
    const house = sunnyIn("House DJs"), asked = sunnyIn("Your requests");
    assert.match(house, /<span class="dtile num" aria-hidden="true">9<\/span>/);
    assert.match(house, /data-btns="9"/);
    assert.match(house, /aria-label="Play Vibe endless/, "the endless square plays her endless");
    assert.match(asked, /<span class="dtile num" aria-hidden="true">1<\/span>/);
    assert.match(asked, /data-btns="1"/);
    assert.ok(asked.includes(`aria-label="Open ${VIBE} — their set is on preset 1 (DJ Guest)"`));
    assert.ok(!html.includes("1·9"), "no shared square");
    // Its ▶ plays the asked set, as the Loaded band's does (the owner, the
    // same evening: "why is there no play disc on preset 1?").
    assert.match(asked, new RegExp(`<form class="dplay" method="post" action="/buttons/${KEY}/guest/play"><input type="hidden" name="btn" value="1">`));
    assert.match(asked, /aria-label="Play Vibe's set on preset 1"/);
    assert.ok(!asked.includes("endless"), "not her endless");
    // Requests first, then the guest DJ, then the house DJs (the owner, the same evening).
    assert.ok(html.indexOf("Your requests</h2>") > 0 && html.indexOf("Your requests</h2>") < html.indexOf("House DJs</h2>"));
    // An asked Tidal set: a ▶ only while the home helper can press its key.
    await putOn(e, GT, { dj: "the-librarian", ref: "r-2" });
    const prof = async () => (await page(e, `/buttons/${KEY}/djs`)).match(new RegExp(`<li class="drow"><a href="/buttons/${KEY}/the-librarian"[\\s\\S]*?</li>`))[0];
    assert.ok(!(await prof()).includes("dplay"), "no helper, no ▶");
    e.HELPER_SECRET = "helper-secret-000000000000";
    await worker.fetch(new Request("https://x.test/helper/reading", { method: "POST",
      headers: { authorization: `Bearer ${e.HELPER_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ speakers: [{ name: "Pro Plus", state: "stop", source: "Spotify" }] }) }), e);
    e.STATION.endless.hands = async () => ({ ok: true });
    assert.match(await prof(), new RegExp(`<form class="dplay" method="post" action="/buttons/${KEY}/wiim/key"><input type="hidden" name="btn" value="2"><input type="hidden" name="device" value="Pro Plus"><input type="hidden" name="back" value="loaded">`));
  } finally { f.restore(); }
});

test("the DJs tab says which guest a DJ's set is on and counts them as on a preset; its help says where a set goes", async () => {
  const f = installFetch();
  try {
    const e = flipEnv();
    await putOn(e, GS, { dj: "hank", ref: "deep-cuts" });
    await putOn(e, GT, { dj: "hank", ref: "request r-1" });
    const html = await page(e, `/buttons/${KEY}/djs`);
    const rowOf = (h, k) => h.match(new RegExp(`<li class="drow"><a href="/buttons/${KEY}/${k}"[\\s\\S]*?</li>`))?.[0] ?? "";
    assert.ok(rowOf(html, "hank").includes(
      `aria-label="Open ${HANK} — their set is on preset 1 (DJ Guest) and preset 2 (DJ Guest · Tidal)"`));
    assert.match(rowOf(html, "hank"), /<span class="dtile num pair" aria-hidden="true">1·2<\/span>/);
    assert.match(rowOf(html, "vibe"), /<span class="dtile blank" aria-hidden="true"><\/span>/, "a DJ on no preset has no number");
    assert.ok(rowOf(await page(e, `/buttons/${KEY}/djs?show=wall`), "hank"), "on a preset, through the guests");
    assert.equal(rowOf(await page(e, `/buttons/${KEY}/djs?show=bench`), "hank"), "", "and not on the bench");
    // The help in plain words (the owner, 2026-10-09).
    assert.match(html, /<b>Your requests<\/b> \(1 for Spotify and 2 for Tidal\) hold one set made to order/);
    assert.ok(!html.includes("they get a crate"));
    assert.ok(!html.includes("drop it on a number"), "no preset is left to drop a DJ on");
    // Before the switch-over the words are as they were.
    const dark = await page(darkEnv(), `/buttons/${KEY}/djs`);
    assert.match(dark, /A number is the preset they\s+hold on the WiiM remote/);
    assert.ok(dark.includes("drop it on a number"));
  } finally { f.restore(); }
});

test("an ask bound for a guest shows under its band — on its way, then passed on, with who and when — and the DJ page keeps the passed row open", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = flipEnv({ REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true" });
    const sent = await worker.fetch(post(`/buttons/${KEY}/hank/request`, "mood=kids+songs&length=60&service=spotify"), e);
    assert.equal(sent.status, 303);
    // The flash names the DJ and the preset the set lands on.
    assert.match(await page(e, `/buttons/${KEY}/hank?ask=sent`),
      /Request sent to Hank\. When it is ready it goes on preset 1 \(DJ Guest\), replacing the set there\./);
    // The presets page says it under band 1, and marks what a page left open compares.
    const html = await page(e, `/buttons/${KEY}`);
    assert.match(html, new RegExp(`<li class="bandreq"><a href="/buttons/${KEY}/hank">Asked ${HANK} at \\d\\d:\\d\\d — on its way`));
    const at = html.indexOf('class="bandreq"');
    assert.ok(html.indexOf('data-btn="1"') < at && at < html.indexOf('data-btn="2"'), "under band 1");
    const drawn = html.match(/data-asks="([^"]*)"/)?.[1];
    assert.ok(drawn, "the page marks an ask in flight");
    assert.equal((await (await worker.fetch(get(`/buttons/${KEY}/playing?asks=1`), e)).json()).asks, drawn);
    assert.equal((await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json()).asks, undefined,
      "no ledger read without ?asks=1");
    // Passed on: the line says who, and leads to their page, whose row stands open with the reason.
    await callTool(e, "decline_request", { request_id: drawn.split(":")[0], reason: "not my shelf" }, { remaining: 40 });
    assert.notEqual((await (await worker.fetch(get(`/buttons/${KEY}/playing?asks=1`), e)).json()).asks, drawn,
      "a page left open sees it move");
    const after = await page(e, `/buttons/${KEY}`);
    assert.match(after, new RegExp(`<li class="bandreq off"><a href="/buttons/${KEY}/hank">${HANK} passed on your ask at \\d\\d:\\d\\d — see why`));
    assert.ok(!after.includes("data-asks="), "nothing in flight, nothing to poll");
    const hank = await page(e, `/buttons/${KEY}/hank`);
    assert.match(hank, /<details class="reqrow" open>/);
    assert.match(hank, /passed on this one: “not my shelf”/);
    // A set landing on the guest since then retires the line.
    await putOn(e, GS, { dj: "vibe", ref: "vibe-set", at: new Date(Date.now() + 1000).toISOString() });
    assert.ok(!(await page(e, `/buttons/${KEY}`)).includes('class="bandreq'));
  } finally { f.restore(); }
});

test("music on none of the bands says where it is from, in the now bar", async () => {
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (new URL(String(u)).pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return Response.json({ is_playing: true, device: { name: "Pro Plus" }, context: { uri: `spotify:playlist:${P(9)}` },
        item: { name: "To Be Young, Gifted and Black", uri: "spotify:track:nn", artists: [{ name: "Nina Simone" }] } });
    }
    return inner(u, init);
  };
  try {
    const e = flipEnv();
    const o = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.equal(o.from, "the Replay playlist");
    assert.equal(o.btn, null);
    const html = await page(e, `/buttons/${KEY}`);
    // The now bar says where it is from; the line above the wall is gone (2026-09-24).
    assert.match(html, /Pro Plus · the Replay playlist/);
    assert.ok(!html.includes('id="nowline"'));
    assert.ok(!html.includes("guest live tall playing"), "and no band lights");
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("the DJs tab shows a preset the speakers hold under a DJ's name, dashed, and nothing for a DJ on no preset", async () => {
  const f = installFetch();
  try {
    const e = flipEnv();
    const at = new Date().toISOString();
    // The Librarian's older set on 5 on both speakers, Vibe's on 8 on the Pro Plus only.
    await e.PROGRAMS.put("reading:pro-plus", JSON.stringify({ at, speaker: "Pro Plus", presets: [
      { btn: 1, name: "DJ Guest", source: "Spotify" }, { btn: 5, name: "The Librarian", source: "Spotify" },
      { btn: 8, name: "Vibe", source: "Spotify" }] }));
    await e.PROGRAMS.put("reading:ultra", JSON.stringify({ at, speaker: "Ultra", presets: [
      { btn: 5, name: "The Librarian", source: "Spotify" }, { btn: 8, name: "NPO 3FM", source: "WiiM radio" }] }));
    const html = await page(e, `/buttons/${KEY}/djs`);
    const rowOf = (h, k) => h.match(new RegExp(`<li class="drow"><a href="/buttons/${KEY}/${k}"[\\s\\S]*?</li>`))?.[0] ?? "";
    assert.ok(rowOf(html, "the-librarian").includes(
      `aria-label="Open The Librarian — an older set of theirs is on preset 5, as the speakers hold it" class="dcard" data-btns="5"><span class="dtile num dim" aria-hidden="true">5</span>`));
    assert.match(rowOf(html, "vibe"), /<span class="dtile num dim" aria-hidden="true">8<\/span>/, "on either speaker counts");
    assert.match(rowOf(html, "hank"), /<span class="dtile blank" aria-hidden="true"><\/span>/);
    assert.match(rowOf(html, "archive"), /<span class="dtile num" aria-hidden="true">6<\/span>/, "the archive filled");
    // BY ROLE (2026-09-28): an older set is not a role, so they are among
    // everyone else, A to Z, "The" aside, their dashed number kept; the
    // archive has its own group above.
    assert.match(html, /<h2 class="dlabel">The archive<\/h2>[\s\S]*<h2 class="dlabel">Everyone else<\/h2>/);
    const rest = html.slice(html.indexOf('<h2 class="dlabel">Everyone else</h2>'));
    assert.ok(html.indexOf(`/${KEY}/archive"`) < html.indexOf('<h2 class="dlabel">Everyone else</h2>'), "the archive above");
    assert.ok(rest.indexOf(`/${KEY}/the-librarian"`) > 0 && rest.indexOf(`/${KEY}/the-librarian"`) < rest.indexOf(`/${KEY}/vibe"`), "Librarian before Vibe");
    assert.equal(rowOf(await page(e, `/buttons/${KEY}/djs?show=wall`), "the-librarian"), "");
    assert.ok(rowOf(await page(e, `/buttons/${KEY}/djs?show=bench`), "vibe"));
    // A guest's number is never read as a DJ's older set.
    assert.ok(!rowOf(html, "the-librarian").includes(">1<"));
  } finally { f.restore(); }
});

// ------------------------------------------------------ the speakers page

// THE SPEAKERS PAGE AS C+ (MC-19, 2026-09-21): a block per speaker, a button,
// whose keys are its own reading's; the picked one filled, ringed and ticked;
// the playing one saying so in words and bars, never in the fill. One grid per
// speaker, the picked one shown, a dot where the other holds a key
// differently and the heading naming which. The plan is tasks/done/mc19-key-play.md.
function playerOn(device, pid) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (new URL(String(u)).pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      if (!device) return new Response(null, { status: 204 });
      return Response.json({ is_playing: true, device: { name: device }, context: { uri: `spotify:playlist:${pid}` },
        item: { name: "Cold Sweat", uri: "spotify:track:cs", artists: [{ name: "James Brown" }] } });
    }
    return inner(u, init);
  };
  return () => { globalThis.fetch = inner; };
}
const TABLE = (seven) => [[1, "DJ Guest", "Spotify"], [2, "DJ Guest · Tidal", "Tidal"], [3, "Jazz FM", "TuneIn"],
  [4, "KEXP", "TuneIn"], [6, ARCHIVE.name, "Web stream"], [7, seven, "WiiM radio"]]
  .map(([btn, name, source]) => ({ btn, name, source, saved: null }));

test("the Speakers page (C+): the playing speaker is picked, its block a pressed button; one grid per speaker from its own reading, the picked one shown, a dot and the heading where they differ", async () => {
  const f = installFetch({ contents: [track("a")] });
  const restore = playerOn("Pro Plus", GS);
  try {
    const e = flipEnv();
    const html = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(html, /<main class="page wall spknow tabbed" data-base="[^"]+" data-live="pro-plus" data-names=/,
      "rule 1: the playing speaker is the server's pick, and the page says so for the script");
    // ONE PAGE HEADER (MC-30 stage 4): the title shows, and the "?" is in
    // the header's corner, as on every tab, not in the footer.
    assert.match(html, /<header class="masthead wallhead pagehead">\s*<h1>Speakers<\/h1><details class="help pagehelp" name="pagehead"><summary class="helpq" aria-label="How Speakers works">/);
    assert.ok(!/<footer class="roomfoot" id="roomfoot">[\s\S]*<details class="help/.test(html), "the help left the footer");
    // The Pro Plus plays preset 1 AND is picked: on (words, bars) and pick (fill, ring, tick), a pressed button.
    assert.ok(!html.includes('class="stick"'), "no tick since MC-20: the fill and the ring say picked");
    assert.match(html, /<button type="button" class="sblock on pick" data-speaker="Pro Plus" data-slug="pro-plus" data-room="1" aria-pressed="true" aria-label="Pro Plus: show its presets">[\s\S]*?<span class="seyebrow"><span class="slevels" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span>Playing now · Spotify<\/span>[\s\S]*?<span class="sname">Pro Plus<\/span>[\s\S]*?aria-label="Playing now: Cold Sweat — James Brown"[\s\S]*?From preset 1 \(DJ Guest\)<\/span>/);
    assert.match(html, /<button type="button" class="sblock" data-speaker="Ultra" data-slug="ultra" data-room="1" aria-pressed="false"[^>]*>[\s\S]*?Not on Spotify[\s\S]*?Not on Spotify right now\./);
    // ONE MEANING PER COLOUR, pinned in the stylesheet: .pick fills, .on never does.
    assert.match(html, /\.spknow \.sblock\.pick\{background:var\(--q-deep\);color:var\(--q-on-deep\);outline:3px solid var\(--q-ink\)/);
    assert.ok(!/\.spknow \.sblock\.on\{[^}]*background/.test(html), ".on sets no fill");
    assert.match(html, /\.spknow \.sblock\.on \.slevels\{display:inline-flex\}/);
    // Before any reading: a grid per speaker, each saying so; the picked one shown, the other hidden.
    assert.match(html, /<section class="holds" data-slug="pro-plus" aria-label="What the Pro Plus holds">[\s\S]*?No phone has read the Pro Plus yet/);
    assert.match(html, /<section class="holds" data-slug="ultra" aria-label="What the Ultra holds" hidden>[\s\S]*?No phone has read the Ultra yet/);
    // THE HEADING IS GONE (2026-09-22, the owner: "we can just scroll down and
    // use the pill"). Whose keys these are is said by the ring, and by the
    // section's own aria-label for a screen reader. Nothing is printed.
    assert.ok(!html.includes('class="hlabel"'), "no heading");
    assert.ok(!/What the (Pro Plus|Ultra) holds ·/.test(html), "and no second half anywhere");
    // The script: a fresh choice on the phone over a cached page, a tap moves it, the poll toggles .on alone.
    assert.match(html, /function pickGet\(\)[\s\S]*if \(firmWas && !main\.querySelector\([\s\S]*b\.classList\.toggle\("on", !!\(here && playing\) \|\| lnOn\);/);
    assert.ok(!/function draw[\s\S]*toggle\("pick"/.test(html.slice(html.indexOf("function draw"))), "draw never touches the pick");

    // Read, and different on 7. Each grid is its own speaker's twelve; the dot is on both; the heading names 7.
    const at = new Date().toISOString();
    await e.PROGRAMS.put("reading:pro-plus", JSON.stringify({ at, speaker: "Pro Plus", presets: TABLE("NPO Radio 2") }));
    await e.PROGRAMS.put("reading:ultra", JSON.stringify({ at, speaker: "Ultra", presets: TABLE("NPO 3FM") }));
    f.calls.length = 0;
    const read = await page(e, `/buttons/${KEY}/wiim`);
    assert.ok(!f.calls.some((c) => /\/playlists\//.test(c)), "drawing the keys reads no playlist");
    // Where they differ, the KEY says so with its dot; the sentence that used
    // to name the numbers went with the heading, and the readings page behind
    // the footer pill is where both speakers' tables are compared.
    assert.ok(!html.includes('class="hlabel"'), "no heading");
    const pro = read.slice(read.indexOf('data-slug="pro-plus" aria-label'), read.indexOf('data-slug="ultra" aria-label'));
    const ultra = read.slice(read.indexOf('data-slug="ultra" aria-label'), read.indexOf('<footer class="roomfoot"'));
    // 1 is the guest's, Spotify on file and the Pro Plus a room Play may name: a form since stage 3b, still filled.
    assert.ok(pro.includes(`<button type="submit" class="key fill lit play" data-k="1" data-busy="Starting…" aria-label="Play DJ Guest on the Pro Plus"><span class="knum">1</span>` +
      `<span class="kname">DJ Guest</span><span class="ksrc">Spotify</span>`), "a guest's key is filled, and plays");
    assert.ok(pro.includes(`<a class="key fill" data-k="6" href="/buttons/${KEY}/readings#p6">`), "and the archive's");
    assert.ok(pro.includes(`<a class="key" data-k="3" href="/buttons/${KEY}/readings#p3"><span class="knum">3</span><span class="kname">Jazz FM</span>`),
      "a station's is not");
    assert.ok(pro.includes(`<a class="key dot" data-k="7" href="/buttons/${KEY}/readings#p7" title="Held differently on the Ultra"><span class="knum">7</span>` +
      `<span class="kname">NPO Radio 2</span><span class="ksrc">WiiM radio</span><span class="klevels" aria-hidden="true"><i></i><i></i><i></i></span></a>`), "the Pro Plus's own 7, with a dot");
    assert.ok(ultra.includes(`<a class="key dot" data-k="7" href="/buttons/${KEY}/readings#p7" title="Held differently on the Pro Plus"><span class="knum">7</span>` +
      `<span class="kname">NPO 3FM</span><span class="ksrc">WiiM radio</span><span class="klevels" aria-hidden="true"><i></i><i></i><i></i></span></a>`), "the Ultra's own 7, with the same dot: a difference belongs to the pair");
    assert.equal((pro.match(/class="key dot"/g) ?? []).length, 1, "and only 7");
    assert.equal((ultra.match(/class="key dot"/g) ?? []).length, 1);
    assert.ok(pro.includes(`<a class="key" data-k="5" href="/buttons/${KEY}/readings#p5"><span class="knum">5</span><span class="kname none">nothing saved</span><span class="klevels" aria-hidden="true"><i></i><i></i><i></i></span></a>`));
    assert.ok(!read.includes('class="key two"') && !read.includes('class="kpair"') && !read.includes("A key with two names"),
      "the merged grid and its two-name tile are gone");
    // The presets' own heading, and the read time without a trailing dot (MC-30 stage 6).
    assert.match(read, /<h2 class="khead">Pro Plus presets<\/h2>\s*<p class="slimread"><span>Read at \d\d:\d\d<\/span><a href="shortcuts:\/\/run-shortcut\?name=Read%20WiiM%20Presets">Read again<\/a>/);
    assert.match(read, /data-names="\{&quot;1&quot;:&quot;DJ Guest&quot;,&quot;2&quot;:&quot;DJ Guest · Tidal&quot;\}"/,
      "the script names a preset as the server does");

    // Agreeing on all twelve, the heading says so — the second half that stops a switch reading as broken.
    await e.PROGRAMS.put("reading:ultra", JSON.stringify({ at, speaker: "Ultra", presets: TABLE("NPO Radio 2") }));
    const same = await page(e, `/buttons/${KEY}/wiim`);
    assert.ok(!same.includes('class="hlabel"'), "no heading, agreeing or not");
    assert.ok(!same.includes('class="key dot"'), "no dot when nothing differs");
    // And with both read in the same run, nothing is said about the reading
    // beyond when it was taken.
    assert.ok(!same.includes('class="hstale"'), "the run reached both");
    assert.match(same, /<p class="slimread"><span>Read [^<]*<\/span><a href="shortcuts:/, "the read time stays");

  } finally { restore(); f.restore(); }
});

test("the pick's ladder on the server: the playing speaker, else the house's default; the phone's memory is the script's and waits for no player", async () => {
  const f = installFetch({ contents: [track("a")] });
  const restore = playerOn(null);
  try {
    const e = flipEnv();
    // Nothing playing: no data-live, the default speaker picked, nothing on.
    const quiet = await page(e, `/buttons/${KEY}/wiim`);
    assert.ok(!/data-live=/.test(quiet), "nothing playing: the script may apply the phone's memory");
    assert.match(quiet, /<button type="button" class="sblock pick" data-speaker="Pro Plus"/);
    assert.match(quiet, /<button type="button" class="sblock" data-speaker="Ultra"/);
    // The default named as the other box: it is picked instead.
    e.DEFAULT_DEVICE = "Ultra";
    const other = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(other, /<button type="button" class="sblock" data-speaker="Pro Plus"/);
    assert.match(other, /<button type="button" class="sblock pick" data-speaker="Ultra"/);
    assert.match(other, /<section class="holds" data-slug="pro-plus" aria-label="What the Pro Plus holds" hidden>/);
    assert.match(other, /<section class="holds" data-slug="ultra" aria-label="What the Ultra holds">/);
  } finally { restore(); f.restore(); }
  // The Ultra playing: picked over the default, and on.
  const f2 = installFetch({ contents: [track("a")] });
  const restore2 = playerOn("Ultra", GS);
  try {
    const e = flipEnv();
    const html = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(html, /data-live="ultra"/);
    assert.match(html, /<button type="button" class="sblock" data-speaker="Pro Plus" data-slug="pro-plus" data-room="1" aria-pressed="false"/);
    assert.match(html, /<button type="button" class="sblock on pick" data-speaker="Ultra" data-slug="ultra" data-room="1" aria-pressed="true"/);
  } finally { restore2(); f2.restore(); }
});

test("a run that missed a speaker is said on the page, and nothing is said when it reached them all", async () => {
  // THE FAULT THIS REPLACES. From 13 to 22 September the Ultra's address moved
  // and the Read WiiM Presets shortcut stopped reaching it; the Pro Plus kept
  // updating and NOTHING anywhere said the other had stopped. The owner found
  // it by noticing a date that would not change. The shortcut asks every
  // speaker in ONE run, seconds apart, so two readings far apart are not "old"
  // — they are a run that reached one box and not the other. An hour is the
  // line; a real run takes seconds.
  //
  // This test used to pin the heading's second half ("the Ultra holds the same
  // twelve", "7 differs from the Pro Plus"), which went with the heading on
  // 2026-09-22: the ring says whose keys these are, a dot says which differ,
  // and the footer pill opens both tables side by side.
  const f = installFetch({ contents: [track("a")] });
  const restore = playerOn(null);
  try {
    const e = KEYED();
    const now = Date.now();
    const put = (slug, name, atMs) => e.PROGRAMS.put(`reading:${slug}`, JSON.stringify({
      at: new Date(atMs).toISOString(), speaker: name, presets: PRO_READ }));

    // ONE RUN: both within seconds. Nothing said beyond the read time.
    await put("pro-plus", "Pro Plus", now - 4000);
    await put("ultra", "Ultra", now - 1000);
    const together = await page(e, `/buttons/${KEY}/wiim`);
    assert.ok(!together.includes('class="hstale"'), "one run, nothing to say");
    assert.match(together, /<p class="slimread"><span>Read /, "the read time is still there");

    // A RUN THAT MISSED ONE: nine days apart, as the owner's did.
    await put("ultra", "Ultra", now - 9 * 24 * 60 * 60 * 1000);
    const missed = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(missed, /<p class="hstale" role="status">The Ultra was not reached when the speakers were last read — it was last read on [^<]+\.<\/p>/);
    // Said on BOTH grids: it is a fact about the house, not about the one you
    // happen to be looking at.
    assert.equal((missed.match(/class="hstale"/g) ?? []).length, 2, "on both grids");

    // An hour is the line, and it is generous: fifty minutes is still one run.
    await put("ultra", "Ultra", now - 50 * 60 * 1000);
    assert.ok(!(await page(e, `/buttons/${KEY}/wiim`)).includes('class="hstale"'), "fifty minutes: still one run");
    await put("ultra", "Ultra", now - 70 * 60 * 1000);
    assert.ok((await page(e, `/buttons/${KEY}/wiim`)).includes('class="hstale"'), "seventy minutes: a run that missed one");

    // A speaker never read at all keeps its own older wording, and is not
    // called "not reached" — there was never a reading of it to be stale.
    await e.PROGRAMS.delete("reading:ultra");
    const never = await page(e, `/buttons/${KEY}/wiim`);
    assert.ok(!never.includes('class="hstale"'), "never read is not a missed run");
    assert.match(never, /No phone has read the Ultra yet/);
  } finally { restore(); f.restore(); }
});

// ------------------------------------------------------------ the DJ page

test("where a DJ's sets are: per service the live guest that names them; nothing new for a DJ on a preset or while every guest is dark", async () => {
  const held = { spotify: { guest: { btn: 1, playlist: GS, catalog: "spotify" }, on: { dj: "hank" } } };
  const hank = { key: "hank", button: null };
  assert.deepEqual(djPlaces(hank, held).map((p) => [p.kind, p.catalog, p.pid]), [["guest", "spotify", GS]]);
  assert.deepEqual(djPlaces({ ...hank, key: "dr-funkenstein" }, held), [], "a guest naming another DJ is not theirs");
  assert.equal(djPlaces(hank, {}), null, "dark: the page is what it was");
  assert.equal(djPlaces({ ...hank, button: "button 3" }, held), null, "a DJ on a preset: the preset");

  const e = flipEnv();
  await putOn(e, GS, { dj: "hank", ref: "request r-1" });
  const h = await guestHolders(e);
  assert.deepEqual(Object.keys(h).sort(), ["spotify", "tidal"]);
  assert.equal(h.spotify.on.dj, "hank");
  assert.equal(h.tidal.on, null);
  assert.deepEqual(await guestHolders(darkEnv()), {}, "no record read while every guest is dark");
  assert.equal(djSlotsExist(e), false);
  assert.equal(djSlotsExist(darkEnv()), true);
});

test("a DJ whose set is on a guest: the block says which and since when, Play plays it, and the shelf's puts land on the guests", async () => {
  const f = installFetch({ contents: [track("a"), track("b")] });
  const td = installTidalFetch({ contents: ["7"] });
  const cap = playBodies();
  try {
    const e = flipEnv({ REQUESTS_ENABLED: "true" });
    const at = minutesAgo(3);
    await putOn(e, GS, { dj: "hank", ref: "hank-one", at, program: { slug: "hank-one", by: HANK, title: "Deep cuts" } });
    await seedProgram(e, "hank-two", HANK, "Second set", "spotify", "2026-09-09T10:00:00Z");
    await seedProgram(e, "hank-tidal", HANK, "On Tidal", "tidal", "2026-09-08T10:00:00Z");
    const html = await page(e, `/buttons/${KEY}/hank`);
    assert.ok(html.includes(`<p class="vload"><span class="vtag">On preset 1 (DJ Guest) ${sinceWords(houseClockWords(e, at))}\u00a0· </span>Deep cuts</p>`));
    assert.match(html, /<span class="ghost" aria-hidden="true">1<\/span>/, "the number to press, ghosted behind the name");
    assert.ok(html.includes(`<form class="vact" method="post" action="/buttons/${KEY}/hank/play">`));
    // Said under the ask form now, in plain sight ("A DJ's Page, Calmer", 2026-10-24).
    assert.match(html, /<h2 class="blabel" id="holdsh">On preset 1 \(DJ Guest\)<\/h2>/);
    // The shelf is a grid of cards since board A (2026-09-25): the live one
    // wears the guest's number, the Tidal one its service, and each opens its
    // program's page — which is where the puts are, and still land on the guests.
    const card = (slug) => { const at = html.indexOf(`/programs/${slug}?from=hank`, html.indexOf('<ul class="djgrid">')); assert.ok(at > 0, slug);
      return html.slice(html.lastIndexOf("<li class=", at), html.indexOf("</li>", at)); };
    assert.match(card("hank-one"), /^<li class="card live">[\s\S]*<span class="num">On 1<\/span>/);
    assert.match(card("hank-tidal"), /<span class="svc">Tidal<\/span>/);
    assert.ok(!card("hank-two").includes('class="num"'), "only the one on the guest wears a number");
    assert.ok(!/>Load on/.test(html), "the puts are on the program's page");
    const two = await page(e, `/buttons/${KEY}/programs/hank-two?from=hank`);
    assert.match(two, /aria-label="Load Second set on preset 1 \(DJ Guest\)"><span class="gp"><span class="nw">Load on 1<\/span> <span class="nw">\(DJ Guest\)<\/span><\/span><\/button>/);
    assert.ok(!/>Load on Spotify</.test(two), "no crate is offered while the guest is live");
    const tidal = await page(e, `/buttons/${KEY}/programs/hank-tidal?from=hank`);
    assert.match(tidal, /aria-label="Load On Tidal on preset 2 \(DJ Guest · Tidal\)"><span class="gp"><span class="nw">Load on 2<\/span> <span class="nw">\(DJ Guest · Tidal\)<\/span><\/span><\/button>/);
    const one = await page(e, `/buttons/${KEY}/programs/hank-one?from=hank`);
    assert.match(one, /<span class="onair">On preset 1 now/);
    assert.ok(!html.includes("/hank/preset"), "no preset can take a DJ, so no pill");
    const played = await worker.fetch(post(`/buttons/${KEY}/hank/play`, "device=Pro+Plus"), e);
    assert.equal(played.status, 303);
    assert.ok(played.headers.get("location").startsWith(`/buttons/${KEY}/hank?played=`));
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${GS}`, "the DJ's Play plays the guest their set is on");

    // On the Tidal guest: pressed on 2, opened in the app, never started here.
    await putOn(e, GT, { dj: "dr-funkenstein", ref: "request r-2", at });
    const funk = await page(e, `/buttons/${KEY}/dr-funkenstein`);
    assert.match(funk, /<p class="archnote">Nothing here can start Tidal — press 2 on the\s+remote, or open it in the app\.<\/p>/);
    assert.match(funk, /<p class="vload"><span class="vtag">On preset 2 \(DJ Guest · Tidal\) since [^<]+<\/span><\/p>/);
    assert.ok(funk.includes(`<a class="chipbtn" href="https://listen.tidal.com/playlist/${GT}" rel="noopener noreferrer">Open in Tidal`));
    assert.ok(!funk.includes('<form class="vact"'));
    const funkPlay = await worker.fetch(post(`/buttons/${KEY}/dr-funkenstein/play`, "device=Pro+Plus"), e);
    assert.equal(funkPlay.status, 400);
    assert.match(await funkPlay.text(), new RegExp(`${FUNK}(?:&#39;|')s set is on the Tidal requests preset, which cannot be started from a page`));

    // On neither: said, and nothing offered that can only refuse.
    const sunny = await page(e, `/buttons/${KEY}/vibe`);
    assert.match(sunny, /<p class="vload"><span class="vtag">Nothing of theirs on Requests — ask for a set<\/span><\/p>/);
    // With the composer on the page that line is the whole of it (board A,
    // 2026-09-25): the paragraph repeating it is gone.
    assert.ok(!sunny.includes(`${VIBE}’s sets go onto the guest presets`));
    // Without the composer (requests off) the paragraph is still the page's word on it.
    const noAsk = await page(flipEnv(), `/buttons/${KEY}/vibe`);
    assert.ok(noAsk.includes(`${VIBE}’s sets go onto the guest presets, one at a time, and none of theirs is on one now. Ask Claude for one`));
    assert.ok(!sunny.includes('<form class="vact"'));
    const sunnyPlay = await worker.fetch(post(`/buttons/${KEY}/vibe/play`, "device=Pro+Plus"), e);
    assert.equal(sunnyPlay.status, 400);
    assert.match(await sunnyPlay.text(), new RegExp(`${VIBE} has no set on a guest preset now`));
  } finally { cap.restore(); td.restore(); f.restore(); }
});


// -------------------------------------------------- the request card on a guest

const REQ = "r-g1";
function seedReady(e, over = {}) {
  const now = Date.now();
  e.STATION.rows.set(REQ, { id: REQ, dj: "hank", normalized: "x", state: "ready",
    created_at: now - 5000, updated_at: now - 1000, lease_until: null, fingerprint: null,
    write_started: 1, claim_token: null, claim_count: 1, playlist_id: GS, track_count: 2,
    runtime_ms: 400000, attention_code: null, decline_reason: null, suggested_dj: null,
    kept_slug: null, kept_at: null, destination: GS, ...over });
  return e.PROGRAMS.put(`request:${REQ}`, JSON.stringify({ id: REQ, dj: "hank", mood: "quiet piano",
    length: 60, avoid: null, at: "2026-09-12T06:00:00Z" }));
}

test("a request on a guest is judged by the guest's own record: this request is a set that changed; another set took the guest, in one quiet line", async () => {
  const live = [track("a"), track("b")];
  const f = installFetch({ contents: live });
  try {
    const fp = await fingerprintUris(live.map((t) => t.uri));
    const at = minutesAgo(4);
    const shelf = `<a href="/notes/${KEY}?dj=hank">Shelf</a>`;
    // Ready: the live list is the set, and the record names this request.
    let e = flipEnv({ REQUESTS_ENABLED: "true" });
    await seedReady(e, { fingerprint: fp });
    await putOn(e, GS, { dj: "hank", ref: `request ${REQ}` });
    let html = await page(e, `/buttons/${KEY}/hank`);
    assert.match(html, /Ready — 2 tracks/);
    assert.ok(!html.includes("took the Spotify requests preset"));
    // Changed: the record still names this request; the list does not match.
    e = flipEnv({ REQUESTS_ENABLED: "true" });
    await seedReady(e, { fingerprint: "fp-of-another-list" });
    await putOn(e, GS, { dj: "hank", ref: `request ${REQ}` });
    assert.match(await page(e, `/buttons/${KEY}/hank`), /the playlist has changed since/);
    // Superseded, read here: another of Hank's sets is on the guest now.
    e = flipEnv({ REQUESTS_ENABLED: "true" });
    await seedReady(e, { fingerprint: "fp-of-another-list" });
    await putOn(e, GS, { dj: "hank", ref: "hank-two", at });
    html = await page(e, `/buttons/${KEY}/hank`);
    assert.ok(html.includes(`<p class="asktag taken">Another of ${HANK}’s sets took the Spotify requests preset ${atWords(houseClockWords(e, at))}; kept sets are on the ${shelf}.</p>`), html.slice(html.indexOf("Requests"), html.indexOf("Requests") + 600));
    assert.ok(!html.includes('class="reqrow'), "one line, not a row");
    // Superseded, not read: Dr. Funkenstein's set holds the guest, and Hank's page reads no guest at all.
    e = flipEnv({ REQUESTS_ENABLED: "true" });
    await seedReady(e, { fingerprint: fp });
    await putOn(e, GS, { dj: "dr-funkenstein", ref: "request r-m", at });
    f.calls.length = 0;
    html = await page(e, `/buttons/${KEY}/hank`);
    assert.ok(html.includes(`<p class="asktag taken">${FUNK}’s set took the Spotify requests preset ${atWords(houseClockWords(e, at))}; kept sets are on the ${shelf}.</p>`));
    assert.ok(!f.calls.some((c) => c.includes(`/playlists/${GS}`)), "another DJ's set is not read to judge this one");
    // A kept one is linked.
    e = flipEnv({ REQUESTS_ENABLED: "true" });
    await seedReady(e, { fingerprint: fp, kept_at: Date.now(), kept_slug: "trains-aaaaaa" });
    await seedProgram(e, "trains-aaaaaa", HANK, "Trains");
    await putOn(e, GS, { ref: "talk", at });
    html = await page(e, `/buttons/${KEY}/hank`);
    assert.ok(html.includes(`<p class="asktag taken">A set from Talk took the Spotify requests preset ${atWords(houseClockWords(e, at))}; this one is <a href="/buttons/${KEY}/programs/trains-aaaaaa?from=hank">on the Shelf</a>.</p>`));
    // Unknown: no record on the guest, and this page did not read it.
    e = flipEnv({ REQUESTS_ENABLED: "true" });
    await seedReady(e, { fingerprint: fp });
    html = await page(e, `/buttons/${KEY}/hank`);
    assert.match(html, /could not be fully checked just now/);
    assert.ok(!html.includes("took the Spotify requests preset"), "an unknown is never dressed as a fact");
  } finally { f.restore(); }
});

test("a request waiting on a guest another request is writing says so, keeps its withdraw, and holds the form back", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = flipEnv({ REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true" });
    const now = Date.now();
    const row = { normalized: "x", updated_at: now, fingerprint: null, claim_token: null, claim_count: 0,
      playlist_id: null, track_count: null, runtime_ms: null, attention_code: null, decline_reason: null,
      suggested_dj: null, kept_slug: null, kept_at: null, destination: GS };
    e.STATION.rows.set("r-funk", { ...row, id: "r-funk", dj: "dr-funkenstein", state: "claimed", created_at: now - 60000,
      lease_until: now + 600000, write_started: 0, claim_count: 1 });
    e.STATION.rows.set("r-hank", { ...row, id: "r-hank", dj: "hank", state: "pending", created_at: now - 30000,
      lease_until: null, write_started: 0 });
    await e.PROGRAMS.put("request:r-hank", JSON.stringify({ id: "r-hank", dj: "hank", mood: "quiet piano",
      length: 60, avoid: null, at: new Date(now - 30000).toISOString() }));
    const html = await page(e, `/buttons/${KEY}/hank`);
    assert.match(html, /<span class="reqword">waiting<\/span>/);
    assert.match(html, /Waiting — the Spotify requests preset is being written for another request; this one follows within the hour\./);
    assert.ok(html.includes(`action="/buttons/${KEY}/hank/request/dismiss"`), "a waiting request can still be withdrawn");
    assert.ok(!html.includes(`Ask ${HANK} for a set`), "one request at a time: the form waits too");
    assert.match(html, /http-equiv="refresh"/, "and the page checks on its own");
  } finally { f.restore(); }
});

// -------------------------------------------------------------- the Speakers

// --------------------------------------------------------------------- Use

test("the meter has its own address, the old one still answers, and no tab is added", async () => {
  const e = flipEnv();
  const r = await worker.fetch(get(`/buttons/${KEY}/use`), e);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<h1>Use<\/h1>/);
  assert.match(html, /<h2 id="uspot">Spotify<span class="usub">/);
  // Drawn in the wall's faces, which it never loaded (found 2026-09-13): the
  // masthead fell back to Arial Black under the Speakers tab that had them.
  assert.ok(html.includes("family=Archivo+Black&family=Archivo:"), "the house's fonts load on Use");
  const tabs = [...html.matchAll(/<a class="tab[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, [`/buttons/${KEY}/wiim`, `/buttons/${KEY}/djs`, `/notes/${KEY}`, `/buttons/${KEY}`]);
  assert.match(html, new RegExp(`<a class="tab on" href="/buttons/${KEY}/wiim" aria-current="page">`));
  assert.equal((await worker.fetch(post(`/buttons/${KEY}/use`, ""), e)).status, 405);
  assert.equal((await worker.fetch(get(`/buttons/${"x".repeat(24)}/use`), e)).status, 404);
  assert.ok((await page(e, `/buttons/${KEY}/wiim`)).includes(`<a class="chip" href="/buttons/${KEY}/use">Use</a>`));
});

// WORK WAITING TOO LONG (MC-31 stage 6b, step 4; the owner, 2026-10-19): an
// ask nobody has answered past twenty minutes says so under its band, with
// the curator's last check-in and why it may be, without waiting the hour
// the quiet note waits; list_requests and the curator's last day say it too.
test("an ask unanswered past twenty minutes: the band says the curator may have hit its plan's limit", async () => {
  const f = installFetch({ contents: [track("a")] });
  const realNow = Date.now;
  try {
    const e = flipEnv({ REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true" });
    assert.equal((await worker.fetch(post(`/buttons/${KEY}/hank/request`, "mood=kids+songs&length=60&service=spotify"), e)).status, 303);
    await e.PROGRAMS.put("curator:seen", JSON.stringify({ at: realNow() - 5 * 60 * 1000 }));
    assert.match(await page(e, `/buttons/${KEY}`), /Asked [^<]* — on its way/, "a fresh ask is on its way");
    // Twenty-five minutes on, still pending, the curator last seen thirty ago.
    Date.now = () => realNow() + 25 * 60 * 1000;
    const html = await page(e, `/buttons/${KEY}`);
    assert.match(html, /Asked [^<]* — waiting on the curator, who last checked in (on \w+ )?at \d\d:\d\d: its Claude or ChatGPT plan may have hit its limit/);
    const out = await __test.callTool(e, "list_requests", {}, { remaining: 40 });
    assert.equal(out.waiting_too_long.asks, 1);
    assert.equal(out.waiting_too_long.endless_jobs, 0);
    assert.match(out.waiting_too_long.note, /Claude or ChatGPT plan has hit its limit/);
    assert.equal(out.curator_24h.asks_waiting, 1);
    assert.equal(out.curator_24h.asks_answered, 0);
  } finally { Date.now = realNow; f.restore(); }
});
