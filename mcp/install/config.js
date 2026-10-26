// house.json + house.template.toml -> wrangler.toml
//
// The config is a rendering, not a file anyone edits. That buys two things:
// a household owns one small JSON file instead of a 200-line TOML with this
// family's speakers in it, and the shape stays in one place while the answers
// vary. The test asserts render() equals the committed wrangler.toml byte for
// byte, so the two cannot drift; `npm run config` is what closes the gap.
//
// The template language is deliberately two constructs and no more. Anything
// that needs a third belongs in the code below, where it can be read.
//
//   {{a.b}}            replaced by that path in the view (below)
//   #{{if name}} …     the lines between are dropped unless view.when[name]
//   #{{end}}           is true. The markers are comments, so the template
//                      stays readable as TOML.
//
// Zero dependencies: Node's stdlib only, like everything else here.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MCP = join(HERE, "..");
export const HOUSE_FILE = join(MCP, "house.json");
export const TEMPLATE_FILE = join(HERE, "house.template.toml");
export const CONFIG_FILE = join(MCP, "wrangler.toml");

// A TOML basic string. The values that reach one here are names a household
// typed — a speaker called `Guest's Room`, a domain, a country code — so the
// escaping that matters is the quote and the backslash.
const toml = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ROOM_DEVICES is JSON *inside* a TOML string, because [vars] carries strings
// and nothing else. Two layers of escaping, done by one function and in the
// right order — backslashes before quotes, or a name containing a quote comes
// out as a backslash that ends the string early. The quotes are part of the
// value rather than the template line, so there is exactly one place where
// this is got right or wrong.
const jsonInToml = (v) => toml(JSON.stringify(v));

// Values that are ALREADY TOML by the time they reach the template: the two
// multi-line tables, and the JSON blobs this file has quoted itself.
// Everything else is a bare scalar sitting where a quoted string belongs, and
// gets its quotes HERE — one place, so a speaker called `a "quoted" one`
// cannot end the string early and leave a config that will not parse. The
// template carries no quotes of its own around a placeholder, which is what
// makes this the only place it can be got wrong. The emptiness check runs
// first, on the raw value, or a missing answer would render as the word
// "undefined" in quotes instead of failing.
const PREFORMATTED = new Set([
  "routes", "buttons", "devices.roomsJson", "devices.speakersJson", "aliasesJson",
  "crons", "endless.json",
]);

// The BUTTONS list, aligned. Alignment is not decoration on this list: it is
// read to answer "who is on 7", and a ragged column makes that a search.
function renderButtons(buttons) {
  // The preset number stays left-aligned and the space goes AFTER the comma:
  // `button = 1,` and `button = 10,` then both read as a number followed by a
  // gap, rather than one of them starting a column late.
  const num = Math.max(...buttons.map((b) => String(b.button).length));
  // A slot may carry NO dj — a button installed empty, so the wall shows every
  // preset the house has rather than only the occupied ones. It must render
  // with the key absent: `dj = "undefined"` parses as a roster key that is not
  // in the roster and takes the whole house down on the next request.
  const rows = buttons.filter((b) => !b.archive && !b.label && !b.guest && b.dj);
  const dj = rows.length ? Math.max(...rows.map((b) => `${toml(b.dj)},`.length)) : 0;
  const out = [];
  for (const b of buttons) {
    // A note is house history — why a button moved, what the old preset still
    // plays — and belongs beside the line it explains, not in a commit nobody
    // will look up.
    for (const line of b.note ?? []) out.push(`  # ${line}`);
    const gap = " ".repeat(num - String(b.button).length + 1);
    const head = `  { button = ${b.button},${gap}`;
    if (b.archive) {
      out.push(`${head}archive = true },`);
      continue;
    }
    // A guest preset (MC-18): nobody's, one per service, saved under `name`,
    // and `live` says whether sets may land on it yet.
    if (b.guest) {
      // Refused here, not smoothed over: the Worker's parseButtons only ever
      // sees what this writes, so a default filled in here would hide the
      // mistake from the one check that knows the rules (Codex
      // MC18-PLAN-R2-6T1 found `live` and `catalog` coerced and a guest's
      // `dj` silently dropped).
      const at = `house.json buttons, button ${b.button}`;
      for (const k of ["dj", "label", "archive"]) {
        if (b[k] != null) throw new Error(`${at}: a guest button carries no "${k}"`);
      }
      if (typeof b.live !== "boolean") throw new Error(`${at}: "live" must be true or false`);
      if (b.catalog !== "spotify" && b.catalog !== "tidal") {
        throw new Error(`${at}: "catalog" must be "spotify" or "tidal"`);
      }
      if (typeof b.name !== "string" || !b.name.trim()) {
        throw new Error(`${at}: "name" is what the preset is saved as, and it is missing`);
      }
      if (typeof b.playlist !== "string" || !b.playlist.trim()) throw new Error(`${at}: "playlist" is missing`);
      out.push(`${head}guest = true, live = ${b.live}, name = ${toml(b.name)}, ` +
        `playlist = ${toml(b.playlist)}, catalog = ${toml(b.catalog)} },`);
      continue;
    }
    // A preset the household saved themselves, on the wall by name only.
    if (b.label) {
      out.push(`${head}label = ${toml(b.label)} },`);
      continue;
    }
    const tail = `playlist = ${toml(b.playlist)}, catalog = ${toml(b.catalog ?? "spotify")} },`;
    out.push(b.dj
      ? `${head}dj = ${`${toml(b.dj)},`.padEnd(dj + 1, " ")}${tail}`
      : `${head}${" ".repeat(dj ? dj + 6 : 0)}${tail}`);
  }
  return out.join("\n");
}

