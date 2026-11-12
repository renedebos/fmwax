// ASKING A DJ FOR A SET, BY EITHER DOOR (MC-36, tasks/mc36-talk-hands-off.md).
// The Ask form on a DJ's page and Talk's ask_dj file an ask the same way: the
// words cleaned and bounded, one of the four lengths, the record written
// before the ledger's submit, refused when there is nowhere for the set to
// land, and the curator's doorbell rung after both writes. The curator makes
// the set with no phone open, so an ask by voice survives a hang-up, which a
// set Talk made on the call did not (the owner, 2026-10-27). Lifted out of the
// form's route as it was; the form behaves as before.

import { ARCHIVE } from "./archive-identity.js";
import { CATALOGS } from "./catalog.js";
import { START_FRESH_MS, sleptThrough } from "./endless.js";
import { destinationFor, findSpokenDj, guestLabel, house } from "./house.js";
import { helperGot, helperPress, helperViewOf, housePlayer } from "./now.js";
import { startPlaylistOnDevice } from "./playback.js";
import { parseSpeakers } from "./room.js";
import { fold, houseCatalogNames, playerState, programsKV, reachableDj, setService } from "./services.js";
import { getRequestRecord, makeRequestId, normalizeRequest, putRequestRecord, station } from "./station.js";
import { askDjOn, writerKindFor } from "./toollist.js";
import { emitRequestEvent } from "./writes.js";

// The rendered inputs are single-line; control characters can only arrive by
// hand-built POST or a model's arguments, and the request boundary says they
// never reach the store. Stripped rather than refused: a pasted stray newline
// should not bounce a human.
const clean = (v) => String(v ?? "")
  .replace(/[\u0000-\u001f\u007f-\u009f​-‏⁠﻿]/g, " ")
  .replace(/\s+/g, " ").trim();

// The rendered select offers exactly these four.
//
// 120 was added 2026-09-04: a 12" mix runs six to nine minutes and a
// two-hour set of them is about twenty tracks, well inside the 100 this
// path allows. The 30/38 ceiling that bounds a PUBLISHED PROGRAMME does
// not apply here — that one pays a resolve subrequest per track name,
// and a listener request arrives with its URIs already resolved.
export const ASK_LENGTHS = [30, 60, 90, 120];

