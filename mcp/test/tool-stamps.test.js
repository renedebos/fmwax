// WHICH COPY OF THE HOUSE'S TOOLS A CHAT HOLDS (2026-11-12). Claude and
// ChatGPT keep a copy of the house's tool list from when the connector or
// plugin was added or refreshed; that day the house's ChatGPT curator wrote a
// long read by steps rewritten the week before. So a few tools carry a stamp,
// `v`, of the whole list their door serves (toollist.js STAMPED_TOOLS); the
// door takes it out before the tool runs and tells current, old and none
// apart (mcp.js); each door's last call in each state is kept (settings.js
// noteToolList); and the setup page says when a chat used an older copy
// (checklist.js). Talk's functions, made fresh every session, carry none.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { AGENT_TOOLS, STAMPED_TOOLS, STAMP_WORDS, TOOLS, listStamp, stampFor, stampOf, stampOfList, takeStamp, toolsWithMeta,
  voiceFunctions } from "../toollist.js";
import { cleanAgent, toolClient } from "../settings.js";
import { TOOL_LIST_OLD } from "../mcp.js";
import { setupChecklist } from "../checklist.js";
import { CURATOR_SEEN_KEY } from "../services.js";
import { buttons, installFetch, makeEnv, makeHouseStore, PID } from "./harness.js";

const ORIGIN = "https://fmwax.test";
const KEY = "setup-key-0123456789abcdef";
const OWNER = "owner-mcp-owner-mcp-owner-mcp-01";
const AGENT = "agent-mcp-agent-mcp-agent-mcp-01";
const PAGES = "abcdefabcdefabcdefabcdef";
const HOUR = 60 * 60 * 1000;

// A claimed house whose settings store records every note of a tool list
// sent to it, so a test can count the writes.
async function claimedHouse(over = {}, { claim = true } = {}) {
  const e = makeEnv();
  const store = await makeHouseStore();
  const notes = [];
  e.HOUSE = { idFromName: () => "household", get: () => {
    const s = store.binding.get();
    return { fetch: (u, init) => {
      if (new URL(u).pathname === "/tool-list" && init?.method === "POST") notes.push(JSON.parse(init.body));
      return s.fetch(u, init);
    } };
  } };
  e.SETUP_KEY = KEY;
  e.MCP_SECRET = OWNER;
  e.AGENT_SECRET = AGENT;
  e.HOUSE_TZ = "America/Los_Angeles";
  Object.assign(e, over);
  let cookie = null;
  if (claim) {
    const r = await worker.fetch(new Request(`${ORIGIN}/setup/claim`, { method: "POST", headers: { origin: ORIGIN },
      body: new URLSearchParams({ key: KEY }) }), e, null);
    cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  }
  return { e, store, notes, cookie };
}
// One tools/call on a door, its notes written before the answer is read.
async function call(e, secret, name, args) {
  const waits = [];
  const r = await worker.fetch(new Request(`${ORIGIN}/mcp/${secret}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } }) }),
  e, { waitUntil: (p) => waits.push(p) });
  const body = await r.json();
  await Promise.all(waits);
  return body.result;
}
const answer = (result) => JSON.parse(result.content[0].text);
const lists = async (e) => (await (await e.HOUSE.get().fetch("https://house/tool-list")).json());
// The two doors' stamps, as a call through each is judged.
const ownerStamp = (e) => stampFor(e, "owner", "get_dj");
const curatorStamp = (e) => stampFor(e, "agent", "get_dj");
const other = (s) => s === "000000" ? "111111" : "000000";
const row = (list, title) => list.sections.flatMap((s) => s.rows).find((r) => r.title === title);
// A list without its stamps, to weigh what they add.
const unstamped = (list) => list.map((t) => {
  if (!t.inputSchema?.properties?.v) return t;
  const { v: _v, ...rest } = t.inputSchema.properties;
  return { ...t, inputSchema: { ...t.inputSchema, properties: rest, required: t.inputSchema.required.filter((r) => r !== "v") } };
});

// ------------------------------------------------------------- the stamps

// The widest list a house can have: the archive's two and Last.fm's one.
function fullHouse() {
  const e = makeEnv();
  e.BUTTONS = buttons({ 3: PID, 6: true });
  e.LASTFM_KEY = "c0ffeec0ffeec0ffeec0ffeec0ffee00";
  return e;
}

test("only the tools a run starts with or writes through carry `v`, on each door: its list's stamp, required, two words", () => {
  // Pinned: widening it costs every chat the field's bytes (below).
  assert.deepEqual([...STAMPED_TOOLS], ["list_requests", "get_dj", "search_tracks", "find_recording", "now_playing",
    "fulfill_request", "extend_endless", "keep_request_set", "replace_playlist", "make_librarian_program", "make_gatefold_program"]);
  const e = fullHouse();
  for (const [role, want] of [["owner", STAMPED_TOOLS], ["agent", STAMPED_TOOLS.filter((n) => AGENT_TOOLS.has(n))]]) {
    const listed = toolsWithMeta(e, role);
    const carry = listed.filter((t) => t.inputSchema.properties?.v).map((t) => t.name);
    assert.deepEqual(carry.sort(), [...want].sort(), `${role}: exactly the stamped tools on its list`);
    const stamp = stampFor(e, role, "get_dj");
    assert.match(stamp, /^[0-9a-f]{6}$/);
    for (const t of listed) {
      const v = t.inputSchema.properties?.v;
      if (!v) { assert.ok(!(t.inputSchema.required ?? []).includes("v"), t.name); continue; }
      assert.deepEqual(v, { type: "string", enum: [stamp], description: STAMP_WORDS }, `${role} ${t.name}: one value, an enum, the list's stamp`);
      assert.equal(t.inputSchema.required.filter((r) => r === "v").length, 1, `${t.name}: required, once`);
    }
  }
  assert.equal(STAMP_WORDS, "Send as given.");
  // No tool has a field of that name of its own, which the stamp would hide,
  // and the definitions themselves are untouched: the stamp goes on at list time.
  assert.deepEqual(TOOLS.filter((t) => t.inputSchema?.properties && Object.hasOwn(t.inputSchema.properties, "v")).map((t) => t.name), []);
  assert.ok(!TOOLS.some((t) => (t.inputSchema?.required ?? []).includes("v")));
  // Said as calmly as the write tools (connector-rules.test.js).
  assert.doesNotMatch(STAMP_WORDS, /\b[A-Z]{2,}\b/, "no capitals");
  assert.doesNotMatch(STAMP_WORDS, /approval|permission|must|always|never/i);
});

