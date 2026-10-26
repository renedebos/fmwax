// MC-25, THE HOME HELPER, stage 1 (tasks/done/mc25-home-helper.md): a program on
// the house's Chromebook reads each WiiM over the LAN and posts it here, and
// the bar and the Speakers page say what a WiiM plays when it is not Spotify.
// Read-only: the house sends the helper nothing.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { barWords, spotifyRest, inlineFn, listOf, qualityWords, qualityFor } from "../programs.js";
import { readingOf, obey, line, searchOrder, findSpeaker, homeNets, findWiims, matchWiims, houseSpeakers, searchPlan, HOME_NETS } from "../../helper/fmwax-helper.mjs";
import { makeEnv, makeHouseStore, installFetch, installTidalFetch, track } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const KEY = "abcdefabcdefabcdefabcdef";
const SECRET = "helper-secret-000000000000";
const hex = (s) => Buffer.from(s, "utf8").toString("hex").toUpperCase();

function env() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" });
  e.HELPER_SECRET = SECRET;
  return e;
}
const send = (e, body, secret = SECRET) => worker.fetch(new Request("https://x.test/helper/reading", {
  method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
  body: JSON.stringify(body) }), e);

test("the helper reads getPlayerStatus into the house's words: source, state, the hex-coded title and artist", () => {
  // As the Pro Plus answered on 2026-09-24, playing preset 2.
  assert.deepEqual(readingOf("Pro Plus", { mode: "10", vendor: "Tidal", status: "play",
    Title: hex("Just Like Honey"), Artist: hex("The Jesus and Mary Chain") }),
    { name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey", artists: "The Jesus and Mary Chain" });
  // And the Ultra the same evening: Spotify, stopped, with a playlist for a
  // vendor, which rides along since 2026-09-29 so the house can name the preset.
  assert.deepEqual(readingOf("Ultra", { mode: "31", vendor: "spotify:playlist:SAMPLEPLAYLIST00000027", status: "stop",
    Title: hex("Just the Two of Us") }), { name: "Ultra", state: "stop", source: "Spotify", playlist: "SAMPLEPLAYLIST00000027",
    track: "Just the Two of Us" });
  assert.equal(readingOf("Ultra", { mode: "31", vendor: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy", status: "stop" }).playlist, undefined,
    "an album is no preset's");
  assert.equal(readingOf("Pro Plus", { mode: "10", vendor: "", status: "play" }).source, "Web stream");
  assert.equal(readingOf("Pro Plus", { mode: "0", status: "stop" }).state, "idle");
  assert.deepEqual(readingOf("Ultra", null), { name: "Ultra", state: "unreachable" });
});

test("the door: its own secret, or the same 404 as any wrong guess; and only the house's WiiMs are kept", async () => {
  const e = env();
  assert.equal((await send(e, { speakers: [] }, "wrong")).status, 404);
  delete e.HELPER_SECRET;
  assert.equal((await send(e, { speakers: [] }, "")).status, 404, "no secret configured, no door");
  e.HELPER_SECRET = SECRET;
  assert.equal((await send(e, { speakers: [{ name: "Kitchen", state: "play" }] })).status, 400);
  const r = await send(e, { speakers: [
    { name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey", artists: "The Jesus and Mary Chain" },
    { name: "Ultra", state: "banana" },
    { name: "Kitchen", state: "play" }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).speakers, ["Pro Plus"]);
});

test("/playing carries a fresh reading and says the helper is on; stale, it says off and carries none", async () => {
  const e = env();
  const f = installFetch();
  try {
    const playing = async () => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`), e)).json();
    // Never heard from: nothing said (every claimed house has the key, so a
    // forum house was told its Chromebook's helper was off; 2026-10-17).
    assert.equal((await playing()).helper, undefined, "never heard from");
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey", artists: "The Jesus and Mary Chain" }] });
    const on = await playing();
    assert.equal(on.helper, "on");
    assert.deepEqual(on.lan.speakers["Pro Plus"], { state: "play", source: "Tidal", track: "Just Like Honey", artists: "The Jesus and Mary Chain" });
    // Three minutes on, with no word from the helper: off, and nothing claimed.
    const doc = JSON.parse(e.STATION.endless.helper);
    doc.at -= 3 * 60_000;
    e.STATION.endless.helper = JSON.stringify(doc);
    const stale = await playing();
    assert.equal(stale.helper, "off");
    assert.equal(stale.lan, undefined);
    // A house with no helper says nothing about one.
    delete e.HELPER_SECRET;
    assert.equal((await playing()).helper, undefined);
  } finally { f.restore(); }
});

test("the bar says what the helper read, and the Speakers page draws it on the WiiM's block with the house mark", async () => {
  assert.deepEqual(barWords({ state: "lan", speaker: "Pro Plus", source: "Tidal", lanState: "play",
    track: "Just Like Honey", artists: "The Jesus and Mary Chain" }),
    { tone: "live", one: "Just Like Honey · The Jesus and Mary Chain", two: "Pro Plus · Tidal" });
  assert.deepEqual(barWords({ state: "lan", speaker: "Pro Plus", source: "Tidal", lanState: "pause", track: "Just Like Honey" }),
    { tone: "off", one: "Paused · Just Like Honey", two: "Pro Plus · Tidal" });
  const e = env();
  const f = installFetch();
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey", artists: "The Jesus and Mary Chain" },
      { name: "Ultra", state: "idle" }] });
    const html = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`), e)).text();
    assert.match(html, /class="sblock on[^"]*" data-speaker="Pro Plus"[\s\S]*?Playing now · Tidal[\s\S]*?Just Like Honey — The Jesus and Mary Chain[\s\S]*?Read from the speaker by the home helper\./);
    assert.match(html.match(/data-speaker="Ultra"[^>]*>([\s\S]*?)<\/button>/)[1], /Not playing<\/span>/, "a quiet WiiM is quiet: with the helper on, quiet is known");
    // Said by the house mark beside the "?" (2026-10-22); the line under the
    // keys that said it went the same day (the owner: "take out").
    assert.match(html, /<details class="help pagehelp hmark" name="pagehead" data-hmark><summary class="helpq" aria-label="Home helper on">/);
    assert.ok(!html.includes("helperline"));
    // The bar's script narrows to the picked speaker and reads the helper there.
    assert.match(html, /o\.lan && o\.lan\.speakers \? o\.lan\.speakers\[who\] : null/);
  } finally { f.restore(); }
});

// SPOTIFY, STOPPED, IN THE SPEAKER'S OWN WORDS (the owner, 2026-09-29, 12:01:
// the WiiM app showed the Ultra on Spotify, stopped at Uptown Funk from preset
// 1, and the Speakers page said "Not on Spotify"). Spotify lets go of
// a speaker that sits stopped; the helper's reading still names the song and
// the playlist, and the house names the preset by it.
test("a WiiM stopped on Spotify, which Spotify no longer sees, is said as the speaker says it, with its preset", async () => {
  const GUEST = "SAMPLEPLAYLIST00000024";
  const reading = { name: "Ultra", state: "stop", source: "Spotify", playlist: GUEST, track: "Uptown Funk (feat. Bruno Mars)", artists: "Mark Ronson" };
  // The shape, and the bar's words: no hands, so the disc stays dim.
  const rest = spotifyRest({ ...reading, preset: { btn: 1, name: "Requests · Spotify" } }, "Ultra");
  assert.deepEqual(barWords(rest), { tone: "off", one: "Stopped · Uptown Funk (feat. Bruno Mars)", two: "Ultra · preset 1, Requests · Spotify" });
  assert.equal(barWords(spotifyRest({ ...reading, state: "pause" }, "Ultra")).one, "Paused · Uptown Funk (feat. Bruno Mars)");
  assert.equal(barWords(spotifyRest({ ...reading, preset: { btn: 7, name: "Guest DJ · Camille", lane: true } }, "Ultra")).two, "Ultra · Guest DJ · Camille");
  assert.equal(barWords(spotifyRest({ ...reading, playlist: undefined }, "Ultra")).two, "Ultra · Spotify", "no playlist, no preset claimed");
  assert.equal(spotifyRest({ ...reading, state: "play" }, "Ultra"), null, "playing is Spotify's to say");
  assert.equal(spotifyRest({ ...reading, source: "Tidal" }, "Ultra"), null);
  assert.equal(spotifyRest(null, "Ultra"), null);

  const e = env();
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: GUEST, catalog: "spotify" }]);
  const f = installFetch();
  try {
    await send(e, { speakers: [reading, { name: "Pro Plus", state: "stop", source: "Spotify", playlist: "0000000000NotAPreset0", track: "Elsewhere" }] });
    const on = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`), e)).json();
    assert.equal(on.state, "quiet", "Spotify itself sees nothing");
    assert.deepEqual(on.lan.speakers.Ultra.preset, { btn: 1, name: "Requests · Spotify" });
    assert.equal(on.lan.speakers["Pro Plus"].preset, undefined, "a playlist on no preset names none");
    const html = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`), e)).text();
    const ultra = html.match(/data-speaker="Ultra"[^>]*>([\s\S]*?)<\/button>/)[1];
    assert.match(ultra, /Stopped · Spotify<\/span>/);
    assert.match(ultra, /aria-label="Stopped: Uptown Funk \(feat\. Bruno Mars\) — Mark Ronson"/);
    assert.match(ultra, /<span class="smeta">From preset 1 \(Requests · Spotify\)<\/span>/);
    assert.doesNotMatch(ultra, /Not on Spotify/);
    const pro = html.match(/data-speaker="Pro Plus"[^>]*>([\s\S]*?)<\/button>/)[1];
    assert.match(pro, /Stopped · Spotify<\/span>[\s\S]*Elsewhere[\s\S]*Read from the speaker by the home helper\./);
    // Both scripts carry the one mapping, and the bar uses it only after
    // Spotify's own word (here, elsewhere) and the bar's own pause.
    assert.ok(html.includes(`var spotifyRest = ${inlineFn(spotifyRest)};`));
    assert.match(html, /elsewhere: o\.device \|\| "another speaker" \};[\s\S]{0,300}var sr = spotifyRest\(/);
  } finally { f.restore(); }
});

