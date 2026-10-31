import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advance, decideSubmit, prunable, normalizeRequest, fingerprintUris,
  ensureColumns, holdsDestination, destinationHolder, decideClaim, waitingOn,
  DEDUPE_WINDOW_MS, LEASE_MS, PENDING_TTL_MS, SETTLED_TTL_MS, PENDING_CAP,
} from "../station.js";
import { makeStation } from "./harness.js";

// The ledger's decisions are pure functions over plain rows; this suite is
// the transition matrix. The Durable Object shell that runs these against
// real SQLite lives in mcp/test-workerd/.

const T0 = 1_700_000_000_000;
const FP = "aaaa";
const FP2 = "bbbb";

function row(over = {}) {
  return {
    id: "r1", dj: "hank", normalized: "an hour of trains",
    state: "pending", created_at: T0, updated_at: T0,
    lease_until: null, fingerprint: null, write_started: 0, claim_count: 0,
    playlist_id: null, track_count: null, runtime_ms: null,
    attention_code: null, ...over,
  };
}

const TOK = "tok-1";
const claimed = (over = {}) => row({ state: "claimed", fingerprint: FP,
  claim_token: TOK, lease_until: T0 + LEASE_MS, claim_count: 1, ...over });

// --- normalization and fingerprints ---------------------------------------

test("normalizeRequest collapses the ways a phone mangles text", () => {
  assert.equal(normalizeRequest("  An  Hour\nof   TRAINS "), "an hour of trains");
  assert.equal(normalizeRequest(null), "");
});

test("fingerprint is stable, ordered, and moves when the sequence does", async () => {
  const a = await fingerprintUris(["spotify:track:1", "spotify:track:2"]);
  assert.equal(a, await fingerprintUris(["spotify:track:1", "spotify:track:2"]));
  assert.notEqual(a, await fingerprintUris(["spotify:track:2", "spotify:track:1"]),
    "order is part of the identity");
  assert.notEqual(a, await fingerprintUris(["spotify:track:1", "spotify:track:2", "spotify:track:3"]),
    "an append is a different set");
  assert.match(a, /^[0-9a-f]{32}$/);
});

// --- claim -----------------------------------------------------------------

test("claim takes a pending request, leases it, and mints a token", () => {
  const r = advance(row(), "claim", { fingerprint: FP }, T0);
  assert.equal(r.ok, true);
  assert.equal(r.row.state, "claimed");
  assert.equal(r.row.fingerprint, FP);
  assert.equal(r.row.lease_until, T0 + LEASE_MS);
  assert.equal(r.row.claim_count, 1);
  assert.equal(r.row.write_started, 0);
  assert.ok(r.row.claim_token, "the token is the claimant's identity from here on");
});

test("claim without a fingerprint is refused — the claim IS the fingerprint record", () => {
  assert.equal(advance(row(), "claim", {}, T0).code, "fingerprint-required");
});

test("a live lease refuses every rival — even one with the same fingerprint", () => {
  const rival = advance(claimed(), "claim", { fingerprint: FP2 }, T0 + 1000);
  assert.equal(rival.code, "lease-held");
  // Two honest curators CAN produce the same sequence; the same fingerprint
  // must not read as "the claimant retrying" or both would hold the pen.
  const twin = advance(claimed(), "claim", { fingerprint: FP }, T0 + 1000);
  assert.equal(twin.code, "lease-held");
  const own = advance(claimed(), "claim", { fingerprint: FP, token: TOK }, T0 + 1000);
  assert.equal(own.ok, true);
  assert.equal(own.row.lease_until, T0 + 1000 + LEASE_MS, "only the token re-arms the lease");
  const drifted = advance(claimed(), "claim", { fingerprint: FP2, token: TOK }, T0 + 1000);
  assert.equal(drifted.code, "fingerprint-mismatch",
    "a renewal naming a different sequence is a caller bug made visible, not absorbed");
});

test("an expired lease before any write is claimable afresh, any fingerprint", () => {
  const later = T0 + LEASE_MS + 1;
  const r = advance(claimed(), "claim", { fingerprint: FP2 }, later);
  assert.equal(r.ok, true);
  assert.equal(r.row.fingerprint, FP2, "nothing was written, so nothing constrains the retry");
  assert.equal(r.row.claim_count, 2);
  assert.notEqual(r.row.claim_token, TOK, "a takeover reminted the token — the dead claimant's is void");
});

