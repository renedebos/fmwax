// THE DJ PRESETS, MADE ON THE SETUP PAGE (the Endless step, part 2,
// 2026-10-17): a house DJ and the guest DJ on numbers chosen (2 and 3
// suggested), their playlists made, the endless DJs on, the first set asked.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { renderBlankHouse } from "../install/config.js";
import { makeEnv, makeHouseStore, installFetch } from "./harness.js";
import { ARCHIVE } from "../archive-identity.js";

const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax.test";
async function house() {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  e.PROGRAM_LIBRARY_KEY = "pagekey12345";
  e.AGENT_SECRET = "agent-key-0123456789";
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: "REQUESTS00000000000001", catalog: "spotify" }]);
  delete e.ENDLESS;
  delete e.REQUEST_ROUTINE_ID;
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
async function claim(e) {
  return ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
}
function spotifyMakes() {
  const f = installFetch();
  let n = 0;
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => init?.method === "POST" && new URL(String(u)).pathname.endsWith("/me/playlists")
    ? Response.json({ id: `NEWPLAYLIST${String(++n).padStart(11, "0")}`, name: JSON.parse(init.body).name }, { status: 201 })
    : inner(u, init);
  return { restore: () => { globalThis.fetch = inner; f.restore(); }, made: () => n };
}

test("a terminal-door house has the ten-minute schedule from the start", () => {
  const t = renderBlankHouse({ name: "x", baseUrl: "https://x.example.workers.dev", tokensId: "a".repeat(32), programsId: "b".repeat(32), compatibilityDate: "2025-06-01" });
  assert.match(t, /crons = \["\*\/10 \* \* \* \*"\]/);
});

test("the DJ presets wait for the curator, then are made on the numbers chosen, and the house DJ's first set is asked for", async () => {
  const s = spotifyMakes();
  try {
    const e = await house();
    const me = await claim(e);
    assert.match(await (await go(e, "/setup/endless", { cookie: me })).text(), /Set up the curator first/);
    await go(e, "/setup/curator", { method: "POST", form: { routine: "trig_01ABCDEFGHIJKL", token: "t".repeat(40) }, cookie: me });
    const list = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(list, /href="\/setup\/endless">Choose the house DJ</);
    const page = await (await go(e, "/setup/endless", { cookie: me })).text();
    assert.match(page, /<option value="vibe">Vibe<\/option>/);
    assert.doesNotMatch(page, new RegExp(`value="deep-dive"|value="genre"|value="${ARCHIVE.dj}"`), "no DJ who needs words, and not the archive");
    assert.doesNotMatch(page, /<option value="1">/, "the Requests preset is not offered");
    assert.match(page, /Preset 1 is your Requests preset: the sets you ask for/);
    assert.match(page, /<option value="2" selected>[\s\S]*<option value="3" selected>/);
    assert.equal((await go(e, "/setup/endless", { method: "POST", form: { dj: "vibe", own: "2", lane: "2" }, cookie: me })).status, 400);
    assert.equal((await go(e, "/setup/endless", { method: "POST", form: { dj: "vibe", own: "1", lane: "3" }, cookie: me })).status, 400, "1 is the Requests preset");
    const made = await go(e, "/setup/endless", { method: "POST", form: { dj: "vibe", own: "2", lane: "3" }, cookie: me });
    assert.match(made.headers.get("location"), /^\/setup\/endless\?fresh=/);
    assert.equal(s.made(), 2, "two playlists made");
    const after = await (await go(e, "/setup/endless?fresh=asked", { cookie: me })).text();
    assert.match(after, /Vibe, preset 2\./);
    assert.match(after, /The guest DJ, preset 3\./);
    const list2 = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(list2, /2 Vibe · 3 guest DJ/);
    assert.equal((await go(e, "/setup/endless", { method: "POST", form: { dj: "hank", own: "4", lane: "5" }, cookie: me })).status, 409, "once");
  } finally { s.restore(); }
});

// ONE MORE HOUSE DJ (the owner, 2026-10-18, https://claude.ai/artifact/65nX1hUvqycJifig2GSSjh):
// up to four house DJs, each added from a DJ's page on a free number, saved by
// hand on each WiiM, and given up from their own page.
async function setupHouse(s) {
  const e = await house();
  const me = await claim(e);
  await go(e, "/setup/curator", { method: "POST", form: { routine: "trig_01ABCDEFGHIJKL", token: "t".repeat(40) }, cookie: me });
  await go(e, "/setup/endless", { method: "POST", form: { dj: "vibe", own: "2", lane: "3" }, cookie: me });
  assert.equal(s.made(), 2);
  return e;
}
const page = async (e, dj) => (await go(e, `/buttons/pagekey12345/${dj}`)).text();
const act = (e, dj, form) => go(e, `/buttons/pagekey12345/${dj}/endless`, { method: "POST", form });

