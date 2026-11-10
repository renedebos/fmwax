// WHAT TO SAY (the owner, 2026-11-08: "a page for the app where these
// examples that are tested and working are listed, in a way that the user
// can easily see what works and how to structure the command sentence").
// The maple crate examples, made from this house's own DJs, presets and
// speakers, each with what it does. The page draws them (programs.js
// renderSay), and the node suite reads every one through the door's own
// reader (alexa.js alexaHeard) and checks the reading it names: what the
// page shows is what the skill does.
//
// A row: `said` is what the page shows after "Alexa, ask maple crate";
// `ask` is the request the test sends Amazon's way (the intent and its
// words or slots, the words taken from `said` itself); `expect` is the
// reading it must give; `result` is what happens, in words.

import { ALEXA_INVOCATION } from "./alexa-model.js";
import { ROSTER } from "./djs.js";
import { parseEndless } from "./endless.js";
import { house } from "./house.js";
import { fallbackDevice, parseRoomDevices } from "./room.js";
import { askDjOn } from "./toollist.js";

// The words Amazon hands over for a sentence as shown: no commas, no
// capitals, what follows the DJ's name.
export const wordsOf = (shown) => String(shown).toLowerCase().replace(/[,.!?…]/g, " ").replace(/\s+/g, " ").trim();
const pick = (list, ...prefer) => prefer.map((k) => list.find((x) => x === k)).find(Boolean) ?? list[0] ?? null;

