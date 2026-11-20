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
