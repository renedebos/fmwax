// WORK WAITING TOO LONG (MC-31 stage 6b, step 4; the owner, 2026-10-19).
// When a plan's limit runs out, Claude's or ChatGPT's, the curator just goes
// quiet. The house cannot see tokens (neither assistant reports usage to
// it), but it sees work it asked for go unanswered: a listener's ask still
// pending, or an endless top-up or steer still open, past twenty minutes,
// when either is answered in two or three. Then the pages say so, and why it
// may be, without waiting for the hour the quiet check-in note waits.
// A fresh set is left out: it is for the next press and may wait for the
// hourly check by design.
import { station } from "./station.js";
import { endlessLoad, parseEndless } from "./endless.js";

export const WAITING_MS = 20 * 60 * 1000;
const DAY_MS = 24 * 3600e3;

// { asks, jobs, since } for work waiting past twenty minutes, or null.
export async function workWaiting(env, now = Date.now()) {
  if (!env?.STATION) return null;
  let asks = [], jobs = [];
  try {
    asks = ((await station(env, "list", { states: ["pending"] }))?.rows ?? [])
      .filter((r) => now - Number(r.created_at) > WAITING_MS);
  } catch { asks = []; }
  try {
    if (parseEndless(env)) {
      jobs = Object.values((await endlessLoad(env)).jobs ?? {})
        .filter((j) => j && j.kind !== "fresh" && now - (Number(j.at) || now) > WAITING_MS);
    }
  } catch { jobs = []; }
  if (!asks.length && !jobs.length) return null;
  const since = Math.min(...asks.map((r) => Number(r.created_at)), ...jobs.map((j) => Number(j.at)));
  return { asks: asks.length, jobs: jobs.length, since };
}

// "2 asks and 1 top-up": what is waiting, in the pages' words.
export function waitingWords(w) {
  if (!w) return "";
  const n = (k, one, many) => (k === 1 ? `1 ${one}` : `${k} ${many}`);
  return [w.asks ? n(w.asks, "ask", "asks") : null, w.jobs ? n(w.jobs, "endless top-up", "endless top-ups") : null]
    .filter(Boolean).join(" and ");
}
export const LIMIT_HINT = "if its Claude or ChatGPT plan has hit its limit, it carries on when the limit resets";

// The curator's last day, from the ledger and the endless log: asks
// answered (a set or a pass) and still pending, top-ups landed and expired.
export async function curatorDay(env, now = Date.now()) {
  if (!env?.STATION) return null;
  let rows = [], log = [];
  try {
    rows = ((await station(env, "list", { states: ["pending", "claimed", "ready", "declined", "needs-attention"] }))?.rows ?? [])
      .filter((r) => now - Number(r.created_at) < DAY_MS);
  } catch { rows = []; }
  try { log = ((await station(env, "endless-list", { limit: 200 }))?.rows ?? []).filter((r) => now - Number(r.at) < DAY_MS); } catch { log = []; }
  const count = (f) => rows.filter(f).length;
  const out = {
    asks_answered: count((r) => r.state === "ready" || r.state === "declined"),
    asks_waiting: count((r) => r.state === "pending" || r.state === "claimed"),
    asks_needing_attention: count((r) => r.state === "needs-attention"),
    endless_landed: log.filter((r) => /-landed$/.test(r.event)).length,
    endless_expired: log.filter((r) => r.event === "topup-expired").length,
  };
  return Object.values(out).some(Boolean) ? out : null;
}
