import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { TEMPLATE_VERSION } from "../programs.js";
import { esc, safeUrl, makeSlug, artistMatches, renderProgram, renderLibrary, shelfControls,
  versionSuspect, serviceLink, imageUrl, standfirst, shortRuntime } from "../programs.js";
import { makeEnv, installFetch, track, PID, TPID, buttons } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const { callTool, listSnapshots, pickCover, pickImage } = __test;

// The writer's button, 3. programs write there and nowhere else. The
// Professor's until the owner cut him, 2026-10-15; the Librarian's since,
// and every test that wrote through make_professor_program writes through
// hers (the same machinery, with her obligations).
const PROF = "SAMPLEPLAYLIST00000020";

// Button 8: the Librarian's until 2026-10-15, Deep Dive's since (the
// harness's house). A DJ who does not write, so a writer landing anywhere
// but their own button shows here.
const LIB = "SAMPLEPLAYLIST00000019";

// Gatefold's. Not in the harness's house: gateEnv() below seats him on 2.
// 2026-10-13: the Bootlegger, the Correspondent, the Engineer and Baddie were
// cut (the owner), and their buttons here with them.
const GATE = "2GaTeFoLdPlAyLiStIdAbC";

function env() {
  const e = makeEnv();
  e.PLAYLIST_ALIASES = JSON.stringify({ scratch: PID, replay: "0000000000000000000009" });
  e.BUTTONS = buttons({ 3: PROF, 8: LIB });
  e.PROGRAM_LIBRARY_KEY = "abcdefabcdefabcdefabcdef";
  return e;
}

const para = (text, citations) => (citations ? { text, citations } : { text });

function program(over = {}) {
  return {
    title: "From the Orchestra to the Machine",
    thesis: "Disco did not die; the orchestra became a machine.",
    sections: [{
      label: "Movement I", years: "1973", heading: "The record does not decide what it is",
      prose: [para("Love Is the Message is not a disco record.", ["s1"])],
      tracks: [{ uri: "spotify:track:aaa", artist: "MFSB", year: "1973" }],
    }],
    complications: [para("A rival reading says the break was total.")],
    sources: [{ id: "s1", title: "Love Saves the Day", url: "https://example.com/lstd" }],
    // Opted in, because these tests are ABOUT the write: the backup, the
    // pointer, the read-backs, the rollback. Publishing on its own touches none
    // of that, and the default — not loading — has its own tests below.
    load_button: true,
    ...over,
  };
}

// -------------------------------------------------------------- escaping

test("prose is escaped, not rendered as markup", () => {
  const html = renderProgram({
    title: "<script>alert(1)</script>", thesis: "a & b < c",
    dj: "The Professor", created: "2026-08-28T00:00:00Z", tracks: 1, runtime: "3:00",
    playlistName: "The Professor",
    sections: [{ heading: "h", prose: [para("</p><img onerror=alert(1)>")], tracks: [] }],
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<img onerror"));
  assert.ok(html.includes("a &amp; b &lt; c"));
});

test("Tidal's Max: a MAX tag beside each Max title and a count in the facts; nothing for a set whose quality was never kept (2026-09-27)", () => {
  const t = (id, quality) => ({ uri: `tidal:track:${id}`, title: `Song ${id}`, artist: "Miles Davis", duration: "5:00", ...(quality ? { quality } : {}) });
  const base = { title: "Blue", thesis: "t", dj: "Monk", created: "2026-09-27T00:00:00Z", tracks: 3, runtime: "15:00", playlistName: "Monk" };
  const html = renderProgram({ ...base, sections: [{ tracks: [t(1, "max"), t(2, "high"), t(3, "max")] }] });
  assert.equal((html.match(/<span class="qmax" title="Tidal Max: Hi-Res">MAX<\/span>/g) ?? []).length, 2);
  assert.match(html, /<span><b>2<\/b> in Max<\/span>/);
  const old = renderProgram({ ...base, sections: [{ tracks: [t(1), t(2), t(3)] }] });
  assert.ok(!old.includes('class="qmax"') && !old.includes("in Max"), "unknown says nothing");
  const kept = __test.trackRecord({ ...track("aaa"), quality: "max" });
  assert.equal(kept.quality, "max", "a kept track keeps its quality");
  assert.equal("quality" in __test.trackRecord(track("bbb")), false);
});

test("a javascript: source never becomes a link", () => {
  const html = renderProgram({
    title: "t", thesis: "t", dj: "The Professor", created: "2026-08-28T00:00:00Z",
    tracks: 0, runtime: "0:00", playlistName: "p", sections: [],
    sources: [
      { id: "a", title: "Bad", url: "javascript:alert(1)" },
      { id: "b", title: "Good", url: "https://example.com/x" },
    ],
  });
  assert.ok(!html.includes("javascript:"), "scheme allowlist, not escaping");
  assert.ok(html.includes('href="https://example.com/x"'));
  assert.ok(html.includes("Bad"), "the title still shows, just not as a link");
});

test("a kept set shows the year and the record it came off", () => {
  const t = (over) => ({ uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa",
    title: "Can You Get To That", artist: "Funkadelic", duration: "2:50",
    released: "1971", album: "Maggot Brain", ...over });
  const html = renderProgram({
    title: "t", thesis: "t", dj: "Dr. Funkenstein", shape: "setlist",
    // The mark of a set kept from a request: its tracks come off the
    // fulfilment snapshot, where `released` is the only year anyone has.
    requestId: "r-1",
    created: "2026-09-02T00:00:00Z", tracks: 2, runtime: "6:00",
    playlistName: "Dr. Funkenstein",
    sections: [{ heading: null, prose: [], tracks: [
      t({}),
      // A single's album repeats its own title, which is noise on the line.
      t({ title: "Lovely Day", album: "Lovely Day", released: "1977" }),
    ] }],
  });
  // The year column has always existed; a set kept from a request never had a
  // `year` to put in it, and `released` was sitting unread in the record.
  // On the metadata line beside the record, not in the column: on a phone the
  // column drops to a line of its own, and a fifteen-track set cannot spend it.
  assert.match(html, /<span class="album">Maggot Brain<\/span><span class="rel">1971<\/span>/);
  assert.match(html, /<span class="year"><\/span>/, "the column stays empty here");
  assert.ok(!html.includes('<span class="album">Lovely Day</span>'),
    "an album that only repeats the title says nothing");
});

test("a program written in the app keeps its own year, and borrows none", () => {
  // `make_professor_program` and friends ask the model for the RECORDING year
  // and accept the track without one. Filling that gap from Spotify would put
  // a reissue's date in a column those tools define as the original's.
  const html = renderProgram({
    title: "t", thesis: "t", dj: "The Professor", shape: "argument",
    created: "2026-09-02T00:00:00Z", tracks: 2, runtime: "6:00",
    playlistName: "The Professor",
    sections: [{ heading: "h", prose: [], tracks: [
      { uri: "spotify:track:cccccccccccccccccccccc", title: "Respect",
        artist: "Aretha Franklin", duration: "2:28", year: "1967",
        released: "2011" },
      { uri: "spotify:track:dddddddddddddddddddddd", title: "Think",
        artist: "Aretha Franklin", duration: "2:16", released: "2011" },
    ] }],
  });
  assert.match(html, /<span class="year">1967<\/span>/, "the claim stands");
  assert.ok(!html.includes("2011"), "the reissue's date is not the record's");
});

test("a source's return arrow stays on the source's own line", () => {
  const html = renderProgram({
    title: "t", thesis: "t", dj: "The Professor", created: "2026-08-28T00:00:00Z",
    tracks: 0, runtime: "0:00", playlistName: "p", sections: [
      { heading: "h", tracks: [],
        prose: [{ text: "A claim.", citations: ["a"] }] }],
    sources: [{ id: "a", title: "Jerry Wexler, Rhythm and the Blues (1993)",
      url: "https://example.com/x" }],
  });
  // The row is a two-column grid — number, then content. An arrow left as a
  // sibling of the title became a THIRD grid item and dropped to its own row.
  assert.match(html, /<span class="sn">1<\/span><span>.*↩<\/a><\/span><\/li>/);
});

test("safeUrl allows only http and https", () => {
  assert.equal(safeUrl("https://a.test/x"), "https://a.test/x");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,<script>"), null);
  assert.equal(safeUrl("not a url"), null);
  assert.equal(safeUrl(undefined), null);
});

test("esc coerces whatever it is given", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(42), "42");
  assert.equal(esc({}), "[object Object]");
});

test("citations become numbered marks in order of first use", () => {
  const html = renderProgram({
    title: "t", thesis: "t", dj: "The Professor", created: "2026-08-28T00:00:00Z",
    tracks: 0, runtime: "0:00", playlistName: "p",
    sections: [{ heading: "h", prose: [para("second source first", ["s2"]), para("then", ["s1"])], tracks: [] }],
    sources: [{ id: "s1", title: "One" }, { id: "s2", title: "Two" }],
  });
  assert.match(html,
    /second source first<sup class="cite"><a id="cite-1" href="#source-1" aria-label="Source 1">1<\/a><\/sup>/);
  assert.match(html,
    /then<sup class="cite"><a id="cite-2" href="#source-2" aria-label="Source 2">2<\/a><\/sup>/);
  // Numbering follows citation order, so the list reads 1, 2 downwards.
  // Scoped to the <ol class="sources"> rather than the whole document: the
  // stylesheet is inlined above the body, so a bare indexOf over `html` was
  // really asking "does the string 'One' appear anywhere first", and a CSS
  // comment was enough to fail a renderer that was behaving correctly.
  const list = /<ol class="sources">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
  assert.ok(list.indexOf("Two") < list.indexOf("One"),
    "the source cited first is numbered first");
});

test("a citation to a source that does not exist is dropped, not rendered", () => {
  const html = renderProgram({
    title: "t", thesis: "t", dj: "The Professor", created: "2026-08-28T00:00:00Z",
    tracks: 0, runtime: "0:00", playlistName: "p",
    sections: [{ heading: "h", prose: [para("claim", ["nope"])], tracks: [] }],
    sources: [],
  });
  // The CSS mentions .cite, so look for the marker itself.
  assert.ok(!html.includes('<sup class="cite">'));
});

test("slugs carry a random tail, so two of the same title do not collide", () => {
  const a = makeSlug("From the Orchestra to the Machine");
  const b = makeSlug("From the Orchestra to the Machine");
  assert.notEqual(a, b);
  assert.match(a, /^[a-z0-9-]{1,64}$/, "must match the route regex");
  assert.match(makeSlug("!!!"), /^program-/, "a title that kebabs to nothing still works");
});

// ------------------------------------------------------- identity checking

test("artistMatches accepts extra credited performers and rejects a stranger", () => {
  assert.ok(artistMatches("MFSB", ["MFSB", "The Three Degrees"]));
  assert.ok(artistMatches("Norman Connors", ["Norman Connors", "Michael Henderson"]));
  assert.ok(artistMatches("roy ayers ubiquity", ["Roy Ayers Ubiquity"]));
  assert.ok(!artistMatches("MFSB", ["Kali Uchis"]));
  assert.ok(!artistMatches("", ["MFSB"]));
});

test("a URI whose artist contradicts the essay is refused before anything is written", async () => {
  const f = installFetch({ contents: [track("existing")] });
  try {
    const e = env();
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      // Per-track: /v1/tracks?ids= is 403 under Development Mode.
      if (u.pathname.startsWith("/v1/tracks/")) {
        return new Response(JSON.stringify({
          uri: "spotify:track:aaa", name: "Something Else",
          duration_ms: 100000, artists: [{ name: "A Covers Band" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return real(url, init);
    };
    await assert.rejects(
      () => callTool(e, "make_librarian_program", program(), { remaining: 40 }),
      /not what the program says they are[\s\S]*A Covers Band[\s\S]*Nothing was changed/);
    globalThis.fetch = real;
    // Nothing stored, nothing written.
    assert.equal((await e.PROGRAMS.list({ prefix: "program:" })).keys.length, 0);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:existing"]);
  } finally { f.restore(); }
});

test("a track with no artist claim is refused — it is what the check runs on", async () => {
  const f = installFetch({ contents: [track("existing")] });
  try {
    const p = program();
    delete p.sections[0].tracks[0].artist;
    await assert.rejects(
      () => callTool(env(), "make_librarian_program", p, { remaining: 40 }),
      /no artist given[\s\S]*not optional/);
  } finally { f.restore(); }
});

test("complications are required, because nothing else would keep them", async () => {
  const f = installFetch({ contents: [track("existing")] });
  try {
    const p = program();
    delete p.complications;
    await assert.rejects(
      () => callTool(env(), "make_librarian_program", p, { remaining: 40 }),
      /complications is required/);
  } finally { f.restore(); }
});

test("the same track twice is refused", async () => {
  const f = installFetch({ contents: [track("existing")] });
  try {
    const p = program();
    p.sections[0].tracks.push({ uri: "spotify:track:aaa", artist: "MFSB" });
    await assert.rejects(
      () => callTool(env(), "make_librarian_program", p, { remaining: 40 }),
      /appears twice/);
  } finally { f.restore(); }
});

// ------------------------------------------------------------- publishing

function withTrackLookup(names = { "spotify:track:aaa": ["MFSB", "The Three Degrees"] }) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith("/v1/tracks/")) {
      const id = u.pathname.split("/").pop();
      return new Response(JSON.stringify({
        uri: `spotify:track:${id}`, name: `Track ${id}`, duration_ms: 396000,
        artists: (names[`spotify:track:${id}`] ?? ["MFSB"]).map((n) => ({ name: n })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return real(url, init);
  };
  return () => { globalThis.fetch = real; };
}

test("a track Spotify will not return is refused, not silently dropped", async () => {
  const f = installFetch({ contents: [track("existing")] });
  try {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      // What a 403 or a dead id looks like from spotify(): a throw.
      if (u.pathname.startsWith("/v1/tracks/")) return new Response("gone", { status: 404 });
      return real(url, init);
    };
    await assert.rejects(
      () => callTool(env(), "make_librarian_program", program(), { remaining: 40 }),
      /is not a track Spotify will return[\s\S]*Nothing was changed/);
    globalThis.fetch = real;
  } finally { f.restore(); }
});

test("publishing stores the record, writes the button and hands back a URL", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const out = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    assert.match(out.url, /^https:\/\/example\.test\/programs\/from-the-orchestra-to-the-machine-/);
    assert.equal(out.tracks, 1);
    assert.equal(out.runtime, "6:36");
    assert.equal(out.verified, "confirmed");
    assert.match(out.note, /NOTHING WAS STARTED/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:aaa"]);
    // Title and duration come from Spotify, not from the model.
    const slug = out.url.split("/").pop();
    const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.equal(rec.sections[0].tracks[0].title, "Track aaa");
    assert.equal(rec.sections[0].tracks[0].artist, "MFSB, The Three Degrees");
    assert.equal(rec.sections[0].tracks[0].year, "1973", "the year is the model's, and kept");
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), slug);
  } finally { undo(); f.restore(); }
});

test("the previous set is recoverable after a program lands on the button", async () => {
  const f = installFetch({ contents: [track("gospel"), track("soul")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const out = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    assert.match(out.previous_contents_saved, /^2 tracks/);
    await callTool(e, "restore_playlist", { playlist: "button 3", confirm: true }, { remaining: 40 });
    assert.deepEqual(f.state.contents.map((t) => t.uri),
      ["spotify:track:gospel", "spotify:track:soul"]);
  } finally { undo(); f.restore(); }
});

test("the version check fires once on the real set that defeated the old one", () => {
  // The twelve tracks of the published disco-to-house program, with the years
  // the essay claimed and the release years Spotify returned. Comparing release
  // year alone flagged SEVEN of these; only one is actually a later remix.
  const set = [
    ["Love Is the Message", 1973, 2018],
    ["Ten Percent", 1976, 1976],
    ['I Feel Love - 12" Version', 1977, 1979],
    ["Ring My Bell", 1979, 1979],
    ["Is It All over My Face? (Larry Levan Female Vocal Version)", 1980, 1980],
    ["Heartbeat (Club Mix) (2012 - Remaster)", 1981, 1979],
    ["Your Love - Director's Cut Signature Radio Version", 1984, 2020],
    ["Move Your Body", 1986, 2022],
    ["Can You Feel It", 1986, 2001],
    ["Love Can't Turn Around", 1986, 2014],
    ["Acid Tracks", 1987, 1987],
    ["Jack Your Body - 1986 Club Mix", 1986, 2016],
  ];
  const flagged = set.filter(([t, y, r]) => versionSuspect(y, t, r));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0][0], "Your Love - Director's Cut Signature Radio Version");
});

test("the version check ignores reissues, period mixes and remasters", () => {
  // No marker in the title: a compilation, whatever the gap.
  assert.equal(versionSuspect(1986, "Move Your Body", 2022), null);
  // The marker names the claimed year, so it is the period mix on a reissue.
  assert.equal(versionSuspect(1986, "Jack Your Body - 1986 Club Mix", 2016), null);
  // Contemporaneous.
  assert.equal(versionSuspect(1977, 'I Feel Love - 12" Version', 1979), null);
  // Same performance, cleaner transfer.
  assert.equal(versionSuspect(1971, "What's Going On - 2021 Remaster", 2021), null);
  // Missing data is not evidence.
  assert.equal(versionSuspect(null, "Anything - 2020 Remix", 2020), null);
  assert.equal(versionSuspect(1980, "Anything - 2020 Remix", null), null);
  // And the case it exists for.
  assert.match(versionSuspect(1984, "Your Love - Eric Kupper Remix", 2013), /Eric Kupper Remix/);
});

test("a remix credited to the same artist is flagged, not refused", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = env();
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      if (u.pathname.startsWith("/v1/tracks/")) {
        // What a Director's Cut revision of a 1973 record looks like: right
        // artist, a version marker in the title, and a release decades late.
        // The artist check cannot see any of that.
        return new Response(JSON.stringify({
          uri: "spotify:track:aaa", name: "Love Is the Message - Eric Kupper Remix",
          duration_ms: 272000, artists: [{ name: "MFSB" }],
          album: { release_date: "2013-05-01" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return real(url, init);
    };
    const out = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    globalThis.fetch = real;
    // Published, not refused: only a listener can say whether a period mix on a
    // late pressing is the wrong record.
    assert.ok(out.url);
    assert.match(out.wrong_version_probably.join(" "), /Eric Kupper Remix.*2013.*1973/);
    assert.match(out.wrong_version_note, /Do not report this program as finished/);
  } finally { f.restore(); }
});

test("programs are immutable: a second one does not disturb the first", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const a = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    const b = await callTool(e, "make_librarian_program",
      program({ title: "A Second Thesis" }), { remaining: 40 });
    assert.notEqual(a.url, b.url);
    const first = await e.PROGRAMS.get(`program:${a.url.split("/").pop()}`, { type: "json" });
    assert.equal(first.title, "From the Orchestra to the Machine");
    const list = await callTool(e, "list_programs", {}, { remaining: 40 });
    assert.equal(list.total, 2);
    assert.equal(list.programs[0].title, "A Second Thesis", "newest first");
  } finally { undo(); f.restore(); }
});

test("a failed write leaves the article but refuses to claim the button is loaded", async () => {
  const f = installFetch({
    contents: [track("old")],
    fail: { [`PUT /playlists/${PROF}/items`]: "nope" },
  });
  const undo = withTrackLookup();
  try {
    await assert.rejects(
      () => callTool(env(), "make_librarian_program", program(), { remaining: 40 }),
      /Nothing was written; the previous contents are intact/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:old"]);
  } finally { undo(); f.restore(); }
});

test("unpublish previews, then deletes and clears the pointer", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const out = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    const slug = out.url.split("/").pop();
    const dry = await callTool(e, "unpublish_program", { id: slug }, { remaining: 40 });
    assert.match(dry.note, /NOTHING HAS BEEN CHANGED/);
    assert.ok(await e.PROGRAMS.get(`program:${slug}`));
    await callTool(e, "unpublish_program", { id: slug, confirm: true }, { remaining: 40 });
    assert.equal(await e.PROGRAMS.get(`program:${slug}`), null);
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), null);
    // The music is left alone; only the article is gone.
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:aaa"]);
  } finally { undo(); f.restore(); }
});

