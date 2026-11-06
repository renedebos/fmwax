// CLAIMING A HOUSE (MC-31, the settings storage, step 3, 2026-10-16): once,
// with the setup key; a cookie for that browser and a recovery code for the
// next (claim.js, the setup routes in routes.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { CLAIMED_KEY, OWNER_COOKIE, normalRecovery } from "../claim.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
async function house(key = KEY) {
  const e = makeEnv();
  const store = await makeHouseStore();
  e.HOUSE = store.binding;
  if (key !== null) e.SETUP_KEY = key;
  return { e, store };
}
const ORIGIN = "https://fmwax.test";
function send(e, path, { method = "GET", form = null, cookie = null, origin = ORIGIN } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origin && method === "POST") headers.origin = origin;
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body: form ? new URLSearchParams(form) : undefined }), e, null);
}
const cookieOf = (r) => (r.headers.get("set-cookie") ?? "").split(";")[0];
const codeOf = (html) => html.match(/class="setcode"[^>]*>([0-9A-Z-]+)</)?.[1];

test("no setup key, or one short enough to guess: no door", async () => {
  const { e } = await house(null);
  assert.equal((await send(e, "/setup")).status, 404);
  assert.equal((await send(e, "/setup/claim", { method: "POST", form: { key: "" } })).status, 404);
  // One too short is said, with the way out (MC-34: the Deploy button's form
  // takes any password), and still opens nothing.
  const { e: s } = await house("short-key");
  for (const r of [await send(s, "/setup"), await send(s, "/setup/claim", { method: "POST", form: { key: "short-key" } })]) {
    assert.equal(r.status, 503);
    const html = await r.text();
    assert.match(html, /shorter than 24 characters/);
    assert.ok(!/Claim this house/.test(html), "no claim form");
  }
});

test("a new house shows the claim form, and the key is never in the page", async () => {
  const { e } = await house();
  const r = await send(e, "/setup");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Claim this house/);
  assert.ok(!html.includes(KEY));
});

