// THE HOUSE'S CONFIG: the buttons, house(), the guest (request) presets and
// their words, the house clock in words, who holds what, and finding a DJ.
// Split out of worker.js on 2026-09-26 (consolidation).
import { safeUrl, plural, imageUrl } from "./programs.js";
import { PERSONAS } from "./djs.js";
import { ARCHIVE } from "./archive-identity.js";
import { CAP_MINUTES, houseDay, houseTz } from "./voice.js";
import { CATALOGS } from "./catalog.js";
import { playlistIdFrom } from "./spotify.js";
import { station } from "./station.js";
import { endlessLoad, endlessSlots, houseDjRoom, parseEndless, talkOn } from "./endless.js";
import { configuredPlaylistId } from "./now.js";
import { ROOM_ARCHIVE_TILE, fallbackDevice, parseRoomDevices, parseSpeakers, readTiles, speakerSlug, tileFor, writeTiles } from "./room.js";
import { PLAYLIST_PARSERS, SNAP_TTL_S, catalogFor, fold, lastfmOn, parseAliases, programsKV, withBudget } from "./services.js";
import { shelfElsewhere } from "./shelf.js";
import { curatorKind } from "./curator-events.js";

// ------------------------------------------------------------------ DJs
//
// The characters live in djs.js. This is the house: which of them sits on
// which button, holding which playlist, on which catalog. Config rather than
// code — BUTTONS in wrangler.toml — so another household installs the same
// roster on its own presets without touching the Worker, and a DJ this house
// has no button for is still a DJ, just one off the wall.
//
//   BUTTONS = [
//     { button = 1, dj = "dr-funkenstein", playlist = "0jjEePX…", catalog = "spotify" },
//     { button = 6, archive = true },
//   ]
//
// `catalog` names the service the playlist lives on, "spotify" or "tidal",
// and `playlist` is read with that service's own parser — an id, a
// `<service>:playlist:` URI or a share link, and the wrong service's shape
// fails the parse with the button's number in the message. Anything else is
// a typo and fails the parse too, because a misspelt catalog silently
// defaulting to Spotify would aim a Tidal playlist id at the wrong service.
//
// The button number is a label, nothing more. The Worker has no LAN path to
// the WiiM, so it cannot see which preset points where — re-point the physical
// button and this must be fixed by hand. Never imply the server knows.


export function parseButtons(raw) {
  if (raw == null || raw === "") return [];
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error("BUTTONS is not valid JSON — fix the var in wrangler.toml");
    }
  }
  if (!Array.isArray(list)) {
    throw new Error("BUTTONS must be a list of { button, dj, playlist, catalog } entries");
  }
  const out = [];
  const seenBtn = new Set();
  const seenDj = new Set();
  const seenGuest = new Set();
  // The service half of a slot — which catalog, which playlist there — read
  // the same way for a DJ's button and for a guest's, so the two cannot
  // disagree about what an id on the wrong service means.
  const service = (entry, at) => {
    const catalog = String(entry.catalog ?? "spotify").trim().toLowerCase();
    if (!CATALOGS.includes(catalog)) {
      throw new Error(
        `${at}: catalog "${catalog.slice(0, 20)}" is not one of ${CATALOGS.join(", ")}`);
    }
    const ref = String(entry.playlist ?? "").trim();
    if (!ref) throw new Error(`${at}: "playlist" is missing`);
    const playlist = PLAYLIST_PARSERS[catalog](ref);
    if (!playlist) {
      throw new Error(catalog === "spotify"
        ? `${at}: "playlist" must be a Spotify playlist id, URI or URL`
        : `${at}: "playlist" must be a Tidal playlist id (a UUID), tidal:playlist: URI ` +
          "or listen.tidal.com link");
    }
    return { catalog, playlist };
  };
  list.forEach((entry, i) => {
    const at = `BUTTONS[${i}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${at} must be an object`);
    }
    const btn = Number(entry.button);
    if (!Number.isInteger(btn) || btn < 1) {
      throw new Error(`${at}: "button" must be the preset number, a whole number from 1`);
    }
    if (seenBtn.has(btn)) throw new Error(`BUTTONS lists button ${btn} twice`);
    seenBtn.add(btn);
    const button = `button ${btn}`;
    // A LABELLED preset: one the household saved themselves in the WiiM app —
    // a radio station, an EQ, another input — and wants on the wall by name.
    // Nothing here can read or write it (the speaker answers on the LAN
    // only), so the card shows what the owner typed and says so. It is not a
    // slot: no DJ can be moved onto it, no playlist stands behind it.
    if (entry.label != null) {
      if (entry.dj || entry.playlist || entry.archive || entry.catalog) {
        throw new Error(`${at}: a labelled button carries only "button" and "label"`);
      }
      const label = String(entry.label).trim();
      if (!label || label.length > 40) {
        throw new Error(`${at}: "label" must be 1 to 40 characters — what the preset is called`);
      }
      out.push({ btn, button, key: null, archive: false, fixed: true, label, catalog: null, playlist: null });
      return;
    }
    // A GUEST preset (MC-18): a slot with no tenant, ever. Its playlist is
    // written to like a DJ's, but every DJ's set lands there in turn and
    // nobody holds it — so no `dj`, no move onto it, one per service. `name`
    // is what the household saves the preset as in the WiiM app, the way
    // `label` is for a preset they saved themselves; the remote shows it and
    // the Speakers page asks for it. `live` false: nothing routes a set there
    // and nothing writes to it.
    if (entry.guest) {
      if (entry.dj || entry.label || entry.archive) {
        throw new Error(
          `${at}: a guest button carries "button", "guest", "name", "live", "playlist" and ` +
          `"catalog" — no dj, label or archive`);
      }
      const name = String(entry.name ?? "").trim();
      if (!name || name.length > 40) {
        throw new Error(
          `${at}: "name" must be 1 to 40 characters — what the guest preset is saved ` +
          "as in the WiiM app");
      }
      if (typeof entry.live !== "boolean") {
        throw new Error(
          `${at}: "live" must be true or false — whether sets may land on this guest yet`);
      }
      const { catalog, playlist } = service(entry, at);
      if (seenGuest.has(catalog)) {
        throw new Error(`BUTTONS has two guest buttons on ${catalog} — one per service`);
      }
      seenGuest.add(catalog);
      out.push({ btn, button, key: null, archive: false, guest: true, live: entry.live,
        name, catalog, playlist });
      return;
    }
    if (entry.archive) {
      if (entry.dj || entry.playlist) {
        throw new Error(`${at}: an archive button carries no dj and no playlist`);
      }
      out.push({ btn, button, key: "archive", archive: true, catalog: null, playlist: null });
      return;
    }
    // `dj` is who was on this button AT INSTALL, and it may be left out: a
    // house can be installed with a slot standing empty, and after the first
    // swap the wall in KV is what says who is on it. The playlist is the
    // button's for good; the name against it is not.
    const key = String(entry.dj ?? "").trim() || null;
    if (key && PERSONAS[key]?.archiveOnly) {
      throw new Error(
        `${at}: "${key}" belongs to an archive and cannot be put on a preset — ` +
        "their recordings are not on any service");
    }
    if (key && !Object.prototype.hasOwnProperty.call(PERSONAS, key)) {
      throw new Error(
        `${at}: dj "${key.slice(0, 40)}" is not in the roster — one of ` +
        Object.keys(PERSONAS).join(", "));
    }
    // Still refused in the config, where it can only be a typo. The wall has
    // its own rule for the same collision, because there it can be a stale
    // document rather than a mistake, and a stale document must not throw.
    if (key && seenDj.has(key)) {
      throw new Error(`BUTTONS puts ${PERSONAS[key].name} on two buttons`);
    }
    if (key) seenDj.add(key);
    const { catalog, playlist } = service(entry, at);
    out.push({ btn, button, key, archive: false, catalog, playlist });
  });
  return out.sort((a, b) => a.btn - b.btn);
}

