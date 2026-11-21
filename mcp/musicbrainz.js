// THE HOUSE LOOKS AN ARTIST UP ITSELF (2026-10-24, the owner: "yes").
// A ChatGPT curator cannot reach MusicBrainz: its web tool obeys the site's
// robots rule (Disallow: /ws, for every crawler), and its own requests come
// back "Site Unavailable". So for Elliott Smith and J.J. Cale it made no
// folder. A Worker reaches it as well as a home does (37 of 45 calls,
// tasks/mb-from-cloudflare-test/): the API is MusicBrainz's door for apps
// that name themselves and ask about once a second, which the house does.
//
// The house makes the folder's base, by rule: the artist, the names they
// recorded under, and their studio albums with original years (steps 1 to 3
// of the curator's research). What needs judgment stays the curator's, sent
// with `discography` on top: the live albums that matter, a songwriter's
// songs. Off with ARTIST_LOOKUP="off".
import { artistLookupOn, programsKV, subrequest } from "./services.js";
import { cleanResearch, keepResearch, researchSlug } from "./endless.js";

export const MB_UA = "fmwax-house/1.0 ( https://fmwax.com )";
const MB = "https://musicbrainz.org/ws/2";
const SPACING_MS = 1100;
const BUSY_WAITS_MS = [1500, 3000];
const TIMEOUT_MS = 6000;
// A name that found nothing, or a MusicBrainz that would not answer, is not
// asked again for an hour: a curator calling twice does not double the wait.
const MISS_TTL_S = 3600;
// CODEX'S REVIEW (2026-10-24): list_requests waits on a Deep Dive lookup, and
// three calls with their retries could take a minute when MusicBrainz is slow.
// The whole lookup stops at twelve seconds (the measured ones took 3.5 to 6),
// never starts with less than ten of the invocation's subrequests left, and
// one already running for a name makes a second skip, not double the calls.
const DEADLINE_MS = 12000;
const BUDGET_RESERVE = 10;
const BUSY_TTL_S = 60;
const busyKey = (name) => `mbbusy:${researchSlug(name)}`;
const missKey = (name) => `mbmiss:${researchSlug(name)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The tests pass their own (env.__mbSleep), so a second's spacing costs them nothing.
const napOf = (env) => (typeof env?.__mbSleep === "function" ? env.__mbSleep : sleep);

// MusicBrainz saying it has no such thing (a 404), told apart from not
// answering (null): "no entry for this code" and "did not answer just now"
// are different sentences to a listener (the recording finder, 2026-11-12).
// A symbol, so the artist lookup's reads (`found?.artists`) see nothing in it,
// as they saw nothing in a null before.
export const MB_NONE = Symbol("musicbrainz has no entry");

// One call, with a second's spacing before it and two tries more after a
// "busy" (about one call in six, measured). Null when it will not answer.
// `cap`, when given, is shared by a caller that may send only so many
// requests in all, the tries after a busy included ({ left: 3 }).
async function ask(env, path, wait, deadline, cap = null) {
  const nap = napOf(env);
  for (let i = 0; i <= BUSY_WAITS_MS.length; i++) {
    const pause = i ? BUSY_WAITS_MS[i - 1] : wait;
    if (Date.now() + pause + 500 > deadline) return null;
    if (cap && cap.left <= 0) return null;
    await nap(pause);
    let r = null;
    if (cap) cap.left -= 1;
    try {
      r = await subrequest(env, `${MB}${path}`, { headers: { "user-agent": MB_UA, accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(500, Math.min(TIMEOUT_MS, deadline - Date.now()))) });
    } catch (e) { if (e?.budgetExhausted) throw e; r = null; }
    if (r?.ok) return r.json().catch(() => null);
    if (r?.status === 404) return MB_NONE;
    if (r && r.status !== 503) return null;
  }
  return null;
}

// The group names that carry the artist's own: the Charlie Hunter Trio, the
// Miles Davis Quintet. Never a band they were merely in (the Wailers).
const carries = (group, name) => researchSlug(group).includes(researchSlug(name));

// The base of a folder, by rule, or null. `name` is the artist as the curator
// or the listener wrote it.
export async function houseLookUp(env, name, { wait = 0, deadlineMs = env?.__mbDeadlineMs ?? DEADLINE_MS } = {}) {
  const asked = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!asked) return null;
  const deadline = Date.now() + deadlineMs;
  const q = encodeURIComponent(`artist:"${asked.replace(/"/g, "")}"`);
  const found = await ask(env, `/artist?query=${q}&fmt=json&limit=3`, wait, deadline);
  // MusicBrainz scores a match out of 100; under 90 is someone else.
  const artist = (found?.artists ?? []).find((a) => Number(a?.score) >= 90);
  if (!artist?.id) return null;
  const full = await ask(env, `/artist/${artist.id}?inc=aliases+artist-rels&fmt=json`, SPACING_MS, deadline);
  const groups = (full?.relations ?? [])
    .filter((r) => r?.type === "member of band" && r?.direction === "forward" && r?.artist?.id && carries(r.artist.name, artist.name))
    .map((r) => ({ id: r.artist.id, name: r.artist.name }))
    .filter((g, i, all) => all.findIndex((o) => o.id === g.id) === i).slice(0, 6);
  const names = [artist.name, ...(full?.aliases ?? []).map((a) => a?.name), ...groups.map((g) => g.name)];
  const ids = [artist.id, ...groups.map((g) => g.id)].map((id) => `arid:${id}`).join(" OR ");
  const rq = encodeURIComponent(`(${ids}) AND primarytype:album AND NOT secondarytype:compilation ` +
    "AND NOT secondarytype:live AND status:official");
  const rgs = await ask(env, `/release-group?query=${rq}&fmt=json&limit=100`, SPACING_MS, deadline);
  const seen = new Set();
  const albums = (rgs?.["release-groups"] ?? [])
    .map((g) => {
      const credit = g?.["artist-credit"]?.[0]?.artist?.name ?? g?.["artist-credit"]?.[0]?.name ?? null;
      return { title: g?.title, year: String(g?.["first-release-date"] ?? "").slice(0, 4) || null,
        ...(credit && credit !== artist.name ? { as: credit } : {}) };
    })
    .filter((a) => a.title && !seen.has(`${a.title}|${a.year}`) && seen.add(`${a.title}|${a.year}`))
    .sort((a, b) => String(a.year ?? "9999").localeCompare(String(b.year ?? "9999")) || a.title.localeCompare(b.title));
  if (!albums.length) return null;
  const kept = cleanResearch({ artist: artist.name, mbid: artist.id, disambiguation: artist.disambiguation ?? null, names, albums });
  // Marked as the house's, so the folder says it holds studio albums only.
  return kept ? { ...kept, by: "house" } : null;
}

