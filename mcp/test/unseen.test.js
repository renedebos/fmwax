// WHAT A WIIM MAY PLAY THAT SPOTIFY CANNOT SEE, IN THE HOUSE'S OWN WORDS
// (2026-11-25, the owner: a house with Spotify alone read "Tidal, the radio
// or the archive" on its bar, its TV and its help). Tidal only where a preset
// of the house is on Tidal, the archive only where the house has its preset.

import { test } from "node:test";
import assert from "node:assert/strict";

import { unseenWords } from "../house.js";
import { barWords, helperSays, renderSay } from "../programs.js";
import { tvBand } from "../tv.js";
import { buttons, TWO_REQUESTS } from "./harness.js";

const SPOTIFY_ONLY = { BUTTONS: JSON.stringify([TWO_REQUESTS[0], { button: 4, dj: "hank", playlist: "HHHHHHHHHHHHHHHHHHHHH4", catalog: "spotify" }]) };
const WITH_TIDAL = { BUTTONS: JSON.stringify([...TWO_REQUESTS, { button: 4, dj: "hank", playlist: "HHHHHHHHHHHHHHHHHHHHH4", catalog: "spotify" }]) };
const WITH_ARCHIVE = { BUTTONS: buttons({ 4: "HHHHHHHHHHHHHHHHHHHHH4", 6: true }) };
const WITH_BOTH = { BUTTONS: JSON.stringify([...TWO_REQUESTS, ...JSON.parse(buttons({ 6: true }))]) };

test("the words follow the house: Tidal only with a Tidal preset, the archive only with its preset", () => {
  assert.deepEqual(unseenWords(SPOTIFY_ONLY), { or: "the radio or another service", and: "the radio and other services", tidal: false });
  assert.deepEqual(unseenWords(WITH_TIDAL), { or: "Tidal or the radio", and: "Tidal and the radio", tidal: true });
  assert.deepEqual(unseenWords(WITH_ARCHIVE), { or: "the radio or the archive", and: "the radio and the archive", tidal: false });
  assert.deepEqual(unseenWords(WITH_BOTH), { or: "Tidal, the radio or the archive", and: "Tidal, the radio and the archive", tidal: true });
  assert.deepEqual(unseenWords({}), { or: "the radio or another service", and: "the radio and other services", tidal: false }, "no presets read: neither");
});

test("a Spotify-only house is not told of Tidal: the bar, the house mark, the TV and What to say", () => {
  const unseen = unseenWords(SPOTIFY_ONLY);
  assert.equal(barWords({ state: "quiet", speaker: "Pro Plus", unseen }).two, "The radio or another service — only the speaker knows");
  assert.equal(barWords({ state: "quiet", unseen }).two, "Quiet, or the radio or another service — only the speaker knows");
  assert.equal(helperSays({ helper: "on", lan: { at: 1, speakers: {} }, unseen }).more, "The radio and other services show on Speakers and the bar.");
  const room = { name: "Pro Plus", slug: "pro-plus", wiim: true, other: false };
  const quiet = tvBand({ state: "quiet", unseen, lan: { speakers: {} } }, room, 0);
  assert.equal(quiet.line2, "The radio or another service may be playing: only the speaker knows. Press a preset above to start one.");
  assert.match(tvBand({ state: "quiet", unseen: unseenWords(WITH_TIDAL), lan: { speakers: {} } }, room, 0).line2, /^Tidal or the radio may be playing/);
  const say = renderSay({ base: "/b/k", talk: true, presses: true, unseen });
  // What the page says (the now bar's hidden Tidal door and its script aside).
  const text = say.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /Tidal/);
  assert.match(say, /a DJ, the radio, with any settings saved with it/);
  assert.match(say, /the station or the song on the radio or another service\./);
  const sayT = renderSay({ base: "/b/k", talk: true, presses: true, unseen: unseenWords(WITH_TIDAL) });
  assert.match(sayT, /a DJ, Tidal, the radio, with any settings/);
  assert.match(sayT, /the station or the song on Tidal or the radio\./);
});

// THE PLAY HISTORY'S LABELS (2026-11-27): a preset of the house by its
// number and who is on it, never by a legacy alias of the same playlist.
test("recently_played's labels: a DJ's endless list, the guest's and the requests' by their preset, an old list by its alias", async () => {
  const { contextLabel } = await import("../house.js");
  const env = {
    BUTTONS: JSON.stringify([TWO_REQUESTS[0]]),
    ENDLESS: JSON.stringify({ mode: "live", presets: [
      { button: 4, dj: "dr-funkenstein", playlist: "FFFFFFFFFFFFFFFFFFFFF4" },
      { button: 3, lane: true, playlist: "LLLLLLLLLLLLLLLLLLLLL3" }] }),
    PLAYLIST_ALIASES: JSON.stringify({ "was button 4": "FFFFFFFFFFFFFFFFFFFFF4", "was button 9": "OOOOOOOOOOOOOOOOOOOOO9" }),
  };
  assert.equal(contextLabel(env, "spotify:playlist:FFFFFFFFFFFFFFFFFFFFF4"), "button 4 (Dr. Funkenstein)");
  assert.equal(contextLabel(env, "spotify:playlist:LLLLLLLLLLLLLLLLLLLLL3"), "button 3 (the guest DJ)");
  assert.equal(contextLabel(env, `spotify:playlist:${TWO_REQUESTS[0].playlist}`), "button 1 (Requests · Spotify)");
  assert.equal(contextLabel(env, "spotify:playlist:OOOOOOOOOOOOOOOOOOOOO9"), "was button 9", "a list on no preset keeps its alias");
  assert.equal(contextLabel(env, "spotify:playlist:NNNNNNNNNNNNNNNNNNNNNN", new Map([["NNNNNNNNNNNNNNNNNNNNNN", "Mine"]])), '"Mine"');
  assert.equal(contextLabel(env, "spotify:album:4aawyAB9vmqN3uQ7FjRGTy"), "a Spotify album");
});