// ------------------------------------------------------------------ the wall
//
// WHICH DJ is on which button TODAY. BUTTONS says which playlist each preset
// holds — a physical fact, fixed when somebody saved the preset in the WiiM
// app — and this says whose name is against it, which changes from a phone
// and without a deploy.
//
// The two are separate because only one of them can move. A preset holds a
// playlist id for good: nothing here can re-save a preset, so a swap that
// re-pointed the button would leave the speaker playing the previous DJ while
// every page said otherwise. So the button keeps its playlist and the DJ is
// its tenant — the playlist is renamed and rewritten, and the id never moves.
//
//   house:wall = {
//     v: 1,
//     slots: { "5": { dj: "vibe", since: "…" },
//              "12": { dj: null, left: "hank", since: "…" } },
//     updated: "…"
//   }
//
// ABSENT, every button's tenant is the `dj` field in BUTTONS. So a house that
// has never swapped reads exactly as it did before this existed, there is no
// migration, and the config's `dj` means "who was on it at install".
//
// NOTHING HERE THROWS. A wall naming a stranger, a button this house does not
// have, or the same DJ twice is a document that has drifted from a config
// somebody edited — and the room going down is a worse answer than a button
// reading empty. Each slot is judged on its own; a bad one is dropped and the
// rest stand. It must not silently fall back to the seed either, which would
// put the old tenant's name back over the new tenant's songs.

// Every persona dressed with its button, or with none. Parsed once per
// distinct config string rather than per call: the same dozen lookups run on
// every request, and the config only changes at deploy.
//
// `djs` has no prototype. A slug straight out of a URL indexes it, and on a
// plain object "constructor" would find a function and call it a DJ.
export let HOUSE_CACHE = { src: null, value: null };
// Motown became Soul Factory, 2026-10-12 (the owner); the Shelf has
// programs under the old key's DJ. (Kurt became Grunge the same day, and
// Grunge was cut on 2026-10-13, so "kurt" finds nobody now.)
// THE MERGES, 2026-10-13 (the owner): Sunny, Morning and Nightside became
// Vibe; Stax and Soul Factory (Motown with it) became Soul; KRS-One went
// into Hip Hop. Programs, requests, the endless ledger (preset 9 was
// "sunny") are written under the old keys. (Hip Hop
// was cut on 2026-10-15, so "krs-one" finds nobody now, like "kurt".)
export const OLD_KEYS = {
  sunny: "vibe", morning: "vibe", nightside: "vibe",
  stax: "soul", "soul-factory": "soul", motown: "soul",
};

export function house(env) {
  const raw = env.BUTTONS;
  const src = typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
  if (HOUSE_CACHE.src === src) return HOUSE_CACHE.value;
  const all = parseButtons(raw);
  // Labelled presets are kept APART from the slots, so every reader of
  // `buttons` — the tenancy, the speakers page, every move and refusal — goes
  // on seeing only presets this house writes to. They come back together in
  // one place, roomRoster, where the wall is drawn.
  const parsed = all.filter((b) => !b.fixed);
  // Who is on each button is the config's word alone since stage 6
  // (2026-09-26): the wall document the moves wrote is no longer read.
  const buttons = parsed.map((b) => {
    if (b.archive) return b;
    if (b.guest) {
      return { ...b, seeded: { catalog: b.catalog, playlist: b.playlist },
        key: null, installed: null, left: null };
    }
    return { ...b, seeded: { catalog: b.catalog, playlist: b.playlist },
      key: b.key ?? null, installed: b.key, left: null };
  });
  // A DJ dressed with their preset's playlist while they hold one (the
  // crates a DJ off a preset once had went in stage 6, 2026-09-26: their
  // sets go to the requests presets). `alias` is the label the write path
  // resolves that playlist by, and parseAliases is the undo's membership set.
  const djs = Object.create(null);
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const b = buttons.find((x) => x.key === key) ?? null;
    djs[key] = {
      key, ...persona,
      button: b?.button ?? null, btn: b?.btn ?? null,
      catalog: b?.catalog ?? null, playlist: b?.playlist ?? null, alias: b?.button ?? null,
    };
  }
  // A renamed DJ's old key still finds them, for what was written under it —
  // a program's DJ, a request, a page's address — but never as a second DJ:
  // not enumerable, so the roster, the bench and every list see one.
  for (const [old, now] of Object.entries(OLD_KEYS)) {
    if (djs[now] && !djs[old]) Object.defineProperty(djs, old, { value: djs[now], enumerable: false });
  }
  const value = {
    buttons, djs,
    // THE ROSTER IS WHO CAN BE ON A PRESET, and an archive DJ cannot: their
    // material is not on any service, so a Spotify or Tidal button could not
    // hold a note of it. They stay in `djs` — get_dj must answer for them, and
    // the archive page asks them for sets — and out of the roster, which is
    // what the bench, the picker and every move read (2026-09-07).
    roster: Object.values(djs).filter((d) => !d.archiveOnly),
    archive: parsed.find((b) => b.archive) ?? null,
    // The presets the household saved themselves and named in the config. On
    // the wall by that name; nowhere else.
    fixed: all.filter((b) => b.fixed),
    // The buttons with nobody on them: a playlist, songs in it, and no name
    // against them. Empty at install and after every swap that completes. A
    // guest is not one: nobody is MEANT to be on it.
    empty: buttons.filter((b) => !b.archive && !b.guest && !b.key),
    // THE GUEST PRESETS (MC-18), one per service or none: the slot every
    // DJ's set on that service lands on once it is live.
    guest: Object.fromEntries(CATALOGS.map((cat) =>
      [cat, buttons.find((b) => b.guest && b.catalog === cat) ?? null])),
  };
  HOUSE_CACHE = { src, value };
  return value;
}

