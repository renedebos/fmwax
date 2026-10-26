// THE ROTATING STATION on the archive preset (2026-09-06).
//
// The speaker holds three entries and loops them — hardware, measured twice
// across two products. But it RE-READS the file every lap, so a set of any
// length can be fed through three at a time: each time it comes back for the
// list, hand it the next three.
//
// The danger this is built around: if the device asks twice inside one lap and
// the window moved on each ask, three takes would be skipped in silence, and
// nothing would look broken. So the ask is the trigger and the CLOCK is the
// guard — the window only turns once most of what was served has had time to
// play. Everything below is about that rule.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, buttons, PID, installFetch } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const { stationWindow, ARCHIVE_WINDOW, STATION_KEY } = __test;

const set = (n, over = {}) => ({
  refs: Array.from({ length: n }, (_, i) => `r${i}`),
  pos: 0, nextAt: null, loop: true, ...over,
});

test("the first ask serves the head of the set, not the second window", () => {
  const w = stationWindow(set(9), 1000);
  assert.deepEqual(w.refs, ["r0", "r1", "r2"]);
  assert.equal(w.pos, 0);
  assert.equal(w.moved, true, "and it counts as a turn, so a gate gets set");
});

test("an ask before the gate opens gets the SAME three", () => {
  // This is the whole safety property. A device that re-reads every track, or
  // twice on a lap, or on a network retry, must not advance the set.
  const rec = set(9, { pos: 3, nextAt: 10_000 });
  for (const now of [0, 5_000, 9_999]) {
    const w = stationWindow(rec, now);
    assert.deepEqual(w.refs, ["r3", "r4", "r5"], `at ${now}`);
    assert.equal(w.moved, false, `at ${now} nothing turned`);
  }
});

test("an ask after the gate turns the page by exactly one window", () => {
  const w = stationWindow(set(9, { pos: 3, nextAt: 10_000 }), 10_000);
  assert.deepEqual(w.refs, ["r6", "r7", "r8"]);
  assert.equal(w.pos, 6);
  assert.equal(w.moved, true);
  assert.equal(ARCHIVE_WINDOW, 3, "three is the hardware and this test assumes it");
});

test("a looping set comes back to the top; one that does not stays on its last three", () => {
  const round = stationWindow(set(9, { pos: 6, nextAt: 1 }), 2);
  assert.deepEqual(round.refs, ["r0", "r1", "r2"], "back to the head");

  const stop = stationWindow(set(9, { pos: 6, nextAt: 1, loop: false }), 2);
  assert.deepEqual(stop.refs, ["r6", "r7", "r8"], "the end holds rather than restarting");
});

test("a set that does not divide by three ends on a short window, not a wrong one", () => {
  // Eight takes: 3, 3, then 2. The last window must not reach past the end and
  // must not silently drop the eighth.
  const last = stationWindow(set(8, { pos: 3, nextAt: 1 }), 2);
  assert.deepEqual(last.refs, ["r6", "r7"], "two is what is left, and both play");
  const wrapped = stationWindow(set(8, { pos: 6, nextAt: 1 }), 2);
  assert.deepEqual(wrapped.refs, ["r0", "r1", "r2"], "then round to the top");
});

test("a set shorter than the window is served whole, every time", () => {
  const w = stationWindow(set(2), 1);
  assert.deepEqual(w.refs, ["r0", "r1"]);
  const again = stationWindow(set(2, { pos: 0, nextAt: 1 }), 2);
  assert.deepEqual(again.refs, ["r0", "r1"], "and turning the page finds the same two");
});

// ---------------------------------------------------- and through the route

// The index the archive's site serves, in the two shapes the join expects: the
// occurrences carry the grouping, the track spec the audio analysis.
function archiveFetch(n = 9) {
  const original = globalThis.fetch;
  const occ = { "a-song": { title: "A Song", occ: Array.from({ length: n }, (_, i) => ({
    code: `r${i}`, slug: "show-1998-04-01", num: i + 1, title: "A Song",
    artist_name: "The Porch Band", venue: "Elm Street Hall", date: "1998-04-01",
    duration: "3:00", source: i % 2 ? "SBD" : "AUD",
    file: `take-${i}.wav`, ver: "1",
  })) } };
  const spec = Array.from({ length: n }, (_, i) => ({ id: `show-1998-04-01-${String(i + 1).padStart(2, "0")}` }));
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    if (url.includes("song-occurrences.json")) return new Response(JSON.stringify(occ), { status: 200 });
    if (url.includes("track-spec.json")) return new Response(JSON.stringify(spec), { status: 200 });
    if (url.includes("media.test")) return new Response("", { status: 206 });
    return original(u, init);
  };
  return { restore() { globalThis.fetch = original; } };
}

