// A fake Spotify and a fake KV, so the destructive-write path can be tested
// against failures that cannot be produced on demand against the real API.
//
// The stub sits at `globalThis.fetch` rather than replacing an injected client:
// that way the code under test builds its own URLs, sends its own bodies and
// refreshes its own token exactly as it does in production, and a mistake in
// any of that still shows up here.

import { advance, decideSubmit, prunable, decideClaim, destinationHolder, waitingOn,
  voiceDecide, voiceDue, voiceTotals, voiceEndFor, voiceSweepDecide,
  helperPutDoc, playerPutDoc, playerForgetDoc, keptPlayerOut } from "../station.js";

export function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  const meta = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      const type = typeof opts === "string" ? opts : opts?.type;
      return type === "json" ? JSON.parse(v) : v;
    },
    async getWithMetadata(key, opts) {
      const value = await this.get(key, opts);
      return { value, metadata: meta.get(key) ?? null };
    },
    // KV REPLACES metadata on every put: a put with no `metadata` clears
    // what the key had. The fake used to keep it, which is why no test caught
    // a program losing its shelf row when it moved playlists (2026-09-06).
    // A fake that is kinder than the service hides exactly this kind of bug.
    async put(key, value, opts) {
      store.set(key, value);
      if (opts?.metadata) meta.set(key, opts.metadata);
      else meta.delete(key);
    },
    async delete(key) { store.delete(key); },
    async list({ prefix = "" } = {}) {
      return {
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort()
          .map((name) => ({ name, metadata: meta.get(name) ?? null })),
        list_complete: true,
      };
    },
  };
}

export function track(id, name = `Track ${id}`, artist = "Someone") {
  return {
    uri: `spotify:track:${id}`,
    id,
    name,
    type: "track",
    duration_ms: 200000,
    artists: [{ name: artist }],
    // One sleeve per track id, so a test can tell which record a cover came
    // from. 300 is the width pickImage wants: over the 240 floor, under the 640.
    album: { name: "An Album", images: [{ url: `https://i.scdn.co/image/${id}`, width: 300 }] },
  };
}

