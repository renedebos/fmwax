// PLAYLIST WRITES THAT CAN BE UNDONE: snapshots, the safe replace and its
// verification, resolving a playlist by name, and undo to a snapshot.
// Split out of worker.js on 2026-09-26 (consolidation).
import { CATALOGS } from "./catalog.js";
import { station } from "./station.js";
import { endlessPlaylist } from "./endless.js";
import {
  dropOn, findDj, guestBusyWords, guestForPlaylistId, legacyAliasFor, onRecord,
} from "./house.js";
import { dropPauseNoteFor } from "./now.js";
import { dropTile, writeMark } from "./room.js";
import {
  SNAP_TTL_S, catalogFor, catalogOf, fold, foreignUris, houseCatalogNames, ownedPlaylists,
  parseAliases, playlistItems, playlistMeta, playlistRef, programsKV, withBudget,
} from "./services.js";
import { BLANK_DESCRIPTION, PROGRAM_TITLE_MAX } from "./toollist.js";

// Two writes inside the same millisecond used to share a key, and the second
// overwrote the backup the first had just taken. A random tail fixed the
// collision and introduced a quieter fault in its place: with the timestamps
// equal, the ORDER of two same-millisecond snapshots was decided by the salt,
// so "the most recent backup" was a coin flip. Caught as a flaky test in the
// restore path, which is the one place a wrong answer costs a playlist.
//
// So the tail is now sequence-then-salt. The sequence orders same-millisecond
// writes from one isolate; the salt still guarantees the key is unique. Both
// are zero-padded because a prefix list sorts as plain text, which is the only
// ordering KV list() offers.
export let snapSeq = 0;

export function snapKey(playlistId, ms) {
  const salt = [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(36).padStart(2, "0")).join("");
  const seq = String(snapSeq++).padStart(6, "0");
  return `snap:${playlistId}:${String(ms).padStart(15, "0")}-${seq}-${salt}`;
}

// Newest first.
export async function listSnapshots(env, playlistId) {
  const { keys } = await programsKV(env).list({ prefix: `snap:${playlistId}:` });
  return keys.map((k) => k.name).reverse();
}

// Capture a playlist's contents BEFORE anything overwrites them. Spotify has no
// undo and `snapshot_id` is not a restore point: whatever is not captured here
// is gone for good.
//
// Versioned by timestamp and never overwritten. A single slot per playlist
// looks like an undo and stops being one the second time it runs, because the
// second write buries the copy the operator actually wanted back.
//
// Titles are stored next to the URIs deliberately. A URI stops resolving when
// licensing lapses or a track is pulled, and then only the title says what was
// there. That is exactly how a 24-track set was recovered on 2026-08-27 — from
// a chat transcript, because this server had kept nothing.
export async function snapshotPlaylist(env, pl, budget) {
  env = withBudget(env, budget);
  const cat = catalogOf(env, pl);
  const { items, total, complete, entries } = await playlistItems(cat, pl.id, budget);

  // A backup that is not known-good is worse than none: restoring from it
  // deletes whatever the read never saw, silently, with no error anywhere.
  // Refuse here, before the caller reaches its destructive write.
  if (!complete) {
    throw new Error(
      `refusing to overwrite "${pl.name}" (${pl.id}): its contents could not be read ` +
      `in full (${items.length} of ${total} seen), so the backup taken first would be ` +
      "short and restoring it later would delete the rest. Nothing was changed.");
  }
  const holes = items.reduce((n, tr) => n + (tr ? 0 : 1), 0);
  if (holes) {
    throw new Error(
      `refusing to overwrite "${pl.name}" (${pl.id}): ${holes} of ${total} entries could ` +
      "not be read, and an entry with no URI cannot be put back — everything after it " +
      "would shift up on restore. Nothing was changed.");
  }
  const locals = items.filter((tr) => String(tr.uri ?? "").startsWith("spotify:local:"));
  if (locals.length) {
    throw new Error(
      `refusing to overwrite "${pl.name}" (${pl.id}): it holds ${locals.length} local ` +
      "file(s), which the Web API cannot add back. Restoring would lose them for good. " +
      "Nothing was changed.");
  }

  // The program this playlist was SHOWING, not the one about to replace it.
  // Putting the tracks back without the notes leaves a page that describes a
  // set nobody can reach, which is the drift the pointer exists to prevent.
  let programSlug = null;
  try { programSlug = await programsKV(env).get(`current:${pl.id}`); } catch { /* optional */ }
  // And WHOSE set a live guest held (MC-18), so a restore or an undo puts the
  // name back with the tracks. Read for a live guest only.
  let on = null;
  if (guestForPlaylistId(env, pl.id)?.live) {
    try { on = await programsKV(env).get(`on:${pl.id}`, { type: "json" }); } catch { /* optional */ }
  }

  const savedAt = Date.now();
  const key = snapKey(pl.id, savedAt);
  const snap = {
    playlistId: pl.id,
    playlistName: pl.name,
    // Which service the id and the URIs belong to. A restore that hands a
    // Tidal id to Spotify fails cleanly; one that hands Tidal URIs to a
    // Spotify playlist of the same id could not, so the snapshot says.
    catalog: cat.name,
    savedAt: new Date(savedAt).toISOString(),
    total,
    programSlug,
    ...(on ? { on } : {}),
    // What the description ACTUALLY said, not what the program pointer implies
    // it said. A plain replace clears the description, so a snapshot that only
    // remembered the program title would restore the tracks and leave the line
    // under the name blank for every playlist that never carried a program.
    description: pl.description ?? "",
    uris: items.map((tr) => tr.uri),
    tracks: items.map((tr) => ({
      title: tr.name,
      artist: (tr.artists ?? []).map((a) => a.name).join(", "),
    })),
  };
  await programsKV(env).put(key, JSON.stringify(snap), { expirationTtl: SNAP_TTL_S });
  // The handles ride out to the write that follows and are not stored: they
  // name positions in the playlist as it is now, and a restore months later
  // reads the playlist it is about to clear.
  return { ...snap, key, entries };
}

