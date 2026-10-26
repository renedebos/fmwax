// THE TALK PAGE AND ITS THREE DOORS (MC-15 stages B and C, 2026-09-12). A
// page's script posts an SDP offer to the session door and gets an answer
// and a per-session capability; every tool the voice's backend asks for is
// relayed through the tool door, under the checks mcp/voice.js states in
// their order; the closed door settles the minutes. The page carries the bar
// with Talk on, one script under the nonce, and no credential at all. The
// plan is ~/.claude/plans (MC-15); the design is tasks/done/mc15-live-voice.md.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { station } from "../station.js";
import { VOICE_PROMPT, CAP_MINUTES, backendPrompt, voicePrompt } from "../voice.js";
import { makeEnv, installFetch, track, buttons, PID } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";
import { spkWords } from "../programs.js";

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const SECRET = "sk-test-secret-never-shown";
function env({ voice = true } = {}) {
  const e = makeEnv();
  e.BUTTONS = buttons({ 1: P(1), 2: P(2), 3: P(3), 4: P(4) });
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Everywhere"]);
  e.TIDAL_COUNTRY = "NL";
  if (voice) e.OPENAI_API_KEY = SECRET;
  return e;
}
const OFFER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n";
const ANSWER = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\ns=answer\r\n";
const okOpenAI = (seen = []) => ({ path, method, headers, body }) => {
  seen.push({ path, method, headers, body });
  return new Response(JSON.stringify({ session: { id: "live_abc" }, transport: { type: "webrtc", sdp: ANSWER } }),
    { status: 201, headers: { "content-type": "application/json" } });
};
const req = (door, { method = "POST", origin = "https://x.test", type, body, cap } = {}) => {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (type) headers["content-type"] = type;
  if (cap) headers["x-talk-session"] = cap;
  return new Request(`https://x.test/buttons/${KEY}/talk${door ? `/${door}` : ""}`, { method, headers, body });
};
const sess = (over = {}) => req("session", { type: "application/sdp", body: OFFER, ...over });
const toolReq = (cap, body, over = {}) =>
  req("tool", { type: "application/json", body: typeof body === "string" ? body : JSON.stringify(body), cap, ...over });
const closedReq = (cap, _seconds, over = {}) =>
  req("closed", { type: "application/json", body: "{}", cap, ...over });
const beatReq = (cap, over = {}) => req("beat", { type: "application/json", body: "{}", cap, ...over });
const MIN = 60_000;
// A day already spent to `minutes`, as a settled row in the fake's ledger.
const spend = (e, minutes, over = {}) => e.STATION.sessions.set("9".repeat(32), {
  cap: "9".repeat(32), day: today(), created_at: Date.now() - 200 * MIN, last_beat: Date.now() - 200 * MIN + minutes * MIN, cap_sec: 3600,
  reserved_min: 0, settled_sec: Math.round(minutes * 60), settled_at: Date.now() - 200 * MIN + minutes * MIN, session_id: "live_old", closed_by: "server",
  close_tries: 0, retry_after: null, ...over });