test("an expired lease after mark-write demands reconciliation, not a claim", () => {
  const later = T0 + LEASE_MS + 1;
  const r = advance(claimed({ write_started: 1 }), "claim", { fingerprint: FP2 }, later);
  assert.equal(r.code, "reconcile-required");
});

test("claiming a settled request names the outcome", () => {
  assert.equal(advance(row({ state: "ready", fingerprint: FP }), "claim",
    { fingerprint: FP }, T0).code, "already-ready",
    "the caller's own success echoing back is not an error to alarm on");
  assert.equal(advance(row({ state: "ready", fingerprint: FP }), "claim",
    { fingerprint: FP2 }, T0).code, "settled");
  assert.equal(advance(row({ state: "dismissed" }), "claim",
    { fingerprint: FP }, T0).code, "settled");
  assert.equal(advance(row({ state: "needs-attention" }), "claim",
    { fingerprint: FP }, T0).code, "settled");
});

// --- mark-write ------------------------------------------------------------

test("only the token-bearing live leaseholder may declare the point of no return", () => {
  const okr = advance(claimed(), "mark-write", { token: TOK }, T0 + 1);
  assert.equal(okr.ok, true);
  assert.equal(okr.row.write_started, 1);

  assert.equal(advance(claimed(), "mark-write", { token: "stale" }, T0 + 1).code,
    "not-claimant");
  assert.equal(advance(claimed(), "mark-write", {}, T0 + 1).code, "not-claimant",
    "a fingerprint proves the sequence, never the writer");
  assert.equal(advance(claimed(), "mark-write", { token: TOK },
    T0 + LEASE_MS + 1).code, "lease-expired");
  assert.equal(advance(row(), "mark-write", { token: TOK }, T0).code,
    "not-claimed");
});

// --- commits ---------------------------------------------------------------

test("commit-ready records the outcome and releases lease and token", () => {
  const r = advance(claimed({ write_started: 1 }), "commit-ready",
    { token: TOK, fingerprint: FP, playlistId: "P", trackCount: 18, runtimeMs: 4_320_000 }, T0 + 5000);
  assert.equal(r.ok, true);
  assert.equal(r.row.state, "ready");
  assert.equal(r.row.playlist_id, "P");
  assert.equal(r.row.track_count, 18);
  assert.equal(r.row.lease_until, null);
  assert.equal(r.row.claim_token, null, "a settled request holds no capability");
});

test("commit-ready survives its own lease expiring — truth beats punctuality", () => {
  const r = advance(claimed({ write_started: 1 }), "commit-ready",
    { token: TOK, fingerprint: FP, playlistId: "P" }, T0 + LEASE_MS + 60_000);
  assert.equal(r.ok, true, "the matching token proves no rival took over — a takeover would have reminted it");
});

test("commit-ready refuses a stranger and repeats idempotently", () => {
  assert.equal(advance(claimed(), "commit-ready", { token: "stale" }, T0).code,
    "not-claimant");
  assert.equal(advance(claimed(), "commit-ready", { token: TOK }, T0).code,
    "fingerprint-mismatch", "the commit must name the sequence it wrote");
  // The full retry story: commit succeeds, the response is lost, the exact
  // same call repeats — recognized by fingerprint on the now-ready row.
  const first = advance(claimed({ write_started: 1 }), "commit-ready",
    { token: TOK, fingerprint: FP, playlistId: "P" }, T0 + 1);
  const again = advance(first.row, "commit-ready",
    { token: TOK, fingerprint: FP, playlistId: "P" }, T0 + 2);
  assert.equal(again.ok, true);
  assert.equal(again.note, "noop");
});

test("commit-attention records a bounded code from the claimant", () => {
  const r = advance(claimed(), "commit-attention",
    { token: TOK, code: "x".repeat(200) }, T0 + 1);
  assert.equal(r.ok, true);
  assert.equal(r.row.state, "needs-attention");
  assert.equal(r.row.attention_code.length, 64, "a code, never a stack trace");
  assert.equal(advance(claimed(), "commit-attention", { token: "stale" }, T0).code,
    "not-claimant");
});

// --- reconcile -------------------------------------------------------------

