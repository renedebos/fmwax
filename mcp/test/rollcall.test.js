// ROLL CALLS (2026-10-12, tasks/rollcalls/): a DJ with a reviewed roll call
// gets a slice of it on every endless job, every listener request, and on
// get_dj when Talk or the phone passes the listener's words.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv } from "./harness.js";
import { PERSONAS } from "../djs.js";
import { ROLL_CALLS } from "../rollcalls.js";
import { rollCallSlice, artistsOfLabels, hasRollCall } from "../rollcall.js";

const { callTool, endlessJobs } = __test;
const BRIEF = PERSONAS["pub-rock"].brief;
const nameOf = (line) => line.split(/ \(|: /)[0];
const b = () => ({ remaining: 40 });

test("a narrow ask gets the acts that fit it, a dozen of them, and three to stay out of", () => {
  const s = rollCallSlice("pub-rock", { words: "Canvey Island and Southend", seed: "j1", brief: BRIEF });
  assert.equal(s.fits.length, 12);
  assert.equal(s.not.length, 3);
  const names = s.fits.map(nameOf);
  for (const n of ["Dr. Feelgood", "The Kursaal Flyers", "Mickey Jupp"]) assert.ok(names.includes(n), `${n} fits Canvey and Southend`);
  assert.ok(s.not.every((l) => l.startsWith("Not ")));
  assert.match(s.note, /not a whitelist/);
  assert.match(s.note, new RegExp(`${ROLL_CALLS["pub-rock"].in.length} acts`));
});

test("a broad ask gets a spread that leaves out what the DJ played lately and leans on acts the brief does not name", () => {
  const all = ROLL_CALLS["pub-rock"].in.map((e) => e.name);
  const recent = ["The Kursaal Flyers — Little Does She Know", "Mickey Jupp, Rockpile — Old Rock 'n' Roller"];
  for (const seed of ["a", "b", "c", "d"]) {
    const s = rollCallSlice("pub-rock", { words: "45 minutes", recent, seed, brief: BRIEF });
    const names = s.fits.map(nameOf);
    assert.equal(names.length, 12);
    assert.ok(names.every((n) => all.includes(n)));
    assert.ok(!names.includes("The Kursaal Flyers") && !names.includes("Mickey Jupp"), "played lately, so not in the spread");
    const named = names.filter((n) => BRIEF.toLowerCase().includes(n.toLowerCase().replace(/^the /, "")));
    assert.equal(named.length, 0, `the spread is acts the brief does not name (seed ${seed}: ${named})`);
  }
  // The same job reads the same slice twice.
  assert.deepEqual(rollCallSlice("pub-rock", { words: "", seed: "x" }), rollCallSlice("pub-rock", { words: "", seed: "x" }));
});

test("the artists of a label, and a DJ with no roll call has no slice", () => {
  assert.deepEqual([...artistsOfLabels(["Wilko Johnson, Roger Daltrey — Going Back Home", "The Pirates — Shakin' All Over"])],
    ["wilko johnson", "roger daltrey", "pirates"]);
  assert.equal(rollCallSlice("vibe", { words: "anything" }), null);
  assert.equal(hasRollCall("pub-rock"), true);
  assert.equal(hasRollCall("vibe"), false);
  // Monk went (2026-10-15) and his jazz is Genre's (2026-10-18); the three
  // reviewed since stay.
  assert.equal(hasRollCall("monk"), false);
  assert.equal(rollCallSlice("monk", { words: "organ trios" }), null);
  // Sessions' since 2026-10-26, gathered from MusicBrainz and not read one by one.
  assert.deepEqual(Object.keys(ROLL_CALLS).sort(), ["dr-funkenstein", "genre:jazz", "hank", "pub-rock", "sessions"]);
});

test("get_dj with the listener's words carries the slice; without them only says there is one; other DJs carry neither", async () => {
  const e = makeEnv();
  const asked = await callTool(e, "get_dj", { name: "pub rock", ask: "the Brinsley Schwarz family tree" }, b());
  assert.ok(asked.brief);
  const names = asked.roll_call.fits.map(nameOf);
  for (const n of ["Brinsley Schwarz", "Ian Gomm", "Nick Lowe"]) assert.ok(names.includes(n), n);
  assert.equal("roll_call_note" in asked, false);
  const bare = await callTool(e, "get_dj", { name: "pub rock" }, b());
  assert.equal("roll_call" in bare, false, "an endless job or a request already carries its own slice");
  assert.match(bare.roll_call_note, /Pass ask/);
  const vibe = await callTool(e, "get_dj", { name: "vibe", ask: "an hour" }, b());
  assert.equal("roll_call" in vibe, false);
  assert.equal("roll_call_note" in vibe, false);
});

test("an endless job for a DJ with a roll call carries a slice for its steer, and leaves out what the DJ just played", async () => {
  const e = makeEnv();
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 4, dj: "pub-rock", playlist: "SAMPLEPLAYLIST00000013" },
    { button: 5, dj: "vibe", playlist: "1xHAwCR7p9w3ptiTGPJMjq" }] });
  const at = Date.now();
  e.STATION.endless.doc = JSON.stringify({ rev: 1,
    jobs: {
      "endless-4-1": { id: "endless-4-1", btn: 4, dj: "pub-rock", kind: "steer", words: "more harmonica", minutes: 45, at },
      "endless-4-2": { id: "endless-4-2", btn: 4, dj: "pub-rock", kind: "fresh", minutes: 60, at },
      "endless-5-1": { id: "endless-5-1", btn: 5, dj: "vibe", kind: "fresh", minutes: 60, at } },
    history: { "pub-rock": [["spotify:track:aaaaaaaaaaaaaaaaaaaaaa", "Split Rivitt — Some Song"]] },
    sessions: {}, assign: {}, queued: {}, gen: {} });
  const jobs = await endlessJobs(e);
  const steer = jobs.find((j) => j.job_id === "endless-4-1");
  assert.ok(steer.roll_call.fits.map(nameOf).includes("Nine Below Zero"), "harmonica R&B fits the steer");
  const fresh = jobs.find((j) => j.job_id === "endless-4-2");
  assert.equal(fresh.roll_call.fits.length, 12);
  assert.ok(!fresh.roll_call.fits.map(nameOf).includes("Split Rivitt"), "played lately, so not in a broad spread");
  assert.equal("roll_call" in jobs.find((j) => j.job_id === "endless-5-1"), false, "Vibe has no roll call");
});