const get = (path) => new Request(`https://x.test${path}`);
async function openSession(e) {
  const res = await worker.fetch(sess(), e);
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("MC-18 stage 3: the backend is told the live guests; a dark house's prompt is the one it always was", async () => {
  const seen = [];
  const f = installFetch({ openai: okOpenAI(seen) });
  const withGuest = (live) => {
    const e = env();
    e.BUTTONS = JSON.stringify([
      { button: 1, guest: true, live, name: "DJ Guest", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" },
      { button: 3, dj: "the-librarian", playlist: P(3) }]);
    return e;
  };
  try {
    await openSession(withGuest(false));
    await openSession(withGuest(true));
    const [dark, live] = seen.map((c) => c.body.session.delegation.responses.instructions);
    assert.equal(dark, backendPrompt({ devices: ["Pro Plus", "Everywhere"], defaultDevice: "Pro Plus", replay: "replay" }),
      "not a word changed while the guest is dark");
    assert.match(live, /"guest on spotify" \(preset 1\) for a Spotify set\./);
    assert.match(live, /still gets it on that preset, and a set on another service has nowhere to go/);
    assert.match(live, /the "replay" playlist — never over a guest or a DJ's preset/);
    assert.deepEqual(seen.map((c) => c.body.session.instructions), [VOICE_PROMPT, VOICE_PROMPT], "the voice's own prompt is untouched");
  } finally { f.restore(); }
});

test("the page and the doors are bare 404s on a wrong key and in a house without a voice", async () => {
  const f = installFetch({ openai: okOpenAI() });
  try {
    const e = env();
    for (const path of [`/buttons/${KEY}x/talk`, `/buttons/${KEY}x/talk/session`, `/buttons/${KEY}x/talk/tool`]) {
      const res = await worker.fetch(new Request(`https://x.test${path}`, { method: path.endsWith("talk") ? "GET" : "POST" }), e);
      assert.equal(res.status, 404, path);
      assert.equal(await res.text(), "not found");
    }
    const quiet = env({ voice: false });
    assert.equal((await worker.fetch(get(`/buttons/${KEY}/talk`), quiet)).status, 404);
    assert.equal((await worker.fetch(sess(), quiet)).status, 404, "the door is shut, not refused in words");
    assert.deepEqual(await __test.tabState(quiet), { owed: 0, talk: false, loaded: false });
    assert.deepEqual(await __test.tabState(e), { owed: 0, talk: true, loaded: false });
  } finally { f.restore(); }
});

test("the session door: method, then origin, then media type, then the offer itself — each refused in words", async () => {
  const seen = [];
  const f = installFetch({ openai: okOpenAI(seen) });
  try {
    const e = env();
    const refused = async (r, status, re) => {
      const res = await worker.fetch(r, e);
      const body = await res.json();
      assert.equal(res.status, status, JSON.stringify(body));
      assert.match(body.error, re);
      assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(res.headers.get("cache-control"), "no-store");
    };
    await refused(req("session", { method: "GET" }), 405, /only answers POST/);
    await refused(sess({ origin: null }), 403, /must come from the Talk page/);
    await refused(sess({ origin: "null" }), 403, /must come from the Talk page/);
    await refused(sess({ origin: "https://evil.test" }), 403, /came from https:\/\/evil\.test, not from https:\/\/x\.test/);
    await refused(sess({ type: "application/json" }), 403, /must be application\/sdp, not application\/json/);
    await refused(sess({ type: "text/plain" }), 403, /must be application\/sdp/);
    await refused(sess({ body: "hello" }), 400, /must be an SDP offer/);
    assert.equal(seen.length, 0, "OpenAI was never called");
    assert.equal((await station(e, "voice-day", { day: today() })).used_sec, 0, "nothing opened");
    // A parameter on the media type is not the media type.
    const res = await worker.fetch(sess({ type: "application/sdp; charset=utf-8" }), e);
    assert.equal(res.status, 201);
    assert.equal(seen.length, 1);
  } finally { f.restore(); }
});

test("a session: the offer goes to OpenAI inside the documented shape, and an answer and a capability come back with no secret", async () => {
  const seen = [];
  const f = installFetch({ openai: okOpenAI(seen) });
  try {
    const e = env();
    const res = await worker.fetch(sess(), e);
    const text = await res.text();
    assert.equal(res.status, 201, text);
    const out = JSON.parse(text);
    assert.equal(out.id, "live_abc");
    assert.equal(out.sdp, ANSWER);
    assert.match(out.cap, /^[0-9a-f]{32}$/);
    assert.equal(out.used, 1, "the opening's fifteen seconds, rounded up to the minute");
    assert.equal(out.cap_minutes, CAP_MINUTES);
    assert.equal(out.remaining, 59);
    assert.equal(out.used_sec, 15, "the day's seconds, for the page's meter");
    assert.ok(!("closes_in" in out), "no ten-minute window any more");
    assert.ok(!text.includes(SECRET), "the key stays in Cloudflare");
    assert.ok(!text.includes("gpt-"), "nothing about the models either");

    assert.equal(seen.length, 1);
    const call = seen[0];
    assert.equal(call.path, "/live/sessions");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(call.headers["content-type"], "application/json");
    const s = call.body.session;
    assert.equal(s.model, "gpt-live-1");
    assert.equal(s.instructions, VOICE_PROMPT);
    assert.equal(s.delegation.type, "responses");
    const r = s.delegation.responses;
    assert.equal(r.model, "gpt-5.6-terra");
    assert.match(r.instructions, /The house has: Pro Plus, Everywhere\./);
    assert.match(r.instructions, /Use "Pro Plus" unless the person named another/);
    assert.match(r.instructions, /the "replay" playlist/, "the house's replay alias, from config");
    assert.equal(r.tool_choice, "auto");
    const fns = r.tools.filter((t) => t.type === "function").map((t) => t.name).sort();
    // This house has no archive preset, so the archive's two are not offered.
    assert.deepEqual(fns, [...__test.VOICE_TOOLS].filter((n) => !/_archive$/.test(n)).sort(), "exactly the voice's tools");
    // The one writer (MC-17): the Librarian's shape (the Professor's until the owner cut
    // him, 2026-10-15) with the DJ's key first, every field's description cut to a
    // sentence, and none of the make_<dj>_program tools beside it. Three writers from
    // 2026-10-13, when the owner cut the Bootlegger, the Correspondent, the Engineer and
    // Baddie; two since 2026-10-15.
    const writer = r.tools.find((t) => t.name === "write_program");
    assert.deepEqual(writer.parameters.properties.dj.enum, ["the-librarian", "gatefold"]);
    assert.deepEqual(writer.parameters.required, ["dj", "title", "thesis", "sections", "complications"]);
    assert.ok(!r.tools.some((t) => /^make_.*_program$/.test(t.name)));
    assert.ok(JSON.stringify(r.tools).length < 20_000, `the whole tool payload: ${JSON.stringify(r.tools).length} bytes`);
    assert.deepEqual(r.tools.filter((t) => t.type !== "function"), [{ type: "web_search" }], "and web search, for discovery");
    assert.deepEqual(r.tools.map((t) => t.type === "function" ? t : null).filter(Boolean), __test.voiceFunctions(e));
    assert.deepEqual(call.body.transport, { type: "webrtc", sdp: OFFER });
    assert.deepEqual(Object.keys(call.body).sort(), ["session", "transport"]);

    // The line is on the ledger for today, in the house's own day, live and
    // charged by the clock; OpenAI's id is bound to the row so the ledger can
    // hang it up.
    assert.equal((await station(e, "voice-day", { day: today() })).used_sec, 15, "the opening floor");
    assert.equal((await station(e, "voice-check", { cap: out.cap })).live, true);
    assert.equal(e.STATION.sessions.get(out.cap).session_id, "live_abc");
    assert.equal(e.STATION.sessions.get(out.cap).cap_sec, 3600);

    // The backend model is one config line away.
    e.VOICE_BACKEND_MODEL = "gpt-5.6-luna";
    await worker.fetch(sess(), e);
    assert.equal(seen[1].body.session.delegation.responses.model, "gpt-5.6-luna");
  } finally { f.restore(); }
});

test("the day's cap: no line inside the last minute; a refusal costs nothing, an ambiguous failure keeps its row", async () => {
  let f = installFetch({ openai: okOpenAI() });
  try {
    const e = env();
    spend(e, 59.5);
    const res = await worker.fetch(sess(), e);
    const out = await res.json();
    assert.equal(res.status, 429);
    assert.match(out.error, /talked its 60 minutes today/);
    assert.deepEqual([out.used, out.cap_minutes], [60, 60]);
    // Fifty-eight: a line opens, with two minutes left.
    spend(e, 58);
    const ok = await (await worker.fetch(sess(), e)).json();
    assert.deepEqual([ok.used, ok.remaining], [59, 1], "fifty-eight and the opening's fifteen seconds");
  } finally { f.restore(); }

  f = installFetch({ openai: () => new Response(JSON.stringify({ error: { message: "model not available" } }), { status: 400 }) });
  try {
    const e = env();
    const res = await worker.fetch(sess(), e);
    const out = await res.json();
    assert.equal(res.status, 502);
    assert.match(out.error, /OpenAI refused the session: model not available/);
    assert.equal(e.STATION.sessions.size, 0, "a 4xx is unambiguous: the row is gone");
  } finally { f.restore(); }

  // Ambiguous failures — the connection lost, a 5xx, an answer with no SDP —
  // may have opened a session whose id never reached us: the ten stand.
  for (const [label, openai, re] of [
    ["connection lost", () => { throw new Error("connection reset"); }, /could not be reached\. Try again/],
    ["a 5xx", () => new Response("gateway timeout", { status: 504 }), /did not open the session \(status 504\)/],
    ["no SDP", () => new Response(JSON.stringify({ session: { id: "live_1" } }), { status: 201 }), /did not open the session \(status 201\)/],
    ["no id", () => new Response(JSON.stringify({ session: {}, transport: { type: "webrtc", sdp: ANSWER } }), { status: 201 }), /opened a session without an id; it was not used/],
  ]) {
    f = installFetch({ openai });
    try {
      const e = env();
      const res = await worker.fetch(sess(), e);
      const text = await res.text();
      assert.equal(res.status, 502, `${label}: ${text}`);
      assert.match(JSON.parse(text).error, re, label);
      assert.equal(e.STATION.sessions.size, 1, `${label}: the row stands`);
      const row = [...e.STATION.sessions.values()][0];
      assert.equal(row.session_id, null, `${label}: unbound, so the sweep expires it at its grace`);
      const swept = await station(e, "voice-sweep", { now: Date.now() + 11 * 60_000 });
      assert.deepEqual(swept.closed.map((c) => [c.by, c.seconds]), [["expired", 90]], `${label}: ninety seconds of grace, no more`);
      assert.ok(!text.includes(ANSWER) && !text.includes('"cap"'), `${label}: the answer is withheld`);
    } finally { f.restore(); }
  }

  // A ledger that cannot take the session: the answer is withheld too.
  f = installFetch({ openai: okOpenAI() });
  try {
    const e = env();
    const inner = e.STATION.get();
    e.STATION.get = () => ({ fetch: async (u, init) => {
      if (JSON.parse(init.body).op === "voice-bind") throw new Error("object reset");
      return inner.fetch(u, init);
    } });
    const res = await worker.fetch(sess(), e);
    const text = await res.text();
    assert.equal(res.status, 503, text);
    assert.match(JSON.parse(text).error, /ledger could not take the session/);
    assert.ok(!text.includes(ANSWER));
    assert.ok(!text.includes("cap"));
  } finally { f.restore(); }

  // A misspelt house zone is refused before a cent moves.
  f = installFetch({ openai: okOpenAI() });
  try {
    const e = env();
    e.HOUSE_TZ = "Europe/Amsterdamn";
    const res = await worker.fetch(sess(), e);
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /HOUSE_TZ is not a timezone/);
  } finally { f.restore(); }
});

test("the bridge's checks, in their order: origin, media type, capability shape, capability live, allowlist and parse, speaker", async () => {
  const f = installFetch({ contents: [track("t1")], openai: okOpenAI() });
  try {
    const e = env();
    const { cap } = await openSession(e);
    const refused = async (r, status, re, label) => {
      const res = await worker.fetch(r, e);
      const body = await res.json();
      assert.equal(res.status, status, `${label}: ${JSON.stringify(body)}`);
      assert.match(body.error, re, label);
    };
    // Everything wrong at once: the origin is what is said.
    await refused(toolReq(null, "{not json", { origin: null, type: "text/plain" }), 403, /must come from the Talk page/, "origin first");
    await refused(toolReq(cap, { name: "get_dj" }, { origin: "https://evil.test" }), 403, /came from https:\/\/evil\.test/, "foreign origin");
    // A form's media type is refused even with a live capability.
    await refused(toolReq(cap, { name: "get_dj" }, { type: "application/x-www-form-urlencoded" }), 403, /must be application\/json, not application\/x-www-form-urlencoded/, "media type");
    await refused(toolReq(null, { name: "get_dj" }), 401, /carries no session/, "no capability");
    await refused(toolReq("not-a-cap", { name: "get_dj" }), 401, /carries no session/, "malformed capability");
    await refused(toolReq("f".repeat(32), { name: "get_dj" }), 401, /session is over/, "unknown capability");
    // A dead capability with a bad body: the capability is what is said — the body was never read.
    await refused(toolReq("f".repeat(32), "{not json"), 401, /session is over/, "liveness before the parse");
    // A body past the ceiling is refused before it is parsed.
    const big = JSON.stringify({ name: "get_dj", arguments: "x".repeat(70 * 1024) });
    await refused(toolReq(cap, big), 413, /too large/, "oversized body");
    await refused(req("session", { type: "application/sdp", body: "v=0\r\n" + "a=x\r\n".repeat(20000) }), 413, /offer is too large/, "oversized offer");
    // Off the list, with unparseable arguments: the name is what is said.
    await refused(toolReq(cap, { name: "unpublish_program", arguments: "{not json" }), 400, /"unpublish_program" is not a tool the room's voice may call/, "allowlist");
    await refused(toolReq(cap, { name: "probe_voice_door" }), 400, /not a tool the room's voice may call/, "the owner's probe is not the voice's");
    await refused(toolReq(cap, "{not json"), 400, /must be JSON/, "body");
    await refused(toolReq(cap, { name: "play_playlist", arguments: "{not json" }), 400, /not valid JSON/, "arguments");
    await refused(toolReq(cap, { name: "play_playlist", arguments: '{"__proto__":{"x":1}}' }), 400, /not allowed/, "prototype key");
    // The speaker rule, last, on parsed arguments.
    await refused(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "scratch" }) }), 422, /Which speaker\? Name one to play on\./, "no speaker");
    await refused(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "scratch", device: "Kitchen" }) }), 422, /no speaker called "Kitchen"\. The house has: Pro Plus, Everywhere\./, "outside the house");
    await refused(toolReq(cap, { name: "playback_control", arguments: JSON.stringify({ action: "resume" }) }), 422, /Which speaker/, "resume needs one");
    await refused(toolReq(cap, { name: "playback_control", arguments: JSON.stringify({ action: "pause", device: "pro" }) }), 422, /no speaker called "pro"/, "a partial on pause");
    // Both speakers pass by name, in any case; the tool underneath answers.
    for (const device of ["Pro Plus", "everywhere"]) {
      const res = await worker.fetch(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "scratch", device }) }), e);
      const body = await res.json();
      assert.equal(res.status, 200, device);
      assert.ok(!/Which speaker|no speaker called/.test(body.error ?? ""), `${device} passes the rule`);
    }
    // Pause with no speaker is allowed through to the tool.
    const pause = await worker.fetch(toolReq(cap, { name: "playback_control", arguments: JSON.stringify({ action: "pause" }) }), e);
    assert.equal(pause.status, 200);
    // The one writer reaches the named DJ's own writer: the Librarian's refusal
    // is in the Librarian's words; a DJ who does not write is refused in words.
    const lib = await (await worker.fetch(toolReq(cap, { name: "write_program", arguments: JSON.stringify({ dj: "the-librarian", title: "x" }) }), e)).json();
    assert.match(lib.error, /for a survey it is the FENCE/, "dispatched to make_librarian_program");
    const gate = await (await worker.fetch(toolReq(cap, { name: "write_program", arguments: JSON.stringify({ dj: "Gatefold", title: "x" }) }), e)).json();
    assert.match(gate.error, /thesis is required — for sleeve notes/); assert.ok(!/FENCE/.test(gate.error), "and Gatefold's are his");
    const nobody = await (await worker.fetch(toolReq(cap, { name: "write_program", arguments: JSON.stringify({ dj: "vibe", title: "x" }) }), e)).json();
    assert.match(nobody.error, /"vibe" is not a DJ who writes programs\. The writers are: the-librarian/);
    // A writer the owner cut (2026-10-13) is refused the same way, not dispatched.
    const cut = await (await worker.fetch(toolReq(cap, { name: "write_program", arguments: JSON.stringify({ dj: "baddie", title: "x" }) }), e)).json();
    assert.match(cut.error, /"baddie" is not a DJ who writes programs\. The writers are: the-librarian, gatefold\./);
    // And the Professor, cut 2026-10-15.
    const prof = await (await worker.fetch(toolReq(cap, { name: "write_program", arguments: JSON.stringify({ dj: "the-professor", title: "x" }) }), e)).json();
    assert.match(prof.error, /"the-professor" is not a DJ who writes programs\. The writers are: the-librarian, gatefold\./);
    assert.equal((await (await worker.fetch(toolReq(cap, { name: "make_librarian_program", arguments: "{}" }), e)).json()).error !== undefined, true, "the writers' own names are off the voice's list");
    assert.match((await (await worker.fetch(toolReq(cap, { name: "make_librarian_program", arguments: "{}" }), e)).json()).error, /not a tool the room's voice may call/);
    // "preset 3" is button 3, the way the app and the remote say it.
    const preset = await (await worker.fetch(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "preset 3", device: "Pro Plus" }) }), e)).json();
    assert.ok(preset.output, preset.error);
    const button = await (await worker.fetch(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "Button 3", device: "Pro Plus" }) }), e)).json();
    assert.equal(JSON.parse(preset.output).playlist?.id ?? JSON.parse(preset.output).playlist, JSON.parse(button.output).playlist?.id ?? JSON.parse(button.output).playlist);
    const none = await (await worker.fetch(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "preset 99", device: "Pro Plus" }) }), e)).json();
    assert.match(none.error, /no playlist named "button 99"|preset|button/);
  } finally { f.restore(); }
});

