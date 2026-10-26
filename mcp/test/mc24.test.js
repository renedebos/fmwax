// MC-24: ANY DJ ON ANY ENDLESS PRESET (tasks/done/mc24-dj-presets.md). The
// config names the slots and who each starts with; the ledger's `assign` says
// who is on each now, changed from a DJ's page — a swap when the DJ holds
// another slot, queued while a slot involved is playing. The endless document
// is written by compare-and-set, a job is claimed before it is answered, and
// the recent-songs list belongs to the DJ.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, track } from "./harness.js";
import { render } from "../install/config.js";
import { inlineFn, tidalOffer, steerOf, barWords } from "../programs.js";

const { endlessWatch, endlessJobs, callTool, endlessAssign, tabState } = __test;
const KEY = "abcdefabcdefabcdefabcdef";
const P4 = "SAMPLEPLAYLIST00000013";
const P8 = "SAMPLEPLAYLIST00000019";
const MIN = 60_000;
const T = (n) => `spotify:track:${String(n).padStart(22, "x")}`;

function env() {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57", Ultra: "192.168.4.78" });
  // Soul on 8, as in the house since the owner cut the Selector, and Dr.
  // Funkenstein the DJ put on a preset, as Monk was here (2026-10-15).
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 4, dj: "vibe", playlist: P4 }, { button: 8, dj: "soul", playlist: P8 }] });
  e.AUTOFULFILL_ENABLED = "true";
  e.REQUEST_ROUTINE_ID = "trig_test";
  e.REQUEST_ROUTINE_TOKEN = "routine-token";
  return e;
}
// Spotify with a player that can be on either slot, and a record of renames.
function spotify(player) {
  const f = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch;
  const rung = [], renames = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.anthropic.com") {
      rung.push(JSON.parse(init.body).text.replace(/^request /, "").replace(/ \(again\)$/, ""));
      return Response.json({ type: "routine_fire" });
    }
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      const p = player.now;
      if (!p) return new Response(null, { status: 204 });
      return Response.json({ is_playing: true, device: { name: p.device ?? "Pro Plus", id: p.id ?? "d1" },
        context: { uri: `spotify:playlist:${p.pid}` }, progress_ms: 0,
        item: { uri: `spotify:track:t${p.at}`, name: `Track t${p.at}`, artists: [{ name: "Someone" }] } });
    }
    const pl = url.pathname.match(/^\/v1\/playlists\/([^/]+)$/);
    if (pl && init.method === "PUT") {
      const body = JSON.parse(init.body || "{}");
      if (body.name) renames.push([pl[1], body.name]);
    }
    return inner(u, init);
  };
  return { f, rung, renames, restore: () => { globalThis.fetch = inner; f.restore(); } };
}
const doc = (e) => JSON.parse(e.STATION.endless.doc);
const events = (e) => e.STATION.endless.log.map((r) => r.event);

test("put a DJ on a preset nobody is playing: it is theirs at once, a fresh set is asked for, the playlist renamed", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    const out = await endlessAssign(e, { dj: "dr-funkenstein", button: 8 });
    assert.equal(out.status, "done");
    assert.equal(out.leaving, "Soul");
    assert.equal(doc(e).assign["8"].dj, "dr-funkenstein");
    const [job] = await endlessJobs(e);
    assert.equal(job.kind, "fresh");
    assert.equal(job.dj, "dr-funkenstein");
    assert.equal(job.preset, 8);
    assert.deepEqual(sp.renames, [[P8, "Dr. Funkenstein"]]);
    assert.equal(sp.rung.length, 1, "the doorbell rang once, after the write");
    assert.equal((await endlessAssign(e, { dj: "dr-funkenstein", button: 8 })).status, "already");
  } finally { sp.restore(); }
});

test("a DJ on one preset put on another swaps with whoever is there", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    const out = await endlessAssign(e, { dj: "vibe", button: 8 });
    assert.equal(out.status, "done");
    assert.equal(out.swapped, 4);
    assert.equal(doc(e).assign["8"].dj, "vibe");
    assert.equal(doc(e).assign["4"].dj, "soul");
    const jobs = await endlessJobs(e);
    assert.deepEqual(jobs.map((j) => `${j.preset}:${j.dj}`).sort(), ["4:soul", "8:vibe"]);
    assert.deepEqual(sp.renames.map((r) => r[1]).sort(), ["Soul", "Vibe"]);
  } finally { sp.restore(); }
});

