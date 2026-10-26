// THE SETUP CHECKLIST (MC-31 stage 6, first part, 2026-10-16): the setup
// page, for the owner, ticks each step by looking at the house itself
// (checklist.js, renderSetup).
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { setupChecklist } from "../checklist.js";
import { CURATOR_SEEN_KEY } from "../services.js";
import { makeEnv, makeHouseStore, installFetch, PID } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function house(over = {}) {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.MCP_SECRET = "owner-mcp";
  e.HOUSE_TZ = "America/Los_Angeles";
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57", Ultra: "192.168.4.78" });
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" }]);
  Object.assign(e, over);
  return e;
}
async function claimed(e) {
  const r = await worker.fetch(new Request(`${ORIGIN}/setup/claim`, { method: "POST", headers: { origin: ORIGIN },
    body: new URLSearchParams({ key: KEY }) }), e, null);
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
}
const page = async (e, cookie) => (await worker.fetch(new Request(`${ORIGIN}/setup`, { headers: cookie ? { cookie } : {} }), e, null)).text();
const row = (list, title) => list.sections.flatMap((s) => s.rows).find((r) => r.title === title);
const read = (e, slug, presets) => e.PROGRAMS.put(`reading:${slug}`, JSON.stringify({ at: new Date().toISOString(), presets }));

test("the owner sees the checklist; anyone else does not", async () => {
  const e = await house();
  const cookie = await claimed(e);
  const mine = await page(e, cookie);
  assert.match(mine, /Every step ticks itself/);
  assert.match(mine, /Claimed/);
  assert.match(mine, /Pro Plus is the default/);
  const theirs = await page(e, null);
  assert.doesNotMatch(theirs, /Every step ticks itself/);
  assert.match(theirs, /This house has an owner/);
});

test("Claude or ChatGPT ticks once the owner's connector has called", async () => {
  const f = installFetch();
  try {
    const e = await house();
    await claimed(e);
    const owner = { claimed_at: new Date().toISOString() };
    assert.equal(row(await setupChecklist(e, owner), "Claude or ChatGPT").state, "todo");
    const waits = [];
    await worker.fetch(new Request(`${ORIGIN}/mcp/owner-mcp`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    const app = row(await setupChecklist(e, owner), "Claude or ChatGPT");
    assert.equal(app.state, "done");
    assert.match(app.detail, /last call at \d\d:\d\d/);
  } finally { f.restore(); }
});

test("presets are ticked from the helper's readings, and unknown without them", async () => {
  const e = await house();
  const owner = { claimed_at: new Date().toISOString() };
  assert.equal(row(await setupChecklist(e, owner), "Preset 1").state, "unknown");
  await read(e, "pro-plus", [{ btn: 1, name: "Requests - Spotify", source: "Spotify" }]);
  await read(e, "ultra", [{ btn: 1, name: "KQED-FM", source: "TuneIn" }]);
  const half = row(await setupChecklist(e, owner), "Preset 1");
  assert.equal(half.state, "todo");
  assert.match(half.detail, /not saved yet on Ultra/);
  await read(e, "ultra", [{ btn: 1, name: "Requests · Spotify", source: "Spotify" }]);
  const both = row(await setupChecklist(e, owner), "Preset 1");
  assert.equal(both.state, "done");
  assert.match(both.detail, /saved on Pro Plus and Ultra/);
});

test("a house with no curator or endless shows Endless as off, and the optional parts without rows", async () => {
  const e = await house();
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  const by = Object.fromEntries(list.sections.map((s) => [s.key, s]));
  assert.equal(by.endless.rows.length, 0);
  assert.equal(by.endless.count, "Off");
  assert.equal(by.helper.count, "Optional");
  assert.equal(by.talk.count, "Optional");
  assert.equal(list.allDone, false);
});

test("the home helper is missed only once it has ever reported: every claimed house has its key", async () => {
  const { station } = await import("../station.js");
  const e = await house({ HELPER_SECRET: "helper-key" });
  const never = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  const offered = never.sections.find((s) => s.key === "helper").rows;
  assert.deepEqual(offered.map((r) => r.state), ["offer"], "never ran one: offered (MC-31 stage 5), never 'may be asleep'");
  assert.doesNotMatch(offered[0].detail, /asleep/);
  await station(e, "helper-put", { doc: { boxes: {} } });
  const away = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  assert.match(row(away, "Connected").detail, /may be asleep/);
});

test("a done step keeps a way back to its page (the owner's second run, 2026-10-17)", async () => {
  const cfg = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 2, dj: "vibe", playlist: PID, hours: 4 }] });
  const e = await house({ AGENT_SECRET: "agent", REQUEST_ROUTINE_ID: "trig_x", ENDLESS: cfg, __page: { ENDLESS: cfg } });
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() }));
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  const cur = row(list, "Curator"), djs = row(list, "DJ presets");
  assert.equal(cur.state, "done");
  assert.deepEqual([cur.href, cur.always], ["/setup/curator", true]);
  assert.deepEqual([djs.href, djs.always], ["/setup/endless", true], "made on the page: its page again");
  const fromFile = await setupChecklist(await house({ AGENT_SECRET: "agent", REQUEST_ROUTINE_ID: "trig_x", ENDLESS: cfg }),
    { claimed_at: new Date().toISOString() });
  assert.equal(row(fromFile, "DJ presets").href, undefined, "a house's own file is not the page's to show");
  // But it has a way to change who is on them, and to see the saves (the owner, 2026-10-19).
  const fileHouse = await house({ AGENT_SECRET: "agent", REQUEST_ROUTINE_ID: "trig_x", ENDLESS: cfg });
  await read(fileHouse, "pro-plus", [{ btn: 2, source: "Spotify", name: "Vibe" }]);
  await read(fileHouse, "ultra", [{ btn: 2, source: "Spotify", name: "Vibe" }]);
  const linked = await setupChecklist(fileHouse, { claimed_at: new Date().toISOString() }, { base: "/buttons/k" });
  assert.deepEqual([row(linked, "DJ presets").href, row(linked, "DJ presets").label, row(linked, "DJ presets").always],
    ["/buttons/k/djs", "Change on the DJs tab", true]);
  const saved = row(linked, "Saved on the WiiM devices");
  assert.deepEqual([saved.state, saved.href, saved.always], ["done", "/buttons/k/wiim", true]);
});

