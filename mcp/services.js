// THE SERVICES: the subrequest budget and the call meters, Spotify's and Tidal's
// tokens and calls, the player read and its memo, the house's catalogs, speakers
// by name, playlist reads, KV counting, and Spotify's quota note.
// Split out of worker.js on 2026-09-26 (consolidation).
import { PERSONAS } from "./djs.js";
import { CATALOGS, catalogOfUri, unreachable } from "./catalog.js";
import { spotifyCatalog, playlistIdFrom } from "./spotify.js";
import { tidalCatalog, playlistIdFrom as tidalPlaylistIdFrom } from "./tidal.js";
import { station, stationStub } from "./station.js";
import { destinationFor, guestAlias, guestPhrase, house } from "./house.js";

export const SPOTIFY_API = "https://api.spotify.com/v1";
export const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";
export const TIDAL_API = "https://openapi.tidal.com/v2";
export const TIDAL_TOKEN = "https://auth.tidal.com/v1/oauth2/token";

// -------------------------------------------------------------- subrequests

// EVERY outbound request counts against Cloudflare's 50-per-invocation ceiling
// — the token refresh and the archive JSON as much as a Spotify call — so they
// all go through here. The budget used to be debited at call sites and half of
// them did not: 29 places called Spotify and 15 debited, which made "40
// remaining" roughly half the truth. Counting at the one choke point cannot be
// forgotten by a new call site, and the prechecks can only refuse work honestly
// because this number is now real.
//
// Refusing is safe UNTIL the first write goes out and unsafe after it. Before
// then, stopping costs a retry; after it, stopping leaves a playlist half
// written and a backup that nothing has been told about — worse than the
// platform's own failure. So `budget.critical` is set at the point of no return
// and enforcement stops there. `critical: true` marks the calls that must never
// be refused even before that, because everything downstream needs them.
//
// Counting alone was not enough: a 30-query search whose queries each retry can
// pass 50 while the precheck that admitted it was reading a number that only
// ever went down by ones.
//
// EXTERNAL requests only, and that is deliberate. The free plan has two separate
// ceilings — 50 external subrequests and 1,000 to Cloudflare services — so KV
// reads and writes are subrequests but they are not THESE subrequests. Debiting
// them here would refuse real work at a fortieth of their actual allowance. This
// Worker does not come close to 1,000 KV operations in an invocation, so that
// bucket needs no guard.
// https://developers.cloudflare.com/workers/platform/limits/#subrequests
// The ONE way a budget gets attached. Any entry point that accepts a budget must
// go through this, or the budget it was handed is decorative — which is exactly
// the failure this whole change exists to fix, and it reappeared here once: a
// direct call to replacePlaylistSafely spent five subrequests and debited none,
// because only callTool was scoping env.
//
// A copy, not a mutation: env is shared across concurrent requests in a Worker
// isolate, so a counter on the shared object would be everyone's counter.
export function withBudget(env, budget) {
  return budget && env.__budget !== budget ? { ...env, __budget: budget } : env;
}

export async function subrequest(env, input, init, { critical = false } = {}) {
  const b = env?.__budget;
  if (b) {
    if (!critical && !b.critical && b.remaining <= 0) {
      const err = new Error(
        "out of per-invocation subrequest budget — Cloudflare allows 50 and this " +
        "server stops at 40 to leave room to finish. NOTHING WAS WRITTEN. Make " +
        "this call on its own rather than after a large search.");
      // Marked, because a caller that catches broadly around a probe would
      // otherwise turn "we ran out" into a claim about the thing being probed.
      err.budgetExhausted = true;
      throw err;
    }
    b.remaining -= 1;
  }
  await countSpotifyCall(env, init?.method ?? "GET", input);
  return fetch(input, init);
}

// THE COUNTER (2026-09-06). Spotify's development-mode quota is a number it
// does not publish, and the only way to learn where it is — and how close a
// normal day gets — is to count our own calls. Every call to api.spotify.com
// or accounts.spotify.com is tallied in the station object by the hour and
// by kind. A Durable Object call is an internal subrequest (a thousand an
// invocation, not the fifty the budget guards), and it is a few
// milliseconds; it is awaited so a count is never lost to the end of the
// invocation, and it is never allowed to fail the call it counts.
export function callCategory(method, pathname) {
  const p = pathname.replace(/^\/v1/, "");
  if (p.startsWith("/api/token")) return "token";
  if (p.startsWith("/me/player") || p === "/me/devices") return "player";
  if (p.startsWith("/search")) return "search";
  if (p.startsWith("/tracks")) return "tracks";
  if (p.startsWith("/playlists")) return method === "GET" ? "read" : "write";
  return "other";
}
// Counted IN MEMORY and handed over once after the response (the owner,
// 2026-09-12: "startup is quite slow" — every Spotify call had waited on a
// round trip to the ledger first, twenty-odd of them on a cold wall). The
// same shape as the KV tally; a request with no tally map (a test that
// built its own env) counts nothing.
export function countSpotifyCall(env, method, input) {
  let url;
  try { url = new URL(String(input instanceof Request ? input.url : input)); } catch { return; }
  if (url.hostname !== "api.spotify.com" && url.hostname !== "accounts.spotify.com") return;
  const tally = env?.__spotifyTally;
  if (!tally) return;
  const category = callCategory(method, url.pathname);
  tally.set(category, (tally.get(category) ?? 0) + 1);
}
export async function flushSpotifyTally(env) {
  const tally = env?.__spotifyTally;
  if (!tally || !tally.size || !env.STATION) return;
  const ops = [...tally].map(([category, n]) => [category, n]);
  tally.clear();
  try { await station(env, "count-many", { ops }); } catch { /* a count is never worth a failed call */ }
}
export async function recordQuotaHit(env, { retryAfter, method, path, reason }) {
  if (!env?.STATION) return;
  try {
    await stationStub(env).fetch("https://station/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "quota-hit", args: {
        retryAfter, category: callCategory(method, path), reason } }),
    });
  } catch { /* the note in KV is the one that matters */ }
}
// What the Speakers page and list_requests show: the last twenty-four hours
// by kind, the twenty-four before as a comparison, the busiest hour of the
// two days, and every refusal Spotify has given for quota.
export const CALL_KINDS = ["player", "read", "write", "search", "tracks", "token", "other"];
export const PLAYER_SAVED = "player-saved";
export async function spotifyCalls(env, now = Date.now()) {
  if (!env?.STATION) return null;
  let out;
  try {
    out = await (await stationStub(env).fetch("https://station/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "calls", args: {} }),
    })).json();
  } catch { return null; }
  if (!out?.ok) return null;
  const hourOf = (h) => Date.parse(`${h}:00:00Z`);
  const last = { total: 0, by: Object.fromEntries(CALL_KINDS.map((k) => [k, 0])), saved: 0 };
  const prev = { total: 0 };
  const perHour = new Map();
  for (const r of out.hours) {
    const at = hourOf(r.hour);
    const n = Number(r.n) || 0;
    // Answers the pages got without a call (MC-29): counted beside the calls,
    // never among them.
    if (r.category === PLAYER_SAVED) {
      if (at >= now - 24 * 60 * 60 * 1000) last.saved += n;
      continue;
    }
    if (at >= now - 24 * 60 * 60 * 1000) {
      last.total += n; last.by[CALL_KINDS.includes(r.category) ? r.category : "other"] += n;
    } else if (at >= now - 48 * 60 * 60 * 1000) {
      prev.total += n;
    }
    perHour.set(r.hour, (perHour.get(r.hour) ?? 0) + n);
  }
  let busiest = null;
  for (const [hour, n] of perHour) if (!busiest || n > busiest.n) busiest = { hour, n };
  return { last, prev, busiest, hits: out.hits ?? [] };
}