// THE PANEL ON A STOPPED SPEAKER (the owner, 2026-10-12, at work, the Ultra
// stopped on Pub Rock's set): the playlist it stopped on and whose set it is,
// from the helper's reading and the house's own records — no Spotify call.
test("a WiiM stopped on Spotify: the panel offers its playlist in Spotify and the DJ whose set it is", async () => {
  const GUEST = "SAMPLEPLAYLIST00000024";
  const e = env();
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: GUEST, catalog: "spotify" }]);
  await e.PROGRAMS.put(`on:${GUEST}`, JSON.stringify({ dj: "hank", ref: "request r1", at: new Date().toISOString() }));
  const f = installFetch();
  try {
    await send(e, { speakers: [{ name: "Ultra", state: "stop", source: "Spotify", playlist: GUEST, track: "Cry Tough" },
      { name: "Pro Plus", state: "stop", source: "Spotify", playlist: "0000000000NotAPreset00", track: "Elsewhere" }] });
    const on = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`), e)).json();
    const ultra = on.lan.speakers.Ultra;
    assert.equal(ultra.list, `https://open.spotify.com/playlist/${GUEST}`);
    assert.deepEqual(ultra.who, { dj: "hank", name: "Hank", kind: "request", btn: 1 });
    assert.equal(on.lan.speakers["Pro Plus"].list, "https://open.spotify.com/playlist/0000000000NotAPreset00",
      "a playlist on no preset still opens");
    assert.equal(on.lan.speakers["Pro Plus"].who, undefined, "and names nobody");
    // The bar's own pieces: the link with the line held or dim, and the row.
    for (const hands of [true, false]) {
      const sr = spotifyRest(ultra, "Ultra");
      if (hands) sr.hands = true;
      assert.deepEqual(listOf(sr, barWords(sr)), { url: ultra.list }, `hands ${hands}`);
      assert.deepEqual(sr.who, ultra.who);
    }
    const html = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/djs`), e)).text();
    assert.match(html, /var who = \(w\.tone === "live" \|\| w\.tone === "held"\) && o\.state === "playing" \? o\.who\s*: o\.state === "lan" && o\.who \? o\.who : null/);
  } finally { f.restore(); }
});

// Spotify's own word wins: playing there, the helper's stopped reading is not drawn.
test("where Spotify plays, a stopped Spotify reading from the helper says nothing", async () => {
  const e = env();
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => new URL(String(u)).pathname === "/v1/me/player" && (init.method ?? "GET") === "GET"
    ? Response.json({ is_playing: true, device: { name: "Ultra", id: "device-1" }, context: null,
      item: { name: "Superstition", uri: "spotify:track:ss", artists: [{ name: "Stevie Wonder" }] } })
    : inner(u, init);
  try {
    await send(e, { speakers: [{ name: "Ultra", state: "stop", source: "Spotify", track: "Uptown Funk (feat. Bruno Mars)" }] });
    const html = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`), e)).text();
    const ultra = html.match(/data-speaker="Ultra"[^>]*>([\s\S]*?)<\/button>/)[1];
    assert.match(ultra, /Playing now · Spotify/);
    assert.match(ultra, /Superstition/);
    assert.doesNotMatch(ultra, /Uptown Funk/);
  } finally { globalThis.fetch = inner; f.restore(); }
});

// STAGE 2: THE HELPER'S HANDS. The bar's disc pauses and plays a WiiM on
// Tidal, the radio or the archive through the helper's line.
test("the helper obeys only pause and resume, only for a speaker it knows, and answers with the speaker's read-back", async () => {
  const sent = [];
  const send = async (ip, cmd) => { sent.push([ip, cmd]); return "OK"; };
  const read = async () => ({ mode: "10", vendor: "Tidal", status: "pause", Title: hex("Just Like Honey") });
  const speakers = { "Pro Plus": "192.168.4.45" };
  const ok = await obey(speakers, { id: "a", cmd: "pause", speaker: "Pro Plus" }, send, read);
  assert.deepEqual(ok, { id: "a", ok: true, reading: { name: "Pro Plus", state: "pause", source: "Tidal", track: "Just Like Honey" } });
  assert.deepEqual(sent, [["192.168.4.45", "setPlayerCmd:pause"]]);
  assert.equal((await obey(speakers, { id: "b", cmd: "MCUKeyShortClick:2", speaker: "Pro Plus" }, send, read)).code, "refused");
  assert.equal((await obey(speakers, { id: "b2", cmd: "key", n: 13, speaker: "Pro Plus" }, send, read)).code, "refused");
  assert.equal((await obey(speakers, { id: "b3", cmd: "key", n: "2;reboot", speaker: "Pro Plus" }, send, read)).code, "refused");
  assert.equal((await obey(speakers, { id: "b4", cmd: "toString", speaker: "Pro Plus" }, send, read)).code, "refused");
  assert.equal((await obey(speakers, { id: "c", cmd: "pause", speaker: "Kitchen" }, send, read)).code, "refused");
  assert.equal(sent.length, 1, "nothing refused reached a speaker");
  assert.equal((await obey(speakers, { id: "d", cmd: "resume", speaker: "Pro Plus" }, async () => null, read)).code, "unreachable");
});

