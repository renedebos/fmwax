// THE MODERN ERA ON THE HOUSE'S DOORS (MCP 2026-07-28; MC-31 stage 6b,
// 2026-10-19). ChatGPT's events need the stateless version, Claude's
// clients speak the legacy ones: a request that names 2026-07-28 gets a
// modern answer, everything else the answer it always got.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";
import { AGENT_TOOLS } from "../toollist.js";

const OWNER = "owner-secret-owner-secret-owner-1";
const AGENT = "agent-secret-agent-secret-agent-1";
const META = (v) => ({ "io.modelcontextprotocol/protocolVersion": v, "io.modelcontextprotocol/clientInfo": { name: "openai-mcp" } });

function house() {
  const e = makeEnv();
  e.MCP_SECRET = OWNER;
  e.AGENT_SECRET = AGENT;
  return e;
}
async function call(e, secret, method, { params = {}, version = null, header = null } = {}) {
  const r = await worker.fetch(new Request(`https://x.test/mcp/${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(header ? { "mcp-protocol-version": header } : {}),
      "mcp-method": method },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: version ? { ...params, _meta: META(version) } : params }),
  }), e);
  return { status: r.status, body: await r.json() };
}

test("server/discover says the door speaks both eras", async () => {
  const e = house();
  for (const secret of [OWNER, AGENT]) {
    const { status, body } = await call(e, secret, "server/discover", { version: "2026-07-28" });
    assert.equal(status, 200);
    assert.equal(body.result.resultType, "complete");
    assert.deepEqual(body.result.supportedVersions, ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"]);
    assert.deepEqual(body.result.capabilities.tools, { listChanged: false });
    assert.equal(body.result._meta["io.modelcontextprotocol/serverInfo"].name, "music-control");
  }
});

test("a modern tools/list and tools/call: resultType, the server's name, a cache hint, and the curator's own tools only", async () => {
  const e = house();
  const list = await call(e, AGENT, "tools/list", { version: "2026-07-28" });
  assert.equal(list.body.result.resultType, "complete");
  assert.equal(list.body.result.cacheScope, "private");
  assert.ok(list.body.result.ttlMs > 0);
  assert.deepEqual(new Set(list.body.result.tools.map((t) => t.name)), new Set([...AGENT_TOOLS].filter((n) => n !== "look_up_artist")));
  const f = installFetch();
  try {
    const got = await call(e, AGENT, "tools/call", { version: "2026-07-28", params: { name: "list_requests", arguments: {} } });
    assert.equal(got.body.result.resultType, "complete");
    assert.equal(got.body.result._meta["io.modelcontextprotocol/serverInfo"].name, "music-control");
    assert.ok(!got.body.result.isError, got.body.result.content?.[0]?.text);
    // The curator's door stays the curator's in the modern era too.
    const refused = await call(e, AGENT, "tools/call", { version: "2026-07-28", params: { name: "now_playing", arguments: {} } });
    assert.equal(refused.body.result.isError, true);
    assert.match(refused.body.result.content[0].text, /curates listener requests and nothing else/);
  } finally { f.restore(); }
});

test("the legacy era is untouched: initialize, and lists with no resultType", async () => {
  const e = house();
  const init = await call(e, OWNER, "initialize", { params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.equal(init.body.result.resultType, undefined);
  // A legacy client repeats the agreed version in the header: still legacy.
  const list = await call(e, OWNER, "tools/list", { header: "2025-06-18" });
  assert.equal(list.status, 200);
  assert.equal(list.body.result.resultType, undefined);
  assert.equal(list.body.result.ttlMs, undefined);
  assert.ok(list.body.result.tools.length > 20);
  // A header version the door has never heard of, from a legacy-shaped
  // request, is not a reason to refuse it.
  assert.equal((await call(e, OWNER, "tools/list", { header: "2025-11-25" })).status, 200);
});

test("a modern request in a version the door does not speak: 400 and the versions it does", async () => {
  const e = house();
  const { status, body } = await call(e, AGENT, "tools/list", { version: "2027-01-01" });
  assert.equal(status, 400);
  assert.equal(body.error.code, -32022);
  assert.deepEqual(body.error.data, { supported: ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"], requested: "2027-01-01" });
});
