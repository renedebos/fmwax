// SESSIONS (MC-35, the owner, 2026-10-26): bands live in a small room, from
// the series the owner chose, with a roll call gathered from MusicBrainz by
// series (tasks/rollcalls/sessions/) and something new looked for each set.
import { test } from "node:test";
import assert from "node:assert/strict";

import { PERSONAS, ROSTER, DJ_ASKS, GLANCE, TUNE, WHICH, WHICH_SCRIPTS, WHICH_NEEDS } from "../djs.js";
import { ROLL_CALLS } from "../rollcalls.js";
import { rollCallSlice } from "../rollcall.js";
import { backendPrompt } from "../voice.js";
import { TOOLS } from "../toollist.js";

const SERIES = ["Peel Session", "BBC", "MTV Unplugged", "Tiny Desk", "2 Meter Sessions", "Spotify Sessions",
  "Audiotree Live", "Austin City Limits", "Like A Version", "VH1 Storytellers"];

test("Sessions is on the roster, with every table a DJ needs", () => {
  const p = PERSONAS.sessions;
  assert.equal(p.name, "Sessions");
  assert.ok(ROSTER.sessions, "it can hold a preset");
  assert.ok(DJ_ASKS.sessions.asks.length === 3 && DJ_ASKS.sessions.not_for);
  assert.ok(GLANCE.sessions && TUNE.sessions && WHICH.sessions);
  assert.ok(WHICH_SCRIPTS.some((s) => s.id === WHICH.sessions.script));
  assert.ok(WHICH_NEEDS.some(([, djs]) => djs.includes("sessions")));
  assert.equal(p.needsWords, undefined, "plays without being told what");
});

test("its brief: every song a session take, never the record, junk named, new each set, spread across the series", () => {
  const b = PERSONAS.sessions.brief;
  for (const series of ["John Peel", "Maida Vale", "MTV Unplugged", "Tiny Desk", "2 Meter Sessies", "Spotify Sessions",
    "Audiotree Live", "Austin City Limits", "Like A Version", "VH1 Storytellers"]) assert.ok(b.includes(series), series);
  assert.match(b, /EVERY SONG IS A TAKE FROM ONE OF THEM, never the studio record/);
  assert.match(b, /NEVER a karaoke or tribute version[^]*'Tiny\s+Desk Contest' entry, a festival stage[^]*concert album/);
  assert.match(b, /choose another act, never the record instead/);
  assert.match(b, /SOMETHING NEW IN EVERY SET[^]*last month/);
  assert.match(b, /at least four series in an hour[^]*Audiotree\s+Live, the biggest, no more than a quarter/);
  assert.match(PERSONAS["deep-dive"].brief, /AGAINST SESSIONS/);
});

test("its roll call: every series, a broad ask crosses them, a named series keeps to it", () => {
  const rc = ROLL_CALLS.sessions;
  assert.ok(rc.in.length > 2000 && rc.gathered && rc.spread);
  const groups = new Set(rc.in.map((e) => e.group));
  for (const s of SERIES) assert.ok(groups.has(s), s);
  assert.ok(!rc.in.some((e) => /^\d{4}[-‐–]\d{2}[-‐–]\d{2}\b/.test(e.reason.split(": ")[1]?.replace(/^'/, "") ?? "")), "no broadcast tapes");
  assert.ok(!rc.in.some((e) => /karaoke|festival|contest/i.test(e.reason)), "no karaoke, festival stages or contest entries");

  const broad = rollCallSlice("sessions", { words: "", seed: "a" });
  const seen = new Set(broad.fits.map((l) => l.match(/\[([^\]]+)\]$/)?.[1]));
  assert.ok(seen.size >= 8, `a broad slice crosses the series: ${[...seen].join(", ")}`);
  assert.match(broad.note, /gathered from MusicBrainz [\d-]+, not read one by one/);

  const desk = rollCallSlice("sessions", { words: "tiny desk", seed: "a" }).fits;
  assert.ok(desk.filter((l) => l.endsWith("[Tiny Desk]")).length >= 10, "an ask that names a series keeps to it");
  const unplugged = rollCallSlice("sessions", { words: "something unplugged", seed: "a" }).fits;
  assert.ok(unplugged.every((l) => l.endsWith("[MTV Unplugged]")), "'something' matches no band called Something");
});

test("Talk and the tools send anything live to Sessions", () => {
  const p = backendPrompt({ devices: ["Pro Plus"], defaultDevice: "Pro Plus", endless: [{ name: "Vibe", btn: 9 }] });
  assert.match(p, /LIVE IN A SMALL ROOM[^]*is Sessions: play_endless with dj "Sessions"/);
  const play = TOOLS.find((t) => t.name === "play_endless");
  assert.match(play.description, /LIVE VERSIONS, a band in a small room[^]*are Sessions/);
});
