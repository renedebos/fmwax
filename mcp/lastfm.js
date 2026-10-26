// LAST.FM FOR THE DJS (2026-10-18; the trial, docs/research/
// lastfm-trial-2026-10-18.md; the owner's "yes", with ChatGPT's four
// refinements). Spotify stopped giving a development-mode app its tracks'
// popularity and an artist's top tracks in February 2026; Last.fm gives two
// things the DJs can use:
// - an artist's SIMILAR ARTISTS, the strongest part of the trial (the
//   Kursaal Flyers' list is the pub rock scene). Candidates to widen what a
//   DJ may choose from, never approvals: the brief and the ask still decide.
// - its LISTENING POPULARITY: listeners per song, counted over all the years
//   Last.fm has counted (the API's artist top tracks take no period), so
//   what its users have played since the 2000s, never the charts of the day,
//   and thin for small acts. A song missing from it is not a deep cut.
// Its genre tags are left out: the trial's "pub rock" held the English
// scene, Australian pub rock and Czech bands together, so they are no
// authority on a genre (and the house's own roll calls may be incomplete).
//
// The house fetches it (two calls), keeps it by artist in KV with the day it
// was read, and goes on without it when Last.fm does not answer. Optional:
// a house with no LASTFM_KEY secret has no such tool.
import { lastfmOn, programsKV, subrequest } from "./services.js";
import { researchSlug } from "./endless.js";
import { titleBase } from "./setcheck.js";

export const LASTFM_TTL_S = 90 * 24 * 3600;
export const LASTFM_TIMEOUT_MS = 4000;
export { lastfmOn };
export const lastfmKvKey = (artist) => `lastfm:${researchSlug(artist)}`;
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

async function ask(env, method, params) {
  const u = new URL("https://ws.audioscrobbler.com/2.0/");
  u.search = new URLSearchParams({ method, api_key: env.LASTFM_KEY.trim(), format: "json", autocorrect: "1", ...params });
  // Four seconds, then it is "no answer": a curator waiting on a hung call
  // waits with the music (Codex's review, 2026-10-18).
  const r = await subrequest(env, u.toString(), { headers: { "user-agent": "fmwax-house/1.0 ( https://fmwax.com )" },
    signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) {
    const err = new Error(`Last.fm ${method}: ${j?.message ?? `HTTP ${r.status}`}`);
    err.notFound = j?.error === 6;
    throw err;
  }
  return j;
}

// Its answers, held to a size: one entry per song (the versions of a title
// merged under its first spelling, at the most listeners any of them has).
export function cleanLastfm(top, similar) {
  const songs = [];
  for (const t of top?.toptracks?.track ?? []) {
    const base = titleBase(t?.name);
    if (!base) continue;
    const n = Number(t.listeners) || 0;
    const had = songs.find((s) => s.base === base);
    if (had) had.listeners = Math.max(had.listeners, n);
    else songs.push({ base, title: clip(t.name, 120), listeners: n });
  }
  songs.sort((a, b) => b.listeners - a.listeners);
  return {
    artist: clip(top?.toptracks?.["@attr"]?.artist ?? similar?.similarartists?.["@attr"]?.artist, 120) || null,
    listening: songs.slice(0, 25).map(({ title, listeners }) => ({ title, listeners })),
    similar: (similar?.similarartists?.artist ?? []).slice(0, 20)
      .map((a) => ({ name: clip(a?.name, 120), match: Math.round((Number(a?.match) || 0) * 100) / 100 })).filter((a) => a.name),
  };
}

// The house's copy, else a fresh read kept for 90 days. Null when Last.fm
// cannot say (it does not know the name, or does not answer).
export async function lastfmFor(env, artist, now = Date.now()) {
  const key = lastfmKvKey(artist);
  if (key === "lastfm:") return null;
  try {
    const got = await programsKV(env).get(key, { type: "json" });
    if (got?.listening) return { ...got, kept: true };
  } catch { /* read it fresh */ }
  let top = null, similar = null, failed = null;
  try { top = await ask(env, "artist.gettoptracks", { artist, limit: "50" }); }
  catch (e) { if (e.budgetExhausted) throw e; failed = e; }
  if (top) {
    try { similar = await ask(env, "artist.getsimilar", { artist, limit: "20" }); }
    catch (e) { if (e.budgetExhausted) throw e; failed = e; }
  }
  if (!top) return { unavailable: failed?.notFound ? "not-found" : "no-answer" };
  const out = { ...cleanLastfm(top, similar), retrieved: new Date(now).toISOString().slice(0, 10) };
  if (!out.listening.length && !out.similar.length) return { unavailable: "not-found" };
  // Half an answer is used, never kept: the next ask reads it whole.
  if (!failed) {
    // Under the name asked and, when Last.fm corrected it, the right one too.
    const keys = [...new Set([key, out.artist ? lastfmKvKey(out.artist) : null].filter((k) => k && k !== "lastfm:"))];
    for (const k of keys) {
      try { await programsKV(env).put(k, JSON.stringify(out), { expirationTtl: LASTFM_TTL_S }); } catch { /* read again next time */ }
    }
  }
  return out;
}

// IDEAS, NOT THE SET (the owner, 2026-10-18, after the first live use: Vibe's
// "Piano like okonski" took all thirteen other acts from Okonski's list, in
// its order more or less, and several lead on flute or saxophone).
export const LASTFM_NOTE =
  "SIMILAR ARTISTS are candidates, never approvals: ideas to choose from, not the set. Every song must still fit " +
  "the listener's own words (an instrument, a mood, an era: \"piano\" means piano music, whoever sounds alike), " +
  "and mix the ones that fit with picks of your own: the acts Last.fm's listeners never put beside this one are " +
  "often the best of it. A set that is this list in its order has gone wrong. LISTENING is Last.fm's listeners per song, counted over every year it has " +
  "counted (since the 2000s): what its users play, not the charts of the day (Isaac Hayes's second is a 1974 " +
  "soundtrack cut, never a hit), and thin for small acts. A guide to which songs are familiar, never proof of a " +
  "hit; a song missing from it is not therefore a deep cut.";
