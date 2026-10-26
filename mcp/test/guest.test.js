// THE GUEST PRESETS, stage 1 (MC-18, tasks/done/mc18-guest-presets.md): two slots
// nobody holds, one per service, named in BUTTONS with a playlist behind each
// and a `live` gate in front. At this stage nothing routes a set to them and
// nothing writes to them — the household is saving them on the speakers —
// so what these pin is the shape, the gate, the legacy aliases that keep the
// old playlists' backups restorable, and that every page tells the truth
// about a preset that is a guest and not yet live.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, installTidalFetch, track, putTile } from "./harness.js";
import { station } from "../station.js";
import { PERSONAS } from "../djs.js";

const {
  callTool, parseButtons, house, parseAliases, guestFor, guestForPlaylistId, legacyAliasFor,
  replacePlaylistSafely, snapshotPlaylist, undoToSnapshot, listSnapshots,
  flashFor, anyLiveGuest, refireWaiting,
  setService, destinationFor, placeOf, liveGuests, findDj,
} = __test;

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
// The guests' playlists, in each service's own shape; nothing here is the
// real house's id, so a test cannot depend on house.json.
const GS = "GUESTSPOTIFY0000000001";
const GT = "0b1f2c3d-aaaa-bbbb-cccc-000000000002";
const SINCE = "2026-09-07T06:47:41.466Z";

const guest = (over = {}) => ({
  button: 1, guest: true, live: false, name: "DJ Guest", playlist: GS, catalog: "spotify", ...over,
});
const tidalGuest = (over = {}) => ({
  button: 2, guest: true, live: false, name: "DJ Guest · Tidal", playlist: GT, catalog: "tidal", ...over,
});

// This suite's house: the two guests on 1 and 2, Pub Rock on 3, the
// archive on 6, Soul installed on 7 (Nightside until the merges,
// 2026-10-13; the Professor on 3 and the Selector on 7 until the owner cut
// them, 2026-10-15, when Dr. Funkenstein took Monk's part as the DJ with no
// preset and Gatefold Camille's); the wall says Morning took 7 and —
// from before the buttons became guests — that Dr. Funkenstein was on 1 and
// Gatefold on 2. The old playlists are the legacy aliases.
function houseEnv(over = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([
    guest(), tidalGuest(),
    { button: 3, dj: "pub-rock", playlist: P(3) },
    { button: 6, archive: true },
    { button: 7, dj: "soul", playlist: P(7) },
  ]);
  e.PLAYLIST_ALIASES = JSON.stringify({ replay: P(9), "was button 1": P(1), "was button 2": P(2) });
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57", Ultra: "192.168.4.78" });
  return Object.assign(e, over);
}

const get = (p) => new Request(`https://x.test${p}`);
const post = (p, body, headers = {}) => new Request(`https://x.test${p}`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });
const b = () => ({ remaining: 40 });
const uris = (...ids) => ids.map((id) => `spotify:track:${id}`);

// ------------------------------------------------------------ the parse

test("a guest button is parsed with its name, its gate, its service and no tenant", () => {
  const [g] = parseButtons([guest()]);
  assert.deepEqual(g, {
    btn: 1, button: "button 1", key: null, archive: false, guest: true, live: false,
    name: "DJ Guest", catalog: "spotify", playlist: GS,
  });
  assert.equal(parseButtons([tidalGuest({ live: true })])[0].live, true);
  assert.equal(parseButtons([guest({ name: "  DJ Guest  " })])[0].name, "DJ Guest", "trimmed");
  // A DJ's entry is untouched by the guest's existence: the same six fields.
  assert.deepEqual(parseButtons([{ button: 3, dj: "pub-rock", playlist: P(3) }])[0], {
    btn: 3, button: "button 3", key: "pub-rock", archive: false, catalog: "spotify", playlist: P(3),
  });
});

test("a guest refuses a tenant, a label, the archive, a missing name or gate, a bad playlist, and a second guest on its service", () => {
  for (const [list, why] of [
    [[guest({ dj: "hank" })], /no dj, label or archive/],
    // A label is read first and refuses the guest from its own side.
    [[guest({ label: "Jazz FM" })], /a labelled button carries only "button" and "label"/],
    [[guest({ archive: true })], /no dj, label or archive/],
    [[guest({ name: "" })], /"name" must be 1 to 40 characters/],
    [[guest({ name: "x".repeat(41) })], /"name" must be 1 to 40 characters/],
    [[guest({ live: undefined })], /"live" must be true or false/],
    [[guest({ live: "false" })], /"live" must be true or false/],
    [[guest({ playlist: "" })], /"playlist" is missing/],
    [[guest({ playlist: GT })], /must be a Spotify playlist id/],
    [[guest({ catalog: "tidal" })], /must be a Tidal playlist id/],
    [[guest({ catalog: "deezer" })], /catalog "deezer" is not one of/],
    [[guest(), guest({ button: 4, playlist: P(4) })], /two guest buttons on spotify — one per service/],
    [[guest(), { button: 1, dj: "hank", playlist: P(1) }], /button 1 twice/],
  ]) {
    assert.throws(() => parseButtons(list), why, JSON.stringify(list));
  }
});

// ------------------------------------------------------------ the house

test("house() exposes the guests and seats nobody on them", () => {
  const e = houseEnv();
  const h = house(e);
  assert.deepEqual(Object.keys(h.guest).sort(), ["spotify", "tidal"]);
  assert.equal(h.guest.spotify.btn, 1);
  assert.equal(h.guest.spotify.name, "DJ Guest");
  assert.equal(h.guest.spotify.live, false);
  assert.equal(h.guest.tidal.playlist, GT);
  assert.equal(guestFor(e, "spotify").playlist, GS);
  assert.equal(guestFor(e, "tidal").name, "DJ Guest · Tidal");
  assert.equal(guestForPlaylistId(e, GS).btn, 1);
  assert.equal(guestForPlaylistId(e, GT).btn, 2);
  assert.equal(guestForPlaylistId(e, P(3)), null, "a DJ's playlist is not a guest's");
  assert.equal(guestForPlaylistId(e, null), null);
  // The guest slots on the wall: no tenant, no left-behind name, not empty.
  const one = h.buttons.find((x) => x.btn === 1);
  assert.equal(one.key, null);
  assert.equal(one.left, null);
  assert.equal(one.guest, true);
  assert.deepEqual(h.empty, [], "a guest is not a button waiting for a DJ");
  // The config seats the DJs on the slots that are not guests.
  assert.equal(h.djs["dr-funkenstein"].button, null);
  assert.equal(h.djs["soul"].button, "button 7");
  assert.equal(h.djs["pub-rock"].button, "button 3");
  // A house with no guests answers null on both, so every reader can ask.
  const plain = makeEnv();
  plain.BUTTONS = JSON.stringify([{ button: 3, dj: "pub-rock", playlist: P(3) }]);
  assert.deepEqual(house(plain).guest, { spotify: null, tidal: null });
  assert.equal(guestFor(plain, "spotify"), null);
});