// Files one ask. `slug` is the DJ's key, or `archive` for the archive's page;
// `keep` is true only when the door's own yes said so; `extra` rides the
// record (Talk's speaker). Answers { refuse: { status, say } } for an ask no
// door could have offered, else { ok, code } with code one of sent, blank,
// already, busy, full, nowhere, unavailable — and on sent the request's id
// and the preset the set lands on.
export async function fileAsk(env, ctx, { slug, mood, length, avoid, keep = false, notes, service, extra = null }) {
  // An old key is its DJ's (the merges, 2026-10-13), so a request is filed
  // under the key the ledger and the Shelf read.
  const slugKey = house(env).djs[slug]?.key ?? slug;
  // THE ARCHIVE TAKES REQUESTS NOW (2026-09-07). It used to refuse them —
  // "it replays what was already made" — which was true when it had no DJ
  // and a set meant three takes chosen by hand. It has a DJ and a rotating
  // set of any length, so asking it is the same act as asking Hank. The
  // page's slug stays `archive`; the request is filed against the persona,
  // because that is who curates it.
  const archiveAsk = slugKey === "archive";
  const dj = archiveAsk ? house(env).djs[ARCHIVE.dj] : house(env).djs[slugKey];
  if (!dj) return { refuse: { status: 404, say: `No DJ named "${String(slugKey).slice(0, 60)}".` } };
  if (archiveAsk && !house(env).archive) {
    return { refuse: { status: 400, say: "This house has no archive preset for a set to land on." } };
  }
  if (!archiveAsk && !reachableDj(env, dj)) {
    return { refuse: { status: 400, say: `${dj.name}'s sets are made from the house's own recordings — ask for one ` +
      "on the archive's own page." } };
  }
  if (!env.STATION) return { refuse: { status: 500, say: "The request ledger is not configured here." } };

  const words = clean(mood).slice(0, 300);
  const len = clean(length);
  const leave = clean(avoid).slice(0, 200);
  // SHORT NOTES OR THE LONG READ (the owner, 2026-10-18): only for a
  // writer's set that is kept, and only a value the form offers.
  const saidNotes = clean(notes).toLowerCase();
  const kept = keep === true;
  const notesFor = kept && !archiveAsk && writerKindFor(env, dj) && ["short", "long"].includes(saidNotes) ? saidNotes : null;
  // WHICH SERVICE, for a benched DJ in a mixed house (2026-09-10). Only
  // a value the form itself offers is kept; anything else — a service
  // this house has not got, a tenant's ask, a hand-built POST — reads
  // as no choice, and fulfilment takes the house's default. Never from
  // the words: those are taste, and "on Tidal" typed there is ignored
  // by design.
  const said = clean(service).toLowerCase();
  const serviceFor = !archiveAsk && !dj.button && CATALOGS.includes(said) &&
    houseCatalogNames(env).includes(said) && houseCatalogNames(env).length > 1 ? said : null;
  if (!words) return { ok: false, code: "blank" };
  // Anything but the four is a hand-built POST, and refusing tells the truth
  // about what happened.
  if (!ASK_LENGTHS.map(String).includes(len)) {
    return { refuse: { status: 400, say: "The length must be one of the form's own choices: 30, 60, 90 or 120." } };
  }

  const id = makeRequestId();
  const normalized = normalizeRequest(`${words} :: ${len} :: ${leave}`);
  // The words land in KV BEFORE the gate. The other order needed a
  // rollback when the record write failed, and rollback loses a race: a
  // twin submission answered "already" against a row whose record then
  // never materialized. This way any row the ledger accepts has its
  // record readable first — and a REFUSED submission strands only an
  // orphan record that its own TTL drains, which no page ever reads
  // (rendering goes through the ledger).
  try {
    await putRequestRecord(env, { id, dj: archiveAsk ? ARCHIVE.dj : slugKey, mood: words,
      length: Number(len), avoid: leave || null,
      // Written only when true, so an unticked box and every record made
      // before this existed read the same way — absent. The ledger holds
      // claims, leases and state and this is none of them: it is what the
      // person asked for, which is what the record is for.
      ...(kept ? { keep: true } : {}),
      // Written only when chosen, so a record from before the choice
      // existed and one where it did not apply read the same way — absent.
      ...(serviceFor ? { service: serviceFor } : {}),
      // Written only when chosen, likewise: a writer's kept set's notes.
      ...(notesFor ? { notes: notesFor } : {}),
      ...(extra ?? {}),
      at: new Date().toISOString() });
  } catch {
    return { ok: false, code: "unavailable" };
  }
  let decision, bound;
  try {
    // WHERE THE SET IS BOUND (MC-18 stage 2): the live guest on the ask's
    // service, else on the house's default — shown on the row while it
    // waits; the claim stamps where the write really goes. None for an
    // ask of a DJ who holds a preset, for the archive, and for every ask
    // while no guest is live, which leaves this call as it was.
    // Since stage 3, the lookup every door makes (destinationFor).
    bound = archiveAsk ? null : destinationFor(env, dj, setService(env, { asked: serviceFor }));
    if (bound && !dj.button && !bound.guest) return { ok: false, code: "nowhere", catalog: setService(env, { asked: serviceFor }) };
    const destination = bound?.guest ? bound.pl.id : null;
    decision = await station(env, "submit",
      { id, dj: archiveAsk ? ARCHIVE.dj : slugKey, normalized, ...(destination ? { destination } : {}) });
  } catch {
    return { ok: false, code: "unavailable" };
  }
  if (!decision?.ok) {
    return { ok: false, code: decision?.code === "duplicate" ? "already"
      : decision?.code === "outstanding" ? "busy"
      : decision?.code === "household-cap" ? "full" : "unavailable" };
  }
  // The wake-up event, after record and row both exist — and only while
  // autofulfillment is switched on, which is a SEPARATE switch from the
  // composer's: requests can be collected quietly before any Claude is
  // wired to answer them. A failed emit is flagged on the record and the
  // request stays honestly pending for the hourly sweep.
  if (env.AUTOFULFILL_ENABLED === "true") {
    const ring = (async () => {
      const emitted = await emitRequestEvent(env, id);
      if (!emitted) {
        try {
          // Re-put on the SHORT clock on purpose — the record is
          // milliseconds old and still pending. This spread-and-flag
          // pattern must never be copied to a post-settle path, where it
          // would silently shrink 90 days to 30.
          const rec = await getRequestRecord(env, id);
          if (rec) await putRequestRecord(env, { ...rec, dispatch: "failed" });
        } catch { /* the sweep needs no flag; this is for the operator */ }
      }
    })();
    // Behind the visitor's redirect when the platform allows; inline in
    // the node tests, which call fetch without a ctx and assert on the
    // emit deterministically.
    if (ctx?.waitUntil) ctx.waitUntil(ring);
    else await ring;
  }
  const btn = archiveAsk ? house(env).archive?.btn ?? null : dj.button ?? bound?.guest?.btn ?? null;
  return { ok: true, code: "sent", id, btn, catalog: archiveAsk ? null : bound?.pl?.catalog ?? null };
}