test("a read round-trips as a string output; a write reaches the same code the connector reaches", async () => {
  const f = installFetch({ contents: [track("t1", "One", "A")], openai: okOpenAI() });
  try {
    const e = env();
    const { cap } = await openSession(e);
    const read = await worker.fetch(toolReq(cap, { name: "read_playlist", arguments: JSON.stringify({ playlist: "scratch" }) }), e);
    const got = await read.json();
    assert.equal(read.status, 200, JSON.stringify(got));
    assert.equal(typeof got.output, "string", "a string, as function_call_output wants");
    const parsed = JSON.parse(got.output);
    assert.ok(JSON.stringify(parsed).includes("spotify:track:t1"), got.output.slice(0, 300));

    // Arguments may also arrive as an object, for a client that parsed them.
    const write = await worker.fetch(toolReq(cap, { name: "replace_playlist", arguments: { playlist: "scratch", uris: ["spotify:track:t2", "spotify:track:t3"] } }), e);
    const wrote = await write.json();
    assert.equal(write.status, 200, JSON.stringify(wrote));
    assert.ok(wrote.output, wrote.error);
    assert.ok(f.calls.includes(`PUT /playlists/${PID}/items`), f.calls.join("\n"));
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:t2", "spotify:track:t3"]);

    // A tool's own refusal is an answer, not a bridge error: 200 with the sentence.
    const bad = await worker.fetch(toolReq(cap, { name: "read_playlist", arguments: JSON.stringify({ playlist: "no-such-playlist-anywhere" }) }), e);
    const said = await bad.json();
    assert.equal(bad.status, 200);
    assert.equal(typeof said.error, "string");
    assert.ok(!("output" in said));
  } finally { f.restore(); }
});

