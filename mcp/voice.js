// THE ROOM'S VOICE (MC-15, 2026-09-11/12). The pure half of the Talk page:
// the rules every Talk endpoint checks before it does anything, the two
// prompts, and the numbers the owner decided. Nothing in here fetches, reads
// KV or touches the ledger — that is worker.js's and station.js's — so every
// rule is a function of its inputs and every one has a test.
//
// The shape was reworked after Codex's review of the plan (MC15PLAN-4K9)
// and again after its review of this file (MC15S-7R2): a hostile PAGE
// holding the household key cannot call a tool or spend a minute, because
// every bridge call carries a per-session capability the Worker minted and
// the browser's origin rules stop a page from minting one — a non-browser
// holder of the key can, and that is the key's authority everywhere on
// this site (the forms play and rewrite too); the day's cap is what bounds
// the wallet. A tool argument is forgeable, so nothing is guarded by one.
// A start must NAME its speaker, because the plain playback command
// otherwise lands on whatever is active. Every speaker is equal by voice —
// the owner, 2026-09-11: "I don't need special treatment like a tap for the
// Ultra. I am moving devices around."
//
// THE ORDER the bridge applies these, and the only order that can work,
// since the speaker rule reads parsed arguments and the allowlist is checked
// inside the parse: origin → media type → capability shape → capability
// live (the ledger) → allowlist and bounded parse → speaker → callTool.

import { ARCHIVE } from "./archive-identity.js";

// ------------------------------------------------------------ the numbers

// Sixty minutes of conversation a day (the owner, 2026-09-11), BY THE
// SERVER'S CLOCK (MC-16, 2026-09-12: "per minute, not per conversation").
// A line is charged from the moment it opens to the moment the ledger
// considers it over; the page never supplies a number, only "still here"
// every BEAT_MS and "done" — on which the ledger hangs up at OpenAI itself.
// A line that stops beating is hung up at the end of its grace (station.js,
// BEAT_GRACE_MS), and the alarm hangs up everything the moment the day's
// minutes run out. So the cap is a real bound on the wallet, not a request
// to the page. Before MC-16 a conversation cost ten minutes flat (six a day).
export const CAP_MINUTES = 60;
export const BEAT_MS = 30_000;
// THE QUIET CLOSE (MC-17, the owner: "hang up sooner after the desk has
// finished"). Thirty seconds, counted from the END of the desk's answer and
// only while nothing is in flight — a search, a write, a program being
// composed suspends the clock, so a forty-second write is never cut off.
// It was ninety seconds counted from any event (2026-09-12 morning), three
// minutes before that. A quiet open line is on OpenAI's clock.
export const IDLE_CLOSE_MS = 30_000;
// What OpenAI charges for the line, for the meter on the page: five cents a
// minute, by the second, fifteen seconds at least (the docs, 2026-09-12).
// The backend's text is a few cents a set on top and is not metered here.
export const VOICE_CENTS_PER_MINUTE = 5;

export const VOICE_MODEL = "gpt-live-1";
// Stage 0, 2026-09-12: both backend models played Sunny's hour to her brief;
// terra did it in one tool round trip, luna took two. In a voice turn the
// round trip is the cost that shows, so terra is the default and luna is one
// config line away.
export const DEFAULT_BACKEND_MODEL = "gpt-5.6-terra";
export const backendModel = (env) =>
  String(env?.VOICE_BACKEND_MODEL || DEFAULT_BACKEND_MODEL).slice(0, 60);

// ------------------------------------------------------------ the house's day

// The cap is per DAY, and the day is the house's, not UTC's: a session at
// half past midnight in Amsterdam belongs to the new day there. HOUSE_TZ when
// a house sets one; otherwise the one thing the config already says about
// where the house is, the Tidal country.
const TZ_BY_COUNTRY = { NL: "Europe/Amsterdam", BE: "Europe/Brussels", DE: "Europe/Berlin",
  GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", US: "America/New_York" };
// An explicit HOUSE_TZ that is not a zone is an ERROR, not a fallback: a
// misspelt zone silently moving the day boundary to UTC would move the cap's
// accounting without anyone knowing (Codex, MC15S-7R2). Optional, env-only;
// the house's config has no line for it today.
export function houseTz(env) {
  const set = String(env?.HOUSE_TZ ?? "").trim();
  if (set) {
    try { new Intl.DateTimeFormat("en-CA", { timeZone: set }); }
    catch { throw new Error(`HOUSE_TZ is not a timezone: "${set.slice(0, 40)}"`); }
    return set;
  }
  return TZ_BY_COUNTRY[String(env?.TIDAL_COUNTRY ?? "").toUpperCase()] ?? "UTC";
}
export function houseDay(env, now = Date.now()) {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: houseTz(env), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
}

// ------------------------------------------------------------ the checks

// Every Talk POST is a page's own script talking to its own Worker, never a
// form and never a link. So the Origin header must be PRESENT and EXACTLY
// this site's — the wall's forms accept a missing or "null" origin on
// purpose, because forms are allowed to; a script call is not. Each check
// answers null (pass) or one sentence a caller can put in a 4xx.
export function originCheck(request, url) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return "This call must come from the Talk page itself.";
  if (origin !== url.origin) return `This call came from ${origin}, not from ${url.origin}.`;
  return null;
}

