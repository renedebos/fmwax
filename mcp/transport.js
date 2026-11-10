// THE BAR'S TRANSPORT, SHARED (MC-38 stage 3, tasks/mc38-alexa-skill.md):
// pause, play again, skip and move, as the now bar has them, for the bar's
// own route (routes.js /transport) and house radio's door (alexa.js) alike.
// Moved here from the route unchanged, so the bar's behaviour is what it was:
// each reads the player fresh and acts only on the speaker named, so a
// request minutes old never acts on another room. Each answers the bar's
// own code: "ok", "sent", "gone" (not playing there), "quiet" (nothing
// plays), "here" (already there), "expired" (nothing paused there),
// "asleep", "stuck", "failed". The home helper's verbs stay in the route:
// they are the bar's alone.

import { endlessAfterSkip, sleptThrough } from "./endless.js";
import { dropPauseNote, nowAnswer, PAUSE_NOTE_KEY, PAUSE_NOTE_MS, readPauseNote, roomPlaying, shelfQueueFor } from "./now.js";
import { startPlaylistOnDevice, startUrisOnDevice } from "./playback.js";
import { readReadings } from "./room.js";
import { playerState, programsKV, resolveDevice, spotify, withBudget } from "./services.js";
import { moveTo } from "./shelf.js";

const fold = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// A SPOTIFY PAUSE, WRITTEN DOWN (MC-21): the device Spotify plays on is
// paused, and what stopped is kept as the bar's pause note, so the bar says
// "Paused · song" and can play it again. The bar's disc and, since the
// review of 2026-10-09, the Loaded bands and the DJ page's circle pause
// through this. The note is null when only the note could not be kept.
export async function pauseNoted(env, envB, st, deviceName, boxes) {
  await spotify(envB, "PUT", "/me/player/pause", { params: { device_id: st.device.id } });
  const p = roomPlaying(st);
  const bar = await nowAnswer(env, null, p, { recs: await readReadings(env, boxes) });
  const shelf = await shelfQueueFor(env, p);
  const noted = {
    at: Date.now(), device: deviceName, track: p?.track ?? null, artists: p?.artists ?? null,
    uri: p?.uri ?? null, pid: p?.pid ?? null, positionMs: Number(st.progress_ms) || 0,
    // The sleeve and the album, from the same read (the owner, 2026-11-02:
    // "why does the bar not show the cover" a few minutes into a pause).
    ...(p?.art ? { art: p.art } : {}), ...(p?.album ? { album: p.album } : {}),
    // A request's DJ goes with its pause, so "Paused" names them too.
    ...(bar.preset ? { preset: { ...bar.preset, ...(bar.guest && bar.who?.kind === "request" && bar.who.name
      ? { dj: bar.who.name } : {}) } } : bar.from ? { from: bar.from } : {}),
    // A song on the program twice says nothing about which one
    // this is, so no play-again then: it would replay the middle
    // (Codex, 2026-09-24).
    ...(shelf && shelf.uris.indexOf(p.uri) === shelf.uris.lastIndexOf(p.uri)
      ? { program: shelf.slug, uris: shelf.uris.slice(shelf.uris.indexOf(p.uri)) } : {}),
  };
  try {
    await programsKV(env).put(PAUSE_NOTE_KEY, JSON.stringify(noted), { expirationTtl: PAUSE_NOTE_MS / 1000 });
  } catch { return null; /* the pause happened; only the note is lost */ }
  return noted;
}