// Write a URI list wholesale. A replace takes at most one batch, so the first
// batch must be the replace and every later batch an append — reversed, a
// long set silently keeps only its last hundred tracks.
export async function putUris(env, pl, uris, budget) {
  const cat = catalogOf(env, pl);
  await cat.replaceItems(pl.id, uris.slice(0, cat.batch));
  // A restore changes the contents like any write: the tile summary is stale
  // and the recorded ask belonged to the set that was just rolled away.
  await dropTile(env, pl.id);
  try { await programsKV(env).delete(`items:${pl.id}`); } catch { /* cache */ }
  try { await programsKV(env).delete(`ask:${pl.id}`); } catch { /* cache */ }
  let landed = Math.min(cat.batch, uris.length);
  for (let i = cat.batch; i < uris.length; i += cat.batch) {
    const batch = uris.slice(i, i + cat.batch);
    await cat.appendItems(pl.id, batch);
    landed += batch.length;
  }
  return landed;
}

export async function rollbackTo(env, pl, snap, budget) {
  try {
    await putUris(env, pl, snap.uris, budget);
    return { ok: true, tracks: snap.uris.length };
  } catch (e) {
    return { ok: false, error: e.message, snapshot_key: snap.key };
  }
}

// Did the playlist end up holding exactly this, in this order?
//
// Positional, never a set comparison. Sequence IS the content for a programmed
// set — "if it could be shuffled without loss, the argument was never there" —
// so a set comparison would pass precisely the failure that matters most.
//
// Relinking only applies when `market` is supplied and playlistItems supplies
// none, so an exact URI match is safe here; `linked_from` is accepted anyway in
// case that ever changes.
export async function verifySequence(env, pl, uris, budget) {
  for (let attempt = 0; attempt < 2; attempt++) {
    // A read straight after a write can be stale, so one mismatch is not proof.
    if (attempt) await new Promise((r) => setTimeout(r, 800));
    let got;
    try {
      got = await playlistItems(catalogOf(env, pl), pl.id, budget, 500);
    } catch (e) {
      return { state: "unconfirmed", why: `it could not be read back (${e.message})` };
    }
    if (!got.complete) {
      return { state: "unconfirmed", why: "the read-back was truncated, so the order could not be checked in full" };
    }
    const same = got.items.length === uris.length && got.items.every(
      (tr, i) => tr && (tr.uri === uris[i] || tr.linked_from?.uri === uris[i]));
    // The items ride out with the verdict. This read is the only moment the
    // whole set exists as Spotify describes it — names, artists, durations,
    // sleeves — and it was being spent on a URI comparison and then dropped.
    // Anything wanting to RECORD what landed would otherwise read the playlist
    // again, racing whatever writes next. Only a confirmed read carries them:
    // a mismatched or truncated one describes something nobody can vouch for.
    if (same) return { state: "confirmed", items: got.items };
    const holes = got.items.reduce((n, tr) => n + (tr ? 0 : 1), 0);
    if (attempt) {
      if (holes) {
        return { state: "unconfirmed", why: `${holes} of ${got.items.length} entries came back unreadable` };
      }
      return {
        state: "mismatch",
        why: `it holds ${got.items.length} tracks where ${uris.length} were sent, ` +
             "or they are in a different order",
      };
    }
  }
}