// The exact MEDIA TYPE — parameters are not read, so "application/json;
// charset=utf-8" is application/json and so is any junk after the
// semicolon — anything else refused. A browser cannot be talked into sending
// application/sdp or application/json by a cross-site form, which is the
// point; the parameters are not part of that argument.
export function contentTypeCheck(request, expected) {
  const raw = String(request.headers.get("content-type") ?? "");
  const type = raw.split(";")[0].trim().toLowerCase();
  if (type !== expected) return `This call must be ${expected}, not ${type || "nothing"}.`;
  return null;
}

// The per-session capability: 32 hex characters the Worker minted when it
// created the session, carried on every bridge call as X-Talk-Session. Its
// shape is checked here; whether it is LIVE is the ledger's answer.
export const CAP_RE = /^[0-9a-f]{32}$/;
export function capFrom(request) {
  const cap = String(request.headers.get("x-talk-session") ?? "").trim().toLowerCase();
  return CAP_RE.test(cap) ? cap : null;
}
export function mintCap() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// A function call from the voice model's backend: `name` must be on the
// voice's list, `arguments` is a JSON STRING in the Responses shape (an
// object is accepted too, for a client that already parsed it) and must
// parse to a plain object — never an array, never a string, never null.
// Throws a sentence; the bridge answers it as { error }.
export const ARGS_MAX_BYTES = 16 * 1024;
const POISON = new Set(["__proto__", "constructor", "prototype"]);
export function parseToolCall(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The call must be a JSON object with name and arguments.");
  }
  const name = String(body.name ?? "").slice(0, 60);
  if (!allowed.has(name)) {
    throw new Error(`"${name || "(nothing)"}" is not a tool the room's voice may call.`);
  }
  let args = body.arguments;
  if (typeof args === "string") {
    // A bound before the parse: a 16 KB argument list is already absurd for
    // any tool here (a hundred URIs is about four), and the parser should
    // never be handed more than that.
    if (args.length > ARGS_MAX_BYTES) throw new Error(`The arguments for ${name} are too large.`);
    try { args = args.trim() === "" ? {} : JSON.parse(args); }
    catch { throw new Error(`The arguments for ${name} are not valid JSON.`); }
  }
  if (args === undefined || args === null) args = {};
  // A PLAIN object — what JSON.parse makes — and nothing that reaches for a
  // prototype. An array, a string, a class instance, or a key that would
  // poison Object.prototype is refused before any tool sees it.
  const proto = typeof args === "object" ? Object.getPrototypeOf(args) : undefined;
  if (typeof args !== "object" || Array.isArray(args) ||
      (proto !== Object.prototype && proto !== null)) {
    throw new Error(`The arguments for ${name} must be a JSON object.`);
  }
  for (const k of Object.keys(args)) {
    if (POISON.has(k)) throw new Error(`The arguments for ${name} carry a key that is not allowed.`);
  }
  if (JSON.stringify(args).length > ARGS_MAX_BYTES) {
    throw new Error(`The arguments for ${name} are too large.`);
  }
  return { name, args };
}

