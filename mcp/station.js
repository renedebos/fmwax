// The station ledger: who may touch a request, and what is true of it.
//
// Request RECORDS live in KV (the PROGRAMS namespace) like everything else
// here — submission text is written once and read for rendering. What cannot
// live in KV is coordination: KV is eventually consistent and allows one
// write per key per second, and a request crosses pending → claimed → ready
// faster than that, sometimes with two agents watching. The two-agent case is
// not hypothetical: the pipe fires a cloud run per push AND an hourly sweep,
// and tasks/done/mc00-probe.md measured two pushes eight seconds apart producing
// two concurrent sandboxes with no platform dedupe. So the ledger is ONE
// SQLite-backed Durable Object — claims, leases and state ONLY. Every cache,
// backup and pointer this Worker already keeps stays in KV.
//
// The object's transaction covers ownership and state, never Spotify's side
// effect. Fulfilment claims first, writes Spotify second, commits third. The
// ledger's one hard rule guards the gap between those steps: once a claimant
// declares the destructive write started, the request never returns to
// pending. A lease that dies past that point demands reconciliation against
// the LIVE playlist — the caller reads Spotify and reports the fingerprint it
// saw; the ledger never assumes a dead claimant's write did not happen.
//
// Everything that decides is a pure function over a plain row, tested in the
// node suite; the Durable Object is a thin SQL shell around those decisions,
// exercised against the real binding in mcp/test-workerd/.

// A double tap on a phone form is two submissions with the same text seconds
// apart; the window turns the second into a pointer at the first, and the
// caller emits no second event — dedupe that re-fired would spend a cloud
// session per bounce.
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

// A curation run measured ~10s of transport plus curation time; ten minutes
// is generous. A lease that outlives its claimant merely delays the sweep's
// takeover, so err long rather than risk two live claimants.
export const LEASE_MS = 10 * 60 * 1000;

// Household-wide, across DJs. Every pending request is a cloud session
// waiting to be spent; the composer refuses past this with honest copy
// rather than queueing silently.
export const PENDING_CAP = 3;

