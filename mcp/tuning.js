// TUNING A DJ (MC-32, tasks/mc32-dj-tuning.md). A listener moves a DJ's
// dials (djs.js TUNE) and the DJ stays that way until they move them back.
// A DJ is a writer, not a machine with knobs, so a dial becomes two things:
// WORDS the curator reads, in get_dj and on every job for that DJ, and where
// a machine can count it, a RULE the house checks before a set lands (same
// artist, into setcheck's spacing). The words carry counts per hour: the
// word trial of 2026-10-23 (tasks/mc32-trial/) found "8 or 9 in an hour"
// held where "about half" alone drifted.
//
// Kept in the house's settings store as one page setting, DJ_TUNING: a JSON
// object of DJ key -> the dials moved off their own stop. Only moved dials
// are kept; a DJ with none is not in it.
import { PERSONAS, TUNE } from "./djs.js";

export const TUNING_SETTING = "DJ_TUNING";
export const TUNING_MAX = 2000;
const SAME = ["any", "sometimes", "rarely"];
const NOTES = ["short", "long"];
export const thisYear = () => new Date().getUTCFullYear();

// What the panel shows: a dial's name and its stops' names.
const STOP_NAMES = {
  hits: { none: "None", few: "A few", half: "Half", mostly: "Mostly" },
  landmarks: { half: "Half", mostly: "Mostly" },
  albums: { deep: "Deep", mixed: "Mixed", classics: "Classics" },
  same: { any: "Any", sometimes: "Sometimes", rarely: "Rarely" },
  stay: { only: "Only", mostly: "Mostly", wander: "Wander" },
  mood: { hour: "The hour", morning: "Morning", room: "Room", late: "Small hours" },
  career: { early: "Early", all: "All of it", late: "Late" },
  live: { none: "None", some: "Some", lots: "Lots" },
  order: { mixed: "Mixed", order: "In order" },
  notes: { short: "Short", long: "Long read" },
};
const DIAL_NAMES = { years: "Years", hits: "Hits", landmarks: "Landmarks", albums: "Albums", same: "Same artist",
  mood: "Mood", career: "Career", live: "Live takes", order: "Order", notes: "Notes" };

// A kept set's notes start on the house's default (requests.notes).
const notesOwn = (env) => (env?.REQUEST_NOTES === "long" ? "long" : "short");

// A DJ's dials, resolved: every dial with its stops, its own stop, its name.
export function dialsOf(key, env = null) {
  return (TUNE[key] ?? []).map((d) => {
    const kind = d.as ?? d.id;
    if (d.id === "years") {
      const track = d.track.map((y) => (y === "now" ? thisYear() : y));
      return { id: "years", kind, name: DIAL_NAMES.years, track };
    }
    const stops = d.id === "same" ? SAME : d.id === "notes" ? NOTES : d.stops;
    const own = d.id === "notes" ? notesOwn(env) : d.own;
    const name = d.id === "stay" ? `Stay in ${d.in}` : DIAL_NAMES[kind];
    return { id: d.id, kind, name, stops, own, labels: stops.map((s) => STOP_NAMES[kind]?.[s] ?? s), ...(d.in ? { in: d.in } : {}) };
  });
}

// Only what this DJ's dials allow, and only what is off its own stop.
export function cleanTuning(key, raw, env = null) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const d of dialsOf(key, env)) {
    const v = raw[d.id];
    if (d.id === "years") {
      if (!Array.isArray(v) || v.length !== 2) continue;
      const [a, b] = v.map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a > b || a < d.track[0] || b > d.track[1]) continue;
      if (a === d.track[0] && b === d.track[1]) continue;
      out.years = [a, b];
    } else if (d.stops.includes(v) && v !== d.own) out[d.id] = v;
  }
  return out;
}

// Every tuned DJ, as the store has it; anything it cannot use is left out.
export function readTuning(env) {
  let raw = env?.[TUNING_SETTING];
  if (!raw) return {};
  try { if (typeof raw === "string") raw = JSON.parse(raw); } catch { return {}; }
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const key of Object.keys(TUNE)) {
    const t = cleanTuning(key, raw[key], env);
    if (Object.keys(t).length) out[key] = t;
  }
  return out;
}
export const tuningOf = (env, key) => readTuning(env)[key] ?? {};