// What the KV allowance actually went on, in the last day and the day before.
// Writes, deletes and lists share a thousand a day and reads have a hundred
// thousand, so they are reported apart: one number is a budget and the other
// is noise.
export async function kvOps(env, now = Date.now()) {
  if (!env?.STATION) return null;
  let out;
  try {
    out = await (await stationStub(env).fetch("https://station/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "kv-ops", args: {} }),
    })).json();
  } catch { return null; }
  if (!out?.ok) return null;
  const hourOf = (h) => Date.parse(`${h}:00:00Z`);
  // Writes, deletes and lists are three allowances of a thousand each, not
  // one shared thousand (Cloudflare's pricing page, read 2026-09-23), so
  // each is counted on its own too.
  const day = { reads: 0, billed: 0, put: 0, delete: 0, list: 0, by: new Map() };
  const prev = { reads: 0, billed: 0 };
  for (const r of out.hours ?? []) {
    const at = hourOf(r.hour);
    const n = Number(r.n) || 0;
    const read = r.op === "get";
    const bucket = at >= now - 24 * 60 * 60 * 1000 ? day
      : at >= now - 48 * 60 * 60 * 1000 ? prev : null;
    if (!bucket) continue;
    if (read) bucket.reads += n; else bucket.billed += n;
    if (bucket === day && !read && r.op in day) day[r.op] += n;
    // The breakdown is of the BILLED side only. A list of what the reads went
    // on would be the longest table on the page and the least useful.
    if (!read && bucket === day) {
      day.by.set(r.category, (day.by.get(r.category) ?? 0) + n);
    }
  }
  return {
    day: { reads: day.reads, billed: day.billed, put: day.put, delete: day.delete, list: day.list,
      by: [...day.by].sort((a, b) => b[1] - a[1]).slice(0, 8) },
    prev: { reads: prev.reads, billed: prev.billed },
  };
}

// ------------------------------------------------------------------ tokens

// One account per service, and the same shape of credential for each: a
// public PKCE client id and a refresh token, the token kept in KV under the
// service's name once it has been used and seeded from a bootstrap secret the
// first time. Spotify rotates the refresh token on every use and Tidal keeps
// the same one for months (tidal/probe.py); one path serves both because it
// persists whatever the service hands back.
export const SERVICES = {
  spotify: { tokenUrl: SPOTIFY_TOKEN, clientId: "SPOTIFY_CLIENT_ID", refresh: "SPOTIFY_REFRESH_TOKEN" },
  tidal: { tokenUrl: TIDAL_TOKEN, clientId: "TIDAL_CLIENT_ID", refresh: "TIDAL_REFRESH_TOKEN" },
};

// Isolate-level cache, so a warm Worker skips the KV read. Isolates recycle
// freely; KV is the durable copy.
export const cachedAccess = {}; // service -> { token, expiresAt }

export async function loadTokens(env, service) {
  const stored = await tokensKV(env).get(service, { type: "json" });
  if (stored?.refresh_token) return stored;
  // First run: seed durable storage from the bootstrap secret.
  const { refresh } = SERVICES[service];
  if (!env[refresh]) {
    throw new Error(`no ${service} refresh token in KV and ${refresh} is unset — see mcp/README.md`);
  }
  return { refresh_token: env[refresh] };
}

// Concurrent lanes must not each start their own refresh: PKCE rotates the
// refresh token, so six simultaneous refreshes are six racing KV writes.
export const refreshInFlight = {}; // service -> promise

// THE ACCESS TOKEN IS KEPT IN KV TOO (2026-09-23). It lived only in the
// isolate, so every fresh isolate refreshed — a call to the service and a KV
// write of the rotated refresh token each time: 137 writes in a day of
// testing against the thousand the free tier allows, for a token that lasts
// an hour. A fresh isolate now takes the stored one while it has a minute
// left, which costs a KV read, the plentiful kind.
export async function getAccessToken(env, service = "spotify") {
  const have = cachedAccess[service];
  if (have && have.expiresAt > Date.now() + 30_000) return have.token;
  if (!refreshInFlight[service]) {
    refreshInFlight[service] = (async () => {
      const stored = await loadTokens(env, service);
      const at = Number(stored.expires_at);
      if (stored.access_token && at > Date.now() + 60_000) {
        cachedAccess[service] = { token: stored.access_token, expiresAt: at };
        return stored.access_token;
      }
      return refreshAccessToken(env, service, stored);
    })().finally(() => { refreshInFlight[service] = null; });
  }
  return refreshInFlight[service];
}

export async function refreshAccessToken(env, service, stored = null, retried = false) {
  const svc = SERVICES[service];
  const tokens = stored ?? await loadTokens(env, service);
  // SIGNED OUT (MC-31 stage 0b): a refused login is not asked again while it
  // is still the one held — every call would be one more refusal from
  // Spotify. A new login, by Reconnect or by the terminal, is a different
  // token and is tried.
  const out = service === "spotify" ? await signedOutNote(env) : null;
  if (out?.rt && out.rt === await tokenMark(tokens.refresh_token)) throw signedOutError(out);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: env[svc.clientId],
  });
  // Never refused: without a token nothing downstream can finish OR roll back.
  const r = await subrequest(env, svc.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, { critical: true });
  if (!r.ok) {
    // ANOTHER ISOLATE MAY HAVE JUST REFRESHED (2026-09-23, from a Codex
    // review lead): two isolates that both find the token expired both
    // refresh, and the service rotates the refresh token, so the slower one
    // can be holding a token that no longer works. Before calling it a lost
    // login, read the store again: a newer access token is used as it is, and
    // a newer refresh token is tried once.
    const text = await r.text();
    if (!retried) {
      let now = null;
      try { now = await loadTokens(env, service); } catch { now = null; }
      if (now?.refresh_token && now.refresh_token !== tokens.refresh_token) {
        const at = Number(now.expires_at);
        if (now.access_token && at > Date.now() + 60_000) {
          cachedAccess[service] = { token: now.access_token, expiresAt: at };
          return now.access_token;
        }
        return refreshAccessToken(env, service, now, true);
      }
    }
    // The six-month end (since 2026-07-20), or a login revoked on Spotify's
    // side: 400 invalid_grant, and nothing but a new sign-in mends it. Noted
    // for the pages and the tools, which say so in place of failing quietly.
    if (service === "spotify" && r.status === 400 && /invalid_grant/.test(text)) {
      throw signedOutError(await stampSignedOut(env, tokens.refresh_token, text));
    }
    throw new Error(
      `${service} token refresh failed: ${r.status} ${text} — re-run login ` +
      `locally and push a fresh ${svc.refresh}`);
  }
  const fresh = await r.json();
  // PKCE rotates refresh tokens. Persist the new one or the next call breaks.
  const refresh_token = fresh.refresh_token || tokens.refresh_token;
  const expiresAt = Date.now() + (fresh.expires_in ?? 3600) * 1000;
  // A RECONNECT WHILE THIS REFRESH WAS ON THE WIRE (MC-31 stage 0b). Writing
  // the old login's rotated token over the new one would put the house back
  // on the login that is about to end, under the new one's date. A record
  // stamped with a different sign-in is left as it is.
  if (service === "spotify") {
    let cur = null;
    try { cur = await tokensKV(env).get(service, { type: "json" }); } catch { cur = null; }
    if (cur?.login_at && cur.login_at !== tokens.login_at) {
      const at = Number(cur.expires_at);
      cachedAccess[service] = cur.access_token && at > Date.now() + 60_000
        ? { token: cur.access_token, expiresAt: at } : { token: fresh.access_token, expiresAt };
      return cachedAccess[service].token;
    }
  }
  // The sign-in's date and account ride along (`login_at`, `account`).
  const { access_token: _a, expires_at: _e, refresh_token: _r, ...kept } = tokens;
  await tokensKV(env).put(service, JSON.stringify({ ...kept, refresh_token, access_token: fresh.access_token, expires_at: expiresAt }));
  if (out) await clearSignedOut(env);
  cachedAccess[service] = { token: fresh.access_token, expiresAt };
  return cachedAccess[service].token;
}

