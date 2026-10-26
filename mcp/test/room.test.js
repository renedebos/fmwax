// The buttons page: the grid, a DJ's page, and the play POST. The properties
// under test are the ones the design review said the page must not lose — the
// key stays a bare 404, the form cannot name an arbitrary device, a GET never
// mutates, the captions do not overclaim, and the tile cache keeps a warm
// render off Spotify.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { PERSONAS, ROSTER } from "../djs.js";
import { renderProgram, renderDjRoom, waitWords } from "../programs.js";
import { makeEnv, installFetch, installTidalFetch, track, buttons, HOUSE, TPID, putTile, getTile } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const { callTool } = __test;

const KEY = "abcdefabcdefabcdefabcdef";
// 22 alphanumerics each, one per configured button.
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;

function env() {
  const e = makeEnv();
  e.PLAYLIST_ALIASES = JSON.stringify({ replay: P(9) });
  e.BUTTONS = buttons({
    1: P(1), 2: P(2), 3: P(3), 4: P(4), 5: P(5), 6: true, 7: P(7), 8: P(8),
    9: P(19), 10: P(20), 11: P(21),
  });
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Everywhere", "Master Bedroom"]);
  return e;
}

const get = (path) => new Request(`https://x.test${path}`);
const post = (path, body, headers = {}) => new Request(`https://x.test${path}`, {
  method: "POST", body, headers,
});
const form = (obj) => {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
};

// A seeded program: the KV record plus the listing metadata, the way a
// writer's make_*_program leaves them. The Librarian's since the Professor,
// whose they were, was cut (2026-10-15).
async function seedProgram(e, slug, { dj = "The Librarian", created = "2026-08-28T10:00:00Z",
  title = "A Program", thesis = "The premise sentence. And a second one." } = {}) {
  await e.PROGRAMS.put(`program:${slug}`, JSON.stringify({
    slug, title, thesis, dj, created, playlistId: P(3), sections: [],
  }), { metadata: { title, dj, created, tracks: 12, runtime: "40:00" } });
}

// ------------------------------------------------------------------ the key

test("a wrong key is a bare 404 on all three routes", async () => {
  const e = env();
  const f = installFetch();
  try {
    for (const path of [`/buttons/wrongwrongwrong1`, `/buttons/wrongwrongwrong1/hank`]) {
      const res = await worker.fetch(get(path), e);
      assert.equal(res.status, 404);
      assert.equal(await res.text(), "not found");
    }
    const res = await worker.fetch(post(`/buttons/wrongwrongwrong1/hank/play`, form({})), e);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "not found");
    // And nothing above touched Spotify.
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

// ------------------------------------------------------------------ the grid

test("the grid lists all ten DJs and the archive, in button order", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa"), track("bbb")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    for (const name of ["Dr. Funkenstein", "Hank", "The Librarian", "Vibe",
      "Soul", "Genre", "Deep Dive",
      "Pub Rock", "Gatefold"]) {
      assert.ok(html.includes(name), `missing ${name}`);
    }
    // THE ARCHIVE IS NOT ON THIS WALL since 2026-09-22 (the owner). Its band
    // was the twelve's echo of the speakers' reading, which the Speakers page
    // already shows and plays; its door survives on the DJs tab.
    assert.ok(!html.includes(ARCHIVE.name), "the archive is the Speakers tab's, not this one's");
    // Button order, not registry order, for every preset a page can start;
    // the archive, which only the remote starts, sits under the line after
    // them since MC-18 stage 4. Pub Rock and Gatefold follow Deep Dive on 9
    // and 10 (the three added 2026-08-29 sat there until the owner cut them,
    // 2026-10-13; Pub Rock took KRS-One's seat when he merged into Hip Hop the
    // same day, and Gatefold Chanson's when Chanson was cut). Since the cut
    // of 2026-10-15 the Librarian is on 3, Genre on 7 and Deep Dive on 8, and
    // 11, Hip Hop's, is empty.
    assert.ok(html.indexOf("The Librarian") < html.indexOf("Vibe"));
    assert.ok(html.indexOf(">Soul<") < html.indexOf(">Genre<"));
    assert.ok(!html.includes("Started from the remote"), "and no line under the wall at all");
    assert.ok(html.indexOf(">Deep Dive<") < html.indexOf(">Pub Rock<"));
    assert.ok(html.indexOf(">Pub Rock<") < html.indexOf(">Gatefold<"));
    // In the <meta description> now, for a tab and a link preview. It used to
    // be a standfirst as well, and the assertion silently moved with it —
    // "the grid leads with the buttons" below is what pins the removal.
    assert.ok(html.includes(`content="The programs on the presets: whose set is on each, and since when."`));
    // The archive is not playable from here, and since 2026-09-22 it is not
    // HERE: no band, no line over it, no door.
    assert.ok(!html.includes(`/buttons/${KEY}/archive`));
    // Program Replay is aliased but has no preset and no card.
    assert.ok(!html.includes("replay"));
    // The one-line summary is back under each name (2026-09-05): it is the
    // most useful sentence on the page for anyone choosing, and the grid
    // had no line saying what a DJ is. The full brief stays on the DJ page.
    // The Professor's "Programs by argument." stood here until he was cut
    // (2026-10-15); the Librarian's line is on his 3 now.
    assert.match(html, /<span class="bsum">Draws a fence around a subject/);
    assert.match(html, /<span class="bsum">Deep 60s\/70s funk/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(res.headers.get("content-security-policy").includes("spotifycdn.com"));
  } finally { f.restore(); }
});

test("a warm tile cache keeps the grid to one external call", async () => {
  const e = env();
  const t = { name: "X", count: 3, runtime: "10:00", cover: null, at: Date.now() };
  for (const n of [1, 2, 3, 4, 5, 7, 8, 19, 20, 21]) {
    await putTile(e, P(n), t);
  }
  const f = installFetch();
  try {
    await worker.fetch(get(`/buttons/${KEY}`), e);
    const spotifyCalls = f.calls.filter((c) => !c.includes("token"));
    assert.deepEqual(spotifyCalls, ["GET /me/player"]);
  } finally { f.restore(); }
});

test("a cold grid reads each playlist and caches the tile", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.ok(f.calls.filter((c) => c.startsWith("GET /playlists/")).length >= 7);
    const cached = await getTile(e, P(1));
    assert.equal(cached.count, 1);
    assert.ok(cached.at > 0);
  } finally { f.restore(); }
});

test("a tile past its ten minutes is served as it is, and re-read after the page has gone out", async () => {
  // The owner, 2026-09-12: "startup is quite slow for the preset page". A
  // cold wall re-read every playlist in front of the page. Now the grid
  // answers from the day-old cache at once and refreshes behind the
  // response (ctx.waitUntil); the next load is fresh.
  const e = env();
  const old = { name: "Old Name", count: 3, runtime: "10:00", cover: null, at: Date.now() - 11 * 60 * 1000 };
  for (const n of [1, 2, 3, 4, 5, 7, 8, 19, 20, 21]) await putTile(e, P(n), old);
  const f = installFetch({ contents: [track("aaa")] });
  // Spotify made slow for playlist reads: the page must not wait on them.
  const fakeFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/playlists/")) await new Promise((r) => setTimeout(r, 600));
    return fakeFetch(url, init);
  };
  const waits = [];
  try {
    const t0 = Date.now();
    const res = await worker.fetch(get(`/buttons/${KEY}`), e, { waitUntil: (p) => waits.push(p) });
    const took = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.ok(took < 400, `the page went out on the cache alone, in ${took} ms, not behind eleven slow reads`);
    assert.ok(waits.length >= 1, "a refresh was handed to the runtime");
    await Promise.all(waits);
    assert.ok(f.calls.filter((c) => c.startsWith("GET /playlists/")).length >= 7, "then every stale tile was re-read");
    const cached = await getTile(e, P(1));
    assert.equal(cached.count, 1, "and written fresh");
    assert.ok(Date.now() - cached.at < 5000);
  } finally { globalThis.fetch = fakeFetch; f.restore(); }
  // Without a request context the refresh runs inline, and a tile older
  // than a day is not served at all: it is read in front of the page.
  const e2 = env();
  const ancient = { ...old, at: Date.now() - 25 * 60 * 60 * 1000 };
  for (const n of [1, 2, 3, 4, 5, 7, 8, 19, 20, 21]) await putTile(e2, P(n), ancient);
  const f2 = installFetch({ contents: [track("aaa")] });
  try {
    await worker.fetch(get(`/buttons/${KEY}`), e2);
    assert.ok(f2.calls.filter((c) => c.startsWith("GET /playlists/")).length >= 7);
  } finally { f2.restore(); }
});

test("the quiet line claims the account, never the room", async () => {
  const e = env();
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    // Since 2026-09-05 a quiet account gets no sentence at all — the playing
    // band is where "playing" is said, and its absence is quiet. What must
    // never appear is a claim about the ROOM, which this server cannot see.
    assert.ok(!html.includes("Spotify is quiet"), "no line for quiet");
    assert.ok(!html.includes('class="band playing"'));
    assert.ok(!html.includes("The room is quiet"));
    assert.ok(!html.includes("other sources on the speaker"),
      "the implication does not need spelling out above the fold every time");
    // But the fact it carried is real — press 6 and the archive plays where
    // /me/player cannot see it — so it has to still be somewhere. It is in
    // the footer, with the page's other mechanics, read once.
    // A fragment that cannot straddle the source's own line wrap.
    assert.match(html, /is what Spotify says is playing/);
    assert.match(html, /whatever is plugged in — this page cannot see it/);
  } finally { f.restore(); }
});

test("a playing playlist marks its own card and names the device", async () => {
  const e = env();
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({
        is_playing: true,
        item: { name: "Peace Piece", uri: "spotify:track:pp", type: "track",
          duration_ms: 404000, artists: [{ name: "Bill Evans" }], album: { name: "A" } },
        progress_ms: 1000,
        device: { name: "Pro Plus" },
        context: { uri: `spotify:playlist:${P(5)}` },
      }), { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes("SPOTIFY PLAYING"), "the line over the wall is gone; the band says it");
    assert.ok(html.includes("Peace Piece"), "on the playing band's scrolling line");
    assert.ok(html.includes("Soul")); // P(5) is button 5
    assert.ok(html.includes('class="band playing"'));
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("a card counts nothing and dates nothing", async () => {
  // The last of the figures to go. The date went first (four more words of
  // mono at the width of a 131px column), then the button number and track
  // count, and now the program tally — a number you look up rather than
  // scan for, and one the DJ page's own shelf heading already carries. What
  // the tally was really earning was the marker beside it, and that stayed.
  const e = env();
  await seedProgram(e, "one-aaa111", { created: "2026-08-28T10:00:00Z" });
  await seedProgram(e, "two-bbb222", { created: "2026-08-29T10:00:00Z", title: "B" });
  // A track on every button — the card offers Play only when there is something to play.
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes("2 programs"));
    assert.ok(!html.includes("newest 2026-08-29"));
    assert.ok(!html.includes("cprogs"), "the span and its CSS both go");
    // What a card is for still stands: which DJ, where a press lands.
    assert.ok(html.includes("The Librarian"));
    assert.match(html, /aria-label="Play The Librarian on Pro Plus"/);
  } finally { f.restore(); }
});

test("the band's number is its key, and the count stays off the wall", async () => {
  // The button number came off the card in August as the least trustworthy
  // thing the page printed, and came back on 2026-09-05 as the band's black
  // key: the remote has twelve numbered buttons and the wall's first job is
  // to answer which one. It is still config, and the footer still says so.
  // Track count and runtime stay on the DJ page's facts line.
  const e = env();
  const f = installFetch({ contents: [track("aaa"), track("bbb")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    // The wall's span and its CSS both went; the name is the Shelf's card
    // line since the grid (2026-09-23), and the DJ page's grid's since board
    // A (2026-09-25) — each rule scoped to its own page.
    assert.ok(!html.includes('class="cmeta"'), "no span on the wall");
    assert.ok([...html.matchAll(/[^}]*cmeta[^{]*\{/g)].every((m) =>
      m[0].includes(".notes .card .cmeta") || m[0].includes(".djpage .djgrid .cmeta")),
      "and no wall rule for one");
    assert.match(html, new RegExp(`<a class="bnum" href="/buttons/${KEY}/the-librarian" tabindex="-1" aria-hidden="true">3</a>`), "the number is part of the row, not a door to the picker");
    assert.ok(!html.includes("2 tracks"), "no count on the wall");
    // The line that used to carry the archive's band and the rest of the
    // twelve is gone (2026-09-22): this tab is the guests.
    assert.ok(!html.includes("Started from the remote — press the number"));
    // And the line answering "where does it play" stays, for a screen reader.
    assert.match(html, /aria-label="Play [^"]+ on Pro Plus"/);
  } finally { f.restore(); }
});

const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();

test("a recently loaded program marks the count instead of taking a line", async () => {
  // The title line said the same thing on the day a set landed and six months
  // later. The marker expires, so it is worth the eye it catches — and what is
  // actually loaded is one tap away on the DJ page, which still names it.
  const e = env();
  await seedProgram(e, "prog-ccc333", { title: "The Loaded One", created: hoursAgo(3) });
  await e.PROGRAMS.put(`current:${P(3)}`, "prog-ccc333");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(html.includes(`<span class="cflag">new</span>`));
    assert.ok(!html.includes("last loaded:"), "the line it replaces is gone");
    assert.ok(!html.includes("The Loaded One"), "and so is the title, on this page");
    // The flag lives INSIDE the link, and an aria-label replaces a link's
    // contents — so a screen reader meets the mark only if the label says it.
    assert.match(html,
      /aria-label="Open The Librarian, preset 3 — a new set is on this preset"/);
  } finally { f.restore(); }
});

// THE WINDOW IS A DAY, cut from seven on 2026-09-09. Seven days was reasoned
// from how long a person takes to hear a set and ignored how often this house
// cuts them — most days, across a dozen DJs — so nearly every band wore the
// flag at once and the owner had a wall of red. Pinned at both edges here,
// because the number is now a decision and a drift back to a week would put
// the wall of red back with every test still passing.
test("the new flag lasts a day, not a week", async () => {
  const e = env();
  await seedProgram(e, "prog-ggg777", { title: "Yesterday's", created: hoursAgo(25) });
  await e.PROGRAMS.put(`current:${P(3)}`, "prog-ggg777");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes('<span class="cflag">'),
      "a set from twenty-five hours ago is not new; at a week it would be");
  } finally { f.restore(); }
});

test("a program past the window is not new any more", async () => {
  // The property that makes the badge worth showing: it can be false. A marker
  // that is true whenever a program is loaded is on every card forever.
  const e = env();
  await seedProgram(e, "prog-ddd444", { title: "The Old One", created: daysAgo(30) });
  await e.PROGRAMS.put(`current:${P(3)}`, "prog-ddd444");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(html.includes("The Librarian"), "the card still stands");
    assert.ok(!html.includes('<span class="cflag">'), "and wears no flag");
  } finally { f.restore(); }
});

test("a recent program that is not ON the button does not mark it", async () => {
  // The marker means "the set on this button is new", not "this writer has
  // published lately" — otherwise it sends you to press a button that plays
  // something else. No `current:` pointer, so nothing is loaded.
  const e = env();
  await seedProgram(e, "prog-eee555", { title: "Published Not Loaded", created: daysAgo(1) });
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(html.includes("The Librarian"), "the card still stands");
    assert.ok(!html.includes('<span class="cflag">'), "and wears no flag");
  } finally { f.restore(); }
});

test("a program with an unreadable date is not new", async () => {
  const e = env();
  await seedProgram(e, "prog-fff666", { title: "No Date", created: "not a date" });
  await e.PROGRAMS.put(`current:${P(3)}`, "prog-fff666");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes("(new!)"), "absent beats wrong");
  } finally { f.restore(); }
});

// ------------------------------------------------------------------ a DJ page

test("a DJ page shows the tracklist and refreshes the tile cache", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa", "Opening Cut", "Someone"),
    track("bbb", "Second Cut", "Someone Else")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Hank"));
    assert.ok(html.includes("Opening Cut"));
    assert.ok(html.includes("Second Cut"));
    // The description lives HERE now, with the example asks and the wrong ask.
    assert.ok(html.includes("programmed by label"));
    assert.ok(html.includes("Things to ask"));
    assert.ok(html.includes("Daptone and its neighbours"));
    assert.ok(html.includes("Not for:"));
    const cached = await getTile(e, P(2));
    assert.equal(cached.count, 2);
  } finally { f.restore(); }
});

// The three added 2026-08-29 (the Bootlegger, the Correspondent, the
// Engineer) went with seven others when the owner cut ten, 2026-10-13: no
// page, no brief, and every list without them. Dutch and Chanson went
// later the same day, and Camille, Monk, the Professor, the Selector and Hip
// Hop (KRS-One's key with him) on 2026-10-15.
test("a DJ cut from the house has no page and no brief, and no list names them", async () => {
  const e = env();
  const f = installFetch();
  try {
    for (const gone of ["the-bootlegger", "the-correspondent", "the-engineer", "baddie", "youp",
      "comedy", "amadeus", "the-projectionist", "tempo", "grunge", "kurt", "dutch", "chanson",
      "camille", "monk", "the-professor", "the-selector", "hip-hop", "krs-one"]) {
      const res = await worker.fetch(get(`/buttons/${KEY}/${gone}`), e);
      assert.equal(res.status, 404, gone);
      await assert.rejects(callTool(e, "get_dj", { name: gone }, { remaining: 40 }), /no DJ called/, gone);
    }
    const all = await callTool(e, "get_dj", {}, { remaining: 40 });
    // Seventeen since the merges, 2026-10-13: six DJs became two. Fifteen
    // since Dutch and Chanson were cut the same day; ten since 2026-10-15.
    assert.equal(all.djs.length, 10);
    assert.ok(!all.djs.some((d) => /Bootlegger|Correspondent|Engineer|Baddie|Youp|Comedy|Amadeus|Projectionist|Tempo|Grunge|Dutch|Chanson/.test(d.name)));
    assert.ok(!all.djs.some((d) => /Camille|Monk|Professor|Selector|Hip Hop/.test(d.name)), "nor the five cut on 2026-10-15");
    assert.ok(!all.djs.some((d) => /Sunny|Morning|Nightside|Stax|Soul Factory|KRS-One/.test(d.name)), "the merged DJs are not listed");
    assert.doesNotMatch(all.house_rules ?? (await callTool(e, "get_dj", { name: "hank" }, { remaining: 40 })).house_rules,
      /MOVEMENTS ARE NOT REPEATS|TALK IS A TRACK/);
  } finally { f.restore(); }
});

test("the house rules carry the one-composition-one-slot rule", async () => {
  // Prose, but load-bearing prose: every curating session reads house_rules
  // through get_dj, and this line exists because a set shipped two takes of
  // the same song back to back. Pinned so a rules rewrite cannot lose it.
  const out = await callTool(makeEnv(), "get_dj", { name: "hank" }, { remaining: 40 });
  assert.match(out.house_rules, /ONE COMPOSITION, ONE SLOT/);
  assert.match(out.house_rules, /never (?:be )?adjacent/i);
});

test("the house rules carry the curator's release-date and outside-the-brief rules", async () => {
  // 2026-10-13: these two were only in the request curator's prompt, so a set
  // curated by Talk or the phone, which read get_dj alone, never had them.
  const out = await callTool(makeEnv(), "get_dj", { name: "hank" }, { remaining: 40 });
  assert.match(out.house_rules, /NEW MEANS RELEASED/);
  assert.match(out.house_rules, /"released" date search_tracks returns, never against memory/);
  assert.match(out.house_rules, /OUTSIDE THE BRIEF BELONGS TO ANOTHER DJ/);
  assert.match(out.house_rules, /not_for/);
});

test("get_dj serves the new briefs and their example asks", async () => {
  const e = env();
  const f = installFetch();
  try {
    // Stax's name finds Soul, who took him in (the merges, 2026-10-13).
    // KRS-One's found Hip Hop until Hip Hop was cut (2026-10-15).
    const dj = await callTool(e, "get_dj", { name: "stax" }, { remaining: 40 });
    assert.equal(dj.name, "Soul");
    assert.equal(dj.button, "button 5");
    assert.ok(dj.brief.includes("THE ASK PICKS THE HALF"));
    assert.equal(dj.example_asks.length, 3);
    await assert.rejects(callTool(e, "get_dj", { name: "krs" }, { remaining: 40 }), /no DJ called/);
    const all = await callTool(e, "get_dj", {}, { remaining: 40 });
    assert.equal(all.djs.length, Object.keys(ROSTER).length);
  } finally { f.restore(); }
});

