// WHICH SERVICE A SET IS FOR: a programme's listing names its service, a
// request touches no music service, and the request form offers the service
// only where the house has both. MC-11's crates, which this file was written
// for, went with MC-18's stage 6 (2026-09-26).
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, buttons, installFetch, installTidalFetch, track, PID, TPID } from "./harness.js";

const { house } = __test;
const { parseAliases, callTool, reachableDj, shelfUnplaceable, undoToSnapshot } = __test;

const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const TID = "0b1f2c3d-aaaa-bbbb-cccc-000000000099";

// Hank on 2, the Selector on 7. Monk, Camille and the rest are benched, which is
// the state this whole document exists for. (Dr. Funkenstein stands for the
// bench below since Monk was cut, 2026-10-15.)
// ------------------------------------------------------------------ the parse

// ------------------------------------------------------- what a DJ is dressed with

// ------------------------------------------------------------------ the write

// ============================================================ step 2: the gates
//
// Everything below was refused for a DJ off the wall until 2026-09-09, and
// every refusal read `!dj.button` when what it actually wanted was somewhere to
// put songs. These are the six that changed, one at a time, plus the seam they
// all resolve through.

const KEY = "abcdefabcdefabcdefabcdef";
const get = (path) => new Request(`https://x.test${path}`);
const post = (path, body) => new Request(`https://x.test${path}`,
  { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

// Hank on 2. The Engineer is benched WITH a crate; Dr. Funkenstein (Monk until
// he was cut, 2026-10-15) is benched with nothing, which is what every refusal
// below still refuses.
// IN KV *AND* ON ENV, and the difference is the point: a route re-reads the
// document at the door and overwrites whatever env carried, so a fixture that
// only set env would test a house with no crates at all and pass. Direct calls
// to house()/callTool() take it off env, the way the door leaves it.
// =========================================================== step 3: the tool
//
// One call, one DJ, on demand. Thirteen benched DJs is thirteen more playlists
// in an account the owner is already keeping an eye on, and most of them will
// never be asked for anything.

// A house with no crates at all — the state every one of these starts from.
async function bareEnv(over = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  // With the Spotify requests preset live: a benched DJ's set goes there
  // (the crates this file was about went in stage 6).
  e.BUTTONS = JSON.stringify([...JSON.parse(buttons({ 2: P(2) })),
    { button: 1, guest: true, live: true, name: "Requests - Spotify", playlist: P(1), catalog: "spotify" }]);
  Object.assign(e, over);
  return e;
}

// ========================================================== step 4: the pages

test("every program's listing says which service its records are on", () => {
  const { programCatalog } = __test;
  const rec = (uri, over = {}) => ({
    sections: [{ tracks: [{ uri }] }], ...over });
  assert.equal(programCatalog(rec("spotify:track:aaa")), "spotify");
  assert.equal(programCatalog(rec("tidal:track:123")), "tidal");
  // An archive set's takes are on no service at all, and `files` is the word
  // the wall already uses for them.
  assert.equal(programCatalog({ archive: { key: "house" }, sections: [] }), "files");
  // A record with nothing to go on falls back to the playlist's own shape,
  // then to null — blank rather than guessed, because a wrong mark tells a
  // reader a set can be played where it cannot.
  assert.equal(programCatalog({ sections: [], playlistId: "0b1f2c3d-aaaa-bbbb-cccc-000000000012" }), "tidal");
  assert.equal(programCatalog({ sections: [] }), null);
  assert.equal(programCatalog(null), null);
  // The first track that has one decides; a section with none is walked past.
  assert.equal(programCatalog({ sections: [{ tracks: [{}] }, { tracks: [{ uri: "tidal:track:9" }] }] }), "tidal");
});

// ==================================================== what the review found
//
// A Codex pass over steps 1-4 on 2026-09-09. Every one of these is a way a
// write could land somewhere nobody asked for, or a real playlist in somebody's
// music account could be orphaned. They are pinned here because none of them
// announces itself: each needs a second failure or a config nobody has yet.

// ============================================ the crate makes itself (2026-09-10)
//
// The owner, seeing the crate deploy: why does having one mean asking Claude
// for it first? It does not now. A DJ with no playlist gets one when their
// FIRST REQUEST IS FULFILLED — never when it is sent, because sending only
// writes the ledger and must keep working through a Spotify lockout, and a
// request the DJ declines must leave nothing behind.

const FIRST_CRATE = "0000000000000000000066";

// The two Spotify calls a first crate makes, over the harness's playlist fake:
// the account listing (empty, or holding an orphan) and the create. Installed
// AFTER installFetch so everything else falls through to it.
function withCrateCalls({ listing = [] } = {}) {
  const real = globalThis.fetch;
  const made = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    if (u.pathname === "/v1/me/playlists" && method === "GET") {
      return new Response(JSON.stringify({ items: listing, next: null }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/v1/me/playlists" && method === "POST") {
      const body = JSON.parse(init.body);
      made.push(body);
      return new Response(JSON.stringify({ id: FIRST_CRATE, name: body.name,
        external_urls: { spotify: "https://open.spotify.com/playlist/x" } }),
        { status: 201, headers: { "content-type": "application/json" } });
    }
    return real(url, init);
  };
  return { made, restore: () => { globalThis.fetch = real; } };
}

test("sending a request touches no music service — only the ledger is written", async () => {
  // The form never talks to a music service, so a lockout cannot break it.
  const e = await bareEnv({ REQUESTS_ENABLED: "true" });
  const f = installFetch();
  const c = withCrateCalls();
  try {
    const res = await worker.fetch(post(`/buttons/${KEY}/dr-funkenstein/request`,
      new URLSearchParams({ mood: "west coast cool", length: "60" })), e);
    assert.equal(res.status, 303);
    assert.equal(c.made.length, 0, "no playlist is made by an ask");
    assert.deepEqual(f.calls, [], "and no music service was asked anything at all");
    assert.equal(e.STATION.rows.size, 1, "the ask is in the ledger");
  } finally { c.restore(); f.restore(); }
});

// ================================ what "can be played" means (Codex, 2026-09-10)
//
// A Spotify crate is started from here over Connect; a Tidal crate is only
// opened in its app; a preset is pressed. Three sentences used to promise a
// speaker for all of them.

// ================================== a crate per service (2026-09-10)
//
// One crate per DJ put a one-way door in front of the user: the first set's
// service decided the crate for good, silently. The owner: "I think that gets
// confusing for the user." A DJ holds one crate per service now, each made
// the moment a set on that service is first written; the user sees "the
// crate" and the set's own tracks decide which one. The only choice that
// surfaces is on the request form, for a benched DJ in a mixed house.

// A house on both services, Dr. Funkenstein on the bench with nothing (Monk
// until he was cut, 2026-10-15).
async function mixedEnv(over = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([
    { button: 2, dj: "hank", playlist: P(2), catalog: "spotify" },
    { button: 12, dj: "americana", playlist: TID, catalog: "tidal" },
    { button: 1, guest: true, live: true, name: "Requests - Spotify", playlist: P(1), catalog: "spotify" },
    { button: 11, guest: true, live: true, name: "Requests - Tidal", playlist: "0b1f2c3d-aaaa-bbbb-cccc-000000000011", catalog: "tidal" },
  ]);
  e.REQUESTS_ENABLED = "true";
  Object.assign(e, over);
  return e;
}

test("the request form offers the service only to a benched DJ in a house on both", async () => {
  const e = await mixedEnv();
  const f = installFetch({ contents: [track("a")] });
  const td = installTidalFetch({ contents: ["1"] });
  try {
    const funk = await (await worker.fetch(get(`/buttons/${KEY}/dr-funkenstein`), e)).text();
    // In plain sight since 2026-09-27, a dropdown beside the length since
    // 2026-10-24 (the owner: "drop downs"), not in the fold.
    assert.match(funk, /<div class="askrow asksel">[^]*?<label class="asksl"><span class="vh">Which service<\/span><select class="devsel" name="service">/);
    assert.ok(funk.indexOf('name="service"') < funk.indexOf('<details class="askmore">'), "above the fold, not in it");
    assert.match(funk, /<summary>Examples, what to avoid<\/summary>/);
    assert.match(funk, /localStorage\.getItem\("ask:service"\)/, "this phone's last choice comes back");
    // While a text field has the focus the bars step out, so an iPhone cannot strand them (2026-09-27).
    assert.match(funk, /body:has\(textarea:focus[^{]*\.nowbar\{display:none\}/);
    assert.match(funk, /document\.addEventListener\("focusout"[\s\S]*?window\.scrollTo\(window\.scrollX, window\.scrollY\)/);
    assert.match(funk, /<option value="spotify" selected>Spotify<\/option>/,
      "Spotify first and chosen — a form sent without a thought lands where it always did");
    assert.match(funk, /<option value="tidal">Tidal<\/option>/);
    // A tenant's set goes on their preset, whatever it uses: no choice.
    const hank = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    assert.ok(!hank.includes('name="service"'), "a tenant is not asked");
  } finally { td.restore(); f.restore(); }
  // And a house on one service has nothing to choose.
  const one = await bareEnv({ REQUESTS_ENABLED: "true" });
  const f2 = installFetch({ contents: [] });
  try {
    const funk = await (await worker.fetch(get(`/buttons/${KEY}/dr-funkenstein`), one)).text();
    assert.ok(!funk.includes('name="service"'));
  } finally { f2.restore(); }
});

test("the ask keeps the service it chose, and only a choice the form could offer", async () => {
  const e = await mixedEnv();
  const f = installFetch();
  try {
    const sent = await worker.fetch(post(`/buttons/${KEY}/dr-funkenstein/request`,
      new URLSearchParams({ mood: "west coast cool", length: "60", service: "tidal" })), e);
    assert.equal(sent.status, 303);
    const [id] = [...e.STATION.rows.keys()];
    const rec = JSON.parse(await e.PROGRAMS.get(`request:${id}`));
    assert.equal(rec.service, "tidal");
    assert.deepEqual(f.calls, [], "the ask still touches no music service");

    // A tenant's ask ignores it — their set goes on their preset.
    const t = await worker.fetch(post(`/buttons/${KEY}/hank/request`,
      new URLSearchParams({ mood: "trains", length: "60", service: "tidal" })), e);
    assert.equal(t.status, 303);
    const hankId = [...e.STATION.rows.keys()].find((k) => k !== id);
    assert.equal(JSON.parse(await e.PROGRAMS.get(`request:${hankId}`)).service, undefined);
  } finally { f.restore(); }
  // A service the house has not got is not a choice, however the POST is built.
  const one = await bareEnv({ REQUESTS_ENABLED: "true" });
  const f2 = installFetch();
  try {
    const sent = await worker.fetch(post(`/buttons/${KEY}/dr-funkenstein/request`,
      new URLSearchParams({ mood: "x", length: "60", service: "tidal" })), one);
    assert.equal(sent.status, 303);
    const [id] = [...one.STATION.rows.keys()];
    assert.equal(JSON.parse(await one.PROGRAMS.get(`request:${id}`)).service, undefined);
  } finally { f2.restore(); }
});

// ============= the two crates, seen by everything downstream (2026-09-11)
//
// Found live the night the per-service crate shipped: three of Youp's Tidal
// sets, fulfilled into his Tidal crate and ticked keep, were left without
// pages by the sweep and vanished from his page. Both readers still assumed
// `dj.alias` — the PRIMARY crate, Spotify's — was the playlist a set was
// written to.

// ====================== the other crate tells its own story (2026-09-11)
//
// The owner, on Tempo's page: a block reading "17 tracks on Tidal" above a
// request row reading "ready", and the kept set not on the shelf yet. Two
// halves of one story on one screen. The other crate's block carries the
// ask that produced it and the program loaded there, and the request row
// retires against it the way it retires against the primary.
