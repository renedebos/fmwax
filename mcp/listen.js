// A PLAYLIST OF ITS OWN FOR A SHELF PAGE (2026-11-14, the owner: "build 10").
//
// A page's "Open in Spotify" link pointed at the preset's playlist, so it was
// shown only while that preset still held the set (README, *A listen link
// appears only while…*): a page whose set had left the preset, or was never
// put on one, had no way to hear the whole set outside the house. Spotify has
// no link for a list of songs, only for a playlist, so the page gets one of
// its own, made ONCE and never rewritten by a preset.
//
// MADE WHEN ASKED, never by itself: the page's own button in the app. Spotify
// has no "unlisted", so the playlist is public and shows on the account's
// profile (tools.js, create_playlist); forty pages were on the Shelf the day
// this was built, and forty public playlists nobody asked for is clutter the
// owner would have to clear by hand.
//
// Measured 2026-11-14 with the house's own Spotify app (Development Mode):
// POST /me/playlists with public: true is open to a stranger (the page and
// its oEmbed answered 200 with the name, signed out); DELETE
// /playlists/<id>/followers answers 200 and takes it out of the library.
// Spotify deletes nothing, so a link somebody already holds still opens.
//
// The record carries it: `listen: { catalog: "spotify", id, at }`. The public
// page reads the record and never calls Spotify, as before.
import { catalogFor, programsKV, throttledUntil, withBudget } from "./services.js";
import { programBaseUrl, programCatalog, programSpotifyUris, putProgramMoved } from "./shelf.js";

// The calls one making can spend: the create, the write (a second for a set
// over a hundred songs), the read-back, and the unfollow a failure owes.
export const LISTEN_CALLS = 6;
// Two presses a moment apart would each make a playlist: the first leaves a
// mark for a minute (KV's shortest), and the second is told to wait.
const MAKING_TTL_S = 60;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

// The page's own playlist id, or null. Read off the record, checked for
// shape because it goes into a link on a public page.
export function listenId(rec) {
  const id = String(rec?.listen?.id ?? "");
  return rec?.listen?.catalog === "spotify" && SPOTIFY_ID.test(id) ? id : null;
}

// Whether this page can have one at all: a Spotify set, every track of it.
export function listenable(rec) {
  if (programCatalog(rec) !== "spotify") return false;
  const { uris, notSpotify } = programSpotifyUris(rec);
  return uris.length > 0 && !notSpotify.length;
}

function describe(env, rec, slug) {
  let page = "";
  try { page = `${programBaseUrl(env)}/programs/${slug}`; } catch { page = ""; }
  const who = String(rec?.dj ?? "").trim();
  return `${who ? `${who}’s set` : "A set"}${page ? `, with its notes: ${page}` : ""}`.slice(0, 300);
}

// MAKE IT. Codes: `ok` (made, `id`), `had` (it has one, `id`), `gone` (no such
// page), `no` (not a Spotify set, or no songs), `quota` (Spotify's stop,
// `until`), `busy` (another press is making it), `failed` (nothing kept).
// A failure after the playlist exists takes it out of the library again, so
// a half-made one is never left on the profile.
export async function makeListen(env, slug, budget) {
  const kv = programsKV(env);
  let rec = null;
  try { rec = await kv.get(`program:${slug}`, { type: "json" }); } catch { return { code: "failed" }; }
  if (!rec) return { code: "gone" };
  if (listenId(rec)) return { code: "had", id: listenId(rec) };
  if (!listenable(rec)) return { code: "no" };
  const until = await throttledUntil(env);
  if (until) return { code: "quota", until };
  const mark = `listen-making:${slug}`;
  try {
    if (await kv.get(mark)) return { code: "busy" };
    await kv.put(mark, "1", { expirationTtl: MAKING_TTL_S });
  } catch { /* the mark is a courtesy; the making goes on */ }

  const { uris } = programSpotifyUris(rec);
  const cat = catalogFor(withBudget(env, budget), "spotify");
  let id = null;
  try {
    const pl = await cat.createPlaylist({
      name: String(rec.title ?? slug).slice(0, 100), public: true, description: describe(env, rec, slug),
    });
    if (!SPOTIFY_ID.test(String(pl?.id ?? ""))) throw new Error("Spotify gave no playlist id");
    id = pl.id;
    await cat.replaceItems(id, uris.slice(0, cat.batch));
    for (let i = cat.batch; i < uris.length; i += cat.batch) await cat.appendItems(id, uris.slice(i, i + cat.batch));
    // Read back, by count: a link on a public page for a set nothing has
    // confirmed is worse than no link (the rule the on-air link follows).
    const page = await cat.items(id, null);
    const count = page?.total ?? (page?.tracks ?? []).length;
    if (count !== uris.length) throw new Error(`the playlist holds ${count} songs, not ${uris.length}`);
    // The record as it is NOW: a revision may have landed while Spotify
    // was being asked, and it must not be written over.
    const fresh = await kv.get(`program:${slug}`, { type: "json" });
    if (!fresh) throw new Error("the page was deleted meanwhile");
    await putProgramMoved(kv, slug, { ...fresh, listen: { catalog: "spotify", id, at: new Date().toISOString() } });
    return { code: "ok", id };
  } catch (err) {
    if (id) { try { await cat.unfollow(id); } catch { /* said below as failed; the owner can remove it in Spotify */ } }
    if (err?.status === 429) return { code: "quota", until: await throttledUntil(env) };
    return { code: "failed", ...(id ? { left: id } : {}) };
  } finally {
    try { await kv.delete(mark); } catch { /* it ends by itself in a minute */ }
  }
}

