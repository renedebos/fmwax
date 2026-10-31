// THE PAGES AND THEIR ROUTES: handleRequest, every URL the house serves.
// Split out of worker.js on 2026-09-26 (consolidation).
import { RULES_MD } from "./rules.js";
import {
  TEMPLATE_VERSION, clock, renderProgram, standfirst, renderLibrary, renderRoom,
  PAUSED_WORDS, renderDjRoom, tuneForm, renderRefusal, renderSpeakersNow, shutWords, helperKeyWords, renderUse, renderRules, renderSpotify,
  renderReadings, renderDeck, renderTalk, plural, waitWords, serviceLink, sameName, renderWhichDj, renderSetup,
} from "./programs.js";
import { DJ_ASKS, GLANCE, GLANCE_NOW, WHICH, WHICH_NEEDS, WHICH_SCRIPTS } from "./djs.js";
import {
  CAP_MINUTES, BEAT_MS, IDLE_CLOSE_MS, VOICE_CENTS_PER_MINUTE, VOICE_MODEL, backendModel,
  houseDay, originCheck, contentTypeCheck, capFrom, CAP_RE, mintCap, parseToolCall,
  speakerRule, canonicalDevice, voicePrompt, backendPrompt,
} from "./voice.js";
import { iconBytes } from "./icons.js";
import { githubRepo, updateFacts } from "./updates.js";
import { MADE_KEYS, choosePageSetting, choosePageSettings, claimedInStore, giveHouseKey, houseClaimed, noteSeen, renewHouseKey } from "./settings.js";
import { claimHouse, cookieToken, ensureClaimMark, ensureHouseKeys, helperPairCheck, helperPairCode, helperPairFirst, isOwner, newRecoveryCode, ownerCookie, ownerState, recoverOwner, sameSecret, SETUP_KEY_MIN, setupOpen, signOutOthers } from "./claim.js";
import { setupChecklist, zoneValid } from "./checklist.js";
import { checkHouse, makeBackup, restoreBackup } from "./backup.js";
import { READ_ENVELOPE, READ_ACTION, CONTROL_PORT, CONTROL_PATH } from "./keymap.js";
import { CATALOGS } from "./catalog.js";
import {
  station, stationStub, normalizeRequest, makeRequestId, fingerprintUris, putRequestRecord,
  getRequestRecord,
} from "./station.js";
import {
  STATION_GATE, STATION_KEY, archiveClock, archiveStreamUrl, loadArchive, readStation,
  stationWindow,
} from "./archive.js";
import {
  deckLane, endlessAssign, endlessBar, endlessJson, endlessLoad, endlessLogRows, endlessNoStart, endlessOnDeck, endlessOnPage,
  endlessOwed, endlessPageSteer, endlessPresets, endlessSlots, endlessStartFresh,
  endlessUpdate, forgetPreset, houseDjRoom, MAX_HOUSE_DJS, parseEndless, playEndless, readNoStart, retiredKey,
  nextPressWords, sleptThrough, startsOn, tabOwed, tabState, talkEndless, talkOn, toSaveKey, vibeHourWords,
} from "./endless.js";
import {
  askDay, askedTag, atWords, destinationFor, djPlaces, djSlotsExist, findDj, guestAlias,
  GUEST_ASK_WINDOW_MS, guestAsks, guestFor, guestForPlaylistId, guestHolders, guestLabel, helperKeyFlash, house,
  houseClockWords, liveGuests, loadedWords, newestOn, parseButtons, pastTheList, playableKeys, presetFlash,
  presetOnFile, ownKeyName, ownPresetRows, programDj, rulesFacts, shelfFor, sinceWords, speakerPresetFor, transportFlash,
} from "./house.js";
import { SERVER_INFO, handleRpc, requestVersion, rpcError } from "./mcp.js";
import { workWaiting } from "./waiting.js";
import { curatorKind, sendWorkEvent, workSubscriptions } from "./curator-events.js";
import { WATCH_FACTS, firstSet, helperSaw, setupFacts } from "./setup-watch.js";
import {
  PAUSE_NOTE_KEY, PAUSE_NOTE_MS, configuredPlaylistId,
  dropPauseNote, helperCommand, helperGot, helperKeyFor, helperPause, helperPress, helperView, helperViewOf, housePlayer,
  lanOnGuest, listLink, nowAnswer,
  otherRooms, parseHelperReading, pauseNoteBeside, pausedFor, pickCheap, pickCookie, pickFor,
  playingFromFor, readPauseNote, roomPlaying, shelfQueueFor, shelfTidalKey, speakerFor,
  speakerKind, sameStation, stationKey,
} from "./now.js";
import { startPlaylistOnDevice, startUrisOnDevice } from "./playback.js";
import { SNAP_KEY, pooled, undoToSnapshot } from "./playlists.js";
import {
  ARCHIVE_DJ, ITEMS_TTL_MS, READING_MAX_BYTES, ROOM_ARCHIVE_TILE, ROOM_NEW_PROGRAM_MS,
  catalogAvailable, driftOf, fallbackDevice, keepReading, parseM3uEntries, parseRoomDevices, parseSpeakers,
  readReadings, readTiles, readingWords, readingsShown, roomRoster, speakerSlug, tileFor, wiimNames,
  writeTiles,
} from "./room.js";
import {
  PLAYER_DEADLINE_MS, PLAYER_PENDING, WALL_PLAYER_WAIT_MS, catalogFor,
  houseCatalogNames, kvOps, minutesLeft, playerState, playlistItems, programsKV, reachableDj,
  deviceDisplayName, nameDevice, resolveDevice, setService, spotify, spotifyCalls,
  subrequest, throttledUntil, tokensKV, totalDuration, withBudget, curatorQuietSince, curatorSeenAt, stampCurator, spotifyLogin,
  CURATOR_SEEN_KEY, fold,
} from "./services.js";
import { CALLBACK_PATH, callbackUrl, finishLogin, startLogin } from "./spotify-login.js";
import {
  flashFor, listProgramSummaries, moveTo, pickImage, playedFlash, programBaseUrl,
  playShelfSet, programCatalog, programSpotifyUris, shelfElsewhere, shelfFilter, shelfFilterQs, shelfFind, shelfState,
} from "./shelf.js";
import { VOICE_TOOLS, VOICE_WRITERS, voiceFunctions, voiceWriterCall, writerKindFor } from "./toollist.js";
import { callTool } from "./tools.js";
import { TUNING_SETTING, dialsOf, tuneDials, tuningFromForm, tuningOf, tuningSummary, tuningWith } from "./tuning.js";
import { activateProgram, emitRequestEvent, fireRoutine } from "./writes.js";
import { ARCHIVE } from "./archive-identity.js";

// Deliberately 404, never 401. A 401 tells an MCP client "authenticate with me",
// which sends claude.ai off to OAuth discovery and dynamic client registration
// against a sign-in service this server does not have. 404 says "nothing here",
// so the client connects unauthenticated to the one URL that does work — the one
// carrying the secret in its path. It also stops a wrong guess confirming that
// the endpoint exists.
export function notFound() {
  return new Response("not found", { status: 404 });
}

// A body read with a CEILING (Codex, MC15BCD-9Q4): content-length first,
// then the stream up to the limit, refused past it — so a large body is
// never held whole before being cut. null means too large.
export async function readBounded(request, max) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      try { await reader.cancel(); } catch { /* already gone */ }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

