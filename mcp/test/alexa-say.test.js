// WHAT TO SAY (alexa-say.js): every maple crate example the help page shows,
// read through the door's own reader with a house like this one, gives the
// reading the page says it does. A row the reader reads otherwise fails here,
// so the page cannot drift from the skill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { alexaHeard } from "../alexa.js";
import { alexaRoomId, djIntentName, djPlayIntentName } from "../alexa-model.js";
import { sayExamples, wordsOf } from "../alexa-say.js";
import { renderSay } from "../programs.js";
import { makeEnv, TWO_REQUESTS } from "./harness.js";

const SKILL = "amzn1.ask.skill.00000000-test";
const ROOMS = ["Pro Plus", "Ultra", "Everywhere", "Master Bedroom", "Dining Room", "Living Room", "Office", "Office2", "Den", "iPhone"];
const pid = (n) => `${"A".repeat(21)}${n}`;
const ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
  { button: 4, dj: "dr-funkenstein", playlist: pid(4) }, { button: 5, dj: "hank", playlist: pid(5) },
  { button: 6, dj: "sessions", playlist: pid(6) }, { button: 7, dj: "americana", playlist: pid(7) },
  { button: 8, dj: "soul", playlist: pid(8) }, { button: 9, dj: "vibe", playlist: pid(9) },
  { button: 3, lane: true, playlist: pid(3) }] });
function env(extra = {}) {
  const e = makeEnv();
  Object.assign(e, { ALEXA_SKILL_ID: SKILL, ROOM_DEVICES: JSON.stringify(ROOMS), DEFAULT_DEVICE: "Pro Plus",
    REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true", ENDLESS, HELPER_SECRET: "home-key",
    WIIM_SPEAKERS: JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" }),
    BUTTONS: JSON.stringify(TWO_REQUESTS) }, extra);
  return e;
}
const matched = (value, id) => ({ value, resolutions: { resolutionsPerAuthority: [
  { authority: "x", status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: value } }] }] } });
// The request Amazon would send for a row's `ask`.
function requestOf(ask) {
  const slots = {};
  let name = ask.intent;
  if (ask.dj) name = djIntentName(ask.dj);
  if (ask.play) name = djPlayIntentName(ask.play);
  if (ask.words) slots.words = { name: "words", value: ask.words };
  if (ask.when) slots.when = { name: "when", ...matched(ask.when, ask.when) };
  if (ask.number != null) slots.number = { name: "number", value: String(ask.number) };
  if (ask.room) slots.room = { name: "room", ...matched(ask.room.toLowerCase(), alexaRoomId(ask.room)) };
  return { version: "1.0", context: { System: { application: { applicationId: SKILL } } },
    request: { type: "IntentRequest", requestId: "r", timestamp: new Date().toISOString(), intent: { name, slots } } };
}
// The reading's fields the page names, wherever the reader keeps them.
function check(e, ask, expect, what) {
  const h = alexaHeard(requestOf(ask), e);
  const r = h.reading ?? {};
  const got = { kind: h.kind, device: h.device ?? r.device ?? null, words: r.words ?? null, minutes: r.minutes ?? null,
    avoid: r.avoid ?? null, keep: r.keep ?? null, when: h.when ?? r.when ?? null, preset: h.preset ?? null };
  for (const [k, v] of Object.entries(expect)) assert.deepEqual(got[k], v, `${what}: ${k} (said back: ${h.say})`);
  return h;
}

test("every example on the What to say page is read the way the page says", () => {
  const e = env();
  const { sections, notes } = sayExamples(e);
  const rows = sections.flatMap((s) => s.rows);
  assert.ok(rows.length >= 20, `${rows.length} rows`);
  for (const row of rows) check(e, row.ask, row.expect, row.said);
  for (const n of notes) for (const c of n.checks) check(e, c.ask, c.expect, `${n.title}: ${c.ask.words}`);
  // The words a DJ row tests are the sentence it shows.
  for (const row of rows.filter((x) => x.ask.dj)) {
    assert.equal(wordsOf(row.said), wordsOf(`…for ${row.said.replace(/^…for /, "")}`));
    assert.ok(wordsOf(row.said).endsWith(row.ask.words ?? ""), row.said);
  }
});