test("a DJ's page offers a new preset: the free numbers, the taken ones named, the first free picked", async () => {
  const s = spotifyMakes();
  try {
    const e = await setupHouse(s);
    const soul = await page(e, "soul");
    assert.match(soul, /Make Soul a house DJ<small>on a new preset, or in Vibe’s place<\/small>/);
    assert.match(soul, /<span>1 of 4 house DJs<\/span>/);
    assert.match(soul, /<span class="nk taken" aria-label="Preset 1, Requests"><b>1<\/b><small>Requests<\/small><\/span>/);
    assert.match(soul, /aria-label="Preset 2, Vibe"/);
    assert.match(soul, /aria-label="Preset 3, Guest DJ"/);
    assert.match(soul, /<input type="radio" name="btn" id="nk4" value="4" checked><label class="nk" for="nk4">/);
    assert.match(soul, /<input type="radio" name="btn" id="nk12" value="12">/);
    assert.match(soul, /\.djpage \.newpre:has\(#nk4:checked\) \.nb4\{display:inline\}/, "the button names the number picked");
    assert.match(soul, /Or in a house DJ’s place/);
    const genre = await page(e, "genre");
    assert.doesNotMatch(genre, /name="btn" id="nk/, "a DJ who must be told what to play is never a house DJ");
  } finally { s.restore(); }
});

test("a new preset: the playlist made, the preset added, the first set asked, the save steps shown until done", async () => {
  const s = spotifyMakes();
  try {
    const e = await setupHouse(s);
    const made = await act(e, "soul", { do: "new", btn: "4" });
    assert.equal(made.status, 303);
    assert.match(made.headers.get("location"), /endless=new-done/);
    assert.equal(s.made(), 3, "Soul's playlist");
    const soul = await page(e, "soul");
    assert.match(soul, /House DJ · preset 4 · /);
    assert.match(soul, /<h3>Save it on each WiiM<\/h3>/);
    assert.match(soul, /open\.spotify\.com\/playlist\/NEWPLAYLIST00000000003/, "the playlist's own link");
    assert.match(soul, /<b>Preset<\/b>, <b>4<\/b>/);
    assert.match(soul, /Give up preset 4/);
    assert.doesNotMatch(soul, /On a new preset/, "a house DJ already");
    assert.match(await page(e, "hank"), /<span>2 of 4 house DJs<\/span>/);
    await act(e, "soul", { do: "saved" });
    assert.doesNotMatch(await page(e, "soul"), /Save it on each WiiM/, "said saved: the steps go");
    assert.equal((await act(e, "hank", { do: "new", btn: "4" })).headers.get("location").match(/endless=new-taken/) !== null, true, "4 is Soul's now");
    assert.match((await act(e, "hank", { do: "new", btn: "1" })).headers.get("location"), /endless=new-taken/, "the Requests preset");
  } finally { s.restore(); }
});

test("giving a preset up frees the number and keeps the playlist, which a new preset for that DJ takes back", async () => {
  const s = spotifyMakes();
  try {
    const e = await setupHouse(s);
    await act(e, "soul", { do: "new", btn: "4" });
    assert.equal(s.made(), 3);
    const gone = await act(e, "soul", { do: "giveup" });
    assert.match(gone.headers.get("location"), /endless=giveup-done/);
    const soul = await page(e, "soul");
    assert.match(soul, /<span>1 of 4 house DJs<\/span>/);
    assert.match(soul, /id="nk4" value="4" checked/, "4 is free again");
    assert.match((await act(e, "soul", { do: "new", btn: "6" })).headers.get("location"), /endless=new-done/);
    assert.equal(s.made(), 3, "no second playlist called Soul");
    assert.match(await page(e, "soul"), /House DJ · preset 6 · [\s\S]*open\.spotify\.com\/playlist\/NEWPLAYLIST00000000003/);
  } finally { s.restore(); }
});

test("four house DJs is the most: the fifth is offered a place, not a number", async () => {
  const s = spotifyMakes();
  try {
    const e = await setupHouse(s);
    for (const [dj, n] of [["soul", "4"], ["hank", "5"], ["pub-rock", "6"]]) {
      assert.match((await act(e, dj, { do: "new", btn: n })).headers.get("location"), /endless=new-done/, dj);
    }
    const gf = await page(e, "gatefold");
    assert.match(gf, /Make Gatefold a house DJ<small>2, 4, 5 or 6 · in a house DJ’s place<\/small>/);
    assert.match(gf, /This house has 4 house DJs, the most it holds\. Put Gatefold in one’s place, or play Gatefold endless as the guest DJ on 3, which needs no saving\./);
    assert.doesNotMatch(gf, /name="btn" id="nk/);
    assert.match((await act(e, "gatefold", { do: "new", btn: "7" })).headers.get("location"), /endless=new-full/);
  } finally { s.restore(); }
});

test("a house whose endless DJs are in its file is offered no new preset and no giving up", async () => {
  const s = spotifyMakes();
  try {
    const e = makeEnv();
    e.PROGRAM_LIBRARY_KEY = "pagekey12345";
    e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: "REQUESTS00000000000001", catalog: "spotify" }]);
    e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
      { button: 2, dj: "vibe", playlist: "VIBEPLAYLIST0000000001" }, { button: 3, lane: true, playlist: "LANEPLAYLIST0000000001" }] });
    const soul = await page(e, "soul");
    assert.match(soul, /Make Soul a house DJ<small>2 · replaces the DJ there<\/small>/);
    assert.doesNotMatch(soul, /name="btn" id="nk/);
    assert.doesNotMatch(await page(e, "vibe"), /Give up preset/);
    assert.match((await act(e, "soul", { do: "new", btn: "4" })).headers.get("location"), /endless=new-not-here/);
  } finally { s.restore(); }
});
