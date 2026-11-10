// HOUSE RADIO READS THE WORDS (MC-38 stage 2, tasks/mc38-alexa-skill.md).
// Alexa hands the house the DJ as the intent's name and the rest of the
// sentence as free words ("acoustic grunge on the ultra", "2 hours", "no
// eagles"). This picks out of those words the three things an ask carries
// besides its taste: the speaker, the length and what to leave out. What is
// left is the words, as said. Pure: no env, no calls.
//
// The rules (the plan, reviewed by Codex 2026-11-07):
// - SPEAKER: "on/in (the) <speaker>", the speaker as Alexa writes one of the
//   house's names (spoken(): "daughter two" is Daughter2), or "everywhere"
//   bare; anywhere in the words, the last if two; taken out. Bare, any
//   speaker as the whole of the words, or one of two words or more at their
//   end (2026-11-08). The house's own spelling comes back. None said: the
//   default speaker.
// - LENGTH: a number and a unit, digits or words ("2 hours", "ninety
//   minutes", "half an hour", "an hour and a half"), taken out and snapped to
//   the form's 30/60/90/120 (askMinutes). No unit, no length: "19s 90s
//   shoegaze" stays words. None said: 60.
// - LEAVE OUT: from a whole word "no", "without" or "not" to the end of
//   what is left: "no eagles" is avoid "eagles", which the curator checks
//   record by record.
// - HOW (the owner, 2026-11-07, the DJ page's buttons by voice): "endless"
//   or "all night" makes it the DJ endless with these words, not a one-off
//   set; "fresh" (a fresh start, start fresh) a fresh start of the DJ's
//   preset; "and keep it" keeps the asked-for set on the Shelf; "now" or
//   "after this song", said last, is when a DJ takes a busy guest preset
//   over. Each is taken out of the words.

import { spoken } from "./alexa-model.js";
import { askMinutes } from "./asks.js";

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9.' ]+/g, " ").replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The numbers Alexa may write as words; it mostly writes digits ("2 hours").
const NUMBERS = {
  "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "ten": 10, "fifteen": 15,
  "twenty": 20, "thirty": 30, "forty": 40, "forty five": 45, "fifty": 50, "sixty": 60, "seventy": 70,
  "seventy five": 75, "eighty": 80, "ninety": 90, "a hundred": 100, "one hundred": 100,
  "a hundred and twenty": 120, "one hundred and twenty": 120, "one hundred twenty": 120, "a hundred twenty": 120,
};
// Longest first, so "forty five" is read before "forty".
const NUMBER_WORDS = Object.keys(NUMBERS).sort((a, b) => b.length - a.length).map(esc).join("|");
const NUM = `(\\d+(?:\\.\\d+)?|${NUMBER_WORDS})`;
const numberOf = (s) => (/^\d/.test(s) ? Number(s) : NUMBERS[s]);
const LEAD = "(?:(?:for|about|around|of|roughly) )?";

// [pattern, minutes from the match], tried in order; the first that matches
// is the length.
const LENGTHS = [
  [new RegExp(`${LEAD}(?:(?:an?|one) )?hour and a half`), () => 90],
  [new RegExp(`${LEAD}(?:one and a half|1\\.5|one point five) hours?`), () => 90],
  [new RegExp(`${LEAD}(?:half an hour|a half hour|half hour)`), () => 30],
  [new RegExp(`${LEAD}${NUM} (?:hours?|hrs?)\\b`), (m) => numberOf(m[1]) * 60],
  [new RegExp(`${LEAD}${NUM} (?:minutes?|mins?)\\b`), (m) => numberOf(m[1])],
];

// Every way a speaker of the list is said, with its own spelling.
function speakerForms(rooms) {
  const out = [];
  for (const r of rooms ?? []) {
    const s = spoken(r);
    if (!s) continue;
    out.push({ said: s, room: r });
    if (s.startsWith("the ")) out.push({ said: s.slice(4), room: r });
  }
  return out;
}

// The span of the last speaker named in `text`, or null. A speaker comes
// after "on" or "in"; bare ("everywhere" anywhere), it counts as the whole
// of the words, or at their end when its name is two words or more (the
// owner, 2026-11-08: "Sessions … living room" came as the words "living
// room" and was asked as taste). A one-word name at the end stays taste:
// "songs for my son" is no speaker.
function lastSpeaker(text, rooms, { bareOnly = false } = {}) {
  let best = null;
  const take = (re, room) => {
    for (const m of text.matchAll(re)) {
      const at = m.index, end = m.index + m[0].length;
      // The last named wins; of two spans ending together, the longer, so
      // "on the pro plus" is taken whole, never "the pro plus" alone.
      if (!best || end > best.end || (end === best.end && at < best.at)) best = { at, end, room };
    }
  };
  for (const { said, room } of speakerForms(rooms)) {
    const bare = said === "everywhere" ? "?" : "";
    if (!bareOnly) take(new RegExp(`(?:^| )(?:(?:on|in) (?:the )?)${bare}${esc(said)}(?= |$)`, "g"), room);
    take(new RegExp(`^(?:the )?${esc(said)}$`, "g"), room);
    if (said.includes(" ")) take(new RegExp(`(?:^| )(?:the )?${esc(said)}$`, "g"), room);
  }
  return best;
}

