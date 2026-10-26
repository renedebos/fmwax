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

// One call, with a second's spacing before it and two tries more after a
// "busy" (about one call in six, measured). Null when it will not answer.
async function ask(env, path, wait, deadline) {
  const nap = napOf(env);
  for (let i = 0; i <= BUSY_WAITS_MS.length; i++) {
    const pause = i ? BUSY_WAITS_MS[i - 1] : wait;
    if (Date.now() + pause + 500 > deadline) return null;
    await nap(pause);
    let r = null;
    try {
      r = await subrequest(env, `${MB}${path}`, { headers: { "user-agent": MB_UA, accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(500, Math.min(TIMEOUT_MS, deadline - Date.now()))) });
    } catch (e) { if (e?.budgetExhausted) throw e; r = null; }
    if (r?.ok) return r.json().catch(() => null);
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
