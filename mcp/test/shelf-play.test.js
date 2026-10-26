// PLAY FROM THE SHELF (2026-09-10). Every row on Program Notes carries the
// action its service allows: a Spotify set starts on a speaker now from its
// own record, writing no playlist; a Tidal set is put on its DJ's preset or
// in their crate and opened in the Tidal app; an archive set goes on the
// archive preset. The route refuses the last two in words, since the page
// never offers them a Play. Since the grid (2026-09-23) the Shelf's card
// carries only Play; the put and its words are on the program's own page.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, track, buttons, PID, TPID } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;

function env() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  // The Librarian on a Spotify preset (the Professor until the owner cut
  // him, 2026-10-15), the archive on 6, Gatefold on a Tidal 12 (Baddie's
  // seat until the owner cut her, 2026-10-13).
  e.BUTTONS = JSON.stringify([
    { button: 3, dj: "the-librarian", playlist: PID, catalog: "spotify" },
    { button: 6, archive: true },
    { button: 12, dj: "gatefold", playlist: TPID, catalog: "tidal" },
  ]);
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Master Bedroom"]);
  return e;
}

const get = (path) => new Request(`https://x.test${path}`);
const post = (path, body, headers = {}) => new Request(`https://x.test${path}`, {
  method: "POST", body, headers,
});
const form = (obj) => new URLSearchParams(obj);

async function seed(e) {
  const put = (slug, rec, meta) => e.PROGRAMS.put(`program:${slug}`, JSON.stringify({ slug, ...rec }),
    { metadata: { created: "2026-09-01T10:00:00Z", tracks: 2, runtime: "6:00", ...meta } });
  await put("prof-1", {
    title: "The Forgery", dj: "The Librarian", created: "2026-09-01T10:00:00Z", playlistId: PID,
    sections: [{ heading: "h", tracks: [{ uri: "spotify:track:aaa" }, { uri: "spotify:track:bbb" }] }],
  }, { title: "The Forgery", dj: "The Librarian", catalog: "spotify" });
  await put("gate-1", {
    title: "Backwards", dj: "Gatefold", created: "2026-09-02T10:00:00Z", playlistId: TPID,
    sections: [{ heading: "h", tracks: [{ uri: "tidal:track:1" }, { uri: "tidal:track:2" }] }],
  }, { title: "Backwards", dj: "Gatefold", catalog: "tidal" });
  await put("arch-1", {
    title: "Every Soundboard", dj: ARCHIVE.name, created: "2026-09-03T10:00:00Z",
    playlistId: `archive:${ARCHIVE.key}`, archive: { key: ARCHIVE.key, loop: true },
    sections: [{ heading: "h", tracks: [{ uri: "archive:take:x-01" }, { uri: "archive:take:y-02" }] }],
  }, { title: "Every Soundboard", dj: ARCHIVE.name, catalog: "files" });
}