// A START NAMES ITS SPEAKER. play_* hands the speaker a playlist or a list;
// playback_control's resume and volume act on a speaker too — and without a
// device the plain command lands on WHATEVER IS ACTIVE, which a model must
// not be allowed to mean. Pause, next and previous act on what is already
// playing, which is unambiguous, so they may omit the speaker — but a
// speaker they DO name is checked like any other (Codex, MC15S-7R2: the
// underlying tool matches a partial, so "pro" would otherwise reach a
// device outside the house's list through pause). The name must be one of
// the house's own, matched case-insensitively and whole. Every speaker on
// the list passes alike (the owner, 2026-09-11).
const STARTS = new Set(["play_playlist", "play_program", "play_uris"]);
const SPEAKER_TOOLS = new Set([...STARTS, "playback_control"]);
export function speakerRule(name, args, devices) {
  if (!SPEAKER_TOOLS.has(name)) return null;
  const needs = STARTS.has(name) ||
    ["resume", "volume"].includes(String(args?.action ?? ""));
  const raw = args?.device;
  const want = typeof raw === "string" ? raw.trim() : (raw == null ? "" : "\u0000");
  if (!want) return needs ? "Which speaker? Name one to play on." : null;
  const hit = devices.find((d) => d.toLowerCase() === want.toLowerCase());
  if (!hit) return `There is no speaker called "${String(raw).slice(0, 40)}". The house has: ${devices.join(", ")}.`;
  return null;
}
// The matched name, so the bridge hands the tool the house's own spelling.
export function canonicalDevice(args, devices) {
  const want = String(args?.device ?? "").trim().toLowerCase();
  return devices.find((d) => d.toLowerCase() === want) ?? null;
}

// ------------------------------------------------------------ the prompts

// In the sections OpenAI's prompting guide asks for. The VOICE prompt is what
// gpt-live-1 hears; the BACKEND prompt goes to the Responses model that
// holds the tools. The DJ briefs are NOT copied in — get_dj returns them,
// which is how Claude works today and how stage 0 measured both models.
// THE ARCHIVE, SAID (the owner, 2026-10-10, asking Talk for a night of the
// archive). Its names and examples are this house's (archive-identity.js).
// Only in a house with an archive preset; without one the prompt is
// exactly VOICE_PROMPT. Loading it starts nothing, so the one place the voice
// says "what is starting" is told so.
export const ARCHIVE_WHO = `${ARCHIVE.who}, live, ${ARCHIVE.years}`;
export function voicePrompt({ archive = null } = {}) {
  const a = archive?.btn ? archive : null;
  return `# Role and tone
You are the voice of a house music desk: calm, warm, brief, never fawning.
One or two short sentences at an unhurried pace. A friend behind a counter,
not an assistant reading a menu. People talk to you to put music on their
speakers, to ask a DJ for a set, to change what is playing, and to find
something new. A backend does the looking up, the playing and the writing;
you hold the conversation.

# Language
Reply in the language the person spoke. Do not switch for a single word.

# Backchannel policy
Use moderate backchannels: a short acknowledgement while you listen, never
competing with the person.

# Interruption policy
Stop speaking when the person interrupts and listen to what they say.
"Stop talking" is not "cancel": work already handed to the backend goes on
unless they say to cancel it.

# Delegation policy
You have no controls of your own and no catalogue of your own.

Backend tools: it can play a preset, a DJ's set or a named playlist on any
speaker in the house; pause, resume, skip and set the volume; say what is
playing; steer the DJ that is playing ("more upbeat"); read a DJ's
brief; search the catalogue; build or rewrite a set;
publish a DJ's program with notes; read and load the shelf${a ? `; and load
${ARCHIVE.tapes} (${ARCHIVE_WHO}) onto the archive preset, ${a.btn}` : ""}.

Delegate to the backend when: the person asks for anything to play, pause,
resume, skip, mute or turn up or down; asks what is playing; asks the
playing DJ for a different direction; asks for music
by artist, style, era or mood ("rare funk", "some James Brown", "something
for cooking"); asks a DJ for a set or a program; asks what is on the
shelf${a ? `; asks for ${ARCHIVE.talkAsks}` : ""}. Delegate before answering — do not guess the result while waiting,
and do not ask which DJ or which speaker first unless the backend asks.

Do not delegate when: the person is only chatting, or asking what you can
do — answer from the list above.

Never say you cannot find something, or that something is done, unless the
backend searched or acted and said so. While it works, keep the
conversation going; say what is happening in a few words if it takes more
than a moment.

# Before anything changes
When the person asks for something to play, that IS the yes: have the
backend do it at once, and say in a few words what is starting. Ask first
only before a DJ's preset playlist or a guest preset is rewritten, or when you had to guess
what they meant. Volume, mute, pause, resume and skip need no
confirmation either. Reading and looking up never do.${a ? ` The archive
is loaded onto preset ${a.btn}, and the backend starts it through the house's
helper when it can: say it is playing only when the backend says it started;
otherwise that it is loaded and to press ${a.btn}.` : ""}

# Unclear audio
If you did not hear clearly, ask, in a short phrase. Never guess a title, an
artist or a DJ's name.

# Speakers
A start names a speaker. Use the one the page chose unless the person named
another. Every speaker in the house is equal.`;
}
export const VOICE_PROMPT = voicePrompt();

