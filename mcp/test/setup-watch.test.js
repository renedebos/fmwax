// WAITS THE PAGE CAN SEE (the owner, 2026-10-19: steps that take time should
// be clear, and seen to be under way). A setup page waiting on something
// outside it carries the facts it was drawn with and a clock; its script asks
// /setup/status for the same facts and reloads once one has moved.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { CURATOR_SEEN_KEY } from "../services.js";
import { endlessLog, endlessUpdate } from "../endless.js";
import { makeEnv, makeHouseStore, installFetch } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function house() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.PROGRAM_LIBRARY_KEY = "pagekey12345";
  e.MCP_SECRET = "owner-mcp-0123456789";
  e.AGENT_SECRET = "agent-key-0123456789";
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: "REQUESTS00000000000001", catalog: "spotify" }]);
  delete e.ENDLESS;
  delete e.REQUEST_ROUTINE_ID;
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
const claim = async (e) => ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
const text = async (e, path, cookie) => (await go(e, path, { cookie })).text();
const watched = (html) => {
  const m = html.match(/<span hidden id="setwatch" data-watch="([^"]*)" data-go="([^"]*)">/);
  return m ? { watch: JSON.parse(m[1].replace(/&quot;|&#34;/g, '"')), go: m[2].replace(/&amp;/g, "&") } : null;
};

test("the status door is the owner's, and answers each fact as the pages watch it", async () => {
  const f = installFetch();
  try {
    const e = await house();
    const me = await claim(e);
    assert.equal((await go(e, "/setup/status?w=app")).status, 403);
    const facts = async (w) => (await go(e, `/setup/status?w=${w}`, { cookie: me })).json();
    assert.deepEqual(await facts("app,curator,listening,first,nonsense"), { app: false, curator: 0, listening: 0, first: "" });
    const waits = [];
    await worker.fetch(new Request(`${ORIGIN}/mcp/owner-mcp-0123456789`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    assert.deepEqual(await facts("app"), { app: true }, "the first call from Claude or ChatGPT");
    await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: 1792400000000 }));
    assert.deepEqual(await facts("curator"), { curator: 1792400000000 });
  } finally { f.restore(); }
});

test("the checklist watches a row waiting on Claude or ChatGPT, and stops once it has called", async () => {
  const f = installFetch();
  try {
    const e = await house();
    const me = await claim(e);
    assert.deepEqual(watched(await text(e, "/setup", me)), { watch: { app: false }, go: "/setup" });
    const waits = [];
    await worker.fetch(new Request(`${ORIGIN}/mcp/owner-mcp-0123456789`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    assert.equal(watched(await text(e, "/setup", me)), null, "nothing left to wait on");
  } finally { f.restore(); }
});

test("a rung Claude task: a clock, its help only once the wait is long, and Next once it checks in after the ring", async () => {
  const e = await house();
  const me = await claim(e);
  await go(e, "/setup/curator", { method: "POST", form: { routine: "trig_01ABCDEFGHIJKL", token: "t".repeat(40) }, cookie: me });
  const at = Date.now() - 30_000;
  let page = await text(e, `/setup/curator?woke=1&at=${at}`, me);
  assert.ok(page.includes(`Waiting for it to check in: <b class="setclock" data-since="${at}">0:00</b>`));
  assert.ok(page.includes(`<div hidden data-since="${at}" data-late="180">`), "the help waits three minutes");
  assert.deepEqual(watched(page), { watch: { curator: 0 }, go: "/setup/curator?with=claude#done" });
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: at - 600_000 }));
  page = await text(e, `/setup/curator?woke=1&at=${at}`, me);
  assert.match(page, /Waiting for it to check in/, "a check-in before the ring is not its answer");
  assert.doesNotMatch(page, /Next: the DJ presets/);
  const now = Date.now();
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: now }));
  page = await text(e, `/setup/curator?woke=1&at=${at}`, me);
  assert.doesNotMatch(page, /Waiting for it to check in/);
  assert.match(page, /<a class="sgo" href="\/setup\/endless">Next: the DJ presets<\/a>/);
  assert.equal(watched(page), null);
  assert.doesNotMatch(await text(e, `/setup/curator?woke=1&at=${now - 2 * 3600e3}`, me), /data-since=/, "an old link is not a wait");
});