// Spotify's /me/player returns `item: null` for a podcast episode unless it is
// asked for episodes explicitly. Without this the server reports an empty room
// while a podcast plays — confirmed 2026-08-26 with an episode inside a
// playlist, where the WiiM said mode 31 / status play and now_playing said
// nothing was on. Every read of player state must go through here.
// How long a page will wait for "what is playing" before rendering without it.
// Set well ABOVE a normal answer rather than at it: the fallback is honest
// (`roomPlaying`'s unknown state prints "what is playing is unknown from here,
// which is not the same as quiet"), so firing costs only a true line — but it
// costs a REAL one, and a deadline tight enough to trip on a merely slow
// Spotify would spend most of its firings hiding something the page knew.
export const PLAYER_DEADLINE_MS = 1200;
// DRAW FIRST (the owner, 2026-09-12: "draw page first and fill now playing
// line a moment later"). The presets page gives the player this long; if
// Spotify has not answered by then the page goes out without it and its
// script asks /buttons/<key>/playing, which the read still in flight answers.
export const WALL_PLAYER_WAIT_MS = 250;
export const PLAYER_PENDING = Symbol("player pending");
// THE HOUSE'S KEPT SPOTIFY ANSWER (MC-29, tasks/done/mc29-helper-first-player.md).
// Every player read is kept in the ledger, stamped with when it started, so
// the pages can be handed it while the home helper says nothing on the WiiMs
// changed (housePlayer, now.js). Before it there was only the ten-second
// memo per isolate below, which rarely warmed across pages in production.
//
// Forgotten after every playback write, in spotify() below, and after a
// helper key press; reads that start in the settling seconds after one are
// not kept, because Spotify can still answer from before the write.
export const PLAYER_SETTLE_MS = 10_000;
export function keptShape(st) {
  if (!st || typeof st !== "object" || !st.item) return st ?? null;
  const item = { ...st.item };
  delete item.available_markets;
  if (item.album) { item.album = { ...item.album }; delete item.album.available_markets; }
  return { ...st, item };
}
export async function keepPlayer(env, at, st) {
  if (!env?.STATION) return;
  try { await station(env, "player-put", { at, st: keptShape(st) }, { unbudgeted: true }); } catch { /* a kept answer is never worth a failed read */ }
}
export async function forgetPlayer(env) {
  const k = env?.STATION ?? env?.PROGRAMS;
  if (k && typeof k === "object") PLAYER_MEMO.delete(k);
  if (!env?.STATION) return;
  try { await station(env, "player-forget", { until: Date.now() + PLAYER_SETTLE_MS }, { unbudgeted: true }); } catch { /* the caps still bound it */ }
}
// And within one isolate, the read itself for ten seconds, in flight or
// done: the presets page goes out before a slow Spotify answers and asks
// /playing at once, and the read still in flight answers it. Cleared with
// the kept answer; a read that fails leaves nothing behind.
export const PLAYER_MEMO = new WeakMap();
export const PLAYER_MEMO_MS = 10_000;
export function rememberPlayer(env, promise) {
  const k = env?.STATION ?? env?.PROGRAMS;
  if (!k || typeof k !== "object") return;
  PLAYER_MEMO.set(k, { at: Date.now(), promise });
  promise.catch(() => { if (PLAYER_MEMO.get(k)?.promise === promise) PLAYER_MEMO.delete(k); });
}
export function recalledPlayer(env) {
  const k = env?.STATION ?? env?.PROGRAMS;
  const m = k && typeof k === "object" ? PLAYER_MEMO.get(k) : null;
  return m && Date.now() - m.at < PLAYER_MEMO_MS ? m.promise : null;
}

// A deadline for a read the page can honestly do without. Without it, one slow
// Spotify call holds the whole render — the tracklist, the shelf, the form —
// hostage to the one line that has a printed way of saying it does not know.
// The timer is always cleared: a Worker that leaves one pending is holding a
// promise nothing will settle.
export function withDeadline(promise, ms, fallback) {
  let timer;
  const bell = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  // `promise` is already caught by its caller, so the loser of this race
  // cannot become an unhandled rejection once the bell has won.
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
}

export const PLAYER_TIMED_OUT = Symbol("player-timed-out");

export async function playerState(env, { deadlineMs = 0 } = {}) {
  const startedAt = Date.now();
  // The deadline covers the FETCH and nothing else. Everything below it is KV,
  // best-effort and already caught — and letting it inside would mean a slow
  // cache read could throw away a player state that arrived perfectly well and
  // have the page say Spotify could not be reached, which would be false.
  const ac = deadlineMs ? new AbortController() : null;
  const call = spotify(env, "GET", "/me/player", {
    params: { additional_types: "track,episode" },
    ...(ac ? { signal: ac.signal } : {}),
  });
  let st;
  if (deadlineMs) {
    // Attached before the race, so abandoning the call cannot leave an
    // unhandled rejection behind; the race still awaits the original promise.
    call.catch(() => {});
    st = await withDeadline(call, deadlineMs, PLAYER_TIMED_OUT);
    if (st === PLAYER_TIMED_OUT) {
      ac.abort();
      // Thrown, not returned: every caller that sets a deadline already turns
      // a failure into the honest "not known from here" state, and a timeout
      // is exactly that.
      throw new Error("player state did not answer in time");
    }
  } else {
    st = await call;
  }
  // Every read passes through here, so this is where the WiiM's id-for-a-name
  // fault gets answered — once, rather than at each of the readers downstream.
  // `list_devices` reads a different endpoint and is deliberately left raw:
  // the diagnostic that found this fault has to keep showing it.
  if (st?.device) {
    // A healthy sighting is also the freshest one there is — this runs on page
    // renders and playback alike, where resolveDevice may never be called at
    // all. Without recording it, a speaker renamed while healthy would come
    // back under its OLD name the next time the fault returned.
    await rememberDeviceName(env, st.device.id, st.device.name);
    const shown = await deviceDisplayName(env, st.device);
    if (shown !== st.device.name) st.device = { ...st.device, name: shown };
  }
  // When this was read, for where the song is (the now panel's progress
  // line, 2026-10-13); a kept answer carries it too.
  if (st && typeof st === "object" && st.item) st.readAt = startedAt;
  await keepPlayer(env, startedAt, st);
  return st;
}

