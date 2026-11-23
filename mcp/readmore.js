// READ MORE (the owner, 2026-11-22: "in depth articles and interviews about
// the artist and/or song", from About this song on the TV; the canvas "Read
// more on the TV"). The Guardian's open API, the one press source that hands
// over whole articles for free: a short list of the best pieces about the
// artist, and a piece's text for the TV's reading page.
//
// Measured that day on 20 artists the house had just played: 8 had the
// Guardian's own page ("tag") with interviews and features, 7 more a few
// pieces naming them in the headline, 5 nothing. So:
//   - an artist with a tag: the tag's pieces that name the artist in the
//     headline (the tag alone also marks other people's interviews that only
//     mention them: the newest "Al Green interview" was with a poet);
//   - an artist with none: music pieces naming them in the headline, and
//     only for a name that cannot be an ordinary word ("Free", "Yes").
// Interviews first, then the longest features, profiles and obituaries.
// Reviews, news and anything short are left out. No AI.
//
// Kept by artist for 30 days (a miss for 14), a piece's text for 30; nothing
// is kept when the Guardian did not answer. A house with no GUARDIAN_KEY
// secret has no Read more. The free key allows 500 calls a day: an artist
// costs two, once, and a piece one, once.
//
// The text is the Guardian's, shown with its name, its writer and its
// address, as its terms ask; reference for a reader, never instructions,
// held to a length and drawn as text.
import { researchSlug } from "./endless.js";
import { programsKV, subrequest } from "./services.js";
import { indexGuardian } from "./readindex.js";

export const guardianOn = (env) => typeof env?.GUARDIAN_KEY === "string" && env.GUARDIAN_KEY.trim().length >= 16;

