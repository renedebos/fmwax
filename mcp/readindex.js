// ALL THE READING, IN ONE PLACE (the owner, 2026-11-23: "a place to browse
// all the articles"; option A of the canvas "A place for all the reading":
// the Shelf tab's Reading beside its Programs). About this song shows the
// pieces for the song playing; this is every piece the house holds, by
// artist, newest first.
//
// The pieces live where they were kept: the web's by song (readfind.js,
// `readfound:<slug>`), the Guardian's by artist (readmore.js). A page that
// read each of those records would spend a read a song, and a Worker has
// fifty a look. So two short lists are kept beside them, the newest sixty
// songs and the newest sixty artists, each with its pieces, rewritten
// whenever one is kept. Two saves in the same moment can drop one from the
// list (the store has no check-and-set), so the page mends the songs' list
// against the store's own names, a few a look.
import { programsKV } from "./services.js";

const WEB = "readindex:web", GUARDIAN = "readindex:guardian", FOUND = "readfound:";
export const INDEX_MAX = 60;
const MEND_MAX = 10;

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const first = (artist) => String(artist ?? "").replace(/\s+/g, " ").trim().split(",")[0].trim();

async function read(kv, key) {
  try { const v = await kv.get(key, { type: "json" }); return Array.isArray(v) ? v : null; } catch { return undefined; }
}
async function put(kv, key, list, same, entry) {
  const next = [entry, ...list.filter((e) => !same(e))].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, INDEX_MAX);
  await kv.put(key, JSON.stringify(next));
  return next;
}

// A song's pieces were kept (saveFind). Nothing found is not listed.
export async function indexFound(env, slug, rec) {
  const kv = programsKV(env);
  try {
    const list = (await read(kv, WEB)) ?? [];
    if (!rec?.items?.length) { if (list.some((e) => e.slug === slug)) await kv.put(WEB, JSON.stringify(list.filter((e) => e.slug !== slug))); return; }
    await put(kv, WEB, list, (e) => e.slug === slug, { slug, at: rec.at, song: rec.song, artist: rec.artist, items: rec.items });
  } catch { /* the page mends it */ }
}

// An artist's Guardian pieces were kept (readMore). `artist` is the song's
// artist as asked; `name` the one the Guardian knew.
export async function indexGuardian(env, artist, name, items, at = new Date().toISOString()) {
  const key = fold(first(artist));
  if (!key || !items?.length) return;
  const kv = programsKV(env);
  try { await put(kv, GUARDIAN, (await read(kv, GUARDIAN)) ?? [], (e) => e.key === key, { key, at, name: first(artist), guardian: name, items }); } catch { /* listed next time */ }
}

// THE PAGE'S LIST: artists, each with its blocks, the newest reading first.
// { groups: [{ artist, at, blocks: [{ kind: "guardian" | "web", song?, at, items }] }], n }
export async function readingIndex(env, now = Date.now()) {
  const kv = programsKV(env);
  let [web, guardian] = await Promise.all([read(kv, WEB), read(kv, GUARDIAN)]);
  // THE MEND (Codex's review, 2026-11-23): songs the store holds that the
  // list does not (a list never made yet, or one a second save overwrote),
  // the NEWEST first by the time each key carries, a few a look; and songs
  // the store has let go, taken off. The store's names are read to the end
  // (a thousand a page), so a song gone after its 180 days always leaves.
  // A key that says "nothing found" (n: 0), or one older than a full list's
  // oldest row, is never read. A key from before keys carried a time is.
  try {
    if (web !== undefined) {
      const keys = [];
      let cursor, complete = false;
      for (let page = 0; page < 4 && !complete; page++) {
        const listed = await kv.list({ prefix: FOUND, limit: 1000, ...(cursor ? { cursor } : {}) });
        keys.push(...(listed?.keys ?? []));
        complete = listed?.list_complete !== false; cursor = listed?.cursor;
      }
      const names = new Set(keys.map((k) => k.name.slice(FOUND.length)));
      const have = new Set((web ?? []).map((e) => e.slug));
      let next = (web ?? []).filter((e) => !complete || names.has(e.slug)), changed = next.length !== (web ?? []).length;
      const oldest = next.length >= INDEX_MAX ? String(next[next.length - 1]?.at ?? "") : "";
      const missing = keys.map((k) => ({ slug: k.name.slice(FOUND.length), at: typeof k.metadata?.at === "string" ? k.metadata.at : "", n: k.metadata?.n }))
        .filter((k) => !have.has(k.slug) && k.n !== 0 && (!k.at || !oldest || k.at > oldest))
        .sort((x, y) => (x.at && y.at ? y.at.localeCompare(x.at) : x.at ? 1 : y.at ? -1 : 0));
      for (const k of missing.slice(0, MEND_MAX)) {
        const rec = await kv.get(FOUND + k.slug, { type: "json" });
        // A key with no time that holds nothing is remembered as an empty row,
        // so it is not read again each look.
        next.push({ slug: k.slug, at: rec?.at ?? new Date(now).toISOString(), song: rec?.song ?? "", artist: rec?.artist ?? "", items: rec?.items ?? [] });
        changed = true;
      }
      if (changed || web === null) {
        next = next.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, INDEX_MAX);
        await kv.put(WEB, JSON.stringify(next));
      }
      web = next;
    }
  } catch { /* as listed */ }
  const groups = new Map();
  const group = (key, artist, at) => {
    if (!groups.has(key)) groups.set(key, { artist, at, blocks: [] });
    const g = groups.get(key);
    if (String(at) > String(g.at)) g.at = at;
    return g;
  };
  // The Guardian keeps a list thirty days; an older row is not shown.
  for (const e of guardian ?? []) {
    if (!e?.items?.length || now - Date.parse(e.at) > 30 * 86400_000) continue;
    group(e.key, e.name, e.at).blocks.push({ kind: "guardian", at: e.at, items: e.items });
  }
  for (const e of web ?? []) {
    if (!e?.items?.length) continue;
    group(fold(first(e.artist)), first(e.artist), e.at).blocks.push({ kind: "web", song: e.song, at: e.at, items: e.items });
  }
  const out = [...groups.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  for (const g of out) g.blocks.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { groups: out, n: out.reduce((n, g) => n + g.blocks.reduce((m, b) => m + b.items.length, 0), 0), unreadable: web === undefined && guardian === undefined };
}

// How many pieces, for the Shelf's switch: from the two lists alone.
export async function readingCount(env, now = Date.now()) {
  const kv = programsKV(env);
  const [web, guardian] = await Promise.all([read(kv, WEB), read(kv, GUARDIAN)]);
  // Neither list made yet: the Reading page makes them. The Guardian's alone
  // is counted (Codex): a house with a key and no curator has only that one.
  if (web == null && guardian == null) return null;
  return (web ?? []).reduce((n, e) => n + (e?.items?.length ?? 0), 0) +
    (guardian ?? []).reduce((n, e) => n + (now - Date.parse(e?.at) <= 30 * 86400_000 ? e?.items?.length ?? 0 : 0), 0);
}
