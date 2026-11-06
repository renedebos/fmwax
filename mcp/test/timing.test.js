// THE STOPWATCH (MC-37 step 1, the owner, 2026-11-02: "go"): the owner's pages
// and their poll answer with a Server-Timing header, the route's phases in
// order and the waits on the ledger, the store and Spotify summed, so the
// slow Loaded page can be measured live before anything is rewritten.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { stopwatch, timed, withTimings } from "../timing.js";
import { makeEnv, installFetch, track, buttons } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const get = (path) => new Request(`https://x.test${path}`);

function env() {
  const e = makeEnv();
  e.BUTTONS = buttons({ 1: P(1), 2: P(2), 3: P(3), 4: P(4), 5: P(5), 6: true, 7: P(7), 8: P(8) });
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57" });
  return e;
}
// "name;dur=12" and "ledger;dur=40;desc=\"3 calls\"" to { name: { dur, desc } }.
const parse = (h) => Object.fromEntries(String(h ?? "").split(/,\s*/).filter(Boolean).map((part) => {
  const [name, ...fields] = part.split(";");
  const f = Object.fromEntries(fields.map((x) => x.split("=")));
  return [name, { dur: Number(f.dur), desc: f.desc?.replace(/"/g, "") ?? null }];
}));

test("the stopwatch says each phase since the last, then each kind of wait summed with its count", () => {
  let t = 1000;
  const w = stopwatch(() => t);
  t += 12; w.lap("settings");
  t += 30; w.lap("tiles");
  w.add("ledger", 20); w.add("ledger", 25); w.add("store", 7);
  t += 5;
  assert.equal(w.header(), 'settings;dur=12, tiles;dur=30, ledger;dur=45;desc="2 calls", store;dur=7;desc="1 call", total;dur=47');
});

test("a timed wait answers and throws exactly as it would have, and is counted either way", async () => {
  const w = stopwatch();
  const e = { __watch: w };
  assert.equal(await timed(e, "store", Promise.resolve("v")), "v");
  await assert.rejects(timed(e, "store", Promise.reject(new Error("no"))), /no/);
  assert.equal(parse(w.header()).store.desc, "2 calls");
  const p = Promise.resolve(1);
  assert.equal(timed({}, "store", p), p, "no stopwatch, the promise as it came");
  assert.equal(timed(e, "store", "not a promise"), "not a promise");
});

test("only the owner's pages carry it, and a response that cannot change goes out as it came", () => {
  const w = stopwatch();
  const mk = () => new Response("x");
  assert.ok(withTimings(mk(), w, `/buttons/${KEY}`).headers.get("server-timing"));
  assert.ok(withTimings(mk(), w, `/notes/${KEY}`).headers.get("server-timing"));
  for (const path of ["/programs/one-aaaaaa", "/health", "/mcp/secret", "/"]) {
    assert.equal(withTimings(mk(), w, path).headers.get("server-timing"), null, path);
  }
  const frozen = { status: 200, headers: { append() { throw new TypeError("immutable"); } } };
  assert.equal(withTimings(frozen, w, `/buttons/${KEY}`), frozen);
  const upgrade = { status: 101, headers: { append() { throw new Error("must not be touched"); } } };
  assert.equal(withTimings(upgrade, w, `/buttons/${KEY}`), upgrade);
});

test("the Loaded page names its phases in order, and its waits on the ledger, the store and Spotify", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(res.status, 200);
    const h = res.headers.get("server-timing");
    const names = Object.keys(parse(h));
    const phases = ["settings", "throttle", "tiles", "shelf", "owed", "asks", "readings", "bar", "pick", "guest-dj", "house-djs",
      "curator", "helper-key", "lan-band"];
    const at = phases.map((n) => names.indexOf(n));
    assert.ok(at.every((i) => i >= 0), `every phase is there: ${h}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, "in the order the page asks");
    assert.ok(names.includes("player") || names.includes("player-pending"), "the player's wait, or that the page went without it");
    assert.ok(names.includes("store"), "the store's waits are summed");
    assert.equal(names.at(-1), "total");
    assert.ok(parse(h).total.dur >= 0);
    void f;
  } finally { f.restore?.(); }
});

test("the poll names its phases, and a public page and the health check carry none", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}/playing`), e);
    assert.equal(res.status, 200);
    const names = Object.keys(parse(res.headers.get("server-timing")));
    for (const n of ["settings", "guests", "throttle", "helper", "player", "answer", "total"]) assert.ok(names.includes(n), n);
    assert.ok(!names.includes("asks"), "asks only when the page asks for them");
    const asked = Object.keys(parse((await worker.fetch(get(`/buttons/${KEY}/playing?asks=1`), e)).headers.get("server-timing")));
    assert.ok(asked.includes("asks"));
    assert.equal((await worker.fetch(get("/health"), e)).headers.get("server-timing"), null);
  } finally { f.restore?.(); }
});

