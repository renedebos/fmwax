// ADD A DJ PRESET (MC-40 stage 4, tasks/mc40-dj-presets.md): a DJ on a number
// of their own, made on the setup page with an hour of that DJ's songs,
// before the house has a curator. The preset waits (its ENDLESS carries the
// word) until a curator first checks in; where one already works it is
// endless from the start.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { CURATOR_SEEN_KEY } from "../services.js";
import { forgetKeptSettings, withSettings } from "../settings.js";
import { STARTERS } from "../starters.js";
import { makeEnv, makeHouseStore, installFetch } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
const REQ = "REQUESTS00000000000001";
async function house() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.PROGRAM_LIBRARY_KEY = "pagekey12345";
  e.AGENT_SECRET = "agent-key-0123456789";
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: REQ, catalog: "spotify" }]);
  delete e.ENDLESS;
  delete e.REQUEST_ROUTINE_ID;
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
const claim = async (e) => ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
// Spotify making playlists, and a record of what was put in each.
function spotifyMakes({ refuseSongs = false } = {}) {
  const f = installFetch();
  const inner = globalThis.fetch;
  const made = [], filled = {};
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (init.method === "POST" && url.pathname.endsWith("/me/playlists")) {
      const id = `NEWPLAYLIST${String(made.length + 1).padStart(11, "0")}`;
      made.push({ id, name: JSON.parse(init.body).name });
      return Response.json({ id, name: JSON.parse(init.body).name }, { status: 201 });
    }
    const m = url.pathname.match(/^\/v1\/playlists\/([^/]+)\/items$/);
    if (m && init.method === "POST") {
      if (refuseSongs) return new Response("no", { status: 500 });
      (filled[m[1]] ??= []).push(...JSON.parse(init.body).uris);
      return Response.json({ snapshot_id: "s" });
    }
    return inner(u, init);
  };
  return { made, filled, restore: () => { globalThis.fetch = inner; f.restore(); } };
}
const stored = async (e) => { forgetKeptSettings(e); const s = await withSettings(e, null); return s.ENDLESS ? JSON.parse(s.ENDLESS) : null; };

test("a DJ preset is made with no curator: a playlist with the DJ's starter set, the preset in ENDLESS, and the word that it waits", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    const page = await (await go(e, "/setup/dj-preset", { cookie: me })).text();
    assert.match(page, /Each DJ preset takes a few minutes to save on every WiiM\. Start with one\. Three is a good number to stop at\./);
    assert.match(page, /It plays its songs, about an hour, and stops\. For new songs, ask that DJ for a set in Claude or ChatGPT/);
    for (const name of ["Dr. Funkenstein", "Hank", "Vibe", "Americana", "Soul", "Pub Rock", "Sessions"]) assert.ok(page.includes(`>${name}</option>`), name);
    assert.doesNotMatch(page, /value="(deep-dive|genre|the-librarian|gatefold)"/, "the four who stay on Requests");
    assert.match(page, /<option value="1" disabled>1 · Requests<\/option>/, "a taken number is named and cannot be chosen");
    assert.match(page, /<option value="2" selected>2<\/option>/);

    const r = await go(e, "/setup/dj-preset", { method: "POST", form: { dj: "hank", button: "5" }, cookie: me });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/setup/dj-preset?made=5");
    assert.deepEqual(s.made.map((m) => m.name), ["Hank"], "one private playlist, named for the DJ");
    assert.deepEqual(s.filled[s.made[0].id], STARTERS.hank.map((id) => `spotify:track:${id}`), "his starter set, in order");
    assert.deepEqual(await stored(e), { mode: "live", dailyRuns: 12, waits: true,
      presets: [{ button: 5, dj: "hank", playlist: s.made[0].id, hours: 4 }] });

    const after = await (await go(e, "/setup/dj-preset?made=5", { cookie: me })).text();
    assert.match(after, /The playlist "Hank" is in your Spotify account now, with about an hour of Hank's songs\./);
    assert.match(after, /Save it on preset 5/);
    assert.match(after, /For new ones, say or type: <q>Hank, an hour for tonight<\/q>/);
    assert.match(after, /5 · <a href="\/buttons\/pagekey12345\/hank">Hank<\/a>/, "made so far, with its Remove");
    assert.doesNotMatch(after, />Hank<\/option>/, "a DJ has one preset: he is not offered again");
    assert.match(after, /<option value="5" disabled>5 · Hank<\/option>/);
    // More can be added, and the page names who (the test house run,
    // 2026-11-10: "Another DJ" did not say so).
    assert.match(after, /<h3>Add another DJ preset<\/h3>/);
    assert.match(after, /<b>Dr\. Funkenstein, Vibe, Americana, Soul, Pub Rock and Sessions<\/b>/);
    assert.match(after, /You have one\. Three is a good number to stop at\./);
    // The checklist's section, and the curator still offered under Endless.
    const list = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(list, /<h2 id="slevel">Level 2 · DJ presets<\/h2>/, "the strip says where the house is");
    assert.match(list, /<h2 id="set-djpresets">Level 2 · DJ presets<\/h2>/);
    assert.match(list, /<h2 id="set-endless">Level 3 · Endless<\/h2>/);
    assert.match(list, /Hank · preset 5/);
    assert.match(list, /href="\/setup\/dj-preset">Add a DJ preset</);
    assert.match(list, /Add another DJ preset/);
    assert.match(list, /Dr\. Funkenstein, Vibe, Americana, Soul, Pub Rock and Sessions can have a preset of their own too/);
    assert.match(list, /Set up the curator/);
  } finally { s.restore(); }
});