test("the bar's helper pause: sent down the line, the read-back kept; with no line, said and nothing sent", async () => {
  const e = env();
  const f = installFetch();
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey" }] });
    const press = async (verb, device = "Pro Plus") => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", headers: { accept: "application/json", origin: "https://x.test" },
      body: new URLSearchParams({ do: verb, device }) }), e)).json();
    assert.deepEqual(await press("hpause"), { ok: false, code: "helper-off" });
    const asked = [];
    e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, reading: { name: "Pro Plus", state: a.cmd === "pause" ? "pause" : "play", source: "Tidal", track: "Just Like Honey" } }; };
    const on = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`), e)).json();
    assert.equal(on.lan.hands, true, "the bar is told the helper can act");
    const before = f.calls.length;
    assert.deepEqual(await press("hpause"), { ok: true, code: "ok" });
    assert.deepEqual(asked, [{ cmd: "pause", speaker: "Pro Plus" }]);
    assert.equal(JSON.parse(e.STATION.endless.helper).speakers["Pro Plus"].state, "pause", "the read-back is the new word");
    assert.deepEqual(await press("hplay"), { ok: true, code: "ok" });
    assert.equal(asked[1].cmd, "resume");
    // Spotify's quota has nothing to do with it, and no Spotify call is made.
    assert.ok(!f.calls.slice(before).some((c) => /me\/player/.test(c)), f.calls.slice(before).join(", "));
  } finally { f.restore(); }
});

test("the bar's disc: pause while the helper reads play, play while it reads pause, only with the line open", () => {
  assert.equal(barWords({ state: "lan", speaker: "Pro Plus", source: "Tidal", lanState: "pause", track: "X", hands: true }).tone, "held");
  return worker.fetch(new Request(`https://x.test/buttons/${KEY}/djs`), env()).then((r) => r.text()).then((html) => {
    // Not for Spotify stopped on a WiiM: that one presses its preset (below).
    assert.match(html, /var hdo = keyBtn \? "hkey" : o && o\.state === "lan" && o\.hands && !spotRest \? \(o\.lanState === "play" \? "hpause" : "hplay"\) : "";/);
    assert.match(html, /verb === "hpause" \|\| verb === "hplay" \|\| verb === "hkey"/);
  });
});

// STAGE 3: ANY KEY. The Speakers page offers the keys the Spotify path
// cannot start while the helper's line is open, and the helper presses them.
test("the helper presses a key 1-12 and nothing else", async () => {
  const sent = [];
  const out = await obey({ "Pro Plus": "192.168.4.45" }, { id: "k", cmd: "key", n: 2, speaker: "Pro Plus" },
    async (ip, cmd) => { sent.push(cmd); return "OK"; }, async () => ({ mode: "10", vendor: "Tidal", status: "play", Title: hex("Just Like Honey") }));
  assert.deepEqual(sent, ["MCUKeyShortClick:2"]);
  assert.equal(out.reading.source, "Tidal");
});

test("the Speakers page: a Tidal key is a helper press while the line is open, a link without it; the press comes back with its words", async () => {
  const e = env();
  const f = installFetch();
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "stop", source: "Spotify" }] });
    // The phone's reading of the Pro Plus: a Tidal key on 2.
    await e.PROGRAMS.put("reading:pro-plus", JSON.stringify({ at: new Date().toISOString(),
      presets: [{ btn: 2, name: "DJ Guest · Tidal", source: "Tidal" }] }));
    const page = async () => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`), e)).text();
    e.STATION.endless.hands = async () => ({ ok: true });
    assert.match(await page(), /action="\/buttons\/[a-f0-9]+\/wiim\/key" class="kform"><input type="hidden" name="btn" value="2">/);
    delete e.STATION.endless.hands;
    assert.ok(!(await page()).includes("/wiim/key"), "no line, no press");
    const asked = [];
    e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, reading: { name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey" } }; };
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/key`, { method: "POST",
      body: new URLSearchParams({ btn: "2", device: "Pro Plus" }) }), e);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), `/buttons/${KEY}/wiim?hk=ok&k=2&kon=pro-plus`);
    assert.deepEqual(asked, [{ cmd: "key", n: 2, speaker: "Pro Plus" }]);
    const after = await (await worker.fetch(new Request(`https://x.test${r.headers.get("location")}`), e)).text();
    assert.match(after, /data-speaker="Pro Plus"[\s\S]*?Playing now · Tidal[\s\S]*?Just Like Honey/, "the block says what the key started");
    delete e.STATION.endless.hands;
    const off = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/key`, { method: "POST",
      body: new URLSearchParams({ btn: "2", device: "Pro Plus" }) }), e);
    const offPage = await (await worker.fetch(new Request(`https://x.test${off.headers.get("location")}`), e)).text();
    assert.match(offPage, /The home helper is not connected, so 2 could not be pressed from here\./);
    assert.equal((await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/key`, { method: "POST",
      body: new URLSearchParams({ btn: "13", device: "Pro Plus" }) }), e)).status, 400);
  } finally { f.restore(); }
});

// THE OWNER'S 1-2-3 (2026-09-24, late): the preset tables read by the helper,
// the Spotify keys pressed by it too, and a Play for the Tidal guest.
const GT = "0b1f2c3d-aaaa-bbbb-cccc-000000000002";
const GS = "GUESTSPOTIFY0000000001";
function guestEnv() {
  const e = env();
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "DJ Guest", playlist: GS, catalog: "spotify" },
    { button: 2, guest: true, live: true, name: "DJ Guest · Tidal", playlist: GT, catalog: "tidal" },
    { button: 6, archive: true }]);
  // Both guests saved on both speakers, so the Speakers tab is the page and
  // not the old save checklist.
  const saved = (name, playlist) => ({ at: "2026-09-13T00:10:00Z", name, playlist });
  e.PROGRAMS.put("wiim:resaved", JSON.stringify({
    "1": { "Pro Plus": saved("DJ Guest", GS), Ultra: saved("DJ Guest", GS) },
    "2": { "Pro Plus": saved("DJ Guest · Tidal", GT), Ultra: saved("DJ Guest · Tidal", GT) } }));
  return e;
}
const TABLE = "<KeyList><Key1><Name>DJ Guest - Spotify_#~2026-09-13 10:00:00</Name><Source>SPOTIFY</Source></Key1>" +
  "<Key2><Name>DJ Guest · Tidal_#~2026-09-13 10:00:00</Name><Source>Tidal</Source></Key2></KeyList>";

test("3: the helper's preset table is kept as the phone's is, marked as the helper's; its own secret or 404", async () => {
  const e = guestEnv();
  const post = (secret, slug = "pro-plus") => worker.fetch(new Request(`https://x.test/helper/presets/${slug}`, {
    method: "POST", headers: { authorization: `Bearer ${secret}` }, body: TABLE }), e);
  assert.equal((await post("wrong")).status, 404);
  assert.equal((await post(SECRET, "kitchen")).status, 404);
  const r = await post(SECRET);
  assert.equal(r.status, 200);
  const rec = JSON.parse(await e.PROGRAMS.get("reading:pro-plus"));
  assert.equal(rec.by, "helper");
  assert.deepEqual(rec.presets.map((p) => [p.btn, p.source]), [[1, "Spotify"], [2, "Tidal"]]);
});

test("2 and 1: with the line open every saved key is a helper press, and the Loaded band for the Tidal guest plays", async () => {
  const e = guestEnv();
  const f = installFetch({ contents: [track("a1"), track("a2")] });
  const t = installTidalFetch({ contents: [101, 102] });
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "stop", source: "Spotify" }] });
    await worker.fetch(new Request("https://x.test/helper/presets/pro-plus", { method: "POST",
      headers: { authorization: `Bearer ${SECRET}` }, body: TABLE }), e);
    // The Librarian's set on the Tidal guest, as the door leaves it.
    await e.PROGRAMS.put(`on:${GT}`, JSON.stringify({ dj: "the-librarian", ref: "r1", at: new Date().toISOString() }));
    const get = async (p) => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}${p}`), e)).text();
    e.STATION.endless.hands = async () => ({ ok: true });
    const on = await get("/wiim");
    assert.match(on, /action="\/buttons\/[a-f0-9]+\/wiim\/key" class="kform"><input type="hidden" name="btn" value="1">/, "the Spotify key too");
    assert.ok(!on.includes("/preset/play"), "no Spotify path while the helper can press");
    const loaded = await get("");
    assert.match(loaded, /<form method="post" action="\/buttons\/[a-f0-9]+\/wiim\/key" class="bplay hkey"><input type="hidden" name="btn" value="2"><input type="hidden" name="device" value="Pro Plus"><input type="hidden" name="back" value="loaded">/);
    assert.ok(!/class="bopen"[^>]*>Open in Tidal/.test(loaded), "no second door beside the play circle");
    assert.ok(!loaded.includes('gpress">on the Pro Plus'), "the Pro Plus picked: nothing to say");
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Living Room"]);
    const echoPicked = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}`, { headers: { cookie: "spk=living-room" } }), e)).text();
    assert.match(echoPicked, /name="device" value="Pro Plus"[\s\S]*?<span class="bnote gpress">on the Pro Plus<\/span>/, "the Living Room picked: the circle says where it plays");
    assert.match(loaded, /only Spotify moves between speakers/, "the bar says Tidal stays put");
    delete e.STATION.endless.hands;
    assert.ok(!(await get("")).includes("/wiim/key"), "no line: the band says Press 2 again");
    assert.match(await get(""), /class="bopen"[^>]*>Open in Tidal/, "and its Open in Tidal is back");
    assert.match(await get(""), /Press 2/);
    // The press from Loaded comes back to Loaded.
    e.STATION.endless.hands = async () => ({ ok: true, reading: { name: "Pro Plus", state: "play", source: "Tidal" } });
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/key`, { method: "POST",
      body: new URLSearchParams({ btn: "2", device: "Pro Plus", back: "loaded" }) }), e);
    assert.equal(r.headers.get("location"), `/buttons/${KEY}?hk=ok&k=2&kon=pro-plus`);
    const bad = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/key`, { method: "POST",
      body: new URLSearchParams({ btn: "2", device: "Pro Plus", back: "https://evil.example/" }) }), e);
    assert.equal(bad.headers.get("location"), `/buttons/${KEY}/wiim?hk=ok&k=2&kon=pro-plus`, "an unknown back is Speakers");
  } finally { t.restore(); f.restore(); }
});