// The guest preset on one service, or null (MC-18). The label the write path
// resolves it by names the service, like a crate's, so a set can be aimed at
// the guest before it is live and before anything else knows the number.
export function guestAlias(cat) {
  return `guest on ${cat}`;
}
// THE SPOTIFY PLAYLIST ON FILE FOR A PRESET NUMBER (MC-19): the guest that
// holds that number, else the legacy alias from before the switch-over —
// "was button N spotify" where a Tidal one shares the number, else "was
// button N" when that is Spotify. Nothing else is knowledge: the Worker cannot
// read a preset, so a number is a claim only a speaker's own reading can
// confirm (tasks/done/mc19-key-play.md, "What a tap does, and why that is honest").
export function presetOnFile(env, n) {
  // The endless lane's number is the Endless playlist (MC-27), not the old
  // "was button N" alias the number used to point at.
  const cfgEndless = parseEndless(env)?.presets ?? [];
  const lane = cfgEndless.find((p) => p.lane && p.button === n);
  if (lane) return { id: lane.playlist, name: "Guest DJ", via: "the guest DJ slot", catalog: "spotify" };
  // A HOUSE DJ'S PRESET is its endless playlist, before any old alias (the
  // reviews, 2026-10-09: 7 became Americana's while "was button 7" still
  // named an older list, so key 7 could only be refused).
  const own = cfgEndless.find((p) => !p.lane && p.button === n);
  if (own) return { id: own.playlist, name: null, via: "the endless preset", catalog: "spotify", endless: true };
  const g = Object.values(house(env).guest ?? {})
    .find((x) => x && x.btn === n && x.catalog === "spotify" && x.playlist) ?? null;
  if (g) return { id: g.playlist, name: g.name ?? null, via: `alias "${guestAlias("spotify")}"`, catalog: "spotify" };
  const aliases = parseAliases(env);
  for (const label of [`was button ${n} spotify`, `was button ${n}`]) {
    const a = aliases[label];
    if (a?.id && a.catalog === "spotify") return { id: a.id, name: null, via: `alias "${label}"`, catalog: "spotify" };
  }
  return null;
}
// THE HOUSE'S OWN KEYS (MC-31, a door-made house with no WiiM addresses):
// every number with a Spotify playlist on file — the Requests preset, the
// DJ presets — named as the house names it, for the Speakers page to play
// on a speaker chosen at setup.
export function ownKeyName(env, n) {
  const p = (parseEndless(env)?.presets ?? []).find((x) => x.button === n);
  if (p?.lane) return "Guest DJ";
  if (p) return findDj(env, p.dj)?.name ?? p.dj;
  return Object.values(house(env).guest ?? {}).find((x) => x && x.btn === n)?.name ?? `Preset ${n}`;
}
export function ownPresetKeys(env, endlessKeys = {}) {
  const out = [];
  for (let n = 1; n <= 12; n++) {
    const f = presetOnFile(env, n);
    if (!f) continue;
    const endless = !!(parseEndless(env)?.presets ?? []).find((x) => x.button === n);
    out.push({ btn: n, name: endlessKeys[n]?.name ?? ownKeyName(env, n), endless });
  }
  return out;
}
// THE HOUSE'S PRESETS AS ROWS (version A of the Forum Speakers tab, the owner,
// 2026-10-17): what each holds, in words, for a house with no WiiM addresses,
// whose Speakers tab took Loaded's place. The Requests preset's DJ and since
// when from its `on:` record, its count from the tile cache (read once in ten
// minutes); a house DJ by name; the guest DJ by whoever was played last.
export async function ownPresetRows(env, endlessKeys = {}) {
  const cfg = parseEndless(env);
  let lane = null;
  try { lane = cfg && env.STATION ? (await endlessLoad(env)).lane ?? null : null; } catch { lane = null; }
  const cache = { map: await readTiles(env).catch(() => ({})), dirty: false };
  const budget = withBudget(env, { remaining: 6 });
  const rows = await Promise.all(ownPresetKeys(env, endlessKeys).map(async (k) => {
    const f = presetOnFile(env, k.btn);
    const p = (cfg?.presets ?? []).find((x) => x.button === k.btn);
    const kind = p?.lane ? "guest" : p ? "house" : "requests";
    const when = (iso) => loadedWords(houseClockWords(env, iso));
    if (kind === "requests") {
      const on = await programsKV(env).get(`on:${f.id}`, { type: "json" }).catch(() => null);
      const dj = on?.dj ? findDj(env, on.dj) : null;
      const t = await tileFor(budget, catalogFor(budget, "spotify"), f.id, budget.__budget, cache, { serveStale: true }).catch(() => null);
      return { btn: k.btn, kind, pid: f.id, eyebrow: "Requests",
        name: dj?.name ?? (t?.count === 0 ? "Empty for now" : on ? "A set" : "Requests"),
        meta: t?.count === 0 ? "Ask a DJ for a set in the Claude app"
          : [t?.count != null ? `${t.count} ${t.count === 1 ? "track" : "tracks"}` : null, t?.runtime ?? null, on?.at ? when(on.at) : null].filter(Boolean).join(" · ") };
    }
    if (kind === "house") return { btn: k.btn, kind, pid: f.id, eyebrow: "House DJ · endless", name: k.name, meta: "Plays for as long as you listen" };
    const ldj = lane?.dj && lane.ready !== false ? findDj(env, lane.dj) : null;
    return { btn: k.btn, kind, pid: f.id, eyebrow: "Guest DJ · endless", name: ldj?.name ?? "Nobody yet",
      meta: ldj ? `The last DJ played endless, ${atWords(houseClockWords(env, new Date(Number(lane.since) || Date.now()).toISOString()))}` : "Play any DJ endless from the DJs tab" };
  }));
  if (cache.dirty) await writeTiles(env, cache.map).catch(() => {});
  return rows;
}
// THE HOUSE RULES, EACH HOUSE ITS OWN (the owner, 2026-10-18: "role on every
// key", from https://claude.ai/artifact/SYPeHudMsPjp4GvZdbquVM). What the
// rules page fills in from the house's settings: every preset 1 to 12 with
// its role and who is on it now, what each kind of preset means, the
// numbers, the words docs/house-rules.md's `{if …}` marks test, and the
// values its `{…}` blanks take. Reads the endless state once and the helper's
// record once; nothing here calls Spotify.
const RULE_SERVICE = { spotify: "Spotify", tidal: "Tidal" };
// 10, 11, 12 is "10–12"; 4, 5, 7, 8, 9 stays a list, since a range beside
// single numbers reads worse than the numbers.
export function presetRun(ns) {
  const xs = [...new Set(ns)].sort((a, b) => a - b);
  const oneRun = xs.length >= 3 && xs.every((x, i) => i === 0 || x === xs[i - 1] + 1);
  return oneRun ? `${xs[0]}–${xs[xs.length - 1]}` : xs.join(", ");
}
export async function rulesFacts(env) {
  const h = house(env);
  const cfg = parseEndless(env);
  const presets = cfg?.presets ?? [];
  let state = null;
  try { state = cfg && env.STATION ? await endlessLoad(env) : null; } catch { state = null; }
  let slots = [];
  try { slots = cfg ? endlessSlots(env, cfg, state) : []; } catch { slots = []; }
  const lane = presets.find((p) => p.lane) ?? null;
  const laneDj = lane && state?.lane?.dj && state.lane.ready !== false ? findDj(env, state.lane.dj) : null;
  const requests = Object.values(h.guest ?? {}).filter(Boolean).sort((a, b) => a.btn - b.btn);
  const two = new Set(requests.map((g) => g.catalog)).size > 1;
  const first = presets[0] ?? null;
  const batch = first?.batchMinutes ?? 45;
  const topup = first?.topupMinutes ?? 30;
  const talk = talkOn(env);
  const archiveSays = "The house's own live recordings, on no music service.";
  const keys = [];
  for (let n = 1; n <= 12; n++) {
    const g = requests.find((x) => x.btn === n);
    const p = presets.find((x) => x.button === n);
    const fixed = (h.fixed ?? []).find((b) => b.btn === n);
    if (g) {
      const service = RULE_SERVICE[g.catalog] ?? g.catalog;
      keys.push({ n, role: "requests", name: service, title: two ? `Requests · ${service}` : "Requests",
        text: `The newest set you asked any DJ for${two ? `, on ${service}` : ""}. A new ask replaces it, and Keep puts it on the Shelf for good.` });
    } else if (p?.lane) {
      keys.push({ n, role: "guest", name: laneDj?.name ?? "Nobody yet", title: laneDj ? `Now ${laneDj.name}` : "Nobody yet",
        text: laneDj ? `Whoever you last played endless who has no preset of their own. Play another DJ endless and they take over ${n}.`
          : `Whoever you last played endless who has no preset of their own. Play any DJ endless from the DJs tab and they take ${n}.` });
    } else if (p) {
      const name = slots.find((x) => x.button === n)?.name ?? findDj(env, p.dj)?.name ?? p.dj;
      keys.push({ n, role: "house", name, title: name,
        text: `Always ${name}, endless, until you put another DJ on ${n} from their page. Adds ${p.batchMinutes} minutes when ${p.topupMinutes} are left.` });
    } else if (h.archive?.btn === n) {
      keys.push({ n, role: "archive", name: ROOM_ARCHIVE_TILE.name, title: ROOM_ARCHIVE_TILE.name,
        text: `${archiveSays}${talk ? " Ask Talk for a show, a song or a venue and it loads here." : ""}` });
    } else if (fixed) {
      keys.push({ n, role: "yours", name: fixed.label, title: fixed.label, text: `${fixed.label}, saved in the WiiM app. The house never writes over it.` });
    } else {
      keys.push({ n, role: "yours", name: "WiiM app", title: "Yours",
        text: "Whatever you saved here in the WiiM app: a station, a playlist, another service. The house never changes it." });
    }
  }
  // WHAT EACH KIND MEANS, in the DJs tab's order (requests, guest DJ, house
  // DJs, archive, everyone else), each with its numbers.
  const of = (role) => keys.filter((k) => k.role === role).map((k) => k.n);
  const house_ = of("house"), yours = of("yours");
  const kinds = [
    { role: "requests", title: "Requests", text: two
      ? `The newest set you asked any DJ for: ${requests.map((g) => `${g.btn} on ${RULE_SERVICE[g.catalog] ?? g.catalog}`).join(", ")}.`
      : "The newest set you asked any DJ for." },
    { role: "guest", title: "Guest DJ", text: "Whoever you last played endless who has no preset of their own." },
    { role: "house", title: house_.length > 1 ? "House DJs" : "House DJ", text: house_.length > 1
      ? "One DJ each, endless. The same DJ every press, until you swap them from a DJ’s page."
      : "One DJ, endless. The same DJ every press, until you swap them from a DJ’s page." },
    { role: "archive", title: "Archive", text: archiveSays },
    { role: "yours", title: "Yours", text: `Saved in the WiiM app. The house never changes ${yours.length > 1 ? "them" : "it"}.` },
  ].filter((k) => of(k.role).length).map((k) => ({ ...k, nums: presetRun(of(k.role)) }));
  const numbers = [];
  if (first) {
    numbers.push({ big: String(cfg.dailyRuns), say: "endless runs a day: top-ups, fresh starts, steers" },
      { big: String(batch), say: `minutes added when ${topup} are left` },
      { big: String(first.noRepeatSongs), say: "songs before a repeat" });
  }
  if (talk) numbers.push({ big: String(CAP_MINUTES), say: "minutes of Talk a day" });
  numbers.push({ big: String(Math.round(SNAP_TTL_S / 86400)), say: "days to undo a rewrite" },
    { big: "6", say: "months, then sign in to Spotify again" });
  // A helper counts once it has ever reported: every claimed house holds the
  // helper's key, whether or not one ever ran (the checklist's rule).
  let helper = false;
  if (env.HELPER_SECRET && env.STATION) {
    try { helper = !!(await station(env, "helper-get", {}))?.doc; } catch { helper = false; }
  }
  let zone = "the house's time zone";
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: houseTz(env), timeZoneName: "longGeneric" }).formatToParts(new Date());
    zone = p.find((x) => x.type === "timeZoneName")?.value ?? zone;
  } catch { /* the words above */ }
  return {
    keys, kinds, numbers,
    tags: {
      requests: requests.length > 0, tidal: requests.some((g) => g.catalog === "tidal"),
      endless: presets.length > 0, housedj: presets.some((p) => !p.lane), guest: !!lane,
      archive: !!h.archive, talk, helper, history: env.RULES_HISTORY === "on", newdj: !!houseDjRoom(env, cfg),
      lastfm: lastfmOn(env),
      // ChatGPT is the house's curator (MC-31 6b): its rules page says so.
      chatgpt: curatorKind(env) === "chatgpt",
    },
    blanks: {
      "default speaker": fallbackDevice(env) || "speaker chosen at setup",
      "requests presets": two
        ? requests.map((g) => `${g.btn} for ${RULE_SERVICE[g.catalog] ?? g.catalog}`).join(" or ")
        : String(requests[0]?.btn ?? ""),
      "guest preset": String(lane?.button ?? ""),
      "house presets": presetRun(presets.filter((p) => !p.lane).map((p) => p.button)),
      "endless presets": presetRun(presets.map((p) => p.button)),
      "archive preset": String(h.archive?.btn ?? ""),
      // What to ask the archive for, in this house's words (archive-identity.js).
      "archive asks": ARCHIVE.rulesAsks,
      "talk minutes": String(CAP_MINUTES),
      "time zone": zone,
      "notes default": env.REQUEST_NOTES === "long" ? "the long read" : "short notes",
    },
  };
}
// A key's Play, back from its 303, parsed whole before a word of it is
// printed (Codex MC19-REVIEW-7f3a): a known outcome, a number with a Spotify
// playlist on file, a speaker this house named. Anything else is no flash —
// it neither shows, nor skips the player memo, nor bypasses the checklist.
export const PRESET_PLAY_CODES = ["ok", "sent", "stuck", "asleep", "failed"];
// The helper's key press, back from its 303: a known outcome, a key, a WiiM.
export const HELPER_KEY_CODES = ["ok", "helper-off", "timeout", "unreachable", "failed"];
export function helperKeyFlash(env, url) {
  const code = String(url.searchParams.get("hk") ?? "");
  const btn = Number(url.searchParams.get("k"));
  const box = parseSpeakers(env).find((sp) => sp.slug === String(url.searchParams.get("kon") ?? "")) ?? null;
  return HELPER_KEY_CODES.includes(code) && Number.isInteger(btn) && btn >= 1 && btn <= 12 && box
    ? { code, btn, on: box.name } : null;
}
export function presetFlash(env, url) {
  const code = String(url.searchParams.get("kp") ?? "");
  if (!PRESET_PLAY_CODES.includes(code)) return null;
  const btn = Number(url.searchParams.get("k"));
  if (!Number.isInteger(btn) || btn < 1 || btn > 12 || !presetOnFile(env, btn)) return null;
  const boxes = parseSpeakers(env);
  const pool = boxes.length ? boxes : parseRoomDevices(env).map((name) => ({ name, slug: speakerSlug(name) }));
  const box = pool.find((sp) => sp.slug === String(url.searchParams.get("kon") ?? "")) ?? null;
  if (!box) return null;
  return { code, btn, box };
}
// WHICH KEY THE MUSIC IS, on the speaker it is playing on (MC-19 stage 3b):
// that speaker's own reading, the keys it holds as Spotify, the one whose
// playlist on file is the player's playlist — by id, which the player gives
// exactly, so it costs no read. The PLAYING device, never the page's pick:
// the pick is the phone's and may sit on the other speaker. Null when the
// speaker is not one of this house's WiiMs, has no reading, or the playlist
// is on none of its keys.
export function speakerPresetFor(env, recs, p) {
  if (!p?.pid || !p.device) return null;
  const norm = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const box = parseSpeakers(env).find((sp) => norm(sp.name) === norm(p.device)) ?? null;
  const rows = box ? recs[box.slug]?.presets : null;
  if (!rows) return null;
  for (const row of rows) {
    if (row.source !== "Spotify") continue;
    const onFile = presetOnFile(env, row.btn);
    if (onFile && onFile.id === p.pid) return { btn: row.btn, name: row.name };
  }
  return null;
}
// AN ENDLESS PRESET'S OWN PLAYLIST IS THAT PRESET, ON ANY SPEAKER (the owner,
// 2026-09-24): Monk's set started from his page on the Master Bedroom Echo,
// which has no keys and no reading, read "not from a preset … a playlist" —
// for preset 9's own playlist. The config knows each endless preset's
// playlist, so the match needs no speaker. Named for who is on it now (the
// ledger, one read, only when the playlist is an endless one): the speaker's
// saved name lags a swap until the preset is saved again. Takes the preset
// the caller already found and returns it renamed, or the endless one when
// the caller found none, or what it was given.
export async function endlessNamed(env, p, preset) {
  const cfg = p?.pid ? parseEndless(env) : null;
  if (cfg?.mode !== "live") return preset;
  const e = cfg.presets.find((x) => x.playlist === p.pid && (!preset || x.button === preset.btn));
  if (!e) return preset;
  const out = preset ? { ...preset } : { btn: e.button, name: findDj(env, e.dj)?.name ?? e.dj };
  try {
    const state = await endlessLoad(env);
    const slot = endlessSlots(env, cfg, state).find((x) => x.button === e.button);
    if (slot) { out.name = slot.name; out.dj = slot.dj; }
    // An endless set, a house DJ's or the guest DJ's: the now panel offers
    // its steering by this.
    out.endless = true;
    // THE LANE (MC-27) is named for itself and whoever is in it, never as a
    // preset number the remote may not hold yet: "Guest DJ · Dutch".
    if (e.lane) {
      out.lane = true;
      out.name = state.lane?.dj ? `Guest DJ · ${findDj(env, state.lane.dj)?.name ?? state.lane.dj}` : "Guest DJ";
      if (state.lane?.dj) out.dj = state.lane.dj;
      // Nearby, One Tap (2026-10-24): the bar's panel offers them too.
      const near = state.lane?.nearby;
      if (near?.list?.length && near.words === state.lane.words) out.nearby = { label: near.label, list: near.list };
    }
    if (pastTheList(state, e.button, p.uri)) out.autoplay = true;
  } catch { /* the name found stands */ }
  return out;
}
// SPOTIFY'S OWN PICKS UNDER A PRESET'S NAME (the owner, 2026-09-24): when a
// list runs out, the speaker's autoplay carries on and Spotify still names
// the playlist as the context, so the bar said "preset 9, Sunny" over jazz
// Sunny never chose. The watch keeps the session's list in the ledger, so a
// song not on it is known without a read. Before the watch has seen the
// session there is no list, and nothing is claimed.
export function pastTheList(state, btn, uri) {
  const tracks = state?.sessions?.[String(btn)]?.tracks;
  return !!uri && Array.isArray(tracks) && tracks.length > 0 && !tracks.some((t) => t?.[0] === uri);
}
// THE KEYS A SPEAKER CAN PLAY FROM THE PAGE (MC-19 stage 3b): its reading
// says Spotify, the house has a playlist on file for the number, and the
// speaker is one the play form may name (ROOM_DEVICES as well as
// WIIM_SPEAKERS — a WiiM that is read but not playable still gets its grid,
// as links). Drawn from KV alone; the paid check waits for the press.
export function playableKeys(env, boxes, recs) {
  const rooms = parseRoomDevices(env);
  const out = {};
  for (const sp of boxes) {
    const rows = recs[sp.slug]?.presets;
    if (!rows || !rooms.includes(sp.name)) continue;
    out[sp.slug] = rows.filter((r) => r.source === "Spotify" && presetOnFile(env, r.btn)).map((r) => r.btn);
  }
  return out;
}
// A pause or play's way back (MC-20), parsed whole before it shows: a known
// outcome, a known verb, a speaker this house named. "ok" prints nothing but
// still parses, so the page reads the player fresh instead of the memo.
export const TRANSPORT_CODES = ["ok", "gone", "failed"];
export function transportFlash(env, url) {
  const code = String(url.searchParams.get("tp") ?? "");
  const verb = String(url.searchParams.get("tdo") ?? "");
  if (!TRANSPORT_CODES.includes(code) || verb !== "pause") return null;
  const box = parseSpeakers(env).find((sp) => sp.slug === String(url.searchParams.get("ton") ?? "")) ?? null;
  if (!box) return null;
  return { code, verb, box };
}
export function guestFor(env, cat) {
  return house(env).guest?.[cat] ?? null;
}
// Which guest a playlist id belongs to, or null — the question the write door
// asks before it touches anything: a guest that is not live refuses, and a
// live one is checked against the request ledger first (stage 2).
export function guestForPlaylistId(env, id) {
  if (!id) return null;
  try {
    return Object.values(house(env).guest ?? {}).find((g) => g && g.playlist === id) ?? null;
  } catch {
    return null;
  }
}
// Whether any guest is live (MC-18). What stage 2 added acts only for a live
// guest, and every lookup it adds to a budget is counted only while one is:
// a house whose guests are all dark behaves exactly as it did before.
export function anyLiveGuest(env) {
  try {
    return Object.values(house(env).guest ?? {}).some((g) => g?.live);
  } catch {
    return false;
  }
}
export function guestLabel(cat) {
  return cat === "tidal" ? "Tidal" : "Spotify";
}
// A guest named from its playlist id, for a sentence.
export function guestPhrase(env, id) {
  const g = guestForPlaylistId(env, id);
  return g ? `the ${guestLabel(g.catalog)} requests preset (preset ${g.btn})` : String(id ?? "");
}
// WHERE A DJ'S SET GOES (MC-18 stage 3): the one answer every door asks. The
// DJ's own preset while they hold one; else the live guest on `cat`; else,
// until the flip, today's crate — the one on `crateCat`, which is `cat` for
// every door but fulfilment, whose older service rule still decides while
// that guest is dark. Answers { pl, alias, guest }: `pl` is { id, catalog },
// or null for a crate not made yet (the caller makes one, as before);
// `alias` is the label the write path resolves it by; `guest` is the button
// when it is one. Pure: the config and the DJ, never a store.
export function destinationFor(env, dj, cat) {
  if (dj?.button) {
    return { pl: { id: dj.playlist, catalog: dj.catalog }, alias: dj.alias, guest: null };
  }
  const g = guestFor(env, cat);
  if (g?.live) {
    return { pl: { id: g.playlist, catalog: g.catalog }, alias: guestAlias(g.catalog), guest: g };
  }
  return { pl: null, alias: null, guest: null };
}
// The live guests, as Talk's prompt and get_dj name them (MC-18 stage 3):
// none while every guest is dark, which leaves the prompt as it was.
export function liveGuests(env) {
  try {
    return Object.values(house(env).guest ?? {}).filter((g) => g?.live)
      .map((g) => ({ alias: guestAlias(g.catalog), btn: g.btn, label: guestLabel(g.catalog) }));
  } catch {
    return [];
  }
}
// What get_dj says of a DJ whose sets go to the guests (MC-18 stage 3).
export function guestNote(env, dj, endlessBtn = null) {
  const live = liveGuests(env);
  return (endlessBtn ? `${dj.name} is the endless DJ on preset ${endlessBtn}: playing them is that preset (play_endless). ` +
    "A SET asked of them" : `${dj.name} is on no preset of their own. A set for them`) + " is written onto the guest " +
    `preset for its service — ${live.map((g) => `"${g.alias}" (preset ${g.btn}) for ${g.label}`)
      .join(", ")} — replacing whichever DJ's set is there.` +
    (live.length < CATALOGS.length ? " A set on a service with no live guest has nowhere to go." : "") +
    (live.some((g) => g.label === "Tidal") ? " Nothing here can start the Tidal guest; it is pressed on the remote." : "");
}
// HOW TO PLAY A DJ, IN get_dj'S ANSWER (MC-31 stage 2b, 2026-10-16): the
// routing Talk has in its prompt (voice.js), said where the Claude app reads
// it fresh before every set, whatever its copy of the descriptions says.
// Only the ways this house has (Codex, 2026-10-17: a house with no endless
// DJs or no requests preset was told to use them): play_endless needs the
// endless DJs switched on with the guest DJ's preset (endless.js
// playEndless), a kept set needs a live requests preset.
export function howToPlay(env, dj, endlessBtn = null) {
  const g = guestFor(env, "spotify");
  const t = guestFor(env, "tidal");
  const cfg = parseEndless(env);
  const endless = cfg?.mode === "live" && (cfg.presets ?? []).some((p) => p.lane) && dj.endless !== false && !dj.archiveOnly;
  const kept = !!(g?.live || t?.live);
  const where = (g?.live ? `the requests preset ("${guestAlias("spotify")}", preset ${g.btn})` : "the requests preset") +
    (t?.live ? ` (or "${guestAlias("tidal")}", preset ${t.btn}, when it is asked on Tidal)` : "");
  const told = dj.needsWords ? ` ${dj.name} must be told what to play: ${dj.needsWords}, in words.` : "";
  const play = endless
    ? `"Play ${dj.name}" or "${dj.name}, endless" is play_endless${endlessBtn ? ` (their own preset, ${endlessBtn})` : ""}: no new set.`
    : `This house plays no DJ endless, so "Play ${dj.name}" is a set, as below.`;
  const set = kept
    ? `A SET asked of them (a length, a mood, a subject) is replace_playlist onto ${where} ` +
      "with dj and ask, then play_playlist if they want it now: never play_uris, so the set can be kept and steered."
    : "A SET asked of them (a length, a mood, a subject) is play_uris: this house has no requests preset to keep it on.";
  return `${play}${told} ${set}` + (endless ? " A direction while they play endless (\"more upbeat\") is steer_endless, never a rewrite." : "");
}
// The door's refusal while a request writes a guest, and the page's flash
// for it: one sentence, so the two cannot drift.
export function guestBusyWords(djName, label) {
  return `a set for ${djName || "another request"} is being written to the ${label} requests preset right ` +
    "now; try again in a minute. Nothing was changed.";
}
// WHO IS ON A GUEST (MC-18 stage 2): `on:<playlistId>` = { dj, ref, at }.
// `dj` and `ref` come from the calling code — the ledger row, the programme
// record, the snapshot — and, since 2026-09-28 (the owner's option 2),
// replace_playlist's `dj` for a DJ the house knows. A write that names no
// holder is a plain replace: no DJ, and `talk` when Talk made it (env.__via,
// set on their own copy of env at the voice's two doors, the way withBudget
// sets __budget).
export function onRecord(env, holder) {
  const dj = typeof holder?.dj === "string" && holder.dj ? holder.dj.slice(0, 64) : null;
  const ref = String(holder?.ref || (env.__via === "talk" ? "talk" : "replace")).slice(0, 80);
  return { dj, ref, at: new Date().toISOString() };
}
export async function dropOn(env, id) {
  try { await programsKV(env).delete(`on:${id}`); } catch { /* a stale name for a minute, never a wrong write */ }
}

