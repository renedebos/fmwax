// MC-38 STAGE 2, HOUSE RADIO READS THE WORDS (alexa-read.js): the speaker,
// the length and the leave-out picked out of what Alexa wrote, the rest kept
// as said. The first table is every sentence the Living Room Echo sent in
// stage 1 (2026-11-07), as Alexa wrote it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { readWords } from "../alexa-read.js";

const ROOMS = ["Pro Plus", "Ultra", "Everywhere", "Master Bedroom", "Dining Room", "Living Room", "Office", "Office2", "Den", "iPhone"];
const read = (w) => readWords(w, { rooms: ROOMS, fallback: "Pro Plus" });
const pick = (r) => ({ words: r.words, minutes: r.minutes, avoid: r.avoid, device: r.device });

test("stage 1's real words: the speaker, the length and the leave-out out, the rest as said", () => {
  const cases = [
    ["something loud on the pro plus", { words: "something loud", minutes: 60, avoid: null, device: "Pro Plus" }],
    ["2 hours", { words: "", minutes: 120, avoid: null, device: "Pro Plus" }],
    ["on the ultra", { words: "", minutes: 60, avoid: null, device: "Ultra" }],
    ["blue note jazz", { words: "blue note jazz", minutes: 60, avoid: null, device: "Pro Plus" }],
    ["no eagles", { words: "", minutes: 60, avoid: "eagles", device: "Pro Plus" }],
    ["a classic album site", { words: "a classic album site", minutes: 60, avoid: null, device: "Pro Plus" }],
    ["Memphis horns in the living room", { words: "memphis horns", minutes: 60, avoid: null, device: "Living Room" }],
    ["on Solomon Burke", { words: "solomon burke", minutes: 60, avoid: null, device: "Pro Plus" }],
    ["19s 90s shoegaze", { words: "19s 90s shoegaze", minutes: 60, avoid: null, device: "Pro Plus" }],
    ["acoustic grunge on the ultra", { words: "acoustic grunge", minutes: 60, avoid: null, device: "Ultra" }],
    ["half an hour", { words: "", minutes: 30, avoid: null, device: "Pro Plus" }],
    ["mellow for dinner", { words: "mellow for dinner", minutes: 60, avoid: null, device: "Pro Plus" }],
    ["acoustic grunge", { words: "acoustic grunge", minutes: 60, avoid: null, device: "Pro Plus" }],
  ];
  for (const [said, want] of cases) assert.deepEqual(pick(read(said)), want, said);
});

test("where the speaker came from, and the house's own spelling of it", () => {
  assert.equal(read("acoustic grunge on the ultra").deviceFrom, "words");
  assert.equal(read("acoustic grunge").deviceFrom, "default");
  assert.equal(read("late jazz in office two").device, "Office2");
  assert.equal(read("something on the iphone").device, "iPhone");
  assert.equal(read("in the master bedroom something quiet").device, "Master Bedroom");
  // Everywhere may come bare: it is one of the speakers.
  assert.deepEqual(pick(read("everywhere")), { words: "", minutes: 60, avoid: null, device: "Everywhere" });
  // The last one named is the speaker; one inside the taste stays taste only
  // when another is named after it.
  assert.deepEqual(pick(read("songs about the ultra on the pro plus")),
    { words: "songs about the ultra", minutes: 60, avoid: null, device: "Pro Plus" });
  // Not a speaker of the list: words.
  assert.deepEqual(pick(read("music on the kitchen radio")),
    { words: "music on the kitchen radio", minutes: 60, avoid: null, device: "Pro Plus" });
  // Bare (2026-11-08, "Sessions … living room" came as the words "living
  // room"): the whole of the words, or a name of two words or more at
  // their end; a one-word name at the end stays taste.
  assert.deepEqual(pick(read("living room")), { words: "", minutes: 60, avoid: null, device: "Living Room" });
  assert.deepEqual(pick(read("the master bedroom")), { words: "", minutes: 60, avoid: null, device: "Master Bedroom" });
  assert.deepEqual(pick(read("acoustic piano living room")), { words: "acoustic piano", minutes: 60, avoid: null, device: "Living Room" });
  assert.deepEqual(pick(read("den")), { words: "", minutes: 60, avoid: null, device: "Den" });
  assert.deepEqual(pick(read("songs for my den")), { words: "songs for my den", minutes: 60, avoid: null, device: "Pro Plus" });
  // Said with "on", the whole of "on the pro plus" is taken, never its tail.
  assert.equal(read("something loud on the pro plus").words, "something loud");
  // "ultra" inside a word is no speaker.
  assert.equal(read("on the ultraviolet").device, "Pro Plus");
  // A house with no default and none said: no speaker.
  assert.equal(readWords("jazz", { rooms: ROOMS }).device, null);
});