test("the house on the phone: how to add it to the home screen, a link that opens it in a new tab, counted neither way", async () => {
  const e = await house({ PROGRAM_LIBRARY_KEY: "pagekey12345" });
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() }, { base: "/buttons/pagekey12345" });
  const r = row(list, "On your phone");
  assert.equal(r.state, "unknown", "not seen from here: neither for nor against");
  assert.deepEqual([r.href, r.newTab], ["/buttons/pagekey12345/wiim", true]);
  assert.match(r.detail, /iPhone: in Safari, tap Share[^.]*, then Add to Home Screen\. Android: in Chrome, tap ⋮, then Add to Home screen or Install app\./);
  // How it gets to the phone (Codex, 2026-10-17): this page's address, signed in with the code.
  const withOrigin = await setupChecklist(e, { claimed_at: new Date().toISOString() }, { base: "/buttons/pagekey12345", origin: ORIGIN });
  assert.deepEqual(row(withOrigin, "On your phone").copy, { label: "This page's address, for your phone", value: `${ORIGIN}/setup` });
  assert.match(row(withOrigin, "On your phone").detail, /sign in with your recovery code/);
});

test("all the house can check done, with steps it cannot see: said so, never \"set up\" (Codex, 2026-10-17)", async () => {
  const html = (await import("../programs.js")).renderSetup({ state: "yours", checklist: {
    sections: [{ key: "core", title: "Core", sub: "s", count: "1 of 1", rows: [{ title: "Claimed", state: "done", detail: "d" },
      { title: "Requests preset", state: "unknown", detail: "d" }] }],
    done: 1, total: 1, due: 0, unseen: 1, unseenTitles: ["Requests preset"], allDone: true, coreDone: 1, coreTotal: 1, home: null } });
  assert.match(html, /Everything the house can check is done/);
  assert.match(html, /still yours to do by hand, as each says: Requests preset/);
  assert.doesNotMatch(html, /This house is set up/);
});

test("signing in to Spotify keeps a way back to the Spotify app's details (Codex, 2026-10-17)", async () => {
  const e = await house({ SPOTIFY_CLIENT_ID: "0123456789abcdef0123456789abcdef" });
  await e.TOKENS.delete("spotify");
  delete e.SPOTIFY_REFRESH_TOKEN;
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() }, { base: "/buttons/k" });
  const r = row(list, "Spotify");
  assert.equal(r.state, "todo");
  assert.deepEqual(r.also, { href: "/setup/spotify-app", label: "The Spotify app's details" });
});

test("the curator: done within the hour, a look wanted after it, to do before its first check-in", async () => {
  const e = await house({ AGENT_SECRET: "agent", REQUEST_ROUTINE_ID: "trig_x",
    ENDLESS: JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 5, dj: "hank", playlist: PID, hours: 4 }] }) });
  const owner = { claimed_at: new Date().toISOString() };
  assert.equal(row(await setupChecklist(e, owner), "Curator").state, "todo");
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() - 10 * 60 * 1000 }));
  const fresh = row(await setupChecklist(e, owner), "Curator");
  assert.equal(fresh.state, "done");
  assert.match(fresh.detail, /rung by web call · checked in (on \w+ )?at/, "yesterday's, just after midnight");
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() - 3 * 60 * 60 * 1000 }));
  assert.equal(row(await setupChecklist(e, owner), "Curator").state, "due");
  assert.match(row(await setupChecklist(e, owner), "DJ presets").detail, /^5 Hank$/);
});

test("Spotify: a login the house cannot date asks for one reconnect, with the link", async () => {
  const e = await house({ PROGRAM_LIBRARY_KEY: "pagekey12345" });
  const r = row(await setupChecklist(e, { claimed_at: new Date().toISOString() }, { base: "/buttons/pagekey12345" }), "Spotify");
  assert.equal(r.state, "due");
  assert.equal(r.href, "/buttons/pagekey12345/spotify");
});

test("a fresh house is not let off: no Spotify login, no requests preset, no time zone, an unread speaker", async () => {
  const e = await house({ BUTTONS: JSON.stringify([]), HOUSE_TZ: "" });
  await e.TOKENS.delete("spotify");
  delete e.SPOTIFY_REFRESH_TOKEN;
  const owner = { claimed_at: new Date().toISOString() };
  const list = await setupChecklist(e, owner);
  assert.equal(row(list, "Spotify").state, "todo");
  assert.match(row(list, "Spotify").detail, /Not signed in to Spotify yet/);
  assert.equal(row(list, "Requests preset").state, "todo");
  assert.equal(row(list, "Requests preset").href, "/setup/requests");
  assert.equal(row(list, "Time zone").state, "todo");
  assert.equal(row(list, "Time zone").href, "/setup/timezone");

  const two = await house();
  await read(two, "pro-plus", [{ btn: 1, name: "Requests - Spotify", source: "Spotify" }]);
  const half = row(await setupChecklist(two, owner), "Preset 1");
  assert.equal(half.state, "unknown", "the Ultra has no reading: not done");
  assert.match(half.detail, /saved on Pro Plus · Ultra not read yet/);
});
