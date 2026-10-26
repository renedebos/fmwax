// THE BAR, THE DJs TAB AND THE HOME SCREEN (MC-14, 2026-09-11).
//
// Four tabs fixed to the bottom of every keyed page — Loaded, DJs, Shelf,
// Speakers — so every function is one tap from anywhere; four links and no
// script, the active one decided by the route. The DJs tab is a new page:
// every DJ, one row each, with a tile saying their state, and it took the
// bench off the wall. The manifest and the icons are what a phone needs to
// open the site full-screen from its Home Screen. The plan is
// tasks/done/mc14-tab-bar.md.
import { test } from "node:test";
import assert from "node:assert/strict";

import vm from "node:vm";
import worker from "../worker.js";
import { barWords, songOf, listOf } from "../programs.js";
import { ROSTER } from "../djs.js";
import { makeEnv, installFetch, track, buttons } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;

function env() {
  const e = makeEnv();
  e.BUTTONS = buttons({
    1: P(1), 2: P(2), 3: P(3), 4: P(4), 5: P(5), 6: true, 7: P(7), 8: P(8),
    9: P(19), 10: P(20), 11: P(21),
  });
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Everywhere"]);
  // A house whose WiiM it can read keeps the Loaded tab (a door-made house's
  // presets are on Speakers instead: test/speakers-door.test.js).
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57" });
  return e;
}
const get = (path) => new Request(`https://x.test${path}`);
const head = (path) => new Request(`https://x.test${path}`, { method: "HEAD" });
const post = (path, body) => new Request(`https://x.test${path}`, {
  method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });

// The Librarian's, on 3 (the Professor's until the owner cut him, 2026-10-15).
async function seedProgram(e, slug, { dj = "The Librarian" } = {}) {
  await e.PROGRAMS.put(`program:${slug}`, JSON.stringify({
    title: "A Program", thesis: "The premise sentence.", dj, created: "2026-08-28T10:00:00Z",
    playlistId: P(3), sections: [],
  }), { metadata: { title: "A Program", dj, created: "2026-08-28T10:00:00Z", tracks: 12, runtime: "40:00" } });
}

const bar = (html) => html.match(/<nav class="tabbar" aria-label="Sections">[\s\S]*?<\/nav>/)?.[0] ?? null;

