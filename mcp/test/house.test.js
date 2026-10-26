// The house: BUTTONS in wrangler.toml is the only place that says which DJ
// sits on which preset, holding which playlist, on which catalog. The Worker
// used to know this itself; these pin that it no longer does, that a broken
// house fails the parse rather than quietly becoming a different house, and
// that a Tidal button is a button like any other — written through Tidal,
// read through Tidal, and started from the remote rather than from a page.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { PERSONAS, ROSTER } from "../djs.js";
import { makeEnv, installFetch, installTidalFetch, track, PID, TPID, buttons, HOUSE, getTile, dropTile } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const { callTool, parseButtons, house, findDj, parseAliases, trackRecord } = __test;

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const get = (path) => new Request(`https://x.test${path}`);

// ------------------------------------------------------------ the parse

test("BUTTONS is read as a JSON string or as the array wrangler hands over", () => {
  const list = [{ button: 3, dj: "the-librarian", playlist: P(3) }];
  for (const raw of [JSON.stringify(list), list]) {
    const [b] = parseButtons(raw);
    assert.deepEqual(b, {
      btn: 3, button: "button 3", key: "the-librarian", archive: false,
      catalog: "spotify", playlist: P(3),
    });
  }
  assert.deepEqual(parseButtons(undefined), []);
  assert.deepEqual(parseButtons(""), []);
});

test("a playlist may be given as an id, a URI or a URL, and is kept as the id", () => {
  for (const ref of [P(3), `spotify:playlist:${P(3)}`, `https://open.spotify.com/playlist/${P(3)}?si=x`]) {
    assert.equal(parseButtons([{ button: 3, dj: "the-librarian", playlist: ref }])[0].playlist, P(3));
  }
});

test("buttons come back in preset order whatever order they were written in", () => {
  const out = parseButtons([
    { button: 8, dj: "the-librarian", playlist: P(8) },
    { button: 6, archive: true },
    { button: 1, dj: "dr-funkenstein", playlist: P(1) },
  ]);
  assert.deepEqual(out.map((b) => b.btn), [1, 6, 8]);
  assert.deepEqual(out[1], {
    btn: 6, button: "button 6", key: "archive", archive: true, catalog: null, playlist: null,
  });
});

test("a broken house fails the parse rather than becoming a smaller house", () => {
  const bad = [
    ["not json", /not valid JSON/],
    [JSON.stringify({ button: 1 }), /must be a list/],
    [[null], /must be an object/],
    [[{ button: 0, dj: "hank", playlist: P(2) }], /preset number/],
    [[{ button: "two", dj: "hank", playlist: P(2) }], /preset number/],
    [[{ button: 2, dj: "hank", playlist: P(2) }, { button: 2, dj: "vibe", playlist: P(4) }], /button 2 twice/],
    [[{ button: 2, dj: "hank", playlist: P(2) }, { button: 4, dj: "hank", playlist: P(4) }], /Hank on two buttons/],
    [[{ button: 2, dj: "the-dj-we-never-had", playlist: P(2) }], /not in the roster — one of dr-funkenstein/],
    [[{ button: 2, dj: "constructor", playlist: P(2) }], /not in the roster/],
    [[{ button: 2, dj: "hank", playlist: "not-a-playlist" }], /Spotify playlist id, URI or URL/],
    [[{ button: 2, dj: "hank" }], /"playlist" is missing/],
    [[{ button: 2, dj: "hank", playlist: P(2), catalog: "napster" }], /not one of spotify, tidal/],
    [[{ button: 2, dj: "hank", playlist: TPID, catalog: "tidal" }, { button: 6, archive: true, dj: "hank" }], /archive button carries no dj/],
    [[{ button: 2, dj: "hank", catalog: "tidal" }], /"playlist" is missing/],
    // The id shapes are disjoint, so an id on the wrong service is a config
    // error the parse can see — not a button that 404s on its first read.
    [[{ button: 2, dj: "hank", playlist: P(2), catalog: "tidal" }], /Tidal playlist id \(a UUID\), tidal:playlist: URI/],
    [[{ button: 2, dj: "hank", playlist: TPID, catalog: "spotify" }], /Spotify playlist id, URI or URL/],
    [[{ button: 2, dj: "hank", playlist: "abc", catalog: "tidal" }], /Tidal playlist id \(a UUID\)/],
  ];
  for (const [raw, why] of bad) {
    assert.throws(() => parseButtons(raw), why, JSON.stringify(raw));
  }
});