test("the labels: a guest answers to its number and to its service, and a legacy alias is marked", () => {
  const e = houseEnv();
  const labels = parseAliases(e);
  assert.deepEqual(labels["button 1"], { catalog: "spotify", id: GS });
  assert.deepEqual(labels["guest on spotify"], { catalog: "spotify", id: GS });
  assert.deepEqual(labels["button 2"], { catalog: "tidal", id: GT });
  assert.deepEqual(labels["guest on tidal"], { catalog: "tidal", id: GT });
  assert.deepEqual(labels["was button 1"], { catalog: "spotify", id: P(1), legacy: true });
  assert.deepEqual(labels["was button 2"], { catalog: "spotify", id: P(2), legacy: true });
  assert.deepEqual(labels.replay, { catalog: "spotify", id: P(9) }, "an ordinary alias is not");
  assert.equal(legacyAliasFor(e, P(1)), "was button 1");
  assert.equal(legacyAliasFor(e, P(2)), "was button 2");
  assert.equal(legacyAliasFor(e, GS), null);
  assert.equal(legacyAliasFor(e, P(9)), null);
});

// ------------------------------------------------------------ the gate

test("a guest that is not live refuses every write, by alias or by number; the old cutover word opens nothing", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = houseEnv();
    for (const playlist of ["guest on spotify", "button 1", GS]) {
      await assert.rejects(
        callTool(e, "replace_playlist", { playlist, uris: uris("new") }, b()),
        /requests preset's playlist \(preset 1\), and it is not live yet/, playlist);
    }
    // MC-18's `cutover: true` let the pre-load through; it went with the
    // flip's leftovers on 2026-10-12, and is only an unknown argument now.
    await assert.rejects(
      callTool(e, "replace_playlist", { playlist: "guest on spotify", uris: uris("new"), cutover: true }, b()),
      /not live yet/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("old"), "nothing was written");
    // A live guest takes the write like any playlist (the lane is stage 2).
    const live = houseEnv();
    live.BUTTONS = JSON.stringify([guest({ live: true }), { button: 3, dj: "pub-rock", playlist: P(3) }]);
    const ok = await callTool(live, "replace_playlist", { playlist: "guest on spotify", uris: uris("live") }, b());
    assert.equal(ok.tracks, 1);
  } finally { f.restore(); }
});

test("the Tidal guest is gated the same way", async () => {
  const f = installTidalFetch();
  try {
    const e = houseEnv();
    await assert.rejects(
      callTool(e, "replace_playlist", { playlist: "guest on tidal", uris: ["tidal:track:1"] }, b()),
      /Tidal requests preset's playlist \(preset 2\), and it is not live yet/);
  } finally { f.restore(); }
});

test("append writes outside the door, so it refuses a guest itself — live or not — and points at replace", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = houseEnv();
    await assert.rejects(
      callTool(e, "append_to_playlist", { playlist: "guest on spotify", uris: uris("more") }, b()),
      /a guest holds one set at a time — read_playlist, then replace_playlist/);
    const live = houseEnv();
    live.BUTTONS = JSON.stringify([guest({ live: true }), { button: 3, dj: "pub-rock", playlist: P(3) }]);
    await assert.rejects(
      callTool(live, "append_to_playlist", { playlist: "button 1", uris: uris("more") }, b()),
      /one set at a time/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("old"));
  } finally { f.restore(); }
});

test("a legacy playlist takes no write but a restore, and its saved copies stay on the undo's allowlist", async () => {
  const f = installFetch({ contents: [track("theirs")] });
  try {
    const e = houseEnv();
    for (const tool of ["replace_playlist", "append_to_playlist"]) {
      await assert.rejects(
        callTool(e, tool, { playlist: "was button 1", uris: uris("new") }, b()),
        /is "was button 1" — a playlist this house no longer writes to, kept only so its saved copies can be put back/,
        tool);
    }
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("theirs"));
    const pl = { id: P(1), name: "Dr. Funkenstein", via: "test", catalog: "spotify" };
    await assert.rejects(
      replacePlaylistSafely(e, { pl, uris: uris("new"), budget: b() }), /no longer writes to/);
    // A backup taken while it was still a button: the undo path still reaches
    // it, because the legacy alias keeps the playlist in the membership set.
    const snap = await snapshotPlaylist(e, pl, b());
    f.state.contents = [track("later")];
    const undo = await undoToSnapshot(e, snap.key, b());
    assert.equal(undo.ok, true, JSON.stringify(undo));
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("theirs"));
    // And the tool's restore, which is the same door with the same word.
    f.state.contents = [track("later-still")];
    const keys = await listSnapshots(e, P(1));
    const out = await callTool(e, "restore_playlist",
      { playlist: "was button 1", snapshot: keys[keys.length - 1], confirm: true }, b());
    assert.equal(out.restored, 1);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("theirs"));
    // A playlist nobody labels is refused as it always was.
    const stranger = await undoToSnapshot(e, snap.key.replace(P(1), P(4)), b());
    assert.equal(stranger.ok, false);
  } finally { f.restore(); }
});

// ------------------------------------------------------------ nobody moves onto a guest

// ------------------------------------------------------------ the pages tell the truth

test("the presets page draws a guest as a band that says it is not live, with no Play and no drop", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = houseEnv();
    const res = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    const band = (n) => {
      const at = html.indexOf(`<li class="band fixed guest tall" data-btn="${n}">`);
      assert.ok(at > 0, `a guest band for ${n}`);
      return html.slice(at, html.indexOf("</li>", at));
    };
    const one = band(1);
    // Tall since stage 4 (option C): the name the remote shows as an eyebrow,
    // and, not live yet, what is being done about it.
    assert.match(one, /<span class="beyebrow" aria-hidden="true">DJ Guest<\/span><h3 class="bname"><span class="vh">DJ Guest: <\/span>Not live yet<\/h3>/);
    assert.match(one, /<span class="bsum bset">Being saved on the speakers<\/span>/);
    assert.match(one, /Sets still go to the DJs’ own presets/);
    assert.ok(!one.includes("<form"), "no Play on a guest that is not live");
    assert.ok(!one.includes("Hold a DJ"), "and no invitation to drop one");
    const two = band(2);
    assert.match(two, /<span class="beyebrow" aria-hidden="true">DJ Guest · Tidal<\/span>/);
    assert.match(two, /<span class="bsrc">Tidal<\/span>/);
    // Neither benched DJ is on the page. THE DESCRIPTION COUNTED THE ROSTER
    // until the tab became Loaded (2026-09-22) — every DJ, wall and bench —
    // on a page that has not listed a DJ since the twelve moved to Speakers.
    // It says what the page is instead, the same words in every house.
    assert.ok(!html.includes('data-dj="dr-funkenstein"'));
    assert.ok(!html.includes('data-dj="gatefold"'));
    assert.match(html, /content="The programs on the presets: whose set is on each, and since when."/);
    assert.match(html, /<b>A request preset<\/b> is nobody's/);
  } finally { f.restore(); }
});

// THE LINE UNDER THE TITLE (the owner, 2026-09-22). The tab was renamed from
// Presets to Loaded once the twelve moved to the Speakers tab and all this one
// had left was the guest spots. The owner asked the question the rename turns
// on: "what if a user only uses Spotify and no Tidal ... in that case there
// would only be one preset shown". Nothing breaks — a house with no Tidal
// guest in BUTTONS simply builds one band — but a list of one says nothing
// about itself, where a list of two shows its own shape (one per service).
// So the page says what the row IS, in words built from the live guests, and
// a house with no live guest gets no line at all: those bands say "Not live
// yet" themselves.
test("the line under Loaded names the service on each preset, and says it in the singular for a one-guest house", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const line = async (buttons) => {
      const e = houseEnv({ BUTTONS: JSON.stringify(buttons) });
      const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
      // Under the bands since 2026-09-23, in the footer above How this works.
      const at = html.indexOf('<p class="loadnote">');
      if (at >= 0) assert.ok(at > html.indexOf('<ul class="bands">'), "the line comes after the bands");
      return html.match(/<p class="loadnote">([^<]*)<\/p>/)?.[1] ?? null;
    };
    // Both services live: the shape is visible in the line as well as the page.
    assert.equal(await line([guest({ live: true }), tidalGuest({ live: true }),
      { button: 6, archive: true }]),
      // Short since 2026-09-25 (the owner: the long note "looks weird").
      "1 and 2 hold the last set you asked for, on Spotify and Tidal.");
    // Spotify and no Tidal — the owner's question. One band, and a line that
    // is a sentence about it rather than a plural over a list of one.
    assert.equal(await line([guest({ live: true }), { button: 6, archive: true }]),
      "1 holds the last set you asked for, on Spotify.");
    // Not live yet: the bands already say so, and a line saying where a set
    // lands would be a claim about presets that do not take one yet.
    assert.equal(await line([guest(), tidalGuest(), { button: 6, archive: true }]), null);
  } finally { f.restore(); }
});

