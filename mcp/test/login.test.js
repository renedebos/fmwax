// The browser step, without a browser.
//
// The PKCE flow is short and every part of it is a place to be quietly wrong:
// a challenge that does not match its verifier, a state check that lets a
// stranger's code through, a listener opened after the redirect has already
// arrived. These drive the real code with a stubbed service and a scripted GET
// to the loopback port, so the flow is exercised rather than described.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rmSync, statSync, readFileSync, mkdtempSync, existsSync,
  mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { login, savedLogin, SERVICES, useTokenDir, tokenDirPath,
  writeSecret, finish } from "../install/login.js";

// Point the whole module at a temporary directory BEFORE any test runs. An
// earlier version of this file cleaned up by deleting the real .tokens/, so
// `npm test` logged the machine out of Tidal. The suite now cannot reach it.
const REAL_TOKENS = tokenDirPath();
const TOKEN_DIR = mkdtempSync(join(tmpdir(), "mc-tokens-"));
useTokenDir(TOKEN_DIR);
// THE PORT (2026-10-17, the test that failed now and then): the real login
// listens on 8888, the port the Spotify and Tidal apps were registered with,
// so anything else holding 8888 (a second run of the suite, a review running
// it) failed these tests. Here they listen on a port of this process's own.
const REGISTERED = { spotify: SERVICES.spotify.redirect, tidal: SERVICES.tidal.redirect };
const PORT = 20000 + (process.pid % 20000);
for (const s of ["spotify", "tidal"]) SERVICES[s].redirect = REGISTERED[s].replace(":8888/", `:${PORT}/`);

// Every test runs the real login against a fake service. `token` and `me` are
// what the service answers; `browser` decides what comes back to the loopback
// redirect, and defaults to approving properly.
async function drive(service, {
  token = { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "s" },
  tokenStatus = 200,
  me = { display_name: "Someone", id: "x", product: "premium" },
  meStatus = 200,
  browser = (url) => ({ code: "the-code", state: url.searchParams.get("state") }),
} = {}) {
  const printed = [];
  const real = globalThis.fetch;
  const seen = { exchange: null, verified: 0 };

  globalThis.fetch = async (input, init = {}) => {
    const href = String(input?.url ?? input);
    // The loopback GET is the browser, not the service — let it through.
    if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(href)) return real(input, init);
    if (href === SERVICES[service].token) {
      seen.exchange = Object.fromEntries(new URLSearchParams(init.body));
      return new Response(JSON.stringify(token), { status: tokenStatus });
    }
    seen.verified += 1;
    return new Response(JSON.stringify(me), { status: meStatus });
  };

  try {
    const started = login(service, "client-123",
      { open: false, log: (s) => printed.push(String(s)), timeoutMs: 4000 });

    // The listener is up before the URL is printed; poll for it rather than
    // sleeping a fixed amount, and give up rather than hang if it never comes.
    let url = null;
    for (let i = 0; i < 400 && !url; i++) {
      const hit = printed.join("\n").match(/https:\/\/\S+/);
      if (hit) url = new URL(hit[0]);
      else await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(url, `no authorize URL was printed: ${printed.join(" | ")}`);

    const back = new URL(url.searchParams.get("redirect_uri"));
    for (const [k, v] of Object.entries(browser(url))) {
      if (v != null) back.searchParams.set(k, v);
    }
    const html = await real(back).then((r) => r.text());

    const out = await started.then((ok) => ({ ok }), (err) => ({ err }));
    return { ...out, url, printed, seen, html, said: printed.join("\n") };
  } finally {
    globalThis.fetch = real;
    rmSync(TOKEN_DIR, { recursive: true, force: true });
  }
}

test("the challenge is the SHA-256 of the verifier, and no secret is ever sent", async () => {
  // The whole point of PKCE: the authorize step carries a hash, the exchange
  // carries the preimage, and a client secret appears nowhere. That is what
  // lets a household register a public client and keep nothing long-lived.
  const r = await drive("spotify");
  assert.ok(r.ok, r.err?.message);
  assert.equal(r.url.searchParams.get("code_challenge_method"), "S256");
  const expected = createHash("sha256").update(r.seen.exchange.code_verifier)
    .digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(r.url.searchParams.get("code_challenge"), expected);
  assert.ok(!r.url.searchParams.has("client_secret"), "not in the authorize URL");
  assert.ok(!("client_secret" in r.seen.exchange), "nor in the exchange");
  assert.equal(r.seen.exchange.grant_type, "authorization_code");
  assert.equal(r.seen.exchange.redirect_uri, SERVICES.spotify.redirect,
    "the redirect is repeated at the exchange, as the spec requires");
});