// STEP A (2026-11-02): the stopwatch found the slow first open is the store's,
// 26 keys read one call each on a cold copy. The per-preset keys go in one read.
import { kvMany, kvJson, countedKV, KV_MANY_MAX } from "../services.js";

// A store that answers many keys at once, as Cloudflare's does, counting its calls.
function bulkStore(values = {}) {
  const calls = [];
  return {
    calls,
    async get(key) {
      calls.push(key);
      if (Array.isArray(key)) return new Map(key.map((k) => [k, values[k] ?? null]));
      return values[key] ?? null;
    },
  };
}

test("many keys come back from one read, missing ones as null, and in reads of a hundred", async () => {
  const kv = bulkStore({ a: "1", b: '{"n":2}' });
  const got = await kvMany(kv, ["a", "b", "c", "a", null]);
  assert.equal(kv.calls.length, 1, "one call");
  assert.deepEqual([...got], [["a", "1"], ["b", '{"n":2}'], ["c", null]], "each key once, a missing one null");
  assert.deepEqual(kvJson(got.get("b")), { n: 2 });
  assert.equal(kvJson(got.get("c")), null);
  assert.equal(kvJson("{not json"), null, "a broken value reads as nothing, as type json's catch did");
  const many = bulkStore();
  await kvMany(many, Array.from({ length: KV_MANY_MAX * 2 + 5 }, (_, i) => `k${i}`));
  assert.deepEqual(many.calls.map((c) => c.length), [100, 100, 5]);
  assert.equal((await kvMany(bulkStore(), [])).size, 0);
});

test("a store that reads one key at a time is asked key by key, and one that fails gives nulls", async () => {
  const calls = [];
  const single = { async get(k) { calls.push(k); return Array.isArray(k) ? null : `v:${k}`; } };
  const got = await kvMany(single, ["a", "b"]);
  assert.deepEqual([...got], [["a", "v:a"], ["b", "v:b"]]);
  assert.deepEqual(calls.slice(1), ["a", "b"], "after the many-key ask, one each");
  const broken = { get(k) { if (Array.isArray(k)) throw new TypeError("key must be a string"); return Promise.reject(new Error("down")); } };
  assert.deepEqual([...(await kvMany(broken, ["a"]))], [["a", null]]);
});

test("the counted store counts a read per key, once the store has answered with them", async () => {
  const e = { __kvTally: new Map() };
  await countedKV(e, bulkStore({ "current:x": "s" })).get(["current:x", "current:y", "mark:x"]);
  assert.deepEqual([...e.__kvTally], [["get|current", 2], ["get|mark", 1]]);
  const e2 = { __kvTally: new Map() };
  await countedKV(e2, { async get(k) { return Array.isArray(k) ? null : "v"; } }).get(["a", "b"]);
  assert.equal(e2.__kvTally.size, 0, "a store that did not answer many keys has read none yet");
});

test("the Loaded page asks for the per-preset keys in one read, and reads none of them again", async () => {
  const e = env();
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12,
    presets: [{ button: 5, dj: "hank", playlist: P(5), hours: 4, topupMinutes: 20, batchMinutes: 45 }] });
  const inner = e.PROGRAMS.get.bind(e.PROGRAMS);
  const asked = [];
  e.PROGRAMS.get = async (key, opts) => {
    asked.push(key);
    if (Array.isArray(key)) return new Map(await Promise.all(key.map(async (k) => [k, await inner(k)])));
    return inner(key, opts);
  };
  await e.PROGRAMS.put(`current:${P(4)}`, "a-programme");
  const f = installFetch({ contents: [track("t1")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(res.status, 200);
    const many = asked.filter(Array.isArray);
    assert.equal(many.length, 1, "one read for them all");
    assert.ok(many[0].includes(`current:${P(4)}`) && many[0].includes(`mark:${P(5)}`), many[0].join(" "));
    const again = asked.filter((k) => typeof k === "string" && many[0].includes(k));
    assert.deepEqual(again, [], "none of them read on its own");
  } finally { f.restore?.(); }
});

