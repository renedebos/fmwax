// EACH HOUSE ITS OWN HOUSE RULES (the owner, 2026-10-18: B from the canvas,
// "role on every key", with the rules folded). docs/house-rules.md's marks
// make the page fit the house reading it: `{if word}`, `{blank}`, `(since …)`,
// a `>` summary per fold and a Questions card; the presets and the numbers
// come from the house's settings (rulesFacts).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { rulesDoc } from "../programs.js";
import { presetRun } from "../house.js";
import { RULES_MD } from "../rules.js";
import { makeEnv, installFetch } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const KEY = "rulesrulesrulesrules";
const PL = (c) => c.repeat(21) + "1";

// The owner's house as it stands: Requests on 1 (Spotify) and 2 (Tidal), the
// guest DJ on 3, five house DJs, the archive on 6, Talk, and its history.
function ownersHouse() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.OPENAI_API_KEY = "sk-test";
  e.RULES_HISTORY = "on";
  e.HOUSE_TZ = "America/Los_Angeles";
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: PL("A"), catalog: "spotify" },
    { button: 2, guest: true, live: true, name: "Requests · Tidal", playlist: "00000000-0000-4000-8000-000000000011", catalog: "tidal" },
    { button: 6, archive: true },
  ]);
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 4, dj: "dr-funkenstein", playlist: PL("B") }, { button: 5, dj: "hank", playlist: PL("C") },
    { button: 7, dj: "americana", playlist: PL("D") }, { button: 8, dj: "soul", playlist: PL("E") },
    { button: 9, dj: "vibe", playlist: PL("F") }, { button: 3, lane: true, playlist: PL("G") }] });
  return e;
}
// A fresh house from the forum install: Spotify only, Requests on 1, Hank on
// 2, the guest DJ on 3, no Talk, no helper, no history.
function freshHouse() {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.DEFAULT_DEVICE = "Living Room";
  e.ROOM_DEVICES = JSON.stringify(["Living Room", "Kitchen"]);
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: PL("A"), catalog: "spotify" }]);
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 2, dj: "hank", playlist: PL("B") }, { button: 3, lane: true, playlist: PL("C") }] });
  return e;
}
async function page(e) {
  const f = installFetch();
  try {
    const res = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/rules`), e);
    assert.equal(res.status, 200);
    return await res.text();
  } finally { f.restore(); }
}
const textOf = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>"))
  .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ");
const keysOf = (html) => [...html.matchAll(/<label class="rkey ([a-z]+)" for="rk(\d+)"><span class="rkn">\d+<\/span><span class="rkname">([^<]*)<\/span><span class="rktag">([^<]*)<\/span>/g)]
  .map((m) => `${m[2]} ${m[4]} ${m[3]}`);

test("the marks: a fold per section, its summary, {if} and {if no}, blanks, dates only with history, questions", () => {
  const md = [
    "# T", "Opening words, about editing.",
    "## Questions", "- **Why?** Because {default speaker}.\n- {if talk} **Talk?** Yes.\n- {if no talk} **No Talk?** Ask the owner.",
    "## Plain", "> {if helper} With the helper.\n> Without it.",
    "One **two** [`X`] (since 2026-10-16).",
    "- {if tidal} Tidal moves.\n- Spotify moves\n  on.\n- {if no tidal} No Tidal here.",
    "{if archive} The archive.",
    "{nobody knows} stays.",
    "## Talk {if talk}", "> Talk.", "Sixty.",
    "## Gone {if no endless}", "Only without endless.",
  ].join("\n\n");
  const none = rulesDoc(md, { tags: {}, blanks: { "default speaker": "Living Room" } });
  assert.deepEqual(none.questions.map((q) => q.q), ["Why?", "No Talk?"]);
  assert.equal(none.questions[0].a, "Because Living Room.");
  assert.deepEqual(none.sections.map((s) => s.title), ["Plain", "Gone"], "Talk is only where there is Talk");
  const plain = none.sections[0];
  assert.equal(plain.summary, "Without it.", "the first > line that holds");
  assert.match(plain.body[0], /^<p>One <b>two<\/b>\.<\/p>$/, "the bracket note and the date both gone");
  assert.equal(plain.body[1], "<ul><li>Spotify moves on.</li><li>No Tidal here.</li></ul>");
  assert.ok(!plain.body.some((b) => /archive/.test(b)));
  assert.match(plain.body.at(-1), /\{nobody knows\} stays/, "an unknown blank shows, so a slip is seen");
  const all = rulesDoc(md, { tags: { talk: true, helper: true, tidal: true, archive: true, endless: true, history: true }, blanks: {} });
  assert.deepEqual(all.questions.map((q) => q.q), ["Why?", "Talk?"]);
  assert.deepEqual(all.sections.map((s) => s.title), ["Plain", "Talk"]);
  assert.equal(all.sections[0].summary, "With the helper.");
  assert.match(all.sections[0].body[0], /One <b>two<\/b> <span class="rsince">since 16 Oct<\/span>\./);
  assert.equal(all.sections[0].body[1], "<ul><li>Tidal moves.</li><li>Spotify moves on.</li></ul>");
  assert.match(all.sections[0].body[2], /The archive\./);
});

test("docs/house-rules.md leaves no mark unread, in a house with everything and in one with nothing", () => {
  const blanks = { "default speaker": "Pro Plus", "requests presets": "1", "guest preset": "3", "house presets": "4, 5",
    "endless presets": "3, 4, 5", "archive preset": "6", "archive asks": "a song or a show", "talk minutes": "60", "time zone": "Pacific Time",
    "notes default": "short notes" };
  const words = ["requests", "tidal", "endless", "housedj", "guest", "newdj", "archive", "talk", "helper", "history", "lastfm", "chatgpt"];
  for (const on of [true, false]) {
    const doc = rulesDoc(RULES_MD, { tags: Object.fromEntries(words.map((w) => [w, on])), blanks });
    const out = doc.sections.map((s) => `${s.summary ?? ""} ${s.body.join(" ")}`).join(" ") + doc.questions.map((q) => q.q + q.a).join(" ");
    assert.ok(!/\{[a-z ]+\}/.test(out), `no mark left (${on ? "everything" : "nothing"}): ${out.match(/\{[a-z ]+\}/)?.[0]}`);
    assert.ok(!/\(since \d{4}/.test(out), "no raw date");
    assert.ok(doc.sections.every((s) => s.summary), "every fold has its summary line");
    assert.ok(doc.questions.length >= 5);
  }
});

test("a range only for one unbroken run of three or more", () => {
  assert.equal(presetRun([10, 11, 12]), "10–12");
  assert.equal(presetRun([12, 4, 5, 6, 7, 8, 9, 10, 11]), "4–12");
  assert.equal(presetRun([4, 5, 7, 8, 9]), "4, 5, 7, 8, 9");
  assert.equal(presetRun([1, 2]), "1, 2");
});

test("the owner's house: every key wears its kind, Talk and Tidal are there, and so are the dates", async () => {
  const html = await page(ownersHouse());
  assert.deepEqual(keysOf(html), [
    "1 Requests Spotify", "2 Requests Tidal", "3 Guest DJ Nobody yet", "4 House DJ Dr. Funkenstein", "5 House DJ Hank",
    `6 Archive ${ARCHIVE.name}`, "7 House DJ Americana", "8 House DJ Soul", "9 House DJ Vibe",
    "10 Yours WiiM app", "11 Yours WiiM app", "12 Yours WiiM app"]);
  assert.match(html, /<input type="radio" name="rk" id="rk4" value="4" checked>/, "the first house DJ is the one said first");
  assert.match(html, /\.rules \.rpre:has\(#rk4:checked\) #rd4\{display:flex\}/);
  assert.match(html, /<p class="rdeye">Preset 4 · House DJ<\/p><p class="rdtitle">Dr\. Funkenstein<\/p><p class="rdtext">Always Dr\. Funkenstein, endless, until you put another DJ on 4 from their page\. Adds 45 minutes when 30 are left\.<\/p>/);
  assert.match(html, /<b>House DJs<\/b> <i>· 4, 5, 7, 8, 9<\/i>/);
  assert.match(html, /<b>Requests<\/b> <i>· 1, 2<\/i><\/span><span>The newest set you asked any DJ for: 1 on Spotify, 2 on Tidal\./);
  assert.match(html, /<b>Yours<\/b> <i>· 10–12<\/i>/);
  assert.match(html, /<li><b>12<\/b><span>endless runs a day: top-ups, fresh starts, steers<\/span><\/li>/);
  assert.match(html, /<li><b>60<\/b><span>minutes of Talk a day<\/span><\/li>/);
  assert.match(html, /<span class="rfh">Talk<\/span><span class="rfs">60 minutes a day\. The day starts at midnight, Pacific Time\.<\/span>/);
  assert.match(html, /<span class="rfs">It goes on 1 for Spotify or 2 for Tidal and replaces what was there\.<\/span>/);
  assert.match(html, /class="rsince">since \d+ [A-Z][a-z]{2}</, "this house keeps its history");
  assert.match(html, /Six DJs became three/);
  assert.ok(!/\{[a-z ]+\}/.test(textOf(html)), "no mark left");
  assert.ok(!/<script/.test(html.slice(html.indexOf('aria-label="The presets"'), html.indexOf('aria-label="In numbers"'))), "the presets need no script");
});

test("a fresh house: Spotify only, Hank on 2, the guest DJ on 3, no Talk, no dates", async () => {
  const html = await page(freshHouse());
  assert.deepEqual(keysOf(html).slice(0, 4), ["1 Requests Spotify", "2 House DJ Hank", "3 Guest DJ Nobody yet", "4 Yours WiiM app"]);
  assert.equal(keysOf(html).length, 12);
  assert.match(html, /id="rk2" value="2" checked>/);
  assert.match(html, /<b>House DJ<\/b> <i>· 2<\/i><\/span><span>One DJ, endless\./, "one house DJ, said as one");
  assert.match(html, /<b>Yours<\/b> <i>· 4–12<\/i>/);
  const text = textOf(html);
  assert.ok(!/Tidal/.test(text), "no Tidal anywhere");
  assert.ok(!/minutes of Talk/.test(text) && !html.includes('<span class="rfh">Talk</span>'), "no Talk number and no Talk fold");
  assert.match(text, /Why is there no Talk tab\?/);
  assert.match(text, /with nothing playing it uses the Living Room/);
  assert.match(text, /Other services and the radio/, "the house without a helper is told what one adds");
  assert.ok(!/since \d/.test(text), "no dates in a house without its history");
  assert.ok(!/Six DJs became three/.test(text));
  assert.ok(!text.includes(ARCHIVE.name), "no archive");
  assert.ok(!/\{[a-z ]+\}/.test(text), "no mark left");
});