// A SPOTIFY PAUSE, WRITTEN DOWN (MC-21): the device Spotify plays on is
// paused, and what stopped is kept as the bar's pause note, so the bar says
// "Paused · song" and can play it again. The bar's disc and, since the
// review of 2026-10-09, the Loaded bands and the DJ page's circle pause
// through this. The note is null when only the note could not be kept.
async function pauseNoted(env, envB, st, deviceName, boxes) {
  await spotify(envB, "PUT", "/me/player/pause", { params: { device_id: st.device.id } });
  const p = roomPlaying(st);
  const bar = await nowAnswer(env, null, p, { recs: await readReadings(env, boxes) });
  const shelf = await shelfQueueFor(env, p);
  const noted = {
    at: Date.now(), device: deviceName, track: p?.track ?? null, artists: p?.artists ?? null,
    uri: p?.uri ?? null, pid: p?.pid ?? null, positionMs: Number(st.progress_ms) || 0,
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

// What a Talk call started on its speaker (2026-10-10): the starts, a resume,
// an endless DJ that took or is being made there, the archive the helper
// pressed. Anything else chose no speaker.
const TALK_ENDLESS_STARTS = new Set(["started", "carry-on", "own-preset", "already", "making", "next"]);
// The home helper's Remove, back from its 303 (2026-10-21).
const HELPER_REMOVED_SAID = {
  removing: "The helper is taking itself off that computer. This page says Not connected once it has gone.",
  "helper-off": "No helper is connected right now, so nothing was removed. Turn its computer on and try again, or remove it on that computer (below).",
  timeout: "The helper did not answer. Try again in a minute.",
  "not-installed": "That helper was set up by hand, not by the install command, so it cannot remove itself. Remove it on its computer.",
  failed: "That did not work. Try again in a minute.",
};
function talkStarted(name, args, out) {
  if (name === "play_playlist" || name === "play_program") return true;
  if (name === "playback_control") return args?.action === "resume";
  if (name === "play_endless") return TALK_ENDLESS_STARTS.has(out?.status) && (!out?.start || out.start === "ok");
  if (name === "play_archive") return out?.started === true;
  return false;
}
// What a caught error may say back to Talk's page (2026-10-25, CodeQL on the
// public copy): a refusal the house wrote (an Error, said aloud by the desk)
// as written; a fault in the code (a TypeError and its kin) or anything
// thrown that is not an Error, only that something went wrong. The log
// keeps the detail either way.
const FAULTS = [TypeError, ReferenceError, SyntaxError, RangeError, EvalError, URIError];
export function talkErrorWords(err) {
  if (err instanceof Error && !FAULTS.some((F) => err instanceof F)) return String(err.message).slice(0, 2000);
  return "Something went wrong in the house. Try again in a moment.";
}
// The archive preset, for Talk's prompts (2026-10-10), or null in a house
// without one.
// Its WiiMs are where the home helper can start it.
const talkArchive = (env) => (house(env).archive?.btn
  ? { btn: house(env).archive.btn, wiims: parseSpeakers(env).map((b) => b.name) } : null);

export async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);

    // www is a second Custom Domain, and it exists only so that typing it does
    // not dead-end. It redirects rather than serving: one canonical host keeps
    // every link that goes out matching the ones PROGRAM_BASE_URL builds, and a
    // programme reachable at two addresses is a programme that gets forwarded
    // at both. Keyed on the exact hostname, www. and the house's own
    // (PROGRAM_BASE_URL's), so the workers.dev host — which preset 6 and the
    // connector name — is untouched.
    const ownHost = (() => { try { return new URL(env.PROGRAM_BASE_URL).hostname; } catch { return null; } })();
    if (ownHost && url.hostname === `www.${ownHost}`) {
      url.hostname = ownHost;
      return Response.redirect(url.toString(), 301);
    }

    // A SETUP ADDRESS TYPED WITH A SLASH AT THE END (the first Windows
    // laptop, 2026-10-21: "/setup/" answered "not found"): sent to the same
    // page without it. A link's #key goes along; the browser keeps it.
    if ((request.method === "GET" || request.method === "HEAD") && /^\/setup(\/[a-z-]+)*\/$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/+$/, "");
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, server: SERVER_INFO });
    }

    // THE HOME HELPER'S DOOR (MC-25). Its own secret, never MCP_SECRET; no
    // secret configured, no door (the same 404 as a wrong guess). It takes a
    // reading and stores it; it answers nothing about the house.
    if (url.pathname === "/helper/reading") {
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!env.HELPER_SECRET || !sameSecret(bearer, env.HELPER_SECRET)) return new Response("not found", { status: 404 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body = null;
      try { body = await request.json(); } catch { body = null; }
      const speakers = parseHelperReading(env, body);
      if (!speakers) return Response.json({ ok: false, code: "no-speakers" }, { status: 400 });
      await station(env, "helper-put", { doc: { at: Date.now(), speakers } });
      return Response.json({ ok: true, speakers: Object.keys(speakers) });
    }
    // ITS PRESET READINGS (MC-25): the table the helper read from a speaker
    // (GetKeyMapping, a read), kept exactly as the phone's shortcut's is.
    const helperPresets = url.pathname.match(/^\/helper\/presets\/([a-z0-9-]{1,40})$/);
    if (helperPresets) {
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!env.HELPER_SECRET || !sameSecret(bearer, env.HELPER_SECRET)) return new Response("not found", { status: 404 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const box = parseSpeakers(env).find((sp) => sp.slug === helperPresets[1]);
      if (!box) return Response.json({ ok: false, code: "no-speaker" }, { status: 404 });
      const text = await request.text().catch(() => "");
      if (text.length > READING_MAX_BYTES) return Response.json({ ok: false, code: "too-big" }, { status: 413 });
      const kept = await keepReading(env, box, text, "helper");
      return Response.json(kept.ok ? { ok: true, presets: kept.presets.length } : { ok: false, code: kept.bad ? "bad" : "not-kept" },
        { status: kept.ok ? 200 : kept.bad ? 400 : 500 });
    }
    // ITS WIIMS (MC-31 stage 5, 2026-10-19: the helper for other houses). GET:
    // the WiiMs this house names and the addresses it knows (the owner's
    // house: its file's), so a helper needs no file of its own. POST: a
    // door-made house learns them from its helper, which found them on the
    // home network: the names chosen at setup, when there are any, matched
    // by the WiiMs' own names. The owner's house keeps its file's.
    if (url.pathname === "/helper/speakers") {
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!env.HELPER_SECRET || !sameSecret(bearer, env.HELPER_SECRET)) return new Response("not found", { status: 404 });
      const learns = setupOpen(env);
      if (request.method === "GET") {
        return Response.json({ ok: true, names: wiimNames(env), learns,
          speakers: Object.fromEntries(parseSpeakers(env).map((b) => [b.name, b.ip])) }, { headers: { "cache-control": "no-store" } });
      }
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      if (!learns) return Response.json({ ok: false, code: "from-file" }, { status: 409 });
      let body = null;
      try { body = await request.json(); } catch { body = null; }
      // Who was asked for at setup, never the last learned list, so a WiiM can
      // be learned again at a new address.
      const wanted = wiimNames({ ...env, WIIM_SPEAKERS: undefined });
      const given = body?.speakers && typeof body.speakers === "object" && !Array.isArray(body.speakers) ? body.speakers : {};
      const kept = {};
      for (const [n, ip] of Object.entries(given).slice(0, 8)) {
        if (typeof n !== "string" || !n.trim() || n.length > 60 || typeof ip !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
        const name = wanted.length ? wanted.find((w) => fold(w) === fold(n)) : n.trim();
        if (name) kept[name] = ip;
      }
      if (!Object.keys(kept).length) return Response.json({ ok: false, code: "no-speakers", wanted }, { status: 400 });
      await choosePageSetting(env, "WIIM_SPEAKERS", JSON.stringify(kept));
      return Response.json({ ok: true, speakers: kept });
    }
    // WHETHER THE HOUSE SEES ITS LINE (2026-09-24, 22:30): the helper asks
    // once a minute and reconnects when the answer is no, whatever its own
    // socket believes. The same secret; it says nothing else about the house.
    if (url.pathname === "/helper/status") {
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!env.HELPER_SECRET || !sameSecret(bearer, env.HELPER_SECRET)) return new Response("not found", { status: 404 });
      let hands = false, read = null;
      try {
        const h = await station(env, "helper-get", {});
        hands = !!h?.hands;
        // AND WHAT IT LAST READ (MC-31 stage 5; Codex, 2026-10-19: a line is
        // not a WiiM read): when, and each WiiM's state, for the installer.
        if (h?.doc?.at) read = { at: h.doc.at, speakers: Object.fromEntries(Object.entries(h.doc.speakers ?? {}).map(([n, r]) => [n, r?.state ?? null])) };
      } catch { hands = false; }
      return Response.json({ ok: true, hands, ...(read ? { read } : {}) });
    }
    // THE PAIRING (the first Windows laptop, 2026-10-21): the code in the
    // setup page's command, traded for the helper's key by the install. A
    // house set up on its page only (the owner's keeps its key by hand).
    if (url.pathname === "/helper/pair") {
      if (!setupOpen(env) || !env.HELPER_SECRET) return notFound();
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body = null;
      try { body = await request.json(); } catch { body = null; }
      // Once only (the locks review, 2026-10-25): a code copied from a
      // terminal's history, or sent twice, gives the key the first time.
      let said = await helperPairCheck(env.HELPER_SECRET, body?.code);
      if (said === "ok" && !(await helperPairFirst(env, body.code))) said = "used";
      return said === "ok"
        ? Response.json({ ok: true, key: env.HELPER_SECRET }, { headers: { "cache-control": "no-store" } })
        : Response.json({ ok: false, code: said }, { status: said === "expired" || said === "used" ? 410 : 403, headers: { "cache-control": "no-store" } });
    }
    // A HELPER TAKEN AWAY (2026-10-21): its remover says so, and the house
    // forgets what it last read, so no page goes on saying "helper off" for
    // a helper that is gone, and the setup page offers it again.
    if (url.pathname === "/helper/forget") {
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!env.HELPER_SECRET || !sameSecret(bearer, env.HELPER_SECRET)) return new Response("not found", { status: 404 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      await station(env, "helper-forget", {});
      return Response.json({ ok: true });
    }
    // Its line for commands (stage 2): the same secret, then the upgrade goes
    // to the ledger, which holds the socket.
    if (url.pathname === "/helper/socket") {
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!env.HELPER_SECRET || !sameSecret(bearer, env.HELPER_SECRET)) return new Response("not found", { status: 404 });
      if (request.headers.get("upgrade") !== "websocket") return new Response("upgrade required", { status: 426 });
      return stationStub(env).fetch(request);
    }

    // A playlist file for the WiiM, deliberately OUTSIDE the secret path.
    //
    // The Worker has no LAN route to the speaker, so it can never tell the WiiM
    // to play something. The speaker has to do the fetching, which means this
    // must be reachable with no header the WiiM cannot send — and a preset can
    // then hold this URL forever while what it serves is rewritten underneath.
    // Same pointer trick as a Spotify playlist, one layer lower down.
    //
    // The id is the only thing guarding it, and it guards very little: every
    // URL inside is already public on the archive's site. Treat it as unlisted, not
    // secret.

    // THE APP ICON (MC-14): three sizes, public — an icon is not a secret —
    // served from memory (icons.js), so no asset binding and a cache the
    // phone can keep.
    const icon = url.pathname.match(/^\/(icon-192\.png|icon-512\.png|apple-touch-icon\.png)$/);
    if (icon) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("icons answer GET only\n", { status: 405 });
      }
      return new Response(request.method === "HEAD" ? null : iconBytes(icon[1]), {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }
    const m3u = url.pathname.match(/^\/archive\/([A-Za-z0-9_-]{1,64})\.m3u$/);
    if (m3u) {
      // A ROTATING SET, if one is parked on this key: the speaker's own re-read
      // is what turns the page. Ahead of the stored file, and falling back to
      // it, so a house that has never parked a set is untouched.
      const station = await readStation(env, m3u[1]);
      if (station) {
        const now = Date.now();
        const win = stationWindow(station, now);
        let served = "";
        try {
          const { byRef } = await loadArchive(env, null);
          const takes = win.refs.map((r) => byRef.get(r)).filter(Boolean);
          if (takes.length) {
            served = "#EXTM3U\n" + takes.map((t) =>
              `#EXTINF:${t.seconds ?? 0},${t.artist} - ${t.song} (${t.venue}, ${t.date})\n` +
              archiveStreamUrl(env, t)).join("\n") + "\n";
            if (win.moved) {
              // The gate for the NEXT turn, measured from what was just served.
              // Written in the same put as the position, so the rotation costs
              // one KV write per turn and none per extra ask.
              const secs = takes.reduce((n, t) => n + (t.seconds ?? 0), 0);
              station.pos = win.pos;
              station.nextAt = now + Math.max(60, secs * STATION_GATE) * 1000;
            }
            // Every ask is stamped, moved or not — this is the measurement of
            // how often the device actually comes back, and it rides along
            // rather than costing a write of its own.
            station.asks = [...(station.asks ?? []), now].slice(-40);
            if (win.moved || (station.asks.length % 4) === 0) {
              try { await tokensKV(env).put(STATION_KEY(m3u[1]), JSON.stringify(station)); }
              catch { /* the window repeats rather than skipping: safe either way */ }
            }
          }
        } catch { /* falls through to the stored file below */ }
        if (served) {
          return new Response(served, {
            headers: {
              "content-type": "audio/x-mpegurl; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        }
      }
      const body = await tokensKV(env).get(`m3u:${m3u[1]}`);
      if (!body) return new Response("no such playlist", { status: 404 });
      return new Response(body, {
        headers: {
          "content-type": "audio/x-mpegurl; charset=utf-8",
          // The whole point is that the contents change under a fixed URL, so
          // nothing here may be cached. A stale copy is a button that plays
          // last week's set and looks like it is working.
          "cache-control": "no-store",
        },
      });
    }

    // A program's article. Unlisted rather than secret, and for a different
    // reason from /archive and /voice above: those are public because a dumb
    // speaker has to fetch them and cannot send a header. A browser can send
    // headers. This one is public so the URL is a thing you can bookmark, text
    // yourself, or send to someone, with no login and no credential in it.
    //
    // What guards it is that the slug carries random characters and there is no
    // index route — /programs and /programs/ fall through to the gate below and
    // 404. list_programs stays behind the secret.
    const prog = url.pathname.match(/^\/programs\/([a-z0-9-]{1,64})$/);
    if (prog) {
      const rec = await env.PROGRAMS?.get(`program:${prog[1]}`, { type: "json" });
      if (!rec) {
        // KV caches a negative lookup at the edge for up to a minute, so
        // opening a link a second early poisons it and refreshing does not
        // help. Say what to do, and do not let this response be cached on top.
        return new Response(
          "No program here.\n\nIf this was just published, wait a minute and " +
          "refresh — it takes that long to reach every location.\n",
          { status: 404, headers: { "content-type": "text/plain; charset=utf-8",
                                    "cache-control": "no-store" } });
      }
      // Is this still the program on the DJ's playlist? One KV read, and
      // deliberately NOT a Spotify call: this route is public and
      // unauthenticated, so a page view must never spend the account's
      // subrequest budget or reach for its token. Whoever finds the URL would
      // otherwise be able to make this Worker talk to Spotify by refreshing.
      let onAir = false;
      try {
        onAir = !!rec.playlistId &&
          (await env.PROGRAMS.get(`current:${rec.playlistId}`)) === rec.slug;
      } catch {
        // The listen link is an extra. A KV hiccup must not cost the article.
      }

      // The record is immutable; the template is NOT. A year-long immutable
      // cache would mean an improved page never reaches anything already
      // published, which is most of the reason the Worker owns the markup.
      //
      // `onAir` is part of the tag because it is the one thing on this page
      // that changes without the record or the template changing. Without it a
      // cached copy would keep offering a listen link for a set that has since
      // been replaced.
      // A revision rewrites the record under the same slug (2026-09-07), so
      // the count of them is part of the tag too — or a browser holding the
      // tag would 304 its way back to the pre-revision page forever.
      const revs = Array.isArray(rec.revisions) ? rec.revisions.length : 0;
      const etag = `W/"${prog[1]}-${TEMPLATE_VERSION}${revs ? `-r${revs}` : ""}${onAir ? "-live" : ""}"`;
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: { etag } });
      }
      return new Response(renderProgram(rec, { onAir }), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          // no-cache, not max-age: the listen link's truth changes when a
          // button is rewritten, and being wrong quietly is the one failure
          // this link was built to avoid. The ETag keeps revalidation at 304.
          "cache-control": "no-cache",
          etag,
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          // Unlisted only works while it stays unindexed, and one leaked
          // referer is enough.
          "x-robots-tag": "noindex, nofollow",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src https://fonts.gstatic.com; img-src 'none'; form-action 'none'; " +
            "base-uri 'none'; frame-ancestors 'none'",
        },
      });
    }

    // The shelf: one page listing every program, at one bookmarkable URL.
    //
    // A program page is unlisted because its slug is unguessable. That does not
    // survive an index — an index IS the list of everything — so this route
    // carries its own key and is compared whole, like MCP_SECRET below. It is
    // still a weaker secret than that one — it reaches this shelf and nothing
    // else of the account — but it is no longer read-only: the chooser below
    // activates a program, so whoever holds this link can change what the
    // button plays. Bounded on purpose. It can only ever put one of the
    // writer's OWN published programs onto their OWN button, the previous
    // contents are backed up like any other write, and restore_playlist undoes
    // it. The worst it does is play the owner their own music.
    // Nothing links here from a program page, so sharing one program still
    // shares exactly one program — and a program page never gets a control.
    // /notes is the Shelf's address. The old /library prefix was removed on
    // 2026-10-18 at the owner's word, with the other old addresses.
    // ---------------------------------------------------------- the buttons
    // Reasoning for the shared key, the token-spend deviation and the caches is
    // on the helpers above. Same 404 discipline as the notes page: the key is
    // the only thing that stays a bare "not found"; past it, say what happened.
    // Inline script on these pages runs under a per-response nonce. The
    // header below used to name no script-src at all, so `default-src 'none'`
    // blocked EVERY inline script on the live house from the day the wall
    // shipped — Rearrange, the submit guard, the haptics, the sentence that
    // leaves the URL — while the suite reads markup and the browser runs
    // opened a file with no header, so neither saw it. Found 2026-09-05 by
    // serving the rendered page under the real header, after the owner
    // could not make Rearrange do anything on the phone. The Rearrange chip
    // was even VISIBLE without script: `.wall .chip` sets display, and an
    // author display beats the UA's [hidden].
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const roomHeaders = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; " +
        // 'self' is the house's own address.
        // The services' hosts stay for the shelf rows' sleeves, which are the
        // programmes' pictures and not the writers': album art on i.scdn.co,
        // uploaded playlist covers on *.spotifycdn.com (a shelf row can still
        // name one), and everything of Tidal's from its one host.
        // data: for the CSS masks that draw the chevrons (the reviews,
        // 2026-10-09: "How this works" had lost its arrow to this header).
        "img-src 'self' data: https://i.scdn.co https://*.spotifycdn.com https://resources.tidal.com; " +
        // The web-app manifest (MC-14), which a phone fetches on Add to Home
        // Screen; connect-src is the pages' own fetches and nothing else.
        `manifest-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'; ` +
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    };
    // Every room page goes out through here so the nonce on the header and
    // the nonce on the tags cannot come apart. The renderers write bare
    // <script> tags; nothing else on these pages is one.
    const roomPage = (html, init = {}) => new Response(
      html.replaceAll("<script>", `<script nonce="${nonce}">`),
      { ...init, headers: { ...roomHeaders, ...(init.headers ?? {}) } });
    // A page, not a line of text: the sentence was always right, but a bare
    // text/plain answer inside the in-app browser is a dead end (see
    // tasks/done/ux-audit-buttons.md). Only reached past the key check, so the way
    // home can name the key; the wrong-key 404 above stays bare on purpose.
    const roomRefuse = (status, why) => roomPage(
      renderRefusal({ why, back: env.PROGRAM_LIBRARY_KEY ? `/buttons/${env.PROGRAM_LIBRARY_KEY}` : null }),
      { status, headers: { "cache-control": "no-store" } });
    // THE SETUP DOOR (MC-31, step 3, claim.js): a new house is claimed here
    // with its setup key. No SETUP_KEY, no door (the owner's house, set up
    // from its files): the same 404 as a wrong guess. The forms are the
    // page's own; a post from anywhere else is refused.
    if (url.pathname === "/setup" || url.pathname === "/setup/claim" || url.pathname === "/setup/recover" ||
      url.pathname === "/setup/speaker" || url.pathname === "/setup/timezone" || url.pathname === "/setup/code" ||
      url.pathname === "/setup/spotify-app" || url.pathname === "/setup/app" || url.pathname === "/setup/helper" || url.pathname === "/setup/helper/remove" ||
      url.pathname === "/setup/rooms" || url.pathname === "/setup/backup" ||
      url.pathname === "/setup/restore" || url.pathname === "/setup/check" || url.pathname === "/setup/name" || url.pathname === "/setup/identify" ||
      url.pathname === "/setup/requests" || url.pathname === "/setup/curator" || url.pathname === "/setup/curator/wake" ||
      url.pathname === "/setup/curator/use" || url.pathname === "/setup/status" || url.pathname === "/setup/keys" || url.pathname === "/setup/updates" ||
      url.pathname === "/setup/updates/on" || url.pathname === "/setup/endless") {
      // A SETUP KEY TOO SHORT (MC-34): the Deploy button's form takes any
      // password, and one under 24 characters keeps the door shut. Said
      // here, with the way out, rather than a bare 404 on a new house.
      if (!setupOpen(env) && env.HOUSE && typeof env.SETUP_KEY === "string" && env.SETUP_KEY.trim()) {
        return roomPage(renderRefusal({ why: `This house's setup key is shorter than ${SETUP_KEY_MIN} characters, the least a setup key ` +
          "may be, so the setup page stays shut. In Cloudflare, open Workers, this house, Settings, " +
          "Variables and Secrets: set SETUP_KEY again, longer, and come back here." }), { status: 503, headers: { "cache-control": "no-store" } });
      }
      if (!setupOpen(env)) return notFound();
      // same-origin, not the room pages' no-referrer: under no-referrer a
      // browser sends "Origin: null" with a form's POST, and the check below
      // refused the owner's own phone (2026-10-17, the first sign-in).
      const setupPage = (args, status = 200, token = null) => roomPage(renderSetup(args), {
        status, headers: { "cache-control": "no-store", "referrer-policy": "same-origin",
          ...(token ? { "set-cookie": ownerCookie(token) } : {}) },
      });
      // An unclaimed house's store is left for the claim to place (Codex,
      // 2026-10-17): a visitor to /setup, or a recovery tried there, sees the
      // claim form without anything being asked of it. Only a browser that
      // carries an owner's sign-in asks the store whether the house still has
      // that owner when its mark is gone (a store made again, 2026-10-19).
      const claimed = (await houseClaimed(env)) || (!!cookieToken(request) && await claimedInStore(env));
      if (url.pathname === "/setup") {
        if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
        if (!claimed) return setupPage({ state: "open" });
        const s = await ownerState(env, request);
        if (!s.claimed) return setupPage({ state: "open" });
        if (!s.owner) return setupPage({ state: "owned" });
        await ensureClaimMark(env, s.claimed_at);
        // THE HOUSE'S OWN ADDRESS (MC-34 1a): where no file sets one (a house
        // from the Deploy button), the address its owner opens this page at,
        // kept for the links that go out and the cron that writes them; a new
        // domain is learned the first time the owner comes in by it. A file's
        // address always wins, and a page copy of it is dropped.
        const fileBase = (env.__vars ?? {}).PROGRAM_BASE_URL ?? null;
        const pageBase = (env.__page ?? {}).PROGRAM_BASE_URL ?? null;
        if (fileBase ? pageBase : pageBase !== url.origin) {
          try { await choosePageSetting(env, "PROGRAM_BASE_URL", fileBase ?? url.origin); env = { ...env, PROGRAM_BASE_URL: fileBase ?? url.origin }; }
          catch { /* the next visit tries again */ }
        }
        // The house's own keys, if the claim's making of them was lost: made
        // now, and read on the next look.
        if (MADE_KEYS.some((n) => !env[n])) await ensureHouseKeys(env);
        const base = env.PROGRAM_LIBRARY_KEY ? `/buttons/${env.PROGRAM_LIBRARY_KEY}` : null;
        const said = url.searchParams.get("signed") === "1" ? "Signed in on this browser."
          : url.searchParams.get("saved") === "speaker" ? `${env.DEFAULT_DEVICE} is the default speaker now.`
          : url.searchParams.get("saved") === "timezone" ? `The house's time zone is ${env.HOUSE_TZ} now.`
          : url.searchParams.get("saved") === "spotify-app" ? "The Spotify app is kept. Next: sign in to Spotify."
          : url.searchParams.get("saved") === "restore" ? "The backup is back: the settings and keys it held are the house's now."
          : url.searchParams.get("spotify") ? String(url.searchParams.get("spotify")).slice(0, 300) : null;
        return setupPage({ state: "yours", checklist: await setupChecklist(env, s, { base, origin: url.origin }), flash: said });
      }
      // An unclaimed house's other setup pages send a visitor to the claim
      // (Codex, 2026-10-17): nothing asks the house's store before the claim
      // places it.
      if (!claimed && url.pathname !== "/setup/claim" && url.pathname !== "/setup/recover") {
        return Response.redirect(new URL("/setup", url).toString(), 303);
      }
      // THE FIRST SETTING CHOSEN ON THE PAGE (stage 6): the default speaker,
      // from the house's rooms. The owner's only; anyone else is sent back.
      // The rooms the house has, never parseRoomDevices' stand-in "Pro Plus"
      // for a house with none (Codex, 2026-10-17): a new house offers only
      // what it knows of, and says when that is nothing.
      const setupRooms = () => [...new Set([...(env.ROOM_DEVICES ? parseRoomDevices(env) : []),
        ...(env.DEFAULT_DEVICE ? [env.DEFAULT_DEVICE] : [])])];
      const speakerChoice = () => ({ rooms: setupRooms(), current: env.DEFAULT_DEVICE ?? null,
        fileSays: (env.__vars ?? {}).DEFAULT_DEVICE ?? null,
        // The WiiM question: asked only of a house with no WiiM addresses.
        asksWiims: !parseSpeakers(env).length, wiims: env.WIIM_NAMES ? wiimNames(env) : null });
      // THE REQUESTS PRESET (the forum road, 2026-10-17; the owner: "can the
      // user pick a preset?" — yes, 1 suggested): a Spotify playlist the house
      // makes, kept as the house's Spotify guest on the number chosen.
      const requestsNow = () => {
        try { return parseButtons(env.BUTTONS).find((b) => b.guest && b.catalog === "spotify") ?? null; } catch { return null; }
      };
      // WAITS THE PAGE CAN SEE (setup-watch.js): the facts a waiting page
      // watches, the owner's only.
      if (url.pathname === "/setup/status" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.json({ error: "not signed in" }, { status: 403, headers: { "cache-control": "no-store" } });
        const want = String(url.searchParams.get("w") ?? "").split(",").filter((k) => WATCH_FACTS.includes(k));
        return Response.json(await setupFacts(env, want), { headers: { "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/requests" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        return setupPage({ state: "requests", requests: { now: requestsNow(), ready: !!env.SPOTIFY_CLIENT_ID, speaker: env.DEFAULT_DEVICE || null },
          flash: url.searchParams.get("made") ? "Made. Next: fill it with a DJ's set, then save it on each speaker, as below." : null });
      }
      // THE CURATOR (the Endless step, part 1, 2026-10-17): its connector's
      // address, the routine's note, and the routine's id and token given
      // back here; then a wake to check it answers.
      const curatorInfo = async (said = null, open = false) => {
        const token = String(env.REQUEST_ROUTINE_TOKEN ?? "");
        const at = await programsKV(env).get(CURATOR_SEEN_KEY, { type: "json" }).then((r) => Number(r?.at) || null).catch(() => null);
        return { connector: env.AGENT_SECRET ? `${url.origin}/mcp/${env.AGENT_SECRET}` : null,
          // The one curator the house rings (MC-31 6b): Claude's task or a
          // ChatGPT Work chat subscribed to its events.
          kind: curatorKind(env), subs: await workSubscriptions(env),
          routine: env.REQUEST_ROUTINE_ID ?? null, token: !!token,
          // Its start and end, as claude.ai shows it, so a paste is seen to
          // have been kept (the owner's rule, 2026-10-14).
          tokenHint: token.length > 32 ? `${token.slice(0, 21)}…${token.slice(-4)}` : null,
          tokenFromSecret: !!token && !(env.__keys ?? []).includes("REQUEST_ROUTINE_TOKEN"),
          seen: at ? atWords(houseClockWords(env, new Date(at).toISOString())) : null, seenAt: at || 0,
          next: parseEndless(env)?.presets?.length ? null : "/setup/endless", said, open };
      };
      if (url.pathname === "/setup/curator" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        // Said next to the buttons, never only at the top of a page the
        // phone is scrolled down (the trial, 2026-10-17).
        // Claude's steps or ChatGPT's (MC-31 6b): the house's own choice
        // unless the page was asked for the other.
        const asked = url.searchParams.get("with");
        const view = asked === "chatgpt" || (asked !== "claude" && curatorKind(env) === "chatgpt") ? "chatgpt" : "claude";
        // When it was rung, for the page's clock (an hour at most: an old
        // link is not a wait).
        const rungAt = Number(url.searchParams.get("at")) || 0;
        const since = url.searchParams.get("woke") === "1" && rungAt > Date.now() - 3600e3 && rungAt <= Date.now() + 60e3 ? rungAt : null;
        const said = view === "chatgpt"
          ? (url.searchParams.get("saved") ? "Saved: ChatGPT is this house's curator. Now send it a test, to check it answers."
            : url.searchParams.get("woke") === "1" ? "Sent. The Work chat runs its round within a minute, and this page shows it when it checks in. No need to stay: the checklist's Curator row ticks too."
            : url.searchParams.get("woke") === "0" ? "Nothing answered: no Work chat is listening. Open it and paste its instructions again (step 2), so it subscribes." : null)
          : url.searchParams.get("saved") ? "Saved. Now wake it once, to check it answers."
          : url.searchParams.get("woke") === "1" ? "Rung. It wakes and checks in within a minute or two, and this page shows it when it does. No need to stay: the checklist's Curator row ticks too."
          : url.searchParams.get("woke") === "0" ? "The task did not answer the ring. Check its id; or make a new token (Edit the task, API, Regenerate) and paste it under Change the task or its token." : null;
        return setupPage({ state: "curator", curator: { ...(await curatorInfo(said, url.searchParams.get("woke") === "0")), view, since } });
      }
      // THE DJ PRESETS (the Endless step, part 2, 2026-10-17): a house DJ on
      // one number and the guest DJ on another (2 and 3 suggested), their
      // playlists made by the house, the endless DJs switched on, and the
      // house DJ's first set asked for at once.
      const endlessDjs = () => Object.values(house(env).djs).filter((d) => !d.archiveOnly && !d.needsWords && d.endless !== false)
        .map((d) => ({ key: d.key, name: d.name }));
      // The Requests preset's numbers: never offered for a DJ preset, and
      // said why (the trial, 2026-10-17).
      const requestsButtons = () => { try { return parseButtons(env.BUTTONS).map((b) => b.btn); } catch { return []; } };
      // Every number the house's own presets use (Codex, 2026-10-17: a
      // restored file's too), so a new one never lands on one of them.
      const housePresetNumbers = () => [...requestsButtons(), ...(parseEndless(env)?.presets ?? []).map((p) => p.button)];
      const endlessInfo = () => {
        const cfg = parseEndless(env);
        const lane = cfg?.presets?.find((p) => p.lane) ?? null;
        const own = cfg?.presets?.find((p) => !p.lane) ?? null;
        // Either curator (the practice install, 2026-10-19: a ChatGPT house
        // was told to set up the curator it had).
        return { djs: endlessDjs(), made: !!cfg?.presets?.length, curator: !!curatorKind(env),
          own: own ? { btn: own.button, name: findDj(env, own.dj)?.name ?? own.dj,
            href: env.PROGRAM_LIBRARY_KEY ? `/buttons/${env.PROGRAM_LIBRARY_KEY}/${own.dj}` : null } : null, lane: lane ? { btn: lane.button } : null,
          speaker: fallbackDevice(env) || null, requests: requestsButtons() };
      };
      if (url.pathname === "/setup/endless" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const asked = url.searchParams.get("fresh");
        const info = endlessInfo();
        return setupPage({ state: "endless", endless: { ...info, failed: !!asked && asked !== "asked", first: info.made ? await firstSet(env) : null },
          flash: asked === "asked" ? "Made. The house DJ's first set is being written." :
            asked ? "Made. The first set could not be asked for just now: open the DJ's page, below, and tap Start fresh." : null });
      }
      // THE HOUSE'S KEYS AND ITS SIGNED-IN BROWSERS (the locks review,
      // 2026-10-25: a leaked key or a lost phone had no way out but a
      // hand-edited backup or wrangler). Each made key the store holds can be
      // made new; one a Worker secret holds is wrangler's to change. The
      // owner's only.
      if (url.pathname === "/setup/keys" && request.method === "GET") {
        const s = await ownerState(env, request);
        if (!s.owner) return Response.redirect(new URL("/setup", url).toString(), 303);
        const renewed = MADE_KEYS.includes(url.searchParams.get("renewed")) ? url.searchParams.get("renewed") : null;
        const out = url.searchParams.get("out");
        return setupPage({ state: "keys", keys: {
          keys: MADE_KEYS.map((name) => ({ name, held: !!env[name], stored: (env.__keys ?? []).includes(name) })),
          browsers: Number(s.browsers) || 1, renewed, signedOut: /^[0-9]{1,2}$/.test(out ?? "") ? Number(out) : null } });
      }
      // UPDATES (MC-34 stage 2, updates.js): a house made by the Deploy
      // button, its version and the newest, its owner's GitHub copy, the
      // link that turns updates on and the one that runs one.
      if (url.pathname === "/setup/updates" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const up = await updateFacts(env);
        if (!up) return Response.redirect(new URL("/setup", url).toString(), 303);
        return setupPage({ state: "updates", updates: up,
          flash: url.searchParams.get("saved") ? "Kept. Now turn updates on, once, below." : null });
      }
      // TURNED ON (2026-10-26): the house cannot read a private copy to see
      // the workflow there, so the press that opens GitHub's page counts as
      // turning updates on, for that copy. A link, not a form: the pages'
      // form-action 'self' would stop a form's redirect to GitHub. What it
      // sets only folds a step away, so a stranger's link does no harm.
      if (url.pathname === "/setup/updates/on" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const up = await updateFacts(env);
        if (!up?.own) return Response.redirect(new URL("/setup/updates", url).toString(), 303);
        try { await choosePageSetting(env, "UPDATES_ON", up.own); } catch { /* step 1 shows again; harmless */ }
        return new Response(null, { status: 303, headers: { location: up.turnOn, "cache-control": "no-store" } });
      }
      // BACKUP AND REPAIR (backup.js): the owner's only, every one.
      if (["/setup/backup", "/setup/restore", "/setup/check"].includes(url.pathname) && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        if (url.pathname === "/setup/backup") {
          const day = new Date().toISOString().slice(0, 10);
          return new Response(JSON.stringify(await makeBackup(env, url.host), null, 2), { headers: {
            "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
            "content-disposition": `attachment; filename="house-backup-${day}.json"` } });
        }
        if (url.pathname === "/setup/restore") return setupPage({ state: "restore" });
        return setupPage({ state: "check", rows: await checkHouse(env) });
      }
      // FINDING THE SPEAKERS (the forum road, 2026-10-17): what Spotify sees
      // now, one call, asked for by the owner; a speaker asleep is not in it.
      const findSpeakers = async () => {
        if (!env.SPOTIFY_CLIENT_ID) return { why: "Set up the Spotify app first: the house finds speakers through Spotify." };
        try {
          const budget = withBudget(env, { remaining: 6 });
          const { devices = [] } = await spotify(budget, "GET", "/me/player/devices");
          // PLAYING NOW is the player's word, not the list's "active": Spotify
          // keeps that on the last speaker used, playing or not (the trial,
          // 2026-10-17: the Ultra, idle, was marked, and named "Pro Plus").
          let playingId = null;
          try { const p = await spotify(budget, "GET", "/me/player"); playingId = p?.is_playing ? p?.device?.id ?? null : null; } catch { playingId = null; }
          // A WiiM can be listed under its id for a name (a known fault, the
          // owner's house, 2026-10-17): the house's own note of its name, as
          // every page uses; one it has no name for is counted, not listed.
          const shown = await Promise.all(devices.map(async (d) => ({ d, name: String(await deviceDisplayName(env, d) ?? "").trim() })));
          const named = shown.filter((x) => x.name && x.name !== x.d?.id && x.name.length <= 60);
          // The nameless, each with its id (Spotify's, not a secret) to name
          // it by, and whether it is the one playing now, so the owner can
          // tell which WiiM it is.
          const nameless = shown.filter((x) => !named.includes(x) && /^[A-Za-z0-9_-]{8,64}$/.test(String(x.d?.id ?? "")))
            .map((x) => ({ id: x.d.id, active: x.d.id === playingId }));
          // Those Spotify shows only a code for but the house has a name for
          // (named on this page, or seen once): offered for renaming.
          const noted = named.filter((x) => x.d?.name === x.d?.id).map((x) => ({ id: x.d.id, name: x.name, active: x.d.id === playingId }));
          // What Spotify calls each (a WiiM says "AVR"; an Echo "Speaker"):
          // the WiiM question's first guess.
          const avr = [...new Set(named.filter((x) => /^avr$/i.test(String(x.d?.type ?? ""))).map((x) => x.name))];
          return { names: [...new Set(named.map((x) => x.name))], nameless, noted, avr,
            taken: named.map((x) => ({ id: x.d.id, name: x.name.toLowerCase() })) };
        } catch {
          return { why: "Spotify did not answer just now. If the house is not signed in to Spotify yet, do that first; else try again in a minute." };
        }
      };
      if (url.pathname === "/setup/speaker" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const find = url.searchParams.get("find") === "1" ? await findSpeakers() : null;
        const kept = url.searchParams.get("saved") === "rooms";
        const named = url.searchParams.get("named");
        // A nameless speaker played on to tell which it is (the owner's second
        // run, 2026-10-17: "why should I know that the a48c speaker is the Pro
        // Plus?"): said by the names, not at the top.
        const tried = /^[A-Za-z0-9]{4}$/.test(url.searchParams.get("tried") ?? "") ? url.searchParams.get("tried") : null;
        const triedSaid = !tried ? null : url.searchParams.get("ok") === "1"
          ? `Playing on the speaker with the code ending ${tried}: listen for which one it is, then give it that name below.`
          : `Spotify would not play on the speaker with the code ending ${tried}. Start music on it from the Spotify app instead, then find again: it is marked playing now.`;
        return setupPage({ state: "speaker", speaker: { ...speakerChoice(), found: find?.names ?? null, nameless: find?.nameless ?? [], noted: find?.noted ?? [], avr: find?.avr ?? [], triedSaid },
          flash: find?.why ?? (named ? `Named: ${named.slice(0, 40)}. It is on the house's list.`
            : kept ? "Speakers kept. Now choose the one that plays when nobody names a speaker." : null) });
      }
      // THE SPOTIFY APP (the keys design): its Client ID, given by the owner,
      // with the exact redirect address to paste into Spotify's dashboard.
      // A Client ID set as a Worker secret (the owner's house) is not the
      // page's to replace: a secret of the name always wins over a kept key.
      const appInfo = () => ({ redirect: callbackUrl(env, url.origin), held: !!env.SPOTIFY_CLIENT_ID,
        fromSecret: !!env.SPOTIFY_CLIENT_ID && !(env.__keys ?? []).includes("SPOTIFY_CLIENT_ID") });
      if (url.pathname === "/setup/spotify-app" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        return setupPage({ state: "spotifyapp", app: appInfo() });
      }
      // THE HOME HELPER (MC-31 stage 5): its command, with a pairing code for
      // its key since 2026-10-21, what it reads, and its Remove.
      if (url.pathname === "/setup/helper" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        let h = null;
        try { h = await station(env, "helper-get", {}); } catch { h = null; }
        return setupPage({ state: "helper", helper: { house: url.origin, key: env.HELPER_SECRET ?? null,
          pair: env.HELPER_SECRET ? await helperPairCode(env.HELPER_SECRET) : null, hands: !!h?.hands, known: !!h?.doc,
          saw: helperSaw(h?.doc), names: parseSpeakers(env).map((b) => b.name) },
          flash: HELPER_REMOVED_SAID[url.searchParams.get("removed") ?? ""] ?? null });
      }
      // CLAUDE OR CHATGPT: the house's address and the steps for both.
      if (url.pathname === "/setup/app" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        return setupPage({ state: "assistant", assistant: { address: env.MCP_SECRET ? `${url.origin}/mcp/${env.MCP_SECRET}` : null } });
      }
      const zoneChoice = () => ({ current: zoneValid(env.HOUSE_TZ) ? env.HOUSE_TZ : null, fileSays: (env.__vars ?? {}).HOUSE_TZ ?? null });
      if (url.pathname === "/setup/timezone" && request.method === "GET") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        return setupPage({ state: "timezone", timezone: zoneChoice() });
      }
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      // The page's own origin, or, where a browser sent "null", its own word
      // that the form came from this site (Sec-Fetch-Site, which no page
      // script can set).
      const origin = request.headers.get("origin");
      const sameSite = origin === url.origin ||
        ((!origin || origin === "null") && request.headers.get("sec-fetch-site") === "same-origin");
      if (!sameSite) {
        return roomPage(renderRefusal({ why: "This form has to be sent from the house's own setup page.", back: "/setup" }),
          { status: 403, headers: { "cache-control": "no-store" } });
      }
      const form = await request.formData().catch(() => null);
      if (url.pathname === "/setup/restore") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const file = form?.get("file");
        const text = file && typeof file.text === "function" && file.size <= 65536 ? await file.text() : null;
        const out = text == null ? { why: "Choose the backup file first (a small .json file)." } : await restoreBackup(env, text);
        if (!out.ok) return setupPage({ state: "restore", flash: out.why }, 400);
        return new Response(null, { status: 303, headers: { location: "/setup?saved=restore", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/curator") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const id = String(form?.get("routine") ?? "").trim().match(/trig_[A-Za-z0-9]{10,64}/)?.[0] ?? null;
        const token = String(form?.get("token") ?? "").trim();
        if (!id) return setupPage({ state: "curator", curator: await curatorInfo("That is not the task's address: open the task at claude.ai and copy its address, which ends in trig_ and some letters.", true) }, 400);
        if (token && !/^[A-Za-z0-9_-]{20,300}$/.test(token)) {
          return setupPage({ state: "curator", curator: await curatorInfo("That is not the task's token. It is shown once, when it is made: if it is gone, Edit the task, API, Regenerate.", true) }, 400);
        }
        if (!token && !env.REQUEST_ROUTINE_TOKEN) {
          return setupPage({ state: "curator", curator: await curatorInfo("Paste the task's token too: it is shown once, when the task is made.", true) }, 400);
        }
        // In one write (Codex, 2026-10-17), and the house rings it for each
        // job (the trial, 2026-10-17: a blank house's file has it off, so its
        // first fresh set waited for the hourly check).
        const changed = id !== env.REQUEST_ROUTINE_ID || (token && token !== env.REQUEST_ROUTINE_TOKEN);
        await choosePageSettings(env, { REQUEST_ROUTINE_ID: id, REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true", CURATOR: "claude" },
          token ? { REQUEST_ROUTINE_TOKEN: token } : {});
        // A new task proves itself: the old one's check-in no longer counts.
        if (changed) { try { await programsKV(env).delete(CURATOR_SEEN_KEY); } catch { /* the checklist shows the old one */ } }
        return new Response(null, { status: 303, headers: { location: "/setup/curator?saved=1#done", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/endless") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const again = (why, status) => setupPage({ state: "endless", endless: endlessInfo(), flash: why }, status);
        if (parseEndless(env)?.presets?.length) return again("This house already has its DJ presets.", 409);
        if (!curatorKind(env)) return again("Set up the curator first: it writes the endless DJs' sets.", 409);
        const dj = endlessDjs().find((d) => d.key === String(form?.get("dj") ?? ""));
        const own = Number(form?.get("own")), lane = Number(form?.get("lane"));
        const taken = requestsButtons();
        if (!dj) return again("Choose the house DJ.", 400);
        if (![own, lane].every((n) => Number.isInteger(n) && n >= 1 && n <= 12) || own === lane) {
          return again("Choose two different preset numbers, 1 to 12.", 400);
        }
        if (taken.includes(own) || taken.includes(lane)) return again(`Preset ${taken.includes(own) ? own : lane} is the Requests preset: choose another.`, 400);
        let mine, guest;
        try {
          const spotifyCat = catalogFor(withBudget(env, { remaining: 6 }), "spotify");
          mine = await spotifyCat.createPlaylist({ name: dj.name, public: false, description: `${dj.name}, endless, on preset ${own}.` });
          guest = await spotifyCat.createPlaylist({ name: "Guest DJ", public: false, description: `Any DJ played endless, on preset ${lane}.` });
        } catch {
          return again("Spotify would not make the playlists just now. Is the house signed in to Spotify? Try again in a minute.", 503);
        }
        const cfg = { mode: "live", dailyRuns: 12, presets: [
          { button: own, dj: dj.key, playlist: mine.id, hours: 4 }, { button: lane, lane: true, playlist: guest.id, hours: 4 }] };
        const json = JSON.stringify(cfg);
        await choosePageSetting(env, "ENDLESS", json);
        // The house DJ's first set, asked for now and started on the default
        // speaker when it lands, so the preset can be saved while it plays.
        const speaker = fallbackDevice(env);
        let fresh = { status: "off" };
        if (speaker) { try { fresh = await endlessStartFresh({ ...env, ENDLESS: json }, { button: own, device: speaker }); } catch { fresh = { status: "failed" }; } }
        return new Response(null, { status: 303, headers: { location: `/setup/endless?fresh=${encodeURIComponent(fresh.status ?? "failed")}`, "cache-control": "no-store" } });
      }
      // REMOVE THE HOME HELPER (the owner, 2026-10-21: "an easy button"): sent
      // down its line, and the helper takes itself off its computer. Only a
      // helper the install made can; one set up by hand says so.
      if (url.pathname === "/setup/updates") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const up = await updateFacts(env);
        if (!up) return Response.redirect(new URL("/setup", url).toString(), 303);
        const own = githubRepo(form?.get("repo"));
        if (!own) {
          return setupPage({ state: "updates", updates: up,
            flash: "That is not a GitHub repository's address. It looks like github.com/your-name/your-house." }, 400);
        }
        await choosePageSetting(env, "UPDATE_REPO", own.web);
        return new Response(null, { status: 303, headers: { location: "/setup/updates?saved=1#turn-on", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/keys") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const what = String(form?.get("key") ?? "");
        if (what === "browsers") {
          const out = await signOutOthers(env, request);
          return new Response(null, { status: 303, headers: { location: `/setup/keys?out=${out?.ok ? Number(out.signed_out) || 0 : 0}#browsers`, "cache-control": "no-store" } });
        }
        if (!MADE_KEYS.includes(what)) return Response.redirect(new URL("/setup/keys", url).toString(), 303);
        const made = await renewHouseKey(env, what);
        // The helper's line, opened with the old key, is closed at once.
        if (made && what === "HELPER_SECRET") { try { await station(env, "helper-drop", {}); } catch { /* it fails its next sign-in */ } }
        return new Response(null, { status: 303, headers: { location: made ? `/setup/keys?renewed=${what}#done` : "/setup/keys", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/helper/remove") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        let out = null;
        try { out = await station(env, "helper-command", { cmd: "remove" }); } catch { out = null; }
        const code = out?.ok ? "removing" : ["helper-off", "timeout", "not-installed"].includes(out?.code) ? out.code : "failed";
        return new Response(null, { status: 303, headers: { location: `/setup/helper?removed=${code}#done`, "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/curator/wake") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        // A ChatGPT curator is sent a test event (MC-31 6b): its Work chat
        // runs the round, and its list_requests is the check-in.
        if (curatorKind(env) === "chatgpt") {
          const heard = await sendWorkEvent(env, "setup-check");
          return new Response(null, { status: 303, headers: { location: `/setup/curator?with=chatgpt&woke=${heard ? `1&at=${Date.now()}` : 0}#done`, "cache-control": "no-store" } });
        }
        // A curator saved before the house rang it for its jobs is switched
        // on by its first wake (the trial's, 2026-10-17).
        if (env.AUTOFULFILL_ENABLED !== "true" && env.REQUEST_ROUTINE_ID) await choosePageSetting(env, "AUTOFULFILL_ENABLED", "true");
        const ok = await fireRoutine(env, "setup-check");
        return new Response(null, { status: 303, headers: { location: `/setup/curator?woke=${ok ? `1&at=${Date.now()}` : 0}#done`, "cache-control": "no-store" } });
      }
      // THE ONE CURATOR (MC-31 6b, step 5): ChatGPT, or back to the Claude
      // task already kept. Switching rings only the one chosen from then on.
      if (url.pathname === "/setup/curator/use") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const who = String(form?.get("who") ?? "");
        if (who === "chatgpt") {
          await choosePageSettings(env, { CURATOR: "chatgpt", REQUESTS_ENABLED: "true", AUTOFULFILL_ENABLED: "true" });
          return new Response(null, { status: 303, headers: { location: "/setup/curator?with=chatgpt&saved=1#done", "cache-control": "no-store" } });
        }
        if (who === "claude" && env.REQUEST_ROUTINE_ID) {
          await choosePageSettings(env, { CURATOR: "claude" });
          return new Response(null, { status: 303, headers: { location: "/setup/curator?with=claude#done", "cache-control": "no-store" } });
        }
        return new Response(null, { status: 303, headers: { location: "/setup/curator?with=claude", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/requests") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const n = Number(form?.get("button"));
        const again = (why, status) => setupPage({ state: "requests", requests: { now: requestsNow(), ready: !!env.SPOTIFY_CLIENT_ID, speaker: env.DEFAULT_DEVICE || null }, flash: why }, status);
        if (!Number.isInteger(n) || n < 1 || n > 12) return again("Choose a preset number from 1 to 12.", 400);
        if (requestsNow()) return again("This house already has its Requests preset.", 409);
        if (housePresetNumbers().includes(n)) return again(`Preset ${n} already plays something of the house's: choose another.`, 400);
        let made;
        try {
          made = await catalogFor(withBudget(env, { remaining: 4 }), "spotify").createPlaylist({ name: "Requests", public: false,
            description: "The house's Requests preset: each set a DJ is asked for lands here." });
        } catch {
          return again("Spotify would not make the playlist just now. Is the house signed in to Spotify? Try again in a minute.", 503);
        }
        // The preset list as the page keeps it: the new requests preset, and
        // whatever else the house has on other numbers.
        let list = [];
        try { list = typeof env.BUTTONS === "string" ? JSON.parse(env.BUTTONS) : (Array.isArray(env.BUTTONS) ? env.BUTTONS : []); } catch { list = []; }
        list = list.filter((b) => b?.button !== n && !(b?.guest && (b.catalog ?? "spotify") === "spotify"));
        list.push({ button: n, guest: true, live: true, name: "Requests", playlist: made.id, catalog: "spotify" });
        await choosePageSetting(env, "BUTTONS", JSON.stringify(list));
        return new Response(null, { status: 303, headers: { location: "/setup/requests?made=1", "cache-control": "no-store" } });
      }
      // PLAY ON A NAMELESS SPEAKER, to hear which one it is: what the account
      // last played, moved there (Spotify's transfer, with play).
      if (url.pathname === "/setup/identify") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const id = String(form?.get("id") ?? "");
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return setupPage({ state: "speaker", speaker: speakerChoice(), flash: "That is not a speaker's code." }, 400);
        let ok = false;
        try {
          await spotify(withBudget(env, { remaining: 4 }), "PUT", "/me/player", { body: { device_ids: [id], play: true } });
          ok = true;
        } catch { ok = false; }
        return new Response(null, { status: 303, headers: { "cache-control": "no-store",
          location: `/setup/speaker?find=1&tried=${encodeURIComponent(id.slice(-4))}&ok=${ok ? 1 : 0}#unnamed` } });
      }
      if (url.pathname === "/setup/name") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const id = String(form?.get("id") ?? "");
        const name = String(form?.get("name") ?? "").replace(/[\u0000-\u001f]/g, "").trim();
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || !name || name.length > 40) {
          return setupPage({ state: "speaker", speaker: speakerChoice(), flash: "Give the speaker a name of 1 to 40 characters." }, 400);
        }
        // One name, one speaker (the trial: two called "Pro Plus").
        const now = await findSpeakers();
        const clash = (now.taken ?? []).find((t) => t.name === name.toLowerCase() && t.id !== id);
        if (clash) {
          return setupPage({ state: "speaker", speaker: { ...speakerChoice(), found: now.names ?? null, nameless: now.nameless ?? [], noted: now.noted ?? [] },
            flash: `Another speaker is already called ${name}: give this one its own name.` }, 409);
        }
        await nameDevice(env, id, name);
        // On the house's list too, beside the ones already there.
        const rooms = [...new Set([...setupRooms(), name])].slice(0, 24);
        const fileSays = (env.__vars ?? {}).ROOM_DEVICES;
        const json = JSON.stringify(rooms);
        await choosePageSetting(env, "ROOM_DEVICES", fileSays && JSON.stringify(JSON.parse(fileSays)) === json ? fileSays : json);
        return new Response(null, { status: 303, headers: { "cache-control": "no-store",
          location: `/setup/speaker?find=1&named=${encodeURIComponent(name)}` } });
      }
      if (url.pathname === "/setup/rooms") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const rooms = [...new Set((form?.getAll("room") ?? []).map((n) => String(n).trim()).filter((n) => n && n.length <= 60))].slice(0, 24);
        if (!rooms.length) {
          return setupPage({ state: "speaker", speaker: speakerChoice(), flash: "Tick at least one speaker to keep." }, 400);
        }
        // The file's own list hands the setting back to the file.
        const json = JSON.stringify(rooms);
        const fileSays = (env.__vars ?? {}).ROOM_DEVICES;
        await choosePageSetting(env, "ROOM_DEVICES", fileSays && JSON.stringify(JSON.parse(fileSays)) === json ? fileSays : json);
        // Which of them are WiiMs (the owner, 2026-10-17): the Speakers page
        // shows those, and another speaker only while it plays.
        if (!parseSpeakers(env).length) {
          const wiims = [...new Set((form?.getAll("wiim") ?? []).map((n) => String(n).trim()))].filter((n) => rooms.includes(n));
          await choosePageSetting(env, "WIIM_NAMES", JSON.stringify(wiims));
        }
        return new Response(null, { status: 303, headers: { location: "/setup/speaker?saved=rooms", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/spotify-app") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const id = String(form?.get("client_id") ?? "").trim();
        if (!/^[0-9a-f]{32}$/i.test(id)) {
          return setupPage({ state: "spotifyapp", app: appInfo(),
            flash: "That is not a Client ID: it is 32 letters and digits, from the app's page in Spotify's dashboard." }, 400);
        }
        await giveHouseKey(env, "SPOTIFY_CLIENT_ID", id.toLowerCase());
        return new Response(null, { status: 303, headers: { location: "/setup?saved=spotify-app", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/timezone") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const tz = String(form?.get("tz") ?? "").trim();
        if (!zoneValid(tz)) {
          return setupPage({ state: "timezone", timezone: zoneChoice(), flash: "That is not a time zone the house knows: a name like America/Los_Angeles." }, 400);
        }
        await choosePageSetting(env, "HOUSE_TZ", tz);
        return new Response(null, { status: 303, headers: { location: "/setup?saved=timezone", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/speaker") {
        if (!(await isOwner(env, request))) return Response.redirect(new URL("/setup", url).toString(), 303);
        const pick = String(form?.get("speaker") ?? "");
        if (!setupRooms().includes(pick)) {
          return setupPage({ state: "speaker", speaker: speakerChoice(), flash: "Pick one of the house's speakers." }, 400);
        }
        await choosePageSetting(env, "DEFAULT_DEVICE", pick);
        return new Response(null, { status: 303, headers: { location: "/setup?saved=speaker", "cache-control": "no-store" } });
      }
      if (url.pathname === "/setup/claim") {
        const out = await claimHouse(env, form?.get("key"));
        if (out.ok) return setupPage({ state: "claimed", recovery: out.recovery }, 200, out.token);
        // The right key, and the house already claimed: its mark is put back
        // if a claim's write of it was lost.
        if (out.code === "claimed") {
          await ensureClaimMark(env);
          return setupPage({ state: "owned", flash: "This house already has an owner." }, 409);
        }
        return setupPage({ state: "open", flash: "That is not this house's setup key." }, 403);
      }
      if (url.pathname === "/setup/code") {
        const made = await newRecoveryCode(env, request);
        if (!made.ok) return Response.redirect(new URL("/setup", url).toString(), 303);
        return setupPage({ state: "claimed", recovery: made.recovery, flash: "A new recovery code. The old one no longer works." });
      }
      if (!claimed) return setupPage({ state: "open", flash: "This house has no owner yet: claim it with its setup key." }, 409);
      const out = await recoverOwner(env, form?.get("code"));
      // Signed in: on to the checklist itself, by GET, so a reload never
      // posts the code again.
      if (out.ok) {
        return new Response(null, { status: 303, headers: { location: "/setup?signed=1", "cache-control": "no-store",
          "set-cookie": ownerCookie(out.token) } });
      }
      if (out.code === "unclaimed") return setupPage({ state: "open", flash: "This house has no owner yet: claim it with its setup key." }, 409);
      return setupPage({ state: "owned", flash: "That is not this house's recovery code." }, 403);
    }

    // When the curator last checked in, in the house's words ("at 16:08",
    // "on Thu at 16:08"), only when that is over an hour ago — for the pages
    // that would otherwise promise a set in "a few minutes". Or sooner, once
    // work has waited past twenty minutes (waiting.js, MC-31 6b): a plan's
    // limit run out shows as work nobody answers.
    const curatorQuiet = async () => {
      let at = await curatorQuietSince(env);
      if (!at && await workWaiting(env)) at = await curatorSeenAt(env);
      return at ? atWords(houseClockWords(env, new Date(at).toISOString())) : null;
    };

    const room = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})$/);
    if (room) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(room[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "The presets page only answers GET.");
      const base = `/buttons/${key}`;
      const budget = { remaining: 40 };
      const envB = withBudget(env, budget);

      // Everything below is independent reads, and walking them one at a time
      // is what made the first deploy take seven seconds cold. Fan out at the
      // platform's simultaneous-connection width; getAccessToken single-flights
      // the refresh, so the fan-out cannot race the token rotation.
      // An error is NOT silence. A token failure or a Spotify 5xx used to fall
      // to null and print "quiet on this account" — a confident claim about a
      // state the server had just failed to read.
      const throttle = await throttledUntil(env);
      // The RAW read, which every page maps with roomPlaying (there was a
      // second mapping, roomHeld, that saw a paused session; gone 2026-09-22,
      // see roomPlaying): the house's kept answer while the helper says it
      // holds (MC-29), a read otherwise. A no-op catch keeps an unread
      // promise from becoming an unhandled rejection.
      const rawPlayerP = throttle ? null : housePlayer(envB, { deadlineMs: PLAYER_DEADLINE_MS, share: true });
      if (rawPlayerP) rawPlayerP.catch(() => {});
      const playingP = throttle
        ? Promise.resolve({ unknown: true, throttledUntil: throttle })
        : rawPlayerP.then(roomPlaying).catch(() => ({ unknown: true }));
      const summariesP = listProgramSummaries(env).catch(() => []);
      // What the speakers hold, as a phone last read them: a KV read each.
      const boxes = parseSpeakers(env);
      const readingsP = readReadings(env, boxes);

      // ONE READ of the tile cache for the whole wall, and at most one write
      // after it. Eleven keys meant eleven writes a page load against a free
      // tier of a thousand a day (2026-09-06).
      const tiles = { map: await readTiles(env), dirty: false };
      const tileRows = await pooled(roomRoster(env), 6, async (r) => {
        // An empty button and a bench DJ both cost nothing to draw. Neither
        // has a face and neither has a set worth summarising here, and a tile
        // read is two calls against a ceiling of fifty — a bench of thirty
        // would spend the whole budget saying "nobody has this".
        if (r.empty || r.fixed) {
          return { ...r, cover: null, archive: false, startable: false, onWall: true };
        }
        // A guest that is not live is being saved, not played from here
        // (MC-18 stage 1): no tile read, no Play, the band says what to do.
        if (r.guest && !r.live) {
          return { ...r, cover: null, archive: false, startable: false, onWall: true };
        }
        // A LIVE GUEST (MC-18 stage 4) is read like a DJ's preset — its tile,
        // for the count — and then asked who is on it: `on:` names the DJ and
        // when, `current:` a programme, `ask:` a request's own words. Three KV
        // reads, and never djForPlaylistId, which cannot map a guest.
        if (r.guest) {
          const gpid = r.playlist;
          const kv = programsKV(env);
          const [gtile, gslug, on, ask] = await Promise.all([
            !throttle
              ? tileFor(envB, catalogFor(envB, r.catalog), gpid, budget, tiles, { serveStale: true }).catch(() => null)
              : (tiles.map[gpid] ?? null),
            kv.get(`current:${gpid}`).catch(() => null),
            kv.get(`on:${gpid}`, { type: "json" }).catch(() => null),
            kv.get(`ask:${gpid}`, { type: "json" }).catch(() => null),
          ]);
          return { ...r, cover: null, archive: false, pid: gpid, slug: gslug, on, ask,
            count: gtile?.count ?? null, startable: r.catalog === "spotify", onWall: true };
        }
        if (r.zone === "bench") {
          return { ...r, cover: null, archive: false, startable: false, onWall: false };
        }
        if (r.key === "archive") {
          // No m3u read here any more. Parsing the whole file to count takes
          // and total their seconds fed one line under the cover, and that line
          // is gone — the archive's own page still reads it, where the takes
          // are actually listed.
          // The set parked on it, if there is one — one KV read, and it is
          // what the band should say instead of a standing description. Reads
          // are the plentiful side of the KV allowance; writes were the tight
          // one, and this is not a write.
          const parked = await readStation(env, env.ARCHIVE_M3U_KEY || ARCHIVE.key);
          return { key: r.key, name: r.name, btn: r.btn,
            summary: r.summary, cover: null, archive: true,
            station: parked
              ? { title: parked.title, takes: parked.refs.length }
              : null,
            lastLoaded: null, fresh: false, playingHere: false };
        }
        // Read through whichever service the button is on.
        const pid = configuredPlaylistId(env, r.button);
        const [tile, slug] = await Promise.all([
          // Throttled: the cached tile or nothing — a read would only fail.
          pid && !throttle ? tileFor(envB, catalogFor(envB, r.catalog), pid, budget, tiles, { serveStale: true })
            : pid ? (tiles.map[pid] ?? null) : null,
          pid ? programsKV(env).get(`current:${pid}`).catch(() => null) : null,
        ]);
        // Count, runtime and the `stale` marker that qualified them went with
        // the meta line; the tile cache still carries all three for the DJ
        // page, and passing them to a renderer that ignores them is how a
        // caption gets added back believing it is wired to something.
        return {
          key: r.key, name: r.name, btn: r.btn, summary: r.summary,
          zone: r.zone, programsBy: r.programsBy, colour: r.colour ?? null,
          // Which service this PRESET is on, for the mark under the name.
          // The catalog belongs to the button, never to the DJ — which is
          // why a benched DJ carries none and why a move can change it.
          catalog: r.catalog ?? null,
          cover: tile?.cover ?? null, archive: false, pid, slug,
          // The count is NOT back on the card — it is here to decide whether
          // the card may offer a Play at all. A swap leaves a button empty,
          // and the grid was inviting a press that the DJ page correctly
          // refuses. It costs nothing: the tile read already carried it, and
          // it was being dropped one line later.
          count: tile?.count ?? null,
          // Edited in Spotify's or Tidal's own app since this server last
          // wrote it. The band says so, because the next set written here
          // takes those tracks with it.
          handEdited: tile?.drifted ?? null,
          // A DJ off the wall, or on a Tidal button: the card keeps its face
          // and loses its Play, because the POST behind that button can only
          // refuse — playback from here is Spotify Connect and nothing else.
          startable: !!pid && r.catalog === "spotify", onWall: !!r.button,
        };
      });

      if (tiles.dirty) await writeTiles(env, tiles.map);
      // The stale tiles are re-read after the page has gone out, on a budget
      // of their own, and written once; the next load finds them fresh. With
      // no request context (the node suite) the refresh runs here instead.
      if (tiles.refresh?.length) {
        const stale = tiles.refresh.map((pid) => [pid, roomRoster(env).find((r) => configuredPlaylistId(env, r.button) === pid)?.catalog ?? "spotify"]);
        const refresh = async () => {
          const later = withBudget(env, { remaining: 40 });
          const fresh = { map: await readTiles(later), dirty: false };
          await pooled(stale, 6, ([pid, catalog]) =>
            tileFor(later, catalogFor(later, catalog), pid, later.__budget, fresh).catch(() => null));
          if (fresh.dirty) await writeTiles(later, fresh.map);
          console.log(`wall:refresh tiles=${stale.length}`);
        };
        if (ctx?.waitUntil) ctx.waitUntil(refresh().catch(() => {}));
        else await refresh();
      }
      const summaries = await summariesP;
      // The player gets a short wait, then the page goes out without it,
      // marked pending; the read carries on behind the response.
      const early = await Promise.race([playingP,
        new Promise((r) => setTimeout(() => r(PLAYER_PENDING), WALL_PLAYER_WAIT_MS))]);
      const playing = early === PLAYER_PENDING ? { pending: true } : early;
      if (playing?.pending && ctx?.waitUntil) ctx.waitUntil(playingP);
      // WHAT A LIVE GUEST HOLDS, IN WORDS (MC-18 stage 4): the DJ its record
      // names, the programme's title or the request's own words, and since
      // when, in the house's own clock. The record and the pointers are the
      // door's, written after every verified write; a stale one costs a wrong
      // name for a minute, never a wrong write.
      // The newest set on a guest, as this page draws it: the page's script
      // reloads when /playing reports a newer one (2026-09-13).
      const guestsAt = newestOn(tileRows.filter((t) => t.guest && t.live).map((t) => t.on));
      // The newest ask bound for each live guest, read beside the rest.
      const asksP = guestAsks(env, Object.fromEntries(tileRows.filter((t) => t.guest && t.live)
        .map((t) => [t.catalog, { on: t.on && typeof t.on === "object" ? t.on : null }])));
      for (const t of tileRows) {
        if (!t.guest || !t.live) continue;
        const on = t.on && typeof t.on === "object" && !Array.isArray(t.on) ? t.on : null;
        const dj = on?.dj ? (house(env).djs[on.dj] ?? null) : null;
        const rec = t.slug ? summaries.find((x) => x.id === t.slug) : null;
        // The words behind the set: a request's, matched by its id, or —
        // since 2026-09-27 — Talk's own, which replace_playlist keeps as
        // `ask:` with no request id. Every write clears `ask:`, so one that is
        // there belongs to the set on the guest now.
        const asked = !rec && t.ask?.text && (on?.ref === `request ${t.ask.requestId}` ||
          (on?.ref === "talk" && !t.ask.requestId)) ? String(t.ask.text) : null;
        t.holder = {
          djKey: dj && !dj.archiveOnly ? dj.key : null, djName: dj?.name ?? null,
          talk: !dj && on?.ref === "talk", known: !!on,
          title: rec?.title ?? null, asked,
          loaded: loadedWords(houseClockWords(env, on?.at)),
          open: t.catalog !== "spotify" ? (serviceLink("playlist", t.pid)?.href ?? null) : null,
        };
        t.playingHere = !!(playing && !playing.unknown && t.pid && playing.pid === t.pid);
        delete t.pid; delete t.slug; delete t.on; delete t.ask; delete t.playlist;
      }
      for (const t of tileRows) {
        if (t.archive || t.empty || t.fixed || t.guest || t.zone === "bench") continue;
        // The loaded programme's title is gone from the card; its AGE is what
        // stays, as a marker on the count. `created` is already in the listing
        // metadata, so this costs nothing beyond the lookup that was already
        // happening. An unparseable or missing date is not fresh — absent
        // beats wrong, and a badge is not worth guessing at.
        const rec = t.slug ? summaries.find((x) => x.id === t.slug) : null;
        const at = Date.parse(rec?.created ?? "");
        // The age of the set ON THIS BUTTON, and nothing else. It used to ride
        // along with a count of the DJ's own programmes, and the card only
        // showed it when that count was non-zero — an accident of packaging
        // that would have hidden the mark on a button holding a programme
        // written for somebody else. The count is off the card; the coupling
        // went with it.
        t.fresh = Number.isFinite(at) && Date.now() - at < ROOM_NEW_PROGRAM_MS;
        t.playingHere = !!(playing && !playing.unknown && t.pid && playing.pid === t.pid);
        delete t.pid; delete t.slug;
      }
      if (playing && !playing.unknown) playing.tileName = tileRows.find((t) => t.playingHere)?.name ?? null;

      // No sentence after a swap any more (the owner, 2026-09-05): the wall
      // itself is the answer, and the one thing the sentence carried that the
      // wall cannot show — buttons owed a re-save on the speaker — rides as a
      // count on the Speakers chip — the same count every tab shows, the
      // endless presets a speaker still names for the DJ who left included
      // (the owner, 2026-09-24: the badge was on Speakers and not here).
      const owed = await tabOwed(env);
      // A GUEST'S PLAY COMES BACK HERE (MC-18 stage 4), its outcome a code and
      // the guest a number, both checked before a word of either is printed.
      // "ok" says nothing: the band shows what is playing.
      const playedCode = String(url.searchParams.get("played") ?? "");
      const playedGuest = Object.values(house(env).guest ?? {})
        .find((g) => g && String(g.btn) === url.searchParams.get("g")) ?? null;
      const played = playedGuest && ["sent", "stuck", "asleep", "failed"].includes(playedCode)
        ? { code: playedCode, name: playedGuest.name,
            on: parseRoomDevices(env).find((d) => d === (url.searchParams.get("on") ?? "")) ?? null }
        : null;
      if (played) played.kind = speakerKind(env, played.on);
      // The asks under the guests' bands, in words; and the music, when it is
      // on none of the bands, said over the wall (2026-09-13).
      const { asks: guestAskRows, sig: asksSig } = await asksP;
      const asks = guestAskRows.map((a) => {
        const iso = Number.isFinite(a.row.created_at) ? new Date(a.row.created_at).toISOString() : null;
        return { btn: a.btn, dj: a.row.dj, djName: house(env).djs[a.row.dj]?.name ?? null, state: a.row.state,
          reason: a.row.decline_reason ?? null,
          at: iso ? atWords(houseClockWords(env, iso)) : null };
      });
      // No line over the wall for music on none of the bands (the owner,
      // 2026-09-24): the now bar, right below, says what is playing and
      // from which preset, and the two said it twice. The readings are
      // already on their way for the bands and the bar.
      const recsNow = await readingsP;
      // THE NOW BAR (MC-21). Three cases, none of which spends a read this
      // page did not already make. Pending — the player had not answered in
      // 250 ms and the page is going out without it — leaves the bar a
      // skeleton with NO fetch of its own: this page's poll asks /playing at
      // once for a pending page and hands the answer to the bar, so a second
      // fetch from the bar would be the double read Codex found. Otherwise
      // the raw read is in hand and instant.
      const barNow = playing?.pending ? null
        : throttle ? await nowAnswer(env, request, null, { recs: recsNow, throttle })
        : await (async () => {
          const pNow = await rawPlayerP.then(roomPlaying).catch(() => ({ unknown: true }));
          return await nowAnswer(env, request, pNow, { recs: recsNow, note: await pauseNoteBeside(env, pNow) });
        })();
      // The one speaker (MC-28): the bar's answer's, or — the page going out
      // before the player answered — the rule without Spotify's read.
      const pickNow = barNow?.pick ?? pickFor(env, request, null, (await helperView(env)).lan);
      const tg = guestFor(env, "tidal");
      // THE GUEST DJ'S BAND (the owner, 2026-09-25: "build it"): what 3 plays
      // if pressed — who, from which set, since when — from the ledger alone.
      let lane = null;
      try {
        const lcfg = parseEndless(env);
        const lp = lcfg?.mode === "live" ? lcfg.presets.find((x) => x.lane) : null;
        if (lp && env.STATION) {
          const lst = await endlessLoad(env);
          const ldj = lst.lane?.dj && lst.lane.ready !== false ? findDj(env, lst.lane.dj) : null;
          lane = { btn: lp.button, playlist: lp.playlist,
            ...(ldj ? { djKey: ldj.key, djName: ldj.name, program: lst.lane.program?.title ?? null, words: lst.lane.words ?? null,
              picked: loadedWords(houseClockWords(env, new Date(Number(lst.lane.since) || Date.now()).toISOString())) } : {}),
            making: !!Object.values(lst.jobs ?? {}).some((j) => j?.btn === lp.button && j?.kind === "fresh" && !j.done) };
        }
      } catch { lane = null; }
      // THE HOUSE DJs (2026-10-24, the owner's A of docs/design/loaded-house:
      // "show request (1-2), guest 3 and then the presets with house DJs"):
      // each house DJ's preset and what a press would do, from the ledger, its
      // log, the playlists' marks and the tuning; no Spotify call. The song is
      // the bar's to say; the playing row only says how long it goes on.
      let houseRows = null;
      try {
        const hcfg = parseEndless(env);
        if (hcfg?.mode === "live" && env.STATION) {
          const hst = await endlessLoad(env);
          const slots = endlessSlots(env, hcfg, hst).sort((a, b) => a.button - b.button);
          if (slots.length) {
            const rows = await endlessLogRows(env, 200);
            const pidNow = playing && !playing.unknown ? playing.pid ?? null : null;
            houseRows = await Promise.all(slots.map(async (sl) => {
              const dj = findDj(env, sl.dj);
              const here = !!pidNow && pidNow === sl.playlist;
              const bar = here ? await endlessBar(env, sl.button, null, hst).catch(() => null) : null;
              const mark = here ? null : await programsKV(env).get(`mark:${sl.playlist}`, { type: "json" }).catch(() => null);
              const tuned = dj ? tuningSummary(env, dj.key) : "";
              return { btn: sl.button, djKey: dj?.key ?? sl.dj, djName: dj?.name ?? sl.dj, here,
                does: here ? (bar?.last ? `The last songs${bar.until ? `: it ends about ${bar.until}` : ""}`
                  : bar?.until ? `Endless until ${bar.until}` : "Endless")
                  // Nothing known of the next press: what the DJ plays (the
                  // owner: "see the different DJs and what music it would be").
                  : nextPressWords(hst, sl.button, rows, Number.isInteger(mark?.n) ? mark.n : null)
                    ?? WHICH[dj?.key]?.field ?? dj?.summary ?? "",
                more: tuned ? `Tuned: ${tuned}` : dj?.key === "vibe" ? vibeHourWords(env) : null };
            }));
          }
        }
      } catch { houseRows = null; }
      return roomPage(renderRoom({
        base, notesHref: `/notes/${key}`, now: barNow, lane, house: houseRows, quiet: await curatorQuiet(),
        hkey: tg?.live ? await helperKeyFor(env, request, tg.btn, playing?.pending ? undefined : playing) : null, hflash: helperKeyFlash(env, url),
        defaultDevice: fallbackDevice(env), devices: parseRoomDevices(env), pick: pickNow?.name ?? null,
        playing, tiles: tileRows, owed, talk: talkOn(env), loaded: boxes.length > 0, played, guestsAt, paused: url.searchParams.get("paused"),
        speakers: boxes.map(({ name, slug }) => ({ name, slug })), ...readingsShown(env, recsNow),
        asks, asksSig,
        // The Tidal request heard by the helper, lit from the first paint
        // (the review, 2026-09-26: it waited for the 30-second poll).
        lanBand: await (async () => { try { const hv = await helperView(env);
          return hv.lan ? await lanOnGuest(env, hv.lan, await guestHolders(env)) : null; } catch { return null; } })(),
      }));
    }

    // The speakers. GET /wiim is the ledger: what every preset should read
    // and which buttons are owed a re-save in the WiiM app since they changed
    // hands. POST /wiim/done records that the owner re-saved one. Nothing
    // under here touches a speaker any more — the table write this page used
    // to prepare detached the preset it renamed (docs/roster.md).
    //
    // Above the picker and the DJ page, which would otherwise read "wiim" as
    // a DJ slug.
    const speakersPage = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/wiim(\/.*)?$/);
    if (speakersPage) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(speakersPage[1], key)) return notFound();
      const base = `/buttons/${key}`;
      const sub = speakersPage[2] ?? "";
      // THE PAUSE (MC-20, moved onto the now bar by MC-21 — tasks/done/mc20-speaker-pause.md,
      // tasks/done/mc21-now-bar.md). Spotify only, pause only, and it never starts
      // anything: the keys do that. Two ways in. The now bar's script asks
      // for JSON (Accept: application/json) and redraws in place, so a pause
      // from a DJ's page leaves you on the DJ's page; a plain form gets the
      // 303 back to the Speakers page it always had. EVERY answer on the JSON
      // path is JSON, refusals included — a script handed an HTML page where
      // it expected JSON would call a refusal a success or throw.
      // A KEY PRESSED BY THE HOME HELPER (MC-25 stage 3): any preset on a
      // WiiM — Tidal, the archive, a station — as the remote presses it, for
      // the keys the Spotify path cannot start. A form from the Speakers
      // page; back to it with the outcome. Its read-back is kept, so the
      // block says what the key started.
      if (sub === "/key") {
        if (request.method !== "POST") return roomRefuse(405, "A key is pressed with a POST, from the Speakers page.");
        const origin = request.headers.get("origin");
        if (origin && origin !== "null" && origin !== url.origin) return roomRefuse(403, `This was sent from ${origin}, not from ${url.origin}.`);
        let form = null;
        try { form = await request.formData(); } catch { form = null; }
        const n = Number(form?.get("btn"));
        const box = parseSpeakers(env).find((sp) => sp.name === String(form?.get("device") ?? "")) ?? null;
        if (!box || !Number.isInteger(n) || n < 1 || n > 12) return roomRefuse(400, "That is not a key on one of this house's WiiMs. Nothing was pressed.");
        const code = await helperPress(env, box, n);
        // Back where the press was made: Speakers, Loaded, or a DJ's page.
        const bk = String(form?.get("back") ?? "");
        const djBack = /^dj:([a-z0-9-]{1,40})$/.exec(bk)?.[1] ?? null;
        const page = bk === "loaded" ? base : djBack && (djBack === "archive" || house(env).djs[djBack]) ? `${base}/${djBack}` : `${base}/wiim`;
        return new Response(null, { status: 303, headers: {
          location: `${page}?hk=${code}&k=${n}&kon=${encodeURIComponent(box.slug)}`,
          "cache-control": "no-store",
          // A key pressed on a speaker picks it, as a Play does.
          ...(code === "ok" ? { "set-cookie": pickCookie(box.name) } : {}) } });
      }
      if (sub === "/transport") {
        const json = /application\/json/.test(request.headers.get("accept") ?? "");
        const refuse = (status, code, why) => json
          ? new Response(JSON.stringify({ ok: false, code, why }), { status, headers: {
            "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
            "x-content-type-options": "nosniff" } })
          : roomRefuse(status, why);
        if (request.method !== "POST") return refuse(405, "method", "Pause takes a POST, from the house's own pages.");
        // The form path serves clients that send no Origin; the JSON path is
        // only ever a fetch from our own page, which always sends one.
        const origin = request.headers.get("origin");
        if (json ? origin !== url.origin : origin && origin !== "null" && origin !== url.origin) {
          return refuse(403, "origin", `This was sent from ${origin ?? "nowhere"}, not from ${url.origin}.`);
        }
        let form = null;
        try { form = await request.formData(); } catch { form = null; }
        const verb = String(form?.get("do") ?? "");
        // PAUSE, OR PLAY AGAIN WHAT THE PAUSE STOPPED. Never Spotify's resume:
        // there was one, and it went with the "paused" state (see
        // roomPlaying), because on a speaker that had moved to Tidal it would
        // have taken the room away from Tidal and called that un-pausing.
        // "again" is a fresh start of the set the bar's pause wrote down —
        // what tapping that key does — and only from the bar's script.
        if (verb !== "pause" && !((verb === "again" || verb === "move" || verb === "next" || verb === "prev" || verb === "hpause" || verb === "hplay" || verb === "hmove" || verb === "hkey") && json)) return refuse(400, "verb", "The form must say pause.");
        const boxes = parseSpeakers(env);
        const wanted = String(form?.get("device") ?? "").trim();
        // A WiiM, or since 2026-09-23 any other speaker the play form may
        // name (an Echo): the pause is Spotify's either way.
        const other = otherRooms(env).find((n) => n === wanted) ?? null;
        const box = boxes.find((sp) => sp.name === wanted) ?? (other ? { name: other, slug: speakerSlug(other) } : null);
        if (!box) {
          return refuse(400, "device", `The speakers this house named are ${[...boxes.map((b) => b.name), ...otherRooms(env)].join(", ") || "none"}; ` +
            `"${wanted.slice(0, 60)}" is not one of them. Nothing was sent.`);
        }
        const allowed = parseRoomDevices(env);
        if (!allowed.includes(box.name)) {
          return refuse(400, "device", `"${box.name}" is not one of the configured speakers (${allowed.join(", ")}). Nothing was sent.`);
        }
        // A PRESET PRESSED AGAIN FROM THE BAR (the owner, 2026-10-10: Pub Rock
        // stopped on the Pro Plus, Spotify had let go, and the disc was dim).
        // The helper presses the preset the stopped song came from, as the
        // Speakers tab's key does; never Spotify's resume, which plays the
        // account's last session (measured 2026-09-29). A WiiM and 1-12 only.
        if (verb === "hkey") {
          const n = Number(form?.get("btn"));
          const code = !boxes.some((sp) => sp.name === box.name) ? "not-wiim"
            : !Number.isInteger(n) || n < 1 || n > 12 ? "failed" : await helperPress(env, box, n);
          return new Response(JSON.stringify({ ok: code === "ok", code }), { status: 200, headers: {
            "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
            // A key pressed on a speaker picks it, as everywhere.
            ...(code === "ok" ? { "set-cookie": pickCookie(box.name) } : {}) } });
        }
        // PAUSE AND PLAY BY THE HOME HELPER (MC-25 stage 2): a WiiM playing
        // something that is not Spotify, which only the helper on the LAN can
        // reach. Not Spotify's, so no quota; a WiiM only; the helper takes
        // "pause" and "resume" and nothing it is not told here.
        if (verb === "hpause" || verb === "hplay") {
          let hcode = "failed";
          if (!boxes.some((sp) => sp.name === box.name)) hcode = "not-wiim";
          else {
            try {
              const out = await station(env, "helper-command", { cmd: verb === "hpause" ? "pause" : "resume", speaker: box.name });
              hcode = out?.ok ? "ok" : ["helper-off", "timeout", "unreachable"].includes(out?.code) ? out.code : "failed";
              // Its read-back is the freshest word on that speaker: kept, so the
              // bar's next look says paused or playing at once.
              const one = out?.reading ? parseHelperReading(env, { speakers: [out.reading] }) : null;
              if (one) {
                const got = await station(env, "helper-get", {});
                const doc = got?.doc ?? {};
                await station(env, "helper-put", { doc: { at: Date.now(), speakers: { ...(doc.speakers ?? {}), ...one } } });
              }
            } catch { hcode = "failed"; }
          }
          return new Response(JSON.stringify({ ok: hcode === "ok", code: hcode }), { status: 200, headers: {
            "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
        }
        // THE RADIO MOVES (the owner, 2026-10-03). Only Spotify moves between
        // speakers, but a station saved under the same name on the other WiiM
        // is the same station, and live radio has no place in it to lose. The
        // helper presses that key there, then pauses the WiiM it came from —
        // in that order, so a press that fails leaves the radio where it was.
        // The station is the helper's reading of `from` (getMetaInfo's
        // subtitle, "KQED-FM"), the key the target's own preset table. No
        // name on both, no move: "stays". CODEX'S REVIEW (2026-10-09): the bar
        // says which station it saw, and a source that reads another one now
        // is not moved ("changed"); a target whose key started some other
        // station leaves the source playing ("mismatch"); and the source must
        // be a speaker the pages may name, as the target must.
        if (verb === "hmove") {
          const src = boxes.find((sp) => sp.name === String(form?.get("from") ?? "")) ?? null;
          const saw = String(form?.get("station") ?? "").trim();
          let out;
          if (!src || !allowed.includes(src.name) || !boxes.some((sp) => sp.name === box.name)) out = { code: "not-wiim" };
          else if (src.name === box.name) out = { code: "here" };
          else {
            const hv = helperViewOf(env, await helperGot(env));
            const r = hv.lan?.speakers?.[src.name];
            const btn = r?.state === "play" && r.station
              ? stationKey((await readReadings(env, [box]))[box.slug]?.presets, r.station) : null;
            if (!hv.lan?.hands) out = { code: "helper-off" };
            else if (saw && !sameStation(saw, r?.state === "play" ? r.station : null)) out = { code: "changed" };
            else if (!btn) out = { code: "stays", ...(r?.station ? { station: r.station } : {}) };
            else {
              const pressed = await helperCommand(env, { cmd: "key", n: btn, speaker: box.name });
              if (pressed.code !== "ok") out = { code: pressed.code, station: r.station, btn };
              else if (pressed.heard?.station && !sameStation(pressed.heard.station, r.station)) {
                out = { code: "mismatch", station: r.station, btn, heard: pressed.heard.station };
              } else {
                out = { code: (await helperPause(env, src)) === "ok" ? "ok" : "both", station: r.station, btn };
              }
            }
          }
          return new Response(JSON.stringify({ ok: out.code === "ok", ...out }), { status: 200, headers: {
            "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
        }
        const throttle = await throttledUntil(env);
        if (throttle) {
          return refuse(503, "throttled",
            `Spotify is limiting this account's requests for about ${waitWords(minutesLeft(throttle))} ` +
            "more (quota exceeded), so this site cannot pause a speaker until then. Nothing was sent.");
        }
        // PAUSE THE SPEAKER THE PAGE NAMED, NOT WHATEVER SPOTIFY HOLDS. A bare
        // PUT /me/player/pause stops Spotify's active device; the bar can be
        // minutes old on a page that does not poll, and a pause pressed on a
        // bar saying Ultra must never stop the Pro Plus. So read the player
        // fresh: if Spotify is not playing on the named speaker any more,
        // nothing is sent ("gone"); if it is, the pause names that device.
        const fold = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        let code = "ok";
        let noted = null;
        if (verb === "again") {
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
        } else if (verb === "next" || verb === "prev") {
          // SKIP, FROM THE NOW PANEL (2026-09-25, design A): Spotify only, and
          // only the speaker the panel names, read fresh as the pause reads
          // it, so a skip on a panel minutes old never skips another room.
          const envB = withBudget(env, { remaining: 6 });
          try {
            const st = await playerState(envB);
            if (!st?.device?.id || st.is_playing !== true || fold(st.device.name) !== fold(box.name)) code = "gone";
            else {
              await spotify(envB, "POST", verb === "next" ? "/me/player/next" : "/me/player/previous", { params: { device_id: st.device.id } });
            }
          } catch (e) {
            code = e?.status === 404 ? "gone" : "failed";
          }
        } else if (verb === "move") {
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
        } else {
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
        }
        if (json) {
          // An accepted pause answers with what the bar now says, so it can
          // say it at once rather than after Spotify's read catches up.
          const paused = noted ? pausedFor(env, noted) : null;
          return new Response(JSON.stringify({ ok: code === "ok", code, ...(paused ? { paused } : {}) }), { status: 200, headers: {
            "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
            "x-content-type-options": "nosniff" } });
        }
        return new Response(null, { status: 303, headers: {
          location: `${base}/wiim?tp=${code}&tdo=${verb}&ton=${encodeURIComponent(box.slug)}`,
          "cache-control": "no-store" } });
      }
      if (sub === "" || sub === "/") {
        if (request.method !== "GET") return roomRefuse(405, "The speakers page only answers GET.");
        // A KEY'S PLAY, BACK FROM ITS 303 (MC-19): parsed first, because a
        // flash that parses is the one request that bypasses the checklist
        // below — the tap's outcome is seen where the tap was made — and
        // reads the player fresh rather than from the ten-second memo, so the
        // block shows the set that just started. Stage 6 of MC-18 deletes the
        // checklist with the ledger, and this carve-out with it.
        const kp = presetFlash(env, url);
        const tp = transportFlash(env, url);
        // OPTION A (2026-09-13, the owner's choice from the layouts canvas):
        // what each speaker is playing, and what they hold. The re-save
        // checklist that took the page over went in stage 6 (2026-09-26).
        {
          const boxes = parseSpeakers(env);
          const throttle = await throttledUntil(env);
          const [pRead, recs] = await Promise.all([
            throttle ? Promise.resolve({ unknown: true, throttled: true })
              // The house's kept answer (MC-29). A flash of either kind
              // reads fresh: after a pause or a key it may still say playing.
              : housePlayer(withBudget(env, { remaining: 4 }), { fresh: !!(kp || tp), deadlineMs: PLAYER_DEADLINE_MS })
                .then(roomPlaying).catch(() => ({ unknown: true })),
            readReadings(env, boxes),
          ]);
          // A PAUSE SPOTIFY JUST ACCEPTED IS A PAUSE (2026-09-22, measured in
          // the room). This landing reads the player fresh a fraction of a
          // second after the transport route's PUT returned 2xx, and Spotify's
          // own answer lags its acknowledgement: the phone landed here within
          // the same second, was told "playing", drew the disc and the
          // scrolling track, and the thirty-second poll corrected it a minute
          // later — which the owner read as "the second press worked". curl
          // never caught it; it waits for the whole round trip before it
          // fetches. So on a landing from an accepted pause the speaker it
          // named is drawn quiet from the acceptance, not from the read. ONLY
          // that speaker: Spotify playing somewhere else is still said. And
          // the page re-checks once at three seconds (data-paused), so if
          // Spotify did not pause after all, the truth shows in three
          // seconds and not sixty.
          const justPaused = tp && tp.code === "ok" && tp.verb === "pause" ? tp.box : null;
          const fold = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
          const p = justPaused && pRead && !pRead.unknown && pRead.device && fold(pRead.device) === fold(justPaused.name)
            ? null : pRead;
          // The flash names the key as that speaker holds it; failing a
          // reading, by its number.
          const flash = kp ? { code: kp.code, btn: kp.btn, on: kp.box.name, kind: speakerKind(env, kp.box.name),
            name: recs[kp.box.slug]?.presets?.find((x) => x.btn === kp.btn)?.name || `preset ${kp.btn}` } : null;
          // Where the music is from, as the Loaded tab would say it: a preset
          // by its number and name, or where else it is playing from.
          const roster = roomRoster(env);
          const onBand = p?.pid ? roster.find((r) => r.zone === "wall" && r.btn && (
            (r.guest && r.live && r.playlist === p.pid) ||
            (r.key && r.button && configuredPlaylistId(env, r.button) === p.pid))) ?? null : null;
          // Or a key of the playing speaker's own (MC-19 stage 3b): the block
          // says "From preset 5 (Hank)" for a set a key holds, as the poll will.
          const onKey = !onBand && p?.pid ? speakerPresetFor(env, recs, p) : null;
          let onPreset = onBand ? { btn: onBand.btn, name: onBand.name } : onKey;
          // THE ENDLESS PRESETS (MC-24): filled, since the app fills them; named
          // for who is on each now; and owed a save on a speaker whose reading
          // still says the DJ who left.
          const ecfg = parseEndless(env);
          let endlessKeys = {};
          if (ecfg?.mode === "live" && env.STATION) {
            try {
              const est = await endlessLoad(env);
              const slots = endlessSlots(env, ecfg, est);
              const owed = endlessOwed(env, slots, recs);
              endlessKeys = Object.fromEntries(slots.map((x) => [x.button, { name: x.name,
                owed: owed.find((o) => o.btn === x.button)?.speakers.map((sp) => sp.slug) ?? [] }]));
              const slot = onPreset && p?.pid ? slots.find((x) => x.button === onPreset.btn && x.playlist === p.pid) : null;
              if (slot) onPreset.name = slot.name;
              // An endless preset's own playlist on a speaker with no key for
              // it — the Echo, or a reading gone stale — is still that preset.
              const own = !onPreset && p?.pid ? slots.find((x) => x.playlist === p.pid) : null;
              if (own) onPreset = { btn: own.button, name: own.name };
              if (onPreset && pastTheList(est, onPreset.btn, p?.uri)) onPreset.autoplay = true;
            } catch { endlessKeys = {}; }
          }
          const archiveTile = roster.find((r) => r.archive || r.key === "archive") ?? null;
          // A HOUSE WITH NO WIIM ADDRESSES (a door-made house, MC-31's trial,
          // 2026-10-17: the page showed only what was playing and called the
          // Pro Plus "not a WiiM"): its speakers are the ones chosen at setup,
          // and its keys the house's own Spotify presets, which play over
          // Spotify Connect with nothing read from the speaker.
          const houseKeys = !boxes.length;
          const shownSpeakers = houseKeys
            ? wiimNames(env).map((name) => ({ name, slug: speakerSlug(name) }))
            : boxes.map(({ name, slug }) => ({ name, slug }));
          // THE NOW BAR, FILLED HERE (MC-21). This route has already read the
          // player, so its bar is right at paint and asks /playing for
          // nothing — where a skeleton would flash a placeholder and then
          // spend a SECOND player read on one view. The shape is the one
          // /playing answers in, because the page script updates the same bar
          // from that route on the poll.
          const barNow = await nowAnswer(env, request, throttle ? null : p, { recs, throttle,
            note: throttle ? null : await pauseNoteBeside(env, pRead?.unknown ? pRead : p) });
          // ENDLESS, SAID ON THE BLOCK (the owner, 2026-10-13): the answer's
          // own preset decides it (endlessNamed), as the poll reads it. It
          // names the guest DJ's lane as the poll does too — "From Guest DJ ·
          // Dutch · endless", not the speaker's saved name for 3 ("Endless ·
          // endless").
          const np = onPreset && barNow.state === "playing" && barNow.preset?.btn === onPreset.btn ? barNow.preset : null;
          return roomPage(renderSpeakersNow({
            now: barNow, justPaused: justPaused?.slug ?? null, held: barNow.paused ?? null,
            lan: barNow.lan ?? null,
            hflash: helperKeyFlash(env, url),
            base, speakers: shownSpeakers,
            ownKeys: houseKeys ? await ownPresetRows(env, endlessKeys) : null,
            setupHref: houseKeys && env.SETUP_KEY && !parseEndless(env)?.presets?.length ? "/setup" : null,
            playing: p ? { ...p, from: onPreset ? `${onPreset.autoplay ? "Spotify's pick, after " : ""}${np?.lane ? np.name : `preset ${onPreset.btn} (${onPreset.name})`}` : await playingFromFor(env, p),
              onPreset: !!onPreset, ...(np?.endless && !onPreset.autoplay ? { endless: true } : {}) } : null,
            playable: playableKeys(env, boxes, recs), endlessKeys,
            rooms: parseRoomDevices(env), others: otherRooms(env).filter((n) => !shownSpeakers.some((sp) => sp.name === n)),
            loaded: !houseKeys,
            tflash: tp ? { code: tp.code, verb: tp.verb, on: tp.box.name } : null,
            ...readingsShown(env, recs),
            fills: roster.filter((r) => r.guest && r.live).map((r) => r.btn),
            archive: archiveTile ? { btn: archiveTile.btn, name: archiveTile.name } : null,
            names: Object.fromEntries(roster.filter((r) => r.zone === "wall" && r.btn && (r.guest || r.key) &&
              r.key !== "archive").map((r) => [r.btn, r.name])),
            // The one speaker (MC-28, pickFor): its block is the picked one.
            defaultDevice: fallbackDevice(env),
            flash, pick: barNow.pick?.name ?? null,
            // The Spotify sign-in, said here while it is due (stage 0b).
            login: await spotifyLogin(env),
            ...(await tabState(env)),
          }));
        }
      }
      return notFound();
    }

    // The picker, and the swap it performs. GET shows one button and who
    // could be on it; POST to the same address does it, and 303s back to the
    // grid — so a refresh cannot repeat a write that has no undo.
    //
    // It sits ABOVE the DJ page's route, which would otherwise match "wall"
    // as a DJ slug and 404 in the wrong words.
    // WHAT THE SPEAKERS HOLD (2026-09-13, the owner: "how do I get the preset
    // page to show what is actually the reality on the WiiM presets?"). The
    // Worker cannot reach a speaker, so the "Read WiiM Presets" shortcut on a
    // phone at home asks each one (GetKeyMapping — a read) and posts what it
    // answered here. GET /readings is the page: the last reading per speaker,
    // and the recipe. GET /readings/ask.xml is the question the shortcut puts
    // to a speaker, served so nobody types XML into a phone. POST
    // /readings/<speaker> keeps a reading, stamped with the server's own time,
    // and answers in words for the phone to show. Nothing here writes to a
    // speaker, and no reading ticks the re-save ledger. Above the DJ page's
    // route, which would read "readings" as a DJ slug.
    const readingsRoute = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/readings(?:\/(ask\.xml|[a-z0-9-]{1,40}))?$/);
    if (readingsRoute) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(readingsRoute[1], key)) return notFound();
      const base = `/buttons/${key}`;
      const what = readingsRoute[2] ?? null;
      const boxes = parseSpeakers(env);
      const plain = (status, text) => new Response(text, {
        status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store",
          "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow" } });
      if (!what) {
        if (request.method !== "GET") return roomRefuse(405, "This page only answers GET.");
        const { readings } = readingsShown(env, await readReadings(env, boxes));
        let site;
        try { site = programBaseUrl(env); } catch { site = url.origin; }
        const guests = Object.fromEntries(house(env).buttons.filter((b) => b.guest).map((b) => [b.btn, b.name]));
        return roomPage(renderReadings({
          base, origin: site, speakers: boxes, readings, guests,
          control: { port: CONTROL_PORT, path: CONTROL_PATH, action: READ_ACTION },
          ...(await tabState(env)),
        }));
      }
      if (what === "ask.xml") {
        if (request.method !== "GET") return roomRefuse(405, "The question only answers GET.");
        return new Response(READ_ENVELOPE, { headers: { "content-type": "text/xml; charset=utf-8",
          "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      const box = boxes.find((sp) => sp.slug === what);
      if (!box) {
        return plain(404, `No speaker called "${what}" in this house` +
          (boxes.length ? ` — it has ${boxes.map((sp) => sp.slug).join(" and ")}.` : ", which names none."));
      }
      if (request.method !== "POST") {
        return plain(405, "A reading is sent here with POST, by the Read WiiM Presets shortcut. " +
          `The recipe is at ${base}/readings.`);
      }
      const sentFrom = request.headers.get("origin");
      if (sentFrom && sentFrom !== "null" && sentFrom !== url.origin) {
        return plain(403, `A reading comes from the shortcut, not from ${sentFrom}.`);
      }
      const size = Number(request.headers.get("content-length") ?? 0);
      let text = "";
      if (!(size > READING_MAX_BYTES)) { try { text = await request.text(); } catch { text = ""; } }
      if (size > READING_MAX_BYTES || text.length > READING_MAX_BYTES) {
        return plain(413, `${box.name}: that is bigger than a preset table (${READING_MAX_BYTES / 1024} KB at most).`);
      }
      const kept = await keepReading(env, box, text);
      if (kept.bad) return plain(400, `${box.name}: ${kept.bad} Check that the shortcut sends the speaker's answer as the request body.`);
      if (!kept.ok) return plain(500, `${box.name}: the reading could not be kept. Run the shortcut again.`);
      return plain(200, readingWords(box.name, kept.presets, atWords(houseClockWords(env, kept.at)) ?? "just now"));
    }

    // THE METER'S OWN ADDRESS (MC-18 stage 4): /buttons/<key>/use, so it
    // outlives the Speakers route when that goes (stage 6). No tab yet — the
    // Speakers tab stays lit on it.
    // Above the DJ page's route, which would read "use" as a DJ slug.
    const usePage = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/use$/);
    if (usePage) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(usePage[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "The use page only answers GET.");
      return roomPage(renderUse({ base: `/buttons/${key}`, calls: await spotifyCalls(env),
        kv: await kvOps(env), ...(await tabState(env)) }));
    }

    // THE HOUSE RULES (2026-09-26): docs/house-rules.md, in the app. From the
    // Speakers tab's footer, like Use; the Speakers tab stays lit on it.
    const rulesPage = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/rules$/);
    if (rulesPage) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(rulesPage[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "The house rules page only answers GET.");
      return roomPage(renderRules({ base: `/buttons/${key}`, md: RULES_MD, facts: await rulesFacts(env), ...(await tabState(env)) }));
    }

    // RECONNECT SPOTIFY (MC-31 stage 0b, 2026-10-16; spotify-login.js). The
    // page, from the Speakers tab's footer; its Reconnect, a plain link and
    // not a form, because the pages' form-action 'self' would stop a form's
    // redirect to Spotify; and the way back, at one fixed address with no key
    // in it, which is why it is guarded by the one-use state instead.
    const spotifyPage = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/spotify(\/connect)?$/);
    // RECONNECT IS THE OWNER'S where the house has a setup door (Codex,
    // 2026-10-17): the page key is the family's and can leak, and with it a
    // stranger could bind their own Spotify to a house that has no account
    // recorded, or spend a KV write per hit on the way to Spotify. The page
    // itself stays the family's. A house with no setup door keeps the page
    // key and the same-account rule alone.
    const reconnectOk = async () => !setupOpen(env) || await isOwner(env, request);
    if (spotifyPage) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(spotifyPage[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "The Spotify page only answers GET.");
      const mine = await reconnectOk();
      if (spotifyPage[2]) {
        if (!mine) return new Response(null, { status: 303, headers: { location: "/setup", "cache-control": "no-store" } });
        // A house with no Spotify app yet, or a start that fails, gets a page
        // with a way back, never a bare 500 (Codex, 2026-10-17).
        let to;
        try { to = await startLogin(env, url.origin, { back: url.searchParams.get("from") === "setup" ? "setup" : null }); } catch {
          return roomPage(renderRefusal({ why: env.SPOTIFY_CLIENT_ID
            ? "The house could not start Spotify's sign-in just now. Nothing changed: try again in a minute."
            : "This house has no Spotify app yet: its Client ID, from Spotify's developer dashboard, comes first.",
          back: `/buttons/${key}/spotify`, backLabel: "Spotify" }), { status: 503, headers: { "cache-control": "no-store" } });
        }
        return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
      }
      let flash = null;
      try { flash = JSON.parse(url.searchParams.get("said") ?? "null"); } catch { flash = null; }
      return roomPage(renderSpotify({ base: `/buttons/${key}`, login: await spotifyLogin(env),
        flash: flash && typeof flash === "object" ? flash : null, callback: mine ? callbackUrl(env, url.origin) : "",
        reconnect: mine, ready: !!env.SPOTIFY_CLIENT_ID, setup: mine && setupOpen(env), ...(await tabState(env)) }), { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === CALLBACK_PATH) {
      if (request.method !== "GET") return notFound();
      // Refusals here are pages with a way on to /setup, which names no key
      // (Codex, 2026-10-17: bare text was a dead end in the in-app browser).
      const toSetup = (status, why) => roomPage(renderRefusal({ why, back: "/setup", backLabel: "Set up" }),
        { status, headers: { "cache-control": "no-store" } });
      if (!(await reconnectOk())) {
        return toSetup(403, "Only the house's owner can reconnect Spotify: sign in on the house's setup page, then press Reconnect again.");
      }
      const done = await finishLogin(env, url.searchParams, url.origin);
      const key = env.PROGRAM_LIBRARY_KEY;
      // A state this house never gave out goes no further: on to the keyed
      // page would hand the key to whoever typed this address.
      if (!key || !done.known) {
        if (done.ok) return new Response(`Reconnected as ${done.name}.`, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
        return toSetup(400, done.why);
      }
      const said = done.ok ? { ok: true, name: done.name, endsAt: done.endsAt, first: !!done.first } : { why: done.why };
      // Started from the checklist: back to it, saying how it went.
      if (done.back === "setup") {
        return new Response(null, { status: 303, headers: { "cache-control": "no-store",
          location: `/setup?spotify=${encodeURIComponent(done.ok ? `Signed in to Spotify as ${done.name}.` : done.why)}` } });
      }
      return new Response(null, { status: 303, headers: {
        location: `/buttons/${key}/spotify?said=${encodeURIComponent(JSON.stringify(said))}`, "cache-control": "no-store" } });
    }

    // TALK (MC-15, 2026-09-12): the fifth tab and its three doors. The page
    // is GET; the doors are POSTs a page's own script makes — session (an
    // SDP offer in, an answer and a per-session capability out), tool (one
    // function call the backend asked for, relayed through callTool), closed
    // (the seconds the page counted, to the ledger). All 404 on a wrong key
    // or in a house without OPENAI_API_KEY. The checks, in the one order that
    // works (mcp/voice.js): origin → media type → capability shape →
    // capability live → allowlist and bounded parse → speaker → callTool.
    const talk = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/talk(?:\/(session|tool|beat|closed))?$/);
    if (talk) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(talk[1], key) || !talkOn(env)) return notFound();
      const base = `/buttons/${key}`;
      const door = talk[2] ?? null;
      const say = (status, body, extra = {}) => new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
          "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", ...extra } });
      const budget = { remaining: 40 };
      const envB = withBudget(env, budget);
      const devices = parseRoomDevices(env);
      // The one speaker (MC-28), without a Spotify read: the bar corrects it
      // after its first answer if the music is somewhere the memo missed.
      const defaultDevice = (await pickCheap(env, request))?.name ?? fallbackDevice(env);

      if (!door) {
        if (request.method !== "GET") return roomRefuse(405, "The Talk page only answers GET.");
        let used = 0, usedSec = 0;
        try {
          const d = await station(envB, "voice-day", { day: houseDay(env), cap_minutes: CAP_MINUTES });
          used = d.used ?? 0; usedSec = d.used_sec ?? 0;
        } catch { used = 0; usedSec = 0; }
        return roomPage(renderTalk({
          base, devices, defaultDevice, used, usedSec, cap: CAP_MINUTES, idleMs: IDLE_CLOSE_MS, beatMs: BEAT_MS,
          rateCents: VOICE_CENTS_PER_MINUTE, ...(await tabState(env)), hmark: await helperView(env),
        }));
      }
      if (request.method !== "POST") return say(405, { error: "This door only answers POST." });
      const why = originCheck(request, url) ??
        contentTypeCheck(request, door === "session" ? "application/sdp" : "application/json");
      if (why) return say(403, { error: why });

      if (door === "session") {
        // The house's day first: a misconfigured zone is refused in words
        // before a cent is reserved.
        let day;
        try { day = houseDay(env); } catch (err) {
          console.log(`talk:session ${String(err?.message).slice(0, 200)}`);
          return say(500, { error: "HOUSE_TZ is not a timezone: set it to one (such as America/Los_Angeles) and deploy." });
        }
        const sdp = await readBounded(request, 64 * 1024);
        if (sdp === null) return say(413, { error: "The offer is too large." });
        if (!/^v=0\r?\n/.test(sdp)) return say(400, { error: "The body must be an SDP offer." });
        const cap = mintCap();
        let reserved;
        try {
          reserved = await station(envB, "voice-reserve", { cap, day, cap_minutes: CAP_MINUTES });
        } catch { return say(503, { error: "The ledger did not answer. Try again in a moment." }); }
        if (!reserved.ok) {
          if (reserved.code === "cap") {
            return say(429, { error: `The house has talked its ${reserved.cap_minutes} minutes today. Tomorrow is a new day.`,
              used: reserved.used, cap_minutes: reserved.cap_minutes });
          }
          return say(500, { error: `The ledger refused the session (${reserved.code}).` });
        }
        // Give the reservation back — only on an UNAMBIGUOUS refusal (Codex,
        // MC15BCD-9Q4): a 4xx with a body means nothing was opened. A lost
        // connection or a 5xx may have opened a session whose id never
        // reached us; that reservation stands (it is the charge anyway),
        // and the session, never bound to a peer, ends at OpenAI on its own.
        const release = async () => {
          try { await station(envB, "voice-void", { cap }); } catch { /* the sweep settles it */ }
        };
        const body = {
          session: {
            model: VOICE_MODEL, instructions: voicePrompt({ archive: talkArchive(env) }),
            delegation: { type: "responses", responses: {
              model: backendModel(env), instructions: backendPrompt({ devices, defaultDevice,
                replay: env.PROGRAM_REPLAY_PLAYLIST || "replay",
                // The live guests (MC-18 stage 3): none while every guest is
                // dark, and then the prompt is exactly what it was.
                guests: liveGuests(env),
                // The endless DJ presets, for the steering rule (MC-23).
                endless: await talkEndless(env),
                // The archive preset, for its rule (2026-10-10).
                archive: talkArchive(env) }),
              tools: [...voiceFunctions(env), { type: "web_search" }], tool_choice: "auto",
              // Independent lookups may run together (the docs, 2026-09-12).
              parallel_tool_calls: true } },
          },
          transport: { type: "webrtc", sdp },
        };
        let res, text;
        try {
          res = await subrequest(envB, "https://api.openai.com/v1/live/sessions", {
            method: "POST",
            headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          text = await res.text();
        } catch { return say(502, { error: "OpenAI could not be reached. Try again in a moment." }); }
        let out = null;
        try { out = JSON.parse(text); } catch { out = null; }
        if (res.status >= 400 && res.status < 500) {
          await release();
          const msg = out?.error?.message ? String(out.error.message).slice(0, 300) : `status ${res.status}`;
          return say(502, { error: `OpenAI refused the session: ${msg}` });
        }
        if (!res.ok || typeof out?.transport?.sdp !== "string") {
          return say(502, { error: `OpenAI did not open the session (status ${res.status}). Try again in a moment.` });
        }
        // OpenAI's id onto the row, so the ledger's alarm can close the
        // session itself at the window's end. NO ID, OR NO BIND, NO SESSION
        // (Codex, MC15FIX-3T8): a session the ledger cannot govern is not
        // handed to the page. The answer is withheld, so the session never
        // gets its peer and ends at OpenAI on its own (their close reasons
        // include connection_lost — an inference from the documented
        // lifecycle, not a tested one); the ten stay charged.
        const sid = String(out.session?.id ?? "").trim().slice(0, 120);
        if (!sid) return say(502, { error: "OpenAI opened a session without an id; it was not used. Try again in a moment." });
        let bound = null;
        try { bound = await station(envB, "voice-bind", { cap, session_id: sid }); } catch { bound = null; }
        if (!bound?.ok) return say(503, { error: "The ledger could not take the session. Try again in a moment." });
        // For `wrangler tail` during the room test: what opened, never what was said.
        console.log(`talk:session opened cap=${cap.slice(0, 8)} used=${reserved.used}/${reserved.cap_minutes} backend=${backendModel(env)}`);
        return say(201, { id: sid, sdp: out.transport.sdp, cap,
          used: reserved.used, used_sec: reserved.used_sec ?? null, cap_minutes: reserved.cap_minutes, remaining: reserved.remaining });
      }

      // The closed door also takes the capability in its body: a page on its
      // way out sends a beacon, and a beacon carries no headers (Codex,
      // MC16-8N2A). Read under the same ceiling either way.
      let raw = null;
      let cap = capFrom(request);
      if (!cap && door === "closed") {
        raw = await readBounded(request, 64 * 1024);
        if (raw === null) return say(413, { error: "The call is too large." });
        try { const b = JSON.parse(raw); cap = typeof b?.cap === "string" && CAP_RE.test(b.cap.toLowerCase()) ? b.cap.toLowerCase() : null; }
        catch { cap = null; }
      }
      if (!cap) return say(401, { error: "This call carries no session." });
      if (door === "tool") {
        // Live before the body is read: a dead capability buys no parse.
        let check;
        try { check = await station(envB, "voice-check", { cap }); }
        catch { return say(503, { error: "The ledger did not answer." }); }
        if (!check.live) return say(401, { error: "This session is over. Start a new one." });
      }
      if (raw === null) raw = await readBounded(request, 64 * 1024);
      if (raw === null) return say(413, { error: "The call is too large." });
      let body;
      try { body = JSON.parse(raw); }
      catch { return say(400, { error: "The call must be JSON." }); }

      if (door === "beat") {
        // "Still here": the charge runs on, and the page learns the day's count.
        let beat;
        try { beat = await station(envB, "voice-beat", { cap, cap_minutes: CAP_MINUTES }); }
        catch { return say(503, { error: "The ledger did not answer." }); }
        if (!beat.ok) {
          const over = beat.code === "over" || beat.code === "cap";
          return say(over ? 401 : 404, { error: beat.code === "cap" ? "The house has used its minutes for today." : "This session is over.",
            ...(beat.used != null ? { used: beat.used, cap_minutes: beat.cap_minutes, remaining: beat.remaining } : {}) });
        }
        return say(200, { ok: true, used: beat.used, used_sec: beat.used_sec ?? null, cap_minutes: beat.cap_minutes, remaining: beat.remaining });
      }
      if (door === "closed") {
        // "Done": the ledger hangs up at OpenAI itself and stops the clock;
        // whatever the page counted is not asked for (MC-16).
        let settled;
        try { settled = await station(envB, "voice-settle", { cap }); }
        catch { return say(503, { error: "The ledger did not answer." }); }
        if (!settled.ok) return say(404, { error: "No such session." });
        let day = null;
        try { day = await station(envB, "voice-day", { day: houseDay(env), cap_minutes: CAP_MINUTES }); } catch { day = null; }
        console.log(`talk:closed cap=${cap.slice(0, 8)} seconds=${settled.seconds ?? "?"} by=${settled.closed_by}${settled.note ? ` (${settled.note})` : ""}`);
        return say(200, { ok: true, minutes: settled.minutes, seconds: settled.seconds, closed_by: settled.closed_by,
          used: day?.used ?? null, used_sec: day?.used_sec ?? null, cap_minutes: CAP_MINUTES, remaining: day?.remaining ?? null });
      }

      // door === "tool"
      let parsed;
      try { parsed = parseToolCall(body, VOICE_TOOLS); }
      catch (err) { return say(400, { error: talkErrorWords(err) }); }
      const refusal = speakerRule(parsed.name, parsed.args, devices);
      if (refusal) {
        console.log(`talk:tool cap=${cap.slice(0, 8)} ${parsed.name} refused: ${refusal}`);
        return say(422, { error: refusal });
      }
      const canon = canonicalDevice(parsed.args, devices);
      // A listener request's id never comes in on the archive (2026-10-10):
      // the voice settles no request.
      const voiceArgs = { ...(parsed.args ?? {}) };
      if (parsed.name === "play_archive") delete voiceArgs.request_id;
      const argsIn = canon ? { ...voiceArgs, device: canon } : voiceArgs;
      let call;
      try { call = voiceWriterCall(parsed.name, argsIn); }
      catch (err) { return say(200, { error: talkErrorWords(err) }); }
      try {
        // Marked as Talk on its own copy of env (MC-18), as the voice role is
        // at /mcp: a guest's record says "talk" whatever the arguments claim.
        const out = await callTool({ ...env, __via: "talk" }, call.name, call.args, budget);
        console.log(`talk:tool cap=${cap.slice(0, 8)} ${call.name} ok (${JSON.stringify(call.args).slice(0, 160)})`);
        // A START BY VOICE IS A CHOICE (the owner, 2026-10-10: Deep Dive's page
        // opened on the Ultra, chosen earlier, while Talk had started him on
        // the Master Bedroom). A speaker Talk starts music on is stamped as a
        // tap or a Play is, so every page follows it for the half hour.
        return say(200, { output: JSON.stringify(out) }, canon && talkStarted(call.name, call.args, out)
          ? { "set-cookie": pickCookie(canon) } : {});
      } catch (err) {
        // The tool's own refusal is an answer the desk can say aloud.
        console.log(`talk:tool cap=${cap.slice(0, 8)} ${call.name} error: ${String(err?.message ?? err).slice(0, 200)}`);
        return say(200, { error: talkErrorWords(err) });
      }
    }
    // WHAT IS PLAYING, FOR A PAGE THAT WENT OUT WITHOUT IT (2026-09-12). The
    // presets page draws first when Spotify is slow and asks here after; the
    // answer is what the page would have drawn: which band, what track,
    // which speaker. Keyed, GET, no-store; before the DJ catch-all, so
    // "playing" is never read as a DJ.
    const nowRoute = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/playing$/);
    if (nowRoute) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(nowRoute[1], key)) return notFound();
      const say = (status, body) => new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
          "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow" } });
      if (request.method !== "GET") return say(405, { error: "This answers GET only." });
      // Who is on the guests, as one time (2026-09-13): a page left open
      // reloads when this is newer than what it drew. So does the newest
      // reading of the speakers, which is how Read again comes back to a page
      // that shows it. KV only, never Spotify.
      const [holders, recs] = await Promise.all([guestHolders(env), readReadings(env, parseSpeakers(env))]);
      const newest = newestOn(Object.values(holders).filter((h) => !h.failed).map((h) => h.on));
      const readAt = newestOn(Object.values(recs).filter(Boolean));
      // And the asks under the guests' bands, only for a page showing one in
      // flight (?asks=1): a ledger read a poll is worth it only then.
      const askSig = url.searchParams.get("asks") === "1" ? (await guestAsks(env, holders)).sig : null;
      const extra = { ...(newest ? { guestsAt: newest } : {}), ...(readAt ? { readAt } : {}),
        ...(askSig !== null ? { asks: askSig } : {}) };
      const throttle = await throttledUntil(env);
      // THE HOUSE'S KEPT ANSWER FIRST (MC-29): one ledger call brings the
      // helper's reading and the kept Spotify answer, and a read happens only
      // when the helper says something changed or a cap ran out. ?fresh=1 is
      // the now bar's re-check after its own pause, and always reads.
      const got = await helperGot(env);
      const p = throttle ? null : await housePlayer(withBudget(env, { remaining: 4 }),
        { fresh: url.searchParams.get("fresh") === "1", deadlineMs: PLAYER_DEADLINE_MS, got })
        .then(roomPlaying).catch(() => ({ unknown: true }));
      return say(200, { ...extra, ...(await nowAnswer(env, request, p, { recs, holders, throttle, hv: helperViewOf(env, got),
        note: throttle ? null : await pauseNoteBeside(env, p) })) });
    }

    // WHICH DJ? (the owner, 2026-10-01: "replace every dj on one map with
    // this"), behind the DJs tab's "?" where the 2026-09-30 map was, at the
    // map's address. Every DJ's card grouped by the rule they pick by: WHICH
    // for the words, GLANCE for years, hits and set, DJ_ASKS for the ask, and
    // the config for where a set goes — no service read, as cheap as the tab.
    const djMap = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/djs\/map$/);
    if (djMap) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(djMap[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "This page only answers GET.");
      // In the page's own order (WHICH's), not the roster's.
      const order = Object.keys(WHICH);
      const roster = house(env).roster.filter((d) => GLANCE[d.key] && WHICH[d.key])
        .sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));
      const ecfg = parseEndless(env);
      const live = ecfg?.mode === "live" ? ecfg.presets : [];
      return roomPage(renderWhichDj({ base: `/buttons/${key}`, now: GLANCE_NOW, scripts: WHICH_SCRIPTS,
        djs: roster.map((d) => ({ key: d.key, name: d.name, ...WHICH[d.key], ...GLANCE[d.key],
          ask: DJ_ASKS[d.key]?.asks?.[0] ?? null, writes: !!VOICE_WRITERS[d.key] })),
        needs: WHICH_NEEDS,
        presets: {
          requests: roomRoster(env).filter((t) => t.guest && t.live).map((t) => ({ btn: t.btn, catalog: t.catalog })),
          lane: live.find((p) => p.lane)?.button ?? null,
          house: live.filter((p) => !p.lane).map((p) => p.button).sort((x, y) => x - y),
          never: roster.filter((d) => d.endless === false).map((d) => d.name),
        },
        ...(await tabState(env)) }));
    }

    // THE DJs TAB (MC-14, 2026-09-11). Declared before the DJ page's
    // catch-all below, so "djs" is this page and never a DJ of that name.
    // Names and states only — no service is read — so it is the cheapest
    // page in the house.
    const deck = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/djs$/);
    if (deck) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(deck[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "The DJs page only answers GET.");
      const show = url.searchParams.get("show");
      // Whose set is on each live guest, by DJ (the owner, 2026-09-13): a KV
      // read a guest, none while every guest is dark. A failed read names
      // nobody, so the row falls back to Crate or Ask, never a wrong number.
      const onGuests = {};
      for (const hold of Object.values(await guestHolders(env))) {
        if (hold.failed || !hold.on?.dj) continue;
        (onGuests[hold.on.dj] ??= []).push({ btn: hold.guest.btn, name: hold.guest.name ?? null, catalog: hold.guest.catalog });
      }
      // And what the speakers hold on 3 to 12, as the phone last read them:
      // a DJ's older set there shows its number too (2026-09-14). A KV read
      // a speaker.
      const boxes = parseSpeakers(env);
      const recs = await readReadings(env, boxes);
      // The ▶ on an asked set (2026-10-09): the picked speaker, and the Tidal
      // guest's key while the helper can press it.
      const dl = await deckLane(env, request);
      const tidalHeld = Object.values(onGuests).flat().find((g) => g.catalog === "tidal");
      return roomPage(renderDeck({
        base: `/buttons/${key}`, tiles: roomRoster(env), onGuests, endlessOn: await endlessOnDeck(env),
        ...dl, device: dl.device ?? (await pickCheap(env, request))?.name ?? speakerFor(request, env) ?? null,
        guestKey: tidalHeld ? await helperKeyFor(env, request, tidalHeld.btn) : null,
        speakers: boxes.map(({ name, slug }) => ({ name, slug })), readings: recs,
        show: show === "wall" || show === "bench" ? show : null,
        ...(await tabState(env)), hmark: await helperView(env),
      }));
    }
    // THE MANIFEST (MC-14): what Add to Home Screen reads. It opens on the
    // Speakers tab since 2026-09-27 (the owner). Keyed like the
    // pages, because its start_url names the key; the icons it points at are
    // public. scope is the whole site so the Shelf, on its other prefix,
    // stays inside the app rather than bouncing out to the browser.
    const manifest = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/manifest\.webmanifest$/);
    if (manifest) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(manifest[1], key)) return notFound();
      return new Response(JSON.stringify({
        name: "fmwax", short_name: "fmwax",
        description: "The house's presets, DJs, shelf and speakers.",
        start_url: `/buttons/${key}/wiim`, scope: "/", display: "standalone",
        background_color: "#EDEDE9", theme_color: "#2C3E5C",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      }), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow" } });
    }
    // THE PROGRAMME PAGE, INSIDE THE APP (MC-14, the owner: "no way back from
    // the program notes"). The same record and the same renderer as the
    // public page, with the bar and a way back: to the DJ named by ?from=,
    // or to the Shelf. Keyed and no-store like every room page; the public
    // page is untouched and still links nowhere.
    const keyedProg = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/programs\/([a-z0-9-]{1,64})$/);
    if (keyedProg) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(keyedProg[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "A program page only answers GET.");
      const rec = await env.PROGRAMS?.get(`program:${keyedProg[2]}`, { type: "json" });
      if (!rec) {
        return roomRefuse(404,
          "No program here. If it was just published, wait a minute and refresh — " +
          "it takes that long to reach every location.");
      }
      let onAir = false;
      try {
        onAir = !!rec.playlistId &&
          (await env.PROGRAMS.get(`current:${rec.playlistId}`)) === rec.slug;
      } catch { /* unknown reads as off */ }
      const base = `/buttons/${key}`;
      const from = url.searchParams.get("from");
      const h = house(env);
      const fromDj = from === "archive" ? { key: "archive", name: ROOM_ARCHIVE_TILE.name }
        : from && h.djs[from] ? h.djs[from] : null;
      // The Shelf's filter it was opened from (2026-09-24), display only and
      // checked like the forms check it, so every way back returns there.
      const filter = shelfFilter(url.searchParams.get("dj"), url.searchParams.get("svc"), url.searchParams.get("q"));
      // Its controls (2026-09-23): what the Shelf's card gave up. The Shelf's
      // own facts for this one row — where it would load, whether it is on
      // air — and the Shelf's forms, which land back on the Shelf.
      let actions = null;
      try {
        const st = await shelfState(env);
        const found = st.rows.find((r) => r.id === rec.slug) ?? null;
        // The listing carries no playlist id (the Shelf stopped reading every
        // record with the grid); this page has the record, so the "recorded
        // on another service" check gets it here.
        const row = found && rec.playlistId
          ? { ...found, playlistId: String(rec.playlistId), elsewhere: shelfElsewhere(env, { ...found, playlistId: String(rec.playlistId) }) }
          : found;
        if (row) {
          const rooms = parseRoomDevices(env);
          actions = {
            row, live: st.onAir.has(row.id), open: st.open, archiveBtn: house(env).archive?.btn ?? null,
            action: `/notes/${key}/activate`, remove: { action: `/notes/${key}/unkeep` }, filter,
            play: catalogAvailable(env, "spotify") ? { action: `/notes/${key}/play`, devices: rooms,
              device: (await pickCheap(env, request))?.name ?? speakerFor(request, env),
              ...(await shelfTidalKey(env, request)) } : null,
          };
        }
      } catch { /* the page reads without its controls */ }
      return roomPage(renderProgram(rec, { onAir, actions, shell: {
        base, ...(await tabState(env)), active: fromDj ? "djs" : "shelf",
        back: fromDj ? { href: `${base}/${fromDj.key}`, label: fromDj.name }
          : { href: `/notes/${key}${shelfFilterQs(filter, "?")}`, label: "Shelf" },
      } }));
    }
    const roomDj = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/([a-z0-9-]{1,40})$/);
    if (roomDj) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(roomDj[1], key)) return notFound();
      if (request.method !== "GET") return roomRefuse(405, "A DJ's page only answers GET.");
      const base = `/buttons/${key}`;
      const slugKey = roomDj[2];
      const budget = { remaining: 40 };
      const envB = withBudget(env, budget);

      if (slugKey === "archive") {
        // No archive button in this house means no card for it either, and a
        // page that says "button 6 plays this" about a preset that does not
        // must not be reachable by typing the address.
        const slot = house(env).archive;
        if (!slot) return roomRefuse(404, "This house has no archive preset.");
        let takes = [];
        // The card explains that the slot points at a file this server serves
        // and that its last three entries play on a loop. When the key is gone
        // that sentence is false and /archive/<id>.m3u answers 404 — so the
        // missing case has to be its own, or the page describes a mechanism
        // that is not running.
        let archiveProblem = null;
        let station = null;
        const akey = env.ARCHIVE_M3U_KEY || ARCHIVE.key;
        try {
          // A ROTATING SET is what the button holds if one is parked: the whole
          // set, not the three the speaker happens to have. The page says which
          // three are up, because that is the thing a person standing in the
          // room cannot tell from the list.
          station = await readStation(env, akey);
          if (station) {
            const { byRef } = await loadArchive(env, null);
            const win = stationWindow(station, Date.now());
            const upNow = new Set(win.refs);
            takes = station.refs.map((r, i) => {
              const t = byRef.get(r);
              return {
                n: i + 1,
                title: t ? `${t.artist} - ${t.song} (${t.venue}, ${t.date})` : r,
                artists: "",
                dur: t?.seconds ? archiveClock(t.seconds) : "",
                now: upNow.has(r),
              };
            });
            if (!takes.length) archiveProblem = { kind: "empty" };
          }
        } catch { station = null; }
        // THE SHELF (2026-09-07): every set parked here has a page now, and
        // the archive's DJ lists them like any other. "Live" is the archive
        // pointer — the page that names what preset 6 holds this minute.
        let archiveShelf = null;
        let archiveFlash = null;
        try {
          const currentSlug = await programsKV(env).get(`current:archive:${akey}`);
          const summaries = await listProgramSummaries(env).catch(() => []);
          archiveShelf = await shelfFor(env, house(env).djs[ARCHIVE_DJ], summaries, currentSlug, { base, from: "archive" });
          const put = url.searchParams.get("put");
          // flashFor returns the sentence; the DJ page wants it as lines, the
          // same wrapping the DJ route does.
          const line = put ? flashFor(put, summaries, new Set(currentSlug ? [currentSlug] : [])) : null;
          if (line) archiveFlash = { lines: [line] };
        } catch { /* the page stands without its shelf */ }
        try {
          if (station) { /* the set is what the button holds */ }
          else {
          const raw = await tokensKV(env).get(`m3u:${akey}`);
          if (raw == null) archiveProblem = { kind: "missing" };
          else {
            takes = parseM3uEntries(raw)
              .map((t, i) => ({ n: i + 1, title: t.title, artists: "",
                dur: t.secs ? archiveClock(t.secs) : "" }));
            if (!takes.length) archiveProblem = { kind: "empty" };
          }
          }
        } catch { archiveProblem = { kind: "unreachable" }; }
        return roomPage(renderDjRoom({
          base, notesHref: `/notes/${key}`, ...(await tabState(env)),
          remove: { action: `/notes/${key}/unkeep` },
          dj: { key: "archive", name: ROOM_ARCHIVE_TILE.name, btn: slot.btn,
            unit: "takes", summary: ROOM_ARCHIVE_TILE.summary },
          tile: { name: ROOM_ARCHIVE_TILE.name, count: takes.length || null,
            runtime: null, cover: null },
          tracks: takes, premise: null, shelf: archiveShelf, devices: [],
          defaultDevice: "", archive: true, lastLoaded: null,
          flash: helperKeyWords(helperKeyFlash(env, url)) ? { lines: [...(archiveFlash?.lines ?? []), helperKeyWords(helperKeyFlash(env, url))] } : archiveFlash,
          hkey: await helperKeyFor(env, request, slot.btn),
          activate: { action: `/notes/${key}/activate` },
          // The archive's own DJ writes these now, and they name the shapes
          // that exist here — a night, a song across the years, a room.
          asks: DJ_ASKS[ARCHIVE_DJ] ?? DJ_ASKS.archive, problem: archiveProblem,
          // AND IT TAKES REQUESTS. The composer is drawn here on the same
          // switch as everywhere else; what makes it possible is that a set of
          // any length now plays, so an ask has somewhere to land.
          composer: env.REQUESTS_ENABLED === "true" && env.STATION
            ? { action: `${base}/archive/request` } : null,
          auto: env.AUTOFULFILL_ENABLED === "true",
          station: station
            ? { title: station.title, takes: station.refs.length, loop: station.loop !== false }
            : null,
        }));
      }

      // "guest" is reserved (MC-18): the guest presets are not a DJ and have
      // no page of their own yet; the presets page is where they are.
      if (slugKey === "guest") {
        return roomRefuse(404,
          "The guest presets are not a DJ. They are on the presets page, one band each.");
      }
      const dj = house(env).djs[slugKey];
      // A MERGED DJ'S OLD KEY (2026-10-13): /sunny is Vibe's page, at Vibe's
      // own address, so every comparison below with the ledger's key holds.
      if (dj && dj.key !== slugKey) {
        return new Response(null, { status: 301, headers: { location: `${base}/${dj.key}${url.search}`, "cache-control": "no-store" } });
      }
      if (!dj) {
        // A RENAMED DJ'S OLD ADDRESS (Codex's review, 2026-10-09): /dj-stax is
        // one of Stax's aliases, so it opens Stax's page rather than a 404
        // (Soul's since the merges, 2026-10-13).
        const was = Object.values(house(env).djs).find((d) => (d.aliases ?? []).some((a) => a.toLowerCase() === slugKey));
        if (was && request.method === "GET") {
          return new Response(null, { status: 301, headers: { location: `${base}/${was.key}${url.search}`, "cache-control": "no-store" } });
        }
        return roomRefuse(404,
          `No DJ named "${slugKey.slice(0, 60)}" here. The DJs tab has every one of them.`);
      }
      // One page per DJ. The archive's DJ has the archive's page; the persona
      // rendered as a plain DJ page would show no preset and no shelf.
      if (dj.archiveOnly) {
        return new Response(null, {
          status: 302, headers: { location: `${base}/archive`, "cache-control": "no-store" } });
      }
      // WHERE THIS DJ'S SETS ARE (MC-18 stage 4). Null for a DJ on a preset
      // and while every guest is dark, and then the page is what it was: the
      // preset, or the crate. Otherwise per service, Spotify first: the live
      // guest while its record names this DJ, else their crate there.
      const holders = dj.button ? {} : await guestHolders(env);
      const places = djPlaces(dj, holders);
      const place = places ? (places[0] ?? null) : null;
      const viewCat = places ? (place?.catalog ?? null) : dj.catalog;
      // Their preset's playlist, or their own crate (MC-11) — `dj.alias` is
      // whichever they have, so this page shows a benched DJ what is in their
      // crate instead of the empty page it used to render.
      const pid = places ? (place?.pid ?? null) : configuredPlaylistId(env, dj.alias);
      // NULL, not 0. The sentinel made a benched DJ an integer, so every
      // `Number.isInteger(dj.btn)` branch downstream drew a preset they do not
      // have: a ghost "0" behind the name, a pill linking at /wall/0, and — on
      // a Tidal crate — "press 0 on the remote" (Codex, 2026-09-09).
      const btn = dj.btn ?? null;

      // Contents and cover, read fresh — this page IS the close look — and the
      // tile cache refreshed from the same read so the grid agrees with it.
      let tracks = [];
      let liveUris = null;
      let tile = null;
      // Why the list might be empty, so the page can say. An empty playlist,
      // a deleted one and a Spotify outage used to render identically — a
      // header, a Play form and no tracks — and only one of those is empty.
      let problem = null;
      // The note gates the player read for every DJ (the player is Spotify's)
      // and the tracklist read only for a DJ on a Spotify preset.
      const spotifyNote = await throttledUntil(env);
      let throttle = (viewCat ?? "spotify") === "spotify" ? spotifyNote : null;
      const djPlayingP = spotifyNote
        ? Promise.resolve({ unknown: true, throttledUntil: spotifyNote })
        : housePlayer(envB, { deadlineMs: PLAYER_DEADLINE_MS })
          .then(roomPlaying).catch(() => ({ unknown: true }));
      const djSummariesP = listProgramSummaries(env).catch(() => []);
      // Started here, awaited far below. Both are independent round trips that
      // used to run one after another only because that is the order the page
      // needs them in, and neither has to agree with the playlist read: the
      // device memory is a UI convenience, and a ledger row that arrives a
      // moment early reads as pending — a card that says so and refreshes
      // itself. What is NOT hoisted is deliberate and explained below.
      const ledgerP = env.STATION
        ? station(envB, "list", { dj: slugKey }).catch(() => null)
        : Promise.resolve(null);
      // (The wait in words is put on the problem after the read, below.)
      // The tracklist read is cached for a minute and a half (`items:`),
      // because this page refreshes itself while a request is in flight and
      // was reading the playlist from Spotify on every refresh — three calls
      // a time, all evening, against a development-mode quota that ran out
      // (2026-09-06). Every write through this server deletes the entry with
      // the tile's, so the cache can only be stale about edits made in the
      // Spotify app, and only for ninety seconds.
      let handEdited = null;
      let cachedItems = null;
      if (pid) {
        try { cachedItems = await programsKV(env).get(`items:${pid}`, { type: "json" }); } catch { /* cache */ }
        if (cachedItems && Date.now() - (cachedItems.at ?? 0) >= ITEMS_TTL_MS) cachedItems = null;
      }
      if (pid && throttle) {
        // Throttled: the cached tracklist if there is one, and the problem
        // line either way — Play is refused while the note stands. Nothing
        // is read from Spotify.
        if (cachedItems) {
          tracks = cachedItems.tracks.map((t) => ({ ...t, now: false }));
          liveUris = cachedItems.liveUris; tile = cachedItems.tile;
        }
        problem = { kind: "throttled" };
      } else if (pid && cachedItems) {
        tracks = cachedItems.tracks.map((t) => ({ ...t, now: false }));
        liveUris = cachedItems.liveUris; tile = cachedItems.tile;
        if (!tracks.length) problem = { kind: "empty" };
      } else if (pid) {
        try {
          const cat = catalogFor(envB, viewCat);
          const [meta, read] = await Promise.all([
            cat.playlist(pid),
            playlistItems(cat, pid, budget, 200),
          ]);
          tracks = read.items.map((t, i) => ({
            n: i + 1,
            title: t?.name ?? "(unreadable)",
            artists: (t?.artists ?? []).map((a) => a.name).join(", "),
            dur: t?.duration_ms ? clock(t.duration_ms) : "",
            uri: t?.uri ?? null, now: false,
          }));
          // The verification identities, NOT the display list: a relinked
          // track's original lives in linked_from (the same equivalence
          // verifySequence honors), and an unreadable item stays null so
          // the card can refuse to guess instead of hashing a hole.
          liveUris = read.items.map((t) => t?.linked_from?.uri ?? t?.uri ?? null);
          tile = { name: meta.name ?? dj.name, count: read.total,
            runtime: totalDuration(read.items.filter(Boolean)),
            cover: pickImage(meta.images) ?? null, at: Date.now() };
          await writeTiles(env, { [pid]: tile });
          try {
            await programsKV(env).put(`items:${pid}`,
              JSON.stringify({ tracks, liveUris, tile, at: Date.now() }), { expirationTtl: 120 });
          } catch { /* cache */ }
          if (!tracks.length) problem = { kind: "empty" };
          // Edited in the service's own app since this server wrote it. The
          // whole list is in hand here, so this is the exact comparison rather
          // than the tile's count — and it drops the programme pointer, which
          // is what stops a public page claiming a set that is no longer on
          // the playlist.
          handEdited = await driftOf(env, pid, {
            uris: liveUris.filter(Boolean),
          });
        } catch (err) {
          // The 429 that started the note is the first "throttled", not an
          // outage: the next view finds the note before it reads.
          problem = { kind: err?.status === 404 ? "missing" : err?.status === 429 ? "throttled" : "unreachable" };
          if (err?.status === 429) throttle = await throttledUntil(env);
        }
      } else {
        // On no guest now (MC-18 stage 4) is its own story: their sets go to
        // the guests, and another set holds each.
        problem = { kind: places ? "offguest" : "unconfigured" };
      }
      if (problem?.kind === "throttled" && throttle) problem.wait = waitWords(minutesLeft(throttle));

      // A DJ ON BOTH REQUESTS PRESETS (MC-18) shows the second under the
      // first, with the link that opens it where it can be played. Read
      // through the same cache as the first, best-effort: a page without its
      // second list is still the page. Spotify's is never read while the
      // note stands.
      let second = null;
      const secondPlace = places ? (places[1] ?? null) : null;
      if (secondPlace) {
        const other = secondPlace.catalog;
        const pid2 = secondPlace.pid;
        if (pid2 && !(other === "spotify" && throttle)) {
          try {
            let got = null;
            try { got = await programsKV(env).get(`items:${pid2}`, { type: "json" }); } catch { /* cache */ }
            if (got && Date.now() - (got.at ?? 0) >= ITEMS_TTL_MS) got = null;
            let list2, count2;
            if (got) { list2 = got.tracks; count2 = got.tile?.count ?? got.tracks.length; }
            else {
              const cat2 = catalogFor(envB, other);
              const read2 = await playlistItems(cat2, pid2, budget, 200);
              list2 = read2.items.map((t, i) => ({
                n: i + 1, title: t?.name ?? "(unreadable)",
                artists: (t?.artists ?? []).map((a) => a.name).join(", "),
                dur: t?.duration_ms ? clock(t.duration_ms) : "", uri: t?.uri ?? null, now: false,
              }));
              count2 = read2.total;
              try {
                await programsKV(env).put(`items:${pid2}`, JSON.stringify({
                  tracks: list2, liveUris: read2.items.map((t) => t?.uri ?? null),
                  tile: { count: read2.total }, at: Date.now() }), { expirationTtl: 120 });
              } catch { /* cache */ }
            }
            second = { catalog: other, service: catalogFor(env, other).label,
              guest: secondPlace?.kind === "guest"
                ? { btn: secondPlace.guest.btn, name: secondPlace.guest.name ?? null,
                    since: sinceWords(houseClockWords(env, secondPlace.on?.at)) } : null,
              tracks: list2, count: count2, pid: pid2,
              liveUris: got ? (got.liveUris ?? []) : list2.map((t) => t.uri),
              href: serviceLink("playlist", pid2)?.href ?? null };
          } catch { /* the page stands without it; a request on it reads as unverified */ }
        }
        // WHAT IT HOLDS, IN WORDS (the owner, 2026-09-11): a block reading
        // "17 tracks on Tidal" over a request row reading "ready" was two
        // halves of one story on one screen. The same two pointers the
        // primary block reads — the ask that produced the set, and the
        // programme loaded there — so the block can name its set, and the
        // request row can retire against it the way it retires against the
        // primary. Best-effort: without them the block still lists.
        if (second) {
          try {
            const kv2 = programsKV(env);
            const [ask2, cur2] = await Promise.all([
              kv2.get(`ask:${second.pid}`, { type: "json" }).catch(() => null),
              kv2.get(`current:${second.pid}`).catch(() => null),
            ]);
            if (ask2?.text) {
              second.ask = { text: String(ask2.text), requestId: ask2.requestId ?? null,
                at: askDay(env, ask2.at) };
            }
            if (cur2) {
              const rec2 = await kv2.get(`program:${cur2}`, { type: "json" }).catch(() => null);
              second.loaded = { slug: cur2, title: rec2?.title ?? cur2,
                href: `${base}/programs/${cur2}?from=${encodeURIComponent(slugKey)}` };
              // The pointer is best-effort; the kept record keeps its own
              // copy of the words, as on the primary.
              if (!second.ask && rec2?.requestId && rec2?.ask?.text) {
                second.ask = { text: String(rec2.ask.text), requestId: rec2.requestId,
                  at: askDay(env, rec2.ask.at) };
              }
            }
          } catch { /* the block still lists; it just cannot name its set */ }
        }
      }

      // Premise: the programme on the button when there is one, the recorded
      // ask when there is not, nothing otherwise — never an invented reason.
      let premise = null;
      let lastLoaded = null;
      let currentSlug = null;
      // The ask pointer is read once for the whole page: the premise shows
      // it, and the request card's "superseded" is DERIVED from it — a ready
      // record whose playlist now answers to a different ask is not this
      // request any more, however intact its row looks.
      let askRec = null;
      let askReadFailed = false;
      // These two stay BEHIND the playlist read, and only run beside each
      // other. Both describe what the button holds, and the ready state is
      // derived by comparing them against that read — so a pointer captured
      // BEFORE a write that the tracklist then sees after it would have the
      // page call somebody else's set "changed since" (your set drifted)
      // instead of "superseded" (something else took the button). One round
      // trip saved is not worth a page that says the wrong one of those.
      const askP = pid
        ? programsKV(env).get(`ask:${pid}`, { type: "json" })
            .then((rec) => ({ rec })).catch(() => ({ failed: true }))
        : Promise.resolve({ rec: null });
      const currentP = pid
        ? programsKV(env).get(`current:${pid}`)
            .then((slug) => ({ slug })).catch(() => ({ failed: true }))
        : Promise.resolve({ slug: null });
      const askOut = await askP;
      askRec = askOut.rec ?? null;
      askReadFailed = !!askOut.failed;
      try {
        const kv = programsKV(env);
        const cur = await currentP;
        // Rethrown rather than treated as "nothing loaded": an unreadable
        // pointer is an outage, and the branch below reads a null pointer as
        // the fact that no programme is on the button.
        if (cur.failed) throw new Error("pointer unreadable");
        currentSlug = cur.slug ?? null;
        if (currentSlug) {
          const rec = await kv.get(`program:${currentSlug}`, { type: "json" });
          const href = `${base}/programs/${currentSlug}?from=${encodeURIComponent(slugKey)}`;
          // The slug rides along so the card can tell "this request's page IS
          // what the button holds" apart from "a page is loaded" — the merge
          // that folds the request card away must not fire on a lookalike.
          // "Now loaded" is a claim, so it is checked: the live tracklist against
          // the programme's own recorded tracks, in order. Equal, the line says
          // now; anything else — a hand edit in the app, a read with holes or a
          // cap — says "loaded earlier", which is what the pointer knows.
          const recUris = (rec?.sections ?? []).flatMap((sec) =>
            (sec.tracks ?? []).map((t) => t?.uri).filter(Boolean));
          const still = recUris.length > 0 && Array.isArray(liveUris)
            && liveUris.length === recUris.length && liveUris.every((u, i) => u && u === recUris[i])
            && !(tile && tile.count > liveUris.length);
          lastLoaded = { title: rec?.title ?? currentSlug, href, slug: currentSlug, still };
          const gist = standfirst(rec?.thesis);
          // A set KEPT from the ask that is still recorded on this button: the
          // person's typed words win the slot. The record's standfirst is a
          // good line ABOUT the set, and the ask is what was actually asked —
          // preferring the record here would replace somebody's own words with
          // a paraphrase of them at the moment they chose to keep it.
          const keptFromThisAsk = rec?.requestId && askRec?.requestId &&
            rec.requestId === askRec.requestId;
          // `requestId` rides on the premise wherever the premise IS an ask:
          // the page retires a request's card only when what stands in for it
          // demonstrably tells that request's story, and matching ids is the
          // demonstration. A gist carries none — it is about the programme,
          // not the ask — so nothing retires against it.
          if (keptFromThisAsk && askRec?.text) {
            premise = { label: "The ask", text: String(askRec.text),
              tag: askedTag(env, askRec.at),
              readHref: href, requestId: askRec.requestId };
          } else if (!askRec && rec?.requestId && rec?.ask?.text) {
            // The pointer is best-effort and can be lost; the kept record
            // keeps its own copy of the words precisely so a page can still
            // show them. Only when the pointer is ABSENT — a pointer naming a
            // newer request means the button was re-asked, and this old copy
            // must not shout over that.
            premise = { label: "The ask", text: String(rec.ask.text),
              tag: askedTag(env, rec.ask.at),
              readHref: href, requestId: rec.requestId };
          } else if (gist) {
            premise = { label: "Program premise", text: gist,
              tag: "from the program record", readHref: href };
          }
        } else if (askRec?.text) {
          premise = { label: "The ask", text: String(askRec.text),
            tag: askedTag(env, askRec.at),
            readHref: null, requestId: askRec.requestId ?? null };
        }
      } catch { /* absent beats wrong */ }

      const shelf = await shelfFor(env, dj, await djSummariesP, currentSlug, { base, from: slugKey });

      const playing = await djPlayingP;
      // The header's circle is a pause while THIS button plays — read from the
      // player, or from the 303 a press just came back through: Spotify's
      // state can lag the press by a second, and a Play that just succeeded
      // showing a play glyph again would read as a failure.
      const onThisButton = !!(playing && !playing.unknown && pid && playing.pid === pid);
      const playingHere = onThisButton || url.searchParams.get("played") === "ok";
      const nowPlaying = onThisButton && playing.track
        ? `${playing.track}${playing.artists ? ` — ${playing.artists}` : ""}` : null;
      if (onThisButton && playing.uri) {
        // Only when the URI appears ONCE. A playlist may hold the same track
        // twice — replace_playlist allows it, and a programme comparing two
        // takes is the case that invites it — and Spotify's player says which
        // track is playing, never which position. Marking both put
        // aria-current on two rows and told a reader the set was in two places
        // at once; naming neither is the honest reading of what is known.
        const hits = tracks.filter((t) => t.uri === playing.uri);
        if (hits.length === 1) hits[0].now = true;
      }

      // The play outcome, back from the 303. Codes only — the URL is editable,
      // so everything printed is composed here, and the device is echoed only
      // when it is one the form could actually have sent.
      let flash = null;
      // A load that happened from THIS page, come back through the 303. The
      // shelf's own helper decides what to say, and it reads the `current:`
      // pointer rather than the query — the same reasoning as on the shelf: a
      // ?put= left in history must not announce a set that has moved on.
      const putLine = url.searchParams.get("put")
        ? flashFor(url.searchParams.get("put"), await djSummariesP,
          new Set(currentSlug ? [currentSlug] : []))
        : null;
      const undoParam = url.searchParams.get("undo") ?? "";
      // NO UNDO OVER A NEWER SET (the review, 2026-10-09): a load left in
      // history offered Undo after another set had gone on, and it put back
      // the set from before the first, over the second. Offered only while
      // the loaded set is still on; the POST checks again.
      const loadedDj = /^ok:([a-z0-9-]{1,64})$/.exec(url.searchParams.get("put") ?? "")?.[1] ?? null;
      const undoKey = SNAP_KEY.test(undoParam) && (!loadedDj || loadedDj === currentSlug) ? undoParam : null;
      if (putLine) flash = { lines: [putLine] };

      // The room the 303 names, validated against the allowlist. Read once for
      // the whole page, because the flash line and the picker below have to
      // reach the same answer — two independent reads of one query parameter is
      // how a message and a form field start disagreeing about the last press.
      const roomDevices = parseRoomDevices(env);
      const attempted = roomDevices
        .find((d) => d === (url.searchParams.get("on") ?? "")) ?? null;

      const played = url.searchParams.get("played");
      if (played) {
        const lines = [];
        // `ok` says nothing: the circle shows a pause and the line under it
        // scrolls what is on. The outcomes that need words keep them.
        if (played === "stuck") {
          lines.push(`Spotify accepted it, but ${dj.name} is not playing${
            attempted ? ` on ${attempted}` : ""} — the speaker may be asleep or on another ` +
            "input. Press play on the device once, or try again.");
        } else if (played === "sent") {
          lines.push(`Spotify accepted the request to start ${dj.name}${
            attempted ? ` on ${attempted}` : ""}, but the check afterwards failed — it may ` +
            "well be playing. Listen, or reload this page in a moment.");
        } else if (played === "asleep" && attempted && shutWords(attempted, speakerKind(env, attempted))) {
          lines.push(shutWords(attempted, speakerKind(env, attempted)));
        } else if (played === "asleep") {
          lines.push(`${attempted || "That speaker"} is not in Spotify's device list ` +
            "right now, so nothing could be sent to it — it is most likely " +
            "asleep. Play anything on it for a moment (the WiiM app, or the " +
            "Spotify app) and press Play again. Nothing was changed.");
        } else if (played === "failed") {
          // Not "nothing was changed": shuffle and repeat are cleared before
          // the play request, so a refused play can still have altered those.
          lines.push(`Could not start ${dj.name} — Spotify refused the play ` +
            "request, so the speaker is playing whatever it was before.");
        }
        for (const wc of String(url.searchParams.get("w") ?? "").split(",")) {
          if (wc === "shuffle") lines.push("Shuffle is on and would not turn off — the set will play in a random order.");
          if (wc === "repeat") lines.push("Repeat-one is on and would not turn off — it will pin the first track.");
        }
        // Appended, not assigned: a load and a play can both be in the URL, and
        // the load is the half that changed the button.
        if (lines.length) flash = { lines: [...(flash?.lines ?? []), ...lines] };
      }
      const pausedLine = PAUSED_WORDS[url.searchParams.get("paused")];
      if (pausedLine) flash = { lines: [...(flash?.lines ?? []), pausedLine] };

      // Which speaker the picker opens on: after a play that did not reach
      // its speaker, that speaker, so the retry the flash asks for goes where
      // the message is about; else the one speaker (MC-28, pickFor), which
      // the bar keeps current with the helper's readings.
      const openOn = attempted ?? pickFor(env, request, playing?.pending ? { unknown: true } : playing, (await helperView(env)).lan)?.name ?? speakerFor(request, env);

      // The open request, if any. The ledger is the authority on state; the
      // KV record carries the words. Either being unreachable degrades to a
      // page without the card — absent beats wrong, same as the shelf.
      let openRequest = null;
      // The guest the newest ask is bound for, for the "Request sent" line.
      let boundGuest = null;
      if (env.STATION) {
        let row = null;
        try {
          const led = await ledgerP;
          // The NEWEST request only. A dismissed newest row silences the
          // card entirely — reaching past it would resurrect an older story
          // as "Your request" seconds after the page said it was cleared.
          const newest = led?.rows?.[0] ?? null;
          row = newest && newest.state !== "dismissed" ? newest : null;
        } catch { /* the ledger being down leaves the page without the card */ }
        if (row) {
          boundGuest = row.destination ? guestForPlaylistId(env, row.destination) : null;
          // The record read fails SEPARATELY: an outstanding row with an
          // unreadable record must still show a card, or the composer appears
          // over a slot the ledger will refuse — a form that can only bounce.
          let rec = null;
          try { rec = await getRequestRecord(env, row.id); } catch { /* plain card */ }
          const common = { id: row.id,
            asked: rec?.mood ?? null, lengthMin: rec?.length ?? null,
            // Every state carries it, not just Ready: the card should say what
            // was asked for from the moment it was asked, and an unreadable
            // record renders a plain card rather than a false negative.
            keep: rec?.keep === true,
            // A writer's kept set's notes, as the form chose (2026-10-18).
            ...(rec?.keep === true && rec.notes ? { notes: rec.notes } : {}),
            // Whether that answer is real. `keep: false` off an unreadable
            // record is an outage wearing a decision, and the page treats the
            // two differently: a known "no" lets a settled ready request go
            // quiet, an unknown keeps its card showing.
            keepUnknown: !rec,
            // Kept and then taken off the shelf: kept_at settled, no slug.
            // Without this the card falls back to the pending line and
            // promises a shelf entry the ledger now refuses to make — the
            // page contradicting the deletion the person just performed.
            keptRemoved: !!(row.kept_at && !row.kept_slug && !row.unrecorded),
            // Settled with no page because no tracklist was ever recorded for
            // the set. It leaves the same marks as a deletion and it is not
            // one — nobody took anything off the shelf, and telling a person
            // they did is a page inventing an act they never performed.
            keptUnrecorded: !!row.unrecorded,
            // Linked only once the keep is COMMITTED. A reservation on its own
            // means a page may or may not have been written yet, and a link to
            // a URL that 404s is worse than no link.
            kept: null };
          if (row.kept_at && row.kept_slug) {
            const keptRec = (await djSummariesP.catch(() => []))
              .find((s) => s.id === row.kept_slug);
            common.kept = {
              href: `${base}/programs/${row.kept_slug}?from=${encodeURIComponent(slugKey)}`,
              slug: row.kept_slug,
              title: keptRec?.title ?? null,
              // Posts to the SHELF's own endpoint, with a return field
              // naming a DJ and never a path — the same shape as the Put
              // on button control, and for the same reason: one
              // implementation of a destructive act, in one place.
              //
              // Offered for every kept page since 2026-09-13, written ones
              // too (the owner). An unreadable listing still gets no control:
              // a delete aimed at a page nobody could read is a guess.
              remove: keptRec
                ? { action: `/notes/${key}/unkeep`, return: slugKey } : null,
            };
          }
          const exit = (kind) => ({
            action: `${base}/${slugKey}/request/${kind}`, id: row.id });

          if (row.state === "pending" || row.state === "claimed") {
            // Three honest sentences. A LIVE lease is being worked; a lapsed
            // lease before any write means the set was truly not made yet; a
            // lapsed lease AFTER mark-write means the write may have landed —
            // "not made yet" would contradict the ledger's own point of no
            // return, so that card says it is being sorted out instead.
            const leaseAlive = (row.lease_until ?? 0) > Date.now();
            const ageMin = (Date.now() - (row.created_at ?? Date.now())) / 60000;
            // Five honest sentences (2026-09-06). A LIVE lease is being
            // worked. A lapsed lease before any write is a claim that DIED —
            // "retrying", because the sweep will, and the page rings the
            // doorbell again below; it used to read as plain pending, and the
            // owner watched "usually ready in five to fifteen minutes" for
            // half an hour and took the thing for broken. A lapsed lease
            // after mark-write may have landed: "checking". And a request
            // nobody has picked up in fifteen minutes stops promising
            // fifteen minutes: "slow".
            // "slow" is a comparison against an expectation, and the only
            // thing that creates one is a Claude wired to answer. With
            // autofulfillment off nothing was ever coming in fifteen minutes,
            // so an old request is not slow — it is simply still on the list,
            // and saying otherwise invents a fault out of a house working as
            // configured.
            const auto = env.AUTOFULFILL_ENABLED === "true";
            const plain = row.state !== "claimed"
              ? (auto && ageMin >= 15 ? "slow" : "pending")
              : leaseAlive ? "claimed"
              : row.write_started ? "checking" : "retrying";
            // WAITING ON A GUEST (MC-18 stage 4): the ledger's own list says
            // so — another request is writing the guest this one is bound for.
            const waitGuest = row.waiting_for && ["pending", "slow", "retrying"].includes(plain)
              ? guestForPlaylistId(env, row.destination) : null;
            const state = waitGuest ? "waiting" : plain;
            // The self-refresh yields to anything on the page a reload would
            // take away: a retry's ?on= room (asleep/stuck/failed) or the
            // undo form's snapshot key.
            const played = url.searchParams.get("played");
            const holding = ["asleep", "stuck", "failed"].includes(played)
              || !!url.searchParams.get("put") || !!url.searchParams.get("undo");
            openRequest = { state, ...common,
              // A page that re-reads itself every minute is worth its KV reads
              // only while something might change underneath it. With no
              // Claude wired up, a pending request changes when a PERSON acts,
              // which no amount of polling will hurry — and a page left open
              // on it would spend the day's free-tier writes on nothing. A
              // claim in flight still resolves on its own, so that keeps it.
              // "claimed" is the only state with a LIVE lease — somebody or
              // something is working it and it will resolve without a person.
              // retrying and checking resolve only when a person acts, so
              // polling them in a manual house is a page spending the day's
              // free-tier writes on nothing (Codex).
              refresh: !holding && (auto || state === "claimed"),
              // Said on the row while it stands: the set is not being made
              // because Spotify will not take the write, and for how long.
              throttledMinutes: throttle ? minutesLeft(throttle) : null,
              // Withdrawal is for a request nobody is working: never picked
              // up, or picked up by a claim that died before writing — the
              // ledger dismisses both. A live claim would be refused, so the
              // page does not offer what cannot happen.
              dismiss: ["pending", "slow", "retrying", "waiting"].includes(state) ? exit("dismiss") : null,
              waitingOn: waitGuest ? guestLabel(waitGuest.catalog) : null };
            // RING AGAIN. The curator that answers requests wakes on the
            // house's ring, and its hourly sweep is the only other wake — so a claim that died, or a ring that was missed, meant
            // up to an hour of "pending" with somebody watching. While
            // somebody IS watching (this page refreshes itself), the page
            // rings again: for a dead claim at once, for an unpicked request
            // after twenty minutes; at most every ten minutes and three times
            // per request, stamped on the record so it cannot loop. Behind
            // the response like the first ring. Best-effort, like the first.
            // Twenty, not three, since 2026-10-15: a request is claimed only
            // at fulfill_request, and a writer's run now reads Wikipedia for
            // ten minutes or more first, so at three the page woke a second
            // run that curated the same request in parallel.
            if (env.AUTOFULFILL_ENABLED === "true" && rec && !throttle && state !== "waiting"
                && (state === "retrying" || (state !== "claimed" && ageMin >= 20))) {
              const nudges = Array.isArray(rec.nudges) ? rec.nudges : [];
              const last = nudges.length ? Date.parse(nudges[nudges.length - 1]) : 0;
              if (nudges.length < 3 && Date.now() - last > 10 * 60 * 1000) {
                const stamped = { ...rec, nudges: [...nudges, new Date().toISOString()] };
                const ring = (async () => {
                  try {
                    // Stamp FIRST, so two refreshes a second apart cannot
                    // both ring; a ring that then fails costs one of three.
                    await putRequestRecord(env, stamped);
                    await emitRequestEvent(env, row.id, `.${nudges.length + 1}`);
                  } catch { /* the sweep is the backstop, as ever */ }
                })();
                if (ctx?.waitUntil) ctx.waitUntil(ring); else await ring;
              }
            }
          } else if (row.state === "ready") {
            // Ready that cannot lie. The claim is only made while THREE
            // things hold: the playlist's recorded ask still names this
            // request (else it was superseded by a later write), the live
            // read is whole (else nothing can be claimed), and the live
            // sequence fingerprint still matches the fulfilled one (else an
            // append or hand-edit changed what plays).
            let state;
            // The FINGERPRINT leads. A whole live read whose sequence still
            // equals the fulfilled one IS this request's set — Ready stands
            // even if the ask pointer was lost (its write is best-effort at
            // fulfilment). Only a MISMATCH consults the pointer: named this
            // request, the set drifted (changed); pointer absent, something
            // else took the button (superseded); pointer unreadable, nothing
            // can be told apart and the card says so — an outage is never
            // dressed as a fact. A read with holes, truncation, or an error
            // refuses to claim anything the same way.
            // AGAINST THE PLAYLIST THE SET WAS WRITTEN TO (2026-09-11). A
            // benched DJ holds a crate per service and this page reads the
            // primary; a request fulfilled into the OTHER crate compared
            // against the primary's tracks never matched, read as
            // "superseded", and vanished from the page — found live on three
            // of Youp's Tidal sets. When the row names the other crate, the
            // other crate's list and its own ask pointer are what count.
            const onOther = !!second?.pid && row.playlist_id === second.pid;
            // ON A GUEST (MC-18 stage 4): judged against the playlist the row
            // was written to, as ever, and a mismatch asks the guest's own
            // record instead of the ask pointer — this request on it is a set
            // that changed, anything else took the guest. A guest this page
            // did not read (another set is on it) is judged by the record.
            const rowGuest = guestForPlaylistId(env, row.playlist_id);
            const guestRow = rowGuest?.live ? (holders[rowGuest.catalog] ?? null) : null;
            const readHere = onOther || (!!pid && row.playlist_id === pid);
            let whole, live, ask, askFailed;
            if (onOther) {
              live = second.liveUris;
              whole = Array.isArray(live) && live.length > 0 &&
                second.count <= live.length && live.every((u) => u);
              const a = await programsKV(env).get(`ask:${second.pid}`, { type: "json" })
                .then((r) => ({ rec: r })).catch(() => ({ failed: true }));
              ask = a.rec ?? null; askFailed = !!a.failed;
            } else {
              live = liveUris;
              whole = (!problem || problem.kind === "empty") &&
                tile && tile.count <= tracks.length &&
                Array.isArray(liveUris) && liveUris.every((u) => u);
              ask = askRec; askFailed = askReadFailed;
            }
            let taken = null;
            if (guestRow) {
              const mine = guestRow.on?.ref === `request ${row.id}`;
              if (!readHere) state = guestRow.failed || !guestRow.on || mine ? "unverified" : "superseded";
              else if (!whole) state = "unverified";
              else {
                const liveFp = await fingerprintUris(live);
                state = liveFp === row.fingerprint ? "ready"
                  : guestRow.failed ? "unverified" : mine ? "changed" : "superseded";
              }
              if (state === "superseded") {
                // Who took it, and when, for the one quiet line.
                const by = guestRow.on;
                const byDj = by?.dj ? (house(env).djs[by.dj] ?? null) : null;
                taken = { label: guestLabel(rowGuest.catalog),
                  by: byDj ? (byDj.key === dj.key ? "same" : byDj.name) : by?.ref === "talk" ? "talk" : null,
                  at: atWords(houseClockWords(env, by?.at)) };
              }
            } else if (!whole) state = "unverified";
            else {
              const liveFp = await fingerprintUris(live);
              if (liveFp === row.fingerprint) state = "ready";
              else if (askFailed) state = "unverified";
              else if (ask?.requestId === row.id) state = "changed";
              else state = "superseded";
            }
            openRequest = { state, ...common, taken,
              tracks: row.track_count ?? null,
              runtime: row.runtime_ms ? clock(row.runtime_ms) : null };
          } else if (row.state === "needs-attention") {
            openRequest = { state: "attention", ...common,
              acknowledge: exit("ack") };
          } else if (row.state === "declined") {
            const sKey = row.suggested_dj && house(env).djs[row.suggested_dj]
              ? row.suggested_dj : null;
            const sDj = sKey ? house(env).djs[sKey] : null;
            openRequest = { state: "declined", ...common,
              djName: dj.name,
              reason: row.decline_reason ?? null,
              // News for as long as the line on Loaded, then the row's alone.
              justPassed: Date.now() - (row.updated_at ?? row.created_at ?? 0) < GUEST_ASK_WINDOW_MS,
              suggested: sDj
                ? { name: sDj.name, href: `${base}/${sKey}`,
                    // The same ask, to the DJ it suits, in one press (2026-09-14):
                    // the words as they were asked, posted to that DJ's own form,
                    // which checks them again. Only where that form would take it.
                    again: rec?.mood && env.REQUESTS_ENABLED === "true" && !sDj.archiveOnly && reachableDj(env, sDj)
                      ? { action: `${base}/${sKey}/request`, mood: rec.mood, length: rec.length ?? null,
                          avoid: rec.avoid ?? null, keep: rec.keep === true, service: rec.service ?? null }
                      : null }
                : null };
          }
        }
      }

      // The composer exists while the switch is on and nothing is in
      // flight: settled outcomes (ready, declined, attention) sit beside
      // the form — a finished story never blocks the next ask.
      const composerOn = env.REQUESTS_ENABLED === "true" && reachableDj(env, dj) &&
        !["pending", "slow", "claimed", "checking", "retrying", "waiting"].includes(openRequest?.state);

      // The submit outcome, back from the 303. Codes only, same reasoning as
      // ?played= — the URL is editable, so every printed word is composed
      // here and the visitor's text never rides in a query string.
      const ask = url.searchParams.get("ask");
      if (ask) {
        const ASK_LINES = {
          // Named: who was asked, and the preset the set lands on (the owner,
          // 2026-09-13: "I can't tell which DJ or if it succeeded").
          sent: `Request sent to ${dj.name}.${boundGuest
            ? ` When it is ready it goes on preset ${boundGuest.btn} (${
              boundGuest.name ?? guestLabel(boundGuest.catalog)}), replacing the set there.` : ""} ` +
            (env.AUTOFULFILL_ENABLED === "true"
              ? "It is usually ready in a few minutes — this page checks on its own."
              // The row learned this on 2026-09-07 and the flash did not, so the
              // most visible moment of the whole flow — the instant after Send —
              // still promised minutes nobody was counting (Codex).
              : "It is on their list; somebody has to ask Claude for it before it is made."),
          already: "That exact ask is already in — it was not sent twice.",
          busy: `${dj.name} already has one request open. One at a time; ` +
            "when it lands, ask again.",
          full: "The household has three requests waiting already — the cap. " +
            "Let one land first.",
          blank: "The request needs a mood or an occasion — the box came " +
            "through empty, so nothing was sent.",
          unavailable: "The request could not be recorded just now, so " +
            "nothing was sent. Try again in a moment.",
          // No preset of their own and no live requests preset for the
          // service (stage 6: the crates that caught this are gone).
          nowhere: `${dj.name} has no preset, and the requests preset for that service is not ` +
            "live, so a set would have nowhere to go. Nothing was sent.",
          dismissed: "The request was withdrawn. Nothing else changed.",
          acked: "Noted — the card is cleared. What is on the button is " +
            "what plays; any write that did happen took a backup first.",
          working: "Claude has already started on that request — it cannot " +
            "be withdrawn mid-flight. It will land as ready or as a card " +
            "that says what happened.",
          gone: "That request has already moved on — this page shows where " +
            "it stands now.",
          exitfail: "That could not be done just now — nothing changed. " +
            "Try again in a moment.",
        };
        if (ASK_LINES[ask]) {
          flash = { lines: [...(flash?.lines ?? []), ASK_LINES[ask]] };
        }
      }

      // AN ENDLESS DJ (MC-22 stage 4, MC-23): what their preset is doing and
      // the taps, from the ledger — no Spotify call — and the tap's outcome.
      // AND ANY DJ CAN TAKE ONE (MC-24): the slots, who is on each, and what
      // waits, so the page can offer "Put on preset N".
      let endless = null;
      let presetsOffer = null;
      const endlessCfg = parseEndless(env);
      let doc = null;
      if (endlessCfg?.mode === "live" && env.STATION && !dj.archiveOnly && dj.endless !== false) {
        try { doc = await endlessLoad(env); } catch { doc = null; }
      }
      const slotsNow = doc ? endlessSlots(env, endlessCfg, doc) : [];
      const endlessP = slotsNow.find((x) => x.dj === slugKey) ?? null;
      const waitsFor = slotsNow.find((x) => x.queued === slugKey) ?? null;
      if (doc) {
        presetsOffer = { action: `${base}/${slugKey}/endless`, mine: endlessP?.button ?? null,
          waits: waitsFor ? waitsFor.button : null,
          slots: slotsNow.map((x) => ({ btn: x.button, name: x.name, dj: x.dj, queued: x.queued ? (findDj(env, x.queued)?.name ?? x.queued) : null })) };
        // ON A NEW PRESET (2026-10-18): while the house has fewer than four
        // house DJs, and for a DJ who plays with no words. The numbers it
        // cannot take are named, as the keys are on the rules page.
        const room = !endlessP && !waitsFor && !dj.needsWords ? houseDjRoom(env, endlessCfg) : null;
        if (room) {
          const h = house(env);
          const lane = endlessCfg.presets.find((x) => x.lane) ?? null;
          const named = new Map([
            ...h.buttons.filter((b) => b.guest).map((b) => [b.btn, "Requests"]),
            ...(h.archive ? [[h.archive.btn, "Archive"]] : []),
            ...(h.fixed ?? []).map((b) => [b.btn, b.label]),
            ...slotsNow.map((x) => [x.button, x.name]),
            ...(lane ? [[lane.button, "Guest DJ"]] : []),
          ]);
          presetsOffer.fresh = { ...room, lane: lane?.button ?? null, runs: endlessCfg.dailyRuns,
            taken: [...named].filter(([n]) => n >= 1 && n <= 12).map(([n, name]) => ({ n, name })) };
        }
      }
      // PLAY ENDLESS (MC-27 stage 2): for a DJ with no fixed endless preset,
      // the way into the lane — and whether the lane is theirs now.
      const laneCfg = endlessCfg?.presets.find((x) => x.lane) ?? null;
      // The lane while it is theirs (stage 4): their endless block, as on 4,
      // 5, 8 or 9, and no header pill beside it.
      const laneMine = doc && laneCfg && !endlessP && doc.lane?.dj === slugKey
        ? { ...laneCfg, dj: slugKey, name: dj.name, queued: null } : null;
      // OPTIONAL WORDS (2026-10-13, with the merges): a DJ with a
      // `wordsHint` (Vibe, Soul; Hip Hop until 2026-10-15) gets the box too, not required,
      // and keeps it while the guest DJ is theirs, so "the North" can follow
      // "the South". Everyone else's page stays a bare Play endless.
      const laneOffer = doc && laneCfg && !endlessP && (!laneMine || dj.needsWords || dj.wordsHint) ? { action: `${base}/${slugKey}/endless`, button: laneCfg.button,
        mine: !!laneMine, playing: false, ...(dj.needsWords ? { needs: dj.needsWords, words: laneMine ? doc.lane?.words ?? null : null }
          : dj.wordsHint ? { hint: dj.wordsHint, words: laneMine ? doc.lane?.words ?? null : null } : {}) } : null;
      const endlessMine = endlessP ?? laneMine;
      if (endlessMine && doc) {
        const endlessP = endlessMine;
        const sess = doc.sessions?.[String(endlessP.button)] ?? null;
        const jobs = Object.values(doc.jobs ?? {}).filter((j) => j?.btn === endlessP.button && !j.done);
        // A Start fresh still new enough to start on its speaker (startsOn);
        // an older one is only a set for the next press.
        const fresh = jobs.find((j) => startsOn(j));
        const bar = sess ? await endlessBar(env, endlessP.button, null, doc).catch(() => null) : null;
        const rooms = parseRoomDevices(env);
        // PLAYING IS THE PLAYER'S WORD (the owner, 2026-09-24: Hank played on 5
        // and the page said "Not playing"). The watch looks every half hour
        // while idle, so a press is not a session for up to thirty minutes;
        // the page read the player anyway, and that answer is the truth. The
        // ledger's session stands in only when the player could not be read.
        const heard = !playing?.unknown;
        const onEndless = heard ? playing?.pid === endlessP.playlist : !!sess && !fresh;
        // A fresh set that landed and could not start, while nothing else
        // has happened since: the page says so and offers Play it now.
        const ns = !fresh && !onEndless ? await readNoStart(env, endlessP.button) : null;
        endless = { btn: endlessP.button, hours: endlessP.hours, action: `${base}/${slugKey}/endless`,
          ...(ns?.device ? { nostart: { device: ns.device, asleep: !!ns.asleep, kind: speakerKind(env, ns.device) } } : {}),
          playing: onEndless && !fresh, until: bar?.until ?? null, last: !!bar?.last,
          now: onEndless && heard && playing ? { track: playing.track ?? null, artists: playing.artists || null, device: playing.device ?? null } : null,
          making: fresh ? (fresh.device || true) : jobs.some((j) => j.kind === "fresh") ? "new" : false,
          steering: jobs.some((j) => j.kind === "steer"),
          list: listLink(endlessP.playlist), devices: rooms,
          leaving: endlessP.queued ? (findDj(env, endlessP.queued)?.name ?? endlessP.queued) : null,
          // The day's runs used up (the owner, 2026-09-23: say so when it is).
          spent: doc.day === houseDay(env, Date.now()) && (doc.runs ?? 0) >= endlessCfg.dailyRuns
            ? endlessCfg.dailyRuns : 0,
          device: pickFor(env, request, playing?.pending ? { unknown: true } : playing, (await helperView(env)).lan)?.name ?? speakerFor(request, env),
          ...(endlessP.lane ? { lane: true, from: doc.lane?.program?.title ?? null, words: doc.lane?.words ?? null,
            // Nearby, One Tap (2026-10-24): only for the words it was kept for.
            ...(doc.lane?.nearby?.list?.length && doc.lane.nearby.words === doc.lane.words ? { nearby: doc.lane.nearby } : {}) } : {}) };
        // A NEW PRESET STILL TO SAVE, AND GIVING IT UP (2026-10-18): the steps
        // stay until someone says it is saved on every WiiM (the house cannot
        // see a WiiM without the helper); giving up is for a house DJ preset
        // the setup page made.
        if (!endlessP.lane) {
          const owe = await programsKV(env).get(toSaveKey(endlessP.button), { type: "json" }).catch(() => null);
          if (owe) endless.toSave = { name: endlessP.name, list: listLink(endlessP.playlist) };
          if (endlessOnPage(env) && endlessCfg.presets.some((x) => !x.lane && x.button === endlessP.button)) endless.giveUp = true;
        }
      }
      // AT A GLANCE went from the DJ's page on 2026-10-24 (the owner: it showed
      // a tuned DJ's old settings); the Tuning row says what they are set to.
      const said = url.searchParams.get("endless");
      let laneAsk = null;
      if (said && endlessCfg) {
        const on = parseRoomDevices(env).find((r) => r === url.searchParams.get("on")) ?? null;
        const n = Number(url.searchParams.get("n")) || null;
        const other = findDj(env, String(url.searchParams.get("was") ?? ""))?.name ?? null;
        const sw = Number(url.searchParams.get("sw")) || null;
        const btnNow = endlessP?.button ?? n;
        const cap = `Today's ${endlessCfg.dailyRuns} DJ runs are used up. Try again tomorrow.`;
        const askedW = String(url.searchParams.get("w") ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
        const ENDLESS_LINES = {
          "fresh-asked": `A fresh set of ${dj.name} is being made. It starts${on ? ` on the ${on}` : ""} in a few minutes.`,
          "start-ok": `${dj.name} is playing on the ${on ?? "speaker"}.`,
          "start-stuck": `Spotify took it, but the ${on ?? "speaker"} is not playing it. Tap Play it now again.`,
          "start-asleep": shutWords(on, speakerKind(env, on), "tap Play it now again")
            ?? `The ${on ?? "speaker"} still did not answer: it is asleep. Wake it and tap Play it now again. Nothing was changed.`,
          "more-asked": `${dj.name} is making more like this. It takes over after the song that is playing, in a few minutes.`,
          "change-asked": `${dj.name} is changing it up. It takes over after the song that is playing, in a few minutes.`,
          "more-not-playing": `${dj.name} isn't playing right now. Press ${btnNow} on the remote first.`,
          "change-not-playing": `${dj.name} isn't playing right now. Press ${btnNow} on the remote first.`,
          "fresh-day-cap": cap, "more-day-cap": cap, "change-day-cap": cap,
          "put-done": `${dj.name} is on preset ${n} now${other ? `, instead of ${other}` : ""}.${sw && other ? ` ${other} moved to preset ${sw}.` : ""} ` +
            `A fresh set is being made: press ${n} in a few minutes. Then save preset ${n} again on each speaker so the remote says ${dj.name} — the Speakers tab shows how.`,
          "put-done-nofresh": `${dj.name} is on preset ${n} now, but today's ${endlessCfg.dailyRuns} DJ runs are used up: ` +
            `the first set comes after midnight, and until then ${n} plays the last one.`,
          "put-queued": `Preset ${n} is playing now. ${dj.name} takes over when it stops.`,
          "new-done": `${dj.name} is the house DJ on preset ${n} now. The first set is being made, a few minutes${on ? `, and starts on the ${on}` : ""}; then save preset ${n} once on each WiiM, as below.`,
          "new-done-nofresh": `${dj.name} is the house DJ on preset ${n} now, but today's ${endlessCfg.dailyRuns} endless runs are used up: the first set comes after midnight. Save preset ${n} once it has songs.`,
          "new-done-later": `${dj.name} is the house DJ on preset ${n} now. Tap Start fresh for the first set, then save preset ${n} once on each WiiM.`,
          "new-full": `This house has ${MAX_HOUSE_DJS} house DJs, the most it holds. Put ${dj.name} in one's place instead.`,
          "new-taken": `Preset ${n ?? ""} is taken. Pick a free number.`,
          "new-mine": `${dj.name} is a house DJ already.`,
          "new-not-here": "A new house DJ preset cannot be made here.",
          "new-spotify": "Spotify would not make the playlist just now. Nothing was changed; try again in a minute.",
          "new-failed": "That could not be done just now. Nothing was changed; try again in a moment.",
          "giveup-done": `${dj.name} gave up preset ${n}. Your WiiMs keep playing the last set on ${n} until you save something else there; nothing tops it up any more.`,
          "giveup-not-here": `${dj.name} has no preset here to give up.`,
          "giveup-failed": "That could not be done just now. Nothing was changed; try again in a moment.",
          "saved-ok": `Noted. Press ${btnNow} on any WiiM and ${dj.name} plays.`,
          "put-already": `${dj.name} is on preset ${n} already.`,
          "lane-next": `${dj.name} takes over as the guest DJ after the song that is playing${other ? `; ${other}'s unplayed songs stay free for next time` : ""}.`,
          "lane-started": `${dj.name} is the guest DJ on the ${on ?? "speaker"}, starting from their newest program on the Shelf. New songs follow as it runs low.`,
          "lane-carry-on": `${dj.name} carries on as the guest DJ on the ${on ?? "speaker"}, where the set stopped.`,
          "lane-own-preset": `${dj.name} is playing their own endless preset ${n ?? ""} on the ${on ?? "speaker"}.`,
          "lane-already": `${dj.name} is already playing as the guest DJ.`,
          "lane-making": `${dj.name} is making ${askedW ? `a set of ${askedW}` : "an opening set"}, about four minutes. It starts on the ${on ?? "speaker"} the moment it lands; you can leave this page.`,
          "lane-needs-words": `Tell ${dj.name} ${dj.needsWords ? `which ${String(dj.needsWords).replace(/^an? /, "")}` : "what to play"} first, in the box by Play endless.`,
          "lane-day-cap": cap,
          "lane-moved": "Someone picked another guest DJ at the same moment. Nothing was changed; try again.",
          "lane-stuck": `Spotify took it, but the ${on ?? "speaker"} is not playing it. Tap Play endless again.`,
          "lane-asleep": shutWords(on, speakerKind(env, on), "tap Play endless again")
            ?? `The ${on ?? "speaker"} did not answer: it is asleep. Wake it and tap Play endless again.`,
          "lane-start-failed": `${dj.name} is ready on preset ${n ?? ""}, but Spotify did not start it on the ${on ?? "speaker"}. ` +
            `Press ${n ?? "the preset"} on the remote, or tap Play endless again.`,
          "lane-no-endless": `${dj.name} plays asked-for sets only, never endless. Ask for a set below.`,
          "put-no-endless": `${dj.name} plays asked-for sets only, never on an endless preset.`,
          "put-in-lane": `${dj.name} is playing as the guest DJ right now. Stop it first, then make ${dj.name} a house DJ on ${n}.`,
        };
        const line = ENDLESS_LINES[said] ?? "That didn't go through. Nothing changed; try again in a moment.";
        // "Being made" only while it is (the owner, 2026-09-24: Sunny was
        // playing and the flash still said so). Once the job is done the
        // section below says what happened, so the line goes.
        const stale = (said === "fresh-asked" && !endless?.making)
          || ((said === "more-asked" || said === "change-asked") && !endless?.steering);
        // THE LANE IS SOMEBODY ELSE'S (MC-27 stage 3): not a line but a choice.
        if (said === "lane-busy") {
          const cur = findDj(env, String(url.searchParams.get("cur") ?? ""));
          const at = parseRoomDevices(env).find((r) => r === url.searchParams.get("at")) ?? null;
          laneAsk = cur ? { current: cur.name, on: at, device: on, action: `${base}/${slugKey}/endless`, words: askedW } : null;
        } else if (!stale) flash = { lines: [...(flash?.lines ?? []), line] };
      }
      // A key the home helper pressed from here (MC-25): words only when it
      // did not work.
      const hkWords = helperKeyWords(helperKeyFlash(env, url));
      if (hkWords) flash = { lines: [...(flash?.lines ?? []), hkWords] };

      // TUNE (MC-32 2b): the DJ's dials where they stand, Apply while this
      // DJ is the one playing (their preset, the guest DJ, their set on the
      // requests preset) and Save otherwise, with the day's runs left. Only
      // where the house keeps settings, which the dials live in.
      const tuneHere = env.HOUSE && !dj.archiveOnly && dialsOf(slugKey).length ? (() => {
        const said = url.searchParams.get("tune");
        const runsLeft = endlessCfg ? (doc?.day === houseDay(env, Date.now())
          ? Math.max(0, endlessCfg.dailyRuns - (doc.runs ?? 0)) : endlessCfg.dailyRuns) : 0;
        return { action: `${base}/${slugKey}/tune`, name: dj.name, field: dj.colour?.field ?? null,
          mode: endless?.playing || onThisButton ? "apply" : "save", runsLeft,
          dials: tuneDials(env, slugKey), summary: tuningSummary(env, slugKey) || null,
          open: said === "open", said: said && said !== "open" ? said : null };
      })() : null;
      return roomPage(renderDjRoom({
        base, notesHref: `/notes/${key}?dj=${encodeURIComponent(slugKey)}`,
        ...(await tabState(env)), quiet: await curatorQuiet(), tune: tuneHere,
        hkey: place?.kind === "guest" && place.catalog === "tidal" ? await helperKeyFor(env, request, place.guest.btn) : null,
        endless, presetsOffer, laneOffer, laneAsk,
        // The shelf's own delete, so a kept row here carries the fold that
        // deletes it (2026-09-11) — the same POST the global shelf makes.
        remove: { action: `/notes/${key}/unkeep` },
        // The service goes with the DJ so the page can say it: a Tidal button
        // gets "press N on the remote" where a Spotify one gets the Play form,
        // and a problem line names the service that was actually asked.
        dj: { key: slugKey, name: dj.name, btn, unit: "tracks", summary: dj.summary,
          catalog: viewCat, service: viewCat ? catalogFor(env, viewCat).label : null,
          // On a live guest (MC-18 stage 4): which, and since when; the Tidal
          // one opens in the app. On none while their sets go to the guests.
          guest: place?.kind === "guest" ? { btn: place.guest.btn, name: place.guest.name ?? null,
            label: guestLabel(place.catalog),
            since: sinceWords(houseClockWords(env, place.on?.at)),
            open: place.catalog !== "spotify" ? (serviceLink("playlist", place.pid)?.href ?? null) : null } : null,
          offGuest: !!places && !place,
          // The header is painted in the persona's own field and ink, as the
          // band on the wall is.
          colour: dj.colour ?? null },
        // The live guests by service, number and saved name, so a shelf row
        // says where its put lands (MC-18 stage 4; the name since 2026-09-13);
        // and whether any preset can still take a DJ, without which "Put on a
        // preset" goes.
        guests: places ? Object.fromEntries(Object.entries(holders).map(([c, h]) =>
          [c, { btn: h.guest.btn, name: h.guest.name ?? null }])) : null,
        placeable: djSlotsExist(env),
        tile, tracks, premise, shelf, handEdited, second,
        devices: roomDevices,
        defaultDevice: openOn,
        flash, archive: false, lastLoaded, problem,
        asks: DJ_ASKS[slugKey] ?? null,
        // The shelf's own endpoint, not a second one. Loading a programme is
        // the same write wherever it is pressed from, and a duplicate route is
        // a second place for the backup and the pointer to be got wrong.
        // WITHHELD FROM A DJ WITH NO PRESET (2026-09-07). Since a benched
        // writer can publish, a benched DJ's shelf now fills up — and Put on
        // preset would post to a route that refuses, which is a control that
        // looks like it works and does not. Their pages stay readable; the
        // press comes back when they are on the wall.
        auto: env.AUTOFULFILL_ENABLED === "true",
        // A PLAYLIST, not a preset: a benched DJ with a crate has somewhere for
        // their own programme to go, and the global notes page has offered the
        // control since step 2 while their own page withheld it (Codex).
        // Offered to every DJ on the roster (2026-09-10): a benched DJ with
        // no crate yet gets one at the press, on the set's own service.
        activate: !dj.archiveOnly ? { action: `/notes/${key}/activate` } : null,
        undo: undoKey ? { key: undoKey, action: `/notes/${key}/undo`, loaded: loadedDj } : null,
        request: openRequest,
        composer: composerOn ? { action: `${base}/${slugKey}/request`,
          // The service pills: only for a benched DJ, only in a house on both.
          // A tenant's set goes on their preset, and a house on one service
          // has nothing to choose (2026-09-10).
          services: !dj.button && houseCatalogNames(env).length > 1
            ? houseCatalogNames(env).map((c) => ({ name: c, label: catalogFor(env, c).label }))
            : null,
          // Where an asked set lands, by service: the requests preset's number
          // (the review, 2026-10-09: the form never said).
          lands: Object.fromEntries(houseCatalogNames(env).map((c) => [c, guestFor(env, c)?.btn ?? null])
            .filter(([, n]) => Number.isInteger(n))),
          // A writer's kept set: short notes or the long read (2026-10-18),
          // starting on the house's default (REQUEST_NOTES) until a phone chooses.
          // A tuned Notes dial (MC-32) is the DJ's own default: the form starts
          // on it, and the phone's last choice does not move it.
          notes: writerKindFor(env, dj) ? (tuningOf(env, slugKey).notes ?? (env.REQUEST_NOTES === "long" ? "long" : "short")) : null,
          notesTuned: !!(writerKindFor(env, dj) && tuningOf(env, slugKey).notes) } : null,
        playingHere, nowPlaying,
      }));
    }

    // The composer's target: POST only, the same key and Origin discipline as
    // the play form, and the visitor's words live in the BODY — the 303 back
    // carries a code, never text. Dark until REQUESTS_ENABLED says otherwise
    // (the kill switch; MC-07 turns it on), and dark means 404, not a hint.
    // TUNE A DJ (MC-32 2a, tasks/mc32-dj-tuning.md): the household moves a
    // DJ's dials (tuning.js), kept until moved back. POST only, with the page
    // key and the Origin rule of the endless taps. "save" keeps the dials;
    // "apply" keeps them and, while this DJ is playing (their preset, the
    // guest DJ, or their request set), turns what is queued after the playing
    // song as Change it up does: one DJ run. A "reset" field puts every dial
    // back. Saving is never refused for Spotify's quota: only the turn is.
    // Asked by fetch (the Tune panel), it answers in JSON.
    const roomTune = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/([a-z0-9-]{1,40})\/tune$/);
    if (roomTune) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(roomTune[1], key)) return notFound();
      const slugKey = house(env).djs[roomTune[2]]?.key ?? roomTune[2];
      const who = house(env).djs[slugKey];
      // THE FORM, FOR THE BAR'S PANEL (2b): fetched when Tune is tapped there,
      // so every page can open it without carrying every DJ's dials.
      if (request.method === "GET" && url.searchParams.get("view") && who && !who.archiveOnly && dialsOf(slugKey).length && env.HOUSE) {
        const cfgV = parseEndless(env);
        let stV = null;
        try { stV = cfgV?.mode === "live" ? await endlessLoad(env) : null; } catch { stV = null; }
        const runsLeft = cfgV ? (stV?.day === houseDay(env, Date.now()) ? Math.max(0, cfgV.dailyRuns - (stV.runs ?? 0)) : cfgV.dailyRuns) : 0;
        return new Response(tuneForm({ action: `/buttons/${key}/${slugKey}/tune`, name: who.name, field: who.colour?.field ?? null,
          mode: url.searchParams.get("mode") === "save" ? "save" : "apply", runsLeft, dials: tuneDials(env, slugKey) }, { panel: true }), {
          // The room's headers (the locks review, 2026-10-25): the panel's
          // script inserts this, and opened on its own it is held to the
          // room's CSP and frames like any page.
          headers: roomHeaders });
      }
      if (request.method !== "POST") return roomRefuse(405, "This is the Tune form's target and only accepts POST.");
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return roomRefuse(403, `This form was submitted from ${origin}, not from ${url.origin}.`);
      }
      if (!who || who.archiveOnly || !dialsOf(slugKey).length) return roomRefuse(404, "This DJ has no dials to tune.");
      let form = null;
      try { form = await request.formData(); } catch { form = null; }
      const what = String(form?.get("do") ?? "save");
      const values = form?.get("reset") ? {} : tuningFromForm(slugKey, form, env);
      let code = "saved";
      try {
        if (!env.HOUSE) throw new Error("no settings store");
        await choosePageSetting(env, TUNING_SETTING, tuningWith(env, slugKey, values));
      } catch { code = "store"; }
      const summary = tuningSummary(env, slugKey, values);
      if (code === "saved" && what === "apply") {
        const words = summary ? `New tuning from the listener: ${summary}. Follow get_dj's tuning for ${who.name}.`
          : `Back to ${who.name}'s own settings: the brief as written, no tuning.`;
        const cfg = parseEndless(env);
        let st = null;
        try { st = cfg?.mode === "live" ? await endlessLoad(env) : null; } catch { st = null; }
        const p = st ? endlessSlots(env, cfg, st).find((x) => x.dj === slugKey)
          ?? endlessPresets(env, cfg, st).find((x) => x.lane && x.dj === slugKey) ?? null : null;
        let r = p ? await endlessPageSteer(env, { button: p.button, words }) : { status: "off" };
        if (r.status === "off" || r.status === "not-playing") {
          // Their request set on the requests preset: the now panel's path.
          try {
            const t = await callTool(env, "steer_endless", { words, when: "next", replace_rest: true, dj: slugKey }, { remaining: 20 });
            r = { status: t?.status === "asked" || t?.status === "steered" ? "asked" : "failed" };
          } catch (e) {
            const m = String(e?.message ?? e);
            r = { status: /runs are used up/.test(m) ? "day-cap" : /limiting this account/.test(m) ? "throttled"
              : /steering works while|is not the one playing|names no DJ|took over/.test(m) ? "not-playing" : "failed" };
          }
        }
        code = r.status === "asked" ? "applied" : r.status === "not-playing" || r.status === "off" ? "saved" : `saved-${r.status}`;
      }
      if (/application\/json/.test(request.headers.get("accept") ?? "")) {
        return new Response(JSON.stringify({ ok: code === "saved" || code === "applied", code, summary }), { headers: {
          "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      return new Response(null, { status: 303, headers: {
        location: `/buttons/${key}/${slugKey}?tune=${encodeURIComponent(code)}`, "cache-control": "no-store" } });
    }

    // THE ENDLESS DJ'S TAPS (MC-22 stage 4, MC-23): Start fresh on a
    // speaker, More like this, Change it up. Each files a job for the curator
    // and goes back to the DJ's page, which says what happened.
    const roomEndless = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/([a-z0-9-]{1,40})\/endless$/);
    if (roomEndless) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(roomEndless[1], key)) return notFound();
      // An old key (the merges, 2026-10-13: "sunny") is its DJ's key here, as
      // the ledger has it.
      roomEndless[2] = house(env).djs[roomEndless[2]]?.key ?? roomEndless[2];
      // WHILE A SET IS BEING MADE, THE PAGE ASKS HERE (2026-09-24): the
      // ledger only, no Spotify call, so the page can reload itself when the
      // set lands instead of saying "being made" over music that is playing.
      if (request.method === "GET") {
        const cfgG = parseEndless(env);
        let st = null;
        try { st = cfgG?.mode === "live" ? await endlessLoad(env) : null; } catch { st = null; }
        // The guest DJ's too (Codex's code review 8): the lane is not a slot.
        const slot = st ? endlessSlots(env, cfgG, st).find((x) => x.dj === roomEndless[2])
          ?? endlessPresets(env, cfgG, st).find((x) => x.lane && x.dj === roomEndless[2]) ?? null : null;
        const open = slot ? Object.values(st.jobs ?? {}).filter((j) => j?.btn === slot.button && !j.done) : [];
        return new Response(JSON.stringify({ ok: !!slot, making: open.some((j) => j.kind === "fresh"),
          steering: open.some((j) => j.kind === "steer") }), { headers: {
          "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      if (request.method !== "POST") return roomRefuse(405, "This is the endless DJ's form target and only accepts POST.");
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return roomRefuse(403, `This form was submitted from ${origin}, not from ${url.origin}.`);
      }
      const slugKey = roomEndless[2];
      const cfg = parseEndless(env);
      const who = house(env).djs[slugKey];
      if (!cfg || cfg.mode !== "live" || !who || who.archiveOnly) return roomRefuse(404, "This DJ cannot go on an endless preset here.");
      // Spotify's quota, said before anything is sent, as every other Play
      // says it (the review, 2026-10-09: Play endless and Start fresh sent
      // anyway, deepening the lockout, and said "Nothing changed").
      const throttleE = await throttledUntil(env);
      if (throttleE) {
        return roomRefuse(503,
          `Spotify is limiting this account's requests for about ${waitWords(minutesLeft(throttleE))} ` +
          "more (quota exceeded), so this site cannot start or change an endless DJ until then. " +
          "Nothing was sent. The presets on the speaker itself still work.");
      }
      let form = null;
      try { form = await request.formData(); } catch { form = null; }
      const what = String(form?.get("do") ?? "");
      let state = null;
      try { state = await endlessLoad(env); } catch { state = null; }
      const laneP = state ? endlessPresets(env, cfg, state).find((x) => x.lane && x.dj === slugKey) ?? null : null;
      const p = state ? endlessSlots(env, cfg, state).find((x) => x.dj === slugKey)
        ?? (laneP ? { ...laneP, name: `Guest DJ · ${who.name}` } : null) : null;
      // PLAY ENDLESS (MC-27): any DJ, into the lane or onto their own preset.
      if (what === "lane") {
        const rooms = parseRoomDevices(env);
        const asked = String(form?.get("device") ?? "").trim();
        const device = rooms.find((r) => r === asked) ?? speakerFor(request, env);
        const whenAsked = String(form?.get("when") ?? "");
        // What to play, for a DJ who is told (Deep Dive's artist, 2026-10-10).
        const wordsAsked = String(form?.get("words") ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
        const r = device ? await playEndless(env, { dj: slugKey, device, budget: { remaining: 40 }, words: wordsAsked,
          when: whenAsked === "now" || whenAsked === "next" ? whenAsked : null }) : { status: "failed" };
        // A start that did not take is said as that, whichever case it was.
        // A start Spotify refused after the DJ took the preset is its own
        // line: the preset did change (the review, 2026-10-09).
        const said = ["started", "carry-on", "own-preset"].includes(r.status) && r.start && r.start !== "ok"
          ? (r.start === "failed" ? "start-failed" : r.start) : r.status;
        // The bar's panel's Nearby (2026-10-24) asks by fetch and stays put.
        if (/application\/json/.test(request.headers.get("accept") ?? "")) {
          return new Response(JSON.stringify({ ok: ["making", "started", "carry-on", "own-preset"].includes(r.status), code: said }), { headers: {
            "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
        }
        const lq = new URLSearchParams({ endless: `lane-${said}` });
        if (r.status === "busy") { lq.set("cur", r.current); if (r.on) lq.set("at", r.on); if (wordsAsked) lq.set("w", wordsAsked); }
        if (wordsAsked && r.status === "making") lq.set("w", wordsAsked);
        if (r.from) lq.set("was", r.from);
        if (device) lq.set("on", device);
        if (r.button) lq.set("n", String(r.button));
        return new Response(null, { status: 303, headers: {
          location: `/buttons/${key}/${slugKey}?${lq}`, "cache-control": "no-store",
          // A Play picks its speaker, as a key's does.
          ...(device ? { "set-cookie": pickCookie(device) } : {}) } });
      }
      // MORE LIKE THIS ON A REQUEST SET (2026-09-27, the now panel): the
      // DJ's program on the Spotify requests preset, playing, is steered as
      // steer_endless steers it — one path — with the rest of the set
      // replaced after the playing song, because a tap is the asking. Tried
      // first when this DJ is on no endless preset, or theirs is not the one
      // playing.
      const steerWords = (pl) => what === "more"
        ? `More like what is playing now${pl?.item?.name ? `: "${String(pl.item.name).slice(0, 80)}"${
          pl.item.artists?.[0]?.name ? ` by ${String(pl.item.artists[0].name).slice(0, 60)}` : ""}` : ""}, and the last few songs`
        : "Change it up: a different corner of your brief from the last few songs";
      const programSteer = async () => {
        let pl = null;
        try { pl = await playerState(env); } catch { return { status: "unknown" }; }
        try {
          const r = await callTool(env, "steer_endless", { words: steerWords(pl), when: "next", replace_rest: true, dj: slugKey },
            { remaining: 20 });
          return { status: r?.status === "asked" || r?.status === "steered" ? "asked" : "failed" };
        } catch (e) {
          const m = String(e?.message ?? e);
          return { status: /runs are used up/.test(m) ? "day-cap" : /limiting this account/.test(m) ? "throttled"
            : /steering works while|is not the one playing|names no DJ|took over/.test(m) ? "not-playing" : "failed" };
        }
      };
      // Everything but "put" and "new" is for the preset this DJ is on.
      if (what !== "put" && what !== "new" && !p && !(what === "more" || what === "change")) {
        return roomRefuse(404, "This DJ is not on an endless preset here.");
      }
      let out = { status: "failed" };
      const q = new URLSearchParams();
      if (what === "put") {
        // PUT ON A PRESET (MC-24): this DJ onto the slot named, swapping with
        // whoever is there if this DJ holds another.
        const n = Number(form?.get("btn"));
        q.set("n", String(n));
        const leaving = state ? endlessSlots(env, cfg, state).find((x) => x.button === n)?.dj ?? null : null;
        out = Number.isInteger(n) ? await endlessAssign(env, { dj: slugKey, button: n }) : { status: "no-slot" };
        if (out.status === "done") {
          if (leaving) q.set("was", leaving);
          if (out.swapped) q.set("sw", String(out.swapped));
          if (out.noFresh?.includes(n)) out.status = "done-nofresh";
        }
      } else if (what === "new") {
        // A NEW HOUSE DJ PRESET (2026-10-18): a number the house does not
        // use, while it has fewer than four; this DJ's playlist (the one they
        // gave up, so there is never a second list of the same name, else a
        // new one); the preset added to the setup page's endless DJs; and the
        // first set asked for at once on the picked speaker.
        const n = Number(form?.get("btn"));
        if (Number.isInteger(n)) q.set("n", String(n));
        const room = houseDjRoom(env, cfg);
        const queuedHere = state ? endlessSlots(env, cfg, state).some((x) => x.queued === slugKey) : false;
        if (!room || who.needsWords || who.endless === false) out = { status: "not-here" };
        else if (p || queuedHere) out = { status: "mine" };
        else if (room.full) out = { status: "full" };
        else if (!room.free.includes(n)) out = { status: "taken" };
        else {
          const cat = catalogFor(withBudget(env, { remaining: 6 }), "spotify");
          const kept = await programsKV(env).get(retiredKey(slugKey), { type: "json" }).catch(() => null);
          let playlist = null;
          if (kept?.playlist) { try { await cat.items(kept.playlist, null); playlist = kept.playlist; } catch { playlist = null; } }
          if (!playlist) {
            try { playlist = (await cat.createPlaylist({ name: who.name, public: false, description: `${who.name}, endless, on preset ${n}.` }))?.id ?? null; }
            catch { playlist = null; }
          }
          if (!playlist) out = { status: "spotify" };
          else {
            const json = endlessJson(cfg, [...cfg.presets, { button: n, dj: slugKey, playlist, hours: 4 }]);
            try {
              await endlessUpdate(env, (st) => { forgetPreset(st, n); return {}; });
              await choosePageSetting(env, "ENDLESS", json);
              await programsKV(env).put(toSaveKey(n), JSON.stringify({ dj: slugKey, playlist, at: new Date().toISOString() }));
              await programsKV(env).delete(retiredKey(slugKey)).catch(() => {});
              const device = speakerFor(request, env);
              let fresh = { status: "off" };
              if (device) { try { fresh = await endlessStartFresh({ ...env, ENDLESS: json }, { button: n, device }); } catch { fresh = { status: "failed" }; } }
              out = fresh.status === "asked" ? { status: "done", device } : { status: fresh.status === "day-cap" ? "done-nofresh" : "done-later" };
            } catch { out = { status: "failed" }; }
          }
        }
      } else if (what === "giveup") {
        // GIVING A HOUSE DJ PRESET UP (2026-10-18): the number freed, the
        // playlist kept for this DJ, and nothing tops it up any more.
        const pre = p && !p.lane ? cfg.presets.find((x) => !x.lane && x.button === p.button) ?? null : null;
        if (!endlessOnPage(env) || !pre) out = { status: "not-here" };
        else {
          q.set("n", String(pre.button));
          try {
            await endlessUpdate(env, (st) => { forgetPreset(st, pre.button); return {}; });
            await choosePageSetting(env, "ENDLESS", endlessJson(cfg, cfg.presets.filter((x) => x !== pre)));
            await programsKV(env).put(retiredKey(slugKey), JSON.stringify({ playlist: pre.playlist, button: pre.button, at: new Date().toISOString() }));
            await programsKV(env).delete(toSaveKey(pre.button)).catch(() => {});
            out = { status: "done" };
          } catch { out = { status: "failed" }; }
        }
      } else if (what === "saved") {
        // SAVED ON EVERY WIIM, in the household's word (2026-10-18).
        if (p && !p.lane) { await programsKV(env).delete(toSaveKey(p.button)).catch(() => {}); out = { status: "ok" }; }
        else out = { status: "not-here" };
      } else if (what === "fresh") {
        const rooms = parseRoomDevices(env);
        const asked = String(form?.get("device") ?? "").trim();
        const device = rooms.find((r) => r === asked) ?? speakerFor(request, env);
        out = device ? await endlessStartFresh(env, { button: p.button, device }) : { status: "failed" };
        if (out.status === "asked") out.device = device;
      } else if (what === "start") {
        // PLAY, AND PLAY IT NOW (2026-09-24): the preset's list as it stands,
        // on the picked speaker or the one a fresh set could not start on.
        // No curator, no run.
        const rooms = parseRoomDevices(env);
        const asked = String(form?.get("device") ?? "").trim();
        const device = rooms.find((r) => r === asked) ?? speakerFor(request, env);
        if (device) {
          out.device = device;
          try {
            const r = await startPlaylistOnDevice(env, { id: p.playlist, name: p.name, catalog: "spotify" }, device, { remaining: 16 });
            out.status = r?.preset_safe || r?.unverified ? "ok" : "stuck";
            if (out.status === "ok") {
              await endlessNoStart(env, p.button, null);
              // The next run of the watch looks, rather than the next idle
              // look up to half an hour on: a session is counted from then.
              try { await endlessUpdate(env, (st) => { st.lastLook = 0; return {}; }); } catch { /* the idle look finds it */ }
            }
          } catch (e) {
            out.status = sleptThrough(e) ? "asleep" : "failed";
            if (out.status === "asleep") await endlessNoStart(env, p.button, { at: Date.now(), device, asleep: true });
          }
        }
      } else if (what === "more" || what === "change") {
        out = p ? await endlessPageSteer(env, { button: p.button, words: steerWords }) : { status: "off" };
        if (out.status === "off" || out.status === "not-playing") {
          const r = await programSteer();
          if (r.status !== "not-playing" || !p) out = r;
        }
      }
      // The now panel's steer (2026-09-25) asks by fetch and stays put.
      if (/application\/json/.test(request.headers.get("accept") ?? "") && (what === "more" || what === "change")) {
        return new Response(JSON.stringify({ ok: out.status === "asked" || out.status === "ok", code: out.status }), { headers: {
          "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      q.set("endless", `${what}-${out.status}`);
      if (out.device) q.set("on", out.device);
      return new Response(null, { status: 303, headers: {
        location: `/buttons/${key}/${slugKey}?${q}`, "cache-control": "no-store",
        ...(out.device ? { "set-cookie": pickCookie(out.device) } : {}) } });
    }

    const roomAsk = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/([a-z0-9-]{1,40})\/request$/);
    if (roomAsk) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(roomAsk[1], key)) return notFound();
      if (env.REQUESTS_ENABLED !== "true") return notFound();
      const base = `/buttons/${key}`;
      if (request.method !== "POST") {
        return roomRefuse(405,
          "This is the request form's target and only accepts POST — a link " +
          "or a refresh lands here as a GET. Go back to the DJ's page.");
      }
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return roomRefuse(403,
          `This form was submitted from ${origin}, not from ${url.origin}.`);
      }
      // An old key is its DJ's (the merges, 2026-10-13), so a request is
      // filed under the key the ledger and the Shelf read.
      const slugKey = house(env).djs[roomAsk[2]]?.key ?? roomAsk[2];
      // THE ARCHIVE TAKES REQUESTS NOW (2026-09-07). It used to refuse them —
      // "it replays what was already made" — which was true when it had no DJ
      // and a set meant three takes chosen by hand. It has a DJ and a rotating
      // set of any length, so asking it is the same act as asking Hank. The
      // page's slug stays `archive`; the request is filed against the persona,
      // because that is who curates it.
      const archiveAsk = slugKey === "archive";
      const dj = archiveAsk
        ? house(env).djs[ARCHIVE_DJ]
        : house(env).djs[slugKey];
      if (!dj) return roomRefuse(404, `No DJ named "${slugKey.slice(0, 60)}".`);
      if (archiveAsk && !house(env).archive) {
        return roomRefuse(400, "This house has no archive preset for a set to land on.");
      }
      if (!archiveAsk && !reachableDj(env, dj)) {
        return roomRefuse(400,
          `${dj.name}'s sets are made from the house's own recordings — ask for one ` +
          "on the archive's own page.");
      }
      if (!env.STATION) {
        return roomRefuse(500, "The request ledger is not configured here.");
      }

      let mood = "", length = "", avoid = "", keep = false, service = null, notes = null;
      try {
        const form = await request.formData();
        // The rendered inputs are single-line; control characters can only
        // arrive by hand-built POST, and the request boundary says they never
        // reach the store. Stripped rather than refused: a pasted stray
        // newline should not bounce a human.
        const clean = (v) => String(v ?? "")
          .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2060\ufeff]/g, " ")
          .replace(/\s+/g, " ").trim();
        mood = clean(form.get("mood")).slice(0, 300);
        length = clean(form.get("length"));
        avoid = clean(form.get("avoid")).slice(0, 200);
        // The ONLY value that means yes is the one the rendered box sends. An
        // unticked checkbox sends no field at all, so absent is false without
        // asking — which is the fail-safe this feature needs in the direction
        // that matters: nothing is kept unless it was asked for, and a
        // hand-built POST cannot turn it on with a truthy-looking string.
        keep = form.get("keep") === "1";
        // SHORT NOTES OR THE LONG READ (the owner, 2026-10-18): only for a
        // writer's set that is kept, and only a value the form offers.
        const saidNotes = clean(form.get("notes")).toLowerCase();
        if (keep && !archiveAsk && writerKindFor(env, dj) && ["short", "long"].includes(saidNotes)) notes = saidNotes;
        // WHICH SERVICE, for a benched DJ in a mixed house (2026-09-10). Only
        // a value the form itself offers is kept; anything else — a service
        // this house has not got, a tenant's ask, a hand-built POST — reads
        // as no choice, and fulfilment takes the house's default. Never from
        // the words: those are taste, and "on Tidal" typed there is ignored
        // by design.
        const said = clean(form.get("service")).toLowerCase();
        if (!archiveAsk && !dj.button && CATALOGS.includes(said) &&
            houseCatalogNames(env).includes(said) && houseCatalogNames(env).length > 1) {
          service = said;
        }
      } catch { /* no body reads as empty, and empty is refused below */ }
      const back = (code) => new Response(null, {
        status: 303,
        headers: { location: `${base}/${slugKey}?ask=${code}`,
          "cache-control": "no-store" },
      });
      if (!mood) return back("blank");
      // The rendered select offers exactly these four; anything else is a
      // hand-built POST, and refusing tells the truth about what happened.
      //
      // 120 was added 2026-09-04: a 12" mix runs six to nine minutes and a
      // two-hour set of them is about twenty tracks, well inside the 100 this
      // path allows. The 30/38 ceiling that bounds a PUBLISHED PROGRAMME does
      // not apply here — that one pays a resolve subrequest per track name,
      // and a listener request arrives with its URIs already resolved.
      if (!["30", "60", "90", "120"].includes(length)) {
        return roomRefuse(400,
          "The length must be one of the form's own choices: 30, 60, 90 or 120.");
      }

      const id = makeRequestId();
      const normalized = normalizeRequest(`${mood} :: ${length} :: ${avoid}`);
      // The words land in KV BEFORE the gate. The other order needed a
      // rollback when the record write failed, and rollback loses a race: a
      // twin submission answered "already" against a row whose record then
      // never materialized. This way any row the ledger accepts has its
      // record readable first — and a REFUSED submission strands only an
      // orphan record that its own TTL drains, which no page ever reads
      // (rendering goes through the ledger).
      try {
        await putRequestRecord(env, { id, dj: archiveAsk ? ARCHIVE_DJ : slugKey, mood,
          length: Number(length), avoid: avoid || null,
          // Written only when true, so an unticked box and every record made
          // before this existed read the same way — absent. The ledger holds
          // claims, leases and state and this is none of them: it is what the
          // person asked for, which is what the record is for.
          ...(keep ? { keep: true } : {}),
          // Written only when chosen, so a record from before the choice
          // existed and one where it did not apply read the same way — absent.
          ...(service ? { service } : {}),
          // Written only when chosen, likewise: a writer's kept set's notes.
          ...(notes ? { notes } : {}),
          at: new Date().toISOString() });
      } catch {
        return back("unavailable");
      }
      let decision;
      try {
        // WHERE THE SET IS BOUND (MC-18 stage 2): the live guest on the ask's
        // service, else on the house's default — shown on the row while it
        // waits; the claim stamps where the write really goes. None for an
        // ask of a DJ who holds a preset, for the archive, and for every ask
        // while no guest is live, which leaves this call as it was.
        // Since stage 3, the lookup every door makes (destinationFor).
        const bound = archiveAsk ? null : destinationFor(env, dj, setService(env, { asked: service }));
        if (bound && !dj.button && !bound.guest) return back("nowhere");
        const destination = bound?.guest ? bound.pl.id : null;
        decision = await station(env, "submit",
          { id, dj: archiveAsk ? ARCHIVE_DJ : slugKey, normalized, ...(destination ? { destination } : {}) });
      } catch {
        return back("unavailable");
      }
      if (!decision?.ok) {
        return back(decision?.code === "duplicate" ? "already"
          : decision?.code === "outstanding" ? "busy"
          : decision?.code === "household-cap" ? "full" : "unavailable");
      }
      // The wake-up event, after record and row both exist — and only while
      // autofulfillment is switched on, which is a SEPARATE switch from the
      // composer's: requests can be collected quietly before any Claude is
      // wired to answer them. A failed emit is flagged on the record and the
      // request stays honestly pending for the hourly sweep.
      if (env.AUTOFULFILL_ENABLED === "true") {
        const ring = (async () => {
          const emitted = await emitRequestEvent(env, id);
          if (!emitted) {
            try {
              // Re-put on the SHORT clock on purpose — the record is
              // milliseconds old and still pending. This spread-and-flag
              // pattern must never be copied to a post-settle path, where it
              // would silently shrink 90 days to 30.
              const rec = await getRequestRecord(env, id);
              if (rec) await putRequestRecord(env, { ...rec, dispatch: "failed" });
            } catch { /* the sweep needs no flag; this is for the operator */ }
          }
        })();
        // Behind the visitor's redirect when the platform allows; inline in
        // the node tests, which call fetch without a ctx and assert on the
        // emit deterministically.
        if (ctx?.waitUntil) ctx.waitUntil(ring);
        else await ring;
      }
      return back("sent");
    }

    // The lifecycle's exits: withdraw a pending request, or acknowledge a
    // needs-attention card. Same key and Origin discipline as every form,
    // and deliberately NOT behind REQUESTS_ENABLED — an exit stays open
    // after the entrance closes: a request submitted before a switch-off
    // must still be dismissible.
    const roomAskExit = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/([a-z0-9-]{1,40})\/request\/(dismiss|ack)$/);
    if (roomAskExit) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(roomAskExit[1], key)) return notFound();
      const base = `/buttons/${key}`;
      if (request.method !== "POST") {
        return roomRefuse(405,
          "This is a card action's target and only accepts POST. Go back to " +
          "the DJ's page.");
      }
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return roomRefuse(403,
          `This form was submitted from ${origin}, not from ${url.origin}.`);
      }
      const slugKey = roomAskExit[2];
      if (!house(env).djs[slugKey]) return roomRefuse(404, `No DJ named "${slugKey.slice(0, 60)}".`);
      if (!env.STATION) return roomRefuse(500, "The request ledger is not configured here.");
      let id = "";
      try {
        const form = await request.formData();
        id = String(form.get("request_id") ?? "").trim();
      } catch { /* empty refuses below */ }
      const back = (code) => new Response(null, {
        status: 303,
        headers: { location: `${base}/${slugKey}?ask=${code}`,
          "cache-control": "no-store" },
      });
      if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return back("gone");
      try {
        // The row must belong to THIS DJ's page: a forged id in the hidden
        // field cannot reach another DJ's request through this form.
        const got = await station(env, "get", { id });
        if (!got.ok || got.row.dj !== slugKey) return back("gone");
        const out = await station(env,
          roomAskExit[3] === "dismiss" ? "dismiss" : "acknowledge", { id });
        if (out.ok) return back(roomAskExit[3] === "dismiss" ? "dismissed" : "acked");
        // The refusal carries the state it refused FROM — the `got` read is
        // already stale if a curator claimed in between.
        return back(out.code === "bad-transition" && out.state === "claimed"
          ? "working" : "gone");
      } catch {
        // The ledger not answering is not the request having moved on — the
        // card is probably still there, and "gone" beside it would be a
        // page arguing with itself.
        return back("exitfail");
      }
    }

    // Play: POST only, same origin discipline as the chooser, and the form may
    // name a DJ only through the path and a speaker only off the allowlist —
    // play_playlist would accept any playlist and any device, and a hidden
    // form field must not inherit that reach.
    const roomPlay = url.pathname.match(/^\/buttons\/([A-Za-z0-9_-]{8,128})\/([a-z0-9-]{1,40})\/play$/);
    if (roomPlay) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(roomPlay[1], key)) return notFound();
      const base = `/buttons/${key}`;
      if (request.method !== "POST") {
        return roomRefuse(405,
          "This is the play form's target and only accepts POST — a link or a " +
          "refresh lands here as a GET. Go back to the presets page and press Play.");
      }
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return roomRefuse(403,
          `This form was submitted from ${origin}, not from ${url.origin}.`);
      }
      const slugKey = house(env).djs[roomPlay[2]]?.key ?? roomPlay[2];
      if (slugKey === "archive") {
        const slot = house(env).archive;
        return roomRefuse(400,
          "The archive cannot be started from a page — the server has no route " +
          "to the speaker. " + (slot ? `Press ${slot.btn} on the remote; ` : "") +
          "play_archive changes what it holds.");
      }
      // The form, read once and first: a guest's Play names its preset in it.
      // No body at all is the grid's old form, which had no device field.
      let form = null;
      try { form = await request.formData(); } catch { form = null; }
      // WHAT TO START. A DJ's preset or crate, as ever. Since MC-18 stage 4, a
      // DJ on no preset whose set a live guest holds: that guest. And a guest
      // preset itself, from its band on the presets page or step 1 of its save
      // on the Speakers page — a play is not a write, so a guest that is not
      // live yet can be started, which is how a speaker's preset is saved from
      // it. The Tidal one cannot, like any Tidal preset.
      let target;
      if (slugKey === "guest") {
        const gb = Number(form?.get("btn"));
        const g = Object.values(house(env).guest ?? {}).find((x) => x && x.btn === gb) ?? null;
        if (!g) return roomRefuse(404, "There is no guest preset with that number here.");
        if (g.catalog !== "spotify") {
          return roomRefuse(400,
            `${g.name} is on ${catalogFor(env, g.catalog).label}, which cannot be started from a ` +
            `page — playback from here goes through Spotify Connect. Press ${g.btn} on the remote.`);
        }
        target = { pl: { id: g.playlist, name: g.name, via: `alias "${guestAlias(g.catalog)}"`,
          catalog: g.catalog }, btn: g.btn, guest: g };
      } else if (slugKey === "preset") {
        // A PRESET KEY FROM THE SPEAKERS PAGE (MC-19, tasks/done/mc19-key-play.md).
        // Not a press of the key: the playlist on file for that number, over
        // Spotify Connect, on the WiiM named — and only when that speaker's
        // own reading says the key is Spotify. Everything here is free of the
        // network; the one paid check, the playlist's name against the
        // reading's, runs after the throttle refusal and through the route's
        // budget, below, where the other targets' plays begin.
        const n = Number(form?.get("btn"));
        if (!Number.isInteger(n) || n < 1 || n > 12) {
          return roomRefuse(404, "There is no preset with that number — the remote has 1 to 12.");
        }
        const boxes = parseSpeakers(env);
        const wanted = String(form?.get("device") ?? "").trim();
        const box = boxes.find((sp) => sp.name === wanted) ?? null;
        const ownFile = !boxes.length ? presetOnFile(env, n) : null;
        if (!boxes.length) {
          // A HOUSE WITH NO WIIM ADDRESSES (MC-31): the house's own preset, on
          // a speaker chosen at setup. Nothing is read from the speaker, so
          // there is no saved name to check the playlist against.
          const rooms = parseRoomDevices(env);
          if (!rooms.includes(wanted)) {
            return roomRefuse(400, `"${wanted.slice(0, 60)}" is not one of this house's speakers` +
              `${rooms.length ? ` (${rooms.join(", ")})` : ""}. Nothing was played.`);
          }
          if (!ownFile) return roomRefuse(400, `This house has no Spotify playlist on preset ${n}. Nothing was played.`);
          target = { pl: { ...ownFile, name: ownFile.name ?? ownKeyName(env, n) }, btn: n, guest: null,
            preset: { n, box: { name: wanted, slug: speakerSlug(wanted) }, saw: null, own: true } };
        } else if (!box) {
          return roomRefuse(400, boxes.length
            ? `The preset keys belong to the speakers this house named (${boxes.map((b) => b.name).join(", ")}); ` +
              `"${wanted.slice(0, 60)}" is not one of them. Nothing was played.`
            : "This house has named no WiiM speakers (WIIM_SPEAKERS), so no preset key can be played from a page.");
        }
        if (!target) {
        const rec = (await readReadings(env, [box]))[box.slug];
        if (!rec) {
          return roomRefuse(400, `No phone has read the ${box.name} yet, so this page cannot tell what preset ${n} ` +
            "holds there. Read the speakers first. Nothing was played.");
        }
        const held = rec.presets.find((x) => x.btn === n) ?? null;
        if (!held) {
          return roomRefuse(400, `The ${box.name} has nothing saved on preset ${n}, as the speakers were last read. ` +
            "Nothing was played.");
        }
        if (held.source !== "Spotify") {
          return roomRefuse(400, `The ${box.name} holds ${held.name} (${held.source ?? "not Spotify"}) on preset ${n} — ` +
            "nothing this server can start, since playback from here goes through Spotify Connect. " +
            `Press ${n} on the remote.`);
        }
        const onFile = presetOnFile(env, n);
        if (!onFile) {
          return roomRefuse(400, `The ${box.name} holds ${held.name} on preset ${n}, but this house has no Spotify ` +
            `playlist on file for ${n}, so there is nothing to start it from. Nothing was played.`);
        }
        target = { pl: { ...onFile, name: held.name }, btn: n, guest: null,
          preset: { n, box, saw: held.name } };
        }
      } else {
        const dj = house(env).djs[slugKey];
        if (!dj) return roomRefuse(404, `No DJ named "${slugKey.slice(0, 60)}".`);
        const places = djPlaces(dj, dj.button ? {} : await guestHolders(env));
        const place = places ? (places[0] ?? null) : null;
        if (places && !place) {
          return roomRefuse(400,
            `${dj.name} has no set on a guest preset now — each holds one set at a time, and ` +
            `another has taken its place. Ask ${dj.name} for a set, or put one back from the ` +
            "shelf. Nothing was played.");
        }
        const cat = place ? place.catalog : dj.catalog;
        // The same refusal refuseToStart makes for the tools, as a page: the
        // card never offers this Play, so only a hand-built POST gets here.
        if (cat && cat !== "spotify") {
          const label = catalogFor(env, cat).label;
          return roomRefuse(400, place?.kind === "guest"
            ? `${dj.name}'s set is on the ${label} requests preset, which cannot be started from a page ` +
              "— playback from here goes through Spotify Connect. " +
              `Press ${place.guest.btn} on the remote.`
            : `${dj.name} sits on a ${label} preset, which ` +
              "cannot be started from a page — playback from here goes through " +
              `Spotify Connect. Press ${dj.btn} on the remote.`);
        }
        const pid = place ? place.pid : configuredPlaylistId(env, dj.alias);
        if (!pid) {
          return roomRefuse(500, dj.button
            ? `${dj.name} is on ${dj.button}, but BUTTONS gives that button no ` +
              "playlist this server can resolve."
            : `${dj.name} has no playlist this server can resolve — no preset, and ` +
              "nothing of theirs on a requests preset.");
        }
        target = { pl: { id: pid, name: dj.name,
          via: `alias "${place?.kind === "guest" ? guestAlias(cat) : dj.alias}"`, catalog: cat },
          btn: dj.btn, guest: null };
      }

      // Named on the DJ page's picker; remembered per DJ for the grid, which
      // has no room for one; DEFAULT_DEVICE if neither. Resolved HERE rather
      // than sent as a hidden field, so the label on the card and the room the
      // press reaches read from one place.
      // Three doors: the wall, the DJ page, and — since MC-12 — the Speakers
      // page, whose Play is step 1 of a re-save and must land back on the
      // open band for the speaker it just started.
      let device = String(form?.get("device") ?? "").trim();
      const pause = form?.get("pause") === "1";
      const toSpeakers = form?.get("back") === "wiim";
      const back = form?.get("back") === "dj" ? `${base}/${slugKey}` : base;
      // The playing band's circle shows a pause glyph, so its press pauses
      // — a glyph that said one thing while the press did another would be
      // the page lying. Back to the wall, which re-reads the player and draws
      // what is true; a failed pause leaves the band lit, which is the truth.
      // Spotify's quota: a press now would be refused, so it is refused here
      // in words, before anything is sent (2026-09-06).
      const throttle = await throttledUntil(env);
      if (throttle) {
        return roomRefuse(503,
          `Spotify is limiting this account's requests for about ${waitWords(minutesLeft(throttle))} ` +
          "more (quota exceeded), so this site cannot start or pause a speaker until then. " +
          "Nothing was sent. The presets on the speaker itself still work.");
      }
      // THE SAME PAUSE AS THE BAR'S (the review, 2026-10-09): the device
      // Spotify plays on, by its id, written down for the bar's play-again,
      // and an outcome the landing page says in words. It was a bare PUT
      // with every error swallowed and nothing said.
      if (pause) {
        let pz = "ok";
        try {
          const envB = withBudget(env, { remaining: 8 });
          const st = await playerState(envB);
          if (!st?.device?.id || st.is_playing !== true) pz = "gone";
          else await pauseNoted(env, envB, st, st.device.name, parseSpeakers(env));
        } catch (e) { pz = e?.status === 404 ? "gone" : "failed"; }
        return new Response(null, {
          status: 303, headers: { location: `${back}${back.includes("?") ? "&" : "?"}paused=${pz}`, "cache-control": "no-store" } });
      }
      // A preset key names its WiiM and nothing else: no remembered room, no
      // default, or a key could play in a room whose reading nobody checked.
      if (!device && target.preset) device = target.preset.box.name;
      if (!device) device = speakerFor(request, env) ?? "";
      const allowed = parseRoomDevices(env);
      if (!allowed.includes(device)) {
        return roomRefuse(400,
          `"${device.slice(0, 60)}" is not one of the configured speakers ` +
          `(${allowed.join(", ")}). Nothing was played.`);
      }

      const budget = { remaining: 40 };
      // THE PAID HALF OF A PRESET KEY'S GATE (MC-19): the playlist on file
      // must still carry the name the speaker saved the key under. One read,
      // through the route's budget, after the throttle refusal above — never
      // while building the target (Codex MC19-REVIEW-7f3a). A speaker's key
      // carries no playlist id, so the name is the only thing the two can
      // agree on; a rename on Spotify, or a re-save on the box, is a mismatch
      // until the key is re-saved and re-read, and that is correct.
      // An endless preset's playlist is the house's own, kept through every
      // swap, so its renamed list never matches the name the speaker saved
      // it under until it is saved again — and playing it is the first step
      // of that save (the review, 2026-10-09: "Save again" keys could only
      // refuse). The name check is for the old aliases alone.
      if (target.preset && !target.pl.endless && !target.preset.own) {
        const { n, box, saw } = target.preset;
        let meta = null;
        try { meta = await catalogFor(withBudget(env, budget), "spotify").playlist(target.pl.id); } catch { meta = null; }
        if (!meta?.name) {
          return roomRefuse(502, `Could not read the playlist on file for preset ${n} from Spotify just now, so its ` +
            `name could not be checked against what the ${box.name} holds. Nothing was played.`);
        }
        if (!sameName(meta.name, saw)) {
          return roomRefuse(409, `The ${box.name} calls preset ${n} "${saw}"; the playlist on file for ${n} is ` +
            `"${meta.name}". They no longer match — re-save the preset on the speaker, then Read again — so ` +
            "nothing was played.");
        }
      }
      let played = "failed";
      const w = [];
      try {
        const out = await startPlaylistOnDevice(env, target.pl, device, budget);
        played = out.preset_safe ? "ok" : out.unverified ? "sent" : "stuck";
        if (out.shuffle_warning) w.push("shuffle");
        if (out.repeat_warning) w.push("repeat");
        // The device warning — found by a remembered id, the name may have
        // changed — stays in the tool's answer for Claude and is not a
        // sentence for the page: the press worked, and there is nothing a
        // person can do with it at that moment (the owner, 2026-09-05).
      } catch (err) {
        // A Spotify 4xx and an absent speaker are one catch and were one
        // message, so a sleeping WiiM read as an error in the service. The
        // speaker being missing from the Connect list is its own outcome: the
        // fix is a nudge on the device, not a retry here.
        played = err?.noSuchDevice ? "asleep" : "failed";
      }
      // AN ENDLESS PLAYLIST, STARTED HERE (2026-09-27): the next run of the
      // watch looks, as after a DJ page's Play. Left to the idle look, a short
      // leftover list (The Selector's six songs) ran out before it was seen.
      if (played !== "failed" && played !== "asleep" &&
          parseEndless(env)?.presets.some((p) => p.playlist === target.pl.id)) {
        try { await endlessUpdate(env, (st) => { st.lastLook = 0; return {}; }); } catch { /* the idle look finds it */ }
      }
      // Redirect rather than render: a refresh must not start the room twice.
      // A guest's comes back to the presets page, which says what went wrong.
      return new Response(null, {
        status: 303,
        headers: {
          location: target.preset
            // A key's Play comes back to the Speakers page with a flash of its
            // own — never ?on= ?played=, which open the re-save checklist.
            ? `${base}/wiim?kp=${played}&k=${target.btn}&kon=${encodeURIComponent(target.preset.box.slug)}`
            : toSpeakers
            ? `${base}/wiim?on=${encodeURIComponent(speakerSlug(device))}&ask=${target.btn}&played=${played}#asked`
            : target.guest
            ? `${base}?played=${played}&g=${target.guest.btn}&on=${encodeURIComponent(device)}`
            : `${base}/${slugKey}?played=${played}&on=${
              encodeURIComponent(device)}${w.length ? `&w=${w.join(",")}` : ""}`,
          "cache-control": "no-store",
        },
      });
    }

    // PLAY FROM THE SHELF (2026-09-10). A tap on a row starts that set on a
    // speaker NOW, from the record's own URIs, the way play_uris does — no
    // playlist is written, no preset changes, no backup is spent. Spotify
    // only, because Connect is the only path from a server to a speaker: a
    // Tidal set is put in its DJ's crate from the same row and opened in the
    // Tidal app, and an archive set goes on the archive preset. Each of those
    // is refused here in the words that say what to do instead — the page
    // never offers this Play on their rows, so only a hand-built POST arrives.
    const libPlay = url.pathname.match(/^\/(notes)\/([A-Za-z0-9_-]{8,128})\/play$/);
    if (libPlay) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(libPlay[2], key)) return notFound();
      const base = `/${libPlay[1]}/${key}`;
      // The way home is the SHELF, and it says so. `roomRefuse` offers the
      // presets page, which is somewhere this reader was not — and every
      // sentence below tells them to go back to Program Notes (Codex,
      // 2026-09-10). Same page furniture, same nonce, one different link.
      const roomRefuse = (status, why) => roomPage(
        renderRefusal({ why, back: base, backLabel: "back to the Shelf" }),
        { status, headers: { "cache-control": "no-store" } });
      if (request.method !== "POST") {
        return roomRefuse(405,
          "This is the shelf's Play target and only accepts POST — a link or a " +
          "refresh lands here as a GET. Go back to the Shelf and press Play.");
      }
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return roomRefuse(403,
          `This form was submitted from ${origin}, not from ${url.origin}.`);
      }
      let slug = "", device = "", filter = "", svcFilter = "", findKeep = null;
      try {
        const form = await request.formData();
        slug = String(form.get("slug") ?? "").trim();
        device = String(form.get("device") ?? "").trim();
        filter = String(form.get("dj") ?? "").trim();
        svcFilter = String(form.get("svc") ?? "").trim();
        findKeep = shelfFind(form.get("q"));
      } catch { /* no body: refused below as no slug */ }
      if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
        return roomRefuse(400, "No program was named. Go back to the Shelf and press Play on a row.");
      }
      // Back to the view the press came from — the writer filter is display
      // only, and it is the same field the chooser carries for the same reason.
      const back = (q) => `${base}?${q}${
        /^[a-z0-9-]{1,40}$/.test(filter) ? `&dj=${encodeURIComponent(filter)}` : ""}${
        /^(spotify|tidal|files)$/.test(svcFilter) ? `&svc=${svcFilter}` : ""}${
        findKeep ? `&q=${encodeURIComponent(findKeep)}` : ""}`;
      const rec = await programsKV(env).get(`program:${slug}`, { type: "json" });
      if (!rec) {
        return roomRefuse(404, "That program is not on the shelf any more. Nothing was started.");
      }
      const title = String(rec.title ?? slug).slice(0, 120);
      const cat = programCatalog(rec);
      if (cat === "files") {
        const slot = house(env).archive;
        return roomRefuse(400,
          `"${title}" is a set from the archive, and nothing here can start it — the ` +
          "server has no route to the speaker. Put it on the archive preset from the " +
          `shelf${slot ? ` and press ${slot.btn} on the remote` : ""}.`);
      }
      // A TIDAL SET, PLAYED BY THE HOME HELPER (MC-25; option A, the owner,
      // 2026-09-24): put on the Tidal guest first when it is not there —
      // activateProgram, the same write and the same guards as "Put on
      // preset", backed up and restorable — then the guest's key pressed on
      // the WiiM the form named, or the default WiiM.
      if (cat === "tidal") {
        const tg = guestFor(env, "tidal");
        const hands = tg?.live ? (await helperView(env)).lan?.hands : false;
        if (hands) {
          let isOn = false;
          try { isOn = (await programsKV(env).get(`current:${tg.playlist}`)) === slug; } catch { isOn = false; }
          let undoKey = "";
          if (!isOn) {
            try {
              const out = await activateProgram(env, slug, { remaining: 40 });
              if (out.activated === false) throw new Error("not put");
              if (out.undo_snapshot) undoKey = out.undo_snapshot;
            } catch (err) {
              return new Response(null, { status: 303, headers: {
                location: back(`played=${err?.guestBusy ? "tidal-busy" : "tidal-failed"}&on=&slug=${encodeURIComponent(slug)}`),
                "cache-control": "no-store" } });
            }
          }
          const boxes = parseSpeakers(env);
          const box = boxes.find((b) => b.name === device) ?? boxes.find((b) => b.name === fallbackDevice(env)) ?? boxes[0];
          const code = box ? await helperPress(env, box, tg.btn) : "failed";
          return new Response(null, { status: 303, headers: {
            location: back(`played=${code !== "ok" ? "helper" : isOn ? "ok" : "ok-put"}&on=${encodeURIComponent(box?.name ?? "")}&slug=${encodeURIComponent(slug)}${
              undoKey ? `&undo=${encodeURIComponent(undoKey)}` : ""}`),
            "cache-control": "no-store",
            ...(code === "ok" && box ? { "set-cookie": pickCookie(box.name) } : {}) } });
        }
      }
      if (cat && cat !== "spotify") {
        const label = catalogFor(env, cat).label;
        const dj = programDj(env, rec.dj);
        return roomRefuse(400,
          `"${title}" is on ${label}, which cannot be started from a page — playback ` +
          `from here goes through Spotify Connect, and ${label} has no such path ` +
          `from a server. ${dj?.btn && dj.catalog === cat
            ? `Put it on ${dj.name}'s preset from the shelf and press ${dj.btn} on the remote.`
            : `Load it on a ${label} preset from the shelf, if one is live, and press its number on the remote.`} Nothing was started.`);
      }
      const { uris, notSpotify } = programSpotifyUris(rec);
      if (!uris.length) {
        return roomRefuse(400,
          `"${title}" has no playable tracks recorded, so there is nothing to start.`);
      }
      if (notSpotify.length) {
        return roomRefuse(400,
          `"${title}" has ${plural(notSpotify.length, "track")} recorded that this server ` +
          `cannot start (${notSpotify.slice(0, 2).map((u) => String(u).slice(0, 40)).join(", ")}` +
          `${notSpotify.length > 2 ? ", …" : ""}). Playing the rest would be a different ` +
          "set under this one's name, so nothing was started.");
      }
      // Spotify's quota: a press now would be refused, so it is refused here
      // in words, before anything is sent — the same gate the wall's Play has.
      const throttle = await throttledUntil(env);
      if (throttle) {
        return roomRefuse(503,
          `Spotify is limiting this account's requests for about ${waitWords(minutesLeft(throttle))} ` +
          "more (quota exceeded), so this site cannot start a speaker until then. " +
          "Nothing was sent. The presets on the speaker itself still work.");
      }
      // The speaker the page's select named; the one the shelf last played
      // on; DEFAULT_DEVICE. Remembered under a key no DJ can have (a slug is
      // [a-z0-9-]), in the same map the DJ pages use, so a lost speaker is
      // filtered out of both the same way.
      if (!device) device = speakerFor(request, env) ?? "";
      if (!device) device = fallbackDevice(env);
      const allowed = parseRoomDevices(env);
      if (!allowed.includes(device)) {
        return roomRefuse(400,
          `"${device.slice(0, 60)}" is not one of the configured speakers ` +
          `(${allowed.join(", ")}). Nothing was played.`);
      }
      // As its preset if one holds it, else as its own tracks (playShelfSet).
      const played = (await playShelfSet(env, rec, uris, device, { remaining: 40 })).code;
      // Redirect rather than render: a refresh must not start the room twice.
      return new Response(null, {
        status: 303,
        headers: {
          location: back(`played=${played}&on=${encodeURIComponent(device)}&slug=${encodeURIComponent(slug)}`),
          "cache-control": "no-store",
          // A Play here is a choice of speaker, for every page (2026-09-23).
          ...(played === "failed" || played === "asleep" ? {} : { "set-cookie": pickCookie(device) }),
        },
      });
    }

    const lib = url.pathname.match(/^\/(notes)\/([A-Za-z0-9_-]{8,128})$/);
    if (lib) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(lib[2], key)) return notFound();
      const base = `/${lib[1]}/${key}`;
      const { rows: filed, unreadable, onAir, open } = await shelfState(env);
      // A MERGED DJ'S PROGRAMS ARE THE NEW DJ'S (the merges, 2026-10-13): a
      // set filed as "Sunny" or "Stax" is under Vibe or Soul here, one
      // byline and one filter, as on the DJ's own page. A cut DJ's name
      // finds nobody and stays as written (KRS-One's since Hip Hop was cut,
      // 2026-10-15).
      const rows = filed.map((r) => {
        const now = r?.dj ? findDj(env, r.dj)?.name : null;
        return now && now !== r.dj ? { ...r, dj: now } : r;
      });

      const flash = url.searchParams.get("put")
        ? flashFor(url.searchParams.get("put"), rows, onAir)
        : url.searchParams.get("played")
        ? playedFlash(url.searchParams, rows, parseRoomDevices(env), (n) => speakerKind(env, n))
        : null;
      // The shelf's Play: one speaker select for the page, the last room the
      // shelf played on already chosen. Only where a play can be started —
      // a house with no Spotify login has no Connect path and gets no Play.
      const rooms = parseRoomDevices(env);
      const play = catalogAvailable(env, "spotify")
        ? { action: `${base}/play`, devices: rooms,
            // The one speaker (MC-28). The Shelf runs no script and reads no
            // Spotify, so this is the memo, the helper and the cookie.
            device: (await pickCheap(env, request))?.name ?? speakerFor(request, env),
            ...(await shelfTidalKey(env, request)) }
        : null;
      // Shape-checked before it is rendered into a form value. The real check
      // is on the POST — this only keeps junk out of the page.
      const undoParam = url.searchParams.get("undo") ?? "";
      const loadedRow = /^ok:([a-z0-9-]{1,64})$/.exec(url.searchParams.get("put") ?? "")?.[1] ?? null;
      const undoKey = SNAP_KEY.test(undoParam) && (!loadedRow || onAir?.has?.(loadedRow)) ? undoParam : null;
      // THE NOW BAR, SERVED WHOLE (MC-21). This page cannot fill it with a
      // script: it goes out under `default-src 'none'` with no script-src and
      // no connect-src, and a test asserts it stays script-free. Loosening
      // that was declined — script-free is what this page was built around —
      // so the Shelf reads the player itself and prints the bar filled.
      //
      // It is also the page the bar is most for: every Play here starts a set
      // on a speaker, and Spotify plays in one place per account, so every
      // Play stops whatever the bar is naming. Until now nothing on this
      // screen said what that was.
      //
      return new Response(renderLibrary(rows, {
        onAir, action: `${base}/activate`, flash, play, open,
        archiveBtn: house(env).archive?.btn ?? null,
        // The durable home for the delete. A request row ages out at 90 days
        // and its card goes with it; a kept page never expires, so the shelf
        // has to be able to remove one long after the ask is forgotten.
        remove: { action: `${base}/unkeep` },
        undo: undoKey ? { key: undoKey, action: `${base}/undo`, loaded: loadedRow } : null,
        // Filtering is display-only, so an unknown value falls back to showing
        // everything rather than being refused.
        dj: url.searchParams.get("dj"), svc: url.searchParams.get("svc"), q: url.searchParams.get("q"), self: base,
        room: `/buttons/${key}`, unreadable, asksOn: env.REQUESTS_ENABLED === "true", ...(await tabState(env)),
        // The house mark beside the "?" (2026-10-22): no script here to ask.
        hmark: await helperView(env),
      }), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          // Unlike a program, this page changes every time one is published.
          // A cached copy is a shelf that is quietly missing the newest thing.
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-robots-tag": "noindex, nofollow",
          // form-action 'self', not 'none': this page posts back to itself to
          // put a program on the button. Everything else stays shut.
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
            // The two hosts the services serve album art from, and no other.
            // Still no scripts.
            "font-src https://fonts.gstatic.com; img-src 'self' https://i.scdn.co https://resources.tidal.com; " +
            // The manifest and the touch icon (MC-14); still no scripts.
            "manifest-src 'self'; form-action 'self'; " +
            "base-uri 'none'; frame-ancestors 'none'",
        },
      });
    }

    // The chooser. POST and never GET: a GET that rewrites a playlist would be
    // fired by link prefetchers and by the preview every chat app builds, so
    // pasting the notes URL into a message could change what the room plays.
    const act = url.pathname.match(/^\/(notes)\/([A-Za-z0-9_-]{8,128})\/activate$/);
    if (act) {
      const key = env.PROGRAM_LIBRARY_KEY;
      // The key is the only thing that stays a bare 404. A wrong key must not
      // learn anything from the reply, including that the route exists.
      if (!key || !sameSecret(act[2], key)) return notFound();
      const base = `/${act[1]}/${key}`;

      // Past the key, say what went wrong. These four failures all answered
      // "not found" and were reported as one symptom, which made a working
      // route indistinguishable from a broken one — a check nobody can read is
      // barely a check.
      const refuse = (status, why) => new Response(`${why}\n`, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });

      if (request.method !== "POST") {
        return refuse(405,
          "This is the form target, not a page. It only accepts POST — a link " +
          "or a refresh lands here as a GET. Go back to the notes page and " +
          "press the button on the row you want.");
      }
      // Same-origin only. Without this any page anywhere could post a form here
      // on behalf of someone whose browser has the notes page open.
      // Reject a DIFFERENT origin, not an unknown one. Browsers send
      // `Origin: null` from sandboxed and in-app webviews — which is how this
      // page gets opened from a phone most of the time — and treating that as
      // hostile turned a working button into a bare "not found" for exactly the
      // person the feature was built for.
      //
      // Allowing it costs nothing here: the key in the path is already
      // the credential, so anyone able to aim a form at this route can activate
      // a program anyway. The check is worth keeping only for the case it
      // actually catches, which is a real page on a real other domain.
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return refuse(403,
          `This form was submitted from ${origin}, not from ${url.origin}. Only ` +
          "the notes page itself can put a program on the button.");
      }

      let slug = "";
      let dj = "";
      let back = "";
      let svcKeep = "", findKeep = null;
      try {
        const form = await request.formData();
        slug = String(form.get("slug") ?? "").trim();
        // Which filter the row was pressed from. Cosmetic, and validated like
        // anything else off a form: it goes straight back into a URL.
        const d = String(form.get("dj") ?? "").trim();
        if (/^[a-z0-9-]{1,64}$/.test(d)) dj = d;
        svcKeep = shelfFilter(null, form.get("svc")).svc ?? "";
        findKeep = shelfFind(form.get("q"));
        // Where to land afterwards. A DJ's own page carries this so a load
        // pressed there does not dump the reader onto the shelf.
        //
        // It names a DJ, never a path. A form field holding a URL — or even a
        // path — is an open redirect waiting to happen, and the destination is
        // composed here from a name that has to be one of ours.
        const r = String(form.get("return") ?? "").trim();
        if (house(env).djs[r] || (r === "archive" && house(env).archive)) back = r;
      } catch { /* not a form body */ }
      if (!slug) {
        return refuse(400,
          "No program was named. If this came from the notes page, it was " +
          "probably rendered by an older version — reload it and try again.");
      }
      if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
        return refuse(400, `"${slug.slice(0, 80)}" is not a program id.`);
      }

      const budget = { remaining: 40 };
      let put = "";
      let undoKey = "";
      try {
        const out = await activateProgram(env, slug, budget);
        put = out.activated === false ? `failed:${slug}` : `ok:${slug}`;
        if (out.undo_snapshot) undoKey = out.undo_snapshot;
      } catch (err) {
        // The reasons are all legitimate — a re-pointed alias, a program with no
        // tracks — and none of them belong on a page anyone with the link can
        // load. The page says it did not happen and the tool says why.
        // One reason is the page's to say (MC-18): a guest being written for a
        // request right now, which a minute fixes. It carries a DJ's key and a
        // service, both checked again where the flash is drawn.
        put = err?.guestBusy
          ? `busy:${slug}:${err.guestBusy.dj ?? ""}:${err.guestBusy.catalog}` : `failed:${slug}`;
      }
      // Redirect rather than render: a refresh must not activate a second time.
      const to = back ? `/buttons/${key}/${back}` : base;
      return new Response(null, {
        status: 303,
        headers: {
          location: `${to}?put=${encodeURIComponent(put)}${
            dj && !back ? `&dj=${encodeURIComponent(dj)}` : ""}${
            svcKeep && !back ? `&svc=${svcKeep}` : ""}${
            findKeep && !back ? `&q=${encodeURIComponent(findKeep)}` : ""}${
            undoKey ? `&undo=${encodeURIComponent(undoKey)}` : ""}`,
          "cache-control": "no-store",
        },
      });
    }

    // Take a kept setlist off the shelf. Same key, origin and POST discipline
    // as the chooser, and ONE extra gate that is the whole reason a slug may
    // ride in a form here at all: this deletes a setlist and nothing else. The
    // essays were written in the app and keep their supervised path there
    // (`unpublish_program`, which asks for confirm: true first). Without that
    // gate, a form taking any slug would turn the notes key from "put a set on
    // a button", which has an undo behind it, into "delete anything", which
    // has nothing behind it at all.
    //
    // Deliberately no undo: the decision, recorded in tasks/done/mc08-write-it-up.md,
    // is delete-only, with the honest copy beside the control rather than a
    // confirm dialog — `default-src 'none'` with no script-src rules one out.
    const unkeep = url.pathname.match(/^\/(notes)\/([A-Za-z0-9_-]{8,128})\/unkeep$/);
    if (unkeep) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(unkeep[2], key)) return notFound();
      const base = `/${unkeep[1]}/${key}`;
      const refuse = (status, why) => new Response(`${why}\n`, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
      if (request.method !== "POST") {
        return refuse(405,
          "This is the form target, not a page. It only accepts POST — a link " +
          "or a refresh lands here as a GET.");
      }
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return refuse(403,
          `This form was submitted from ${origin}, not from ${url.origin}.`);
      }

      let slug = "";
      let back = "";
      let keepQ = "";
      try {
        const form = await request.formData();
        slug = String(form.get("slug") ?? "").trim();
        // A DJ, never a path — the same rule the activate form follows.
        keepQ = shelfFilterQs(shelfFilter(form.get("dj"), form.get("svc"), form.get("q")));
        const r = String(form.get("return") ?? "").trim();
        if (house(env).djs[r] || (r === "archive" && house(env).archive)) back = r;
      } catch { /* not a form body */ }
      if (!slug || !/^[a-z0-9-]{1,64}$/.test(slug)) {
        return refuse(400, "No set was named, or the name was not one of ours.");
      }

      const kv = programsKV(env);
      let rec = null;
      // A read that FAILED is not a page that is absent. Reporting "removed"
      // for an unreadable record claims a deletion nobody performed, and the
      // page it names is still up.
      let readFailed = false;
      try { rec = await kv.get(`program:${slug}`, { type: "json" }); }
      catch { readFailed = true; }
      let outcome;
      if (readFailed) {
        outcome = "removefail";
      } else if (!rec) {
        // Already gone is the outcome the page wanted, so it is not a failure.
        outcome = "removed";
      } else {
        // Every shape since 2026-09-13 (the owner: "add a delete button for
        // those too"). A written programme goes the way unpublish_program
        // takes it — a pointer at it, then its record — and a request it was
        // kept from is settled as a setlist's is.
        // Cleanup FIRST, the irreversible delete LAST. Everything before the
        // delete is retryable; once the record is gone, its playlist id and
        // request id go with it and nothing can finish the job — a failure
        // half way through the old order left a dead pointer and a card
        // linking a 404 with no way back to either.
        let cleaned = true;
        try {
          if (rec.playlistId) {
            const cur = await kv.get(`current:${rec.playlistId}`);
            if (cur === slug) await kv.delete(`current:${rec.playlistId}`);
          }
        } catch { cleaned = false; }
        if (cleaned && rec.requestId && env.STATION) {
          try {
            const cleared = await station(env, "keep-removed", { id: rec.requestId });
            // A row that retention has already pruned is as clean as it can
            // get. Counting that as a failure would make exactly the entries
            // this control exists for — kept pages that outlived their
            // 90-day request row — permanently undeletable.
            if (!cleared?.ok && cleared?.code !== "unknown-request") cleaned = false;
          } catch { cleaned = false; }
        }
        if (!cleaned) {
          outcome = "removefail";
        } else {
          // A failure HERE leaves the page up with its pointer and its row
          // link already cleared: the page reads as off the button (cosmetic,
          // and the next write there fixes it) and the card loses its delete
          // while the shelf keeps one. Accepted rather than compensated —
          // pressing it again converges, because both cleanups are no-ops the
          // second time, and unwinding two KV writes is more machinery, with
          // its own failure modes, than a self-healing state is worth.
          try { await kv.delete(`program:${slug}`); outcome = "removed"; }
          catch { outcome = "removefail"; }
        }
      }
      const to = back ? `/buttons/${key}/${back}` : base;
      return new Response(null, {
        status: 303,
        headers: { location: `${to}?put=${outcome}${back ? "" : keepQ}`, "cache-control": "no-store" },
      });
    }

    // Undo the load that just happened. Same key, same origin rule, same POST
    // discipline as the chooser — a GET here would be fired by a prefetcher and
    // would silently roll a button back.
    const undo = url.pathname.match(/^\/(notes)\/([A-Za-z0-9_-]{8,128})\/undo$/);
    if (undo) {
      const key = env.PROGRAM_LIBRARY_KEY;
      if (!key || !sameSecret(undo[2], key)) return notFound();
      const base = `/${undo[1]}/${key}`;
      if (request.method !== "POST") {
        return new Response("This is the undo form's target and only accepts POST.\n", {
          status: 405,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const origin = request.headers.get("origin");
      if (origin && origin !== "null" && origin !== url.origin) {
        return new Response(`Submitted from ${origin}, not ${url.origin}.\n`, {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }

      let snapshot = "";
      let dj = "", findKeep = null;
      let back = "", loaded = "";
      try {
        const form = await request.formData();
        snapshot = String(form.get("snapshot") ?? "").trim();
        const d = String(form.get("dj") ?? "").trim();
        if (/^[a-z0-9-]{1,64}$/.test(d)) dj = d;
        findKeep = shelfFind(form.get("q"));
        // Same rule as the chooser: a DJ's name, never a path.
        const r = String(form.get("return") ?? "").trim();
        if (house(env).djs[r] || (r === "archive" && house(env).archive)) back = r;
        const l = String(form.get("loaded") ?? "").trim();
        if (/^[a-z0-9-]{1,64}$/.test(l)) loaded = l;
      } catch { /* not a form body */ }

      const budget = { remaining: 40 };
      let flash;
      // The set this Undo was offered for must still be the one on that
      // playlist; another load since means the backup is older than what it
      // would replace (the review, 2026-10-09). KV only.
      let stale = false;
      if (loaded) {
        try {
          const snap = await programsKV(env).get(snapshot, { type: "json" });
          const now = snap?.playlistId ? await programsKV(env).get(`current:${snap.playlistId}`) : null;
          stale = !!now && now !== loaded;
        } catch { stale = false; }
      }
      if (stale) flash = "undostale";
      else try {
        const out = await undoToSnapshot(env, snapshot, budget);
        flash = out.ok ? `undone:${out.tracks}`
          : out.rolledBack === false ? "undopart" : "undofail";
      } catch (err) {
        // Same reasoning as the chooser: the causes are all legitimate and none
        // of them belong on a page anyone with the link can load — but for the
        // guest being written for a request (MC-18), which says so.
        flash = err?.guestBusy
          ? `undobusy:${err.guestBusy.dj ?? ""}:${err.guestBusy.catalog}` : "undofail";
      }
      const to = back ? `/buttons/${key}/${back}` : base;
      return new Response(null, {
        status: 303,
        headers: {
          location: `${to}?put=${encodeURIComponent(flash)}${
            dj && !back ? `&dj=${encodeURIComponent(dj)}` : ""}${
            findKeep && !back ? `&q=${encodeURIComponent(findKeep)}` : ""}`,
          "cache-control": "no-store",
        },
      });
    }

    // The secret lives in the path so the URL alone is the credential —
    // claude.ai custom connectors cannot reliably set custom headers. A bearer
    // token is accepted too, for clients that can.
    const expected = env.MCP_SECRET;
    // No key yet (a new house before its claim made one): no door, the same
    // 404 as a wrong guess.
    if (!expected) return notFound();
    const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const ownerOk = sameSecret(url.pathname, `/mcp/${expected}`) ||
      (url.pathname === "/mcp" && sameSecret(bearer, expected));
    // The agent's key opens the same door onto a smaller room. Checked after
    // the owner's so a misconfigured AGENT_SECRET equal to MCP_SECRET reads
    // as the owner, never the other way; absent means the agent path simply
    // does not exist, same 404 as any wrong guess.
    const agentKey = env.AGENT_SECRET;
    const agentOk = !ownerOk && !!agentKey &&
      (sameSecret(url.pathname, `/mcp/${agentKey}`) ||
        (url.pathname === "/mcp" && sameSecret(bearer, agentKey)));
    if (!ownerOk && !agentOk) return notFound();
    const role = ownerOk ? "owner" : "agent";

    if (request.method !== "POST") {
      // No server-initiated messages, so the GET/SSE stream has nothing to say.
      return new Response("method not allowed", { status: 405 });
    }

    let msg;
    try {
      msg = await request.json();
    } catch {
      return Response.json(rpcError(null, -32700, "parse error"), { status: 400 });
    }

    const batch = Array.isArray(msg) ? msg : [msg];
    // The setup checklist ticks "Claude app" and the curator from this.
    noteSeen(env, ctx, role === "owner" ? "connector" : "curator");
    // The curator checking in (stampCurator): every run starts here.
    if (role === "agent" && batch.some((m) => m?.method === "tools/call" && m?.params?.name === "list_requests")) {
      await stampCurator(env);
    }
    // Subrequests are budgeted per Worker invocation, not per tool call, and a
    // batch runs many calls inside one. 40 of the free plan's 50 leaves room
    // for a token refresh and the ordinary one-off calls.
    const budget = { remaining: 40 };
    const replies = [];
    const headerVersion = request.headers.get("mcp-protocol-version");
    for (const m of batch) {
      // Notifications have no id and take no response.
      if (m.id === undefined || m.id === null) continue;
      replies.push(await handleRpc(env, m, budget, role, requestVersion(m, headerVersion)));
    }
    if (!replies.length) return new Response(null, { status: 202 });
    // A version this door does not speak is a 400 in the modern era, so a
    // client can tell a modern server from a legacy one by its body.
    const refused = !Array.isArray(msg) && replies[0]?.error?.code === -32022;
    return Response.json(Array.isArray(msg) ? replies : replies[0], { status: refused ? 400 : 200 });
}
