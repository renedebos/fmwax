// THE TV PAGE (MC-46 stage 2, tv.js): the house on a big screen, worked with
// a TV's remote. What the band says of one room, the page and its tiles, the
// look the page takes, and the presses that come back to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import worker from "../worker.js";
import { renderTv, tvAnswer, tvBand, tvClock, tvFlashWords, tvNarrow, tvReadSig, tvSig, tvSong } from "../tv.js";
import { renderTvShelf, renderTvTune, tvRuntime } from "../tvpages.js";
import { makeEnv, installFetch, makeHouseStore } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const SECRET = "helper-secret-000000000000";
const GS = "GUESTSPOTIFY0000000001", GT = "0b1f2c3d-aaaa-bbbb-cccc-000000000002";
const P6 = "0000000000000000000006";
const PRO = { name: "Pro Plus", slug: "pro-plus", wiim: true, other: false };
const ECHO = { name: "Living Room", slug: "living-room", wiim: false, other: true };

function env() {
  const e = makeEnv();
  Object.assign(e, { PROGRAM_LIBRARY_KEY: KEY, HOUSE_TZ: "America/Los_Angeles", HELPER_SECRET: SECRET,
    ROOM_DEVICES: JSON.stringify(["Pro Plus", "Ultra", "Living Room"]),
    WIIM_SPEAKERS: JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" }),
    BUTTONS: JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: GS, catalog: "spotify" },
      { button: 2, guest: true, live: true, name: "Requests · Tidal", playlist: GT, catalog: "tidal" }]),
    ENDLESS: JSON.stringify({ mode: "live", dailyRuns: 20, presets: [{ button: 6, dj: "sessions", playlist: P6 }] }) });
  return e;
}
const call = (e, path, init) => worker.fetch(new Request(`https://x.test/buttons/${path}`, init), e, { waitUntil() {} });
const helper = (e, speakers) => worker.fetch(new Request("https://x.test/helper/reading", {
  method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ speakers }) }), e);
const reading = (e, slug = "pro-plus") => e.PROGRAMS.put(`reading:${slug}`, JSON.stringify({ at: new Date().toISOString(), by: "helper",
  presets: [{ btn: 1, name: "Requests · Spotify", source: "Spotify" }, { btn: 2, name: "Requests · Tidal", source: "TIDAL" },
    { btn: 6, name: "Sessions", source: "Spotify" }, { btn: 10, name: "KQED-FM", source: "newTuneIn" }] }));
const post = (e, path, fields) => call(e, path, { method: "POST", body: new URLSearchParams(fields) });

test("the band, for one room: Spotify playing here pauses and skips; elsewhere it is said and nothing is offered", () => {
  const o = { state: "playing", track: "Human Fly", artists: "The Cramps", album: "Gravest Hits", device: "Pro Plus", pausable: "Pro Plus",
    sleeve: "https://i.scdn.co/image/big", art: "https://i.scdn.co/image/small", pos: { ms: 60_000, of: 140_000, at: 1_000 },
    preset: { btn: 6, name: "Sessions", endless: true }, who: { name: "Sessions", kind: "house", btn: 6 },
    lan: { hands: true, speakers: { "Pro Plus": { state: "play", source: "Spotify", quality: { rate: 44100, bits: 16, kbps: 877 } }, Ultra: { state: "idle" } } } };
  const b = tvBand(o, PRO, 3_000);
  assert.equal(b.tone, "live");
  assert.equal(b.title, "Human Fly");
  assert.equal(b.line2, "The Cramps · Gravest Hits");
  assert.equal(b.line3, "Pro Plus · preset 6, Sessions · endless");
  assert.equal(b.art, "https://i.scdn.co/image/big", "the large sleeve");
  assert.deepEqual(b.pos, { ms: 60_000, of: 140_000, age: 2_000 }, "the song's place with its age, not the server's clock");
  assert.equal(b.quality, "Lossless · 16-bit / 44.1 kHz · 877 kbps");
  assert.deepEqual(b.ctl, { do: "pause", device: "Pro Plus", label: "Pause the Pro Plus" });
  assert.equal(b.skip, "Pro Plus");
  // The Ultra's screen, while Spotify plays on the Pro Plus.
  const u = tvBand(o, { name: "Ultra", slug: "ultra", wiim: true }, 3_000);
  assert.equal(u.tone, "off");
  assert.equal(u.title, "Nothing is playing on the Ultra", "the helper read it idle, so quiet is known");
  assert.equal(u.line2, "Spotify is playing on the Pro Plus.");
  assert.equal(u.ctl, null); assert.equal(u.skip, "");
  // An Echo: nobody reads it, so only Spotify's word.
  const q = tvBand({ state: "quiet", lan: o.lan }, ECHO);
  assert.equal(q.title, "Nothing on Spotify on the Living Room");
  assert.equal(q.line2, "Press a preset above to start it here.");
  // A program from the Shelf is named.
  assert.match(tvBand({ ...o, preset: null, from: "the Shelf", who: { name: "The Librarian", kind: "program", program: { title: "Stax, 1967", slug: "s" } } }, PRO).line3, / · “Stax, 1967”$/);
});

test("the band: Tidal or the radio as the helper read it, paused and played by the helper's hands; Spotify stopped is its key again", () => {
  const lan = (r, hands = true) => ({ ...(hands ? { hands: true } : {}), speakers: { "Pro Plus": r } });
  const tidal = tvBand({ state: "quiet", lan: lan({ state: "play", source: "Tidal", track: "Just Like Honey", artists: "The Jesus and Mary Chain", quality: { rate: 44100, bits: 16, kbps: 905 } }),
    lanBand: { state: "play", speaker: "Pro Plus", btn: 2, name: "Requests · Tidal" } }, PRO);
  assert.equal(tidal.tone, "live");
  assert.equal(tidal.title, "Just Like Honey");
  assert.equal(tidal.line3, "Pro Plus · preset 2, Requests · Tidal");
  assert.deepEqual(tidal.ctl, { do: "hpause", device: "Pro Plus", label: "Pause the Pro Plus" });
  // Skip and one back through the helper (2026-11-16, the owner: no Skip on Tidal).
  assert.equal(tidal.skip, "Pro Plus"); assert.equal(tidal.skipH, true);
  assert.match(tidal.quality, /^Lossless/);
  // Without the helper's hands it is read, not worked.
  assert.equal(tvBand({ state: "quiet", lan: lan({ state: "play", source: "Tidal", track: "x" }, false) }, PRO).ctl, null);
  const paused = tvBand({ state: "quiet", lan: lan({ state: "pause", source: "newTuneIn", station: "KQED-FM" }) }, PRO);
  assert.equal(paused.tone, "held");
  assert.equal(paused.ctl.do, "hplay");
  assert.match(paused.line3, /^Paused · Pro Plus · KQED-FM$/);
  // Spotify stopped on the speaker, Spotify itself saying nothing: the preset's key, pressed again.
  const rest = tvBand({ state: "quiet", lan: lan({ state: "stop", source: "Spotify", track: "Uptown Funk", preset: { btn: 6, name: "Sessions", endless: true } }) }, PRO);
  assert.equal(rest.tone, "held");
  assert.deepEqual(rest.ctl, { do: "hkey", device: "Pro Plus", btn: 6, label: "Play preset 6 on the Pro Plus" });
  assert.equal(rest.title, "Uptown Funk");
  // The house's own pause: play it again.
  const held = tvBand({ state: "quiet", paused: { device: "Pro Plus", track: "Human Fly", artists: "The Cramps", again: true, preset: { btn: 6, name: "Sessions", endless: true } } }, PRO);
  assert.equal(held.tone, "held");
  assert.deepEqual(held.ctl, { do: "again", device: "Pro Plus", label: "Play it again on the Pro Plus" });
  assert.equal(held.line3, "Paused · Pro Plus · preset 6, Sessions · endless");
  // A pause on another room is not this room's.
  assert.equal(tvNarrow({ state: "quiet", paused: { device: "Ultra", again: true } }, "Pro Plus").paused, undefined);
  // Spotify's limit, sign-out, an unread player: the bar's own words.
  assert.equal(tvBand({ state: "throttled", mins: 12 }, PRO).title, "Not known for about 12 minutes");
  assert.equal(tvBand({ state: "signedout" }, PRO).title, "Spotify signed the house out");
  assert.equal(tvBand({ state: "unknown" }, PRO).tone, "off");
});