export async function spotify(env, method, path, { params, body, raw, signal } = {}) {
  const url = new URL(SPOTIFY_API + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  // `raw` sends bytes as they are, with the content type the caller names —
  // the one Spotify endpoint that is not JSON is the cover upload, which
  // takes a bare base64 JPEG under image/jpeg.
  const r = await subrequest(env, url, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken(env)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(raw ? { "Content-Type": raw.contentType } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(raw ? { body: raw.body } : {}),
    // Only ever set by a caller that has given up waiting. A call abandoned
    // without one keeps an outbound connection — a limited resource here —
    // busy on an answer nobody will read.
    ...(signal ? { signal } : {}),
  });
  // The first successful MUTATION is this invocation's point of no return, and
  // not only for playlist writes: a play PUT has already changed the room. After
  // one, refusing a later call would report "nothing was written" over a change
  // that has happened — and the model retries on that, restarting a queue or
  // rewriting a button. So enforcement stands down for the rest of the
  // invocation and the prechecks carry the weight, which is where refusing was
  // always safe.
  //
  // ABOVE the 204 branch, not below it: Spotify answers 204 to exactly the
  // playback mutations this is here to cover, so setting it after that early
  // return would leave the room changed and the flag unset — the one case that
  // matters. The first version of this sat below, and the test passed because
  // the stub answered 200 where Spotify answers 204.
  if (r.ok && method !== "GET" && env.__budget) env.__budget.critical = true;
  // Any playback write makes the kept answer wrong (MC-29): one place for
  // every play, pause, skip, move, volume and shuffle, the tools' included.
  if (r.ok && method !== "GET" && path.startsWith("/me/player")) await forgetPlayer(env);

  if (r.status === 204) return {};
  const text = await r.text();
  if (!r.ok) {
    const retryAfter = Number(r.headers.get("retry-after")) || 0;
    const err = new Error(`${method} ${path} -> ${r.status} ${text}` +
      (r.status === 429 ? ` (Spotify says retry after ${retryAfter || "an unstated number of"} seconds)` : ""));
    err.status = r.status;
    err.retryAfter = retryAfter;
    if (r.status === 429) {
      await stampThrottle(env, err);
      let reason = null;
      try { const j = JSON.parse(text); reason = j?.error?.reason ?? j?.reason ?? null; } catch { /* a bare 429 */ }
      await recordQuotaHit(env, { retryAfter, method, path, reason });
    }
    throw err;
  }

  // Playback endpoints increasingly answer 200 with a non-JSON body.
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Tidal rations calls: about five in hand and two a second back, and past
// that a 429 with a Retry-After and an empty body (tidal/probe2.py). A
// Worker's round trip is short enough to empty that in a single replace, so
// every Tidal call starts through one lane, half a second after the last —
// which is the refill rate, so a paced Worker never meets the ceiling at all
// (tidal/probe3.py: five runs, no 429). Starts are spaced, not calls: a slow
// answer does not hold the next call back. Overridable for the tests, which
// would otherwise spend real seconds proving the fake answers.
export const TIDAL_GAP_MS = 500;
export let tidalLane = Promise.resolve();
export let tidalNotBefore = 0;

export function tidalTurn(env) {
  const said = Number(env.TIDAL_GAP_MS);
  const gap = env.TIDAL_GAP_MS != null && Number.isFinite(said) && said >= 0 ? said : TIDAL_GAP_MS;
  const turn = tidalLane.then(async () => {
    const wait = tidalNotBefore - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    tidalNotBefore = Date.now() + gap;
  });
  tidalLane = turn;
  return turn;
}

// Tidal speaks JSON:API: `data`, `included`, `relationships`, and errors as a
// list with a code and a detail. Every call carries the country code because
// availability is answered per country and a call without one is refused.
export async function tidal(env, method, path, { params, body } = {}) {
  const url = new URL(TIDAL_API + path);
  url.searchParams.set("countryCode", env.TIDAL_COUNTRY || "NL");
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const send = async () => {
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${await getAccessToken(env, "tidal")}`,
        Accept: "application/vnd.api+json",
        ...(body ? { "Content-Type": "application/vnd.api+json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    await tidalTurn(env);
    return subrequest(env, url, init);
  };
  // Same point of no return as Spotify's, and here the first mutation of a
  // replace is the clear — after which refusing the refill would leave a
  // button empty. Crossed by a write that was not REFUSED, not only by one
  // that succeeded: a 5xx or a lost answer may have done the work
  // (tidal.js, refused()), and what follows is a rollback that the budget
  // must not be allowed to cut short. See spotify() for why this sits above
  // the 204 branch.
  const crossed = () => { if (method !== "GET" && env.__budget) env.__budget.critical = true; };
  let r;
  try {
    r = await send();
    // Two retries and no more, each for an answer that means the call was
    // turned away before any work: a 401 for a token Tidal no longer honours
    // (dropped from the cache, so the resend carries a fresh one, instead of
    // the same refused token for the four hours it has left), and a 429 for
    // the ceiling. Any other failure is either final or — for a write — not
    // safely repeatable: a POST that did land and then failed to answer
    // would put its tracks in twice, because Tidal lets a playlist hold the
    // same track twice. The 429's wait goes on the lane, so a caller behind
    // this one waits it out too instead of walking into the same ceiling.
    if (r.status === 401) {
      cachedAccess.tidal = null;
      r = await send();
    }
    if (r.status === 429) {
      const said = r.headers.get("retry-after");
      const secs = said === null ? 1 : Number(said);
      const after = Math.min(Number.isFinite(secs) && secs >= 0 ? secs : 1, 5) * 1000;
      tidalNotBefore = Math.max(tidalNotBefore, Date.now() + after);
      r = await send();
    }
  } catch (e) {
    // No answer at all — unless the Worker never sent it.
    if (!e.budgetExhausted) crossed();
    throw e;
  }
  if (!(r.status >= 400 && r.status < 500)) crossed();

  if (r.status === 204) return {};
  const text = await r.text();
  if (!r.ok) {
    let first = {};
    try { first = JSON.parse(text)?.errors?.[0] ?? {}; } catch { /* not JSON */ }
    const err = new Error(
      `${method} ${path} -> ${r.status}` +
      (first.code ? ` ${first.code}` : "") + (first.detail ? `: ${first.detail}` : "") +
      (!first.code && !first.detail && text.trim() ? ` ${text.slice(0, 200)}` : ""));
    err.status = r.status;
    err.retryAfter = Number(r.headers.get("retry-after")) || 0;
    err.code = first.code ?? null;
    throw err;
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// The catalog behind a playlist — see catalog.js for the verbs. A name
// parseButtons let through that is neither of these gets the refusal here,
// in one sentence, rather than an undefined verb somewhere down the write
// path.
//
// Player calls do NOT go through this: Connect playback is Spotify's alone.
export function catalogFor(env, name) {
  if (name === "spotify") {
    return spotifyCatalog((method, path, opts) => spotify(env, method, path, opts));
  }
  if (name === "tidal") {
    return tidalCatalog((method, path, opts) => tidal(env, method, path, opts));
  }
  throw unreachable(name);
}

// The catalog a resolved playlist lives on. `catalog` is set by
// resolvePlaylist; a playlist object that lacks it was hand-built from a
// Spotify id — the tests' fixtures, and nothing in the request path.
export function catalogOf(env, pl) {
  return catalogFor(env, pl?.catalog ?? "spotify");
}

// The catalogs the house's buttons are on, distinct, in button order. An
// empty house is Spotify's, which is where its account is.
export function houseCatalogNames(env) {
  const names = [...new Set(
    house(env).buttons.filter((b) => !b.archive).map((b) => b.catalog))];
  return names.length ? names : ["spotify"];
}

// The catalog a request means when it names no playlist — a search, a new
// playlist, a program for a DJ with no button. The one the caller said, if
// it said; else the one every button in the house is on. A house on two
// services is refused rather than guessed at, because the one wrong guess is
// a Tidal id handed to Spotify — and the refusal names the argument that
// settles it.
export function houseCatalog(env, said = null) {
  const name = String(said ?? "").trim().toLowerCase();
  if (name) {
    if (!CATALOGS.includes(name)) {
      throw new Error(`catalog "${name.slice(0, 20)}" is not one of ${CATALOGS.join(", ")}`);
    }
    return catalogFor(env, name);
  }
  const names = houseCatalogNames(env);
  if (names.length > 1) {
    throw new Error(
      `this house has buttons on ${names.join(" and ")} — pass catalog: "${names[0]}" ` +
      `or "${names[1]}" to say which`);
  }
  return catalogFor(env, names[0]);
}

// The URIs that are not this catalog's own. A Tidal URI handed to a Spotify
// playlist is not a typo the service catches cleanly: it is a 400 half way
// through a batch, with the first half written. Checked once the playlist is
// known, which is the only moment the right catalog is.
export function foreignUris(cat, uris) {
  return uris.filter((u) => !cat.trackId(u));
}

// A playlist reference as one of the catalogs writes it — a bare id, a
// `<service>:playlist:` URI or a share link — read back to `{ catalog, id }`.
// The two services' id shapes are disjoint (Spotify's is 22 base-62
// characters, Tidal's a UUID), so a reference names its catalog on its own
// and nothing here has to be told which one was meant. Null for anything
// else: a name, a label, a typo.
export const PLAYLIST_PARSERS = { spotify: playlistIdFrom, tidal: tidalPlaylistIdFrom };

export function playlistRef(ref) {
  for (const catalog of CATALOGS) {
    const id = PLAYLIST_PARSERS[catalog](ref);
    if (id) return { catalog, id };
  }
  return null;
}

// Whether a set for this DJ has somewhere to land. The request composer and
// its POST both ask.
//
// EVERY DJ ON THE ROSTER, since 2026-09-10 (MC-11). It asked for a button
// until 2026-09-09, and then for a playlist — and the owner, seeing the crate
// deploy, asked why having one meant asking Claude for it first. It does not
// any more: a DJ with no playlist gets one when their FIRST REQUEST IS
// FULFILLED, not when it is sent. Sending only writes the ask into the
// ledger and never touches a music service, so a Spotify lockout cannot break
// the form, and a request the DJ declines makes nothing. Only an archive DJ is
// out: their recordings are on no service, and their asks go through the
// archive's own page.
export function reachableDj(env, dj) {
  return !!dj && !dj.archiveOnly;
}

// The house's default service for a set that names none: Spotify whenever the
// house has it, because it is the only service anything on this server can
// START. A house on Tidal alone gets Tidal, the only catalog it can reach.
export function guestCatalog(env) {
  const names = houseCatalogNames(env);
  return names.includes("spotify") ? "spotify" : names[0];
}

// THE SERVICE A SET IS FOR (MC-18 stage 3, tasks/done/mc18-guest-presets.md): the
// ask's own choice — only one the form could offer counts — else the set's
// own tracks when they are all on one service, else the house's default,
// Spotify, the one Play reaches (the plan calls it guestCatalog). A live
// guest on the answer takes the set; while that guest is dark, every door
// keeps the service rule it had.
export function setService(env, { asked = null, uris = null } = {}) {
  const said = String(asked ?? "").toLowerCase();
  if (CATALOGS.includes(said) && houseCatalogNames(env).includes(said)) return said;
  const own = [...new Set((uris ?? []).map((u) => catalogOfUri(u)).filter(Boolean))];
  if (own.length === 1) return own[0];
  return guestCatalog(env);
}

// Where a DJ's songs live, in words: their preset when they hold one, their
// own crate when they do not. Every sentence that used to name a button asks
// this instead — "button 5" is simply wrong for a benched DJ with a crate, and
// the difference is one a reader acts on, because only one of the two is a
// thing somebody in the room can press.
// And since MC-18 stage 3, the live guest a set on `cat` goes to, when one is:
// "the Spotify guest (preset 1)".
export function placeOf(env, dj, cat = null) {
  const g = dj && !dj.button ? destinationFor(env, dj, cat).guest : null;
  if (g) return guestPhrase(env, g.playlist);
  return dj?.button ?? "their playlist";
}

// ------------------------------------------------------------------ helpers

// The WiiM drops its friendly name and advertises its raw hex id instead —
// observed twice in one day. While that is true, DEFAULT_DEVICE stops resolving
// and EVERY request that does not name a device fails.
//
// Accepting an id as a name would hide that, which is why it was refused. This
// remembers instead: the id a name resolved to last time is kept, and used only
// when the name has stopped matching AND that id is still present in the device
// list. So the fallback cannot invent a device, it can only recognise one it has
// already seen under that name — and it SAYS the speaker has lost its name
// rather than papering over it.
//
// Returns { id, warning }. `id` is null when no name was asked for.
export async function resolveDevice(env, name) {
  const { devices = [] } = await spotify(env, "GET", "/me/player/devices");
  if (!name) return { id: null, warning: null };
  const needle = name.toLowerCase();
  const byName =
    devices.find((d) => d.name.toLowerCase() === needle) ??
    devices.find((d) => d.name.toLowerCase().includes(needle));

  if (byName) {
    await rememberDevice(env, needle, byName.id, byName.name);
    return { id: byName.id, warning: null };
  }

  const known = await recallDevice(env, needle);
  const stillThere = known && devices.find((d) => d.id === known);
  if (stillThere) {
    // A device stuck publishing its own id never resolves by name again, so
    // the healthy path above will never run for it — and if the fault began
    // before that path learned to record names, nothing anywhere knows what
    // this speaker is called. This is the one remaining place that does: the
    // operator just asked for it by name. Written only when nothing is stored,
    // so a real published name always outranks a word out of a lookup.
    if (stillThere.name === known) {
      await rememberDeviceLabel(env, known, name);
    }
    return {
      id: known,
      warning:
        `No device is called "${name}" right now, but the id it resolved to before ` +
        `(${known}) is still there, advertising itself as "${stillThere.name}". Used ` +
        `it. The speaker is publishing its raw id where its name should be — a WiiM ` +
        `fault that has now survived reboots, a cold power cycle, a Spotify relink ` +
        `and two factory resets, and that publishes the SAME string every time, so ` +
        `do not expect anything done to the speaker to bring the name back. Looking ` +
        `it up by name works off memory until WiiM fixes it.`,
    };
  }

  // Flagged, not just worded. A page that catches this has to tell "the speaker
  // is not there" apart from "Spotify refused the play", and matching on the
  // message would break the moment the message is reworded.
  const err = new Error(
    `no device matching "${name}". Visible: ${devices.map((d) => d.name).join(", ") ||
    "none — the WiiM may be asleep; start anything on it briefly and retry"}`);
  err.noSuchDevice = true;
  err.visible = devices.map((d) => d.name);
  throw err;
}

// Device memory is an optimisation, not a source of truth: every failure here is
// swallowed, because a name that resolves normally must not start erroring
// because KV is unavailable.
export async function rememberDevice(env, needle, id, published) {
  try {
    const kv = env.PROGRAMS;
    if (!kv) return;
    // Read before writing. This runs on every playback call and the id almost
    // never changes; an unconditional put would spend a KV write each time.
    if (await kv.get(`device:${needle}`) !== id) await kv.put(`device:${needle}`, id);
  } catch { /* remembering is best effort */ }
  await rememberDeviceName(env, id, published);
}

// The other direction, for the pages. Name→id is what makes a play land;
// id→name is what lets a line holding only the id say something a person
// recognises. Written from any sighting of a device publishing a REAL name —
// the moment it publishes its own id instead, that id is not a name to
// remember, it is the fault. Latest sighting wins, so a rename propagates.
export async function rememberDeviceName(env, id, published) {
  try {
    const kv = env.PROGRAMS;
    if (!kv || !id || !published || published === id) return;
    if (await kv.get(`device-name:${id}`) === published) return;
    await kv.put(`device-name:${id}`, published);
  } catch { /* remembering is best effort */ }
}

// The same note from a caller that is GUESSING rather than reading: it has the
// word the operator used, not a name the device published.
//
// Under its own key, deliberately. Sharing one key and checking "is anything
// stored yet" is a read-then-write, and KV reads go stale between isolates —
// a lookup racing a healthy sighting could read null, overwrite the real name
// with a fragment like "pro", and leave it there for as long as the device
// stayed faulty. Two keys and a priority at read time cannot lose that race.
export async function rememberDeviceLabel(env, id, label) {
  try {
    const kv = env.PROGRAMS;
    const clean = String(label ?? "").trim().slice(0, 64);
    if (!kv || !clean || clean === id) return;
    if (await kv.get(`device-label:${id}`)) return;
    await kv.put(`device-label:${id}`, clean);
  } catch { /* remembering is best effort */ }
}

// A NAME GIVEN ON THE SETUP PAGE (the trial, 2026-10-17: a new house knows
// nothing of a WiiM that publishes its id for a name, and the fault does not
// clear). The owner's word, so it overwrites a guessed label: shown by the
// pages (deviceDisplayName), and the name a play resolves (recallDevice).
export async function nameDevice(env, id, name) {
  const kv = env.PROGRAMS;
  const clean = String(name ?? "").trim().slice(0, 40);
  if (!kv || !id || !clean) return false;
  // A rename lets go of the old name, where the old name pointed here.
  const old = await kv.get(`device-label:${id}`);
  if (old && old.toLowerCase() !== clean.toLowerCase() && await kv.get(`device:${old.toLowerCase()}`) === id) {
    await kv.delete(`device:${old.toLowerCase()}`);
  }
  await kv.put(`device-label:${id}`, clean);
  await kv.put(`device:${clean.toLowerCase()}`, id);
  return true;
}

export async function recallDevice(env, needle) {
  try {
    return (await env.PROGRAMS?.get(`device:${needle}`)) ?? null;
  } catch {
    return null;
  }
}

// What to call the speaker on a page. Spotify's own name, except when the
// device is publishing its raw id THERE — the measured WiiM fault — in which
// case the last real name it published stands in.
//
// Deliberately narrow. Preferring the remembered name whenever one exists
// would swallow a rename: somebody renames a speaker in the app, and every
// page keeps showing the old name off memory. Only `name === id` substitutes,
// and that is not a state any healthy device is ever in.
export async function deviceDisplayName(env, device) {
  const name = device?.name ?? null;
  if (!name || !device?.id || name !== device.id) return name;
  try {
    // A name the device published outranks a word somebody looked it up by,
    // and the order here is the whole of that rule — no write has to win a
    // race to enforce it. These reads happen only for a faulty device.
    const remembered = (await env.PROGRAMS?.get(`device-name:${device.id}`))
      ?? (await env.PROGRAMS?.get(`device-label:${device.id}`));
    if (remembered) return remembered;

    // Last resort, and the one that covers a fault already in progress: if the
    // usual speaker's name resolves to THIS id, that is its name, derived
    // without either note having been written. Otherwise a page would go on
    // showing hex until somebody happened to start a play from the server.
    const usual = env.DEFAULT_DEVICE;
    if (usual && await recallDevice(env, usual.toLowerCase()) === device.id) return usual;
    return name;
  } catch {
    return name;
  }
}

// Every label a request may use for a playlist, mapped to `{ catalog, id }`:
// the buttons' own labels ("button 3") straight from the house, then the
// free-standing aliases in PLAYLIST_ALIASES — the replay playlist, a scratch
// one — which nothing physical points at. A button's catalog is the house's
// word; an alias's is read off the value's shape (playlistRef), so the replay
// playlist can sit on either service. A value that is no playlist reference
// keeps its label with `id: null` and is refused, in words, by the one call
// that reaches for it — rather than at parse, where it would take every
// other label down with it.
//
// A label is a deployment label, nothing more. The Worker has no LAN path to
// the WiiM, so it cannot see which preset points where — "button 1" is a name
// the operator chose, and re-pointing the physical button silently changes what
// it means. Never imply the server knows the mapping is true.
export function parseAliases(env) {
  const labels = {};
  for (const b of house(env).buttons) {
    if (!b.archive) labels[b.button] = { catalog: b.catalog, id: b.playlist };
    // And a guest under the label that names its service (MC-18), so a set
    // can be aimed at it whatever number it holds.
    if (b.guest) labels[guestAlias(b.catalog)] = { catalog: b.catalog, id: b.playlist };
  }
  if (!env.PLAYLIST_ALIASES) return labels;
  let parsed;
  try {
    parsed = JSON.parse(env.PLAYLIST_ALIASES);
  } catch {
    throw new Error("PLAYLIST_ALIASES is not valid JSON — fix the var in wrangler.toml");
  }
  // A malformed map must not degrade into "no aliases": that turns "replay"
  // into a name search, which can find an unrelated playlist and overwrite it.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PLAYLIST_ALIASES must be a JSON object of label -> playlist id");
  }
  for (const k of Object.keys(parsed)) {
    if (playlistRef(k)) {
      throw new Error(
        `PLAYLIST_ALIASES key "${k}" is a playlist id or URI; keys must be labels, ` +
        "or an explicit id passed to the tool would resolve to something else");
    }
    // The buttons moved to BUTTONS. A leftover here would shadow the house's
    // answer for the same label, and two places to say what button 3 holds is
    // how they come to disagree.
    if (/^button\s*\d+$/i.test(k.trim())) {
      throw new Error(
        `PLAYLIST_ALIASES still has "${k}" — button labels belong in BUTTONS now`);
    }
    // THE GUEST LABELS ARE RESERVED (MC-18), for the same reason: "guest on
    // spotify" is what BUTTONS says the guest is, and an operator alias of
    // that name would take the label over — every write meant for the guest
    // landing on some other playlist (Codex MC18-PLAN-R2-6T1).
    if (/^guest\s+on\s+\S+$/i.test(k.trim())) {
      throw new Error(
        `PLAYLIST_ALIASES has "${k}", which is a guest preset's own label — that ` +
        "belongs to BUTTONS. Pick a name that does not start with \"guest on\".");
    }
    // A DJ'S KEY IS RESERVED, the same rule and for a worse reason (MC-11).
    // A crate is labelled by its owner's key, and `dj.alias` is that key — so
    // an operator alias of the same name would leave `dj.playlist` naming the
    // crate while every write resolving `dj.alias` landed somewhere else
    // entirely, and the crate would drop out of the undo's membership set at
    // the same time. Two places saying what "hank" means is how they come to
    // disagree; refused here, where it can only be a config mistake.
    if (Object.prototype.hasOwnProperty.call(PERSONAS, k.trim())) {
      throw new Error(
        `PLAYLIST_ALIASES has "${k}", which is a DJ's own key — ` +
        "pick a name that is not a DJ.");
    }
    // A LEGACY alias (MC-18) — "was button 1" — names a playlist this house
    // no longer writes to, kept here so its 90-day backups stay restorable:
    // this map is the undo's membership set. The door refuses every other
    // write to it (legacyAliasFor).
    const legacy = /^was\s/i.test(k.trim());
    labels[k] = { ...(playlistRef(parsed[k]) ?? { catalog: null, id: null, raw: String(parsed[k]) }),
      ...(legacy ? { legacy: true } : {}) };
  }
  return labels;
}