// A slot with no `dj` used to be a parse error. It is legal now, because the
// wall in KV is what says who is on a button and a house may be installed
// with one standing empty — the playlist is still required, since that is the
// part a preset points at and the part nothing here can change.
test("a button may be installed with nobody on it, but never without a playlist", () => {
  const [b] = parseButtons([{ button: 2, playlist: P(2) }]);
  assert.equal(b.key, null);
  assert.equal(b.playlist, P(2));
  assert.throws(() => parseButtons([{ button: 2, dj: "" }]), /"playlist" is missing/);
  // Two empty slots are not "the same DJ twice".
  assert.equal(parseButtons([{ button: 2, playlist: P(2) }, { button: 4, playlist: P(4) }]).length, 2);
});

test("a Tidal button parses in Tidal's own shapes, kept as the lowercase id, and no default sneaks in", () => {
  const upper = "0B1F2C3D-AAAA-BBBB-CCCC-000000000002";
  for (const ref of [upper, `tidal:playlist:${upper}`, `https://listen.tidal.com/playlist/${upper}`,
    `https://tidal.com/browse/playlist/${upper}?u`]) {
    const [b] = parseButtons([{ button: 2, dj: "hank", playlist: ref, catalog: "Tidal" }]);
    assert.equal(b.catalog, "tidal", ref);
    assert.equal(b.playlist, upper.toLowerCase(), ref);
  }
});

// ------------------------------------------------------------ the house

test("an archive DJ can be asked but never placed — a persona, not a roster member", () => {
  // The archive's own DJ: it has a brief, it takes requests, it programs
  // by the night and the room. It is NOT on the roster, because its recordings
  // are not on Spotify or Tidal and no preset could hold a note of them. So it
  // has to be findable and unplaceable at once (2026-09-07).
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: P(2) });

  assert.ok(PERSONAS[ARCHIVE.dj], "it is a persona");
  assert.ok(!ROSTER[ARCHIVE.dj], "and not on the roster");
  assert.equal(Object.keys(PERSONAS).length, Object.keys(ROSTER).length + 1);

  // Askable: found by name and by alias, and it carries a brief.
  const dj = findDj(e, ARCHIVE.name.toLowerCase());
  assert.equal(dj?.name, ARCHIVE.name);
  assert.equal(dj.brief, ARCHIVE.brief);
  assert.equal(findDj(e, "the archive")?.key, ARCHIVE.dj, "and by alias");

  // Unplaceable: never offered as somebody who could take a preset, and the
  // config refuses to seat them.
  assert.ok(!house(e).roster.some((d) => d.key === ARCHIVE.dj));
  const seated = makeEnv();
  seated.BUTTONS = JSON.stringify([{ button: 3, dj: ARCHIVE.dj, playlist: P(3) }]);
  assert.throws(() => house(seated), /belongs to an archive and cannot be put on a preset/);

});

test("every persona is in the house, dressed with a button or with none", () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 3: P(3), 6: true });
  const h = house(e);
  // The ROSTER is every persona in djs.js; HOUSE is only the ten this fixture
  // puts on buttons. They were the same number until Camille and Monk, which
  // is exactly the confusion this line now cannot make — and the same number
  // again since the cut of 2026-10-15, which it still cannot. The Librarian
  // stands on 3, the Professor's until then.
  assert.equal(h.roster.length, Object.keys(ROSTER).length);
  assert.equal(h.djs["the-librarian"].button, "button 3");
  assert.equal(h.djs["the-librarian"].btn, 3);
  assert.equal(h.djs["the-librarian"].catalog, "spotify");
  assert.equal(h.djs["the-librarian"].playlist, P(3));
  assert.equal(h.djs["the-librarian"].key, "the-librarian");
  // Hank is still Hank in a house with no button for him.
  assert.equal(h.djs.hank.name, "Hank");
  assert.equal(h.djs.hank.button, null);
  assert.equal(h.djs.hank.btn, null);
  assert.equal(h.djs.hank.catalog, null);
  assert.deepEqual(h.archive, {
    btn: 6, button: "button 6", key: "archive", archive: true, catalog: null, playlist: null,
  });
  // No house at all is a house with nobody on the wall, not an error.
  const bare = house(makeEnv());
  assert.equal(bare.buttons.length, 0);
  assert.equal(bare.archive, null);
  assert.equal(bare.djs.hank.button, null);
});

test("a slug from a URL cannot find a DJ in Object.prototype", () => {
  const h = house(makeEnv());
  for (const slug of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(h.djs[slug], undefined, slug);
  }
});

test("the house is parsed once per config string, and again when it changes", () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 3: P(3) });
  const a = house(e);
  assert.equal(house(e), a);
  e.BUTTONS = buttons({ 3: P(8) });
  const b = house(e);
  assert.notEqual(b, a);
  assert.equal(b.djs["the-librarian"].playlist, P(8));
});

