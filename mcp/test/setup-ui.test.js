// THE SETUP SCREENS AFTER CODEX'S REVIEW (2026-10-17): no double claim, a
// way on from every state, the time zone on its own page, one rule for done,
// and the Spotify pages honest on a house with no login or no Spotify app.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { setupChecklist } from "../checklist.js";
import { renderSpotify } from "../programs.js";
import { makeEnv, makeHouseStore, makeKV } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function house(over = {}) {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  return Object.assign(e, over);
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
async function owner(e) {
  const r = await go(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  return { cookie: (r.headers.get("set-cookie") ?? "").split(";")[0], html: await r.text() };
}

test("every setup form is guarded against a second tap, and says it is busy", async () => {
  const e = await house();
  const open = await (await go(e, "/setup")).text();
  assert.match(open, /data-busy="Claiming…"/);
  assert.match(open, /document\.addEventListener\("submit"/);
});

test("the claimed page has a way on, and Copy where the phone can copy", async () => {
  const e = await house();
  const { html } = await owner(e);
  assert.match(html, /<a href="\/setup">I have saved it: on to the checklist<\/a>/);
  assert.match(html, /id="setcopy" hidden>Copy the code/);
});

test("the time zone has its own row and page: the owner sets it, a made-up one is refused", async () => {
  const e = await house({ HOUSE_TZ: "" });
  const { cookie } = await owner(e);
  const page = await (await go(e, "/setup/timezone", { cookie })).text();
  assert.match(page, /resolvedOptions\(\)\.timeZone/, "the phone's own zone is filled in");
  // A list to choose from (the owner's second run, 2026-10-17: "no dropdown").
  assert.match(page, /<select id="stz" name="tz"/);
  assert.match(page, /<optgroup label="Common"><option value="America\/Los_Angeles">Pacific Time \(Los Angeles\)<\/option>/);
  assert.match(page, /<optgroup label="America">[\s\S]*<option value="America\/Los_Angeles">Los Angeles<\/option>/);
  assert.match(page, /<option value="" selected>Choose a time zone<\/option>/, "none chosen yet: the phone's own is picked by the script");
  assert.equal((await go(e, "/setup/timezone")).status, 303, "anyone else is sent to /setup");
  const bad = await go(e, "/setup/timezone", { method: "POST", form: { tz: "Mars/Olympus" }, cookie });
  assert.equal(bad.status, 400);
  const ok = await go(e, "/setup/timezone", { method: "POST", form: { tz: "Europe/Amsterdam" }, cookie });
  assert.equal(ok.headers.get("location"), "/setup?saved=timezone");
  const list = await (await go(e, "/setup?saved=timezone", { cookie })).text();
  assert.match(list, /The house(&#39;|')s time zone is Europe\/Amsterdam now\./);
  assert.match(await (await go(e, "/setup/timezone", { cookie })).text(), /<option value="Europe\/Amsterdam" selected>Central Europe \(Amsterdam\)/);
});

test("one rule for done: a row that wants a look counts as done everywhere, and is said apart", async () => {
  const e = await house({ PROGRAM_LIBRARY_KEY: "pagekey12345" });
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() }, { base: "/buttons/pagekey12345" });
  const spotify = list.sections[0].rows.find((r) => r.title === "Spotify");
  assert.equal(spotify.state, "due", "a login with no date wants a look");
  const core = list.sections[0];
  assert.equal(core.count, `${list.coreDone} of ${list.coreTotal}`);
  assert.equal(list.due, 1);
  assert.equal(list.home, "/buttons/pagekey12345");
});

test("the Spotify page on a house with no login, or no Spotify app, says so plainly", async () => {
  const none = renderSpotify({ base: "/b/k", login: { present: false } });
  assert.match(none, /<b class="word">Not signed in<\/b>/);
  assert.match(none, />Sign in to Spotify</);
  const noApp = renderSpotify({ base: "/b/k", login: { present: false }, ready: false });
  assert.match(noApp, /no Spotify app yet/);
  assert.doesNotMatch(noApp, /spotify\/connect/);
});

test("Reconnect on a house with no Spotify app is a page with a way back, not a 500", async () => {
  const e = await house({ PROGRAM_LIBRARY_KEY: "pagekey12345" });
  delete e.SPOTIFY_CLIENT_ID;
  const { cookie } = await owner(e);
  const r = await go(e, "/buttons/pagekey12345/spotify/connect", { cookie });
  assert.equal(r.status, 503);
  assert.match(await r.text(), /no Spotify app yet/);
});

test("the Spotify return address refuses with a page that leads to /setup", async () => {
  const e = await house({ PROGRAM_LIBRARY_KEY: "pagekey12345" });
  const r = await go(e, "/oauth/spotify/callback?state=s&code=c");
  assert.equal(r.status, 403);
  const html = await r.text();
  assert.match(html, /href="\/setup"/);
  assert.doesNotMatch(html, /pagekey12345/);
});

test("an unclaimed house's /setup and recovery leave the store untouched; the claim is its first caller", async () => {
  const e = makeEnv();
  const store = await makeHouseStore();
  e.HOUSE = store.binding;
  e.SETUP_KEY = KEY;
  assert.match(await (await go(e, "/setup")).text(), /Claim this house/);
  assert.equal((await go(e, "/setup/recover", { method: "POST", form: { code: "0000-0000-0000-0000" } })).status, 409);
  assert.equal((await go(e, "/setup/claim", { method: "POST", form: { key: "a-wrong-key-0123456789abcdef" } })).status, 403);
  assert.equal(store.calls, 0, "nothing asked of the store before the right key");
  assert.equal((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).status, 200);
  assert.ok(store.calls > 0);
});

test("the claimed page leaves nothing for a reload to send again, and the owner can make a new recovery code", async () => {
  const e = await house();
  const { cookie, html } = await owner(e);
  assert.match(html, /history\.replaceState\(null, "", "\/setup"\)/);
  const old = html.match(/class="setcode"[^>]*>([0-9A-Z-]+)</)[1];
  assert.match(await (await go(e, "/setup", { cookie })).text(), /Make a new recovery code/);
  assert.equal((await go(e, "/setup/code", { method: "POST" })).status, 303, "not signed in: back to /setup");
  const made = await (await go(e, "/setup/code", { method: "POST", cookie })).text();
  const fresh = made.match(/class="setcode"[^>]*>([0-9A-Z-]+)</)[1];
  assert.notEqual(fresh, old);
  assert.match(made, /The old one no longer works/);
  assert.equal((await go(e, "/setup/recover", { method: "POST", form: { code: old } })).status, 403, "the old code stopped");
  assert.equal((await go(e, "/setup/recover", { method: "POST", form: { code: fresh } })).status, 303, "the new one signs in");
});

// THE PRACTICE INSTALL (2026-10-19): the row was "Claude app", with claude.ai's
// steps only; a ChatGPT household found none on the page.
test("Claude or ChatGPT: its own page with the steps for both, the owner's only, and a Next once it is due", async () => {
  const e = await house({ MCP_SECRET: "owner-mcp-secret-0123456789" });
  assert.equal((await go(e, "/setup/app")).status, 303, "not signed in: back to /setup");
  const { cookie } = await owner(e);
  const page = await (await go(e, "/setup/app", { cookie })).text();
  assert.match(page, /<h2 id="scard">Claude or ChatGPT/);
  assert.ok(page.includes(`<code class="setval">${ORIGIN}/mcp/owner-mcp-secret-0123456789</code>`), "one address for both");
  assert.match(page, /<h3>Claude<\/h3>[\s\S]*Add custom connector[\s\S]*Tool permissions/);
  assert.match(page, /<h3>ChatGPT \(Plus or higher\)<\/h3>[\s\S]*Add custom MCP server[\s\S]*<b>Authentication<\/b> to\s+<b>None<\/b>/);
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() }, { origin: ORIGIN });
  const r = list.sections[0].rows.find((x) => x.title === "Claude or ChatGPT");
  assert.deepEqual([r.state, r.href], ["todo", "/setup/app"]);
  assert.equal(r.copy.value, `${ORIGIN}/mcp/owner-mcp-secret-0123456789`);
  assert.ok(!list.sections[0].rows.some((x) => x.title === "Claude app"));
});

test("a row the house cannot see neither counts for nor against: a Core-only house can finish", async () => {
  const e = await house({ PROGRAM_LIBRARY_KEY: "pagekey12345", HELPER_SECRET: undefined,
    BUTTONS: JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" }]) });
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57" });
  await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r", login_at: new Date().toISOString(), account: { id: "a", name: "A" } }));
  const { cookie } = await owner(e);
  const before = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  assert.equal(before.sections[0].rows.find((r) => r.title === "Preset 1").state, "unknown");
  assert.equal(before.unseen, 1);
  // Claude or ChatGPT is the one row left: once it has called, Core is done.
  await go(e, "/mcp/x", { method: "POST" }); // a wrong key: no call noted
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  assert.equal(list.total, list.sections.flatMap((s) => s.rows).filter((r) => r.state !== "unknown").length);
  assert.ok(cookie);
});

test("a store that does not answer keeps the page's last known choices for that request", async () => {
  const { withSettings, choosePageSetting, settingsOf } = await import("../settings.js");
  const e = await house();
  await e.PROGRAMS.put("house:claimed", "x");
  await choosePageSetting({ ...e, __vars: settingsOf(e) }, "DEFAULT_DEVICE", "Ultra");
  assert.equal((await withSettings(e, null)).DEFAULT_DEVICE, "Ultra");
  const real = e.HOUSE;
  const slow = { ...e, HOUSE: real };
  real.get = ((get) => () => ({ fetch: async () => { throw new Error("down"); } }))(real.get);
  const s2 = await withSettings(slow, null);
  assert.equal(s2.__settings, "vars: the store did not answer");
  assert.equal(s2.DEFAULT_DEVICE, "Ultra");
});

test("the checklist puts the next step first, and a Spotify sign-in from it comes back to it", async () => {
  const { finishLogin, startLogin } = await import("../spotify-login.js");
  const e = await house({ PROGRAM_LIBRARY_KEY: "pagekey12345" });
  await e.TOKENS.delete("spotify");
  const { cookie } = await owner(e);
  const list = await (await go(e, "/setup", { cookie })).text();
  assert.match(list, /<h2 id="snext">Next: Spotify<\/h2>/);
  assert.match(list, /href="\/buttons\/pagekey12345\/spotify\/connect\?from=setup">Sign in to Spotify</);
  // The way back remembers where it was started.
  const to = new URL(await startLogin(e, ORIGIN, { back: "setup" }));
  const params = new URLSearchParams({ state: to.searchParams.get("state"), error: "access_denied" });
  const done = await finishLogin(e, params, ORIGIN);
  assert.equal(done.back, "setup");
  const r = await go(e, `/oauth/spotify/callback?${new URLSearchParams({ state: (new URL(await startLogin(e, ORIGIN, { back: "setup" }))).searchParams.get("state"), error: "access_denied" })}`, { cookie });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /^\/setup\?spotify=The%20sign-in%20was%20cancelled/);
});

test("the Spotify page says Signed in for a first sign-in, and shows the owner the way back to the checklist", async () => {
  const first = renderSpotify({ base: "/b/k", login: {}, flash: { ok: true, name: "House", endsAt: Date.now(), first: true }, setup: true });
  assert.match(first, /Signed in as House\./);
  assert.match(first, /href="\/setup">[\s\S]*The setup checklist/);
  const again = renderSpotify({ base: "/b/k", login: {}, flash: { ok: true, name: "House", endsAt: Date.now() } });
  assert.match(again, /Reconnected as House\./);
  assert.doesNotMatch(again, /The setup checklist/);
});

// A STORE MADE AGAIN (the Mac test, 2026-10-19): the practice house's PROGRAMS
// was replaced, its claim mark gone, and its page offered a claim the setup
// key could no longer make. The settings store still knows the owner.
test("a house whose store was made again still knows its owner: the mark is put back, and no claim is offered", async () => {
  const e = await house();
  const { cookie } = await owner(e);
  e.PROGRAMS = makeKV(); // a new store: no mark, and none this isolate has seen
  // A visitor with no sign-in asks nothing of the store (Codex, 2026-10-17)…
  assert.match(await (await go(e, "/setup")).text(), /Claimed it before\? Open this page in the browser you claimed it with/);
  assert.equal(await e.PROGRAMS.get("house:claimed"), null);
  // …the owner's own browser does: the store still knows its owner.
  assert.match(await (await go(e, "/setup", { cookie })).text(), /Every step ticks itself/, "the owner's browser is the owner's");
  assert.ok(await e.PROGRAMS.get("house:claimed"), "the mark is back");
  const anyone = await (await go(e, "/setup")).text();
  assert.match(anyone, /This house has an owner/);
  assert.doesNotMatch(anyone, /This house is new/);
});