test("while the preset plays the change waits, and the watch makes it when the session ends", async () => {
  const player = { now: { pid: P8, at: 2 } };
  const sp = spotify(player);
  try {
    const e = env();
    let t = Date.now() - 30 * MIN;
    await endlessWatch(e, t);
    const out = await endlessAssign(e, { dj: "dr-funkenstein", button: 8 });
    assert.equal(out.status, "queued");
    assert.equal(doc(e).assign["8"], undefined, "not yet");
    assert.equal(doc(e).queued["8"].dj, "dr-funkenstein");
    player.now = null;
    t += 10 * MIN; await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    assert.equal(doc(e).assign["8"].dj, "dr-funkenstein");
    assert.ok(events(e).includes("assigned"));
    const jobs = await endlessJobs(e);
    assert.deepEqual(jobs.map((j) => `${j.kind}:${j.dj}`), ["fresh:dr-funkenstein"], "Dr. Funkenstein's fresh set, not Soul's");
  } finally { sp.restore(); }
});

test("work asked for the DJ who left never lands on the one who came", async () => {
  const player = { now: { pid: P8, at: 8 } };
  const sp = spotify(player);
  try {
    const e = env();
    await endlessWatch(e, Date.now() - 10 * MIN);
    const [topup] = await endlessJobs(e);
    assert.equal(topup.dj, "soul");
    // The owner swaps by hand in the ledger (a queued swap already landed).
    const d = doc(e); d.assign = { "8": { dj: "dr-funkenstein", at: Date.now() } };
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put", args: { doc: d } }) });
    const out = await callTool(e, "extend_endless", { job_id: topup.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "dj-changed");
  } finally { sp.restore(); }
});

test("a job is claimed before it is answered: a second run is told to leave it", async () => {
  const player = { now: { pid: P4, at: 8 } };
  const sp = spotify(player);
  try {
    const e = env();
    await endlessWatch(e, Date.now() - 10 * MIN);
    const [job] = await endlessJobs(e);
    const d = doc(e); d.jobs[job.job_id].claimed = Date.now();
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put", args: { doc: d } }) });
    assert.equal((await endlessJobs(e)).length, 0, "not offered while held");
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "lease-held");
  } finally { sp.restore(); }
});

test("a write that lost the race reads again: compare-and-set keeps a tap the watch would have undone", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    const st = e.STATION.get();
    const put = (d, ifRev) => st.fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put", args: { doc: d, ifRev } }) }).then((r) => r.json());
    assert.equal((await put({ a: 1 }, 0)).ok, true);
    assert.equal((await put({ a: 2 }, 0)).conflict, true, "a stale revision is refused");
    assert.equal((await put({ a: 2 }, 1)).ok, true);
  } finally { sp.restore(); }
});

test("a fresh set asked before the preset was pressed again does not replace what the new press plays", async () => {
  // Stopped near the end, so a fresh set is asked for rather than the rest kept.
  const player = { now: { pid: P4, at: 8 } };
  const sp = spotify(player);
  try {
    const e = env();
    let t = Date.now() - 80 * MIN;
    await endlessWatch(e, t);
    player.now = null;
    t += 10 * MIN; await endlessWatch(e, t);
    t += 10 * MIN; await endlessWatch(e, t);
    const [fresh] = await endlessJobs(e);
    assert.equal(fresh.kind, "fresh");
    // Pressed again — seen by the next idle look, half an hour on — and
    // paused before the fresh set was made.
    player.now = { pid: P4, at: 1 };
    t += 30 * MIN; await endlessWatch(e, t);
    player.now = null;
    const before = sp.f.state.contents.map((x) => x.uri);
    const out = await callTool(e, "extend_endless", { job_id: fresh.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "pressed-again");
    assert.deepEqual(sp.f.state.contents.map((x) => x.uri), before);
  } finally { sp.restore(); }
});

test("the recent-songs list belongs to the DJ: an old list kept by preset number moves to the DJ who played it", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    await e.STATION.get().fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put",
      args: { doc: { history: { "4": [["spotify:track:old", "A — B"]] } } } }) });
    await endlessAssign(e, { dj: "dr-funkenstein", button: 4 });
    const h = doc(e).history;
    assert.deepEqual(h.vibe, [["spotify:track:old", "A — B"]]);
    assert.equal(h["4"], undefined);
  } finally { sp.restore(); }
});