test("findDj answers from the house, so the same name carries its button", () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 1: P(1) });
  assert.equal(findDj(e, "doc").button, "button 1");
  assert.equal(findDj(e, "Dr. Funkenstein").key, "dr-funkenstein");
  assert.equal(findDj(e, "ken"), null);
  assert.equal(findDj(e, "nobody"), null);
});

// ------------------------------------------------------------ the labels

test("the label map is the buttons' own labels plus the free-standing aliases, each with its catalog", () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 3: P(3), 6: true });
  e.PLAYLIST_ALIASES = JSON.stringify({ scratch: PID, replay: `tidal:playlist:${TPID}` });
  const sp = (id) => ({ catalog: "spotify", id });
  assert.deepEqual(parseAliases(e), {
    "button 3": sp(P(3)), scratch: sp(PID), replay: { catalog: "tidal", id: TPID },
  });
  // A Tidal button is a label like any other, and says which service it is.
  e.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  assert.deepEqual(parseAliases(e)["button 2"], { catalog: "tidal", id: TPID });
  // A value no service can read is kept, unparsed, for the one call that
  // reaches for it to refuse — a bad alias must not take the others down.
  e.PLAYLIST_ALIASES = JSON.stringify({ scratch: PID, junk: "not-a-playlist" });
  assert.deepEqual(parseAliases(e).junk, { catalog: null, id: null, raw: "not-a-playlist" });
});

test("an alias that maps to nothing readable is refused when used, and only then", async () => {
  const e = makeEnv();
  e.PLAYLIST_ALIASES = JSON.stringify({ scratch: PID, junk: "not-a-playlist" });
  const f = installFetch({ contents: [] });
  try {
    const out = await callTool(e, "read_playlist", { playlist: "scratch" }, { remaining: 40 });
    assert.equal(out.id, PID);
    await assert.rejects(
      () => callTool(e, "read_playlist", { playlist: "junk" }, { remaining: 40 }),
      /alias "junk" maps to "not-a-playlist", which is not a playlist id or URI/);
  } finally { f.restore(); }
});

test("a button label left behind in PLAYLIST_ALIASES is refused, not merged", () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 3: P(3) });
  for (const stale of ["button 3", "Button 4", "button12"]) {
    e.PLAYLIST_ALIASES = JSON.stringify({ [stale]: P(5) });
    assert.throws(() => parseAliases(e), /belong in BUTTONS now/, stale);
  }
});

// ------------------------------------------------------------ a Tidal button

test("a Tidal button is written and read through Tidal, and Spotify is never asked", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ contents: ["1", "2"] });
  try {
    // Spotify URIs into a Tidal button: refused before the playlist is read.
    await assert.rejects(
      () => callTool(e, "replace_playlist",
        { playlist: "button 2", uris: ["spotify:track:x"] }, { remaining: 40 }),
      /"Scratch" is a Tidal playlist and these are not Tidal track URIs: spotify:track:x[\s\S]*Nothing was changed/);
    assert.ok(!td.calls.some((c) => c.includes("/relationships/items")), "nothing was read or written");

    const out = await callTool(e, "replace_playlist",
      { playlist: "button 2", uris: ["tidal:track:7", "tidal:track:8"] }, { remaining: 40 });
    assert.equal(out.resolved_via, 'alias "button 2"');
    assert.equal(out.tracks, 2);
    assert.deepEqual(td.state.items.map((it) => it.trackId), ["7", "8"]);

    const read = await callTool(e, "read_playlist", { playlist: "button 2" }, { remaining: 40 });
    assert.equal(read.catalog, "tidal");
    assert.equal(read.configured_dj, "Hank");
    assert.deepEqual(read.tracks.map((t) => t.uri), ["tidal:track:7", "tidal:track:8"]);
    assert.equal("live" in read, false, "no Spotify player is asked about a Tidal playlist");
    assert.deepEqual(sp.calls, [], "Spotify saw nothing, not even a token refresh");
  } finally { td.restore(); sp.restore(); }
});