// Lazy retention. Pending (and claims that died before any write) are stale
// intent after a month; anything that reached an outcome keeps its story for
// a season. No alarm — at household scale, pruning on the next touch is soon
// enough.
export const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SETTLED_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// THE REASON A DJ PASSED, for the listener's page. 140 cut two of nine
// mid-word ("his co-write of Respe", 2026-10-30), so a little longer, and a
// cut that stops at a sentence, or failing that at a word.
export const DECLINE_REASON_MAX = 240;
export function cutReason(text, max = DECLINE_REASON_MAX) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop >= max / 2) return cut.slice(0, stop + 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > 0 ? cut.slice(0, word) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

// pending and claimed block a second request for the same DJ; ready and
// declined do not — a finished set invites the next ask, and a DJ who passed
// has freed the slot (the refusal card answers a same-text re-ask through
// the dedupe window instead). "superseded" is derived at read time from the
// ask: pointer, never stored.
const OUTSTANDING = new Set(["pending", "claimed"]);

export function normalizeRequest(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function makeRequestId() {
  return crypto.randomUUID();
}

// Order-sensitive by construction: the fingerprint IS the sequence, so an
// append or reshuffle in Spotify stops matching. Truncated SHA-256 — this is
// an integrity check against drift, not authentication.
export async function fingerprintUris(uris) {
  const data = new TextEncoder().encode(uris.join("\n"));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ok = (row, note) => note ? { ok: true, row, note } : { ok: true, row };
const refuse = (code, row) => ({ ok: false, code, state: row?.state ?? null });

// How long a ready row must sit untouched before a missing tracklist counts as
// permanently missing. Workers KV propagates a write globally in seconds and
// documents a minute; an hour is far past that and still well inside the
// sweep that comes looking, so nothing waits on it in practice.
const UNRECORDED_AFTER_MS = 60 * 60 * 1000;

// The whole state machine, as one pure function: row + action → new row or a
// refusal code. `now` is explicit so lease arithmetic is testable and so the
// Durable Object and the node suite exercise the same clockless logic.
//
//   pending ──claim──> claimed ──commit-ready────> ready
//      │  │               │  └──commit-attention─> needs-attention ──ack──┐
//      │  └─decline─> declined                                            │
//      └──dismiss──> dismissed <──────────────────────────────────────────┘
//
// claimed is leased, and the LEASE IDENTITY IS A TOKEN, not the fingerprint.
// Two independent runs curating the same request can honestly produce the
// same URI sequence — the same fingerprint — and a fingerprint-keyed lease
// would then admit both as "the claimant retrying", giving two live writers,
// which is the one thing this ledger exists to prevent. So claim mints a
// token, and mark-write and the commits demand it back; the fingerprint
// stays what it is everywhere else, the identity of the sequence.
//
// A live lease refuses rival claims; an expired lease before mark-write is
// claimable afresh (any fingerprint — nothing was written, so nothing
// constrains the retry); an expired lease after mark-write accepts only
// `reconcile`, which turns the caller's read of the live playlist into ready
// (it matches — the write landed) or needs-attention (anything else;
// uncertainty never retries a destructive write, and nothing ever returns to
// pending from here).
export function advance(row, action, args = {}, now = Date.now()) {
  const leaseExpired = row.state === "claimed" && (row.lease_until ?? 0) <= now;
  const same = args.fingerprint != null && args.fingerprint === row.fingerprint;
  const leaseMs = args.leaseMs ?? LEASE_MS;

  switch (action) {
    case "claim": {
      if (!args.fingerprint) return refuse("fingerprint-required", row);
      if (row.state === "pending") {
        return ok({ ...row, state: "claimed", fingerprint: args.fingerprint,
          claim_token: crypto.randomUUID(),
          lease_until: now + leaseMs, write_started: 0,
          claim_count: (row.claim_count ?? 0) + 1, updated_at: now });
      }
      if (row.state === "claimed") {
        if (!leaseExpired) {
          // Only the token-bearing claimant re-arms its own lease — and only
          // for the sequence it claimed. A renewal that names a different
          // fingerprint is a caller bug (recurating mid-claim), and silently
          // keeping the old one would leave the ledger vouching for a
          // sequence nobody wrote; refuse loudly instead.
          if (args.token && args.token === row.claim_token) {
            if (!same) return refuse("fingerprint-mismatch", row);
            return ok({ ...row, lease_until: now + leaseMs, updated_at: now });
          }
          return refuse("lease-held", row);
        }
        if (row.write_started) return refuse("reconcile-required", row);
        return ok({ ...row, fingerprint: args.fingerprint,
          claim_token: crypto.randomUUID(),
          lease_until: now + leaseMs,
          claim_count: (row.claim_count ?? 0) + 1, updated_at: now });
      }
      // Settled. A retry carrying the fingerprint that fulfilled is the
      // caller's own success echoing back — name it so it can report success
      // idempotently instead of alarming.
      if (row.state === "ready" && same) return refuse("already-ready", row);
      return refuse("settled", row);
    }

    case "mark-write": {
      // The point of no return is declared, never inferred. Only the live
      // leaseholder may declare it — proven by token, because past the lease
      // (or behind the same fingerprint) another writer may already be
      // moving, and two writers is the disease this ledger treats.
      if (row.state !== "claimed") return refuse("not-claimed", row);
      if (!args.token || args.token !== row.claim_token) return refuse("not-claimant", row);
      if (leaseExpired) return refuse("lease-expired", row);
      return ok({ ...row, write_started: 1, updated_at: now });
    }

    case "commit-ready": {
      if (row.state === "ready" && same) return ok(row, "noop");
      if (row.state !== "claimed") return refuse("not-claimed", row);
      if (!args.token || args.token !== row.claim_token) return refuse("not-claimant", row);
      // The commit names the sequence it wrote. Requiring it here is what
      // makes the retry idempotent: the first commit clears the token, so a
      // retry can only be recognized by fingerprint on the ready row above.
      if (!same) return refuse("fingerprint-mismatch", row);
      // An expired lease does not block this: the token matching means this
      // claimant's own write finished, and recording truth beats punctuality.
      // (Had a rival taken over meanwhile, the token would have been reminted.)
      return ok({ ...row, state: "ready",
        playlist_id: args.playlistId ?? null,
        track_count: args.trackCount ?? null,
        runtime_ms: args.runtimeMs ?? null,
        claim_token: null, lease_until: null, updated_at: now });
    }

    case "commit-attention": {
      if (row.state === "needs-attention") return ok(row, "noop");
      if (row.state !== "claimed") return refuse("not-claimed", row);
      if (!args.token || args.token !== row.claim_token) return refuse("not-claimant", row);
      return ok({ ...row, state: "needs-attention",
        attention_code: String(args.code ?? "unspecified").slice(0, 64),
        claim_token: null, lease_until: null, updated_at: now });
    }

    case "reconcile": {
      // A sweep retrying after a lost response finds the row already settled;
      // echo the outcome rather than alarming.
      if (row.state === "ready" && args.liveFingerprint === row.fingerprint) {
        return ok(row, "noop");
      }
      if (row.state === "needs-attention") return ok(row, "noop");
      if (row.state !== "claimed") return refuse("not-claimed", row);
      if (!row.write_started) return refuse("no-write", row);
      if (!leaseExpired) return refuse("lease-held", row);
      if (args.liveFingerprint === row.fingerprint) {
        return ok({ ...row, state: "ready",
          playlist_id: args.playlistId ?? row.playlist_id ?? null,
          track_count: args.trackCount ?? null,
          runtime_ms: args.runtimeMs ?? null,
          claim_token: null, lease_until: null, updated_at: now }, "write-landed");
      }
      return ok({ ...row, state: "needs-attention",
        attention_code: "unverified-write",
        claim_token: null, lease_until: null, updated_at: now }, "uncertain");
    }

    case "decline": {
      // The DJ passes, in character, before any curation happens — so this
      // leaves pending directly and no fingerprint or claim is involved. A
      // claimed row refuses: whoever holds the lease decides that request's
      // fate. The reason is one bounded line for the page (escaped there,
      // trusted nowhere); the suggested DJ is validated against the roster
      // by the tool layer before it gets here.
      if (row.state === "declined") return ok(row, "noop");
      if (row.state !== "pending") return refuse("bad-transition", row);
      return ok({ ...row, state: "declined",
        decline_reason: String(args.reason ?? "").slice(0, DECLINE_REASON_MAX) || null,
        suggested_dj: String(args.suggestedDj ?? "").slice(0, 64) || null,
        updated_at: now });
    }

    case "release": {
      // The claimant hands its own lease back, attesting nothing was written.
      // The attestation is replacePlaylistSafely's contract — it throws only
      // while the previous contents are provably intact — and only the token
      // holder can invoke it, which is why the gate matters more here than
      // anywhere: this is the ONE path that withdraws write_started, and it
      // may only run on the word of the actor that holds that contract.
      // State stays claimed with a dead lease — claimable afresh — so the
      // no-return-to-pending invariant is untouched.
      if (row.state !== "claimed") return refuse("not-claimed", row);
      if (!args.token || args.token !== row.claim_token) return refuse("not-claimant", row);
      return ok({ ...row, write_started: 0, lease_until: now, updated_at: now });
    }

    case "dismiss": {
      if (row.state === "dismissed") return ok(row, "noop");
      if (row.state === "pending") {
        return ok({ ...row, state: "dismissed", updated_at: now });
      }
      // An abandoned claim — lease dead, nothing written — is stale intent
      // wearing a different state string; the page shows it as pending, and
      // what shows as withdrawable must actually withdraw.
      if (row.state === "claimed" && !row.write_started &&
          (row.lease_until ?? 0) <= now) {
        return ok({ ...row, state: "dismissed",
          claim_token: null, lease_until: null, updated_at: now });
      }
      return refuse("bad-transition", row);
    }

    case "acknowledge": {
      if (row.state !== "needs-attention") return refuse("bad-transition", row);
      return ok({ ...row, state: "dismissed", updated_at: now });
    }

    // Keeping a set on the shelf, in two steps for one reason: the URL is
    // minted BEFORE the record is written, and remembered here.
    //
    // Two curators can reach a fulfilled request — the fired run and the
    // hourly sweep — and `makeSlug` salts every slug it makes, deliberately,
    // because KV has no conditional write. Left alone, two keeps of one
    // request would publish two permanent pages rather than overwriting each
    // other. So the ledger hands out the slug: the first reserve stores one,
    // every later reserve returns THAT one, and a republish lands on the same
    // key. The race becomes an overwrite, which is the harmless shape of it.
    //
    // What this deliberately does NOT do is lease the reservation. A rival
    // arriving mid-flight can write its own curation over the same key — one
    // URL, one shelf entry, different prose — and that is a fair trade for a
    // window that is one KV put wide. Once committed, nothing writes again.
    case "keep-reserve": {
      // Only a fulfilled set can be kept. A record of a set that was never
      // written points at nothing, and needs-attention is exactly the state
      // where nobody knows what is on the button.
      if (row.state !== "ready") return refuse("not-ready", row);
      if (!args.slug) return refuse("slug-required", row);
      // kept_at is the SETTLED marker and kept_slug says whether a page still
      // stands. Both set: it exists, report it. kept_at alone: it existed and
      // somebody took it off the shelf, which must not be undone by the next
      // sweep that happens past. A deleted page is not outstanding work.
      // Settled because there was never a tracklist to describe — a different
      // fact from a page somebody deleted, and the two must not be told to a
      // listener in the same words.
      if (row.unrecorded) {
        return { ok: false, code: "keep-unrecorded", state: row.state };
      }
      if (row.kept_at && !row.kept_slug) {
        return { ok: false, code: "keep-removed", state: row.state };
      }
      if (row.kept_at) {
        // The slug rides out with the refusal: the caller's job is to report
        // the page that already exists, not to make a second one.
        return { ok: false, code: "already-kept", state: row.state,
          slug: row.kept_slug };
      }
      // A reservation that was never committed stands. The caller must publish
      // to THIS slug — the one on the row — and not to the one it arrived with.
      if (row.kept_slug) return ok(row, "noop");
      return ok({ ...row, kept_slug: args.slug, updated_at: now });
    }

    case "keep-commit": {
      if (row.kept_at) return ok(row, "noop");
      if (!row.kept_slug) return refuse("not-reserved", row);
      return ok({ ...row, kept_at: now, updated_at: now });
    }

    // The page was deleted. Only the slug goes: the row must stop claiming a
    // page exists (the card would offer a link to a URL that 404s), and it
    // must NOT go back to looking like an outstanding keep — the default
    // queue hands those to the curator, so clearing kept_at as well would
    // have the next hourly sweep quietly republish what somebody just
    // deleted. Keeping the set again means asking for it again.
    case "keep-removed": {
      if (!row.kept_slug) return ok(row, "noop");
      return ok({ ...row, kept_slug: null, updated_at: now });
    }

    // There is no page and there never can be: the set was fulfilled with no
    // tracklist recorded, so nothing can describe it honestly. Left alone the
    // row is offered to every hourly sweep for as long as it exists, and every
    // sweep refuses it correctly — work that can only ever fail, in front of
    // work that can succeed.
    //
    // It settles into the SAME state a deleted page leaves behind, kept_at
    // with no slug, because the two mean the same thing to everything that
    // reads them: this one is finished and no page stands. Only the caller
    // that has just read the tracklist and found none may say so, and only
    // when the read itself succeeded — a KV failure is not a missing set, and
    // this is one way.
    case "keep-unrecorded": {
      if (row.state !== "ready") return refuse("not-ready", row);
      if (row.unrecorded) return ok(row, "noop");
      if (row.kept_at) return ok(row, "noop");
      // A page is reserved or published. Whatever this caller failed to read,
      // it is not the authority on a slug somebody else minted.
      if (row.kept_slug) return refuse("bad-transition", row);
      // KV is eventually consistent: a snapshot written at fulfilment in one
      // location reads as absent from another until it propagates. A keep that
      // runs seconds behind the write can therefore see a clean, successful
      // nothing — and this marker does not come off. So the row has to have
      // been sitting still longer than propagation takes before its emptiness
      // counts as permanent. Erring slow costs one more hourly offer; erring
      // fast throws away a set somebody asked to keep.
      if (now - (row.updated_at ?? 0) < UNRECORDED_AFTER_MS) {
        return refuse("too-soon", row);
      }
      return ok({ ...row, kept_at: now, unrecorded: now, updated_at: now });
    }

    default:
      return refuse("unknown-action", row);
  }
}

// Submission gatekeeping over this DJ's live rows plus one household number.
// Order matters: a duplicate answers with the existing request (the caller
// emits NO second event — that is the "never re-fires" in the rule), before
// the outstanding refusal, so a double tap reads as "already asked" rather
// than a scolding.
export function decideSubmit(candidate, djRows, pendingCount, now = Date.now(), caps = {}) {
  const dedupeMs = caps.dedupeMs ?? DEDUPE_WINDOW_MS;
  const pendingCap = caps.pendingCap ?? PENDING_CAP;
  const live = djRows.filter((r) => !prunable(r, now));

  const dup = live.find((r) =>
    r.normalized === candidate.normalized &&
    now - r.created_at < dedupeMs &&
    (OUTSTANDING.has(r.state) || r.state === "ready" || r.state === "declined"));
  if (dup) return { ok: false, code: "duplicate", existingId: dup.id };

  const open = live.find((r) => OUTSTANDING.has(r.state));
  if (open) return { ok: false, code: "outstanding", existingId: open.id };

  if (pendingCount >= pendingCap) return { ok: false, code: "household-cap" };
  return { ok: true };
}

// THE GUEST LOCK (MC-18 stage 2, tasks/done/mc18-guest-presets.md). A request
// bound for a guest preset carries the guest's playlist id as `destination`,
// and a claim toward a destination is refused while another row holds it —
// so two fulfilments never write one guest at once. There is no lock row:
// each request locks the guest through its own claim, and advance() decides
// that claim exactly as before.
//
// A row HOLDS its destination while it is claimed and either its lease is
// live or its write has started. Claimed, because commit-ready leaves
// write_started = 1 on a ready row, and a finished set holds nothing. A dead
// lease with no write does not hold: nothing was written, the row is
// claimable afresh, and holding would stall the guest behind an abandoned
// claim for up to thirty days (prunable). A dead lease past mark-write does:
// only that row's own reconcile may judge a write that may be torn.
export function holdsDestination(row, now = Date.now()) {
  return row?.state === "claimed" && ((row.lease_until ?? 0) > now || !!row.write_started);
}

// The row holding `destination`, other than `exceptId`, among `rows` — or
// null. The claim, the door's guard and the queue's waiting mark all ask
// this, so the three cannot disagree about when a guest is busy.
export function destinationHolder(rows, destination, exceptId = null, now = Date.now()) {
  if (!destination) return null;
  return rows.find((r) => r.destination === destination && r.id !== exceptId &&
    holdsDestination(r, now)) ?? null;
}

// A claim, with the lock. advance() answers first, so a row's own story —
// already-ready, reconcile-required, a rival's live lease, settled — is told
// before the guest's; only a claim advance() would grant is refused as busy.
// A granted claim stamps the destination it was given, null included: the
// claim's stamp is the lock, and a row whose DJ took a preset since the ask
// must stop holding a guest it no longer writes. A refusal names the holder
// and carries the destination, so the object can note where the waiting row
// is going.
export function decideClaim(row, args, holders, now = Date.now()) {
  const result = advance(row, "claim", args, now);
  if (!result.ok) return result;
  const destination = args.destination || null;
  const holder = destinationHolder(holders, destination, row.id, now);
  if (holder) {
    return { ok: false, code: "destination-busy", state: row.state, destination,
      holder: { request_id: holder.id, dj: holder.dj } };
  }
  return { ...result, row: { ...result.row, destination } };
}

// Whether a listed row waits on a busy guest: a row a claim could take —
// pending, or claimed with nothing holding — whose destination another row
// holds. Answers the holder, or null.
export function waitingOn(row, holders, now = Date.now()) {
  if (!row.destination) return null;
  if (row.state !== "pending" && !(row.state === "claimed" && !holdsDestination(row, now))) return null;
  return destinationHolder(holders, row.destination, row.id, now);
}

// A claim that died before any write is stale intent, like pending — but a
// LIVE lease is never stale, whatever the row's age: a request claimed just
// inside the 30-day line must not be deleted out from under its claimant.
// Anything that reached mark-write might have touched Spotify, so it keeps
// the longer story even though its state string still says "claimed".
export function prunable(row, now = Date.now()) {
  if (row.state === "pending") return now - row.created_at > PENDING_TTL_MS;
  if (row.state === "claimed" && !row.write_started) {
    const leaseDead = (row.lease_until ?? 0) <= now;
    return leaseDead && now - row.created_at > PENDING_TTL_MS;
  }
  return now - row.updated_at > SETTLED_TTL_MS;
}

// ---------------------------------------------------------------------------
// The Durable Object. One instance for the household (idFromName below), so
// its input gate is the serialization: two fulfilments racing arrive here one
// at a time, whatever the platform did with their sandboxes. Deliberately the
// classic fetch-shaped class rather than the RPC base class — no import from
// "cloudflare:workers" means the node test suite can import this module.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS requests (
    id             TEXT PRIMARY KEY,
    dj             TEXT NOT NULL,
    normalized     TEXT NOT NULL,
    state          TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    lease_until    INTEGER,
    fingerprint    TEXT,
    write_started  INTEGER NOT NULL DEFAULT 0,
    claim_token    TEXT,
    claim_count    INTEGER NOT NULL DEFAULT 0,
    playlist_id    TEXT,
    track_count    INTEGER,
    runtime_ms     INTEGER,
    attention_code TEXT,
    decline_reason TEXT,
    suggested_dj   TEXT,
    kept_slug      TEXT,
    kept_at        INTEGER,
    unrecorded     INTEGER,
    -- MC-18: the guest preset's playlist a request is bound for, or NULL.
    -- The claim stamps it, and a claimed row holds it (holdsDestination).
    destination    TEXT
  );
  CREATE INDEX IF NOT EXISTS requests_dj    ON requests (dj, state);
  CREATE INDEX IF NOT EXISTS requests_state ON requests (state);
  -- Every call to Spotify, by the hour and by kind (2026-09-06). The
  -- development-mode quota is a number Spotify does not publish; counting
  -- our own calls is the only way to learn where it is. Kept a week.
  CREATE TABLE IF NOT EXISTS spotify_calls (
    hour     TEXT NOT NULL,
    category TEXT NOT NULL,
    n        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, category)
  );
  -- Every KV operation this Worker made, by the hour, the kind and the key's
  -- prefix (2026-09-06). Cloudflare's free tier allows 100,000 reads a day but
  -- only a thousand writes, deletes and lists, and nothing said where they
  -- went. The prefix is what names the spender: tiles is the wall, items the
  -- DJ pages, station the archive's rotation. Kept a week, like the Spotify
  -- calls beside it.
  CREATE TABLE IF NOT EXISTS kv_ops (
    hour     TEXT NOT NULL,
    op       TEXT NOT NULL,
    category TEXT NOT NULL,
    n        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, op, category)
  );
  -- And every time Spotify refused for quota: the history the owner asked
  -- for, with the wait it named.
  CREATE TABLE IF NOT EXISTS quota_hits (
    at          INTEGER PRIMARY KEY,
    retry_after INTEGER,
    category    TEXT,
    reason      TEXT
  );
  -- The endless DJ (MC-22, tasks/done/mc22-endless-dj.md): the watch's one state
  -- document (sessions, last look, the day's runs) and its log, one row per
  -- event — a session starting, a look, what it did or would have done. The
  -- log is kept a fortnight.
  CREATE TABLE IF NOT EXISTS endless_state (
    k   TEXT PRIMARY KEY,
    doc TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS endless_log (
    at     INTEGER NOT NULL,
    seq    INTEGER PRIMARY KEY AUTOINCREMENT,
    btn    INTEGER,
    event  TEXT NOT NULL,
    detail TEXT
  );
  -- The watch probe's table (2026-09-22): dormant since the endless watch
  -- was built, dropped on 2026-10-12.
  DROP TABLE IF EXISTS watch_probe;
  -- Talk sessions (MC-15, 2026-09-12): one row per voice session, keyed by
  -- the capability the Worker minted with it. A session COSTS ITS
  -- RESERVATION, always — ten minutes — because nothing a page reports can
  -- be verified and a page that under-reported could open sessions all day
  -- (Codex, MC15BCD-9Q4); and the reservation is the session's real ceiling,
  -- because this object's alarm attaches to OpenAI's sideband at the end of
  -- the window and closes the session itself. settled_sec is what was
  -- measured (by the page, or by the server's close), for the record only.
  -- The day is the house's. KV has no compare-and-swap (Codex,
  -- MC15PLAN-4K9), which is why this lives here.
  CREATE TABLE IF NOT EXISTS voice_sessions (
    cap          TEXT PRIMARY KEY,
    day          TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    -- MC-15's reservation, kept as a column because the deployed table has
    -- it NOT NULL; written 0 since MC-16, when the charge became the clock.
    reserved_min INTEGER NOT NULL DEFAULT 0,
    settled_sec  INTEGER,
    settled_at   INTEGER,
    session_id   TEXT,
    closed_by    TEXT,
    close_tries  INTEGER NOT NULL DEFAULT 0,
    retry_after  INTEGER,
    last_beat    INTEGER,
    cap_sec      INTEGER
  );
  CREATE INDEX IF NOT EXISTS voice_sessions_day ON voice_sessions (day);
  -- What search_tracks showed the curator (2026-10-18, setcheck.js): each
  -- result's lead artist, title, album and length, so a set's countable rules
  -- are checked before it is written with no Spotify call per track. Kept two
  -- days. And the sets the house sent back once, by job or request, so the
  -- next call is written as sent.
  CREATE TABLE IF NOT EXISTS seen_tracks (
    uri   TEXT PRIMARY KEY,
    lead  TEXT,
    title TEXT,
    album TEXT,
    ms    INTEGER,
    at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sent_back (
    k  TEXT PRIMARY KEY,
    at INTEGER NOT NULL
  );
`;

// A week of hours is what the calls table keeps; the refusals, three months.
const CALLS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const SEEN_KEEP_MS = 2 * 24 * 60 * 60 * 1000;
const SENT_BACK_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const HITS_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const hourKey = (now) => new Date(now).toISOString().slice(0, 13);

// ---------------------------------------------------------------------------
// THE TALK LEDGER (MC-15 stage B, 2026-09-12): the pure half, shared by the
// real object below and the node suite's fake (test/harness.js), the way
// advance() and decideSubmit() are. A reservation is a row with no
// settled_at; it is LIVE for an hour (the bridge asks), and it COUNTS as its
// reserved minutes until settled — after the hour, still as its reserved
// minutes, which is what "settles itself as fully spent" means. Settling
// replaces the reservation with the measured length, clamped to the hour.

// A line that has not said "still here" for this long is over, to the
// ledger: charged to the last beat plus the grace, and hung up at OpenAI by
// the alarm. Three beats' worth, so one lost beat costs nothing.
export const BEAT_GRACE_MS = 90_000;
const CAP_SHAPE = /^[0-9a-f]{32}$/;
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// THE CHARGE IS THE SERVER'S CLOCK (MC-16, 2026-09-12: "per minute, not per
// conversation"). A row is charged from the moment its line opened to the
// moment the ledger considers it over: its settle, or the last beat plus the
// grace, or now — whichever came first. The phone never supplies a number.
// Milliseconds throughout; seconds and minutes only where a person reads
// them (Codex, MC16-8N2A: rounding each row loses the day's remainder).
export function voiceEndAt(row, now) {
  if (row.settled_at != null) return row.settled_at;
  return Math.min(now, voiceDeadAt(row));
}
// OpenAI bills fifteen seconds for opening a WebRTC session, credited
// against the running charge (the docs, 2026-09-12): a line costs fifteen
// seconds at least, so the ledger says so too.
export const OPEN_FLOOR_MS = 15_000;
export function voiceChargeMs(row, now) {
  return Math.max(OPEN_FLOOR_MS, voiceEndAt(row, now) - row.created_at);
}
export function voiceUsedMs(rows, now) {
  return rows.reduce((n, r) => n + voiceChargeMs(r, now), 0);
}
export const voiceChargeSec = (row, now) => Math.round(voiceChargeMs(row, now) / 1000);
export const voiceUsedSec = (rows, now) => Math.round(voiceUsedMs(rows, now) / 1000);
export const voiceMinutes = (ms) => Math.ceil(Math.max(0, ms) / 60_000);
// The day's cap in milliseconds, as the rows recorded it (the Worker passes
// it on every reserve; the largest wins, so raising the cap mid-day takes
// effect).
export function voiceCapMs(rows, fallbackMin = 60) {
  const caps = rows.map((r) => r.cap_sec).filter((c) => Number.isFinite(c) && c > 0);
  return (caps.length ? Math.max(...caps) : fallbackMin * 60) * 1000;
}
// Live: open, and beaten within the grace.
export function voiceLive(row, now) {
  return !!row && row.settled_at == null && now <= voiceDeadAt(row);
}
// The server has not finished with a row until OpenAI was told (closed_by
// "server"), or the session was found gone or never bound ("expired").
export function voiceNeedsClose(row) {
  return row.closed_by == null;
}
export function voiceDeadAt(row) {
  return (row.last_beat ?? row.created_at) + BEAT_GRACE_MS;
}
// The day's totals, from ALL of the day's rows (Codex, MC16-8N2A: the
// pending rows alone forget the settled minutes). What the due and next
// decisions take.
export function voiceTotals(dayRows, now, fallbackMin = 60) {
  const capMs = voiceCapMs(dayRows, fallbackMin);
  const usedMs = voiceUsedMs(dayRows, now);
  const open = dayRows.filter((r) => r.settled_at == null).length;
  return { capMs, usedMs, open };
}
// The instant the day's cap was reached, given that `open` lines were
// running when it was: now, less the overshoot shared among them. Never
// before a row opened.
export function voiceCapCutoff(totals, now) {
  if (totals.open <= 0 || totals.usedMs < totals.capMs) return now;
  return now - Math.floor((totals.usedMs - totals.capMs) / totals.open);
}
// Where a row's charge ends when the server ends it at `now`: its grace, the
// cap cutoff, or now — the earliest. Every settlement path uses this.
export function voiceEndFor(row, totals, now) {
  return Math.max(row.created_at, Math.min(now, voiceDeadAt(row), voiceCapCutoff(totals, now)));
}
// What the alarm must act on now among a day's PENDING rows: an open line
// past its grace, every open line once the day's cap is spent, and a failed
// close whose retry is due.
export function voiceDue(pending, now, totals) {
  const capHit = totals.open > 0 && totals.usedMs >= totals.capMs;
  return pending.filter((r) => voiceNeedsClose(r) && (
    (r.settled_at == null && (capHit || voiceDeadAt(r) <= now)) ||
    (r.settled_at != null && r.retry_after != null && r.retry_after <= now)));
}
// When the alarm must next wake for a day: the earliest grace expiry, the
// moment the day's cap runs out while lines are open (every open line
// spends a second per second), or the earliest retry. Null when nothing.
export function voiceNextAt(pending, now, totals) {
  const times = [];
  const open = pending.filter((r) => r.settled_at == null && voiceNeedsClose(r));
  for (const r of open) times.push(voiceDeadAt(r));
  if (open.length && totals.open > 0) {
    times.push(now + Math.max(0, Math.floor((totals.capMs - totals.usedMs) / totals.open)));
  }
  for (const r of pending) if (voiceNeedsClose(r) && r.settled_at != null && r.retry_after != null) times.push(r.retry_after);
  return times.length ? Math.min(...times) : null;
}
// The one alarm, never moved later (Codex, MC16-8N2A: a beat that moved a
// due alarm later could postpone the cap for ever). Answers the time to set,
// or null to leave what is armed.
export function voiceArmAt(current, at) {
  if (at == null) return null;
  if (current == null || at < current) return at;
  return null;
}
// What a due row becomes after one attempt at OpenAI. `endAt` is where the
// charge stops for a row that was still open. Three transport failures with
// a growing wait, then expired: a cheat cannot make our attach fail, so the
// exposure is OpenAI's own outages, and a row is not charged for time the
// server cannot vouch for.
export const CLOSE_TRIES = 3;
export const CLOSE_RETRY_MS = 30_000;
export function voiceSweepDecide(row, outcome, now, endAt = now) {
  const settledAt = row.settled_at ?? Math.min(endAt, now);
  const base = { ...row, settled_at: settledAt, settled_sec: Math.round(voiceChargeMs({ ...row, settled_at: settledAt }, now) / 1000) };
  if (!row.session_id) return { ...base, closed_by: "expired", retry_after: null };
  if (outcome.closed) return { ...base, closed_by: "server", retry_after: null };
  const tries = (row.close_tries ?? 0) + 1;
  if (outcome.retry && tries < CLOSE_TRIES) {
    return { ...base, close_tries: tries, retry_after: now + CLOSE_RETRY_MS * tries };
  }
  return { ...base, close_tries: tries, retry_after: null, closed_by: "expired" };
}
const dayAnswer = (dayRows, now, capMin) => {
  const { capMs, usedMs } = voiceTotals(dayRows, now, capMin);
  return { used: voiceMinutes(usedMs), used_sec: Math.round(usedMs / 1000), cap_minutes: Math.round(capMs / 60_000),
    remaining: Math.max(0, Math.floor((capMs - usedMs) / 60_000)) };
};
// `dayRows` are the day's rows, `row` the one for args.cap (or null). Answers
// the op's result, with a `write` when a row must be stored, `remove` when
// one must go, `relabel` when a day's rows move.
export function voiceDecide(op, args = {}, dayRows = [], row = null, now = Date.now()) {
  const capMin = Number(args.cap_minutes) || 60;
  if (op === "voice-day") return { ok: true, ...dayAnswer(dayRows, now, capMin) };
  if (op === "voice-check") return { ok: true, live: voiceLive(row, now), day: row?.day ?? null };
  if (op === "voice-list") return { ok: true, sessions: dayRows.slice().sort((a, b) => a.created_at - b.created_at) };
  if (op === "voice-relabel") {
    if (!DAY_SHAPE.test(String(args.from ?? "")) || !DAY_SHAPE.test(String(args.to ?? ""))) return { ok: false, code: "bad-day" };
    if (args.from === args.to) return { ok: true, moved: 0 };
    return { ok: true, moved: dayRows.length, relabel: { from: args.from, to: args.to } };
  }
  if (op === "voice-reserve") {
    // A line may open while at least a minute of the day is left.
    if (!CAP_SHAPE.test(String(args.cap ?? ""))) return { ok: false, code: "bad-cap" };
    if (!DAY_SHAPE.test(String(args.day ?? ""))) return { ok: false, code: "bad-day" };
    if (row) return { ok: false, code: "exists" };
    const capSec = Math.max(1, Math.round(capMin)) * 60;
    const usedMs = voiceUsedMs(dayRows, now);
    if (capSec * 1000 - usedMs < 60_000) {
      return { ok: false, code: "cap", used: voiceMinutes(usedMs), cap_minutes: Math.round(capSec / 60) };
    }
    const fresh = { cap: args.cap, day: args.day, created_at: now, last_beat: now, cap_sec: capSec,
      reserved_min: 0, settled_sec: null, settled_at: null, session_id: null, closed_by: null,
      close_tries: 0, retry_after: null };
    return { ok: true, ...dayAnswer([...dayRows, fresh], now, capMin), write: fresh };
  }
  if (op === "voice-bind") {
    if (!row) return { ok: false, code: "unknown-session" };
    if (row.settled_at != null) return { ok: false, code: "settled" };
    const id = String(args.session_id ?? "").trim().slice(0, 120);
    if (!id) return { ok: false, code: "bad-session-id" };
    if (row.session_id) return { ok: true, note: "noop" };
    return { ok: true, write: { ...row, session_id: id } };
  }
  if (op === "voice-beat") {
    // "Still here": the charge runs on. A dead or settled line is told so,
    // and so is a line whose day is spent (Codex, MC16-8N2A: a beat must
    // not outrun the cap).
    if (!row) return { ok: false, code: "unknown-session" };
    const answer = dayAnswer(dayRows, now, capMin);
    if (!voiceLive(row, now)) return { ok: false, code: "over", ...answer };
    const { capMs, usedMs } = voiceTotals(dayRows, now, capMin);
    if (usedMs >= capMs) return { ok: false, code: "cap", ...answer };
    const next = { ...row, last_beat: now };
    const rows = dayRows.map((r) => (r.cap === row.cap ? next : r));
    return { ok: true, ...dayAnswer(rows, now, capMin), write: next };
  }
  if (op === "voice-void") {
    if (!row) return { ok: false, code: "unknown-session" };
    if (row.settled_at != null || row.session_id) return { ok: false, code: "bound" };
    return { ok: true, remove: row.cap };
  }
  if (op === "voice-settle") {
    // "Done": the charge stops — at now, or earlier if the line was already
    // dead to the ledger or the day's cap had passed (Codex, MC16-8N2A).
    // The caller (the object) tells OpenAI; `outcome` is what OpenAI said.
    // Without one (the fake, or a row never bound) the row is expired.
    if (!row) return { ok: false, code: "unknown-session" };
    if (row.settled_at != null && !voiceNeedsClose(row)) {
      return { ok: true, minutes: voiceMinutes((row.settled_sec ?? 0) * 1000), seconds: row.settled_sec, closed_by: row.closed_by, note: "noop" };
    }
    const outcome = args.outcome ?? { closed: false, seconds: null, reason: row.session_id ? "unattempted" : "unbound", retry: false };
    const endAt = row.settled_at ?? voiceEndFor(row, voiceTotals(dayRows, now, capMin), now);
    const next = voiceSweepDecide(row, outcome, now, endAt);
    return { ok: true, minutes: voiceMinutes(next.settled_sec * 1000), seconds: next.settled_sec, closed_by: next.closed_by ?? "retry", write: next };
  }
  if (op === "voice-closing") {
    // The step before the I/O (Codex, MC16-8N2A): the charge's end is
    // written first, so a beat or a rival settle cannot move it while the
    // object waits on OpenAI; the outcome is applied afterwards by
    // voice-settle, which sees settled_at already set.
    if (!row) return { ok: false, code: "unknown-session" };
    if (row.settled_at != null) return { ok: true, note: "noop", end_at: row.settled_at };
    const endAt = voiceEndFor(row, voiceTotals(dayRows, now, capMin), now);
    return { ok: true, end_at: endAt, write: { ...row, settled_at: endAt, settled_sec: Math.round(voiceChargeMs({ ...row, settled_at: endAt }, now) / 1000) } };
  }
  return { ok: false, code: "unknown-op" };
}

// THE SERVER'S CLOSE (Codex, MC15BCD-9Q4: a reservation that nothing enforces
// is not a ceiling). OpenAI documents a sideband: attach to a live session
// over a WebSocket with the API key, send session.close, and session.closed
// comes back with the usage in seconds. This is that, once, from the alarm.
// Answers { closed, seconds, reason }: closed false means the session could
// not be attached — already over, or never opened — which is not an error.
// `retry` says whether the sweep should try again later: yes for anything
// that looks like transport (the attach threw, a 5xx, no answer on the
// socket), no for a refusal that says the session is not there to close.
export async function closeLiveSession(env, sessionId, { fetcher = fetch, timeoutMs = 8000 } = {}) {
  const key = env?.OPENAI_API_KEY;
  if (!key || !sessionId) return { closed: false, seconds: null, reason: key ? "no-session" : "no-key", retry: false };
  let timer = null;
  let ws = null;
  const bounded = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ closed: false, seconds: null, reason: ws ? "no-closed-event" : "attach-timeout", retry: true }), timeoutMs);
  });
  const attempt = (async () => {
    let res;
    try {
      res = await fetcher(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`, {
        headers: { upgrade: "websocket", authorization: `Bearer ${key}` },
      });
    } catch (err) {
      return { closed: false, seconds: null, reason: `attach-failed: ${String(err?.message ?? err).slice(0, 120)}`, retry: true };
    }
    ws = res?.webSocket ?? null;
    if (!ws) {
      const status = Number(res?.status);
      const gone = status >= 400 && status < 500;
      return { closed: false, seconds: null, reason: `attach-refused: ${res?.status ?? "no socket"}`, retry: !gone };
    }
    return new Promise((resolve) => {
      try {
        ws.accept();
        ws.addEventListener("message", (m) => {
          let ev;
          try { ev = JSON.parse(typeof m.data === "string" ? m.data : ""); } catch { return; }
          if (ev?.type === "session.closed") {
            const seconds = Number(ev.usage?.seconds);
            resolve({ closed: true, seconds: Number.isFinite(seconds) ? Math.round(seconds) : null,
              reason: String(ev.reason ?? "close_requested").slice(0, 40), retry: false });
          } else if (ev?.type === "error") {
            resolve({ closed: false, seconds: null, reason: `error: ${String(ev.error?.message ?? "").slice(0, 120)}`, retry: true });
          }
        });
        ws.addEventListener("close", () => resolve({ closed: false, seconds: null, reason: "socket-closed", retry: true }));
        ws.addEventListener("error", () => resolve({ closed: false, seconds: null, reason: "socket-error", retry: true }));
        ws.send(JSON.stringify({ type: "session.close", event_id: `house_close_${Date.now()}` }));
      } catch (err) {
        resolve({ closed: false, seconds: null, reason: `send-failed: ${String(err?.message ?? err).slice(0, 120)}`, retry: true });
      }
    });
  })();
  const out = await Promise.race([attempt, bounded]);
  clearTimeout(timer);
  if (ws) { try { ws.close(1000, "closed by the house"); } catch { /* already gone */ } }
  return out;
}

