// The room page's cards: an empty button, a button with a set, the speaker
// picker, the player line, and the page's scripts. The file is named for the
// swap (moving a DJ onto a button), whose tests went with MC-18's stage 6
// (2026-09-26); these are the ones that outlived it.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { PERSONAS, ROSTER } from "../djs.js";
import { makeEnv, installFetch, installTidalFetch, track, PID, TPID, buttons, HOUSE, putTile } from "./harness.js";

const { callTool, house } = __test;

const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const B = { 2: P(2), 7: P(7) };
const budget = () => ({ remaining: 40 });

// ------------------------------------------------------- what it refuses

// ------------------------------------------------- one step at a time

// ------------------------------------------------------------- the rest

// --------------------------------------------------------- the wall page
//
// Buttons first: the page opens knowing which button it is about and asks
// only who. These pin the parts a hand-built request could otherwise reach —
// the key, the method, the Origin, an archive slot — and the two properties
// the design turns on: a row has one tap target, and the sentence the grid
// shows afterwards is built from the wall rather than from the URL.

const KEY = "abcdefabcdefabcdefabcdef";
const page = (path, init) => new Request(`https://x.test${path}`, init);
// A form post as a browser sends one. Without the content-type formData()
// throws, the body reads as blank, and the route refuses — which is correct
// and is its own test below, but makes a silent no-op of every other one.
const post = (path, body, init = {}) => page(path, {
  method: "POST",
  ...init,
  headers: { "content-type": "application/x-www-form-urlencoded", ...(init.headers ?? {}) },
  body,
});

async function roomEnv(over = {}) {
  const e = makeEnv(over);
  e.BUTTONS = buttons(B);
  e.PROGRAM_LIBRARY_KEY = KEY;
  return e;
}

test("a button installed with nobody on it says so rather than naming a ghost", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([{ button: 2, playlist: P(2) }]);
  const f = installFetch({ contents: [] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    assert.match(html, /nothing on it yet/);
    assert.ok(!html.includes("last set"));
  } finally { f.restore(); }
});

// Audit finding, fixed 2026-09-04: heading levels ran backwards on the bench.
test("card headings sit under their zone, and never jump backwards", async () => {
  const e = await roomEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    // Never a jump back of two or more, and never a level 2 after a level 3
    // inside the bench.
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] <= levels[i - 1] + 1, `heading jumps from h${levels[i - 1]} to h${levels[i]}`);
    }
    assert.ok(!/<h2 class="bname"/.test(html));
    const wall = html.slice(html.indexOf("The wall"));
    assert.match(wall, /<h3 class="bname">/);
    // The bench left the wall for the DJs tab (MC-14): no zone, no h2 for it.
    assert.ok(!html.includes('id="bench"'));
  } finally { f.restore(); }
});

// Audit finding, fixed 2026-09-04: a select sizes itself to its widest option,
// and a forty-character room name in ROOM_DEVICES pushed the speaker picker off
// the phone. The CSS now caps it; this pins that the rule is there, since a
// layout cannot be measured in a unit test.
test("the speaker picker is capped to the page width", async () => {
  const { renderDjRoom } = await import("../programs.js");
  const html = renderDjRoom({
    base: "/b", notesHref: "/n", dj: { key: "hank", name: "Hank", summary: "", brief: "", btn: 2,
      button: "button 2", unit: "tracks", catalog: "spotify" },
    tile: null, tracks: [], premise: null, shelf: null,
    devices: ["Pro Plus", "Studio Living Room With A Very Long Name Indeed"],
    defaultDevice: "Pro Plus", flash: null, archive: false, lastLoaded: null,
  });
  assert.match(html, /\.devsel\{[^}]*max-width:100%/);
  assert.match(html, /\.vact\{[^}]*flex-wrap:wrap/);
});

// The other half of the same property, without a swap in the way: the fake
// holds ONE set of contents for every playlist, so this is the honest way to
// show the control flipping on what a button holds.
test("a button with a set still offers Play", async () => {
  for (const [contents, wanted] of [[[track("t1")], true], [[], false]]) {
    // A fresh env each time: the tile cache lives in KV, and reusing one would
    // answer the second render from the first render's count.
    const e = await roomEnv();
    const f = installFetch({ contents });
    try {
      const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
      assert.equal(/action="\/buttons\/[^/]+\/hank\/play"/.test(html), wanted,
        `${contents.length} tracks`);
      assert.equal(html.includes("No set yet — ask Hank"), !wanted);
    } finally { f.restore(); }
  }
});