// Every value the template may name, and every block it may drop. Built in one
// place so a missing answer fails here — with the key in the message — rather
// than rendering a config with `{{tidal.country}}` in it.
export function viewOf(house) {
  const routes = house.site?.routes ?? [];
  // The Cloudflare account, when named: 32 hex characters, or wrangler would
  // be handed something it cannot deploy to.
  const accountId = house.worker?.accountId ?? null;
  if (accountId != null && !/^[0-9a-f]{32}$/.test(String(accountId))) {
    throw new Error(`worker.accountId is not a Cloudflare account id (32 hex characters): "${String(accountId).slice(0, 40)}"`);
  }
  const devices = house.devices?.default ? house.devices : null;
  const requests = house.requests ?? { enabled: false, autofulfill: false };
  return {
    when: {
      account: Boolean(accountId),
      routes: routes.length > 0,
      devices: Boolean(devices),
      speakers: Boolean(devices?.speakers && Object.keys(devices.speakers).length),
      tidal: Boolean(house.tidal?.country),
      timezone: Boolean(house.site?.timezone),
      // The archive's site and INDEX are named only where there is an archive
      // button for a set to sit on; a house without one carries no such line.
      // All three or none: the block renders the index URLs now, and rendering
      // them empty would hand the Worker two blank strings where it wants
      // either a real host or nothing — nothing is the one it can explain.
      archive: Boolean(house.buttons.some((b) => b.archive) && house.archive?.siteUrl
        && house.archive?.mediaUrl && house.archive?.occurrencesUrl
        && house.archive?.tracksUrl),
      // The routine the house rings by web call (MC-31 stage 2), its id only;
      // the trigger's token is a secret.
      requestRoutine: Boolean(requests.enabled && requests.routine),
      // Where a writer's kept set starts, when the long read (2026-10-18).
      requestNotesLong: Boolean(requests.enabled && requests.notes === "long"),
      // The endless DJ (MC-22), only in a house that names one.
      endless: Boolean(house.endless?.presets?.length),
      // MC-29's kept player answer, rendered only when turned off.
      playerReuseOff: house.player?.reuse === false,
      // The house rules page shows this house's own history (2026-10-18).
      rulesHistory: house.rules?.history === true,
    },
    values: {
      "worker.name": house.worker.name,
      "worker.compatibilityDate": house.worker.compatibilityDate,
      "worker.accountId": accountId ?? "",
      "site.baseUrl": house.site.baseUrl,
      "site.timezone": house.site?.timezone ?? "",
      "kv.TOKENS": house.kv.TOKENS,
      "kv.PROGRAMS": house.kv.PROGRAMS,
      "devices.default": devices?.default ?? "",
      "devices.roomsJson": jsonInToml(devices?.rooms ?? []),
      "devices.speakersJson": jsonInToml(devices?.speakers ?? {}),
      "tidal.country": house.tidal?.country ?? "",
      "archive.siteUrl": house.archive?.siteUrl ?? "",
      "archive.mediaUrl": house.archive?.mediaUrl ?? "",
      "archive.occurrencesUrl": house.archive?.occurrencesUrl ?? "",
      "archive.tracksUrl": house.archive?.tracksUrl ?? "",
      "requests.enabled": String(Boolean(requests.enabled)),
      "requests.autofulfill": String(Boolean(requests.autofulfill)),
      "requests.routine": requests.routine ?? "",
      // ALWAYS rendered, empty when there is nothing to run: wrangler leaves
      // a deployed cron in place when `crons` is missing and removes it only
      // on an empty list, so a house that drops its schedule must say []. The
      // endless DJ's watch runs every ten minutes (it looks only every third
      // time while nothing plays).
      // A blank house (door.js) has it from the start: its endless DJs are
      // switched on later, on its setup page, which cannot add a schedule.
      crons: house.endless?.presets?.length || house.schedule ? '["*/10 * * * *"]' : "[]",
      "endless.json": jsonInToml({ mode: house.endless?.mode ?? "watch", dailyRuns: house.endless?.dailyRuns ?? 12,
        presets: house.endless?.presets ?? [] }),
      routes: routes.map((r, i) =>
        `  { pattern = ${toml(r)}, custom_domain = true }${i < routes.length - 1 ? "," : ""}`)
        .join("\n"),
      // A blank house (door.js) has none yet: a comment keeps the array
      // well-formed and says why it is empty.
      buttons: (house.buttons ?? []).length ? renderButtons(house.buttons) : "  # none yet: made on the setup page",
      // Single-quoted in the template (a TOML literal string), so the JSON's
      // own double quotes need no escaping at all — but a literal string has
      // no escapes either, so an apostrophe in an alias name would end it.
      // Refuse rather than emit a config that parses as something else.
      // Spaced by hand: JSON.stringify has no setting between "no spaces" and
      // "one key per line".
      aliasesJson: `{${Object.entries(house.aliases ?? {})
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => {
          if (`${k}${v}`.includes("'")) {
            throw new Error(`alias "${k}" contains a single quote, which cannot ` +
              "be written into PLAYLIST_ALIASES — rename it");
          }
          return `${JSON.stringify(k)}: ${JSON.stringify(v)}`;
        })
        .join(", ")}}`,
    },
  };
}

