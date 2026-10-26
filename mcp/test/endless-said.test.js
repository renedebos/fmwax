// ENDLESS, SAID (the owner, 2026-10-13): pressing a house DJ's preset plays
// it endless, and nothing said so. Three places now say the word — the now
// bar ("preset 7, Americana · endless"), the speaker's block on the Speakers
// page ("From preset 7 (Americana) · endless") and the DJ's own page
// ("Playing endless on preset 7 · Pro Plus") — for the house DJs' presets
// and the guest DJ's lane, by the server's flag (endlessNamed). Never for
// Requests, the archive, the household's own presets, or Spotify's own pick
// past the end of a list.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { barWords, spotifyRest } from "../programs.js";
import { makeEnv, installFetch, track } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const { endlessUpdate, endlessLaneTakeover, parseEndless } = __test;
const KEY = "abcdefabcdefabcdefabcdef";
const SECRET = "helper-secret-000000000000";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const GS = "GUESTSPOTIFY0000000001", LANE = "SAMPLEPLAYLIST00000018";

// The house as it stands: Requests on 1, the lane on 3, the archive on 6,
// Americana on 7 and Vibe on 9 endless, and a household playlist on 10.
function env() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" });
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: GS, catalog: "spotify" },
    { button: 6, archive: true }]);
  e.PLAYLIST_ALIASES = JSON.stringify({ replay: P(90), "was button 10 spotify": P(10) });
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 7, dj: "americana", playlist: P(7) }, { button: 9, dj: "vibe", playlist: P(9) },
    { button: 3, lane: true, playlist: LANE }] });
  return e;
}
// What the Pro Plus holds, as a phone last read it.
const READ = [[1, "Requests · Spotify", "Spotify"], [3, "Endless", "Spotify"], [6, ARCHIVE.name, "Web stream"],
  [7, "Americana", "Spotify"], [9, "Vibe", "Spotify"], [10, "Sunday Morning", "Spotify"]]
  .map(([btn, name, source]) => ({ btn, name, source, saved: null }));
const readPro = (e) => e.PROGRAMS.put("reading:pro-plus", JSON.stringify({ at: new Date().toISOString(), speaker: "Pro Plus", presets: READ }));
// Spotify's player on `player.now`; a pause stops it.
function spotify(player) {
  const f = installFetch({ contents: [track("a")] });
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      const p = player.now;
      if (!p) return new Response(null, { status: 204 });
      return Response.json({ is_playing: true, device: { name: p.device ?? "Pro Plus", id: "d1" },
        context: { uri: `spotify:playlist:${p.pid}` }, progress_ms: 0,
        item: { uri: "spotify:track:cs", name: "Cold Sweat", artists: [{ name: "James Brown" }] } });
    }
    if (url.pathname === "/v1/me/player/pause") player.now = null;
    return inner(u, init);
  };
  return () => { globalThis.fetch = inner; f.restore(); };
}
const page = async (e, path) => (await worker.fetch(new Request(`https://x.test${path}`), e)).text();
const playing = async (e) => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).json();
// The Pro Plus's block on the Speakers page, and what its meta line says.
const proMeta = (html) => {
  const block = html.slice(html.indexOf('data-speaker="Pro Plus"'), html.indexOf('data-speaker="Ultra"'));
  return block.match(/<span class="smeta">([^<]*)<\/span>/)?.[1] ?? null;
};

test("a house DJ's endless preset says endless: the bar, the Speakers block and the DJ's page, playing and paused", async () => {
  const player = { now: null };
  const restore = spotify(player);
  try {
    const e = env();
    await readPro(e);
    assert.match(await page(e, `/buttons/${KEY}/americana`), /<p class="vload"><span class="vtag">House DJ · preset 7 · not playing<\/span><\/p>/,
      "not playing: said once (A DJ's Page, Calmer, 2026-10-24)");
    player.now = { pid: P(7) };
    const o = await playing(e);
    assert.equal(o.preset.endless, true, "the server's flag");
    assert.equal(o.speakerPreset.endless, true, "and on the Speakers page's own field");
    assert.equal(barWords(o).two, "Pro Plus · preset 7, Americana · endless");
    const spk = await page(e, `/buttons/${KEY}/wiim`);
    assert.match(spk, /<span class="nb2">Pro Plus · preset 7, Americana · endless<\/span>/, "the bar, filled at paint");
    assert.equal(proMeta(spk), "From preset 7 (Americana) · endless");
    const dj = await page(e, `/buttons/${KEY}/americana`);
    assert.match(dj, /<p class="vload"><span class="vtag"><span class="plv" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span>House DJ · preset 7 · (?:playing endless|endless until [^·<]+)<span data-djdev="americana"> · Pro Plus<\/span><\/span><\/p>/);
    // Paused from the bar: the note keeps the flag, and the key no longer
    // rides on the name ("The Selector · the-selector", found 2026-10-13).
    const r = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, { method: "POST",
      headers: { accept: "application/json", origin: "https://x.test" }, body: new URLSearchParams({ do: "pause", device: "Pro Plus" }) }), e)).json();
    assert.equal(r.code, "ok");
    assert.equal(barWords({ state: "quiet", paused: r.paused }).two, "Pro Plus · preset 7, Americana · endless");
    assert.equal(barWords(await playing(e)).two, "Pro Plus · preset 7, Americana · endless", "and on the next read");
    const held = await page(e, `/buttons/${KEY}/wiim?tp=ok&tdo=pause&ton=pro-plus`);
    assert.equal(proMeta(held), "From preset 7 (Americana) · endless", "the paused block");
    // The Speakers page's poll says it from the same fields.
    assert.ok(spk.includes('function ends(pr) { return pr && pr.endless && !pr.autoplay ? " · endless" : ""; }'));
    assert.ok(spk.includes('"From preset " + stopped.preset.btn + " (" + stopped.preset.name + ")" + ends(stopped.preset)'), "paused");
    assert.ok(spk.includes('o.speakerPreset.btn + " (" + o.speakerPreset.name + ")" + ends(o.speakerPreset)'), "playing");
    assert.ok(spk.includes('"From preset " + sr.preset.btn + " (" + sr.preset.name + ")") + ends(sr.preset)'), "stopped, as the helper read it");
  } finally { restore(); }
});