test("an unreadable count is not an empty button — Play stays", async () => {
  // Withdrawing the control on "unknown" would hide Play on a full button
  // every time Spotify was slow, which is the wrong way to be wrong.
  const e = await roomEnv();
  const f = installFetch({
    contents: [track("t1")],
    fail: { [`GET /playlists/${P(2)}`]: "no", [`GET /playlists/${P(7)}`]: "no" },
  });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    assert.match(html, /action="\/buttons\/[^/]+\/hank\/play"/);
    assert.ok(!html.includes("No set yet"));
  } finally { f.restore(); }
});

// ------------------------------------------------- what a DJ arrives with
//
// A swap used to leave the button empty, and an empty button is a dead one:
// pressing it does nothing at all, measured on the speaker. The occupancy rule
// has always said published work belongs to the DJ and follows them, so it
// follows them here — the button is alive the moment the swap finishes.

async function seedProgram(e, slug, { dj, created, uris, title = slug, ...rest }) {
  await e.PROGRAMS.put(`program:${slug}`, JSON.stringify({
    slug, dj, title, created,
    sections: [{ tracks: uris.map((uri) => ({ uri, title: uri, artist: "X" })) }],
    ...rest,
  }), { metadata: { dj, created, title,
    // The service its tracks are on, as programCatalog writes it — the DJ
    // page's shelf reads it to tell whether a row fits (2026-09-25).
    ...(uris.length ? { catalog: String(uris[0]).split(":")[0] } : {}) } });
}

