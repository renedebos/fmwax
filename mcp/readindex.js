// ALL THE READING, IN ONE PLACE (the owner, 2026-11-23: "a place to browse
// all the articles"; option A of the canvas "A place for all the reading":
// the Shelf tab's Reading beside its Programs). About this song shows the
// pieces for the song playing; this is every piece the house holds.
//
// BY DJ (the owner, 2026-11-23: "organizing them by the DJ because that will
// help the user put these links into context"; the canvas "Reading by DJ").
// An artist is listed under every DJ who played them, and under "Not from a
// DJ" when none did (an album, the Spotify app, Talk). Which DJs played whom
// comes from the house's week (week.js: every song a DJ put in front of the
// house, seven days), learnt into a list that outlives the week. Pieces are
// kept once, whoever played the artist.
//
// The pieces live where they were kept: the web's by song (readfind.js,
// `readfound:<slug>`), the Guardian's by artist (readmore.js). A page that
// read each of those records would spend a read a song, so short lists are
// kept beside them, rewritten whenever one is kept:
//   readindex:web       the newest sixty songs, with their pieces
//   readindex:guardian  the newest sixty artists, with their pieces
//   readindex:djs       which DJs played each artist that has reading
//   readindex:hidden    pieces the owner removed: never shown again, here or
//                       in About this song, however often the house looks
//   readindex:kept      pieces the owner kept: shown after their source runs out
// Two saves in the same moment can drop one from a list (the store has no
// check-and-set), so the page mends the songs' list against the store's own
// names, a few a look. One household: the rest is accepted.
//
// No house.js here (it imports this, through now.js and readfind.js): the
// routes turn DJ keys into names and times into words.
import { programsKV } from "./services.js";
import { station } from "./station.js";

const WEB = "readindex:web", GUARDIAN = "readindex:guardian", FOUND = "readfound:";
const DJS = "readindex:djs", HIDDEN = "readindex:hidden", KEPT = "readindex:kept";
export const INDEX_MAX = 60;
// Kept and removed are the owner's word, so neither list is ever cut short
// (Codex, 2026-11-23): past these a keep or a removal is refused and said,
// rather than an old one quietly undone. Both are far past a household's use.
const MEND_MAX = 10, DJS_MAX = 400;
export const HIDDEN_MAX = 10000, KEPT_MAX = 2000;
const GUARDIAN_DAYS = 30;

export const fold = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const first = (artist) => String(artist ?? "").replace(/\s+/g, " ").trim().split(",")[0].trim();
export const artistKey = (artist) => fold(first(artist)).slice(0, 80);
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// A piece's own name, the same wherever it shows: the Guardian's by its id,
// the web's by its address.
export const pieceKey = (source, item) => (source === "guardian" ? (item?.id ? `g:${item.id}` : null) : (item?.url ? `w:${item.url}` : null));
export const pieceKeyOk = (pk) => typeof pk === "string" && pk.length <= 300 && /^(g:[a-z0-9-]+(\/[a-z0-9-]+){2,8}|w:https:\/\/\S+)$/.test(pk);

async function read(kv, key, shape = "list") {
  try {
    const v = await kv.get(key, { type: "json" });
    if (shape === "map") return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    return Array.isArray(v) ? v : null;
  } catch { return undefined; }
}
async function put(kv, key, list, same, entry) {
  const next = [entry, ...list.filter((e) => !same(e))].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, INDEX_MAX);
  await kv.put(key, JSON.stringify(next));
  return next;
}

// WHO PLAYED WHOM, from the house's week: { artistKey: Set of DJ keys }.
async function weekDjs(env) {
  if (!env?.STATION) return null;
  let got = null;
  try { got = await station(env, "played-by", {}, { unbudgeted: true }); } catch { return null; }
  if (!got?.ok) return null;
  const out = new Map();
  for (const r of got.rows ?? []) {
    const lead = String(r?.label ?? "").split(" — ")[0];
    const k = artistKey(lead), dj = clean(r?.dj, 60);
    if (!k || !dj || !String(r?.label ?? "").includes(" — ")) continue;
    if (!out.has(k)) out.set(k, new Set());
    out.get(k).add(dj);
  }
  return out;
}