test("the pages: Put on a preset for any DJ; the DJs tab numbers who is on it; the Speakers tab owes a save", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    const read = (slug, speaker) => e.PROGRAMS.put(`reading:${slug}`, JSON.stringify({ speaker, at: new Date().toISOString(),
      presets: [{ btn: 4, name: "Vibe", source: "Spotify" }, { btn: 8, name: "Soul", source: "Spotify" }] }));
    await read("pro-plus", "Pro Plus"); await read("ultra", "Ultra");
    const page = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/dr-funkenstein`), e)).text();
    // One fold since board A (2026-09-25), a row per preset inside it.
    assert.match(page, /<details class="putfold"><summary>[\s\S]*Make Dr\. Funkenstein a house DJ<small>4 or 8 · replaces the DJ there<\/small>/);
    assert.match(page, /name="btn" value="8"><button class="chipbtn" type="submit" aria-label="Put Dr\. Funkenstein on preset 8, instead of Soul">Replace<\/button>/);
    assert.equal((await tabState(e)).owed, 0, "nothing owed before a swap");
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/dr-funkenstein/endless`, { method: "POST", body: new URLSearchParams({ do: "put", btn: "8" }) }), e);
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), /endless=put-done/);
    const back = await (await worker.fetch(new Request(`https://x.test${r.headers.get("location")}`), e)).text();
    assert.match(back, /Dr\. Funkenstein is on preset 8 now, instead of Soul\./);
    assert.match(back, /Swap with another preset/, "Dr. Funkenstein's page now offers swaps, not puts");
    assert.equal((await tabState(e)).owed, 1, "one preset owed, on both speakers (the review, 2026-10-09: presets, not presets times speakers)");
    const deck = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/djs`), e)).text();
    assert.match(deck, /aria-label="Open Dr\. Funkenstein — on preset 8, and it keeps playing"/);
    // The badge is the same on every tab (the owner, 2026-09-24: it was on
    // Speakers and not on Loaded).
    assert.match(deck, /<span class="owed" aria-label="1 preset to save again">1<\/span>/);
    const loaded = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}`), e)).text();
    assert.match(loaded, /<span class="owed" aria-label="1 preset to save again">1<\/span>/, "Loaded too");
    const spk = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`), e)).text();
    // A's mark (MC-30 stage 6): a dot and "Save again"; the detail is the key's title and the note under the keys.
    assert.match(spk, /title="Save preset 8 again on the Pro Plus: it plays Dr\. Funkenstein now"><span class="knum">8<\/span><span class="kname">Dr\. Funkenstein<\/span><span class="ksrc kflag"><i aria-hidden="true"><\/i>Save again<\/span>/);
    assert.match(spk, /Preset 8 plays Dr\. Funkenstein now, but the Pro Plus still calls it Soul\./);
  } finally { sp.restore(); }
});

test("the installer refuses an endless preset it could never watch", () => {
  const house = (endless) => ({ buttons: [{ button: 1, guest: true, name: "G", playlist: "0000000000000000000001", catalog: "spotify" }],
    aliases: { replay: "0000000000000000000002" }, endless });
  assert.throws(() => render(house({ presets: [{ button: 8, dj: "x", playlist: "0b1f2c3d-aaaa-bbbb-cccc-000000000002" }] }), ""),
    /Spotify playlist id/);
  assert.throws(() => render(house({ presets: [{ button: 1, dj: "x", playlist: "0000000000000000000003" }] }), ""),
    /also in "buttons"/);
  assert.throws(() => render(house({ presets: [{ button: 8, dj: "x", playlist: "0000000000000000000003" },
    { button: 8, dj: "y", playlist: "0000000000000000000004" }] }), ""), /listed twice/);
});

// The owner, 2026-09-24: Monk's set, started from his page on the Master
// Bedroom Echo, read "not from a preset … a playlist" — for preset 9's own
// playlist. A speaker with no keys and no reading still plays that preset.
test("an endless preset's own playlist is that preset on a speaker with no keys, named for who is on it now", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Master Bedroom"]);
    await endlessAssign(e, { dj: "dr-funkenstein", button: 8 });
    player.now = { pid: P8, at: 0, device: "Master Bedroom" };
    const o = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.deepEqual(o.preset, { btn: 8, name: "Dr. Funkenstein", dj: "dr-funkenstein", endless: true }, "not Soul, whom the config starts with");
    assert.deepEqual(o.speakerPreset, { btn: 8, name: "Dr. Funkenstein", endless: true }, "the Speakers page's poll says it too, endless");
    assert.equal(o.btn, null, "no band: the Loaded tab lights only the guests");
    const loaded = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}`), e)).text();
    assert.match(loaded, /Master Bedroom · preset 8, Dr\. Funkenstein · endless/, "the now bar names it, and says endless (2026-10-13)");
    assert.ok(!loaded.includes('id="nowline"'), "and no second line above the wall says it again");
    assert.ok(!loaded.includes("not from a preset"));
    const spk = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`), e)).text();
    assert.match(spk, /Master Bedroom · preset 8, Dr\. Funkenstein · endless/, "the Speakers tab's bar too");
    // Another playlist on the Echo is still not a preset.
    player.now = { pid: "5zzzzzzzzzzzzzzzzzzzzz", at: 0, device: "Master Bedroom" };
    const other = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.equal(other.preset, undefined);
    assert.equal(other.from, "a playlist");
  } finally { sp.restore(); }
});

// THREE FROM THE ROOM, 2026-09-24. Sunny's Start fresh for the Master
// Bedroom landed while the Echo slept; the page said "being made" over a set
// that was ready and silent, then over one that was playing; and the bar's
// "Paused · Monk" played a song no longer on 9 after Sunny's sets replaced it.
function failingPlays(sp, fail) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (fail.on && init.method === "PUT" && (url.pathname === "/v1/me/player/play" || url.pathname === "/v1/me/player")) {
      return Response.json({ error: { status: 404, message: "Not found." } }, { status: 404 });
    }
    return inner(u, init);
  };
  return () => { globalThis.fetch = inner; };
}
const page = async (e, path) => (await worker.fetch(new Request(`https://x.test${path}`), e)).text();

