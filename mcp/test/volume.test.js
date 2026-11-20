// VOLUME (the owner, 2026-11-19: "let's do volume"; − and + steps; the Denon
// for the Pro Plus). The helper steps a WiiM's own volume or the receiver's
// behind it; the house carries the level in readings and steps it from the
// now bar's panel; an Echo's goes by Spotify.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { obey, setReceivers, denonLevel, denonStatus, readingOf, VOLUME } from "../../helper/fmwax-helper.mjs";
import { parseHelperReading, volIn } from "../now.js";
import { parseReceivers } from "../room.js";
import { makeEnv, installFetch } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const SP = { "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" };

// A WiiM that keeps its volume, and a getStatusEx that says locked or free.
function wiimAt(level, locked = false, max = 100) {
  const sent = [];
  const send = async (ip, cmd) => {
    sent.push(cmd);
    if (cmd === "getStatusEx") return { volume_control: locked ? "1" : "0", max_volume: String(max) };
    if (cmd === "getPlayerStatus") return { status: "play", mode: "31", vol: String(level), vendor: "" };
    const m = cmd.match(/^setPlayerCmd:vol:(\d+)$/);
    if (m) { level = Number(m[1]); return "OK"; }
    return null;
  };
  return { send, sent, read: async () => ({ status: "play", mode: "31", vol: String(level), vendor: "" }), level: () => level };
}

test("a WiiM with its volume free: a step of two either way, never past its own maximum or below nothing", async () => {
  setReceivers({});
  const w = wiimAt(20);
  const up = await obey(SP, { id: "1", cmd: "vol", dir: "up", speaker: "Ultra" }, w.send, w.read);
  assert.equal(up.ok, true);
  assert.equal(w.level(), 22);
  assert.deepEqual(up.reading.vol, { by: "wiim", level: 22, max: 100 });
  await obey(SP, { id: "2", cmd: "vol", dir: "down", speaker: "Ultra" }, w.send, w.read);
  assert.equal(w.level(), 20);
  const top = wiimAt(59, false, 60);
  await obey(SP, { id: "3", cmd: "vol", dir: "up", speaker: "Ultra" }, top.send, top.read);
  assert.equal(top.level(), 60, "the speaker's own maximum");
  const bottom = wiimAt(1);
  await obey(SP, { id: "4", cmd: "vol", dir: "down", speaker: "Ultra" }, bottom.send, bottom.read);
  assert.equal(bottom.level(), 0);
  assert.equal((await obey(SP, { id: "5", cmd: "vol", dir: "loud", speaker: "Ultra" }, w.send, w.read)).code, "refused");
  assert.equal((await obey(SP, { id: "6", cmd: "vol", level: 100, speaker: "Ultra" }, w.send, w.read)).code, "refused", "never a level asked for");
});

test("a WiiM locked at full volume, with no receiver named, is left alone and says so", async () => {
  setReceivers({});
  const w = wiimAt(100, true);
  const out = await obey(SP, { id: "1", cmd: "vol", dir: "down", speaker: "Pro Plus" }, w.send, w.read);
  assert.deepEqual(out, { id: "1", ok: false, code: "fixed" });
  assert.ok(!w.sent.some((c) => c.startsWith("setPlayerCmd")), "nothing sent to it");
});

test("a receiver behind a WiiM: its level read, one dB set as a level, read back", async () => {
  setReceivers({ "Pro Plus": { kind: "denon", ip: "192.168.4.65" } });
  let db = -35;
  const said = [];
  const say = async (ip, cmd) => { said.push([ip, cmd]); const m = cmd.match(/^MV(\d\d)(5?)$/); db = Number(m[1]) + (m[2] ? 0.5 : 0) - 80; return true; };
  const look = async () => new Response(`<item><Power><value>ON</value></Power><MasterVolume><value>${db.toFixed(1)}</value></MasterVolume></item>`);
  const w = wiimAt(100, true);
  const up = await obey(SP, { id: "1", cmd: "vol", dir: "up", speaker: "Pro Plus" }, w.send, w.read, null, say, look);
  assert.equal(up.ok, true);
  assert.deepEqual(said, [["192.168.4.65", "MV46"]], "a level, not an up");
  assert.deepEqual(up.reading.vol, { by: "denon", on: true, db: -34 });
  assert.ok(!w.sent.some((c) => c.startsWith("setPlayerCmd")), "the locked WiiM untouched");
  db = -34.5;
  await obey(SP, { id: "2", cmd: "vol", dir: "down", speaker: "Pro Plus" }, w.send, w.read, null, say, look);
  assert.deepEqual(said.at(-1), ["192.168.4.65", "MV445"]);
  // Off: nothing sent.
  const off = async () => new Response("<item><Power><value>STANDBY</value></Power><MasterVolume><value>--</value></MasterVolume></item>");
  const n = said.length;
  assert.equal((await obey(SP, { id: "3", cmd: "vol", dir: "up", speaker: "Pro Plus" }, w.send, w.read, null, say, off)).code, "off");
  assert.equal(said.length, n);
  setReceivers({});
});

test("the receiver's words: levels and its status page", () => {
  assert.equal(denonLevel(-35), "MV45");
  assert.equal(denonLevel(-34.5), "MV455");
  assert.equal(denonLevel(-75), "MV05");
  assert.equal(denonLevel(-80), "MV00");
  assert.equal(denonLevel(18.5), null);
  assert.deepEqual(denonStatus("<Power><value>ON</value></Power><MasterVolume><value>-35.0</value></MasterVolume>"), { on: true, db: -35 });
  assert.deepEqual(denonStatus("<Power><value>STANDBY</value></Power><MasterVolume><value>--</value></MasterVolume>"), { on: false });
  assert.equal(VOLUME.receiverStepDb, 1);
});