// The DJs list, learnt: the week's DJs for the artists in `keys` added to
// what was known. Written only when something was learnt.
async function learnDjs(env, kv, keys, known = undefined) {
  const map = known === undefined ? (await read(kv, DJS, "map")) ?? {} : known ?? {};
  const week = await weekDjs(env);
  if (!week) return map;
  let changed = false;
  for (const k of keys) {
    const heard = week.get(k);
    if (!heard) continue;
    const had = new Set(map[k] ?? []);
    for (const dj of heard) if (!had.has(dj)) { had.add(dj); changed = true; }
    map[k] = [...had];
  }
  if (changed) {
    const ks = Object.keys(map);
    if (ks.length > DJS_MAX) for (const k of ks.slice(0, ks.length - DJS_MAX)) delete map[k];
    try { await kv.put(DJS, JSON.stringify(map)); } catch { /* learnt again next look */ }
  }
  return map;
}

// A song's pieces were kept (saveFind). Nothing found is not listed.
export async function indexFound(env, slug, rec) {
  const kv = programsKV(env);
  try {
    const list = (await read(kv, WEB)) ?? [];
    if (!rec?.items?.length) { if (list.some((e) => e.slug === slug)) await kv.put(WEB, JSON.stringify(list.filter((e) => e.slug !== slug))); return; }
    await put(kv, WEB, list, (e) => e.slug === slug, { slug, at: rec.at, song: rec.song, artist: rec.artist, items: rec.items });
    await learnDjs(env, kv, [artistKey(rec.artist)]);
  } catch { /* the page mends it */ }
}

// An artist's Guardian pieces were kept (readMore). `artist` is the song's
// artist as asked; `name` the one the Guardian knew.
export async function indexGuardian(env, artist, name, items, at = new Date().toISOString()) {
  const key = artistKey(artist);
  if (!key || !items?.length) return;
  const kv = programsKV(env);
  try {
    await put(kv, GUARDIAN, (await read(kv, GUARDIAN)) ?? [], (e) => e.key === key, { key, at, name: first(artist), guardian: name, items });
    await learnDjs(env, kv, [key]);
  } catch { /* listed next time */ }
}

// The removed pieces, as a set; empty when the store does not answer.
export async function hiddenSet(env) {
  try { return new Set((await read(programsKV(env), HIDDEN)) ?? []); } catch { return new Set(); }
}
// Items without the removed ones, each with its place in the list as kept
// (`ix`), which the TV's code page goes by.
export function unhidden(items, source, hidden) {
  return (Array.isArray(items) ? items : []).map((it, ix) => ({ ...it, ix })).filter((it) => !hidden.has(pieceKey(source, it)));
}

// THE SONGS' LIST MENDED (Codex's review, 2026-11-23): songs the store holds
// that the list does not (a list never made yet, or one a second save
// overwrote), the NEWEST first by the time each key carries, a few a look;
// and songs the store has let go, taken off. The store's names are read to
// the end (a thousand a page), so a song gone after its 180 days always
// leaves. A key that says "nothing found" (n: 0), or one older than a full
// list's oldest row, is never read. A key from before keys carried a time is.
async function mendWeb(kv, web, now) {
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
  return next;
}

