// THE HOUSE'S WEEK (the owner, 2026-11-07; week.js): every song a DJ put in
// front of the house in the last seven days, whoever the DJ and whichever
// the preset, so the next set leaves it out. Written sets count once they
// land; an endless DJ's once they play. Never an undo or a restore. Tracks
// only, by the exact recording. Flagged on a chat write, sent back once on a
// request's or an endless job's.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, track } from "./harness.js";
import { station, weekList, weekRepeats, WEEK_MS, WEEK_REDO_MS } from "../station.js";
import { endlessRemember } from "../endless.js";
import { HOUSE_RULES } from "../djs.js";

const { callTool, endlessWatch, endlessJobs } = __test;
const b = () => ({ remaining: 40 });
const T = (n) => `spotify:track:${String(n).padStart(22, "x")}`;
const MIN = 60_000;
const OTHER = "0000000000000000000002";
const week = (e) => e.STATION.week;

function house() {
  const e = makeEnv();
  e.PLAYLIST_ALIASES = JSON.stringify({ scratch: "0000000000000000000001", other: OTHER });
  return e;
}

test("the rules: a repeat is a song the week holds, never one older, never this playlist's own fix", () => {
  const now = Date.parse("2026-11-07T20:00:00Z");
  const rows = [
    { uri: "a", label: "A — a", at: now - 2 * 24 * 3600e3, playlist: "p1", dj: "soul" },
    { uri: "b", label: "B — b", at: now - WEEK_MS - 1, playlist: "p1", dj: "soul" },
    { uri: "c", label: "C — c", at: now - 10 * MIN, playlist: "p2", dj: "vibe" },
    { uri: "a", label: "A — a", at: now - 3 * 24 * 3600e3, playlist: "p2", dj: "hank" },
  ];
  assert.deepEqual(weekRepeats(rows, ["a", "b", "c", "z"], { playlist: "p9", now }).map((r) => r.uri), ["a", "c"],
    "b is eight days old: out of the week");
  assert.equal(weekRepeats(rows, ["a"], { now })[0].dj, "soul", "the newest write it was in");
  assert.deepEqual(weekRepeats(rows, ["c"], { playlist: "p2", now }), [],
    "the same playlist half an hour on is the set being fixed, not a song heard again");
  assert.deepEqual(weekRepeats([{ ...rows[2], at: now - WEEK_REDO_MS - 1 }], ["c"], { playlist: "p2", now }).map((r) => r.uri), ["c"],
    "past half an hour, the same playlist's song is a repeat like any");
});

test("the list: newest first, each song once by recording and by name, unnamed ones left out, the rest counted", () => {
  const now = Date.now();
  const rows = [
    { seq: 1, uri: "a", label: "Prince — Kiss", at: now - 3 * 3600e3 },
    { seq: 2, uri: "a", label: "Prince — Kiss", at: now - 1 * 3600e3 },
    { seq: 3, uri: "a2", label: "Prince — Kiss", at: now - 2 * 3600e3 },
    { seq: 4, uri: "b", label: "Chic — Good Times", at: now - 4 * 3600e3 },
    { seq: 5, uri: "c", label: null, at: now - 5 * 3600e3 },
    { seq: 6, uri: "d", label: "Old — Song", at: now - WEEK_MS - 1 },
  ];
  assert.deepEqual(weekList(rows, { now }), { songs: ["Prince — Kiss", "Chic — Good Times"], more: 0 });
  assert.deepEqual(weekList(rows, { now, max: 1 }), { songs: ["Prince — Kiss"], more: 1 });
});

