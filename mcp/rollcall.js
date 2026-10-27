// ROLL CALLS (the curation trial, 2026-10-11/12; tasks/rollcalls/). A brief
// names a handful of acts and the curator's memory does the rest, and memory
// leans on the names written down: Pub Rock's brief names 17 bands, the field
// has well over a hundred. A roll call is that field, gathered from outside
// sources and reviewed by the owner (rollcalls.js). A job carries a SLICE of
// it — the dozen acts that fit what was asked and three border cases with why
// — never the whole list, because a long list reads as a menu and costs Talk
// by the word (Codex's review, 2026-10-11). In the blind test over 12 asks the
// slice took the sets from 35 different artists to 42.
//
// Simple word matching, on purpose: no model call, no outside lookup, and the
// same answer for the same ask. A broad ask ("45 minutes", a top-up) matches
// nothing and gets a spread instead, leaning on acts the brief does not name
// and the DJ has not played lately — the part that should spread an endless
// DJ furthest.
import { ROLL_CALLS } from "./rollcalls.js";

const FITS = 12, NOTS = 3;
const STOP = new Set(("a an and the of for in on to my me i it its is be with what when they their from every all into up " +
  "set sets songs song music some more less please give play just about like want hear minutes minute hour hours " +
  // "jazz" and "monk" were here for Monk, whose whole field was jazz, until
  // he was cut (2026-10-15).
  "night tonight morning evening long short dj pub rock circuit band bands records record " +
  // "Something unplugged" matched Something for Kate (Sessions, 2026-10-26).
  "something anything").split(" "));
// A DJ's own field said in an ask ("1 hour of funk" to Dr. Funkenstein)
// names his whole crate, not a corner of it. Without this the word matched
// band NAMES (2026-10-13: Sons Of Funk, Funk Machine, Funk Inc. — a dozen
// "Funk" bands for an hour of funk) where it should be a broad ask.
const FIELD = { "dr-funkenstein": ["funk", "funky", "soul"], hank: ["funk", "funky", "soul"],
  "genre:jazz": ["jazz", "jazzy", "genre"] };
// GENRE'S ROLL CALLS (2026-10-18). Genre plays whatever genre was asked, so
// its roll calls are by genre ("genre:jazz" in rollcalls.js) and the ask's
// words pick one. Jazz is Monk's, from when he was the jazz DJ (cut
// 2026-10-15). It never had smooth, acid or nu jazz in it (Monk's reviewers
// took them out), nor jazz rap, so an ask for those gets no roll call rather
// than one that tells the set to stay out of them.
const GENRES = {
  jazz: { asks: /\bjazz|\bbe-?bop\b|\bhard[ -]bop\b|\bpost-?bop\b|\bbig[ -]bands?\b|\bdixieland\b|\bbossa nova\b/,
    unless: /\b(smooth|acid|nu|electro)[ -]?(jazz|swing)\b|\bjazz[ -]?(rap|hop|house|dance)\b/ },
};
// The roll call an ask reaches: the DJ's own, or for Genre the genre's its
// words name. Null when there is none.
function rollCallKey(djKey, words = "") {
  const key = String(djKey ?? "");
  if (ROLL_CALLS[key]) return key;
  if (key !== "genre") return null;
  const t = String(words ?? "").toLowerCase();
  const g = Object.keys(GENRES).find((g) => ROLL_CALLS[`genre:${g}`] && GENRES[g].asks.test(t) && !GENRES[g].unless.test(t));
  return g ? `genre:${g}` : null;
}
// A few words that mean the same thing in an ask as in a reason line.
const ALSO = {
  "r&b": ["r&b", "rhythm and blues", "harmonica"], harmonica: ["harmonica", "r&b"], blues: ["blues", "r&b"],
  americans: ["american", "california", "texas", "us "], american: ["american", "california", "texas"],
  europeans: ["french", "france", "swedish", "sweden", "dutch", "german", "belgian"], european: ["french", "france", "swedish", "sweden", "dutch", "german"],
  country: ["country", "steel"], wave: ["new wave", "power pop"], later: ["later", "since", "re-formed", "reformed", "came back"],
  // The jazz words, written for Monk's styles (2026-10-12) and kept when he
  // was cut (2026-10-15): Dr. Funkenstein's and Hank's acts carry them too
  // (soul-jazz, jazz-funk, Latin, organ, vocal).
  bebop: ["bop", "bebop"], trad: ["dixieland", "trad"], dixieland: ["dixieland"], swing: ["swing", "big band"],
  organ: ["organ", "soul-jazz"], bossa: ["bossa nova"], latin: ["latin", "afro-cuban"], free: ["free jazz", "free improvisation", "avant-garde"],
  fusion: ["fusion", "jazz-funk", "jazz-rock"], singers: ["vocals", "vocal"], vocal: ["vocals", "vocal"], spiritual: ["spiritual jazz"],
  modal: ["modal", "post bop"], cool: ["cool jazz"], sax: ["saxophone"], saxophone: ["saxophone"], tenor: ["saxophone"], trumpet: ["trumpet"],
  // Hank's (2026-10-12): his acts are placed by city, an ask by country.
  finnish: ["finnish", "finland", "helsinki"], finland: ["finland", "finnish", "helsinki"],
  australian: ["australia", "melbourne", "sydney", "adelaide", "brisbane"], aussie: ["australia", "melbourne", "sydney", "adelaide"],
  british: ["uk", "british", "english", "london", "england", "liverpool", "wales", "scotland"], uk: ["uk", "british", "london", "england"],
  english: ["english", "england", "london", "uk"], german: ["german", "germany", "hamburg", "munich", "berlin", "cologne"],
  italian: ["italian", "italy", "milan", "bologna", "rome"], french: ["french", "france", "paris"],
  chicano: ["chicano", "southern california", "los angeles", "penrose"], brooklyn: ["brooklyn", "daptone"],
};

