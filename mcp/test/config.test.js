// wrangler.toml is generated, and this is what keeps that true.
//
// The config the deploy reads is rendered from house.json and the template.
// Nothing stops someone editing the rendered file directly — so the first test
// here compares it to a fresh render, byte for byte, and fails if they have
// drifted. The rest pin the shapes a DIFFERENT household needs: no domain, one
// service, the request pipe off, no archive. Those are exactly the houses this
// one cannot test by existing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

import {
  render, renderBlankHouse, renderButtonHouse, renderHouse, viewOf, HOUSE_FILE, TEMPLATE_FILE, CONFIG_FILE,
} from "../install/config.js";

const HOUSE = JSON.parse(readFileSync(HOUSE_FILE, "utf8"));
const TEMPLATE = readFileSync(TEMPLATE_FILE, "utf8");

// A house that is not this one: no domain, Spotify only, pipe off, no archive.
const plain = () => ({
  worker: { name: "house-dj", compatibilityDate: "2025-06-01" },
  site: { baseUrl: "https://house-dj.example.workers.dev", routes: [] },
  kv: { TOKENS: "a".repeat(32), PROGRAMS: "b".repeat(32) },
  devices: { default: "Kitchen", rooms: ["Kitchen"] },
  tidal: { country: null },
  buttons: [{ button: 1, dj: "hank", playlist: "x".repeat(22), catalog: "spotify" }],
  aliases: { replay: "z".repeat(22) },
  requests: { enabled: false, autofulfill: false },
});

test("the committed wrangler.toml is exactly what house.json renders", () => {
  // If this fails, someone edited wrangler.toml by hand — or house.json and
  // forgot to run it. `npm run config` is the fix either way; read the diff
  // first, because the hand edit may be the change that was wanted.
  assert.equal(readFileSync(CONFIG_FILE, "utf8"), renderHouse(),
    "wrangler.toml is stale — run: npm run config");
});