test("1: a Tidal set on the Tidal guest gets a Shelf Play, pressed by the helper", async () => {
  const e = guestEnv();
  const f = installFetch();
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "stop", source: "Spotify" }] });
    await e.PROGRAMS.put("program:dark-1", JSON.stringify({ slug: "dark-1", title: "Darklands", dj: "The Librarian",
      created: "2026-09-13T10:00:00Z", playlistId: GT, sections: [{ heading: "h", tracks: [{ uri: "tidal:track:1" }] }] }),
      { metadata: { created: "2026-09-13T10:00:00Z", tracks: 1, runtime: "4:00", title: "Darklands", dj: "The Librarian", catalog: "tidal" } });
    await e.PROGRAMS.put(`current:${GT}`, "dark-1");
    const asked = [];
    e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, reading: { name: "Pro Plus", state: "play", source: "Tidal" } }; };
    const r = await worker.fetch(new Request(`https://x.test/notes/${KEY}/play`, { method: "POST",
      body: new URLSearchParams({ slug: "dark-1", device: "Pro Plus" }) }), e);
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), /played=ok&on=Pro%20Plus&slug=dark-1/);
    assert.deepEqual(asked, [{ cmd: "key", n: 2, speaker: "Pro Plus" }]);
    delete e.STATION.endless.hands;
    const off = await worker.fetch(new Request(`https://x.test/notes/${KEY}/play`, { method: "POST",
      body: new URLSearchParams({ slug: "dark-1", device: "Pro Plus" }) }), e);
    assert.equal(off.status, 400, "no helper: refused in words, as before");
  } finally { f.restore(); }
});

// OPTION A (the owner, 2026-09-24): Play on every Tidal card. A set not on
// the Tidal guest is put there first — the same write as "Put on preset" —
// then the helper presses the key; the card says Play replaces preset 2.
test("A: a Tidal card plays even when it is not on preset 2: put there first, then pressed; the card says so", async () => {
  const e = guestEnv();
  const f = installFetch();
  const t = installTidalFetch({ contents: [101] });
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "stop", source: "Spotify" }] });
    await e.PROGRAMS.put("program:jay-1", JSON.stringify({ slug: "jay-1", title: "The Jayhawks Family Tree", dj: "The Librarian",
      created: "2026-09-13T10:00:00Z", playlistId: GT, sections: [{ heading: "h", tracks: [{ uri: "tidal:track:101" }] }] }),
      { metadata: { created: "2026-09-13T10:00:00Z", tracks: 1, runtime: "4:00", title: "The Jayhawks Family Tree", dj: "The Librarian", catalog: "tidal" } });
    const asked = [];
    e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, reading: { name: "Pro Plus", state: "play", source: "Tidal" } }; };
    const shelf = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}`), e)).text();
    assert.match(shelf, /value="jay-1" class="play"\s+aria-label="Play The Jayhawks Family Tree now, on preset 2 in place of what is there"/);
    assert.match(shelf, /<span class="cmeta cswap">Play replaces preset 2<\/span>/);
    // Filtered to Tidal, with no Spotify row on the page, the form the
    // cards' Play submits is still there (the owner's 22:43 press).
    const tidalOnly = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}?svc=tidal`), e)).text();
    assert.match(tidalOnly, /value="jay-1" class="play"/);
    assert.match(tidalOnly, /<form method="post" action="\/notes\/[a-f0-9]+\/play" id="play"/);
    const r = await worker.fetch(new Request(`https://x.test/notes/${KEY}/play`, { method: "POST",
      body: new URLSearchParams({ slug: "jay-1", device: "Pro Plus" }) }), e);
    assert.match(r.headers.get("location"), /played=ok-put&on=Pro%20Plus&slug=jay-1/);
    assert.equal(await e.PROGRAMS.get(`current:${GT}`), "jay-1", "it is on the Tidal guest now");
    assert.deepEqual(asked, [{ cmd: "key", n: 2, speaker: "Pro Plus" }]);
    // No helper: no Play on the card, as before.
    delete e.STATION.endless.hands;
    const off = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}`), e)).text();
    assert.ok(!off.includes('value="jay-1" class="play"'));
  } finally { t.restore(); f.restore(); }
});

test("the helper can ask whether the house sees its line; its own secret or 404", async () => {
  const e = env();
  const ask = (secret) => worker.fetch(new Request("https://x.test/helper/status", { headers: { authorization: `Bearer ${secret}` } }), e);
  assert.equal((await ask("wrong")).status, 404);
  assert.deepEqual(await (await ask(SECRET)).json(), { ok: true, hands: false });
  e.STATION.endless.hands = async () => ({ ok: true });
  assert.deepEqual(await (await ask(SECRET)).json(), { ok: true, hands: true });
  // And what it last read, for the install's "Connected" (Codex, 2026-10-19:
  // a line is not a WiiM read).
  await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal" }, { name: "Ultra", state: "unreachable" }] });
  const st = await (await ask(SECRET)).json();
  assert.deepEqual(st.read.speakers, { "Pro Plus": "play", Ultra: "unreachable" });
  assert.ok(Math.abs(st.read.at - Date.now()) < 5000);
});

// THE TIDAL REQUEST, HEARD (the owner, 2026-09-26: Monk's Tidal set on the
// Pro Plus and the Loaded tab silent): a helper reading whose song is in the
// Tidal guest's set names that band; a song that is not, nothing.
test("/playing names the Tidal request's band when the helper hears one of its songs on a WiiM", async () => {
  const e = guestEnv();
  const f = installFetch({ contents: [track("a1")] });
  try {
    // Monk's until he was cut (2026-10-15): a DJ the house still has.
    await e.PROGRAMS.put(`on:${GT}`, JSON.stringify({ dj: "dr-funkenstein", ref: "shade", at: new Date().toISOString() }));
    await e.PROGRAMS.put("program:shade", JSON.stringify({ slug: "shade", title: "The Shade Side", playlistId: GT,
      sections: [{ tracks: [{ uri: "tidal:track:1", title: "Bernie's Tune" }, { uri: "tidal:track:2", title: "The Train and the River" }] }] }));
    const ask = async () => JSON.parse(await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).text());
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", track: "The Train And The River - Remastered", artists: "Jimmy Giuffre 3" }] });
    const o = await ask();
    assert.deepEqual(o.lanBand, { btn: 2, speaker: "Pro Plus", state: "play", track: "The Train And The River - Remastered", name: "Dr. Funkenstein", artists: "Jimmy Giuffre 3" });
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", track: "Something Else" }] });
    assert.equal((await ask()).lanBand, undefined, "a song not in the set claims nothing");
    const loaded = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}`), e)).text();
    assert.match(loaded, /var lb = o\.lanBand, viaLan = false;/);
  } finally { f.restore(); }
});

