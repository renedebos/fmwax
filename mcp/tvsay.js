// SAY IT ON THE TV (MC-46, the owner, 2026-11-15: "can we ... use the sony
// tv remote to get the mic to bring text to the app?"). Measured on the
// Bravia the same night: the remote's own microphone button belongs to the
// TV's Google search and never reaches a browser; a web page in TV Bro gets
// a silent microphone. But TV Bro's OWN voice search listens (Android's
// speech recognition) and turns the words into text, which it sends to its
// search engine; its search engine can be a custom address ("[query]" stands
// for the words, TV Bro's source: UrlInputResolver.kt); and its voice search
// can be put on a remote key in its settings. So the house is that address:
// `/buttons/<key>/tv/say?q=[query]`.
//
// THE WORDS ARE READ AS MAPLE CRATE'S ARE. The Echos send a sentence Amazon
// has already matched to an intent; TV Bro sends plain words. So the words
// are matched here against the skill's own model (alexa-model.js), the same
// sample sentences with their slots, the longest fixed wording winning, and
// handed to the Echo door's reader and its acts (alexa.js alexaHeard,
// alexa-act.js alexaAct) as the intent Amazon would have sent. Nothing here
// decides what a request does: that is the door's, already tried by voice.
import { alexaModel, alexaRoomId, spoken } from "./alexa-model.js";
import { ROSTER } from "./djs.js";

// Words the Echos never need (Alexa keeps "pause" and "stop" for itself, so
// the skill has no sample for them) but a TV's voice search hears.
const TV_SAMPLES = {
  QuietIntent: ["pause", "pause the music", "pause it", "stop", "stop the music", "pause on the {room}", "pause the {room}",
    "stop the music on the {room}"],
  AgainIntent: ["play", "play the music", "unpause", "play on the {room}"],
  SkipIntent: ["skip it", "next one"],
};
const NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const numberOf = (v) => {
  const s = String(v ?? "").trim();
  const n = /^\d+$/.test(s) ? Number(s) : NUMBERS.indexOf(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const WHEN = { now: ["now", "right now", "straight away", "at once"], next: ["after this song", "after this one", "after the song", "after this track", "next"] };
const whenOf = (v) => Object.keys(WHEN).find((k) => WHEN[k].includes(String(v ?? "").trim())) ?? null;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A sample sentence as a pattern: its slots, and how much of it is fixed
// wording (the more, the surer the match).
function compile(sample) {
  const slots = [];
  let fixed = 0;
  const src = sample.split(/(\{[a-z]+\})/).filter(Boolean).map((p) => {
    const m = p.match(/^\{([a-z]+)\}$/);
    if (m) { slots.push(m[1]); return "(.+?)"; }
    fixed += p.replace(/\s+/g, "").length;
    return reEsc(p);
  }).join("");
  return { re: new RegExp(`^${src}$`), slots, fixed };
}

// The model's patterns for a house's rooms, built once per list of rooms.
const KEPT = new Map();
function patterns(rooms) {
  const key = JSON.stringify(rooms);
  if (KEPT.has(key)) return KEPT.get(key);
  const intents = alexaModel({ roster: ROSTER, rooms }).interactionModel.languageModel.intents;
  const out = [];
  for (const it of intents) {
    for (const s of [...(it.samples ?? []), ...(TV_SAMPLES[it.name] ?? [])]) out.push({ intent: it.name, ...compile(s) });
  }
  if (KEPT.size > 8) KEPT.clear();
  KEPT.set(key, out);
  return out;
}

// What was said, near enough as Alexa would write it: lower case, "Dr." as
// "doctor", no punctuation, no wake words, no "please", the skill's name
// dropped ("ask maple crate for"). Numbers stay figures ("preset 12", "1979"):
// a speaker's name is compared said both ways ("daughter 2", "daughter two").
export function tvWords(text) {
  let s = String(text ?? "").slice(0, 300).toLowerCase().replace(/\bdr\b\.?/g, "doctor ").replace(/&/g, " and ")
    .replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:hey google|ok google|okay google|alexa)\s+/, "")
    .replace(/^(?:ask|tell) maple crate(?: (?:for|to))?\s*/, "")
    .replace(/^maple crate\s+/, "")
    .replace(/^please\s+/, "").replace(/\s+please$/, "").trim();
  return s;
}

// The intent Amazon would have sent for these words, as an Alexa request's
// body, or null when no sample of the skill fits them.
export function tvIntent(text, rooms = []) {
  const said = tvWords(text);
  if (!said) return null;
  const roomBy = new Map();
  for (const r of rooms) { const v = spoken(r); roomBy.set(v, r); if (v.startsWith("the ")) roomBy.set(v.slice(4), r); }
  let best = null;
  for (const p of patterns(rooms)) {
    const m = said.match(p.re);
    if (!m) continue;
    const slots = {};
    let ok = true;
    p.slots.forEach((name, i) => {
      const v = m[i + 1].trim();
      if (!v) { ok = false; return; }
      if (name === "room") {
        const r = roomBy.get(spoken(v)) ?? roomBy.get(spoken(v).replace(/^the /, ""));
        if (!r) { ok = false; return; }
        const id = alexaRoomId(r);
        slots.room = { name: "room", value: v, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" },
          values: [{ value: { id, name: spoken(r) } }] }] } };
      } else if (name === "number") {
        const n = numberOf(v);
        if (n == null) { ok = false; return; }
        slots.number = { name: "number", value: String(n) };
      } else if (name === "when") {
        const w = whenOf(v);
        if (!w) { ok = false; return; }
        slots.when = { name: "when", value: v, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" },
          values: [{ value: { id: w, name: v } }] }] } };
      } else {
        slots[name] = { name, value: v };
      }
    });
    if (!ok) continue;
    // The most fixed wording wins; on a tie, the one with fewer slots.
    if (!best || p.fixed > best.fixed || (p.fixed === best.fixed && p.slots.length < best.slots.length)) {
      best = { intent: p.intent, fixed: p.fixed, slots: p.slots, filled: slots };
    }
  }
  if (!best) return null;
  return { said, body: { version: "1.0", session: null,
    request: { type: "IntentRequest", intent: { name: best.intent, slots: best.filled } } } };
}

// What the TV says when no sample fits.
export const TV_NOT_CAUGHT = "That isn't something the house knows how to do. Try a DJ and what you'd like " +
  "(“Sessions, acoustic piano”), a DJ alone (“Hank”), “preset 7”, “pause”, “skip”, " +
  "“more like this” or “what's playing”.";
// The Echo door's lines that name the skill, said for the TV.
export const tvLine = (say) => String(say ?? "").replace(/ask maple crate for /gi, "say ").replace(/maple crate/gi, "the house");
