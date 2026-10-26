// THE HOUSE MARK (2026-10-22). The owner: "user needs a quick way to see if
// the helper is active or not … the house icon is fine", and option 2 of the
// canvas "The Helper, On Screen": a round house beside the "?" on every tab,
// its window lit while the home helper is heard, dark and grey when it is
// not; tapped, a card says which WiiMs answer it or when it was last heard.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import worker from "../worker.js";
import { helperSays, helperMark, inlineFn } from "../programs.js";
import { makeEnv, installFetch } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const SECRET = "helper-secret-000000000000";

function env({ helper = true } = {}) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  e.WIIM_SPEAKERS = JSON.stringify({ "Pro Plus": "192.168.4.45", Ultra: "192.168.4.69" });
  e.OPENAI_API_KEY = "sk-test";
  if (helper) e.HELPER_SECRET = SECRET;
  return e;
}
const send = (e, body) => worker.fetch(new Request("https://x.test/helper/reading", {
  method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
  body: JSON.stringify(body) }), e);
const page = async (e, path) => (await worker.fetch(new Request(`https://x.test${path}`), e)).text();
// Every tab, by its title.
const TABS = [["Speakers", `/buttons/${KEY}/wiim`], ["DJs", `/buttons/${KEY}/djs`], ["Loaded", `/buttons/${KEY}`],
  ["Shelf", `/notes/${KEY}`], ["Talk", `/buttons/${KEY}/talk`]];
const markOf = (html) => html.match(/<details class="help pagehelp hmark[^"]*"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? null;

test("its words: which WiiMs answer while on, when it was last heard while off, nothing in a house with none", () => {
  const on = (speakers) => helperSays({ helper: "on", lan: { at: 1, speakers } });
  assert.deepEqual(on({ "Pro Plus": { state: "play" }, Ultra: { state: "stop" } }),
    { on: true, label: "Home helper on", title: "Home helper on.", line: "The Pro Plus and the Ultra answer it.",
      more: "Tidal, the radio and the archive show on Speakers and the bar." });
  assert.equal(on({ "Pro Plus": { state: "idle" } }).line, "The Pro Plus answers it.");
  assert.equal(on({ "Pro Plus": { state: "play" }, Ultra: { state: "unreachable" } }).line,
    "The Pro Plus answers it; the Ultra does not.");
  assert.equal(on({ "Pro Plus": { state: "unreachable" }, Ultra: { state: "unreachable" } }).line, "No WiiM answers it.");
  assert.deepEqual(helperSays({ helper: "off", helperHeard: "at 21:14" }),
    { on: false, label: "Home helper off", title: "Home helper off.", line: "Last heard at 21:14.",
      more: "Only Spotify shows on Speakers and the bar. The helper works while its computer is on and awake at home." });
  assert.equal(helperSays({ helper: "off" }).line, "Not heard from yet.");
  assert.equal(helperSays({}), null);
  assert.equal(helperSays(null), null);
  // The bar's script carries its own copy, and it says the same.
  const o = { helper: "on", lan: { at: 1, speakers: { "Pro Plus": { state: "play" }, Ultra: { state: "unreachable" } } } };
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(inlineFn(helperSays))(o))), helperSays(o));
});

test("the mark: lit, dark, none in a house with no helper, and hidden until the bar knows", () => {
  const lit = helperMark({ helper: "on", lan: { at: 1, speakers: { "Pro Plus": { state: "play" } } } });
  assert.match(lit, /^<details class="help pagehelp hmark" name="pagehead" data-hmark><summary class="helpq" aria-label="Home helper on"><svg[^>]*>[\s\S]*class="hwin"/);
  assert.match(lit, /<b class="hm1">Home helper on\.<\/b> <span class="hm2">The Pro Plus answers it\.<\/span>/);
  assert.match(helperMark({ helper: "off", helperHeard: "at 21:14" }), /class="help pagehelp hmark off"[\s\S]*aria-label="Home helper off"[\s\S]*Last heard at 21:14\./);
  assert.equal(helperMark({}), "", "a house that never ran a helper has no mark");
  assert.match(helperMark(null), /data-hmark hidden>/, "no answer yet: hidden, for the bar's script");
  assert.match(helperMark(undefined), /data-hmark hidden>/);
});

test("on every tab, beside the ?: lit while the helper is heard, dark with the time it was last heard once it stops", async () => {
  const e = env();
  const f = installFetch();
  try {
    await send(e, { speakers: [{ name: "Pro Plus", state: "play", source: "Tidal", track: "Put It On The Line", artists: "Lyn Collins" },
      { name: "Ultra", state: "stop" }] });
    for (const [title, path] of TABS) {
      const html = await page(e, path);
      const mark = markOf(html);
      assert.ok(mark, `${title}: a mark`);
      assert.match(mark, /^<details class="help pagehelp hmark" name="pagehead" data-hmark>/, `${title}: lit, shown at paint`);
      assert.match(mark, /The Pro Plus and the Ultra answer it\./, title);
      // After the title and before the "?" (the Shelf's after its filter).
      assert.ok(html.indexOf(`<h1>${title}</h1>`) < html.indexOf(mark), `${title}: after the title`);
      assert.match(html.slice(html.indexOf(mark) + mark.length), /^\s*<details class="help pagehelp" name="pagehead"><summary class="helpq" aria-label="How /, `${title}: the ? next`);
    }
    // Three minutes with no word: off, and when it was last heard.
    const doc = JSON.parse(e.STATION.endless.helper);
    doc.at -= 3 * 60_000;
    e.STATION.endless.helper = JSON.stringify(doc);
    const playing = await (await worker.fetch(new Request(`https://x.test/buttons/${KEY}/playing`), e)).json();
    assert.equal(playing.helper, "off");
    assert.match(playing.helperHeard, /^(at|on \w{3} at) \d{2}:\d{2}$/);
    for (const [title, path] of TABS) {
      const mark = markOf(await page(e, path));
      assert.match(mark, /^<details class="help pagehelp hmark off" name="pagehead" data-hmark>/, `${title}: dark`);
      assert.match(mark, /aria-label="Home helper off"[\s\S]*Last heard (at|on \w{3} at) \d{2}:\d{2}\./, title);
    }
  } finally { f.restore(); }
});

test("a house with no helper shows no mark on any tab", async () => {
  const e = env({ helper: false });
  const f = installFetch();
  try {
    for (const [title, path] of TABS) assert.equal(markOf(await page(e, path)), null, title);
  } finally { f.restore(); }
});

test("the bar's script sets the mark from every answer that speaks of the helper, and keeps the time through a pause", async () => {
  const e = env();
  const f = installFetch();
  try {
    const html = await page(e, `/buttons/${KEY}/djs`);
    assert.match(html, /function hmark\(raw\) \{/);
    assert.match(html, /hmark\(raw\);\s*var o = view\(raw\);/, "on every paint");
    assert.match(html, /"helper", "helperHeard", "lan"/, "the pause's quiet answer keeps when it was last heard");
  } finally { f.restore(); }
});