test("the picker refuses a guest in words, the sheet lists it as a row nobody can take, and \"guest\" is not a DJ", async () => {
  const e = houseEnv();
  const reserved = await worker.fetch(get(`/buttons/${KEY}/guest`), e);
  assert.equal(reserved.status, 404);
  assert.match(await reserved.text(), /The guest presets are not a DJ/);
});

test("get_dj names the guest presets, their aliases, and that they are not live", async () => {
  const e = houseEnv();
  const out = await callTool(e, "get_dj", {}, b());
  assert.deepEqual(out.guest_presets, [
    { button: "button 1", name: "DJ Guest", catalog: "spotify", live: false, alias: "guest on spotify" },
    { button: "button 2", name: "DJ Guest · Tidal", catalog: "tidal", live: false, alias: "guest on tidal" },
  ]);
  assert.match(out.guest_presets_note, /nothing writes to them until the flip/);
  const plain = makeEnv();
  plain.BUTTONS = JSON.stringify([{ button: 3, dj: "pub-rock", playlist: P(3) }]);
  assert.ok(!("guest_presets" in await callTool(plain, "get_dj", {}, b())), "a house without guests says nothing of them");
});

test("a benched DJ's own page still stands, and says they are on no preset", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = houseEnv();
    await putTile(e, GS, { count: 1, runtime: "3:20", cover: null });
    const res = await worker.fetch(get(`/buttons/${KEY}/dr-funkenstein`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes("preset 1"), "nothing on his page claims preset 1");
    assert.ok(!html.includes("press 1 on the remote"));
  } finally { f.restore(); }
});

test("a configured alias cannot take a guest's label", () => {
  for (const k of ["guest on spotify", "Guest on Tidal", "guest  on   spotify"]) {
    const e = houseEnv({ PLAYLIST_ALIASES: JSON.stringify({ replay: P(9), [k]: P(4) }) });
    assert.throws(() => parseAliases(e), /a guest preset's own label/, k);
  }
});

// ------------------------------------------------ stage 2: the guest lock
//
// A request bound for a live guest locks it through its own ledger row; the
// door refuses everything else while one is being written, and records who
// is on the guest afterwards. None of it acts while no guest is live.

// Both guests live, as after the flip.
function liveEnv(over = {}) {
  return houseEnv({ BUTTONS: JSON.stringify([guest({ live: true }), tidalGuest({ live: true }),
    { button: 3, dj: "pub-rock", playlist: P(3) }, { button: 6, archive: true },
    { button: 7, dj: "soul", playlist: P(7) }]), ...over });
}
// Since stage 3 a set for a DJ on no preset reaches the live guest
// ordinarily; this was a crate on the guest's playlist before the crates went
// (stage 6), and is the house as it is now.
async function onGuestCrates(e) {
  return e;
}
// Every call made of the ledger, { op, args }, in order.
function ledgerLog(e) {
  const log = [];
  const inner = e.STATION;
  e.STATION = { ...inner, get: () => ({ fetch: async (u, init) => {
    log.push(JSON.parse(init.body));
    return inner.get().fetch(u, init);
  } }) };
  return log;
}
const BUSY_HANK = `${PERSONAS.hank.name} is being written`;

test("an ask records where its set is bound only while a live guest applies; every other ask carries none", async () => {
  const ask = (e, dj, body = "mood=trains&length=60") => worker.fetch(post(`/buttons/${KEY}/${dj}/request`, body), e);
  const rows = (e) => [...e.STATION.rows.values()];
  // A dark house has nowhere for a benched DJ's set (stage 6): refused, nothing
  // in the ledger. A DJ with a preset of their own is asked as ever, unbound.
  const dark = houseEnv({ REQUESTS_ENABLED: "true" });
  assert.match((await ask(dark, "hank")).headers.get("location"), /ask=nowhere$/);
  assert.deepEqual(rows(dark), []);
  const log = ledgerLog(dark);
  assert.match((await ask(dark, "pub-rock")).headers.get("location"), /ask=sent$/);
  assert.ok(!("destination" in log.find((c) => c.op === "submit").args));

  const live = liveEnv({ REQUESTS_ENABLED: "true" });
  for (const [dj, body] of [["hank", "mood=trains&length=60"], ["dr-funkenstein", "mood=vanguard&length=60&service=tidal"],
    ["pub-rock", "mood=disco&length=60"]]) {
    assert.match((await ask(live, dj, body)).headers.get("location"), /ask=sent$/, dj);
  }
  const by = Object.fromEntries(rows(live).map((r) => [r.dj, r.destination]));
  assert.deepEqual(by, { hank: GS, "dr-funkenstein": GT, "pub-rock": null },
    "the Spotify guest by default, the Tidal one when the form chose it, and none for a DJ who holds a preset");
});

// A DJ CUT FROM THE HOUSE (the owner cut ten, 2026-10-13, then Dutch and
// Chanson, then five on 2026-10-15) leaves requests in the ledger under their
// old keys, and the last
// set one of them put on a guest: the queue still lists them, the presets
// page still draws, and a fulfilment is refused in words with nothing written.
test("a request and a guest's set naming a DJ who was cut still list and draw, and are left for a person", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = liveEnv();
    const t = Date.now();
    await station(e, "submit", { id: "r-gone", dj: "baddie", normalized: "x", destination: GS, now: t - 2000 });
    await e.PROGRAMS.put("request:r-gone", JSON.stringify({ id: "r-gone", dj: "baddie", mood: "m", length: 40,
      avoid: null, at: "2026-09-10T00:00:00Z", keep: true }));
    await station(e, "submit", { id: "r-done", dj: "tempo", normalized: "y", now: t - 3000 });
    e.STATION.rows.get("r-done").state = "ready";
    await station(e, "submit", { id: "r-nl", dj: "dutch", normalized: "z", now: t - 4000 });
    e.STATION.rows.get("r-nl").state = "ready";
    // Monk, cut 2026-10-15 with his roll call: listed, and no slice of it.
    await station(e, "submit", { id: "r-jazz", dj: "monk", normalized: "organ trios", destination: GS, now: t - 1000 });
    await e.PROGRAMS.put(`on:${GS}`, JSON.stringify({ dj: "the-engineer", ref: "request r-old", at: new Date(t - 9000).toISOString() }));
    const q = await callTool(e, "list_requests", { states: ["pending", "ready"] }, b());
    const row = (id) => q.requests.find((r) => r.request_id === id);
    assert.equal(row("r-gone").dj, "baddie");
    assert.equal(row("r-gone").catalog, null, "no service is claimed for nobody");
    assert.ok(!("roll_call" in row("r-gone")));
    assert.equal(row("r-done").state, "ready");
    assert.equal(row("r-nl").dj, "dutch");
    assert.equal(row("r-jazz").dj, "monk");
    assert.ok(!("roll_call" in row("r-jazz")), "his roll call went with him");
    assert.ok((await callTool(e, "list_requests", {}, b())).requests.some((r) => r.request_id === "r-gone"));
    // Under the Spotify guest's band: the ask, with no name the house no longer has.
    const html = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.match(html, /<li class="bandreq">[^]*?Asked A DJ/);
    assert.ok(!/>Baddie<|>The Engineer</.test(html));
    assert.equal((await worker.fetch(get(`/buttons/${KEY}/playing`), e)).status, 200);
    await assert.rejects(callTool(e, "fulfill_request", { request_id: "r-gone", uris: uris("g1") }, b()),
      /names "baddie", which has nowhere here for a set to land — leave it for a person/);
    assert.deepEqual(f.state.contents.map((x) => x.uri), uris("old"), "nothing written");
    assert.equal(e.STATION.rows.get("r-gone").state, "pending");
    await assert.rejects(callTool(e, "fulfill_request", { request_id: "r-jazz", uris: uris("j1") }, b()),
      /names "monk", which has nowhere here for a set to land — leave it for a person/);
    assert.equal(e.STATION.rows.get("r-jazz").state, "pending");
  } finally { f.restore(); }
});