test("read_playlist reports the program a button is currently showing", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const out = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    const read = await callTool(e, "read_playlist", { playlist: "button 3" }, { remaining: 40 });
    assert.equal(read.program.title, "From the Orchestra to the Machine");
    assert.equal(read.program.url, out.url);
    // And a plain replace clears it, because the notes no longer describe it.
    await callTool(e, "replace_playlist",
      { playlist: "button 3", uris: ["spotify:track:zzz"] }, { remaining: 40 });
    const after = await callTool(e, "read_playlist", { playlist: "button 3" }, { remaining: 40 });
    assert.equal(after.program, undefined);
  } finally { undo(); f.restore(); }
});

// ---------------------------------------------------------------- the shelf

test("the notes page lists programs newest first and links each one", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    await callTool(e, "make_librarian_program",
      program({ title: "A Later Thesis" }), { remaining: 40 });
    const list = await callTool(e, "list_programs", {}, { remaining: 40 });
    assert.equal(list.program_notes_page,
      "https://example.test/notes/abcdefabcdefabcdefabcdef");
    const html = renderLibrary(list.programs);
    assert.equal((html.match(/<li class="card/g) ?? []).length, 2, "a cover card each (the grid, 2026-09-23)");
    assert.ok(html.indexOf("A Later Thesis") < html.indexOf("From the Orchestra"),
      "newest first");
    assert.ok(html.includes('href="https://example.test/programs/'));
  } finally { undo(); f.restore(); }
});

test("an empty shelf says so rather than rendering nothing", () => {
  const html = renderLibrary([]);
  assert.ok(html.includes("Nothing kept yet"));
  assert.ok(html.includes("<b>0</b> programs"));
  // As the house can fill it (the owner, 2026-10-17): no asking on DJ pages without the curator.
  assert.match(html, /Ask a DJ for a set on their page and tick “worth keeping”/);
  const core = renderLibrary([], { asksOn: false });
  assert.match(core, /In Claude or ChatGPT, ask the Librarian or Gatefold for a program, or say\s+“keep this set”/);
  assert.doesNotMatch(core, /worth keeping/, "nor in the help");
});

test("a hostile title on the shelf is escaped, and a bad url is not a link", () => {
  const html = renderLibrary([
    { id: "x", title: "<img src=x onerror=alert(1)>", created: "2026-08-28", url: "javascript:alert(1)" },
  ]);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("&lt;img"));
});

// --------------------------------------------- listening: links and the button

test("serviceLink builds a link only from a real id, only for known kinds, and names the service", () => {
  assert.deepEqual(serviceLink("track", "spotify:track:0vryyKyxCFXT0gg670yNEw"),
    { href: "https://open.spotify.com/track/0vryyKyxCFXT0gg670yNEw", service: "Spotify" });
  assert.deepEqual(serviceLink("playlist", PROF),
    { href: `https://open.spotify.com/playlist/${PROF}`, service: "Spotify" });
  assert.equal(serviceLink("track", "spotify:track:short"), null);
  assert.equal(serviceLink("track", 'spotify:track:x" onload="alert(1)'), null,
    "an id is the only untrusted part of the url, so it is checked not escaped");
  assert.equal(serviceLink("track", "spotify:local:a:b:c:d"), null);
  assert.equal(serviceLink("album", "spotify:album:0vryyKyxCFXT0gg670yNEw"), null,
    "kind is a closed set, not a path fragment");
  assert.equal(serviceLink("track", undefined), null);

  // Tidal's shapes, as tidal/probe3.py saw them in externalLinks.
  assert.deepEqual(serviceLink("track", "tidal:track:12345678"),
    { href: "https://tidal.com/browse/track/12345678", service: "Tidal" });
  assert.deepEqual(serviceLink("playlist", TPID),
    { href: `https://listen.tidal.com/playlist/${TPID}`, service: "Tidal" });
  assert.deepEqual(serviceLink("playlist", `tidal:playlist:${TPID.toUpperCase()}`),
    { href: `https://listen.tidal.com/playlist/${TPID}`, service: "Tidal" });
  // The prefix and the id's shape have to agree: a Tidal prefix on a Spotify
  // id is not a link to anything, and a track id is digits only.
  assert.equal(serviceLink("track", "tidal:track:0vryyKyxCFXT0gg670yNEw"), null);
  assert.equal(serviceLink("track", "spotify:track:12345678"), null);
  assert.equal(serviceLink("track", "tidal:track:12/../x"), null);
  assert.equal(serviceLink("playlist", `spotify:playlist:${TPID}`), null);
  assert.equal(serviceLink("playlist", "not-a-playlist"), null);
  // The prefix's kind has to be the kind asked for, and a prefix is exactly
  // two segments: a track URI is not a playlist link, a bare track id is not
  // a track link, and an empty or padded scheme is not a scheme.
  assert.deepEqual(serviceLink("playlist", `spotify:playlist:${PROF}`),
    { href: `https://open.spotify.com/playlist/${PROF}`, service: "Spotify" });
  assert.equal(serviceLink("playlist", `spotify:track:${PROF}`), null);
  assert.equal(serviceLink("playlist", `tidal:track:${TPID}`), null);
  assert.equal(serviceLink("playlist", `:${PROF}`), null);
  assert.equal(serviceLink("playlist", `::${TPID}`), null);
  assert.equal(serviceLink("track", "0vryyKyxCFXT0gg670yNEw"), null);
  assert.equal(serviceLink("track", "spotify:track:x:0vryyKyxCFXT0gg670yNEw"), null);
  assert.equal(serviceLink("track", "spotify:playlist:0vryyKyxCFXT0gg670yNEw"), null);
});

test("imageUrl admits Tidal's one image host in its one shape, and nothing like it", () => {
  const good = "https://resources.tidal.com/images/0b1f2c3d/aaaa/bbbb/cccc/000000000001/320x320.jpg";
  assert.equal(imageUrl(good), good);
  // The probe recorded the shape, not the case; a capitalised path is the
  // same host and the same shape, and refusing it would only lose a sleeve.
  const upper = "https://resources.tidal.com/images/0B1F2C3D/AAAA/BBBB/CCCC/000000000001/320x320.jpg";
  assert.equal(imageUrl(upper), upper);
  for (const bad of [
    "http://resources.tidal.com/images/0b1f2c3d/aaaa/bbbb/cccc/000000000001/320x320.jpg",
    "https://resources.tidal.com.evil.example/images/0b1f2c3d/aaaa/bbbb/cccc/000000000001/320x320.jpg",
    "https://resources.tidal.com/images/0b1f2c3d/aaaa/bbbb/cccc/000000000001/320x320.png",
    "https://resources.tidal.com/images/../../320x320.jpg",
    "https://resources.tidal.com/images/0b1f2c3d/aaaa/bbbb/cccc/000000000001/320x320.jpg?x=1",
    "https://resources.tidal.com/images/zzzzzzzz/aaaa/bbbb/cccc/000000000001/320x320.jpg",
  ]) {
    assert.equal(imageUrl(bad), null, bad);
  }
});

const listenable = (over = {}) => ({
  title: "t", thesis: "t", dj: "The Professor", created: "2026-08-28T00:00:00Z",
  tracks: 1, runtime: "6:36", playlistName: "The Professor", playlistId: PROF,
  slug: "t-abc123",
  sections: [{ heading: "h", prose: [], tracks: [{
    uri: "spotify:track:0vryyKyxCFXT0gg670yNEw", title: "Your Love",
    artist: "Frankie Knuckles", year: "1987", duration: "6:43",
  }] }],
  ...over,
});

test("every track row links to the record on Spotify", () => {
  const html = renderProgram(listenable());
  assert.ok(html.includes(
    '<a href="https://open.spotify.com/track/0vryyKyxCFXT0gg670yNEw"' +
    ' rel="noopener noreferrer">Your Love</a>'));
});

test("a track whose uri is malformed still shows, just without a link", () => {
  const html = renderProgram(listenable({
    sections: [{ heading: "h", prose: [], tracks: [
      { uri: "spotify:track:nope", title: "Ghost", artist: "X" }] }],
  }));
  assert.ok(html.includes("Ghost"), "the row is still the record of what was published");
  assert.ok(!html.includes("open.spotify.com/track/"));
});

test("the listen link appears only while the program is the one on the button", () => {
  const off = renderProgram(listenable());
  assert.ok(!off.includes("Open this set in Spotify"));
  assert.ok(!off.includes("open.spotify.com/playlist/"));
  assert.match(off, /Not on a preset right now/);

  const on = renderProgram(listenable(), { onAir: true });
  assert.ok(on.includes(`href="https://open.spotify.com/playlist/${PROF}"`));
  assert.match(on, /preset holds this program now/);
  assert.ok(!on.includes("Not on a button"),
    "the page stops hedging once it knows");
});

// The off-air footer used to say the set "was written to <playlist> on <date>"
// for every program — including the held-back ones that were never written
// anywhere. It may claim only what the record knows.
test("the off-air footer claims only what the record knows about the write", () => {
  // Reworded 2026-09-05 to lead with the state a reader wants — "not on a
  // button right now" — and keep each record's one honest clause after it.
  const written = renderProgram(listenable({ loaded: true }));
  assert.match(written, /Not on a preset right now/);
  assert.match(written, /it was, when it was published, and the preset has moved on since/);
  const held = renderProgram(listenable({ loaded: false }));
  assert.match(held, /published without being put on one/);
  assert.ok(!held.includes("moved on since"));
  const old = renderProgram(listenable());
  assert.match(old, /whether it was ever on one is not recorded here/);
  assert.ok(!old.includes("moved on since"));
});

test("a program with no playlistId gets no listen link even when it is on air", () => {
  const html = renderProgram(listenable({ playlistId: undefined }), { onAir: true });
  assert.ok(!html.includes("open.spotify.com/playlist/"));
});

// A program written to a Tidal button carries Tidal uris and a Tidal
// playlist id, and the page has to follow: the rows link to Tidal, the listen
// link opens Tidal, and the word "Spotify" appears nowhere on it.
test("a Tidal program's rows link to Tidal, and its listen link opens in Tidal", () => {
  const rec = listenable({
    playlistId: TPID, playlistName: "Hank",
    sections: [{ heading: "h", prose: [], tracks: [{
      uri: "tidal:track:12345678", title: "Your Love", artist: "Frankie Knuckles",
      year: "1987", duration: "6:43",
    }] }],
  });
  const off = renderProgram(rec);
  assert.ok(off.includes('<a href="https://tidal.com/browse/track/12345678" rel="noopener noreferrer">Your Love</a>'));
  assert.ok(!off.includes("open.spotify.com"));
  assert.ok(!off.includes("listen.tidal.com"), "no listen link off the button");
  const on = renderProgram(rec, { onAir: true });
  assert.ok(on.includes(`href="https://listen.tidal.com/playlist/${TPID}"`));
  assert.ok(on.includes("Open in Tidal ↗"));
  assert.match(on, /a change made by hand in Tidal/);
  assert.ok(!on.includes("Spotify"), "nothing on a Tidal program's page names Spotify");
});

