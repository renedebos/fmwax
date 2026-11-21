// HOW THE HOUSE STARTS A SET (2026-11-15; MC-44 and its two companions):
// a cold WiiM is lifted to lossless by a press of the key that holds the
// playlist (lossless.js); a start that lands on a playlist's old songs is
// asked again; and the Ask form's "Play when ready" tick starts the set as
// an ask by voice does.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { station } from "../station.js";
import { startPlaylistOnDevice } from "../playback.js";
import { LIFT, coldSession, fallenToLossy, playingOneOf } from "../lossless.js";
import { makeEnv, makeHouseStore, TWO_REQUESTS } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const pid = (n) => `${"A".repeat(21)}${n}`;
const HEX = { pro: "5cf5b2ea4bd7f0857dc305309b08cd4e0842a48c", ultra: "5e9e3c1bae8ed3521d3caf9dffd8b88a46c8a3de" };
const ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 20, presets: [
  { button: 4, dj: "dr-funkenstein", playlist: pid(4) }, { button: 5, dj: "hank", playlist: pid(5) },
  { button: 3, lane: true, playlist: pid(3) }] });
const TABLE = [
  { btn: 1, name: "Requests · Spotify", source: "Spotify" }, { btn: 3, name: "Guest DJ", source: "Spotify" },
  { btn: 4, name: "Dr. Funkenstein", source: "Spotify" }, { btn: 10, name: "KQED", source: "TuneIn" },
];
const uri = (n) => `spotify:track:${String(n).padStart(22, "0")}`;

// SPOTIFY, IN SMALL. `cold`: the speakers Spotify shows under their id (a
// WiiM that has sat idle). `items`: the song the player reports after each
// play, in order (the last one repeats): a playlist's old song, then a new.
let fake = null;
function spotify({ cold = [], items = [uri(1)] } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  const devices = [{ id: HEX.pro, name: "Pro Plus" }, { id: HEX.ultra, name: "Ultra" }, { id: "echo-1", name: "Living Room" }];
  const shown = (d) => (cold.includes(d.name) ? { ...d, name: d.id } : d);
  let st = null, plays = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const m = init.method || "GET";
    const path = u.pathname.replace(/^\/v1/, "");
    calls.push(`${m} ${path}`);
    const body = (() => { try { return init.body ? JSON.parse(init.body) : null; } catch { return null; } })();
    if (u.hostname === "accounts.spotify.com") return Response.json({ access_token: "t", expires_in: 3600 });
    // The house finds a speaker by its name; a remembered id stands in when
    // Spotify shows none (services.js resolveDevice), so the list keeps names.
    if (path === "/me/player/devices") return Response.json({ devices });
    if (path === "/me/player" && m === "GET") return st ? Response.json(st) : new Response(null, { status: 204 });
    if (path === "/me/player/play" && m === "PUT") {
      const dev = devices.find((d) => d.id === u.searchParams.get("device_id")) ?? devices[0];
      const item = items[Math.min(plays, items.length - 1)]; plays++;
      st = { is_playing: true, device: shown(dev), context: { uri: body?.context_uri ?? st?.context?.uri ?? null }, progress_ms: 0,
        shuffle_state: false, repeat_state: "off",
        item: { name: "A song", uri: item, type: "track", duration_ms: 200000, artists: [{ name: "Someone" }], album: { name: "An album" } } };
      return new Response(null, { status: 204 });
    }
    if (m !== "GET" && path.startsWith("/me/player")) return new Response(null, { status: 204 });
    return Response.json({});
  };
  fake = { calls, plays: () => plays, at(ms) { if (st) st.progress_ms = ms; }, restore() { globalThis.fetch = original; } };
  return fake;
}
afterEach(() => { fake?.restore(); fake = null; });