// A play Spotify accepts and confirms on the named speaker, on a track the
// set contains.
function playsOn(name) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({
        is_playing: true,
        item: { id: "aaa", name: "T", uri: "spotify:track:aaa", type: "track",
          duration_ms: 1000, artists: [{ name: "A" }], album: { name: "B" } },
        progress_ms: 10, device: { id: `device-${name}`, name }, context: null,
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

// A program's own page inside the app: Load, where it is on the air and the
// Tidal link live there since the grid (the owner chose B, 2026-09-23). The
// Shelf's card keeps only Play, or the service's name where Play cannot go.
const pageOf = async (e, slug) =>
  (await worker.fetch(get(`/buttons/${KEY}/programs/${slug}`), e)).text();

const rowOf = (html, slug) => {
  const at = html.indexOf(`/programs/${slug}"`);
  const start = html.lastIndexOf("<li", at);
  return at < 0 ? "" : html.slice(start, html.indexOf("</li>", at));
};

test("each row carries the action its service allows, and one speaker select serves them all", async () => {
  const e = env();
  await seed(e);
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    // The bar: one form, one select, the house default chosen, no submit of
    // its own — the rows' buttons are its submits.
    assert.match(html, new RegExp(`<form method="post" action="/notes/${KEY}/play" id="play" class="playbar">`));
    assert.match(html, /<option selected>Pro Plus<\/option><option>Master Bedroom<\/option>/);
    assert.match(html, /leaves\s+the presets as they are/);

    const prof = rowOf(html, "prof-1");
    assert.match(prof, /<button type="submit" form="play" name="slug" value="prof-1" class="play"\s+aria-label="Play The Forgery now"><svg[^>]*>[\s\S]*?<\/svg><span>Play<\/span><\/button>/);
    assert.ok(!prof.includes('class="put"'), "the card's one control is Play");
    assert.match(await pageOf(e, "prof-1"), /Load on preset<\/button>/, "and its page can still put it on his preset");
    // And it says where its Play goes, as a choice (2026-09-23): the shared
    // picker, visible, feeding the Play form from under the buttons.
    assert.match(await pageOf(e, "prof-1"), /<p class="pspk"><label for="pdev">Plays on the<\/label><select class="devsel" id="pdev" name="device" form="play" data-pick aria-label="Speaker to play on"><option selected>Pro Plus<\/option>/);

    const bad = rowOf(html, "gate-1");
    assert.ok(!bad.includes('form="play"'), "nothing here can start Tidal");
    assert.match(bad, /<span class="svc">Tidal<\/span>/, "the service's name where Play would be");
    const badPage = await pageOf(e, "gate-1");
    assert.ok(!badPage.includes('form="play"'), "nor on its page");
    assert.match(badPage, /Load on preset<\/button>/);

    const arch = rowOf(html, "arch-1");
    assert.ok(!arch.includes('form="play"'));
    assert.match(arch, /<span class="svc">Archive<\/span>/);
    assert.match(await pageOf(e, "arch-1"),
      /aria-label="Load Every Soundboard on the archive preset">Load on the archive preset<\/button>/);

    // Nothing was asked of Spotify to draw any of it.
    assert.ok(!f.calls.some((c) => /player|playlists/.test(c)), f.calls.join(", "));
  } finally { f.restore(); }
});

test("a live Tidal row says which number to press and opens the playlist in the app; a live archive row names 6", async () => {
  const e = env();
  await seed(e);
  await e.PROGRAMS.put(`current:${TPID}`, "gate-1");
  await e.PROGRAMS.put(`current:archive:${ARCHIVE.key}`, "arch-1");
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    // The cards wear the number to press (the grid, 2026-09-23)...
    assert.match(rowOf(html, "gate-1"), /<span class="num" aria-hidden="true">12<\/span><span class="svc">Tidal<\/span>/);
    assert.match(rowOf(html, "gate-1"), /<span class="cmeta"><b>Preset 12<\/b> · Gatefold/);
    assert.match(rowOf(html, "arch-1"), /<span class="num" aria-hidden="true">6<\/span>/);
    // ...and their pages say it, and open the Tidal one in the app.
    const bad = await pageOf(e, "gate-1");
    assert.match(bad, /<span class="onair">On Gatefold’s preset · press 12<\/span>/);
    assert.match(bad, new RegExp(`<a class="open" href="https://listen.tidal.com/playlist/${TPID}">Open in Tidal ↗</a>`));
    const arch = await pageOf(e, "arch-1");
    assert.match(arch, /<span class="onair">On the archive preset · press 6<\/span>/);
    assert.ok(!arch.includes('class="open"'), "the archive has no app to open");
    // A live Spotify set keeps its Play — the same tracks, started now.
    await e.PROGRAMS.put(`current:${PID}`, "prof-1");
    const again = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    assert.match(rowOf(again, "prof-1"), /form="play"/);
    const prof = await pageOf(e, "prof-1");
    assert.match(prof, /form="play"/);
    assert.match(prof, /<span class="onair">On The Librarian’s preset<\/span>/);
  } finally { f.restore(); }
});

