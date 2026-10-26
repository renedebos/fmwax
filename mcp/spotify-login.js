// RECONNECT SPOTIFY (MC-31 stage 0b, 2026-10-16). Spotify's sign-in, run at
// the house's own address, so a new login needs no terminal, no Worker
// secret and no deploy. Since 2026-07-20 a login made through a developer app
// ends six months after the sign-in (services.js, *THE SPOTIFY SIGN-IN*), so
// every house signs in again twice a year; the setup page's Spotify step will
// be the same two doors.
//
// Authorization Code with PKCE, as the terminal's login (install/login.js):
// the app's Client ID is public and there is no client secret. The verifier
// waits in KV under a one-use state for fifteen minutes. The redirect comes
// back to one fixed address per house, PROGRAM_BASE_URL + CALLBACK_PATH,
// which has to be in the Spotify app's list of redirect URIs.
//
// SAME ACCOUNT ONLY. The pages' key opens this, and that key is shared with
// the household: a new login is kept only when it is the account the house
// already plays through (the one recorded at the last Reconnect, or else the
// one the current login answers for). A house whose login is gone and was
// never recorded takes whoever signs in, only behind a setup door, where that
// is the owner; one without signs in again from its files (the locks review,
// 2026-10-25).
import { SPOTIFY_SCOPES } from "./spotify.js";
import { setupOpen } from "./claim.js";
import {
  SPOTIFY_API, SPOTIFY_TOKEN, cachedAccess, clearSignedOut, getAccessToken, loginEnds, subrequest, tokensKV,
} from "./services.js";

export const SPOTIFY_AUTHORIZE = "https://accounts.spotify.com/authorize";
export const CALLBACK_PATH = "/oauth/spotify/callback";
const PENDING_TTL_S = 15 * 60;
const pendingKey = (state) => `spotify:pending:${state}`;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export function callbackUrl(env, origin) {
  return `${String(env.PROGRAM_BASE_URL || origin).replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

// The address of Spotify's own sign-in page for this house, with a fresh
// verifier kept for the way back.
// `back` is where the way back lands: "setup" for a sign-in started from the
// setup checklist (the trial, 2026-10-17: the owner kept losing the
// checklist), else the Spotify page.
export async function startLogin(env, origin, { back = null } = {}) {
  if (!env.SPOTIFY_CLIENT_ID) throw new Error("this house has no SPOTIFY_CLIENT_ID");
  const verifier = random(64);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = random(16);
  await tokensKV(env).put(pendingKey(state), JSON.stringify({ verifier, at: Date.now(), ...(back === "setup" ? { back } : {}) }),
    { expirationTtl: PENDING_TTL_S });
  return `${SPOTIFY_AUTHORIZE}?` + new URLSearchParams({
    response_type: "code",
    client_id: env.SPOTIFY_CLIENT_ID,
    redirect_uri: callbackUrl(env, origin),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    // Spotify's page then shows which account is signed in, with "Not you?"
    // to change it, instead of approving silently for whoever it remembers.
    show_dialog: "true",
  });
}

async function whoIs(env, token) {
  try {
    const r = await subrequest(env, `${SPOTIFY_API}/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const me = await r.json();
    return me?.id ? { id: me.id, name: me.display_name || me.id } : null;
  } catch { return null; }
}

// The way back from Spotify's page: { ok, name, endsAt } or { ok: false, why }
// in words for the page. Nothing is kept unless every check passes. `known`
// says the state was one this house gave out: only then may the answer send
// the browser on to the keyed page, because this address has no key in it
// and anyone can open it.
export async function finishLogin(env, params, origin) {
  const said = params.get("error");
  const state = params.get("state") || "";
  let pending = null;
  if (state) {
    try { pending = await tokensKV(env).get(pendingKey(state), { type: "json" }); } catch { pending = null; }
    // One use, whatever happens next.
    if (pending) { try { await tokensKV(env).delete(pendingKey(state)); } catch { /* it expires */ } }
  }
  if (!pending) return { ok: false, known: false, why: "This sign-in has run out or was already used. Press Reconnect Spotify again." };
  return { known: true, back: pending.back ?? null, ...(await spend(env, params, origin, pending, said)) };
}

async function spend(env, params, origin, pending, said) {
  if (said) {
    return { ok: false, why: said === "access_denied"
      ? "The sign-in was cancelled on Spotify's page. Nothing changed."
      : `Spotify said "${said}". Nothing changed.` };
  }
  const code = params.get("code");
  if (!code) return { ok: false, why: "Spotify sent nothing back to sign in with. Press Reconnect Spotify again." };

  const r = await subrequest(env, SPOTIFY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(env, origin),
      client_id: env.SPOTIFY_CLIENT_ID,
      code_verifier: pending.verifier,
    }),
  }, { critical: true });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 160);
    return { ok: false, why: `Spotify refused the sign-in (${r.status}: ${text}). If it names the redirect, ` +
      `the Spotify app needs this address among its redirect URIs: ${callbackUrl(env, origin)}` };
  }
  const tok = await r.json();
  if (!tok.refresh_token) return { ok: false, why: "Spotify gave no lasting sign-in back. Press Reconnect Spotify again." };
  const me = await whoIs(env, tok.access_token);
  if (!me) return { ok: false, why: "Spotify signed in but would not say which account it was. Nothing changed: try again in a minute." };

  let cur = null;
  try { cur = await tokensKV(env).get("spotify", { type: "json" }); } catch { cur = null; }
  let held = cur?.account ?? null;
  if (!held) {
    // Never recorded (a login from the terminal): ask the one in use now, if
    // it still answers. A login Spotify has ended answers nothing.
    try { held = await whoIs(env, await getAccessToken(env, "spotify")); } catch { held = null; }
  }
  // NO ACCOUNT TO HOLD IT TO, AND NO OWNER (the locks review, 2026-10-25): a
  // house with no setup door lets anyone with its page key reconnect, so a
  // login made in the terminal, never recorded and now ended, would be
  // replaced by whoever signs in. Such a house signs in again from its files.
  if (!held && cur?.refresh_token && !setupOpen(env)) {
    return { ok: false, why: "This house's Spotify sign-in was made from its files and the page cannot tell whose it was. " +
      "Nothing changed. Sign in again from the house's files (npm run login in mcp/, docs/install/secrets.md)." };
  }
  if (held && held.id !== me.id) {
    return { ok: false, why: `This house plays through the Spotify account "${held.name}", and this sign-in was ` +
      `"${me.name}". Nothing changed. Press Reconnect Spotify again and, on Spotify's page, use "Not you?" ` +
      "to sign in with the house's account." };
  }

  // A house's first sign-in, said as one ("Signed in", not "Reconnected").
  const first = !cur?.refresh_token;
  const login_at = new Date().toISOString();
  const expires_at = Date.now() + (tok.expires_in ?? 3600) * 1000;
  await tokensKV(env).put("spotify", JSON.stringify({
    refresh_token: tok.refresh_token, access_token: tok.access_token, expires_at,
    login_at, account: { id: me.id, name: me.name },
  }));
  cachedAccess.spotify = { token: tok.access_token, expiresAt: expires_at };
  await clearSignedOut(env);
  return { ok: true, name: me.name, endsAt: loginEnds(login_at), first };
}