// Columns that arrived after the table shipped. `CREATE TABLE IF NOT EXISTS`
// does nothing at all to a table that already exists, and the deployed ledger
// has rows in it — so a new column reaches production by ALTER or not at all.
//
// Guarded by what the table actually has rather than by catching SQLite's
// duplicate-column error: a catch there swallows the real errors too, and this
// runs in a constructor, where a swallowed error means a ledger that looks
// fine and is missing a column. Reading table_info costs one query per object
// wake, which is nothing beside being wrong about the schema.
const ADDED_COLUMNS = [
  ["requests", "kept_slug", "TEXT"],
  ["requests", "kept_at", "INTEGER"],
  ["requests", "unrecorded", "INTEGER"],
  // What the counter said at the moment Spotify refused (2026-09-06). The
  // point of counting was to find where the unpublished line is, and only a
  // number written down AT the refusal can say: a count read afterwards has
  // the whole lockout's worth of nothing in it, and then the recovery burst.
  ["quota_hits", "calls_24h", "INTEGER"],
  // The Talk ledger's second shape (MC-15, Codex MC15FIX-3T8): the table
  // shipped to no house before these existed, but the rule holds anyway.
  ["voice_sessions", "session_id", "TEXT"],
  ["voice_sessions", "closed_by", "TEXT"],
  ["voice_sessions", "close_tries", "INTEGER NOT NULL DEFAULT 0"],
  ["voice_sessions", "retry_after", "INTEGER"],
  // MC-16: the last "still here", and the day's cap as the row saw it.
  ["voice_sessions", "last_beat", "INTEGER"],
  ["voice_sessions", "cap_sec", "INTEGER"],
  // MC-18 stage 2: the guest a request is bound for. No index, on purpose:
  // SCHEMA runs before this, so an index on it there would name a column the
  // deployed table does not have yet — and what it would search is a
  // household's handful of claimed rows.
  ["requests", "destination", "TEXT"],
];

