// THE HOUSE'S SETTINGS IN ITS OWN STORAGE (MC-31, the settings storage,
// step 1 of 3, 2026-10-16). Today every setting is a [vars] line that
// house.json renders into wrangler.toml, so a change is a file edit and a
// deploy. A forum house is to be set up from a page instead, and a page
// cannot edit a file: the settings go into one Durable Object, HOUSE, read
// once per request and laid onto the same env names, so house(env) and every
// other reader stay as they are (Codex's second review, the plan's *Codex's
// second review*). A Durable Object, not KV: claiming a house and the
// Spotify sign-in need a read that sees the last write.
//
// Step 1 was the shadow: the vars copied in and compared on the live house
// (19 of 19 the same, ~20 ms a read). Step 2, here, reads the copy on every
// request with the vars as the fallback (withSettings); step 3 keeps who
// claimed the house (ownerOp below, claim.js).

// Every [vars] name house.json can render (install/house.template.toml), and
// nothing else: bindings, secrets, routes and the cron stay Wrangler's.
// test/settings.test.js holds this list to the template.
export const SETTING_NAMES = [
  "DEFAULT_DEVICE", "ROOM_DEVICES", "WIIM_SPEAKERS", "PROGRAM_BASE_URL",
  "REQUESTS_ENABLED", "AUTOFULFILL_ENABLED", "REQUEST_ROUTINE_ID", "REQUEST_NOTES", "TIDAL_COUNTRY", "HOUSE_TZ", "PLAYER_REUSE", "RULES_HISTORY", "ENDLESS",
  "ARCHIVE_SITE_URL", "ARCHIVE_OCCURRENCES_URL", "ARCHIVE_TRACKS_URL", "ARCHIVE_MEDIA_URL",
  "PROGRAM_REPLAY_PLAYLIST", "BUTTONS", "PLAYLIST_ALIASES", "SOURCE_REPO",
];