async function house({ hands = true, table = TABLE } = {}) {
  const store = await makeHouseStore();
  const e = { ...makeEnv(), HOUSE: store.binding };
  Object.assign(e, { PROGRAM_LIBRARY_KEY: KEY, ENDLESS, BUTTONS: JSON.stringify(TWO_REQUESTS), HELPER_SECRET: "home-key",
    REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true",
    ROOM_DEVICES: JSON.stringify(["Pro Plus", "Ultra", "Living Room"]),
    WIIM_SPEAKERS: JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" }),
    // No waiting in a test: the second and third asks follow at once.
    __staleWaitsMs: [0, 0] });
  await e.PROGRAMS.put("house:claimed", "2026-10-23T00:00:00Z");
  const asked = [];
  if (hands) e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, reading: { name: a.speaker, state: "play", source: "Spotify" } }; };
  await station(e, "helper-put", { doc: { at: Date.now(), speakers: {
    "Pro Plus": { name: "Pro Plus", state: "stop" }, Ultra: { name: "Ultra", state: "stop" } } } });
  if (table) await e.PROGRAMS.put("reading:pro-plus", JSON.stringify({ presets: table, at: new Date().toISOString(), by: "helper" }));
  return { e, asked };
}
const start = (e, n, device = "Pro Plus", from = null, opts = {}) =>
  startPlaylistOnDevice(e, { id: pid(n), name: "The set", catalog: "spotify" }, device, { remaining: 30 }, from, opts);

test("cold is read off the player's own answer: the speaker under its id, not its name", () => {
  assert.equal(coldSession({ device: { id: HEX.pro, name: HEX.pro } }, HEX.pro), true);
  assert.equal(coldSession({ device: { id: HEX.pro, name: HEX.pro.toUpperCase() } }, HEX.pro), true, "any 40 hex characters");
  assert.equal(coldSession({ device: { id: "echo-1", name: "echo-1" } }, "echo-1"), true, "its own id as its name");
  assert.equal(coldSession({ device: { id: HEX.pro, name: "Pro Plus" } }, HEX.pro), false);
  assert.equal(coldSession({ device: { id: HEX.pro, name: "" } }, HEX.pro), false, "no name is not a sign");
  assert.equal(coldSession(null, HEX.pro), false);
});

test("a cold WiiM is lifted: after the start, the helper presses the key that holds the playlist", async () => {
  const { e, asked } = await house();
  spotify({ cold: ["Pro Plus"] });
  const out = await start(e, 4);
  assert.equal(out.preset_safe, true, "the start itself is as it was");
  assert.deepEqual(asked, [{ cmd: "key", n: 4, speaker: "Pro Plus" }]);
  assert.deepEqual(out.lossless, { cold: true, pressed: 4, code: "ok" });
  assert.ok(fake.calls.indexOf("PUT /me/player/play") >= 0, "Spotify was asked first; the press lifts what it started");
});

test("no press where there is nothing to lift, or no way to", async () => {
  // Already under its name: lossless by the sign, nothing pressed.
  let h = await house();
  spotify();
  assert.equal((await start(h.e, 4)).lossless, undefined);
  assert.deepEqual(h.asked, []);
  fake.restore();
  // The bar's play-again names where to begin: a press would send the song back.
  h = await house();
  spotify({ cold: ["Pro Plus"] });
  assert.equal((await start(h.e, 4, "Pro Plus", { uri: uri(7), positionMs: 42000 })).lossless, undefined);
  assert.deepEqual(h.asked, []);
  fake.restore();
  // An Echo is not a WiiM of this house.
  h = await house();
  spotify({ cold: ["Living Room"] });
  assert.equal((await start(h.e, 4, "Living Room")).lossless, undefined);
  assert.deepEqual(h.asked, []);
  fake.restore();
  // The helper off: said, and the start stands.
  h = await house({ hands: false });
  spotify({ cold: ["Pro Plus"] });
  let out = await start(h.e, 4);
  assert.equal(out.preset_safe, true);
  assert.deepEqual(out.lossless, { cold: true, pressed: null, why: "the home helper is off" });
  fake.restore();
  // The playlist on none of this speaker's keys (5 is not in its reading), or no reading at all.
  h = await house();
  spotify({ cold: ["Pro Plus"] });
  out = await start(h.e, 5);
  assert.deepEqual(out.lossless, { cold: true, pressed: null, why: "the set is on none of this speaker's presets" });
  assert.deepEqual(h.asked, []);
  fake.restore();
  h = await house({ table: null });
  spotify({ cold: ["Pro Plus"] });
  assert.equal((await start(h.e, 4)).lossless.pressed, null);
  // A press the helper could not make is said, never thrown: the music plays.
  fake.restore();
  h = await house();
  h.e.STATION.endless.hands = async () => ({ ok: false, code: "timeout" });
  spotify({ cold: ["Pro Plus"] });
  out = await start(h.e, 4);
  assert.equal(out.preset_safe, true);
  assert.deepEqual(out.lossless, { cold: true, pressed: 4, code: "timeout" });
});