test("a set written to a playlist is logged once it lands, read back in every DJ's brief, and flagged when it comes back", async () => {
  const sp = installFetch({ contents: [track("old1")] });
  try {
    const e = house();
    const first = await callTool(e, "replace_playlist", { playlist: "scratch", uris: [T(1), T(2), T(3)], dj: "soul" }, b());
    assert.equal(first.repeats, undefined, "nothing this week yet");
    assert.equal(week(e).length, 3, "one row a song");
    assert.equal(new Set(week(e).map((r) => r.write_id)).size, 1, "one entry for the write");
    assert.deepEqual(week(e).map((r) => [r.label, r.dj, r.catalog, r.source]),
      [1, 2, 3].map((n) => [`Someone — Track ${"x".repeat(21)}${n}`, "soul", "spotify", "written"]),
      "names from the write's own read-back");

    const dj = await callTool(e, "get_dj", { name: "Hank" }, b());
    assert.equal(dj.played_last_7_days.length, 3, "another DJ's brief carries the house's week");
    assert.match(dj.house_rules, /NOT THIS WEEK\. A track in played_last_7_days stays out of a new set unless the listener named it/);

    // Another playlist an hour on: two of the three are this week's.
    const later = await callTool(e, "replace_playlist", { playlist: "other", uris: [T(2), T(4), T(3)] }, b());
    assert.equal(later.repeats.length, 2);
    assert.match(later.repeats[0], new RegExp(`^Someone — Track x+2 \\(within the hour, Soul\\)$`));
    assert.match(later.repeats_note, /Written as sent/, "flagged, never refused");
    assert.equal(sp.state.contents.length, 3, "the set was written as sent");

    // An append is checked the same way.
    const added = await callTool(e, "append_to_playlist", { playlist: "other", uris: [T(1), T(5)] }, b());
    assert.equal(added.repeats.length, 1);
    assert.match(added.repeats[0], /Track x+1/);
  } finally { sp.restore(); }
});

test("a set fixed on the same playlist minutes later is not its own repeat", async () => {
  const sp = installFetch({ contents: [] });
  try {
    const e = house();
    await callTool(e, "replace_playlist", { playlist: "scratch", uris: [T(1), T(2), T(3)] }, b());
    const fixed = await callTool(e, "replace_playlist", { playlist: "scratch", uris: [T(1), T(9), T(3)] }, b());
    assert.equal(fixed.repeats, undefined, "swap song 2: the other two are the same set");
    assert.equal(week(e).length, 6, "each write is still its own entry");
  } finally { sp.restore(); }
});

test("an undo is not a new choice: restore_playlist logs nothing", async () => {
  const sp = installFetch({ contents: [track("old1"), track("old2")] });
  try {
    const e = house();
    await callTool(e, "replace_playlist", { playlist: "scratch", uris: [T(1), T(2)] }, b());
    assert.equal(week(e).length, 2);
    const out = await callTool(e, "restore_playlist", { playlist: "scratch", confirm: true }, b());
    assert.ok(out.restored ?? out.tracks ?? out.ok !== false);
    assert.deepEqual(sp.state.contents.map((t) => t.uri), ["spotify:track:old1", "spotify:track:old2"], "the old set is back");
    assert.deepEqual(week(e).map((r) => r.uri), [T(1), T(2)], "and the week holds only the set that was written");
  } finally { sp.restore(); }
});

test("the week lasts seven days: older writes leave the list and the table", async () => {
  const e = house();
  const now = Date.now();
  await station(e, "played-log", { rows: [[T(1), "Old — One"]], playlist: "p", now: now - WEEK_MS - 2 * MIN });
  await station(e, "played-log", { rows: [[T(2), "New — Two"]], playlist: "p", now: now - MIN });
  assert.deepEqual((await station(e, "played-list", {})).songs, ["New — Two"]);
  assert.deepEqual(week(e).map((r) => r.uri), [T(2)], "pruned on the next write");
  assert.deepEqual((await station(e, "played-log", { rows: [[T(1), "Old — One"]], playlist: "q" })).repeats, [],
    "and is no repeat any more");
});

