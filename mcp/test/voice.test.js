// THE ROOM'S VOICE (MC-15, 2026-09-11): its list of tools — plays, reads and
// rewrites playlists, nothing else — and their shapes. The voice calls them
// through the Talk page's own door, /talk/tool (test/talk.test.js). Its door
// onto /mcp, VOICE_SECRET, was stage 0's and nothing used it after; it went
// on 2026-10-12. The plan is tasks/done/mc15-live-voice.md.
import { test } from "node:test";
import assert from "node:assert/strict";

import workerDefault, { __test } from "../worker.js";
import { makeEnv } from "./harness.js";

const OWNER = "owner-secret-owner-secret-owner-1";
const AGENT = "agent-secret-agent-secret-agent-1";
const VOICE = "voice-secret-voice-secret-voice-1";

function mcpEnv() {
  const e = makeEnv();
  e.MCP_SECRET = OWNER;
  e.AGENT_SECRET = AGENT;
  e.PROGRAM_BASE_URL = "https://example.test";
  return e;
}
const rpc = (path, body, headers = {}) =>
  new Request(`https://x.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const call = (name, args = {}) =>
  ({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });

// keep_set since 2026-09-28 (the owner: "keep it" in Talk).
// The archive's two since 2026-10-10 (the owner, asking Talk for a night of the archive),
// offered only in a house with an archive preset.
const VOICE_LIST = ["activate_program", "append_to_playlist", "get_dj", "keep_set", "list_devices", "list_programs",
  "now_playing", "play_archive", "play_endless", "play_playlist", "play_program", "playback_control", "read_playlist",
  "recently_played", "replace_playlist", "restore_playlist", "search_archive", "search_tracks", "steer_endless",
  "write_program"];

test("the voice's list is exactly the allowlist; the owner's and the agent's are untouched", async () => {
  const e = mcpEnv();
  assert.deepEqual([...__test.VOICE_TOOLS].sort(), VOICE_LIST,
    "plays, reads and rewrites playlists — widening this is a decision, not a drift");
  const agent = await (await workerDefault.fetch(rpc(`/mcp/${AGENT}`, toolsList), e)).json();
  assert.equal(agent.result.tools.length, 7, "the agent's world is as it was (and extend_endless since MC-22)");
  const owner = await (await workerDefault.fetch(rpc(`/mcp/${OWNER}`, toolsList), e)).json();
  assert.equal(owner.result.tools.length, __test.toolsWithMeta(e).length);
  // The stage-0 probe (probe_voice_door) was removed with stage D: nobody lists it.
  for (const list of [owner, agent]) assert.ok(!list.result.tools.some((t) => t.name === "probe_voice_door"));
});

test("/mcp has two doors, the owner's and the curator's: a voice key opens nothing", async () => {
  const e = { ...mcpEnv(), VOICE_SECRET: VOICE };
  for (const req of [rpc(`/mcp/${VOICE}`, toolsList), rpc("/mcp", toolsList, { authorization: `Bearer ${VOICE}` })]) {
    const res = await workerDefault.fetch(req, e);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "not found");
  }
  const wrong = await workerDefault.fetch(rpc("/mcp/not-a-secret", toolsList), e);
  assert.equal(wrong.status, 404);
  const bearer = await (await workerDefault.fetch(rpc("/mcp", toolsList, { authorization: `Bearer ${AGENT}` }), e)).json();
  assert.equal(bearer.result.tools.length, 7, "the curator's bearer form, as its routine sends it");
});

test("voiceFunctions is the voice's list in the Responses function shape", () => {
  const e = mcpEnv();
  const fns = __test.voiceFunctions(e);
  assert.deepEqual(fns.map((f) => f.name).sort(), VOICE_LIST.filter((n) => !/_archive$/.test(n)), "no archive in this house");
  for (const f of fns) {
    assert.equal(f.type, "function");
    assert.equal(typeof f.description, "string");
    assert.ok(f.description.length > 20, `${f.name} carries its description`);
    assert.equal(f.parameters.type, "object", `${f.name}'s schema is the connector's, renamed`);
    assert.ok(!("inputSchema" in f), "renamed, not duplicated");
  }
  // The connector's schema, except where the voice's rule needs a different
  // word (Codex, MC15S-7R2): `device` is the house's exact name, required on
  // the two starts; everything else is byte for byte the connector's.
  const tool = __test.toolsWithMeta(e).find((t) => t.name === "playback_control");
  const pc = fns.find((f) => f.name === "playback_control").parameters;
  assert.match(pc.properties.device.description, /exactly as the house names it/);
  assert.match(pc.properties.device.description, /never a partial name/);
  assert.deepEqual(pc.required, tool.inputSchema.required, "pause may still omit it");
  assert.deepEqual({ ...pc.properties, device: tool.inputSchema.properties.device }, tool.inputSchema.properties);
  for (const start of ["play_playlist", "play_program"]) {
    const p = fns.find((f) => f.name === start).parameters;
    assert.ok(p.required.includes("device"), `${start} requires a speaker`);
    assert.match(p.properties.device.description, /Required to start/);
  }
  // A write's schema is the connector's, untouched.
  const rp = fns.find((f) => f.name === "replace_playlist").parameters;
  assert.deepEqual(rp.properties, __test.toolsWithMeta(e).find((t) => t.name === "replace_playlist").inputSchema.properties);
});
