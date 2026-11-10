// THE ONBOARDING REVIEW (the owner, 2026-11-09: "make it faster and easier
// for the forum user"): the bare address of a house with a setup door goes to
// it; the claim brings the browser's time zone; the Requests playlist starts
// with a few songs, and a refusal of them still leaves the preset made.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { STARTER_SONGS } from "../routes.js";
import { makeEnv, makeHouseStore, installFetch } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function blank(extra = {}) {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  Object.assign(e, { SETUP_KEY: KEY, BUTTONS: [], PROGRAM_LIBRARY_KEY: "pagekey12345" }, extra);
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
const cookieOf = (r) => (r.headers.get("set-cookie") ?? "").split(";")[0];

test("the bare address goes to the setup page where there is a setup door, and is not found where there is none", async () => {
  const r = await go(await blank(), "/");
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/setup");
  assert.equal((await go(makeEnv(), "/")).status, 404, "no setup door");
  // Once claimed, the bare address says nothing again.
  const mine = await blank();
  await go(mine, "/setup/claim", { method: "POST", form: { key: KEY } });
  assert.equal((await go(mine, "/")).status, 404, "a claimed house");
  assert.equal((await go(await blank({ SETUP_KEY: "short" }), "/")).status, 404, "a key too short opens nothing");
});

test("the claim keeps the browser's time zone, never over one the house has, and never a wrong one", async () => {
  const e = await blank();
  const form = await (await go(e, "/setup")).text();
  assert.match(form, /<input type="hidden" name="tz" id="stz" value="">/);
  assert.match(form, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  const me = cookieOf(await go(e, "/setup/claim", { method: "POST", form: { key: KEY, tz: "Europe/Amsterdam" } }));
  const list = await (await go(e, "/setup", { cookie: me })).text();
  assert.match(list, /Time zone[\s\S]{0,400}Central European Time/);
  assert.doesNotMatch(list, /Set the time zone/);
  // A house whose file has a zone keeps it.
  const kept = await blank({ HOUSE_TZ: "America/Los_Angeles" });
  const me2 = cookieOf(await go(kept, "/setup/claim", { method: "POST", form: { key: KEY, tz: "Europe/Amsterdam" } }));
  assert.match(await (await go(kept, "/setup", { cookie: me2 })).text(), /Pacific Time/);
  // Nonsense is left for the row to ask.
  const none = await blank();
  const me3 = cookieOf(await go(none, "/setup/claim", { method: "POST", form: { key: KEY, tz: "Mars/Olympus" } }));
  assert.match(await (await go(none, "/setup", { cookie: me3 })).text(), /Set the time zone/);
});

test("the starter songs are three Spotify tracks, and Spotify refusing them still leaves the Requests preset made", async () => {
  assert.equal(STARTER_SONGS.length, 3);
  for (const u of STARTER_SONGS) assert.match(u, /^spotify:track:[A-Za-z0-9]{22}$/);
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const path = new URL(String(u)).pathname;
    if (init?.method === "POST" && path.endsWith("/me/playlists")) return Response.json({ id: "NEWREQUESTS00000000001", name: "Requests" }, { status: 201 });
    if (init?.method === "POST" && /\/playlists\/NEWREQUESTS00000000001\//.test(path)) return Response.json({ error: { status: 403 } }, { status: 403 });
    return inner(u, init);
  };
  try {
    const e = await blank({ HOUSE_TZ: "America/Los_Angeles" });
    const me = cookieOf(await go(e, "/setup/claim", { method: "POST", form: { key: KEY } }));
    const made = await go(e, "/setup/requests", { method: "POST", form: { button: "1" }, cookie: me });
    assert.equal(made.headers.get("location"), "/setup/requests?made=1");
    assert.match(await (await go(e, "/setup/requests?made=1", { cookie: me })).text(), /The playlist is empty, or won(&#39;|')t play<\/summary>\s*<p>Do step 3 first/);
  } finally { globalThis.fetch = inner; f.restore(); }
});

// THE START PAGE (docs/index.html, served by GitHub Pages from the public
// copy): the setup key made in the browser, the Deploy button, and the way
// into the new house's setup page with the key in the address's "#" part,
// which the setup page's own script reads.
test("the start page makes a key of 32 plain characters, loads nothing from elsewhere, and opens /setup#key", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const html = readFileSync(new URL("../../docs/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|<img[^>]+src=|@import|[^A-Z]url\(/, "nothing loaded from elsewhere");
  assert.match(html, /href="https:\/\/deploy\.workers\.cloudflare\.com\/\?url=https:\/\/github\.com\/[\w-]+\/fmwax"/);
  // Its script, run against a stand-in page.
  const els = {};
  const el = (id) => (els[id] ??= { id, textContent: "", value: "", href: "#", attrs: {}, on: {},
    addEventListener(t, f) { this.on[t] = f; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; } });
  const store = new Map();
  const ctx = { document: { getElementById: el }, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    crypto: globalThis.crypto, navigator: {}, URL, confirm: () => true, encodeURIComponent, Uint8Array };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, ctx);
  const key = els.key.textContent;
  assert.match(key, /^[a-hjkmnp-z2-9]{32}$/);
  assert.equal(store.get("fmwax-setup-key"), key, "kept for a return to the page");
  els.addr.value = "fmwax-house.someone.workers.dev/setup";
  els.addr.on.input();
  assert.equal(els.open.href, `https://fmwax-house.someone.workers.dev/setup#${key}`);
  assert.equal(els.open.attrs["aria-disabled"], "false");
  // The whole build log pasted in: the address is found in it.
  els.addr.value = "21:01:52.291 Deployed fmwax-test triggers (0.54 sec) 21:01:52.291 https://fmwax-test.someone.workers.dev 21:01:52.292 schedule: */10 * * * * " +
    "Cloudflare collects anonymous telemetry. Learn more at https://github.com/cloudflare/workers-sdk/tree/main/x Success! Build completed.";
  els.addr.on.input();
  assert.equal(els.open.href, `https://fmwax-test.someone.workers.dev/setup#${key}`);
  assert.equal(els.said3.textContent, "Your house: https://fmwax-test.someone.workers.dev");
  els.addr.value = "http://plain.example";
  els.addr.on.input();
  assert.equal(els.open.attrs["aria-disabled"], "true", "https only");
  // Run again: the same key, not a new one.
  const els1 = key;
  for (const k of Object.keys(els)) delete els[k];
  vm.runInNewContext(script, ctx);
  assert.equal(els.key.textContent, els1);
  // And the setup page takes the key from there.
  const e = await blank();
  assert.match(await (await go(e, "/setup")).text(), /location\.hash\.slice\(1\)[\s\S]*i\.value = decodeURIComponent\(h\)/);
});