// THE RADIO MOVES (the owner, 2026-10-03: "can I move between WiiM
// devices?"). Measured on the Pro Plus playing preset 10 the same morning:
// getPlayerStatus names the programme, getMetaInfo's subtitle the station,
// exactly as preset 10 is named on both speakers.
test("stationKey: the one radio preset of that name, never a Spotify or Tidal one, never one of two", async () => {
  const { stationKey } = await import("../now.js");
  const rows = [{ btn: 10, name: "KQED-FM", source: "TuneIn" }, { btn: 1, name: "KQED-FM", source: "Spotify" }];
  assert.equal(stationKey(rows, "KQED-FM"), 10);
  assert.equal(stationKey([...rows, { btn: 11, name: "kqed-fm", source: "WiiM radio" }], "KQED-FM"), null, "two radio keys: which?");
  assert.equal(stationKey(rows, ""), null);
});

test("the helper names a radio station from getMetaInfo, and only a radio station", () => {
  const meta = { metaData: { title: "The Sam Sanders Show", subtitle: "KQED-FM", artist: "unknow", trackId: "s34804" } };
  assert.deepEqual(readingOf("Pro Plus", { mode: "10", vendor: "newTuneIn", status: "play",
    Title: hex("The Sam Sanders Show-The Sam Sanders Show from KCRW is your weekly guide to entertainment. "), Artist: "", meta }),
    { name: "Pro Plus", state: "play", source: "newTuneIn", station: "KQED-FM",
      track: "The Sam Sanders Show-The Sam Sanders Show from KCRW is your weekly guide to entertainment." });
  assert.equal(readingOf("Pro Plus", { mode: "10", vendor: "newTuneIn", status: "play", meta: { metaData: { subtitle: "unknow" } } }).station, undefined);
  assert.equal(readingOf("Pro Plus", { mode: "10", vendor: "Tidal", status: "play", meta }).station, undefined, "Tidal is no station");
  assert.equal(readingOf("Pro Plus", { mode: "10", vendor: "newTuneIn", status: "play" }).station, undefined, "no meta, no name");
  // WiiM's own radio: the subtitle unknown, the station the title (the Pro
  // Plus on 12, Radio Paradise, the same morning).
  assert.equal(readingOf("Pro Plus", { mode: "10", vendor: "WiiMRadio", status: "play", Title: hex("Radio Paradise"),
    meta: { metaData: { title: "Radio Paradise", subtitle: "unknow", artist: "California, United States" } } }).station, "Radio Paradise");
  assert.equal(readingOf("Pro Plus", { mode: "10", vendor: "newTuneIn", status: "play",
    meta: { metaData: { title: "The Sam Sanders Show", subtitle: "unknow" } } }).station, undefined, "a TuneIn programme is no station");
  // Pandora names only the song (the Ultra on 11, the same morning): its one
  // Pandora preset is the station; two, or none, name nothing.
  const pandora = { mode: "10", vendor: "Pandora2", status: "play", Title: hex("Respect (2021 Remaster)"), Artist: hex("Aretha Franklin"),
    meta: { metaData: { title: "Respect (2021 Remaster)", subtitle: "unknow" } } };
  const party = { btn: 11, name: "Party Music for Everyone", source: "Pandora2" };
  const rows = [{ btn: 10, name: "KQED-FM", source: "TuneIn" }, party];
  assert.equal(readingOf("Ultra", pandora, rows).station, "Party Music for Everyone");
  assert.equal(readingOf("Pro Plus", { ...pandora, Title: hex("Stayin&apos; Alive (From &quot;Saturday Night Fever&quot; Soundtrack)") }).track,
    "Stayin' Alive (From \"Saturday Night Fever\" Soundtrack)", "Pandora's escaped title, unescaped");
  assert.equal(readingOf("Ultra", pandora, [...rows, { btn: 12, name: "Soul Radio", source: "Pandora2" }]).station, undefined, "two: which?");
  assert.equal(readingOf("Ultra", pandora, rows.slice(0, 1)).station, undefined, "none saved");
  assert.equal(readingOf("Ultra", pandora).station, undefined, "no table read yet");
  assert.equal(readingOf("Ultra", { mode: "10", vendor: "Tidal", status: "play" }, [{ btn: 2, name: "Requests - Tidal", source: "Tidal" }]).station,
    undefined, "Tidal stays where it started");
});

test("the helper reads a stream's quality from getMetaInfo: a streaming service playing or paused, never the archive or an input", () => {
  // As the Pro Plus answered on 2026-10-25.
  const m = (sampleRate, bitDepth, bitRate) => ({ metaData: { sampleRate, bitDepth, bitRate } });
  assert.deepEqual(readingOf("Pro Plus", { mode: "31", vendor: "spotify:playlist:SAMPLEPLAYLIST00000026", status: "play",
    Title: hex("Route"), meta: m("44100", "16", "1010") }),
    { name: "Pro Plus", state: "play", source: "Spotify", playlist: "SAMPLEPLAYLIST00000026", track: "Route",
      quality: { rate: 44100, bits: 16, kbps: 1010 } });
  assert.deepEqual(readingOf("Pro Plus", { mode: "10", vendor: "Tidal", status: "pause", meta: m("44100", "16", "505") }).quality,
    { rate: 44100, bits: 16, kbps: 505 }, "paused: still the stream's");
  assert.deepEqual(readingOf("Pro Plus", { mode: "10", vendor: "newTuneIn", status: "play", meta: m("44100", "32", "128") }).quality,
    { rate: 44100, bits: 32, kbps: 128 });
  assert.deepEqual(readingOf("Pro Plus", { mode: "10", vendor: "WiiMRadio", status: "play", meta: m("44100", "16", "0") }).quality,
    { rate: 44100, bits: 16, kbps: 0 }, "Radio Paradise gives no bitrate");
  assert.equal(readingOf("Pro Plus", { mode: "10", vendor: "CustomRadio", status: "play", meta: m("44100", "16", "320") }).quality,
    undefined, "the archive: skipped (the owner)");
  assert.equal(readingOf("Pro Plus", { mode: "40", vendor: "", status: "play", meta: m("48000", "24", "0") }).quality, undefined, "an input");
  assert.equal(readingOf("Pro Plus", { mode: "1", vendor: "", status: "play", meta: m("44100", "16", "0") }).quality, undefined, "AirPlay");
  assert.equal(readingOf("Pro Plus", { mode: "31", vendor: "spotify:playlist:SAMPLEPLAYLIST00000026", status: "stop",
    meta: m("44100", "16", "912") }).quality, undefined, "stopped");
  assert.equal(readingOf("Pro Plus", { mode: "31", vendor: "", status: "play", meta: m("", "", "") }).quality, undefined, "no numbers");
  assert.equal(readingOf("Pro Plus", { mode: "31", vendor: "", status: "play" }).quality, undefined, "no meta");
});