// The ETag is what decides whether a browser ever fetches this page again, so
// it has to move when anything on the page moves. `onAir` is the only part that
// changes without the record or the template changing.
test("the etag varies with the listen link, or a cached page keeps a stale one", async () => {
  const e = makeEnv();
  await e.PROGRAMS.put(`program:t-abc123`, JSON.stringify(listenable()));
  const get = (headers = {}) =>
    worker.fetch(new Request("https://x.test/programs/t-abc123", { headers }), e);

  const cold = await get();
  const offTag = cold.headers.get("etag");
  assert.match(offTag, /^W\/"t-abc123-\d+"$/);
  assert.equal((await get({ "if-none-match": offTag })).status, 304);

  await e.PROGRAMS.put(`current:${PROF}`, "t-abc123");
  const live = await get();
  const onTag = live.headers.get("etag");
  assert.notEqual(onTag, offTag, "the same tag would serve a page with no listen link");
  // Two facts, in the facts line, where they used to be two lines under it.
  // The link OPENS the playlist on Spotify and presses nothing, so it says so.
  const liveHtml = await live.text();
  assert.match(liveHtml, /class="listen"><a [^>]*>Open in Spotify ↗<\/a>/);
  assert.match(liveHtml, /<span>on The Professor<\/span>/);
  assert.ok(!/▶|Play on/.test(liveHtml),
    "a share URL opens a playlist; it does not press a button");
  assert.equal((await get({ "if-none-match": offTag })).status, 200,
    "a browser holding the old tag must be given the new page");

  // A revision rewrites the record under the SAME slug, so the tag has to
  // move with it too — nothing else about the page's address changes.
  await e.PROGRAMS.put(`program:t-abc123`, JSON.stringify(listenable({
    revisions: [{ at: "2026-09-07T01:00:00Z", why: "One out.", was: { tracks: 2, runtime: "6:36", uris: [] } }],
  })));
  const revised = await get();
  const revTag = revised.headers.get("etag");
  assert.match(revTag, /-r1-live"$/);
  assert.notEqual(revTag, onTag, "the same tag would serve the pre-revision page");
  assert.equal((await get({ "if-none-match": onTag })).status, 200,
    "a browser holding the pre-revision tag must be given the revised page");
});

// ------------------------------------------------------------- revising

// A KEPT SET: the setlist shape keep_request_set writes — one bare section,
// full rows, the request it answered. What revise_program edits.
const kept = (over = {}) => ({
  slug: "party-abc123", dj: "The Librarian", shape: "setlist", title: "A Party",
  thesis: "Two records, as asked.",
  sections: [{ label: null, years: null, heading: null, prose: [], tracks: [
    { uri: "spotify:track:aaa", title: "Track aaa", artist: "MFSB", album: "Love Is the Message",
      duration: "3:20", duration_ms: 200000, year: "1973" },
    { uri: "spotify:track:bbb", title: "Track bbb", artist: "MFSB", album: "Love Is the Message",
      duration: "3:20", duration_ms: 200000, year: "1973" },
  ] }],
  complications: [], coda: [], sources: [], notes: [{ tag: "Note", text: "As it was." }],
  playlistId: PROF, playlistName: "The Librarian", created: "2026-09-06T01:00:00Z",
  loaded: true, templateVersion: TEMPLATE_VERSION, tracks: 2, runtime: "6:40",
  requestId: "r-1", ask: { text: "Play me a party.", at: "2026-09-06T00:00:00Z" },
  ...over,
});

// Seeds the record WITH a listing row and a cover, the way a publish leaves
// it, and counts every track lookup the fake sees.
async function seeded(rec = kept()) {
  const e = env();
  await e.PROGRAMS.put(`program:${rec.slug}`, JSON.stringify(rec), {
    metadata: { title: rec.title, dj: rec.dj, shape: rec.shape, created: rec.created,
      tracks: rec.tracks, runtime: rec.runtime, image: "https://i.scdn.co/image/cover" },
  });
  return e;
}

function countingLookup() {
  const undo = withTrackLookup();
  const inner = globalThis.fetch;
  const seen = { lookups: 0 };
  globalThis.fetch = async (u, i) => {
    if (String(u).includes("/v1/tracks/")) seen.lookups++;
    return inner(u, i);
  };
  return { seen, restore() { globalThis.fetch = inner; undo(); } };
}

test("revise_program refuses, in words, everything it will not edit — and writes nothing when it does", async () => {
  const f = installFetch({ contents: [track("old")] });
  const look = countingLookup();
  try {
    const e = await seeded();
    const before = await e.PROGRAMS.get("program:party-abc123");
    const refuse = (args, re) =>
      assert.rejects(callTool(e, "revise_program", { id: "party-abc123", why: "Because.", ...args }, { remaining: 40 }), re);

    await assert.rejects(callTool(e, "revise_program",
      { id: "nope", uris: ["spotify:track:aaa"], why: "Because." }, { remaining: 40 }), /no program "nope"/);
    // An essay's words name its tracks; the fix for one is a new program.
    await e.PROGRAMS.put("program:t-abc123", JSON.stringify(listenable()));
    await assert.rejects(callTool(e, "revise_program",
      { id: "t-abc123", uris: ["spotify:track:aaa"], why: "Because." }, { remaining: 40 }),
      /re-publish it with make_<dj>_program/i);
    await refuse({ uris: ["spotify:track:bbb"], why: "" }, /why is required/);
    await refuse({ uris: ["spotify:track:bbb"], why: "x".repeat(301) }, /300/);
    await refuse({ uris: [] }, /uris is required/);
    await refuse({ uris: ["spotify:track:aaa", "spotify:track:aaa"] }, /appears twice/);
    await refuse({ uris: Array.from({ length: 39 }, (_, i) => `spotify:track:t${i}`) }, /over the 38/);
    await refuse({ uris: ["spotify:track:aaa", "tidal:track:123"] }, /Spotify program.*not Spotify track URIs/);
    await refuse({ uris: ["spotify:track:aaa", "spotify:track:bbb"] }, /nothing to revise/);

    assert.equal(look.seen.lookups, 0, "a refusal looks nothing up");
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:old"]);
    assert.equal(await e.PROGRAMS.get("program:party-abc123"), before, "and the record is untouched");
  } finally { look.restore(); f.restore(); }
});

test("off air, a revision changes the page and nothing else — old rows kept, new ones looked up once", async () => {
  const f = installFetch({ contents: [track("old")] });
  const look = countingLookup();
  try {
    const e = await seeded();
    const out = await callTool(e, "revise_program", {
      id: "party-abc123", uris: ["spotify:track:bbb", "spotify:track:aaa", "spotify:track:ccc"],
      why: "One more, and the opener moved",
    }, { remaining: 40 });

    assert.equal(look.seen.lookups, 1, "only the track new to the record costs a request");
    assert.equal(out.on_air, false);
    assert.equal(out.playlist_written, false);
    assert.match(out.note, /activate_program/);
    assert.deepEqual(out.added, ["Track ccc"]);
    assert.deepEqual(out.removed, []);
    assert.equal(out.tracks, 3);
    assert.equal(out.runtime, "13:16", "200000 + 200000 + 396000 ms");
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:old"], "the button was not touched");

    const { value, metadata } = await e.PROGRAMS.getWithMetadata("program:party-abc123");
    const rec = JSON.parse(value);
    const was = kept().sections[0].tracks;
    assert.deepEqual(rec.sections[0].tracks.map((t) => t.uri),
      ["spotify:track:bbb", "spotify:track:aaa", "spotify:track:ccc"]);
    assert.deepEqual(rec.sections[0].tracks[0], was[1], "an old row is kept verbatim");
    assert.deepEqual(rec.sections[0].tracks[1], was[0]);
    assert.equal(rec.sections[0].tracks[2].title, "Track ccc");
    assert.equal(rec.tracks, 3);
    assert.equal(rec.runtime, "13:16");
    assert.equal(rec.requestId, "r-1", "the request it answered stays on it");
    assert.equal(rec.revisions.length, 1);
    assert.equal(rec.revisions[0].why, "One more, and the opener moved.", "a full stop, so the page reads as a sentence");
    assert.deepEqual(rec.revisions[0].was, { tracks: 2, runtime: "6:40", uris: ["spotify:track:aaa", "spotify:track:bbb"] });
    // The listing row is what the shelf reads; a bare put would have lost it.
    assert.equal(metadata.tracks, 3);
    assert.equal(metadata.runtime, "13:16");
    assert.equal(metadata.image, "https://i.scdn.co/image/cover", "the cover survives");
  } finally { look.restore(); f.restore(); }
});

test("on air, the button is rewritten first and the page second, and the set's own words go back", async () => {
  const f = installFetch({ contents: [track("old")] });
  const look = countingLookup();
  try {
    const e = await seeded();
    await e.PROGRAMS.put(`current:${PROF}`, "party-abc123");
    const out = await callTool(e, "revise_program", {
      id: "party-abc123", uris: ["spotify:track:bbb"], why: "One out.", title: "A Smaller Party",
    }, { remaining: 40 });

    assert.equal(out.on_air, true);
    assert.equal(out.playlist_written, true);
    assert.ok(out.undo_snapshot, "the old set was backed up first");
    assert.deepEqual(out.removed, ["Track aaa"]);
    assert.equal(look.seen.lookups, 0);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:bbb"]);
    assert.equal(f.state.description, "A Smaller Party", "the title under the playlist name follows");
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), "party-abc123", "still on air");
    const ask = JSON.parse(await e.PROGRAMS.get(`ask:${PROF}`));
    assert.equal(ask.requestId, "r-1", "the write cleared the ask; the revision put it back");

    const { value, metadata } = await e.PROGRAMS.getWithMetadata("program:party-abc123");
    const rec = JSON.parse(value);
    assert.equal(rec.title, "A Smaller Party");
    assert.equal(metadata.title, "A Smaller Party");
    assert.equal(rec.tracks, 1);
  } finally { look.restore(); f.restore(); }
});

test("on air but the DJ has moved: only the page is revised, and the result says why", async () => {
  const f = installFetch({ contents: [track("old")] });
  const look = countingLookup();
  try {
    const e = await seeded();
    await e.PROGRAMS.put(`current:${PROF}`, "party-abc123");
    e.BUTTONS = buttons({ 3: "1111111111111111111111" });
    const out = await callTool(e, "revise_program", {
      id: "party-abc123", uris: ["spotify:track:bbb"], why: "One out.",
    }, { remaining: 40 });
    assert.equal(out.playlist_written, false);
    assert.match(out.warnings.join(" "), /moved to playlist 1111111111111111111111/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:old"]);
    const rec = await e.PROGRAMS.get("program:party-abc123", { type: "json" });
    assert.equal(rec.tracks, 1);
  } finally { look.restore(); f.restore(); }
});

test("the title is clamped, the thesis replaced, and the page carries every revision oldest first", async () => {
  const f = installFetch({ contents: [track("old")] });
  const look = countingLookup();
  try {
    const e = await seeded();
    await callTool(e, "revise_program", {
      id: "party-abc123", uris: ["spotify:track:bbb", "spotify:track:aaa"],
      why: "First the order", title: "T".repeat(250), thesis: "One record, twice.",
    }, { remaining: 40 });
    await callTool(e, "revise_program", {
      id: "party-abc123", uris: ["spotify:track:bbb"], why: "Then one out",
    }, { remaining: 40 });
    const rec = await e.PROGRAMS.get("program:party-abc123", { type: "json" });
    assert.equal(rec.title.length, 200);
    assert.equal(rec.thesis, "One record, twice.");
    assert.equal(rec.revisions.length, 2);

    const html = renderProgram(rec);
    const note = html.indexOf("As it was.");
    const first = html.indexOf("First the order.");
    const second = html.indexOf("Then one out.");
    const footer = html.indexOf("Not on a preset right now");
    assert.ok(note > 0 && first > note && second > first && footer > second,
      "notes, then revisions oldest first, then the on-air line");
    assert.match(html, /<span class="tag">Revised \d+ \w+ \d{4}<\/span> — First the order\. Was 2 tracks, 6:40\./);
    assert.match(html, /Then one out\. Was 2 tracks, 6:40\./);
  } finally { look.restore(); f.restore(); }
});

test("a Tidal program is judged by its own catalog, not the house default", async () => {
  const f = installFetch({ contents: [track("old")] });
  const look = countingLookup();
  try {
    const e = await seeded(kept({ playlistId: TPID }));
    await assert.rejects(callTool(e, "revise_program", {
      id: "party-abc123", uris: ["spotify:track:bbb", "spotify:track:aaa"], why: "Swap.",
    }, { remaining: 40 }), /Tidal program.*not Tidal track URIs/);
    assert.equal(look.seen.lookups, 0);
  } finally { look.restore(); f.restore(); }
});

// AN ARCHIVE SET'S PAGE (2026-09-07). Its takes are on no service, so there is
// no "open in"; the house's own site plays them from a link that names the
// whole set, shown whether or not the set is on the preset.
const archiveRecord = (over = {}) => ({
  slug: "one-night-ab12cd", dj: ARCHIVE.name, shape: "setlist", title: "One Night",
  thesis: "5 takes from the house tapes, three at a time on preset 6.",
  sections: [{ label: null, years: null, heading: null, prose: [], tracks: [
    { uri: "archive:take:r0", title: "Long Road", artist: "The Porch Band",
      album: "Riverside Hall, 2001-01-08", duration: "3:50", duration_ms: 230000, year: 2001 },
    { uri: "archive:take:r1", title: "Anna May", artist: "The Porch Band",
      album: "Riverside Hall, 2001-01-08", duration: "3:17", duration_ms: 197000, year: 2001 },
  ] }],
  complications: [], coda: [], sources: [], notes: [],
  playlistId: `archive:${ARCHIVE.key}`, playlistName: ARCHIVE.name,
  created: "2026-09-07T01:00:00Z", loaded: true, templateVersion: TEMPLATE_VERSION,
  tracks: 2, runtime: "7:07",
  archive: { key: ARCHIVE.key, btn: 6, loop: true,
    site: "https://site.test/playlist/#p=porch-riverside-2001-01-08-13,porch-riverside-2001-01-08-07" },
  ...over,
});

test("an archive set's page links the whole set into the site's player, and says press 6", async () => {
  const e = makeEnv();
  await e.PROGRAMS.put("program:one-night-ab12cd", JSON.stringify(archiveRecord()));
  const get = (headers = {}) =>
    worker.fetch(new Request("https://x.test/programs/one-night-ab12cd", { headers }), e);

  const off = await (await get()).text();
  // The link is true whether or not the set is on the preset, unlike a
  // service's "open in", which is only shown on air.
  assert.match(off, /class="listen"><a href="https:\/\/site\.test\/playlist\/#p=porch-riverside-2001-01-08-13,porch-riverside-2001-01-08-07" [^>]*>Play on site\.test ↗<\/a>/);
  assert.match(off, /<span>preset 6<\/span>/);
  assert.match(off, /Not on the preset right now/);
  assert.match(off, /load it again from the app/);
  assert.match(off, /press 6 on the WiiM/);
  assert.match(off, /plays the same takes in the site’s own player/);
  assert.ok(!off.includes("open.spotify.com") && !off.includes("Open in"), "no service to open in");
  // A take is not a link: serviceLink declines an archive uri and the title
  // prints as text.
  assert.match(off, /<span class="title">Long Road<\/span>/);
  assert.match(off, /Riverside Hall, 2001-01-08/, "where and when, where a record's album goes");

  // On the preset: the pointer under `archive:<key>` is the same check every
  // program page makes, with no special case.
  const offTag = (await get()).headers.get("etag");
  await e.PROGRAMS.put(`current:archive:${ARCHIVE.key}`, "one-night-ab12cd");
  const live = await get();
  assert.match(live.headers.get("etag"), /-live"$/);
  assert.notEqual(live.headers.get("etag"), offTag);
  const on = await live.text();
  assert.match(on, /On the preset<\/span> — preset 6 holds this set now, three takes at a time/);
  assert.match(on, /Play on site\.test ↗/, "and the site link stays");
});

test("activate_program puts an archive set back on the archive preset, never on a button", async () => {
  // Its DJ has no button and never will — the recordings are on no service —
  // so the playlist path cannot apply. It is parked again as a station from
  // the refs its tracks carry, and the pointer is set.
  const e = makeEnv();
  e.BUTTONS = JSON.stringify([
    { button: 3, dj: "the-librarian", playlist: PROF, catalog: "spotify" },
    { button: 6, archive: true },
  ]);
  await e.PROGRAMS.put("program:one-night-ab12cd", JSON.stringify(archiveRecord()));
  const out = await callTool(e, "activate_program", { id: "one-night-ab12cd" }, { remaining: 40 });
  assert.equal(out.activated, true);
  assert.equal(out.button, "button 6");
  assert.equal(out.tracks, 2);
  assert.match(out.note, /NOTHING WAS STARTED/);
  const station = JSON.parse(await e.TOKENS.get(`station:${ARCHIVE.key}`));
  assert.deepEqual(station.refs, ["r0", "r1"]);
  assert.equal(station.title, "One Night");
  assert.equal(await e.PROGRAMS.get(`current:archive:${ARCHIVE.key}`), "one-night-ab12cd");
  assert.equal(await e.PROGRAMS.get(`current:${PROF}`), null, "and no service playlist was touched");

  // A house with no archive preset is told so, in words that do not say
  // "put them on a button first" about a DJ who cannot be.
  const bare = makeEnv();
  bare.BUTTONS = JSON.stringify([{ button: 3, dj: "the-librarian", playlist: PROF, catalog: "spotify" }]);
  await bare.PROGRAMS.put("program:one-night-ab12cd", JSON.stringify(archiveRecord()));
  await assert.rejects(
    () => callTool(bare, "activate_program", { id: "one-night-ab12cd" }, { remaining: 40 }),
    /has no archive preset/);
});

test("activate_program puts an old program back on the button, backing up what was there", async () => {
  const f = installFetch({ contents: [track("old1"), track("old2")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const made = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    const slug = made.url.split("/").pop();

    // Something else takes the button, which clears the pointer.
    await callTool(e, "replace_playlist",
      { playlist: "button 3", uris: ["spotify:track:zzz"] }, { remaining: 40 });
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), null);

    const back = await callTool(e, "activate_program", { id: slug }, { remaining: 40 });
    assert.equal(back.program, "From the Orchestra to the Machine");
    assert.equal(back.verified, "confirmed");
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:aaa"]);
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), slug,
      "the page shows its listen link again");
    assert.match(back.previous_contents_saved, /^1 tracks/);
    assert.match(back.note, /NOTHING WAS STARTED/);
  } finally { undo(); f.restore(); }
});

test("activate_program refuses an unknown program and writes nothing", async () => {
  const f = installFetch({ contents: [track("keep")] });
  try {
    await assert.rejects(
      () => callTool(env(), "activate_program", { id: "nope" }, { remaining: 40 }),
      /no program "nope"/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:keep"]);
  } finally { f.restore(); }
});

// This used to refuse, and until the tenancy that was right: a DJ's playlist
// changing under a published set meant a config error, and writing anyway
// would leave the program's page reading `current:` on one playlist while
// the set sat on another — hiding a listen link for a set that IS loaded, or
// offering one for a playlist that no longer holds it.
//
// A DJ moving buttons is ordinary now, and the occupancy rule says published
// work follows its writer. So the set follows, and the thing that made it
// dangerous is fixed rather than forbidden: the record moves to the playlist
// the set is on, and the pointer on the old one is cleared.
test("a program follows its DJ to a different playlist, and its record moves with it", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const made = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    const slug = made.url.split("/").pop();
    const published = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.equal(published.playlistId, PROF);

    // The Professor's button now holds a different playlist.
    e.BUTTONS = buttons({ 3: "1111111111111111111111" });
    const out = await callTool(e, "activate_program", { id: slug }, { remaining: 40 });
    assert.equal(out.moved_from_playlist, PROF);
    assert.equal(out.tracks > 0, true);

    // The record names where the set actually is, so every "is this loaded?"
    // read asks about the right playlist.
    const moved = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.equal(moved.playlistId, "1111111111111111111111");
    assert.equal(await e.PROGRAMS.get(`current:1111111111111111111111`), slug);
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), null,
      "and the playlist it left stops claiming it");
  } finally { undo(); f.restore(); }
});

