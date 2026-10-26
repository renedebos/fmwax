// THE HOME HELPER, ONE PASTE IN AND ONE BUTTON OUT (the first Windows laptop,
// 2026-10-21). The setup page's command carries a pairing code the install
// trades for the helper's key, so nothing is pasted at a prompt; and the page
// has a Remove button, sent down the helper's line, which a helper the install
// made obeys by taking itself off its computer. Its remover tells the house,
// which forgets what it read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import worker from "../worker.js";
import { HELPER_PAIR_S, helperPairCheck, helperPairCode } from "../claim.js";
import { WINDOWS_APPS_KEY, manifestOf, windowsAppsEntry } from "../install/helper-service.js";
import { line, removerBeside } from "../../helper/fmwax-helper.mjs";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
const SECRET = "helper-secret-0123456789abcdef";
async function house() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.PROGRAM_LIBRARY_KEY = "pagekey12345";
  e.MCP_SECRET = "owner-mcp-0123456789";
  e.HELPER_SECRET = SECRET;
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45" });
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null, json = null, bearer = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual",
  headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}),
    ...(json ? { "content-type": "application/json" } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: json ? JSON.stringify(json) : form ? new URLSearchParams(form) : undefined }), e, null);
const claim = async (e) => ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];

test("a pairing code: good for its hour, then refused; another house's or a made-up one, never", async () => {
  const now = 1_792_600_000_000;
  const code = await helperPairCode(SECRET, now);
  assert.match(code, /^[0-9a-z]+-[A-Za-z0-9_-]{22}$/);
  assert.equal(await helperPairCheck(SECRET, code, now), "ok");
  assert.equal(await helperPairCheck(SECRET, code, now + (HELPER_PAIR_S - 1) * 1000), "ok");
  assert.equal(await helperPairCheck(SECRET, code, now + (HELPER_PAIR_S + 1) * 1000), "expired");
  assert.equal(await helperPairCheck("another-house-secret-0123", code, now), "bad");
  assert.equal(await helperPairCheck(SECRET, code.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now), "bad");
  assert.equal(await helperPairCheck(SECRET, "", now), "bad");
  // A code made for far ahead (someone's own clock, or a forgery that got the
  // mark right) is no code: an hour at most.
  assert.equal(await helperPairCheck(SECRET, await helperPairCode(SECRET, now + 5 * 3600_000), now), "bad");
});

test("the pairing door gives the key for the page's code, and nothing for anything else", async () => {
  const e = await house();
  const me = await claim(e);
  const page = await (await go(e, "/setup/helper", { cookie: me })).text();
  const code = page.match(/--pair ([0-9a-z]+-[A-Za-z0-9_-]{22})/)?.[1];
  assert.ok(code, "the command carries a code");
  let r = await go(e, "/helper/pair", { method: "POST", json: { code } });
  assert.deepEqual([r.status, await r.json()], [200, { ok: true, key: SECRET }]);
  // Its last letter changed (to y if it was already x: 1 run in 64 failed).
  r = await go(e, "/helper/pair", { method: "POST", json: { code: `${code.slice(0, -1)}${code.endsWith("x") ? "y" : "x"}` } });
  assert.deepEqual([r.status, await r.json()], [403, { ok: false, code: "bad" }]);
  r = await go(e, "/helper/pair", { method: "POST", json: { code: await helperPairCode(SECRET, Date.now() - 2 * 3600_000) } });
  assert.deepEqual([r.status, await r.json()], [410, { ok: false, code: "expired" }]);
  // The owner's house, set up from its files, has no such door.
  delete e.SETUP_KEY;
  assert.equal((await go(e, "/helper/pair", { method: "POST", json: { code } })).status, 404);
});

test("Remove: sent down the helper's line, and the page says what came of it", async () => {
  const e = await house();
  const me = await claim(e);
  const asked = [];
  // No helper connected: nothing to send, and the page says so.
  let r = await go(e, "/setup/helper/remove", { method: "POST", cookie: me });
  assert.equal(r.headers.get("location"), "/setup/helper?removed=helper-off#done");
  // A visitor is sent to the claim, and nothing is sent to a helper.
  e.STATION.endless.hands = async (a) => { asked.push(a); return { ok: true, code: "removing" }; };
  r = await go(e, "/setup/helper/remove", { method: "POST" });
  assert.equal(r.status, 303);
  assert.equal(asked.length, 0);
  // Connected, and made by the install: it takes itself away.
  r = await go(e, "/setup/helper/remove", { method: "POST", cookie: me });
  assert.equal(r.headers.get("location"), "/setup/helper?removed=removing#done");
  assert.deepEqual(asked, [{ cmd: "remove" }]);
  assert.match(await (await go(e, "/setup/helper?removed=removing", { cookie: me })).text(), /The helper is taking itself off that computer/);
  // Set up by hand (the owner's Chromebook): it says so, and stays.
  e.STATION.endless.hands = async () => ({ ok: false, code: "not-installed" });
  r = await go(e, "/setup/helper/remove", { method: "POST", cookie: me });
  assert.equal(r.headers.get("location"), "/setup/helper?removed=not-installed#done");
  assert.match(await (await go(e, "/setup/helper?removed=not-installed", { cookie: me })).text(), /set up by hand, not by the install command/);
});

