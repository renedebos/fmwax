// THE HOUSE COUNTS THE RULES IT CAN (2026-10-18; setcheck.js): measured on the
// 160 sets the house had backed up, where Genre's Pub Rock set of 2026-10-17
// put the same act back to back four times. Sent back once, then written as
// sent, so the music never waits on a rule.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, track } from "./harness.js";
import { setBreaks, titleBase } from "../setcheck.js";
import { station } from "../station.js";
import { PERSONAS } from "../djs.js";

const { callTool, endlessJobs } = __test;
const b = () => ({ remaining: 40 });
const T = (lead, title, album = "An Album", ms = 4 * 60000, uri = `${lead}|${title}`) => ({ uri, lead, title, album, ms });
const GENRE = PERSONAS.genre.spacing;

test("the breaks a machine can count, in words", () => {
  assert.deepEqual(setBreaks([T("Dr. Feelgood", "Roxette"), T("Kursaal Flyers", "When the Band's on the Stand"),
    T("Kursaal Flyers", "Little Does She Know"), T("Ducks Deluxe", "Fireball")], GENRE),
  ["songs 2 and 3 are both Kursaal Flyers"], "Genre's Pub Rock set, 2026-10-17");
  assert.deepEqual(setBreaks([T("X", "a"), T("Y", "b"), T("X", "c"), T("Z", "d"), T("X", "e")], GENRE),
    ["X is on 3 songs inside an hour (1, 3, 5)"]);
  assert.deepEqual(setBreaks([T("X", "a", "", 30 * 60000), T("Y", "b", "", 40 * 60000), T("X", "c", "", 30 * 60000),
    T("Z", "d"), T("X", "e")], GENRE), [], "three in an hour and three quarters is not three in an hour");
  assert.deepEqual(setBreaks([T("Lee Fields & The Expressions", "Will I Get Off Easy"),
    T("Lee Fields & The Expressions", "Will I Get Off Easy (Instrumental)"), T("Q", "z")], null),
  ['songs 1 and 2 are both "Will I Get Off Easy"'], "Hank, 2026-10-03: any DJ, a song beside its own version");
  assert.deepEqual(setBreaks([T("A", "a", "", 1, "u1"), T("B", "b"), T("C", "c", "", 1, "u1")], null),
    ['songs 1 and 3 are the same recording ("a")']);
  assert.deepEqual(setBreaks([T("A", "a"), T("A", "b"), T("A", "c"), T("B", "d"), T("C", "e"), T("D", "f")], PERSONAS.soul.spacing),
    ["songs 1 to 3 are all A"], "Soul: two in a row from one act, never three");
  assert.deepEqual(setBreaks([T("A", "a"), T("B", "b"), T("A", "c")], PERSONAS.vibe.spacing), ["A is on 2 songs (1, 3)"]);
  assert.deepEqual(setBreaks([T("Isaac Hayes", "Soulsville", "Shaft"), T("Isaac Hayes", "Theme From Shaft", "Shaft"),
    T("Isaac Hayes", "Joy", "Joy")], PERSONAS["deep-dive"].spacing), ["songs 1 and 2 are both from Shaft"]);
  assert.deepEqual(setBreaks([T("K", "b"), T("L", "c"), T("M", "d")], GENRE, { before: T("K", "a") }),
    ["song 1 follows the list's last song by the same act (K)"], "a top-up counts the list's last song");
  assert.deepEqual(setBreaks([T("K", "Roxette"), T("L", "c"), T("M", "d")], null, { before: T("J", "Roxette - Live") }),
    ["song 1 is \"Roxette - Live\" again, right after the list's last song"]);
});

