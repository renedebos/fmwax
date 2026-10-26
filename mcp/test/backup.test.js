// BACKUP AND REPAIR (MC-31, 2026-10-17): the owner's backup file, putting it
// back on this house or a newly claimed one, and the check of the house.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { readBackup } from "../backup.js";
import { nameDevice } from "../services.js";
import { makeEnv, makeHouseStore, installFetch } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function blank() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  for (const n of ["MCP_SECRET", "AGENT_SECRET", "PROGRAM_LIBRARY_KEY", "HELPER_SECRET"]) delete e[n];
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null, body = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: body ?? (form ? new URLSearchParams(form) : undefined) }), e, null);
async function claim(e) {
  return ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
}
const upload = (text) => { const fd = new FormData(); fd.append("file", new File([text], "house-backup.json", { type: "application/json" })); return fd; };

test("only the owner gets the backup, the restore page and the check", async () => {
  const e = await blank();
  await claim(e);
  for (const p of ["/setup/backup", "/setup/restore", "/setup/check"]) assert.equal((await go(e, p)).status, 303, p);
  assert.equal((await go(e, "/setup/restore", { method: "POST", body: upload("{}") })).status, 303);
});

test("a backup holds the page's choices and the house's own keys, and goes back onto a new house", async () => {
  const e = await blank();
  const me = await claim(e);
  await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Ultra" }, cookie: me });
  await go(e, "/setup/spotify-app", { method: "POST", form: { client_id: "0123456789abcdef0123456789abcdef" }, cookie: me });
  const r = await go(e, "/setup/backup", { cookie: me });
  assert.match(r.headers.get("content-disposition"), /attachment; filename="house-backup-\d{4}-\d\d-\d\d\.json"/);
  const file = await r.text();
  const b = JSON.parse(file);
  assert.equal(b.kind, "fmwax-house-backup");
  assert.equal(b.page.DEFAULT_DEVICE, "Ultra");
  assert.equal(b.keys.SPOTIFY_CLIENT_ID, "0123456789abcdef0123456789abcdef");
  assert.ok(b.keys.MCP_SECRET && b.keys.PROGRAM_LIBRARY_KEY);

  // A new house, claimed, gets the old one back: the same connector key.
  const fresh = await blank();
  const me2 = await claim(fresh);
  const put = await go(fresh, "/setup/restore", { method: "POST", body: upload(file), cookie: me2 });
  assert.equal(put.headers.get("location"), "/setup?saved=restore");
  const list = await (await go(fresh, "/setup?saved=restore", { cookie: me2 })).text();
  assert.match(list, /The backup is back/);
  assert.match(list, /Ultra is the default/);
  assert.ok(list.includes(`/mcp/${b.keys.MCP_SECRET}`), "the connector's address is the old one");
  assert.deepEqual(b.speakers, {}, "no speaker was named on this house");
  assert.match(list, /Every step ticks itself/, "the restoring browser is still the owner");
});

test("a file that is not a backup, or names settings the house does not have, changes nothing", async () => {
  assert.match(readBackup("not json").why, /not a house backup/);
  assert.match(readBackup(JSON.stringify({ kind: "something-else", version: 1 })).why, /not a house backup made by this app/);
  assert.match(readBackup(JSON.stringify({ kind: "fmwax-house-backup", version: 1, page: { PLAYLIST_ALIASES: "{}" } })).why, /settings this house does not have/);
  assert.match(readBackup(JSON.stringify({ kind: "fmwax-house-backup", version: 1, keys: { MCP_SECRET: "short" } })).why, /not the shape/);
  // Each value read as the house reads it, and no two keys alike (Codex, 2026-10-17).
  const file = (o) => JSON.stringify({ kind: "fmwax-house-backup", version: 1, ...o });
  assert.match(readBackup(file({ page: { BUTTONS: "x" } })).why, /BUTTONS is not a value this house can use/);
  assert.match(readBackup(file({ page: { HOUSE_TZ: "Mars/Olympus" } })).why, /HOUSE_TZ is not a value/);
  assert.match(readBackup(file({ page: { REQUESTS_ENABLED: "yes" } })).why, /REQUESTS_ENABLED is not a value/);
  const same = "abcdefghijklmnopqrstuvwx";
  assert.match(readBackup(file({ keys: { MCP_SECRET: same, PROGRAM_LIBRARY_KEY: same } })).why, /Two of the backup's keys are the same/);
  assert.match(readBackup(file({ speakers: { "../x": "Ultra" } })).why, /speaker names are not readable/);
  assert.ok(readBackup(file({ page: { HOUSE_TZ: "Europe/Amsterdam", ROOM_DEVICES: '["Ultra"]', REQUESTS_ENABLED: "true" },
    speakers: { "5cf5aaaa0000bbbb": "Pro Plus" } })).ok);
  const e = await blank();
  const me = await claim(e);
  const bad = await go(e, "/setup/restore", { method: "POST", body: upload("{\"kind\":\"x\"}"), cookie: me });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /not a house backup/);
});

test("the check asks each part now and says what to do", async () => {
  const f = installFetch();
  try {
    const e = await blank();
    const me = await claim(e);
    const html = await (await go(e, "/setup/check", { cookie: me })).text();
    for (const part of ["The house(&#39;|')s storage", "The request ledger", "The key-value stores", "Spotify", "Claude or ChatGPT"]) {
      assert.match(html, new RegExp(part));
    }
    assert.match(html, /It has never called: add the house to Claude or ChatGPT/);
    assert.doesNotMatch(html, /The home helper/, "a helper that never ran is not missed");
  } finally { f.restore(); }
});

// THE PRACTICE INSTALL (2026-10-19): the check looked only for a Claude
// routine, so a ChatGPT curator was never checked.
test("the check looks at a ChatGPT curator too: never checked in, nobody listening, and well", async () => {
  const f = installFetch();
  try {
    const e = await blank();
    const me = await claim(e);
    e.AGENT_SECRET = "agent-secret-agent-secret-agent-1";
    e.CURATOR = "chatgpt";
    const check = async () => (await go(e, "/setup/check", { cookie: me })).text();
    assert.match(await check(), /It has never checked in: look at its Work chat at chatgpt\.com/);
    await e.PROGRAMS.put("curator:seen", JSON.stringify({ at: Date.now() }));
    assert.match(await check(), /No Work chat is listening for the house(&#39;|')s work/);
    await e.PROGRAMS.put("events:subs", JSON.stringify([{ id: "sub_1", name: "house.work", url: "https://x.test/cb",
      secret: "whsec_x", refreshBefore: new Date(Date.now() + 86400e3).toISOString() }]));
    assert.match(await check(), /Checked in within the hour/);
  } finally { f.restore(); }
});

test("a speaker named on the page travels in the backup (a WiiM that shows Spotify only a code)", async () => {
  const e = await blank();
  const me = await claim(e);
  await nameDevice(e, "5cf5aaaa0000bbbb1111", "Pro Plus");
  const file = await (await go(e, "/setup/backup", { cookie: me })).text();
  assert.deepEqual(JSON.parse(file).speakers, { "5cf5aaaa0000bbbb1111": "Pro Plus" });
  const fresh = await blank();
  const me2 = await claim(fresh);
  await go(fresh, "/setup/restore", { method: "POST", body: upload(file), cookie: me2 });
  assert.equal(await fresh.PROGRAMS.get("device-label:5cf5aaaa0000bbbb1111"), "Pro Plus");
  assert.equal(await fresh.PROGRAMS.get("device:pro plus"), "5cf5aaaa0000bbbb1111");
});