test("reconcile turns a matching live playlist into ready", () => {
  const dead = claimed({ write_started: 1 });
  const r = advance(dead, "reconcile",
    { liveFingerprint: FP, playlistId: "P" }, T0 + LEASE_MS + 1);
  assert.equal(r.ok, true);
  assert.equal(r.row.state, "ready");
  assert.equal(r.note, "write-landed");
});

test("reconcile turns anything else into needs-attention, never pending, never a retry", () => {
  const dead = claimed({ write_started: 1 });
  const r = advance(dead, "reconcile", { liveFingerprint: "cccc" }, T0 + LEASE_MS + 1);
  assert.equal(r.ok, true);
  assert.equal(r.row.state, "needs-attention");
  assert.equal(r.row.attention_code, "unverified-write");
});

test("reconcile echoes a settled outcome instead of alarming on retry", () => {
  const done = row({ state: "ready", fingerprint: FP });
  assert.equal(advance(done, "reconcile", { liveFingerprint: FP }, T0).note, "noop");
  const alarmed = row({ state: "needs-attention", fingerprint: FP });
  assert.equal(advance(alarmed, "reconcile", { liveFingerprint: "z" }, T0).note, "noop");
});

test("reconcile refuses when there is nothing to reconcile", () => {
  assert.equal(advance(claimed(), "reconcile", { liveFingerprint: FP },
    T0 + LEASE_MS + 1).code, "no-write", "no write started: just claim it");
  assert.equal(advance(claimed({ write_started: 1 }), "reconcile",
    { liveFingerprint: FP }, T0 + 1).code, "lease-held",
    "a live claimant is still working; the sweep must wait");
  assert.equal(advance(row(), "reconcile", { liveFingerprint: FP }, T0).code,
    "not-claimed");
});

const cand = { normalized: "an hour of trains" };

// --- decline ---------------------------------------------------------------

test("a DJ passes: pending declines with a bounded reason and a suggestion", () => {
  const r = advance(row(), "decline",
    { reason: "not my records, friend. " + "x".repeat(300), suggestedDj: "funkenstein" }, T0 + 1);
  assert.equal(r.ok, true);
  assert.equal(r.row.state, "declined");
  assert.equal(r.row.decline_reason.length, 240, "a line or two for the page, never an essay");
  assert.equal(r.row.suggested_dj, "funkenstein");
  assert.equal(advance(r.row, "decline", {}, T0 + 2).note, "noop");
});

test("decline keeps its hands off working and settled requests", () => {
  assert.equal(advance(claimed(), "decline", {}, T0).code, "bad-transition",
    "whoever holds the lease decides that request's fate");
  assert.equal(advance(row({ state: "ready" }), "decline", {}, T0).code, "bad-transition");
});

test("a same-text re-ask inside the window meets the refusal, not a new job", () => {
  const passed = row({ state: "declined" });
  const d = decideSubmit(cand, [passed], 0, T0 + 5000);
  assert.equal(d.code, "duplicate");
  assert.equal(d.existingId, "r1", "the page shows the DJ passing again, and no session is spent");
});

test("a decline frees the DJ's slot for a different ask", () => {
  const passed = row({ state: "declined" });
  const d = decideSubmit({ normalized: "something for a dinner" }, [passed], 0, T0 + 5000);
  assert.equal(d.ok, true);
});

// --- release ---------------------------------------------------------------

test("release hands the lease back on the claimant's word alone", () => {
  const r = advance(claimed({ write_started: 1 }), "release", { token: TOK }, T0 + 5000);
  assert.equal(r.ok, true);
  assert.equal(r.row.state, "claimed", "not pending — the invariant stands");
  assert.equal(r.row.write_started, 0, "withdrawn on the token holder's attestation");
  assert.equal(r.row.lease_until, T0 + 5000, "the lease is dead the moment it is handed back");
  // And the request is claimable afresh, immediately.
  const next = advance(r.row, "claim", { fingerprint: FP2 }, T0 + 5001);
  assert.equal(next.ok, true);
});

test("release refuses strangers and settled rows", () => {
  assert.equal(advance(claimed(), "release", { token: "stale" }, T0).code, "not-claimant");
  assert.equal(advance(claimed(), "release", {}, T0).code, "not-claimant");
  assert.equal(advance(row(), "release", { token: TOK }, T0).code, "not-claimed");
  assert.equal(advance(row({ state: "ready" }), "release", { token: TOK }, T0).code,
    "not-claimed");
});