// STEP B (2026-11-02): the reads after the tiles waited for each other, about
// 250 ms in a row. They start beside the tiles and are shared: the endless
// state, the helper's view and the speakers' readings are read once each.
test("the Loaded page reads the endless state, the log and the speakers' readings once each", async () => {
  const e = env();
  e.HELPER_SECRET = "h";
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12,
    presets: [{ button: 5, dj: "hank", playlist: P(5), hours: 4, topupMinutes: 20, batchMinutes: 45 }] });
  const ops = [];
  const getStub = e.STATION.get.bind(e.STATION);
  e.STATION.get = (id) => { const stub = getStub(id);
    return { fetch: (u, init) => { ops.push(JSON.parse(init.body).op); return stub.fetch(u, init); } }; };
  const keys = [];
  const kvGet = e.PROGRAMS.get.bind(e.PROGRAMS);
  e.PROGRAMS.get = (k, o) => { if (typeof k === "string") keys.push(k); return kvGet(k, o); };
  const f = installFetch({ contents: [track("t1")] });
  try {
    const res = await worker.fetch(get(`/buttons/${KEY}`), e);
    assert.equal(res.status, 200);
    const n = (op) => ops.filter((o) => o === op).length;
    // The page's own three readers (the owed count, the guest DJ's band, the
    // house DJs) share one; the other is the curator's check for waiting work.
    assert.equal(n("endless-get"), 2, `the endless state, was four (ledger: ${ops.join(" ")})`);
    assert.equal(n("endless-list"), 1, "the log once");
    assert.ok(n("helper-get") <= 2, `the helper's view shared (${n("helper-get")} reads: the bar's and the player's own)`);
    const readings = keys.filter((k) => k.startsWith("reading:"));
    assert.deepEqual(readings, ["reading:pro-plus"], "each speaker's reading once");
    for (const lap of ["owed", "bar", "guest-dj", "house-djs", "curator", "helper-key", "lan-band"]) {
      assert.match(res.headers.get("server-timing"), new RegExp(`\\b${lap};dur=`), lap);
    }
  } finally { f.restore?.(); }
});

// STEP C (2026-11-02): the settings document was read on every request, 33 to
// 135 ms, the 30-second check included. The music pages and their check keep
// a copy for a few seconds; everything else reads the store, and a write drops it.
import { mock } from "node:test";
import { makeHouseStore } from "./harness.js";
import { SETTINGS_KEEP_MS, choosePageSetting, forgetKeptSettings, withSettings } from "../settings.js";

// The house's settings store, its document reads counted, and a gate a read can be held at.
async function countedHouse() {
  const store = await makeHouseStore();
  const reads = { n: 0, gate: null };
  const inner = store.binding.get;
  store.binding = { idFromName: store.binding.idFromName, get: () => {
    const stub = inner();
    return { fetch: async (u, init) => {
      const path = new URL(String(u)).pathname;
      const r = await stub.fetch(u, init);
      if (path === "/settings" && String(init?.method ?? "GET") === "GET") { reads.n += 1; if (reads.gate) await reads.gate; }
      return r;
    } };
  } };
  return { binding: store.binding, reads };
}

test("a music page's settings come from a copy a few seconds old; other requests read the store", async () => {
  const { binding, reads } = await countedHouse();
  const e = { ...makeEnv(), HOUSE: binding, DEFAULT_DEVICE: "Pro Plus" };
  // A new store copies the file's settings in on its first read, a write: then as in a house.
  await withSettings(e, null);
  reads.n = 0;
  await withSettings(e, null);
  assert.equal(reads.n, 1);
  await withSettings(e, null, { keepMs: SETTINGS_KEEP_MS });
  await withSettings(e, null, { keepMs: SETTINGS_KEEP_MS });
  assert.equal(reads.n, 1, "the kept copy, twice");
  await withSettings(e, null);
  assert.equal(reads.n, 2, "a request that keeps nothing reads the store");
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    mock.timers.tick(SETTINGS_KEEP_MS + 1);
    await withSettings(e, null, { keepMs: SETTINGS_KEEP_MS });
    assert.equal(reads.n, 3, "older than that, read again");
  } finally { mock.timers.reset(); }
});

test("a setting changed here shows at once on the next music page", async () => {
  const { binding, reads } = await countedHouse();
  const e = { ...makeEnv(), HOUSE: binding, DEFAULT_DEVICE: "Pro Plus" };
  await withSettings(e, null);
  reads.n = 0;
  const first = await withSettings(e, null, { keepMs: SETTINGS_KEEP_MS });
  assert.equal(first.DEFAULT_DEVICE, "Pro Plus");
  await choosePageSetting(first, "DEFAULT_DEVICE", "Ultra");
  const after = await withSettings(e, null, { keepMs: SETTINGS_KEEP_MS });
  assert.equal(after.DEFAULT_DEVICE, "Ultra");
  assert.equal(reads.n, 2, "the write dropped the copy");
});

