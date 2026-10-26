import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv } from "./harness.js";

const { resolveDevice, deviceDisplayName, callTool } = __test;

// The WiiM drops its friendly name and advertises a raw hex id instead. While
// that is true, DEFAULT_DEVICE stops resolving and every request that does not
// name a device fails. These cover the memory that survives it.

const HEX = "5cf5b2ea1234567890abcdef";

function devices(list) {
  const original = globalThis.fetch;
  const json = (b) => new Response(JSON.stringify(b),
    { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === "accounts.spotify.com") {
      return json({ access_token: "t", expires_in: 3600 });
    }
    if (u.pathname.endsWith("/me/player/devices")) return json({ devices: list });
    return json({});
  };
  return { restore() { globalThis.fetch = original; } };
}

// A player state playing one track on the given device, which is the only path
// a page has to a device name.
function player(device) {
  const original = globalThis.fetch;
  const json = (b) => new Response(JSON.stringify(b),
    { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === "accounts.spotify.com") {
      return json({ access_token: "t", expires_in: 3600 });
    }
    if (u.pathname.endsWith("/me/player")) {
      return json({
        is_playing: true, device: { ...device, volume_percent: 30 },
        item: { name: "A Song", type: "track", duration_ms: 200000,
          artists: [{ name: "Someone" }], album: { name: "An Album" } },
        progress_ms: 1000,
      });
    }
    return json({});
  };
  return { restore() { globalThis.fetch = original; } };
}

test("a name that resolves is remembered", async () => {
  const f = devices([{ id: HEX, name: "Pro Plus" }]);
  try {
    const env = makeEnv();
    const out = await resolveDevice(env, "Pro Plus");
    assert.equal(out.id, HEX);
    assert.equal(out.warning, null, "nothing is wrong, so nothing is said");
    assert.equal(await env.PROGRAMS.get("device:pro plus"), HEX);
  } finally { f.restore(); }
});

test("when the speaker loses its name, the remembered id carries the request", async () => {
  const env = makeEnv();
  let f = devices([{ id: HEX, name: "Pro Plus" }]);
  try { await resolveDevice(env, "Pro Plus"); } finally { f.restore(); }

  // Same device, now advertising its raw id as its name — the observed fault.
  f = devices([{ id: HEX, name: HEX }]);
  try {
    const out = await resolveDevice(env, "Pro Plus");
    assert.equal(out.id, HEX, "the request still goes to the right speaker");
    assert.match(out.warning, /publishing its raw id where its name should be/,
      "and the fault is reported rather than papered over");
    assert.ok(!/power-cycl/i.test(out.warning),
      "reboots, a cold power cycle, a relink and two factory resets have all " +
      "been tried — advice that has been measured not to work is worse than none");
  } finally { f.restore(); }
});

test("a page shows the name the speaker has stopped publishing", async () => {
  const env = makeEnv();
  // While it was healthy, both directions were learned.
  let f = devices([{ id: HEX, name: "Pro Plus" }]);
  try { await resolveDevice(env, "Pro Plus"); } finally { f.restore(); }
  assert.equal(await env.PROGRAMS.get(`device-name:${HEX}`), "Pro Plus");

  assert.equal(await deviceDisplayName(env, { id: HEX, name: HEX }), "Pro Plus",
    "a line holding only the id can still say something a person recognises");
});

test("the substitution is only ever for a device publishing its own id", async () => {
  const env = makeEnv();
  let f = devices([{ id: HEX, name: "Pro Plus" }]);
  try { await resolveDevice(env, "Pro Plus"); } finally { f.restore(); }

  // Somebody renames the speaker. Preferring memory whenever it exists would
  // show the old name for as long as the key lived; the rename must win.
  assert.equal(await deviceDisplayName(env, { id: HEX, name: "Kitchen" }),
    "Kitchen");
  assert.equal(await deviceDisplayName(env, { id: HEX, name: "Pro Plus" }),
    "Pro Plus");
  // Nothing remembered, nothing to say — the id stands rather than a blank.
  assert.equal(await deviceDisplayName(env, { id: "other", name: "other" }),
    "other");
});

test("a speaker already faulty learns its name from the request that asks for it", async () => {
  const env = makeEnv();
  // It has an id in memory from before, and no name: the fault started before
  // anything recorded one, so the healthy path can never run for it again.
  await env.PROGRAMS.put("device:pro plus", HEX);

  const f = devices([{ id: HEX, name: HEX }]);
  try {
    const out = await resolveDevice(env, "Pro Plus");
    assert.equal(out.id, HEX);
    assert.ok(out.warning, "still reported — the fault is not being hidden");
  } finally { f.restore(); }

  assert.equal(await env.PROGRAMS.get(`device-label:${HEX}`), "Pro Plus",
    "the operator's own word for it, which is the only name left anywhere");
  assert.equal(await env.PROGRAMS.get(`device-name:${HEX}`), null,
    "and kept apart from a name the device published, which it is not");
  assert.equal(await deviceDisplayName(env, { id: HEX, name: HEX }), "Pro Plus");
});

