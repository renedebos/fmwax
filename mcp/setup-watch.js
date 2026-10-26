// WAITS THE PAGE CAN SEE (the owner, 2026-10-19: steps that take time should
// be clear, and seen to be under way, so nobody thinks the install is stuck).
// Some setup steps wait on something outside the page: the first call from
// Claude or ChatGPT, a Work chat subscribing, the curator's check-in, the
// house DJ's first set. A page drawn while one waits carries the facts it was
// drawn with; its script asks /setup/status for the same facts every few
// seconds and reloads once one has moved, with a clock counting meanwhile.
import { readSeen } from "./settings.js";
import { CURATOR_SEEN_KEY, programsKV } from "./services.js";
import { workSubscriptions } from "./curator-events.js";
import { endlessLoad, parseEndless } from "./endless.js";
import { station } from "./station.js";
import { HELPER_FRESH_MS } from "./now.js";

export const WATCH_FACTS = ["app", "curator", "listening", "first", "helper", "helperRead"];

// THE HOME HELPER, AS THE SETUP PAGE SAYS IT (MC-31 stage 5; Codex,
// 2026-10-19: a line open is not a WiiM read): from its last reading, if
// fresh, the WiiMs it read and the ones that did not answer.
export function helperSaw(doc, now = Date.now()) {
  if (!doc?.at || now - Number(doc.at) > HELPER_FRESH_MS) return null;
  const all = Object.entries(doc.speakers ?? {});
  return { at: Number(doc.at), read: all.filter(([, r]) => r?.state && r.state !== "unreachable").map(([n]) => n),
    silent: all.filter(([, r]) => !r?.state || r.state === "unreachable").map(([n]) => n) };
}

// The house DJ's first set, as the DJ presets page tells it: being written
// (its fresh job open, since when), or how it ended (landed, and on which
// speaker it started; failed; expired), or "none" when nothing says.
export async function firstSet(env) {
  const own = parseEndless(env)?.presets?.find((p) => !p.lane && !p.program);
  if (!own) return null;
  let job = null;
  try {
    job = Object.values((await endlessLoad(env)).jobs ?? {}).find((j) => j?.btn === own.button && j?.kind === "fresh") ?? null;
  } catch { job = null; }
  if (job) return { state: "writing", since: Number(job.at) || Date.now() };
  let rows = [];
  try { rows = (await station(env, "endless-list", { limit: 60 }))?.rows ?? []; } catch { rows = []; }
  const last = rows.filter((r) => Number(r.btn) === own.button && /^fresh-(landed|failed|expired)$/.test(r.event)).pop();
  if (!last) return { state: "none" };
  const started = last.event === "fresh-landed" ? String(last.detail ?? "").match(/; started on (.+)$/)?.[1] ?? null : null;
  return { state: last.event.slice(6), at: Number(last.at) || null, started };
}

// The facts asked for, each its own read; one that cannot be read is left
// out, and the page then does not count it as moved.
export async function setupFacts(env, want = WATCH_FACTS) {
  const out = {};
  await Promise.all([
    want.includes("app") && readSeen(env).then((s) => { out.app = !!s?.connector; }),
    want.includes("curator") && programsKV(env).get(CURATOR_SEEN_KEY, { type: "json" })
      .then((r) => { out.curator = Number(r?.at) || 0; }).catch(() => {}),
    want.includes("listening") && workSubscriptions(env).then((s) => { out.listening = s.count; }).catch(() => {}),
    want.includes("first") && firstSet(env).then((f) => { out.first = f?.state ?? ""; }).catch(() => {}),
    (want.includes("helper") || want.includes("helperRead")) && station(env, "helper-get", {}).then((h) => {
      if (want.includes("helper")) out.helper = !!h?.hands;
      if (want.includes("helperRead")) out.helperRead = helperSaw(h?.doc)?.read.length ?? 0;
    }).catch(() => {}),
  ]);
  return out;
}