test("the examples are this house's own: its DJs, presets and speakers", () => {
  const { sections } = sayExamples(env());
  const said = sections.flatMap((s) => s.rows.map((r) => `${r.said} → ${r.result}`)).join("\n");
  assert.match(said, /…for Hank → Hank's preset 5 starts on the Pro Plus\./);
  assert.match(said, /…for Sessions, acoustic grunge, endless → Preset 6 starts, and Sessions steers toward acoustic grunge/);
  assert.match(said, /…for Deep Dive on Nick Drake, endless → Preset 3 gets a new opening set/);
  assert.match(said, /…to play preset 5 on the Master Bedroom → An Echo has no keys/);
  assert.match(said, /…to play preset 5 → With the home helper on, the Pro Plus's key 5 is pressed/);
  // No curator taking asks: no set rows, and no keep.
  const bare = sayExamples(env({ AUTOFULFILL_ENABLED: undefined })).sections.flatMap((s) => s.rows.map((r) => r.said));
  assert.ok(!bare.some((s) => /acoustic grunge, on the|keep this set/.test(s)), bare.join("\n"));
});

test("the page: Talk and maple crate, every example with what it does", () => {
  const e = env();
  const ex = sayExamples(e);
  const html = renderSay({ base: "/buttons/k", talk: true, alexa: { acts: true }, examples: ex });
  assert.match(html, /<h1>What to say<\/h1>/);
  assert.match(html, /Alexa, ask maple crate/);
  for (const row of ex.sections.flatMap((s) => s.rows)) {
    assert.ok(html.includes(row.said.replace(/'/g, "&#39;").replace(/"/g, "&quot;")), row.said);
  }
  assert.match(html, /Hold the button/);
  // A house with Talk and no skill: only Talk.
  const talkOnly = renderSay({ base: "/buttons/k", talk: true, alexa: null, examples: ex });
  assert.doesNotMatch(talkOnly, /maple crate/i);
  // Talk's presses (MC-39) only where there are WiiMs to press.
  assert.doesNotMatch(talkOnly, /Press 12 on the Pro Plus/);
  const pressing = renderSay({ base: "/buttons/k", talk: true, alexa: null, examples: ex, presses: true });
  assert.match(pressing, /<q>Press 12 on the Pro Plus<\/q>/);
  assert.match(pressing, /<q>Put on Radio Paradise<\/q>/);
  assert.match(pressing, /<q>Which EQ is the Pro Plus on\?<\/q>/);
  assert.match(pressing, /<q>What's playing on the Pro Plus\?<\/q>/);
  assert.match(talkOnly, /<q>Move it to the Ultra<\/q>/, "the move is everyone's");
  assert.doesNotMatch(talkOnly, /Which EQ/);
});

// MAPLE CRATE'S BOX ON THE TALK TAB (the owner, 2026-11-08: "on + last heard").
import worker from "../worker.js";
import { alexaGate, heardWords } from "../alexa.js";
import { alexaSigned } from "../alexa-sign.js";
import { crateWhen } from "../programs.js";
import { station } from "../station.js";

const KEY = "abcdefabcdefabcdefabcdef";
const SECRET = "alexa-secret-0000000000000000";
function house(extra = {}) {
  return env({ PROGRAM_LIBRARY_KEY: KEY, HOUSE_TZ: "America/Los_Angeles", OPENAI_API_KEY: "sk-test",
    ALEXA_SECRET: SECRET, ALEXA_ACTS: undefined, ...extra });
}
const page = (e, path) => worker.fetch(new Request(`https://x.test${path}`), e);
let seq = 0;
const said = async (e, ask) => {
  const body = requestOf(ask);
  body.request.requestId = `amzn1.echo-api.request.box${++seq}`;
  const raw = JSON.stringify(body);
  return worker.fetch(new Request(`https://x.test/alexa/${SECRET}`, { method: "POST",
    headers: { "content-type": "application/json", "signature-256": "x", signaturecertchainurl: "x" }, body: raw }), e);
};

test("what maple crate heard, in words: the DJ and the words as Alexa passed them on", () => {
  const e = house();
  const h = (ask) => heardWords(alexaHeard(requestOf(ask), e));
  assert.equal(h({ dj: "deep-dive", words: "frank Sinatra and Cupid" }), "Deep Dive frank Sinatra and Cupid");
  assert.equal(h({ intent: "PresetIntent", number: 4, room: "Pro Plus" }), "preset 4 pro plus");
  assert.equal(h({ intent: "SteerToIntent", words: "toward stax" }), "steer toward stax");
  assert.equal(h({ intent: "MoveIntent", room: "Ultra" }), "send the music to ultra");
  assert.equal(h({ intent: "NowIntent" }), "what's playing");
  assert.equal(heardWords({ kind: "ended" }), null);
});

test("the Talk tab: the box says on or dry run, the last three heard with what was said, and links to What to say", async () => {
  alexaGate.signed = async () => ({ ok: true });
  try {
    const e = house();
    let html = await (await page(e, `/buttons/${KEY}/talk`)).text();
    assert.match(html, /<section class="block crate"[\s\S]*Maple crate <span class="crstate dry">Dry run<\/span>[\s\S]*Nothing heard yet\.[\s\S]*href="\/buttons\/abcdefabcdefabcdefabcdef\/say">What to say<\/a>/);
    assert.match(html, /<a href="\/buttons\/abcdefabcdefabcdefabcdef\/say">What to say<\/a>, with examples for both\./);
    for (const ask of [{ dj: "hank" }, { intent: "PresetIntent", number: 4, room: "Pro Plus" },
      { dj: "deep-dive", words: "frank Sinatra and Cupid" }, { intent: "NowIntent" }]) assert.equal((await said(e, ask)).status, 200);
    html = await (await page(e, `/buttons/${KEY}/talk`)).text();
    const items = [...html.matchAll(/<li><time[^>]*>([^<]*)<\/time><span><q>([^<]*)<\/q>(?:<span class="crsaid">([^<]*)<\/span>)?/g)];
    assert.deepEqual(items.map((m) => m[2]), ["what&#39;s playing", "Deep Dive frank Sinatra and Cupid", "preset 4 pro plus"], "newest first, three");
    assert.match(items[1][3], /^I&#39;d ask Deep Dive for frank sinatra and cupid/);
    assert.match(items[0][1], /^\d\d:\d\d$/);
    // Acting: "On".
    html = await (await page(house({ ALEXA_ACTS: "on" }), `/buttons/${KEY}/talk`)).text();
    assert.match(html, /<span class="crstate">On<\/span>/);
    // A house without the skill: no box, and the help links What to say alone.
    html = await (await page(house({ ALEXA_SECRET: undefined }), `/buttons/${KEY}/talk`)).text();
    assert.doesNotMatch(html, /class="block crate"/);
    assert.match(html, /What to say<\/a>, with examples\./);
  } finally { alexaGate.signed = alexaSigned; }
});

test("What to say, at its own address: for a house with Talk or the skill, and nobody else", async () => {
  const ok = await page(house(), `/buttons/${KEY}/say`);
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /<h1>What to say<\/h1>[\s\S]*<h2 id="say-talk">Talk<\/h2>[\s\S]*Maple crate <span class="sstate dry">Dry run<\/span>/);
  assert.match(html, /class="tab[^"]*"[^>]*aria-current="page"[^>]*>[\s\S]*?Talk/);
  assert.equal((await page(house(), `/buttons/wrongwrongwrongwrong/say`)).status, 404);
  assert.equal((await page(house({ OPENAI_API_KEY: undefined, ALEXA_SECRET: undefined }), `/buttons/${KEY}/say`)).status, 404);
  const skillOnly = await (await page(house({ OPENAI_API_KEY: undefined }), `/buttons/${KEY}/say`)).text();
  assert.doesNotMatch(skillOnly, /<h2 id="say-talk">/);
  assert.match(skillOnly, /Ask the house by voice, on the Echos\./);
});

test("its time: the hour today, the day too before, in the house's zone", () => {
  const now = Date.parse("2026-11-09T03:40:00Z"); // 19:40 on Nov 8 in San Francisco
  assert.equal(crateWhen(Date.parse("2026-11-09T03:35:00Z"), "America/Los_Angeles", now), "19:35");
  assert.equal(crateWhen(Date.parse("2026-11-08T03:35:00Z"), "America/Los_Angeles", now), "Nov 7, 19:35");
});

test("the ledger keeps the newest twenty heard, newest first", async () => {
  const e = house();
  for (let i = 1; i <= 23; i++) await station(e, "alexa-heard", { heard: `ask ${i}`, said: "ok", now: i });
  const rows = (await station(e, "alexa-heard-list", { limit: 20 })).rows;
  assert.equal(rows.length, 20);
  assert.equal(rows[0].heard, "ask 23");
  assert.equal(rows[19].heard, "ask 4");
  assert.equal((await station(e, "alexa-heard", { heard: "  " })).ok, false);
});