// One folding for every name comparison on both sides: NFC so composed and
// decomposed accents match, trimmed so a stray space cannot select a different
// playlist, lowercased. Anything this cannot separate must be refused, not
// guessed at.
export function fold(s) {
  return s.normalize("NFC").trim().toLowerCase();
}

// Returns the description as well as the name. Both come off a read that was
// happening anyway, which is the only reason a snapshot can afford to record
// what the description WAS: fetching it separately would cost a subrequest on
// every destructive write.
export async function playlistMeta(cat, id, context) {
  try {
    const pl = await cat.playlist(id);
    return { name: pl.name, description: pl.description ?? "" };
  } catch (e) {
    // Running out of budget says nothing about this playlist. Re-thrown intact,
    // or the message below would blame a playlist that is perfectly fine — the
    // same way the archive probe used to report a healthy URL as dead.
    if (e?.budgetExhausted) throw e;
    // Deleted, re-pointed, or not ours. Spotify's status for each is not worth
    // guessing at, so treat every failure the same way: stop and name the id.
    throw new Error(`${context} ${id} could not be read (${e.message})`);
  }
}

// `budget` is charged PER PAGE, not as a flat estimate: an account near the
// 1000-playlist cap costs 20 subrequests here, and a flat charge of 3 let a
// later write become the 51st outbound request of the invocation.
export async function ownedPlaylists(cat, budget) {
  const out = [];
  let truncated = false;
  for (let cursor = null; ; ) {
    if (budget && budget.remaining <= 1 && !budget.critical) {
      throw new Error(
        "out of per-request lookup budget while listing playlists — " +
        "call this on its own rather than after a large search");
    }
    const page = await cat.myPlaylists(cursor);
    out.push(...page.playlists);
    cursor = page.next;
    if (cursor === null) break;
    if (out.length >= 1000) { truncated = true; break; }
  }
  // Truncation matters: an unseen duplicate name would make an ambiguous match
  // look unique, and uniqueness is the whole basis for writing.
  return { playlists: out, truncated };
}