const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
// The group is a fact about the act too: Hank's label, Dr. Funkenstein's.
const textOf = (e) => [e.name, ...(e.aliases ?? []), e.branch, e.group, e.reason, e.place, e.years].filter(Boolean).join(" ").toLowerCase();
const namesOf = (e) => [e.name, ...(e.aliases ?? [])].map(norm).filter(Boolean);
const startYear = (e) => Number(String(e.years ?? "").match(/\d{4}/)?.[0]) || null;
const endYear = (e) => { const ys = String(e.years ?? "").match(/\d{4}/g); return ys ? Number(ys.at(-1)) : null; };

function wordsOf(ask) {
  const raw = String(ask ?? "").toLowerCase().match(/[a-z0-9&']+/g) ?? [];
  const out = [];
  for (const w of raw) if (!STOP.has(w) && !/^\d+$/.test(w)) out.push(...(ALSO[w] ?? [w]));
  return [...new Set(out)];
}
function score(e, ask, words, years) {
  const askN = ` ${norm(ask)} `, text = textOf(e);
  let s = 0;
  if (namesOf(e).some((n) => n.length > 2 && askN.includes(` ${n} `))) s += 5;
  for (const w of words) {
    if (w.length < 3 && w !== "us ") continue;
    if (namesOf(e).some((n) => ` ${n} `.includes(` ${norm(w)} `))) s += 3;
    else if (String(e.branch ?? "").toLowerCase().includes(w)) s += 2;
    else if (text.includes(w)) s += 1;
  }
  const a = startYear(e), b = endYear(e) ?? a;
  if (years.since && a && b >= years.since) s += 2;
  for (const y of years.plain) if (a && a <= y && y <= (b ?? a)) s += 1;
  return s;
}
function yearsOf(ask) {
  const t = String(ask ?? "").toLowerCase();
  const since = Number(t.match(/\b(?:since|after|from)\s+(?:the\s+)?(\d{4})/)?.[1]) || null;
  const plain = [...t.matchAll(/\b(19\d\d|20\d\d)\b/g)].map((m) => Number(m[1])).filter((y) => y !== since);
  return { since, plain };
}
// The same shuffle for the same seed, so a job's slice does not change between reads.
function shuffled(list, seed) {
  let h = 2166136261;
  for (const c of String(seed ?? "")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// "Artist, Artist — Title" labels (the endless history) to the artists' names.
export function artistsOfLabels(labels) {
  const out = new Set();
  for (const l of labels ?? []) for (const a of String(l ?? "").split(" — ")[0].split(", ")) if (norm(a)) out.add(norm(a));
  return out;
}

export const hasRollCall = (djKey, words = "") => !!rollCallKey(djKey, words);
// What get_dj says when no words came with it: the DJ's roll call, or the
// genres Genre has one for.
export function rollCallsOf(djKey) {
  const key = String(djKey ?? "");
  if (ROLL_CALLS[key]) return [{ acts: ROLL_CALLS[key].in.length }];
  return key === "genre" ? Object.keys(GENRES).filter((g) => ROLL_CALLS[`genre:${g}`])
    .map((g) => ({ genre: g, acts: ROLL_CALLS[`genre:${g}`].in.length })) : [];
}

// A word that matches a third of a roll call says nothing about which acts
// were asked for (Hank's "funk" and "soul", 2026-10-12): it is left out, so a
// "Finnish deep funk" ask is decided by "Finnish" and "deep".
const TEXTS = new WeakMap();
function telling(rc, words) {
  if (!TEXTS.has(rc)) TEXTS.set(rc, rc.in.map(textOf));
  const texts = TEXTS.get(rc);
  return words.filter((w) => texts.filter((t) => t.includes(w)).length * 3 <= texts.length);
}

// The slice for one job, or null for a DJ with no roll call (or Genre asked
// for a genre it has none for).
//   words  — what was asked: the listener's request, a steer, Talk's words
//   recent — labels of what this DJ played lately ("Artist — Title")
//   seed   — keeps the spread stable for one job
//   brief  — the DJ's brief, so the spread leans on acts it does not name
export function rollCallSlice(djKey, { words = "", recent = [], seed = "", brief = "" } = {}) {
  const key = rollCallKey(djKey, words);
  if (!key) return null;
  const rc = ROLL_CALLS[key];
  const field = new Set(FIELD[key] ?? []);
  const ws = telling(rc, wordsOf(words).filter((w) => !field.has(w))), ys = yearsOf(words);
  const heard = artistsOfLabels(recent), named = norm(brief);
  const fresh = (e) => !namesOf(e).some((n) => heard.has(n));
  const unnamed = (e) => !namesOf(e).some((n) => n.length > 2 && ` ${named} `.includes(` ${n} `));
  // A SPREAD ROLL CALL (Monk's first, 2026-10-12: all of jazz, thousands of
  // acts; Hank's and Dr. Funkenstein's since; Monk's is Genre's jazz since
  // 2026-10-18).
  // Equal matches go to acts not played lately and then by the job's own
  // shuffle, never to the best-known first; and what the ask leaves open is
  // filled round the groups, so an endless hour crosses styles and eras.
  const spread = !!rc.spread;
  const order = spread ? new Map(shuffled(rc.in, seed).map((e, i) => [e, i])) : null;
  const ranked = (list) => list.map((e, i) => ({ e, i, s: score(e, words, ws, ys) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || (spread ? (fresh(y.e) - fresh(x.e)) || (order.get(x.e) ?? x.i) - (order.get(y.e) ?? y.i) : x.i - y.i))
    .map((x) => x.e);
  const fits = ranked(rc.in).slice(0, FITS);
  const pool = shuffled(rc.in.filter((e) => !fits.includes(e) && fresh(e)), seed);
  let fill = [...pool.filter(unnamed), ...pool.filter((e) => !unnamed(e))];
  if (spread) {
    const byGroup = new Map();
    for (const e of fill) { const g = e.group ?? ""; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(e); }
    const taken = new Set(fits.map((e) => e.group ?? ""));
    const groups = [...byGroup.keys()].sort((a, b) => taken.has(a) - taken.has(b));
    fill = [];
    for (let i = 0; groups.some((g) => byGroup.get(g).length > i); i++) {
      for (const g of groups) if (byGroup.get(g)[i]) fill.push(byGroup.get(g)[i]);
    }
  }
  for (const e of fill) {
    if (fits.length >= FITS) break;
    fits.push(e);
  }
  const not = ranked(rc.not).slice(0, NOTS);
  const rest = shuffled(rc.not.filter((e) => !not.includes(e)), `${seed}:not`);
  for (const e of [...rest.filter((e) => e.owner), ...rest.filter((e) => !e.owner)]) {
    if (not.length >= NOTS) break;
    not.push(e);
  }
  const line = (e) => {
    const meta = [e.years, e.place].filter(Boolean).join(", ");
    const kind = e.branch || e.group;
    return `${e.name}${meta ? ` (${meta})` : ""}: ${e.reason ?? ""}${kind ? ` [${kind}]` : ""}`;
  };
  return {
    fits: fits.map(line),
    not: not.map((e) => `Not ${e.name}: ${e.reason || e.why}`),
    note: `From ${rc.genre ? `the house's ${rc.genre} roll call` : "this DJ's roll call"} (${rc.in.length} ` +
      `${rc.gathered ? `lines, gathered from MusicBrainz ${rc.made}, not read one by one` : `acts, reviewed by the household ${rc.made}`}): acts that fit ` +
      "this ask. A guide, not a whitelist and not a must-play list; anything inside the brief's field may play. " +
      "Stay out of the acts under not." +
      // Dr. Funkenstein's lines (2026-10-13) end on the act's hits, which his
      // never-the-hits rule keeps out: "· not: 'Cissy Strut', …".
      (rc.in.some((e) => / · not: /.test(e.reason ?? "")) ? " A line's \"not:\" names that act's hits: leave those songs out." : ""),
  };
}