// WHEN, IN THE HOUSE'S OWN CLOCK (MC-18 stage 4): { time, day } — "20:02" and
// no day for today, "Sat" and the time within the week, "3 Sep" and no time
// before that. The house is where the remote is, so its zone: never the
// server's, never the Tidal account's. The month is spelled here, not by the
// platform, whose "Sept" and "Sep" differ between versions. Null for a stamp
// that does not parse: absent beats wrong.
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function houseClockWords(env, iso, now = Date.now()) {
  const d = new Date(typeof iso === "string" && iso ? iso : NaN);
  if (!Number.isFinite(d.getTime())) return null;
  let tz;
  try { tz = houseTz(env); } catch { tz = "UTC"; }
  const parts = (t) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t).map((p) => [p.type, p.value]));
  const a = parts(d), b = parts(new Date(now));
  const dayOf = (p) => Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const ago = Math.round((dayOf(b) - dayOf(a)) / 86400000);
  const time = `${a.hour}:${a.minute}`;
  if (ago === 0) return { time, day: null };
  if (ago > 0 && ago < 7) return { time, day: a.weekday };
  return { time: null, day: `${Number(a.day)} ${MONTHS[Number(a.month) - 1]}` };
}
// "since 20:02", "since Sat 20:02", "since 3 Sep".
export function sinceWords(w) {
  return w ? `since ${[w.day, w.time].filter(Boolean).join(" ")}` : null;
}
// "loaded 20:02", "loaded Sat 20:02", "loaded 3 Sep": when a set went on a
// guest, as the Loaded tab says it (the owner, 2026-09-23, of "since 00:15":
// "I don't understand this" — "since" read as something still running).
export function loadedWords(w) {
  return w ? `loaded ${[w.day, w.time].filter(Boolean).join(" ")}` : null;
}
// "at 20:02", "on Sat at 20:02", "on 3 Sep".
export function atWords(w) {
  return !w ? null : w.day ? `on ${w.day}${w.time ? ` at ${w.time}` : ""}` : `at ${w.time}`;
}
// THE DAY A REQUEST WAS ASKED, on the house's calendar: "2026-09-12". The
// stamp is UTC, and the DJ page printed its first ten characters, so an
// evening ask in San Francisco read as the next day's (found 2026-09-13). A
// bare day is already a day. A zone that will not parse falls back to UTC's
// day rather than failing the page; a stamp that does not parse is null,
// since absent beats wrong.
export function askDay(env, at) {
  const s = typeof at === "string" ? at.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  if (!s || !Number.isFinite(ms)) return null;
  try { return houseDay(env, ms); } catch { return new Date(ms).toISOString().slice(0, 10); }
}
// "as asked on 2026-09-12", or "as asked" when the day is not known.
export function askedTag(env, at) {
  const day = askDay(env, at);
  return `as asked${day ? ` on ${day}` : ""}`;
}