test("a listener's request to a DJ with a roll call carries the slice for its words while it is work", async () => {
  const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
  const KEY = "abcdefabcdefabcdefabcdef";
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.REQUESTS_ENABLED = "true";
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: "GUESTSPOTIFY0000000001", catalog: "spotify" },
    { button: 3, dj: "the-librarian", playlist: P(3) }]);
  const ask = (dj, mood) => worker.fetch(new Request(`https://x.test/buttons/${KEY}/${dj}/request`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `mood=${encodeURIComponent(mood)}&length=60` }), e);
  assert.match((await ask("pub-rock", "Canvey Island, loud")).headers.get("location"), /ask=sent$/);
  assert.match((await ask("the-librarian", "disco")).headers.get("location"), /ask=sent$/);
  const out = await callTool(e, "list_requests", {}, b());
  const pr = out.requests.find((r) => r.dj === "pub-rock");
  assert.ok(pr.roll_call.fits.map(nameOf).includes("Dr. Feelgood"));
  assert.match(out.roll_call_note, /not a whitelist/);
  assert.equal("roll_call" in out.requests.find((r) => r.dj === "the-librarian"), false);
});

// GENRE'S JAZZ (2026-10-18): Monk's roll call (2026-10-12, all of jazz, the
// first spread), his since the owner cut him and gave jazz to Genre
// (2026-10-15). An ask that names jazz reaches it; any other genre, and the
// jazz styles it never held, reach none. A broad ask crosses the styles; a
// narrow one finds its corner without always handing over the best-known
// names; the stay-out lines are the crossovers the reviewers took out.
const GENRE = PERSONAS.genre.brief;
const groupOf = (line) => (line.match(/\[([^\]]+)\]$/) ?? [])[1];
test("Genre's jazz: only an ask that names jazz reaches it", () => {
  const jazz = ROLL_CALLS["genre:jazz"];
  assert.ok(jazz.spread && jazz.in.length > 4000, "the whole field, spread");
  assert.equal(hasRollCall("genre"), false, "Genre has no roll call of his own");
  for (const w of ["piano jazz", "an hour of jazz", "bebop", "hard bop, endless", "big band swing", "bossa nova for a Sunday", "soul-jazz"]) {
    assert.ok(hasRollCall("genre", w), w);
  }
  for (const w of ["80s new wave", "Delta blues before 1960", "ska", "acid jazz", "smooth jazz", "nu jazz", "jazz rap", "jazzhop"]) {
    assert.equal(rollCallSlice("genre", { words: w, seed: "x" }), null, w);
  }
  assert.match(rollCallSlice("genre", { words: "jazz", seed: "x" }).note, /the house's jazz roll call \(4\d{3} acts/);
});

test("Genre's broad jazz ask crosses the styles and leaves out what he played lately", () => {
  const recent = ["Jimmy Smith — Back at the Chicken Shack", "Sun Ra — Space Is the Place"];
  for (const seed of ["a", "b", "c", "d"]) {
    const s = rollCallSlice("genre", { words: "an hour of jazz", recent, seed, brief: GENRE });
    assert.equal(s.fits.length, 12);
    const groups = new Set(s.fits.map(groupOf));
    assert.ok(groups.size >= 8, `seed ${seed}: ${groups.size} styles in a dozen (${[...groups]})`);
    const names = s.fits.map(nameOf);
    assert.ok(!names.includes("Jimmy Smith") && !names.includes("Sun Ra"), "played lately, so not in the spread");
  }
  // Two jobs, two different dozens.
  const one = rollCallSlice("genre", { words: "jazz", seed: "job-1", brief: GENRE }).fits.map(nameOf);
  const two = rollCallSlice("genre", { words: "jazz", seed: "job-2", brief: GENRE }).fits.map(nameOf);
  assert.ok(one.filter((n) => two.includes(n)).length <= 2, "a fresh spread each job");
});

test("Genre's narrow jazz ask finds its corner, and not always the famous end of it", () => {
  const seen = new Set();
  for (const seed of ["a", "b", "c"]) {
    const s = rollCallSlice("genre", { words: "piano jazz", seed, brief: GENRE });
    assert.equal(s.fits.length, 12);
    const piano = s.fits.filter((l) => /piano/i.test(l)).length;
    assert.ok(piano >= 10, `seed ${seed}: ${piano} of 12 are pianists`);
    s.fits.map(nameOf).forEach((n) => seen.add(n));
  }
  assert.ok(seen.size > 20, `three jobs, ${seen.size} different pianists`);
  const organ = rollCallSlice("genre", { words: "organ trios and soul-jazz", seed: "o", brief: GENRE });
  assert.ok(organ.fits.filter((l) => /organ|soul-jazz/i.test(l)).length >= 10);
  const bossa = rollCallSlice("genre", { words: "bossa nova for a Sunday", seed: "s", brief: GENRE });
  assert.ok(bossa.fits.filter((l) => /bossa|latin/i.test(l)).length >= 10);
  // The stay-out lines are the reviewers' outs, and never one of the fits.
  const s = rollCallSlice("genre", { words: "jazz", seed: "n", brief: GENRE });
  assert.equal(s.not.length, 3);
  const outs = ROLL_CALLS["genre:jazz"].not.map((e) => e.name);
  for (const n of ["Kenny G", "Norah Jones", "Buena Vista Social Club"]) assert.ok(outs.includes(n), `${n} is a stay-out`);
  const ins = new Set(ROLL_CALLS["genre:jazz"].in.map((e) => e.name));
  assert.ok(!outs.some((n) => ins.has(n)), "no act is both in and out");
  // Monk's "not yet" on the new scenes was his taste; Genre plays who
  // carried a genre later, so they are no stay-out of his.
  for (const n of ["Shabaka", "GoGo Penguin", "Makaya McCraven"]) assert.ok(!outs.includes(n), `${n} is not a stay-out`);
});

test("get_dj for Genre carries the jazz slice for a jazz ask, nothing for another genre, and says which genres have one", async () => {
  const e = makeEnv();
  const jazz = await callTool(e, "get_dj", { name: "genre", ask: "some piano jazz" }, b());
  assert.ok(jazz.roll_call.fits.filter((l) => /piano/i.test(l)).length >= 10);
  const wave = await callTool(e, "get_dj", { name: "genre", ask: "80s new wave" }, b());
  assert.equal("roll_call" in wave, false);
  assert.equal("roll_call_note" in wave, false);
  const bare = await callTool(e, "get_dj", { name: "genre" }, b());
  assert.match(bare.roll_call_note, /Genre has a roll call for jazz \(4\d{3} acts\)\. Pass ask/);
});

test("an endless job for Genre on jazz carries the jazz slice; on another genre, none", async () => {
  const e = makeEnv();
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 3, dj: "genre", playlist: "3xHAwCR7p9w3ptiTGPJMjq" }] });
  const at = Date.now();
  e.STATION.endless.doc = JSON.stringify({ rev: 1,
    jobs: {
      "endless-3-1": { id: "endless-3-1", btn: 3, dj: "genre", kind: "topup", words: "piano jazz", minutes: 45, at },
      "endless-3-2": { id: "endless-3-2", btn: 3, dj: "genre", kind: "topup", words: "ska", minutes: 45, at } },
    history: {}, sessions: {}, assign: {}, queued: {}, gen: {} });
  const jobs = await endlessJobs(e);
  const jazz = jobs.find((j) => j.job_id === "endless-3-1");
  assert.ok(jazz.roll_call.fits.filter((l) => /piano/i.test(l)).length >= 10);
  assert.equal("roll_call" in jobs.find((j) => j.job_id === "endless-3-2"), false);
});