// --- dismiss and acknowledge ----------------------------------------------

test("dismiss is for pending only; acknowledge drains needs-attention", () => {
  assert.equal(advance(row(), "dismiss", {}, T0).row.state, "dismissed");
  assert.equal(advance(row({ state: "dismissed" }), "dismiss", {}, T0).note, "noop");
  assert.equal(advance(row({ state: "ready" }), "dismiss", {}, T0).code, "bad-transition");
  assert.equal(advance(claimed(), "dismiss", {}, T0).code, "bad-transition",
    "a live claim is being worked on; dismissing it would orphan the claim");
  assert.equal(advance(claimed(), "dismiss", {}, T0 + LEASE_MS + 1).row.state,
    "dismissed", "an abandoned claim is stale intent — what shows as withdrawable withdraws");
  assert.equal(advance(claimed({ write_started: 1 }), "dismiss", {},
    T0 + LEASE_MS + 1).code, "bad-transition",
    "but never past the point of no return");

  assert.equal(advance(row({ state: "needs-attention" }), "acknowledge", {}, T0)
    .row.state, "dismissed");
  assert.equal(advance(row(), "acknowledge", {}, T0).code, "bad-transition");
});

// --- the one hard rule, checked exhaustively -------------------------------

test("no action returns a write-started request to pending", () => {
  const dead = claimed({ write_started: 1 });
  const attempts = [
    ["claim", { fingerprint: FP2 }], ["claim", { fingerprint: FP }],
    ["claim", { fingerprint: FP, token: TOK }],
    ["mark-write", { token: TOK }],
    ["commit-ready", { token: TOK }], ["commit-ready", { token: TOK, fingerprint: FP }],
    ["commit-attention", { token: TOK, code: "c" }],
    ["reconcile", { liveFingerprint: FP }], ["reconcile", { liveFingerprint: "z" }],
    ["release", { token: TOK }],
    ["dismiss", {}], ["acknowledge", {}],
  ];
  for (const when of [T0 + 1, T0 + LEASE_MS + 1]) {
    for (const [action, args] of attempts) {
      const r = advance(dead, action, args, when);
      if (r.ok) assert.notEqual(r.row.state, "pending", `${action} at ${when}`);
    }
  }
});

// --- submission gatekeeping ------------------------------------------------

test("a double tap inside the window points at the existing request", () => {
  const d = decideSubmit(cand, [row()], 1, T0 + 5000);
  assert.equal(d.code, "duplicate");
  assert.equal(d.existingId, "r1");
});

test("a duplicate of a READY set is still a duplicate inside the window", () => {
  const d = decideSubmit(cand, [row({ state: "ready" })], 0, T0 + 5000);
  assert.equal(d.code, "duplicate", "fast fulfilment must not turn a double tap into a second job");
});

test("dismissing clears the way even inside the window", () => {
  const d = decideSubmit(cand, [row({ state: "dismissed" })], 0, T0 + 5000);
  assert.equal(d.ok, true, "dismissal is explicit intent, not a bounce");
});

test("one outstanding request per DJ, in honest terms", () => {
  const other = { normalized: "something for a dinner" };
  assert.equal(decideSubmit(other, [row()], 1, T0 + 5000).code, "outstanding");
  assert.equal(decideSubmit(other, [claimed()], 1, T0 + 5000).code, "outstanding");
  assert.equal(decideSubmit(other, [row({ state: "ready" })], 0, T0 + 5000).ok, true,
    "a finished set does not block the next ask");
});

test("same text past the window reads as outstanding, not duplicate", () => {
  const d = decideSubmit(cand, [row()], 1, T0 + DEDUPE_WINDOW_MS + 1);
  assert.equal(d.code, "outstanding",
    "the request still exists; only the double-tap reading has aged out");
});

test("the household cap refuses with a distinct code", () => {
  assert.equal(decideSubmit(cand, [], PENDING_CAP, T0).code, "household-cap");
  assert.equal(decideSubmit(cand, [], PENDING_CAP - 1, T0).ok, true);
});

test("rows past retention cannot block a new request", () => {
  const stale = row({ created_at: T0 - PENDING_TTL_MS - 1, updated_at: T0 - PENDING_TTL_MS - 1 });
  assert.equal(decideSubmit(cand, [stale], 0, T0).ok, true);
});

