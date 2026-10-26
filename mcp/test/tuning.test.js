// TUNING A DJ (MC-32 2a, tasks/mc32-dj-tuning.md): the dials, their words,
// the rule the house counts, and the door that keeps them.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { PERSONAS, TUNE } from "../djs.js";
import { cleanTuning, dialsOf, readTuning, thisYear, tunedSpacing, tuningFromForm, tuningSummary, tuningWith, tuningWords } from "../tuning.js";
import { withSettings } from "../settings.js";
import { setBreaks } from "../setcheck.js";
import { installFetch, makeEnv, makeHouseStore } from "./harness.js";

const { callTool, findDj } = __test;
const KEY = "abcdefabcdefabcdefabcdef";
const tuned = (o) => ({ DJ_TUNING: JSON.stringify(o) });

test("every DJ with dials is a DJ, and every dial stays inside what the owner chose", () => {
  for (const [key, dials] of Object.entries(TUNE)) {
    assert.ok(PERSONAS[key], `${key} is a DJ`);
    for (const d of dialsOf(key)) {
      if (d.id === "years") { assert.ok(d.track[0] < d.track[1]); continue; }
      assert.ok(d.stops.includes(d.own), `${key}'s ${d.id} has its own stop among its stops`);
    }
    assert.ok(dials.length >= 3 && dials.length <= 4, `${key} has three or four dials`);
  }
  // The owner's word, 2026-10-23: Dr. Funkenstein may go up to half.
  assert.deepEqual(dialsOf("dr-funkenstein").find((d) => d.id === "hits").stops, ["none", "few", "half"]);
  // "now" is this year, so the track never stops in the past.
  assert.equal(dialsOf("hank").find((d) => d.id === "years").track[1], thisYear());
  // No empty slots: Vibe's mood, Deep Dive's career, the Librarian's notes.
  assert.ok(dialsOf("vibe").some((d) => d.id === "mood"));
  assert.deepEqual(dialsOf("deep-dive").map((d) => d.id), ["career", "hits", "live", "order"]);
  assert.deepEqual(dialsOf("the-librarian").map((d) => d.id), ["notes", "hits", "same", "order"]);
});

test("only a moved dial is kept: its own stop, a stop outside the DJ and years off the track are dropped", () => {
  assert.deepEqual(cleanTuning("soul", { hits: "mostly", same: "any", years: [1959, 1979] }), {});
  assert.deepEqual(cleanTuning("soul", { hits: "none", years: [1950, 1970], stay: "nowhere" }), {});
  assert.deepEqual(cleanTuning("soul", { hits: "few", years: [1966, 1970], same: "rarely" }),
    { years: [1966, 1970], hits: "few", same: "rarely" });
  assert.deepEqual(cleanTuning("soul", { years: [1970, 1966] }), {});
  // Notes start on the house's default.
  assert.deepEqual(cleanTuning("the-librarian", { notes: "short" }), {});
  assert.deepEqual(cleanTuning("the-librarian", { notes: "short" }, { REQUEST_NOTES: "long" }), { notes: "short" });
  // What the store holds is cleaned on the way out too.
  assert.deepEqual(readTuning(tuned({ soul: { hits: "few", bogus: 1 }, nobody: { hits: "few" } })), { soul: { hits: "few" } });
  assert.deepEqual(readTuning({ DJ_TUNING: "not json" }), {});
});