// THE PAGE GOES: its playlist leaves the library first. True when there was
// none, when it is out, or when Spotify no longer knows it (404); false when
// Spotify could not be asked, and the caller then keeps the page so the
// press can be tried again (the delete is the irreversible step, last).
export async function dropListen(env, rec, budget) {
  const id = listenId(rec);
  if (!id) return true;
  // A house no longer set up for Spotify can never ask: its pages must not
  // become undeletable over a playlist it cannot reach. The playlist stays.
  if (!env.SPOTIFY_CLIENT_ID) return true;
  try { await catalogFor(withBudget(env, budget), "spotify").unfollow(id); return true; }
  catch (err) { return err?.status === 404; }
}

// ITS UNDO (the page's "Remove its Spotify playlist…" fold): the playlist
// leaves the library, then the record forgets it, so the page goes back to
// having none and can have one made again. Codes: `removed`, `none` (it had
// none), `gone` (no such page), `stays` (Spotify would not; nothing changed).
// The unfollow comes first: if the record's write then fails, the page still
// names a playlist that is out of the library, and the next press converges
// (Spotify answers a second unfollow the same way).
export async function removeListen(env, slug, budget) {
  const kv = programsKV(env);
  let rec = null;
  try { rec = await kv.get(`program:${slug}`, { type: "json" }); } catch { return { code: "stays" }; }
  if (!rec) return { code: "gone" };
  if (!listenId(rec)) return { code: "none" };
  if (!(await dropListen(env, rec, budget))) return { code: "stays" };
  try {
    const fresh = await kv.get(`program:${slug}`, { type: "json" });
    if (!fresh) return { code: "gone" };
    const { listen: _dropped, ...rest } = fresh;
    await putProgramMoved(kv, slug, rest);
    return { code: "removed" };
  } catch { return { code: "stays" }; }
}

// A REVISED SET (revise_program): its own playlist follows the page, or the
// link would play the set as it was. Answers null when done or not needed,
// else a sentence for the tool's warnings; never throws.
export async function syncListen(env, rec, { title = null } = {}, budget) {
  const id = listenId(rec);
  if (!id || !listenable(rec)) return null;
  const { uris } = programSpotifyUris(rec);
  const cat = catalogFor(withBudget(env, budget), "spotify");
  try {
    await cat.replaceItems(id, uris.slice(0, cat.batch));
    for (let i = cat.batch; i < uris.length; i += cat.batch) await cat.appendItems(id, uris.slice(i, i + cat.batch));
    if (title) await cat.rename(id, String(title).slice(0, 100));
    return null;
  } catch (err) {
    return `The page's own Spotify playlist (${id}) could NOT be brought up to date ` +
      `(${String(err?.message ?? err).slice(0, 120)}): its link still plays the set as it was.`;
  }
}
