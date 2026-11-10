// HOUSE RADIO'S WORDS (MC-38, tasks/mc38-alexa-skill.md): the skill's
// interaction model, made from the roster and the speaker list so it never
// drifts from the house. `npm run alexa` writes it to
// install/alexa-house-radio.json, which the owner pastes into Amazon's
// developer console (Build → Interaction Model → JSON Editor) once, and again
// whenever a DJ or a speaker changes. The door (alexa.js) reads the intents
// back by the same names, from the same functions.
//
// Amazon's limits shape it: one free-text slot (AMAZON.SearchQuery) an
// intent, never beside another slot in the same sample, and always after a
// fixed word. So a set asked of a DJ is ONE INTENT PER DJ, with the DJ's name
// written into the samples as that fixed word ("pub rock {words}"): written
// words steer Alexa's hearing toward them, which a free-text slot does not
// (stage 0, 2026-11-07: plain Alexa heard "Pub Rock" as "pop rock"). Putting
// a DJ on is one intent per DJ too, the name written in and the speaker a
// listed slot: stage 1 (2026-11-07) heard "pub rock" right in every ask and
// "pop rock" again in "put on {dj}", where the name was only a slot value.
//
// "Alexa, ask house radio for Sessions, acoustic grunge" reaches the skill as
// "sessions acoustic grunge": Amazon drops the connecting word (for, to,
// about, if, whether) before matching, so samples start after it.

// The skill's name, as said after "Alexa, ask" (the owner, 2026-11-08: "house
// radio" until then, when Alexa began taking "open house radio" for its own
// radio, "House radio's ready to go. What station or style…", and never
// sent it on; "wax room" for the rest of that morning, until Alexa+ took
// "room" for one of the house's rooms: an announcement, Drop In, and "open"
// as an app it couldn't launch; "wax works" for half an hour, until Alexa+
// answered with video, the films Waxworks and Waxwork). No music word, no
// room, no device, no brand, no title: two plain words that mean nothing
// together, checked on the web first (the owner, 2026-11-08 ~11:55: "maple
// crate" passed in the simulator and four times on the bedroom Echo). One
// line: Alexa's spoken lines read it from here, so a new name is this line,
// `npm run alexa`, a deploy and the model re-pasted.
export const ALEXA_INVOCATION = "maple crate";
// As said at the start of a sentence: "Wax room."
export const ALEXA_NAME = ALEXA_INVOCATION.charAt(0).toUpperCase() + ALEXA_INVOCATION.slice(1);