// Page through a playlist's contents.
//
// Unreadable entries are kept as null placeholders rather than dropped: their
// positions are what make "#4 of 12" and "how much is left" true, and silently
// compacting them shifts every number after them.
//
// `entries` are the catalog's own per-position handles when it gives them
// (Tidal clears a playlist by them — see catalog.js) and null when it does
// not; a replace that follows this read hands them back so the clear needs
// no second read.
export async function playlistItems(cat, id, budget, cap = 500) {
  const items = [];
  let entries = [];
  let total = null;
  let complete = true;
  for (let cursor = null; ; ) {
    if (items.length >= cap) { complete = false; break; }
    if (budget && budget.remaining <= 0 && !budget.critical) {
      // Past the point of no return this guard has to stand down: the read-back
      // it would refuse is the thing critical mode was added to let finish, and
      // an unconfirmed write is worse than one extra subrequest.
      //
      // Returning a short list as though it were the whole playlist would make
      // every derived number a lie, so refuse rather than under-report.
      if (!items.length) {
        throw new Error(
          "out of per-request lookup budget before reading the playlist — " +
          "make this call on its own rather than batched behind large searches");
      }
      complete = false;
      break;
    }
    const page = await cat.items(id, cursor);
    total = page.total ?? total;
    items.push(...page.tracks);
    if (entries && page.entries?.length === page.tracks.length) entries.push(...page.entries);
    else entries = null;
    cursor = page.next;
    if (cursor === null) break;
  }
  return { items, total: total ?? items.length, complete, entries: complete ? entries : null };
}

