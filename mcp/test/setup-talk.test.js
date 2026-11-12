// TALK, AN EXTRA (MC-40; tasks/mc40-dj-presets.md, *The levels*): the owner's
// own OpenAI key, pasted on the setup page and tested before it is kept; the
// minutes a day as the house's own setting; the key out of backups; and the
// key handed to the Station, whose alarm ends a call at the day's cap.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { forgetKeptSettings, withSettings, BACKUP_KEYS } from "../settings.js";
import { talkMinutes, TALK_MINUTES_CHOICES, VOICE_MODEL } from "../voice.js";
import { voiceCloseKey } from "../station.js";
import { setupChecklist } from "../checklist.js";
import { makeEnv, makeHouseStore, installFetch } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
const GOOD = "sk-proj-" + "a1B2c3D4".repeat(6);
async function house(over = {}) {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.PROGRAM_LIBRARY_KEY = "pagekey12345";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: "REQUESTS00000000000001", catalog: "spotify" }]);
  delete e.ENDLESS;
  Object.assign(e, over);
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
const claim = async (e) => ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
const settled = async (e) => { forgetKeptSettings(e); return withSettings(e, null); };
// OpenAI answering the model question as told, and a record of what it was asked.
function openai(status) {
  const asked = [];
  const f = installFetch({ openai: ({ path, headers }) => { asked.push({ path, auth: headers.authorization }); return new Response("{}", { status: status.now }); } });
  return { asked, restore: () => f.restore() };
}

test("a house with no key is offered Talk; the key is tested with OpenAI before it is kept, and a new house starts at 30 minutes", async () => {
  const status = { now: 200 };
  const o = openai(status);
  try {
    const e = await house();
    const me = await claim(e);
    const list = await setupChecklist(await settled(e), { claimed_at: new Date().toISOString() });
    const row = list.sections.find((s) => s.key === "talk").rows[0];
    assert.deepEqual([row.state, row.href, row.label], ["offer", "/setup/talk", "Set up Talk"]);
    const page = await (await go(e, "/setup/talk", { cookie: me })).text();
    assert.match(page, /paid by the minute on <b>your own OpenAI account<\/b>: about 5 cents a minute/);
    assert.match(page, /separate from ChatGPT Plus/);
    assert.match(page, /<option value="30" selected>30 minutes a day \(at most about \$1\.50 a day\)<\/option>/);
    assert.match(page, /is not part of a backup file/);

    const post = (form) => go(e, "/setup/talk", { method: "POST", form, cookie: me });
    assert.equal((await post({ do: "key", key: "not a key" })).status, 400);
    assert.equal(o.asked.length, 0, "a key of the wrong shape is never sent anywhere");
    status.now = 401;
    assert.match(await (await post({ do: "key", key: GOOD })).text(), /OpenAI did not accept that key\. Nothing was kept/);
    status.now = 404;
    assert.match(await (await post({ do: "key", key: GOOD })).text(), new RegExp(`cannot use the voice model \\(${VOICE_MODEL}\\) yet\\. Nothing was kept`));
    status.now = 500;
    assert.equal((await post({ do: "key", key: GOOD })).status, 503);
    assert.equal((await settled(e)).OPENAI_API_KEY, undefined, "nothing kept by a refusal");
    assert.deepEqual(o.asked.at(-1), { path: `/models/${VOICE_MODEL}`, auth: `Bearer ${GOOD}` }, "the question is the voice model's, with the pasted key");

    status.now = 200;
    const ok = await post({ do: "key", key: GOOD, minutes: "30" });
    assert.equal(ok.headers.get("location"), "/setup/talk?talk=on#done");
    const now = await settled(e);
    assert.equal(now.OPENAI_API_KEY, GOOD);
    assert.ok(now.__keys.includes("OPENAI_API_KEY"), "a key the page gave, not a secret");
    assert.equal(talkMinutes(now), 30);
    const on = await (await go(e, "/setup/talk?talk=on", { cookie: me })).text();
    assert.match(on, /Talk is on/);
    assert.match(on, new RegExp(`ending …${GOOD.slice(-4)}`));
    assert.ok(!on.includes(GOOD), "the key itself is never shown again");
    assert.match(on, /30 minutes a day<\/b><span>At most about \$1\.50 a day/);
    // The Talk tab is there now.
    assert.equal((await go(e, "/buttons/pagekey12345/talk")).status, 200);
  } finally { o.restore(); }
});

test("the minutes are the owner's: one of four, never more; Remove takes the key and the tab away", async () => {
  const o = openai({ now: 200 });
  try {
    const e = await house();
    const me = await claim(e);
    const post = (form) => go(e, "/setup/talk", { method: "POST", form, cookie: me });
    await post({ do: "key", key: GOOD, minutes: "20" });
    assert.equal(talkMinutes(await settled(e)), 20, "the minutes chosen with the key");
    assert.equal((await post({ do: "minutes", minutes: "60" })).headers.get("location"), "/setup/talk?talk=minutes#done");
    assert.equal(talkMinutes(await settled(e)), 60);
    for (const bad of ["45", "600", "0", "-5", "abc"]) assert.equal((await post({ do: "minutes", minutes: bad })).status, 400, bad);
    assert.equal(talkMinutes(await settled(e)), 60, "a refused number changes nothing");
    assert.deepEqual(TALK_MINUTES_CHOICES, [10, 20, 30, 60]);
    assert.equal((await post({ do: "remove" })).headers.get("location"), "/setup/talk?talk=off#done");
    assert.equal((await settled(e)).OPENAI_API_KEY, undefined);
    assert.equal((await go(e, "/buttons/pagekey12345/talk")).status, 404, "no key, no Talk tab");
    assert.equal((await go(e, "/setup/talk", { method: "POST", form: { do: "key", key: GOOD } })).status, 303, "not signed in: back to setup");
    assert.equal((await settled(e)).OPENAI_API_KEY, undefined);
  } finally { o.restore(); }
});