// Every destructive playlist write goes through here. Splitting snapshot,
// write, verify and rollback across four call sites is how one of them ends up
// missing a step, and the step it misses is always the backup.
//
// Contract: this throws freely UNTIL the first write lands, and never after
// it. Past that point a throw reaches the model as "it did not happen", so
// the model retries — and a retry rewrites the button a second time, buries
// the first backup and publishes a second page. Everything after the point
// of no return is reported in the returned object instead.
export async function replacePlaylistSafely(env, { pl, uris, budget, programSlug = null, description = "",
  restoring = false, requestId = null, holder = null, endless = false }) {
  env = withBudget(env, budget);
  const cat = catalogOf(env, pl);
  // THE GUEST GATE (MC-18 stage 1). A guest preset that is not live is a
  // playlist the household is still saving to the speakers: nothing routes a
  // set there yet, and nothing writes to it either. Refused before the
  // backup read, so nothing is spent and the previous contents are intact.
  const guest = guestForPlaylistId(env, pl.id);
  if (guest && !guest.live) {
    throw new Error(
      `"${pl.name ?? pl.id}" is the ${cat.label} requests preset's playlist (preset ${guest.btn}), ` +
      "and it is not live yet — nothing lands on it until the flip. Nothing was changed.");
  }
  // A LEGACY playlist is kept for its backups and nothing else: only a restore
  // may write it.
  // An endless DJ's playlist is one of these (Sunny's is "was button 4"),
  // and its fresh set is the one write it takes besides a restore (MC-22).
  const legacy = legacyAliasFor(env, pl.id);
  if (legacy && !restoring && !(endless && endlessPlaylist(env, pl.id))) {
    throw new Error(
      `"${pl.name ?? pl.id}" is "${legacy}" — a playlist this house no longer writes to, ` +
      "kept only so its saved copies can be put back. Nothing was changed.");
  }
  // Before the backup is even read: a URI from the other service is refused
  // here for every caller — a restore or an undo of a set recorded on one
  // catalog into a button since moved to the other, a programme replayed
  // through a replay playlist on the wrong one — and not found by the
  // service half way through a batch, with the first half written.
  const foreign = foreignUris(cat, uris);
  if (foreign.length) {
    throw new Error(
      `"${pl.name}" is a ${cat.label} playlist and these are not ${cat.label} ` +
      `track URIs: ${foreign.slice(0, 3).join(", ")}. Nothing was changed.`);
  }
  // THE DOOR'S GUARD (MC-18 stage 2). A live guest that a request is being
  // written to is not written by anything else meanwhile — the Shelf's put,
  // Talk, an undo. Asked here, before the backup read, so a refusal is a
  // throw while the contents are intact; the fulfilment writing it passes its
  // own row as the exception. Best-effort, and said so: a claim that starts
  // just after this answer is not seen, and then both writes are snapshotted
  // and a read-back disagrees (the plan's residual risk 1). A ledger that
  // does not answer blocks nobody; running out of budget still refuses.
  const liveGuest = guest?.live ? guest : null;
  if (liveGuest) {
    let busy = null;
    try {
      busy = (await station(env, "destination-busy", { destination: pl.id, except: requestId }))?.busy ?? null;
    } catch (e) {
      if (e?.budgetExhausted) throw e;
    }
    if (busy) {
      const err = new Error(guestBusyWords(findDj(env, busy.dj)?.name, cat.label));
      err.guestBusy = { request_id: busy.request_id, dj: busy.dj ?? null, catalog: cat.name, button: liveGuest.btn };
      throw err;
    }
  }
  const snap = await snapshotPlaylist(env, pl, budget);

  let landed = 0;
  try {
    await cat.replaceItems(pl.id, uris.slice(0, cat.batch), { entries: snap.entries });
    landed = Math.min(cat.batch, uris.length);
  } catch (e) {
    if (!e.torn) {
      // Nothing was written, so the old contents are intact and a retry is
      // safe. This is the last moment at which throwing is the right answer.
      throw new Error(
        `could not write to "${pl.name}" (${pl.id}, via ${pl.via}): ${e.message}. ` +
        "Nothing was written; the previous contents are intact.");
    }
    // A catalog with no replace of its own clears and then refills, and the
    // clear went through: the point of no return was crossed INSIDE the first
    // write. The old set is gone from the playlist and the new one is not
    // there, so this is the append failure below, met earlier — put the
    // backup back and report, never throw.
    const back = await rollbackTo(env, pl, snap, budget);
    // Nobody knows whose set is on a guest the rollback could not restore.
    if (liveGuest && !back.ok) await dropOn(env, pl.id);
    return {
      ok: false, pl, snapshot: snap, landed: e.landed ?? 0, verified: "not attempted",
      rolledBack: back.ok, cleared: true,
      what_happened: back.ok
        ? `The write failed part way (${e.message}), and the previous ${back.tracks} ` +
          "tracks were put back. The playlist is as it was. Do not retry blindly — " +
          "say what happened first."
        : `The write failed part way (${e.message}), AND putting the previous ` +
          `contents back also failed (${back.error}). The playlist may be EMPTY or ` +
          `hold part of the new set. The backup is intact at ${snap.key} — use ` +
          "restore_playlist. Do NOT claim the old contents are safe.",
      warnings: [],
    };
  }

  // The tile summary and the recorded ask describe the contents that were
  // just replaced. Cleared here rather than in every caller, so no write path
  // can forget; the tool that has a new ask re-writes it after this returns.
  await dropTile(env, pl.id);
  try { await programsKV(env).delete(`items:${pl.id}`); } catch { /* cache */ }
  try { await programsKV(env).delete(`ask:${pl.id}`); } catch { /* absent beats wrong */ }

  // ===================== point of no return: report, never throw ============
  // Budget enforcement is already standing down — the PUT above set it, as any
  // successful mutation does. Said here because this is the line that means it:
  // the append batches, the read-backs and any rollback have to be able to run,
  // and being refused by our own safety margin would strand the playlist exactly
  // as running out would.
  const warnings = [];
  if (uris.length > cat.batch) {
    try {
      for (let i = cat.batch; i < uris.length; i += cat.batch) {
        const batch = uris.slice(i, i + cat.batch);
        await cat.appendItems(pl.id, batch);
        landed += batch.length;
      }
    } catch (e) {
      const back = await rollbackTo(env, pl, snap, budget);
      if (liveGuest && !back.ok) await dropOn(env, pl.id);
      return {
        ok: false, pl, snapshot: snap, landed, verified: "not attempted",
        // Whether the playlist is back as it was. The only ok:false in this
        // function, and the difference between "nothing happened" and "it is
        // holding half a set" — which a caller cannot recover from the prose.
        rolledBack: back.ok,
        what_happened: back.ok
          ? `The write failed after ${landed} of ${uris.length} tracks (${e.message}), ` +
            `and the previous ${back.tracks} tracks were put back. The playlist is as ` +
            "it was. Do not retry blindly — say what happened first."
          : `The write failed after ${landed} of ${uris.length} tracks (${e.message}), ` +
            `AND putting the previous contents back also failed (${back.error}). The ` +
            `playlist is in neither state. The backup is intact at ${snap.key} — ` +
            "use restore_playlist. Do NOT claim the old contents are safe.",
        warnings,
      };
    }
  }

  const verified = await verifySequence(env, pl, uris, budget);
  if (verified.state === "mismatch") {
    // Deliberately no rollback here. A mismatch can be a stale read, and rolling
    // back on one would destroy a playlist that is actually correct.
    warnings.push(
      `The tracks were written but reading them back does not agree: ${verified.why}. ` +
      "Nothing was undone — check the playlist before writing to it again.");
  } else if (verified.state === "unconfirmed") {
    warnings.push(`The write went through but could not be confirmed: ${verified.why}.`);
  }

  // The program a playlist is showing is only true until someone overwrites it.
  // A plain replace clears the link; a writer's make_*_program sets it.
  //
  // A MISMATCH clears it rather than setting it. Two disagreeing read-backs mean
  // what is actually on the playlist is not known, and recording this program as
  // the one loaded there would put a listen link on a public page for a set
  // nothing can confirm. Suppressing a good pointer costs a link that the next
  // write restores; keeping a wrong one misleads whoever opens the page.
  const claim = programSlug && verified.state !== "mismatch" ? programSlug : null;
  let pointed = false;
  for (let attempt = 0; attempt < 2 && !pointed; attempt++) {
    try {
      const kv = programsKV(env);
      if (claim) await kv.put(`current:${pl.id}`, claim);
      else await kv.delete(`current:${pl.id}`);
      pointed = true;
    } catch {
      // Retried once, then reported. Throwing here is not available: the tracks
      // are already written and a thrown error reads as "it did not happen".
    }
  }
  // WHO IS ON THE GUEST (MC-18 stage 2), beside the pointer and by its rule:
  // recorded when the write landed, cleared on a mismatch — two disagreeing
  // read-backs mean nobody knows whose set is there.
  if (liveGuest) {
    try {
      if (verified.state === "mismatch") await programsKV(env).delete(`on:${pl.id}`);
      else await programsKV(env).put(`on:${pl.id}`, JSON.stringify(onRecord(env, holder)));
    } catch {
      warnings.push(
        "The tracks were written, but whose set is on the guest could not be recorded — " +
        "the presets page may name the previous one until the next write there.");
    }
  }
  // And what we left, for the next read to compare against. After the pointer
  // on purpose: if this fails the pointer still stands, and an absent mark
  // claims nothing.
  await writeMark(env, pl.id, uris.slice(0, landed));

  if (!pointed) {
    // This pointer stopped being cosmetic when it started driving a public
    // listen link: a clear that fails leaves a page offering a playlist that
    // has since moved on to something else.
    warnings.push(
      claim
        ? "The tracks were written, but this program could not be recorded as the " +
          "one loaded on that playlist, so its page will not offer a listen link. " +
          "The next write there fixes it."
        : "The tracks were written, but the PREVIOUS program is still recorded as " +
          "loaded on that playlist, so its page may still offer a listen link " +
          "pointing at this one. Write there again, or check that program's page.");
  }

  // The description is the one line a Spotify client prints under the playlist
  // name, and it was carrying a hand-typed label — "button 3 — rewritten by
  // Claude" — that outlived every set it ever described. It is now written on
  // every pass: what is loaded, or nothing.
  //
  // Cleared by default rather than left alone. A caller that says nothing gets
  // an empty description, because a program title sitting over a set that has
  // moved on is the listen-link failure in a different field, and absent beats
  // wrong. Same reason a mismatch clears it: two disagreeing read-backs mean
  // the contents are unknown, and describing them is a claim nothing supports.
  const wanted = verified.state === "mismatch" ? "" : String(description || "");
  const wantDescription =
    wanted.trim() ? wanted.slice(0, PROGRAM_TITLE_MAX) : BLANK_DESCRIPTION;
  try {
    await cat.describe(pl.id, wantDescription);
  } catch (e) {
    // Cosmetic, so no retry and — past the point of no return — no throw. The
    // tracks are written; a stale line under the name is not worth reporting as
    // a failed write, which is how a throw here would read.
    warnings.push(
      `The tracks were written, but the playlist description could not be updated ` +
      `(${e.message}). It may still describe a previous set. Cosmetic only — the ` +
      `next write there fixes it.`);
  }

  await dropPauseNoteFor(env, pl.id);
  // `items` only exists on a confirmed verify, which is the point: a caller
  // reading it is holding the set as it actually landed, or nothing at all.
  return { ok: true, pl, snapshot: snap, landed, verified: verified.state,
    ...(verified.items ? { items: verified.items } : {}), warnings };
}