test("Play starts the record's own tracks on the chosen speaker and writes no playlist", async () => {
  const e = env();
  await seed(e);
  const f = installFetch({ contents: [track("zzz")] });
  const restore = playsOn("Master Bedroom");
  try {
    const res = await worker.fetch(post(`/notes/${KEY}/play`,
      form({ slug: "prof-1", device: "Master Bedroom", dj: "the-librarian" })), e);
    assert.equal(res.status, 303);
    const loc = res.headers.get("location");
    assert.equal(loc, `/notes/${KEY}?played=ok&on=Master%20Bedroom&slug=prof-1&dj=the-librarian`);
    assert.ok(f.calls.some((c) => c === "PUT /me/player/play"), "the tracks were sent");
    assert.ok(!f.calls.some((c) => /playlists/.test(c)), `no playlist was read or written: ${f.calls.join(", ")}`);
    // No memory of its own (MC-28): the phone's choice below is the one.
    assert.equal(await e.PROGRAMS.get("room:lastdevice"), null);
    // And the Play is the phone's speaker choice for every page (2026-09-23):
    // the cookie the other pages' scripts read, and the Shelf's picker too.
    assert.match(res.headers.get("set-cookie"), /^spk=master-bedroom\.\d{10}; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);

    // The browser sends that choice back with the page it is sent to.
    const html = await (await worker.fetch(new Request(`https://x.test${loc}`,
      { headers: { cookie: res.headers.get("set-cookie").split(";")[0] } }), e)).text();
    assert.match(html, /<div class="flash"><p>Playing “The Forgery” on Master Bedroom\. Nothing on the presets changed\.<\/p>/);
    assert.match(html, /<option>Pro Plus<\/option><option selected>Master Bedroom<\/option>/,
      "and the select follows");
    // Undo is the chooser's; a play has nothing to undo.
    assert.ok(!html.includes("Undo —"));
  } finally { restore(); f.restore(); }
});

// A DJ CUT FROM THE HOUSE (the owner cut ten, 2026-10-13): a set one of
// them wrote that is still on the Shelf lists under the name it was written
// with, opens, and plays like any other.
test("a set whose DJ was cut from the house still shows on the Shelf, opens, and plays", async () => {
  const e = env();
  await seed(e);
  await e.PROGRAMS.put("program:cut-1", JSON.stringify({
    slug: "cut-1", title: "Sub Pop, 1989", dj: "Kurt", shape: "survey", created: "2026-09-04T10:00:00Z",
    playlistId: P(77),
    sections: [{ heading: "h", tracks: [{ uri: "spotify:track:aaa" }, { uri: "spotify:track:bbb" }] }],
  }), { metadata: { created: "2026-09-04T10:00:00Z", tracks: 2, runtime: "6:00",
    title: "Sub Pop, 1989", dj: "Kurt", catalog: "spotify" } });
  const f = installFetch({ contents: [track("zzz")] });
  const restore = playsOn("Pro Plus");
  try {
    const html = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    const row = rowOf(html, "cut-1");
    assert.match(row, /Sub Pop, 1989/, "listed");
    assert.match(row, /form="play"/, "with its Play");
    assert.match(row, /Kurt/, "under the name it was written with");
    const page = await worker.fetch(get(`/buttons/${KEY}/programs/cut-1`), e);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Sub Pop, 1989/);
    assert.equal((await worker.fetch(get("/programs/cut-1"), e)).status, 200, "and its public page");
    const res = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "cut-1", device: "Pro Plus" })), e);
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /played=ok/);
    assert.ok(f.calls.some((c) => c === "PUT /me/player/play"), "the tracks were sent");
    // And the Shelf's tool lists it.
    const listed = await __test.callTool(e, "list_programs", {}, { remaining: 40 });
    assert.ok(JSON.stringify(listed).includes("cut-1"), "list_programs names it");
  } finally { restore(); f.restore(); }
});

test("a play the speaker did not pick up is reported as sent, not as playing", async () => {
  const e = env();
  await seed(e);
  // The stub answers 204 to the player read, so nothing confirms.
  const f = installFetch();
  try {
    const res = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1" })), e);
    assert.equal(res.status, 303);
    const loc = res.headers.get("location");
    assert.ok(loc.startsWith(`/notes/${KEY}?played=sent&on=Pro%20Plus`), loc);
    const html = await (await worker.fetch(get(loc), e)).text();
    assert.match(html, /accepted “The Forgery” for Pro Plus, but it is not playing there yet/);
  } finally { f.restore(); }
});

