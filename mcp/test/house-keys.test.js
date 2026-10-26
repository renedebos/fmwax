// THE HOUSE'S KEYS (MC-31, the keys design, 2026-10-17): a new house is
// deployed with only SETUP_KEY; the claim makes the connector's, the
// curator's, the pages' and the helper's keys, the owner gives the Spotify
// app's Client ID on the setup page, and a Worker secret of a name always wins.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
// A blank house: no connector, curator, pages or helper secret, no Client ID.
async function blank() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  for (const n of ["MCP_SECRET", "AGENT_SECRET", "PROGRAM_LIBRARY_KEY", "HELPER_SECRET", "SPOTIFY_CLIENT_ID"]) delete e[n];
  return e;
}
const go = (e, path, { method = "GET", form = null, json = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual",
  headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}), ...(json ? { "content-type": "application/json" } : {}) },
  body: json ? JSON.stringify(json) : form ? new URLSearchParams(form) : undefined }), e, null);
async function claim(e) {
  const r = await go(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
}
const addressIn = (html) => html.match(/<code>https:\/\/fmwax\.test\/mcp\/([A-Za-z0-9_-]{20,})<\/code>/)?.[1];

test("before the claim a blank house has no doors: the connector and the pages are a plain 404", async () => {
  const e = await blank();
  assert.equal((await go(e, "/mcp/anything", { method: "POST", json: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status, 404);
  assert.equal((await go(e, "/buttons/anything12345")).status, 404);
});

test("the claim makes the house's keys: the connector answers at the address the checklist shows", async () => {
  const e = await blank();
  const me = await claim(e);
  const list = await (await go(e, "/setup", { cookie: me })).text();
  const k = addressIn(list);
  assert.ok(k, "the checklist shows the connector's address to the owner");
  const r = await go(e, `/mcp/${k}`, { method: "POST", json: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).result.tools.length > 5);
  assert.equal((await go(e, "/mcp/not-the-key", { method: "POST", json: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status, 404);
  const page = list.match(/href="\/buttons\/([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(page, "Open the house links the family's pages");
  assert.match(list, /target="_blank" rel="noopener">Open the house \(a new tab\)</, "the checklist stays open (the owner's second run)");
  assert.equal((await go(e, `/buttons/${page}`)).status, 200);
  assert.doesNotMatch(await (await go(e, "/setup")).text(), new RegExp(k), "a stranger never sees the address");
});

test("a Worker secret of a name wins: the owner's house keeps its own keys", async () => {
  const e = await blank();
  e.MCP_SECRET = "the-owners-own-connector-key-0123";
  const me = await claim(e);
  const list = await (await go(e, "/setup", { cookie: me })).text();
  assert.equal(addressIn(list), "the-owners-own-connector-key-0123");
});

test("the Spotify app: the redirect to paste, a Client ID checked for its shape, then Spotify's sign-in", async () => {
  const e = await blank();
  const me = await claim(e);
  let list = await (await go(e, "/setup", { cookie: me })).text();
  assert.match(list, /href="\/setup\/spotify-app">Set up the Spotify app</);
  const page = await (await go(e, "/setup/spotify-app", { cookie: me })).text();
  assert.match(page, /<code class="setval">https:\/\/[^<]+\/oauth\/spotify\/callback<\/code>/);
  assert.equal((await go(e, "/setup/spotify-app", { method: "POST", form: { client_id: "not-an-id" }, cookie: me })).status, 400);
  assert.equal((await go(e, "/setup/spotify-app", { method: "POST", form: { client_id: "0123456789ABCDEF0123456789abcdef" }, cookie: me })).status, 303);
  list = await (await go(e, "/setup?saved=spotify-app", { cookie: me })).text();
  assert.match(list, /The Spotify app is kept\. Next: sign in to Spotify\./);
  assert.doesNotMatch(list, /Set up the Spotify app/);
  const pages = list.match(/href="\/buttons\/([A-Za-z0-9_-]+)"/)[1];
  const start = await go(e, `/buttons/${pages}/spotify/connect`, { cookie: me });
  assert.equal(start.status, 302);
  assert.match(start.headers.get("location"), /client_id=0123456789abcdef0123456789abcdef/);
});

test("a Client ID set as a Worker secret is not the page's to replace", async () => {
  const e = await blank();
  e.SPOTIFY_CLIENT_ID = "cid";
  const me = await claim(e);
  const page = await (await go(e, "/setup/spotify-app", { cookie: me })).text();
  assert.match(page, /set as a Worker secret; nothing to do here/);
});

test("a deploy's copy of the file keeps the keys, and a store that does not answer keeps the last known", async () => {
  const { withSettings } = await import("../settings.js");
  const e = await blank();
  const me = await claim(e);
  const k = addressIn(await (await go(e, "/setup", { cookie: me })).text());
  e.HOUSE_TZ = "Europe/Amsterdam"; // house.json edited and deployed: the copy is written again
  assert.equal((await withSettings(e, null)).MCP_SECRET, k);
  assert.equal((await withSettings(e, null)).MCP_SECRET, k, "after the copy too");
  const real = e.HOUSE.get;
  e.HOUSE.get = () => ({ fetch: async () => { throw new Error("down"); } });
  assert.equal((await withSettings(e, null)).MCP_SECRET, k, "a blip keeps the door open");
  e.HOUSE.get = real;
});