test("the house takes a reading's volume only in its known shapes", () => {
  assert.deepEqual(volIn({ by: "wiim", level: 20, max: 100 }), { by: "wiim", level: 20, max: 100 });
  assert.deepEqual(volIn({ by: "fixed", level: 100 }), { by: "fixed" });
  assert.deepEqual(volIn({ by: "denon", on: true, db: -34.5 }), { by: "denon", on: true, db: -34.5 });
  assert.deepEqual(volIn({ by: "denon", on: false, db: -34.5 }), { by: "denon", on: false });
  assert.equal(volIn({ by: "wiim", level: 101 }), null);
  assert.deepEqual(volIn({ by: "denon", on: true, db: -34.3 }), { by: "denon", on: true }, "half dB steps only");
  assert.equal(volIn({ by: "other" }), null);
  const env = { WIIM_SPEAKERS: JSON.stringify(SP) };
  const r = parseHelperReading(env, { speakers: [readingOf("Ultra", { status: "play", mode: "31", vol: "20" }, null, null, { by: "wiim", level: 20, max: 100 })] });
  assert.deepEqual(r.Ultra.vol, { by: "wiim", level: 20, max: 100 });
});

test("a receiver is named only for a WiiM of the house, at an address at home", () => {
  const env = { WIIM_SPEAKERS: JSON.stringify(SP), WIIM_RECEIVERS: JSON.stringify({
    "pro plus": { kind: "denon", ip: "192.168.4.65" }, Ultra: { kind: "denon", ip: "8.8.8.8" }, Kitchen: { kind: "denon", ip: "192.168.4.9" } }) };
  assert.deepEqual(parseReceivers(env), { "Pro Plus": { kind: "denon", ip: "192.168.4.65" } });
});

function houseEnv() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.WIIM_SPEAKERS = JSON.stringify(SP);
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Kitchen"]);
  e.HELPER_SECRET = "h".repeat(40);
  e.WIIM_RECEIVERS = JSON.stringify({ "Pro Plus": { kind: "denon", ip: "192.168.4.65" } });
  return e;
}
const press = (e, device, dir) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, { method: "POST",
  headers: { accept: "application/json", origin: "https://x.test" }, body: new URLSearchParams({ do: "vol", dir, device }) }), e);

test("the panel's step goes to the helper for a WiiM, and its read-back is kept", async () => {
  const e = houseEnv();
  const f = installFetch();
  try {
    const asked = [];
    e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, reading: { name: "Ultra", state: "play", source: "Spotify", vol: { by: "wiim", level: 22, max: 100 } } }; };
    const r = await (await press(e, "Ultra", "up")).json();
    assert.deepEqual(asked, [{ cmd: "vol", dir: "up", speaker: "Ultra" }]);
    assert.deepEqual(r, { ok: true, code: "ok", vol: { by: "wiim", level: 22, max: 100 } });
    const kept = (await __station(e)).doc.speakers.Ultra;
    assert.deepEqual(kept.vol, { by: "wiim", level: 22, max: 100 });
    e.STATION.endless.hands = async () => ({ ok: false, code: "fixed" });
    assert.equal((await (await press(e, "Pro Plus", "down")).json()).code, "fixed");
    assert.equal((await (await press(e, "Ultra", "sideways")).json()).code, "failed");
    // The helper's receivers, as it asks for its speakers.
    const sp = await (await worker.fetch(new Request("https://x.test/helper/speakers", { headers: { authorization: `Bearer ${"h".repeat(40)}` } }), e)).json();
    assert.deepEqual(sp.receivers, { "Pro Plus": { kind: "denon", ip: "192.168.4.65" } });
  } finally { f.restore(); }
});
async function __station(e) { const { station } = await import("../station.js"); return station(e, "helper-get", {}); }

test("an Echo's step goes by Spotify, five at a time, only while Spotify plays there", async () => {
  const e = houseEnv();
  const f = installFetch();
  const inner = globalThis.fetch;
  const puts = [];
  let st = { is_playing: true, device: { id: "echo1", name: "Kitchen", volume_percent: 40, supports_volume: true }, item: { name: "x", uri: "spotify:track:a", artists: [] } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") return Response.json(st);
    if (u.pathname === "/v1/me/player/volume") { puts.push([u.searchParams.get("volume_percent"), u.searchParams.get("device_id")]); return new Response(null, { status: 204 }); }
    return inner(url, init);
  };
  try {
    const r = await (await press(e, "Kitchen", "up")).json();
    assert.deepEqual(r, { ok: true, code: "ok", vol: { by: "spotify", level: 45 } });
    assert.deepEqual(puts, [["45", "echo1"]]);
    st = { ...st, device: { ...st.device, name: "Pro Plus" } };
    assert.equal((await (await press(e, "Kitchen", "up")).json()).code, "gone", "not playing there: nothing sent");
    st = { ...st, device: { id: "ph", name: "Kitchen", volume_percent: 50, supports_volume: false } };
    assert.equal((await (await press(e, "Kitchen", "down")).json()).code, "fixed");
    assert.equal(puts.length, 1);
  } finally { globalThis.fetch = inner; f.restore(); }
});