// Looked up and kept, or null: what look_up_artist and an endless job with
// no folder call. A miss is remembered for an hour.
// Never throws: a lookup that cannot be made is a set made from memory.
export async function lookUpAndKeep(env, name, opts = {}) {
  if (!artistLookupOn(env) || !String(name ?? "").trim()) return null;
  const left = env?.__budget?.remaining;
  if (Number.isFinite(left) && left < BUDGET_RESERVE) return null;
  const kv = programsKV(env);
  try {
    if (await kv.get(missKey(name)) || await kv.get(busyKey(name))) return null;
    await kv.put(busyKey(name), "1", { expirationTtl: BUSY_TTL_S });
  } catch { /* looked up unguarded, then */ }
  let kept = null;
  try { kept = await houseLookUp(env, name, opts); } catch { kept = null; }
  try { await kv.delete(busyKey(name)); } catch { /* it lapses in a minute */ }
  if (!kept) {
    try { await kv.put(missKey(name), "1", { expirationTtl: MISS_TTL_S }); } catch { /* asked again, then */ }
    return null;
  }
  let key = null;
  try { key = await keepResearch(env, name, kept); } catch { key = null; }
  return key ? { ...kept, key } : null;
}

// THE RECORDING CHECK (MC-41 stage 0, 2026-11-12; recordings.js). The
// recording finder asks MusicBrainz when and where a recording was made, and
// which work it is, by its code (ISRC): the one number that is the same on
// every service. Spotify's `released` is the album's date, and wrong for old
// records (the trial: "1919" on a box that holds a 1929 recording).
//
// By the code, never by the composer's name: in MusicBrainz a recording's
// artist credit is its PERFORMERS, and the composer is on the work it is a
// performance of. A search for "Beethoven" as the artist of the Fifth finds
// nothing, which reads like "not there" and is not.
//
// Two requests, three at most with a busy's tries counted: the code, then the
// recording with its relationships (the work, and the work's own parts
// relation, which names the whole symphony a movement belongs to; the place;
// the dates on any of them). Best effort, and never in the way: anything that
// goes wrong is `unanswered`, and the answer goes out without it.
//
// What comes back: { state, facts? }, where state is
//   "checked"     MusicBrainz knows the recording: `facts` say what it says
//   "none"        it has no entry for the code
//   "unanswered"  slow, busy, down, or asked within the hour and was then
//   "off"         this house does not ask it (ARTIST_LOOKUP="off")
//   "no-code"     Spotify gave no code to ask with
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const RECORDING_DEADLINE_MS = 8000;
const RECORDING_REQUESTS = 3;
const RECORDING_INC = "artist-rels+place-rels+area-rels+work-rels+work-level-rels";
export async function checkRecording(env, isrc, durationMs, { deadlineMs = env?.__mbDeadlineMs ?? RECORDING_DEADLINE_MS } = {}) {
  if (!artistLookupOn(env)) return { state: "off" };
  const code = String(isrc ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!ISRC_RE.test(code)) return { state: "no-code" };
  const b = env?.__budget;
  if (b && !b.critical && b.remaining < RECORDING_REQUESTS) return { state: "unanswered" };
  // A MusicBrainz that did not answer is not asked again for an hour, as a
  // name is not: a curator asking twice does not wait twice.
  const miss = `mbmiss:isrc-${code.toLowerCase()}`;
  const kv = programsKV(env);
  try { if (await kv.get(miss)) return { state: "unanswered" }; } catch { /* asked, then */ }
  const deadline = Date.now() + deadlineMs;
  const cap = { left: RECORDING_REQUESTS };
  let out = { state: "unanswered" };
  try {
    const got = await ask(env, `/isrc/${code}?fmt=json`, 0, deadline, cap);
    const recs = got && got !== MB_NONE ? (Array.isArray(got.recordings) ? got.recordings : []).filter((r) => r?.id) : [];
    if (got === MB_NONE || (got && !recs.length)) out = { state: "none" };
    else if (recs.length) {
      // One code can sit on more than one recording (an editor's duplicate,
      // a remaster filed apart): the one nearest the track's own length.
      const off = (r) => (Number.isFinite(r?.length) && durationMs ? Math.abs(r.length - durationMs) : Infinity);
      const pick = recs.slice().sort((a, b2) => off(a) - off(b2))[0];
      const at = `/recording/${encodeURIComponent(pick.id)}`;
      let rec = await ask(env, `${at}?inc=${RECORDING_INC}&fmt=json`, SPACING_MS, deadline, cap);
      // NOT MEASURED (2026-11-12): MusicBrainz documents `work-level-rels`
      // for a release's lookup; if a recording's refuses it, the recording is
      // asked once more without it (the third request), and the work is then
      // the movement's own title rather than the whole symphony's.
      if (rec === null && cap.left > 0) rec = await ask(env, `${at}?inc=${RECORDING_INC.replace("+work-level-rels", "")}&fmt=json`, SPACING_MS, deadline, cap);
      if (rec && rec !== MB_NONE) out = { state: "checked", facts: recordingFacts(rec) };
    }
  } catch { out = { state: "unanswered" }; }
  if (out.state === "unanswered") {
    try { await kv.put(miss, "1", { expirationTtl: MISS_TTL_S }); } catch { /* asked again, then */ }
  }
  return out;
}