test("a Tidal set and an archive set are refused in the words that say what to do instead", async () => {
  const e = env();
  await seed(e);
  const f = installFetch();
  try {
    const tidal = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "gate-1" })), e);
    assert.equal(tidal.status, 400);
    const why = await tidal.text();
    assert.match(why, /is on Tidal, which cannot be started from a page/);
    assert.match(why, /Put it on Gatefold(&#39;|')s preset from the shelf and press 12 on the remote/);

    const arch = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "arch-1" })), e);
    assert.equal(arch.status, 400);
    assert.match(await arch.text(), /Put it on the archive preset from the shelf and press 6 on the remote/);

    assert.ok(!f.calls.some((c) => /player/.test(c)), "neither reached the player");
  } finally { f.restore(); }
});

test("the route refuses GET, foreign origins, an unknown set, a bad device, and a quota lockout", async () => {
  const e = env();
  await seed(e);
  const f = installFetch();
  try {
    assert.equal((await worker.fetch(get(`/notes/${KEY}/play`), e)).status, 405);
    assert.equal((await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1" }),
      { origin: "https://evil.example" }), e)).status, 403);
    assert.equal((await worker.fetch(post(`/notes/${KEY}/play`, form({})), e)).status, 400);
    assert.equal((await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "gone-9" })), e)).status, 404);
    const dev = await worker.fetch(post(`/notes/${KEY}/play`,
      form({ slug: "prof-1", device: "My Phone" })), e);
    assert.equal(dev.status, 400);
    assert.match(await dev.text(), /not one of the configured speakers/);
    assert.equal((await worker.fetch(post(`/notes/wrongwrongwrong1/play`, form({ slug: "prof-1" })), e)).status, 404);

    await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 600000 }));
    const locked = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1" })), e);
    assert.equal(locked.status, 503);
    assert.match(await locked.text(), /cannot start a speaker until then/);
    assert.ok(!f.calls.some((c) => /player/.test(c)), "none of those reached the player");
  } finally { f.restore(); }
});

test("the flash reflects nothing it was not told by the shelf itself", async () => {
  const e = env();
  await seed(e);
  const f = installFetch();
  try {
    const html = await (await worker.fetch(
      get(`/notes/${KEY}?played=ok&on=Kitchen%20%3Cb%3E&slug=nope`), e)).text();
    assert.match(html, /Playing That set on the speaker\./);
    assert.ok(!html.includes("Kitchen"));
  } finally { f.restore(); }
});

test("a house with no Spotify login has no Play on the shelf at all", async () => {
  const e = env();
  await seed(e);
  delete e.SPOTIFY_CLIENT_ID;
  const f = installFetch();
  try {
    const html = await (await worker.fetch(get(`/notes/${KEY}`), e)).text();
    assert.ok(!html.includes('class="playbar"'));
    assert.ok(!html.includes('form="play"'));
    assert.match(rowOf(html, "prof-1"), /<div class="cover">/, "the card is still there");
    // Nor on the program's page, where the chooser is untouched.
    const page = await pageOf(e, "prof-1");
    assert.ok(!page.includes('form="play"') && !page.includes('id="play"'));
    assert.match(page, /Load on preset<\/button>/, "the chooser is untouched");
  } finally { f.restore(); }
});

// ==================================== the diff reviewed, 2026-09-10 (Codex)
//
// Four findings, all confirmed against the code. Three are about a set that
// is playing being described wrongly, and the fourth is a way home that went
// somewhere else.