// THE HOUSE'S KEYS (the keys design, 2026-10-17). A new house is deployed
// with one secret, SETUP_KEY; the claim makes the ones below, and the owner
// gives the others on the setup page. Kept as the settings document's
// `keys` and laid onto the same env names, a Worker secret of the same name
// always winning, so a house that has its secrets (the owner's) is as it was.
export const MADE_KEYS = ["MCP_SECRET", "AGENT_SECRET", "PROGRAM_LIBRARY_KEY", "HELPER_SECRET"];
export const GIVEN_KEYS = ["SPOTIFY_CLIENT_ID", "REQUEST_ROUTINE_TOKEN"];
function newKey() {
  // 24 random bytes, base64url: the shape the pages' and connectors' paths take.
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// THE SETTINGS THE SETUP PAGE MAY CHOOSE (stage 6, one at a time). Kept
// apart from the file's copy, as `page`, and laid on top of it name by name:
// a setting chosen on the page wins for that name only, and a house.json
// edit still reaches every other (the owner's house keeps its file).
// CURATOR: "claude" or "chatgpt", the one curator the house rings (MC-31 6b).
// WIIM_SPEAKERS: a door-made house's WiiMs as its home helper found them
// (MC-31 stage 5, the /helper/speakers door); the owner's are in its file.
// DJ_TUNING: the DJs' dials as the household moved them (MC-32, tuning.js),
// chosen on a DJ's page, never in a file.
// PROGRAM_BASE_URL: the house's own address, learned from its owner's setup
// page where no file sets it (MC-34 1a, the Deploy button's house has no
// address until it is visited).
// UPDATE_REPO: the owner's own GitHub copy of a house made by the Deploy
// button, for its Updates step (MC-34 stage 2, updates.js).
export const PAGE_SETTINGS = ["DEFAULT_DEVICE", "HOUSE_TZ", "ROOM_DEVICES", "BUTTONS", "REQUEST_ROUTINE_ID", "REQUESTS_ENABLED", "AUTOFULFILL_ENABLED", "ENDLESS", "WIIM_NAMES", "CURATOR", "WIIM_SPEAKERS", "DJ_TUNING", "PROGRAM_BASE_URL", "UPDATE_REPO"];

// The settings as this deploy's vars have them: the names present, values as
// Wrangler hands them over (a string, or BUTTONS' array of tables).
export function settingsOf(env) {
  const out = {};
  for (const n of SETTING_NAMES) if (env?.[n] !== undefined) out[n] = env[n];
  return out;
}

// One object for the household, like the request ledger (station.js). The
// classic fetch-shaped class, so the node suite can import it. It is placed
// near its first caller and stays there, so the first call must come from the
// house's own side, never the cron.
export class HouseSettings {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS doc (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  async fetch(request) {
    // When the house last saw each of its doors used (the setup checklist).
    if (new URL(request.url).pathname === "/seen") {
      // The body first, then the read and the write with no await between,
      // so two notes at once cannot drop one (Codex, 2026-10-17).
      let body = null;
      if (request.method !== "GET") {
        try { body = await request.json(); } catch { body = {}; }
      }
      const row = this.sql.exec("SELECT v FROM doc WHERE k = ?", "seen").toArray()[0];
      const seen = row ? JSON.parse(row.v) : {};
      if (request.method === "GET") return Response.json(seen);
      if (!SEEN_WHAT.includes(body?.what)) return Response.json({ ok: false, code: "bad-what" }, { status: 400 });
      seen[body.what] = new Date().toISOString();
      this.sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "seen", JSON.stringify(seen));
      return Response.json({ ok: true });
    }
    // A HELPER PAIRING CODE, USED ONCE (the locks review, 2026-10-25): it
    // was good for its whole hour, as often as it was sent. { hash, exp }:
    // first is true the first time a code's hash is seen; kept until its
    // hour is out, here where two installs at once cannot both be first.
    if (new URL(request.url).pathname === "/pair-used") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body = null;
      try { body = await request.json(); } catch { body = {}; }
      const hash = String(body?.hash ?? ""), exp = Number(body?.exp);
      if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(exp)) return Response.json({ ok: false, code: "bad" }, { status: 400 });
      const row = this.sql.exec("SELECT v FROM doc WHERE k = ?", "pair_used").toArray()[0];
      const now = Date.now();
      const used = Object.fromEntries(Object.entries(row ? JSON.parse(row.v) : {}).filter(([, e]) => e > now));
      const first = !(hash in used);
      used[hash] = exp;
      this.sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "pair_used", JSON.stringify(used));
      return Response.json({ ok: true, first });
    }
    // The owner (step 3, claim.js): who claimed the house, by hashes only.
    if (new URL(request.url).pathname === "/owner") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body;
      try { body = await request.json(); } catch { body = {}; }
      return Response.json(ownerOp(this.sql, body ?? {}));
    }
    // A setting chosen on the setup page: { name, value }, value null to
    // hand that setting back to the file.
    if (new URL(request.url).pathname === "/page") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body;
      try { body = await request.json(); } catch { body = {}; }
      if (!PAGE_SETTINGS.includes(body?.name)) return Response.json({ ok: false, code: "bad-name" }, { status: 400 });
      const v = body.value ?? null;
      if (v !== null && (typeof v !== "string" || !v.trim() || v.length > 2000)) {
        return Response.json({ ok: false, code: "bad-value" }, { status: 400 });
      }
      const row = this.sql.exec("SELECT v FROM doc WHERE k = ?", "settings").toArray()[0];
      const doc = row ? JSON.parse(row.v) : { settings: {}, from: "page", vars_fp: null };
      doc.page = { ...(doc.page ?? {}) };
      if (v === null) delete doc.page[body.name]; else doc.page[body.name] = v;
      doc.saved_at = new Date().toISOString();
      this.sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "settings", JSON.stringify(doc));
      return Response.json({ ok: true, page: doc.page });
    }
    // SEVERAL SETTINGS AND KEYS AT ONCE (Codex, 2026-10-17: the curator's
    // task id, its token and the two switches were four writes, and a failure
    // between them left one task's id with another's token): { page: { name:
    // value | null }, keys: { name: value } }, one write.
    if (new URL(request.url).pathname === "/page-many") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body;
      try { body = await request.json(); } catch { body = {}; }
      const page = body?.page && typeof body.page === "object" ? body.page : {};
      const keys = body?.keys && typeof body.keys === "object" ? body.keys : {};
      const ok = (o, names, max) => Object.entries(o).every(([n, v]) => names.includes(n) &&
        (v === null || (typeof v === "string" && v.trim() && v.length <= max)));
      if (!ok(page, PAGE_SETTINGS, 2000) || !ok(keys, GIVEN_KEYS, 300)) return Response.json({ ok: false, code: "bad-value" }, { status: 400 });
      const row = this.sql.exec("SELECT v FROM doc WHERE k = ?", "settings").toArray()[0];
      const doc = row ? JSON.parse(row.v) : { settings: {}, from: "page", vars_fp: null };
      doc.page = { ...(doc.page ?? {}) };
      doc.keys = { ...(doc.keys ?? {}) };
      for (const [n, v] of Object.entries(page)) { if (v === null) delete doc.page[n]; else doc.page[n] = v; }
      for (const [n, v] of Object.entries(keys)) { if (v === null) delete doc.keys[n]; else doc.keys[n] = v; }
      doc.saved_at = new Date().toISOString();
      this.sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "settings", JSON.stringify(doc));
      return Response.json({ ok: true, page: doc.page });
    }
    // THE HOUSE'S KEYS (the keys design, 2026-10-17): { make: [names] } makes
    // each one missing, once, here, where two claims cannot both make one;
    // { set: { name: value } } keeps one the owner gave; { renew: [names] }
    // replaces a made one the store holds (the locks review, 2026-10-25: a
    // leaked key had no way out). Answers with the names held, never a value.
    if (new URL(request.url).pathname === "/keys") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body;
      try { body = await request.json(); } catch { body = {}; }
      const make = Array.isArray(body?.make) ? body.make : [];
      const renew = Array.isArray(body?.renew) ? body.renew : [];
      const set = body?.set && typeof body.set === "object" ? body.set : {};
      if ([...make, ...renew].some((n) => !MADE_KEYS.includes(n)) || Object.keys(set).some((n) => !GIVEN_KEYS.includes(n)) ||
        Object.values(set).some((v) => v !== null && (typeof v !== "string" || !v || v.length > 300))) {
        return Response.json({ ok: false, code: "bad-keys" }, { status: 400 });
      }
      const row = this.sql.exec("SELECT v FROM doc WHERE k = ?", "settings").toArray()[0];
      const doc = row ? JSON.parse(row.v) : { settings: {}, from: "keys", vars_fp: null, page: {} };
      doc.keys = { ...(doc.keys ?? {}) };
      for (const n of make) if (!doc.keys[n]) doc.keys[n] = newKey();
      const renewed = renew.filter((n) => doc.keys[n]);
      for (const n of renewed) doc.keys[n] = newKey();
      for (const [n, v] of Object.entries(set)) { if (v === null) delete doc.keys[n]; else doc.keys[n] = v; }
      this.sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "settings", JSON.stringify(doc));
      return Response.json({ ok: true, held: Object.keys(doc.keys), renewed });
    }
    // A BACKUP PUT BACK (backup.js): the page's settings replaced whole, the
    // keys given set by name; checked by the Worker before it comes here.
    if (new URL(request.url).pathname === "/restore") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body;
      try { body = await request.json(); } catch { body = {}; }
      const page = body?.page && typeof body.page === "object" ? body.page : {};
      const keys = body?.keys && typeof body.keys === "object" ? body.keys : {};
      const strings = (o, names) => Object.entries(o).every(([n, v]) => names.includes(n) && typeof v === "string" && v && v.length <= 2000);
      if (!strings(page, PAGE_SETTINGS) || !strings(keys, [...MADE_KEYS, ...GIVEN_KEYS])) {
        return Response.json({ ok: false, code: "bad-backup" }, { status: 400 });
      }
      const row = this.sql.exec("SELECT v FROM doc WHERE k = ?", "settings").toArray()[0];
      const doc = row ? JSON.parse(row.v) : { settings: {}, from: "restore", vars_fp: null };
      doc.page = { ...page };
      doc.keys = { ...(doc.keys ?? {}), ...keys };
      doc.saved_at = new Date().toISOString();
      this.sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "settings", JSON.stringify(doc));
      return Response.json({ ok: true, page: Object.keys(doc.page), keys: Object.keys(keys) });
    }
    if (request.method === "GET") {
      const row = this.sql.exec("SELECT v FROM doc WHERE k = ?", "settings").toArray()[0];
      return new Response(row?.v ?? "null", { headers: { "content-type": "application/json" } });
    }
    if (request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { body = null; }
      const s = body?.settings;
      if (!s || typeof s !== "object" || Array.isArray(s) ||
        Object.keys(s).some((n) => !SETTING_NAMES.includes(n))) {
        return Response.json({ ok: false, code: "bad-settings" }, { status: 400 });
      }
      // The page's own settings ride along untouched: a deploy refreshes the
      // file's copy, never what the owner chose on the page.
      const prev = this.sql.exec("SELECT v FROM doc WHERE k = ?", "settings").toArray()[0];
      const was = prev ? JSON.parse(prev.v) ?? {} : {};
      const doc = { settings: s, saved_at: new Date().toISOString(), from: String(body.from ?? "vars").slice(0, 40),
        vars_fp: typeof body.vars_fp === "string" ? body.vars_fp.slice(0, 64) : null, page: was.page ?? {}, keys: was.keys ?? {} };
      this.sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "settings", JSON.stringify(doc));
      return Response.json({ ok: true, saved_at: doc.saved_at });
    }
    return new Response("method not allowed", { status: 405 });
  }
}