// `contents` is the live playlist state the fake API serves and mutates, so a
// PUT followed by a read-back behaves the way Spotify does.
// `artists` names the performer per track id, for the few tests that care who
// is on a record rather than that the lookup happened. Everything else keeps
// the one anonymous name.
// `openai`: a function ({ path, method, headers, body }) → Response for calls
// to api.openai.com (MC-15). Without one, such a call answers 500 in words,
// so a test that reaches OpenAI by accident fails loudly rather than getting
// the Spotify fake's empty object.
export function installFetch({ contents = [], fail = {}, artists = {}, openai = null } = {}) {
  const calls = [];
  const state = { contents: [...contents], description: null };
  // Every description sent, in order. The stub cannot model Spotify ignoring an
  // empty one, so a test asserts on what was SENT rather than on what stuck.
  const descriptionWrites = [];
  // Every rename, with the playlist it was sent to — `state` holds one shared
  // playlist, so a swap that renames two of them would otherwise only show
  // the last. Same reason descriptionWrites exists.
  const nameWrites = [];
  const coverWrites = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    const path = u.pathname.replace(/^\/v1/, "");
    calls.push(`${method} ${path}`);

    if (u.hostname === "accounts.spotify.com") {
      return json({ access_token: "test-token", expires_in: 3600 });
    }
    if (u.hostname === "api.openai.com") {
      if (!openai) return new Response("no openai fake installed for this test", { status: 500 });
      let body = null;
      try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
      return openai({ path, method, headers: init.headers ?? {}, body });
    }

    // fail: { "PUT /playlists/P/items": [null, "boom"] } — one entry per call,
    // a string meaning "throw a 500 on this one".
    const k = `${method} ${path}`;
    if (Array.isArray(fail[k]) && fail[k].length) {
      const next = fail[k].shift();
      if (next) return new Response(next, { status: 500 });
    } else if (typeof fail[k] === "string") {
      return new Response(fail[k], { status: 500 });
    }

    // A single track by id. Programs look every claimed track up before writing
    // anything, so a tool-level program test cannot run without this.
    const one = path.match(/^\/tracks\/([^/]+)$/);
    if (method === "GET" && one) {
      return json(track(one[1], `Track ${one[1]}`, artists[one[1]] ?? "Someone"));
    }
    if (method === "GET" && /^\/playlists\/[^/]+$/.test(path)) {
      // The description has to come back out of the same live state the PUT
      // writes into, or a snapshot/restore round trip is tested against a
      // playlist that never had a description in the first place.
      return json({ id: PID, name: "Scratch", description: state.description ?? "" });
    }
    if (method === "GET" && /^\/playlists\/[^/]+\/items$/.test(path)) {
      const offset = Number(u.searchParams.get("offset") || 0);
      const limit = Number(u.searchParams.get("limit") || 100);
      return json({
        total: state.contents.length,
        items: state.contents.slice(offset, offset + limit)
          .map((t) => ({ item: t })),
      });
    }
    if (method === "PUT" && /^\/playlists\/[^/]+\/items$/.test(path)) {
      state.contents = JSON.parse(init.body).uris.map((uri) =>
        track(uri.split(":").pop()));
      return json({ snapshot_id: "s" });
    }
    if (method === "POST" && /^\/playlists\/[^/]+\/items$/.test(path)) {
      for (const uri of JSON.parse(init.body).uris) {
        state.contents.push(track(uri.split(":").pop()));
      }
      return json({ snapshot_id: "s" });
    }
    // A cover upload: a bare base64 JPEG, answered 202 with no body. Recorded
    // per playlist, like renames, so a swap that dresses two of them shows
    // both.
    if (method === "PUT" && /^\/playlists\/[^/]+\/images$/.test(path)) {
      coverWrites.push({ id: path.split("/")[2], bytes: String(init.body ?? "").length });
      return new Response(null, { status: 202 });
    }
    // Playlist DETAILS, not contents. Kept as live state like `contents` so a
    // test can assert what the line under the name actually says.
    if (method === "PUT" && /^\/playlists\/[^/]+$/.test(path)) {
      const body = JSON.parse(init.body || "{}");
      if (body.description !== undefined) {
        descriptionWrites.push(body.description);
        state.description = body.description;
      }
      if (body.name !== undefined) {
        nameWrites.push({ id: path.split("/")[2], name: body.name });
        state.name = body.name;
      }
      return json({});
    }
    // A default room, so tools that resolve a device before doing anything can
    // be exercised at all. DEFAULT_DEVICE in makeEnv is "Pro Plus".
    if (path === "/me/player/devices") {
      return json({ devices: [{ id: "device-1", name: "Pro Plus", is_active: true }] });
    }
    // Spotify answers 204 to playback mutations. The stub used to answer 200,
    // which is how a bug in exactly this branch passed its own test.
    if (method !== "GET" && path.startsWith("/me/player")) {
      return new Response(null, { status: 204 });
    }
    if (path === "/me/player") return new Response(null, { status: 204 });
    return json({});
  };

  return {
    calls,
    state,
    descriptionWrites,
    nameWrites,
    coverWrites,
    restore() { globalThis.fetch = original; },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A real playlist id is 22 alphanumerics — playlistIdFrom enforces that, and an
// alias pointing at anything else is refused before a write can happen.
export const PID = "0000000000000000000001";

// ------------------------------------------------------------------- tidal

// A Tidal playlist id is a UUID. Distinct from the one house.test.js puts on
// a button so a test that mixes the two cannot confuse them.
export const TPID = "0b1f2c3d-aaaa-bbbb-cccc-000000000001";

// The fixtures are JSON:API resources as tidal/probe3.py saw them: a track
// with its album and artists as relationships, the album's sleeve as an
// `artworks` resource, every related thing delivered once in `included`.
export function tidalTrack(id, { title = `Track ${id}`, version = null, availability = ["STREAM", "DJ"], mediaTags = undefined } = {}) {
  return {
    id: String(id), type: "tracks",
    attributes: {
      title, ...(version ? { version } : {}), isrc: "USRC17607839", duration: "PT3M20S",
      availability, ...(mediaTags ? { mediaTags } : {}),
      externalLinks: [{ href: `https://tidal.com/browse/track/${id}`, meta: { type: "TIDAL_SHARING" } }],
    },
    relationships: {
      albums: { data: [{ id: `al-${id}`, type: "albums" }] },
      artists: { data: [{ id: "ar-1", type: "artists" }] },
    },
  };
}

// What `included` holds for these track ids: the tracks, one album each, the
// one artist they share, and each album's sleeve.
export function tidalIncluded(ids, opts = {}) {
  const out = [{ id: "ar-1", type: "artists", attributes: { name: "Someone" } }];
  for (const id of ids) {
    out.push(tidalTrack(id, opts[id] ?? {}));
    out.push({
      id: `al-${id}`, type: "albums",
      attributes: { title: "An Album", releaseDate: "1979-08-24" },
      relationships: { coverArt: { data: [{ id: `art-${id}`, type: "artworks" }] } },
    });
    out.push(tidalArtwork(`art-${id}`, id));
  }
  return out;
}

// The hrefs take the real shape — a UUID spread over five path segments, then
// `<W>x<H>.jpg` — because imageUrl admits exactly that and
// a fixture in some other shape would be dropped by the page under test.
// `imageId` is folded into the last segment so each record keeps its own sleeve.
export function tidalArtwork(artId, imageId) {
  const tail = String(imageId).replace(/[^0-9a-f]/gi, "").toLowerCase().padStart(12, "0").slice(-12);
  const path = `${tail.slice(0, 8)}/${tail.slice(0, 4)}/${tail.slice(4, 8)}/${tail.slice(8, 12)}/${tail}`;
  return {
    id: artId, type: "artworks",
    attributes: {
      mediaType: "IMAGE",
      files: [320, 160].map((w) => ({
        href: `https://resources.tidal.com/images/${path}/${w}x${w}.jpg`,
        meta: { width: w, height: w },
      })),
    },
  };
}

// A fake Tidal at `globalThis.fetch`, in front of whatever fake was there —
// a test with a house on both services installs the Spotify one first and
// this one after, and restores in the reverse order.
//
// `contents` is the live playlist as track ids; each gets the per-position
// itemId a real playlist carries, which is what a clear names and what a
// stale handle fails to. Twenty a page, as Tidal reads; the write ceiling is
// the adapter's to keep and is not enforced here.
//
// `fail` is keyed "METHOD /path" like installFetch's: a string is a 500 with
// that body, `{ status, body, headers }` is that answer, and an array is one
// entry per call in order (null meaning "this one succeeds").
export function installTidalFetch({ contents = [], fail = {} } = {}) {
  const calls = [];
  let nextItem = 1;
  const item = (trackId) => ({ trackId: String(trackId), itemId: `item-${nextItem++}` });
  const state = { items: contents.map(item), description: null };
  const descriptionWrites = [];
  const nameWrites = [];
  const original = globalThis.fetch;
  const PAGE = 20;

  const entry = (it) => ({ id: it.trackId, type: "tracks", meta: { itemId: it.itemId } });
  const page = (offset) => {
    const slice = state.items.slice(offset, offset + PAGE);
    const more = offset + PAGE < state.items.length;
    return {
      data: slice.map(entry),
      included: tidalIncluded([...new Set(slice.map((it) => it.trackId))]),
      links: more ? { next: `/playlists/${TPID}/relationships/items?countryCode=NL&page%5Bcursor%5D=${offset + PAGE}` } : {},
    };
  };
  const share = (id) => [{ href: `https://listen.tidal.com/playlist/${id}`, meta: { type: "TIDAL_SHARING" } }];

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "auth.tidal.com") {
      calls.push("POST /token");
      return json({ access_token: "tidal-token", expires_in: 14400 });
    }
    if (u.hostname !== "openapi.tidal.com") return original(url, init);
    const method = init.method || "GET";
    const path = u.pathname.replace(/^\/v2/, "");
    calls.push(`${method} ${path}`);

    const k = `${method} ${path}`;
    let planned = fail[k];
    if (Array.isArray(planned)) planned = planned.length ? planned.shift() : null;
    if (typeof planned === "string") return new Response(planned, { status: 500 });
    if (planned && typeof planned === "object") {
      return new Response(planned.body ?? "", { status: planned.status ?? 500, headers: planned.headers ?? {} });
    }

    const body = init.body ? JSON.parse(init.body) : null;
    const include = (u.searchParams.get("include") ?? "").split(",");
    const one = path.match(/^\/tracks\/([^/]+)$/);
    if (method === "GET" && one) {
      return json({ data: tidalTrack(one[1]), included: tidalIncluded([one[1]]) });
    }
    if (method === "GET" && path === "/tracks") {
      return json({ data: [tidalTrack("hit")], included: tidalIncluded(["hit"]) });
    }
    if (method === "GET" && path === "/searchResults") {
      return json({
        data: { id: u.searchParams.get("filter[query]"), type: "searchResults",
          relationships: { tracks: { data: [{ id: "hit", type: "tracks" }] } } },
        included: tidalIncluded(["hit"]),
      });
    }
    if (method === "GET" && path === "/playlists") {
      return json({ data: [{ id: TPID, type: "playlists",
        attributes: { name: "Scratch", description: state.description ?? "" } }] });
    }
    if (method === "POST" && path === "/playlists") {
      const at = body.data.attributes;
      return json({ data: { id: TPID, type: "playlists",
        attributes: { ...at, externalLinks: share(TPID) } } }, 201);
    }
    if (method === "GET" && /^\/playlists\/[^/]+$/.test(path)) {
      const n = state.items.length;
      const first = include.includes("items") ? page(0) : null;
      return json({
        data: {
          id: TPID, type: "playlists",
          // Absent, not 0, on an empty playlist — as measured.
          attributes: { name: "Scratch", description: state.description ?? "",
            ...(n ? { numberOfItems: n } : {}), externalLinks: share(TPID) },
          relationships: {
            coverArt: { data: [{ id: "art-pl", type: "artworks" }] },
            ...(first ? { items: { data: first.data, links: first.links } } : {}),
          },
        },
        included: [
          ...(include.includes("coverArt") ? [tidalArtwork("art-pl", "pl")] : []),
          ...(first ? first.included : []),
        ],
      });
    }
    if (method === "GET" && /^\/playlists\/[^/]+\/relationships\/items$/.test(path)) {
      return json(page(Number(u.searchParams.get("page[cursor]") || 0)));
    }
    if (method === "DELETE" && /^\/playlists\/[^/]+\/relationships\/items$/.test(path)) {
      // Idempotent, and never all-or-nothing: the handles it knows go, the
      // rest are ignored.
      const gone = new Set(body.data.map((d) => d.meta?.itemId));
      state.items = state.items.filter((it) => !gone.has(it.itemId));
      return new Response(null, { status: 200 });
    }
    if (method === "POST" && /^\/playlists\/[^/]+\/relationships\/items$/.test(path)) {
      // Appends at the end, in order, and a track already there goes in again.
      for (const d of body.data) state.items.push(item(d.id));
      return new Response(null, { status: 200 });
    }
    if (method === "PATCH" && /^\/playlists\/[^/]+$/.test(path)) {
      const description = body.data?.attributes?.description;
      if (description !== undefined) {
        descriptionWrites.push(description);
        state.description = description;
      }
      const name = body.data?.attributes?.name;
      if (name !== undefined) {
        nameWrites.push({ id: path.split("/")[2], name });
        state.name = name;
      }
      return new Response(null, { status: 200 });
    }
    return json({ errors: [{ code: "NOT_FOUND", detail: `no fake for ${k}` }] }, 404);
  };

  return {
    calls,
    state,
    descriptionWrites,
    nameWrites,
    restore() { globalThis.fetch = original; },
  };
}