test("a Tidal button is started from the remote, and every path that would start it says so", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ contents: ["1"] });
  try {
    await assert.rejects(
      () => callTool(e, "play_playlist", { playlist: "button 2" }, { remaining: 40 }),
      /"Scratch" is a Tidal playlist, and this server can only start Spotify[\s\S]*Press 2 on the remote \(Hank's button\)[\s\S]*nothing was sent/);
    assert.deepEqual(sp.calls, [], "no play command went anywhere");

    // The page's play POST refuses in the same words; the card never offers it.
    const play = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/hank/play`,
      { method: "POST", body: new URLSearchParams() }), e);
    assert.equal(play.status, 400);
    assert.match(await play.text(), /Hank sits on a Tidal preset[\s\S]*Press 2 on the remote/);
    assert.deepEqual(sp.calls, []);

    // The DJ page renders, lists the tracks, and says where the press is.
    const page = await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("press 2 on the remote"), "the page says where to press");
    assert.ok(!html.includes(`/buttons/${KEY}/hank/play`), "no Play form for a Tidal button");
    assert.ok(html.includes("Track 1"), "the tracklist came from Tidal");
    const grid = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(grid.status, 200);
    assert.ok((await grid.text()).includes("Hank"));
  } finally { td.restore(); sp.restore(); }
});

// The sleeve on a Tidal tile comes off Tidal's image host, in the 320 the
// ladder offers above the floor, and the page's CSP has to let that host
// through or the tile shows its typographic face with the sleeve blocked.
test("a DJ on a Tidal button wears the same face as on Spotify, and the page still admits both hosts", async () => {
  // The grid and the room header used to draw the playlist's own cover, which
  // on Tidal is the collage Tidal builds and cannot be replaced — the reason
  // Hank came home from preset 12. They draw the persona's face now, served
  // from art/covers/, so the catalog makes no difference to what a button
  // looks like. The tile cache still records the sleeve (the DJ page's shelf
  // and anything else that wants the service's picture read it from there),
  // and the CSP still names both hosts for the shelf rows' sleeves.
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ contents: ["1"] });
  try {
    const sleeve = "https://resources.tidal.com/images/00000000/0000/0000/0000/000000000000/320x320.jpg";
    // Since 2026-09-05 neither page draws a face, and since 2026-09-11 (Full
    // deleted) neither paints a persona's colour either: one slate family
    // for every band and every DJ page, which makes the catalog just as
    // invisible. Neither draws the service's collage. (The covers still go
    // to Spotify, where the app shows them, in the persona's colour.)
    for (const path of [`/buttons/${KEY}`, `/buttons/${KEY}/hank`]) {
      const res = await worker.fetch(get(path), e);
      const html = await res.text();
      assert.ok(!/--(?:dj-)?fill:#C9962B/.test(html), `${path} paints no persona colour`);
      assert.ok(!html.includes("/covers/hank.jpg"), `${path} draws no face`);
      assert.ok(!html.includes(`<img src="${sleeve}"`), `${path} does not draw Tidal's collage`);
      const csp = res.headers.get("content-security-policy");
      assert.match(csp, /img-src 'self'/, `${path} admits its own faces`);
      assert.match(csp, /img-src [^;]*https:\/\/resources\.tidal\.com/, `${path} still admits Tidal's host`);
      assert.match(csp, /img-src [^;]*https:\/\/i\.scdn\.co/, "and still Spotify's");
    }
    const tile = await getTile(e, TPID);
    assert.equal(tile.cover, sleeve, "the cached tile still carries the sleeve");
  } finally { td.restore(); sp.restore(); }
});

test("a problem on a Tidal button names Tidal, not Spotify", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ fail: { [`GET /playlists/${TPID}`]: "down" } });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(html.includes("Tidal could not be read just now"), "the outage names the service asked");
    assert.ok(!html.includes("Spotify could not be read"));
  } finally { td.restore(); sp.restore(); }
});

test("a card whose press could only refuse offers no Play: off the wall, or on a Tidal button", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([
    { button: 1, dj: "dr-funkenstein", playlist: P(1), catalog: "spotify" },
    { button: 2, dj: "hank", playlist: "0b1f2c3d-aaaa-bbbb-cccc-000000000002", catalog: "tidal" },
  ]);
  const f = installFetch({ contents: [track("aaa")] });
  // A Tidal button WITH a set: an empty one says "no set yet" instead
  // (2026-09-06), and a Tidal read answered by the Spotify fake reads as
  // empty, so the Tidal fake is needed here.
  const td = installTidalFetch({ contents: ["1"] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    const forms = [...html.matchAll(/action="\/buttons\/[^/]+\/([a-z-]+)\/play"/g)].map((m) => m[1]);
    assert.deepEqual(forms, ["dr-funkenstein"], "only the Spotify button can be started from the page");
    assert.ok(html.includes("Use remote"), "a Tidal band on the wall says to use the remote");
    // Off the wall used to be a card reading "not on a button here", then a
    // ZONE under the wall — the bench. Since MC-14 (2026-09-11) the bench is
    // the DJs tab: the wall carries no bench section, and the tab counts them.
    assert.ok(!html.includes('id="bench"'), "the bench left the wall");
    assert.ok(!html.includes("not on a button here"));
    const deck = await (await worker.fetch(get(`/buttons/${KEY}/djs`), e)).text();
    const asking = deck.slice(deck.indexOf('<h2 class="dlabel">Everyone else</h2>'));
    assert.equal((asking.match(/<li class="drow">/g) ?? []).length, Object.keys(ROSTER).length - 2);
    // One flat list, the DJ's own summary in each row (2026-09-05 — the axis
    // word was the picker's vocabulary, and a person scanning the bench wants
    // to know what the Professor IS — the Librarian since he was cut,
    // 2026-10-15); the grouped list with headings is the picker's.
    assert.ok(!/<h3 class="axis">/.test(deck), "no axis headings on the DJs tab");
    assert.match(deck, /<span class="dsum">Draws a fence around a subject/);
  } finally { td.restore(); f.restore(); }
});