// THE PAGE'S LIST: every artist with reading, newest first.
// { artists: [{ key, name, at, djs: [dj keys], blocks, pieces }], n, unreadable }
// A block is { source: "web", slug, song, at, items } (a song's search),
// { source: "guardian", at, items }, or { source: "kept", items } (kept
// pieces whose source has run out). Every item carries `pk`, and `kept`
// when kept. Removed pieces are gone; an artist with none left is not listed.
export async function readingIndex(env, now = Date.now()) {
  const kv = programsKV(env);
  let [web, guardian, djs, hiddenL, kept] = await Promise.all([read(kv, WEB), read(kv, GUARDIAN), read(kv, DJS, "map"), read(kv, HIDDEN), read(kv, KEPT)]);
  try { if (web !== undefined) web = await mendWeb(kv, web, now); } catch { /* as listed */ }
  const hidden = new Set(hiddenL ?? []);
  const keptBy = new Map((kept ?? []).filter((k) => pieceKeyOk(k?.pk)).map((k) => [k.pk, k]));
  const artists = new Map();
  const artist = (key, name, at) => {
    if (!artists.has(key)) artists.set(key, { key, name, at, djs: [], blocks: [] });
    const a = artists.get(key);
    if (String(at) > String(a.at)) a.at = at;
    return a;
  };
  const shown = new Set();
  const take = (source, items) => (items ?? []).map((it) => ({ ...it, pk: pieceKey(source, it) }))
    .filter((it) => it.pk && !hidden.has(it.pk) && !shown.has(it.pk) && shown.add(it.pk))
    .map((it) => (keptBy.has(it.pk) ? { ...it, kept: true } : it));
  for (const e of web ?? []) {
    const items = take("web", e?.items);
    if (items.length) artist(artistKey(e.artist), first(e.artist), e.at).blocks.push({ source: "web", slug: e.slug, song: e.song, at: e.at, items });
  }
  // The Guardian keeps a list thirty days; an older one is not shown (its kept pieces are).
  for (const e of guardian ?? []) {
    if (now - Date.parse(e?.at) > GUARDIAN_DAYS * 86400_000) continue;
    const items = take("guardian", e?.items);
    if (items.length) artist(e.key, e.name, e.at).blocks.push({ source: "guardian", at: e.at, items });
  }
  for (const k of keptBy.values()) {
    if (shown.has(k.pk) || hidden.has(k.pk) || !k.artistKey || !k.item) continue;
    shown.add(k.pk);
    const a = artist(k.artistKey, k.artist, k.at);
    let b = a.blocks.find((x) => x.source === "kept");
    if (!b) a.blocks.push(b = { source: "kept", items: [] });
    b.items.push({ ...k.item, pk: k.pk, kept: true, from: k.source, ...(k.song ? { song: k.song } : {}) });
  }
  const out = [...artists.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  // Who played them: what was learnt, and the week's newest, written back when new.
  let map = djs ?? {};
  // A list the store did not answer for is not written over.
  if (djs !== undefined) { try { map = await learnDjs(env, kv, out.map((a) => a.key), map); } catch { /* as known */ } }
  for (const a of out) {
    a.djs = [...new Set(map[a.key] ?? [])];
    a.blocks.sort((x, y) => (x.source === "kept") - (y.source === "kept") || String(y.at).localeCompare(String(x.at)));
    a.pieces = a.blocks.reduce((n, b) => n + b.items.length, 0);
  }
  return { artists: out, n: out.reduce((n, a) => n + a.pieces, 0), unreadable: web === undefined && guardian === undefined };
}

// How many pieces, for the Shelf's Reading button: from the lists alone.
export async function readingCount(env, now = Date.now()) {
  const kv = programsKV(env);
  const [web, guardian, hiddenL, kept] = await Promise.all([read(kv, WEB), read(kv, GUARDIAN), read(kv, HIDDEN), read(kv, KEPT)]);
  // Neither list made yet: the Reading page makes them. The Guardian's alone
  // is counted (Codex): a house with a key and no curator has only that one.
  if (web == null && guardian == null) return null;
  const hidden = new Set(hiddenL ?? []), seen = new Set();
  const count = (source, items) => { for (const it of items ?? []) { const pk = pieceKey(source, it); if (pk && !hidden.has(pk)) seen.add(pk); } };
  for (const e of web ?? []) count("web", e?.items);
  for (const e of guardian ?? []) if (now - Date.parse(e?.at) <= GUARDIAN_DAYS * 86400_000) count("guardian", e?.items);
  for (const k of kept ?? []) if (pieceKeyOk(k?.pk) && !hidden.has(k.pk)) seen.add(k.pk);
  return seen.size;
}

// ONE PIECE BY ITS NAME, for the TV's pages from the Reading list: where it
// is now listed, or kept. { source: "web"|"guardian", item, artist } or null.
export async function readingPiece(env, pk) {
  if (!pieceKeyOk(pk)) return null;
  const kv = programsKV(env);
  const [web, guardian, kept, hiddenL] = await Promise.all([read(kv, WEB), read(kv, GUARDIAN), read(kv, KEPT), read(kv, HIDDEN)]);
  if ((hiddenL ?? []).includes(pk)) return null;
  for (const e of web ?? []) for (const it of e?.items ?? []) if (pieceKey("web", it) === pk) return { source: "web", item: it, artist: first(e.artist), song: e.song };
  for (const e of guardian ?? []) for (const it of e?.items ?? []) if (pieceKey("guardian", it) === pk) return { source: "guardian", item: it, artist: e.name };
  const k = (kept ?? []).find((x) => x?.pk === pk);
  return k?.item ? { source: k.source, item: k.item, artist: k.artist, ...(k.song ? { song: k.song } : {}) } : null;
}

// THE OWNER'S HAND: keep a piece, let one go again, remove one, or remove a
// song's whole search (which frees the song to be searched again). Answers
// a code: kept, unkept, removed, unsearched, full (the kept or removed list
// is at its end), gone (no such piece or search), failed.
export async function readingAct(env, { act, pk = "", slug = "" }) {
  const kv = programsKV(env);
  try {
    if (act === "unsearch") {
      if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) return "gone";
      const had = await kv.get(FOUND + slug);
      const list = (await read(kv, WEB)) ?? [];
      if (!had && !list.some((e) => e.slug === slug)) return "gone";
      await kv.delete(FOUND + slug);
      if (list.some((e) => e.slug === slug)) await kv.put(WEB, JSON.stringify(list.filter((e) => e.slug !== slug)));
      return "unsearched";
    }
    if (!pieceKeyOk(pk)) return "gone";
    const kept = (await read(kv, KEPT)) ?? [];
    if (act === "unkeep") {
      if (!kept.some((k) => k.pk === pk)) return "gone";
      await kv.put(KEPT, JSON.stringify(kept.filter((k) => k.pk !== pk)));
      return "unkept";
    }
    if (act === "keep") {
      if (kept.some((k) => k.pk === pk)) return "kept";
      if (kept.length >= KEPT_MAX) return "full";
      const found = await readingPiece(env, pk);
      if (!found) return "gone";
      const item = Object.fromEntries(Object.entries(found.item).filter(([k]) => ["id", "kind", "title", "year", "min", "about", "lang", "source", "url", "paywalled", "checked"].includes(k)));
      const next = [{ pk, at: new Date().toISOString(), source: found.source, artist: found.artist, artistKey: artistKey(found.artist),
        ...(found.song ? { song: clean(found.song, 200) } : {}), item }, ...kept];
      await kv.put(KEPT, JSON.stringify(next));
      return "kept";
    }
    if (act === "remove") {
      const hidden = (await read(kv, HIDDEN)) ?? [];
      if (!hidden.includes(pk)) {
        if (hidden.length >= HIDDEN_MAX) return "full";
        await kv.put(HIDDEN, JSON.stringify([pk, ...hidden]));
      }
      if (kept.some((k) => k.pk === pk)) await kv.put(KEPT, JSON.stringify(kept.filter((k) => k.pk !== pk)));
      return "removed";
    }
    return "gone";
  } catch { return "failed"; }
}