test("one look: the tile that plays in this room, the rooms with music, and what the tiles were drawn from", () => {
  const o = { state: "playing", track: "t", device: "Pro Plus", pausable: "Pro Plus", preset: { btn: 6, name: "Sessions" },
    speakers: [{ name: "Pro Plus", slug: "pro-plus" }, { name: "Ultra", slug: "ultra" }],
    lan: { hands: true, speakers: { Ultra: { state: "play", source: "Tidal" } } } };
  const a = tvAnswer(o, PRO, { readAt: 1234 });
  assert.equal(a.lit, 6);
  assert.deepEqual(a.rooms, { "pro-plus": 1, ultra: 1 });
  assert.equal(a.sig, "1234.1"); assert.equal(a.rest, false);
  // Spotify on a WiiM the helper reads: a look costs Spotify nothing. Not so
  // on an Echo, with the helper off, or while nothing plays.
  assert.equal(a.cheap, true);
  assert.equal(tvAnswer({ ...o, device: "Living Room" }, PRO).cheap, false);
  assert.equal(tvAnswer({ ...o, lan: undefined }, PRO).cheap, false);
  assert.equal(tvAnswer({ state: "quiet", speakers: o.speakers, lan: o.lan }, PRO).cheap, false);
  assert.equal(tvAnswer(o, { name: "Ultra", slug: "ultra", wiim: true }).lit, null, "a key lights only in its own room");
  assert.equal(tvSig(1234, false), "1234.0", "the helper's hands gone is a different page");
  assert.equal(tvAnswer({ state: "throttled", mins: 5 }, PRO).rest, true, "Spotify's limit and no helper: the page looks rarely");
  assert.equal(tvAnswer({ state: "throttled", mins: 5, lan: { hands: true, speakers: {} } }, PRO).rest, false);
  assert.equal(tvFlashWords({ flash: { code: "ok", name: "Hank", on: "Pro Plus" } }), "", "a press that worked says nothing");
  assert.match(tvFlashWords({ flash: { code: "asleep", name: "Hank", on: "Pro Plus" } }), /not in Spotify's list/);
  assert.match(tvFlashWords({ hflash: { code: "helper-off", btn: 2, on: "Pro Plus" } }), /home helper is not connected/);
});

test("the page: rooms, twelve tiles and the band; every control a button or a link, nothing to type in", async () => {
  const e = env();
  const f = installFetch();
  try {
    await helper(e, [{ name: "Pro Plus", state: "idle" }, { name: "Ultra", state: "idle" }]);
    await reading(e);
    await e.PROGRAMS.put(`on:${GS}`, JSON.stringify({ dj: "sessions", ref: "x", at: new Date().toISOString() }));
    e.STATION.endless.hands = async () => ({ ok: true });
    const r = await call(e, `${KEY}/tv`);
    assert.equal(r.status, 200);
    const nonce = (r.headers.get("content-security-policy") ?? "").match(/script-src 'nonce-([a-f0-9]+)'/)?.[1];
    const html = await r.text();
    assert.ok(nonce && html.includes(`<script nonce="${nonce}">`), "the house's own header lets its one script run");
    assert.match(html, /<main class="tv" data-build="[0-9a-z]+" data-base="\/buttons\/abcdefabcdefabcdefabcdef" data-room="pro-plus" data-sig="[0-9a-z]+\.1" data-band=/);
    // One button with the room shown (the owner, 2026-11-16: less busy); it opens every room as a tile.
    assert.match(html, /<button type="button" class="room pick" data-f="rooms" data-open="rooms" data-room="pro-plus" aria-label="Pro Plus: choose another room"><svg[^>]*>[\s\S]*?<\/svg>Pro Plus<svg class="chev"/);
    assert.ok(!html.includes("More rooms") && !html.includes('data-f="room:'), "no chip a room");
    const vr = html.slice(html.indexOf('<div class="view vrooms"'), html.indexOf('<div class="view vabout"'));
    assert.deepEqual([...vr.matchAll(/<a class="mroom rroom( here)?" data-f="r:([a-z-]+)" data-room="[a-z-]+" href="\/buttons\/[a-f]+\/tv\?room=([a-z-]+)">/g)].map((m) => `${m[2]}${m[1] ? "*" : ""}`),
      ["pro-plus*", "ultra", "living-room"], "every room, the one shown marked");
    assert.ok(vr.includes('<span class="mst">Showing</span>'));
    assert.ok(!html.includes('class="room app"'), "no App link (MC-48, the owner 2026-11-19)");
    // Twelve places. With the helper's hands every saved key is its press, Tidal and the radio too.
    assert.equal((html.match(/ data-k="\d+"/g) ?? []).length, 12);
    for (const n of [1, 2, 6, 10]) {
      assert.match(html, new RegExp(`<form method="post" action="/buttons/${KEY}/wiim/key"><input type="hidden" name="btn" value="${n}"><input type="hidden" name="device" value="Pro Plus"><input type="hidden" name="back" value="tv"><button type="submit" class="tile" data-k="${n}" data-f="k:${n}" data-busy="Pressing…"`));
    }
    assert.match(html, /data-k="1"[^>]*aria-label="Press 1, Sessions, on the Pro Plus">[\s\S]*?<span class="tname">Sessions<\/span><span class="tsub" data-sub="Spotify">/, "named for whose set is on the requests preset (2026-11-18)");
    assert.match(html, /<span class="tname">Requests<\/span><span class="tsub" data-sub="Tidal"><span>Tidal</);
    assert.match(html, /<span class="tname">Sessions<\/span><span class="tsub" data-sub="Endless"><span>Endless</);
    assert.match(html, /<span class="tname">KQED-FM<\/span><span class="tsub" data-sub="TuneIn"><span>TuneIn</);
    assert.match(html, /<div class="tile dim" data-k="3"><span class="ttop"><span class="tnum">3<\/span><\/span><span class="tbody"><span class="tsub">Nothing saved<\/span>/);
    // Quiet: said, and no control offered.
    assert.match(html, /<section class="band" aria-label="Now playing" data-tone="off">[\s\S]*?<p class="b1 slide"><span>Nothing is playing on the Pro Plus<\/span><\/p>/);
    assert.match(html, /<div class="bctl" hidden>/);
    // The remote cannot leave a text box (measured on the TV): there is none.
    assert.ok(!/<(textarea|select)\b/.test(html) && !/<input(?![^>]*type="hidden")/.test(html), "nothing to type in or open");
    assert.ok(!html.includes("getUserMedia"), "and no Talk");
    const script = html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1];
    assert.ok(!script.includes("`"), "no template strings in the page's script");
    assert.doesNotThrow(() => new vm.Script(script), "and it parses");
    // No function's name taken again for a variable (2026-11-15 "rest" broke Move;
    // 2026-11-16 a "var open" stood beside open()).
    for (const [, name] of script.matchAll(/function ([A-Za-z_$][\w$]*)\s*\(/g)) {
      assert.ok(!new RegExp(`\\bvar\\s+${name}\\b`).test(script), `"${name}" is a function and a variable`);
    }
    // About this song opens for a song only Genius knows (the owner, 2026-11-16).
    assert.ok(script.includes('if (v === "about") { if (!(song.about || song.facts || song.genius)) return; fillAbout();'));
    // Without the helper's hands: Spotify keys start through Spotify, the rest are the remote's.
    delete e.STATION.endless.hands;
    const off = await (await call(e, `${KEY}/tv`)).text();
    assert.match(off, /data-sig="[0-9a-z]+\.0"/);
    assert.ok(!off.includes("/wiim/key"));
    assert.match(off, new RegExp(`<form method="post" action="/buttons/${KEY}/preset/play"><input type="hidden" name="btn" value="6"><input type="hidden" name="device" value="Pro Plus"><input type="hidden" name="back" value="tv"><button type="submit" class="tile" data-k="6" data-f="k:6" data-busy="Starting…" aria-label="Play Sessions on the Pro Plus">`));
    assert.match(off, /<div class="tile dim" data-k="2">[\s\S]*?<span class="tsub" data-sub="On the remote"><span>On the remote</);
    assert.match(off, /<div class="tile dim" data-k="10">/);
    // The key, and GET only.
    assert.equal((await call(e, "wrongkey123456/tv")).status, 404);
    assert.equal((await call(e, `${KEY}/tv`, { method: "POST", body: "x" })).status, 405);
  } finally { f.restore(); }
});

test("a room is chosen by its chip and kept; an Echo shows the house's own Spotify presets; a room never read says so", async () => {
  const e = env();
  const f = installFetch();
  try {
    await reading(e);
    const r = await call(e, `${KEY}/tv?room=ultra`);
    assert.match(r.headers.get("set-cookie") ?? "", /^spk=ultra\.\d+;/, "a choice, as every page keeps one");
    const ultra = await r.text();
    assert.match(ultra, /data-room="ultra"/);
    assert.match(ultra, /<p class="gnote">The Ultra's presets have not been read yet\./);
    assert.doesNotMatch((await call(e, `${KEY}/tv`)).headers.get("set-cookie") ?? "", /spk=/, "no chip, no choice written");
    // The cookie brings the room back.
    assert.match(await (await call(e, `${KEY}/tv`, { headers: { cookie: `spk=ultra.${Math.floor(Date.now() / 1000)}` } })).text(), /<main class="tv"[^>]* data-room="ultra"/);
    const echo = await (await call(e, `${KEY}/tv?room=living-room`)).text();
    assert.match(echo, /<section class="grid" aria-label="The house&#39;s Spotify presets, on the Living Room">/);
    assert.match(echo, new RegExp(`action="/buttons/${KEY}/preset/play"><input type="hidden" name="btn" value="1"><input type="hidden" name="device" value="Living Room"><input type="hidden" name="back" value="tv">`));
    assert.match(echo, /data-k="6"[\s\S]*?<span class="tname">Sessions<\/span><span class="tsub" data-sub="Endless">/);
    assert.ok(!/data-k="2"/.test(echo), "the Tidal requests preset is not Spotify's to start");
    assert.match(echo, /<p class="gnote side" style="grid-column:span 4">Tidal, the radio and other services are keys on a WiiM\.<\/p>/);
    assert.ok(echo.includes('data-room="living-room"'), "the room shown has its chip");
    // Every room is in the rooms view, whatever the address asks.
    const all = await (await call(e, `${KEY}/tv?rooms=all`)).text();
    assert.ok(all.includes('data-f="r:living-room"') && !all.includes("More rooms"));
    // A made-up room is not one.
    assert.match(await (await call(e, `${KEY}/tv?room=cellar`)).text(), /data-room="pro-plus"/);
  } finally { f.restore(); }
});

test("the look: /tv/now says one room's band; a made-up room is refused", async () => {
  const e = env();
  const f = installFetch();
  try {
    await helper(e, [{ name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey", artists: "The Jesus and Mary Chain" }, { name: "Ultra", state: "idle" }]);
    await reading(e);
    e.STATION.endless.hands = async () => ({ ok: true });
    const r = await call(e, `${KEY}/tv/now?room=pro-plus`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^application\/json/);
    const a = await r.json();
    assert.equal(a.band.title, "Just Like Honey");
    assert.equal(a.band.ctl.do, "hpause");
    assert.deepEqual(a.rooms, { "pro-plus": 1 });
    assert.match(a.sig, /^[0-9a-z]+\.1$/, "what the tiles show, not when they were read");
    // The page's own first paint carries the same band and the same signature.
    const html = await (await call(e, `${KEY}/tv`)).text();
    assert.ok(html.includes(`data-sig="${a.sig}"`), `so the first look does not ask for the page again: ${a.sig} vs ${html.match(/data-sig="([^"]*)"/)?.[1]}`);
    assert.match(html, /<p class="b1 slide"><span>Just Like Honey<\/span><\/p>/);
    assert.equal((await call(e, `${KEY}/tv/now?room=living-room`)).status, 200);
    assert.equal((await call(e, `${KEY}/tv/now?room=cellar`)).status, 400);
    assert.equal((await call(e, `${KEY}/tv/now`)).status, 400);
    assert.equal((await call(e, "wrongkey123456/tv/now?room=pro-plus")).status, 404);
    // The app's own look is as it was.
    assert.equal((await (await call(e, `${KEY}/playing`)).json()).state, "quiet");
  } finally { f.restore(); }
});

test("a tile's press comes back to the TV page, on the tile, with its words when it did not land", async () => {
  const e = env();
  const f = installFetch();
  try {
    await helper(e, [{ name: "Pro Plus", state: "idle" }]);
    await reading(e);
    // The helper's press.
    const asked = [];
    e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, reading: { name: "Pro Plus", state: "play", source: "Tidal", track: "Just Like Honey" } }; };
    const hk = await post(e, `${KEY}/wiim/key`, { btn: "2", device: "Pro Plus", back: "tv" });
    assert.equal(hk.status, 303);
    assert.equal(hk.headers.get("location"), `/buttons/${KEY}/tv?hk=ok&k=2&kon=pro-plus`);
    assert.deepEqual(asked, [{ cmd: "key", n: 2, speaker: "Pro Plus" }]);
    const after = await (await call(e, hk.headers.get("location").replace("/buttons/", ""))).text();
    assert.match(after, /<p class="b1 slide"><span>Just Like Honey<\/span><\/p>/, "the band says what the key started");
    assert.match(after, /<p class="bsay" role="status" hidden><\/p>/, "and a press that worked says nothing");
    // With the helper gone, the words.
    delete e.STATION.endless.hands;
    const off = await post(e, `${KEY}/wiim/key`, { btn: "2", device: "Ultra", back: "tv" });
    assert.equal(off.headers.get("location"), `/buttons/${KEY}/tv?hk=helper-off&k=2&kon=ultra`);
    const offPage = await (await call(e, off.headers.get("location").replace("/buttons/", ""))).text();
    assert.match(offPage, /<main class="tv"[^>]* data-room="ultra"/, "back in the room the press named");
    assert.match(offPage, /<p class="bsay" role="status">The home helper is not connected, so 2 could not be pressed from here\./);
    // The Spotify start, with no helper.
    const kp = await post(e, `${KEY}/preset/play`, { btn: "6", device: "Pro Plus", back: "tv" });
    assert.equal(kp.status, 303);
    assert.match(kp.headers.get("location"), new RegExp(`^/buttons/${KEY}/tv\\?kp=[a-z]+&k=6&kon=pro-plus$`));
    // The Speakers page's own presses go back to the Speakers page, as before.
    assert.match((await post(e, `${KEY}/preset/play`, { btn: "6", device: "Pro Plus" })).headers.get("location"), new RegExp(`^/buttons/${KEY}/wiim\\?kp=`));
  } finally { f.restore(); }
});

test("an Echo's tile starts the house's own preset there, from the TV page only", async () => {
  const e = env();
  const f = installFetch();
  try {
    await reading(e);
    const r = await post(e, `${KEY}/preset/play`, { btn: "6", device: "Living Room", back: "tv" });
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), new RegExp(`^/buttons/${KEY}/tv\\?kp=[a-z]+&k=6&kon=living-room$`));
    // The stand-in Spotify lists only the Pro Plus, so the start gets as far as
    // looking for the Living Room there: past every gate of the route.
    assert.ok(f.calls.includes("GET /me/player/devices"), "the start was tried on Spotify");
    // Its way back is read: the room, and words for a start that did not land.
    const back = await (await call(e, `${KEY}/tv?kp=asleep&k=6&kon=living-room`)).text();
    assert.match(back, /<main class="tv"[^>]* data-room="living-room"/);
    assert.match(back, /<p class="bsay" role="status">The Living Room is not in Spotify&#39;s list right now/);
    // The Tidal requests preset has no Spotify playlist: refused in words, on
    // the TV page (the review, 2026-11-16: never a page the remote can't leave).
    const tidal = await post(e, `${KEY}/preset/play`, { btn: "2", device: "Living Room", back: "tv" });
    assert.equal(tidal.status, 303);
    const tid = tidal.headers.get("location").match(new RegExp(`^/buttons/${KEY}/tv\\?room=living-room&k=2&vx=([a-f0-9]{16})$`))?.[1];
    assert.ok(tid, tidal.headers.get("location"));
    assert.match(JSON.parse(await e.PROGRAMS.get(`tvsaid:${tid}`)).said, /no Spotify playlist on preset 2/);
    // From any other page a preset key still belongs to a WiiM.
    assert.equal((await post(e, `${KEY}/preset/play`, { btn: "6", device: "Living Room" })).status, 400);
    // And a room the house never named is nobody's: refused, nothing played.
    const cellar = await post(e, `${KEY}/preset/play`, { btn: "6", device: "Cellar", back: "tv" });
    assert.equal(cellar.status, 303);
    assert.match(JSON.parse(await e.PROGRAMS.get(`tvsaid:${cellar.headers.get("location").match(/vx=([a-f0-9]{16})/)[1]}`)).said, /not one of/);
  } finally { f.restore(); }
});

test("the Speakers tab's footer opens the TV page; the stage 0 check page is gone", async () => {
  const e = env();
  const f = installFetch();
  try {
    const html = await (await call(e, `${KEY}/wiim`)).text();
    assert.ok(html.includes(`<a class="chip" href="/buttons/${KEY}/tv">TV</a>`));
    assert.ok(!html.includes("tvcheck"));
    assert.equal((await call(e, `${KEY}/tvcheck`)).status, 404);
  } finally { f.restore(); }
});

test("a house that reads no speaker: its own presets as the tiles, on its own speaker", async () => {
  const e = makeEnv();
  Object.assign(e, { PROGRAM_LIBRARY_KEY: KEY, HOUSE_TZ: "America/Los_Angeles", ROOM_DEVICES: JSON.stringify(["Pro Plus"]),
    BUTTONS: JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: GS, catalog: "spotify" }]) });
  const f = installFetch();
  try {
    const html = renderTv({ base: `/buttons/${KEY}`, rooms: [{ name: "Pro Plus", slug: "pro-plus", wiim: true }], room: { name: "Pro Plus", slug: "pro-plus", wiim: true },
      now: { state: "quiet" }, ownKeys: [{ btn: 1, name: "Hank", sub: "Requests" }] });
    assert.match(html, /action="\/buttons\/abcdefabcdefabcdefabcdef\/preset\/play"><input type="hidden" name="btn" value="1">/);
    assert.ok(!html.includes("gnote side"), "its speaker may be a WiiM: no line about other services");
    const page = await call(e, `${KEY}/tv`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<main class="tv"[^>]* data-room="pro-plus"/);
  } finally { f.restore(); }
});

// THE NEXT SCREENS (2026-11-15, the owner's choices on the canvas): the
// display with the cover leading, Move, About this song, the Shelf and a DJ's
// dials as sliders; the button in hand filled amber; the tile's corner blank.
test("the band's new buttons: Move while Spotify plays here, Tune for a DJ who can be steered, and what to ask about the song", () => {
  const o = { state: "playing", track: "I Can't Stand the Rain", artists: "Ann Peebles", album: "I Can't Stand the Rain", device: "Pro Plus", pausable: "Pro Plus",
    uri: "spotify:track:0000000000000000000001", preset: { btn: 8, name: "Soul", endless: true }, who: { dj: "soul", name: "Soul", kind: "house", btn: 8, endless: true } };
  const b = tvBand(o, PRO, 0, { canTune: true });
  assert.equal(b.move, "Pro Plus");
  assert.deepEqual(b.tune, { dj: "soul", name: "Soul" });
  assert.equal(b.artist, "Ann Peebles"); assert.equal(b.album, "I Can't Stand the Rain");
  assert.deepEqual(b.song, { uri: "spotify:track:0000000000000000000001", slug: "", btn: 8, isrc: "", ms: 0 }, "an endless set: its preset, for what comes next");
  assert.equal(tvBand(o, PRO, 0).tune, null, "no dials where the house keeps no settings");
  // A program from the Shelf: its page, for the DJ's words; nobody to tune.
  const s = tvBand({ ...o, preset: null, who: { dj: "the-librarian", name: "The Librarian", kind: "program", program: { slug: "cramps", title: "The Cramps on Record" } } }, PRO, 0, { canTune: true });
  assert.equal(s.tune, null);
  assert.deepEqual(s.song, { uri: "spotify:track:0000000000000000000001", slug: "cramps", btn: 0, isrc: "", ms: 0 });
  // The bar's own words for a Shelf play already name the program: said once (seen twice on the Bravia).
  const once = tvBand({ ...o, preset: null, from: "The Librarian · “The Cramps on Record”", who: { dj: "the-librarian", name: "The Librarian", kind: "program", program: { slug: "cramps", title: "The Cramps on Record" } } }, PRO, 0);
  assert.equal(once.line3.split("The Cramps on Record").length - 1, 1, once.line3);
  // Tidal by the helper: nothing moves, nothing is tuned.
  const t = tvBand({ state: "quiet", lan: { hands: true, speakers: { "Pro Plus": { state: "play", source: "TIDAL", track: "So What", artists: "Miles Davis" } } } }, PRO, 0, { canTune: true });
  assert.equal(t.move, ""); assert.equal(t.tune, null); assert.equal(t.artist, "Miles Davis");
  // About this song by its title and artist; a radio station has no song.
  assert.equal(t.song.uri, "lan:So What");
  // With the helper's parts of a Tidal song: its cover, album, place, and a track id.
  const tt = tvBand({ state: "quiet", lan: { hands: true, at: 1000, speakers: { "Pro Plus": { state: "play", source: "Tidal", track: "I Touch Myself", artists: "Lime Cordiale",
    album: "I Touch Myself (triple j Like A Version)", art: "https://resources.tidal.com/images/a/b.jpg", pos: { ms: 146904, of: 215308 }, trackId: "195651662" } } } }, PRO, 3000);
  assert.equal(tt.art, "https://resources.tidal.com/images/a/b.jpg");
  assert.equal(tt.line2, "Lime Cordiale · I Touch Myself (triple j Like A Version)");
  assert.deepEqual(tt.pos, { ms: 146904, of: 215308, age: 2000 });
  assert.equal(tt.song.uri, "tidal:track:195651662");
  const radio = tvBand({ state: "quiet", lan: { hands: true, speakers: { "Pro Plus": { state: "play", source: "newTuneIn", station: "KQED-FM", track: "News" } } } }, PRO, 0);
  assert.equal(radio.song, null); assert.equal(radio.skip, "");
});