// THE MATRIX (MC-15): the same walk twice — without OPENAI_API_KEY the bar is
// the four tabs it was; with it, five, Talk last, and the Talk page itself
// is one of the keyed pages that carry it.
async function barMatrix(withTalk) {
  const e = env();
  if (withTalk) e.OPENAI_API_KEY = "sk-test";
  await seedProgram(e, "one-aaaaaa");
  const f = installFetch({ contents: [track("t1")] });
  // Speakers first, Loaded fourth, since 2026-09-27 (the owner).
  const tabs = [`/buttons/${KEY}/wiim`, `/buttons/${KEY}/djs`, `/notes/${KEY}`, `/buttons/${KEY}`,
    ...(withTalk ? [`/buttons/${KEY}/talk`] : [])];
  const labels = ["Speakers", "DJs", "Shelf", "Loaded", ...(withTalk ? ["Talk"] : [])];
  try {
    const pages = [
      [`/buttons/${KEY}`, "presets"],
      [`/buttons/${KEY}/djs`, "djs"],
      [`/buttons/${KEY}/hank`, "djs"],
      [`/buttons/${KEY}/archive`, "djs"],
      [`/buttons/${KEY}/programs/one-aaaaaa`, "shelf"],
      [`/notes/${KEY}`, "shelf"],
      [`/buttons/${KEY}/wiim`, "speakers"],
      [`/buttons/${KEY}/use`, "speakers"],
      ...(withTalk ? [[`/buttons/${KEY}/talk`, "talk"]] : []),
    ];
    for (const [path, active] of pages) {
      const res = await worker.fetch(get(path), e);
      assert.equal(res.status, 200, path);
      const html = await res.text();
      const nav = bar(html);
      assert.ok(nav, `${path} carries the bar`);
      assert.equal((html.match(/<nav class="tabbar"/g) ?? []).length, 1, `${path} carries it once`);
      // The links, in order, each with the key in it.
      const hrefs = [...nav.matchAll(/<a class="tab[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(hrefs, tabs, path);
      // Exactly one is on, and it is the route's.
      const on = [...nav.matchAll(/<a class="tab on" href="([^"]+)" aria-current="page">/g)].map((m) => m[1]);
      assert.equal(on.length, 1, `${path}: one tab on`);
      const want = { presets: `/buttons/${KEY}`, djs: `/buttons/${KEY}/djs`, shelf: `/notes/${KEY}`,
        speakers: `/buttons/${KEY}/wiim`, talk: `/buttons/${KEY}/talk` }[active];
      assert.equal(on[0], want, `${path}: ${active} is on`);
      // The words, and nothing but links inside: no script does the switching.
      for (const label of labels) assert.ok(nav.includes(`<span>${label}</span>`), `${path}: ${label}`);
      assert.ok(!nav.includes("<span>Talk</span>") || withTalk, `${path}: no Talk without a key`);
      assert.ok(!/<script|<button|<form/.test(nav));
      // The page pads its bottom for BOTH bars (MC-21: the now bar's 56px on
      // top of the tab bar's 64).
      assert.match(html, /class="page [^"]*tabbed[^"]*"/, `${path} is a tabbed page`);
      assert.match(html, /\.page\.tabbed\{padding-bottom:calc\(64px \+ 56px \+ env\(safe-area-inset-bottom\) \+ 1\.5rem\)\}/);
      assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
      // THE NOW BAR (MC-21), on every one of these pages EXCEPT THE SHELF,
      // exactly once, and directly above the tab bar. The Shelf's went on
      // 2026-09-22: it could only repeat the flash above it or say it did not
      // know, and a bar that merely opened the Speakers tab would have sat on
      // top of the Speakers tab. Its own test pins the absence.
      const hasBar = !path.startsWith("/notes/");
      assert.equal((html.match(/<div class="nowbar/g) ?? []).length, hasBar ? 1 : 0,
        `${path} ${hasBar ? "carries one now bar" : "carries none"}`);
      if (!hasBar) continue;
      assert.match(html, /<div class="nowbar[^"]*"[^>]*>[\s\S]*?<\/div>(<script[^>]*>[\s\S]*?<\/script>)?<nav class="tabbar"/, `${path}: the bar sits on the tab bar`);
      // Every page that still has a bar fills it with the same script.
      assert.ok(html.includes("window.__nowbar = paint;"), `${path}: carries the bar script`);
      // THREE BUTTONS SINCE 2026-09-23 (item 9 of the owner's review): the
      // strip and the sliders button open the panel, and only the disc
      // touches the music. Never a form, so nothing carries you off the page.
      const barHtml = html.match(/<div class="nowbar[\s\S]*?<\/div>(<script[^>]*>[\s\S]*?<\/script>)?<nav class="tabbar"/)[0].replace(/<script[^>]*>[\s\S]*<\/script>/, "");
      assert.ok(!/<form/.test(barHtml), `${path}: no form in the bar`);
      assert.match(barHtml, /<button type="button" class="nbsay" aria-haspopup="dialog" aria-controls="nbsheet" aria-label="What is playing — speaker and more">/, `${path}: the strip opens the panel`);
      assert.match(barHtml, /<button type="button" class="nbmore" aria-haspopup="dialog" aria-controls="nbsheet" aria-label="Speaker, Spotify and more">/, `${path}: and so does the sliders button`);
      assert.equal((barHtml.match(/<button/g) ?? []).length, 3, `${path}: three buttons in the bar`);
      // The panel after the tab bar, empty until opened (design A,
      // 2026-09-25): skip either side of the pause, the DJ row, the
      // speakers, the links; no Speakers tab row, the tab bar has it.
      assert.match(html, /<\/nav><div class="nbsheet" id="nbsheet" hidden>[\s\S]*?data-skip="prev"[\s\S]*?class="nbtb nbmain"[\s\S]*?data-skip="next"[\s\S]*?class="nbdj"[\s\S]*?class="nbchips"/, `${path}: the panel`);
      assert.ok(!html.includes('<span>Speakers tab</span>'), `${path}: no Speakers tab row`);
      assert.match(barHtml, /<button type="button" class="nbdisc" data-pause="[^"]+\/wiim\/transport"/, `${path}: and it is the pause`);
      // And the drag hides it with the tab bar, or it would sit over the drop
      // target the wall's hit-test measures.
      assert.match(html, /\.lifting \.nowbar\{display:none\}/);
    }
  } finally { f.restore(); }
}
test("every keyed page carries the bar, with the right tab on and every link carrying the key", () => barMatrix(false));
test("with a voice in the house the bar is five tabs, Talk last, on every keyed page and on Talk itself", () => barMatrix(true));

test("the bar is on no public page and no refusal", async () => {
  const e = env();
  await seedProgram(e, "pub-aaaaaa");
  const f = installFetch({ contents: [track("t1")] });
  try {
    const pub = await (await worker.fetch(get(`/programs/pub-aaaaaa`), e)).text();
    assert.ok(!bar(pub), "a public program page names no key and gets no bar");
    assert.ok(!pub.includes("manifest.webmanifest") && !pub.includes("apple-mobile-web-app-capable"),
      "and none of the Home Screen metas, which would name the key");
    const refusal = await worker.fetch(get(`/buttons/${KEY}/hank/play`), e);
    assert.equal(refusal.status, 405);
    assert.ok(!bar(await refusal.text()), "a refusal is a sentence and a way back");
  } finally { f.restore(); }
});

test("the bar's script is real JavaScript, and its words are the server's own", async () => {
  // THE ONE PLACE THE SEVEN STATES ARE WRITTEN. The script carries barWords
  // by inlining its source, so the server's rendering and the page's cannot
  // drift into saying different things about one state. Two ways that could
  // break silently, both pinned here: the inlining could emit something that
  // is not valid JavaScript (a page whose bar then never fills at all), and
  // a later edit to barWords could make the two disagree.
  const e = env();
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/djs`), e)).text();
    const src = html.match(/<script[^>]*>([\s\S]*?window\.__nowbar[\s\S]*?)<\/script>/)?.[1];
    assert.ok(src, "the DJs tab carries the bar's script");
    new vm.Script(src);  // throws on a syntax error, which is the whole point
    const inlined = eval(`(${src.match(/var words = ([\s\S]*?);\n  var songOf/)[1]})`);
    for (const o of [
      { state: "playing", track: "Cry Tough", artists: "Alton Ellis", device: "Ultra", preset: { btn: 8, name: "The Selector" } },
      { state: "paused", track: "Cry Tough", artists: "Alton Ellis", device: "Ultra", preset: { btn: 8, name: "The Selector" } },
      { state: "playing", track: "X", artists: "Y", device: "Pro Plus", from: "an album" },
      { state: "playing", track: "X", artists: null, device: null },
      { state: "quiet" }, { state: "unknown" },
      { state: "throttled", mins: 40 }, { state: "throttled", mins: 1 }, { state: "throttled" },
      {},
    ]) {
      assert.deepEqual(inlined(o), barWords(o), `the two disagree about ${JSON.stringify(o)}`);
    }
    // And the quiet ones are not interchangeable: "not known" is never
    // "nothing playing", which is the house's rule for the whole bar.
    assert.equal(barWords({ state: "quiet" }).one, "Not on Spotify");
    assert.equal(barWords({ state: "unknown" }).one, "Can't reach Spotify right now");
    // "paused" is no longer a state /playing answers (2026-09-22). If a stale
    // page ever hands the bar one, it falls through to "not known", never to
    // a claim that the speaker is idle.
    assert.equal(barWords({ state: "paused", track: "X", device: "Ultra" }).one, "Can't reach Spotify right now");
    assert.equal(barWords({ state: "throttled", mins: 1 }).one, "Not known for about 1 minute");
  } finally { f.restore(); }
});

test("the Shelf has no now bar at all, and still spends nothing to draw itself", async () => {
  // IT HAD ONE, and it was redundant or useless and never anything else
  // (2026-09-22, the owner: "is an option to not have a bar at all?").
  // Right after a Play it named the set the flash at the top of this page
  // already names; any other time it said "Not known from here", because
  // this page may not ask Spotify -- its link has been shared, so a page
  // view must not spend the account's token -- and the ten-second memo it
  // fell back on is per-isolate and never warms here. The middle way was
  // worse: a bar reading "What is playing" that opens the Speakers tab
  // would sit directly on top of the Speakers TAB.
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  const f = installFetch();
  try {
    const plain = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    assert.ok(!plain.includes('class="nowbar'), "no bar");
    assert.ok(!plain.includes("Can't reach Spotify"), "and nothing claiming to know");
    assert.ok(!/<script/.test(plain), "still script-free");
    assert.deepEqual(f.calls, [], "and still no outbound call to draw the page");
    // The tab bar is untouched -- the Shelf is still a tab, and Speakers is
    // one tap away, which is what the bar would have been for.
    assert.match(plain, /<nav class="tabbar"/);
    assert.match(plain, new RegExp(`<a class="tab on" href="/notes/${KEY}" aria-current="page">`));
    assert.match(plain, new RegExp(`href="/buttons/${KEY}/wiim"`), "Speakers is a tap away");
    // Landing from a Play: the flash still says what started; no bar repeats it.
    const played = await (await worker.fetch(get(`/notes/${KEY}?played=ok&on=Pro+Plus&slug=one-aaaaaa`), e)).text();
    assert.match(played, /Playing “A Program” on Pro Plus/, "the flash, as before");
    assert.ok(!played.includes('class="nowbar'), "and still no bar");
    // And it pads for the tab bar ALONE, or it would end in 56px of nothing.
    assert.match(played, /<article class="page notes tabbed nobar">/);
    assert.match(played, /\.page\.tabbed\.nobar\{padding-bottom:calc\(64px \+ env\(safe-area-inset-bottom\) \+ 1\.5rem\)\}/);
  } finally { f.restore(); }
});

test("the Shelf stays script-free under its CSP, and the CSP admits the manifest", async () => {
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  const f = installFetch();
  try {
    const res = await worker.fetch(get(`/notes/${KEY}`), e);
    const html = await res.text();
    assert.ok(bar(html));
    assert.ok(!/<script/.test(html), "no script on the Shelf, bar included");
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /manifest-src 'self'/);
    assert.ok(!/script-src/.test(csp));
    assert.match(html, /<title>Shelf<\/title>/);
    assert.match(html, /<h1>Shelf<\/h1>/);
    // The old /library prefix is gone (2026-10-18).
    assert.equal((await worker.fetch(get(`/library/${KEY}`), e)).status, 404);
    // The keyed room pages admit it too.
    const room = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.match(room.headers.get("content-security-policy"), /manifest-src 'self'; script-src 'nonce-/);
  } finally { f.restore(); }
});

test("the DJs tab lists every DJ once, with a tile that says their state", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}/djs`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>DJs<\/title>/);
    assert.match(html, /<h1>DJs<\/h1>/, "the index, not a DJ named djs");
    assert.match(html, /<main class="page wall deck tabbed" data-base="\/buttons\/[^"]+">/);
    const rows = [...html.matchAll(/<li class="drow"><a href="\/buttons\/[^/"]+\/([a-z0-9-]+)" aria-label="Open ([^—]+) — ([^"]+)"[^>]*>(<span class="dtile[^"]*"[^>]*>[^<]*<\/span>)/g)]
      .map((m) => ({ key: m[1], name: m[2].trim(), state: m[3], tile: m[4] }));
    // Every roster DJ, plus the archive, exactly once.
    const keys = rows.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length, "no DJ twice");
    assert.equal(keys.length, Object.keys(ROSTER).length + 1, "every roster DJ and the archive");
    // The wall first, by number; the archive with its number, filled like the
    // guests since 2026-09-14 (the app decides what it plays), never a move.
    const hank = rows.find((r) => r.key === "hank");
    assert.equal(hank.tile, `<span class="dtile num" aria-hidden="true">2</span>`);
    assert.equal(hank.state, "on preset 2");
    const arch = rows.find((r) => r.key === "archive");
    assert.equal(arch.tile, `<span class="dtile num" aria-hidden="true">6</span>`);
    assert.equal(arch.state, "the archive, preset 6");
    // The rest after it, alphabetical, with no number: not Crate or Ask (the
    // owner, 2026-09-14: "annoying").
    const benchRows = rows.filter((r) => r.state === "on no preset");
    // Nine on the wall since the cut of 2026-10-15 (ten before; 11, Hip
    // Hop's, is empty here), so one on the bench: Americana.
    assert.equal(benchRows.length, Object.keys(ROSTER).length - 9);
    // A to Z with "The" and "Dr." aside (by role, 2026-09-28): The Selector under S.
    const bare = (n) => n.replace(/^(The|Dr\.)\s+/i, "");
    assert.deepEqual(benchRows.map((r) => r.name), [...benchRows.map((r) => r.name)].sort((a, b) => bare(a).localeCompare(bare(b))));
    for (const r of benchRows) assert.equal(r.tile, `<span class="dtile blank" aria-hidden="true"></span>`);
    // Grouped by role (2026-09-28) in place of "On a preset": a DJ on a
    // preset of their own is a house DJ, the archive its own group.
    assert.ok(!html.includes('class="chips filter"'), "no filter chips");
    assert.match(html, /<h2 class="dlabel">House DJs<\/h2>\s*<ul class="drows dgrid">/);
    assert.match(html, /<h2 class="dlabel">The archive<\/h2>/);
    assert.match(html, /<h2 class="dlabel">Everyone else<\/h2>/);
    assert.ok(!html.includes("On a preset"));
    assert.ok(html.indexOf("House DJs") < html.indexOf(`/${KEY}/hank"`) && html.indexOf(`/${KEY}/hank"`) < html.indexOf("Everyone else"));
    // Filled where the app keeps a set of theirs; pale for the rest.
    assert.match(html, new RegExp(`/${KEY}/hank" aria-label="[^"]*" class="dcard fill" data-btns="2">`));
    assert.match(html, new RegExp(`/${KEY}/${benchRows[0].key}" aria-label="[^"]*" class="dcard" data-btns="">`));
    const benchOnly = await (await worker.fetch(get(`/buttons/${KEY}/djs?show=bench`), e)).text();
    assert.ok(!/dtile num/.test(benchOnly), "the bench filter shows no numbers");
    assert.ok(!benchOnly.includes("House DJs"), "an old ?show= link still narrows to everyone else");
    const junk = await (await worker.fetch(get(`/buttons/${KEY}/djs?show=neon`), e)).text();
    assert.ok(junk.includes("House DJs") && junk.includes("Everyone else"), "an unknown filter shows everything");
    // Whose preset plays: the bar tells the page each answer, the page marks the square.
    assert.match(html, /dispatchEvent\(new CustomEvent\("house:now"/);
    assert.match(html, /addEventListener\("house:now"/);
    // Nothing on this page writes or lifts.
    assert.ok(!/<form|data-dj=|data-btn=/.test(html));
    // The Crate tile, for a benched DJ with a crate, is covered in
    // crate.test.js; here nobody has one (the help fold names the word).
    assert.ok(!html.includes('dtile word">Crate'));
  } finally { f.restore(); }
});

test("the DJs route is guarded like the rest: wrong key bare 404, POST refused, GET only", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const wrong = await worker.fetch(get(`/buttons/wrongwrongwrong1/djs`), e);
    assert.equal(wrong.status, 404);
    assert.equal(await wrong.text(), "not found");
    const posted = await worker.fetch(post(`/buttons/${KEY}/djs`, "x=1"), e);
    assert.equal(posted.status, 405);
  } finally { f.restore(); }
});

test("the manifest is keyed and says what a phone needs; the icons are public PNGs", async () => {
  const e = env();
  const f = installFetch();
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}/manifest.webmanifest`), e);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/manifest+json");
    const m = JSON.parse(await res.text());
    assert.equal(m.name, "fmwax");
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, `/buttons/${KEY}/wiim`, "opens on Speakers (the owner, 2026-09-27), with the key");
    assert.equal(m.scope, "/", "so the Shelf, on its other prefix, stays inside the app");
    assert.equal(m.theme_color, "#2C3E5C");
    assert.equal(m.background_color, "#EDEDE9");
    assert.deepEqual(m.icons.map((i) => [i.src, i.sizes, i.type, i.purpose]), [
      ["/icon-192.png", "192x192", "image/png", "any"],
      ["/icon-512.png", "512x512", "image/png", "any"],
    ]);
    const wrong = await worker.fetch(get(`/buttons/wrongwrongwrong1/manifest.webmanifest`), e);
    assert.equal(wrong.status, 404);
    for (const name of ["icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
      const icon = await worker.fetch(get(`/${name}`), e);
      assert.equal(icon.status, 200, name);
      assert.equal(icon.headers.get("content-type"), "image/png");
      const bytes = new Uint8Array(await icon.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name} is a PNG`);
      assert.ok(bytes.length > 500, `${name} has a picture in it`);
      const h = await worker.fetch(head(`/${name}`), e);
      assert.equal(h.status, 200);
    }
    // Every keyed page links the manifest and wears the Apple metas.
    const wall = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(wall, new RegExp(`<link rel="manifest" href="/buttons/${KEY}/manifest.webmanifest">`));
    assert.match(wall, /<meta name="apple-mobile-web-app-capable" content="yes">/);
    assert.match(wall, /<meta name="theme-color" content="#2C3E5C">/);
    assert.match(wall, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/);
  } finally { f.restore(); }
});

// ============================================ stage 2: Put <DJ> on a preset
//
// The reverse of the picker: a DJ first, then the number. The sheet's rows
// are links into the picker's own confirm sheet, so the words and the one
// write stay the picker's, and the press comes back to the DJ's page.

// ===================================== the program page, inside the app
//
// The owner, on the phone, from the Home Screen (2026-09-11): "there is no
// way back from the program notes." The public page links nowhere on
// purpose and, opened as an app, there is no browser back. So inside the
// app a program opens on its keyed twin — same record, same renderer, the
// bar and a way back — and the public page is untouched.

test("inside the app a program page wears the bar and a way back; the public page still does not", async () => {
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  const f = installFetch({ contents: [track("t1")] });
  try {
    // From a DJ's page: back to that DJ, under the DJs tab.
    const res = await worker.fetch(get(`/buttons/${KEY}/programs/one-aaaaaa?from=hank`), e);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store", "keyed, so never cached");
    const html = await res.text();
    assert.match(html, /<article class="page tabbed">/);
    assert.match(html, new RegExp(`<a class="shellback" href="/buttons/${KEY}/hank">‹ Hank</a>`));
    assert.match(bar(html), /<a class="tab on" href="[^"]+\/djs" aria-current="page">/);
    assert.match(html, /<h1>A Program<\/h1>/, "the same page");
    assert.match(html, /\.tabbar\{position:fixed;/, "the bar's own rules ride along");
    assert.match(html, new RegExp(`<link rel="manifest" href="/buttons/${KEY}/manifest.webmanifest">`));
    // One script and one only, the now bar's, under this response's nonce:
    // a reading page has no folding or forms to script, and a bar that was
    // there but never filled would be the stuck placeholder MC-21 exists to
    // remove. The public page below still carries none.
    const nonce = res.headers.get("content-security-policy").match(/script-src 'nonce-([0-9a-f]+)'/)[1];
    assert.equal((html.match(/<script/g) ?? []).length, 1, "one script on a keyed program page");
    assert.ok(html.includes(`<script nonce="${nonce}">`), "and it is under the nonce");
    assert.match(html, /window\.__nowbar = paint;/, "and it is the bar's");
    const openHtml = await (await worker.fetch(get(`/programs/one-aaaaaa`), e)).text();
    assert.ok(!/<script/.test(openHtml), "still no script on the public program page");
    assert.ok(!openHtml.includes('class="nowbar'), "and no bar: it names no key");
    // From the Shelf, or from nowhere in particular: back to the Shelf.
    const plain = await (await worker.fetch(get(`/buttons/${KEY}/programs/one-aaaaaa`), e)).text();
    assert.match(plain, new RegExp(`<a class="shellback" href="/notes/${KEY}">‹ Shelf</a>`));
    assert.match(bar(plain), /<a class="tab on" href="\/notes\/[^"]+" aria-current="page">/);
    const junk = await (await worker.fetch(get(`/buttons/${KEY}/programs/one-aaaaaa?from=nobody-here`), e)).text();
    assert.match(junk, /‹ Shelf</, "an unknown from is the Shelf");
    const arch = await (await worker.fetch(get(`/buttons/${KEY}/programs/one-aaaaaa?from=archive`), e)).text();
    assert.match(arch, new RegExp(`<a class="shellback" href="/buttons/${KEY}/archive">‹ ${ARCHIVE.name}</a>`));
    // The public page: no bar, no way back, no key anywhere, cacheable as before.
    const pub = await worker.fetch(get(`/programs/one-aaaaaa`), e);
    const pubHtml = await pub.text();
    assert.ok(!bar(pubHtml) && !pubHtml.includes("shellback") && !pubHtml.includes(KEY));
    assert.match(pubHtml, /<article class="page">/);
    assert.ok(pub.headers.get("etag"));
    // Guarded like the rest.
    assert.equal((await worker.fetch(get(`/buttons/wrongwrongwrong1/programs/one-aaaaaa`), e)).status, 404);
    assert.equal((await worker.fetch(get(`/buttons/${KEY}/programs/nope-zzzzzz`), e)).status, 404);
  } finally { f.restore(); }
});

test("the app's pages link a program to its keyed twin, with the way back set", async () => {
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  await e.PROGRAMS.put(`current:${P(3)}`, "one-aaaaaa");
  const f = installFetch({ contents: [track("t1")] });
  try {
    // The DJ's page: the Program chip and the shelf's cards carry ?from=<dj>
    // (a grid of cards since board A, 2026-09-25: the cover and the title).
    const dj = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    assert.match(dj, new RegExp(`<a class="chipbtn" href="/buttons/${KEY}/programs/one-aaaaaa\\?from=the-librarian">Program`));
    assert.match(dj, new RegExp(`<a class="coverlink" href="/buttons/${KEY}/programs/one-aaaaaa\\?from=the-librarian"`));
    assert.match(dj, new RegExp(`<span class="ctitle"><a href="/buttons/${KEY}/programs/one-aaaaaa\\?from=the-librarian">A Program</a></span>`));
    assert.ok(!dj.includes("https://example.test/programs/"), "no public link on a keyed page");
    // The Shelf: the keyed page, back to the Shelf.
    const shelf = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    // The card's cover and its title both open it (the grid, 2026-09-23).
    assert.match(shelf, new RegExp(`<a class="coverlink" href="/buttons/${KEY}/programs/one-aaaaaa"`));
    assert.match(shelf, new RegExp(`<span class="ctitle"><a href="/buttons/${KEY}/programs/one-aaaaaa">A Program</a></span>`));
    // And that page's way back is the Shelf.
    const own = await (await worker.fetch(get(`/buttons/${KEY}/programs/one-aaaaaa`), e)).text();
    assert.match(own, new RegExp(`href="/notes/${KEY}"`));
    assert.ok(!shelf.includes("https://example.test/programs/"));
  } finally { f.restore(); }
});

// ===================== what is loaded, said once and in the right place
//
// The owner, on the phone with Dutch's page (2026-09-11): the new set was
// named under the coloured block and again in the list at the foot; the
// block's facts line counted tracks and shelf pages on one line; "take it
// off the shelf" sat with whatever was loaded rather than with the page it
// deletes; and a request that was playing was told nothing would play.

test("the coloured block names what is loaded, and the facts line counts only its tracks", async () => {
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  await e.PROGRAMS.put(`current:${P(3)}`, "one-aaaaaa");
  const f = installFetch({ contents: [track("t1"), track("t2")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    const head = html.slice(html.indexOf('<header class="djhead">'), html.indexOf("</header>"));
    assert.match(head, /<p class="vload"><span class="vtag">Loaded earlier · <\/span>A Program<\/p>/,
      "the block says what it holds, by name");
    assert.match(head, /<p class="vfacts">2 tracks · /, "and counts its own tracks");
    // Beside the Play circle, in one row (board A, 2026-09-25).
    assert.match(head, /<div class="vrow"><form class="vact"[\s\S]*<p class="vload">[\s\S]*<p class="vfacts">[^<]*<\/p><\/div>/);
    assert.ok(!/program/.test(head.slice(head.indexOf("vfacts"))), "never the shelf's pages");
    // The section under it no longer repeats the name: it is the ask, the
    // tracklist and the way to the page.
    assert.ok(!html.includes('<p class="online">'), "no second naming under the block");
    assert.match(html, /<h2 class="blabel vh" id="holdsh">/, "and the section's heading is said, not shown");
    assert.match(html, /<a class="chipbtn" href="[^"]+\/programs\/one-aaaaaa\?from=the-librarian">Program/);
    // The count went to the shelf's own heading, where it has something to count.
    assert.match(html, /<h2 class="blabel">On the shelf <small>1 program<\/small><\/h2>/);
  } finally { f.restore(); }
});

test("a playing set says Playing, by name, and its request card does not claim silence", async () => {
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  await e.PROGRAMS.put(`current:${P(3)}`, "one-aaaaaa");
  const f = installFetch({ contents: [track("t1")] });
  // The player answers with this DJ's own playlist, so the page is playing.
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({
        is_playing: true, progress_ms: 1000, device: { name: "Pro Plus" },
        item: { name: "Track t1", uri: "spotify:track:t1", type: "track",
          duration_ms: 200000, artists: [{ name: "Someone" }], album: { name: "A" } },
        context: { uri: `spotify:playlist:${P(3)}` },
      }), { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    assert.match(html, /<p class="vload"><span class="vtag"><span class="plv" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span>Playing · <\/span>A Program<\/p>/);
    // And the ready row, when one is open, does not tell a room that is
    // playing that nothing will play (the owner, 2026-09-11).
    assert.ok(!html.includes("Nothing will play until someone presses Play"));
  } finally { globalThis.fetch = inner; f.restore(); }
});

// BOARD A (2026-09-25): the DJ page's shelf is a grid of cards, and Delete
// lives on each program's own page — the one a card opens — as it has on the
// Shelf since 2026-09-23. The unkeep route still takes return=<dj>.
test("every kept row, setlist or essay, opens the page that carries its own delete", async () => {
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  await seedProgram(e, "two-bbbbbb");
  // A setlist and an essay: since 2026-09-13 the endpoint deletes both, so
  // both pages reach for it (the owner: "add a delete button for those too").
  for (const [slug, shape] of [["one-aaaaaa", "setlist"], ["two-bbbbbb", "session"]]) {
    const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    // The slug too, as a real record has it: a program's page finds its
    // controls by it.
    await e.PROGRAMS.put(`program:${slug}`, JSON.stringify({ ...rec, slug, shape }), {
      metadata: { title: rec.title, dj: rec.dj, created: rec.created, shape,
        tracks: 12, runtime: "40:00" } });
  }
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    const rowOf = (slug) => {
      const at = html.indexOf(`/programs/${slug}`, html.indexOf('<ul class="djgrid">'));
      return at < 0 ? "" : html.slice(html.lastIndexOf("<li class=", at), html.indexOf("</li>", at));
    };
    for (const slug of ["one-aaaaaa", "two-bbbbbb"]) {
      assert.match(rowOf(slug), new RegExp(`<a href="/buttons/${KEY}/programs/${slug}\\?from=the-librarian">`),
        `${slug}'s card opens its page`);
    }
    // The fold left the DJ page with the Load forms.
    assert.ok(!html.includes("Take it off the shelf"));
    assert.ok(!new RegExp(`action="/notes/${KEY}/unkeep"`).test(html), "no delete on the DJ page");
    // Each program's page carries it, with the warning on the way to the control.
    const setlist = await (await worker.fetch(get(`/buttons/${KEY}/programs/one-aaaaaa?from=the-librarian`), e)).text();
    assert.match(setlist, new RegExp(`action="/notes/${KEY}/unkeep"`));
    assert.match(setlist, /name="slug" value="one-aaaaaa"/);
    assert.ok(setlist.indexOf("There is no undo") < setlist.indexOf("Delete for good</button>"),
      "the warning is on the way to the control");
    const essay = await (await worker.fetch(get(`/buttons/${KEY}/programs/two-bbbbbb?from=the-librarian`), e)).text();
    assert.match(essay, /Deletes this program for good/, "an essay's page carries it too");
    assert.match(essay, /name="slug" value="two-bbbbbb"/);
    // And the route still lands on the DJ's page when told to.
    const res = await worker.fetch(post(`/notes/${KEY}/unkeep`,
      new URLSearchParams({ slug: "one-aaaaaa", return: "the-librarian" }).toString()), e);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}/the-librarian?put=removed`);
    assert.equal(await e.PROGRAMS.get("program:one-aaaaaa"), null, "and the page is gone");
  } finally { f.restore(); }
});

test("the strip opens the record it names in Spotify, and only then (the song-link canvas, A, 2026-09-23)", () => {
  const url = "https://open.spotify.com/track/cs";
  const live = { state: "playing", track: "Cold Sweat", artists: "James Brown", device: "Pro Plus", song: url };
  assert.deepEqual(songOf(live, barWords(live)), { url, title: "Cold Sweat" });
  // Held by the bar's own pause: the record it names.
  const held = { state: "quiet", paused: { track: "Cry Tough", device: "Ultra", song: url } };
  assert.deepEqual(songOf(held, barWords(held)), { url, title: "Cry Tough" });
  // Quiet, elsewhere, unknown, throttled: nothing to open, the strip opens Speakers.
  for (const o of [{ state: "quiet" }, { state: "quiet", speaker: "Ultra", elsewhere: "Pro Plus" },
    { state: "unknown" }, { state: "throttled", mins: 3 }, { state: "playing", track: "X" }]) {
    assert.equal(songOf(o, barWords(o)), null, JSON.stringify(o));
  }
});

test("the panel also opens the playlist the record plays from, and only then (the owner, 2026-09-23)", () => {
  const list = "https://open.spotify.com/playlist/SAMPLEPLAYLIST00000013";
  const live = { state: "playing", track: "Sir Duke", device: "Pro Plus", list };
  assert.deepEqual(listOf(live, barWords(live)), { url: list });
  const held = { state: "quiet", paused: { track: "Sir Duke", device: "Pro Plus", list } };
  assert.deepEqual(listOf(held, barWords(held)), { url: list });
  for (const o of [{ state: "quiet" }, { state: "unknown" }, { state: "playing", track: "X" }]) {
    assert.equal(listOf(o, barWords(o)), null, JSON.stringify(o));
  }
});

test("the bar reads the same on every page: no endless line on it (the owner, 2026-09-23)", () => {
  const base = { state: "playing", track: "Sir Duke", artists: "Stevie Wonder", device: "Pro Plus", preset: { btn: 4, name: "Vibe" } };
  assert.equal(barWords({ ...base, endless: { last: false, until: "23:50" } }).two, "Pro Plus · preset 4, Vibe");
});

test("back on a page, the bar and the page's poll read past the server's ten-second memo (2026-09-26)", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    for (const path of [`/buttons/${KEY}`, `/buttons/${KEY}/wiim`, `/buttons/${KEY}/djs`]) {
      const html = await (await worker.fetch(get(path), e)).text();
      assert.ok(/if \(Date\.now\(\) - asked > 5000\) ask\(true\);/.test(html) || /Date\.now\(\) - asked > 5000\) ask\(true\);/.test(html), `${path}: a fresh ask on return`);
      assert.match(html, /fresh=1/, path);
    }
  } finally { f.restore(); }
});

// THE HOUSE RULES IN THE APP (2026-09-26): docs/house-rules.md, copied into
// rules.js by `npm run rules`, shown at /rules.
test("the house rules page shows docs/house-rules.md, and the copy in rules.js is current", async () => {
  const { readFileSync } = await import("node:fs");
  const { RULES_DOC, RULES_MODULE, render } = await import("../install/rules.js");
  assert.equal(readFileSync(RULES_MODULE, "utf8"), render(readFileSync(RULES_DOC, "utf8")),
    "rules.js is behind docs/house-rules.md: run `npm run rules`");
  const { rulesHtml } = await import("../programs.js");
  const html = rulesHtml("# T\n\nAbout editing.\n\n## A\n\nOne **two** [`X`] <i>.\n\n| K | W |\n|---|---|\n| **1** | x |\n\n- a\n  b\n- c\n\n1. one\n2. two");
  assert.ok(!html.includes("About editing"), "the page's own opening words are left out");
  assert.match(html, /<span class="rfh">A<\/span>/, "a section is a fold under its title");
  assert.match(html, /<p>One <b>two<\/b> &lt;i&gt;\.<\/p>/, "bold kept, the bracket note dropped, text escaped");
  assert.match(html, /<table class="rtable"><thead><tr><th scope="col">K<\/th><th scope="col">W<\/th><\/tr><\/thead><tbody><tr><th scope="row"><b>1<\/b><\/th><td>x<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<ul><li>a b<\/li><li>c<\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

test("/rules answers on the key with the house rules, and the Speakers, Loaded and DJs pages link to it", async () => {
  const e = env();
  const f = installFetch();
  try {
    assert.equal((await worker.fetch(new Request(`https://x.test/buttons/${KEY}x/rules`), e)).status, 404);
    const res = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/rules`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1>House rules<\/h1>/);
    assert.ok(html.includes("<h2>All the rules</h2>"));
    for (const h of ["Which speaker", "Safety"]) {
      assert.ok(html.includes(`<span class="rfh">${h}</span>`), h);
    }
    assert.ok(!/PICK_FIRM_S|house\.json/.test(html), "the notes for whoever edits the code are left out");
    for (const p of ["/wiim", "", "/djs"]) {
      const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}${p}`), e)).text();
      assert.ok(page.includes(`href="/buttons/${KEY}/rules"`), `linked from ${p || "Loaded"}`);
    }
  } finally { f.restore(); }
});