// The setting as it would be stored with this DJ's dials changed (or reset,
// with {}), or null when no DJ is tuned any more.
export function tuningWith(env, key, values) {
  const all = readTuning(env);
  const t = cleanTuning(key, values, env);
  if (Object.keys(t).length) all[key] = t; else delete all[key];
  if (!Object.keys(all).length) return null;
  const json = JSON.stringify(all);
  if (json.length > TUNING_MAX) throw new Error("too much tuning to keep");
  return json;
}

// THE WORDS. One line per moved dial, under a head that says what wins.
// WHAT A HIT IS, SAID ONCE AND COUNTED (the owner, 2026-10-24, after Soul
// tuned to "a few hits" played four big chart records in eleven songs:
// "tighten the hits selection"). A hit is any record on a national chart,
// pop or R&B, so the soul and R&B hits count too, and the stop is a ceiling
// to count against, scaled to a 45-minute batch.
const HIT_IS = "A hit is any record that reached a national chart, pop or R&B, in the US or the UK, or an act's best-known song.";
const HITS = {
  none: `HITS: none. ${HIT_IS} No hit at all: album tracks, B-sides and the second rank only.`,
  few: `HITS: a few, counted. ${HIT_IS} At most 3 in an hour of 16 to 18 songs, so at most 2 in a 45-minute batch; every other song never charted: album tracks, B-sides, the second rank. Count the hits before you send the set.`,
  half: `HITS: about half, counted. ${HIT_IS} 8 or 9 in an hour of 16 to 18 songs, 5 or 6 in a 45-minute batch; every other song never charted. Count the hits before you send the set.`,
  mostly: `HITS: mostly. ${HIT_IS} 12 to 14 in an hour of 16 to 18 songs; the rest are the bench behind them.`,
};
const LANDMARKS = {
  mostly: "LANDMARKS: mostly. In an hour, about three songs in four are the records the fence is known for; the rest show why they happened or what they made possible.",
};
const ALBUMS = {
  deep: "ALBUMS: deep. Albums a fan might not own: never a record that was on every shelf of its day.",
  classics: "ALBUMS: the classics. Mostly the albums the era is known for, the ones on every shelf; a deeper one at most once an hour.",
};
const SAME_WORDS = {
  any: "SAME ARTIST: runs are welcome. An act may come back within the hour, and two songs in a row by one act is fine.",
  sometimes: "SAME ARTIST: never two songs in a row by one act, and no act more than twice an hour.",
  rarely: "SAME ARTIST: never two songs in a row by one act, and no act more than once an hour.",
};
const MOOD = { morning: "THE MORNING", room: "THE ROOM", late: "THE SMALL HOURS" };
function lineFor(d, v) {
  switch (d.id) {
    case "years": return `YEARS: only music recorded from ${v[0]} to ${v[1]} (when the music was made, not when it was issued).`;
    case "hits": return (d.kind === "landmarks" ? LANDMARKS : d.kind === "albums" ? ALBUMS : HITS)[v] ?? null;
    case "same": return SAME_WORDS[v];
    case "stay": {
      const x = d.in === "the genre" ? "THE GENRE ASKED FOR" : d.in.toUpperCase();
      const y = d.in === "the genre" ? "that genre" : d.in;
      return v === "only" ? `STAY IN ${x}: strictly. Only records the people who made ${y} would call theirs; nothing from the genres either side of it.`
        : v === "mostly" ? `STAY IN ${x}: mostly. About one song in five, 3 or 4 in an hour, comes from the genres either side of it; the rest is ${y} itself.`
        : `STAY IN ${x}: follow the music. Start in ${y}; up to half the set, 8 or 9 songs in an hour, may come from the genres before, after and beside it, wherever its records lead.`;
    }
    case "mood": return `MOOD: always ${MOOD[v]}, whatever the hour; the hour no longer picks the mood. Say so in the set's first line.`;
    case "career": return v === "early"
      ? "CAREER: the early years only: the first third of the artist's recording career, by when the music was made. Say in the set's first line where you drew the line."
      : "CAREER: the late years only: the last third of the artist's recording career, up to their latest record. Say in the set's first line where you drew the line.";
    case "live": return v === "none" ? "LIVE TAKES: none. Studio recordings only."
      : "LIVE TAKES: lots. In an hour of 16 to 18 songs, 5 or 6 are live recordings: the concert albums, live B-sides and radio sessions.";
    case "order": return v === "order"
      ? "ORDER: in order. The career from the first record to the latest, by when the music was made, instead of early beside late; a top-up carries on from where the list ends and never goes back to the start."
      : "ORDER: mixed, not in order: the fence's records side by side for contrast, never two from one year in a row.";
    default: return null; // notes: the Ask form's default, nothing to curate by
  }
}
export function tuningWords(env, key) {
  const t = tuningOf(env, key);
  const lines = dialsOf(key, env).filter((d) => t[d.id] !== undefined).map((d) => lineFor(d, t[d.id])).filter(Boolean);
  if (!lines.length) return null;
  const name = PERSONAS[key]?.name ?? key;
  return `THE LISTENER'S TUNING FOR ${name.toUpperCase()}, set on the DJ's page and kept until they change it. ` +
    "Each line REPLACES what the brief says on that point, even where the brief says never: it is the listener's own " +
    "choice about this DJ, so the taste rules give way to it here. Everything else in the brief stands, and words in a " +
    "request still win over a line here (THE SUBJECT WINS).\n- " + lines.join("\n- ");
}