// A set published to a playlist its DJ's button no longer points at cannot be
// put back from a page — activateProgram refuses the re-pointed alias and the
// page reports the bounce without a reason. Found the evening Hank moved to
// Tidal: his Spotify-era setlist offered "Load on preset", bounced, and the
// flash blamed "something else has been loaded since". The row says why now,
// and says where to ask when the service is what changed.
// Narrowed 2026-09-04. This used to refuse any row whose playlist differed
// from its DJ's button, which under the tenancy is what moving buttons IS —
// the set follows its writer and the record moves with it. The refusal is now
// about the SERVICE alone, which is the half that genuinely cannot work: a
// Tidal-era program holds Tidal URIs and a Spotify button cannot take them.
test("a shelf row from the other service says so instead of offering the form", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([
    { button: 3, dj: "the-librarian", playlist: P(3), catalog: "spotify" },
    { button: 12, dj: "hank", playlist: TPID, catalog: "tidal" },
  ]);
  const seed = (slug, dj, playlistId, created) => e.PROGRAMS.put(`program:${slug}`,
    JSON.stringify({ slug, title: slug, thesis: "A premise.", dj, created, sections: [],
      ...(playlistId ? { playlistId } : {}) }),
    { metadata: { title: slug, dj, created, tracks: 3, runtime: "10:00", shape: "setlist" } });
  await seed("hank-moved-1a2b3c", "Hank", P(2), "2026-09-02T05:00:00Z");
  await seed("hank-here-4d5e6f", "Hank", TPID, "2026-09-02T06:00:00Z");
  await seed("prof-moved-7g8h9i", "The Librarian", P(9), "2026-09-02T07:00:00Z");
  await seed("prof-unknown-0j1k2l", "The Librarian", null, "2026-09-02T08:00:00Z");
  const sp = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ contents: ["1"] });
  try {
    const dj = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // The Shelf's rows gave their controls to each program's own page with
    // the grid (2026-09-23), so "the shelf" here is those pages, read together.
    let shelf = "";
    for (const slug of ["hank-moved-1a2b3c", "hank-here-4d5e6f", "prof-moved-7g8h9i", "prof-unknown-0j1k2l"]) {
      shelf += await (await worker.fetch(get(`/buttons/${KEY}/programs/${slug}`), e)).text();
    }
    // The DJ page's shelf is a grid of cards since board A (2026-09-25): each
    // opens its program's page, and the form and the note live there.
    for (const slug of ["hank-moved-1a2b3c", "hank-here-4d5e6f"]) {
      assert.ok(dj.includes(`<a href="/buttons/${KEY}/programs/${slug}?from=hank">`), `the DJ page opens ${slug}`);
    }
    assert.ok(!/aria-label="Load /.test(dj), "and offers no form of its own");
    {
      // The re-pointed rows carry the note and no form; the others keep the
      // form. Matched on the Put button's label: a kept setlist also has a
      // "take off the shelf" form, and that one must stay.
      const forms = [...shelf.matchAll(/aria-label="Load ([a-z0-9-]+) on (?:the )?preset/g)].map((m) => m[1]);
      assert.ok(!forms.includes("hank-moved-1a2b3c"), "no form for the Spotify-era set");
      assert.ok(forms.includes("hank-here-4d5e6f"), "the set on this playlist keeps its form");
      assert.ok(shelf.includes("Recorded on Spotify — Hank’s preset is on Tidal now. Ask for it again there."),
        "the note names the service that changed and where to ask");
    }
    // A re-pointing WITHIN one service keeps its form now: the Professor's set
    // was published to another Spotify playlist, his button is Spotify, and
    // putting it back moves the record with it.
    const forms = [...shelf.matchAll(/aria-label="Load ([a-z0-9-]+) on (?:the )?preset/g)].map((m) => m[1]);
    assert.ok(forms.includes("prof-moved-7g8h9i"), "same service, so the form stands");
    assert.ok(forms.includes("prof-unknown-0j1k2l"), "an unpointed record cannot be checked here");
    assert.ok(!shelf.includes("no longer points at"), "and the old sentence is gone");
    assert.ok(!shelf.includes("Recorded on Spotify — The Librarian"), "same service, so no service named");
    assert.match(shelf, /\.pacts \.elsewhere\{/, "and the note has a style of its own");
  } finally { td.restore(); sp.restore(); }
});

// ------------------------------------------------------------ the archive verbs

test("a house with no archive preset is neither shown nor sold the archive tools", async () => {
  // The two verbs are titled after this family's tapes and play_archive writes
  // an m3u under a key that defaults to its name. A household installing the
  // roster on its own presets has no archive, and would otherwise be handed
  // two tools that can only fail — one of them a WRITE.
  const e = makeEnv();
  e.BUTTONS = buttons({ 3: P(3) });

  const names = (env) => __test.toolsWithMeta(env).map((t) => t.name);
  const without = names(e);
  assert.ok(!without.includes("search_archive"), "not listed");
  assert.ok(!without.includes("play_archive"), "nor the write");
  assert.ok(without.includes("get_dj"), "the rest of the list is untouched");

  // And refused when called anyway: a client that cached the list before the
  // button went away still holds the name.
  for (const name of ["search_archive", "play_archive"]) {
    await assert.rejects(
      () => callTool(e, name, {}, { remaining: 40 }),
      /this house has none/, `${name} refuses in a sentence`);
  }

  // The same house with an archive line gets both back.
  const withArchive = makeEnv();
  withArchive.BUTTONS = buttons({ 3: P(3), 6: true });
  const listed = names(withArchive);
  assert.ok(listed.includes("search_archive") && listed.includes("play_archive"));
  assert.equal(listed.length, without.length + 2, "and nothing else moved");

  // AN ARCHIVE BUTTON WITH NO INDEX CONFIGURED says so (2026-09-07). The two
  // JSON files naming what takes exist were constants pointing at one
  // household's website until then; as config they can be missing, and the
  // one thing this must never do is quietly read somebody else's recordings.
  const noIndex = makeEnv();
  noIndex.BUTTONS = buttons({ 3: P(3), 6: true });
  delete noIndex.ARCHIVE_OCCURRENCES_URL;
  delete noIndex.ARCHIVE_TRACKS_URL;
  await assert.rejects(
    () => callTool(noIndex, "search_archive", { song: "anything" }, { remaining: 40 }),
    /no archive index configured/,
    "it names the missing config rather than borrowing an index");
});

// ------------------------------------------------------------ the roster as served

test("get_dj lists the house's buttons and their catalogs, and a DJ off the wall has neither", async () => {
  const e = makeEnv();
  e.BUTTONS = JSON.stringify([
    { button: 3, dj: "the-librarian", playlist: P(3), catalog: "spotify" },
    { button: 2, dj: "hank", playlist: TPID, catalog: "tidal" },
  ]);
  const all = await callTool(e, "get_dj", {}, { remaining: 40 });
  assert.equal(all.djs.length, Object.keys(ROSTER).length);
  const prof = all.djs.find((d) => d.name === "The Librarian");
  assert.equal(prof.button, "button 3");
  assert.equal(prof.catalog, "spotify");
  const hank = all.djs.find((d) => d.name === "Hank");
  assert.equal(hank.button, "button 2");
  assert.equal(hank.catalog, "tidal", "the catalog rides with the button, so search_tracks can be told");
  const vibe = all.djs.find((d) => d.name === "Vibe");
  assert.equal("button" in vibe, false);
  assert.equal("catalog" in vibe, false);
  const one = await callTool(e, "get_dj", { name: "librarian" }, { remaining: 40 });
  assert.equal(one.button, "button 3");
  assert.equal(one.catalog, "spotify");
  assert.ok(one.example_asks.length > 0);
});

test("a house with no archive preset has no archive card and no archive page", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 1: P(1), 2: P(2) });
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes(ARCHIVE.name));
    // The archive card's "Press 6 on the remote"; the bar's script carries
    // "press play on the remote" on every page since 2026-10-17.
    assert.ok(!/Press \d+ on the remote/.test(html));
    assert.ok(html.includes(`content="The programs on the presets: whose set is on each, and since when."`));
    const page = await worker.fetch(get(`/buttons/${KEY}/archive`), e);
    assert.equal(page.status, 404);
    assert.match(await page.text(), /no archive preset/);
  } finally { f.restore(); }
});