// What a MusicBrainz recording says of itself, read by rule. The date is on
// whichever relationship an editor dated: the performance of the work first
// (where "recorded on" usually lives), then the place, the city, the players.
// A range ("1974-03 to 1974-04") stays a range. Everything in it is text from
// an open database: reference, never instructions, and held to a length.
const mbText = (v, n = 160) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) || null;
const mbYear = (v) => (/^\d{4}/.test(String(v ?? "")) ? Number(String(v).slice(0, 4)) : null);
export function recordingFacts(rec) {
  const rels = Array.isArray(rec?.relations) ? rec.relations : [];
  const of = (target, type) => rels.find((r) => r?.["target-type"] === target && r?.type === type) ?? null;
  const perf = of("work", "performance");
  const at = of("place", "recorded at");
  const city = of("area", "recorded in");
  const players = rels.filter((r) => r?.["target-type"] === "artist");
  const dated = [perf, at, city, ...players].find((r) => mbYear(r?.begin)) ?? null;
  const begin = mbText(dated?.begin, 10), end = mbText(dated?.end, 10);
  const parent = (Array.isArray(perf?.work?.relations) ? perf.work.relations : [])
    .find((r) => r?.type === "parts" && r?.direction === "backward" && r?.work?.title);
  const place = at?.place?.name
    ? [at.place.name, at.place.area?.name].map((p) => mbText(p, 80)).filter(Boolean).join(", ")
    : mbText(city?.area?.name, 80);
  return {
    recorded: begin ? (end && end !== begin ? `${begin} to ${end}` : begin) : null,
    years: begin ? [mbYear(begin), mbYear(end) ?? mbYear(begin)] : null,
    place: place || null,
    work: mbText(parent?.work?.title ?? perf?.work?.title),
    live: Array.isArray(perf?.attributes) && perf.attributes.includes("live"),
  };
}