test("an unknown DJ is refused with an explanation, not a bare 404", async () => {
  const e = env();
  const f = installFetch();
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}/nobody`), e);
    assert.equal(res.status, 404);
    assert.ok((await res.text()).includes("The DJs tab has every one of them"));
    // A renamed DJ's old address opens their page (Codex's review, 2026-10-09).
    const old = await worker.fetch(get(`/buttons/${KEY}/dj-stax`), e);
    assert.equal(old.status, 301);
    assert.equal(old.headers.get("location"), `/buttons/${KEY}/soul`);
    // And a merged DJ's old key opens the new DJ's page, at its own address
    // (the merges, 2026-10-13), the query kept.
    for (const [was, now] of [["sunny", "vibe"], ["morning", "vibe"], ["nightside", "vibe"], ["stax", "soul"],
      ["soul-factory", "soul"], ["motown", "soul"]]) {
      const r = await worker.fetch(get(`/buttons/${KEY}/${was}?endless=lane-making`), e);
      assert.equal(r.status, 301, was);
      assert.equal(r.headers.get("location"), `/buttons/${KEY}/${now}?endless=lane-making`, was);
    }
    // KRS-One's went with Hip Hop (2026-10-15): nobody to send it to.
    assert.equal((await worker.fetch(get(`/buttons/${KEY}/krs-one`), e)).status, 404);
  } finally { f.restore(); }
});

test("the premise is the program's when one is on the button", async () => {
  const e = env();
  await seedProgram(e, "prog-ddd444", {
    title: "T", thesis: "Berlin was a medical decision. Before it was artistic." });
  await e.PROGRAMS.put(`current:${P(3)}`, "prog-ddd444");
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    // Since 2026-09-05 the card does not repeat the program's own gist, so
    // the card is the title, the link, and the tracklist. The shelf row's
    // standfirst went with board A (2026-09-25): a card is the cover, the
    // title and how long, and the gist is on the program's page, a tap away.
    // A listener's OWN words (an ask) still show; see the next test.
    assert.ok(!html.includes("Program premise"));
    assert.ok(!html.includes("from the program record"));
    assert.ok(!html.includes("Berlin was a medical decision."), "the gist is on the program's page, not here");
    assert.match(html, /<a class="chipbtn" href="[^"]+">Program<span class="arr"/, "the program is a chip, one tap away");
    // The program's own title is IN THE BLOCK since 2026-09-11 (the owner:
    // "show the name of the program/setlist in the blue block"). It used to
    // head the card under it, which repeated what the block was about.
    assert.ok(!html.includes("last loaded here:"));
    assert.ok(!/<p class="online">/.test(html), "the card no longer names it; the block does");
    // But the pointer is history, not a verified present: a direct Spotify
    // edit or a failed pointer-clear can leave it naming a set the button no
    // longer holds. Outside the merged path (where the live fingerprint
    // earned the claim) the title keeps its qualifier.
    // The record here has no tracks, so "now" cannot be verified and the line
    // says what the pointer knows: loaded earlier.
    assert.match(html, /<p class="vload"><span class="vtag">Loaded earlier · <\/span>T<\/p>/);
    // A program on the preset: the tracklist chip starts shut, and the
    // Program chip links to the page — the list is one tap away.
    assert.match(html, /<details class="tlfold"><summary class="chipbtn solid">Tracklist · 1<svg/);
    assert.match(html, /<a class="chipbtn" href="\/buttons\/[^"]+\/programs\/prog-ddd444\?from=[a-z-]+">Program<span class="arr"/);
  } finally { f.restore(); }
});

test("the premise is the recorded ask when no program is loaded — and absent when nothing is", async () => {
  const e = env();
  await e.PROGRAMS.put(`ask:${P(2)}`, JSON.stringify({
    text: "Hank, a fresh set on your own button.", at: "2026-08-29T10:00:00Z" }));
  const f = installFetch();
  try {
    const withAsk = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(withAsk.includes("The ask"));
    assert.ok(withAsk.includes("Hank, a fresh set on your own button."));
    assert.ok(withAsk.includes("as asked on 2026-08-29"));
    const without = await (await worker.fetch(get(`/buttons/${KEY}/vibe`), e)).text();
    assert.ok(!without.includes("The ask"));
    assert.ok(!without.includes("Program premise"));
  } finally { f.restore(); }
});

test("the ask's date is the house's day, not UTC's", async () => {
  // 20:30 on the 12th in San Francisco is 03:30 on the 13th in UTC, and the
  // line printed the UTC one: an evening ask read as the next day's.
  const e = env();
  e.HOUSE_TZ = "America/Los_Angeles";
  await e.PROGRAMS.put(`ask:${P(2)}`, JSON.stringify({
    text: "Hank, something for the evening.", at: "2026-09-13T03:30:00Z" }));
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(html.includes("as asked on 2026-09-12"), "the evening it was asked, in the house");
    assert.ok(!html.includes("as asked on 2026-09-13"));
  } finally { f.restore(); }
});

test("no program on the button: the setlist is the content, and stands open", async () => {
  const e = env();
  await e.PROGRAMS.put(`ask:${P(2)}`, JSON.stringify({
    text: "Hank, a fresh set.", at: "2026-08-29T10:00:00Z" }));
  const f = installFetch({ contents: [track("a"), track("b")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // The card shows the richest thing it has. With no program to outrank
    // it, the tracklist IS the content — folding it here would hide the only
    // thing on the card behind a tap that reveals everything.
    assert.match(html, /On the preset/);
    assert.match(html, /The ask/);
    assert.match(html, /<details class="tlfold" open><summary class="chipbtn solid">Tracklist · 2<svg/);
    assert.match(html, /tlfold[\s\S]*?<ol class="tl">/);
  } finally { f.restore(); }
});

test("the ask is one open card on the DJ page, and no script opens a fold", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // Shut by default from 2026-09-05 until board A (the owner, 2026-09-25:
    // "the area when requesting a set is too messy"): now the box, the
    // length, Keep and Ask stand open as one card, and everything else a
    // request can carry is one native fold inside it, shut.
    assert.ok(!html.includes('<details class="askfold">'), "the old fold is gone");
    assert.ok(!html.includes('class="askopen"'), "nor its Close the form label");
    assert.match(html, /<form method="post" action="[^"]+\/hank\/request" class="reqform askcard">/);
    assert.match(html, /<details class="askmore"><summary>/);
    assert.ok(!/<details class="askmore" open>/.test(html));
    // The folds are native. Two scripts and no more, in this order: the
    // form's own — the chip prefill and the empty-box message (there is no
    // fold to scroll to any more); and the submit guard that disables a
    // pressed button. (A third, the palette boot, rode here from 2026-09-10
    // until Full was deleted on 2026-09-11.) Opening a fold is the reader's
    // alone — no script may open one, add or toggle `open`, so every fold
    // works, and stays shut by default, with scripts off. Shutting the
    // examples' fold once a chip has filled the box is allowed: shut is
    // where it starts anyway.
    // Three since MC-21: the two this test is about, in this order, and the
    // now bar's fill, which rides with the tab bar wherever that lands. Four
    // since 2026-09-23: the one speaker choice the pickers share.
    const all = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(all.length, 4, "four: the form's own, the submit guard, the now bar's fill, the shared pick");
    const barAt = all.findIndex((sc) => /window\.__nowbar = paint;/.test(sc));
    assert.notEqual(barAt, -1, "one of them is the now bar's");
    const pickAt = all.findIndex((sc) => /select\.devsel\[data-pick\]/.test(sc));
    assert.notEqual(pickAt, -1, "one is the shared pick");
    const scripts = all.filter((_, i) => i !== barAt && i !== pickAt);
    assert.match(scripts[0], /querySelectorAll\("\.chip"\)/);
    assert.match(scripts[1], /addEventListener\("submit"/);
    for (const sc of scripts) {
      assert.ok(!/\.open\s*=(?!=)(?!\s*false\b)|setAttribute\(\s*["']open|toggleAttribute/.test(sc),
        "no opening by script");
    }
  } finally { f.restore(); }
});

test("the worked examples move inside the form, and the routing line comes last", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // The examples teach how to ask, so they belong where the asking happens.
    assert.ok(!html.includes("Things to ask"), "no block of its own any more");
    // Inside the card's own fold since board A (2026-09-25).
    const fold = html.indexOf('<details class="askmore">');
    assert.ok(fold > 0);
    assert.ok(html.indexOf("Hank, an hour of Daptone") > fold,
      "the examples are inside the fold, not above it");
    // As things to press: a chip carries the words with Hank's own name
    // trimmed off the front, and a tap puts them in the mood field.
    assert.match(html, /<button type="button" class="chip" data-ask="an hour of Daptone and its neighbours\."/);
    // The routing line stays on the page, and LAST (2026-09-05): what a DJ is
    // not for used to be the first thing under the heading, before the
    // invitation. Since board A it closes the card's fold, after Ask.
    const notFor = html.indexOf("Not for:");
    assert.ok(notFor > fold, "and it is still on the page, in the fold");
    assert.ok(notFor > html.indexOf('<button type="submit" class="asksend"'));
    assert.ok(notFor < html.indexOf("</details>", fold), "the fold's last line");
    assert.match(html, /that is Funkenstein/);
  } finally { f.restore(); }
});

test("a slow player read does not hold the page, and says so honestly", async () => {
  const e = env();
  const realFetch = globalThis.fetch;
  const f = installFetch({ contents: [track("t1")] });
  const inner = globalThis.fetch;
  let aborted = false;
  // Spotify's player endpoint hangs; everything else answers normally.
  globalThis.fetch = (url, init) => {
    if (String(url).includes("/me/player") && !String(url).includes("/devices")) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    }
    return inner(url, init);
  };
  try {
    const started = Date.now();
    const dj = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    const took = Date.now() - started;
    assert.ok(took < 4000, `the page waited ${took}ms on a call it can do without`);
    // The DJ page only uses the player read to mark the row that is playing,
    // so losing it costs a highlight and nothing else — the page is all there.
    assert.match(dj, /On the preset/);
    assert.match(dj, /Play Hank/);
    assert.ok(!dj.includes('aria-current="true"'), "and marks nothing it cannot see");

    // The grid no longer waits for the read at all (2026-09-12: "draw page
    // first and fill now playing line a moment later"): it goes out pending,
    // and its follow-up question gets the honest words for not knowing once
    // the deadline has passed.
    const t1 = Date.now();
    const grid = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(Date.now() - t1 < 1000, "the grid went out before the player's deadline");
    assert.match(grid, /<main class="page wall tabbed" data-base="[^"]+" data-pending="1">/);
    assert.ok(!grid.includes('class="band playing"'), "and marks nothing it cannot see");
    const now = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.equal(now.state, "unknown");
    assert.match(now.notice, /what is playing is unknown/);
    assert.match(now.notice, /which is not the same as quiet/);
    assert.ok(aborted, "and the abandoned call is cancelled, not left running");
  } finally { globalThis.fetch = realFetch; f.restore(); }
});

test("a page with no form keeps the examples in a block of their own", async () => {
  // The archive takes no requests, so folding the examples into a composer it
  // does not have would lose them — and they are still worth having.
  const e = env();
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/archive`), e)).text();
    assert.match(html, /Things to ask/);
    assert.ok(!html.includes('<details class="askfold">'));
  } finally { f.restore(); }
});

test("every control answers a touch, not only a cursor", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // Send crosses the internet to a ledger, a KV write and a GitHub commit,
    // and a phone has no hover — without a pressed state the button looks
    // untouched for the whole round trip, which reads as "it did not take".
    assert.match(html, /\.reqform button:active\{/);
    assert.match(html, /\.reqact button:active\{/);
    assert.match(html, /\.playbtn:active\{/);
    assert.match(html, /li\.entry button:active\{/);
    assert.match(html, /prefers-reduced-motion:reduce/,
      "the 1px press is motion, and motion is a preference");
  } finally { f.restore(); }
});

test("a writer's page shows at most six shelf cards and links the filtered notes page", async () => {
  // Six since board A (2026-09-25), a grid two across; three rows before.
  const e = env();
  const slugs = ["a-111aaa", "b-222bbb", "c-333ccc", "d-444ddd", "e-555eee", "f-666fff", "g-777ggg"];
  for (const [i, slug] of slugs.entries()) {
    await seedProgram(e, slug, { title: `P${i}`, created: `2026-08-2${i}T10:00:00Z` });
  }
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    const grid = html.slice(html.indexOf('<ul class="djgrid">'), html.indexOf("</ul>", html.indexOf('<ul class="djgrid">')));
    assert.equal((grid.match(/<li class="card/g) ?? []).length, 6);
    assert.ok(!grid.includes("a-111aaa"), "the oldest is the one left off");
    assert.match(html, /On the shelf <small>7 programs<\/small>/);
    assert.ok(html.includes(`All 7 programs`));
    assert.ok(html.includes(`/notes/${KEY}?dj=the-librarian`));
    // Loading is not offered here any more: each card opens its program's
    // page, which has Load. (The route still comes back here when told to:
    // see the return-field test below.)
    assert.ok(grid.includes(`/buttons/${KEY}/programs/g-777ggg?from=the-librarian`));
    assert.ok(!html.includes("Load on preset"));
    assert.ok(!html.includes(`action="/notes/${KEY}/activate"`));
  } finally { f.restore(); }
});

test("the program already on the button offers a badge, not a way to reload it", async () => {
  const e = env();
  await seedProgram(e, "live-111aaa", { title: "Loaded" });
  await seedProgram(e, "other-222bbb", { title: "Not loaded" });
  await e.PROGRAMS.put(`current:${P(3)}`, "live-111aaa");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    // Since board A (2026-09-25) the cards carry no forms at all: the live
    // one wears the badge in its corner, and the other is a link.
    const card = (slug) => { const at = html.indexOf(`/programs/${slug}?`, html.indexOf('<ul class="djgrid">'));
      return html.slice(html.lastIndexOf("<li class=", at), html.indexOf("</li>", at)); };
    assert.match(card("live-111aaa"), /^<li class="card live">[\s\S]*<span class="num">On preset<\/span>/);
    assert.ok(!card("other-222bbb").includes('class="num"'));
    assert.ok(!html.includes('value="live-111aaa"') && !html.includes('value="other-222bbb"'), "no form names either");
    // And the live one's own page has the badge, never a load form — or a
    // load would take a second backup of the set the first one just wrote.
    const live = await (await worker.fetch(get(`/buttons/${KEY}/programs/live-111aaa?from=the-librarian`), e)).text();
    assert.match(live, /<span class="onair">On The Librarian’s preset/);
    assert.ok(!/<button type="submit" class="put"/.test(live));
    const other = await (await worker.fetch(get(`/buttons/${KEY}/programs/other-222bbb?from=the-librarian`), e)).text();
    assert.match(other, /<button type="submit" class="put"/);
  } finally { f.restore(); }
});

test("the return field names a DJ and can never become an open redirect", async () => {
  const e = env();
  await seedProgram(e, "one-111aaa", { title: "One" });
  const f = installFetch();
  try {
    for (const bad of ["https://evil.example", "//evil.example", "../../etc", "nobody"]) {
      const res = await worker.fetch(post(`/notes/${KEY}/activate`,
        form({ slug: "one-111aaa", return: bad })), e);
      assert.equal(res.status, 303);
      // Falls back to the shelf. The destination is composed from a name that
      // has to be one of ours, so a path in this field reaches nothing.
      assert.ok(res.headers.get("location").startsWith(`/notes/${KEY}?put=`),
        `${bad} -> ${res.headers.get("location")}`);
    }
    const ok = await worker.fetch(post(`/notes/${KEY}/activate`,
      form({ slug: "one-111aaa", return: "the-librarian" })), e);
    assert.ok(ok.headers.get("location")
      .startsWith(`/buttons/${KEY}/the-librarian?put=`));
  } finally { f.restore(); }
});

test("the archive page lists the takes and has no play form", async () => {
  const e = env();
  await e.TOKENS.put(`m3u:${ARCHIVE.key}`, "#EXTM3U\n#EXTINF:230,Long Road (Elm Street Hall)\nhttps://a/1.mp3\n#EXTINF:218,Long Road (later)\nhttps://a/2.mp3\n");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/archive`), e)).text();
    assert.ok(html.includes("Long Road (Elm Street Hall)"));
    assert.ok(html.includes("3:50"));
    assert.ok(html.includes("last three entries"));
    // The archive's own DJ writes the example asks now, and they name the
    // shapes that exist here — a night, a song across the years, a room
    // (2026-09-07).
    assert.ok(html.includes(ARCHIVE.asks[0]));
    assert.ok(html.includes(ARCHIVE.asks[1]));
    // And it carries a "not for" now, which the archive did not have before it
    // had a DJ: this room has no catalogue behind it, and a reader who does not
    // know that will ask it for a song nobody in the family ever played.
    assert.ok(html.includes(ARCHIVE.notFor.split(" — ")[0]), "its not-for");
    assert.ok(!html.includes("/archive/play"));
    assert.ok(!html.includes("<select"));
    // KV only — no Spotify call for the archive view but the player line is
    // not rendered on DJ pages, so no /me/player either... the page reads
    // nothing external at all.
    assert.equal(f.calls.filter((c) => c.startsWith("GET /playlists")).length, 0);
  } finally { f.restore(); }
});

// ------------------------------------------- the picker's opening selection

// The one speaker (MC-28): the phone's choice, the same on every DJ's page.
const withPick = (path, cookie) => new Request(`https://x.test${path}`, { headers: { cookie } });

test("the picker opens on the one speaker: the phone's choice", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(withPick(`/buttons/${KEY}/hank`, "spk=master-bedroom"), e)).text();
    assert.ok(html.includes("<option selected>Master Bedroom</option>"));
    assert.ok(!html.includes("<option selected>Pro Plus</option>"));
  } finally { f.restore(); }
});

test("with no choice on the phone, the picker opens on DEFAULT_DEVICE", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(html.includes("<option selected>Pro Plus</option>"));
  } finally { f.restore(); }
});

test("after a play that never reached the speaker, the picker stays on it", async () => {
  // `asleep` is deliberately not remembered, and the flash tells you to wake
  // the speaker and press Play again. Falling through to the choice here would
  // aim that retry at a different room than the message names.
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(
      get(`/buttons/${KEY}/hank?played=asleep&on=Master%20Bedroom`), e)).text();
    assert.ok(html.includes("Master Bedroom is not in Spotify"));
    assert.ok(html.includes("<option selected>Master Bedroom</option>"));
  } finally { f.restore(); }
});

test("the room just attempted outranks the phone's choice", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(
      withPick(`/buttons/${KEY}/hank?played=asleep&on=Master%20Bedroom`, "spk=everywhere"), e)).text();
    assert.ok(html.includes("<option selected>Master Bedroom</option>"));
    assert.ok(!html.includes("<option selected>Everywhere</option>"));
  } finally { f.restore(); }
});

test("a speaker off the allowlist cannot be selected through the query", async () => {
  // ?on= is editable and now reaches a form field, so it gets the same
  // allowlist check the flash line has always applied.
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(
      get(`/buttons/${KEY}/hank?played=ok&on=Kitchen`), e)).text();
    assert.ok(!html.includes("Kitchen"));
    assert.ok(html.includes("<option selected>Pro Plus</option>"));
  } finally { f.restore(); }
});

test("a chosen speaker that left the allowlist is not selected either", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(withPick(`/buttons/${KEY}/hank`, "spk=kitchen"), e)).text();
    assert.ok(!html.includes("Kitchen"));
    assert.ok(html.includes("<option selected>Pro Plus</option>"));
  } finally { f.restore(); }
});

test("playing on Master Bedroom leaves the picker there on the way back", async () => {
  // The reported symptom end to end: choose a room, press Play, follow the
  // 303, and the form still names the room you chose.
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  const restore = playsOn("Master Bedroom");
  try {
    const res = await worker.fetch(
      post(`/buttons/${KEY}/hank/play`, form({ device: "Master Bedroom" })), e);
    assert.equal(res.status, 303);
    const html = await (await worker.fetch(get(res.headers.get("location")), e)).text();
    assert.ok(html.includes("<option selected>Master Bedroom</option>"));
  } finally { restore(); f.restore(); }
});

// ------------------------------------------------------------------ play POST

test("play refuses GET, foreign origins, and devices off the allowlist", async () => {
  const e = env();
  const f = installFetch();
  try {
    let res = await worker.fetch(get(`/buttons/${KEY}/hank/play`), e);
    assert.equal(res.status, 405);

    res = await worker.fetch(post(`/buttons/${KEY}/hank/play`, form({ device: "Pro Plus" }),
      { origin: "https://evil.example" }), e);
    assert.equal(res.status, 403);

    res = await worker.fetch(post(`/buttons/${KEY}/hank/play`,
      form({ device: "My Phone" })), e);
    assert.equal(res.status, 400);
    assert.ok((await res.text()).includes("not one of the configured speakers"));

    // None of those reached the player.
    assert.equal(f.calls.filter((c) => c.includes("/me/player/play")).length, 0);
  } finally { f.restore(); }
});

test("play from the archive card is refused with the remote explanation", async () => {
  const e = env();
  const f = installFetch();
  try {
    const res = await worker.fetch(post(`/buttons/${KEY}/archive/play`, form({})), e);
    assert.equal(res.status, 400);
    assert.ok((await res.text()).includes("Press 6 on the remote"));
  } finally { f.restore(); }
});

test("a play that does not verify redirects with played=stuck", async () => {
  const e = env();
  // The stub answers 204 to /me/player, so startedContext never confirms.
  const f = installFetch();
  try {
    const res = await worker.fetch(post(`/buttons/${KEY}/hank/play`,
      form({ device: "Pro Plus" })), e);
    assert.equal(res.status, 303);
    const loc = res.headers.get("location");
    assert.ok(loc.startsWith(`/buttons/${KEY}/hank?played=stuck`), loc);
    assert.ok(loc.includes("on=Pro%20Plus"));
    // It really tried: context play against the resolved device.
    assert.ok(f.calls.some((c) => c === "PUT /me/player/play"));
  } finally { f.restore(); }
});

