// THE SETTINGS STORE (MC-31, the settings storage, steps 1 and 2,
// 2026-10-16): the vars copied into the HOUSE object, and every request
// reading the copy with the vars underneath (settings.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../worker.js";
import { SETTING_NAMES, choosePageSetting, settingsOf, withSettings } from "../settings.js";
import { TEMPLATE_FILE } from "../install/config.js";
import { makeEnv, makeHouseStore } from "./harness.js";

async function house() {
  const e = makeEnv();
  e.HELPER_SECRET = "home-key";
  e.HOUSE = (await makeHouseStore()).binding;
  e.BUTTONS = [{ button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" }];
  e.HOUSE_TZ = "America/Los_Angeles";
  // Claimed: only a claimed house's requests read the store (settings.js).
  await e.PROGRAMS.put("house:claimed", new Date().toISOString());
  return e;
}
test("the names are every [vars] line the template can render, and nothing else", () => {
  const t = readFileSync(TEMPLATE_FILE, "utf8");
  const vars = t.slice(t.indexOf("\n[vars]\n"));
  const end = vars.slice(1).search(/\n\[/);
  const names = [...(end < 0 ? vars : vars.slice(0, end + 1)).matchAll(/^([A-Z][A-Z_]+) = /gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)].sort(), [...SETTING_NAMES].sort());
});

test("the owner's look at /house/settings is gone (2026-10-23): a plain 404, even with the home side's key", async () => {
  const e = await house();
  const r = await worker.fetch(new Request("https://fmwax.test/house/settings", { headers: { authorization: "Bearer home-key" } }), e, null);
  assert.equal(r.status, 404);
});

test("copied in, the store gives back the same settings", async () => {
  const e = await house();
  const first = await withSettings(e, null);
  assert.equal(first.__settings, "vars: nothing stored, copied in");
  const next = await withSettings(e, null);
  assert.equal(next.__settings, "store");
  for (const [n, v] of Object.entries(settingsOf(e))) assert.deepEqual(next[n], v, n);
});

test("a house.json edit wins over a copy made from the old vars", async () => {
  const e = await house();
  await withSettings(e, null);
  e.HOUSE_TZ = "Europe/Amsterdam";
  const edited = await withSettings(e, null);
  assert.equal(edited.__settings, "vars: house.json changed, copied in");
  assert.equal(edited.HOUSE_TZ, "Europe/Amsterdam");
  const after = await withSettings(e, null);
  assert.equal(after.__settings, "store");
  assert.equal(after.HOUSE_TZ, "Europe/Amsterdam");
});

test("a setting chosen on the page wins for its name only, and a house.json edit still reaches the rest", async () => {
  const e = await house();
  await withSettings(e, null); // the file's copy
  const stub = e.HOUSE.get();
  const page = (name, value) => stub.fetch("https://house/page", { method: "POST", body: JSON.stringify({ name, value }) });
  assert.equal((await page("DEFAULT_DEVICE", "Ultra")).status, 200);
  assert.equal((await page("PLAYLIST_ALIASES", "{}")).status, 400, "only the names the page may choose");
  const s2 = await withSettings(e, null);
  assert.equal(s2.__settings, "store");
  assert.equal(s2.DEFAULT_DEVICE, "Ultra");
  assert.equal(s2.HOUSE_TZ, "America/Los_Angeles");

  // house.json edited: a deploy with a new zone and a new default.
  e.HOUSE_TZ = "Europe/Amsterdam";
  e.DEFAULT_DEVICE = "Dining Room";
  const s3 = await withSettings(e, null);
  assert.equal(s3.HOUSE_TZ, "Europe/Amsterdam", "the file's edit reaches a name the page never chose");
  assert.equal(s3.DEFAULT_DEVICE, "Ultra", "the page's choice stands");
  const s4 = await withSettings(e, null);
  assert.equal(s4.__settings, "store");
  assert.deepEqual([s4.HOUSE_TZ, s4.DEFAULT_DEVICE], ["Europe/Amsterdam", "Ultra"], "and the copy kept the page's choice");
  assert.deepEqual(Object.keys(s4.__page), ["DEFAULT_DEVICE"]);

  // Choosing the file's own value hands the setting back to the file.
  await choosePageSetting(s4, "DEFAULT_DEVICE", "Dining Room");
  const s5 = await withSettings(e, null);
  assert.deepEqual(s5.__page, {});
  e.DEFAULT_DEVICE = "Pro Plus";
  assert.equal((await withSettings(e, null)).DEFAULT_DEVICE, "Pro Plus", "the file governs it again");
});

test("no store, or one that does not answer: the vars, as before", async () => {
  const plain = makeEnv();
  assert.equal(await withSettings(plain, null), plain);
  const e = await house();
  e.HOUSE = { idFromName: () => "household", get: () => ({ fetch: async () => { throw new Error("down"); } }) };
  const s2 = await withSettings(e, null);
  assert.equal(s2.__settings, "vars: the store did not answer");
  assert.equal(s2.HOUSE_TZ, "America/Los_Angeles");
});

test("the store refuses a name that is not a setting", async () => {
  const stub = (await makeHouseStore()).binding.get();
  const r = await stub.fetch("https://house/settings", { method: "PUT", body: JSON.stringify({ settings: { MCP_SECRET: "x" } }) });
  assert.equal(r.status, 400);
});

test("a call the object refuses once (a restart on new code) is made again, and the page's choice lands", async () => {
  const e = await house();
  const real = e.HOUSE;
  let refused = 0;
  e.HOUSE = { idFromName: () => "household", get: () => ({ fetch: async (u, init) => {
    if (!refused++) throw new Error("Durable Object reset because its code was updated.");
    return real.get().fetch(u, init);
  } }) };
  const page = await choosePageSetting({ ...e, __vars: settingsOf(e) }, "DEFAULT_DEVICE", "Ultra");
  assert.deepEqual(page, { DEFAULT_DEVICE: "Ultra" });
  assert.equal(refused, 2, "refused once, then answered");
});

test("an unclaimed house leaves its store alone: no request places it, and the health check never reads it", async () => {
  const e = makeEnv();
  const store = await makeHouseStore();
  e.HOUSE = store.binding;
  e.HELPER_SECRET = "home-key";
  await worker.fetch(new Request("https://fmwax.test/buttons/nokey/whatever"), e, null);
  await worker.fetch(new Request("https://fmwax.test/health"), e, null);
  assert.equal(store.calls, 0, "unclaimed: nothing touched the store");
  const claimed = await house();
  const counted = await makeHouseStore();
  claimed.HOUSE = counted.binding;
  await worker.fetch(new Request("https://fmwax.test/health"), claimed, null);
  assert.equal(counted.calls, 0, "the health check reads no setting");
});

test("an answer of 500 from the object is asked once more too", async () => {
  const e = await house();
  const real = e.HOUSE;
  let n = 0;
  e.HOUSE = { idFromName: () => "household", get: () => ({ fetch: async (u, init) => {
    if (!n++) return new Response("reset", { status: 500 });
    return real.get().fetch(u, init);
  } }) };
  assert.deepEqual(await choosePageSetting({ ...e, __vars: settingsOf(e) }, "DEFAULT_DEVICE", "Ultra"), { DEFAULT_DEVICE: "Ultra" });
  assert.equal(n, 2);
});