// --- retention -------------------------------------------------------------

test("retention: stale intent goes at 30 days, outcomes keep 90", () => {
  assert.equal(prunable(row(), T0 + PENDING_TTL_MS - 1), false);
  assert.equal(prunable(row(), T0 + PENDING_TTL_MS + 1), true);
  assert.equal(prunable(claimed(), T0 + PENDING_TTL_MS + 1), true,
    "a claim that died before writing is stale intent");
  assert.equal(prunable(claimed({ lease_until: T0 + PENDING_TTL_MS + 2 }),
    T0 + PENDING_TTL_MS + 1), false,
    "a LIVE lease is never stale, whatever the row's age");
  assert.equal(prunable(claimed({ write_started: 1 }), T0 + PENDING_TTL_MS + 1), false,
    "a claim that may have written keeps the longer story");
  assert.equal(prunable(row({ state: "ready" }), T0 + SETTLED_TTL_MS - 1), false);
  assert.equal(prunable(row({ state: "ready" }), T0 + SETTLED_TTL_MS + 1), true);
  assert.equal(prunable(row({ state: "needs-attention" }), T0 + SETTLED_TTL_MS + 1), true);
});

// --- keeping a set on the shelf -------------------------------------------

const ready = (over = {}) => row({ state: "ready", fingerprint: FP,
  playlist_id: "pl1", track_count: 12, updated_at: T0 + 1000, ...over });

test("only a fulfilled set can be reserved a page", () => {
  for (const state of ["pending", "claimed", "needs-attention", "declined",
    "dismissed"]) {
    const r = advance(row({ state }), "keep-reserve", { slug: "party-aaa111" }, T0);
    assert.equal(r.ok, false);
    assert.equal(r.code, "not-ready",
      `${state} has no set anybody can point a page at`);
  }
  assert.equal(advance(ready(), "keep-reserve", {}, T0).code, "slug-required");
});

test("the ledger hands out ONE slug, however many curators ask", () => {
  const first = advance(ready(), "keep-reserve", { slug: "party-aaa111" }, T0);
  assert.equal(first.ok, true);
  assert.equal(first.row.kept_slug, "party-aaa111");

  // The rival arrives with a freshly salted slug of its own and is told to
  // use the first one — so its write lands on the same key.
  const rival = advance(first.row, "keep-reserve", { slug: "party-bbb222" }, T0 + 5);
  assert.equal(rival.ok, true);
  assert.equal(rival.note, "noop");
  assert.equal(rival.row.kept_slug, "party-aaa111",
    "one request, one URL — two permanent pages is the thing this prevents");
});

test("a committed keep refuses a second one and names the page that exists", () => {
  const reserved = advance(ready(), "keep-reserve", { slug: "party-aaa111" }, T0).row;
  const done = advance(reserved, "keep-commit", {}, T0 + 10);
  assert.equal(done.ok, true);
  assert.equal(done.row.kept_at, T0 + 10);

  const again = advance(done.row, "keep-reserve", { slug: "party-ccc333" }, T0 + 20);
  assert.equal(again.ok, false);
  assert.equal(again.code, "already-kept");
  assert.equal(again.slug, "party-aaa111",
    "the caller reports the page that exists rather than making a second");

  const recommit = advance(done.row, "keep-commit", {}, T0 + 30);
  assert.equal(recommit.ok, true);
  assert.equal(recommit.note, "noop");
  assert.equal(recommit.row.kept_at, T0 + 10, "the first commit's time stands");
});

test("committing what was never reserved is refused, not invented", () => {
  const r = advance(ready(), "keep-commit", {}, T0);
  assert.equal(r.ok, false);
  assert.equal(r.code, "not-reserved");
});

