// WHAT IS PLAYING AND WHERE (MC-21, MC-25, MC-28): the player in words, the
// home helper's readings, the one answer every page reads (nowAnswer), the bar's
// pause note, and the one rule for which speaker (pickFor).
// Split out of worker.js on 2026-09-26 (consolidation).
import { waitWords, serviceLink, PICK_FIRM_S } from "./programs.js";
import { station } from "./station.js";
import {
  atWords, endlessNamed, findDj, guestFor, guestHolders, houseClockWords, ownPresetKeys, playingFromWords, speakerPresetFor,
} from "./house.js";
import { parseRoomDevices, parseSpeakers, readReadings, roomRoster, speakerSlug, wiimNames } from "./room.js";
import {
  PLAYER_SAVED, SIGNED_OUT_WORDS, fold, forgetPlayer, minutesLeft, parseAliases, playerState, programsKV, recalledPlayer,
  rememberPlayer, currentSignedOut, spotifyLogin,
} from "./services.js";

// The account's player, reduced to what the page may honestly claim. Returns
// null when nothing is PLAYING — paused counts as quiet, because the line
// exists to warn whose stream a Play press would take.
export function roomPlaying(st) {
  if (!st?.item || st.is_playing !== true) return null;
  const ctx = String(st.context?.uri ?? "");
  const m = ctx.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  return {
    track: st.item.name,
    artists: (st.item.artists ?? []).map((a) => a.name).join(", "),
    device: st.device?.name ?? null,
    uri: st.item.uri ?? null,
    pid: m ? m[1] : null,
    // WHICH kind of context, not merely whether it was one of ours. `context:
    // null` means nobody is curating and is worth saying; an album or a
    // playlist this page does not configure is somebody curating something
    // else, and calling that a bare queue was a claim the player contradicts.
    kind: ctx.match(/^spotify:([a-z]+)/)?.[1] ?? null,
    // The sleeve, for the now panel (2026-09-25, design A): the smallest
    // picture of at least 64 px, already in the read.
    art: sleeveOf(st.item),
    // THE BIG SLEEVE (the owner, 2026-10-13, design A of
    // docs/design/now-sleeve): the panel draws it 310 px wide, so the 640
    // from the same read; the album's name under the song; and where the
    // song is, as of the read (`readAt`, stamped by playerState), for the
    // panel's progress line. No extra call.
    sleeve: sleeveOf(st.item, 600),
    album: st.item.album?.name || null,
    ...(posOf(st) ? { pos: posOf(st) } : {}),
  };
}
export function sleeveOf(item, min = 64) {
  const imgs = (item?.album?.images ?? item?.images ?? []).filter((i) => /^https:\/\/i\.scdn\.co\//.test(String(i?.url ?? "")));
  const fit = imgs.filter((i) => !(Number(i.width) < min)).sort((a, b) => (Number(a.width) || 0) - (Number(b.width) || 0));
  return (fit[0] ?? imgs[0])?.url ?? null;
}
function posOf(st) {
  const ms = Number(st?.progress_ms), of = Number(st?.item?.duration_ms), at = Number(st?.readAt);
  return Number.isFinite(ms) && of > 0 && at > 0 ? { ms, of, at } : null;
}

// THERE IS NO "PAUSED" (2026-09-22, the owner's choice 1 after
// tasks/done/stale-pause-codex-review.md). MC-20 mapped a session Spotify holds
// with is_playing false as "paused", drew it as the speaker sitting idle,
// and offered a play disc. Then the owner pressed preset 11 on the Pro
// Plus: it played Americana over Tidal, and Spotify -- told nothing --
// kept reporting the speaker active and paused on preset 8. No field this
// Worker can reach tells those apart; the one that would (the WiiM's own
// mode 31 for Spotify Connect) is on the LAN. So a paused session is drawn
// as what it honestly is from here: nothing Spotify can be SEEN playing.
// roomPlaying already says exactly that, and every page maps with it.
// THE PLAYING RECORD'S DOOR (2026-09-23, the song-link canvas, A): its
// open.spotify.com address, from the uri the player read already carries.
// No call; null for anything that is not a Spotify track or episode.
export function songLink(uri) {
  const m = /^spotify:(track|episode):([A-Za-z0-9]+)$/.exec(String(uri ?? ""));
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null;
}
// The playlist the record plays from, the same way: its id is in the read.
export function listLink(pid) {
  return /^[A-Za-z0-9]{22}$/.test(String(pid ?? "")) ? `https://open.spotify.com/playlist/${pid}` : null;
}
// THE HOME HELPER (MC-25, tasks/done/mc25-home-helper.md). A small program on
// the house's Chromebook reads each WiiM over the LAN (getPlayerStatus) and
// posts what it read here, because this Worker has no route into the home
// and Tidal tells no server what plays. With a fresh reading the bar and the
// Speakers page can say "Pro Plus · Tidal"; without one they say what they
// always said. Read-only in stage 1: nothing here sends the helper anything.
export const HELPER_FRESH_MS = 150_000;   // the helper posts at least every 60 s
export const HELPER_STATES = ["play", "pause", "stop", "idle", "unreachable"];
export function parseHelperReading(env, body) {
  const boxes = parseSpeakers(env);
  const clip = (v, n) => (v == null ? null : String(v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) || null);
  const out = {};
  for (const r of Array.isArray(body?.speakers) ? body.speakers.slice(0, 8) : []) {
    const box = boxes.find((b) => fold(b.name) === fold(r?.name));
    const state = String(r?.state ?? "");
    if (!box || !HELPER_STATES.includes(state)) continue;
    const source = clip(r.source, 24);
    const playlist = /^[A-Za-z0-9]{10,40}$/.test(String(r.playlist ?? "")) ? String(r.playlist) : null;
    out[box.name] = { state, ...(source && /^[\w .&'’+-]+$/.test(source) ? { source } : {}),
      ...(playlist ? { playlist } : {}),
      // A radio station's name, as its preset is named (2026-10-03).
      ...(clip(r.station, 80) ? { station: clip(r.station, 80) } : {}),
      ...(clip(r.track, 200) ? { track: clip(r.track, 200) } : {}),
      ...(clip(r.artists, 200) ? { artists: clip(r.artists, 200) } : {}),
      ...(qualityIn(r.quality, source) ? { quality: qualityIn(r.quality, source) } : {}) };
  }
  return Object.keys(out).length ? out : null;
}
// A stream's quality (2026-10-25): the speaker's own numbers as the helper
// read them, sample rate in Hz, bit depth and kilobits a second (0 when the
// speaker does not say). Never the archive's: its getMetaInfo runs a song
// ahead, and the owner said skip it.
function qualityIn(q, source) {
  if (!q || typeof q !== "object" || /^custom/i.test(String(source ?? ""))) return null;
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const rate = int(q.rate, 8000, 768000), bits = int(q.bits, 8, 32), kbps = int(q.kbps, 0, 20000);
  return rate ? { rate, ...(bits ? { bits } : {}), kbps: kbps ?? 0 } : null;
}
// What the pages may say from the helper: its speakers while the reading is
// fresh, and whether it is on at all — only in a house that has one.
export async function helperView(env, now = Date.now()) {
  return helperViewOf(env, await helperGot(env), now);
}
// The ledger's one answer for the helper: its reading, its line, and the
// house's kept Spotify answer (MC-29). Null in a house with no helper.
export async function helperGot(env) {
  if (!env.HELPER_SECRET) return null;
  try { return await station(env, "helper-get", {}, { unbudgeted: true }); } catch { return null; }
}
export function helperViewOf(env, got, now = Date.now()) {
  if (!env.HELPER_SECRET) return {};
  const doc = got?.doc ?? null;
  // Every claimed house has the helper's key; one that never ran a helper
  // has none to miss (the trial, 2026-10-17: "Home helper off … on the
  // Chromebook" on a forum house).
  if (!doc && !got?.hands) return {};
  const at = Number(doc?.at) || 0;
  // Off, with when it was last heard in the house's clock: the house mark's
  // card says "Last heard at 21:14" (2026-10-22).
  if (!at || now - at > HELPER_FRESH_MS || !doc.speakers) {
    const heard = at ? atWords(houseClockWords(env, new Date(at).toISOString(), now)) : null;
    return { helper: "off", ...(heard ? { helperHeard: heard } : {}) };
  }
  return { helper: "on", lan: { at, speakers: doc.speakers, ...(got?.hands ? { hands: true } : {}) } };
}

// ASK THE HELPER BEFORE ASKING SPOTIFY (MC-29, tasks/done/mc29-helper-first-player.md;
// the owner, 2026-09-28: the pages' 30-second checks were 450 of 924 calls).
// The house's kept Spotify answer is handed to a page instead of a new read
// while all of these hold:
//   1. the helper's reading is fresh (helper off: every ask reads, as before);
//   2. the WiiMs have read the same since the answer was kept (`changedAt`);
//      a playback write forgets the answer outright (spotify(), services.js);
//   3. a playing answer is not past its song's end;
//   4. under the cap for where the music is: 5 minutes on a WiiM (the helper
//      would have seen a change), 30 seconds anywhere else (an Echo, the
//      phone: no later than the pages' own check, the owner's D1), 2 minutes
//      when nothing plays (D2); never past 5 minutes (D3).
export const PLAYER_REUSE_MAX_MS = 5 * 60_000;
export const PLAYER_REUSE_ELSEWHERE_MS = 30_000;
export const PLAYER_REUSE_QUIET_MS = 2 * 60_000;
export function playerReusable(kept, doc, wiims, now = Date.now()) {
  const keptAt = Number(kept?.at) || 0;
  const at = Number(doc?.at) || 0;
  if (!keptAt || !at || now - at > HELPER_FRESH_MS || !doc.speakers) return false;
  if ((Number(doc.changedAt) || at) >= keptAt) return false;
  const age = now - keptAt;
  if (age < 0 || age > PLAYER_REUSE_MAX_MS) return false;
  const st = kept.st;
  if (!(st && st.item && st.is_playing === true)) return age <= PLAYER_REUSE_QUIET_MS;
  const left = Number(st.item.duration_ms) - Number(st.progress_ms);
  if (Number.isFinite(left) && now >= keptAt + left) return false;
  return (wiims ?? []).some((n) => fold(n) === fold(st.device?.name)) || age <= PLAYER_REUSE_ELSEWHERE_MS;
}
// The player for a page: the kept answer when it may be used, a Spotify read
// otherwise (which keeps itself). `fresh` always reads; so does a house with
// no helper, or with PLAYER_REUSE = "off" (MC-29's switch, house.json
// `player.reuse: false`). `got` is the ledger's answer when the caller
// already has it; `share` lends the read to this isolate's next ten seconds. Each answer handed out instead of a read is tallied as
// `player-saved`, which the Use page shows and leaves out of the total.
export async function housePlayer(env, { fresh = false, deadlineMs = 0, got, share = false } = {}) {
  const saved = () => { const t = env.__spotifyTally; if (t) t.set(PLAYER_SAVED, (t.get(PLAYER_SAVED) ?? 0) + 1); };
  if (!fresh) {
    // This isolate's own read of the last ten seconds, in flight or done.
    const memo = recalledPlayer(env);
    if (memo) { saved(); return memo; }
    if (env.HELPER_SECRET && env.PLAYER_REUSE !== "off") {
      const g = got === undefined ? await helperGot(env) : got;
      const kept = g?.player;
      if (kept && playerReusable(kept, g?.doc, parseSpeakers(env).map((b) => b.name))) { saved(); return kept.st; }
    }
  }
  const read = playerState(env, { deadlineMs });
  // Only a read the page will ask about again at once is shared in the
  // isolate (`share`, the presets page going out before Spotify answers).
  if (share) rememberPlayer(env, read);
  return read;
}

// WHERE A PAGE'S HELPER PRESS GOES (MC-25): key `btn` on the WiiM the phone
// picked, or the house's default one when the pick is an Echo or the phone —
// the button says which. Only while the helper's line is open, and not on a
// speaker whose reading shows nothing saved on that key.
// The WiiM is the one speaker (MC-28, pickFor) when that is a WiiM; `p` is
// the player when the page read it, else the memo stands in (pickCheap).
export async function helperKeyFor(env, request, btn, p = undefined) {
  if (!Number.isInteger(btn) || btn < 1 || btn > 12) return null;
  const hv = await helperView(env);
  if (!hv.lan?.hands) return null;
  const boxes = parseSpeakers(env);
  const pick = (p === undefined ? await pickCheap(env, request, hv) : pickFor(env, request, p, hv.lan))?.name ?? null;
  const box = boxes.find((b) => b.name === pick) ?? boxes.find((b) => b.name === env.DEFAULT_DEVICE) ?? boxes[0];
  if (!box) return null;
  const rows = (await readReadings(env, [box]))[box.slug]?.presets;
  if (Array.isArray(rows) && !rows.some((r) => r.btn === btn)) return null;
  // `elsewhere`: the phone picked another speaker (an Echo, the phone), so
  // the button must say where it plays.
  return { btn, on: box.name, slug: box.slug, ...(pick && pick !== box.name ? { elsewhere: pick } : {}) };
}
// The Shelf's Tidal Play (MC-25): the Tidal guest's number while the helper
// can press it, so the set on that guest gets a Play like a Spotify one.
export async function shelfTidalKey(env, request) {
  const tg = guestFor(env, "tidal");
  const hk = tg?.live ? await helperKeyFor(env, request, tg.btn) : null;
  return hk ? { tidalBtn: hk.btn } : {};
}
// A helper press, and its read-back kept as the speaker's newest word.
export async function helperPress(env, box, n) {
  return (await helperCommand(env, { cmd: "key", n, speaker: box.name })).code;
}
export async function helperPause(env, box) {
  return (await helperCommand(env, { cmd: "pause", speaker: box.name })).code;
}
// The same, with the speaker's read-back as the house parsed it, for a
// caller that must check what actually started (the radio's move).
export async function helperCommand(env, cmd) {
  let code = "failed", heard = null;
  try {
    const out = await station(env, "helper-command", cmd);
    code = out?.ok ? "ok" : ["helper-off", "timeout", "unreachable"].includes(out?.code) ? out.code : "failed";
    // A key can take the speaker off Spotify, and the reading takes seconds
    // to show it (MC-29): the kept answer goes with the press.
    if (out?.ok && cmd.cmd === "key") await forgetPlayer(env);
    const one = out?.reading ? parseHelperReading(env, { speakers: [out.reading] }) : null;
    if (one) {
      heard = one[cmd.speaker] ?? null;
      const doc = (await station(env, "helper-get", {}))?.doc ?? {};
      await station(env, "helper-put", { doc: { at: Date.now(), speakers: { ...(doc.speakers ?? {}), ...one } } });
    }
  } catch { code = "failed"; }
  return { code, heard };
}

// THE RADIO'S KEY ON ANOTHER WIIM (2026-10-03): the preset saved under the
// station's name in that speaker's own table, or null. A station is never a
// Spotify or Tidal preset, and two keys of one name say nothing about which
// (Codex's review, 2026-10-09): exactly one, or none.
export function stationKey(rows, name) {
  const s = fold(String(name ?? ""));
  if (!s) return null;
  const hits = (Array.isArray(rows) ? rows : []).filter((p) => fold(String(p?.name ?? "")) === s &&
    !/^(spotify|tidal)$/i.test(String(p?.source ?? "")));
  return hits.length === 1 ? hits[0].btn : null;
}
export function sameStation(a, b) {
  const x = fold(String(a ?? ""));
  return !!x && x === fold(String(b ?? ""));
}

// THE SHELF PROGRAM PLAYING AS ITS OWN TRACKS (the owner, 2026-09-24: a
// program played from the Shelf and paused from the bar had a dim disc, and
// every page called it "a queue of tracks"). Such a play has no playlist, so
// nothing Spotify reports says which program it is, and the bar's play-again
// had nothing to start. The Shelf's Play writes down what it started; a
// queue whose song is on that list is that program — named as it, and its
// pause keeps the rest of the list, so play-again starts it where it
// stopped. KV only, no Spotify call. Any other queue stays a queue.
export const SHELF_QUEUE_KEY = "queue:shelf";
export const SHELF_QUEUE_TTL_S = 12 * 60 * 60;
export async function shelfQueueFor(env, p) {
  if (!p || p.pid || !p.uri) return null;
  try {
    const rec = await programsKV(env).get(SHELF_QUEUE_KEY, { type: "json" });
    return rec && Array.isArray(rec.uris) && rec.uris.includes(p.uri) ? rec : null;
  } catch {
    return null;
  }
}
// WITH ITS DJ (the owner chose A, 2026-10-10: a Shelf Play showed no DJ and
// no preset). The Shelf's Play writes the DJ's key beside the list; a record
// from before that has none, and is said as it was.
export const shelfDj = (env, rec) => (rec?.dj ? findDj(env, rec.dj) : null);
export const programWords = (rec, name = null) =>
  name ? `${name} \u00b7 \u201c${rec.title}\u201d` : `the program \u201c${rec.title}\u201d`;
export async function playingFromFor(env, p) {
  const rec = await shelfQueueFor(env, p);
  return rec ? programWords(rec, shelfDj(env, rec)?.name) : playingFromWords(env, p);
}
// THE TIDAL REQUEST, HEARD BY THE HOME HELPER (the owner, 2026-09-26: Monk's
// Tidal set playing on the Pro Plus and the Loaded tab silent). Tidal names
// no playlist to a WiiM, so the song the helper read is looked for in the
// set on the Tidal guest — its program's tracks, one KV read, only while a
// WiiM reads Tidal. A match lights that band; no match claims nothing.
export async function lanOnGuest(env, lan, holders) {
  const reads = Object.entries(lan?.speakers ?? {}).filter(([, r]) => (r?.state === "play" || r?.state === "pause")
    && /tidal/i.test(String(r.source ?? "")) && r.track);
  if (!reads.length) return null;
  const g = guestFor(env, "tidal");
  const ref = holders?.tidal?.on?.ref;
  if (!g?.live || !/^[a-z0-9-]{1,64}$/.test(String(ref ?? ""))) return null;
  let rec = null;
  try { rec = await programsKV(env).get(`program:${ref}`, { type: "json" }); } catch { return null; }
  const fold = (t) => String(t ?? "").toLowerCase().replace(/\s*[-(\[].*$/, "").replace(/[^a-z0-9]+/g, "");
  const titles = new Set((rec?.sections ?? []).flatMap((sec) => sec?.tracks ?? []).map((t) => fold(t?.title)).filter((t) => t.length >= 3));
  const hit = reads.find(([, r]) => titles.has(fold(r.track)));
  const who = findDj(env, holders?.tidal?.on?.dj)?.name ?? null;
  return hit ? { btn: g.btn, speaker: hit[0], state: hit[1].state, track: String(hit[1].track).slice(0, 120), ...(who ? { name: who } : {}),
    ...(hit[1].artists ? { artists: String(hit[1].artists).slice(0, 120) } : {}) } : null;
}
// A WiiM STOPPED OR PAUSED ON SPOTIFY, NAMED (the owner, 2026-09-29, 12:01:
// the WiiM app showed the Ultra on Spotify, stopped at Uptown Funk from
// preset 1, and the Speakers page said "Nothing Spotify can see"). Spotify
// lets go of a speaker that sits stopped, but the speaker still names the
// playlist it was on, and the preset that playlist is rides on the reading
// (presetOfList, the playing answer's own rules). KV only, and only for
// such a reading.
export async function lanNamed(env, hv, recs = {}) {
  const speakers = hv?.lan?.speakers;
  const rest = Object.entries(speakers ?? {}).filter(([, r]) => (r?.state === "pause" || r?.state === "stop")
    && /^spotify/i.test(String(r.source ?? "")) && r.playlist);
  if (!rest.length) return hv;
  const out = { ...speakers };
  for (const [name, r] of rest) {
    const p = { pid: r.playlist, device: name };
    const { band, guestBand, preset } = await presetOfList(env, p, recs);
    // And for the panel (2026-10-12): the playlist in Spotify, and whose set
    // it is — the DJ row a playing set gets, from the same records.
    const who = await playingWho(env, p, preset, band ?? guestBand);
    // Endless or not rides along, so the bar and the block can say so (2026-10-13).
    out[name] = { ...r,
      ...(preset?.name ? { preset: { btn: preset.btn, name: preset.name, ...(preset.lane ? { lane: true } : {}),
        ...(preset.endless ? { endless: true } : {}) } } : {}),
      ...(listLink(r.playlist) ? { list: listLink(r.playlist) } : {}),
      ...(who ? { who } : {}) };
  }
  return { ...hv, lan: { ...hv.lan, speakers: out } };
}
// WHO AND WHAT, FOR THE NOW PANEL'S DJ ROW (2026-09-25, design A): the DJ
// on an endless preset, the DJ and program of a request on 1 or 2, a DJ's
// own key, or a Shelf program played as a queue. KV only; null when nothing
// names one, and the row is then left out.
export async function playingWho(env, p, preset, band = null, holders = null) {
  const named = (k) => (k && findDj(env, k)?.name) || null;
  const prog = async (slug) => {
    if (!/^[a-z0-9-]{1,64}$/.test(String(slug ?? ""))) return null;
    try {
      const rec = await programsKV(env).get(`program:${slug}`, { type: "json" });
      return rec?.title ? { slug, title: String(rec.title).slice(0, 120) } : null;
    } catch { return null; }
  };
  if (preset?.endless && preset.dj && named(preset.dj)) {
    return { dj: preset.dj, name: named(preset.dj), kind: preset.lane ? "guest" : "house", btn: preset.btn, endless: true,
      ...(preset.lane && preset.nearby ? { nearby: preset.nearby } : {}) };
  }
  if (band?.guest) {
    let on = null;
    try { on = (holders ?? await guestHolders(env))[band.catalog]?.on ?? null; } catch { on = null; }
    const program = await prog(on?.ref);
    return on?.dj || program ? { dj: named(on?.dj) ? on.dj : null, name: named(on?.dj), kind: "request", btn: band.btn,
      ...(program ? { program } : {}) } : null;
  }
  if (band?.key && named(band.key)) return { dj: band.key, name: named(band.key), kind: "preset", btn: band.btn };
  const shelf = p ? await shelfQueueFor(env, p) : null;
  if (shelf?.slug && shelf.title) {
    const d = shelfDj(env, shelf);
    return { dj: d?.key ?? null, name: d?.name ?? null, kind: "program", program: { slug: shelf.slug, title: String(shelf.title).slice(0, 120) } };
  }
  return null;
}
// WHICH PRESET A PLAYLIST IS, by its id: MC-21's rules, in one place since
// 2026-09-29, for a playing answer and for a WiiM the helper reads stopped on
// Spotify (lanNamed). `p` needs `pid`, and `device` for the speaker's own keys.
export async function presetOfList(env, p, recs = {}) {
  const band = p?.pid ? roomRoster(env).find((r) => r.zone === "wall" && r.key && r.button &&
    configuredPlaylistId(env, r.button) === p.pid) : null;
  // A live guest's band, by its playlist (MC-18 stage 4): it has no DJ.
  const guestBand = !band && p?.pid
    ? roomRoster(env).find((r) => r.guest && r.live && r.playlist === p.pid) ?? null : null;
  // A key of the playing speaker's own (MC-19 stage 3b), as its OWN field:
  // `btn` keeps meaning a band on the presets page, whose poll lights one
  // by it, so widening it would light nothing and print "not a preset"
  // there (Codex MC19-REVIEW-7f3a). Only the Speakers page reads this.
  const onKey = !band && !guestBand ? speakerPresetFor(env, recs, p) : null;
  // ONE PRESET FIELD, WITH ITS NAME (MC-21). `dj` is a key and `btn` a
  // number, so a client wanting to print "preset 8, The Selector" had to
  // reassemble the name from the roster — which the now bar, drawn on
  // pages that know nothing of the roster, cannot do. `preset` carries
  // both for all three kinds; `dj`, `btn`, `guest` and `speakerPreset`
  // are unchanged, because the Speakers page's poll reads them. An
  // endless preset's own playlist is that preset on any speaker, named
  // for who is on it now (endlessNamed).
  const preset = await endlessNamed(env, p, band ? { btn: band.btn, name: band.name ?? null }
    : guestBand ? { btn: guestBand.btn, name: guestBand.name ?? null }
    : onKey ? { btn: onKey.btn, name: onKey.name ?? null } : null);
  return { band, guestBand, preset };
}
// THE ONE ANSWER TO "WHAT IS PLAYING" (MC-28). The /playing route and every
// page's first paint build it here, so a page that polls and a page that
// paints say the same thing in the same shape. `p` is roomPlaying's object,
// null for quiet, or { unknown: true }; `recs` the speakers' readings;
// `note` the bar's own pause (pauseNoteBeside); `throttle` the time Spotify's
// limit ends. With a `request`, `pick` is the one speaker every page names
// (pickFor). KV and the ledger only: Spotify was read by the caller.
export async function nowAnswer(env, request, p, { recs = {}, holders = null, note = null, throttle = 0, hv = null } = {}) {
  hv = await lanNamed(env, hv ?? await helperView(env), recs);
  if (hv.lan && !holders) holders = await guestHolders(env);
  const lanBand = hv.lan ? await lanOnGuest(env, hv.lan, holders) : null;
  const also = { ...barSpeakers(env), ...hv, ...(lanBand ? { lanBand } : {}),
    ...(request ? { pick: pickFor(env, request, throttle ? { unknown: true } : p, hv.lan) } : {}) };
  if (throttle) {
    const mins = minutesLeft(throttle);
    // `mins` as a FIELD as well as inside the sentence (MC-21): the now
    // bar says "Not known for about N minutes" and must not have to read
    // a number out of prose to do it.
    return { ...also, state: "throttled", mins, notice: "Spotify is limiting this account's requests for about " +
      `${waitWords(mins)} more (quota exceeded) — what is playing cannot be read and Play would be refused until then` };
  }
  // SIGNED OUT (MC-31 stage 0b): a player that cannot be read because
  // Spotify ended the house's sign-in says that, on every tab's bar.
  if (p?.unknown && (await currentSignedOut(env))?.at) {
    return { ...also, state: "signedout", notice: SIGNED_OUT_WORDS };
  }
  // A NEW HOUSE (the practice install, 2026-10-19): before its first
  // Spotify sign-in the bar said "Can't reach Spotify right now".
  if (p?.unknown && !(await spotifyLogin(env).catch(() => ({ present: true }))).present) {
    return { ...also, state: "nologin", notice: "Spotify is not signed in yet: sign in on the setup page" };
  }
  if (p?.unknown) {
    return { ...also, state: "unknown", notice: "Spotify could not be reached just now — what is playing is " +
      "unknown from here, which is not the same as quiet" };
  }
  if (!p) {
    const paused = pausedFor(env, note);
    return { ...also, state: "quiet", ...(paused ? { paused } : {}) };
  }
  const { band, guestBand, preset } = await presetOfList(env, p, recs);
  const rooms = parseRoomDevices(env);
  // `endless` too (2026-10-13): the Speakers page's poll says "· endless" by it.
  const speakerPreset = !band && !guestBand && preset ? { btn: preset.btn, name: preset.name,
    ...(preset.autoplay ? { autoplay: true } : {}), ...(preset.lane ? { lane: true } : {}),
    ...(preset.endless ? { endless: true } : {}) } : null;
  const who = await playingWho(env, p, preset, band ?? guestBand, holders);
  return { ...also, state: "playing", dj: band?.key ?? null, btn: band?.btn ?? guestBand?.btn ?? null,
    ...(guestBand ? { guest: true } : {}),
    // The guest DJ on 3 (MC-27; 7 until 2026-09-30): the Loaded tab lights its band by this.
    ...(preset?.lane ? { lane: preset.btn } : {}),
    ...(speakerPreset ? { speakerPreset } : {}),
    ...(preset ? { preset } : {}),
    // Music on none of the bands says where it is from (2026-09-13).
    ...(band || guestBand ? {} : { from: await playingFromFor(env, p) }),
    track: p.track ?? null, artists: p.artists || null, device: p.device ?? null,
    ...(p.art ? { art: p.art } : {}), ...(p.sleeve ? { sleeve: p.sleeve } : {}), ...(p.album ? { album: p.album } : {}),
    // As read, not moved on: two polls on one kept read give one answer
    // (MC-29). The page counts on from `at`.
    ...(p.pos ? { pos: p.pos } : {}), ...(who ? { who } : {}),
    ...(songLink(p.uri) ? { song: songLink(p.uri) } : {}),
    ...(listLink(p.pid) ? { list: listLink(p.pid) } : {}),
    live: p.device && rooms.includes(p.device) ? p.device : null,
    // What the now bar's pause may name, by the transport route's rules.
    pausable: pausableSpeaker(env, p.device) };
}
// WHAT THE BAR'S PAUSE STOPPED (the owner, 2026-09-22, after pausing the
// Ultra from the bar: "once it's stopped there is no more title info … the
// disc becomes non functional"). Spotify's own "paused" cannot be believed —
// it survives the speaker moving to Tidal from the remote, which is why that
// state was removed (tasks/done/stale-pause-codex-review.md) — but the pause THIS
// SITE sent is a fact. So the pause writes down what it stopped, and while the
// room is quiet the bar says "Paused · <track>" — a claim about the press,
// not about the speaker now — and offers to start it
// again from there. That play is a fresh start, exactly a key's: if the
// speaker has gone to Tidal since, it takes the room back, as tapping the key
// would. Kept an hour; dropped once Spotify is seen playing anything, or when
// it is played again.
export const PAUSE_NOTE_KEY = "pause:last";
export const PAUSE_NOTE_MS = 60 * 60 * 1000;
export async function readPauseNote(env, now = Date.now()) {
  try {
    const n = await programsKV(env).get(PAUSE_NOTE_KEY, { type: "json" });
    return n && Number(n.at) > now - PAUSE_NOTE_MS ? n : null;
  } catch {
    return null;
  }
}
export async function dropPauseNote(env) {
  try { await programsKV(env).delete(PAUSE_NOTE_KEY); } catch { /* it expires anyway */ }
}
// A REWRITTEN PLAYLIST ENDS THE NOTE THAT POINTS AT IT (the owner,
// 2026-09-24). Monk was paused from the bar on preset 9; Sunny then took 9
// and two fresh sets replaced its list, and the bar still offered "Paused ·
// Monk" — whose play-again asked for a song no longer on the list, and
// Spotify played jazz of its own choosing under 9's name. The note names a
// place in a list, so a list replaced under it is a note about nothing.
// One KV read per write, and a delete only when it matches.
export async function dropPauseNoteFor(env, pid) {
  if (!pid) return;
  const note = await readPauseNote(env);
  if (note?.pid === pid) await dropPauseNote(env);
}
// The note a bar may show beside player state `p` (roomPlaying's shape): only
// while quiet. Spotify seen playing anything ends it, and the one KV write
// that costs happens then and only if a note exists; an unknown read decides
// nothing.
export async function pauseNoteBeside(env, p) {
  if (p?.unknown) return null;
  const note = await readPauseNote(env);
  if (note && p) {
    // Spotify's read lags the pause it just accepted by a second or so: the
    // same record on the same speaker, moments after, is that lag and not a
    // new play.
    const fold = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const lag = Date.now() - Number(note.at) < 15_000 && p.uri && p.uri === note.uri && fold(p.device) === fold(note.device);
    if (!lag) await dropPauseNote(env);
    return null;
  }
  return note;
}
// The note as the bar reads it: the words, and whether the disc may play it
// — a playlist, on a speaker the route will take.
export function pausedFor(env, note) {
  if (!note) return null;
  return { track: note.track ?? null, artists: note.artists ?? null, device: note.device ?? null,
    ...(songLink(note.uri) ? { song: songLink(note.uri) } : {}),
    ...(listLink(note.pid) ? { list: listLink(note.pid) } : {}),
    ...(note.preset ? { preset: note.preset } : note.from ? { from: note.from } : {}),
    again: !!((note.pid || note.uris?.length) && pausableSpeaker(env, note.device)) };
}

// The speaker the now bar's pause may name (MC-21): one the play form may
// name — the transport route's own check, so the bar never offers a press the
// route would refuse. Null dims the disc. Since 2026-09-23 any of the house's
// Spotify speakers, not only the WiiMs (the owner, playing a set on the
// Master Bedroom Echo): the pause is Spotify's, on the device Spotify names.
export function pausableSpeaker(env, device) {
  if (!device) return null;
  try {
    return parseRoomDevices(env).includes(device) ? device : null;
  } catch {
    return null;
  }
}
// WHICH SPEAKERS THE NOW BAR MAY SPEAK FOR (2026-09-23). `speakers` are the
// WiiMs, as before; `others` the rest of the play form's list — an Echo, the
// Alexa group — which Spotify reads the same way, with no presets and no
// reading. The bar resolves the phone's pick against both.
export function barSpeakers(env) {
  const boxes = parseSpeakers(env);
  // A door-made house's WiiMs are the ones named at setup (WIIM_NAMES);
  // one never asked has none known, as before.
  const speakers = boxes.length ? boxes.map(({ name, slug }) => ({ name, slug }))
    : env.WIIM_NAMES ? wiimNames(env).map((name) => ({ name, slug: speakerSlug(name) })) : [];
  // THE TIDAL GUEST'S DOOR (the owner, 2026-09-24, preset 2 playing: "Is
  // there anything the bar can do when Tidal is playing?"). Nothing: Tidal
  // has no way for a server to see or steer a speaker. But the bar's panel
  // can open the Tidal guest's playlist in the Tidal app, which is the way to
  // take that set to the phone. Config only, no call.
  const tg = guestFor(env, "tidal");
  const tidal = tg?.live && tg.playlist ? serviceLink("playlist", `tidal:playlist:${tg.playlist}`) : null;
  // A house with no WiiM addresses and presets of its own (MC-31): its bar
  // says the way back when a speaker is quiet, since its play stays dim.
  const ownKeys = !boxes.length && ownPresetKeys(env).length > 0;
  return { speakers, others: otherRooms(env).filter((n) => !speakers.some((sp) => sp.name === n))
    .map((name) => ({ name, slug: speakerSlug(name) })),
    ...(ownKeys ? { ownKeys: true } : {}),
    ...(tidal ? { tidal: { name: tg.name ?? "the Tidal guest", url: tidal.href } } : {}) };
}
// What a speaker is, for the words when it does not answer (shutWords): a
// WiiM signs off Spotify when idle, a phone is gone when its app is shut,
// an Echo stays listed and sleeps.
export function speakerKind(env, name) {
  if (!name) return null;
  const wiims = parseSpeakers(env).length || env.WIIM_NAMES ? wiimNames(env) : [];
  if (wiims.some((n) => fold(n) === fold(name))) return "wiim";
  return /phone/i.test(name) ? "phone" : "other";
}
// The play form's speakers that are not WiiMs.
export function otherRooms(env) {
  const boxes = parseSpeakers(env);
  return parseRoomDevices(env).filter((n) => !boxes.some((sp) => sp.name === n));
}

export function configuredPlaylistId(env, alias) {
  if (!alias) return null;
  const aliases = parseAliases(env);
  const key = Object.keys(aliases).find((k) => fold(k) === fold(alias));
  return key ? aliases[key].id : null;
}
export function pickedSpeaker(request, env) {
  const m = String(request.headers.get("cookie") ?? "").match(/(?:^|;\s*)spk=([a-z0-9-]{1,40})/);
  if (!m) return null;
  return parseRoomDevices(env).find((d) => speakerSlug(d) === m[1]) ?? null;
}
// A Play, a Form or a Start with no speaker named: the phone's last choice,
// else the house's default (MC-28). What is playing is not asked here — a
// form always names its speaker, and the page's picker already followed it.
export function speakerFor(request, env) {
  const rooms = parseRoomDevices(env);
  return pickedSpeaker(request, env)
    ?? (rooms.includes(env.DEFAULT_DEVICE) ? env.DEFAULT_DEVICE : null) ?? rooms[0] ?? null;
}
// What the helper can name that is a stream (its MODES, and the vendor names
// a WiiM reports for its services); the inputs — line-in, optical, HDMI,
// Bluetooth, USB — and an unnamed source are not.
const STREAMING = /^(tidal|qobuz|amazon|deezer|tunein|newtunein|iheart|radio|web stream|airplay|dlna|spotify|soundcloud|napster|pandora|calm radio|archive)/i;
// The one speaker without a Spotify read of its own: the house's kept
// answer while it may be used (MC-29), the helper's readings, the cookie.
// For pages that must not spend a Spotify call (the Shelf, Talk, the DJs tab).
export async function pickCheap(env, request, hv = null) {
  const got = await helperGot(env);
  const kept = got?.player;
  const memo = recalledPlayer(env);
  let p = { unknown: true };
  if (memo) { try { p = roomPlaying(await memo) ?? null; } catch { p = { unknown: true }; } }
  else if (kept && env.PLAYER_REUSE !== "off" && playerReusable(kept, got?.doc, parseSpeakers(env).map((b) => b.name))) {
    p = roomPlaying(kept.st) ?? null;
  }
  hv ??= helperViewOf(env, got);
  return pickFor(env, request, p, hv.lan);
}
// THE ONE RULE FOR "WHICH SPEAKER" (MC-28, the owner, 2026-09-26: "yes to
// all"; tasks/done/mc28-one-rule.md). Every page reads this answer, so the bar,
// the menu, the Speakers page and every "Plays on the" list name the same
// speaker:
//   1. chosen on purpose in the last half hour (the cookie's time stamp);
//   2. where the music is — Spotify first, then a WiiM the home helper hears
//      playing Tidal or the radio;
//   3. the last speaker chosen, however long ago;
//   4. the house's default.
// `why` tells the pages whether it was chosen or followed: a followed pick
// is written back to the phone unstamped, so it never outranks a tap.
export function pickFor(env, request, p = null, lan = null, now = Date.now()) {
  // The play form's speakers and the WiiMs, which the Speakers page draws.
  const rooms = [...new Set([...parseRoomDevices(env), ...parseSpeakers(env).map((b) => b.name)])];
  const as = (name, why) => ({ name, slug: speakerSlug(name), why });
  const m = request ? String(request.headers.get("cookie") ?? "").match(/(?:^|;\s*)spk=([a-z0-9-]{1,40})(?:\.(\d+))?/) : null;
  const chosen = m ? rooms.find((d) => speakerSlug(d) === m[1]) ?? null : null;
  if (chosen && m[2] && now / 1000 - Number(m[2]) < PICK_FIRM_S) return as(chosen, "chosen");
  const spot = p && !p.unknown && p.device ? rooms.find((d) => fold(d) === fold(p.device)) : null;
  if (spot) return as(spot, "music");
  const heard = Object.entries(lan?.speakers ?? {}).filter(([, r]) => r?.state === "play");
  const roomOf = (name) => rooms.find((d) => fold(d) === fold(name)) ?? null;
  // Spotify not known (its limit, an outage, a page that did not read it):
  // a WiiM the helper hears on Spotify stands in for Spotify's own word, so
  // the pick does not jump to the Tidal speaker for the length of a limit.
  if (p?.unknown) {
    const s = heard.find(([n, r]) => /^spotify/i.test(String(r.source ?? "")) && roomOf(n));
    if (s) return as(roomOf(s[0]), "music");
  }
  // Then a WiiM streaming something else. Only a stream counts as music
  // (the review, 2026-09-27): a WiiM left on the TV's optical or a line-in
  // reads "play" while silent, and would take the pick for good.
  for (const [name, r] of heard) {
    const room = STREAMING.test(String(r.source ?? "")) && !/^spotify/i.test(String(r.source ?? "")) ? roomOf(name) : null;
    if (room) return as(room, "music");
  }
  if (chosen) return as(chosen, "last");
  const dflt = rooms.find((d) => d === env.DEFAULT_DEVICE) ?? rooms[0] ?? null;
  return dflt ? as(dflt, "default") : null;
}
// Stamped with the time: a speaker a Play or a key chose holds over
// "where Spotify plays" for half an hour (pickFirm in the pages, 2026-09-26).
export const pickCookie = (device, now = Date.now()) =>
  `spk=${speakerSlug(device)}.${Math.floor(now / 1000)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