// A play Spotify accepts and confirms, on whichever speaker the form names.
function playsOn(name) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({
        is_playing: true,
        item: { name: "T", uri: "spotify:track:aaa", type: "track",
          duration_ms: 1000, artists: [{ name: "A" }], album: { name: "B" } },
        progress_ms: 10,
        device: { id: `device-${name}`, name },
        context: { uri: `spotify:playlist:${P(2)}` },
        shuffle_state: false, repeat_state: "off",
      }), { headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/v1/me/player/devices") {
      return new Response(JSON.stringify({ devices: [{ id: `device-${name}`, name }] }),
        { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  return () => { globalThis.fetch = inner; };
}

test("the wall's Play goes where the masthead select says, not where a DJ was last started", async () => {
  // Since 2026-09-05 the wall has one speaker select for the whole page and
  // every play form carries its answer, so the label on a band and the room
  // the press reaches are one fact and a person can see it. (The per-DJ
  // memory this once set aside went in MC-28: there is one speaker.)
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(html, /Play Hank on Pro Plus/, "the page's speaker, not Hank's memory");
    assert.ok(!/Play Hank on Master Bedroom/.test(html));
    const hank = html.match(/<li class="band" data-btn="2"[\s\S]*?<\/li>/)?.[0];
    assert.match(hank, /<input type="hidden" name="device" value="Pro Plus" data-wall>/);
  } finally { f.restore(); }
});

test("a play POST that names no device lands on the phone's choice", async () => {
  // The route's fallback, for a form or a caller that sends no device: the
  // phone's choice, then the default. The wall's forms do name one since
  // 2026-09-05; the DJ page's picker always did.
  const e = env();
  const f = installFetch();
  const restore = playsOn("Everywhere");
  try {
    const res = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/hank/play`,
      { method: "POST", body: form({}), headers: { cookie: "spk=everywhere" } }), e);
    assert.ok(res.headers.get("location").includes("on=Everywhere"));
  } finally { restore(); f.restore(); }
});

test("a chosen speaker that leaves the allowlist is forgotten, not offered", async () => {
  // ROOM_DEVICES is config and can lose a speaker after a phone chose it.
  // Offering it would promise a room the play route is about to refuse.
  const e = env();
  // A track on every button — a Play control needs a set behind it.
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(withPick(`/buttons/${KEY}`, "spk=kitchen"), e)).text();
    assert.ok(!html.includes("Kitchen"));
    assert.ok(html.includes("Play Hank on Pro Plus"));
  } finally { f.restore(); }
});

test("a play that never reached the speaker is not remembered", async () => {
  const e = env();
  const f = installFetch();
  try {
    // "Everywhere" is allowlisted but absent from the device list, so nothing
    // was sent. Pinning the card to it would make the next press fail too.
    const res = await worker.fetch(post(`/buttons/${KEY}/hank/play`, form({ device: "Everywhere" })), e);
    assert.equal(res.headers.get("set-cookie"), null, "no choice written for a speaker nothing reached");
  } finally { f.restore(); }
});

test("the grid leads with the buttons, not with a paragraph about them", async () => {
  // Removed on 2026-08-30: it explained the page to somebody opening it for the
  // hundredth time, and the cards say all of it. The description meta stays —
  // that is for a tab and a link preview, and is never read twice.
  const e = env();
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!/<p class="standfirst">/.test(html));
    assert.ok(html.includes('<meta name="description"'));
  } finally { f.restore(); }
});

test("a speaker Spotify cannot see reads as asleep, not as a failure", async () => {
  const e = env();
  // "Everywhere" is on the allowlist but absent from the fake device list, so
  // resolveDevice refuses. That is its own outcome: a sleeping WiiM and a
  // Spotify refusal used to share the `failed` message, which sent the reader
  // looking for a fault in the service when the fix is a nudge on the device.
  const f = installFetch();
  try {
    const res = await worker.fetch(post(`/buttons/${KEY}/hank/play`,
      form({ device: "Everywhere" })), e);
    assert.equal(res.status, 303);
    const loc = res.headers.get("location");
    assert.ok(loc.startsWith(`/buttons/${KEY}/hank?played=asleep`), loc);
    assert.equal(f.calls.filter((c) => c === "PUT /me/player/play").length, 0);

    const html = await (await worker.fetch(
      get(`/buttons/${KEY}/hank?played=asleep&on=Everywhere`), e)).text();
    assert.ok(html.includes("most likely"));
    assert.ok(html.includes("Nothing was changed."));
    // And it does not blame Spotify, which is what the old copy did.
    assert.ok(!html.replace(/<script[\s\S]*?<\/script>/g, "").includes("Spotify refused"));
  } finally { f.restore(); }
});

test("a verified play redirects with played=ok and an Origin: null form is allowed", async () => {
  const e = env();
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({
        is_playing: true,
        item: { name: "T", uri: "spotify:track:aaa", type: "track",
          duration_ms: 1000, artists: [{ name: "A" }], album: { name: "B" } },
        progress_ms: 10,
        device: { id: "device-1", name: "Pro Plus" },
        context: { uri: `spotify:playlist:${P(2)}` },
        shuffle_state: false, repeat_state: "off",
      }), { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const res = await worker.fetch(post(`/buttons/${KEY}/hank/play`,
      form({ device: "Pro Plus" }), { origin: "null" }), e);
    assert.equal(res.status, 303);
    assert.ok(res.headers.get("location").startsWith(`/buttons/${KEY}/hank?played=ok`));
  } finally { globalThis.fetch = inner; f.restore(); }
});

// ------------------------------------------------------- the ask, recorded

test("replace_playlist stores the ask on success and clears it when omitted", async () => {
  const e = env();
  const f = installFetch({ contents: [track("old")] });
  try {
    await callTool(e, "replace_playlist", {
      playlist: "button 2", uris: ["spotify:track:aaa"],
      ask: "Hank, something fresh.",
    }, { remaining: 40 });
    const stored = JSON.parse(await e.PROGRAMS.get(`ask:${P(2)}`));
    assert.equal(stored.text, "Hank, something fresh.");
    assert.ok(stored.at);

    await callTool(e, "replace_playlist", {
      playlist: "button 2", uris: ["spotify:track:bbb"],
    }, { remaining: 40 });
    assert.equal(await e.PROGRAMS.get(`ask:${P(2)}`), null);
  } finally { f.restore(); }
});

test("a write through the server busts the tile cache", async () => {
  const e = env();
  await putTile(e, P(2), { count: 99, at: Date.now() });
  const f = installFetch({ contents: [track("old")] });
  try {
    await callTool(e, "replace_playlist", {
      playlist: "button 2", uris: ["spotify:track:aaa"],
    }, { remaining: 40 });
    assert.equal(await getTile(e, P(2)), null);
  } finally { f.restore(); }
});

// ------------------------------------------------------------------ validator

// ------------------------------------------------ what the page must not claim
//
// Added after the 2026-08-30 review. Each of these is a state the pages used to
// describe as something more confident than what the server had actually
// established: a play it could not verify as a play that never happened, an
// outage as silence, a day-old cache as a fresh read, an unreadable playlist as
// an empty one.

test("a play whose read-back fails redirects with played=sent, never failed", async () => {
  const e = env();
  const f = installFetch({ fail: { "GET /me/player": "down" } });
  try {
    const res = await worker.fetch(post(`/buttons/${KEY}/hank/play`,
      form({ device: "Pro Plus" })), e);
    assert.equal(res.status, 303);
    const loc = res.headers.get("location");
    assert.ok(loc.startsWith(`/buttons/${KEY}/hank?played=sent`), loc);
    assert.ok(f.calls.some((c) => c === "PUT /me/player/play"), "it really was sent");
    const html = await (await worker.fetch(
      get(`/buttons/${KEY}/hank?played=sent&on=Pro%20Plus`), e)).text();
    assert.match(html, /accepted the request to start Hank on Pro Plus/);
    assert.ok(!html.includes("Nothing was changed"));
  } finally { f.restore(); }
});

test("play_playlist reports an unverified start rather than a failure", async () => {
  const f = installFetch({ fail: { "GET /me/player": "down" } });
  try {
    const out = await callTool(env(), "play_playlist",
      { playlist: "button 2", device: "Pro Plus" }, { remaining: 40 });
    assert.equal(out.unverified, true);
    assert.equal(out.preset_safe, false);
    assert.match(out.warning, /could not be verified/);
  } finally { f.restore(); }
});

test("a Spotify outage is reported as unknown, not as quiet", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")], fail: { "GET /me/player": "down" } });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(html, /could not be reached just now/);
    assert.ok(!html.includes("Spotify is quiet"));
    assert.ok(!html.includes('class="card playing"'));
  } finally { f.restore(); }
});

test("the grid draws the DJ's own face, whatever the tile holds or how old it is", async () => {
  // The cover used to come off the tile, so `stale` decided whether a day-old
  // picture still stood in. It decides nothing on the grid any more: the face
  // is the persona's, served from art/covers/, and the service's cover is
  // never drawn here — which is what makes a DJ look the same on a Tidal
  // button as on a Spotify one. The stale flag is still set by tileFor and
  // still read on the DJ page for the count and runtime; that is not what
  // this test checks.
  const e = env();
  const COVER = "https://image-cdn-fa.spotifycdn.com/image/" +
    "ab67706c0000da849b33bed05637eb8fd569d306";
  const tile = (age) => JSON.stringify({ name: "X", count: 3, runtime: "10:00",
    cover: COVER, at: Date.now() - age });
  for (const age of [2 * 3600 * 1000, 25 * 3600 * 1000]) {
    await putTile(e, P(1), JSON.parse(tile(age)));
    const f = installFetch({ contents: [track("aaa")], fail: { [`GET /playlists/${P(1)}`]: "down" } });
    try {
      const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
      // Since 2026-09-05 the wall draws no picture at all, and since
      // 2026-09-11 no colour either: one slate family for every band (Full
      // deleted), so the tile's cover decides nothing here whatever its age.
      assert.match(html, /data-dj="dr-funkenstein" data-name="Dr\. Funkenstein"(?: data-rest="[^"]*")?>/, "button 1's band carries no colour");
      assert.match(html, /data-dj="hank" data-name="Hank"(?: data-rest="[^"]*")?>/, "and neither does any other");
      assert.ok(!html.includes("--dj-fill"), "the persona's colour is the sleeve's business now");
      assert.ok(!html.includes(COVER), "the service's cover is not drawn, fresh or stale");
      assert.ok(!html.includes("as cached"), "and nothing is claimed about the tile");
    } finally { f.restore(); }
  }
});

// A benched writer can publish from 2026-09-07, so a benched DJ's shelf fills
// up — and "Load on preset" would post to a route that refuses, which is worse
// than no control because it looks like one that works.
test("a benched DJ's shelf is readable and offers no Put on preset", async () => {
  const e = env();
  // Camille's until she was cut (2026-10-15); Americana is benched here.
  await seedProgram(e, "an-orbit-2s4r33", { dj: "Americana", title: "Twelve Inches of Orbit" });
  const f = installFetch({ contents: [track("a")] });
  try {
    // The control is on each program's own page since board A (2026-09-25);
    // the DJ page's card opens it.
    const page = await (await worker.fetch(get(`/buttons/${KEY}/americana`), e)).text();
    assert.match(page, /Twelve Inches of Orbit/, "her work is still listed");
    const hers = await (await worker.fetch(get(`/buttons/${KEY}/programs/an-orbit-2s4r33?from=americana`), e)).text();
    assert.ok(!hers.includes("Load on preset"),
      "but not offered a preset she does not have");
    // And a DJ who IS on a preset still gets it, so what withholds the control
    // is the preset and not the shelf.
    await seedProgram(e, "a-hank-set-1a2b3c", { dj: "Hank", title: "Box Came In" });
    const hank = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(hank, /Box Came In/);
    const his = await (await worker.fetch(get(`/buttons/${KEY}/programs/a-hank-set-1a2b3c?from=hank`), e)).text();
    assert.ok(his.includes("Load on preset"), "Hank is on 2, so his program's page offers it");
  } finally { f.restore(); }
});

test("every band names the service its preset is on, and a benched DJ names none", async () => {
  // The owner, 2026-09-06, with a photograph of the WiiM app's own preset
  // list: every row there carries a small mark saying Spotify, Tidal or a
  // link for a file. The wall does the same, so the two lists read as the
  // same twelve things. The word stands on the right over the Play circle,
  // beside the thing it explains, and it is a WORD — a logo would be a brand
  // colour on a wall that just went quiet.
  const e = env();
  // A mixed house is the case that matters: 12 on Tidal, the rest Spotify,
  // 6 the archive, and a DJ on the bench with no preset at all (Gatefold,
  // since the cut of 2026-10-15 left ten DJs for these presets; four were
  // benched before).
  e.BUTTONS = JSON.stringify([
    ...[1, 2, 3, 4, 5, 7, 8, 9].map((n) => ({
      button: n, dj: HOUSE[n], playlist: P(n), catalog: "spotify",
    })),
    { button: 6, archive: true },
    { button: 12, dj: "americana", playlist: TPID, catalog: "tidal" },
  ]);
  const f = installFetch({ contents: [track("aaa")] });
  const td = installTidalFetch({ contents: ["1"] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    // The whole <li> for one band, so a mark belonging to the NEXT band
    // cannot make this pass.
    const band = (name) => {
      const at = html.indexOf(`>${name}<`);
      assert.ok(at > 0, `${name} is on the page`);
      const open = html.lastIndexOf("<li", at);
      return html.slice(open, html.indexOf("</li>", at));
    };
    assert.match(band("Hank"), /<span class="bside"><span class="bsrc">Spotify<\/span><form/,
      "a Spotify preset says so, over its Play circle");
    assert.match(band("Americana"), /<span class="bside"><span class="bsrc">Tidal<\/span><span class="bnote rem">Use remote</,
      "and the one on Tidal says that over the words that stand where a circle cannot");
    // The archive had a row here with its own mark, Files — neither service,
    // a file this server hands over. Since 2026-09-22 it has no row on this
    // wall at all: the Speakers tab lists the twelve, and this tab is the
    // guests. Its mark is still tested where it is drawn, on that tab.
    assert.ok(!html.includes('class="band fixed slim managed"'), "no archive band on this wall");
    // The catalog belongs to the PRESET and never to the DJ, which is the
    // whole reason a move can change what a DJ is written into. A benched DJ
    // has no preset, so they can only lie by carrying a service — and since
    // MC-14 they are not on the wall at all but on the DJs tab, where a row
    // with no crate wears no mark.
    assert.ok(!html.includes(">Gatefold<"), "the bench left the wall for the DJs tab");
    // Nine: the archive's own mark went with its band on 2026-09-22, and
    // 10 and 11 are not presets here (eleven before the cut of 2026-10-15).
    // Every preset with a band still wears one, and nothing else.
    assert.equal((html.match(/<span class="bsrc">/g) ?? []).length, 9,
      "a mark on every band, and nothing else wearing one");
    const deck = await (await worker.fetch(get(`/buttons/${KEY}/djs`), e)).text();
    // Monk stood for the bench here until he was cut (2026-10-15).
    const benched = deck.slice(deck.indexOf(`href="/buttons/${KEY}/gatefold"`), deck.indexOf("</li>", deck.indexOf(`href="/buttons/${KEY}/gatefold"`)));
    assert.ok(benched.length > 0, "Gatefold is on the DJs tab");
    assert.ok(!/<span class="bsrc">/.test(benched), "a DJ on the bench with no crate is on no service");
  } finally { td.restore(); f.restore(); }
});

test("every KV operation is counted by what asked for it, and the page says so", async () => {
  // Cloudflare mailed at half the daily allowance and neither of us could say
  // what was spending it (2026-09-06) — the same position the Spotify quota
  // put us in that morning, and the same answer. The free tier is 100,000
  // reads a day but a THOUSAND writes, deletes and lists between them, so the
  // two are counted apart and only the scarce one gets a breakdown.
  const e = env();
  const f = installFetch({ contents: [track("a")] });
  try {
    await worker.fetch(get(`/buttons/${KEY}`), e);
    const seen = [...e.STATION.kvops].map(([k, n]) => [k.split("|").slice(1).join("|"), n]);
    assert.ok(seen.length, "a wall load counted something");
    const puts = seen.filter(([k]) => k.startsWith("put|"));
    // The wall's one write is the tile map — this is the same property the
    // op-counting test above holds, seen from the ledger's side.
    assert.deepEqual(puts.map(([k]) => k), ["put|tiles"], JSON.stringify(seen));
    assert.ok(seen.some(([k]) => k.startsWith("list|program")), "and its one listing");

    const html = await (await worker.fetch(get(`/buttons/${KEY}/use`), e)).text();
    assert.match(html, /<h2 id="ucf">Cloudflare<span class="usub">/);
    // Three allowances of a thousand, each on its own line (2026-09-23): the
    // page used to add them up against one thousand, which overstated it.
    // Three meters against their own thousand (2026-09-23), and the reads.
    assert.match(html, /<li><span class="ulab">Writes<\/span><span class="utrack" aria-hidden="true"><i style="width:0\.1%"><\/i><\/span><span class="unum">1 <small>of 1,000<\/small><\/span><\/li>/);
    assert.match(html, /<span class="ulab">Deletes<\/span>[\s\S]*?<span class="unum">0 <small>of 1,000/);
    assert.match(html, /<span class="ulab">Lists<\/span>[\s\S]*?<span class="unum">1 <small>of 1,000/);
    assert.match(html, /a thousand writes, a thousand\s+deletes and a thousand\s+lists/, "never one shared thousand");
    assert.match(html, /the presets page/, "and it names the spender, not the key");
    assert.match(html, /<span class="ulab">Reads<\/span>[\s\S]*?<small>of 100,000<\/small>/);
  } finally { f.restore(); }
});

test("the archive has no band on the presets wall, and its door is the DJs tab's (2026-09-22)", async () => {
  // It HAD a band here, and that band was a door: every other band on the
  // wall was one and this was not, so tapping it did nothing and the page
  // listing what preset 6 holds could be reached only by typing its address
  // (the owner, 2026-09-06). The band is gone with the rest of the twelve —
  // the Speakers tab lists them and plays the Spotify ones — and the door it
  // carried is the DJs tab's row, which was always there. Weighed with the
  // owner on 2026-09-22 before cutting it.
  const e = env();
  const f = installFetch({ contents: [track("a")] });
  try {
    const wall = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!wall.includes(ARCHIVE.name), "no archive band on the presets wall");
    assert.ok(!wall.includes('class="band fixed slim managed"'));
    assert.ok(!wall.includes(`/buttons/${KEY}/archive`), "and no door to it from here");
    // The DJs tab still opens it, by name and by number.
    const djs = await (await worker.fetch(get(`/buttons/${KEY}/djs`), e)).text();
    assert.ok(djs.includes(ARCHIVE.name), "the DJs tab names it");
    assert.match(djs, new RegExp(`href="/buttons/${KEY}/archive"`), "and opens it");
  } finally { f.restore(); }
});

test("the wall writes ONE key for eleven tiles — the free tier allows a thousand a day", async () => {
  // Cloudflare warned at 50% of the daily KV cap with an hour and a half to
  // run (2026-09-06). Measured then: a cold wall load cost TEN writes, one
  // cached tile per preset, and a page open all day could pass a thousand on
  // its own. They are always read together and never apart, so they are one
  // key — and this test is the thing that keeps them one.
  const e = env();
  const n = { get: 0, put: 0, delete: 0, list: 0 };
  const real = e.PROGRAMS;
  e.PROGRAMS = {
    async get(...a) { n.get++; return real.get(...a); },
    async getWithMetadata(...a) { n.get++; return real.getWithMetadata(...a); },
    async put(...a) { n.put++; return real.put(...a); },
    async delete(...a) { n.delete++; return real.delete(...a); },
    async list(...a) { n.list++; return real.list(...a); },
  };
  const f = installFetch({ contents: [track("a"), track("b")] });
  try {
    await worker.fetch(get(`/buttons/${KEY}`), e);
    // Writes and deletes and lists share a thousand a day; reads have a
    // hundred thousand and are not the constraint.
    assert.ok(n.put <= 1, `a cold wall load writes at most one key, wrote ${n.put}`);
    assert.ok(n.delete === 0, `and deletes none, deleted ${n.delete}`);
    assert.ok(n.list <= 1, `and lists once, listed ${n.list}`);

    // Warm, it writes nothing at all.
    const before = n.put;
    await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(n.put, before, "a second load inside the window writes nothing");
  } finally { f.restore(); }
});

test("a playlist edited in the service's own app is said so, and stops claiming a program", async () => {
  // The owner, 2026-09-06: what happens if I add tracks to Kurt's playlist in
  // the Tidal app? Nothing watched it, and the program pointer is a NAME
  // rather than a comparison — the page asks "does this playlist still claim
  // me" and never "does it still contain me" — so a public listen link went
  // on offering a set that was no longer there. Every write now records what
  // it left, and a read that disagrees says so and drops the pointer.
  const e = env();
  const f = installFetch({ contents: [track("a"), track("b")] });
  try {
    // A write through this server leaves its mark and its pointer.
    const out = await callTool(e, "replace_playlist", {
      playlist: "button 2", uris: ["spotify:track:a", "spotify:track:b"],
    });
    assert.ok(out.tracks >= 2);
    await e.PROGRAMS.put(`current:${P(2)}`, "some-program");
    const mark = await e.PROGRAMS.get(`mark:${P(2)}`, { type: "json" });
    assert.equal(mark.n, 2, "what we left is written down");

    // Nothing changed: the read is quiet and the pointer stands.
    const same = await callTool(e, "read_playlist", { playlist: "button 2" });
    assert.equal(same.hand_edited, undefined);
    assert.equal(await e.PROGRAMS.get(`current:${P(2)}`), "some-program");

    // A third track appears from outside — the Spotify app, nothing here.
    f.state.contents.push(track("c"));
    const drifted = await callTool(e, "read_playlist", { playlist: "button 2" });
    assert.equal(drifted.hand_edited.was, 2);
    assert.equal(drifted.hand_edited.now, 3);
    assert.match(drifted.hand_edited.note, /Replacing it will take those edits with it/);
    assert.match(drifted.hand_edited.note, /Spotify app/);
    // And the program page stops claiming to be the set that is on it.
    assert.equal(await e.PROGRAMS.get(`current:${P(2)}`), null,
      "a pointer that would put a listen link on a page for a set that is gone");

    // The DJ's own page says it too, where a person is about to ask for a set
    // that would replace the whole list.
    await e.PROGRAMS.delete(`items:${P(2)}`);
    await e.PROGRAMS.put(`mark:${P(2)}`, JSON.stringify({ n: 2, h: "x", at: "2026-09-06T00:00:00Z" }));
    const page = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(page, /Somebody has edited this preset in the Spotify app/);
    assert.match(page, /2 tracks then, 3 now/);
    assert.match(page, /replaces\s+the WHOLE list/);
  } finally { f.restore(); }
});

test("the archive page has a shelf, marks the live set, and lands there after a put", async () => {
  // Every other DJ's page lists their newest work; the archive's passed
  // shelf: null because nothing was ever written for it. Now its sets have
  // pages, the shelf filters on the DJ's display name like any other, and
  // "live" is the archive pointer rather than a playlist's (2026-09-07).
  const e = env();
  await e.PROGRAMS.put("program:one-night-ab12cd", JSON.stringify({
    slug: "one-night-ab12cd", dj: ARCHIVE.name, shape: "setlist", title: "One Night",
    thesis: "5 takes from the house tapes.", created: "2026-09-07T01:00:00Z",
    playlistId: `archive:${ARCHIVE.key}`, sections: [{ tracks: [{ uri: "archive:take:r0" }] }],
    archive: { key: ARCHIVE.key, btn: 6, site: "https://site.test/playlist/#p=a" },
  }), { metadata: { title: "One Night", dj: ARCHIVE.name, shape: "setlist",
    // As every listing written since MC-11 carries it: without it the Shelf
    // falls back to the house's service and takes an archive set for Spotify.
    catalog: "files", created: "2026-09-07T01:00:00Z", tracks: 5, runtime: "18:00" } });
  const f = installFetch({ contents: [track("a")] });
  try {
    const page = await (await worker.fetch(get(`/buttons/${KEY}/archive`), e)).text();
    assert.match(page, /One Night/);
    assert.ok(!page.includes(">Setlist<"),
      "the shelf row names no kind — the program page's own eyebrow does");
    // A card since board A (2026-09-25), tagged Archive, opening the set's
    // page — where the put is offered, because activate knows the archive now.
    assert.match(page, /<span class="svc">Archive<\/span>/);
    assert.ok(page.includes(`<a href="/buttons/${KEY}/programs/one-night-ab12cd?from=archive">One Night</a>`));
    const own0 = await (await worker.fetch(get(`/buttons/${KEY}/programs/one-night-ab12cd?from=archive`), e)).text();
    assert.match(own0, /aria-label="Load One Night on the archive preset">Load on the archive preset</,
      "offered, because activate knows the archive now");
    assert.ok(!page.includes('<span class="num">'), "not live: no pointer");

    await e.PROGRAMS.put(`current:archive:${ARCHIVE.key}`, "one-night-ab12cd");
    const live = await (await worker.fetch(get(`/buttons/${KEY}/archive`), e)).text();
    assert.match(live, /<li class="card live">[\s\S]*?<span class="num">On preset<\/span>/);

    // The chooser sends the reader back to the archive page, not the shelf,
    // and the page says what happened.
    const done = await worker.fetch(new Request(`https://x.test/notes/${KEY}/activate`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "slug=one-night-ab12cd&return=archive" }), e);
    assert.equal(done.status, 303);
    assert.match(done.headers.get("location"), new RegExp(`^/buttons/${KEY}/archive\\?put=`));
    const after = await (await worker.fetch(get(done.headers.get("location")), e)).text();
    assert.match(after, /class="flash"/, "a put leaves a sentence on the archive page");
    assert.deepEqual(JSON.parse(await e.TOKENS.get(`station:${ARCHIVE.key}`)).refs, ["r0"],
      "and the set is parked again from the record");

    // The persona's own address is the archive's page.
    const alias = await worker.fetch(get(`/buttons/${KEY}/${ARCHIVE.dj}`), e);
    assert.equal(alias.status, 302);
    assert.equal(alias.headers.get("location"), `/buttons/${KEY}/archive`);

    // The Programs list marks the archive row live from the same pointer.
    // Since the grid (2026-09-23) that is a live card, first, with the archive
    // preset's number on it; its own page says it in words.
    const notes = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    assert.match(notes, new RegExp(String.raw`<li class="card live">[\s\S]*?<span class="num" aria-hidden="true">6<\/span><span class="svc">Archive<\/span>[\s\S]*?One Night[\s\S]*?<b>Preset 6<\/b> · ` + ARCHIVE.name));
    const own = await (await worker.fetch(get(`/buttons/${KEY}/programs/one-night-ab12cd`), e)).text();
    assert.match(own, /<span class="onair">On the archive preset · press 6<\/span>/);
  } finally { f.restore(); }
});

test("the wall has one palette, Quiet, and no switch", async () => {
  // Two palettes shipped on 2026-09-06 and the phone chose; the owner chose
  // Quiet on day one and said so on 2026-09-10 ("I rarely if ever use the
  // full color setting"). Full was deleted on 2026-09-11: no pill, no boot
  // script, no attribute on the root, no colour on any band — the slate
  // family is the stylesheet's base rules now, not an override.
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const plain = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(plain, /<html lang="en">/, "nothing stamped on the root");
    assert.ok(!plain.includes("data-palette"), "no attribute, no selector");
    assert.ok(!plain.includes("palopt") && !plain.includes("wall:palette"), "no pill, no boot");
    // And no help for it: the ? kept explaining the pill for two days after
    // it was gone (found 2026-09-13).
    assert.ok(!/Quiet \/ Full|<i>Full<\/i>/.test(plain), "the help names no switch that is not there");
    assert.ok(!plain.includes("--dj-fill"), "no band wears a persona's colour");
    assert.ok(plain.includes(".band{--fill:var(--q-tint);--ink:var(--page-ink);"),
      "the tint is the band's base fill");
    assert.ok(plain.includes(".bnum{width:78px;flex:0 0 auto;background:var(--q-deep);color:var(--q-on-deep);"),
      "the deep tone is the number tile's base");
    assert.ok(plain.includes(".band.playing{--fill:var(--q-deep);--ink:var(--q-on-deep)}"),
      "the playing band goes deep, with no outline");
    assert.ok(plain.includes(".band:not(.playing) .go{background:var(--q-deep);color:var(--q-on-deep)}"));
    assert.ok(plain.includes(".go svg{fill:currentColor}"), "the glyph follows the disc it sits on");
    // The old address still answers — a bookmark with ?palette=quiet on it
    // is a bookmark, not an error — and renders the same wall.
    const same = (h) => h.replace(/nonce="[^"]+"/g, 'nonce=""');
    const asked = await (await worker.fetch(get(`/buttons/${KEY}?palette=quiet`), e)).text();
    assert.equal(same(asked), same(plain), "the same wall, nonces aside");
    const junk = await (await worker.fetch(get(`/buttons/${KEY}?palette=neon`), e)).text();
    assert.equal(same(junk), same(plain));
  } finally { f.restore(); }
});

