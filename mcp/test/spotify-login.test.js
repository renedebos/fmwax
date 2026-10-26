// RECONNECT SPOTIFY (MC-31 stage 0b, 2026-10-16). Since 2026-07-20 a login
// made through a developer app ends six months after the sign-in; the house
// now keeps the date, says when it is due or gone, and signs in again from
// its own pages (spotify-login.js, services.js *THE SPOTIFY SIGN-IN*).

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv } from "./harness.js";
import { SPOTIFY_OUT_KEY, loginEnds, spotifyLogin, tokenMark } from "../services.js";
import { CALLBACK_PATH, finishLogin, startLogin } from "../spotify-login.js";
import { nowAnswer } from "../now.js";
import { barWords, renderSpeakersNow, renderSpotify } from "../programs.js";

const { getAccessToken, forgetAccessTokens, callTool } = __test;
const KEY = "abcdefabcdefabcdefabcdef";
const DAY = 24 * 60 * 60 * 1000;

// Spotify's two doors and /me, as a test sets them. `who` maps an access
// token to the account it answers for; `refresh` answers a refresh.
function fakeSpotify({ who = {}, refresh = () => Response.json({ access_token: "fresh", expires_in: 3600 }),
  code = () => Response.json({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }) } = {}) {
  const inner = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "accounts.spotify.com") {
      const body = new URLSearchParams(String(init.body));
      calls.push(`token ${body.get("grant_type")}`);
      return body.get("grant_type") === "refresh_token" ? refresh(body) : code(body);
    }
    if (url.hostname === "api.spotify.com" && url.pathname === "/v1/me") {
      calls.push("me");
      const t = String(init.headers?.authorization ?? "").replace(/^Bearer /, "");
      return who[t] ? Response.json(who[t]) : new Response("{}", { status: 401 });
    }
    return new Response("not faked", { status: 500 });
  };
  return { calls, restore: () => { globalThis.fetch = inner; } };
}

const env = () => ({ ...makeEnv(), PROGRAM_LIBRARY_KEY: KEY });
const record = async (e) => JSON.parse(await e.TOKENS.get("spotify"));

test("an invalid_grant notes the house signed out; the same login is not asked again; a new one is, and clears the note", async () => {
  const e = env();
  let refused = true;
  const f = fakeSpotify({ refresh: () => refused
    ? new Response('{"error":"invalid_grant","error_description":"Refresh token revoked"}', { status: 400 })
    : Response.json({ access_token: "fresh", expires_in: 3600 }) });
  try {
    forgetAccessTokens();
    await assert.rejects(getAccessToken(e), /signed this house out/);
    const note = JSON.parse(await e.PROGRAMS.get(SPOTIFY_OUT_KEY));
    assert.equal(note.rt, await tokenMark("r"));
    assert.ok(note.at && !JSON.stringify(note).includes('"r"'), "a fingerprint, never the token");

    // The same refused login: refused at once, without asking Spotify.
    f.calls.length = 0;
    forgetAccessTokens();
    const err = await getAccessToken(e).catch((x) => x);
    assert.equal(err.code, "spotify-signed-out");
    assert.deepEqual(f.calls, []);

    // A new refresh token (the terminal's way: a new secret, the record
    // gone) is tried, and its success clears the note.
    refused = false;
    await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r-new" }));
    forgetAccessTokens();
    assert.equal(await getAccessToken(e), "fresh");
    assert.equal(await e.PROGRAMS.get(SPOTIFY_OUT_KEY), null);
  } finally { f.restore(); forgetAccessTokens(); }
});

