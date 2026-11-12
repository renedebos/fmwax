// THE STARTER SETS (MC-40 stage 3, tasks/mc40-dj-presets.md): an hour of each
// DJ's songs for a preset made before the house has a curator. The lists are
// data chosen by hand; these hold their shape, and that every DJ who can
// have a preset has one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { STARTERS, STARTER_DJS, starterUris } from "../starters.js";
import { PERSONAS } from "../djs.js";

test("the seven DJs who can have a preset of their own each have a starter set, and nobody else", () => {
  assert.deepEqual([...STARTER_DJS].sort(), ["americana", "dr-funkenstein", "hank", "pub-rock", "sessions", "soul", "vibe"]);
  for (const dj of STARTER_DJS) {
    const p = PERSONAS[dj];
    assert.ok(p, `${dj} is a DJ of the house`);
    assert.ok(!p.needsWords, `${dj} needs no telling what to play`);
    assert.notEqual(p.endless, false, `${dj} can play endless once a curator comes`);
    assert.ok(!p.archiveOnly);
  }
  // Deep Dive and Genre are told what to play; the writers stay on Requests.
  for (const dj of ["deep-dive", "genre", "the-librarian", "gatefold"]) assert.equal(STARTERS[dj], undefined);
});

test("each list is 12 to 15 Spotify track ids, none twice", () => {
  for (const dj of STARTER_DJS) {
    const ids = STARTERS[dj];
    assert.ok(ids.length >= 12 && ids.length <= 15, `${dj}: ${ids.length} songs`);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9]{22}$/, `${dj}: ${id}`);
    assert.equal(new Set(ids).size, ids.length, `${dj}: a song twice`);
  }
});

test("a starter set as URIs, in the list's order; a DJ with no list has none", () => {
  assert.deepEqual(starterUris("hank").slice(0, 2), [`spotify:track:${STARTERS.hank[0]}`, `spotify:track:${STARTERS.hank[1]}`]);
  assert.equal(starterUris("hank").length, STARTERS.hank.length);
  assert.deepEqual(starterUris("deep-dive"), []);
  assert.deepEqual(starterUris("nobody"), []);
});

test("every id has its artist and title beside it in the file, so a dead one can be found and replaced", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../starters.js", import.meta.url), "utf8");
  for (const dj of STARTER_DJS) for (const id of STARTERS[dj]) {
    assert.match(src, new RegExp(`"${id}", // .+ — .+ \\(\\d+:\\d\\d\\)`), `${dj}: ${id} has no artist and title`);
  }
});