test("a DJ page says why its list is empty, and only an outage keeps the play form", async () => {
  const e = env();
  let f = installFetch({ contents: [] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /playlist is empty/);
    assert.ok(!html.includes(`/buttons/${KEY}/hank/play`), "nothing to play, no form");
  } finally { f.restore(); }

  // The tracklist read is cached for ninety seconds (2026-09-06); the next
  // two are "later", so the cache is dropped between them.
  await e.PROGRAMS.delete(`items:${P(2)}`);
  f = installFetch({ contents: [track("aaa")], fail: { [`GET /playlists/${P(2)}`]: "down" } });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /could not be read just now/);
    assert.ok(!html.includes("playlist is empty"));
    assert.ok(html.includes(`/buttons/${KEY}/hank/play`), "the form stays: cheap to retry");
  } finally { f.restore(); }

  await e.PROGRAMS.delete(`items:${P(2)}`);
  f = installFetch({ contents: [track("aaa")] });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith(`/v1/playlists/${P(2)}`)) {
      return new Response("not found", { status: 404 });
    }
    return inner(url, init);
  };
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /no longer has the playlist/);
    assert.ok(!html.includes(`/buttons/${KEY}/hank/play`));
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("get_dj serves the wrong ask as well as the right ones", async () => {
  // Morning's name, merged into Vibe (2026-10-13), finds her.
  const out = await callTool(env(), "get_dj", { name: "Morning" }, { remaining: 40 });
  assert.equal(out.name, "Vibe");
  assert.equal(out.example_asks.length, 3);
  assert.match(out.not_for, /Deep Dive/);
});

test("one program is one program, not one programs", async () => {
  const e = env();
  await seedProgram(e, "only-aaaaaa");
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    // The count is the SHELF's, and since 2026-09-11 it is on the shelf's own
    // heading rather than beside the playlist's tracks in the block (the
    // owner: "tracks and the count of programs on the same line… confusing").
    assert.match(html, /<h2 class="blabel">On the shelf <small>1 program<\/small><\/h2>/);
    assert.ok(!html.includes("1 programs"));
    assert.ok(!/<p class="vfacts">[^<]*program/.test(html), "the block counts tracks, not pages");
    // The link to the rest shows only when there IS a rest (board A,
    // 2026-09-25): the one card is the whole shelf.
    assert.ok(!html.includes("All 1 program"));
    assert.ok(!html.includes('class="morelink"'));
  } finally { f.restore(); }
});

test("the Shelf says what it is without naming the writers, and the bar is its way back", async () => {
  const e = env();
  e.REQUESTS_ENABLED = "true"; // the owner's house: the DJ pages take asks
  await seedProgram(e, "one-aaaaaa");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    assert.ok(!html.includes("The Presets →"), "the chip went with the bar (MC-14)");
    assert.match(html, /<nav class="tabbar" aria-label="Sections">/);
    // The explanation is a fold at the foot since the grid (2026-09-23), where
    // the ? in the header was — but it is still ON the page, which is what
    // the assertions below check.
    assert.match(html, /<details class="help pagehelp" name="pagehead"><summary class="helpq" aria-label="How the Shelf works">/);
    assert.ok(!html.includes('aria-label="What is this page?"'), "no ? in the header");
    // Since 2026-09-05 the shelf holds kept sets from ANY DJ, not only the
    // writers' programs, so the standfirst stopped listing five names (the
    // owner: it made no sense once Hank's and Baddie's sets were kept too).
    assert.match(html, /Every set that was kept/);
    assert.match(html, /the sets you asked for and ticked worth keeping/);
    assert.ok(!/Every set that came with something written down/.test(html));
  } finally { f.restore(); }
});

test("a cold grid stays under the free plan's subrequest ceiling", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    await worker.fetch(get(`/buttons/${KEY}`), e);
    const external = f.calls.filter((c) => !c.includes("token")).length;
    // 50 is the plan's limit and 40 the route's own budget; the margin is what
    // the next roster expansion spends.
    assert.ok(external <= 40, `${external} external calls on a cold grid`);
  } finally { f.restore(); }
});

// ------------------------------------------------- states that used to agree
//
// Six faults from a Codex UI-and-code pass, 2026-08-30. Each is one shape: a
// failure and a normal state rendering the same, so a reader cannot tell them
// apart.

test("an unreadable shelf does not claim nothing has been published", async () => {
  const e = env();
  await seedProgram(e, "one-aaaaaa");
  const broken = { ...e, PROGRAMS: { ...e.PROGRAMS,
    list: async () => { throw new Error("KV down"); } } };
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/notes/${KEY}`), broken)).text();
    assert.ok(html.includes("could not be read just now"));
    assert.ok(!html.includes("Nothing published yet"));
  } finally { f.restore(); }
});

test("a missing archive file is said, not rendered as a working button", async () => {
  const e = env();               // nothing seeded at the archive's m3u
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/archive`), e)).text();
    assert.ok(html.includes("Nothing is loaded on the archive"));
    // The card must stop explaining a mechanism that is not running.
    assert.ok(!html.includes("last three entries"));
  } finally { f.restore(); }
});

test("a track that appears twice marks neither row as playing", async () => {
  // Spotify says which track is playing, never which position. Marking both
  // put aria-current on two rows.
  const e = env();
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({
        is_playing: true,
        item: { name: "Truck", uri: "spotify:track:dup", type: "track",
          duration_ms: 1000, artists: [{ name: "A" }], album: { name: "B" } },
        device: { id: "d", name: "Pro Plus" },
        context: { uri: `spotify:playlist:${P(2)}` },
      }), { headers: { "content-type": "application/json" } });
    }
    if (/\/playlists\/[^/]+\/items$/.test(u.pathname)) {
      const t = { ...track("dup"), uri: "spotify:track:dup", name: "Truck" };
      return new Response(JSON.stringify({ total: 2, items: [{ track: t }, { track: t }] }),
        { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.equal((html.match(/aria-current="true"/g) ?? []).length, 0);
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("an album playing marks no band, and the now bar says it is from an album", async () => {
  const e = env();
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({
        is_playing: true,
        item: { name: "T", uri: "spotify:track:aaa", type: "track",
          duration_ms: 1000, artists: [{ name: "A" }], album: { name: "B" } },
        device: { id: "d", name: "Pro Plus" },
        context: { uri: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy" },
      }), { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    // Since 2026-09-05 a band says what plays when it is one of these
    // buttons. Music on none of them is said by the now bar; the line over
    // the wall that said it too went on 2026-09-24 (the owner).
    assert.ok(!html.includes('class="band playing"'));
    assert.ok(!html.includes("a bare queue"));
    assert.match(html, /Pro Plus · an album/);
    assert.ok(!html.includes('id="nowline"'));
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("the program's obligatory boxes are headings, not paragraphs in disguise", async () => {
  const html = renderProgram({
    slug: "s", title: "T", dj: "The Librarian", thesis: "A thesis.",
    created: "2026-08-30T10:00:00Z",
    sections: [{ heading: "One", prose: [{ text: "Body." }], tracks: [] }],
    complications: [{ text: "The counterargument." }],
    coda: [{ text: "After." }],
  }, {});
  assert.ok(/<h2 class="kicker">/.test(html));
  assert.ok(!/<p class="kicker">/.test(html));
});

// ------------------------------------------------------- the request composer
// MC-02: the guided form, its POST target, and the pending card. The words
// travel in the body and come back as codes; the kill switch keeps the whole
// surface dark; Play stays the first interactive element on the page.

// The composer's switch and autofulfillment's are separate, and until
// 2026-09-07 this fixture set only the first — so every test below described
// an AUTOMATIC house while running a house with nobody wired to answer, and
// the page's promises of "five to fifteen minutes" and an hourly retry went
// unchallenged. It says which house it means now. `auto: false` is the core
// install: the form collects, a person fills.
function reqEnv({ auto = true } = {}) {
  const e = env();
  e.REQUESTS_ENABLED = "true";
  e.AUTOFULFILL_ENABLED = auto ? "true" : "false";
  return e;
}

const askPost = (dj, fields, headers = {}) =>
  post(`/buttons/${KEY}/${dj}/request`, form(fields), headers);

test("the composer target is dark while the kill switch is off", async () => {
  const e = env(); // default: REQUESTS_ENABLED unset
  const res = await worker.fetch(askPost("hank", { mood: "m", length: "60" }), e);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "not found");
});

test("the composer target keeps the key discipline and the POST discipline", async () => {
  const e = reqEnv();
  const wrong = await worker.fetch(
    post(`/buttons/wrongwrongwrong1/hank/request`, form({ mood: "m", length: "60" })), e);
  assert.equal(wrong.status, 404);
  assert.equal(await wrong.text(), "not found");

  const got = await worker.fetch(get(`/buttons/${KEY}/hank/request`), e);
  assert.equal(got.status, 405);

  const foreign = await worker.fetch(askPost("hank", { mood: "m", length: "60" },
    { origin: "https://evil.test" }), e);
  assert.equal(foreign.status, 403);
});

test("the archive takes requests now, filed against its own DJ", async () => {
  // It used to refuse them — "it replays what was already made" — and that was
  // true when it had no DJ and a set meant three takes chosen by hand. It has
  // a DJ and a set of any length now, so asking it is the same act as asking
  // Hank (2026-09-07). The page's slug is `archive`; the row is filed against
  // the persona, because that is who curates it.
  const e = reqEnv();
  const arch = await worker.fetch(askPost("archive", { mood: "the Riverside show, whole", length: "60" }), e);
  assert.equal(arch.status, 303);
  assert.equal(arch.headers.get("location"), `/buttons/${KEY}/archive?ask=sent`);
  const rows = [...e.STATION.rows.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dj, ARCHIVE.dj, "the persona, not the page's slug");

  const ghost = await worker.fetch(askPost("nobody", { mood: "m", length: "60" }), e);
  assert.equal(ghost.status, 404);
  assert.match(await ghost.text(), /No DJ named/);
});

test("a valid request lands: 303 with a code, a ledger row, a KV record — no text in any URL", async () => {
  const e = reqEnv();
  const res = await worker.fetch(askPost("hank",
    { mood: "slow Sunday breakfast", length: "60", avoid: "nothing loud" }), e);
  assert.equal(res.status, 303);
  const loc = res.headers.get("location");
  assert.equal(loc, `/buttons/${KEY}/hank?ask=sent`,
    "the redirect carries a code and nothing the visitor typed");

  const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
    body: JSON.stringify({ op: "list", args: { dj: "hank" } }) })).text());
  assert.equal(listed.rows.length, 1);
  assert.equal(listed.rows[0].state, "pending");

  const rec = await e.PROGRAMS.get(`request:${listed.rows[0].id}`, { type: "json" });
  assert.equal(rec.mood, "slow Sunday breakfast");
  assert.equal(rec.length, 60);
  assert.equal(rec.avoid, "nothing loud");
});

test("the keep box rides the record, and only the box's own value turns it on", async () => {
  const e = reqEnv();
  const recordFor = async (dj) => {
    const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
      body: JSON.stringify({ op: "list", args: { dj } }) })).text());
    return e.PROGRAMS.get(`request:${listed.rows[0].id}`, { type: "json" });
  };

  await worker.fetch(askPost("hank",
    { mood: "the annual party", length: "90", keep: "1" }), e);
  assert.equal((await recordFor("hank")).keep, true);

  await worker.fetch(askPost("vibe", { mood: "a Tuesday", length: "30" }), e);
  assert.equal("keep" in await recordFor("vibe"), false,
    "unticked writes no field at all, so records made before this read the same");

  // "on" is what a checkbox with no value attribute sends, and this one has
  // one. A hand-built POST cannot turn the flag on with something that merely
  // looks truthy.
  await worker.fetch(askPost("dr-funkenstein",
    { mood: "a Wednesday", length: "30", keep: "on" }), e);
  assert.equal("keep" in await recordFor("dr-funkenstein"), false);
});

test("the composer offers the keep box, and promises only the mark", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /name="keep"[^>]*value="1"/);
    // Three words beside the box since "A DJ's Page, Calmer" (2026-10-24; one,
    // "Keep", since board A); the fine print in the card's fold says what it does.
    assert.match(html, /<label class="keepbox"><input type="checkbox" name="keep" value="1"><span>Save on Shelf<\/span><\/label>/);
    assert.match(html, /a page anyone with the link can read/,
      "the box discloses that keeping publishes, before it is ticked");
    assert.match(html, /your\s+words are not copied onto it/,
      "and what it does not put there");
  } finally { f.restore(); }
});

test("a marked request says so on its card, and an unmarked one stays quiet", async () => {
  const marked = reqEnv();
  await worker.fetch(askPost("hank",
    { mood: "the annual party", length: "90", keep: "1" }), marked);
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), marked)).text();
    assert.match(html, /Marked to keep — it goes on the shelf once the set is ready\./);
  } finally { f.restore(); }

  const plain = reqEnv();
  await worker.fetch(askPost("hank", { mood: "a Tuesday", length: "30" }), plain);
  const f2 = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), plain)).text();
    assert.ok(!html.includes("Marked to keep"), "no mark, no line");
  } finally { f2.restore(); }
});

test("the gates answer as flash codes: blank, double tap, busy, full", async () => {
  const e = reqEnv();
  const blank = await worker.fetch(askPost("hank", { mood: "   ", length: "60" }), e);
  assert.equal(blank.headers.get("location"), `/buttons/${KEY}/hank?ask=blank`);

  const first = await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  assert.equal(first.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`);
  const double = await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  assert.equal(double.headers.get("location"), `/buttons/${KEY}/hank?ask=already`);
  const second = await worker.fetch(askPost("hank", { mood: "boats", length: "60" }), e);
  assert.equal(second.headers.get("location"), `/buttons/${KEY}/hank?ask=busy`);

  for (const [dj, mood] of [["vibe", "a"], ["dr-funkenstein", "b"]]) {
    const r = await worker.fetch(askPost(dj, { mood, length: "30" }), e);
    assert.equal(r.headers.get("location"), `/buttons/${KEY}/${dj}?ask=sent`);
  }
  const over = await worker.fetch(askPost("the-librarian", { mood: "c", length: "30" }), e);
  assert.equal(over.headers.get("location"),
    `/buttons/${KEY}/the-librarian?ask=full`);
});

test("a length the form cannot send is refused, not coerced", async () => {
  const e = reqEnv();
  const res = await worker.fetch(askPost("hank", { mood: "m", length: "45" }), e);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /30, 60, 90 or 120/);
});

test("two hours is one of the form's own choices, and is recorded as 120", async () => {
  const e = reqEnv();
  const res = await worker.fetch(
    askPost("hank", { mood: "twelve-inch mixes all evening", length: "120" }), e);
  assert.equal(res.status, 303);
  const keys = (await e.PROGRAMS.list({ prefix: "request:" })).keys;
  assert.equal(keys.length, 1);
  const rec = await e.PROGRAMS.get(keys[0].name, { type: "json" });
  assert.equal(rec.length, 120);
});

test("the form offers two hours", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // A dropdown since 2026-10-24 (the owner: "drop downs"). The values the
    // route checks are unchanged; an hour is chosen to start.
    assert.match(html, /<select class="devsel" name="length">\s*<option value="30">½ hour<\/option><option value="60" selected>1 hour<\/option><option value="90">1½ hours<\/option><option value="120">2 hours<\/option>/);
  } finally { f.restore(); }
});

test("the composer renders near the asks, and Play stays the first form", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /<h2 class="blabel" id="reqh">Ask Hank<\/h2>/);
    assert.match(html, new RegExp(`action="/buttons/${KEY}/hank/request"`));
    assert.match(html, /<textarea id="askmood" name="mood" required maxlength="300"/);
    assert.match(html, /name="avoid"[^>]*maxlength="200"/);
    const firstForm = html.indexOf("<form");
    assert.ok(html.slice(firstForm, firstForm + 200).includes("/hank/play"),
      "the play form is still the first interactive element");
    // The worked examples are inside the form that uses them (board A,
    // 2026-09-25: in the card's fold), not a block of their own.
    assert.ok(!html.includes("Things to ask"));
    const ask = html.indexOf('class="reqform askcard"');
    assert.ok(ask > 0 && html.indexOf('class="chip" data-ask=') > ask,
      "the worked examples sit inside the form that uses them");
  } finally { f.restore(); }
});

test("the switch off means no composer on the page at all", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(!html.includes('class="reqform askcard"'));
    assert.ok(!html.includes('id="reqh">Ask Hank<'));
    assert.ok(!html.includes("/hank/request"));
  } finally { f.restore(); }
});

test("a DJ off the wall with no playlist yet still takes a request", async () => {
  // Until 2026-09-10 this DJ got no composer: a request ends by writing songs
  // and they had nowhere to put them. Their first FULFILLED set makes their
  // crate now, so the form is here and the ask is filed; nothing is created
  // until the set is written (test/crate.test.js pins that half).
  const e = reqEnv();
  // Hank is a persona here, not a button; his set goes to the live requests preset.
  e.BUTTONS = JSON.stringify([...JSON.parse(buttons({ 3: P(3) })),
    { button: 1, guest: true, live: true, name: "Requests - Spotify", playlist: P(1), catalog: "spotify" }]);
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(html.includes('id="reqh">Ask Hank<'));
    assert.ok(html.includes('class="reqform askcard"'));
    assert.ok(html.includes("/hank/request"));
    const res = await worker.fetch(askPost("hank", { mood: "m", length: "60" }), e);
    assert.equal(res.status, 303);
    assert.equal(e.STATION.rows.size, 1, "the ask is in the ledger");
  } finally { f.restore(); }
});

test("with nobody wired up the page promises no time, no self-check and no sweep", async () => {
  const e = reqEnv({ auto: false });
  await worker.fetch(askPost("hank", { mood: "something for the drive", length: "60" }), e);
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank?ask=sent`), e)).text();
    assert.match(html, /On the list for Hank/);
    assert.ok(!html.includes("five to fifteen minutes"),
      "no time is promised, because nothing is coming on its own");
    assert.ok(!html.includes("This page checks on its own"));
    assert.ok(!html.includes("again on the hour"));
    assert.match(html, /filled when somebody ASKS Claude for them/);
    assert.match(html, /Opening the app does not do it on its own/,
      "the distinction the owner asked about: opening is not asking");
    // And the page stops re-reading itself every minute: what changes a
    // pending request here is a person, and a page left open would spend the
    // day's free-tier writes waiting for one.
    assert.ok(!/<meta http-equiv="refresh"/.test(html),
      "no self-refresh with nothing to wait for");
    // The withdrawal still stands — it is the one thing the reader can do.
    assert.match(html, /request\/dismiss/);
  } finally { f.restore(); }
});