// The length said aloud, onto the form's four: the nearest, a tie going up
// (45 is an hour), an hour when nothing usable was said (MC-36's default 4).
export function askMinutes(said) {
  const n = Number(said);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return ASK_LENGTHS.reduce((best, m) => (Math.abs(m - n) <= Math.abs(best - n) ? m : best));
}
export const LENGTH_WORDS = { 30: "half an hour", 60: "an hour", 90: "an hour and a half", 120: "two hours" };

// WHAT WAS PLAYING, as the start compares it (MC-36, the plan's default 3):
// Spotify's context while it plays ("tracks" for a queue with none), and the
// named speaker's own source while the home helper hears it play something
// that is not Spotify, with its playlist or station when it names one. A
// song changing inside either is the same music going on.
export function playingMark(st, reading) {
  const spotify = st?.is_playing === true && st?.item ? String(st.context?.uri || "tracks") : null;
  const own = reading?.state === "play" && reading.source && !/^spotify/i.test(reading.source)
    ? [reading.source, reading.playlist ?? reading.station ?? ""].join("|").toLowerCase() : null;
  return { spotify, speaker: own };
}
// Why the set must not start: something other than what played at the ask
// is playing now, so somebody chose it. Its own playlist is not other music.
export function startedSince(before, now, own) {
  if (now.spotify && now.spotify !== before.spotify && now.spotify !== own) return "something else is playing on Spotify";
  if (now.speaker && now.speaker !== before.speaker) return "the speaker is playing something else";
  return null;
}
// The house's player and the speaker's reading, for the mark: the kept answer
// where it may be used at the ask, a fresh read when the set lands. Null when
// Spotify could not be read, which the start takes as not knowing.
async function markNow(env, device, { fresh = false } = {}) {
  const got = await helperGot(env);
  let st;
  try { st = fresh ? await playerState(env) : await housePlayer(env, { got }); } catch (e) { if (e?.budgetExhausted) throw e; return { got, mark: null }; }
  return { got, mark: playingMark(st, helperViewOf(env, got).lan?.speakers?.[device] ?? null) };
}
// A Tidal set starts only through the home helper, on a WiiM (the owner's
// change to default 6, 2026-10-31): the WiiM it would start on, or why not.
function tidalStart(env, got, device) {
  const box = parseSpeakers(env).find((b) => fold(b.name) === fold(device)) ?? null;
  if (!box) return { why: `the ${device} is not a WiiM, and only a WiiM's preset plays Tidal` };
  if (!helperViewOf(env, got).lan?.hands) return { why: "the home helper is off, and only it can start Tidal" };
  return { box };
}
export const onWords = (device) => (/^everywhere$/i.test(device) ? "everywhere" : `on the ${device}`);