// Resolve an alias, id, URI, or exact name to one playlist. Fail closed at every
// branch: a wrong guess here overwrites the wrong playlist, which is not
// recoverable from this side.
export async function resolvePlaylist(env, ref, budget) {
  if (typeof ref !== "string" || !ref.trim()) {
    throw new Error(
      "playlist is required — an alias, a playlist id or URI, or an exact playlist name");
  }
  // "preset 11" is "button 11": the app and the remote say preset, the tools
  // have always said button, and a voice says whichever it read (the room
  // test, 2026-09-12: "no playlist named preset 11").
  const needle = ref.trim().replace(/^preset\s*(\d+)$/i, "button $1");

  // Aliases first, so a playlist that happens to be named "button 1" cannot
  // shadow the operator's own mapping.
  // Resolution costs lookups too; a tool that only counted its own pages
  // could quietly overrun the invocation's subrequest allowance.
  //
  // Which catalog is decided by the reference, never assumed: a label carries
  // its button's, an id or URI has its service's shape, and a bare name is
  // looked for on the house's catalogs — a house on both is searched on
  // both, and a name found on each is refused, since only the id says which.
  const aliases = parseAliases(env);
  const keys = Object.keys(aliases).filter((k) => fold(k) === fold(needle));
  if (keys.length > 1) {
    throw new Error(
      `"${needle}" matches ${keys.length} aliases (${keys.join(", ")}) — make the keys distinct`);
  }
  if (keys.length === 1) {
    const key = keys[0];
    const { id, catalog, raw } = aliases[key];
    if (!id) {
      throw new Error(
        `alias "${key}" maps to "${raw}", which is not a playlist id or URI`);
    }
    // Deliberately no fall-through to a name search: a stale alias must be
    // fixed, not worked around by writing into something else.
    const cat = catalogFor(env, catalog);
    const meta = await playlistMeta(cat, id, `alias "${key}" points at playlist`);
    return {
      id, name: meta.name, description: meta.description, via: `alias "${key}"`,
      catalog: cat.name,
    };
  }

  const direct = playlistRef(needle);
  if (direct) {
    const cat = catalogFor(env, direct.catalog);
    const meta = await playlistMeta(cat, direct.id, "playlist");
    return {
      id: direct.id, name: meta.name, description: meta.description, via: "id",
      catalog: cat.name,
    };
  }

  // ownedPlaylists charges its own pages now — per catalog searched.
  const hits = [];
  const seen = [];
  let truncatedOn = null;
  const names = houseCatalogNames(env);
  for (const name of names) {
    const cat = catalogFor(env, name);
    let listing;
    try {
      listing = await ownedPlaylists(cat, budget);
    } catch (e) {
      // A house on two services: the name may already have been found on the
      // first, but a clash on the one that did not answer cannot be ruled
      // out, so it is refused — and the refusal says which service failed,
      // which a bare transport line does not.
      throw new Error(
        `"${needle}" could not be looked for on ${cat.label}: ${e.message}. Pass the id.`);
    }
    for (const pl of listing.playlists) {
      // In a house on both services the visible names say which is whose.
      seen.push(names.length > 1 ? `${pl.name} (${cat.label})` : pl.name);
      if (fold(pl.name) === fold(needle)) hits.push({ ...pl, catalog: cat.name });
    }
    if (listing.truncated) truncatedOn = { catalog: cat.label, n: listing.playlists.length };
  }
  if (hits.length > 1) {
    // The ids are printed as they must be passed back — a bare id, its
    // service beside it — since "spotify:<id>" printed here came straight
    // back as a playlist reference (the voice, 2026-09-12) and is not one.
    throw new Error(
      `"${needle}" matches ${hits.length} playlists: ${
        hits.map((pl) => `${pl.id} (${CATALOGS[pl.catalog]?.label ?? pl.catalog})`).join(", ")
      } — pass one of those ids as \`playlist\`, or a DJ's key for their own`);
  }
  if (hits.length === 1) {
    if (truncatedOn) {
      throw new Error(
        `"${needle}" matched, but the ${truncatedOn.catalog} playlist listing was ` +
        `truncated at ${truncatedOn.n} so a duplicate name may exist unseen — pass the id`);
    }
    return {
      id: hits[0].id, name: hits[0].name, description: hits[0].description, via: "name",
      catalog: hits[0].catalog,
    };
  }
  const shown = seen.slice(0, 10).join(", ");
  const more = seen.length > 10 ? ` (+${seen.length - 10} more)` : "";
  throw new Error(
    `no playlist named "${needle}". Visible: ${shown || "none"}${more}`);
}