test("a code arriving with the wrong state is refused, not spent", async () => {
  // Anything on the machine can reach this port while it is open. A code from
  // an authorization this process did not start is not ours to exchange.
  const r = await drive("spotify", { browser: () => ({ code: "c", state: "not-the-one" }) });
  assert.ok(r.err, "the login failed");
  assert.match(r.err.message, /state did not match/);
  assert.equal(r.seen.exchange, null, "nothing was exchanged");
  assert.match(r.html, /Not connected/);
});

test("the service's own refusal comes back in words", async () => {
  const r = await drive("tidal", { browser: () => ({ error: "access_denied" }) });
  assert.ok(r.err);
  assert.match(r.err.message, /access_denied/);
  assert.equal(r.seen.exchange, null);
});

test("a service that returns no refresh token fails loudly and writes nothing", async () => {
  // An hour later everything would stop, with nothing to say why.
  const r = await drive("spotify", { token: { access_token: "at", expires_in: 3600 } });
  assert.ok(r.err);
  assert.match(r.err.message, /no refresh token/);
  assert.equal(savedLogin("spotify"), null);
});

test("a refused exchange says which service and what it answered", async () => {
  const r = await drive("tidal", { tokenStatus: 400, token: { error: "invalid_grant" } });
  assert.ok(r.err);
  assert.match(r.err.message, /Tidal refused the exchange: 400/);
});

test("the token file keeps the refresh token, at 0600, and prints neither", async () => {
  const r = await drive("spotify", {
    token: { access_token: "SECRET-ACCESS", refresh_token: "SECRET-REFRESH", expires_in: 3600 },
  });
  assert.ok(r.ok, r.err?.message);
  // rmSync in drive() has cleaned up by now, so assert on what it returned and
  // on what was printed — the file's own checks live in the next test.
  assert.ok(!r.said.includes("SECRET-"), "no credential on the console");
  assert.match(r.said, /connected as Someone/);
});

test("the saved file is owner-only and holds no access token", async () => {
  const real = globalThis.fetch;
  const printed = [];
  globalThis.fetch = async (input, init = {}) => {
    const href = String(input?.url ?? input);
    if (/^http:\/\/127\.0\.0\.1:/.test(href)) return real(input, init);
    if (href === SERVICES.spotify.token) {
      return new Response(JSON.stringify({
        access_token: "SECRET-ACCESS", refresh_token: "SECRET-REFRESH",
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ display_name: "D", product: "premium" }), { status: 200 });
  };
  try {
    const started = login("spotify", "cid",
      { open: false, log: (s) => printed.push(String(s)), timeoutMs: 4000 });
    let url = null;
    for (let i = 0; i < 400 && !url; i++) {
      const hit = printed.join("\n").match(/https:\/\/\S+/);
      if (hit) url = new URL(hit[0]); else await new Promise((r) => setTimeout(r, 5));
    }
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "c");
    back.searchParams.set("state", url.searchParams.get("state"));
    await real(back);
    await started;

    const file = join(TOKEN_DIR, "spotify.json");
    assert.equal(statSync(file).mode & 0o777, 0o600, "owner only");
    const body = readFileSync(file, "utf8");
    assert.ok(body.includes("SECRET-REFRESH"), "the long-lived one is kept");
    assert.ok(!body.includes("SECRET-ACCESS"), "the four-hour one is not");
    assert.equal(savedLogin("spotify").refresh_token, "SECRET-REFRESH");
    assert.equal(savedLogin("tidal"), null, "and a service not done reads as not done");
  } finally {
    globalThis.fetch = real;
    rmSync(TOKEN_DIR, { recursive: true, force: true });
  }
});

test("a free Spotify account connects, and is told exactly what it cannot do", async () => {
  // Not an error: curating works fine on a free account. Play is what does
  // not, and Premium is not a scope — it is only visible by asking.
  const r = await drive("spotify", { me: { display_name: "D", product: "free" } });
  assert.ok(r.ok, r.err?.message);
  assert.match(r.said, /not premium/);
  assert.match(r.said, /Pressing the preset still works/);
});

