// THE SECURITY SHAPE OF THE TALK PAGE (MC-15 stage S, 2026-09-12): every rule
// the Talk endpoints check, as a pure function with a test, written and put
// to Codex BEFORE any endpoint exists. voice.js fetches nothing and reads no
// store, so every one of these runs in a millisecond with no fake.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAP_MINUTES, BEAT_MS, IDLE_CLOSE_MS,
  VOICE_MODEL, DEFAULT_BACKEND_MODEL, backendModel,
  houseTz, houseDay, originCheck, contentTypeCheck, capFrom, mintCap, CAP_RE,
  parseToolCall, speakerRule, canonicalDevice, VOICE_PROMPT, backendPrompt, ARGS_MAX_BYTES,
} from "../voice.js";
import { __test } from "../worker.js";

const req = (headers = {}, url = "https://house.example/buttons/k/talk/tool") =>
  new Request(url, { method: "POST", headers });
const site = new URL("https://house.example/buttons/k/talk/tool");
const DEVICES = ["Pro Plus", "Ultra", "Everywhere", "Master Bedroom"];

test("the numbers are the owner's, and the models are named once", () => {
  assert.equal(CAP_MINUTES, 60, "sixty minutes a day (the owner, 2026-09-11)");
  assert.equal(BEAT_MS, 30_000, "still here, every half minute");
  assert.equal(IDLE_CLOSE_MS, 30_000, "thirty seconds after the desk has finished (the owner, 2026-09-12)");
  assert.equal(VOICE_MODEL, "gpt-live-1");
  assert.equal(DEFAULT_BACKEND_MODEL, "gpt-5.6-terra", "stage 0: one tool round trip fewer");
  assert.equal(backendModel({}), "gpt-5.6-terra");
  assert.equal(backendModel({ VOICE_BACKEND_MODEL: "gpt-5.6-luna" }), "gpt-5.6-luna", "luna is one config line away");
});

test("the house's day is the house's, not UTC's", () => {
  assert.equal(houseTz({ TIDAL_COUNTRY: "NL" }), "Europe/Amsterdam");
  assert.equal(houseTz({ HOUSE_TZ: "Europe/Lisbon", TIDAL_COUNTRY: "NL" }), "Europe/Lisbon", "an explicit zone wins");
  assert.equal(houseTz({}), "UTC", "nothing known reads as UTC, never as a guess");
  // 23:30 UTC on the 11th is already the 12th in Amsterdam.
  const late = Date.UTC(2026, 8, 11, 23, 30);
  assert.equal(houseDay({ TIDAL_COUNTRY: "NL" }, late), "2026-09-12");
  assert.equal(houseDay({}, late), "2026-09-11");
  assert.match(houseDay({ TIDAL_COUNTRY: "NL" }), /^\d{4}-\d{2}-\d{2}$/);
});

test("a Talk call must come from the page itself: origin present and exact", () => {
  assert.match(originCheck(req(), site), /must come from the Talk page/, "missing is refused");
  assert.match(originCheck(req({ origin: "null" }), site), /must come from the Talk page/, "null is refused — the wall's forms allow it, a script call does not");
  assert.match(originCheck(req({ origin: "https://evil.test" }), site), /came from https:\/\/evil\.test, not from https:\/\/house\.example/);
  assert.match(originCheck(req({ origin: "http://house.example" }), site), /not from/, "the scheme is part of the origin");
  assert.equal(originCheck(req({ origin: "https://house.example" }), site), null);
});

test("the content type is exact, parameters allowed, anything else refused", () => {
  assert.equal(contentTypeCheck(req({ "content-type": "application/json" }), "application/json"), null);
  assert.equal(contentTypeCheck(req({ "content-type": "application/json; charset=utf-8" }), "application/json"), null);
  assert.equal(contentTypeCheck(req({ "content-type": "Application/SDP" }), "application/sdp"), null, "case-insensitive");
  assert.match(contentTypeCheck(req({ "content-type": "text/plain" }), "application/json"), /must be application\/json, not text\/plain/);
  assert.match(contentTypeCheck(req(), "application/sdp"), /not nothing/, "a form cannot send application/sdp, and a call without a type is not this page's");
  assert.match(contentTypeCheck(req({ "content-type": "application/x-www-form-urlencoded" }), "application/json"), /must be application\/json/);
});