// A HOUSE THAT HAS NOT SAID WHERE ITS RECORDINGS ARE SERVES NONE (2026-09-08).
//
// `archiveStreamUrl` built one household's worker hostname into every install
// until this date — the index above moved into config on 2026-09-07 and this
// did not, so "bring your own archive" was true of the LIST and false of the
// AUDIO. The endpoint takes no credential, so its host is the whole of the
// access control on recordings that are somebody's own, and the one thing this
// must never do is hand a stranger's speaker a URL pointing at them.
test("no media host configured means no stream URL, never a borrowed one", async () => {
  const e = makeEnv();
  delete e.ARCHIVE_MEDIA_URL;
  const f = archiveFetch(9);
  try {
    await e.TOKENS.put(STATION_KEY(ARCHIVE.key), JSON.stringify({
      refs: ["r0", "r1", "r2"], pos: 0, nextAt: null, loop: true, asks: [],
    }));
    const res = await worker.fetch(new Request(`https://x.test/archive/${ARCHIVE.key}.m3u`), e);
    const body = await res.text();
    assert.ok(!/https?:\/\//.test(body),
      "an unconfigured house emits no stream URL at all");
    assert.ok(!body.includes("take-0.wav"),
      "and does not serve the set from a host it was never given");
  } finally { f.restore(); }
});

test("the m3u turns the page when the clock says so, and repeats itself when it does not", async () => {
  const e = makeEnv();
  const f = archiveFetch(9);
  try {
    await e.TOKENS.put(STATION_KEY(ARCHIVE.key), JSON.stringify({
      refs: ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"],
      pos: 0, nextAt: null, loop: true, asks: [],
    }));
    const get = () => worker.fetch(new Request(`https://x.test/archive/${ARCHIVE.key}.m3u`), e);

    const first = await (await get()).text();
    assert.match(first, /^#EXTM3U/);
    assert.equal((first.match(/media\.test/g) ?? []).length, 3, "three entries, which is the hardware");
    assert.match(first, /take-0\.wav/);
    assert.match(first, /take-2\.wav/);
    assert.ok(!first.includes("take-3.wav"), "and not the fourth");

    // Asked again straight away — a device that re-reads twice in a lap must
    // hear the same three, or three takes vanish with nothing to show for it.
    const again = await (await get()).text();
    assert.equal(again, first, "the same three, exactly");

    // The gate opens: three takes of three minutes each, gated at 80%.
    const rec = JSON.parse(await e.TOKENS.get(STATION_KEY(ARCHIVE.key)));
    rec.nextAt = Date.now() - 1;
    await e.TOKENS.put(STATION_KEY(ARCHIVE.key), JSON.stringify(rec));
    const next = await (await get()).text();
    assert.match(next, /take-3\.wav/);
    assert.ok(!next.includes("take-0.wav"), "and the page has turned");

    // The ask is stamped whether or not it turned — that is the measurement of
    // how often the device actually comes back.
    const after = JSON.parse(await e.TOKENS.get(STATION_KEY(ARCHIVE.key)));
    assert.ok(after.asks.length >= 2, "every ask is written down");
    assert.equal(after.pos, 3);
  } finally { f.restore(); }
});

test("with no set parked, the stored file is served exactly as before", async () => {
  const e = makeEnv();
  const f = archiveFetch(3);
  try {
    await e.TOKENS.put(`m3u:${ARCHIVE.key}`, "#EXTM3U\n#EXTINF:10,X\nhttps://example.test/a.wav\n");
    const body = await (await worker.fetch(new Request(`https://x.test/archive/${ARCHIVE.key}.m3u`), e)).text();
    assert.match(body, /example\.test\/a\.wav/, "the plain window is untouched by any of this");
  } finally { f.restore(); }
});

// ------------------------------------------- and the request it answers

test("a parked set settles the request it answers, and says so", async () => {
  // The archive cannot go through fulfill_request: that writes a playlist on a
  // service and none of this is on one. So play_archive settles the ledger
  // itself, AFTER the set is parked — the same order as every write here, so a
  // failure leaves a request that still looks open rather than a set nobody
  // can find (2026-09-07).
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: PID, 6: true });
  const f = archiveFetch(9);
  const now = Date.now();
  e.STATION.rows.set("r-arch", {
    id: "r-arch", dj: ARCHIVE.dj, normalized: "x", state: "pending",
    created_at: now, updated_at: now, lease_until: null, fingerprint: null,
    write_started: 0, claim_token: null, claim_count: 0, playlist_id: null,
    track_count: null, runtime_ms: null, attention_code: null,
    decline_reason: null, suggested_dj: null,
  });
  try {
    const out = await __test.callTool(e, "play_archive", {
      refs: ["r0", "r1", "r2", "r3", "r4"], title: "One Night", request_id: "r-arch",
    }, { remaining: 40 });
    assert.equal(out.rotating, true);
    assert.equal(out.request, "ready", JSON.stringify(out.request));
    assert.equal(e.STATION.rows.get("r-arch").state, "ready");
    // And the set is on the button, which is the part that matters most.
    const body = await (await worker.fetch(new Request(`https://x.test/archive/${ARCHIVE.key}.m3u`), e)).text();
    assert.match(body, /take-0\.wav/);
  } finally { f.restore(); }
});