test("a fresh set that lands while the speaker sleeps: the page says so, and Play it now starts the set as it stands", async () => {
  const player = { now: null };
  const sp = spotify(player);
  const fail = { on: true };
  const unfail = failingPlays(sp, fail);
  try {
    const e = env();
    assert.equal((await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" })).status, "asked");
    const [job] = await endlessJobs(e);
    const runs = doc(e).runs;
    const out = await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(out.status, "fresh");
    assert.equal(out.started_on, undefined, "it did not start");
    const vibe = await page(e, `/buttons/${KEY}/vibe`);
    assert.match(vibe, /The fresh set is ready\. The Pro Plus has signed off Spotify after sitting idle/);
    assert.match(vibe, /<button class="lanebtn" type="submit" form="endfresh" name="do" value="start"><span class="laneic" aria-hidden="true"><svg[^]*?<\/svg><\/span>Play it now<\/button>/);
    assert.match(vibe, /<option selected>Pro Plus<\/option>/, "the speaker it missed is the one chosen, and can be changed (the trial, 2026-10-17)");
    // Still asleep: said again, nothing spent.
    const post = () => worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/endless`, { method: "POST",
      body: new URLSearchParams({ do: "start", device: "Pro Plus" }) }), e);
    let r = await post();
    assert.match(r.headers.get("location"), /endless=start-asleep/);
    assert.match(await page(e, r.headers.get("location")), /The Pro Plus has signed off Spotify after sitting idle[^<]*then tap Play it now again\. Nothing was changed\./);
    // Awake: it plays, the miss is cleared, and no run was used.
    fail.on = false;
    player.now = { pid: P4, at: 1, id: "device-1" };  // what the read-back after the play sees
    r = await post();
    assert.match(r.headers.get("location"), /endless=start-ok/);
    assert.equal(doc(e).runs, runs, "Play it now is not a run");
    assert.equal(await e.PROGRAMS.get("endless:nostart:4"), null, "the miss is cleared");
    assert.ok(!(await page(e, `/buttons/${KEY}/vibe`)).includes("Play it now"), "the line and the button go");
  } finally { unfail(); sp.restore(); }
});

test("\"being made\" only while it is: the page's wait asks the ledger, and a stale flash is dropped", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" });
    const state = async () => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/endless`), e)).json();
    assert.deepEqual(await state(), { ok: true, making: true, steering: false });
    const waiting = await page(e, `/buttons/${KEY}/vibe?endless=fresh-asked&on=Pro+Plus`);
    assert.match(waiting, /A fresh set of Vibe is being made\. It starts on the Pro Plus in a few minutes\./);
    assert.match(waiting, /location\.replace\(location\.pathname\)/, "the page waits for it");
    const [job] = await endlessJobs(e);
    await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.deepEqual(await state(), { ok: true, making: false, steering: false });
    const after = await page(e, `/buttons/${KEY}/vibe?endless=fresh-asked&on=Pro+Plus`);
    assert.ok(!after.includes("is being made"), "the same address, reloaded after it landed, says nothing stale");
    assert.ok(!after.includes("location.replace(location.pathname)"), "and waits for nothing");
  } finally { sp.restore(); }
});

test("a fresh set that replaces a preset's list ends the bar's pause note pointing at it", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    const note = (pid) => JSON.stringify({ at: Date.now(), device: "Pro Plus", track: "Old song", uri: "spotify:track:old", pid, positionMs: 0 });
    await e.PROGRAMS.put("pause:last", note(P4));
    await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" });
    const [job] = await endlessJobs(e);
    await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    assert.equal(await e.PROGRAMS.get("pause:last"), null, "no play-again of a song the list no longer holds");
    // A note about another list is left alone.
    await e.PROGRAMS.put("pause:last", note(P8));
    await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" });
    const [job2] = await endlessJobs(e);
    await callTool(e, "extend_endless", { job_id: job2.job_id, uris: [T(4), T(5), T(6)] }, { remaining: 40 });
    assert.ok(await e.PROGRAMS.get("pause:last"), "Vibe's list is not Soul's");
  } finally { sp.restore(); }
});

