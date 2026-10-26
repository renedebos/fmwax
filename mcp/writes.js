// PROGRAM WRITES: activate_program and revise_program, and the request
// events that ring the curator.
// Split out of worker.js on 2026-09-26 (consolidation).
import { curatorKind, sendWorkEvent } from "./curator-events.js";
import { clock } from "./programs.js";
import { CATALOGS } from "./catalog.js";
import { station, putRequestRecord, getRequestRecord } from "./station.js";
import { archiveProgramRecord, loadArchive, parkStation } from "./archive.js";
import {
  anyLiveGuest, destinationFor, guestAlias, guestForPlaylistId, guestLabel, house, programDj,
} from "./house.js";
import { replacePlaylistSafely, resolvePlaylist } from "./playlists.js";
import {
  catalogFor, foreignUris, houseCatalog, placeOf, playlistRef, programsKV, subrequest,
  withBudget,
} from "./services.js";
import { programBaseUrl, programCatalog, putProgramMoved, resolveProgramTracks } from "./shelf.js";
import { PROGRAM_MAX_TRACKS_HELD, PROGRAM_TITLE_MAX } from "./toollist.js";
import { ARCHIVE } from "./archive-identity.js";

// Put a published program back on its DJ's button. Shared by the
// activate_program tool and by the notes page's chooser, so the two cannot
// drift — every guard below (the re-pointed alias, the backup, the read-backs)
// applies whichever way it was reached.
export async function activateProgram(env, slug, budget) {
  // Reached from callTool, which scopes env, AND from the notes chooser, which
  // does not. Without this the resolve and any token refresh ahead of
  // replacePlaylistSafely would spend subrequests that nothing counted.
  env = withBudget(env, budget);
    const kv = programsKV(env);
    const rec = await kv.get(`program:${slug}`, { type: "json" });
    if (!rec) throw new Error(`no program "${slug}" — list_programs shows what exists`);

    // WHOSE BUTTON is a property of the programme, read back from the record,
    // so a programme always returns to the DJ who wrote it. Reading it from the
    // record and not from the caller is what stops the notes chooser — one
    // shelf listing every DJ's work — from putting the Librarian's survey onto
    // Gatefold's button. Every record ever written carries `dj`, so this
    // resolves for programmes published before there was more than one.
    const dj = programDj(env, rec.dj);
    if (!dj) {
      throw new Error(
        // A record with no `dj` was the Professor's (programDj), cut 2026-10-15.
        `"${rec.title}" was written by ${rec.dj || "the Professor"}, who is no longer in the DJ ` +
        "registry — so there is no button to put it back on. Nothing was changed.");
    }
    const uris = (rec.sections ?? []).flatMap((sec) =>
      (sec.tracks ?? []).map((t) => t?.uri).filter(Boolean));
    if (!uris.length) {
      throw new Error(
        `program "${rec.slug}" has no playable tracks recorded, so there is nothing ` +
        "to put on the button. Nothing was changed.");
    }

    // AN ARCHIVE PROGRAMME GOES BACK ON THE ARCHIVE PRESET (2026-09-07). Its
    // DJ has no button and never will — the recordings are on no service —
    // so the playlist path below cannot apply. It is parked again as a
    // station from the refs its tracks carry, and the pointer is set, which is
    // what makes its page say "on the preset". No range probe here: the takes
    // were probed when first parked, and a dead one is the m3u route's to
    // report. No backup either — a station is rewritten whole and there is
    // nothing to roll back to.
    if (rec.archive || dj.archiveOnly) {
      const slot = house(env).archive;
      if (!slot) {
        throw new Error(
          `"${rec.title}" is a set from the archive, and this house has no archive ` +
          "preset for it to go on. Nothing was changed.");
      }
      const refs = uris.map((u) => String(u).match(/^archive:take:(.+)$/)?.[1]).filter(Boolean);
      if (!refs.length) {
        throw new Error(
          `"${rec.title}" carries no archive takes, so there is nothing to put on ` +
          `preset ${slot.btn}. Nothing was changed.`);
      }
      const key = rec.archive?.key ?? (env.ARCHIVE_M3U_KEY || ARCHIVE.key);
      await parkStation(env, key, refs, { title: rec.title, loop: rec.archive?.loop !== false });
      await kv.put(`current:archive:${key}`, slug);
      let url = null;
      try { url = `${programBaseUrl(env)}/programs/${slug}`; } catch { /* no base */ }
      return {
        program: rec.title, ...(url ? { url } : {}),
        dj: dj.name, button: `button ${slot.btn}`, tracks: refs.length,
        verified: true, activated: true,
        note:
          `Preset ${slot.btn} holds this set now, three takes at a time. NOTHING WAS ` +
          `STARTED — press ${slot.btn} on the WiiM, or if it is already playing the ` +
          "archive the set lands within one lap.",
      };
    }

    // WHERE IT GOES (MC-18 stage 3): a DJ's own preset, else the requests
    // preset on the set's own service. With neither — no service on the set,
    // or no live requests preset for it — there is nowhere for it to land
    // (the crates that caught it went in stage 6, 2026-09-26).
    const setCat = programCatalog(rec);
    const dest = destinationFor(env, dj, setCat);
    if (!dj.button && !dest.guest) {
      throw new Error(
        `"${rec.title}" has no preset to go on: ${!setCat || !CATALOGS.includes(setCat)
          ? "it carries no tracks on a service this house knows"
          : `this house has no live ${catalogFor(env, setCat).label} requests preset`}. Nothing was changed.`);
    }

    // resolve + snapshot pages + the write + two read-backs + the description,
    // and, while a guest is live, the door's guard (MC-18).
    const need = 9 + (anyLiveGuest(env) ? 1 : 0);
    if (budget && need > budget.remaining) {
      throw new Error(
        `this needs ${need} lookups but only ${budget.remaining} are left in this ` +
        "request — make the call on its own rather than after a large search");
    }

    // The DJ's CONFIGURED playlist, not rec.playlistId. An alias re-pointed
    // since publication would otherwise send an old set into whatever that id
    // now is — the same wrong-playlist failure restore_playlist refuses. A
    // tenant's label is their button, anyone else's the requests preset's —
    // the same membership the undo is bounded by.
    const label = dj.button ? dj.alias : dest.alias;
    const pl = await resolvePlaylist(env, label, budget);

    // The two DISAGREEING used to be a refusal, and until the tenancy it was
    // the right one: a DJ's playlist changing meant an alias had been
    // re-pointed under a published set, which is a config error nothing here
    // could guess its way out of.
    //
    // A DJ moving buttons is now ordinary, and the occupancy rule says their
    // published work follows them. So the disagreement is expected and the
    // refusal would block the thing the rule promises. What made it dangerous
    // is handled below instead: the record's `playlistId` is moved to the
    // playlist the set now lives on, and the pointer on the old one is
    // cleared, so "is this loaded?" keeps reading the id the set is actually
    // on. Both are best-effort AFTER the write, and both fail in the safe
    // direction — the page then says a loaded set is not loaded, which
    // understates rather than misleads.
    //
    // What is NOT relaxed: the tracks still have to belong to the target's
    // service. replacePlaylistSafely refuses foreign URIs before it writes
    // anything, so a Tidal-era programme cannot land on a Spotify button.
    const movedFrom = rec.playlistId && rec.playlistId !== pl.id ? rec.playlistId : null;
    // MOVING HOUSE AND MOVING IN ARE NOT THE SAME (2026-09-07). `movedFrom`
    // answers "is there an old pointer to clear", and a record with no
    // playlist has none. But it still needs STAMPING: a programme published
    // from the bench carries `playlistId: null`, and every "is this on a
    // preset?" read tests that id first — so without this the tracks would sit
    // on the button while the page went on saying they did not, forever,
    // because nothing else ever writes it.
    const needsStamp = rec.playlistId !== pl.id;

    const out = await replacePlaylistSafely(env, {
      pl, uris, budget, programSlug: rec.slug, description: rec.title,
      // The programme record's DJ, not the caller's word (MC-18).
      holder: { dj: dj.key, ref: rec.slug },
    });
    const url = `${programBaseUrl(env)}/programs/${rec.slug}`;
    if (!out.ok) {
      return {
        program: rec.title, url, activated: false,
        what_happened: out.what_happened,
      };
    }

    // The programme has moved house. Its record names where it lives so that
    // every "is this on a button?" read — the shelf, the tile, the listen
    // link — asks about the playlist it is actually on.
    const moveWarnings = [];
    if (needsStamp) {
      try {
        await putProgramMoved(kv, slug, { ...rec, playlistId: pl.id, playlistName: pl.name });
      } catch {
        moveWarnings.push(
          `The tracks are on ${placeOf(env, dj, setCat)}, but this program's record still names ` +
          `${movedFrom ? `playlist ${movedFrom}` : "no playlist at all"}, so its page ` +
          "may say it is not loaded. Harmless, and the next activation fixes it.");
      }
    }
    if (movedFrom) {
      try {
        if (await kv.get(`current:${movedFrom}`) === slug) {
          await kv.delete(`current:${movedFrom}`);
        }
      } catch {
        moveWarnings.push(
          `Playlist ${movedFrom} may still claim to be showing this program.`);
      }
    }

    // A kept set carries the words that asked for it. The safe write above
    // cleared `ask:<playlistId>` — every write does — so putting one back on
    // its button without this loses the person's own line, and the page falls
    // back to describing their request to them. Best-effort, after the point
    // of no return: the set is on the button either way.
    if (rec.ask?.text && rec.requestId) {
      try {
        await programsKV(env).put(`ask:${pl.id}`, JSON.stringify({
          requestId: rec.requestId,
          text: String(rec.ask.text).slice(0, 300),
          at: rec.ask.at ?? null,
        }));
      } catch { /* the premise falls back to the record's own standfirst */ }
    }
    return {
      program: rec.title,
      url,
      playlist: pl.name,
      button: dest.guest ? dest.guest.button : dj.button,
      ...(dest.guest ? { on: "guest", catalog: setCat } : {}),
      tracks: out.landed,
      verified: out.verified,
      previous_contents_saved:
        `${out.snapshot.total} tracks — restore_playlist can put them back`,
      undo_snapshot: out.snapshot.key,
      ...(movedFrom ? { moved_from_playlist: movedFrom } : {}),
      ...(out.warnings.length || moveWarnings.length
        ? { warnings: [...out.warnings, ...moveWarnings] } : {}),
      note: dj.button
        ? "The button now holds this program, and its page shows a listen link " +
          "again. NOTHING WAS STARTED — play_program plays it from the button " +
          "without writing anything."
        // MC-18 stage 3: on the guest for its service, over the set before.
        : `The ${guestLabel(dest.guest.catalog)} guest (preset ${dest.guest.btn}) now holds this ` +
          `program, replacing the set that was there. NOTHING WAS STARTED — press ` +
          `${dest.guest.btn} on the remote` + (setCat === "spotify"
            ? ", or play_program plays it from there without writing anything."
            : "; nothing here can start Tidal."),
    };
}