test("a helper once seen and now off: the way to remove it on its computer; its remover makes the house forget it", async () => {
  const e = await house();
  const me = await claim(e);
  await go(e, "/helper/reading", { method: "POST", bearer: SECRET, json: { speakers: [{ name: "Pro Plus", state: "play" }] } });
  const page = await (await go(e, "/setup/helper", { cookie: me })).text();
  assert.doesNotMatch(page, /action="\/setup\/helper\/remove"/, "no button with no line to send it down");
  assert.match(page, /No helper is connected now\. Turn its computer on/);
  assert.match(page, /Settings, Apps, <b>fmwax home helper<\/b>, Uninstall/);
  // The remover's word: the house forgets what it read, and the page no
  // longer offers to remove anything.
  assert.equal((await go(e, "/helper/forget", { method: "POST", bearer: "not-the-key-0123456789" })).status, 404);
  assert.equal((await go(e, "/helper/forget", { method: "POST", bearer: SECRET })).status, 200);
  assert.equal(e.STATION.endless.helper, undefined);
  assert.doesNotMatch(await (await go(e, "/setup/helper", { cookie: me })).text(), /<h3>Remove it<\/h3>/);
});

test("the helper's side: a Remove is obeyed only by a helper the install made", async (t) => {
  t.mock.method(console, "log", () => {});
  // This repo's copy, as the owner's Chromebook runs it, has no record beside it.
  assert.equal(removerBeside(), null);
  const app = mkdtempSync(join(tmpdir(), "helper-app-"));
  try {
    mkdirSync(join(app, "helper"), { recursive: true });
    const script = join(app, "helper", "fmwax-helper.mjs");
    assert.equal(removerBeside(script), null, "no record, no remover");
    writeFileSync(join(app, "installed.json"), "{}");
    writeFileSync(join(app, "remove.mjs"), "");
    assert.equal(removerBeside(script), join(app, "remove.mjs"));
  } finally { rmSync(app, { recursive: true, force: true }); }
  // Down the line, to this copy: refused, and said so, with no speaker touched.
  const sent = [];
  class Socket {
    constructor() { this.readyState = 1; Socket.last = this; }
    send(text) { sent.push(text); }
    close() {}
  }
  t.mock.timers.enable({ apis: ["setInterval"] });
  line({ url: "https://x.test", secret: SECRET, speakers: { "Pro Plus": "192.168.4.45" } }, Socket, async () => ({ ok: false }));
  await Socket.last.onmessage({ data: JSON.stringify({ id: "r1", cmd: "remove" }) });
  assert.deepEqual(JSON.parse(sent.at(-1)), { id: "r1", ok: false, code: "not-installed" });
});

test("Windows' Settings, Apps: the helper listed under the person's own key, its Uninstall the remover", () => {
  const entry = windowsAppsEntry({ node: "C:\\Program Files\\nodejs\\node.exe", remover: "C:\\Users\\Jane Doe\\AppData\\Local\\fmwax-helper\\remove.mjs",
    app: "C:\\Users\\Jane Doe\\AppData\\Local\\fmwax-helper" });
  assert.equal(entry.key, WINDOWS_APPS_KEY);
  assert.match(WINDOWS_APPS_KEY, /^HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fmwax-home-helper$/, "no admin rights needed");
  const v = Object.fromEntries(entry.values.map(([n, , d]) => [n, d]));
  assert.equal(v.DisplayName, "fmwax home helper");
  assert.equal(v.UninstallString, `"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Jane Doe\\AppData\\Local\\fmwax-helper\\remove.mjs" --pause`);
  assert.deepEqual(manifestOf({ house: "https://h.test", made: [], service: { kind: "windows" }, registry: entry.key, at: "t" }).registry, WINDOWS_APPS_KEY,
    "the record keeps it, so its removal takes it away");
});
