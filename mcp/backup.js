// BACKUP AND REPAIR (MC-31, the forum road, 2026-10-17; Codex's review: a
// beta prerequisite). For the signed-in owner only, from the setup page:
// a backup file of what the house keeps for itself (the settings chosen on
// the page and the keys it made or was given), putting one back, and a
// check of the house's parts, each with what to do in plain words.
//
// Keys set as Worker secrets (a terminal install, the owner's) are not in
// the file: they live in Cloudflare and are never read back. Neither is who
// owns the house: a restore is done by a signed-in owner and keeps them.
import { GIVEN_KEYS, MADE_KEYS, PAGE_SETTINGS, SETTINGS_READ_MS, forgetLastKnown, houseFetch, readSeen } from "./settings.js";
import { CURATOR_QUIET_MS, CURATOR_SEEN_KEY, nameDevice, programsKV, spotify, spotifyLogin, tokensKV, withBudget } from "./services.js";
import { station } from "./station.js";
import { parseButtons } from "./house.js";
import { parseEndless } from "./endless.js";
import { curatorKind, workSubscriptions } from "./curator-events.js";

export const BACKUP_KIND = "fmwax-house-backup";
const pick = (o, names) => Object.fromEntries(names.filter((n) => typeof o?.[n] === "string" && o[n]).map((n) => [n, o[n]]));

// THE SPEAKERS' NAMES (Codex, 2026-10-17): a WiiM that shows Spotify only a
// code is found by the name given it on the setup page, kept in PROGRAMS
// (`device-label:<id>`), not in the settings. Without them in the file, a
// house restored onto new stores had its default speaker by a name nothing
// answered to.
const DEVICE_ID = /^[A-Za-z0-9]{8,64}$/;
async function speakerNames(env) {
  const kv = programsKV(env), out = {};
  let cursor;
  do {
    const page = await kv.list({ prefix: "device-label:", ...(cursor ? { cursor } : {}) });
    for (const k of page.keys) {
      const id = k.name.slice("device-label:".length);
      const name = DEVICE_ID.test(id) ? await kv.get(k.name) : null;
      if (name) out[id] = name;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && Object.keys(out).length < 50);
  return out;
}

export async function makeBackup(env, host) {
  const doc = await (await houseFetch(env, "/settings")).json();
  return { kind: BACKUP_KIND, version: 1, made_at: new Date().toISOString(), host,
    page: pick(doc?.page, PAGE_SETTINGS), keys: pick(doc?.keys, [...MADE_KEYS, ...GIVEN_KEYS]),
    speakers: await speakerNames(env).catch(() => ({})) };
}

// EACH SETTING READ AS THE HOUSE READS IT (Codex, 2026-10-17): a file can be
// the right shape and still hold a value that breaks a page once it is in,
// so each is checked by its own reader before anything is written.
const list = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) && a.length <= 40 && a.every((x) => typeof x === "string" && x.trim() && x.length <= 60); } catch { return false; } };
const PAGE_CHECKS = {
  DEFAULT_DEVICE: (v) => v.length <= 60,
  HOUSE_TZ: (v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } },
  ROOM_DEVICES: list,
  WIIM_NAMES: list,
  BUTTONS: (v) => { try { return Array.isArray(JSON.parse(v)) && (parseButtons(v), true); } catch { return false; } },
  ENDLESS: (v) => { try { return typeof JSON.parse(v) === "object" && !!parseEndless({ ENDLESS: v }); } catch { return false; } },
  REQUEST_ROUTINE_ID: (v) => /^trig_[A-Za-z0-9]{10,64}$/.test(v),
  REQUESTS_ENABLED: (v) => v === "true" || v === "false",
  AUTOFULFILL_ENABLED: (v) => v === "true" || v === "false",
};