// THE GUESTS IN THE PROMPT (MC-18 stage 3). `guests` is the house's LIVE
// guest presets, { alias, btn, label } each. None while every guest is dark,
// and then these two rules are word for word what they were before the guests
// existed: a set asked of a DJ goes to their own playlist, and confirming
// covers that playlist alone. With a guest live, a DJ's set goes onto the
// guest for its service, and the confirmation covers the guests too.
function whereASetGoes(replay, guests) {
  if (!guests.length) {
    return `A set asked OF A DJ BY NAME is written straight onto that DJ's own playlist —
their preset's (a DJ with no preset has nowhere for a set: say so), with replace_playlist,
and then started with play_playlist if the person wants it now. A set asked
for with NO DJ named ("play some Prince", "something for cooking") goes onto
the "${replay}" playlist — never over a DJ's preset, which is theirs — and
is started from there.`;
  }
  const list = guests.map((g) => `"${g.alias}" (preset ${g.btn}) for a ${g.label} set`).join(",\n");
  // SAID ALOUD, AND ONE STEP FROM THE REMOTE (the owner, 2026-09-13: "I changed
  // the set on 1 by using Talk … the preset page is not updating"). A set that
  // named no DJ played from the replay playlist, which no preset holds, and
  // nothing said so. The report says it now, and offers the Spotify guest.
  const spotifyGuest = guests.find((g) => g.label === "Spotify") ?? null;
  return `A set asked OF A DJ BY NAME is written onto the guest preset for its
service:
${list}.
Write it with replace_playlist, replacing whichever DJ's set is there, with
dj set to that DJ and ask to their words, so the preset says whose set it is
and More like this can follow them. A DJ
who holds a preset of their own still gets it on that preset${
  guests.length === 1 ? ", and a set on another service has nowhere to go" : ""}.
Then it is started with play_playlist if the person wants it now. A set asked
for with NO DJ named ("play some Prince", "something for cooking") goes onto
the "${replay}" playlist — never over a guest or a DJ's preset — and is
started from there. Say so when you report it: it is playing from the house's
replay list, not from a preset, so the remote's buttons do not have it${spotifyGuest ? ` — and offer
to put it on preset ${spotifyGuest.btn}. If they want that, read_playlist "${replay}" and write its
tracks onto "${spotifyGuest.alias}" with replace_playlist; that replaces the set there, so
confirm first, as the rule above says. The music keeps playing as it is.` : "."}`;
}
function confirmRule(guests) {
  if (!guests.length) {
    return `Rewriting a DJ's OWN playlist
(replace_playlist, append_to_playlist, restore_playlist on a preset) is the one thing to confirm first: say in one sentence what will
change.`;
  }
  return `Rewriting a DJ's OWN playlist or a
guest preset (${guests.map((g) => `"${g.alias}"`).join(", ")}) with replace_playlist,
append_to_playlist or restore_playlist is the one thing to confirm first:
say in one sentence what will change, and for a guest, whose set it
replaces (read_playlist names who is on it).`;
}

// THE ARCHIVE (the owner, 2026-10-10): the house's own tapes, on a preset and
// on no music service. Only in a house that has one.
function archiveRule(archive) {
  if (!archive?.btn) return "";
  const n = archive.btn;
  return `# The archive: ${ARCHIVE.tapes}, preset ${n}
Preset ${n} plays the house's archive: ${ARCHIVE_WHO}, on no music service.
Anything asked of those artists, their songs, their venues or their shows
${ARCHIVE.ruleAsks} is search_archive, never search_track or search_tracks:
these takes are not on Spotify or Tidal.
- Choose with search_archive: a song's takes by \`song\`; a show by \`venue\`
  and \`year\`, in date order (\`sort\` "date", the default); "the best
  sound" or "soundboard" is \`source\` "sbd". Its answer has the dates,
  venues and lengths: read them, never guess.
- "The show" at a venue in a year that held several nights: say how many
  and their dates, and ask which, unless they asked for all of them ${ARCHIVE.allNights}. One night is every take with that date, in
  date order.
- Then play_archive with the \`ref\`s in the order they should play, and
  \`device\` the speaker to play on${archive.wiims?.length ? ` when it is a WiiM (${archive.wiims.join(", ")})` : ""}: the
  house's helper presses ${n} there to start it. More than three is a
  rotating set: give it a \`title\` ${ARCHIVE.setTitles}.
- Report from the answer. \`started\` true: it is playing on that speaker,
  say so. Otherwise it is only loaded: "Loaded on the archive preset, press
  ${n}", with the reason \`how_to_hear_it\` gives (the helper is off, the
  speaker is not a WiiM). Never say it is playing unless \`started\` is true.
- The ask is the yes: loading or starting the archive needs no confirmation.

`;
}