// PLAY, AND SPOTIFY'S OWN PICKS (the owner, 2026-09-24).
test("Play beside Start fresh: the set as it stands on the picked speaker, no run, and the watch looks at its next run", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    const e = env();
    const vibe = await page(e, `/buttons/${KEY}/vibe`);
    // Play in the header, Start fresh in More, one form ("A DJ's Page, Calmer", 2026-10-24).
    assert.match(vibe, /<span class="vtag">House DJ · preset 4 · not playing<\/span>/);
    assert.match(vibe, /<button class="lanebtn" type="submit" form="endfresh" name="do" value="start"><span class="laneic" aria-hidden="true"><svg[^]*?<\/svg><\/span>Play<\/button>/);
    assert.match(vibe, /<button class="mrow" type="submit" form="endfresh" name="do" value="fresh">[^]*?Start fresh<small>/);
    // The speaker as a pill that opens a list (the owner, 2026-10-24); the select stays in the form.
    assert.match(vibe, /<span class="spkpick"><select class="devsel" id="enddev" name="device" form="endfresh" data-pick data-dj="vibe" aria-label="Speaker to play on">/);
    assert.match(vibe, /<button type="button" class="spkpill" data-spk-open="enddev" aria-haspopup="dialog">/);
    assert.match(vibe, /<div class="tvsheet msheet spksheet" id="spk">[^]*?<button type="button" class="mrow spkrow" data-spk="Pro Plus" aria-pressed="false">/);
    // The sheets slide, hold the page still and say the choice (the owner, 2026-10-24).
    // The motion rides in the bar's script, once; the DJ page's sheets wire up after it has run.
    assert.equal(vibe.match(/window\.houseSheet = function/g).length, 1);
    assert.match(vibe, /<div class="tvsheet msheet" id="more">[^]*?<div class="tvsheet msheet spksheet" id="spk">[^]*?<div class="nowbar[^]*?<script[^>]*>\nwindow\.houseSheet = function \(m, onShut\)/);
    assert.match(vibe, /<p class="vh" id="spksaid" aria-live="polite"><\/p>/);
    // A pick while this DJ plays moves the music (the owner, 2026-10-24): the
    // sheet asks the bar, which moves only this DJ's endless set.
    assert.match(vibe, /window\.houseDj = \{\n    on: function \(dj\) \{[^]*?o\.who\.endless && o\.who\.dj === dj/);
    assert.match(vibe, /var moved = !!\(cur && whose\(cur\) && window\.houseDj && window\.houseDj\.move\(d, whose\(cur\)\)\);/);
    assert.match(vibe, /var sheet = window\.houseSheet\(m\);[^]*?if \(window\.houseSheet\) wire\(\); else document\.addEventListener\("DOMContentLoaded", wire\);[^]*?var sheet = window\.houseSheet\(m, function/);
    await __test.endlessWatch(e, Date.now());
    const runs = doc(e).runs ?? 0;
    assert.ok(doc(e).lastLook > 0, "a look was made");
    player.now = { pid: P4, at: 1, id: "device-1" };
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/endless`, { method: "POST",
      headers: { cookie: "spk=pro-plus" }, body: new URLSearchParams({ do: "start" }) }), e);
    assert.match(r.headers.get("location"), /endless=start-ok&on=Pro\+Plus/);
    assert.equal(doc(e).runs ?? 0, runs, "no run");
    assert.equal((await endlessJobs(e)).length, 0, "no curator");
    assert.equal(doc(e).lastLook, 0, "the next run of the watch looks");
    assert.match(await page(e, r.headers.get("location")), /Vibe is playing on the Pro Plus\./);
    // Start fresh still asks for a new set, from the same form.
    player.now = null;
    const f = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/endless`, { method: "POST",
      body: new URLSearchParams({ do: "fresh", device: "Ultra" }) }), e);
    assert.match(f.headers.get("location"), /endless=fresh-asked&on=Ultra/);
  } finally { sp.restore(); }
});

test("a song not on a watched session's list is Spotify's pick after the preset, on the bar and the Speakers block", async () => {
  const player = { now: { pid: P4, at: 1, device: "Master Bedroom" } };
  const sp = spotify(player);
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Master Bedroom"]);
    await __test.endlessWatch(e, Date.now());
    assert.ok(Array.isArray(doc(e).sessions["4"]?.tracks), "the watch holds the list");
    let o = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.deepEqual(o.preset, { btn: 4, name: "Vibe", dj: "vibe", endless: true }, "a song on the list is the preset");
    player.now = { pid: P4, at: 99, device: "Master Bedroom" };
    o = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing?fresh=1`), e)).json();
    assert.deepEqual(o.preset, { btn: 4, name: "Vibe", dj: "vibe", endless: true, autoplay: true });
    assert.equal(o.speakerPreset.autoplay, true);
    const loaded = await page(e, `/buttons/${KEY}`);
    assert.match(loaded, /Master Bedroom · Spotify&#39;s pick, after preset 4, Vibe/);
    // Not endless: Spotify's own pick (2026-10-13).
    assert.equal(barWords(o).two, "Master Bedroom · Spotify's pick, after preset 4, Vibe");
  } finally { sp.restore(); }
});

// THE ECHO CHOSEN ON THE BAR'S PANEL (the owner, 2026-09-24): a quiet Echo
// had no block on the Speakers tab, so the Pro Plus stayed highlighted while
// the bar spoke for the Echo.
test("the Speakers tab draws a block for the chosen speaker even when it is quiet, and none claims the pick without one", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Master Bedroom"]);
    const wiim = (cookie) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`, cookie ? { headers: { cookie } } : {}), e).then((r) => r.text());
    const chosen = await wiim("spk=master-bedroom");
    // The one speaker (MC-28): the last choice, with nothing playing — its
    // block is the picked one.
    assert.match(chosen, /<button type="button" class="sblock pick" data-speaker="Master Bedroom" data-slug="master-bedroom" data-room="1" data-other/);
    assert.ok(!/class="sblock[^"]*pick" data-speaker="Pro Plus"/.test(chosen), "and no WiiM looks chosen beside it");
    const none = await wiim(null);
    assert.ok(!none.includes('data-slug="master-bedroom"'), "a quiet Echo nobody chose is not drawn");
    assert.ok(!(await wiim("spk=pro-plus")).includes('data-slug="master-bedroom"'));
    // The script clears the pick for a choice with no block, rather than
    // leaving another speaker looking chosen.
    assert.match(none, /if \(!found\) \{\s*if \(!slug\) return;\s*if \(follow\(slug\)\) return;\s*blocks\.forEach\(function \(b\) \{ b\.classList\.remove\("pick"\)/);
  } finally { sp.restore(); }
});