// A tuning in a few words, for the page's line and a steer's direction.
const SHORT = {
  hits: { none: "no hits", few: "a few hits", half: "about half hits", mostly: "mostly hits" },
  landmarks: { mostly: "mostly landmarks" },
  albums: { deep: "deep albums", classics: "the classic albums" },
  same: { any: "runs of one artist welcome", sometimes: "the same artist now and then", rarely: "rarely the same artist" },
  mood: { morning: "always the morning", room: "always the room", late: "always the small hours" },
  career: { early: "the early years", late: "the late years" },
  live: { none: "no live takes", lots: "lots of live takes" },
  order: { order: "in order", mixed: "mixed" },
  notes: { short: "short notes", long: "the long read" },
};
export function tuningSummary(env, key, values = null) {
  const t = values ?? tuningOf(env, key);
  return dialsOf(key, env).filter((d) => t[d.id] !== undefined).map((d) => {
    const v = t[d.id];
    if (d.id === "years") return `${v[0]}–${v[1]}`;
    if (d.id === "stay") return v === "only" ? `only ${d.in}` : v === "mostly" ? `mostly ${d.in}` : `wandering from ${d.in}`;
    return SHORT[d.kind]?.[v] ?? v;
  }).join(", ");
}

// THE RULE THE HOUSE COUNTS: a tuned same artist replaces the DJ's own
// artist spacing; its other rules (Deep Dive's albums, Soul's one-artist
// asks) stay.
export function tunedSpacing(env, dj) {
  const base = dj?.spacing ?? null;
  const v = dj?.key ? tuningOf(env, dj.key).same : undefined;
  if (!v) return base;
  const { artistRun, artistPerHour, artistPerSet, say, ...rest } = base ?? {};
  if (v === "any") return Object.keys(rest).length ? rest : null;
  return { ...rest, artistRun: 1, artistPerHour: v === "rarely" ? 1 : 2,
    say: `never two songs by one act in a row, and no act more than ${v === "rarely" ? "once" : "twice"} an hour (the listener's tuning)` };
}

// The Tune form's fields, as dial values. The panel's sliders send a stop's
// place (0, 1, 2…) and the years as years_from and years_to; a stop's name
// and "1966-1970" are read too. Unknown fields are ignored; cleanTuning keeps
// what fits, so a missing field is the DJ's own stop.
export function tuningFromForm(key, form, env = null) {
  const raw = {};
  const get = (n) => String(form?.get?.(n) ?? "").trim();
  for (const d of dialsOf(key, env)) {
    if (d.id === "years") {
      const m = get("years").match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
      const a = m ? m[1] : get("years_from"), b = m ? m[2] : get("years_to");
      if (/^\d{4}$/.test(a) && /^\d{4}$/.test(b)) raw.years = [Number(a), Number(b)];
      continue;
    }
    const v = get(d.id);
    if (!v) continue;
    raw[d.id] = /^\d$/.test(v) ? d.stops[Number(v)] : v;
  }
  return cleanTuning(key, raw, env);
}

// What the Tune form draws for a DJ: each dial with where it stands now.
export function tuneDials(env, key) {
  const t = tuningOf(env, key);
  return dialsOf(key, env).map((d) => d.id === "years"
    ? { ...d, value: t.years ?? d.track, now: thisYear() }
    : { ...d, value: d.stops.indexOf(t[d.id] ?? d.own), ownAt: d.stops.indexOf(d.own) });
}