// The station ledger, faked at the seam the Worker actually uses: a binding
// whose stub answers the same JSON ops as the Durable Object, built on the
// SAME pure functions (advance/decideSubmit/prunable, and decideClaim with the
// guest lock) the real shell runs.
// Route tests exercise real gate behavior; only SQLite and the input gate
// are workerd's to prove (mcp/test-workerd/).
export function makeStation() {
  const rows = new Map();
  // The Spotify call counter, the same shape the real object keeps.
  const calls = new Map();
  const kvops = new Map(); // "hour|category" -> n
  const hits = [];
  const endless = { doc: null, log: [] }; // the endless DJ's watch (MC-22)
  const seen = new Map(), sentBack = new Map();
  // The Talk ledger (MC-15), on the same pure reducer the real object runs.
  const sessions = new Map(); // cap -> row
  const hourKey = (now) => new Date(now).toISOString().slice(0, 13);
  const publicRow = (r) => { const { claim_token, ...rest } = r; return rest; };
  const claimedOn = (d) => [...rows.values()].filter((r) => r.state === "claimed" && r.destination === d);
  const respond = async (op, args) => {
    const now = Number.isFinite(args.now) ? args.now : Date.now();
    for (const [id, r] of rows) if (prunable(r, now)) rows.delete(id);
    if (op === "submit") {
      const djRows = [...rows.values()].filter((r) => r.dj === args.dj);
      const pendingCount = [...rows.values()]
        .filter((r) => r.state === "pending").length;
      const d = decideSubmit({ normalized: args.normalized }, djRows,
        pendingCount, now, args.caps);
      if (!d.ok) return d;
      rows.set(args.id, { id: args.id, dj: args.dj,
        normalized: args.normalized, state: "pending",
        created_at: now, updated_at: now, lease_until: null,
        fingerprint: null, write_started: 0, claim_token: null,
        claim_count: 0, playlist_id: null, track_count: null,
        runtime_ms: null, attention_code: null, decline_reason: null,
        suggested_dj: null, kept_slug: null, kept_at: null,
        destination: typeof args.destination === "string" && args.destination ? args.destination : null });
      return { ok: true, id: args.id };
    }
    if (op === "list") {
      let out = [...rows.values()];
      if (args.dj) out = out.filter((r) => r.dj === args.dj);
      if (args.destination) out = out.filter((r) => r.destination === args.destination);
      if (Array.isArray(args.states) && args.states.length) {
        const states = new Set(args.states);
        out = out.filter((r) => states.has(r.state));
      }
      out.sort((a, b) => b.created_at - a.created_at);
      // The waiting mark (MC-18), by the object's rule over every claimed row
      // on the guest — on copies, so the mark never lands in a stored row.
      return { ok: true, rows: out.slice(0, 50).map((r) => {
        const h = r.destination && (r.state === "pending" || r.state === "claimed")
          ? waitingOn(r, claimedOn(r.destination), now) : null;
        return publicRow(h ? { ...r, waiting_for: { request_id: h.id, dj: h.dj } } : r);
      }) };
    }
    // The door's guard (MC-18), the same read the object answers.
    if (op === "destination-busy") {
      const d = typeof args.destination === "string" ? args.destination : "";
      if (!d) return { ok: false, code: "bad-request" };
      const h = destinationHolder(claimedOn(d), d, args.except ?? null, now);
      return { ok: true, busy: h ? { request_id: h.id, dj: h.dj } : null };
    }
    if (op === "get") {
      const row = rows.get(args.id);
      return row ? { ok: true, row: publicRow(row) }
        : { ok: false, code: "unknown-request" };
    }
    if (op === "count") {
      const k = `${hourKey(now)}|${args.category ?? "other"}`;
      calls.set(k, (calls.get(k) ?? 0) + 1);
      return { ok: true };
    }
    if (op === "count-many") {
      for (const [category, n] of Array.isArray(args.ops) ? args.ops : []) {
        const k = `${hourKey(now)}|${category ?? "other"}`;
        calls.set(k, (calls.get(k) ?? 0) + (Number(n) || 0));
      }
      return { ok: true };
    }
    if (op === "quota-hit") {
      // The count as it stood at the refusal, the way the real ledger takes
      // it: read here, not passed in.
      const from = hourKey(now - 24 * 60 * 60 * 1000);
      let n = 0;
      for (const [k, v] of calls) if (k.split("|")[0] >= from && k.split("|")[1] !== "player-saved") n += v;
      hits.unshift({ at: now, retry_after: Number(args.retryAfter) || null,
        category: args.category ?? "other", reason: args.reason ?? null, calls_24h: n });
      return { ok: true };
    }
    if (op === "helper-put") {
      endless.helper = JSON.stringify(helperPutDoc(endless.helper ? JSON.parse(endless.helper) : null, args.doc, now));
      return { ok: true };
    }
    if (op === "helper-get") return { ok: true, doc: endless.helper ? JSON.parse(endless.helper) : null, hands: !!endless.hands,
      player: keptPlayerOut(endless.player ? JSON.parse(endless.player) : null) };
    if (op === "helper-forget") { delete endless.helper; return { ok: true }; }
    // The kept Spotify answer (MC-29), on the object's own rules.
    if (op === "player-put") {
      const next = playerPutDoc(endless.player ? JSON.parse(endless.player) : null, args.at, args.st);
      if (next) endless.player = next;
      return { ok: true, kept: !!next };
    }
    if (op === "player-forget") {
      endless.player = playerForgetDoc(endless.player ? JSON.parse(endless.player) : null, args.until, now);
      return { ok: true };
    }
    // The helper's line, faked: a test sets endless.hands to a function that
    // answers a command as the helper would.
    if (op === "helper-command") {
      if (!endless.hands) return { ok: false, code: "helper-off" };
      const r = await endless.hands(args);
      return { ok: !!r?.ok, code: r?.code ?? (r?.ok ? "ok" : "failed"), reading: r?.reading ?? null };
    }
    if (op === "endless-get") return { ok: true, doc: endless.doc ? JSON.parse(endless.doc) : null };
    if (op === "endless-put") {
      const had = Number(endless.doc ? JSON.parse(endless.doc).rev : 0) || 0;
      if (args.ifRev !== undefined && args.ifRev !== null && Number(args.ifRev) !== had) return { ok: false, conflict: true, rev: had };
      endless.doc = JSON.stringify({ ...(args.doc ?? {}), rev: had + 1 });
      return { ok: true, rev: had + 1 };
    }
    if (op === "endless-log") {
      for (const e of (args.events ?? []).slice(0, 20)) {
        endless.log.push({ at: Number(e.at) || now, btn: e.btn ?? null, event: String(e.event ?? "note"), detail: e.detail ?? null });
      }
      return { ok: true };
    }
    if (op === "endless-list") {
      return { ok: true, rows: endless.log.slice(-Math.min(200, Math.max(1, Number(args.limit) || 40))) };
    }
    // The rule check's two tables (setcheck.js), as the real object keeps them.
    if (op === "seen-put") {
      for (const [uri, lead, title, album, ms] of (args.rows ?? []).slice(0, 300)) {
        if (uri) seen.set(uri, { uri, lead, title, album, ms: Number(ms) || 0 });
      }
      return { ok: true };
    }
    if (op === "seen-get") {
      const tracks = {};
      for (const u of args.uris ?? []) if (seen.has(u)) tracks[u] = seen.get(u);
      const within = Number(args.sent_within_ms);
      const at = sentBack.get(args.key);
      return { ok: true, tracks, sent_back: at != null && (!(within > 0) || at >= now - within) };
    }
    if (op === "sent-back") { if (args.key) sentBack.set(args.key, now); return { ok: true }; }
    if (op === "sent-used") {
      const at = sentBack.get(args.key);
      if (at != null) { sentBack.set(`${args.key}@${at}`, at); sentBack.delete(args.key); }
      return { ok: true };
    }
    if (op === "sent-back-day") {
      const out = { requests: 0, endless: 0, chat_and_talk: 0 };
      const name = { req: "requests", job: "endless", write: "chat_and_talk" };
      for (const [k, at] of sentBack) if (at >= now - 24 * 60 * 60 * 1000 && name[k.split(":")[0]]) out[name[k.split(":")[0]]] += 1;
      return { ok: true, ...out };
    }
    if (op === "kv-count") {
      for (const [kind, category, n] of args.ops ?? []) {
        const k = `${hourKey(now)}|${kind}|${category}`;
        kvops.set(k, (kvops.get(k) ?? 0) + (Number(n) || 0));
      }
      return { ok: true };
    }
    if (op === "kv-ops") {
      const since = hourKey(now - 48 * 60 * 60 * 1000);
      const hours = [...kvops].map(([k, n]) => {
        const [hour, kind, category] = k.split("|");
        return { hour, op: kind, category, n };
      }).filter((r) => r.hour >= since).sort((a, b) => a.hour.localeCompare(b.hour));
      return { ok: true, hours };
    }
    if (op === "calls") {
      const since = hourKey(now - 48 * 60 * 60 * 1000);
      const hours = [...calls].map(([k, n]) => {
        const [hour, category] = k.split("|"); return { hour, category, n };
      }).filter((r) => r.hour >= since).sort((a, b) => a.hour.localeCompare(b.hour));
      return { ok: true, hours, hits: hits.slice(0, 30) };
    }
    if (op === "voice-sweep") {
      // The real object closes each due session at OpenAI over the sideband;
      // the fake has no socket, so the outcome is the caller's (`outcome` in
      // the args, for a test of the retry path) or "refused as gone". Only
      // the day's rows the caller names are swept, or all of them.
      const outcome = args.outcome ?? { closed: false, seconds: null, reason: "fake", retry: false };
      const closed = [];
      const days = new Set([...sessions.values()].filter((r) => r.closed_by == null && (!args.day || r.day === args.day)).map((r) => r.day));
      for (const day of days) {
        const dayRows = [...sessions.values()].filter((r) => r.day === day);
        const totals = voiceTotals(dayRows, now, Number(args.cap_minutes) || 60);
        for (const row of voiceDue(dayRows.filter((r) => r.closed_by == null), now, totals)) {
          const endAt = row.settled_at ?? voiceEndFor(row, totals, now);
          const next = voiceSweepDecide(row, row.session_id ? outcome : { closed: false, seconds: null, reason: "unbound", retry: false }, now, endAt);
          sessions.set(row.cap, next);
          closed.push({ cap: row.cap, day, by: next.closed_by ?? "retry", seconds: next.settled_sec, reason: row.session_id ? outcome.reason : "unbound", tries: next.close_tries ?? 0 });
        }
      }
      return { ok: true, closed, next: null };
    }
    if (op === "voice-reserve" || op === "voice-bind" || op === "voice-beat" || op === "voice-check" ||
        op === "voice-settle" || op === "voice-closing" || op === "voice-void" || op === "voice-day" ||
        op === "voice-list" || op === "voice-relabel") {
      const row = sessions.get(String(args.cap ?? "")) ?? null;
      const day = String(args.day ?? args.from ?? row?.day ?? "");
      const dayRows = [...sessions.values()].filter((r) => r.day === day);
      const { write, remove, relabel, ...out } = voiceDecide(op, args, dayRows, row, now);
      if (write) sessions.set(write.cap, write);
      if (remove) sessions.delete(remove);
      if (relabel) for (const r of dayRows) sessions.set(r.cap, { ...r, day: relabel.to });
      return out;
    }
    const row = rows.get(args.id);
    if (!row) return { ok: false, code: "unknown-request" };
    // The guest lock (MC-18), as the real object runs it: a claim goes
    // through decideClaim, and a busy refusal notes where the row is going.
    const result = op === "claim"
      ? decideClaim(row, args, args.destination ? claimedOn(args.destination) : [], now)
      : advance(row, op, args, now);
    if (result.ok && result.note !== "noop") rows.set(args.id, result.row);
    if (result.code === "destination-busy" && row.destination !== result.destination) {
      rows.set(args.id, { ...row, destination: result.destination });
    }
    return result.ok
      ? { ok: true, row: result.row, note: result.note } : result;
  };
  return {
    rows, calls, kvops, hits, sessions, endless,
    idFromName(name) { return name; },
    get() {
      return {
        fetch: async (_url, init) => {
          const { op, args = {} } = JSON.parse(init.body);
          const body = await respond(op, args);
          return new Response(JSON.stringify(body),
            { headers: { "content-type": "application/json" } });
        },
      };
    },
  };
}