test("the migration adds only what the table is missing, and drops nothing", () => {
  const execs = [];
  const fakeSql = (columns) => ({
    exec(q) {
      execs.push(q);
      return { toArray: () => q.startsWith("PRAGMA")
        ? columns.map((name) => ({ name })) : [] };
    },
  });

  // The shape production is running: seventeen columns and rows in them.
  assert.deepEqual(ensureColumns(fakeSql(["id", "dj", "state"])),
    ["requests.kept_slug", "requests.kept_at", "requests.unrecorded", "requests.destination", "quota_hits.calls_24h",
      "voice_sessions.session_id", "voice_sessions.closed_by", "voice_sessions.close_tries", "voice_sessions.retry_after",
      "voice_sessions.last_beat", "voice_sessions.cap_sec"]);
  assert.equal(execs.filter((q) => q.startsWith("ALTER")).length, 11);
  assert.ok(execs.includes("ALTER TABLE voice_sessions ADD COLUMN close_tries INTEGER NOT NULL DEFAULT 0"));
  // MC-18: the guest a request is bound for reaches the deployed table the
  // same way, and older rows read NULL.
  assert.ok(execs.includes("ALTER TABLE requests ADD COLUMN destination TEXT"));
  assert.ok(!execs.some((q) => /DROP|DELETE|CREATE TABLE/i.test(q)),
    "a migration that can lose the rows it migrates is not a migration");

  // And on every wake after that, which is when it actually runs.
  execs.length = 0;
  assert.deepEqual(
    ensureColumns(fakeSql(
      ["id", "dj", "state", "kept_slug", "kept_at", "unrecorded", "destination", "calls_24h",
        "session_id", "closed_by", "close_tries", "retry_after", "last_beat", "cap_sec"])), []);
  assert.ok(!execs.some((q) => q.startsWith("ALTER")));
});

test("a removed keep stays removed — the next sweep must not put it back", () => {
  const kept = advance(
    advance(ready(), "keep-reserve", { slug: "party-aaa111" }, T0).row,
    "keep-commit", {}, T0 + 10).row;

  const gone = advance(kept, "keep-removed", {}, T0 + 20);
  assert.equal(gone.ok, true);
  assert.equal(gone.row.kept_slug, null, "no link to a page that is deleted");
  assert.equal(gone.row.kept_at, T0 + 10,
    "and the settled marker STAYS: cleared, this row reads as outstanding work");

  const again = advance(gone.row, "keep-reserve", { slug: "party-ddd444" }, T0 + 30);
  assert.equal(again.ok, false);
  assert.equal(again.code, "keep-removed",
    "an hourly curator finding this must leave it, not republish it");

  assert.equal(advance(ready(), "keep-removed", {}, T0).note, "noop");
});

const HOUR = 60 * 60 * 1000;

test("a set with no tracklist recorded settles instead of being offered forever", () => {
  // Only once it has sat still longer than KV takes to propagate a write:
  // a snapshot that exists and has not arrived yet reads exactly like one
  // that was never written, and this marker does not come off.
  const fresh = advance(ready(), "keep-unrecorded", {}, T0 + 1000);
  assert.equal(fresh.ok, false);
  assert.equal(fresh.code, "too-soon",
    "seconds after fulfilment, an empty read is not evidence of anything");

  const T = T0 + HOUR + 2000;
  const settled = advance(ready(), "keep-unrecorded", {}, T);
  assert.equal(settled.ok, true);
  assert.equal(settled.row.kept_at, T);
  assert.equal(settled.row.unrecorded, T,
    "and it is marked as never-recorded, not as a page somebody deleted");
  assert.equal(settled.row.kept_slug ?? null, null,
    "settled with no page — the same shape a deleted one leaves behind");

  const again = advance(settled.row, "keep-reserve", { slug: "party-aaa111" }, T + 10);
  assert.equal(again.ok, false);
  assert.equal(again.code, "keep-unrecorded",
    "told to leave it alone, and told WHY — nobody took a page off the shelf");
  assert.equal(advance(settled.row, "keep-unrecorded", {}, T + 20).note, "noop");
});

test("settling as unrecorded cannot erase a page or run ahead of one", () => {
  const pending = advance({ ...ready(), state: "pending" },
    "keep-unrecorded", {}, T0 + HOUR + 2000);
  assert.equal(pending.ok, false);
  assert.equal(pending.code, "not-ready",
    "a set that was never written may yet be fulfilled and recorded");

  const reserved = advance(ready(), "keep-reserve", { slug: "party-aaa111" }, T0).row;
  const clash = advance(reserved, "keep-unrecorded", {}, T0 + HOUR + 2000);
  assert.equal(clash.ok, false);
  assert.equal(clash.code, "bad-transition",
    "whatever this caller could not read, a slug somebody minted is not its call");
});

// --- the guest lock (MC-18 stage 2) ---------------------------------------
//
// A request bound for a guest preset carries the guest's playlist as its
// destination, and a claim toward it is refused while another row holds it.
// holdsDestination is the one rule; the claim, the door's guard and the
// queue's waiting mark all judge by it.

