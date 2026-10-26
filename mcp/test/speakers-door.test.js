// THE SPEAKERS PAGE OF A DOOR-MADE HOUSE (MC-31, the trial's finding 12,
// 2026-10-17): a house with no WiiM addresses showed only what was playing
// and called the Pro Plus "not a WiiM". Its speakers are the ones chosen at
// setup, and its keys the house's own Spotify presets, played over Spotify
// Connect with nothing read from the speaker.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { makeEnv, installFetch, track } from "./harness.js";
import { barWords } from "../programs.js";
import { barSpeakers } from "../now.js";

const KEY = "abcdefabcdefabcdefabcdef";
const GS = "REQUESTSPOTIFY00000001";
const P = (n) => `ENDLESSPLAYLIST000000${n}`;
function doorHouse(over = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  delete e.WIIM_SPEAKERS;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: GS, catalog: "spotify" }]);
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 2, dj: "vibe", playlist: P(2), hours: 4 }, { button: 3, lane: true, playlist: P(3), hours: 4 }] });
  return Object.assign(e, over);
}
const get = (p) => new Request(`https://x.test${p}`);
const post = (p, body) => new Request(`https://x.test${p}`, { method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" }, body });
function playBodies() {
  const bodies = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (String(u).includes("/me/player/play")) bodies.push(JSON.parse(init.body ?? "{}"));
    return inner(u, init);
  };
  return { bodies, restore: () => { globalThis.fetch = inner; } };
}

test("a door-made house's Speakers page: the speakers chosen at setup, each with the house's own presets to play", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/wiim`), doorHouse())).text();
    assert.match(html, /data-speaker="Pro Plus"/);
    assert.match(html, /data-speaker="Ultra"/);
    // Version A (the owner, 2026-10-17): the presets as rows that say what each holds, Loaded folded in.
    for (const [n, eye, name] of [[1, "Requests", "Requests"], [2, "House DJ · endless", "Vibe"], [3, "Guest DJ · endless", "Nobody yet"]]) {
      assert.match(html, new RegExp(`class="pact"><input type="hidden" name="btn" value="${n}"><input type="hidden" name="device" value="Ultra">`));
      assert.match(html, new RegExp(`<span class="pnum">${n}</span><span class="pbody"><span class="peye">${eye}</span><span class="pname">${name}</span>`));
    }
    assert.doesNotMatch(html, /name="btn" value="4"/, "only the house's own presets");
    assert.match(html, /<h2 class="khead">The house(&#39;|')s presets<\/h2>/);
    assert.match(html, /Tap a preset to play it on the Ultra/);
    assert.doesNotMatch(html, /<span>Loaded<\/span>/, "no Loaded tab: its presets are here");
    assert.doesNotMatch(html, /is not a WiiM, so it has no presets here/);
    assert.doesNotMatch(html, /Read the speakers/, "no phone shortcut for a house with no WiiM addresses");
  } finally { f.restore(); }
});

test("a door-made house's key plays the house's playlist on the speaker named, and comes back with its flash", async () => {
  const f = installFetch({ contents: [track("a")] });
  const cap = playBodies();
  try {
    const e = doorHouse();
    const r = await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=2&device=Pro+Plus"), e);
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), new RegExp(`^/buttons/${KEY}/wiim\\?kp=\\w+&k=2&kon=pro-plus$`));
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${P(2)}`);
    await worker.fetch(post(`/buttons/${KEY}/preset/play`, "btn=1&device=Pro+Plus"), e);
    assert.equal(cap.bodies.at(-1).context_uri, `spotify:playlist:${GS}`, "the Requests preset, with no name read to check");
    const back = await worker.fetch(get(r.headers.get("location")), e);
    assert.equal(back.status, 200);
    const sent = cap.bodies.length;
    const refused = async (body, words) => {
      const x = await worker.fetch(post(`/buttons/${KEY}/preset/play`, body), e);
      assert.equal(x.status, 400, body);
      assert.match(await x.text(), words, body);
      assert.equal(cap.bodies.length, sent, `${body}: nothing was sent`);
    };
    await refused("btn=5&device=Ultra", /no Spotify playlist on preset 5/);
    await refused("btn=2&device=Kitchen", /is not one of this house(&#39;|')s speakers \(Pro Plus, Ultra\)/);
  } finally { cap.restore(); f.restore(); }
});