// "PLAY ON" MOVES THE MUSIC (the owner, 2026-09-24): the bar's panel only
// pointed the app at the Master Bedroom while the Pro Plus played on.
test("move: the playing music goes to the speaker tapped, by Spotify's transfer; quiet or already there sends nothing; asleep is said", async () => {
  const sp = spotify({ now: null });
  const inner = globalThis.fetch;
  const st = { device: "Pro Plus", playing: true, asleep: false, slow: 0 }, puts = [], plays = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u)); const m = init.method ?? "GET";
    if (url.pathname === "/v1/me/player/devices") return Response.json({ devices: [{ id: "d-pro", name: "Pro Plus" }, { id: "d-mb", name: "Master Bedroom" }] });
    if (url.pathname === "/v1/me/player" && m === "GET") return st.playing
      ? Response.json({ is_playing: true, device: { id: st.device === "Pro Plus" ? "d-pro" : "d-mb", name: st.device }, item: { uri: "spotify:track:x", name: "X", artists: [] } })
      : new Response(null, { status: 204 });
    if (url.pathname === "/v1/me/player" && m === "PUT") {
      puts.push(JSON.parse(init.body || "{}"));
      if (st.slow > 0) { st.slow--; return Response.json({ error: { status: 404 } }, { status: 404 }); }
      return st.asleep ? Response.json({ error: { status: 404 } }, { status: 404 }) : new Response(null, { status: 204 });
    }
    if (url.pathname === "/v1/me/player/play" && m === "PUT") {
      plays.push({ device: url.searchParams.get("device_id"), body: JSON.parse(init.body || "{}") });
      return st.asleep ? Response.json({ error: { status: 404 } }, { status: 404 }) : new Response(null, { status: 204 });
    }
    return inner(u, init);
  };
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Master Bedroom"]);
    const move = async (device) => (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, { method: "POST",
      headers: { accept: "application/json", origin: "https://x.test" }, body: new URLSearchParams({ do: "move", device }) }), e)).json();
    assert.deepEqual(await move("Master Bedroom"), { ok: true, code: "ok" });
    assert.deepEqual(puts.at(-1), { device_ids: ["d-mb"], play: true });
    assert.equal((await move("Pro Plus")).code, "here", "already there: nothing sent");
    assert.equal(puts.length, 1);
    // Slow to take it (the Echo, 2026-09-24): two refused transfers, then the
    // same song started there at the same place.
    st.slow = 2;
    assert.deepEqual(await move("Master Bedroom"), { ok: true, code: "ok" });
    assert.equal(puts.length, 3, "the transfer, and once more");
    assert.deepEqual(plays.at(-1), { device: "d-mb", body: { uris: ["spotify:track:x"], position_ms: 0 } });
    st.asleep = true;
    assert.equal((await move("Master Bedroom")).code, "asleep");
    st.playing = false;
    assert.equal((await move("Master Bedroom")).code, "quiet", "nothing playing: the tap only picks");
    // Only from the bar's script: a plain form cannot move.
    const form = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim/transport`, { method: "POST",
      body: new URLSearchParams({ do: "move", device: "Master Bedroom" }) }), e);
    assert.equal(form.status, 400);
  } finally { globalThis.fetch = inner; sp.restore(); }
});

// A WIIM THAT SIGNED OFF SPOTIFY (the owner, 2026-09-24, 18:42: the Pro Plus,
// idle half an hour, was on the phone's Wi-Fi list and off Spotify's online
// one). The words say what happened and the two ways back.
test("a WiiM that does not answer has signed off: choose it in the Spotify app or press a preset; an Echo still sleeps", async () => {
  const { shutWords } = await import("../programs.js");
  assert.match(shutWords("Pro Plus", "wiim"), /^The Pro Plus has signed off Spotify after sitting idle, so nothing could be sent to it\. Open the Spotify app, tap the speaker icon and choose the Pro Plus, or press a Spotify preset on its remote — then press Play again\. Nothing was changed\.$/);
  assert.equal(shutWords("Master Bedroom", "other"), null, "an Echo keeps its own words");
  const e = env();
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Master Bedroom"]);
  const shelf = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}?played=asleep&on=Pro+Plus&slug=x`), e)).text();
  assert.match(shelf, /The Pro Plus has signed off Spotify after sitting idle/);
  const echo = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}?played=asleep&on=Master+Bedroom&slug=x`), e)).text();
  assert.match(echo, /Master Bedroom is not on Spotify’s device list right now/);
  // And the bar's own two, chosen in the page by the bar's WiiM list (the
  // Shelf has no bar; a DJ's page has).
  const dj = await page(e, `/buttons/${KEY}/vibe`);
  assert.match(dj, /isWiim\(name\) \? SAY_MOVE\.wiim/);
  assert.match(dj, /isWiim\(device\) \? SAY_AGAIN\.wiim/);
});

// THE IPHONE AS A SPEAKER (the owner, 2026-09-24, from the office). A phone
// is missing from Spotify's list because its app is shut, not because it
// sleeps, so the Echo's "wake it" would be the wrong advice.
test("a phone that does not answer is told to open its Spotify app, not to wake", async () => {
  const sp = spotify({ now: null });
  const unfail = failingPlays(sp, { on: true });
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "iPhone"]);
    await __test.endlessStartFresh(e, { button: 4, device: "iPhone" });
    const [job] = await endlessJobs(e);
    await callTool(e, "extend_endless", { job_id: job.job_id, uris: [T(1), T(2), T(3)] }, { remaining: 40 });
    const vibe = await page(e, `/buttons/${KEY}/vibe`);
    assert.match(vibe, /The fresh set is ready\. The iPhone is not in Spotify(?:'|&#39;)s list, so nothing could be sent to it — open the Spotify app on the phone and play anything for a moment, then tap Play it now\./);
    assert.ok(!/iPhone did not answer: it is asleep/.test(vibe));
    const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/endless`, { method: "POST",
      body: new URLSearchParams({ do: "start", device: "iPhone" }) }), e);
    assert.match(r.headers.get("location"), /endless=start-asleep/);
    assert.match(await page(e, r.headers.get("location")), /The iPhone is not in Spotify(?:'|&#39;)s list, so nothing could be sent to it — open the Spotify app on the phone[^<]*tap Play it now again/);
  } finally { unfail(); sp.restore(); }
});

