// GENIUS FOR THE SONGS (2026-11-16, the owner: "build both, a first"; the
// 20-song check in tasks/mc46-tv-page.md: 18 of 20 found, samples and covers
// strong on known records, an About text on 12). Genius's official API, read
// only: a song's producers and writers, what it samples, who sampled it, what
// it covers and who covered it, and its About text. NEVER ITS LYRICS: the API
// does not give them, and the house does not take them from its pages.
//
// Two users: About this song on the TV (a few lines, and Genius's text only
// where Wikipedia has none), and the DJs' look_up_song (the longer lists, for
// sets built on those links: the originals hip-hop sampled, a song and who
// sang it next). A house with no GENIUS_TOKEN secret has neither.
//
// The house asks twice (a search, then the song) and keeps the answer by
// artist and title for 90 days, a miss for 14. The lists hold home-made
// uploads beside real records (Teardrop's first "sampled in" were amateur
// tracks): they are sorted by how many people read each song on Genius, and
// a song nobody reads there is left out.
import { geniusOn, programsKV, subrequest } from "./services.js";
import { researchSlug } from "./endless.js";

export { geniusOn };
const GENIUS_TTL_S = 90 * 86400, MISS_TTL_S = 14 * 86400, TIMEOUT_MS = 5000;
const RELS = { samples: "samples", sampled_in: "sampledIn", interpolates: "interpolates", cover_of: "coverOf", covered_by: "coveredBy" };

const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
// "Ain't Nobody (Remastered)" and "Rufus & Chaka Khan" as plain words.
const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s+-\s+.*$/, "").replace(/&/g, " and ").replace(/[’']/g, "")
  .replace(/[^a-z0-9]+/g, " ").replace(/^the /, "").trim();
// The artist matches when either name holds the other, or they share the
// first name ("Rufus & Chaka Khan" is filed under "Rufus").
function sameArtist(want, got) {
  const w = fold(want), g = fold(got);
  if (!w || !g) return false;
  return w === g || w.includes(g) || g.includes(w) || w.split(" and ")[0] === g.split(" and ")[0];
}
const sameTitle = (want, got) => { const w = fold(want), g = fold(got); return !!w && (g === w || g.startsWith(w) || w.startsWith(g)); };

async function ask(env, path) {
  const r = await subrequest(env, `https://api.genius.com${path}`, {
    headers: { authorization: `Bearer ${env.GENIUS_TOKEN.trim()}`, "user-agent": "fmwax-house/1.0", accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r?.ok) return null;
  return (await r.json())?.response ?? null;
}

// One related song as the house keeps it, and a list of them, most read first.
const relSong = (y) => ({ t: clip(y?.title, 160), a: clip(y?.primary_artist?.name ?? y?.artist_names, 120),
  y: Number(y?.release_date_components?.year) || null, views: Number(y?.stats?.pageviews) || 0 });
// What a song samples or covers is a short list of its own makers' choosing:
// all of it is kept. Who sampled or covered it is open to anyone's upload:
// only the songs people read.
function ranked(list, n, all = false) {
  const songs = (Array.isArray(list) ? list : []).map(relSong).filter((x) => x.t && x.a);
  const keep = (all ? songs : songs.filter((x) => x.views > 0)).sort((a, b) => b.views - a.views);
  return { n: songs.length, top: keep.slice(0, n) };
}

// The song on Genius, kept. `title` and `artist` as the speaker or Spotify
// names them. Answers null when the house has no token or Genius does not
// know it; throws nothing but the subrequest budget.
export async function geniusSong(env, { title = "", artist = "" } = {}) {
  if (!geniusOn(env)) return null;
  const t = clip(title, 200), a = clip(artist, 120);
  if (!fold(t) || !fold(a)) return null;
  const key = `genius:${researchSlug(`${a} ${fold(t)}`).slice(0, 120)}`;
  const kv = programsKV(env);
  try {
    const had = await kv.get(key, { type: "json" });
    if (had) return had.miss ? null : had;
  } catch { /* asked again */ }
  try {
    const found = await ask(env, `/search?q=${encodeURIComponent(`${fold(t)} ${a}`)}`);
    const hit = (found?.hits ?? []).map((h) => h?.result).find((r) => r?.id && sameArtist(a, r.primary_artist?.name ?? r.artist_names)
      && sameTitle(t, r.title));
    if (!hit) {
      if (found) { try { await kv.put(key, JSON.stringify({ miss: true }), { expirationTtl: MISS_TTL_S }); } catch { /* asked again */ } }
      return null;
    }
    const s = (await ask(env, `/songs/${hit.id}?text_format=plain`))?.song;
    if (!s) return null;
    const about = clip(s.description?.plain, 3000);
    const out = {
      title: clip(s.title, 200), artist: clip(s.primary_artist?.name, 120),
      url: /^https:\/\/genius\.com\//.test(String(s.url ?? "")) ? String(s.url) : null,
      released: clip(s.release_date_for_display, 40) || null,
      producers: (s.producer_artists ?? []).map((x) => clip(x?.name, 80)).filter(Boolean).slice(0, 6),
      writers: (s.writer_artists ?? []).map((x) => clip(x?.name, 80)).filter(Boolean).slice(0, 6),
      about: about && about !== "?" ? about : "",
    };
    for (const r of s.song_relationships ?? []) {
      const k = RELS[r?.relationship_type];
      if (k) out[k] = ranked(r.songs, 15, k === "samples" || k === "interpolates" || k === "coverOf");
    }
    try { await kv.put(key, JSON.stringify(out), { expirationTtl: GENIUS_TTL_S }); } catch { /* asked again next time */ }
    return out;
  } catch (e) {
    if (e?.budgetExhausted) throw e;
    return null;
  }
}

// What About this song on the TV shows of it: a few names each.
export function geniusForTv(g) {
  if (!g) return null;
  const few = (r, n = 3) => (r && r.top.length ? { n: r.n, top: r.top.slice(0, n).map(({ t, a, y }) => ({ t, a, y })) } : null);
  return { producers: g.producers.slice(0, 3), writers: g.writers.slice(0, 4), samples: few(g.samples), sampledIn: few(g.sampledIn), coverOf: few(g.coverOf, 1),
    coveredBy: few(g.coveredBy), about: g.about, url: g.url };
}