// WHO IS ON EACH LIVE GUEST (MC-18 stage 4): its `on:` record, keyed by
// service. One KV read a guest, none while every guest is dark. `failed` when
// the read did: unknown is not nobody.
export async function guestHolders(env) {
  let guests = [];
  try { guests = Object.values(house(env).guest ?? {}).filter((g) => g?.live); } catch { guests = []; }
  const out = {};
  await Promise.all(guests.map(async (g) => {
    let on = null;
    let failed = false;
    try { on = await programsKV(env).get(`on:${g.playlist}`, { type: "json" }); } catch { failed = true; }
    out[g.catalog] = { guest: g, on: on && typeof on === "object" && !Array.isArray(on) ? on : null, failed };
  }));
  return out;
}

// THE NEWEST ASK BOUND FOR EACH LIVE GUEST (2026-09-13, the owner: "I asked
// for a set but I can't tell which DJ or if it succeeded"). The presets page
// says it under the guest's band: in flight, or passed on or needing
// attention since the guest's current set landed and within twelve hours.
// One ledger read for every guest; empty when the ledger is out of reach,
// since absent beats wrong. `sig` changes whenever any of them does, which is
// what a page left open compares.
export const GUEST_ASK_STATES = ["pending", "claimed", "declined", "needs-attention"];
export const GUEST_ASK_WINDOW_MS = 12 * 60 * 60 * 1000;
export async function guestAsks(env, holders, now = Date.now()) {
  if (!env.STATION) return { asks: [], sig: "" };
  let guests = [];
  try { guests = Object.values(house(env).guest ?? {}).filter((g) => g?.live); } catch { guests = []; }
  if (!guests.length) return { asks: [], sig: "" };
  let rows = [];
  try { rows = (await station(env, "list", { states: GUEST_ASK_STATES }))?.rows ?? []; } catch { return { asks: [], sig: "" }; }
  const asks = [];
  for (const g of guests) {
    const row = rows.find((r) => r.destination === g.playlist); // newest first
    if (!row) continue;
    const settled = row.state === "declined" || row.state === "needs-attention";
    const landed = Date.parse(holders?.[g.catalog]?.on?.at ?? "") || 0;
    if (settled && (row.created_at < landed || now - row.created_at > GUEST_ASK_WINDOW_MS)) continue;
    asks.push({ btn: g.btn, catalog: g.catalog, row });
  }
  return { asks, sig: asks.map((a) => `${a.row.id}:${a.row.state}`).join(",") };
}
// WHERE MUSIC ON NO BAND COMES FROM, in words, for the line over the wall:
// Talk and a programme's replay copy play the Replay playlist, which no
// preset holds (the owner, 2026-09-13, asked Talk for a set and took it to be
// on preset 1).
export function playingFromWords(env, p) {
  const replay = configuredPlaylistId(env, env.PROGRAM_REPLAY_PLAYLIST || "replay");
  if (p?.pid && replay && p.pid === replay) return "the Replay playlist";
  return { playlist: "a playlist", album: "an album", artist: "an artist", show: "a podcast",
    episode: "a podcast" }[p?.kind ?? ""] ?? "a queue of tracks";
}