// WHO OWNS THE HOUSE (step 3): one row, `owner`, holding the claim's date,
// the sign-in tokens' hashes (one per browser, newest first, eight at most)
// and the recovery code's hash. Nothing here sees a token or a code itself.
// Synchronous SQL with no await between the look and the write, so two
// claims at once cannot both win: the object answers them one at a time.
const HASH = /^[0-9a-f]{64}$/;
const OWNER_DEVICES = 8;
export function ownerOp(sql, { op, token = null, recovery = null, key_hash = null }) {
  const row = sql.exec("SELECT v FROM doc WHERE k = ?", "owner").toArray()[0];
  const o = row ? JSON.parse(row.v) : null;
  if (op === "look") {
    const owner = !!o && HASH.test(String(token)) && o.tokens.includes(token);
    return { claimed: !!o, claimed_at: o?.claimed_at ?? null, owner, ...(owner ? { browsers: o.tokens.length } : {}) };
  }
  // EVERY OTHER BROWSER SIGNED OUT (the locks review, 2026-10-25): a lost
  // phone's sign-in ended from the one in hand, which stays.
  if (op === "sign-out-others") {
    if (!o || !HASH.test(String(token)) || !o.tokens.includes(token)) return { ok: false, code: "not-owner" };
    const gone = o.tokens.length - 1;
    o.tokens = [token];
    sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "owner", JSON.stringify(o));
    return { ok: true, signed_out: gone };
  }
  if (op === "claim") {
    if (!HASH.test(String(token)) || !HASH.test(String(recovery))) return { ok: false, code: "bad" };
    const key = HASH.test(String(key_hash)) ? key_hash : null;
    // A NEW SETUP KEY OPENS THE CLAIM AGAIN (Codex, 2026-10-17): a claim
    // whose answer never reached the browser would leave the house with an
    // owner nobody can sign in as. Whoever can set the Worker's SETUP_KEY
    // (the Cloudflare account) sets a new one and claims again; the old
    // sign-ins and recovery code stop. The same key never claims twice, and a
    // claim made before the key was kept (the owner's, 2026-10-16) stays.
    if (o && !(o.key_hash && key && o.key_hash !== key)) return { ok: false, code: "claimed" };
    const n = { claimed_at: new Date().toISOString(), tokens: [token], recovery, key_hash: key, ...(o ? { reclaimed: true } : {}) };
    sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "owner", JSON.stringify(n));
    return { ok: true, claimed_at: n.claimed_at, reclaimed: !!o };
  }
  // A NEW RECOVERY CODE for a browser already signed in (Codex, 2026-10-17:
  // a reload after the claim, or a code never saved, had no way back but a
  // new setup key). The old code stops.
  if (op === "new-code") {
    if (!o || !HASH.test(String(token)) || !o.tokens.includes(token) || !HASH.test(String(recovery))) return { ok: false, code: "not-owner" };
    o.recovery = recovery;
    sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "owner", JSON.stringify(o));
    return { ok: true };
  }
  if (op === "recover") {
    if (!o) return { ok: false, code: "unclaimed" };
    if (!HASH.test(String(token)) || recovery !== o.recovery) return { ok: false, code: "wrong-code" };
    o.tokens = [token, ...o.tokens.filter((t) => t !== token)].slice(0, OWNER_DEVICES);
    sql.exec("INSERT OR REPLACE INTO doc (k, v) VALUES (?, ?)", "owner", JSON.stringify(o));
    return { ok: true };
  }
  return { ok: false, code: "unknown-op" };
}

