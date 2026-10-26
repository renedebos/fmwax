// STARTING MUSIC ON A SPEAKER: what is playing in words, the Connect play
// with its wake-up retries and refusal log, tracks or a playlist on a device.
// Split out of worker.js on 2026-09-26 (consolidation).
import { djForPlaylistId, guestForPlaylistId } from "./house.js";
import {
  catalogFor, playerState, programsKV, resolveDevice, spotify, withBudget,
} from "./services.js";

// THE EXPLICIT FIELD, and why it is shaped the way it is.
//
// Added 2026-09-04, after a set curated under a brief whose hardest rule is
// "never the explicit version" put the album cut of Hollaback Girl on a
// child's button. Nothing was wrong with the curation: the search
// tools returned uri, title, artist, album and duration, so the only way to
// obey that rule was to remember which pressing is clean. A rule the tools
// cannot check is a rule that breaks quietly.
//
// THREE STATES, NOT TWO, because the difference between them is the whole
// point: `true` is the service saying explicit, `null` is the service not
// saying, and ABSENT is the service saying clean. Collapsing "not said" into
// "clean" is exactly the conflation that caused this, so it never happens
// here — a DJ who must not play an explicit record can refuse a null.
export function explicitOf(t) {
  return t.explicit === true ? { explicit: true }
    : typeof t.explicit === "boolean" ? {}
    : { explicit: null };
}

// `released` (2026-09-23): the album's release date, as the service gives it
// — a year, a month or a day. It rides in the same answer, so it costs
// nothing, and without it a curator asked for "new releases in 2026" had no
// way to tell a 2026 record from a 2018 one: one run refused the request for
// exactly that reason, and the next filled it with 2014-2025 records.
export function describeTrack(t) {
  return {
    uri: t.uri,
    title: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    album: t.album?.name,
    ...(t.album?.release_date ? { released: String(t.album.release_date) } : {}),
    duration: `${Math.floor(t.duration_ms / 60000)}:${String(
      Math.floor(t.duration_ms / 1000) % 60).padStart(2, "0")}`,
    ...explicitOf(t),
    // Tidal only: "max" or "high" (tidal.js). Spotify says nothing of it.
    ...(t.quality ? { quality: t.quality } : {}),
  };
}

export function nowPlayingSummary(st) {
  if (!st || !st.item) return { playing: false, note: "nothing is playing" };
  const pos = (ms) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  // An episode has no `artists` and no `album` — mapping them would throw, and
  // a podcast inside a playlist is a real case, not a hypothetical.
  const isEpisode = st.currently_playing_type === "episode"
    || st.item.type === "episode";
  return {
    playing: st.is_playing,
    device: st.device?.name,
    volume: st.device?.volume_percent,
    track: st.item.name,
    ...(isEpisode
      ? {
          kind: "episode",
          show: st.item.show?.name ?? st.item.publisher,
          // Measured 2026-08-26, both halves: an episode left PART WAY through
          // resumes there rather than restarting, but one played to COMPLETION
          // resets and starts from zero next time. Do not state the first half
          // as a general rule — an earlier version did, and it is wrong for the
          // case that matters most.
          note: "This is a podcast episode, not a track. If it was stopped part " +
                "way through, Spotify resumes it there instead of starting over; " +
                "once it has played to the end it resets and starts from zero.",
        }
      : {
          artists: (st.item.artists ?? []).map((a) => a.name).join(", "),
          album: st.item.album?.name,
        }),
    position: `${pos(st.progress_ms)} of ${pos(st.item.duration_ms)}`,
    shuffle: st.shuffle_state,
    repeat: st.repeat_state,
    // Null means a bare track queue: identical to listen to, but a WiiM preset
    // saved over it pins one track instead of storing a pointer. The difference
    // is invisible everywhere except here.
    context: st.context?.uri ?? null,
  };
}