test("a fulfilment toward a busy guest is refused in words and waits; the one writing it records itself and rings the oldest one waiting", async () => {
  const f = installFetch({ contents: [track("old")] });
  // The routine's trigger, with the words each ring sent.
  const inner = globalThis.fetch, rings = [];
  globalThis.fetch = async (u, init = {}) => {
    if (!String(u).startsWith("https://api.anthropic.com/")) return inner(u, init);
    rings.push(JSON.parse(init.body).text);
    return Response.json({ type: "routine_fire" });
  };
  try {
    const e = await onGuestCrates(liveEnv({ AUTOFULFILL_ENABLED: "true",
      REQUEST_ROUTINE_ID: "trig_test", REQUEST_ROUTINE_TOKEN: "routine-token" }));
    // Three asks bound for the Spotify guest, a second apart; Hank's is being written right now.
    const t = Date.now();
    await station(e, "submit", { id: "r-hank", dj: "hank", normalized: "trains", destination: GS, now: t - 3000 });
    await station(e, "submit", { id: "r-funk", dj: "dr-funkenstein", normalized: "vanguard", destination: GS, now: t - 2000 });
    await station(e, "submit", { id: "r-late", dj: "vibe", normalized: "late", destination: GS, now: t - 1000 });
    const held = await station(e, "claim", { id: "r-hank", fingerprint: "elsewhere", destination: GS });
    assert.equal(held.ok, true);
    await assert.rejects(
      callTool(e, "fulfill_request", { request_id: "r-funk", uris: uris("m1", "m2") }, b()),
      /the Spotify guest is being written for Hank's request — leave this one; the sweep takes it\./);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("old"), "nothing was written");
    assert.equal(e.STATION.rows.get("r-funk").state, "pending");
    assert.equal(e.STATION.rows.get("r-funk").claim_count, 0);
    // The queue marks it, names who holds the guest, and tells the curator to leave it.
    const q = await callTool(e, "list_requests", {}, b());
    assert.deepEqual(q.requests.find((r) => r.request_id === "r-funk").waiting_for,
      { request_id: "r-hank", dj: PERSONAS.hank.name, guest: "the Spotify requests preset (preset 1)" });
    assert.ok(!("waiting_for" in q.requests.find((r) => r.request_id === "r-hank")));
    assert.match(q.note, /^A request carrying WAITING_FOR is bound for a guest preset/);
    // Hank's claimant hands its lease back unwritten; the next run fulfils it.
    await station(e, "release", { id: "r-hank", token: held.row.claim_token });
    const done = await callTool(e, "fulfill_request", { request_id: "r-hank", uris: uris("h1", "h2") }, b());
    assert.equal(done.status, "ready", JSON.stringify(done));
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("h1", "h2"));
    assert.equal(e.STATION.rows.get("r-hank").destination, GS);
    const on = JSON.parse(await e.PROGRAMS.get(`on:${GS}`));
    assert.deepEqual({ dj: on.dj, ref: on.ref }, { dj: "hank", ref: "request r-hank" });
    // The re-fire rings the OLDEST request waiting on that guest — Dr. Funkenstein's, not
    // the later one — as a ring again.
    assert.equal(done.rang_waiting_request, "r-funk");
    assert.deepEqual(rings, ["request r-funk (again)"]);
    // Dr. Funkenstein's claims now, and its commit rings the next one waiting.
    const next = await callTool(e, "fulfill_request", { request_id: "r-funk", uris: uris("m1", "m2") }, b());
    assert.equal(next.status, "ready", JSON.stringify(next));
    assert.equal(next.rang_waiting_request, "r-late");
    assert.deepEqual(rings, ["request r-funk (again)", "request r-late (again)"]);
    // Nobody waiting rings nobody, and nothing rings while autofulfilment is off.
    assert.equal(await refireWaiting(e, GT), null, "nobody waits on the Tidal guest");
    assert.equal(await refireWaiting({ ...e, AUTOFULFILL_ENABLED: "false" }, GS), null);
    assert.equal(rings.length, 2);
  } finally { f.restore(); }
});

test("the page's undo onto a guest being written says so in the door's words, not a bare failure", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = liveEnv();
    const first = await replacePlaylistSafely(e, { pl: { id: GS, name: "DJ Guest", via: "test", catalog: "spotify" },
      uris: uris("x"), budget: b() });
    await station(e, "submit", { id: "r-hank", dj: "hank", normalized: "trains", destination: GS });
    assert.equal((await station(e, "claim", { id: "r-hank", fingerprint: "f", destination: GS })).ok, true);
    const res = await worker.fetch(post(`/notes/${KEY}/undo`, `snapshot=${encodeURIComponent(first.snapshot.key)}`), e);
    assert.equal(res.status, 303);
    const put = new URL(res.headers.get("location"), "https://x.test").searchParams.get("put");
    assert.equal(put, "undobusy:hank:spotify");
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("x"), "nothing was put back");
    assert.equal(flashFor(put, [], new Set()), `A set for ${BUSY_HANK} to the Spotify requests preset right now; ` +
      "try again in a minute. Nothing was changed.");
  } finally { f.restore(); }
});

test("a Shelf put onto a guest being written says so in the door's words", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = await onGuestCrates(liveEnv(), ["dr-funkenstein"]);
    await e.PROGRAMS.put("program:funk-at-the-vanguard", JSON.stringify({
      slug: "funk-at-the-vanguard", dj: "dr-funkenstein", title: "Funk at the Vanguard", shape: "setlist",
      sections: [{ tracks: [{ uri: "spotify:track:m1", title: "One" }] }], playlistId: null }));
    await station(e, "submit", { id: "r-hank", dj: "hank", normalized: "trains", destination: GS });
    assert.equal((await station(e, "claim", { id: "r-hank", fingerprint: "f", destination: GS })).ok, true);
    const res = await worker.fetch(post(`/notes/${KEY}/activate`, "slug=funk-at-the-vanguard"), e);
    assert.equal(res.status, 303);
    const put = new URL(res.headers.get("location"), "https://x.test").searchParams.get("put");
    assert.equal(put, "busy:funk-at-the-vanguard:hank:spotify");
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("a"));
    assert.match(flashFor(put, [], new Set()), new RegExp(`^A set for ${BUSY_HANK} to the Spotify requests preset right now`));
  } finally { f.restore(); }
});