// WHEN A DOOR WAS LAST USED (the setup checklist, 2026-10-16): the owner's
// connector ("connector") and the curator's ("curator"), so the checklist
// can tick "Claude app" once the app has called. Written at most every ten
// minutes per isolate, after the answer; a lost note costs a tick's
// freshness, nothing else.
export const SEEN_WHAT = ["connector", "curator"];
const SEEN_EVERY_MS = 10 * 60 * 1000;
// IS THE HOUSE CLAIMED? (Codex, 2026-10-17) The store is placed near its
// first caller and stays, so on a new house nothing but the claim, from the
// owner's own browser, may be first: until then requests and notes leave it
// alone and the vars serve. The claim's mark in PROGRAMS (claim.js) is read
// at most once a minute per isolate while it is absent, and once for good.
export const CLAIMED_KEY = "house:claimed";
const CLAIMED_SEEN = new WeakMap(); // PROGRAMS binding -> { yes, at }
const CLAIMED_RECHECK_MS = 60_000;
export function claimedKnown(env) {
  return !!(env?.PROGRAMS && typeof env.PROGRAMS === "object" && CLAIMED_SEEN.get(env.PROGRAMS)?.yes);
}
export function markClaimedHere(env) {
  if (env?.PROGRAMS && typeof env.PROGRAMS === "object") CLAIMED_SEEN.set(env.PROGRAMS, { yes: true, at: Date.now() });
}
export async function houseClaimed(env) {
  if (!env?.PROGRAMS || typeof env.PROGRAMS !== "object") return false;
  const m = CLAIMED_SEEN.get(env.PROGRAMS);
  if (m?.yes) return true;
  if (m && Date.now() - m.at < CLAIMED_RECHECK_MS) return false;
  let yes = false;
  try { yes = !!(await env.PROGRAMS.get(CLAIMED_KEY)); } catch { yes = false; }
  CLAIMED_SEEN.set(env.PROGRAMS, { yes, at: Date.now() });
  return yes;
}