test("the archive card sits on whichever preset the house gives it", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 1: P(1), 4: true });
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    // The archive has had no band on the presets wall since 2026-09-22 — the
    // Speakers tab lists the twelve — so what this pins is the CONFIG: the
    // house puts the archive on 4, and the archive page says 4 and not 6.
    assert.ok(!html.includes('class="band fixed slim managed"'), "no archive band on the wall");
    assert.ok(!html.includes(`/buttons/${KEY}/archive`), "and no door from it");
    await e.TOKENS.put(`m3u:${ARCHIVE.key}`, "#EXTM3U\n#EXTINF:100,A - B\nhttps://site.test/a.mp3\n");
    const page = await (await worker.fetch(get(`/buttons/${KEY}/archive`), e)).text();
    assert.ok(page.includes("4"));
    assert.ok(!page.includes("button 6"));
  } finally { f.restore(); }
});

// ------------------------------------------------------------ the ISRC

test("a kept track carries its ISRC when Spotify has one, and nothing when it does not", () => {
  // trackRecord is the shape every kept set is written in — the fulfilled
  // snapshot behind keep_request_set and the resolved claims of a program —
  // so this is the line a set moves house on.
  const kept = trackRecord({ ...track("aaa"), external_ids: { isrc: "USRC17607839" } });
  assert.equal(kept.isrc, "USRC17607839");
  assert.equal("isrc" in trackRecord(track("bbb")), false);
  assert.equal("isrc" in trackRecord({ ...track("ccc"), external_ids: {} }), false);
});

