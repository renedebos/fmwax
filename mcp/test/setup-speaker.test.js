// THE DEFAULT SPEAKER, CHOSEN ON THE SETUP PAGE (MC-31 stage 6, its first
// action, 2026-10-17): the owner's only, from the house's rooms, kept as the
// page's own setting on top of the file's (settings.js PAGE_SETTINGS).
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function house() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra", "Dining Room"]);
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null, origin = ORIGIN } = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method === "POST" && origin) headers.origin = origin;
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body: form ? new URLSearchParams(form) : undefined }), e, null);
};
async function owner(e) {
  const r = await go(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
}

test("only the owner reaches the speaker page; anyone else is sent to /setup", async () => {
  const e = await house();
  const me = await owner(e);
  const them = await go(e, "/setup/speaker");
  assert.equal(them.status, 303);
  assert.match(them.headers.get("location"), /\/setup$/);
  const post = await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Ultra" } });
  assert.equal(post.status, 303);
  const page = await (await go(e, "/setup/speaker", { cookie: me })).text();
  assert.match(page, /Which speaker\?/);
  assert.match(page, /value="Pro Plus" checked/);
  assert.match(page, /Pro Plus<small>the file(&#39;|')s choice<\/small>/);
  assert.match(page, /value="Dining Room"/);
});

test("the owner picks a speaker: it is the default from the next request, and the checklist says so", async () => {
  const e = await house();
  const me = await owner(e);
  const r = await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Ultra" }, cookie: me });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/setup?saved=speaker");
  const list = await (await go(e, "/setup?saved=speaker", { cookie: me })).text();
  assert.match(list, /Ultra is the default speaker now\./);
  assert.match(list, /Ultra is the default/);
  assert.match(list, /href="\/setup\/speaker">Change</);
});

test("a name that is not one of the house's rooms, or a post from elsewhere, changes nothing", async () => {
  const e = await house();
  const me = await owner(e);
  const bad = await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Neighbour's Sonos" }, cookie: me });
  assert.equal(bad.status, 400);
  const away = await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Ultra" }, cookie: me, origin: "https://evil.test" });
  assert.equal(away.status, 403);
  assert.match(await (await go(e, "/setup", { cookie: me })).text(), /Pro Plus is the default/);
});

test("picking the file's own speaker hands the setting back to the file", async () => {
  const e = await house();
  const me = await owner(e);
  await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Ultra" }, cookie: me });
  await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Pro Plus" }, cookie: me });
  e.DEFAULT_DEVICE = "Dining Room"; // house.json edited and deployed
  assert.match(await (await go(e, "/setup", { cookie: me })).text(), /Dining Room is the default/);
});

test("a house with no rooms offers none, never the code's stand-in speaker", async () => {
  const e = await house();
  delete e.ROOM_DEVICES;
  delete e.DEFAULT_DEVICE;
  const me = await owner(e);
  const page = await (await go(e, "/setup/speaker", { cookie: me })).text();
  assert.match(page, /no speakers on its list yet/);
  assert.doesNotMatch(page, /value="Pro Plus"/);
  const r = await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Pro Plus" }, cookie: me });
  assert.equal(r.status, 400);
});

test("a blank house finds its speakers through Spotify, keeps them, then chooses the default", async () => {
  const { installFetch } = await import("./harness.js");
  const f = installFetch();
  try {
    const e = await house();
    delete e.ROOM_DEVICES;
    delete e.DEFAULT_DEVICE;
    const me = await owner(e);
    const list0 = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(list0, /href="\/setup\/speaker\?find=1">Find speakers</);
    const found = await (await go(e, "/setup/speaker?find=1", { cookie: me })).text();
    assert.match(found, /name="room" value="Pro Plus" checked/);
    const kept = await go(e, "/setup/rooms", { method: "POST", form: { room: "Pro Plus" }, cookie: me });
    assert.equal(kept.headers.get("location"), "/setup/speaker?saved=rooms");
    const pick = await (await go(e, "/setup/speaker?saved=rooms", { cookie: me })).text();
    assert.match(pick, /Speakers kept\./);
    assert.match(pick, /value="Pro Plus"/);
    assert.match(await (await go(e, "/setup", { cookie: me })).text(), /One speaker on the list, no default yet/);
    await go(e, "/setup/speaker", { method: "POST", form: { speaker: "Pro Plus" }, cookie: me });
    assert.match(await (await go(e, "/setup", { cookie: me })).text(), /Pro Plus is the default/);
  } finally { f.restore(); }
});

test("finding again keeps the speakers that are asleep now; with no Spotify app it says what comes first", async () => {
  const { installFetch } = await import("./harness.js");
  const f = installFetch();
  try {
    const e = await house(); // Pro Plus, Ultra, Dining Room on the list; Spotify sees the Pro Plus
    const me = await owner(e);
    const page = await (await go(e, "/setup/speaker?find=1", { cookie: me })).text();
    assert.match(page, /value="Ultra" checked> Ultra<small>asleep now, kept<\/small>/);
    delete e.SPOTIFY_CLIENT_ID;
    assert.match(await (await go(e, "/setup/speaker?find=1", { cookie: me })).text(), /Set up the Spotify app first/);
  } finally { f.restore(); }
});

test("a WiiM Spotify lists under its id is found by the name the house knows it by; one with no known name is counted", async () => {
  const { installFetch } = await import("./harness.js");
  const hexA = "5e9e3c1bae8ed3521d3caf9dffd8b88a46c8a3de", hexB = "5cf5000000000000000000000000000000a48c";
  const f = installFetch();
  // Spotify's device list as the owner's house saw it on 2026-10-17.
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).includes("/me/player/devices")
    ? Response.json({ devices: [{ id: hexA, name: hexA }, { id: hexB, name: hexB }, { id: "echo-1", name: "Dining Room" }] })
    : inner(u, init);
  try {
    const e = await house();
    await e.PROGRAMS.put(`device-name:${hexA}`, "Ultra");
    const me = await owner(e);
    const page = await (await go(e, "/setup/speaker?find=1", { cookie: me })).text();
    assert.match(page, /value="Ultra" checked> Ultra<\/label>/, "found, by the name the house noted");
    assert.doesNotMatch(page, new RegExp(`value="${hexB}" checked`), "not offered as a speaker to keep under its code");
    assert.match(page, /One speaker without a name/);
    assert.match(page, new RegExp(`name="id" value="${hexB}"`));
    assert.match(page, /code ending a48c/);
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("a nameless speaker named on the page: marked when playing, then on the list, shown and played by its name", async () => {
  const { installFetch } = await import("./harness.js");
  const { recallDevice, deviceDisplayName } = await import("../services.js");
  const hex = "5cf5000000000000000000000000000000a48c";
  const f = installFetch();
  const inner = globalThis.fetch;
  // The Ultra case: "active" on the list is not playing; the player says
  // which one is.
  let playing = hex;
  globalThis.fetch = async (u, init) => String(u).endsWith("/me/player/devices")
    ? Response.json({ devices: [{ id: hex, name: hex, is_active: false }, { id: "other0000", name: "other0000", is_active: true },
      { id: "echo-1", name: "Dining Room" }, { id: "pp-1", name: "Pro Plus" }] })
    : /\/me\/player(\?|$)/.test(new URL(String(u)).pathname + new URL(String(u)).search)
      ? Response.json({ is_playing: true, device: { id: playing } })
      : inner(u, init);
  try {
    const e = await house();
    delete e.ROOM_DEVICES;
    delete e.DEFAULT_DEVICE;
    const me = await owner(e);
    const page = await (await go(e, "/setup/speaker?find=1", { cookie: me })).text();
    assert.match(page, /code ending a48c · <b>playing now<\/b>/);
    assert.doesNotMatch(page, /code ending 0000 · <b>playing now/, "the list's active flag is not playing");
    // Another speaker already publishes "Pro Plus": refused.
    const clash = await go(e, "/setup/name", { method: "POST", form: { id: hex, name: "pro plus" }, cookie: me });
    assert.equal(clash.status, 409);
    assert.match(await clash.text(), /Another speaker is already called pro plus/);
    const r = await go(e, "/setup/name", { method: "POST", form: { id: hex, name: "Ultra" }, cookie: me });
    assert.equal(r.headers.get("location"), "/setup/speaker?find=1&named=Ultra");
    assert.equal(await recallDevice(e, "ultra"), hex, "a play to the Ultra resolves to it");
    assert.equal(await deviceDisplayName(e, { id: hex, name: hex }), "Ultra", "the pages call it Ultra");
    const again = await (await go(e, "/setup/speaker?find=1&named=Ultra", { cookie: me })).text();
    assert.match(again, /Named: Ultra\. It is on the house(&#39;|')s list\./);
    assert.match(again, /value="Ultra" checked> Ultra<\/label>/, "found now, by its new name");
    assert.match(again, /Named by the house[\s\S]*Ultra, code ending a48c · <b>playing now<\/b>/, "offered for renaming");
    // Renamed: the old name lets go.
    await go(e, "/setup/name", { method: "POST", form: { id: hex, name: "Ultra Den" }, cookie: me });
    assert.equal(await recallDevice(e, "ultra"), null);
    assert.equal(await recallDevice(e, "ultra den"), hex);
    assert.equal((await go(e, "/setup/name", { method: "POST", form: { id: hex, name: "" }, cookie: me })).status, 400);
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("finding speakers asks which are WiiMs, first guessed from Spotify's AVR, and keeps the answer", async () => {
  // The owner, 2026-10-17: "my house only sees the 2 WiiM devices and
  // whatever the current active non-WiiM device is".
  const { installFetch } = await import("./harness.js");
  const f = installFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).includes("/me/player/devices")
    ? Response.json({ devices: [{ id: "wiim-1", name: "Pro Plus", type: "AVR" }, { id: "wiim-2", name: "Ultra", type: "AVR" },
      { id: "echo-1", name: "Dining Room", type: "Speaker" }] })
    : inner(u, init);
  try {
    const e = await house();
    delete e.ROOM_DEVICES;
    const me = await owner(e);
    const page = await (await go(e, "/setup/speaker?find=1", { cookie: me })).text();
    assert.match(page, /<legend>Which are WiiM devices\?<\/legend>/);
    assert.match(page, /name="wiim" value="Pro Plus" checked> Pro Plus/);
    assert.match(page, /name="wiim" value="Ultra" checked> Ultra/);
    assert.match(page, /name="wiim" value="Dining Room"> Dining Room/, "an Echo is not guessed a WiiM");
    const body = new URLSearchParams([["room", "Pro Plus"], ["room", "Ultra"], ["room", "Dining Room"], ["wiim", "Pro Plus"], ["wiim", "Kitchen"]]);
    const r = await worker.fetch(new Request(`${ORIGIN}/setup/rooms`, { method: "POST", headers: { origin: ORIGIN, cookie: me }, body }), e, null);
    assert.equal(r.status, 303);
    const { withSettings } = await import("../settings.js");
    const live = await withSettings(e, null);
    assert.equal(live.WIIM_NAMES, JSON.stringify(["Pro Plus"]), "the answer, and only speakers kept");
    const again = await (await go(e, "/setup/speaker?find=1", { cookie: me })).text();
    assert.match(again, /name="wiim" value="Ultra"> Ultra/, "the answer given beats the guess");
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("a nameless speaker can be played on, to hear which one it is (the owner's second run, 2026-10-17)", async () => {
  const { installFetch } = await import("./harness.js");
  const hex = "5cf5000000000000000000000000000000a48c";
  const f = installFetch();
  const inner = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, init) => {
    const path = new URL(String(u)).pathname;
    if (path === "/v1/me/player/devices") return Response.json({ devices: [{ id: hex, name: hex, type: "AVR" }, { id: "wiim-2", name: "Ultra", type: "AVR" }] });
    if (path === "/v1/me/player" && init?.method === "PUT") { sent.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    return inner(u, init);
  };
  try {
    const e = await house();
    const me = await owner(e);
    const page = await (await go(e, "/setup/speaker?find=1", { cookie: me })).text();
    assert.match(page, new RegExp(`action="/setup/identify">\\s*<input type="hidden" name="id" value="${hex}">\\s*<button[^>]*>Play on it \\(code ending a48c\\)`));
    const r = await go(e, "/setup/identify", { method: "POST", form: { id: hex }, cookie: me });
    assert.equal(r.headers.get("location"), "/setup/speaker?find=1&tried=a48c&ok=1#unnamed");
    assert.deepEqual(sent.at(-1), { device_ids: [hex], play: true });
    const back = await (await go(e, r.headers.get("location"), { cookie: me })).text();
    assert.match(back, /<p class="setsaid" role="status">Playing on the speaker with the code ending a48c: listen for which one it is/);
  } finally { globalThis.fetch = inner; f.restore(); }
});