test("a read-back that fails AFTER the tracks were sent is not a failure", async () => {
  // The play landed; only the verification did not. Saying "Spotify refused
  // the play request. Nothing was started" over a room that is playing invites
  // a retry that restarts the set — the rule this repo already carries as
  // "past the point of no return, a tool must not throw".
  const e = env();
  await seed(e);
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      throw new Error("network is gone");
    }
    if (u.pathname === "/v1/me/player/devices") {
      return new Response(JSON.stringify({ devices: [{ id: "device-Pro Plus", name: "Pro Plus" }] }),
        { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const res = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1" })), e);
    const loc = res.headers.get("location");
    assert.ok(loc.startsWith(`/notes/${KEY}?played=sent`), loc);
    assert.ok(!loc.includes("played=failed"), "the tracks were sent; only the read-back failed");
    const html = await (await worker.fetch(get(loc), e)).text();
    assert.ok(!/refused/.test(html), "and the page does not claim a refusal");
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("shuffle and repeat are cleared before the tracks go, and a device that keeps them says so", async () => {
  const e = env();
  await seed(e);
  const f = installFetch();
  const inner = globalThis.fetch;
  // A device that ignores both mode calls and plays the first track anyway:
  // every other check passes, which is exactly how a shuffled set reads clean.
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ is_playing: true,
        item: { id: "aaa", name: "T", uri: "spotify:track:aaa", type: "track",
          duration_ms: 1000, artists: [{ name: "A" }], album: { name: "B" } },
        progress_ms: 10, device: { id: "device-Pro Plus", name: "Pro Plus" }, context: null,
        shuffle_state: true, repeat_state: "track" }),
        { headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/v1/me/player/devices") {
      return new Response(JSON.stringify({ devices: [{ id: "device-Pro Plus", name: "Pro Plus" }] }),
        { headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  try {
    const res = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1" })), e);
    const loc = res.headers.get("location");
    assert.ok(loc.startsWith(`/notes/${KEY}?played=jumbled`), loc);
    const html = await (await worker.fetch(get(loc), e)).text();
    assert.match(html, /not playing in the order it was written/);
    // It tried to clear both before sending a note.
    assert.ok(f.calls.some((c) => c.startsWith("PUT /me/player/shuffle")), f.calls.join(", "));
    assert.ok(f.calls.some((c) => c.startsWith("PUT /me/player/repeat")), f.calls.join(", "));
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("a record carrying one foreign URI is refused whole, never played as a subset", async () => {
  // programCatalog reads the FIRST track that names a service, so a Spotify
  // record with a stray Tidal or malformed URI further down passed the gate —
  // and the filter then dropped those entries silently. A subset of a set is a
  // different set under this one's name.
  const e = env();
  await seed(e);
  await e.PROGRAMS.put("program:mix-1", JSON.stringify({
    slug: "mix-1", title: "Half A Set", dj: "The Librarian", created: "2026-09-04T10:00:00Z",
    playlistId: PID,
    sections: [{ heading: "h", tracks: [{ uri: "spotify:track:aaa" }, { uri: "tidal:track:7" }, { uri: "nonsense" }] }],
  }), { metadata: { title: "Half A Set", dj: "The Librarian", created: "2026-09-04T10:00:00Z",
    tracks: 3, runtime: "9:00", catalog: "spotify" } });
  const f = installFetch();
  try {
    const res = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "mix-1" })), e);
    assert.equal(res.status, 400);
    const why = await res.text();
    assert.match(why, /2 tracks recorded that this server cannot start/);
    assert.match(why, /a different set under this one(&#39;|')s name, so nothing was started/);
    assert.ok(!f.calls.some((c) => /player/.test(c)), "and nothing reached the player");
  } finally { f.restore(); }
});

test("every refusal from the shelf offers the way back to the shelf, not to the presets", async () => {
  const e = env();
  await seed(e);
  const f = installFetch();
  try {
    const res = await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "gone-9" })), e);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, new RegExp(`<a class="morelink" href="/notes/${KEY}" data-back><svg class="ic"[^>]*>[\\s\\S]*?</svg> back to the Shelf</a>`));
    assert.ok(!html.includes(`href="/buttons/${KEY}"`), "the reader was never on the presets page");
    // And the wall's own refusals are untouched.
    const wall = await worker.fetch(post(`/buttons/${KEY}/archive/play`, form({})), e);
    assert.match(await wall.text(), new RegExp(`<a class="morelink" href="/buttons/${KEY}" data-back><svg class="ic"[^>]*>[\\s\\S]*?</svg> Back</a>`));
  } finally { f.restore(); }
});

test("the Shelf's picker is drawn from the one speaker choice the other pages keep (the spk cookie)", async () => {
  const e = env();
  await seed(e);
  const f = installFetch({ contents: [track("zzz")] });
  try {
    const shelf = (cookie) => worker.fetch(new Request(`https://x.test/notes/${KEY}`, cookie ? { headers: { cookie } } : {}), e)
      .then((r) => r.text());
    const selected = (html) => html.match(/<select class="devsel" id="playdev"[\s\S]*?<\/select>/)[0].match(/<option selected>([^<]+)</)?.[1];
    assert.equal(selected(await shelf("spk=master-bedroom")), "Master Bedroom");
    assert.equal(selected(await shelf("other=1; spk=pro-plus")), "Pro Plus");
    // A slug that names no configured speaker is nobody's choice.
    assert.equal(selected(await shelf("spk=kitchen")), "Pro Plus");
    // And still no script on the Shelf.
    assert.ok(!/<script/.test(await shelf("spk=master-bedroom")));
  } finally { f.restore(); }
});

test("a set on a preset right now plays AS that preset, so every page can see it (2026-09-23)", async () => {
  const e = env();
  await seed(e);
  await e.PROGRAMS.put(`current:${PID}`, "prof-1");
  const f = installFetch({ contents: [track("zzz")] });
  const restore = playsOn("Master Bedroom");
  const bodies = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (String(u).includes("/me/player/play")) bodies.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  try {
    const res = await worker.fetch(post(`/notes/${KEY}/play`,
      form({ slug: "prof-1", device: "Master Bedroom" })), e);
    assert.equal(res.status, 303);
    assert.deepEqual(bodies[0], { context_uri: `spotify:playlist:${PID}` }, "the preset's playlist, not a queue");
    assert.ok(!f.calls.some((c) => /^(PUT|POST|DELETE) \/playlists/.test(c)), "and nothing written");
    // Not on a preset: its own tracks, as before.
    await e.PROGRAMS.delete(`current:${PID}`);
    bodies.length = 0;
    await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1", device: "Master Bedroom" })), e);
    assert.deepEqual(bodies[0]?.uris, ["spotify:track:aaa", "spotify:track:bbb"]);
  } finally { globalThis.fetch = inner; restore(); f.restore(); }
});

// A SHELF PROGRAM PAUSED FROM THE BAR PLAYS AGAIN (the owner, 2026-09-24):
// played as its own tracks it had no playlist, so every page called it "a
// queue of tracks" and the bar's disc was dim after a pause. The Shelf's
// Play writes down what it started; the pause keeps the rest of the list.
test("a program played from the Shelf is named as it, and the bar's play-again starts it where it was paused", async () => {
  const e = env();
  await seed(e);
  const f = installFetch({ contents: [track("zzz")] });
  const st = { playing: true, at: "aaa" };
  const bodies = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const m = init.method ?? "GET";
    if (u.pathname === "/v1/me/player" && m === "GET") {
      if (!st.playing) return new Response(null, { status: 204 });
      return Response.json({ is_playing: true,
        item: { id: st.at, name: `Song ${st.at}`, uri: `spotify:track:${st.at}`, type: "track",
          duration_ms: 200000, artists: [{ name: "A" }], album: { name: "B" } },
        progress_ms: 61000, device: { id: "device-mb", name: "Master Bedroom" }, context: null,
        shuffle_state: false, repeat_state: "off" });
    }
    if (u.pathname === "/v1/me/player/devices") return Response.json({ devices: [{ id: "device-mb", name: "Master Bedroom" }] });
    if (u.pathname === "/v1/me/player/play") bodies.push(JSON.parse(init.body ?? "{}"));
    if (u.pathname === "/v1/me/player/pause") { st.playing = false; return new Response(null, { status: 204 }); }
    return inner(url, init);
  };
  const transport = async (verb) => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
    method: "POST", headers: { accept: "application/json", origin: "https://x.test" },
    body: new URLSearchParams({ do: verb, device: "Master Bedroom" }) }), e)).json();
  const playing = async () => (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
  try {
    await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1", device: "Master Bedroom" })), e);
    assert.deepEqual(bodies.shift(), { uris: ["spotify:track:aaa", "spotify:track:bbb"] });
    st.at = "bbb";
    assert.equal((await playing()).from, "The Librarian · “The Forgery”");
    const paused = await transport("pause");
    assert.equal(paused.code, "ok");
    assert.equal(paused.paused.again, true, "the disc may play it again");
    assert.equal(paused.paused.from, "The Librarian · “The Forgery”");
    const quiet = await playing();
    assert.equal(quiet.paused.again, true);
    bodies.length = 0;
    st.playing = true;  // what the read-back after the play sees
    assert.equal((await transport("again")).code, "ok");
    assert.deepEqual(bodies[0], { uris: ["spotify:track:bbb"], position_ms: 61000 }, "from the paused song, at its place");
    // Any other queue is still a queue: no play-again.
    await e.PROGRAMS.delete("queue:shelf");
    st.at = "zzz";
    assert.equal((await playing()).from, "a queue of tracks");
  } finally { globalThis.fetch = inner; f.restore(); }
});

