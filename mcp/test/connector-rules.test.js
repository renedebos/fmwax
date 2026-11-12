// TALK'S RULES IN THE CONNECTOR (MC-31 stage 1, 2026-10-16). The Claude app
// reads only the tools' descriptions (measured 2026-10-14: it ignores a
// connector's instructions), so the house rules Talk has in its prompt
// (voice.js backendPrompt) are said in the descriptions of the tools they
// govern. One line each here, so a rewrite of a description cannot drop one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { TOOLS } from "../toollist.js";

const said = (name) => TOOLS.find((t) => t.name === name)?.description ?? "";

test("the connector's tools carry Talk's house rules", () => {
  // Where a set goes: a DJ's set on the Requests preset, with dj and ask.
  assert.match(said("play_uris"), /A set asked of a DJ by name is not this tool/);
  assert.match(said("replace_playlist"), /'Play me' asked of a DJ is this tool with `play: true`/);
  assert.match(said("replace_playlist"), /"guest on spotify" or "guest on tidal" \(the requests presets; get_dj names their numbers\)/);
  // Steering, never a rewrite, while an endless DJ plays.
  assert.match(said("replace_playlist"), /is steer_endless, never this/);
  assert.match(said("steer_endless"), /never replace_playlist, and needs no\s+confirmation/);
  // Endless asks: a style to the DJ who owns it; never a one-off list.
  assert.match(said("play_endless"), /A STYLE OR A DIRECTION asked endless/);
  assert.match(said("play_endless"), /Never a one-off list/);
  // The archive.
  assert.match(said("search_archive"), /never search_tracks/);
  assert.match(said("search_archive"), /several nights/);
  assert.match(said("play_archive"), /Never say it is playing unless `started` is true/);
  // Volume and mute.
  assert.match(said("playback_control"), /THERE IS NO MUTE/);
});

// SAID CALMLY (the test house run, findings 5, 6 and 12, 2026-11-11): ChatGPT
// showed a red "Suspicious Instruction" box over the write tools' words
// ("instructions attempting to steer the classifier"), wrote "play me" and
// did not play it, and played a DJ's set as a loose queue. The three tools a
// first set goes through give no orders in capitals, say nothing about
// approvals or asking, and no longer tell a write to stop.
test("the play and write tools' words give no orders in capitals and say nothing of approvals", () => {
  for (const name of ["play_uris", "play_playlist", "replace_playlist"]) {
    const d = said(name);
    const shouted = d.match(/\b[A-Z]{2,}(?:[ ,'’-]+[A-Z]{2,})+\b/g) ?? [];
    assert.deepEqual(shouted, [], `${name} shouts: ${shouted.join(" | ")}`);
    assert.doesNotMatch(d, /approval|without asking|do not ask|permission/i, `${name} speaks of approvals`);
    assert.doesNotMatch(d, /NOT THIS TOOL|AFTERWARDS, STOP|THIS IS HOW YOU/, name);
  }
  const rp = TOOLS.find((t) => t.name === "replace_playlist").inputSchema.properties;
  assert.equal(rp.play.type, "boolean");
  assert.match(rp.play.description, /asked to hear the set now/);
  assert.match(TOOLS.find((t) => t.name === "play_uris").inputSchema.properties.dj.description, /nothing plays/);
});