// HANK'S ROLL CALL (2026-10-12): the acts of his labels made after 1990, one
// group per label, spread like Monk's was. Another name of an act rides along as
// its alias, never as an act of its own, and the owner's "mark all In" on the
// other names did not bring in an act out for its own reason.
const HANK = PERSONAS.hank.brief;
test("Hank's roll call spreads across his labels, and an ask by country or style finds its corner", () => {
  const rc = ROLL_CALLS.hank;
  assert.ok(rc.spread && rc.in.length > 400, `${rc.in.length} acts`);
  const ins = new Map(rc.in.map((e) => [e.name, e]));
  for (const n of ["Sharon Jones & The Dap-Kings", "Charles Bradley", "Durand Jones & The Indications", "Thee Sinseers", "The Soul Investigators"]) assert.ok(ins.has(n), n);
  assert.ok(!ins.has("Durand Jones") && ins.get("Durand Jones & The Indications").aliases.includes("Durand Jones"), "another name is an alias");
  for (const n of ["Black Pumas", "Jazzanova", "Darondo", "Brian Auger"]) assert.ok(!ins.has(n), `${n} stays out`);
  for (const seed of ["a", "b", "c"]) {
    const s = rollCallSlice("hank", { words: "an hour", seed, brief: HANK });
    assert.equal(s.fits.length, 12);
    const labels = new Set(s.fits.map(groupOf));
    assert.ok(labels.size >= 8, `seed ${seed}: ${labels.size} labels in a dozen`);
  }
  const finnish = rollCallSlice("hank", { words: "Finnish deep funk", seed: "f", brief: HANK });
  assert.ok(finnish.fits.filter((l) => /helsinki|finland|finnish/i.test(l)).length >= 6, "\"funk\" says nothing in his field; \"Finnish\" decides");
  const sweet = rollCallSlice("hank", { words: "sweet soul and slow jams", seed: "s", brief: HANK });
  assert.ok(sweet.fits.filter((l) => /sweet.soul|penrose/i.test(l)).length >= 10);
  const aussie = rollCallSlice("hank", { words: "Australian funk bands", seed: "o", brief: HANK });
  assert.ok(aussie.fits.filter((l) => /australia|melbourne|sydney|brisbane|adelaide/i.test(l)).length >= 8);
});