test("the door keeps a stream's quality as numbers, and never the archive's", async () => {
  const e = env();
  const f = installFetch();
  try {
    const playing = async () => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`), e)).json();
    await send(e, { speakers: [
      { name: "Pro Plus", state: "play", source: "Tidal", track: "My Funny Valentine", quality: { rate: 44100, bits: 16, kbps: 505 } },
      { name: "Ultra", state: "play", source: "CustomRadio", track: "Baby", quality: { rate: 44100, bits: 16, kbps: 320 } }] });
    let sp = (await playing()).lan.speakers;
    assert.deepEqual(sp["Pro Plus"].quality, { rate: 44100, bits: 16, kbps: 505 });
    assert.equal(sp.Ultra.quality, undefined, "the archive");
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", quality: { rate: "44100<b>", bits: 16, kbps: 505 } },
      { name: "Ultra", state: "play", source: "newTuneIn", quality: { rate: 44100, bits: 99, kbps: -1 } }] });
    sp = (await playing()).lan.speakers;
    assert.equal(sp["Pro Plus"].quality, undefined, "a rate that is no number");
    assert.deepEqual(sp.Ultra.quality, { rate: 44100, kbps: 0 }, "a bad depth and bitrate dropped, the rate kept");
  } finally { f.restore(); }
});

test("the panel says a stream's quality: lossless, compressed, or the numbers alone", () => {
  assert.equal(qualityWords({ rate: 44100, bits: 16, kbps: 1010 }), "Lossless · 16-bit / 44.1 kHz · 1010 kbps");
  // Come Together on Tidal, the Pro Plus 2026-10-25: the speaker said 32, the Tidal app 24-bit/96 kHz.
  assert.equal(qualityWords({ rate: 96000, bits: 32, kbps: 2958 }), "Lossless · 24-bit / 96 kHz · 2958 kbps");
  assert.equal(qualityWords({ rate: 96000, bits: 24, kbps: 2900 }), "Lossless · 24-bit / 96 kHz · 2900 kbps");
  assert.equal(qualityWords({ rate: 44100, bits: 32, kbps: 0 }), "44.1 kHz", "32 bits, not lossless: no stream's depth");
  assert.equal(qualityWords({ rate: 44100, bits: 32, kbps: 128 }), "Compressed · 128 kbps", "TuneIn's 32 bits are the decoder's");
  assert.equal(qualityWords({ rate: 44100, bits: 16, kbps: 320 }), "Compressed · 320 kbps");
  assert.equal(qualityWords({ rate: 44100, bits: 16, kbps: 290 }), "16-bit / 44.1 kHz · 290 kbps", "a quiet mono record may be lossless");
  assert.equal(qualityWords({ rate: 44100, bits: 16, kbps: 0 }), "16-bit / 44.1 kHz", "Radio Paradise");
  assert.equal(qualityWords({ rate: 48000, kbps: 0 }), "48 kHz");
  assert.equal(qualityWords(null), "");
  const last = { lan: { speakers: {
    "Pro Plus": { state: "play", source: "Spotify", quality: { rate: 44100, bits: 16, kbps: 912 } },
    Ultra: { state: "play", source: "Tidal", quality: { rate: 44100, bits: 16, kbps: 505 } } } } };
  assert.deepEqual(qualityFor({ state: "playing", device: "Pro Plus" }, last), { rate: 44100, bits: 16, kbps: 912 });
  assert.deepEqual(qualityFor({ state: "lan", speaker: "Ultra" }, last), { rate: 44100, bits: 16, kbps: 505 });
  assert.equal(qualityFor({ state: "playing", device: "Ultra" }, last), null, "Spotify's answer, the speaker on Tidal: not the same stream");
  assert.equal(qualityFor({ state: "playing", device: "Living Room" }, last), null, "no reading for an Echo");
  assert.equal(qualityFor({ state: "lan", speaker: "Ultra" }, { lan: { speakers: { Ultra: { ...last.lan.speakers.Ultra, state: "pause" } } } }),
    null, "paused: nothing playing to describe");
  assert.equal(qualityFor({ state: "lan", speaker: "Ultra" }, {}), null, "helper off");
  // Both go into the bar's script by their source, so they must run there.
  assert.equal(new Function(`return ${inlineFn(qualityWords)}`)()({ rate: 44100, bits: 16, kbps: 505 }), "Lossless · 16-bit / 44.1 kHz · 505 kbps");
  assert.deepEqual(new Function(`return ${inlineFn(qualityFor)}`)()({ state: "lan", speaker: "ultra" }, last), { rate: 44100, bits: 16, kbps: 505 });
});

test("the bar's radio move: the same station's key pressed on the other WiiM, then the first paused", async () => {
  const e = env();
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Living Room"]);
  const f = installFetch();
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "newTuneIn", station: "KQED-FM", track: "The Sam Sanders Show" },
      { name: "Ultra", state: "stop", source: "Spotify" }] });
    const on = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`), e)).json();
    assert.equal(on.lan.speakers["Pro Plus"].station, "KQED-FM", "the station rides on the reading");
    await e.PROGRAMS.put("reading:ultra", JSON.stringify({ at: new Date().toISOString(), presets: [
      { btn: 6, name: ARCHIVE.name, source: "Web stream" }, { btn: 10, name: "KQED-FM", source: "TuneIn" },
      { btn: 11, name: "NPO 3FM", source: "TuneIn" }] }));
    const move = async (device, from = "Pro Plus") => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", headers: { accept: "application/json", origin: "https://x.test" },
      body: new URLSearchParams({ do: "hmove", device, from }) }), e)).json();
    assert.deepEqual(await move("Ultra"), { ok: false, code: "helper-off" }, "no line, nothing sent");
    const asked = [];
    let answer = (a) => ({ ok: true, reading: a.cmd === "key"
      ? { name: "Ultra", state: "play", source: "newTuneIn", station: "KQED-FM" }
      : { name: "Pro Plus", state: "pause", source: "newTuneIn", station: "KQED-FM" } });
    e.STATION.endless.hands = async (a) => { asked.push(a); return answer(a); };
    const before = f.calls.length;
    assert.deepEqual(await move("Ultra"), { ok: true, code: "ok", station: "KQED-FM", btn: 10 });
    assert.deepEqual(asked, [{ cmd: "key", n: 10, speaker: "Ultra" }, { cmd: "pause", speaker: "Pro Plus" }], "the press first, then the pause");
    const doc = JSON.parse(e.STATION.endless.helper).speakers;
    assert.equal(doc.Ultra.state, "play");
    assert.equal(doc["Pro Plus"].state, "pause", "both read-backs kept");
    assert.ok(!f.calls.slice(before).some((c) => /me\/player/.test(c)), "no Spotify call");

    // A press that fails leaves the radio where it was; a pause that fails says both play.
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "newTuneIn", station: "KQED-FM" }, { name: "Ultra", state: "stop" }] });
    asked.length = 0;
    answer = () => ({ ok: false, code: "unreachable" });
    assert.deepEqual(await move("Ultra"), { ok: false, code: "unreachable", station: "KQED-FM", btn: 10 });
    assert.equal(asked.length, 1, "no pause after a failed press");
    answer = (a) => (a.cmd === "key" ? { ok: true } : { ok: false, code: "timeout" });
    assert.equal((await move("Ultra")).code, "both");

    // No key under that name on the other WiiM, a WiiM to itself, an Echo: nothing pressed.
    asked.length = 0;
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "newTuneIn", station: "Radio Paradise" }, { name: "Ultra", state: "stop" }] });
    assert.deepEqual(await move("Ultra"), { ok: false, code: "stays", station: "Radio Paradise" });
    assert.deepEqual(await move("Pro Plus"), { ok: false, code: "here" });
    assert.deepEqual(await move("Living Room"), { ok: false, code: "not-wiim" });
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey" }, { name: "Ultra", state: "stop" }] });
    assert.equal((await move("Ultra")).code, "stays", "Tidal names no station, so it stays");
    assert.deepEqual(asked, []);

    // CODEX'S REVIEW (2026-10-09). The bar says which station it saw: one the
    // source no longer reads is not moved, and nothing is pressed.
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "newTuneIn", station: "KQED-FM" }, { name: "Ultra", state: "stop" }] });
    asked.length = 0;
    const moveSaw = async (saw) => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", headers: { accept: "application/json", origin: "https://x.test" },
      body: new URLSearchParams({ do: "hmove", device: "Ultra", from: "Pro Plus", station: saw }) }), e)).json();
    assert.deepEqual(await moveSaw("NPO 3FM"), { ok: false, code: "changed" });
    assert.deepEqual(asked, [], "nothing pressed");
    // A key that starts another station leaves the source playing.
    answer = (a) => (a.cmd === "key" ? { ok: true, reading: { name: "Ultra", state: "play", source: "newTuneIn", station: "Jazz FM" } } : { ok: true });
    assert.deepEqual(await moveSaw("KQED-FM"), { ok: false, code: "mismatch", station: "KQED-FM", btn: 10, heard: "Jazz FM" });
    assert.deepEqual(asked.map((a) => a.cmd), ["key"], "no pause after the wrong station started");
    // The source must be a speaker the pages may name.
    e.ROOM_DEVICES = JSON.stringify(["Ultra", "Living Room"]);
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "newTuneIn", station: "KQED-FM" }, { name: "Ultra", state: "stop" }] });
    assert.equal((await move("Ultra")).code, "not-wiim");
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Living Room"]);

    // The bar's script: a WiiM chip moves a named station while the helper can act.
    const html = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/djs`), e)).text();
    assert.match(html, /else if \(stays && stays\.station && stays\.hands && isWiim\(name\)\) hmove\(name, stays\);/);
    assert.match(html, /body\.set\("do", "hmove"\); body\.set\("device", name\); body\.set\("from", was\.speaker\);/);
    assert.match(html, /station: ln\.station \|\| ""/);
  } finally { f.restore(); }
});

// A REQUEST NAMES ITS DJ ON THE BAR (the owner, 2026-10-10: "Hank, a set for
// cooking" by Talk played on 1 and the bar said "Requests · Spotify").
test("the bar names a request's DJ, playing and paused; a request with no DJ reads as before", () => {
  const playing = { state: "playing", track: "Witchoo", artists: "Durand Jones", device: "Ultra", guest: true, btn: 1,
    preset: { btn: 1, name: "Requests · Spotify" }, who: { dj: "hank", name: "Hank", kind: "request", btn: 1 } };
  assert.equal(barWords(playing).two, "Ultra · preset 1, Requests · Hank");
  assert.equal(barWords({ ...playing, who: null }).two, "Ultra · preset 1, Requests · Spotify", "no DJ named: the preset's name");
  assert.equal(barWords({ ...playing, guest: false, who: { dj: "hank", name: "Hank", kind: "house", btn: 5 },
    preset: { btn: 5, name: "Hank" } }).two, "Ultra · preset 5, Hank", "a house DJ as before");
  const paused = { state: "quiet", paused: { track: "Witchoo", device: "Ultra", preset: { btn: 1, name: "Requests · Spotify", dj: "Hank" } } };
  assert.equal(barWords(paused).two, "Ultra · preset 1, Requests · Hank");
});

// SPOTIFY STOPPED ON A WIIM, PLAYED AGAIN FROM THE BAR (the owner, 2026-10-10,
// 23:37: Pub Rock stopped on the Pro Plus, Spotify had let go, the disc was
// dim). The bar presses the preset the song came from through the helper,
// never Spotify's resume (which plays the account's last session).
test("the bar's play on a stopped Spotify WiiM presses its preset through the helper", async () => {
  const e = env();
  const f = installFetch();
  try {
    const press = async (body) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", headers: { accept: "application/json", origin: "https://x.test" },
      body: new URLSearchParams(body) }), e);
    assert.deepEqual(await (await press({ do: "hkey", device: "Pro Plus", btn: "3" })).json(), { ok: false, code: "helper-off" });
    const asked = [];
    e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true }; };
    const before = f.calls.length;
    const ok = await press({ do: "hkey", device: "Pro Plus", btn: "3" });
    assert.deepEqual(await ok.json(), { ok: true, code: "ok" });
    assert.deepEqual(asked, [{ cmd: "key", n: 3, speaker: "Pro Plus" }], "key 3, on the Pro Plus");
    assert.match(ok.headers.get("set-cookie") ?? "", /^spk=pro-plus\.\d+/, "and the speaker is picked, as a key picks it");
    assert.ok(!f.calls.slice(before).some((c) => /me\/player/.test(c)), "no Spotify call: never its resume");
    assert.deepEqual(await (await press({ do: "hkey", device: "Pro Plus", btn: "13" })).json(), { ok: false, code: "failed" }, "1-12 only");
    assert.equal(asked.length, 1);
    // A form without JSON is refused, as every bar-only verb is.
    const form = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, {
      method: "POST", headers: { origin: "https://x.test" }, body: new URLSearchParams({ do: "hkey", device: "Pro Plus", btn: "3" }) }), e);
    assert.equal(form.status, 400);
  } finally { f.restore(); }
  // The bar's script: a stopped Spotify WiiM whose preset is known gets the helper's hands, and its disc the key.
  const html = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/djs`), env())).text();
  assert.match(html, /if \(sr && sr\.preset && sr\.preset\.btn && o\.lan && o\.lan\.hands\) sr\.hands = true;/);
  assert.match(html, /var keyBtn = spotRest && o\.hands && o\.lanState !== "play" && o\.preset && o\.preset\.btn \? Number\(o\.preset\.btn\) : 0;/);
  assert.equal(barWords({ ...spotifyRest({ state: "stop", source: "Spotify", track: "Cruel to Be Kind",
    preset: { btn: 3, name: "Guest DJ · Pub Rock", lane: true } }, "Pro Plus"), hands: true }).tone, "held", "lit, not dim");
});

