// MORE ABOUT A SONG WITH LITTLE SAID OF IT (2026-11-20, the owner: "if the
// wiki or genius text is very short i think we should add more to it").
// Measured that day on the 36 songs the house had last played, looked up by
// name: 26 had no text at all in About this song and 6 more a line of under
// 150 characters; Last.fm had a text about the ARTIST for 34 of them, mostly
// a full story, and one about the song itself for 8.
//
// So when the song's own text (its Wikipedia article, else its album's, else
// Genius's words) is under THIN characters, About this song on the TV adds:
//   - Last.fm's text about the song, where its listeners wrote one;
//   - about the artist: the opening of the artist's Wikipedia article
//     (musicbrainz.js artistArticle), else Last.fm's text about the artist.
// Always under a label that says whose words they are and what they are
// about: an artist found by name can be another act of that name, and a
// wrong one must show. No AI. Text from open sites, reference for a
// listener, never instructions, held to a length and drawn as text.
//
// Kept by artist (and by song) for 90 days, a miss for 14; nothing is kept
// when a source did not answer. A house with no LASTFM_KEY has the
// Wikipedia half alone.
import { researchSlug } from "./endless.js";
import { artistArticle } from "./musicbrainz.js";
import { artistLookupOn, lastfmOn, programsKV, subrequest } from "./services.js";

export const THIN = 300;
const KEEP_S = 90 * 86400, MISS_S = 14 * 86400, SOON_S = 6 * 3600, TIMEOUT_MS = 4000;
const SONG_MAX = 1800, ARTIST_MAX = 2400, WORTH = 160;

// The text About this song already leads with.
export function mainTextOf(facts, genius) {
  return String(facts?.wiki?.text || facts?.albumWiki?.text || genius?.about || "");
}

// Last.fm's wiki text as plain words: without its markup, its "Read more on
// Last.fm" link and its licence line, cut at a sentence's end. Empty for a
// page that only lists the several acts of one name, or too short to be
// worth a block.
const MANY = /^((there (are|is|were)|at least|more than one|multiple|several|two|three|four|five|\d+)\b[^.]{0,70}\b(artists?|bands?|acts?|groups?)\b|\(?1[.)]\s)/i;
export function tidyLastfm(html, max = ARTIST_MAX) {
  let t = String(html ?? "").replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, " ")
    .replace(/User-contributed text is available under[^]*$/i, " ")
    .replace(/<[^>]{0,400}>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");
  // Its paragraphs, kept as paragraphs.
  const paras = t.split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length >= 40);
  t = paras.join("\n");
  if (t.length < WORTH || MANY.test(t)) return "";
  if (t.length > max) {
    const cut = t.slice(0, max), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
    t = end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
  }
  return t.trim();
}

async function lastfm(env, method, params) {
  const u = new URL("https://ws.audioscrobbler.com/2.0/");
  u.search = new URLSearchParams({ method, api_key: env.LASTFM_KEY.trim(), format: "json", autocorrect: "1", ...params });
  const r = await subrequest(env, u.toString(), { headers: { "user-agent": "fmwax-house/1.0 ( https://fmwax.com )" },
    signal: AbortSignal.timeout(TIMEOUT_MS) });
  const j = await r.json().catch(() => null);
  // Error 6 is "no such artist or track": an answer. Anything else is none.
  if (j?.error === 6) return {};
  return r.ok && j && !j.error ? j : null;
}

// One kept answer: `make` gives a value, null (there is none: kept as a
// miss) or undefined (no answer: nothing kept).
async function kept(env, key, make) {
  const kv = programsKV(env);
  try { const had = await kv.get(key, { type: "json" }); if (had) return had.v ?? null; } catch { /* asked, then */ }
  let v;
  try { v = await make(); } catch (e) { if (e?.budgetExhausted) throw e; v = undefined; }
  // `soon`: half an answer (one source was busy), asked again in a few hours.
  const soon = !!v?.soon;
  if (soon) v = (({ soon: _, ...rest }) => rest)(v);
  if (v !== undefined) { try { await kv.put(key, JSON.stringify({ at: Date.now(), v }), { expirationTtl: soon ? SOON_S : v ? KEEP_S : MISS_S }); } catch { /* asked again */ } }
  return v ?? null;
}