// THE LAST FIVE FROM THE UI REVIEW (2026-09-26).
test("the Shelf searches titles and DJs without a script, and an archive set wears a reel", async () => {
  const { renderLibrary } = await import("../programs.js");
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, title: `Set ${i}`, dj: i % 2 ? "Hank" : "The Librarian", catalog: "spotify" }));
  rows.push({ id: "stax", title: "Mack Rice at Stáx", dj: "The Librarian", catalog: "spotify" });
  rows.push({ id: "irish", title: "All the Irish", dj: ARCHIVE.name, catalog: "files" });
  const self = "/notes/k";
  const html = renderLibrary(rows, { self, room: "/buttons/k", q: "stax librarian" });
  assert.match(html, /<b>1<\/b> program matching “stax librarian”/, "every word, accents aside, in the title or the DJ");
  assert.match(html, /<form class="shfind" role="search" method="get" action="\/notes\/k">/);
  assert.match(html, /<a class="shclear" href="\/notes\/k" aria-label="Clear the search">/);
  assert.ok(!/<script/.test(html), "still script-free");
  assert.match(renderLibrary(rows, { self, room: "/buttons/k", q: "zzz" }), /Nothing on the shelf matches “zzz”\./);
  assert.match(renderLibrary(rows, { self, room: "/buttons/k" }), /<span class="noart reel" aria-hidden="true"><svg/);
  assert.ok(!renderLibrary(rows.slice(0, 5), { self, room: "/buttons/k" }).includes('class="shfind"'), "no search on a short shelf");
});