// What a house must be for the config to be worth writing. These are not the
// parser's rules — worker.js checks the shape of every button on the first
// request — but the two things that are legal there and useless here, caught
// while somebody is still sitting in front of the installer.
function check(house) {
  const buttons = house.buttons ?? [];
  // A slot somebody can curate into: a DJ's preset, or a guest preset (MC-18),
  // which takes every DJ's set in turn. Labels and the archive are neither.
  if (!buttons.some((b) => !b.archive && !b.label)) {
    throw new Error(
      "this house has no DJ on any preset — an archive button or a labelled " +
      "preset alone has nothing to curate. Give at least one DJ a preset number, " +
      "or a guest preset.");
  }
  const replay = house.aliases?.replay;
  if (buttons.some((b) => !b.archive && !b.label && (b.catalog ?? "spotify") === "spotify") && !replay) {
    throw new Error(
      "a house with a Spotify button needs a `replay` playlist in `aliases` — " +
      "play_program copies an old programme into it so that hearing one again " +
      "does not cost the set currently on the button.");
  }
  // A BUTTON'S PLAYLIST IS NEVER ALSO A LEGACY ALIAS (MC-18). The Worker
  // refuses every write to a legacy playlist whatever BUTTONS says, so a
  // button left on one could never be written — the trap in the rollback's
  // second half, where the alias goes in the same commit that puts the
  // playlist back on a button (tasks/done/mc18-guest-presets.md, stage 5). Compared
  // by id, so an alias written as a URI or a link is still caught.
  const idOf = (v) => String(v ?? "").match(
    /[0-9A-Za-z]{22}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0] ?? String(v ?? "").trim();
  const legacy = Object.entries(house.aliases ?? {}).filter(([k]) => /^was\s/i.test(k.trim()));
  for (const b of buttons) {
    if (!b.playlist) continue;
    const hit = legacy.find(([, v]) => idOf(v) === idOf(b.playlist));
    if (hit) {
      throw new Error(
        `button ${b.button}'s playlist (${b.playlist}) is also the legacy alias "${hit[0]}" — ` +
        "the Worker refuses every write to a legacy playlist whatever BUTTONS says, so this " +
        "button could never be written. Remove the alias in the same commit that puts the " +
        "playlist back on a button.");
    }
  }
}