const G = "GUESTSPOTIFY0000000001";
const G2 = "0b1f2c3d-aaaa-bbbb-cccc-000000000002";

test("a guest is held by a live claim, and by a dead one past mark-write — by nothing else", () => {
  const live = claimed({ id: "a", destination: G });
  assert.equal(holdsDestination(live, T0 + 1), true, "a live lease holds");
  assert.equal(holdsDestination(claimed({ id: "a", destination: G, write_started: 1 }), T0 + LEASE_MS + 1), true,
    "a dead lease past mark-write holds: only its own reconcile may judge the write");
  assert.equal(holdsDestination(live, T0 + LEASE_MS + 1), false,
    "a dead lease with no write does not: nothing was written, and holding would stall the guest for a month");
  assert.equal(holdsDestination(row({ state: "ready", write_started: 1, destination: G }), T0 + 1), false,
    "commit-ready leaves write_started = 1 on a ready row, and a finished set holds nothing");
  assert.equal(holdsDestination(row({ destination: G }), T0), false, "nor does a pending row");
  assert.equal(holdsDestination(row({ state: "needs-attention", write_started: 1, destination: G }), T0), false);
});

test("the holder is another row on the same guest: never the row itself, never another guest's", () => {
  const a = claimed({ id: "a", dj: "hank", destination: G });
  assert.equal(destinationHolder([a], G, "b", T0 + 1)?.id, "a");
  assert.equal(destinationHolder([a], G, "a", T0 + 1), null, "a row does not hold against itself");
  assert.equal(destinationHolder([a], G2, "b", T0 + 1), null, "each guest is its own lock");
  assert.equal(destinationHolder([a], null, "b", T0 + 1), null, "no destination, no lock");
});

test("a claim toward a busy guest is refused, naming whose request holds it", () => {
  const a = claimed({ id: "a", dj: "hank", destination: G });
  const b = row({ id: "b", dj: "monk" });
  const r = decideClaim(b, { fingerprint: FP2, destination: G }, [a], T0 + 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, "destination-busy");
  assert.deepEqual(r.holder, { request_id: "a", dj: "hank" });
  assert.equal(r.state, "pending", "the loser is still pending: nothing was claimed");
  assert.equal(r.destination, G, "and the refusal says where it was going");
  assert.equal(decideClaim(b, { fingerprint: FP2, destination: G2 }, [a], T0 + 1).ok, true,
    "the other guest is free");
  assert.equal(decideClaim(b, { fingerprint: FP2, destination: G }, [a], T0 + LEASE_MS + 1).ok, true,
    "the holder's lease died with nothing written: free");
  assert.equal(decideClaim(b, { fingerprint: FP2, destination: G },
    [{ ...a, state: "ready", write_started: 1, lease_until: null, claim_token: null }], T0 + 1).ok, true,
    "the holder committed: free");
  assert.equal(decideClaim(b, { fingerprint: FP2 }, [a], T0 + 1).ok, true,
    "a claim toward no guest is the claim it always was");
});

test("the claim stamps the destination it was given — over submit's, over none, and none over submit's", () => {
  const asked = row({ destination: G });
  assert.equal(decideClaim(asked, { fingerprint: FP, destination: G2 }, [], T0).row.destination, G2,
    "the claim locks where the write really goes");
  assert.equal(decideClaim(row(), { fingerprint: FP, destination: G }, [], T0).row.destination, G,
    "a row asked before the flip gets its destination at its claim");
  assert.equal(decideClaim(asked, { fingerprint: FP }, [], T0).row.destination, null,
    "a set going to a DJ's own preset stops holding the guest");
  // Otherwise it is advance()'s claim: the same lease, count and a fresh token.
  const c = decideClaim(row(), { fingerprint: FP, destination: G }, [], T0);
  const plain = advance(row(), "claim", { fingerprint: FP }, T0);
  assert.equal(c.row.state, plain.row.state);
  assert.equal(c.row.lease_until, plain.row.lease_until);
  assert.equal(c.row.claim_count, plain.row.claim_count);
  assert.ok(c.row.claim_token);
});