test("Talk hides an empty last exchange; the DJs tab's play is a thumb's size; links out wear ↗", async () => {
  const P = await import("../programs.js");
  const talk = P.renderTalk({ base: "/buttons/k", devices: ["Pro Plus"], defaultDevice: "Pro Plus" });
  assert.match(talk, /<section class="block lastex" aria-labelledby="exh">/);
  assert.match(talk, /\.talk \.lastex:not\(\.said\)\{display:none\}/);
  assert.match(talk, /if \(piece\) \{ var lx = el\.closest && el\.closest\("\.lastex"\); if \(lx\) lx\.classList\.add\("said"\); \}/,
    "shown from the first words, and not hidden again by a press");
  const src = (await import("node:fs")).readFileSync(new URL("../programs.js", import.meta.url), "utf8");
  assert.match(src, /\.deck \.dplay button::after\{content:"";position:absolute;inset:-5px/, "34 px disc, 44 px to hit");
  // In the More sheet since "A DJ's Page, Calmer" (2026-10-24): the row's
  // mark is the ↗, as a link out wears it.
  assert.match(src, /icon\("out", 20\)\}<\/span><span class="puttx">Playlist in Spotify/);
  assert.match(src, /<details class="putfold mhelp"><summary>[^\n]*How this works/);
});