test("the busy flash takes nothing from the address as typed: a DJ by key, one service of two", () => {
  assert.equal(flashFor("busy:some-set:dr-funkenstein:tidal", [], new Set()),
    `A set for ${PERSONAS["dr-funkenstein"].name} is being written to the Tidal requests preset right now; try again in a minute. ` +
    "Nothing was changed.");
  assert.match(flashFor("undobusy:constructor:spotify", [], new Set()), /^A set for another request is being written/,
    "an inherited property is not a DJ");
  assert.match(flashFor("undobusy::spotify", [], new Set()), /^A set for another request/);
  assert.equal(flashFor("busy:some-set:dr-funkenstein:deezer", [], new Set()), null);
  assert.equal(flashFor("busy:some-set:<b>:spotify", [], new Set()), null);
});

test("a guest written with the owner's credential records replace; of the arguments only dj is taken (option 2, 2026-09-28)", async () => {
  const OWNER = "owner-secret-owner-secret-owner-1";
  const e = liveEnv({ MCP_SECRET: OWNER });
  const rpc = (secret, args) => new Request(`https://x.test/mcp/${secret}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "replace_playlist", arguments: args } }) });
  const forged = { playlist: "guest on spotify", dj: "hank", ref: "request r1", __via: "owner",
    holder: { dj: "hank", ref: "request r1" } };
  const onNow = async () => { const o = JSON.parse(await e.PROGRAMS.get(`on:${GS}`)); return { dj: o.dj, ref: o.ref }; };
  const f = installFetch({ contents: [track("a")] });
  try {
    const owner = await (await worker.fetch(rpc(OWNER, { ...forged, uris: uris("w"), __via: "talk" }), e)).json();
    assert.ok(!owner.result?.isError, JSON.stringify(owner).slice(0, 300));
    assert.deepEqual(await onNow(), { dj: "hank", ref: "replace" },
      "the DJ it was asked of is taken; ref, holder and an argument named __via are only arguments");
  } finally { f.restore(); }
});

// ------------------------------------------------ stage 3: the destination rewrite
//
// One lookup, destinationFor, says where a DJ's set goes: their own preset
// while they hold one, else the live guest on the set's service, else — until
// the flip — their crate. The service: the ask's choice, else the set's own
// tracks, else Spotify. Every door asks it, and none of it acts while dark.

const TIDC = "0b1f2c3d-aaaa-bbbb-cccc-000000000077";
const CRATES = { v: 1, updated: SINCE, djs: {
  hank: { spotify: { playlist: P(20) } },
  americana: { tidal: { playlist: TIDC } },
} };
async function crated(e) {
  return e;
}
// An ask as the form leaves it: a pending row and its record, a second apart.
let askAt = Date.now() - 600_000;
async function seedAsk(e, id, dj, rec = {}) {
  const s = await station(e, "submit", { id, dj, normalized: id, now: (askAt += 1000), caps: { pendingCap: 50 } });
  assert.equal(s.ok, true, `seed ${id}: ${s.code}`);
  await e.PROGRAMS.put(`request:${id}`, JSON.stringify({ id, dj, mood: "m", length: 60, avoid: null,
    at: "2026-09-10T00:00:00Z", ...rec }));
}
// A kept setlist on the shelf, on whichever service its tracks are.
const seedProgram = (e, slug, dj, trackUris) => e.PROGRAMS.put(`program:${slug}`, JSON.stringify({
  slug, dj, title: `Set ${slug}`, shape: "setlist", thesis: "t", created: "2026-09-08T10:00:00Z",
  playlistId: null, playlistName: null, tracks: trackUris.length, runtime: "3:00",
  sections: [{ heading: null, prose: [], tracks: trackUris.map((uri) => ({ uri, title: "T", artist: "A" })) }],
}), { metadata: { title: `Set ${slug}`, dj, created: "2026-09-08T10:00:00Z", shape: "setlist",
  catalog: String(trackUris[0]).split(":")[0] } });
const onOf = async (e, id) => {
  const o = JSON.parse((await e.PROGRAMS.get(`on:${id}`)) ?? "null");
  return o && { dj: o.dj, ref: o.ref };
};
const slugOf = (u) => new URL(u).pathname.split("/").pop();
const crateCalls = (f) => f.calls.filter((c) => c.includes("/me/playlists"));
const HANK = PERSONAS.hank.name;

test("the service a set is for: the ask's choice, else the set's own tracks, else Spotify", () => {
  const e = liveEnv();
  assert.equal(setService(e, { asked: "tidal", uris: uris("a") }), "tidal", "the ask wins over the tracks");
  assert.equal(setService(e, { asked: "TIDAL" }), "tidal");
  assert.equal(setService(e, { asked: "deezer", uris: ["tidal:track:1"] }), "tidal", "a choice no form offers is none");
  assert.equal(setService(e, { uris: ["tidal:track:1", "tidal:track:2"] }), "tidal", "the set's own tracks");
  assert.equal(setService(e, { uris: uris("a", "b") }), "spotify");
  assert.equal(setService(e, { uris: ["tidal:track:1", ...uris("a")] }), "spotify", "a mixed set names none: the default");
  assert.equal(setService(e, {}), "spotify", "nothing said: Spotify, the one Play reaches");
  // A house without Tidal cannot be asked for it; a Tidal-only house defaults to Tidal.
  const sp = houseEnv({ BUTTONS: JSON.stringify([guest({ live: true }), { button: 3, dj: "pub-rock", playlist: P(3) }]) });
  assert.equal(setService(sp, { asked: "tidal", uris: uris("a") }), "spotify");
  assert.equal(setService(houseEnv({ BUTTONS: JSON.stringify([tidalGuest({ live: true })]) }), {}), "tidal");
});

test("destinationFor: the DJ's own preset, else the live guest on the set's service, else nowhere", async () => {
  const live = await crated(liveEnv());
  const d = (e, dj, cat, crateCat) => destinationFor(e, findDj(e, dj), cat, crateCat);
  for (const cat of ["spotify", "tidal"]) {
    assert.deepEqual(d(live, "pub-rock", cat),
      { pl: { id: P(3), catalog: "spotify" }, alias: "button 3", guest: null }, "a preset is kept, whatever the service");
  }
  // No preset: the live guest on the set's service. A crate does not keep the set.
  const hs = d(live, "hank", "spotify");
  assert.deepEqual([hs.pl, hs.alias, hs.guest?.btn], [{ id: GS, catalog: "spotify" }, "guest on spotify", 1]);
  const ht = d(live, "hank", "tidal");
  assert.deepEqual([ht.pl, ht.alias, ht.guest?.btn], [{ id: GT, catalog: "tidal" }, "guest on tidal", 2]);
  // Dark: nowhere, since the crates went (stage 6, 2026-09-26).
  const dark = await crated(houseEnv());
  assert.deepEqual(d(dark, "hank", "spotify"), { pl: null, alias: null, guest: null });
  // The words for it.
  assert.equal(placeOf(live, findDj(live, "hank"), "spotify"), "the Spotify requests preset (preset 1)");
  assert.equal(placeOf(live, findDj(live, "hank"), "tidal"), "the Tidal requests preset (preset 2)");
  assert.equal(placeOf(live, findDj(live, "pub-rock"), "spotify"), "button 3");
  assert.equal(placeOf(dark, findDj(dark, "hank"), "spotify"), "their playlist");
  assert.deepEqual(liveGuests(dark), []);
  assert.deepEqual(liveGuests(live), [{ alias: "guest on spotify", btn: 1, label: "Spotify" },
    { alias: "guest on tidal", btn: 2, label: "Tidal" }]);
});

test("a fulfilment lands on the guest for the set's service, takes its lock, records its DJ, and makes no crate", async () => {
  const f = installFetch({ contents: [track("old")] });
  const td = installTidalFetch({ contents: ["9"] });
  try {
    const e = await crated(liveEnv());
    const log = ledgerLog(e);
    await seedAsk(e, "r-hank", "hank");
    await seedAsk(e, "r-amer", "americana");
    await seedAsk(e, "r-funk", "dr-funkenstein", { service: "tidal" });
    await seedAsk(e, "r-prof", "pub-rock");
    await seedAsk(e, "r-gatefold", "gatefold", { service: "tidal" });
    // The queue names the service each set is for, and promises no crate.
    const q = await callTool(e, "list_requests", {}, b());
    const row = (id) => q.requests.find((r) => r.request_id === id);
    assert.deepEqual(["r-hank", "r-funk", "r-prof"].map((id) => row(id).catalog), ["spotify", "tidal", "spotify"]);
    assert.ok(q.requests.every((r) => !("makes_crate" in r)), "a set bound for a guest makes no crate");

    // Hank holds a Spotify crate, and his set still goes to the Spotify guest.
    const hank = await callTool(e, "fulfill_request", { request_id: "r-hank", uris: uris("h1", "h2") }, b());
    assert.equal(hank.status, "ready", JSON.stringify(hank));
    assert.equal(hank.id, GS);
    assert.match(hank.note, /on the Spotify requests preset \(preset 1\), replacing the set that was there/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("h1", "h2"));
    assert.deepEqual(await onOf(e, GS), { dj: "hank", ref: "request r-hank" });
    // Americana's only crate was on Tidal; the set is Spotify's, so the Spotify guest.
    assert.equal((await callTool(e, "fulfill_request", { request_id: "r-amer", uris: uris("e1") }, b())).id, GS,
      "the set's own tracks choose the service");
    // Dr. Funkenstein's ask chose Tidal: the Tidal guest.
    const funk = await callTool(e, "fulfill_request", { request_id: "r-funk", uris: ["tidal:track:5", "tidal:track:6"] }, b());
    assert.equal(funk.id, GT, JSON.stringify(funk));
    assert.match(funk.note, /on the Tidal requests preset \(preset 2\)[\s\S]*nothing here can start Tidal/);
    assert.deepEqual(td.state.items.map((it) => it.trackId), ["5", "6"]);
    assert.deepEqual(await onOf(e, GT), { dj: "dr-funkenstein", ref: "request r-funk" });
    // A DJ on a preset keeps it.
    assert.equal((await callTool(e, "fulfill_request", { request_id: "r-prof", uris: uris("p1") }, b())).id, P(3));
    // Tidal asked for, Spotify tracks sent: refused naming the guest, nothing claimed.
    await assert.rejects(callTool(e, "fulfill_request", { request_id: "r-gatefold", uris: uris("c1") }, b()),
      /the Tidal requests preset \(preset 2\) is a Tidal playlist and these are not Tidal track URIs: spotify:track:c1\. Nothing was changed\./);
    assert.equal(e.STATION.rows.get("r-gatefold").state, "pending");
    // Every claim toward a guest carried it as its destination — the lock — and the preset's none.
    assert.deepEqual(Object.fromEntries(log.filter((c) => c.op === "claim").map((c) => [c.args.id, c.args.destination ?? null])),
      { "r-hank": GS, "r-amer": GS, "r-funk": GT, "r-prof": null });
    assert.deepEqual(["r-hank", "r-amer", "r-funk", "r-prof"].map((id) => e.STATION.rows.get(id).playlist_id), [GS, GS, GT, P(3)]);
    // No crate was listed for or made, and the crate document is as it was.
    assert.deepEqual(crateCalls(f), []);
    assert.ok(!td.calls.includes("POST /playlists"));
  } finally { td.restore(); f.restore(); }
});

test("activate_program and the Shelf's put land a set on the guest for its service, and the Shelf says so", async () => {
  const f = installFetch({ contents: [track("old")] });
  const td = installTidalFetch({ contents: ["9"] });
  try {
    const e = await crated(liveEnv());
    await seedProgram(e, "hank-one", "Hank", uris("a1", "a2"));
    await seedProgram(e, "funk-tidal", "Dr. Funkenstein", ["tidal:track:7"]);
    await seedProgram(e, "prof-one", "Pub Rock", uris("b1"));
    // Where each program's put would go — on its own page since the grid
    // (2026-09-23).
    const page = async (slug) => (await worker.fetch(get(`/buttons/${KEY}/programs/${slug}`), e)).text();
    const [hankPage, funkPage, profPage] = [await page("hank-one"), await page("funk-tidal"), await page("prof-one")];
    assert.match(hankPage, /<span class="nw">Load on 1<\/span> <span class="nw">\(DJ Guest\)<\/span><\/span><\/button>/);
    assert.match(funkPage, /<span class="nw">Load on 2<\/span> <span class="nw">\(DJ Guest · Tidal\)<\/span><\/span><\/button>/);
    assert.match(profPage, />Load on preset<\/button>/, "Pub Rock's goes on his own");
    assert.match(hankPage, /aria-label="Load Set hank-one on preset 1 \(DJ Guest\)"/);
    for (const html of [hankPage, funkPage, profPage]) {
      assert.ok(!/>Load on Spotify</.test(html), "no crate is offered while the guest is live");
    }

    // The tool: the Spotify guest, the record restamped, the pointer and the holder.
    const out = await callTool(e, "activate_program", { id: "hank-one" }, b());
    assert.deepEqual([out.button, out.on, out.catalog], ["button 1", "guest", "spotify"]);
    assert.match(out.note, /^The Spotify guest \(preset 1\) now holds this program, replacing the set that was there/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("a1", "a2"));
    assert.equal(JSON.parse(await e.PROGRAMS.get("program:hank-one")).playlistId, GS);
    assert.equal(await e.PROGRAMS.get(`current:${GS}`), "hank-one");
    assert.deepEqual(await onOf(e, GS), { dj: "hank", ref: "hank-one" });
    // The Tidal set: the Tidal guest, pressed on 2.
    const t = await callTool(e, "activate_program", { id: "funk-tidal" }, b());
    assert.deepEqual([t.button, t.on, t.catalog], ["button 2", "guest", "tidal"]);
    assert.match(t.note, /press 2 on the remote; nothing here can start Tidal/);
    assert.deepEqual(td.state.items.map((it) => it.trackId), ["7"]);
    assert.deepEqual(await onOf(e, GT), { dj: "dr-funkenstein", ref: "funk-tidal" });
    // Vibe holds no crate at all: her set goes to the guest, and none is made for her.
    await seedProgram(e, "vibe-one", "Vibe", uris("d1"));
    assert.equal((await callTool(e, "activate_program", { id: "vibe-one" }, b())).button, "button 1");
    assert.deepEqual(crateCalls(f), [], "no Spotify crate listed for or made");
    assert.ok(!td.calls.includes("POST /playlists"), "no Tidal crate made");

    // The Shelf's put, the same lookup: the flash says it landed, the rows say where.
    await seedProgram(e, "hank-two", "Hank", uris("c1"));
    const res = await worker.fetch(post(`/notes/${KEY}/activate`, "slug=hank-two"), e);
    const put = new URL(res.headers.get("location"), "https://x.test").searchParams.get("put");
    assert.equal(put, "ok:hank-two");
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("c1"));
    const after = await (await worker.fetch(get(`/notes/${KEY}?put=${put}`), e)).text();
    assert.match(after, /<div class="flash"><p>“Set hank-two” is on the button\./);
    // The cards wear the guests' numbers (the grid, 2026-09-23); the pages
    // say it in words and open the Tidal one in the app.
    assert.match(after, /<span class="num" aria-hidden="true">1<\/span>[\s\S]*?<span class="cmeta"><b>Preset 1<\/b> · Hank/);
    assert.match(after, /<span class="num" aria-hidden="true">2<\/span><span class="svc">Tidal<\/span>[\s\S]*?<span class="cmeta"><b>Preset 2<\/b> · Dr\. Funkenstein/);
    assert.match(await page("hank-two"), /On preset 1 now/);
    assert.match(await page("funk-tidal"), /On preset 2 now<\/span><a class="open" href="https:\/\/listen\.tidal\.com\/playlist\/0b1f2c3d-aaaa-bbbb-cccc-000000000002">Open in Tidal/);
  } finally { td.restore(); f.restore(); }
});

test("a set on a guest is kept from the row's own playlist", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    // After the flip Hank has no preset and no crate; his set went to the guest.
    const e = liveEnv();
    await seedAsk(e, "r1", "hank", { keep: true });
    assert.equal((await callTool(e, "fulfill_request", { request_id: "r1", uris: uris("h1", "h2") }, b())).id, GS);
    const kept = await callTool(e, "keep_request_set", { request_id: "r1", title: "Trains", intro: "A line." }, b());
    assert.equal(kept.status, "kept", JSON.stringify(kept));
    assert.equal(kept.on_button, true);
    const page = JSON.parse(await e.PROGRAMS.get(`program:${slugOf(kept.url)}`));
    assert.deepEqual([page.playlistId, page.playlistName, page.loaded], [GS, "DJ Guest", true]);
    assert.equal(await e.PROGRAMS.get(`current:${GS}`), slugOf(kept.url));

    // Another set took the guest before the keep: the page is written and not loaded.
    await seedAsk(e, "r2", "vibe", { keep: true });
    await callTool(e, "fulfill_request", { request_id: "r2", uris: uris("s1") }, b());
    await seedAsk(e, "r3", "dr-funkenstein");
    await callTool(e, "fulfill_request", { request_id: "r3", uris: uris("m1") }, b());
    const late = await callTool(e, "keep_request_set", { request_id: "r2", title: "Sun", intro: "A line." }, b());
    assert.equal(late.status, "kept");
    assert.equal(late.on_button, false);
    assert.equal(await e.PROGRAMS.get(`current:${GS}`), null, "no pointer claims a set the guest does not hold");

  } finally { f.restore(); }
});

test("a writer with no preset loads a program onto the live guest on its service, and only there", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = liveEnv();
    const secs = [{ heading: "One", prose: [{ text: "p" }], tracks: [{ uri: "spotify:track:q1", artist: "Someone" }] }];
    const base = { title: "A survey", thesis: "t", complications: [{ text: "c" }], sections: secs };
    const held = await callTool(e, "make_librarian_program", base, b());
    assert.match(held.note, /the Spotify requests preset \(preset 1\) still holds whatever it held before/);
    assert.match(held.note, /activate_program puts it there, on the Spotify requests preset \(preset 1\)/);
    assert.equal(JSON.parse(await e.PROGRAMS.get(`program:${slugOf(held.url)}`)).playlistId, GS);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("old"), "held back: nothing written");
    const loaded = await callTool(e, "make_librarian_program", { ...base, title: "Another", load_button: true }, b());
    assert.equal(loaded.button, "button 1", JSON.stringify(loaded));
    assert.match(loaded.note, /^The Spotify guest \(preset 1\) now holds this program, replacing the set that was there/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("q1"));
    assert.deepEqual(await onOf(e, GS), { dj: "the-librarian", ref: slugOf(loaded.url) });
    // Tidal tracks while the Tidal guest is dark: nowhere to load, refused as before.
    const half = houseEnv({ BUTTONS: JSON.stringify([guest({ live: true }), tidalGuest(),
      { button: 3, dj: "pub-rock", playlist: P(3) }]) });
    await assert.rejects(callTool(half, "make_librarian_program", { ...base, title: "Tidal one", load_button: true,
      sections: [{ ...secs[0], tracks: [{ uri: "tidal:track:1", artist: "Someone" }] }] }, b()),
      /The Librarian is not on a preset here, so there is no button to load this onto/);
  } finally { f.restore(); }
});

test("revise_program rewrites a program the guest holds, and only the page once another set took it", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = liveEnv();
    await seedProgram(e, "hank-one", "Hank", uris("a1", "a2"));
    await callTool(e, "activate_program", { id: "hank-one" }, b());
    const out = await callTool(e, "revise_program", { id: "hank-one", uris: uris("a2", "a1"), why: "The order" }, b());
    assert.deepEqual([out.on_air, out.playlist_written], [true, true], JSON.stringify(out));
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("a2", "a1"));
    assert.deepEqual(await onOf(e, GS), { dj: "hank", ref: "hank-one" });
    // Another set on the guest: the pointer went with it, so only the page changes.
    await callTool(e, "replace_playlist", { playlist: "guest on spotify", uris: uris("z") }, b());
    const again = await callTool(e, "revise_program", { id: "hank-one", uris: uris("a1", "a2"), why: "Back" }, b());
    assert.deepEqual([again.on_air, again.playlist_written], [false, false]);
    assert.deepEqual(f.state.contents.map((t) => t.uri), uris("z"));
  } finally { f.restore(); }
});

test("play_program plays a Spotify set the guest still holds, and one nobody holds as its tracks; a Tidal set is pressed on 2, and one the guest lost is refused in words", async () => {
  const f = installFetch({ contents: [track("old")] });
  const td = installTidalFetch({ contents: ["9"] });
  try {
    const e = liveEnv();
    await seedProgram(e, "hank-one", "Hank", uris("a1", "a2"));
    await callTool(e, "activate_program", { id: "hank-one" }, b());
    const writes = () => f.calls.filter((c) => /^(PUT|POST) \/playlists\//.test(c)).length;
    const before = writes();
    const played = await callTool(e, "play_program", { id: "hank-one" }, b());
    assert.ok(!("wrote_replay_copy" in played), "the guest holds it: nothing written");
    assert.equal(writes(), before);
    assert.ok(f.calls.includes("PUT /me/player/play"));
    // A Tidal set on the Tidal guest: pressed on 2, never started from here.
    await seedProgram(e, "funk-tidal", "Dr. Funkenstein", ["tidal:track:7"]);
    await callTool(e, "activate_program", { id: "funk-tidal" }, b());
    await assert.rejects(callTool(e, "play_program", { id: "funk-tidal" }, b()),
      /Press 2 on the remote \(DJ Guest · Tidal\); the playlist itself is unchanged/);
    // Another Tidal set took the guest: refused, pointing at activate_program and preset 2.
    await seedProgram(e, "amer-tidal", "Americana", ["tidal:track:8"]);
    await callTool(e, "activate_program", { id: "amer-tidal" }, b());
    const tw = () => td.calls.filter((c) => /^(POST|DELETE|PATCH) \/playlists\//.test(c)).length;
    const tBefore = tw();
    await assert.rejects(callTool(e, "play_program", { id: "funk-tidal" }, b()),
      /"Set funk-tidal" is a Tidal set, and the Tidal guest \(preset 2\) no longer holds it\. Nothing here can start Tidal, and play never rewrites a preset: activate_program with id "funk-tidal" puts it back on the Tidal guest, then press 2 on the remote\. Nothing was changed\./);
    assert.equal(tw(), tBefore, "nothing written");
    // A set no preset holds plays as its own tracks, as the Shelf's Play
    // plays it (2026-10-12; until then it was copied to the replay playlist
    // first): nothing written, and the Shelf's record says whose it is.
    await seedProgram(e, "hank-two", "Hank", uris("c1"));
    const two = await callTool(e, "play_program", { id: "hank-two" }, b());
    assert.match(two.playing_from, /its own tracks/);
    assert.equal(writes(), before, "nothing written");
    assert.deepEqual(JSON.parse(await e.PROGRAMS.get("queue:shelf")).slug, "hank-two");
  } finally { td.restore(); f.restore(); }
});

test("get_dj says a DJ with no preset is on the guest, crate or not, and that the guests are live", async () => {
  const e = await crated(liveEnv());
  const list = await callTool(e, "get_dj", {}, b());
  const by = Object.fromEntries(list.djs.map((d) => [d.name, d]));
  assert.deepEqual([by[HANK].on, by[HANK].catalog], ["guest", "spotify"], "a crate does not keep him off it");
  assert.equal(by[PERSONAS["dr-funkenstein"].name].on, "guest");
  assert.equal(by[PERSONAS["pub-rock"].name].button, "button 3");
  assert.ok(list.guest_presets.every((g) => g.live));
  assert.match(list.guest_presets_note, /A live one is where the set of a DJ with no preset of their own lands/);
  const funk = await callTool(e, "get_dj", { name: "dr-funkenstein" }, b());
  assert.deepEqual([funk.on, funk.catalog], ["guest", "spotify"]);
  assert.match(funk.guest_note,
    /"guest on spotify" \(preset 1\) for Spotify, "guest on tidal" \(preset 2\) for Tidal — replacing whichever DJ's set is there/);
  assert.ok(!("crate_note" in funk));
});

test("read_playlist on a live guest says whose set is on it, from the door's own record", async () => {
  const f = installFetch({ contents: [track("old")] });
  try {
    const e = liveEnv();
    await seedAsk(e, "r1", "hank");
    await callTool(e, "fulfill_request", { request_id: "r1", uris: uris("h1") }, b());
    const r = await callTool(e, "read_playlist", { playlist: "guest on spotify" }, b());
    assert.deepEqual([r.guest.button, r.guest.name, r.guest.on.dj, r.guest.on.ref],
      ["button 1", "DJ Guest", HANK, "request r1"]);
    assert.match(r.guest.note, new RegExp(`rewriting it replaces ${HANK}'s set\\. Say so before you do\\.`));
    await callTool({ ...e, __via: "talk" }, "replace_playlist", { playlist: "guest on spotify", uris: uris("t") }, b());
    const t = await callTool(e, "read_playlist", { playlist: "button 1" }, b());
    assert.deepEqual([t.guest.on.dj, t.guest.on.ref], [null, "talk"]);
    assert.match(t.guest.note, /replaces a set from Talk/);
  } finally { f.restore(); }
});

