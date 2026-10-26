// THE CURATOR'S CHECK-IN (the owner, 2026-10-02): Change it up and Start
// fresh on Hank "did nothing" — the curator routine had not run for a day,
// and the DJ page still said "a few minutes". Every run's list_requests on
// the curator's key stamps the time; a page waiting on it says when it last
// checked in once that is over an hour ago.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { CURATOR_SEEN_KEY, CURATOR_QUIET_MS } from "../services.js";
import { makeEnv, installFetch, track } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const OWNER = "owner-secret-owner-secret-owner-1";
const AGENT = "agent-secret-agent-secret-agent-1";
const PL = "SAMPLEPLAYLIST00000013";
const MIN = 60_000;
const get = (e, path) => worker.fetch(new Request(`https://x.test${path}`), e);
const rpc = (secret, name) => new Request(`https://x.test/mcp/${secret}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) });

function house() {
  const e = makeEnv();
  e.HOUSE_TZ = "America/Los_Angeles";
  e.MCP_SECRET = OWNER;
  e.AGENT_SECRET = AGENT;
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
  // Dr. Funkenstein on 4, as in the house since Monk was cut (2026-10-15).
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 4, dj: "dr-funkenstein", playlist: PL, hours: 4 }] });
  e.AUTOFULFILL_ENABLED = "true";
  e.REQUEST_ROUTINE_ID = "trig_test";
  e.REQUEST_ROUTINE_TOKEN = "routine-token";
  return e;
}
// The routine's trigger answered, so a Start fresh can file its job.
function withDoorbell(f) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => String(u).startsWith("https://api.anthropic.com/")
    ? Response.json({ type: "routine_fire" }) : inner(u, init);
  return () => { globalThis.fetch = inner; f.restore(); };
}
const nowLine = (html) => html.match(/<p class="endnow">([^<]*)<\/p>/)?.[1] ?? "";

test("the curator's list_requests stamps its check-in; the owner's does not", async () => {
  const e = house();
  const f = installFetch();
  try {
    await worker.fetch(rpc(OWNER, "list_requests"), e);
    assert.equal(await e.PROGRAMS.get(CURATOR_SEEN_KEY), null, "the owner asking is not the curator");
    const before = Date.now();
    await worker.fetch(rpc(AGENT, "list_requests"), e);
    const seen = JSON.parse(await e.PROGRAMS.get(CURATOR_SEEN_KEY));
    assert.ok(seen.at >= before, "stamped when the curator asked");
  } finally { f.restore(); }
});

test("a fresh set being made: 'a few minutes' while the curator is checking in, its last check-in once it has gone quiet", async () => {
  const e = house();
  const restore = withDoorbell(installFetch({ contents: Array.from({ length: 6 }, (_, i) => track(`t${i}`)) }));
  try {
    assert.equal((await __test.endlessStartFresh(e, { button: 4, device: "Pro Plus" })).status, "asked");
    // Never stamped: nothing is said.
    let html = await (await get(e, `/buttons/${KEY}/dr-funkenstein`)).text();
    assert.equal(nowLine(html), "A fresh set is being made for the Pro Plus — a few minutes.");
    // Checked in ten minutes ago: still a few minutes.
    await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() - 10 * MIN }));
    html = await (await get(e, `/buttons/${KEY}/dr-funkenstein`)).text();
    assert.equal(nowLine(html), "A fresh set is being made for the Pro Plus — a few minutes.");
    // Quiet for longer than an hour and a quarter: the page says so.
    await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() - CURATOR_QUIET_MS - 5 * MIN }));
    html = await (await get(e, `/buttons/${KEY}/dr-funkenstein`)).text();
    assert.match(nowLine(html), /^A fresh set for the Pro Plus is asked for\. Nothing is making it yet: the curator, who makes the sets, last checked in (at|on \w{3} at) \d\d:\d\d\. If its Claude or ChatGPT plan has hit its limit, it carries on when the limit resets\.$/);
    assert.ok(!/a few minutes/.test(nowLine(html)));
  } finally { restore(); }
});