test("a refresh carries the sign-in's date and account forward, and never writes over a reconnect made meanwhile", async () => {
  const e = env();
  const at = "2026-10-01T00:00:00.000Z";
  await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r1", expires_at: 0, login_at: at, account: { id: "house", name: "House" } }));
  let f = fakeSpotify({ refresh: () => Response.json({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }) });
  try {
    forgetAccessTokens();
    assert.equal(await getAccessToken(e), "a2");
    const kept = await record(e);
    assert.equal(kept.refresh_token, "r2");
    assert.equal(kept.login_at, at);
    assert.deepEqual(kept.account, { id: "house", name: "House" });
  } finally { f.restore(); }

  // A Reconnect lands while the old login's refresh is on the wire.
  await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r2", expires_at: 0, login_at: at }));
  f = fakeSpotify({ refresh: async () => {
    await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "new-rt", access_token: "new-at",
      expires_at: Date.now() + 3600_000, login_at: "2026-10-16T00:00:00.000Z" }));
    return Response.json({ access_token: "old-lineage", refresh_token: "r3", expires_in: 3600 });
  } });
  try {
    forgetAccessTokens();
    assert.equal(await getAccessToken(e), "new-at", "the new login's token");
    assert.equal((await record(e)).refresh_token, "new-rt", "the reconnect is not written over");
  } finally { f.restore(); forgetAccessTokens(); }
});

