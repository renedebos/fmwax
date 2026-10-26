// THE CURATOR, SET UP ON THE PAGE (the Endless step, part 1, 2026-10-17):
// the curator connector's address, the routine's note, the routine's id and
// token given back, and a wake to check it answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../worker.js";
import { CURATOR_NOTE } from "../programs.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function blank() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.AUTOFULFILL_ENABLED = "false";
  for (const n of ["MCP_SECRET", "AGENT_SECRET", "PROGRAM_LIBRARY_KEY", "HELPER_SECRET", "REQUEST_ROUTINE_ID", "REQUEST_ROUTINE_TOKEN"]) delete e[n];
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
async function claim(e) {
  return ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
}

test("the routine's note on the page is the one in the install docs", () => {
  const doc = readFileSync(new URL("../../docs/install/curator-routine.md", import.meta.url), "utf8");
  assert.ok(doc.includes(CURATOR_NOTE), "the page and docs/install/curator-routine.md say the same note");
});

test("the checklist offers the curator; its page gives the connector's address and the note", async () => {
  const e = await blank();
  const me = await claim(e);
  const list = await (await go(e, "/setup", { cookie: me })).text();
  assert.match(list, /href="\/setup\/curator">Set up the curator</);
  const page = await (await go(e, "/setup/curator", { cookie: me })).text();
  assert.match(page, /<code class="setval">https:\/\/fmwax\.test\/mcp\/[A-Za-z0-9_-]{20,}<\/code>/);
  assert.match(page, /You are this house(&#39;|')s request curator/);
  assert.match(page, /Scheduled, New task, Set up manually/, "claude.ai's words, 2026-10-17");
  assert.match(page, /choose <b>API<\/b>/);
  assert.match(page, /remove every one \(×\) but the curator(&#39;|')s connector/);
  assert.match(page, /if you already have one called that, add a word/, "names must be unique (the owner's second run)");
  // The owner's second run: paste the address, Add, then Connect; and the task's address, not a bare id.
  assert.match(page, /In its <b>URL<\/b> box, paste this address/);
  assert.match(page, /Tap <b>Add<\/b>, then <b>Connect<\/b> on the new connector/);
  assert.match(page, /The task(&#39;|')s address \(or just its trig_ part\)/);
  assert.doesNotMatch(page, /<details class="setkey"/, "not set up yet: the steps are open");
  assert.equal((await go(e, "/setup/curator")).status, 303, "the owner's only");
});

test("the routine's id and token are kept, requests switch on, and a wake rings the routine", async () => {
  const e = await blank();
  const me = await claim(e);
  assert.equal((await go(e, "/setup/curator", { method: "POST", form: { routine: "nope", token: "x".repeat(40) }, cookie: me })).status, 400);
  assert.equal((await go(e, "/setup/curator", { method: "POST", form: { routine: "trig_01ABCDEFGHIJKL" }, cookie: me })).status, 400, "a token is needed the first time");
  const saved = await go(e, "/setup/curator", { method: "POST",
    form: { routine: "https://claude.ai/code/routines/trig_01ABCDEFGHIJKL", token: "sk-ant-oat01-" + "a".repeat(40) }, cookie: me });
  assert.equal(saved.headers.get("location"), "/setup/curator?saved=1#done");
  const calls = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith("https://api.anthropic.com/")) { calls.push({ u: String(u), init }); return Response.json({ type: "routine_fire" }); }
    return inner(u, init);
  };
  try {
    const woke = await go(e, "/setup/curator/wake", { method: "POST", cookie: me });
    assert.match(woke.headers.get("location"), /^\/setup\/curator\?woke=1&at=\d{13}#done$/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].u, /\/routines\/trig_01ABCDEFGHIJKL\/fire$/);
    assert.equal(calls[0].init.headers.authorization, `Bearer sk-ant-oat01-${"a".repeat(40)}`);
  } finally { globalThis.fetch = inner; }
  const { withSettings } = await import("../settings.js");
  const live = await withSettings(e, null);
  assert.equal(live.REQUESTS_ENABLED, "true", "the DJ pages' Ask is on");
  assert.equal(live.AUTOFULFILL_ENABLED, "true", "and the house rings the curator for each job");
  const list = await (await go(e, "/setup", { cookie: me })).text();
  assert.match(list, /Curator/);
  assert.doesNotMatch(list, /Set up the curator</, "set up: now waiting for its check-in");
});

test("a new task's id and token go in together, and the old task's check-in no longer counts", async () => {
  const e = await blank();
  const me = await claim(e);
  const { CURATOR_SEEN_KEY } = await import("../services.js");
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() }));
  await go(e, "/setup/curator", { method: "POST", form: { routine: "trig_01ABCDEFGHIJKL", token: "sk-ant-oat01-" + "b".repeat(40) }, cookie: me });
  assert.equal(await e.PROGRAMS.get(CURATOR_SEEN_KEY), null, "the old check-in is gone");
  const { withSettings } = await import("../settings.js");
  const live = await withSettings(e, null);
  assert.equal(live.REQUEST_ROUTINE_ID, "trig_01ABCDEFGHIJKL");
  assert.equal(live.REQUEST_ROUTINE_TOKEN, "sk-ant-oat01-" + "b".repeat(40));
  assert.equal(live.REQUESTS_ENABLED, "true");
});

test("once kept, the page leads with what is kept and whether it answered, and says so by the buttons", async () => {
  const e = await blank();
  const me = await claim(e);
  const bad = await go(e, "/setup/curator", { method: "POST", form: { routine: "nope", token: "x".repeat(40) }, cookie: me });
  assert.match(await bad.text(), /<p class="setsaid" role="status">That is not the task(&#39;|')s address/, "the refusal by the form");
  await go(e, "/setup/curator", { method: "POST", form: { routine: "trig_01ABCDEFGHIJKL", token: "sk-ant-oat01-T3stT3st" + "q".repeat(60) + "sgAA" }, cookie: me });
  const kept = await (await go(e, "/setup/curator?saved=1", { cookie: me })).text();
  assert.match(kept, /id="done"/);
  assert.match(kept, /Its task trig_01ABCDEFGHIJKL · its token sk-ant-oat01-T3stT3st…sgAA/, "the token's start and end, as claude.ai shows it");
  assert.doesNotMatch(kept, /q{20}/, "never the whole token");
  assert.match(kept, /<p class="setsaid" role="status">Saved\. Now wake it once/);
  assert.match(kept, /Not checked in yet/);
  assert.match(kept, /<details class="setkey"><summary>Change the task or its token<\/summary>/, "the steps fold away");
  assert.doesNotMatch(kept, /Next: the DJ presets/, "not before it has answered");
  const { CURATOR_SEEN_KEY } = await import("../services.js");
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() }));
  const seen = await (await go(e, "/setup/curator?woke=1", { cookie: me })).text();
  assert.match(seen, /Checked in at /);
  assert.match(seen, /Rung\. It wakes and checks in within a minute or two, and this page shows it when it does\. No need to stay: the checklist(&#39;|')s Curator row ticks too/);
  assert.match(seen, /<a class="sgo" href="\/setup\/endless">Next: the DJ presets<\/a>/);
  const failed = await (await go(e, "/setup/curator?woke=0", { cookie: me })).text();
  assert.match(failed, /<details class="setkey" open>/, "a failed ring opens the change form");
});

test("a curator saved before the house rang it for its jobs is switched on by its first wake", async () => {
  const e = await blank();
  const me = await claim(e);
  e.REQUEST_ROUTINE_ID = "trig_01ABCDEFGHIJKL";
  e.REQUEST_ROUTINE_TOKEN = "sk-ant-oat01-" + "b".repeat(60);
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).startsWith("https://api.anthropic.com/") ? Response.json({ type: "routine_fire" }) : inner(u, init);
  try {
    assert.match((await go(e, "/setup/curator/wake", { method: "POST", cookie: me })).headers.get("location"), /^\/setup\/curator\?woke=1&at=\d{13}#done$/);
  } finally { globalThis.fetch = inner; }
  const { withSettings } = await import("../settings.js");
  assert.equal((await withSettings(e, null)).AUTOFULFILL_ENABLED, "true");
});

// THE CURATOR ON CHATGPT (MC-31 6b, step 5): the same page offers ChatGPT's
// steps, the choice of one curator, and a test event.
test("the curator page offers ChatGPT: its plugin, its Work chat's note, its hourly check, and the choice", async () => {
  const { CHATGPT_CURATOR_NOTE, CHATGPT_HOURLY_NOTE } = await import("../programs.js");
  const doc = readFileSync(new URL("../../docs/install/curator-routine.md", import.meta.url), "utf8");
  assert.ok(doc.includes(CHATGPT_CURATOR_NOTE) && doc.includes(CHATGPT_HOURLY_NOTE), "the docs say the same notes");
  const e = await blank();
  const me = await claim(e);
  assert.match(await (await go(e, "/setup", { cookie: me })).text(), /Needs a paid Claude plan or ChatGPT Plus/);
  const claudePage = await (await go(e, "/setup/curator", { cookie: me })).text();
  assert.match(claudePage, /<a href="\/setup\/curator\?with=chatgpt">Set up ChatGPT as the curator<\/a>/);
  const page = await (await go(e, "/setup/curator?with=chatgpt", { cookie: me })).text();
  assert.match(page, /A ChatGPT Work chat/);
  assert.match(page, /<b>Plugins<\/b>, <b>Add<\/b>, <b>Add custom MCP server<\/b>/);
  assert.match(page, /<code class="setval">https:\/\/fmwax\.test\/mcp\/[A-Za-z0-9_-]{20,}<\/code>/, "the curator's address, the restricted door");
  assert.match(page, /Set <b>Authentication<\/b> to <b>None<\/b>/);
  assert.match(page, /Subscribe to the house\.work event of the curator plugin in this chat/);
  assert.match(page, /Also check every hour, as a scheduled task in this chat/);
  assert.match(page, /Keep your other fmwax plugin out of this chat/);
  assert.match(page, /Make ChatGPT this house(&#39;|')s curator/);
});

test("choosing ChatGPT: requests switch on, the page says whether a Work chat listens, and a test event checks it", async () => {
  const e = await blank();
  const me = await claim(e);
  const chose = await go(e, "/setup/curator/use", { method: "POST", form: { who: "chatgpt" }, cookie: me });
  assert.equal(chose.headers.get("location"), "/setup/curator?with=chatgpt&saved=1#done");
  const { withSettings } = await import("../settings.js");
  const live = await withSettings(e, null);
  assert.deepEqual([live.CURATOR, live.REQUESTS_ENABLED, live.AUTOFULFILL_ENABLED], ["chatgpt", "true", "true"]);
  const page = await (await go(e, "/setup/curator?saved=1", { cookie: me })).text();
  assert.match(page, /Saved: ChatGPT is this house(&#39;|')s curator/);
  assert.match(page, /No Work chat is listening/);
  assert.match(page, /<details class="setkey" open><summary>The steps at chatgpt\.com<\/summary>/, "the steps stay open until it listens");
  // Nobody listening: the test says so.
  assert.equal((await go(e, "/setup/curator/wake", { method: "POST", cookie: me })).headers.get("location"), "/setup/curator?with=chatgpt&woke=0#done");
  // A Work chat subscribes through the curator's door; the test reaches it.
  const agent = page.match(/https:\/\/fmwax\.test\/mcp\/([A-Za-z0-9_-]{20,})/)[1];
  const got = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (!String(u).startsWith("https://connectors.example.test/")) return inner(u, init);
    const body = JSON.parse(init.body);
    got.push(body);
    return body.type === "verification" ? Response.json({ challenge: body.challenge }) : new Response(null, { status: 200 });
  };
  try {
    const sub = await worker.fetch(new Request(`${ORIGIN}/mcp/${agent}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "events/subscribe", params: { name: "house.work", arguments: {},
        delivery: { mode: "webhook", url: "https://connectors.example.test/cb", secret: `whsec_${Buffer.alloc(32, 9).toString("base64")}` },
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }) }), await withSettings(e, null));
    assert.match((await sub.json()).result.id, /^sub_/);
    assert.match((await go(e, "/setup/curator/wake", { method: "POST", cookie: me })).headers.get("location"), /^\/setup\/curator\?with=chatgpt&woke=1&at=\d{13}#done$/);
    assert.deepEqual(got.filter((b) => !b.type).map((b) => b.data), [{ work_id: "setup-check", kind: "request", again: false }]);
  } finally { globalThis.fetch = inner; }
  const listening = await (await go(e, "/setup/curator", { cookie: me })).text();
  assert.match(listening, /A Work chat is listening/);
  assert.match(await (await go(e, "/setup", { cookie: me })).text(), /ChatGPT, woken by event/);
});

test("back to Claude: only with a task kept; then the house rings the task again", async () => {
  const e = await blank();
  const me = await claim(e);
  await go(e, "/setup/curator/use", { method: "POST", form: { who: "chatgpt" }, cookie: me });
  assert.equal((await go(e, "/setup/curator/use", { method: "POST", form: { who: "claude" }, cookie: me })).headers.get("location"),
    "/setup/curator?with=claude", "no task kept: Claude's steps");
  await go(e, "/setup/curator", { method: "POST", form: { routine: "trig_01ABCDEFGHIJKL", token: "sk-ant-oat01-" + "c".repeat(40) }, cookie: me });
  const { withSettings } = await import("../settings.js");
  assert.equal((await withSettings(e, null)).CURATOR, "claude", "saving a Claude task makes it the curator");
  await go(e, "/setup/curator/use", { method: "POST", form: { who: "chatgpt" }, cookie: me });
  const page = await (await go(e, "/setup/curator?with=chatgpt", { cookie: me })).text();
  assert.match(page, /Make the Claude task the curator again/);
  await go(e, "/setup/curator/use", { method: "POST", form: { who: "claude" }, cookie: me });
  assert.equal((await withSettings(e, null)).CURATOR, "claude");
});