// SONG FACTS (MC-46, the owner's choice A, 2026-11-15: "use A for endless").
// About this song on the TV has the DJ's own words only for a song from a
// Shelf page; for every other Spotify song, an endless set's included, it
// shows what open databases say of the song, looked up by its code (ISRC),
// which Spotify's player read already carries. No AI, no DJ run, no Spotify
// call. Measured before it was built (Al Green, "Tired of Being Alone",
// US2HK0914201): the code finds the recording; the recording names the
// studio (Royal Studios), the work and its writers (composer and lyricist:
// Al Green), its first album, and the work's Wikidata entry, which names the
// English Wikipedia article whose opening says what the song did.
//
// Four requests at most for a song not seen before: MusicBrainz twice, a
// second apart; Wikidata; Wikipedia. Kept by code for 90 days, a song nobody
// knows for 14, so a song comes back at once. Everything in it is text from
// open databases: reference for a listener, never instructions, held to a
// length, and drawn as text.
const SONG_INC = "artist-rels+place-rels+area-rels+work-rels+work-level-rels+url-rels+releases+release-groups";
const SONG_DEADLINE_MS = 10000;
const SONG_KEEP_S = 90 * 86400, SONG_NONE_S = 14 * 86400, SONG_MISS_S = 900;
const WRITES = ["writer", "composer", "lyricist"];
const plainAlbum = (r) => r?.status === "Official" && r?.["release-group"]?.["primary-type"] === "Album" &&
  !(r["release-group"]["secondary-types"] ?? []).length;

// What a recording (asked with SONG_INC) says, by rule: the writers of its
// work, where and when it was recorded, the year it first came out and the
// first studio album that holds it, and the work's Wikidata entry.
export function songFactsOf(rec) {
  const base = recordingFacts(rec);
  const rels = Array.isArray(rec?.relations) ? rec.relations : [];
  const work = rels.find((r) => r?.["target-type"] === "work" && r?.type === "performance")?.work ?? null;
  const wrels = Array.isArray(work?.relations) ? work.relations : [];
  const writers = [];
  for (const r of wrels) {
    const n = mbText(r?.artist?.name, 80);
    if (r?.["target-type"] === "artist" && WRITES.includes(r?.type) && n && !writers.includes(n)) writers.push(n);
  }
  const wd = wrels.map((r) => String(r?.url?.resource ?? "")).map((u) => u.match(/^https:\/\/www\.wikidata\.org\/wiki\/(Q\d{1,12})$/)?.[1]).find(Boolean) ?? null;
  const dated = (r) => String(r?.date || r?.["release-group"]?.["first-release-date"] || "9999");
  const album = (Array.isArray(rec?.releases) ? rec.releases : []).filter(plainAlbum).sort((a, b) => dated(a).localeCompare(dated(b)))[0] ?? null;
  const out = {
    writers: writers.slice(0, 6),
    recorded: base.recorded, place: base.place, live: base.live,
    released: mbYear(rec?.["first-release-date"]),
    album: album ? { title: mbText(album["release-group"]?.title ?? album.title, 120), year: mbYear(album["release-group"]?.["first-release-date"] ?? album.date) } : null,
    wikidata: wd,
  };
  return out;
}