test("the numbers and the DJs it refuses: Requests, another DJ's, the same DJ twice, a DJ with no starter set", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    const post = (form) => go(e, "/setup/dj-preset", { method: "POST", form, cookie: me });
    assert.equal((await post({ dj: "hank", button: "1" })).status, 400, "1 is the Requests preset");
    assert.equal((await post({ dj: "hank", button: "13" })).status, 400);
    assert.equal((await post({ dj: "deep-dive", button: "4" })).status, 400, "Deep Dive must be told what to play");
    assert.equal((await post({ dj: "the-librarian", button: "4" })).status, 400);
    assert.equal(s.made.length, 0, "nothing made by a refusal");
    assert.equal((await post({ dj: "hank", button: "5" })).status, 303);
    assert.equal((await post({ dj: "vibe", button: "5" })).status, 400, "5 is Hank's now");
    assert.equal((await post({ dj: "hank", button: "6" })).status, 409, "Hank has one already");
    assert.equal((await post({ dj: "vibe", button: "6" })).status, 303, "a second DJ, and a third would follow: three is advice, not a limit");
    const cfg = await stored(e);
    assert.deepEqual(cfg.presets.map((p) => [p.button, p.dj]), [[5, "hank"], [6, "vibe"]]);
    assert.equal(cfg.waits, true, "adding a preset keeps the word");
  } finally { s.restore(); }
});

test("Remove frees the number and keeps the word; the DJ's playlist is used again if they come back", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    const post = (form) => go(e, "/setup/dj-preset", { method: "POST", form, cookie: me });
    await post({ dj: "hank", button: "5" });
    await post({ dj: "vibe", button: "6" });
    const gone = await post({ do: "remove", button: "5" });
    assert.equal(gone.headers.get("location"), "/setup/dj-preset?removed=5");
    let cfg = await stored(e);
    assert.deepEqual(cfg.presets.map((p) => p.dj), ["vibe"]);
    assert.equal(cfg.waits, true);
    assert.equal((await post({ do: "remove", button: "1" })).status, 400, "Requests is not a DJ's preset");
    // Hank again, on another number: his own playlist, not a second "Hank".
    assert.equal((await post({ dj: "hank", button: "7" })).status, 303);
    cfg = await stored(e);
    assert.equal(cfg.presets.find((p) => p.dj === "hank").playlist, s.made[0].id);
    assert.equal(s.made.filter((m) => m.name === "Hank").length, 1);
  } finally { s.restore(); }
});