// THE PAGE'S VIEW of the list: by a DJ, by none, or all; or what a search
// finds, across every DJ. `dj` is a DJ key, "none" or "" for all.
export function readingView(ix, { dj = "", q = "" } = {}) {
  const words = fold(q);
  let artists = ix.artists;
  if (words) {
    artists = artists.map((a) => {
      const blocks = a.blocks.map((b) => ({ ...b, items: b.items.filter((it) =>
        // A Guardian piece has no site of its own on it: its name is searched too (Codex).
        [a.name, b.song, it.song, it.title, it.source, it.kind, b.source === "guardian" || it.from === "guardian" ? "The Guardian" : ""]
          .some((v) => fold(v).includes(words))) })).filter((b) => b.items.length);
      return { ...a, blocks, pieces: blocks.reduce((n, b) => n + b.items.length, 0) };
    }).filter((a) => a.pieces);
  } else if (dj === "none") artists = artists.filter((a) => !a.djs.length);
  else if (dj) artists = artists.filter((a) => a.djs.includes(dj));
  // The chips: every DJ who played an artist here, the most pieces first.
  const by = new Map();
  let none = 0;
  for (const a of ix.artists) {
    if (!a.djs.length) none += a.pieces;
    for (const d of a.djs) by.set(d, (by.get(d) ?? 0) + a.pieces);
  }
  const chips = [...by].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([key, n]) => ({ key, n }));
  return { artists, chips, none, all: ix.n, n: artists.reduce((n, a) => n + a.pieces, 0) };
}