test("and the composer itself stops promising a time", async () => {
  const f = installFetch({ contents: [track("t1")] });
  try {
    const auto = await (await worker.fetch(get(`/buttons/${KEY}/hank`), reqEnv())).text();
    assert.match(auto, /Usually ready in five to fifteen minutes/);
    const manual = await (await worker.fetch(
      get(`/buttons/${KEY}/hank`), reqEnv({ auto: false }))).text();
    assert.ok(!manual.includes("Usually ready in five to fifteen minutes"));
    assert.match(manual, /Goes on Hank's list — filled when somebody next asks Claude/);
    // Both still say the thing that is true either way.
    for (const h of [auto, manual]) assert.match(h, /Nothing plays until someone presses Play/);
  } finally { f.restore(); }
});

// "slow" is a comparison against an expectation, and only a wired-up Claude
// creates one. An old request in a manual house is still just on the list.
test("an old request is not 'slow' where nothing was ever coming", async () => {
  const f = installFetch({ contents: [track("t1")] });
  const old = Date.now() - 40 * 60000;
  try {
    for (const auto of [true, false]) {
      const e = reqEnv({ auto });
      await worker.fetch(askPost("hank", { mood: "an old one", length: "60" }), e);
      for (const row of e.STATION.rows.values()) row.created_at = old;
      const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
      if (auto) {
        assert.match(html, /Taking longer than usual/, "the automatic house owes an explanation");
      } else {
        assert.ok(!html.includes("Taking longer than usual"),
          "the manual house invents no fault out of working as configured");
        assert.match(html, /On the list for Hank/);
      }
    }
  } finally { f.restore(); }
});

test("an open request replaces the composer with an open request row in Requests", async () => {
  const e = reqEnv();
  await worker.fetch(askPost("hank",
    { mood: "quiet <script>alert(1)</script> evening", length: "90" }), e);
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank?ask=sent`), e)).text();
    assert.match(html, /Pending — Claude has not made this set yet/);
    assert.match(html, /Request sent to Hank\./, "the 303's code became the flash line");
    assert.ok(!html.includes('class="reqform askcard"'), "one request per DJ: the ask card yields to the row");
    // Option A (2026-09-05): the request lives in the Requests section UNDER
    // the block, beside where asking happens, not above Play. In flight it
    // stands open and carries its own withdrawal.
    assert.ok(html.indexOf("/hank/play") < html.indexOf("Your request"), "Play first, the request below");
    const row = html.match(/<details class="reqrow live" open>[\s\S]*?<\/details>/)?.[0];
    assert.ok(row, "the row is open while the request is in flight");
    // And no "Things to ask" under it: examples of what to ask next are
    // clutter while this one has not landed (the owner, 2026-09-05).
    assert.ok(!html.includes("Things to ask"));
    assert.match(row, /request\/dismiss/, "the pending row offers its withdrawal");
    assert.match(row, /<span class="reqword">pending<\/span>/);
    assert.ok(!html.includes("<script>alert(1)</script>"), "the echo is escaped");
    assert.match(html, /quiet &lt;script&gt;/);
    assert.match(html, /about 90 min/);
    assert.match(html,
      new RegExp(`<meta http-equiv="refresh" content="60;url=/buttons/${KEY}/hank">`),
      "the page checks on its own, back at the clean URL");
  } finally { f.restore(); }
});

test("a claimed request says so, and a missing record degrades to a plain card", async () => {
  const e = reqEnv();
  const now = Date.now();
  e.STATION.rows.set("r-claimed", {
    id: "r-claimed", dj: "hank", normalized: "x", state: "claimed",
    created_at: now, updated_at: now, lease_until: now + 600_000,
    fingerprint: "fp", write_started: 0, claim_token: "t", claim_count: 1,
    playlist_id: null, track_count: null, runtime_ms: null,
    attention_code: null, decline_reason: null, suggested_dj: null,
  });
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Claude is making this set right now/);
    assert.ok(!html.includes("undefined"), "no record, no echo, no debris");
  } finally { f.restore(); }
});


test("a play outcome on the page suppresses the self-refresh, keeping the retry's room", async () => {
  const e = reqEnv();
  await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  const f = installFetch({ contents: [track("t1")] });
  try {
    const waiting = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(waiting, /http-equiv="refresh"/);
    const afterPlay = await (await worker.fetch(
      get(`/buttons/${KEY}/hank?played=asleep&on=Everywhere`), e)).text();
    assert.ok(!afterPlay.includes('http-equiv="refresh"'),
      "the ?on= room must survive for the retry the flash asks for");
  } finally { f.restore(); }
});

test("a claimed row with a dead lease reads as retrying, not as work in progress — and can be withdrawn", async () => {
  const e = reqEnv();
  const now = Date.now();
  e.STATION.rows.set("r-dead", {
    id: "r-dead", dj: "hank", normalized: "x", state: "claimed",
    created_at: now - 1000, updated_at: now - 1000, lease_until: now - 1,
    fingerprint: "fp", write_started: 0, claim_token: "t", claim_count: 1,
    playlist_id: null, track_count: null, runtime_ms: null,
    attention_code: null, decline_reason: null, suggested_dj: null,
  });
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // Since 2026-09-06 a claim that died before writing says so — "the first
    // attempt did not finish" — rather than "pending … usually ready in five
    // to fifteen minutes", which the owner watched for half an hour.
    assert.match(html, /<span class="reqword">retrying<\/span>/);
    assert.match(html, /The first attempt did not finish\. Claude is asked again/);
    assert.ok(!html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<div class="nowbar[\s\S]*?<\/div>/, "").includes("right now"), "no claimant is known to be running");
    assert.ok(!html.includes("Claude has not made this set yet"));
    assert.match(html, /request\/dismiss/, "the ledger dismisses a dead claim, so the page offers it");
    assert.ok(!html.includes('class="reqform askcard"'), "still one request per DJ");
  } finally { f.restore(); }
});

// RINGING AGAIN, 2026-09-06. The routine wakes on a push to the doorbell repo
// and on an hourly sweep, nothing else — so a claim that died meant up to an
// hour of "pending" with the owner watching. While the page is being watched
// (it refreshes itself), it rings again: a dead claim at once, an unpicked
// request after twenty minutes (three until 2026-10-15); at most every ten
// minutes and three times, the stamp on the record before the ring so two
// refreshes cannot both ring.
function deadClaim(e, id, ageMs) {
  const now = Date.now();
  e.STATION.rows.set(id, {
    id, dj: "hank", normalized: "x", state: "claimed",
    created_at: now - ageMs, updated_at: now - 1000, lease_until: now - 1,
    fingerprint: "fp", write_started: 0, claim_token: "t", claim_count: 1,
    playlist_id: null, track_count: null, runtime_ms: null,
    attention_code: null, decline_reason: null, suggested_dj: null,
  });
  return e.PROGRAMS.put(`request:${id}`, JSON.stringify({
    id, dj: "hank", mood: "soul from Stax", length: 90, avoid: null, keep: true,
    at: new Date(now - ageMs).toISOString() }));
}
function routineSpy() {
  const rings = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.anthropic.com") {
      rings.push(JSON.parse(String(init.body ?? "{}")).text);
      return Response.json({ type: "routine_fire" });
    }
    return realFetch(url, init);
  };
  return { rings, restore: () => { globalThis.fetch = realFetch; } };
}

test("a page view over a dead claim rings the curator again, once", async () => {
  const e = pipeEnv();
  await deadClaim(e, "r-dead", 12 * 60 * 1000);
  const f = installFetch({ contents: [track("t1")] });
  const spy = routineSpy();
  try {
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.deepEqual(spy.rings, ["request r-dead (again)"], "one ring, marked again");
    const rec = await e.PROGRAMS.get("request:r-dead", { type: "json" });
    assert.equal(rec.nudges.length, 1, "stamped on the record");
    assert.equal(rec.mood, "soul from Stax", "the record is otherwise intact");
    // A refresh a moment later does not ring again: ten minutes between rings.
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.equal(spy.rings.length, 1, "not twice inside ten minutes");
  } finally { spy.restore(); f.restore(); }
});

test("three rings and no more; a fresh request is not rung again at all yet", async () => {
  const e = pipeEnv();
  await deadClaim(e, "r-dead", 40 * 60 * 1000);
  const rec = await e.PROGRAMS.get("request:r-dead", { type: "json" });
  const ago = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
  await e.PROGRAMS.put("request:r-dead", JSON.stringify({ ...rec, nudges: [ago(35), ago(24), ago(13)] }));
  const f = installFetch({ contents: [track("t1")] });
  const spy = routineSpy();
  try {
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.equal(spy.rings.length, 0, "the sweep is the backstop after three");
    // And an unpicked request under twenty minutes old is left to its first ring.
    await worker.fetch(askPost("hank", { mood: "just asked", length: "60" }), e);
    spy.rings.length = 0;
    e.STATION.rows.delete("r-dead");
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.equal(spy.rings.length, 0, "no ring for a request seconds old");
  } finally { spy.restore(); f.restore(); }
});

test("a request nobody picked up in fifteen minutes says so, and rings", async () => {
  const e = pipeEnv();
  const now = Date.now();
  e.STATION.rows.set("r-slow", {
    id: "r-slow", dj: "hank", normalized: "x", state: "pending",
    created_at: now - 20 * 60 * 1000, updated_at: now - 20 * 60 * 1000, lease_until: null,
    fingerprint: null, write_started: 0, claim_token: null, claim_count: 0,
    playlist_id: null, track_count: null, runtime_ms: null,
    attention_code: null, decline_reason: null, suggested_dj: null,
  });
  await e.PROGRAMS.put("request:r-slow", JSON.stringify({ id: "r-slow", dj: "hank", mood: "m", length: 60, avoid: null, keep: false, at: new Date(now - 20 * 60 * 1000).toISOString() }));
  const f = installFetch({ contents: [track("t1")] });
  const spy = routineSpy();
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /<span class="reqword">taking longer<\/span>/);
    assert.match(html, /Taking longer than usual/);
    assert.ok(!html.includes("Usually ready in five to fifteen minutes"), "a promise that has already lapsed is not repeated");
    assert.match(html, /request\/dismiss/);
    assert.deepEqual(spy.rings, ["request r-slow (again)"]);
  } finally { spy.restore(); f.restore(); }
});

test("an unpicked request ten minutes old is not rung again: its run may still be researching", async () => {
  // 2026-10-15: Gatefold's Ray Charles run read album pages for twelve
  // minutes before fulfill_request claimed the request, and the three-minute
  // re-ring woke a second run that curated the same request.
  const e = pipeEnv();
  const now = Date.now();
  e.STATION.rows.set("r-busy", {
    id: "r-busy", dj: "hank", normalized: "x", state: "pending",
    created_at: now - 10 * 60 * 1000, updated_at: now - 10 * 60 * 1000, lease_until: null,
    fingerprint: null, write_started: 0, claim_token: null, claim_count: 0,
    playlist_id: null, track_count: null, runtime_ms: null,
    attention_code: null, decline_reason: null, suggested_dj: null,
  });
  await e.PROGRAMS.put("request:r-busy", JSON.stringify({ id: "r-busy", dj: "hank", mood: "m", length: 60, avoid: null, keep: true, at: new Date(now - 10 * 60 * 1000).toISOString() }));
  const f = installFetch({ contents: [track("t1")] });
  const spy = routineSpy();
  try {
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.equal(spy.rings.length, 0, "no second run while the first may still be reading");
  } finally { spy.restore(); f.restore(); }
});

test("a failed record write rolls the acceptance back instead of stranding the slot", async () => {
  const e = reqEnv();
  const realPut = e.PROGRAMS.put.bind(e.PROGRAMS);
  e.PROGRAMS.put = async (k, ...rest) => {
    if (k.startsWith("request:")) throw new Error("kv down");
    return realPut(k, ...rest);
  };
  const res = await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=unavailable`);

  e.PROGRAMS.put = realPut;
  const retry = await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  assert.equal(retry.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`,
    "the DJ's slot was not left blocked by a request nobody can read");
});

test("control characters are stripped before anything is stored", async () => {
  const e = reqEnv();
  const res = await worker.fetch(askPost("hank",
    { mood: "tra\tins \u001b[31mand\u0000rain", length: "60" }), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`);
  const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
    body: JSON.stringify({ op: "list", args: { dj: "hank" } }) })).text());
  const rec = await e.PROGRAMS.get(`request:${listed.rows[0].id}`, { type: "json" });
  assert.equal(rec.mood, "tra ins [31mand rain");
});


test("a dead claim past mark-write is sorted out, not called unmade", async () => {
  const e = reqEnv();
  const now = Date.now();
  e.STATION.rows.set("r-post", {
    id: "r-post", dj: "hank", normalized: "x", state: "claimed",
    created_at: now - 1000, updated_at: now - 1000, lease_until: now - 1,
    fingerprint: "fp", write_started: 1, claim_token: "t", claim_count: 1,
    playlist_id: null, track_count: null, runtime_ms: null,
    attention_code: null, decline_reason: null, suggested_dj: null,
  });
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /being sorted out/);
    assert.ok(!html.includes("has not made this set yet"),
      "the write may have landed; saying otherwise contradicts the ledger");
  } finally { f.restore(); }
});

test("the refresh survives a good play but yields to a retry or an undo", async () => {
  const e = reqEnv();
  await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  const f = installFetch({ contents: [track("t1")] });
  try {
    const okPlay = await (await worker.fetch(
      get(`/buttons/${KEY}/hank?played=ok&on=Everywhere`), e)).text();
    assert.match(okPlay, /http-equiv="refresh"/,
      "nothing on an ok page needs preserving; the verdict still matters");
    const withUndo = await (await worker.fetch(
      get(`/buttons/${KEY}/hank?put=x&undo=snap:${"0".repeat(22)}:1`), e)).text();
    assert.ok(!withUndo.includes('http-equiv="refresh"'),
      "refreshing away the undo form removes the recovery for a destructive write");
  } finally { f.restore(); }
});

test("an unreadable record still shows the card, never the composer", async () => {
  const e = reqEnv();
  await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  const realGet = e.PROGRAMS.get.bind(e.PROGRAMS);
  e.PROGRAMS.get = async (k, ...rest) => {
    if (String(k).startsWith("request:")) throw new Error("kv down");
    return realGet(k, ...rest);
  };
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Your request/);
    assert.ok(!html.includes('class="reqform askcard"'),
      "the ledger would refuse the form; offering it is a bounce dressed as an invitation");
  } finally { f.restore(); }
});

test("a mood made of invisible characters is blank", async () => {
  const e = reqEnv();
  const res = await worker.fetch(askPost("hank",
    { mood: "\u200b\u200b\ufeff", length: "60" }), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=blank`);
});


// ------------------------------------------------------- the wake-up event
// MC-05: the curator rung with the request's id only, best-effort (by web
// call since 2026-10-16; the GitHub commit before it went on 2026-10-23).

function pipeEnv() {
  const e = reqEnv();
  e.AUTOFULFILL_ENABLED = "true";
  e.REQUEST_ROUTINE_ID = "trig_test";
  e.REQUEST_ROUTINE_TOKEN = "routine-token";
  return e;
}

test("a submission rings the curator once with its opaque id — and no text travels", async () => {
  const e = pipeEnv();
  const f = installFetch();
  const rung = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.anthropic.com") {
      rung.push({ url: String(url), body: String(init.body ?? ""),
        auth: init.headers?.authorization ?? "" });
      return Response.json({ type: "routine_fire" });
    }
    return realFetch(url, init);
  };
  try {
    const res = await worker.fetch(askPost("hank",
      { mood: "very secret family words", length: "60" }), e);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`);
    assert.equal(rung.length, 1, "one ring per submission");
    assert.match(rung[0].url, /\/v1\/claude_code\/routines\/trig_test\/fire$/);
    assert.equal(rung[0].auth, "Bearer routine-token");
    assert.ok(!rung[0].url.includes("secret") && !rung[0].body.includes("secret"),
      "the words never leave the house — not in the URL, not in the body");
    const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
      body: JSON.stringify({ op: "list", args: { dj: "hank" } }) })).text());
    assert.deepEqual(JSON.parse(rung[0].body), { text: `request ${listed.rows[0].id}` },
      "the payload is the id and nothing else");
  } finally {
    globalThis.fetch = realFetch;
    f.restore();
  }
});

test("a refused submission emits nothing — dedupe that re-fired would spend sessions", async () => {
  const e = pipeEnv();
  const rung = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.anthropic.com") {
      rung.push(1);
      return Response.json({ type: "routine_fire" });
    }
    return realFetch(url, init);
  };
  try {
    await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
    await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
    await worker.fetch(askPost("hank", { mood: "boats", length: "60" }), e);
    assert.equal(rung.length, 1, "the double tap and the busy refusal fired nothing");
  } finally { globalThis.fetch = realFetch; }
});

test("a failed emit keeps the request pending and flags the record", async () => {
  const e = pipeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.anthropic.com") return new Response("nope", { status: 500 });
    return realFetch(url, init);
  };
  try {
    const res = await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`,
      "the request is accepted; the pipe degrades to the sweep, never to loss");
    const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
      body: JSON.stringify({ op: "list", args: { dj: "hank" } }) })).text());
    assert.equal(listed.rows[0].state, "pending");
    const rec = await e.PROGRAMS.get(`request:${listed.rows[0].id}`, { type: "json" });
    assert.equal(rec.dispatch, "failed");
  } finally { globalThis.fetch = realFetch; }
});

test("the autofulfillment switch off means no ring at all", async () => {
  const e = pipeEnv();
  e.AUTOFULFILL_ENABLED = "false";
  const rung = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.anthropic.com") { rung.push(1); return Response.json({ type: "routine_fire" }); }
    return realFetch(url, init);
  };
  try {
    const res = await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`);
    assert.equal(rung.length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("a missing token emits nothing and still accepts the request", async () => {
  const e = pipeEnv();
  delete e.REQUEST_ROUTINE_TOKEN;
  const res = await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`);
  const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
    body: JSON.stringify({ op: "list", args: { dj: "hank" } }) })).text());
  const rec = await e.PROGRAMS.get(`request:${listed.rows[0].id}`, { type: "json" });
  assert.equal(rec.dispatch, "failed", "unconfigured reads as a failed dispatch, honestly");
});

test("a thrown doorbell fetch is a failed dispatch, with the record intact", async () => {
  const e = pipeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "api.anthropic.com") throw new Error("network down");
    return realFetch(url, init);
  };
  try {
    const res = await worker.fetch(askPost("hank",
      { mood: "slow trains", length: "90", avoid: "brass" }), e);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=sent`);
    const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
      body: JSON.stringify({ op: "list", args: { dj: "hank" } }) })).text());
    const rec = await e.PROGRAMS.get(`request:${listed.rows[0].id}`, { type: "json" });
    assert.equal(rec.dispatch, "failed");
    assert.equal(rec.mood, "slow trains", "the flag re-put loses nothing");
    assert.equal(rec.length, 90);
    assert.equal(rec.avoid, "brass");
  } finally { globalThis.fetch = realFetch; }
});


// ------------------------------------------------- the lifecycle's endings
// MC-06: Ready only when the LIVE sequence still matches; superseded derived
// from the ask pointer; attention and pending get their exits.

const HANKP = P(2); // hank's button 2 in this suite's aliases

function seedRow(e, over = {}) {
  const now = Date.now();
  const id = over.id ?? "r-l1";
  e.STATION.rows.set(id, {
    id, dj: "hank", normalized: "x", state: "ready",
    created_at: now - 5000, updated_at: now - 1000, lease_until: null,
    fingerprint: null, write_started: 1, claim_token: null, claim_count: 1,
    playlist_id: HANKP, track_count: 2, runtime_ms: 400000,
    attention_code: null, decline_reason: null, suggested_dj: null, ...over,
  });
  e.PROGRAMS.put(`request:${id}`, JSON.stringify({
    id, dj: "hank", mood: "quiet piano", length: 60, avoid: null,
    at: "2026-09-01T06:00:00Z",
  }));
  return id;
}

test("Ready renders only while the live sequence still matches the fulfilled one", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  const fp = await fingerprintUris(["spotify:track:a", "spotify:track:b"]);
  const id = seedRow(e, { fingerprint: fp });
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({
    requestId: id, text: "quiet piano — about 60 min", at: "2026-09-01" }));
  const f = installFetch({ contents: [track("a"), track("b")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // A ready request nobody marked to keep settles SILENTLY: the ask shows
    // on the button card and the set is the tracklist — a status box on top
    // of that is paperwork about a finished transaction. The absence of a
    // card here is itself the derivation's positive reading: every non-ready
    // outcome of the same check (changed, superseded, unverified) still
    // renders one, and those are pinned by the tests below.
    assert.ok(!html.includes("Your request"), "a happy ending needs no card");
    assert.match(html, /quiet piano — about 60 min/, "the ask still tells the story, once");
    assert.match(html, /The ask/);
    assert.ok(!html.includes('http-equiv="refresh"'), "a settled page sits still");
    assert.match(html, /class="reqform askcard"/, "a finished story never blocks the next ask");
  } finally { f.restore(); }
});

test("an append after fulfilment demotes Ready to changed-since", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  const fp = await fingerprintUris(["spotify:track:a", "spotify:track:b"]);
  const id = seedRow(e, { fingerprint: fp });
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({ requestId: id, text: "t" }));
  const f = installFetch({ contents: [track("a"), track("b"), track("intruder")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /the playlist has changed since/);
    assert.ok(!html.includes("Ready —"), "the word Ready is earned, not stored");
  } finally { f.restore(); }
});

test("a moved pointer plus a different sequence reads as superseded", async () => {
  const e = reqEnv();
  const id = seedRow(e, { fingerprint: "fp-of-the-old-set" });
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({
    requestId: "some-newer-request", text: "another ask" }));
  const f = installFetch({ contents: [track("theirs")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // Since 2026-09-05 a superseded request gets no row at all: another set
    // has taken the preset, the kept page is on the shelf, and a sentence
    // saying so was clutter. What must NOT happen is the page calling it
    // anything else.
    assert.ok(!html.includes("Another set has taken the preset"));
    assert.ok(!html.includes('class="reqrow'), "no request row for a superseded request");
    assert.ok(!/Ready — |has changed since|could not be fully checked/.test(html));
  } finally { f.restore(); }
});

test("an unreadable playlist cannot claim Ready", async () => {
  const e = reqEnv();
  const id = seedRow(e, { fingerprint: "fp" });
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({ requestId: id, text: "t" }));
  const f = installFetch({ contents: [track("a")],
    fail: { [`GET /playlists/${HANKP}/items`]: "read down" } });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /could not be fully checked just now/);
    assert.ok(!html.includes("Ready —"));
  } finally { f.restore(); }
});

