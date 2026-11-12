// THE LEVELS, THE SAME WORDS EVERYWHERE (MC-40, levels.js; the canvas "The
// Install Ladder"). The setup checklist reads its section names from
// levels.js; the README, START-HERE.md and the start page are written by
// hand, and this holds them to the same words, so a change in one place is a
// failing test until it is made in all. Runs in the public copy too, where
// the README is the root's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { EXTRAS, LEVELS, levelWords, nextStep } from "../levels.js";
import { setupChecklist } from "../checklist.js";
import { STARTER_DJS } from "../starters.js";
import { PERSONAS } from "../djs.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const at = (p) => new URL(`../../${p}`, import.meta.url);
const read = (p) => readFileSync(at(p), "utf8");
// This repository keeps the public README beside the copy script; a copy has it at its root.
const README = existsSync(at("tools/copy/README.md")) ? "tools/copy/README.md" : "README.md";

test("the names the owner chose, and what each level is", () => {
  assert.deepEqual(LEVELS.map((l) => l.title), ["Level 1 · Ask a DJ", "Level 2 · DJ presets", "Level 3 · Endless"]);
  assert.deepEqual(EXTRAS.map((e) => e.title), ["Extra · Home helper", "Extra · Talk"]);
  assert.equal(LEVELS[1].time, "a few minutes per added preset");
  assert.equal(levelWords(2).title, "Level 2 · DJ presets");
});

test("the README and START-HERE carry every level's line, word for word", () => {
  for (const file of [README, "START-HERE.md"]) {
    const text = read(file);
    for (const l of [...LEVELS, ...EXTRAS]) {
      assert.ok(text.includes(`| **${l.title}** | ${l.gets} | ${l.needs} | ${l.time} |`), `${file}: the line for ${l.title}`);
    }
    assert.match(text, /You can stop at any level and it works\./);
  }
});

test("the start page's three cards say the same in their short form", () => {
  const html = read("docs/index.html");
  for (const l of LEVELS) {
    assert.ok(html.includes(`Level ${l.n} · ${l.n === 1 ? "today" : "later"}</span><b>${l.name}</b>`), `the card for ${l.title}`);
    assert.ok(html.includes(l.short), `${l.title}: ${l.short}`);
    assert.ok(html.includes(l.needsShort), `${l.title}: ${l.needsShort}`);
  }
});

test("the guides name the seven DJs who can have a preset, as the starter sets do", () => {
  const page = read("docs/install/dj-presets.md");
  for (const key of STARTER_DJS) assert.ok(page.includes(PERSONAS[key].name), `${PERSONAS[key].name} is named`);
  assert.match(read("START-HERE.md"), /Do the steps under \*\*Level 1 · Ask a DJ\*\* in order/);
});

test("the checklist of a house the setup page makes carries the levels' names and says where the house is", async () => {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = "setup-key-0123456789abcdef";
  e.AGENT_SECRET = "agent-key-0123456789";
  e.HOUSE_TZ = "America/Los_Angeles";
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: "REQUESTS00000000000001", catalog: "spotify" }]);
  delete e.ENDLESS;
  const list = await setupChecklist(e, { claimed_at: new Date().toISOString() });
  assert.deepEqual(list.sections.slice(0, 3).map((s) => s.title), LEVELS.map((l) => l.title));
  assert.deepEqual(list.sections.slice(0, 3).map((s) => s.sub), LEVELS.map((l) => l.sub));
  assert.equal(list.sections.find((s) => s.key === "helper").title, "Extra · Home helper");
  assert.ok(list.level && list.level.n <= 1, "a house with no DJ preset is at Level 1 or still on its steps");
  // With a DJ preset that waits: Level 2. Once a curator has checked in and the word is gone: Level 3.
  const waits = JSON.stringify({ mode: "live", dailyRuns: 12, waits: true, presets: [{ button: 5, dj: "hank", playlist: "HANKPLAYLIST0000000005", hours: 4 }] });
  const two = await setupChecklist({ ...e, ENDLESS: waits, __page: { ENDLESS: waits } }, { claimed_at: new Date().toISOString() });
  assert.equal(two.level.title, "Level 2 · DJ presets");
  assert.match(two.level.next, /Level 3/);
  const live = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [{ button: 5, dj: "hank", playlist: "HANKPLAYLIST0000000005", hours: 4 }] });
  const { CURATOR_SEEN_KEY } = await import("../services.js");
  await e.PROGRAMS.put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() }));
  const three = await setupChecklist({ ...e, ENDLESS: live, __page: { ENDLESS: live }, REQUEST_ROUTINE_ID: "trig_x" }, { claimed_at: new Date().toISOString() });
  assert.equal(three.level.title, "Level 3 · Endless");
  // A house whose presets come from its file keeps the names it had, and has no strip.
  const file = await setupChecklist({ ...e, ENDLESS: live }, { claimed_at: new Date().toISOString() });
  assert.deepEqual(file.sections.slice(0, 2).map((s) => s.title), ["Core", "Endless"]);
  assert.equal(file.level, null);
});