export function totalDuration(tracks) {
  const ms = tracks.reduce((n, tr) => n + (tr?.duration_ms || 0), 0);
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
           : `${m}:${String(s % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------- safe playlist writes

// Backups live 90 days. Long enough that "put back what was on the button last
// month" works; short enough that a store nobody prunes does not grow forever.
export const SNAP_TTL_S = 90 * 24 * 3600;

export function kvCategory(key) {
  const k = String(key ?? "");
  const at = k.indexOf(":");
  const head = at > 0 ? k.slice(0, at) : k;
  // A bare key with no prefix is its own category — there are few of them and
  // each is a distinct thing (`tiles`, `spotify`, `tidal`).
  return head.slice(0, 24) || "other";
}
export function countedKV(env, kv) {
  if (!kv || !env.__kvTally) return kv;
  const tally = env.__kvTally;
  const bump = (op, key) => {
    const k = `${op}|${kvCategory(key)}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  };
  return {
    get: (key, opts) => { bump("get", key); return kv.get(key, opts); },
    getWithMetadata: (key, opts) => { bump("get", key); return kv.getWithMetadata(key, opts); },
    put: (key, value, opts) => { bump("put", key); return kv.put(key, value, opts); },
    delete: (key) => { bump("delete", key); return kv.delete(key); },
    list: (opts) => { bump("list", opts?.prefix ?? "all"); return kv.list(opts); },
  };
}

// Hand the tally to the ledger, once, at the end of a request. Never throws:
// a counter that can take a page down is worse than no counter.
export async function flushKvTally(env) {
  const tally = env.__kvTally;
  if (!tally || !tally.size || !env.STATION) return;
  const ops = [...tally].map(([k, n]) => {
    const [op, category] = k.split("|");
    return [op, category, n];
  });
  tally.clear();
  try { await station(env, "kv-count", { ops }); } catch { /* a lost tally is a lost tally */ }
}

// The token store is counted too: the archive's rotation and its m3u live
// there, and they were the first thing suspected.
export function tokensKV(env) {
  return countedKV(env, env.TOKENS);
}

// A house with Last.fm (lastfm.js, 2026-10-18): the owner's free key, a
// secret. Here, below both of its readers.
export const lastfmOn = (env) => typeof env?.LASTFM_KEY === "string" && env.LASTFM_KEY.trim().length >= 16;
// The house looking artists up on MusicBrainz itself (musicbrainz.js,
// 2026-10-24): on unless ARTIST_LOOKUP is "off".
export const artistLookupOn = (env) => String(env?.ARTIST_LOOKUP ?? "").trim().toLowerCase() !== "off";

export function programsKV(env) {
  if (!env.PROGRAMS) {
    throw new Error(
      "the PROGRAMS KV namespace is not bound — add it to wrangler.toml and " +
      "deploy. Refusing rather than writing backups into the token store.");
  }
  return countedKV(env, env.PROGRAMS);
}