// The English Wikipedia article a Wikidata entry names, and its opening.
const WIKI_H = { headers: { "user-agent": MB_UA, accept: "application/json" } };
const leftOf = (deadline) => Math.max(500, Math.min(TIMEOUT_MS, deadline - Date.now()));
async function wikiOpening(env, q, deadline) {
  try {
    const r = await subrequest(env, `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=sitelinks&sitefilter=enwiki&format=json`,
      { ...WIKI_H, signal: AbortSignal.timeout(leftOf(deadline)) });
    const title = r?.ok ? (await r.json())?.entities?.[q]?.sitelinks?.enwiki?.title : null;
    if (!title || Date.now() > deadline - 500) return null;
    return await wikiSummary(env, title, deadline);
  } catch (e) { if (e?.budgetExhausted) throw e; return null; }
}
// An article's opening by its title (a disambiguation page or a missing one: null).
async function wikiSummary(env, title, deadline) {
  if (!title || Date.now() > deadline - 500) return null;
  try {
    const s = await subrequest(env, `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g, "_"))}`,
      { ...WIKI_H, signal: AbortSignal.timeout(leftOf(deadline)) });
    const d = s?.ok ? await s.json() : null;
    if (!d || d.type !== "standard") return null;
    const text = mbText(d.extract, 1400);
    const url = String(d.content_urls?.desktop?.page ?? "");
    return text ? { title: mbText(d.title, 160), text, url: /^https:\/\/en\.wikipedia\.org\//.test(url) ? url : null } : null;
  } catch (e) { if (e?.budgetExhausted) throw e; return null; }
}

// THE ALBUM'S ARTICLE (2026-11-17, the owner: "yes build it", after a
// measurement: of 19 songs with no Wikipedia article of their own, the album
// each first came out on led to its article for 13, 12 of them right;
// tasks/album-article-trial.mjs). Asked only when the song has none, and
// always said as the album's ("about the album …"), so a wrong one shows.
// The album: the earliest official album holding the recording, a
// soundtrack allowed, never a compilation, a live record, a remix or a
// mixtape. Its release group's Wikidata (or Wikipedia) link first; then
// Wikipedia's search for the album and the artist, kept only when the
// article's title is the album's and its opening names the artist and says
// album. Last, the album Spotify plays the song from, by the same search,
// unless its name reads as a collection.
const NOT_ORIGINAL = /compilation|live|remix|dj-mix|mixtape|demo/i;
export function firstAlbumOf(rec) {
  const dated = (r) => String(r?.date || r?.["release-group"]?.["first-release-date"] || "9999");
  const ok = (r) => (!r?.status || r.status === "Official") && r?.["release-group"]?.["primary-type"] === "Album"
    && !(r["release-group"]["secondary-types"] ?? []).some((t) => NOT_ORIGINAL.test(String(t)));
  const first = (Array.isArray(rec?.releases) ? rec.releases : []).filter(ok).sort((a, b) => dated(a).localeCompare(dated(b)))[0];
  const rg = first?.["release-group"];
  const title = mbText(rg?.title ?? first?.title, 120);
  return rg?.id && title ? { id: String(rg.id), title } : null;
}
const fold = (v) => String(v ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Spotify's album name without its reissue words; a collection is no album here.
export const cleanAlbum = (v) => String(v ?? "").replace(/\s+/g, " ").trim()
  .replace(/\s+-\s+.*\b(remaster(ed)?|deluxe|edition|expanded|anniversary|version|mono|stereo)\b.*$/i, "")
  .replace(/\s*[([][^)\]]*\b(remaster(ed)?|deluxe|edition|expanded|anniversary|bonus|version|mono|stereo)\b[^)\]]*[)\]]\s*$/i, "").trim().slice(0, 120);
