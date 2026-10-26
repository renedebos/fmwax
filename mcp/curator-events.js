// THE CURATOR'S EVENTS (MC-31 stage 6b, step 2; 2026-10-19). How the house
// wakes a ChatGPT curator, as it rings a Claude routine: ChatGPT (a Work chat
// on a Plus account) subscribes to `house.work` on the curator's door, and
// whenever the house would ring its curator it also sends each live
// subscription a signed web call saying so. Measured first on a throwaway
// server (tasks/mcp-events-test/): a job answered through a write tool 17 s
// after the event with the chat open, 40 s with it closed, no approval asked.
//
// The protocol is OpenAI's reading of the draft MCP Events extension
// (developers.openai.com/plugins/build/mcp-events): events/list,
// events/subscribe (the callback proved first by a signed one-use
// challenge), events/unsubscribe, and Standard Webhooks signing on every
// delivery. The same rule as the doorbell: the id is all that travels, never
// the listener's words; the curator reads them through list_requests.
//
// Kept in PROGRAMS under one key, so a delivery costs one read and no list.
// ONE CURATOR (stage 6b, step 5): the house rings the curator it was given,
// ChatGPT's events or Claude's routine, never both (curatorKind).
import { programsKV, subrequest } from "./services.js";

// Which curator the house rings: the setup page's choice (CURATOR), else a
// house with a Claude routine is Claude's, else
// none was chosen: then only ChatGPT's events can hear it.
export function curatorKind(env) {
  if (env?.CURATOR === "chatgpt" || env?.CURATOR === "claude") return env.CURATOR;
  return env?.REQUEST_ROUTINE_ID ? "claude" : null;
}

export const WORK_EVENT = "house.work";
export const SUBS_KEY = "events:subs";
const VERIFIED_PREFIX = "events:verified:";
const SUB_MAX_MS = 7 * 24 * 3600e3;
const SUB_MIN_MS = 3600e3;
const SEND_TIMEOUT_MS = 5000;