test("every answer in house.json reaches the config", () => {
  const out = renderHouse();
  assert.match(out, new RegExp(`name = "${HOUSE.worker.name}"`));
  assert.match(out, new RegExp(`PROGRAM_BASE_URL = "${HOUSE.site.baseUrl}"`));
  for (const [k, id] of Object.entries(HOUSE.kv)) {
    if (k.startsWith("_")) continue; // the file's own notes, not an answer
    assert.ok(out.includes(id), k);
  }
  for (const b of HOUSE.buttons) {
    assert.ok(out.includes(b.archive ? `button = ${b.button}, archive` : b.playlist),
      `button ${b.button}`);
  }
  // And no placeholder survived. A stray {{…}} would deploy as a literal.
  assert.ok(!/\{\{|#\{\{/.test(out), "an unreplaced placeholder");
});

test("a house with no domain gets no routes block, and the workers.dev address instead", () => {
  const out = render(plain(), TEMPLATE);
  assert.ok(!out.includes("routes = ["), "no routes");
  assert.ok(!out.includes("custom_domain"), "nor the phrase");
  assert.ok(!out.includes("Custom Domains rather than"), "nor a comment about a domain it has not got");
  assert.match(out, /PROGRAM_BASE_URL = "https:\/\/house-dj\.example\.workers\.dev"/);
  assert.ok(out.includes("workers_dev = true"), "and the free hostname stays on");
});

test("a house names its Cloudflare account only when house.json does, and only a real account id (2026-10-25)", () => {
  assert.ok(!render(plain(), TEMPLATE).includes("account_id"), "no account, no line: a deploy uses the sign-in's one account");
  const named = render({ ...plain(), worker: { ...plain().worker, accountId: "0123456789abcdef0123456789abcdef" } }, TEMPLATE);
  assert.match(named, /^account_id = "0123456789abcdef0123456789abcdef"$/m);
  assert.throws(() => render({ ...plain(), worker: { ...plain().worker, accountId: "my-account@example.com" } }, TEMPLATE),
    /worker\.accountId is not a Cloudflare account id/);
});

test("MC-29's switch: the kept player answer is on unless house.json says player.reuse: false", () => {
  assert.ok(!render(plain(), TEMPLATE).includes("PLAYER_REUSE"), "on by saying nothing");
  assert.match(render({ ...plain(), player: { reuse: false } }, TEMPLATE), /\nPLAYER_REUSE = "off"\n/);
});

test("a house with the pipe off names no routine at all", () => {
  const out = render(plain(), TEMPLATE);
  assert.match(out, /REQUESTS_ENABLED = "false"/);
  assert.match(out, /AUTOFULFILL_ENABLED = "false"/);
  assert.ok(!out.includes("REQUEST_ROUTINE_ID"), "no routine");
  if (HOUSE.requests?.routine) assert.ok(!out.includes(HOUSE.requests.routine), "and certainly not this house's");
  // The ledger is bound anyway: unused it costs nothing, and one shape is
  // easier to reason about than two.
  assert.ok(out.includes('class_name = "StationLedger"'));
});

test("an old house.json that still names a GitHub doorbell repo renders no GitHub lines (gone 2026-10-23)", () => {
  const h = plain();
  h.requests = { enabled: true, autofulfill: true, repo: "someone/requests", branch: "main" };
  const out = render(h, TEMPLATE);
  assert.match(out, /REQUESTS_ENABLED = "true"/);
  assert.ok(!out.includes("REQUEST_EVENT_REPO") && !out.includes("someone/requests"));
});

test("no archive button means no archive lines, and a house with one names its own site AND index", () => {
  const full = {
    siteUrl: "https://tapes.example",
    mediaUrl: "https://media.tapes.example/stream",
    occurrencesUrl: "https://tapes.example/assets/song-occurrences.json",
    tracksUrl: "https://tapes.example/assets/track-spec.json",
  };
  const none = plain();
  none.archive = { ...full };
  assert.ok(!render(none, TEMPLATE).includes("ARCHIVE_SITE_URL"),
    "a site with no preset to park on is a line with no reader");
  const h = plain();
  h.archive = { ...full };
  h.buttons = [...h.buttons, { button: 6, archive: true }];
  const out = render(h, TEMPLATE);
  assert.match(out, /ARCHIVE_SITE_URL = "https:\/\/tapes\.example"/);
  // The INDEX travels with the site: all three or none. The archive was two
  // constants naming one household's domain until 2026-09-07, which put it in
  // every install and made the feature usable by exactly that household.
  assert.match(out, /ARCHIVE_OCCURRENCES_URL = "https:\/\/tapes\.example\/assets\/song-occurrences\.json"/);
  assert.match(out, /ARCHIVE_TRACKS_URL = "https:\/\/tapes\.example\/assets\/track-spec\.json"/);
  // The RECORDINGS' host is the fourth, and it was a constant in worker.js for
  // a day after the index stopped being one — so an archive was configurable
  // and still only readable by the household whose worker it named.
  assert.match(out, /ARCHIVE_MEDIA_URL = "https:\/\/media\.tapes\.example\/stream"/);
  // A half-configured archive renders NOTHING rather than blank strings: the
  // Worker can explain "no index configured" and cannot explain "".
  const half = plain();
  half.archive = { siteUrl: full.siteUrl };
  half.buttons = [...half.buttons, { button: 6, archive: true }];
  const halfOut = render(half, TEMPLATE);
  for (const k of ["ARCHIVE_SITE_URL =", "ARCHIVE_MEDIA_URL =",
                   "ARCHIVE_OCCURRENCES_URL =", "ARCHIVE_TRACKS_URL ="]) {
    assert.ok(!halfOut.includes(k), `site without index must not render ${k}`);
  }
});

test("no Tidal button means no TIDAL_COUNTRY, and a Tidal house says its own", () => {
  assert.ok(!render(plain(), TEMPLATE).includes("TIDAL_COUNTRY"));
  const h = plain();
  h.tidal = { country: "GB" };
  assert.match(render(h, TEMPLATE), /TIDAL_COUNTRY = "GB"/);
});

test("a Tidal-only house starts nothing from here, so it names no speakers", () => {
  const h = plain();
  h.devices = { default: null, rooms: [] };
  h.tidal = { country: "GB" };
  h.buttons = [{ button: 1, dj: "hank", playlist: "1d247dd4-62d8-4daf-a1d5-289f4845068b", catalog: "tidal" }];
  const out = render(h, TEMPLATE);
  // The var lines, not the word: ROOM_DEVICES is named in a comment further
  // down that explains what the library key can reach, and that stays true.
  assert.ok(!/^DEFAULT_DEVICE/m.test(out), "no default speaker");
  assert.ok(!/^ROOM_DEVICES/m.test(out), "nor an allow-list");
  assert.match(out, /catalog = "tidal"/);
});

test("the buttons render aligned, and a note sits above the line it explains", () => {
  const h = plain();
  h.buttons = [
    { button: 1, dj: "hank", playlist: "x".repeat(22), catalog: "spotify" },
    { button: 6, archive: true },
    { button: 12, dj: "the-librarian", playlist: "y".repeat(22), catalog: "spotify",
      note: ["why this one moved"] },
  ];
  const lines = render(h, TEMPLATE).split("\n").filter((l) => l.includes("button ="));
  // The single-digit rows carry the extra space AFTER the comma, so `playlist`
  // starts in the same column on every row.
  const at = lines.filter((l) => l.includes("playlist")).map((l) => l.indexOf("playlist"));
  assert.equal(new Set(at).size, 1, `playlist column ragged: ${at}`);
  assert.ok(lines.some((l) => /\{ button = 6,\s+archive = true \},/.test(l)));
  assert.match(render(h, TEMPLATE), /  # why this one moved\n  \{ button = 12,/);
});

test("a missing answer fails loudly rather than rendering a hole", () => {
  const h = plain();
  delete h.site.baseUrl;
  assert.throws(() => render(h, TEMPLATE), /site\.baseUrl/);
  const k = plain();
  delete k.kv.PROGRAMS;
  assert.throws(() => render(k, TEMPLATE), /kv\.PROGRAMS/);
});

test("the Deploy button's house: at the repo's root, no store ids, no address, the setup door and the cron (MC-34 1b)", () => {
  const out = renderButtonHouse({ name: "fmwax-house", compatibilityDate: "2025-06-01" });
  assert.match(out, /^name = "fmwax-house"$/m);
  assert.match(out, /^main = "mcp\/worker\.js"$/m, "the Worker named from the root");
  assert.match(out, /^directory = "art\/covers"$/m, "and the covers");
  assert.match(out, /\[\[kv_namespaces\]\]\nbinding = "TOKENS"\n\n/, "TOKENS with no id: Cloudflare makes it");
  assert.match(out, /\[\[kv_namespaces\]\]\nbinding = "PROGRAMS"\n\n/);
  assert.ok(!/^id = /m.test(out), "no store id at all");
  assert.ok(!/^PROGRAM_BASE_URL/m.test(out), "the address is learned at the first visit");
  assert.ok(!/^routes|^account_id/m.test(out));
  for (const s of ['class_name = "StationLedger"', 'class_name = "HouseSettings"', 'tag = "v1"', 'tag = "v2"', 'crons = ["*/10 * * * *"]']) {
    assert.ok(out.includes(s), s);
  }
  // As the copy script writes it, JSON: the same house as the terminal
  // door's blank one, but for the paths, the store ids and the address.
  // Plain objects, as the copy script's JSON.stringify leaves them.
  const plainOf = (t) => JSON.parse(JSON.stringify(parseToml(t)));
  const button = plainOf(out);
  const door = plainOf(renderBlankHouse({ name: "fmwax-house", baseUrl: "https://fmwax-house.example.workers.dev", tokensId: "a".repeat(32), programsId: "b".repeat(32), compatibilityDate: "2025-06-01" }));
  assert.deepEqual(button.kv_namespaces, [{ binding: "TOKENS" }, { binding: "PROGRAMS" }]);
  assert.deepEqual(door.kv_namespaces.map((k) => k.binding), ["TOKENS", "PROGRAMS"]);
  for (const k of ["durable_objects", "migrations", "triggers", "compatibility_date", "workers_dev"]) assert.deepEqual(button[k], door[k], k);
  assert.deepEqual({ ...button.assets, directory: null }, { ...door.assets, directory: null });
  const { PROGRAM_BASE_URL, ...doorVars } = door.vars;
  assert.equal(PROGRAM_BASE_URL, "https://fmwax-house.example.workers.dev");
  assert.deepEqual(button.vars, doorVars);
});

test("the template may only name blocks the view knows", () => {
  assert.throws(() => render(plain(), "#{{if nonsense}}\nx\n#{{end}}\n"), /unknown block/);
  assert.throws(() => render(plain(), "#{{if tidal}}\nx\n"), /no #\{\{end\}\}/);
  assert.throws(() => render(plain(), "#{{end}}\n"), /no #\{\{if\}\}/);
});

test("a speaker name with an apostrophe survives both layers of quoting", () => {
  // ROOM_DEVICES is JSON inside a TOML string: two escapes deep, and an
  // apostrophe in a room name is what a household actually types. The fixture
  // keeps one on purpose — it is the whole point of the test — but no longer
  // borrows this household's, whose speakers were renamed on 2026-09-07.
  const h = plain();
  h.devices = { default: `Guest's Room`, rooms: [`Guest's Room`, `a "quoted" one`] };
  const line = render(h, TEMPLATE).split("\n").find((l) => l.startsWith("ROOM_DEVICES"));
  assert.ok(render(h, TEMPLATE).includes(`DEFAULT_DEVICE = "Guest's Room"`));
  // Strip the TOML layer the way a parser would — unescape \\ and \" — and
  // what is left must be the JSON that went in.
  const inner = line.slice(`ROOM_DEVICES = "`.length, -1)
    .replace(/\\(["\\])/g, "$1");
  assert.deepEqual(JSON.parse(inner), [`Guest's Room`, `a "quoted" one`], line);
});

test("the view refuses to guess: a house is described, not defaulted", () => {
  const v = viewOf(plain());
  assert.equal(v.when.routes, false);
  assert.equal(v.when.tidal, false);
  assert.equal(v.when.requestRoutine, false);
  assert.equal(v.when.devices, true);
});

test("a house nobody can use is refused before it is written", () => {
  const noDj = plain();
  noDj.buttons = [{ button: 6, archive: true }];
  assert.throws(() => render(noDj, TEMPLATE), /no DJ on any preset/);

  // A Spotify button with nowhere to replay a program: legal to the parser,
  // and a sentence at call time instead of an install-time answer.
  const noReplay = plain();
  noReplay.aliases = {};
  assert.throws(() => render(noReplay, TEMPLATE), /needs a `replay` playlist/);

  // Tidal-only has nothing to replay through, and is fine without one.
  const tidalOnly = plain();
  tidalOnly.aliases = {};
  tidalOnly.tidal = { country: "GB" };
  tidalOnly.buttons = [{ button: 1, dj: "hank", catalog: "tidal",
    playlist: "1d247dd4-62d8-4daf-a1d5-289f4845068b" }];
  assert.ok(render(tidalOnly, TEMPLATE).includes("BUTTONS = ["));
});

// A button installed with nobody on it. The wall shows every preset the house
// has, not only the occupied ones, so a slot may carry no `dj` — and it has to
// render with the key ABSENT. `dj = "undefined"` is a roster key that is not
// in the roster, which fails parseButtons and takes the whole house down on
// the next request; the config check would not have caught it, because it
// compares the rendered file to the committed one rather than reading it.
test("a slot with no DJ renders without a dj key at all", () => {
  const h = plain();
  h.buttons = [
    { button: 1, dj: "hank", playlist: "x".repeat(22), catalog: "spotify" },
    { button: 12, playlist: "y".repeat(22), catalog: "spotify" },
  ];
  const out = render(h, TEMPLATE);
  const lines = out.split("\n").filter((l) => l.includes("button ="));
  const empty = lines.find((l) => l.includes("button = 12"));
  assert.ok(!/dj =/.test(empty), empty);
  assert.ok(!/undefined/.test(out), "and the word never reaches the file");
  // The columns still line up: an empty slot is a gap, not a shorter row.
  const at = lines.filter((l) => l.includes("playlist")).map((l) => l.indexOf("playlist"));
  assert.equal(new Set(at).size, 1, `playlist column ragged: ${at}`);
});

test("a house of nothing but empty slots renders and parses", () => {
  const h = plain();
  h.buttons = [{ button: 1, playlist: "x".repeat(22), catalog: "spotify" }];
  const out = render(h, TEMPLATE);
  assert.ok(!/dj =/.test(out));
  assert.ok(!/undefined/.test(out));
});

// The guest preset (MC-18): a fourth kind of BUTTONS line, rendered whole —
// gate, name, playlist, service — and enough on its own to be a house, since
// every DJ's set lands on it.
test("a guest preset renders with its gate and its name, and a house of guests alone is a house", () => {
  const h = plain();
  h.buttons = [
    { button: 1, guest: true, live: false, name: "DJ Guest", playlist: "g".repeat(22), catalog: "spotify" },
    { button: 2, guest: true, live: true, name: "DJ \"Guest\" · Tidal",
      playlist: "0b1f2c3d-aaaa-bbbb-cccc-000000000002", catalog: "tidal" },
    { button: 6, archive: true },
  ];
  const out = render(h, TEMPLATE);
  assert.match(out, new RegExp(`\\{ button = 1, guest = true, live = false, name = "DJ Guest", playlist = "${"g".repeat(22)}", catalog = "spotify" \\},`));
  assert.match(out, /\{ button = 2, guest = true, live = true, name = "DJ \\"Guest\\" · Tidal", playlist = "0b1f2c3d-aaaa-bbbb-cccc-000000000002", catalog = "tidal" \},/);
  assert.ok(!out.includes('dj = "undefined"'));
  // A Spotify guest is a Spotify slot: the replay playlist is still required.
  const noReplay = { ...h, aliases: {} };
  assert.throws(() => render(noReplay, TEMPLATE), /needs a `replay` playlist/);
  // A legacy alias is an alias like any other to the renderer.
  h.aliases = { replay: "z".repeat(22), "was button 1": "y".repeat(22) };
  assert.ok(render(h, TEMPLATE).includes(`"was button 1": "${"y".repeat(22)}"`));
});

test("a labelled preset renders as button and label only, and cannot be the whole house", () => {
  const h = plain();
  h.buttons = [
    { button: 1, dj: "hank", playlist: "x".repeat(22), catalog: "spotify" },
    { button: 7, label: "Jazz \"FM\"" },
  ];
  const out = render(h, TEMPLATE);
  assert.match(out, /\{ button = 7, label = "Jazz \\"FM\\"" \},/, "the quote is escaped, the row is short");
  const lines = out.split("\n").filter((l) => l.startsWith("  { button ="));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes("label") && !lines[1].includes("playlist"));
  // A house of labelled presets alone has nobody to curate.
  const none = plain();
  none.buttons = [{ button: 7, label: "Jazz FM" }];
  assert.throws(() => render(none, TEMPLATE), /no DJ on any preset/);
});

test("a labelled preset is on no service, so a Tidal-only house with one is not asked for a replay playlist", () => {
  // Codex, 2026-09-08: the replay predicate read a label's absent catalog as
  // Spotify, and a valid Tidal house was refused for lacking a Spotify alias.
  const h = plain();
  h.tidal = { country: "NL" };
  h.aliases = {};
  h.buttons = [
    { button: 1, dj: "hank", playlist: "1d247dd4-62d8-4daf-a1d5-289f4845068b", catalog: "tidal" },
    { button: 7, label: "Jazz FM" },
  ];
  assert.doesNotThrow(() => render(h, TEMPLATE));
  h.buttons.push({ button: 2, dj: "vibe", playlist: "x".repeat(22), catalog: "spotify" });
  assert.throws(() => render(h, TEMPLATE), /replay/);
});

// A DOUBLE QUOTE IN A NAME USED TO END THE STRING (2026-09-08). Every scalar
// but this one went through the escaper; DEFAULT_DEVICE was dropped into the
// template between two literal quotes. A household calling a speaker
// `Living "Room"` got a wrangler.toml that does not parse — after the install
// had already made its playlists and its namespaces.
test("a double quote in a speaker name does not end the TOML string", () => {
  const h = plain();
  h.devices = { default: 'Living "Room"', rooms: ['Living "Room"'] };
  const out = render(h, TEMPLATE);
  const line = out.split("\n").find((l) => l.startsWith("DEFAULT_DEVICE"));
  assert.equal(line, 'DEFAULT_DEVICE = "Living \\"Room\\""',
    "the quotes are escaped, not left to close the string");
  // A backslash is the other way to end it early.
  const back = plain();
  back.devices = { default: "a\\\\b", rooms: ["a\\\\b"] };
  assert.ok(render(back, TEMPLATE).includes('DEFAULT_DEVICE = "a\\\\\\\\b"'));
});

test("every quoted scalar in the template goes through the escaper", () => {
  // The template must carry NO quotes of its own around a placeholder: a
  // placeholder that keeps them is one the renderer will not escape, which is
  // exactly how DEFAULT_DEVICE was missed.
  assert.equal(TEMPLATE.match(/"\{\{[a-zA-Z.]+\}\}"/g), null,
    "a placeholder is quoted in the template — the renderer should quote it instead");
});

// Codex MC18-PLAN-R2-6T1: the renderer used to smooth a bad guest line into
// a good one — `live` coerced to false, `catalog` defaulted, a `dj` dropped —
// so the Worker's own check never saw the mistake. Refused here instead.
test("a guest entry is refused at render, not smoothed into a default", () => {
  const h = plain();
  const g = { button: 1, guest: true, live: false, name: "DJ Guest", playlist: "g".repeat(22), catalog: "spotify" };
  const bad = (over, re) => {
    // A DJ on another button, so the house-level rule ("no DJ on any preset")
    // passes and the guest line itself is what gets refused, in its own words.
    h.buttons = [{ ...g, ...over }, { button: 3, dj: "the-librarian", playlist: "p".repeat(22), catalog: "spotify" },
      { button: 6, archive: true }];
    assert.throws(() => render(h, TEMPLATE), re, JSON.stringify(over));
  };
  bad({ dj: "hank" }, /a guest button carries no "dj"/);
  bad({ label: "Jazz FM" }, /a guest button carries no "label"/);
  bad({ live: "yes" }, /"live" must be true or false/);
  bad({ live: undefined }, /"live" must be true or false/);
  bad({ catalog: undefined }, /"catalog" must be "spotify" or "tidal"/);
  bad({ name: " " }, /"name" is what the preset is saved as/);
  bad({ playlist: "" }, /"playlist" is missing/);
});

// MC-18 stage 2: the rollback's trap. The Worker refuses every write to a
// legacy playlist whatever BUTTONS says, so a button left on one could never
// be written — refused here, before the config is written.
test("a button whose playlist is also a legacy alias is refused, however the alias is written", () => {
  const h = plain();
  const id = "x".repeat(22);
  for (const v of [id, `spotify:playlist:${id}`, `https://open.spotify.com/playlist/${id}?si=abc`]) {
    h.aliases = { replay: "z".repeat(22), "was button 1": v };
    assert.throws(() => render(h, TEMPLATE),
      /button 1's playlist \(x{22}\) is also the legacy alias "was button 1"/, v);
  }
  h.aliases = { replay: "z".repeat(22), "was button 1": "y".repeat(22) };
  assert.doesNotThrow(() => render(h, TEMPLATE), "a legacy alias on a playlist no button holds is what it is for");
  h.buttons = [{ button: 1, guest: true, live: false, name: "DJ Guest", playlist: "y".repeat(22), catalog: "spotify" }];
  assert.throws(() => render(h, TEMPLATE), /button 1's playlist \(y{22}\) is also the legacy alias/, "a guest's too");
  h.aliases = { replay: "y".repeat(22) };
  assert.doesNotThrow(() => render(h, TEMPLATE), "an ordinary alias on a button's playlist is not a legacy one");
});

// THE INSTALLER'S CHECK ON WINDOWS (2026-10-19): Git for Windows checks the
// template out with CRLF line endings, and no block marker matched, so a
// blank house asked for the owner's routes and the install stopped.
test("a template with Windows line endings renders the same house", () => {
  const crlf = TEMPLATE.replace(/\r?\n/g, "\r\n");
  assert.equal(render(JSON.parse(readFileSync(HOUSE_FILE, "utf8")), crlf), render(JSON.parse(readFileSync(HOUSE_FILE, "utf8")), TEMPLATE));
});

// THE SAMPLE HOUSE A COPY CARRIES (2026-10-25): install/house.blank.json is
// a copy's house.json, so it must render like any house, as the template
// grows, and say nothing of this one.
test("the sample house a copy carries renders, and is none of this house", () => {
  const blank = JSON.parse(readFileSync(new URL("../install/house.blank.json", import.meta.url), "utf8"));
  const out = render(blank, TEMPLATE);
  assert.match(out, /name = "fmwax-house"/);
  // In a copy the sample is the house: there is nobody else to keep out.
  if (HOUSE.site.baseUrl === blank.site.baseUrl) return;
  assert.ok(!out.includes("account_id"), "a copy's own sign-in chooses its account");
  for (const v of [HOUSE.site.baseUrl, ...Object.values(HOUSE.kv), HOUSE.worker.accountId, ...HOUSE.buttons.map((b) => b.playlist)].filter(Boolean)) {
    assert.ok(!out.includes(v), `the sample says ${v}`);
  }
});