test("but a program still cannot land on a button of the other service", async () => {
  // The relaxation above is about WHICH playlist, never about which catalog.
  // replacePlaylistSafely refuses foreign URIs before it writes anything.
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const made = await callTool(e, "make_librarian_program", program(), { remaining: 40 });
    const slug = made.url.split("/").pop();
    e.BUTTONS = JSON.stringify([{ button: 3, dj: "the-librarian",
      playlist: "0b1f2c3d-aaaa-bbbb-cccc-000000000002", catalog: "tidal" }]);
    await assert.rejects(
      () => callTool(e, "activate_program", { id: slug }, { remaining: 40 }),
      /not Tidal track URIs[\s\S]*Nothing was changed/);
  } finally { undo(); f.restore(); }
});

// ------------------------------------------------- publishing without loading

test("publishing does not touch the button unless asked", async () => {
  const f = installFetch({ contents: [track("already-there")] });
  try {
    const env = makeEnv();
    env.BUTTONS = buttons({ 3: PID });
    const out = await callTool(env, "make_librarian_program", {
      title: "A Program Held Back",
      thesis: "Publishing and loading are separable.",
      sections: [{ heading: "One", prose: ["Because the record is written first."],
                   tracks: [{ uri: "spotify:track:aaa", artist: "Someone", year: "1970" }] }],
      complications: [{ heading: "But", prose: ["Someone might disagree."] }],
      // No load_button at all — the default, and what a client holding an old
      // tool list sends. It must be the harmless one.
    }, { remaining: 40 });

    assert.equal(out.on_button, false);
    assert.match(out.url, /\/programs\//);
    assert.match(out.note, /PUBLISHED AND WAITING/);

    // The whole point: nothing was written to the playlist, so nothing needed
    // backing up either.
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:already-there"]);
    assert.equal(f.calls.filter((c) => c.startsWith("PUT /playlists/")).length, 0);
    assert.equal((await listSnapshots(env, PID)).length, 0, "no backup, nothing destroyed");
  } finally { f.restore(); }
});

test("the record says whether the publish wrote the playlist", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const env = makeEnv();
    env.BUTTONS = buttons({ 3: PID });
    const args = (title) => ({
      title, thesis: "Thesis.",
      sections: [{ heading: "One", prose: ["Prose."],
                   tracks: [{ uri: "spotify:track:bbb", artist: "Someone", year: "1970" }] }],
      complications: [{ heading: "But", prose: ["Prose."] }],
    });
    const held = await callTool(env, "make_librarian_program", args("Held Back"), { remaining: 40 });
    const heldRec = JSON.parse(await env.PROGRAMS.get(`program:${held.url.split("/").pop()}`));
    assert.equal(heldRec.loaded, false, "never written, and the record says so");
    const live = await callTool(env, "make_librarian_program",
      { ...args("Put On"), load_button: true }, { remaining: 40 });
    const liveRec = JSON.parse(await env.PROGRAMS.get(`program:${live.url.split("/").pop()}`));
    assert.equal(liveRec.loaded, true, "flipped only once the write succeeded");
  } finally { f.restore(); }
});

test("a held-back program offers no listen link, because it is not on the button", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const env = makeEnv();
    env.BUTTONS = buttons({ 3: PID });
    const out = await callTool(env, "make_librarian_program", {
      title: "Not On The Button",
      thesis: "A link to a set that is elsewhere is worse than no link.",
      sections: [{ heading: "One", prose: ["Prose."],
                   tracks: [{ uri: "spotify:track:bbb", artist: "Someone", year: "1970" }] }],
      complications: [{ heading: "But", prose: ["Prose."] }],
    }, { remaining: 40 });
    assert.equal(out.on_button, false);
    assert.equal(await env.PROGRAMS.get(`current:${PID}`), null);
  } finally { f.restore(); }
});

// ------------------------------------------------------- the library chooser

// Obviously a fixture. This was a copy of the real key until 2026-08-30, which
// is a second place a credential lives and a second thing to remember to change
// when it rotates — room.test.js had it right.
const LIBKEY = "abcdefabcdefabcdefabcdef";

function libEnv(kv = {}) {
  const env = makeEnv(kv);
  env.PROGRAM_LIBRARY_KEY = LIBKEY;
  // Both writers on presets. The shelf withholds "Load on preset" from a
  // program whose author is benched (2026-09-07), so a fixture that gave
  // only the Professor a button stopped exercising the Librarian's row at all.
  env.BUTTONS = buttons({ 3: PID, 8: LIB });
  return env;
}
const get = (p) => new Request(`https://x${p}`);
const post = (p, body, init = {}) =>
  new Request(`https://x${p}`, { method: "POST", body, ...init });
// A program's own page inside the app. Load, Delete and the on-air words live
// there since the grid (the owner chose B, 2026-09-23); the Shelf's card keeps
// only Play.
const progPage = async (env, slug) =>
  (await worker.fetch(get(`/buttons/${LIBKEY}/programs/${slug}`), env)).text();
const cards = (html) => (html.match(/<li class="card/g) ?? []).length;

test("the chooser is a form, never a link", async () => {
  // A GET that rewrites a playlist gets fired by link prefetchers and by the
  // preview every chat app builds, so pasting the library URL into a message
  // would change what the room plays.
  const env = libEnv();
  await env.PROGRAMS.put("program:one", JSON.stringify({ slug: "one" }),
    { metadata: { title: "One", created: "2026-08-28", tracks: 12, runtime: "1:02:00" } });
  const res = await worker.fetch(get(`/notes/${LIBKEY}`), env);
  const html = await res.text();
  assert.ok(!/<a[^>]+activate/.test(html), "no anchor anywhere on the Shelf posts a load");
  // The chooser lives on the program's own page since the grid (2026-09-23),
  // and it is still a form there.
  const page = await progPage(env, "one");
  assert.match(page, /<form method="post" action="\/notes\/[^"]+\/activate">/);
  assert.ok(!/<a[^>]+activate/.test(page), "and no anchor anywhere near it");
  // The shelf shows a sleeve per program, off whichever service's host the
  // program's records live on — and no other host, and still no scripts.
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /img-src 'self' https:\/\/i\.scdn\.co https:\/\/resources\.tidal\.com; manifest-src 'self';/,
    "the sleeves' two hosts, the site's own touch icon, and the manifest (MC-14)");
  assert.ok(!/script-src/.test(csp), "and still no scripts");
  assert.match(csp, /default-src 'none'/);
});

test("a GET on the activate route does nothing, and says why", async () => {
  const env = libEnv();
  const res = await worker.fetch(get(`/notes/${LIBKEY}/activate`), env);
  assert.equal(res.status, 405, "not 404 — a working route must not look broken");
  assert.match(await res.text(), /only accepts POST/);
});

test("the wrong key cannot activate anything", async () => {
  const env = libEnv();
  const res = await worker.fetch(
    post(`/notes/0000000000000000000000000/activate`, new URLSearchParams({ slug: "one" })), env);
  assert.equal(res.status, 404);
});

test("a cross-origin form post is refused", async () => {
  // Without this any page anywhere could post here on behalf of a browser that
  // has the library open.
  const env = libEnv();
  const res = await worker.fetch(
    post(`/notes/${LIBKEY}/activate`, new URLSearchParams({ slug: "one" }),
      { headers: { origin: "https://somewhere-else.example" } }), env);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /somewhere-else\.example/);
});

test("a wrong key still learns nothing", async () => {
  // The one failure that stays a bare 404: the reply must not confirm that the
  // route exists to somebody guessing at the key.
  const env = libEnv();
  const res = await worker.fetch(
    post(`/notes/0000000000000000000000000/activate`,
      new URLSearchParams({ slug: "one" })), env);
  assert.equal(res.status, 404);
  assert.equal((await res.text()).trim(), "not found",
    "the same body every other unknown path gives, and nothing more");
});

test("an in-app webview posting Origin: null is not treated as an attacker", async () => {
  // Phones open this page inside webviews that send `Origin: null`. Refusing
  // those made the button answer "not found" for the only person who uses it.
  const env = libEnv();
  // The Librarian's: a record with no `dj` was the Professor's, cut 2026-10-15.
  await env.PROGRAMS.put("program:one", JSON.stringify({
    slug: "one", dj: "The Librarian",
    sections: [{ tracks: [{ uri: "spotify:track:aaa" }] }],
  }), { metadata: { title: "One", dj: "The Librarian" } });
  const f = installFetch({ contents: [track("old")] });
  try {
    const res = await worker.fetch(
      post(`/notes/${LIBKEY}/activate`, new URLSearchParams({ slug: "one" }),
        { headers: { origin: "null" } }), env);
    assert.equal(res.status, 303, "it went through");
    assert.match(res.headers.get("location"), /\?put=ok%3Aone/);
  } finally { f.restore(); }
});

test("the shelf marks which program is on the button", async () => {
  const env = libEnv();
  // The Librarian's, on her 3 (no `dj` was the Professor's, cut 2026-10-15).
  for (const [id, title] of [["one", "One"], ["two", "Two"]]) {
    await env.PROGRAMS.put(`program:${id}`, JSON.stringify({ slug: id, dj: "The Librarian" }),
      { metadata: { title, dj: "The Librarian", created: "2026-08-28", tracks: 12, runtime: "1:02:00" } });
  }
  await env.PROGRAMS.put(`current:${PID}`, "two");
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  // The grid (2026-09-23): the live card comes first, marked live, and
  // nothing on the Shelf loads.
  assert.ok(html.indexOf(">Two<") < html.indexOf(">One<"), "live first");
  assert.match(html, /<li class="card live">\s*<div class="cover"><a class="coverlink" href="[^"]*\/programs\/two"/);
  assert.equal((html.match(/<li class="card live">/g) ?? []).length, 1);
  assert.ok(!html.includes("Load on preset"));
  // The live one's page gets a badge instead of a button, so it cannot be
  // re-activated; the other one's page keeps the button.
  const two = await progPage(env, "two");
  // Named, now the record names its DJ (no `dj` read "On the preset").
  assert.match(two, /On The Librarian\u2019s preset/);
  assert.ok(!two.includes("Load on preset"));
  assert.match(await progPage(env, "one"), />Load on preset<\/button>/);
});

test("the shelf never calls Spotify to find out what is live", async () => {
  // It is reachable by anyone holding the link. A page view must not spend the
  // account's token — the id comes from the alias map, which is configuration.
  const f = installFetch({ contents: [] });
  try {
    const env = libEnv();
    await env.PROGRAMS.put("program:one", JSON.stringify({ slug: "one" }),
      { metadata: { title: "One", created: "2026-08-28", tracks: 1, runtime: "3:00" } });
    await env.PROGRAMS.put(`current:${PID}`, "one");
    await worker.fetch(get(`/notes/${LIBKEY}`), env);
    assert.deepEqual(f.calls, [], "no outbound request of any kind");
  } finally { f.restore(); }
});

test("a made-up slug in the flash prints nothing", async () => {
  // The slug comes back through a URL the visitor can edit, so the message is
  // built from the row it matches rather than from what the URL claims.
  const env = libEnv();
  const html = await (await worker.fetch(
    get(`/notes/${LIBKEY}?put=ok%3Anot-a-real-program`), env)).text();
  assert.ok(!/is on the button/.test(html));
});

test("a stale result URL does not claim a program is loaded", async () => {
  // The 303 leaves ?put= in history and in any URL that gets shared. Reopening
  // it after the button has moved on must not contradict the badge.
  const env = libEnv();
  for (const [id, title] of [["one", "One"], ["two", "Two"]]) {
    await env.PROGRAMS.put(`program:${id}`, JSON.stringify({ slug: id }),
      { metadata: { title, created: "2026-08-28", tracks: 12, runtime: "1:02:00" } });
  }
  await env.PROGRAMS.put(`current:${PID}`, "two");   // "two" is what is live now
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}?put=ok%3Aone`), env)).text();
  assert.match(html, /“One” is not on the button/);
  assert.ok(!/“One” is on the button/.test(html));
});

test("a write nothing could verify is not announced as loaded", async () => {
  // A mismatch returns ok and CLEARS the pointer, precisely so that nothing
  // claims to know what is on the playlist. The shelf must not claim it either.
  const env = libEnv();
  await env.PROGRAMS.put("program:one", JSON.stringify({ slug: "one" }),
    { metadata: { title: "One", created: "2026-08-28", tracks: 12, runtime: "1:02:00" } });
  // No current: pointer — exactly the state a mismatch leaves behind.
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}?put=ok%3Aone`), env)).text();
  assert.match(html, /is not on the button/);
});