// SPOTIFY'S QUOTA. An app in development mode has a quota apart from the
// thirty-second rate limit, and over it EVERY call answers 429 with the reason
// QUOTA_EXCEEDED for as long as Spotify says — the better part of an hour on
// 2026-09-06, when two curator runs did their work in full and lost the write
// to it, and the page went on saying "pending". The first 429 stamps a note
// here with the wait (Retry-After, or fifteen minutes when it says nothing);
// while it stands, the pages read nothing from Spotify and say why, the
// curator is told to leave the queue, a fulfilment refuses before it claims,
// and the doorbell is not rung. One KV read per page or call, against calls
// that would each fail anyway.
export const THROTTLE_KEY = "spotify:throttled";
export const THROTTLE_DEFAULT_MS = 15 * 60 * 1000;
export async function stampThrottle(env, err) {
  const secs = Number(err?.retryAfter) > 0 ? Number(err.retryAfter) : THROTTLE_DEFAULT_MS / 1000;
  const until = Date.now() + secs * 1000;
  try {
    const cur = await programsKV(env).get(THROTTLE_KEY, { type: "json" });
    if (cur?.until && cur.until >= until) return;
    await programsKV(env).put(THROTTLE_KEY, JSON.stringify({
      until, seen: new Date().toISOString(), said: Number(err?.retryAfter) || null }),
      { expirationTtl: Math.max(60, Math.ceil(secs) + 60) });
  } catch { /* the calls fail on their own */ }
}
export async function throttledUntil(env) {
  try {
    const cur = await programsKV(env).get(THROTTLE_KEY, { type: "json" });
    return cur?.until && cur.until > Date.now() ? cur.until : null;
  } catch { return null; }
}
export const minutesLeft = (until) => Math.max(1, Math.ceil((until - Date.now()) / 60000));

// THE SPOTIFY SIGN-IN (MC-31 stage 0b, 2026-10-16). Since 2026-07-20 a
// login made through a developer app ends six months after the person signed
// in, and refreshing does not extend it (Spotify's developer blog,
// 2026-06-18); the token endpoint then answers 400 invalid_grant, and only a
// new sign-in mends it. Spotify does not say when a login began, so the
// house keeps the date itself: Reconnect (spotify-login.js) stamps
// `login_at` and the account on the token record, and every refresh carries
// them forward. A login from before (the terminal's) has no date.
export const SPOTIFY_OUT_KEY = "spotify:signed-out";
export const LOGIN_MONTHS = 6;
export const LOGIN_WARN_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SIGNED_OUT_WORDS = "Spotify has signed this house out: its sign-in lasts six months " +
  "and has to be renewed. Nothing can be read or played on Spotify until someone reconnects it — " +
  "on the house's Speakers page, the Spotify link at the bottom.";
// A short fingerprint of a refresh token, so the note can tell the refused
// login from a new one without keeping the token itself.
export async function tokenMark(token) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token ?? "")));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function signedOutNote(env) {
  try { return await programsKV(env).get(SPOTIFY_OUT_KEY, { type: "json" }); } catch { return null; }
}
async function stampSignedOut(env, refreshToken, said) {
  const note = { at: new Date().toISOString(), rt: await tokenMark(refreshToken), said: String(said ?? "").slice(0, 200) };
  try { await programsKV(env).put(SPOTIFY_OUT_KEY, JSON.stringify(note)); } catch { /* the error still says it */ }
  return note;
}
// THE NOTE, IF IT IS ABOUT THE LOGIN HELD NOW (Codex, 2026-10-17): a late
// refusal of the old login, landing after a Reconnect, must not make the
// pages call the new one signed out. `rec` is the stored login, read here
// when not given. A note with no fingerprint, or with no login held, stands.
export async function currentSignedOut(env, rec = undefined) {
  const note = await signedOutNote(env);
  if (!note?.at) return null;
  let held = rec;
  if (held === undefined) {
    try { held = await tokensKV(env).get("spotify", { type: "json" }); } catch { held = null; }
  }
  if (note.rt && held?.refresh_token && note.rt !== await tokenMark(held.refresh_token)) return null;
  return note;
}
export async function clearSignedOut(env) {
  try { await programsKV(env).delete(SPOTIFY_OUT_KEY); } catch { /* the next refresh clears it */ }
}
export function signedOutError(note) {
  const e = new Error(SIGNED_OUT_WORDS);
  e.code = "spotify-signed-out";
  e.signedOutAt = note?.at ?? null;
  return e;
}
// Six calendar months on from the sign-in.
export function loginEnds(iso) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + LOGIN_MONTHS);
  return d.getTime();
}
// Where the house's Spotify sign-in stands: when it began and ends (null when
// the house never kept the date), whose it is, and whether Spotify has
// signed it out. `due` is what the pages warn on.
export async function spotifyLogin(env, now = Date.now()) {
  let rec = null, unread = false;
  try { rec = await tokensKV(env).get("spotify", { type: "json" }); } catch { rec = null; unread = true; }
  const out = await currentSignedOut(env, rec);
  const at = rec?.login_at ? Date.parse(rec.login_at) : NaN;
  const ends = Number.isFinite(at) ? loginEnds(rec.login_at) : null;
  const daysLeft = ends != null ? Math.ceil((ends - now) / DAY_MS) : null;
  return {
    signedInAt: Number.isFinite(at) ? rec.login_at : null,
    ends, daysLeft,
    account: rec?.account ?? null,
    // Whether there is a login at all (a new house has none), and whether
    // the store could not be read, so the checklist tells them apart.
    present: !!rec?.refresh_token || !!env.SPOTIFY_REFRESH_TOKEN, unread,
    out: out?.at ? out : null,
    due: Boolean(out?.at) || (daysLeft != null && daysLeft <= LOGIN_WARN_DAYS),
  };
}

// THE CURATOR'S LAST CHECK-IN (the owner, 2026-10-02: Change it up and
// Start fresh on Hank "did nothing"). The curator routine had not run for a
// day — Claude's GitHub access to the doorbell repo had lapsed, so every
// sweep and every ring failed before it began — and every page still said
// "a few minutes". Each run starts with list_requests on the agent's key,
// and that call stamps the time here. A page waiting on the curator says so
// when the stamp is older than CURATOR_QUIET_MS: the sweep runs every hour
// at :07, so a working curator is never much over an hour old. Never stamped
// (a new install, or a house with no curator): nothing is said.
export const CURATOR_SEEN_KEY = "curator:seen";
export const CURATOR_QUIET_MS = 75 * 60 * 1000;
export async function stampCurator(env) {
  try { await programsKV(env).put(CURATOR_SEEN_KEY, JSON.stringify({ at: Date.now() })); } catch { /* the next run stamps it */ }
}
// When the curator last checked in, whenever that was; null if never.
export async function curatorSeenAt(env) {
  try {
    const at = Number((await programsKV(env).get(CURATOR_SEEN_KEY, { type: "json" }))?.at);
    return at > 0 ? at : null;
  } catch { return null; }
}
// When the curator last checked in, if that is too long ago; else null.
export async function curatorQuietSince(env, now = Date.now()) {
  try {
    const at = Number((await programsKV(env).get(CURATOR_SEEN_KEY, { type: "json" }))?.at);
    return at > 0 && now - at > CURATOR_QUIET_MS ? at : null;
  } catch { return null; }
}