export function ensureColumns(sql) {
  const added = [];
  for (const table of new Set(ADDED_COLUMNS.map(([t]) => t))) {
    // The table names are literals in this file and never reach here from a
    // caller, which is the only reason this may be interpolated at all.
    const have = new Set(sql.exec(`PRAGMA table_info(${table})`)
      .toArray().map((c) => c.name));
    for (const [t, name, type] of ADDED_COLUMNS) {
      if (t !== table || have.has(name)) continue;
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      added.push(`${table}.${name}`);
    }
  }
  return added;
}

// Reads hand rows onward (eventually to the agent surface and the page);
// the claim token is the one field that is a capability rather than a fact,
// so it stays between the claimant and the ledger.
function publicRow(row) {
  const { claim_token, ...rest } = row;
  return rest;
}

const COLUMNS = ["id", "dj", "normalized", "state", "created_at", "updated_at",
  "lease_until", "fingerprint", "write_started", "claim_token", "claim_count",
  "playlist_id", "track_count", "runtime_ms", "attention_code",
  "decline_reason", "suggested_dj", "kept_slug", "kept_at", "unrecorded",
  // #save writes exactly these with INSERT OR REPLACE, which rewrites the
  // whole row: a column missing here is nulled at the next transition.
  "destination"];

// THE HOME HELPER'S DOCUMENT, AS STORED (MC-29): `changedAt` is when the
// speakers last read differently — a new song, a pause, another source — not
// when the helper last posted. A Spotify answer kept before it may still be
// true; one kept after it may not.
export function helperPutDoc(prev, doc, now) {
  const next = { ...(doc ?? {}) };
  const said = (sp) => JSON.stringify(Object.keys(sp ?? {}).sort().map((k) =>
    [k, sp[k]?.state ?? null, sp[k]?.source ?? null, sp[k]?.track ?? null, sp[k]?.artists ?? null]));
  next.changedAt = prev && said(prev.speakers) === said(next.speakers)
    ? (Number(prev.changedAt) || Number(prev.at) || now) : (Number(next.at) || now);
  return next;
}
// THE KEPT SPOTIFY ANSWER (MC-29, tasks/done/mc29-helper-first-player.md): the
// last player read, stamped with when the read STARTED. A read that began
// before the last playback write (and its settling seconds) is refused, so
// an answer from before a pause can never outlive it; so is one older than
// the answer kept. The stored text, or null to keep what is there.
export function playerPutDoc(cur, at, st) {
  const t = Number(at) || 0;
  const forgotAt = Number(cur?.forgotAt) || 0;
  if (!t || t < forgotAt || t <= (Number(cur?.at) || 0)) return null;
  const text = JSON.stringify({ at: t, st: st ?? null, forgotAt });
  return text.length > 60_000 ? null : text;
}
export function playerForgetDoc(cur, until, now) {
  return JSON.stringify({ forgotAt: Math.max(Number(until) || now, Number(cur?.forgotAt) || 0) });
}
export function keptPlayerOut(cur) {
  return cur?.at ? { at: cur.at, st: cur.st ?? null } : null;
}