// "Orgone, Fanny Franklin" is asked whole, then as its first name: Spotify
// joins a song's artists with commas, and so do some names (Earth, Wind & Fire).
const namesOf = (artist) => {
  const whole = String(artist ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const first = whole.split(",")[0].trim();
  return [...new Set([whole, first].filter(Boolean))];
};
const bare = (t) => String(t ?? "").replace(/\s+/g, " ").trim().replace(/\s+-\s+.*$/, "")
  .replace(/\s*[([][^)\]]*\b(remaster(ed)?|mono|stereo|version|mix|edit|live|demo|session|bonus|feat\.?|featuring)\b[^)\]]*[)\]]\s*$/i, "").trim().slice(0, 200);

const words = (v) => String(v ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

// { text, from: "lastfm" } or null.
export async function lastfmSongText(env, { title, artist }) {
  const t = bare(title), a = namesOf(artist).pop();
  if (!lastfmOn(env) || !t || !a) return null;
  return kept(env, `lfsong:${researchSlug(`${a} ${t}`).slice(0, 120)}`, async () => {
    const j = await lastfm(env, "track.getInfo", { artist: a, track: t });
    if (!j) return undefined;
    // Last.fm often files the ARTIST's story under a song (measured: Orgone's
    // "I Get Lifted" read as the band's own page): a text that never names
    // the song is not about it.
    const text = tidyLastfm(j.track?.wiki?.content, SONG_MAX);
    return text && words(text).includes(words(t)) && words(t).length >= 3 ? { text, from: "lastfm" } : null;
  });
}

// { name, text, from: "wikipedia" | "lastfm", wiki? } or null. `wiki` is the
// Wikipedia article's title, for "More from Wikipedia", also when the text
// shown is Last.fm's: Wikipedia's opening is often one line (Darondo's 134
// characters, Orgone's 56, measured), so under THIN characters the longer
// of the two is shown.
export async function artistNote(env, artist) {
  const names = namesOf(artist);
  if (!names.length) return null;
  return kept(env, `artistnote:${researchSlug(names[0]).slice(0, 120)}`, async () => {
    let unanswered = false, w = null, lf = null;
    if (artistLookupOn(env)) {
      for (const n of names) {
        const got = await artistArticle(env, n);
        if (got === undefined) { unanswered = true; break; }
        if (got) { w = { name: got.artist || n, text: got.text, from: "wikipedia", wiki: got.title }; break; }
      }
    }
    if (w && w.text.length >= THIN) return w;
    if (lastfmOn(env)) {
      for (const n of w ? [w.name] : names) {
        const j = await lastfm(env, "artist.getInfo", { artist: n });
        if (!j) { unanswered = true; continue; }
        const text = tidyLastfm(j.artist?.bio?.content, ARTIST_MAX);
        if (text) { lf = { name: String(j.artist?.name ?? n).replace(/\s+/g, " ").trim().slice(0, 120), text, from: "lastfm" }; break; }
      }
    }
    const note = w && lf ? (lf.text.length > w.text.length ? { ...lf, name: w.name, wiki: w.wiki } : w) : w ?? lf;
    if (!note) return unanswered ? undefined : null;
    return unanswered ? { ...note, soon: true } : note;
  });
}

// What is added under a thin song: { song, artist }, or null for neither.
export async function songExtra(env, { title, artist }) {
  const [song, about] = await Promise.all([
    lastfmSongText(env, { title, artist }).catch((e) => { if (e?.budgetExhausted) throw e; return null; }),
    artistNote(env, artist).catch((e) => { if (e?.budgetExhausted) throw e; return null; }),
  ]);
  return song || about ? { song: song ?? null, artist: about ?? null } : null;
}