// REVISE A PUBLISHED SET (2026-09-07). Twice in one day a kept set was wrong
// after the fact — a page that claimed completeness without four tracks, a
// set that leaned on one album — and each fix was three writes by hand: the
// playlist with one tool, the record with a script, the listing metadata put
// back afterwards, and the page none the wiser. This is those writes as one,
// with the reason kept on the page as a Revised line.
//
// Setlists only, for now: the shape keep_request_set and play_archive write,
// one bare section with no prose to contradict. A programme with an essay is
// re-published instead — its words name its tracks, and a tracklist edited
// under them would leave the essay lying.
//
// The button is written only when the set is ON AIR. Editing an old page
// must not hijack whatever the button holds now; off air the record changes
// and activate_program puts it on when wanted. And the playlist goes first,
// the record second: a rolled-back write beside an already-changed record is
// exactly the disagreement this tool exists to end.
export async function reviseProgram(env, args, budget) {
  env = withBudget(env, budget);
  const kv = programsKV(env);
  const slug = String(args.id ?? "").trim();
  const rec = await kv.get(`program:${slug}`, { type: "json" });
  if (!rec) throw new Error(`no program "${slug}" — list_programs shows what exists`);

  const sec = rec.sections?.[0];
  const bare = rec.shape === "setlist" && rec.sections?.length === 1 &&
    !sec?.heading && !(sec?.prose?.length);
  if (!bare) {
    throw new Error(
      `"${rec.title}" carries prose that names its tracks, and this tool edits ` +
      "tracklists only. Re-publish it with make_<dj>_program and unpublish_program " +
      "the old one. Nothing was changed.");
  }

  let why = String(args.why ?? "").trim();
  if (!why) {
    throw new Error(
      "why is required: one line the page will show beside the revision. " +
      "Nothing was changed.");
  }
  if (why.length > 300) {
    throw new Error(
      `why is ${why.length} characters; 300 is the most the page will carry. ` +
      "Nothing was changed.");
  }
  if (!/[.!?…]$/.test(why)) why += ".";

  const uris = (Array.isArray(args.uris) ? args.uris : [])
    .map((u) => String(u ?? "").trim()).filter(Boolean);
  if (!uris.length) {
    throw new Error("uris is required: the FULL new order, not just the change. Nothing was changed.");
  }
  const dupes = uris.filter((u, i, a) => a.indexOf(u) !== i);
  if (dupes.length) {
    throw new Error(`the same track appears twice: ${[...new Set(dupes)].join(", ")}. Nothing was changed.`);
  }
  if (uris.length > PROGRAM_MAX_TRACKS_HELD) {
    throw new Error(
      `${uris.length} tracks is over the ${PROGRAM_MAX_TRACKS_HELD} a program can ` +
      "hold. Nothing was changed.");
  }

  const title = String(args.title ?? "").trim()
    ? String(args.title).trim().slice(0, PROGRAM_TITLE_MAX) : rec.title;
  const thesis = String(args.thesis ?? "").trim()
    ? String(args.thesis).trim().slice(0, 1000) : rec.thesis;

  const oldRows = (sec.tracks ?? []).filter((t) => t?.uri);
  const oldUris = oldRows.map((t) => t.uri);
  const sameOrder = oldUris.length === uris.length && oldUris.every((u, i) => u === uris[i]);
  if (sameOrder && title === rec.title && thesis === rec.thesis) {
    throw new Error(
      "nothing to revise: the order, the title and the thesis are all as they were. " +
      "Nothing was changed.");
  }

  const dj = programDj(env, rec.dj);
  const onAir = !!rec.playlistId && (await kv.get(`current:${rec.playlistId}`)) === slug;
  // The live guest this record's set is on, if it is (MC-18 stage 3).
  const onGuest = guestForPlaylistId(env, rec.playlistId);
  const recGuest = onGuest?.live ? onGuest : null;
  const byUri = new Map(oldRows.map((t) => [t.uri, t]));
  const freshUris = uris.filter((u) => !byUri.has(u));
  const isArchive = !!rec.archive || String(rec.playlistId ?? "").startsWith("archive:");

  // Rows already on the record are kept as they are — no lookup, and the
  // year and variant a curator once settled stay settled. Only what is new
  // costs a request.
  let rows;
  let patch = {};
  let refs = null;
  if (isArchive) {
    refs = uris.map((u) => u.match(/^archive:take:(.+)$/)?.[1] ?? null);
    const notTakes = uris.filter((u, i) => !refs[i]);
    if (notTakes.length) {
      throw new Error(
        "an archive program holds archive takes only — these are not: " +
        `${notTakes.slice(0, 3).join(", ")}. Nothing was changed.`);
    }
    const { byRef } = await loadArchive(env, budget);
    const unknown = refs.filter((r) => !byRef.has(r));
    if (unknown.length) {
      throw new Error(
        `not in the archive: ${unknown.slice(0, 5).join(", ")} — search_archive ` +
        "finds refs. Nothing was changed.");
    }
    // Every row rebuilt, not just the new ones: the site link names all of
    // them by ids only the index knows.
    const key = rec.archive?.key ?? (env.ARCHIVE_M3U_KEY || ARCHIVE.key);
    const fresh = archiveProgramRecord(env, {
      slug, key, takes: refs.map((r) => byRef.get(r)), title,
      loop: rec.archive?.loop !== false,
      requestId: rec.requestId ?? null, ask: rec.ask ?? null,
    });
    rows = fresh.sections[0].tracks;
    patch = { archive: fresh.archive };
  } else {
    // The record's own catalog, read off its playlist id — not the DJ's
    // current button, which may be on the other service by now.
    const name = playlistRef(rec.playlistId)?.catalog ?? dj?.catalog ?? null;
    const cat = name ? catalogFor(env, name) : houseCatalog(env);
    const foreign = foreignUris(cat, uris);
    if (foreign.length) {
      throw new Error(
        `"${rec.title}" is a ${cat.label} program and these are not ${cat.label} ` +
        `track URIs: ${foreign.slice(0, 3).join(", ")}. Nothing was changed.`);
    }
    // And the door's guard while a guest is live (MC-18).
    const need = freshUris.length + (onAir ? 9 + (anyLiveGuest(env) ? 1 : 0) : 0);
    if (budget && need > budget.remaining) {
      throw new Error(
        `this needs ${need} lookups but only ${budget.remaining} are left in this ` +
        "request — make the call on its own rather than after a large search");
    }
    let looked = [];
    if (freshUris.length) {
      ({ tracks: looked } = await resolveProgramTracks(env, cat,
        freshUris.map((uri) => ({ uri, where: `track ${uris.indexOf(uri) + 1}` })), budget));
    }
    const freshBy = new Map(freshUris.map((u, i) => [u, looked[i]]));
    rows = uris.map((u) => byUri.get(u) ?? freshBy.get(u));
  }

  // ---- everything above read; the writes start here ----
  let url = null;
  try { url = `${programBaseUrl(env)}/programs/${slug}`; } catch { /* no base */ }
  const warnings = [];
  let written = false;
  let undo = null;
  let note;
  if (onAir && isArchive) {
    const key = rec.archive?.key ?? (env.ARCHIVE_M3U_KEY || ARCHIVE.key);
    await parkStation(env, key, refs, { title, loop: rec.archive?.loop !== false });
    written = true;
    note =
      `Preset ${patch.archive?.btn ?? "?"} holds the revised set; the rotation ` +
      "restarted at the top and any asks it had were cleared. NOTHING WAS STARTED.";
  } else if (onAir && (recGuest || dj?.alias)) {
    // By alias, not button (MC-11): a set on air in a DJ's crate is as on air
    // as one on a preset, and revising it must reach the same playlist the
    // pointer names or the page and the songs come apart.
    // ON A LIVE GUEST (MC-18 stage 3) no DJ's alias reaches it — after the
    // flip no DJ holds a preset — so the guest is found from the record's
    // own playlist; the pointer above says it still holds this set.
    const label = recGuest ? guestAlias(recGuest.catalog) : dj.alias;
    const pl = await resolvePlaylist(env, label, budget);
    if (pl.id !== rec.playlistId) {
      warnings.push(
        `${dj.name} has moved to playlist ${pl.id} since this set was published, so ` +
        `the pointer on ${rec.playlistId} is stale — only the page was revised. ` +
        "activate_program moves the set to where they are now.");
    } else {
      const out = await replacePlaylistSafely(env, {
        pl, uris, budget, programSlug: slug, description: title,
        holder: { dj: dj?.key ?? null, ref: slug },
      });
      if (!out.ok) {
        return {
          program: rec.title, ...(url ? { url } : {}), on_air: true,
          playlist_written: false, what_happened: out.what_happened,
          note: "The record was NOT changed either: the button and the page still agree on the old set.",
        };
      }
      written = true;
      undo = out.snapshot.key;
      warnings.push(...out.warnings);
      // The write cleared `ask:<playlistId>`, as every write does; the kept
      // set's own words go back the way activateProgram puts them back.
      if (rec.ask?.text && rec.requestId) {
        try {
          await kv.put(`ask:${pl.id}`, JSON.stringify({
            requestId: rec.requestId,
            text: String(rec.ask.text).slice(0, 300),
            at: rec.ask.at ?? null,
          }));
        } catch { /* the premise falls back to the record's own standfirst */ }
      }
      note =
        "The button and the page agree. NOTHING WAS STARTED — restore_playlist puts " +
        "the old set back if this was wrong.";
    }
  } else if (onAir) {
    warnings.push(
      `${rec.dj} is not on a button here, so only the page was revised; the ` +
      "pointer says on air but nothing was written.");
  }
  if (!note) {
    note =
      "The page is revised. Not on air, so nothing was written to a button — " +
      "activate_program puts it on.";
  }

  const runtimeMs = rows.reduce((n, t) => n + (t?.duration_ms || 0), 0);
  const revision = {
    at: new Date().toISOString(), why,
    was: { tracks: rec.tracks ?? oldRows.length, runtime: rec.runtime ?? null, uris: oldUris },
  };
  const next = {
    ...rec, ...patch, title, thesis,
    sections: [{ ...sec, tracks: rows }],
    tracks: rows.length, runtime: clock(runtimeMs),
    revisions: [...(rec.revisions ?? []), revision],
  };
  // Through putProgramMoved and never a bare put: the listing row is
  // metadata, and a put without it drops the page off every shelf.
  await putProgramMoved(kv, slug, next);

  return {
    program: title, ...(url ? { url } : {}),
    on_air: onAir, playlist_written: written,
    tracks: rows.length, runtime: next.runtime,
    added: rows.filter((t) => !byUri.has(t.uri)).map((t) => t.title),
    removed: oldRows.filter((t) => !uris.includes(t.uri)).map((t) => t.title),
    ...(undo ? { undo_snapshot: undo } : {}),
    ...(warnings.length ? { warnings } : {}),
    note,
  };
}