test("a wrong key, or a post from elsewhere, claims nothing", async () => {
  const { e, store } = await house();
  const wrong = await send(e, "/setup/claim", { method: "POST", form: { key: "not-the-key-0123456789abcdef" } });
  assert.equal(wrong.status, 403);
  assert.match(await wrong.text(), /not this house(&#39;|')s setup key/);
  const elsewhere = await send(e, "/setup/claim", { method: "POST", form: { key: KEY }, origin: "https://evil.test" });
  assert.equal(elsewhere.status, 403);
  assert.equal((await send(e, "/setup/claim", { method: "POST", form: { key: KEY }, origin: null })).status, 403);
  assert.ok(!store.rows.has("owner"), "still unclaimed");
});

test("a phone's form: Origin null with the browser's same-origin mark is the page's own; cross-site is not", async () => {
  const { e, store } = await house();
  const post = (headers) => worker.fetch(new Request(`${ORIGIN}/setup/claim`, { method: "POST", headers,
    body: new URLSearchParams({ key: KEY }) }), e, null);
  assert.equal((await post({ origin: "null", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post({ origin: "null" })).status, 403, "no mark, no claim");
  assert.ok(!store.rows.has("owner"));
  const r = await post({ origin: "null", "sec-fetch-site": "same-origin" });
  assert.equal(r.status, 200);
  assert.ok(store.rows.has("owner"));
});

test("the setup page lets its forms name their origin", async () => {
  const { e } = await house();
  const r = await send(e, "/setup");
  assert.equal(r.headers.get("referrer-policy"), "same-origin");
});

test("the right key claims it once: a cookie, a recovery code shown once, and the cron's mark", async () => {
  const { e, store } = await house();
  const r = await send(e, "/setup/claim", { method: "POST", form: { key: ` ${KEY} ` } });
  assert.equal(r.status, 200);
  const set = r.headers.get("set-cookie");
  assert.match(set, new RegExp(`^${OWNER_COOKIE}=[0-9a-f]{64}; Path=/; Secure; HttpOnly; SameSite=Lax`));
  const code = codeOf(await r.text());
  assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const row = JSON.parse(store.rows.get("owner"));
  assert.ok(!JSON.stringify(row).includes(cookieOf(r).split("=")[1]), "the object keeps hashes, not the token");
  assert.ok(!JSON.stringify(row).includes(normalRecovery(code)), "nor the code");
  assert.ok(await e.PROGRAMS.get(CLAIMED_KEY));

  const again = await send(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  assert.equal(again.status, 409);
  assert.match(await again.text(), /already has an owner/);

  assert.match(await (await send(e, "/setup", { cookie: cookieOf(r) })).text(), /Every step ticks itself/);
  const stranger = await (await send(e, "/setup")).text();
  assert.match(stranger, /This house has an owner/);
  assert.ok(!stranger.includes(code), "the code is shown once, to the claimer");
});

test("the recovery code signs in another browser, and a wrong one does not", async () => {
  const { e } = await house();
  const first = await send(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  const code = codeOf(await first.text());
  const wrong = await send(e, "/setup/recover", { method: "POST", form: { code: "0000-0000-0000-0000" } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.headers.get("set-cookie"), null);
  // Typed the way a person types it: lower case, no dashes, an O for a 0.
  const typed = code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
  const second = await send(e, "/setup/recover", { method: "POST", form: { code: typed } });
  assert.equal(second.status, 303, "on to the checklist");
  assert.equal(second.headers.get("location"), "/setup?signed=1");
  assert.match(await (await send(e, "/setup?signed=1", { cookie: cookieOf(second) })).text(), /Signed in on this browser/);
  assert.notEqual(cookieOf(second), cookieOf(first));
  for (const c of [cookieOf(first), cookieOf(second)]) {
    assert.match(await (await send(e, "/setup", { cookie: c })).text(), /Every step ticks itself/);
  }
});

// THE PHONE KEEPS THE CODE (2026-11-05, the owner: "nobody would remember
// this password"): both boxes were plain text with autofill off, so no phone
// or browser ever offered to keep the code or fill it in.
test("the recovery code is a password a phone can keep: offered to save when shown, filled in at the sign-in", async () => {
  const { e } = await house();
  const claimed = await (await send(e, "/setup/claim", { method: "POST", form: { key: KEY } })).text();
  const code = codeOf(claimed);
  const save = claimed.match(/<form class="setform setsave" method="post" action="\/setup\/saved" id="setsave">([\s\S]*?)<\/form>/)?.[1];
  assert.ok(save, "a form to save it");
  assert.match(save, /<input class="vh sethouse" type="text" name="house" autocomplete="username"/, "kept under the house's address");
  assert.ok(save.includes(`type="password" name="code" autocomplete="new-password" value="${code}"`), "the code itself, as a new password");
  assert.match(save, /<button class="sgo" type="submit">Save it in this phone's passwords<\/button>/);
  assert.match(claimed, /hs\[k\]\.value = location\.host/, "the address filled in by the page");
  assert.match(claimed, /new PasswordCredential\(sf\)/, "a browser that can be asked outright is asked");
  // Sent, it goes on to the checklist and reads nothing; from elsewhere, refused.
  const saved = await send(e, "/setup/saved", { method: "POST", form: { house: "x", code } });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get("location"), "/setup");
  assert.equal((await send(e, "/setup/saved", { method: "POST", form: { code }, origin: "https://elsewhere.test" })).status, 403);
  // The sign-in on another browser: a login form, the code as its password, shown on asking.
  const owned = await (await send(e, "/setup")).text();
  assert.match(owned, /<input class="vh sethouse" type="text" name="house" autocomplete="username" tabindex="-1" aria-hidden="true">\s*<label for="scode">Recovery code<\/label>\s*<input type="password" id="scode" name="code" required autocomplete="current-password"/);
  assert.match(owned, /<label class="setshow"><input type="checkbox" id="sshow"> Show the code<\/label>/);
  assert.match(owned, /sc\.type = sh\.checked \? "text" : "password"/);
  assert.ok(!owned.includes(code));
  // And it still signs in, sent with the house's address beside it.
  const back = await send(e, "/setup/recover", { method: "POST", form: { house: "fmwax.test", code } });
  assert.equal(back.headers.get("location"), "/setup?signed=1");
});

test("recovering an unclaimed house says to claim it", async () => {
  const { e } = await house();
  const r = await send(e, "/setup/recover", { method: "POST", form: { code: "0000-0000-0000-0000" } });
  assert.equal(r.status, 409);
  assert.match(await r.text(), /no owner yet/);
});

test("the cron reads the settings store only once the house is claimed", async () => {
  const { e, store } = await house();
  await worker.scheduled({ scheduledTime: Date.now() }, e);
  assert.equal(store.calls, 0, "unclaimed: the cron does not touch the store");
  await send(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  const before = store.calls;
  await worker.scheduled({ scheduledTime: Date.now() }, e);
  assert.ok(store.calls > before);
  assert.ok(await e.PROGRAMS.get(CLAIMED_KEY));
});

test("a new setup key opens the claim again; the old key never claims twice", async () => {
  const { e } = await house();
  const first = await send(e, "/setup/claim", { method: "POST", form: { key: KEY } });
  const old = cookieOf(first);
  assert.equal((await send(e, "/setup/claim", { method: "POST", form: { key: KEY } })).status, 409, "same key: refused");
  e.SETUP_KEY = "a-new-setup-key-0123456789abcdef"; // set again in Cloudflare by the account's owner
  const again = await send(e, "/setup/claim", { method: "POST", form: { key: e.SETUP_KEY } });
  assert.equal(again.status, 200);
  assert.match(await (await send(e, "/setup", { cookie: cookieOf(again) })).text(), /Every step ticks itself/);
  assert.match(await (await send(e, "/setup", { cookie: old })).text(), /This house has an owner/, "the old sign-in has stopped");
  // Where the installer's new link lands: the owned page, with the claim to open.
  assert.match(await (await send(e, "/setup")).text(), /Claim it again with a new setup key[\s\S]*action="\/setup\/claim"/);
  assert.equal((await send(e, "/setup/claim", { method: "POST", form: { key: e.SETUP_KEY } })).status, 409, "and the new key once only");
});

test("the owner's look puts back a claim mark that was lost", async () => {
  const { e } = await house();
  const me = cookieOf(await send(e, "/setup/claim", { method: "POST", form: { key: KEY } }));
  await e.PROGRAMS.delete(CLAIMED_KEY);
  await send(e, "/setup", { cookie: me });
  assert.ok(await e.PROGRAMS.get(CLAIMED_KEY));
});