// Success for play_uris is narrow on purpose: THIS set, playing, on the device
// that was asked for. "Something is playing somewhere" is the shape of every
// failure this check exists to catch — a silent speaker that took the stream,
// a play Spotify honoured on the phone instead, or a transfer that resumed
// whatever queue happened to be current.
export function startedHere(st, deviceId, uris) {
  if (!st?.is_playing) return false;
  if (deviceId && st.device?.id !== deviceId) return false;
  // Fail closed on an unidentifiable item. This tool only ever submits
  // spotify:track: URIs, so a target with no readable track id is not evidence
  // that the set is playing — and nowPlayingSummary already calls that state
  // `playing: false`. A spurious warning costs a retry; a false success sends
  // the operator debugging the wrong layer.
  //
  // Accept the relinked id as well. When a requested track is unavailable in
  // the user's market Spotify substitutes an equivalent, reports the
  // substitute in `item.id` and the id that was asked for in
  // `item.linked_from.id`. That is the set playing correctly, and this project
  // asks for exactly the reissued and regional material most likely to relink.
  const ids = [st.item?.id, st.item?.linked_from?.id].filter(Boolean);
  return ids.some((id) => uris.includes(`spotify:track:${id}`));
}

// The same narrow test for a playlist start. `context.uri` is the whole point
// here: it is what makes the playback preset material, so "playing" without it
// is a failure however good it sounds.
export function startedContext(st, deviceId, contextUri) {
  if (!st?.is_playing) return false;
  if (deviceId && st.device?.id !== deviceId) return false;
  return st.context?.uri === contextUri;
}