// The test house run (2026-11-10): Level 1 done, the strip said Level 2 was
// next and the card above it said "Next: Curator".
test("the Next card follows the ladder: Level 1's steps, then the next level's first step, marked optional", () => {
  const row = (title, state, href = "/x") => ({ title, state, href });
  const list = (n, core, dj, endless, extra = []) => ({ allDone: false, level: n == null ? null : { n },
    sections: [{ key: "core", rows: core }, ...(dj ? [{ key: "djpresets", rows: dj }] : []),
      { key: "endless", rows: endless }, { key: "talk", rows: extra }] });
  const offer = row("A DJ on a button of their own", "offer", "/setup/dj-preset");
  const curator = row("Curator", "todo", "/setup/curator");
  const done = [row("Claimed", "done"), row("Spotify", "done")];
  // Level 1 not done: its own step, as before.
  assert.deepEqual(nextStep(list(0, [row("Claimed", "done"), row("Spotify", "todo")], null, [curator])), { row: row("Spotify", "todo"), optional: false });
  // Level 1 done: the DJ preset offer, not the curator.
  assert.deepEqual(nextStep(list(1, done, [offer], [curator])), { row: offer, optional: true });
  // Level 2 with a preset not saved yet: that first.
  const unsaved = row("Hank · preset 4", "todo");
  assert.deepEqual(nextStep(list(2, done, [unsaved, row("Another DJ", "offer")], [curator])), { row: unsaved, optional: false });
  // Level 2 with its presets unseen (no helper): the curator, optional.
  assert.deepEqual(nextStep(list(2, done, [row("Hank · preset 4", "unknown", undefined), row("Another DJ", "offer")], [curator])), { row: curator, optional: true });
  // A Level 1 step left undone at Level 2 still comes first.
  assert.deepEqual(nextStep(list(2, [row("Spotify", "todo")], [row("Another DJ", "offer")], [curator])).row.title, "Spotify");
  // Off the ladder (a house whose presets come from its file): the first to do.
  assert.deepEqual(nextStep(list(null, done, null, [curator])), { row: curator, optional: false });
  // Set up at Level 1 (the curator is an offer, not a step owed): still the
  // next level's step, as an offer (the owner, 2026-11-10: "5 of 5, set up").
  assert.deepEqual(nextStep({ ...list(1, done, [offer], [row("Curator", "offer", "/setup/curator")]), allDone: true }), { row: offer, optional: true });
  assert.deepEqual(nextStep({ ...list(2, done, [row("Another", "offer")], [row("Curator", "offer", "/setup/curator")]), allDone: true }).row.title, "Curator");
  // Set up at Level 3, or off the ladder: no card.
  assert.equal(nextStep({ ...list(3, done, [offer], []), allDone: true }), null);
  assert.equal(nextStep({ ...list(null, done, null, []), allDone: true }), null);
});
