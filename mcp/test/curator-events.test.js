// THE CURATOR'S EVENTS (MC-31 stage 6b, step 2; 2026-10-19): a ChatGPT
// curator subscribes to `house.work` on the curator's door, and the house
// sends it a signed web call wherever it rings its curator. The protocol is
// OpenAI's reading of the draft MCP Events extension, measured on a
// throwaway server first (tasks/mcp-events-test/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import worker from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";
import { emitRequestEvent } from "../writes.js";
import { SUBS_KEY, SUBS_MAX } from "../curator-events.js";

const OWNER = "owner-secret-owner-secret-owner-1";
const AGENT = "agent-secret-agent-secret-agent-1";
const SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const CALLBACK = "https://connectors.example.test/mcp-events/cb_1";
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "openai-mcp (Codex)" } };

function house() {
  const e = makeEnv();
  e.MCP_SECRET = OWNER;
  e.AGENT_SECRET = AGENT;
  return e;
}
async function call(e, secret, method, params = {}) {
  const r = await worker.fetch(new Request(`https://x.test/mcp/${secret}`, {
    method: "POST", headers: { "content-type": "application/json", "mcp-method": method, "mcp-protocol-version": "2026-07-28" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method, params: { ...params, _meta: META } }),
  }), e);
  return (await r.json());
}
const subscribe = (e, over = {}) => call(e, AGENT, "events/subscribe",
  { name: "house.work", arguments: {}, delivery: { mode: "webhook", url: CALLBACK, secret: SECRET, ...over }, cursor: null });

// ChatGPT's receiver: checks every signature as Standard Webhooks defines it,
// echoes a challenge, and answers events with `status`.
function receiver({ status = 200, echo = true } = {}) {
  const got = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (!String(u).startsWith("https://connectors.example.test/")) return inner(u, init);
    const id = init.headers["webhook-id"], ts = init.headers["webhook-timestamp"];
    const want = `v1,${createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${id}.${ts}.${init.body}`).digest("base64")}`;
    const body = JSON.parse(init.body);
    got.push({ url: String(u), id, signed: init.headers["webhook-signature"] === want, sub: init.headers["x-mcp-subscription-id"], body, redirect: init.redirect });
    if (body.type === "verification") return Response.json(echo ? { challenge: body.challenge } : { challenge: "nope" });
    return new Response(null, { status });
  };
  return { got, restore: () => { globalThis.fetch = inner; } };
}

test("the curator's door offers house.work; the owner's door has no events", async () => {
  const e = house();
  assert.deepEqual((await call(e, AGENT, "server/discover")).result.capabilities.events, {});
  assert.equal((await call(e, OWNER, "server/discover")).result.capabilities.events, undefined);
  const list = await call(e, AGENT, "events/list");
  assert.equal(list.result.events[0].name, "house.work");
  assert.deepEqual(list.result.events[0].delivery, ["webhook"]);
  assert.equal((await call(e, OWNER, "events/list")).error.code, -32601, "not on the owner's door");
});

test("subscribing: the callback proves itself first, the same subscription is one, and nothing secret is listed", async () => {
  const e = house();
  const rx = receiver();
  try {
    const a = await subscribe(e);
    assert.match(a.result.id, /^sub_[0-9a-f]{24}$/);
    assert.ok(Date.parse(a.result.refreshBefore) > Date.now() + 6 * 24 * 3600e3, "about a week");
    assert.equal(a.result.cursor, null);
    assert.equal(rx.got.length, 1);
    assert.equal(rx.got[0].body.type, "verification");
    assert.ok(rx.got[0].signed, "signed the Standard Webhooks way");
    assert.equal(rx.got[0].redirect, "manual", "a redirect is never followed");
    const b = await subscribe(e);
    assert.equal(b.result.id, a.result.id, "the same subscription");
    assert.equal(rx.got.length, 1, "a proved callback is not challenged again");
    assert.equal(JSON.parse(await e.PROGRAMS.get(SUBS_KEY)).length, 1);
    const f = installFetch();
    try {
      const listed = await call(e, OWNER, "tools/call", { name: "list_requests", arguments: {} });
      const text = listed.result.content[0].text;
      assert.equal(JSON.parse(text).event_subscriptions.count, 1);
      assert.ok(!text.includes(SECRET) && !text.includes("connectors.example.test"), "never the secret or the callback");
    } finally { f.restore(); }
  } finally { rx.restore(); }
});

test("the newest few subscriptions only: a flood of callbacks keeps SUBS_MAX, the oldest dropped (the locks review, 2026-10-25)", async () => {
  const e = house();
  const rx = receiver();
  try {
    for (let i = 1; i <= 6; i++) assert.ok((await subscribe(e, { url: `https://connectors.example.test/mcp-events/cb_${i}` })).result.id, `cb_${i}`);
    const kept = JSON.parse(await e.PROGRAMS.get(SUBS_KEY)).map((x) => x.url.split("/").pop());
    assert.equal(SUBS_MAX, 2);
    assert.deepEqual(kept, ["cb_5", "cb_6"]);
    // The real chat's refresh puts it back last, and it stays.
    await subscribe(e, { url: "https://connectors.example.test/mcp-events/cb_5" });
    assert.deepEqual(JSON.parse(await e.PROGRAMS.get(SUBS_KEY)).map((x) => x.url.split("/").pop()), ["cb_6", "cb_5"]);
  } finally { rx.restore(); }
});