test("needs-attention renders recovery copy and its acknowledge exit", async () => {
  const e = env(); // switch OFF on purpose: the exits outlive the entrance
  const id = seedRow(e, { state: "needs-attention", attention_code: "verify-mismatch" });
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Needs attention — the result of making this set is uncertain/);
    assert.match(html, /Any write that did happen took a backup/);
    assert.match(html, new RegExp(`action="/buttons/${KEY}/hank/request/ack"`));
  } finally { f.restore(); }

  const res = await worker.fetch(post(`/buttons/${KEY}/hank/request/ack`,
    form({ request_id: id })), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=acked`);
  assert.equal(e.STATION.rows.get(id).state, "dismissed");
});

test("a pending card's withdrawal works, and the card then says nothing", async () => {
  const e = reqEnv();
  const id = seedRow(e, { state: "pending", write_started: 0 });
  const res = await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: id })), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=dismissed`);
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank?ask=dismissed`), e)).text();
    assert.match(html, /The request was withdrawn/);
    assert.ok(!html.includes("Your request"), "a dismissed request says nothing");
    assert.match(html, /class="reqform askcard"/, "and the composer returns");
  } finally { f.restore(); }
});

test("the exits hold their boundaries: method, origin, ownership, mid-flight", async () => {
  const e = reqEnv();
  const id = seedRow(e, { state: "pending", write_started: 0 });

  assert.equal((await worker.fetch(get(`/buttons/${KEY}/hank/request/dismiss`), e)).status, 405);
  assert.equal((await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: id }), { origin: "https://evil.test" }), e)).status, 403);

  // A forged id cannot reach another DJ's request through this page's form.
  const other = seedRow(e, { id: "r-other", state: "pending", write_started: 0 });
  e.STATION.rows.get("r-other").dj = "vibe";
  const forged = await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: "r-other" })), e);
  assert.equal(forged.headers.get("location"), `/buttons/${KEY}/hank?ask=gone`);
  assert.equal(e.STATION.rows.get("r-other").state, "pending", "untouched");

  // Claimed means someone is working: withdrawal refuses honestly.
  const busy = seedRow(e, { id: "r-busy", state: "claimed", claim_token: "t",
    fingerprint: "fp", write_started: 0, lease_until: Date.now() + 600000 });
  const mid = await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: "r-busy" })), e);
  assert.equal(mid.headers.get("location"), `/buttons/${KEY}/hank?ask=working`);

  // A request that vanished answers gone, never a crash.
  const ghost = await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: "never-was" })), e);
  assert.equal(ghost.headers.get("location"), `/buttons/${KEY}/hank?ask=gone`);
});

test("a declined card speaks in the DJ's voice and points at the right room", async () => {
  const e = reqEnv();
  seedRow(e, { state: "declined", decline_reason: "Not my records, friend.",
    suggested_dj: "dr-funkenstein" });
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Hank passed on this one/);
    assert.match(html, /Not my records, friend\./);
    assert.match(html, new RegExp(`href="/buttons/${KEY}/dr-funkenstein"`));
    assert.match(html, /Take it to Dr\. Funkenstein/);
  } finally { f.restore(); }
});

test("a suggested DJ the roster does not know gets no link", async () => {
  const e = reqEnv();
  seedRow(e, { state: "declined", decline_reason: "pass",
    suggested_dj: "dj-nobody" });
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Hank passed on this one/);
    assert.ok(!html.includes("Take it to"), "no link is invented for a name the roster lacks");
  } finally { f.restore(); }
});


test("clearing the newest card never revives an older story", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  seedRow(e, { id: "r-old", state: "ready",
    fingerprint: await fingerprintUris(["spotify:track:a"]) });
  const newer = seedRow(e, { id: "r-new", state: "pending", write_started: 0 });
  e.STATION.rows.get("r-new").created_at = Date.now();
  await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: newer })), e);
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(!html.includes("Your request"),
      "the page said cleared; an older ready card reappearing would call it a liar");
  } finally { f.restore(); }
});

test("a pointer that could not be read is an outage, never a supersession", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  const fp = await fingerprintUris(["spotify:track:a"]);
  const id = seedRow(e, { fingerprint: fp });
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({ requestId: id, text: "t" }));
  const realGet = e.PROGRAMS.get.bind(e.PROGRAMS);
  e.PROGRAMS.get = async (k, ...rest) => {
    if (String(k).startsWith("ask:")) throw new Error("kv down");
    return realGet(k, ...rest);
  };
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // The sequence still matches, and the sequence is the proof: Ready
    // stands on the fingerprint alone. The unreadable pointer also takes the
    // premise with it, so the card stays to carry the listener's words — a
    // quiet page here would drop them entirely. What the outage must never
    // produce is "another set has taken the button".
    assert.match(html, /Ready — /,
      "derived ready, shown loud because the premise could not be read");
    assert.match(html, /quiet piano/, "the ask survives the lost pointer");
    assert.ok(!html.includes("Another set has taken the preset"),
      "an outage must not dress up as a fact");
  } finally { f.restore(); }
});

test("a mismatch with an unreadable pointer refuses to guess which story it is", async () => {
  const e = reqEnv();
  seedRow(e, { fingerprint: "fp-that-will-not-match" });
  const realGet = e.PROGRAMS.get.bind(e.PROGRAMS);
  e.PROGRAMS.get = async (k, ...rest) => {
    if (String(k).startsWith("ask:")) throw new Error("kv down");
    return realGet(k, ...rest);
  };
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /could not be fully checked just now/);
    assert.ok(!html.includes("Another set has taken the preset"));
    assert.ok(!html.includes("has changed since"));
  } finally { f.restore(); }
});

test("a lost ask pointer with a matching sequence still reads Ready", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  seedRow(e, { fingerprint: await fingerprintUris(["spotify:track:a"]) });
  // No ask: record at all — both best-effort writes failed at fulfilment.
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // Both best-effort writes failed, so the button card has no premise to
    // carry the ask — the request card stays for exactly that reason: quiet
    // is only allowed while the page still tells the story.
    assert.match(html, /Ready — /,
      "the sequence is the proof; the label was only a label");
    assert.match(html, /quiet piano/,
      "the listener's words survive on the card the lost pointer cannot feed");
    assert.ok(!html.includes("could not be fully checked"),
      "and a lost label is not an outage");
  } finally { f.restore(); }
});

test("an unreadable keep flag keeps the ready card showing, never quiet", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  const id = seedRow(e, { fingerprint: await fingerprintUris(["spotify:track:a"]) });
  // The record is down. `keep` reads as false, but false-off-an-outage is
  // not a decision — and a ticked box must not have its pending shelf work
  // hidden until KV recovers. Unknown degrades loud.
  const realGet = e.PROGRAMS.get.bind(e.PROGRAMS);
  e.PROGRAMS.get = async (k, ...rest) => {
    if (String(k).startsWith("request:")) throw new Error("kv down");
    return realGet(k, ...rest);
  };
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Your request/);
    assert.match(html, /Ready — /);
  } finally { f.restore(); }
});

test("a truncated live read never calls its prefix the whole tracklist", () => {
  const tracks = Array.from({ length: 200 }, (_, i) => ({
    n: i + 1, title: `T${i + 1}`, artists: "A", dur: "3:00" }));
  const html = renderDjRoom({
    base: "/buttons/k", notesHref: "/notes/k",
    dj: { key: "hank", name: "Hank", btn: 2, unit: "tracks", summary: "s" },
    tile: { name: "Hank", count: 300, runtime: "15:00:00", cover: null },
    tracks, premise: null, shelf: null, devices: ["Pro Plus"],
    defaultDevice: "Pro Plus", flash: null, archive: false,
    lastLoaded: { title: "Big", href: "#", slug: "big-111aaa" },
    asks: null, problem: null,
  });
  assert.match(html, /Tracklist · first 200 of 300/,
    "the fold's count must not contradict the facts line above it");

  // The same honesty with no program loaded: the open list carries the
  // qualifier instead of presenting a prefix as the whole set.
  const open = renderDjRoom({
    base: "/buttons/k", notesHref: "/notes/k",
    dj: { key: "hank", name: "Hank", btn: 2, unit: "tracks", summary: "s" },
    tile: { name: "Hank", count: 300, runtime: "15:00:00", cover: null },
    tracks, premise: null, shelf: null, devices: ["Pro Plus"],
    defaultDevice: "Pro Plus", flash: null, archive: false,
    lastLoaded: null, asks: null, problem: null,
  });
  assert.match(open, /First 200 of 300/);
});

test("an abandoned claim withdraws for real, end to end", async () => {
  const e = reqEnv();
  const id = seedRow(e, { state: "claimed", write_started: 0,
    claim_token: "t", fingerprint: "fp", lease_until: Date.now() - 1 });
  const res = await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: id })), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=dismissed`);
  assert.equal(e.STATION.rows.get(id).state, "dismissed");
});

test("a ledger outage during an exit says try-again, not moved-on", async () => {
  const e = reqEnv();
  const id = seedRow(e, { state: "pending", write_started: 0 });
  const realGet = e.STATION.get.bind(e.STATION);
  e.STATION.get = () => {
    const stub = realGet();
    const realStubFetch = stub.fetch;
    stub.fetch = async (url, init) => {
      if (JSON.parse(init.body).op === "dismiss") throw new Error("ledger down");
      return realStubFetch(url, init);
    };
    return stub;
  };
  const res = await worker.fetch(post(`/buttons/${KEY}/hank/request/dismiss`,
    form({ request_id: id })), e);
  assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?ask=exitfail`);
  assert.equal(e.STATION.rows.get(id).state, "pending", "nothing changed, as the flash says");
});


test("an emptied playlist after fulfilment is an edit, not an outage", async () => {
  const e = reqEnv();
  const id = seedRow(e, { fingerprint: "fp-of-the-fulfilled-set" });
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({ requestId: id, text: "t" }));
  const f = installFetch({ contents: [] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /has changed since/,
      "the read succeeded and found nothing — that is a change, honestly told");
    assert.ok(!html.includes("could not be fully checked"));
  } finally { f.restore(); }
});

test("a kept set is linked from its own card, and only once the page exists", async () => {
  const seed = (over) => {
    const e = reqEnv();
    const now = Date.now();
    e.STATION.rows.set("r-kept", {
      id: "r-kept", dj: "hank", normalized: "x", state: "ready",
      created_at: now, updated_at: now, lease_until: null, fingerprint: "fp",
      write_started: 1, claim_token: null, claim_count: 1, playlist_id: null,
      track_count: 12, runtime_ms: 600000, attention_code: null,
      decline_reason: null, suggested_dj: null, ...over,
    });
    e.PROGRAMS.put("request:r-kept", JSON.stringify({
      id: "r-kept", dj: "hank", mood: "the annual party", length: 90,
      avoid: null, keep: true, at: new Date().toISOString() }));
    // The ask pointer names this request, so a live playlist that differs
    // from the fulfilled one reads as "changed since" — a row — rather than
    // superseded, which since 2026-09-05 shows nothing. The link under test
    // rides on the row.
    e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({ requestId: "r-kept", text: "the annual party" }));
    return e;
  };

  const kept = seed({ kept_slug: "the-annual-party-ab12cd", kept_at: Date.now() });
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), kept)).text();
    // Inside the app the kept page is the keyed one, with a way back here (MC-14).
    assert.match(html, /href="\/buttons\/[^"]+\/programs\/the-annual-party-ab12cd\?from=hank"/);
    assert.match(html, /On the shelf/);
  } finally { f.restore(); }

  // Reserved but never committed: a page may not have been written, and a
  // link that 404s is worse than no link.
  const reserved = seed({ kept_slug: "the-annual-party-ab12cd", kept_at: null });
  const f2 = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), reserved)).text();
    assert.ok(!html.includes("the-annual-party-ab12cd"), "no link to a page that may not be there");
    assert.match(html, /Marked to keep/);
  } finally { f2.restore(); }
});

// --- taking a kept set off the shelf ---------------------------------------

async function seedKept(e, { slug = "the-annual-party-ab12cd", requestId = "r-kept",
  playlistId = "PL1", pointer = true } = {}) {
  const now = Date.now();
  e.STATION.rows.set(requestId, {
    id: requestId, dj: "hank", normalized: "x", state: "ready",
    created_at: now, updated_at: now, lease_until: null, fingerprint: "fp",
    write_started: 1, claim_token: null, claim_count: 1, playlist_id: playlistId,
    track_count: 2, runtime_ms: 400000, attention_code: null,
    decline_reason: null, suggested_dj: null, kept_slug: slug, kept_at: now,
  });
  await e.PROGRAMS.put(`program:${slug}`, JSON.stringify({
    slug, shape: "setlist", title: "The Annual Party", dj: "Hank",
    thesis: "Loud.", playlistId, requestId, sections: [], tracks: 2,
  }), { metadata: { title: "The Annual Party", dj: "Hank", shape: "setlist",
    created: "2026-09-01T00:00:00Z", tracks: 2, runtime: "6:40" } });
  if (pointer) await e.PROGRAMS.put(`current:${playlistId}`, slug);
  return slug;
}

test("taking a set off the shelf deletes the page, the pointer and the ledger's memory", async () => {
  const e = reqEnv();
  const slug = await seedKept(e);

  const res = await worker.fetch(
    post(`/notes/${KEY}/unkeep`, form({ slug })), e);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), `/notes/${KEY}?put=removed`);

  assert.ok(!(await e.PROGRAMS.get(`program:${slug}`)), "the page is gone");
  assert.ok(!(await e.PROGRAMS.get("current:PL1")),
    "and the pointer with it — otherwise the DJ page links a 404");
  const row = e.STATION.rows.get("r-kept");
  assert.equal(row.kept_slug, null, "the card stops offering a dead link");
  assert.ok(row.kept_at,
    "but the keep stays SETTLED, or the hourly sweep republishes what was just deleted");
});

test("a pointer naming something else survives the delete", async () => {
  const e = reqEnv();
  const slug = await seedKept(e, { pointer: false });
  await e.PROGRAMS.put("current:PL1", "some-other-set");
  await worker.fetch(post(`/notes/${KEY}/unkeep`, form({ slug })), e);
  assert.equal(await e.PROGRAMS.get("current:PL1"), "some-other-set",
    "only a pointer AT this page is cleared by removing it");
});

test("an essay is deleted from the shelf too, the way the app deletes one", async () => {
  const e = reqEnv();
  await seedProgram(e, "an-argument", { title: "An Argument" });
  const res = await worker.fetch(
    post(`/notes/${KEY}/unkeep`, form({ slug: "an-argument" })), e);
  assert.equal(res.headers.get("location"), `/notes/${KEY}?put=removed`);
  assert.equal(await e.PROGRAMS.get("program:an-argument"), null, "the page is gone");
});

test("unkeep keeps the key, the POST and the origin discipline", async () => {
  const e = reqEnv();
  await seedKept(e);
  const wrong = await worker.fetch(
    post(`/notes/wrongwrongwrong1/unkeep`, form({ slug: "x" })), e);
  assert.equal(wrong.status, 404);
  assert.equal(await wrong.text(), "not found");

  assert.equal((await worker.fetch(get(`/notes/${KEY}/unkeep`), e)).status, 405);

  const foreign = await worker.fetch(post(`/notes/${KEY}/unkeep`,
    form({ slug: "the-annual-party-ab12cd" }), { origin: "https://evil.test" }), e);
  assert.equal(foreign.status, 403);
  assert.ok(await e.PROGRAMS.get("program:the-annual-party-ab12cd"),
    "a refused form changes nothing");
});

test("a kept set on its own button folds into the card, delete and all", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  await seedKept(e, { playlistId: P(2) });
  const row = e.STATION.rows.get("r-kept");
  e.STATION.rows.set("r-kept", { ...row,
    fingerprint: await fingerprintUris(["spotify:track:t1"]) });
  e.PROGRAMS.put("request:r-kept", JSON.stringify({
    id: "r-kept", dj: "hank", mood: "the annual party", length: 90,
    avoid: null, keep: true, at: new Date().toISOString() }));
  // The ask pointer, as fulfilment writes it: the card retires only when the
  // premise standing in for it is demonstrably THIS request's story.
  await e.PROGRAMS.put(`ask:${P(2)}`, JSON.stringify({
    requestId: "r-kept", text: "the annual party — about 90 min",
    at: "2026-09-01" }));
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // The story ended well, so the request card retires: the button card says
    // everything it said — title, page, ask, delete — without a status box
    // about a finished transaction sitting above Play.
    assert.ok(!html.includes("Your request"));
    assert.match(html, /the annual party — about 90 min/,
      "the words that asked for it stay on the page");
    // The block names it (2026-09-11), in the present tense the live
    // fingerprint earned — no qualifier.
    assert.match(html, /<p class="vload"><span class="vtag">Now loaded · <\/span>The Annual Party<\/p>/);
    assert.ok(!html.includes("Last loaded here"));
    // The delete still exists, still says what it costs, and the words still
    // come BEFORE the button — guaranteed by the fold: nobody can see the
    // control without opening the sentence that warns about it. Since
    // 2026-09-11 it rode on the SHELF ROW it deletes; since board A
    // (2026-09-25) the row is a card, and the delete is on the page the card
    // opens — the program's own, as on the Shelf since 2026-09-23.
    assert.ok(!html.includes("Take it off the shelf"), "not on the DJ page");
    assert.ok(!html.includes(`action="/notes/${KEY}/unkeep"`));
    const grid = html.slice(html.indexOf('<ul class="djgrid">'));
    assert.ok(grid.includes(`<a href="/buttons/${KEY}/programs/the-annual-party-ab12cd?from=hank">The Annual Party</a>`),
      "the card opens the page that carries it");
    const own = await (await worker.fetch(get(`/buttons/${KEY}/programs/the-annual-party-ab12cd?from=hank`), e)).text();
    assert.match(own, new RegExp(`action="/notes/${KEY}/unkeep"`));
    assert.match(own, /<input type="hidden" name="slug" value="the-annual-party-ab12cd">/);
    assert.match(own, /There is no undo\./);
    assert.ok(own.indexOf("There is no undo.") < own.indexOf("Delete for good</button>"),
      "the warning is on the way to the control, not underneath it");
    // And the route still lands back on the DJ's page when told to.
    const gone = await worker.fetch(post(`/notes/${KEY}/unkeep`,
      form({ slug: "the-annual-party-ab12cd", return: "hank" })), e);
    assert.equal(gone.status, 303);
    assert.equal(gone.headers.get("location"), `/buttons/${KEY}/hank?put=removed`);
  } finally { f.restore(); }
});

test("a kept essay on its own button offers the delete too", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  await seedKept(e, { playlistId: P(2) });
  // The same page, but the kept program is a writer's essay: since
  // 2026-09-13 the endpoint deletes it too, so the row offers the reach.
  await e.PROGRAMS.put("program:the-annual-party-ab12cd", JSON.stringify({
    slug: "the-annual-party-ab12cd", shape: "session", title: "The Annual Party",
    dj: "Hank", thesis: "Loud.", playlistId: P(2), requestId: "r-kept",
    sections: [], tracks: 2,
  }), { metadata: { title: "The Annual Party", dj: "Hank", shape: "session",
    created: "2026-09-01T00:00:00Z", tracks: 2, runtime: "6:40" } });
  const row = e.STATION.rows.set("r-kept", {
    ...e.STATION.rows.get("r-kept"),
    fingerprint: await fingerprintUris(["spotify:track:t1"]) });
  e.PROGRAMS.put("request:r-kept", JSON.stringify({
    id: "r-kept", dj: "hank", mood: "the annual party", length: 90,
    avoid: null, keep: true, at: new Date().toISOString() }));
  await e.PROGRAMS.put(`ask:${P(2)}`, JSON.stringify({
    requestId: "r-kept", text: "the annual party — about 90 min",
    at: "2026-09-01" }));
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(!html.includes("Your request"), "merged — the fold applies");
    assert.match(html, /<p class="vload"><span class="vtag">Now loaded · <\/span>The Annual Party<\/p>/);
    // From the page its card opens, since board A (2026-09-25).
    assert.ok(html.includes(`/buttons/${KEY}/programs/the-annual-party-ab12cd?from=hank`));
    const own = await (await worker.fetch(get(`/buttons/${KEY}/programs/the-annual-party-ab12cd?from=hank`), e)).text();
    assert.match(own, /Deletes this program for good/, "written programs are deleted from there too");
    assert.ok(own.includes(`action="/notes/${KEY}/unkeep"`));
  } finally { f.restore(); }
});

test("a lost ask pointer cannot retire a card into silence", async () => {
  // The kept record carries its own copy of the words, so the merge survives
  // the pointer's loss; and when even that copy is gone, the card stays.
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  await seedKept(e, { playlistId: P(2) });
  e.STATION.rows.set("r-kept", { ...e.STATION.rows.get("r-kept"),
    fingerprint: await fingerprintUris(["spotify:track:t1"]) });
  e.PROGRAMS.put("request:r-kept", JSON.stringify({
    id: "r-kept", dj: "hank", mood: "the annual party", length: 90,
    avoid: null, keep: true, at: new Date().toISOString() }));
  // No ask: pointer at all — but the kept page stored the ask at keep time.
  await e.PROGRAMS.put("program:the-annual-party-ab12cd", JSON.stringify({
    slug: "the-annual-party-ab12cd", shape: "setlist", title: "The Annual Party",
    dj: "Hank", thesis: "Loud.", playlistId: P(2), requestId: "r-kept",
    sections: [], tracks: 2,
    ask: { text: "the annual party — about 90 min", at: "2026-09-01" },
  }), { metadata: { title: "The Annual Party", dj: "Hank", shape: "setlist",
    created: "2026-09-01T00:00:00Z", tracks: 2, runtime: "6:40" } });
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(!html.includes("Your request"),
      "the record's own copy of the ask stands in for the lost pointer");
    assert.match(html, /the annual party — about 90 min/);
    assert.match(html, /The ask/);
  } finally { f.restore(); }
});

test("a stale program premise cannot quietly stand in for the ask", async () => {
  const e = reqEnv();
  const { fingerprintUris } = await import("../station.js");
  // A plain fulfilment landed (live sequence matches the row), but a stale
  // `current:` pointer still names an old program — its gist is a story
  // about something else, and retiring the card against it would swap the
  // listener's words for it.
  const id = seedRow(e, { fingerprint: await fingerprintUris(["spotify:track:a"]) });
  await seedProgram(e, "old-prog-1a2b3c", {
    title: "Old Story", thesis: "A premise about something else entirely." });
  await e.PROGRAMS.put(`current:${HANKP}`, "old-prog-1a2b3c");
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Your request/);
    assert.match(html, /Ready — /);
    assert.match(html, /quiet piano/, "the listener's words stay on the page");
  } finally { f.restore(); }
});

test("a card whose set was taken off the shelf says so, and promises nothing", async () => {
  const e = reqEnv();
  await seedKept(e);
  const row = e.STATION.rows.get("r-kept");
  e.STATION.rows.set("r-kept", { ...row, kept_slug: null });
  // And the page really is gone: unkeep deletes the record, so the shelf has
  // no row for it either. The fixture used to leave the record behind, which
  // stopped mattering the day the delete moved onto the row (2026-09-11).
  await e.PROGRAMS.delete("program:the-annual-party-ab12cd");
  e.PROGRAMS.put("request:r-kept", JSON.stringify({
    id: "r-kept", dj: "hank", mood: "the annual party", length: 90,
    avoid: null, keep: true, at: new Date().toISOString() }));
  // The ask pointer names this request, so a live playlist that differs from
  // the fulfilled one reads as "changed since" — a row — rather than
  // superseded, which since 2026-09-05 shows nothing. The notes under test
  // ride on the row.
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({ requestId: "r-kept", text: "the annual party" }));
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // "Taken off the shelf. It is not put back on its own." named neither
    // half of what happened (the owner, 2026-09-11: "isn't it deleted?").
    assert.match(html, /Its page is deleted, for good\./);
    assert.match(html, /The set itself is\s+untouched — still loaded — and asking again is\s+what gets a new page\./);
    assert.ok(!html.includes("it goes on the shelf once the set is ready"),
      "the card must not contradict the deletion it just performed");
    assert.ok(!html.includes("Take it off the shelf"), "and offers no second delete");
    assert.ok(!html.includes("The Annual Party"), "nor a shelf row for a page that is gone");
  } finally { f.restore(); }
});

test("a set that was never recorded is not reported as one somebody deleted", async () => {
  const e = reqEnv();
  await seedKept(e);
  const row = e.STATION.rows.get("r-kept");
  // Settled with no page because no tracklist was ever recorded for it. Same
  // marks as a deletion, and a different fact.
  e.STATION.rows.set("r-kept", { ...row, kept_slug: null, unrecorded: Date.now() });
  e.PROGRAMS.put("request:r-kept", JSON.stringify({
    id: "r-kept", dj: "hank", mood: "the annual party", length: 90,
    avoid: null, keep: true, at: new Date().toISOString() }));
  // The ask pointer names this request, so a live playlist that differs from
  // the fulfilled one reads as "changed since" — a row — rather than
  // superseded, which since 2026-09-05 shows nothing. The notes under test
  // ride on the row.
  await e.PROGRAMS.put(`ask:${HANKP}`, JSON.stringify({ requestId: "r-kept", text: "the annual party" }));
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /No tracklist was recorded for this set/);
    assert.ok(!html.includes("Taken off the shelf"),
      "nobody took anything off the shelf — the page must not invent the act");
    assert.ok(!html.includes("it goes on the shelf once the set is ready"),
      "and it must not promise a page that can never be made");
  } finally { f.restore(); }
});

test("a kept page outliving its request row can still be taken off the shelf", async () => {
  const e = reqEnv();
  const slug = await seedKept(e);
  // Retention pruned the row months ago; the page never expires. This is the
  // case the shelf control exists for.
  e.STATION.rows.delete("r-kept");

  const res = await worker.fetch(post(`/notes/${KEY}/unkeep`, form({ slug })), e);
  assert.equal(res.headers.get("location"), `/notes/${KEY}?put=removed`);
  assert.ok(!(await e.PROGRAMS.get(`program:${slug}`)),
    "a pruned row is as clean as it can be, not a reason to refuse forever");
});

// THE SPEAKER, THE HEIGHT, THE PLAYING BAND — the owner's list, 2026-09-05.
test("the masthead's speaker select is where every Play goes, and it is remembered by the page", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(html, /<select class="devsel" id="wdev" data-pick hidden aria-label="Speaker to play on"><option selected>Pro Plus<\/option><option>Everywhere<\/option><option>Master Bedroom<\/option><\/select>/);
    assert.ok(!/class="chip">Pro Plus/.test(html), "the chip that only named the room is gone");
    // Every play form carries the page's answer; without script it is the default.
    const forms = [...html.matchAll(/<form method="post" action="[^"]+\/play" class="bplay">([\s\S]*?)<\/form>/g)].map((m) => m[1]);
    assert.ok(forms.length > 0);
    for (const body of forms) assert.match(body, /<input type="hidden" name="device" value="Pro Plus" data-wall>/);
    const dev = html.match(/<script nonce="[^"]+">\s*\(function \(\) \{\s*var sel = document\.getElementById\("wdev"\)[\s\S]*?<\/script>/)?.[0];
    assert.ok(dev, "the select's script is on the page");
    // Remembered as the ONE choice every picker and the Speakers page share
    // (2026-09-23), not a key of this page's own.
    assert.match(html, /pickSet\(slug\(sel\.value\), auto\);/);
    // Stamped with its time when chosen on purpose (pickFirm, 2026-09-26).
    assert.match(html, /document\.cookie = "spk=" \+ s \+ \(auto \? "" : "\." \+ Math\.floor\(Date\.now\(\) \/ 1000\)\) \+ "; Path=\/; Max-Age=31536000; SameSite=Lax; Secure";/,
      "kept in a cookie, so the script-free Shelf is drawn with it");
    assert.ok(!html.includes("wall:device"), "the page's own memory is gone");
    assert.match(dev, /inputs\.forEach\(function \(i\) \{ i\.value = sel\.value; \}\)/);
  } finally { f.restore(); }
});

test("every band is one height, a long brief is clipped, and a long name gets two lines", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    const css = html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
    assert.match(css, /\.band\{[^}]*\bheight:96px;/);
    assert.ok(!/\.band\{[^}]*min-height/.test(css));
    assert.match(css, /\.band\.benched\{height:84px\}/);
    assert.match(css, /\.bsum\{[^}]*-webkit-line-clamp:2;/);
    // A name may take two lines ("The Correspondent", cut 2026-10-13, needed them under 430px)
    // and is clipped after that; the band's fixed height holds either way.
    assert.match(css, /\.bname\{[^}]*-webkit-line-clamp:2;/);
  } finally { f.restore(); }
});

test("the playing band's circle is a pause that pauses, and its line scrolls what is on", async () => {
  const e = env();
  // Spotify says button 2's playlist — Hank's — is playing "T" by "A".
  const f = installFetch({ contents: [track("aaa")] });
  const restore = playsOn("Pro Plus");
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    const band = html.match(/<li class="band playing"[\s\S]*?<\/li>/)?.[0];
    assert.ok(band, "button 2 is the playing band");
    assert.match(band, /data-btn="2" data-dj="hank"/);
    assert.match(band, /<input type="hidden" name="pause" value="1">/);
    assert.match(band, /<button type="submit" class="go" data-busy="Pausing…" aria-label="Pause Hank">/);
    assert.match(band, /<rect x="6"/, "the glyph is a pause");
    assert.match(band, /<span class="bsum np" aria-label="Playing now: T — A"><span class="marq" style="animation-duration:\d+s" aria-hidden="true">T — A<span class="msep" aria-hidden="true">·<\/span>T — A<span class="msep" aria-hidden="true">·<\/span><\/span><\/span>/);
    const css = html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
    assert.match(css, /\.band\.playing \.go\{background:rgba\(255,255,255,\.96\);color:#14110F\}/);
    assert.match(css, /@keyframes marq\{to\{transform:translateX\(-50%\)\}\}/);
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.marq\{animation:none\}\}/);
    // Every other band still says its brief and offers Play.
    assert.match(html, /<li class="band" data-btn="1"[\s\S]*?<span class="bsum">Deep 60s\/70s funk/);
    assert.match(html, /aria-label="Play Dr\. Funkenstein on Pro Plus"/);

    // The press pauses and comes back to the wall; nothing is started.
    const res = await worker.fetch(post(`/buttons/${KEY}/hank/play`, form({ device: "Pro Plus", pause: "1" })), e);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}?paused=ok`);
    assert.ok(f.calls.includes("PUT /me/player/pause"), f.calls.join(" | "));
    // Written down as the bar's own pause is, for its play-again (the review, 2026-10-09).
    assert.ok(await e.PROGRAMS.get("pause:last"), "the pause note is kept");
    assert.ok(!f.calls.includes("PUT /me/player/play"), "nothing was started");
  } finally { restore(); f.restore(); }
});