// PLAY AGAIN what the bar's pause wrote down, on the speaker it was paused
// on: a fresh start of that set from the paused song, never Spotify's resume.
export async function playAgainOn(env, box) {
  let code = "ok";
  const note = await readPauseNote(env);
  if (!(note?.pid || note?.uris?.length) || fold(note.device) !== fold(box.name)) {
    code = "expired";
  } else if (!note.pid) {
    // A Shelf program: the rest of its list, from the paused song.
    try {
      const out = await startUrisOnDevice(env, note.uris, box.name, { remaining: 16 }, { positionMs: note.positionMs });
      // `unverified` carries a warning too, so it goes first (Codex,
      // 2026-09-24). A shuffle or repeat warning is still the song
      // playing; the bar has no words for it and the next pause
      // notes whatever plays.
      code = out.unverified ? "sent" : out.warning ? "stuck" : "ok";
    } catch (err) {
      code = err?.noSuchDevice ? "asleep" : "failed";
    }
    if (code === "ok" || code === "sent") await dropPauseNote(env);
  } else {
    try {
      const out = await startPlaylistOnDevice(env, { id: note.pid, name: note.track ?? "the set", catalog: "spotify" },
        box.name, { remaining: 16 }, { uri: note.uri, positionMs: note.positionMs });
      code = out.preset_safe ? "ok" : out.unverified ? "sent" : "stuck";
    } catch (err) {
      code = err?.noSuchDevice ? "asleep" : "failed";
    }
    if (code === "ok" || code === "sent") await dropPauseNote(env);
  }
  return { code };
}

// SKIP forward ("next") or back ("prev") on the speaker named, if Spotify is
// playing there.
export async function skipOn(env, ctx, box, verb = "next") {
  let code = "ok";
  // SKIP, FROM THE NOW PANEL (2026-09-25, design A): Spotify only, and
  // only the speaker the panel names, read fresh as the pause reads
  // it, so a skip on a panel minutes old never skips another room.
  const envB = withBudget(env, { remaining: 6 });
  try {
    const st = await playerState(envB);
    if (!st?.device?.id || st.is_playing !== true || fold(st.device.name) !== fold(box.name)) code = "gone";
    else {
      await spotify(envB, "POST", verb === "next" ? "/me/player/next" : "/me/player/previous", { params: { device_id: st.device.id } });
      // A skip forward on an endless list may leave it short: asked
      // now, after the answer goes out (endlessAfterSkip).
      const pid = String(st.context?.uri ?? "").match(/^spotify:playlist:([A-Za-z0-9]{22})$/)?.[1] ?? null;
      if (verb === "next" && pid && st.item?.uri) {
        const ask = endlessAfterSkip(env, { pid, uri: st.item.uri }).catch(() => null);
        if (ctx?.waitUntil) ctx.waitUntil(ask); else await ask;
      }
    }
  } catch (e) {
    code = e?.status === 404 ? "gone" : "failed";
  }
  return { code };
}

// MOVE what plays to the speaker named: Spotify's own transfer.
export async function moveOn(env, box) {
  let code = "ok";
  // MOVE WHAT IS PLAYING (the owner, 2026-09-24: "Play on" in the
  // bar's panel only pointed the app at the Master Bedroom, and the
  // music carried on on the Pro Plus). Spotify Connect's own
  // transfer, as the Spotify app does it: same song, same place, the
  // other speaker. Only while something plays; "quiet" otherwise, and
  // the tap stays what it was, the speaker for the next Play.
  const envB = withBudget(env, { remaining: 10 });
  try {
    const st = await playerState(envB);
    if (!st?.device?.id || st.is_playing !== true) code = "quiet";
    else if (fold(st.device.name) === fold(box.name)) code = "here";
    else {
      const { id } = await resolveDevice(envB, box.name);
      if (!id) throw Object.assign(new Error("no id"), { noSuchDevice: true });
      await moveTo(envB, id, st);
    }
  } catch (e) {
    code = sleptThrough(e) ? "asleep" : "failed";
  }
  return { code };
}

// PAUSE the speaker named, if Spotify is playing there, and write it down.
// `boxes` is the house's WiiMs (parseSpeakers), for the note's preset.
export async function pauseOn(env, box, boxes) {
  let code = "ok";
  let noted = null;
  const budget = { remaining: 8 };
  const envB = withBudget(env, budget);
  try {
    const st = await playerState(envB);
    if (!st?.device?.id || st.is_playing !== true || fold(st.device.name) !== fold(box.name)) {
      code = "gone";
    } else {
      noted = await pauseNoted(env, envB, st, box.name, boxes);
    }
  } catch (e) {
    code = e?.status === 404 ? "gone" : "failed";
  }
  return { code, noted };
}