// The file checked before anything is written: its kind, each name one the
// house knows, each key the shape that key has. { ok, page, keys } or { why }.
export function readBackup(text) {
  let b;
  try { b = JSON.parse(String(text ?? "")); } catch { return { why: "That file is not a house backup: it is not readable as one." }; }
  if (b?.kind !== BACKUP_KIND || b?.version !== 1) return { why: "That file is not a house backup made by this app." };
  const page = b.page && typeof b.page === "object" ? b.page : {};
  const keys = b.keys && typeof b.keys === "object" ? b.keys : {};
  const badName = [...Object.keys(page).filter((n) => !PAGE_SETTINGS.includes(n)),
    ...Object.keys(keys).filter((n) => ![...MADE_KEYS, ...GIVEN_KEYS].includes(n))];
  if (badName.length) return { why: `The backup names settings this house does not have (${badName.slice(0, 3).join(", ")}). Nothing changed.` };
  const shape = (n, v) => typeof v === "string" && (n === "SPOTIFY_CLIENT_ID" ? /^[0-9a-f]{32}$/i.test(v)
    : n === "REQUEST_ROUTINE_TOKEN" ? /^[A-Za-z0-9_-]{20,300}$/.test(v) : /^[A-Za-z0-9_-]{16,128}$/.test(v));
  const badKey = Object.entries(keys).filter(([n, v]) => !shape(n, v)).map(([n]) => n);
  if (badKey.length) return { why: `The backup's ${badKey[0]} is not the shape that key has. Nothing changed.` };
  if (Object.values(page).some((v) => typeof v !== "string" || !v || v.length > 2000)) return { why: "A setting in the backup is empty or too long. Nothing changed." };
  const badValue = Object.entries(page).find(([n, v]) => PAGE_CHECKS[n] && !PAGE_CHECKS[n](v));
  if (badValue) return { why: `The backup's ${badValue[0]} is not a value this house can use. Nothing changed.` };
  // Each key opens its own door: two the same would let the family's page
  // key open the owner's connector.
  const values = Object.values(keys);
  if (new Set(values).size !== values.length) return { why: "Two of the backup's keys are the same, and each must be its own. Nothing changed." };
  const speakers = b.speakers && typeof b.speakers === "object" ? b.speakers : {};
  if (Object.entries(speakers).some(([id, name]) => !DEVICE_ID.test(id) || typeof name !== "string" || !name.trim() || name.length > 40)
    || Object.keys(speakers).length > 50) return { why: "The backup's speaker names are not readable. Nothing changed." };
  return { ok: true, page, keys, speakers, made_at: typeof b.made_at === "string" ? b.made_at : null };
}

export async function restoreBackup(env, text) {
  const b = readBackup(text);
  if (!b.ok) return b;
  const r = await houseFetch(env, "/restore", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ page: b.page, keys: b.keys }) });
  const said = await r.json().catch(() => null);
  if (!r.ok || !said?.ok) return { why: "The house could not put the backup back just now. Nothing changed: try again in a minute." };
  forgetLastKnown(env);
  for (const [id, name] of Object.entries(b.speakers)) {
    try { await nameDevice(env, id, name); } catch { /* the setup page names it again */ }
  }
  return { ok: true, page: Object.keys(b.page).length, keys: Object.keys(b.keys).length };
}

