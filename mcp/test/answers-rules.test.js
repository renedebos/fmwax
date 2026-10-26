// RULES IN THE HOUSE'S ANSWERS (MC-31 stage 2b, 2026-10-16). The Claude app
// keeps a connector's descriptions from when it was added (the owner's phone,
// 2026-10-16: "mute" as volume 0, a DJ's set as a bare queue, until the
// connector was re-added). What the house does and answers is always current,
// so the rules that matter hold there too.
import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch, PID } from "./harness.js";

const { callTool } = __test;
const GS = "GUESTSPOTIFY0000000001";

function house() {
  const e = makeEnv();
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: GS, catalog: "spotify" }]);
  return e;
}

test("volume 0 is a pause, and the answer says why", async () => {
  const f = installFetch();
  try {
    const out = await callTool(house(), "playback_control", { action: "volume", volume: 0 }, { remaining: 40 });
    assert.equal(out.paused, true);
    assert.match(out.said, /Paused instead of volume 0: a WiiM's output is usually fixed/);
    assert.ok(f.calls.includes("PUT /me/player/pause"));
    assert.ok(!f.calls.some((c) => c.startsWith("PUT /me/player/volume")), "no volume 0 sent");
    f.calls.length = 0;
    const loud = await callTool(house(), "playback_control", { action: "volume", volume: 30 }, { remaining: 40 });
    assert.equal(loud.volume, 30);
    assert.ok(f.calls.includes("PUT /me/player/volume"));
  } finally { f.restore(); }
});

test("a bare queue's answer says where a DJ's set belongs, in a house with a requests preset", async () => {
  const f = installFetch();
  try {
    const out = await callTool(house(), "play_uris", { uris: ["spotify:track:aaa"] }, { remaining: 40 });
    assert.match(out.house_rule, /If this set was asked of a DJ by name.*replace_playlist "guest on spotify" \(preset 1\)/);
    const plain = await callTool(makeEnv(), "play_uris", { uris: ["spotify:track:aaa"] }, { remaining: 40 });
    assert.equal(plain.house_rule, undefined, "no requests preset, nothing to say");
  } finally { f.restore(); }
});

test("an endless preset's own playlist is not written with a set, and the refusal says what the ask was", async () => {
  const f = installFetch();
  try {
    const e = house();
    e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 5, dj: "hank", playlist: PID, hours: 4 }] });
    await assert.rejects(callTool(e, "replace_playlist", { playlist: "scratch", uris: ["spotify:track:aaa"] }, { remaining: 40 }),
      /endless playlist on preset 5.*steer_endless.*"guest on spotify".*play_endless\. Nothing was written\./);
    assert.ok(!f.calls.some((c) => c.startsWith("PUT /playlists") || c.startsWith("POST /playlists")), "nothing written");
  } finally { f.restore(); }
});

test("get_dj says a house DJ is their endless preset's, and how to play any DJ", async () => {
  const e = house();
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 5, dj: "hank", playlist: PID, hours: 4 },
    { button: 3, lane: true, playlist: "LANEPLAYLIST0000000003", hours: 4 }] });
  const hank = await callTool(e, "get_dj", { name: "Hank" }, { remaining: 40 });
  assert.equal(hank.endless_preset, 5);
  assert.match(hank.guest_note, /^Hank is the endless DJ on preset 5: playing them is that preset/);
  assert.doesNotMatch(hank.guest_note, /no preset of their own/);
  assert.match(hank.how_to_play, /"Play Hank" .* is play_endless \(their own preset, 5\).*replace_playlist onto the requests preset \("guest on spotify", preset 1\).*never play_uris.*steer_endless/);

  const deep = await callTool(e, "get_dj", { name: "Deep Dive" }, { remaining: 40 });
  assert.equal(deep.endless_preset, undefined);
  assert.match(deep.how_to_play, /must be told what to play: an artist, in words/);
  assert.match(deep.guest_note, /no preset of their own/);
});

test("get_dj's how-to-play names the Tidal requests preset when there is one", async () => {
  const e = house();
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: GS, catalog: "spotify" },
    { button: 2, guest: true, live: true, name: "Requests · Tidal", playlist: "00000000-0000-4000-8000-000000000011", catalog: "tidal" },
  ]);
  const vibe = await callTool(e, "get_dj", { name: "Vibe" }, { remaining: 40 });
  assert.match(vibe.how_to_play, /\("guest on spotify", preset 1\) \(or "guest on tidal", preset 2, when it is asked on Tidal\)/);
  const one = await callTool(house(), "get_dj", { name: "Vibe" }, { remaining: 40 });
  assert.doesNotMatch(one.how_to_play, /Tidal/, "no Tidal preset, no Tidal words");
});

test("a house without endless DJs, or without a requests preset, is told only the ways it has", async () => {
  const core = house(); // a requests preset, no endless
  const a = await callTool(core, "get_dj", { name: "Hank" }, { remaining: 40 });
  assert.match(a.how_to_play, /^This house plays no DJ endless, so "Play Hank" is a set, as below\./);
  assert.match(a.how_to_play, /replace_playlist onto the requests preset/);
  assert.doesNotMatch(a.how_to_play, /play_endless|steer_endless/);
  const bare = makeEnv(); // neither
  const b = await callTool(bare, "get_dj", { name: "Hank" }, { remaining: 40 });
  assert.match(b.how_to_play, /is play_uris: this house has no requests preset to keep it on/);
  assert.doesNotMatch(b.how_to_play, /replace_playlist|play_endless/);
});