// THE DJ PAGE, redesigned from the owner's list, 2026-09-05 night: the two
// chips on one line; a play/pause CIRCLE with the room beside it, and the
// press does what the glyph says; the scrolling line while this button plays;
// what the button holds as an inset inside the colour block; the composer
// folded; a settled request folded to one line; and the room select following
// the player, here and on the wall.
test("the DJ page's header: chips on one line, a play circle beside the room, the card inside the block", async () => {
  const e = env();
  await e.PROGRAMS.put(`current:${P(2)}`, "none-such");
  const f = installFetch({ contents: [track("a"), track("b")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    const css = html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
    assert.match(css, /\.djpage \.djtop \.backline\{margin:0\}/, "the back chip's own margin is off in the row");
    assert.match(html, /<form class="vact" method="post" action="\/buttons\/[^"]+\/hank\/play">\s*<button type="submit" class="go big" data-busy="Starting…" aria-label="Play Hank"><svg[^>]*><path d="M7 4v16l13-8z"/);
    assert.match(html, /<label class="devon" hidden>on <select class="devsel" name="device" data-pick aria-label="Speaker">/);
    assert.ok(!/class="playbtn playbig|Play Hank<\/button>/.test(html), "the circle says it with a glyph");
    // Option A: the pill top right IS the way to the picker, the facts line
    // carries no link, and what the preset holds sits UNDER the block as a
    // line and two chips — no white box inside the colour.
    // The number pill went with the picker (stage 6, 2026-09-26).
    assert.ok(!/class="chip dark num"/.test(html));
    assert.match(html, /<a class="chip light round backline" href="\/buttons\/[^"]+\/djs" aria-label="Back to the DJs"><svg/);
    // The chips row keeps its shape when the list opens: floats, not flex.
    assert.match(html, /\.djpage \.chiprow>a\.chipbtn\{float:left;/);
    assert.match(html, /\.djpage \.tlfold ol\.tl\{clear:both;/);
    assert.ok(!/class="swaplink"|Change who is on/.test(html));
    const header = html.slice(html.indexOf('<header class="djhead">'), html.indexOf("</header>"));
    assert.ok(!/btncard|inset|On the preset/.test(header), "nothing but the DJ and the press inside the block");
    // At a glance sat here from 2026-09-30 to 2026-10-24; with no settings
    // store (this house) no Tuning row either, so the header meets the preset.
    assert.match(html, /<\/header>\s*<section class="block holds" aria-labelledby="holdsh">\s*<h2 class="blabel vh" id="holdsh">On the preset<\/h2>/);
    assert.ok(!/<p class="npline">/.test(html), "nothing scrolls while nothing plays");
  } finally { f.restore(); }
});

test("while this button plays, the DJ page shows a pause that pauses and returns here, and the room it plays in", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  const restore = playsOn("Master Bedroom");
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /<input type="hidden" name="pause" value="1"><input type="hidden" name="back" value="dj">/);
    assert.match(html, /<button type="submit" class="go big" data-busy="Pausing…" aria-label="Pause Hank"><svg[^>]*><rect/);
    assert.match(html, /<p class="npline"><span class="np" aria-label="Playing now: T — A">/);
    // The select follows the player: Hank plays in the Master Bedroom, so
    // that is where the next press goes, whatever an old choice said (MC-28).
    const again = await (await worker.fetch(withPick(`/buttons/${KEY}/hank`, "spk=everywhere"), e)).text();
    assert.ok(again.includes("<option selected>Master Bedroom</option>"));
    // The press pauses and comes back to THIS page, not the wall.
    const res = await worker.fetch(post(`/buttons/${KEY}/hank/play`, form({ device: "Master Bedroom", pause: "1", back: "dj" })), e);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/buttons/${KEY}/hank?paused=ok`);
    assert.ok(f.calls.includes("PUT /me/player/pause"));
  } finally { restore(); f.restore(); }
});

test("a play that just succeeded shows the pause even before Spotify's state catches up, and says nothing else", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank?played=ok&on=Everywhere`), e)).text();
    assert.match(html, /aria-label="Pause Hank"/);
    assert.ok(!/Started Hank/.test(html), "no flash for a press that worked — the circle says it");
    assert.ok(html.includes("<option selected>Everywhere</option>"));
  } finally { f.restore(); }
});

test("the wall's speaker select is the one speaker (MC-28): the music unless a speaker was chosen in the last half hour", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  const restore = playsOn("Master Bedroom");
  const wall = (cookie) => worker.fetch(new Request(`https://x.test/buttons/${KEY}`, cookie ? { headers: { cookie } } : {}), e).then((r) => r.text());
  const SELECT = (on) => new RegExp(`<select class="devsel" id="wdev" data-pick hidden aria-label="Speaker to play on">${
    ["Pro Plus", "Everywhere", "Master Bedroom"].map((d) => `<option${d === on ? " selected" : ""}>${d}</option>`).join("")}</select>`);
  try {
    const html = await wall(null);
    assert.match(html, SELECT("Master Bedroom"), "nothing chosen: where the music is");
    // Every play form aims where the select points.
    const forms = [...html.matchAll(/<input type="hidden" name="device" value="([^"]+)" data-wall>/g)].map((m) => m[1]);
    assert.ok(forms.length > 0 && forms.every((v) => v === "Master Bedroom"));
    assert.match(html, /aria-label="Play Vibe on Master Bedroom"/);
    const now = Math.floor(Date.now() / 1000);
    assert.match(await wall(`spk=pro-plus.${now - 60}`), SELECT("Pro Plus"), "chosen a minute ago: it holds");
    assert.match(await wall(`spk=pro-plus.${now - 31 * 60}`), SELECT("Master Bedroom"), "chosen over half an hour ago: the music");
    assert.match(await wall("spk=pro-plus"), SELECT("Master Bedroom"), "followed, never chosen: the music");
    // No rule of its own left in the page: the pickers read the server's.
    assert.ok(!html.includes("firmElsewhere") && !html.includes("data-chosen"));
  } finally { restore(); f.restore(); }
});

test("pickFor (MC-28): chosen in the last half hour, else Spotify, else a WiiM playing Tidal, else the last choice, else the default", () => {
  const { pickFor } = __test;
  const e = env();
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "10.0.0.2", Ultra: "10.0.0.3" });
  const req = (cookie) => new Request("https://x.test/", cookie ? { headers: { cookie } } : {});
  const now = Date.now(), secs = Math.floor(now / 1000);
  const spot = { device: "Master Bedroom", track: "x" };
  const tidal = { speakers: { Ultra: { state: "play", source: "Tidal", track: "y" } } };
  const at = (cookie, p, lan) => { const k = pickFor(e, req(cookie), p, lan, now); return k && `${k.name}/${k.why}`; };
  assert.equal(at(`spk=everywhere.${secs - 60}`, spot, tidal), "Everywhere/chosen");
  assert.equal(at(`spk=everywhere.${secs - 1801}`, spot, tidal), "Master Bedroom/music", "half an hour gone: the music");
  assert.equal(at("spk=everywhere", spot, tidal), "Master Bedroom/music", "Spotify before Tidal");
  assert.equal(at("spk=everywhere", null, tidal), "Ultra/music", "Tidal on a WiiM is music too");
  assert.equal(at("spk=everywhere", null, { speakers: { Ultra: { state: "play", source: "Spotify" } } }), "Everywhere/last",
    "the helper's Spotify is Spotify's to say");
  assert.equal(at("spk=everywhere", null, { speakers: { Ultra: { state: "pause", source: "Tidal" } } }), "Everywhere/last", "paused is not playing");
  assert.equal(at("spk=everywhere", { unknown: true }, null), "Everywhere/last");
  assert.equal(at(null, null, null), "Pro Plus/default");
  assert.equal(at("spk=kitchen.1", null, null), "Pro Plus/default", "a speaker the house has not got is no choice");
  // Only a stream is music (the review, 2026-09-27): a WiiM on the TV's
  // optical reads "play" while silent.
  for (const source of ["Optical", "Line-In", "HDMI", "Bluetooth", "USB", undefined]) {
    assert.equal(at("spk=everywhere", null, { speakers: { Ultra: { state: "play", ...(source ? { source } : {}) } } }), "Everywhere/last", String(source));
  }
  for (const source of ["Tidal", "Qobuz", "TuneIn", "Web stream", "AirPlay"]) {
    assert.equal(at("spk=everywhere", null, { speakers: { Ultra: { state: "play", source } } }), "Ultra/music", source);
  }
  // Spotify unknown (its limit): the helper's Spotify reading stands in, so
  // the pick does not jump to the Tidal speaker.
  const both = { speakers: { Ultra: { state: "play", source: "Tidal" }, "Pro Plus": { state: "play", source: "Spotify" } } };
  assert.equal(at("spk=everywhere", { unknown: true }, both), "Pro Plus/music");
  assert.equal(at("spk=everywhere", null, both), "Ultra/music", "Spotify known quiet: the helper's stale Spotify is not believed");
});

test("a request in flight stands open, and so does one the DJ passed on", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    await worker.fetch(askPost("hank", { mood: "trains", length: "60" }), e);
    const pending = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    // The section is "Ask Hank" while a request of his is live (board A,
    // 2026-09-25); "Requests" is left for a page with neither.
    assert.match(pending, /<h2 class="blabel" id="reqh">Ask Hank<\/h2>\s*<details class="reqrow live" open>/);
    assert.match(pending, /<p class="reqstate" role="status">Pending — /);
    // Declined: settled, and since 2026-09-13 it stands open — the reason inside.
    const rows = await e.STATION.list?.({ dj: "hank" }).catch(() => null);
    const id = (rows?.rows?.[0]?.id) ?? [...e.STATION.rows.values()][0]?.id;
    assert.ok(id, "a request row exists");
    await callTool(e, "decline_request", { request_id: id, reason: "not tonight" }, { remaining: 40 });
    const declined = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(declined, /<details class="reqrow" open>\s*<summary><span class="reqwords"><span class="vh">Your request · <\/span>“trains”<\/span><span class="reqword">declined<\/span><\/summary>/);
    assert.match(declined, /Hank passed on this one: “not tonight”/);
    // And the ask card is back beside it, in the same section (open since
    // board A, 2026-09-25), under the heading that names the DJ.
    assert.match(declined, /<h2 class="blabel" id="reqh">Ask Hank<\/h2>\s*<details class="reqrow" open>/);
    assert.ok(declined.indexOf('class="reqform askcard"') > declined.indexOf('<details class="reqrow" open>'));
  } finally { f.restore(); }
});

test("a DJ who passes and names another offers the same ask to them in one press", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    await worker.fetch(askPost("hank", { mood: "songs for a birthday party", length: "60", avoid: "nothing sad", keep: "1" }), e);
    const id = [...e.STATION.rows.values()][0]?.id;
    assert.ok(id, "a request row exists");
    await callTool(e, "decline_request", { request_id: id, reason: "not my crate", suggested_dj: "vibe" }, { remaining: 40 });
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    const form = html.match(new RegExp(`<form class="reqact" method="post" action="/buttons/${KEY}/vibe/request">[\\s\\S]*?</form>`))?.[0] ?? "";
    assert.ok(form, "the passed row carries the same ask, addressed to the DJ it suits");
    assert.ok(form.includes('<input type="hidden" name="mood" value="songs for a birthday party">'));
    assert.ok(form.includes('<input type="hidden" name="length" value="60">'));
    assert.ok(form.includes('<input type="hidden" name="avoid" value="nothing sad">'));
    assert.ok(form.includes('<input type="hidden" name="keep" value="1">'));
    assert.match(form, /<button type="submit" data-busy="Asking…">Ask [^<]+ instead<\/button>/);
    // One press sends it, as the other DJ's own form would.
    const fields = Object.fromEntries([...form.matchAll(/name="([a-z]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const res = await worker.fetch(askPost("vibe", fields), e);
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /\/vibe\?ask=sent$/);
  } finally { f.restore(); }
});

// A DEPLOY UNDER A FULFILMENT, 2026-09-06. A Durable Object is reset when
// its code is updated, and an in-flight call gets an error, not an answer.
// Two fulfilments claimed their request and then lost "mark-write" that way;
// the curator, told to trust every refusal, stopped, and both sat as dead
// claims. The token-bearing and read-only ops are safe to ask twice, so they
// are asked once more; a claim is not, since a first claim that landed would
// make the second read as held.
test("an idempotent ledger call is asked once more after a Durable Object reset; a claim is not", async () => {
  const { station } = await import("../station.js");
  const e = makeEnv();
  const real = e.STATION.get.bind(e.STATION);
  let failures = 0, calls = 0;
  e.STATION.get = (id) => {
    const stub = real(id);
    return { fetch: async (...a) => {
      calls++;
      if (failures-- > 0) throw new Error("Durable Object reset because its code was updated.");
      return stub.fetch(...a);
    } };
  };
  await station(e, "submit", { id: "r-1", dj: "hank", normalized: "x" });
  failures = 1; calls = 0;
  const listed = await station(e, "list", { dj: "hank" });
  assert.equal(listed.ok, true, "the read came back on the second ask");
  assert.equal(calls, 2);
  // A claim that errors stays an error — the caller must not be told "held".
  failures = 1; calls = 0;
  await assert.rejects(() => station(e, "claim", { id: "r-1", fingerprint: "f" }), /reset/);
  assert.equal(calls, 1);
  // Any other error is not retried either.
  e.STATION.get = () => ({ fetch: async () => { calls++; throw new Error("network down"); } });
  calls = 0;
  await assert.rejects(() => station(e, "list", { dj: "hank" }), /network down/);
  assert.equal(calls, 1);
});