test("a set with no request touches no ledger row", async () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: PID, 6: true });
  const f = archiveFetch(9);
  try {
    const out = await __test.callTool(e, "play_archive",
      { refs: ["r0", "r1", "r2", "r3"] }, { remaining: 40 });
    assert.equal(out.request, undefined, "nothing is claimed that was not asked for");
    assert.equal(e.STATION.rows.size, 0);
  } finally { f.restore(); }
});

// ------------------------------------------------ and the page it leaves

test("a rotating set gets a page: a setlist record, the archive pointer, and a link into the site's player", async () => {
  // Every other DJ's work has a permanent page; a set parked on the archive
  // left none. Now the record is the setlist shape renderProgram already
  // prints, playlistId is `archive:<key>` so the existing current-pointer
  // check says whether it is on the button, and `archive.site` hands the
  // whole set to the archive site's own player by the ids that site resolves.
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: PID, 6: true });
  const f = archiveFetch(9);
  try {
    const out = await __test.callTool(e, "play_archive",
      { refs: ["r0", "r1", "r2", "r3", "r4"], title: "One Night" }, { remaining: 40 });
    assert.equal(out.rotating, true);
    assert.ok(out.program?.id, JSON.stringify(out.program));
    assert.match(out.program.url, new RegExp(`/programs/${out.program.id}$`));

    const rec = await e.PROGRAMS.get(`program:${out.program.id}`, { type: "json" });
    assert.equal(rec.dj, ARCHIVE.name, "the display name — the shelf filters on it");
    assert.equal(rec.shape, "setlist");
    assert.equal(rec.playlistId, `archive:${ARCHIVE.key}`);
    assert.equal(rec.title, "One Night");
    assert.equal(rec.tracks, 5);
    assert.deepEqual(rec.sections[0].tracks.map((t) => t.uri),
      ["archive:take:r0", "archive:take:r1", "archive:take:r2", "archive:take:r3", "archive:take:r4"]);
    assert.equal(rec.sections[0].tracks[0].album, "Elm Street Hall, 1998-04-01",
      "where and when, in the album's place");
    assert.equal(rec.archive.btn, 6);
    assert.equal(rec.archive.site,
      "https://site.test/playlist/#p=show-1998-04-01-01,show-1998-04-01-02,show-1998-04-01-03,show-1998-04-01-04,show-1998-04-01-05",
      "the site's own ids, from the configured base");
    // The listing row is what the shelf and the Programs page read.
    const { metadata } = await e.PROGRAMS.getWithMetadata(`program:${out.program.id}`);
    assert.equal(metadata.dj, ARCHIVE.name);
    assert.equal(metadata.tracks, 5);
    // And the pointer: this page is what preset 6 holds now.
    assert.equal(await e.PROGRAMS.get(`current:archive:${ARCHIVE.key}`), out.program.id);
  } finally { f.restore(); }
});