// A STORE MADE AGAIN (the Mac test, 2026-10-19): the practice house's PROGRAMS
// was replaced and its claim mark went with it, while the settings store still
// knew its owner; so the setup page offered a claim its setup key could no
// longer make, and the house stopped reading its own settings. Asked by the
// setup pages only (a new house's store is placed by its owner's first visit,
// Codex 2026-10-17): with no mark, the settings store says whether it has an
// owner, and if it has, the mark is put back.
export async function claimedInStore(env) {
  if (!env?.HOUSE || typeof env.HOUSE !== "object" || !env?.PROGRAMS || typeof env.PROGRAMS !== "object") return false;
  let o = null;
  try {
    o = await (await houseFetch(env, "/owner", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "look" }) })).json();
  } catch { return false; }
  if (!o?.claimed) return false;
  try { await env.PROGRAMS.put(CLAIMED_KEY, String(o.claimed_at ?? new Date().toISOString())); } catch { /* put back on the next look */ }
  markClaimedHere(env);
  return true;
}

// Kept per binding, which is the house as this isolate knows it.
const SEEN_NOTED = new WeakMap();
export function noteSeen(env, ctx, what) {
  if (!env?.HOUSE || typeof env.HOUSE !== "object" || !SEEN_WHAT.includes(what)) return;
  if (!claimedKnown(env)) return;
  if (!SEEN_NOTED.has(env.HOUSE)) SEEN_NOTED.set(env.HOUSE, {});
  const noted = SEEN_NOTED.get(env.HOUSE);
  const now = Date.now();
  if (now - (noted[what] ?? 0) < SEEN_EVERY_MS) return;
  noted[what] = now;
  const write = houseFetch(env, "/seen", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ what }),
  }).then((r) => r.json()).catch(() => { noted[what] = 0; });
  if (ctx?.waitUntil) ctx.waitUntil(write);
  return write;
}
export async function readSeen(env) {
  try { return await (await houseFetch(env, "/seen")).json(); } catch { return {}; }
}