// THE LINE'S RACE (2026-10-11, 22:27): the minute's "does the house see this
// line?" was still waiting when the line closed and set its own reopen; the
// house's no then opened a second line beside it. The house keeps one helper
// line and closes the older, so the two pushed each other off, 740 times,
// until the Chromebook went off at 00:39.
test("the helper's line: a no from the house that lands after the line closed opens one line, not two", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  const made = [];
  class Socket {
    constructor() { this.readyState = 0; made.push(this); }
    // The house answers a ping with "pong" without waking.
    send(text) { if (text === "ping") this.onmessage?.({ data: "pong" }); }
    close() { this.readyState = 3; }
    // The house takes a new line and closes the open one it had (station.js).
    up() {
      for (const old of made) if (old !== this && old.readyState === 1) old.drop();
      this.readyState = 1; this.onopen?.();
    }
    drop() { this.readyState = 3; this.onclose?.(); }
  }
  let answer = null, held = true;
  const get = () => held ? new Promise((r) => { answer = r; })
    : Promise.resolve({ ok: true, json: async () => ({ hands: true }) });
  const settle = () => new Promise((r) => setImmediate(r));
  line({ url: "https://x.test", secret: SECRET }, Socket, get);
  made[0].up();
  t.mock.timers.tick(60_000);                                  // the minute's question goes out,
  assert.ok(answer, "the house is asked");
  made[0].drop();                                              // the line closes while it waits,
  answer({ ok: true, json: async () => ({ hands: false }) });  // and the house says no
  await settle();
  t.mock.timers.tick(2_000);                                   // the close's own reopen
  made.at(-1).up();
  assert.equal(made.length, 2, "one new line");
  held = false;
  for (let i = 0; i < 20; i++) { t.mock.timers.tick(30_000); await settle(); }
  assert.equal(made.length, 2, "and ten quiet minutes later, still one");
});

// A SPEAKER THAT MOVES (2026-10-19): the router lent both WiiMs new addresses
// since September. The helper follows a speaker by its fixed id.
test("a moved speaker is found by its id, the remembered address asked first, then the nearest", async () => {
  const order = searchOrder("192.168.4.45", "192.168.4.52");
  assert.equal(order[0], "192.168.4.52", "where it was last seen");
  assert.deepEqual(order.slice(1, 3).sort(), ["192.168.4.44", "192.168.4.46"]);
  assert.equal(order.length, 253);
  assert.ok(!order.includes("192.168.4.45"));
  assert.deepEqual(searchOrder("not an address"), []);
  const wiims = { "192.168.4.46": { uuid: "ULTRA0000000000000000000", DeviceName: "Ultra" },
    "192.168.4.71": { uuid: "PROPLUS00000000000000000", DeviceName: "Pro Plus" } };
  const asked = [];
  const probe = async (ip) => { asked.push(ip); return wiims[ip] ?? null; };
  const known = { "Pro Plus": { uuid: "PROPLUS00000000000000000", deviceName: "Pro Plus", ip: "192.168.4.45" } };
  assert.equal(await findSpeaker("Pro Plus", "192.168.4.45", known, probe, 8), "192.168.4.71", "by its id, past the Ultra");
  assert.ok(asked.length < 253, "it stops once found");
  // No id learned yet: by the name the WiiM gives itself.
  assert.equal(await findSpeaker("Ultra", "192.168.4.69", {}, probe), "192.168.4.46");
  // Another WiiM with the same name but a different id is not this one.
  assert.equal(await findSpeaker("Pro Plus", "192.168.4.45",
    { "Pro Plus": { uuid: "SOMEONEELSE0000000000000" } }, probe), null);
});