// SPOTIFY'S QUOTA, 2026-09-06. A development-mode app has a quota apart from
// the rate limit; over it every call is a 429 QUOTA_EXCEEDED for as long as
// Spotify says. Two curator runs did their work and lost the write to it,
// and the pages said "pending" and "retrying" all the while. Now the first
// 429 leaves a note, and while it stands the pages read nothing from
// Spotify, say why in words, and do not ring the doorbell.
function quotaFetch(paths, retryAfter = "600") {
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (paths.some((p) => u.pathname.startsWith(p))) {
      // The body Spotify sent on 2026-09-06, wrapper and all.
      return new Response(JSON.stringify({ error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": retryAfter } });
    }
    return inner(url, init);
  };
  return () => { globalThis.fetch = inner; };
}
const { THROTTLE_KEY } = __test;

test("a 429 from Spotify leaves a note for as long as it says, and the pages then say so instead of reading", async () => {
  const e = pipeEnv();
  await deadClaim(e, "r-dead", 12 * 60 * 1000);
  const f = installFetch({ contents: [track("t1")] });
  const spy = routineSpy();
  const unquota = quotaFetch([`/v1/playlists/${P(2)}`]);
  try {
    const before = Date.now();
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /Spotify is limiting this account's requests for about (9|10) minutes more \(quota exceeded\), so Play is\s+refused/, "the tracklist's problem line, with the wait");
    assert.ok(html.includes(`/buttons/${KEY}/hank/play`) === false, "Play would be refused: no form");
    const note = await e.PROGRAMS.get(THROTTLE_KEY, { type: "json" });
    assert.ok(note.until >= before + 600 * 1000 && note.until <= Date.now() + 600 * 1000, "the wait Spotify said");
    assert.equal(note.said, 600);
    assert.equal(spy.rings.length, 0, "no doorbell while the write would only fail");

    // The next view reads nothing from Spotify at all — not the playlist,
    // not the player — and the request row says why it is not moving.
    f.calls.length = 0;
    const again = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(!f.calls.some((c) => /playlists|player/.test(c)), `no Spotify reads: ${f.calls.join(", ")}`);
    assert.match(again, /limiting this account(&#39;|')s requests for about (9|10) minutes more, so the set cannot be written until then/);
    assert.equal(spy.rings.length, 0);

    // The wall: the player is not asked either, and the line says why.
    f.calls.length = 0;
    const wall = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!f.calls.some((c) => /playlists|player/.test(c)), `no Spotify reads: ${f.calls.join(", ")}`);
    assert.match(wall, /limiting this account(&#39;|')s requests for about <b>(9|10) minutes more<\/b> \(quota exceeded\)/);

    // A 429 that names no wait gets the default, and a longer note is not
    // shortened by a shorter one.
    await e.PROGRAMS.delete(THROTTLE_KEY);
    await __test.stampThrottle(e, { retryAfter: 0 });
    const dflt = await e.PROGRAMS.get(THROTTLE_KEY, { type: "json" });
    assert.ok(dflt.until > Date.now() + 14 * 60 * 1000 && dflt.said === null);
    await __test.stampThrottle(e, { retryAfter: 30 });
    assert.equal((await e.PROGRAMS.get(THROTTLE_KEY, { type: "json" })).until, dflt.until);
    // Past its time it is no note at all.
    await e.PROGRAMS.put(THROTTLE_KEY, JSON.stringify({ until: Date.now() - 1 }));
    assert.equal(await __test.throttledUntil(e), null);
  } finally { unquota(); spy.restore(); f.restore(); }
});

test("the DJ page's tracklist read is cached for five minutes, and a stale entry is read past", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1"), track("t2")] });
  try {
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    const reads = () => f.calls.filter((c) => c === `GET /playlists/${P(2)}/items`).length;
    assert.equal(reads(), 1);
    const again = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.equal(reads(), 1, "the second view is served from the cache");
    assert.match(again, /Track t2/);
    const cached = await e.PROGRAMS.get(`items:${P(2)}`, { type: "json" });
    assert.equal(cached.tracks.length, 2);
    assert.deepEqual(cached.liveUris, ["spotify:track:t1", "spotify:track:t2"]);
    // A stale entry is read past, and a write through the server deletes it.
    // The window is FIVE minutes, deliberately longer than the 60-second
    // refresh this page does on itself while a request is in flight: at 90
    // seconds a page left open re-read and re-cached forever, at two KV writes
    // a time, against a free tier of a thousand a day (2026-09-06).
    await e.PROGRAMS.put(`items:${P(2)}`, JSON.stringify({ ...cached, at: Date.now() - 6 * 60 * 1000 }));
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    assert.equal(reads(), 2);
    assert.ok(await e.PROGRAMS.get(`items:${P(2)}`));
  } finally { f.restore(); }
});

test("a long wait is said in hours", () => {
  assert.equal(waitWords(1), "1 minute");
  assert.equal(waitWords(20), "20 minutes");
  assert.equal(waitWords(89), "89 minutes");
  assert.equal(waitWords(90), "2 hours");
  assert.equal(waitWords(672), "11 hours");
});

// THE COUNTER AND THE GATES, 2026-09-06. Every call to Spotify is tallied in
// the station object by hour and kind, every quota refusal is kept, and the
// Speakers page and list_requests show the sums. While the note stands, Play,
// a move and a bench refuse in words before anything is sent.
test("every Spotify call is counted by kind, and a quota refusal is kept", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    const tally = () => Object.fromEntries([...e.STATION.calls].map(([k, n]) => [k.split("|")[1], n]));
    const t1 = tally();
    // (The sign-in is counted too, under "token"; the isolate-level token
    // cache means this test cannot say whether one happened here.)
    assert.ok(t1.read >= 2, `the playlist and its items: ${JSON.stringify(t1)}`);
    assert.ok(t1.player >= 1, "the player read");
    assert.equal(t1.write, undefined, "nothing written");
    // The count goes to the ledger, not through fetch: the list of calls
    // Spotify saw is unchanged by counting.
    assert.ok(!f.calls.some((c) => c.includes("station")));
    assert.equal(e.STATION.hits.length, 0);
  } finally { f.restore(); }

  const f2 = installFetch({ contents: [track("t1")] });
  const unquota = quotaFetch([`/v1/playlists/${P(2)}`], "1200");
  try {
    await e.PROGRAMS.delete(`items:${P(2)}`);
    await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    // The page reads the playlist and its items side by side, so two calls
    // were refused: both kept.
    assert.ok(e.STATION.hits.length >= 1, "the refusal is kept");
    assert.deepEqual([e.STATION.hits[0].retry_after, e.STATION.hits[0].category, e.STATION.hits[0].reason],
      [1200, "read", "QUOTA_EXCEEDED"]);
    // And the refusal wrote down what the counter said: the calls this page
    // load itself had already made, counted before each fetch.
    assert.ok(e.STATION.hits[0].calls_24h > 0,
      "the refusal carries the count as it stood, which is the measurement");
  } finally { unquota(); f2.restore(); }
});

test("the Speakers page and list_requests show what a day costs, and the refusals", async () => {
  const e = env();
  e.MCP_SECRET = "owner-secret-owner-secret"; e.AGENT_SECRET = "agent-secret-agent-secret";
  const hour = (ago) => new Date(Date.now() - ago * 60 * 60 * 1000).toISOString().slice(0, 13);
  e.STATION.calls.set(`${hour(1)}|search`, 120);
  e.STATION.calls.set(`${hour(1)}|tracks`, 60);
  e.STATION.calls.set(`${hour(5)}|player`, 30);
  e.STATION.calls.set(`${hour(30)}|read`, 400);
  e.STATION.calls.set(`${hour(70)}|read`, 8765);  // out of the two-day window
  e.STATION.hits.push({ at: Date.now() - 60 * 60 * 1000, retry_after: 40322, category: "write",
    reason: "QUOTA_EXCEEDED", calls_24h: 1240 });
  const html = await (await worker.fetch(get(`/buttons/${KEY}/use`), e)).text();
  assert.match(html, /<h2 id="uspot">Spotify<span class="usub">the last 24 hours<\/span><\/h2>/);
  // One big number and the trend (2026-09-23), then what they went on, as bars.
  assert.match(html, /<p class="uhero"><b>210<\/b><span>calls · down from 400 the day before<\/span><\/p>/);
  assert.match(html, /<span class="ulab">searching<\/span>[\s\S]*?<span class="unum">120<\/span>[\s\S]*?<span class="ulab">looking up tracks<\/span>[\s\S]*?<span class="unum">60<\/span>[\s\S]*?<span class="ulab">the player<\/span>[\s\S]*?<span class="unum">30<\/span>/);
  assert.match(html, new RegExp(`Busiest hour: <time datetime="${hour(30)}:00:00Z">[^<]*<\\/time>, <b>400<\\/b> calls`));
  // WHAT THE COUNTER SAID AT THE REFUSAL. Spotify does not publish the
  // allowance, so this number beside a refusal is the only evidence of where
  // it sits — and it has to be the count at that moment, not the count now,
  // which is a lockout's worth of silence plus whatever came after.
  assert.match(html, /refused for about 11 hours, on writing playlists, after <b>1,240<\/b> calls in the day before it/);
  assert.ok(!html.includes("8765"), "a week is kept, two days are shown");

  const rpc = new Request("https://x.test/mcp/agent-secret-agent-secret", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_requests", arguments: {} } }) });
  const out = JSON.parse((await (await worker.fetch(rpc, e)).json()).result.content[0].text);
  assert.equal(out.spotify_calls_24h, 210);

  // Nothing counted yet reads as nothing, not as an error.
  const quiet = await (await worker.fetch(get(`/buttons/${KEY}/use`), env())).text();
  assert.match(quiet, /<p class="uhero"><b>0<\/b><span>calls · nothing counted the day before<\/span><\/p>/);
  assert.match(quiet, /None counted yet\./);
});

test("while the note stands, Play and pause refuse in words before anything is sent", async () => {
  const e = env();
  await e.PROGRAMS.put(THROTTLE_KEY, JSON.stringify({ until: Date.now() + 20 * 60 * 1000, said: 1200 }));
  const f = installFetch({ contents: [track("t1")] });
  const form = (p, body) => new Request(`https://x.test${p}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  try {
    // Play and pause.
    const play = await worker.fetch(form(`/buttons/${KEY}/hank/play`, "device=Pro+Plus"), e);
    assert.equal(play.status, 503);
    assert.match(await play.text(), /limiting this account&#39;s requests for about 20 minutes more \(quota exceeded\), so this site cannot start or pause a speaker until then\. Nothing was sent\. The presets on the speaker itself still work\./);
    const pause = await worker.fetch(form(`/buttons/${KEY}/hank/play`, "pause=1&back=dj"), e);
    assert.equal(pause.status, 503);
    assert.ok(!f.calls.some((c) => c.includes("/me/player")), "nothing sent to the player");

    // The DJ page: the cached tracklist still shows, the play circle does not.
    await e.PROGRAMS.put(`items:${P(2)}`, JSON.stringify({ at: Date.now(), liveUris: ["spotify:track:t1"],
      tile: { name: "Hank", count: 1 }, tracks: [{ n: 1, title: "Track t1", artists: "Someone", dur: "3:00", uri: "spotify:track:t1" }] }));
    const dj = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(dj, /Track t1/);
    assert.ok(!dj.includes('class="go big"'), "no play circle");
    assert.match(dj, /for about 20 minutes more \(quota exceeded\), so Play is\s+refused/);
  } finally { f.restore(); }
});

// ------------------------------------------------------- the labelled preset

test("a labelled preset has no band on the presets wall (2026-09-22)", async () => {
  // It HAD one: a dashed band with its name and "Remote", under the line,
  // with no Play, no page and no drop — the page knows a labelled preset's
  // name from the config and nothing else, because it cannot see the speaker.
  // That band went with the rest of the twelve on 2026-09-22 (the owner:
  // "aren't we duplicating the same info over and over?"): the Speakers tab
  // lists what each speaker holds, read from the speaker itself, which is
  // better than a name in a config file. The REFUSAL below is untouched — it
  // is the write path, not the page.
  const e = env();
  e.BUTTONS = JSON.stringify([
    { button: 1, dj: "dr-funkenstein", playlist: P(1), catalog: "spotify" },
    { button: 2, dj: "hank", playlist: P(2), catalog: "spotify" },
    { button: 6, archive: true },
    { button: 7, label: "Jazz FM" },
  ]);
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes(">Jazz FM<"), "the label is not on the wall");
    assert.ok(!html.includes("Started from the remote"), "and no line to put it under");
    assert.ok(!/<li class="band fixed slim/.test(html), "no slim band of any kind");
    // AND IT IS NO LONGER COUNTED. The heading said "The wall — 4 presets"
    // over two bands: it counted every preset the house configures while the
    // page drew only the ones above the line. It counts what is drawn now.
    assert.match(html, /Loaded — 2 presets/);
    // And a house without one says nothing about them, and describes itself
    // in the same words: the description counted DJs until 2026-09-22, and
    // the point of the count was that a labelled preset is never one. It
    // counts nothing now, so the two houses read identically.
    const bare = await (await worker.fetch(get(`/buttons/${KEY}`), env())).text();
    assert.ok(!/saved yourself in the WiiM app/.test(bare));
    const desc = (h) => h.match(/<meta name="description" content="([^"]*)"/)?.[1];
    assert.equal(desc(bare), "The programs on the presets: whose set is on each, and since when.");
    assert.equal(desc(html), desc(bare));
  } finally { f.restore(); }
});

// ------------------------------------ the Send button says it is sending (2026-09-10)
//
// The owner tapped Send on Monk's page several times and could not tell
// whether anything ran. Measured in a phone-sized browser against the real
// Worker: the guard DID disable Send ~85 ms after the tap — so one request,
// not four — but a disabled Send was drawn exactly like an enabled one, the
// box's required-field hint is easy to miss on a phone, and Send sat a screen
// below the fold once the form opened. Since board A (2026-09-25) the button
// is Ask and the card stands open, so there is no fold to bring into view.
test("Ask says it is sending, and an empty one is answered in the page", async () => {
  const e = reqEnv();
  e.BUTTONS = buttons({ 3: P(3) }); // Hank benched: the composer is drawn
  const f = installFetch({ contents: [track("t1")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}/hank`), e);
    const html = await res.text();
    assert.match(html, /<button type="submit" class="asksend" data-busy="Sending…">Ask<\/button>/,
      "the guard has a word to put on the button");
    assert.match(html, /\.djpage \.reqform button\[type="submit"\]:disabled\{opacity:\.55/,
      "and a disabled Send is drawn as one");
    assert.match(html, /<p class="askmiss" hidden role="alert">Say what you would like first/,
      "an empty send has a sentence of its own, hidden until needed");
    assert.match(html, /mood\.addEventListener\("invalid"/, "wired to the browser's invalid event");
    assert.ok(!/addEventListener\("toggle"/.test(html), "no fold to scroll to on opening");
    assert.match(html, /mood\.scrollIntoView/, "an empty send still brings the box into view");
    // Every inline script still carries the page's nonce — a bare one is
    // blocked by the CSP, which is how the room's scripts once never ran.
    const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(res.headers.get("content-security-policy"))?.[1];
    assert.ok(nonce);
    assert.equal((html.match(/<script>/g) ?? []).length, 0, "no bare script tag");
  } finally { f.restore(); }
});

// =========================== the DJ page is Quiet, like the wall
//
// The owner, 2026-09-10: "I rarely if ever use the full color setting and
// prefer quiet." The palette followed the reader off the wall that day, and
// on 2026-09-11 Full was deleted: the block is the deep tone for every DJ,
// the big circle pale on it, and nothing on the page carries a persona's
// colour or a palette script.

test("the DJ page paints its block in the deep tone, for every DJ, with no palette script", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.match(html, /<html lang="en">/, "nothing stamped on the root");
    assert.match(html, /<main class="page djpage tabbed">/, "no inline colour pair on the page");
    assert.ok(!html.includes("wall:palette") && !html.includes("data-palette"), "no boot, no attribute");
    // The block paints from the interceptable pair, set once to the deep tone.
    assert.match(html, /\.djpage\{[^}]*--blockfill:var\(--q-deep\);--blockink:var\(--q-on-deep\)\}/);
    assert.match(html, /\.djhead\{[^}]*background:var\(--blockfill\);color:var\(--blockink\)/);
    // The big Play circle goes pale: a near-black disc on the deep block is a hole.
    assert.match(html, /\.djpage \.go\.big\{[^}]*background:var\(--q-on-deep\);color:var\(--q-deep\)/);
    const css = html.slice(html.indexOf(".djpage{"), html.indexOf("</style>"));
    assert.ok(!/var\(--dj-fill|var\(--dj-ink/.test(css), "nothing reaches for a persona's colour");
    assert.ok(!/\.djpage\{[^}]*--ink:/.test(html), "--ink stays the page's own text variable");
    // The archive's page is a DJ page too, and the old address still answers.
    const arch = await (await worker.fetch(get(`/buttons/${KEY}/archive?palette=quiet`), e)).text();
    assert.match(arch, /<html lang="en">/);
  } finally { f.restore(); }
});

test("nothing on the DJ page below the block is painted a hardcoded near-black", async () => {
  // DARK MODE, pre-existing and found while carrying the palette through
  // (2026-09-10). #14110F on the dark ground #131417 is 1.02:1 — so the
  // section headings ("Requests", "On the shelf"), the outlined Program
  // chip and the Tracklist pill were invisible, and the chosen length pill
  // and a pressed Send with them. --ink-1, which .blabel fell back from, is
  // defined nowhere and never was. The token inverts with the mode; a
  // literal cannot.
  //
  // What KEEPS its literal, deliberately: everything inside the coloured
  // block. A known field is behind those, so they do not follow the page.
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    const css = html.slice(html.indexOf(".djpage{"), html.indexOf("</style>"));
    for (const rule of [
      /\.djpage \.chipbtn\{[^}]*border:2px solid var\(--ink\);background:transparent;color:var\(--ink\)/,
      /\.djpage \.chipbtn\.solid\{background:var\(--ink\);color:var\(--ground\)\}/,
      /\.djpage \.blabel\{[^}]*color:var\(--ink\)/,
      /\.djpage \.reqform \.seg input:checked\+span\{background:var\(--ink\);color:var\(--ground\);border-color:var\(--ink\)\}/,
    ]) assert.match(css, rule);
    assert.ok(!/var\(--ink-1/.test(css), "a token that does not exist is a literal in disguise");
    // The block's own controls still carry theirs — a white pill and the big
    // Play circle sit on the DJ's field, not on the page.
    assert.match(css, /\.djpage \.chip\.light\{background:rgba\(255,255,255,\.92\);color:#14110F\}/);
  } finally { f.restore(); }
});

// DRAW FIRST (the owner, 2026-09-12: "draw page first and fill now playing line
// a moment later"). The wall gives Spotify a quarter of a second; past that it
// goes out without the player, marked pending, and its script asks /playing.
const slowPlayer = (ms, body) => {
  const inner = globalThis.fetch;
  const seen = { reads: 0 };
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      seen.reads += 1;
      await new Promise((r) => setTimeout(r, ms));
      return body === null ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  seen.restore = () => { globalThis.fetch = inner; };
  return seen;
};
const HANK_PLAYING = {
  is_playing: true,
  item: { name: "Cold Sweat", uri: "spotify:track:cs", type: "track", duration_ms: 1000,
    artists: [{ name: "James Brown" }], album: { name: "A" } },
  progress_ms: 1, device: { name: "Pro Plus" }, context: { uri: `spotify:playlist:${P(2)}` },
};

// The bar's other speakers (2026-09-23) in this suite's house, which names no
// WiiMs: every room the play form may name.
const ROOM_OTHERS = ["Pro Plus", "Everywhere", "Master Bedroom"].map((name) =>
  ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));

test("a slow player: the wall goes out first, and /playing names the band, the track and the room", async () => {
  const e = env();
  const f = installFetch();
  const sp = slowPlayer(1000, HANK_PLAYING);
  const waits = [];
  try {
    const t0 = Date.now();
    const res = await worker.fetch(get(`/buttons/${KEY}`), e, { waitUntil: (p) => waits.push(p) });
    const took = Date.now() - t0;
    const html = await res.text();
    assert.ok(took < 800, `the page went out in ${took} ms, not behind a one-second player read`);
    assert.match(html, /<main class="page wall tabbed" data-base="[^"]+" data-pending="1">/);
    assert.ok(!html.includes('class="band playing"'), "nothing marked before it is known");
    assert.ok(html.includes('fetch(base + "/playing"'), "the page asks after");
    assert.ok(html.includes('var band = o.dj ? Array.prototype.find.call(main.querySelectorAll("li.band[data-dj]")'));
    assert.ok(waits.length >= 1, "the read carries on behind the response");
    await Promise.all(waits);
    const answer = await worker.fetch(get(`/buttons/${KEY}/playing`), e);
    assert.equal(answer.headers.get("cache-control"), "no-store");
    const got = await answer.json();
    // The big sleeve's progress line (2026-10-13): where the song was at the
    // read, and when; the album goes under the song.
    assert.equal(got.pos.ms, 1); assert.equal(got.pos.of, 1000); assert.ok(got.pos.at > 0);
    delete got.pos;
    assert.deepEqual(got, { speakers: [], others: ROOM_OTHERS, pick: { name: "Pro Plus", slug: "pro-plus", why: "music" }, state: "playing", dj: "hank", btn: 2, track: "Cold Sweat", album: "A",
      // MC-21: the band's number AND its name in one field, for the now bar.
      preset: { btn: 2, name: "Hank" },
      // Design A (2026-09-25): the panel's DJ row.
      who: { dj: "hank", name: "Hank", kind: "preset", btn: 2 },
      // No WiiMs named in this house, so every room is an "other" one, and
      // since 2026-09-23 the bar may pause any room Spotify plays on.
      artists: "James Brown", device: "Pro Plus", live: "Pro Plus", pausable: "Pro Plus",
      song: "https://open.spotify.com/track/cs", list: "https://open.spotify.com/playlist/0000000000000000000002" });
    assert.equal(sp.reads, 1, "the wall's own read answers the page's question: Spotify is asked once");
  } finally { sp.restore(); f.restore(); }
});

test("a quick player is drawn in the page as before; the page asks again only while it is on screen", async () => {
  const e = env();
  const f = installFetch();
  const sp = slowPlayer(5, HANK_PLAYING);
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(!html.includes('data-pending="1"'));
    assert.match(html, /<li class="band playing" data-btn="2" data-dj="hank"/);
    // The same script on every presets page (2026-09-13): it asks at once only
    // for a page that went out pending, then every thirty seconds while the
    // page is visible, and rests after ten minutes without a touch.
    assert.ok(html.includes('if (main.hasAttribute("data-pending")) ask();'));
    assert.ok(html.includes("var EVERY = 30000, IDLE = 600000;"));
    assert.ok(html.includes('if (busy || done || document.visibilityState !== "visible") return;'));
    assert.ok(html.includes('document.addEventListener("visibilitychange"'));
    assert.equal(sp.reads, 1, "drawing the page asked Spotify once, and the script asked nothing yet");
  } finally { sp.restore(); f.restore(); }
});

test("/playing answers GET only, on the key, and says quiet, not ours, unknown and throttled in words", async () => {
  const e = env();
  const f = installFetch();
  try {
    assert.equal((await worker.fetch(get(`/buttons/${KEY}x/playing`), e)).status, 404);
    const post = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`, { method: "POST" }), e);
    assert.equal(post.status, 405);
    assert.deepEqual(await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json(), { speakers: [], others: ROOM_OTHERS, pick: { name: "Pro Plus", slug: "pro-plus", why: "default" }, state: "quiet" });
  } finally { f.restore(); }
  // An album on the Pro Plus: playing, on a speaker of the house, and no band.
  const e2 = env();
  const f2 = installFetch();
  const sp = slowPlayer(1, { ...HANK_PLAYING, context: { uri: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy" } });
  try {
    const got2 = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e2)).json();
    assert.ok(got2.pos && got2.pos.of === 1000, "where the song is");
    delete got2.pos;
    assert.deepEqual(got2,
      // No band, no guest and no speaker preset: no `preset` field at all
      // (MC-21) — the bar prints the "from" words instead.
      { speakers: [], others: ROOM_OTHERS, pick: { name: "Pro Plus", slug: "pro-plus", why: "music" }, state: "playing", dj: null, btn: null, from: "an album", track: "Cold Sweat", album: "A", artists: "James Brown", device: "Pro Plus", live: "Pro Plus", pausable: "Pro Plus",
        song: "https://open.spotify.com/track/cs" });
  } finally { sp.restore(); f2.restore(); }
  // Spotify refusing the account: the throttle note speaks, and nothing is read.
  const e3 = env();
  const f3 = installFetch();
  try {
    await e3.PROGRAMS.put(THROTTLE_KEY, JSON.stringify({ until: Date.now() + 20 * 60_000 }));
    const t = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e3)).json();
    assert.equal(t.state, "throttled");
    assert.match(t.notice, /limiting this account's requests for about 20 minutes more/);
    // MC-21: the same wait as a FIELD. The now bar says "Not known for about
    // 20 minutes" and must not read a number out of the sentence to do it.
    assert.equal(t.mins, 20);
    assert.ok(!f3.calls.some((c) => c.includes("/me/player")), "no player read while throttled");
  } finally { f3.restore(); }
});

// SHORT NOTES OR THE LONG READ (the owner, 2026-10-18, board A of
// https://claude.ai/artifact/EV8axCzhAPaamK7Zzon8yM): a writer's page offers
// the choice beside Keep, starting on the house's default; nobody else's does.
test("a writer's page offers short notes or the long read with Keep; another DJ's does not", async () => {
  const e = reqEnv();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const lib = await (await worker.fetch(get(`/buttons/${KEY}/the-librarian`), e)).text();
    assert.match(lib, /<div class="asknotes">/);
    assert.match(lib, /<input type="radio" name="notes" value="short" checked><span>Short<\/span>/, "a house with no default starts on short");
    assert.match(lib, /<input type="radio" name="notes" value="long"><span>Long read<\/span>/);
    assert.match(lib, /\.askcard:has\(\.keepbox input:checked\) \.asknotes\{display:flex\}/, "it shows only while Keep is ticked");
    assert.match(lib, /localStorage\.getItem\("ask:notes"\)/, "each phone remembers its last choice");
    const hank = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(!/name="notes"/.test(hank), "one line of intro has nothing to choose");
    e.REQUEST_NOTES = "long";
    const longHouse = await (await worker.fetch(get(`/buttons/${KEY}/gatefold`), e)).text();
    assert.match(longHouse, /<input type="radio" name="notes" value="long" checked>/, "this house starts on the long read");
  } finally { f.restore(); }
});

test("the notes ride a writer's kept record, and nowhere else", async () => {
  // A house holds three pending asks at most, so each ask gets its own house.
  const recordOf = async (dj, fields) => {
    const e = reqEnv();
    await worker.fetch(askPost(dj, { length: "60", ...fields }), e);
    const listed = JSON.parse(await (await e.STATION.get().fetch("https://s/", {
      body: JSON.stringify({ op: "list", args: { dj } }) })).text());
    return e.PROGRAMS.get(`request:${listed.rows[0].id}`, { type: "json" });
  };
  assert.equal((await recordOf("the-librarian", { mood: "Stax, the first five years", keep: "1", notes: "long" })).notes, "long");
  assert.equal((await recordOf("gatefold", { mood: "Astral Weeks", keep: "1", notes: "short" })).notes, "short");
  assert.equal("notes" in await recordOf("gatefold", { mood: "Astral Weeks", notes: "short" }), false, "not kept, no notes");
  assert.equal("notes" in await recordOf("hank", { mood: "a party", keep: "1", notes: "long" }), false, "only the writers write notes");
  assert.equal("notes" in await recordOf("the-librarian", { mood: "Memphis, 1967", keep: "1", notes: "epic" }), false, "only the form's own values");
});