// THE ADVERSARIAL REVIEW'S FIXES (2026-09-27).
test("a picker following the one speaker writes nothing, so a tap on the bar's panel holds", async () => {
  const P = await import("../programs.js");
  const talk = P.renderTalk({ base: "/buttons/k", devices: ["Pro Plus", "Ultra"], defaultDevice: "Pro Plus" });
  // A choice in the speaker pill's sheet (2026-10-24) counts as a person's, though script sends it.
  assert.match(talk, /if \(!following\) remember\(sel, !e\.isTrusted && !chosen\);/);
  assert.match(talk, /document\.addEventListener\("house:picked", function \(e\) \{ follow\(e\.detail && e\.detail\.slug\); \}\);/);
  // Run the picker script against a tiny DOM: a panel tap stamps the cookie,
  // house:pick moves the select, and the cookie keeps its stamp.
  const script = talk.match(/<script>\s*\(function \(\) \{\s*function pickGet[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g, "");
  const listeners = {}, doc = { cookie: "" };
  const opts = [{ value: "Pro Plus" }, { value: "Ultra" }];
  const sel = { options: opts, selectedIndex: 1, get value() { return opts[this.selectedIndex].value; }, hasAttribute: () => false,
    _h: [], addEventListener(t, f) { this._h.push(f); }, dispatchEvent(ev) { this._h.forEach((f) => f(ev)); } };
  const cookieJar = { v: "spk=ultra" };
  const document = { get cookie() { return cookieJar.v; }, set cookie(c) { cookieJar.v = c.split(";")[0]; },
    querySelectorAll: () => [sel], addEventListener(t, f) { (listeners[t] ??= []).push(f); },
    dispatchEvent(ev) { (listeners[ev.type] ?? []).forEach((f) => f(ev)); } };
  class CustomEvent { constructor(type, o) { this.type = type; this.detail = o?.detail; } }
  class Event { constructor(type) { this.type = type; this.isTrusted = false; } }
  new Function("document", "localStorage", "CustomEvent", "Event", script)(document, { getItem: () => null, setItem() {} }, CustomEvent, Event);
  const now = Math.floor(Date.now() / 1000);
  cookieJar.v = `spk=pro-plus.${now}`;                 // the panel's tap
  document.dispatchEvent(new CustomEvent("house:pick"));
  assert.equal(sel.value, "Pro Plus", "the picker follows");
  assert.equal(cookieJar.v, `spk=pro-plus.${now}`, "and the tap keeps its stamp");
  document.dispatchEvent(new CustomEvent("house:picked", { detail: { slug: "ultra" } }));
  assert.equal(sel.value, "Ultra");
  assert.equal(cookieJar.v, `spk=pro-plus.${now}`, "following the bar writes nothing either");
  sel.selectedIndex = 0; sel.dispatchEvent({ type: "change", isTrusted: true });
  assert.match(cookieJar.v, /^spk=pro-plus\.\d+$/, "a person's change is still a choice");
});

test("the Shelf keeps its search through a Play, and cuts a long one by characters", async () => {
  const { __test } = await import("../worker.js");
  const P = await import("../programs.js");
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, title: `Set ${i}`, dj: i % 2 ? "Hank" : "Monk", catalog: "spotify" }));
  const long = "a".repeat(79) + "😀";
  const html = P.renderLibrary(rows, { self: "/notes/k", room: "/buttons/k", q: long,
    play: { action: "/notes/k/play", devices: ["Pro Plus"], device: "Pro Plus" } });
  assert.ok(html.includes("😀"), "the emoji is kept whole, and nothing throws");
  const hk = P.renderLibrary(rows, { self: "/notes/k", room: "/buttons/k", q: "set 1",
    play: { action: "/notes/k/play", devices: ["Pro Plus"], device: "Pro Plus" } });
  assert.match(hk, /<form method="post" action="\/notes\/k\/play" id="play" class="playbar">[\s\S]*?<input type="hidden" name="q" value="set 1">/);
  assert.match(hk, /href="\/buttons\/k\/programs\/p1\?q=set%201"/, "a card opens its program with the search");
  const { shelfFilter, shelfFilterQs } = await import("../shelf.js");
  assert.equal(shelfFilterQs(shelfFilter("hank", "tidal", " stax & co ")), "&dj=hank&svc=tidal&q=stax%20%26%20co");
  assert.equal(shelfFilter(null, null, "\u0000").q, null);
  assert.ok(__test);
});