test("a read that began before a write is not kept after it", async () => {
  const { binding, reads } = await countedHouse();
  const e = { ...makeEnv(), HOUSE: binding };
  await withSettings(e, null);
  reads.n = 0;
  let open;
  reads.gate = new Promise((r) => { open = r; });
  const slow = withSettings(e, null, { keepMs: SETTINGS_KEEP_MS });
  await new Promise((r) => setTimeout(r, 5));
  forgetKeptSettings(e);
  reads.gate = null;
  open();
  await slow;
  await withSettings(e, null, { keepMs: SETTINGS_KEEP_MS });
  assert.equal(reads.n, 2, "the answer from before the write was not kept");
});

test("through the worker: the poll and the pages keep it, the setup pages and the sign-in do not", async () => {
  const { binding, reads } = await countedHouse();
  const e = env();
  e.HOUSE = binding;
  await e.PROGRAMS.put("house:claimed", JSON.stringify({ at: Date.now() }));
  const f = installFetch({ contents: [track("t1")] });
  try {
    await (await worker.fetch(get("/setup"), e)).arrayBuffer();
    reads.n = 0;
    for (let i = 0; i < 3; i++) await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).arrayBuffer();
    await (await worker.fetch(get(`/buttons/${KEY}`), e)).arrayBuffer();
    assert.equal(reads.n, 1, "four music requests, one read");
    await (await worker.fetch(get(`/buttons/${KEY}/spotify`), e)).arrayBuffer();
    assert.equal(reads.n, 2, "the Spotify sign-in page reads the store");
    await (await worker.fetch(get("/setup"), e)).arrayBuffer();
    assert.equal(reads.n, 3, "so does setup");
  } finally { f.restore?.(); }
});

// STEP D (2026-11-02): every tab carried the same ~105 KB of CSS inline. The
// app's pages link one sheet named by its contents, which a phone keeps.
import { APP_CSS, APP_CSS_PATH } from "../programs.js";

test("the app's pages link the shared sheet and keep their own rules inline after it; a programme's page does not", async () => {
  const e = env();
  const f = installFetch({ contents: [track("t1")] });
  try {
    for (const path of [`/buttons/${KEY}`, `/buttons/${KEY}/djs`, `/buttons/${KEY}/wiim`, `/buttons/${KEY}/hank`, `/notes/${KEY}`]) {
      const res = await worker.fetch(get(path), e);
      const html = await res.text();
      assert.ok(html.includes(`<link rel="stylesheet" href="${APP_CSS_PATH}">`), path);
      assert.ok(!html.includes(".tabbar{position:fixed"), `${path}: the shared rules are not inline any more`);
      assert.match(res.headers.get("content-security-policy"), /style-src 'self' 'unsafe-inline'/, `${path} may load it`);
    }
    const dj = await (await worker.fetch(get(`/buttons/${KEY}/hank`), e)).text();
    const own = dj.indexOf("<style>", dj.indexOf(APP_CSS_PATH));
    assert.ok(own > 0 && dj.slice(own, dj.indexOf("</style>", own)).includes("/* TUNE on the DJ's page"), "the page's own rules come after the sheet");
    assert.ok(APP_CSS.includes(".tabbar{position:fixed"), "and the sheet carries the shared ones");
  } finally { f.restore?.(); }
});

test("the sheet is served to anyone, kept a year under its own name, and today's under an old one", async () => {
  const e = env();
  const cur = await worker.fetch(get(APP_CSS_PATH), e);
  assert.equal(cur.status, 200);
  assert.equal(cur.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(cur.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(await cur.text(), APP_CSS);
  assert.match(APP_CSS_PATH, /^\/app\.[0-9a-f]{8}\.css$/);
  const old = await worker.fetch(get("/app.00000000.css"), e);
  assert.equal(old.status, 200);
  assert.equal(old.headers.get("cache-control"), "no-cache", "an old page's ask gets today's rules, kept for no time");
  assert.equal((await worker.fetch(new Request(`https://x.test${APP_CSS_PATH}`, { method: "HEAD" }), e)).status, 200);
  assert.equal((await worker.fetch(new Request(`https://x.test${APP_CSS_PATH}`, { method: "POST" }), e)).status, 405);
  assert.equal((await worker.fetch(get("/app.css"), e)).status, 404);
});