test("Spotify refusing the songs still leaves the preset made, and the page says to ask the DJ first", async () => {
  const s = spotifyMakes({ refuseSongs: true });
  try {
    const e = await house();
    const me = await claim(e);
    const r = await go(e, "/setup/dj-preset", { method: "POST", form: { dj: "soul", button: "4" }, cookie: me });
    assert.equal(r.headers.get("location"), "/setup/dj-preset?made=4&empty=1");
    assert.equal((await stored(e)).presets[0].dj, "soul");
    const page = await (await go(e, "/setup/dj-preset?made=4&empty=1", { cookie: me })).text();
    assert.match(page, /Ask Soul for a set in Claude or ChatGPT first: it fills\s+the playlist/);
    assert.doesNotMatch(page, /with about an hour of Soul's songs/);
  } finally { s.restore(); }
});

test("a preset added once a curator has checked in carries no word, and the page says it plays for as long as you listen", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() }));
    const page = await (await go(e, "/setup/dj-preset", { cookie: me })).text();
    assert.match(page, /It plays for as long as you listen: your curator adds songs as it runs low\./);
    await go(e, "/setup/dj-preset", { method: "POST", form: { dj: "americana", button: "7" }, cookie: me });
    const cfg = await stored(e);
    assert.equal("waits" in cfg, false);
    assert.deepEqual(cfg.presets.map((p) => [p.button, p.dj]), [[7, "americana"]]);
    assert.deepEqual(s.filled[s.made[0].id], STARTERS.americana.map((id) => `spotify:track:${id}`), "the starter hour stands in for a first fresh set");
  } finally { s.restore(); }
});

test("only the owner makes one, and a house whose presets come from its file is not offered the page's form", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    assert.equal((await go(e, "/setup/dj-preset", { method: "POST", form: { dj: "hank", button: "5" } })).status, 303, "not signed in: back to setup");
    assert.equal(s.made.length, 0);
    const f = await house();
    f.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 4, dj: "vibe", playlist: "VIBEPLAYLIST0000000004", hours: 4 }] });
    const mine = await claim(f);
    const page = await (await go(f, "/setup/dj-preset", { cookie: mine })).text();
    assert.match(page, /set in its own file, so they are not made here/);
    assert.equal((await go(f, "/setup/dj-preset", { method: "POST", form: { dj: "hank", button: "5" }, cookie: mine })).status, 409);
    assert.equal(s.made.length, 0);
  } finally { s.restore(); }
});

test("the Endless step adds the guest DJ preset to the presets that are there, once a curator has checked in", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    const post = (path, form) => go(e, path, { method: "POST", form, cookie: me });
    await post("/setup/dj-preset", { dj: "hank", button: "5" });
    await post("/setup/dj-preset", { dj: "vibe", button: "6" });
    // No curator set up: the page says so, and nothing is made.
    let page = await (await go(e, "/setup/endless", { cookie: me })).text();
    assert.match(page, /The guest DJ preset/);
    assert.match(page, /Your DJ presets \(5 Hank · 6 Vibe\) each belong to one DJ/);
    assert.match(page, /Set up the curator first/);
    assert.equal((await post("/setup/endless", { lane: "3" })).status, 409);
    // A curator set up but not yet heard from: the presets still wait.
    await post("/setup/curator", { routine: "trig_01ABCDEFGHIJKL", token: "t".repeat(40) });
    page = await (await go(e, "/setup/endless", { cookie: me })).text();
    assert.match(page, /Your curator has not checked in yet/);
    assert.equal((await post("/setup/endless", { lane: "3" })).status, 409, "a lane in a house that waits would file work nobody answers");
    assert.equal(s.made.filter((m) => m.name === "Guest DJ").length, 0);
    // The curator checks in: the word goes, and the step opens.
    const { stampCurator } = await import("../services.js");
    forgetKeptSettings(e);
    await stampCurator(await withSettings(e, null));
    assert.equal("waits" in (await stored(e)), false);
    // Said once, where the curator was set up: what changed, and the step left.
    const cur = await (await go(e, "/setup/curator", { cookie: me })).text();
    assert.match(cur, /<b>Your DJ presets are endless now:<\/b> they add songs by themselves while they play\. A set you ask a DJ for goes on Requests \(preset 1\) from now on\./);
    assert.match(cur, /href="\/setup\/endless">Next: the guest DJ preset</);
    const list3 = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(list3, /Where your house is<\/p>\s*<h2 id="slevel">Level 3 · Endless<\/h2>/);
    assert.match(list3, /Make the guest DJ preset/);
    page = await (await go(e, "/setup/endless", { cookie: me })).text();
    assert.match(page, /<option value="3" selected>3<\/option>/);
    assert.doesNotMatch(page, /<option value="(1|5|6)"/, "Requests and the DJs' own numbers are not offered");
    assert.equal((await post("/setup/endless", { lane: "5" })).status, 400, "5 is Hank's");
    const made = await post("/setup/endless", { lane: "3" });
    assert.equal(made.headers.get("location"), "/setup/endless?lane=made");
    const cfg = await stored(e);
    assert.deepEqual(cfg.presets.map((p) => [p.button, p.lane ? "lane" : p.dj]), [[5, "hank"], [6, "vibe"], [3, "lane"]], "every preset and number kept");
    assert.equal(s.made.filter((m) => m.name === "Guest DJ").length, 1);
    const done = await (await go(e, "/setup/endless?lane=made", { cookie: me })).text();
    assert.match(done, /5: Hank · 6: Vibe · 3: any other DJ/);
    // For all the other DJs, by name (the owner, the test house run, 2026-11-10).
    assert.match(done, /<b>Preset 3 is for all the other DJs\.<\/b> Hank and Vibe each have a\s+number of their own\. Every other DJ plays on 3: /);
    assert.doesNotMatch(done.match(/Every other DJ plays on 3: ([^.]*)\./)[1], /Hank|Vibe/, "the DJs with a number are not the guests");
    assert.match(done, /<b>Save preset 3 once\.<\/b>[\s\S]*?the playlist\s+<b>Guest DJ<\/b>, preset <b>3<\/b>\. You never save it again/);
    assert.doesNotMatch(done, /first set is being written/, "their presets came with their songs: nothing is being written");
    assert.equal((await post("/setup/endless", { lane: "4" })).status, 409, "once");
  } finally { s.restore(); }
});