// ------------------------------------------------------------- the wall
//
// Who is on a button today. BUTTONS says which playlist a preset holds and
// never changes; the wall says whose name is against it and changes from a
// phone. These pin the two halves of that: that a house with no wall reads
// exactly as its config always did, and that a wall which has drifted from
// the config degrades one slot at a time instead of taking the room down.

const WALL = (slots) => ({ v: 1, slots, updated: "2026-09-03T18:00:00Z" });
const on = (env, key) => house(env).djs[key].button;

// SPOTIFY'S QUOTA DOES NOT REACH A TIDAL PRESET, 2026-09-06 (Monk on 12).
// While the Spotify note stands, a DJ on a Tidal preset is read, moved,
// benched and curated as on any other day; only the player line — the
// player is Spotify's — says anything about it.
test("while Spotify's note stands, a Tidal preset is read and curated as usual", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.MCP_SECRET = "owner-secret-owner-secret"; e.AGENT_SECRET = "agent-secret-agent-secret";
  e.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  await e.PROGRAMS.put(__test.THROTTLE_KEY, JSON.stringify({ until: Date.now() + 20 * 60 * 1000, said: 1200 }));
  const sp = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ contents: ["1", "2"] });
  const get = (p) => new Request(`https://x.test${p}`);
  const form = (p, body) => new Request(`https://x.test${p}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  try {
    // The DJ page: the Tidal tracklist, no throttled line, the remote note.
    const page = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(page.includes("tidal:track:1") || /Track 1|<li/.test(page), "the list is read");
    assert.ok(!page.includes("quota exceeded"), "nothing about Spotify's quota on a Tidal DJ's page");
    assert.match(page, /press 2 on the remote/);

    // A request for a Tidal DJ is fulfilled; the queue carries no stop for it.
    const now = Date.now();
    e.STATION.rows.set("r-t", { id: "r-t", dj: "hank", normalized: "x", state: "pending",
      created_at: now, updated_at: now, lease_until: null, fingerprint: null, write_started: 0,
      claim_token: null, claim_count: 0, playlist_id: null, track_count: null, runtime_ms: null,
      attention_code: null, decline_reason: null, suggested_dj: null });
    await e.PROGRAMS.put("request:r-t", JSON.stringify({ id: "r-t", dj: "hank", mood: "trains", length: 60, avoid: null, at: new Date(now).toISOString() }));
    // Hank is on the bench now (benched above), so put him back on 2 in the wall first.
    const listed = await callTool(e, "list_requests", {}, { remaining: 40 });
    assert.equal(listed.stop, undefined, "no stop: nothing in the queue is on Spotify");
    assert.ok(listed.spotify_throttled_minutes > 0, "the note is still reported");
    const out = await callTool(e, "fulfill_request",
      { request_id: "r-t", uris: ["tidal:track:7", "tidal:track:8"] }, { remaining: 40 });
    assert.equal(out.status, "ready");
    assert.deepEqual(td.state.items.map((it) => it.trackId), ["7", "8"]);
    assert.deepEqual(sp.calls.filter((c) => c.includes("/playlists")), [], "Spotify's playlists were never touched");
  } finally { td.restore(); sp.restore(); }
});

// An EMPTY Tidal preset is a dead button (measured 2026-09-03), and on
// 2026-09-06 the wall sent a person to it — "press 12 on the remote" — the
// day Youp arrived on 12 with nothing. Empty wins over Tidal now.
test("an empty Tidal preset says no set yet, not press the remote", async () => {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 2: TPID }, { catalog: "tidal" });
  const sp = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ contents: [] });
  const get = (p) => new Request(`https://x.test${p}`);
  try {
    const empty = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(empty, /No set yet — ask Hank/);
    assert.ok(!empty.includes("Use remote"), "a dead button is not a button to press");
    assert.ok(!empty.includes(`/buttons/${KEY}/hank/play`), "and never a play form on Tidal");
  } finally { td.restore(); sp.restore(); }
  // With a set on it, the remote note is back. (Spotify's fake first, then
  // Tidal's over it — the Tidal fake delegates what is not Tidal's.)
  const sp2 = installFetch({ contents: [track("aaa")] });
  const td2 = installTidalFetch({ contents: ["1"] });
  try {
    await dropTile(e, TPID);
    const full = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(full, /Use remote/);
    assert.ok(!full.includes("No set yet"));
  } finally { td2.restore(); sp2.restore(); }
});