// THE HELPER FOR OTHER HOUSES (MC-31 stage 5, 2026-10-19): a house set up on
// its page knows its WiiMs only by name. Its helper finds them on the home
// network and tells the house where they are; the owner's house names them
// in its file, as before.
test("the home network: the computer's own, or on a Chromebook's Linux the routers' usual ones", () => {
  assert.deepEqual(homeNets({ en0: [{ family: "IPv4", address: "192.168.7.20", internal: false }],
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }] }), ["192.168.7"]);
  assert.deepEqual(homeNets({ eth0: [{ family: "IPv4", address: "100.115.92.26", internal: false }] }), HOME_NETS);
  assert.ok(HOME_NETS.includes("192.168.4") && HOME_NETS.includes("10.0.0"));
});

test("finding WiiMs: every network the computer is on; guessed ones until the house's count is reached", async () => {
  const wiims = { "192.168.4.45": { uuid: "PROPLUS00000000000000000", DeviceName: "Pro Plus" },
    "192.168.4.69": { uuid: "ULTRA0000000000000000000", DeviceName: "Ultra" },
    "10.0.0.7": { uuid: "DEN000000000000000000000", DeviceName: "Den" },
    // The Pro Plus again, on its wired address: one WiiM.
    "10.0.0.8": { uuid: "PROPLUS00000000000000000", DeviceName: "Pro Plus" } };
  const probe = async (ip) => wiims[ip] ?? null;
  const nets = [];
  const all = await findWiims(["192.168.1", "192.168.4", "10.0.0"], probe, { onNet: (n) => nets.push(n) });
  assert.deepEqual(all.map((f) => `${f.name} ${f.ip}`), ["Pro Plus 192.168.4.45", "Ultra 192.168.4.69", "Den 10.0.0.7"]);
  assert.deepEqual(nets, ["192.168.1", "192.168.4", "10.0.0"], "not stopped at the first network with a WiiM (Codex)");
  // The computer's own networks: all of them. A Chromebook's guesses: until enough.
  const own = searchPlan(["Pro Plus"], { en0: [{ family: "IPv4", address: "192.168.4.20", internal: false }] });
  assert.deepEqual([own.nets, own.guessed, own.enough([{}, {}])], [["192.168.4"], false, false]);
  const guess = searchPlan(["Pro Plus", "Ultra", "Den"], { eth0: [{ family: "IPv4", address: "100.115.92.26", internal: false }] });
  assert.equal(guess.guessed, true);
  const asked = [];
  const three = await findWiims(["192.168.4", "10.0.0", "192.168.1"], probe, { enough: guess.enough, onNet: (n) => asked.push(n) });
  assert.deepEqual([three.length, asked], [3, ["192.168.4", "10.0.0"]], "on past a network with only two of the three");
  assert.equal(searchPlan([], {}).enough([{}]), true, "naming none, any is enough");
  assert.deepEqual(await findWiims(["192.168.1"], async () => null), []);
});

test("matching: the house's names to the WiiMs' own, any case; a house naming none takes all", () => {
  const found = [{ ip: "192.168.4.45", name: "pro plus" }, { ip: "192.168.4.69", name: "Ultra" }, { ip: "192.168.4.80", name: "Kitchen" }];
  assert.deepEqual(matchWiims(["Pro Plus", "Ultra", "Den"], found), {
    speakers: { "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" },
    unmatched: [{ ip: "192.168.4.80", name: "Kitchen" }], missing: ["Den"] });
  assert.deepEqual(matchWiims([], found).speakers, { "pro plus": "192.168.4.45", Ultra: "192.168.4.69", Kitchen: "192.168.4.80" });
});

test("the helper's WiiMs come from the house: named with addresses, found and told, or the owner's file", async () => {
  const cfg = { url: "https://house.test", secret: SECRET, fileSpeakers: {} };
  const answers = (get, post = null) => async (u, init = {}) => {
    if (init.method === "POST") return post ? Response.json(post(JSON.parse(init.body))) : new Response("no", { status: 500 });
    return typeof get === "number" ? new Response("not found", { status: get }) : Response.json(get);
  };
  const quiet = () => {};
  // The owner's house: its file's names and addresses, said by the house.
  assert.deepEqual(await houseSpeakers(cfg, { get: answers({ ok: true, speakers: { "Pro Plus": "192.168.4.45" }, names: ["Pro Plus"], learns: false }), log: quiet }),
    { "Pro Plus": "192.168.4.45" });
  // A house set up on its page: found here, told, and kept by the names it uses.
  let told = null;
  const got = await houseSpeakers(cfg, { log: quiet,
    get: answers({ ok: true, speakers: {}, names: ["Pro Plus"], learns: true }, (b) => { told = b; return { ok: true, speakers: { "Pro Plus": b.speakers["Pro Plus"] } }; }),
    find: async () => [{ ip: "192.168.4.45", uuid: "P", name: "PRO PLUS" }, { ip: "192.168.4.80", uuid: "K", name: "Kitchen" }] });
  assert.deepEqual(got, { "Pro Plus": "192.168.4.45" });
  assert.deepEqual(told, { speakers: { "Pro Plus": "192.168.4.45" } }, "only the WiiMs the house names are told");
  assert.equal(cfg.learns, true);
  // A house too old to answer: the owner's file, only when it is this house's.
  assert.deepEqual(await houseSpeakers({ ...cfg, fileSpeakers: { Ultra: "192.168.4.69" } }, { get: answers(404), log: quiet }), { Ultra: "192.168.4.69" });
  assert.equal(await houseSpeakers(cfg, { get: answers(404), log: quiet }), null, "never another house's file");
  // Nothing found: none yet.
  assert.equal(await houseSpeakers(cfg, { get: answers({ ok: true, speakers: {}, names: ["Den"], learns: true }), find: async () => [], log: quiet }), null);
});

test("the house's door: the owner's WiiMs from its file and never rewritten; a page-made house learns its helper's", async () => {
  const door = (e, init = {}, secret = SECRET) => worker.fetch(new Request("https://x.test/helper/speakers", {
    ...init, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" } }), e);
  // The owner's house.
  const owner = env();
  assert.equal((await door(owner, {}, "wrong-secret")).status, 404);
  const said = await (await door(owner)).json();
  assert.deepEqual(said, { ok: true, learns: false, names: ["Pro Plus", "Ultra"], speakers: { "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" } });
  assert.equal((await door(owner, { method: "POST", body: JSON.stringify({ speakers: { "Pro Plus": "10.0.0.9" } }) })).status, 409);
  // A house set up on its page: the WiiMs chosen at setup, by name only.
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = "setup-key-0123456789abcdef";
  e.HELPER_SECRET = SECRET;
  e.PROGRAM_LIBRARY_KEY = KEY;
  delete e.WIIM_SPEAKERS;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Kitchen Echo"]);
  e.WIIM_NAMES = JSON.stringify(["Pro Plus"]);
  await worker.fetch(new Request("https://x.test/setup/claim", { method: "POST", headers: { origin: "https://x.test" },
    body: new URLSearchParams({ key: e.SETUP_KEY }) }), e);
  assert.deepEqual(await (await door(e)).json(), { ok: true, learns: true, names: ["Pro Plus"], speakers: {} });
  const kept = await door(e, { method: "POST", body: JSON.stringify({ speakers: { "pro plus": "192.168.4.45", "Kitchen Echo": "192.168.4.9", Den: "nope" } }) });
  assert.deepEqual(await kept.json(), { ok: true, speakers: { "Pro Plus": "192.168.4.45" } }, "only a WiiM chosen at setup, by its name there");
  assert.deepEqual((await (await door(e)).json()).speakers, { "Pro Plus": "192.168.4.45" });
  // From then on the house takes its readings, as the owner's does.
  assert.equal((await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Spotify" }] })).status, 200);
  // And learns a new address after a move.
  await door(e, { method: "POST", body: JSON.stringify({ speakers: { "Pro Plus": "192.168.4.71" } }) });
  assert.deepEqual((await (await door(e)).json()).speakers, { "Pro Plus": "192.168.4.71" });
});
