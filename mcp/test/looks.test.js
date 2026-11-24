// THE LOOKS, LIGHTER (2026-11-23, the owner: "make the tv check lighter
// first"): every look from the TV was cut off at the free plan's 10 ms CPU
// while the guest DJ played. A look is answered before routes.js's one large
// function (looks.js), and naming a playing endless set reads a thin view of
// the endless state (endlessPeekOf), not all of it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { endlessPeekOf } from "../endless.js";
import { endlessNamed } from "../house.js";
import { LOOK_PATH } from "../looks.js";
import { makeEnv } from "./harness.js";

const DOC = {
  lane: { dj: "pub-rock", tenancy: 78, words: "pub rock", nearby: { words: "pub rock", label: "Near", list: ["a"] } },
  assign: { 8: { dj: "dr-funkenstein" } }, queued: { 5: { dj: "soul" } },
  sessions: { 3: { tracks: [["spotify:track:a", 1000, "A — One"], ["spotify:track:b", 1000, "B — Two"]], program: null, log: ["x"] },
    1: { program: { dj: "hank", ref: "r" }, tracks: [["spotify:track:c", 1, "C"]] } },
  history: { hank: Array.from({ length: 150 }, (_, i) => [`spotify:track:${i}`, `Artist — Song ${i}`]) },
  log: Array.from({ length: 30 }, (_, i) => `line ${i}`),
};

test("the thin view: who is on each preset and in the lane, what is queued, each session's program, and whether a song is past its list", () => {
  const p = endlessPeekOf(DOC, { btn: 3, uri: "spotify:track:z" });
  assert.deepEqual(Object.keys(p).sort(), ["assign", "lane", "past", "queued", "sessions"]);
  assert.equal(p.lane.dj, "pub-rock"); assert.equal(p.assign["8"].dj, "dr-funkenstein"); assert.equal(p.queued["5"].dj, "soul");
  assert.deepEqual(p.sessions, { 3: {}, 1: { program: { dj: "hank", ref: "r" } } });
  assert.equal(p.past, true);
  assert.equal(endlessPeekOf(DOC, { btn: 3, uri: "spotify:track:a" }).past, false);
  assert.equal(endlessPeekOf(DOC, { btn: 9, uri: "spotify:track:a" }).past, false, "no list, nothing claimed");
  assert.ok(JSON.stringify(p).length < JSON.stringify(DOC).length / 5, "a fraction of the whole");
  assert.deepEqual(endlessPeekOf(null), { lane: null, assign: {}, queued: {}, sessions: {}, past: false });
});

test("naming a playing endless set asks the ledger for the thin view, never the whole state", async () => {
  const e = makeEnv();
  e.ENDLESS = JSON.stringify({ mode: "live", presets: [{ button: 3, lane: true, playlist: "LaneList0000000000000A" }, { button: 8, dj: "soul", playlist: "SoulList0000000000000B" }] });
  await e.STATION.get(e.STATION.idFromName("household")).fetch("https://station/", { method: "POST", body: JSON.stringify({ op: "endless-put", args: { doc: DOC } }) });
  const ops = [];
  const real = e.STATION.get.bind(e.STATION);
  e.STATION.get = (id) => { const s = real(id); return { fetch: (u, init) => { ops.push(JSON.parse(init.body).op); return s.fetch(u, init); } }; };
  const lane = await endlessNamed(e, { pid: "LaneList0000000000000A", uri: "spotify:track:z" }, null);
  assert.equal(lane.lane, true); assert.equal(lane.autoplay, true); assert.match(lane.name, /^Guest DJ · /);
  assert.deepEqual(lane.nearby, { label: "Near", list: ["a"] });
  const eight = await endlessNamed(e, { pid: "SoulList0000000000000B", uri: "spotify:track:q" }, null);
  assert.equal(eight.dj, "dr-funkenstein"); assert.equal(eight.endless, true);
  assert.deepEqual(ops, ["endless-peek", "endless-peek"]);
});

test("a look's address is answered before the large request function", () => {
  assert.ok(LOOK_PATH.test("/buttons/abcdefabcdefabcdefabcdef/tv/now"));
  assert.ok(LOOK_PATH.test("/buttons/abcdefabcdefabcdefabcdef/playing"));
  assert.ok(!LOOK_PATH.test("/buttons/abcdefabcdefabcdefabcdef/tv/nowx") && !LOOK_PATH.test("/buttons/x/playing"));
});