test("each door its own stamp; a tool not stamped, or not on that door's list, is judged by none", () => {
  const e = makeEnv();
  assert.notEqual(ownerStamp(e), curatorStamp(e), "two lists, two stamps");
  for (const n of STAMPED_TOOLS) assert.equal(stampFor(e, "owner", n), ownerStamp(e), n);
  assert.equal(stampFor(e, "agent", "keep_request_set"), curatorStamp(e));
  assert.equal(stampFor(e, "agent", "now_playing"), null, "not on the curator's list");
  assert.equal(stampFor(e, "owner", "list_programs"), null, "on the list, but carries no stamp");
  assert.equal(stampFor(e, "owner", "make_professor_program"), null, "not a tool here");
  // The list is the house's: a house with the archive lists two more tools.
  assert.notEqual(ownerStamp(fullHouse()), ownerStamp(e));
});

test("the curator's list carries its stamp on tools/list; Talk's functions carry none", async () => {
  const e = makeEnv();
  e.MCP_SECRET = OWNER;
  e.AGENT_SECRET = AGENT;
  const r = await worker.fetch(new Request(`${ORIGIN}/mcp/${AGENT}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), e);
  const tools = (await r.json()).result.tools;
  assert.ok(tools.length >= 7 && tools.every((t) => AGENT_TOOLS.has(t.name)));
  const keep = tools.find((t) => t.name === "keep_request_set");
  assert.deepEqual([keep.inputSchema.properties.v.enum, keep.inputSchema.required.at(-1)], [[curatorStamp(e)], "v"]);
  assert.ok(!tools.find((t) => t.name === "decline_request").inputSchema.properties.v, "not a stamped tool");
  // Talk: every function the voice is handed, the one writer, ask_dj and
  // press_preset included, with no stamp in its fields or its required.
  const talk = fullHouse();
  talk.REQUESTS_ENABLED = "true";
  talk.AUTOFULFILL_ENABLED = "true";
  talk.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.57" });
  const fns = voiceFunctions(talk);
  assert.ok(["write_program", "ask_dj", "press_preset", "move_music", "replace_playlist", "get_dj"].every((n) => fns.some((f) => f.name === n)));
  for (const f of fns) {
    assert.ok(!Object.hasOwn(f.parameters?.properties ?? {}, "v"), `${f.name} has no stamp`);
    assert.ok(!(f.parameters?.required ?? []).includes("v"), `${f.name} does not require one`);
  }
});

test("a list's stamp: the same on every load; another when any tool on it changes; the curator's unmoved by the owner's own", async () => {
  // The pure stamp: six hex characters, the same for the same text, and
  // FNV-1a's own check value, so the hash is the one the comment names.
  assert.match(stampOf("Keep a set on the Shelf."), /^[0-9a-f]{6}$/);
  assert.equal(stampOf("Keep a set on the Shelf."), stampOf("Keep a set on the Shelf."));
  assert.notEqual(stampOf("Keep a set on the Shelf."), stampOf("Keep a set on the shelf."));
  assert.equal(stampOf("a"), "e40c29");
  // A second load of the module (a new instance) makes the same stamps.
  const again = await import("../toollist.js?second-load");
  const e = makeEnv();
  for (const role of ["owner", "agent"]) assert.equal(again.stampFor(e, role, "get_dj"), stampFor(e, role, "get_dj"), role);
  // Any tool's words or fields, stamped or not: the owner's stamp moves.
  const curator = (tools) => tools.filter((t) => AGENT_TOOLS.has(t.name));
  const changed = (name, f) => TOOLS.map((t) => t.name === name ? f(t) : t);
  const words = (t) => ({ ...t, description: `${t.description} ` });
  for (const name of ["list_programs", "replace_playlist", "keep_request_set"]) {
    assert.notEqual(stampOfList(changed(name, words)), stampOfList(TOOLS), `${name}'s words`);
  }
  assert.notEqual(stampOfList(changed("decline_request", (t) => ({ ...t, inputSchema: { ...t.inputSchema, required: [] } }))),
    stampOfList(TOOLS), "a field");
  // A tool only the owner is offered: the curator's stamp stays.
  for (const name of ["list_programs", "replace_playlist", "now_playing"]) {
    assert.ok(!AGENT_TOOLS.has(name));
    assert.equal(stampOfList(curator(changed(name, words))), stampOfList(curator(TOOLS)), name);
  }
  // One both are offered: both move.
  assert.notEqual(stampOfList(curator(changed("keep_request_set", words))), stampOfList(curator(TOOLS)));
  // And the order is part of the list.
  assert.notEqual(stampOfList([...TOOLS].reverse()), stampOfList(TOOLS));
});

test("what the stamp costs a chat: under 850 bytes on the owner's list, its eleven tools", () => {
  // MEASURED 2026-11-12: 821 bytes on the owner's list (11 tools), 523 on the
  // curator's (7). The bare field is 44 bytes a tool, so 484 for eleven; any
  // words at all add at least 18 a tool, which is why this is not 600. The
  // per-tool stamps it replaced, on every tool, were 4,311.
  const e = makeEnv();
  const owner = toolsWithMeta(e), agent = toolsWithMeta(e, "agent");
  const added = (l) => JSON.stringify(l).length - JSON.stringify(unstamped(l)).length;
  assert.ok(added(owner) < 850, `the owner's list: ${added(owner)} bytes`);
  assert.ok(added(agent) < 550, `the curator's list: ${added(agent)} bytes`);
});

test("takeStamp: `v` out of the arguments, whatever it holds; judged only where there is a stamp", () => {
  const mine = "3b6e83";
  const args = { name: "Hank", ask: "an hour of soul" };
  const cur = takeStamp({ ...args, v: mine }, mine);
  assert.deepEqual(cur, { args, state: "current" });
  assert.ok(!Object.hasOwn(cur.args, "v"), "the tool never sees it");
  assert.equal(takeStamp({ ...args, v: ` ${mine.toUpperCase()} ` }, mine).state, "current", "case and spaces are no new wording");
  assert.deepEqual(takeStamp({ ...args, v: other(mine) }, mine), { args, state: "old" });
  // No stamp, a blank one, or one of another type: none, and the call goes on.
  const same = { ...args };
  assert.equal(takeStamp(same, mine).args, same, "no v: the very arguments that came in");
  assert.equal(takeStamp(same, mine).state, "none");
  for (const v of ["", "   ", 7, 0, null, true, {}, []]) assert.deepEqual(takeStamp({ ...args, v }, mine), { args, state: "none" }, JSON.stringify(v));
  // A tool with no stamp: not judged, and `v` still never reaches it.
  assert.deepEqual(takeStamp({ ...args, v: mine }, null), { args, state: null });
  assert.deepEqual(takeStamp(same, null), { args, state: null });
  // Arguments that are not an object are handed on as they came.
  for (const a of [undefined, null, "x", [1]]) assert.equal(takeStamp(a, mine).args, a);
});

// ------------------------------------------------------------ at the door

test("the door: a current stamp runs as before; an old one runs and is told so; none, blank or a number run as ever", async () => {
  const f = installFetch();
  try {
    const { e, notes } = await claimedHouse();
    const plain = await call(e, OWNER, "get_dj", {});
    assert.ok(!plain.isError, plain.content[0].text);
    const cur = await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    assert.equal(cur.content[0].text, plain.content[0].text, "current: the answer it always was");
    const old = await call(e, OWNER, "get_dj", { v: other(ownerStamp(e)) });
    const { tool_list: said, ...rest } = answer(old);
    assert.equal(said, TOOL_LIST_OLD);
    assert.equal(said, "Your copy of the house's tools is older than the house's own. Tell the person to click Refresh tools " +
      "on the fmwax plugin in ChatGPT (under Manage app), or to re-add the house in Claude and start a new chat.");
    assert.deepEqual(rest, answer(plain), "and otherwise the same answer");
    // The curator's stamp is not the owner's: through the owner's door it is an old copy.
    assert.equal(answer(await call(e, OWNER, "get_dj", { v: curatorStamp(e) })).tool_list, TOOL_LIST_OLD);
    for (const v of [undefined, "", 7, null, { x: 1 }]) {
      const r = await call(e, OWNER, "get_dj", v === undefined ? {} : { v });
      assert.ok(!r.isError, JSON.stringify(v));
      assert.ok(!("tool_list" in answer(r)), `${JSON.stringify(v)}: nothing said of the list`);
    }
    // No arguments at all, as some clients send a call with none.
    assert.ok(!(await call(e, OWNER, "get_dj")).isError);
    // What the door noted for the owner's door: one note per state.
    assert.deepEqual(notes.map((n) => [n.door, n.state, n.tool]),
      [["connector", "none", "get_dj"], ["connector", "current", "get_dj"], ["connector", "old", "get_dj"]]);
    const kept = (await lists(e)).connector;
    assert.deepEqual(Object.keys(kept).sort(), ["apps", "current", "none", "old"], "each state once, and the same per app");
    assert.equal(kept.old.tool, "get_dj");
  } finally { f.restore(); }
});

test("a call to a tool that carries no stamp is not judged: it runs, nothing is said or noted, whatever `v` holds", async () => {
  const f = installFetch();
  try {
    const { e, notes } = await claimedHouse();
    const plain = await call(e, OWNER, "list_programs", {});
    assert.ok(!plain.isError, plain.content[0].text);
    for (const v of [ownerStamp(e), other(ownerStamp(e)), "", 7]) {
      const r = await call(e, OWNER, "list_programs", { v });
      assert.equal(r.content[0].text, plain.content[0].text, JSON.stringify(v));
    }
    assert.deepEqual(notes, []);
  } finally { f.restore(); }
});

test("tools with strict checks of their arguments take `v` beside them, and an error is the same error", async () => {
  const f = installFetch();
  try {
    const { e } = await claimedHouse();
    // find_recording (stamped) refuses an ask with no composer before it
    // reaches Spotify; talk_ledger (not stamped) checks its dates to the letter.
    const noComposer = { work: "Symphony No. 5 in C minor, Op. 67", performers: ["Carlos Kleiber"] };
    const plainFind = await call(e, OWNER, "find_recording", noComposer);
    assert.equal(plainFind.isError, true);
    assert.match(plainFind.content[0].text, /composer is required/);
    const bad = { action: "relabel", day: "today", to: "2026-01-02" };
    const plainLedger = await call(e, OWNER, "talk_ledger", bad);
    assert.equal(plainLedger.isError, true);
    for (const v of [ownerStamp(e), other(ownerStamp(e)), 7]) {
      assert.equal((await call(e, OWNER, "find_recording", { ...noComposer, v })).content[0].text, plainFind.content[0].text,
        "an error carries no word of the list");
      assert.equal((await call(e, OWNER, "talk_ledger", { ...bad, v })).content[0].text, plainLedger.content[0].text);
    }
    const ok = await call(e, OWNER, "talk_ledger", { day: "2026-11-12", v: ownerStamp(e) });
    assert.ok(!ok.isError, ok.content[0].text);
    assert.equal(answer(ok).day, "2026-11-12");
  } finally { f.restore(); }
});

test("the two doors are kept apart, each judged by its own list; a current call after an old one leaves the old one kept", async () => {
  const f = installFetch();
  try {
    const { e } = await claimedHouse();
    await call(e, AGENT, "get_dj", { v: ownerStamp(e) });
    let kept = await lists(e);
    assert.equal(kept.curator.old.tool, "get_dj", "the owner's stamp on the curator's door is an old copy");
    assert.equal(kept.connector, undefined, "the owner's door has said nothing");
    await call(e, AGENT, "get_dj", { v: curatorStamp(e) });
    await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    kept = await lists(e);
    assert.ok(kept.curator.old && kept.curator.current, "the old one is still there beside the fresh one");
    assert.ok(kept.connector.current && !kept.connector.old);
    assert.ok(Date.parse(kept.curator.current.at) >= Date.parse(kept.curator.old.at));
  } finally { f.restore(); }
});

test("written at most once in ten minutes per door and state: two calls alike write once", async () => {
  const f = installFetch();
  try {
    const { e, notes } = await claimedHouse();
    await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    assert.equal(notes.length, 1, "two current calls in a row: one write");
    await call(e, OWNER, "list_requests", { v: ownerStamp(e) });
    assert.equal(notes.length, 1, "another stamped tool, still current: no write");
    await call(e, OWNER, "get_dj", { v: other(ownerStamp(e)) });
    await call(e, OWNER, "get_dj", { v: other(ownerStamp(e)) });
    await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    assert.deepEqual(notes.map((n) => n.state), ["current", "old"], "the first old one at once, and nothing more");
    await call(e, AGENT, "get_dj", { v: curatorStamp(e) });
    assert.deepEqual(notes.map((n) => `${n.door}:${n.state}`), ["connector:current", "connector:old", "curator:current"]);
  } finally { f.restore(); }
});

test("a refreshed chat after a stale one is news: its call is written after a minute, not ten", async () => {
  const f = installFetch();
  const realNow = Date.now;
  try {
    const { e, notes } = await claimedHouse();
    await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    await call(e, OWNER, "get_dj", {});
    assert.deepEqual(notes.map((n) => n.state), ["current", "none"]);
    const start = realNow();
    Date.now = () => start + 2 * 60 * 1000;
    await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    assert.deepEqual(notes.map((n) => n.state), ["current", "none", "current"], "two minutes on, the fresh call is kept");
    await call(e, OWNER, "get_dj", { v: ownerStamp(e) });
    assert.equal(notes.length, 3, "and the next one alike waits its ten minutes");
  } finally { Date.now = realNow; f.restore(); }
});

test("a house nobody has claimed writes nothing, and its calls run as ever", async () => {
  const f = installFetch();
  try {
    const { e, notes, store } = await claimedHouse({}, { claim: false });
    const r = await call(e, OWNER, "get_dj", { v: other(ownerStamp(e)) });
    assert.ok(!r.isError);
    assert.equal(answer(r).tool_list, TOOL_LIST_OLD, "the model is still told");
    assert.deepEqual(notes, []);
    assert.ok(!store.rows.has("tool_list"));
  } finally { f.restore(); }
});

test("Talk's tool door is untouched: no stamp asked for, none taken out, nothing noted", async () => {
  const f = installFetch({ openai: () => new Response(JSON.stringify({ session: { id: "live_abc" }, transport: { type: "webrtc", sdp: "v=0\r\n" } }),
    { status: 201, headers: { "content-type": "application/json" } }) });
  try {
    const { e, notes } = await claimedHouse({ PROGRAM_LIBRARY_KEY: PAGES, OPENAI_API_KEY: "sk-test", ROOM_DEVICES: JSON.stringify(["Pro Plus"]),
      BUTTONS: buttons({ 1: PID }) });
    const talk = (door, { type, body, cap }) => worker.fetch(new Request(`${ORIGIN}/buttons/${PAGES}/talk/${door}`, { method: "POST",
      headers: { origin: ORIGIN, "content-type": type, ...(cap ? { "x-talk-session": cap } : {}) }, body }), e);
    const opened = await talk("session", { type: "application/sdp", body: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n" });
    assert.equal(opened.status, 201, await opened.clone().text());
    const { cap } = await opened.json();
    const r = await talk("tool", { type: "application/json", cap, body: JSON.stringify({ name: "get_dj", arguments: "{}" }) });
    assert.equal(r.status, 200);
    const out = JSON.parse((await r.json()).output);
    assert.ok(Array.isArray(out.djs));
    assert.ok(!("tool_list" in out));
    assert.deepEqual(notes, [], "Talk is not a door with a copy to go stale");
  } finally { f.restore(); }
});

// ------------------------------------------------------- the setup page

// Both doors heard from, and one door's notes as given: { state: [hoursAgo, tool] }.
async function withNotes(door, notes, over = {}) {
  const { e, store, cookie } = await claimedHouse(over);
  const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
  store.rows.set("seen", JSON.stringify({ connector: ago(0.1), curator: ago(0.1) }));
  store.rows.set("tool_list", JSON.stringify({ [door]: Object.fromEntries(Object.entries(notes)
    .map(([state, [h, tool]]) => [state, { at: ago(h), tool }])) }));
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() - 5 * 60 * 1000 }));
  return { e, cookie };
}
const owner = { claimed_at: new Date().toISOString() };
const AT = "(on \\w+ )?at \\d\\d:\\d\\d";
const TASK = "Its next run reads them afresh\\. If a later time shows here, remove and add its connector in Claude and attach it to the task again\\.";
const CLAUDE_TASK = { REQUEST_ROUTINE_ID: "trig_x" };