// Codex, 2026-09-24: another queue ends the Shelf's record, and a song on the
// program twice gets no play-again (it could not say which one it was).
test("the Shelf's record of what it started: cleared by play_uris, and no play-again for a song that is on the program twice", async () => {
  const e = env();
  await seed(e);
  const f = installFetch({ contents: [track("zzz")] });
  const restore = playsOn("Master Bedroom");
  try {
    await e.PROGRAMS.put("queue:shelf", JSON.stringify({ slug: "prof-1", title: "The Forgery", uris: ["spotify:track:aaa"], at: Date.now() }));
    await __test.callTool(e, "play_uris", { uris: ["spotify:track:aaa"], device: "Master Bedroom" }, { remaining: 40 });
    assert.equal(await e.PROGRAMS.get("queue:shelf"), null);
    await e.PROGRAMS.put("queue:shelf", JSON.stringify({ slug: "prof-1", title: "The Forgery",
      uris: ["spotify:track:aaa", "spotify:track:bbb", "spotify:track:aaa"], at: Date.now() }));
    const paused = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", headers: { accept: "application/json", origin: "https://x.test" },
      body: new URLSearchParams({ do: "pause", device: "Master Bedroom" }) }), e)).json();
    assert.equal(paused.paused.from, "the program “The Forgery”", "still named");
    assert.equal(paused.paused.again, false, "but not played again from a guess");
  } finally { restore(); f.restore(); }
});