test("the right songs: a start on the playlist's old songs is asked again, and says what happened", async () => {
  const set = [uri(11), uri(12), uri(13)];
  assert.equal(playingOneOf({ item: { uri: uri(12) } }, set), true);
  assert.equal(playingOneOf({ item: { uri: uri(99), linked_from: { uri: uri(11) } } }, set), true, "a relinked pressing is still the song");
  assert.equal(playingOneOf({ item: { uri: uri(99) } }, set), false);
  assert.equal(playingOneOf({ item: null }, set), true, "no song named is no evidence");
  assert.equal(playingOneOf({ item: { uri: uri(99) } }, null), true, "nothing to hold it to");

  // The old song first, the new set's on the second ask.
  let h = await house();
  spotify({ items: [uri(99), uri(11)] });
  let out = await start(h.e, 4, "Pro Plus", null, { expect: set });
  assert.equal(out.stale_start, "restarted");
  assert.equal(fake.plays(), 2);
  assert.equal(out.preset_safe, true);
  fake.restore();
  // Right the first time: one ask, nothing said.
  h = await house();
  spotify({ items: [uri(12)] });
  out = await start(h.e, 4, "Pro Plus", null, { expect: set });
  assert.equal(out.stale_start, undefined);
  assert.equal(fake.plays(), 1);
  fake.restore();
  // Still the old songs after two more asks: it stops asking and says so.
  h = await house();
  spotify({ items: [uri(99)] });
  out = await start(h.e, 4, "Pro Plus", null, { expect: set });
  assert.equal(out.stale_start, "still-old");
  assert.equal(fake.plays(), 3, "the start and two more, never a loop");
  fake.restore();
  // No songs handed over (a plain Play), or a start that names its place: never asked twice.
  h = await house();
  spotify({ items: [uri(99)] });
  assert.equal((await start(h.e, 4)).stale_start, undefined);
  assert.equal(fake.plays(), 1);
  fake.restore();
  h = await house();
  spotify({ items: [uri(99)] });
  assert.equal((await start(h.e, 4, "Pro Plus", { uri: uri(99), positionMs: 0 }, { expect: set })).stale_start, undefined);
  assert.equal(fake.plays(), 1);
  fake.restore();
  // Both at once, as on a cold speaker after a fresh write: asked again, then lifted.
  h = await house();
  spotify({ cold: ["Pro Plus"], items: [uri(99), uri(11)] });
  out = await start(h.e, 4, "Pro Plus", null, { expect: set });
  assert.equal(out.stale_start, "restarted");
  assert.deepEqual(out.lossless, { cold: true, pressed: 4, code: "ok" });
  assert.deepEqual(h.asked, [{ cmd: "key", n: 4, speaker: "Pro Plus" }]);
});

// THE ASK FORM'S TICK (the owner, 2026-11-14: "do A after the lossless test").
const get = (e, path) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/${path}`), e, { waitUntil() {} });
const ask = (e, body) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/soul/request`,
  { method: "POST", body: new URLSearchParams(body), headers: { origin: "https://x.test" } }), e, { waitUntil() {} });
const lastAsk = async (e) => {
  const rows = [...e.STATION.rows.values()];
  return rows.length ? e.PROGRAMS.get(`request:${rows[rows.length - 1].id}`, { type: "json" }) : null;
};

