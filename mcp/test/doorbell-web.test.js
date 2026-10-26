// THE DOORBELL BY WEB CALL (MC-31 stage 2, 2026-10-16). The house rings its
// curator routine's API trigger itself (writes.js, fireRoutine); the GitHub
// commit kept as the fallback went on 2026-10-23.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emitRequestEvent, ROUTINE_BETA } from "../writes.js";
import { viewOf } from "../install/config.js";
import { makeEnv } from "./harness.js";

function house({ routine = true } = {}) {
  const e = makeEnv();
  if (routine) { e.REQUEST_ROUTINE_ID = "trig_test"; e.REQUEST_ROUTINE_TOKEN = "routine-token"; }
  // A house that once had the GitHub doorbell: its old names ring nothing now.
  e.REQUEST_EVENT_REPO = "owner/requests"; e.GITHUB_TOKEN = "gh-token";
  return e;
}
function wire(answer) {
  const inner = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    calls.push({ host: url.hostname, path: url.pathname, init });
    return answer(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = inner; } };
}

test("a ring calls the routine's trigger with only the id", async () => {
  const w = wire(() => Response.json({ type: "routine_fire" }));
  try {
    assert.equal(await emitRequestEvent(house(), "req-123"), true);
    assert.equal(w.calls.length, 1);
    const [c] = w.calls;
    assert.equal(c.host, "api.anthropic.com");
    assert.equal(c.path, "/v1/claude_code/routines/trig_test/fire");
    assert.equal(c.init.method, "POST");
    assert.equal(c.init.headers.authorization, "Bearer routine-token");
    assert.equal(c.init.headers["anthropic-beta"], ROUTINE_BETA);
    assert.deepEqual(JSON.parse(c.init.body), { text: "request req-123" }, "the id is all that travels");

    w.calls.length = 0;
    await emitRequestEvent(house(), "req-123", ".w1");
    assert.deepEqual(JSON.parse(w.calls[0].init.body), { text: "request req-123 (again)" });
  } finally { w.restore(); }
});

test("a refused or unreachable trigger, or no routine, answers false and calls nothing else: the hourly check finds it", async () => {
  let w = wire(() => new Response("no", { status: 429 }));
  try {
    assert.equal(await emitRequestEvent(house(), "req-9"), false);
    assert.deepEqual(w.calls.map((c) => c.host), ["api.anthropic.com"], "no GitHub, whatever the old names say");
  } finally { w.restore(); }

  w = wire(() => { throw new Error("down"); });
  try {
    assert.equal(await emitRequestEvent(house(), "req-9"), false);
  } finally { w.restore(); }

  w = wire(() => Response.json({ content: {} }, { status: 201 }));
  try {
    assert.equal(await emitRequestEvent(house({ routine: false }), "req-9"), false);
    assert.equal(w.calls.length, 0);
  } finally { w.restore(); }
});

test("the config names the routine only when requests are on and one is given", () => {
  const base = { worker: { name: "w", compatibilityDate: "2025-06-01" }, site: { baseUrl: "https://x.test" },
    kv: { TOKENS: "t", PROGRAMS: "p" }, buttons: [] };
  assert.equal(viewOf({ ...base, requests: { enabled: true, routine: "trig_x" } }).when.requestRoutine, true);
  assert.equal(viewOf({ ...base, requests: { enabled: true, routine: "trig_x" } }).values["requests.routine"], "trig_x");
  assert.equal(viewOf({ ...base, requests: { enabled: false, routine: "trig_x" } }).when.requestRoutine, false);
  assert.equal(viewOf({ ...base, requests: { enabled: true } }).when.requestRoutine, false);
});