test("the request form asks the service of every DJ whose set would go to a guest, and not of one on a preset", async () => {
  const f = installFetch({ contents: [track("a")] });
  try {
    const e = liveEnv({ REQUESTS_ENABLED: "true" });
    for (const dj of ["dr-funkenstein", "hank", "vibe"]) {
      const html = await (await worker.fetch(get(`/buttons/${KEY}/${dj}`), e)).text();
      // A dropdown since 2026-10-24 (the owner: "drop downs").
      assert.match(html, /<select class="devsel" name="service">\s*<option value="spotify" selected>Spotify<\/option>\s*<option value="tidal">Tidal<\/option>/, dj);
      // Where it lands, in plain sight, following the pills (the review, 2026-10-09).
      assert.match(html, /Lands on preset <b class="asknum">\d+<\/b>, in place of the set there\./, dj);
      assert.match(html, /data-lands="\{&quot;spotify&quot;:\d+,&quot;tidal&quot;:\d+\}"/, dj);
    }
    const prof = await (await worker.fetch(get(`/buttons/${KEY}/pub-rock`), e)).text();
    assert.ok(!prof.includes('name="service"'), "a DJ on a preset is not asked: the preset is where the set goes");
  } finally { f.restore(); }
});

// KEEP IT (the owner, 2026-09-28): the set on a requests preset, onto the Shelf,
// from Talk's "keep it". The tracks are read from the preset; the DJ is the one
// the preset names; one page per set.
test("keep_set keeps the set on a requests preset under the DJ it names, once; a set with no DJ is refused", async () => {
  const f = installFetch({ contents: [track("a"), track("b"), track("c")] });
  try {
    const e = liveEnv();
    const kv = e.PROGRAMS;
    await kv.put(`on:${GS}`, JSON.stringify({ dj: null, ref: "talk", at: new Date().toISOString() }));
    await assert.rejects(callTool(e, "keep_set", { title: "Dusk", intro: "Winding down." }, { remaining: 20 }),
      /names no DJ[\s\S]*Nothing was kept/);
    // Under Sunny's old key (merged into Vibe, 2026-10-13): a set on 1 from
    // before the merge is kept under the DJ the key finds now.
    await kv.put(`on:${GS}`, JSON.stringify({ dj: "sunny", ref: "talk", at: new Date().toISOString() }));
    await kv.put(`ask:${GS}`, JSON.stringify({ text: "Sunny, an easy end-of-day hour", at: new Date().toISOString() }));
    await assert.rejects(callTool(e, "keep_set", { title: "Dusk" }, { remaining: 20 }), /intro is required/);
    const out = await callTool(e, "keep_set", { title: "Dusk, Easy", intro: "An hour to let the day go." }, { remaining: 20 });
    assert.equal(out.status, "kept");
    assert.equal(out.dj, "Vibe");
    assert.equal(out.tracks, 3);
    const slug = out.url.split("/programs/")[1];
    const page = JSON.parse(await kv.get(`program:${slug}`));
    assert.equal(page.title, "Dusk, Easy");
    assert.equal(page.thesis, "An hour to let the day go.");
    assert.deepEqual(page.sections[0].tracks.map((t) => t.uri), [track("a"), track("b"), track("c")].map((t) => t.uri),
      "the tracks the preset holds, read now");
    assert.equal(page.ask.text, "Sunny, an easy end-of-day hour", "the words kept for the keyed pages");
    assert.equal(page.playlistId, GS);
    assert.equal(await kv.get(`current:${GS}`), slug, "the preset holds it: Loaded names it");
    const again = await callTool(e, "keep_set", { title: "Dusk Again", intro: "Same set." }, { remaining: 20 });
    assert.equal(again.status, "already-kept");
    assert.equal(again.url, out.url, "one page per set");
    // A Tidal set is kept from preset 2 when asked for by service.
    await assert.rejects(callTool(e, "keep_set", { service: "tidal", title: "T", intro: "t" }, { remaining: 20 }),
      /names no DJ/);
  } finally { f.restore(); }
});