test("the guest DJ's lane on 3 says endless too", async () => {
  const player = { now: null };
  const restore = spotify(player);
  try {
    const e = env();
    await readPro(e);
    await endlessUpdate(e, (st) => {
      const r = endlessLaneTakeover(e, parseEndless(e), st, { dj: "hank", now: Date.now() });
      if (r.ok && st.lane) st.lane.ready = true;
      return r.ok ? r : { abort: true, ...r };
    });
    player.now = { pid: LANE };
    const o = await playing(e);
    assert.equal(o.preset.endless, true);
    assert.equal(barWords(o).two, "Pro Plus · Guest DJ · Hank · endless");
    const spk = await page(e, `/buttons/${KEY}/wiim`);
    // As the poll names it, not the speaker's saved "Endless" ("Endless · endless").
    assert.equal(proMeta(spk), "From Guest DJ · Hank · endless");
    const dj = await page(e, `/buttons/${KEY}/hank`);
    assert.match(dj, /<\/span>Guest DJ · preset 3 · (?:playing endless|endless until [^·<]+)<span data-djdev="hank"> · Pro Plus<\/span><\/span><\/p>/);
    assert.match(dj, /<select class="devsel" id="enddev" name="device" form="endfresh" data-pick data-dj="hank" aria-label="Speaker to play on">/,
      "a pick while Hank plays moves him (2026-10-24)");
  } finally { restore(); }
});

test("a WiiM stopped on an endless preset, as the helper read it, says endless; Requests stopped does not", async () => {
  const restore = spotify({ now: null });
  try {
    const e = env();
    e.HELPER_SECRET = SECRET;
    await readPro(e);
    const send = (speakers) => worker.fetch(new Request("https://x.test/helper/reading", { method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ speakers }) }), e);
    await send([{ name: "Pro Plus", state: "stop", source: "Spotify", playlist: P(9), track: "Cold Sweat" }]);
    const o = await playing(e);
    assert.deepEqual(o.lan.speakers["Pro Plus"].preset, { btn: 9, name: "Vibe", endless: true });
    assert.equal(barWords(spotifyRest(o.lan.speakers["Pro Plus"], "Pro Plus")).two, "Pro Plus · preset 9, Vibe · endless");
    assert.equal(proMeta(await page(e, `/buttons/${KEY}/wiim`)), "From preset 9 (Vibe) · endless");
    await send([{ name: "Pro Plus", state: "stop", source: "Spotify", playlist: GS, track: "Cold Sweat" }]);
    const req = await playing(e);
    assert.equal(barWords(spotifyRest(req.lan.speakers["Pro Plus"], "Pro Plus")).two, "Pro Plus · preset 1, Requests · Spotify");
    assert.equal(proMeta(await page(e, `/buttons/${KEY}/wiim`)), "From preset 1 (Requests · Spotify)");
  } finally { restore(); }
});

test("never on Requests (1), the archive (6) or the household's own preset (10)", async () => {
  const player = { now: null };
  const restore = spotify(player);
  try {
    const e = env();
    await readPro(e);
    for (const [pid, bar, meta] of [
      [GS, "Pro Plus · preset 1, Requests · Spotify", "From preset 1 (Requests · Spotify)"],
      [P(10), "Pro Plus · preset 10, Sunday Morning", "From preset 10 (Sunday Morning)"],
    ]) {
      player.now = { pid };
      const o = await playing(e);
      assert.equal(o.preset.endless, undefined, pid);
      assert.equal(barWords(o).two, bar);
      const spk = await page(e, `/buttons/${KEY}/wiim`);
      assert.match(spk, new RegExp(`<span class="nb2">${bar}</span>`));
      assert.equal(proMeta(spk), meta);
    }
    // The archive is not Spotify: the helper's word names it, and no preset words at all.
    e.HELPER_SECRET = SECRET;
    player.now = null;
    await worker.fetch(new Request("https://x.test/helper/reading", { method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ speakers: [{ name: "Pro Plus", state: "play", source: "Web stream", track: "House Tapes 12" }] }) }), e);
    const spk = await page(e, `/buttons/${KEY}/wiim`);
    const block = spk.slice(spk.indexOf('data-speaker="Pro Plus"'), spk.indexOf('data-speaker="Ultra"'));
    assert.match(block, /Playing now · Web stream/);
    assert.ok(!/endless/i.test(block.replace(/<section class="holds"[\s\S]*$/, "")), "no word on the archive's block");
    // And a request set paused from the bar names its DJ as before, no word.
    assert.equal(barWords({ state: "quiet", paused: { track: "X", device: "Ultra", preset: { btn: 1, name: "Requests · Spotify", dj: "Hank" } } }).two,
      "Ultra · preset 1, Requests · Hank");
  } finally { restore(); }
});