// ------------------------------------------------------- the labelled preset
//
// A preset the household saved THEMSELVES in the WiiM app — a station, an EQ,
// another input — shown on the wall by the name they typed. The Worker cannot
// see the speaker, so the name is all it knows, and it is not a slot: nobody
// can be moved onto it, no playlist stands behind it (the owner, 2026-09-08:
// WiiM users keep presets for EQ settings; the wall should say what is there).

test("a labelled preset is parsed with its name and nothing else", () => {
  const [b] = parseButtons([{ button: 7, label: "  Jazz FM " }]);
  assert.deepEqual(b, {
    btn: 7, button: "button 7", key: null, archive: false, fixed: true, label: "Jazz FM",
    catalog: null, playlist: null,
  });
  for (const [raw, why] of [
    [[{ button: 7, label: "Jazz FM", dj: "hank" }], /only "button" and "label"/],
    [[{ button: 7, label: "Jazz FM", playlist: P(7) }], /only "button" and "label"/],
    [[{ button: 7, label: "Jazz FM", archive: true }], /only "button" and "label"/],
    [[{ button: 7, label: "   " }], /1 to 40 characters/],
    [[{ button: 7, label: "x".repeat(41) }], /1 to 40 characters/],
    [[{ button: 7, label: "Jazz FM" }, { button: 7, dj: "hank", playlist: P(7) }], /button 7 twice/],
  ]) assert.throws(() => parseButtons(raw), why, JSON.stringify(raw));
});

test("a labelled preset stands apart from the slots and is named on the wall and to Claude", async () => {
  const e = makeEnv();
  e.BUTTONS = JSON.stringify([
    { button: 3, dj: "the-librarian", playlist: P(3), catalog: "spotify" },
    { button: 7, label: "Jazz FM" },
    { button: 8, label: "Night EQ" },
  ]);
  const h = house(e);
  // Not a slot: the tenancy, the speakers page and every move read `buttons`,
  // and none of them must ever see a preset this house cannot write to.
  assert.deepEqual(h.buttons.map((b) => b.btn), [3]);
  assert.deepEqual(h.empty, [], "a labelled preset is not an empty button waiting for a DJ");
  assert.deepEqual(h.fixed.map((b) => [b.btn, b.label]), [[7, "Jazz FM"], [8, "Night EQ"]]);
  // get_dj with no name says what else is on the remote, so "what is on 7"
  // has an answer that is not a guess.
  const all = await callTool(e, "get_dj", {}, { remaining: 40 });
  assert.deepEqual(all.other_presets, [
    { button: "button 7", label: "Jazz FM" }, { button: "button 8", label: "Night EQ" },
  ]);
  assert.match(all.other_presets_note, /Not DJs; press them on the remote/);
  const plain = await callTool({ ...e, BUTTONS: JSON.stringify([
    { button: 3, dj: "the-librarian", playlist: P(3), catalog: "spotify" }]) }, "get_dj", {}, { remaining: 40 });
  assert.equal("other_presets" in plain, false, "a house with none is not told about them");
});