test("the Ask form has Play when ready, with the house's speakers, beside Save on Shelf", async () => {
  const { e } = await house();
  spotify();
  const html = await (await get(e, "soul")).text();
  assert.match(html, /<label class="keepbox"><input type="checkbox" name="keep" value="1"><span>Save on Shelf<\/span><\/label>\s*<label class="keepbox startbox"><input type="checkbox" name="start" value="1"><span>Play when ready<\/span><\/label>/);
  const line = html.match(/<p class="askstart">[\s\S]*?<\/p>/)?.[0] ?? "";
  assert.match(line, /Starts by itself on the <select class="devsel" name="device" data-pick aria-label="Speaker to start on">/);
  for (const room of ["Pro Plus", "Ultra", "Living Room"]) assert.ok(line.includes(`>${room}</option>`), room);
  assert.match(line, /when it lands, unless something else was started in the meantime\./);
  // Hidden until the box is ticked, by the page's own stylesheet.
  const css = await (await worker.fetch(new Request(`https://x.test${html.match(/href="(\/[^"]*\.css[^"]*)"/)?.[1] ?? "/none"}`), e)).text();
  assert.ok(`${html}${css}`.includes(".djpage .askcard:has(.startbox input:checked) .askstart{display:block}"));
  // A house whose asks wait for somebody to ask Claude has no tick: nothing lands in time.
  const manual = await house();
  manual.e.AUTOFULFILL_ENABLED = "false";
  assert.ok(!(await (await get(manual.e, "soul")).text()).includes("startbox"));
});

