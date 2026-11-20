// A STEER TAKES THE PLACE OF AN OPEN TOP-UP (the review, 2026-11-19). A
// top-up asked for before a steer is in the old direction. Left open beside
// the steer it spent a second run, and its songs could land after the
// steer's, so the DJ seemed to drop the steer after a few songs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch, track } from "./harness.js";
import { endlessPageSteer, endlessLoad } from "../endless.js";

const { endlessWatch, endlessJobs } = __test;
const PL = "SAMPLEPLAYLIST00000013", MIN = 60_000;

test("a steer drops a top-up no curator has taken, and gives its run back", async () => {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 4, dj: "vibe", playlist: PL, hours: 4, topupMinutes: 20, batchMinutes: 45 }] });
  e.AUTOFULFILL_ENABLED = "true"; e.REQUEST_ROUTINE_ID = "trig"; e.REQUEST_ROUTINE_TOKEN = "tok";
  const f = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch; const player = { uri: "spotify:track:t0" };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.anthropic.com") return Response.json({ type: "routine_fire" });
    if (url.pathname === "/v1/me/player/recently-played") return Response.json({ items: [] });
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return Response.json({ is_playing: true, device: { name: "Pro Plus", id: "d1" }, context: { uri: `spotify:playlist:${PL}` },
        progress_ms: 10_000, item: { uri: player.uri, name: "x", artists: [{ name: "Someone" }] } });
    }
    return inner(u, init);
  };
  try {
    // A look that finds the list near its end files a top-up. The steer must
    // fall on the same house day as that look, so the looks are "now".
    let t = Date.now() - 12 * MIN;
    await endlessWatch(e, t); player.uri = "spotify:track:t8"; t += 10 * MIN; await endlessWatch(e, t);
    const before = await endlessLoad(e);
    assert.deepEqual((await endlessJobs(e)).map((j) => j.kind), ["topup"], "the top-up is open");
    const runs = before.runs;

    const s = await endlessPageSteer(e, { button: 4, words: "Change it up", leaveWords: true });
    assert.equal(s.status, "asked");
    const after = await endlessLoad(e);
    assert.deepEqual((await endlessJobs(e)).map((j) => j.kind), ["steer"], "only the steer is left");
    assert.equal(after.sessions["4"].pending, false);
    // (Run in the minutes after the house's midnight, the top-up is yesterday's and the count began again.)
    if (after.day === before.day) assert.equal(after.runs, runs, "one run for the two: the top-up's was given back, the steer's taken");
  } finally { globalThis.fetch = inner; f.restore(); }
});

// STEERED AGAIN SINCE (the owner, 2026-11-19): play now filed a steer for
// the curator, Talk then steered with its own songs, and the curator's set
// landed a minute later over them.
test("a curator's steer older than the DJ's latest steer is closed without a write; a top-up too", async () => {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 4, dj: "vibe", playlist: PL, hours: 4, topupMinutes: 20, batchMinutes: 45 }] });
  e.AUTOFULFILL_ENABLED = "true"; e.REQUEST_ROUTINE_ID = "trig"; e.REQUEST_ROUTINE_TOKEN = "tok";
  const f = installFetch({ contents: Array.from({ length: 10 }, (_, i) => ({ ...track(`t${i}`), duration_ms: 5 * MIN })) });
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.anthropic.com") return Response.json({ type: "routine_fire" });
    if (url.pathname === "/v1/me/player/recently-played") return Response.json({ items: [] });
    if (url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return Response.json({ is_playing: true, device: { name: "Pro Plus", id: "d1" }, context: { uri: `spotify:playlist:${PL}` },
        progress_ms: 10_000, item: { uri: "spotify:track:t2", name: "x", artists: [{ name: "Someone" }] } });
    }
    return inner(u, init);
  };
  try {
    await endlessWatch(e, Date.now() - 2 * MIN);
    const asked = await endlessPageSteer(e, { button: 4, words: "the Ubiquity label", by: "by play now" });
    assert.equal(asked.status, "asked");
    const [job] = await endlessJobs(e);
    // Talk turns the DJ again a moment later, with songs of its own.
    const { endlessUpdate } = await import("../endless.js");
    await endlessUpdate(e, (st) => { st.sessions["4"].steer = { words: "Ubiquity, Talk's own", at: Date.now() + 1000 }; return {}; });
    const before = f.state.contents.map((x) => x.id).join(",");
    const out = await __test.callTool(e, "extend_endless", { job_id: job.job_id, uris: ["spotify:track:" + "u".repeat(22), "spotify:track:" + "v".repeat(22), "spotify:track:" + "w".repeat(22)] }, { remaining: 40 });
    assert.equal(out.status, "steered-since");
    assert.equal(f.state.contents.map((x) => x.id).join(","), before, "nothing written");
    assert.deepEqual(await endlessJobs(e), [], "the job is closed");
  } finally { globalThis.fetch = inner; f.restore(); }
});