test("a row's own story is told before the guest's", () => {
  const holders = [claimed({ id: "a", destination: G, lease_until: T0 + 10 * LEASE_MS })];
  assert.equal(decideClaim(row({ state: "ready", fingerprint: FP }), { fingerprint: FP, destination: G }, holders, T0 + 1).code,
    "already-ready", "a success echoing back is reported as one, busy guest or not");
  assert.equal(decideClaim(claimed({ write_started: 1 }), { fingerprint: FP2, destination: G }, holders, T0 + LEASE_MS + 1).code,
    "reconcile-required", "a write that may be torn is reconciled first");
  assert.equal(decideClaim(claimed(), { fingerprint: FP2, destination: G }, holders, T0 + 1).code, "lease-held");
  assert.equal(decideClaim(row({ state: "dismissed" }), { fingerprint: FP, destination: G }, holders, T0 + 1).code,
    "settled");
});

test("the queue's waiting mark: a row a claim could take, on a guest another row holds", () => {
  const a = claimed({ id: "a", dj: "hank", destination: G });
  assert.equal(waitingOn(row({ id: "b", destination: G }), [a], T0 + 1)?.id, "a");
  assert.equal(waitingOn(claimed({ id: "b", destination: G, lease_until: T0 }), [a], T0 + 1)?.id, "a",
    "a claim that died before writing is claimable, so it waits too");
  assert.equal(waitingOn(claimed({ id: "b", destination: G }), [a], T0 + 1), null, "a holder is not waiting");
  assert.equal(waitingOn(row({ id: "b" }), [a], T0 + 1), null, "no destination, not waiting");
  assert.equal(waitingOn(row({ id: "b", destination: G2 }), [a], T0 + 1), null);
  assert.equal(waitingOn(row({ id: "b", state: "ready", destination: G }), [a], T0 + 1), null,
    "a finished row waits for nothing");
});

test("the node fake runs the same lock the object does", async () => {
  const st = makeStation();
  const call = async (op, args) => (await st.get().fetch("https://station/",
    { method: "POST", body: JSON.stringify({ op, args }) })).json();
  assert.equal((await call("submit", { id: "a", dj: "hank", normalized: "x", destination: G, now: T0 })).ok, true);
  assert.equal((await call("submit", { id: "b", dj: "monk", normalized: "y", now: T0 + 1 })).ok, true);
  assert.equal(st.rows.get("a").destination, G);
  assert.equal(st.rows.get("b").destination, null, "an ask no live guest applies to carries none");
  const ca = await call("claim", { id: "a", fingerprint: FP, destination: G, now: T0 + 2 });
  assert.equal(ca.ok, true);
  const cb = await call("claim", { id: "b", fingerprint: FP2, destination: G, now: T0 + 3 });
  assert.equal(cb.code, "destination-busy");
  assert.deepEqual(cb.holder, { request_id: "a", dj: "hank" });
  assert.equal(st.rows.get("b").state, "pending");
  assert.equal(st.rows.get("b").claim_count, 0);
  assert.equal(st.rows.get("b").destination, G, "the refusal notes where the waiting row is going");
  const listed = await call("list", { states: ["pending", "claimed"], now: T0 + 4 });
  assert.deepEqual(listed.rows.find((r) => r.id === "b").waiting_for, { request_id: "a", dj: "hank" });
  assert.ok(!("waiting_for" in listed.rows.find((r) => r.id === "a")));
  assert.ok(!("waiting_for" in st.rows.get("b")), "the mark is an answer, never stored");
  assert.deepEqual((await call("list", { states: ["pending"], destination: G, now: T0 + 4 })).rows.map((r) => r.id), ["b"]);
  assert.deepEqual(await call("destination-busy", { destination: G, now: T0 + 4 }),
    { ok: true, busy: { request_id: "a", dj: "hank" } });
  assert.deepEqual(await call("destination-busy", { destination: G, except: "a", now: T0 + 4 }),
    { ok: true, busy: null }, "the writer's own row is the guard's exception");
  await call("mark-write", { id: "a", token: ca.row.claim_token, now: T0 + 5 });
  await call("commit-ready", { id: "a", token: ca.row.claim_token, fingerprint: FP, playlistId: G, now: T0 + 6 });
  assert.equal(st.rows.get("a").destination, G, "a transition keeps it");
  assert.equal((await call("claim", { id: "b", fingerprint: FP2, destination: G, now: T0 + 7 })).ok, true,
    "and once the first set is written the second claims");
});