test("ticked, the ask carries the speaker and what was playing, and the page says where it starts", async () => {
  const { e } = await house();
  spotify();
  const r = await ask(e, { mood: "Stax, the deep cuts", length: "60", start: "1", device: "Ultra" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `/buttons/${KEY}/soul?ask=sent&on=Ultra`);
  const rec = await lastAsk(e);
  assert.equal(rec.device, "Ultra");
  assert.equal(rec.via, "form");
  assert.ok(rec.playing, "what was playing at the ask, which the start checks against");
  const html = await (await get(e, "soul?ask=sent&on=Ultra")).text();
  assert.match(html, /It starts on the Ultra by itself when it lands, unless something else was started in the meantime\./);
  // A speaker that is not this house's is never echoed onto the page.
  assert.ok(!(await (await get(e, "soul?ask=sent&on=%3Cb%3Ex")).text()).includes("It starts on the"));
  // The waiting card says the same, and no longer "until someone presses
  // Play" (the owner's screenshot, 2026-11-15, 11:47).
  const card = await (await get(e, "soul")).text();
  assert.match(card, /This page checks on its own; it starts on the Ultra by itself when it lands, unless something else was started in the meantime\./);
  assert.ok(!card.includes("nothing will play until someone presses Play"));
});

test("not ticked, or a speaker that is not the house's: the ask is as it always was", async () => {
  let h = await house();
  spotify();
  let r = await ask(h.e, { mood: "Motown B-sides", length: "60", device: "Ultra" });
  assert.equal(r.headers.get("location"), `/buttons/${KEY}/soul?ask=sent`);
  let rec = await lastAsk(h.e);
  assert.equal(rec.device, undefined);
  assert.equal(rec.via, undefined);
  assert.match(await (await get(h.e, "soul")).text(), /This page checks on its own; nothing will play until someone presses Play\./);
  fake.restore();
  h = await house();
  spotify();
  r = await ask(h.e, { mood: "Chess, the fifties", length: "60", start: "1", device: "The Moon" });
  assert.equal(r.headers.get("location"), `/buttons/${KEY}/soul?ask=sent`);
  rec = await lastAsk(h.e);
  assert.equal(rec.device, undefined);
  // A hand-built yes is not the box's.
  fake.restore();
  h = await house();
  spotify();
  r = await ask(h.e, { mood: "Hi Records", length: "60", start: "true", device: "Ultra" });
  assert.equal((await lastAsk(h.e)).device, undefined);
});

// THE DJ'S PAGE FOLLOWS THE BAR (the owner, 2026-11-15: the bar said Paused
// and Sessions' page still said "Playing endless", with no Play to press).
test("a DJ's page fetches itself again when the bar says twice that the DJ started or stopped", async () => {
  const { default: vm } = await import("node:vm");
  const { e } = await house();
  spotify();
  const html = await (await get(e, "dr-funkenstein")).text();
  const script = (html.match(/<script[^>]*>\s*\(function \(\) \{\s*var dj = "dr-funkenstein", was = (?:true|false), seen = 0, agreed = false;[\s\S]*?<\/script>/) ?? [""])[0]
    .replace(/^<script[^>]*>|<\/script>$/g, "");
  assert.ok(script, "the page carries the follow script for its DJ");
  assert.match(script, /was = false/, "drawn as not playing");
  const run = ({ ask = "", active = "BODY", sheet = false } = {}) => {
    const store = {}, went = [];
    let handler = null;
    const ctx = {
      document: { addEventListener: (t, f) => { if (t === "house:now") handler = f; },
        getElementById: (id) => (id === "askmood" ? { value: ask } : null), activeElement: { tagName: active },
        querySelector: () => (sheet ? {} : null) },
      sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
      location: { reload: () => went.push("again") },
      JSON, Date,
    };
    vm.runInNewContext(script, ctx);
    return { say: (detail) => handler({ detail }), went };
  };
  const playing = { state: "playing", who: { endless: true, dj: "dr-funkenstein" } };
  // Once is not enough; twice running is; and the same change is not fetched
  // again until the bar and the page have agreed in between.
  let p = run();
  p.say(playing);
  assert.deepEqual(p.went, []);
  p.say(playing);
  assert.deepEqual(p.went, ["again"]);
  p.say(playing); p.say(playing); p.say(playing);
  assert.equal(p.went.length, 1, "a page and a bar that go on disagreeing cannot loop");
  p.say({ state: "quiet" });
  p.say(playing); p.say(playing);
  assert.equal(p.went.length, 2, "after they agreed, the next change is followed again");
  // The bar agreeing with the page, another DJ playing, or the bar not knowing: nothing.
  p = run();
  p.say({ state: "quiet" }); p.say({ state: "quiet" });
  p.say({ state: "playing", who: { endless: true, dj: "hank" } }); p.say({ state: "playing", who: { endless: true, dj: "hank" } });
  p.say(playing); p.say({ state: "unknown" }); p.say(playing);
  assert.deepEqual(p.went, [], "an answer in between that does not know starts the count again");
  // Never under somebody's hands: an ask half typed, a box in use, a sheet open.
  for (const busy of [{ ask: "Stax, the deep" }, { active: "TEXTAREA" }, { active: "SELECT" }, { sheet: true }]) {
    p = run(busy); p.say(playing); p.say(playing);
    assert.deepEqual(p.went, [], JSON.stringify(busy));
  }
});

// A SET THAT FELL TO 320 (2026-11-20): the helper's readings are the watch.
const sp = (kbps, track = "Legs", more = {}) => ({ "Pro Plus": { state: "play", source: "Spotify", playlist: pid(4), track,
  quality: { rate: 44100, bits: 16, kbps }, ...more } });
const T0 = 1_800_000_000_000;

test("fallen to 320: only a speaker known to play lossless, on a reading where something just changed", () => {
  // Never read lossless: never looked at.
  let out = fallenToLossy({ speakers: sp(320, "Before") }, sp(320), T0);
  assert.deepEqual(out.look, []);
  // A lossless reading is remembered.
  out = fallenToLossy(null, sp(963), T0);
  assert.equal(out.marks["Pro Plus"].lossless, T0);
  // The bitrate fell on the same song (a restart): looked at.
  const known = { marks: out.marks, speakers: sp(963) };
  out = fallenToLossy(known, sp(320), T0 + 10_000);
  assert.deepEqual(out.look, [{ name: "Pro Plus", playlist: pid(4), kbps: 320 }]);
  assert.equal(out.marks["Pro Plus"].tried, T0 + 10_000);
  // A new song at 320: looked at. The same song at 320 again: not.
  assert.equal(fallenToLossy({ marks: known.marks, speakers: sp(320, "Before") }, sp(320), T0 + 60_000).look.length, 1);
  assert.equal(fallenToLossy({ marks: known.marks, speakers: sp(320) }, sp(320), T0 + 60_000).look.length, 0);
  // Not twice within half a minute.
  assert.equal(fallenToLossy({ marks: out.marks, speakers: sp(320, "Before") }, sp(320), T0 + 20_000).look.length, 0);
  // Not Spotify, not playing, on no playlist, or no bitrate said: left alone.
  for (const more of [{ source: "Tidal" }, { state: "pause" }, { playlist: undefined }, { quality: { rate: 44100, kbps: 0 } }]) {
    assert.equal(fallenToLossy({ marks: known.marks, speakers: sp(320, "Before") }, sp(320, "Legs", more), T0 + 60_000).look.length, 0, JSON.stringify(more));
  }
  // Lossless last heard more than a week ago: not known any more.
  assert.equal(fallenToLossy({ marks: known.marks, speakers: sp(320, "Before") }, sp(320), T0 + LIFT.knownMs + 1).look.length, 0);
});

test("fallen to 320: a press is not repeated for ten minutes, nor for six hours when it did not help", () => {
  const prev = (marks) => ({ marks: { "Pro Plus": marks }, speakers: sp(320, "Before") });
  // Pressed, lossless heard since: again after ten minutes, not before.
  const helped = { lossless: T0 + 5000, pressed: T0 };
  assert.equal(fallenToLossy(prev(helped), sp(320), T0 + LIFT.pressedMs - 1).look.length, 0);
  assert.equal(fallenToLossy(prev(helped), sp(320), T0 + LIFT.pressedMs).look.length, 1);
  // Pressed, and no lossless reading since: six hours.
  const noHelp = { lossless: T0 - 5000, pressed: T0 };
  assert.equal(fallenToLossy(prev(noHelp), sp(320), T0 + LIFT.pressedMs).look.length, 0);
  assert.equal(fallenToLossy(prev(noHelp), sp(320), T0 + LIFT.noHelpMs).look.length, 1);
});

const reading = (e, kbps, track = "A song") => worker.fetch(new Request("https://x.test/helper/reading", { method: "POST",
  headers: { authorization: "Bearer home-key", "content-type": "application/json" },
  body: JSON.stringify({ speakers: [{ name: "Pro Plus", state: "play", source: "Spotify", playlist: pid(4), track,
    quality: { rate: 44100, bits: 16, kbps } }] }) }), e);

test("fallen to 320: the reading that shows it presses the playing list's key, in a song's first seconds only", async () => {
  const { e, asked } = await house();
  spotify();
  await start(e, 4);
  assert.deepEqual(asked, [], "a warm start presses nothing");
  assert.equal((await reading(e, 963)).status, 200);
  assert.deepEqual(asked, []);
  // Mid-song: nothing pressed, the song is not sent back to its start.
  fake.at(90_000);
  await reading(e, 320);
  assert.deepEqual(asked, []);
  // The next song begins at 320: pressed, once, and the log says so.
  fake.at(6000);
  await new Promise((r) => setTimeout(r, 5));
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + LIFT.triedMs + 1000;
    await reading(e, 320, "The next song");
    assert.deepEqual(asked, [{ cmd: "key", n: 4, speaker: "Pro Plus" }]);
    Date.now = () => realNow() + 2 * LIFT.triedMs + 2000;
    await reading(e, 320, "Another song");
    assert.equal(asked.length, 1, "not again inside ten minutes");
  } finally { Date.now = realNow; }
  const rows = (await station(e, "endless-list", { limit: 20 })).rows;
  assert.ok(rows.some((r) => r.event === "lift" && /Pro Plus read 320 kbps.*key 4 pressed.*\(ok\)/.test(r.detail)), JSON.stringify(rows));
});

test("fallen to 320: no press with the helper's hands off, or for a list on none of the speaker's keys", async () => {
  let h = await house({ hands: false });
  spotify();
  await start(h.e, 4);
  await reading(h.e, 963); await reading(h.e, 320);
  assert.deepEqual(h.asked, []);
  fake.restore();
  h = await house({ table: TABLE.filter((r) => r.btn !== 4) });
  spotify();
  await start(h.e, 4);
  await reading(h.e, 963); await reading(h.e, 320);
  assert.deepEqual(h.asked, []);
});