// The wake-up event: the curator rung with the request's opaque id, and the
// id is ALL that travels: the words stay in KV under the 30/90-day clock
// (tasks/done/todo.md MC-05 names the rule). Through subrequest() like every
// other external call, so a budget, when attached, sees it.
//
// Best-effort by design: a false return leaves the request pending with a
// dispatch flag on its record, and the hourly sweep picks it up — the pipe
// degrades to slower, never to lost.
// `again` marks a re-ring, sent when a request has sat unanswered or a claim
// died — see the DJ page's route.
export async function emitRequestEvent(env, id, again = "") {
  // ONE CURATOR (MC-31 6b, step 5; curator-events.js): a house whose
  // curator is ChatGPT rings it by event and nothing else; a Claude house
  // rings its routine and never the events. A house that chose neither
  // sends the events, the only curator that could hear them.
  const kind = curatorKind(env);
  if (kind !== "claude") {
    let heard = false;
    try { heard = await sendWorkEvent(env, id, again); } catch (e) { if (e?.budgetExhausted) throw e; }
    if (kind === "chatgpt" || heard) return heard;
  }
  return fireRoutine(env, id, again);
}

// THE DOORBELL BY WEB CALL (MC-31 stage 2, 2026-10-16). The routine's own
// API trigger, rung straight from here. It replaced a file committed to a
// GitHub doorbell repo, whose failure of 2026-10-02 (Claude's GitHub access
// lapsed, and every ring and sweep failed for a day) it cannot have; the
// GitHub path was removed on 2026-10-23. Measured 2026-10-14 and again
// 2026-10-16: the routine wakes in about a second, and the call's `text`
// arrives in its prompt. REQUEST_ROUTINE_ID is the routine (house.json
// requests.routine), REQUEST_ROUTINE_TOKEN its trigger's token, made on the
// routine's page at claude.ai.
export const ROUTINE_FIRE = "https://api.anthropic.com/v1/claude_code/routines";
export const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";
export async function fireRoutine(env, id, again = "") {
  const routine = env.REQUEST_ROUTINE_ID;
  const token = env.REQUEST_ROUTINE_TOKEN;
  if (!routine || !token) return false;
  try {
    const res = await subrequest(env, `${ROUTINE_FIRE}/${encodeURIComponent(routine)}/fire`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": ROUTINE_BETA,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: `request ${id}${again ? " (again)" : ""}` }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// THE RE-FIRE (MC-18 decision 9). A request refused because its guest was
// being written waits for the next wake. The hourly sweep is one; this is
// the other: the fulfilment that has just committed a guest rings again for
// the oldest request still waiting on it, so that set starts in minutes, not
// up to an hour. One ledger read per guest fulfilment, one cloud run only
// when a row waited; its own file name, since the first ring's path exists.
// Best-effort — the sweep stays the fallback — and only while autofulfilment
// is on, like the first ring. Answers the id rung, or null.
export async function refireWaiting(env, destination) {
  if (env.AUTOFULFILL_ENABLED !== "true" || !destination) return null;
  try {
    const led = await station(env, "list", { states: ["pending"], destination });
    const oldest = (led?.rows ?? []).at(-1); // the list is newest first
    if (!oldest) return null;
    return (await emitRequestEvent(env, oldest.id, `.w${Date.now()}`)) ? oldest.id : null;
  } catch {
    return null;
  }
}

// A settled outcome re-puts the request record on the long clock — the
// contract putRequestRecord documents: the page renders the words as long as
// the ledger keeps the row, measured from the settling, and pending text
// never outlives its 30 days when nothing came of it. Best-effort: the row
// is the authority, and a missing record degrades the card, never the state.
export async function settleRecord(env, requestId, record = null) {
  try {
    const rec = record ?? await getRequestRecord(env, requestId);
    if (rec) await putRequestRecord(env, rec, { settled: true });
  } catch { /* the card degrades; the ledger stands */ }
}

// The listener's own words as one line, for `ask:<playlistId>` and for the
// copy a kept record carries. One definition because two would drift, and the
// page compares what it reads in one against what it reads in the other.
export function askLine(record, requestId) {
  return record
    ? [record.mood,
        record.length ? `about ${record.length} min` : null,
        record.avoid ? `avoid: ${record.avoid}` : null]
        .filter(Boolean).join(" — ").slice(0, 300)
    : `listener request ${requestId}`;
}
