// THE MCP PROTOCOL: JSON-RPC over POST, the versions this server speaks,
// and the dispatch into callTool.
// Split out of worker.js on 2026-09-26 (consolidation).
import { AGENT_TOOLS, toolsWithMeta } from "./toollist.js";
import { callTool } from "./tools.js";
import { EVENTS, subscribeWork, unsubscribeWork } from "./curator-events.js";
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "music-control", version: "0.1.0" };
// THE MODERN ERA (MCP 2026-07-28; MC-31 stage 6b, 2026-10-19). Stateless:
// no initialize, and every request names its version in `_meta` (and the
// MCP-Protocol-Version header). ChatGPT's events need it (the test server
// in tasks/mcp-events-test/ measured a Work chat answering a job in 17 s);
// Claude's clients speak the legacy versions above. So the door answers
// both: a request that names the modern version gets a modern result
// (`resultType`, the server's identity in `_meta`), every other request the
// legacy one, unchanged.
export const MODERN_VERSION = "2026-07-28";
const VERSION_META = "io.modelcontextprotocol/protocolVersion";
const SERVER_META = "io.modelcontextprotocol/serverInfo";
// Lists may be kept this long by a modern client (CacheableResult).
const LIST_TTL_MS = 5 * 60 * 1000;

// ------------------------------------------------------------------ MCP

export function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
export function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

// The version a request speaks: its `_meta` first, else the HTTP header (a
// legacy client sends the version initialize agreed there). `fromMeta` tells
// the two apart: only a modern-shaped request is refused for its version.
export function requestVersion(msg, headerVersion = null) {
  const meta = msg?.params?._meta?.[VERSION_META];
  if (typeof meta === "string") return { version: meta, fromMeta: true };
  return { version: headerVersion || null, fromMeta: false };
}

export async function handleRpc(env, msg, budget, role = "owner", { version = null, fromMeta = false } = {}) {
  const { id, method } = msg;
  const supported = [MODERN_VERSION, ...PROTOCOL_VERSIONS];
  // server/discover is answered in the modern way whoever asks: it is how a
  // client learns this door speaks both eras.
  if (method === "server/discover") {
    return rpcResult(id, {
      resultType: "complete",
      supportedVersions: supported,
      // Events on the curator's door only: the owner's door has no work to
      // wake anyone for (curator-events.js).
      capabilities: role === "agent" ? { tools: { listChanged: false }, events: {} } : { tools: { listChanged: false } },
      _meta: { [SERVER_META]: SERVER_INFO },
      ttlMs: LIST_TTL_MS,
      cacheScope: "private",
    });
  }
  if (fromMeta && !supported.includes(version)) {
    return rpcError(id, -32022, "Unsupported protocol version", { supported, requested: version });
  }
  if (role === "agent" && typeof method === "string" && method.startsWith("events/")) {
    const out = method === "events/list" ? { body: { events: EVENTS } }
      : method === "events/subscribe" ? await subscribeWork(env, msg.params)
      : method === "events/unsubscribe" ? await unsubscribeWork(env, msg.params)
      : { error: [-32601, `method not found: ${method}`] };
    if (out.error) return rpcError(id, ...out.error);
    return rpcResult(id, { resultType: "complete", ...out.body, _meta: { [SERVER_META]: SERVER_INFO } });
  }
  const reply = await legacyRpc(env, msg, budget, role);
  if (version !== MODERN_VERSION || !reply.result) return reply;
  const listed = method === "tools/list" ? { ttlMs: LIST_TTL_MS, cacheScope: "private" } : {};
  return rpcResult(id, { resultType: "complete", ...reply.result, ...listed,
    _meta: { ...(reply.result._meta ?? {}), [SERVER_META]: SERVER_INFO } });
}

async function legacyRpc(env, msg, budget, role) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      // The agent's list IS its world: tools outside the allowlist are not
      // shown smaller, they are not shown at all.
      return rpcResult(id, {
        tools: role === "agent"
          ? toolsWithMeta(env).filter((t) => AGENT_TOOLS.has(t.name))
          : toolsWithMeta(env),
      });
    case "tools/call": {
      const toolName = params?.name;
      // Refused BEFORE dispatch, so a disallowed call has no side effect to
      // reason about. A result rather than a protocol error: the model reads
      // the sentence and corrects course.
      if (role === "agent" && !AGENT_TOOLS.has(toolName)) {
        return rpcResult(id, {
          content: [{ type: "text", text:
            `error: this credential curates listener requests and nothing ` +
            `else — "${String(toolName).slice(0, 60)}" does not answer to ` +
            `it. Available: ${[...AGENT_TOOLS].join(", ")}.` }],
          isError: true,
        });
      }
      try {
        const out = await callTool(env, toolName, params?.arguments ?? {}, budget);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        });
      } catch (err) {
        // Tool failures are results, not protocol errors — the model should see
        // the message and be able to correct course.
        return rpcResult(id, {
          content: [{ type: "text", text: `error: ${err.message}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}
