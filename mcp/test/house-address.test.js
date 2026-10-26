// THE HOUSE LEARNS ITS OWN ADDRESS (MC-34 1a, 2026-10-25). A house from the
// Deploy button has no PROGRAM_BASE_URL in its config: nobody knows its
// workers.dev name until Cloudflare gives it one. Its owner's visit to the
// setup page says it, and the house keeps it as a page setting; a new domain
// is learned the same way. A file's address always wins.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
async function house({ file = null } = {}) {
  const e = makeEnv();
  const store = await makeHouseStore();
  e.HOUSE = store.binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  if (file) e.PROGRAM_BASE_URL = file; else delete e.PROGRAM_BASE_URL;
  return { e, store };
}
const go = (e, origin, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${origin}${path}`, {
  method, redirect: "manual",
  headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
const claim = async (e, origin) => ((await go(e, origin, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
const pageBase = (store) => JSON.parse(store.rows.get("settings") ?? "{}")?.page?.PROGRAM_BASE_URL ?? null;

test("a house with no address learns it from its owner's setup page, and a new domain the same way", async () => {
  const { e, store } = await house();
  const at = "https://fmwax-house.someone.workers.dev";
  const me = await claim(e, at);
  assert.equal(pageBase(store), null, "nothing before the owner's look");
  assert.equal((await go(e, at, "/setup", { cookie: me })).status, 200);
  assert.equal(pageBase(store), at);
  // A visitor's look changes nothing.
  await go(e, "https://elsewhere.test", "/setup");
  assert.equal(pageBase(store), at);
  // The owner comes in by a domain added later: learned.
  await go(e, "https://music.example.org", "/setup", { cookie: me });
  assert.equal(pageBase(store), "https://music.example.org");
});

test("a house whose file names its address keeps the file's, and drops a page copy", async () => {
  const { e, store } = await house({ file: "https://house.example.test" });
  const me = await claim(e, "https://house.example.test");
  await go(e, "https://house-dj.someone.workers.dev", "/setup", { cookie: me });
  assert.equal(pageBase(store), null, "the file's address stands");
  // One learned before the file said it is handed back to the file.
  const doc = JSON.parse(store.rows.get("settings"));
  doc.page = { ...(doc.page ?? {}), PROGRAM_BASE_URL: "https://old.workers.dev" };
  store.rows.set("settings", JSON.stringify(doc));
  await go(e, "https://house.example.test", "/setup", { cookie: me });
  assert.equal(pageBase(store), null);
});

test("a setup key too short is said, with the way out, never as a bare not-found (MC-34)", async () => {
  const { e } = await house();
  e.SETUP_KEY = "short-password";
  const r = await go(e, "https://fmwax-house.someone.workers.dev", "/setup");
  assert.equal(r.status, 503);
  const html = await r.text();
  assert.match(html, /shorter than 24 characters/);
  assert.match(html, /Variables and Secrets: set SETUP_KEY again, longer/);
  assert.ok(!/\b14 characters/.test(html), "its length is not said");
  delete e.SETUP_KEY;
  assert.equal((await go(e, "https://fmwax-house.someone.workers.dev", "/setup")).status, 404, "no key at all: no door, as before");
});