const COLLECTION = /\b(greatest hits|best of|the best|gold|anthology|collection|essential|definitive|ultimate|singles|retrospective|hits)\b/i;
async function albumBySearch(env, album, artist, deadline) {
  const a = fold(album);
  if (!a || !fold(artist) || Date.now() > deadline - 1000) return null;
  try {
    const r = await subrequest(env, `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${album} ${artist} album`)}&srlimit=3&format=json&formatversion=2`,
      { ...WIKI_H, signal: AbortSignal.timeout(leftOf(deadline)) });
    const hits = r?.ok ? (await r.json())?.query?.search ?? [] : [];
    // The album's own title ("Super Fly (soundtrack)" for "Superfly"), at
    // most two tried: a song of the same name may come first.
    const same = (h) => fold(String(h?.title ?? "").replace(/\s*\([^)]*\)$/, "")).replace(/ /g, "") === a.replace(/ /g, "");
    for (const hit of hits.slice(0, 3).filter(same).slice(0, 2)) {
      const s = await wikiSummary(env, hit.title, deadline);
      if (isAlbumArticle(s, artist)) return s;
    }
    return null;
  } catch (e) { if (e?.budgetExhausted) throw e; return null; }
}
// An album's article says so in its first sentence ("… is the third studio
// album by …"), and names the artist. A song's article that mentions its
// album later ("Superfly is a song by … the title track from his album",
// found live on the first try, 2026-11-17) is not one.
export function isAlbumArticle(s, artist) {
  const text = String(s?.text ?? "").slice(0, 600);
  // The first sentence only: a song's article calls itself "the second
  // single from the album" further on.
  const first = fold(text.split(/(?<=[a-z0-9)"'\u201d])\.\s+(?=[A-Z])/)[0]);
  const who = fold(artist).replace(/^the /, "").split(" ")[0];
  return !!(s && who && fold(text).includes(who) && /\b(is|was) (a|an|the)( [a-z0-9]+){0,6} (album|soundtrack|lp|ep|record)\b/.test(first));
}
async function albumArticle(env, rg, spotifyAlbum, artist, deadline, cap) {
  if (rg) {
    const g = await ask(env, `/release-group/${encodeURIComponent(rg.id)}?inc=url-rels&fmt=json`, SPACING_MS, deadline, cap);
    const urls = g && g !== MB_NONE ? (Array.isArray(g.relations) ? g.relations : []).map((r) => String(r?.url?.resource ?? "")) : [];
    const q = urls.map((u) => u.match(/^https:\/\/www\.wikidata\.org\/wiki\/(Q\d{1,12})$/)?.[1]).find(Boolean);
    let w = q ? await wikiOpening(env, q, deadline) : null;
    const en = w ? null : urls.map((u) => u.match(/^https:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)$/)?.[1]).find(Boolean);
    if (en) { try { w = await wikiSummary(env, decodeURIComponent(en).replace(/_/g, " "), deadline); } catch (e) { if (e?.budgetExhausted) throw e; } }
    if (w && !isAlbumArticle(w, artist)) w = null;
    if (!w) w = await albumBySearch(env, rg.title, artist, deadline);
    if (w) return { ...w, album: rg.title };
  }
  const sp = cleanAlbum(spotifyAlbum);
  if (sp && !COLLECTION.test(sp) && fold(sp) !== fold(rg?.title)) {
    const w = await albumBySearch(env, sp, artist, deadline);
    if (w) return { ...w, album: sp };
  }
  return null;
}

// THE ARTIST'S ARTICLE (2026-11-20, the owner: "some of the about songs are
// very simple and one line... we need to beef that up"; songextra.js). For a
// song whose own text is thin: the opening of the English Wikipedia article
// MusicBrainz names for the artist. The artist is found by name, at a score
// of 90 or more as the DJs' lookup does it, and the article is kept only
// when its opening reads as music, since a name alone can be someone else.
// Four requests as a rule (MusicBrainz twice, Wikidata, Wikipedia), seven
// when MusicBrainz is busy and is asked again. Null when
// there is none; undefined when MusicBrainz did not answer (ask again later).
const MUSIC_WORDS = /\b(band|singer|musician|group|rapper|songwriter|composer|duo|trio|quartet|quintet|orchestra|ensemble|producer|dj|guitarist|bassist|pianist|organist|drummer|saxophonist|trumpeter|vocalist|instrumentalist|collective|project)\b/i;
export async function artistArticle(env, name, { deadlineMs = env?.__mbDeadlineMs ?? 8000 } = {}) {
  if (!artistLookupOn(env)) return null;
  const asked = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!asked) return null;
  const deadline = Date.now() + deadlineMs;
  const cap = { left: 5 };
  const found = await ask(env, `/artist?query=${encodeURIComponent(`artist:"${asked.replace(/"/g, "")}"`)}&fmt=json&limit=3`, 0, deadline, cap);
  if (!found) return undefined;
  const artist = found === MB_NONE ? null : (found.artists ?? []).find((a) => Number(a?.score) >= 90);
  if (!artist?.id) return null;
  const full = await ask(env, `/artist/${encodeURIComponent(artist.id)}?inc=url-rels&fmt=json`, SPACING_MS, deadline, cap);
  if (!full) return undefined;
  const urls = full === MB_NONE ? [] : (Array.isArray(full.relations) ? full.relations : []).map((r) => String(r?.url?.resource ?? ""));
  const q = urls.map((u) => u.match(/^https:\/\/www\.wikidata\.org\/wiki\/(Q\d{1,12})$/)?.[1]).find(Boolean);
  let w = q ? await wikiOpening(env, q, deadline) : null;
  const en = w ? null : urls.map((u) => u.match(/^https:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)$/)?.[1]).find(Boolean);
  if (en) { try { w = await wikiSummary(env, decodeURIComponent(en).replace(/_/g, " "), deadline); } catch (e) { if (e?.budgetExhausted) throw e; } }
  if (!w || !MUSIC_WORDS.test(w.text)) return null;
  return { ...w, artist: mbText(artist.name, 120) };
}

// WHEN THE CODE IS NOT KNOWN (a remaster or a compilation files the song
// under a code of its own, which MusicBrainz may not have): the song by its
// title and artist, as one search, a match only at a score of 90 or more and
// within ten seconds of the track's length. A match by name may be another
// take of the song (a live one, a re-recording), so only what belongs to the
// SONG is kept from it: its writers and its Wikipedia article, never where,
// when or on what that take was recorded.
const bareTitle = (t) => String(t ?? "").replace(/\s+/g, " ").trim().replace(/\s+-\s+.*$/, "")
  .replace(/\s*[([][^)\]]*\b(remaster(ed)?|mono|stereo|version|mix|edit|live|demo|session|bonus)\b[^)\]]*[)\]]\s*$/i, "").trim();
const luceneWords = (v) => String(v ?? "").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);
async function songBySearch(env, title, artist, durationMs, deadline, cap) {
  const t = luceneWords(bareTitle(title)), a = luceneWords(artist);
  if (!t || !a) return null;
  const q = encodeURIComponent(`recording:"${t}" AND artist:(${a})`);
  const got = await ask(env, `/recording?query=${q}&fmt=json&limit=10`, cap.left < 5 ? SPACING_MS : 0, deadline, cap);
  const near = (r) => !durationMs || !Number.isFinite(r?.length) || Math.abs(r.length - durationMs) <= 10000;
  const pick = (got && got !== MB_NONE ? got.recordings ?? [] : []).find((r) => r?.id && Number(r?.score) >= 90 && near(r));
  return pick ? pick.id : null;
}

// The facts for one song by its code, from the house's own keeping first.
// Null when nothing is known (or the house does not ask: ARTIST_LOOKUP="off").
// What goes out: { writers, recorded, place, live, released, album, wiki }.
// WITHOUT A CODE AT ALL (2026-11-15: the owner saw no About this song on
// the Bravia, and the live house had made no lookup, so the TV's answers
// carried no code): the song is found by its title and artist, and kept
// under them.
export async function songFacts(env, isrc, durationMs = 0, { title = "", artist = "", album: spotifyAlbum = "", deadlineMs = env?.__mbDeadlineMs ?? SONG_DEADLINE_MS } = {}) {
  if (!artistLookupOn(env)) return null;
  const code = String(isrc ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const byCode = ISRC_RE.test(code);
  const named = researchSlug(`${artist} ${bareTitle(title)}`);
  if (!byCode && !(named && String(artist).trim() && String(title).trim())) return null;
  const kv = programsKV(env);
  const tag = byCode ? code.toLowerCase() : `n-${named}`;
  const key = `songfacts:${tag}`, miss = `mbmiss:song-${tag}`;
  // A song kept before the album's article (no `v`) and without an article
  // of its own is asked once more, for its album's (2026-11-17).
  let old = null;
  try {
    const kept = await kv.get(key, { type: "json" });
    if (kept && (kept.v >= 2 || kept.facts?.wiki)) return kept.facts ?? null;
    if (kept) old = kept.facts ?? null;
    else if (await kv.get(miss)) return null;
  } catch { /* asked, then */ }
  const deadline = Date.now() + deadlineMs;
  const cap = { left: 5 };
  let facts = null, answered = false, rg = null;
  try {
    const got = byCode ? await ask(env, `/isrc/${code}?fmt=json`, 0, deadline, cap) : MB_NONE;
    const recs = got && got !== MB_NONE ? (Array.isArray(got.recordings) ? got.recordings : []).filter((r) => r?.id) : [];
    let id = null, byName = false;
    if (recs.length) {
      const off = (r) => (Number.isFinite(r?.length) && durationMs ? Math.abs(r.length - durationMs) : Infinity);
      id = recs.slice().sort((a, b) => off(a) - off(b))[0].id;
    } else if (got === MB_NONE || got) {
      // The code is unknown: by name, or nobody knows it.
      id = await songBySearch(env, title, artist, durationMs, deadline, cap);
      byName = !!id;
      if (!id) answered = got === MB_NONE || !!got;
    }
    if (id) {
      const rec = await ask(env, `/recording/${encodeURIComponent(id)}?inc=${SONG_INC}&fmt=json`, SPACING_MS, deadline, cap);
      if (rec && rec !== MB_NONE) {
        answered = true;
        const f = songFactsOf(rec);
        rg = firstAlbumOf(rec);
        const wiki = f.wikidata ? await wikiOpening(env, f.wikidata, deadline) : null;
        const { wikidata, ...rest } = f;
        facts = byName
          ? { writers: rest.writers, recorded: null, place: null, live: false, released: null, album: null, wiki, byName: true }
          : { ...rest, wiki };
        if (!facts.writers.length && !facts.recorded && !facts.place && !facts.released && !facts.album && !wiki) facts = null;
      } else if (rec === MB_NONE) answered = true;
    }
    // No article of the song's own: its album's, said as the album's.
    if (answered && !facts?.wiki) {
      const albumWiki = await albumArticle(env, rg, spotifyAlbum, artist, deadline, cap);
      if (facts) facts.albumWiki = albumWiki;
      else if (albumWiki) facts = { writers: [], recorded: null, place: null, live: false, released: null, album: null, wiki: null, albumWiki, byName: true };
    }
  } catch { answered = false; }
  // Asked again and not answered (MusicBrainz busy): what was kept stands.
  if (!answered && old) return old;
  try {
    if (answered) await kv.put(key, JSON.stringify({ at: Date.now(), v: 2, facts }), { expirationTtl: facts ? SONG_KEEP_S : SONG_NONE_S });
    else await kv.put(miss, "1", { expirationTtl: SONG_MISS_S });
  } catch { /* asked again, then */ }
  return facts;
}

// MORE FROM WIKIPEDIA (the owner, 2026-11-16: "in a lot of cases there are a
// lot more paragraphs of wikipedia text ... a button/link below the first
// paragraph for additional text blocks"). The article's story, as plain
// text: the rest of its opening, then its sections in order, leaving out
// what reads badly from the couch (charts, certifications, track listings,
// credits, release history, references and links: lists and tables).
// Asked only when the button is pressed, and kept 90 days.
const WIKI_SKIP = /^(references|notes|footnotes|citations|sources|bibliography|further reading|external links|see also|release history|personnel|credits.*|.*track listings?|.*charts?|.*certifications?.*|accolades|awards|weekly charts|year-end charts|sales.*)$/i;
const WIKI_MAX_CHARS = 9000;
export function wikiSections(extract, shown = "") {
  const lines = String(extract ?? "").split("\n");
  const out = [];
  let cur = { h: "", p: [] }, skip = false, skipLevel = 0, lead = true, total = 0;
  const push = () => { if (cur.p.length) out.push(cur); };
  const first = String(shown ?? "").trim().slice(0, 80);
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(={2,})\s*(.+?)\s*\1$/);
    if (m) {
      const level = m[1].length;
      if (skip && level > skipLevel) continue;
      skip = WIKI_SKIP.test(m[2]);
      skipLevel = level;
      lead = false;
      push();
      cur = { h: m[2].slice(0, 120), p: [] };
      continue;
    }
    if (skip || line.length < 60) continue;
    // The opening's first paragraph is the one already shown.
    if (lead && first && line.startsWith(first)) continue;
    if (total + line.length > WIKI_MAX_CHARS) { push(); return out; }
    cur.p.push(line.slice(0, 2400));
    total += line.length;
  }
  push();
  return out;
}
export async function wikiMore(env, title, shown = "") {
  if (!artistLookupOn(env)) return null;
  const t = String(title ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 160);
  if (!t) return null;
  const key = `songwiki:${researchSlug(t).slice(0, 100)}`;
  const kv = programsKV(env);
  try { const had = await kv.get(key, { type: "json" }); if (had) return had; } catch { /* asked again */ }
  try {
    const r = await subrequest(env, `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(t.replace(/ /g, "_"))}`,
      { headers: { "user-agent": MB_UA, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const page = r?.ok ? (await r.json())?.query?.pages?.[0] : null;
    if (!page || page.missing) return null;
    const out = { title: mbText(page.title, 160), sections: wikiSections(page.extract, shown) };
    try { await kv.put(key, JSON.stringify(out), { expirationTtl: 90 * 86400 }); } catch { /* asked again next time */ }
    return out;
  } catch (e) { if (e?.budgetExhausted) throw e; return null; }
}