test("a subscription is refused for a bad secret, a plain-http callback, arguments, or a challenge not answered", async () => {
  const e = house();
  assert.equal((await subscribe(e, { secret: "whsec_c2hvcnQ=" })).error.code, -32602);
  assert.equal((await subscribe(e, { url: "http://connectors.example.test/cb" })).error.code, -32602);
  assert.equal((await call(e, AGENT, "events/subscribe", { name: "house.work", arguments: { dj: "hank" },
    delivery: { mode: "webhook", url: CALLBACK, secret: SECRET } })).error.code, -32602);
  assert.equal((await call(e, AGENT, "events/subscribe", { name: "comment.created", arguments: {},
    delivery: { mode: "webhook", url: CALLBACK, secret: SECRET } })).error.code, -32602);
  const rx = receiver({ echo: false });
  try {
    const r = await subscribe(e);
    assert.equal(r.error.code, -32015);
    assert.equal(r.error.data.reason, "challenge_failed");
    assert.equal(await e.PROGRAMS.get(SUBS_KEY), null, "nothing kept");
  } finally { rx.restore(); }
});

test("work for the curator: a signed house.work with the id only, and heard counts as rung", async () => {
  const e = house();
  const rx = receiver();
  try {
    await subscribe(e);
    assert.equal(await emitRequestEvent(e, "3f2a9c1e-0000-4000-8000-000000000001"), true, "heard, with no routine or GitHub");
    assert.equal(await emitRequestEvent(e, "endless-7-1792428631096", ".2"), true);
    const events = rx.got.filter((g) => !g.body.type);
    assert.equal(events.length, 2);
    for (const ev of events) {
      assert.ok(ev.signed);
      assert.equal(ev.body.name, "house.work");
      assert.equal(ev.id, ev.body.eventId, "webhook-id is the event's id");
      assert.equal(ev.body.cursor, null);
      assert.ok(Date.parse(ev.body.timestamp));
    }
    assert.deepEqual(events[0].body.data, { work_id: "3f2a9c1e-0000-4000-8000-000000000001", kind: "request", again: false });
    assert.deepEqual(events[1].body.data, { work_id: "endless-7-1792428631096", kind: "endless", again: true });
  } finally { rx.restore(); }
});

test("unsubscribed, or answered 410, nothing more is sent; with no subscription the house rings as before", async () => {
  const e = house();
  let rx = receiver();
  try {
    await subscribe(e);
    const un = await call(e, AGENT, "events/unsubscribe", { name: "house.work", arguments: {}, delivery: { mode: "webhook", url: CALLBACK } });
    assert.deepEqual({ ...un.result, _meta: undefined }, { resultType: "complete", _meta: undefined });
    assert.equal(await emitRequestEvent(e, "req-1"), false, "no curator to hear it, no routine, no repo");
    assert.equal(rx.got.filter((g) => !g.body.type).length, 0);
  } finally { rx.restore(); }
  rx = receiver({ status: 410 });
  try {
    await subscribe(e);
    assert.equal(await emitRequestEvent(e, "req-2"), false);
    assert.deepEqual(JSON.parse(await e.PROGRAMS.get(SUBS_KEY)), [], "a 410 drops the subscription");
  } finally { rx.restore(); }
});

// ONE CURATOR (MC-31 6b, step 5): the house rings the curator it was given,
// ChatGPT's events or Claude's routine, never both.
test("one curator: a Claude house rings its routine and never the events; a ChatGPT house the events and never the routine", async () => {
  const e = house();
  e.REQUEST_ROUTINE_ID = "trig_01ABCDEFGHIJKL";
  e.REQUEST_ROUTINE_TOKEN = "sk-ant-oat01-" + "a".repeat(40);
  const rx = receiver();
  const fired = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith("https://api.anthropic.com/")) { fired.push(String(u)); return Response.json({ type: "routine_fire" }); }
    return inner(u, init);
  };
  try {
    await subscribe(e);
    const events = () => rx.got.filter((g) => !g.body.type).length;
    // No choice made, but a routine: Claude's house.
    assert.equal(await emitRequestEvent(e, "req-claude"), true);
    assert.deepEqual([fired.length, events()], [1, 0], "the routine only");
    e.CURATOR = "chatgpt";
    assert.equal(await emitRequestEvent(e, "req-chatgpt"), true);
    assert.deepEqual([fired.length, events()], [1, 1], "the event only");
    e.CURATOR = "claude";
    assert.equal(await emitRequestEvent(e, "req-claude-2"), true);
    assert.deepEqual([fired.length, events()], [2, 1]);
    // ChatGPT chosen and nobody listening: not rung (the hourly check finds it), and no routine either.
    e.CURATOR = "chatgpt";
    await call(e, AGENT, "events/unsubscribe", { name: "house.work", arguments: {}, delivery: { mode: "webhook", url: CALLBACK } });
    assert.equal(await emitRequestEvent(e, "req-nobody"), false);
    assert.equal(fired.length, 2);
  } finally { globalThis.fetch = inner; rx.restore(); }
});
