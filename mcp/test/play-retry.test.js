// A REFUSED PLAY IS TRIED ONCE MORE AFTER A TRANSFER (2026-09-23). The owner
// pressed Play for the Master Bedroom Echo on the Loaded tab and Spotify
// refused it; the same playlist on the same speaker a minute later started
// at once. A refused play now moves the session to the speaker and asks
// again, and the refusal is written down in Spotify's own words, because the
// page's sentence throws them away and the Worker keeps no logs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch, track, PID } from "./harness.js";

const { callTool } = __test;

// Spotify's player, with the first N play PUTs answered by `status`.
function player(refusals, status = 502) {
  const inner = globalThis.fetch;
  const sent = [];
  let left = refusals;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    const method = init.method ?? "GET";
    if (url.hostname === "api.spotify.com") {
      const path = url.pathname.replace(/^\/v1/, "");
      if (path.startsWith("/me/player") && path !== "/me/player/devices") sent.push(`${method} ${path}`);
      if (path === "/me/player/play" && method === "PUT" && left > 0) {
        left--;
        return new Response(JSON.stringify({ error: { status, message: "Player command failed: Restriction violated" } }),
          { status, headers: status === 429 ? { "retry-after": "60" } : {} });
      }
      if (path === "/me/player" && method === "GET") {
        return Response.json({ is_playing: true, device: { id: "device-1", name: "Pro Plus" },
          context: { uri: `spotify:playlist:${PID}` }, shuffle_state: false, repeat_state: "off",
          item: { name: "A", uri: "spotify:track:a", artists: [{ name: "X" }] } });
      }
    }
    return inner(u, init);
  };
  return { sent, restore: () => { globalThis.fetch = inner; } };
}
const plays = (sent) => sent.filter((c) => c === "PUT /me/player/play").length;
// The real waits are 1.5 s and 3 s; the tests do not sit through them.
const quick = () => { const e = makeEnv(); e.__playWakeWaitsMs = [0, 0]; return e; };

test("a refused play is sent once more after a transfer, and plays; the refusal is kept in Spotify's words", async () => {
  const f = installFetch({ contents: [track("a")] });
  const sp = player(1);
  try {
    const e = quick();
    const out = await callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 });
    assert.equal(out.preset_safe, true, "it started");
    assert.equal(plays(sp.sent), 2);
    assert.ok(sp.sent.includes("PUT /me/player"), "the session was moved to the speaker first");
    const rec = JSON.parse(await e.PROGRAMS.get("play:refused"));
    assert.equal(rec.device, "Pro Plus");
    assert.equal(rec.status, 502);
    assert.match(rec.error, /Restriction violated/);
    assert.equal(rec.retried, true);
    assert.equal(rec.retry, "worked");
    const listed = await callTool(e, "list_requests", {}, { remaining: 40 });
    assert.equal(listed.last_play_refused.retry, "worked");
  } finally { sp.restore(); f.restore(); }
});

test("refused twice: the second retry, after a longer wait, plays (2026-09-25)", async () => {
  const f = installFetch({ contents: [track("a")] });
  const sp = player(2, 404);
  try {
    const e = quick();
    const out = await callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 });
    assert.equal(out.preset_safe, true, "it started");
    assert.equal(plays(sp.sent), 3);
    const rec = JSON.parse(await e.PROGRAMS.get("play:refused"));
    assert.equal(rec.retry, "worked");
    assert.equal(rec.tries, 3);
  } finally { sp.restore(); f.restore(); }
});

test("refused three times: it fails as before after three plays, and the answers are kept", async () => {
  const f = installFetch({ contents: [track("a")] });
  const sp = player(3);
  try {
    const e = quick();
    await assert.rejects(callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 }), /502/);
    assert.equal(plays(sp.sent), 3, "two retries, no more");
    const rec = JSON.parse(await e.PROGRAMS.get("play:refused"));
    assert.equal(rec.retried, true);
    assert.equal(rec.tries, 3);
    assert.match(rec.retry, /502/);
  } finally { sp.restore(); f.restore(); }
});

test("refusals are logged, newest first, and read back as lines in the house's time", async () => {
  const f = installFetch({ contents: [track("a")] });
  const sp = player(4, 404);
  try {
    const e = quick();
    await assert.rejects(callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 }));
    await callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 });
    const log = JSON.parse(await e.PROGRAMS.get("play:refused:log"));
    assert.equal(log.length, 2);
    assert.equal(log[0].outcome, "worked");
    assert.equal(log[0].tries, 1 + 1);
    assert.equal(log[1].outcome, "failed");
    const listed = await callTool(e, "list_requests", {}, { remaining: 40 });
    assert.equal(listed.play_refusals.length, 2);
    assert.match(listed.play_refusals[0], /Pro Plus · 404 · worked on try 2$/);
    assert.match(listed.play_refusals[1], /failed after 3 tries$/);
  } finally { sp.restore(); f.restore(); }
});

test("a 429 is not retried: the quota is stamped and a second call would spend it", async () => {
  const f = installFetch({ contents: [track("a")] });
  const sp = player(1, 429);
  try {
    const e = quick();
    await assert.rejects(callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 }), /429/);
    assert.equal(plays(sp.sent), 1);
    assert.ok(!sp.sent.includes("PUT /me/player"), "no transfer");
    assert.equal(JSON.parse(await e.PROGRAMS.get("play:refused")).retried, false);
  } finally { sp.restore(); f.restore(); }
});

test("a play Spotify takes first time writes nothing down", async () => {
  const f = installFetch({ contents: [track("a")] });
  const sp = player(0);
  try {
    const e = quick();
    await callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 });
    assert.equal(plays(sp.sent), 1);
    assert.equal(await e.PROGRAMS.get("play:refused"), null);
  } finally { sp.restore(); f.restore(); }
});

test("a refusal about the request (400) is not retried and moves nothing (Codex, 2026-09-24)", async () => {
  const f = installFetch({ contents: [track("a")] });
  const sp = player(1, 400);
  try {
    const e = quick();
    await assert.rejects(callTool(e, "play_playlist", { playlist: PID, device: "Pro Plus" }, { remaining: 40 }));
    assert.ok(!sp.sent.includes("PUT /me/player"), "no transfer");
    assert.equal(plays(sp.sent), 1);
  } finally { sp.restore(); f.restore(); }
});
