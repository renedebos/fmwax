/**
 * music-control MCP server — Spotify curation and Connect playback, over HTTP.
 *
 * The point of this server is `play_uris`: it accepts an explicit, ordered list
 * of track URIs that Claude chose. Spotify's own engine is popularity-weighted
 * and cannot express "skip the hits" or "the 1971-73 material", so the curation
 * happens in the model and Spotify is only the catalog and the speaker.
 *
 * Transport: MCP Streamable HTTP (JSON-RPC 2.0 over POST). No dependencies.
 */

import { houseDay } from "./voice.js";
import { ARCHIVE_WINDOW, STATION_KEY, stationWindow } from "./archive.js";
import {
  endlessAssign, endlessBar, endlessJobs, endlessLaneTakeover, endlessLeft, endlessLoad,
  endlessReport, endlessSlots, endlessStartFresh, endlessTrim,
  endlessUpdate, endlessWatch, laneLock, laneUnlock, parseEndless, playEndless, tabState,
} from "./endless.js";
import {
  anyLiveGuest, askDay, atWords, destinationFor, djPlaces, djSlotsExist, findDj,
  guestFor, guestForPlaylistId, guestHolders, house, houseClockWords, legacyAliasFor,
  liveGuests, loadedWords, parseButtons, presetOnFile, sinceWords,
} from "./house.js";
import { pickFor } from "./now.js";
import {
  listSnapshots, replacePlaylistSafely, snapKey, snapshotPlaylist, undoToSnapshot,
} from "./playlists.js";
import { parseRoomDevices } from "./room.js";
import { handleRequest } from "./routes.js";
import {
  THROTTLE_KEY, cachedAccess, deviceDisplayName, flushKvTally, flushSpotifyTally,
  getAccessToken, parseAliases, placeOf, reachableDj, resolveDevice, setService,
  stampThrottle, throttledUntil,
} from "./services.js";
import {
  flashFor, pickCover, pickImage, programCatalog, shelfUnplaceable, trackRecord,
} from "./shelf.js";
import {
  PROGRAM_TOOLS, TOOLS, TOOL_META, VOICE_TOOLS, toolsWithMeta, voiceFunctions, writerKindFor,
} from "./toollist.js";
import { callTool } from "./tools.js";
import { refireWaiting } from "./writes.js";
import { houseClaimed, withSettings } from "./settings.js";

// The request claim ledger's class must be exported from the entry module or
// the Durable Object binding has nothing to instantiate. The Worker's own use
// of it arrives with the request pipe; the export alone costs nothing.
export { StationLedger } from "./station.js";
// And the house's settings (MC-31, settings.js), for the same reason.
export { HouseSettings } from "./settings.js";

// Internals reached by mcp/test/*.test.js. Workers only ever loads the default
// export, so this costs the deployed server nothing — and the alternative is
// leaving the destructive-write path, which exists specifically to survive
// failures, tested only by hand against live playlists.
export const __test = {
  getAccessToken,
  // A fresh isolate, for the token tests: nothing cached in memory.
  forgetAccessTokens: () => { for (const k of Object.keys(cachedAccess)) delete cachedAccess[k]; },
  pickFor, callTool, snapshotPlaylist, replacePlaylistSafely,
  listSnapshots, snapKey, resolveDevice, pickCover, pickImage,
  undoToSnapshot, deviceDisplayName, house, parseButtons, findDj, parseAliases,
  reachableDj, shelfUnplaceable,
  stationWindow, STATION_KEY, ARCHIVE_WINDOW,
  guestFor, guestForPlaylistId, legacyAliasFor, anyLiveGuest, flashFor, refireWaiting,
  setService, destinationFor, placeOf, liveGuests,
  houseClockWords, sinceWords, loadedWords, atWords, askDay, guestHolders, djPlaces, djSlotsExist,
  trackRecord, writerKindFor, PROGRAM_TOOLS, programCatalog,
  VOICE_TOOLS, voiceFunctions, parseRoomDevices, tabState,
  endlessBar, endlessStartFresh, houseDay, endlessAssign,
  endlessLaneTakeover, endlessLoad, endlessUpdate, endlessSlots, presetOnFile, playEndless, laneLock, laneUnlock, endlessTrim,
  THROTTLE_KEY, stampThrottle, throttledUntil,
  endlessWatch, endlessReport, parseEndless, endlessLeft, endlessJobs,
  TOOLS, TOOL_META, toolsWithMeta,
};

export default {
  // The counter wraps every request rather than living inside it: there are
  // dozens of return points below and a tally flushed at only some of them
  // would under-report exactly the paths that matter.
  async fetch(request, env, ctx) {
    // One tally per request, on a COPY of env: an isolate serves many requests
    // at once and a shared Map would mix them together.
    env = { ...env, __kvTally: new Map(), __spotifyTally: new Map() };
    try {
      // The house's settings from its own store (MC-31, settings.js), the
      // vars underneath, once the house is claimed (before that the store is
      // left for the claim to place). Not for the health check and the faces,
      // which read no setting. The tallies ride along: the copy keeps the
      // same Maps.
      const path = new URL(request.url).pathname;
      if (path !== "/health" && await houseClaimed(env)) env = await withSettings(env, ctx);
      return await handleRequest(request, env, ctx);
    } finally {
      // After the response, never in front of it. A counter that adds latency
      // to a page load has bought the wrong thing.
      const flush = Promise.all([flushKvTally(env), flushSpotifyTally(env)]);
      if (ctx?.waitUntil) ctx.waitUntil(flush);
      else await flush;
    }
  },
  // The schedule: the endless DJ's watch (MC-22), every ten minutes. Every
  // call counted like any other.
  async scheduled(controller, env) {
    env = { ...env, __kvTally: new Map(), __spotifyTally: new Map() };
    const at = controller?.scheduledTime ?? Date.now();
    try {
      // The settings store only once the house is claimed (claim.js): it is
      // placed near its first caller, and the cron, run from anywhere, must
      // not be that caller.
      if (await houseClaimed(env)) env = await withSettings(env, null);
      await endlessWatch(env, at);
    } finally {
      await Promise.all([flushKvTally(env), flushSpotifyTally(env)]);
    }
  },
};