export function sayExamples(env) {
  const cfg = parseEndless(env);
  const live = cfg?.mode === "live";
  const ownOf = new Map(live ? cfg.presets.filter((p) => p.dj && !p.lane).map((p) => [p.dj, p.button]) : []);
  const lane = live ? cfg.presets.find((p) => p.lane) ?? null : null;
  const guests = Object.keys(ROSTER).filter((k) => !ownOf.has(k) && ROSTER[k].endless !== false);
  const rooms = parseRoomDevices(env);
  const dflt = fallbackDevice(env) || null;
  const one = rooms.find((r) => !/\s/.test(r) && r !== dflt && !/^(?:everywhere|iphone)$/i.test(r)) ?? null;
  const two = rooms.find((r) => /\s/.test(r) && r !== dflt) ?? null;
  const reqBtn = house(env).guest?.spotify?.btn ?? null;
  const asks = askDjOn(env) && reqBtn != null;
  const helper = !!(env.HELPER_SECRET && env.WIIM_SPEAKERS);
  const nm = (k) => ROSTER[k]?.name ?? k;
  const at = (d) => (d ? (/^everywhere$/i.test(d) ? "everywhere" : `on the ${d}`) : "");
  const own = pick([...ownOf.keys()], "hank");
  const asker = pick(Object.keys(ROSTER).filter((k) => ownOf.has(k)), "sessions") ?? own;
  const guest = pick(guests.filter((k) => !ROSTER[k].needsWords), "pub-rock");
  const artist = pick(guests.filter((k) => ROSTER[k].needsWords === "an artist"), "deep-dive");
  const ownBtn = (k) => ownOf.get(k);
  // One DJ row: the sentence as shown after the DJ's name, and its words.
  const dj = (k, rest, label, expect, result, extra = {}) => ({ label, said: `…for ${nm(k)}${rest}`,
    ask: { dj: k, words: wordsOf(rest) || null }, expect, result, ...extra });

  const sections = [];
  const djRows = [];
  if (own) {
    djRows.push(dj(own, "", "A DJ", { kind: "put-on", device: dflt },
      `${nm(own)}'s preset ${ownBtn(own)} starts ${at(dflt)}.`));
    if (one) djRows.push(dj(own, ` on the ${one}`, "A DJ and a speaker", { kind: "put-on", device: one },
      `Preset ${ownBtn(own)} starts on the ${one}.`));
  }
  if (lane && guest) {
    djRows.push(dj(guest, "", "A guest DJ", { kind: "put-on", device: dflt },
      `${nm(guest)} goes on preset ${lane.button}, the guest DJ's. If another DJ is on it, Alexa says who and stops there.`));
    djRows.push({ label: "A guest DJ, now", said: `…to put on ${nm(guest)} now`, ask: { play: guest, when: "now" },
      expect: { kind: "put-on", when: "now" }, result: `${nm(guest)} takes preset ${lane.button} over at once. "After this song" waits for the song to end.` });
  }
  if (lane && artist) {
    djRows.push(dj(artist, "", `${nm(artist)} with no artist`, { kind: "put-on" },
      `Alexa asks which artist, unless preset ${lane.button} is still playing one: then ${nm(artist)} carries on with it.`));
  }
  if (asks && asker) {
    const set = (rest, label, expect, result) => djRows.push(dj(asker, rest, label, { kind: "ask-dj", ...expect }, result));
    set(", acoustic grunge", "A DJ and music", { words: "acoustic grunge", device: dflt, minutes: 60 },
      `A new one-hour set on preset ${reqBtn}. It starts by itself ${at(dflt)} in about five minutes, unless something else is started before then.`);
    if (one) set(`, acoustic grunge, on the ${one}`, "And a speaker", { device: one }, `The same, on the ${one}.`);
    set(", acoustic grunge, for two hours", "And a length", { minutes: 120 }, "A two-hour set.");
    set(", acoustic grunge, no Pearl Jam", "And what to leave out", { avoid: "pearl jam" }, "The set, without Pearl Jam.");
    set(", acoustic grunge, and put it on the shelf", "And keep it", { keep: true },
      "The set, and it goes on the Shelf with a page of its own.");
  }
  if (lane && artist) {
    djRows.push(dj(artist, " on Nick Drake, endless", "A guest DJ, music, endless", { kind: "endless", words: "nick drake" },
      `Preset ${lane.button} gets a new opening set about Nick Drake. It starts by itself in a few minutes and carries on that way, endlessly.`));
  }
  if (asker && ownOf.has(asker)) {
    djRows.push(dj(asker, ", acoustic grunge, endless", "A DJ's own preset, music, endless", { kind: "endless", words: "acoustic grunge" },
      `Preset ${ownBtn(asker)} starts, and ${nm(asker)} steers toward acoustic grunge: the new songs come in after the first song.`));
  }
  if (own) {
    djRows.push(dj(own, ", fresh", "A fresh start", { kind: "fresh" },
      `A new opening set on ${nm(own)}'s preset, in about four minutes. It uses one of the day's endless runs.`));
  }
  if (djRows.length) sections.push({ id: "dj", title: "Ask a DJ", sub: "The DJ's name first. The rest can come in any order; put \"endless\" and \"put it on the shelf\" last.", rows: djRows });

  const pre = [];
  const press = (n, room, label, result) => pre.push({ label, said: `…to play preset ${n}${room ? ` on the ${room}` : ""}`,
    ask: { intent: "PresetIntent", number: n, room }, expect: { kind: "preset", preset: n, ...(room ? { device: room } : {}) }, result });
  if (own) press(ownBtn(own), null, "A preset", helper
    ? `With the home helper on, ${dflt ? `the ${dflt}` : "the WiiM"}'s key ${ownBtn(own)} is pressed, as its remote would: ${nm(own)}.`
    : `${nm(own)}, preset ${ownBtn(own)}, starts ${at(dflt)}.`);
  if (own && one) press(ownBtn(own), one, "A preset and a speaker", `The same, on the ${one}.`);
  if (reqBtn != null) press(reqBtn, null, "The Requests preset", "The newest set you asked for.");
  if (lane) press(lane.button, null, "The guest preset", "Whoever is on the guest preset carries on.");
  const echo = rooms.find((r) => /\s/.test(r) && r !== dflt && !(env.WIIM_SPEAKERS ?? "").includes(`"${r}"`)) ?? null;
  if (own && echo) press(ownBtn(own), echo, "A preset on an Echo",
    "An Echo has no keys: a DJ's preset and the Requests preset play as their Spotify playlist. The radio and Tidal are named, with the WiiMs they play on.");
  if (pre.length) sections.push({ id: "presets", title: "Presets", sub: "A number and a speaker, nothing else: no music, length or endless. For music words, ask the DJ by name.", rows: pre });

  const play = [];
  const ctl = (intent, said, label, expect, result, extra = {}) => play.push({ label, said, ask: { intent, ...extra }, expect, result });
  ctl("SteerToIntent", "…to steer toward Stax", "Steer, your words", { kind: "steer" },
    "The DJ playing turns that way: the new songs come in after the one playing, in a few minutes. Over a set you asked for, it waits for the set's end.", { words: "toward stax" });
  ctl("SteerToIntent", "…to steer the same way", "Steer, more like this", { kind: "steer" }, "The bar's More like this.", { words: "the same way" });
  ctl("SteerToIntent", "…to steer somewhere else", "Steer, change it up", { kind: "steer" }, "The bar's Change it up.", { words: "somewhere else" });
  if (one) ctl("MoveIntent", `…to send the music to the ${one}`, "Move the music", { kind: "move" }, `Spotify's music moves to the ${one}. Tidal does not move.`, { room: one });
  ctl("BackIntent", "…for one song back", "Back a song", { kind: "back" }, "The song before plays again.");
  if (asks) ctl("KeepIntent", "…to keep this set", "Keep what plays", { kind: "keep" },
    `While a set you asked for plays on preset ${reqBtn}: its songs are kept, and the DJ writes its page for the Shelf.`);
  ctl("NowIntent", "…for what's playing", "What's playing", { kind: "now" }, "The song, the speaker and which preset, or that it's paused.");
  sections.push({ id: "playing", title: "While it plays", sub: "Say \"steer\": without it, \"more like this\" and \"change it up\" go to Amazon Music.", rows: play });

  // The rules the rows rest on, each one checked by the suite too.
  const notes = [];
  if (two || one) {
    notes.push({ title: "Speakers", lines: [
      ...(two ? [`A name of two words can be said bare: "${wordsOf(two)}".`] : []),
      ...(one ? [`A name of one word needs "on": "on the ${one}". Said bare, "${wordsOf(one)}" stays in the music.`] : []),
      `No speaker said: ${dflt ? `the ${dflt}` : "none"}.`,
    ], checks: [
      ...(two && asker && asks ? [{ ask: { dj: asker, words: `acoustic grunge ${wordsOf(two)}` }, expect: { kind: "ask-dj", device: two } }] : []),
      ...(one && asker && asks ? [{ ask: { dj: asker, words: `acoustic grunge ${wordsOf(one)}` }, expect: { kind: "ask-dj", device: dflt, words: `acoustic grunge ${wordsOf(one)}` } }] : []),
    ] });
  }
  if (asks && asker) {
    notes.push({ title: "Lengths", lines: [
      "Half an hour, an hour, an hour and a half or two hours. Longer is cut to two hours. None said: an hour.",
      "\"All night\" is the same as \"endless\". With \"endless\", or with a DJ's name alone, a length is dropped.",
    ], checks: [
      { ask: { dj: asker, words: "acoustic grunge for four hours" }, expect: { kind: "ask-dj", minutes: 120 } },
      { ask: { dj: asker, words: "acoustic grunge for half an hour" }, expect: { kind: "ask-dj", minutes: 30 } },
      { ask: { dj: asker, words: "acoustic grunge all night" }, expect: { kind: "endless" } },
    ] });
  }
  notes.push({ title: "What Alexa gets wrong", lines: [
    `Always "for" or "to" right after "${ALEXA_INVOCATION}": without it, Alexa never passes the sentence on.`,
    "Say it a little slowly: a sentence said fast can miss the skill altogether.",
    "\"And keep it\" was once heard as \"and Cupid\": \"and put it on the shelf\" is safer.",
    ...(own ? [`"Fresh" works only on its own: "${nm(own)}, new funk, fresh" asks for a set of "new funk fresh".`] : []),
    `"Alexa, open ${ALEXA_INVOCATION}" is refused under Alexa+: say it all in one breath.`,
    "\"Hush\" and \"carry on\" often go to Alexa itself: the bar's pause is the sure way.",
  ], checks: own && asks ? [{ ask: { dj: own, words: "new funk fresh" }, expect: { kind: "ask-dj", words: "new funk fresh" } }] : [] });
  return { invocation: ALEXA_INVOCATION, sections, notes };
}
