// THE REQUESTS AND GUEST DJ KEYS, NAMED FOR WHO IS ON THEM (the owner,
// 2026-11-18): the Speakers grid's keys 1, 2 and 3 say the DJ and, on the
// small line, the set's title or the words asked; a line too long slides.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeEnv, TWO_REQUESTS } from "./harness.js";
import { laneKeyLine, requestKeyLines } from "../house.js";
import { renderSpeakersNow } from "../programs.js";

const SP = TWO_REQUESTS[0].playlist, TD = TWO_REQUESTS[1].playlist;
const CFG = { mode: "live", presets: [{ button: 3, lane: true, playlist: "LANELANELANELANELANE03" }] };

test("the guest DJ's key: the DJ and the words, or the program, or nobody", () => {
  const e = makeEnv();
  assert.deepEqual(laneKeyLine(e, CFG, { lane: { dj: "deep-dive", words: "Victoria Williams" } }),
    { 3: { name: "Deep Dive", sub: "Victoria Williams", source: "Spotify" } });
  assert.equal(laneKeyLine(e, CFG, { lane: { dj: "deep-dive", program: { title: "Loose" } } })[3].sub, "Loose");
  assert.equal(laneKeyLine(e, CFG, { lane: { dj: "deep-dive", ready: false, words: "x" } })[3].sub, "Getting ready");
  assert.deepEqual(laneKeyLine(e, CFG, { lane: null })[3], { name: "Guest DJ", sub: "Nobody yet", source: "Spotify" });
  assert.deepEqual(laneKeyLine(e, null, {}), {}, "a house with no guest DJ has no line");
});

test("a Requests key: the DJ and the set's title, or the words asked; nothing known leaves the key alone", async () => {
  const e = makeEnv();
  e.BUTTONS = JSON.stringify(TWO_REQUESTS);
  await e.PROGRAMS.put(`on:${SP}`, JSON.stringify({ dj: "the-librarian", ref: "sotT-x1", at: new Date().toISOString() }));
  await e.PROGRAMS.put(`current:${SP}`, "sotT-x1");
  await e.PROGRAMS.put("program:sotT-x1", JSON.stringify({ slug: "sotT-x1", title: "Sign o' the Times, Three Ways" }));
  await e.PROGRAMS.put(`on:${TD}`, JSON.stringify({ dj: "gatefold", ref: "request r9", at: new Date().toISOString() }));
  await e.PROGRAMS.put(`ask:${TD}`, JSON.stringify({ requestId: "r9", text: "the quiet side of Talk Talk" }));
  const lines = await requestKeyLines(e);
  assert.deepEqual(lines[1], { name: "The Librarian", sub: "Sign o' the Times, Three Ways", source: "Spotify" });
  assert.deepEqual(lines[2], { name: "Gatefold", sub: "the quiet side of Talk Talk", source: "Tidal" });
  await e.PROGRAMS.delete(`on:${TD}`);
  assert.equal((await requestKeyLines(e))[2], undefined);
});

test("the grid draws the lines, only over a key saved on the same service", () => {
  const presets = [[1, "Requests - Spotify", "Spotify"], [2, "Something", "Prime"], [3, "Guest DJ", "Spotify"]]
    .map(([btn, name, source]) => ({ btn, name, source }));
  const html = renderSpeakersNow({ base: "/buttons/k", speakers: [{ name: "Pro Plus", slug: "pro-plus" }],
    readings: { "pro-plus": { presets, when: "at 22:00" } },
    keyLines: { 1: { name: "The Librarian", sub: "Sign o' the Times", source: "Spotify" },
      2: { name: "Gatefold", sub: "Talk Talk", source: "Tidal" },
      3: { name: "Deep Dive", sub: "Victoria Williams", source: "Spotify" } } });
  assert.match(html, /<span class="kname">The Librarian<\/span><span class="ksrc ksub"><span>Sign o/);
  assert.match(html, /<span class="kname">Deep Dive<\/span><span class="ksrc ksub"><span>Victoria Williams<\/span><\/span>/);
  assert.match(html, /<span class="kname">Something<\/span>/, "a key saved to another service keeps its own name");
  assert.doesNotMatch(html, /<span class="kname">Gatefold/);
});