test("ChatGPT chosen: the page watches for its Work chat to subscribe and check in", async () => {
  const e = await house();
  const me = await claim(e);
  await go(e, "/setup/curator/use", { method: "POST", form: { who: "chatgpt" }, cookie: me });
  const page = await text(e, "/setup/curator?with=chatgpt", me);
  assert.deepEqual(watched(page), { watch: { curator: 0, listening: 0 }, go: "/setup/curator?with=chatgpt#done" });
  assert.deepEqual(watched(await text(e, "/setup", me))?.watch, { app: false, curator: 0, listening: 0 });
});

test("the house DJ's first set: a ChatGPT house may make the presets, a clock while it is written, then where it started", async () => {
  const f = installFetch();
  let n = 0;
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => init?.method === "POST" && new URL(String(u)).pathname.endsWith("/me/playlists")
    ? Response.json({ id: `NEWPLAYLIST${String(++n).padStart(11, "0")}`, name: JSON.parse(init.body).name }, { status: 201 })
    : inner(u, init);
  try {
    const e = await house();
    const me = await claim(e);
    await go(e, "/setup/curator/use", { method: "POST", form: { who: "chatgpt" }, cookie: me });
    assert.match(await text(e, "/setup/endless", me), /Make the DJ presets/, "a ChatGPT curator is a curator");
    await go(e, "/setup/endless", { method: "POST", form: { dj: "vibe", own: "2", lane: "3" }, cookie: me });
    const since = Date.now() - 40_000;
    await endlessUpdate(e, (st) => { st.jobs = { "endless-2-fresh-1": { id: "endless-2-fresh-1", kind: "fresh", btn: 2, at: since, device: "Pro Plus" } }; return {}; });
    let page = await text(e, "/setup/endless", me);
    assert.ok(page.includes(`Their first set is being written: <b class="setclock" data-since="${since}">0:00</b>`));
    assert.match(page, /starts on the Pro Plus by itself when it is ready; this page shows it when it does/);
    assert.ok(page.includes(`<div hidden data-since="${since}" data-late="300">`));
    assert.deepEqual(watched(page), { watch: { first: "writing" }, go: "/setup/endless" });
    assert.deepEqual(await (await go(e, "/setup/status?w=first", { cookie: me })).json(), { first: "writing" });
    await endlessUpdate(e, (st) => { st.jobs = {}; return {}; });
    await endlessLog(e, [{ at: Date.now(), btn: 2, event: "fresh-landed", detail: "15 songs for the next press; started on Pro Plus" }]);
    page = await text(e, "/setup/endless", me);
    assert.match(page, /Their first set is ready, and playing on the Pro Plus\. Now save it on each WiiM device/);
    assert.equal(watched(page), null);
    await endlessLog(e, [{ at: Date.now(), btn: 2, event: "fresh-expired", detail: "no fresh landed; nothing changed" }]);
    assert.match(await text(e, "/setup/endless", me), /Their first set did not arrive: open <a href="\/buttons\/pagekey12345\/vibe">Vibe's page<\/a> and tap <b>Start fresh<\/b>/);
  } finally { globalThis.fetch = inner; f.restore(); }
});

// THE HOME HELPER ON THE SETUP PAGE (MC-31 stage 5, 2026-10-19; Codex's
// review): offered to a house set up here, optional, so never the Next step
// and counted neither way; then said by what it reads, not only by its line.
test("the home helper on the setup page: offered, then what it reads, ticking live", async () => {
  const { setupChecklist } = await import("../checklist.js");
  const e = await house();
  e.HELPER_SECRET = "helper-secret-0123456789abcdef";
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" });
  const me = await claim(e);
  const owner = { claimed_at: new Date().toISOString() };
  const helperRow = (l) => l.sections.find((s) => s.key === "helper").rows[0];
  let list = await setupChecklist(e, owner);
  assert.deepEqual([helperRow(list).state, helperRow(list).href, list.sections.find((s) => s.key === "helper").count], ["offer", "/setup/helper", "Optional"]);
  assert.equal(list.total, list.sections.flatMap((s) => s.rows).filter((r) => r.state !== "unknown" && r.state !== "offer").length, "counted neither way");
  const html = await text(e, "/setup", me);
  assert.doesNotMatch(html, /Next: Home helper/);
  assert.match(html, /Set up the home helper/);
  // Its page: the owner's, one command with the house's address and a
  // pairing code for the key (2026-10-21), the key itself folded away for an
  // older copy of the code.
  assert.equal((await go(e, "/setup/helper")).status, 303);
  let page = await text(e, "/setup/helper", me);
  assert.match(page, new RegExp(`<code class="setval">node install/helper\\.js --house ${ORIGIN.replace(/\./g, "\\.")} --pair [0-9a-z]+-[A-Za-z0-9_-]{22}</code>`));
  assert.match(page, new RegExp(`<summary>If it asks for a key</summary>[\\s\\S]*<code class="setval">${e.HELPER_SECRET}</code>`));
  assert.doesNotMatch(page, /--key/, "never the key on the command line (Codex)");
  assert.match(page, /starts when you sign\s+in to that computer and works while it is awake/);
  assert.doesNotMatch(page, /Remove the home helper/, "nothing to remove before a helper ever ran");
  assert.deepEqual(watched(page), { watch: { helper: false, helperRead: 0 }, go: "/setup/helper" });
  // Connected, one WiiM answering and one not: said apart.
  e.STATION.endless.hands = async () => ({ ok: true });
  await worker.fetch(new Request(`${ORIGIN}/helper/reading`, { method: "POST",
    headers: { authorization: `Bearer ${e.HELPER_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ speakers: [{ name: "Pro Plus", state: "play", source: "Spotify" }, { name: "Ultra", state: "unreachable" }] }) }), e);
  list = await setupChecklist(e, owner);
  assert.equal(helperRow(list).title, "Connected");
  assert.equal(helperRow(list).state, "due");
  assert.equal(helperRow(list).detail, "Sees and presses Pro Plus · not answering: Ultra");
  assert.deepEqual(await (await go(e, "/setup/status?w=helper,helperRead", { cookie: me })).json(), { helper: true, helperRead: 1 });
  page = await text(e, "/setup/helper", me);
  assert.match(page, /<b>Connected<\/b>/);
  assert.match(page, /Reads Pro Plus/);
  assert.match(page, /Not answering: Ultra\./);
  assert.match(page, /<form class="setform" method="post" action="\/setup\/helper\/remove">/, "connected: its Remove");
});

// TYPED WITH A SLASH (the first Windows laptop, 2026-10-21: "/setup/"
// answered "not found"): the same page, without it.
test("a setup address typed with a slash at the end lands on the page", async () => {
  const e = await house();
  for (const [from, to] of [["/setup/", "/setup"], ["/setup/helper/", "/setup/helper"], ["/setup/?x=1", "/setup?x=1"]]) {
    const r = await go(e, from);
    assert.deepEqual([r.status, r.headers.get("location")], [301, `${ORIGIN}${to}`], from);
  }
  assert.equal((await go(e, "/setup/claim/", { method: "POST", form: { key: KEY } })).status, 404, "a form is never redirected");
});

// WWW. AND THE HOUSE'S OWN ADDRESS (2026-10-25, the copy script: it said
// one house's domain): www. in front of PROGRAM_BASE_URL's host goes to the
// host, and any other address is served as it is.
test("www. in front of the house's own address goes to the address", async () => {
  const e = makeEnv();
  e.PROGRAM_BASE_URL = "https://house.example";
  const r = await worker.fetch(new Request("https://www.house.example/programs?x=1"), e);
  assert.deepEqual([r.status, r.headers.get("location")], [301, "https://house.example/programs?x=1"]);
  assert.notEqual((await worker.fetch(new Request("https://www.other.example/health"), e)).status, 301, "another www is not redirected");
  assert.equal((await worker.fetch(new Request("https://house.example/health"), e)).status, 200);
});