// REVISING AN ARCHIVE SET (2026-09-07). The same tool that edits a kept
// set's page edits this one; on the preset it re-parks the station, off it
// only the page changes. Every row is rebuilt from the index, so the site
// link names the new order by the ids only the index knows.
async function parked(n = 5) {
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: PID, 6: true });
  const out = await __test.callTool(e, "play_archive",
    { refs: Array.from({ length: n }, (_, i) => `r${i}`), title: "One Night" }, { remaining: 40 });
  return { e, slug: out.program.id };
}

test("off the preset, revising an archive set changes its page and leaves the station alone", async () => {
  const f = archiveFetch(9);
  try {
    const { e, slug } = await parked();
    await e.PROGRAMS.delete(`current:archive:${ARCHIVE.key}`);
    const station = await e.TOKENS.get(STATION_KEY(ARCHIVE.key));
    const out = await __test.callTool(e, "revise_program", {
      id: slug, uris: ["archive:take:r4", "archive:take:r0", "archive:take:r5"], why: "Three, reordered.",
    }, { remaining: 40 });
    assert.equal(out.on_air, false);
    assert.equal(out.playlist_written, false);
    assert.equal(out.tracks, 3);
    const rec = await e.PROGRAMS.get(`program:${slug}`, { type: "json" });
    assert.deepEqual(rec.sections[0].tracks.map((t) => t.uri),
      ["archive:take:r4", "archive:take:r0", "archive:take:r5"]);
    assert.equal(rec.archive.site,
      "https://site.test/playlist/#p=show-1998-04-01-05,show-1998-04-01-01,show-1998-04-01-06",
      "the site link follows the new order");
    assert.equal(rec.revisions[0].was.tracks, 5);
    assert.equal(await e.TOKENS.get(STATION_KEY(ARCHIVE.key)), station, "the station is as it was");
    const { metadata } = await e.PROGRAMS.getWithMetadata(`program:${slug}`);
    assert.equal(metadata.tracks, 3, "and the listing row moved with it");
  } finally { f.restore(); }
});

test("on the preset, revising re-parks the station from the top, and says so", async () => {
  const f = archiveFetch(9);
  try {
    const { e, slug } = await parked();
    const before = await e.PROGRAMS.get(`program:${slug}`);
    const station = await e.TOKENS.get(STATION_KEY(ARCHIVE.key));
    // Nothing is written on a refusal: a ref the index has never heard of,
    // or a track from a service the archive is not on.
    await assert.rejects(__test.callTool(e, "revise_program",
      { id: slug, uris: ["archive:take:r0", "archive:take:r99"], why: "No." }, { remaining: 40 }),
      /not in the archive: r99/);
    await assert.rejects(__test.callTool(e, "revise_program",
      { id: slug, uris: ["archive:take:r0", `spotify:track:${"a".repeat(22)}`], why: "No." }, { remaining: 40 }),
      /archive takes only/);
    assert.equal(await e.PROGRAMS.get(`program:${slug}`), before);
    assert.equal(await e.TOKENS.get(STATION_KEY(ARCHIVE.key)), station);

    const out = await __test.callTool(e, "revise_program", {
      id: slug, uris: ["archive:take:r4", "archive:take:r0", "archive:take:r5"], why: "Three, reordered.",
    }, { remaining: 40 });
    assert.equal(out.on_air, true);
    assert.equal(out.playlist_written, true);
    assert.match(out.note, /restarted at the top/);
    const doc = JSON.parse(await e.TOKENS.get(STATION_KEY(ARCHIVE.key)));
    assert.deepEqual(doc.refs, ["r4", "r0", "r5"]);
    assert.equal(doc.pos, 0);
    assert.deepEqual(doc.asks, []);
    assert.equal(await e.PROGRAMS.get(`current:archive:${ARCHIVE.key}`), slug, "still on the preset");
  } finally { f.restore(); }
});

