// THE ACCESS TOKEN IS KEPT IN KV (2026-09-23). Every fresh isolate used to
// refresh — a call to Spotify and a KV write of the rotated refresh token —
// 137 writes in a day of testing, for a token that lasts an hour.

import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";

const { getAccessToken, forgetAccessTokens } = __test;

test("a fresh isolate uses the stored token while it has time left, and refreshes (and stores) once it has not", async () => {
  const f = installFetch();
  try {
    const e = makeEnv();
    await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r1", access_token: "stored", expires_at: Date.now() + 30 * 60_000 }));
    forgetAccessTokens();
    f.calls.length = 0;
    assert.equal(await getAccessToken(e), "stored");
    assert.ok(!f.calls.some((c) => c.includes("/api/token")), "no refresh");

    // A minute or less left: refreshed, and the new token stored beside the refresh token.
    await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r1", access_token: "old", expires_at: Date.now() + 30_000 }));
    forgetAccessTokens();
    assert.equal(await getAccessToken(e), "test-token");
    const kept = JSON.parse(await e.TOKENS.get("spotify"));
    assert.equal(kept.access_token, "test-token");
    assert.ok(kept.expires_at > Date.now() + 50 * 60_000);
    assert.ok(kept.refresh_token);

    // And the next fresh isolate takes that one.
    forgetAccessTokens();
    f.calls.length = 0;
    assert.equal(await getAccessToken(e), "test-token");
    assert.ok(!f.calls.some((c) => c.includes("/api/token")));
  } finally { forgetAccessTokens(); f.restore(); }
});

// A REFRESH THAT LOST A RACE (2026-09-23, from a Codex review lead): another
// isolate refreshed first, the service rotated the refresh token, and this
// one's refresh is refused. It reads the store again rather than calling the
// login lost.
test("a refused refresh reads the store again: another isolate's fresh token is used, a newer refresh token is tried once", async () => {
  const f = installFetch();
  const inner = globalThis.fetch;
  try {
    const e = makeEnv();
    await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r1", access_token: "old", expires_at: Date.now() - 1000 }));
    let calls = 0;
    globalThis.fetch = async (u, init = {}) => {
      if (String(u).includes("accounts.spotify.com/api/token")) {
        calls++;
        // The other isolate wins while this one is on the wire.
        await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r2", access_token: "theirs", expires_at: Date.now() + 30 * 60_000 }));
        return new Response('{"error":"invalid_grant"}', { status: 400 });
      }
      return inner(u, init);
    };
    forgetAccessTokens();
    assert.equal(await getAccessToken(e), "theirs");
    assert.equal(calls, 1, "no second refresh when the stored token is good");

    // The store has a newer refresh token but no usable access token: one retry with it.
    await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r1", access_token: "old", expires_at: Date.now() - 1000 }));
    const sent = [];
    globalThis.fetch = async (u, init = {}) => {
      if (String(u).includes("accounts.spotify.com/api/token")) {
        const rt = new URLSearchParams(String(init.body)).get("refresh_token");
        sent.push(rt);
        if (rt === "r1") {
          await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r2" }));
          return new Response('{"error":"invalid_grant"}', { status: 400 });
        }
        return Response.json({ access_token: "mine", refresh_token: "r3", expires_in: 3600 });
      }
      return inner(u, init);
    };
    forgetAccessTokens();
    assert.equal(await getAccessToken(e), "mine");
    assert.deepEqual(sent, ["r1", "r2"], "one retry, with the newer refresh token");
    assert.equal(JSON.parse(await e.TOKENS.get("spotify")).refresh_token, "r3");

    // Nothing newer in the store: the refusal stands. Since MC-31 stage 0b an
    // invalid_grant says the house is signed out (spotify-login.test.js).
    await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r1" }));
    globalThis.fetch = async (u, init = {}) => String(u).includes("accounts.spotify.com/api/token")
      ? new Response('{"error":"invalid_grant"}', { status: 400 }) : inner(u, init);
    forgetAccessTokens();
    await assert.rejects(getAccessToken(e), /signed this house out/);
  } finally { globalThis.fetch = inner; forgetAccessTokens(); f.restore(); }
});