test("a verify call that fails is a failed login, not a quiet one", async () => {
  const r = await drive("tidal", { meStatus: 401 });
  assert.ok(r.err);
  assert.match(r.err.message, /Tidal answered 401/);
});

test("nobody approving ends in a sentence rather than a wait forever", async () => {
  const real = globalThis.fetch;
  const printed = [];
  try {
    await assert.rejects(
      () => login("spotify", "cid",
        { open: false, log: (s) => printed.push(String(s)), timeoutMs: 200 }),
      /nobody approved within/);
  } finally {
    globalThis.fetch = real;
    rmSync(TOKEN_DIR, { recursive: true, force: true });
  }
});

test("the two services ask for what they need and nothing else", () => {
  // The redirect hosts are NOT interchangeable: Spotify rejects `localhost`
  // and wants the literal loopback address; Tidal's dashboard takes the name.
  assert.equal(REGISTERED.spotify, "http://127.0.0.1:8888/callback");
  assert.equal(REGISTERED.tidal, "http://localhost:8888/callback");
  // Tidal's list is exactly two: an unrecognised scope name produces an opaque
  // Error 1002 that names no parameter at all.
  assert.equal(SERVICES.tidal.scope, "playlists.read playlists.write");
  const spotify = SERVICES.spotify.scope.split(" ");
  assert.equal(new Set(spotify).size, spotify.length, "no scope asked for twice");
  assert.ok(spotify.includes("ugc-image-upload"),
    "covers need it, and a token carries the scopes it was minted with");
  assert.ok(!spotify.includes("user-read-email"), "nothing asked for that is not used");
});

test("an unknown service, or no client id, says so before opening anything", async () => {
  const quiet = () => {};
  await assert.rejects(() => login("apple", "cid", { open: false, log: quiet }), /unknown service/);
  await assert.rejects(() => login("spotify", "", { open: false, log: quiet }), /no Spotify client id/);
});

test("the code can be pasted back when the browser is on another machine", async () => {
  // A Chromebook, a laptop, a phone: the approval happens over there and the
  // redirect to localhost lands nowhere. The address bar still holds the code,
  // and PKCE is what makes pasting it safe — the verifier never left here.
  const real = globalThis.fetch;
  const printed = [];
  const { Readable } = await import("node:stream");
  const fakeStdin = new Readable({ read() {} });
  const realStdin = { on: process.stdin.on, off: process.stdin.off, pause: process.stdin.pause };
  process.stdin.on = fakeStdin.on.bind(fakeStdin);
  process.stdin.off = fakeStdin.off.bind(fakeStdin);
  process.stdin.pause = () => {};

  globalThis.fetch = async (input, init = {}) => {
    const href = String(input?.url ?? input);
    if (href === SERVICES.tidal.token) {
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    const started = login("tidal", "cid", {
      open: false, paste: true, timeoutMs: 4000,
      log: (s) => printed.push(String(s)),
    });
    let url = null;
    for (let i = 0; i < 400 && !url; i++) {
      const hit = printed.join("\n").match(/https:\/\/\S+/);
      if (hit) url = new URL(hit[0]); else await new Promise((r) => setTimeout(r, 5));
    }
    // What the failed page's address bar would hold, pasted whole.
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "pasted-code");
    back.searchParams.set("state", url.searchParams.get("state"));
    fakeStdin.push(`${back}\n`);
    await started;
    assert.equal(savedLogin("tidal").refresh_token, "r");
    assert.match(printed.join("\n"), /cannot load/, "and it warned this would happen");
  } finally {
    Object.assign(process.stdin, realStdin);
    globalThis.fetch = real;
    rmSync(TOKEN_DIR, { recursive: true, force: true });
  }
});

test("a pasted URL from somebody else's approval is refused too", async () => {
  const real = globalThis.fetch;
  const printed = [];
  const { Readable } = await import("node:stream");
  const fakeStdin = new Readable({ read() {} });
  const realStdin = { on: process.stdin.on, off: process.stdin.off, pause: process.stdin.pause };
  process.stdin.on = fakeStdin.on.bind(fakeStdin);
  process.stdin.off = fakeStdin.off.bind(fakeStdin);
  process.stdin.pause = () => {};
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    const started = login("tidal", "cid", {
      open: false, paste: true, timeoutMs: 4000, log: (s) => printed.push(String(s)),
    });
    for (let i = 0; i < 400 && !printed.some((l) => l.startsWith("https://")); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    fakeStdin.push("http://localhost:8888/callback?code=c&state=someone-elses\n");
    await assert.rejects(() => started, /state did not match/);
  } finally {
    Object.assign(process.stdin, realStdin);
    globalThis.fetch = real;
    rmSync(TOKEN_DIR, { recursive: true, force: true });
  }
});