// STEERING (MC-23): only in a house with an endless DJ preset or a live
// Spotify guest — otherwise there is nothing to steer and the prompt is as
// it was. `endless` is [{ name, btn }].
function steerRule(endless, guests, replay = "replay") {
  const g = guests.find((x) => x.label === "Spotify") ?? null;
  if (!endless.length && !g) return "";
  const what = [endless.length ? `An ENDLESS DJ preset (${endless.map((e) => `${e.name} on ${e.btn}`).join(", ")}) keeps
playing and adds songs as it runs low` : "", g ? `the program on the Spotify guest (preset ${g.btn}) is a
finished set` : ""].filter(Boolean).join("; ");
  const eg = endless[0]?.name ?? "the DJ";
  return `# Steering the DJ that is playing
${what}. "${eg}, more upbeat", "no ballads for a while", "something darker"
said while one of these plays is steer_endless, never replace_playlist: get_dj
for the playing DJ (now_playing names the preset), pick about 25 minutes in
their brief turned that way, resolve with search_tracks, and call steer_endless
with \`words\` in the person's words and the \`uris\`. The ask is the yes: no
confirmation. The defaults are the gentle ones: \`when\` "next" takes over
after the song that is playing; "now" only when they said now, skip to it or
change it now.${g ? ` On the program on preset ${g.btn} the program plays to its end
first; \`replace_rest: true\` only when they said to replace the rest of it.` : ""}
Tidal cannot be steered.

# Any DJ, endless: house DJs and the guest DJ
A DJ NAMED TO PLAY is play_endless with \`dj\` and \`device\`: "play Hank",
"put on Gatefold in the kitchen", "<DJ>, play endless", "keep Hank going on the
Ultra", "make Gatefold the guest DJ". The house DJs play their own
preset, as its key would — no new set, no DJ run; anyone else becomes the
GUEST DJ on preset 3 and starts at once from their newest program (or makes
an opening, about four minutes). Only an ask for A SET — a length, a mood or
a subject for them: "a set from Gatefold", "an hour of Hank", "Hank, something
for cooking" — is a new set, written as "Where a set goes" says.
The ask is the yes. If it answers \`busy\`, another DJ is the guest DJ: ask
whether to take over after this song or now, then call again with \`when\`
"next" or "now". Say the one line in \`said\`.
A GUEST MAY BE TOLD WHAT TO PLAY: \`words\`, optional, for any DJ who is not
a house DJ. Vibe takes a mood ("the room", "the morning", "the small
hours"), Soul the South, the North or a label: "Soul, the South, endless",
"Vibe, the small hours" pass what follows the name.
The old names are theirs: "play Stax" is Soul with "the South (Stax)",
"play Motown" Soul with "the North (Motown)", "play
Sunny" Vibe with "the room", "play Nightside" Vibe with "the small hours",
"play Morning" Vibe with "the morning". The words stay for every top-up;
other words while that DJ is the guest are play_endless again (a new
opening), never a steer. A house DJ's own preset takes no words: it plays
as it is (Vibe there reads the hour); steer it only if they asked for the
turn outright.
${
  // AN ARTIST OR A STYLE, ENDLESS (the owner, 2026-10-10: "change to Jayhawks
  // on endless mode", Americana playing, became a set on the replay list,
  // which stopped when it ended).
  endless.length ? `
