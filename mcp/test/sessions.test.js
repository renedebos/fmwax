// SESSIONS (MC-35, the owner, 2026-10-26): bands live in a small room, from
// the series the owner chose, with a roll call gathered from MusicBrainz by
// series (tasks/rollcalls/sessions/) and something new looked for each set.
import { test } from "node:test";
import assert from "node:assert/strict";

import { PERSONAS, ROSTER, DJ_ASKS, GLANCE, TUNE, WHICH, WHICH_SCRIPTS, WHICH_NEEDS } from "../djs.js";
import { ROLL_CALLS } from "../rollcalls.js";
import { decadeOf, rollCallSlice } from "../rollcall.js";
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
  // The eleventh series, and the best-ofs the roll call cannot carry (the owner, 2026-10-30).
  assert.ok(b.includes("Sessions at West 54th"));
  assert.ok(b.includes("Live at Third Man Records"), "a label's own room, the one series that is not radio or TV");
  assert.match(b, /or a label's own small room/);
  // Rockpalast filmed halls and open-air shows too, so only a room the title names
  // (the owner, 2026-10-30: "if we can filter out the large venues").
  assert.match(b, /ROCKPALAST ONLY FROM A SMALL ROOM[^]*WDR Studio L[^]*Harmonie Bonn[^]*Zeche Bochum[^]*Markthalle Hamburg/);
  assert.match(b, /Never Grugahalle or anything from Essen, Loreley, Dortmund, or a set that names no room/);
  assert.match(b, /go by the track's own title/);
  // "Unplugged" alone is often not the show, so only the albums the household ticked.
  assert.match(b, /AN ALBUM CALLED UNPLUGGED IS NOT ALWAYS THE MTV SHOW[^]*album:unplugged[^]*stays out/);
  assert.match(b, /A BEST-OF COUNTS when its title names the series[^]*The Best Of Sessions At West 54th[^]*The Best Of Austin City Limits[^]*search for them by name/);
  assert.match(b, /NEVER a karaoke or tribute version[^]*'Tiny\s+Desk Contest' entry, a festival stage[^]*concert album/);
  assert.match(b, /choose another act, never the record instead/);
  assert.match(b, /SOMETHING NEW IN EVERY SET[^]*last month/);
  assert.match(b, /at least four series in an hour[^]*Audiotree\s+Live, the biggest, no more than a quarter/);
  assert.match(PERSONAS["deep-dive"].brief, /AGAINST SESSIONS/);
  // The owner, 2026-10-26: "only 60's bands? Or only hip-hop?" Both fences.
  assert.match(b, /so are years and a genre \('sixties bands', 'only\s+hip-hop'\): then the spread is within what the fence leaves/);
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
  assert.ok(unplugged.every((l) => /\[(MTV )?Unplugged\]$/.test(l)), "'something' matches no band called Something");
  // The list knows no genre (2026-10-26: "only hip-hop" brought The Only Ones
  // and "God Only Knows"): words outside the series' own leave a broad spread.
  const hiphop = rollCallSlice("sessions", { words: "only hip-hop", seed: "a" }).fits;
  assert.ok(!hiphop.some((l) => /\bOnly\b|Hipp/.test(l)), hiphop.join("\n"));
  assert.ok(new Set(hiphop.map((l) => l.match(/\[([^\]]+)\]$/)?.[1])).size >= 6, "a spread instead");
  assert.ok(rollCallSlice("sessions", { words: "The Fall, Peel sessions", seed: "a" }).fits[0].startsWith("The Fall"), "an act named in full still leads");
});

test("Talk and the tools send anything live to Sessions", () => {
  const p = backendPrompt({ devices: ["Pro Plus"], defaultDevice: "Pro Plus", endless: [{ name: "Vibe", btn: 9 }] });
  assert.match(p, /LIVE IN A SMALL ROOM[^]*is Sessions: play_endless with dj "Sessions"/);
  const play = TOOLS.find((t) => t.name === "play_endless");
  assert.match(play.description, /LIVE VERSIONS, a band in a small room[^]*are Sessions/);
});

// THE HOUSEHOLD'S TICKS (2026-10-31, tasks/rollcalls/unplugged/): albums called
// Unplugged that the "MTV Unplugged" search could not find, each one chosen by hand.
test("the roll call carries the ticked Unplugged albums, and an ask for them reaches them", () => {
  const rows = ROLL_CALLS.sessions.in.filter((e) => e.group === "Unplugged");
  assert.equal(rows.length, 99, "acts");
  const has = (name) => rows.find((e) => e.name === name);
  for (const name of ["Eric Clapton", "Neil Young", "Rod Stewart", "Alanis Morissette", "The Corrs", "Wirtz"]) assert.ok(has(name), name);
  assert.match(has("Eric Clapton").reason, /^Unplugged: 'Unplugged \(Live\)'/);
  for (const name of ["Megadeth", "Pegasus", "Life Of Agony", "YUNGBLUD"]) assert.ok(!has(name), `${name} was unticked`);
  assert.ok(ROLL_CALLS.sessions.in.some((e) => e.group === "MTV Unplugged"), "the MTV series stays its own");
  const fits = (words) => rollCallSlice("sessions", { words, seed: "t" })?.fits ?? [];
  assert.ok(fits("Eric Clapton unplugged").some((l) => /^Eric Clapton\b/.test(l)), "named in full");
  assert.ok(fits("only unplugged").some((l) => /\[Unplugged\]/.test(l)), "an ask for unplugged reaches the group");
});