test("an approval survives the process that printed it", async () => {
  // The two-machine case, done properly: one command prints the URL, the
  // person approves somewhere else, and a LATER command spends the code. What
  // makes it work is that the verifier was written down, not held in memory —
  // so a timeout, a closed terminal or a Ctrl-C costs nothing.
  const { finish } = await import("../install/login.js");
  const real = globalThis.fetch;
  const printed = [];
  let url = null;
  globalThis.fetch = async (input, init = {}) => {
    const href = String(input?.url ?? input);
    if (href === SERVICES.tidal.token) {
      const sent = Object.fromEntries(new URLSearchParams(init.body));
      assert.equal(sent.code, "late-code");
      assert.ok(sent.code_verifier, "the verifier came back off disk");
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "LATER" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    // Start one and let it die, the way a ten-minute timeout does.
    await login("tidal", "cid", {
      open: false, paste: false, timeoutMs: 60,
      log: (s) => { printed.push(String(s)); const h = String(s).match(/https:\/\/\S+/); if (h) url = new URL(h[0]); },
    }).then(() => assert.fail("should have timed out"), (e) => assert.match(e.message, /nobody approved/));

    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "late-code");
    back.searchParams.set("state", url.searchParams.get("state"));
    await finish("tidal", String(back), { log: () => {} });
    assert.equal(savedLogin("tidal").refresh_token, "LATER");

    // And the half-login is gone, so a second --finish cannot replay it.
    await assert.rejects(() => finish("tidal", String(back), { log: () => {} }),
      /no Tidal login is waiting/);
  } finally {
    globalThis.fetch = real;
    rmSync(TOKEN_DIR, { recursive: true, force: true });
  }
});

test("--finish refuses an address from a different login", async () => {
  const { finish } = await import("../install/login.js");
  const real = globalThis.fetch;
  let url = null;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    await login("tidal", "cid", {
      open: false, paste: false, timeoutMs: 60,
      log: (s) => { const h = String(s).match(/https:\/\/\S+/); if (h) url = new URL(h[0]); },
    }).catch(() => {});
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "c");
    back.searchParams.set("state", "a-different-login");
    await assert.rejects(() => finish("tidal", String(back), { log: () => {} }),
      /state did not match/);
    await assert.rejects(() => finish("tidal", "not a url at all", { log: () => {} }),
      /carries no code|not a URL/);
  } finally {
    globalThis.fetch = real;
    rmSync(TOKEN_DIR, { recursive: true, force: true });
  }
});


test("the suite cannot reach the real saved logins", () => {
  // The guard for the fault above: every rmSync in this file targets the temp
  // directory, and the real one is somewhere else entirely.
  assert.notEqual(TOKEN_DIR, REAL_TOKENS);
  assert.ok(REAL_TOKENS.endsWith("/.tokens"), REAL_TOKENS);
  assert.ok(!TOKEN_DIR.startsWith(REAL_TOKENS.replace(/\/\.tokens$/, "")),
    "the temp directory is outside the repo");
});