test("a plain window writes no page, and clears the pointer a set had left", async () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: PID, 6: true });
  const f = archiveFetch(9);
  try {
    const set = await __test.callTool(e, "play_archive",
      { refs: ["r0", "r1", "r2", "r3"], title: "Four" }, { remaining: 40 });
    assert.ok(set.program?.id);
    const before = (await e.PROGRAMS.list({ prefix: "program:" })).keys.length;
    const plain = await __test.callTool(e, "play_archive",
      { refs: ["r5", "r6", "r7"] }, { remaining: 40 });
    assert.equal(plain.program, undefined, "three takes is the plain file, not a program");
    assert.equal((await e.PROGRAMS.list({ prefix: "program:" })).keys.length, before);
    assert.equal(await e.PROGRAMS.get(`current:archive:${ARCHIVE.key}`), null,
      "whatever page said 'on the preset' is not, now");
    // The first page still stands: replacing what is on the button never
    // deletes what was written.
    assert.ok(await e.PROGRAMS.get(`program:${set.program.id}`));
  } finally { f.restore(); }
});

test("a request gets a page only when the listener ticked keep — the rule every DJ follows", async () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: PID, 6: true });
  const f = archiveFetch(9);
  const now = Date.now();
  const row = (id) => ({
    id, dj: ARCHIVE.dj, normalized: "x", state: "pending",
    created_at: now, updated_at: now, lease_until: null, fingerprint: null,
    write_started: 0, claim_token: null, claim_count: 0, playlist_id: null,
    track_count: null, runtime_ms: null, attention_code: null,
    decline_reason: null, suggested_dj: null,
  });
  try {
    // Kept: the ledger owns the slug, the record carries the ask.
    e.STATION.rows.set("r-keep", row("r-keep"));
    await e.PROGRAMS.put("request:r-keep", JSON.stringify({
      id: "r-keep", dj: ARCHIVE.dj, mood: "the Riverside show, whole",
      length: 60, avoid: null, keep: true, at: "2026-09-07T01:00:00Z",
    }));
    const kept = await __test.callTool(e, "play_archive",
      { refs: ["r0", "r1", "r2", "r3"], title: "Riverside, Whole", request_id: "r-keep" }, { remaining: 40 });
    assert.equal(kept.request, "ready");
    assert.ok(kept.program?.id);
    const r1 = e.STATION.rows.get("r-keep");
    assert.equal(r1.state, "ready");
    assert.equal(r1.kept_slug, kept.program.id, "the page the ledger names is the page written");
    assert.ok(r1.kept_at, "and the keep is committed, so the sweep never offers it again");
    const rec = await e.PROGRAMS.get(`program:${kept.program.id}`, { type: "json" });
    assert.equal(rec.requestId, "r-keep");
    assert.match(rec.ask.text, /Riverside show/);

    // Not kept: the set is parked and the request settled, and no page.
    e.STATION.rows.set("r-nokeep", row("r-nokeep"));
    await e.PROGRAMS.put("request:r-nokeep", JSON.stringify({
      id: "r-nokeep", dj: ARCHIVE.dj, mood: "anything", length: 60, avoid: null,
      at: "2026-09-07T01:00:00Z",
    }));
    const before = (await e.PROGRAMS.list({ prefix: "program:" })).keys.length;
    const loose = await __test.callTool(e, "play_archive",
      { refs: ["r4", "r5", "r6", "r7"], title: "Loose", request_id: "r-nokeep" }, { remaining: 40 });
    assert.equal(loose.request, "ready");
    assert.equal(loose.program, undefined, "no keep, no page");
    assert.equal((await e.PROGRAMS.list({ prefix: "program:" })).keys.length, before);
    assert.equal(e.STATION.rows.get("r-nokeep").state, "ready");
  } finally { f.restore(); }
});

