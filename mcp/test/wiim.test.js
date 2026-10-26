// The speakers' preset labels: the ledger of which buttons are owed a re-save
// in the WiiM app, and the page that keeps it. Nothing here writes to a
// speaker — the table write this page once prepared detached the preset it
// renamed (docs/roster.md, "The label write BREAKS the preset"); its old
// addresses are gone (2026-10-18).
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, track, putTile } from "./harness.js";


const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;

// A test house: Hank on 2, the archive on 6, Soul on 7 (Nightside until the
// merges, 2026-10-13, then the Selector until the owner cut him, 2026-10-15),
// and 12 installed empty.
function houseEnv(over = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([
    { button: 2, dj: "hank", playlist: P(2) },
    { button: 6, archive: true },
    { button: 7, dj: "soul", playlist: P(7) },
    { button: 12, playlist: P(12) },
  ]);
  return Object.assign(e, over);
}
const get = (p) => new Request(`https://x.test${p}`);
const post = (p, body, headers = {}) => new Request(`https://x.test${p}`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });
const SWAPPED = "2026-09-04T10:00:00.000Z";
const wallAfterSwap = { v: 1, updated: SWAPPED, slots: {
  "2": { dj: null, left: "hank", since: SWAPPED },
  "7": { dj: "soul" },
  "12": { dj: "hank", since: SWAPPED },
} };

// THE PRESSED BUTTON MUST REACH THE SERVER (2026-09-07). The shared guard
// disabled every submit button inside the submit event — synchronously, before
// the browser builds the form data — and a disabled control is left out of
// that data, the pressed button included. So "It says Gatefold" posted
// saw="" and was refused as a wrong answer, every time, while curl and every
// unit test (neither runs the script) said the route was fine. Proved in
// Chromium: submitter disabled at the moment the entry list is built, fields
// sent = btn and speaker only. This pins the shape that makes it impossible
// to reintroduce by "simplifying" the guard back to synchronous.
test("the submit guard disables buttons only AFTER the form has been read", async () => {
  // The checklist's forms: with nothing owed, /wiim is option A (2026-09-13),
  // which posts nothing, so the checklist is asked for by its speaker.
  const html = await (await worker.fetch(get(`/buttons/${KEY}/wiim?on=pro-plus`), houseEnv())).text();
  const at = html.indexOf('document.addEventListener("submit"');
  assert.ok(at > 0, "the guard is on the page");
  const guard = html.slice(at, html.indexOf("</script>", at));
  assert.match(guard, /setTimeout\(function \(\) \{[\s\S]*b\.disabled = true[\s\S]*\}, 0\);/,
    "disabling is deferred behind a zero timer");
  const outsideTimer = guard.replace(/setTimeout\(function \(\) \{[\s\S]*?\}, 0\);/, "");
  assert.ok(!outsideTimer.includes("disabled = true"),
    "and nothing disables a control synchronously in the handler");
});

test("the meter is its own page now", async () => {
  const e = houseEnv();
  const r = await worker.fetch(get(`/buttons/${KEY}/use`), e);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<h1>Use<\/h1>/);
  assert.match(html, /<h2 id="uspot">Spotify<span class="usub">/);
  assert.match(html, /<h2 id="ucf">Cloudflare<span class="usub">/);
  assert.match(html, new RegExp(`href="/buttons/${KEY}/wiim"><svg class="ic"[^>]*>[\\s\\S]*?</svg>Speakers</a>`));
  assert.equal((await worker.fetch(post(`/buttons/${KEY}/use`, ""), e)).status, 405);
  assert.equal((await worker.fetch(get(`/buttons/${KEY}/wiim/use`), e)).status, 404, "its old address is gone");
});

test("the old shortcut addresses are gone, and the wrong key gets nothing", async () => {
  const e = houseEnv();
  for (const req of [
    get(`/buttons/${KEY}/wiim/read.xml`),
    post(`/buttons/${KEY}/wiim/pro-plus`, "<KeyList/>", { "content-type": "text/xml" }),
    get(`/buttons/${KEY}/wiim/pro-plus/undo.xml`),
  ]) {
    assert.equal((await worker.fetch(req, e)).status, 404, req.url);
  }
  assert.equal((await worker.fetch(get(`/buttons/${"x".repeat(24)}/wiim`), e)).status, 404);
  assert.equal((await worker.fetch(get(`/buttons/${"x".repeat(24)}/wiim/read.xml`), e)).status, 404);
  assert.equal((await worker.fetch(post(`/buttons/${"x".repeat(24)}/wiim/done`, "btn=2"), e)).status, 404);
  assert.equal((await worker.fetch(post(`/buttons/${KEY}/wiim`, "btn=2"), e)).status, 405);
});

test("the grid points at the Speakers tab, never a shortcut", async () => {
  const e = houseEnv();
  const f = installFetch({ contents: [track("a")] });
  try {
    // The grid carries no sentence any more (2026-09-05); its footer names the
    // ledger always, and never a shortcut.
    const grid = await (await worker.fetch(get(`/buttons/${KEY}`), e)).text();
    assert.ok(grid.includes(`<a class="tab" href="/buttons/${KEY}/wiim">`), "the Speakers tab (MC-14)");
    assert.ok(!grid.includes("shortcuts://") && !grid.includes("Sync DJs"));
  } finally { f.restore(); }
});
