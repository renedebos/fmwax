// THE HOUSE'S WEEK (the owner, 2026-11-07: "a 7-day recently written track
// log so DJs stop repeating songs across request sets. Tracks only"). Every
// song a DJ put in front of the house in the last seven days, whoever the DJ
// and whichever the preset, so the next set leaves it out. Measured first on
// the house's backups of 44 days: 12 of 36 sets on the Requests presets held
// a song from the week before, 59 of 590 songs.
//
// What counts, by where the songs went:
// - a set written to a playlist (a request, the Claude app, ChatGPT, Talk, a
//   program put on a preset): what was WRITTEN, once it landed. The house
//   cannot see what plays from a Tidal preset, nor whether anyone pressed one.
// - an endless DJ: what PLAYED, as the watch saw it (endlessRemember). An
//   endless list is written ahead and often never heard; counting it is how
//   The Selector was boxed into a six-song set (2026-09-25).
// - never: an undo or a restore, an old set put back (activate_program, the
//   Shelf, the guest DJ taking a kept program), the songs an endless stop
//   keeps, or the archive. None is a new choice.
//
// Tracks only, by the exact recording (its URI): another take of a song is
// another song, and an artist may come back the next set. Kept in the ledger
// (station.js `played_week`), not KV: the free tier's thousand lists a day,
// and a read per write, would be spent on every DJ's brief, where the ledger
// answers in one call (the owner chose this, 2026-11-07, after Codex's
// review of the plan).
//
// Never a reason a write fails: a ledger that does not answer logs nothing,
// flags nothing and lists nothing. Unbudgeted, like the rule check: a
// Cloudflare call that must not crowd out a Spotify one.
import { station } from "./station.js";
import { findDj, guestForPlaylistId, house } from "./house.js";

// "Artist, Artist — Title", the label the endless watch and Spotify's own
// history use, from a track as the catalogs describe one.
export function labelOf(t) {
  if (!t?.name) return null;
  const who = (t.artists ?? []).map((a) => a?.name).filter(Boolean).join(", ");
  return `${who ? `${who} — ` : ""}${t.name}`.slice(0, 160);
}

// The preset a playlist is, for the log's line: a DJ's button or a guest's.
export function presetOf(env, playlistId) {
  if (!playlistId) return null;
  const g = guestForPlaylistId(env, playlistId);
  if (g?.btn) return g.btn;
  try { return house(env).buttons.find((b) => b.playlist === playlistId)?.btn ?? null; } catch { return null; }
}

// A write that LANDED, logged: `uris` as written, `items` the read-back when
// there was a confirmed one (its names save a lookup). Answers the songs of
// it the week already held, as the house had them just before.
export async function logWeek(env, { uris, items = null, dj = null, btn = null, catalog = null,
  playlist = null, source = "written", check = true }) {
  const list = (uris ?? []).filter((u) => typeof u === "string" && u);
  if (!env?.STATION || !list.length) return [];
  const names = new Map();
  for (const t of items ?? []) {
    const l = labelOf(t);
    if (!l) continue;
    if (t.uri) names.set(t.uri, l);
    if (t.linked_from?.uri) names.set(t.linked_from.uri, l);
  }
  const rows = list.map((u) => [u, names.get(u) ?? null]);
  try {
    const got = await station(env, "played-log", { rows, dj, btn: btn ?? presetOf(env, playlist), catalog, playlist, source, check },
      { unbudgeted: true });
    return got?.ok ? got.repeats ?? [] : [];
  } catch { return []; }
}

// What the endless watch heard, logged as played: [{ dj, btn, playlist,
// tracks: [[uri, label]] }].
export async function logHeard(env, heard) {
  for (const h of heard ?? []) {
    const rows = (h.tracks ?? []).filter((t) => t?.[0]);
    if (!rows.length || !env?.STATION) continue;
    try {
      await station(env, "played-log", { rows: rows.map((t) => [t[0], t[1] || null]), dj: h.dj ?? null,
        btn: h.btn ?? null, catalog: "spotify", playlist: h.playlist ?? null, source: "played", check: false }, { unbudgeted: true });
    } catch { /* a lost line is a lost line */ }
  }
}

// The week as a DJ reads it, in get_dj's brief: { played_last_7_days }
// and, past the list's length, how many more the write still catches.
export async function weekField(env) {
  if (!env?.STATION) return {};
  let got = null;
  try { got = await station(env, "played-list", {}, { unbudgeted: true }); } catch { got = null; }
  if (!got?.ok || !got.songs?.length) return {};
  return { played_last_7_days: got.songs,
    ...(got.more ? { played_last_7_days_note: `And ${got.more} older songs, not listed: the house still names them ` +
      "if a set holds one." } : {}) };
}

// When, in words a DJ reads at a glance.
export function agoWords(at, now = Date.now()) {
  const h = Math.floor((now - at) / 3600e3);
  if (h < 1) return "within the hour";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
// A repeat in words: the song, when, and whose set it was in.
export function repeatLine(env, r, now = Date.now()) {
  const who = r.dj ? findDj(env, r.dj)?.name ?? r.dj : null;
  return `${r.label ?? r.uri} (${agoWords(r.at, now)}${who ? `, ${who}` : ""})`;
}

// A write's answer: the songs of it the week already held. Flagged, never
// refused: a listener may have asked for one by name.
export function repeatsField(env, repeats, now = Date.now()) {
  if (!repeats?.length) return {};
  return { repeats: repeats.map((r) => repeatLine(env, r, now)),
    repeats_note: "Already in the house's last 7 days (NOT THIS WEEK in house_rules). Written as sent: swap any " +
      "the listener did not name, with the whole set rewritten." };
}

// The same, as one of the rules the house counts before a request's or an
// endless job's set is written (setcheck.js): sent back once, then written.
export function weekBreak(env, played, uris, now = Date.now()) {
  const at = (played ?? []).map((r) => ({ r, i: uris.indexOf(r.uri) })).filter((x) => x.i >= 0);
  if (!at.length) return [];
  const where = at.length === 1 ? `song ${at[0].i + 1} was` : `songs ${at.map((x) => x.i + 1).join(", ")} were`;
  const names = at.slice(0, 5).map((x) => repeatLine(env, x.r, now)).join("; ");
  return [`${where} already played this week (${names}${at.length > 5 ? "; …" : ""}): keep one only if the ` +
    "listener asked for it by name"];
}