// CHECK THE HOUSE: each part asked now, once. A row is { title, state,
// detail }, the checklist's states: done, due (works, wants a look), todo
// (broken, with what to do).
export async function checkHouse(env, now = Date.now()) {
  const rows = [];
  const timed = async (f) => { const t0 = Date.now(); try { return { v: await f(), ms: Date.now() - t0 }; } catch (e) { return { e, ms: Date.now() - t0 }; } };

  const store = await timed(async () => (await houseFetch(env, "/settings")).json());
  rows.push(store.e ? { title: "The house's storage", state: "todo",
    detail: "It did not answer. Wait a minute and check again; if it stays like this, the house needs redeploying." }
    : { title: "The house's storage", state: store.ms > SETTINGS_READ_MS ? "due" : "done",
      detail: `Answered in ${store.ms} ms${store.ms > SETTINGS_READ_MS ? ": slow, so pages fall back to the last settings it read" : ""}` });

  const ledger = await timed(() => station(env, "helper-get", {}, { unbudgeted: true }));
  rows.push(ledger.e ? { title: "The request ledger", state: "todo",
    detail: "It did not answer: requests from the DJ pages and Talk's minutes cannot be kept. Check again in a minute." }
    : { title: "The request ledger", state: "done", detail: `Answered in ${ledger.ms} ms` });

  const kv = await timed(async () => { await programsKV(env).get("health:probe"); await tokensKV(env).get("health:probe"); return true; });
  rows.push(kv.e ? { title: "The key-value stores", state: "todo",
    detail: "They did not answer. Cloudflare's free plan allows 1,000 writes a day: if the day's are spent, they come back at midnight UTC." }
    : { title: "The key-value stores", state: "done", detail: "Both answered" });

  if (!env.SPOTIFY_CLIENT_ID) {
    rows.push({ title: "Spotify", state: "todo", detail: "No Spotify app yet: set it up on the checklist." });
  } else {
    const me = await timed(() => spotify(withBudget(env, { remaining: 3 }), "GET", "/me"));
    const login = await spotifyLogin(env, now).catch(() => ({}));
    rows.push(me.e ? { title: "Spotify", state: "todo",
      detail: login.out || !login.present ? "Not signed in: sign in to Spotify from the checklist." :
        "Spotify did not answer just now. It limits how often an app may ask; check again in a while." }
      : { title: "Spotify", state: login.due ? "due" : "done",
        detail: `Answers as ${me.v?.display_name ?? me.v?.id ?? "the house's account"}${login.due ? ": the sign-in ends soon, reconnect from the checklist" : ""}` });
  }

  const seen = await readSeen(env);
  const age = (iso) => (iso ? now - Date.parse(iso) : Infinity);
  rows.push(!seen.connector ? { title: "Claude or ChatGPT", state: "todo",
    detail: "It has never called: add the house to Claude or ChatGPT, as the checklist's step says." }
    : { title: "Claude or ChatGPT", state: age(seen.connector) > 7 * 86400000 ? "due" : "done",
      detail: age(seen.connector) > 7 * 86400000 ? "No call for over a week. If it says it cannot reach the house, remove the house from it and add it again with the address on the checklist."
        : "It has called this week" });

  // The curator the house rings, Claude's task or ChatGPT's Work chat (MC-31
  // 6b; the practice install, 2026-10-19: a ChatGPT curator went unchecked).
  const kind = curatorKind(env);
  if (env.AGENT_SECRET && kind) {
    let at = null;
    try { at = Number((await programsKV(env).get(CURATOR_SEEN_KEY, { type: "json" }))?.at) || null; } catch { at = null; }
    const where = kind === "chatgpt" ? "its Work chat at chatgpt.com" : "its task at claude.ai/code (Scheduled)";
    const deaf = kind === "chatgpt" && !(await workSubscriptions(env).catch(() => ({ count: 1 }))).count;
    rows.push(!at ? { title: "The curator", state: "todo", detail: `It has never checked in: look at ${where}.` }
      : deaf ? { title: "The curator", state: "todo",
        detail: "No Work chat is listening for the house's work: paste the curator's first note into its Work chat again (the checklist's Curator step)." }
      : { title: "The curator", state: now - at > CURATOR_QUIET_MS ? "todo" : "done",
        detail: now - at > CURATOR_QUIET_MS ? `No check-in for over an hour: open ${where} and look at its last run.`
          : "Checked in within the hour" });
  }
  // Only a helper that has ever reported is missed (Codex, 2026-10-17): every
  // claimed house has the helper's key, as the checklist knows.
  if (env.HELPER_SECRET) {
    const h = await timed(() => station(env, "helper-get", {}, { unbudgeted: true }));
    if (h.v?.hands) rows.push({ title: "The home helper", state: "done", detail: "Connected" });
    else if (h.v?.doc) rows.push({ title: "The home helper", state: "due", detail: "Not connected: the computer it runs on may be asleep. Everything else works without it." });
  }
  return rows;
}