// A SHELF PLAY SAYS WHOSE IT IS (the owner chose A, 2026-10-10: The
// Librarian's set played from the Shelf on the Ultra, and nothing showed which
// DJ or preset). The bar names the DJ, the panel's DJ row opens the program,
// and Loaded lights a row under the presets while it plays. Nothing is loaded
// on a preset.
test("a program played from the Shelf names its DJ on the bar and lights a row on Loaded", async () => {
  const e = env();
  await seed(e);
  const f = installFetch({ contents: [track("zzz")] });
  const restore = playsOn("Master Bedroom");
  const loaded = async () => (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
  const shelfRow = (html) => { const at = html.indexOf("data-shelfplay"); return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at)); };
  try {
    assert.match(shelfRow(await loaded()), /data-shelfplay hidden/, "nothing from the Shelf: the row is drawn hidden");
    await worker.fetch(post(`/notes/${KEY}/play`, form({ slug: "prof-1", device: "Master Bedroom" })), e);
    assert.equal(JSON.parse(await e.PROGRAMS.get("queue:shelf")).dj, "the-librarian");
    const o = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.deepEqual(o.who, { dj: "the-librarian", name: "The Librarian", kind: "program", program: { slug: "prof-1", title: "The Forgery" } });
    assert.equal(o.from, "The Librarian · “The Forgery”");
    const row = shelfRow(await loaded());
    assert.doesNotMatch(row, /data-shelfplay hidden/);
    assert.match(row, /Playing from the Shelf/);
    assert.match(row, /<h3 class="bname">The Librarian<\/h3>/);
    assert.match(row, /“The Forgery”/);
    assert.match(row, /On the Master Bedroom/);
    assert.match(row, new RegExp(`href="/buttons/${KEY}/programs/prof-1\\?from=the-librarian"`));
    assert.ok(!f.calls.some((c) => /^(PUT|POST|DELETE) \/playlists/.test(c)), "and no preset written");
  } finally { restore(); f.restore(); }
});