// TALK TAKES THE ORDER (MC-36). A set asked of a DJ by voice is filed through
// the form's door, so the curator makes it and the person can hang up the
// moment it is filed. Only in a house whose asks are on and whose curator is
// woken for them (askDjOn, the plan's default 5); the answer carries the one
// line Talk says. The speaker and what was playing ride the record, so the
// set starts there when it lands (startAsked, deploy 2). House radio files
// through here too (MC-38 stage 3): `via` "alexa" on its record, "talk" for
// anything else, so the ledger says which voice asked.
export const VOICE_VIA = ["talk", "alexa"];
// WHAT A LOG LINE SAYS OF A VOICE CALL (Codex's review, 2026-11-11): a
// listener's words are theirs, and a log is read by whoever holds the
// Cloudflare account, or is passed on with a problem. So the line names the
// tool's choices (a DJ, a speaker, a number, a switch) and, of anything said
// in free words, only how long it was: "" still shows as 0, which is how
// Talk's habit of filling every field was found.
const LOG_PLAIN = new Set(["dj", "device", "speaker", "to", "from", "via", "service", "when", "action", "notes", "catalog", "preset", "button"]);
export function logArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = typeof v === "number" || typeof v === "boolean" || v == null ? v
      : Array.isArray(v) ? `[${v.length}]`
      : typeof v === "string" ? (LOG_PLAIN.has(k) ? v.slice(0, 40) : `<${v.length} chars>`)
      : "<object>";
  }
  return JSON.stringify(out).slice(0, 160);
}
export async function askByVoice(env, ctx, args = {}) {
  if (!askDjOn(env)) {
    throw new Error("This house has no curator taking asks, so a set is made on the call: get_dj, search_tracks, " +
      "then replace_playlist.");
  }
  // The name was heard, not typed: "DJ Pup Rock" is Pub Rock (findSpokenDj).
  const dj = findSpokenDj(env, args.dj);
  // NO SUCH DJ, AND WHO THERE IS, in the same answer: the backend asks again
  // at once with the one that was meant, so the ask stays one chain of work
  // and a hang-up waiting on it still sees it through (2026-11-05, "DJ Sol").
  if (!dj) {
    throw new Error(`No DJ named "${clean(args.dj).slice(0, 60) || "(nobody)"}". The DJs: ` +
      `${house(env).roster.map((d) => d.name).join(", ")}. Ask again with the one that was meant; ask the person only if none is near.`);
  }
  if (!reachableDj(env, dj)) {
    throw new Error(`${dj.name}'s sets are the house's own recordings: that is search_archive and play_archive.`);
  }
  const minutes = askMinutes(args.minutes);
  const keep = args.keep === true;
  // A writer's kept set says which notes; unsaid, the house's default.
  const notes = keep && writerKindFor(env, dj)
    ? (["short", "long"].includes(args.notes) ? args.notes : env.REQUEST_NOTES === "long" ? "long" : "short") : null;
  const device = args.device ? String(args.device) : null;
  const { got, mark } = device ? await markNow(env, device) : { got: null, mark: null };
  const out = await fileAsk(env, ctx, { slug: dj.key, mood: args.words, length: minutes, avoid: args.avoid, keep, notes,
    service: args.service, extra: { via: VOICE_VIA.includes(args.via) ? args.via : "talk",
      ...(device ? { device } : {}), ...(mark ? { playing: mark } : {}) } });
  if (out.refuse) throw new Error(out.refuse.say);
  const n = out.btn;
  const shelf = keep ? " It goes on the Shelf as well." : "";
  const tidal = out.catalog === "tidal" && device ? tidalStart(env, got, device) : null;
  const said = {
    // Measured: Vibe's typed ask 2 min 23 s (2026-10-22), Sessions' by voice
    // 4 min (2026-11-05, ChatGPT the curator).
    sent: device && (!tidal || tidal.box)
      ? `${dj.name}'s on it: ${LENGTH_WORDS[minutes]}, starting ${onWords(device)} in about five minutes, unless ` +
        `something else is started before then. It goes on preset ${n}, in place of the set there.${shelf} You can hang up.`
      : `${dj.name}'s on it: ${LENGTH_WORDS[minutes]} on preset ${n} in about five minutes, in place of the set there. ` +
        `Press ${n} to hear it${tidal?.why ? `: ${tidal.why}` : ""}.${shelf} You can hang up.`,
    already: "You just asked for that; it's on its way.",
    busy: `${dj.name} is still making the last set you asked for.`,
    full: "The house has too many sets waiting; try again in a few minutes.",
    nowhere: `There's no Requests preset for ${guestLabel(out.catalog)} sets, so there's nowhere for it to go.`,
    blank: "What should the set be? Ask again with a mood, a subject or an occasion.",
    unavailable: "The house couldn't take the ask just now; try again in a moment.",
  }[out.code];
  return { status: out.code, dj: dj.name, minutes, ...(out.code === "sent" ? { preset: n, id: out.id } : {}),
    ...(tidal ? { tidal: !!tidal.box } : {}), said };
}