const KEEP_S = 30 * 86400, MISS_S = 14 * 86400, TIMEOUT_MS = 4000;
export const READ_MAX = 6;
const ID_RE = /^[a-z0-9-]+(\/[a-z0-9-]+){2,8}$/;
export const guardianId = (id) => (typeof id === "string" && id.length <= 240 && ID_RE.test(id) ? id : null);

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const clean = (s, max) => String(s ?? "").replace(/<[^>]{0,400}>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const wordsOf = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019']/g, "")
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");

// "Orgone, Fanny Franklin" is asked as its first name: Spotify joins a
// song's artists with commas.
export const readName = (artist) => String(artist ?? "").replace(/\s+/g, " ").trim().split(",")[0].trim().slice(0, 80);

async function guardian(env, path, params) {
  const u = new URL(`https://content.guardianapis.com/${path}`);
  u.search = new URLSearchParams({ ...params, "api-key": env.GUARDIAN_KEY.trim() });
  const r = await subrequest(env, u.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const j = await r.json().catch(() => null);
  return r.ok && j?.response?.status === "ok" ? j.response : null;
}

// What a piece is, by the Guardian's own tone tags; null for one to leave out.
const KINDS = [["tone/interview", "Interview"], ["tone/obituaries", "Obituary"], ["tone/profiles", "Profile"], ["tone/features", "Feature"]];
const SKIP = ["tone/reviews", "tone/albumreview", "tone/livereview", "tone/news", "tone/letters", "tone/quizzes", "tone/minutebyminute"];
const SECTIONS = new Set(["music", "culture", "books", "film", "artanddesign", "stage"]);
export function pieceOf(r, nameFold) {
  const tones = (Array.isArray(r?.tags) ? r.tags : []).map((t) => t?.id);
  const kind = KINDS.find(([id]) => tones.includes(id))?.[1] ?? null;
  const words = Number(r?.fields?.wordcount) || 0;
  const id = guardianId(r?.id), title = clean(r?.webTitle, 220);
  if (!id || !title || !kind || r?.type !== "article") return null;
  if (kind !== "Interview" && tones.some((t) => SKIP.includes(t))) return null;
  if (words < (kind === "Interview" ? 400 : 600)) return null;
  if (kind !== "Interview" && !SECTIONS.has(String(r?.sectionId ?? ""))) return null;
  // The name in the headline, as whole words: "Prince", not "Princess".
  if (!nameFold || !` ${wordsOf(title)} `.includes(` ${nameFold} `)) return null;
  // A headline that opens with the name is about them, often in their own
  // words ("Prince: 'People hear…'", "Sharon Jones obituary").
  const lead = ` ${wordsOf(title)} `.startsWith(` ${nameFold} `);
  return { id, kind, title, lead, year: /^\d{4}/.exec(String(r?.webPublicationDate ?? ""))?.[0] ?? null, min: Math.max(1, Math.round(words / 220)), words };
}

// The best few of the pieces found: interviews, then the rest, longest first.
export function pickPieces(results, name) {
  const nf = wordsOf(name), seen = new Set();
  const all = (Array.isArray(results) ? results : []).map((r) => pieceOf(r, nf)).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
  const rank = (p) => (p.kind === "Interview" ? 200000 : 0) + (p.lead ? 100000 : 0) + Math.min(p.words, 9000);
  all.sort((a, b) => rank(b) - rank(a));
  // At most four interviews, so a feature or the obituary is not crowded out.
  const talk = all.filter((p) => p.kind === "Interview").slice(0, 4), rest = all.filter((p) => p.kind !== "Interview");
  return [...talk, ...rest].slice(0, READ_MAX).map(({ words: _, lead: __, ...p }) => p);
}

// A name that may be asked without the Guardian's own page for it: two
// words, or one long enough not to be an ordinary word.
const askable = (name) => /\s/.test(name) ? fold(name).length >= 5 : fold(name).length >= 8;

// "Sharon Jones & The Dap-Kings" is also asked as "Sharon Jones": the press
// writes of the singer.
const asked = (name) => [...new Set([name, name.split(/\s+(?:&|and|with|feat\.?|featuring)\s+/i)[0].trim()])].filter((n) => fold(n).length >= 2);
const TONES = "(tone/interview|tone/features|tone/profiles|tone/obituaries)";

// One name's pieces: an array (maybe empty), or undefined when the Guardian
// did not answer.
async function piecesFor(env, name) {
  const q = `"${name.replace(/"/g, "")}"`;
  const tags = await guardian(env, "tags", { q, section: "music", "page-size": "20" });
  if (!tags) return undefined;
  const tag = tags.results?.find((t) => fold(t?.webTitle) === fold(name) && /^music\/[a-z0-9-]{1,80}$/.test(String(t?.id)))?.id ?? null;
  if (!tag && !askable(name)) return [];
  const found = await guardian(env, "search", { q, "query-fields": "headline", tag: `${tag ?? "music/music"},${TONES}`,
    "page-size": "50", "show-fields": "wordcount", "show-tags": "tone", "order-by": "relevance" });
  return found ? pickPieces(found.results, name) : undefined;
}

// { name, items: [{ id, kind, title, year, min }] } or null (nothing to read).
export async function readMore(env, artist) {
  const whole = readName(artist);
  if (!guardianOn(env) || fold(whole).length < 2) return null;
  const kv = programsKV(env), key = `readmore:${researchSlug(whole).slice(0, 120)}`;
  try {
    const had = await kv.get(key, { type: "json" });
    if (had) {
      // A list kept before the Shelf's Reading existed joins it once (readindex.js).
      if (had.v?.items?.length && !had.ix) {
        try { await indexGuardian(env, whole, had.v.name, had.v.items); await kv.put(key, JSON.stringify({ ...had, ix: true }), { expirationTtl: KEEP_S }); } catch { /* next time */ }
      }
      return had.v ?? null;
    }
  } catch { /* asked, then */ }
  let v = null;
  try {
    for (const name of asked(whole)) {
      const items = await piecesFor(env, name);
      if (items === undefined) return null;
      if (items.length) { v = { name, items }; break; }
    }
  } catch (e) { if (e?.budgetExhausted) throw e; return null; }
  try { await kv.put(key, JSON.stringify({ at: Date.now(), v, ...(v ? { ix: true } : {}) }), { expirationTtl: v ? KEEP_S : MISS_S }); } catch { /* asked again */ }
  if (v) await indexGuardian(env, whole, v.name, v.items);
  return v;
}

// The paragraphs of a piece's body: its <p> and <h2> only, as plain words.
// Pictures, pull quotes, embeds and sign-up boxes are left out.
export function parasOf(html, max = 60000) {
  const body = String(html ?? "").replace(/<(figure|aside|script|style|gu-island|ul|ol)\b[^]*?<\/\1>/gi, " ");
  const out = []; let n = 0;
  for (const m of body.matchAll(/<(p|h2)\b[^>]*>([^]*?)<\/\1>/gi)) {
    const t = clean(m[2], 4000);
    if (!t || (m[1].toLowerCase() === "p" && t.length < 2)) continue;
    n += t.length; if (n > max) break;
    out.push(m[1].toLowerCase() === "h2" ? { h: t } : { p: t });
  }
  return out;
}

// One piece, for the reading page: { id, title, by, stand, year, min, url, body } or null.
export async function guardianPiece(env, id) {
  const gid = guardianId(id);
  if (!guardianOn(env) || !gid) return null;
  const kv = programsKV(env), key = `readpiece:${researchSlug(gid).slice(0, 200)}`;
  try { const had = await kv.get(key, { type: "json" }); if (had?.v) return had.v; } catch { /* asked, then */ }
  let got;
  try { got = await guardian(env, gid, { "show-fields": "body,byline,trailText,wordcount" }); } catch (e) { if (e?.budgetExhausted) throw e; got = null; }
  const c = got?.content, body = parasOf(c?.fields?.body);
  if (!c || !body.some((b) => b.p)) return null;
  const url = String(c.webUrl ?? "");
  const v = { id: gid, title: clean(c.webTitle, 220), by: clean(c.fields?.byline, 120), stand: clean(c.fields?.trailText, 600),
    year: /^\d{4}/.exec(String(c.webPublicationDate ?? ""))?.[0] ?? null, min: Math.max(1, Math.round((Number(c.fields?.wordcount) || 0) / 220)),
    url: /^https:\/\/www\.theguardian\.com\//.test(url) ? url : `https://www.theguardian.com/${gid}`, body };
  try { await kv.put(key, JSON.stringify({ at: Date.now(), v }), { expirationTtl: KEEP_S }); } catch { /* asked again */ }
  return v;
}