export function houseStub(env) {
  return env.HOUSE.get(env.HOUSE.idFromName("household"));
}
// One more try when the call itself throws: the object refuses a request
// while it restarts on new code, which a deploy causes (2026-10-17: the
// first save after one answered 500). Only for calls that are safe to make
// twice; a claim or a recovery is never repeated.
export async function houseFetch(env, path, init = undefined) {
  let r;
  try {
    r = await houseStub(env).fetch(`https://house${path}`, init);
  } catch {
    return houseStub(env).fetch(`https://house${path}`, init);
  }
  // And an answer of 500 or more, the first one read to the end (Codex,
  // 2026-10-17: whether a restarting object throws or answers 500 is not
  // known).
  if (r.status < 500) return r;
  try { await r.body?.cancel(); } catch { /* nothing to drain */ }
  return houseStub(env).fetch(`https://house${path}`, init);
}

// THE VARS' FINGERPRINT, kept with a copy of them: a deploy whose vars
// differ is a house.json edit, and the file wins while it is how a setting
// changes. One hash per isolate, since a deploy's vars never change under it.
const VARS_FP = { src: null, fp: null };
export async function varsFingerprint(vars) {
  const src = JSON.stringify(vars);
  if (VARS_FP.src !== src) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src)));
    VARS_FP.src = src;
    VARS_FP.fp = [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return VARS_FP.fp;
}

async function readDoc(env, ms) {
  let timer;
  const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error("the settings store is slow")), ms); });
  try {
    return await Promise.race([houseFetch(env, "/settings").then((r) => r.json()), late]);
  } finally { clearTimeout(timer); }
}

async function putDoc(env, settings, from, varsFp) {
  const r = await houseFetch(env, "/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings, from, vars_fp: varsFp }),
  });
  // Read to the end: an answer left unread keeps the object busy.
  const said = await r.json().catch(() => null);
  if (!r.ok || !said?.ok) throw new Error(`the settings store refused the copy (${r.status})`);
}