// The assets binding, answering a four-byte JPEG for any key. A swap reads a
// face through it to dress a playlist; covers.test.js has its own, stricter
// stand-in that records what was asked and can be told which files exist.
export function fakeCoversBinding() {
  return {
    fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 }),
  };
}

// THE WALL'S TILE CACHE IS ONE KEY (2026-09-06), holding every preset's
// summary under its playlist id — eleven keys meant eleven KV writes for one
// page load, against a free tier of a thousand a day. These keep the tests out
// of that shape.
export async function putTile(env, pid, tile) {
  const now = JSON.parse((await env.PROGRAMS.get("tiles")) ?? "{}");
  now[pid] = tile;
  await env.PROGRAMS.put("tiles", JSON.stringify(now));
}
export async function getTile(env, pid) {
  return JSON.parse((await env.PROGRAMS.get("tiles")) ?? "{}")[pid] ?? null;
}
export async function dropTile(env, pid) {
  const now = JSON.parse((await env.PROGRAMS.get("tiles")) ?? "{}");
  delete now[pid];
  await env.PROGRAMS.put("tiles", JSON.stringify(now));
}
// The same map as a seed value, for an env built from an object literal.
export const tilesKey = (map) => JSON.stringify(map);

// The HOUSE object (MC-31, settings.js): the real class on the statements it
// runs, over a Map. `calls` counts what reached it.
export async function makeHouseStore() {
  const { HouseSettings } = await import("../settings.js");
  const m = new Map();
  const sql = { exec: (q, ...v) => {
    if (q.startsWith("SELECT")) return { toArray: () => (m.has(v[0]) ? [{ v: m.get(v[0]) }] : []) };
    if (q.startsWith("INSERT INTO") && m.has(v[0])) throw new Error("UNIQUE constraint failed");
    if (q.startsWith("INSERT")) m.set(v[0], v[1]);
    return { toArray: () => [] };
  } };
  const obj = new HouseSettings({ storage: { sql } });
  const store = { calls: 0, rows: m };
  store.binding = { idFromName: () => "household",
    get: () => ({ fetch: (u, init) => { store.calls += 1; return obj.fetch(new Request(u, init)); } }) };
  return store;
}

