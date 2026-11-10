// THE REQUESTS PRESET, MADE ON THE SETUP PAGE (the forum road, 2026-10-17):
// a number chosen (1 suggested), a Spotify playlist "Requests" made, kept as
// the house's Spotify guest; then how to fill it and save it.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, makeHouseStore, installFetch } from "./harness.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function blank() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.BUTTONS = [];
  e.PROGRAM_LIBRARY_KEY = "pagekey12345";
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
async function claim(e) {
  return ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
}

test("a blank house makes its Requests preset on the number chosen, and the house uses it", async () => {
  const f = installFetch();
  // Spotify's answer to a new playlist: its id.
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => init?.method === "POST" && new URL(String(u)).pathname.endsWith("/me/playlists")
    ? (f.calls.push("POST /me/playlists"), Response.json({ id: "NEWREQUESTS00000000001", name: "Requests" }, { status: 201 }))
    : inner(u, init);
  try {
    const e = await blank();
    const me = await claim(e);
    const list = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(list, /href="\/setup\/requests">Make the Requests preset</);
    const page = await (await go(e, "/setup/requests", { cookie: me })).text();
    assert.match(page, /<option value="1" selected>1<\/option>/, "1 suggested");
    assert.equal((await go(e, "/setup/requests", { method: "POST", form: { button: "13" }, cookie: me })).status, 400);
    const made = await go(e, "/setup/requests", { method: "POST", form: { button: "5" }, cookie: me });
    assert.equal(made.headers.get("location"), "/setup/requests?made=1");
    assert.ok(f.calls.includes("POST /me/playlists"), "the playlist is made in Spotify");
    const how = await (await go(e, "/setup/requests?made=1", { cookie: me })).text();
    assert.match(how, /Preset 5, the playlist (&quot;|")Requests(&quot;|")/);
    // Rewritten for the eye (the owner's test, 2026-11-09): three numbered blocks, each named for its app.
    assert.ok(f.calls.some((c) => /^POST \/playlists\/NEWREQUESTS00000000001\/(tracks|items)/.test(c)), f.calls.join("\n"));
    assert.match(how, /Done: a playlist called Requests is in your Spotify account now/);
    assert.match(how, /<b>The playlist (&quot;|")Requests(&quot;|") is in your Spotify account now\.<\/b> Save it once on preset 5/);
    const heads = [...how.matchAll(/<h3><span class="reqn">(\d)<\/span>([^<]+)<small>([^<]+)<\/small><\/h3>/g)].map((m) => `${m[1]} ${m[2]} / ${m[3]}`);
    assert.deepEqual(heads, ["1 Play the playlist on your WiiM / In the Spotify app", "2 Save it on preset 5 / In the WiiM Home app",
      "3 Ask a DJ for your first set / In Claude or ChatGPT"]);
    // Saved the one way that works: started from the Spotify app, then the song bar's … menu (START-HERE.md §5).
    assert.match(how, /Open the playlist <b>Requests<\/b>\. The house put a few songs in it to start with\./);
    assert.match(how, /Tap <b>…<\/b>, then <b>Preset<\/b>, then <b>5<\/b>\./);
    assert.match(how, /starts on the <b>Pro Plus<\/b>, your\s+default speaker/);
    assert.ok(how.indexOf("Vibe, play me 20 minutes") < how.indexOf("Librarian, an introduction"), "the quick ask first");
    // The rarer cases, folded away.
    assert.match(how, /<summary>The playlist is empty, or won(&#39;|')t play<\/summary>\s*<p>Do step 3 first/);
    assert.match(how, /Allowing it always \(Claude(&#39;|')s <b>Always allow<\/b>\) is\s+fine/);
    // The house now has a live Spotify guest on 5: get_dj names it.
    const { withSettings } = await import("../settings.js");
    const live = await withSettings(e, null);
    const g = __test.guestFor(live, "spotify");
    assert.deepEqual([g?.btn, g?.live], [5, true]);
    assert.equal((await go(e, "/setup/requests", { method: "POST", form: { button: "1" }, cookie: me })).status, 409, "only one");
  } finally { globalThis.fetch = inner; f.restore(); }
});

test("a number another of the house's presets uses is refused, never taken over (Codex, 2026-10-17)", async () => {
  const e = await blank();
  e.SPOTIFY_CLIENT_ID = "0123456789abcdef0123456789abcdef";
  e.BUTTONS = JSON.stringify([{ button: 4, label: "KQED" }]);
  e.ENDLESS = JSON.stringify({ mode: "live", presets: [{ button: 2, dj: "hank", playlist: "HANKENDLESS00000000002" }] });
  const me = await claim(e);
  for (const n of ["2", "4"]) {
    const r = await go(e, "/setup/requests", { method: "POST", form: { button: n }, cookie: me });
    assert.equal(r.status, 400, n);
    assert.match(await r.text(), new RegExp(`Preset ${n} already plays something of the house(&#39;|')s`));
  }
});

test("with no Spotify app yet, the page says what comes first, and anyone but the owner is sent to /setup", async () => {
  const e = await blank();
  delete e.SPOTIFY_CLIENT_ID;
  const me = await claim(e);
  assert.match(await (await go(e, "/setup/requests", { cookie: me })).text(), /Set up the Spotify app and sign in to Spotify first/);
  assert.equal((await go(e, "/setup/requests")).status, 303);
});