test("the shelf's own success message needs the pointer to agree", async () => {
  const env = libEnv();
  await env.PROGRAMS.put("program:one", JSON.stringify({ slug: "one", dj: "The Librarian" }),
    { metadata: { title: "One", dj: "The Librarian", created: "2026-08-28", tracks: 12, runtime: "1:02:00" } });
  await env.PROGRAMS.put(`current:${PID}`, "one");
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}?put=ok%3Aone`), env)).text();
  assert.match(html, /“One” is on the button/);
});

// ------------------------------------------------------------- the two caps

function longProgram(n, over = {}) {
  return {
    title: "A Long Argument",
    thesis: "Length is a budget question.",
    sections: [{
      heading: "One", prose: [para("Prose.")],
      tracks: Array.from({ length: n }, (_, i) => ({
        uri: `spotify:track:${String(i).padStart(22, "a")}`,
        artist: "Someone", year: "1970",
      })),
    }],
    complications: [para("A rival reading.")],
    ...over,
  };
}

test("a held-back program may run to 38 tracks", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const env = libEnv();
    const budget = { remaining: 40 };
    const out = await callTool(env, "make_librarian_program", longProgram(38), budget);
    assert.equal(out.on_button, false);
    assert.equal(out.tracks, 38);
    // The whole reason 38 is the number: it has to fit the allowance.
    assert.ok(budget.remaining >= 0,
      `spent ${40 - budget.remaining} of 40 — over the margin that keeps it under 50`);
  } finally { f.restore(); }
});

test("39 is refused, and the message says what to do", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    await assert.rejects(
      () => callTool(libEnv(), "make_librarian_program", longProgram(39), { remaining: 40 }),
      /over the 38 limit/);
  } finally { f.restore(); }
});

test("loading the button in the same call still caps at 30", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    await assert.rejects(
      () => callTool(libEnv(), "make_librarian_program",
        longProgram(31, { load_button: true }), { remaining: 40 }),
      /over the 30 limit[\s\S]*WITHOUT loading the button allows 38/,
      "and it says how to get the longer one");
  } finally { f.restore(); }
});

test("activating a 38-track program costs no per-track lookups", async () => {
  // The reason the two caps can differ at all: activation reads URIs out of the
  // record, so a long program published on its own can still reach the button.
  const f = installFetch({ contents: [track("a")] });
  try {
    const env = libEnv();
    await callTool(env, "make_librarian_program", longProgram(38), { remaining: 40 });
    const rows = await callTool(env, "list_programs", {}, { remaining: 40 });
    const id = rows.programs[0].id;

    const budget = { remaining: 40 };
    const out = await callTool(env, "activate_program", { id }, budget);
    assert.equal(out.tracks, 38);
    assert.ok(40 - budget.remaining < 12,
      `activation spent ${40 - budget.remaining}, which should not scale with length`);
  } finally { f.restore(); }
});

// ------------------------------------------------------------- shelf covers

test("only Spotify's image host is ever put in a src", async () => {
  // The stored value has passed through a program record, so this is narrower
  // than safeUrl on purpose: the page fetches this URL by itself.
  assert.equal(imageUrl("https://i.scdn.co/image/ab67616d00001e02a1f3c9b969b58b5863d4ffeb"),
    "https://i.scdn.co/image/ab67616d00001e02a1f3c9b969b58b5863d4ffeb");
  for (const bad of ["https://evil.example/x.png", "javascript:alert(1)",
                     "https://i.scdn.co.evil.example/image/aaaaaaaaaaaaaaaa",
                     "http://i.scdn.co/image/aaaaaaaaaaaaaaaa", "", null]) {
    assert.equal(imageUrl(bad), null, `${bad} must not reach a src`);
  }
});

test("a program with no cover gets an empty tile, not a broken one", () => {
  const html = renderLibrary([{ id: "b", title: "No art", dj: "The Professor", created: "2026-08-27" }]);
  // The grid (2026-09-23): the DJ's initials, "The" dropped, on a plain tile.
  assert.match(html, /<div class="cover"><span class="noart" aria-hidden="true">P<\/span>/,
    "the card still holds its place");
  assert.ok(!/<img /.test(html), "and nothing tries to load");
});

test("the cover is the most frequent artist's, not the first track's", () => {
  // The first track of a program is usually an ancestor rather than its
  // subject: the Nick Lowe program opens on Eggs Over Easy.
  const tracks = [
    { artist: "Eggs Over Easy", image: "https://i.scdn.co/image/aaaaaaaaaaaaaaaa" },
    { artist: "Nick Lowe", image: "https://i.scdn.co/image/bbbbbbbbbbbbbbbb" },
    { artist: "Nick Lowe", image: "https://i.scdn.co/image/cccccccccccccccc" },
    { artist: "Dr. Feelgood", image: "https://i.scdn.co/image/dddddddddddddddd" },
  ];
  assert.equal(pickCover(tracks), "https://i.scdn.co/image/bbbbbbbbbbbbbbbb",
    "the subject appears most, and its FIRST cover is the one used");
  assert.equal(pickCover([]), null);
  assert.equal(pickCover([{ artist: "X" }]), null, "an artist with no art is not a cover");
});

test("one man's catalogue is not a roster just because the billing changes", () => {
  // Fourteen Stan Getz records under four credit lines. Counting the whole
  // billing made his own survey look like a scene, and the cover fell through
  // to whatever was first. Splitting the string on the comma is not the fix
  // either — Earth, Wind & Fire is one artist with two commas' worth of name.
  const getz = [
    { lead: "Stan Getz", artist: "Stan Getz, Charlie Byrd", image: "https://i.scdn.co/image/a1" },
    { lead: "Stan Getz", artist: "Stan Getz, Charlie Byrd", image: "https://i.scdn.co/image/a1" },
    { lead: "Stan Getz", artist: "Stan Getz, João Gilberto", image: "https://i.scdn.co/image/b2" },
    { artist: "Astrud Gilberto", image: "https://i.scdn.co/image/c3" },
  ];
  assert.equal(pickCover(getz), "https://i.scdn.co/image/a1",
    "three of four are his, so the first of his records is the cover");

  // And a record written before `lead` existed still groups on its credit line.
  assert.equal(
    pickCover([
      { artist: "Earth, Wind & Fire", image: "https://i.scdn.co/image/ew" },
      { artist: "Earth, Wind & Fire", image: "https://i.scdn.co/image/ew2" },
      { artist: "Chic", image: "https://i.scdn.co/image/ch" },
    ]),
    "https://i.scdn.co/image/ew");
});

test("a cover the shelf already shows is passed over for the next candidate", () => {
  // Two programs on one subject really do share a top artist. Identical
  // adjacent rows read as a bug, and every fallback is still a record from
  // this program, so the cover stays true.
  const tracks = [
    { artist: "Twisted Sister", image: "https://i.scdn.co/image/taken" },
    { artist: "Twisted Sister", image: "https://i.scdn.co/image/taken" },
    { artist: "Dokken", image: "https://i.scdn.co/image/free" },
    { artist: "Dokken", image: "https://i.scdn.co/image/free" },
    { artist: "W.A.S.P.", image: "https://i.scdn.co/image/third" },
  ];
  assert.equal(pickCover(tracks), "https://i.scdn.co/image/taken",
    "with nothing taken it is still the most frequent artist's");
  assert.equal(pickCover(tracks, new Set(["https://i.scdn.co/image/taken"])),
    "https://i.scdn.co/image/free", "the runner-up when the winner is spoken for");
  assert.equal(
    pickCover(tracks, new Set(["https://i.scdn.co/image/taken", "https://i.scdn.co/image/free"])),
    "https://i.scdn.co/image/third", "and on down the ranking");

  // A program whose every record is already on the shelf keeps the duplicate:
  // a repeated thumbnail beats a hole in the row.
  assert.equal(
    pickCover(tracks, new Set([
      "https://i.scdn.co/image/taken", "https://i.scdn.co/image/free",
      "https://i.scdn.co/image/third",
    ])),
    "https://i.scdn.co/image/taken");
});

test("a second program on one subject does not inherit the first's cover", async () => {
  // The wiring, not the ranking: publishing reads what the shelf already shows
  // and hands it to pickCover. Both programs are topped by the same artist,
  // which is what happened when two hair-metal nights were cut minutes apart.
  const e = env();
  const f = installFetch({
    contents: [track("existing")],
    artists: { aaa: "Twisted Sister", bbb: "Twisted Sister", ccc: "Dokken" },
  });
  const twice = (over) => program({
    load_button: false,
    sections: [{
      heading: "The room", prose: [para("A claim.")],
      tracks: [
        { uri: "spotify:track:aaa", artist: "Twisted Sister" },
        { uri: "spotify:track:bbb", artist: "Twisted Sister" },
      ],
    }],
    ...over,
  });
  try {
    await callTool(e, "make_librarian_program", twice({ title: "First Night" }), { remaining: 40 });
    await callTool(e, "make_librarian_program", twice({
      title: "Second Night",
      sections: [{
        heading: "Another room", prose: [para("A second claim.")],
        tracks: [
          { uri: "spotify:track:aaa", artist: "Twisted Sister" },
          { uri: "spotify:track:bbb", artist: "Twisted Sister" },
          { uri: "spotify:track:ccc", artist: "Dokken" },
        ],
      }],
    }), { remaining: 40 });

    const { keys } = await e.PROGRAMS.list({ prefix: "program:" });
    const covers = keys.map((k) => k.metadata?.image);
    assert.equal(covers.length, 2);
    assert.ok(covers.every(Boolean), "both got a cover");
    assert.notEqual(covers[0], covers[1], "and they are not the same one");
    // The second fell through to a record that is genuinely in it.
    assert.ok(covers.includes("https://i.scdn.co/image/ccc"));
  } finally { f.restore(); }
});

test("the thumbnail is the middle size, not the 640", () => {
  // A shelf row does not need a megabyte, and 64 blurs on a phone.
  assert.equal(pickImage([
    { url: "https://i.scdn.co/image/big", width: 640 },
    { url: "https://i.scdn.co/image/mid", width: 300 },
    { url: "https://i.scdn.co/image/tiny", width: 64 },
  ]), "https://i.scdn.co/image/mid");
  assert.equal(pickImage([{ url: "https://i.scdn.co/image/only", width: 64 }]),
    "https://i.scdn.co/image/only", "falls back rather than returning nothing");
  // A cover somebody uploaded to a playlist comes from Spotify with no
  // width at all. It is under any floor, and the fallback is what puts it
  // on the buttons page — every uploaded cover there rides on this line.
  assert.equal(pickImage([{ url: "https://image-cdn-fa.spotifycdn.com/image/abcdefabcdefabcdefabcdef", width: null, height: null }]),
    "https://image-cdn-fa.spotifycdn.com/image/abcdefabcdefabcdefabcdef");
  assert.equal(pickImage([]), null);
  assert.equal(pickImage(undefined), null);
});

test("the same rule picks the 320 off both of Tidal's ladders", () => {
  // tidal/probe3.py measured these: 1280 down to 160 for an album sleeve,
  // 1080 down to 160 for a playlist's own cover. The 160 is the one that
  // blurs; the 320 is the one a shelf wants. One floor serves all three ladders.
  const rung = (w) => ({ url: `https://resources.tidal.com/images/x/${w}`, width: w });
  assert.equal(pickImage([1280, 1080, 750, 640, 320, 160].map(rung)).endsWith("/320"), true);
  assert.equal(pickImage([160, 320, 480, 1080].map(rung)).endsWith("/320"), true,
    "order does not matter, only size");
  assert.equal(pickImage([rung(160)]).endsWith("/160"), true,
    "a ladder with nothing over the floor still yields a picture");
});


// ------------------------------------------------------- the second writer
//
// One implementation, two characters. Everything below is about the seam: which
// button a program lands on, which obligations its page states, and what
// happens to programs written when there was only one DJ who wrote them.

function survey(over = {}) {
  return {
    title: "Stiff Records: The First Eighteen Months",
    thesis: "Everything Stiff released from BUY 1 in August 1976 to the end of 1977, and nothing after Costello left for Radar.",
    sections: [{
      label: "The First Six Singles", years: "1976",
      heading: "A label that could press a record in a fortnight",
      prose: [para("Stiff existed because pressing plants had spare capacity.", ["s1"])],
      tracks: [{ uri: "spotify:track:aaa", artist: "MFSB", year: "1976" }],
    }],
    complications: [para("No Ian Dury here: New Boots is late 1977 and wants its own hour.")],
    sources: [{ id: "s1", title: "Stiff: The Story of a Record Label" }],
    ...over,
  };
}

// Never on the Professor's, until he was cut (2026-10-15): she is on his 3
// now, and Deep Dive on her 8.
test("a survey lands on the Librarian's button and nobody else's", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const out = await callTool(
      e, "make_librarian_program", survey({ load_button: true }), { remaining: 40 });
    assert.equal(out.dj, "The Librarian");
    assert.equal(out.button, "button 3");
    const slug = out.url.split("/").pop();
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), slug);
    assert.equal(await e.PROGRAMS.get(`current:${LIB}`), null,
      "Deep Dive's button is not touched by somebody else publishing");
  } finally { undo(); f.restore(); }
});

// Same property, two ways. Was the four writers added 2026-08-30 and
// 2026-09-04 until they were cut (the owner, 2026-10-13), then three, until
// the Professor went too (2026-10-15); the two who stay carry it now, each
// publish checked against the other's pointer.
test("each writer lands on its own button and nobody else's", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = gateEnv();
    const cases = [
      ["make_librarian_program", survey({ load_button: true }), "The Librarian", "button 3", PROF, "survey"],
      ["make_gatefold_program", sleeve({ load_button: true }), "Gatefold", "button 2", GATE, "sleeve"],
    ];
    const pointers = (except) => Promise.all(cases.filter((c) => c[4] !== except)
      .map((c) => e.PROGRAMS.get(`current:${c[4]}`)));
    for (const [tool, args, name, button, pid, shape] of cases) {
      const before = await pointers(pid);
      const out = await callTool(e, tool, args, { remaining: 40 });
      assert.equal(out.dj, name);
      assert.equal(out.button, button);
      const slug = out.url.split("/").pop();
      assert.equal(await e.PROGRAMS.get(`current:${pid}`), slug);
      const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
      assert.equal(rec.shape, shape);
      assert.deepEqual(await pointers(pid), before, `${name} moved nobody else's pointer`);
    }
  } finally { undo(); f.restore(); }
});

// "Each writer is refused for leaving out its own obligation" went with the
// four (2026-10-13); the two who stay are each refused in their own words
// below — the Librarian, and Gatefold on his own.

// ------------------------------------- Writing from the bench, 2026-09-07

// A writer off the wall. On 2026-09-07 three of the seven writers were
// benched — the Correspondent, the Engineer and Baddie — and every one of
// their tools refused outright, because a preset was demanded at the door.
// The Engineer stood for them here until the four were cut (the owner,
// 2026-10-13); Gatefold, who env() never seats, stands in now.
function benchedEnv() {
  return env();
}

test("a benched writer still publishes — a page, and no preset on it", async () => {
  const e = benchedEnv();
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const out = await callTool(e, "make_gatefold_program", sleeve(), { remaining: 40 });
    assert.equal(out.dj, "Gatefold");
    assert.equal(out.on_button, false);
    assert.match(out.note, /on no preset, so this is on the shelf and on no playlist at all/);
    const slug = out.url.split("/").pop();
    const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.equal(rec.playlistId, null, "no preset, so no playlist for it to claim");
    assert.equal(rec.playlistName, null);
    // And nothing anywhere says it is loaded.
    assert.equal(await e.PROGRAMS.get(`current:${GATE}`), null);
  } finally { undo(); f.restore(); }
});

// The case the first cut of this feature could not do, and the suite could not
// see: benchedEnv() above is a SINGLE-service house, so `houseCatalog()` had
// exactly one answer. A house on two services refuses to guess — correctly —
// and a benched DJ has no catalog of their own, so publishing from the bench
// was impossible in precisely the houses the tenancy makes ordinary. Found by
// Codex on 2026-09-07, the day the feature shipped.
test("a benched writer in a MIXED house takes the catalog from the tracks", async () => {
  const e = benchedEnv();
  e.BUTTONS = JSON.stringify([
    { button: 3, dj: "the-librarian", playlist: PROF, catalog: "spotify" },
    { button: 12, dj: "americana", playlist: TPID, catalog: "tidal" },
  ]);
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const out = await callTool(e, "make_gatefold_program", sleeve(), { remaining: 40 });
    assert.equal(out.dj, "Gatefold");
    assert.equal(out.on_button, false);
    const slug = out.url.split("/").pop();
    const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.equal(rec.playlistId, null);
    assert.equal(rec.sections[0].tracks[0].uri, "spotify:track:aaa",
      "resolved on the service its own tracks name");

    // And a set that names two services is refused rather than half-written.
    const split = survey({ sections: [{
      label: "x", years: "1976", heading: "Two services",
      prose: [para("p")],
      tracks: [{ uri: "spotify:track:aaa", artist: "MFSB" },
               { uri: "tidal:track:12345", artist: "MFSB" }],
    }] });
    await assert.rejects(
      () => callTool(e, "make_gatefold_program", split, { remaining: 40 }),
      /the service comes from the tracks/);
  } finally { undo(); f.restore(); }
});

test("a benched writer is refused ONLY for the half that touches the room", async () => {
  const e = benchedEnv();
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    await assert.rejects(
      () => callTool(e, "make_gatefold_program", sleeve({ load_button: true }), { remaining: 40 }),
      /not on a preset here, so there is no button to load this onto/);
    const { keys } = await e.PROGRAMS.list({ prefix: "program:" });
    assert.equal(keys.length, 0, "refused before anything was published");
  } finally { undo(); f.restore(); }
});

// The half that makes writing from the bench worth anything: the page has to
// be able to land somewhere later. activate_program resolves the preset its DJ
// holds NOW rather than one recorded at publication, and the record is stamped
// with the playlist it actually wrote — which for a bench page is its first.
test("a page written from the bench takes the preset its DJ holds later", async () => {
  const e = benchedEnv();
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const out = await callTool(e, "make_gatefold_program", sleeve(), { remaining: 40 });
    const slug = out.url.split("/").pop();
    assert.equal((await e.PROGRAMS.get(`program:${slug}`, { type: "json" })).playlistId, null);

    // The owner puts him on preset 2.
    e.BUTTONS = gateEnv().BUTTONS;
    const put = await callTool(e, "activate_program", { id: slug }, { remaining: 40 });
    assert.equal(put.button, "button 2");
    assert.equal(await e.PROGRAMS.get(`current:${GATE}`), slug);
    // The stamp is the part that would have gone missing: null -> an id is not
    // a MOVE, so the re-put used to be skipped and the page would have said it
    // was not loaded for ever while the tracks sat on the preset.
    const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.equal(rec.playlistId, GATE, "the record adopts the playlist it was written to");
    // Whatever the resolve called it — the harness names every playlist the
    // same. What matters is that it is no longer null.
    assert.ok(rec.playlistName, "and the name it resolved to");
    // And the listing row survived the re-put, the way every move must.
    const { keys } = await e.PROGRAMS.list({ prefix: `program:${slug}` });
    assert.equal(keys[0]?.metadata?.title, rec.title, "the shelf row kept its metadata");
  } finally { undo(); f.restore(); }
});

// --------------------------------------- Gatefold, the seventh writer, 2026-09-07

// His seat. Gatefold holds preset 2 in the real house; the shared harness still
// has the config's Hank there, so he is added explicitly rather than moving
// everybody else out of the way. GATE is defined at the top.
function gateEnv() {
  const e = env();
  e.BUTTONS = JSON.stringify([
    ...JSON.parse(buttons({ 3: PROF, 8: LIB })),
    { button: 2, dj: "gatefold", playlist: GATE, catalog: "spotify" },
  ]);
  return e;
}

// A RUN, not a track: his fixture cannot be the one-track `survey()` the other
// writers' tests share, because a section of one is the thing he refuses.
function sleeve(over = {}) {
  return {
    title: "Two Sides, Nineteen Seventy-Three",
    thesis: "Two records that keep their best run to the end of side two, and what each join does.",
    sections: [{
      label: "Side two", years: "1973",
      heading: "Steely Dan — Countdown to Ecstasy",
      prose: [para("The side does not resolve until the second of these.", ["s1"])],
      tracks: [
        { uri: "spotify:track:aaa", artist: "MFSB", year: "1973" },
        { uri: "spotify:track:bbb", artist: "MFSB", year: "1973" },
      ],
    }],
    complications: [para("The original sequence is only on the 1973 pressing.")],
    sources: [{ id: "s1", title: "A sleeve" }],
    ...over,
  };
}