export function makeEnv(kvOverrides = {}) {
  return {
    COVERS: fakeCoversBinding(),
    TOKENS: makeKV({
      spotify: JSON.stringify({ refresh_token: "r" }),
      tidal: JSON.stringify({ refresh_token: "t" }),
    }),
    PROGRAMS: makeKV(kvOverrides),
    STATION: makeStation(),
    SPOTIFY_CLIENT_ID: "cid",
    TIDAL_CLIENT_ID: "tcid",
    // The house's own MusicBrainz lookup (musicbrainz.js) is off in a test
    // house unless the test turns it on: no suite reaches the real one.
    ARTIST_LOOKUP: "off",
    // The Tidal lane spaces real calls half a second apart. The fake answers
    // at once, and a suite that waited between them would prove nothing but
    // the clock.
    TIDAL_GAP_MS: "0",
    PLAYLIST_ALIASES: JSON.stringify({ scratch: PID }),
    PROGRAM_BASE_URL: "https://example.test",
    ARCHIVE_SITE_URL: "https://site.test",
    // The archive's index moved off two constants and into config on
    // 2026-09-07, so a test house names its own the way a real one does.
    // installFetch answers these; nothing here reaches a real host.
    ARCHIVE_OCCURRENCES_URL: "https://site.test/assets/song-occurrences.json",
    ARCHIVE_TRACKS_URL: "https://site.test/assets/track-spec.json",
    // And the recordings themselves, a constant in worker.js until 2026-09-08.
    ARCHIVE_MEDIA_URL: "https://media.test/stream",
    DEFAULT_DEVICE: "Pro Plus",
  };
}