// Reported by the owner, 2026-09-04: button 5 was Hank's and empty, and there
// was no way from the page to put his own work on it. The picker refuses to
// put a DJ where they already are — correctly — so it could not be the answer.
//
// A control on the card was tried and taken out the same day: the grid is a
// recall surface and stays one line per fact, and a swap now arrives with a
// set, so an empty button is the exception rather than the state to design the
// card around. The remedy lives on the DJ's own page, where the shelf offers
// every one of their programs — which is what the next test pins.
test("the grid keeps one line for an empty button and no control", async () => {
  const e = await roomEnv();
  await seedProgram(e, "his-set", {
    dj: "Hank", created: "2026-09-02T00:00:00Z",
    uris: ["spotify:track:b1"], title: "Durand Jones",
  });
  const f = installFetch({ contents: [] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    assert.match(html, /No set yet — ask Hank/);
    assert.ok(!html.includes("Durand Jones"), "the grid names no program");
    assert.ok(!/action="\/notes\/[^"]+\/activate"/.test(html), "and carries no write");
  } finally { f.restore(); }
});

test("the DJ's own page offers their program on an empty button of the same service", async () => {
  const e = await roomEnv();
  await seedProgram(e, "his-set", {
    dj: "Hank", created: "2026-09-02T00:00:00Z",
    // Published to a playlist Hank's button no longer holds — the ordinary
    // state after a swap, and the one that used to withhold this form.
    uris: ["spotify:track:b1"], title: "Durand Jones", playlistId: P(9),
  });
  const f = installFetch({ contents: [] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}/hank`), e)).text();
    // Since board A (2026-09-25) the shelf is a grid of cards and Load lives
    // on the program's own page: the card opens it, the page offers Load.
    assert.match(html, new RegExp(`<a href="/buttons/${KEY}/programs/his-set\\?from=hank">Durand Jones</a>`));
    assert.match(html, /the shelf below/, "and the empty sentence points at it");
    assert.ok(!html.includes("no longer points at"));
    const prog = await (await worker.fetch(page(`/buttons/${KEY}/programs/his-set?from=hank`), e)).text();
    assert.match(prog, /aria-label="Load Durand Jones on (?:the )?preset/);
  } finally { f.restore(); }
});

test("with nothing of theirs that fits, the empty card still just says to ask", async () => {
  const e = await roomEnv();
  await seedProgram(e, "wrong-service", {
    dj: "Hank", created: "2026-09-02T00:00:00Z",
    uris: ["tidal:track:9"], title: "Written On Tidal",
  });
  const f = installFetch({ contents: [] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    assert.match(html, /No set yet — ask Hank/);
    assert.ok(!html.includes("Written On Tidal"));
  } finally { f.restore(); }
});

test("a button with a set is not offered a program it did not ask for", async () => {
  const e = await roomEnv();
  await seedProgram(e, "his-set", {
    dj: "Hank", created: "2026-09-02T00:00:00Z",
    uris: ["spotify:track:b1"], title: "Durand Jones",
  });
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes("Put “Durand Jones” on it"));
    assert.match(html, /action="\/buttons\/[^/]+\/hank\/play"/);
  } finally { f.restore(); }
});

test("the empty-button sentence points at the shelf only when the shelf can help", async () => {
  const withOne = await roomEnv();
  await seedProgram(withOne, "his-set", {
    dj: "Hank", created: "2026-09-02T00:00:00Z",
    uris: ["spotify:track:b1"], title: "Durand Jones", playlistId: P(9),
  });
  const withNone = await roomEnv();
  await seedProgram(withNone, "wrong-service", {
    dj: "Hank", created: "2026-09-02T00:00:00Z",
    uris: ["tidal:track:9"], title: "Written On Tidal", playlistId: TPID,
  });
  for (const [e, points] of [[withOne, true], [withNone, false]]) {
    const f = installFetch({ contents: [] });
    try {
      const html = await (await worker.fetch(page(`/buttons/${KEY}/hank`), e)).text();
      assert.match(html, /the preset has nothing to play until a set is put on it/);
      assert.equal(html.includes("from the shelf below"), points);
    } finally { f.restore(); }
  }
});

// ---------------------------------------------------------- the faces
//
// A cover is uploaded per PLAYLIST and never moves on its own, so after the
// first swap the Spotify app showed Morning's face on the playlist now called
// Hank — found by the owner choosing playlists to save as presets on the
// second speaker, where that list is the whole interface.

test("the seam refuses a Tidal cover before any call", async () => {
  const { tidalCatalog } = await import("../tidal.js");
  const calls = [];
  const cat = tidalCatalog(async (...a) => { calls.push(a); return {}; });
  await assert.rejects(() => cat.cover(TPID, "abc"),
    (e) => { assert.equal(e.status, 501); assert.match(e.message, /read-only/); return true; });
  assert.deepEqual(calls, []);
});

// ------------------------------------------- the rest of the audit, fixed

test("the arrow is bound to its word and hidden from the accessibility tree", async () => {
  const e = await roomEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    // On the DJ page the arrow rides the Program chip (and the ask pill when
    // requests are on); the wall keeps the empty card's "Put a DJ on N".
    await seedProgram(e, "arrow-set", { dj: "Hank", created: "2026-09-01T00:00:00Z", uris: ["spotify:track:t1"], title: "Arrow" });
    await e.PROGRAMS.put(`current:${P(2)}`, "arrow-set");
    const html = await (await worker.fetch(page(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Program<span class="arr" aria-hidden="true">&nbsp;<svg class="ic"[^>]*><path d="M5 12h14M13 6l6 6-6 6"><\/path><\/svg><\/span><\/a>/);
    assert.ok(!/Program →/.test(html), "no bare arrow after a breakable space");
    assert.ok(!(await (await worker.fetch(page(`/buttons/${KEY}`), e)).text()).includes('class="swaplink"'),
      "and the wall no longer carries it");
  } finally { f.restore(); }
});

test("a keyboard user can skip the wall, and an empty card is one stop", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([{ button: 2, dj: "hank", playlist: P(2) }, { button: 7, playlist: P(7) }]);
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    assert.ok(!/Skip to the bench/.test(html), "no bench on the wall to skip to (MC-14)");
    assert.match(html, /<a class="skip" href="#roomfoot">Skip to the notes<\/a>/);
    assert.match(html, /<footer class="roomfoot" id="roomfoot">/);
    // The empty card is not a link at all now (the drag is the move), and a
    // full band is ONE tab stop: the number's link is hidden from the tab
    // order and the accessibility tree, the name carries the label.
    assert.match(html, /<li class="band empty" data-btn="\d+">\s*<span class="bnum dim" aria-hidden="true">/);
    assert.match(html, /<a class="bnum" href="[^"]+" tabindex="-1" aria-hidden="true">2<\/a>\s*<a class="bfill" href="[^"]+" aria-label="Open Hank, preset 2/);
  } finally { f.restore(); }
});

test("the player line announces itself when it cannot see", async () => {
  const e = await roomEnv();
  const f = installFetch({ contents: [track("t1")], fail: { "GET /me/player": "down" } });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    assert.match(html, /<p class="quietline" role="status">Spotify could not be reached/);
    assert.ok(!/replaceState/.test(html), "nothing rides in the URL any more, so nothing has to leave it");
  } finally { f.restore(); }
});

test("a cached zero is re-read after a minute; any other cached count keeps the ten", async () => {
  const e = await roomEnv();
  const stale = Date.now() - 120_000;
  await putTile(e, P(2), { name: "Hank", count: 0, runtime: "0:00", cover: null, at: stale });
  await putTile(e, P(7), { name: "The Selector", count: 3, runtime: "9:00", cover: null, at: stale });
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
    // Button 2's zero was two minutes old, so it was read again and found a
    // track: Play is offered. Button 7's three was trusted and not re-read.
    assert.match(html, /action="\/buttons\/[^/]+\/hank\/play"/);
    assert.equal(f.calls.filter((c) => c === `GET /playlists/${P(2)}`).length, 1, "button 2 re-read");
    assert.equal(f.calls.filter((c) => c === `GET /playlists/${P(7)}`).length, 0, "button 7 served from cache");
  } finally { f.restore(); }
});

// ------------------------------------------ taking a DJ off, 2026-09-05
//
// A move with no destination. The owner asked for the inverse of the drag —
// a DJ pulled down to the bench — and the decision, recorded in
// docs/roster.md, is that "off" means the NAME goes and the songs stay: an
// empty playlist on a preset is a dead button, and a drag on a phone must
// not be able to make one. So the button is renamed for nobody, dressed in
// the plain sleeve, cleared of its working state, and the wall says who left.
// Reached three ways — the bench_dj tool, the picker's own row, and a drop
// onto the bench in Rearrange — all through one function.


test("the wall carries no bench: the drop bar is the one take-off target, and the tab bar steps aside for it", async () => {
  // Two shapes used to matter here — a bare bench (everybody on a button)
  // that had to be on the page for the drop, and a full one with two hints.
  // Since MC-14 (2026-09-11) the bench is the DJs tab and the wall lists the
  // presets only; the drop bar slides up while a band is lifted and the tab
  // bar hides, because the drag's hit-test measures that bottom region.
  for (const e of [await roomEnv(), (() => {
    const all = makeEnv();
    all.PROGRAM_LIBRARY_KEY = KEY;
    all.BUTTONS = JSON.stringify(Object.keys(ROSTER).map((dj, i) => ({ button: i + 1, dj, playlist: P(i + 1) })));
    return all;
  })()]) {
    const f = installFetch({ contents: [track("t1")] });
    try {
      const html = await (await worker.fetch(page(`/buttons/${KEY}`), e)).text();
      assert.ok(!html.includes('id="bench"') && !html.includes("benchdrop") && !html.includes("benchtap"));
      assert.ok(!/Waiting for a preset|nobody waiting/.test(html));
      assert.match(html, /<div class="dropbar" id="dropbar" role="button" aria-label="Take the picked DJ off their preset">/);
      const css = html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
      assert.match(css, /\.lifting \.dropbar\{display:flex;position:fixed;/);
      assert.match(css, /\.lifting \.tabbar\{display:none\}/);
      assert.ok(!/\.zone\.bare|\.benchdrop|\.benchtap|#bench/.test(css), "the bench's rules went with it");
    } finally { f.restore(); }
  }
});

// -------------------------------------- the scripts actually run, 2026-09-05
//
// The room pages' CSP named no script-src, so `default-src 'none'` blocked
// every inline script on the live house from the day the wall shipped —
// Rearrange, the submit guard, the haptics — and nothing here noticed: the
// suite reads markup, and the browser runs opened a file with no header.
// Found by serving the rendered page under the real header after the owner
// could not make Rearrange do anything on the phone. Now a per-response
// nonce, on the header and on every tag.

test("every inline script on a room page carries the nonce the header names, and no tag is bare", async () => {
  const e = await roomEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    for (const path of [`/buttons/${KEY}`, `/buttons/${KEY}/djs`, `/buttons/${KEY}/hank`, `/buttons/${KEY}/wiim`]) {
      const res = await worker.fetch(page(path), e);
      const csp = res.headers.get("content-security-policy");
      const nonce = csp.match(/script-src 'nonce-([a-f0-9]{32})'/)?.[1];
      assert.ok(nonce, `${path}: ${csp}`);
      assert.match(csp, /connect-src 'self'/);
      const html = await res.text();
      const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      assert.ok(!path.endsWith("/wiim") || tags.length >= 1, "the speakers page has the submit guard");
      for (const t of tags) assert.equal(t, `<script nonce="${nonce}">`, `${path}: ${t}`);
    }
    // Two responses, two nonces.
    const a = (await worker.fetch(page(`/buttons/${KEY}`), e)).headers.get("content-security-policy");
    const b = (await worker.fetch(page(`/buttons/${KEY}`), e)).headers.get("content-security-policy");
    assert.notEqual(a, b);
  } finally { f.restore(); }
});