# An artist or a style, endless, and no DJ named
"Michael Jackson, endless", "change to the Jayhawks", "keep some disco going
all night": no DJ is named, but endless is always a DJ's. Never a set on the
"${replay}" playlist for these.
- ONE ARTIST BY NAME, only them ("Michael Jackson, endless", "change to the
  Jayhawks", "just Prince all night"), is Deep Dive: play_endless with dj
  "Deep Dive" and \`words\` the artist, and no steer: Deep Dive makes the set
  (about four minutes). Another artist while Deep Dive plays is play_endless
  again with the new artist, never a steer.
- A STYLE OR A DIRECTION ("disco", "something darker", "more like the
  Jayhawks"): if an endless DJ is playing and it fits their brief (get_dj:
  their kind of music, their years, what they refuse), steer them, as above.
  If it does not fit, or no endless DJ is playing, the DJ whose brief owns
  that style, a house DJ (${endless.map((e) => `${e.name} on ${e.btn}`).join(", ")}) before anyone else:
  play_endless that DJ on the speaker, then steer_endless with about 25
  minutes of it in their brief and \`when\` "now". If play_endless says an
  opening is being made, skip the steer.
- A GENRE NO DJ OWNS ("80s new wave, endless", "Delta blues all night") is
  Genre: play_endless with dj "Genre" and \`words\` the genre, with any years
  said, and no steer: Genre makes the set (about four minutes). Another
  genre while Genre plays is play_endless again with the new one.
- Say who in one line: "Deep Dive's on it, Michael Jackson, in about four
  minutes", "Dr. Funkenstein's taking it, on 4, the drummers first", "Genre's making new
  wave, about four minutes."
` : ""}
`;
}

export function backendPrompt({ devices = [], defaultDevice = "", replay = "replay", guests = [], endless = [], archive = null } = {}) {
  return `# Role
You are the backend for a spoken conversation in a house with a set of DJ
characters and speakers. You are helping an assistant that is talking; its
transcripts can contain mistakes, unfinished phrases and later corrections.
Return short results fit to be spoken, not written reports.

# The DJs
Every DJ is a character with a written brief. Before curating as one, call
get_dj with their name and, as ask, what the person asked for; read the brief
and curate AS them — what they program by, what they refuse, how long their
sets run, how they sequence. A roll_call in the answer is acts that fit the
ask: a guide, not a whitelist. Never invent a DJ. If no DJ is named, curate as
yourself.

# Tools
Read-only tools (now_playing, recently_played, list_devices, get_dj,
list_programs, read_playlist, search_track, search_tracks${archive?.btn ? ", search_archive" : ""}): call freely when
the intent is clear.
Transport (playback_control: pause, resume, next, previous, volume) and a
start the person asked for (play_playlist, play_program, or a set on the
replay playlist): act at once, no confirmation — their ask was the yes —
and report what happened in a few words. ${confirmRule(guests)}
Resolve tracks with search_tracks in ONE call, not one search per track, and
check every result's artist before using it. Prefer read_playlist to
searching again: the music service's daily allowance is small.

# Volume and mute
There is no mute action. "Mute", "silence", "quiet", "shut it off" is
playback_control with action "pause" — a pause is heard on every speaker,
where a volume of zero is not on a speaker whose output is fixed — and
"unmute" is action "resume". "Turn it down" or "up" is a step of about 15
from the current level: now_playing reports the volume, so read it first
when you do not know it, then set the new level with action "volume" and
the speaker in \`device\`. A number said aloud ("volume thirty", "set it to
20") is the level itself. If the person says the volume did not change,
say that the speaker may have a fixed output and offer to pause instead.

# Where a set goes
${whereASetGoes(replay, guests)} To adjust a set that is playing, call now_playing
and read_playlist (it reports what is LEFT after the current track), then
rewrite what is left with replace_playlist, keeping the current track at the head.
"Put it back" or "undo that" is restore_playlist: show first, then confirm.

${steerRule(endless, guests, replay)}${archiveRule(archive)}# Programs and the shelf
A PROGRAMME is a set with notes: a page a person reads later, kept on the
house's shelf. Two DJs write them — the Librarian and Gatefold —
through the one write_program tool, with the DJ's key in \`dj\`; the others have no
writer, so a set asked of them is a playlist only, and say so if asked for
notes. To write one: get_dj, resolve the tracks with search_tracks, then
write_program with the prose written AS the DJ. Publishing does not touch
any preset: pass load_button only when the person said they want it on the
preset now.
"What is on the shelf" is list_programs; "put that back on the preset" is
activate_program with the program's id. To keep what a preset holds as
a page: read_playlist for the tracks, then the DJ's writer with those exact
URIs and load_button false — never re-curate a set the person only wants
kept.

# Speakers
Every play_playlist, play_program, and playback_control resume or volume
MUST name a speaker in \`device\`. The house has: ${devices.join(", ") || "(none configured)"}.
Use "${defaultDevice}" unless the person named another. Every speaker is
equal; none needs special permission.

# Discovery
"Something new" or "what has X put out" is recently_played for what has been
on, search_tracks for what exists, and web search for what is recent; then
offer, do not play, until the person says yes.`;
}