export const PL = { id: PID, name: "Scratch", via: 'alias "scratch"' };
// A resolved Tidal playlist, as resolvePlaylist will stamp one once it
// speaks Tidal; until then the safe-write path is reached with it directly.
export const TPL = { id: TPID, name: "Scratch", via: "test", catalog: "tidal" };

// This suite's house: which DJ each preset number holds. The production
// wrangler.toml assignment as of 2026-09, copied here as a fixture so a test
// can say `buttons({ 3: PROF })` and get a writer on button 3 without each
// test restating who sits where. The Worker itself no longer knows.
export const HOUSE = {
  // 4, 5, 7 and 9 held Sunny, Morning, Nightside and KRS-One until the
  // merges (the owner, 2026-10-13): Vibe and Soul took two, and any two who
  // stay will do for the others.
  // THE CUT OF 2026-10-15 (the owner: Camille, Monk, the Professor, the
  // Selector and Hip Hop). 3 was the Professor's: the Librarian, a writer
  // with no rule on the shape of a set, takes it, and Deep Dive her 8. 7 was
  // the Selector's: Genre. Ten DJs for eleven presets, so 11, Hip Hop's, has
  // nobody: `buttons({ 11: … })` installs it empty.
  1: "dr-funkenstein", 2: "hank", 3: "the-librarian", 4: "vibe",
  5: "soul", 7: "genre", 8: "deep-dive",
  // 9 to 12 held the Bootlegger, the Correspondent, the Engineer and Baddie
  // until the owner cut them, 2026-10-13; any four who stay will do. 10 and
  // 12 held Chanson and Dutch until they went too, later that day.
  9: "pub-rock", 10: "gatefold", 12: "americana",
};

// BUTTONS as the Worker reads it, from `{ preset: playlistId }`. Preset 6 is
// the archive slot in this house, so `{ 6: true }` puts the archive there.
export function buttons(map, { catalog = "spotify" } = {}) {
  return JSON.stringify(Object.entries(map).map(([n, playlist]) => {
    const button = Number(n);
    if (playlist === true) return { button, archive: true };
    return { button, dj: HOUSE[button], playlist, catalog };
  }));
}