test("the words: none for an untuned DJ, one counted line per moved dial under a head that says what wins", () => {
  assert.equal(tuningWords({}, "soul"), null);
  const w = tuningWords(tuned({ soul: { years: [1966, 1970], hits: "few", same: "rarely", stay: "wander" } }), "soul");
  assert.match(w, /^THE LISTENER'S TUNING FOR SOUL/);
  assert.match(w, /REPLACES what the brief says on that point, even where the brief says never/);
  assert.match(w, /words in a request still win/);
  assert.match(w, /YEARS: only music recorded from 1966 to 1970/);
  // A hit said once and counted (the owner, 2026-10-24: "tighten the hits selection").
  assert.match(w, /HITS: a few, counted\. A hit is any record that reached a national chart, pop or R&B, in the US or the UK, or an act's best-known song\. At most 3 in an hour of 16 to 18 songs, so at most 2 in a 45-minute batch; every other song never charted/);
  assert.match(w, /no act more than once an hour/);
  assert.match(w, /STAY IN SOUL: follow the music\. .*8 or 9 songs in an hour/);
  assert.match(tuningWords(tuned({ "dr-funkenstein": { hits: "half" } }), "dr-funkenstein"), /HITS: about half, counted\. .*8 or 9 in an hour/);
  assert.match(tuningWords(tuned({ genre: { stay: "mostly" } }), "genre"), /STAY IN THE GENRE ASKED FOR: mostly/);
  assert.match(tuningWords(tuned({ vibe: { mood: "late" } }), "vibe"), /MOOD: always THE SMALL HOURS, whatever the hour/);
  assert.match(tuningWords(tuned({ "deep-dive": { career: "early", live: "lots", order: "order" } }), "deep-dive"),
    /CAREER: the early years only[\s\S]*LIVE TAKES: lots[\s\S]*ORDER: in order/);
  assert.match(tuningWords(tuned({ "the-librarian": { hits: "mostly" } }), "the-librarian"), /LANDMARKS: mostly/);
  assert.match(tuningWords(tuned({ gatefold: { hits: "deep" } }), "gatefold"), /ALBUMS: deep/);
  // Notes is the Ask form's default, nothing to curate by.
  assert.equal(tuningWords(tuned({ "the-librarian": { notes: "long" } }), "the-librarian"), null);
  assert.equal(tuningSummary(tuned({ soul: { years: [1966, 1970], hits: "few", same: "rarely" } }), "soul"),
    "1966–1970, a few hits, rarely the same artist");
});

test("same artist, tuned, is the rule the house counts; the DJ's other rules stay", () => {
  const soul = { key: "soul", spacing: PERSONAS.soul.spacing };
  assert.equal(tunedSpacing({}, soul), PERSONAS.soul.spacing);
  const rarely = tunedSpacing(tuned({ soul: { same: "rarely" } }), soul);
  assert.equal(rarely.artistRun, 1);
  assert.equal(rarely.artistPerHour, 1);
  assert.equal(rarely.oneArtistSets, true, "an hour of one artist asked of Soul still passes");
  assert.match(rarely.say, /once an hour \(the listener's tuning\)/);
  // "Any" is Soul's own stop: nothing is sent, and its own two-in-a-row rule stands.
  assert.equal(tunedSpacing(tuned({ soul: { same: "any" } }), soul), PERSONAS.soul.spacing);
  // Genre's own is "sometimes": moved to "any", its artist rules go.
  assert.equal(tunedSpacing(tuned({ genre: { same: "any" } }), { key: "genre", spacing: PERSONAS.genre.spacing }), null);
  const hank = { key: "hank", spacing: PERSONAS.hank.spacing ?? null };
  const t = (lead, i) => ({ uri: `spotify:track:${i}`, lead, title: `Song ${i}`, album: `A${i}`, ms: 200000 });
  const set = [t("Lee Fields", 1), t("Lee Fields", 2), t("Durand Jones", 3)];
  assert.equal(setBreaks(set, tunedSpacing({}, hank)).length, 0);
  assert.ok(setBreaks(set, tunedSpacing(tuned({ hank: { same: "sometimes" } }), hank)).length > 0);
});

test("the form's fields become dials, and the store holds only tuned DJs", () => {
  const f = new FormData();
  f.set("years", "1966-1970"); f.set("hits", "few"); f.set("same", "any"); f.set("stay", "mostly"); f.set("nope", "x");
  assert.deepEqual(tuningFromForm("soul", f), { years: [1966, 1970], hits: "few" });
  assert.equal(tuningWith({}, "soul", {}), null);
  const one = tuningWith({}, "soul", { hits: "few" });
  assert.deepEqual(JSON.parse(one), { soul: { hits: "few" } });
  assert.equal(tuningWith({ DJ_TUNING: one }, "soul", {}), null, "reset drops the DJ, and an empty store is no setting");
  assert.deepEqual(JSON.parse(tuningWith({ DJ_TUNING: one }, "hank", { hits: "none" })), { soul: { hits: "few" }, hank: { hits: "none" } });
});

test("get_dj carries the tuning only while a dial is moved", async () => {
  const e = makeEnv();
  const plain = await callTool(e, "get_dj", { name: "soul" }, { remaining: 40 });
  assert.equal(plain.tuning, undefined);
  const t = await callTool({ ...e, ...tuned({ soul: { hits: "few" } }) }, "get_dj", { name: "soul" }, { remaining: 40 });
  assert.match(t.tuning, /HITS: a few/);
  assert.ok(Object.keys(t).indexOf("tuning") === Object.keys(t).indexOf("brief") + 1, "the tuning follows the brief");
});

async function claimedHouse() {
  const store = await makeHouseStore();
  const e = { ...makeEnv(), HOUSE: store.binding, PROGRAM_LIBRARY_KEY: KEY };
  await e.PROGRAMS.put("house:claimed", "2026-10-23T00:00:00Z");
  return e;
}
const tune = (e, dj, fields, { json = false } = {}) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return worker.fetch(new Request(`https://x.test/buttons/${KEY}/${dj}/tune`, { method: "POST", body,
    headers: { origin: "https://x.test", ...(json ? { accept: "application/json" } : {}) } }), e, { waitUntil() {} });
};

test("the Tune door keeps a DJ's dials in the house's store, and a reset takes them out", async () => {
  const e = await claimedHouse();
  installFetch();
  const r = await tune(e, "soul", { do: "save", years: "1966-1970", hits: "few", same: "any" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `/buttons/${KEY}/soul?tune=saved`);
  const s = await withSettings(e, null);
  assert.deepEqual(readTuning(s), { soul: { years: [1966, 1970], hits: "few" } });
  const got = await callTool(s, "get_dj", { name: "soul" }, { remaining: 40 });
  assert.match(got.tuning, /1966 to 1970/);
  // Another DJ's dials sit beside Soul's.
  await tune(e, "hank", { do: "save", hits: "none" });
  assert.deepEqual(Object.keys(readTuning(await withSettings(e, null))).sort(), ["hank", "soul"]);
  const back = await (await tune(e, "soul", { do: "save", reset: "1" }, { json: true })).json();
  assert.equal(back.ok, true);
  assert.deepEqual(readTuning(await withSettings(e, null)), { hank: { hits: "none" } });
});

test("Apply with nothing of the DJ's playing keeps the dials and says only that", async () => {
  const e = await claimedHouse();
  installFetch();
  const r = await (await tune(e, "soul", { do: "apply", hits: "half" }, { json: true })).json();
  assert.equal(r.code, "saved");
  assert.equal(r.summary, "about half hits");
});

test("the Tune door refuses another site, the wrong key, a GET and a DJ with no dials", async () => {
  const e = await claimedHouse();
  const body = new FormData(); body.set("hits", "few");
  const cross = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/soul/tune`, { method: "POST", body,
    headers: { origin: "https://evil.test" } }), e, { waitUntil() {} });
  assert.equal(cross.status, 403);
  assert.equal((await worker.fetch(new Request(`https://x.test/buttons/wrongkey123/soul/tune`, { method: "POST", body: new FormData() }), e, { waitUntil() {} })).status, 404);
  assert.equal((await worker.fetch(new Request(`https://x.test/buttons/${KEY}/soul/tune`), e, { waitUntil() {} })).status, 405);
  assert.equal((await tune(e, "nobody", { hits: "few" })).status, 404);
  assert.deepEqual(readTuning(await withSettings(e, null)), {});
});

// ---------------------------------------------------------------- 2b, the panel

test("the panel's sliders send a stop's place and the years as two ends", () => {
  const f = new FormData();
  f.set("years_from", "1966"); f.set("years_to", "1970"); f.set("hits", "0"); f.set("same", "2"); f.set("stay", "1");
  assert.deepEqual(tuningFromForm("soul", f), { years: [1966, 1970], hits: "few", same: "rarely" });
  const own = new FormData();
  own.set("years_from", "1959"); own.set("years_to", "1979"); own.set("hits", "2"); own.set("same", "0"); own.set("stay", "1");
  assert.deepEqual(tuningFromForm("soul", own), {}, "every dial on its own stop is no tuning");
});

const page = (e, path) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/${path}`), e, { waitUntil() {} }).then((r) => r.text());

test("a DJ's page: a Tuning row under the header, the sheet shut, Save while they are not playing", async () => {
  const e = await claimedHouse();
  installFetch();
  const html = await page(e, "soul");
  // One row in At a glance's old place (2026-10-24): what the DJ is set to, and Tune.
  assert.match(html, /<\/header>\s*<section class="block tuning" aria-labelledby="tuh">[^]*?<span class="tsum">Soul's own settings<\/span>\s*<span class="tacts"><a class="chipbtn" href="\?tune=open" data-tune-open><svg[^]*?<\/svg>Tune<\/a><\/span>/);
  assert.match(html, /<div class="tvsheet" id="tv" hidden>/);
  assert.match(html, /<form class="tv" method="post" action="\/buttons\/abcdefabcdefabcdefabcdef\/soul\/tune" style="--tvc:#[0-9A-Fa-f]{6}">/);
  assert.match(html, /<input type="hidden" name="do" value="save">/);
  assert.match(html, /<button type="submit" class="tvapply">Save<\/button>/);
  assert.match(html, /<h2 class="tvtitle">Tune Soul<\/h2>/);
  // Soul's four, inside Soul: its years track, three hits stops, no "None".
  assert.match(html, /name="years_from" min="1959" max="1979" step="1" value="1959"/);
  assert.match(html, /data-dial="hits" data-own="2" data-labels="\[&quot;A few&quot;,&quot;Half&quot;,&quot;Mostly&quot;\]"/);
  assert.doesNotMatch(html, /&quot;None&quot;/);
  assert.match(html, /<label class="tvk" for="tv-stay">Stay in soul<\/label>/);
  assert.doesNotMatch(html, /class="treset"/, "no Reset while nothing is tuned");
  // ?tune=open opens it with no script.
  assert.match(await page(e, "soul?tune=open"), /<div class="tvsheet" id="tv">/);
});

test("tuned, the page says so in one line with Reset, and the form starts where the dials are", async () => {
  const e = await claimedHouse();
  installFetch();
  const body = new FormData(); body.set("do", "save"); body.set("years_from", "1966"); body.set("years_to", "1970"); body.set("hits", "0");
  await worker.fetch(new Request(`https://x.test/buttons/${KEY}/soul/tune`, { method: "POST", body }), e, { waitUntil() {} });
  const html = await page(e, "soul?tune=saved");
  assert.match(html, /<p class="tsaid" role="status">Tuned\. The next new songs follow it\.<\/p>/);
  // Tune and Reset side by side (the owner, 2026-10-24).
  assert.match(html, /Tuned: 1966–1970, a few hits<\/span>\s*<span class="tacts"><a class="chipbtn" href="\?tune=open" data-tune-open><svg[^]*?<\/svg>Tune<\/a><form class="treset" method="post" action="[^"]+\/soul\/tune"><input type="hidden" name="do" value="save"><input type="hidden" name="reset" value="1"><button class="chipbtn" type="submit">Reset<\/button><\/form><\/span>/);
  assert.match(html, /name="years_from" min="1959" max="1979" step="1" value="1966"/);
  assert.match(html, /<output class="tvv ch">1966–1970<\/output>/);
  assert.match(html, /name="hits" min="0" max="2" step="1" value="0" aria-valuetext="A few"/);
});

test("the bar's panel fetches the form, to Apply, with the day's runs", async () => {
  const e = await claimedHouse();
  const r = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/vibe/tune?view=1&mode=apply`), e, { waitUntil() {} });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /^<form class="tv" method="post" action="\/buttons\/abcdefabcdefabcdefabcdef\/vibe\/tune" style="--tvc:#[0-9A-Fa-f]{6}" data-tv-fetch>/);
  assert.match(html, /<button type="submit" class="tvapply">Apply after this song<\/button>/);
  assert.match(html, /<label class="tvk" for="tv-mood">Mood<\/label>/);
  assert.match(html, /aria-label="Back"/);
  // Every page's panel has the button.
  const any = await page(e, "djs");
  assert.match(any, /<button type="button" class="nbtune" data-tune><svg[^]*?<\/svg>Tune<\/button>/);
});

test("a tuned Notes dial is the Ask form's starting choice, over the phone's memory", async () => {
  const e = await claimedHouse();
  e.REQUESTS_ENABLED = "true";
  installFetch();
  const body = new FormData(); body.set("do", "save"); body.set("notes", "1");
  await worker.fetch(new Request(`https://x.test/buttons/${KEY}/the-librarian/tune`, { method: "POST", body }), e, { waitUntil() {} });
  const html = await page(e, "the-librarian");
  assert.match(html, /<fieldset class="seg" data-tuned>/);
  assert.match(html, /value="long" checked/);
});
