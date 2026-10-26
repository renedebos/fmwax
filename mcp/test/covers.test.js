// The DJs' faces: one JPEG per persona in art/covers/, read through the
// COVERS assets binding to put a DJ's cover on their playlist. No page draws
// a face, and the /covers/<dj>.jpg address is gone (2026-10-18).
//
// The roster and the art directory are kept in step here, so a persona added
// without its cover fails in the suite and not at the cover upload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ROSTER as PERSONAS, PROGRAMS_BY } from "../djs.js";
import { makeEnv } from "./harness.js";

const COVERS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "art", "covers");
// The guest preset's sleeve (MC-18): a playlist nobody holds wears a face of
// its own in the Spotify app, so the roster-and-art rule above has one entry
// that is not a persona. Made by `ONLY=dj-guest ./make-covers.sh`, put on by
// `./upload-covers.sh --playlist <id> --cover covers/dj-guest.jpg --go`.
test("the guest sleeve is in the art directory", () => {
  assert.ok(existsSync(join(COVERS, "dj-guest.jpg")), "art/covers/dj-guest.jpg");
});

test("every persona in the roster has a cover in art/covers/", () => {
  for (const key of Object.keys(PERSONAS)) {
    assert.ok(existsSync(join(COVERS, `${key}.jpg`)),
      `${PERSONAS[key].name} has no art/covers/${key}.jpg — run art/make-covers.sh`);
  }
});

// The picker groups the bench by what a DJ programs by, so every persona
// needs one of those words — and it has to be one of THE words, or the
// grouping quietly grows a heading of one. Same rule as the covers above:
// a persona added without it fails here, not as a stray group on the wall.
test("every persona says what it programs by, from the list", () => {
  for (const [key, p] of Object.entries(PERSONAS)) {
    assert.ok(PROGRAMS_BY.includes(p.programsBy),
      `${key} programs by ${JSON.stringify(p.programsBy)}, which is not one of ` +
      PROGRAMS_BY.join(", "));
  }
  // The list is a vocabulary, not a tally: a term nothing uses yet is fine,
  // but a term nothing CAN use is a typo. Every persona's word is distinct
  // enough that at least three headings appear on any real bench.
  assert.ok(new Set(Object.values(PERSONAS).map((p) => p.programsBy)).size >= 3);
});

// The band on the buttons page is painted in the persona's own FIELD and INK
// (2026-09-05), and art/make-covers.sh reads the same two values for the
// sleeve. A persona without them would paint a grey band and fail the cover
// script at once; this is the earlier, quieter place to fail.
test("every persona carries its cover colours, as hex", () => {
  for (const [key, p] of Object.entries(PERSONAS)) {
    assert.match(p.colour?.field ?? "", /^#[0-9A-F]{6}$/, `${key} has no field colour`);
    assert.match(p.colour?.ink ?? "", /^#[0-9A-F]{6}$/, `${key} has no ink colour`);
  }
});

// A RENAMED OR MERGED DJ (Motown became Soul Factory, 2026-10-12; the
// merges, 2026-10-13: Sunny, Morning and Nightside are Vibe, Stax and Soul
// Factory are Soul, KRS-One is Hip Hop): the old key still finds them — a
// program written under it, an old page address — while the roster lists
// them once. Kurt became Grunge on 2026-10-12,
// and Grunge was cut on 2026-10-13: that old key finds nobody. So does
// KRS-One's since Hip Hop was cut, 2026-10-15, with Camille, Monk, the
// Professor and the Selector.
test("an old key finds the renamed DJ, and is never a second DJ", async () => {
  const e = makeEnv();
  const { house, findDj } = (await import("../house.js"));
  const olds = { sunny: "vibe", morning: "vibe", nightside: "vibe", stax: "soul",
    "soul-factory": "soul", motown: "soul" };
  for (const [old, now] of Object.entries(olds)) {
    assert.equal(house(e).djs[old]?.key, now, old);
    assert.ok(!Object.keys(house(e).djs).includes(old), `${old} is not a second DJ`);
  }
  for (const [name, now] of [["Sunny", "vibe"], ["Morning", "vibe"], ["Nightside", "vibe"], ["Stax", "soul"],
    ["Soul Factory", "soul"], ["Motown", "soul"], ["DJ Stax", "soul"]]) {
    assert.equal(findDj(e, name)?.key, now, name);
  }
  for (const name of ["Vibe", "Soul"]) {
    assert.equal(house(e).roster.filter((d) => d.name === name).length, 1, name);
  }
  // A cut DJ's old key finds nobody.
  for (const gone of ["kurt", "grunge", "tempo", "krs-one", "hip-hop", "monk", "camille", "the-selector", "the-professor"]) {
    assert.equal(findDj(e, gone), null, gone);
  }
});