// Playback is Spotify Connect's alone: the Worker starts a playlist by handing
// Spotify's player a `spotify:playlist:` context, and Tidal offers no such
// path from a server. A Tidal playlist is rewritten from here like any other
// and started from the room — the preset on the remote, or the WiiM app. Said
// before anything is sent, with the button's number when it has one.
export function refuseToStart(env, pl) {
  if (!pl?.catalog || pl.catalog === "spotify") return;
  const label = catalogFor(env, pl.catalog).label;
  const owner = djForPlaylistId(env, pl.id);
  // A live guest is pressed on its own number (MC-18 stage 3).
  const g = guestForPlaylistId(env, pl.id);
  throw new Error(
    `"${pl.name}" is a ${label} playlist, and this server can only start Spotify ` +
    "playlists — playback goes through Spotify Connect, and Tidal has no such " +
    `path from here. ${g?.live ? `Press ${g.btn} on the remote (${g.name})`
      : owner?.btn
      ? `Press ${owner.btn} on the remote (${owner.name}'s button)`
      : "Start it from the WiiM app"}; the playlist itself is unchanged and nothing was sent.`);
}

// PLAY, AND ONCE MORE AFTER A TRANSFER (2026-09-23). The owner pressed
// Play for the Master Bedroom Echo from the Loaded tab and Spotify refused it
// outright; the same playlist, sent to the same speaker a minute later,
// started at once. The likeliest reading is an Echo that was not Spotify's
// active device — the session sat paused on the Pro Plus — turning down the
// first play and taking the second. The read-back retry below each caller
// only runs when Spotify ACCEPTS a play that then does not start; a refusal
// threw past it. So a refused play moves the session to the speaker and asks
// once more — the same two calls that retry uses. Not for a 429 (the quota
// is stamped and a second call spends it) or an error with no status (the
// budget, the network): those are thrown as they were.
//
// And the refusal is written down, because the page's sentence throws
// Spotify's own words away and this Worker keeps no logs: KV `play:refused`,
// a fortnight, one write and only on a refusal; `list_requests` reports it.
export const PLAY_REFUSED_KEY = "play:refused";
//
// And the retry WAITS (2026-09-25). Five Master Bedroom refusals in two days
// said the same thing: the retry sent at once was refused too (17:39, 14:30,
// 09:41), while a play a minute later, or the bar's move with its 1.5 s pause,
// went through. An idle Echo stays in Spotify's list and needs a few seconds
// after the first knock. So: move the session, wait, ask again, and once more
// after a longer wait. Each round is two calls, spent only on a refusal.
export const PLAY_WAKE_WAITS_MS = [1500, 3000];
export const PLAY_REFUSED_LOG_KEY = "play:refused:log";
export const PLAY_REFUSED_LOG_MAX = 20;
export async function playOnDevice(env, deviceId, deviceName, body) {
  try {
    await spotify(env, "PUT", "/me/player/play", { params: { device_id: deviceId }, body });
    return;
  } catch (err) {
    // Only a speaker Spotify cannot reach — 404 (the Echo asleep: "Not
    // found.") or 502 (the command did not get through) — is worth moving
    // the session to and asking again (Codex, 2026-09-24). A 400 or 403 is
    // about the request, and the move would only drag whatever is playing
    // elsewhere onto this speaker before the same refusal.
    if (err?.status !== 404 && err?.status !== 502) {
      await notePlayRefused(env, deviceName, err, null);
      throw err;
    }
    const waits = env.__playWakeWaitsMs ?? PLAY_WAKE_WAITS_MS;
    let again = null;
    let tries = 1;
    for (const ms of waits) {
      tries++;
      try {
        // The move can itself be refused by a speaker still waking; the play
        // after the wait is the answer that counts.
        try {
          await spotify(env, "PUT", "/me/player", { body: { device_ids: [deviceId], play: false } });
        } catch (m) {
          if (m?.status !== 404 && m?.status !== 502) throw m;
        }
        await new Promise((r) => setTimeout(r, ms));
        await spotify(env, "PUT", "/me/player/play", { params: { device_id: deviceId }, body });
        again = false;
        break;
      } catch (e2) {
        again = e2;
        // Only the same kind of refusal earns another wait: a 429, a budget
        // or a request error would be refused the same way again.
        if (e2?.status !== 404 && e2?.status !== 502) break;
      }
    }
    await notePlayRefused(env, deviceName, err, again ?? false, tries);
    if (again) throw again;
  }
}
// `again`: null when no retry was made, false when it worked, the error when not.
// `tries`: the plays sent in all, the first included.
export async function notePlayRefused(env, device, err, again, tries = 1) {
  const said = (e) => String(e?.message ?? e).slice(0, 300);
  // And in the Workers Logs, kept three days (2026-09-23).
  console.warn(`play refused on ${device}: ${said(err)}${again === null ? "" : again === false ? ` — worked on try ${tries}` : ` — ${tries} tries, last: ${said(again)}`}`);
  const rec = {
    at: new Date().toISOString(), device, status: err?.status ?? null, error: said(err),
    retried: again !== null, tries,
    ...(again === null ? {} : again === false ? { retry: "worked" } : { retry: said(again) }),
  };
  try {
    const kv = programsKV(env);
    await kv.put(PLAY_REFUSED_KEY, JSON.stringify(rec), { expirationTtl: 14 * 24 * 3600 });
    // The last twenty, newest first, so a pattern can be read (2026-09-25):
    // the time of day, the speaker, and whether waiting helped. One read and
    // one write, only on a refusal.
    let log = [];
    try { log = (await kv.get(PLAY_REFUSED_LOG_KEY, { type: "json" })) ?? []; } catch { log = []; }
    if (!Array.isArray(log)) log = [];
    log.unshift({ at: rec.at, device, status: rec.status, tries,
      outcome: again === null ? "not retried" : again === false ? "worked" : "failed" });
    await kv.put(PLAY_REFUSED_LOG_KEY, JSON.stringify(log.slice(0, PLAY_REFUSED_LOG_MAX)),
      { expirationTtl: 30 * 24 * 3600 });
  } catch { /* the play's outcome matters more than its record */ }
}

// Start a bare list of Spotify track URIs on a named device and verify it
// took — the play_uris tool, and since 2026-09-10 the shelf's own Play, which
// starts an old set from its record without writing any playlist. One
// function for both so the page cannot drift into a less careful version of
// the tool. The URIs are the caller's to check: this sends what it is given.
export async function startUrisOnDevice(env, uris, deviceName, budget, { positionMs = 0 } = {}) {
  env = withBudget(env, budget);
  const { id: deviceId, warning: deviceWarning } = await resolveDevice(env, deviceName);
  // SHUFFLE SCRAMBLES A SEQUENCED SET and repeat-one pins it to its first
  // track, both while reporting a perfectly good playback state (Codex,
  // 2026-09-10). `startPlaylistOnDevice` has cleared them since 2026-08-30 and
  // this path never did, so a set started from the shelf — or by play_uris,
  // which is the same call — could be reported as playing while the device
  // shuffled it. Best effort and deliberately not fatal: a device that refuses
  // either call should still get the music, and the real state is read back
  // below rather than assumed.
  for (const [path, state] of [
    ["/me/player/shuffle", "false"],
    ["/me/player/repeat", "off"],
  ]) {
    try {
      await spotify(env, "PUT", path, { params: { state, device_id: deviceId } });
    } catch {
      // Reported from the player state, not guessed at.
    }
  }
  // A play-again of a Shelf program starts at the place its pause noted.
  const at = positionMs > 0 ? { position_ms: Math.round(positionMs) } : {};
  await playOnDevice(env, deviceId, deviceName, { uris, ...at });
  await new Promise((r) => setTimeout(r, 1200));
  // Everything above was SENT. From here the outcome is being read back, and a
  // read that fails is not evidence that the play failed — Spotify may well be
  // playing the set by now. Reported as its own state, the way
  // startPlaylistOnDevice has since 2026-08-30; throwing here told the caller
  // "it did not happen" over a room that had just started, which invites a
  // retry that restarts the set (Codex, 2026-09-10).
  let st;
  try {
    st = await playerState(env);
  } catch (err) {
    return {
      started: uris.length,
      playing: null,
      unverified: true,
      requested_device: deviceName,
      warning:
        `Spotify accepted the ${uris.length} tracks for ${deviceName}, but the ` +
        "read-back afterwards failed " +
        `(${String(err?.message ?? err).slice(0, 120)}), so whether they started ` +
        "could not be verified. They may well be playing. Check with now_playing " +
        "before telling the user anything either way.",
      ...(deviceWarning ? { device_warning: deviceWarning } : {}),
    };
  }
  // A Connect endpoint that was idle can accept the stream and never start
  // rendering it: the API reports the transfer, the room stays silent.
  // Spotify can also honour the play on whatever device was last active.
  // Wake the target with an explicit transfer, then RE-ISSUE the URIs —
  // transferring alone resumes whatever queue was already current, which
  // would hand the room an unrelated old track while this still reported
  // the set as started.
  //
  // `play: false` means "keep the current playback state", NOT "pause", so
  // if some other device was mid-track the target can briefly pick that up
  // before the URIs land. The two calls therefore go back-to-back with no
  // wait between them, bounding the blip to one round trip. That window is
  // not closable from here without pausing playback the user may have
  // started deliberately; `play: true` would widen it, not close it.
  if (!startedHere(st, deviceId, uris)) {
    try {
      await spotify(env, "PUT", "/me/player", {
        body: { device_ids: [deviceId], play: false },
      });
      await spotify(env, "PUT", "/me/player/play", {
        params: { device_id: deviceId },
        body: { uris, ...at },
      });
      await new Promise((r) => setTimeout(r, 2000));
      st = await playerState(env);
    } catch {
      // Keep the pre-retry reading rather than losing the diagnosis.
    }
  }
  const result = { started: uris.length, ...nowPlayingSummary(st) };
  // Gate the verdict on the same narrow test, not on `playing` alone: a
  // failed retry can leave a reading in which some other device is happily
  // playing something else, and that must not read as success.
  if (!startedHere(st, deviceId, uris)) {
    result.requested_device = deviceName;
    result.warning =
      `Spotify accepted the tracks but they are not playing on ${deviceName}. ` +
      "The device is probably asleep or switched to another input; the rest of " +
      "this reading is whatever Spotify is doing instead, which may be another " +
      "room or another track. Press play on the device once, or start anything " +
      "on it briefly, then ask again. Tell the user this — do NOT report the " +
      "set as playing.";
  } else {
    // PLAYING IS NOT PLAYING IN ORDER. Both modes were cleared above on a
    // best-effort basis and both failures are swallowed there, so the read-back
    // is where they are caught — and the first track playing satisfies every
    // other check, which is exactly how a shuffled set reads as a good one.
    if (st?.repeat_state === "track") {
      result.repeat_warning =
        "Repeat-one is still on and would not turn off, so this will play the " +
        "first track over and over instead of the set. Tell the user to clear " +
        "repeat on the device or in Spotify.";
    }
    if (st?.shuffle_state) {
      result.shuffle_warning =
        "Shuffle is still on and would not turn off, so the set is playing out " +
        "of order — and the order is the set. Tell the user to clear shuffle on " +
        "the device or in Spotify.";
    }
  }
  if (deviceWarning) result.device_warning = deviceWarning;
  return result;
}

// Start a saved playlist on a named device and verify it actually took —
// shared by the play_playlist tool and the buttons page's POST, so the page
// cannot drift into a less careful version of the same action. Returns the
// tool-shaped result (verification, warnings, player summary); the callers add
// their own naming on top.
export async function startPlaylistOnDevice(env, pl, deviceName, budget, from = null) {
  env = withBudget(env, budget);
  refuseToStart(env, pl);
  const contextUri = `spotify:playlist:${pl.id}`;
  // `from` (MC-21's play-again): start the set at a track and a position
  // instead of its top — where the now bar's pause stopped it.
  const body = { context_uri: contextUri,
    ...(from?.uri ? { offset: { uri: from.uri }, position_ms: Math.max(0, Number(from.positionMs) || 0) } : {}) };
  const { id: deviceId, warning: deviceWarning } = await resolveDevice(env, deviceName);
  // Shuffle scrambles a sequenced set; repeat-one pins it to its first track
  // while still reporting a perfectly good playlist context. Both defeat the
  // ordering silently, which is why neither is treated as a user preference
  // worth preserving. Best effort, and deliberately not fatal: a device that
  // refuses either call should still get the music, and the real state is
  // read back below rather than assumed.
  for (const [path, state] of [
    ["/me/player/shuffle", "false"],
    ["/me/player/repeat", "off"],
  ]) {
    try {
      await spotify(env, "PUT", path, { params: { state, device_id: deviceId } });
    } catch {
      // Reported from the player state, not guessed at.
    }
  }
  await playOnDevice(env, deviceId, deviceName, body);
  await new Promise((r) => setTimeout(r, 1200));
  // Everything above was SENT. From here the outcome is being read back, and a
  // read that fails is not evidence that the play failed — Spotify may well be
  // playing the set by now. Reported as its own state, because the alternative
  // was "Nothing was changed" over a room that had just started.
  let st;
  try {
    st = await playerState(env);
  } catch (err) {
    return {
      playing: null,
      preset_safe: false,
      unverified: true,
      requested_device: deviceName,
      warning:
        `Spotify accepted the request to start "${pl.name}" on ${deviceName}, ` +
        "but the read-back afterwards failed " +
        `(${String(err?.message ?? err).slice(0, 120)}), so whether it started ` +
        "could not be verified. It may well be playing. Check with now_playing " +
        "before telling the user anything either way, and do NOT tell them to " +
        "save a preset until it is confirmed.",
      ...(deviceWarning ? { device_warning: deviceWarning } : {}),
    };
  }
  if (!startedContext(st, deviceId, contextUri)) {
    try {
      await spotify(env, "PUT", "/me/player", {
        body: { device_ids: [deviceId], play: false },
      });
      await spotify(env, "PUT", "/me/player/play", {
        params: { device_id: deviceId },
        body,
      });
      await new Promise((r) => setTimeout(r, 2000));
      st = await playerState(env);
    } catch {
      // Keep the pre-retry reading rather than losing the diagnosis.
    }
  }
  const result = { ...nowPlayingSummary(st) };
  if (startedContext(st, deviceId, contextUri)) {
    result.preset_safe = true;
    if (st?.repeat_state === "track") {
      // The pointer is fine, so this is not a preset problem — it is a
      // listening problem, and a loud one. Keep the two separate.
      result.repeat_warning =
        "Repeat-one is still on and would not turn off, so this will play " +
        "the first track over and over instead of the set. Tell the user to " +
        "clear repeat on the device or in Spotify.";
    }
    // Shuffle was cleared on a best-effort basis above and the failure is
    // swallowed. Reporting only repeat left the worse case silent: shuffle
    // destroys sequence, and sequence IS the content for a writer's set —
    // "if it could be shuffled without loss, the argument was never there", as
    // the Professor's brief had it (he was cut, 2026-10-15).
    if (st?.shuffle_state) {
      result.shuffle_warning =
        "Shuffle is still on and would not turn off. The set will play in " +
        "a random order, which for a sequenced set is not a small problem — " +
        "tell the user to clear shuffle on the device or in Spotify before " +
        "listening.";
    }
    result.note =
      "Playing AS A PLAYLIST, so a WiiM preset saved right now stores a " +
      "pointer to it rather than pinning one track. Tell the user they can " +
      "save the slot in the WiiM app; the preset should then show the " +
      "playlist name, and a track name instead means it pinned a song.";
  } else {
    result.preset_safe = false;
    result.requested_device = deviceName;
    result.warning =
      `Spotify accepted it but "${pl.name}" is not playing on ${deviceName} ` +
      "as a playlist. The device may be asleep or on another input, or " +
      "playback landed elsewhere; the rest of this reading is whatever " +
      "Spotify is doing instead. Do NOT tell the user to save a preset — a " +
      "slot saved now would capture the wrong thing. Say what happened and " +
      "have them press play on the device once, then ask again.";
  }
  if (deviceWarning) result.device_warning = deviceWarning;
  return result;
}