// Resolve many things at once without opening an unbounded number of sockets.
// Workers cap simultaneous outbound connections, and Spotify answers a burst
// with 429s, so a small fixed pool beats Promise.all over the whole list.
export async function pooled(items, width, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// A snapshot key names the playlist it belongs to — `snap:<playlistId>:<ms>-…`
// — so the key alone says where it may be written, before anything is read.
// The id is Spotify's 22 characters or Tidal's UUID; nothing else is a key.
export const SNAP_KEY =
  /^snap:([A-Za-z0-9]{22}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):\d{15}-\d{6}-[a-z0-9]+$/;

// PUTTING A SAVED COPY BACK, for restore_playlist and the Shelf's Undo alike
// (one write since 2026-10-12; they were two). The callers check the copy is
// this playlist's and not empty, each in its own words; this restores the
// songs, the line under the name and whoever was on a guest.
//
// The line under the name: the description the snapshot recorded — an
// arbitrary hand-written line is restorable only from there. The programme's
// title is the FALLBACK, for snapshots taken before the description was
// recorded; `??` and not `||`, because a deliberately blank description must
// restore blank rather than fall through to a title the playlist had stopped
// showing.
export async function restoreSnapshot(env, { pl, snap, budget }) {
  let title = "";
  if (snap.description === undefined && snap.programSlug) {
    try {
      const meta = await programsKV(env).getWithMetadata(`program:${snap.programSlug}`);
      if (meta?.value) title = meta.metadata?.title || "";
    } catch { /* cosmetic — a blank description is the safe miss */ }
  }
  return replacePlaylistSafely(env, {
    pl, uris: snap.uris, budget,
    // Restores the pointer as well as the tracks: if what was there before was
    // itself a programme, its page gets its listen link back.
    programSlug: snap.programSlug ?? null,
    description: snap.description ?? title,
    // The one write a legacy playlist still takes (MC-18).
    restoring: true,
    // Whoever the saved copy says was on a guest goes back with it (MC-18).
    holder: snap.on ?? { dj: null, ref: "restore" },
  });
}

// One-tap undo for the notes page, straight after a load.
//
// The tool keeps its dry run because "restore" sounds harmless and is not. Here
// the form IS the confirmation: the person is looking at the row they just
// changed, and the alternative is asking them to go and find a snapshot key.
//
// Bounded the same way the chooser is. The key arrives in a form field, so it
// is checked for shape and then for MEMBERSHIP: the playlist it names has to be
// one this Worker is configured to write to. Without that, whoever holds the
// notes link could put an old set into any playlist on the account.
export async function undoToSnapshot(env, key, budget) {
  const m = SNAP_KEY.exec(String(key ?? ""));
  if (!m) return { ok: false, why: "That is not a saved-copy key." };

  const pid = m[1];
  const aliases = parseAliases(env);
  const alias = Object.keys(aliases).find((a) => aliases[a].id === pid);
  if (!alias) {
    return { ok: false, why: "That saved copy belongs to a playlist this page does not write to." };
  }

  const snap = await programsKV(env).get(key, { type: "json" });
  if (!snap) {
    return { ok: false, why: "That saved copy has expired — backups last 90 days." };
  }
  if (snap.playlistId !== pid) {
    return { ok: false, why: "That saved copy does not match the playlist it names." };
  }
  // The tool refuses this too: a snapshot taken when the playlist was empty
  // would restore by clearing it, which is never what undo means.
  if (!snap.uris?.length) {
    return { ok: false, why: "That saved copy is empty, so putting it back would clear the button." };
  }

  const pl = await resolvePlaylist(env, alias, budget);
  const out = await restoreSnapshot(env, { pl, snap, budget });
  // "The button was not changed" was said for BOTH failures, and it is only
  // true for one of them. replacePlaylistSafely returns ok:false solely from
  // past the point of no return — the playlist has already been rewritten by
  // then — so the honest reply turns on whether the rollback got it back.
  // Saying nothing happened over a playlist holding half a restored set is the
  // one lie the undo path must not tell: it is the safety net.
  if (out.ok) return { ok: true, playlist: pl.name, tracks: snap.uris.length };
  return {
    ok: false,
    rolledBack: out.rolledBack !== false,
    playlist: pl.name,
    why: out.what_happened
      ?? "The write did not take. The button was not changed.",
  };
}
