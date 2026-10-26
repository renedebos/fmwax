// MC-29, ASK THE HELPER BEFORE ASKING SPOTIFY (tasks/done/mc29-helper-first-player.md).
// The house keeps one Spotify answer and hands it to the pages while the home
// helper says the WiiMs read the same, until a playback write, a key press,
// the song's end or a cap says otherwise. The owner, 2026-09-28: the pages'
// 30-second checks were 450 of the day's 924 calls.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { helperPress, playerReusable, PLAYER_REUSE_ELSEWHERE_MS, PLAYER_REUSE_MAX_MS, PLAYER_REUSE_QUIET_MS } from "../now.js";
import { spotify, spotifyCalls } from "../services.js";
import { makeEnv, installFetch, track } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const SECRET = "helper-secret-000000000000";
const MIN = 60_000;
const WIIMS = ["Pro Plus", "Ultra"];

function env(over = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Living Room"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" });
  e.HELPER_SECRET = SECRET;
  return Object.assign(e, over);
}
const reading = (e, proPlus) => worker.fetch(new Request("https://x.test/helper/reading", {
  method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
  body: JSON.stringify({ speakers: [{ name: "Pro Plus", ...proPlus }, { name: "Ultra", state: "idle" }] }) }), e);
const poll = async (e, q = "") => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing${q}`), e)).json();

// Spotify's player, counted: GET /v1/me/player reads; a playback write is a 204.
function player(state) {
  const f = installFetch({ contents: [track("a")] });
  const inner = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      reads++;
      const p = state.now;
      if (!p) return new Response(null, { status: 204 });
      return Response.json({ is_playing: p.playing !== false, device: { name: p.device ?? "Pro Plus", id: "d1" },
        context: null, progress_ms: p.progress ?? 0,
        item: { name: p.track, uri: `spotify:track:${p.id ?? "x"}`, duration_ms: p.duration ?? 4 * MIN, artists: [{ name: "Someone" }] } });
    }
    if (url.pathname.startsWith("/v1/me/player") && init.method && init.method !== "GET") return new Response(null, { status: 204 });
    return inner(u, init);
  };
  return { reads: () => reads, restore: () => { globalThis.fetch = inner; f.restore(); } };
}

test("the rule: fresh helper, nothing changed since, under the cap for where the music is, never past the song's end", () => {
  const now = 10 * MIN;
  const doc = { at: now - 5_000, changedAt: now - 3 * MIN, speakers: { "Pro Plus": { state: "play", source: "Spotify" } } };
  const onWiim = { at: now - 2 * MIN, st: { is_playing: true, progress_ms: 0, device: { name: "Pro Plus" }, item: { duration_ms: 4 * MIN } } };
  assert.equal(playerReusable(onWiim, doc, WIIMS, now), true, "a WiiM, the helper unchanged: kept");
  // 1. The helper must be fresh.
  assert.equal(playerReusable(onWiim, { ...doc, at: now - 151_000 }, WIIMS, now), false, "a stale helper: read");
  assert.equal(playerReusable(onWiim, null, WIIMS, now), false, "no helper: read");
  // 2. Nothing may have changed on the WiiMs since the answer was kept.
  assert.equal(playerReusable(onWiim, { ...doc, changedAt: now - 1 * MIN }, WIIMS, now), false, "changed since: read");
  assert.equal(playerReusable(onWiim, { at: doc.at, speakers: doc.speakers }, WIIMS, now), false,
    "a reading from before changedAt existed counts as changed at its post");
  // 3. Not past the song's end.
  assert.equal(playerReusable({ ...onWiim, st: { ...onWiim.st, progress_ms: 3 * MIN } }, doc, WIIMS, now), false,
    "a minute was left two minutes ago: the song has ended");
  // 4. The caps: five minutes on a WiiM, thirty seconds elsewhere, two minutes quiet.
  const long = { ...onWiim, at: now - PLAYER_REUSE_MAX_MS - 1, st: { ...onWiim.st, item: { duration_ms: 20 * MIN } } };
  assert.equal(playerReusable(long, { ...doc, changedAt: now - 9 * MIN }, WIIMS, now), false, "past five minutes, even on a WiiM");
  const echo = (age) => ({ at: now - age, st: { ...onWiim.st, device: { name: "Living Room" } } });
  assert.equal(playerReusable(echo(PLAYER_REUSE_ELSEWHERE_MS), doc, WIIMS, now), true, "an Echo: thirty seconds");
  assert.equal(playerReusable(echo(PLAYER_REUSE_ELSEWHERE_MS + 1), doc, WIIMS, now), false, "and not thirty-one");
  const quiet = (age) => ({ at: now - age, st: {} });
  assert.equal(playerReusable(quiet(PLAYER_REUSE_QUIET_MS), doc, WIIMS, now), true, "nothing playing: two minutes");
  assert.equal(playerReusable(quiet(PLAYER_REUSE_QUIET_MS + 1), doc, WIIMS, now), false);
  const paused = { at: now - PLAYER_REUSE_QUIET_MS - 1, st: { ...onWiim.st, is_playing: false } };
  assert.equal(playerReusable(paused, doc, WIIMS, now), false, "Spotify's pause is quiet, and quiet's cap");
  assert.equal(playerReusable(null, doc, WIIMS, now), false, "nothing kept: read");
});

test("two polls while the helper hears nothing change cost one read, and the Use page counts the one saved", async () => {
  const state = { now: { track: "Cold Sweat" } };
  const sp = player(state);
  try {
    const e = env();
    await reading(e, { state: "play", source: "Spotify", track: "Cold Sweat" });
    await new Promise((r) => setTimeout(r, 5));   // the answer is kept after the helper's last change
    const a = await poll(e);
    const b = await poll(e);
    assert.equal(a.track, "Cold Sweat");
    assert.deepEqual(b, a, "the same answer");
    assert.equal(sp.reads(), 1, "Spotify asked once");
    // The helper posting the same reading again changes nothing.
    await reading(e, { state: "play", source: "Spotify", track: "Cold Sweat" });
    await poll(e);
    assert.equal(sp.reads(), 1, "a repeat of the same reading is not a change");
    const calls = await spotifyCalls(e);
    assert.equal(calls.last.saved, 2);
    assert.equal(calls.last.by.player, 1, "and the saved answers are not calls");
  } finally { sp.restore(); }
});

test("the helper hearing a new song, a pause or another source makes the next poll read", async () => {
  const state = { now: { track: "Cold Sweat" } };
  const sp = player(state);
  try {
    const e = env();
    await reading(e, { state: "play", source: "Spotify", track: "Cold Sweat" });
    await new Promise((r) => setTimeout(r, 5));
    await poll(e);
    state.now = { track: "Mother Popcorn", id: "mp" };
    await reading(e, { state: "play", source: "Spotify", track: "Mother Popcorn" });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await poll(e)).track, "Mother Popcorn");
    assert.equal(sp.reads(), 2);
    state.now = null;
    await reading(e, { state: "play", source: "Prime", track: "Ghetto Organ" });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await poll(e)).state, "quiet", "key 3: Amazon on the Pro Plus, and Spotify quiet");
    assert.equal(sp.reads(), 3);
  } finally { sp.restore(); }
});

test("a playback write forgets the kept answer, and a read in its settling seconds is not kept", async () => {
  const state = { now: { track: "Cold Sweat" } };
  const sp = player(state);
  try {
    const e = env();
    await reading(e, { state: "play", source: "Spotify", track: "Cold Sweat" });
    await new Promise((r) => setTimeout(r, 5));
    await poll(e);
    // A pause, from anywhere in the house: a tool, the bar, a page.
    await spotify(e, "PUT", "/me/player/pause");
    state.now = { track: "Cold Sweat", playing: false };
    assert.equal((await poll(e)).state, "quiet", "the pause is read at once");
    assert.equal((await poll(e)).state, "quiet");
    assert.equal(sp.reads(), 3, "and read again: within ten seconds of a write, nothing read is kept");
  } finally { sp.restore(); }
});

test("a key pressed through the helper forgets the kept answer", async () => {
  const state = { now: { track: "Cold Sweat" } };
  const sp = player(state);
  try {
    const e = env();
    e.STATION.endless.hands = async () => ({ ok: true, reading: { name: "Pro Plus", state: "play", source: "Spotify", track: "Cold Sweat" } });
    await reading(e, { state: "play", source: "Spotify", track: "Cold Sweat" });
    await new Promise((r) => setTimeout(r, 5));
    await poll(e);
    await helperPress(e, { name: "Pro Plus" }, 3);
    await poll(e);
    assert.equal(sp.reads(), 2, "the press, not the reading, forgot it: the read-back said the same");
  } finally { sp.restore(); }
});

test("?fresh=1, a stale helper, no helper, and the switch off each read every time", async () => {
  const cases = [
    ["?fresh=1", env(), "?fresh=1"],
    ["no helper", env({ HELPER_SECRET: undefined }), ""],
    ["switched off", env({ PLAYER_REUSE: "off" }), ""],
  ];
  for (const [what, e, q] of cases) {
    const sp = player({ now: { track: "Cold Sweat" } });
    try {
      if (e.HELPER_SECRET) await reading(e, { state: "play", source: "Spotify", track: "Cold Sweat" });
      await new Promise((r) => setTimeout(r, 5));
      await poll(e, q);
      await poll(e, q);
      assert.equal(sp.reads(), 2, what);
    } finally { sp.restore(); }
  }
  // Stale: a reading older than the helper's 150 seconds.
  const sp = player({ now: { track: "Cold Sweat" } });
  try {
    const e = env();
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "helper-put",
      args: { doc: { at: Date.now() - 200_000, speakers: { "Pro Plus": { state: "play", source: "Spotify" } } }, now: Date.now() - 200_000 } }) });
    await poll(e);
    await poll(e);
    assert.equal(sp.reads(), 2, "stale");
  } finally { sp.restore(); }
});

test("a read that started before the kept answer, or before a write, never replaces it", async () => {
  const { playerPutDoc, playerForgetDoc } = await import("../station.js");
  const kept = JSON.parse(playerPutDoc(null, 1000, { item: {} }));
  assert.equal(playerPutDoc(kept, 900, {}), null, "older than the one kept");
  const forgot = JSON.parse(playerForgetDoc(kept, 2000, 1500));
  assert.deepEqual(forgot, { forgotAt: 2000 });
  assert.equal(playerPutDoc(forgot, 1999, {}), null, "started in the settling window");
  assert.ok(playerPutDoc(forgot, 2000, {}), "and after it, kept");
});
