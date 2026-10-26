// THREE DATES, KEPT APART (the owner, 2026-10-18, after the Stax songwriter
// demos: recorded in the 1960s and 70s, first issued 2023, and every catalog
// saying only 2023): when a recording was made, when it was first issued, and
// when another notable version came out; and an era goes by the first.
import { test } from "node:test";
import assert from "node:assert/strict";

import { HOUSE_RULES } from "../djs.js";
import { renderProgram, versionSuspect } from "../programs.js";
import { trackRecord } from "../shelf.js";
import { cleanResearch } from "../endless.js";
import { PROGRAM_TOOLS, TOOLS } from "../toollist.js";

test("every curator reads the three dates and that an era is when the music was made", () => {
  assert.match(HOUSE_RULES, /THREE DATES, KEPT APART/);
  assert.match(HOUSE_RULES, /'Mack Rice's demo, first issued 2023; the hit was the Staple Singers', 1971'/);
  assert.match(HOUSE_RULES, /only with evidence for it/);
  assert.match(HOUSE_RULES, /Without evidence, say it is not known/);
  assert.match(HOUSE_RULES, /A PERIOD IS WHEN THE MUSIC WAS MADE\. 'Mack Rice at Stax', 'the label in the sixties', and a brief's own years/);
  assert.match(HOUSE_RULES, /A 1960s demo first issued in 2023 is Soul's, never Hank's/);
  assert.match(HOUSE_RULES, /where the period is tight, leave it out rather than guess/);
  assert.equal(HOUSE_RULES.match(/WHEN THE MUSIC WAS MADE\. /g).length, 1, "one rule, not two");
  assert.match(HOUSE_RULES, /An archival set .* never one for new music/);
  const keep = TOOLS.find((t) => t.name === "keep_request_set").description;
  assert.match(keep, /KEEP A SONG'S THREE DATES APART/);
  assert.match(keep, /musicbrainz\.org\/ws\/2\/isrc\/<isrc>/, "an archival recording's first issue by its ISRC");
  assert.match(TOOLS.find((t) => t.name === "search_tracks").description, /`released` is the album's, never the recording's/);
});

test("a programme's track carries when it was made and, for an archival one, when it was first issued", () => {
  for (const name of Object.keys(PROGRAM_TOOLS)) {
    assert.ok(JSON.stringify(TOOLS.find((t) => t.name === name).inputSchema).includes('"issued"'), `${name} takes \`issued\``);
  }
  const t = { uri: "spotify:track:x", name: "Respect Yourself", artists: [{ name: "Mack Rice" }], duration_ms: 180000,
    album: { name: "Written In Their Soul: The Stax Songwriter Demos" } };
  const rec = trackRecord(t, { year: "c. 1971", issued: "2023" });
  assert.equal(rec.issued, "2023");
  assert.equal(trackRecord(t, { issued: "sometime" }).issued, undefined, "a year or nothing");
  const html = renderProgram({ title: "Demos", thesis: "t", dj: "The Librarian", created: "2026-10-18T00:00:00Z", tracks: 1,
    runtime: "3:00", playlistName: "x", sections: [{ heading: "h", prose: [{ text: "p" }], tracks: [rec] }] });
  assert.match(html, /first issued 2023/);
  assert.match(html, /c\. 1971/);
});

test("a demo first issued decades later is not taken for a later mix", () => {
  assert.match(versionSuspect(1970, "Respect Yourself (Demo Version)", 2023), /released 2023, against the 1970/);
  assert.equal(versionSuspect(1970, "Respect Yourself (Demo Version)", 2023, 2023), null, "the writer said it was first issued then");
});

test("an archival album in a folder keeps its first-release year and, when known, the year recorded", () => {
  const f = cleanResearch({ artist: "Isaac Hayes", albums: [{ title: "Isaac Hayes at Wattstax", year: "2003", live: true, recorded: "1972" },
    { title: "Hot Buttered Soul", year: "1969", recorded: "around then" }] });
  assert.deepEqual(f.albums, [{ title: "Isaac Hayes at Wattstax", year: "2003", live: true, recorded: "1972" },
    { title: "Hot Buttered Soul", year: "1969" }]);
});