test("a door-made house says the way back where the bar's play stays dim: a preset, or the remote", async () => {
  // A pause from the remote reads "Not on Spotify" and the bar's play stays
  // dim (the 2026-09-22 rule, kept); the owner asked that the way back be said.
  assert.equal(barSpeakers(doorHouse()).ownKeys, true);
  const owners = makeEnv();
  owners.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57" });
  assert.equal(barSpeakers(owners).ownKeys, undefined, "a house with WiiM addresses reads its speakers instead");
  assert.equal(barWords({ state: "quiet", speaker: "Ultra", other: true, keys: true }).two,
    "Tap a preset on Speakers, or press play on the remote");
  assert.equal(barWords({ state: "quiet", speaker: "Ultra", other: true }).two, "Quiet, or playing something that is not Spotify");
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/wiim`), doorHouse())).text();
    assert.match(html, /data-speaker="Ultra"[^>]*data-quiet="Not on Spotify right now\. Tap a preset below to play it here\."/);
    assert.match(html, /&quot;ownKeys&quot;:true/, "the bar's answer carries it for the script");
  } finally { f.restore(); }
});

test("a door-made house shows its WiiMs, named at setup, and not every speaker it keeps", async () => {
  const e = doorHouse({ ROOM_DEVICES: JSON.stringify(["Pro Plus", "Ultra", "Living Room"]), WIIM_NAMES: JSON.stringify(["Pro Plus", "Ultra"]) });
  assert.deepEqual(barSpeakers(e).speakers.map((x) => x.name), ["Pro Plus", "Ultra"]);
  assert.deepEqual(barSpeakers(e).others.map((x) => x.name), ["Living Room"]);
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/wiim`), e)).text();
    assert.match(html, /data-speaker="Pro Plus"/);
    assert.match(html, /data-speaker="Ultra"/);
    assert.doesNotMatch(html, /data-speaker="Living Room"/, "another speaker only while it plays");
  } finally { f.restore(); }
});

test("a door-made house's Speakers page explains its own keys, and says nothing of a helper it never ran", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/wiim`), doorHouse({ HELPER_SECRET: "every-claimed-house-has-one" }))).text();
    assert.match(html, /the keys below are the house(&#39;|')s own presets/);
    assert.match(html, /A speaker switched off can read as playing for a while/);
    assert.doesNotMatch(html, /its own twelve presets/);
    assert.doesNotMatch(html, /class="help pagehelp hmark/, "no house mark on a house that never ran one");
    assert.doesNotMatch(html, />What the speakers hold</);
  } finally { f.restore(); }
});

test("version A: the row playing here pauses, says whose set and how long; Core alone invites the Endless DJs", async () => {
  const f = installFetch({ contents: [track("a"), track("b"), track("c")] });
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.spotify.com" && url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return Response.json({ is_playing: true, progress_ms: 1000, device: { name: "Ultra", id: "ultra-id", type: "AVR" },
        context: { uri: `spotify:playlist:${GS}` }, item: { name: "Dreams", uri: "spotify:track:0000000000000000000002", duration_ms: 200000,
          artists: [{ name: "Fleetwood Mac" }], album: { name: "Rumours", images: [] } } });
    }
    return inner(u, init);
  };
  try {
    const e = doorHouse({ SETUP_KEY: "setup-key-0123456789abcdef", ROOM_DEVICES: JSON.stringify(["Ultra"]), DEFAULT_DEVICE: "Ultra" });
    delete e.ENDLESS;
    await e.PROGRAMS.put(`on:${GS}`, JSON.stringify({ dj: "vibe", ref: "replace", at: new Date().toISOString() }));
    const html = await (await worker.fetch(get(`/buttons/${KEY}/wiim`), e)).text();
    assert.match(html, /<li class="prow on"><span class="pnum">1<\/span><span class="pbody"><span class="peye">Requests<\/span><span class="pname">Vibe<\/span><span class="pmeta">3 tracks · [^<]*loaded [^<]* · playing<\/span>/);
    assert.match(html, /action="\/buttons\/[^"]+\/wiim\/transport" class="pact"><input type="hidden" name="do" value="pause"><input type="hidden" name="device" value="Ultra">/);
    assert.match(html, /<li class="prow invite"><a href="\/setup">[\s\S]*Endless DJs: a house DJ and the guest DJ\. <b>Set them up<\/b>/);
  } finally { globalThis.fetch = inner; f.restore(); }
});