test("the owner's row: nothing new while all is current", async () => {
  const { e } = await withNotes("connector", { current: [0.1, "get_dj"] });
  const app = row(await setupChecklist(e, owner), "Claude or ChatGPT");
  assert.equal(app.state, "done");
  assert.match(app.detail, new RegExp(`^Added · last call ${AT}$`));
});

test("the owner's row: an older copy in the past day wants a look, says which call showed it and what to do, even after a current call", async () => {
  const { e, cookie } = await withNotes("connector", { old: [2, "keep_request_set"], none: [1, "get_dj"], current: [0.1, "get_dj"] });
  const app = row(await setupChecklist(e, owner), "Claude or ChatGPT");
  assert.equal(app.state, "due", "done, with something to look at: not the next step");
  assert.match(app.detail, new RegExp(`^Added · last call ${AT} · A chat used an older copy of the house's tools ${AT} \\(Keep a Set on the Shelf\\)\\. ` +
    "In ChatGPT, open the house's plugin and click Refresh tools, under Manage app\\. In Claude, remove the house's connector and add it again, " +
    `then start a new chat\\. A chat with today's copy has called since \\(${AT}\\)\\.$`), "several chats share this door: a fresh one's call does not clear it, and is said beside it");
  assert.doesNotMatch(app.detail, /without saying/, "an old copy outranks a stampless one");
  // And on the page itself.
  const html = await (await worker.fetch(new Request(`${ORIGIN}/setup`, { headers: { cookie } }), e, null)).text();
  assert.match(html, /A chat used an older copy of the house(&#39;|')s tools/);
});

test("the owner's row: a call with no stamp is said softly, with no reason guessed, and the row stays done", async () => {
  const { e } = await withNotes("connector", { none: [3, "get_dj"], current: [0.1, "get_dj"] });
  const app = row(await setupChecklist(e, owner), "Claude or ChatGPT");
  assert.equal(app.state, "done");
  assert.match(app.detail, new RegExp(`^Added · last call ${AT} · A chat called without saying which copy of the tools it holds \\(${AT}\\)\\. ` +
    `Refresh its tools in ChatGPT, or add it again in Claude, once\\. A chat with today's copy has called since \\(${AT}\\)\\.$`));
  assert.doesNotMatch(app.detail, /added before|2026-11-13/);
  // No current call after it: nothing is claimed.
  const before = await withNotes("connector", { none: [1, "get_dj"], current: [3, "get_dj"] });
  assert.match(row(await setupChecklist(before.e, owner), "Claude or ChatGPT").detail, /once\.$/);
});

test("the owner's row: an older copy more than a day ago is no longer said", async () => {
  const { e } = await withNotes("connector", { old: [25, "keep_request_set"], none: [30, "get_dj"] });
  const app = row(await setupChecklist(e, owner), "Claude or ChatGPT");
  assert.equal(app.state, "done");
  assert.match(app.detail, new RegExp(`^Added · last call ${AT}$`));
});

test("the curator's row says its own chat's copy, with what to do where it runs; never the owner's", async () => {
  const cur = { CURATOR: "chatgpt" };
  const chat = await withNotes("curator", { old: [1, "keep_request_set"] }, cur);
  const list = await setupChecklist(chat.e, owner);
  assert.match(row(list, "Curator").detail, new RegExp(` · The curator's chat used an older copy of the house's tools ${AT} \\(Keep a Set on the Shelf\\)\\. ` +
    "In ChatGPT, open the curator's plugin and click Refresh tools, under Manage app: its Work chat takes them at its next use of the house\\.$"));
  assert.doesNotMatch(row(list, "Claude or ChatGPT").detail, /older copy/, "the owner's door said nothing");
  // Its stampless calls, softly.
  const chatNone = await withNotes("curator", { none: [1, "list_requests"] }, cur);
  assert.match(row(await setupChecklist(chatNone.e, owner), "Curator").detail, new RegExp(` · The curator's chat called without saying which ` +
    `copy of the tools it holds \\(${AT}\\)\\. Refresh its plugin's tools in ChatGPT once\\.$`));
  // A Claude task reads the house's tools afresh at every run (the Updates
  // guide): its next run is the fix, and a later time here says it was not.
  // The row wants a look for it (a ChatGPT one with no Work chat listening already does).
  const task = await withNotes("curator", { old: [1, "fulfill_request"] }, CLAUDE_TASK);
  const t = row(await setupChecklist(task.e, owner), "Curator");
  assert.equal(t.state, "due");
  assert.match(t.detail, new RegExp(` · The curator's task used an older copy of the house's tools ${AT} \\(Fulfil a Listener Request\\)\\. ${TASK}$`));
  const none = await withNotes("curator", { none: [1, "list_requests"] }, CLAUDE_TASK);
  const n = row(await setupChecklist(none.e, owner), "Curator");
  assert.equal(n.state, "done");
  assert.match(n.detail, new RegExp(` · The curator's task called without saying which copy of the tools it holds \\(${AT}\\)\\. ${TASK}$`));
  const fresh = await withNotes("curator", { current: [0.1, "list_requests"] }, CLAUDE_TASK);
  const c = row(await setupChecklist(fresh.e, owner), "Curator");
  assert.equal(c.state, "done");
  assert.match(c.detail, new RegExp(`^The curator task, rung by web call · checked in ${AT}$`));
});

test("the curator's door has one caller: a current call newer than its old or stampless one clears the row; an older one does not", async () => {
  const cleared = await withNotes("curator", { old: [2, "keep_request_set"], none: [1.5, "get_dj"], current: [1, "list_requests"] }, CLAUDE_TASK);
  const c = row(await setupChecklist(cleared.e, owner), "Curator");
  assert.equal(c.state, "done");
  assert.match(c.detail, new RegExp(`^The curator task, rung by web call · checked in ${AT}$`), "nothing said");
  const still = await withNotes("curator", { old: [1, "keep_request_set"], current: [2, "list_requests"] }, CLAUDE_TASK);
  const s = row(await setupChecklist(still.e, owner), "Curator");
  assert.equal(s.state, "due");
  assert.match(s.detail, /The curator's task used an older copy of the house's tools .* \(Keep a Set on the Shelf\)/);
  // A stampless call after the current one is still said.
  const after = await withNotes("curator", { none: [0.5, "get_dj"], current: [1, "list_requests"] }, CLAUDE_TASK);
  assert.match(row(await setupChecklist(after.e, owner), "Curator").detail, /called without saying which copy of the tools it holds/);
});

// ------------------------------------------------- who fetched the list
// (2026-11-13: ChatGPT's first calls after the stamps came with none, and no
// chat could say whether its copy was old. A fetch of the list is the app's
// own act and needs nothing of the model.)

// One request on a door as an app would send it, its notes written first.
async function rpc(e, secret, method, params, ua) {
  const waits = [];
  const r = await worker.fetch(new Request(`${ORIGIN}/mcp/${secret}`, { method: "POST",
    headers: { "content-type": "application/json", ...(ua ? { "user-agent": ua } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }) }), e, { waitUntil: (p) => waits.push(p) });
  const body = await r.json();
  await Promise.all(waits);
  return body.result;
}

test("the app at the door is told from its User-Agent, four families and nothing more", () => {
  assert.equal(toolClient("openai-mcp/1.0.0"), "chatgpt");
  assert.equal(toolClient("Mozilla/5.0 (compatible; ChatGPT-User/1.0)"), "chatgpt");
  assert.equal(toolClient("Claude-User"), "claude");
  assert.equal(toolClient("claude-code/2.1.0 (cli)"), "code");
  assert.equal(toolClient("python-httpx/0.27"), "other");
  assert.equal(toolClient(null), "other");
  assert.equal(cleanAgent("x".repeat(90)).length, 60);
  assert.equal(cleanAgent("curl/8 <script>\"&"), "curl/8 script");
});

test("a fetch of the list is kept per door and app with the stamp it was handed, and the call notes are untouched", async () => {
  const f = installFetch();
  try {
    const { e, notes } = await claimedHouse();
    const got = await rpc(e, OWNER, "tools/list", null, "openai-mcp/1.0.0");
    assert.ok(got.tools.length > 5);
    await rpc(e, AGENT, "tools/list", null, "Claude-User");
    await rpc(e, OWNER, "tools/list", null, "openai-mcp/1.0.0");
    const kept = await lists(e);
    assert.equal(kept.connector.fetched.chatgpt.stamp, listStamp(e, "owner"));
    assert.equal(kept.connector.fetched.chatgpt.ua, "openai-mcp/1.0.0");
    assert.equal(kept.curator.fetched.claude.stamp, listStamp(e, "agent"));
    assert.equal(kept.connector.fetched.claude, undefined, "each door its own");
    assert.deepEqual(notes, [], "a fetch is no call: nothing in the call notes");
    // A call's note says which app made it.
    await rpc(e, OWNER, "tools/call", { name: "get_dj", arguments: {} }, "openai-mcp/1.0.0");
    assert.equal((await lists(e)).connector.none.client, "chatgpt");
    assert.ok((await lists(e)).connector.fetched.chatgpt, "and the fetch is still there beside it");
  } finally { f.restore(); }
});

test("the settings store refuses a fetch note it cannot read, and an unclaimed house keeps none", async () => {
  const f = installFetch();
  try {
    const { e } = await claimedHouse();
    const post = (body) => e.HOUSE.get().fetch("https://house/tool-fetch", { method: "POST", body: JSON.stringify(body) });
    for (const bad of [{ door: "x", client: "chatgpt", stamp: "abcdef" }, { door: "connector", client: "siri", stamp: "abcdef" },
      { door: "connector", client: "chatgpt", stamp: "nope" }]) assert.equal((await post(bad)).status, 400);
    assert.equal((await lists(e)).connector, undefined);
    const un = await claimedHouse({}, { claim: false });
    await rpc(un.e, OWNER, "tools/list", null, "openai-mcp/1.0.0");
    assert.ok(!un.store.rows.has("tool_list"));
  } finally { f.restore(); }
});

// A claimed house with fetch notes (and call notes) already in its store.
// "TODAY" stands for the stamp of the list the door serves now.
async function withFetches(door, fetched, { clients = {}, apps = {}, ...notes } = {}) {
  const { e, store } = await claimedHouse();
  const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
  const today = listStamp(e, door === "curator" ? "agent" : "owner");
  store.rows.set("seen", JSON.stringify({ connector: ago(0.1), curator: ago(0.1) }));
  store.rows.set("tool_list", JSON.stringify({ [door]: {
    ...Object.fromEntries(Object.entries(notes).map(([state, [h, tool]]) => [state, { at: ago(h), tool, ...(clients[state] ? { client: clients[state] } : {}) }])),
    fetched: Object.fromEntries(Object.entries(fetched).map(([c, [h, stamp, ua]]) => [c, { at: ago(h), stamp: stamp === "TODAY" ? today : stamp, ua: ua ?? "" }])),
    apps: Object.fromEntries(Object.entries(apps).map(([c, states]) => [c, Object.fromEntries(Object.entries(states).map(([st, [h, tool]]) => [st, { at: ago(h), tool }]))])),
  } }));
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() - 5 * 60 * 1000 }));
  return e;
}