// THE THIRD BLOCK FOLLOWS THE MUSIC (the owner, 2026-09-24, 18:03 and 18:06):
// the iPhone's block stayed beside a playing Pro Plus, and music moved to the
// Living Room had no block at all.
test("the third block is the other speaker in use: not the chosen one while a WiiM plays, the playing Echo over the chosen phone", async () => {
  const player = { now: null };
  const sp = spotify(player);
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Living Room", "iPhone"]);
    const wiim = () => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`, { headers: { cookie: "spk=iphone" } }), e).then((r) => r.text());
    assert.match(await wiim(), /data-slug="iphone" data-room="1" data-other/, "quiet: the chosen phone has its block");
    player.now = { pid: P4, at: 1, device: "Pro Plus" };
    const onWiim = await wiim();
    assert.ok(!onWiim.includes('data-slug="iphone"'), "a WiiM plays: the phone's block goes");
    player.now = { pid: P4, at: 1, device: "Living Room" };
    const onEcho = await wiim();
    assert.match(onEcho, /class="sblock on pick" data-speaker="Living Room" data-slug="living-room"/);
    assert.ok(!onEcho.includes('data-slug="iphone"'), "one block beyond the WiiMs");
    // The script knows which speakers it may follow, and follows once.
    assert.match(onEcho, /data-others="\[&quot;Living Room&quot;,&quot;iPhone&quot;\]"/);
    assert.match(onEcho, /sessionStorage\.setItem\("spk:followed", slug\)/);
    assert.match(onEcho, /if \(w\) w\.hidden = !\(s === now \|\| s === inUse\.on \|\| s === inUse\.held\)/);
  } finally { sp.restore(); }
});

// THE OWNER'S TWO FROM THE LOOK (2026-09-24): the iPhone's block wears a
// phone, and a pause the bar cannot play again draws no block.
test("the blocks carry no drawing (A); a paused queue with no play-again has no block, one that can be played again has", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Living Room", "iPhone"]);
    const wiim = (cookie) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/wiim`, { headers: { cookie } }), e).then((r) => r.text());
    const phone = await wiim("spk=iphone");
    // Direction A (MC-30 stage 6): the phone and the speakers lost their big drawings.
    assert.match(phone, /data-slug="iphone"/);
    assert.ok(!phone.includes('class="sghost"'), "no drawing in any block");
    const note = (pid) => e.PROGRAMS.put("pause:last", JSON.stringify({ at: Date.now(), device: "Living Room",
      track: "Seen and Not Seen", artists: "Talking Heads", uri: "spotify:track:t1", pid, positionMs: 0 }));
    await note(null);
    const queue = await wiim("spk=pro-plus");
    assert.ok(!queue.includes('data-slug="living-room"'), "a queue's pause: no block");
    assert.ok(!queue.includes("data-held="));
    await note(P4);
    const list = await wiim("spk=pro-plus");
    assert.match(list, /data-slug="living-room"/, "a playlist's pause: its block, to play again from the bar");
    assert.match(list, /data-held="living-room"/);
    assert.match(list, /o\.paused && o\.paused\.again \? o\.paused : null/, "and the poll draws the same");
  } finally { sp.restore(); }
});