test("a house whose key is a Worker secret keeps it and its 60 minutes: shown as it is, never changed from the page", async () => {
  const o = openai({ now: 200 });
  try {
    const e = await house({ OPENAI_API_KEY: "sk-the-owners-own-secret-000000" });
    const me = await claim(e);
    assert.equal(talkMinutes(await settled(e)), 60, "nothing chosen is 60, as every house had");
    assert.equal(talkMinutes({ TALK_MINUTES: "45" }), 60, "a stored value that is not a choice is not obeyed");
    assert.equal(talkMinutes({ TALK_MINUTES: "600" }), 60);
    const page = await (await go(e, "/setup/talk", { cookie: me })).text();
    assert.match(page, /Its key is set as a Worker secret on this house/);
    assert.doesNotMatch(page, /Remove the key/);
    const post = (form) => go(e, "/setup/talk", { method: "POST", form, cookie: me });
    assert.equal((await post({ do: "key", key: GOOD })).status, 409);
    assert.equal((await post({ do: "remove" })).status, 409);
    assert.equal((await settled(e)).OPENAI_API_KEY, "sk-the-owners-own-secret-000000");
    assert.equal((await post({ do: "minutes", minutes: "30" })).status, 303, "its owner may still choose the minutes");
    assert.equal(talkMinutes(await settled(e)), 30);
  } finally { o.restore(); }
});

test("the OpenAI key is in no backup file, and a restore leaves the key the house holds", async () => {
  const o = openai({ now: 200 });
  try {
    const e = await house();
    const me = await claim(e);
    await go(e, "/setup/talk", { method: "POST", form: { do: "key", key: GOOD }, cookie: me });
    const file = await (await go(e, "/setup/backup", { cookie: me })).text();
    assert.ok(!file.includes(GOOD) && !file.includes("OPENAI_API_KEY"), "neither the key nor its name");
    assert.equal(JSON.parse(file).page.TALK_MINUTES, "30", "the minutes are a setting, and are kept");
    assert.ok(!BACKUP_KEYS.includes("OPENAI_API_KEY"));
    const fd = new FormData();
    fd.append("file", new File([file], "house-backup.json", { type: "application/json" }));
    const r = await worker.fetch(new Request(`${ORIGIN}/setup/restore`, { method: "POST", redirect: "manual", headers: { cookie: me, origin: ORIGIN }, body: fd }), e, null);
    assert.ok(r.status < 400);
    assert.equal((await settled(e)).OPENAI_API_KEY, GOOD, "the same house still has its key after a restore");
  } finally { o.restore(); }
});

test("the Station can end a call on a key the page gave: the Worker sends it with the reserve, and a secret is never sent", async () => {
  assert.equal(voiceCloseKey({ OPENAI_API_KEY: "sk-secret" }, "sk-kept"), "sk-secret", "the object's own secret wins");
  assert.equal(voiceCloseKey({}, "sk-kept"), "sk-kept", "else the key the Worker handed over");
  assert.equal(voiceCloseKey({}, undefined), null);
  const ANSWER = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\ns=answer\r\n";
  const f = installFetch({ openai: ({ path }) => path.startsWith("/models/") ? new Response("{}", { status: 200 })
    : new Response(JSON.stringify({ session: { id: "live_abc" }, transport: { type: "webrtc", sdp: ANSWER } }), { status: 201, headers: { "content-type": "application/json" } }) });
  try {
    const open = async (e) => {
      const sent = [];
      const real = e.STATION.get;
      e.STATION.get = (id) => { const stub = real.call(e.STATION, id); return { fetch: async (u, init) => { try { sent.push(JSON.parse(init.body)); } catch { /* not ours */ } return stub.fetch(u, init); } }; };
      const r = await worker.fetch(new Request(`${ORIGIN}/buttons/pagekey12345/talk/session`, { method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/sdp" }, body: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n" }), e, null);
      return { status: r.status, reserve: sent.find((b) => b.op === "voice-reserve") ?? null };
    };
    // A house on a given key: the reserve carries it, and the minutes are the house's.
    const e = await house();
    const me = await claim(e);
    await go(e, "/setup/talk", { method: "POST", form: { do: "key", key: GOOD, minutes: "20" }, cookie: me });
    const given = await open(e);
    assert.equal(given.status, 201);
    assert.equal(given.reserve.args.close_key, GOOD);
    assert.equal(given.reserve.args.cap_minutes, 20);
    // A house on a Worker secret: the Station has it in its own env, so nothing is sent.
    const s = await house({ OPENAI_API_KEY: "sk-the-owners-own-secret-000000" });
    await claim(s);
    const secret = await open(s);
    assert.equal(secret.status, 201);
    assert.equal("close_key" in secret.reserve.args, false);
    assert.equal(secret.reserve.args.cap_minutes, 60);
  } finally { f.restore(); }
});