test("the ChatGPT curator's page: a third step names the DJ presets that wait, and ticks once it answers", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    const post = (path, form) => go(e, path, { method: "POST", form, cookie: me });
    await post("/setup/dj-preset", { dj: "hank", button: "5" });
    await post("/setup/dj-preset", { dj: "vibe", button: "6" });
    await post("/setup/curator/use", { who: "chatgpt" });
    // Chosen, not yet heard from: the presets wait, by name and number.
    let page = await (await go(e, "/setup/curator?saved=1", { cookie: me })).text();
    assert.match(page, /<li class="todo">[\s\S]*?<b>Your DJ presets go endless[\s\S]*?Once it answers a test, Hank on 5 and Vibe on 6 add songs by themselves\./);
    assert.doesNotMatch(page, /Once you make ChatGPT the curator, below/, "nothing below to make once it is made");
    // It answers: the step ticks, and the page leads on.
    const { stampCurator } = await import("../services.js");
    forgetKeptSettings(e);
    await stampCurator(await withSettings(e, null));
    page = await (await go(e, "/setup/curator", { cookie: me })).text();
    assert.match(page, /<li class="done">[\s\S]*?<b>Your DJ presets are endless now[\s\S]*?Requests \(preset 1\) from now on\./);
    assert.match(page, /href="\/setup\/endless">Next: the guest DJ preset</);
  } finally { s.restore(); }
});

test("a backup taken while the presets wait puts them back waiting, the word included", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    await go(e, "/setup/dj-preset", { method: "POST", form: { dj: "hank", button: "5" }, cookie: me });
    const file = await (await go(e, "/setup/backup", { cookie: me })).text();
    assert.equal(JSON.parse(JSON.parse(file).page.ENDLESS).waits, true, "the backup holds the word");
    await go(e, "/setup/dj-preset", { method: "POST", form: { do: "remove", button: "5" }, cookie: me });
    assert.deepEqual((await stored(e)).presets, []);
    const fd = new FormData();
    fd.append("file", new File([file], "house-backup.json", { type: "application/json" }));
    const r = await worker.fetch(new Request(`${ORIGIN}/setup/restore`, { method: "POST", redirect: "manual", headers: { cookie: me, origin: ORIGIN }, body: fd }), e, null);
    assert.ok(r.status < 400, `restore answered ${r.status}`);
    const cfg = await stored(e);
    assert.equal(cfg.waits, true, "still a house that waits for its curator");
    assert.deepEqual(cfg.presets.map((p) => [p.button, p.dj]), [[5, "hank"]]);
  } finally { s.restore(); }
});