// A NAME SHADOWED INSIDE THE BAR'S SCRIPT (2026-09-27): paint() declared
// `var one`, the bar's own first line, and the line stopped changing — the
// bar said "Paused · Mission Control" over Tidal playing on the Ultra. No
// function in the bar's script may redeclare a name the script's top level
// holds.
test("no function in the now bar's script shadows the script's own top-level names", async () => {
  const acorn = await import("acorn");
  const { nowBar } = await import("../programs.js");
  const js = nowBar({ base: "/buttons/k" }).match(/<script>([\s\S]*?)<\/script>/)[1];
  const ast = acorn.parse(js, { ecmaVersion: 2022 });
  // (function () { … })(), after the sheets' motion (window.houseSheet, 2026-10-24)
  const iife = ast.body.find((st) => st.expression?.type === "CallExpression").expression.callee.body;
  const top = new Set();
  for (const st of iife.body) {
    if (st.type === "VariableDeclaration") st.declarations.forEach((d) => d.id.type === "Identifier" && top.add(d.id.name));
    if (st.type === "FunctionDeclaration") top.add(st.id.name);
  }
  const clashes = [];
  const walk = (node, inFn) => {
    if (!node || typeof node.type !== "string") return;
    const fn = /Function/.test(node.type);
    if (inFn && node.type === "VariableDeclaration") node.declarations.forEach((d) => top.has(d.id?.name) && clashes.push(d.id.name));
    if (inFn && fn) (node.params ?? []).forEach((p) => p.type === "Identifier" && top.has(p.name) && clashes.push(p.name));
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach((c) => walk(c, inFn || fn)); else if (v && typeof v.type === "string") walk(v, inFn || fn);
    }
  };
  // inlineFn's wrapper is see-through: the function it returns stands at the
  // top, as it did inlined bare, and its own parameters are its own.
  const unwrap = (n) => n?.type === "CallExpression" && n.callee?.type === "FunctionExpression" && !n.callee.params.length &&
    n.callee.body.body[0]?.declarations?.[0]?.id?.name === "__name" ? n.callee.body.body[1].argument : n;
  for (const st of iife.body) if (st.type === "VariableDeclaration") st.declarations.forEach((d) => { d.init = unwrap(d.init); });
  iife.body.forEach((st) => walk(st, false));
  assert.ok(top.has("one") && top.has("two"), "the check sees the script's names");
  assert.deepEqual(clashes, [], `shadowed: ${clashes.join(", ")}`);
});