test("what the ask made a set is not counted against it", () => {
  const nardis = ["Joe Henderson Sextet", "Bill Evans", "Mick Goodrick", "John Abercrombie Quartet"].map((a) => T(a, "Nardis"));
  assert.deepEqual(setBreaks(nardis, GENRE), [], "four Nardis, asked for");
  const ray = ["What'd I Say", "Hit the Road Jack", "Georgia on My Mind", "I Got a Woman"].map((t) => T("Ray Charles", t));
  assert.deepEqual(setBreaks(ray, PERSONAS.soul.spacing), [], "an hour of Ray Charles, asked of Soul");
  assert.deepEqual(setBreaks([T("A", "a"), null, T("A", "b"), null], GENRE), [], "a song the ledger never saw is not counted");
  assert.equal(titleBase("(Sittin' On) The Dock of the Bay - 2018 Remaster"), "thedockofthebay");
});

test("search_tracks keeps what it showed, and a request set that breaks a rule is sent back once", async () => {
  const sp = installFetch({});
  const inner = globalThis.fetch;
  const songs = { "1": ["Prince", "Kiss"], "2": ["Prince", "Raspberry Beret"], "3": ["Chic", "Good Times"] };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/search") {
      const n = url.searchParams.get("q").slice(-1);
      return Response.json({ tracks: { items: [track(`t${n}`.padEnd(22, "0"), songs[n][1], songs[n][0])] } });
    }
    return inner(u, init);
  };
  try {
    const KEY = "abcdefabcdefabcdefabcdef";
    const e = makeEnv();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.REQUESTS_ENABLED = "true";
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" }]);
    await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/request`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: "mood=a%20party&length=60" }), e);
    const found = await callTool(e, "search_tracks", { queries: ["song 1", "song 2", "song 3"] }, b());
    const uris = found.resolved.map((r) => r.results[0].uri);
    const seen = await station(e, "seen-get", { uris });
    assert.equal(seen.tracks[uris[0]].lead, "Prince");
    assert.equal(seen.tracks[uris[2]].title, "Good Times");
    const { request_id } = (await callTool(e, "list_requests", {}, b())).requests[0];
    await assert.rejects(callTool(e, "fulfill_request", { request_id, uris }, b()),
      /Not written: this set breaks rules the house counts for Vibe \(never two tracks by the same artist in one set; .*Prince is on 2 songs \(1, 2\)\. Reorder or swap/);
    assert.equal((await callTool(e, "list_requests", {}, b())).requests[0].state, "pending", "nothing was claimed");
    const out = await callTool(e, "fulfill_request", { request_id, uris }, b());
    assert.equal(out.status, "ready", "sent back once, then written as sent");
    assert.deepEqual(out.written_as_sent, ["Prince is on 2 songs (1, 2)"]);
  } finally { globalThis.fetch = inner; sp.restore(); }
});

// CODEX'S REVIEW (2026-10-18): four of six by one act passed Vibe, and an
// original and its remaster five songs apart passed everyone.
test("a one-artist set is excused only where the DJ's rules allow one, and a song twice is caught anywhere", () => {
  const four = [T("A", "a"), T("A", "b"), T("A", "c"), T("A", "d"), T("B", "e"), T("C", "f")];
  assert.deepEqual(setBreaks(four, PERSONAS.vibe.spacing), ["A is on 4 songs (1, 2, 3, 4)"], "Vibe: one song an act, always");
  assert.deepEqual(setBreaks(four, GENRE), ["songs 1 to 4 are all A", "A is on 3 songs inside an hour (1, 2, 3)"], "Genre: never");
  assert.deepEqual(setBreaks(four, PERSONAS.soul.spacing), [], "Soul: an hour of one act is a set it may be asked for");
  assert.deepEqual(setBreaks([T("Isaac Hayes", "Theme From Shaft"), T("B", "b"), T("C", "c"), T("D", "d"),
    T("Isaac Hayes", "Theme From Shaft - Remastered 2009", "Shaft (Deluxe)", 1, "other-uri")], null),
  ["songs 1 and 5 are both Isaac Hayes's \"Theme From Shaft\""]);
  assert.deepEqual(setBreaks([T("Nick Lowe", "The Beast in Me"), T("B", "b"), T("Johnny Cash", "The Beast in Me")], null), [],
    "another act's record of the song is not that song twice");
});

test("the curator reads the spacing from the one place the house counts it", async () => {
  const { TOOLS } = await import("../toollist.js");
  for (const name of ["extend_endless", "fulfill_request"]) {
    const d = TOOLS.find((t) => t.name === name).description;
    for (const p of Object.values(PERSONAS).filter((x) => x.spacing)) assert.ok(d.includes(`${p.name}: ${p.spacing.say}`), `${name}: ${p.name}`);
  }
});

// MC-33 (the owner, 2026-10-24): a set asked of a DJ in the Claude app,
// ChatGPT or Talk is counted too. No request id, so "once" is the DJ on that
// playlist within 15 minutes, and the write that answers a send-back uses it.
test("replace_playlist naming a DJ is counted as the curator's sets are: sent back once, then written as sent", async () => {
  const sp = installFetch({});
  const inner = globalThis.fetch;
  const songs = { "1": ["Prince", "Kiss"], "2": ["Prince", "Raspberry Beret"], "3": ["Chic", "Good Times"] };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/search") {
      const n = url.searchParams.get("q").slice(-1);
      return Response.json({ tracks: { items: [track(`t${n}`.padEnd(22, "0"), songs[n][1], songs[n][0])] } });
    }
    return inner(u, init);
  };
  try {
    const e = makeEnv();
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" }]);
    const found = await callTool(e, "search_tracks", { queries: ["song 1", "song 2", "song 3"] }, b());
    const uris = found.resolved.map((r) => r.results[0].uri);
    const write = (env, extra = {}) => callTool(env, "replace_playlist", { playlist: "button 1", uris, ...extra }, b());
    const before = sp.state.contents.map((t) => t.uri);

    await assert.rejects(write(e, { dj: "vibe" }),
      /Not written: this set breaks rules the house counts for Vibe \(never two tracks by the same artist in one set; .*Prince is on 2 songs \(1, 2\)\. Reorder or swap/);
    assert.deepEqual(sp.state.contents.map((t) => t.uri), before, "nothing was written");
    const second = await write(e, { dj: "vibe" });
    assert.equal(second.tracks, 3, "sent back once, then written as sent");
    assert.deepEqual(second.written_as_sent, ["Prince is on 2 songs (1, 2)"]);
    assert.deepEqual(sp.state.contents.map((t) => t.uri), uris);

    await assert.rejects(write(e, { dj: "vibe" }), /Not written/, "the send-back was used: the next set is counted afresh");
    const plain = await write(e);
    assert.equal(plain.written_as_sent, undefined, "no DJ named, nothing counted");
    const talk = await write({ ...e, __via: "talk" }, { dj: "vibe" });
    assert.deepEqual(talk.written_as_sent, ["Prince is on 2 songs (1, 2)"], "Talk's write answers the send-back as the app's does");

    const day = (await callTool(e, "list_requests", {}, b())).rules_sent_back_24h;
    assert.deepEqual(day, { requests: 0, endless: 0, chat_and_talk: 2 });
  } finally { globalThis.fetch = inner; sp.restore(); }
});

test("a chat write's send-back lapses after its window; a request's keeps the week", async () => {
  const e = makeEnv();
  await station(e, "sent-back", { key: "write:p:vibe" });
  await station(e, "sent-back", { key: "req:r1" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await station(e, "seen-get", { key: "write:p:vibe", uris: [], sent_within_ms: 1 })).sent_back, false);
  assert.equal((await station(e, "seen-get", { key: "write:p:vibe", uris: [], sent_within_ms: 15 * 60000 })).sent_back, true);
  assert.equal((await station(e, "seen-get", { key: "req:r1", uris: [] })).sent_back, true);
  await station(e, "sent-used", { key: "write:p:vibe" });
  assert.equal((await station(e, "seen-get", { key: "write:p:vibe", uris: [], sent_within_ms: 15 * 60000 })).sent_back, false);
  assert.deepEqual(await station(e, "sent-back-day", {}), { ok: true, requests: 1, endless: 0, chat_and_talk: 1 },
    "a used send-back still counts for the day");
});
