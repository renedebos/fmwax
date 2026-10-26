// CLAIMING A HOUSE (MC-31, the settings storage, step 3, 2026-10-16). A
// freshly deployed house cannot tell its owner from its first visitor, so it
// is claimed once with a setup key: a Worker secret, SETUP_KEY, that the
// terminal door makes (and opens /setup#<key> with) and the GitHub door asks
// for in Cloudflare's deploy form (Codex's second review). The claim sets a
// sign-in cookie on that browser and shows a recovery code once, which signs
// in another browser later. Never PROGRAM_LIBRARY_KEY: that one is shared.
// A house with no setup key (the owner's, set up from its files) has no
// setup door at all.
import { CLAIMED_KEY, houseFetch, houseStub, makeHouseKeys, markClaimedHere } from "./settings.js";
import { programsKV } from "./services.js";

// A key someone could guess is no key: a shorter one leaves the door shut.
export const SETUP_KEY_MIN = 24;
export const OWNER_COOKIE = "__Host-fmwax-owner";
// Set by the first claim (settings.js keeps the name). Requests and the cron
// read the settings store only once it is there: the store is placed near
// its first caller and stays, and on a new house that must be the claim.
export { CLAIMED_KEY };

export function setupOpen(env) {
  return !!env?.HOUSE && typeof env.SETUP_KEY === "string" && env.SETUP_KEY.trim().length >= SETUP_KEY_MIN;
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha(s) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)))));
}
// Compared as hashes, so neither length nor a common start says anything.
async function sameKey(a, b) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  return x === y;
}

// The sign-in token (the cookie) and the recovery code (for a person: 16
// letters and digits in fours, Crockford's alphabet, so 0/O and 1/I/L are
// one character each).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
export function newRecovery() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0, n = 0, out = "";
  for (const b of bytes) {
    n = (n << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(n >> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join("-");
}
export function normalRecovery(s) {
  return String(s ?? "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
}

export function cookieToken(request) {
  const m = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${OWNER_COOKIE}=([0-9a-f]{64})(?:;|$)`));
  return m ? m[1] : null;
}
export function ownerCookie(token) {
  return `${OWNER_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

async function ownerCall(env, body) {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  // A look is safe to make twice (houseFetch); a claim or a recovery is not.
  const r = body.op === "look" ? await houseFetch(env, "/owner", init) : await houseStub(env).fetch("https://house/owner", init);
  return r.json();
}

// { claimed, claimed_at, owner }: owner is this browser's cookie.
export async function ownerState(env, request) {
  const t = cookieToken(request);
  return ownerCall(env, { op: "look", token: t ? await sha(t) : null });
}
export async function isOwner(env, request) {
  return (await ownerState(env, request)).owner === true;
}

// The claim: the setup key, then the object's one-time write. { ok, token,
// recovery } for the page to set and show, once; else { ok: false, code }.
export async function claimHouse(env, key) {
  if (!setupOpen(env) || !(await sameKey(String(key ?? "").trim(), env.SETUP_KEY.trim()))) {
    return { ok: false, code: "wrong-key" };
  }
  const token = newToken(), recovery = newRecovery();
  const out = await ownerCall(env, { op: "claim", token: await sha(token), recovery: await sha(normalRecovery(recovery)),
    key_hash: await sha(env.SETUP_KEY.trim()) });
  if (!out.ok) return out;
  await ensureClaimMark(env, out.claimed_at);
  // The house's own keys (the connector's, the curator's, the pages', the
  // helper's), made once, where the Worker has no secret for them. A failure
  // here does not undo the claim: the owner's next look makes them.
  try { await makeHouseKeys(env); } catch { /* ensureHouseKeys on the next look */ }
  return { ok: true, token, recovery, reclaimed: !!out.reclaimed };
}
// The claim's mark, written by the claim and put back by the owner's next
// look at /setup if that write was lost (Codex, 2026-10-17): without it the
// house would never read its store.
export async function ensureHouseKeys(env) {
  try { await makeHouseKeys(env); } catch { /* the next look tries again */ }
}
export async function ensureClaimMark(env, at) {
  markClaimedHere(env);
  try {
    if (!(await programsKV(env).get(CLAIMED_KEY))) await programsKV(env).put(CLAIMED_KEY, String(at ?? new Date().toISOString()));
  } catch { /* the next look tries again */ }
}

// A new recovery code, for the signed-in owner; the old one stops.
export async function newRecoveryCode(env, request) {
  const t = cookieToken(request);
  if (!t) return { ok: false, code: "not-owner" };
  const recovery = newRecovery();
  const out = await ownerCall(env, { op: "new-code", token: await sha(t), recovery: await sha(normalRecovery(recovery)) });
  return out.ok ? { ok: true, recovery } : out;
}

// Another browser, signed in by the recovery code; the others stay signed in.
export async function recoverOwner(env, code) {
  const token = newToken();
  const out = await ownerCall(env, { op: "recover", token: await sha(token), recovery: await sha(normalRecovery(code)) });
  return out.ok ? { ok: true, token } : out;
}

// THE HOME HELPER'S PAIRING CODE (the first Windows laptop, 2026-10-21: the
// setup page's second Copy, the key, went on top of the first, and a pasted
// key showed nothing at all where Ctrl+V gave nothing). The page's one
// command carries a code instead, good for an hour, which the install trades
// for the helper's key (/helper/pair): one copy, one paste, and nothing left
// in a terminal's history that works for longer. Made from the key and its
// hour, so the house keeps nothing.
export const HELPER_PAIR_S = 3600;
async function pairMac(secret, exp) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`helper-pair:${exp}`)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}
export async function helperPairCode(secret, now = Date.now()) {
  const exp = Math.floor(now / 1000) + HELPER_PAIR_S;
  return `${exp.toString(36)}-${await pairMac(secret, exp)}`;
}
// "ok", "expired" or "bad"; an hour ahead at most, so no code outlives one.
export async function helperPairCheck(secret, code, now = Date.now()) {
  const m = String(code ?? "").match(/^([0-9a-z]{1,10})-([A-Za-z0-9_-]{22})$/);
  if (!secret || !m) return "bad";
  const exp = parseInt(m[1], 36);
  if (!(await sameKey(m[2], await pairMac(secret, exp)))) return "bad";
  if (exp * 1000 > now + (HELPER_PAIR_S + 60) * 1000) return "bad";
  return exp * 1000 < now ? "expired" : "ok";
}