export const EVENTS = [{
  name: WORK_EVENT,
  description: "The house has work for its curator: a listener asked a DJ for a set, or an endless DJ needs " +
    "songs (a top-up, a fresh set or a steer). When it arrives, call list_requests and do the curator's round " +
    "exactly as the house's tools describe it. The event carries only the work's id.",
  delivery: ["webhook"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  payloadSchema: {
    type: "object",
    properties: {
      work_id: { type: "string", description: "A request's id, or an endless job's (endless-…)." },
      kind: { type: "string", enum: ["request", "endless"] },
      again: { type: "boolean", description: "True when the house rings again for work still waiting." },
    },
    required: ["work_id", "kind", "again"],
    additionalProperties: false,
  },
}];

const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const randomId = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Object keys sorted at every level, so key order never makes a second subscription.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export function secretBytes(secret) {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) return null;
  try {
    const raw = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
    return raw.length >= 24 && raw.length <= 64 ? raw : null;
  } catch { return null; }
}
// Standard Webhooks: HMAC-SHA256 over "<id>.<seconds>.<body>", sent as "v1,<base64>".
export async function signWebhook(secret, msgId, seconds, body) {
  const key = await crypto.subtle.importKey("raw", secretBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1,${b64(await crypto.subtle.sign("HMAC", key, enc.encode(`${msgId}.${seconds}.${body}`)))}`;
}
const subId = async (url, name, args) => `sub_${(await sha256hex(`curator|${url}|${name}|${canonical(args ?? {})}`)).slice(0, 24)}`;

async function readSubs(env) {
  try {
    const all = (await programsKV(env).get(SUBS_KEY, { type: "json" })) ?? [];
    return Array.isArray(all) ? all : [];
  } catch { return []; }
}
const live = (subs, at = Date.now()) => subs.filter((s) => Date.parse(s.refreshBefore) > at);
async function writeSubs(env, subs) {
  await programsKV(env).put(SUBS_KEY, JSON.stringify(live(subs)));
}

// One signed POST: the body serialised once, the same bytes signed and sent.
async function post(env, url, id, secret, msgId, payload) {
  const body = JSON.stringify(payload);
  const seconds = Math.floor(Date.now() / 1000);
  try {
    const r = await subrequest(env, url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "webhook-id": msgId,
        "webhook-timestamp": String(seconds),
        "webhook-signature": await signWebhook(secret, msgId, seconds, body),
        "x-mcp-subscription-id": id,
      },
      body,
    });
    return { status: r.status, ok: r.ok, text: await r.text().catch(() => "") };
  } catch (e) {
    if (e?.budgetExhausted) throw e;
    return { status: 0, ok: false, text: "" };
  }
}

// What events/subscribe does, or the JSON-RPC error it answers.
export async function subscribeWork(env, params) {
  const { name, arguments: args = {}, delivery = {}, ttlMs } = params ?? {};
  if (name !== WORK_EVENT) return { error: [-32602, `unknown event "${String(name).slice(0, 60)}": this door offers ${WORK_EVENT}`] };
  if (args && (typeof args !== "object" || Object.keys(args).length)) return { error: [-32602, `${WORK_EVENT} takes no arguments`] };
  if (delivery.mode !== "webhook") return { error: [-32602, "delivery.mode must be webhook"] };
  let url;
  try { url = new URL(delivery.url); } catch { return { error: [-32602, "delivery.url is not an address"] }; }
  if (url.protocol !== "https:") return { error: [-32602, "delivery.url must be https"] };
  if (!secretBytes(delivery.secret)) return { error: [-32602, "delivery.secret must be whsec_ followed by base64 of 24 to 64 bytes"] };
  const id = await subId(url.href, name, args);
  // The callback proves it is ChatGPT's before anything is sent to it; a
  // proof is remembered a day, so a refresh does not repeat it.
  const proved = `${VERIFIED_PREFIX}${await sha256hex(url.href)}`;
  let known = null;
  try { known = await programsKV(env).get(proved); } catch { /* prove it again */ }
  if (!known) {
    const challenge = randomId("chal");
    const r = await post(env, url.href, id, delivery.secret, randomId("msg_verification"), { type: "verification", challenge });
    let echoed = null;
    try { echoed = JSON.parse(r.text)?.challenge; } catch { /* not JSON */ }
    if (!r.ok || typeof echoed !== "string" || echoed.length !== challenge.length || echoed !== challenge) {
      return { error: [-32015, "the callback did not answer its challenge", { reason: r.status ? "challenge_failed" : "timeout" }] };
    }
    try { await programsKV(env).put(proved, "1", { expirationTtl: 24 * 3600 }); } catch { /* proved again next time */ }
  }
  const asked = Number(ttlMs);
  const grant = Number.isFinite(asked) && asked > 0 ? Math.max(SUB_MIN_MS, Math.min(asked, SUB_MAX_MS)) : SUB_MAX_MS;
  const refreshBefore = new Date(Date.now() + grant).toISOString();
  const all = await readSubs(env);
  const was = all.find((s) => s.id === id);
  const subs = all.filter((s) => s.id !== id);
  subs.push({ id, name, url: url.href, secret: delivery.secret, refreshBefore, since: was?.since ?? new Date().toISOString() });
  await writeSubs(env, subs);
  return { body: { id, refreshBefore, cursor: null, truncated: false } };
}

export async function unsubscribeWork(env, params) {
  const { name, arguments: args = {}, delivery = {} } = params ?? {};
  let href = null;
  try { href = new URL(delivery.url).href; } catch { /* nothing to match */ }
  if (!href) return { body: {} };
  const id = await subId(href, name, args);
  const subs = await readSubs(env);
  if (subs.some((s) => s.id === id)) await writeSubs(env, subs.filter((s) => s.id !== id));
  return { body: {} };
}

// The house has work: a signed `house.work` to every live subscription. True
// when at least one answered 2xx (the curator heard it). A 410 drops that
// subscription; a failure is tried once more with a fresh signature.
export async function sendWorkEvent(env, workId, again = "") {
  const subs = live(await readSubs(env));
  if (!subs.length) return false;
  const data = { work_id: String(workId), kind: String(workId).startsWith("endless-") ? "endless" : "request", again: !!again };
  let heard = false;
  const gone = [];
  for (const s of subs) {
    const eventId = randomId("evt");
    const event = { eventId, name: WORK_EVENT, timestamp: new Date().toISOString(), data, cursor: null };
    let r = await post(env, s.url, s.id, s.secret, eventId, event);
    if (!r.ok && r.status !== 410 && r.status !== 413 && (r.status === 0 || r.status === 429 || r.status >= 500)) {
      r = await post(env, s.url, s.id, s.secret, eventId, event);
    }
    if (r.status === 410) gone.push(s.id);
    if (r.ok) heard = true;
  }
  if (gone.length) {
    try { await writeSubs(env, (await readSubs(env)).filter((s) => !gone.includes(s.id))); } catch { /* sent to again, refused again */ }
  }
  return heard;
}

// For the pages and list_requests: how many subscriptions are live, and when
// the newest was made or refreshed. Never the callback or the secret.
export async function workSubscriptions(env) {
  const subs = live(await readSubs(env));
  return { count: subs.length, until: subs.map((s) => s.refreshBefore).sort().pop() ?? null };
}