// DR. FUNKENSTEIN'S ROLL CALL (2026-10-13): the crate diggers' reissue labels,
// one group per label, spread; a famous act's line names its hits as "not:",
// the records his never-the-hits rule keeps out, and the note says so.
const FUNK = PERSONAS["dr-funkenstein"].brief;
test("Funkenstein's roll call spreads across the reissue labels and names each famous act's hits to leave out", () => {
  const rc = ROLL_CALLS["dr-funkenstein"];
  assert.ok(rc.spread && rc.in.length > 5000, `${rc.in.length} acts`);
  const meters = rc.in.find((e) => e.name === "The Meters");
  assert.match(meters.reason, / · not: .*Cissy Strut/);
  assert.ok(rc.in.some((e) => e.group === "Kent"), "Kent kept in, at the owner's word");
  for (const seed of ["a", "b", "c"]) {
    const s = rollCallSlice("dr-funkenstein", { words: "an hour", seed, brief: FUNK });
    assert.equal(s.fits.length, 12);
    assert.ok(new Set(s.fits.map(groupOf)).size >= 8, `seed ${seed}: labels`);
    assert.match(s.note, /names that act's hits: leave those songs out/);
  }
  const nola = rollCallSlice("dr-funkenstein", { words: "New Orleans funk", seed: "n", brief: FUNK });
  assert.ok(nola.fits.filter((l) => /new orleans/i.test(l)).length >= 6);
  // Pub Rock's lines carry no hits, so its note does not mention them.
  assert.doesNotMatch(rollCallSlice("pub-rock", { words: "an hour", seed: "p" }).note, /names that act's hits/);
});

test("Funkenstein's 'an hour of funk' is a broad ask, not a dozen bands named Funk", () => {
  const s = rollCallSlice("dr-funkenstein", { words: "1 hour of funk", seed: "f", brief: FUNK });
  const named = s.fits.filter((l) => /^[^:(]*\bfunk/i.test(l)).length;
  assert.ok(named <= 2, `${named} of 12 have Funk in their name`);
  assert.ok(new Set(s.fits.map(groupOf)).size >= 8, "spread across the labels");
});
