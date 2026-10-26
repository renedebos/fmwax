// A NEW KEY, AND THE OTHER BROWSERS SIGNED OUT (the locks review, 2026-10-25).
// A house set up on its page holds the keys its claim made; a leaked one had
// no way out but a hand-edited backup or wrangler. The setup page's Keys page
// makes a new one in its place, the old stopping at once, and signs out every
// browser but the one in hand. A key a Worker secret holds is wrangler's.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { MADE_KEYS } from "../settings.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function house(secrets = {}) {
  const e = makeEnv();
  const store = await makeHouseStore();
  e.HOUSE = store.binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  Object.assign(e, secrets);
  return { e, store };
}
const go = (e, path, { method = "GET", form = null, cookie = null, origin = ORIGIN, json = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual",
  headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" && origin ? { origin } : {}), ...(json ? { "content-type": "application/json" } : {}) },
  body: json ? JSON.stringify(json) : form ? new URLSearchParams(form) : undefined }), e, null);
const cookieOf = (r) => (r.headers.get("set-cookie") ?? "").split(";")[0];
const keysIn = (store) => JSON.parse(store.rows.get("settings")).keys;
const mcpUp = async (e, secret) => (await go(e, `/mcp/${secret}`, { method: "POST", origin: null,
  json: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } } })).status;

test("a made key is made new from the Keys page: the old one stops, the new one works, and only the owner can", async () => {
  const { e, store } = await house();
  const claimed = await go(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  const me = cookieOf(claimed);
  const before = keysIn(store);
  assert.deepEqual(Object.keys(before).sort(), [...MADE_KEYS].sort(), "the claim made all four");
  assert.equal(await mcpUp(e, before.MCP_SECRET), 200, "the connector's address answers");

  // The page: each key, what it opens, and a new one behind a fold.
  const page = await (await go(e, "/setup/keys", { cookie: me })).text();
  for (const t of ["The household&#39;s pages", "Claude or ChatGPT", "The curator", "The home helper"]) assert.ok(page.includes(t), t);
  assert.equal((page.match(/<summary>Make a new one<\/summary>/g) ?? []).length, 4);
  assert.match(page, /This one only/);

  // A visitor, and a form from another site, change nothing.
  assert.equal((await go(e, "/setup/keys", { method: "POST", form: { key: "MCP_SECRET" } })).headers.get("location"), `${ORIGIN}/setup`);
  assert.equal((await go(e, "/setup/keys", { method: "POST", form: { key: "MCP_SECRET" }, cookie: me, origin: "https://elsewhere.test" })).status, 403);
  assert.equal(keysIn(store).MCP_SECRET, before.MCP_SECRET);

  // The owner's: a new connector address, the old one shut.
  const r = await go(e, "/setup/keys", { method: "POST", form: { key: "MCP_SECRET" }, cookie: me });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/setup/keys?renewed=MCP_SECRET#done");
  const after = keysIn(store);
  assert.notEqual(after.MCP_SECRET, before.MCP_SECRET);
  assert.match(after.MCP_SECRET, /^[A-Za-z0-9_-]{32}$/);
  for (const n of ["AGENT_SECRET", "PROGRAM_LIBRARY_KEY", "HELPER_SECRET"]) assert.equal(after[n], before[n], `${n} untouched`);
  assert.equal(await mcpUp(e, before.MCP_SECRET), 404, "the old address is no door");
  assert.equal(await mcpUp(e, after.MCP_SECRET), 200, "the new one is");
  const said = await (await go(e, "/setup/keys?renewed=MCP_SECRET", { cookie: me })).text();
  assert.match(said, /A new key for claude or chatgpt\./);
  assert.match(said, /remove the connector there and add it again/);
  assert.match(said, /download a new one/);
  // Anything else named is no key.
  assert.equal((await go(e, "/setup/keys", { method: "POST", form: { key: "SETUP_KEY" }, cookie: me })).headers.get("location"), `${ORIGIN}/setup/keys`);
});

test("the helper's key made new closes its line at once", async () => {
  const { e, store } = await house();
  const me = cookieOf(await go(e, "/setup/claim", { method: "POST", form: { key: KEY } }));
  e.STATION.endless.hands = async () => ({ ok: true });
  const old = keysIn(store).HELPER_SECRET;
  await go(e, "/setup/keys", { method: "POST", form: { key: "HELPER_SECRET" }, cookie: me });
  assert.notEqual(keysIn(store).HELPER_SECRET, old);
  assert.equal(e.STATION.endless.dropped, 1, "the line opened with the old key is closed");
  // Its old key opens no helper door; the new one does.
  const status = async (k) => (await worker.fetch(new Request(`${ORIGIN}/helper/status`, { headers: { authorization: `Bearer ${k}` } }), e, null)).status;
  assert.equal(await status(old), 404);
  assert.equal(await status(keysIn(store).HELPER_SECRET), 200);
});

test("a key a Worker secret holds is wrangler's: the page says so and offers no button", async () => {
  const { e, store } = await house({ MCP_SECRET: "owner-mcp-0123456789abcdef" });
  const me = cookieOf(await go(e, "/setup/claim", { method: "POST", form: { key: KEY } }));
  const page = await (await go(e, "/setup/keys", { cookie: me })).text();
  assert.match(page, /npx wrangler secret put MCP_SECRET/);
  assert.equal((page.match(/<summary>Make a new one<\/summary>/g) ?? []).length, 3);
  const r = await go(e, "/setup/keys", { method: "POST", form: { key: "MCP_SECRET" }, cookie: me });
  assert.equal(r.headers.get("location"), "/setup/keys");
  assert.equal(await mcpUp(e, "owner-mcp-0123456789abcdef"), 200, "the secret still opens the door");
  assert.equal(keysIn(store).MCP_SECRET, undefined, "nothing was made in its place");
});

test("every other browser signed out: the lost phone's sign-in ends, this one stays", async () => {
  const { e } = await house();
  const claimed = await go(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  const phone = cookieOf(claimed);
  const code = (await claimed.text()).match(/id="setcode">([0-9A-Z-]+)</)?.[1];
  assert.ok(code, "the recovery code is shown");
  const laptop = cookieOf(await go(e, "/setup/recover", { method: "POST", form: { code } }));
  assert.ok(laptop && laptop !== phone);
  assert.match(await (await go(e, "/setup/keys", { cookie: laptop })).text(), /2, this one included/);

  const r = await go(e, "/setup/keys", { method: "POST", form: { key: "browsers" }, cookie: laptop });
  assert.equal(r.headers.get("location"), "/setup/keys?out=1#browsers");
  assert.match(await (await go(e, "/setup/keys?out=1", { cookie: laptop })).text(), /Signed out of 1 other browser\. This one stays signed in\./);
  assert.equal((await go(e, "/setup/keys", { cookie: phone })).headers.get("location"), `${ORIGIN}/setup`, "the phone is signed out");
  assert.match(await (await go(e, "/setup/keys", { cookie: laptop })).text(), /This one only/);
});