// THE NEWEST SET ON ANY LIVE GUEST, in ms (2026-09-13): the presets page is
// drawn with it and /playing reports it, so a page left open on screen can
// tell that a guest took a set after it was drawn. The same `on:` records,
// read the same way, in both; 0 for none, and an unreadable one counts as
// none, since the page only ever reloads for a NEWER time.
export function newestOn(records) {
  let newest = 0;
  for (const on of records) {
    const t = Date.parse(on && typeof on.at === "string" ? on.at : "");
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
}

// WHERE A DJ'S SETS ARE, FOR THEIR PAGE AND THEIR PLAY (MC-18 stage 4). For a
// DJ on no preset, per service, Spotify first — the one Play reaches: the live
// guest there, theirs only while its `on:` names them; else their crate
// there, as before. Null for a DJ on a preset, and while every guest is dark,
// and then the page and the Play are exactly what they were.
export function djPlaces(dj, holders) {
  if (!dj || dj.button || !holders || !Object.keys(holders).length) return null;
  const places = [];
  for (const cat of ["spotify", ...CATALOGS.filter((c) => c !== "spotify")]) {
    const h = holders[cat];
    if (h) {
      if (h.on?.dj === dj.key) {
        places.push({ kind: "guest", catalog: cat, pid: h.guest.playlist, guest: h.guest, on: h.on });
      }
    }
  }
  return places;
}

// Whether the house still has a preset a DJ can be put on (MC-18 stage 4): a
// slot that is neither a guest nor the archive. None after the switch-over,
// and then nothing offers "Put on a preset".
export function djSlotsExist(env) {
  try { return house(env).buttons.some((b) => !b.archive && !b.guest); } catch { return true; }
}
// A LEGACY playlist (MC-18): one this house used to write to and no longer
// does — a preset's playlist from before it became a guest — kept in
// PLAYLIST_ALIASES under a name beginning "was " so that a snapshot of it
// stays restorable for its 90 days. The alias is on the undo's membership set
// and on nothing else: every other write to it is refused, in the door.
// Answers the alias, or null.
export function legacyAliasFor(env, id) {
  if (!id) return null;
  try {
    const aliases = parseAliases(env);
    return Object.keys(aliases).find((k) => aliases[k].legacy && aliases[k].id === id) ?? null;
  } catch {
    return null;
  }
}

// Searches EVERY persona, not just the roster: an archive DJ has to be
// findable — get_dj answers for them and the archive's page asks them for sets
// — while staying unplaceable. Placing is refused where placing happens
// (parseButtons, moveDj, benchDj), not by hiding them from a name lookup: a
// lookup that cannot find a DJ somebody can plainly see is its own bug.
export function findDj(env, ref) {
  const needle = fold(String(ref ?? ""));
  const roster = Object.values(house(env).djs);
  for (const dj of roster) {
    if (fold(dj.key) === needle || fold(dj.name) === needle) return dj;
    if (dj.aliases.some((a) => fold(a) === needle)) return dj;
  }
  // Fall back to a WORD-PREFIX match, never an internal fragment: "ken" must
  // not resolve to Funkenstein and "a" must not resolve to anybody. A request
  // for a character we do not have has to fail, not quietly become another one.
  if (needle.length < 3) return null;
  const startsAWord = (s) =>
    fold(s).split(/[^a-z0-9]+/).some((w) => w && w.startsWith(needle));
  const loose = roster.filter(
    (dj) => startsAWord(dj.name) || dj.aliases.some(startsAWord));
  return loose.length === 1 ? loose[0] : null;
}

// Whose programme this is.
//
// `dj` has been written into every program record and every shelf entry since
// programs existed, so this is almost always just findDj. The fallback is for
// the one case that can still turn up: a record from before there was more than
// one DJ who writes them, which could only ever have been the Professor's.
// Defaulting there is safer than refusing to place a programme whose button is
// sitting empty — and it is not a guess, it is the only thing it could be.
// The Professor was cut on 2026-10-15 (the owner), so such a record finds
// nobody now, as any cut DJ's does, and is refused in words.
export function programDj(env, who) {
  return findDj(env, String(who ?? "").trim() || "the professor");
}

// THE SHELF ON A DJ'S PAGE: their newest six programmes, from the listing
// metadata. One builder for every page
// that has one — the DJ pages and, since 2026-09-07, the archive's, whose DJ
// has no button and whose "live" row is the archive pointer rather than a
// playlist's. Never throws: the page stands without its shelf.
export async function shelfFor(env, dj, summaries, currentSlug, link = null) {
  try {
    // By the roster's key, not the name as written (Codex's review,
    // 2026-10-09): a programme filed under "DJ Stax" is Stax's.
    const mine = (summaries ?? []).filter((x) => fold(x.dj ?? "") === fold(dj.name) || findDj(env, x.dj)?.key === dj.key);
    if (!mine.length) return null;
    // Six, for the page's grid (board A, 2026-09-25), and no standfirsts:
    // a card carries the cover, the title and how long, and each standfirst
    // was a KV read per row.
    const top = mine.slice(0, 6);
    return {
      n: mine.length,
      // Whether any of the rows SHOWN can actually be put on the button. The
      // empty-state sentence points at the shelf, and it must not point at
      // one where every row is refused — a DJ whose only work was written on
      // the other service has nothing to offer here.
      //
      // With no standfirst read there is no record open, so no playlistId:
      // the listing's own `catalog` stands in for where it was written
      // (2026-09-25) — without it every row read as fitting, and a DJ whose
      // only work is on the other service was pointed at a shelf that
      // cannot help.
      offerable: top.some((r) => !shelfElsewhere(env, r, { byCatalog: true })),
      rows: top.map((r) => ({
        id: r.id, title: r.title ?? r.id,
        // Inside the app, the keyed programme page with a way back to this
        // DJ (MC-14); the public URL otherwise.
        href: link ? `${link.base}/programs/${r.id}?from=${encodeURIComponent(link.from)}` : safeUrl(r.url),
        gist: r.standfirst ?? "", when: String(r.created ?? "").slice(0, 10),
        meta: [r.tracks ? plural(r.tracks, "track") : "", r.runtime ?? ""]
          .filter(Boolean).join(" · "),
        image: imageUrl(r.image), live: r.id === currentSlug,
        elsewhere: shelfElsewhere(env, r, { byCatalog: true }),
        // So the row's control can say which service it loads on (2026-09-11).
        catalog: r.catalog ?? null,
        // And whether the row can carry the fold that deletes its page: every
        // row since 2026-09-13 (the owner: "add a delete button for those
        // too"), when the unkeep endpoint stopped refusing written programmes.
        removable: true,
      })),
    };
  } catch { return null; }
}

// Which DJ a playlist is CONFIGURED for. Deliberately keyed off the playlist id
// rather than how the caller happened to address it, so asking by id or by name
// gives the same answer as asking by "button 1".
//
// This is the button's standing owner, not a claim about what is currently in
// it — put a Prince introduction on Funkenstein's button and the button still
// belongs to Funkenstein. Anything topping up should check the contents agree
// before assuming the voice.
// The reverse of resolvePlaylist's alias branch. The label map already holds
// each value normalised to its bare id, so a value written as a URI or a
// share link matches the same as one written bare — and the two services'
// id shapes are disjoint, so an id names its catalog as well as its playlist.
export function aliasForPlaylistId(env, id) {
  try {
    const aliases = parseAliases(env);
    return Object.keys(aliases).find((k) => aliases[k].id === id) ?? null;
  } catch {
    // A broken alias map must not cost a caller its labels.
    return null;
  }
}

export function djForPlaylistId(env, id) {
  try {
    // `id &&`: a DJ off the wall has `playlist: null`, and null must not
    // find them for a caller holding nothing.
    return (id && house(env).roster.find((dj) =>
      dj.playlist === id)) || null;
  } catch {
    return null;
  }
}

// A playback context back to something a person recognises: "button 2 (Hank)".
// The alias table is the only link from a playlist to a physical button and it
// is maintained by hand, so a miss here is ordinary — fall back to the name, and
// to the id, rather than dropping the entry.
export function contextLabel(env, uri, names) {
  if (!uri) return null;
  const id = playlistIdFrom(uri);
  if (!id) {
    const kind = String(uri).split(":")[1];
    return kind ? `a Spotify ${kind}` : null;
  }
  const alias = aliasForPlaylistId(env, id);
  const dj = djForPlaylistId(env, id);
  if (alias && dj) return `${alias} (${dj.name})`;
  if (alias) return alias;
  const name = names?.get(id);
  return name ? `"${name}"` : `playlist ${id}`;
}