test("lengths in digits or words, snapped to the form's four; no unit, no length", () => {
  const minutes = (w) => read(w).minutes;
  assert.equal(minutes("ninety minutes of soul"), 90);
  assert.equal(minutes("90 minutes of soul"), 90);
  assert.equal(minutes("an hour and a half of jazz"), 90);
  assert.equal(minutes("hour and a half"), 90);
  assert.equal(minutes("one and a half hours"), 90);
  assert.equal(minutes("1.5 hours"), 90);
  assert.equal(minutes("for one hour"), 60);
  assert.equal(minutes("two hours"), 120);
  assert.equal(minutes("3 hours"), 120);
  // A tie goes up, as the form's own askMinutes has it.
  assert.equal(minutes("forty five minutes"), 60);
  assert.equal(minutes("20 minutes"), 30);
  assert.equal(minutes("a half hour"), 30);
  assert.equal(read("ninety minutes of soul").words, "soul");
  assert.equal(read("acoustic grunge for two hours").words, "acoustic grunge");
  assert.equal(read("2 hours").lengthSaid, true);
  assert.equal(read("blue note jazz").lengthSaid, false);
  // Numbers that are no length.
  assert.equal(read("19s 90s shoegaze").lengthSaid, false);
  assert.equal(read("top 40 hits").words, "top 40 hits");
});

test("a leave-out runs from no, without or not to the end; nothing inside a word", () => {
  assert.deepEqual(pick(read("soul on the ultra for ninety minutes without ballads")),
    { words: "soul", minutes: 90, avoid: "ballads", device: "Ultra" });
  assert.deepEqual(pick(read("country and no eagles")), { words: "country", minutes: 60, avoid: "eagles", device: "Pro Plus" });
  assert.deepEqual(pick(read("not too loud")), { words: "", minutes: 60, avoid: "too loud", device: "Pro Plus" });
  assert.equal(read("nothing but soul").avoid, null);
  assert.equal(read("nothing but soul").words, "nothing but soul");
  assert.equal(read("a set with nobody famous").avoid, null);
  // "no" with nothing after it leaves nothing out.
  assert.equal(read("say no").avoid, null);
});

test("how it is asked: endless at the end, keep it, a fresh start, now or after this song", () => {
  const how = (w) => { const r = read(w); return { words: r.words, endless: !!r.endless, fresh: !!r.fresh, keep: !!r.keep, when: r.when ?? null }; };
  assert.deepEqual(how("on michael jackson endless"), { words: "michael jackson", endless: true, fresh: false, keep: false, when: null });
  assert.deepEqual(how("1971 all night"), { words: "1971", endless: true, fresh: false, keep: false, when: null });
  assert.deepEqual(how("eighties new wave endless now"), { words: "eighties new wave", endless: true, fresh: false, keep: false, when: "now" });
  assert.deepEqual(how("fresh"), { words: "", endless: false, fresh: true, keep: false, when: null });
  assert.deepEqual(how("a fresh start"), { words: "", endless: false, fresh: true, keep: false, when: null });
  assert.deepEqual(how("acoustic grunge and keep it"), { words: "acoustic grunge", endless: false, fresh: false, keep: true, when: null });
  assert.deepEqual(how("now"), { words: "", endless: false, fresh: false, keep: false, when: "now" });
  assert.deepEqual(how("after this song"), { words: "", endless: false, fresh: false, keep: false, when: "next" });
  // Codex's review (2026-11-08): "keep it" only said last, a fresh start only
  // as the whole, and a bare room still found before "endless" or a length.
  assert.deepEqual(how("songs to keep it mellow"), { words: "songs to keep it mellow", endless: false, fresh: false, keep: false, when: null });
  assert.deepEqual(how("keep it mellow"), { words: "keep it mellow", endless: false, fresh: false, keep: false, when: null });
  assert.deepEqual(how("a fresh set of honky tonk"), { words: "a fresh set of honky tonk", endless: false, fresh: false, keep: false, when: null });
  assert.deepEqual(how("gatefold 1971 endless and keep it"), { words: "gatefold 1971", endless: true, fresh: false, keep: true, when: null });
  assert.equal(read("acoustic piano living room endless").device, "Living Room");
  assert.equal(read("acoustic piano living room endless").words, "acoustic piano");
  assert.equal(read("acoustic piano living room for two hours").device, "Living Room");
  // Taste that only holds the words stays taste.
  assert.deepEqual(how("fresh produce"), { words: "fresh produce", endless: false, fresh: false, keep: false, when: null });
  assert.deepEqual(how("songs from right now"), { words: "songs from right now", endless: false, fresh: false, keep: false, when: null });
  assert.deepEqual(how("endless love ballads"), { words: "endless love ballads", endless: false, fresh: false, keep: false, when: null });
  assert.equal(read("acoustic grunge endless on the ultra").device, "Ultra");
});