// THE SETTINGS FOR ONE REQUEST (step 2): the stored copy laid onto the same
// env names, so house(env) and every other reader stay as they are. The vars
// stay underneath as the fallback: no store bound, a store that does not
// answer in SETTINGS_READ_MS, or nothing stored yet. A copy made from the
// vars ("from": "vars") whose fingerprint is not this deploy's is a
// house.json edit: the vars are used and copied in again. The setup page's
// choices (`page`) go on top, name by name. `__settings` says which this
// request read, for the owner's look below.
export const SETTINGS_READ_MS = 1500;
// The page's choices and the house's keys as this isolate last read them,
// per house (Codex, 2026-10-17): a store that does not answer in time must
// not hand the default speaker back to the file, nor close the connector's
// door, for that one request.
const LAST_PAGE = new WeakMap();
export async function withSettings(env, ctx) {
  if (!env?.HOUSE) return env;
  const vars = settingsOf(env);
  let doc;
  try {
    doc = await readDoc(env, SETTINGS_READ_MS);
  } catch {
    const last = (typeof env.HOUSE === "object" && LAST_PAGE.get(env.HOUSE)) || { page: {}, keys: {} };
    return { ...env, ...last.page, ...last.keys, __vars: vars, __page: last.page, __keys: Object.keys(last.keys),
      __settings: "vars: the store did not answer" };
  }
  const fp = await varsFingerprint(vars);
  const page = pageOf(doc);
  const keys = keysOf(env, doc);
  if (typeof env.HOUSE === "object") LAST_PAGE.set(env.HOUSE, { page, keys });
  if (!doc?.settings || doc.vars_fp !== fp) {
    const copy = putDoc(env, vars, "vars", fp).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(copy); else await copy;
    return { ...env, ...page, ...keys, __vars: vars, __page: page, __keys: Object.keys(keys),
      __settings: doc?.settings ? "vars: house.json changed, copied in" : "vars: nothing stored, copied in" };
  }
  return { ...env, ...doc.settings, ...page, ...keys, __vars: vars, __page: page, __keys: Object.keys(keys), __settings: "store" };
}
// The house's keys, only where the Worker has no secret of that name.
function keysOf(env, doc) {
  const k = doc?.keys && typeof doc.keys === "object" ? doc.keys : {};
  return Object.fromEntries([...MADE_KEYS, ...GIVEN_KEYS]
    .filter((n) => typeof k[n] === "string" && k[n] && !env[n]).map((n) => [n, k[n]]));
}
// The claim makes the house's keys (only those the Worker has no secret for);
// the setup page gives one, or null to drop it.
export async function makeHouseKeys(env) {
  const make = MADE_KEYS.filter((n) => !env[n]);
  if (!make.length) return [];
  const r = await houseFetch(env, "/keys", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ make }) });
  const said = await r.json().catch(() => null);
  if (!r.ok || !said?.ok) throw new Error(`the house could not make its keys (${r.status})`);
  return said.held;
}
// A NEW KEY IN PLACE OF A MADE ONE (the locks review, 2026-10-25), only
// where the store holds it: a Worker secret of the name wins, and is changed
// with wrangler instead. The old one stops on the next request.
export async function renewHouseKey(env, name) {
  if (!MADE_KEYS.includes(name) || !(env.__keys ?? []).includes(name)) return false;
  const r = await houseStub(env).fetch("https://house/keys", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ renew: [name] }) });
  const said = await r.json().catch(() => null);
  if (!r.ok || !said?.ok) throw new Error(`the house could not make a new ${name} (${r.status})`);
  if (typeof env.HOUSE === "object") LAST_PAGE.delete(env.HOUSE);
  return said.renewed.includes(name);
}
// Forget this isolate's last known page and keys (a restore just wrote them).
export function forgetLastKnown(env) {
  if (typeof env?.HOUSE === "object") LAST_PAGE.delete(env.HOUSE);
}
export async function giveHouseKey(env, name, value) {
  const r = await houseFetch(env, "/keys", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ set: { [name]: value } }) });
  const said = await r.json().catch(() => null);
  if (!r.ok || !said?.ok) throw new Error(`the house could not keep ${name} (${r.status})`);
  if (typeof env.HOUSE === "object") LAST_PAGE.delete(env.HOUSE);
}
// Only the names the page may choose, whatever the object holds.
function pageOf(doc) {
  const p = doc?.page && typeof doc.page === "object" ? doc.page : {};
  return Object.fromEntries(PAGE_SETTINGS.filter((n) => typeof p[n] === "string").map((n) => [n, p[n]]));
}
// The setup page choosing a setting: the file's own value hands it back.
export async function choosePageSetting(env, name, value) {
  const fileSays = (env.__vars ?? settingsOf(env))[name];
  const r = await houseFetch(env, "/page", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, value: value === fileSays ? null : value }),
  });
  const said = await r.json().catch(() => null);
  if (!r.ok || !said?.ok) throw new Error(`the settings store refused ${name} (${r.status})`);
  return said.page;
}
// Several at once, and keys the owner gave with them, in one write.
export async function choosePageSettings(env, page, keys = {}) {
  const fileSays = env.__vars ?? settingsOf(env);
  const r = await houseFetch(env, "/page-many", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ page: Object.fromEntries(Object.entries(page).map(([n, v]) => [n, v === fileSays[n] ? null : v])), keys }),
  });
  const said = await r.json().catch(() => null);
  if (!r.ok || !said?.ok) throw new Error(`the settings store refused ${Object.keys(page).join(", ")} (${r.status})`);
  if (Object.keys(keys).length && typeof env.HOUSE === "object") LAST_PAGE.delete(env.HOUSE);
  return said.page;
}