test("sleeve notes land on Gatefold's own button and carry the sleeve shape", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = gateEnv();
    const out = await callTool(e, "make_gatefold_program",
      sleeve({ load_button: true }), { remaining: 40 });
    assert.equal(out.dj, "Gatefold");
    assert.equal(out.button, "button 2");
    const slug = out.url.split("/").pop();
    assert.equal(await e.PROGRAMS.get(`current:${GATE}`), slug);
    const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.equal(rec.shape, "sleeve");
    assert.equal(rec.sections[0].tracks.length, 2, "the run is kept whole");
    // Nobody else's button moves, the way every other writer's tool behaves.
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), null);
    assert.equal(await e.PROGRAMS.get(`current:${LIB}`), null);
  } finally { undo(); f.restore(); }
});

// His defining rule, and the only one on the roster the tools CHECK rather
// than ask for: "a track comes with its neighbour or not at all". It is a
// method, not a preference, so nothing in the house rules can move it — and a
// rule the tools cannot check breaks silently, which this roster has paid for
// once already (Baddie's explicit records).
test("a run of ONE is refused, in his words, and nothing is published", async () => {
  const e = gateEnv();
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const lone = sleeve({
      load_button: true,
      sections: [{
        label: "Side one", years: "1973", heading: "One record, one track",
        prose: [para("A single with the method removed.")],
        tracks: [{ uri: "spotify:track:aaa", artist: "MFSB", year: "1973" }],
      }],
    });
    await assert.rejects(() => callTool(e, "make_gatefold_program", lone, { remaining: 40 }),
      /a run of ONE is a single/);
    // Refused BEFORE anything is written: no page, no pointer, no backup.
    assert.equal(await e.PROGRAMS.get(`current:${GATE}`), null);
    assert.equal((await listSnapshots(e, GATE)).length, 0);

    // And it names WHICH sections, so a long set does not have to be hunted.
    const mixed = sleeve({
      sections: [
        sleeve().sections[0],
        { label: "Side two", years: "1971", heading: "Second record",
          prose: [para("p")], tracks: [{ uri: "spotify:track:ccc", artist: "MFSB" }] },
        { label: "Side one", years: "1972", heading: "Third record",
          prose: [para("p")], tracks: [{ uri: "spotify:track:ddd", artist: "MFSB" }] },
      ],
    });
    await assert.rejects(() => callTool(e, "make_gatefold_program", mixed, { remaining: 40 }),
      /Sections 2, 3 hold one track/);
  } finally { undo(); f.restore(); }
});

// The structural check takes COUNTS, not sections, so both publishing paths
// can run it: make_gatefold_program has a list of tracks per section,
// keep_request_set has a number saying how many of an existing set it covers.
// It read `sec.tracks.length` at first, which silently passed everything on
// the kept path — a number has no `.length` (Codex, 2026-09-07).
test("Gatefold's run rule is counted the same way on both publishing paths", () => {
  const check = __test.PROGRAM_TOOLS.make_gatefold_program.checkSections;
  assert.equal(check([2, 3, 4]), null, "runs of two or more are fine");
  assert.match(check([1]), /Section 1 holds one track/);
  assert.match(check([3, 1, 1]), /Sections 2, 3 hold one track/);
  assert.match(check([1]), /a run of ONE is a single/);
  // A number is what keep_request_set passes; a length is what the other path
  // computes. Both arrive here as plain counts.
  assert.equal(check([]), null, "nothing to judge is not a failure");
});

test("Gatefold is refused for leaving out his own two obligations", async () => {
  const e = gateEnv();
  const f = installFetch();
  try {
    await assert.rejects(
      () => callTool(e, "make_gatefold_program", sleeve({ complications: [] }), { remaining: 40 }),
      /record that would not sequence/);
    await assert.rejects(
      () => callTool(e, "make_gatefold_program", sleeve({ thesis: "" }), { remaining: 40 }),
      /which records these are and what the runs have to do with each other/);
  } finally { f.restore(); }
});

test("a kept set of Gatefold's owes a full program, because the registry says he writes", () => {
  const e = gateEnv();
  const kind = __test.writerKindFor(e, __test.findDj(e, "gatefold"));
  assert.equal(kind?.shape, "sleeve",
    "the writers roster is derived from PROGRAM_TOOLS, so registering the tool is what makes him owe the writing");
});

// Was "a night, a correspondence and a session label their boxes
// differently" until those writers were cut (the owner, 2026-10-13). A page
// still carrying one of their shapes renders as an argument, never blank.
test("sleeve notes label their boxes their own way, and a cut writer's shape reads as an argument", () => {
  const base = {
    title: "T", thesis: "S", dj: "X", created: "2026-08-30T00:00:00Z", tracks: 1,
    runtime: "3:00", playlistName: "P",
    sections: [{ heading: "h", prose: [para("p")], tracks: [] }],
    complications: [para("c")], coda: [para("d")],
  };
  for (const shape of ["night", "correspondence", "session", "chain"]) {
    const gone = renderProgram({ ...base, shape }, {});
    assert.ok(gone.includes("Where this could be wrong"), shape);
    assert.ok(gone.includes("What the set is arguing"), shape);
    assert.ok(gone.includes("<span>Program</span>"), shape);
  }
  // The seventh, 2026-09-07. Both boxes are about the PRESSING rather than
  // the argument, because the record as sequenced is what he is writing about.
  const slv = renderProgram({ ...base, shape: "sleeve" }, {});
  assert.ok(slv.includes("The record that would not sequence"));
  assert.ok(slv.includes("After the run-out groove"));
  assert.ok(slv.includes("<span>Sleeve Notes</span>"));
  // An unknown or missing shape still renders as an argument, never blank.
  const old = renderProgram({ ...base }, {});
  assert.ok(old.includes("Where this could be wrong"));
});

test("the record carries which kind of program it is", async () => {
  const f = installFetch({ contents: [] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const a = await callTool(e, "make_librarian_program", survey(), { remaining: 40 });
    // The Professor's argument until he was cut (2026-10-15); Gatefold's
    // sleeve notes now, written from the bench.
    const b = await callTool(e, "make_gatefold_program", sleeve(), { remaining: 40 });
    const one = await e.PROGRAMS.get(`program:${a.url.split("/").pop()}`, { type: "json" });
    const two = await e.PROGRAMS.get(`program:${b.url.split("/").pop()}`, { type: "json" });
    assert.equal(one.shape, "survey");
    assert.equal(one.dj, "The Librarian");
    assert.equal(two.shape, "sleeve");
    assert.equal(two.dj, "Gatefold");
  } finally { undo(); f.restore(); }
});

test("a survey's page owes different things than an argument's", () => {
  const base = {
    slug: "s", dj: "The Librarian", title: "T", thesis: "Th",
    sections: [{ heading: "H", prose: [{ text: "P" }], tracks: [] }],
    complications: [{ text: "Left out." }], coda: [{ text: "Next." }],
    created: "2026-08-28T00:00:00.000Z", tracks: 1, runtime: "3:00",
    playlistName: "The Librarian",
  };
  const s = renderProgram({ ...base, shape: "survey" }, {});
  assert.match(s, /What is not here/);
  assert.match(s, /Where to go next/);
  assert.match(s, /<span>Survey<\/span>/);
  assert.ok(!/Where this could be wrong/.test(s));

  const a = renderProgram({ ...base, dj: "The Professor", shape: "argument" }, {});
  assert.match(a, /Where this could be wrong/);
  assert.match(a, /What the set is arguing/);
  assert.match(a, /<span>Program<\/span>/);

  // Every program published before `shape` existed was an argument, and its
  // page must not silently start calling itself something else.
  const old = renderProgram({ ...base, dj: "The Professor" }, {});
  assert.match(old, /Where this could be wrong/);
  assert.match(old, /<span>Program<\/span>/);
});

test("activate_program sends a program back to whoever wrote it", async () => {
  const f = installFetch({ contents: [track("old")] });
  const undo = withTrackLookup();
  try {
    const e = env();
    const made = await callTool(e, "make_librarian_program", survey(), { remaining: 40 });
    const slug = made.url.split("/").pop();
    assert.equal(made.on_button, false, "published and held back");

    const back = await callTool(e, "activate_program", { id: slug }, { remaining: 40 });
    assert.equal(back.program, "Stiff Records: The First Eighteen Months");
    // Her preset is 3 since the Professor was cut (2026-10-15).
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), slug);
    assert.equal(await e.PROGRAMS.get(`current:${LIB}`), null);
  } finally { undo(); f.restore(); }
});

// It went back to the Professor until the owner cut him (2026-10-15); now it
// is refused in words, as any cut DJ's programme is, and nothing moves.
test("a program written before there was a second DJ was the Professor's, and is refused now he is cut", async () => {
  // `dj` has been on every record since programs existed, so this is the one
  // shape a real record could be missing it in — and it could only be his.
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = env();
    await e.PROGRAMS.put("program:ancient", JSON.stringify({
      slug: "ancient", title: "Before The Registry Grew", playlistId: PROF,
      sections: [{ tracks: [{ uri: "spotify:track:aaa" }] }],
    }), { metadata: { title: "Before The Registry Grew" } });
    await assert.rejects(callTool(e, "activate_program", { id: "ancient" }, { remaining: 40 }),
      /"Before The Registry Grew" was written by the Professor, who is no longer in the DJ registry[\s\S]*Nothing was changed\./);
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), null);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:old"], "the Librarian's 3 untouched");
  } finally { f.restore(); }
});

test("the shelf is shared, and it cannot cross-load one DJ onto another's button", async () => {
  // The library key reaches every DJ's programs now. The bound that keeps it
  // safe is that a row can only ever go back to its own author's playlist —
  // which is read from the record, not from the form.
  const e = libEnv();
  // Two writers: Gatefold on 3, the Librarian on 8 (the Professor was on 3
  // until he was cut, 2026-10-15).
  e.BUTTONS = JSON.stringify([{ button: 3, dj: "gatefold", playlist: PROF, catalog: "spotify" },
    { button: 8, dj: "the-librarian", playlist: LIB, catalog: "spotify" }]);
  await e.PROGRAMS.put("program:survey", JSON.stringify({
    slug: "survey", dj: "The Librarian", title: "A Survey", playlistId: LIB,
    sections: [{ tracks: [{ uri: "spotify:track:aaa" }] }],
  }), { metadata: { title: "A Survey", dj: "The Librarian" } });
  const f = installFetch({ contents: [track("prof-set")] });
  try {
    const res = await worker.fetch(
      post(`/notes/${LIBKEY}/activate`, new URLSearchParams({ slug: "survey" })), e);
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /\?put=ok%3Asurvey/);
    assert.equal(await e.PROGRAMS.get(`current:${LIB}`), "survey");
    assert.equal(await e.PROGRAMS.get(`current:${PROF}`), null,
      "pressing a Librarian row must not disturb Gatefold's button");
  } finally { f.restore(); }
});

test("two buttons can be on the air at the same time", async () => {
  const e = libEnv();
  // Gatefold's on 3 where the Professor's were, until he was cut (2026-10-15).
  e.BUTTONS = JSON.stringify([{ button: 3, dj: "gatefold", playlist: PROF, catalog: "spotify" },
    { button: 8, dj: "the-librarian", playlist: LIB, catalog: "spotify" }]);
  await e.PROGRAMS.put("program:one", JSON.stringify({ slug: "one" }), {
    metadata: { title: "One", dj: "Gatefold", created: "2026-08-28", tracks: 12, runtime: "1:02:00" },
  });
  await e.PROGRAMS.put("program:two", JSON.stringify({ slug: "two" }), {
    metadata: { title: "Two", dj: "The Librarian", created: "2026-08-28", tracks: 9, runtime: "44:00" },
  });
  await e.PROGRAMS.put("program:three", JSON.stringify({ slug: "three" }), {
    metadata: { title: "Three", dj: "Gatefold", created: "2026-08-27", tracks: 8, runtime: "31:00" },
  });
  await e.PROGRAMS.put(`current:${PROF}`, "one");
  await e.PROGRAMS.put(`current:${LIB}`, "two");

  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), e)).text();
  // Two live cards, both ahead of the rest.
  assert.equal((html.match(/<li class="card live">/g) ?? []).length, 2);
  assert.match(html, /<span class="cmeta"><b>[^<]+<\/b> · Gatefold/);
  assert.match(html, /<span class="cmeta"><b>[^<]+<\/b> · The Librarian/);
  assert.ok(html.indexOf(">Three<") > html.indexOf(">One<") && html.indexOf(">Three<") > html.indexOf(">Two<"),
    "the one that is not live comes after both");
  // On their pages: each says whose preset, and only the one program that is
  // not live keeps its control.
  assert.match(await progPage(e, "one"), /On Gatefold\u2019s preset/);
  assert.match(await progPage(e, "two"), /On The Librarian\u2019s preset/);
  assert.ok(!(await progPage(e, "one")).includes("Load on preset"));
  assert.match(await progPage(e, "three"), />Load on preset<\/button>/);
});

test("the shelf says who wrote each program", async () => {
  const html = renderLibrary([
    { id: "a", title: "A Survey", dj: "The Librarian", created: "2026-08-28",
      tracks: 9, runtime: "44:00", url: "https://x/programs/a" },
  ]);
  // The card's one line: who, then how long (the grid, 2026-09-23).
  assert.match(html, /<span class="cmeta">The Librarian · 44m<\/span>/);
  // The masthead used to repeat the writers as an eyebrow. Since 2026-09-10
  // the writers ARE the filter's pills, and a filter offering one choice is
  // furniture — so with one writer the masthead says nothing the row does not.
  assert.ok(!/class="filter"/.test(html), "one writer, no filter");
  assert.ok(!html.includes("The Professor"), "and nobody who has not published");
});

test("the Librarian is refused for not saying what she left out", async () => {
  const f = installFetch({ contents: [] });
  try {
    const p = survey();
    delete p.complications;
    await assert.rejects(
      () => callTool(env(), "make_librarian_program", p, { remaining: 40 }),
      /what you LEFT OUT[\s\S]*claiming to be complete/);
    // The Professor kept his own reason here until he was cut (2026-10-15);
    // Gatefold's is tested with his own two obligations.
  } finally { f.restore(); }
});

test("the two writers are offered as tools, and the five cut are not", async () => {
  const e = env();
  e.MCP_SECRET = "s";
  const res = await worker.fetch(new Request("https://x/mcp/s", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }), e);
  const names = (await res.json()).result.tools.map((t) => t.name);
  assert.ok(names.includes("make_librarian_program"));
  assert.ok(names.includes("make_gatefold_program"));
  // Four cut on 2026-10-13, and the Professor's on 2026-10-15.
  for (const gone of ["make_bootlegger_program", "make_correspondent_program",
    "make_engineer_program", "make_baddie_program", "make_professor_program"]) {
    assert.ok(!names.includes(gone), `${gone} went with its DJ`);
  }
});

// ------------------------------------------------- Program Notes: the filter

// Two writers on one page. The filter exists because the shelf stopped being
// one person's, and it has to narrow WITHOUT lying about the total.
function twoWriters(env) {
  const rows = [
    ["a", "Aretha at Atlantic", "The Librarian"],
    ["b", "The Forgery That Became the Foundation", "The Professor"],
    ["c", "Stan Getz: The Bossa Nova Years", "The Librarian"],
  ];
  return Promise.all(rows.map(([slug, title, dj]) =>
    env.PROGRAMS.put(`program:${slug}`, JSON.stringify({ slug }), {
      metadata: { title, dj, created: "2026-08-28", tracks: 10, runtime: "29:39" },
    })));
}

test("the filter narrows to one writer and the count follows", async () => {
  const env = libEnv();
  await twoWriters(env);
  const all = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  assert.equal(cards(all), 3);

  const one = await (await worker.fetch(
    get(`/notes/${LIBKEY}?dj=the-librarian`), env)).text();
  assert.equal(cards(one), 2);
  // The pill names the filter and carries its number, and since the grid
  // (2026-09-23) the line under the title says it too: "2 programs by The
  // Librarian" is the one line of words the header keeps.
  assert.match(one, /<summary class="chip cur" aria-label="Filter the shelf — The Librarian shown">The Librarian<b class="n">2<\/b>/,
    "the pill must describe the filtered view, not the whole shelf");
  assert.match(one, /<div class="shsub"><span><b>2<\/b> programs by The Librarian<\/span>/,
    "and so must the count");
  assert.ok(!one.includes("The Forgery"), "the other writer's row is gone");
});