test("Reconnect sends the browser to Spotify's page with PKCE, the house's fixed return address and a one-use state", async () => {
  const e = env();
  const u = new URL(await startLogin(e, "https://other.test"));
  assert.equal(u.origin + u.pathname, "https://accounts.spotify.com/authorize");
  const q = u.searchParams;
  assert.equal(q.get("client_id"), "cid");
  assert.equal(q.get("redirect_uri"), `https://example.test${CALLBACK_PATH}`, "PROGRAM_BASE_URL, whatever host the page was on");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.match(q.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(q.get("show_dialog"), "true");
  assert.match(q.get("scope"), /user-modify-playback-state/);
  const pending = JSON.parse(await e.TOKENS.get(`spotify:pending:${q.get("state")}`));
  assert.ok(pending.verifier.length >= 43);
});

test("the way back keeps the new login with its date and account, once; a cancel or a stale state changes nothing", async () => {
  const e = env();
  await e.PROGRAMS.put(SPOTIFY_OUT_KEY, JSON.stringify({ at: "2026-10-10T00:00:00Z", rt: "x" }));
  const f = fakeSpotify({ who: { "new-at": { id: "house", display_name: "House" } } });
  try {
    const state = new URL(await startLogin(e, "https://example.test")).searchParams.get("state");
    const cancel = await finishLogin(e, new URLSearchParams({ error: "access_denied", state }), "https://example.test");
    assert.equal(cancel.ok, false);
    assert.match(cancel.why, /cancelled/);
    assert.equal(await e.TOKENS.get(`spotify:pending:${state}`), null, "a cancel uses the state up too");

    const s2 = new URL(await startLogin(e, "https://example.test")).searchParams.get("state");
    forgetAccessTokens();
    // The login in use answers for the same account ("fresh" from the refresh).
    f.calls.length = 0;
    const done = await finishLogin(e, new URLSearchParams({ code: "c", state: s2 }), "https://example.test");
    assert.equal(done.ok, true, done.why);
    assert.equal(done.name, "House");
    const kept = await record(e);
    assert.equal(kept.refresh_token, "new-rt");
    assert.deepEqual(kept.account, { id: "house", name: "House" });
    assert.ok(Date.now() - Date.parse(kept.login_at) < 60_000);
    assert.equal(done.endsAt, loginEnds(kept.login_at));
    assert.equal(await e.PROGRAMS.get(SPOTIFY_OUT_KEY), null, "the signed-out note is cleared");

    const again = await finishLogin(e, new URLSearchParams({ code: "c", state: s2 }), "https://example.test");
    assert.equal(again.ok, false);
    assert.match(again.why, /run out or was already used/);
  } finally { f.restore(); forgetAccessTokens(); }
});

test("same account only: another Spotify account is refused, whether the house recorded its own or only its login knows", async () => {
  // Recorded at an earlier Reconnect.
  let e = env();
  await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r", login_at: "2026-10-01T00:00:00Z", account: { id: "house", name: "House" } }));
  let f = fakeSpotify({ who: { "new-at": { id: "guest", display_name: "Guest" } } });
  try {
    const s = new URL(await startLogin(e, "https://example.test")).searchParams.get("state");
    const r = await finishLogin(e, new URLSearchParams({ code: "c", state: s }), "https://example.test");
    assert.equal(r.ok, false);
    assert.match(r.why, /"House".*"Guest".*Not you\?/);
    assert.equal((await record(e)).refresh_token, "r", "nothing kept");
  } finally { f.restore(); forgetAccessTokens(); }

  // Never recorded (a terminal login): the login in use is asked who it is.
  e = env();
  f = fakeSpotify({ who: { "new-at": { id: "guest", display_name: "Guest" }, fresh: { id: "house", display_name: "House" } } });
  try {
    forgetAccessTokens();
    const s = new URL(await startLogin(e, "https://example.test")).searchParams.get("state");
    const r = await finishLogin(e, new URLSearchParams({ code: "c", state: s }), "https://example.test");
    assert.equal(r.ok, false);
    assert.match(r.why, /"House"/);
  } finally { f.restore(); forgetAccessTokens(); }

  // Never recorded and the login is gone: whoever signs in is kept.
  e = env();
  f = fakeSpotify({ who: { "new-at": { id: "guest", display_name: "Guest" } },
    refresh: () => new Response('{"error":"invalid_grant"}', { status: 400 }) });
  try {
    forgetAccessTokens();
    const s = new URL(await startLogin(e, "https://example.test")).searchParams.get("state");
    const r = await finishLogin(e, new URLSearchParams({ code: "c", state: s }), "https://example.test");
    assert.equal(r.ok, true, r.why);
    assert.equal((await record(e)).account.id, "guest");
  } finally { f.restore(); forgetAccessTokens(); }
});

test("where the sign-in stands: no date, the date and its end, due within three weeks, signed out", async () => {
  const e = env();
  let s = await spotifyLogin(e);
  assert.equal(s.signedInAt, null);
  assert.equal(s.due, false);

  const now = Date.parse("2027-03-26T12:00:00Z");
  await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r", login_at: "2026-10-16T12:00:00.000Z", account: { id: "h", name: "H" } }));
  s = await spotifyLogin(e, now);
  assert.equal(new Date(s.ends).toISOString(), "2027-04-16T12:00:00.000Z");
  assert.equal(s.daysLeft, 21);
  assert.equal(s.due, true);
  assert.equal((await spotifyLogin(e, now - DAY)).due, false);

  await e.PROGRAMS.put(SPOTIFY_OUT_KEY, JSON.stringify({ at: "2027-04-16T13:00:00Z", rt: await tokenMark("r") }));
  assert.equal((await spotifyLogin(e, now)).out.at, "2027-04-16T13:00:00Z");
  // A late refusal of an older login is not this one's (Codex, 2026-10-17).
  await e.PROGRAMS.put(SPOTIFY_OUT_KEY, JSON.stringify({ at: "2027-04-16T13:00:00Z", rt: await tokenMark("an older login") }));
  assert.equal((await spotifyLogin(e, now)).out, null);
});

test("no login at all is told apart from a login with no date", async () => {
  const e = env();
  await e.TOKENS.delete("spotify");
  delete e.SPOTIFY_REFRESH_TOKEN;
  assert.equal((await spotifyLogin(e)).present, false);
  await e.TOKENS.put("spotify", JSON.stringify({ refresh_token: "r" }));
  assert.equal((await spotifyLogin(e)).present, true);
});

test("the Spotify page: its own address under the key, Reconnect to Spotify's page, and the way back with its words", async () => {
  const e = env();
  const get = (p) => worker.fetch(new Request(`https://example.test${p}`, { redirect: "manual" }), e);
  assert.equal((await get(`/buttons/${"x".repeat(24)}/spotify`)).status, 404);

  let r = await get(`/buttons/${KEY}/spotify`);
  assert.equal(r.status, 200);
  let html = await r.text();
  assert.match(html, /<h1>Spotify<\/h1>/);
  assert.match(html, /<b class="word">Not known<\/b>/);
  assert.match(html, /made before the house kept the date/);
  assert.ok(html.includes(`href="/buttons/${KEY}/spotify/connect">Reconnect Spotify</a>`));
  assert.ok(html.includes(`https://example.test${CALLBACK_PATH}`), "the address for Spotify's dashboard");
  assert.match(html, new RegExp(`<a class="tab on" href="/buttons/${KEY}/wiim" aria-current="page">`));

  r = await get(`/buttons/${KEY}/spotify/connect`);
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /^https:\/\/accounts\.spotify\.com\/authorize\?/);

  // A cancel on Spotify's page comes back to the page, saying so.
  const state = new URL(r.headers.get("location")).searchParams.get("state");
  r = await get(`${CALLBACK_PATH}?error=access_denied&state=${state}`);
  assert.equal(r.status, 303);
  const back = r.headers.get("location");
  assert.ok(back.startsWith(`/buttons/${KEY}/spotify?said=`));
  html = await (await get(back)).text();
  assert.match(html, /cancelled on Spotify&#39;s page|cancelled on Spotify's page/);

  // The way back has no key in it, so a state the house never gave out (or
  // one already spent) must not be sent on to the keyed page.
  for (const q of [`?error=access_denied&state=${state}`, "?code=c&state=made-up", "", "?error=access_denied"]) {
    r = await get(`${CALLBACK_PATH}${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.headers.get("location"), null, q);
    assert.ok(!(await r.text()).includes(KEY), q);
  }
});

test("the page and the Speakers tab say a due or gone sign-in; the footer links the page", () => {
  const base = `/buttons/${KEY}`;
  const ends = Date.parse("2027-04-16T12:00:00Z");
  let html = renderSpotify({ base, login: { signedInAt: "2026-10-16T12:00:00Z", ends, daysLeft: 10, due: true, account: { name: "House" } } });
  assert.match(html, /<span class="sgnav" aria-hidden="true">H<\/span>\s*<span><b>House<\/b><small>The house's Spotify account<\/small>/);
  assert.match(html, /class="uhero sgnhero hot"><b>10<\/b><span>days until Spotify ends this\s+sign-in: reconnect before then/);
  assert.match(html, /<div class="sgnbar hot" role="img" aria-label="\d+% of the six months used"><i style="width:[\d.]+%"><\/i><\/div>/);
  assert.match(html, /Ends <time datetime="2027-04-16T12:00:00.000Z">Apr 16, 2027<\/time>/);
  html = renderSpotify({ base, login: { out: { at: "2027-04-16T13:00:00Z" } } });
  assert.match(html, /<b class="word">Signed out<\/b>/);
  assert.match(html, /the house found that Spotify had ended its sign-in/);
  // Its own classes: `.sline` is the DJs tab's flex row, and borrowing it
  // split the first version's words into columns (the owner's screenshot).
  assert.doesNotMatch(renderSpotify({ base, login: { signedInAt: "2026-10-16T12:00:00Z", ends, daysLeft: 100 } }), /class="sline/);
  html = renderSpotify({ base, login: {}, flash: { ok: true, name: "House", endsAt: ends } });
  assert.match(html, /Reconnected as House\. The next sign-in is due by/);
  html = renderSpotify({ base, login: {}, flash: { ok: true, name: "House", endsAt: "nonsense" } });
  assert.match(html, /a date not known/, "a made-up address cannot break the page");

  let spk = renderSpeakersNow({ base, login: { due: true, daysLeft: 9 } });
  assert.match(spk, /sign-in ends in 9 days\. <a href="\/buttons\/[a-f]+\/spotify">Reconnect Spotify<\/a>/);
  spk = renderSpeakersNow({ base, login: { out: { at: "x" }, due: true } });
  assert.match(spk, /Spotify has signed the house out/);
  spk = renderSpeakersNow({ base, login: { due: false } });
  assert.doesNotMatch(spk, /class="quietline spotline"/);
  assert.ok(spk.includes(`<a class="chip" href="${base}/spotify">Spotify</a>`));
});

test("the bar says signed out instead of unreachable, and list_requests tells the phone's Claude", async () => {
  const e = env();
  let a = await nowAnswer(e, null, { unknown: true });
  assert.equal(a.state, "unknown");
  const held = JSON.parse(await e.TOKENS.get("spotify")).refresh_token;
  await e.PROGRAMS.put(SPOTIFY_OUT_KEY, JSON.stringify({ at: "2027-04-16T13:00:00Z", rt: await tokenMark(held) }));
  a = await nowAnswer(e, null, { unknown: true });
  assert.equal(a.state, "signedout");
  assert.match(a.notice, /signed this house out/);

  const out = await callTool(e, "list_requests", {}, { remaining: 40 });
  assert.match(out.spotify_login, /^SIGNED OUT by Spotify on 2027-04-16/);
  await e.PROGRAMS.delete(SPOTIFY_OUT_KEY);
  const quiet = await callTool(e, "list_requests", {}, { remaining: 40 });
  assert.equal(quiet.spotify_login, undefined);
});

// THE PRACTICE INSTALL (2026-10-19): a house opened before its first Spotify
// sign-in said "Can't reach Spotify right now".
test("a new house's bar says Spotify is not signed in yet, not unreachable", async () => {
  const e = env();
  await e.TOKENS.delete("spotify");
  delete e.SPOTIFY_REFRESH_TOKEN;
  const a = await nowAnswer(e, null, { unknown: true });
  assert.equal(a.state, "nologin");
  assert.deepEqual(barWords({ state: a.state }), { tone: "off", one: "Spotify is not signed in yet", two: "Sign in on the setup page" });
  // With a login, an unreadable player is still unknown, not "not signed in".
  assert.equal((await nowAnswer(env(), null, { unknown: true })).state, "unknown");
});

// RECONNECT IS THE OWNER'S where the house has a setup door (Codex,
// 2026-10-17): the family's page key alone no longer starts or finishes it.
test("with a setup door, only the signed-in owner can reconnect; the family still sees the page", async () => {
  const { makeHouseStore } = await import("./harness.js");
  const e = env();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = "setup-key-0123456789abcdef";
  const go = (p, init = {}) => worker.fetch(new Request(`https://example.test${p}`, { redirect: "manual", ...init }), e);
  const claim = await go("/setup/claim", { method: "POST", headers: { origin: "https://example.test" },
    body: new URLSearchParams({ key: e.SETUP_KEY }) });
  const me = (claim.headers.get("set-cookie") ?? "").split(";")[0];

  const family = await (await go(`/buttons/${KEY}/spotify`)).text();
  assert.match(family, /Reconnecting is for the house(&#39;|')s owner/);
  assert.doesNotMatch(family, /spotify\/connect/);
  const tried = await go(`/buttons/${KEY}/spotify/connect`);
  assert.equal(tried.status, 303);
  assert.equal(tried.headers.get("location"), "/setup");
  assert.equal([...e.TOKENS.store.keys()].filter((k) => k.startsWith("spotify:pending:")).length, 0, "no pending state written");
  const back = await go(`${CALLBACK_PATH}?state=s&code=c`);
  assert.equal(back.status, 403);

  const mine = await (await go(`/buttons/${KEY}/spotify`, { headers: { cookie: me } })).text();
  assert.match(mine, /spotify\/connect/);
  const started = await go(`/buttons/${KEY}/spotify/connect`, { headers: { cookie: me } });
  assert.equal(started.status, 302);
  assert.match(started.headers.get("location"), /^https:\/\/accounts\.spotify\.com\/authorize/);
});