export class StationLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env ?? {};
    this.sql = state.storage.sql;
    this.sql.exec(SCHEMA);
    // Runs on every wake, not once: there is no migration ledger here and no
    // deploy hook to hang one on. It is a read and, on all but the first wake
    // after a schema change, nothing else.
    ensureColumns(this.sql);
  }

  #row(id) {
    return this.sql.exec("SELECT * FROM requests WHERE id = ?", id)
      .toArray()[0] ?? null;
  }

  // Every claimed row bound for one guest: what the lock, the door's guard
  // and the queue's waiting mark judge with destinationHolder.
  #claimedOn(destination) {
    return this.sql.exec(
      "SELECT * FROM requests WHERE destination = ? AND state = 'claimed'", destination).toArray();
  }

  #voiceSave(w) {
    this.sql.exec(
      `INSERT OR REPLACE INTO voice_sessions
         (cap, day, created_at, reserved_min, settled_sec, settled_at, session_id, closed_by, close_tries, retry_after, last_beat, cap_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      w.cap, w.day, w.created_at, w.reserved_min ?? 0, w.settled_sec ?? null, w.settled_at ?? null,
      w.session_id ?? null, w.closed_by ?? null, w.close_tries ?? 0, w.retry_after ?? null,
      w.last_beat ?? null, w.cap_sec ?? null);
  }
  #voicePending() {
    return this.sql.exec("SELECT * FROM voice_sessions WHERE closed_by IS NULL").toArray();
  }
  #voiceDayRows(day) {
    return this.sql.exec("SELECT * FROM voice_sessions WHERE day = ?", day).toArray();
  }
  // The pending rows by day, each day with its totals from ALL its rows.
  #voiceDays(now) {
    const byDay = new Map();
    for (const r of this.#voicePending()) {
      if (!byDay.has(r.day)) byDay.set(r.day, { pending: [], totals: voiceTotals(this.#voiceDayRows(r.day), now) });
      byDay.get(r.day).pending.push(r);
    }
    return byDay;
  }
  // The one alarm, at the earliest moment any day needs the server; never
  // moved later than what is armed (a beat re-arms only earlier — an early
  // alarm finds nothing due and re-arms itself). Nothing pending: no alarm.
  async #voiceArm(now) {
    let at = null;
    for (const { pending, totals } of this.#voiceDays(now).values()) {
      const t = voiceNextAt(pending, now, totals);
      if (t != null && (at == null || t < at)) at = t;
    }
    if (at == null) { await this.state.storage.deleteAlarm(); return null; }
    const cur = await this.state.storage.getAlarm();
    const set = voiceArmAt(cur, at);
    if (set != null) await this.state.storage.setAlarm(set);
    return set ?? cur;
  }
  // "Done", from the page or the sweep: OpenAI is told over the sideband,
  // and what it said decides the row. The fake passes an outcome in; the
  // object makes its own.
  async #voiceOutcome(row) {
    if (!row.session_id) return { closed: false, seconds: null, reason: "unbound", retry: false };
    return closeLiveSession(this.env, row.session_id);
  }
  // THE SWEEP: for each day, every line past its grace, every line once the
  // day's cap is spent, every failed close whose retry is due — the charge's
  // end written FIRST, then OpenAI told, a few at a time, then the outcome
  // applied to the row as it is by then. The page's word is never needed.
  async #voiceSweep(now) {
    const closed = [];
    for (const [day, { pending, totals }] of this.#voiceDays(now)) {
      const due = voiceDue(pending, now, totals);
      for (const row of due) {
        if (row.settled_at == null) this.#voiceSave({ ...row, settled_at: voiceEndFor(row, totals, now) });
      }
      for (let i = 0; i < due.length; i += 4) {
        const batch = due.slice(i, i + 4);
        const outcomes = await Promise.all(batch.map((row) => this.#voiceOutcome(row)));
        batch.forEach((row, k) => {
          const fresh = this.sql.exec("SELECT * FROM voice_sessions WHERE cap = ?", row.cap).toArray()[0] ?? row;
          if (fresh.closed_by != null) return;
          const next = voiceSweepDecide(fresh, outcomes[k], now, fresh.settled_at ?? now);
          this.#voiceSave(next);
          closed.push({ cap: row.cap, day, by: next.closed_by ?? "retry", seconds: next.settled_sec, reason: outcomes[k].reason,
            tries: next.close_tries ?? 0 });
          console.log(`talk:sweep cap=${row.cap.slice(0, 8)} ${next.closed_by ?? "retry"} ${outcomes[k].reason} seconds=${next.settled_sec ?? "?"} tries=${next.close_tries ?? 0}`);
        });
      }
    }
    const next = await this.#voiceArm(now);
    return { ok: true, closed, next };
  }
  async alarm() {
    await this.#voiceSweep(Date.now());
  }

  #save(row) {
    this.sql.exec(
      `INSERT OR REPLACE INTO requests (${COLUMNS.join(", ")})
       VALUES (${COLUMNS.map(() => "?").join(", ")})`,
      ...COLUMNS.map((c) => row[c] ?? null));
  }

  // Mirrors prunable(); runs at the top of every op, so a lookup by id can
  // never act on a row the retention rules have already disowned. A claimed
  // row with a live lease is spared whatever its age.
  #prune(now) {
    this.sql.exec(
      `DELETE FROM requests WHERE state = 'pending' AND created_at < ?`,
      now - PENDING_TTL_MS);
    this.sql.exec(
      `DELETE FROM requests
        WHERE state = 'claimed' AND write_started = 0
          AND (lease_until IS NULL OR lease_until <= ?)
          AND created_at < ?`, now, now - PENDING_TTL_MS);
    this.sql.exec(
      `DELETE FROM requests
        WHERE (state IN ('ready', 'dismissed', 'needs-attention', 'declined')
               OR (state = 'claimed' AND write_started = 1))
          AND updated_at < ?`, now - SETTLED_TTL_MS);
  }

  // THE HOME HELPER'S LINE (MC-25 stage 2). The helper keeps one WebSocket
  // open to this object (the Worker checked its secret before handing the
  // upgrade here); a press on the bar becomes a command down it, and the
  // helper's answer comes back up it. Hibernatable, so an idle line costs
  // nothing, and a "ping" is answered without waking the object.
  #waiting = new Map();
  #helperSocket() { return this.state.getWebSockets("helper")[0] ?? null; }
  // One document of endless_state by its key, or null.
  #stateDoc(k) {
    const row = this.sql.exec("SELECT doc FROM endless_state WHERE k = ?", k).toArray()[0];
    try { return row ? JSON.parse(row.doc) : null; } catch { return null; }
  }
  webSocketMessage(ws, message) {
    let m = null;
    try { m = JSON.parse(String(message)); } catch { return; }
    const done = m?.id && this.#waiting.get(m.id);
    if (done) { this.#waiting.delete(m.id); done(m); }
  }
  webSocketClose(ws) { try { ws.close(); } catch { /* already closed */ } }

  async fetch(request) {
    if (request.headers.get("upgrade") === "websocket") {
      // One helper: a new line replaces the old one.
      for (const old of this.state.getWebSockets("helper")) { try { old.close(1000, "replaced"); } catch { /* gone */ } }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], ["helper"]);
      try { this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch { /* older runtime */ }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, code: "bad-request" }, { status: 400 }); }
    const { op, args = {} } = body ?? {};
    // An explicit clock makes lease expiry testable against the real binding;
    // the only caller is this Worker, which is already trusted with the data.
    const now = Number.isFinite(args.now) ? args.now : Date.now();
    this.#prune(now);

    if (op === "submit") {
      const { id, dj, normalized } = args;
      if (!id || !dj || !normalized) {
        return Response.json({ ok: false, code: "bad-request" });
      }
      const djRows = this.sql.exec(
        "SELECT * FROM requests WHERE dj = ?", dj).toArray();
      const pendingCount = this.sql.exec(
        "SELECT COUNT(*) AS n FROM requests WHERE state = 'pending'")
        .toArray()[0].n;
      const decision = decideSubmit({ normalized }, djRows, pendingCount, now, args.caps);
      if (!decision.ok) return Response.json(decision);
      this.#save({ id, dj, normalized, state: "pending",
        created_at: now, updated_at: now, write_started: 0, claim_count: 0,
        // MC-18: where the set is bound, when a live guest applies; NULL for
        // every other ask. Shown only — the claim's stamp is the lock.
        destination: typeof args.destination === "string" && args.destination ? args.destination : null });
      return Response.json({ ok: true, id });
    }

    if (op === "list") {
      // The state filter belongs in SQL, before the LIMIT: filtered after,
      // an old pending request could hide behind fifty settled rows and the
      // sweep would never see it.
      const where = [];
      const params = [];
      if (args.dj) { where.push("dj = ?"); params.push(args.dj); }
      if (args.destination) { where.push("destination = ?"); params.push(args.destination); }
      const states = Array.isArray(args.states) && args.states.length
        ? args.states : null;
      if (states) {
        where.push(`state IN (${states.map(() => "?").join(", ")})`);
        params.push(...states);
      }
      const rows = this.sql.exec(
        `SELECT * FROM requests
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY created_at DESC LIMIT 50`, ...params).toArray();
      // MC-18: a row waiting on a busy guest says whose request holds it —
      // the claim's own rule, over every claimed row on that guest rather
      // than only the fifty listed. No destination, no query.
      const onGuest = new Map();
      for (const r of rows) {
        if (!r.destination || (r.state !== "pending" && r.state !== "claimed")) continue;
        if (!onGuest.has(r.destination)) onGuest.set(r.destination, this.#claimedOn(r.destination));
        const h = waitingOn(r, onGuest.get(r.destination), now);
        if (h) r.waiting_for = { request_id: h.id, dj: h.dj };
      }
      return Response.json({ ok: true, rows: rows.map(publicRow) });
    }

    // THE DOOR'S GUARD (MC-18): a read, by the claim's own rule. `except` is
    // the asking fulfilment's own row, which holds the guest it is writing.
    if (op === "destination-busy") {
      const destination = typeof args.destination === "string" ? args.destination : "";
      if (!destination) return Response.json({ ok: false, code: "bad-request" });
      const h = destinationHolder(this.#claimedOn(destination), destination, args.except ?? null, now);
      return Response.json({ ok: true, busy: h ? { request_id: h.id, dj: h.dj } : null });
    }

    if (op === "get") {
      const row = this.#row(args.id);
      return Response.json(row
        ? { ok: true, row: publicRow(row) }
        : { ok: false, code: "unknown-request" });
    }

    // The Spotify call counter. One upsert per call; the read sums the last
    // two days and lists the refusals. Nothing here touches a request row.
    if (op === "count") {
      const category = String(args.category ?? "other").slice(0, 20);
      this.sql.exec(
        `INSERT INTO spotify_calls (hour, category, n) VALUES (?, ?, 1)
           ON CONFLICT (hour, category) DO UPDATE SET n = n + 1`,
        hourKey(now), category);
      return Response.json({ ok: true });
    }
    // A whole request's Spotify tally in one call, the same way (2026-09-12).
    if (op === "count-many") {
      const ops = Array.isArray(args.ops) ? args.ops.slice(0, 60) : [];
      const hour = hourKey(now);
      for (const row of ops) {
        const [category, n] = Array.isArray(row) ? row : [];
        if (!category) continue;
        this.sql.exec(
          `INSERT INTO spotify_calls (hour, category, n) VALUES (?, ?, ?)
             ON CONFLICT (hour, category) DO UPDATE SET n = n + ?`,
          hour, String(category).slice(0, 20), Number(n) || 0, Number(n) || 0);
      }
      return Response.json({ ok: true });
    }
    // A whole request's KV tally in one call: the Worker counts in memory and
    // hands it over once at the end, so a page that touches twenty keys costs
    // one write here rather than twenty.
    if (op === "seen-put") {
      const rows = Array.isArray(args.rows) ? args.rows.slice(0, 300) : [];
      for (const r of rows) {
        const [uri, lead, title, album, ms] = Array.isArray(r) ? r : [];
        if (typeof uri !== "string" || !uri) continue;
        this.sql.exec(
          `INSERT OR REPLACE INTO seen_tracks (uri, lead, title, album, ms, at) VALUES (?, ?, ?, ?, ?, ?)`,
          uri.slice(0, 80), String(lead ?? "").slice(0, 120), String(title ?? "").slice(0, 200),
          String(album ?? "").slice(0, 200), Number(ms) || 0, now);
      }
      this.sql.exec("DELETE FROM seen_tracks WHERE at < ?", now - SEEN_KEEP_MS);
      return Response.json({ ok: true });
    }
    if (op === "seen-get") {
      const uris = (Array.isArray(args.uris) ? args.uris : []).filter((u) => typeof u === "string").slice(0, 120);
      const tracks = {};
      for (const uri of uris) {
        const row = this.sql.exec("SELECT lead, title, album, ms FROM seen_tracks WHERE uri = ? AND at >= ?",
          uri, now - SEEN_KEEP_MS).toArray()[0];
        if (row) tracks[uri] = { uri, lead: row.lead, title: row.title, album: row.album, ms: row.ms };
      }
      const key = String(args.key ?? "").slice(0, 120);
      // A chat write's send-back counts for minutes, not the week a request's
      // does (MC-33): its key is the DJ on a playlist, not one ask.
      const within = Number(args.sent_within_ms);
      const span = within > 0 ? Math.min(within, SENT_BACK_KEEP_MS) : SENT_BACK_KEEP_MS;
      const back = key ? this.sql.exec("SELECT at FROM sent_back WHERE k = ? AND at >= ?", key, now - span).toArray()[0] : null;
      return Response.json({ ok: true, tracks, sent_back: !!back });
    }
    if (op === "sent-back") {
      const key = String(args.key ?? "").slice(0, 120);
      if (key) this.sql.exec("INSERT OR REPLACE INTO sent_back (k, at) VALUES (?, ?)", key, now);
      this.sql.exec("DELETE FROM sent_back WHERE at < ?", now - SENT_BACK_KEEP_MS);
      return Response.json({ ok: true });
    }
    // The write that followed a send-back used it up (MC-33): kept under a
    // spent name for the day's count, so the DJ's next set is counted afresh.
    if (op === "sent-used") {
      const key = String(args.key ?? "").slice(0, 120);
      const row = key ? this.sql.exec("SELECT at FROM sent_back WHERE k = ?", key).toArray()[0] : null;
      if (row) {
        this.sql.exec("INSERT OR REPLACE INTO sent_back (k, at) VALUES (?, ?)", `${key}@${row.at}`, row.at);
        this.sql.exec("DELETE FROM sent_back WHERE k = ?", key);
      }
      return Response.json({ ok: true });
    }
    // Sets sent back in the last day, by the path that wrote them: req (a DJ
    // page's ask), job (endless), write (the Claude app, ChatGPT or Talk).
    if (op === "sent-back-day") {
      const out = { requests: 0, endless: 0, chat_and_talk: 0 };
      const name = { req: "requests", job: "endless", write: "chat_and_talk" };
      for (const r of this.sql.exec("SELECT k FROM sent_back WHERE at >= ?", now - 24 * 60 * 60 * 1000).toArray()) {
        const n = name[String(r.k).split(":")[0]];
        if (n) out[n] += 1;
      }
      return Response.json({ ok: true, ...out });
    }
    if (op === "kv-count") {
      const ops = Array.isArray(args.ops) ? args.ops.slice(0, 60) : [];
      const hour = hourKey(now);
      for (const row of ops) {
        const [kind, category, n] = Array.isArray(row) ? row : [];
        if (!kind || !category) continue;
        this.sql.exec(
          `INSERT INTO kv_ops (hour, op, category, n) VALUES (?, ?, ?, ?)
             ON CONFLICT (hour, op, category) DO UPDATE SET n = n + ?`,
          hour, String(kind).slice(0, 10), String(category).slice(0, 24),
          Number(n) || 0, Number(n) || 0);
      }
      return Response.json({ ok: true });
    }
    if (op === "kv-ops") {
      this.sql.exec("DELETE FROM kv_ops WHERE hour < ?", hourKey(now - CALLS_KEEP_MS));
      const hours = this.sql.exec(
        "SELECT hour, op, category, n FROM kv_ops WHERE hour >= ? ORDER BY hour",
        hourKey(now - 48 * 60 * 60 * 1000)).toArray();
      return Response.json({ ok: true, hours });
    }
    if (op === "quota-hit") {
      // The count goes in WITH the refusal. Read here rather than passed in,
      // because the Worker asking for it first would be a second round trip
      // at the worst moment and could only be staler than this. It counts the
      // whole hour that contains "24 hours ago", so it can run up to an hour
      // wide — a line this rough is still the only line we have.
      const from = hourKey(now - 24 * 60 * 60 * 1000);
      const sum = this.sql.exec(
        "SELECT SUM(n) AS n FROM spotify_calls WHERE hour >= ? AND category != 'player-saved'", from).toArray()[0];
      this.sql.exec(
        `INSERT OR REPLACE INTO quota_hits (at, retry_after, category, reason, calls_24h)
           VALUES (?, ?, ?, ?, ?)`,
        now, Number(args.retryAfter) || null, String(args.category ?? "other").slice(0, 20),
        String(args.reason ?? "").slice(0, 40) || null, Number(sum?.n) || 0);
      return Response.json({ ok: true });
    }
    // THE HOME HELPER'S READING (MC-25): the last thing the helper on the
    // house's Chromebook read from each WiiM over the LAN, as one document.
    // The Worker stamps the time; freshness is judged on the way out.
    if (op === "helper-put") {
      const doc = helperPutDoc(this.#stateDoc("helper"), args.doc, now);
      this.sql.exec("INSERT OR REPLACE INTO endless_state (k, doc) VALUES ('helper', ?)",
        JSON.stringify(doc).slice(0, 20_000));
      return Response.json({ ok: true });
    }
    // The helper's word, and with it the house's kept Spotify answer (MC-29),
    // so a page's poll asks the ledger once for both.
    if (op === "helper-get") {
      return Response.json({ ok: true, doc: this.#stateDoc("helper"), hands: !!this.#helperSocket(),
        player: keptPlayerOut(this.#stateDoc("player")) });
    }
    // The helper's key made new (the locks review, 2026-10-25): its line,
    // opened with the old one, is closed; it comes back only with the new.
    if (op === "helper-drop") {
      const lines = this.state.getWebSockets("helper");
      for (const ws of lines) { try { ws.close(1008, "the house has a new helper key"); } catch { /* gone */ } }
      return Response.json({ ok: true, dropped: lines.length });
    }
    // A helper taken away (2026-10-21): what it last read goes with it.
    if (op === "helper-forget") {
      this.sql.exec("DELETE FROM endless_state WHERE k = 'helper'");
      return Response.json({ ok: true });
    }
    if (op === "player-put") {
      const next = playerPutDoc(this.#stateDoc("player"), args.at, args.st);
      if (next) this.sql.exec("INSERT OR REPLACE INTO endless_state (k, doc) VALUES ('player', ?)", next);
      return Response.json({ ok: true, kept: !!next });
    }
    if (op === "player-forget") {
      this.sql.exec("INSERT OR REPLACE INTO endless_state (k, doc) VALUES ('player', ?)",
        playerForgetDoc(this.#stateDoc("player"), args.until, now));
      return Response.json({ ok: true });
    }
    // A command for the helper: sent down its line, answered within 10 s or
    // not at all (6 s until 2026-10-09: a radio key's 3 s settle and its two
    // read-backs could outlast it, and a move that worked said "timeout").
    // The Worker decides what may be sent; this only carries it.
    if (op === "helper-command") {
      const ws = this.#helperSocket();
      if (!ws) return Response.json({ ok: false, code: "helper-off" });
      const id = crypto.randomUUID();
      const reply = await new Promise((resolve) => {
        this.#waiting.set(id, resolve);
        // The key's number rides along for "key" (MC-25 stage 3: it was
        // dropped here at first, and the helper rightly refused a key with
        // no number).
        try { ws.send(JSON.stringify({ id, cmd: args.cmd, speaker: args.speaker, ...(Number.isInteger(args.n) ? { n: args.n } : {}) })); }
        catch { this.#waiting.delete(id); resolve({ ok: false, code: "helper-off" }); return; }
        setTimeout(() => { if (this.#waiting.delete(id)) resolve({ ok: false, code: "timeout" }); }, 10000);
      });
      return Response.json({ ok: !!reply?.ok, code: reply?.code ?? (reply?.ok ? "ok" : "failed"), reading: reply?.reading ?? null });
    }
    if (op === "endless-get") {
      const row = this.sql.exec("SELECT doc FROM endless_state WHERE k = 'watch'").toArray()[0];
      let doc = null;
      try { doc = row ? JSON.parse(row.doc) : null; } catch { doc = null; }
      return Response.json({ ok: true, doc });
    }
    // COMPARE AND SET (MC-24, from Codex's review of MC-23): every write
    // stamps the next `rev`, and a write that names `ifRev` lands only on the
    // revision it read — the cron's watch and a page's tap, each reading the
    // whole document and putting it back, can no longer undo each other. The
    // loser is told and reads again. A write without `ifRev` still lands.
    if (op === "endless-put") {
      const row = this.sql.exec("SELECT doc FROM endless_state WHERE k = 'watch'").toArray()[0];
      let cur = null;
      try { cur = row ? JSON.parse(row.doc) : null; } catch { cur = null; }
      const had = Number(cur?.rev) || 0;
      if (args.ifRev !== undefined && args.ifRev !== null && Number(args.ifRev) !== had) {
        return Response.json({ ok: false, conflict: true, rev: had });
      }
      const doc = { ...(args.doc ?? {}), rev: had + 1 };
      this.sql.exec("INSERT OR REPLACE INTO endless_state (k, doc) VALUES ('watch', ?)",
        JSON.stringify(doc).slice(0, 1_500_000));
      return Response.json({ ok: true, rev: had + 1 });
    }
    if (op === "endless-log") {
      for (const e of (args.events ?? []).slice(0, 20)) {
        this.sql.exec("INSERT INTO endless_log (at, btn, event, detail) VALUES (?, ?, ?, ?)",
          Number(e.at) || now, Number.isFinite(Number(e.btn)) ? Number(e.btn) : null,
          String(e.event ?? "note").slice(0, 32), e.detail == null ? null : String(e.detail).slice(0, 400));
      }
      return Response.json({ ok: true });
    }
    if (op === "endless-list") {
      this.sql.exec("DELETE FROM endless_log WHERE at < ?", now - 14 * 24 * 60 * 60 * 1000);
      const rows = this.sql.exec(
        "SELECT at, btn, event, detail FROM endless_log ORDER BY seq DESC LIMIT ?",
        Math.min(200, Math.max(1, Number(args.limit) || 40))).toArray().reverse();
      return Response.json({ ok: true, rows });
    }
    if (op === "calls") {
      this.sql.exec("DELETE FROM spotify_calls WHERE hour < ?", hourKey(now - CALLS_KEEP_MS));
      this.sql.exec("DELETE FROM quota_hits WHERE at < ?", now - HITS_KEEP_MS);
      const hours = this.sql.exec(
        "SELECT hour, category, n FROM spotify_calls WHERE hour >= ? ORDER BY hour",
        hourKey(now - 48 * 60 * 60 * 1000)).toArray();
      const hits = this.sql.exec(
        "SELECT at, retry_after, category, reason, calls_24h FROM quota_hits ORDER BY at DESC LIMIT 30").toArray();
      return Response.json({ ok: true, hours, hits });
    }

    // The Talk ledger: reserve, bind, check, settle, sweep, and the day's
    // total. One row per session; nothing here touches a request row.
    if (op === "voice-sweep") return Response.json(await this.#voiceSweep(now));
    if (op === "voice-reserve" || op === "voice-bind" || op === "voice-beat" || op === "voice-check" ||
        op === "voice-settle" || op === "voice-void" || op === "voice-day" ||
        op === "voice-list" || op === "voice-relabel") {
      this.sql.exec("DELETE FROM voice_sessions WHERE created_at < ?", now - CALLS_KEEP_MS);
      const cap = String(args.cap ?? "");
      const row = cap
        ? (this.sql.exec("SELECT * FROM voice_sessions WHERE cap = ?", cap).toArray()[0] ?? null)
        : null;
      const day = String(args.day ?? args.from ?? row?.day ?? "");
      const dayRows = day
        ? this.sql.exec("SELECT * FROM voice_sessions WHERE day = ?", day).toArray() : [];
      // "Done": the charge's end is written before OpenAI is asked anything,
      // then the outcome is applied to the row as it stands afterwards.
      let current = row;
      let withOutcome = args;
      if (op === "voice-settle" && row && row.closed_by == null && !args.outcome) {
        const closing = voiceDecide("voice-closing", args, dayRows, row, now);
        if (closing.write) { this.#voiceSave(closing.write); current = closing.write; }
        const outcome = await this.#voiceOutcome(current);
        current = this.sql.exec("SELECT * FROM voice_sessions WHERE cap = ?", cap).toArray()[0] ?? current;
        withOutcome = { ...args, outcome };
      }
      const { write, remove, relabel, ...out } = voiceDecide(op, withOutcome, dayRows, current, now);
      if (write) this.#voiceSave(write);
      if (remove) this.sql.exec("DELETE FROM voice_sessions WHERE cap = ?", remove);
      if (relabel) this.sql.exec("UPDATE voice_sessions SET day = ? WHERE day = ?", relabel.to, relabel.from);
      if (out.ok && ["voice-reserve", "voice-bind", "voice-beat", "voice-settle", "voice-void"].includes(op)) await this.#voiceArm(now);
      return Response.json(out);
    }

    const ACTIONS = new Set(["claim", "mark-write", "commit-ready",
      "commit-attention", "reconcile", "release", "decline", "dismiss",
      "acknowledge", "keep-reserve", "keep-commit", "keep-removed",
      "keep-unrecorded"]);
    if (ACTIONS.has(op)) {
      const row = this.#row(args.id);
      if (!row) return Response.json({ ok: false, code: "unknown-request" });
      // THE GUEST LOCK (MC-18): the rows holding the guest are read here and
      // the claim saved below with no await between, so the object's one
      // input gate serializes two claims toward one guest the way it already
      // serializes two claims on one request.
      const result = op === "claim"
        ? decideClaim(row, args, args.destination ? this.#claimedOn(args.destination) : [], now)
        : advance(row, op, args, now);
      if (result.ok && result.note !== "noop") this.#save(result.row);
      // A busy refusal leaves the row as it was but for where it is going:
      // a row asked with no destination learns it here, so the re-fire and
      // the queue's waiting mark can find it. Nothing else on it moves.
      if (result.code === "destination-busy" && row.destination !== result.destination) {
        this.sql.exec("UPDATE requests SET destination = ? WHERE id = ?", result.destination, row.id);
      }
      return Response.json(result.ok
        ? { ok: true, row: result.row, note: result.note }
        : result);
    }

    return Response.json({ ok: false, code: "unknown-op" }, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// What the Worker calls. One named object for the household: the name IS the
// serialization domain, so everything about requests goes through one gate.

export function stationStub(env) {
  return env.STATION.get(env.STATION.idFromName("household"));
}

export async function station(env, op, args = {}, { unbudgeted = false } = {}) {
  // The ledger fetch is a real subrequest, so it rides the same budget as
  // every Spotify call whenever the caller attached one (withBudget). Same
  // marker discipline as the Worker's subrequest(): a broad catch has to be
  // able to tell "we ran out" from a claim about the ledger itself.
  // `unbudgeted` is for the kept player answer (MC-29): a Cloudflare call,
  // under the thousand-an-invocation ceiling (docs/gotchas.md), that must
  // never crowd out a Spotify call or be refused for one.
  const b = unbudgeted ? null : env?.__budget;
  if (b) {
    if (!b.critical && b.remaining <= 0) {
      const err = new Error(
        "out of per-invocation subrequest budget at the request ledger — " +
        "make this call on its own");
      err.budgetExhausted = true;
      throw err;
    }
    b.remaining -= 1;
  }
  const call = () => stationStub(env).fetch("https://station/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, args }),
  });
  try {
    return await (await call()).json();
  } catch (err) {
    // A deploy resets the Durable Object under an in-flight call, and the
    // caller gets an error rather than an answer — measured the hard way
    // (2026-09-06): two fulfilments claimed their request and then lost
    // "mark-write" to a deploy, and the curator, told to trust every
    // refusal, stopped; both sat as dead claims for the sweep. The token-
    // bearing ops are safe to ask twice (mark-write again is a no-op, a
    // commit of the same sequence answers noop, a read is a read), so those
    // are asked once more after a beat. A CLAIM is not: if the first one
    // landed, the second is refused as held, and the caller would give up
    // on a request it in fact holds — so a claim's error stays an error.
    if (op !== "claim" && /reset|code was updated|durable object/i.test(String(err?.message ?? ""))) {
      await new Promise((r) => setTimeout(r, 400));
      return (await call()).json();
    }
    throw err;
  }
}

// The KV half: the submission record, written at composer time with the
// SHORT retention — request text must not outlive the 30-day pending window
// if nothing ever comes of it. Whoever settles the request re-puts the
// record with the long retention (settledTtl below), so a rendered outcome
// keeps its text exactly as long as the ledger keeps its row, measured from
// the settling, not the asking.
export function requestKey(id) {
  return `request:${id}`;
}

export async function putRequestRecord(env, rec, { settled = false } = {}) {
  const ttlMs = settled ? SETTLED_TTL_MS : PENDING_TTL_MS;
  await env.PROGRAMS.put(requestKey(rec.id), JSON.stringify(rec),
    { expirationTtl: Math.ceil(ttlMs / 1000) });
}

export async function getRequestRecord(env, id) {
  return env.PROGRAMS.get(requestKey(id), { type: "json" });
}