// The words Alexa writes for a name: lower case, letters, apostrophes and
// single spaces, "Dr." said as "doctor", digits said as words. Amazon's
// samples and slot values take nothing else.
const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export function spoken(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\bdr\b\.?/g, "doctor ")
    .replace(/&/g, " and ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\d/g, (d) => ` ${DIGITS[Number(d)]} `)
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

// An intent's name may hold letters and underscores only: "AskPubRock" to
// ask Pub Rock for a set, "PlayPubRock" to put Pub Rock on.
const camelOf = (key) => String(key).split(/[^a-zA-Z]+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
export const djIntentName = (key) => `Ask${camelOf(key)}`;
export const djPlayIntentName = (key) => `Play${camelOf(key)}`;
export const djFreshIntentName = (key) => `Fresh${camelOf(key)}`;

// The ways a DJ's name is said: the name, without a leading "the", and the
// aliases that are words holding the name's last word ("doctor funkenstein",
// "southern soul"), the name split in two ("gate fold": stage 1 lost
// "Gatefold, a classic album side") or with an s more or less ("session"),
// never the nicknames that are moods too ("morning" for Vibe, "albums" for
// Gatefold): those would catch an ask that names no DJ.
export function spokenForms(persona) {
  const base = spoken(persona.name);
  const bare = base.replace(/^the /, "");
  const last = bare.split(" ").pop();
  const squash = (s) => s.replace(/ /g, "");
  const count = (s) => s.split(" ").length;
  const forms = [base, bare];
  for (const a of persona.aliases ?? []) {
    const s = spoken(a).replace(/^dj /, "");
    if (!s) continue;
    const holds = s.split(" ").includes(last);
    const split = squash(s) === squash(bare) && count(s) > count(bare);
    const plural = s === `${bare}s` || `${s}s` === bare;
    if (holds || split || plural) forms.push(s);
  }
  return [...new Set(forms.filter(Boolean))];
}

// "DJ" as Alexa writes letters said one by one ("d. j.", Amazon's form for
// an initialism), and as the word.
const DJ_SAID = ["d. j.", "deejay"];

// A set asked of one DJ: the name and what was asked, said a few ways, or
// the name alone, which puts the DJ on (the owner, 2026-11-07).
function djSamples(persona) {
  const forms = spokenForms(persona);
  const bare = spoken(persona.name).replace(/^the /, "");
  const out = [];
  for (const f of forms) {
    out.push(f, `${f} {words}`, `${f} doing {words}`, `${f} playing {words}`, `${f} for {words}`, `${f} with {words}`);
  }
  for (const dj of DJ_SAID) out.push(`${dj} ${bare}`, `${dj} ${bare} {words}`);
  out.push(`ask ${bare} for {words}`);
  return out;
}

// A set asked with no DJ named ("something mellow for dinner").
const ASK_SAMPLES = ["something {words}", "some {words}", "a set of {words}", "a set for {words}",
  "music for {words}", "a mix of {words}", "i want {words}", "i'd like {words}", "make me {words}",
  "make a set of {words}"];

// A DJ on now, nothing new written ("put on Hank on the Ultra"), the DJ's
// name written in. The speaker may come bare ("play Soul everywhere":
// "everywhere" is one of the speakers).
const PUT_ON_VERBS = ["put on", "play", "start"];
const AT_ROOM = ["on the {room}", "in the {room}", "on {room}", "in {room}", "{room}"];
// "Now" or "after this song" said with it takes a busy guest preset over
// (the owner, 2026-11-07): a listed slot, said last or before the speaker.
function putOnSamples(persona) {
  const bare = spoken(persona.name).replace(/^the /, "");
  const out = [];
  for (const f of [...spokenForms(persona), `d. j. ${bare}`]) {
    for (const v of PUT_ON_VERBS) {
      out.push(`${v} ${f}`);
      for (const at of AT_ROOM) out.push(`${v} ${f} ${at}`);
      out.push(`${v} ${f} {when}`, `${v} ${f} {when} on the {room}`, `${v} ${f} on the {room} {when}`);
    }
    out.push(`put ${f} on`, `put ${f} on the {room}`, `put ${f} in the {room}`);
  }
  return out;
}
const WHEN_VALUES = [
  { id: "now", name: { value: "now", synonyms: ["right now", "straight away", "at once"] } },
  { id: "next", name: { value: "after this song", synonyms: ["after this one", "after the song", "after this track", "next"] } },
];

// A FRESH START of the DJ's preset (the DJ page's Start fresh): a new
// opening set, the DJ's name written in as everywhere.
function freshSamples(persona) {
  const out = [];
  for (const f of spokenForms(persona)) {
    for (const v of [`start ${f} fresh`, `start fresh with ${f}`, `a fresh start from ${f}`, `a fresh start with ${f}`,
      `a fresh set from ${f}`, `fresh start ${f}`]) {
      out.push(v, `${v} on the {room}`, `${v} in the {room}`);
    }
  }
  return out;
}

// A preset by its number ("play preset 7"), as the remote has them, on the
// speaker said (the owner, 2026-11-07). Amazon's own number slot hears "one"
// and "7" alike.
const PRESET_SAYS = ["play preset {number}", "put on preset {number}", "start preset {number}", "press preset {number}",
  "preset {number}", "press {number}", "play button {number}", "press button {number}", "button {number}",
  "play number {number}"];
function presetSamples() {
  const out = [];
  for (const v of PRESET_SAYS) {
    out.push(v);
    for (const at of AT_ROOM) out.push(`${v} ${at}`);
  }
  return out;
}

// What's playing, handled (the owner, 2026-11-07: "yes" to pause, play
// again, skip and move). "Pause" itself never reaches a skill (stage 1), nor
// may some of these: the log shows which words do, and those stay. Each
// with a speaker or without.
function withRoom(says, rooms = ["on the {room}", "in the {room}"]) {
  const out = [];
  for (const v of says) {
    out.push(v);
    for (const at of rooms) out.push(`${v} ${at}`);
  }
  return out;
}
const QUIET_SAMPLES = [...withRoom(["hush", "quiet", "quiet please", "be quiet", "silence", "shush", "hold the music",
  "hold it", "that's enough", "enough for now", "turn the music off", "turn off the music"]),
"hush the {room}", "quiet the {room}", "silence the {room}"];
const AGAIN_SAMPLES = withRoom(["carry on", "play again", "keep playing", "resume", "unpause", "continue",
  "music back on", "put the music back on", "play the music again"]);
const SKIP_SAMPLES = withRoom(["skip", "skip this song", "skip this one", "skip the song", "skip this track", "next song",
  "next track", "next", "another song", "play the next song"]);
const MOVE_SAMPLES = ["move the music", "move it", "move the music to the {room}", "move it to the {room}",
  "move to the {room}", "move the music to {room}", "move it to {room}", "move the music {room}", "move it {room}",
  "send the music to the {room}", "send it to the {room}", "play it on the {room} instead", "play it in the {room} instead"];

// STEERING the DJ who is playing (the owner, 2026-11-07), as the bar's two
// buttons and Talk's directions do. A free direction needs words before it
// (Amazon's carrier phrase), and the door puts "more" or "less" back.
// "More like this" and "change it up" in one breath are Alexa's own; said
// with "steer" they reach the skill (the owner, 2026-11-08 11:13: "ask wax
// room to steer toward Stax" did), so each has a "steer" form too.
const MORE_LIKE_SAMPLES = ["more like this", "more like this one", "more like this song", "more of this", "more songs like this",
  "steer the same way", "steer it the same way", "keep steering this way", "steer more like this"];
const CHANGE_UP_SAMPLES = ["change it up", "mix it up", "switch it up", "shake it up", "something different", "play something different",
  "steer somewhere else", "steer it somewhere else", "steer somewhere different", "steer it somewhere new"];
const STEER_MORE_SAMPLES = ["more {words}", "a bit more {words}", "play more {words}", "some more {words}"];
const STEER_LESS_SAMPLES = ["less {words}", "fewer {words}", "a bit less {words}", "play less {words}", "play fewer {words}", "not so much {words}"];
const STEER_TO_SAMPLES = ["make it {words}", "make the music {words}", "steer it {words}", "steer it toward {words}", "steer {words}",
  "take it {words}"];
// The song before (the bar's ◀): "previous" may be Alexa's own word.
const BACK_SAMPLES = ["go back a song", "go back", "back a song", "one song back", "previous song", "the previous song",
  "play the previous song", "last song", "play the last song again", "replay the last song"];
// Keep the requested set that is playing on the Shelf.
const KEEP_SAMPLES = ["keep this set", "keep this", "keep it", "keep the set", "keep this one", "save this set",
  "put this set on the shelf", "put it on the shelf"];

const NOW_SAMPLES = ["what's playing", "what is playing", "what's on", "what is on", "what is this",
  "what song is this", "who is this", "who is playing", "what's playing on the {room}", "what is playing on the {room}",
  "what's playing in the {room}", "what is playing in the {room}"];
// No pause: Alexa keeps "pause" and "stop" for itself and never sends them
// to the skill (stage 1, 2026-11-07). The app's bar pauses.

// A speaker's id in the skill: the house's own spelling with its spaces made
// underscores, since Amazon refuses a slot id with a space (the owner's
// console, 2026-11-07: "Pro Plus" refused, "Pro_Plus" taken).
export function alexaRoomId(room) {
  return String(room ?? "").trim().replace(/\s+/g, "_");
}
// And back: the speaker of the house's list an id names, or null. Matched
// against the list as made, so a speaker whose name holds an underscore of
// its own still comes back as itself; an id made before a speaker was
// renamed finds nobody.
export function roomOfId(id, rooms) {
  if (!id) return null;
  return (rooms ?? []).find((r) => alexaRoomId(r) === id) ?? null;
}

// The speakers as Alexa says them ("Office2" is said "office two"), each
// one's id the house's own spelling as alexaRoomId writes it.
function roomValues(rooms) {
  const seen = new Set();
  const out = [];
  for (const r of rooms ?? []) {
    const value = spoken(r);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const synonyms = value.startsWith("the ") ? [value.slice(4)] : [];
    out.push({ id: alexaRoomId(r), name: { value, ...(synonyms.length ? { synonyms } : {}) } });
  }
  return out;
}

// The whole model, as the console's JSON Editor takes it.
export function alexaModel({ roster, rooms, invocation = ALEXA_INVOCATION }) {
  const djs = Object.entries(roster);
  const intents = [
    { name: "AMAZON.CancelIntent", samples: [] },
    { name: "AMAZON.HelpIntent", samples: [] },
    { name: "AMAZON.StopIntent", samples: [] },
    { name: "AMAZON.NavigateHomeIntent", samples: [] },
    { name: "AMAZON.FallbackIntent", samples: [] },
    ...djs.map(([key, p]) => ({ name: djIntentName(key),
      slots: [{ name: "words", type: "AMAZON.SearchQuery" }], samples: djSamples(p) })),
    { name: "AskIntent", slots: [{ name: "words", type: "AMAZON.SearchQuery" }], samples: ASK_SAMPLES },
    ...djs.map(([key, p]) => ({ name: djPlayIntentName(key),
      slots: [{ name: "room", type: "HOUSE_ROOM" }, { name: "when", type: "HOUSE_WHEN" }], samples: putOnSamples(p) })),
    ...djs.map(([key, p]) => ({ name: djFreshIntentName(key),
      slots: [{ name: "room", type: "HOUSE_ROOM" }], samples: freshSamples(p) })),
    { name: "PresetIntent", slots: [{ name: "number", type: "AMAZON.NUMBER" }, { name: "room", type: "HOUSE_ROOM" }],
      samples: presetSamples() },
    { name: "NowIntent", slots: [{ name: "room", type: "HOUSE_ROOM" }], samples: NOW_SAMPLES },
    { name: "QuietIntent", slots: [{ name: "room", type: "HOUSE_ROOM" }], samples: QUIET_SAMPLES },
    { name: "AgainIntent", slots: [{ name: "room", type: "HOUSE_ROOM" }], samples: AGAIN_SAMPLES },
    { name: "SkipIntent", slots: [{ name: "room", type: "HOUSE_ROOM" }], samples: SKIP_SAMPLES },
    { name: "MoveIntent", slots: [{ name: "room", type: "HOUSE_ROOM" }], samples: MOVE_SAMPLES },
    { name: "MoreLikeIntent", samples: MORE_LIKE_SAMPLES },
    { name: "ChangeUpIntent", samples: CHANGE_UP_SAMPLES },
    { name: "SteerMoreIntent", slots: [{ name: "words", type: "AMAZON.SearchQuery" }], samples: STEER_MORE_SAMPLES },
    { name: "SteerLessIntent", slots: [{ name: "words", type: "AMAZON.SearchQuery" }], samples: STEER_LESS_SAMPLES },
    { name: "SteerToIntent", slots: [{ name: "words", type: "AMAZON.SearchQuery" }], samples: STEER_TO_SAMPLES },
    { name: "BackIntent", samples: BACK_SAMPLES },
    { name: "KeepIntent", samples: KEEP_SAMPLES },
  ];
  const types = [{ name: "HOUSE_ROOM", values: roomValues(rooms) }, { name: "HOUSE_WHEN", values: WHEN_VALUES }];
  return { interactionModel: { languageModel: { invocationName: invocation, intents, types } } };
}

// Which DJ a per-DJ intent asks, by name: { [intentName]: key }.
export function djIntents(roster) {
  return Object.fromEntries(Object.keys(roster).map((key) => [djIntentName(key), key]));
}
// And which DJ one puts on: { [intentName]: key }.
export function djPlayIntents(roster) {
  return Object.fromEntries(Object.keys(roster).map((key) => [djPlayIntentName(key), key]));
}
// And which DJ one starts fresh.
export function djFreshIntents(roster) {
  return Object.fromEntries(Object.keys(roster).map((key) => [djFreshIntentName(key), key]));
}