test("a guessed label never overwrites a name the device published", async () => {
  const env = makeEnv();
  // Asked for by a fragment while healthy: resolveDevice matches on `includes`,
  // so "pro" is remembered as a needle and the REAL name against the id.
  let f = devices([{ id: HEX, name: "Pro Plus" }]);
  try { await resolveDevice(env, "pro"); } finally { f.restore(); }
  assert.equal(await env.PROGRAMS.get("device:pro"), HEX);
  assert.equal(await env.PROGRAMS.get(`device-name:${HEX}`), "Pro Plus");

  // Now faulty, and asked by that fragment again. What it was asked by is not
  // a name, and must not replace the one the device actually published.
  f = devices([{ id: HEX, name: HEX }]);
  try { await resolveDevice(env, "pro"); } finally { f.restore(); }
  assert.equal(await env.PROGRAMS.get(`device-name:${HEX}`), "Pro Plus");
  assert.equal(await env.PROGRAMS.get(`device-label:${HEX}`), "pro",
    "the guess is kept, in its own place, where it cannot outrank the name");
  assert.equal(await deviceDisplayName(env, { id: HEX, name: HEX }), "Pro Plus",
    "and the published name is what a page shows");
});

test("a rename seen while healthy survives the fault coming back", async () => {
  const env = makeEnv();
  let f = devices([{ id: HEX, name: "Pro Plus" }]);
  try { await resolveDevice(env, "Pro Plus"); } finally { f.restore(); }
  assert.equal(await env.PROGRAMS.get(`device-name:${HEX}`), "Pro Plus");

  // Renamed in the app. Nothing looks it up by name after that — the pages
  // read player state, and that read is the only place the new name is seen.
  f = player({ id: HEX, name: "Kitchen" });
  try {
    const out = await callTool(env, "now_playing", {}, { remaining: 40 });
    assert.equal(out.device, "Kitchen", "a healthy name passes straight through");
  } finally { f.restore(); }
  assert.equal(await env.PROGRAMS.get(`device-name:${HEX}`), "Kitchen",
    "and is recorded, because it is the freshest sighting there is");

  // The fault returns. The old name would be worse than the id.
  f = player({ id: HEX, name: HEX });
  try {
    const out = await callTool(env, "now_playing", {}, { remaining: 40 });
    assert.equal(out.device, "Kitchen");
  } finally { f.restore(); }
});

test("a fault already in progress is named from the id the usual speaker resolves to", async () => {
  const env = makeEnv();
  env.DEFAULT_DEVICE = "Pro Plus";
  // All that exists is the name→id memory from before the fault. Neither note
  // was ever written, and the device will never publish a name again to write
  // one — so without this the page shows hex until somebody starts a play.
  await env.PROGRAMS.put("device:pro plus", HEX);

  assert.equal(await deviceDisplayName(env, { id: HEX, name: HEX }), "Pro Plus");
  assert.equal(await deviceDisplayName(env, { id: "another", name: "another" }),
    "another", "and a different speaker is not given the usual one's name");
});

test("memory cannot invent a device that is not there", async () => {
  // The whole reason accepting an id as a name was refused: a fallback must
  // only ever recognise a device it can currently see.
  const env = makeEnv();
  let f = devices([{ id: HEX, name: "Pro Plus" }]);
  try { await resolveDevice(env, "Pro Plus"); } finally { f.restore(); }

  f = devices([{ id: "aaaa", name: "Echo Studio" }]);
  try {
    await assert.rejects(() => resolveDevice(env, "Pro Plus"), /no device matching/);
  } finally { f.restore(); }
});

test("a live name always wins over the remembered id", async () => {
  const env = makeEnv();
  await env.PROGRAMS.put("device:pro plus", "stale-id");
  const f = devices([{ id: "fresh-id", name: "Pro Plus" }, { id: "stale-id", name: "Old" }]);
  try {
    const out = await resolveDevice(env, "Pro Plus");
    assert.equal(out.id, "fresh-id");
    assert.equal(await env.PROGRAMS.get("device:pro plus"), "fresh-id", "and memory updates");
  } finally { f.restore(); }
});

test("no name asked for is not a failure", async () => {
  const f = devices([]);
  try {
    assert.deepEqual(await resolveDevice(makeEnv(), null), { id: null, warning: null });
  } finally { f.restore(); }
});

test("remembering survives KV being unavailable", async () => {
  // Device memory is an optimisation. A name that resolves normally must not
  // start erroring because KV is down.
  const f = devices([{ id: HEX, name: "Pro Plus" }]);
  try {
    const env = makeEnv();
    env.PROGRAMS = { get: async () => { throw new Error("kv down"); },
                     put: async () => { throw new Error("kv down"); } };
    const out = await resolveDevice(env, "Pro Plus");
    assert.equal(out.id, HEX);
  } finally { f.restore(); }
});