const cut = (text, at, end) => `${text.slice(0, at)} ${text.slice(end)}`.replace(/\s+/g, " ").trim();
// Words that only joined what was taken out.
const tidy = (s) => s.replace(/^(?:(?:and|but|with|for|on|about|of) )+/, "").replace(/(?: (?:and|but|with|for))+$/, "").trim();

// The markers of how. "Endless" is said last ("Gatefold, 1971, endless");
// "keep it" is said last too ("acoustic grunge, and keep it"), so "keep it
// mellow" stays taste; a fresh start is the whole of the words ("Hank,
// fresh", "a fresh start"), so "a fresh set of honky-tonk" and "fresh
// produce" stay taste (Codex's review, 2026-11-08). "Now" or "after this
// song" is said last, and counts only when nothing else was asked, or after
// "endless": "songs from right now" stays taste too.
const ENDLESS_END = /(?:^| )(?:endless(?:ly)?|all night(?: long)?|non ?stop|all evening)$/;
const KEEP = /(?:^| )(?:and )?(?:keep it|keep this one|keep the set|keep this set|put it on the shelf)$/;
const FRESH = /^(?:(?:a )?fresh start|start(?:ed)? fresh|(?:a )?fresh set|fresh)$/;
const WHEN = [["now", /(?:^| )(?:right )?now$/], ["next", /(?:^| )after (?:this|the) (?:song|one|track)$/]];
function marks(text) {
  let rest = text;
  const how = {};
  const take = (re) => { const m = rest.match(re); if (!m) return false; rest = cut(rest, m.index, m.index + m[0].length); return true; };
  if (take(KEEP)) how.keep = true;
  if (take(ENDLESS_END)) how.endless = true;
  if (!how.keep && take(KEEP)) how.keep = true;
  if (take(FRESH)) how.fresh = true;
  return { rest, how };
}

// { words, minutes, lengthSaid, avoid, device, deviceFrom, said, endless?,
// fresh?, keep?, when? }. `rooms` is the house's speaker list
// (parseRoomDevices), `fallback` its default.
export function readWords(words, { rooms = [], fallback = null } = {}) {
  const said = squash(words);
  let text = said;
  let device = null;
  const where = lastSpeaker(text, rooms);
  if (where) { device = where.room; text = cut(text, where.at, where.end); }
  let minutes = 60, lengthSaid = false;
  for (const [re, toMinutes] of LENGTHS) {
    const m = text.match(re);
    if (!m) continue;
    const n = toMinutes(m);
    if (Number.isFinite(n) && n > 0) {
      minutes = askMinutes(n);
      lengthSaid = true;
      text = cut(text, m.index, m.index + m[0].length);
    }
    break;
  }
  let when = null;
  let bare = text;
  for (const [name, re] of WHEN) {
    const m = text.match(re);
    if (m) { when = name; bare = cut(text, m.index, m.index + m[0].length); break; }
  }
  let { rest, how } = marks(bare);
  if (when && !(how.endless || !tidy(rest))) { when = null; ({ rest, how } = marks(text)); }
  if (when) how.when = when;
  text = rest;
  // A bare room said before "endless", a length or "now" comes clear only
  // once they are out ("acoustic piano, living room, endless": Codex's
  // review, 2026-11-08).
  if (!device) {
    const late = lastSpeaker(text, rooms, { bareOnly: true });
    if (late) { device = late.room; text = cut(text, late.at, late.end); }
  }
  let avoid = null;
  const out = text.match(/(?:^| )(?:no|without|not) (.+)$/);
  if (out) {
    avoid = tidy(out[1]) || null;
    if (avoid) text = text.slice(0, out.index).trim();
  }
  return { words: tidy(text), minutes, lengthSaid, avoid, device: device ?? fallback,
    deviceFrom: device ? "words" : "default", said, ...how };
}

// The words an endless DJ is given: the taste, and what to leave out.
export const endlessWords = (r) => [r?.words, r?.avoid ? `no ${r.avoid}` : ""].filter(Boolean).join(", ");