// THE "70'S HITS" AUDIT (the owner, 2026-11-02): 23 of 28 songs from the series,
// every counted rule held, and still 14 acts, nothing new and half of it Queen,
// Rod Stewart, Fleetwood Mac, Neil Young and Bowie. The owner's answers:
test("a small room outside the series counts: named, capped, and never over a series the listener named", () => {
  const b = PERSONAS.sessions.brief;
  assert.match(b, /A SMALL ROOM OUTSIDE THE SERIES COUNTS TOO, at most two songs an hour/);
  assert.match(b, /title or album names a club of about 1,000 people or\s+fewer/);
  assert.match(b, /or a TV or radio studio \('Live at Warner\s+Brothers Studios', 'Live On MTV'\)/);
  for (const room of ["Troubadour", "the Roxy", "the Bottom Line", "the El Mocambo", "Tipitina's", "the Stone Pony"]) assert.ok(b.includes(room), room);
  assert.match(b, /A bare 'Live' names nothing, and a\s+room you cannot place stays out/);
  assert.match(b, /Bigger rooms stay out however loved:\s+Paradiso, the Apollo, the Bataclan, the Fillmore East, the Ryman/);
  assert.match(b, /not among the four series an hour, and when the listener\s+names a series there are none/);
});

test("a decade ask: its songs in sessions of any year, mostly real hits, a newer band's cover among them", () => {
  const b = PERSONAS.sessions.brief;
  assert.match(b, /'Seventies\s+hits' is the songs of the seventies, in sessions of any year, and a\s+newer band's cover of one counts/);
  assert.match(b, /An ask for hits is mostly\s+real hits, lesser-known acts who had one among them, with a few\s+well-known album tracks/);
  assert.match(b, /Under a\s+fence of years that is a recent cover[^]*If nothing recent fits, leave it out and say so/);
  assert.match(b, /No other series more\s+than a third of a set, the BBC's and Peel's counted as one, unless the\s+listener named it/);
  assert.match(b, /On an endless\s+list, no act from the last two batches \(a job's acts_last_batches\s+names them\), unless the ask leaves too few acts/);
  assert.equal(PERSONAS.sessions.spacing.batchActs, 2, "and the house counts it, two batches back");
});

test("the roll call reads a decade however it is written", () => {
  for (const words of ["70's hits", "70s hits", "the '70s", "1970s hits", "1970's", "seventies hits", "70’s"]) assert.equal(decadeOf(words), 1970, words);
  assert.equal(decadeOf("Peel sessions from the eighties"), 1980);
  assert.equal(decadeOf("sixties bands"), 1960);
  assert.equal(decadeOf("90s"), 1990);
  assert.equal(decadeOf("the 2000s"), 2000);
  assert.equal(decadeOf("00s indie"), 2000);
  for (const words of ["", "45 minutes", "an hour of 100s of songs", "1975", "only hip-hop", "the Sixtieth"]) assert.equal(decadeOf(words), null, words);
});

test("a decade alone fills half the slice from its sessions, and the rest stays the spread across the series", () => {
  const year = (l) => Number(l.match(/\((\d{4})/)?.[1]);
  for (const seed of ["a", "b", "c", "d"]) {
    const { fits } = rollCallSlice("sessions", { words: "70's hits", seed });
    assert.equal(fits.length, 12);
    const first = fits.slice(0, 6);
    assert.ok(first.every((l) => /\((19[0-9]{2})/.test(l)), "the decade's lines lead");
    const lines = ROLL_CALLS.sessions.in.filter((e) => first.some((l) => l.startsWith(`${e.name} (`)));
    assert.ok(lines.some((e) => /197\d/.test(e.years)), "and they are the seventies'");
    assert.ok(first.every((l) => year(l) <= 1979));
    assert.ok(new Set(fits.map((l) => l.match(/\[(.*)\]$/)?.[1])).size >= 3, "never one series");
  }
  const same = (words) => rollCallSlice("sessions", { words, seed: "x" }).fits;
  assert.deepEqual(same("70s hits"), same("seventies hits"), "one decade, however it is written");
  assert.notDeepEqual(same("70s hits"), same("hits"), "it was the same spread as no words at all");
});

test("a series and a decade together: that series from that decade first", () => {
  const { fits } = rollCallSlice("sessions", { words: "Peel sessions from the eighties", seed: "a" });
  assert.ok(fits.every((l) => /\[Peel Session\]$/.test(l)), "all Peel");
  assert.ok(fits.slice(0, 6).every((l) => /\(19[78]\d/.test(l)), "and the eighties'");
});

test("an act heard lately gives way in a decade's slice too", () => {
  const seventies = ROLL_CALLS.sessions.in.filter((e) => /197\d/.test(e.years ?? "")).map((e) => e.name);
  const recent = seventies.slice(0, 40).map((n) => `${n} — A Song`);
  const { fits } = rollCallSlice("sessions", { words: "70's hits", seed: "a", recent });
  assert.ok(fits.slice(0, 6).every((l) => !seventies.slice(0, 40).some((n) => l.startsWith(`${n} (`))));
});