test("the header is the title and the All DJs pill, then one line: the count and where Play goes (the grid, 2026-09-23)", async () => {
  // The owner chose B from the shelf canvas: the "?" left the header for a
  // fold at the foot, the pill reads "All DJs" at rest, and the count
  // sentence is always there now — under the title, not beside the pill.
  const env = libEnv();
  await twoWriters(env);
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  const head = html.slice(html.indexOf('<header class="masthead shelfhead">'), html.indexOf("</header>"));
  const top = head.slice(head.indexOf('<div class="shtop pagehead">'), head.indexOf('<div class="shsub">'));
  assert.match(top, /^<div class="shtop pagehead"><h1>Shelf<\/h1><span class="shtools"><details class="filter">/, "the title, then the pill");
  // No number at rest: beside "All DJs" a count of programs would read as a
  // count of DJs.
  assert.match(top, /aria-label="Filter the shelf — all shown">All DJs<svg/);
  assert.ok(!head.includes("All writers"));
  assert.match(head, /<div class="shsub"><span><b>3<\/b> programs<\/span>/, "the count sentence, under it");
  // ONE HELP (MC-30 stage 4, 2026-09-28): the "?" is back in the header's
  // corner, after the pill, as on every tab; the fold at the foot went.
  assert.match(top, /<\/details><details class="help pagehelp" name="pagehead"><summary class="helpq" aria-label="How the Shelf works">/);
  assert.ok(!html.includes("shelfhelp"), "no fold at the foot");
});

test("with one writer there is no pill, so the count sentence stays", async () => {
  const html = renderLibrary([
    { id: "a", title: "A Survey", dj: "The Librarian", created: "2026-08-28",
      tracks: 9, runtime: "44:00", url: "https://x/programs/a" },
  ]);
  assert.ok(!/class="filter"/.test(html));
  assert.match(html, /<div class="shtop pagehead"><h1>Shelf<\/h1><span class="shtools"><details class="help pagehelp" name="pagehead">/, "the title and the ? alone on the top line");
  assert.match(html, /<div class="shsub"><span><b>1<\/b> program<\/span>/);
});

test("a program's page carries Play and Load on one line, and the delete at its foot asks first (the grid, 2026-09-23)", async () => {
  // The owner, 2026-09-12: Play and the put pill "can be next to each other".
  // Since the grid (B, 2026-09-23) that line is on the program's own page, not
  // a Shelf row, and the delete went to the foot of the page: the one
  // destructive thing sits as far from the one that gets pressed as it can.
  const env = libEnv();
  await env.PROGRAMS.put("program:a", JSON.stringify({ slug: "a", shape: "setlist", title: "A Survey",
    dj: "The Librarian", sections: [{ tracks: [{ uri: "spotify:track:aaa" }] }] }),
    { metadata: { title: "A Survey", dj: "The Librarian", catalog: "spotify", shape: "setlist",
      created: "2026-08-28", tracks: 9, runtime: "44:00" } });
  const shelf = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  assert.ok(!shelf.includes('class="put"') && !shelf.includes('class="del"'), "the card keeps only Play");
  assert.match(shelf, /form="play" name="slug" value="a" class="play"/);

  const page = await progPage(env, "a");
  const from = page.indexOf('<div class="act">');
  const act = page.slice(from, page.indexOf("</div>", from));
  assert.ok(from > page.indexOf('<section class="pacts"'), "in the page's controls");
  assert.ok(act.search(/class="play"/) > -1, "play");
  assert.ok(act.search(/class="put"/) > act.search(/class="play"/), "then put");
  assert.ok(!act.includes('class="del"'), "and not the delete");
  const del = page.slice(page.indexOf('<div class="pdel">'));
  assert.ok(page.indexOf('<div class="pdel">') > page.indexOf('<footer class="endmatter">'), "the delete is at the foot");
  // One tap opens the fold; only the button inside it, after the sentence
  // that says what goes, posts.
  assert.match(del, new RegExp(`^<div class="pdel">\\s*<details class="del"><summary>Delete this program…</summary><form class="off" method="post" action="/notes/${LIBKEY}/unkeep"><input type="hidden" name="slug" value="a"><span class="delwarn">Deletes this set for good[^<]*There is no undo\\.</span><button type="submit" class="gone" aria-label="Delete A Survey for good">Delete for good</button></form></details></div>`));
});

test("where Play goes is the line under the title, one form every card's Play names (the grid, 2026-09-23)", () => {
  // The owner, 2026-09-12: "we could move the play on ultra to the top line".
  // The grid (B) drew it as words under the title — "Play goes to the Pro
  // Plus ▾" — beside the count, with the same form and id the cards' Play
  // buttons name. What Play does is said in the help at the foot.
  const rows = [
    { id: "a", title: "A", dj: "Hank", catalog: "spotify", created: "2026-09-02", url: "https://x/programs/a" },
    { id: "b", title: "B", dj: "Monk", catalog: "tidal", created: "2026-09-01", url: "https://x/programs/b" },
  ];
  const html = renderLibrary(rows, { self: "/notes/k",
    play: { action: "/notes/k/play", devices: ["Pro Plus", "Ultra"], device: "Ultra" } });
  const sub = html.slice(html.indexOf('<div class="shsub">'), html.indexOf("</header>"));
  const count = sub.indexOf("<b>2</b> programs");
  const bar = sub.indexOf('<form method="post" action="/notes/k/play" id="play" class="playbar">');
  assert.ok(count > -1 && bar > count, "the count, then where Play goes");
  assert.match(sub, /<label for="playdev">Play goes to the<\/label>/);
  assert.match(sub, /<option>Pro Plus<\/option><option selected>Ultra<\/option>/);
  assert.ok(!html.includes("playnote"), "no sentence under it");
  assert.match(html, /<b>Play<\/b> starts a set on the speaker named at the top, and leaves\s+the presets as they are\./, "the help says what it does");
  assert.equal((html.match(/id="play"/g) ?? []).length, 1, "one form, which every card's Play names");
  assert.match(html, /form="play"/);
});

test("an unknown writer shows everything rather than an empty page", async () => {
  // The value arrives from a URL anyone can edit. A blank page reads as
  // "nothing published", which is a different and worse claim.
  const env = libEnv();
  await twoWriters(env);
  const html = await (await worker.fetch(
    get(`/notes/${LIBKEY}?dj=nobody-at-all`), env)).text();
  assert.equal(cards(html), 3);
});

test("the filter counts every row, never the filtered view", async () => {
  const env = libEnv();
  await twoWriters(env);
  const html = await (await worker.fetch(
    get(`/notes/${LIBKEY}?dj=the-professor`), env)).text();
  // Still 3 / 2 / 1 in the rail even though one row is displayed: a filter that
  // renumbers itself as you use it cannot tell you what you are not seeing.
  assert.match(html, /All<b class="n">3<\/b>/);
  assert.match(html, /The Librarian<b class="n">2<\/b>/);
  // And the one you are on is the filled pill, not a link back to itself.
  assert.match(html, /<span class="chip" aria-current="page">The Professor<b class="n">1<\/b><\/span>/);
});

test("one writer gets no filter at all", async () => {
  const env = libEnv();
  await env.PROGRAMS.put("program:one", JSON.stringify({ slug: "one" }), {
    metadata: { title: "One", dj: "The Professor", created: "2026-08-28" },
  });
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  assert.ok(!html.includes('class="eyebrow filter"'),
    "a filter offering one choice is furniture");
});

test("activating from a filtered view returns to it", async () => {
  const env = libEnv();
  await twoWriters(env);
  const html = await (await worker.fetch(
    get(`/notes/${LIBKEY}?dj=the-librarian`), env)).text();
  assert.match(html, /<input type="hidden" name="dj" value="the-librarian">/,
    "the Play form carries the filter it was pressed from (the grid, 2026-09-23: the only form left on the Shelf)");

  const res = await worker.fetch(
    post(`/notes/${LIBKEY}/activate`,
      new URLSearchParams({ slug: "nope", dj: "the-librarian" })), env);
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /^\/notes\/[^?]+\?put=[^&]+&dj=the-librarian$/);
});

test("a junk dj on the form never reaches the redirect", async () => {
  const env = libEnv();
  await twoWriters(env);
  const res = await worker.fetch(
    post(`/notes/${LIBKEY}/activate`,
      new URLSearchParams({ slug: "nope", dj: "../../evil?x=1" })), env);
  assert.equal(res.status, 303);
  assert.ok(!res.headers.get("location").includes("evil"));
});

// ------------------------------------------ Program Notes: one prefix

test("the Shelf is at /notes; the old /library prefix is gone (2026-10-18)", async () => {
  const env = libEnv();
  await twoWriters(env);
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  assert.match(html, /<h1>Shelf<\/h1>/);
  assert.ok(!/>Library</.test(html), "the word the rename was for is gone");
  assert.match(html, /action="\/notes\/[^"]+\/play"/);
  assert.equal((await worker.fetch(get(`/library/${LIBKEY}`), env)).status, 404);
});

test("the wrong key is a bare 404 on either prefix", async () => {
  const env = libEnv();
  for (const p of ["notes", "library"]) {
    const res = await worker.fetch(get(`/${p}/0000000000000000000000000`), env);
    assert.equal(res.status, 404, "the reply must not confirm the route exists");
  }
});

// ------------------------------------------------ Program Notes: the gist

test("the gist is the thesis's first sentence", () => {
  assert.equal(standfirst("Johnny Marr was never a lead guitarist. He was a rhythm player."),
    "Johnny Marr was never a lead guitarist.");
});

test("an abbreviation is not a sentence break", () => {
  // This catalogue is full of Dr., St. and No. Splitting on the full stop alone
  // would have made the gist for a Dr. Feelgood program read "Dr."
  assert.equal(standfirst("Dr. Feelgood changed everything. Then it did not."),
    "Dr. Feelgood changed everything.");
  assert.equal(standfirst("St. Louis is where it starts. Then Chicago."),
    "St. Louis is where it starts.");
});

test("a very long first sentence is cut on a word boundary", () => {
  // Not theoretical: the Belafonte program's thesis opens with 404 characters
  // and no break in them.
  const long = "Belafonte is remembered as a singer who happened to be political, " +
    "but his real function in the civil rights movement was financial engineer: " +
    "he built the era's biggest Black commercial fortune on a calypso record, " +
    "then spent three decades converting that fortune into bail money.";
  const out = standfirst(long);
  assert.ok(out.length <= 201, `got ${out.length}`);
  assert.ok(out.endsWith("…"), "an ellipsis promises the rest exists");
  assert.ok(!/\s…$/.test(out), "no space before the ellipsis");
  // Never mid-word: everything before the ellipsis is a prefix of the original.
  assert.ok(long.startsWith(out.slice(0, -1)));
});

test("a thesis with no sentence break is used whole", () => {
  assert.equal(standfirst("No break at all here"), "No break at all here");
});

test("a missing thesis is an empty gist, not the string undefined", () => {
  for (const v of ["", null, undefined, "   "]) assert.equal(standfirst(v), "");
});

test("the shelf's card carries no gist; the program's page keeps the thesis (the grid, 2026-09-23)", async () => {
  // The standfirst under a row's title went with the grid (B): a card is the
  // cover, the title and one line. The thesis is still the page's to say.
  const env = libEnv();
  await env.PROGRAMS.put("program:one",
    JSON.stringify({ slug: "one", thesis: "Berlin was a medical decision before it was an artistic one. The records followed." }),
    { metadata: { title: "He Went There to Disappear", dj: "The Professor", created: "2026-08-28" } });
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  const card = /<li class="card[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
  assert.ok(card.includes("He Went There to Disappear"), "the card rendered");
  assert.ok(!card.includes('class="standfirst"') && !card.includes("Berlin was"), "and carries no gist");
  assert.match(await progPage(env, "one"), /Berlin was a medical decision before it was an artistic one\./);
});

test("a program whose record cannot be read is still listed", async () => {
  // The gist is the nice-to-have; the row is not. Losing the whole program
  // from the shelf because one read failed is the worse outcome.
  const env = libEnv();
  await env.PROGRAMS.put("program:one", "{ not json",
    { metadata: { title: "Still Here", dj: "The Professor", created: "2026-08-28" } });
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  assert.match(html, /Still Here/);
  // Scoped to the card: a bare search of the document proves nothing.
  const row = /<li class="card[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
  assert.ok(row.includes("Still Here"), "the card rendered");
  assert.match(row, /<span class="cmeta">The Professor<\/span>/, "with its line, from the listing alone");
});

// ------------------------------------------------------ approval-card metadata

const { TOOLS, TOOL_META, toolsWithMeta } = __test;

// The full list is the list a house WITH an archive button sees; the two
// archive verbs drop out of a house without one, which the house suite covers.
const withArchive = makeEnv();
withArchive.BUTTONS = buttons({ 3: PID, 6: true });

test("every tool says what it does to the room", () => {
  // The guard that matters: a tool shipped without a classification inherits
  // the spec's defaults, and an omitted destructiveHint reads as TRUE. A new
  // read-only tool would arrive on the phone warning like a button rewrite.
  const missing = TOOLS.map((t) => t.name).filter((n) => !TOOL_META[n]);
  assert.deepEqual(missing, [], "these tools have no title or hints");
});

test("no tool claims to be both a read and a write", () => {
  for (const [name, [title, a]] of Object.entries(TOOL_META)) {
    assert.ok(title && title.length <= 40, `${name}: title missing or long`);
    for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof a[k], "boolean", `${name}.${k} must be stated, not defaulted`);
    }
    if (a.readOnlyHint) {
      assert.equal(a.destructiveHint, false, `${name} cannot read and destroy`);
    }
  }
});

test("the destructive set is exactly the tools that overwrite something", () => {
  // Pinned so that widening it is a decision somebody made on purpose. Each of
  // these replaces or deletes something a person would miss; everything else
  // either reads, adds, or only changes what is audible right now.
  const destructive = Object.entries(TOOL_META)
    .filter(([, [, a]]) => a.destructiveHint).map(([n]) => n).sort();
  assert.deepEqual(destructive, [
    "activate_program",
    // Added with MC-22 stage 3 and MC-23: a fresh set replaces an endless
    // DJ's list (after a backup), and a steer replaces what is queued after
    // the playing song. Neither touches what has played.
    "extend_endless",
    "fulfill_request",
    "play_archive",
    // Added with MC-27 (2026-09-25): taking over the endless lane replaces
    // what it held, after a backup, and starts music.
    "play_endless",
    "replace_playlist",
    "restore_playlist",
    // Added 2026-09-07: it overwrites a published record and, on air, the
    // playlist a button dereferences. Both have an undo.
    "revise_program",
    "steer_endless",
    "unpublish_program",
  ]);
});

test("activate_program is not idempotent, and that is deliberate", () => {
  // A second call backs up the set the first one just wrote, burying the
  // original. A client told this is repeat-safe could retry into exactly that.
  assert.equal(TOOL_META.activate_program[1].idempotentHint, false);
});

test("tools/list carries the title in both places a client might look", async () => {
  const listed = toolsWithMeta(withArchive);
  assert.equal(listed.length, TOOLS.length - 1, "all but Last.fm's verb, in a house with no key (2026-10-18)");
  assert.equal(toolsWithMeta({ ...withArchive, LASTFM_KEY: "c0ffeec0ffeec0ffeec0ffeec0ffee00" }).length, TOOLS.length);
  const one = listed.find((t) => t.name === "replace_playlist");
  assert.equal(one.title, "Replace What a Button Plays");
  assert.equal(one.annotations.title, "Replace What a Button Plays");
  assert.equal(one.annotations.destructiveHint, true);
  // The definition itself is untouched — the merge must not mutate TOOLS.
  assert.ok(!("title" in TOOLS.find((t) => t.name === "replace_playlist")));
});

// ------------------------------------ citations, numbering, and the undo form

const prog = (sections, sources) => ({
  title: "t", thesis: "t", dj: "The Professor", created: "2026-08-29T00:00:00Z",
  tracks: 0, runtime: "0:00", playlistName: "p", sections, sources,
});

test("a source cited twice is anchored once", () => {
  // Two elements with the same id is invalid HTML, and the back-link would
  // land on whichever the browser felt like. First mention wins.
  const html = renderProgram(prog(
    [{ heading: "h", prose: [para("first", ["s1"]), para("again", ["s1"])], tracks: [] }],
    [{ id: "s1", title: "One" }]));
  assert.equal((html.match(/id="cite-1"/g) ?? []).length, 1);
  assert.equal((html.match(/href="#source-1"/g) ?? []).length, 2, "both marks still link");
});

test("a cited source gets a way back and an uncited one does not", () => {
  const html = renderProgram(prog(
    [{ heading: "h", prose: [para("claim", ["s1"])], tracks: [] }],
    [{ id: "s1", title: "Cited" }, { id: "s2", title: "Never cited" }]));
  assert.match(html, /<li id="source-1">/);
  assert.match(html, /href="#cite-1"[^>]*>↩<\/a>/);
  // Source 2 exists, is listed, and has nowhere to return to.
  assert.match(html, /<li id="source-2">/);
  assert.ok(!html.includes('href="#cite-2"'), "an uncited source has no back-link");
});