test("the capability is 32 hex characters, minted fresh, carried as a header", () => {
  const cap = mintCap();
  assert.match(cap, CAP_RE);
  assert.notEqual(mintCap(), cap, "random");
  assert.equal(capFrom(req({ "x-talk-session": cap })), cap);
  assert.equal(capFrom(req({ "x-talk-session": cap.toUpperCase() })), cap, "case-folded");
  assert.equal(capFrom(req()), null);
  assert.equal(capFrom(req({ "x-talk-session": "short" })), null);
  assert.equal(capFrom(req({ "x-talk-session": cap + "0" })), null, "not longer");
  assert.equal(capFrom(req({ "x-talk-session": "g".repeat(32) })), null, "hex only");
});

test("a tool call is a name on the list and a JSON object of arguments", () => {
  const allowed = __test.VOICE_TOOLS;
  const ok = parseToolCall({ name: "now_playing", arguments: "{}" }, allowed);
  assert.deepEqual(ok, { name: "now_playing", args: {} });
  // The Responses shape: arguments is a JSON STRING.
  const s = parseToolCall({ name: "play_playlist", arguments: '{"playlist":"Sunny","device":"Pro Plus"}' }, allowed);
  assert.deepEqual(s.args, { playlist: "Sunny", device: "Pro Plus" });
  // An already-parsed object is fine too; nothing and empty read as no arguments.
  assert.deepEqual(parseToolCall({ name: "get_dj", arguments: { name: "Sunny" } }, allowed).args, { name: "Sunny" });
  assert.deepEqual(parseToolCall({ name: "get_dj" }, allowed).args, {});
  assert.deepEqual(parseToolCall({ name: "get_dj", arguments: "  " }, allowed).args, {});
  // Refusals, each in a sentence.
  assert.throws(() => parseToolCall({ name: "unpublish_program", arguments: "{}" }, allowed), /not a tool the room's voice may call/);
  assert.throws(() => parseToolCall({ name: "probe_voice_door", arguments: "{}" }, allowed), /not a tool the room's voice may call/);
  assert.throws(() => parseToolCall({ arguments: "{}" }, allowed), /"\(nothing\)" is not a tool/);
  assert.throws(() => parseToolCall({ name: "get_dj", arguments: "{not json" }, allowed), /not valid JSON/);
  assert.throws(() => parseToolCall({ name: "get_dj", arguments: "[1,2]" }, allowed), /must be a JSON object/);
  assert.throws(() => parseToolCall({ name: "get_dj", arguments: '"a string"' }, allowed), /must be a JSON object/);
  assert.throws(() => parseToolCall(null, allowed), /must be a JSON object with name/);
  assert.throws(() => parseToolCall([], allowed), /must be a JSON object with name/);
  // A hostile name is cut and quoted, never executed.
  assert.throws(() => parseToolCall({ name: "x".repeat(200), arguments: "{}" }, allowed), /is not a tool/);
});

test("a start names its speaker; every speaker on the list is equal", () => {
  // Starts without a device: refused with the question the model can say aloud.
  for (const name of ["play_playlist", "play_program", "play_uris"]) {
    assert.match(speakerRule(name, {}, DEVICES), /Which speaker\?/, name);
    assert.match(speakerRule(name, { device: "" }, DEVICES), /Which speaker\?/);
  }
  assert.match(speakerRule("playback_control", { action: "resume" }, DEVICES), /Which speaker\?/, "resume acts on a speaker");
  assert.match(speakerRule("playback_control", { action: "volume", volume: 30 }, DEVICES), /Which speaker\?/);
  // Pause, next, previous act on what is playing: no speaker needed.
  for (const action of ["pause", "next", "previous"]) {
    assert.equal(speakerRule("playback_control", { action }, DEVICES), null, action);
  }
  // Reads never need one.
  assert.equal(speakerRule("now_playing", {}, DEVICES), null);
  assert.equal(speakerRule("replace_playlist", { playlist: "Sunny", uris: [] }, DEVICES), null, "a write is not a start");
  // Every speaker in the house passes alike — the Ultra included (the owner, 2026-09-11).
  for (const d of DEVICES) {
    assert.equal(speakerRule("play_playlist", { playlist: "Sunny", device: d }, DEVICES), null, d);
    assert.equal(speakerRule("playback_control", { action: "resume", device: d }, DEVICES), null, d);
  }
  assert.equal(speakerRule("play_playlist", { device: "ultra" }, DEVICES), null, "case-insensitive");
  assert.equal(canonicalDevice({ device: "ultra" }, DEVICES), "Ultra", "and the house's own spelling is what the tool gets");
  // A name that is not the house's, or a partial, is refused and the list is offered.
  assert.match(speakerRule("play_playlist", { device: "Kitchen" }, DEVICES), /no speaker called "Kitchen"\. The house has: Pro Plus, Ultra, Everywhere, Master Bedroom\./);
  assert.match(speakerRule("play_playlist", { device: "Pro" }, DEVICES), /no speaker called "Pro"/, "a partial is not a name here, whatever resolveDevice allows");
  assert.equal(canonicalDevice({ device: "Pro" }, DEVICES), null);
  // A device argument that is not a string cannot smuggle anything.
  assert.match(speakerRule("play_playlist", { device: { $ne: "" } }, DEVICES), /no speaker called/);
});

test("the prompts say the rules the code enforces, and name the house's speakers", () => {
  assert.match(VOICE_PROMPT, /that IS the yes: have the\s+backend do it at once/, "a play asked for is not asked about again (the owner, 2026-09-12)");
  assert.match(VOICE_PROMPT, /Ask first\s+only before a DJ's preset playlist or a guest preset is rewritten/);
  assert.match(VOICE_PROMPT, /Never guess a title/);
  assert.match(VOICE_PROMPT, /asks for music\s+by artist, style, era or mood/, "the room test: rare funk never reached a search");
  assert.match(VOICE_PROMPT, /# Backchannel policy/); assert.match(VOICE_PROMPT, /# Interruption policy/);
  assert.match(VOICE_PROMPT, /Delegate to the backend when:/); assert.match(VOICE_PROMPT, /Do not delegate when:/);
  assert.match(VOICE_PROMPT, /Never say\s+you cannot find something/);
  assert.match(VOICE_PROMPT, /Every speaker in the house is equal/);
  assert.ok(!/Ultra/.test(VOICE_PROMPT), "no speaker is special in the words either");
  const b = backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus" });
  assert.match(b, /call\s+get_dj with their name and, as ask, what the person asked for;\s+read the brief/);
  assert.match(b, /MUST name a speaker in `device`/);
  assert.match(b, /The house has: Pro Plus, Ultra, Everywhere, Master Bedroom\./);
  assert.match(b, /Use "Pro Plus" unless the person named another/);
  assert.match(b, /search_tracks in ONE call/);
  assert.match(b, /the one write_program tool, with the DJ's key in `dj`; the others have no\s+writer/, "the owner's 'do 2': the writers and the shelf by voice, through one tool (MC-17)");
  assert.match(b, /activate_program with the program's id/);
  assert.match(b, /"Mute", "silence", "quiet", "shut it off" is\s+playback_control with action "pause"/, "mute is a pause, which every speaker hears");
  assert.match(b, /keeping the current track at the head/);
  assert.match(b, /straight onto that DJ's own playlist/, "the owner's decision 3");
  assert.match(b, /NO DJ named [^\n]*goes onto\s+the "replay" playlist/, "an unnamed set never lands on a DJ's preset");
  assert.match(backendPrompt({ replay: "scratch" }), /the "scratch" playlist/);
  assert.ok(!/tap/i.test(b), "no tap, no special case");
  // The briefs themselves are not in the prompt: get_dj carries them.
  assert.ok(!/PROGRAMS BY/.test(b));
  assert.match(backendPrompt({}), /\(none configured\)/);
});

test("MC-18 stage 3: while no guest is live the backend prompt is the one it was; a live guest is where a DJ's set goes", () => {
  const dark = backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus" });
  assert.equal(backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus", guests: [] }), dark);
  // The two rules the guests change, as they read in a dark house (the crates went in stage 6).
  assert.ok(dark.includes(`# Where a set goes
A set asked OF A DJ BY NAME is written straight onto that DJ's own playlist —
their preset's (a DJ with no preset has nowhere for a set: say so), with replace_playlist,
and then started with play_playlist if the person wants it now. A set asked
for with NO DJ named ("play some Prince", "something for cooking") goes onto
the "replay" playlist — never over a DJ's preset, which is theirs — and
is started from there. To adjust a set that is playing, call now_playing`));
  assert.ok(dark.includes(`and report what happened in a few words. Rewriting a DJ's OWN playlist
(replace_playlist, append_to_playlist, restore_playlist on a preset) is the one thing to confirm first: say in one sentence what will
change.
Resolve tracks`));
  assert.ok(!/\bguests?\b/i.test(dark), "a dark prompt says nothing of the guests");

  const G = [{ alias: "guest on spotify", btn: 1, label: "Spotify" }, { alias: "guest on tidal", btn: 2, label: "Tidal" }];
  const live = backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus", guests: G });
  assert.match(live, /A set asked OF A DJ BY NAME is written onto the guest preset for its\nservice:\n"guest on spotify" \(preset 1\) for a Spotify set,\n"guest on tidal" \(preset 2\) for a Tidal set\.\nWrite it with replace_playlist, replacing whichever DJ's set is there, with\ndj set to that DJ and ask to their words, so the preset says whose set it is\nand More like this can follow them\./);
  assert.ok(!live.includes("straight onto that DJ's own playlist"));
  assert.match(live, /NO DJ named [^\n]*goes onto\s+the "replay" playlist — never over a guest or a DJ's preset/,
    "replay stays for a set that names no DJ");
  // Said aloud, and one step from the remote (2026-09-14): the report says
  // the set is on no preset, and offers the Spotify guest, confirmed first.
  assert.match(live, /Say so when you report it: it is playing from the house's\s+replay list, not from a preset, so the remote's buttons do not have it — and offer\s+to put it on preset 1\./);
  assert.match(live, /read_playlist "replay" and write its\s+tracks onto "guest on spotify" with replace_playlist; that replaces the set there, so\s+confirm first/);
  assert.match(backendPrompt({ guests: [G[1]] }), /so the remote's buttons do not have it\.(?! — and offer)/,
    "no Spotify guest: said, and nothing offered");
  // The confirmation, today's rule, covers the guests and says whose set goes.
  assert.match(live, /Rewriting a DJ's OWN playlist or a\s+guest preset \("guest on spotify", "guest on tidal"\) with replace_playlist,\s+append_to_playlist or restore_playlist is the one thing to confirm first:\s+say in one sentence what will change, and for a guest, whose set it\s+replaces \(read_playlist names who is on it\)\./);
  // Everything else is as it was.
  // Save steering (MC-23), which a live Spotify guest brings: its program can be steered.
  assert.match(live, /On the program on preset 1 the program plays to its end\s+first/);
  assert.ok(!dark.includes("# Steering"), "nothing to steer in a dark house with no endless DJ");
  const strip = (s) => s.replace(/# Where a set goes\n[\s\S]*?To adjust/, "").replace(/Rewriting a DJ's OWN[\s\S]*?\nResolve tracks/, "")
    .replace(/# Steering the DJ that is playing\n[\s\S]*?\n\n(?=# Programs)/, "");
  assert.equal(strip(live), strip(dark));
  // One guest live: a set on the other service has nowhere to go (stage 6).
  assert.match(backendPrompt({ guests: [G[0]] }),
    /still gets it on that preset, and a set on another service has nowhere to go\./);
});

// ---- after Codex's review of this file (MC15S-7R2): the tests it said were missing

test("the checks apply in the one order that can work: allowlist before the parse, the parse before the speaker", () => {
  const allowed = __test.VOICE_TOOLS;
  // An off-list name with unparseable arguments is refused for the NAME —
  // nothing of a stranger's is parsed.
  assert.throws(() => parseToolCall({ name: "unpublish_program", arguments: "{not json" }, allowed), /not a tool the room's voice may call/);
  // A start with unparseable arguments is refused for the JSON, before any
  // speaker question could be asked.
  assert.throws(() => parseToolCall({ name: "play_playlist", arguments: "{not json" }, allowed), /not valid JSON/);
  // And the speaker rule reads what the parse produced.
  const { name, args } = parseToolCall({ name: "play_playlist", arguments: '{"playlist":"Sunny"}' }, allowed);
  assert.match(speakerRule(name, args, DEVICES), /Which speaker\?/);
});

test("a speaker named on pause, next or previous is checked too — the tool underneath matches a partial", () => {
  for (const action of ["pause", "next", "previous"]) {
    assert.equal(speakerRule("playback_control", { action }, DEVICES), null, `${action} may omit it`);
    assert.equal(speakerRule("playback_control", { action, device: "Ultra" }, DEVICES), null);
    assert.match(speakerRule("playback_control", { action, device: "Pro" }, DEVICES), /no speaker called "Pro"/, `${action} with a partial`);
    assert.match(speakerRule("playback_control", { action, device: "Kitchen" }, DEVICES), /no speaker called "Kitchen"/);
  }
  assert.match(speakerRule("play_playlist", { device: 12 }, DEVICES), /no speaker called "12"/, "a number is not a name");
});

test("arguments are bounded and plain: no oversize, no prototype keys, no class instances", () => {
  const allowed = __test.VOICE_TOOLS;
  const big = JSON.stringify({ uris: Array.from({ length: 2000 }, (_, i) => `spotify:track:${String(i).padStart(22, "0")}`) });
  assert.ok(big.length > ARGS_MAX_BYTES);
  assert.throws(() => parseToolCall({ name: "replace_playlist", arguments: big }, allowed), /too large/);
  assert.throws(() => parseToolCall({ name: "get_dj", arguments: '{"__proto__":{"polluted":1}}' }, allowed), /not allowed/);
  assert.throws(() => parseToolCall({ name: "get_dj", arguments: '{"constructor":{"prototype":{}}}' }, allowed), /not allowed/);
  assert.throws(() => parseToolCall({ name: "get_dj", arguments: { prototype: 1 } }, allowed), /not allowed/);
  assert.equal(({}).polluted, undefined, "and nothing reached Object.prototype");
  class Args { constructor() { this.name = "Sunny"; } }
  assert.throws(() => parseToolCall({ name: "get_dj", arguments: new Args() }, allowed), /must be a JSON object/);
  assert.deepEqual(Object.keys(parseToolCall({ name: "get_dj", arguments: Object.create(null) }, allowed).args), [], "a null-prototype object is plain");
  // A normal set of a hundred URIs is nowhere near the bound.
  const hundred = JSON.stringify({ playlist: "Sunny", uris: Array.from({ length: 100 }, (_, i) => `spotify:track:${String(i).padStart(22, "0")}`) });
  assert.equal(parseToolCall({ name: "replace_playlist", arguments: hundred }, allowed).args.uris.length, 100);
});

test("the speaker rule works on the house's own list, fallback included", () => {
  const { parseRoomDevices } = __test;
  const fromConfig = parseRoomDevices({ ROOM_DEVICES: JSON.stringify(["Pro Plus", "Ultra", "Everywhere"]), DEFAULT_DEVICE: "Pro Plus" });
  for (const d of fromConfig) assert.equal(speakerRule("play_playlist", { playlist: "x", device: d }, fromConfig), null, d);
  const fallback = parseRoomDevices({ DEFAULT_DEVICE: "Pro Plus" });
  assert.deepEqual(fallback, ["Pro Plus"]);
  assert.equal(speakerRule("play_playlist", { device: "pro plus" }, fallback), null);
  assert.match(speakerRule("play_playlist", { device: "Ultra" }, fallback), /The house has: Pro Plus\./, "a house with one speaker has one");
  const broken = parseRoomDevices({ ROOM_DEVICES: "not json", DEFAULT_DEVICE: "Pro Plus" });
  assert.deepEqual(broken, ["Pro Plus"]);
});

test("an invalid HOUSE_TZ is an error, never a silent day boundary; DST does not move the day", () => {
  assert.throws(() => houseTz({ HOUSE_TZ: "Europe/Amsterdamn" }), /HOUSE_TZ is not a timezone: "Europe\/Amsterdamn"/);
  assert.throws(() => houseDay({ HOUSE_TZ: "Mars/Olympus" }, Date.now()), /not a timezone/);
  assert.equal(houseTz({ HOUSE_TZ: " Europe/Amsterdam " }), "Europe/Amsterdam", "trimmed");
  // The night the clocks go forward in Amsterdam (2026-03-29, 01:00 UTC): the
  // day is the 29th on both sides of it.
  assert.equal(houseDay({ TIDAL_COUNTRY: "NL" }, Date.UTC(2026, 2, 29, 0, 59)), "2026-03-29");
  assert.equal(houseDay({ TIDAL_COUNTRY: "NL" }, Date.UTC(2026, 2, 29, 1, 1)), "2026-03-29");
  // And the night they go back (2026-10-25): 22:30 UTC on the 24th is already the 25th there.
  assert.equal(houseDay({ TIDAL_COUNTRY: "NL" }, Date.UTC(2026, 9, 24, 22, 30)), "2026-10-25");
  assert.equal(houseDay({ TIDAL_COUNTRY: "NL" }, Date.UTC(2026, 9, 25, 22, 30)), "2026-10-25", "after the clocks go back, 23:30 local is still the 25th");
});

test("a DJ named to play is play_endless — a house DJ's own preset, anyone else the guest DJ; only an ask for a set makes one (2026-09-26)", () => {
  const p = backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus", endless: [{ name: "Hank", btn: 5 }] });
  assert.match(p, /A DJ NAMED TO PLAY is play_endless with `dj` and `device`: "play Hank"/);
  assert.match(p, /The house DJs play their own\s+preset, as its key would — no new set, no DJ run/);
  assert.match(p, /Only an ask for A SET — a length, a mood or\s+a subject for them: "a set from Gatefold", "an hour of Hank"/);
  // Camille was the example until the owner cut her, 2026-10-15.
  assert.doesNotMatch(p, /Camille/);
});

// AN ARTIST OR A STYLE, ENDLESS, NO DJ NAMED (the owner, 2026-10-10: "change
// to Jayhawks on endless mode" with Americana playing became a set on the
// replay list, which stops). Endless is a DJ's: one artist by name is Deep
// Dive's (built the same day); a style goes to the DJ playing if it fits
// their brief, else the DJ who fits, house DJs first, said in one line.
test("an artist or a style asked for endless goes to a DJ: one artist to Deep Dive, a style to the DJ it fits (2026-10-10)", () => {
  const endless = [{ name: "Dr. Funkenstein", btn: 4 }, { name: "Americana", btn: 7 }, { name: "Vibe", btn: 9 }];
  const p = backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus", endless });
  assert.match(p, /# An artist or a style, endless, and no DJ named/);
  assert.match(p, /Never a set on the\s+"replay" playlist for these/);
  assert.match(p, /ONE ARTIST BY NAME[^]*is Deep Dive: play_endless with dj\s+"Deep Dive" and `words` the artist, and no steer/);
  assert.match(p, /Another artist while Deep Dive plays is play_endless\s+again with the new artist,\s+never a steer/);
  assert.match(p, /A STYLE OR A DIRECTION[^]*fits their brief[^]*steer them, as above/);
  assert.match(p, /a house DJ \(Dr\. Funkenstein on 4, Americana on 7, Vibe on 9\) before anyone else/);
  assert.match(p, /play_endless that DJ on the speaker, then steer_endless[^]*`when` "now"/);
  // A genre nobody owns is Genre's (the owner, 2026-10-10), told it as Deep Dive is told an artist.
  assert.match(p, /A GENRE NO DJ OWNS[^]*is\s+Genre: play_endless with dj "Genre" and `words` the genre/);
  // A house with no endless DJs has no such rule: nothing to hand it to.
  assert.doesNotMatch(backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus" }), /An artist or a style, endless/);
});

// WORDS FOR ANY GUEST (the owner, 2026-10-13, with the merges): the old
// names are the new DJs with words, the words stay, other words are a new
// opening, and a house DJ's own preset takes none.
test("Talk may tell any guest DJ what to play, and the merged DJs' old names carry their words (2026-10-13)", () => {
  const p = backendPrompt({ devices: DEVICES, defaultDevice: "Pro Plus", endless: [{ name: "Vibe", btn: 9 }] });
  assert.match(p, /A GUEST MAY BE TOLD WHAT TO PLAY: `words`, optional, for any DJ who is not\s+a house DJ/);
  assert.match(p, /"play Stax" is Soul with "the South \(Stax\)",\s+"play Motown" Soul with "the North \(Motown\)", "play\s+Sunny" Vibe with "the room", "play Nightside" Vibe with "the small hours",\s+"play Morning" Vibe with "the morning"/);
  // Hip Hop's years or a city, and "play KRS-One", went with Hip Hop (2026-10-15).
  assert.doesNotMatch(p, /KRS-One|Hip Hop/);
  assert.match(p, /other words while that DJ is the guest are play_endless again \(a new\s+opening\), never a steer/);
  assert.match(p, /A house DJ's own preset takes no words/);
  // Deep Dive's and Genre's rules stand.
  assert.match(p, /ONE ARTIST BY NAME[^]*is Deep Dive/);
  assert.match(p, /A GENRE NO DJ OWNS[^]*is\s+Genre/);
});