test("done stops the ledger's own clock, hangs up at OpenAI, and ends the capability; the page's number is never asked for", async () => {
  const f = installFetch({ openai: okOpenAI() });
  try {
    const e = env();
    const { cap } = await openSession(e);
    // Pretend the line opened two and a half minutes ago; the page's body is empty.
    e.STATION.sessions.get(cap).created_at -= 2.5 * MIN;
    e.STATION.sessions.get(cap).last_beat -= 2.5 * MIN;
    for (let i = 0; i < 4; i++) e.STATION.sessions.get(cap).last_beat += 30_000;
    const beat = await worker.fetch(beatReq(cap), e);
    assert.deepEqual(await beat.json(), { ok: true, used: 3, used_sec: 150, cap_minutes: 60, remaining: 57 });
    const res = await worker.fetch(closedReq(cap), e);
    const out = await res.json();
    assert.equal(out.ok, true);
    assert.equal(out.minutes, 3);
    assert.ok(out.seconds >= 150 && out.seconds <= 152, `the server's clock: ${out.seconds}`);
    assert.equal(out.closed_by, "expired", "the fake has no socket; the real object tells OpenAI");
    assert.deepEqual([out.used, out.cap_minutes, out.remaining], [3, 60, 57]);
    assert.equal(e.STATION.sessions.get(cap).settled_sec, out.seconds);
    // Over: the bridge refuses the capability now.
    const after = await worker.fetch(toolReq(cap, { name: "get_dj", arguments: "{}" }), e);
    assert.equal(after.status, 401);
    assert.match((await after.json()).error, /session is over/);
    // Settling twice is a no-op, not a second count.
    const again = await worker.fetch(closedReq(cap), e);
    assert.equal((await again.json()).minutes, 3);
    // A beat after done is refused: the line is over.
    const late = await worker.fetch(beatReq(cap), e);
    assert.equal(late.status, 401);
    // The beat door has the same checks as the rest.
    assert.equal((await worker.fetch(beatReq(cap, { origin: null }), e)).status, 403);
    assert.equal((await worker.fetch(beatReq(cap, { type: "text/plain" }), e)).status, 403);
    assert.equal((await worker.fetch(beatReq(null), e)).status, 401);
    assert.equal((await worker.fetch(beatReq("e".repeat(32)), e)).status, 404);
    // A line that stops beating is over at its grace, and the sweep hangs it
    // up and charges to there — whatever a page might have said.
    const { cap: quiet } = await openSession(e);
    e.STATION.sessions.get(quiet).created_at -= 5 * MIN;
    e.STATION.sessions.get(quiet).last_beat -= 5 * MIN;
    const dead = await worker.fetch(beatReq(quiet), e);
    assert.equal(dead.status, 401, "five minutes without a beat: over");
    const swept = await station(e, "voice-sweep", { now: Date.now(), outcome: { closed: true, seconds: 90, reason: "close_requested", retry: false } });
    assert.deepEqual(swept.closed.map((c) => [c.cap === quiet, c.by, c.seconds]), [[true, "server", 90]], "hung up at OpenAI, charged its ninety seconds");
    // The checks apply here too, and an unknown session is a 404.
    assert.equal((await worker.fetch(closedReq(cap, 1, { origin: null }), e)).status, 403);
    assert.equal((await worker.fetch(closedReq(cap, 1, { type: "text/plain" }), e)).status, 403);
    assert.equal((await worker.fetch(closedReq("e".repeat(32), 1), e)).status, 404);
    assert.equal((await worker.fetch(closedReq(null, 1), e)).status, 401);
    // A beacon on the way out carries the capability in its body instead.
    const { cap: leaving } = await openSession(e);
    const beacon = await worker.fetch(req("closed", { type: "application/json", body: JSON.stringify({ cap: leaving.toUpperCase() }) }), e);
    assert.equal(beacon.status, 200, await beacon.clone().text());
    assert.equal((await beacon.json()).closed_by, "expired");
    assert.equal((await worker.fetch(req("closed", { type: "application/json", body: JSON.stringify({ cap: "not-a-cap" }) }), e)).status, 401);
    assert.equal((await worker.fetch(req("closed", { type: "application/json", body: "{not json" }), e)).status, 401);
  } finally { f.restore(); }
});