// THE ENDLESS PRESETS (MC-22, MC-24; Codex's review 2026-09-24): each a
// Spotify playlist id, a preset number used once, a DJ the house knows, and
// no slot shared with a guest or the archive. The Worker drops a malformed
// entry in silence — a Tidal id would deploy a cron that watches nothing —
// so it is refused here, in words, while somebody is at the installer.
function checkEndless(house) {
  const presets = house.endless?.presets ?? [];
  const seen = new Set();
  const taken = new Set((house.buttons ?? []).map((b) => b.button));
  const djs = new Set([...(house.buttons ?? []).map((b) => b.dj).filter(Boolean), ...(house.djs ?? [])]);
  for (const p of presets) {
    const where = `endless preset ${p?.button ?? "?"}`;
    if (!Number.isInteger(p?.button) || p.button < 1 || p.button > 12) throw new Error(`${where}: "button" must be a preset number, 1 to 12.`);
    if (seen.has(p.button)) throw new Error(`${where} is listed twice.`);
    seen.add(p.button);
    if (taken.has(p.button)) throw new Error(`${where} is also in "buttons" — a guest or the archive already holds that number.`);
    if (!/^[A-Za-z0-9]{22}$/.test(String(p.playlist ?? ""))) {
      throw new Error(`${where}: "playlist" must be a Spotify playlist id (22 letters and digits). Endless presets are Spotify only — nothing here can see Tidal play.`);
    }
    // The endless lane (MC-27) starts with nobody: its DJ is whoever is picked.
    if (p.lane === true) {
      if (presets.filter((x) => x?.lane === true).length > 1) throw new Error("only one endless preset can be the lane.");
      if (p.dj != null) throw new Error(`${where}: the lane starts empty — leave out "dj".`);
      continue;
    }
    if (typeof p.dj !== "string" || !p.dj.trim()) throw new Error(`${where}: "dj" must name the DJ it starts with.`);
    if (djs.size && house.djs && !djs.has(p.dj)) throw new Error(`${where}: no DJ "${p.dj}" in this house.`);
  }
  const ids = presets.map((p) => p.playlist);
  if (new Set(ids).size !== ids.length) throw new Error("two endless presets share one playlist.");
}

export function render(house, template, { strict = true } = {}) {
  // The terminal door's blank house (door.js) has no presets yet: its owner
  // makes them on the setup page, so the checks that want one are not asked.
  if (strict) {
    check(house);
    checkEndless(house);
  }
  const view = viewOf(house);

  // Blocks first: a placeholder inside a dropped block must never be asked
  // for, or a Tidal-less house would fail on {{tidal.country}}.
  // A Windows clone may have the template with CRLF line endings (Git for
  // Windows' default), which no block marker matched (the installer's check
  // on Windows, 2026-10-19).
  const lines = template.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  let skipping = null;
  for (const line of lines) {
    const open = line.match(/^#\{\{if ([a-zA-Z]+)\}\}$/);
    if (open) {
      if (skipping) throw new Error(`nested #{{if}} at "${line}" — not supported`);
      if (!(open[1] in view.when)) throw new Error(`unknown block "${open[1]}"`);
      skipping = view.when[open[1]] ? false : true;
      continue;
    }
    if (line === "#{{end}}") {
      if (skipping === null) throw new Error("#{{end}} with no #{{if}}");
      skipping = null;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  if (skipping !== null) throw new Error("#{{if}} with no #{{end}}");

  return kept.join("\n").replace(/\{\{([a-zA-Z.]+)\}\}/g, (_, key) => {
    if (!(key in view.values)) throw new Error(`house.json has no ${key}`);
    const v = view.values[key];
    if (v === "" || v == null) throw new Error(`house.json has no value for ${key}`);
    return PREFORMATTED.has(key) ? v : toml(v);
  });
}

// A BLANK HOUSE for the terminal door (MC-31 stage 6, 2026-10-17): its
// name, address and two stores, and nothing of the owner's house: no
// presets, speakers, DJs on presets, archive, Tidal, curator or schedule.
// Everything else is chosen on its setup page.
export function renderBlankHouse({ name, baseUrl, tokensId, programsId, compatibilityDate }, templateFile = TEMPLATE_FILE) {
  const house = {
    worker: { name, compatibilityDate },
    site: { baseUrl },
    kv: { TOKENS: tokensId, PROGRAMS: programsId },
    requests: { enabled: false, autofulfill: false },
    buttons: [],
    aliases: {},
    schedule: true,
  };
  return render(house, readFileSync(templateFile, "utf8"), { strict: false });
}

export function renderHouse(houseFile = HOUSE_FILE, templateFile = TEMPLATE_FILE) {
  return render(
    JSON.parse(readFileSync(houseFile, "utf8")),
    readFileSync(templateFile, "utf8"));
}

// `npm run config`. --check exits 1 without writing, which is what a test or a
// hook wants; the default writes and says whether anything moved.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = renderHouse();
  const before = (() => {
    try { return readFileSync(CONFIG_FILE, "utf8"); } catch { return null; }
  })();
  if (process.argv.includes("--check")) {
    if (before === out) {
      console.log("wrangler.toml is what house.json renders.");
    } else {
      console.error(
        "wrangler.toml does not match house.json + the template. Run: npm run config");
      process.exit(1);
    }
  } else if (before === out) {
    console.log("wrangler.toml unchanged.");
  } else {
    writeFileSync(CONFIG_FILE, out);
    console.log(`wrote ${CONFIG_FILE}`);
  }
}
