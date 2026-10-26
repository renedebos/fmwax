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
  assert.match(said("play_uris"), /A SET ASKED OF A DJ BY NAME IS NOT THIS TOOL/);
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