// THE START WHEN IT LANDS (MC-36, deploy 2). A set asked by voice starts on
// the speaker it named, once fulfil_request has written and recorded it: best
// effort, never undoing or redoing the write. Only while the ask is new
// (START_FRESH_MS, the window an endless opening uses), only while the
// preset still holds this set (the commit rings the next ask waiting on it),
// and only when nothing else has started playing since the ask — Spotify
// plays one thing on the account, so a start would stop whatever somebody
// chose. Tidal through the home helper, on a WiiM. Answers null when nothing
// was asked to start, else { started_on } or { not_started, why }.
// The calls a start can spend, reserved before the claim: the player read,
// the speaker list, shuffle and repeat, the play and its two wake retries,
// the read-back and its own retry.
export const ASK_START_CALLS = 13;
export function asksToStart(record, now = Date.now()) {
  return !!record?.device && now - (Date.parse(record.at) || 0) <= START_FRESH_MS;
}
export async function startAsked(env, { requestId, record, pid, catalog, btn, name, budget, now = Date.now() }) {
  const device = record?.device ? String(record.device) : null;
  if (!device) return null;
  const no = (why) => ({ not_started: device, why });
  if (!asksToStart(record, now)) return no("it was asked more than 25 minutes ago");
  let pointer = null;
  try { pointer = await programsKV(env).get(`ask:${pid}`, { type: "json" }); } catch { pointer = null; }
  if (pointer?.requestId !== requestId) return no("another set has landed on the preset since");
  if (!record.playing) return no("what was playing when it was asked is not known");
  const { got, mark } = await markNow(env, device, { fresh: true });
  if (!mark) return no("Spotify could not be read, so whether something else started is not known");
  const since = startedSince(record.playing, mark, `spotify:playlist:${pid}`);
  if (since) return no(since);
  if (catalog === "tidal") {
    const t = tidalStart(env, got, device);
    if (!t.box) return no(t.why);
    let code = "failed";
    try { code = await helperPress(env, t.box, btn); } catch { code = "failed"; }
    return code === "ok" ? { started_on: t.box.name } : no(`the home helper could not press ${btn} (${code})`);
  }
  try {
    const out = await startPlaylistOnDevice(env, { id: pid, name, catalog: "spotify" }, device, budget);
    // A start Spotify took but did not confirm is still a start, marked so
    // (MC-38 stage 3, Codex's recheck): the ask's trace keeps it apart.
    return out.preset_safe ? { started_on: device } : out.unverified ? { started_on: device, unverified: true }
      : no("Spotify took the start, but the set is not playing there");
  } catch (e) {
    if (sleptThrough(e)) return no("the speaker did not answer: it is asleep");
    return no(`Spotify refused the start (${String(e?.message ?? e).slice(0, 80)})`);
  }
}