// THE CODE IS SPENT BY THEN (2026-09-08). An authorization code is single-use;
// by the time the account check runs it has already been exchanged. Doing that
// check BEFORE writing meant one flaky /me call threw away the refresh token
// and sent a household back through the whole browser dance for nothing.
//
// Driven through `finish`, which is the same `settle` the browser flow ends in,
// so the token file can be read at the moment it matters instead of after
// drive() has cleaned up.
test("the refresh token is on disk before the check that can fail runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-settle-"));
  const was = tokenDirPath();
  const realFetch = globalThis.fetch;
  try {
    useTokenDir(dir);
    writeFileSync(join(dir, ".pending-spotify.json"), JSON.stringify({
      client_id: "c", verifier: "v", state: "st", created: new Date().toISOString(),
    }), { mode: 0o600 });

    let sawTokenOnDisk = null;
    globalThis.fetch = async (input) => {
      const href = String(input?.url ?? input);
      if (href === SERVICES.spotify.token) {
        return new Response(JSON.stringify({ access_token: "at", refresh_token: "R-kept" }));
      }
      // This is the check. Whatever it answers, the token must ALREADY be down.
      sawTokenOnDisk = savedLogin("spotify")?.refresh_token ?? null;
      return new Response("no", { status: 500 });
    };

    await assert.rejects(
      () => finish("spotify", "http://127.0.0.1:8888/callback?code=X&state=st", { log: () => {} }),
      /IS SAVED/);

    assert.equal(sawTokenOnDisk, "R-kept",
      "the token was written BEFORE the check ran, not after it passed");
    assert.equal(savedLogin("spotify").refresh_token, "R-kept", "and it is still there");
    assert.equal(savedLogin("spotify").verified, false, "marked unverified, honestly");
    assert.ok(!existsSync(join(dir, ".pending-spotify.json")),
      "and the spent verifier is gone, because the code it bought cannot be spent again");
  } finally {
    globalThis.fetch = realFetch;
    useTokenDir(was);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a login that passes its check is marked verified", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-settle2-"));
  const was = tokenDirPath();
  const realFetch = globalThis.fetch;
  try {
    useTokenDir(dir);
    writeFileSync(join(dir, ".pending-spotify.json"), JSON.stringify({
      client_id: "c", verifier: "v", state: "st", created: new Date().toISOString(),
    }), { mode: 0o600 });
    globalThis.fetch = async (input) => {
      const href = String(input?.url ?? input);
      if (href === SERVICES.spotify.token) {
        return new Response(JSON.stringify({ access_token: "at", refresh_token: "R" }));
      }
      return new Response(JSON.stringify({ display_name: "Someone", id: "x", product: "premium" }));
    };
    await finish("spotify", "http://127.0.0.1:8888/callback?code=X&state=st", { log: () => {} });
    assert.equal(savedLogin("spotify").verified, true);
  } finally {
    globalThis.fetch = realFetch;
    useTokenDir(was);
    rmSync(dir, { recursive: true, force: true });
  }
});

// A PENDING APPROVAL IS NOT SCRAP PAPER. The ordinary recovery — the first
// attempt times out, the person approves on their phone a minute later and is
// told to run setup again — used to overwrite the verifier that was the only
// thing able to spend that approval.
test("a second login does not throw away an approval still waiting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-pend-"));
  const was = tokenDirPath();
  try {
    useTokenDir(dir);
    const pending = { client_id: "c", verifier: "v-the-first", state: "s",
      created: new Date().toISOString() };
    writeFileSync(join(dir, ".pending-spotify.json"), JSON.stringify(pending), { mode: 0o600 });

    await assert.rejects(() => login("spotify", "c2", { open: false, log: () => {} }),
      /still waiting to be finished/);
    assert.equal(JSON.parse(readFileSync(join(dir, ".pending-spotify.json"), "utf8")).verifier,
      "v-the-first", "the verifier that can still spend the approval is untouched");

    // An abandoned one is not held against anybody.
    writeFileSync(join(dir, ".pending-spotify.json"), JSON.stringify({
      ...pending, created: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }), { mode: 0o600 });
    const old = await login("spotify", "c2", { open: false, log: () => {}, timeoutMs: 1 })
      .then(() => null, (e) => e);
    assert.ok(old && !/still waiting/.test(old.message),
      `an approval from two hours ago is not in the way: ${old?.message}`);
  } finally {
    useTokenDir(was);
    rmSync(dir, { recursive: true, force: true });
  }
});

// mode: applies at CREATION and nowhere else, so a file restored from a backup
// at 0644 stayed world-readable — and these are live credentials for a real
// account on a machine other people may have logins on.
test("a token file that already existed world-readable comes back owner-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-mode-"));
  const was = tokenDirPath();
  try {
    useTokenDir(dir);
    const file = join(dir, "spotify.json");
    writeFileSync(file, JSON.stringify({ service: "spotify", client_id: "c",
      refresh_token: "R0", scope: "s" }), { mode: 0o644 });
    chmodSync(file, 0o644);
    assert.equal(statSync(file).mode & 0o777, 0o644, "as it was found");

    writeSecret(file, JSON.stringify({ service: "spotify", client_id: "c", refresh_token: "R1", scope: "s" }));
    assert.equal(statSync(file).mode & 0o777, 0o600, "and as it is left");
    assert.equal(savedLogin("spotify").refresh_token, "R1");
  } finally {
    useTokenDir(was);
    rmSync(dir, { recursive: true, force: true });
  }
});