// THE VOICE LOADS THE ARCHIVE AND SETTLES NOTHING (2026-10-10, the owner
// asking Talk for a night of the archive). Talk may load the archive
// preset; a listener request's id is the connector's and the curator's, so
// the bridge drops it: the set is parked and the request stays as it was.
test("Talk can load the archive; a request id it passes is dropped, never settled", async () => {
  const e = makeEnv();
  const KEY = "abcdefabcdefabcdefabcdef";
  e.BUTTONS = buttons({ 2: PID, 6: true });
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
  e.OPENAI_API_KEY = "sk-test-voice";
  const oa = installFetch({ openai: () => new Response(JSON.stringify({ session: { id: "live_a" },
    transport: { type: "webrtc", sdp: "v=0\r\ns=answer\r\n" } }), { status: 201, headers: { "content-type": "application/json" } }) });
  const f = archiveFetch(9);
  const now = Date.now();
  e.STATION.rows.set("r-arch", {
    id: "r-arch", dj: ARCHIVE.dj, normalized: "x", state: "pending",
    created_at: now, updated_at: now, lease_until: null, fingerprint: null,
    write_started: 0, claim_token: null, claim_count: 0, playlist_id: null,
    track_count: null, runtime_ms: null, attention_code: null,
    decline_reason: null, suggested_dj: null,
  });
  const talk = (door, type, body, cap) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/talk/${door}`, {
    method: "POST", body, headers: { origin: "https://x.test", "content-type": type, ...(cap ? { "x-talk-session": cap } : {}) } }), e);
  try {
    const opened = await talk("session", "application/sdp", "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n");
    assert.equal(opened.status, 201, await opened.clone().text());
    const { cap } = await opened.json();
    const res = await talk("tool", "application/json", JSON.stringify({ name: "play_archive",
      arguments: { refs: ["r0", "r1", "r2", "r3", "r4"], title: "One Night", request_id: "r-arch" } }), cap);
    const out = JSON.parse((await res.json()).output);
    assert.equal(out.rotating, true, "loaded");
    assert.equal(out.request, undefined, "no request was named to it");
    assert.equal(e.STATION.rows.get("r-arch").state, "pending", "the request is untouched");
    assert.match(await (await worker.fetch(new Request(`https://x.test/archive/${ARCHIVE.key}.m3u`), e)).text(), /take-0\.wav/);
  } finally { f.restore(); oa.restore(); }
});

// STARTED THROUGH THE HOME HELPER (the owner, 2026-10-10: "yes" to Talk
// pressing 6). A WiiM named: once the set is written the helper presses the
// archive's key there. The helper off, or a speaker that is not a WiiM: the
// set is still loaded, and the answer says to press 6 and why.
test("play_archive with a WiiM: the helper presses 6 after the write; off or not a WiiM, it stays loaded and says why", async () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 2: PID, 6: true });
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" });
  const f = archiveFetch(9);
  const pressed = [];
  try {
    const off = await __test.callTool(e, "play_archive", { refs: ["r0", "r1", "r2"], device: "Ultra" }, { remaining: 40 });
    assert.equal(off.started, false);
    assert.equal(off.start.code, "helper-off");
    assert.match(off.how_to_hear_it, /home helper on the Chromebook is off[^]*press 6 on the WiiM/);
    assert.match(await (await worker.fetch(new Request(`https://x.test/archive/${ARCHIVE.key}.m3u`), e)).text(), /take-0\.wav/, "loaded all the same");

    e.STATION.endless.hands = async (cmd) => { pressed.push(cmd); return { ok: true }; };
    const on = await __test.callTool(e, "play_archive", { refs: ["r3", "r4", "r5", "r6"], device: "ultra" }, { remaining: 40 });
    assert.equal(on.started, true);
    assert.deepEqual(pressed, [{ cmd: "key", n: 6, speaker: "Ultra" }], "one press of 6, on the Ultra");
    assert.match(on.how_to_hear_it, /Started on the Ultra: the home helper pressed 6/);

    const echo = await __test.callTool(e, "play_archive", { refs: ["r0", "r1", "r2"], device: "Living Room" }, { remaining: 40 });
    assert.equal(echo.started, false);
    assert.equal(echo.start.code, "not-wiim");
    assert.equal(pressed.length, 1, "nothing pressed for a speaker that is not a WiiM");

    const plain = await __test.callTool(e, "play_archive", { refs: ["r0", "r1", "r2"] }, { remaining: 40 });
    assert.equal(plain.started, false);
    assert.equal(plain.start, undefined, "no speaker named: only loaded, as before");
  } finally { f.restore(); }
});