test("the house's clock, what comes next and the DJ's words, and what the Shelf and the dials came to", () => {
  // 2026-11-15 20:42:05 in San Francisco.
  assert.equal(tvClock("America/Los_Angeles", Date.UTC(2026, 10, 16, 4, 42, 5)), 20 * 3600 + 42 * 60 + 5);
  assert.equal(tvClock(null), null); assert.equal(tvClock("Not/AZone"), null);
  const U = (n) => `spotify:track:${String(n).padStart(22, "0")}`;
  const rec = { title: "The Cramps on Record", sections: [
    { label: "Memphis, October 1977", heading: "Sun's own room", prose: ["They drove south.", "Then the landmark. ‘Human Fly’ is a Lux and Ivy original."],
      tracks: [{ uri: U(1), title: "The Way I Walk", artist: "The Cramps" }, { uri: U(2), title: "Human Fly", artist: "The Cramps" }] },
    { label: "Ohio", prose: ["Later."], tracks: [{ uri: U(3), title: "Surfin' Bird", artist: "The Cramps" }, { uri: U(4), title: "Garbageman", artist: "The Cramps" },
      { uri: U(5), title: "TV Set", artist: "The Cramps" }, { uri: U(6), title: "Drug Train", artist: "The Cramps" }] }] };
  const a = tvSong({ uri: U(2), title: "Human Fly - 2001 Remaster", rec, dj: "The Librarian" });
  assert.deepEqual(a.next, [{ t: "Surfin' Bird", a: "The Cramps" }, { t: "Garbageman", a: "The Cramps" }, { t: "TV Set", a: "The Cramps" }], "the next three, across the page's stops");
  assert.deepEqual(a.about, { label: "Memphis, October 1977", years: null, heading: "Sun's own room", text: "Then the landmark. ‘Human Fly’ is a Lux and Ivy original.", dj: "The Librarian" });
  // An endless set: the session's own list, "Artist — Title".
  const e = tvSong({ uri: U(1), session: { tracks: [[U(1), 1, "Ann Peebles — I Can't Stand the Rain"], [U(2), 1, "Al Green — Tired of Being Alone"], [U(3), 1, "Otis Clay — Trying to Live My Life Without You"]] } });
  assert.deepEqual(e.next, [{ t: "Tired of Being Alone", a: "Al Green" }, { t: "Trying to Live My Life Without You", a: "Otis Clay" }]);
  assert.equal(e.about, null);
  assert.deepEqual(tvSong({ uri: U(9), rec }), { next: [], about: null }, "a song the page does not hold: nothing claimed");
  assert.equal(tvFlashWords({ shelf: { code: "ok", on: "Pro Plus" } }), "");
  assert.match(tvFlashWords({ shelf: { code: "asleep", on: "Ultra" } }), /^The Ultra is not in Spotify's list right now/);
  assert.equal(tvFlashWords({ tune: "applied" }), "Tuned. The new songs come in after this one, in a few minutes.");
  assert.equal(tvFlashWords({ tune: "saved-failed" }), "Tuned and kept, but the turn did not reach the DJ.");
  assert.equal(tvRuntime("1:09:12"), "1 h 09"); assert.equal(tvRuntime("56:40"), "57 min"); assert.equal(tvRuntime(null), "");
});

test("the page's other views: the display, Move and About this song are drawn in it; the corner is blank and the button in hand is filled", async () => {
  const e = env();
  const f = installFetch();
  try {
    await helper(e, [{ name: "Pro Plus", state: "idle" }, { name: "Ultra", state: "idle" }]);
    await reading(e);
    const html = await (await call(e, `${KEY}/tv`)).text();
    assert.match(html, / data-view="ctl" data-tone="off" data-room-name="Pro Plus" data-clock="\d+">/);
    assert.ok(html.includes('<a class="wm" data-f="fmwax" href="/buttons/${KEY}/tv/about?room=pro-plus" aria-label="About fmwax">fmwax</a>') || /<a class="wm" data-f="fmwax" href="[^"]*\/tv\/about[^"]*" aria-label="About fmwax">fmwax<\/a>/.test(html), "the word, once, and it opens About fmwax");
    assert.ok(!html.includes("tmark") && !/class="ttop"><span class="tnum">1<\/span><svg/.test(html), "no initials and no glyph in a tile's corner");
    assert.ok(html.includes('<span class="ttop"><span class="tnum">1</span><span class="tplay">'), "only Playing may show there");
    assert.match(html, /a:focus,button:focus\{outline:0;background:var\(--focus\)!important;/, "filled amber, not a ring");
    // Quiet: Now Playing waits, the cover opens nothing; the Shelf is a link.
    assert.match(html, /<button type="button" class="room now" data-f="now" data-open="dis" aria-label="Now playing" hidden><svg class="notei"/, "Now Playing is a note (2026-11-16)");
    assert.ok(html.includes(`<a class="room djs" data-f="djs" href="/buttons/${KEY}/tv/djs?room=pro-plus">DJs</a>`));
    assert.ok(html.includes(`<a class="room shelf" data-f="shelf" href="/buttons/${KEY}/tv/shelf?room=pro-plus">Shelf</a>`));
    assert.match(html, /<button type="button" class="sleeve" data-f="sleeve" data-open="dis"[^>]* disabled>/);
    assert.match(html, /<div class="bicons" hidden><button type="button" class="iconbtn bmove" data-f="move" data-open="move" aria-label="Move the music" hidden>/, "Move is a round icon beside About and Tune");
    // The display keeps back, the round button and Skip, and Presets goes back.
    const dis = html.slice(html.indexOf('<div class="view vdis"'), html.indexOf('<div class="view vmove"'));
    for (const t of ["prev", "main", "skip"]) assert.ok(dis.includes(`data-t="${t}"`), t);
    assert.ok(dis.includes('data-open="ctl">Home</button>') && dis.includes('<button type="button" class="iconbtn dabout" data-f="d-about" data-open="about" aria-label="About this song" hidden><svg') && dis.includes('<a class="iconbtn dtune" data-f="d-tune" href="#" aria-label="Tune the DJ" hidden><svg') && dis.includes('<p class="dnl">Up next</p>') && dis.includes('<span class="dclock" hidden>'));
    // Move: every room of the house as a tile.
    const mv = html.slice(html.indexOf('<div class="view vmove"'), html.indexOf('<div class="view vabout"'));
    assert.deepEqual([...mv.matchAll(/class="mroom" data-name="([^"]+)" data-slug="([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`), ["Pro Plus=pro-plus", "Ultra=ultra", "Living Room=living-room"]);
    assert.ok(html.includes('data-open="back">') && html.includes('<h1>About this song</h1>'));
    // After the owner's first evening with it (2026-11-15): a WiiM is marked by WiiM's own mark (the owner's choice), a phone is told apart for its words;
    // a line too long for its place slides; About this song has buttons that turn its page; the song first.
    assert.match(mv, /data-slug="pro-plus" data-kind="wiim"><span>Pro Plus<\/span><small><svg class="wlogo" role="img" aria-label="WiiM" viewBox="0 0 148 49"><use href="#wiim-mark"><\/use><\/svg><span class="mst"><\/span><\/small>/);
    assert.match(mv, /data-slug="living-room" data-kind="other"><span>Living Room<\/span><small><span class="mst"><\/span><\/small>/);
    assert.equal((html.match(/<symbol id="wiim-mark"/g) ?? []).length, 1, "WiiM's mark, drawn once and used on each WiiM's tile");
    assert.ok(html.includes('<p class="dfrom slide"><span></span></p>') && html.includes('<p class="dn slide"><span><b></b><i></i></span></p>'));
    assert.ok(html.includes('<a class="pill anotes" data-f="a-notes" href="#" hidden>Program notes</a><button type="button" class="pill awbtn" data-f="a-wiki" data-more hidden>More from Wikipedia</button><button type="button" class="pill apage" data-page="-1">Page up</button><button type="button" class="pill apage" data-page="1">Page down</button>'),
      "the page buttons are always there (they go dim at the ends), and the program's notes are one press away");
    const script = html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1];
    assert.ok(script.includes("cheap ? CHEAP") && script.includes("CHEAP = 10000"), "a look every ten seconds while it costs Spotify nothing");
    assert.ok(script.includes("var steering = ") && script.includes("GAP = 45000"), "starts on the song, and stays through a gap");
    assert.ok(!/function (rest|cheap|band|room|sig|view|song|clock|busy|hold|tick|timer)\(/.test(script), "no function named as one of the script's own variables");
    assert.ok(!html.includes("claude.ai") && !html.includes("chatgpt.com"), "no Ask link on a TV");
  } finally { f.restore(); }
});

test("once a song: /tv/song answers from the Shelf page or the endless list, and never for a wrong key", async () => {
  const e = env();
  const f = installFetch();
  try {
    const U = (n) => `spotify:track:${String(n).padStart(22, "0")}`;
    await e.PROGRAMS.put("program:cramps", JSON.stringify({ slug: "cramps", title: "The Cramps on Record", dj: "The Librarian", sections: [
      { label: "Memphis", prose: ["‘Human Fly’ is theirs."], tracks: [{ uri: U(1), title: "Human Fly", artist: "The Cramps" }, { uri: U(2), title: "Surfin' Bird", artist: "The Cramps" }] }] }));
    const r = await call(e, `${KEY}/tv/song?uri=${encodeURIComponent(U(1))}&slug=cramps&t=Human%20Fly`);
    assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /^application\/json/);
    const a = await r.json();
    assert.deepEqual(a.next, [{ t: "Surfin' Bird", a: "The Cramps" }]);
    assert.equal(a.about.text, "‘Human Fly’ is theirs."); assert.equal(a.about.dj, "The Librarian");
    assert.deepEqual(await (await call(e, `${KEY}/tv/song?uri=${encodeURIComponent(U(1))}&slug=nothing-here`)).json(), { next: [], about: null, facts: null, genius: null, extra: null });
    assert.deepEqual(await (await call(e, `${KEY}/tv/song?uri=x`)).json(), { next: [], about: null, facts: null, genius: null, extra: null });
    assert.equal((await call(e, `wrongkey123456/tv/song?uri=x`)).status, 404);
    assert.equal((await call(e, `${KEY}/tv/song`, { method: "POST", body: "x" })).status, 405);
  } finally { f.restore(); }
});

test("the Shelf on the TV: a press opens the program, Play is on its page and comes back to it; a Tidal program plays through the helper on a WiiM", async () => {
  const e = env();
  const f = installFetch();
  try {
    const put = (slug, rec, meta) => e.PROGRAMS.put(`program:${slug}`, JSON.stringify({ slug, ...rec }), { metadata: { tracks: 2, ...meta } });
    const A = "spotify:track:" + "a".repeat(22);
    await put("cramps", { title: "The Cramps on Record", dj: "The Librarian", sections: [{ label: "1977", heading: "Ohio", prose: ["The first one."], tracks: [{ uri: A, title: "Human Fly", artist: "The Cramps" }] }] },
      { title: "The Cramps on Record", dj: "The Librarian", catalog: "spotify", created: "2026-11-02T10:00:00Z", runtime: "1:09:12", image: "https://i.scdn.co/image/c1" });
    await put("rooms", { title: "Big Choruses, Smaller Rooms", dj: "Sessions", sections: [{ tracks: [{ uri: "tidal:track:1", title: "One" }] }] },
      { title: "Big Choruses, Smaller Rooms", dj: "Sessions", catalog: "tidal", created: "2026-11-01T10:00:00Z", runtime: "40:00" });
    const r = await call(e, `${KEY}/tv/shelf?room=ultra`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes(`<a class="pill" data-f="back" href="/buttons/${KEY}/tv?room=ultra">`), "back to the room it came from");
    assert.match(html, /2 programs, newest first · a press opens one/);
    assert.ok(html.includes(`<a class="prog" href="/buttons/${KEY}/tv/notes/cramps?room=ultra&amp;from=shelf" data-f="p:cramps"><span class="pcover"><img src="https://i.scdn.co/image/c1" alt="" decoding="async"></span>`), "a press opens it");
    assert.ok(html.includes('<span class="ps">The Librarian · 1 h 09</span>'));
    assert.match(html, /data-f="p:rooms"><span class="pcover"><\/span><span class="pt">Big Choruses, Smaller Rooms<\/span><span class="ps">Tidal · from the phone<\/span>/);
    assert.ok(!html.includes("/play"), "nothing on the Shelf starts music");
    assert.ok(html.indexOf("cramps") < html.indexOf("Big Choruses"), "newest first");
    assert.ok(!/<(textarea|select)\b/.test(html) && !/<input(?![^>]*type="hidden")/.test(html), "nothing to type in");
    assert.doesNotThrow(() => new vm.Script(html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1]));
    // The program's page: Play first, the way back is the Shelf, its cover and length.
    const n = await (await call(e, `${KEY}/tv/notes/cramps?room=ultra&from=shelf`)).text();
    assert.ok(n.includes(`<a class="pill" data-f="back" href="/buttons/${KEY}/tv/shelf?room=ultra">`) && n.includes(">Shelf</a>"));
    assert.ok(n.includes(`<form method="post" action="/notes/${KEY}/play"><input type="hidden" name="slug" value="cramps"><input type="hidden" name="device" value="Ultra"><input type="hidden" name="back" value="tvnotes"><button type="submit" class="pill nplay" data-f="play" data-home>`));
    assert.match(n, /Play on the Ultra<\/button>/);
    assert.match(n, /<div class="ntop"><img src="https:\/\/i.scdn.co\/image\/c1"[^>]*><div>[\s\S]*?<p class="nmeta">1 h 09 · 1 song<\/p>/);
    assert.doesNotThrow(() => new vm.Script(n.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1]));
    assert.ok(n.includes('if (dir === "up" || dir === "down") { tvScroll(dir === "down" ? 1 : -1, !!ev.repeat);'), "the arrows scroll; Page up and Page down turn");
    // A Tidal program opens too, to be read, with no Play.
    const t = await (await call(e, `${KEY}/tv/notes/rooms?room=ultra&from=shelf`)).text();
    assert.ok(!t.includes('value="tvnotes"')); assert.match(t, /A Tidal program plays on a WiiM, with the home helper on\./);
    // With the home helper's hands, on a WiiM: Play, through the helper (2026-11-16).
    await helper(e, [{ name: "Ultra", state: "idle" }, { name: "Pro Plus", state: "idle" }]);
    e.STATION.endless.hands = async () => ({ ok: true });
    const th = await (await call(e, `${KEY}/tv/notes/rooms?room=ultra&from=shelf`)).text();
    assert.ok(th.includes('value="tvnotes"'), "a Tidal program has Play on a WiiM with the helper on");
    // Play from the page comes back to it, saying what happened, the first stop marked.
    const play = (fields) => worker.fetch(new Request(`https://x.test/notes/${KEY}/play`, { method: "POST", body: new URLSearchParams(fields) }), e, { waitUntil() {} });
    const gone = await play({ slug: "not-there", device: "Ultra", back: "tvnotes" });
    assert.equal(gone.status, 303); assert.equal(gone.headers.get("location"), `/buttons/${KEY}/tv/shelf?room=ultra`);
    // Put on the Tidal requests preset and its key pressed by the helper; back to its page, the first song marked.
    assert.equal((await play({ slug: "rooms", device: "Ultra", back: "tvnotes" })).headers.get("location"), `/buttons/${KEY}/tv/notes/rooms?room=ultra&from=shelf&sp=ok&uri=tidal%3Atrack%3A1`);
    // Not on a room that isn't a WiiM.
    assert.equal((await play({ slug: "rooms", device: "Living Room", back: "tvnotes" })).headers.get("location"), `/buttons/${KEY}/tv/notes/rooms?room=living-room&from=shelf&sp=no`);
    assert.equal((await play({ slug: "not-there", device: "Ultra", back: "tv" })).headers.get("location"), `/buttons/${KEY}/tv?sp=gone&room=ultra`, "the TV page's own Play as before");
    const okd = await (await call(e, `${KEY}/tv/notes/cramps?room=ultra&from=shelf&sp=ok&uri=${encodeURIComponent(A)}`)).text();
    assert.match(okd, /<p class="nsaid" role="status">Playing on the Ultra\.<\/p>/);
    assert.match(okd, /<span class="now">Playing now<\/span>/); assert.match(okd, />Play from the start<\/button>/);
    assert.ok(!/data-f="play" data-home/.test(okd), "after Play the page is for reading");
    const asleep = await (await call(e, `${KEY}/tv/notes/cramps?room=ultra&from=shelf&sp=asleep`)).text();
    assert.match(asleep, /<p class="nsaid" role="status">The Ultra is not in Spotify&#39;s list right now/);
    // Opened from the song page it is the reader it was: Back to the song page, no Play.
    const fromSong = await (await call(e, `${KEY}/tv/notes/cramps?room=ultra`)).text();
    assert.ok(fromSong.includes(`href="/buttons/${KEY}/tv?room=ultra&amp;v=dis"`) && !fromSong.includes('value="tvnotes"'));
    assert.equal((await call(e, `wrongkey123456/tv/shelf`)).status, 404);
  } finally { f.restore(); }
});

test("a DJ's dials on the TV: sliders with a minus and a plus, sent as the Tune form sends them, and back to the TV page", async () => {
  const store = await makeHouseStore();
  const e = { ...env(), HOUSE: store.binding };
  await e.PROGRAMS.put("house:claimed", "2026-10-23T00:00:00Z");
  const f = installFetch();
  try {
    const r = await call(e, `${KEY}/tv/tune/soul?room=pro-plus`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, new RegExp(`<form method="post" action="/buttons/${KEY}/soul/tune">\\s*<input type="hidden" name="do" value="apply"><input type="hidden" name="back" value="tv"><input type="hidden" name="room" value="pro-plus">`));
    assert.ok(html.includes("<h1>Tune Soul</h1>") && html.includes(`href="/buttons/${KEY}/tv?room=pro-plus"`));
    // Soul: the years as two sliders, then Hits, Same artist and Stay in soul; each with its two buttons and its field.
    assert.deepEqual([...html.matchAll(/<span class="tk">([^<]+)<\/span>/g)].map((m) => m[1]), ["From the year", "To the year", "Hits", "Same artist", "Stay in soul"]);
    assert.equal((html.match(/class="step" data-step="-1"/g) ?? []).length, 5);
    assert.equal((html.match(/class="step" data-step="1"/g) ?? []).length, 5);
    assert.ok(html.includes('<input type="hidden" name="years_from" value="1959" data-min="1959" data-max="1979">'));
    assert.ok(html.includes('<input type="hidden" name="years_to" value="1979" data-min="1959" data-max="1979">'));
    assert.match(html, /<output class="tval">Mostly<\/output>\s*<input type="hidden" name="hits" value="2" data-min="0" data-max="2">/, "on the DJ's own stop, so not marked changed");
    assert.match(html, /Uses 1 of today&#39;s \d+ remaining DJ runs\./);
    // The knob is the one disc on a track; the DJ's own stop is a ring before its name; a year says itself under its knob.
    assert.equal((html.match(/<i class="slknob"/g) ?? []).length, 5);
    assert.ok(!html.includes("slown"));
    assert.match(html, /<span class="sllab last on" style="left:100\.00%"><i class="ring" aria-hidden="true"><\/i>Mostly<\/span>/);
    assert.match(html, /<i class="slother" style="left:100\.00%"><\/i><span class="sllab on" data-at style="left:0\.00%">1959<\/span>/);
    assert.ok(!/<(textarea|select)\b/.test(html) && !/<input(?![^>]*type="hidden")/.test(html) && !html.includes('type="range"'), "no native slider, nothing to type in");
    const script = html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(script));
    // Apply: kept (nothing of Soul's plays here, so it is saved), and back on the TV page, which says so.
    const sent = await post(e, `${KEY}/soul/tune`, { do: "apply", back: "tv", room: "pro-plus", years_from: "1966", years_to: "1970", hits: "0", same: "0", stay: "1" });
    assert.equal(sent.status, 303);
    assert.equal(sent.headers.get("location"), `/buttons/${KEY}/tv?tn=saved&room=pro-plus`);
    const again = await (await call(e, `${KEY}/tv/tune/soul?room=pro-plus`)).text();
    assert.ok(again.includes('name="years_from" value="1966"') && again.includes('name="years_to" value="1970"'));
    assert.match(again, /<output class="tval ch">A few<\/output>\s*<input type="hidden" name="hits" value="0"/);
    const back = await (await call(e, `${KEY}/tv?tn=saved&room=pro-plus`)).text();
    assert.match(back, /<p class="bsay" role="status">Tuned\. The next new songs follow it\.<\/p>/);
    // A DJ with no dials here, or a made-up one: back to the TV page.
    const none = await call(e, `${KEY}/tv/tune/nobody?room=pro-plus`);
    assert.equal(none.status, 303); assert.equal(none.headers.get("location"), `/buttons/${KEY}/tv?room=pro-plus`);
  } finally { f.restore(); }
});

test("a program's notes on the TV: the whole page to read, the song playing marked, and back to the display", async () => {
  const e = env();
  const f = installFetch();
  try {
    const U = (n) => `spotify:track:${String(n).padStart(22, "0")}`;
    await e.PROGRAMS.put("program:cramps", JSON.stringify({ slug: "cramps", title: "The Cramps on Record", dj: "the-librarian", shape: "survey",
      thesis: "Four rooms, one band.", sections: [
        { label: "Memphis", years: "1977", heading: "Sun's own room", prose: [{ text: "They drove south." }, "Then the landmark."],
          tracks: [{ uri: U(1), title: "Human Fly", artist: "The Cramps" }, { uri: U(2), title: "Surfin' Bird", artist: "The Cramps" }] },
        { label: "Ohio", prose: ["Later."], tracks: [{ uri: U(3), title: "Garbageman", artist: "The Cramps" }] }],
      complications: ["No live tapes."], coda: ["Start with Songs the Lord Taught Us."] }));
    const r = await call(e, `${KEY}/tv/notes/cramps?room=pro-plus&uri=${encodeURIComponent(U(2))}`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes(`<a class="pill" data-f="back" href="/buttons/${KEY}/tv?room=pro-plus&amp;v=dis">`), "back to the display");
    assert.ok(html.includes('<a class="pill" data-f="song" href="#stop-1">To the song</a>'));
    assert.ok(html.includes('<button type="button" class="pill" data-page="-1">Page up</button><button type="button" class="pill" data-page="1">Page down</button>'));
    assert.ok(html.includes('<p class="nk">The Librarian · Survey</p>') && html.includes('<p class="nstand">Four rooms, one band.</p>'));
    assert.match(html, /<p class="nlab">Memphis · 1977<span class="now">Playing now<\/span><\/p>\s*<h2 class="nh">Sun&#39;s own room<\/h2>\s*<p class="np">They drove south.<\/p>\s*<p class="np">Then the landmark.<\/p>/);
    assert.ok(html.includes('<li class="on"><b>Surfin&#39; Bird</b> · The Cramps</li>'));
    assert.ok(html.includes('<h2 class="nh">What is not here</h2>') && html.includes("Start with Songs the Lord Taught Us."), "the closing parts under the shape's own names");
    assert.ok(!/<(textarea|select)\b/.test(html) && !/<input\b/.test(html));
    const script = html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(script));
    // No such program: back to the display. A wrong key: nothing.
    const gone = await call(e, `${KEY}/tv/notes/nothing-here?room=pro-plus`);
    assert.equal(gone.status, 303); assert.equal(gone.headers.get("location"), `/buttons/${KEY}/tv?room=pro-plus&v=dis`);
    assert.equal((await call(e, `wrongkey123456/tv/notes/cramps`)).status, 404);
  } finally { f.restore(); }
});

// SONG FACTS (the owner's choice A, 2026-11-15): MusicBrainz by the song's
// code, then the work's Wikidata entry to its English Wikipedia article.
// The answers below are cut from the real ones for Al Green's "Tired of Being
// Alone" (US2HK0914201), measured the same evening.
const AL = "US2HK0914201", ALREC = "cfa318d3-d3ab-48e7-9b78-4f3383ed0ddd";
function openDatabases({ mbBusy = false } = {}) {
  const heard = [];
  const below = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    const ua = new Headers(init.headers).get("user-agent");
    if (url.hostname === "musicbrainz.org") {
      heard.push(`mb ${url.pathname}`);
      if (mbBusy) return Response.json({ error: "busy" }, { status: 503 });
      if (url.pathname === `/ws/2/isrc/${AL}`) return Response.json({ recordings: [{ id: ALREC, length: 170560 }] });
      if (url.pathname === `/ws/2/recording/${ALREC}`) {
        assert.match(url.search, /inc=artist-rels\+place-rels\+area-rels\+work-rels\+work-level-rels\+url-rels\+releases\+release-groups/);
        return Response.json({ id: ALREC, title: "Tired of Being Alone", "first-release-date": "1971-08-14",
          relations: [
            { "target-type": "place", type: "recorded at", place: { name: "Royal Studios" } },
            { "target-type": "work", type: "performance", work: { title: "Tired of Being Alone", relations: [
              { "target-type": "artist", type: "composer", artist: { name: "Al Green" } },
              { "target-type": "artist", type: "lyricist", artist: { name: "Al Green" } },
              { "target-type": "url", type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q7809188" } }] } }],
          releases: [
            { title: "Greatest Hits", date: "1975", status: "Official", "release-group": { title: "Greatest Hits", "primary-type": "Album", "secondary-types": ["Compilation"], "first-release-date": "1975" } },
            { title: "Gets Next to You", date: "1972", status: "Official", "release-group": { title: "Al Green Gets Next to You", "primary-type": "Album", "secondary-types": [], "first-release-date": "1971-08-14" } },
            { title: "Al Green Gets Next to You", date: "1971-08-14", status: "Official", "release-group": { title: "Al Green Gets Next to You", "primary-type": "Album", "secondary-types": [], "first-release-date": "1971-08-14" } }] });
      }
      return Response.json({ error: "Not Found" }, { status: 404 });
    }
    if (url.hostname === "www.wikidata.org") {
      heard.push(`wikidata ${url.searchParams.get("ids")}`); assert.ok(ua);
      return Response.json({ entities: { Q7809188: { sitelinks: { enwiki: { title: "Tired of Being Alone" } } } } });
    }
    if (url.hostname === "en.wikipedia.org") {
      heard.push(`wikipedia ${url.pathname}`);
      return Response.json({ type: "standard", title: "Tired of Being Alone",
        extract: "\"Tired of Being Alone\" is a soul song written by American singer Al Green. It reached number 11 on the US Billboard Hot 100.",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Tired_of_Being_Alone" } } });
    }
    return below(u, init);
  };
  return { heard, restore() { globalThis.fetch = below; } };
}

test("song facts: the writers, the studio, the year and the first studio album, and Wikipedia's opening; kept by code", async () => {
  const e = env();
  e.ARTIST_LOOKUP = "on"; e.__mbSleep = async () => {};
  const f = installFetch();
  const db = openDatabases();
  try {
    const U = `spotify:track:${"3Pl49zzZ8Dmy7EEaRSRkvB"}`;
    const a = await (await call(e, `${KEY}/tv/song?uri=${encodeURIComponent(U)}&isrc=${AL}&ms=170000&t=Tired%20of%20Being%20Alone`)).json();
    assert.deepEqual(a.facts, { writers: ["Al Green"], recorded: null, place: "Royal Studios", live: false, released: 1971,
      album: { title: "Al Green Gets Next to You", year: 1971 },
      wiki: { title: "Tired of Being Alone", text: "\"Tired of Being Alone\" is a soul song written by American singer Al Green. It reached number 11 on the US Billboard Hot 100.",
        url: "https://en.wikipedia.org/wiki/Tired_of_Being_Alone" } });
    assert.deepEqual(db.heard, [`mb /ws/2/isrc/${AL}`, `mb /ws/2/recording/${ALREC}`, "wikidata Q7809188", "wikipedia /api/rest_v1/page/summary/Tired_of_Being_Alone"]);
    // Asked again: from the house's own keeping, nothing sent.
    const again = await (await call(e, `${KEY}/tv/song?uri=${encodeURIComponent(U)}&isrc=${AL}`)).json();
    assert.deepEqual(again.facts, a.facts); assert.equal(db.heard.length, 4);
    // A house that does not ask MusicBrainz, and a code that is not one.
    e.ARTIST_LOOKUP = "off";
    assert.equal((await (await call(e, `${KEY}/tv/song?uri=${encodeURIComponent(U)}&isrc=US2HK0914299`)).json()).facts, null);
    e.ARTIST_LOOKUP = "on";
    assert.equal((await (await call(e, `${KEY}/tv/song?uri=${encodeURIComponent(U)}&isrc=not-a-code`)).json()).facts, null);
    assert.equal(db.heard.length, 4);
  } finally { db.restore(); f.restore(); }
});

test("song facts: a busy MusicBrainz is not asked again for a quarter of an hour, and says nothing", async () => {
  const e = env();
  e.ARTIST_LOOKUP = "on"; e.__mbSleep = async () => {};
  const f = installFetch();
  const db = openDatabases({ mbBusy: true });
  try {
    const q = `${KEY}/tv/song?uri=${encodeURIComponent("spotify:track:3Pl49zzZ8Dmy7EEaRSRkvB")}&isrc=${AL}`;
    assert.equal((await (await call(e, q)).json()).facts, null);
    const n = db.heard.length;
    assert.ok(n >= 1 && n <= 4, `asked at most four times (${n})`);
    assert.equal((await (await call(e, q)).json()).facts, null);
    assert.equal(db.heard.length, n, "not asked again at once");
  } finally { db.restore(); f.restore(); }
});

test("the song's code rides from Spotify's read to the TV page, and About this song draws the facts", async () => {
  const { roomPlaying } = await import("../now.js");
  const st = { is_playing: true, device: { name: "Pro Plus" }, progress_ms: 1000, readAt: 5,
    item: { name: "Tired of Being Alone", uri: "spotify:track:3Pl49zzZ8Dmy7EEaRSRkvB", duration_ms: 170560, external_ids: { isrc: "us2hk0914201" }, artists: [{ name: "Al Green" }], album: { name: "Gets Next to You", images: [] } } };
  assert.equal(roomPlaying(st).isrc, AL);
  assert.equal(roomPlaying({ ...st, item: { ...st.item, external_ids: { isrc: "nonsense" } } }).isrc, undefined);
  const b = tvBand({ state: "playing", track: "Tired of Being Alone", device: "Pro Plus", pausable: "Pro Plus", uri: st.item.uri, isrc: AL, pos: { ms: 0, of: 170560, at: 1 } }, PRO, 1);
  assert.equal(b.song.isrc, AL); assert.equal(b.song.ms, 170560);
  const html = renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: null, readings: {} });
  assert.ok(html.includes('<div class="afacts" hidden><p class="albl afl">Song facts</p><dl class="adl"></dl>'));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.includes('row("Written by"') && script.includes("dd.textContent = v"), "facts are drawn as text, never as markup");
});

test("song facts: a code MusicBrainz does not know is found by title and artist, and only the song's writers and article are kept", async () => {
  const e = env();
  e.ARTIST_LOOKUP = "on"; e.__mbSleep = async () => {};
  const f = installFetch();
  const db = openDatabases();
  const below = globalThis.fetch;
  const searched = [];
  globalThis.fetch = async (u, init) => {
    const url = new URL(String(u));
    if (url.hostname === "musicbrainz.org" && url.pathname === "/ws/2/recording") {
      searched.push(url.searchParams.get("query"));
      return Response.json({ recordings: [
        { id: "aaaaaaaa-live", score: 100, length: 400000 },
        { id: ALREC, score: 97, length: 170560 }] });
    }
    return below(u, init);
  };
  try {
    const q = `${KEY}/tv/song?uri=${encodeURIComponent("spotify:track:3Pl49zzZ8Dmy7EEaRSRkvB")}&isrc=GBAAA9999999&ms=171000&t=${encodeURIComponent("Tired of Being Alone - 2003 Remaster")}&a=${encodeURIComponent("Al Green")}`;
    const a = (await (await call(e, q)).json()).facts;
    assert.deepEqual(searched, ['recording:"Tired of Being Alone" AND artist:(Al Green)'], "the title without its remaster, the artist's words");
    assert.equal(a.byName, true);
    assert.deepEqual(a.writers, ["Al Green"]);
    assert.equal(a.wiki.title, "Tired of Being Alone");
    assert.equal(a.place, null); assert.equal(a.recorded, null); assert.equal(a.album, null); assert.equal(a.released, null);
    assert.ok(db.heard.includes(`mb /ws/2/recording/${ALREC}`) && !db.heard.some((h) => h.includes("aaaaaaaa")), "the take within ten seconds of the track, not the longer live one");
  } finally { globalThis.fetch = below; db.restore(); f.restore(); }
});

test("a TV page left open asks for itself again when a deploy changed it, once", async () => {
  const { TV_BUILD } = await import("../tv.js");
  assert.match(TV_BUILD, /^[0-9a-z]{4,8}$/);
  const a = tvAnswer({ state: "quiet" }, PRO);
  assert.equal(a.build, TV_BUILD);
  const html = renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: null, readings: {} });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.includes('if (!inView && a.build && a.build !== build && again("tv:build", a.build)) return;'));
  assert.ok(script.includes('if (!inView && a.sig && a.sig !== sig && again("tv:reloaded", a.sig)) return;'), "and never out of a view being read");
  assert.ok(script.includes("if (pending && Date.now() < pending.until) d = Math.min(d, 3000);"), "a press on its way is looked for every 3 seconds");
  assert.doesNotThrow(() => new vm.Script(script));
});

test("song facts with no code at all: found by title and artist, kept under them", async () => {
  const e = env();
  e.ARTIST_LOOKUP = "on"; e.__mbSleep = async () => {};
  const f = installFetch();
  const db = openDatabases();
  const below = globalThis.fetch;
  const searched = [];
  globalThis.fetch = async (u, init) => {
    const url = new URL(String(u));
    if (url.hostname === "musicbrainz.org" && url.pathname === "/ws/2/recording") {
      searched.push(url.searchParams.get("query"));
      return Response.json({ recordings: [{ id: ALREC, score: 100, length: 170560 }] });
    }
    return below(u, init);
  };
  try {
    const q = `${KEY}/tv/song?uri=${encodeURIComponent("spotify:track:3Pl49zzZ8Dmy7EEaRSRkvB")}&isrc=&ms=170000&t=${encodeURIComponent("Tired of Being Alone")}&a=${encodeURIComponent("Al Green")}`;
    const a = (await (await call(e, q)).json()).facts;
    assert.equal(a.byName, true); assert.deepEqual(a.writers, ["Al Green"]); assert.equal(a.wiki.title, "Tired of Being Alone");
    assert.ok(!db.heard.some((h) => h.includes("/isrc/")), "no code to ask with");
    assert.ok(await e.PROGRAMS.get("songfacts:n-al-green-tired-of-being-alone"), "kept under the artist and the title");
    const n = searched.length;
    assert.deepEqual((await (await call(e, q)).json()).facts, a); assert.equal(searched.length, n, "and found there the next time");
  } finally { globalThis.fetch = below; db.restore(); f.restore(); }
});

// SAY IT ON THE TV (2026-11-15): TV Bro's own voice search, its search engine
// set to the house's address, sends plain words; they are read against maple
// crate's own sentences and done by its door.
test("the words TV Bro heard, read as maple crate's sentences: the longest fixed wording wins, slots checked", async () => {
  const { tvIntent, tvWords } = await import("../tvsay.js");
  const rooms = ["Pro Plus", "Ultra", "Master Bedroom", "Den2", "Living Room"];
  const read = (t) => { const x = tvIntent(t, rooms); return x ? [x.body.request.intent.name, Object.fromEntries(Object.entries(x.body.request.intent.slots).map(([k, v]) => [k, v.value]))] : null; };
  assert.equal(tvWords("Hey Google, ask maple crate for Sessions, please"), "sessions");
  assert.deepEqual(read("Sessions, acoustic piano, an hour"), ["AskSessions", { words: "acoustic piano an hour" }]);
  assert.deepEqual(read("Hank"), ["AskHank", {}], "a DJ alone: the door puts them on");
  assert.deepEqual(read("Dr. Funkenstein"), ["AskDrFunkenstein", {}]);
  assert.deepEqual(read("put on Hank in the master bedroom"), ["PlayHank", { room: "master bedroom" }]);
  assert.deepEqual(read("Play preset 12 on the Ultra"), ["PresetIntent", { number: "12", room: "ultra" }]);
  assert.deepEqual(read("preset seven"), ["PresetIntent", { number: "7" }]);
  assert.deepEqual(read("pause"), ["QuietIntent", {}], "the TV's own words the Echos never send");
  assert.deepEqual(read("skip"), ["SkipIntent", {}]);
  assert.deepEqual(read("more like this"), ["MoreLikeIntent", {}], "not “more {words}”");
  assert.deepEqual(read("steer toward Stax"), ["SteerToIntent", { words: "toward stax" }]);
  assert.deepEqual(read("what's playing"), ["NowIntent", {}]);
  assert.deepEqual(read("The Librarian the Cramps live 1979"), ["AskTheLibrarian", { words: "the cramps live 1979" }], "years stay figures");
  assert.equal(read("hello world"), null);
  const { alexaHeard } = await import("../alexa.js");
  assert.equal(alexaHeard(tvIntent("play preset 30", rooms).body, { ROOM_DEVICES: JSON.stringify(rooms) }).kind, "no-preset", "no thirtieth key: the door says so");
  const room = tvIntent("pause on the den 2", rooms).body.request.intent.slots.room;
  assert.equal(room.resolutions.resolutionsPerAuthority[0].values[0].value.id, "Den2", "a speaker said with a figure or a word is the same");
});

test("…/tv/say does it once, in the TV's room, and the TV page says what was heard and done", async () => {
  const e = env();
  const f = installFetch();
  try {
    await helper(e, [{ name: "Pro Plus", state: "idle" }, { name: "Ultra", state: "idle" }]);
    // The TV page last showed the Ultra: that room is the TV's.
    const pick = await call(e, `${KEY}/tv?room=ultra`);
    const cookie = (pick.headers.get("set-cookie") ?? "").split(";")[0];
    const say = (words) => call(e, `${KEY}/tv/say?q=${encodeURIComponent(words)}`, { headers: { cookie } });
    const r = await say("what's playing");
    assert.equal(r.status, 303);
    const to = r.headers.get("location");
    assert.match(to, new RegExp(`^/buttons/${KEY}/tv\\?room=ultra&vs=[a-f0-9]{16}$`), "back to the TV page, nothing said in its address");
    const page = await (await call(e, to.replace(/^\/buttons\//, ""), { headers: { cookie } })).text();
    assert.match(page, /<p class="bsay" role="status">“what&#39;s playing”: Nothing is playing on Spotify\.<\/p>/, "what it heard, and what the house answered");
    // Words the house does not know: said so, with what it does know.
    const n = await (await call(e, (await say("hello world")).headers.get("location").replace(/^\/buttons\//, ""))).text();
    assert.match(n, /“hello world”: That isn&#39;t something the house knows how to do/);
    // A question is answered every time.
    const again = await (await call(e, (await say("what's playing")).headers.get("location").replace(/^\/buttons\//, ""))).text();
    assert.match(again, /“what&#39;s playing”: Nothing is playing on Spotify\.<\/p>/);
    // An act said again within a minute is not done twice; its first answer is shown.
    const first = await (await call(e, (await say("skip")).headers.get("location").replace(/^\/buttons\//, ""))).text();
    const firstSaid = first.match(/<p class="bsay" role="status">“skip”: ([^<]*)<\/p>/)[1];
    const second = await (await call(e, (await say("skip")).headers.get("location").replace(/^\/buttons\//, ""))).text();
    assert.ok(second.includes(`“skip”: Said a moment ago, not done twice: ${firstSaid}</p>`), second.match(/<p class="bsay"[^>]*>[^<]*/)?.[0]);
    assert.equal((await call(e, `wrongkey123456/tv/say?q=pause`)).status, 404);
    assert.equal((await call(e, `${KEY}/tv/say?q=pause`, { method: "POST", body: "x" })).status, 405);
  } finally { f.restore(); }
});

test("What to say has the TV's card in every house: the address to copy, with TV Bro's [query]", async () => {
  const e = env();
  const f = installFetch();
  try {
    const r = await call(e, `${KEY}/say`);
    assert.equal(r.status, 200, "a house with neither Talk nor the Echos has the page too");
    const html = await r.text();
    assert.ok(html.includes(`<code class="setval">https://x.test/buttons/${KEY}/tv/say?q=[query]</code><button class="setcopy" type="button" data-copy="https://x.test/buttons/${KEY}/tv/say?q=[query]" hidden>Copy</button>`));
    assert.match(html, /<h2 id="say-tv">On the TV<\/h2>/);
    assert.match(html, /<b>In the fmwax TV app<\/b> voice needs no setting up: press <b>Guide<\/b>/);
    assert.match(html, /<b>In TV Bro instead<\/b>/);
    assert.ok(html.includes(`<code class="setval">https://x.test/buttons/${KEY}/tv</code><button class="setcopy" type="button" data-copy="https://x.test/buttons/${KEY}/tv" hidden>Copy</button>`), "the TV page's own address, to copy");
    // The list of what to say on the TV (the owner, 2026-11-16), every sentence one the house understands.
    const { tvIntent } = await import("../tvsay.js");
    const said = [...html.matchAll(/<h2 id="say-tv-(?:music|djs|turn)">[\s\S]*?<\/section>/g)].flatMap((m) => [...m[0].matchAll(/<q>([^<]*)<\/q>/g)].map((q) => q[1].replace(/&#39;/g, "'")));
    assert.ok(said.length >= 20, said.join(" | "));
    const rooms = ["Pro Plus", "Ultra", "Master Bedroom", "Dining Room", "Living Room", "iPhone"];
    for (const w of said.filter((w) => w !== "Northern soul")) assert.ok(tvIntent(w, rooms), `not understood: ${w}`);
    assert.match(html, /<h2 id="say-tv-not">On the TV: not understood<\/h2>/);
    const sp = await (await call(e, `${KEY}/wiim`)).text();
    assert.ok(sp.includes(`<a class="chip" href="/buttons/${KEY}/say#say-tv">Voice on the TV</a>`));
  } finally { f.restore(); }
});

// THE DJS ON THE TV (2026-11-16, the owner's canvas "fmwax on the TV, the DJs").
test("the DJs on the TV: three groups, a DJ's screen with its remembered settings, and the words said go to that DJ", async () => {
  const { tvDjKind, djIdeas, tvDjSettings } = await import("../tvdj.js");
  const e = env();
  const f = installFetch();
  try {
    assert.equal(tvDjKind(e, "sessions"), "house");
    assert.equal(tvDjKind(e, "genre"), "guest");
    assert.equal(tvDjKind(e, "the-librarian"), "writer");
    assert.deepEqual(djIdeas("hank"), ["an hour of Daptone and its neighbours", "an hour of new Colemine and Daptone records — nothing from last time",
      djIdeas("hank")[2]], "the DJ's own asks without the name they start with");
    assert.equal(djIdeas("genre")[0], "80s new wave", "and without “endless”");
    const req = (cookie) => new Request("https://x.test/", { headers: { cookie } });
    assert.deepEqual(tvDjSettings(req("tvs-the-librarian=90.long.1.0.now"), "the-librarian"), { len: 90, notes: "long", keep: true, start: false, when: "now", svc: "spotify" });
    assert.deepEqual(tvDjSettings(req("tvs-the-librarian=90.long.1.0.now.tidal"), "the-librarian").svc, "tidal");
    assert.deepEqual(tvDjSettings(req("x=1"), "the-librarian"), { len: 60, notes: "short", keep: false, start: true, when: "next", svc: "spotify" }, "the defaults");
    assert.equal(tvDjSettings(req("tvdj=%E0; tvs-the-librarian=%E0"), "the-librarian").len, 60, "a cookie that doesn't decode is no cookie");

    // A DJ's sleeve, from the covers the house ships; none for a name that is no DJ.
    const covers = { fetch: async (req) => new URL(req.url).pathname === "/hank.jpg" ? new Response("JPEG", { headers: { "content-type": "image/jpeg" } }) : new Response("", { status: 404 }) };
    const face = await call({ ...e, COVERS: covers }, `${KEY}/tv/face/hank.jpg`);
    assert.equal(face.status, 200); assert.equal(face.headers.get("content-type"), "image/jpeg"); assert.equal(await face.text(), "JPEG");
    assert.equal((await call({ ...e, COVERS: covers }, `${KEY}/tv/face/nobody.jpg`)).status, 404);
    assert.equal((await call({ ...e, COVERS: undefined }, `${KEY}/tv/face/hank.jpg`)).status, 404, "no covers binding, no sleeve");
    const list = await call(e, `${KEY}/tv/djs?room=pro-plus`);
    assert.equal(list.status, 200);
    assert.match(list.headers.get("set-cookie") ?? "", /tvdj=; Path=\/; Max-Age=0/, "the list names no DJ");
    const lh = await list.text();
    assert.match(lh, /On their own preset<\/p>[\s\S]*?data-f="dj:sessions"[\s\S]*?Preset 6/);
    assert.match(lh, /Guest DJs[\s\S]*?data-f="dj:genre"[\s\S]*?Needs a genre/);
    assert.match(lh, /Writers[\s\S]*?data-f="dj:the-librarian"[\s\S]*?data-f="dj:gatefold"/);
    assert.match(lh, /data-f="dj:hank" aria-label="Hank"><span class="sleeve" style="background:#C9962B;color:#241A08" aria-hidden="true"><span class="sn">Hank<\/span><img src="\/buttons\/[a-f]+\/tv\/face\/hank.jpg"/);
    assert.ok(!/class="face"/.test(lh), "no initials");
    assert.doesNotThrow(() => new vm.Script(lh.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1]));
    assert.ok(lh.includes(`<a class="pill" data-f="back" href="/buttons/${KEY}/tv?room=pro-plus">`));

    const r = await call(e, `${KEY}/tv/dj/the-librarian?room=pro-plus`, { headers: { cookie: "tvs-the-librarian=90.long.1.0.next" } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie") ?? "", /^tvdj=the-librarian; Path=\/; Max-Age=1800/, "the screen names its DJ for the voice search");
    const h = await r.text();
    assert.match(h, /Writer · a set with notes, on the Requests preset/);
    assert.match(h, /data-set="len"><button type="button" data-v="30" aria-pressed="false">30 min<\/button><button type="button" data-v="60" aria-pressed="false">1 hour<\/button><button type="button" data-v="90" aria-pressed="true">90 min/, "remembered: 90 min");
    assert.match(h, /data-set="notes">[^]*?data-v="long" aria-pressed="true">Long read/);
    assert.match(h, /data-set="start"><button type="button" data-v="true" aria-pressed="false">On<\/button><button type="button" data-v="false" aria-pressed="true">Off/);
    assert.match(h, /The Librarian(?:'|&#39;)s ideas<\/p><form [^>]*><input type="hidden" name="do" value="surprise">[\s\S]*?class="idea" data-home title="introduce me to Stiff Records/, "Surprise me on the ideas' line, the first idea in hand");
    assert.ok(h.includes(`<span class="sleeve mini" style="background:#1E3A34;color:#E3D6B0" aria-hidden="true"><span class="sn">The Librarian</span><img src="/buttons/${KEY}/tv/face/the-librarian.jpg" alt="" decoding="async"></span>`), "the sleeve, not initials");
    assert.ok(h.includes(`<form method="post" action="/buttons/${KEY}/tv/dj/the-librarian"><input type="hidden" name="do" value="surprise">`));
    assert.ok(!/<(textarea|select)\b/.test(h) && !/<input(?![^>]*type="hidden")/.test(h), "nothing to type in");
    const script = h.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(script));
    assert.ok(script.includes('document.cookie = "tvs-" + KEY'), "the settings are written for this DJ");
    // No last asks (the owner, 2026-11-16); the writer's set on Spotify or Tidal where the house has both.
    assert.ok(!/Your last/.test(h));
    assert.ok(h.includes('<div class="seg" role="group" data-set="svc"><button type="button" data-v="spotify" aria-pressed="false">Spotify · 1</button><button type="button" data-v="tidal" aria-pressed="false">Tidal · 2</button></div>')
      || h.includes('data-set="svc"><button type="button" data-v="spotify" aria-pressed="true">Spotify · 1</button><button type="button" data-v="tidal" aria-pressed="false">Tidal · 2</button></div>'));
    assert.ok(script.includes("set.when, set.svc].join"), "the service is remembered too");
    // A house DJ: Play and Start fresh; a guest: what to say and when to take over.
    const s = await (await call(e, `${KEY}/tv/dj/sessions?room=pro-plus`)).text();
    assert.match(s, /<b>Play preset 6<\/b>/); assert.match(s, /<b>Start fresh<\/b>/);
    const g = await (await call(e, `${KEY}/tv/dj/genre?room=pro-plus`)).text();
    assert.match(g, /Guest DJ · endless on preset 3 · needs a genre/);
    assert.match(g, /data-set="when">/);
    assert.ok(!g.includes('value="fresh"'), "Start fresh only while this guest holds the guest preset");
    // A press: done, and back to the TV page with what was done.
    const p = await call(e, `${KEY}/tv/dj/the-librarian`, { method: "POST", headers: { cookie: "tvs-the-librarian=90.long.1.1.next" },
      body: new URLSearchParams({ do: "words", words: "the Cramps in 1979", room: "pro-plus" }) });
    assert.equal(p.status, 303);
    const id = p.headers.get("location").match(/^\/buttons\/[a-f]+\/tv\?room=pro-plus&vs=([a-f0-9]{16})$/)[1];
    const note = JSON.parse(await e.PROGRAMS.get(`tvsaid:${id}`));
    assert.equal(note.heard, "the Cramps in 1979"); assert.ok(note.said);
    assert.equal((await call(e, `${KEY}/tv/dj/the-librarian`, { method: "POST", body: new URLSearchParams({ do: "explode" }) })).status, 400);
    // On Tidal: the set goes to the Tidal requests preset (2).
    const td = await call({ ...e, REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true" }, `${KEY}/tv/dj/gatefold`, { method: "POST", headers: { cookie: "tvs-gatefold=60.short.0.0.next.tidal" },
      body: new URLSearchParams({ do: "words", words: "side two of Rumours", room: "pro-plus" }) });
    const tdn = JSON.parse(await e.PROGRAMS.get(`tvsaid:${td.headers.get("location").match(/vs=([a-f0-9]{16})$/)[1]}`));
    assert.match(tdn.said, /preset 2/, tdn.said);
    // Said to TV Bro while the Librarian's screen is open: the words go to the Librarian.
    const v = await call(e, `${KEY}/tv/say?q=${encodeURIComponent("Stax demos, no hits")}`, { headers: { cookie: "tvdj=the-librarian; tvs-the-librarian=60.short.0.1.next" } });
    const vid = v.headers.get("location").match(/vs=([a-f0-9]{16})$/)[1];
    const vn = JSON.parse(await e.PROGRAMS.get(`tvsaid:${vid}`));
    assert.equal(vn.heard, "Stax demos, no hits");
    assert.ok(!/isn.t something the house knows/.test(vn.said), vn.said);
    // Loaded twice within the minute (TV Bro reloading): filed once.
    const v2 = await call(e, `${KEY}/tv/say?q=${encodeURIComponent("Stax demos, no hits")}`, { headers: { cookie: "tvdj=the-librarian" } });
    const vn2 = JSON.parse(await e.PROGRAMS.get(`tvsaid:${v2.headers.get("location").match(/vs=([a-f0-9]{16})$/)[1]}`));
    assert.match(vn2.said, /^Said a moment ago, not done twice: /);
    // A command still is one, whatever screen was open.
    const sk = await call(e, `${KEY}/tv/say?q=skip`, { headers: { cookie: "tvdj=the-librarian" } });
    const sn = JSON.parse(await e.PROGRAMS.get(`tvsaid:${sk.headers.get("location").match(/vs=([a-f0-9]{16})$/)[1]}`));
    assert.equal(sn.heard, "skip");
  } finally { f.restore(); }
});


// THE REVIEW OF 2026-11-16: what it found, fixed and kept so.
test("the review's fixes: the reload mark is what the tiles show; a refused tile press comes back to the TV; Reset sends nothing; words are escaped", async () => {
  // 1. The same presets read an hour apart are the same mark; a renamed one is not.
  const p = [{ btn: 5, name: "Hank", source: "Spotify" }];
  assert.equal(tvReadSig({ "pro-plus": { at: "2026-11-16T10:00:00Z", presets: p } }), tvReadSig({ "pro-plus": { at: "2026-11-16T11:00:00Z", presets: p } }));
  assert.notEqual(tvReadSig({ "pro-plus": { presets: p } }), tvReadSig({ "pro-plus": { presets: [{ ...p[0], name: "Vibe" }] } }));
  assert.equal(tvReadSig({}), "0");
  const e = env();
  const f = installFetch();
  try {
    // 2. A tile press the house refuses: back to the TV page with its reason and the tile in hand.
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/preset/play`, { method: "POST",
      body: new URLSearchParams({ btn: "5", device: "Pro Plus", back: "tv" }) }), e, { waitUntil() {} });
    assert.equal(r.status, 303);
    const m = r.headers.get("location").match(new RegExp(`^/buttons/${KEY}/tv\\?room=pro-plus&k=5&vx=([a-f0-9]{16})$`));
    assert.ok(m, r.headers.get("location"));
    const note = JSON.parse(await e.PROGRAMS.get(`tvsaid:${m[1]}`));
    assert.equal(note.heard, ""); assert.match(note.said, /Pro Plus/);
    const page = await (await call(e, `${KEY}/tv?room=pro-plus&k=5&vx=${m[1]}`)).text();
    assert.match(page, /<p class="bsay" role="status">[^<]*Pro Plus/, "the TV page says why");
    // The phone's own press still gets the phone's page.
    const phone = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/preset/play`, { method: "POST",
      body: new URLSearchParams({ btn: "5", device: "Pro Plus" }) }), e, { waitUntil() {} });
    assert.notEqual(phone.status, 303);
    // 4. Hostile words are text on every TV screen.
    const evil = `<img src=x onerror="alert(1)">`;
    await e.PROGRAMS.put("program:evil", JSON.stringify({ slug: "evil", title: evil, dj: "The Librarian", thesis: evil,
      sections: [{ heading: evil, prose: [evil], tracks: [{ uri: "spotify:track:" + "b".repeat(22), title: evil, artist: evil }] }] }),
      { metadata: { title: evil, dj: "The Librarian", catalog: "spotify", created: "2026-11-16T10:00:00Z" } });
    for (const path of ["tv/shelf?room=pro-plus", "tv/notes/evil?room=pro-plus&from=shelf"]) {
      const h = await (await call(e, `${KEY}/${path}`)).text();
      assert.ok(!h.includes("<img src=x"), path);
      assert.ok(h.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), path);
    }
  } finally { f.restore(); }
  // 3. Reset on the dials moves the sliders back and sends nothing.
  const { renderTvTune } = await import("../tvpages.js");
  const t = renderTvTune({ base: "/b/k", room: PRO, dj: { key: "soul", name: "Soul" }, action: "/b/k/soul/tune",
    dials: [{ id: "fame", name: "Fame", labels: ["Deep", "Mixed", "Hits"], value: 2, ownAt: 1 }], runsLeft: 3 });
  assert.ok(t.includes('<button type="button" class="pill" data-reset>Reset</button>') && !t.includes('name="reset"'));
  assert.doesNotThrow(() => new vm.Script(t.match(/<script>([\s\S]*?)<\/script>/)[1]));
});


test("the microphone on the TV's top row says how to speak to the TV (a page can't open TV Bro's voice search)", () => {
  const ULTRA = { name: "Ultra", slug: "ultra", wiim: true };
  const html = renderTv({ base: "/b/k", rooms: [PRO, ULTRA], room: PRO, now: null, readings: {} });
  assert.ok(html.includes('<button type="button" class="room mic" data-f="mic" data-open="voice" aria-label="Voice: how to say it">'));
  assert.match(html, /<div class="view vvoice" aria-label="Say it to the TV">[\s\S]*?<button type="button" class="pill vclose" data-open="back">Got it<\/button>/);
  assert.match(html, /Press <b>Guide<\/b> on the remote/);
  assert.match(html, /<p class="vstep vapp">Press <b>Guide<\/b> on the remote\. When <b>Listening…<\/b> shows/, "the fmwax TV app's own way (2026-11-18)");
  assert.match(html, /<p class="vstep vbro">[^<]*<b>Guide<\/b>[^<]*TV Bro's voice search/, "TV Bro's way, shown in TV Bro");
  assert.ok(html.includes('navigator.userAgent.indexOf("fmwaxTV/") >= 0'), "the app is told apart by its user agent");
  assert.match(html, /<li>Move the music to the Ultra<span>/, "another of the house's rooms");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.includes('view === "voice" ? q(".vclose")'), "Got it is in hand");
  assert.doesNotThrow(() => new vm.Script(script));
});


test("More from Wikipedia: the article's story after its first paragraph, without its lists and tables, asked once and kept", async () => {
  const { wikiSections, wikiMore } = await import("../musicbrainz.js");
  const extract = [
    '"Take On Me" is a song by the Norwegian synth-pop band a-ha. The original version was recorded in 1984 and released that October.',
    "The original 1984 version failed to chart in the United Kingdom, as did the first of its two 1985 releases; the second reached number two.",
    "== Background ==",
    "The song began as \"Miss Eerie\", written by Pål Waaktaar and Magne Furuholmen while they were in the band Bridges, years before a-ha.",
    "short line",
    "== Charts ==",
    "Weekly chart performance for Take On Me in every country, a long table that reads badly when spoken as prose on a television.",
    "=== Weekly charts ===",
    "Another table line long enough to pass the length test, but inside a section the reader leaves out entirely, as a list.",
    "== Legacy ==",
    "The music video, with its pencil-sketch animation, won six awards at the 1986 MTV Video Music Awards and is still widely imitated.",
    "== References ==",
    "Some reference that is long enough to be a paragraph but must never be shown on the television screen at all, ever.",
  ].join("\n");
  const s = wikiSections(extract, '"Take On Me" is a song by the Norwegian synth-pop band a-ha.');
  assert.deepEqual(s.map((x) => x.h), ["", "Background", "Legacy"]);
  assert.match(s[0].p[0], /^The original 1984 version/, "the opening's rest, not its first paragraph again");
  assert.equal(s[1].p.length, 1, "a short line is no paragraph");
  // Asked through the TV's route, once, then kept.
  const e = { ...env(), ARTIST_LOOKUP: "on" };
  const original = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async (u) => {
    if (String(u).startsWith("https://en.wikipedia.org/w/api.php")) { asked += 1; return Response.json({ query: { pages: [{ title: "Take On Me", extract }] } }); }
    return original(u);
  };
  try {
    const r = await call(e, `${KEY}/tv/song?more=1&w=${encodeURIComponent("Take On Me")}&s=${encodeURIComponent('"Take On Me" is a song')}`);
    const a = await r.json();
    assert.deepEqual(a.more.sections.map((x) => x.h), ["", "Background", "Legacy"]);
    await call(e, `${KEY}/tv/song?more=1&w=${encodeURIComponent("Take On Me")}`);
    assert.equal(asked, 1, "kept, not asked again");
  } finally { globalThis.fetch = original; }
});

test("a song or a station the helper reads in the room shown is a cheap look (every 10 seconds, no Spotify read)", () => {
  const a = tvAnswer({ state: "quiet", lan: { hands: true, speakers: { "Pro Plus": { state: "play", source: "Tidal", track: "x" } } } }, PRO);
  assert.equal(a.cheap, true);
  const b = tvAnswer({ state: "quiet", lan: { hands: true, speakers: { "Pro Plus": { state: "pause", source: "Tidal", track: "x" } } } }, PRO);
  assert.equal(b.cheap, false, "paused: the page slows down as before");
});

// 2026-11-17: the version line at the foot of the rooms screen, and nowhere when the house knows none.
test("the rooms screen ends with the version line", () => {
  const PRO = { name: "Pro Plus", slug: "pro-plus", wiim: true };
  const line = "This house runs the version of 17 November 2026 (code e462000). GitHub has the version of 17 November 2026 (code 4a04154), 3 changes behind.";
  const html = renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: null, readings: {}, version: line });
  const rooms = html.match(/<div class="view vrooms"[\s\S]*?\n  <\/div>/)[0];
  assert.ok(rooms.endsWith(`<p class="rver">${line}</p>\n  </div>`), "last in the rooms view");
  assert.equal(html.split('class="rver"').length, 2, "on the rooms screen only");
  assert.ok(!renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: null, readings: {} }).includes('class="rver"'));
});

// THE ALBUM'S ARTICLE (2026-11-17): a song with no Wikipedia article of its
// own shows the opening of the album it first came out on, said as the
// album's. Shaped on Curtis Mayfield's "Pusherman" (Super Fly, a soundtrack).
test("song facts: no article of the song's own, so the first album's, from its release group's Wikidata link", async () => {
  const e = env();
  e.ARTIST_LOOKUP = "on"; e.__mbSleep = async () => {};
  const f = installFetch();
  const REC = "11111111-pusher", RG = "22222222-superfly";
  const heard = [];
  const below = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "musicbrainz.org") {
      heard.push(`mb ${url.pathname}`);
      if (url.pathname === "/ws/2/recording") return Response.json({ recordings: [{ id: REC, score: 100, length: 305000 }] });
      if (url.pathname === `/ws/2/recording/${REC}`) return Response.json({ id: REC, relations: [
        { "target-type": "work", type: "performance", work: { title: "Pusherman", relations: [{ "target-type": "artist", type: "composer", artist: { name: "Curtis Mayfield" } }] } }],
        releases: [
          { title: "The Very Best of Curtis Mayfield", date: "1997", status: "Official", "release-group": { id: "rg-best", title: "The Very Best of Curtis Mayfield", "primary-type": "Album", "secondary-types": ["Compilation"] } },
          { title: "Curtis/Live!", date: "1971", status: "Official", "release-group": { id: "rg-live", title: "Curtis/Live!", "primary-type": "Album", "secondary-types": ["Live"] } },
          { title: "Superfly", date: "1972-07-11", status: "Official", "release-group": { id: RG, title: "Superfly", "primary-type": "Album", "secondary-types": ["Soundtrack"] } }] });
      if (url.pathname === `/ws/2/release-group/${RG}`) {
        assert.equal(url.searchParams.get("inc"), "url-rels");
        return Response.json({ id: RG, relations: [{ url: { resource: "https://www.wikidata.org/wiki/Q1210542" } }] });
      }
      return Response.json({ error: "Not Found" }, { status: 404 });
    }
    if (url.hostname === "www.wikidata.org") {
      heard.push(`wikidata ${url.searchParams.get("ids")}`);
      return Response.json({ entities: { Q1210542: { sitelinks: { enwiki: { title: "Super Fly (soundtrack)" } } } } });
    }
    if (url.hostname === "en.wikipedia.org") {
      heard.push(`wikipedia ${decodeURIComponent(url.pathname)}`);
      return Response.json({ type: "standard", title: "Super Fly (soundtrack)",
        extract: "Super Fly is the third studio album by American soul musician Curtis Mayfield, released on July 11, 1972.",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Super_Fly_(soundtrack)" } } });
    }
    return below(u, init);
  };
  try {
    const q = `${KEY}/tv/song?uri=${encodeURIComponent("spotify:track:0000000000000000000001")}&isrc=&ms=305000&t=Pusherman&a=${encodeURIComponent("Curtis Mayfield")}&al=${encodeURIComponent("Move On Up: The Gold of Curtis Mayfield")}`;
    const a = (await (await call(e, q)).json()).facts;
    assert.equal(a.wiki, null);
    assert.deepEqual(a.albumWiki, { title: "Super Fly (soundtrack)", album: "Superfly",
      text: "Super Fly is the third studio album by American soul musician Curtis Mayfield, released on July 11, 1972.",
      url: "https://en.wikipedia.org/wiki/Super_Fly_(soundtrack)" });
    assert.ok(heard.includes(`mb /ws/2/release-group/${RG}`), "the soundtrack, not the earlier live record or the compilation");
    assert.ok(!heard.some((h) => h.includes("rg-best") || h.includes("rg-live")));
    // Kept: asked again, nothing sent.
    const n = heard.length;
    assert.deepEqual((await (await call(e, q)).json()).facts, a); assert.equal(heard.length, n);
    assert.equal(JSON.parse(await e.PROGRAMS.get("songfacts:n-curtis-mayfield-pusherman")).v, 2);
  } finally { globalThis.fetch = below; f.restore(); }
});

test("song facts: MusicBrainz knows no album, so Spotify's (not a collection) by Wikipedia's search, and an old kept song is asked once more", async () => {
  const e = env();
  e.ARTIST_LOOKUP = "on"; e.__mbSleep = async () => {};
  const f = installFetch();
  const searched = [];
  const below = globalThis.fetch;
  let article = { type: "standard", title: "Too Far to Care", extract: "Too Far to Care is the third studio album by American alt-country band Old 97's, released in 1997.",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Too_Far_to_Care" } } };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "musicbrainz.org") return Response.json({ recordings: [] });
    if (url.hostname === "en.wikipedia.org" && url.pathname === "/w/api.php") {
      searched.push(url.searchParams.get("srsearch"));
      return Response.json({ query: { search: [{ title: "Old 97's" }, { title: "Too Far to Care" }] } });
    }
    if (url.hostname === "en.wikipedia.org") return Response.json(article);
    return below(u, init);
  };
  try {
    // Kept before the album's article: no `v`, no article of its own.
    await e.PROGRAMS.put("songfacts:n-old-97-s-salome", JSON.stringify({ at: 1, facts: null }));
    const q = (al) => `${KEY}/tv/song?uri=${encodeURIComponent("spotify:track:0000000000000000000002")}&isrc=&ms=200000&t=Salome&a=${encodeURIComponent("Old 97's")}&al=${encodeURIComponent(al)}`;
    const a = (await (await call(e, q("Too Far to Care (Deluxe Edition)"))).json()).facts;
    assert.deepEqual(searched, ["Too Far to Care Old 97's album"], "Spotify's album without its reissue words");
    assert.equal(a.albumWiki.title, "Too Far to Care"); assert.equal(a.albumWiki.album, "Too Far to Care");
    assert.deepEqual(a.writers, []); assert.equal(a.wiki, null);
    // A collection is never taken for the album, and an article that does not name the artist is not kept.
    const e2 = env(); e2.ARTIST_LOOKUP = "on"; e2.__mbSleep = async () => {};
    searched.length = 0;
    assert.equal((await (await call(e2, q("The Very Best of Old 97's"))).json()).facts, null);
    assert.deepEqual(searched, []);
    article = { ...article, extract: "Too Far to Care is a 1997 novel." };
    assert.equal((await (await call(e2, `${KEY}/tv/song?uri=${encodeURIComponent("spotify:track:0000000000000000000003")}&isrc=&ms=1&t=Other&a=${encodeURIComponent("Old 97's")}&al=${encodeURIComponent("Too Far to Care")}`)).json()).facts, null);
  } finally { globalThis.fetch = below; f.restore(); }
});

test("About this song names the album when the article is the album's", () => {
  const html = renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: null, readings: {} });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.includes('"From Wikipedia, about the album " + (w.album || w.title)'));
  assert.ok(script.includes('"&al=" + enc(band.album || "")'), "the album Spotify plays it from rides along");
  assert.doesNotThrow(() => new vm.Script(script));
});

test("an album's article says so in its first sentence; a song's article that names its album later is not one (Superfly, found live)", async () => {
  const { isAlbumArticle, cleanAlbum } = await import("../musicbrainz.js");
  const t = (text, a) => isAlbumArticle({ text }, a);
  assert.equal(t("\"Superfly\" is a song by American soul musician Curtis Mayfield, the title track from his 1972 album Super Fly. It was the second single from the album.", "Curtis Mayfield"), false);
  assert.equal(t("Super Fly is the third studio album by American soul musician Curtis Mayfield, released on July 11, 1972.", "Curtis Mayfield"), true);
  assert.equal(t("Free Your Mind... and Your Ass Will Follow is the second studio album by the American funk rock band Funkadelic.", "Funkadelic"), true);
  assert.equal(t("This Is Hardcore is the sixth studio album by the English rock band Pulp.", "Pulp"), true);
  assert.equal(t("Fresh is the sixth album by American funk band Sly and the Family Stone.", "Sly & The Family Stone"), true);
  assert.equal(t("Too Far to Care is the third studio album by Wilco.", "Old 97's"), false, "another artist's");
  assert.equal(cleanAlbum("A.M. (2017 Remaster)"), "A.M.");
  assert.equal(cleanAlbum("Superfly - Deluxe 25th Anniversary Edition"), "Superfly");
  assert.equal(cleanAlbum("Black Rhythm Revolution!"), "Black Rhythm Revolution!");
});

test("About this song stays open when the song changes, and goes back ten minutes after the remote was last used (2026-11-18)", async () => {
  const html = renderTv({ base: "/buttons/k" });
  assert.match(html, /ABOUT_HOLD = 10 \* 60000/);
  assert.match(html, /view === "about" && !has && aboutKey === song\.key/);
  assert.match(html, /aboutTouch = Date\.now\(\);\n\s+var mb = /);
});

// TALK ON THE TV (MC-48, the owner 2026-11-19): where the house has Talk the
// microphone opens Talk made for the TV; elsewhere it is the voice help.
test("the microphone opens Talk on the TV where the house has Talk, the voice help where not; no App link", () => {
  const ULTRA = { name: "Ultra", slug: "ultra", wiim: true };
  const withTalk = renderTv({ base: "/b/k", rooms: [PRO, ULTRA], room: PRO, now: null, readings: {}, talk: true });
  assert.ok(withTalk.includes('<a class="room mic" data-f="mic" href="/b/k/tv/talk?room=pro-plus" aria-label="Talk">'));
  const without = renderTv({ base: "/b/k", rooms: [PRO, ULTRA], room: PRO, now: null, readings: {} });
  assert.ok(without.includes('<button type="button" class="room mic" data-f="mic" data-open="voice" aria-label="Voice: how to say it">'));
  for (const h of [withTalk, without]) assert.ok(!h.includes('class="room app"'));
});

// TALK ON THE TV IS THE APP'S (2026-11-19, before the app's download): a
// TV's browser gives a page no microphone, and the Talk screen opens its line
// as it opens, so a browser keeps the voice help and is sent back from Talk.
test("Talk on the TV only in the fmwax TV app: the microphone, the Talk screen and About's keys, by the app's user agent", async () => {
  const { inTvApp } = await import("../tv.js");
  assert.equal(inTvApp("Mozilla/5.0 (Linux; Android 12) Chrome/120.0 fmwaxTV/1.6"), true);
  assert.equal(inTvApp("Mozilla/5.0 (Linux; Android 12) TV Bro/2.0"), false);
  assert.equal(inTvApp("Mozilla/5.0 notfmwaxTV/1.6"), false);
  assert.equal(inTvApp(null), false);
  const e = Object.assign(env(), { OPENAI_API_KEY: "sk-test" });
  const f = installFetch();
  try {
    const APP = { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 12) Chrome/120.0 Safari/537.36 fmwaxTV/1.6" } };
    const BRO = { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 12) Chrome/120.0 Safari/537.36 TV Bro" } };
    const inApp = await (await call(e, `${KEY}/tv?room=pro-plus`, APP)).text();
    assert.ok(inApp.includes(`<a class="room mic" data-f="mic" href="/buttons/${KEY}/tv/talk?room=pro-plus" aria-label="Talk">`), "the app: the microphone opens Talk");
    const inBro = await (await call(e, `${KEY}/tv?room=pro-plus`, BRO)).text();
    assert.ok(inBro.includes('<button type="button" class="room mic" data-f="mic" data-open="voice" aria-label="Voice: how to say it">'), "a browser: the voice help");
    assert.ok(!inBro.includes("/tv/talk"), "and no way to Talk");
    const talkApp = await call(e, `${KEY}/tv/talk?room=pro-plus`, APP);
    assert.equal(talkApp.status, 200);
    assert.ok((await talkApp.text()).includes('data-preopen="1"'));
    const talkBro = await call(e, `${KEY}/tv/talk?room=pro-plus`, { ...BRO, redirect: "manual" });
    assert.equal(talkBro.status, 303, "a browser is sent back");
    assert.equal(talkBro.headers.get("location"), `/buttons/${KEY}/tv?room=pro-plus`);
    const aboutApp = await (await call(e, `${KEY}/tv/about?room=pro-plus`, APP)).text();
    const aboutBro = await (await call(e, `${KEY}/tv/about?room=pro-plus`, BRO)).text();
    assert.ok(aboutApp.includes("held on Talk") && aboutApp.includes('<span class="k">Guide held</span>'));
    assert.ok(!aboutBro.includes("held on Talk") && !aboutBro.includes('<span class="k">Guide held</span>'), "a browser is told of no Talk keys");
  } finally { f.restore(); }
});

test("Talk on the TV carries every element Talk's script reads, the TV's room, and the script with Guide's hold", async () => {
  const { renderTvTalk } = await import("../tvpages.js");
  const html = renderTvTalk({ base: "/b/k", room: PRO, devices: ["Pro Plus", "Ultra"], used: 3, usedSec: 180, cap: 60 });
  for (const id of ["hold", "hangup", "tstate", "meter", "minutes", "talkdev", "tspk", "voice", "you", "desk"]) {
    assert.ok(html.includes(`id="${id}"`), `#${id}`);
  }
  assert.match(html, /<main class="tvd talk" data-phase="rest" data-preopen="1" data-level="1" data-base="\/b\/k" data-room="Pro Plus" data-idle="30000" data-beat="30000" data-rate="5">/, "the TV opens the line with the screen and shows the voice level");
  assert.match(html, /<p class="vsum tvsound" hidden>The music goes quiet while Talk is open, and comes back when you hang up\.<\/p>/);
  assert.match(html, /<option selected>Pro Plus<\/option><option>Ultra<\/option>/, "the TV page's room");
  assert.ok(html.includes('href="/b/k/tv?room=pro-plus">'), "Home goes back to the TV page's room");
  assert.ok(html.includes("3 of 60 minutes today · about $0.15"));
  assert.ok(html.includes("Quick commands without Talk: press Guide on any other screen"));
  assert.ok(html.includes("window.fmwaxGuide = function (down)"));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const sc of scripts) assert.doesNotThrow(() => new vm.Script(sc));
});

// A SONG THAT STOPPED IS STILL SHOWN (the owner, 2026-11-19: "I miss the now
// playing icon ... I can't scroll down to the song bar"): the note stays and
// the bar's cover can be reached; with no song at all, both rest as before.
test("a stopped or paused song keeps the note and a cover the remote can reach; nothing at all does not", () => {
  const stopped = { state: "quiet", lan: { hands: true, at: 1, speakers: { "Pro Plus": { state: "stop", source: "Spotify", track: "Good Old Music", artists: "Funkadelic" } } } };
  const b = tvBand(stopped, PRO, 3_000);
  assert.equal(b.tone, "off");
  assert.equal(b.still, true);
  assert.equal(b.line3, "Stopped · Pro Plus · Spotify");
  const html = renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: stopped, readings: {} });
  assert.ok(!/class="room now"[^>]*hidden/.test(html), "the note stays");
  assert.ok(!/class="sleeve"[^>]*disabled/.test(html), "the bar's cover can be reached");
  const none = renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: { state: "quiet" }, readings: {} });
  assert.ok(/class="room now"[^>]*hidden/.test(none) && /class="sleeve"[^>]*disabled/.test(none), "nothing to show: as before");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.includes("function look(b) { return !!b && (b.tone !== \"off\" || !!b.still); }"));
  assert.doesNotThrow(() => new vm.Script(script));
});

// BACK IN THE FMWAX TV APP (the owner, 2026-11-19): the app asks the page
// first; an open view closes, and only the buttons let Back leave the page.
test("the TV page answers the app's Back: an open view closes, the buttons say no", () => {
  const html = renderTv({ base: "/b/k", rooms: [PRO], room: PRO, now: { state: "quiet" }, readings: {} });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.includes('window.fmwaxBack = function () {\n    if (view === "ctl") return false;'));
  assert.ok(script.includes('open(view === "dis" ? "ctl" : "back");\n    return true;'));
});

// ABOUT FMWAX (the owner, 2026-11-19): its own screen from the logo.
test("About fmwax: the version, what is connected, the remote's keys, more help; the app's facts filled by its script", async () => {
  const { renderTvAbout } = await import("../tvpages.js");
  const html = renderTvAbout({ base: "/b/k", room: PRO, talk: true,
    version: "This house runs the version of 19 November 2026 (code 2d94c93). GitHub has the version of 18 November 2026 (code 11111b1), 40 changes behind.",
    rows: [{ label: "Home helper", state: "On", tone: "on", more: "hears and presses the WiiMs" }, { label: "Talk", state: "3 of 60 min", more: "used today" }] });
  assert.ok(html.includes("<p>This house runs the version of 19 November 2026 (code 2d94c93).</p><p>GitHub has the version of 18 November 2026 (code 11111b1), 40 changes behind.</p>"));
  assert.ok(html.includes('<dt>Home helper</dt><dd><span class="on">On</span> · hears and presses the WiiMs</dd>'));
  assert.ok(html.includes('<dt>Talk</dt><dd><b>3 of 60 min</b> · used today</dd>'));
  assert.ok(html.includes('<span class="k">Guide held</span>'), "the remote's keys");
  assert.ok(html.includes('href="/b/k/tv?room=pro-plus" data-home>'), "Home, in hand");
  assert.ok(html.includes("Voice on the TV") && html.includes("House rules"));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.includes("fmwaxTV\\/([0-9]"), "the app's version from its user agent");
  assert.doesNotThrow(() => new vm.Script(script));
});

// A SONG'S FACTS, NOT WITHOUT END (the review, 2026-11-19).
test("the TV's song lookups are counted by the hour: ninety, then none until the next hour", async () => {
  const { songLookupAllowed } = await import("../routes.js");
  const T = 5_000 * 3_600_000 + 1;
  let yes = 0;
  for (let i = 0; i < 200; i++) if (songLookupAllowed(T + i)) yes += 1;
  assert.equal(yes, 90);
  assert.equal(songLookupAllowed(T + 3_600_000), true, "a new hour begins again");
});

test("a song with little said of it: Last.fm's words on the song and the artist's story are added, once, and never under a full article", async () => {
  const { tidyLastfm, mainTextOf, THIN } = await import("../songextra.js");
  const bio = "Darondo, who sang Legs, was a soul singer from the San Francisco Bay Area, who made three singles in the early 1970s and then left music for decades. " +
    "He opened for James Brown, drove a white Rolls-Royce, and was found again by collectors in the 2000s.";
  assert.equal(tidyLastfm(`${bio} <a href="https://www.last.fm/music/Darondo">Read more on Last.fm</a>. User-contributed text is available under the Creative Commons By-SA License; additional terms may apply.`), bio);
  assert.equal(tidyLastfm("There are at least three artists with this name: 1) a band from Leeds that made one single in 1979 and then stopped playing altogether for good. 2) another band."), "", "a list of acts of one name is no story");
  assert.equal(tidyLastfm("A short line."), "", "too short to be a block");
  assert.equal(tidyLastfm("At least four artists exist by this name on last.fm: 1) Madness are a British pop and ska band from Camden Town, who formed in 1976 and had a long run of hit singles through the early eighties and after."), "");
  assert.ok(tidyLastfm("Breakestra is a band whose name comes from breaks, formed in Los Angeles by Miles Tackett in 1996 as a ten-piece funk orchestra that played the records hip-hop sampled, live and in one long set."), "a band telling of its own name is a story");
  assert.ok(tidyLastfm(`${bio}\n\n${bio} ${bio} ${bio}`, 400).length <= 401, "held to a length");
  assert.equal(mainTextOf({ albumWiki: { text: "about the album" } }, { about: "genius" }), "about the album");
  assert.equal(mainTextOf(null, { about: "genius" }), "genius");

  const e = { ...env(), ARTIST_LOOKUP: "on", LASTFM_KEY: "0123456789abcdef0123", __mbSleep: async () => {} };
  const original = globalThis.fetch;
  const asked = [];
  let songArticle = null;
  globalThis.fetch = async (u) => {
    const url = String(u);
    asked.push(url);
    if (url.includes("musicbrainz.org/ws/2/recording?")) return Response.json({ recordings: songArticle ? [{ id: "rec-1", score: 100 }] : [] });
    if (url.includes("musicbrainz.org/ws/2/recording/rec-1")) return Response.json({ id: "rec-1", relations: [{ "target-type": "work", type: "performance",
      work: { title: "Legs", relations: [{ "target-type": "url", url: { resource: "https://www.wikidata.org/wiki/Q7" } }] } }] });
    if (url.includes("musicbrainz.org/ws/2/artist?")) return Response.json({ artists: [{ id: "art-1", score: 100, name: "Darondo" }] });
    if (url.includes("musicbrainz.org/ws/2/artist/art-1")) return Response.json({ relations: [{ url: { resource: "https://www.wikidata.org/wiki/Q1" } }] });
    if (url.includes("wikidata.org") && url.includes("ids=Q1")) return Response.json({ entities: { Q1: { sitelinks: { enwiki: { title: "Darondo" } } } } });
    if (url.includes("wikidata.org") && url.includes("ids=Q7")) return Response.json({ entities: { Q7: { sitelinks: { enwiki: { title: "Legs (song)" } } } } });
    if (url.includes("wikipedia.org/api/rest_v1/page/summary/Darondo")) return Response.json({ type: "standard", title: "Darondo",
      extract: "William Daron Pulliam, known as Darondo, was an American funk and soul singer from the San Francisco Bay Area.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Darondo" } } });
    if (url.includes("wikipedia.org/api/rest_v1/page/summary/Legs")) return Response.json({ type: "standard", title: "Legs (song)", extract: songArticle,
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Legs_(song)" } } });
    if (url.includes("audioscrobbler.com") && url.includes("track.getInfo")) return Response.json({ track: { wiki: { content: `${bio} <a href="https://www.last.fm/music/Darondo/_/Legs">Read more on Last.fm</a>.` } } });
    if (url.includes("audioscrobbler.com") && url.includes("artist.getInfo")) return Response.json({ artist: { name: "Darondo", bio: { content: bio } } });
    return new Response("{}", { status: 404 });
  };
  try {
    const at = (t) => `${KEY}/tv/song?uri=x&t=${encodeURIComponent(t)}&a=Darondo`;
    const a = await (await call(e, at("Legs"))).json();
    assert.equal(a.facts, null, "nothing known of the song itself");
    assert.equal(a.extra.song.text, bio, "Last.fm's words on the song");
    assert.deepEqual({ name: a.extra.artist.name, from: a.extra.artist.from, wiki: a.extra.artist.wiki }, { name: "Darondo", from: "lastfm", wiki: "Darondo" });
    assert.equal(a.extra.artist.text, bio, "Wikipedia's opening is one line: Last.fm's longer story, the article kept for More");
    // Another song of the artist: the artist is not asked for again.
    await call(e, at("Didn't I"));
    assert.equal(asked.filter((x) => /musicbrainz\.org\/ws\/2\/artist|artist\.getInfo/.test(x)).length, 3, "the artist's story is kept");
    assert.equal(asked.filter((x) => x.includes("track.getInfo")).length, 2, "each song's own text is asked once");
    // A song with an article of its own gets nothing added.
    songArticle = `"Legs" is a song. ${"It has a long article of its own on Wikipedia, with a full opening paragraph. ".repeat(6)}`;
    assert.ok(songArticle.length >= THIN);
    const full = await (await call(e, at("Legs Again"))).json();
    assert.ok(full.facts?.wiki?.text, "the song's own article");
    assert.equal(full.extra, null, "nothing added under a full text");
  } finally { globalThis.fetch = original; }
});

test("the artist's story is Last.fm's when Wikipedia has none, and a house with no Last.fm key asks it nothing", async () => {
  const { artistNote, songExtra } = await import("../songextra.js");
  const bio = "The Vibrettes were a girl group from Los Angeles who cut one two-part single for Lujon Records in 1973, a funk 45 that became a favourite of crate diggers and breakbeat collectors.";
  const original = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u) => {
    const url = String(u); asked.push(url);
    if (url.includes("musicbrainz.org/ws/2/artist?")) return Response.json({ artists: [{ id: "art-2", score: 60, name: "Vibrators" }] });
    if (url.includes("artist.getInfo")) return Response.json({ artist: { name: "The Vibrettes", bio: { content: bio } } });
    if (url.includes("track.getInfo")) return Response.json({ error: 6, message: "Track not found" });
    return new Response("{}", { status: 404 });
  };
  try {
    const e = { ...env(), ARTIST_LOOKUP: "on", LASTFM_KEY: "0123456789abcdef0123", __mbSleep: async () => {} };
    assert.deepEqual(await artistNote(e, "The Vibrettes"), { name: "The Vibrettes", text: bio, from: "lastfm" });
    const none = { ...env(), ARTIST_LOOKUP: "on", __mbSleep: async () => {} };
    asked.length = 0;
    assert.equal(await songExtra(none, { title: "Humpty Dump", artist: "The Vibrettes" }), null);
    assert.ok(!asked.some((x) => x.includes("audioscrobbler")), "no key, no call");
  } finally { globalThis.fetch = original; }
});

test("the TV's About this song draws the added blocks under their own labels", async () => {
  const src = await (await import("node:fs/promises")).readFile(new URL("../tv.js", import.meta.url), "utf8");
  assert.ok(src.includes('"About the artist"') && src.includes("About the song, from Last.fm"));
  assert.ok(src.includes("From Last.fm, written by its listeners."));
});