test("a request's set holding a song from this week is sent back once, then written as sent and logged", async () => {
  const sp = installFetch({});
  const inner = globalThis.fetch;
  const songs = { "1": ["Prince", "Kiss"], "2": ["Chic", "Good Times"], "3": ["Sade", "Smooth Operator"] };
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
    const e = house();
    e.PROGRAM_LIBRARY_KEY = KEY;
    e.REQUESTS_ENABLED = "true";
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" }]);
    const found = await callTool(e, "search_tracks", { queries: ["song 1", "song 2", "song 3"] }, b());
    const uris = found.resolved.map((r) => r.results[0].uri);
    // Sade played on another preset two days ago.
    await station(e, "played-log", { rows: [[uris[2], null]], dj: "soul", playlist: "elsewhere", now: Date.now() - 2 * 24 * 3600e3 });
    assert.equal(week(e)[0].label, "Sade — Smooth Operator", "a song logged without a name takes the one search_tracks showed");

    await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/request`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: "mood=a%20party&length=60" }), e);
    const queue = await callTool(e, "list_requests", {}, b());
    assert.equal(queue.played_last_7_days, undefined, "not in the queue: the curator reads it in get_dj, once");
    assert.deepEqual((await callTool(e, "get_dj", { name: "Vibe" }, b())).played_last_7_days, ["Sade — Smooth Operator"]);
    const { request_id } = queue.requests[0];
    await assert.rejects(callTool(e, "fulfill_request", { request_id, uris }, b()),
      /Not written: .*song 3 was already played this week \(Sade — Smooth Operator \(2 days ago, Soul\)\): keep one only if the listener asked for it by name/);
    const out = await callTool(e, "fulfill_request", { request_id, uris }, b());
    assert.equal(out.status, "ready", "sent back once, then written as sent: the listener may have named it");
    assert.match(out.written_as_sent[0], /song 3 was already played this week/);
    assert.deepEqual(week(e).slice(1).map((r) => [r.uri, r.dj, r.btn]), uris.map((u) => [u, "vibe", 1]),
      "the request's set is this week's now, on preset 1");
  } finally { globalThis.fetch = inner; sp.restore(); }
});

// ONLY WHAT PLAYED (2026-09-25) holds for the week too: an endless list is
// written ahead and often never heard.
test("an endless DJ's songs are this week's as they play, never as they are written", async () => {
  const PL = "SAMPLEPLAYLIST00000013";
  const sp = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch;
  const player = { at: 0 };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return Response.json({ is_playing: true, device: { name: "Pro Plus", id: "d1" }, context: { uri: `spotify:playlist:${PL}` },
        progress_ms: 0, item: { uri: `spotify:track:t${player.at}`, name: `Track t${player.at}`, artists: [{ name: "Someone" }] } });
    }
    if (String(u).startsWith("https://api.anthropic.com/")) return Response.json({ type: "routine_fire" });
    return inner(u, init);
  };
  try {
    const e = house();
    e.HOUSE_TZ = "America/Los_Angeles";
    e.AUTOFULFILL_ENABLED = "true";
    e.REQUEST_ROUTINE_ID = "trig_test";
    e.REQUEST_ROUTINE_TOKEN = "routine-token";
    e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12,
      presets: [{ button: 4, dj: "vibe", playlist: PL, hours: 4, topupMinutes: 20, batchMinutes: 45 }] });
    let t = Date.now() - 50 * MIN;
    await endlessWatch(e, t);
    assert.deepEqual(week(e).map((r) => r.uri), ["spotify:track:t0"], "the song playing at the first look");
    player.at = 8;
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(week(e).length, 9, "t0 to t8, heard; t9, written and not yet heard, is not");
    assert.ok(week(e).every((r) => r.source === "played" && r.dj === "vibe" && r.btn === 4));

    const [job] = await endlessJobs(e);
    // A song another DJ's request played this week: sent back once.
    await station(e, "played-log", { rows: [[T(1), "Someone — Elsewhere"]], dj: "soul", playlist: "elsewhere" });
    await assert.rejects(callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, b()),
      /song 1 was already played this week/);
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, b());
    assert.equal(out.status, "added");
    assert.ok(![T(2), T(3)].some((u) => week(e).some((r) => r.uri === u)), "a top-up's songs are not logged as written");
  } finally { globalThis.fetch = inner; sp.restore(); }
});

test("endlessRemember answers what it added, so only newly heard songs are logged", () => {
  const state = { history: { vibe: [["a", "A — a"]] } };
  const added = endlessRemember(state, { dj: "vibe", noRepeatSongs: 150 }, [["a", 1, "A — a"], ["b", 1, "B — b"]]);
  assert.deepEqual(added, [["b", "B — b"]]);
  assert.deepEqual(endlessRemember(state, { dj: "vibe", noRepeatSongs: 150 }, [["a", 1, "A — a"], ["b", 1, "B — b"]]), []);
});

test("the house rule is the owner's, word for word", () => {
  assert.ok(HOUSE_RULES.includes("NOT THIS WEEK. A track in played_last_7_days stays out of a new set " +
    "unless the listener named it. A different take of the same song is fine. If the write reports " +
    "repeats you didn't intend, swap them."));
});