test("track numbers run across the whole program, not per section", () => {
  const t = (uri) => ({ uri, artist: "A", title: "T", year: "1970" });
  const html = renderProgram(prog([
    { heading: "one", prose: [], tracks: [t("spotify:track:" + "a".repeat(22)),
                                         t("spotify:track:" + "b".repeat(22))] },
    { heading: "two", prose: [], tracks: [t("spotify:track:" + "c".repeat(22)),
                                         t("spotify:track:" + "d".repeat(22)),
                                         t("spotify:track:" + "e".repeat(22))] },
    { heading: "three", prose: [], tracks: [t("spotify:track:" + "f".repeat(22))] },
  ], []));
  const ns = [...html.matchAll(/<span class="n">(\d+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(ns, ["01", "02", "03", "04", "05", "06"],
    "the third record you hear must not display as 01");
});

test("a section with no tracks does not consume a number", () => {
  const t = (uri) => ({ uri, artist: "A", title: "T" });
  const html = renderProgram(prog([
    { heading: "prologue", prose: [], tracks: [] },
    { heading: "one", prose: [], tracks: [t("spotify:track:" + "a".repeat(22))] },
  ], []));
  assert.deepEqual([...html.matchAll(/<span class="n">(\d+)<\/span>/g)].map((m) => m[1]), ["01"]);
});

test("the shelf offers an undo after a load, and only then", () => {
  const rows = [{ id: "one", title: "One", dj: "The Professor", created: "2026-08-29" }];
  const key = `snap:${"a".repeat(22)}:000000000000001-000001-abc`;
  const withUndo = renderLibrary(rows, {
    flash: "done", action: "/notes/k/activate",
    undo: { key, action: "/notes/k/undo" },
  });
  assert.match(withUndo, /<form method="post" action="\/notes\/k\/undo">/);
  assert.match(withUndo, new RegExp(`value="${key}"`));
  assert.match(withUndo, /Undo — put the previous set back/);

  const plain = renderLibrary(rows, { flash: "done", action: "/notes/k/activate" });
  assert.ok(!plain.includes("/undo"), "no undo offered when there is nothing to undo");
});

test("undo refuses a snapshot for a playlist this page does not write to", async () => {
  // The key arrives in a form field. Shape alone is not enough: it names the
  // playlist it would be written into, and that has to be one we configure.
  const env = libEnv();
  const stranger = `snap:${"z".repeat(22)}:000000000000001-000001-abc`;
  const res = await worker.fetch(
    post(`/notes/${LIBKEY}/undo`, new URLSearchParams({ snapshot: stranger })), env);
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /put=undofail/);
});

test("undo refuses junk and a GET", async () => {
  const env = libEnv();
  const bad = await worker.fetch(
    post(`/notes/${LIBKEY}/undo`, new URLSearchParams({ snapshot: "../../etc/passwd" })), env);
  assert.equal(bad.status, 303);
  assert.match(bad.headers.get("location"), /put=undofail/);

  const get_ = await worker.fetch(get(`/notes/${LIBKEY}/undo`), env);
  assert.equal(get_.status, 405, "a prefetcher must not be able to roll a button back");
});

test("a wrong key cannot reach undo at all", async () => {
  const env = libEnv();
  const res = await worker.fetch(
    post(`/notes/0000000000000000000000000/undo`, new URLSearchParams({ snapshot: "x" })), env);
  assert.equal(res.status, 404);
});

test("a setlist renders as its tracks — no empty heading, no empty column", () => {
  const html = renderProgram({
    title: "The Annual Party", thesis: "Loud, and it never sits down.",
    dj: "Hank", shape: "setlist", created: "2026-09-01T00:00:00Z",
    tracks: 2, runtime: "6:40", playlistName: "Hank", loaded: true,
    sections: [{ label: null, years: null, heading: null, prose: [], tracks: [
      { uri: "spotify:track:a", title: "One", artist: "Someone", duration: "3:20" },
      { uri: "spotify:track:b", title: "Two", artist: "Another", duration: "3:20" },
    ] }],
    complications: [], coda: [], sources: [], notes: [],
  });

  assert.match(html, /<span>Setlist<\/span>/, "the eyebrow names the kind");
  assert.match(html, /Loud, and it never sits down\./);
  assert.match(html, /One/);
  assert.match(html, /Two/);

  // The failure this shape exists to avoid: an essay's furniture rendered
  // empty around a list, which reads as a page that broke.
  assert.ok(!html.includes("<h2></h2>"), "no blank heading");
  assert.ok(!html.includes(`<div class="prose">\n</div>`), "no empty prose column");
  // The markup, not the stylesheet — `.mvt-head` is a CSS rule on every page.
  assert.ok(!html.includes(`<div class="mvt-head">`),
    "no movement head at all on a bare section");
  assert.ok(!html.includes("Where this could be wrong"));
  assert.ok(!html.includes("What was left out"),
    "a setlist's own complications label never renders — it has none");
});

test("the shelf names no kind at all — not the setlists, not the essays", () => {
  // It used to badge a setlist and stay quiet about the essays, because the
  // essay was the usual thing and only the exception earned a word. Requests
  // inverted that: most of the shelf is kept sets now, so the badge had become
  // the furniture on every row it existed to avoid (the owner, 2026-09-07).
  const rows = [
    { id: "a-1", title: "The Annual Party", dj: "Hank", shape: "setlist", catalog: "spotify",
      created: "2026-09-01", tracks: 12, runtime: "48:00", url: "https://x/programs/a-1" },
    { id: "b-2", title: "An Argument", dj: "The Professor", shape: "argument",
      created: "2026-08-30", tracks: 10, runtime: "40:00", url: "https://x/programs/b-2" },
  ];
  const html = renderLibrary(rows, {});
  assert.ok(!html.includes(">Setlist<"), "no kind badge on a kept set");
  assert.ok(!html.includes(">Program<"), "and none on an essay either");
  // What the card DOES carry since the grid (2026-09-23): who made it and how
  // long it runs. The date, the track count and the service word went.
  const party = html.slice(html.indexOf("The Annual Party"), html.indexOf("An Argument"));
  assert.match(party, /<span class="cmeta">Hank · 48m<\/span>/, "hours and minutes, no seconds");
  assert.ok(!party.includes("2026-09-01"), "no date");
  assert.ok(!party.includes("12 tracks"), "no track count");
  assert.ok(!party.includes(">Spotify<"), "no service word");
});

test("every program's page offers the delete, as a fold that asks first; the Shelf offers none (the grid, 2026-09-23)", () => {
  const rows = [
    { id: "a-1", title: "The Annual Party", dj: "Hank", shape: "setlist",
      created: "2026-09-01", tracks: 12, runtime: "48:00", url: "https://x/programs/a-1" },
    { id: "b-2", title: "An Argument", dj: "The Professor", shape: "argument",
      created: "2026-08-30", tracks: 10, runtime: "40:00", url: "https://x/programs/b-2" },
  ];
  const html = renderLibrary(rows, {
    action: "/notes/k/activate", remove: { action: "/notes/k/unkeep" }, self: "/notes/k" });
  assert.ok(!html.includes("unkeep"), "Delete left the Shelf for the program's page");
  assert.ok(!html.includes('class="del"'));
  assert.ok(!html.includes("Take off the shelf"));
  assert.match(html, /<b>Tap a cover<\/b> for its page:[\s\S]*?<b>Delete<\/b>/, "and the help says where it went");

  // A delete for every program, written ones too (2026-09-13). The fold's
  // summary cannot delete; the warning is inside it, before the one button
  // that posts.
  const remove = { action: "/notes/k/unkeep" };
  const party = shelfControls(rows[0], { remove }).removeForm;
  assert.match(party, /<details class="del"><summary aria-label="More for The Annual Party: delete">[\s\S]*?<\/summary><form class="off" method="post" action="\/notes\/k\/unkeep">/);
  assert.ok(party.indexOf("There is no undo.") > -1 &&
    party.indexOf("There is no undo.") < party.indexOf('class="gone"'), "the warning before the button");
  assert.match(party, /Deletes this set for good: its page and link stop working/);
  assert.match(shelfControls(rows[1], { remove }).removeForm,
    /Deletes this program for good: its writing, its page and its link stop working/,
    "a written program's fold says its writing goes with it");
});

test("a running time is hours and minutes, never seconds", () => {
  // The owner, 2026-09-12: "we do not need seconds".
  assert.equal(shortRuntime("42:18"), "42m");
  assert.equal(shortRuntime("9:00"), "9m");
  assert.equal(shortRuntime("40:30"), "41m", "rounded to the nearest minute");
  assert.equal(shortRuntime("1:00:56"), "1h 1m");
  assert.equal(shortRuntime("3:53:05"), "3h 53m");
  assert.equal(shortRuntime("2:00:10"), "2h");
  assert.equal(shortRuntime("72:10"), "1h 12m");
  assert.equal(shortRuntime("0:20"), "1m", "a set is never 0m");
  assert.equal(shortRuntime("12 tracks"), "12 tracks", "not a clock: passed through");
  assert.equal(shortRuntime(""), "");
  assert.equal(shortRuntime(undefined), "");
});

test("no delete offered when the page was not given one", () => {
  const row = { id: "a-1", title: "Kept", dj: "Hank", shape: "setlist",
    created: "2026-09-01", tracks: 2, runtime: "6:40", url: "https://x/programs/a-1" };
  assert.equal(shelfControls(row, { action: "/notes/k/activate" }).removeForm, "");
  // The public program page has no controls at all.
  const pub = renderProgram({ slug: "a-1", title: "Kept", dj: "Hank", shape: "setlist", sections: [] });
  assert.ok(!pub.includes("unkeep"));
  assert.ok(!pub.includes('class="pdel"'), "no fold");
});

test("the header's rows are divs, because a paragraph cannot hold the filter fold", async () => {
  // A <p> may not contain a <details>: the parser closes the paragraph, hoists
  // the details out to the header and leaves an empty <p> behind. Measured in
  // the DOM when the ? sat in the facts row; since the grid (2026-09-23) the
  // fold in the header is the DJ filter, and the same rule holds for it.
  const env = libEnv();
  await twoWriters(env);
  const html = await (await worker.fetch(get(`/notes/${LIBKEY}`), env)).text();
  const open = html.indexOf('<div class="shtop pagehead">');
  assert.ok(open > 0, "a div, never a p");
  assert.ok(!/<p class="(?:facts|shtop|shsub)">/.test(html));
  const close = html.indexOf('<div class="shsub">');
  assert.ok(html.slice(open, close).includes('<details class="filter">'), "with the filter fold inside it");
  assert.ok(html.indexOf("</header>") > close, "and both inside the masthead");
});

test("the Shelf filters by service too, only when it holds more than one, and the two filters combine (2026-09-23)", () => {
  const row = (id, dj, catalog) => ({ id, title: id, dj, catalog, created: "2026-09-01", tracks: 3, runtime: "10:00",
    url: `https://x/programs/${id}` });
  const mixed = [row("a", "Hank", "spotify"), row("b", "Hank", "tidal"), row("c", "Monk", "tidal"), row("d", "Archive", "files")];
  const cards = (h) => (h.match(/<li class="card/g) ?? []).length;
  const all = renderLibrary(mixed, { self: "/notes/k" });
  assert.match(all, /<span class="flabel">Service<\/span><span class="chip" aria-current="page">All<b class="n">4<\/b><\/span><a class="chip" href="\/notes\/k\?svc=spotify">Spotify<b class="n">1<\/b><\/a><a class="chip" href="\/notes\/k\?svc=tidal">Tidal<b class="n">2<\/b><\/a><a class="chip" href="\/notes\/k\?svc=files">Archive<b class="n">1<\/b><\/a>/);
  const tidal = renderLibrary(mixed, { self: "/notes/k", svc: "tidal" });
  assert.equal(cards(tidal), 2);
  assert.match(tidal, /<summary class="chip cur" aria-label="Filter the shelf — Tidal shown">Tidal<b class="n">2<\/b>/);
  assert.match(tidal, /<b>2<\/b> programs on Tidal<\/span>/);
  assert.match(tidal, /href="\/notes\/k\?dj=hank&amp;svc=tidal">Hank/, "a DJ chosen keeps the service");
  const both = renderLibrary(mixed, { self: "/notes/k", svc: "tidal", dj: "hank" });
  assert.equal(cards(both), 1);
  assert.match(both, /aria-label="Filter the shelf — Tidal · Hank shown">Tidal · Hank<b class="n">1<\/b>/);
  // One service in the house: no Service row at all, and ?svc is ignored.
  const one = [row("a", "Hank", "spotify"), row("b", "Monk", "spotify")];
  const plain = renderLibrary(one, { self: "/notes/k", svc: "tidal" });
  assert.ok(!plain.includes('class="flabel"'));
  assert.equal(cards(plain), 2);
});

test("each filter row counts within the other, and hides what would show nothing (Codex, 2026-09-24)", () => {
  const row = (id, dj, catalog) => ({ id, title: id, dj, catalog, created: "2026-09-01", tracks: 3, runtime: "10:00",
    url: `https://x/programs/${id}` });
  const mixed = [row("a", "Hank", "spotify"), row("b", "Hank", "tidal"), row("c", "Monk", "tidal"), row("d", "Archive", "files")];
  const spotify = renderLibrary(mixed, { self: "/notes/k", svc: "spotify" });
  assert.ok(!/>Monk<b/.test(spotify), "Monk has nothing on Spotify, so no chip");
  assert.match(spotify, /Hank<b class="n">1<\/b>/, "Hank counts his Spotify program only");
  assert.match(spotify, /<span class="flabel">DJs<\/span><span class="chip" aria-current="page">All<b class="n">1<\/b>/);
  const monk = renderLibrary(mixed, { self: "/notes/k", dj: "monk" });
  assert.ok(!/svc=spotify">Spotify/.test(monk), "Monk has no Spotify programs, so no Spotify chip");
  // An impossible pair typed into the address says so plainly.
  const none = renderLibrary(mixed, { self: "/notes/k", svc: "spotify", dj: "monk" });
  assert.match(none, /Nothing by Monk on Spotify on the shelf yet\./);
});

// THE SHELF'S FILTER, CARRIED (the owner, 2026-09-24): Load on a program's
// page, opened from the Shelf filtered to one DJ, landed on the whole Shelf.
test("a program opened from a filtered Shelf keeps the filter: its back link, Load, Play and Delete return there", async () => {
  const env = libEnv();
  const put = (slug, dj) => env.PROGRAMS.put(`program:${slug}`, JSON.stringify({ slug, shape: "setlist", title: `Set ${slug}`,
    dj, sections: [{ tracks: [{ uri: "spotify:track:aaa" }] }] }),
    { metadata: { title: `Set ${slug}`, dj, catalog: "spotify", shape: "setlist", created: "2026-08-28", tracks: 9, runtime: "44:00" } });
  await put("a", "The Librarian"); await put("b", "The Professor");
  const shelf = await (await worker.fetch(get(`/notes/${LIBKEY}?dj=the-librarian`), env)).text();
  assert.match(shelf, new RegExp(`<a class="coverlink" href="/buttons/${LIBKEY}/programs/a\\?dj=the-librarian"`));
  const page = await (await worker.fetch(get(`/buttons/${LIBKEY}/programs/a?dj=the-librarian`), env)).text();
  assert.match(page, new RegExp(`<a class="shellback" href="/notes/${LIBKEY}\\?dj=the-librarian">‹ Shelf</a>`));
  const forms = page.match(/<form[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const keep = '<input type="hidden" name="dj" value="the-librarian">';
  assert.ok(forms.find((x) => x.includes("/activate"))?.includes(keep), "Load carries it");
  assert.ok(forms.find((x) => x.includes("/unkeep"))?.includes(keep), "Delete carries it");
  assert.ok(forms.find((x) => x.includes('id="play"'))?.includes(keep), "Play carries it");
  // Unfiltered, nothing extra; junk is dropped, not echoed.
  const plain = await (await worker.fetch(get(`/buttons/${LIBKEY}/programs/a`), env)).text();
  assert.match(plain, new RegExp(`<a class="shellback" href="/notes/${LIBKEY}">‹ Shelf</a>`));
  assert.ok(!plain.includes(keep));
  const junk = await (await worker.fetch(get(`/buttons/${LIBKEY}/programs/a?dj=%3Cx%3E&svc=nope`), env)).text();
  assert.match(junk, new RegExp(`<a class="shellback" href="/notes/${LIBKEY}">‹ Shelf</a>`));
  // Load and Delete land on the filtered Shelf, the service kept too.
  const post = (path, body) => worker.fetch(new Request(`https://x/notes/${LIBKEY}/${path}`, { method: "POST", body: new URLSearchParams(body) }), env);
  const r = await post("activate", { slug: "a", dj: "the-librarian", svc: "spotify" });
  assert.match(r.headers.get("location"), /&dj=the-librarian&svc=spotify/);
  const d = await post("unkeep", { slug: "b", dj: "the-librarian" });
  assert.match(d.headers.get("location"), /&dj=the-librarian$/);
});