test("the Talk page: the bar with Talk on, one script under the nonce, the wall's own CSP, the chooser, the minutes — and no credential", async () => {
  const f = installFetch({ contents: [track("t1")], openai: okOpenAI() });
  try {
    const e = env();
    const res = await worker.fetch(get(`/buttons/${KEY}/talk`), e);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<main class="page djpage talk tabbed" data-base="\/buttons\/abcdefabcdefabcdefabcdef" data-idle="30000" data-beat="30000" data-rate="5">/);
    // The DJ page's clothes: the deep block, a ghost glyph, the name, the summary, the facts line, labelled blocks.
    // ONE PAGE HEADER (MC-30 stage 4): the title and the "?" above the card.
    assert.match(html, /<header class="masthead wallhead pagehead">\s*<h1>Talk<\/h1><details class="help pagehelp" name="pagehead"><summary class="helpq" aria-label="How Talk works">/);
    assert.match(html, /<section class="djhead talkcard" aria-label="Talk">/);
    assert.match(html, /<span class="ghost" aria-hidden="true">\u201c<\/span>/);
    assert.match(html, /<p class="vsum">Hold the button, say what you want, let go\./);
    assert.match(html, /<h2 class="blabel" id="exh">The last exchange<\/h2>/);
    // No Speaker section since 2026-09-23: one line under the button says it.
    assert.ok(!html.includes('id="devh"'), "no Speaker heading");
    assert.match(html, /The line is on the clock while it is open<\/b>, talking or not, at 5 cents a minute; the house has 60 minutes a day\. The meter in the card counts this line and the day\. <b>Hang up<\/b> when you are done, or the line hangs up by itself 30 seconds after it has finished answering — never while it is still working\./);
    assert.match(html, /<p class="vfacts meter" id="meter" hidden><\/p>/, "this line's meter, until a line opens");
    assert.match(html, /<button class="chip light hangup" id="hangup" type="button" hidden>Hang up<\/button>/);
    assert.ok(!/<a class="chip light round backline"/.test(html), "a tab needs no way back: the tab bar is it");
    assert.ok(!/ten minutes|10 minutes|LIMIT_MS|data-limit/.test(html), "no ten-minute words anywhere");
    assert.match(html, new RegExp(`<a class="tab on" href="/buttons/${KEY}/talk" aria-current="page">`));
    assert.equal((html.match(/<nav class="tabbar"/g) ?? []).length, 1);
    // Scripts under this response's nonce, and no bare tag left.
    const csp = res.headers.get("content-security-policy");
    const nonce = csp.match(/script-src 'nonce-([0-9a-f]+)'/)[1];
    // Three since 2026-09-23: and the one speaker choice the pickers share.
    assert.equal((html.match(/<script nonce="/g) ?? []).length, 3);
    assert.equal((html.match(/<script(?! nonce=)/g) ?? []).length, 0, "no bare script tag");
    assert.ok(html.includes(`<script nonce="${nonce}">`));
    assert.ok(!/<script>/.test(html));
    // The CSP is the wall's, byte for byte past the nonce.
    const wall = await worker.fetch(get(`/buttons/${KEY}`), e);
    const strip = (s) => s.replace(/'nonce-[0-9a-f]+'/, "'nonce-X'");
    assert.equal(strip(csp), strip(wall.headers.get("content-security-policy")));
    assert.equal(res.headers.get("cache-control"), "no-store");
    // The chooser: every speaker in the house, the default chosen.
    // A line under the button, the picker laid over it (2026-09-23).
    assert.match(html, /<p class="tspk"><span id="tspk">Plays on the <b>Pro Plus<\/b><\/span> unless you say otherwise<select class="devsel" id="talkdev" name="device" data-pick hidden aria-label="Speaker to play on"><option selected>Pro Plus<\/option><option>Everywhere<\/option><\/select><\/p>/);
    assert.ok(html.indexOf('class="tspk"') > html.indexOf('id="hold"') && html.indexOf('class="tspk"') < html.indexOf('id="minutes"'), "under the button, above the minutes");
    assert.match(html, /<p class="vfacts" id="minutes">0 of 60 minutes today · about \$0\.00<\/p>/);
    assert.match(html, /<button class="hold" id="hold" type="button" aria-pressed="false">Hold to talk<\/button>/);
    assert.match(html, /<audio id="voice" autoplay playsinline><\/audio>/);
    // The script talks to the three doors and the documented channel, and holds nothing secret.
    for (const s of ['"/talk/session"', '"/talk/tool"', '"/talk/closed"', '"/talk/beat"', 'setInterval(beat, BEAT_MS)',
      'hangup.addEventListener("click"', 'body: "{}"', 'navigator.sendBeacon(base + "/talk/closed"', 'function done()',
      'createDataChannel("oai-events")',
      '"session.started"', '"session.input_audio.unmute"', '"session.input_audio.mute"', '"session.close"',
      '"session.input_audio.unmuted"', '"session.input_audio.muted"', 'ev.event_id = "page_"',
      'ev.client_event_id === id', 'function micOn(on)', 'micOn(false)', 'dc.onerror',
      't === "response.event" && ev.event', 'it === "response.output_item.done" && inner.item && inner.item.type === "function_call"',
      'content: "Play on " + dev.value', '"session.closed"', '"connection_lost"', '"expired"',
      'pc.onconnectionstatechange', '"response.output_item.done"', '"function_call_output"', '"response.create"',
      '"session.instructions.append"', '"x-talk-session"', 'keepalive: true',
      // MC-17: the quiet clock waits for the desk to finish and for nothing to be in flight;
      // the outputs of one response go back together; the meter ticks.
      'function busy()', 'if (!live || pressed || !inflight.finished || busy()) return;', 'RESPONSE_WATCH_MS = 180000, TOOL_WATCH_MS = 120000',
      'it === "response.created"', 'it === "response.completed"', 'function flush(dId)', 'inflight.continuation = true',
      'function tickMeter()', 'Math.max(15, Math.round((Date.now() - startedAt) / 1000))', 'Date.now() > inflight.deadline',
      // 2026-10-24 (the owner: "it keeps running a meter even though I'm not saying anything"): a press that brought
      // no answer counts as finished after ten quiet seconds, and leaving the page closes the line once nothing is in flight.
      'HEARD_WATCH_MS = 10000', '!inflight.finished && !pressed && !busy() && now - lastHeard > HEARD_WATCH_MS) inflight.finished = true',
      'if (live && leaving && !pressed && !busy()) { close("away"); return; }',
      'if (document.hidden) { release(); if (live) { leaving = true; if (!busy()) close("away"); } return; }',
      '"Hung up when you left the page."']) {
      assert.ok(html.includes(s), s);
    }
    assert.equal((html.match(/send\(\{ type: "response\.create" \}\)/g) ?? []).length, 1, "one continuation, sent from flush");
    assert.ok(!html.includes("instructions: \"Play on"), "the append's field is content, as documented");
    assert.ok(!html.includes(SECRET));
    assert.ok(!/gpt-|api\.openai\.com|Bearer/.test(html), "no model, host or bearer on the page");
    // After three minutes of talk today the line counts it, and prices it.
    spend(e, 3);
    const later = await (await worker.fetch(get(`/buttons/${KEY}/talk`), e)).text();
    assert.match(later, /3 of 60 minutes today · about \$0\.15/);
    assert.ok(!html.includes("seconds: secs"), "the page sends no seconds");
    // The page answers GET only, in a page.
    const post = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/talk`, { method: "POST" }), e);
    assert.equal(post.status, 405);
    assert.match(await post.text(), /only answers GET/);
  } finally { f.restore(); }
});

test("talk_ledger: the owner reads a day's conversations and can relabel them; the voice cannot see its own ledger", async () => {
  const f = installFetch({ openai: okOpenAI() });
  try {
    const e = env();
    e.MCP_SECRET = "owner-secret-owner-secret-owner-1";
    const rpc = (secret, name, args = {}) => new Request(`https://x.test/mcp/${secret}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const first = await openSession(e);
    e.STATION.sessions.get(first.cap).created_at -= 45_000;
    await worker.fetch(closedReq(first.cap), e);
    await openSession(e);
    const res = await (await worker.fetch(rpc(e.MCP_SECRET, "talk_ledger", {}), e)).json();
    assert.ok(!res.result.isError, res.result.content[0].text);
    const out = JSON.parse(res.result.content[0].text);
    assert.equal(out.day, today());
    assert.equal(out.tz, "Europe/Amsterdam");
    assert.deepEqual([out.used, out.cap_minutes, out.remaining], [2, 60, 58]);
    assert.ok(out.used_sec >= 60 && out.used_sec <= 62, `forty-five seconds and an opening's fifteen: ${out.used_sec}`);
    assert.equal(out.sessions.length, 2);
    assert.deepEqual(out.sessions[0], { cap: first.cap.slice(0, 8), opened: out.sessions[0].opened, seconds: out.sessions[0].seconds, open: false, closed_by: "expired", bound: true });
    assert.ok(out.sessions[0].seconds >= 45);
    assert.deepEqual([out.sessions[1].open, out.sessions[1].closed_by], [true, null]);
    assert.ok(!JSON.stringify(out).includes(first.cap), "the capability is not shown whole");
    // Relabel: the rows move to another day, and the day reads empty.
    const moved = await (await worker.fetch(rpc(e.MCP_SECRET, "talk_ledger", { action: "relabel", day: today(), to: "2026-01-02" }), e)).json();
    assert.deepEqual(JSON.parse(moved.result.content[0].text), { ok: true, moved: 2, from: today(), to: "2026-01-02", tz: "Europe/Amsterdam" });
    const after = JSON.parse((await (await worker.fetch(rpc(e.MCP_SECRET, "talk_ledger", {}), e)).json()).result.content[0].text);
    assert.deepEqual([after.used, after.sessions.length], [0, 0]);
    const other = JSON.parse((await (await worker.fetch(rpc(e.MCP_SECRET, "talk_ledger", { day: "2026-01-02" }), e)).json()).result.content[0].text);
    assert.deepEqual([other.used, other.sessions.length], [2, 2]);
    // Shapes are checked, and the voice's own door refuses the tool.
    const bad = await (await worker.fetch(rpc(e.MCP_SECRET, "talk_ledger", { action: "relabel", day: "today", to: "2026-01-02" }), e)).json();
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /day must be YYYY-MM-DD/);
    const live = await openSession(e);
    const voice = await worker.fetch(toolReq(live.cap, { name: "talk_ledger" }), e);
    assert.equal(voice.status, 400);
    assert.match((await voice.json()).error, /not a tool the room's voice may call/);
    // The house's own zone, when set, is the day the tool reckons in.
    e.HOUSE_TZ = "America/Los_Angeles";
    const la = JSON.parse((await (await worker.fetch(rpc(e.MCP_SECRET, "talk_ledger", {}), e)).json()).result.content[0].text);
    assert.equal(la.tz, "America/Los_Angeles");
    assert.equal(la.day, new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  } finally { f.restore(); }
});

// MC-18 stage 2: a write the voice makes through this door is marked as Talk
// on the Worker's own copy of env, so a guest's record says "talk" — and no
// argument the model sends can name a DJ in it.
test("a guest written through the tool door records talk, whatever the arguments claim — and the DJ it was asked of (option 2, 2026-09-28)", async () => {
  const f = installFetch({ contents: [track("t1")], openai: okOpenAI() });
  try {
    const e = env();
    e.BUTTONS = JSON.stringify([
      { button: 1, guest: true, live: true, name: "DJ Guest", playlist: PID, catalog: "spotify" },
      { button: 3, dj: "the-librarian", playlist: P(3) },
    ]);
    const { cap } = await openSession(e);
    const res = await worker.fetch(toolReq(cap, { name: "replace_playlist", arguments: {
      playlist: "guest on spotify", uris: ["spotify:track:t2"], dj: "hank", ref: "request r1" } }), e);
    const got = await res.json();
    assert.equal(res.status, 200, JSON.stringify(got));
    assert.ok(got.output, got.error);
    assert.deepEqual(f.state.contents.map((t) => t.uri), ["spotify:track:t2"]);
    const on = JSON.parse(await e.PROGRAMS.get(`on:${PID}`));
    assert.deepEqual({ dj: on.dj, ref: on.ref }, { dj: "hank", ref: "talk" });
  } finally { f.restore(); }
});

test("the Talk line's words: \"the\" before a speaker, \"everywhere\" for the group, and a name escaped", () => {
  assert.equal(spkWords("Pro Plus"), "Plays on the <b>Pro Plus</b>");
  assert.equal(spkWords("Everywhere"), "Plays <b>everywhere</b>");
  assert.equal(spkWords("A<b>"), "Plays on the <b>A&#60;b&#62;</b>");
});

// THE ARCHIVE BY VOICE (2026-10-10): in a house with an archive preset, both
// prompts know it and its number, the two tools are offered, and the voice's
// play_archive has no request_id. Without one, all of it is absent (above).
test("a house with an archive: Talk is told preset 6 and given the two archive tools, without a request id", async () => {
  const seen = [];
  const f = installFetch({ openai: okOpenAI(seen) });
  try {
    const e = env();
    e.BUTTONS = buttons({ 1: P(1), 2: P(2), 3: P(3), 4: P(4), 6: true });
    await openSession(e);
    const s = seen[0].body.session;
    assert.equal(s.instructions, voicePrompt({ archive: { btn: 6 } }));
    assert.notEqual(s.instructions, VOICE_PROMPT);
    assert.match(s.instructions, /onto the archive preset, 6/);
    assert.match(s.instructions, /say it is playing only when the backend says it started;\s+otherwise that it is loaded and to press 6/);
    const r = s.delegation.responses;
    assert.ok(r.instructions.includes(`# The archive: ${ARCHIVE.tapes}, preset 6`));
    assert.match(r.instructions, /is search_archive, never search_track or search_tracks/);
    assert.match(r.instructions, /`device` the speaker to play on[^]*presses 6 there to start it/);
    assert.match(r.instructions, /"Loaded on the archive preset, press\s+6"/);
    assert.match(r.instructions, /Never say it is playing unless `started` is true/);
    assert.match(r.instructions, /say how many\s+and their dates, and ask which/);
    const fns = r.tools.filter((t) => t.type === "function");
    assert.ok(fns.some((t) => t.name === "search_archive"));
    const pa = fns.find((t) => t.name === "play_archive");
    assert.ok(pa, "play_archive offered");
    assert.equal(pa.parameters.properties.request_id, undefined, "the voice settles no request");
    assert.match(pa.description, /With `device` a WiiM, the home helper presses the archive preset there/);
    assert.ok(pa.parameters.properties.device, "the speaker to start it on");
  } finally { f.restore(); }
});

// A START BY VOICE IS A CHOICE (the owner, 2026-10-10: Deep Dive's page opened
// on the Ultra while Talk had just started him on the Master Bedroom). A
// speaker Talk starts music on is stamped like a tap; a pause, a read or a
// refusal chooses nothing.
test("a start by voice stamps its speaker for every page; a pause or a refusal does not", async () => {
  const f = installFetch({ contents: [track("t1")], openai: okOpenAI() });
  try {
    const e = env();
    const { cap } = await openSession(e);
    const play = await worker.fetch(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "preset 3", device: "pro plus" }) }), e);
    const body = await play.json();
    assert.ok(body.output, JSON.stringify(body));
    assert.match(play.headers.get("set-cookie") ?? "", /^spk=pro-plus\.\d+; Path=\/;/, "stamped, in the house's spelling");
    const pause = await worker.fetch(toolReq(cap, { name: "playback_control", arguments: JSON.stringify({ action: "pause", device: "Pro Plus" }) }), e);
    assert.equal(pause.headers.get("set-cookie"), null, "a pause chooses nothing");
    const read = await worker.fetch(toolReq(cap, { name: "get_dj", arguments: JSON.stringify({ name: "Hank" }) }), e);
    assert.equal(read.headers.get("set-cookie"), null, "a read chooses nothing");
    const refused = await worker.fetch(toolReq(cap, { name: "play_playlist", arguments: JSON.stringify({ playlist: "no such list anywhere", device: "Pro Plus" }) }), e);
    assert.ok((await refused.json()).error, "the tool refused");
    assert.equal(refused.headers.get("set-cookie"), null, "a refusal chooses nothing");
  } finally { f.restore(); }
});