// THE TIDAL GUEST'S DOOR IN THE BAR'S PANEL (the owner, 2026-09-24, preset 2
// playing): the house cannot see Tidal, so the panel offers the Tidal guest's
// playlist in the Tidal app whenever the speaker has no Spotify.
test("the bar's panel carries an Open in Tidal row, shown only while the speaker has no Spotify — and not while the helper says another source", async () => {
  const sp = spotify({ now: null });
  try {
    const e = env();
    const html = await page(e, `/buttons/${KEY}/vibe`);
    // Design A (2026-09-25): Tidal's own mark, then a Playlist button.
    assert.match(html, /<div class="nblinks nbtidalrow" hidden><span class="nbmark"><svg[^>]*aria-label="Tidal">[\s\S]*?<a class="nblb nbtidal" href="#"[^>]*hidden>/);
    assert.ok(html.includes(`var tidalOffer = ${inlineFn(tidalOffer)};`), "the bar runs the function tested below");
    assert.match(html, /var td = tidalOffer\(o, last\), tb = sheet\.querySelector\("\.nbtidal"\);\s*var showT = !!td;/);
  } finally { sp.restore(); }
});

test("the bar's panel runs steerOf for its steer buttons and the line saying why not", async () => {
  const sp = spotify({ now: null });
  try {
    const html = await page(env(), `/buttons/${KEY}/vibe`);
    assert.match(html, /<\/div><p class="nbwhy" hidden><\/p>/);
    assert.ok(html.includes(`var steerOf = ${inlineFn(steerOf)};`));
    assert.match(html, /var sv = steerOf\(o\) \|\| \{\};\s*st\.hidden = !sv\.dj;/);
    assert.match(html, /why\.hidden = !sv\.why; why\.textContent = sv\.why \|\| "";/);
  } finally { sp.restore(); }
});

// WITH THE HELPER ON, ONLY ITS WORD (the owner, 2026-09-28, 19:16: the panel
// drawn in the seconds after key 3, before the helper's reading caught Amazon
// Music, offered Tidal again). `o` is the answer as the bar narrows it.
test("the Tidal row: with the helper on, only while its reading says Tidal; without it, whenever Spotify is not playing", async () => {
  const { tidalOffer } = await import("../programs.js");
  const tidal = { url: "https://tidal.com/playlist/x", name: "Requests · Tidal" };
  const lan = { at: 1, speakers: {} };
  const quiet = { state: "quiet", speaker: "Pro Plus" };
  const on = (source, lanState = "play") => ({ state: "lan", speaker: "Pro Plus", source, lanState });
  // The helper on.
  assert.equal(tidalOffer(on("Tidal"), { tidal, lan }), tidal, "Tidal playing");
  assert.equal(tidalOffer(on("Tidal", "pause"), { tidal, lan }), tidal, "Tidal paused");
  assert.equal(tidalOffer(on("Prime"), { tidal, lan }), null, "Amazon Music playing");
  assert.equal(tidalOffer(quiet, { tidal, lan }), null,
    "quiet by the reading (the seconds after a press, Spotify's pause, a stop): not Tidal");
  // The helper off: nobody knows, and the offer stands while Spotify is not playing.
  assert.equal(tidalOffer(quiet, { tidal }), tidal);
  assert.equal(tidalOffer({ state: "unknown" }, { tidal }), tidal);
  // Either way: never over Spotify, and nothing without a Tidal guest.
  assert.equal(tidalOffer({ state: "playing", device: "Pro Plus" }, { tidal, lan }), null);
  assert.equal(tidalOffer({ state: "playing", device: "Pro Plus" }, { tidal }), null);
  assert.equal(tidalOffer(on("Tidal"), { lan }), null);
  assert.equal(tidalOffer(quiet, { tidal: { name: "no url" } }), null);
});