test("the owner's row says which app holds today's tools, and which fetched them before they changed, with what to do", async () => {
  const e = await withFetches("connector", { chatgpt: [0.2, "TODAY"], claude: [50, "000000"], other: [3, "000000", "python-httpx/0.27"] },
    { current: [0.1, "get_dj"] });
  const app = row(await setupChecklist(e, owner), "Claude or ChatGPT");
  assert.equal(app.state, "done");
  assert.match(app.detail, new RegExp(`^Added · last call ${AT} · ChatGPT holds today's tools \\(fetched ${AT}\\)\\. ` +
    `Claude last fetched the tools ${AT}, before they changed\\. In Claude, remove the house's connector and add it again\\. ` +
    `Another app \\(python-httpx/0\\.27\\) last fetched the tools ${AT}, before they changed\\. Connect it again\\.$`));
});

test("an app that fetched today's list and still calls with no stamp is not called stale: the house goes by the fetch", async () => {
  const e = await withFetches("connector", { chatgpt: [2, "TODAY"] },
    { none: [1, "now_playing"], clients: { none: "chatgpt" }, apps: { chatgpt: { none: [1, "now_playing"] } } });
  const app = row(await setupChecklist(e, owner), "Claude or ChatGPT");
  assert.doesNotMatch(app.detail, /without saying which copy/);
  assert.match(app.detail, /ChatGPT holds today's tools \(fetched .*\); its calls do not say which copy they use, so the house goes by the fetch\.$/);
  // Fetched AFTER the stampless call: that call may have been the old copy's, so it is still said.
  const later = await withFetches("connector", { chatgpt: [0.5, "TODAY"] }, { none: [1, "now_playing"], clients: { none: "chatgpt" } });
  assert.match(row(await setupChecklist(later, owner), "Claude or ChatGPT").detail, /without saying which copy.*ChatGPT holds today's tools \(fetched [^;]*\)\.$/);
  // An old fetch, long ago: left alone after thirty days.
  const gone = await withFetches("connector", { claude: [40 * 24, "000000"] }, { current: [0.1, "get_dj"] });
  assert.match(row(await setupChecklist(gone, owner), "Claude or ChatGPT").detail, new RegExp(`^Added · last call ${AT}$`));
});

test("each app's line says what its own calls have said since it fetched today's list; one app's stampless call does not hide another's", async () => {
  const f = installFetch();
  try {
    // Through the door: ChatGPT and Claude fetch, ChatGPT calls with no stamp, Claude with today's.
    const { e } = await claimedHouse();
    await rpc(e, OWNER, "tools/list", null, "openai-mcp/1.0.0");
    await rpc(e, OWNER, "tools/list", null, "Claude-User");
    await new Promise((r) => setTimeout(r, 5));
    await rpc(e, OWNER, "tools/call", { name: "get_dj", arguments: {} }, "openai-mcp/1.0.0");
    await rpc(e, OWNER, "tools/call", { name: "get_dj", arguments: { v: ownerStamp(e) } }, "Claude-User");
    await rpc(e, OWNER, "tools/call", { name: "get_dj", arguments: {} }, "Claude-User");
    const kept = await lists(e);
    assert.ok(kept.connector.apps.chatgpt.none && !kept.connector.apps.chatgpt.current);
    assert.ok(kept.connector.apps.claude.current, "a second app's first call is not held back by the first app's ten minutes");
    assert.ok(kept.connector.apps.claude.none, "nor its own stampless call by ChatGPT's");
  } finally { f.restore(); }
  const e = await withFetches("connector", { chatgpt: [2, "TODAY"], claude: [2, "TODAY"], code: [2, "TODAY"] },
    { none: [1, "now_playing"], clients: { none: "chatgpt" },
      apps: { chatgpt: { none: [1, "now_playing"] }, claude: { current: [0.5, "get_dj"], none: [5, "get_dj"] }, code: { old: [0.2, "keep_request_set"] } } });
  const d = row(await setupChecklist(e, owner), "Claude or ChatGPT").detail;
  assert.match(d, /ChatGPT holds today's tools \(fetched [^)]*\); its calls do not say which copy they use, so the house goes by the fetch\./);
  assert.match(d, /Claude holds today's tools \(fetched [^)]*\), and its last call said so \([^)]*\)\./, "a stampless call from before the fetch does not count");
  assert.match(d, /Claude Code holds today's tools \(fetched [^)]*\), but a chat of its used an older copy since \([^)]*\): start a new chat there\./);
  assert.doesNotMatch(d, /without saying which copy/);
});

test("an app that fetches the list with every chat: its calls are weighed from its FIRST fetch of today's list, not its last", async () => {
  const f = installFetch();
  try {
    const { e, store } = await claimedHouse();
    await rpc(e, OWNER, "tools/list", null, "Claude-User");
    const first = (await lists(e)).connector.fetched.claude;
    assert.equal(first.first, first.at);
    await new Promise((r) => setTimeout(r, 5));
    await rpc(e, OWNER, "tools/call", { name: "get_dj", arguments: { v: ownerStamp(e) } }, "Claude-User");
    // The same app fetches again, later than its call (written straight to the store: the door's ten minutes are not the point here).
    await new Promise((r) => setTimeout(r, 5));
    await e.HOUSE.get().fetch("https://house/tool-fetch", { method: "POST",
      body: JSON.stringify({ door: "connector", client: "claude", stamp: listStamp(e, "owner"), ua: "Claude-User" }) });
    const again = (await lists(e)).connector.fetched.claude;
    assert.equal(again.first, first.at, "the first fetch of this list is kept");
    assert.ok(Date.parse(again.at) > Date.parse((await lists(e)).connector.apps.claude.current.at));
    store.rows.set("seen", JSON.stringify({ connector: new Date().toISOString() }));
    assert.match(row(await setupChecklist(e, owner), "Claude or ChatGPT").detail, /Claude holds today's tools \(fetched [^)]*\), and its last call said so \(/);
    // Another list fetched: `first` starts again.
    await e.HOUSE.get().fetch("https://house/tool-fetch", { method: "POST", body: JSON.stringify({ door: "connector", client: "claude", stamp: "abcdef", ua: "" }) });
    const other = (await lists(e)).connector.fetched.claude;
    assert.equal(other.first, other.at);
  } finally { f.restore(); }
});
